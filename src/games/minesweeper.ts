import { GameContext, GameInstance, GameModule } from "../core/types";
import { GameTimer } from "../core/timer";
import { formatTime, recordLoss, recordStart, recordWin } from "../core/stats";
import { sfx } from "../core/sound";
import { motionEnabled } from "../core/settings";

const LEVELS: Record<string, { cols: number; rows: number; mines: number }> = {
  easy: { cols: 9, rows: 9, mines: 10 },
  medium: { cols: 16, rows: 16, mines: 40 },
  hard: { cols: 30, rows: 16, mines: 99 },
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

  /** Mines are placed after the first click so it's always safe and opens an area. */
  private place(safe: number) {
    const keepClear = new Set([safe, ...this.neighbors(safe)]);
    const pool = [...Array(this.cols * this.rows).keys()].filter((i) => !keepClear.has(i));
    for (let k = 0; k < this.mineCount; k++) {
      const j = k + Math.floor(Math.random() * (pool.length - k));
      [pool[k], pool[j]] = [pool[j], pool[k]];
      this.mines[pool[k]] = true;
    }
    for (let i = 0; i < this.mines.length; i++)
      this.counts[i] = this.neighbors(i).filter((n) => this.mines[n]).length;
    this.placed = true;
    recordStart(this.key);
    this.timer.start();
  }

  private onPointer = (e: PointerEvent) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>(".cell");
    if (!t || this.over) return;
    const i = Number(t.dataset.i);
    if (e.button === 2 || (e.button === 0 && (e.ctrlKey || e.altKey))) this.toggleFlag(i);
    else if (e.button === 0 || e.button === 1) {
      if (this.open[i]) this.chord(i);
      else this.reveal(i);
    }
  };

  private toggleFlag(i: number) {
    if (this.open[i] || !this.placed) return;
    this.flags[i] = !this.flags[i];
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
      this.paint(k, animate ? Math.min(dist * 18, 400) : 0);
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
      c.className = this.flags[i] ? "cell flagged" : "cell";
      c.innerHTML = this.flags[i] ? FLAG : "";
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
        const d = animate ? Math.hypot((i % this.cols) - hx, Math.floor(i / this.cols) - hy) * 35 : 0;
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

export const minesweeper: GameModule = {
  id: "minesweeper",
  name: "Minesweeper",
  group: "arcade",
  blurb: "Clear the field without touching a mine. Right-click to flag.",
  art: "minesweeper",
  hasUndo: false,
  options: [
    {
      key: "level",
      label: "Level",
      default: "easy",
      choices: [
        { value: "easy", label: "Easy 9×9" },
        { value: "medium", label: "Medium 16×16" },
        { value: "hard", label: "Hard 30×16" },
      ],
    },
  ],
  statsKey: (o) => `minesweeper:${o("level")}`,
  create: (root, ctx) => new Minesweeper(root, ctx),
};
