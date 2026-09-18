const mergeConfig = (base, override) => {
  if (!override || typeof override !== "object") return base;
  const output = Array.isArray(base) ? [...base] : { ...base };
  Object.entries(override).forEach(([key, value]) => {
    if (Array.isArray(value) && value.length === 0 && Array.isArray(output[key])) return;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      output[key] = mergeConfig(output[key] || {}, value);
    } else {
      output[key] = value;
    }
  });
  return output;
};

const liveData = window.PLAYER_HOME_LIVE_DATA || {};
const config = mergeConfig(window.PLAYER_HOME_CONFIG, liveData);
if (liveData.activity?.length) {
  const liveSources = new Set(liveData.activity.map((item) => item.source));
  config.activity = [
    ...liveData.activity,
    ...window.PLAYER_HOME_CONFIG.activity.filter((item) => !liveSources.has(item.source)),
  ];
}

const readPath = (source, path) => path.split(".").reduce((value, key) => value?.[key], source);
const setText = (element, value) => {
  if (element && value !== undefined && value !== null) element.textContent = value;
};

document.querySelectorAll("[data-config]").forEach((element) => {
  setText(element, readPath(config, element.dataset.config));
});

document.querySelectorAll("[data-stat]").forEach((element) => {
  const item = config.quickStats[element.dataset.stat];
  if (!item) return;
  setText(element.querySelector("[data-stat-label]"), item.label);
  setText(element.querySelector("[data-stat-value]"), item.value);
});

document.querySelectorAll("[data-social-row]").forEach((row) => {
  const item = config.socials.find((social) => social.key === row.dataset.socialRow);
  if (!item) return;
  row.querySelectorAll("[data-social-field]").forEach((field) => setText(field, item[field.dataset.socialField]));
  if (item.url) {
    row.href = item.url;
    row.target = "_blank";
    row.rel = "noreferrer";
    row.classList.remove("is-disabled");
    row.removeAttribute("aria-disabled");
  }
});

document.querySelectorAll("[data-gear]").forEach((row) => {
  const item = config.gear.find((gear) => gear.key === row.dataset.gear);
  if (!item) return;
  row.querySelectorAll("[data-gear-field]").forEach((field) => setText(field, item[field.dataset.gearField]));
});

document.querySelectorAll("[data-github-metric]").forEach((element) => {
  const item = config.github.metrics[element.dataset.githubMetric];
  if (!item) return;
  setText(element.querySelector("strong"), item.value);
  setText(element.querySelector("span"), item.label);
});

const monthContainer = document.querySelector("[data-github-months]");
config.github.months.forEach((month) => {
  const element = document.createElement("span");
  element.textContent = month;
  monthContainer?.appendChild(element);
});

document.querySelectorAll("[data-commit]").forEach((row) => {
  const item = config.github.commits[Number(row.dataset.commit)];
  if (!item) return;
  setText(row.querySelector("strong"), item.title);
  setText(row.querySelector("small"), item.source);
  setText(row.querySelector("time"), item.time);
});

document.querySelectorAll("[data-activity-source]").forEach((row) => {
  const item = config.activity.find((activity) => activity.source === row.dataset.activitySource);
  if (!item) return;
  row.querySelectorAll("[data-activity-field]").forEach((field) => setText(field, item[field.dataset.activityField]));
});

const crosshairPresets = Object.fromEntries(config.crosshairs.map((preset) => [preset.key, preset]));
const bootScreen = document.querySelector(".boot-screen");
const menuButton = document.querySelector(".menu-button");
const siteNav = document.querySelector(".site-nav");
const navLinks = [...document.querySelectorAll(".site-nav a")];
const revealItems = document.querySelectorAll(".reveal");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

window.addEventListener("load", () => {
  window.setTimeout(() => bootScreen?.classList.add("is-hidden"), reduceMotion ? 0 : 750);
});

menuButton?.addEventListener("click", () => {
  const isOpen = menuButton.getAttribute("aria-expanded") === "true";
  menuButton.setAttribute("aria-expanded", String(!isOpen));
  menuButton.setAttribute("aria-label", isOpen ? "打开导航" : "关闭导航");
  siteNav?.classList.toggle("is-open", !isOpen);
});

navLinks.forEach((link) => {
  link.addEventListener("click", () => {
    menuButton?.setAttribute("aria-expanded", "false");
    siteNav?.classList.remove("is-open");
  });
});

