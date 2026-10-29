import { Chess, INITIAL_FEN, positionKey, claims, positionsAfter, automaticResult } from '../chess/rules.mjs';
const encoder = new TextEncoder();
const hex = bytes => [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
class ChessError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
function reply(data, status, origin) {
  return new Response(data === null ? null : JSON.stringify(data), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type', 'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff',
    ...(status === 429 ? { 'Retry-After': '60' } : {}),
  } });
}
export async function chessPlayer(request, secret) {
  const ip = request.headers.get('CF-Connecting-IP');
  if (!ip || ip.length > 64) return null;
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(`community-chess:v1:${ip}`)));
}
async function input(request) {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) throw new ChessError('请求格式不正确');
  if (Number(request.headers.get('Content-Length')) > 2048) throw new ChessError('请求内容过大', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new ChessError('请求内容为空');
  const chunks = []; let length = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    length += value.length;
    if (length > 2048) { await reader.cancel(); throw new ChessError('请求内容过大', 413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let body;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new ChessError('请求格式不正确'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ChessError('请求格式不正确');
  return body;
}
const integer = value => Number.isSafeInteger(value) && value >= 0;
function version(body) {
  if (!integer(body.gameId) || body.gameId < 1 || !integer(body.revision)) throw new ChessError('棋局版本不正确，请同步后重试');
}
function moveInput(body) {
  if (typeof body.from !== 'string' || typeof body.to !== 'string' || !/^[a-h][1-8]$/.test(body.from) || !/^[a-h][1-8]$/.test(body.to) || (body.promotion !== undefined && !['q', 'r', 'b', 'n'].includes(body.promotion))) throw new ChessError('走法格式不正确');
  if (body.claim !== undefined && typeof body.claim !== 'boolean') throw new ChessError('和棋声明格式不正确');
  return { from: body.from, to: body.to, ...(body.promotion ? { promotion: body.promotion } : {}) };
}
async function rate(env, player, now) {
  const row = await env.DB.prepare(`INSERT INTO chess_attempts(bucket, attempts, reset_at) VALUES (?, 1, ?)
    ON CONFLICT(bucket) DO UPDATE SET
    attempts = CASE WHEN chess_attempts.reset_at <= ? THEN 1 ELSE chess_attempts.attempts + 1 END,
    reset_at = CASE WHEN chess_attempts.reset_at <= ? THEN excluded.reset_at ELSE chess_attempts.reset_at END
    RETURNING attempts`).bind(player, now + 60, now, now).first();
  if (row.attempts > 20) throw new ChessError('操作过于频繁，请稍后再试', 429);
}
function summary(row) {
  return { id: row.id, status: row.status, ply: row.ply, revision: row.revision, result: row.result,
    ending: row.ending, declaredMove: row.declared_move, createdAt: row.created_at, updatedAt: row.updated_at, finishedAt: row.finished_at };
}
async function gameData(env, row, player, after = 0) {
  const chess = new Chess(row.fen);
  const moves = await env.DB.prepare('SELECT ply, color, move_number AS number, from_square AS "from", to_square AS "to", promotion, san, fen, created_at AS createdAt FROM chess_moves WHERE game_id = ? AND ply > ? AND ply <= ? ORDER BY ply').bind(row.id, after, row.ply).all();
  return { ...summary(row), initialFen: row.initial_fen, fen: row.fen, turn: chess.turn(), inCheck: chess.isCheck(),
    canMove: row.status === 'active' && !!player && row.last_player !== player,
    waitingForOtherIp: row.status === 'active' && !!player && row.last_player === player,
    drawClaims: row.status === 'active' ? claims(row.fen, JSON.parse(row.positions)) : [], moves: moves.results };
}
async function latest(env) { return env.DB.prepare('SELECT * FROM chess_games ORDER BY id DESC LIMIT 1').first(); }
async function writable(env, body, player) {
  const row = await env.DB.prepare('SELECT * FROM chess_games WHERE id = ?').bind(body.gameId).first();
  if (!row || row.revision !== body.revision || row.status !== 'active') throw new ChessError('棋局已更新，请同步后重新选择走法', 409);
  if (row.last_player === player) throw new ChessError('你已经走过一步，请等待其他 IP 的访客接力', 403);
  return row;
}
async function saveTurn(env, row, body, player, now, { chess, positions, move = null, outcome = null, declared = null }) {
  const nonce = hex(crypto.getRandomValues(new Uint8Array(16)));
  const fen = move ? chess.fen() : row.fen;
  const ply = row.ply + (move ? 1 : 0);
  const statements = [env.DB.prepare(`UPDATE chess_games SET fen = ?, positions = ?, ply = ?, revision = revision + 1,
    last_player = ?, last_action = ?, updated_at = ?, status = ?, result = ?, ending = ?, declared_move = ?, finished_at = ?
    WHERE id = ? AND revision = ? AND status = 'active' AND (last_player IS NULL OR last_player != ?)`)
    .bind(fen, JSON.stringify(positions), ply, player, nonce, now, outcome ? 'finished' : 'active', outcome?.result || '*', outcome?.ending || null, declared, outcome ? now : null, row.id, body.revision, player)];
  if (move) statements.push(env.DB.prepare(`INSERT INTO chess_moves(game_id, ply, color, move_number, from_square, to_square, promotion, san, fen, created_at)
    SELECT id, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM chess_games WHERE id = ? AND last_action = ?`)
    .bind(ply, move.color, Number(row.fen.split(' ')[5]), move.from, move.to, move.promotion || null, move.san, fen, now, row.id, nonce));
  const results = await env.DB.batch(statements);
  if (!results[0].meta.changes) throw new ChessError('其他访客已先落子，请同步后重新选择走法', 409);
  const saved = await env.DB.prepare('SELECT * FROM chess_games WHERE id = ?').bind(row.id).first();
  return gameData(env, saved, player);
}
export async function communityChess(request, env, now = Math.floor(Date.now() / 1000)) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim());
  if (!origin || !allowed.includes(origin)) return reply({ error: '来源不允许' }, 403, 'null');
  if (request.method === 'OPTIONS') return reply(null, 204, origin);
  if (!env.DB || typeof env.VISITOR_SECRET !== 'string' || env.VISITOR_SECRET.length < 32) return reply({ error: '棋局服务暂未配置' }, 503, origin);
  try {
    const url = new URL(request.url); const path = url.pathname;
    const player = await chessPlayer(request, env.VISITOR_SECRET);
    if (request.method === 'GET' && path === '/chess/current') {
      const row = await latest(env);
      if (!row) throw new ChessError('棋局尚未初始化', 503);
      const known = `${row.id}.${row.revision}`;
      if (url.searchParams.get('known') === known) return reply({ unchanged: true, gameId: row.id, revision: row.revision, canMove: row.status === 'active' && !!player && row.last_player !== player, waitingForOtherIp: row.status === 'active' && !!player && row.last_player === player }, 200, origin);
      const sameGame = url.searchParams.get('known')?.split('.')[0] === String(row.id);
      const after = sameGame ? Number(url.searchParams.get('after') || 0) : 0;
      if (!integer(after) || after > row.ply) throw new ChessError('棋谱游标不正确');
      return reply({ game: await gameData(env, row, player, after), incremental: sameGame && after > 0 }, 200, origin);
    }
    if (request.method === 'GET' && path === '/chess/history') {
      const cursor = url.searchParams.has('before') ? Number(url.searchParams.get('before')) : Number.MAX_SAFE_INTEGER;
      if (!integer(cursor) || cursor < 1) throw new ChessError('历史游标不正确');
      const rows = await env.DB.prepare("SELECT id, status, ply, revision, result, ending, declared_move, created_at, updated_at, finished_at FROM chess_games WHERE status = 'finished' AND id < ? ORDER BY id DESC LIMIT 13").bind(cursor).all();
      const more = rows.results.length > 12;
      return reply({ games: rows.results.slice(0, 12).map(summary), nextCursor: more ? rows.results[11].id : null }, 200, origin);
    }
    if (request.method === 'GET' && /^\/chess\/games\/[1-9]\d{0,14}$/.test(path)) {
      const row = await env.DB.prepare('SELECT * FROM chess_games WHERE id = ?').bind(Number(path.split('/').pop())).first();
      if (!row) throw new ChessError('未找到这盘棋局', 404);
      return reply({ game: await gameData(env, row, player) }, 200, origin);
    }
    if (!['/chess/move', '/chess/claim', '/chess/new'].includes(path)) throw new ChessError('接口不存在', 404);
    if (request.method !== 'POST') throw new ChessError('请求方法不允许', 405);
    if (!player) throw new ChessError('无法识别当前网络地址，请稍后重试', 403);
    await rate(env, player, now);
    const body = await input(request); version(body);
    const supported = path === '/chess/move' ? ['gameId', 'revision', 'from', 'to', 'promotion', 'claim'] : ['gameId', 'revision'];
    if (Object.keys(body).some(key => !supported.includes(key))) throw new ChessError('请求包含不支持的字段');
    if (path === '/chess/new') {
      const firstPositions = JSON.stringify({ [positionKey(INITIAL_FEN)]: 1 });
      const created = await env.DB.prepare(`INSERT INTO chess_games(initial_fen, fen, positions, created_at, updated_at)
        SELECT ?, ?, ?, ?, ? WHERE EXISTS(SELECT 1 FROM chess_games WHERE id = ? AND revision = ? AND status = 'finished' AND id = (SELECT MAX(id) FROM chess_games))
        AND NOT EXISTS(SELECT 1 FROM chess_games WHERE status = 'active') RETURNING id`).bind(INITIAL_FEN, INITIAL_FEN, firstPositions, now, now, body.gameId, body.revision).first();
      if (!created) throw new ChessError('当前棋局尚未结束，或其他访客已开启新局，请同步棋局', 409);
      return reply({ game: await gameData(env, await latest(env), player) }, 201, origin);
    }
    const row = await writable(env, body, player);
    const chess = new Chess(row.fen); const positions = JSON.parse(row.positions);
    if (path === '/chess/claim') {
      const available = claims(row.fen, positions);
      if (!available.length) throw new ChessError('当前局面不满足三次重复或 50 回合的和棋声明条件', 422);
      return reply({ game: await saveTurn(env, row, body, player, now, { chess, positions, outcome: { result: '1/2-1/2', ending: available[0] } }) }, 200, origin);
    }
    const candidate = moveInput(body); let move;
    try { move = chess.move(candidate); } catch { throw new ChessError('这不是合法走法，请选择棋盘标记的落点', 422); }
    const nextPositions = positionsAfter(positions, move, chess.fen());
    if (body.claim) {
      const available = claims(chess.fen(), nextPositions);
      if (!available.length) throw new ChessError('拟走的这一步不满足和棋声明条件', 422);
      return reply({ game: await saveTurn(env, row, body, player, now, { chess, positions, outcome: { result: '1/2-1/2', ending: available[0] }, declared: move.san }) }, 200, origin);
    }
    return reply({ game: await saveTurn(env, row, body, player, now, { chess, positions: nextPositions, move, outcome: automaticResult(chess, nextPositions) }) }, 200, origin);
  } catch (error) {
    if (error instanceof ChessError) return reply({ error: error.message }, error.status, origin);
    // Raw addresses, private player hashes, database details and request bodies stay private.
    return reply({ error: '棋局服务暂时不可用，请稍后同步重试' }, 503, origin);
  }
}
export async function cleanupChess(env, now = Math.floor(Date.now() / 1000)) {
  await env.DB.prepare('DELETE FROM chess_attempts WHERE reset_at <= ?').bind(now).run();
}
