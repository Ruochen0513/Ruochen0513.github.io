import test from "node:test";
import assert from "node:assert/strict";

import { buildWeiboActivity, htmlToPlainText, selectLatestWeiboPost } from "./update-site-data.mjs";

const original = {
  id: "1002",
  bid: "Original02",
  created_at: "Sat Sep 20 12:00:00 +0800 2026",
  text: "<p>最新 <a href='https://example.com'>微博</a><br>&amp; 更新</p><script>alert(1)</script>",
  pics: [{ large: { url: "http://wx1.sinaimg.cn/large/example.jpg" } }],
  reposts_count: 2,
  comments_count: 3,
  attitudes_count: 9,
};

const olderPinned = {
  id: "1001",
  bid: "Pinned01",
  created_at: "Fri Sep 19 12:00:00 +0800 2026",
  text: "置顶旧微博",
  isTop: 1,
};

test("converts Weibo HTML to safe plain text", () => {
  assert.equal(htmlToPlainText(original.text), "最新 微博 & 更新");
});

test("selects by publication time instead of pinned card order", () => {
  const selected = selectLatestWeiboPost([
    { card_type: 9, mblog: olderPinned },
    { card_type: 9, mblog: original },
  ]);
  assert.equal(selected.id, "1002");
});

test("can exclude reposts", () => {
  const repost = { ...original, id: "1003", created_at: "Sun Sep 21 12:00:00 +0800 2026", retweeted_status: { id: "9001" } };
  const selected = selectLatestWeiboPost([
    { card_type: 9, mblog: repost },
    { card_type: 9, mblog: original },
  ], false);
  assert.equal(selected.id, "1002");
});

test("builds the normalized activity contract", () => {
  const activity = buildWeiboActivity({ uid: "3959317547", platform: "微博", defaultType: "POST" }, original);
  assert.equal(activity.source, "weibo");
  assert.equal(activity.title, "最新 微博 & 更新");
  assert.equal(activity.cover, "https://wx1.sinaimg.cn/large/example.jpg");
  assert.equal(activity.url, "https://weibo.com/3959317547/Original02");
  assert.match(activity.summary, /2 转发 · 3 评论 · 9 赞/);
});
