import { GameContext, GameInstance } from "../../core/types";
import { GameTimer } from "../../core/timer";
import { formatTime, recordLoss, recordStart, recordWin } from "../../core/stats";
import { load, remove, save } from "../../core/storage";
import { sfx } from "../../core/sound";
import { dailyRng, dayNumber, todayKey } from "../../core/rng";
import { markDailyDone } from "../../core/daily";

/** Randomness source; swapped for a seeded one when building the daily puzzle. */
let rand: () => number = Math.random;

const CLUES: Record<string, number> = { easy: 40, medium: 32, hard: 26 };
const row = (i: number) => Math.floor(i / 9);
const col = (i: number) => i % 9;
const box = (i: number) => Math.floor(row(i) / 3) * 3 + Math.floor(col(i) / 3);

/** Indices that share a row, column or box with each cell. */
const PEERS: number[][] = Array.from({ length: 81 }, (_, i) =>
  [...Array(81).keys()].filter((j) => j !== i && (row(j) === row(i) || col(j) === col(i) || box(j) === box(i))),
);

function randomOrder(): number[] {
  const a = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Count solutions up to `limit` with a most-constrained-cell backtracker. */
function countSolutions(grid: number[], limit: number, fill = false): number {
  let best = -1;
  let bestOpts: number[] = [];
  for (let i = 0; i < 81; i++) {
    if (grid[i]) continue;
    const used = new Set(PEERS[i].map((j) => grid[j]));
    const opts = (fill ? randomOrder() : [1, 2, 3, 4, 5, 6, 7, 8, 9]).filter((n) => !used.has(n));
    if (!opts.length) return 0;
    if (best < 0 || opts.length < bestOpts.length) {
      best = i;
      bestOpts = opts;
      if (opts.length === 1) break;
    }
  }
  if (best < 0) return 1;
  let total = 0;
  for (const n of bestOpts) {
    grid[best] = n;
    total += countSolutions(grid, limit - total, fill);
    if (total >= limit) {
      if (!fill) grid[best] = 0;
      return total;
    }
  }
  grid[best] = 0;
  return total;
}

function generate(clues: number, rng: () => number = Math.random): { puzzle: number[]; solution: number[] } {
  rand = rng;
  try {
    return build(clues);
  } finally {
    rand = Math.random;
  }
}

function build(clues: number): { puzzle: number[]; solution: number[] } {
  const solution = Array(81).fill(0);
  countSolutions(solution, 1, true);
  const puzzle = solution.slice();
  const order = [...Array(81).keys()];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  let filled = 81;
  for (const i of order) {
    if (filled <= clues) break;
    const keep = puzzle[i];
    puzzle[i] = 0;
    if (countSolutions(puzzle.slice(), 2) !== 1) puzzle[i] = keep;
    else filled--;
  }
  return { puzzle, solution };
}

interface State {
  given: boolean[];
  values: number[];
  notes: number[][];
  solution: number[];
  mistakes: number;
}

interface Saved extends State {
  level: string;
  seconds: number;
  counted: boolean;
}

class Sudoku implements GameInstance {
  private el: HTMLDivElement;
  private gridEl: HTMLDivElement;
  private padEl: HTMLDivElement;
  private cells: HTMLButtonElement[] = [];
  private s!: State;
  private history: { values: number[]; notes: number[][] }[] = [];
  private sel = 40;
  private notesMode = false;
  private level: string;
  private daily: boolean;
  private timer: GameTimer;
  private over = false;
  private counted = false;
  private resizeObs: ResizeObserver;

  constructor(root: HTMLElement, private ctx: GameContext) {
    this.daily = ctx.option("mode") === "daily";
    this.level = this.daily ? `daily-${todayKey()}` : ctx.option("level") in CLUES ? ctx.option("level") : "easy";
    this.el = document.createElement("div");
    this.el.className = "sudoku";
    this.el.innerHTML = `<div class="sdk-grid" role="grid" aria-label="Sudoku"></div><div class="sdk-pad"></div>`;
    root.appendChild(this.el);
    this.gridEl = this.el.querySelector(".sdk-grid")!;
    this.padEl = this.el.querySelector(".sdk-pad")!;
    for (let i = 0; i < 81; i++) {
      const b = document.createElement("button");
      b.className = "sdk-cell";
      b.dataset.i = String(i);
      if (col(i) % 3 === 2 && col(i) < 8) b.classList.add("edge-r");
      if (row(i) % 3 === 2 && row(i) < 8) b.classList.add("edge-b");
      this.gridEl.appendChild(b);
      this.cells.push(b);
    }
    this.padEl.innerHTML =
      [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button class="sdk-key" data-n="${n}">${n}<small></small></button>`).join("") +
      `<button class="sdk-key sdk-tool" data-tool="notes" aria-pressed="false">Notes</button>` +
      `<button class="sdk-key sdk-tool" data-tool="erase">Erase</button>`;
    this.gridEl.addEventListener("pointerdown", (e) => {
      const c = (e.target as HTMLElement).closest<HTMLElement>(".sdk-cell");
      if (c) this.select(Number(c.dataset.i));
    });
    this.padEl.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("button");
      if (!b) return;
      if (b.dataset.n) this.enter(Number(b.dataset.n));
      else if (b.dataset.tool === "erase") this.enter(0);
      else if (b.dataset.tool === "notes") this.toggleNotes();
    });
    window.addEventListener("keydown", this.onKey);
    this.timer = new GameTimer(() => this.status());
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(this.el);

    const saved = load<Saved | null>("save:sudoku", null);
    if (saved && saved.level === this.level) {
      const { level: _l, seconds, counted, ...state } = saved;
      this.s = state;
      this.counted = counted;
      this.timer.reset(seconds);
      this.paint();
      this.status();
    } else this.newGame();
  }

  private get key() {
    return this.daily ? "sudoku:daily" : `sudoku:${this.level}`;
  }

  newGame() {
    if (this.counted && !this.over) recordLoss(this.key);
    const { puzzle, solution } = this.daily ? generate(CLUES.medium, dailyRng("sudoku")) : generate(CLUES[this.level]);
    this.s = {
      given: puzzle.map((v) => v > 0),
      values: puzzle,
      notes: Array.from({ length: 81 }, () => []),
      solution,
      mistakes: 0,
    };
    this.history = [];
    this.over = false;
    this.counted = false;
    this.timer.reset();
    this.ctx.clearEnd();
    this.sel = this.s.values.findIndex((v) => !v);
    this.gridEl.classList.remove("solved");
    this.paint(true);
    this.persist();
    this.status();
  }

  undo() {
    const h = this.history.pop();
    if (!h || this.over) return;
    this.s.values = h.values;
    this.s.notes = h.notes;
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
    const wide = r.width > r.height * 1.25;
    this.el.classList.toggle("wide", wide);
    const size = wide ? Math.min(r.height - 48, r.width - 320) : Math.min(r.width - 40, r.height - 200);
    this.el.style.setProperty("--grid", `${Math.max(260, Math.min(size, 620))}px`);
  }

  private persist() {
    if (this.over) return remove("save:sudoku");
    const data: Saved = { ...this.s, level: this.level, seconds: this.timer.seconds, counted: this.counted };
    save("save:sudoku", data);
  }

  private select(i: number) {
    this.sel = i;
    this.paint();
  }

  private toggleNotes() {
    this.notesMode = !this.notesMode;
    this.padEl.querySelector('[data-tool="notes"]')!.setAttribute("aria-pressed", String(this.notesMode));
    this.el.classList.toggle("notes-on", this.notesMode);
  }

  private onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.closest?.("select, input") || e.ctrlKey || e.metaKey) return;
    const k = e.key;
    if (/^[1-9]$/.test(k)) this.enter(Number(k));
    else if (k === "Backspace" || k === "Delete" || k === "0") this.enter(0);
    else if (k === "n" || k === "N") this.toggleNotes();
    else if (k.startsWith("Arrow")) {
      const r = row(this.sel);
      const c = col(this.sel);
      const nr = (r + (k === "ArrowDown" ? 1 : k === "ArrowUp" ? -1 : 0) + 9) % 9;
      const nc = (c + (k === "ArrowRight" ? 1 : k === "ArrowLeft" ? -1 : 0) + 9) % 9;
      this.select(nr * 9 + nc);
    } else return;
    e.preventDefault();
  };

  private enter(n: number) {
    const i = this.sel;
    if (this.over || i < 0 || this.s.given[i]) return;
    const { values, notes } = this.s;
    if (n && this.notesMode && !values[i]) {
      this.push();
      notes[i] = notes[i].includes(n) ? notes[i].filter((x) => x !== n) : [...notes[i], n].sort();
      sfx.tick();
    } else {
      if (values[i] === n && !notes[i].length) return;
      this.push();
      values[i] = values[i] === n ? 0 : n;
      notes[i] = [];
      if (values[i]) {
        // Clear this digit from notes in the same row, column and box.
        for (const j of PEERS[i]) notes[j] = notes[j].filter((x) => x !== n);
        if (values[i] !== this.s.solution[i]) {
          this.s.mistakes += 1;
          sfx.error();
        } else sfx.place();
      }
    }
    if (!this.counted) {
      this.counted = true;
      recordStart(this.key);
    }
    this.timer.start();
    this.paint();
    this.status();
    this.checkWin();
    this.persist();
  }

  private push() {
    this.history.push({ values: this.s.values.slice(), notes: this.s.notes.map((n) => n.slice()) });
    if (this.history.length > 300) this.history.shift();
  }

  private checkWin() {
    if (!this.s.values.every((v, i) => v === this.s.solution[i])) return;
    this.over = true;
    this.timer.stop();
    const secs = Math.round(this.timer.seconds);
    const { newBestTime } = recordWin(this.key, secs);
    remove("save:sudoku");
    sfx.win();
    if (this.daily) markDailyDone("sudoku");
    this.gridEl.classList.add("solved");
    this.status();
    const m = this.s.mistakes;
    setTimeout(
      () =>
        this.ctx.end({
          won: true,
          title: this.daily ? `Daily #${dayNumber()} solved` : "Solved",
          lines: [`${formatTime(secs)}${newBestTime ? " — a new best" : ""}`, m ? `${m} mistake${m > 1 ? "s" : ""}` : "No mistakes"],
        }),
      900,
    );
  }

  private paint(fresh = false) {
    const { values, given, notes, solution } = this.s;
    const selVal = values[this.sel];
    const counts = Array(10).fill(0);
    values.forEach((v, i) => {
      if (v && v === solution[i]) counts[v]++;
    });
    values.forEach((v, i) => {
      const c = this.cells[i];
      const peer = this.sel >= 0 && (row(i) === row(this.sel) || col(i) === col(this.sel) || box(i) === box(this.sel));
      const conflict = v > 0 && PEERS[i].some((j) => values[j] === v);
      c.className = "sdk-cell";
      if (col(i) % 3 === 2 && col(i) < 8) c.classList.add("edge-r");
      if (row(i) % 3 === 2 && row(i) < 8) c.classList.add("edge-b");
      if (given[i]) c.classList.add("given");
      if (i === this.sel) c.classList.add("sel");
      else if (peer) c.classList.add("peer");
      if (v && v === selVal) c.classList.add("same");
      if (v && !given[i] && (v !== solution[i] || conflict)) c.classList.add("wrong");
      if (fresh && given[i]) {
        c.classList.add("intro");
        c.style.animationDelay = `${(row(i) + col(i)) * 14}ms`;
      }
      c.style.setProperty("--d", `${(row(i) + col(i)) * 30}ms`);
      if (v) c.textContent = String(v);
      else if (notes[i].length)
        c.innerHTML = `<span class="sdk-notes">${[1, 2, 3, 4, 5, 6, 7, 8, 9]
          .map((n) => `<i>${notes[i].includes(n) ? n : ""}</i>`)
          .join("")}</span>`;
      else c.textContent = "";
      c.setAttribute("aria-label", `Row ${row(i) + 1}, column ${col(i) + 1}${v ? `, ${v}` : ", empty"}`);
    });
    this.padEl.querySelectorAll<HTMLElement>("[data-n]").forEach((b) => {
      const n = Number(b.dataset.n);
      const left = 9 - counts[n];
      b.classList.toggle("done", left === 0);
      b.querySelector("small")!.textContent = left ? String(left) : "";
    });
    this.ctx.setUndo(this.history.length > 0 && !this.over);
  }

  private status() {
    this.ctx.setStatus([
      { label: "Mistakes", value: String(this.s?.mistakes ?? 0) },
      { label: "Time", value: formatTime(this.timer.seconds) },
    ]);
  }
}

export function create(root: HTMLElement, ctx: GameContext): GameInstance {
  return new Sudoku(root, ctx);
}
