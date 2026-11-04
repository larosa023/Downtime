import "./checkers.css";
import { GameContext, GameInstance, GameModule } from "../core/types";
import { getStats, recordLoss, recordStart, recordWin } from "../core/stats";
import { sfx } from "../core/sound";
import { motionEnabled } from "../core/settings";

// Board cells: 0 empty, 1 your man, 2 your king, 3 computer man, 4 computer king.
// You start at the bottom and move up. Squares are r * 8 + c; dark squares have (r + c) odd.

type Side = 1 | 2;
export interface CMove {
  path: number[];
  caps: number[];
}

const owner = (v: number): 0 | Side => (v === 0 ? 0 : v <= 2 ? 1 : 2);
const isKing = (v: number) => v === 2 || v === 4;
const opp = (s: Side): Side => (s === 1 ? 2 : 1);

function dirsFor(v: number): number[][] {
  if (isKing(v)) return [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  return owner(v) === 1 ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]];
}

const lastRow = (s: Side) => (s === 1 ? 0 : 7);

export function genMoves(b: number[], side: Side): CMove[] {
  const jumps: CMove[] = [];
  const steps: CMove[] = [];
  for (let sq = 0; sq < 64; sq++) {
    const v = b[sq];
    if (owner(v) !== side) continue;
    // Jumps: follow every chain to its end. A man that reaches the far row is crowned and stops.
    const start = sq;
    b[start] = 0;
    const dfs = (at: number, piece: number, path: number[], caps: number[]) => {
      const r = at >> 3;
      const c = at & 7;
      let found = false;
      for (const [dr, dc] of dirsFor(piece)) {
        const mr = r + dr;
        const mc = c + dc;
        const lr = r + 2 * dr;
        const lc = c + 2 * dc;
        if (lr < 0 || lr > 7 || lc < 0 || lc > 7) continue;
        const mid = mr * 8 + mc;
        const land = lr * 8 + lc;
        if (owner(b[mid]) !== opp(side) || caps.includes(mid) || b[land] !== 0) continue;
        found = true;
        const crowned = !isKing(piece) && lr === lastRow(side);
        if (crowned) jumps.push({ path: [...path, land], caps: [...caps, mid] });
        else dfs(land, piece, [...path, land], [...caps, mid]);
      }
      if (!found && caps.length) jumps.push({ path, caps });
    };
    dfs(start, v, [start], []);
    b[start] = v;
    if (jumps.length) continue;
    const r = sq >> 3;
    const c = sq & 7;
    for (const [dr, dc] of dirsFor(v)) {
      const rr = r + dr;
      const cc = c + dc;
      if (rr < 0 || rr > 7 || cc < 0 || cc > 7) continue;
      if (b[rr * 8 + cc] === 0) steps.push({ path: [sq, rr * 8 + cc], caps: [] });
    }
  }
  return jumps.length ? jumps : steps;
}

/** Applies a move; returns what's needed to undo it. */
function applyMove(b: number[], m: CMove): { piece: number; capVals: number[] } {
  const from = m.path[0];
  const to = m.path[m.path.length - 1];
  const piece = b[from];
  const capVals = m.caps.map((c) => b[c]);
  b[from] = 0;
  for (const c of m.caps) b[c] = 0;
  const side = owner(piece) as Side;
  b[to] = !isKing(piece) && to >> 3 === lastRow(side) ? piece + 1 : piece;
  return { piece, capVals };
}

function undoMove(b: number[], m: CMove, u: { piece: number; capVals: number[] }) {
  b[m.path[m.path.length - 1]] = 0;
  m.caps.forEach((c, i) => (b[c] = u.capVals[i]));
  b[m.path[0]] = u.piece;
}

