import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/figtree";
import "./styles/base.css";
import "./styles/shell.css";
import "./styles/cards.css";
import "./styles/games.css";

import {
  applySettings,
  CardBack,
  getGameOption,
  getSettings,
  onSettingsChange,
  setGameOption,
  SoundGroup,
  THEMES,
  toggleFavorite,
  updateSettings,
} from "./core/settings";
import { allStats, formatTime, getStats, onStatsChange, resetStats } from "./core/stats";
import { load } from "./core/storage";
import { GameContext, GameInstance, GameModule, GROUPS, StatusItem } from "./core/types";
import { installSuitSprite } from "./cards/deck";
import { GAMES, gameById } from "./games";
import { gameArt } from "./ui/art";
import { GAME_ICONS, ICONS } from "./ui/icons";
import { appVersion, checkForUpdate, installUpdate, onUpdateState, updateState, UpdateState } from "./core/updater";
import { ACHIEVEMENTS, evaluateAchievements, resetAchievements, unlockedAt, unlockedCount } from "./core/achievements";
import { dailyDone, dailyLog, dailyStreak, onDailyChange } from "./core/daily";
import { dayNumber, todayKey } from "./core/rng";
import { miniOn, onMiniChange, setMini } from "./core/miniplayer";
import { sfx } from "./core/sound";

applySettings();
installSuitSprite();

const app = document.getElementById("app")!;
app.innerHTML = `
  <div class="shell">
    <nav class="rail" aria-label="Games"></nav>
    <main class="stage" id="stage"></main>
  </div>
  <div class="global-toast" role="status" aria-live="polite"></div>`;

const rail = app.querySelector<HTMLElement>(".rail")!;
const stage = document.getElementById("stage")!;
let current: { game: GameModule; instance: GameInstance } | null = null;
let teardown: (() => void) | null = null;

const optionValue = (g: GameModule, key: string) => getGameOption(g.id, key, g.options?.find((o) => o.key === key)?.default ?? "");

// ---------------- sidebar ----------------

