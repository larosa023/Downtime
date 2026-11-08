import "./styles/base.css";
import "./styles/shell.css";
import "./styles/cards.css";
import "./styles/games.css";

import { applySettings, getSettings, onSettingsChange, setApplyHook, Settings, THEMES, updateSettings } from "./core/settings";
import { onStatsChange } from "./core/stats";
import { GROUPS, GameModule } from "./core/types";
import { installSuitSprite } from "./cards/deck";
import { GAMES, gameById } from "./games";
import { ICONS } from "./ui/icons";
import { checkForUpdate, installUpdate, onUpdateState, updateState } from "./core/updater";
import { evaluateAchievements } from "./core/achievements";
import { dailyDone, onDailyChange } from "./core/daily";
import { todayKey } from "./core/rng";
import { miniOn, setMini } from "./core/miniplayer";
import { sfx } from "./core/sound";
import { installAppFeel, setAlwaysOnTop, setZoom, toggleFullscreen } from "./core/native";
import { loadFonts } from "./ui/fonts";
import { gameIcon } from "./ui/shared";
import { showHome, showToday, randomGame } from "./ui/pages/home";
import { showStats } from "./ui/pages/stats";
import { showTrophies } from "./ui/pages/trophies";
import { renderSettingsUpdates, SECTIONS, setAchievementHook, showSettings } from "./ui/pages/settings";
import { GameView, showGame } from "./ui/pages/game";
import { closePalette, openPalette, PaletteItem, paletteOpen } from "./ui/palette";

applySettings();
installSuitSprite();
installAppFeel();
// Skip the web fonts entirely when the player picked the Windows font.
if (getSettings().font !== "system") loadFonts();
setApplyHook((s: Settings) => {
  void setZoom(s.scale / 100);
  void setAlwaysOnTop(s.alwaysOnTop || miniOn());
});

const app = document.getElementById("app")!;
app.innerHTML = `
  <div class="shell">
    <nav class="rail" aria-label="Games"></nav>
    <main class="stage" id="stage"></main>
  </div>
  <div class="global-toast" role="status" aria-live="polite"></div>`;

const rail = app.querySelector<HTMLElement>(".rail")!;
const stage = document.getElementById("stage")!;
let view: GameView | null = null;
let teardown: (() => void) | null = null;

// ---------------- sidebar ----------------

function navItem(g: GameModule) {
  return `<a class="nav-item" href="#/play/${g.id}" data-route="play/${g.id}" title="${g.name}">${gameIcon(g)}<span class="nav-label">${g.name}</span></a>`;
}

function railKey(s: Settings) {
  return JSON.stringify([s.theme, s.favorites, s.collapsed, s.compactRail, s.customTheme]);
}

function renderRail() {
  const s = getSettings();
  const favs = s.favorites.map(gameById).filter((g): g is GameModule => !!g);
  const group = (id: string, name: string, games: GameModule[]) => {
    if (!games.length) return "";
    const closed = s.collapsed.includes(id);
    return `<div class="nav-section${closed ? " closed" : ""}">
      <button class="nav-group" data-collapse="${id}" aria-expanded="${!closed}">${name}${ICONS.chevron}</button>
      <div class="nav-games">${games.map(navItem).join("")}</div>
    </div>`;
  };
  const scroll = rail.querySelector(".nav-scroll")?.scrollTop ?? 0;
  rail.innerHTML = `
    <a class="brand" href="#/" title="Downtime">
      <img src="/icon.png" alt="" width="28" height="28" />
      <span>Downtime</span>
    </a>
    <a class="nav-item" href="#/" data-route="home" title="Home">${ICONS.home}<span class="nav-label">Home</span></a>
    <a class="nav-item" href="#/today" data-route="today" title="Today">${ICONS.calendar}<span class="nav-label">Today</span>${todayBadge()}</a>
    <button class="nav-item nav-search" data-palette title="Search (Ctrl+K)">${ICONS.search}<span class="nav-label">Search</span><kbd class="nav-label">Ctrl K</kbd></button>
    <div class="nav-scroll">
      ${group("favorites", "Favorites", favs)}
      ${GROUPS.map((g) => group(g.id, g.name, GAMES.filter((x) => x.group === g.id))).join("")}
    </div>
    <div class="rail-foot">
      <div class="update-slot" aria-live="polite"></div>
      <a class="nav-item" href="#/trophies" data-route="trophies" title="Trophies">${ICONS.trophy}<span class="nav-label">Trophies</span></a>
      <a class="nav-item" href="#/stats" data-route="stats" title="Stats">${ICONS.stats}<span class="nav-label">Stats</span></a>
      <a class="nav-item" href="#/settings" data-route="settings" title="Settings">${ICONS.settings}<span class="nav-label">Settings</span></a>
      <div class="rail-tools">
        <div class="theme-dots" role="radiogroup" aria-label="Theme">
          ${THEMES.map((t) => {
            const [a, b] = t.id === "custom" ? [s.customTheme.bg, s.customTheme.accent] : t.swatch;
            return `<button class="theme-dot" role="radio" data-theme-pick="${t.id}" title="${t.name}" aria-label="${t.name} theme" aria-checked="${t.id === s.theme}" style="--a:${a};--b:${b}"></button>`;
          }).join("")}
        </div>
        <button class="rail-toggle" data-compact title="${s.compactRail ? "Expand sidebar" : "Collapse sidebar"}" aria-label="${s.compactRail ? "Expand sidebar" : "Collapse sidebar"}">${ICONS.sidebar}</button>
      </div>
    </div>`;
  const sc = rail.querySelector(".nav-scroll");
  if (sc) sc.scrollTop = scroll;
  markCurrent();
  renderUpdates();
}

