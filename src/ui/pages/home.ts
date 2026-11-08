import { getSettings, setGameOption, toggleFavorite } from "../../core/settings";
import { allStats, formatTime, getStats } from "../../core/stats";
import { load } from "../../core/storage";
import { GameModule, GROUPS } from "../../core/types";
import { dailyDone, dailyLog, dailyStreak } from "../../core/daily";
import { dayNumber, todayKey } from "../../core/rng";
import { GAMES, gameById } from "../../games";
import { gameArt } from "../art";
import { ICONS } from "../icons";
import { gameIcon, statsKeyFor } from "../shared";

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "Up late.";
  if (h < 12) return "Good morning.";
  if (h < 17) return "Good afternoon.";
  return "Good evening.";
}

function tileMeta(g: GameModule) {
  const s = getStats(statsKeyFor(g));
  if (!s.played) return "Not played yet";
  if (s.bestTime != null) return `Best ${formatTime(s.bestTime)}`;
  if (s.bestScore != null) return `Best score ${s.bestScore}`;
  if (s.won) return `${s.won} won of ${s.played}`;
  return `${s.played} played`;
}

export function inProgress(g: GameModule): boolean {
  const s = load<{ moves?: number; score?: number } | null>(`save:${g.id}`, null);
  return !!s && ((s.moves ?? 0) > 0 || (s.score ?? 0) > 0);
}

/** Games ordered by when they were last played. */
function recentGames(limit: number): GameModule[] {
  const last = new Map<string, number>();
  for (const [k, s] of Object.entries(allStats())) {
    const id = k.split(":")[0];
    if (s.lastPlayed && (last.get(id) ?? 0) < s.lastPlayed) last.set(id, s.lastPlayed);
  }
  return GAMES.filter((g) => last.has(g.id))
    .sort((a, b) => (last.get(b.id) ?? 0) - (last.get(a.id) ?? 0))
    .slice(0, limit);
}

export function randomGame(): GameModule {
  return GAMES[Math.floor(Math.random() * GAMES.length)];
}

function tile(g: GameModule) {
  const fav = getSettings().favorites.includes(g.id);
  const group = GROUPS.find((x) => x.id === g.group)?.name ?? "";
  return `
    <div class="tile-wrap" data-search="${`${g.name} ${group} ${g.blurb}`.toLowerCase().replace(/"/g, "")}">
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

export function dailyCards() {
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

function bindDaily(stage: HTMLElement) {
  stage.querySelectorAll<HTMLElement>("[data-daily]").forEach((b) =>
    b.addEventListener("click", () => {
      setGameOption(b.dataset.daily!, "mode", "daily");
      location.hash = `#/play/${b.dataset.daily}`;
    }),
  );
}

let lastQuery = "";

export function showHome(stage: HTMLElement) {
  document.title = "Downtime";
  const s = getSettings();
  const favs = s.favorites.map(gameById).filter((g): g is GameModule => !!g);
  const going = GAMES.filter(inProgress);
  const recent = recentGames(8).filter((g) => !going.includes(g));
  const streak = dailyStreak();
  const chip = (g: GameModule, dot = false) =>
    `<a class="chip" href="#/play/${g.id}">${gameIcon(g)}<span>${g.name}</span>${dot ? `<em class="chip-dot" title="Game in progress"></em>` : ""}</a>`;
  stage.innerHTML = `
    <div class="home">
      <header class="home-head">
        <div>
          <h1>${greeting()}</h1>
          <p>Pick something to play.</p>
        </div>
        <div class="home-tools">
          <label class="search">
            ${ICONS.search}
            <span class="sr-only">Find a game</span>
            <input type="search" placeholder="Find a game" data-home-search value="${lastQuery.replace(/"/g, "")}" autocomplete="off" spellcheck="false"/>
            <kbd title="Search everything">Ctrl K</kbd>
          </label>
          <button class="btn ghost" data-random title="Open a random game">${ICONS.shuffle}<span>Random game</span></button>
        </div>
      </header>
      <div class="home-sections">
        <section aria-label="Today's puzzles" data-hide-when-searching>
          <div class="section-head"><h2>Today's puzzles</h2>${streak ? `<span class="streak">${streak}-day streak</span>` : ""}<a class="more" href="#/today">Calendar</a></div>
          ${dailyCards()}
        </section>
        ${
          going.length
            ? `<section class="resume" aria-label="Continue" data-hide-when-searching><h2>Continue</h2><div class="resume-row">${going.map((g) => chip(g, true)).join("")}</div></section>`
            : ""
        }
        ${
          recent.length
            ? `<section class="resume" aria-label="Recently played" data-hide-when-searching><h2>Recently played</h2><div class="resume-row">${recent.map((g) => chip(g)).join("")}</div></section>`
            : ""
        }
        ${favs.length ? `<section aria-label="Favorites" data-hide-when-searching><h2>Favorites</h2><div class="tiles">${favs.map(tile).join("")}</div></section>` : ""}
        ${GROUPS.map((grp) => {
          const games = GAMES.filter((g) => g.group === grp.id);
          return games.length ? `<section aria-label="${grp.name}" data-group-section><h2>${grp.name}</h2><div class="tiles">${games.map(tile).join("")}</div></section>` : "";
        }).join("")}
        <div class="empty search-empty" hidden><p>No games match that.</p></div>
      </div>
    </div>`;

  stage.querySelectorAll<HTMLElement>("[data-fav]").forEach((b) =>
    b.addEventListener("click", () => {
      toggleFavorite(b.dataset.fav!);
      showHome(stage);
    }),
  );
  bindDaily(stage);
  stage.querySelector("[data-random]")!.addEventListener("click", () => (location.hash = `#/play/${randomGame().id}`));

  const input = stage.querySelector<HTMLInputElement>("[data-home-search]")!;
  const filter = () => {
    const q = input.value.trim().toLowerCase();
    lastQuery = input.value;
    const words = q.split(/\s+/).filter(Boolean);
    stage.querySelectorAll<HTMLElement>("[data-hide-when-searching]").forEach((el) => (el.hidden = !!q));
    let shown = 0;
    stage.querySelectorAll<HTMLElement>("[data-group-section]").forEach((sec) => {
      let n = 0;
      sec.querySelectorAll<HTMLElement>(".tile-wrap").forEach((t) => {
        const ok = words.every((w) => t.dataset.search!.includes(w));
        t.hidden = !ok;
        if (ok) n++;
      });
      sec.hidden = n === 0;
      shown += n;
    });
    stage.querySelector<HTMLElement>(".search-empty")!.hidden = shown > 0;
  };
  input.addEventListener("input", filter);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const first = stage.querySelector<HTMLAnchorElement>("[data-group-section]:not([hidden]) .tile-wrap:not([hidden]) .tile");
      if (first) location.hash = first.getAttribute("href")!;
    } else if (e.key === "Escape") {
      input.value = "";
      filter();
    }
  });
  if (lastQuery) filter();
}

export function showToday(stage: HTMLElement) {
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
  bindDaily(stage);
}