/** Score from `side`'s point of view. */
function evaluate(b: number[], side: Side): number {
  let s = 0;
  for (let sq = 0; sq < 64; sq++) {
    const v = b[sq];
    if (!v) continue;
    const r = sq >> 3;
    const c = sq & 7;
    let val = isKing(v) ? 175 : 100;
    if (!isKing(v)) {
      const adv = owner(v) === 1 ? 7 - r : r;
      val += adv * 4;
      if ((owner(v) === 1 && r === 7) || (owner(v) === 2 && r === 0)) val += 8; // back-row guard
    }
    if (c >= 2 && c <= 5 && r >= 2 && r <= 5) val += 6;
    s += owner(v) === side ? val : -val;
  }
  return s;
}

const WIN = 100000;

function search(b: number[], side: Side, depth: number, alpha: number, beta: number, ply: number, deadline: number, st: { stop: boolean; n: number }): number {
  if ((++st.n & 511) === 0 && performance.now() > deadline) st.stop = true;
  if (st.stop) return 0;
  const moves = genMoves(b, side);
  if (!moves.length) return -WIN + ply;
  if (depth <= 0 && !moves[0].caps.length) return evaluate(b, side);
  if (depth <= -6) return evaluate(b, side);
  moves.sort((x, y) => y.caps.length - x.caps.length);
  for (const m of moves) {
    const u = applyMove(b, m);
    const v = -search(b, opp(side), depth - 1, -beta, -alpha, ply + 1, deadline, st);
    undoMove(b, m, u);
    if (st.stop) return 0;
    if (v >= beta) return beta;
    if (v > alpha) alpha = v;
  }
  return alpha;
}

const LEVELS: Record<string, { depth: number; ms: number; noise: number }> = {
  easy: { depth: 2, ms: 250, noise: 120 },
  normal: { depth: 6, ms: 500, noise: 20 },
  hard: { depth: 14, ms: 900, noise: 0 },
};

