import { GameContext, GameInstance } from "../../core/types";
import { getStats, recordLoss, recordStart, recordWin } from "../../core/stats";
import { sfx } from "../../core/sound";
import { GameLoop, fitCanvas, watchDpr } from "./arcade-loop";

// Logical field; the canvas scales it to fit.
const FW = 800;
const FH = 500;
const PW = 12;
const PH = 84;
const PX = 28; // paddle inset from the edge
const BALL = 9;

const LEVELS: Record<string, { react: number; speed: number; error: number }> = {
  easy: { react: 0.28, speed: 260, error: 46 },
  normal: { react: 0.16, speed: 380, error: 26 },
  hard: { react: 0.08, speed: 520, error: 12 },
};

class Pong implements GameInstance {
  private wrap: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private overlay: HTMLDivElement;
  private level: string;
  private you = { y: FH / 2, target: FH / 2 };
  private cpu = { y: FH / 2, aim: FH / 2, think: 0 };
  private ball = { x: FW / 2, y: FH / 2, vx: 0, vy: 0 };
  private score = [0, 0];
  private rally = 0;
  private serveDir = 1;
  private serveTimer = 0;
  private state: "ready" | "playing" | "paused" | "over" = "ready";
  private keys = new Set<string>();
  private loop: GameLoop;
  private winAt = 7;
  private shellPaused = false;
  private resumeAfterShell = false;
  private offDpr: () => void;
  private flash = 0;
  private colors: Record<string, string> = {};
  private resizeObs: ResizeObserver;
  private themeObs: MutationObserver;
  private started = false;
  private usingMouse = false;

  constructor(root: HTMLElement, private ctx: GameContext) {
    this.level = ctx.option("level") in LEVELS ? ctx.option("level") : "normal";
    this.winAt = [3, 5, 7, 11].includes(Number(ctx.option("to"))) ? Number(ctx.option("to")) : 7;
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
    window.addEventListener("blur", this.onBlur);
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

  private get key() {
    return this.winAt === 7 ? `pong:${this.level}` : `pong:${this.level}:to${this.winAt}`;
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

  private wake() {
    if (this.state === "ready" && !this.shellPaused) this.loop.start();
  }

  newGame() {
    if (this.started && this.state !== "over") recordLoss(this.key);
    this.score = [0, 0];
    this.started = false;
    this.you.y = this.you.target = FH / 2;
    this.cpu.y = this.cpu.aim = FH / 2;
    this.serveDir = 1;
    this.resetBall();
    this.loop.stop();
    this.state = "ready";
    this.resumeAfterShell = false;
    this.ctx.clearEnd();
    this.ctx.setUndo(false);
    this.show("Click or press Space to serve", `Move with the mouse, W/S or the arrow keys. First to ${this.winAt}.`);
    this.status();
    this.loop.redraw();
  }

  destroy() {
    this.loop.stop();
    this.offDpr();
    window.removeEventListener("keydown", this.onDown);
    window.removeEventListener("keyup", this.onUp);
    window.removeEventListener("blur", this.onBlur);
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
    this.colors = { board: v("--board"), ink: v("--ink"), accent: v("--accent"), danger: v("--danger"), muted: v("--muted"), line: v("--board-line") };
  }

  private show(title: string, sub: string) {
    this.overlay.innerHTML = `<p class="snake-title">${title}</p><p class="snake-sub">${sub}</p>`;
    this.overlay.classList.add("show");
  }

  private hide() {
    this.overlay.classList.remove("show");
  }

  private resetBall() {
    this.ball = { x: FW / 2, y: FH / 2, vx: 0, vy: 0 };
    this.rally = 0;
  }

  private serve() {
    const a = (Math.random() - 0.5) * 0.7;
    const sp = 330;
    this.ball.vx = Math.cos(a) * sp * this.serveDir;
    this.ball.vy = Math.sin(a) * sp;
  }

  private start() {
    if (!this.started) {
      this.started = true;
      recordStart(this.key);
    }
    this.state = "playing";
    this.hide();
    this.serveTimer = 0;
    this.serve();
    this.loop.start();
  }

  private resume() {
    this.state = "playing";
    this.hide();
    this.loop.start();
  }

  private pause() {
    this.state = "paused";
    this.keys.clear();
    this.loop.stop();
    this.loop.redraw();
    this.show("Paused", "Press Space to keep going");
  }

  private onBlur = () => {
    this.keys.clear();
  };

  private onPointer = (e: PointerEvent) => {
    const r = this.canvas.getBoundingClientRect();
    this.you.target = ((e.clientY - r.top) / r.height) * FH;
    this.usingMouse = true;
    this.wake();
  };

  private onClick = () => {
    if (this.state === "over" || this.shellPaused) return;
    if (this.state === "paused") return this.resume();
    if (this.state === "ready") this.start();
  };

  private onDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.closest?.("select, input") || e.ctrlKey || e.metaKey) return;
    const k = e.code;
    if (["ArrowUp", "ArrowDown", "KeyW", "KeyS"].includes(k)) {
      e.preventDefault();
      this.keys.add(k);
      this.usingMouse = false;
      this.wake();
    } else if (k === "Space" || k === "Escape") {
      e.preventDefault();
      if (this.shellPaused) return;
      if (this.state === "playing") this.pause();
      else if (this.state === "paused") this.resume();
      else if (this.state === "ready" && k === "Space") this.start();
    }
  };

