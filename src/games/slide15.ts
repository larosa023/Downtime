import "./slide15.css";
import { GameContext, GameInstance, GameModule } from "../core/types";
import { GameTimer } from "../core/timer";
import { formatTime, recordLoss, recordStart, recordWin } from "../core/stats";
import { load, remove, save } from "../core/storage";
import { sfx } from "../core/sound";

const SIZES: Record<string, number> = { small: 3, medium: 4, large: 5 };
const SAVE = "save:slide15";

interface Saved {
  n: number;
  tiles: number[];
  moves: number;
  seconds: number;
  counted: boolean;
}

/** Shuffle by walking the gap randomly from the solved state, so the result is always solvable. */
function scramble(n: number): number[] {
  const tiles = [...Array(n * n).keys()].map((i) => (i + 1) % (n * n));
  let gap = n * n - 1;
  let prev = -1;
  const steps = n * n * n * 12;
  for (let s = 0; s < steps; s++) {
    const r = Math.floor(gap / n);
    const c = gap % n;
    const opts = [
      r > 0 ? gap - n : -1,
      r < n - 1 ? gap + n : -1,
      c > 0 ? gap - 1 : -1,
      c < n - 1 ? gap + 1 : -1,
    ].filter((x) => x >= 0 && x !== prev);
    const next = opts[Math.floor(Math.random() * opts.length)];
    tiles[gap] = tiles[next];
    tiles[next] = 0;
    prev = gap;
    gap = next;
  }
  // Park the gap in the bottom-right corner so the start looks tidy.
  while (gap % n < n - 1) {
    tiles[gap] = tiles[gap + 1];
    tiles[gap + 1] = 0;
    gap++;
  }
  while (gap < n * n - n) {
    tiles[gap] = tiles[gap + n];
    tiles[gap + n] = 0;
    gap += n;
  }
  return solved(tiles) ? scramble(n) : tiles;
}

function solved(tiles: number[]) {
  return tiles.every((v, i) => v === (i + 1) % tiles.length);
}

class Fifteen implements GameInstance {
  private el: HTMLDivElement;
  private board!: HTMLDivElement;
  private tileEls = new Map<number, HTMLButtonElement>();
  private n: number;
  private level: string;
  private tiles: number[] = [];
  private moves = 0;
  private timer: GameTimer;
  private over = false;
  private counted = false;
  private resizeObs: ResizeObserver;

  constructor(root: HTMLElement, private ctx: GameContext) {
    this.level = ctx.option("size") in SIZES ? ctx.option("size") : "medium";
    this.n = SIZES[this.level];
    this.el = document.createElement("div");
    this.el.className = "fifteen";
    root.appendChild(this.el);
    this.timer = new GameTimer(() => this.status());
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(this.el);
    window.addEventListener("keydown", this.onKey);

    const saved = load<Saved | null>(SAVE, null);
    if (saved && saved.n === this.n && saved.tiles?.length === this.n * this.n) {
      this.tiles = saved.tiles;
      this.moves = saved.moves;
      this.counted = saved.counted;
      this.timer.reset(saved.seconds);
      this.build();
      this.status();
    } else this.newGame();
  }

  private get key() {
    return `slide15:${this.level}`;
  }

  newGame() {
    if (this.counted && !this.over) recordLoss(this.key);
    this.tiles = scramble(this.n);
    this.moves = 0;
    this.over = false;
    this.counted = false;
    this.timer.reset();
    this.ctx.clearEnd();
    this.ctx.setUndo(false);
    this.build(true);
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
    const size = Math.min(r.width - 48, r.height - 48, 620);
    this.el.style.setProperty("--bsz", `${Math.max(220, size)}px`);
  }

  private persist() {
    if (this.over) return remove(SAVE);
    const data: Saved = { n: this.n, tiles: this.tiles, moves: this.moves, seconds: this.timer.seconds, counted: this.counted };
    save(SAVE, data);
  }

  private build(intro = false) {
    this.el.innerHTML = `<div class="ff-board" style="--n:${this.n}"></div>`;
    this.board = this.el.querySelector(".ff-board")!;
    this.tileEls.clear();
    for (let v = 1; v < this.n * this.n; v++) {
      const b = document.createElement("button");
      b.className = "ff-tile";
      b.textContent = String(v);
      b.dataset.v = String(v);
      // Tiles whose home is on the same row share a tint, which helps when sorting.
      b.style.setProperty("--row", String(Math.floor((v - 1) / this.n)));
      if (intro) b.style.animationDelay = `${v * 14}ms`;
      else b.classList.add("no-intro");
      this.board.appendChild(b);
      this.tileEls.set(v, b);
    }
    this.board.addEventListener("pointerdown", (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>(".ff-tile");
      if (t) this.clickTile(Number(t.dataset.v));
    });
    this.resize();
    this.paint();
  }

