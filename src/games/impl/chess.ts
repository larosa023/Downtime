import { GameContext, GameInstance } from "../../core/types";
import { getStats, recordLoss, recordStart, recordWin } from "../../core/stats";
import { PIECE_SVG } from "./chess-pieces";
import { sfx } from "../../core/sound";
import { motionEnabled } from "../../core/settings";

// ---------------------------------------------------------------------------
// Engine. Squares are 0..63 with 0 = a8 and 63 = h1. Pieces are FEN letters:
// uppercase white, lowercase black, "" empty.
// ---------------------------------------------------------------------------

export type Color = "w" | "b";

export interface Pos {
  b: string[];
  turn: Color;
  castle: number; // 1 = white king side, 2 = white queen side, 4 / 8 = black
  ep: number; // en passant target square, or -1
  half: number; // plies since the last capture or pawn move
}

export interface Move {
  from: number;
  to: number;
  piece: string;
  captured: string;
  promo: string;
  flags: number;
}

const F_EP = 1;
const F_CASTLE = 2;
const F_DOUBLE = 4;

const KN = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KG = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]];

const CASTLE_MASK = Array(64).fill(15);
CASTLE_MASK[60] = 12;
CASTLE_MASK[63] = 14;
CASTLE_MASK[56] = 13;
CASTLE_MASK[4] = 3;
CASTLE_MASK[7] = 11;
CASTLE_MASK[0] = 7;

const colorOf = (p: string): Color => (p === p.toUpperCase() ? "w" : "b");
const other = (c: Color): Color => (c === "w" ? "b" : "w");

export const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export function parseFen(fen: string): Pos {
  const [rows, turn, cas, ep, half] = fen.split(" ");
  const b: string[] = [];
  for (const ch of rows.replace(/\//g, "")) {
    if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i++) b.push("");
    else b.push(ch);
  }
  let castle = 0;
  if (cas.includes("K")) castle |= 1;
  if (cas.includes("Q")) castle |= 2;
  if (cas.includes("k")) castle |= 4;
  if (cas.includes("q")) castle |= 8;
  const epSq = ep && ep !== "-" ? (8 - Number(ep[1])) * 8 + (ep.charCodeAt(0) - 97) : -1;
  return { b, turn: turn as Color, castle, ep: epSq, half: Number(half) || 0 };
}

const clonePos = (p: Pos): Pos => ({ ...p, b: p.b.slice() });

/** Repetition key: placement, side, castling and en passant. */
const posKey = (p: Pos) => `${p.b.map((x) => x || ".").join("")}${p.turn}${p.castle}${p.ep}`;

export function attacked(p: Pos, sq: number, by: Color): boolean {
  const r = sq >> 3;
  const c = sq & 7;
  const w = by === "w";
  const pr = w ? r + 1 : r - 1;
  const pawn = w ? "P" : "p";
  if (pr >= 0 && pr < 8) {
    if (c > 0 && p.b[pr * 8 + c - 1] === pawn) return true;
    if (c < 7 && p.b[pr * 8 + c + 1] === pawn) return true;
  }
  const N = w ? "N" : "n";
  const K = w ? "K" : "k";
  const B = w ? "B" : "b";
  const R = w ? "R" : "r";
  const Q = w ? "Q" : "q";
  for (const [dr, dc] of KN) {
    const rr = r + dr;
    const cc = c + dc;
    if (rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && p.b[rr * 8 + cc] === N) return true;
  }
  for (const [dr, dc] of KG) {
    const rr = r + dr;
    const cc = c + dc;
    if (rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && p.b[rr * 8 + cc] === K) return true;
  }
  for (const [dr, dc] of DIAG) {
    let rr = r + dr;
    let cc = c + dc;
    while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) {
      const x = p.b[rr * 8 + cc];
      if (x) {
        if (x === B || x === Q) return true;
        break;
      }
      rr += dr;
      cc += dc;
    }
  }
  for (const [dr, dc] of ORTH) {
    let rr = r + dr;
    let cc = c + dc;
    while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) {
      const x = p.b[rr * 8 + cc];
      if (x) {
        if (x === R || x === Q) return true;
        break;
      }
      rr += dr;
      cc += dc;
    }
  }
  return false;
}

