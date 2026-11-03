import { GameContext, GameInstance, GameModule } from "../core/types";
import { getStats, recordScore, recordStart, recordWin } from "../core/stats";
import { load, remove, save } from "../core/storage";
import { sfx } from "../core/sound";

interface Tile {
  id: number;
  value: number;
  r: number;
  c: number;
}

interface Snapshot {
  tiles: Tile[];
  score: number;
}

const N = 4;
const SAVE = "save:2048";
const KEY_DIRS: Record<string, [number, number]> = {
  ArrowUp: [-1, 0], KeyW: [-1, 0],
  ArrowDown: [1, 0], KeyS: [1, 0],
  ArrowLeft: [0, -1], KeyA: [0, -1],
  ArrowRight: [0, 1], KeyD: [0, 1],
};

class Game2048 implements GameInstance {
  private el: HTMLDivElement;
  private board: HTMLDivElement;
  private layer: HTMLDivElement;
  private tiles: Tile[] = [];
  private tileEls = new Map<number, HTMLDivElement>();
  private nextId = 1;
  private score = 0;
  private history: Snapshot[] = [];
  private over = false;
  private reached = false;
  private counted = false;
  private busy = false;
  private touch: { x: number; y: number } | null = null;
  private resizeObs: ResizeObserver;

  constructor(root: HTMLElement, private ctx: GameContext) {
    this.el = document.createElement("div");
    this.el.className = "g2048";
    this.board = document.createElement("div");
    this.board.className = "g2048-board";
    for (let i = 0; i < N * N; i++) {
      const b = document.createElement("div");
      b.className = "g2048-bg";
      this.board.appendChild(b);
    }
    this.layer = document.createElement("div");
    this.layer.className = "g2048-layer";
    this.board.appendChild(this.layer);
    this.el.appendChild(this.board);
    root.appendChild(this.el);
    window.addEventListener("keydown", this.onKey);
    this.board.addEventListener("pointerdown", (e) => (this.touch = { x: e.clientX, y: e.clientY }));
    this.board.addEventListener("pointerup", this.onSwipe);
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(this.el);
    const saved = load<(Snapshot & { reached: boolean; counted: boolean }) | null>(SAVE, null);
    if (saved && saved.tiles.length) {
      this.tiles = saved.tiles;
      this.score = saved.score;
      this.reached = saved.reached;
      this.counted = saved.counted;
      this.nextId = Math.max(...this.tiles.map((t) => t.id)) + 1;
      this.renderAll(false);
      this.status();
    } else this.newGame();
  }

  newGame() {
    if (this.counted) recordScore("2048", this.score);
    this.tiles = [];
    this.layer.innerHTML = "";
    this.tileEls.clear();
    this.score = 0;
    this.history = [];
    this.over = false;
    this.reached = false;
    this.counted = false;
    this.ctx.clearEnd();
    this.spawn();
    this.spawn();
    this.renderAll(true);
    this.persist();
    this.status();
  }

  undo() {
    const s = this.history.pop();
    if (!s || this.busy) return;
    this.tiles = s.tiles.map((t) => ({ ...t }));
    this.score = s.score;
    if (this.over) {
      this.over = false;
      this.ctx.clearEnd();
    }
    this.layer.innerHTML = "";
    this.tileEls.clear();
    this.renderAll(false);
    sfx.flip();
    this.persist();
    this.status();
  }

  destroy() {
    window.removeEventListener("keydown", this.onKey);
    this.resizeObs.disconnect();
    this.persist();
    this.el.remove();
  }

  resize() {
    const s = Math.min(this.el.clientWidth - 32, this.el.clientHeight - 32, 560);
    this.board.style.setProperty("--board", `${Math.max(s, 220)}px`);
  }

  private persist() {
    if (this.over) return remove(SAVE);
    save(SAVE, { tiles: this.tiles, score: this.score, reached: this.reached, counted: this.counted });
  }

  private spawn() {
    const free: [number, number][] = [];
    for (let r = 0; r < N; r++)
      for (let c = 0; c < N; c++) if (!this.tiles.some((t) => t.r === r && t.c === c)) free.push([r, c]);
    if (!free.length) return;
    const [r, c] = free[Math.floor(Math.random() * free.length)];
    this.tiles.push({ id: this.nextId++, value: Math.random() < 0.9 ? 2 : 4, r, c });
  }