  private paint() {
    this.tiles.forEach((v, i) => {
      if (!v) return;
      const el = this.tileEls.get(v)!;
      el.style.setProperty("--r", String(Math.floor(i / this.n)));
      el.style.setProperty("--c", String(i % this.n));
      el.classList.toggle("home", v === i + 1);
    });
  }

  private onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.closest?.("select, input") || e.ctrlKey || e.metaKey) return;
    const gap = this.tiles.indexOf(0);
    const r = Math.floor(gap / this.n);
    const c = gap % this.n;
    // The arrow says which way a tile moves into the gap.
    let from = -1;
    if (e.key === "ArrowLeft" && c < this.n - 1) from = gap + 1;
    else if (e.key === "ArrowRight" && c > 0) from = gap - 1;
    else if (e.key === "ArrowUp" && r < this.n - 1) from = gap + this.n;
    else if (e.key === "ArrowDown" && r > 0) from = gap - this.n;
    else if (!e.key.startsWith("Arrow")) return;
    e.preventDefault();
    if (from >= 0) this.slideFrom(from);
  };

  private clickTile(v: number) {
    const i = this.tiles.indexOf(v);
    this.slideFrom(i);
  }

  /** Slide every tile between position i and the gap one step toward the gap. */
  private slideFrom(i: number) {
    if (this.over) return;
    const n = this.n;
    const gap = this.tiles.indexOf(0);
    const sameRow = Math.floor(i / n) === Math.floor(gap / n);
    const sameCol = i % n === gap % n;
    if (i === gap || (!sameRow && !sameCol)) {
      const el = this.tileEls.get(this.tiles[i]);
      if (el) {
        el.classList.remove("nudge");
        void el.offsetWidth;
        el.classList.add("nudge");
      }
      return;
    }
    const step = sameRow ? (i > gap ? 1 : -1) : i > gap ? n : -n;
    let g = gap;
    while (g !== i) {
      this.tiles[g] = this.tiles[g + step];
      this.tiles[g + step] = 0;
      g += step;
      this.moves++;
    }
    if (!this.counted) {
      this.counted = true;
      recordStart(this.key);
    }
    this.timer.start();
    sfx.tick();
    this.paint();
    this.status();
    if (solved(this.tiles)) this.win();
    else this.persist();
  }

  private win() {
    this.over = true;
    this.timer.stop();
    const secs = Math.round(this.timer.seconds);
    const { newBestTime } = recordWin(this.key, secs);
    remove(SAVE);
    sfx.win();
    this.board.classList.add("solved");
    this.status();
    setTimeout(
      () =>
        this.ctx.end({
          won: true,
          title: "Solved",
          lines: [`${formatTime(secs)}${newBestTime ? " — a new best" : ""}`, `${this.moves} moves`],
        }),
      600,
    );
  }

  private status() {
    this.ctx.setStatus([
      { label: "Moves", value: String(this.moves) },
      { label: "Time", value: formatTime(this.timer.seconds) },
    ]);
  }
}

export const slide15: GameModule = {
  id: "slide15",
  name: "Fifteen",
  group: "puzzles",
  blurb: "Slide the tiles back into order. Click a tile in the gap's row or column to move the whole line.",
  art: "slide15",
  artSvg: (() => {
    const order = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 0, 13, 14, 11, 15];
    let s = `<rect x="70" y="8" width="112" height="128" rx="10" class="sl-a-board"/>`;
    order.forEach((v, i) => {
      if (!v) return;
      const x = 76 + (i % 4) * 25.5;
      const y = 16 + Math.floor(i / 4) * 29;
      s += `<rect x="${x}" y="${y}" width="23" height="26" rx="4" class="sl-a-tile${v === i + 1 ? " home" : ""}"/><text x="${x + 11.5}" y="${y + 18}" class="sl-a-num">${v}</text>`;
    });
    return s;
  })(),
  iconSvg: `<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><path d="M14 16.5h5M17 14l2.5 2.5L17 19"/>`,
  hasUndo: false,
  options: [
    {
      key: "size",
      label: "Size",
      default: "medium",
      choices: [
        { value: "small", label: "3×3" },
        { value: "medium", label: "4×4" },
        { value: "large", label: "5×5" },
      ],
    },
  ],
  statsKey: (o) => `slide15:${o("size")}`,
  create: (root, ctx) => new Fifteen(root, ctx),
};
