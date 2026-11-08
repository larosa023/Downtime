import { GameContext, GameInstance } from "../../core/types";
import { getStats, recordScore, recordStart } from "../../core/stats";
import { sfx } from "../../core/sound";
import { GameLoop, fitCanvas, watchDpr } from "./arcade-loop";

// Logical field; the canvas scales it to fit.
const FW = 480;
const FH = 640;
const GROUND = 56;
const BIRD_X = 140;
const BIRD_R = 15;
const GRAVITY = 1500;
const FLAP = -470;
const PIPE_W = 70;

const LEVELS: Record<string, { gap: number; minGap: number; speed: number; maxSpeed: number; spacing: number }> = {
  easy: { gap: 230, minGap: 185, speed: 130, maxSpeed: 190, spacing: 300 },
  normal: { gap: 200, minGap: 150, speed: 150, maxSpeed: 230, spacing: 270 },
  hard: { gap: 175, minGap: 128, speed: 175, maxSpeed: 270, spacing: 245 },
};

interface Pipe {
  x: number;
  gapY: number; // center of the gap
  gap: number;
  scored: boolean;
}

class Flapper implements GameInstance {
  private wrap: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private overlay: HTMLDivElement;
  private bird = { y: FH / 2 - 40, vy: 0, flapT: 0 };
  private pipes: Pipe[] = [];
  private score = 0;
  private dist = 0; // for parallax
  private bob = 0;
  private hills: { x: number; h: number; w: number }[] = [];
  private clouds: { x: number; y: number; s: number }[] = [];
  private state: "ready" | "playing" | "paused" | "over" | "falling" = "ready";
  private loop: GameLoop;
  private level: string;
  private readyTime = 0;
  private shellPaused = false;
  private resumeAfterShell = false;
  private offDpr: () => void;
  private colors: Record<string, string> = {};
  private resizeObs: ResizeObserver;
  private themeObs: MutationObserver;

