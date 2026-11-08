import { GameContext, GameInstance } from "../../core/types";
import { getStats, recordScore, recordStart } from "../../core/stats";
import { sfx } from "../../core/sound";
import { GameLoop, fitCanvas, watchDpr } from "./arcade-loop";

// Logical playfield; the canvas scales it to fit.
const FW = 800;
const FH = 560;
const COLS = 12;
const BRICK_H = 22;
const BRICK_GAP = 6;
const TOP = 70;
const PADDLE_Y = FH - 40;
const BALL_R = 8;
const ROW_COLORS = ["#ef6f6c", "#f2994a", "#f2c14e", "#62c27a", "#4cc3d9", "#5b8def", "#a77bd8"];

interface Brick {
  x: number;
  y: number;
  w: number;
  h: number;
  hp: number;
  row: number;
  hit: number; // flash timer
}

interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  stuck: boolean;
}

type PowerKind = "wide" | "multi" | "slow" | "life";
const POWER_INFO: Record<PowerKind, { label: string; color: string; weight: number }> = {
  wide: { label: "W", color: "#5b8def", weight: 4 },
  multi: { label: "3", color: "#a77bd8", weight: 3 },
  slow: { label: "S", color: "#62c27a", weight: 3 },
  life: { label: "+", color: "#ef6f6c", weight: 1 },
};
const POWER_NAMES: Record<PowerKind, string> = { wide: "Wide paddle", multi: "Three balls", slow: "Slow ball", life: "Extra ball" };

/** A few layouts; later levels cycle with tougher bricks. */
const PATTERNS: ((r: number, c: number) => number)[] = [
  () => 1,
  (r, c) => ((r + c) % 2 === 0 ? 1 : 0) || (r < 2 ? 1 : 0),
  (r, c) => (Math.abs(c - 5.5) < 6 - r ? 1 : 0),
  (r, c) => (c === 0 || c === 11 || r === 0 ? 2 : (c + r) % 3 === 0 ? 0 : 1),
  (r) => (r % 2 === 0 ? 2 : 1),
  // Diamond
  (r, c) => (Math.abs(c - 5.5) + Math.abs(r - 3) <= 6 ? (Math.abs(c - 5.5) + Math.abs(r - 3) <= 2 ? 2 : 1) : 0),
  // Columns with gaps
  (r, c) => (c % 3 === 1 ? 0 : r === 0 ? 2 : 1),
  // Checkerboard of tough bricks
  (r, c) => ((r + c) % 2 === 0 ? 2 : 1),
  // Smile
  (r, c) => ((r === 1 && (c === 3 || c === 8)) || (r === 4 && c > 2 && c < 9) || (r === 3 && (c === 2 || c === 9)) ? 2 : r === 0 || r === 6 ? 1 : 0),
];

class Breakout implements GameInstance {
  private wrap: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private overlay: HTMLDivElement;
  private scale = 1;
  private bricks: Brick[] = [];
  private paddle = { x: FW / 2, w: 110, target: FW / 2 };
  private balls: Ball[] = [];
  private loop: GameLoop;
  private powerups = true;
  private drops: { x: number; y: number; kind: PowerKind }[] = [];
  /** Seconds left on timed power-ups. */
  private wideT = 0;
  private slowT = 0;
  private shellPaused = false;
  private resumeAfterShell = false;
  private offDpr: () => void;
  private speed = 380;
  private lives = 3;
  private score = 0;
  private level = 1;
  private state: "ready" | "playing" | "paused" | "over" = "ready";
  private keys = new Set<string>();
  private particles: { x: number; y: number; vx: number; vy: number; life: number; color: string }[] = [];
  private colors: Record<string, string> = {};
  private resizeObs: ResizeObserver;
  private themeObs: MutationObserver;
  private started = false;

