import { GameContext, GameInstance } from "../../core/types";
import { GameTimer } from "../../core/timer";
import { formatTime, recordLoss, recordStart, recordWin } from "../../core/stats";
import { load, remove, save } from "../../core/storage";
import { sfx } from "../../core/sound";
import { animScale, getSettings, motionEnabled } from "../../core/settings";

const SIZES: Record<string, number> = { small: 5, medium: 7, large: 9, huge: 11 };
const SAVE = "save:pipes";
// Bits for the four sides: up, right, down, left.
const N_ = 1;
const E_ = 2;
const S_ = 4;
const W_ = 8;
const DIRS: [number, number, number, number][] = [
  [N_, -1, 0, S_],
  [E_, 0, 1, W_],
  [S_, 1, 0, N_],
  [W_, 0, -1, E_],
];

/** Rotate a side mask clockwise by `turns` quarter turns. */
const rot = (m: number, turns: number) => {
  let x = m;
  for (let t = 0; t < ((turns % 4) + 4) % 4; t++) x = ((x << 1) | (x >> 3)) & 15;
  return x;
};

/** A random spanning tree over the grid, grown outward from the center. */
function makeTree(n: number): number[] {
  const masks = Array(n * n).fill(0);
  const center = Math.floor(n / 2) * n + Math.floor(n / 2);
  const inTree = new Set([center]);
  const frontier: [number, number, number][] = []; // from, to, dirIndex
  const addEdges = (i: number) => {
    const r = Math.floor(i / n);
    const c = i % n;
    DIRS.forEach(([, dr, dc], d) => {
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nc >= 0 && nr < n && nc < n) frontier.push([i, nr * n + nc, d]);
    });
  };
  addEdges(center);
  while (inTree.size < n * n) {
    const k = Math.floor(Math.random() * frontier.length);
    const [from, to, d] = frontier[k];
    frontier.splice(k, 1);
    if (inTree.has(to)) continue;
    // Avoid four-way crossings: they can't be rotated, so they're dull.
    const bits = masks[from] | DIRS[d][0];
    if (bits === 15 && Math.random() < 0.9 && frontier.some(([f, t]) => !inTree.has(t) && f !== from)) {
      frontier.push([from, to, d]);
      continue;
    }
    masks[from] |= DIRS[d][0];
    masks[to] |= DIRS[d][3];
    inTree.add(to);
    addEdges(to);
  }
  return masks;
}

interface Saved {
  n: number;
  base: number[];
  turns: number[];
  moves: number;
  locked?: number[];
  par?: number;
  seconds: number;
  counted: boolean;
}

class Pipes implements GameInstance {
  private el: HTMLDivElement;
  private svg!: SVGSVGElement;
  private tileEls: SVGGElement[] = [];
  private n: number;
  private size: string;
  private base: number[] = [];
  private turns: number[] = [];
  private moves = 0;
  private timer: GameTimer;
  private over = false;
  private counted = false;
  private resizeObs: ResizeObserver;
  private paused = false;
  /** Tiles the player has pinned in place (Ctrl+click or middle-click). */
  private locked = new Set<number>();
  /** Fewest clockwise turns that would solve the board from the start. */
  private par = 0;

  constructor(root: HTMLElement, private ctx: GameContext) {
    this.size = ctx.option("size") in SIZES ? ctx.option("size") : "medium";
    this.n = SIZES[this.size];
    this.el = document.createElement("div");
    this.el.className = "pipes";
    root.appendChild(this.el);
    this.el.addEventListener("contextmenu", (e) => e.preventDefault());
    this.timer = new GameTimer(() => this.status());
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(this.el);

    const saved = load<Saved | null>(SAVE, null);
    if (saved && saved.n === this.n && saved.base?.length === this.n * this.n) {
      this.base = saved.base;
      this.turns = saved.turns;
      this.moves = saved.moves;
      this.locked = new Set(saved.locked ?? []);
      this.par = saved.par ?? 0;
      this.counted = saved.counted;
      this.timer.reset(saved.seconds);
      this.build();
      this.status();
    } else this.newGame();
  }

  private get key() {
    return `pipes:${this.size}`;
  }

  private get center() {
    return Math.floor(this.n / 2) * this.n + Math.floor(this.n / 2);
  }

