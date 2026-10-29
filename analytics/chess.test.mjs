import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { communityChess, chessPlayer, cleanupChess } from './chess.mjs';
import { Chess, INITIAL_FEN, positionKey, exportPgn } from '../chess/rules.mjs';
const now = 1_793_361_600;
const origin = 'https://salieri.site';
function setup(fen = INITIAL_FEN) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('./migrations/0003_community_chess.sql', import.meta.url), 'utf8'));
  const canonical = new Chess(fen).fen();
  sqlite.prepare('UPDATE chess_games SET initial_fen = ?, fen = ?, positions = ?, created_at = ?, updated_at = ?').run(canonical, canonical, JSON.stringify({ [positionKey(canonical)]: 1 }), now, now);
  function prepare(sql) {
    let args = [];
    const statement = {
      bind(...values) { args = values; return statement; },
      async run() { const result = sqlite.prepare(sql).run(...args); return { success: true, meta: { changes: Number(result.changes) } }; },
      async all() { const results = sqlite.prepare(sql).all(...args).map(row => ({ ...row })); return { success: true, results, meta: { changes: sqlite.prepare('SELECT changes() AS n').get().n } }; },
      async first() { return (await statement.all()).results[0] || null; },
    };
    return statement;
  }
  const DB = { sqlite, prepare, async batch(statements) {
    sqlite.exec('BEGIN');
    try { const results = []; for (const statement of statements) results.push(await statement.all()); sqlite.exec('COMMIT'); return results; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } };
  return { DB, VISITOR_SECRET: 'a-keyed-chess-player-secret-that-is-32-characters', ALLOWED_ORIGINS: origin };
}
function request(path, { ip = '203.0.113.1', data, headers = {}, method = data ? 'POST' : 'GET' } = {}) {
  return new Request(`https://stats.salieri.site/chess${path}`, { method, headers: { Origin: origin, 'CF-Connecting-IP': ip, 'User-Agent': 'Test Browser', ...(data ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(data ? { body: JSON.stringify(data) } : {}) });
}
const call = (e, path, options = {}) => communityChess(request(path, options), e, now);
async function state(e, ip) { return (await (await call(e, '/current', { ip })).json()).game; }
async function move(e, from, to, ip, extra = {}) {
  const game = await state(e, ip);
  const response = await call(e, '/move', { ip, data: { gameId: game.id, revision: game.revision, from, to, ...extra } });
  assert.equal(response.status, 200, await response.clone().text());
  return (await response.json()).game;
}
async function play(e, uciMoves) {
  let game;
  for (const [index, uci] of uciMoves.entries()) game = await move(e, uci.slice(0, 2), uci.slice(2, 4), index % 2 ? '203.0.113.2' : '203.0.113.1', uci[4] ? { promotion: uci[4] } : {});
  return game;
}

test('one shared board uses IP alone for alternating participation, persists moves, and never publishes private identifiers', async () => {
  const e = setup();
  assert.equal((await state(e)).turn, 'w');
  const first = await move(e, 'e2', 'e4', '203.0.113.1');
  assert.equal(first.turn, 'b'); assert.equal(first.canMove, false);
  const forbidden = await call(e, '/move', { headers: { 'User-Agent': 'Other device', 'X-Forwarded-For': '203.0.113.3' }, data: { gameId: 1, revision: 1, from: 'e7', to: 'e5' } });
  assert.equal(forbidden.status, 403);
  await move(e, 'e7', 'e5', '203.0.113.2');
  const third = await move(e, 'g1', 'f3', '203.0.113.1');
  assert.deepEqual(third.moves.map(m => m.san), ['e4', 'e5', 'Nf3']);
  const row = e.DB.sqlite.prepare('SELECT * FROM chess_games').get();
  assert.match(row.last_player, /^[0-9a-f]{64}$/);
  for (const secret of ['203.0.113.1', row.last_player, row.last_action, 'positions', 'last_player']) assert.ok(!JSON.stringify(third).includes(secret));
  assert.equal(await chessPlayer(request('/current'), e.VISITOR_SECRET), await chessPlayer(request('/current', { headers: { 'User-Agent': 'Changed' } }), e.VISITOR_SECRET));
  e.DB.sqlite.close();
});
test('simultaneous moves use an atomic revision check and cannot mix a losing request into the accepted scoresheet', async () => {
  const e = setup();
  const bodies = [{ from: 'e2', to: 'e4' }, { from: 'd2', to: 'd4' }];
  const results = await Promise.all(bodies.map((body, index) => call(e, '/move', { ip: `203.0.113.${index + 1}`, data: { gameId: 1, revision: 0, ...body } })));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const current = await state(e);
  assert.equal(current.ply, 1); assert.equal(current.moves.length, 1);
  assert.equal(current.moves[0].from, bodies[results.findIndex(r => r.status === 200)].from);
  assert.equal(current.moves[0].fen, current.fen);
  assert.equal((await call(e, '/move', { ip: '203.0.113.3', data: { gameId: 1, revision: 0, from: 'e7', to: 'e5' } })).status, 409);
  e.DB.sqlite.close();
});
test('server rejects wrong-side moves, blocked pieces, and moves exposing the king', async () => {
  const e = setup();
  for (const [from, to] of [['e7', 'e5'], ['e2', 'e1'], ['a1', 'a8']]) assert.equal((await call(e, '/move', { data: { gameId: 1, revision: 0, from, to } })).status, 422);
  const pinned = setup('r6k/8/8/8/8/8/R7/K7 w - - 0 1');
  assert.equal((await call(pinned, '/move', { data: { gameId: 1, revision: 0, from: 'a2', to: 'b2' } })).status, 422);
  assert.equal((await state(e)).ply, 0);
  e.DB.sqlite.close(); pinned.DB.sqlite.close();
});
test('both castling directions move the rook and castling through check is illegal', async () => {
  const e = setup('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  let game = await move(e, 'e1', 'g1', '203.0.113.1');
  assert.equal(new Chess(game.fen).get('f1').type, 'r'); assert.equal(game.moves[0].san, 'O-O');
  game = await move(e, 'e8', 'c8', '203.0.113.2');
  assert.equal(new Chess(game.fen).get('d8').type, 'r'); assert.equal(game.moves[1].san, 'O-O-O');
  const attacked = setup('k4r2/8/8/8/8/8/8/4K2R w K - 0 1');
  assert.equal((await call(attacked, '/move', { data: { gameId: 1, revision: 0, from: 'e1', to: 'g1' } })).status, 422);
  e.DB.sqlite.close(); attacked.DB.sqlite.close();
});
test('en passant removes the bypassed pawn and expires after an intervening move', async () => {
  const e = setup();
  const game = await play(e, ['e2e4', 'a7a6', 'e4e5', 'd7d5', 'e5d6']);
  const board = new Chess(game.fen);
  assert.equal(board.get('d5'), undefined); assert.equal(board.get('d6').type, 'p'); assert.equal(game.moves.at(-1).san, 'exd6');
  const expired = setup(); await play(expired, ['e2e4', 'a7a6', 'e4e5', 'd7d5', 'g1f3', 'a6a5']);
  assert.equal((await call(expired, '/move', { data: { gameId: 1, revision: 6, from: 'e5', to: 'd6' } })).status, 422);
  e.DB.sqlite.close(); expired.DB.sqlite.close();
});
test('promotion requires an explicit legal choice and supports all four choices including underpromotion', async () => {
  for (const promotion of ['q', 'r', 'b', 'n']) {
    const e = setup('7k/P7/8/8/8/8/8/7K w - - 0 1');
    assert.equal((await call(e, '/move', { data: { gameId: 1, revision: 0, from: 'a7', to: 'a8' } })).status, 422);
    const game = await move(e, 'a7', 'a8', '203.0.113.1', { promotion });
    assert.equal(new Chess(game.fen).get('a8').type, promotion);
    e.DB.sqlite.close();
  }
});
test('checkmate archives an immutable scoresheet, exports valid PGN, and only one new shared game can be created', async () => {
  const e = setup();
  const game = await play(e, ['f2f3', 'e7e5', 'g2g4', 'd8h4']);
  assert.equal(game.result, '0-1'); assert.equal(game.ending, 'checkmate'); assert.equal(game.status, 'finished');
  const archives = await (await call(e, '/history')).json(); assert.equal(archives.games[0].id, game.id);
  const parsed = new Chess(); parsed.loadPgn(exportPgn(game)); assert.equal(parsed.fen(), game.fen);
  const next = await Promise.all([1, 2].map(i => call(e, '/new', { ip: `203.0.113.${i}`, data: { gameId: game.id, revision: game.revision } })));
  assert.deepEqual(next.map(r => r.status).sort(), [201, 409]);
  assert.equal(e.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM chess_games WHERE status='active'").get().n, 1);
  assert.equal((await state(e)).ply, 0);
  const historical = (await (await call(e, `/games/${game.id}`)).json()).game;
  assert.equal(historical.moves.length, 4); assert.equal(historical.canMove, false); assert.equal(historical.result, '0-1');
  assert.equal((await call(e, '/move', { data: { gameId: game.id, revision: game.revision, from: 'a2', to: 'a3' } })).status, 409);
  e.DB.sqlite.close();
});
test('stalemate and insufficient material are automatically drawn', async () => {
  const stale = setup('k7/8/1QK5/8/8/8/8/8 w - - 0 1');
  assert.equal((await move(stale, 'b6', 'c7', '203.0.113.1')).ending, 'stalemate');
  const material = setup('k7/8/8/8/3n4/2B5/8/7K w - - 0 1');
  assert.equal((await move(material, 'c3', 'd4', '203.0.113.1')).ending, 'material');
  stale.DB.sqlite.close(); material.DB.sqlite.close();
});
test('threefold repetition is claimable and fivefold is automatic', async () => {
  const cycle = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];
  const e = setup();
  const repeated = await play(e, [...cycle, ...cycle]);
  assert.equal(repeated.status, 'active'); assert.ok(repeated.drawClaims.includes('threefold'));
  const claimed = await call(e, '/claim', { data: { gameId: 1, revision: 8 } });
  assert.equal(claimed.status, 200); const claim = (await claimed.json()).game;
  assert.equal(claim.ending, 'threefold'); assert.equal(claim.ply, 8); assert.equal(claim.revision, 9);
  const five = setup(); const automatic = await play(five, [...cycle, ...cycle, ...cycle, ...cycle]);
  assert.equal(automatic.ending, 'fivefold'); assert.equal(automatic.status, 'finished');
  e.DB.sqlite.close(); five.DB.sqlite.close();
});
test('intended-move draw claims finish the game without executing or recording the intended move', async () => {
  const e = setup();
  const previous = await play(e, ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1']);
  const result = await call(e, '/move', { ip: '203.0.113.2', data: { gameId: 1, revision: 7, from: 'f6', to: 'g8', claim: true } });
  assert.equal(result.status, 200); const game = (await result.json()).game;
  assert.equal(game.ending, 'threefold'); assert.equal(game.declaredMove, 'Ng8'); assert.equal(game.fen, previous.fen); assert.equal(game.ply, 7);
  const invalid = setup(); assert.equal((await call(invalid, '/claim', { data: { gameId: 1, revision: 0 } })).status, 422);
  assert.equal((await call(invalid, '/move', { data: { gameId: 1, revision: 0, from: 'e2', to: 'e4', claim: true } })).status, 422);
  e.DB.sqlite.close(); invalid.DB.sqlite.close();
});
test('50-move claims and automatic 75-move draws preserve checkmate priority', async () => {
  const fifty = setup('7k/8/8/8/8/8/R7/K7 w - - 99 50');
  const game = await move(fifty, 'a2', 'b2', '203.0.113.1');
  assert.equal(game.status, 'active'); assert.ok(game.drawClaims.includes('fifty'));
  const claim = await call(fifty, '/claim', { ip: '203.0.113.2', data: { gameId: 1, revision: 1 } }); assert.equal((await claim.json()).game.ending, 'fifty');
  const seventyFive = setup('7k/8/8/8/8/8/R7/K7 w - - 149 75');
  assert.equal((await move(seventyFive, 'a2', 'b2', '203.0.113.1')).ending, 'seventy-five');
  const mate = setup('7k/8/5KQ1/8/8/8/8/8 w - - 149 75');
  const winner = await move(mate, 'g6', 'g7', '203.0.113.1'); assert.equal(winner.ending, 'checkmate'); assert.equal(winner.result, '1-0');
  fifty.DB.sqlite.close(); seventyFive.DB.sqlite.close(); mate.DB.sqlite.close();
});
test('incremental reads, archive pagination, origin checks, missing IP and malformed writes are handled', async () => {
  const e = setup();
  assert.equal((await call(e, '/current', { headers: { Origin: 'https://example.com' } })).status, 403);
  assert.equal((await call(e, '/current', { method: 'OPTIONS' })).status, 204);
  assert.equal((await state(e, '')).canMove, false);
  assert.equal((await call(e, '/new', { ip: '', data: { gameId: 1, revision: 0 } })).status, 403);
  assert.equal((await call(e, '/new', { data: { gameId: 1, revision: 0 } })).status, 409);
  assert.equal((await call(e, '/move', { data: { gameId: 1, revision: 0, from: 'e2', to: 'e4', ip: 'spoof' } })).status, 400);
  await play(e, ['e2e4', 'e7e5']);
  const incremental = await (await call(e, '/current?known=1.1&after=1')).json(); assert.equal(incremental.incremental, true); assert.equal(incremental.game.moves.length, 1);
  const unchanged = await (await call(e, '/current?known=1.2&after=2')).json(); assert.equal(unchanged.unchanged, true); assert.equal(unchanged.canMove, true);
  assert.equal((await call(e, '/current?known=1.1&after=99')).status, 400);
  assert.equal((await call(e, '/games/999')).status, 404);
  assert.equal((await call(e, '/history?before=-1')).status, 400);
  assert.equal((await call(e, '/move', { method: 'GET' })).status, 405);
  assert.equal((await call(e, '/move', { data: { tooLarge: 'x'.repeat(3000), gameId: 1, revision: 2 } })).status, 413);
  e.DB.sqlite.prepare("UPDATE chess_games SET status='finished', result='1/2-1/2', ending='fifty', finished_at=?").run(now);
  for (let i = 0; i < 14; i++) e.DB.sqlite.prepare("INSERT INTO chess_games(status,initial_fen,fen,positions,created_at,updated_at,finished_at,result) VALUES('finished',?,?, '{}',?,?,?,'1/2-1/2')").run(INITIAL_FEN, INITIAL_FEN, now, now, now);
  const first = await (await call(e, '/history')).json(); assert.equal(first.games.length, 12); assert.ok(first.nextCursor);
  const second = await (await call(e, `/history?before=${first.nextCursor}`)).json(); assert.equal(second.games.length, 3); assert.equal(second.nextCursor, null);
  e.DB.sqlite.close();
});

test('a scoresheet insert failure rolls back the game update instead of losing a move', async () => {
  const e = setup();
  e.DB.sqlite.exec("CREATE TRIGGER reject_test_move BEFORE INSERT ON chess_moves BEGIN SELECT RAISE(ABORT, 'private simulated database failure'); END;");
  const response = await call(e, '/move', { data: { gameId: 1, revision: 0, from: 'e2', to: 'e4' } });
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes('private simulated'));
  const current = await state(e); assert.equal(current.revision, 0); assert.equal(current.fen, INITIAL_FEN); assert.equal(current.moves.length, 0);
  e.DB.sqlite.close();
});
test('a concurrent move between metadata and scoresheet reads cannot leak a future move into the older snapshot', async () => {
  const e = setup(); const original = e.DB.prepare; let advanced = false;
  e.DB.prepare = sql => {
    if (!advanced && sql.startsWith('SELECT ply, color')) {
      advanced = true;
      const board = new Chess(); board.move('e4');
      e.DB.sqlite.prepare('UPDATE chess_games SET fen=?, revision=1, ply=1, positions=? WHERE id=1').run(board.fen(), JSON.stringify({ [positionKey(board.fen())]: 1 }));
      e.DB.sqlite.prepare('INSERT INTO chess_moves(game_id,ply,color,move_number,from_square,to_square,san,fen,created_at) VALUES(1,1,\'w\',1,\'e2\',\'e4\',\'e4\',?,?)').run(board.fen(), now);
    }
    return original(sql);
  };
  const oldSnapshot = await state(e); assert.equal(oldSnapshot.ply, 0); assert.equal(oldSnapshot.moves.length, 0); assert.equal(oldSnapshot.fen, INITIAL_FEN);
  const nextSnapshot = await state(e); assert.equal(nextSnapshot.ply, 1); assert.equal(nextSnapshot.moves.length, 1);
  e.DB.sqlite.close();
});
test('write throttling uses keyed IP hashes, resets after a minute, and cleanup preserves game history', async () => {
  const e = setup();
  for (let index = 0; index < 20; index++) assert.equal((await call(e, '/move', { data: { gameId: 1, revision: 0, from: 'e2', to: 'e1' } })).status, 422);
  const blocked = await call(e, '/move', { data: { gameId: 1, revision: 0, from: 'e2', to: 'e4' } }); assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('Retry-After'), '60');
  assert.ok(!JSON.stringify(e.DB.sqlite.prepare('SELECT * FROM chess_attempts').all()).includes('203.0.113.1'));
  const retry = await communityChess(request('/move', { data: { gameId: 1, revision: 0, from: 'e2', to: 'e4' } }), e, now + 61); assert.equal(retry.status, 200);
  await cleanupChess(e, now + 200); assert.equal(e.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM chess_attempts').get().n, 0);
  assert.equal((await state(e)).ply, 1);
  e.DB.sqlite.close();
});