export function kingSq(p: Pos, c: Color): number {
  return p.b.indexOf(c === "w" ? "K" : "k");
}

export function inCheck(p: Pos): boolean {
  return attacked(p, kingSq(p, p.turn), other(p.turn));
}

/** Pseudo-legal moves (may leave the king in check). */
export function gen(p: Pos, capsOnly = false): Move[] {
  const out: Move[] = [];
  const us = p.turn;
  const white = us === "w";
  const b = p.b;
  const add = (from: number, to: number, piece: string, flags = 0, promo = "") => {
    const captured = flags & F_EP ? (white ? "p" : "P") : b[to];
    if (capsOnly && !captured && !promo) return;
    out.push({ from, to, piece, captured, promo, flags });
  };
  const addPawn = (from: number, to: number, piece: string, flags = 0) => {
    const r = to >> 3;
    if (r === 0 || r === 7) for (const q of "qnrb") add(from, to, piece, flags, white ? q.toUpperCase() : q);
    else add(from, to, piece, flags);
  };
  for (let sq = 0; sq < 64; sq++) {
    const pc = b[sq];
    if (!pc || colorOf(pc) !== us) continue;
    const t = pc.toLowerCase();
    const r = sq >> 3;
    const c = sq & 7;
    if (t === "p") {
      const dir = white ? -1 : 1;
      const r1 = r + dir;
      if (r1 < 0 || r1 > 7) continue;
      if (!b[r1 * 8 + c]) {
        if (!capsOnly || r1 === 0 || r1 === 7) addPawn(sq, r1 * 8 + c, pc);
        const start = white ? 6 : 1;
        if (!capsOnly && r === start && !b[(r + 2 * dir) * 8 + c]) add(sq, (r + 2 * dir) * 8 + c, pc, F_DOUBLE);
      }
      for (const dc of [-1, 1]) {
        const c2 = c + dc;
        if (c2 < 0 || c2 > 7) continue;
        const to = r1 * 8 + c2;
        const tgt = b[to];
        if (tgt && colorOf(tgt) !== us) addPawn(sq, to, pc);
        else if (to === p.ep) add(sq, to, pc, F_EP);
      }
    } else if (t === "n" || t === "k") {
      for (const [dr, dc] of t === "n" ? KN : KG) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 0 || rr > 7 || cc < 0 || cc > 7) continue;
        const to = rr * 8 + cc;
        if (!b[to] || colorOf(b[to]) !== us) add(sq, to, pc);
      }
      if (t === "k" && !capsOnly) {
        const them = other(us);
        if (white && sq === 60) {
          if (p.castle & 1 && !b[61] && !b[62] && b[63] === "R" && !attacked(p, 60, them) && !attacked(p, 61, them) && !attacked(p, 62, them))
            add(60, 62, pc, F_CASTLE);
          if (p.castle & 2 && !b[59] && !b[58] && !b[57] && b[56] === "R" && !attacked(p, 60, them) && !attacked(p, 59, them) && !attacked(p, 58, them))
            add(60, 58, pc, F_CASTLE);
        } else if (!white && sq === 4) {
          if (p.castle & 4 && !b[5] && !b[6] && b[7] === "r" && !attacked(p, 4, them) && !attacked(p, 5, them) && !attacked(p, 6, them))
            add(4, 6, pc, F_CASTLE);
          if (p.castle & 8 && !b[3] && !b[2] && !b[1] && b[0] === "r" && !attacked(p, 4, them) && !attacked(p, 3, them) && !attacked(p, 2, them))
            add(4, 2, pc, F_CASTLE);
        }
      }
    } else {
      const dirs = t === "b" ? DIAG : t === "r" ? ORTH : [...DIAG, ...ORTH];
      for (const [dr, dc] of dirs) {
        let rr = r + dr;
        let cc = c + dc;
        while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) {
          const to = rr * 8 + cc;
          if (b[to]) {
            if (colorOf(b[to]) !== us) add(sq, to, pc);
            break;
          }
          add(sq, to, pc);
          rr += dr;
          cc += dc;
        }
      }
    }
  }
  return out;
}

