import { GameContext, GameInstance, GameModule } from "../core/types";
import { GameTimer } from "../core/timer";
import { formatTime, recordLoss, recordStart, recordWin } from "../core/stats";
import { sfx } from "../core/sound";

const SIZES: Record<string, [number, number]> = { small: [4, 4], medium: [6, 4], large: [6, 6] };
const COLORS = ["#d2453a", "#2e6f9e", "#2f8a52"];
const SHAPES = [
  `<circle cx="20" cy="20" r="13"/>`,
  `<rect x="8" y="8" width="24" height="24" rx="4"/>`,
  `<path d="M20 5 35 33H5z"/>`,
  `<path d="M20 4 34 20 20 36 6 20z"/>`,
  `<path d="M20 34C9 26 4 20 4 13c0-5 4-9 9-9 3 0 6 2 7 5 1-3 4-5 7-5 5 0 9 4 9 9 0 7-5 13-16 21z"/>`,
  `<path d="M20 3l4.6 10 10.9 1-8.2 7.3 2.4 10.7L20 26.5 10.3 32l2.4-10.7L4.5 14l10.9-1z"/>`,
];

class Memory implements GameInstance {
  private el: HTMLDivElement;
  private gridEl!: HTMLDivElement;
  private faces: number[] = [];
  private matched: boolean[] = [];
  private open: number[] = [];
  private turns = 0;
  private level: string;
  private timer: GameTimer;
  private over = false;
  private counted = false;
  private lock = false;
  private flipBack = 0;
  private resizeObs: ResizeObserver;

  constructor(root: HTMLElement, private ctx: GameContext) {
    this.level = ctx.option("size") in SIZES ? ctx.option("size") : "medium";
    this.el = document.createElement("div");
    this.el.className = "memory";
    root.appendChild(this.el);
    this.timer = new GameTimer(() => this.status());
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(this.el);
    this.newGame();
  }

  private get key() {
    return `memory:${this.level}`;
  }

  newGame() {
    clearTimeout(this.flipBack);
    if (this.counted && !this.over) recordLoss(this.key);
    const [cols, rows] = SIZES[this.level];
    const pairs = (cols * rows) / 2;
    const kinds = [...Array(SHAPES.length * COLORS.length).keys()].sort(() => Math.random() - 0.5).slice(0, pairs);
    this.faces = [...kinds, ...kinds].sort(() => Math.random() - 0.5);
    this.matched = this.faces.map(() => false);
    this.open = [];
    this.turns = 0;
    this.over = false;
    this.counted = false;
    this.lock = false;
    this.timer.reset();
    this.ctx.clearEnd();
    this.ctx.setUndo(false);
    this.el.innerHTML = `<div class="mem-grid" style="--cols:${cols};--rows:${rows}">${this.faces
      .map((k, i) => {
        const shape = SHAPES[k % SHAPES.length];
        const color = COLORS[Math.floor(k / SHAPES.length)];
        return `<button class="mem-card" data-i="${i}" aria-label="Hidden card" style="animation-delay:${i * 18}ms">
          <span class="mem-inner"><span class="mem-back"></span><span class="mem-face"><svg viewBox="0 0 40 40" fill="${color}">${shape}</svg></span></span>
        </button>`;
      })
      .join("")}</div>`;
    this.gridEl = this.el.querySelector(".mem-grid")!;
    this.gridEl.addEventListener("click", (e) => {
      const c = (e.target as HTMLElement).closest<HTMLElement>(".mem-card");
      if (c) this.flip(Number(c.dataset.i));
    });
    this.resize();
    this.status();
  }

  destroy() {
    clearTimeout(this.flipBack);
    this.timer.destroy();
    this.resizeObs.disconnect();
    this.el.remove();
  }

  resize() {
    const [cols, rows] = SIZES[this.level];
    const r = this.el.getBoundingClientRect();
    const cw = Math.floor(Math.min((r.width - 48) / cols, (r.height - 48) / (rows * 1.32)));
    this.el.style.setProperty("--mw", `${Math.max(48, Math.min(cw, 150))}px`);
  }

  private card(i: number) {
    return this.gridEl.children[i] as HTMLElement;
  }

  private flip(i: number) {
    if (this.over || this.matched[i] || this.open.includes(i)) return;
    if (this.lock) {
      // Clicking during the pause flips the mismatched pair back right away.
      clearTimeout(this.flipBack);
      this.hideOpen();
    }
    if (!this.counted) {
      this.counted = true;
      recordStart(this.key);
    }
    this.timer.start();
    this.open.push(i);
    this.card(i).classList.add("up");
    this.card(i).setAttribute("aria-label", "Face-up card");
    sfx.flip();
    if (this.open.length < 2) return;
    this.turns++;
    const [a, b] = this.open;
    if (this.faces[a] === this.faces[b]) {
      this.matched[a] = this.matched[b] = true;
      this.open = [];
      setTimeout(() => {
        this.card(a).classList.add("matched");
        this.card(b).classList.add("matched");
      }, 250);
      sfx.merge();
      if (this.matched.every(Boolean)) this.win();
    } else {
      this.lock = true;
      this.flipBack = window.setTimeout(() => this.hideOpen(), 850);
    }
    this.status();
  }

  private hideOpen() {
    for (const i of this.open) {
      this.card(i).classList.remove("up");
      this.card(i).setAttribute("aria-label", "Hidden card");
    }
    this.open = [];
    this.lock = false;
  }

  private win() {
    this.over = true;
    this.timer.stop();
    const secs = Math.round(this.timer.seconds);
    const { newBestTime } = recordWin(this.key, secs);
    sfx.win();
    const pairs = this.faces.length / 2;
    setTimeout(
      () =>
        this.ctx.end({
          won: true,
          title: "All matched",
          lines: [`${formatTime(secs)}${newBestTime ? " — a new best" : ""}`, `${this.turns} turns for ${pairs} pairs`],
        }),
      700,
    );
  }

  private status() {
    this.ctx.setStatus([
      { label: "Turns", value: String(this.turns) },
      { label: "Time", value: formatTime(this.timer.seconds) },
    ]);
  }
}

export const memory: GameModule = {
  id: "memory",
  name: "Memory",
  group: "puzzles",
  blurb: "Flip two cards at a time and find every matching pair.",
  art: "memory",
  hasUndo: false,
  options: [
    {
      key: "size",
      label: "Size",
      default: "medium",
      choices: [
        { value: "small", label: "8 pairs" },
        { value: "medium", label: "12 pairs" },
        { value: "large", label: "18 pairs" },
      ],
    },
  ],
  statsKey: (o) => `memory:${o("size")}`,
  create: (root, ctx) => new Memory(root, ctx),
};
