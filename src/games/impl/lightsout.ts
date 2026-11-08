import { GameContext, GameInstance } from "../../core/types";
import { GameTimer } from "../../core/timer";
import { formatTime, recordLoss, recordStart, recordWin } from "../../core/stats";
import { load, remove, save } from "../../core/storage";
import { sfx } from "../../core/sound";
import { animScale, getSettings, motionEnabled } from "../../core/settings";

const SIZES: Record<string, number> = { small: 5, medium: 6, large: 7, huge: 8 };
const SAVE = "save:lightsout";

function neighbors(i: number, n: number): number[] {
  const r = Math.floor(i / n);
  const c = i % n;
  const out = [i];
  if (r > 0) out.push(i - n);
  if (r < n - 1) out.push(i + n);
  if (c > 0) out.push(i - 1);
  if (c < n - 1) out.push(i + 1);
  return out;
}

/**
 * Fewest presses that turn every light off, found by Gaussian elimination
 * over GF(2) and then trying every combination of the free variables.
 */
export function minimalSolution(lights: boolean[], n: number): boolean[] | null {
  const N = n * n;
  // Augmented matrix: row j says which presses flip cell j, plus the target.
  const rows: number[][] = Array.from({ length: N }, (_, j) => {
    const row = Array(N + 1).fill(0);
    for (const k of neighbors(j, n)) row[k] = 1;
    row[N] = lights[j] ? 1 : 0;
    return row;
  });
  const pivotCol: number[] = [];
  let r = 0;
  for (let c = 0; c < N && r < N; c++) {
    let p = r;
    while (p < N && !rows[p][c]) p++;
    if (p === N) continue;
    [rows[r], rows[p]] = [rows[p], rows[r]];
    for (let k = 0; k < N; k++) {
      if (k !== r && rows[k][c]) for (let x = c; x <= N; x++) rows[k][x] ^= rows[r][x];
    }
    pivotCol.push(c);
    r++;
  }
  for (let k = r; k < N; k++) if (rows[k][N]) return null;
  const free = [...Array(N).keys()].filter((c) => !pivotCol.includes(c));
  let best: boolean[] | null = null;
  let bestCount = Infinity;
  for (let mask = 0; mask < 1 << free.length; mask++) {
    const x = Array(N).fill(0);
    free.forEach((c, b) => (x[c] = (mask >> b) & 1));
    for (let k = r - 1; k >= 0; k--) {
      const c = pivotCol[k];
      let v = rows[k][N];
      for (let y = c + 1; y < N; y++) if (rows[k][y]) v ^= x[y];
      x[c] = v;
    }
    const count = x.reduce((a, b) => a + b, 0);
    if (count < bestCount) {
      bestCount = count;
      best = x.map(Boolean);
    }
  }
  return best;
}

interface Saved {
  n: number;
  lights: boolean[];
  presses: number;
  target: number;
  level: number;
  seconds: number;
  counted: boolean;
}

class LightsOut implements GameInstance {
  private el: HTMLDivElement;
  private grid!: HTMLDivElement;
  private cells: HTMLButtonElement[] = [];
  private n: number;
  private size: string;
  private lights: boolean[] = [];
  private presses = 0;
  private target = 0;
  private level = 1;
  private history: boolean[][] = [];
  private timer: GameTimer;
  private over = false;
  private counted = false;
  private resizeObs: ResizeObserver;
  private paused = false;
  /** Keyboard cursor, shown once arrow keys are used. */
  private cursor = -1;

  constructor(root: HTMLElement, private ctx: GameContext) {
    this.size = ctx.option("size") in SIZES ? ctx.option("size") : "small";
    this.n = SIZES[this.size];
    this.el = document.createElement("div");
    this.el.className = "lightsout";
    root.appendChild(this.el);
    this.timer = new GameTimer(() => this.status());
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(this.el);
    window.addEventListener("keydown", this.onKey);

    const saved = load<Saved | null>(SAVE, null);
    if (saved && saved.n === this.n && saved.lights?.length === this.n * this.n) {
      this.lights = saved.lights;
      this.presses = saved.presses;
      this.target = saved.target;
      this.level = saved.level;
      this.counted = saved.counted;
      this.timer.reset(saved.seconds);
      this.build();
      this.status();
    } else this.newGame();
  }

  private get key() {
    return `lightsout:${this.size}`;
  }

  private get levelKey() {
    return `lightsout-level:${this.size}`;
  }

  newGame() {
    if (this.counted && !this.over) recordLoss(this.key);
    this.level = load<number>(this.levelKey, 1);
    const N = this.n * this.n;
    // Later levels start from more random presses, so more lights and longer solutions.
    const presses = Math.min(Math.round(N * 0.55), 2 + this.level * 2);
    let sol: boolean[] | null = null;
    for (let tries = 0; tries < 50; tries++) {
      const lights = Array(N).fill(false);
      const picks = [...Array(N).keys()].sort(() => Math.random() - 0.5).slice(0, presses);
      for (const p of picks) for (const k of neighbors(p, this.n)) lights[k] = !lights[k];
      if (!lights.some(Boolean)) continue;
      sol = minimalSolution(lights, this.n);
      this.lights = lights;
      if (sol && sol.filter(Boolean).length >= Math.min(presses, 3)) break;
    }
    this.target = sol ? sol.filter(Boolean).length : 0;
    this.presses = 0;
    this.history = [];
    this.over = false;
    this.counted = false;
    this.timer.reset();
    this.ctx.clearEnd();
    this.build(true);
    this.persist();
    this.status();
  }

