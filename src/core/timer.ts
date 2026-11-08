// The shell's pause (P key, overlay, auto-pause on focus loss) freezes every clock at once.
let globallyPaused = false;
const timers = new Set<GameTimer>();

export function setGlobalPause(paused: boolean): void {
  if (paused === globallyPaused) return;
  globallyPaused = paused;
  timers.forEach((t) => t.syncPause());
}

export function isGloballyPaused(): boolean {
  return globallyPaused;
}

/** A game clock that starts on the first move and pauses when the window is hidden or the shell pauses. */
export class GameTimer {
  private startedAt = 0;
  private accumulated = 0;
  private running = false;
  private interval: number | undefined;
  private onVisibility = () => this.syncPause();

  /** Pause or resume to match the window and the shell's pause state. */
  syncPause() {
    if (document.hidden || globallyPaused) this.pause();
    else if (this.wasRunning) this.resume();
  }
  private wasRunning = false;

  constructor(private onTick: (seconds: number) => void) {
    document.addEventListener("visibilitychange", this.onVisibility);
    timers.add(this);
  }

  get seconds(): number {
    const live = this.running ? (performance.now() - this.startedAt) / 1000 : 0;
    return this.accumulated + live;
  }

  get started(): boolean {
    return this.running || this.accumulated > 0;
  }

  start() {
    if (this.running) return;
    this.wasRunning = true;
    if (globallyPaused || document.hidden) return;
    this.running = true;
    this.startedAt = performance.now();
    // Tick once per displayed second instead of polling, so idle games cost next to nothing.
    const tick = () => {
      this.onTick(this.seconds);
      const ms = (this.seconds * 1000) % 1000;
      this.interval = window.setTimeout(tick, 1000 - ms + 5);
    };
    tick();
  }

  private pause() {
    if (!this.running) return;
    this.accumulated = this.seconds;
    this.running = false;
    clearTimeout(this.interval);
  }

  private resume() {
    this.start();
  }

  stop() {
    this.pause();
    this.wasRunning = false;
    this.onTick(this.seconds);
  }

  reset(seconds = 0) {
    this.pause();
    this.wasRunning = false;
    this.accumulated = seconds;
    this.onTick(this.seconds);
  }

  destroy() {
    this.pause();
    timers.delete(this);
    document.removeEventListener("visibilitychange", this.onVisibility);
  }
}