interface Undo {
  castle: number;
  ep: number;
  half: number;
}

const ROOK_HOP: Record<number, [number, number]> = { 62: [63, 61], 58: [56, 59], 6: [7, 5], 2: [0, 3] };

export function make(p: Pos, m: Move): Undo {
  const u = { castle: p.castle, ep: p.ep, half: p.half };
  p.b[m.to] = m.promo || m.piece;
  p.b[m.from] = "";
  if (m.flags & F_EP) p.b[m.to + (p.turn === "w" ? 8 : -8)] = "";
  if (m.flags & F_CASTLE) {
    const [rf, rt] = ROOK_HOP[m.to];
    p.b[rt] = p.b[rf];
    p.b[rf] = "";
  }
  p.castle &= CASTLE_MASK[m.from] & CASTLE_MASK[m.to];
  p.ep = m.flags & F_DOUBLE ? (m.from + m.to) / 2 : -1;
  p.half = m.piece === "p" || m.piece === "P" || m.captured ? 0 : p.half + 1;
  p.turn = other(p.turn);
  return u;
}

export function unmake(p: Pos, m: Move, u: Undo) {
  p.turn = other(p.turn);
  p.b[m.from] = m.piece;
  if (m.flags & F_EP) {
    p.b[m.to] = "";
    p.b[m.to + (p.turn === "w" ? 8 : -8)] = m.captured;
  } else p.b[m.to] = m.captured;
  if (m.flags & F_CASTLE) {
    const [rf, rt] = ROOK_HOP[m.to];
    p.b[rf] = p.b[rt];
    p.b[rt] = "";
  }
  p.castle = u.castle;
  p.ep = u.ep;
  p.half = u.half;
}

export function legal(p: Pos): Move[] {
  const us = p.turn;
  return gen(p).filter((m) => {
    const u = make(p, m);
    const ok = !attacked(p, kingSq(p, us), p.turn);
    unmake(p, m, u);
    return ok;
  });
}

export function perft(p: Pos, depth: number): number {
  if (depth === 0) return 1;
  let n = 0;
  const us = p.turn;
  for (const m of gen(p)) {
    const u = make(p, m);
    if (!attacked(p, kingSq(p, us), p.turn)) n += perft(p, depth - 1);
    unmake(p, m, u);
  }
  return n;
}

// --- Evaluation: material plus piece-square tables (white's view, a8 first). ---

const VAL: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const PST: Record<string, number[]> = {
  p: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
  n: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
  b: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
  r: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
  q: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
  k: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
  e: [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50],
};

function evaluate(p: Pos): number {
  let heavy = 0;
  for (const x of p.b) if (x && x !== "p" && x !== "P" && x !== "k" && x !== "K") heavy += VAL[x.toLowerCase()];
  const endgame = heavy <= 1400;
  let s = 0;
  for (let sq = 0; sq < 64; sq++) {
    const x = p.b[sq];
    if (!x) continue;
    const t = x.toLowerCase();
    const white = x !== t;
    const idx = white ? sq : (7 - (sq >> 3)) * 8 + (sq & 7);
    const v = VAL[t] + (t === "k" ? (endgame ? PST.e : PST.k)[idx] : PST[t][idx]);
    s += white ? v : -v;
  }
  return p.turn === "w" ? s : -s;
}

const MATE = 100000;

class Searcher {
  private deadline = 0;
  stopped = false;
  private nodes = 0;
  private killers: Move[][] = [];

  constructor(private p: Pos) {}

