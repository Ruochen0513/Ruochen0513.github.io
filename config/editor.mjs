import { PROFILE_FIELDS, SOCIAL_KEYS, GEAR_KEYS, CROSSHAIR_KEYS, SECTION_LABELS, cleanConfig, editableConfig, mergeEditable } from '../js/config-schema.mjs';

const $ = selector => document.querySelector(selector);
const defaults = editableConfig(window.PLAYER_HOME_CONFIG);
const endpoint = window.PLAYER_HOME_CONFIG.visitors.endpoint.replace(/\/$/, '');
const notice = $('#notice');
let csrf = '';
let revision = 0;
let dirty = false;
let loaded = false;
let setupMode = false;
let busy = false;

function tell(message, kind = '') {
  notice.textContent = message;
  notice.dataset.kind = kind;
}
function changed(value = true) {
  dirty = value;
  $('#save-state').textContent = value ? '有未发布的修改' : '内容已同步';
}
async function api(path, { method = 'GET', data, authenticated = false } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`${endpoint}${path}`, {
      method, credentials: 'include', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal,
      headers: { ...(data ? { 'Content-Type': 'application/json' } : {}), ...(authenticated ? { 'X-CSRF-Token': csrf } : {}) },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401 && ['/admin/config', '/admin/logout'].includes(path)) showAuth({ configured: true });
      throw new Error(result.error || '请求失败，请稍后重试');
    }
    return result;
  } catch (error) {
    if (error.name === 'AbortError' || error instanceof TypeError) throw new Error('无法连接配置服务，请检查网络后重试');
    throw error;
  } finally { clearTimeout(timeout); }
}
function showAuth(status) {
  csrf = '';
  setupMode = !status.configured && status.setupAvailable;
  $('#editor-panel').hidden = true;
  $('#auth-panel').hidden = false;
  $('#auth-title').textContent = setupMode ? '设置你的管理密码' : '登录配置中心';
  $('#auth-description').textContent = setupMode ? '首次使用需要一次性初始化码。完成后，只有你设置的密码可以登录。' : '输入管理密码，编辑并发布你的主页内容。';
  $('#setup-code-label').hidden = !setupMode;
  $('#setup-code').required = setupMode;
  $('#confirm-label').hidden = !setupMode;
  $('#confirm-password').required = setupMode;
  $('#password').minLength = setupMode ? 12 : 1;
  $('#password').autocomplete = setupMode ? 'new-password' : 'current-password';
  $('#password-label').textContent = setupMode ? '设置管理密码（12–128 个字符）' : '管理密码';
  $('#auth-submit').textContent = setupMode ? '设置密码并进入' : '登录';
  $('#auth-submit').disabled = !status.configured && !setupMode;
  if (!status.configured && !setupMode) tell('管理密码尚未初始化，或初始化码已过期。请联系站点维护者生成新的初始化码。', 'error');
}
function field(container, name, label, value, { type = 'text', max = 160, wide = false, required = false, hint = '' } = {}) {
  const wrapper = document.createElement('label');
  if (wide) wrapper.className = 'field-wide';
  const caption = document.createElement('span');
  caption.textContent = label;
  const control = document.createElement(type === 'textarea' ? 'textarea' : 'input');
  if (type !== 'textarea') control.type = type;
  control.dataset.field = name;
  control.name = name;
  control.maxLength = max;
  control.required = required;
  control.value = value || '';
  if (['url', 'color'].includes(type) || name === 'repo' || name === 'code') control.spellcheck = false;
  if (hint) control.placeholder = hint;
  wrapper.append(caption, control);
  container.append(wrapper);
  return control;
}
function item(container, title, key) {
  const card = document.createElement('div');
  card.className = 'editor-item';
  card.dataset.key = key;
  const heading = document.createElement('h3');
  heading.textContent = title;
  const fields = document.createElement('div');
  fields.className = 'editor-fields';
  card.append(heading, fields);
  container.append(card);
  return fields;
}
function readFields(container) {
  return Object.fromEntries([...container.querySelectorAll('[data-field]')].map(control => [control.dataset.field, control.value]));
}
function readList(container) {
  return [...container.children].map(card => ({ key: card.dataset.key, ...readFields(card) }));
}
function projectCard(project) {
  const card = document.createElement('article');
  card.className = 'editor-item';
  card.dataset.project = '';
  const head = document.createElement('div');
  head.className = 'editor-item-head';
  const title = document.createElement('h3');
  const tools = document.createElement('div');
  tools.className = 'project-tools';
  for (const [action, label] of [['up', '上移'], ['down', '下移'], ['delete', '删除']]) {
    const button = document.createElement('button');
    button.className = 'config-quiet-button';
    button.type = 'button';
    button.dataset.action = action;
    button.textContent = label;
    tools.append(button);
  }
  head.append(title, tools);
  const fields = document.createElement('div');
  fields.className = 'editor-fields';
  field(fields, 'repo', 'GitHub 仓库', project.repo, { max: 180, required: true, hint: 'Ruochen0513/GPT-Usage-Indicator' });
  field(fields, 'name', '项目名称', project.name, { max: 120 });
  field(fields, 'category', '分类标签', project.category, { max: 60, wide: true, hint: 'DESKTOP UTILITY' });
  field(fields, 'description', '项目介绍', project.description, { max: 1600, type: 'textarea', wide: true });
  field(fields, 'highlights', '项目亮点（每行一条，最多 10 条）', project.highlights.join('\n'), { max: 3009, type: 'textarea', wide: true });
  field(fields, 'tags', '技术标签（逗号分隔，最多 12 个）', project.tags.join(', '), { max: 502, wide: true, hint: 'Python, GNOME, Windows' });
  card.append(head, fields);
  $('#project-fields').append(card);
  updateProjects();
  return card;
}
function updateProjects() {
  const cards = [...$('#project-fields').children];
  cards.forEach((card, index) => {
    card.querySelector('h3').textContent = `项目 ${String(index + 1).padStart(2, '0')}`;
    card.querySelector('[data-action="up"]').disabled = index === 0;
    card.querySelector('[data-action="down"]').disabled = index === cards.length - 1;
  });
  $('#add-project').disabled = cards.length >= 20;
  $('#projects-empty').hidden = cards.length > 0;
}
function populate(input) {
  const config = mergeEditable(defaults, input);
  for (const id of ['profile-fields', 'overview-fields', 'social-fields', 'gear-fields', 'project-fields', 'crosshair-fields', 'section-fields']) $(`#${id}`).replaceChildren();
  for (const [key, [label, max]] of Object.entries(PROFILE_FIELDS)) field($('#profile-fields'), key, label, config.profile[key], { max, type: key === 'bio' ? 'textarea' : key === 'email' ? 'email' : 'text', wide: key === 'bio', required: key === 'nickname' });
  for (const [key, heading] of [['location', '第一组'], ['status', '第二组'], ['focus', '第三组']]) {
    const parent = item($('#overview-fields'), heading, key);
    field(parent, 'label', '标题', config.quickStats[key].label, { max: 30 });
    field(parent, 'value', '内容', config.quickStats[key].value, { max: 60 });
  }
  for (const key of SOCIAL_KEYS) {
    const entry = config.socials.find(value => value.key === key);
    const parent = item($('#social-fields'), entry.name || key, key);
    for (const [name, label, max] of [['id', '编号', 8], ['icon', '图标文字', 8], ['name', '平台名称', 40], ['subtitle', '副标题', 60], ['handle', '显示文字', 80]]) field(parent, name, label, entry[name], { max });
    field(parent, 'url', '主页链接', entry.url, { type: 'url', max: 1000, wide: true });
  }
  for (const key of GEAR_KEYS) {
    const entry = config.gear.find(value => value.key === key);
    const parent = item($('#gear-fields'), entry.name || key, key);
    for (const [name, label, max] of [['name', '外设名称', 40], ['model', '设备型号', 160], ['metaLabel', '参数名称', 40], ['metaValue', '参数内容', 160]]) field(parent, name, label, entry[name], { max });
  }
  config.projects.forEach(projectCard);
  updateProjects();
  for (const key of CROSSHAIR_KEYS) {
    const entry = config.crosshairs.find(value => value.key === key);
    const parent = item($('#crosshair-fields'), entry.name || key, key);
    for (const [name, label, max] of [['name', '准星名称', 60], ['tabLabel', '标签名称', 40], ['color', '颜色说明', 40], ['outline', '描边说明', 40], ['center', '中心点说明', 40]]) field(parent, name, label, entry[name], { max });
    field(parent, 'previewColor', '预览颜色', entry.previewColor, { type: 'color', max: 7 });
    field(parent, 'code', '分享代码', entry.code, { type: 'textarea', max: 1600, wide: true });
  }
  for (const [key, label] of Object.entries(SECTION_LABELS)) {
    const wrapper = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.section = key;
    checkbox.checked = config.sections?.[key] !== false;
    wrapper.append(checkbox, document.createTextNode(label));
    $('#section-fields').append(wrapper);
  }
}
function readDraft() {
  const projects = [...$('#project-fields').children].map(card => {
    const entry = readFields(card);
    entry.highlights = entry.highlights.split('\n').map(value => value.trim()).filter(Boolean);
    entry.tags = entry.tags.split(/[,，]/).map(value => value.trim()).filter(Boolean);
    return entry;
  });
  return cleanConfig({
    profile: readFields($('#profile-fields')),
    quickStats: Object.fromEntries(readList($('#overview-fields')).map(({ key, ...entry }) => [key, entry])),
    socials: readList($('#social-fields')), gear: readList($('#gear-fields')), projects,
    crosshairs: readList($('#crosshair-fields')),
    sections: Object.fromEntries([...$('#section-fields').querySelectorAll('input')].map(control => [control.dataset.section, control.checked])),
  });
}
async function openEditor(token) {
  csrf = token;
  if (!loaded || !dirty) {
    const saved = await api('/admin/config');
    populate(saved.config);
    revision = saved.revision;
    loaded = true;
    changed(false);
    $('#save-version').textContent = `已发布版本 ${revision}`;
  }
  $('#auth-panel').hidden = true;
  $('#editor-panel').hidden = false;
  $('#auth-form').reset();
  tell(dirty ? '已重新登录。未发布的草稿已保留，请检查后保存。' : '登录成功。修改内容后，点击“保存并发布”。');
}
async function connect() {
  tell('正在连接配置服务…');
  try {
    const status = await api('/admin/status');
    if (status.authenticated) await openEditor(status.csrf);
    else {
      tell(status.setupAvailable ? '首次使用：请使用一次性初始化码设置密码。' : '请输入密码登录。');
      showAuth(status);
    }
  } catch (error) {
    tell(error.message, 'error');
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'config-quiet-button';
    retry.textContent = '重新连接';
    retry.addEventListener('click', connect);
    notice.append(document.createTextNode(' '), retry);
  }
}
$('#auth-form').addEventListener('submit', async event => {
  event.preventDefault();
  const chosen = $('#password').value;
  if (setupMode && chosen !== $('#confirm-password').value) { tell('两次输入的密码不一致', 'error'); return; }
  $('#auth-submit').disabled = true;
  try {
    const result = await api(setupMode ? '/admin/setup' : '/admin/login', { method: 'POST', data: { password: chosen, ...(setupMode ? { token: $('#setup-code').value.trim() } : {}) } });
    await openEditor(result.csrf);
  } catch (error) { tell(error.message, 'error'); }
  finally { $('#auth-submit').disabled = false; $('#password').value = ''; $('#confirm-password').value = ''; $('#setup-code').value = ''; }
});
$('#editor-form').addEventListener('input', () => changed());
$('#editor-form').addEventListener('change', () => changed());
$('#editor-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  let config;
  try { config = readDraft(); } catch (error) { tell(error.message, 'error'); return; }
  busy = true;
  $('#save-config').disabled = true;
  tell('正在发布内容…');
  try {
    const result = await api('/admin/config', { method: 'PUT', authenticated: true, data: { revision, config } });
    revision = result.revision;
    // Keep the editor unchanged while saving; edits made during the request remain dirty.
    let latestDraft;
    try { latestDraft = readDraft(); } catch { latestDraft = null; }
    changed(JSON.stringify(latestDraft) !== JSON.stringify(config));
    $('#save-version').textContent = `已发布版本 ${revision}`;
    tell(dirty ? '已发布本次保存的内容。保存期间的新修改仍在草稿中。' : '已发布。刷新主页即可看到最新内容。', 'success');
  } catch (error) { tell(error.message, 'error'); }
  finally { busy = false; $('#save-config').disabled = false; }
});
$('#add-project').addEventListener('click', () => {
  if ($('#project-fields').children.length >= 20) return;
  const card = projectCard({ repo: '', name: '', category: '', description: '', highlights: [], tags: [] });
  card.querySelector('input').focus();
  changed();
});
$('#project-fields').addEventListener('click', event => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const card = button.closest('[data-project]');
  if (button.dataset.action === 'up' && card.previousElementSibling) card.previousElementSibling.before(card);
  if (button.dataset.action === 'down' && card.nextElementSibling) card.nextElementSibling.after(card);
  if (button.dataset.action === 'delete') { card.remove(); $('#add-project').focus(); }
  updateProjects();
  changed();
});
$('#reload-config').addEventListener('click', async () => {
  if (busy || (dirty && !window.confirm('重新载入会放弃当前未发布的修改。确定重新载入吗？'))) return;
  try {
    const saved = await api('/admin/config');
    populate(saved.config);
    revision = saved.revision;
    changed(false);
    $('#save-version').textContent = `已发布版本 ${revision}`;
    tell('已载入最新发布内容。');
  } catch (error) { tell(error.message, 'error'); }
});
$('#restore-defaults').addEventListener('click', () => {
  if (busy) return;
  populate(defaults);
  changed();
  tell('默认内容已载入草稿。检查后保存，才会改变主页。');
});
$('#export-config').addEventListener('click', () => {
  try {
    const blob = new Blob([JSON.stringify({ version: 1, config: readDraft() }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `salieri-config-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    tell('已导出当前草稿。备份中不含密码。');
  } catch (error) { tell(error.message, 'error'); }
});
$('#import-config').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file || busy) return;
  try {
    if (file.size > 65536) throw new Error('配置文件不能超过 64 KB');
    const data = JSON.parse(await file.text());
    populate(cleanConfig(data.config || data));
    changed();
    tell('配置已导入草稿，检查后点击“保存并发布”。');
  } catch (error) { tell(error instanceof SyntaxError ? '请选择有效的 JSON 配置文件' : error.message, 'error'); }
  finally { event.target.value = ''; }
});
$('#password-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const fields = new FormData(form);
  if (fields.get('newPassword') !== fields.get('confirmPassword')) { tell('两次输入的新密码不一致', 'error'); return; }
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    const result = await api('/admin/password', { method: 'POST', authenticated: true, data: { currentPassword: fields.get('currentPassword'), password: fields.get('newPassword') } });
    csrf = result.csrf;
    form.reset();
    tell('密码已更新，其他设备的登录状态已失效。', 'success');
  } catch (error) { tell(error.message, 'error'); }
  finally { button.disabled = false; }
});
$('#logout').addEventListener('click', async () => {
  if (busy || (dirty && !window.confirm('还有未发布的修改。确定放弃草稿并退出吗？'))) return;
  try {
    await api('/admin/logout', { method: 'POST', authenticated: true });
    changed(false);
    loaded = false;
    $('#editor-form').reset();
    $('#password-form').reset();
    showAuth({ configured: true });
    tell('已安全退出。');
  } catch (error) { tell(error.message, 'error'); }
});
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
await connect();
