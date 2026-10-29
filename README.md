# SALIERI_HOME

一个可直接部署到 GitHub Pages 的像素风个人主页骨架。

## 本地预览

```bash
python3 -m http.server 4173
```

浏览器打开 `http://localhost:4173`。

## 内容结构

- 个人资料和社交链接
- 鼠标、键盘、耳机、鼠标垫
- 精选 GitHub 项目、项目介绍、功能亮点与技术标签
- 无畏契约准星预览与代码复制
- GitHub 贡献日期图与活动列表
- B站、微博、网易云音乐聚合动态
- 访客统计与世界地图：近 7/30 天估算访客数、访问次数和地区热力分布
- 国际象棋对战独立页：访客异步接力、合法走法校验、棋谱回放与历史归档

B站最新投稿已通过后台 WBI 请求接入，展示封面、标题、简介、播放量、发布时间和原视频链接，无需在网页端配置 Cookie。

微博最新动态已通过后台移动端接口接入，支持正文 HTML 清洗、长微博、图片、互动数据、置顶排序修正和原创/转发筛选。微博 Cookie 仅保存在本地 `.env` 或 GitHub Actions Secret 中。

网易云音乐已接入最近一周听歌排行，展示本周常听 Top 3、歌曲封面、艺人、专辑和歌曲链接。该数据是周排行而非精确播放历史；接口不提供播放次数时，页面会显示排行热度。`MUSIC_COOKIE` 为可选的后台凭证，不会进入网页。

所有可配置内容集中在 [`js/config.js`](./js/config.js)，包括个人信息、邮箱、社交链接、外设、三套准星代码、GitHub 状态和动态占位内容。邮箱修改 `profile.email` 即可，页面显示内容和 `mailto:` 链接会同步更新。GitHub 与社交动态建议通过 GitHub Actions 定时抓取公开数据并输出静态 JSON，避免在前端暴露令牌。

## 项目展示

“项目”位于桌面外设之后、准星分享之前，默认展示 Simple Microsoft To Do for Obsidian 和 GPT Usage Indicator。在 `js/config.js` 中编辑 `projects` 数组即可指定展示的仓库，数组顺序就是页面展示顺序：

```js
projects: [
  {
    repo: "Ruochen0513/Ruochen0513.github.io",
    name: "SALIERI_HOME",
    category: "PERSONAL WEBSITE",
    description: "像素风个人主页，将个人档案、桌面外设、准星分享和社交动态汇总到一个页面。",
    highlights: ["支持切换准星方案并复制导入代码", "通过后台定时任务同步 GitHub 与社交动态"],
    tags: ["HTML", "CSS", "JavaScript", "GitHub Pages"],
  },
],
```

`repo` 使用 `所有者/仓库名` 格式，页面据此生成 GitHub 链接；`description` 是主要介绍，`highlights` 和 `tags` 可省略。项目介绍在本地静态渲染，无需浏览器调用 GitHub API；定时动态更新不会覆盖项目选择和介绍。列表为空时显示整理提示与 GitHub 仓库入口。

## 访客统计

访客地图使用独立的 Cloudflare Worker + D1 后台，主页仍部署到 GitHub Pages。地图位于最近动态之后，访问次数越多的地区越亮；只展示汇总地区，不公开完整 IP。需要先部署 [`analytics`](./analytics/README.md) 并把 Worker 地址填入 `js/config.js` 的 `visitors.endpoint`，接入后才开始记录真实访问。未接入时显示等待状态，不生成虚构访客数据。

## 网页配置中心

访问 `/config/`，设置管理密码并登录后，可编辑个人资料、首页概览、社交链接、外设、项目介绍与排序、准星文字与颜色，以及栏目显示。点击“保存并发布”后刷新主页即可生效，无需修改代码或重新部署。支持配置导出、导入和将默认内容载入草稿。初始化与密码找回方式见 [`analytics/README.md`](./analytics/README.md#homepage-configuration-editor)。配置保存在 Cloudflare D1；密码和登录凭证不会写入公开仓库。

## 国际象棋对战

顶部导航的“国际象棋对战”进入独立的 `/chess/` 页面，主页不增加新的下方栏目。所有访客共用当前棋局，黑白交替落子；同一 IP 不能连续落子，其他 IP 接力后可再次参与。支持合法落点、将军与将死、易位、吃过路兵、四种升变和标准和棋声明。右侧按白黑方记录 SAN 棋谱，点击每一着或使用回放按钮查看历史局面；回看时为只读。结束的对局自动归档，可下载 PGN，之后可开启下一盘共享棋局。

棋局保存在现有 Cloudflare D1 中，由服务器校验走法和版本，避免并发覆盖。浏览器仅在可见且查看当前棋局时每 30 秒同步，也可以手动同步；不要求双方同时在线。具体接口与参与限制见 [`analytics/README.md`](./analytics/README.md#community-chess)。

## 本地自动更新

项目已经包含可运行的本地定时更新系统：

```text
systemd 用户定时器（每日 03:00）
        ↓
拉取 GitHub / B站 / 微博 / 网易云 / Instagram 数据
        ↓
生成 data/site-data.js
        ↓
主页读取最新数据，更新 GitHub 状态和最近动态
```

完整配置和安装步骤见 [`automation/API-CONFIG.md`](./automation/API-CONFIG.md)。密钥保存在本地 `automation/.env`，不会发送到浏览器。

部署到 GitHub Pages 后，[`.github/workflows/update-site-data.yml`](./.github/workflows/update-site-data.yml) 会在每天北京时间 03:00 生成最新的 `data/site-data.js` 并直接部署页面，但不会修改仓库提交历史。GitHub Pages 的 Source 需要设为 `GitHub Actions`；也可以在仓库的 `Actions` 页面手动运行 `Update site data`。

默认的 Actions Token 只能统计公开贡献。若要让线上统计与可访问私有仓库的本地 PAT 保持一致，请在仓库 Actions Secrets 中配置 `PROFILE_GITHUB_TOKEN`。公开页面会展示贡献数量和日期分布，但不会包含 Token 或私有仓库名称。