  private order(moves: Move[], ply: number, best?: Move) {
    const k = this.killers[ply] ?? [];
    const score = (m: Move) => {
      if (best && m.from === best.from && m.to === best.to && m.promo === best.promo) return 1e6;
      let s = 0;
      if (m.captured) s += 10000 + VAL[m.captured.toLowerCase()] * 10 - VAL[m.piece.toLowerCase()];
      if (m.promo) s += 9000 + VAL[m.promo.toLowerCase()];
      if (k.some((x) => x.from === m.from && x.to === m.to)) s += 5000;
      return s;
    };
    return moves.map((m) => [score(m), m] as const).sort((a, b) => b[0] - a[0]).map((x) => x[1]);
  }

  private tick() {
    if ((++this.nodes & 1023) === 0 && performance.now() > this.deadline) this.stopped = true;
  }

  private quiesce(alpha: number, beta: number, qd: number): number {
    this.tick();
    if (this.stopped) return 0;
    const p = this.p;
    const stand = evaluate(p);
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
    if (qd > 8) return alpha;
    const us = p.turn;
    for (const m of this.order(gen(p, true), 63)) {
      const u = make(p, m);
      if (attacked(p, kingSq(p, us), p.turn)) {
        unmake(p, m, u);
        continue;
      }
      const v = -this.quiesce(-beta, -alpha, qd + 1);
      unmake(p, m, u);
      if (this.stopped) return 0;
      if (v >= beta) return beta;
      if (v > alpha) alpha = v;
    }
    return alpha;
  }

  private search(depth: number, alpha: number, beta: number, ply: number): number {
    this.tick();
    if (this.stopped) return 0;
    const p = this.p;
    if (p.half >= 100) return 0;
    const checked = inCheck(p);
    if (depth <= 0 && !checked) return this.quiesce(alpha, beta, 0);
    const us = p.turn;
    let legalCount = 0;
    for (const m of this.order(gen(p), ply)) {
      const u = make(p, m);
      if (attacked(p, kingSq(p, us), p.turn)) {
        unmake(p, m, u);
        continue;
      }
      legalCount++;
      const v = -this.search(depth - 1, -beta, -alpha, ply + 1);
      unmake(p, m, u);
      if (this.stopped) return 0;
      if (v >= beta) {
        if (!m.captured) {
          const k = (this.killers[ply] ??= []);
          k.unshift(m);
          k.length = Math.min(k.length, 2);
        }
        return beta;
      }
      if (v > alpha) alpha = v;
    }
    if (!legalCount) return checked ? -MATE + ply : 0;
    return alpha;
  }

  /** Iterative deepening at the root. `noise` adds randomness for easier levels. */
  best(maxDepth: number, ms: number, noise: number): Move {
    const p = this.p;
    this.deadline = performance.now() + ms;
    let moves = legal(p);
    let best = moves[0];
    let bestScores = new Map<Move, number>();
    for (let d = 1; d <= maxDepth; d++) {
      const scores = new Map<Move, number>();
      let alpha = -Infinity;
      let dBest = moves[0];
      for (const m of this.order(moves, 0, best)) {
        const u = make(p, m);
        const v = -this.search(d - 1, -MATE * 2, noise ? MATE * 2 : -alpha, 1);
        unmake(p, m, u);
        if (this.stopped) break;
        scores.set(m, v);
        if (v > alpha) {
          alpha = v;
          dBest = m;
        }
      }
      if (this.stopped) break;
      best = dBest;
      bestScores = scores;
      moves = [...moves].sort((a, b) => (scores.get(b) ?? -1e9) - (scores.get(a) ?? -1e9));
      if (alpha > MATE / 2) break;
    }
    if (noise && bestScores.size) {
      let pick = best;
      let top = -Infinity;
      for (const [m, v] of bestScores) {
        const nv = v + (Math.random() - 0.5) * noise;
        if (nv > top) {
          top = nv;
          pick = m;
        }
      }
      return pick;
    }
    return best;
  }
}