  newGame() {
    if (this.counted && !this.over) recordLoss(this.key);
    this.base = makeTree(this.n);
    do {
      this.turns = this.base.map(() => Math.floor(Math.random() * 4));
    } while (this.isSolved());
    this.par = this.base.reduce((sum, _, i) => sum + this.turnsToFix(i, 1), 0);
    this.locked = new Set();
    this.moves = 0;
    this.over = false;
    this.counted = false;
    this.timer.reset();
    this.ctx.clearEnd();
    this.ctx.setUndo(false);
    this.build(true);
    this.persist();
    this.status();
  }

  inProgress() {
    return this.counted && !this.over;
  }

  setPaused(paused: boolean) {
    this.paused = paused;
  }

  /** Quarter turns in direction `dir` that bring tile i back to a solved orientation. */
  private turnsToFix(i: number, dir: 1 | -1): number {
    for (let k = 0; k < 4; k++) if (rot(this.base[i], this.turns[i] + dir * k) === this.base[i]) return k;
    return 0;
  }

  /** Turn one out-of-place tile into position and pin it. */
  requestHint() {
    if (this.over || this.paused || !getSettings().hints) return;
    const wrong = this.base.map((_, i) => i).filter((i) => this.turnsToFix(i, 1) > 0 && !this.locked.has(i));
    if (!wrong.length) return this.ctx.toast("Every unpinned tile is already in place.");
    // Prefer tiles touching the lit network, so the hint helps right where the player is.
    const { lit } = this.trace();
    const n = this.n;
    const near = wrong.filter((i) => [i - n, i + n, i % n ? i - 1 : -1, (i + 1) % n ? i + 1 : -1].some((j) => lit.has(j)));
    const pool = near.length ? near : wrong;
    const i = pool[Math.floor(Math.random() * pool.length)];
    const k = this.turnsToFix(i, 1);
    const back = this.turnsToFix(i, -1);
    for (let t = 0; t < Math.min(k, back); t++) this.turn(i, k <= back ? 1 : -1, true);
    this.locked.add(i);
    this.paint();
    this.persist();
  }

  destroy() {
    this.persist();
    this.timer.destroy();
    this.resizeObs.disconnect();
    this.el.remove();
  }

  resize() {
    const r = this.el.getBoundingClientRect();
    const size = Math.min(r.width - 48, r.height - 48, 680);
    this.el.style.setProperty("--bsz", `${Math.max(240, size)}px`);
  }

  private persist() {
    if (this.over) return remove(SAVE);
    const data: Saved = {
      n: this.n,
      base: this.base,
      turns: this.turns,
      moves: this.moves,
      locked: [...this.locked],
      par: this.par,
      seconds: this.timer.seconds,
      counted: this.counted,
    };
    save(SAVE, data);
  }

  private mask(i: number) {
    return rot(this.base[i], this.turns[i]);
  }