  private onUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private clampPaddle(y: number) {
    return Math.max(PH / 2, Math.min(FH - PH / 2, y));
  }

  private update(dt: number) {
    if (this.state !== "playing" && this.state !== "ready") return;
    this.flash = Math.max(0, this.flash - dt * 3);
    // Your paddle
    const dir = (this.keys.has("ArrowDown") || this.keys.has("KeyS") ? 1 : 0) - (this.keys.has("ArrowUp") || this.keys.has("KeyW") ? 1 : 0);
    if (dir) this.you.target = this.you.y + dir * 600 * dt * 3;
    this.you.target = this.clampPaddle(this.you.target);
    const step = (this.usingMouse ? 1800 : 600) * dt;
    this.you.y += Math.max(-step, Math.min(step, this.you.target - this.you.y));

    if (this.state !== "playing") {
      // Waiting to serve: sleep once the paddle settles.
      if (!this.keys.size && Math.abs(this.you.target - this.you.y) < 0.5 && this.flash === 0) {
        this.loop.stop();
        this.loop.redraw();
      }
      return;
    }
    const b = this.ball;

    if (this.serveTimer > 0) {
      this.serveTimer -= dt;
      if (this.serveTimer <= 0) this.serve();
      return;
    }

    // Computer: re-aims every so often with some error, so it can be beaten.
    const L = LEVELS[this.level];
    this.cpu.think -= dt;
    if (this.cpu.think <= 0) {
      this.cpu.think = L.react;
      if (b.vx > 0) {
        // Predict where the ball crosses, folding bounces off the walls.
        const t = (FW - PX - PW - b.x) / b.vx;
        let y = b.y + b.vy * t;
        const span = FH - BALL * 2;
        y = ((((y - BALL) % (2 * span)) + 2 * span) % (2 * span));
        if (y > span) y = 2 * span - y;
        this.cpu.aim = y + BALL + (Math.random() - 0.5) * 2 * L.error;
      } else this.cpu.aim = FH / 2;
    }
    const cs = L.speed * dt;
    this.cpu.y = this.clampPaddle(this.cpu.y + Math.max(-cs, Math.min(cs, this.cpu.aim - this.cpu.y)));

    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.y < BALL) {
      b.y = BALL;
      b.vy = Math.abs(b.vy);
      sfx.tick();
    } else if (b.y > FH - BALL) {
      b.y = FH - BALL;
      b.vy = -Math.abs(b.vy);
      sfx.tick();
    }

