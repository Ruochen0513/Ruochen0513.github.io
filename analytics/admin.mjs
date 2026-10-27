import { cleanConfig, ConfigError } from '../js/config-schema.mjs';

const SESSION_SECONDS = 8 * 60 * 60;
const ITERATIONS = 100_000;
const COOKIE = '__Host-salieri-admin';
class ValidationError extends Error {}
const encoder = new TextEncoder();
const hex = bytes => [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, '0')).join('');
const random = () => hex(crypto.getRandomValues(new Uint8Array(32)));
export const digest = async value => hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
const equal = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
};
export async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(salt), iterations: ITERATIONS }, key, 256));
}
function password(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) throw new ValidationError('密码需要 12–128 个字符');
  return value;
}
function response(data, status, origin, extra = {}) {
  return new Response(data === null ? null : JSON.stringify(data), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token',
    'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff', ...extra,
  } });
}
async function body(request) {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) throw new ValidationError('请使用 JSON 请求');
  if (Number(request.headers.get('Content-Length')) > 65536) throw new ValidationError('内容过大，请缩短后保存');
  // Bound chunked bodies too, before JSON parsing or password derivation.
  const reader = request.body?.getReader();
  if (!reader) throw new ValidationError('请求内容为空');
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 65536) { await reader.cancel(); throw new ValidationError('内容过大，请缩短后保存'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let value;
  try { value = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new ValidationError('请求内容格式不正确'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError('请求内容格式不正确');
  return value;
}
async function session(request, env, now) {
  const cookies = (request.headers.get('Cookie') || '').split(';').map(item => item.trim()).filter(item => item.startsWith(`${COOKIE}=`));
  if (cookies.length !== 1) return null;
  const token = cookies[0].slice(COOKIE.length + 1);
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  return env.DB.prepare('SELECT token_hash, csrf, expires_at FROM admin_sessions JOIN site_admin ON site_admin.id = 1 AND admin_sessions.auth_version = site_admin.auth_version WHERE token_hash = ? AND expires_at > ?').bind(await digest(token), now).first();
}
async function newSession(env, origin, now, version) {
  const token = random();
  const csrf = random();
  await env.DB.prepare('INSERT INTO admin_sessions(token_hash, csrf, auth_version, expires_at) VALUES (?, ?, ?, ?)').bind(await digest(token), csrf, version, now + SESSION_SECONDS).run();
  return response({ authenticated: true, csrf }, 200, origin, { 'Set-Cookie': `${COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}` });
}
async function limit(request, env, now) {
  const ip = request.headers.get('CF-Connecting-IP');
  if (!ip) return false;
  const key = await crypto.subtle.importKey('raw', encoder.encode(env.VISITOR_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bucket = hex(await crypto.subtle.sign('HMAC', key, encoder.encode(`admin-login:${ip}`)));
  const row = await env.DB.prepare(`INSERT INTO admin_attempts(bucket, attempts, reset_at) VALUES (?, 1, ?)
    ON CONFLICT(bucket) DO UPDATE SET
      attempts = CASE WHEN admin_attempts.reset_at <= ? THEN 1 ELSE admin_attempts.attempts + 1 END,
      reset_at = CASE WHEN admin_attempts.reset_at <= ? THEN excluded.reset_at ELSE admin_attempts.reset_at END
    RETURNING attempts`).bind(bucket, now + 900, now, now).first();
  return row.attempts <= 8;
}
export async function publicConfig(request, env) {
  const origin = request.headers.get('Origin') || '*';
  if (request.method === 'OPTIONS') return response(null, 204, origin);
  if (request.method !== 'GET') return response({ error: 'method_not_allowed' }, 405, origin);
  try {
    const row = await env.DB.prepare('SELECT config, revision, updated_at FROM site_content WHERE id = 1').first();
    return response({ version: 1, revision: row?.revision || 0, updatedAt: row?.updated_at || 0, config: cleanConfig(JSON.parse(row?.config || '{}')) }, 200, origin);
  } catch { return response({ error: 'service_unavailable' }, 503, origin); }
}
export async function admin(request, env, now = Math.floor(Date.now() / 1000)) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ADMIN_ORIGINS || 'https://salieri.site,https://www.salieri.site').split(',').map(value => value.trim());
  if (!origin || !allowed.includes(origin)) return response({ error: '来源不允许' }, 403, 'null');
  if (request.method === 'OPTIONS') return response(null, 204, origin);
  if (!env.DB || typeof env.VISITOR_SECRET !== 'string' || env.VISITOR_SECRET.length < 32) return response({ error: '管理服务未配置' }, 503, origin);
  const path = new URL(request.url).pathname;
  const known = ['/admin/status', '/admin/setup', '/admin/login', '/admin/logout', '/admin/config', '/admin/password'];
  if (!known.includes(path)) return response({ error: '接口不存在' }, 404, origin);
  try {
    const credentials = await env.DB.prepare('SELECT * FROM site_admin WHERE id = 1').first();
    const current = await session(request, env, now);
    if (path === '/admin/status' && request.method === 'GET') return response({ configured: !!credentials?.password_hash, setupAvailable: !credentials?.password_hash && !!credentials?.setup_hash && credentials.setup_expires > now, authenticated: !!current, ...(current ? { csrf: current.csrf } : {}) }, 200, origin);
    if (['/admin/login', '/admin/setup'].includes(path) && request.method === 'POST') {
      if (!await limit(request, env, now)) return response({ error: '尝试次数过多，请 15 分钟后再试' }, 429, origin, { 'Retry-After': '900' });
      const input = await body(request);
      if (path === '/admin/setup') {
        if (credentials?.password_hash) return response({ error: '密码已经设置，请登录' }, 409, origin);
        if (typeof input.token !== 'string' || input.token.length > 256 || !credentials?.setup_hash || credentials.setup_expires <= now || !equal(await digest(input.token), credentials.setup_hash)) return response({ error: '初始化码不正确或已过期' }, 401, origin);
        const chosen = password(input.password);
        const salt = random();
        const hash = await passwordHash(chosen, salt);
        const saved = await env.DB.prepare('UPDATE site_admin SET password_hash = ?, password_salt = ?, setup_hash = NULL, setup_expires = NULL, updated_at = ? WHERE id = 1 AND password_hash IS NULL AND setup_hash = ? AND setup_expires > ?').bind(hash, salt, now, credentials.setup_hash, now).run();
        if (!saved.meta.changes) return response({ error: '初始化状态已改变，请刷新页面' }, 409, origin);
      } else {
        if (typeof input.password !== 'string' || input.password.length > 128 || !credentials?.password_hash || !equal(await passwordHash(input.password, credentials.password_salt), credentials.password_hash)) return response({ error: '密码不正确' }, 401, origin);
      }
      return await newSession(env, origin, now, credentials.auth_version);
    }
    if (!current) return response({ error: '请先登录' }, 401, origin);
    if (path === '/admin/config' && request.method === 'GET') return publicConfig(request, env);
    if (!['POST', 'PUT'].includes(request.method)) return response({ error: '请求方法不允许' }, 405, origin);
    if (!equal(request.headers.get('X-CSRF-Token'), current.csrf)) return response({ error: '登录校验失效，请刷新后重试' }, 403, origin);
    if (path === '/admin/logout' && request.method === 'POST') {
      await env.DB.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').bind(current.token_hash).run();
      return response({ authenticated: false }, 200, origin, { 'Set-Cookie': `${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0` });
    }
    if (path === '/admin/password' && request.method === 'POST') {
      if (!await limit(request, env, now)) return response({ error: '尝试次数过多，请稍后重试' }, 429, origin, { 'Retry-After': '900' });
      const input = await body(request);
      if (typeof input.currentPassword !== 'string' || input.currentPassword.length > 128 || !equal(await passwordHash(input.currentPassword, credentials.password_salt), credentials.password_hash)) return response({ error: '当前密码不正确' }, 401, origin);
      const chosen = password(input.password);
      const salt = random();
      const changes = await env.DB.batch([
        env.DB.prepare('UPDATE site_admin SET password_hash = ?, password_salt = ?, auth_version = auth_version + 1, updated_at = ? WHERE id = 1 AND auth_version = ?').bind(await passwordHash(chosen, salt), salt, now, credentials.auth_version),
        env.DB.prepare('DELETE FROM admin_sessions WHERE auth_version <= ?').bind(credentials.auth_version),
      ]);
      if (!changes[0].meta.changes) return response({ error: '密码已在其他页面更改，请重新登录' }, 409, origin);
      return await newSession(env, origin, now, credentials.auth_version + 1);
    }
    if (path === '/admin/config' && request.method === 'PUT') {
      const input = await body(request);
      if (!Number.isSafeInteger(input.revision) || input.revision < 0) throw new ValidationError('配置版本不正确，请刷新页面');
      const config = cleanConfig(input.config);
      const json = JSON.stringify(config);
      if (encoder.encode(json).byteLength > 60000) throw new ValidationError('配置内容过大，请缩短后保存');
      const saved = await env.DB.prepare('UPDATE site_content SET config = ?, revision = revision + 1, updated_at = ? WHERE id = 1 AND revision = ? RETURNING revision').bind(json, now, input.revision).first();
      if (!saved) return response({ error: '配置已在其他页面更新，请先导出当前草稿，再重新载入最新内容' }, 409, origin);
      return response({ revision: saved.revision, updatedAt: now, config }, 200, origin);
    }
    return response({ error: '请求方法不允许' }, 405, origin);
  } catch (error) {
    // Only deliberate validation messages are exposed. Never log credentials or request bodies.
    if (error instanceof ConfigError || error instanceof ValidationError) return response({ error: error.message }, 400, origin);
    return response({ error: '服务暂时不可用，请稍后重试' }, 503, origin);
  }
}
export async function cleanupAdmin(env, now = Math.floor(Date.now() / 1000)) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').bind(now),
    env.DB.prepare('DELETE FROM admin_attempts WHERE reset_at <= ?').bind(now),
  ]);
}
