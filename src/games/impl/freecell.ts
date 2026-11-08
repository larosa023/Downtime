import { CardGame } from "../../cards/cardgame";
import { Card, isRed, SUITS, Suit, suitSvg } from "../../cards/deck";
import { Pile, TableLayout } from "../../cards/table";
import { GameContext } from "../../core/types";
import { sfx } from "../../core/sound";
import { dailyRng } from "../../core/rng";
import { markDailyDone } from "../../core/daily";

const MS_SUITS: Suit[] = ["C", "D", "H", "S"];

/** The classic Microsoft FreeCell deal for a game number (1–32000): columns of cards, left to right. */
export function msDeal(n: number): Card[][] {
  let seed = n >>> 0;
  const rand = () => {
    seed = (seed * 214013 + 2531011) % 2147483648;
    return Math.floor(seed / 65536);
  };
  // Card i is rank floor(i / 4) + 1 of suit MS_SUITS[i % 4].
  const deck = Array.from({ length: 52 }, (_, i) => i);
  const cols: Card[][] = Array.from({ length: 8 }, () => []);
  for (let left = 52, k = 0; left > 0; left--, k++) {
    const j = rand() % left;
    const v = deck[j];
    deck[j] = deck[left - 1];
    cols[k % 8].push({ id: v, suit: MS_SUITS[v % 4], rank: Math.floor(v / 4) + 1, up: true });
  }
  return cols;
}

/** Today's deal number, the same for everyone. */
export const dailyDeal = () => 1 + Math.floor(dailyRng("freecell")() * 32000);
import { CELL_MARK } from "../marks";

class FreeCell extends CardGame {
  protected sendsOnTap = true;
  protected usesAutoMove = true;
  private daily: boolean;
  private dealNo = 0;

  constructor(root: HTMLElement, ctx: GameContext) {
    const daily = ctx.option("mode") === "daily";
    // Daily deals keep their own save, so a random game in progress isn't lost.
    super(root, ctx, daily ? "save:freecell:daily" : "save:freecell");
    this.daily = daily;
  }

  variant() {
    // Includes the date for the daily deal, so yesterday's never resumes.
    return this.daily ? `daily-${dailyDeal()}` : "std";
  }
  statsKey() {
    return this.daily ? "freecell:daily" : "freecell";
  }
  protected onWin() {
    if (this.daily) markDailyDone("freecell");
  }
  protected extraState() {
    return { deal: this.dealNo };
  }
  protected restoreExtra(x: unknown) {
    this.dealNo = (x as { deal?: number } | null)?.deal ?? 0;
  }
  protected extraStatus() {
    return this.dealNo ? [{ label: "Deal", value: `#${this.dealNo}` }] : [];
  }
  protected dealFrom() {
    return "c0";
  }

  protected deal() {
    const n = this.daily ? dailyDeal() : 1 + (crypto.getRandomValues(new Uint32Array(1))[0] % 32000);
    this.dealNo = n;
    const cols = msDeal(n);
    this.piles = [
      ...[0, 1, 2, 3].map((i): Pile => ({ id: `c${i}`, kind: "cell", cards: [] })),
      ...[0, 1, 2, 3].map((i): Pile => ({ id: `f${i}`, kind: "foundation", cards: [] })),
      ...Array.from({ length: 8 }, (_, i): Pile => ({ id: `t${i}`, kind: "tableau", cards: [] })),
    ];
    cols.forEach((col, i) => (this.pile(`t${i}`).cards = col));
  }

  protected layout(w: number, h: number): TableLayout {
    const pad = Math.max(16, w * 0.025);
    const gapK = 0.14;
    const cw = Math.min((w - pad * 2) / (8 + 7 * gapK + 0.3), (h - pad * 2) / (1.4 * 4.3));
    const ch = cw * 1.4;
    const gap = cw * gapK;
    const rowW = 8 * cw + 7 * gap;
    const left = (w - rowW) / 2;
    const col = (i: number) => left + i * (cw + gap);
    const tabY = pad + ch + gap * 1.8;
    const slots: TableLayout["slots"] = {};
    // A little extra space separates free cells from foundations.
    const split = cw * 0.3;
    for (let i = 0; i < 4; i++) slots[`c${i}`] = { x: col(i) - split / 2, y: pad, fan: "none", mark: CELL_MARK };
    for (let i = 0; i < 4; i++)
      slots[`f${i}`] = { x: col(4 + i) + split / 2, y: pad, fan: "none", mark: suitSvg(SUITS[i], "slot-suit") };
    for (let i = 0; i < 8; i++) slots[`t${i}`] = { x: col(i), y: tabY, fan: "down", maxH: h - tabY - pad };
    return { cardW: cw, slots };
  }

