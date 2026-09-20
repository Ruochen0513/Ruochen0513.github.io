# SALIERI_HOME API 配置文档

自动更新脚本每天 03:00（本机时区）运行一次，生成 `data/site-data.js`，主页加载后会优先使用这份最新数据。

## 1. 配置文件

当前机器已经生成以下两个本地配置文件：

```text
automation/api-config.json
automation/.env
```

只需要修改这两个文件。它们已加入 `.gitignore`，不会提交到公开仓库。如果以后删除了它们，可以从 `api-config.example.json` 和 `.env.example` 重新复制。

## 2. GitHub 配置

编辑 `automation/api-config.json`：

```json
"github": {
  "enabled": true,
  "username": "Ruochen0513",
  "tokenEnv": "GITHUB_TOKEN",
  "eventsLimit": 8
}
```

在 `automation/.env` 写入 GitHub Personal Access Token：

```dotenv
GITHUB_TOKEN=github_pat_xxxxxxxxxxxxxxxxxxxx
```

Token 建议只授予读取公开仓库和用户数据的权限。脚本会自动请求：

- 用户资料和公开仓库数量
- 公开事件与最近提交
- GraphQL 贡献日期图和连续贡献天数

没有 `GITHUB_TOKEN` 时，用户资料和公开事件仍可能正常更新，但贡献日期图会保留页面中的演示数据。

## 3. B站最新投稿

B站最新投稿已经内置支持，不需要 Token 或 Cookie。在 `api-config.json` 中配置：

```json
"bilibili": {
  "enabled": true,
  "provider": "bilibili",
  "uid": "56829848",
  "platform": "哔哩哔哩",
  "defaultType": "VIDEO"
}
```

`uid` 是个人空间 URL `space.bilibili.com/数字` 中的数字。更新器会在后台生成 WBI 签名并读取最新一条公开投稿，返回标题、BV 号、封面、简介、播放量、发布时间和视频链接。请求只在本机定时任务或 GitHub Actions 中发生，浏览器不会直接访问 API，也不会暴露凭证。

GitHub Pages 的线上配置位于 `automation/github-pages-config.json`。当前 UID 已设为 `56829848`，每天北京时间 03:00 随 GitHub 状态一起更新。B站可能调整或限制非官方 Web API；如果 `sourceStatus.bilibili` 出现风控错误，可改为自建 RSSHub 的通用 JSON 接口模式。

## 4. 微博最新动态

微博移动端接口已经内置支持。当前 UID 已配置为 `3959317547`，会按实际发布时间选择最新微博，不会因为置顶微博排在首位而选错；正文会清除 HTML 后再写入页面，长微博会尽量读取完整正文。默认包含原创和转发，将 `includeReposts` 改为 `false` 可只显示原创微博。

微博目前会拦截无 Cookie 的服务器请求，因此需要配置 `WEIBO_COOKIE`。Cookie 只放在服务端环境变量中，不会进入网页或 Git 历史。