const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        revealObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.12 },
);
revealItems.forEach((item) => revealObserver.observe(item));

const sections = [...document.querySelectorAll("main section[id]")];
const sectionObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      navLinks.forEach((link) => link.classList.toggle("is-active", link.getAttribute("href") === `#${entry.target.id}`));
    });
  },
  { rootMargin: "-30% 0px -65% 0px" },
);
sections.forEach((section) => sectionObserver.observe(section));

const contributionGrid = document.querySelector("[data-contribution-grid]");
if (contributionGrid) {
  const activityPattern = [0, 0, 1, 0, 2, 0, 1, 3, 0, 0, 2, 1, 0, 4, 0, 1, 2];
  const liveGrid = config.github.contributionGrid || [];
  const cellCount = liveGrid.length || 364;
  const weekCount = Math.ceil(cellCount / 7);
  contributionGrid.parentElement?.style.setProperty("--week-count", String(weekCount));
  contributionGrid.parentElement?.style.setProperty("--contribution-width", `${weekCount * 13 - 3}px`);
  for (let index = 0; index < cellCount; index += 1) {
    const cell = document.createElement("i");
    const count = liveGrid[index] ?? activityPattern[(index * 7 + Math.floor(index / 11)) % activityPattern.length];
    const level = count === 0 ? 0 : count === 1 ? 1 : count <= 3 ? 2 : count <= 6 ? 3 : 4;
    cell.dataset.level = String(level);
    cell.title = liveGrid.length ? `贡献数 ${count}` : `演示贡献等级 ${level}`;
    contributionGrid.appendChild(cell);
  }
}

const crosshairShape = document.querySelector("[data-crosshair-shape]");
const crosshairName = document.querySelector("#crosshair-name");
const crosshairColor = document.querySelector("#crosshair-color");
const crosshairOutline = document.querySelector("#crosshair-outline");
const crosshairCenter = document.querySelector("#crosshair-center");
const crosshairCode = document.querySelector("#crosshair-code");
const copyStatus = document.querySelector(".copy-status");

document.querySelectorAll("[data-preset]").forEach((tab) => {
  const preset = crosshairPresets[tab.dataset.preset];
  if (preset) tab.textContent = preset.tabLabel;
  tab.addEventListener("click", () => applyCrosshair(tab.dataset.preset));
});

function applyCrosshair(presetName) {
  const preset = crosshairPresets[presetName];
  if (!preset) return;
  document.querySelectorAll("[data-preset]").forEach((button) => {
    const isCurrent = button.dataset.preset === presetName;
    button.classList.toggle("is-active", isCurrent);
    button.setAttribute("aria-selected", String(isCurrent));
  });
  crosshairShape.dataset.crosshairShape = presetName;
  crosshairShape.style.color = preset.previewColor;
  setText(crosshairName, preset.name);
  setText(crosshairColor, preset.color);
  setText(crosshairOutline, preset.outline);
  setText(crosshairCenter, preset.center);
  setText(crosshairCode, preset.code);
  setText(copyStatus, "");
}

applyCrosshair(config.crosshairs[0].key);

document.querySelector("[data-copy-crosshair]")?.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(crosshairCode.textContent);
    copyStatus.textContent = "代码已复制";
  } catch {
    copyStatus.textContent = "复制失败，请手动选择代码";
  }
});

const feedItems = [...document.querySelectorAll(".feed-item")];
const feedEmpty = document.querySelector(".feed-empty");
document.querySelectorAll("[data-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    const filter = button.dataset.filter;
    document.querySelectorAll("[data-filter]").forEach((item) => item.classList.toggle("is-active", item === button));
    let visibleCount = 0;
    feedItems.forEach((item) => {
      const isVisible = filter === "all" || item.dataset.activitySource === filter;
      item.hidden = !isVisible;
      if (isVisible) visibleCount += 1;
    });
    feedEmpty.hidden = visibleCount > 0;
  });
});

document.querySelectorAll("a[aria-disabled='true']").forEach((link) => {
  link.addEventListener("click", (event) => event.preventDefault());
});

setText(document.querySelector("[data-current-year]"), String(new Date().getFullYear()));
setText(document.querySelector(".footer-copy"), `© ${new Date().getFullYear()} ${config.profile.footerName}`);
