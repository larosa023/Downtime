import { GameContext, GameInstance, GameModule } from "../core/types";
import { getStats, recordScore, recordStart } from "../core/stats";
import { sfx } from "../core/sound";

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

/** A few layouts; later levels cycle with tougher bricks. */
const PATTERNS: ((r: number, c: number) => number)[] = [
  () => 1,
  (r, c) => ((r + c) % 2 === 0 ? 1 : 0) || (r < 2 ? 1 : 0),
  (r, c) => (Math.abs(c - 5.5) < 6 - r ? 1 : 0),
  (r, c) => (c === 0 || c === 11 || r === 0 ? 2 : (c + r) % 3 === 0 ? 0 : 1),
  (r) => (r % 2 === 0 ? 2 : 1),
];

class Breakout implements GameInstance {
  private wrap: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private overlay: HTMLDivElement;
  private scale = 1;
  private bricks: Brick[] = [];
  private paddle = { x: FW / 2, w: 110, target: FW / 2 };
  private ball = { x: FW / 2, y: PADDLE_Y - BALL_R - 2, vx: 0, vy: 0, stuck: true };
  private speed = 380;
  private lives = 3;
  private score = 0;
  private level = 1;
  private state: "ready" | "playing" | "paused" | "over" = "ready";
  private keys = new Set<string>();
  private last = 0;
  private raf = 0;
  private particles: { x: number; y: number; vx: number; vy: number; life: number; color: string }[] = [];
  private colors: Record<string, string> = {};
  private resizeObs: ResizeObserver;
  private themeObs: MutationObserver;
  private started = false;

  constructor(root: HTMLElement, private ctx: GameContext) {
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
    this.themeObs = new MutationObserver(() => this.readColors());
    this.themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    this.readColors();
    this.newGame();
    this.raf = requestAnimationFrame(this.frame);
  }

  newGame() {
    this.lives = 3;
    this.score = 0;
    this.level = 1;
    this.started = false;
    this.buildLevel();
    this.state = "ready";
    this.ctx.clearEnd();
    this.ctx.setUndo(false);
    this.show("Click or press Space to launch", "Move with the mouse or arrow keys");
    this.status();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.onDown);
    window.removeEventListener("keyup", this.onUp);
    this.resizeObs.disconnect();
    this.themeObs.disconnect();
    this.wrap.remove();
  }

  resize() {
    const r = this.wrap.getBoundingClientRect();
    this.scale = Math.min((r.width - 40) / FW, (r.height - 40) / FH);
    const dpr = window.devicePixelRatio || 1;
    this.canvas.style.width = `${FW * this.scale}px`;
    this.canvas.style.height = `${FH * this.scale}px`;
    this.canvas.width = FW * this.scale * dpr;
    this.canvas.height = FH * this.scale * dpr;
    this.g.setTransform(dpr * this.scale, 0, 0, dpr * this.scale, 0, 0);
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
    this.paddle.w = Math.max(80, 116 - (this.level - 1) * 4);
    this.resetBall();
  }

  private resetBall() {
    this.ball = { x: this.paddle.x, y: PADDLE_Y - BALL_R - 2, vx: 0, vy: 0, stuck: true };
  }

  private launch() {
    if (!this.ball.stuck) return;
    if (!this.started) {
      this.started = true;
      recordStart("breakout");
    }
    const a = (-Math.PI / 2) + (Math.random() - 0.5) * 0.6;
    this.ball.vx = Math.cos(a) * this.speed;
    this.ball.vy = Math.sin(a) * this.speed;
    this.ball.stuck = false;
    this.state = "playing";
    this.hide();
  }

  private onPointer = (e: PointerEvent) => {
    const r = this.canvas.getBoundingClientRect();
    this.paddle.target = ((e.clientX - r.left) / r.width) * FW;
  };

  private onClick = () => {
    if (this.state === "over") return;
    if (this.state === "paused") return this.resume();
    this.launch();
  };

  private resume() {
    this.state = "playing";
    this.hide();
    this.last = performance.now();
  }

  private onDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.closest?.("select, input") || e.ctrlKey || e.metaKey) return;
    const k = e.code;
    if (k === "ArrowLeft" || k === "ArrowRight" || k === "KeyA" || k === "KeyD") {
      e.preventDefault();
      this.keys.add(k);
    } else if (k === "Space") {
      e.preventDefault();
      if (this.state === "playing" && !this.ball.stuck) {
        this.state = "paused";
        this.show("Paused", "Press Space to keep going");
      } else if (this.state === "paused") this.resume();
      else if (this.state !== "over") this.launch();
    } else if (k === "KeyP" || k === "Escape") {
      if (this.state === "playing") {
        this.state = "paused";
        this.show("Paused", "Press Space to keep going");
      } else if (this.state === "paused") this.resume();
    }
  };

  private onUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min((now - this.last) / 1000, 0.05);
    this.last = now;
    if (this.state === "playing" || this.state === "ready") this.update(dt);
    this.draw();
  };

  private update(dt: number) {
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

    const ball = this.ball;
    if (ball.stuck) {
      ball.x = this.paddle.x;
      ball.y = PADDLE_Y - BALL_R - 2;
      return;
    }
    // Sub-steps keep the ball from tunneling through bricks.
    const steps = Math.ceil((Math.hypot(ball.vx, ball.vy) * dt) / 4);
    for (let i = 0; i < steps && this.state === "playing"; i++) this.step(dt / steps);
  }

  private step(dt: number) {
    const b = this.ball;
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

    if (b.y > FH + BALL_R * 2) return this.loseLife();

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
      this.hitBrick(br);
      break;
    }
  }

  private hitBrick(br: Brick) {
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
    this.score += 10 * (7 - br.row) + 10 * (this.level - 1);
    sfx.eat();
    // Speed up a touch with every brick, up to a cap.
    const sp = Math.hypot(this.ball.vx, this.ball.vy);
    const next = Math.min(sp * 1.008, this.speed * 1.6);
    this.ball.vx *= next / sp;
    this.ball.vy *= next / sp;
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
    if (this.lives <= 0) {
      this.state = "over";
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

    g.fillStyle = c.ink;
    g.beginPath();
    g.arc(this.ball.x, this.ball.y, BALL_R, 0, Math.PI * 2);
    g.fill();

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

export const breakout: GameModule = {
  id: "breakout",
  name: "Breakout",
  group: "arcade",
  blurb: "Bounce the ball off your paddle and knock out every brick.",
  art: "breakout",
  hasUndo: false,
  statsKey: () => "breakout",
  create: (root, ctx) => new Breakout(root, ctx),
};
