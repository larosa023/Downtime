import { GameContext, GameInstance, GameModule } from "../core/types";
import { getStats, recordScore, recordStart } from "../core/stats";
import { sfx } from "../core/sound";

const W = 10;
const H = 20;
const HIDDEN = 2; // spawn rows above the visible field

type Kind = "I" | "O" | "T" | "S" | "Z" | "J" | "L";
const SHAPES: Record<Kind, number[][]> = {
  I: [[0, 1], [1, 1], [2, 1], [3, 1]],
  O: [[1, 0], [2, 0], [1, 1], [2, 1]],
  T: [[1, 0], [0, 1], [1, 1], [2, 1]],
  S: [[1, 0], [2, 0], [0, 1], [1, 1]],
  Z: [[0, 0], [1, 0], [1, 1], [2, 1]],
  J: [[0, 0], [0, 1], [1, 1], [2, 1]],
  L: [[2, 0], [0, 1], [1, 1], [2, 1]],
};
const BOX: Record<Kind, number> = { I: 4, O: 4, T: 3, S: 3, Z: 3, J: 3, L: 3 };
const COLORS: Record<Kind, string> = {
  I: "#4cc3d9", O: "#f2c14e", T: "#a77bd8", S: "#62c27a", Z: "#ef6f6c", J: "#5b8def", L: "#f2994a",
};
const KICKS = [[0, 0], [-1, 0], [1, 0], [0, -1], [-2, 0], [2, 0], [-1, -1], [1, -1]];
const LINE_SCORE = [0, 100, 300, 500, 800];
const DAS = 150;
const ARR = 40;
const LOCK_MS = 500;

interface Piece {
  kind: Kind;
  cells: number[][]; // relative to box origin
  x: number;
  y: number;
}

function rotate(kind: Kind, cells: number[][], dir: 1 | -1): number[][] {
  if (kind === "O") return cells;
  const n = BOX[kind] - 1;
  return cells.map(([x, y]) => (dir === 1 ? [n - y, x] : [y, n - x]));
}

class Blocks implements GameInstance {
  private wrap: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private overlay: HTMLDivElement;
  private field: (Kind | null)[][] = [];
  private piece: Piece | null = null;
  private bag: Kind[] = [];
  private queue: Kind[] = [];
  private hold: Kind | null = null;
  private held = false;
  private score = 0;
  private lines = 0;
  private level = 1;
  private state: "ready" | "playing" | "paused" | "over" = "ready";
  private fallAcc = 0;
  private lockAcc = 0;
  private lockResets = 0;
  private clearing: { rows: number[]; t: number } | null = null;
  private last = 0;
  private raf = 0;
  private keys = new Map<string, { since: number; repeat: number }>();
  private cell = 24;
  private colors: Record<string, string> = {};
  private resizeObs: ResizeObserver;
  private themeObs: MutationObserver;

  constructor(root: HTMLElement, private ctx: GameContext) {
    this.wrap = document.createElement("div");
    this.wrap.className = "blocks";
    this.canvas = document.createElement("canvas");
    this.canvas.className = "blocks-canvas";
    this.overlay = document.createElement("div");
    this.overlay.className = "snake-overlay";
    this.wrap.append(this.canvas, this.overlay);
    root.appendChild(this.wrap);
    this.g = this.canvas.getContext("2d")!;
    window.addEventListener("keydown", this.onDown);
    window.addEventListener("keyup", this.onUp);
    window.addEventListener("blur", this.onBlur);
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(this.wrap);
    this.themeObs = new MutationObserver(() => this.readColors());
    this.themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    this.readColors();
    this.newGame();
    this.raf = requestAnimationFrame(this.frame);
  }

