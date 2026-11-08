import { GameContext, GameInstance } from "../../core/types";
import { GameTimer } from "../../core/timer";
import { formatTime, recordLoss, recordStart, recordWin } from "../../core/stats";
import { load, remove, save } from "../../core/storage";
import { sfx } from "../../core/sound";
import { dailyRng, dayNumber, todayKey } from "../../core/rng";
import { markDailyDone } from "../../core/daily";

const SIZES: Record<string, number> = { small: 5, medium: 10, large: 15, huge: 20 };
const SAVE = "save:nonogram";

// Cell states: 0 empty, 1 filled, 2 marked with an X.
type Line = number[];

function cluesOf(line: number[]): number[] {
  const out: number[] = [];
  let run = 0;
  for (const v of line) {
    if (v === 1) run++;
    else if (run) {
      out.push(run);
      run = 0;
    }
  }
  if (run) out.push(run);
  return out;
}

/**
 * Line solver: given clues and known cells (-1 unknown, 0 empty, 1 filled),
 * return every cell forced by all consistent placements, or null if none fit.
 */
function solveLine(clues: number[], known: Line): Line | null {
  const n = known.length;
  const can1 = Array(n).fill(false);
  const can0 = Array(n).fill(false);
  const cur = Array(n).fill(0);
  let any = false;
  const place = (ci: number, start: number) => {
    if (ci === clues.length) {
      for (let i = start; i < n; i++) if (known[i] === 1) return;
      any = true;
      for (let i = 0; i < n; i++) {
        const v = i < start ? cur[i] : 0;
        if (v) can1[i] = true;
        else can0[i] = true;
      }
      return;
    }
    const len = clues[ci];
    const remaining = clues.slice(ci + 1).reduce((a, b) => a + b + 1, 0);
    for (let p = start; p + len + remaining <= n; p++) {
      // Cells before the block must be allowed to be empty.
      if (p > start && known[p - 1] === 1) break;
      let ok = true;
      for (let i = p; i < p + len; i++) if (known[i] === 0) ok = false;
      if (!ok || (p + len < n && known[p + len] === 1)) continue;
      for (let i = start; i < p; i++) cur[i] = 0;
      for (let i = p; i < p + len; i++) cur[i] = 1;
      if (p + len < n) cur[p + len] = 0;
      place(ci + 1, Math.min(n, p + len + 1));
    }
  };
  place(0, 0);
  if (!any) return null;
  return known.map((v, i) => (can1[i] && !can0[i] ? 1 : can0[i] && !can1[i] ? 0 : v));
}

/** True if the puzzle can be finished one line at a time, with no guessing. */
function logicSolvable(rows: number[][], cols: number[][], size: number): boolean {
  const g: number[][] = Array.from({ length: size }, () => Array(size).fill(-1));
  let changed = true;
  while (changed) {
    changed = false;
    for (let r = 0; r < size; r++) {
      const res = solveLine(rows[r], g[r]);
      if (!res) return false;
      res.forEach((v, c) => {
        if (v !== g[r][c]) {
          g[r][c] = v;
          changed = true;
        }
      });
    }
    for (let c = 0; c < size; c++) {
      const res = solveLine(cols[c], g.map((row) => row[c]));
      if (!res) return false;
      res.forEach((v, r) => {
        if (v !== g[r][c]) {
          g[r][c] = v;
          changed = true;
        }
      });
    }
  }
  return g.every((row) => row.every((v) => v !== -1));
}

function generate(size: number, rng: () => number = Math.random) {
  let best: { rows: number[][]; cols: number[][] } | null = null;
  // Practice boards stop searching after a moment; the daily puzzle never does, so it's the same everywhere.
  const deadline = rng === Math.random ? performance.now() + 1500 : Infinity;
  for (let attempt = 0; attempt < 400; attempt++) {
    if (best && performance.now() > deadline) break;
    const density = 0.55 + rng() * 0.1;
    const grid = Array.from({ length: size }, () => Array.from({ length: size }, () => (rng() < density ? 1 : 0)));
    const rows = grid.map(cluesOf);
    const cols = grid[0].map((_, c) => cluesOf(grid.map((r) => r[c])));
    best = { rows, cols };
    if (logicSolvable(rows, cols, size)) break;
  }
  return best!;
}

interface Saved {
  size: number;
  day?: string;
  rows: number[][];
  cols: number[][];
  cells: number[];
  seconds: number;
  counted: boolean;
}

class Nonogram implements GameInstance {
  private el: HTMLDivElement;
  private grid!: HTMLDivElement;
  private cellEls: HTMLDivElement[] = [];
  private size: number;
  private level: string;
  private daily: boolean;
  private dayTag: string;
  private rows: number[][] = [];
  private cols: number[][] = [];
  private cells: number[] = [];
  private history: number[][] = [];
  private stroke: { value: number; before: number[] } | null = null;
  private timer: GameTimer;
  private over = false;
  private counted = false;
  private resizeObs: ResizeObserver;
  private paused = false;
  /** Cross out the rest of a line once its clue is met. */
  private autoX: boolean;
  private hoverR = -1;
  private hoverC = -1;

