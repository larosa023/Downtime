import { GameContext, GameInstance } from "../../core/types";
import { recordScore, recordStart, getStats } from "../../core/stats";
import { sfx } from "../../core/sound";
import { GameLoop, fitCanvas, watchDpr } from "./arcade-loop";

type P = { x: number; y: number };
const DIRS: Record<string, P> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};
const KEYS: Record<string, string> = {
  ArrowUp: "up", KeyW: "up",
  ArrowDown: "down", KeyS: "down",
  ArrowLeft: "left", KeyA: "left",
  ArrowRight: "right", KeyD: "right",
};
const SPEEDS: Record<string, number> = { relaxed: 135, normal: 95, fast: 65 };
const SIZES: Record<string, [number, number]> = { small: [20, 13], normal: [26, 17], large: [34, 22] };

class Snake implements GameInstance {
  private wrap: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private overlay: HTMLDivElement;
  private snake: P[] = [];
  private prev: P[] = [];
  private dir: P = DIRS.right;
  private queue: P[] = [];
  private food: P = { x: 0, y: 0 };
  private score = 0;
  private state: "ready" | "playing" | "paused" | "over" = "ready";
  private loop: GameLoop;
  private stepMs: number;
  private cols: number;
  private rows: number;
  private sizeKey: string;
  private shellPaused = false;
  private resumeAfterShell = false;
  private offDpr: () => void;
  private walls: boolean;
  private speed: string;
  private eatAt = -1e9;
  private colors: Record<string, string> = {};
  private resizeObs: ResizeObserver;
  private themeObs: MutationObserver;
  private touch: P | null = null;

  constructor(root: HTMLElement, private ctx: GameContext) {
    this.speed = ctx.option("speed") in SPEEDS ? ctx.option("speed") : "normal";
    this.stepMs = SPEEDS[this.speed];
    this.walls = ctx.option("walls") !== "wrap";
    this.sizeKey = ctx.option("size") in SIZES ? ctx.option("size") : "normal";
    [this.cols, this.rows] = SIZES[this.sizeKey];
    this.loop = new GameLoop({ hz: 1000 / this.stepMs, step: () => this.step(), draw: (a) => this.draw(a) });
    this.wrap = document.createElement("div");
    this.wrap.className = "snake";
    this.canvas = document.createElement("canvas");
    this.canvas.className = "snake-canvas";
    this.overlay = document.createElement("div");
    this.overlay.className = "snake-overlay";
    this.wrap.append(this.canvas, this.overlay);
    root.appendChild(this.wrap);
    this.g = this.canvas.getContext("2d")!;
    window.addEventListener("keydown", this.onKey);
    this.canvas.addEventListener("pointerdown", this.onTouchStart);
    this.canvas.addEventListener("pointerup", this.onTouchEnd);
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(this.wrap);
    this.themeObs = new MutationObserver(() => {
      this.readColors();
      this.loop.redraw();
    });
    this.themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style"] });
    this.offDpr = watchDpr(() => this.resize());
    this.readColors();
    this.newGame();
  }

  private get key() {
    const base = `snake:${this.speed}:${this.walls ? "walls" : "wrap"}`;
    return this.sizeKey === "normal" ? base : `${base}:${this.sizeKey}`;
  }

  newGame() {
    const y = Math.floor(this.rows / 2);
    this.snake = [{ x: 6, y }, { x: 5, y }, { x: 4, y }, { x: 3, y }];
    this.prev = this.snake.map((p) => ({ ...p }));
    this.dir = DIRS.right;
    this.queue = [];
    this.score = 0;
    this.loop.stop();
    this.state = "ready";
    this.resumeAfterShell = false;
    this.placeFood();
    this.ctx.clearEnd();
    this.ctx.setUndo(false);
    this.showOverlay("Press an arrow key or WASD to start", "Space pauses");
    this.status();
    this.loop.redraw();
  }

  inProgress() {
    return this.state === "playing" || this.state === "paused";
  }

  setPaused(paused: boolean) {
    if (paused === this.shellPaused) return;
    this.shellPaused = paused;
    if (paused) {
      this.resumeAfterShell = this.state === "playing";
      if (this.state === "playing") this.pause();
    } else if (this.resumeAfterShell && this.state === "paused") {
      this.resumeAfterShell = false;
      this.play();
    }
  }