function gameIcon(g: GameModule) {
  if (g.iconSvg)
    return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${g.iconSvg}</svg>`;
  return GAME_ICONS[g.id] ?? "";
}

function navItem(g: GameModule) {
  return `<a class="nav-item" href="#/play/${g.id}" data-route="play/${g.id}" title="${g.name}">${gameIcon(g)}<span class="nav-label">${g.name}</span></a>`;
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
  rail.innerHTML = `
    <a class="brand" href="#/" title="Downtime">
      <img src="/icon.png" alt="" width="28" height="28" />
      <span>Downtime</span>
    </a>
    <a class="nav-item" href="#/" data-route="home" title="Home">${ICONS.home}<span class="nav-label">Home</span></a>
    <a class="nav-item" href="#/today" data-route="today" title="Today">${ICONS.calendar}<span class="nav-label">Today</span>${todayBadge()}</a>
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
          ${THEMES.map(
            (t) =>
              `<button class="theme-dot" role="radio" data-theme-pick="${t.id}" title="${t.name}" aria-label="${t.name} theme" aria-checked="${t.id === s.theme}" style="--a:${t.swatch[0]};--b:${t.swatch[1]}"></button>`,
          ).join("")}
        </div>
        <button class="rail-toggle" data-compact title="${s.compactRail ? "Expand sidebar" : "Collapse sidebar"}" aria-label="${s.compactRail ? "Expand sidebar" : "Collapse sidebar"}">${ICONS.sidebar}</button>
      </div>
    </div>`;
  markCurrent();
  renderUpdates();
}

function todayBadge() {
  const dailies = GAMES.filter((g) => g.daily);
  const left = dailies.filter((g) => !dailyDone(g.id)).length;
  return left ? `<em class="nav-badge" aria-label="${left} daily puzzles left">${left}</em>` : "";
}

rail.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const pick = t.closest<HTMLElement>("[data-theme-pick]");
  if (pick) return updateSettings({ theme: pick.dataset.themePick as never });
  const col = t.closest<HTMLElement>("[data-collapse]");
  if (col) {
    const id = col.dataset.collapse!;
    const c = getSettings().collapsed;
    return updateSettings({ collapsed: c.includes(id) ? c.filter((x) => x !== id) : [...c, id] });
  }
  if (t.closest("[data-compact]")) updateSettings({ compactRail: !getSettings().compactRail });
});

let lastRailKey = "";
onSettingsChange((s) => {
  // Only rebuild the sidebar when something it shows has changed.
  const key = JSON.stringify([s.theme, s.favorites, s.collapsed, s.compactRail]);
  if (key !== lastRailKey) {
    lastRailKey = key;
    renderRail();
  }
});

function markCurrent() {
  const hash = location.hash.replace(/^#\/?/, "") || "home";
  rail.querySelectorAll<HTMLElement>(".nav-item").forEach((a) => a.toggleAttribute("aria-current", a.dataset.route === hash));
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
onStatsChange(checkAchievements);
onDailyChange(() => {
  checkAchievements();
  const badge = rail.querySelector('[data-route="today"]');
  if (badge) renderRail();
});

// ---------------- routing ----------------

function route() {
  const hash = location.hash.replace(/^#\/?/, "");
  teardown?.();
  teardown = null;
  if (current) {
    current.instance.destroy();
    current = null;
  }
  stage.innerHTML = "";
  stage.scrollTop = 0;
  markCurrent();

  const [view, arg] = hash.split("/");
  if (view === "play" && arg && gameById(arg)) return showGame(gameById(arg)!);
  if (miniOn()) void setMini(false);
  if (view === "today") return showToday();
  if (view === "stats") return showStats();
  if (view === "trophies") return showTrophies();
  if (view === "settings") return showSettings();
  showHome();
}

window.addEventListener("hashchange", route);

// ---------------- home ----------------

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "Up late.";
  if (h < 12) return "Good morning.";
  if (h < 17) return "Good afternoon.";
  return "Good evening.";
}

function tileMeta(g: GameModule) {
  const s = getStats(g.statsKey((k) => optionValue(g, k)));
  if (!s.played) return "Not played yet";
  if (s.bestTime != null) return `Best ${formatTime(s.bestTime)}`;
  if (s.bestScore != null) return `Best score ${s.bestScore}`;
  if (s.won) return `${s.won} won of ${s.played}`;
  return `${s.played} played`;
}

function inProgress(g: GameModule): boolean {
  const s = load<{ moves?: number; score?: number; cells?: number[]; values?: number[]; guesses?: unknown[] } | null>(`save:${g.id}`, null);
  return !!s && ((s.moves ?? 0) > 0 || (s.score ?? 0) > 0);
}

/** Games ordered by when they were last played. */
function recentGames(limit: number): GameModule[] {
  const last = new Map<string, number>();
  for (const [k, s] of Object.entries(allStats())) {
    const id = k.split(":")[0];
    if (s.lastPlayed && (last.get(id) ?? 0) < s.lastPlayed) last.set(id, s.lastPlayed);
  }
  return GAMES.filter((g) => last.has(g.id) || inProgress(g))
    .sort((a, b) => (last.get(b.id) ?? Date.now()) - (last.get(a.id) ?? Date.now()))
    .slice(0, limit);
}

function tile(g: GameModule) {
  const fav = getSettings().favorites.includes(g.id);
  return `
    <div class="tile-wrap">
      <a class="tile" href="#/play/${g.id}">
        <div class="tile-art">${g.artSvg ? `<svg class="art" viewBox="0 0 252 144" aria-hidden="true">${g.artSvg}</svg>` : gameArt(g.art)}</div>
        <div class="tile-body">
          <h3>${g.name}</h3>
          <p>${g.blurb}</p>
          <span class="tile-meta">${tileMeta(g)}</span>
        </div>
      </a>
      <button class="fav${fav ? " on" : ""}" data-fav="${g.id}" aria-pressed="${fav}" aria-label="${fav ? "Remove from" : "Add to"} favorites" title="${fav ? "Remove from" : "Add to"} favorites">${fav ? ICONS.starFilled : ICONS.star}</button>
    </div>`;
}

function dailyCards() {
  const dailies = GAMES.filter((g) => g.daily);
  return `<div class="daily-row">${dailies
    .map((g) => {
      const done = dailyDone(g.id);
      return `<button class="daily-card${done ? " done" : ""}" data-daily="${g.id}">
        <span class="daily-icon">${gameIcon(g)}</span>
        <span class="daily-text"><strong>${g.name}</strong><small>${done ? "Done for today" : `Daily #${dayNumber()}`}</small></span>
        ${done ? `<span class="daily-check">${ICONS.check}</span>` : ""}
      </button>`;
    })
    .join("")}</div>`;
}

function bindHome() {
  stage.querySelectorAll<HTMLElement>("[data-fav]").forEach((b) =>
    b.addEventListener("click", () => {
      toggleFavorite(b.dataset.fav!);
      showHome();
    }),
  );
  stage.querySelectorAll<HTMLElement>("[data-daily]").forEach((b) =>
    b.addEventListener("click", () => {
      setGameOption(b.dataset.daily!, "mode", "daily");
      location.hash = `#/play/${b.dataset.daily}`;
    }),
  );
}

function showHome() {
  document.title = "Downtime";
  const s = getSettings();
  const favs = s.favorites.map(gameById).filter((g): g is GameModule => !!g);
  const recent = recentGames(6);
  const streak = dailyStreak();
  stage.innerHTML = `
    <div class="home">
      <header class="home-head">
        <h1>${greeting()}</h1>
        <p>Pick something to play.</p>
      </header>
      <section aria-label="Today's puzzles">
        <div class="section-head"><h2>Today's puzzles</h2>${streak ? `<span class="streak">${streak}-day streak</span>` : ""}<a class="more" href="#/today">Calendar</a></div>
        ${dailyCards()}
      </section>
      ${
        recent.length
          ? `<section class="resume" aria-label="Recently played">
              <h2>Recently played</h2>
              <div class="resume-row">${recent
                .map((g) => `<a class="chip" href="#/play/${g.id}">${gameIcon(g)}<span>${g.name}</span>${inProgress(g) ? `<em class="chip-dot" title="Game in progress"></em>` : ""}</a>`)
                .join("")}</div>
            </section>`
          : ""
      }
      ${favs.length ? `<section aria-label="Favorites"><h2>Favorites</h2><div class="tiles">${favs.map(tile).join("")}</div></section>` : ""}
      ${GROUPS.map((grp) => {
        const games = GAMES.filter((g) => g.group === grp.id);
        return games.length ? `<section aria-label="${grp.name}"><h2>${grp.name}</h2><div class="tiles">${games.map(tile).join("")}</div></section>` : "";
      }).join("")}
    </div>`;
  bindHome();
}

// ---------------- today / daily calendar ----------------

function showToday() {
  document.title = "Today — Downtime";
  const log = dailyLog();
  const total = GAMES.filter((g) => g.daily).length;
  const days: string[] = [];
  const d = new Date();
  // Six weeks, ending with the current week (Sunday first).
  d.setDate(d.getDate() - d.getDay() - 35);
  for (let i = 0; i < 42; i++) {
    const key = todayKey(d);
    const n = log[key]?.length ?? 0;
    const future = d > new Date();
    const level = n === 0 ? 0 : n >= total ? 3 : n >= 2 ? 2 : 1;
    days.push(
      `<span class="cal-day l${level}${key === todayKey() ? " today" : ""}${future ? " future" : ""}" title="${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}: ${n} of ${total}">${d.getDate()}</span>`,
    );
    d.setDate(d.getDate() + 1);
  }
  const streak = dailyStreak();
  const solvedDays = Object.values(log).filter((x) => x.length).length;
  stage.innerHTML = `
    <div class="page">
      <header class="page-head"><h1>Today</h1><p>Daily #${dayNumber()}. Everyone gets the same puzzles each day, and new ones arrive at midnight.</p></header>
      ${dailyCards()}
      <section class="setting">
        <div class="cal-head"><h2>Calendar</h2><span class="dim">${streak ? `${streak}-day streak · ` : ""}${solvedDays} day${solvedDays === 1 ? "" : "s"} played</span></div>
        <div class="cal">
          ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((w) => `<span class="cal-w">${w}</span>`).join("")}
          ${days.join("")}
        </div>
        <p class="cal-legend dim"><span class="cal-day l1"></span> some <span class="cal-day l2"></span> most <span class="cal-day l3"></span> all ${total} puzzles</p>
      </section>
    </div>`;
  bindHome();
}

// ---------------- game view ----------------

function showGame(game: GameModule) {
  document.title = `${game.name} — Downtime`;
  const opt = (key: string) => optionValue(game, key);
  const fav = () => getSettings().favorites.includes(game.id);
  stage.innerHTML = `
    <div class="play">
      <header class="bar">
        <h1>${game.name}</h1>
        <button class="icon-btn fav-btn${fav() ? " on" : ""}" data-act="fav" aria-pressed="${fav()}" title="Favorite">${fav() ? ICONS.starFilled : ICONS.star}</button>
        <div class="opts">
          ${(game.options ?? [])
            .map(
              (o) => `<label class="select"><span class="sr-only">${o.label}</span>
                <select data-opt="${o.key}">${o.choices
                  .map((c) => `<option value="${c.value}" ${c.value === opt(o.key) ? "selected" : ""}>${c.label}</option>`)
                  .join("")}</select></label>`,
            )
            .join("")}
        </div>
        <dl class="status" aria-live="off"></dl>
        <div class="actions">
          <button class="btn ghost" data-act="finish" title="Finish the game automatically" hidden>${ICONS.finish}<span>Finish</span></button>
          <button class="btn ghost" data-act="hint" title="Hint (H)" hidden>${ICONS.hint}<span>Hint</span></button>
          ${game.hasUndo ? `<button class="btn ghost" data-act="undo" title="Undo (Ctrl+Z)" disabled>${ICONS.undo}<span>Undo</span></button>` : ""}
          <button class="btn" data-act="new" title="New game (F2)">${ICONS.refresh}<span>New game</span></button>
          <button class="icon-btn" data-act="mini" title="Mini player (M)" aria-pressed="${miniOn()}">${miniOn() ? ICONS.expand : ICONS.mini}</button>
        </div>
      </header>
      <div class="board-wrap">
        <div class="board" data-game="${game.id}"></div>
        <div class="end" hidden></div>
        <div class="toast" role="status" aria-live="polite"></div>
      </div>
    </div>`;

  const board = stage.querySelector<HTMLElement>(".board")!;
  const statusEl = stage.querySelector<HTMLElement>(".status")!;
  const undoBtn = stage.querySelector<HTMLButtonElement>('[data-act="undo"]');
  const hintBtn = stage.querySelector<HTMLButtonElement>('[data-act="hint"]')!;
  const finishBtn = stage.querySelector<HTMLButtonElement>('[data-act="finish"]')!;
  const miniBtn = stage.querySelector<HTMLButtonElement>('[data-act="mini"]')!;
  const endEl = stage.querySelector<HTMLElement>(".end")!;
  const toastEl = stage.querySelector<HTMLElement>(".toast")!;
  let toastTimer = 0;
  let lastStatus = "";

  const ctx: GameContext = {
    setStatus(items: StatusItem[]) {
      const html = items.map((i) => `<div><dt>${i.label}</dt><dd>${i.value}</dd></div>`).join("");
      if (html !== lastStatus) {
        statusEl.innerHTML = html;
        lastStatus = html;
      }
    },
    setUndo(enabled) {
      if (undoBtn) undoBtn.disabled = !enabled;
    },
    end(summary) {
      finishBtn.hidden = true;
      endEl.hidden = false;
      endEl.className = `end ${summary.won ? "won" : "lost"}`;
      endEl.innerHTML = `
        <div class="end-card" role="dialog" aria-label="${summary.title}">
          <h2>${summary.title}</h2>
          ${summary.lines.map((l) => `<p>${l}</p>`).join("")}
          <div class="end-actions">
            ${game.hasUndo && !summary.won ? `<button class="btn ghost" data-act="undo">${ICONS.undo}<span>Undo last move</span></button>` : ""}
            <button class="btn" data-act="new" autofocus>${ICONS.refresh}<span>New game</span></button>
          </div>
        </div>`;
      endEl.querySelector<HTMLButtonElement>('[data-act="new"]')?.focus();
    },
    clearEnd() {
      endEl.hidden = true;
      endEl.innerHTML = "";
    },
    toast(message) {
      toastEl.textContent = message;
      toastEl.classList.add("show");
      clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => toastEl.classList.remove("show"), 2600);
    },
    option: opt,
    setFinish(visible) {
      finishBtn.hidden = !visible;
    },
  };

  let mountSeq = 0;
  const mount = async () => {
    const seq = ++mountSeq;
    board.innerHTML = "";
    finishBtn.hidden = true;
    let create = game.create;
    if (!create && game.load) {
      board.classList.add("loading");
      create = (await game.load()).create;
      board.classList.remove("loading");
      // The player may have left or changed options while the chunk loaded.
      if (seq !== mountSeq || !board.isConnected) return;
    }
    current = { game, instance: create!(board, ctx) };
    hintBtn.hidden = typeof current.instance.requestHint !== "function";
  };
  void mount();

  stage.querySelector(".play")!.addEventListener("click", (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>("[data-act]")?.dataset.act;
    if (act === "new") current?.instance.newGame();
    else if (act === "undo") current?.instance.undo?.();
    else if (act === "hint") current?.instance.requestHint?.();
    else if (act === "finish") current?.instance.autoFinish?.();
    else if (act === "mini") void setMini(!miniOn());
    else if (act === "fav") {
      const on = toggleFavorite(game.id);
      const b = stage.querySelector<HTMLElement>('[data-act="fav"]')!;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
      b.innerHTML = on ? ICONS.starFilled : ICONS.star;
    }
  });

  stage.querySelectorAll<HTMLSelectElement>("select[data-opt]").forEach((sel) =>
    sel.addEventListener("change", () => {
      setGameOption(game.id, sel.dataset.opt!, sel.value);
      sel.blur();
      current?.instance.destroy();
      current = null;
      ctx.clearEnd();
      void mount();
    }),
  );

  const offMini = onMiniChange((on) => {
    miniBtn.innerHTML = on ? ICONS.expand : ICONS.mini;
    miniBtn.setAttribute("aria-pressed", String(on));
    setTimeout(() => current?.instance.resize?.(), 250);
  });

  const onKey = (e: KeyboardEvent) => {
    const typing = (e.target as HTMLElement)?.closest?.("select, input, textarea");
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      current?.instance.undo?.();
    } else if (e.key === "F2" || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n")) {
      e.preventDefault();
      current?.instance.newGame();
    } else if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === "m" || e.key === "M") && !game.options?.some((o) => o.key === "mode" && opt("mode") === "daily" && game.group === "words")) {
      // M toggles the mini player, except while typing words.
      if (game.group !== "words") void setMini(!miniOn());
    } else if (!typing && (e.key === "h" || e.key === "H") && game.group === "cards") {
      current?.instance.requestHint?.();
    }
  };
  window.addEventListener("keydown", onKey);
  teardown = () => {
    window.removeEventListener("keydown", onKey);
    offMini();
  };
}

