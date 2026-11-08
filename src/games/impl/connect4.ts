import { GameContext, GameInstance } from "../../core/types";
import { recordLoss, recordStart, recordWin, getStats } from "../../core/stats";
import { sfx } from "../../core/sound";
import { getSettings, motionEnabled } from "../../core/settings";

const COLS = 7;
const ROWS = 6;
const ORDER = [3, 2, 4, 1, 5, 0, 6]; // try center columns first
const DEPTH: Record<string, number> = { easy: 2, normal: 5, hard: 8 };

type Cell = 0 | 1 | 2; // empty, you, computer
type Board = Cell[][]; // [col][row], row 0 at the bottom

function lines(): [number, number][][] {
  const out: [number, number][][] = [];
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
  for (let c = 0; c < COLS; c++)
    for (let r = 0; r < ROWS; r++)
      for (const [dc, dr] of dirs) {
        const ec = c + dc * 3;
        const er = r + dr * 3;
        if (ec < 0 || ec >= COLS || er < 0 || er >= ROWS) continue;
        out.push([0, 1, 2, 3].map((k) => [c + dc * k, r + dr * k]));
      }
  return out;
}
const LINES = lines();

function winner(b: Board): { who: Cell; cells: [number, number][] } | null {
  for (const l of LINES) {
    const v = b[l[0][0]][l[0][1]];
    if (v && l.every(([c, r]) => b[c][r] === v)) return { who: v, cells: l };
  }
  return null;
}

function score(b: Board, me: Cell): number {
  const them = me === 1 ? 2 : 1;
  let s = 0;
  for (let r = 0; r < ROWS; r++) if (b[3][r] === me) s += 3;
  for (const l of LINES) {
    let m = 0;
    let t = 0;
    for (const [c, r] of l) {
      if (b[c][r] === me) m++;
      else if (b[c][r] === them) t++;
    }
    if (m && t) continue;
    if (m === 3) s += 12;
    else if (m === 2) s += 3;
    if (t === 3) s -= 14;
    else if (t === 2) s -= 3;
  }
  return s;
}

function drop(b: Board, c: number, who: Cell): number {
  const r = b[c].indexOf(0);
  if (r >= 0) b[c][r] = who;
  return r;
}

/** Whether the disc just placed at (c, r) completes four. Much cheaper than scanning the board. */
function wins(b: Board, c: number, r: number): boolean {
  const v = b[c][r];
  for (const [dc, dr] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
    let n = 1;
    for (const s of [1, -1]) {
      let cc = c + dc * s;
      let rr = r + dr * s;
      while (cc >= 0 && cc < COLS && rr >= 0 && rr < ROWS && b[cc][rr] === v) {
        n++;
        cc += dc * s;
        rr += dr * s;
      }
    }
    if (n >= 4) return true;
  }
  return false;
}

