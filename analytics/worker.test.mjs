import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker, { collect, stats, visitorId, location } from './worker.mjs';

function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('./migrations/0001_visits.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('./migrations/0002_site_config.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('./migrations/0003_community_chess.sql', import.meta.url), 'utf8'));
  const prepare = sql => {
    let values = [];
    const statement = {
      bind(...args) { values = args; return statement; },
      async run() { sqlite.prepare(sql).run(...values); return { success: true }; },
      all() { return { success: true, results: sqlite.prepare(sql).all(...values).map(row => ({ ...row })) }; },
    };
    return statement;
  };
  return { sqlite, prepare, async batch(statements) { return statements.map(item => item.all()); } };
}
const now = Date.UTC(2026, 9, 27, 12);
function setup() { return { DB: database(), VISITOR_SECRET: 'a-secure-test-secret-at-least-32-characters', ALLOWED_ORIGINS: 'https://salieri.site' }; }
function request({ ip = '203.0.113.10', agent = 'Mozilla/5.0 test', cf = { country: 'CN', latitude: '39.13', longitude: '117.20' }, headers = {}, url = '/visit', method = 'POST' } = {}) {
  const result = new Request(`https://analytics.example${url}`, { method, headers: { Origin: 'https://salieri.site', 'CF-Connecting-IP': ip, 'User-Agent': agent, ...headers } });
  Object.defineProperty(result, 'cf', { value: cf });
  return result;
}

test('deduplicates visitors across dates while counting repeat page views and excluding rapid retries', async () => {
  const env = setup();
  await collect(request(), env, now);
  await collect(request(), env, now + 1000);
  await collect(request(), env, now + 11_000);
  await collect(request(), env, now + 86_400_000);
  await collect(request({ ip: '203.0.113.11' }), env, now);
  const data = await stats(env, 30, now + 86_400_000);
  assert.equal(data.totals.visitors, 2);
  assert.equal(data.totals.pageviews, 4);
  assert.equal(data.points[0].visitors, 2);
  assert.equal(data.totals.countries, 1);
  env.DB.sqlite.close();
});

test('uses trusted Cloudflare geolocation, leaves unknown coordinates off the map, and never persists raw IP', async () => {
  const env = setup();
  await collect(request({ cf: { country: 'US' }, headers: { 'X-Country': 'CN', 'X-Latitude': '39' } }), env, now);
  const data = await stats(env, 30, now);
  assert.equal(data.totals.pageviews, 1);
  assert.equal(data.totals.mappedPageviews, 0);
  assert.deepEqual(data.points, []);
  assert.equal(data.countries[0].country, 'US');
  const row = env.DB.sqlite.prepare('SELECT * FROM visits').get();
  assert.equal(row.latitude, null);
  assert.match(row.visitor, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(row).includes('203.0.113.10'));
  assert.ok(!JSON.stringify(data).includes(row.visitor));
  assert.deepEqual(location({ country: 'XX', latitude: '', longitude: '0' }), { country: 'ZZ', latitude: null, longitude: null });
  assert.deepEqual(location({ country: 'CN', latitude: '39.13', longitude: '117.20' }), { country: 'CN', latitude: 40, longitude: 118 });
  env.DB.sqlite.close();
});

test('supports independent 7 and 30 day windows, excludes future/old records, and counts unknown regions honestly', async () => {
  const env = setup();
  await collect(request(), env, now - 10 * 86_400_000);
  await collect(request({ ip: '203.0.113.11', cf: {} }), env, now);
  await collect(request({ ip: '203.0.113.12' }), env, now + 86_400_000);
  await collect(request({ ip: '203.0.113.13' }), env, now - 40 * 86_400_000);
  assert.equal((await stats(env, 7, now)).totals.visitors, 1);
  const data = await stats(env, 30, now);
  assert.equal(data.totals.visitors, 2);
  assert.equal(data.totals.countries, 1);
  assert.equal(data.totals.mappedPageviews, 1);
  env.DB.sqlite.close();
});

test('honors DNT/GPC and ignores known bot agents', async () => {
  const env = setup();
  for (const req of [request({ headers: { DNT: '1' } }), request({ headers: { 'Sec-GPC': '1' } }), request({ agent: 'Googlebot/2.1' }), request({ agent: 'curl/8.0' }), request({ ip: '' })]) {
    assert.equal(await collect(req, env, now), false);
  }
  assert.equal((await stats(env, 30, now)).totals.pageviews, 0);
  env.DB.sqlite.close();
});

test('requires an exact allowed Origin, handles preflight, and fails closed without the secret', async () => {
  const env = setup();
  for (const origin of ['https://salieri.site.attacker.example', 'null', '']) {
    assert.equal((await worker.fetch(request({ headers: { Origin: origin } }), env)).status, 403);
  }
  const options = await worker.fetch(request({ method: 'OPTIONS' }), env);
  assert.equal(options.status, 204);
  assert.equal(options.headers.get('Access-Control-Allow-Origin'), 'https://salieri.site');
  assert.equal((await worker.fetch(request(), { ...env, VISITOR_SECRET: '' })).status, 503);
  assert.equal((await worker.fetch(request({ method: 'GET', url: '/visit' }), env)).status, 405);
  const result = await worker.fetch(request({ method: 'GET', url: '/stats?days=7' }), env);
  assert.equal(result.status, 200);
  assert.equal((await result.json()).days, 7);
  env.DB.sqlite.close();
});

test('retention deletes records older than 90 days', async () => {
  const env = setup();
  await collect(request(), env, Date.now() - 100 * 86_400_000);
  await collect(request({ ip: '203.0.113.11' }), env, Date.now());
  await worker.scheduled({}, env);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS count FROM visits').get().count, 1);
  env.DB.sqlite.close();
});

test('visitor hashes are keyed and cannot be computed from IP alone', async () => {
  const first = await visitorId('203.0.113.10', 'Mozilla/5.0', 'secret-a');
  const second = await visitorId('203.0.113.10', 'Mozilla/5.0', 'secret-b');
  assert.notEqual(first, second);
  assert.equal(first, await visitorId('203.0.113.10', 'Mozilla/5.0', 'secret-a'));
});