  constructor(root: HTMLElement, private ctx: GameContext) {
    this.level = ctx.option("level") in LEVELS ? ctx.option("level") : "normal";
    this.loop = new GameLoop({ hz: 120, step: (dt) => this.update(dt), draw: () => this.draw() });
    this.wrap = document.createElement("div");
    this.wrap.className = "breakout";
    this.canvas = document.createElement("canvas");
    this.canvas.className = "breakout-canvas";
    this.canvas.style.cursor = "pointer";
    this.overlay = document.createElement("div");
    this.overlay.className = "snake-overlay";
    this.wrap.append(this.canvas, this.overlay);
    root.appendChild(this.wrap);
    this.g = this.canvas.getContext("2d")!;
    for (let i = 0; i < 8; i++) this.hills.push({ x: i * 90 + Math.random() * 40, h: 50 + Math.random() * 70, w: 120 + Math.random() * 80 });
    for (let i = 0; i < 5; i++) this.clouds.push({ x: Math.random() * FW, y: 60 + Math.random() * 220, s: 0.7 + Math.random() * 0.7 });
    window.addEventListener("keydown", this.onDown);
    this.canvas.addEventListener("pointerdown", this.onPointer);
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
    return this.level === "normal" ? "flapper" : `flapper:${this.level}`;
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
      else this.loop.stop();
    } else if (this.resumeAfterShell && this.state === "paused") {
      this.resumeAfterShell = false;
      this.resume();
    } else if (this.state === "ready" || this.state === "falling") this.loop.start();
  }

  newGame() {
    if (this.state === "playing" || this.state === "paused") recordScore(this.key, this.score);
    this.bird = { y: FH / 2 - 40, vy: 0, flapT: 0 };
    this.pipes = [];
    this.score = 0;
    this.state = "ready";
    this.readyTime = 0;
    this.resumeAfterShell = false;
    if (!this.shellPaused) this.loop.start();
    this.ctx.clearEnd();
    this.ctx.setUndo(false);
    this.show("Click or press Space to flap", "Fly through the gaps");
    this.status();
  }

  destroy() {
    this.loop.stop();
    this.offDpr();
    window.removeEventListener("keydown", this.onDown);
    this.resizeObs.disconnect();
    this.themeObs.disconnect();
    this.wrap.remove();
  }

  resize() {
    const r = this.wrap.getBoundingClientRect();
    const scale = Math.max(0.2, Math.min((r.width - 40) / FW, (r.height - 40) / FH));
    const dpr = fitCanvas(this.canvas, FW * scale, FH * scale);
    this.g.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    this.loop.redraw();
  }

  private readColors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n: string) => cs.getPropertyValue(n).trim();
    this.colors = {
      board: v("--board"),
      table: v("--table"),
      table2: v("--table-2"),
      ink: v("--ink"),
      accent: v("--accent"),
      strong: v("--accent-strong"),
      danger: v("--danger"),
      muted: v("--muted"),
      line: v("--board-line"),
      surface: v("--surface"),
      card: v("--card"),
    };
  }

  private show(title: string, sub: string) {
    this.overlay.innerHTML = `<p class="snake-title">${title}</p><p class="snake-sub">${sub}</p>`;
    this.overlay.classList.add("show");
  }

  private hide() {
    this.overlay.classList.remove("show");
  }

  private pause() {
    this.state = "paused";
    this.loop.stop();
    this.loop.redraw();
    this.show("Paused", "Press Esc to keep going");
  }

  private resume() {
    this.state = "playing";
    this.hide();
    this.loop.start();
  }

  private onPointer = (e: PointerEvent) => {
    e.preventDefault();
    this.press();
  };

  private onDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.closest?.("select, input") || e.ctrlKey || e.metaKey) return;
    const k = e.code;
    if (this.shellPaused) return;
    if (k === "Escape") {
      e.preventDefault();
      if (this.state === "playing") this.pause();
      else if (this.state === "paused") this.resume();
    } else if (k === "Space" || k === "ArrowUp" || k === "KeyW") {
      e.preventDefault();
      if (!e.repeat) this.press();
    }
  };

  private press() {
    if (this.state === "over" || this.state === "falling" || this.shellPaused) return;
    if (this.state === "paused") return this.resume();
    if (this.state === "ready") {
      recordStart(this.key);
      this.state = "playing";
      this.hide();
      this.loop.start();
      this.addPipe(FW + 120);
    }
    this.bird.vy = FLAP;
    this.bird.flapT = 0.18;
    sfx.pick();
  }

  // Difficulty eases in: the gap narrows and pipes come faster as the score climbs.
  private speed() {
    const L = LEVELS[this.level];
    return Math.min(L.speed + this.score * 3, L.maxSpeed);
  }

  private addPipe(x: number) {
    const L = LEVELS[this.level];
    const gap = Math.max(L.minGap, L.gap - this.score * 2);
    const margin = 70;
    const prev = this.pipes[this.pipes.length - 1];
    let gapY = margin + gap / 2 + Math.random() * (FH - GROUND - margin * 2 - gap);
    // Keep consecutive gaps within a reachable distance.
    if (prev) gapY = Math.max(prev.gapY - 170, Math.min(prev.gapY + 170, gapY));
    this.pipes.push({ x, gapY, gap, scored: false });
  }

  private update(dt: number) {
    const b = this.bird;
    this.bob += dt;
    b.flapT = Math.max(0, b.flapT - dt);
    if (this.state === "ready") {
      b.y = FH / 2 - 40 + Math.sin(this.bob * 3) * 8;
      this.dist += 60 * dt;
      // Idle on the start screen: settle after a few seconds so it doesn't burn CPU.
      this.readyTime += dt;
      if (this.readyTime > 8) {
        b.y = FH / 2 - 40;
        this.loop.stop();
        this.loop.redraw();
      }
      return;
    }
    if (this.state !== "playing" && this.state !== "falling") return;

    b.vy = Math.min(b.vy + GRAVITY * dt, 760);
    b.y += b.vy * dt;

    if (this.state === "falling") {
      if (b.y >= FH - GROUND - BIRD_R) {
        b.y = FH - GROUND - BIRD_R;
        this.gameOver();
      }
      return;
    }

    const sp = this.speed();
    this.dist += sp * dt;
    for (const p of this.pipes) p.x -= sp * dt;
    this.pipes = this.pipes.filter((p) => p.x > -PIPE_W - 10);
    const lastPipe = this.pipes[this.pipes.length - 1];
    const spacing = Math.max(LEVELS[this.level].spacing - 50, LEVELS[this.level].spacing - this.score * 2);
    if (!lastPipe || lastPipe.x < FW - spacing) this.addPipe(FW + 20);

    for (const p of this.pipes) {
      if (!p.scored && p.x + PIPE_W < BIRD_X - BIRD_R) {
        p.scored = true;
        this.score++;
        sfx.eat();
        this.status();
      }
    }

    // Collisions: ceiling is soft, ground and pipes are not.
    if (b.y < BIRD_R) {
      b.y = BIRD_R;
      b.vy = Math.max(b.vy, 0);
    }
    if (b.y >= FH - GROUND - BIRD_R) {
      b.y = FH - GROUND - BIRD_R;
      return this.crash(true);
    }
    for (const p of this.pipes) {
      if (BIRD_X + BIRD_R * 0.8 < p.x || BIRD_X - BIRD_R * 0.8 > p.x + PIPE_W) continue;
      const top = p.gapY - p.gap / 2;
      const bot = p.gapY + p.gap / 2;
      if (b.y - BIRD_R * 0.8 < top || b.y + BIRD_R * 0.8 > bot) return this.crash(false);
    }
  }

  private crash(ground: boolean) {
    sfx.error();
    if (ground) this.gameOver();
    else {
      this.state = "falling";
      this.bird.vy = Math.max(this.bird.vy, 0);
    }
  }

  private gameOver() {
    this.state = "over";
    this.loop.stop();
    this.loop.redraw();
    const { newBest } = recordScore(this.key, this.score);
    sfx.lose();
    this.status();
    this.ctx.end({
      won: false,
      title: "Ouch",
      lines: [`Score ${this.score}${newBest ? " — a new best" : ""}`, `Best ${getStats(this.key).bestScore ?? 0}`],
    });
  }

  private drawBird(y: number, tilt: number) {
    const g = this.g;
    const c = this.colors;
    g.save();
    g.translate(BIRD_X, y);
    g.rotate(tilt);
    // Body: a round, plump little thing.
    g.fillStyle = c.accent;
    g.beginPath();
    g.ellipse(0, 0, BIRD_R * 1.12, BIRD_R, 0, 0, Math.PI * 2);
    g.fill();
    // Belly
    g.fillStyle = c.card;
    g.globalAlpha = 0.85;
    g.beginPath();
    g.ellipse(-2, BIRD_R * 0.35, BIRD_R * 0.7, BIRD_R * 0.5, 0, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 1;
    // Wing flaps up for a moment after each tap.
    g.fillStyle = c.strong;
    g.beginPath();
    const up = this.bird.flapT > 0 ? -1 : 0.4;
    g.ellipse(-5, up * 5, BIRD_R * 0.62, BIRD_R * 0.34, up * 0.6, 0, Math.PI * 2);
    g.fill();
    // Eye
    g.fillStyle = c.card;
    g.beginPath();
    g.arc(BIRD_R * 0.45, -BIRD_R * 0.3, 4.6, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = c.ink;
    g.beginPath();
    g.arc(BIRD_R * 0.55, -BIRD_R * 0.3, 2.2, 0, Math.PI * 2);
    g.fill();
    // Beak
    g.fillStyle = "#f2b33d";
    g.beginPath();
    g.moveTo(BIRD_R * 0.95, -2);
    g.lineTo(BIRD_R * 1.55, 2);
    g.lineTo(BIRD_R * 0.95, 6);
    g.closePath();
    g.fill();
    g.restore();
  }

  private draw() {
    const g = this.g;
    const c = this.colors;
    g.clearRect(0, 0, FW, FH);
    const sky = g.createLinearGradient(0, 0, 0, FH);
    sky.addColorStop(0, c.board);
    sky.addColorStop(1, c.table);
    g.fillStyle = sky;
    g.fillRect(0, 0, FW, FH);

    // Far layer: clouds drift slowly.
    g.fillStyle = c.surface;
    g.globalAlpha = 0.7;
    for (const cl of this.clouds) {
      const x = ((((cl.x - this.dist * 0.08 * cl.s) % (FW + 160)) + FW + 160) % (FW + 160)) - 80;
      g.beginPath();
      g.ellipse(x, cl.y, 34 * cl.s, 13 * cl.s, 0, 0, Math.PI * 2);
      g.ellipse(x + 22 * cl.s, cl.y - 8 * cl.s, 22 * cl.s, 13 * cl.s, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;

    // Middle layer: rolling hills.
    g.fillStyle = c.table2;
    const span = 8 * 90;
    for (const h of this.hills) {
      const x = ((((h.x - this.dist * 0.3) % span) + span) % span) - 120;
      g.beginPath();
      g.ellipse(x, FH - GROUND, h.w / 2, h.h, 0, Math.PI, 0);
      g.fill();
    }

    // Pipes
    for (const p of this.pipes) {
      const top = p.gapY - p.gap / 2;
      const bot = p.gapY + p.gap / 2;
      g.fillStyle = c.strong;
      g.beginPath();
      g.roundRect(p.x, -10, PIPE_W, top + 10, [0, 0, 8, 8]);
      g.roundRect(p.x, bot, PIPE_W, FH - GROUND - bot, [8, 8, 0, 0]);
      g.fill();
      // Lip on each end
      g.fillStyle = c.accent;
      g.beginPath();
      g.roundRect(p.x - 5, top - 22, PIPE_W + 10, 22, 6);
      g.roundRect(p.x - 5, bot, PIPE_W + 10, 22, 6);
      g.fill();
      g.fillStyle = "rgba(255,255,255,0.14)";
      g.fillRect(p.x + 8, -10, 8, top - 12);
      g.fillRect(p.x + 8, bot + 22, 8, FH - GROUND - bot - 22);
    }

    // Ground with moving stripes
    g.fillStyle = c.surface;
    g.fillRect(0, FH - GROUND, FW, GROUND);
    g.fillStyle = c.line;
    g.fillRect(0, FH - GROUND, FW, 3);
    const off = -((this.dist) % 28);
    for (let x = off; x < FW; x += 28) {
      g.beginPath();
      g.moveTo(x, FH - GROUND + 3);
      g.lineTo(x + 14, FH - GROUND + 3);
      g.lineTo(x + 6, FH - GROUND + 14);
      g.lineTo(x - 8, FH - GROUND + 14);
      g.closePath();
      g.fill();
    }

    // Bird tilts with its speed.
    const tilt = this.state === "ready" ? 0 : Math.max(-0.45, Math.min(1.2, this.bird.vy / 650));
    this.drawBird(this.bird.y, tilt);

    // Score
    if (this.state !== "ready") {
      g.textAlign = "center";
      g.font = `750 56px "Bricolage Grotesque Variable", sans-serif`;
      // Outlined so it stays readable over pipes.
      g.lineJoin = "round";
      g.lineWidth = 8;
      g.strokeStyle = c.board;
      g.strokeText(String(this.score), FW / 2, 92);
      g.fillStyle = c.ink;
      g.fillText(String(this.score), FW / 2, 92);
    }
  }

  private status() {
    this.ctx.setStatus([
      { label: "Score", value: String(this.score) },
      { label: "Best", value: String(Math.max(getStats(this.key).bestScore ?? 0, this.score)) },
    ]);
  }
}

export function create(root: HTMLElement, ctx: GameContext): GameInstance {
  return new Flapper(root, ctx);
}
