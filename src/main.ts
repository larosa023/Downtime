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
  THEMES,
  updateSettings,
} from "./core/settings";
import { allStats, formatTime, getStats, resetStats } from "./core/stats";
import { load } from "./core/storage";
import { GameContext, GameInstance, GameModule, StatusItem } from "./core/types";
import { installSuitSprite } from "./cards/deck";
import { GAMES, gameById } from "./games";
import { gameArt } from "./ui/art";
import { GAME_ICONS, ICONS } from "./ui/icons";

applySettings();
installSuitSprite();

const app = document.getElementById("app")!;
app.innerHTML = `
  <div class="shell">
    <nav class="rail" aria-label="Games">
      <a class="brand" href="#/">
        <img src="/icon.png" alt="" width="28" height="28" />
        <span>Downtime</span>
      </a>
      <a class="nav-item" href="#/" data-route="home">${ICONS.home}<span>Home</span></a>
      <p class="nav-group">Cards</p>
      ${GAMES.filter((g) => g.group === "cards").map(navItem).join("")}
      <p class="nav-group">Puzzles and arcade</p>
      ${GAMES.filter((g) => g.group === "arcade").map(navItem).join("")}
      <div class="rail-foot">
        <a class="nav-item" href="#/stats" data-route="stats">${ICONS.stats}<span>Stats</span></a>
        <a class="nav-item" href="#/settings" data-route="settings">${ICONS.settings}<span>Settings</span></a>
        <div class="theme-dots" role="radiogroup" aria-label="Theme">
          ${THEMES.map(
            (t) =>
              `<button class="theme-dot" role="radio" data-theme-pick="${t.id}" title="${t.name}" aria-label="${t.name} theme" style="--a:${t.swatch[0]};--b:${t.swatch[1]}"></button>`,
          ).join("")}
        </div>
      </div>
    </nav>
    <main class="stage" id="stage"></main>
  </div>`;

function navItem(g: GameModule) {
  return `<a class="nav-item" href="#/play/${g.id}" data-route="play/${g.id}">${GAME_ICONS[g.id] ?? ""}<span>${g.name}</span></a>`;
}

const stage = document.getElementById("stage")!;
let current: { game: GameModule; instance: GameInstance } | null = null;
let teardown: (() => void) | null = null;

app.addEventListener("click", (e) => {
  const pick = (e.target as HTMLElement).closest<HTMLElement>("[data-theme-pick]");
  if (pick) updateSettings({ theme: pick.dataset.themePick as never });
});

onSettingsChange(() => syncThemeDots());

function syncThemeDots() {
  document.querySelectorAll<HTMLElement>("[data-theme-pick]").forEach((b) => {
    b.setAttribute("aria-checked", String(b.dataset.themePick === getSettings().theme));
  });
}

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
  document.querySelectorAll<HTMLElement>(".nav-item").forEach((a) => {
    const r = a.dataset.route ?? "";
    a.toggleAttribute("aria-current", r === (hash || "home"));
  });
  syncThemeDots();

  const [view, arg] = hash.split("/");
  if (view === "play" && arg && gameById(arg)) return showGame(gameById(arg)!);
  if (view === "stats") return showStats();
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
  const s = getStats(g.statsKey((k) => getGameOption(g.id, k, g.options?.find((o) => o.key === k)?.default ?? "")));
  if (!s.played) return "Not played yet";
  if (s.bestTime != null) return `Best ${formatTime(s.bestTime)}`;
  if (s.bestScore != null) return `Best score ${s.bestScore}`;
  return `${s.played} played`;
}

function savedGames(): GameModule[] {
  return GAMES.filter((g) => {
    const s = load<{ moves?: number; score?: number } | null>(`save:${g.id}`, null);
    return s && ((s.moves ?? 0) > 0 || (s.score ?? 0) > 0);
  });
}

function showHome() {
  document.title = "Downtime";
  const resume = savedGames();
  const tile = (g: GameModule) => `
    <a class="tile" href="#/play/${g.id}">
      <div class="tile-art">${gameArt(g.art)}</div>
      <div class="tile-body">
        <h3>${g.name}</h3>
        <p>${g.blurb}</p>
        <span class="tile-meta">${tileMeta(g)}</span>
      </div>
    </a>`;
  stage.innerHTML = `
    <div class="home">
      <header class="home-head">
        <h1>${greeting()}</h1>
        <p>Pick something to play.</p>
      </header>
      ${
        resume.length
          ? `<section class="resume" aria-label="Games in progress">
              <h2>Pick up where you left off</h2>
              <div class="resume-row">${resume
                .map((g) => `<a class="chip" href="#/play/${g.id}">${GAME_ICONS[g.id]}<span>${g.name}</span></a>`)
                .join("")}</div>
            </section>`
          : ""
      }
      <section aria-label="Card games">
        <h2>Cards</h2>
        <div class="tiles">${GAMES.filter((g) => g.group === "cards").map(tile).join("")}</div>
      </section>
      <section aria-label="Puzzles and arcade">
        <h2>Puzzles and arcade</h2>
        <div class="tiles">${GAMES.filter((g) => g.group === "arcade").map(tile).join("")}</div>
      </section>
    </div>`;
}