  private onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.closest?.("select, input")) return;
    const d = KEY_DIRS[e.code];
    if (!d) return;
    e.preventDefault();
    this.move(d[0], d[1]);
  };

  private onSwipe = (e: PointerEvent) => {
    if (!this.touch) return;
    const dx = e.clientX - this.touch.x;
    const dy = e.clientY - this.touch.y;
    this.touch = null;
    if (Math.hypot(dx, dy) < 30) return;
    if (Math.abs(dx) > Math.abs(dy)) this.move(0, dx > 0 ? 1 : -1);
    else this.move(dy > 0 ? 1 : -1, 0);
  };

  private move(dr: number, dc: number) {
    if (this.over || this.busy) return;
    const grid: (Tile | null)[][] = Array.from({ length: N }, () => Array(N).fill(null));
    for (const t of this.tiles) grid[t.r][t.c] = t;
    const before = this.tiles.map((t) => ({ ...t }));
    const order = [...Array(N).keys()];
    if (dr > 0 || dc > 0) order.reverse();

    const merged: { into: Tile; from: Tile }[] = [];
    const mergedIds = new Set<number>();
    let moved = false;
    let gained = 0;

    for (const a of order) {
      for (const b of order) {
        const r = dr ? a : b;
        const c = dr ? b : a;
        const t = grid[r][c];
        if (!t) continue;
        let nr = r;
        let nc = c;
        while (true) {
          const tr = nr + dr;
          const tc = nc + dc;
          if (tr < 0 || tc < 0 || tr >= N || tc >= N) break;
          const other = grid[tr][tc];
          if (!other) {
            nr = tr;
            nc = tc;
            continue;
          }
          if (other.value === t.value && !mergedIds.has(other.id)) {
            merged.push({ into: other, from: t });
            mergedIds.add(other.id);
            grid[r][c] = null;
            t.r = tr;
            t.c = tc;
            moved = true;
            gained += t.value * 2;
            nr = -1;
          }
          break;
        }
        if (nr === -1) continue;
        if (nr !== r || nc !== c) {
          grid[r][c] = null;
          grid[nr][nc] = t;
          t.r = nr;
          t.c = nc;
          moved = true;
        }
      }
    }
    if (!moved) return;

    if (!this.counted) {
      this.counted = true;
      recordStart("2048");
    }
    this.history.push({ tiles: before, score: this.score });
    if (this.history.length > 50) this.history.shift();
    this.score += gained;
    this.busy = true;

    // Slide every tile, then resolve merges once the slide lands.
    this.renderAll(false);
    if (gained) sfx.merge();
    else sfx.tick();
    setTimeout(() => {
      for (const { into, from } of merged) {
        into.value *= 2;
        this.tiles = this.tiles.filter((t) => t !== from);
        this.tileEls.get(from.id)?.remove();
        this.tileEls.delete(from.id);
        const el = this.tileEls.get(into.id);
        if (el) {
          this.paintTile(el, into);
          el.classList.remove("pop", "spawn");
          void el.offsetWidth;
          el.classList.add("pop");
        }
        if (into.value === 2048 && !this.reached) {
          this.reached = true;
          recordWin("2048");
          sfx.win();
          this.ctx.toast("2048! Keep going for a higher score.");
        }
      }
      this.spawn();
      this.renderAll(true);
      this.busy = false;
      this.status();
      if (!this.canMove()) this.gameOver();
      this.persist();
    }, 110);
    this.status();
  }

  private canMove() {
    if (this.tiles.length < N * N) return true;
    const at = (r: number, c: number) => this.tiles.find((t) => t.r === r && t.c === c)?.value;
    for (let r = 0; r < N; r++)
      for (let c = 0; c < N; c++) {
        const v = at(r, c);
        if (v === at(r + 1, c) || v === at(r, c + 1)) return true;
      }
    return false;
  }

  private gameOver() {
    this.over = true;
    const { newBest } = recordScore("2048", this.score);
    this.counted = false;
    sfx.lose();
    const top = Math.max(...this.tiles.map((t) => t.value));
    this.ctx.end({
      won: this.reached,
      title: "No moves left",
      lines: [`Score ${this.score}${newBest ? " — a new best" : ""}`, `Highest tile ${top}`],
    });
    this.status();
  }

  private paintTile(el: HTMLDivElement, t: Tile) {
    el.textContent = String(t.value);
    el.dataset.v = String(Math.min(t.value, 4096));
    el.classList.toggle("small", t.value >= 1024);
  }

  private renderAll(spawnAnim: boolean) {
    for (const t of this.tiles) {
      let el = this.tileEls.get(t.id);
      if (!el) {
        el = document.createElement("div");
        el.className = "g2048-tile";
        if (spawnAnim) el.classList.add("spawn");
        this.layer.appendChild(el);
        this.tileEls.set(t.id, el);
        el.style.setProperty("--r", String(t.r));
        el.style.setProperty("--c", String(t.c));
        void el.offsetWidth;
      }
      this.paintTile(el, t);
      el.style.setProperty("--r", String(t.r));
      el.style.setProperty("--c", String(t.c));
    }
  }

  private status() {
    const best = Math.max(getStats("2048").bestScore ?? 0, this.score);
    this.ctx.setStatus([
      { label: "Score", value: String(this.score) },
      { label: "Best", value: String(best) },
    ]);
    this.ctx.setUndo(this.history.length > 0 && !this.busy);
  }
}

export const g2048: GameModule = {
  id: "2048",
  name: "2048",
  group: "puzzles",
  blurb: "Slide tiles together. Match numbers until you reach 2048.",
  art: "2048",
  hasUndo: true,
  statsKey: () => "2048",
  create: (root, ctx) => new Game2048(root, ctx),
};
