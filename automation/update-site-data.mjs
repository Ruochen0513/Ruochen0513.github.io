#!/usr/bin/env node

import { readFile, rename, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = resolve(SCRIPT_DIR, "..");
const DEFAULT_CONFIG = resolve(SCRIPT_DIR, "api-config.json");
const DEFAULT_ENV = resolve(SCRIPT_DIR, ".env");
const DEFAULT_OUTPUT = resolve(PROJECT_DIR, "data/site-data.js");
const USER_AGENT = "PLAYER_HOME local data updater";
const BILIBILI_USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36";
const WBI_MIXIN_KEY_TABLE = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52];

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (!argument.startsWith("--")) continue;
  const [key, inlineValue] = argument.slice(2).split("=", 2);
  args.set(key, inlineValue ?? process.argv[++index] ?? "");
}

const configPath = resolve(args.get("config") || DEFAULT_CONFIG);
const envPath = resolve(args.get("env") || DEFAULT_ENV);
const outputPath = resolve(args.get("output") || DEFAULT_OUTPUT);
const dryRun = args.has("dry-run");

function parseDotEnv(source) {
  const values = {};
  source.split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || match[1].startsWith("#")) return;
    values[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  });
  return values;
}

async function readOptional(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readGeneratedData(path) {
  const source = await readOptional(path);
  const match = source.match(/^window\.PLAYER_HOME_LIVE_DATA\s*=\s*([\s\S]+);\s*$/m);
  if (!match) return {};
  try {
    return JSON.parse(match[1]);
  } catch {
    return {};
  }
}

function getPath(source, path) {
  if (!path) return source;
  return path.split(".").reduce((value, key) => value?.[key], source);
}

function text(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  return String(value).trim() || fallback;
}

function isoDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? text(value) : date.toISOString();
}

function tokenFor(source, env) {
  return source?.tokenEnv ? env[source.tokenEnv] || process.env[source.tokenEnv] || "" : "";
}

