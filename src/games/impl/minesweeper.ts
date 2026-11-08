import { GameContext, GameInstance } from "../../core/types";
import { GameTimer } from "../../core/timer";
import { formatTime, recordLoss, recordStart, recordWin } from "../../core/stats";
import { sfx } from "../../core/sound";
import { animScale, motionEnabled } from "../../core/settings";

const LEVELS: Record<string, { cols: number; rows: number; mines: number }> = {
  easy: { cols: 9, rows: 9, mines: 10 },
  medium: { cols: 16, rows: 16, mines: 40 },
  hard: { cols: 30, rows: 16, mines: 99 },
  huge: { cols: 30, rows: 24, mines: 150 },
};

const FLAG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 21V4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M8 4h10l-3 4 3 4H8z" fill="currentColor"/></svg>`;
const MINE = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5.5" fill="currentColor"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

class Minesweeper implements GameInstance {
  private el: HTMLDivElement;
  private grid: HTMLDivElement;
  private cells: HTMLButtonElement[] = [];
  private mines: boolean[] = [];
  private counts: number[] = [];
  private open: boolean[] = [];
  private flags: boolean[] = [];
  /** Question marks (only used when the marks option is on). */
  private marks: boolean[] = [];
  private paused = false;
  private noGuess: boolean;
  private useMarks: boolean;
  private placed = false;
  private over = false;
  private cols: number;
  private rows: number;
  private mineCount: number;
  private level: string;
  private timer: GameTimer;
  private resizeObs: ResizeObserver;

  constructor(root: HTMLElement, private ctx: GameContext) {
    this.level = ctx.option("level") in LEVELS ? ctx.option("level") : "easy";
    ({ cols: this.cols, rows: this.rows, mines: this.mineCount } = LEVELS[this.level]);
    this.noGuess = ctx.option("guess") === "noguess";
    this.useMarks = ctx.option("marks") === "on";
    this.el = document.createElement("div");
    this.el.className = "mines";
    this.grid = document.createElement("div");
    this.grid.className = "mines-grid";
    this.grid.style.setProperty("--cols", String(this.cols));
    this.el.appendChild(this.grid);
    root.appendChild(this.el);
    this.timer = new GameTimer(() => this.status());
    this.grid.addEventListener("pointerup", this.onPointer);
    this.grid.addEventListener("contextmenu", (e) => e.preventDefault());
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(this.el);
    this.newGame();
  }

  private get key() {
    return `minesweeper:${this.level}`;
  }

  newGame() {
    if (this.placed && !this.over) recordLoss(this.key);
    const n = this.cols * this.rows;
    this.mines = Array(n).fill(false);
    this.counts = Array(n).fill(0);
    this.open = Array(n).fill(false);
    this.flags = Array(n).fill(false);
    this.marks = Array(n).fill(false);
    this.placed = false;
    this.over = false;
    this.timer.reset();
    this.ctx.clearEnd();
    this.grid.innerHTML = "";
    this.cells = [];
    for (let i = 0; i < n; i++) {
      const b = document.createElement("button");
      b.className = "cell";
      b.dataset.i = String(i);
      b.setAttribute("aria-label", `Row ${Math.floor(i / this.cols) + 1}, column ${(i % this.cols) + 1}`);
      this.grid.appendChild(b);
      this.cells.push(b);
    }
    this.resize();
    this.status();
    this.ctx.setUndo(false);
  }

  resize() {
    const w = this.el.clientWidth - 32;
    const h = this.el.clientHeight - 32;
    const size = Math.floor(Math.min(w / this.cols, h / this.rows, 46));
    this.grid.style.setProperty("--size", `${Math.max(size, 16)}px`);
  }

  inProgress() {
    return this.placed && !this.over;
  }

  setPaused(paused: boolean) {
    this.paused = paused;
  }

  destroy() {
    this.timer.destroy();
    this.resizeObs.disconnect();
    this.el.remove();
  }

