// Original SVG geometry, shared by board squares and promotion choices.
const shapes = {
  p: [['circle', { cx: 32, cy: 16, r: 8 }], ['path', { d: 'M25 25h14l-3 8c0 8 4 11 8 16H20c4-5 8-8 8-16z' }]],
  r: [['path', { d: 'M18 10h7v7h7v-7h7v7h7v-7h3v17l-7 6 2 15H20l2-15-7-6V10z' }], ['path', { d: 'M22 28h20', fill: 'none' }]],
  n: [['path', { d: 'M20 47c0-12 6-17 16-23l-7-3-10 8-7-7 9-11 13-4-1-5 10 6c12 12 10 25 4 39z' }], ['path', { d: 'M25 15h1M35 19c7 3 8 9 3 14', fill: 'none' }]],
  b: [['path', { d: 'M29 5c-3 6-12 11-12 20 0 7 6 12 12 13l-6 10h18l-6-10c7-2 12-6 12-13 0-9-9-14-12-20z' }], ['path', { d: 'M38 14 27 29', fill: 'none' }], ['path', { d: 'M22 39h20', fill: 'none' }]],
  q: [['path', { d: 'm16 18 8 10 8-14 8 14 8-10-7 24H23z' }], ['circle', { cx: 15, cy: 14, r: 4 }], ['circle', { cx: 32, cy: 10, r: 4 }], ['circle', { cx: 49, cy: 14, r: 4 }], ['path', { d: 'M23 44h18l4 5H19z' }]],
  k: [['path', { d: 'M29 3h6v6h6v6h-6v7h-6v-7h-6V9h6z' }], ['path', { d: 'M31 24c-4-10-17-5-17 3 0 9 9 11 10 19h16c1-8 10-10 10-19 0-8-13-13-17-3z' }], ['path', { d: 'M24 39h16M23 45h18', fill: 'none' }]],
};
export const PIECE_NAMES = { p: '兵', r: '车', n: '马', b: '象', q: '后', k: '王' };
export function pieceIcon(color, piece) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('class', `chess-piece chess-piece--${color}`);
  svg.setAttribute('aria-hidden', 'true');
  const geometry = [...shapes[piece], ['path', { d: 'M18 50h28l3 7H15z' }]];
  for (const [tag, attributes] of geometry) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    svg.append(element);
  }
  return svg;
}
