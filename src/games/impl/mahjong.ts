import { GameContext, GameInstance } from "../../core/types";
import { GameTimer } from "../../core/timer";
import { formatTime, recordLoss, recordStart, recordWin } from "../../core/stats";
import { load, remove, save } from "../../core/storage";
import { sfx } from "../../core/sound";
import { animScale, getSettings, motionEnabled } from "../../core/settings";
import { dailyRng, dayNumber, todayKey } from "../../core/rng";
import { markDailyDone } from "../../core/daily";

// Positions are in half-tile units: a tile at (x, y) covers x..x+2, y..y+2.
interface Spot {
  x: number;
  y: number;
  z: number;
}

function rect(x0: number, y0: number, cols: number, rows: number, z: number): Spot[] {
  const out: Spot[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push({ x: x0 + c * 2, y: y0 + r * 2, z });
  return out;
}

/** A 108-tile pyramid with wings: 60 + 32 + 12 + 2 on top, plus one tile on each side. */
const PYRAMID: Spot[] = [
  ...rect(0, 0, 10, 6, 0),
  ...rect(2, 2, 8, 4, 1),
  ...rect(4, 4, 6, 2, 2),
  { x: 8, y: 5, z: 3 },
  { x: 10, y: 5, z: 3 },
  { x: -2, y: 5, z: 0 },
  { x: 20, y: 5, z: 0 },
];
/** 84 tiles: a walled keep three layers high, with a gate tile on each side. */
const FORTRESS: Spot[] = [
  ...rect(0, 0, 8, 6, 0),
  ...rect(2, 2, 6, 4, 1),
  ...rect(4, 4, 4, 2, 2),
  { x: 6, y: 5, z: 3 },
  { x: 8, y: 5, z: 3 },
  { x: -2, y: 5, z: 0 },
  { x: 16, y: 5, z: 0 },
];

/** 68 tiles: a long low base with two small peaks set half a tile off the grid. */
const TWIN_PEAKS: Spot[] = [
  ...rect(0, 0, 12, 4, 0),
  ...rect(1, 1, 4, 2, 1),
  ...rect(15, 1, 4, 2, 1),
  ...rect(3, 2, 2, 1, 2),
  ...rect(17, 2, 2, 1, 2),
];

/** 68 tiles: a cross with a tall center. */
const CROSS: Spot[] = [
  ...rect(6, 0, 3, 8, 0),
  ...rect(0, 4, 3, 4, 0),
  ...rect(12, 4, 3, 4, 0),
  ...rect(6, 4, 3, 4, 1),
  ...rect(7, 5, 2, 3, 2),
  { x: 8, y: 7, z: 3 },
  { x: 8, y: 9, z: 3 },
];

export const LAYOUTS: Record<string, Spot[]> = { pyramid: PYRAMID, fortress: FORTRESS, peaks: TWIN_PEAKS, cross: CROSS };

/** The layout in play. Only one Mahjong board exists at a time. */
let LAYOUT: Spot[] = PYRAMID;

// 27 kinds (three suits, 1–9), four of each.
const KINDS = 27;
const SUITS = ["dots", "sticks", "stars"] as const;

const SAVE_PRACTICE = "save:mahjong";

function overlaps(a: Spot, b: Spot) {
  return Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2;
}

/** Whether spot i is free, given the set of spots still on the board. */
function isFree(i: number, alive: (j: number) => boolean): boolean {
  const t = LAYOUT[i];
  let left = false;
  let right = false;
  for (let j = 0; j < LAYOUT.length; j++) {
    if (j === i || !alive(j)) continue;
    const u = LAYOUT[j];
    if (u.z === t.z + 1 && overlaps(t, u)) return false;
    if (u.z === t.z && Math.abs(u.y - t.y) < 2) {
      if (u.x === t.x - 2) left = true;
      if (u.x === t.x + 2) right = true;
    }
  }
  return !left || !right;
}

/**
 * Give each live spot a kind so the board can be cleared: repeatedly take two
 * free spots, give them the same kind, and remove them. Playing that removal
 * order forwards always works.
 */
function assignKinds(spots: number[], kinds: number[], rng: () => number = Math.random): Map<number, number> | null {
  for (let attempt = 0; attempt < 300; attempt++) {
    const pairs: number[] = [];
    const counts = new Map<number, number>();
    kinds.forEach((k) => counts.set(k, (counts.get(k) ?? 0) + 1));
    for (const [k, n] of counts) for (let i = 0; i < n / 2; i++) pairs.push(k);
    for (let i = pairs.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
    }
    const alive = new Set(spots);
    const result = new Map<number, number>();
    let ok = true;
    while (alive.size) {
      const free = [...alive].filter((i) => isFree(i, (j) => alive.has(j)));
      if (free.length < 2) {
        ok = false;
        break;
      }
      // Favor tiles high in the stack so lower layers don't strand.
      const jitter = new Map(free.map((i) => [i, (rng() - 0.5) * 1.5]));
      free.sort((a, b) => LAYOUT[b].z - LAYOUT[a].z + jitter.get(a)! - jitter.get(b)!);
      const a = free[0];
      const rest = free.slice(1);
      const b = rest[Math.floor(rng() * rest.length)];
      const k = pairs.pop()!;
      result.set(a, k);
      result.set(b, k);
      alive.delete(a);
      alive.delete(b);
    }
    if (ok) return result;
  }
  return null;
}

interface State {
  kinds: number[];
  gone: boolean[];
  shuffles: number;
}

class Mahjong implements GameInstance {
  private el: HTMLDivElement;
  private board: HTMLDivElement;
  private tiles: HTMLButtonElement[] = [];
  private s!: State;
  private history: State[] = [];
  private selected: number | null = null;
  private timer: GameTimer;
  private over = false;
  private counted = false;
  private resizeObs: ResizeObserver;
  /** Moves layouts so their left edge sits where the CSS expects it. */
  private shiftX = 0;

  private daily: boolean;
  private SAVE: string;
  private layout: string;
  private paused = false;

  constructor(root: HTMLElement, private ctx: GameContext) {
    this.daily = ctx.option("mode") === "daily";
    // The daily board is always the pyramid, so everyone gets the same puzzle.
    this.layout = !this.daily && ctx.option("layout") in LAYOUTS ? ctx.option("layout") : "pyramid";
    LAYOUT = LAYOUTS[this.layout];
    const lay = this.layout === "pyramid" ? "" : `:${this.layout}`;
    this.SAVE = this.daily ? `save:mahjong:daily:${todayKey()}` : SAVE_PRACTICE + lay;
    this.el = document.createElement("div");
    this.el.className = "mahjong";
    this.board = document.createElement("div");
    this.board.className = "mj-board";
    const xs = LAYOUT.map((p) => p.x);
    const ys = LAYOUT.map((p) => p.y);
    this.shiftX = -2 - Math.min(...xs);
    this.board.style.setProperty("--bw", String((Math.max(...xs) + 2 - Math.min(...xs)) / 2));
    this.board.style.setProperty("--bh", String((Math.max(...ys) + 2) / 2 + 0.5));
    this.el.appendChild(this.board);
    root.appendChild(this.el);
    LAYOUT.forEach((p, i) => {
      const b = document.createElement("button");
      b.className = "mj-tile";
      b.dataset.i = String(i);
      b.style.zIndex = String(p.z * 1000 + p.y * 20 + p.x + 50);
      b.style.setProperty("--x", String(p.x + this.shiftX));
      b.style.setProperty("--y", String(p.y));
      b.style.setProperty("--z", String(p.z));
      this.board.appendChild(b);
      this.tiles.push(b);
    });
    this.board.addEventListener("click", (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>(".mj-tile");
      if (t && !this.paused) this.pick(Number(t.dataset.i));
    });
    window.addEventListener("keydown", this.onKey);
    this.timer = new GameTimer(() => this.status());
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(this.el);

    const saved = load<(State & { seconds: number; counted: boolean }) | null>(this.SAVE, null);
    if (saved && saved.kinds?.length === LAYOUT.length) {
      this.s = { kinds: saved.kinds, gone: saved.gone, shuffles: saved.shuffles };
      this.counted = saved.counted;
      this.timer.reset(saved.seconds);
      this.paint();
      this.status();
    } else this.newGame();
  }

  private get key() {
    if (this.daily) return "mahjong:daily";
    return this.layout === "pyramid" ? "mahjong" : `mahjong:${this.layout}`;
  }

  inProgress() {
    return this.counted && !this.over;
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    this.board.classList.toggle("paused", paused);
  }

  newGame() {
    if (this.counted && !this.over) recordLoss(this.key);
    const all = [...Array(LAYOUT.length).keys()];
    const kinds = all.map((i) => Math.floor(i / 4) % KINDS);
    const map = assignKinds(all, kinds, this.daily ? dailyRng("mahjong") : Math.random)!;
    this.s = { kinds: all.map((i) => map.get(i)!), gone: all.map(() => false), shuffles: 0 };
    this.history = [];
    this.selected = null;
    this.over = false;
    this.counted = false;
    this.timer.reset();
    this.ctx.clearEnd();
    this.paint(true);
    this.persist();
    this.status();
  }

  undo() {
    const h = this.history.pop();
    if (!h || this.over) return;
    this.s = h;
    this.selected = null;
    sfx.flip();
    this.paint();
    this.persist();
    this.status();
  }

  destroy() {
    window.removeEventListener("keydown", this.onKey);
    this.persist();
    this.timer.destroy();
    this.resizeObs.disconnect();
    this.el.remove();
  }

  resize() {
    const r = this.el.getBoundingClientRect();
    const bw = Number(this.board.style.getPropertyValue("--bw")) || 12;
    const bh = Number(this.board.style.getPropertyValue("--bh")) || 6.5;
    const ratio = 1.32;
    const tw = Math.floor(Math.min((r.width - 60) / (bw + 0.6), (r.height - 60) / ((bh - 0.5) * ratio + 0.6)));
    this.board.style.setProperty("--tw", `${Math.max(tw, 24)}px`);
  }

  private persist() {
    if (this.over) return remove(this.SAVE);
    save(this.SAVE, { ...this.s, seconds: this.timer.seconds, counted: this.counted });
  }

  private alive = (j: number) => !this.s.gone[j];

  private free(i: number) {
    return !this.s.gone[i] && isFree(i, this.alive);
  }

  private onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.closest?.("select, input") || e.ctrlKey || e.metaKey || this.paused) return;
    if (e.key === "h" || e.key === "H") {
      e.preventDefault();
      this.hint();
    } else if (e.key === "s" || e.key === "S") {
      e.preventDefault();
      this.shuffle();
    } else if (e.key === "Escape" && this.selected != null) {
      this.selected = null;
      this.paint();
    }
  };

  /** Pairs of free tiles with the same kind. */
  private matches(): [number, number][] {
    const free = LAYOUT.map((_, i) => i).filter((i) => this.free(i));
    const out: [number, number][] = [];
    for (let a = 0; a < free.length; a++)
      for (let b = a + 1; b < free.length; b++) if (this.s.kinds[free[a]] === this.s.kinds[free[b]]) out.push([free[a], free[b]]);
    return out;
  }

  requestHint() {
    this.hint();
  }

  hint() {
    if (!getSettings().hints || this.over) return;
    const m = this.matches();
    if (!m.length) return;
    const [a, b] = m[Math.floor(Math.random() * m.length)];
    for (const i of [a, b]) {
      const t = this.tiles[i];
      t.classList.remove("hint");
      void t.offsetWidth;
      t.classList.add("hint");
    }
  }

  /** Shuffle the remaining tiles into a new solvable arrangement. Counts as a shuffle. */
  shuffle() {
    if (this.over) return;
    const live = LAYOUT.map((_, i) => i).filter((i) => !this.s.gone[i]);
    if (live.length < 2) return;
    const map = assignKinds(
      live,
      live.map((i) => this.s.kinds[i]),
    );
    if (!map) return this.ctx.toast("These tiles can't be rearranged.");
    this.history.push({ kinds: this.s.kinds.slice(), gone: this.s.gone.slice(), shuffles: this.s.shuffles });
    live.forEach((i) => (this.s.kinds[i] = map.get(i)!));
    this.s.shuffles += 1;
    this.selected = null;
    sfx.deal();
    this.paint(true);
    this.status();
    this.persist();
  }

  private pick(i: number) {
    if (this.over || this.s.gone[i]) return;
    if (!this.free(i)) {
      this.tiles[i].classList.remove("blocked");
      void this.tiles[i].offsetWidth;
      this.tiles[i].classList.add("blocked");
      sfx.error();
      return;
    }
    if (this.selected === i) {
      this.selected = null;
    } else if (this.selected != null && this.s.kinds[this.selected] === this.s.kinds[i]) {
      this.history.push({ kinds: this.s.kinds.slice(), gone: this.s.gone.slice(), shuffles: this.s.shuffles });
      if (this.history.length > 200) this.history.shift();
      this.s.gone[this.selected] = true;
      this.s.gone[i] = true;
      this.vanish([this.selected, i]);
      this.selected = null;
      if (!this.counted) {
        this.counted = true;
        recordStart(this.key);
      }
      this.timer.start();
      sfx.merge();
      this.afterMatch();
      return;
    } else {
      this.selected = i;
      sfx.pick();
    }
    this.paint();
  }

  private vanish(ids: number[]) {
    for (const i of ids) {
      const t = this.tiles[i];
      if (motionEnabled()) {
        t.classList.add("leaving");
        setTimeout(() => t.classList.remove("leaving"), 320 * animScale());
      }
    }
  }

  private afterMatch() {
    this.paint();
    this.status();
    if (this.s.gone.every(Boolean)) return this.win();
    if (!this.matches().length) {
      // Reshuffle what's left into a solvable arrangement.
      const live = LAYOUT.map((_, i) => i).filter((i) => !this.s.gone[i]);
      const map = assignKinds(
        live,
        live.map((i) => this.s.kinds[i]),
      );
      if (map) {
        live.forEach((i) => (this.s.kinds[i] = map.get(i)!));
        this.s.shuffles += 1;
        setTimeout(() => {
          this.ctx.toast("No pairs left, so the remaining tiles were shuffled.");
          this.paint(true);
          this.status();
        }, 350);
      } else {
        this.over = true;
        this.timer.stop();
        recordLoss(this.key);
        this.ctx.end({ won: false, title: "No moves left", lines: ["Undo to try another pair, or start a new board."] });
      }
    }
    this.persist();
  }

  private win() {
    this.over = true;
    this.timer.stop();
    const secs = Math.round(this.timer.seconds);
    const { newBestTime } = recordWin(this.key, secs);
    remove(this.SAVE);
    sfx.win();
    if (this.daily) markDailyDone("mahjong");
    this.status();
    const sh = this.s.shuffles;
    setTimeout(
      () =>
        this.ctx.end({
          won: true,
          title: this.daily ? `Daily #${dayNumber()} cleared` : "Board cleared",
          lines: [`${formatTime(secs)}${newBestTime ? " — a new best" : ""}`, sh ? `${sh} shuffle${sh > 1 ? "s" : ""}` : "No shuffles needed"],
        }),
      500,
    );
  }

  private face(kind: number) {
    const suit = SUITS[Math.floor(kind / 9)];
    const n = (kind % 9) + 1;
    const glyph =
      suit === "dots"
        ? `<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="2.6"/><circle cx="10" cy="10" r="2.6" fill="currentColor"/></svg>`
        : suit === "sticks"
          ? `<svg viewBox="0 0 20 20"><rect x="7" y="1.5" width="6" height="17" rx="3" fill="currentColor"/><path d="M7 7.5h6M7 12.5h6" stroke="var(--tile)" stroke-width="1.4"/></svg>`
          : `<svg viewBox="0 0 20 20"><path d="M10 1.5l2.5 5.6 6 .6-4.5 4 1.3 6-5.3-3.1-5.3 3.1 1.3-6-4.5-4 6-.6z" fill="currentColor"/></svg>`;
    return `<span class="mj-face ${suit}"><b>${n}</b>${glyph}</span>`;
  }

  private paint(fresh = false) {
    const animate = fresh && motionEnabled();
    LAYOUT.forEach((p, i) => {
      const t = this.tiles[i];
      const gone = this.s.gone[i];
      t.hidden = gone;
      if (gone) return;
      t.innerHTML = this.face(this.s.kinds[i]);
      t.classList.toggle("free", this.free(i));
      t.classList.toggle("sel", this.selected === i);
      t.classList.remove("hint", "blocked");
      t.setAttribute("aria-label", `${SUITS[Math.floor(this.s.kinds[i] / 9)]} ${(this.s.kinds[i] % 9) + 1}${this.free(i) ? "" : ", blocked"}`);
      if (animate) {
        t.classList.remove("intro");
        void t.offsetWidth;
        t.style.animationDelay = `${(p.z * 90 + (p.x + p.y) * 8) * animScale()}ms`;
        t.classList.add("intro");
      }
    });
    this.ctx.setUndo(this.history.length > 0 && !this.over);
  }

  private status() {
    const left = this.s ? this.s.gone.filter((g) => !g).length : LAYOUT.length;
    this.ctx.setStatus([
      { label: "Tiles", value: String(left) },
      { label: "Pairs open", value: this.s ? String(this.matches().length) : "0" },
      { label: "Time", value: formatTime(this.timer.seconds) },
    ]);
  }
}

export function create(root: HTMLElement, ctx: GameContext): GameInstance {
  return new Mahjong(root, ctx);
}
