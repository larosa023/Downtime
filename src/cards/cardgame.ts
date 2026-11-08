import { Card } from "./deck";
import { CardTable, Pile, TableLayout } from "./table";
import { GameContext, GameInstance } from "../core/types";
import { GameTimer } from "../core/timer";
import { formatTime, recordLoss, recordScore, recordStart, recordWin } from "../core/stats";
import { animScale, getSettings, motionEnabled } from "../core/settings";
import { load, remove, save } from "../core/storage";
import { sfx } from "../core/sound";

interface Snapshot {
  piles: { id: string; cards: Card[] }[];
  moves: number;
  extra: unknown;
}

interface SaveData extends Snapshot {
  seconds: number;
  variant: string;
  counted: boolean;
}

/**
 * Shared plumbing for the solitaire games: history/undo, timer, stats,
 * save-and-resume, and wiring to the CardTable renderer.
 */
export abstract class CardGame implements GameInstance {
  piles: Pile[] = [];
  moves = 0;
  protected history: Snapshot[] = [];
  protected table: CardTable;
  protected timer: GameTimer;
  protected over = false;
  private counted = false;
  private busy = 0;
  private paused = false;
  private celebrateTimers: number[] = [];
  private endTimer = 0;
  /** Games whose foundations follow the Auto-move setting. */
  protected usesAutoMove = false;
  /** Games where clicking a card sends it somewhere (follows the Click-to-move setting). */
  protected sendsOnTap = false;

  constructor(
    protected root: HTMLElement,
    protected ctx: GameContext,
    private saveKey: string,
  ) {
    this.timer = new GameTimer(() => this.status());
    this.table = new CardTable(root, {
      piles: () => this.piles,
      layout: (w, h) => this.layout(w, h),
      canPick: (p, i) => !this.locked && this.canPick(p, i),
      canDrop: (f, i, t) => this.canDrop(f, i, t),
      drop: (f, i, t) => this.userMove(f, i, t),
      tap: (p, i, double) => {
        if (this.locked) return;
        // With click-to-move off, a single click on a card does nothing; a double-click still sends it.
        if (this.sendsOnTap && !double && i >= 0 && p.kind !== "stock" && !getSettings().clickToMove) return;
        if (this.sendsOnTap && double && getSettings().clickToMove) return; // the first click already moved it
        this.tap(p, i);
      },
      wasteFan: () => this.wasteFan(),
      isSelected: (c) => this.isSelected(c),
    });
    root.tabIndex = -1;
  }

  /** Call right after construction (subclass fields aren't ready inside the base constructor). */
  init(): this {
    if (!this.resume()) this.newGame();
    return this;
  }

  // ----- to implement -----
  /** Short id of the current variant (e.g. draw count), used for stats and saves. */
  abstract variant(): string;
  abstract statsKey(): string;
  protected abstract deal(): void;
  protected abstract layout(w: number, h: number): TableLayout;
  protected abstract canPick(pile: Pile, index: number): boolean;
  protected abstract canDrop(from: Pile, index: number, to: Pile): boolean;
  protected abstract tap(pile: Pile, index: number): void;
  protected abstract isWon(): boolean;
  protected abstract dealFrom(): string;
  protected wasteFan(): number {
    return 1;
  }
  protected isSelected(_c: Card): boolean {
    return false;
  }
  /** True when no move is possible, which ends the game as a loss. */
  protected isStuck(): boolean {
    return false;
  }
  protected extraState(): unknown {
    return null;
  }
  protected restoreExtra(_x: unknown): void {}
  /** After each move, e.g. flip exposed cards or clear completed runs. Returns true if it changed anything. */
  protected settle(): void {}
  /** Auto-moves that run after a move settles (e.g. finish the game). */
  protected autoplay(): boolean {
    return false;
  }
  protected extraStatus(): { label: string; value: string }[] {
    return [];
  }
  /** Current score for games with classic scoring, or null. Shown in the status bar and kept as a best score. */
  protected score(): number | null {
    return null;
  }

  // ----- lifecycle -----

  newGame() {
    if (this.counted && !this.over) {
      recordLoss(this.statsKey());
      this.recordFinalScore();
    }
    this.stopCelebration();
    clearTimeout(this.endTimer);
    clearTimeout(this.busy);
    this.busy = 0;
    this.counted = false;
    this.over = false;
    this.moves = 0;
    this.history = [];
    this.timer.reset();
    this.ctx.clearEnd();
    this.table.clear();
    this.deal();
    this.table.render({ deal: { from: this.dealFrom() } });
    sfx.deal();
    this.persist();
    this.status();
  }

