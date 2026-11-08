// Shared game loop for the arcade games.
//
// - The simulation advances in fixed steps (default 120 Hz), so games play at the same speed
//   on 60, 120, 144 or 240 Hz screens.
// - Rendering gets the leftover fraction of a step for smooth interpolation.
// - The loop only runs while the game is live. When it stops, nothing is scheduled, so idle
//   games cost no CPU. Call redraw() to paint a single frame (resize, theme change, pause screen).
// - Battery saver (Settings) caps drawing at 30 fps; the simulation keeps its fixed rate.

import { getSettings } from "../../core/settings";

export interface LoopHooks {
  /** Advance the game by one fixed step of `dt` seconds. */
  step(dt: number): void;
  /** Draw. `alpha` is how far (0–1) the clock is between the last step and the next. */
  draw(alpha: number): void;
  /** Steps per second. */
  hz?: number;
}

export class GameLoop {
  private raf = 0;
  private last = 0;
  private acc = 0;
  private lastDraw = 0;
  private live = false;
  private pending = false;
  readonly stepMs: number;

  constructor(private hooks: LoopHooks) {
    this.stepMs = 1000 / (hooks.hz ?? 120);
  }

  get running(): boolean {
    return this.live;
  }

  /** Steps already taken but not yet "used up" by drawing, as a fraction of a step. */
  get alpha(): number {
    return this.acc / this.stepMs;
  }

  start(): void {
    if (this.live) return;
    this.live = true;
    this.last = performance.now();
    this.acc = 0;
    this.lastDraw = 0;
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.live = false;
    this.pending = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** Paint one frame on the next animation frame (no-op while running; the loop paints anyway). */
  redraw(): void {
    if (this.live || this.pending) return;
    this.pending = true;
    this.raf = requestAnimationFrame(() => {
      this.pending = false;
      if (!this.live) this.hooks.draw(1);
    });
  }

  private tick = (now: number) => {
    if (!this.live) return;
    this.raf = requestAnimationFrame(this.tick);
    if (getSettings().lowPower && now - this.lastDraw < 31) return;
    // Clamp long gaps (window hidden, breakpoints) so the game doesn't fast-forward.
    const dt = Math.min(now - this.last, 250);
    this.last = now;
    this.acc += dt;
    let n = 0;
    while (this.acc >= this.stepMs && this.live) {
      this.acc -= this.stepMs;
      this.hooks.step(this.stepMs / 1000);
      if (++n > 60) {
        this.acc = 0;
        break;
      }
    }
    this.lastDraw = now;
    this.hooks.draw(Math.min(1, this.acc / this.stepMs));
  };
}

/** Size a canvas for crisp drawing on high-DPI screens. Returns the device pixel ratio used. */
export function fitCanvas(canvas: HTMLCanvasElement, cssW: number, cssH: number): number {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const w = Math.max(1, Math.round(cssW * dpr));
  const h = Math.max(1, Math.round(cssH * dpr));
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  return dpr;
}

/** Rebuild the canvas when the device pixel ratio changes (moving to another monitor, zoom). */
export function watchDpr(fn: () => void): () => void {
  let mq: MediaQueryList | null = null;
  const arm = () => {
    mq?.removeEventListener("change", onChange);
    mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mq.addEventListener("change", onChange);
  };
  const onChange = () => {
    fn();
    arm();
  };
  arm();
  return () => mq?.removeEventListener("change", onChange);
}
