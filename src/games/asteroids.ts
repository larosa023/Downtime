import { GameContext, GameInstance, GameModule } from "../core/types";
import { getStats, recordScore, recordStart } from "../core/stats";
import { sfx } from "../core/sound";

// Logical field; the canvas scales it to fit.
const FW = 900;
const FH = 560;
const STEP = 1 / 120;
const SHIP_R = 13;
const TURN = 4.2; // radians per second
const THRUST = 380;
const DRAG = 0.55;
const MAX_SPEED = 420;
const SHOT_SPEED = 620;
const SHOT_LIFE = 0.85;
const SHOT_GAP = 0.18;
const MAX_SHOTS = 5;
const SIZES = [0, 14, 26, 44]; // radius by rock size 1..3
const POINTS = [0, 100, 50, 20];

interface Rock {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  angle: number;
  spin: number;
  shape: number[]; // radius multipliers around the outline
}

interface Shot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}

const wrap = (v: number, max: number) => (v < 0 ? v + max : v >= max ? v - max : v);

class Rocks implements GameInstance {
  private wrapEl: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private overlay: HTMLDivElement;
  private ship = { x: FW / 2, y: FH / 2, vx: 0, vy: 0, a: -Math.PI / 2, alive: true, invuln: 0, respawn: 0 };
  private rocks: Rock[] = [];
  private shots: Shot[] = [];
  private sparks: Spark[] = [];
  private stars: { x: number; y: number; r: number }[] = [];
  private lives = 3;
  private score = 0;
  private wave = 0;
  private waveTimer = 0;
  private cooldown = 0;
  private thrusting = false;
  private state: "ready" | "playing" | "paused" | "over" = "ready";
  private keys = new Set<string>();
  private acc = 0;
  private last = 0;
  private raf = 0;
  private colors: Record<string, string> = {};
  private resizeObs: ResizeObserver;
  private themeObs: MutationObserver;

  constructor(root: HTMLElement, private ctx: GameContext) {
    this.wrapEl = document.createElement("div");
    this.wrapEl.className = "breakout";
    this.canvas = document.createElement("canvas");
    this.canvas.className = "breakout-canvas";
    this.overlay = document.createElement("div");
    this.overlay.className = "snake-overlay";
    this.wrapEl.append(this.canvas, this.overlay);
    root.appendChild(this.wrapEl);
    this.g = this.canvas.getContext("2d")!;
    for (let i = 0; i < 70; i++) this.stars.push({ x: Math.random() * FW, y: Math.random() * FH, r: Math.random() * 1.3 + 0.3 });
    window.addEventListener("keydown", this.onDown);
    window.addEventListener("keyup", this.onUp);
    window.addEventListener("blur", this.onBlur);
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(this.wrapEl);
    this.themeObs = new MutationObserver(() => this.readColors());
    this.themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    this.readColors();
    this.newGame();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  newGame() {
    if (this.state === "playing" || this.state === "paused") recordScore("asteroids", this.score);
    this.lives = 3;
    this.score = 0;
    this.wave = 0;
    this.shots = [];
    this.sparks = [];
    this.rocks = [];
    this.resetShip();
    this.ship.invuln = 0;
    this.spawnWave(true);
    this.state = "ready";
    this.ctx.clearEnd();
    this.ctx.setUndo(false);
    this.show("Press Space to start", "← → turn · ↑ thrust · Space shoot · P pause");
    this.status();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.onDown);
    window.removeEventListener("keyup", this.onUp);
    window.removeEventListener("blur", this.onBlur);
    this.resizeObs.disconnect();
    this.themeObs.disconnect();
    this.wrapEl.remove();
  }

  resize() {
    const r = this.wrapEl.getBoundingClientRect();
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
    this.colors = { board: v("--board"), ink: v("--ink"), accent: v("--accent"), strong: v("--accent-strong"), danger: v("--danger"), muted: v("--muted"), line: v("--board-line") };
  }

  private show(title: string, sub: string) {
    this.overlay.innerHTML = `<p class="snake-title">${title}</p><p class="snake-sub">${sub}</p>`;
    this.overlay.classList.add("show");
  }

  private hide() {
    this.overlay.classList.remove("show");
  }

  private resetShip() {
    Object.assign(this.ship, { x: FW / 2, y: FH / 2, vx: 0, vy: 0, a: -Math.PI / 2, alive: true, invuln: 2.2, respawn: 0 });
  }

