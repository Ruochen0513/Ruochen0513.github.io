import { Chess, INITIAL_FEN, ENDINGS, positionKey, claims, positionsAfter, exportPgn } from './rules.mjs';
import { PIECE_NAMES, pieceIcon } from './pieces.mjs';
const $ = selector => document.querySelector(selector);
const endpoint = window.PLAYER_HOME_CONFIG.visitors.endpoint.replace(/\/$/, '');
let game = null;
let archiveView = false;
let viewPly = null;
let selected = null;
let legal = [];
let flipped = false;
let busy = false;
let stale = true;
let loadSequence = 0;
let historySequence = 0;
let archiveCursor = null;
let archiveGames = [];
let pendingMove = null;
let pointerDrag = null;
let suppressBoardClickUntil = 0;
const colorName = side => side === 'w' ? '白方' : '黑方';
const resultName = value => ({ '*': '进行中', '1-0': '白方胜', '0-1': '黑方胜', '1/2-1/2': '和棋' })[value] || value;
function notify(message, kind = '') { $('#chess-notice').textContent = message; $('#chess-notice').dataset.kind = kind; }
async function api(path, data) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${endpoint}/chess${path}`, { method: data ? 'POST' : 'GET', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal,
      ...(data ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : {}) });
    let payload;
    try { payload = await response.json(); } catch { throw new Error('暂时无法读取棋局，请点击“同步棋局”重试。'); }
    if (!response.ok) { const error = new Error(payload.error || '棋局请求失败，请稍后再试'); error.status = response.status; throw error; }
    return payload;
  } catch (error) {
    if (error.name === 'AbortError' || error instanceof TypeError) throw new Error('网络暂时不可用，已保留棋谱。请同步棋局后再落子。');
    throw error;
  } finally { clearTimeout(timer); }
}
function validateGame(value) {
  if (!value || !Number.isSafeInteger(value.id) || value.id < 1 || !Number.isSafeInteger(value.revision) || !Number.isSafeInteger(value.ply) || value.ply < 0 || !['active', 'finished'].includes(value.status) || !['*', '1-0', '0-1', '1/2-1/2'].includes(value.result) || !Array.isArray(value.moves) || value.moves.length !== value.ply) throw new Error('棋局数据不完整，请重新同步。');
  new Chess(value.fen); new Chess(value.initialFen);
  if (value.moves.some((move, index) => move.ply !== index + 1 || typeof move.san !== 'string' || !['w', 'b'].includes(move.color) || !Number.isSafeInteger(move.number) || typeof move.fen !== 'string')) throw new Error('棋谱数据不完整，请重新同步。');
  if (value.ply && value.moves.at(-1).fen !== value.fen) throw new Error('棋谱版本不同步，请重新载入。');
  return value;
}
const atLivePosition = () => !archiveView && viewPly === null;
const canPlay = () => game && atLivePosition() && game.status === 'active' && game.canMove && !busy && !stale;
const shownPly = () => viewPly === null ? game?.ply || 0 : viewPly;
const shownFen = () => !game ? INITIAL_FEN : shownPly() === 0 ? game.initialFen : game.moves[shownPly() - 1].fen;
function stopDrag() {
  const drag = pointerDrag;
  pointerDrag = null;
  if (!drag) return null;
  drag.ghost?.remove();
  const board = $('#chess-board');
  board.classList.remove('is-dragging');
  document.body.classList.remove('chess-dragging');
  board.querySelectorAll('.is-drag-source, .drag-over, .drag-invalid').forEach(square => square.classList.remove('is-drag-source', 'drag-over', 'drag-invalid'));
  if (board.hasPointerCapture(drag.id)) board.releasePointerCapture(drag.id);
  if (drag.active) suppressBoardClickUntil = performance.now() + 400;
  return drag;
}
function clearSelection() { stopDrag(); selected = null; legal = []; }
function cancelDrag() {
  const drag = stopDrag();
  if (drag?.active) { clearSelection(); renderBoard(); }
}
function closeChoices() {
  pendingMove = null;
  for (const id of ['promotion-dialog', 'draw-dialog']) if ($(`#${id}`).open) $(`#${id}`).close();
}
function renderBoard() {
  const chess = new Chess(shownFen());
  const board = $('#chess-board');
  const focused = document.activeElement?.closest('#chess-board [data-square]')?.dataset.square;
  board.replaceChildren();
  board.setAttribute('aria-busy', String(busy || !game));
  const files = [...'abcdefgh'];
  const ranks = [8, 7, 6, 5, 4, 3, 2, 1];
  if (flipped) { files.reverse(); ranks.reverse(); }
  const last = game?.moves[shownPly() - 1];
  for (const [rankIndex, rank] of ranks.entries()) for (const [fileIndex, file] of files.entries()) {
    const square = `${file}${rank}`;
    const piece = chess.get(square);
    const target = legal.some(move => move.to === square);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `chess-square ${(file.charCodeAt(0) - 97 + rank) % 2 === 0 ? 'light' : 'dark'}`;
    button.dataset.square = square;
    button.disabled = busy;
    button.tabIndex = focused ? (square === focused ? 0 : -1) : square === (flipped ? 'd7' : 'e2') ? 0 : -1;
    button.setAttribute('aria-label', `${square}${piece ? ` ${colorName(piece.color)}${PIECE_NAMES[piece.type]}` : ' 空格'}${target ? '，合法落点' : ''}`);
    if (last && [last.from, last.to].includes(square)) button.classList.add('last-move');
    if (selected === square) button.classList.add('is-selected');
    if (target) button.classList.add('legal');
    if (piece) {
      button.classList.add('has-piece');
      if (canPlay() && piece.color === game.turn) button.classList.add('is-draggable');
      if (piece.type === 'k' && piece.color === chess.turn() && chess.isCheck()) button.classList.add('in-check');
      button.append(pieceIcon(piece.color, piece.type));
    }
    if (fileIndex === 0) { const label = document.createElement('span'); label.className = 'square-coordinate coordinate-rank'; label.textContent = rank; button.append(label); }
    if (rankIndex === 7) { const label = document.createElement('span'); label.className = 'square-coordinate coordinate-file'; label.textContent = file; button.append(label); }
    board.append(button);
  }
  const top = flipped ? 'w' : 'b'; const bottom = flipped ? 'b' : 'w';
  $('#top-side').textContent = colorName(top); $('#bottom-side').textContent = colorName(bottom);
  const dots = document.querySelectorAll('.chess-player-bar .side-dot');
  dots[0].className = `side-dot side-dot--${top === 'w' ? 'white' : 'black'}`;
  dots[1].className = `side-dot side-dot--${bottom === 'w' ? 'white' : 'black'}`;
  $('#top-turn').textContent = game?.status === 'active' && chess.turn() === top ? (chess.isCheck() ? '将军 · 待走棋' : '待走棋') : '';
  $('#bottom-turn').textContent = game?.status === 'active' && chess.turn() === bottom ? (chess.isCheck() ? '将军 · 待走棋' : '待走棋') : '';
  if (focused) board.querySelector(`[data-square="${focused}"]`)?.focus({ preventScroll: true });
}
function renderMoves() {
  const list = $('#move-list'); list.replaceChildren();
  if (!game?.moves.length) { const empty = document.createElement('p'); empty.className = 'chess-empty'; empty.textContent = '还没有落子，第一步由白方开始。'; list.append(empty); }
  else {
    let number = null; let row;
    for (const move of game.moves) {
      if (move.number !== number) {
        row = document.createElement('div'); row.className = 'move-row';
        const label = document.createElement('span'); label.className = 'move-number'; label.textContent = move.number;
        row.append(label, document.createElement('span'), document.createElement('span'));
        list.append(row); number = move.number;
      }
      const button = document.createElement('button'); button.type = 'button'; button.className = 'move-button';
      button.textContent = move.san; button.dataset.ply = move.ply;
      button.setAttribute('aria-label', `第 ${move.number} 回合 ${colorName(move.color)} ${move.san}`);
      if (move.ply === shownPly()) { button.classList.add('is-current'); button.setAttribute('aria-current', 'step'); }
      row.children[move.color === 'w' ? 1 : 2].replaceWith(button);
    }
  }
  const current = shownPly(); const total = game?.ply || 0;
  $('#move-counter').textContent = `${current} / ${total}`;
  $('#first-move').disabled = !game || current === 0;
  $('#previous-move').disabled = !game || current === 0;
  $('#next-move').disabled = !game || current === total;
  $('#last-move').disabled = !game || current === total;
  $('#score-position').textContent = current === 0 ? '初始局面' : `第 ${current} 手${atLivePosition() ? ' · 最新局面' : ' · 回看中'}`;
  if (viewPly !== null && !current) $('#score-position').textContent += ' · 回看中';
  const active = list.querySelector('.is-current');
  if (active) list.scrollTop += active.getBoundingClientRect().top - list.getBoundingClientRect().top - list.clientHeight / 2 + active.offsetHeight / 2;
}
function renderStatus() {
  $('#score-title').textContent = game ? `第 ${game.id} 局` : '共享棋局';
  $('#game-result').textContent = game ? resultName(game.result) : '未连接';
  $('#download-pgn').disabled = !game;
  $('#return-live').hidden = atLivePosition();
  $('#new-game').hidden = !game || game.status !== 'finished' || archiveView;
  $('#new-game').disabled = busy || stale;
  $('#claim-draw').hidden = !game || !atLivePosition() || game.status !== 'active' || !game.drawClaims.length;
  $('#claim-draw').disabled = !canPlay();
  $('#game-ending').textContent = game?.ending ? `${ENDINGS[game.ending] || '棋局结束'}${game.declaredMove ? `（拟走 ${game.declaredMove}）` : ''}` : '点击棋谱可回放';
  let title; let note;
  if (!game) { title = '等待棋局'; note = '连接后即可参与共享棋局。'; }
  else if (archiveView || viewPly !== null) { title = archiveView ? '正在查看历史对局' : '正在回看棋谱'; note = '当前为只读局面，点击“回到当前棋局”后才能参与落子。'; }
  else if (game.status === 'finished') { title = `${resultName(game.result)} · 棋局结束`; note = '完整棋谱已自动归档。可以回看每一步，或开启下一局。'; }
  else if (stale) { title = '等待重新连接'; note = '请同步棋局后再落子，已加载的棋谱仍可回看。'; }
  else if (busy) { title = '正在提交落子…'; note = '以服务器确认的棋局为准。'; }
  else if (game.waitingForOtherIp) { title = '已完成这一手，等待接力'; note = `现在轮到${colorName(game.turn)}。其他 IP 的访客落子后，你可以再次参与。`; }
  else if (game.canMove) { title = `轮到${colorName(game.turn)}，你可以走一步`; note = game.inCheck ? '当前正被将军，需要先解除将军。' : '拖动己方棋子到合法落点，也可以依次点击棋子和落点。'; }
  else { title = '当前无法参与走棋'; note = '可以查看棋谱，请稍后同步重试。'; }
  $('#participation-title').textContent = title; $('#participation-note').textContent = note;
}
function render() { renderBoard(); renderMoves(); renderStatus(); }
function applyGame(next) {
  const previous = game;
  game = validateGame(next); stale = false;
  clearSelection(); closeChoices();
  if (viewPly !== null) viewPly = Math.min(viewPly, game.ply);
  render();
  if (previous?.status === 'active' && game.status === 'finished') loadHistory().catch(() => {});
}
function syncedAt() { $('#last-sync').textContent = `同步于 ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`; }
async function loadCurrent({ silent = false, force = false } = {}) {
  const sequence = ++loadSequence;
  if (!silent) notify('正在同步共享棋局…');
  const incremental = !force && game && !archiveView;
  const query = incremental ? `?known=${game.id}.${game.revision}&after=${game.ply}` : '';
  try {
    const data = await api(`/current${query}`);
    if (sequence !== loadSequence) return;
    if (data.unchanged) {
      if (!game || data.gameId !== game.id || data.revision !== game.revision) throw new Error('棋局版本不一致，请重新同步。');
      game.canMove = data.canMove; game.waitingForOtherIp = data.waitingForOtherIp; stale = false;
      renderStatus();
    } else {
      const next = data.game;
      if (data.incremental && game && next.id === game.id) next.moves = [...game.moves, ...next.moves];
      const changed = game && (next.id !== game.id || next.revision !== game.revision);
      archiveView = false;
      applyGame(next);
      if (silent && changed) notify('其他访客已更新棋局，当前显示最新局面。', 'success');
    }
    syncedAt();
    if (!silent) notify(game.status === 'finished' ? '这盘棋已经结束，棋谱已保存在历史中。' : game.waitingForOtherIp ? '你的这一手已完成，等待其他访客接力。' : '共享棋局已同步。选择己方棋子，即可参与这一手。');
  } catch (error) {
    if (sequence !== loadSequence) return;
    stale = true; clearSelection(); render(); notify(error.message, 'error');
  }
}
function setView(ply) {
  if (!game || busy) return;
  viewPly = Math.max(0, Math.min(game.ply, ply));
  clearSelection(); closeChoices(); render();
}
async function returnLive() {
  if (busy) return;
  viewPly = null; archiveView = false;
  history.replaceState(null, '', location.pathname);
  await loadCurrent({ force: true });
}
function chooseSquare(square) {
  if (!canPlay()) {
    notify(archiveView || viewPly !== null ? '回看模式不能落子，请先回到当前棋局。' : game?.waitingForOtherIp ? '你已完成这一手，请等待其他 IP 的访客接力。' : '请先同步当前棋局。'); return;
  }
  const chess = new Chess(game.fen); const piece = chess.get(square);
  const candidates = legal.filter(move => move.to === square);
  if (selected && candidates.length) {
    const base = { gameId: game.id, revision: game.revision, from: selected, to: square };
    if (candidates.some(move => move.promotion)) {
      pendingMove = base;
      $('#promotion-options').replaceChildren();
      for (const type of ['q', 'r', 'b', 'n']) {
        const button = document.createElement('button'); button.type = 'button'; button.dataset.promotion = type;
        button.setAttribute('aria-label', `升变为${PIECE_NAMES[type]}`);
        button.append(pieceIcon(game.turn, type), document.createTextNode(PIECE_NAMES[type]));
        $('#promotion-options').append(button);
      }
      $('#promotion-dialog').showModal();
    } else considerMove(base);
    return;
  }
  if (piece?.color === game.turn) {
    selected = selected === square ? null : square;
    legal = selected ? chess.moves({ square, verbose: true }) : [];
    renderBoard();
    notify(selected ? `${colorName(piece.color)}${PIECE_NAMES[piece.type]} ${square}：${legal.length ? '请选择标记的合法落点。' : '当前没有合法走法。'}` : '已取消选择。');
  } else if (selected) notify('这一步不合法，请选择标记的落点，或选择其他己方棋子。');
}
function boardSquareAt(x, y) {
  const square = document.elementFromPoint(x, y)?.closest('[data-square]');
  return square && $('#chess-board').contains(square) ? square : null;
}
function startPointer(event) {
  if (pointerDrag || !event.isPrimary || event.button !== 0 || !canPlay() || pendingMove) return;
  const square = event.target.closest('[data-square]');
  if (!square) return;
  const piece = new Chess(game.fen).get(square.dataset.square);
  if (piece?.color !== game.turn) return;
  pointerDrag = { id: event.pointerId, from: square.dataset.square, piece, gameId: game.id, revision: game.revision,
    x: event.clientX, y: event.clientY, size: square.getBoundingClientRect().width, active: false, ghost: null };
}
function movePointer(event) {
  const drag = pointerDrag;
  if (!drag || drag.id !== event.pointerId) return;
  if (!canPlay() || game.id !== drag.gameId || game.revision !== drag.revision) { cancelDrag(); return; }
  if (!drag.active) {
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
    drag.active = true;
    selected = drag.from;
    legal = new Chess(game.fen).moves({ square: drag.from, verbose: true });
    renderBoard();
    const board = $('#chess-board');
    board.setPointerCapture(drag.id);
    board.classList.add('is-dragging');
    board.querySelector(`[data-square="${drag.from}"]`).classList.add('is-drag-source');
    document.body.classList.add('chess-dragging');
    const ghost = document.createElement('div');
    ghost.className = 'chess-drag-ghost';
    ghost.setAttribute('aria-hidden', 'true');
    ghost.style.width = `${drag.size}px`; ghost.style.height = `${drag.size}px`;
    ghost.append(pieceIcon(drag.piece.color, drag.piece.type));
    document.body.append(ghost); drag.ghost = ghost;
  }
  event.preventDefault();
  drag.ghost.style.left = `${event.clientX}px`; drag.ghost.style.top = `${event.clientY}px`;
  const board = $('#chess-board');
  board.querySelectorAll('.drag-over, .drag-invalid').forEach(square => square.classList.remove('drag-over', 'drag-invalid'));
  const target = boardSquareAt(event.clientX, event.clientY);
  if (target && target.dataset.square !== drag.from) target.classList.add(legal.some(move => move.to === target.dataset.square) ? 'drag-over' : 'drag-invalid');
}
function endPointer(event) {
  if (!pointerDrag || pointerDrag.id !== event.pointerId) return;
  const target = boardSquareAt(event.clientX, event.clientY);
  const drag = stopDrag();
  if (!drag.active) return; // A tap or a small mouse movement keeps the normal click behavior.
  event.preventDefault();
  if (!canPlay() || game.id !== drag.gameId || game.revision !== drag.revision) {
    clearSelection(); renderBoard(); return;
  }
  if (target && target.dataset.square !== drag.from && legal.some(move => move.to === target.dataset.square)) chooseSquare(target.dataset.square);
  else {
    clearSelection(); renderBoard();
    notify(target && target.dataset.square !== drag.from ? '落点不合法，棋子已归位。请选择标记的合法落点。' : '已取消拖动，没有落子。');
  }
}
function considerMove(candidate) {
  if (!game || candidate.gameId !== game.id || candidate.revision !== game.revision) { notify('棋局已改变，请重新同步后选择走法。', 'error'); return; }
  const chess = new Chess(game.fen); const move = chess.move(candidate);
  const positions = { [positionKey(game.initialFen)]: 1 };
  for (const item of game.moves) { const key = positionKey(item.fen); positions[key] = (positions[key] || 0) + 1; }
  const available = claims(chess.fen(), positionsAfter(positions, move, chess.fen()));
  if (available.length) {
    pendingMove = candidate;
    $('#draw-description').textContent = `拟走 ${move.san} 后可满足${available[0] === 'threefold' ? '三次重复局面' : '50 回合'}条件。声明和棋会立即结束本局，并且不实际执行这一步；也可以选择正常落子。`;
    $('#draw-dialog').showModal();
  } else submit('/move', candidate);
}
async function submit(path, body) {
  if (busy || !game || (path !== '/new' && !canPlay())) return;
  busy = true; ++loadSequence; closeChoices(); render();
  notify(path === '/new' ? '正在开启下一局…' : '正在提交，请等待服务器确认…');
  try {
    const data = await api(path, body);
    archiveView = false; viewPly = null;
    applyGame(data.game); syncedAt();
    history.replaceState(null, '', location.pathname);
    notify(game.status === 'finished' ? `${resultName(game.result)}，本局已归档。` : path === '/new' ? '新棋局已开启，白方先行。' : '落子成功，已交给下一位访客。', 'success');
  } catch (error) {
    await loadCurrent({ force: true, silent: true });
    notify(`${error.message}${!error.status ? ' 请核对同步后的最后一手，避免重复提交。' : ''}`, 'error');
  } finally { busy = false; render(); }
}
function renderArchives() {
  const list = $('#archive-list'); list.replaceChildren();
  if (!archiveGames.length) { const p = document.createElement('p'); p.className = 'chess-empty'; p.textContent = '还没有结束的对局。第一盘棋结束后，会自动保存在这里。'; list.append(p); }
  for (const entry of archiveGames) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'archive-item'; button.dataset.game = entry.id;
    if (archiveView && entry.id === game?.id) button.classList.add('is-current');
    const name = document.createElement('span'); name.textContent = `第 ${entry.id} 局`;
    const result = document.createElement('span'); result.textContent = entry.result === '1/2-1/2' ? '½–½' : entry.result.replace('-', '–');
    const meta = document.createElement('small'); meta.textContent = `${new Date(entry.finishedAt * 1000).toLocaleDateString('zh-CN')} · ${entry.ply} 手 · ${ENDINGS[entry.ending] || '已结束'}`;
    button.append(name, result, meta); list.append(button);
  }
  $('#more-history').hidden = !archiveCursor;
}
async function loadHistory(more = false) {
  const sequence = ++historySequence;
  const cursor = more ? archiveCursor : null;
  if (more && !cursor) return;
  $('#more-history').disabled = true;
  try {
    const data = await api(`/history${cursor ? `?before=${cursor}` : ''}`);
    if (sequence !== historySequence) return;
    if (!Array.isArray(data.games)) throw new Error('历史数据格式不正确');
    const combined = more ? [...archiveGames, ...data.games] : data.games;
    archiveGames = [...new Map(combined.map(entry => [entry.id, entry])).values()];
    archiveCursor = data.nextCursor;
    renderArchives();
  } catch (error) {
    if (!archiveGames.length) { $('#archive-list').replaceChildren(); const p = document.createElement('p'); p.className = 'chess-empty'; p.textContent = '历史暂时无法读取，点击右上角刷新重试。'; $('#archive-list').append(p); }
    if (more) notify(error.message, 'error');
  } finally { $('#more-history').disabled = false; }
}
async function viewGame(id) {
  if (busy) return;
  const sequence = ++loadSequence;
  notify(`正在读取第 ${id} 局…`);
  try {
    const data = await api(`/games/${id}`);
    if (sequence !== loadSequence) return;
    archiveView = true; viewPly = data.game.ply;
    applyGame(data.game); renderArchives();
    history.replaceState(null, '', `${location.pathname}?game=${game.id}`);
    notify(`正在回看第 ${game.id} 局，点击棋谱即可跳转到对应局面。`);
  } catch (error) { if (sequence === loadSequence) notify(error.message, 'error'); }
}
$('#chess-board').addEventListener('pointerdown', startPointer);
window.addEventListener('pointermove', movePointer, { passive: false });
window.addEventListener('pointerup', endPointer);
window.addEventListener('pointercancel', event => { if (pointerDrag?.id === event.pointerId) cancelDrag(); });
$('#chess-board').addEventListener('lostpointercapture', event => { if (event.target === $('#chess-board') && pointerDrag?.id === event.pointerId) cancelDrag(); });
$('#chess-board').addEventListener('dragstart', event => event.preventDefault());
$('#chess-board').addEventListener('click', event => {
  if (event.detail && performance.now() < suppressBoardClickUntil) { event.preventDefault(); return; }
  const button = event.target.closest('[data-square]'); if (button) chooseSquare(button.dataset.square);
});
$('#chess-board').addEventListener('keydown', event => {
  const buttons = [...$('#chess-board').children]; const index = buttons.indexOf(event.target);
  const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -8, ArrowDown: 8 }[event.key];
  if (offset && index >= 0) { event.preventDefault(); const next = buttons[Math.max(0, Math.min(63, index + offset))]; buttons.forEach(button => { button.tabIndex = button === next ? 0 : -1; }); next.focus(); }
});
$('#move-list').addEventListener('click', event => { const button = event.target.closest('[data-ply]'); if (button) setView(Number(button.dataset.ply)); });
$('#first-move').addEventListener('click', () => setView(0));
$('#previous-move').addEventListener('click', () => setView(shownPly() - 1));
$('#next-move').addEventListener('click', () => setView(shownPly() + 1));
$('#last-move').addEventListener('click', () => setView(game?.ply || 0));
$('#flip-board').addEventListener('click', () => { clearSelection(); flipped = !flipped; renderBoard(); });
$('#sync-game').addEventListener('click', () => { if (!busy) atLivePosition() ? loadCurrent({ force: true }) : returnLive(); });
$('#return-live').addEventListener('click', returnLive);
$('#promotion-options').addEventListener('click', event => { const choice = event.target.closest('[data-promotion]'); if (!choice || !pendingMove) return; const candidate = { ...pendingMove, promotion: choice.dataset.promotion }; $('#promotion-dialog').close(); pendingMove = null; considerMove(candidate); });
$('#cancel-promotion').addEventListener('click', closeChoices);
$('#cancel-draw').addEventListener('click', closeChoices);
$('#promotion-dialog').addEventListener('cancel', () => { pendingMove = null; });
$('#draw-dialog').addEventListener('cancel', () => { pendingMove = null; });
$('#declare-draw').addEventListener('click', () => { if (pendingMove) submit('/move', { ...pendingMove, claim: true }); });
$('#play-instead').addEventListener('click', () => { if (pendingMove) submit('/move', pendingMove); });
$('#claim-draw').addEventListener('click', () => { if (canPlay() && window.confirm('当前局面满足和棋声明条件。确定以和棋结束本局吗？')) submit('/claim', { gameId: game.id, revision: game.revision }); });
$('#new-game').addEventListener('click', () => { if (game?.status === 'finished' && !archiveView) submit('/new', { gameId: game.id, revision: game.revision }); });
$('#archive-list').addEventListener('click', event => { const button = event.target.closest('[data-game]'); if (button) viewGame(Number(button.dataset.game)); });
$('#more-history').addEventListener('click', () => loadHistory(true));
$('#refresh-history').addEventListener('click', () => loadHistory());
$('#download-pgn').addEventListener('click', () => {
  if (!game) return;
  const url = URL.createObjectURL(new Blob([exportPgn(game)], { type: 'application/x-chess-pgn;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `salieri-chess-${game.id}.pgn`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
document.addEventListener('visibilitychange', () => { if (document.hidden) cancelDrag(); else if (atLivePosition() && !busy && !pointerDrag) loadCurrent({ silent: true }); });
window.addEventListener('blur', cancelDrag);
window.addEventListener('focus', () => { if (!document.hidden && atLivePosition() && !busy && !pendingMove && !pointerDrag) loadCurrent({ silent: true }); });
render();
const requested = new URLSearchParams(location.search).get('game');
if (requested && /^[1-9]\d{0,14}$/.test(requested)) await viewGame(Number(requested));
else await loadCurrent({ force: true });
loadHistory();
setInterval(() => { if (!document.hidden && atLivePosition() && !busy && !pendingMove && !pointerDrag) loadCurrent({ silent: true }); }, 30000);
