const DAY = 86_400_000;
const BOT = /bot\b|crawler|spider|slurp|preview|facebookexternalhit|monitor|uptime|curl\//i;

function reply(data, status, origin, cache = false) {
  return new Response(data === null ? null : JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cache ? 'public, max-age=30' : 'no-store',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export function location(cf = {}) {
  const country = /^[A-Z]{2}$/.test(cf.country || '') && cf.country !== 'XX' ? cf.country : 'ZZ';
  const coordinate = (value, limit) => {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) && Math.abs(number) <= limit ? Math.round(number / 2) * 2 : null;
  };
  const latitude = coordinate(cf.latitude, 90);
  const longitude = coordinate(cf.longitude, 180);
  // Discard partial geolocation. Unknown coordinates never turn into a point at (0, 0).
  return { country, latitude: longitude === null ? null : latitude, longitude: latitude === null ? null : longitude };
}

export async function visitorId(ip, agent, secret) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const hash = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${ip}\n${agent.slice(0, 300)}`));
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function collect(request, env, now = Date.now()) {
  const ip = request.headers.get('CF-Connecting-IP');
  const agent = request.headers.get('User-Agent') || '';
  if (!ip || !agent || BOT.test(agent) || request.headers.get('DNT') === '1' || request.headers.get('Sec-GPC') === '1') return false;
  const visitor = await visitorId(ip, agent, env.VISITOR_SECRET);
  const { country, latitude, longitude } = location(request.cf);
  await env.DB.prepare(`
    INSERT INTO visits(day, visitor, country, latitude, longitude, views, last_seen)
    VALUES (?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(day, visitor) DO UPDATE SET
      views = visits.views + CASE WHEN excluded.last_seen - visits.last_seen >= 10 THEN 1 ELSE 0 END,
      last_seen = MAX(visits.last_seen, excluded.last_seen)
  `).bind(new Date(now).toISOString().slice(0, 10), visitor, country, latitude, longitude, Math.floor(now / 1000)).run();
  return true;
}

export async function stats(env, days = 30, now = Date.now()) {
  const since = new Date(now - (days - 1) * DAY).toISOString().slice(0, 10);
  const today = new Date(now).toISOString().slice(0, 10);
  const results = await env.DB.batch([
    env.DB.prepare(`SELECT COALESCE(SUM(views), 0) AS pageviews, COUNT(DISTINCT visitor) AS visitors,
      COUNT(DISTINCT CASE WHEN country != 'ZZ' THEN country END) AS countries,
      COALESCE(SUM(CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL THEN views ELSE 0 END), 0) AS mappedPageviews
      FROM visits WHERE day BETWEEN ? AND ?`).bind(since, today),
    env.DB.prepare(`SELECT country, latitude, longitude, SUM(views) AS views, COUNT(DISTINCT visitor) AS visitors
      FROM visits WHERE day BETWEEN ? AND ? AND latitude IS NOT NULL AND longitude IS NOT NULL
      GROUP BY country, latitude, longitude ORDER BY views DESC LIMIT 1000`).bind(since, today),
    env.DB.prepare(`SELECT country, SUM(views) AS views, COUNT(DISTINCT visitor) AS visitors
      FROM visits WHERE day BETWEEN ? AND ? GROUP BY country ORDER BY views DESC`).bind(since, today),
  ]);
  return { version: 1, days, updatedAt: new Date(now).toISOString(), totals: results[0].results[0], points: results[1].results, countries: results[2].results };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
    if (!origin || !allowed.includes(origin)) return reply({ error: 'origin_not_allowed' }, 403, 'null');
    const url = new URL(request.url);
    if (!['/visit', '/stats'].includes(url.pathname)) return reply({ error: 'not_found' }, 404, origin);
    if (request.method === 'OPTIONS') return reply(null, 204, origin);
    if (!env.DB || typeof env.VISITOR_SECRET !== 'string' || env.VISITOR_SECRET.length < 32) return reply({ error: 'not_configured' }, 503, origin);
    try {
      if (url.pathname === '/visit' && request.method === 'POST') {
        await collect(request, env);
        return reply(null, 204, origin);
      }
      if (url.pathname === '/stats' && request.method === 'GET') {
        const days = url.searchParams.get('days') === '7' ? 7 : 30;
        return reply(await stats(env, days), 200, origin, true);
      }
      return reply({ error: 'method_not_allowed' }, 405, origin);
    } catch {
      // Do not log requests, IP addresses, hashes, or database errors.
      return reply({ error: 'service_unavailable' }, 503, origin);
    }
  },
  async scheduled(_event, env) {
    const cutoff = new Date(Date.now() - 90 * DAY).toISOString().slice(0, 10);
    await env.DB.prepare('DELETE FROM visits WHERE day < ?').bind(cutoff).run();
  },
};
