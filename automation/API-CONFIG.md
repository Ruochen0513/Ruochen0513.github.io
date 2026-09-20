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

## 4. 其他社交平台配置

微博、网易云和 Instagram 采用通用 JSON 接口适配器。每个平台需要一个能够返回 JSON 的接口地址，返回格式默认如下：

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
"weibo": {
  "enabled": true,
  "url": "https://your-api.example/weibo",
  "tokenEnv": "WEIBO_TOKEN",
  "itemsPath": "items",
  "defaultType": "POST",
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

微博、网易云和 Instagram 是否能直接使用官方接口，取决于账号权限和平台开放能力。不要把网页登录 Cookie 写入配置；需要 OAuth 的平台应使用官方 Token，并放入 `.env`。

## 5. 手动测试

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

## 6. 每日 03:00 定时任务

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

## 7. 主页刷新

静态页面不会被后台主动推送。定时任务更新数据后，重新打开或刷新主页即可看到最新状态。当前本地服务器地址为 `http://localhost:4173`。

## 8. GitHub Pages 自动更新

仓库中的 `.github/workflows/update-site-data.yml` 会在每天北京时间 03:00 运行，拉取 GitHub 状态，在 Actions 环境中生成新的 `data/site-data.js` 并直接部署站点。它不会向 `main` 分支提交生成文件，因此不会造成日常本地推送冲突。这个流程不依赖本机开机。

默认使用 Actions 自动提供的临时 Token，它只能读取公开贡献，因此贡献数和连续天数可能低于本地 PAT 的结果。若要让线上数据与本地一致，在仓库 `Settings -> Secrets and variables -> Actions` 中新建 Repository secret：

```text
Name: PROFILE_GITHUB_TOKEN
Secret: 你的 GitHub PAT
```

工作流会优先使用 `PROFILE_GITHUB_TOKEN`，未配置时自动回退到内置 Token。Secret 不会进入网页或 Git 历史；但生成的公开 `data/site-data.js` 会包含每日贡献数量和日期分布，不包含私有仓库名称。

首次推送工作流后，在仓库 `Settings -> Pages -> Build and deployment -> Source` 中选择 `GitHub Actions`。然后进入 `Actions` 页面，选择 `Update site data`，点击 `Run workflow` 立即验证。若工作流无法推送，请在 `Settings -> Actions -> General -> Workflow permissions` 中选择 `Read and write permissions`。