function negamax(b: Board, depth: number, alpha: number, beta: number, me: Cell, moves: number): number {
  if (moves === COLS * ROWS) return 0;
  if (depth === 0) return score(b, me);
  const them: Cell = me === 1 ? 2 : 1;
  // An immediate win ends the search at this level.
  for (const c of ORDER) {
    const r = drop(b, c, me);
    if (r < 0) continue;
    const won = wins(b, c, r);
    b[c][r] = 0;
    if (won) return 10000 + depth;
  }
  let best = -Infinity;
  for (const c of ORDER) {
    const r = drop(b, c, me);
    if (r < 0) continue;
    const v = -negamax(b, depth - 1, -beta, -alpha, them, moves + 1);
    b[c][r] = 0;
    if (v > best) best = v;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

function bestMove(b: Board, depth: number, moves: number, sloppy: boolean, me: Cell = 2): number {
  const legal = ORDER.filter((c) => b[c][ROWS - 1] === 0);
  if (sloppy && Math.random() < 0.3) return legal[Math.floor(Math.random() * legal.length)];
  const them: Cell = me === 1 ? 2 : 1;
  let best = legal[0];
  let bestV = -Infinity;
  for (const c of legal) {
    const r = drop(b, c, me);
    if (wins(b, c, r)) return c;
    const v = -negamax(b, depth - 1, -Infinity, Infinity, them, moves + 1) + (Math.random() - 0.5) * 0.5;
    b[c][r] = 0;
    if (v > bestV) {
      bestV = v;
      best = c;
    }
  }
  return best;
}

class ConnectFour implements GameInstance {
  private el: HTMLDivElement;
  private boardEl!: HTMLDivElement;
  private discs!: HTMLDivElement;
  private b: Board = [];
  private moves = 0;
  private turn: Cell = 1;
  private over = false;
  private counted = false;
  private level: string;
  private firstPlayer: Cell = 1;
  private hover = -1;
  private aiTimer = 0;
  private endTimers: number[] = [];
  /** Columns played this game, in order. */
  private played: { c: number; who: Cell }[] = [];
  private hintTimer = 0;
  private resizeObs: ResizeObserver;

  constructor(root: HTMLElement, private ctx: GameContext) {
    this.level = ctx.option("level") in DEPTH ? ctx.option("level") : "normal";
    this.el = document.createElement("div");
    this.el.className = "c4";
    this.el.innerHTML = `
      <div class="c4-wrap">
        <div class="c4-ghost"></div>
        <div class="c4-board">
          <div class="c4-discs"></div>
          <div class="c4-holes">${Array.from({ length: COLS * ROWS }, () => `<i></i>`).join("")}</div>
          <div class="c4-cols">${Array.from({ length: COLS }, (_, c) => `<button data-c="${c}" aria-label="Drop in column ${c + 1}"></button>`).join("")}</div>
        </div>
      </div>`;
    root.appendChild(this.el);
    this.boardEl = this.el.querySelector(".c4-board")!;
    this.discs = this.el.querySelector(".c4-discs")!;
    const cols = this.el.querySelector(".c4-cols")!;
    cols.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-c]");
      if (b) this.play(Number(b.dataset.c));
    });
    cols.addEventListener("pointerover", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-c]");
      this.hover = b ? Number(b.dataset.c) : -1;
      this.paintGhost();
    });
    cols.addEventListener("pointerleave", () => {
      this.hover = -1;
      this.paintGhost();
    });
    window.addEventListener("keydown", this.onKey);
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(this.el);
    this.newGame();
  }

  private get key() {
    return `connect4:${this.level}`;
  }

  inProgress() {
    return this.counted && !this.over;
  }

  requestHint() {
    if (this.over || this.turn !== 1 || !getSettings().hints) return;
    const c = bestMove(this.b.map((col) => col.slice()) as Board, DEPTH.hard, this.moves, false, 1);
    this.showHint(c);
  }

  private showHint(c: number) {
    clearTimeout(this.hintTimer);
    this.el.querySelectorAll<HTMLElement>(".c4-cols button").forEach((b, i) => b.classList.toggle("hint", i === c));
    if (c >= 0) this.hintTimer = window.setTimeout(() => this.showHint(-1), 2400);
  }

  /** Take back your last move (and the computer's reply). */
  undo() {
    let lastYou = -1;
    for (let i = this.played.length - 1; i >= 0; i--)
      if (this.played[i].who === 1) {
        lastYou = i;
        break;
      }
    if (lastYou < 0) return;
    clearTimeout(this.aiTimer);
    this.endTimers.forEach(clearTimeout);
    this.endTimers = [];
    this.showHint(-1);
    const undone = this.played.splice(lastYou);
    for (const m of undone.reverse()) {
      const r = this.b[m.c].lastIndexOf(m.who);
      if (r >= 0) this.b[m.c][r] = 0;
      this.discs.querySelector(`[data-at="${m.c},${r}"]`)?.remove();
      this.moves--;
    }
    if (this.over) {
      this.over = false;
      this.boardEl.classList.remove("done");
      this.discs.querySelectorAll(".win").forEach((d) => d.classList.remove("win"));
      this.ctx.clearEnd();
    }
    this.turn = 1;
    sfx.flip();
    this.markLast();
    this.ctx.setUndo(this.played.some((m) => m.who === 1));
    this.paintGhost();
    this.status();
  }

  private markLast() {
    this.discs.querySelectorAll(".last").forEach((d) => d.classList.remove("last"));
    const m = this.played[this.played.length - 1];
    if (!m) return;
    const r = this.b[m.c].lastIndexOf(m.who);
    this.discs.querySelector(`[data-at="${m.c},${r}"]`)?.classList.add("last");
  }

  newGame() {
    clearTimeout(this.aiTimer);
    this.showHint(-1);
    this.played = [];
    this.endTimers.forEach(clearTimeout);
    this.endTimers = [];
    if (this.counted && !this.over) recordLoss(this.key);
    this.b = Array.from({ length: COLS }, () => Array(ROWS).fill(0) as Cell[]);
    this.moves = 0;
    this.over = false;
    this.counted = false;
    this.discs.innerHTML = "";
    this.boardEl.classList.remove("done");
    this.ctx.clearEnd();
    this.ctx.setUndo(false);
    // Take turns going first from game to game.
    this.turn = this.firstPlayer;
    this.firstPlayer = this.firstPlayer === 1 ? 2 : 1;
    this.status();
    if (this.turn === 2) this.aiTimer = window.setTimeout(() => this.aiMove(), 500);
  }

  destroy() {
    clearTimeout(this.aiTimer);
    clearTimeout(this.hintTimer);
    this.endTimers.forEach(clearTimeout);
    window.removeEventListener("keydown", this.onKey);
    this.resizeObs.disconnect();
    this.el.remove();
  }

  resize() {
    const r = this.el.getBoundingClientRect();
    const cell = Math.floor(Math.min((r.width - 48) / COLS, (r.height - 48) / (ROWS + 1)));
    this.el.style.setProperty("--cell", `${Math.max(36, Math.min(cell, 96))}px`);
  }

  private onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.closest?.("select, input")) return;
    const n = Number(e.key);
    if (n >= 1 && n <= 7) {
      e.preventDefault();
      this.play(n - 1);
    }
  };

  private paintGhost() {
    const g = this.el.querySelector<HTMLElement>(".c4-ghost")!;
    const show = this.hover >= 0 && this.turn === 1 && !this.over && this.b[this.hover][ROWS - 1] === 0;
    g.classList.toggle("show", show);
    if (show) g.style.setProperty("--c", String(this.hover));
  }

  private play(c: number) {
    if (this.over || this.turn !== 1 || this.b[c][ROWS - 1] !== 0) return;
    this.showHint(-1);
    if (!this.counted) {
      this.counted = true;
      recordStart(this.key);
    }
    this.place(c, 1);
    this.ctx.setUndo(true);
    if (!this.over) {
      this.turn = 2;
      this.paintGhost();
      this.status();
      this.aiTimer = window.setTimeout(() => this.aiMove(), motionEnabled() ? 520 : 150);
    }
  }

  private aiMove() {
    if (this.over) return;
    const c = bestMove(this.b.map((col) => col.slice()) as Board, DEPTH[this.level], this.moves, this.level === "easy");
    this.place(c, 2);
    if (!this.over) {
      this.turn = 1;
      this.paintGhost();
      this.status();
    }
  }

  private place(c: number, who: Cell) {
    const r = drop(this.b, c, who);
    this.moves++;
    this.played.push({ c, who });
    const d = document.createElement("div");
    d.className = `c4-disc p${who}`;
    d.style.setProperty("--c", String(c));
    d.style.setProperty("--r", String(ROWS - 1 - r));
    d.style.setProperty("--fall", String(ROWS - r));
    d.dataset.at = `${c},${r}`;
    this.discs.appendChild(d);
    sfx.place();
    this.markLast();
    const w = winner(this.b);
    if (w) return this.finish(w.who, w.cells);
    if (this.moves === COLS * ROWS) return this.finish(0, []);
  }

  private finish(who: Cell, cells: [number, number][]) {
    this.over = true;
    this.paintGhost();
    this.endTimers.push(window.setTimeout(() => {
      for (const [c, r] of cells) this.discs.querySelector(`[data-at="${c},${r}"]`)?.classList.add("win");
      if (cells.length) this.boardEl.classList.add("done");
    }, 380));
    if (who === 1) {
      recordWin(this.key);
      sfx.win();
    } else if (who === 2) {
      recordLoss(this.key);
      sfx.lose();
    }
    this.status();
    const s = getStats(this.key);
    this.endTimers.push(window.setTimeout(
      () =>
        this.ctx.end({
          won: who === 1,
          title: who === 1 ? "You win" : who === 2 ? "The computer wins" : "It's a draw",
          lines: [`${s.won} won of ${s.played} played on ${this.level}`],
        }),
      1300,
    ));
  }

  private status() {
    this.ctx.setStatus([
      { label: "Turn", value: this.over ? "—" : this.turn === 1 ? "You" : "Computer" },
      { label: "Moves", value: String(this.moves) },
    ]);
  }
}

export function create(root: HTMLElement, ctx: GameContext): GameInstance {
  return new ConnectFour(root, ctx);
}