export function bestMove(board: number[], level: string): CMove | null {
  const l = LEVELS[level] ?? LEVELS.normal;
  const b = board.slice();
  let moves = genMoves(b, 2);
  if (!moves.length) return null;
  if (moves.length === 1) return moves[0];
  const deadline = performance.now() + l.ms;
  const st = { stop: false, n: 0 };
  let best = moves[0];
  let scores = new Map<CMove, number>();
  for (let d = 1; d <= l.depth; d++) {
    const sc = new Map<CMove, number>();
    let alpha = -Infinity;
    let dBest = moves[0];
    for (const m of moves) {
      const u = applyMove(b, m);
      const v = -search(b, 1, d - 1, -WIN * 2, l.noise ? WIN * 2 : -alpha, 1, deadline, st);
      undoMove(b, m, u);
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
    if (Math.abs(alpha) > WIN / 2) break;
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

function startBoard(): number[] {
  const b = Array(64).fill(0);
  for (let sq = 0; sq < 64; sq++) {
    const r = sq >> 3;
    const c = sq & 7;
    if ((r + c) % 2 === 0) continue;
    if (r <= 2) b[sq] = 3;
    else if (r >= 5) b[sq] = 1;
  }
  return b;
}

const NO_PROGRESS_LIMIT = 80; // plies without a capture or a man moving

interface Snapshot {
  board: number[];
  ids: number[];
  last: number[] | null;
  quiet: number;
  plies: number;
}

class Checkers implements GameInstance {
  private el: HTMLDivElement;
  private boardEl!: HTMLDivElement;
  private squares: HTMLDivElement[] = [];
  private layer!: HTMLDivElement;
  private pieceEls = new Map<number, HTMLDivElement>();
  private board: number[] = [];
  private ids: number[] = [];
  private nextId = 1;
  private last: number[] | null = null;
  private quiet = 0;
  private plies = 0;
  private history: Snapshot[] = [];
  private prefix: number[] = []; // squares clicked so far for your move
  private turn: Side = 1;
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
    this.el.className = "checkers";
    this.el.innerHTML = `<div class="ck-board"><div class="ck-squares"></div><div class="ck-layer"></div></div>`;
    root.appendChild(this.el);
    this.boardEl = this.el.querySelector(".ck-board")!;
    this.layer = this.el.querySelector(".ck-layer")!;
    const wrap = this.el.querySelector(".ck-squares")!;
    for (let sq = 0; sq < 64; sq++) {
      const d = document.createElement("div");
      d.className = `ck-sq ${((sq >> 3) + (sq & 7)) % 2 ? "dark" : "light"}`;
      wrap.appendChild(d);
      this.squares.push(d);
    }
    this.boardEl.addEventListener("pointerdown", this.onDown);
    window.addEventListener("keydown", this.onKey);
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(this.el);
    this.newGame();
  }

  private get key() {
    return `checkers:${this.level}`;
  }

  newGame() {
    clearTimeout(this.aiTimer);
    clearTimeout(this.endTimer);
    if (this.counted && !this.over) recordLoss(this.key);
    this.board = startBoard();
    this.ids = this.board.map((v) => (v ? this.nextId++ : 0));
    this.last = null;
    this.quiet = 0;
    this.plies = 0;
    this.history = [];
    this.prefix = [];
    this.turn = 1;
    this.over = false;
    this.counted = false;
    this.thinking = false;
    this.layer.innerHTML = "";
    this.pieceEls.clear();
    this.ctx.clearEnd();
    this.render(true);
    this.status();
  }

  undo() {
    const s = this.history.pop();
    if (!s) return;
    clearTimeout(this.aiTimer);
    clearTimeout(this.endTimer);
    this.thinking = false;
    this.board = s.board;
    this.ids = s.ids;
    this.last = s.last;
    this.quiet = s.quiet;
    this.plies = s.plies;
    this.turn = 1;
    this.prefix = [];
    if (this.over) {
      this.over = false;
      this.ctx.clearEnd();
    }
    sfx.flip();
    this.render();
    this.status();
  }

  destroy() {
    clearTimeout(this.aiTimer);
    clearTimeout(this.endTimer);
    window.removeEventListener("keydown", this.onKey);
    this.resizeObs.disconnect();
    this.el.remove();
  }

  resize() {
    const r = this.el.getBoundingClientRect();
    const size = Math.floor(Math.min(r.width - 48, r.height - 48) / 8) * 8;
    this.el.style.setProperty("--bs", `${Math.max(240, Math.min(size, 720))}px`);
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && this.prefix.length) {
      this.prefix = [];
      this.render();
    }
  };

  private legalNow(): CMove[] {
    return genMoves(this.board, 1);
  }

  /** Moves still possible given the squares clicked so far. */
  private matching(): CMove[] {
    const p = this.prefix;
    return this.legalNow().filter((m) => p.every((sq, i) => m.path[i] === sq));
  }

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0 || this.over || this.thinking || this.turn !== 1) return;
    const r = this.boardEl.getBoundingClientRect();
    const c = Math.floor(((e.clientX - r.left) / r.width) * 8);
    const row = Math.floor(((e.clientY - r.top) / r.height) * 8);
    if (c < 0 || c > 7 || row < 0 || row > 7) return;
    const sq = row * 8 + c;
    const all = this.legalNow();
    // Pick (or re-pick) one of your pieces, unless you're partway through a jump chain.
    if (owner(this.board[sq]) === 1 && this.prefix.length <= 1) {
      if (all.some((m) => m.path[0] === sq)) {
        this.prefix = this.prefix[0] === sq ? [] : [sq];
        sfx.pick();
      } else {
        this.prefix = [];
        this.toast(all);
      }
      this.render();
      return;
    }
    if (!this.prefix.length) return;
    const next = this.matching().filter((m) => m.path[this.prefix.length] === sq);
    if (!next.length) {
      if (this.prefix.length === 1) {
        this.prefix = [];
        this.render();
      }
      return;
    }
    this.prefix = [...this.prefix, sq];
    const done = next.find((m) => m.path.length === this.prefix.length);
    if (done) return this.playerMove(done);
    sfx.tick();
    this.render();
  }

  private toast(all: CMove[]) {
    if (all.length && all[0].caps.length) this.ctx.toast("A jump is available, and jumps are required.");
  }

  private snapshot(): Snapshot {
    return { board: this.board.slice(), ids: this.ids.slice(), last: this.last, quiet: this.quiet, plies: this.plies };
  }

  private playerMove(m: CMove) {
    this.history.push(this.snapshot());
    if (this.history.length > 300) this.history.shift();
    if (!this.counted) {
      this.counted = true;
      recordStart(this.key);
    }
    this.prefix = [];
    this.apply(m);
    if (this.over) return;
    this.thinking = true;
    this.status();
    this.aiTimer = window.setTimeout(() => this.aiMove(), motionEnabled() ? 380 : 60);
  }

  private aiMove() {
    if (this.over) return;
    const m = bestMove(this.board, this.level);
    this.thinking = false;
    if (m) this.apply(m);
    this.status();
  }

  private apply(m: CMove) {
    const from = m.path[0];
    const to = m.path[m.path.length - 1];
    const wasMan = !isKing(this.board[from]);
    const id = this.ids[from];
    this.ids[from] = 0;
    for (const c of m.caps) this.ids[c] = 0;
    this.ids[to] = id;
    const before = this.board[from];
    applyMove(this.board, m);
    const crowned = this.board[to] !== before;
    this.quiet = m.caps.length || wasMan ? 0 : this.quiet + 1;
    this.plies++;
    this.last = m.path;
    this.turn = opp(this.turn);
    if (m.caps.length) sfx.merge();
    else sfx.place();
    if (crowned) setTimeout(() => sfx.achieve(), 200);
    this.render(false, m);
    this.checkEnd();
  }

  private checkEnd() {
    const moves = genMoves(this.board, this.turn);
    let result: "win" | "loss" | "draw" | null = null;
    if (!moves.length) result = this.turn === 2 ? "win" : "loss";
    else if (this.quiet >= NO_PROGRESS_LIMIT) result = "draw";
    if (!result) return;
    this.over = true;
    clearTimeout(this.aiTimer);
    this.thinking = false;
    if (result === "win") {
      recordWin(this.key);
      sfx.win();
    } else if (result === "loss") {
      recordLoss(this.key);
      sfx.lose();
    }
    this.status();
    const s = getStats(this.key);
    const theirs = this.board.filter((v) => owner(v) === 2).length;
    const yours = this.board.filter((v) => owner(v) === 1).length;
    this.endTimer = window.setTimeout(
      () =>
        this.ctx.end({
          won: result === "win",
          title: result === "win" ? "You win" : result === "loss" ? "The computer wins" : "Draw",
          lines: [
            result === "draw"
              ? "Forty moves each without a capture or a man moving"
              : result === "win"
                ? theirs
                  ? "The computer has no moves left"
                  : "You captured every piece"
                : yours
                  ? "You have no moves left"
                  : "All your pieces were captured",
            `${s.won} won of ${s.played} played on ${this.level}`,
          ],
        }),
      900,
    );
  }

  private render(fresh = false, moving?: CMove) {
    const legal = this.turn === 1 && !this.over && !this.thinking ? this.legalNow() : [];
    const movable = new Set(legal.map((m) => m.path[0]));
    const nextSteps = new Set(this.prefix.length ? this.matching().map((m) => m.path[this.prefix.length]) : []);
    const mustJump = legal.length > 0 && legal[0].caps.length > 0;
    this.squares.forEach((q, i) => {
      q.classList.toggle("last", !!this.last && this.last.includes(i));
      q.classList.toggle("sel", this.prefix.includes(i));
      q.classList.toggle("target", nextSteps.has(i));
      q.classList.toggle("can", !this.prefix.length && movable.has(i) && mustJump);
    });
    const live = new Set<number>();
    // While you're partway through a chain, show your piece on the last square you clicked.
    const shownAt = new Map<number, number>();
    if (this.prefix.length > 1) shownAt.set(this.ids[this.prefix[0]], this.prefix[this.prefix.length - 1]);
    this.board.forEach((v, sq) => {
      if (!v) return;
      const id = this.ids[sq];
      live.add(id);
      let el = this.pieceEls.get(id);
      if (!el) {
        el = document.createElement("div");
        el.className = "ck-piece";
        el.innerHTML = `<span class="ck-disc"><svg class="ck-crown" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17l-1-9 5 4 4-6 4 6 5-4-1 9z"/><path d="M4 19h16"/></svg></span>`;
        if (fresh && motionEnabled()) {
          el.classList.add("intro");
          el.style.animationDelay = `${(sq >> 3) * 30 + (sq & 7) * 10}ms`;
        }
        this.layer.appendChild(el);
        this.pieceEls.set(id, el);
      }
      el.classList.toggle("you", owner(v) === 1);
      el.classList.toggle("cpu", owner(v) === 2);
      el.classList.toggle("king", isKing(v));
      el.classList.toggle("movable", movable.has(sq) && !this.prefix.length);
      const at = shownAt.get(id) ?? sq;
      // A multi-jump hops through each landing square.
      if (moving && moving.path.length > 2 && moving.path[moving.path.length - 1] === sq && motionEnabled()) {
        const hops = moving.path.slice(1);
        el.animate(
          [{ transform: el.style.transform }, ...hops.map((h) => ({ transform: `translate(${(h & 7) * 100}%, ${(h >> 3) * 100}%)` }))],
          { duration: 170 * hops.length, easing: "ease-in-out" },
        );
      }
      el.style.transform = `translate(${(at & 7) * 100}%, ${(at >> 3) * 100}%)`;
    });
    for (const [id, el] of this.pieceEls) {
      if (!live.has(id)) {
        this.pieceEls.delete(id);
        if (motionEnabled()) {
          el.classList.add("taken");
          setTimeout(() => el.remove(), 300);
        } else el.remove();
      }
    }
    this.ctx.setUndo(this.history.length > 0);
  }

  private status() {
    const yours = this.board.filter((v) => owner(v) === 1).length;
    const theirs = this.board.filter((v) => owner(v) === 2).length;
    this.ctx.setStatus([
      { label: "Turn", value: this.over ? "—" : this.turn === 1 && !this.thinking ? "You" : "Computer" },
      { label: "You", value: String(yours) },
      { label: "Computer", value: String(theirs) },
    ]);
  }
}

