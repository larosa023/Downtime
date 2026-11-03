/** A game clock that starts on the first move and pauses when the window is hidden. */
export class GameTimer {
  private startedAt = 0;
  private accumulated = 0;
  private running = false;
  private interval: number | undefined;
  private onVisibility = () => {
    if (document.hidden) this.pause();
    else if (this.wasRunning) this.resume();
  };
  private wasRunning = false;

  constructor(private onTick: (seconds: number) => void) {
    document.addEventListener("visibilitychange", this.onVisibility);
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
    this.running = true;
    this.wasRunning = true;
    this.startedAt = performance.now();
    this.interval = window.setInterval(() => this.onTick(this.seconds), 250);
    this.onTick(this.seconds);
  }

  private pause() {
    if (!this.running) return;
    this.accumulated = this.seconds;
    this.running = false;
    clearInterval(this.interval);
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
    document.removeEventListener("visibilitychange", this.onVisibility);
  }
}