function todayBadge() {
  const left = GAMES.filter((g) => g.daily && !dailyDone(g.id)).length;
  return left ? `<em class="nav-badge" aria-label="${left} daily puzzles left">${left}</em>` : "";
}

rail.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const pick = t.closest<HTMLElement>("[data-theme-pick]");
  if (pick) return updateSettings({ theme: pick.dataset.themePick as Settings["theme"] });
  const col = t.closest<HTMLElement>("[data-collapse]");
  if (col) {
    const id = col.dataset.collapse!;
    const c = getSettings().collapsed;
    return updateSettings({ collapsed: c.includes(id) ? c.filter((x) => x !== id) : [...c, id] });
  }
  if (t.closest("[data-compact]")) updateSettings({ compactRail: !getSettings().compactRail });
  if (t.closest("[data-palette]")) showPalette();
});

let lastRailKey = railKey(getSettings());
onSettingsChange((s) => {
  // Only rebuild the sidebar when something it shows has changed.
  const key = railKey(s);
  if (key !== lastRailKey) {
    lastRailKey = key;
    renderRail();
  }
});

function markCurrent() {
  const [page, arg] = location.hash.replace(/^#\/?/, "").split("/");
  const route = !page ? "home" : page === "play" ? `play/${arg}` : page;
  rail.querySelectorAll<HTMLElement>(".nav-item").forEach((a) => a.toggleAttribute("aria-current", a.dataset.route === route));
}

// ---------------- global toast (achievements) ----------------

const gToast = app.querySelector<HTMLElement>(".global-toast")!;
const toastQueue: string[] = [];
let toastBusy = false;

function globalToast(html: string) {
  toastQueue.push(html);
  if (!toastBusy) nextToast();
}

function nextToast() {
  const html = toastQueue.shift();
  if (!html) {
    toastBusy = false;
    return;
  }
  toastBusy = true;
  gToast.innerHTML = html;
  gToast.classList.add("show");
  setTimeout(() => {
    gToast.classList.remove("show");
    setTimeout(nextToast, 350);
  }, 3600);
}

function checkAchievements() {
  for (const a of evaluateAchievements()) {
    sfx.achieve();
    globalToast(`<span class="gt-icon">${ICONS.trophy}</span><span><strong>${a.name}</strong><small>${a.desc}</small></span>`);
  }
}
setAchievementHook(checkAchievements);
onStatsChange(checkAchievements);
onDailyChange(() => {
  checkAchievements();
  renderRail();
});

// ---------------- routing ----------------

function route() {
  const hash = location.hash.replace(/^#\/?/, "");
  const [page, arg] = hash.split("/");
  closePalette();

  // Moving between settings sections shouldn't rebuild the page.
  if (page === "settings" && !view && stage.querySelector(".settings-page")) {
    if (arg) stage.querySelector<HTMLElement>(`[data-nav="${arg}"]`)?.click();
    markCurrent();
    return;
  }

  teardown?.();
  teardown = null;
  view?.teardown();
  view = null;
  stage.innerHTML = "";
  stage.scrollTop = 0;
  markCurrent();

  if (page === "play" && arg && gameById(arg)) {
    if (getSettings().lastRoute !== `play/${arg}`) updateSettings({ lastRoute: `play/${arg}` });
    view = showGame(stage, gameById(arg)!);
    return;
  }
  if (miniOn()) void setMini(false);
  if (page === "today") return showToday(stage);
  if (page === "stats") return showStats(stage);
  if (page === "trophies") return showTrophies(stage);
  if (page === "settings") {
    teardown = showSettings(stage, arg);
    return;
  }
  showHome(stage);
}

window.addEventListener("hashchange", route);

// ---------------- command palette ----------------

let lastDark: Settings["theme"] = "slate";
let lastLight: Settings["theme"] = "paper";
const DARK = new Set(["slate", "felt", "midnight", "ember", "dusk", "contrast"]);

function isDark(): boolean {
  const s = getSettings();
  if (s.theme === "custom") return document.documentElement.style.colorScheme === "dark";
  return DARK.has(s.theme);
}

function toggleDark() {
  const s = getSettings();
  if (isDark()) {
    lastDark = s.theme;
    updateSettings({ theme: lastLight });
  } else {
    lastLight = s.theme;
    updateSettings({ theme: lastDark });
  }
}

function showPalette() {
  openPalette(() => {
    const items: PaletteItem[] = [];
    const inGame = view?.instance();
    if (view && inGame) {
      items.push(
        { label: "New game", icon: ICONS.refresh, hint: "F2", run: () => view?.requestNew() },
        { label: "Pause or resume", icon: ICONS.pause, hint: "P", run: () => view?.togglePause() },
      );
      if (inGame.undo) items.push({ label: "Undo", icon: ICONS.undo, hint: "Ctrl Z", run: () => inGame.undo?.() });
      if (inGame.requestHint && getSettings().hints) items.push({ label: "Hint", icon: ICONS.hint, hint: "H", run: () => inGame.requestHint?.() });
      items.push({ label: miniOn() ? "Leave the mini player" : "Mini player", icon: ICONS.mini, hint: "M", run: () => void setMini(!miniOn()) });
    }
    const page = (label: string, hash: string, icon: string, keywords = ""): PaletteItem => ({
      label,
      hint: "Page",
      icon,
      keywords,
      run: () => (location.hash = hash),
    });
    items.push(
      page("Home", "#/", ICONS.home),
      page("Today", "#/today", ICONS.calendar, "daily puzzles calendar"),
      page("Stats", "#/stats", ICONS.stats, "statistics history"),
      page("Trophies", "#/trophies", ICONS.trophy, "achievements"),
      page("Settings", "#/settings", ICONS.settings, "preferences options"),
      ...SECTIONS.map((x) => ({ label: `Settings: ${x.name}`, hint: "Settings", icon: ICONS.settings, run: () => (location.hash = `#/settings/${x.id}`) })),
      { label: "Random game", icon: ICONS.shuffle, keywords: "surprise", run: () => (location.hash = `#/play/${randomGame().id}`) },
      { label: isDark() ? "Switch to a light theme" : "Switch to a dark theme", icon: ICONS.moon, keywords: "theme dark light mode", run: toggleDark },
      ...THEMES.map((t) => ({ label: `Theme: ${t.name}`, hint: "Theme", icon: ICONS.moon, run: () => updateSettings({ theme: t.id }) })),
      { label: getSettings().sound ? "Turn sound off" : "Turn sound on", icon: ICONS.sound, keywords: "mute audio", run: () => updateSettings({ sound: !getSettings().sound }) },
      { label: "Full screen", icon: ICONS.fullscreen, hint: "F11", run: () => void toggleFullscreen() },
      { label: getSettings().compactRail ? "Expand the sidebar" : "Compact sidebar", icon: ICONS.sidebar, run: () => updateSettings({ compactRail: !getSettings().compactRail }) },
      { label: "Keyboard shortcuts", icon: ICONS.page, hint: "?", run: () => (location.hash = "#/settings/shortcuts") },
    );
    return items;
  });
}

// App-wide keys. Capture phase and registered before any game, so these always work.
window.addEventListener(
  "keydown",
  (e) => {
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (k === "k" || k === "p")) {
      e.preventDefault();
      e.stopImmediatePropagation();
      showPalette();
    } else if (e.key === "F11") {
      e.preventDefault();
      void toggleFullscreen();
    } else if (e.key === "?" && !(e.target as HTMLElement)?.closest?.("input, textarea, select") && !paletteOpen()) {
      e.preventDefault();
      location.hash = "#/settings/shortcuts";
    }
  },
  true,
);

// ---------------- updates ----------------

function renderUpdates() {
  const s = updateState();
  const slot = document.querySelector<HTMLElement>(".update-slot");
  const busy = s.kind === "downloading" || s.kind === "installing";
  if (slot) {
    if (s.kind === "available" || s.kind === "ready" || busy) {
      const v = s.version;
      const pct = s.kind === "downloading" ? Math.round(s.progress * 100) : s.kind === "installing" ? 100 : 0;
      const title = busy ? (s.kind === "installing" ? "Installing…" : `Downloading ${pct}%`) : s.kind === "ready" ? "Restart to update" : "Update available";
      slot.innerHTML = `
        <button class="update-banner" data-install ${busy ? "disabled" : ""} style="--p:${pct}%" title="Install version ${v}">
          <strong>${title}</strong>
          <span>${busy ? `Version ${v}` : s.kind === "ready" ? `Version ${v} is ready` : `Install version ${v}`}</span>
        </button>`;
      slot.querySelector("[data-install]")?.addEventListener("click", () => void installUpdate());
    } else slot.innerHTML = "";
  }
  renderSettingsUpdates();
}

onUpdateState(renderUpdates);
const autoCheck = () => {
  if (getSettings().updates !== "off") void checkForUpdate(true);
};
setTimeout(autoCheck, 2500);
setInterval(autoCheck, 6 * 60 * 60 * 1000);

// Refresh the Today badge when the date rolls over.
let day = todayKey();
setInterval(() => {
  if (todayKey() !== day) {
    day = todayKey();
    renderRail();
  }
}, 60 * 1000);

// ---------------- start ----------------

if (!location.hash || location.hash === "#/" || location.hash === "#") {
  const s = getSettings();
  if (s.startPage === "today") history.replaceState(null, "", "#/today");
  else if (s.startPage === "last" && gameById(s.lastRoute.split("/")[1] ?? "")) history.replaceState(null, "", `#/${s.lastRoute}`);
}

renderRail();
checkAchievements();
route();