  constructor(root: HTMLElement, private ctx: GameContext) {
    this.autoX = ctx.option("autox") !== "off";
    this.daily = ctx.option("mode") === "daily";
    this.level = ctx.option("size") in SIZES ? ctx.option("size") : "medium";
    if (this.daily) this.level = "medium";
    this.size = SIZES[this.level];
    this.dayTag = this.daily ? todayKey() : "";
    this.el = document.createElement("div");
    this.el.className = "nonogram";
    root.appendChild(this.el);
    this.timer = new GameTimer(() => this.status());
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(this.el);
    window.addEventListener("pointerup", this.endStroke);
    this.el.addEventListener("contextmenu", (e) => e.preventDefault());

    const saved = load<Saved | null>(SAVE, null);
    if (saved && saved.size === this.size && (saved.day ?? "") === this.dayTag) {
      this.rows = saved.rows;
      this.cols = saved.cols;
      this.cells = saved.cells;
      this.counted = saved.counted;
      this.timer.reset(saved.seconds);
      this.build();
      this.status();
    } else this.newGame();
  }

  private get key() {
    return this.daily ? "nonogram:daily" : `nonogram:${this.level}`;
  }

  newGame() {
    if (this.counted && !this.over) recordLoss(this.key);
    const p = generate(this.size, this.daily ? dailyRng("nonogram") : Math.random);
    this.rows = p.rows;
    this.cols = p.cols;
    this.cells = Array(this.size * this.size).fill(0);
    this.history = [];
    this.over = false;
    this.counted = false;
    this.timer.reset();
    this.ctx.clearEnd();
    this.build();
    this.persist();
    this.status();
  }

  undo() {
    const h = this.history.pop();
    if (!h || this.over) return;
    this.cells = h;
    sfx.flip();
    this.paint();
    this.persist();
  }

  inProgress() {
    return this.counted && !this.over;
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    if (paused) this.endStroke();
  }

  destroy() {
    window.removeEventListener("pointerup", this.endStroke);
    this.persist();
    this.timer.destroy();
    this.resizeObs.disconnect();
    this.el.remove();
  }

  resize() {
    const r = this.el.getBoundingClientRect();
    const clueRoom = Math.ceil(this.size / 2) + 0.5;
    const cell = Math.floor(Math.min((r.width - 48) / (this.size + clueRoom), (r.height - 48) / (this.size + clueRoom)));
    this.el.style.setProperty("--cell", `${Math.max(16, Math.min(cell, 44))}px`);
  }

  private persist() {
    if (this.over) return remove(SAVE);
    const data: Saved = { day: this.dayTag, size: this.size, rows: this.rows, cols: this.cols, cells: this.cells, seconds: this.timer.seconds, counted: this.counted };
    save(SAVE, data);
  }

  private build() {
    const n = this.size;
    const clue = (c: number[]) => (c.length ? c : [0]).map((v) => `<span>${v}</span>`).join("");
    this.el.innerHTML = `
      <div class="ng" style="--n:${n}">
        <div class="ng-corner"></div>
        <div class="ng-cols">${this.cols.map((c, i) => `<div class="ng-clue col" data-c="${i}">${clue(c)}</div>`).join("")}</div>
        <div class="ng-rows">${this.rows.map((c, i) => `<div class="ng-clue row" data-r="${i}">${clue(c)}</div>`).join("")}</div>
        <div class="ng-grid"></div>
      </div>`;
    this.grid = this.el.querySelector(".ng-grid")!;
    this.cellEls = [];
    for (let i = 0; i < n * n; i++) {
      const d = document.createElement("div");
      d.className = "ng-cell";
      d.dataset.i = String(i);
      const r = Math.floor(i / n);
      const c = i % n;
      if (c % 5 === 4 && c < n - 1) d.classList.add("edge-r");
      if (r % 5 === 4 && r < n - 1) d.classList.add("edge-b");
      this.grid.appendChild(d);
      this.cellEls.push(d);
    }
    this.grid.addEventListener("pointerdown", this.startStroke);
    this.grid.addEventListener("pointermove", this.moveStroke);
    this.grid.addEventListener("pointerleave", () => this.setHover(-1));
    this.resize();
    this.paint();
  }

  private cellAt(e: PointerEvent): number | null {
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>(".ng-cell");
    return el && this.grid.contains(el) ? Number(el.dataset.i) : null;
  }

  /** Light up the row and column under the pointer, clues included. */
  private setHover(i: number) {
    const n = this.size;
    const r = i < 0 ? -1 : Math.floor(i / n);
    const c = i < 0 ? -1 : i % n;
    if (r === this.hoverR && c === this.hoverC) return;
    const rowClues = this.el.querySelectorAll<HTMLElement>(".ng-clue.row");
    const colClues = this.el.querySelectorAll<HTMLElement>(".ng-clue.col");
    rowClues[this.hoverR]?.classList.remove("hover");
    colClues[this.hoverC]?.classList.remove("hover");
    this.hoverR = r;
    this.hoverC = c;
    rowClues[r]?.classList.add("hover");
    colClues[c]?.classList.add("hover");
    this.grid.style.setProperty("--hr", String(r));
    this.grid.style.setProperty("--hc", String(c));
    this.grid.classList.toggle("hovering", i >= 0);
  }

