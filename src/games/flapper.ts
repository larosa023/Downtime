import { GameContext, GameInstance, GameModule } from "../core/types";
import { getStats, recordScore, recordStart } from "../core/stats";
import { sfx } from "../core/sound";

// Logical field; the canvas scales it to fit.
const FW = 480;
const FH = 640;
const STEP = 1 / 120;
const GROUND = 56;
const BIRD_X = 140;
const BIRD_R = 15;
const GRAVITY = 1500;
const FLAP = -470;
const PIPE_W = 70;

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
  private acc = 0;
  private last = 0;
  private raf = 0;
  private colors: Record<string, string> = {};
  private resizeObs: ResizeObserver;
  private themeObs: MutationObserver;

  constructor(root: HTMLElement, private ctx: GameContext) {
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
    window.addEventListener("blur", this.onBlur);
    this.canvas.addEventListener("pointerdown", this.onPointer);
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(this.wrap);
    this.themeObs = new MutationObserver(() => this.readColors());
    this.themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    this.readColors();
    this.newGame();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  newGame() {
    if (this.state === "playing" || this.state === "paused") recordScore("flapper", this.score);
    this.bird = { y: FH / 2 - 40, vy: 0, flapT: 0 };
    this.pipes = [];
    this.score = 0;
    this.state = "ready";
    this.ctx.clearEnd();
    this.ctx.setUndo(false);
    this.show("Click or press Space to flap", "Fly through the gaps");
    this.status();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.onDown);
    window.removeEventListener("blur", this.onBlur);
    this.resizeObs.disconnect();
    this.themeObs.disconnect();
    this.wrap.remove();
  }

  resize() {
    const r = this.wrap.getBoundingClientRect();
    const scale = Math.max(0.2, Math.min((r.width - 40) / FW, (r.height - 40) / FH));
    const dpr = window.devicePixelRatio || 1;
    this.canvas.style.width = `${FW * scale}px`;
    this.canvas.style.height = `${FH * scale}px`;
    this.canvas.width = Math.round(FW * scale * dpr);
    this.canvas.height = Math.round(FH * scale * dpr);
    this.g.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
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

  private onBlur = () => {
    if (this.state === "playing") this.pause();
  };

  private pause() {
    this.state = "paused";
    this.show("Paused", "Press P or Esc to keep going");
  }

  private resume() {
    this.state = "playing";
    this.hide();
    this.last = performance.now();
  }

  private onPointer = (e: PointerEvent) => {
    e.preventDefault();
    this.press();
  };

  private onDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.closest?.("select, input") || e.ctrlKey || e.metaKey) return;
    const k = e.code;
    if (k === "KeyP" || k === "Escape") {
      e.preventDefault();
      if (this.state === "playing") this.pause();
      else if (this.state === "paused") this.resume();
    } else if (k === "Space" || k === "ArrowUp" || k === "KeyW") {
      e.preventDefault();
      if (!e.repeat) this.press();
    }
  };

  private press() {
    if (this.state === "over" || this.state === "falling") return;
    if (this.state === "paused") return this.resume();
    if (this.state === "ready") {
      recordStart("flapper");
      this.state = "playing";
      this.hide();
      this.last = performance.now();
      this.addPipe(FW + 120);
    }
    this.bird.vy = FLAP;
    this.bird.flapT = 0.18;
    sfx.pick();
  }

  // Difficulty eases in: the gap narrows and pipes come faster as the score climbs.
  private speed() {
    return Math.min(150 + this.score * 3, 230);
  }

  private addPipe(x: number) {
    const gap = Math.max(150, 200 - this.score * 2);
    const margin = 70;
    const prev = this.pipes[this.pipes.length - 1];
    let gapY = margin + gap / 2 + Math.random() * (FH - GROUND - margin * 2 - gap);
    // Keep consecutive gaps within a reachable distance.
    if (prev) gapY = Math.max(prev.gapY - 170, Math.min(prev.gapY + 170, gapY));
    this.pipes.push({ x, gapY, gap, scored: false });
  }

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    if (this.state !== "paused" && this.state !== "over") {
      this.acc += dt;
      while (this.acc >= STEP) {
        this.update(STEP);
        this.acc -= STEP;
      }
    } else this.acc = 0;
    this.draw();
  };

  private update(dt: number) {
    const b = this.bird;
    this.bob += dt;
    b.flapT = Math.max(0, b.flapT - dt);
    if (this.state === "ready") {
      b.y = FH / 2 - 40 + Math.sin(this.bob * 3) * 8;
      this.dist += 60 * dt;
      return;
    }

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
    const spacing = Math.max(220, 270 - this.score * 2);
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
    const { newBest } = recordScore("flapper", this.score);
    sfx.lose();
    this.status();
    this.ctx.end({
      won: false,
      title: "Ouch",
      lines: [`Score ${this.score}${newBest ? " — a new best" : ""}`, `Best ${getStats("flapper").bestScore ?? 0}`],
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
      { label: "Best", value: String(Math.max(getStats("flapper").bestScore ?? 0, this.score)) },
    ]);
  }
}

export const flapper: GameModule = {
  id: "flapper",
  name: "Flapper",
  group: "arcade",
  blurb: "Tap to flap and squeeze through the gaps.",
  art: "flapper",
  artSvg: `
    <rect x="12" y="10" width="228" height="124" rx="10" fill="var(--board)"/>
    <ellipse cx="70" cy="122" rx="60" ry="30" fill="var(--table-2)"/>
    <ellipse cx="190" cy="122" rx="70" ry="24" fill="var(--table-2)"/>
    <rect x="12" y="118" width="228" height="16" fill="var(--surface)"/>
    <rect x="140" y="10" width="30" height="36" fill="var(--accent-strong)"/>
    <rect x="136" y="38" width="38" height="10" rx="3" fill="var(--accent)"/>
    <rect x="140" y="90" width="30" height="28" fill="var(--accent-strong)"/>
    <rect x="136" y="86" width="38" height="10" rx="3" fill="var(--accent)"/>
    <ellipse cx="88" cy="66" rx="14" ry="12.5" fill="var(--accent)"/>
    <ellipse cx="86" cy="71" rx="9" ry="6" fill="var(--card)" opacity="0.85"/>
    <ellipse cx="82" cy="62" rx="8" ry="4.5" fill="var(--accent-strong)" transform="rotate(-25 82 62)"/>
    <circle cx="94" cy="62" r="3.6" fill="var(--card)"/><circle cx="95" cy="62" r="1.7" fill="var(--ink)"/>
    <path d="M100 64l8 3-8 4z" fill="#f2b33d"/>`,
  iconSvg: `<ellipse cx="11" cy="13" rx="6" ry="5"/><path d="M17 12.5l3.5 1.5-3.5 1.5"/><path d="M8 11.5c1-2 3-2.5 4-1.5"/>`,
  hasUndo: false,
  statsKey: () => "flapper",
  create: (root, ctx) => new Flapper(root, ctx),
};