// ---------------- stats ----------------

function variantLabel(key: string): { game: string; variant: string } {
  const [id, ...rest] = key.split(":");
  const g = gameById(id);
  const name = g?.name ?? id;
  const labels: Record<string, string> = {
    "1suit": "1 suit", "2suit": "2 suits", "4suit": "4 suits",
    easy: "Easy", medium: "Medium", hard: "Hard", relaxed: "Relaxed", normal: "Normal", fast: "Fast",
    small: "Small", large: "Large", daily: "Daily", practice: "Practice",
    walls: "walls", wrap: "wrap", std: "",
  };
  return { game: name, variant: rest.map((r) => labels[r] ?? r).join(", ") };
}

function showStats() {
  document.title = "Stats — Downtime";
  const entries = Object.entries(allStats())
    .filter(([key, s]) => s.played > 0 && gameById(key.split(":")[0]))
    .sort(([a], [b]) => GAMES.findIndex((g) => a.split(":")[0] === g.id) - GAMES.findIndex((g) => b.split(":")[0] === g.id) || a.localeCompare(b));
  const totals = Object.values(allStats()).reduce((t, s) => ({ played: t.played + s.played, won: t.won + s.won }), { played: 0, won: 0 });
  const rows = entries
    .map(([key, s]) => {
      const { game, variant } = variantLabel(key);
      const rate = s.played ? Math.round((s.won / s.played) * 100) : 0;
      const scoreGame = s.bestScore != null && s.bestTime == null && !s.won;
      return `<tr>
        <th scope="row">${game}${variant ? `<span class="variant">${variant}</span>` : ""}</th>
        <td>${s.played}</td>
        <td>${scoreGame ? "—" : `${s.won} <span class="dim">(${rate}%)</span>`}</td>
        <td>${s.bestTime != null ? formatTime(s.bestTime) : "—"}</td>
        <td>${s.bestScore != null ? s.bestScore : "—"}</td>
        <td>${scoreGame ? "—" : s.bestStreak}</td>
      </tr>`;
    })
    .join("");
  stage.innerHTML = `
    <div class="page">
      <header class="page-head"><h1>Stats</h1><p>${totals.played ? `${totals.played} games played, ${totals.won} won, on this computer.` : "Everything you play on this computer."}</p></header>
      ${
        entries.length
          ? `<div class="table-wrap"><table class="stats">
              <thead><tr><th scope="col">Game</th><th scope="col">Played</th><th scope="col">Won</th><th scope="col">Best time</th><th scope="col">Best score</th><th scope="col">Best streak</th></tr></thead>
              <tbody>${rows}</tbody>
            </table></div>`
          : `<div class="empty"><p>No games played yet. Your results will show up here.</p><a class="btn" href="#/">Choose a game</a></div>`
      }
    </div>`;
}

