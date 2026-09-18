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

## 3. 社交平台配置

四个平台采用通用 JSON 接口适配器。每个平台需要一个能够返回 JSON 的接口地址，返回格式默认如下：

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
"bilibili": {
  "enabled": true,
  "url": "https://your-api.example/bilibili",
  "tokenEnv": "BILIBILI_TOKEN",
  "itemsPath": "items",
  "defaultType": "VIDEO",
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

B站、微博、网易云和 Instagram 是否能直接使用官方接口，取决于账号权限和平台开放能力。不要把网页登录 Cookie 写入配置；需要 OAuth 的平台应使用官方 Token，并放入 `.env`。

## 4. 手动测试

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

## 5. 每日 03:00 定时任务

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

## 6. 主页刷新

静态页面不会被后台主动推送。定时任务更新数据后，重新打开或刷新主页即可看到最新状态。当前本地服务器地址为 `http://localhost:4173`。

## 7. GitHub Pages 自动更新

仓库中的 `.github/workflows/update-site-data.yml` 会在每天北京时间 03:00 运行，使用 GitHub Actions 自动提供的临时 `GITHUB_TOKEN` 拉取 GitHub 状态，把新的 `data/site-data.js` 提交回 `main` 分支，并直接部署站点。这个流程不依赖本机开机，也不需要把个人 Token 上传到仓库。

首次推送工作流后，在仓库 `Settings -> Pages -> Build and deployment -> Source` 中选择 `GitHub Actions`。然后进入 `Actions` 页面，选择 `Update site data`，点击 `Run workflow` 立即验证。若工作流无法推送，请在 `Settings -> Actions -> General -> Workflow permissions` 中选择 `Read and write permissions`。