  undo() {
    const h = this.history.pop();
    if (!h || this.over) return;
    this.lights = h;
    this.presses = Math.max(0, this.presses - 1);
    sfx.flip();
    this.paint();
    this.persist();
    this.status();
  }

  inProgress() {
    return this.counted && !this.over;
  }

  setPaused(paused: boolean) {
    this.paused = paused;
  }

  private onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.closest?.("select, input") || e.ctrlKey || e.metaKey || e.altKey || this.paused) return;
    const n = this.n;
    const k = e.key;
    if (k.startsWith("Arrow")) {
      e.preventDefault();
      if (this.cursor < 0) this.cursor = Math.floor(n / 2) * n + Math.floor(n / 2);
      else {
        const r = Math.floor(this.cursor / n);
        const c = this.cursor % n;
        const nr = (r + (k === "ArrowDown" ? 1 : k === "ArrowUp" ? -1 : 0) + n) % n;
        const nc = (c + (k === "ArrowRight" ? 1 : k === "ArrowLeft" ? -1 : 0) + n) % n;
        this.cursor = nr * n + nc;
      }
      this.paintCursor();
    } else if ((k === " " || k === "Enter") && this.cursor >= 0) {
      e.preventDefault();
      this.press(this.cursor);
    }
  };

  private paintCursor() {
    this.cells.forEach((c, i) => c.classList.toggle("cursor", i === this.cursor));
  }

  requestHint() {
    if (this.over || this.paused || !getSettings().hints) return;
    const sol = minimalSolution(this.lights, this.n);
    if (!sol) return;
    const i = sol.findIndex(Boolean);
    if (i < 0) return;
    const c = this.cells[i];
    c.classList.remove("hint");
    void c.offsetWidth;
    c.classList.add("hint");
  }

  destroy() {
    window.removeEventListener("keydown", this.onKey);
    this.persist();
    this.timer.destroy();
    this.resizeObs.disconnect();
    this.el.remove();
  }

  resize() {
    const r = this.el.getBoundingClientRect();
    const size = Math.min(r.width - 48, r.height - 48, 600);
    this.el.style.setProperty("--bsz", `${Math.max(220, size)}px`);
  }

  private persist() {
    if (this.over) return remove(SAVE);
    const data: Saved = {
      n: this.n,
      lights: this.lights,
      presses: this.presses,
      target: this.target,
      level: this.level,
      seconds: this.timer.seconds,
      counted: this.counted,
    };
    save(SAVE, data);
  }

  private build(intro = false) {
    this.el.innerHTML = `<div class="lo-grid" style="--n:${this.n}"></div>`;
    this.grid = this.el.querySelector(".lo-grid")!;
    this.cells = [];
    for (let i = 0; i < this.n * this.n; i++) {
      const b = document.createElement("button");
      b.className = "lo-cell";
      b.dataset.i = String(i);
      if (intro && motionEnabled()) b.style.animationDelay = `${(Math.floor(i / this.n) + (i % this.n)) * 25 * animScale()}ms`;
      else b.classList.add("no-intro");
      this.grid.appendChild(b);
      this.cells.push(b);
    }
    this.grid.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>(".lo-cell");
      if (b && !this.paused) this.press(Number(b.dataset.i));
    });
    this.resize();
    if (this.cursor >= this.n * this.n) this.cursor = -1;
    this.paintCursor();
    this.paint();
  }

  private paint() {
    this.lights.forEach((on, i) => {
      this.cells[i].classList.toggle("on", on);
      this.cells[i].setAttribute("aria-label", `Row ${Math.floor(i / this.n) + 1}, column ${(i % this.n) + 1}, ${on ? "on" : "off"}`);
    });
    this.ctx.setUndo(this.history.length > 0 && !this.over);
  }

  private press(i: number) {
    if (this.over) return;
    this.history.push(this.lights.slice());
    if (this.history.length > 300) this.history.shift();
    for (const k of neighbors(i, this.n)) this.lights[k] = !this.lights[k];
    this.presses++;
    if (!this.counted) {
      this.counted = true;
      recordStart(this.key);
    }
    this.timer.start();
    sfx.tick();
    this.cells[i].classList.remove("pressed", "hint");
    void this.cells[i].offsetWidth;
    this.cells[i].classList.add("pressed");
    this.paint();
    this.status();
    if (!this.lights.some(Boolean)) this.win();
    else this.persist();
  }

  private win() {
    this.over = true;
    this.timer.stop();
    const secs = Math.round(this.timer.seconds);
    const { newBestTime } = recordWin(this.key, secs);
    const perfect = this.presses <= this.target;
    save(this.levelKey, this.level + 1);
    remove(SAVE);
    sfx.win();
    this.paint();
    this.status();
    setTimeout(
      () =>
        this.ctx.end({
          won: true,
          title: perfect ? "Perfect" : "Lights out",
          lines: [
            `Level ${this.level} in ${this.presses} presses${perfect ? ", the fewest possible" : ` (best possible ${this.target})`}`,
            `${formatTime(secs)}${newBestTime ? " — a new best" : ""}. Next up: level ${this.level + 1}.`,
          ],
        }),
      500,
    );
  }

  private status() {
    this.ctx.setStatus([
      { label: "Level", value: String(this.level) },
      { label: "Presses", value: String(this.presses) },
      { label: "Fewest", value: String(this.target) },
      { label: "Time", value: formatTime(this.timer.seconds) },
    ]);
  }
}

export function create(root: HTMLElement, ctx: GameContext): GameInstance {
  return new LightsOut(root, ctx);
}
