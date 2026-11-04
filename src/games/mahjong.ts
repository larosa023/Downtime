import { GameContext, GameInstance, GameModule } from "../core/types";
import { GameTimer } from "../core/timer";
import { formatTime, recordLoss, recordStart, recordWin } from "../core/stats";
import { load, remove, save } from "../core/storage";
import { sfx } from "../core/sound";
import { motionEnabled } from "../core/settings";

// Positions are in half-tile units: a tile at (x, y) covers x..x+2, y..y+2.
interface Spot {
  x: number;
  y: number;
  z: number;
}

function rect(x0: number, y0: number, cols: number, rows: number, z: number): Spot[] {
  const out: Spot[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push({ x: x0 + c * 2, y: y0 + r * 2, z });
  return out;
}

/** A 108-tile pyramid with wings: 60 + 32 + 12 + 2 on top, plus one tile on each side. */
const LAYOUT: Spot[] = [
  ...rect(0, 0, 10, 6, 0),
  ...rect(2, 2, 8, 4, 1),
  ...rect(4, 4, 6, 2, 2),
  { x: 8, y: 5, z: 3 },
  { x: 10, y: 5, z: 3 },
  { x: -2, y: 5, z: 0 },
  { x: 20, y: 5, z: 0 },
];
// 27 kinds (three suits, 1–9), four of each.
const KINDS = 27;
const SUITS = ["dots", "sticks", "stars"] as const;

const SAVE = "save:mahjong";

function overlaps(a: Spot, b: Spot) {
  return Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2;
}

/** Whether spot i is free, given the set of spots still on the board. */
function isFree(i: number, alive: (j: number) => boolean): boolean {
  const t = LAYOUT[i];
  let left = false;
  let right = false;
  for (let j = 0; j < LAYOUT.length; j++) {
    if (j === i || !alive(j)) continue;
    const u = LAYOUT[j];
    if (u.z === t.z + 1 && overlaps(t, u)) return false;
    if (u.z === t.z && Math.abs(u.y - t.y) < 2) {
      if (u.x === t.x - 2) left = true;
      if (u.x === t.x + 2) right = true;
    }
  }
  return !left || !right;
}

/**
 * Give each live spot a kind so the board can be cleared: repeatedly take two
 * free spots, give them the same kind, and remove them. Playing that removal
 * order forwards always works.
 */
function assignKinds(spots: number[], kinds: number[]): Map<number, number> | null {
  for (let attempt = 0; attempt < 300; attempt++) {
    const pairs: number[] = [];
    const counts = new Map<number, number>();
    kinds.forEach((k) => counts.set(k, (counts.get(k) ?? 0) + 1));
    for (const [k, n] of counts) for (let i = 0; i < n / 2; i++) pairs.push(k);
    pairs.sort(() => Math.random() - 0.5);
    const alive = new Set(spots);
    const result = new Map<number, number>();
    let ok = true;
    while (alive.size) {
      const free = [...alive].filter((i) => isFree(i, (j) => alive.has(j)));
      if (free.length < 2) {
        ok = false;
        break;
      }
      // Favor tiles high in the stack so lower layers don't strand.
      free.sort((a, b) => LAYOUT[b].z - LAYOUT[a].z + (Math.random() - 0.5) * 1.5);
      const a = free[0];
      const rest = free.slice(1);
      const b = rest[Math.floor(Math.random() * rest.length)];
      const k = pairs.pop()!;
      result.set(a, k);
      result.set(b, k);
      alive.delete(a);
      alive.delete(b);
    }
    if (ok) return result;
  }
  return null;
}

interface State {
  kinds: number[];
  gone: boolean[];
  shuffles: number;
}

class Mahjong implements GameInstance {
  private el: HTMLDivElement;
  private board: HTMLDivElement;
  private tiles: HTMLButtonElement[] = [];
  private s!: State;
  private history: State[] = [];
  private selected: number | null = null;
  private timer: GameTimer;
  private over = false;
  private counted = false;
  private resizeObs: ResizeObserver;

  constructor(root: HTMLElement, private ctx: GameContext) {
    this.el = document.createElement("div");
    this.el.className = "mahjong";
    this.board = document.createElement("div");
    this.board.className = "mj-board";
    this.el.appendChild(this.board);
    root.appendChild(this.el);
    LAYOUT.forEach((p, i) => {
      const b = document.createElement("button");
      b.className = "mj-tile";
      b.dataset.i = String(i);
      b.style.zIndex = String(p.z * 1000 + p.y * 20 + p.x + 50);
      b.style.setProperty("--x", String(p.x));
      b.style.setProperty("--y", String(p.y));
      b.style.setProperty("--z", String(p.z));
      this.board.appendChild(b);
      this.tiles.push(b);
    });
    this.board.addEventListener("click", (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>(".mj-tile");
      if (t) this.pick(Number(t.dataset.i));
    });
    window.addEventListener("keydown", this.onKey);
    this.timer = new GameTimer(() => this.status());
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(this.el);

    const saved = load<(State & { seconds: number; counted: boolean }) | null>(SAVE, null);
    if (saved && saved.kinds?.length === LAYOUT.length) {
      this.s = { kinds: saved.kinds, gone: saved.gone, shuffles: saved.shuffles };
      this.counted = saved.counted;
      this.timer.reset(saved.seconds);
      this.paint();
      this.status();
    } else this.newGame();
  }

  newGame() {
    if (this.counted && !this.over) recordLoss("mahjong");
    const all = [...Array(LAYOUT.length).keys()];
    const kinds = all.map((i) => Math.floor(i / 4) % KINDS);
    const map = assignKinds(all, kinds)!;
    this.s = { kinds: all.map((i) => map.get(i)!), gone: all.map(() => false), shuffles: 0 };
    this.history = [];
    this.selected = null;
    this.over = false;
    this.counted = false;
    this.timer.reset();
    this.ctx.clearEnd();
    this.paint(true);
    this.persist();
    this.status();
  }

  undo() {
    const h = this.history.pop();
    if (!h || this.over) return;
    this.s = h;
    this.selected = null;
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
    // Board spans x -2..22 (12 tiles) and y 0..12 (6 tiles), plus depth.
    const ratio = 1.32;
    const tw = Math.floor(Math.min((r.width - 60) / 12.6, (r.height - 60) / (6 * ratio + 0.6)));
    this.board.style.setProperty("--tw", `${Math.max(tw, 24)}px`);
  }

  private persist() {
    if (this.over) return remove(SAVE);
    save(SAVE, { ...this.s, seconds: this.timer.seconds, counted: this.counted });
  }

  private alive = (j: number) => !this.s.gone[j];

  private free(i: number) {
    return !this.s.gone[i] && isFree(i, this.alive);
  }

  private onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.closest?.("select, input") || e.ctrlKey || e.metaKey) return;
    if (e.key === "h" || e.key === "H") {
      e.preventDefault();
      this.hint();
    } else if (e.key === "Escape" && this.selected != null) {
      this.selected = null;
      this.paint();
    }
  };

  /** Pairs of free tiles with the same kind. */
  private matches(): [number, number][] {
    const free = LAYOUT.map((_, i) => i).filter((i) => this.free(i));
    const out: [number, number][] = [];
    for (let a = 0; a < free.length; a++)
      for (let b = a + 1; b < free.length; b++) if (this.s.kinds[free[a]] === this.s.kinds[free[b]]) out.push([free[a], free[b]]);
    return out;
  }

  hint() {
    const m = this.matches();
    if (!m.length) return;
    const [a, b] = m[Math.floor(Math.random() * m.length)];
    for (const i of [a, b]) {
      const t = this.tiles[i];
      t.classList.remove("hint");
      void t.offsetWidth;
      t.classList.add("hint");
    }
  }

  private pick(i: number) {
    if (this.over || this.s.gone[i]) return;
    if (!this.free(i)) {
      this.tiles[i].classList.remove("blocked");
      void this.tiles[i].offsetWidth;
      this.tiles[i].classList.add("blocked");
      sfx.error();
      return;
    }
    if (this.selected === i) {
      this.selected = null;
    } else if (this.selected != null && this.s.kinds[this.selected] === this.s.kinds[i]) {
      this.history.push({ kinds: this.s.kinds.slice(), gone: this.s.gone.slice(), shuffles: this.s.shuffles });
      if (this.history.length > 200) this.history.shift();
      this.s.gone[this.selected] = true;
      this.s.gone[i] = true;
      this.vanish([this.selected, i]);
      this.selected = null;
      if (!this.counted) {
        this.counted = true;
        recordStart("mahjong");
      }
      this.timer.start();
      sfx.merge();
      this.afterMatch();
      return;
    } else {
      this.selected = i;
      sfx.pick();
    }
    this.paint();
  }

  private vanish(ids: number[]) {
    for (const i of ids) {
      const t = this.tiles[i];
      if (motionEnabled()) {
        t.classList.add("leaving");
        setTimeout(() => t.classList.remove("leaving"), 320);
      }
    }
  }

  private afterMatch() {
    this.paint();
    this.status();
    if (this.s.gone.every(Boolean)) return this.win();
    if (!this.matches().length) {
      // Reshuffle what's left into a solvable arrangement.
      const live = LAYOUT.map((_, i) => i).filter((i) => !this.s.gone[i]);
      const map = assignKinds(
        live,
        live.map((i) => this.s.kinds[i]),
      );
      if (map) {
        live.forEach((i) => (this.s.kinds[i] = map.get(i)!));
        this.s.shuffles += 1;
        setTimeout(() => {
          this.ctx.toast("No pairs left, so the remaining tiles were shuffled.");
          this.paint(true);
          this.status();
        }, 350);
      } else {
        this.over = true;
        this.timer.stop();
        recordLoss("mahjong");
        this.ctx.end({ won: false, title: "No moves left", lines: ["Undo to try another pair, or start a new board."] });
      }
    }
    this.persist();
  }

  private win() {
    this.over = true;
    this.timer.stop();
    const secs = Math.round(this.timer.seconds);
    const { newBestTime } = recordWin("mahjong", secs);
    remove(SAVE);
    sfx.win();
    this.status();
    const sh = this.s.shuffles;
    setTimeout(
      () =>
        this.ctx.end({
          won: true,
          title: "Board cleared",
          lines: [`${formatTime(secs)}${newBestTime ? " — a new best" : ""}`, sh ? `${sh} shuffle${sh > 1 ? "s" : ""}` : "No shuffles needed"],
        }),
      500,
    );
  }

  private face(kind: number) {
    const suit = SUITS[Math.floor(kind / 9)];
    const n = (kind % 9) + 1;
    const glyph =
      suit === "dots"
        ? `<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="2.6"/><circle cx="10" cy="10" r="2.6" fill="currentColor"/></svg>`
        : suit === "sticks"
          ? `<svg viewBox="0 0 20 20"><rect x="7" y="1.5" width="6" height="17" rx="3" fill="currentColor"/><path d="M7 7.5h6M7 12.5h6" stroke="var(--tile)" stroke-width="1.4"/></svg>`
          : `<svg viewBox="0 0 20 20"><path d="M10 1.5l2.5 5.6 6 .6-4.5 4 1.3 6-5.3-3.1-5.3 3.1 1.3-6-4.5-4 6-.6z" fill="currentColor"/></svg>`;
    return `<span class="mj-face ${suit}"><b>${n}</b>${glyph}</span>`;
  }

  private paint(fresh = false) {
    const animate = fresh && motionEnabled();
    LAYOUT.forEach((p, i) => {
      const t = this.tiles[i];
      const gone = this.s.gone[i];
      t.hidden = gone;
      if (gone) return;
      t.innerHTML = this.face(this.s.kinds[i]);
      t.classList.toggle("free", this.free(i));
      t.classList.toggle("sel", this.selected === i);
      t.classList.remove("hint", "blocked");
      t.setAttribute("aria-label", `${SUITS[Math.floor(this.s.kinds[i] / 9)]} ${(this.s.kinds[i] % 9) + 1}${this.free(i) ? "" : ", blocked"}`);
      if (animate) {
        t.classList.remove("intro");
        void t.offsetWidth;
        t.style.animationDelay = `${p.z * 90 + (p.x + p.y) * 8}ms`;
        t.classList.add("intro");
      }
    });
    this.ctx.setUndo(this.history.length > 0 && !this.over);
  }

  private status() {
    const left = this.s ? this.s.gone.filter((g) => !g).length : LAYOUT.length;
    this.ctx.setStatus([
      { label: "Tiles", value: String(left) },
      { label: "Pairs open", value: this.s ? String(this.matches().length) : "0" },
      { label: "Time", value: formatTime(this.timer.seconds) },
    ]);
  }
}

export const mahjong: GameModule = {
  id: "mahjong",
  name: "Mahjong",
  group: "puzzles",
  blurb: "Match free tiles in pairs until the board is clear. Press H for a hint.",
  art: "mahjong",
  hasUndo: true,
  statsKey: () => "mahjong",
  create: (root, ctx) => new Mahjong(root, ctx),
};
