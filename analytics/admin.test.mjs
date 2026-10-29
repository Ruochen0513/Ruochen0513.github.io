import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { admin, publicConfig, digest, passwordHash, cleanupAdmin } from './admin.mjs';
import { cleanConfig, editableConfig } from '../js/config-schema.mjs';
import worker from './worker.mjs';

const now = 1_793_100_000;
const testPassword = 'test-only-long-password-2026';
const bootstrap = 'test-only-initialization-code-with-enough-entropy';
const origin = 'https://salieri.site';
function database() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of ['0001_visits.sql', '0002_site_config.sql', '0003_community_chess.sql']) sqlite.exec(readFileSync(new URL(`./migrations/${file}`, import.meta.url), 'utf8'));
  const prepare = sql => {
    let values = [];
    const statement = {
      bind(...args) { values = args; return statement; },
      async run() { const result = sqlite.prepare(sql).run(...values); return { success: true, meta: { changes: Number(result.changes) } }; },
      all() { const results = sqlite.prepare(sql).all(...values).map(row => ({ ...row })); return { success: true, results, meta: { changes: sqlite.prepare('SELECT changes() AS n').get().n } }; },
      async first() { return statement.all().results[0] || null; },
    };
    return statement;
  };
  return { sqlite, prepare, async batch(items) {
    sqlite.exec('BEGIN');
    try { const results = items.map(item => item.all()); sqlite.exec('COMMIT'); return results; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } };
}
function env() { return { DB: database(), VISITOR_SECRET: 'server-test-secret-that-is-at-least-32-characters', ALLOWED_ORIGINS: origin }; }
function request(path, { method = 'GET', data, cookie, csrf, headers = {} } = {}) {
  return new Request(`https://stats.salieri.site${path}`, { method, headers: { Origin: origin, 'CF-Connecting-IP': '203.0.113.1', ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...headers }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) });
}
async function prepareSetup(e, expiry = now + 86400) { await e.DB.prepare('INSERT INTO site_admin(id, setup_hash, setup_expires) VALUES (1, ?, ?)').bind(await digest(bootstrap), expiry).run(); }
async function initialized() {
  const e = env();
  await prepareSetup(e);
  const response = await admin(request('/admin/setup', { method: 'POST', data: { token: bootstrap, password: testPassword } }), e, now);
  assert.equal(response.status, 200);
  return { e, cookie: response.headers.get('set-cookie').split(';')[0], csrf: (await response.json()).csrf };
}
function baseline() {
  const sandbox = { window: {} };
  vm.runInNewContext(readFileSync(new URL('../js/config.js', import.meta.url), 'utf8'), sandbox);
  return editableConfig(JSON.parse(JSON.stringify(sandbox.window.PLAYER_HOME_CONFIG)));
}