本地配置：登录 [微博移动版](https://m.weibo.cn)，打开浏览器开发者工具的 `Network`，刷新页面，选择发往 `m.weibo.cn` 的请求，在 `Request Headers` 中找到完整的 `Cookie` 值，写入本地 `automation/.env`：

```dotenv
WEIBO_COOKIE=SUB=...; SUBP=...; MLOGIN=1; ...
```

线上配置：进入 GitHub 仓库的 `Settings -> Secrets and variables -> Actions -> New repository secret`，创建：

```text
Name: WEIBO_COOKIE
Secret: 上述完整 Cookie 值
```

然后在 `Actions -> Update site data -> Run workflow` 手动运行一次。Cookie 可能过期；若 `sourceStatus.weibo` 显示登录或风控错误，重新获取并覆盖 Secret 即可。抓取失败时会继续展示上一次成功的数据。

配置结构：

```json
"weibo": {
  "enabled": true,
  "provider": "weibo",
  "uid": "3959317547",
  "platform": "微博",
  "defaultType": "POST",
  "includeReposts": true,
  "requireCookie": true,
  "cookieEnv": "WEIBO_COOKIE"
}
```

## 5. 网易云本周常听

网易云周排行已经内置支持。当前 UID 为 `320515567`，页面会展示本周排行前三首的歌曲名、艺人、专辑、封面和歌曲链接：

```json
"netease": {
  "enabled": true,
  "provider": "netease",
  "uid": "320515567",
  "platform": "网易云音乐",
  "defaultType": "WEEKLY TOP",
  "recordType": 1,
  "limit": 3,
  "cookieEnv": "MUSIC_COOKIE"
}
```

- `uid`：个人主页 URL `music.163.com/#/user/home?id=数字` 中的数字。
- `recordType: 1`：最近一周排行；改为 `0` 表示所有时间排行。
- `limit`：页面展示的歌曲数量。
- 这是按周统计的排行，不是包含精确播放时刻的历史流水。
- 接口有播放次数时显示次数；接口隐藏次数时显示其归一化排行热度。

更新器默认直接请求网易云的 Web 接口。账号必须公开听歌排行，否则会返回空数据。当前公开数据无需 Cookie；如果以后遇到登录限制或风控，可在本地 `automation/.env` 中填写：

```dotenv
MUSIC_COOKIE=MUSIC_U=...; __csrf=...; ...
```

线上则在仓库 `Settings -> Secrets and variables -> Actions -> New repository secret` 新建：

```text
Name: MUSIC_COOKIE
Secret: 登录 music.163.com 后，请求头中完整的 Cookie 值
```

Cookie 只会传给后台更新脚本，不会写入 `data/site-data.js`、网页或 Git 历史。抓取失败时，页面会继续使用上一次成功的数据。

如果直接接口失效，也可以自建 NeteaseCloudMusicApi，并在网易云配置中增加：

```json
"apiBase": "https://your-netease-api.example.com/"
```

更新器会改为请求 `https://your-netease-api.example.com/user/record?uid=...&type=1`。

## 6. Instagram 通用接口配置

Instagram 仍采用通用 JSON 接口适配器。接口返回格式默认如下：

```json
{
  "items": [
    {
      "title": "动态标题",
      "description": "动态摘要",
      "published_at": "2026-09-18T03:00:00+08:00",
      "url": "https://example.com/post/1"
    }
  ]
}
```

在 `api-config.json` 中开启对应来源并填写字段映射：

```json
"instagram": {
  "enabled": true,
  "url": "https://your-api.example/instagram",
  "tokenEnv": "INSTAGRAM_TOKEN",
  "itemsPath": "items",
  "defaultType": "PHOTO",
  "fieldMap": {
    "title": "title",
    "summary": "description",
    "time": "published_at",
    "url": "url"
  }
}
```

字段说明：

- `enabled`: `true` 才会请求该来源。
- `url`: 返回 JSON 的接口地址。
- `tokenEnv`: 可选，对应 `.env` 中的环境变量名；脚本会用 Bearer Token 请求。
- `itemsPath`: 数据数组路径，例如 `items` 或 `data.items`。
- `defaultType`: 动态类型，例如 `VIDEO`、`POST`、`MUSIC`、`PHOTO`。
- `fieldMap`: 把接口字段映射到主页字段；字段支持点号路径。

需要 OAuth 的接口 Token 应只放入 `.env` 或 GitHub Actions Secret。

## 7. 手动测试

配置好后，在项目根目录运行：

```bash
node automation/update-site-data.mjs
```

只查看结果、不写入文件：

```bash
node automation/update-site-data.mjs --dry-run
```

成功后会更新：

```text
data/site-data.js
```

每个来源的成功、跳过或失败原因会写入生成文件中的 `sourceStatus`，一个平台失败不会阻塞其他平台。

## 8. 每日 03:00 定时任务

当前机器已经安装并启用了 `player-home-update.timer`，每天 `03:00:00` 运行。修改 API 配置后不需要重新安装定时器。需要在其他电脑部署时，执行一次：

```bash
./automation/install-schedule.sh
```

查看定时器：

```bash
systemctl --user status player-home-update.timer
systemctl --user list-timers player-home-update.timer
```

查看更新日志：

```bash
journalctl --user -u player-home-update.service -n 50 --no-pager
```

如果电脑在 03:00 关机，`Persistent=true` 会在下次登录后补跑一次。卸载定时任务：

```bash
./automation/uninstall-schedule.sh
```

## 9. 主页刷新

静态页面不会被后台主动推送。定时任务更新数据后，重新打开或刷新主页即可看到最新状态。当前本地服务器地址为 `http://localhost:4173`。

## 10. GitHub Pages 自动更新

仓库中的 `.github/workflows/update-site-data.yml` 会在每天北京时间 03:00 运行，拉取 GitHub 状态，在 Actions 环境中生成新的 `data/site-data.js` 并直接部署站点。它不会向 `main` 分支提交生成文件，因此不会造成日常本地推送冲突。这个流程不依赖本机开机。

默认使用 Actions 自动提供的临时 Token，它只能读取公开贡献，因此贡献数和连续天数可能低于本地 PAT 的结果。若要让线上数据与本地一致，在仓库 `Settings -> Secrets and variables -> Actions` 中新建 Repository secret：

```text
Name: PROFILE_GITHUB_TOKEN
Secret: 你的 GitHub PAT
```

工作流会优先使用 `PROFILE_GITHUB_TOKEN`，未配置时自动回退到内置 Token。Secret 不会进入网页或 Git 历史；但生成的公开 `data/site-data.js` 会包含每日贡献数量和日期分布，不包含私有仓库名称。

首次推送工作流后，在仓库 `Settings -> Pages -> Build and deployment -> Source` 中选择 `GitHub Actions`。然后进入 `Actions` 页面，选择 `Update site data`，点击 `Run workflow` 立即验证。若工作流无法推送，请在 `Settings -> Actions -> General -> Workflow permissions` 中选择 `Read and write permissions`。
