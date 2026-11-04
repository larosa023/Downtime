import "./reversi.css";
import { GameContext, GameInstance, GameModule } from "../core/types";
import { getStats, recordLoss, recordStart, recordWin } from "../core/stats";
import { sfx } from "../core/sound";
import { motionEnabled } from "../core/settings";

// 0 empty, 1 you (dark, moves first), 2 computer (light).
type Side = 1 | 2;
const DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const opp = (s: Side): Side => (s === 1 ? 2 : 1);

export function flipsFor(b: number[], sq: number, side: Side): number[] {
  if (b[sq]) return [];
  const out: number[] = [];
  const r = sq >> 3;
  const c = sq & 7;
  const them = opp(side);
  for (const [dr, dc] of DIRS) {
    const line: number[] = [];
    let rr = r + dr;
    let cc = c + dc;
    while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && b[rr * 8 + cc] === them) {
      line.push(rr * 8 + cc);
      rr += dr;
      cc += dc;
    }
    if (line.length && rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && b[rr * 8 + cc] === side) out.push(...line);
  }
  return out;
}

export function movesFor(b: number[], side: Side): number[] {
  const out: number[] = [];
  for (let sq = 0; sq < 64; sq++) if (!b[sq] && flipsFor(b, sq, side).length) out.push(sq);
  return out;
}

// Corners are gold, the squares next to them are traps.
const W = [
  120, -25, 20, 6, 6, 20, -25, 120,
  -25, -45, -4, -4, -4, -4, -45, -25,
  20, -4, 3, 2, 2, 3, -4, 20,
  6, -4, 2, 1, 1, 2, -4, 6,
  6, -4, 2, 1, 1, 2, -4, 6,
  20, -4, 3, 2, 2, 3, -4, 20,
  -25, -45, -4, -4, -4, -4, -45, -25,
  120, -25, 20, 6, 6, 20, -25, 120,
];
const CORNERS = [0, 7, 56, 63];
const NEAR: Record<number, number[]> = { 0: [1, 8, 9], 7: [6, 14, 15], 56: [48, 49, 57], 63: [54, 55, 62] };

function evaluate(b: number[], side: Side): number {
  const them = opp(side);
  let empties = 0;
  let pos = 0;
  let discs = 0;
  for (let sq = 0; sq < 64; sq++) {
    const v = b[sq];
    if (!v) {
      empties++;
      continue;
    }
    let w = W[sq];
    // Once a corner is taken, its neighbors stop being dangerous.
    for (const k of CORNERS) if (b[k] && NEAR[k].includes(sq)) w = 8;
    pos += v === side ? w : -w;
    discs += v === side ? 1 : -1;
  }
  const mob = movesFor(b, side).length - movesFor(b, them).length;
  if (empties <= 10) return discs * 12 + pos + mob * 4;
  return pos + mob * 9 + (empties < 20 ? discs * 2 : 0);
}

const WIN = 100000;

function search(b: number[], side: Side, depth: number, alpha: number, beta: number, passed: boolean, deadline: number, st: { stop: boolean; n: number }): number {
  if ((++st.n & 255) === 0 && performance.now() > deadline) st.stop = true;
  if (st.stop) return 0;
  const moves = movesFor(b, side);
  if (!moves.length) {
    if (passed) {
      let d = 0;
      for (const v of b) if (v) d += v === side ? 1 : -1;
      return d > 0 ? WIN + d : d < 0 ? -WIN + d : 0;
    }
    return -search(b, opp(side), depth, -beta, -alpha, true, deadline, st);
  }
  if (depth <= 0) return evaluate(b, side);
  moves.sort((x, y) => W[y] - W[x]);
  for (const m of moves) {
    const f = flipsFor(b, m, side);
    b[m] = side;
    for (const x of f) b[x] = side;
    const v = -search(b, opp(side), depth - 1, -beta, -alpha, false, deadline, st);
    b[m] = 0;
    for (const x of f) b[x] = opp(side);
    if (st.stop) return 0;
    if (v >= beta) return beta;
    if (v > alpha) alpha = v;
  }
  return alpha;
}

const LEVELS: Record<string, { depth: number; ms: number; noise: number }> = {
  easy: { depth: 1, ms: 150, noise: 90 },
  normal: { depth: 4, ms: 450, noise: 10 },
  hard: { depth: 12, ms: 900, noise: 0 },
};

export function bestMove(board: number[], level: string): number {
  const l = LEVELS[level] ?? LEVELS.normal;
  const b = board.slice();
  let moves = movesFor(b, 2);
  if (!moves.length) return -1;
  if (moves.length === 1) return moves[0];
  const deadline = performance.now() + l.ms;
  const st = { stop: false, n: 0 };
  let best = moves[0];
  let scores = new Map<number, number>();
  for (let d = 1; d <= l.depth; d++) {
    const sc = new Map<number, number>();
    let alpha = -Infinity;
    let dBest = moves[0];
    for (const m of moves) {
      const f = flipsFor(b, m, 2);
      b[m] = 2;
      for (const x of f) b[x] = 2;
      const v = -search(b, 1, d - 1, -WIN * 2, l.noise ? WIN * 2 : -alpha, false, deadline, st);
      b[m] = 0;
      for (const x of f) b[x] = 1;
      if (st.stop) break;
      sc.set(m, v);
      if (v > alpha) {
        alpha = v;
        dBest = m;
      }
    }
    if (st.stop) break;
    best = dBest;
    scores = sc;
    moves = [...moves].sort((x, y) => (sc.get(y) ?? -1e9) - (sc.get(x) ?? -1e9));
  }
  if (l.noise && scores.size) {
    let top = -Infinity;
    for (const [m, v] of scores) {
      const nv = v + (Math.random() - 0.5) * l.noise;
      if (nv > top) {
        top = nv;
        best = m;
      }
    }
  }
  return best;
}

