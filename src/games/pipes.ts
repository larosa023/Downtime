import "./pipes.css";
import { GameContext, GameInstance, GameModule } from "../core/types";
import { GameTimer } from "../core/timer";
import { formatTime, recordLoss, recordStart, recordWin } from "../core/stats";
import { load, remove, save } from "../core/storage";
import { sfx } from "../core/sound";
import { motionEnabled } from "../core/settings";

const SIZES: Record<string, number> = { small: 5, medium: 7, large: 9 };
const SAVE = "save:pipes";
// Bits for the four sides: up, right, down, left.
const N_ = 1;
const E_ = 2;
const S_ = 4;
const W_ = 8;
const DIRS: [number, number, number, number][] = [
  [N_, -1, 0, S_],
  [E_, 0, 1, W_],
  [S_, 1, 0, N_],
  [W_, 0, -1, E_],
];

/** Rotate a side mask clockwise by `turns` quarter turns. */
const rot = (m: number, turns: number) => {
  let x = m;
  for (let t = 0; t < ((turns % 4) + 4) % 4; t++) x = ((x << 1) | (x >> 3)) & 15;
  return x;
};

/** A random spanning tree over the grid, grown outward from the center. */
function makeTree(n: number): number[] {
  const masks = Array(n * n).fill(0);
  const center = Math.floor(n / 2) * n + Math.floor(n / 2);
  const inTree = new Set([center]);
  const frontier: [number, number, number][] = []; // from, to, dirIndex
  const addEdges = (i: number) => {
    const r = Math.floor(i / n);
    const c = i % n;
    DIRS.forEach(([, dr, dc], d) => {
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nc >= 0 && nr < n && nc < n) frontier.push([i, nr * n + nc, d]);
    });
  };
  addEdges(center);
  while (inTree.size < n * n) {
    const k = Math.floor(Math.random() * frontier.length);
    const [from, to, d] = frontier[k];
    frontier.splice(k, 1);
    if (inTree.has(to)) continue;
    // Avoid four-way crossings: they can't be rotated, so they're dull.
    const bits = masks[from] | DIRS[d][0];
    if (bits === 15 && Math.random() < 0.9 && frontier.some(([f, t]) => !inTree.has(t) && f !== from)) {
      frontier.push([from, to, d]);
      continue;
    }
    masks[from] |= DIRS[d][0];
    masks[to] |= DIRS[d][3];
    inTree.add(to);
    addEdges(to);
  }
  return masks;
}

interface Saved {
  n: number;
  base: number[];
  turns: number[];
  moves: number;
  seconds: number;
  counted: boolean;
}

class Pipes implements GameInstance {
  private el: HTMLDivElement;
  private svg!: SVGSVGElement;
  private tileEls: SVGGElement[] = [];
  private n: number;
  private size: string;
  private base: number[] = [];
  private turns: number[] = [];
  private moves = 0;
  private timer: GameTimer;
  private over = false;
  private counted = false;
  private resizeObs: ResizeObserver;

  constructor(root: HTMLElement, private ctx: GameContext) {
    this.size = ctx.option("size") in SIZES ? ctx.option("size") : "medium";
    this.n = SIZES[this.size];
    this.el = document.createElement("div");
    this.el.className = "pipes";
    root.appendChild(this.el);
    this.el.addEventListener("contextmenu", (e) => e.preventDefault());
    this.timer = new GameTimer(() => this.status());
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(this.el);

    const saved = load<Saved | null>(SAVE, null);
    if (saved && saved.n === this.n && saved.base?.length === this.n * this.n) {
      this.base = saved.base;
      this.turns = saved.turns;
      this.moves = saved.moves;
      this.counted = saved.counted;
      this.timer.reset(saved.seconds);
      this.build();
      this.status();
    } else this.newGame();
  }

  private get key() {
    return `pipes:${this.size}`;
  }