  constructor(root: HTMLElement, private ctx: GameContext) {
    this.powerups = ctx.option("powerups") !== "off";
    this.loop = new GameLoop({ hz: 120, step: (dt) => this.update(dt), draw: () => this.draw() });
    this.wrap = document.createElement("div");
    this.wrap.className = "breakout";
    this.canvas = document.createElement("canvas");
    this.canvas.className = "breakout-canvas";
    this.overlay = document.createElement("div");
    this.overlay.className = "snake-overlay";
    this.wrap.append(this.canvas, this.overlay);
    root.appendChild(this.wrap);
    this.g = this.canvas.getContext("2d")!;
    window.addEventListener("keydown", this.onDown);
    window.addEventListener("keyup", this.onUp);
    this.canvas.addEventListener("pointermove", this.onPointer);
    this.canvas.addEventListener("pointerdown", this.onClick);
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

  inProgress() {
    return this.started && this.state !== "over";
  }

  setPaused(paused: boolean) {
    if (paused === this.shellPaused) return;
    this.shellPaused = paused;
    if (paused) {
      this.resumeAfterShell = this.state === "playing";
      if (this.state === "playing") this.pause();
      else this.loop.stop();
    } else if (this.resumeAfterShell && this.state === "paused") {
      this.resumeAfterShell = false;
      this.resume();
    }
  }

  private pause() {
    this.state = "paused";
    this.keys.clear();
    this.loop.stop();
    this.loop.redraw();
    this.show("Paused", "Press Space to keep going");
  }

  /** Wake the loop for paddle movement while waiting to launch. */
  private wake() {
    if (this.state === "ready" && !this.shellPaused) this.loop.start();
  }

  newGame() {
    this.lives = 3;
    this.score = 0;
    this.level = 1;
    this.started = false;
    this.wideT = 0;
    this.slowT = 0;
    this.drops = [];
    this.particles = [];
    this.loop.stop();
    this.buildLevel();
    this.state = "ready";
    this.ctx.clearEnd();
    this.ctx.setUndo(false);
    this.show("Click or press Space to launch", "Move with the mouse or arrow keys");
    this.status();
    this.loop.redraw();
  }

  destroy() {
    this.loop.stop();
    this.offDpr();
    window.removeEventListener("keydown", this.onDown);
    window.removeEventListener("keyup", this.onUp);
    this.resizeObs.disconnect();
    this.themeObs.disconnect();
    this.wrap.remove();
  }

  resize() {
    const r = this.wrap.getBoundingClientRect();
    this.scale = Math.min((r.width - 40) / FW, (r.height - 40) / FH);
    this.scale = Math.max(0.2, this.scale);
    const dpr = fitCanvas(this.canvas, FW * this.scale, FH * this.scale);
    this.g.setTransform(dpr * this.scale, 0, 0, dpr * this.scale, 0, 0);
    this.loop.redraw();
  }

  private readColors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n: string) => cs.getPropertyValue(n).trim();
    this.colors = { board: v("--board"), ink: v("--ink"), accent: v("--accent"), strong: v("--accent-strong"), muted: v("--muted"), line: v("--board-line") };
  }

  private show(title: string, sub: string) {
    this.overlay.innerHTML = `<p class="snake-title">${title}</p><p class="snake-sub">${sub}</p>`;
    this.overlay.classList.add("show");
  }

  private hide() {
    this.overlay.classList.remove("show");
  }

  private buildLevel() {
    const pattern = PATTERNS[(this.level - 1) % PATTERNS.length];
    const rows = Math.min(5 + Math.floor((this.level - 1) / 2), 7);
    const bw = (FW - 40 - BRICK_GAP * (COLS - 1)) / COLS;
    const extraHp = Math.floor((this.level - 1) / PATTERNS.length);
    this.bricks = [];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < COLS; c++) {
        const hp = pattern(r, c);
        if (!hp) continue;
        this.bricks.push({ x: 20 + c * (bw + BRICK_GAP), y: TOP + r * (BRICK_H + BRICK_GAP), w: bw, h: BRICK_H, hp: hp + extraHp, row: r, hit: 0 });
      }
    this.speed = 380 + (this.level - 1) * 30;
    this.drops = [];
    this.wideT = 0;
    this.slowT = 0;
    this.updatePaddleWidth();
    this.resetBall();
  }

  private updatePaddleWidth() {
    const base = Math.max(80, 116 - (this.level - 1) * 4);
    this.paddle.w = this.wideT > 0 ? base * 1.5 : base;
  }

  private resetBall() {
    this.balls = [{ x: this.paddle.x, y: PADDLE_Y - BALL_R - 2, vx: 0, vy: 0, stuck: true }];
  }

  private launch() {
    const ball = this.balls[0];
    if (!ball || !ball.stuck) return;
    if (!this.started) {
      this.started = true;
      recordStart("breakout");
    }
    const a = (-Math.PI / 2) + (Math.random() - 0.5) * 0.6;
    ball.vx = Math.cos(a) * this.speed;
    ball.vy = Math.sin(a) * this.speed;
    ball.stuck = false;
    this.state = "playing";
    this.hide();
    this.loop.start();
  }

  private onPointer = (e: PointerEvent) => {
    const r = this.canvas.getBoundingClientRect();
    this.paddle.target = ((e.clientX - r.left) / r.width) * FW;
    this.wake();
  };

  private onClick = () => {
    if (this.state === "over" || this.shellPaused) return;
    if (this.state === "paused") return this.resume();
    this.launch();
  };

  private resume() {
    this.state = "playing";
    this.hide();
    this.loop.start();
  }

  private onDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.closest?.("select, input") || e.ctrlKey || e.metaKey) return;
    const k = e.code;
    if (k === "ArrowLeft" || k === "ArrowRight" || k === "KeyA" || k === "KeyD") {
      e.preventDefault();
      this.keys.add(k);
      this.wake();
    } else if (k === "Space") {
      e.preventDefault();
      if (this.shellPaused) return;
      if (this.state === "playing" && !this.balls[0]?.stuck) this.pause();
      else if (this.state === "paused") this.resume();
      else if (this.state !== "over") this.launch();
    } else if (k === "Escape") {
      if (this.shellPaused) return;
      if (this.state === "playing") this.pause();
      else if (this.state === "paused") this.resume();
    }
  };

  private onUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private update(dt: number) {
    if (this.state !== "playing" && this.state !== "ready") return;
    // Paddle: keys nudge the target, then the paddle eases toward it.
    const dir = (this.keys.has("ArrowRight") || this.keys.has("KeyD") ? 1 : 0) - (this.keys.has("ArrowLeft") || this.keys.has("KeyA") ? 1 : 0);
    if (dir) this.paddle.target = this.paddle.x + dir * 900 * dt * 4;
    const half = this.paddle.w / 2;
    this.paddle.target = Math.max(half, Math.min(FW - half, this.paddle.target));
    const maxStep = 1400 * dt;
    const d = this.paddle.target - this.paddle.x;
    this.paddle.x += Math.max(-maxStep, Math.min(maxStep, d));

    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 600 * dt;
      p.life -= dt * 1.8;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const b of this.bricks) b.hit = Math.max(0, b.hit - dt * 5);

    if (this.state === "ready") {
      for (const ball of this.balls) {
        ball.x = this.paddle.x;
        ball.y = PADDLE_Y - BALL_R - 2;
      }
      // Nothing moving: let the loop sleep until the mouse or a key wakes it.
      const moving = this.keys.size || Math.abs(this.paddle.target - this.paddle.x) > 0.5 || this.particles.length;
      if (!moving) {
        this.loop.stop();
        this.loop.redraw();
      }
      return;
    }

    // Power-up timers and falling capsules.
    if (this.wideT > 0) {
      this.wideT -= dt;
      if (this.wideT <= 0) this.updatePaddleWidth();
    }
    if (this.slowT > 0) this.slowT -= dt;
    const pw = this.paddle;
    for (const d of this.drops) {
      d.y += 170 * dt;
      if (d.y + 9 >= PADDLE_Y && d.y - 9 <= PADDLE_Y + 12 && Math.abs(d.x - pw.x) <= pw.w / 2 + 12) {
        d.y = FH + 100;
        this.applyPower(d.kind);
      }
    }
    this.drops = this.drops.filter((d) => d.y < FH + 20);

    const tempo = this.slowT > 0 ? 0.65 : 1;
    for (const ball of [...this.balls]) {
      if (ball.stuck) {
        ball.x = this.paddle.x;
        ball.y = PADDLE_Y - BALL_R - 2;
        continue;
      }
      // Sub-steps keep the ball from tunneling through bricks.
      const steps = Math.ceil((Math.hypot(ball.vx, ball.vy) * dt * tempo) / 4);
      for (let i = 0; i < steps && this.state === "playing" && this.balls.includes(ball); i++) this.step(ball, (dt * tempo) / steps);
    }
  }

  private applyPower(kind: PowerKind) {
    sfx.flip();
    this.ctx.toast(POWER_NAMES[kind]);
    if (kind === "wide") {
      this.wideT = 15;
      this.updatePaddleWidth();
    } else if (kind === "slow") this.slowT = 10;
    else if (kind === "life") {
      this.lives = Math.min(this.lives + 1, 6);
      this.status();
    } else if (kind === "multi") {
      const extra: Ball[] = [];
      for (const b of this.balls) {
        if (b.stuck) continue;
        const sp = Math.hypot(b.vx, b.vy);
        const a = Math.atan2(b.vy, b.vx);
        for (const d of [-0.4, 0.4]) extra.push({ x: b.x, y: b.y, vx: Math.cos(a + d) * sp, vy: Math.sin(a + d) * sp, stuck: false });
      }
      this.balls.push(...extra.slice(0, 8));
    }
  }

  private step(b: Ball, dt: number) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.x < BALL_R) {
      b.x = BALL_R;
      b.vx = Math.abs(b.vx);
      sfx.tick();
    } else if (b.x > FW - BALL_R) {
      b.x = FW - BALL_R;
      b.vx = -Math.abs(b.vx);
      sfx.tick();
    }
    if (b.y < BALL_R) {
      b.y = BALL_R;
      b.vy = Math.abs(b.vy);
      sfx.tick();
    }

    // Paddle: the bounce angle depends on where the ball lands.
    const p = this.paddle;
    if (b.vy > 0 && b.y + BALL_R >= PADDLE_Y && b.y + BALL_R <= PADDLE_Y + 14 && Math.abs(b.x - p.x) <= p.w / 2 + BALL_R) {
      const off = Math.max(-1, Math.min(1, (b.x - p.x) / (p.w / 2)));
      const angle = -Math.PI / 2 + off * 1.05;
      const sp = Math.hypot(b.vx, b.vy);
      b.vx = Math.cos(angle) * sp;
      b.vy = Math.sin(angle) * sp;
      b.y = PADDLE_Y - BALL_R;
      sfx.pick();
    }

    if (b.y > FH + BALL_R * 2) {
      this.balls = this.balls.filter((x) => x !== b);
      if (!this.balls.length) this.loseLife();
      return;
    }

    for (const br of this.bricks) {
      if (br.hp <= 0) continue;
      const cx = Math.max(br.x, Math.min(b.x, br.x + br.w));
      const cy = Math.max(br.y, Math.min(b.y, br.y + br.h));
      const dx = b.x - cx;
      const dy = b.y - cy;
      if (dx * dx + dy * dy > BALL_R * BALL_R) continue;
      // Reflect on the side with the shallower overlap.
      const overlapX = BALL_R - Math.abs(dx);
      const overlapY = BALL_R - Math.abs(dy);
      if (dx === 0 && dy === 0) b.vy = -b.vy;
      else if (overlapX < overlapY) {
        b.vx = dx > 0 ? Math.abs(b.vx) : -Math.abs(b.vx);
        b.x += Math.sign(dx || 1) * overlapX;
      } else {
        b.vy = dy > 0 ? Math.abs(b.vy) : -Math.abs(b.vy);
        b.y += Math.sign(dy || 1) * overlapY;
      }
      this.hitBrick(br, b);
      break;
    }
  }

  private hitBrick(br: Brick, ball: Ball) {
    br.hp -= 1;
    br.hit = 1;
    if (br.hp > 0) {
      sfx.tick();
      return;
    }
    const color = ROW_COLORS[br.row % ROW_COLORS.length];
    for (let i = 0; i < 10; i++)
      this.particles.push({
        x: br.x + Math.random() * br.w,
        y: br.y + Math.random() * br.h,
        vx: (Math.random() - 0.5) * 240,
        vy: -Math.random() * 180,
        life: 1,
        color,
      });
    this.score += 10 * Math.max(1, 7 - br.row) + 10 * (this.level - 1);
    sfx.eat();
    if (this.powerups && Math.random() < 0.13) {
      const kinds = Object.keys(POWER_INFO) as PowerKind[];
      let r = Math.random() * kinds.reduce((t, k) => t + POWER_INFO[k].weight, 0);
      const kind = kinds.find((k) => (r -= POWER_INFO[k].weight) < 0) ?? "wide";
      this.drops.push({ x: br.x + br.w / 2, y: br.y + br.h / 2, kind });
    }
    // Speed up a touch with every brick, up to a cap.
    const sp = Math.hypot(ball.vx, ball.vy);
    const next = Math.min(sp * 1.008, this.speed * 1.6);
    ball.vx *= next / sp;
    ball.vy *= next / sp;
    this.status();
    if (this.bricks.every((b) => b.hp <= 0)) {
      this.level += 1;
      sfx.win();
      this.ctx.toast(`Level ${this.level}`);
      this.buildLevel();
      this.state = "ready";
      this.show(`Level ${this.level}`, "Click or press Space to launch");
    }
  }

  private loseLife() {
    this.lives -= 1;
    sfx.lose();
    this.status();
    this.drops = [];
    this.wideT = 0;
    this.slowT = 0;
    this.updatePaddleWidth();
    if (this.lives <= 0) {
      this.state = "over";
      this.loop.stop();
      this.loop.redraw();
      const { newBest } = recordScore("breakout", this.score);
      this.ctx.end({
        won: false,
        title: "Game over",
        lines: [`Score ${this.score}${newBest ? " — a new best" : ""}`, `Reached level ${this.level}`],
      });
      return;
    }
    this.resetBall();
    this.state = "ready";
    this.show(`${this.lives} ${this.lives === 1 ? "ball" : "balls"} left`, "Click or press Space to launch");
  }

  private draw() {
    const g = this.g;
    const c = this.colors;
    g.clearRect(0, 0, FW, FH);
    g.fillStyle = c.board;
    g.fillRect(0, 0, FW, FH);

    for (const br of this.bricks) {
      if (br.hp <= 0) continue;
      const base = ROW_COLORS[br.row % ROW_COLORS.length];
      g.fillStyle = base;
      g.globalAlpha = br.hp > 1 ? 1 : 0.88;
      g.beginPath();
      g.roundRect(br.x, br.y, br.w, br.h, 6);
      g.fill();
      if (br.hp > 1) {
        g.strokeStyle = "rgba(255,255,255,0.55)";
        g.lineWidth = 2;
        g.stroke();
      }
      if (br.hit > 0) {
        g.globalAlpha = br.hit * 0.6;
        g.fillStyle = "#fff";
        g.fill();
      }
      g.globalAlpha = 1;
    }

    for (const p of this.particles) {
      g.globalAlpha = Math.max(0, p.life);
      g.fillStyle = p.color;
      g.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    g.globalAlpha = 1;

    const p = this.paddle;
    g.fillStyle = c.accent;
    g.beginPath();
    g.roundRect(p.x - p.w / 2, PADDLE_Y, p.w, 12, 6);
    g.fill();

    for (const d of this.drops) {
      const info = POWER_INFO[d.kind];
      g.fillStyle = info.color;
      g.beginPath();
      g.roundRect(d.x - 16, d.y - 9, 32, 18, 9);
      g.fill();
      g.fillStyle = "#fff";
      g.font = `700 13px "Figtree Variable", sans-serif`;
      g.textAlign = "center";
      g.fillText(info.label, d.x, d.y + 4.5);
    }

    g.fillStyle = this.slowT > 0 ? c.strong : c.ink;
    for (const b of this.balls) {
      g.beginPath();
      g.arc(b.x, b.y, BALL_R, 0, Math.PI * 2);
      g.fill();
    }

    // Lives
    for (let i = 0; i < this.lives; i++) {
      g.fillStyle = c.muted;
      g.beginPath();
      g.arc(24 + i * 20, 30, 6, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = c.muted;
    g.font = `600 15px "Figtree Variable", sans-serif`;
    g.textAlign = "right";
    g.fillText(`Level ${this.level}`, FW - 20, 35);
  }

  private status() {
    this.ctx.setStatus([
      { label: "Score", value: String(this.score) },
      { label: "Best", value: String(Math.max(getStats("breakout").bestScore ?? 0, this.score)) },
    ]);
  }
}

export function create(root: HTMLElement, ctx: GameContext): GameInstance {
  return new Breakout(root, ctx);
}