interface Snapshot {
  board: number[];
  last: number;
  moves: number;
}

class Reversi implements GameInstance {
  private el: HTMLDivElement;
  private cells: HTMLButtonElement[] = [];
  private board: number[] = [];
  private turn: Side = 1;
  private last = -1;
  private moves = 0;
  private history: Snapshot[] = [];
  private over = false;
  private counted = false;
  private thinking = false;
  private aiTimer = 0;
  private endTimer = 0;
  private level: string;
  private resizeObs: ResizeObserver;

  constructor(root: HTMLElement, private ctx: GameContext) {
    this.level = ctx.option("level") in LEVELS ? ctx.option("level") : "normal";
    this.el = document.createElement("div");
    this.el.className = "reversi";
    const grid = document.createElement("div");
    grid.className = "rv-board";
    for (let sq = 0; sq < 64; sq++) {
      const b = document.createElement("button");
      b.className = "rv-cell";
      b.dataset.sq = String(sq);
      b.innerHTML = `<span class="rv-disc"><i class="rv-a"></i><i class="rv-b"></i></span>`;
      grid.appendChild(b);
      this.cells.push(b);
    }
    this.el.appendChild(grid);
    root.appendChild(this.el);
    grid.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>(".rv-cell");
      if (b) this.play(Number(b.dataset.sq));
    });
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(this.el);
    this.newGame();
  }

  private get key() {
    return `reversi:${this.level}`;
  }

  newGame() {
    clearTimeout(this.aiTimer);
    clearTimeout(this.endTimer);
    if (this.counted && !this.over) recordLoss(this.key);
    this.board = Array(64).fill(0);
    this.board[27] = 2;
    this.board[28] = 1;
    this.board[35] = 1;
    this.board[36] = 2;
    this.turn = 1;
    this.last = -1;
    this.moves = 0;
    this.history = [];
    this.over = false;
    this.counted = false;
    this.thinking = false;
    this.ctx.clearEnd();
    this.cells.forEach((c) => c.classList.remove("filled", "light", "flip", "placed"));
    this.render(new Set());
    this.status();
  }

  undo() {
    const s = this.history.pop();
    if (!s) return;
    clearTimeout(this.aiTimer);
    clearTimeout(this.endTimer);
    this.thinking = false;
    this.board = s.board;
    this.last = s.last;
    this.moves = s.moves;
    this.turn = 1;
    if (this.over) {
      this.over = false;
      this.ctx.clearEnd();
    }
    sfx.flip();
    this.render(new Set());
    this.status();
  }

  destroy() {
    clearTimeout(this.aiTimer);
    clearTimeout(this.endTimer);
    this.resizeObs.disconnect();
    this.el.remove();
  }

  resize() {
    const r = this.el.getBoundingClientRect();
    const size = Math.floor(Math.min(r.width - 48, r.height - 48) / 8) * 8;
    this.el.style.setProperty("--bs", `${Math.max(240, Math.min(size, 680))}px`);
  }

  private play(sq: number) {
    if (this.over || this.thinking || this.turn !== 1) return;
    const f = flipsFor(this.board, sq, 1);
    if (!f.length) {
      if (!this.board[sq]) sfx.error();
      return;
    }
    this.history.push({ board: this.board.slice(), last: this.last, moves: this.moves });
    if (this.history.length > 120) this.history.shift();
    if (!this.counted) {
      this.counted = true;
      recordStart(this.key);
    }
    this.place(sq, 1, f);
    this.advance();
  }

  private place(sq: number, side: Side, flips: number[]) {
    this.board[sq] = side;
    for (const x of flips) this.board[x] = side;
    this.last = sq;
    this.moves++;
    sfx.place();
    if (flips.length >= 4) setTimeout(() => sfx.flip(), 120);
    this.render(new Set(flips), sq);
  }

  /** Decide whose turn is next, handling passes and the end of the game. */
  private advance() {
    const next = opp(this.turn);
    if (movesFor(this.board, next).length) this.turn = next;
    else if (!movesFor(this.board, this.turn).length) return this.finish();
    else if (next === 2) this.ctx.toast("The computer has no moves and passes. Your turn again.");
    else this.ctx.toast("You have no moves, so you pass.");
    this.status();
    this.render(new Set());
    if (this.turn === 2) {
      this.thinking = true;
      this.status();
      this.aiTimer = window.setTimeout(() => this.aiMove(), motionEnabled() ? 520 : 80);
    }
  }

  private aiMove() {
    if (this.over) return;
    const m = bestMove(this.board, this.level);
    this.thinking = false;
    if (m < 0) return this.advance();
    this.place(m, 2, flipsFor(this.board, m, 2));
    this.advance();
  }

  private count(side: Side) {
    return this.board.filter((v) => v === side).length;
  }

  private finish() {
    this.over = true;
    this.thinking = false;
    const you = this.count(1);
    const cpu = this.count(2);
    if (you > cpu) {
      recordWin(this.key);
      sfx.win();
    } else if (cpu > you) {
      recordLoss(this.key);
      sfx.lose();
    }
    this.status();
    this.render(new Set());
    const s = getStats(this.key);
    this.endTimer = window.setTimeout(
      () =>
        this.ctx.end({
          won: you > cpu,
          title: you > cpu ? "You win" : cpu > you ? "The computer wins" : "It's a draw",
          lines: [`${you} to ${cpu}`, `${s.won} won of ${s.played} played on ${this.level}`],
        }),
      900,
    );
  }

  private render(flipped: Set<number>, placed = -1) {
    const legal = new Set(this.turn === 1 && !this.over && !this.thinking ? movesFor(this.board, 1) : []);
    const animate = motionEnabled();
    const lr = placed >= 0 ? placed >> 3 : 0;
    const lc = placed >= 0 ? placed & 7 : 0;
    this.board.forEach((v, sq) => {
      const c = this.cells[sq];
      c.classList.toggle("filled", v !== 0);
      c.classList.toggle("light", v === 2);
      c.classList.toggle("legal", legal.has(sq));
      c.classList.toggle("last", sq === this.last);
      c.disabled = false;
      c.setAttribute("aria-label", `${"abcdefgh"[sq & 7]}${8 - (sq >> 3)}: ${v === 1 ? "yours" : v === 2 ? "computer" : legal.has(sq) ? "empty, you can play here" : "empty"}`);
      if (flipped.has(sq) && animate) {
        const disc = c.querySelector<HTMLElement>(".rv-disc")!;
        // Flips ripple out from the new disc.
        disc.style.transitionDelay = `${Math.max(Math.abs((sq >> 3) - lr), Math.abs((sq & 7) - lc)) * 60}ms`;
      } else {
        c.querySelector<HTMLElement>(".rv-disc")!.style.transitionDelay = "0ms";
      }
      if (sq === placed) {
        // A new disc appears already showing its color instead of flipping in.
        const disc = c.querySelector<HTMLElement>(".rv-disc")!;
        disc.style.transition = "none";
        requestAnimationFrame(() => requestAnimationFrame(() => (disc.style.transition = "")));
      }
      if (sq === placed && animate) {
        c.classList.remove("placed");
        void c.offsetWidth;
        c.classList.add("placed");
      }
    });
    this.ctx.setUndo(this.history.length > 0);
  }

  private status() {
    this.ctx.setStatus([
      { label: "Turn", value: this.over ? "—" : this.turn === 1 && !this.thinking ? "You" : "Computer" },
      { label: "You", value: String(this.count(1)) },
      { label: "Computer", value: String(this.count(2)) },
    ]);
  }
}