  private get center() {
    return Math.floor(this.n / 2) * this.n + Math.floor(this.n / 2);
  }

  newGame() {
    if (this.counted && !this.over) recordLoss(this.key);
    this.base = makeTree(this.n);
    do {
      this.turns = this.base.map(() => Math.floor(Math.random() * 4));
    } while (this.isSolved());
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
    this.persist();
    this.timer.destroy();
    this.resizeObs.disconnect();
    this.el.remove();
  }

  resize() {
    const r = this.el.getBoundingClientRect();
    const size = Math.min(r.width - 48, r.height - 48, 680);
    this.el.style.setProperty("--bsz", `${Math.max(240, size)}px`);
  }

  private persist() {
    if (this.over) return remove(SAVE);
    const data: Saved = { n: this.n, base: this.base, turns: this.turns, moves: this.moves, seconds: this.timer.seconds, counted: this.counted };
    save(SAVE, data);
  }

  private mask(i: number) {
    return rot(this.base[i], this.turns[i]);
  }

  /** Cells reachable from the source along matching connections, and whether any pipe points nowhere. */
  private trace(): { lit: Set<number>; loose: boolean } {
    const n = this.n;
    const lit = new Set([this.center]);
    const stack = [this.center];
    while (stack.length) {
      const i = stack.pop()!;
      const r = Math.floor(i / n);
      const c = i % n;
      const m = this.mask(i);
      for (const [bit, dr, dc, back] of DIRS) {
        if (!(m & bit)) continue;
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= n || nc >= n) continue;
        const j = nr * n + nc;
        if (!lit.has(j) && this.mask(j) & back) {
          lit.add(j);
          stack.push(j);
        }
      }
    }
    let loose = false;
    for (let i = 0; i < n * n && !loose; i++) {
      const r = Math.floor(i / n);
      const c = i % n;
      const m = this.mask(i);
      for (const [bit, dr, dc, back] of DIRS) {
        if (!(m & bit)) continue;
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= n || nc >= n || !(this.mask(nr * n + nc) & back)) {
          loose = true;
          break;
        }
      }
    }
    return { lit, loose };
  }

  private isSolved() {
    const { lit, loose } = this.trace();
    return !loose && lit.size === this.n * this.n;
  }

  private build(intro = false) {
    const n = this.n;
    const ns = "http://www.w3.org/2000/svg";
    this.el.innerHTML = `<svg class="pp-board" viewBox="0 0 ${n} ${n}" role="grid" aria-label="Pipes"></svg>`;
    this.svg = this.el.querySelector("svg")!;
    let bg = "";
    for (let i = 0; i < n * n; i++) {
      const r = Math.floor(i / n);
      const c = i % n;
      bg += `<rect class="pp-cell" x="${c + 0.04}" y="${r + 0.04}" width="0.92" height="0.92" rx="0.14"/>`;
    }
    this.svg.innerHTML = `<g class="pp-bg">${bg}</g>`;
    this.tileEls = [];
    for (let i = 0; i < n * n; i++) {
      const r = Math.floor(i / n);
      const c = i % n;
      const g = document.createElementNS(ns, "g");
      g.classList.add("pp-tile");
      g.dataset.i = String(i);
      g.style.transformOrigin = `${c + 0.5}px ${r + 0.5}px`;
      const m = this.base[i];
      let body = `<rect class="pp-hit" x="${c}" y="${r}" width="1" height="1"/>`;
      const cx = c + 0.5;
      const cy = r + 0.5;
      for (const [bit, dr, dc] of DIRS) if (m & bit) body += `<line class="pp-pipe" x1="${cx}" y1="${cy}" x2="${cx + dc * 0.5}" y2="${cy + dr * 0.5}"/>`;
      body += `<circle class="pp-joint" cx="${cx}" cy="${cy}" r="0.09"/>`;
      if (i === this.center) body += `<circle class="pp-source" cx="${cx}" cy="${cy}" r="0.26"/>`;
      else if ([1, 2, 4, 8].includes(m)) body += `<circle class="pp-end" cx="${cx}" cy="${cy}" r="0.2"/>`;
      g.innerHTML = body;
      g.style.transform = `rotate(${this.turns[i] * 90}deg)`;
      if (intro && motionEnabled()) {
        g.classList.add("intro");
        g.style.animationDelay = `${(r + c) * 22}ms`;
      }
      this.svg.appendChild(g);
      this.tileEls.push(g);
    }
    this.svg.addEventListener("pointerdown", (e) => {
      const g = (e.target as Element).closest<SVGGElement>(".pp-tile");
      if (!g) return;
      e.preventDefault();
      this.turn(Number(g.dataset.i), e.button === 2 || e.shiftKey ? -1 : 1);
    });
    this.resize();
    this.paint();
  }

  private paint() {
    const { lit } = this.trace();
    this.tileEls.forEach((g, i) => g.classList.toggle("lit", lit.has(i)));
    this.svg.classList.toggle("solved", this.over);
  }

  private turn(i: number, dir: 1 | -1) {
    if (this.over) return;
    // Keep counting past 360° so the CSS transition always spins the short way.
    this.turns[i] += dir;
    this.tileEls[i].style.transform = `rotate(${this.turns[i] * 90}deg)`;
    this.moves++;
    if (!this.counted) {
      this.counted = true;
      recordStart(this.key);
    }
    this.timer.start();
    sfx.tick();
    this.paint();
    this.status();
    if (this.isSolved()) this.win();
    else this.persist();
  }

  private win() {
    this.over = true;
    this.timer.stop();
    const secs = Math.round(this.timer.seconds);
    const { newBestTime } = recordWin(this.key, secs);
    remove(SAVE);
    sfx.win();
    this.paint();
    this.status();
    setTimeout(
      () =>
        this.ctx.end({
          won: true,
          title: "All connected",
          lines: [`${formatTime(secs)}${newBestTime ? " — a new best" : ""}`, `${this.moves} turns`],
        }),
      700,
    );
  }

  private status() {
    const { lit } = this.base.length ? this.trace() : { lit: new Set() };
    this.ctx.setStatus([
      { label: "Connected", value: `${lit.size}/${this.n * this.n}` },
      { label: "Turns", value: String(this.moves) },
      { label: "Time", value: formatTime(this.timer.seconds) },
    ]);
  }
}