  private makeRock(x: number, y: number, size: number, speedBoost = 1): Rock {
    const a = Math.random() * Math.PI * 2;
    const sp = (30 + Math.random() * 50 + (3 - size) * 30 + this.wave * 6) * speedBoost;
    const pts = 9 + Math.floor(Math.random() * 4);
    return {
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      size,
      angle: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 1.6,
      shape: Array.from({ length: pts }, () => 0.72 + Math.random() * 0.38),
    };
  }

  private spawnWave(first = false) {
    this.wave++;
    const n = Math.min(3 + this.wave, 11);
    for (let i = 0; i < n; i++) {
      // Spawn along the edges, away from the ship.
      let x = 0;
      let y = 0;
      do {
        x = Math.random() * FW;
        y = Math.random() * FH;
      } while (Math.hypot(x - this.ship.x, y - this.ship.y) < 190);
      this.rocks.push(this.makeRock(x, y, 3));
    }
    if (!first) this.ctx.toast(`Wave ${this.wave}`);
    this.status();
  }

  private onBlur = () => {
    this.keys.clear();
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

  private onDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.closest?.("select, input") || e.ctrlKey || e.metaKey) return;
    const k = e.code;
    const handled = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "KeyA", "KeyD", "KeyW", "KeyS", "Space", "KeyP", "Escape"];
    if (!handled.includes(k)) return;
    e.preventDefault();
    if (this.state === "over") return;
    if (k === "KeyP" || k === "Escape") {
      if (this.state === "playing") this.pause();
      else if (this.state === "paused") this.resume();
      return;
    }
    if (this.state === "ready") {
      recordStart("asteroids");
      this.state = "playing";
      this.hide();
      this.last = performance.now();
      return;
    }
    if (this.state === "paused") {
      if (k === "Space") this.resume();
      return;
    }
    this.keys.add(k);
  };

  private onUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    if (this.state === "playing") {
      this.acc += dt;
      while (this.acc >= STEP) {
        this.update(STEP);
        this.acc -= STEP;
      }
    } else {
      this.acc = 0;
      if (this.state === "ready" || this.state === "over") this.drift(dt);
    }
    this.draw();
  };

  /** Rocks keep floating behind the start and end screens. */
  private drift(dt: number) {
    for (const r of this.rocks) {
      r.x = wrap(r.x + r.vx * dt, FW);
      r.y = wrap(r.y + r.vy * dt, FH);
      r.angle += r.spin * dt;
    }
    this.tickSparks(dt);
  }

  private tickSparks(dt: number) {
    for (const p of this.sparks) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - dt * 1.5;
      p.vy *= 1 - dt * 1.5;
      p.life -= dt;
    }
    this.sparks = this.sparks.filter((p) => p.life > 0);
  }

  private burst(x: number, y: number, n: number, color: string, speed = 160) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = Math.random() * speed;
      this.sparks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.4 + Math.random() * 0.6, color });
    }
  }

  private update(dt: number) {
    const s = this.ship;
    const k = this.keys;
    this.cooldown -= dt;
    if (s.alive) {
      const turn = (k.has("ArrowRight") || k.has("KeyD") ? 1 : 0) - (k.has("ArrowLeft") || k.has("KeyA") ? 1 : 0);
      s.a += turn * TURN * dt;
      this.thrusting = k.has("ArrowUp") || k.has("KeyW");
      if (this.thrusting) {
        s.vx += Math.cos(s.a) * THRUST * dt;
        s.vy += Math.sin(s.a) * THRUST * dt;
        if (Math.random() < 0.6)
          this.sparks.push({
            x: s.x - Math.cos(s.a) * SHIP_R,
            y: s.y - Math.sin(s.a) * SHIP_R,
            vx: -Math.cos(s.a + (Math.random() - 0.5) * 0.6) * 140 + s.vx,
            vy: -Math.sin(s.a + (Math.random() - 0.5) * 0.6) * 140 + s.vy,
            life: 0.25 + Math.random() * 0.2,
            color: this.colors.danger,
          });
      }
      s.vx *= 1 - DRAG * dt;
      s.vy *= 1 - DRAG * dt;
      const sp = Math.hypot(s.vx, s.vy);
      if (sp > MAX_SPEED) {
        s.vx *= MAX_SPEED / sp;
        s.vy *= MAX_SPEED / sp;
      }
      s.x = wrap(s.x + s.vx * dt, FW);
      s.y = wrap(s.y + s.vy * dt, FH);
      s.invuln = Math.max(0, s.invuln - dt);
      if (k.has("Space") && this.cooldown <= 0 && this.shots.length < MAX_SHOTS) {
        this.cooldown = SHOT_GAP;
        this.shots.push({
          x: s.x + Math.cos(s.a) * SHIP_R,
          y: s.y + Math.sin(s.a) * SHIP_R,
          vx: Math.cos(s.a) * SHOT_SPEED + s.vx,
          vy: Math.sin(s.a) * SHOT_SPEED + s.vy,
          life: SHOT_LIFE,
        });
        sfx.tick();
      }
    } else {
      this.thrusting = false;
      s.respawn -= dt;
      // Wait for a clear spot in the middle before coming back.
      if (s.respawn <= 0 && !this.rocks.some((r) => Math.hypot(r.x - FW / 2, r.y - FH / 2) < SIZES[r.size] + 90)) this.resetShip();
    }

    for (const sh of this.shots) {
      sh.x = wrap(sh.x + sh.vx * dt, FW);
      sh.y = wrap(sh.y + sh.vy * dt, FH);
      sh.life -= dt;
    }
    this.shots = this.shots.filter((sh) => sh.life > 0);

    for (const r of this.rocks) {
      r.x = wrap(r.x + r.vx * dt, FW);
      r.y = wrap(r.y + r.vy * dt, FH);
      r.angle += r.spin * dt;
    }
    this.tickSparks(dt);

    // Shots vs rocks
    for (const sh of this.shots) {
      const hit = this.rocks.find((r) => Math.hypot(r.x - sh.x, r.y - sh.y) < SIZES[r.size]);
      if (!hit) continue;
      sh.life = 0;
      this.breakRock(hit);
    }
    this.shots = this.shots.filter((sh) => sh.life > 0);

    // Ship vs rocks
    if (s.alive && s.invuln <= 0) {
      const hit = this.rocks.find((r) => Math.hypot(r.x - s.x, r.y - s.y) < SIZES[r.size] + SHIP_R * 0.7);
      if (hit) {
        this.breakRock(hit);
        this.loseShip();
      }
    }

    if (!this.rocks.length && this.state === "playing") {
      this.waveTimer += dt;
      if (this.waveTimer > 1.2) {
        this.waveTimer = 0;
        this.spawnWave();
      }
    }
  }

  private breakRock(r: Rock) {
    this.rocks = this.rocks.filter((x) => x !== r);
    this.score += POINTS[r.size];
    this.burst(r.x, r.y, 6 + r.size * 5, this.colors.ink, 60 + r.size * 40);
    if (r.size > 1) for (let i = 0; i < 2; i++) this.rocks.push(this.makeRock(r.x, r.y, r.size - 1, 1.15));
    if (r.size === 3) sfx.merge();
    else sfx.eat();
    // An extra ship every 10,000 points.
    if (Math.floor(this.score / 10000) > Math.floor((this.score - POINTS[r.size]) / 10000)) {
      this.lives++;
      this.ctx.toast("Extra ship");
    }
    this.status();
  }

  private loseShip() {
    const s = this.ship;
    this.burst(s.x, s.y, 40, this.colors.accent, 220);
    s.alive = false;
    s.respawn = 1.4;
    this.lives--;
    sfx.lose();
    this.status();
    if (this.lives <= 0) {
      this.state = "over";
      const { newBest } = recordScore("asteroids", this.score);
      this.ctx.end({
        won: false,
        title: "Game over",
        lines: [`Score ${this.score}${newBest ? " — a new best" : ""}`, `Reached wave ${this.wave} · Best ${getStats("asteroids").bestScore ?? 0}`],
      });
    }
  }

  private drawShip(x: number, y: number, a: number, scale = 1) {
    const g = this.g;
    const R = SHIP_R * scale;
    g.beginPath();
    g.moveTo(x + Math.cos(a) * R * 1.3, y + Math.sin(a) * R * 1.3);
    g.lineTo(x + Math.cos(a + 2.5) * R, y + Math.sin(a + 2.5) * R);
    g.lineTo(x + Math.cos(a + Math.PI) * R * 0.45, y + Math.sin(a + Math.PI) * R * 0.45);
    g.lineTo(x + Math.cos(a - 2.5) * R, y + Math.sin(a - 2.5) * R);
    g.closePath();
    g.stroke();
  }

  private draw() {
    const g = this.g;
    const c = this.colors;
    g.clearRect(0, 0, FW, FH);
    g.fillStyle = c.board;
    g.fillRect(0, 0, FW, FH);

    g.fillStyle = c.line;
    for (const st of this.stars) {
      g.beginPath();
      g.arc(st.x, st.y, st.r, 0, Math.PI * 2);
      g.fill();
    }

    g.lineJoin = "round";
    g.lineCap = "round";
    g.lineWidth = 2;

    // Rocks, drawn at wrapped positions so they slide smoothly across edges.
    g.strokeStyle = c.ink;
    for (const r of this.rocks) {
      const R = SIZES[r.size];
      for (const ox of [0, -FW, FW])
        for (const oy of [0, -FH, FH]) {
          const x = r.x + ox;
          const y = r.y + oy;
          if (x < -R || x > FW + R || y < -R || y > FH + R) continue;
          g.beginPath();
          r.shape.forEach((m, i) => {
            const a = r.angle + (i / r.shape.length) * Math.PI * 2;
            const px = x + Math.cos(a) * R * m;
            const py = y + Math.sin(a) * R * m;
            if (i) g.lineTo(px, py);
            else g.moveTo(px, py);
          });
          g.closePath();
          g.stroke();
        }
    }

    // Shots
    g.fillStyle = c.strong;
    for (const sh of this.shots) {
      g.beginPath();
      g.arc(sh.x, sh.y, 2.5, 0, Math.PI * 2);
      g.fill();
    }

    // Sparks
    for (const p of this.sparks) {
      g.globalAlpha = Math.max(0, Math.min(1, p.life * 1.6));
      g.fillStyle = p.color;
      g.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
    }
    g.globalAlpha = 1;

    // Ship
    const s = this.ship;
    if (s.alive && !(s.invuln > 0 && Math.floor(s.invuln * 10) % 2 === 0)) {
      g.strokeStyle = c.accent;
      g.lineWidth = 2.4;
      this.drawShip(s.x, s.y, s.a);
      if (this.thrusting) {
        g.strokeStyle = c.danger;
        g.beginPath();
        const flick = 0.8 + Math.random() * 0.5;
        g.moveTo(s.x + Math.cos(s.a + 2.75) * SHIP_R * 0.75, s.y + Math.sin(s.a + 2.75) * SHIP_R * 0.75);
        g.lineTo(s.x - Math.cos(s.a) * SHIP_R * 1.3 * flick, s.y - Math.sin(s.a) * SHIP_R * 1.3 * flick);
        g.lineTo(s.x + Math.cos(s.a - 2.75) * SHIP_R * 0.75, s.y + Math.sin(s.a - 2.75) * SHIP_R * 0.75);
        g.stroke();
      }
    }

    // Lives and wave
    g.strokeStyle = c.muted;
    g.lineWidth = 1.6;
    for (let i = 0; i < Math.max(0, this.lives); i++) this.drawShip(26 + i * 24, 30, -Math.PI / 2, 0.75);
    g.fillStyle = c.muted;
    g.font = `600 15px "Figtree Variable", sans-serif`;
    g.textAlign = "right";
    g.fillText(`Wave ${this.wave}`, FW - 20, 35);
  }

  private status() {
    this.ctx.setStatus([
      { label: "Score", value: String(this.score) },
      { label: "Best", value: String(Math.max(getStats("asteroids").bestScore ?? 0, this.score)) },
    ]);
  }
}

