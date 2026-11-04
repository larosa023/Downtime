import { Card } from "./deck";
import { CardTable, Pile, TableLayout } from "./table";
import { GameContext, GameInstance } from "../core/types";
import { GameTimer } from "../core/timer";
import { formatTime, recordLoss, recordStart, recordWin } from "../core/stats";
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
      tap: (p, i) => {
        if (!this.locked) this.tap(p, i);
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

  // ----- lifecycle -----

  newGame() {
    if (this.counted && !this.over) recordLoss(this.statsKey());
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
    if (this.busy) return;
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
    this.persist();
    this.timer.destroy();
    this.table.destroy();
  }

  resize() {
    this.table.render({ instant: true, relayout: true });
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
    if (this.locked) return;
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
      this.busy = window.setTimeout(step, 70);
    };
    step();
  }

  private checkStuck() {
    if (!this.isStuck()) return;
    this.over = true;
    this.timer.stop();
    recordLoss(this.statsKey());
    this.status();
    setTimeout(() => {
      if (!this.over) return;
      sfx.lose();
      this.ctx.end({ won: false, title: "No moves left", lines: ["Undo to try a different path, or deal again."] });
    }, 450);
  }

  private runAutoplay() {
    // Step through automatic moves one at a time so each one animates.
    if (this.busy) return;
    const step = () => {
      if (this.over || !this.autoplay()) {
        this.busy = 0;
        return;
      }
      this.settle();
      sfx.place();
      this.table.render();
      this.status();
      this.persist();
      this.checkWin();
      this.busy = window.setTimeout(step, 110);
    };
    this.busy = window.setTimeout(step, 160);
  }

  protected get locked() {
    return this.over;
  }

  private checkWin() {
    if (this.over || !this.isWon()) return;
    this.over = true;
    this.timer.stop();
    const seconds = Math.round(this.timer.seconds);
    const { newBestTime } = recordWin(this.statsKey(), seconds);
    remove(this.saveKey);
    sfx.win();
    this.celebrate();
    setTimeout(
      () =>
        this.ctx.end({
          won: true,
          title: "Solved",
          lines: [
            `${formatTime(seconds)}${newBestTime ? " — a new best" : ""}`,
            `${this.moves} moves`,
          ],
        }),
      700,
    );
  }

  /** A short cascade of the foundation cards. */
  private celebrate() {
    const cards = this.piles.filter((p) => p.kind === "foundation").flatMap((p) => p.cards);
    cards.forEach((c, i) => {
      const el = this.table.cardEl(c);
      if (!el) return;
      setTimeout(() => {
        el.classList.remove("bounce");
        void el.offsetWidth;
        el.classList.add("bounce");
      }, (i % 13) * 40 + Math.floor(i / 13) * 25);
    });
  }

  protected status() {
    this.ctx.setStatus([
      { label: "Time", value: formatTime(this.timer.seconds) },
      { label: "Moves", value: String(this.moves) },
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