// ---------------- game view ----------------

function showGame(game: GameModule) {
  document.title = `${game.name} — Downtime`;
  const opt = (key: string) => getGameOption(game.id, key, game.options?.find((o) => o.key === key)?.default ?? "");
  stage.innerHTML = `
    <div class="play">
      <header class="bar">
        <h1>${game.name}</h1>
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
          ${game.hasUndo ? `<button class="btn ghost" data-act="undo" title="Undo (Ctrl+Z)" disabled>${ICONS.undo}<span>Undo</span></button>` : ""}
          <button class="btn" data-act="new" title="New game (F2)">${ICONS.refresh}<span>New game</span></button>
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
  };

  const mount = () => {
    board.innerHTML = "";
    current = { game, instance: game.create(board, ctx) };
  };
  mount();

  stage.querySelector(".play")!.addEventListener("click", (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>("[data-act]")?.dataset.act;
    if (act === "new") current?.instance.newGame();
    if (act === "undo") current?.instance.undo?.();
  });

  stage.querySelectorAll<HTMLSelectElement>("select[data-opt]").forEach((sel) =>
    sel.addEventListener("change", () => {
      setGameOption(game.id, sel.dataset.opt!, sel.value);
      sel.blur();
      current?.instance.destroy();
      ctx.clearEnd();
      mount();
    }),
  );

  const onKey = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      current?.instance.undo?.();
    } else if (e.key === "F2" || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n")) {
      e.preventDefault();
      current?.instance.newGame();
    }
  };
  window.addEventListener("keydown", onKey);
  teardown = () => window.removeEventListener("keydown", onKey);
}

// ---------------- stats ----------------

function variantLabel(key: string): { game: string; variant: string } {
  const [id, ...rest] = key.split(":");
  const g = gameById(id);
  const name = g?.name ?? id;
  const labels: Record<string, string> = {
    draw1: "Draw 1", draw3: "Draw 3", "1suit": "1 suit", "2suit": "2 suits", "4suit": "4 suits",
    easy: "Easy", medium: "Medium", hard: "Hard", relaxed: "Relaxed", normal: "Normal", fast: "Fast",
    walls: "walls", wrap: "wrap",
  };
  return { game: name, variant: rest.map((r) => labels[r] ?? r).join(", ") };
}

function showStats() {
  document.title = "Stats — Downtime";
  const entries = Object.entries(allStats())
    .filter(([, s]) => s.played > 0)
    .sort(([a], [b]) => GAMES.findIndex((g) => a.startsWith(g.id)) - GAMES.findIndex((g) => b.startsWith(g.id)) || a.localeCompare(b));
  const rows = entries
    .map(([key, s]) => {
      const { game, variant } = variantLabel(key);
      const rate = s.played ? Math.round((s.won / s.played) * 100) : 0;
      const scoreGame = s.bestScore != null && s.bestTime == null;
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
      <header class="page-head"><h1>Stats</h1><p>Everything you've played on this computer.</p></header>
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

// ---------------- settings ----------------

function showSettings() {
  document.title = "Settings — Downtime";
  const s = getSettings();
  const backs: { id: CardBack; name: string }[] = [
    { id: "weave", name: "Weave" },
    { id: "dots", name: "Dots" },
    { id: "plain", name: "Plain" },
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
      </section>
      <section class="setting">
        <h2>Card back</h2>
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
      </section>
      <section class="setting">
        <h2>Feel</h2>
        <label class="toggle"><input type="checkbox" data-set="sound" ${s.sound ? "checked" : ""}/><span class="switch"></span><span>Sound effects</span></label>
        <label class="toggle"><input type="checkbox" data-set="motion" ${s.motion ? "checked" : ""}/><span class="switch"></span><span>Animations</span></label>
      </section>
      <section class="setting">
        <h2>Data</h2>
        <p class="dim">Stats and games in progress are saved on this computer.</p>
        <button class="btn danger" data-reset>Reset all stats</button>
      </section>
    </div>`;

  stage.querySelectorAll<HTMLElement>("[data-set-theme]").forEach((b) =>
    b.addEventListener("click", () => {
      updateSettings({ theme: b.dataset.setTheme as never });
      showSettings();
      syncThemeDots();
    }),
  );
  stage.querySelectorAll<HTMLElement>("[data-set-back]").forEach((b) =>
    b.addEventListener("click", () => {
      updateSettings({ cardBack: b.dataset.setBack as CardBack });
      showSettings();
    }),
  );
  stage.querySelectorAll<HTMLInputElement>("input[data-set]").forEach((i) =>
    i.addEventListener("change", () => updateSettings({ [i.dataset.set!]: i.checked })),
  );
  const reset = stage.querySelector<HTMLButtonElement>("[data-reset]")!;
  reset.addEventListener("click", () => {
    if (reset.dataset.confirm) {
      resetStats();
      reset.textContent = "Stats reset";
      reset.disabled = true;
    } else {
      reset.dataset.confirm = "1";
      reset.textContent = "Click again to reset everything";
    }
  });
}

route();
