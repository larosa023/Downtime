import { GameContext, GameInstance } from "../../core/types";
import { getStats, recordLoss, recordStart, recordWin } from "../../core/stats";
import { PIECE_SVG } from "./chess-pieces";
import { sfx } from "../../core/sound";
import { getSettings, motionEnabled } from "../../core/settings";
import {
  clonePos,
  colorOf,
  F_CASTLE,
  F_EP,
  inCheck,
  kingSq,
  legal,
  LEVELS,
  make,
  Move,
  parseFen,
  Pos,
  posKey,
  ROOK_HOP,
  san,
  START,
} from "./chess-engine";
import { askEngine } from "./chess-ai";

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
  san: string[];
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
  private sanList: string[] = [];
  private history: Snapshot[] = [];
  private showDots: boolean;
  private aiToken = 0;
  private hintTimer = 0;
    private movesEl!: HTMLOListElement;
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
    this.showDots = ctx.option("dots") !== "off";
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
      </div>
      <aside class="ch-side" aria-label="Moves">
        <h2 class="ch-side-title">Moves</h2>
        <ol class="ch-moves"></ol>
      </aside>`;
    root.appendChild(this.el);
    this.movesEl = this.el.querySelector(".ch-moves")!;
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

  inProgress() {
    return this.counted && !this.over;
  }

  requestHint() {
    if (!this.canAct() || !getSettings().hints) return;
    const token = this.aiToken;
    const before = this.plies;
    this.ctx.toast("Thinking…");
    void askEngine(clonePos(this.pos), this.level, true).then((m) => {
      if (token !== this.aiToken || before !== this.plies || !m) return;
      this.showHint([m.from, m.to]);
      this.ctx.toast(`Try ${san(this.pos, m)}`);
    });
  }

  private showHint(sqs: number[]) {
    clearTimeout(this.hintTimer);
    this.squares.forEach((q, i) => q.classList.toggle("hint", sqs.includes(i)));
    this.hintTimer = window.setTimeout(() => this.showHint([]), sqs.length ? 2600 : 0);
  }

  newGame() {
    clearTimeout(this.aiTimer);
    clearTimeout(this.endTimer);
    this.aiToken++;
    this.showHint([]);
    this.sanList = [];
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
    this.aiToken++;
    this.showHint([]);
    this.sanList = s.san;
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
    clearTimeout(this.hintTimer);
    this.aiToken++;
    window.removeEventListener("keydown", this.onKey);
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    this.resizeObs.disconnect();
    this.el.remove();
  }

  resize() {
    const r = this.el.getBoundingClientRect();
    // Put the move list beside the board when there's room for it.
    const side = r.width - Math.min(r.height - 120, 720) >= 300;
    this.el.classList.toggle("wide", side);
    const size = Math.floor(Math.min(r.width - 48 - (side ? 220 : 0), r.height - 120) / 8) * 8;
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
      san: this.sanList.slice(),
    };
  }

  private playerMove(m: Move) {
    this.history.push(this.snapshot());
    if (this.history.length > 300) this.history.shift();
    if (!this.counted) {
      this.counted = true;
      recordStart(this.key);
    }
    this.showHint([]);
    this.apply(m);
    if (this.over) return;
    this.thinking = true;
    this.status();
    const token = ++this.aiToken;
    const started = performance.now();
    const minWait = motionEnabled() ? 320 : 60;
    void askEngine(clonePos(this.pos), this.level).then((reply) => {
      if (token !== this.aiToken || this.over) return;
      // Let the player's piece land before the reply moves.
      const wait = Math.max(0, minWait - (performance.now() - started));
      this.aiTimer = window.setTimeout(() => this.aiMove(reply, token), wait);
    });
  }

  private aiMove(m: Move | null, token: number) {
    if (this.over || token !== this.aiToken) return;
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
    this.sanList.push(san(p, m));
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
      const t = this.showDots ? this.targets.find((m) => m.to === i) : undefined;
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
    this.renderMoves();
    this.ctx.setUndo(this.history.length > 0);
  }

  private renderMoves() {
    const rows: string[] = [];
    for (let i = 0; i < this.sanList.length; i += 2) {
      const lastRow = i + 2 >= this.sanList.length;
      rows.push(
        `<li><span class="ch-mv-n">${i / 2 + 1}.</span><span class="ch-mv${lastRow && this.sanList.length % 2 === 1 ? " now" : ""}">${this.sanList[i]}</span><span class="ch-mv${lastRow && this.sanList.length % 2 === 0 ? " now" : ""}">${this.sanList[i + 1] ?? ""}</span></li>`,
      );
    }
    const html = rows.join("") || `<li class="ch-mv-empty">White to move</li>`;
    if (this.movesEl.innerHTML !== html) {
      this.movesEl.innerHTML = html;
      this.movesEl.scrollTop = this.movesEl.scrollHeight;
    }
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
