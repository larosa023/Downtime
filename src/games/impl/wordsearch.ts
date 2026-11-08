import { GameContext, GameInstance } from "../../core/types";
import { GameTimer } from "../../core/timer";
import { formatTime, recordLoss, recordStart, recordWin } from "../../core/stats";
import { load, remove, save } from "../../core/storage";
import { sfx } from "../../core/sound";
import { getSettings } from "../../core/settings";
import words from "../words.json";

const SIZES: Record<string, { n: number; count: number }> = {
  small: { n: 10, count: 8 },
  medium: { n: 13, count: 12 },
  large: { n: 16, count: 16 },
  huge: { n: 20, count: 22 },
};
const DIRS = [
  [1, 0], [0, 1], [1, 1], [1, -1],
  [-1, 0], [0, -1], [-1, -1], [-1, 1],
];
// Letters weighted roughly by English frequency, for the filler.
const FILL = "eeeeeeeeeeeeaaaaaaaaarrrrrrriiiiiiiiooooooootttttttnnnnnnnsssssslllllcccccuuuuddddpppmmmhhhgggbbffyywkvxzjq";
const HUES = ["--accent", "--n2", "--n3", "--n4", "--n5", "--n6", "--danger", "--n1"];

interface Placed {
  word: string;
  r: number;
  c: number;
  dr: number;
  dc: number;
}

interface Saved {
  level: string;
  grid: string[];
  placed: Placed[];
  found: string[];
  seconds: number;
  counted: boolean;
}