export const pipes: GameModule = {
  id: "pipes",
  name: "Pipes",
  group: "puzzles",
  blurb: "Rotate tiles until every pipe connects to the source with no loose ends.",
  art: "pipes",
  artSvg: `
    <g class="pp-a">
      ${[0, 1, 2, 3, 4].map((r) => [0, 1, 2, 3, 4].map((c) => `<rect x="${71 + c * 22}" y="${17 + r * 22}" width="20" height="20" rx="4" class="pp-a-cell"/>`).join("")).join("")}
      <path class="pp-a-lit" d="M126 72H104V50H82M126 72V94H148V116M126 72H148V50M104 72V94H82V116"/>
      <path class="pp-a-off" d="M148 50V28H170M82 50V28M170 72V94"/>
      <circle cx="126" cy="72" r="6.5" class="pp-a-src"/>
    </g>`,
  iconSvg: `<path d="M4 12h6a2 2 0 0 0 2-2V4"/><path d="M12 20v-4a2 2 0 0 1 2-2h6"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/>`,
  hasUndo: false,
  options: [
    {
      key: "size",
      label: "Size",
      default: "medium",
      choices: [
        { value: "small", label: "5×5" },
        { value: "medium", label: "7×7" },
        { value: "large", label: "9×9" },
      ],
    },
  ],
  statsKey: (o) => `pipes:${o("size")}`,
  create: (root, ctx) => new Pipes(root, ctx),
};