  private isRun(p: Pile, index: number) {
    const c = p.cards;
    for (let i = index; i < c.length - 1; i++) {
      if (isRed(c[i].suit) === isRed(c[i + 1].suit) || c[i + 1].rank !== c[i].rank - 1) return false;
    }
    return index < c.length;
  }

  /** How many cards can move at once, given free cells and empty columns. */
  private capacity(toEmpty: boolean) {
    const cells = this.piles.filter((p) => p.kind === "cell" && !p.cards.length).length;
    let empties = this.piles.filter((p) => p.kind === "tableau" && !p.cards.length).length;
    if (toEmpty) empties -= 1;
    return (cells + 1) * 2 ** Math.max(0, empties);
  }

  protected canPick(pile: Pile, index: number) {
    if (pile.kind === "tableau") return this.isRun(pile, index) && pile.cards.length - index <= this.capacity(false);
    return index === pile.cards.length - 1;
  }

  private fits(card: Card, count: number, to: Pile) {
    const top = this.top(to);
    switch (to.kind) {
      case "cell":
        return count === 1 && !top;
      case "foundation":
        return count === 1 && (top ? top.suit === card.suit && top.rank === card.rank - 1 : card.rank === 1);
      case "tableau":
        if (count > this.capacity(!top)) return false;
        return !top || (isRed(top.suit) !== isRed(card.suit) && top.rank === card.rank + 1);
      default:
        return false;
    }
  }

  protected canDrop(from: Pile, index: number, to: Pile) {
    return from !== to && this.fits(from.cards[index], from.cards.length - index, to);
  }

  protected tap(pile: Pile, index: number) {
    if (index < 0 || !this.canPick(pile, index)) return;
    const card = pile.cards[index];
    const n = pile.cards.length - index;
    const others = this.piles.filter((p) => p !== pile);
    const dest =
      others.find((p) => p.kind === "foundation" && this.fits(card, n, p)) ||
      others.find((p) => p.kind === "tableau" && p.cards.length && this.fits(card, n, p)) ||
      (pile.kind !== "tableau" || pile.cards.length > n
        ? others.find((p) => p.kind === "tableau" && !p.cards.length && this.fits(card, n, p))
        : undefined) ||
      (pile.kind === "tableau" ? others.find((p) => p.kind === "cell" && this.fits(card, n, p)) : undefined);
    if (dest) this.userMove(pile, index, dest);
    else {
      this.table.nudge(card);
      sfx.error();
    }
  }

  /** Send cards home when nothing could ever need them in the tableau. */
  protected autoplay() {
    const found = this.piles.filter((p) => p.kind === "foundation");
    const height = (red: boolean) =>
      Math.min(
        ...SUITS.filter((s) => isRed(s) === red).map((s) => {
          const f = found.find((p) => this.top(p)?.suit === s);
          return f ? f.cards.length : 0;
        }),
      );
    for (const from of this.piles) {
      if (from.kind !== "tableau" && from.kind !== "cell") continue;
      const c = this.top(from);
      if (!c) continue;
      const safe = c.rank <= 2 || height(!isRed(c.suit)) >= c.rank - 1;
      if (!safe) continue;
      const to = found.find((p) => this.fits(c, 1, p));
      if (to) {
        this.transfer(from, from.cards.length - 1, to);
        this.moves += 1;
        return true;
      }
    }
    return false;
  }

  protected isWon() {
    return this.piles.filter((p) => p.kind === "foundation").every((p) => p.cards.length === 13);
  }
}

export function create(root: HTMLElement, ctx: GameContext) {
  return new FreeCell(root, ctx).init();
}