function build(n: number, count: number, forwardOnly = false): { grid: string[]; placed: Placed[] } {
  const pool: string[] = words.search.filter((w: string) => w.length <= Math.min(8, n - 1));
  for (let attempt = 0; attempt < 50; attempt++) {
    const grid: string[] = Array(n * n).fill("");
    const placed: Placed[] = [];
    const used = new Set<string>();
    let tries = 0;
    while (placed.length < count && tries < 4000) {
      tries++;
      const w = pool[Math.floor(Math.random() * pool.length)];
      if (used.has(w) || [...used].some((u) => u.includes(w) || w.includes(u))) continue;
      // Favor forward directions a bit, so small grids aren't all backwards words.
      // Easy grids only run left to right, top to bottom, or diagonally down.
      const d = forwardOnly ? DIRS[[0, 1, 2][Math.floor(Math.random() * 3)]] : DIRS[Math.random() < 0.6 ? Math.floor(Math.random() * 4) : Math.floor(Math.random() * 8)];
      const [dc, dr] = d;
      const r = Math.floor(Math.random() * n);
      const c = Math.floor(Math.random() * n);
      const er = r + dr * (w.length - 1);
      const ec = c + dc * (w.length - 1);
      if (er < 0 || er >= n || ec < 0 || ec >= n) continue;
      let ok = true;
      for (let k = 0; k < w.length; k++) {
        const ch = grid[(r + dr * k) * n + c + dc * k];
        if (ch && ch !== w[k]) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      for (let k = 0; k < w.length; k++) grid[(r + dr * k) * n + c + dc * k] = w[k];
      placed.push({ word: w, r, c, dr, dc });
      used.add(w);
    }
    if (placed.length === count) {
      for (let i = 0; i < grid.length; i++) if (!grid[i]) grid[i] = FILL[Math.floor(Math.random() * FILL.length)];
      placed.sort((a, b) => a.word.localeCompare(b.word));
      return { grid, placed };
    }
  }
  throw new Error("couldn't build word search");
}

class WordSearch implements GameInstance {
  private el: HTMLDivElement;
  private gridEl!: HTMLDivElement;
  private svg!: SVGSVGElement;
  private listEl!: HTMLUListElement;
  private level: string;
  private n: number;
  private grid: string[] = [];
  private placed: Placed[] = [];
  private found = new Set<string>();
  private drag: { r: number; c: number; er: number; ec: number } | null = null;
  private timer: GameTimer;
  private over = false;
  private counted = false;
  private resizeObs: ResizeObserver;
  private paused = false;
  private hintsUsed = 0;

  constructor(root: HTMLElement, private ctx: GameContext) {
    this.level = ctx.option("size") in SIZES ? ctx.option("size") : "medium";
    this.n = SIZES[this.level].n;
    this.el = document.createElement("div");
    this.el.className = "wordsearch";
    root.appendChild(this.el);
    this.timer = new GameTimer(() => this.status());
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(this.el);
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);

    const saved = load<Saved | null>("save:wordsearch", null);
    if (saved && saved.level === this.level && saved.grid.length === this.n * this.n) {
      this.grid = saved.grid;
      this.placed = saved.placed;
      this.found = new Set(saved.found);
      this.counted = saved.counted;
      this.timer.reset(saved.seconds);
      this.render();
      this.status();
    } else this.newGame();
  }

  private get key() {
    return `wordsearch:${this.level}`;
  }

  newGame() {
    if (this.counted && !this.over) recordLoss(this.key);
    const { grid, placed } = build(this.n, SIZES[this.level].count, this.ctx.option("dirs") === "forward");
    this.hintsUsed = 0;
    this.grid = grid;
    this.placed = placed;
    this.found = new Set();
    this.over = false;
    this.counted = false;
    this.timer.reset();
    this.ctx.clearEnd();
    this.ctx.setUndo(false);
    this.render();
    this.persist();
    this.status();
  }

  inProgress() {
    return this.counted && !this.over;
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    if (paused && this.drag) {
      this.drag = null;
      this.paint();
    }
  }

  /** Flash the first letter of a word that hasn't been found. */
  requestHint() {
    if (this.over || this.paused || !getSettings().hints) return;
    const left = this.placed.filter((p) => !this.found.has(p.word));
    if (!left.length) return;
    const p = left[Math.floor(Math.random() * left.length)];
    const cell = this.gridEl.querySelector<HTMLElement>(`[data-i="${p.r * this.n + p.c}"]`);
    if (!cell) return;
    cell.classList.remove("hint");
    void cell.offsetWidth;
    cell.classList.add("hint");
    this.hintsUsed++;
    this.ctx.toast(`${p.word.toUpperCase()} starts here.`);
  }

  destroy() {
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    this.persist();
    this.timer.destroy();
    this.resizeObs.disconnect();
    this.el.remove();
  }

  resize() {
    const r = this.el.getBoundingClientRect();
    const wide = r.width > r.height * 1.15;
    this.el.classList.toggle("wide", wide);
    const room = wide ? Math.min(r.height - 48, r.width - 300) : Math.min(r.width - 40, r.height - 200);
    const cell = Math.floor(Math.max(200, room) / this.n);
    this.el.style.setProperty("--ws", `${Math.max(20, Math.min(cell, 54))}px`);
  }

  private persist() {
    if (this.over) return remove("save:wordsearch");
    const data: Saved = {
      level: this.level,
      grid: this.grid,
      placed: this.placed,
      found: [...this.found],
      seconds: this.timer.seconds,
      counted: this.counted,
    };
    save("save:wordsearch", data);
  }

  private render() {
    const n = this.n;
    this.el.innerHTML = `
      <div class="ws-board" style="--n:${n}">
        <svg class="ws-marks" viewBox="0 0 ${n} ${n}" preserveAspectRatio="none" aria-hidden="true"></svg>
        <div class="ws-grid" role="grid" aria-label="Letter grid">${this.grid
          .map((ch, i) => `<span class="ws-cell" data-i="${i}">${ch}</span>`)
          .join("")}</div>
      </div>
      <div class="ws-side">
        <p class="ws-count"></p>
        <ul class="ws-list">${this.placed.map((p) => `<li data-w="${p.word}">${p.word}</li>`).join("")}</ul>
      </div>`;
    this.gridEl = this.el.querySelector(".ws-grid")!;
    this.svg = this.el.querySelector(".ws-marks")!;
    this.listEl = this.el.querySelector(".ws-list")!;
    this.gridEl.addEventListener("pointerdown", this.onDown);
    this.resize();
    this.paint();
  }

  private hue(word: string) {
    const i = this.placed.findIndex((p) => p.word === word);
    return HUES[i % HUES.length];
  }

  private line(r: number, c: number, er: number, ec: number, color: string, cls: string) {
    return `<line class="${cls}" x1="${c + 0.5}" y1="${r + 0.5}" x2="${ec + 0.5}" y2="${er + 0.5}" style="stroke: color-mix(in oklab, var(${color}) 42%, transparent)"/>`;
  }

  private paint() {
    let marks = "";
    for (const p of this.placed) {
      if (!this.found.has(p.word)) continue;
      const L = p.word.length - 1;
      marks += this.line(p.r, p.c, p.r + p.dr * L, p.c + p.dc * L, this.hue(p.word), "ws-found");
    }
    if (this.drag) marks += this.line(this.drag.r, this.drag.c, this.drag.er, this.drag.ec, "--accent", "ws-live");
    this.svg.innerHTML = marks;
    this.listEl.querySelectorAll<HTMLElement>("li").forEach((li) => {
      const f = this.found.has(li.dataset.w!);
      li.classList.toggle("found", f);
      li.style.setProperty("--hue", `var(${this.hue(li.dataset.w!)})`);
    });
    const left = this.placed.length - this.found.size;
    this.el.querySelector(".ws-count")!.textContent = left ? `${left} of ${this.placed.length} words left` : "All words found";
  }

  private cellFrom(e: PointerEvent): { r: number; c: number } {
    const rect = this.gridEl.getBoundingClientRect();
    const s = rect.width / this.n;
    return {
      r: Math.floor((e.clientY - rect.top) / s),
      c: Math.floor((e.clientX - rect.left) / s),
    };
  }

  private onDown = (e: PointerEvent) => {
    if (this.over || this.paused || e.button !== 0) return;
    const { r, c } = this.cellFrom(e);
    if (r < 0 || c < 0 || r >= this.n || c >= this.n) return;
    e.preventDefault();
    this.drag = { r, c, er: r, ec: c };
    if (!this.counted) {
      this.counted = true;
      recordStart(this.key);
    }
    this.timer.start();
    this.paint();
  };

  /** Snap the drag to the nearest of eight directions, staying inside the grid. */
  private onMove = (e: PointerEvent) => {
    const d = this.drag;
    if (!d) return;
    const rect = this.gridEl.getBoundingClientRect();
    const s = rect.width / this.n;
    const x = (e.clientX - rect.left) / s - (d.c + 0.5);
    const y = (e.clientY - rect.top) / s - (d.r + 0.5);
    const dist = Math.hypot(x, y);
    const was = d.er * 1000 + d.ec;
    if (dist < 0.5) {
      d.er = d.r;
      d.ec = d.c;
    } else {
      const a = Math.round(Math.atan2(y, x) / (Math.PI / 4));
      const dc = Math.round(Math.cos((a * Math.PI) / 4));
      const dr = Math.round(Math.sin((a * Math.PI) / 4));
      let len = Math.round(dc && dr ? Math.max(Math.abs(x), Math.abs(y)) : dist);
      while (len > 0) {
        const er = d.r + dr * len;
        const ec = d.c + dc * len;
        if (er >= 0 && er < this.n && ec >= 0 && ec < this.n) break;
        len--;
      }
      d.er = d.r + dr * len;
      d.ec = d.c + dc * len;
    }
    // Only redraw when the selection actually changes.
    if (d.er * 1000 + d.ec !== was) this.paint();
  };

  private onUp = () => {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    const len = Math.max(Math.abs(d.er - d.r), Math.abs(d.ec - d.c));
    const dr = Math.sign(d.er - d.r);
    const dc = Math.sign(d.ec - d.c);
    let text = "";
    for (let k = 0; k <= len; k++) text += this.grid[(d.r + dr * k) * this.n + d.c + dc * k];
    const back = [...text].reverse().join("");
    const hit = this.placed.find((p) => !this.found.has(p.word) && (p.word === text || p.word === back));
    if (hit && len > 0) {
      this.found.add(hit.word);
      sfx.merge();
      this.paint();
      const li = this.listEl.querySelector<HTMLElement>(`[data-w="${hit.word}"]`);
      li?.classList.add("just");
      this.status();
      if (this.found.size === this.placed.length) this.win();
      else this.persist();
    } else {
      if (len > 0) sfx.error();
      this.paint();
    }
  };

  private win() {
    this.over = true;
    this.timer.stop();
    const secs = Math.round(this.timer.seconds);
    const { newBestTime } = recordWin(this.key, secs);
    remove("save:wordsearch");
    sfx.win();
    this.status();
    setTimeout(
      () =>
        this.ctx.end({
          won: true,
          title: "All found",
          lines: [
            `${formatTime(secs)}${newBestTime ? " — a new best" : ""}`,
            `${this.placed.length} words in a ${this.n}×${this.n} grid${this.hintsUsed ? `, ${this.hintsUsed} hint${this.hintsUsed > 1 ? "s" : ""}` : ""}`,
          ],
        }),
      600,
    );
  }

  private status() {
    this.ctx.setStatus([
      { label: "Found", value: `${this.found.size}/${this.placed.length}` },
      { label: "Time", value: formatTime(this.timer.seconds) },
    ]);
  }
}

export function create(root: HTMLElement, ctx: GameContext): GameInstance {
  return new WordSearch(root, ctx);
}