export const reversi: GameModule = {
  id: "reversi",
  name: "Reversi",
  group: "board",
  blurb: "Trap the computer's discs between yours to flip them. Most discs wins.",
  art: "reversi",
  hasUndo: true,
  options: [
    {
      key: "level",
      label: "Opponent",
      default: "normal",
      choices: [
        { value: "easy", label: "Easy" },
        { value: "normal", label: "Normal" },
        { value: "hard", label: "Hard" },
      ],
    },
  ],
  statsKey: (o) => `reversi:${o("level")}`,
  iconSvg: `<rect x="3.5" y="3.5" width="17" height="17" rx="2.5"/><circle cx="9.5" cy="9.5" r="2.6" fill="currentColor"/><circle cx="14.5" cy="14.5" r="2.6" fill="currentColor"/><circle cx="14.5" cy="9.5" r="2.6"/><circle cx="9.5" cy="14.5" r="2.6"/>`,
  artSvg: (() => {
    let s = `<rect x="70" y="10" width="112" height="112" rx="8" class="rv-art-board"/>`;
    for (let i = 1; i < 8; i++)
      s += `<path class="rv-art-line" d="M${70 + i * 14} 10v112M70 ${10 + i * 14}h112"/>`;
    const disc = (r: number, c: number, dark: boolean) => `<circle cx="${77 + c * 14}" cy="${17 + r * 14}" r="5.4" class="${dark ? "rv-art-dark" : "rv-art-light"}"/>`;
    const dark = [[2, 3], [3, 3], [3, 4], [4, 4], [4, 2], [5, 5], [2, 5]];
    const light = [[3, 2], [4, 3], [2, 4], [5, 4], [4, 5], [1, 4]];
    for (const [r, c] of dark) s += disc(r, c, true);
    for (const [r, c] of light) s += disc(r, c, false);
    return s;
  })(),
  create: (root, ctx) => new Reversi(root, ctx),
};