  private startStroke = (e: PointerEvent) => {
    if (this.over || this.paused) return;
    const i = this.cellAt(e);
    if (i == null) return;
    e.preventDefault();
    const mark = e.button === 2 || e.ctrlKey || e.altKey;
    const target = mark ? 2 : 1;
    // Clicking a cell that already has this state clears it, and the drag does the same.
    const value = this.cells[i] === target ? 0 : target;
    this.stroke = { value, before: this.cells.slice() };
    this.apply(i);
  };

  private moveStroke = (e: PointerEvent) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>(".ng-cell");
    if (!this.stroke) {
      if (t && e.pointerType === "mouse") this.setHover(Number(t.dataset.i));
      return;
    }
    const i = this.cellAt(e);
    if (i != null) {
      this.apply(i);
      this.setHover(i);
    }
  };

  /** Fill the empty cells of every finished line with X. */
  private crossFinished() {
    const n = this.size;
    const same = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);
    const mark = (i: number) => {
      if (this.cells[i] === 0) {
        this.cells[i] = 2;
        this.paintCell(i);
      }
    };
    for (let k = 0; k < n; k++) {
      if (this.rows[k].length && same(cluesOf(this.line(k, null)), this.rows[k])) for (let c = 0; c < n; c++) mark(k * n + c);
      if (this.cols[k].length && same(cluesOf(this.line(null, k)), this.cols[k])) for (let r = 0; r < n; r++) mark(r * n + k);
    }
  }

  private apply(i: number) {
    const s = this.stroke!;
    if (this.cells[i] === s.value) return;
    // A fill stroke doesn't overwrite X marks, and vice versa.
    if (s.value !== 0 && this.cells[i] !== 0) return;
    this.cells[i] = s.value;
    if (s.value === 1) sfx.tick();
    this.paintCell(i);
    this.paintClues();
  }

  private endStroke = () => {
    const s = this.stroke;
    if (!s) return;
    this.stroke = null;
    if (s.before.every((v, i) => v === this.cells[i])) return;
    if (this.autoX && s.value === 1) this.crossFinished();
    this.history.push(s.before);
    if (this.history.length > 300) this.history.shift();
    if (!this.counted) {
      this.counted = true;
      recordStart(this.key);
    }
    this.timer.start();
    this.ctx.setUndo(true);
    this.checkWin();
    this.persist();
  };

  private paintCell(i: number) {
    const v = this.cells[i];
    const el = this.cellEls[i];
    el.classList.toggle("on", v === 1);
    el.classList.toggle("x", v === 2);
  }

  private line(r: number | null, c: number | null) {
    const n = this.size;
    if (r != null) return this.cells.slice(r * n, r * n + n).map((v) => (v === 1 ? 1 : 0));
    return Array.from({ length: n }, (_, k) => (this.cells[k * n + c!] === 1 ? 1 : 0));
  }

  private paintClues() {
    const same = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);
    this.el.querySelectorAll<HTMLElement>(".ng-clue.row").forEach((el, r) => el.classList.toggle("done", same(cluesOf(this.line(r, null)), this.rows[r])));
    this.el.querySelectorAll<HTMLElement>(".ng-clue.col").forEach((el, c) => el.classList.toggle("done", same(cluesOf(this.line(null, c)), this.cols[c])));
  }

  private paint() {
    this.cells.forEach((_, i) => this.paintCell(i));
    this.paintClues();
    this.ctx.setUndo(this.history.length > 0 && !this.over);
  }

  private checkWin() {
    const same = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);
    for (let k = 0; k < this.size; k++) {
      if (!same(cluesOf(this.line(k, null)), this.rows[k])) return;
      if (!same(cluesOf(this.line(null, k)), this.cols[k])) return;
    }
    this.over = true;
    this.timer.stop();
    const secs = Math.round(this.timer.seconds);
    const { newBestTime } = recordWin(this.key, secs);
    remove(SAVE);
    sfx.win();
    if (this.daily) markDailyDone("nonogram");
    this.el.querySelector(".ng")!.classList.add("solved");
    this.ctx.setUndo(false);
    setTimeout(
      () => this.ctx.end({ won: true, title: this.daily ? `Daily #${dayNumber()} solved` : "Solved", lines: [`${formatTime(secs)}${newBestTime ? " — a new best" : ""}`, `${this.size}×${this.size}`] }),
      700,
    );
  }

  private status() {
    this.ctx.setStatus([{ label: "Time", value: formatTime(this.timer.seconds) }]);
  }
}

export function create(root: HTMLElement, ctx: GameContext): GameInstance {
  return new Nonogram(root, ctx);
}
