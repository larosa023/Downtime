// Chess engine: move generation, search and notation. No DOM, so it also runs in a Web Worker.
// Squares are 0..63 with 0 = a8 and 63 = h1. Pieces are FEN letters: uppercase white, lowercase black.

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

export const F_EP = 1;
export const F_CASTLE = 2;
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

export const colorOf = (p: string): Color => (p === p.toUpperCase() ? "w" : "b");
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

export const clonePos = (p: Pos): Pos => ({ ...p, b: p.b.slice() });

/** Repetition key: placement, side, castling and en passant. */
export const posKey = (p: Pos) => `${p.b.map((x) => x || ".").join("")}${p.turn}${p.castle}${p.ep}`;

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

export const ROOK_HOP: Record<number, [number, number]> = { 62: [63, 61], 58: [56, 59], 6: [7, 5], 2: [0, 3] };

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

export const LEVELS: Record<string, { depth: number; ms: number; noise: number }> = {
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

// --- Notation ---

const FILES = "abcdefgh";
const sqTxt = (sq: number) => `${FILES[sq & 7]}${8 - (sq >> 3)}`;

/** Standard algebraic notation for move m in position p (p is not changed). */
export function san(p: Pos, m: Move): string {
  let out = "";
  const t = m.piece.toLowerCase();
  if (m.flags & F_CASTLE) out = (m.to & 7) === 6 ? "O-O" : "O-O-O";
  else if (t === "p") {
    out = m.captured ? `${FILES[m.from & 7]}x${sqTxt(m.to)}` : sqTxt(m.to);
    if (m.promo) out += `=${m.promo.toUpperCase()}`;
  } else {
    // Disambiguate when another piece of the same kind can reach the square.
    const twins = legal(p).filter((x) => x.piece === m.piece && x.to === m.to && x.from !== m.from);
    let dis = "";
    if (twins.length) {
      const sameFile = twins.some((x) => (x.from & 7) === (m.from & 7));
      const sameRank = twins.some((x) => x.from >> 3 === m.from >> 3);
      if (!sameFile) dis = FILES[m.from & 7];
      else if (!sameRank) dis = String(8 - (m.from >> 3));
      else dis = sqTxt(m.from);
    }
    out = `${t.toUpperCase()}${dis}${m.captured ? "x" : ""}${sqTxt(m.to)}`;
  }
  const q = clonePos(p);
  make(q, m);
  if (inCheck(q)) out += legal(q).length ? "+" : "#";
  return out;
}

/** The best move for the side to play, at hint strength (no randomness). */
export function hintMove(p: Pos): Move | null {
  const q = clonePos(p);
  if (!legal(q).length) return null;
  return new Searcher(q).best(6, 700, 0);
}
