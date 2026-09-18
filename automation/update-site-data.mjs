#!/usr/bin/env node

import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = resolve(SCRIPT_DIR, "..");
const DEFAULT_CONFIG = resolve(SCRIPT_DIR, "api-config.json");
const DEFAULT_ENV = resolve(SCRIPT_DIR, ".env");
const DEFAULT_OUTPUT = resolve(PROJECT_DIR, "data/site-data.js");
const USER_AGENT = "PLAYER_HOME local data updater";

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

async function fetchJson(url, { token = "", method = "GET", body } = {}) {
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

function emptyStatus() {
  return { status: "skipped", updatedAt: null, message: "not configured" };
}

function buildMonths() {
  const months = [];
  const formatter = new Intl.DateTimeFormat("en-US", { month: "short" });
  const now = new Date();
  for (let index = 5; index >= 0; index -= 1) {
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
      const from = new Date(Date.UTC(to.getUTCFullYear(), 0, 1));
      const graphql = await fetchJson("https://api.github.com/graphql", {
        token,
        method: "POST",
        body: {
          query: `query($login:String!,$from:DateTime!,$to:DateTime!){user(login:$login){contributionsCollection(from:$from,to:$to){contributionCalendar{totalContributions weeks{contributionDays{contributionCount date}}}}}}`,
          variables: { login: source.username, from: from.toISOString(), to: to.toISOString() },
        },
      });
      const collection = graphql.data?.user?.contributionsCollection;
      const grid = collection?.contributionCalendar?.weeks?.flatMap((week) => week.contributionDays.map((day) => day.contributionCount)).slice(-182) || [];
      if (grid.length) {
        base.contributionGrid = grid;
        base.metrics.contributions.value = text(collection.contributionCalendar.totalContributions, "--");
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
  const statuses = {};
  const result = {
    generatedAt: new Date().toISOString(),
    sourceStatus: statuses,
  };
  Object.assign(result, await updateGithub(config.github, env, statuses));

  const activity = [];
  for (const [key, source] of Object.entries(config.social || {})) {
    const item = await updateSocialSource(key, source, env, statuses);
    if (item) activity.push(item);
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