  undo() {
    if (this.busy || this.paused) return;
    if (this.locked && !this.over) return;
    const snap = this.history.pop();
    if (!snap) return;
    this.restore(snap);
    if (this.over) {
      this.over = false;
      this.ctx.clearEnd();
    }
    this.moves += 1; // undo counts as a move, like the classics
    sfx.flip();
    this.table.render();
    this.persist();
    this.status();
  }

  destroy() {
    this.stopCelebration();
    clearTimeout(this.endTimer);
    clearTimeout(this.busy);
    this.persist();
    this.timer.destroy();
    this.table.destroy();
  }

  resize() {
    this.table.render({ instant: true, relayout: true });
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    this.table.setPaused(paused);
    // Resume any automatic moves that were waiting.
    if (!paused && !this.over && !this.busy) this.runAutoplay();
  }

  inProgress(): boolean {
    return this.counted && !this.over && this.moves > 0;
  }

  /** Milliseconds scaled by the animation speed setting. */
  protected ms(base: number): number {
    const k = animScale();
    return Math.round(base * (k || 0.4));
  }

  // ----- helpers for subclasses -----

  pile(id: string): Pile {
    const p = this.piles.find((x) => x.id === id);
    if (!p) throw new Error(`no pile ${id}`);
    return p;
  }

  protected top(p: Pile): Card | undefined {
    return p.cards[p.cards.length - 1];
  }

  /** Record history; call before mutating piles for a user action. */
  protected checkpoint() {
    this.history.push(this.snapshot());
    if (this.history.length > 500) this.history.shift();
    if (!this.counted) {
      this.counted = true;
      recordStart(this.statsKey());
    }
    this.timer.start();
  }

  protected transfer(from: Pile, index: number, to: Pile) {
    const cards = from.cards.splice(index);
    to.cards.push(...cards);
  }

  /** The standard drag/tap move: checkpoint, move, settle, render. */
  protected userMove(from: Pile, index: number, to: Pile) {
    this.checkpoint();
    this.transfer(from, index, to);
    this.moves += 1;
    this.afterAction(to.kind === "foundation" ? "flip" : "place");
  }

  protected afterAction(sound: "place" | "flip" | "deal" | "none" = "place") {
    this.settle();
    this.ctx.setFinish(!this.over && this.canAutoFinish());
    if (sound !== "none") sfx[sound]();
    this.table.render();
    this.status();
    this.persist();
    this.checkWin();
    if (!this.over) this.checkStuck();
    if (!this.over) this.runAutoplay();
  }

  // ----- hints and auto-finish (shared by every solitaire) -----

  /** Legal moves, best first. Skips moves that obviously go nowhere. */
  protected findMoves(): { from: Pile; index: number; to: Pile; score: number }[] {
    const out: { from: Pile; index: number; to: Pile; score: number }[] = [];
    for (const from of this.piles) {
      if (from.kind === "foundation" || from.kind === "stock") continue;
      for (let index = 0; index < from.cards.length; index++) {
        if (!this.canPick(from, index)) continue;
        for (const to of this.piles) {
          if (to === from || to.kind === "stock" || !this.canDrop(from, index, to)) continue;
          let score = 10;
          if (to.kind === "foundation" || to.kind === "waste") score += 100;
          const below = from.cards[index - 1];
          if (below && !below.up) score += 50;
          if (from.kind === "waste" || from.kind === "cell") score += 8;
          if (to.kind === "cell") score -= 15;
          if (to.kind === "tableau" && !to.cards.length) {
            // Moving a whole column into an empty one changes nothing.
            if (index === 0 && from.kind === "tableau") continue;
            score -= 5;
          }
          if (from.kind === "tableau" && to.kind === "tableau" && below?.up && to.cards.length) {
            // Shuffling a run between two equally good spots is rarely useful.
            const top = to.cards[to.cards.length - 1];
            if (top.rank === below.rank) continue;
          }
          out.push({ from, index, to, score });
        }
      }
    }
    return out.sort((a, b) => b.score - a.score);
  }

