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
- 无畏契约准星预览与代码复制
- GitHub 贡献日期图与活动列表
- B站、微博、网易云音乐、Instagram 聚合动态

所有可配置内容集中在 [`js/config.js`](./js/config.js)，包括个人信息、社交链接、外设、三套准星代码、GitHub 状态和动态占位内容。GitHub 与社交动态建议通过 GitHub Actions 定时抓取公开数据并输出静态 JSON，避免在前端暴露令牌。

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
