import { Chess, DEFAULT_POSITION } from '../assets/vendor/chess/chess.mjs';
export { Chess };
export const INITIAL_FEN = DEFAULT_POSITION;
export const positionKey = fen => fen.split(' ').slice(0, 4).join(' ');
export const ENDINGS = {
  checkmate: '将死', stalemate: '逼和', material: '子力不足', fivefold: '五次重复局面',
  'seventy-five': '75 回合规则', threefold: '三次重复局面声明', fifty: '50 回合规则声明',
};
export function claims(fen, positions) {
  const available = [];
  if ((positions[positionKey(fen)] || 0) >= 3) available.push('threefold');
  if (Number(fen.split(' ')[4]) >= 100) available.push('fifty');
  return available;
}
export function automaticResult(chess, positions) {
  if (chess.isCheckmate()) return { result: chess.turn() === 'w' ? '0-1' : '1-0', ending: 'checkmate' };
  if (chess.isStalemate()) return { result: '1/2-1/2', ending: 'stalemate' };
  if (chess.isInsufficientMaterial()) return { result: '1/2-1/2', ending: 'material' };
  if ((positions[positionKey(chess.fen())] || 0) >= 5) return { result: '1/2-1/2', ending: 'fivefold' };
  if (Number(chess.fen().split(' ')[4]) >= 150) return { result: '1/2-1/2', ending: 'seventy-five' };
  return null;
}
export function positionsAfter(positions, move, fen) {
  const next = move.piece === 'p' || move.captured ? {} : { ...positions };
  const key = positionKey(fen);
  next[key] = (next[key] || 0) + 1;
  return next;
}
export function exportPgn(game) {
  const date = new Date(game.createdAt * 1000).toISOString().slice(0, 10).replaceAll('-', '.');
  const headers = [['Event', 'Salieri Community Chess'], ['Site', 'https://salieri.site/chess/'], ['Date', date], ['Round', String(game.id)], ['White', 'Visitors'], ['Black', 'Visitors'], ['Result', game.result]];
  if (game.initialFen !== INITIAL_FEN) headers.push(['SetUp', '1'], ['FEN', game.initialFen]);
  const tokens = [];
  for (const move of game.moves) {
    if (move.color === 'w') tokens.push(`${move.number}.`);
    else if (!tokens.length) tokens.push(`${move.number}...`);
    tokens.push(move.san);
  }
  tokens.push(game.result);
  return `${headers.map(([key, value]) => `[${key} "${value}"]`).join('\n')}\n\n${tokens.join(' ')}\n`;
}