  newGame() {
    this.field = Array.from({ length: H + HIDDEN }, () => Array(W).fill(null));
    this.bag = [];
    this.queue = [];
    this.hold = null;
    this.held = false;
    this.score = 0;
    this.lines = 0;
    this.level = 1;
    this.clearing = null;
    this.state = "ready";
    while (this.queue.length < 4) this.queue.push(this.nextKind());
    this.piece = null;
    this.ctx.clearEnd();
    this.ctx.setUndo(false);
    this.show("Press an arrow key to start", "← → move · ↑ rotate · Space drop · C hold");
    this.status();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.onDown);
    window.removeEventListener("keyup", this.onUp);
    window.removeEventListener("blur", this.onBlur);
    this.resizeObs.disconnect();
    this.themeObs.disconnect();
    this.wrap.remove();
  }

  resize() {
    const r = this.wrap.getBoundingClientRect();
    // Field plus a side panel of 5 cells on each side.
    this.cell = Math.max(12, Math.floor(Math.min((r.width - 40) / (W + 12), (r.height - 40) / H)));
    const dpr = window.devicePixelRatio || 1;
    const w = this.cell * (W + 12);
    const h = this.cell * H;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private readColors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n: string) => cs.getPropertyValue(n).trim();
    this.colors = { board: v("--board"), line: v("--board-line"), ink: v("--ink"), muted: v("--muted"), surface: v("--surface") };
  }

  private show(title: string, sub: string) {
    this.overlay.innerHTML = `<p class="snake-title">${title}</p><p class="snake-sub">${sub}</p>`;
    this.overlay.classList.add("show");
  }

  private hide() {
    this.overlay.classList.remove("show");
  }

  private nextKind(): Kind {
    if (!this.bag.length) {
      this.bag = (Object.keys(SHAPES) as Kind[]).sort(() => Math.random() - 0.5);
    }
    return this.bag.pop()!;
  }

  private spawn(kind?: Kind) {
    const k = kind ?? this.queue.shift()!;
    if (!kind) this.queue.push(this.nextKind());
    this.piece = { kind: k, cells: SHAPES[k].map((c) => [...c]), x: k === "O" ? 3 : 3, y: k === "I" ? 0 : 1 };
    this.lockAcc = 0;
    this.lockResets = 0;
    if (this.collides(this.piece)) this.gameOver();
  }

  private collides(p: Piece, dx = 0, dy = 0, cells = p.cells) {
    return cells.some(([cx, cy]) => {
      const x = p.x + cx + dx;
      const y = p.y + cy + dy;
      return x < 0 || x >= W || y >= H + HIDDEN || (y >= 0 && this.field[y][x] !== null);
    });
  }

  private move(dx: number): boolean {
    const p = this.piece;
    if (!p || this.collides(p, dx, 0)) return false;
    p.x += dx;
    this.bumpLock();
    return true;
  }

  private rotatePiece(dir: 1 | -1) {
    const p = this.piece;
    if (!p) return;
    const cells = rotate(p.kind, p.cells, dir);
    for (const [kx, ky] of KICKS) {
      if (!this.collides(p, kx, ky, cells)) {
        p.cells = cells;
        p.x += kx;
        p.y += ky;
        this.bumpLock();
        sfx.tick();
        return;
      }
    }
  }

  private bumpLock() {
    if (this.lockResets < 15) {
      this.lockAcc = 0;
      this.lockResets++;
    }
  }

  private grounded() {
    return !!this.piece && this.collides(this.piece, 0, 1);
  }

  private hardDrop() {
    const p = this.piece;
    if (!p) return;
    let d = 0;
    while (!this.collides(p, 0, d + 1)) d++;
    p.y += d;
    this.score += d * 2;
    this.lock();
  }

  private holdPiece() {
    if (!this.piece || this.held) return;
    const cur = this.piece.kind;
    if (this.hold) this.spawn(this.hold);
    else this.spawn();
    this.hold = cur;
    this.held = true;
    sfx.flip();
  }

  private lock() {
    const p = this.piece!;
    let above = true;
    for (const [cx, cy] of p.cells) {
      const y = p.y + cy;
      if (y >= HIDDEN) above = false;
      if (y >= 0) this.field[y][p.x + cx] = p.kind;
    }
    this.piece = null;
    this.held = false;
    sfx.place();
    if (above) return this.gameOver();
    const full = this.field.map((r, i) => (r.every((c) => c) ? i : -1)).filter((i) => i >= 0);
    if (full.length) {
      this.clearing = { rows: full, t: 0 };
      sfx.merge();
    } else this.spawn();
    this.status();
  }

  private finishClear() {
    const rows = this.clearing!.rows;
    this.field = this.field.filter((_, i) => !rows.includes(i));
    while (this.field.length < H + HIDDEN) this.field.unshift(Array(W).fill(null));
    this.lines += rows.length;
    this.score += LINE_SCORE[rows.length] * this.level;
    const lvl = Math.floor(this.lines / 10) + 1;
    if (lvl > this.level) {
      this.level = lvl;
      this.ctx.toast(`Level ${lvl}`);
    }
    this.clearing = null;
    this.spawn();
    this.status();
  }

  private gameOver() {
    this.state = "over";
    this.piece = null;
    const { newBest } = recordScore("blocks", this.score);
    sfx.lose();
    this.status();
    this.ctx.end({
      won: false,
      title: "Game over",
      lines: [`Score ${this.score}${newBest ? " — a new best" : ""}`, `${this.lines} lines, level ${this.level}`],
    });
  }

  private start() {
    recordStart("blocks");
    this.state = "playing";
    this.hide();
    this.spawn();
    this.last = performance.now();
  }

  private onBlur = () => {
    this.keys.clear();
    if (this.state === "playing") this.pause();
  };

  private pause() {
    this.state = "paused";
    this.show("Paused", "Press P or Esc to keep going");
  }

  private onDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.closest?.("select, input") || e.ctrlKey || e.metaKey) return;
    const k = e.code;
    const handled = ["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", "Space", "KeyX", "KeyZ", "KeyC", "ShiftLeft", "ShiftRight", "KeyP", "Escape", "KeyA", "KeyD", "KeyS", "KeyW"];
    if (!handled.includes(k)) return;
    e.preventDefault();
    if (e.repeat) return;
    if (this.state === "over") return;
    if (k === "KeyP" || k === "Escape") {
      if (this.state === "playing") this.pause();
      else if (this.state === "paused") {
        this.state = "playing";
        this.hide();
        this.last = performance.now();
      }
      return;
    }
    if (this.state === "ready") return this.start();
    if (this.state === "paused") {
      this.state = "playing";
      this.hide();
      this.last = performance.now();
    }
    if (!this.piece || this.clearing) {
      if (k === "ArrowLeft" || k === "ArrowRight" || k === "KeyA" || k === "KeyD") this.keys.set(k, { since: performance.now(), repeat: 0 });
      return;
    }
    switch (k) {
      case "ArrowLeft":
      case "KeyA":
        this.move(-1);
        this.keys.set(k, { since: performance.now(), repeat: 0 });
        break;
      case "ArrowRight":
      case "KeyD":
        this.move(1);
        this.keys.set(k, { since: performance.now(), repeat: 0 });
        break;
      case "ArrowDown":
      case "KeyS":
        this.keys.set("down", { since: performance.now(), repeat: 0 });
        break;
      case "ArrowUp":
      case "KeyX":
      case "KeyW":
        this.rotatePiece(1);
        break;
      case "KeyZ":
        this.rotatePiece(-1);
        break;
      case "Space":
        this.hardDrop();
        break;
      default:
        this.holdPiece();
    }
  };

  private onUp = (e: KeyboardEvent) => {
    if (e.code === "ArrowDown" || e.code === "KeyS") this.keys.delete("down");
    else this.keys.delete(e.code);
  };

  private gravityMs() {
    return Math.max(45, 800 * Math.pow(0.84, this.level - 1));
  }

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(now - this.last, 100);
    this.last = now;
    if (this.state === "playing") this.update(dt, now);
    this.draw();
  };

  private update(dt: number, now: number) {
    if (this.clearing) {
      this.clearing.t += dt;
      if (this.clearing.t > 200) this.finishClear();
      return;
    }
    if (!this.piece) return;
    // Auto-repeat sideways movement after a short delay.
    for (const [k, info] of this.keys) {
      if (k === "down") continue;
      const held = now - info.since;
      if (held < DAS) continue;
      const want = Math.floor((held - DAS) / ARR) + 1;
      while (info.repeat < want) {
        info.repeat++;
        if (!this.move(k === "ArrowLeft" || k === "KeyA" ? -1 : 1)) break;
      }
    }
    const soft = this.keys.has("down");
    const g = soft ? Math.min(40, this.gravityMs() / 8) : this.gravityMs();
    if (this.grounded()) {
      this.lockAcc += dt;
      if (this.lockAcc >= LOCK_MS) this.lock();
      return;
    }
    this.fallAcc += dt;
    while (this.fallAcc >= g && this.piece && !this.grounded()) {
      this.fallAcc -= g;
      this.piece.y += 1;
      if (soft) this.score += 1;
    }
    if (this.fallAcc >= g) this.fallAcc = 0;
  }

  private drawCell(x: number, y: number, color: string, s: number, alpha = 1) {
    const g = this.g;
    const pad = s * 0.06;
    g.globalAlpha = alpha;
    g.fillStyle = color;
    g.beginPath();
    g.roundRect(x + pad, y + pad, s - pad * 2, s - pad * 2, s * 0.18);
    g.fill();
    g.fillStyle = "rgba(255,255,255,0.18)";
    g.beginPath();
    g.roundRect(x + pad, y + pad, s - pad * 2, (s - pad * 2) * 0.38, [s * 0.18, s * 0.18, 0, 0]);
    g.fill();
    g.globalAlpha = 1;
  }

  private drawMini(kind: Kind, cx: number, cy: number, s: number) {
    const cells = SHAPES[kind];
    const xs = cells.map((c) => c[0]);
    const ys = cells.map((c) => c[1]);
    const w = Math.max(...xs) - Math.min(...xs) + 1;
    const h = Math.max(...ys) - Math.min(...ys) + 1;
    for (const [x, y] of cells)
      this.drawCell(cx + (x - Math.min(...xs) - w / 2) * s, cy + (y - Math.min(...ys) - h / 2) * s, COLORS[kind], s);
  }

  private draw() {
    const g = this.g;
    const s = this.cell;
    const c = this.colors;
    const ox = s * 6;
    const totalW = s * (W + 12);
    g.clearRect(0, 0, totalW, s * H);

    // Field
    g.fillStyle = c.board;
    g.beginPath();
    g.roundRect(ox, 0, s * W, s * H, s * 0.3);
    g.fill();
    g.fillStyle = c.line;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        g.beginPath();
        g.arc(ox + x * s + s / 2, y * s + s / 2, s * 0.05, 0, Math.PI * 2);
        g.fill();
      }

    const flash = this.clearing ? this.clearing.rows : [];
    for (let y = HIDDEN; y < H + HIDDEN; y++)
      for (let x = 0; x < W; x++) {
        const k = this.field[y][x];
        if (!k) continue;
        if (flash.includes(y)) {
          const t = this.clearing!.t / 200;
          this.drawCell(ox + x * s, (y - HIDDEN) * s, "#ffffff", s, 1 - t);
        } else this.drawCell(ox + x * s, (y - HIDDEN) * s, COLORS[k], s);
      }

    const p = this.piece;
    if (p) {
      let d = 0;
      while (!this.collides(p, 0, d + 1)) d++;
      for (const [cx, cy] of p.cells) {
        const y = p.y + cy + d - HIDDEN;
        if (y >= 0) this.drawCell(ox + (p.x + cx) * s, y * s, COLORS[p.kind], s, 0.22);
      }
      for (const [cx, cy] of p.cells) {
        const y = p.y + cy - HIDDEN;
        if (y >= 0) this.drawCell(ox + (p.x + cx) * s, y * s, COLORS[p.kind], s);
      }
    }

    // Side panels
    g.fillStyle = c.muted;
    g.font = `600 ${Math.round(s * 0.55)}px "Figtree Variable", sans-serif`;
    g.textAlign = "center";
    g.fillText("Hold", s * 2.7, s * 0.9);
    g.fillText("Next", ox + s * W + s * 3.3, s * 0.9);
    g.fillStyle = c.board;
    g.beginPath();
    g.roundRect(s * 0.4, s * 1.3, s * 4.6, s * 3.2, s * 0.3);
    g.fill();
    g.beginPath();
    g.roundRect(ox + s * W + s, s * 1.3, s * 4.6, s * 9, s * 0.3);
    g.fill();
    if (this.hold) {
      if (this.held) g.globalAlpha = 0.4;
      this.drawMini(this.hold, s * 2.7, s * 2.9, s * 0.8);
      g.globalAlpha = 1;
    }
    this.queue.slice(0, 3).forEach((k, i) => this.drawMini(k, ox + s * W + s * 3.3, s * (2.9 + i * 2.8), s * 0.8));

    g.textAlign = "left";
    const stat = (label: string, value: string, y: number) => {
      g.fillStyle = c.muted;
      g.font = `600 ${Math.round(s * 0.5)}px "Figtree Variable", sans-serif`;
      g.fillText(label, s * 0.5, y);
      g.fillStyle = c.ink;
      g.font = `700 ${Math.round(s * 0.9)}px "Bricolage Grotesque Variable", sans-serif`;
      g.fillText(value, s * 0.5, y + s * 1.05);
    };
    stat("Level", String(this.level), s * 6.2);
    stat("Lines", String(this.lines), s * 8.8);
  }

  private status() {
    this.ctx.setStatus([
      { label: "Score", value: String(this.score) },
      { label: "Best", value: String(Math.max(getStats("blocks").bestScore ?? 0, this.score)) },
    ]);
  }
}

export const blocks: GameModule = {
  id: "blocks",
  name: "Blocks",
  group: "arcade",
  blurb: "Stack falling pieces and clear full lines before the well fills up.",
  art: "blocks",
  hasUndo: false,
  statsKey: () => "blocks",
  create: (root, ctx) => new Blocks(root, ctx),
};