const LEVELS: Record<string, { depth: number; ms: number; noise: number }> = {
  easy: { depth: 2, ms: 300, noise: 220 },
  normal: { depth: 4, ms: 500, noise: 40 },
  hard: { depth: 8, ms: 900, noise: 0 },
};

export function engineMove(p: Pos, level: string): Move | null {
  const l = LEVELS[level] ?? LEVELS.normal;
  const q = clonePos(p);
  if (!legal(q).length) return null;
  return new Searcher(q).best(l.depth, l.ms, l.noise);
}

// ---------------------------------------------------------------------------
// Pieces: simple silhouettes drawn for Downtime.
// ---------------------------------------------------------------------------

function pieceHtml(pc: string) {
  return `<svg viewBox="0 0 45 45" aria-hidden="true">${PIECE_SVG[pc.toLowerCase()]}</svg>`;
}

const NAMES: Record<string, string> = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
const sqName = (sq: number) => `${"abcdefgh"[sq & 7]}${8 - (sq >> 3)}`;

// ---------------------------------------------------------------------------
// Game UI
// ---------------------------------------------------------------------------

interface Snapshot {
  pos: Pos;
  ids: number[];
  taken: { w: string[]; b: string[] };
  last: [number, number] | null;
  keys: string[];
  plies: number;
}

class Chess implements GameInstance {
  private el: HTMLDivElement;
  private boardEl!: HTMLDivElement;
  private squares: HTMLDivElement[] = [];
  private layer!: HTMLDivElement;
  private pieceEls = new Map<number, HTMLDivElement>();
  private pos!: Pos;
  private ids: number[] = [];
  private nextId = 1;
  private taken = { w: [] as string[], b: [] as string[] };
  private last: [number, number] | null = null;
  private keys: string[] = [];
  private plies = 0;
  private history: Snapshot[] = [];
  private selected = -1;
  private targets: Move[] = [];
  private over = false;
  private counted = false;
  private thinking = false;
  private aiTimer = 0;
  private endTimer = 0;
  private level: string;
  private drag: { sq: number; id: number; x: number; y: number; moved: boolean; pointerId: number; wasSelected: boolean } | null = null;
  private resizeObs: ResizeObserver;

  constructor(root: HTMLElement, private ctx: GameContext) {
    this.level = ctx.option("level") in LEVELS ? ctx.option("level") : "normal";
    this.el = document.createElement("div");
    this.el.className = "chess";
    this.el.innerHTML = `
      <div class="ch-col">
        <div class="ch-tray top" aria-label="Pieces you've lost"></div>
        <div class="ch-board">
          <div class="ch-squares"></div>
          <div class="ch-layer"></div>
          <div class="ch-promo" hidden></div>
        </div>
        <div class="ch-tray bottom" aria-label="Pieces you've captured"></div>
      </div>`;
    root.appendChild(this.el);
    this.boardEl = this.el.querySelector(".ch-board")!;
    this.layer = this.el.querySelector(".ch-layer")!;
    const sqWrap = this.el.querySelector(".ch-squares")!;
    for (let sq = 0; sq < 64; sq++) {
      const d = document.createElement("div");
      const r = sq >> 3;
      const c = sq & 7;
      d.className = `ch-sq ${(r + c) % 2 ? "dark" : "light"}`;
      d.dataset.sq = String(sq);
      if (c === 0) d.insertAdjacentHTML("beforeend", `<span class="ch-rank">${8 - r}</span>`);
      if (r === 7) d.insertAdjacentHTML("beforeend", `<span class="ch-file">${"abcdefgh"[c]}</span>`);
      sqWrap.appendChild(d);
      this.squares.push(d);
    }
    this.boardEl.addEventListener("pointerdown", this.onDown);
    this.boardEl.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("keydown", this.onKey);
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(this.el);
    this.newGame();
  }

  private get key() {
    return `chess:${this.level}`;
  }