async function fetchJson(url, { token = "", method = "GET", body, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(url, {
      method,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const raw = await response.text();
    let data;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      throw new Error(`API returned non-JSON data (${response.status})`);
    }
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}: ${text(data?.message, "request failed")}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function bilibiliWbiKey(url) {
  return url.split("/").at(-1)?.split(".")[0] || "";
}

function signBilibiliParams(params, imgUrl, subUrl) {
  const sourceKey = `${bilibiliWbiKey(imgUrl)}${bilibiliWbiKey(subUrl)}`;
  const mixinKey = WBI_MIXIN_KEY_TABLE.map((index) => sourceKey[index] || "").join("").slice(0, 32);
  const signed = { ...params, wts: Math.floor(Date.now() / 1000) };
  const query = Object.keys(signed)
    .sort()
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(String(signed[key]).replace(/[!'()*]/g, ""))}`)
    .join("&");
  const digest = createHash("md5").update(`${query}${mixinKey}`).digest("hex");
  return `${query}&w_rid=${digest}`;
}

function compactCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count)) return "--";
  if (count >= 10000) return `${(count / 10000).toFixed(count >= 100000 ? 0 : 1)}万`;
  return new Intl.NumberFormat("zh-CN").format(count);
}

function compactText(value, maxLength = 96) {
  const normalized = text(value).replace(/\s+/g, " ");
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function buildBilibiliActivity(source, video) {
  const description = compactText(video.description) || "暂无视频简介";
  const playCount = compactCount(video.play);
  return {
    source: "bilibili",
    platform: text(source.platform, "哔哩哔哩"),
    time: isoDate(video.publishedAt),
    title: text(video.title, "最新投稿"),
    summary: `${description} · ${playCount} 播放`,
    type: text(source.defaultType, "VIDEO"),
    url: `https://www.bilibili.com/video/${video.bvid}`,
    cover: text(video.cover).replace(/^http:/, "https:"),
    bvid: video.bvid,
    playCount: Number(video.play) || 0,
  };
}

async function updateBilibili(source, statuses) {
  if (!source?.enabled || !source.uid) {
    statuses.bilibili = emptyStatus();
    return null;
  }

  try {
    const baseHeaders = {
      "User-Agent": BILIBILI_USER_AGENT,
      Referer: `https://space.bilibili.com/${encodeURIComponent(source.uid)}/video`,
    };
    const fingerprint = await fetchJson("https://api.bilibili.com/x/frontend/finger/spi", { headers: baseHeaders });
    const buvid3 = fingerprint.data?.b_3;
    const buvid4 = fingerprint.data?.b_4;
    const cookie = [buvid3 && `buvid3=${buvid3}`, buvid4 && `buvid4=${buvid4}`].filter(Boolean).join("; ");
    const requestOptions = { headers: { ...baseHeaders, ...(cookie ? { Cookie: cookie } : {}) } };
    let primaryError = "";
    try {
      const nav = await fetchJson("https://api.bilibili.com/x/web-interface/nav", requestOptions);
      const imgUrl = nav.data?.wbi_img?.img_url;
      const subUrl = nav.data?.wbi_img?.sub_url;
      if (!imgUrl || !subUrl) throw new Error("WBI signing keys were not returned");
      const query = signBilibiliParams(
        { mid: source.uid, order: "pubdate", pn: 1, ps: 1 },
        imgUrl,
        subUrl,
      );
      const payload = await fetchJson(`https://api.bilibili.com/x/space/wbi/arc/search?${query}`, requestOptions);
      if (payload.code !== 0) throw new Error(`API ${payload.code}: ${text(payload.message, "request failed")}`);
      const video = payload.data?.list?.vlist?.[0];
      if (!video?.bvid) throw new Error("no public videos returned");
      statuses.bilibili = {
        status: "ok",
        updatedAt: new Date().toISOString(),
        message: `latest video updated via WBI (${video.bvid})`,
      };
      return buildBilibiliActivity(source, {
        bvid: video.bvid,
        title: video.title,
        description: video.description,
        publishedAt: Number(video.created) * 1000,
        play: video.play,
        cover: video.pic,
      });
    } catch (error) {
      primaryError = error.message;
    }

    const dynamicPayload = await fetchJson(
      `https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space?host_mid=${encodeURIComponent(source.uid)}&features=itemOpusStyle,listOnlyfans,opusBigCover,forwardListHidden,commentsNewVersion`,
      requestOptions,
    );
    if (dynamicPayload.code !== 0) {
      throw new Error(`WBI ${primaryError}; dynamic API ${dynamicPayload.code}: ${text(dynamicPayload.message, "request failed")}`);
    }
    const dynamic = dynamicPayload.data?.items?.find((item) => item.type === "DYNAMIC_TYPE_AV");
    const archive = dynamic?.modules?.module_dynamic?.major?.archive;
    const bvid = archive?.bvid || archive?.jump_url?.match(/BV[0-9A-Za-z]+/)?.[0];
    if (!bvid) throw new Error(`WBI ${primaryError}; dynamic API returned no video`);
    statuses.bilibili = {
      status: "ok",
      updatedAt: new Date().toISOString(),
      message: `latest video updated via dynamic fallback (${bvid})`,
    };
    return buildBilibiliActivity(source, {
      bvid,
      title: archive.title,
      description: archive.desc,
      publishedAt: Number(dynamic.modules?.module_author?.pub_ts) * 1000,
      play: archive.stat?.play,
      cover: archive.cover,
    });
  } catch (error) {
    statuses.bilibili = { status: "error", updatedAt: new Date().toISOString(), message: error.message };
    return null;
  }
}

function emptyStatus() {
  return { status: "skipped", updatedAt: null, message: "not configured" };
}

function buildMonths() {
  const months = [];
  const formatter = new Intl.DateTimeFormat("en-US", { month: "short" });
  const now = new Date();
  for (let index = 11; index >= 0; index -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
    months.push(formatter.format(date).toUpperCase());
  }
  return months;
}

function currentStreak(grid) {
  let streak = 0;
  for (let index = grid.length - 1; index >= 0; index -= 1) {
    if (!grid[index]) break;
    streak += 1;
  }
  return streak;
}

function eventToCommit(event) {
  const repo = text(event.repo?.name, "GitHub");
  const payload = event.payload || {};
  if (event.type === "PushEvent") {
    const commit = payload.commits?.[0];
    return {
      title: text(commit?.message, `Push to ${repo}`).split("\n")[0],
      source: repo,
      time: isoDate(event.created_at),
    };
  }
  const labels = { WatchEvent: "Starred", CreateEvent: "Created", ReleaseEvent: "Released", IssuesEvent: "Issue activity", PullRequestEvent: "Pull request activity" };
  return { title: `${labels[event.type] || event.type} / ${repo}`, source: repo, time: isoDate(event.created_at) };
}

async function updateGithub(source, env, statuses) {
  if (!source?.enabled || !source.username) {
    statuses.github = emptyStatus();
    return {};
  }

  const token = tokenFor(source, env);
  const base = { username: source.username, months: buildMonths() };
  try {
    const profile = await fetchJson(`https://api.github.com/users/${encodeURIComponent(source.username)}`, { token });
    base.metrics = {
      contributions: { value: "--", label: "今年贡献" },
      streak: { value: "--", label: "连续天数" },
      repositories: { value: text(profile.public_repos, "--"), label: "公开仓库" },
    };
    const events = await fetchJson(`https://api.github.com/users/${encodeURIComponent(source.username)}/events/public?per_page=${source.eventsLimit || 8}`, { token });
    base.commits = Array.isArray(events) ? events.slice(0, 3).map(eventToCommit) : [];
    statuses.github = { status: "ok", updatedAt: new Date().toISOString(), message: "REST profile and events updated" };

    if (token) {
      const to = new Date();
      const yearStart = new Date(Date.UTC(to.getUTCFullYear(), 0, 1));
      const calendarFrom = new Date(to);
      calendarFrom.setUTCFullYear(calendarFrom.getUTCFullYear() - 1);
      const graphql = await fetchJson("https://api.github.com/graphql", {
        token,
        method: "POST",
        body: {
          query: `query($login:String!,$yearStart:DateTime!,$calendarFrom:DateTime!,$to:DateTime!){user(login:$login){yearToDate:contributionsCollection(from:$yearStart,to:$to){contributionCalendar{totalContributions}} rollingYear:contributionsCollection(from:$calendarFrom,to:$to){contributionCalendar{weeks{contributionDays{contributionCount date}}}}}}`,
          variables: {
            login: source.username,
            yearStart: yearStart.toISOString(),
            calendarFrom: calendarFrom.toISOString(),
            to: to.toISOString(),
          },
        },
      });
      const user = graphql.data?.user;
      const calendar = user?.rollingYear?.contributionCalendar;
      const grid = calendar?.weeks?.flatMap((week) => week.contributionDays.map((day) => day.contributionCount)) || [];
      if (grid.length) {
        base.contributionGrid = grid;
        base.metrics.contributions.value = text(user?.yearToDate?.contributionCalendar?.totalContributions, "--");
        base.metrics.streak.value = String(currentStreak(grid));
        statuses.github.message = "REST profile, events, and GraphQL contributions updated";
      }
    }
    base.integrationNote = `UPDATED ${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}`;
  } catch (error) {
    statuses.github = { status: "error", updatedAt: new Date().toISOString(), message: error.message };
    base.integrationNote = "UPDATE FAILED / USING LAST AVAILABLE DATA";
  }
  return { github: base };
}

async function updateSocialSource(key, source, env, statuses) {
  if (!source?.enabled || !source.url) {
    statuses[key] = emptyStatus();
    return null;
  }
  try {
    const payload = await fetchJson(source.url, { token: tokenFor(source, env) });
    const collection = getPath(payload, source.itemsPath) ?? payload;
    const items = Array.isArray(collection) ? collection : [];
    const item = items[0];
    if (!item) throw new Error("endpoint returned no items");
    const map = source.fieldMap || {};
    const title = text(getPath(item, map.title), `${key} update`);
    const summary = text(getPath(item, map.summary), title);
    statuses[key] = { status: "ok", updatedAt: new Date().toISOString(), message: `updated ${items.length} item(s)` };
    return {
      source: key,
      platform: text(source.platform, key),
      time: isoDate(getPath(item, map.time)) || "刚刚",
      title,
      summary,
      type: text(source.defaultType, "POST"),
      url: text(getPath(item, map.url)),
    };
  } catch (error) {
    statuses[key] = { status: "error", updatedAt: new Date().toISOString(), message: error.message };
    return null;
  }
}

async function main() {
  const config = await readJson(configPath).catch((error) => {
    if (error.code === "ENOENT") throw new Error(`Missing ${configPath}. Copy api-config.example.json first.`);
    throw error;
  });
  const env = { ...process.env, ...parseDotEnv(await readOptional(envPath)) };
  const previousData = await readGeneratedData(outputPath);
  const statuses = {};
  const result = {
    generatedAt: new Date().toISOString(),
    sourceStatus: statuses,
  };
  const githubUpdate = await updateGithub(config.github, env, statuses);
  if (statuses.github?.status === "error" && previousData.github) {
    result.github = {
      ...previousData.github,
      integrationNote: "UPDATE FAILED / USING LAST SUCCESSFUL DATA",
    };
    statuses.github.message = `${statuses.github.message}; using last successful data`;
  } else {
    Object.assign(result, githubUpdate);
  }

  const activity = [];
  for (const [key, source] of Object.entries(config.social || {})) {
    const item = key === "bilibili" && source.provider === "bilibili"
      ? await updateBilibili(source, statuses)
      : await updateSocialSource(key, source, env, statuses);
    if (item) {
      activity.push(item);
    } else if (source?.enabled && statuses[key]?.status === "error") {
      const cachedItem = previousData.activity?.find((entry) => entry.source === key);
      if (cachedItem) {
        activity.push(cachedItem);
        statuses[key].message = `${statuses[key].message}; using last successful data`;
      }
    }
  }
  if (activity.length) result.activity = activity;

  const output = `// Generated by automation/update-site-data.mjs at ${result.generatedAt}.\nwindow.PLAYER_HOME_LIVE_DATA = ${JSON.stringify(result, null, 2)};\n`;
  if (dryRun) {
    process.stdout.write(`${output}\n`);
    return;
  }
  const tempPath = `${outputPath}.tmp`;
  await writeFile(tempPath, output, "utf8");
  await rename(tempPath, outputPath);
  process.stdout.write(JSON.stringify({ output: outputPath, sourceStatus: statuses }, null, 2));
}

main().catch((error) => {
  process.stderr.write(`[player-home-update] ${error.message}\n`);
  process.exitCode = 1;
});
