import { CardGame } from "../cards/cardgame";
import { Card, isRed, makeCards, shuffle, SUITS, suitSvg } from "../cards/deck";
import { Pile, TableLayout } from "../cards/table";
import { GameContext, GameModule } from "../core/types";
import { sfx } from "../core/sound";
import { CELL_MARK } from "./marks";

class FreeCell extends CardGame {
  constructor(root: HTMLElement, ctx: GameContext) {
    super(root, ctx, "save:freecell");
  }

  variant() {
    return "std";
  }
  statsKey() {
    return "freecell";
  }
  protected dealFrom() {
    return "c0";
  }

  protected deal() {
    const cards = shuffle(makeCards(1));
    this.piles = [
      ...[0, 1, 2, 3].map((i): Pile => ({ id: `c${i}`, kind: "cell", cards: [] })),
      ...[0, 1, 2, 3].map((i): Pile => ({ id: `f${i}`, kind: "foundation", cards: [] })),
      ...Array.from({ length: 8 }, (_, i): Pile => ({ id: `t${i}`, kind: "tableau", cards: [] })),
    ];
    cards.forEach((c, i) => {
      c.up = true;
      this.pile(`t${i % 8}`).cards.push(c);
    });
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

export const freecell: GameModule = {
  id: "freecell",
  name: "FreeCell",
  group: "cards",
  blurb: "Every card face up. Four free cells. Almost every deal can be won.",
  art: "freecell",
  hasUndo: true,
  statsKey: () => "freecell",
  create: (root, ctx) => new FreeCell(root, ctx).init(),
};
