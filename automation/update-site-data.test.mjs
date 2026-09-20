import test from "node:test";
import assert from "node:assert/strict";

import {
  buildNeteaseActivity,
  buildWeiboActivity,
  htmlToPlainText,
  normalizeNeteaseRanking,
  selectLatestWeiboPost,
} from "./update-site-data.mjs";

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

test("normalizes modern and legacy NetEase song fields", () => {
  const ranking = normalizeNeteaseRanking([
    { playCount: 18, score: 100, song: { id: 101, name: "现代字段", ar: [{ name: "歌手甲" }], al: { name: "专辑甲", picUrl: "http://example.com/a.jpg" } } },
    { playCount: 12, score: 80, song: { id: 102, name: "旧字段", artists: [{ name: "歌手乙" }], album: { name: "专辑乙", picUrl: "https://example.com/b.jpg" } } },
    { playCount: 8, score: 60, song: { id: 103, name: "第三首", ar: [{ name: "歌手丙" }], al: { name: "专辑丙" } } },
    { playCount: 4, score: 40, song: { id: 104, name: "不会进入 Top 3", ar: [], al: {} } },
  ], 3);
  assert.equal(ranking.length, 3);
  assert.deepEqual(ranking[0].artists, ["歌手甲"]);
  assert.equal(ranking[0].cover, "https://example.com/a.jpg");
  assert.equal(ranking[1].album, "专辑乙");
  assert.equal(ranking[2].url, "https://music.163.com/song?id=103");
});

test("builds a weekly NetEase activity without exposing secrets", () => {
  const activity = buildNeteaseActivity(
    { limit: 3, platform: "网易云音乐", defaultType: "WEEKLY TOP", cookieEnv: "MUSIC_COOKIE" },
    [{ playCount: 18, score: 100, song: { id: 101, name: "歌曲", ar: [{ name: "歌手" }], al: { name: "专辑", picUrl: "https://example.com/a.jpg" } } }],
  );
  assert.equal(activity.title, "本周常听 Top 1");
  assert.equal(activity.ranking[0].playCount, 18);
  assert.match(activity.summary, /18 次播放/);
  assert.doesNotMatch(JSON.stringify(activity), /MUSIC_COOKIE|cookie/i);
});

test("rejects an empty or private NetEase weekly ranking", () => {
  assert.throws(() => buildNeteaseActivity({ limit: 3 }, []), /no public weekly listening data/);
});
