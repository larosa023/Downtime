import { CardGame } from "../../cards/cardgame";
import { Card, makeCards, shuffle } from "../../cards/deck";
import { Pile, TableLayout } from "../../cards/table";
import { GameContext } from "../../core/types";
import { sfx } from "../../core/sound";

// Three peaks of 28 cards. Positions are in card-width units; row 3 is the base.
const ROWS: number[][] = [
  [1.5, 4.5, 7.5],
  [1, 2, 4, 5, 7, 8],
  [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5],
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
];
const SPOTS = ROWS.flatMap((xs, r) => xs.map((x) => ({ r, x })));

class TriPeaks extends CardGame {
  private streak = 0;
  private bestStreak = 0;
  private points = 0;

  constructor(root: HTMLElement, ctx: GameContext) {
    super(root, ctx, "save:tripeaks");
  }

  variant() {
    return "std";
  }
  statsKey() {
    return "tripeaks";
  }
  protected dealFrom() {
    return "stock";
  }

  protected deal() {
    const cards = shuffle(makeCards(1));
    this.piles = [
      ...SPOTS.map((_, i): Pile => ({ id: `p${i}`, kind: "tableau", cards: [cards[i]] })),
      { id: "stock", kind: "stock", cards: cards.slice(28, 51) },
      { id: "waste", kind: "waste", cards: [{ ...cards[51], up: true }] },
    ];
    this.streak = 0;
    this.bestStreak = 0;
    this.points = 0;
    this.settle();
  }

  protected layout(w: number, h: number): TableLayout {
    const pad = Math.max(16, w * 0.025);
    const unitK = 1.08;
    const cw = Math.min((w - pad * 2) / (9 * unitK + 1), (h - pad * 2) / (1.4 * 3.75));
    const ch = cw * 1.4;
    const unit = cw * unitK;
    const left = (w - (9 * unit + cw)) / 2;
    const rowStep = ch * 0.5;
    const slots: TableLayout["slots"] = {};
    SPOTS.forEach((s, i) => {
      slots[`p${i}`] = { x: left + s.x * unit, y: pad + s.r * rowStep, fan: "none", z: s.r * 10, ghost: true };
    });
    const bottom = pad + 3 * rowStep + ch + ch * 0.22;
    const mid = w / 2;
    slots.stock = { x: mid - cw - unit * 0.35, y: bottom, fan: "none" };
    slots.waste = { x: mid + unit * 0.35, y: bottom, fan: "none" };
    return { cardW: cw, slots };
  }

  private covered(i: number) {
    const { r, x } = SPOTS[i];
    return SPOTS.some((s, j) => s.r === r + 1 && Math.abs(s.x - x) === 0.5 && this.piles[j].cards.length > 0);
  }

  private fits(card: Card) {
    const top = this.top(this.pile("waste"));
    if (!top) return false;
    const d = Math.abs(card.rank - top.rank);
    return d === 1 || d === 12; // King and Ace connect
  }

  private playable(p: Pile) {
    if (p.kind !== "tableau" || !p.cards.length) return false;
    const i = this.piles.indexOf(p);
    return !this.covered(i) && this.fits(p.cards[0]);
  }

  protected canPick(pile: Pile, index: number) {
    return index === 0 && pile.kind === "tableau" && pile.cards[0]?.up === true;
  }

  protected canDrop(from: Pile, _index: number, to: Pile) {
    return to.kind === "waste" && this.playable(from);
  }

  protected userMove(from: Pile, index: number, to: Pile) {
    this.streak += 1;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    // Each card in a chain is worth one more than the last; clearing a peak adds 15, all three 30 more.
    this.points += this.streak;
    const peak = this.piles.indexOf(from);
    if (peak >= 0 && peak < 3) {
      this.points += 15;
      if ([0, 1, 2].every((i) => i === peak || !this.piles[i].cards.length)) this.points += 30;
    }
    super.userMove(from, index, to);
  }

  protected tap(pile: Pile, index: number) {
    if (pile.kind === "stock") return this.draw();
    if (pile.kind !== "tableau" || index < 0) return;
    if (this.playable(pile)) {
      this.userMove(pile, 0, this.pile("waste"));
    } else if (pile.cards[0]?.up) {
      this.table.nudge(pile.cards[0]);
      sfx.error();
    }
  }

  private draw() {
    const stock = this.pile("stock");
    if (!stock.cards.length) return;
    this.checkpoint();
    const c = stock.cards.pop()!;
    c.up = true;
    this.pile("waste").cards.push(c);
    this.streak = 0;
    this.moves += 1;
    this.afterAction("flip");
  }

  protected settle() {
    this.piles.forEach((p, i) => {
      if (p.kind === "tableau" && p.cards.length && !this.covered(i)) p.cards[0].up = true;
    });
  }

  protected extraState() {
    return { streak: this.streak, bestStreak: this.bestStreak, points: this.points };
  }
  protected restoreExtra(x: unknown) {
    const s = (x ?? {}) as { streak?: number; bestStreak?: number; points?: number };
    this.points = s.points ?? 0;
    this.streak = s.streak ?? 0;
    this.bestStreak = s.bestStreak ?? 0;
  }

  protected score() {
    return this.points;
  }

  protected extraStatus() {
    const left = this.piles.filter((p) => p.kind === "tableau" && p.cards.length).length;
    return [
      { label: "Streak", value: String(this.streak) },
      { label: "Left", value: String(left) },
    ];
  }

  protected isStuck() {
    if (this.piles.find((p) => p.id === "stock")?.cards.length) return false;
    return !this.piles.some((p) => this.playable(p));
  }

  protected isWon() {
    return this.piles.every((p) => p.kind !== "tableau" || !p.cards.length);
  }
}

export function create(root: HTMLElement, ctx: GameContext) {
  return new TriPeaks(root, ctx).init();
}