export const checkers: GameModule = {
  id: "checkers",
  name: "Checkers",
  group: "board",
  blurb: "Jump the computer's pieces and reach the far side to make kings.",
  art: "checkers",
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
  statsKey: (o) => `checkers:${o("level")}`,
  iconSvg: `<circle cx="9" cy="9" r="4"/><circle cx="15" cy="15" r="4" fill="currentColor"/>`,
  artSvg: (() => {
    let s = `<rect x="70" y="10" width="112" height="112" rx="8" class="ck-art-light"/>`;
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) if ((r + c) % 2) s += `<rect x="${70 + c * 14}" y="${10 + r * 14}" width="14" height="14" class="ck-art-dark"/>`;
    const disc = (r: number, c: number, cls: string) => `<circle cx="${77 + c * 14}" cy="${17 + r * 14}" r="5.2" class="${cls}"/>`;
    for (const [r, c] of [[0, 1], [0, 5], [1, 2], [1, 6], [2, 3], [3, 0]]) s += disc(r, c, "ck-art-cpu");
    for (const [r, c] of [[5, 0], [5, 4], [6, 1], [6, 5], [7, 2], [4, 3]]) s += disc(r, c, "ck-art-you");
    return s;
  })(),
  create: (root, ctx) => new Checkers(root, ctx),
};
