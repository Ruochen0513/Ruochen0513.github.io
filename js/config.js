// Edit this file to update the page content without touching the layout.
window.PLAYER_HOME_CONFIG = {
  profile: {
    nickname: "Salieri",
    handle: "@ruochen0513",
    bio: "普通研究生，热爱游戏与音乐",
    school: "Nankai University",
    birthday: "13 / 05",
    location: "Tianjin or Hebei",
    status: "在线",
    footerName: "Salieri",
  },

  quickStats: {
    location: { label: "LOCATION", value: "CN" },
    status: { label: "STATUS", value: "ACTIVE" },
    focus: { label: "FOCUS", value: "PLAY / CODE" },
  },

  socials: [
    { key: "bilibili", id: "01", icon: "B", name: "哔哩哔哩", subtitle: "BILIBILI", handle: "跳转", url: "https://space.bilibili.com/56829848?spm_id_from=333.1007.0.0" },
    { key: "instagram", id: "02", icon: "IG", name: "Instagram", subtitle: "PHOTO STREAM", handle: "跳转", url: "https://www.instagram.com/ruochen0513/" },
    { key: "weibo", id: "03", icon: "WB", name: "微博", subtitle: "WEIBO", handle: "跳转", url: "https://weibo.com/u/3959317547" },
    { key: "netease", id: "04", icon: "NE", name: "网易云音乐", subtitle: "MUSIC", handle: "跳转", url: "https://music.163.com/#/user/home?id=320515567" },
    { key: "github", id: "05", icon: "GH", name: "GitHub", subtitle: "CODE REPOSITORY", handle: "跳转", url: "https://github.com/Ruochen0513" },
  ],

  gear: [
    { key: "mouse", name: "鼠标", model: "ATK F1 V2", metaLabel: "DPI", metaValue: "800x0.35" },
    { key: "keyboard", name: "键盘", model: "looting 66", metaLabel: "SWITCH", metaValue: "----" },
    { key: "headset", name: "耳机", model: "RAZER KRAKEN X", metaLabel: "MODE", metaValue: "STEREO" },
    { key: "mousepad", name: "鼠标垫", model: "Spacepad 奈雪-绝影-pro", metaLabel: "SIZE", metaValue: "3mm,450x400mm" },
  ],

  crosshairs: [
    {
      key: "1322",
      tabLabel: "01 1322",
      name: "1322",
      color: "青色",
      outline: "关闭",
      center: "关闭",
      previewColor: "#61f3e2",
      code: "0;p;0;s;1;P;h;0;f;0;m;1;0l;3;0v;3;0o;2;0a;1;0f;0;1b;0;A;o;0.8;d;1;z;1;m;1;0b;0;1b;0;S;c;0;o;1",
    },
    {
      key: "solid",
      tabLabel: "02 实心十字",
      name: "实心十字",
      color: "绿色",
      outline: "关闭",
      center: "关闭",
      previewColor: "#94c973",
      code: "0;P;h;0;f;0;0l;5;0o;0;0a;1;0f;0;1b;0",
    },
    {
      key: "dot",
      tabLabel: "03 点准星",
      name: "点准星",
      color: "白色",
      outline: "开启",
      center: "开启",
      previewColor: "#f5f3fa",
      code: "0;s;1;P;o;1;d;1;0l;2;0o;0;0a;1;0f;0;1t;0;1l;0;1o;0;1a;0;1m;0;1f;0;S;s;0.6;o;1",
    },
  ],

  github: {
    username: "Ruochen0513",
    integrationNote: "DEMO DATA / API NOT CONNECTED",
    metrics: {
      contributions: { value: "--", label: "今年贡献" },
      streak: { value: "--", label: "连续天数" },
      repositories: { value: "--", label: "公开仓库" },
    },
    months: ["OCT", "NOV", "DEC", "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP"],
    commits: [
      { title: "等待接入真实提交记录", source: "GitHub Events API", time: "--" },
      { title: "仓库与提交信息将在这里显示", source: "repository / commit", time: "--" },
      { title: "支持展示 Push、Star 与 Release", source: "public activity", time: "--" },
    ],
  },

  activity: [
    { source: "bilibili", platform: "哔哩哔哩", time: "等待同步", title: "最新视频动态将在这里显示", summary: "标题、发布时间、封面和链接接入后自动更新。", type: "VIDEO" },
    { source: "weibo", platform: "微博", time: "等待同步", title: "最新微博将在这里显示", summary: "文字、图片与原始动态链接会汇总到这一条时间线。", type: "POST" },
    { source: "netease", platform: "网易云音乐", time: "等待同步", title: "最近在听将在这里显示", summary: "可展示歌名、艺人、封面与歌单链接。", type: "MUSIC" },
    { source: "instagram", platform: "Instagram", time: "等待同步", title: "最新图片动态将在这里显示", summary: "接入公开数据后，这里会展示缩略图与动态摘要。", type: "PHOTO" },
  ],
};