  newGame() {
    clearTimeout(this.aiTimer);
    clearTimeout(this.endTimer);
    if (this.counted && !this.over) recordLoss(this.key);
    this.pos = parseFen(START);
    this.ids = this.pos.b.map((x) => (x ? this.nextId++ : 0));
    this.taken = { w: [], b: [] };
    this.last = null;
    this.keys = [posKey(this.pos)];
    this.plies = 0;
    this.history = [];
    this.selected = -1;
    this.targets = [];
    this.over = false;
    this.counted = false;
    this.thinking = false;
    this.layer.innerHTML = "";
    this.pieceEls.clear();
    this.hidePromo();
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
    this.pos = s.pos;
    this.ids = s.ids;
    this.taken = s.taken;
    this.last = s.last;
    this.keys = s.keys;
    this.plies = s.plies;
    this.selected = -1;
    this.targets = [];
    this.hidePromo();
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
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    this.resizeObs.disconnect();
    this.el.remove();
  }

  resize() {
    const r = this.el.getBoundingClientRect();
    const size = Math.floor(Math.min(r.width - 48, r.height - 120) / 8) * 8;
    this.el.style.setProperty("--bs", `${Math.max(240, Math.min(size, 720))}px`);
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && this.selected >= 0) {
      this.selected = -1;
      this.targets = [];
      this.hidePromo();
      this.render();
    }
  };

  // ----- input -----

  private squareAt(x: number, y: number): number {
    const r = this.boardEl.getBoundingClientRect();
    const c = Math.floor(((x - r.left) / r.width) * 8);
    const row = Math.floor(((y - r.top) / r.height) * 8);
    if (c < 0 || c > 7 || row < 0 || row > 7) return -1;
    return row * 8 + c;
  }

  private canAct() {
    return !this.over && !this.thinking && this.pos.turn === "w";
  }

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest(".ch-promo")) return;
    if (!this.canAct()) return;
    const sq = this.squareAt(e.clientX, e.clientY);
    if (sq < 0) return;
    const pc = this.pos.b[sq];
    if (this.selected >= 0 && this.targets.some((m) => m.to === sq)) {
      this.tryMove(this.selected, sq);
      return;
    }
    if (pc && colorOf(pc) === "w") {
      e.preventDefault();
      const wasSelected = this.selected === sq;
      this.select(sq);
      this.drag = { sq, id: this.ids[sq], x: e.clientX, y: e.clientY, moved: false, pointerId: e.pointerId, wasSelected };
      window.addEventListener("pointermove", this.onMove);
      window.addEventListener("pointerup", this.onUp);
      return;
    }
    this.selected = -1;
    this.targets = [];
    this.render();
  };

  private onMove = (e: PointerEvent) => {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) return;
    d.moved = true;
    const el = this.pieceEls.get(d.id);
    if (!el) return;
    const r = this.boardEl.getBoundingClientRect();
    const s = r.width / 8;
    el.classList.add("dragging");
    el.style.transform = `translate(${e.clientX - r.left - s / 2}px, ${e.clientY - r.top - s / 2}px)`;
    const over = this.squareAt(e.clientX, e.clientY);
    this.squares.forEach((q, i) => q.classList.toggle("hover", i === over && this.targets.some((m) => m.to === i)));
  };

  private onUp = (e: PointerEvent) => {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    this.drag = null;
    this.squares.forEach((q) => q.classList.remove("hover"));
    const el = this.pieceEls.get(d.id);
    el?.classList.remove("dragging");
    if (!d.moved) {
      if (d.wasSelected) {
        this.selected = -1;
        this.targets = [];
      }
      this.render();
      return;
    }
    const to = this.squareAt(e.clientX, e.clientY);
    if (to >= 0 && this.targets.some((m) => m.to === to)) {
      if (el) el.classList.add("instant");
      this.tryMove(d.sq, to);
      requestAnimationFrame(() => el?.classList.remove("instant"));
    } else this.render();
  };

  private select(sq: number) {
    this.selected = sq;
    this.targets = legal(this.pos).filter((m) => m.from === sq);
    sfx.pick();
    this.render();
  }

  private tryMove(from: number, to: number) {
    const options = this.targets.filter((m) => m.from === from && m.to === to);
    if (!options.length) return;
    if (options.length > 1) return this.showPromo(options);
    this.playerMove(options[0]);
  }

  private showPromo(options: Move[]) {
    const p = this.el.querySelector<HTMLElement>(".ch-promo")!;
    const c = options[0].to & 7;
    p.style.setProperty("--c", String(c));
    p.innerHTML = ["Q", "R", "B", "N"]
      .map((q) => `<button class="ch-promo-btn" data-p="${q}" aria-label="Promote to ${NAMES[q.toLowerCase()]}"><span class="cp w">${pieceHtml(q)}</span></button>`)
      .join("");
    p.hidden = false;
    p.onclick = (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-p]");
      if (!b) return;
      const m = options.find((x) => x.promo === b.dataset.p);
      this.hidePromo();
      if (m) this.playerMove(m);
    };
  }

  private hidePromo() {
    const p = this.el.querySelector<HTMLElement>(".ch-promo");
    if (p) {
      p.hidden = true;
      p.innerHTML = "";
    }
  }

  // ----- moves -----

  private snapshot(): Snapshot {
    return {
      pos: clonePos(this.pos),
      ids: this.ids.slice(),
      taken: { w: this.taken.w.slice(), b: this.taken.b.slice() },
      last: this.last,
      keys: this.keys.slice(),
      plies: this.plies,
    };
  }

  private playerMove(m: Move) {
    this.history.push(this.snapshot());
    if (this.history.length > 300) this.history.shift();
    if (!this.counted) {
      this.counted = true;
      recordStart(this.key);
    }
    this.apply(m);
    if (this.over) return;
    this.thinking = true;
    this.status();
    this.aiTimer = window.setTimeout(() => this.aiMove(), motionEnabled() ? 320 : 60);
  }

  private aiMove() {
    if (this.over) return;
    const m = engineMove(this.pos, this.level);
    this.thinking = false;
    if (!m) return;
    this.apply(m);
    this.status();
  }

  private apply(m: Move) {
    const p = this.pos;
    const mover = p.turn;
    const id = this.ids[m.from];
    if (m.flags & F_EP) {
      const capSq = m.to + (mover === "w" ? 8 : -8);
      this.ids[capSq] = 0;
    }
    if (m.flags & F_CASTLE) {
      const [rf, rt] = ROOK_HOP[m.to];
      this.ids[rt] = this.ids[rf];
      this.ids[rf] = 0;
    }
    this.ids[m.to] = id;
    this.ids[m.from] = 0;
    if (m.captured) this.taken[mover].push(m.captured);
    make(p, m);
    this.last = [m.from, m.to];
    this.plies++;
    this.keys.push(posKey(p));
    this.selected = -1;
    this.targets = [];
    if (inCheck(p)) sfx.flag();
    else if (m.captured) sfx.merge();
    else sfx.place();
    this.render();
    this.checkEnd();
  }

  private insufficient(): boolean {
    const rest = this.pos.b.filter((x) => x && x !== "k" && x !== "K");
    if (!rest.length) return true;
    return rest.length === 1 && /[nbNB]/.test(rest[0]);
  }

  private checkEnd() {
    const p = this.pos;
    const moves = legal(p);
    let result: "win" | "loss" | "draw" | null = null;
    let reason = "";
    if (!moves.length) {
      if (inCheck(p)) {
        result = p.turn === "b" ? "win" : "loss";
        reason = "Checkmate";
      } else {
        result = "draw";
        reason = "Stalemate";
      }
    } else if (p.half >= 100) {
      result = "draw";
      reason = "Fifty moves without a capture or pawn move";
    } else if (this.keys.filter((k) => k === this.keys[this.keys.length - 1]).length >= 3) {
      result = "draw";
      reason = "The same position came up three times";
    } else if (this.insufficient()) {
      result = "draw";
      reason = "Not enough pieces left to checkmate";
    }
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
    } else sfx.flip();
    this.status();
    const s = getStats(this.key);
    this.endTimer = window.setTimeout(
      () =>
        this.ctx.end({
          won: result === "win",
          title: result === "win" ? "Checkmate. You win" : result === "loss" ? "Checkmate. The computer wins" : "Draw",
          lines: [result === "draw" ? reason : `${Math.ceil(this.plies / 2)} moves`, `${s.won} won of ${s.played} played on ${this.level}`],
        }),
      900,
    );
  }

  // ----- drawing -----

  private render(fresh = false) {
    const p = this.pos;
    const checkSq = inCheck(p) ? kingSq(p, p.turn) : -1;
    this.squares.forEach((q, i) => {
      q.classList.toggle("last", !!this.last && (this.last[0] === i || this.last[1] === i));
      q.classList.toggle("sel", i === this.selected);
      q.classList.toggle("check", i === checkSq);
      const t = this.targets.find((m) => m.to === i);
      q.classList.toggle("target", !!t && !t.captured);
      q.classList.toggle("capture", !!t && !!t.captured);
    });
    const live = new Set<number>();
    p.b.forEach((pc, sq) => {
      if (!pc) return;
      const id = this.ids[sq];
      live.add(id);
      let el = this.pieceEls.get(id);
      if (!el) {
        el = document.createElement("div");
        el.className = "ch-piece";
        if (fresh && motionEnabled()) {
          el.classList.add("intro");
          el.style.animationDelay = `${(sq >> 3) * 25 + (sq & 7) * 8}ms`;
        }
        this.layer.appendChild(el);
        this.pieceEls.set(id, el);
      }
      if (el.dataset.pc !== pc) {
        el.dataset.pc = pc;
        el.innerHTML = `<span class="cp ${colorOf(pc)}">${pieceHtml(pc)}</span>`;
      }
      el.setAttribute("aria-label", `${colorOf(pc) === "w" ? "White" : "Black"} ${NAMES[pc.toLowerCase()]} on ${sqName(sq)}`);
      el.classList.toggle("mine", colorOf(pc) === "w");
      if (!el.classList.contains("dragging")) el.style.transform = `translate(${(sq & 7) * 100}%, ${(sq >> 3) * 100}%)`;
    });
    for (const [id, el] of this.pieceEls) {
      if (!live.has(id)) {
        el.remove();
        this.pieceEls.delete(id);
      }
    }
    this.renderTrays();
    this.ctx.setUndo(this.history.length > 0);
  }

  private renderTrays() {
    const order = "qrbnp";
    const sorted = (xs: string[]) => [...xs].sort((a, b) => order.indexOf(a.toLowerCase()) - order.indexOf(b.toLowerCase()));
    const POINTS: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
    const mat = (xs: string[]) => xs.reduce((n, x) => n + POINTS[x.toLowerCase()], 0);
    const diff = mat(this.taken.w) - mat(this.taken.b);
    const tray = (xs: string[], lead: number) =>
      sorted(xs)
        .map((x) => `<span class="cp ${colorOf(x)}">${pieceHtml(x)}</span>`)
        .join("") + (lead > 0 ? `<em>+${lead}</em>` : "");
    this.el.querySelector(".ch-tray.top")!.innerHTML = tray(this.taken.b, -diff);
    this.el.querySelector(".ch-tray.bottom")!.innerHTML = tray(this.taken.w, diff);
  }

  private status() {
    this.ctx.setStatus([
      { label: "Turn", value: this.over ? "—" : this.thinking || this.pos.turn === "b" ? "Computer" : "You" },
      { label: "Move", value: String(Math.floor(this.plies / 2) + 1) },
    ]);
  }
}

export function create(root: HTMLElement, ctx: GameContext): GameInstance {
  return new Chess(root, ctx);
}