// ---------------- trophies ----------------

function showTrophies() {
  document.title = "Trophies — Downtime";
  const n = unlockedCount();
  stage.innerHTML = `
    <div class="page wide">
      <header class="page-head"><h1>Trophies</h1><p>${n} of ${ACHIEVEMENTS.length} unlocked.</p>
        <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${ACHIEVEMENTS.length}" aria-valuenow="${n}"><i style="width:${(n / ACHIEVEMENTS.length) * 100}%"></i></div>
      </header>
      <div class="trophies">
        ${ACHIEVEMENTS.map((a) => {
          const at = unlockedAt(a.id);
          return `<div class="trophy${at ? " got" : ""}">
            <span class="trophy-icon">${at ? ICONS.trophy : ICONS.lock}</span>
            <span class="trophy-text"><strong>${a.name}</strong><small>${a.desc}</small>${at ? `<em>${new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</em>` : ""}</span>
          </div>`;
        }).join("")}
      </div>
    </div>`;
}

// ---------------- settings ----------------

function toggle(key: string, label: string, on: boolean, hint = "") {
  return `<label class="toggle"><input type="checkbox" data-set="${key}" ${on ? "checked" : ""}/><span class="switch"></span><span>${label}${hint ? `<small>${hint}</small>` : ""}</span></label>`;
}