export const asteroids: GameModule = {
  id: "asteroids",
  name: "Rocks",
  group: "arcade",
  blurb: "Fly, turn and shoot. Break up the rocks before they hit you.",
  art: "asteroids",
  artSvg: `
    <rect x="12" y="10" width="228" height="124" rx="10" fill="var(--board)"/>
    ${[[30, 30], [70, 110], [200, 24], [222, 100], [150, 120], [110, 22]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.2" fill="var(--board-line)"/>`).join("")}
    <path d="M60 40l14-8 15 4 7 13-4 14-15 6-13-5-7-12z" fill="none" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round"/>
    <path d="M172 72l10-6 11 3 5 10-3 10-11 4-9-4-5-8z" fill="none" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round"/>
    <path d="M196 30l7-4 7 2 3 6-2 6-7 3-6-3z" fill="none" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round"/>
    <path d="M118 96l-9 22 9-6 9 6z" transform="rotate(40 118 106)" fill="none" stroke="var(--accent)" stroke-width="2.4" stroke-linejoin="round"/>
    <circle cx="140" cy="88" r="2.4" fill="var(--accent-strong)"/><circle cx="154" cy="78" r="2.4" fill="var(--accent-strong)"/>`,
  iconSvg: `<path d="M5 18 12 4l7 14-7-4z"/>`,
  hasUndo: false,
  statsKey: () => "asteroids",
  create: (root, ctx) => new Rocks(root, ctx),
};