  destroy() {
    this.loop.stop();
    this.offDpr();
    window.removeEventListener("keydown", this.onKey);
    this.resizeObs.disconnect();
    this.themeObs.disconnect();
    this.wrap.remove();
  }

  private readColors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n: string) => cs.getPropertyValue(n).trim();
    this.colors = {
      board: v("--board"),
      grid: v("--board-line"),
      snake: v("--accent"),
      head: v("--accent-strong"),
      food: v("--danger"),
      eye: v("--board"),
      wall: v("--line"),
    };
  }

  resize() {
    const r = this.wrap.getBoundingClientRect();
    const cell = Math.max(4, Math.floor(Math.min((r.width - 32) / this.cols, (r.height - 32) / this.rows)));
    const dpr = fitCanvas(this.canvas, cell * this.cols, cell * this.rows);
    this.g.setTransform(dpr * cell, 0, 0, dpr * cell, 0, 0); // draw in grid units
    this.loop.redraw();
  }

  private placeFood() {
    const COLS = this.cols;
    const taken = new Set(this.snake.map((p) => p.y * COLS + p.x));
    const free: number[] = [];
    for (let i = 0; i < COLS * this.rows; i++) if (!taken.has(i)) free.push(i);
    const k = free[Math.floor(Math.random() * free.length)];
    this.food = { x: k % COLS, y: Math.floor(k / COLS) };
  }

  private onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.closest?.("select, input")) return;
    if (e.code === "Space") {
      e.preventDefault();
      if (this.shellPaused) return;
      if (this.state === "playing") this.pause();
      else if (this.state === "paused") this.play();
      else if (this.state === "over") this.newGame();
      return;
    }
    const d = KEYS[e.code];
    if (!d) return;
    e.preventDefault();
    this.turn(DIRS[d]);
  };

  private onTouchStart = (e: PointerEvent) => {
    this.touch = { x: e.clientX, y: e.clientY };
  };

  private onTouchEnd = (e: PointerEvent) => {
    if (!this.touch) return;
    const dx = e.clientX - this.touch.x;
    const dy = e.clientY - this.touch.y;
    this.touch = null;
    if (Math.hypot(dx, dy) < 24) {
      if (this.state === "playing") this.pause();
      else if (this.state === "paused") this.play();
      return;
    }
    this.turn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? DIRS.right : DIRS.left) : dy > 0 ? DIRS.down : DIRS.up);
  };

  private turn(d: P) {
    if (this.state === "over" || this.shellPaused) return;
    const last = this.queue[this.queue.length - 1] ?? this.dir;
    if (d.x === -last.x && d.y === -last.y) return; // no reversing into yourself
    if (d.x === last.x && d.y === last.y && this.state === "playing") return;
    if (this.queue.length < 3) this.queue.push(d);
    if (this.state === "ready") {
      recordStart(this.key);
      this.play();
    } else if (this.state === "paused") this.play();
  }

  private play() {
    this.state = "playing";
    this.hideOverlay();
    this.loop.start();
  }

  private pause() {
    this.state = "paused";
    this.loop.stop();
    this.loop.redraw();
    this.showOverlay("Paused", "Press Space to keep going");
  }

  private showOverlay(title: string, sub: string) {
    this.overlay.innerHTML = `<p class="snake-title">${title}</p><p class="snake-sub">${sub}</p>`;
    this.overlay.classList.add("show");
  }

  private hideOverlay() {
    this.overlay.classList.remove("show");
  }

  private step() {
    if (this.queue.length) this.dir = this.queue.shift()!;
    const head = this.snake[0];
    let nx = head.x + this.dir.x;
    let ny = head.y + this.dir.y;
    const COLS = this.cols;
    const ROWS = this.rows;
    if (!this.walls) {
      nx = (nx + COLS) % COLS;
      ny = (ny + ROWS) % ROWS;
    }
    const eating = nx === this.food.x && ny === this.food.y;
    const body = eating ? this.snake : this.snake.slice(0, -1);
    const hitWall = nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS;
    if (hitWall || body.some((p) => p.x === nx && p.y === ny)) return this.gameOver();
    this.prev = this.snake.map((p) => ({ ...p }));
    this.snake = [{ x: nx, y: ny }, ...body];
    if (eating) {
      this.score += 1;
      this.eatAt = performance.now();
      sfx.eat();
      if (this.snake.length >= COLS * ROWS) return this.gameOver(true);
      this.placeFood();
      this.status();
    }
  }

  private gameOver(filled = false) {
    this.state = "over";
    this.loop.stop();
    this.loop.redraw();
    const { newBest } = recordScore(this.key, this.score);
    sfx.lose();
    this.status();
    this.ctx.end({
      won: filled,
      title: filled ? "You filled the board" : "Game over",
      lines: [`Score ${this.score}${newBest ? " — a new best" : ""}`, `Best ${getStats(this.key).bestScore ?? 0}`],
    });
  }

  private status() {
    this.ctx.setStatus([
      { label: "Score", value: String(this.score) },
      { label: "Best", value: String(Math.max(getStats(this.key).bestScore ?? 0, this.score)) },
    ]);
  }

  private draw(alpha: number) {
    const COLS = this.cols;
    const ROWS = this.rows;
    const t = this.state === "playing" ? alpha : this.state === "ready" ? 0 : 1;
    const g = this.g;
    const c = this.colors;
    g.clearRect(0, 0, COLS, ROWS);
    g.fillStyle = c.board;
    g.fillRect(0, 0, COLS, ROWS);
    // Dot grid
    g.fillStyle = c.grid;
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) {
        g.beginPath();
        g.arc(x + 0.5, y + 0.5, 0.05, 0, Math.PI * 2);
        g.fill();
      }

    // Food, gently breathing
    const pulse = this.state === "playing" ? 0.3 + Math.sin(performance.now() / 260) * 0.03 : 0.3;
    g.fillStyle = c.food;
    g.beginPath();
    g.arc(this.food.x + 0.5, this.food.y + 0.5, pulse, 0, Math.PI * 2);
    g.fill();

    // Snake body as one thick rounded stroke through interpolated points.
    // The head slides from its previous cell, the tail slides toward the next
    // body cell, and everything between stays on the grid.
    const lerp = (a: P, b: P): P =>
      Math.abs(a.x - b.x) > 1 || Math.abs(a.y - b.y) > 1
        ? { x: b.x + 0.5, y: b.y + 0.5 }
        : { x: a.x + (b.x - a.x) * t + 0.5, y: a.y + (b.y - a.y) * t + 0.5 };
    const n = this.snake.length;
    const head = lerp(this.prev[0] ?? this.snake[0], this.snake[0]);
    const full: P[] = [head, ...this.snake.slice(1).map((p) => ({ x: p.x + 0.5, y: p.y + 0.5 }))];
    if (this.prev.length === n) full.push(lerp(this.prev[n - 1], this.snake[n - 1]));
    const pts = [head];

    g.lineCap = "round";
    g.lineJoin = "round";
    g.strokeStyle = c.snake;
    const eatPulse = Math.max(0, 1 - (performance.now() - this.eatAt) / 270);
    g.lineWidth = 0.66 + eatPulse * 0.08;
    g.beginPath();
    for (let i = 0; i < full.length; i++) {
      const p = full[i];
      const q = full[i - 1];
      if (!q || Math.abs(p.x - q.x) > 1.5 || Math.abs(p.y - q.y) > 1.5) g.moveTo(p.x, p.y);
      else g.lineTo(p.x, p.y);
    }
    g.stroke();

    // Head and eyes
    const h = pts[0];
    g.fillStyle = c.head;
    g.beginPath();
    g.arc(h.x, h.y, 0.42, 0, Math.PI * 2);
    g.fill();
    const d = this.queue[0] && this.state === "ready" ? this.queue[0] : this.dir;
    const px = -d.y;
    const py = d.x;
    g.fillStyle = c.eye;
    for (const s of [-1, 1]) {
      g.beginPath();
      g.arc(h.x + d.x * 0.14 + px * 0.17 * s, h.y + d.y * 0.14 + py * 0.17 * s, 0.075, 0, Math.PI * 2);
      g.fill();
    }

    if (this.walls) {
      g.strokeStyle = c.wall;
      g.lineWidth = 0.08;
      g.strokeRect(0.04, 0.04, COLS - 0.08, ROWS - 0.08);
    }
  }
}

export function create(root: HTMLElement, ctx: GameContext): GameInstance {
  return new Snake(root, ctx);
}