  /** Cells reachable from the source along matching connections, and whether any pipe points nowhere. */
  private trace(): { lit: Set<number>; loose: boolean } {
    const n = this.n;
    const lit = new Set([this.center]);
    const stack = [this.center];
    while (stack.length) {
      const i = stack.pop()!;
      const r = Math.floor(i / n);
      const c = i % n;
      const m = this.mask(i);
      for (const [bit, dr, dc, back] of DIRS) {
        if (!(m & bit)) continue;
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= n || nc >= n) continue;
        const j = nr * n + nc;
        if (!lit.has(j) && this.mask(j) & back) {
          lit.add(j);
          stack.push(j);
        }
      }
    }
    let loose = false;
    for (let i = 0; i < n * n && !loose; i++) {
      const r = Math.floor(i / n);
      const c = i % n;
      const m = this.mask(i);
      for (const [bit, dr, dc, back] of DIRS) {
        if (!(m & bit)) continue;
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= n || nc >= n || !(this.mask(nr * n + nc) & back)) {
          loose = true;
          break;
        }
      }
    }
    return { lit, loose };
  }

  private isSolved() {
    const { lit, loose } = this.trace();
    return !loose && lit.size === this.n * this.n;
  }

  private build(intro = false) {
    const n = this.n;
    const ns = "http://www.w3.org/2000/svg";
    this.el.innerHTML = `<svg class="pp-board" viewBox="0 0 ${n} ${n}" role="grid" aria-label="Pipes"></svg>`;
    this.svg = this.el.querySelector("svg")!;
    let bg = "";
    for (let i = 0; i < n * n; i++) {
      const r = Math.floor(i / n);
      const c = i % n;
      bg += `<rect class="pp-cell" x="${c + 0.04}" y="${r + 0.04}" width="0.92" height="0.92" rx="0.14"/>`;
    }
    this.svg.innerHTML = `<g class="pp-bg">${bg}</g>`;
    this.tileEls = [];
    for (let i = 0; i < n * n; i++) {
      const r = Math.floor(i / n);
      const c = i % n;
      const g = document.createElementNS(ns, "g");
      g.classList.add("pp-tile");
      g.dataset.i = String(i);
      g.style.transformOrigin = `${c + 0.5}px ${r + 0.5}px`;
      const m = this.base[i];
      let body = `<rect class="pp-hit" x="${c}" y="${r}" width="1" height="1"/>`;
      const cx = c + 0.5;
      const cy = r + 0.5;
      for (const [bit, dr, dc] of DIRS) if (m & bit) body += `<line class="pp-pipe" x1="${cx}" y1="${cy}" x2="${cx + dc * 0.5}" y2="${cy + dr * 0.5}"/>`;
      body += `<circle class="pp-joint" cx="${cx}" cy="${cy}" r="0.09"/>`;
      if (i === this.center) body += `<circle class="pp-source" cx="${cx}" cy="${cy}" r="0.26"/>`;
      else if ([1, 2, 4, 8].includes(m)) body += `<circle class="pp-end" cx="${cx}" cy="${cy}" r="0.2"/>`;
      g.innerHTML = body;
      g.style.transform = `rotate(${this.turns[i] * 90}deg)`;
      if (intro && motionEnabled()) {
        g.classList.add("intro");
        g.style.animationDelay = `${(r + c) * 22 * animScale()}ms`;
      }
      this.svg.appendChild(g);
      this.tileEls.push(g);
    }
    this.svg.addEventListener("pointerdown", (e) => {
      const g = (e.target as Element).closest<SVGGElement>(".pp-tile");
      if (!g || this.paused) return;
      e.preventDefault();
      const i = Number(g.dataset.i);
      if (e.button === 1 || e.ctrlKey || e.metaKey) return this.toggleLock(i);
      if (this.locked.has(i)) {
        sfx.error();
        return;
      }
      this.turn(i, e.button === 2 || e.shiftKey ? -1 : 1);
    });
    this.resize();
    this.paint();
  }

  private toggleLock(i: number) {
    if (this.over) return;
    if (this.locked.has(i)) this.locked.delete(i);
    else this.locked.add(i);
    sfx.flag();
    this.paint();
    this.persist();
  }

  private paint() {
    const { lit } = this.trace();
    this.tileEls.forEach((g, i) => {
      g.classList.toggle("lit", lit.has(i));
      g.classList.toggle("locked", this.locked.has(i));
    });
    this.svg.classList.toggle("solved", this.over);
  }

  private turn(i: number, dir: 1 | -1, quiet = false) {
    if (this.over) return;
    // Keep counting past 360° so the CSS transition always spins the short way.
    this.turns[i] += dir;
    this.tileEls[i].style.transform = `rotate(${this.turns[i] * 90}deg)`;
    this.moves++;
    if (!this.counted) {
      this.counted = true;
      recordStart(this.key);
    }
    this.timer.start();
    if (!quiet) sfx.tick();
    this.paint();
    this.status();
    if (this.isSolved()) this.win();
    else this.persist();
  }

  private win() {
    this.over = true;
    this.timer.stop();
    const secs = Math.round(this.timer.seconds);
    const { newBestTime } = recordWin(this.key, secs);
    const bestKey = `best:${this.key}`;
    const prev = load<number | null>(bestKey, null);
    const newBestTurns = prev == null || this.moves < prev;
    if (newBestTurns) save(bestKey, this.moves);
    remove(SAVE);
    sfx.win();
    this.paint();
    this.status();
    setTimeout(
      () =>
        this.ctx.end({
          won: true,
          title: "All connected",
          lines: [
            `${formatTime(secs)}${newBestTime ? " — a new best" : ""}`,
            `${this.moves} turns${this.par ? ` (par ${this.par})` : ""}${newBestTurns && prev != null ? " — fewest yet" : ""}`,
          ],
        }),
      700,
    );
  }

  private status() {
    const { lit } = this.base.length ? this.trace() : { lit: new Set() };
    this.ctx.setStatus([
      { label: "Connected", value: `${lit.size}/${this.n * this.n}` },
      { label: "Turns", value: this.par ? `${this.moves}/${this.par}` : String(this.moves) },
      { label: "Time", value: formatTime(this.timer.seconds) },
    ]);
  }
}

export function create(root: HTMLElement, ctx: GameContext): GameInstance {
  return new Pipes(root, ctx);
}