function showSettings() {
  document.title = "Settings — Downtime";
  const s = getSettings();
  const backs: { id: CardBack; name: string }[] = [
    { id: "weave", name: "Weave" },
    { id: "dots", name: "Dots" },
    { id: "plain", name: "Plain" },
    { id: "stripes", name: "Stripes" },
    { id: "checker", name: "Checker" },
  ];
  const groups: { id: SoundGroup; name: string }[] = [
    { id: "cards", name: "Cards (deal, flip, place)" },
    { id: "moves", name: "Moves (ticks, matches, eating)" },
    { id: "results", name: "Results (wins, losses, mistakes, trophies)" },
  ];
  stage.innerHTML = `
    <div class="page">
      <header class="page-head"><h1>Settings</h1></header>
      <section class="setting">
        <h2>Theme</h2>
        <div class="themes" role="radiogroup" aria-label="Theme">
          ${THEMES.map(
            (t) => `<button class="theme-card" role="radio" aria-checked="${t.id === s.theme}" data-set-theme="${t.id}">
              <span class="theme-preview" data-theme="${t.id}"><i></i><i></i><i></i></span>
              <span>${t.name}</span>
            </button>`,
          ).join("")}
        </div>
        <div class="accent-row">
          <label class="accent-pick"><input type="color" data-accent value="${s.accent || "#2e6f8e"}"/><span>Custom accent color</span></label>
          <button class="btn ghost" data-accent-reset ${s.accent ? "" : "disabled"}>Use the theme's color</button>
        </div>
      </section>
      <section class="setting">
        <h2>Cards</h2>
        <div class="backs" role="radiogroup" aria-label="Card back">
          ${backs
            .map(
              (b) => `<button class="back-card" role="radio" aria-checked="${b.id === s.cardBack}" data-set-back="${b.id}">
                <span class="back-preview" data-back="${b.id}"><span class="card-back"></span></span>
                <span>${b.name}</span>
              </button>`,
            )
            .join("")}
        </div>
        <div class="toggles">
          ${toggle("fourColor", "Four-color deck", s.fourColor, "Diamonds blue, clubs green")}
          ${toggle("largeCards", "Large print", s.largeCards, "Bigger numbers in the card corners")}
        </div>
      </section>
      <section class="setting">
        <h2>Sound</h2>
        ${toggle("sound", "Sound effects", s.sound)}
        <label class="slider"><span>Volume</span><input type="range" min="0" max="100" step="5" value="${s.volume}" data-volume ${s.sound ? "" : "disabled"}/><output>${s.volume}</output></label>
        <div class="sound-groups">
          ${groups
            .map(
              (g) =>
                `<label class="check"><input type="checkbox" data-sound-group="${g.id}" ${s.soundGroups[g.id] ? "checked" : ""} ${s.sound ? "" : "disabled"}/><span>${g.name}</span></label>`,
            )
            .join("")}
        </div>
      </section>
      <section class="setting">
        <h2>Layout and motion</h2>
        ${toggle("compactRail", "Compact sidebar", s.compactRail, "Show game icons only")}
        ${toggle("motion", "Animations", s.motion)}
        <p class="dim">The mini player button in a game's top bar (or the M key) shrinks Downtime to a small window that stays on top of other apps.</p>
      </section>
      <section class="setting updates-setting" ${updateState().kind === "unsupported" ? "hidden" : ""}>
        <h2>Updates</h2>
        <p class="dim">Downtime <span data-version></span>. It checks for new versions when it starts.</p>
        <div class="update-row">
          <button class="btn ghost" data-check>${ICONS.refresh}<span>Check for updates</span></button>
          <span class="update-msg" aria-live="polite"></span>
        </div>
      </section>
      <section class="setting">
        <h2>Data</h2>
        <p class="dim">Stats, trophies and games in progress are saved on this computer.</p>
        <button class="btn danger" data-reset>Reset stats and trophies</button>
      </section>
    </div>`;

  stage.querySelectorAll<HTMLElement>("[data-set-theme]").forEach((b) =>
    b.addEventListener("click", () => {
      updateSettings({ theme: b.dataset.setTheme as never });
      showSettings();
    }),
  );
  stage.querySelectorAll<HTMLElement>("[data-set-back]").forEach((b) =>
    b.addEventListener("click", () => {
      updateSettings({ cardBack: b.dataset.setBack as CardBack });
      showSettings();
    }),
  );
  stage.querySelectorAll<HTMLInputElement>("input[data-set]").forEach((i) =>
    i.addEventListener("change", () => {
      updateSettings({ [i.dataset.set!]: i.checked });
      if (i.dataset.set === "sound") showSettings();
    }),
  );
  const accent = stage.querySelector<HTMLInputElement>("[data-accent]")!;
  accent.addEventListener("input", () => updateSettings({ accent: accent.value }));
  accent.addEventListener("change", () => showSettings());
  stage.querySelector("[data-accent-reset]")?.addEventListener("click", () => {
    updateSettings({ accent: "" });
    showSettings();
  });
  const vol = stage.querySelector<HTMLInputElement>("[data-volume]")!;
  vol.addEventListener("input", () => {
    updateSettings({ volume: Number(vol.value) });
    vol.nextElementSibling!.textContent = vol.value;
  });
  vol.addEventListener("change", () => sfx.place());
  stage.querySelectorAll<HTMLInputElement>("[data-sound-group]").forEach((i) =>
    i.addEventListener("change", () => updateSettings({ soundGroups: { ...getSettings().soundGroups, [i.dataset.soundGroup!]: i.checked } })),
  );
  void appVersion().then((v) => {
    const el = stage.querySelector("[data-version]");
    if (el) el.textContent = `version ${v}`;
  });
  stage.querySelector("[data-check]")?.addEventListener("click", () => {
    const u = updateState();
    if (u.kind === "available") void installUpdate();
    else void checkForUpdate();
  });
  renderUpdates();
  const reset = stage.querySelector<HTMLButtonElement>("[data-reset]")!;
  reset.addEventListener("click", () => {
    if (reset.dataset.confirm) {
      resetStats();
      resetAchievements();
      reset.textContent = "Stats and trophies reset";
      reset.disabled = true;
    } else {
      reset.dataset.confirm = "1";
      reset.textContent = "Click again to reset everything";
    }
  });
}