  private neighbors(i: number): number[] {
    const x = i % this.cols;
    const y = Math.floor(i / this.cols);
    const out: number[] = [];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < this.cols && ny < this.rows) out.push(ny * this.cols + nx);
      }
    return out;
  }

  /** Mines are placed after the first click so it's always safe and opens an area.
   *  With "No guessing" on, boards are regenerated until logic alone can clear them. */
  private place(safe: number) {
    const keepClear = new Set([safe, ...this.neighbors(safe)]);
    const n = this.cols * this.rows;
    const deadline = performance.now() + (this.noGuess ? 600 : 0);
    let tries = 0;
    for (;;) {
      tries++;
      this.mines = Array(n).fill(false);
      const pool = [...Array(n).keys()].filter((i) => !keepClear.has(i));
      for (let k = 0; k < this.mineCount; k++) {
        const j = k + Math.floor(Math.random() * (pool.length - k));
        [pool[k], pool[j]] = [pool[j], pool[k]];
        this.mines[pool[k]] = true;
      }
      for (let i = 0; i < n; i++) this.counts[i] = this.neighbors(i).filter((x) => this.mines[x]).length;
      if (!this.noGuess || this.solvable(safe) || performance.now() > deadline) break;
    }
    if (this.noGuess && tries > 1 && performance.now() > deadline && !this.solvable(safe))
      this.ctx.toast("Couldn't find a guess-free board in time. This one may need a guess.");
    this.placed = true;
    recordStart(this.key);
    this.timer.start();
  }

  /** Whether the board can be cleared from the first click using only deduction. */
  private solvable(start: number): boolean {
    const n = this.cols * this.rows;
    const open = new Uint8Array(n);
    const mine = new Uint8Array(n);
    let opened = 0;
    const safeTotal = n - this.mineCount;
    const reveal = (i: number) => {
      const q = [i];
      while (q.length) {
        const k = q.pop()!;
        if (open[k]) continue;
        open[k] = 1;
        opened++;
        if (this.counts[k] === 0) for (const x of this.neighbors(k)) if (!open[x]) q.push(x);
      }
    };
    reveal(start);
    const nb = Array.from({ length: n }, (_, i) => this.neighbors(i));
    let progress = true;
    while (progress && opened < safeTotal) {
      progress = false;
      // Frontier: open numbers with unknown neighbors.
      const front: { u: number[]; rem: number }[] = [];
      for (let i = 0; i < n; i++) {
        if (!open[i] || this.counts[i] === 0) continue;
        const u: number[] = [];
        let m = 0;
        for (const x of nb[i]) {
          if (mine[x]) m++;
          else if (!open[x]) u.push(x);
        }
        if (!u.length) continue;
        const rem = this.counts[i] - m;
        if (rem === 0) {
          u.forEach(reveal);
          progress = true;
        } else if (rem === u.length) {
          u.forEach((x) => (mine[x] = 1));
          progress = true;
        } else front.push({ u, rem });
      }
      if (progress) continue;
      // Subset rule: if A's unknowns sit inside B's, the difference holds rem(B) − rem(A) mines.
      for (let a = 0; a < front.length && !progress; a++) {
        const A = front[a];
        const setA = new Set(A.u);
        for (let b = 0; b < front.length; b++) {
          if (a === b) continue;
          const B = front[b];
          if (B.u.length <= A.u.length || !A.u.every((x) => B.u.includes(x))) continue;
          const diff = B.u.filter((x) => !setA.has(x));
          const d = B.rem - A.rem;
          if (d === 0) {
            diff.forEach(reveal);
            progress = true;
          } else if (d === diff.length) {
            diff.forEach((x) => (mine[x] = 1));
            progress = true;
          }
          if (progress) break;
        }
      }
      if (!progress) {
        // Global count: if every remaining mine is accounted for, the rest are safe.
        let known = 0;
        for (let i = 0; i < n; i++) known += mine[i];
        if (known === this.mineCount) {
          for (let i = 0; i < n; i++) if (!open[i] && !mine[i]) reveal(i);
          progress = true;
        }
      }
    }
    return opened >= safeTotal;
  }

  private onPointer = (e: PointerEvent) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>(".cell");
    if (!t || this.over || this.paused) return;
    const i = Number(t.dataset.i);
    if (e.button === 2 || (e.button === 0 && (e.ctrlKey || e.altKey))) this.toggleFlag(i);
    else if (e.button === 0 || e.button === 1) {
      if (this.open[i]) this.chord(i);
      else this.reveal(i);
    }
  };

  private toggleFlag(i: number) {
    if (this.open[i] || !this.placed) return;
    // Cycle: blank → flag → question mark (when marks are on) → blank.
    if (this.flags[i]) {
      this.flags[i] = false;
      this.marks[i] = this.useMarks;
    } else if (this.marks[i]) this.marks[i] = false;
    else this.flags[i] = true;
    this.paint(i);
    sfx.flag();
    this.status();
  }

  private chord(i: number) {
    const ns = this.neighbors(i);
    const flagged = ns.filter((n) => this.flags[n]).length;
    if (flagged !== this.counts[i]) {
      ns.filter((n) => !this.open[n] && !this.flags[n]).forEach((n) => this.press(n));
      return;
    }
    const before = this.openCount();
    for (const n of ns) if (!this.open[n] && !this.flags[n]) this.reveal(n, i, false);
    if (this.openCount() > before && !this.over) sfx.tick();
  }

  private press(i: number) {
    const c = this.cells[i];
    c.classList.add("pressed");
    setTimeout(() => c.classList.remove("pressed"), 140);
  }

  private openCount() {
    return this.open.filter(Boolean).length;
  }

  private reveal(i: number, origin = i, sound = true) {
    if (this.flags[i] || this.open[i]) return;
    if (!this.placed) this.place(i);
    if (this.mines[i]) return this.lose(i);
    const ox = origin % this.cols;
    const oy = Math.floor(origin / this.cols);
    const animate = motionEnabled();
    // Flood fill outward; delay grows with distance for a ripple.
    const queue = [i];
    while (queue.length) {
      const k = queue.shift()!;
      if (this.open[k] || this.flags[k]) continue;
      this.open[k] = true;
      const dist = Math.hypot((k % this.cols) - ox, Math.floor(k / this.cols) - oy);
      this.marks[k] = false;
      this.paint(k, animate ? Math.min(dist * 18 * animScale(), 400) : 0);
      if (this.counts[k] === 0) for (const n of this.neighbors(k)) if (!this.open[n] && !this.mines[n]) queue.push(n);
    }
    if (sound) sfx.tick();
    this.checkWin();
  }

  private paint(i: number, delay = 0) {
    const c = this.cells[i];
    if (this.open[i]) {
      c.className = "cell open";
      c.style.animationDelay = `${delay}ms`;
      const n = this.counts[i];
      c.dataset.n = String(n);
      c.textContent = n ? String(n) : "";
    } else {
      c.className = this.flags[i] ? "cell flagged" : this.marks[i] ? "cell marked" : "cell";
      c.innerHTML = this.flags[i] ? FLAG : this.marks[i] ? "?" : "";
    }
  }

  private lose(hit: number) {
    this.over = true;
    this.timer.stop();
    recordLoss(this.key);
    sfx.lose();
    const animate = motionEnabled();
    const hx = hit % this.cols;
    const hy = Math.floor(hit / this.cols);
    this.mines.forEach((m, i) => {
      const c = this.cells[i];
      if (m && !this.flags[i]) {
        const d = animate ? Math.hypot((i % this.cols) - hx, Math.floor(i / this.cols) - hy) * 35 * animScale() : 0;
        c.className = `cell mine${i === hit ? " hit" : ""}`;
        c.style.animationDelay = `${d}ms`;
        c.innerHTML = MINE;
      } else if (!m && this.flags[i]) {
        c.classList.add("wrong");
      }
    });
    setTimeout(() => this.ctx.end({ won: false, title: "Boom", lines: ["That one was a mine.", formatTime(this.timer.seconds)] }), 900);
  }

  private checkWin() {
    if (this.over) return;
    const safe = this.cols * this.rows - this.mineCount;
    if (this.openCount() < safe) return;
    this.over = true;
    this.timer.stop();
    this.mines.forEach((m, i) => {
      if (m && !this.flags[i]) {
        this.flags[i] = true;
        this.paint(i);
      }
    });
    this.status();
    const secs = Math.round(this.timer.seconds);
    const { newBestTime } = recordWin(this.key, secs);
    sfx.win();
    setTimeout(
      () =>
        this.ctx.end({
          won: true,
          title: "Cleared",
          lines: [`${formatTime(secs)}${newBestTime ? " — a new best" : ""}`, `${LEVELS[this.level].mines} mines found`],
        }),
      500,
    );
  }

  private status() {
    const flagged = this.flags.filter(Boolean).length;
    this.ctx.setStatus([
      { label: "Mines", value: String(this.mineCount - flagged) },
      { label: "Time", value: formatTime(this.timer.seconds) },
    ]);
  }
}

export function create(root: HTMLElement, ctx: GameContext): GameInstance {
  return new Minesweeper(root, ctx);
}