  requestHint() {
    if (this.locked || !getSettings().hints) return;
    const best = this.findMoves()[0];
    if (best) {
      const target = best.to.cards[best.to.cards.length - 1];
      this.table.flash([...best.from.cards.slice(best.index), ...(target ? [target] : [])]);
      return;
    }
    const stock = this.piles.find((p) => p.kind === "stock");
    if (stock?.cards.length) {
      this.table.flash([stock.cards[stock.cards.length - 1]]);
      this.ctx.toast("No moves on the table. Deal from the stock.");
    } else this.ctx.toast("No moves found. Try Undo.");
  }

  /** True once every remaining card is face up with nothing left to deal and a foundation move exists. */
  protected canAutoFinish(): boolean {
    const found = this.piles.filter((p) => p.kind === "foundation");
    if (!found.length) return false;
    for (const p of this.piles) {
      if ((p.kind === "stock" || p.kind === "waste") && p.cards.length) return false;
      if (p.kind !== "foundation" && p.cards.some((c) => !c.up)) return false;
    }
    return this.nextFoundationMove() != null;
  }

  private nextFoundationMove(): { from: Pile; to: Pile } | null {
    for (const from of this.piles) {
      if (from.kind === "foundation" || !from.cards.length) continue;
      const i = from.cards.length - 1;
      if (!this.canPick(from, i)) continue;
      const to = this.piles.find((p) => p.kind === "foundation" && this.canDrop(from, i, p));
      if (to) return { from, to };
    }
    return null;
  }

  autoFinish() {
    if (this.locked || !this.canAutoFinish()) return;
    this.checkpoint();
    this.ctx.setFinish(false);
    const step = () => {
      if (this.paused) {
        this.busy = window.setTimeout(step, 200);
        return;
      }
      const m = this.over ? null : this.nextFoundationMove();
      if (!m) {
        this.busy = 0;
        this.ctx.setFinish(!this.over && this.canAutoFinish());
        return;
      }
      this.transfer(m.from, m.from.cards.length - 1, m.to);
      this.moves += 1;
      this.settle();
      sfx.place();
      this.table.render();
      this.status();
      this.persist();
      this.checkWin();
      this.busy = window.setTimeout(step, this.ms(70));
    };
    step();
  }

  private checkStuck() {
    if (!this.isStuck()) return;
    this.over = true;
    this.timer.stop();
    recordLoss(this.statsKey());
    this.recordFinalScore();
    this.status();
    this.endTimer = window.setTimeout(() => {
      if (!this.over) return;
      sfx.lose();
      this.ctx.end({ won: false, title: "No moves left", lines: ["Undo to try a different path, or deal again."] });
    }, 450);
  }

  private runAutoplay() {
    // Step through automatic moves one at a time so each one animates.
    if (this.busy) return;
    const step = () => {
      if (this.paused) {
        this.busy = 0;
        return;
      }
      if (this.over || !this.autoStep()) {
        this.busy = 0;
        return;
      }
      this.settle();
      sfx.place();
      this.table.render();
      this.status();
      this.persist();
      this.checkWin();
      this.busy = window.setTimeout(step, this.ms(110));
    };
    this.busy = window.setTimeout(step, this.ms(160));
  }

  /** One automatic move, following the Auto-move setting for games with foundations. */
  private autoStep(): boolean {
    if (!this.usesAutoMove) return this.autoplay();
    const mode = getSettings().autoMove;
    if (mode === "off") return false;
    if (mode === "all") {
      for (const from of this.piles) {
        if (from.kind === "foundation" || from.kind === "stock" || !from.cards.length) continue;
        const i = from.cards.length - 1;
        if (!from.cards[i].up || !this.canPick(from, i)) continue;
        const to = this.piles.find((p) => p.kind === "foundation" && this.canDrop(from, i, p));
        if (to) {
          this.transfer(from, i, to);
          this.moves += 1;
          return true;
        }
      }
    }
    return this.autoplay();
  }

  protected get locked() {
    return this.over || this.paused;
  }

  private recordFinalScore() {
    const sc = this.score();
    if (sc != null && sc > 0) recordScore(this.statsKey(), sc);
  }