// ---------------- updates ----------------

function updateLabel(s: UpdateState): string {
  switch (s.kind) {
    case "checking":
      return "Checking…";
    case "current":
      return "You're on the latest version.";
    case "available":
      return `Version ${s.version} is ready to install.`;
    case "downloading":
      return `Downloading ${Math.round(s.progress * 100)}%`;
    case "installing":
      return "Installing. Downtime will restart.";
    case "error":
      return s.message;
    default:
      return "";
  }
}

function renderUpdates() {
  const s = updateState();
  const slot = document.querySelector<HTMLElement>(".update-slot");
  const busy = s.kind === "downloading" || s.kind === "installing";
  if (slot) {
    if (s.kind === "available" || busy) {
      const v = s.version;
      const pct = s.kind === "downloading" ? Math.round(s.progress * 100) : s.kind === "installing" ? 100 : 0;
      slot.innerHTML = `
        <button class="update-banner" data-install ${busy ? "disabled" : ""} style="--p:${pct}%" title="Install version ${v}">
          <strong>${busy ? (s.kind === "installing" ? "Installing…" : `Downloading ${pct}%`) : "Update available"}</strong>
          <span>${busy ? `Version ${v}` : `Install version ${v}`}</span>
        </button>`;
      slot.querySelector("[data-install]")?.addEventListener("click", () => void installUpdate());
    } else slot.innerHTML = "";
  }

  const msg = document.querySelector<HTMLElement>(".update-msg");
  const btn = document.querySelector<HTMLButtonElement>("[data-check]");
  if (msg) {
    msg.textContent = updateLabel(s);
    msg.classList.toggle("error", s.kind === "error");
  }
  if (btn) {
    btn.disabled = s.kind === "checking" || busy;
    btn.querySelector("span")!.textContent = s.kind === "available" ? `Install ${s.version}` : "Check for updates";
  }
}

onUpdateState(renderUpdates);
setTimeout(() => void checkForUpdate(true), 2500);
setInterval(() => void checkForUpdate(true), 6 * 60 * 60 * 1000);

// Refresh the Today badge when the date rolls over.
let day = todayKey();
setInterval(() => {
  if (todayKey() !== day) {
    day = todayKey();
    renderRail();
  }
}, 60 * 1000);

renderRail();
checkAchievements();
route();