test('public configuration defaults are readable while admin writes require an authenticated session and exact Origin', async () => {
  const e = env();
  assert.deepEqual((await (await publicConfig(request('/site-config'), e)).json()).config, {});
  assert.equal((await admin(request('/admin/config', { method: 'PUT', data: { config: {}, revision: 0 }, csrf: 'fake' }), e, now)).status, 401);
  for (const forbidden of ['', 'null', 'https://salieri.site.attacker.example', 'https://ruochen0513.github.io']) assert.equal((await admin(request('/admin/status', { headers: { Origin: forbidden } }), e, now)).status, 403);
  assert.equal((await admin(request('/admin/status', { method: 'OPTIONS' }), e, now)).status, 204);
  assert.equal((await admin(request('/admin/status'), { ...e, VISITOR_SECRET: '' }, now)).status, 503);
  assert.equal((await admin(request('/admin/missing'), e, now)).status, 404);
  e.DB.sqlite.close();
});
test('initialization requires a live one-time code, hashes passwords, consumes the code, and uses secure session cookies', async () => {
  const e = env();
  await prepareSetup(e);
  const initial = await (await admin(request('/admin/status'), e, now)).json();
  assert.equal(initial.setupAvailable, true);
  assert.equal((await admin(request('/admin/setup', { method: 'POST', data: { token: 'incorrect', password: testPassword } }), e, now)).status, 401);
  assert.equal((await admin(request('/admin/setup', { method: 'POST', data: { token: bootstrap, password: 'short' } }), e, now)).status, 400);
  const response = await admin(request('/admin/setup', { method: 'POST', data: { token: bootstrap, password: testPassword } }), e, now);
  assert.equal(response.status, 200);
  const setCookie = response.headers.get('set-cookie');
  for (const flag of ['__Host-salieri-admin=', 'Secure', 'HttpOnly', 'SameSite=Strict', 'Path=/']) assert.ok(setCookie.includes(flag));
  const row = e.DB.sqlite.prepare('SELECT * FROM site_admin').get();
  assert.equal(row.setup_hash, null);
  assert.notEqual(row.password_hash, testPassword);
  assert.equal(row.password_hash, await passwordHash(testPassword, row.password_salt));
  const token = setCookie.split(';')[0].split('=')[1];
  assert.notEqual(e.DB.sqlite.prepare('SELECT token_hash FROM admin_sessions').get().token_hash, token);
  assert.equal((await admin(request('/admin/setup', { method: 'POST', data: { token: bootstrap, password: testPassword } }), e, now)).status, 409);
  assert.ok(!JSON.stringify(await (await publicConfig(request('/site-config'), e)).json()).includes(row.password_hash));
  e.DB.sqlite.close();
});
test('expired initialization and concurrent reuse cannot create or replace credentials', async () => {
  const expired = env(); await prepareSetup(expired, now - 1);
  assert.equal((await admin(request('/admin/setup', { method: 'POST', data: { token: bootstrap, password: testPassword } }), expired, now)).status, 401);
  assert.equal((await (await admin(request('/admin/status'), expired, now)).json()).setupAvailable, false);
  const e = env(); await prepareSetup(e);
  const results = await Promise.all([1, 2].map(() => admin(request('/admin/setup', { method: 'POST', data: { token: bootstrap, password: testPassword } }), e, now)));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  expired.DB.sqlite.close(); e.DB.sqlite.close();
});
test('publishing requires CSRF, validates links and schema, handles empty project lists, and rejects stale writes', async () => {
  const { e, cookie, csrf } = await initialized();
  const config = baseline();
  config.projects = [];
  const write = (content, version = 0, token = csrf) => admin(request('/admin/config', { method: 'PUT', data: { revision: version, config: content }, cookie, csrf: token }), e, now);
  assert.equal((await write(config, 0, '')).status, 403);
  const unsafe = baseline(); unsafe.socials[0].url = 'javascript:alert(1)';
  assert.equal((await write(unsafe)).status, 400);
  assert.equal((await write({ visitors: { endpoint: 'https://attacker.example' } })).status, 400);
  assert.equal((await write(JSON.parse('{"__proto__":{"admin":true}}'))).status, 400);
  const simultaneous = await Promise.all([write(config), write(config)]);
  assert.deepEqual(simultaneous.map(r => r.status).sort(), [200, 409]);
  const published = await (await publicConfig(request('/site-config'), e)).json();
  assert.equal(published.revision, 1);
  assert.deepEqual(published.config.projects, []);
  assert.equal(published.config.profile.nickname, config.profile.nickname);
  assert.equal((await write(config, 0)).status, 409);
  e.DB.sqlite.close();
});
test('sessions expire and logout invalidates the server session', async () => {
  const { e, cookie, csrf } = await initialized();
  const status = await (await admin(request('/admin/status', { cookie }), e, now)).json();
  assert.equal(status.authenticated, true); assert.equal(status.csrf, csrf);
  assert.equal((await admin(request('/admin/config', { cookie }), e, now + 8 * 3600 + 1)).status, 401);
  assert.equal((await admin(request('/admin/logout', { method: 'POST', cookie, csrf }), e, now)).status, 200);
  assert.equal((await admin(request('/admin/config', { cookie }), e, now)).status, 401);
  e.DB.sqlite.close();
});
test('password rotation requires the current password and invalidates every older session generation', async () => {
  const { e, cookie, csrf } = await initialized();
  const next = 'another-test-only-long-password';
  assert.equal((await admin(request('/admin/password', { method: 'POST', cookie, csrf, data: { currentPassword: 'wrong', password: next } }), e, now)).status, 401);
  const result = await admin(request('/admin/password', { method: 'POST', cookie, csrf, data: { currentPassword: testPassword, password: next } }), e, now);
  assert.equal(result.status, 200);
  const nextCookie = result.headers.get('set-cookie').split(';')[0];
  assert.equal((await admin(request('/admin/config', { cookie }), e, now)).status, 401);
  assert.equal((await admin(request('/admin/config', { cookie: nextCookie }), e, now)).status, 200);
  assert.equal((await admin(request('/admin/login', { method: 'POST', data: { password: testPassword } }), e, now)).status, 401);
  assert.equal((await admin(request('/admin/login', { method: 'POST', data: { password: next } }), e, now)).status, 200);
  const lateToken = 'a'.repeat(64);
  await e.DB.prepare('INSERT INTO admin_sessions(token_hash, csrf, auth_version, expires_at) VALUES (?, ?, 1, ?)').bind(await digest(lateToken), 'stale', now + 3600).run();
  assert.equal((await admin(request('/admin/config', { cookie: `__Host-salieri-admin=${lateToken}` }), e, now)).status, 401);
  e.DB.sqlite.close();
});
test('login attempts are limited atomically by a keyed IP hash and expire after the retry window', async () => {
  const e = env(); await prepareSetup(e);
  for (let i = 0; i < 8; i++) assert.equal((await admin(request('/admin/login', { method: 'POST', data: { password: 'incorrect' } }), e, now)).status, 401);
  const blocked = await admin(request('/admin/login', { method: 'POST', data: { password: 'incorrect' } }), e, now);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('Retry-After'), '900');
  assert.ok(!JSON.stringify(e.DB.sqlite.prepare('SELECT * FROM admin_attempts').all()).includes('203.0.113.1'));
  assert.equal((await admin(request('/admin/login', { method: 'POST', data: { password: 'incorrect' } }), e, now + 901)).status, 401);
  await cleanupAdmin(e, now + 2000);
  assert.equal(e.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM admin_attempts').get().n, 0);
  e.DB.sqlite.close();
});
test('oversized and malformed payloads are rejected without publishing; visitor routes remain independent', async () => {
  const { e, cookie, csrf } = await initialized();
  const malformed = new Request('https://stats.salieri.site/admin/config', { method: 'PUT', headers: { Origin: origin, Cookie: cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' }, body: '{' });
  assert.equal((await admin(malformed, e, now)).status, 400);
  assert.equal((await admin(request('/admin/config', { method: 'PUT', cookie, csrf, data: { config: { tooMuch: 'x'.repeat(66000) }, revision: 0 } }), e, now)).status, 400);
  const visit = new Request('https://stats.salieri.site/visit', { method: 'POST', headers: { Origin: origin, 'CF-Connecting-IP': '203.0.113.2', 'User-Agent': 'Mozilla/5.0 integration' } });
  assert.equal((await worker.fetch(visit, e)).status, 204);
  assert.equal((await worker.fetch(request('/stats?days=7'), e)).status, 200);
  e.DB.sqlite.close();
});
test('editable defaults pass the schema while duplicate projects, malformed lists, and unsafe colors fail', () => {
  const defaults = baseline(); assert.ok(defaults.projects.length);
  const duplicate = baseline(); duplicate.projects.push(duplicate.projects[0]); assert.throws(() => cleanConfig(duplicate));
  const colors = baseline(); colors.crosshairs[0].previewColor = 'url(x)'; assert.throws(() => cleanConfig(colors));
  const missing = baseline(); missing.socials.pop(); assert.throws(() => cleanConfig(missing));
  assert.deepEqual(cleanConfig({ projects: [] }).projects, []);
});
