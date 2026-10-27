// Shared by the editor and Worker. Only public, editable content is accepted.
export const PROFILE_FIELDS = {
  nickname: ['昵称', 60], handle: ['账号标识', 80], email: ['联系邮箱', 160],
  bio: ['个人介绍', 600], school: ['学校 / 单位', 120], birthday: ['生日', 40],
  location: ['所在地', 100], status: ['当前状态', 60], footerName: ['页脚署名', 80],
};
export const SOCIAL_KEYS = ['bilibili', 'instagram', 'weibo', 'netease', 'github'];
export const GEAR_KEYS = ['mouse', 'keyboard', 'headset', 'mousepad'];
export const CROSSHAIR_KEYS = ['1322', 'solid', 'dot'];
export const SECTION_LABELS = {
  gear: '桌面外设', projects: '项目', crosshair: '准星分享', github: 'GitHub 状态',
  activity: '最近动态', visitors: '访客足迹',
};
const TOP_KEYS = ['profile', 'quickStats', 'socials', 'gear', 'projects', 'crosshairs', 'sections'];
export class ConfigError extends Error {}
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function keys(value, allowed, label) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new ConfigError(`${label}包含不支持的字段`);
}
function text(value, max, label, required = false) {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new ConfigError(`${label}格式不正确，最多 ${max} 个字符`);
  const result = value.trim();
  if (required && !result) throw new ConfigError(`请填写${label}`);
  return result;
}
function fields(value, definitions, label) {
  keys(value, Object.keys(definitions), label);
  return Object.fromEntries(Object.entries(definitions).map(([key, [name, max]]) => [key, text(value[key], max, name)]));
}
function fixedList(value, expected, definitions, label) {
  if (!Array.isArray(value) || value.length !== expected.length) throw new ConfigError(`${label}条目数量不正确`);
  return expected.map(key => {
    const matching = value.filter(item => object(item) && item.key === key);
    if (matching.length !== 1) throw new ConfigError(`${label}条目标识不正确`);
    const { key: _key, ...rest } = matching[0];
    return { key, ...fields(rest, definitions, label) };
  });
}
function stringList(value, maxItems, maxLength, label) {
  if (!Array.isArray(value) || value.length > maxItems) throw new ConfigError(`${label}最多 ${maxItems} 项`);
  return value.map(item => text(item, maxLength, label)).filter(Boolean);
}
export function cleanConfig(input) {
  keys(input, TOP_KEYS, '配置');
  const result = {};
  if ('profile' in input) {
    result.profile = fields(input.profile, PROFILE_FIELDS, '个人资料');
    if (!result.profile.nickname) throw new ConfigError('请填写昵称');
    if (result.profile.email && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(result.profile.email)) throw new ConfigError('联系邮箱格式不正确');
  }
  if ('quickStats' in input) {
    keys(input.quickStats, ['location', 'status', 'focus'], '首页概览');
    result.quickStats = Object.fromEntries(['location', 'status', 'focus'].map(key => [key, fields(input.quickStats[key], { label: ['概览标题', 30], value: ['概览内容', 60] }, '首页概览')]));
  }
  if ('socials' in input) {
    result.socials = fixedList(input.socials, SOCIAL_KEYS, { id: ['编号', 8], icon: ['图标文字', 8], name: ['平台名', 40], subtitle: ['副标题', 60], handle: ['显示文字', 80], url: ['社交链接', 1000] }, '社交链接');
    for (const social of result.socials) {
      if (!social.url) continue;
      let url;
      try { url = new URL(social.url); } catch { throw new ConfigError(`${social.name}链接格式不正确`); }
      if (url.protocol !== 'https:' || url.username || url.password) throw new ConfigError('社交链接请使用不含账号密码的 HTTPS 地址');
      social.url = url.href;
    }
  }
  if ('gear' in input) result.gear = fixedList(input.gear, GEAR_KEYS, { name: ['外设名称', 40], model: ['型号', 160], metaLabel: ['参数名称', 40], metaValue: ['参数内容', 160] }, '外设');
  if ('crosshairs' in input) {
    result.crosshairs = fixedList(input.crosshairs, CROSSHAIR_KEYS, { tabLabel: ['标签名称', 40], name: ['准星名称', 60], color: ['颜色说明', 40], outline: ['描边说明', 40], center: ['中心点说明', 40], previewColor: ['预览颜色', 7], code: ['准星代码', 1600] }, '准星');
    if (result.crosshairs.some(item => !/^#[0-9a-f]{6}$/i.test(item.previewColor))) throw new ConfigError('准星预览颜色请使用六位十六进制颜色');
  }
  if ('projects' in input) {
    if (!Array.isArray(input.projects) || input.projects.length > 20) throw new ConfigError('最多展示 20 个项目');
    result.projects = input.projects.map(project => {
      keys(project, ['repo', 'name', 'category', 'description', 'highlights', 'tags'], '项目');
      const repo = text(project.repo, 180, '仓库名', true);
      if (!/^[a-z\d](?:[a-z\d-]*[a-z\d])?\/[a-z\d._-]+$/i.test(repo)) throw new ConfigError('仓库请填写 owner/repository，例如 Ruochen0513/GPT-Usage-Indicator');
      return { repo, name: text(project.name, 120, '项目名称'), category: text(project.category, 60, '项目分类'), description: text(project.description, 1600, '项目介绍'), highlights: stringList(project.highlights, 10, 300, '项目亮点'), tags: stringList(project.tags, 12, 40, '项目标签') };
    });
    if (new Set(result.projects.map(item => item.repo.toLowerCase())).size !== result.projects.length) throw new ConfigError('项目仓库不能重复');
  }
  if ('sections' in input) {
    keys(input.sections, Object.keys(SECTION_LABELS), '栏目显示');
    result.sections = {};
    for (const [key, value] of Object.entries(input.sections)) {
      if (typeof value !== 'boolean') throw new ConfigError('栏目显示设置格式不正确');
      result.sections[key] = value;
    }
  }
  return result;
}
export function editableConfig(base) {
  return cleanConfig(Object.fromEntries(TOP_KEYS.filter(key => key in base).map(key => [key, base[key]])));
}
export function mergeEditable(base, overrides) {
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(cleanConfig(overrides))) {
    result[key] = Array.isArray(value) ? value : { ...result[key], ...value };
  }
  return result;
}