  private checkWin() {
    if (this.over || !this.isWon()) return;
    this.over = true;
    this.timer.stop();
    const seconds = Math.round(this.timer.seconds);
    const { newBestTime } = recordWin(this.statsKey(), seconds);
    const sc = this.score();
    const best = sc != null && sc > 0 ? recordScore(this.statsKey(), sc).newBest : false;
    remove(this.saveKey);
    this.onWin();
    sfx.win();
    const long = this.celebrate();
    this.endTimer = window.setTimeout(
      () =>
        this.ctx.end({
          won: true,
          title: "Solved",
          lines: [
            `${formatTime(seconds)}${newBestTime ? " — a new best" : ""}`,
            `${this.moves} moves${sc != null ? `, score ${sc}${best ? " (best)" : ""}` : ""}`,
          ],
        }),
      long ? 1500 : 700,
    );
  }

  /** Hook for games that do something extra on a win (e.g. mark a daily deal done). */
  protected onWin(): void {}

  /** A short fountain of the winning cards. Returns false when skipped (setting or motion off). */
  private celebrate(): boolean {
    if (!getSettings().celebrate || !motionEnabled()) return false;
    let cards = this.piles.filter((p) => p.kind === "foundation").flatMap((p) => p.cards);
    // Games without foundations (TriPeaks, Golf, Pyramid) celebrate with the played pile.
    if (!cards.length) cards = this.piles.filter((p) => p.kind === "waste").flatMap((p) => p.cards).slice(-26);
    if (!cards.length) return false;
    const w = this.table.el.clientWidth;
    const k = animScale() || 1;
    // Newest cards first, so the top of each stack leaves first.
    const order = [...cards].reverse().slice(0, 52);
    order.forEach((c, i) => {
      const el = this.table.cardEl(c);
      const pos = this.table.cardPos(c);
      if (!el || !pos) return;
      const t = (i / Math.max(1, order.length - 1)) * 2 - 1; // -1..1
      const dx = t * w * 0.32 + (Math.random() - 0.5) * 40;
      const dy = -(120 + Math.random() * 140);
      el.style.setProperty("--fx", `${dx.toFixed(0)}px`);
      el.style.setProperty("--fy", `${dy.toFixed(0)}px`);
      el.style.setProperty("--fr", `${(t * 24 + (Math.random() - 0.5) * 16).toFixed(1)}deg`);
      this.celebrateTimers.push(
        window.setTimeout(() => el.classList.add("fountain"), Math.round(i * 18 * k)),
        window.setTimeout(() => el.classList.remove("fountain"), Math.round((i * 18 + 1000) * k)),
      );
    });
    const skip = () => this.stopCelebration();
    this.table.el.addEventListener("pointerdown", skip, { once: true });
    this.celebrateTimers.push(window.setTimeout(() => this.table.el.removeEventListener("pointerdown", skip), 2000 * k));
    return true;
  }

  private stopCelebration() {
    this.celebrateTimers.forEach(clearTimeout);
    this.celebrateTimers = [];
    this.table.el.querySelectorAll(".fountain").forEach((e) => e.classList.remove("fountain"));
  }

  protected status() {
    const sc = this.score();
    this.ctx.setStatus([
      { label: "Time", value: formatTime(this.timer.seconds) },
      { label: "Moves", value: String(this.moves) },
      ...(sc != null ? [{ label: "Score", value: String(sc) }] : []),
      ...this.extraStatus(),
    ]);
    this.ctx.setUndo(this.history.length > 0 && !this.over);
  }

  private snapshot(): Snapshot {
    return {
      piles: this.piles.map((p) => ({ id: p.id, cards: p.cards.map((c) => ({ ...c })) })),
      moves: this.moves,
      extra: structuredClone(this.extraState()),
    };
  }

  private restore(s: Snapshot) {
    for (const sp of s.piles) {
      const p = this.piles.find((x) => x.id === sp.id);
      if (p) p.cards = sp.cards.map((c) => ({ ...c }));
    }
    this.moves = s.moves;
    this.restoreExtra(structuredClone(s.extra));
  }

  private persist() {
    if (this.over) return;
    const data: SaveData = {
      ...this.snapshot(),
      seconds: this.timer.seconds,
      variant: this.variant(),
      counted: this.counted,
    };
    save(this.saveKey, data);
  }

  private resume(): boolean {
    const data = load<SaveData | null>(this.saveKey, null);
    if (!data || data.variant !== this.variant()) return false;
    this.deal(); // builds the pile structure
    this.restore(data);
    this.counted = data.counted;
    this.timer.reset(data.seconds); // resumes ticking on the next move
    requestAnimationFrame(() => {
      this.table.render({ instant: true, relayout: true });
      this.status();
    });
    return true;
  }
}