    // Paddle hits: angle depends on where the ball lands on the paddle.
    const hit = (py: number, side: 1 | -1) => {
      const off = Math.max(-1, Math.min(1, (b.y - py) / (PH / 2)));
      const sp = Math.min(Math.hypot(b.vx, b.vy) * 1.05 + 6, 980);
      const a = off * 1.0;
      b.vx = Math.cos(a) * sp * side;
      b.vy = Math.sin(a) * sp;
      this.rally++;
      sfx.pick();
    };
    const lx = PX + PW;
    if (b.vx < 0 && b.x - BALL <= lx && b.x - BALL >= PX - 6 && Math.abs(b.y - this.you.y) <= PH / 2 + BALL) {
      b.x = lx + BALL;
      hit(this.you.y, 1);
    }
    const rx = FW - PX - PW;
    if (b.vx > 0 && b.x + BALL >= rx && b.x + BALL <= FW - PX + 6 && Math.abs(b.y - this.cpu.y) <= PH / 2 + BALL) {
      b.x = rx - BALL;
      hit(this.cpu.y, -1);
    }

    if (b.x < -BALL * 2) this.point(1);
    else if (b.x > FW + BALL * 2) this.point(0);
  }

  private point(who: 0 | 1) {
    this.score[who]++;
    this.flash = 1;
    this.status();
    if (who === 0) sfx.eat();
    else sfx.error();
    if (this.score[who] >= this.winAt) return this.finish(who === 0);
    this.serveDir = who === 0 ? 1 : -1;
    this.resetBall();
    this.serveTimer = 0.8;
  }

  private finish(won: boolean) {
    this.state = "over";
    this.loop.stop();
    this.loop.redraw();
    if (won) {
      recordWin(this.key);
      sfx.win();
    } else {
      recordLoss(this.key);
      sfx.lose();
    }
    const s = getStats(this.key);
    this.ctx.end({
      won,
      title: won ? "You win" : "The computer wins",
      lines: [`${this.score[0]}–${this.score[1]}`, `${s.won} won of ${s.played} played on ${this.level}`],
    });
  }

  private draw() {
    const g = this.g;
    const c = this.colors;
    g.clearRect(0, 0, FW, FH);
    g.fillStyle = c.board;
    g.fillRect(0, 0, FW, FH);

    // Center line
    g.fillStyle = c.line;
    for (let y = 12; y < FH; y += 26) g.fillRect(FW / 2 - 2, y, 4, 14);

    // Scores
    g.fillStyle = c.muted;
    g.globalAlpha = 0.5 + this.flash * 0.5;
    g.font = `700 64px "Bricolage Grotesque Variable", sans-serif`;
    g.textAlign = "center";
    g.fillText(String(this.score[0]), FW / 2 - 90, 84);
    g.fillText(String(this.score[1]), FW / 2 + 90, 84);
    g.globalAlpha = 1;

    // Paddles
    g.fillStyle = c.accent;
    g.beginPath();
    g.roundRect(PX, this.you.y - PH / 2, PW, PH, 6);
    g.fill();
    g.fillStyle = c.danger;
    g.beginPath();
    g.roundRect(FW - PX - PW, this.cpu.y - PH / 2, PW, PH, 6);
    g.fill();

    // Ball
    g.fillStyle = c.ink;
    g.beginPath();
    g.arc(this.ball.x, this.ball.y, BALL, 0, Math.PI * 2);
    g.fill();

    g.fillStyle = c.muted;
    g.font = `600 13px "Figtree Variable", sans-serif`;
    g.textAlign = "left";
    g.fillText("You", PX, FH - 14);
    g.textAlign = "right";
    g.fillText("Computer", FW - PX, FH - 14);
  }

  private status() {
    const s = getStats(this.key);
    this.ctx.setStatus([
      { label: "You", value: String(this.score[0]) },
      { label: "Computer", value: String(this.score[1]) },
      { label: "Won", value: String(s.won) },
    ]);
  }
}

export function create(root: HTMLElement, ctx: GameContext): GameInstance {
  return new Pong(root, ctx);
}
