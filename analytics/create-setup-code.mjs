// Run locally with your own Wrangler login. Only a hash of the one-time code is sent to D1.
import { randomBytes, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const reset = process.argv.includes('--reset-password');
const token = randomBytes(32).toString('base64url');
const hash = createHash('sha256').update(token).digest('hex');
const expires = Math.floor(Date.now() / 1000) + 86400;
const sql = reset
  ? `INSERT INTO site_admin(id, setup_hash, setup_expires) VALUES(1, '${hash}', ${expires}) ON CONFLICT(id) DO UPDATE SET password_hash=NULL, password_salt=NULL, auth_version=site_admin.auth_version+1, setup_hash=excluded.setup_hash, setup_expires=excluded.setup_expires RETURNING id; DELETE FROM admin_sessions;`
  : `INSERT INTO site_admin(id, setup_hash, setup_expires) VALUES(1, '${hash}', ${expires}) ON CONFLICT(id) DO UPDATE SET setup_hash=excluded.setup_hash, setup_expires=excluded.setup_expires WHERE site_admin.password_hash IS NULL RETURNING id;`;
const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const run = spawnSync(command, ['--yes', 'wrangler@4.153.0', 'd1', 'execute', 'salieri-visitors', '--remote', '--command', sql, '--json'], { cwd: fileURLToPath(new URL('.', import.meta.url)), env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, encoding: 'utf8', timeout: 120000 });
if (run.status !== 0) { console.error('生成初始化码失败。请确认 Wrangler 已登录且数据库迁移已完成。'); process.exit(1); }
let result;
try { result = JSON.parse(run.stdout); } catch { console.error('无法确认数据库返回结果，未输出初始化码。'); process.exit(1); }
if (!Array.isArray(result) || !result.some(item => item.success && item.results?.some(row => row.id === 1))) { console.error('管理员密码已经设置，未修改已有账号。确需找回密码时，由站点所有者运行本脚本并添加 --reset-password。'); process.exit(1); }
if (process.argv.includes('--json')) console.log(JSON.stringify({ token, expiresAt: new Date(expires * 1000).toISOString() }));
else console.log(`配置页：https://salieri.site/config/\n一次性初始化码：${token}\n有效期：24 小时，设置密码后立即失效。请勿分享。`);
