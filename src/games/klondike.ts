import { CardGame } from "../cards/cardgame";
import { Card, isRed, makeCards, shuffle, SUITS, suitSvg } from "../cards/deck";
import { Pile, TableLayout } from "../cards/table";
import { GameContext, GameModule } from "../core/types";
import { sfx } from "../core/sound";
import { RECYCLE_MARK } from "./marks";

class Klondike extends CardGame {
  private drawCount: number;

  constructor(root: HTMLElement, ctx: GameContext) {
    super(root, ctx, "save:klondike");
    this.drawCount = Number(ctx.option("draw")) || 1;
  }

  variant() {
    return `draw${this.drawCount}`;
  }
  statsKey() {
    return `klondike:${this.variant()}`;
  }
  protected dealFrom() {
    return "stock";
  }
  protected wasteFan() {
    return Math.min(this.drawCount, this.pile("waste").cards.length);
  }

  protected deal() {
    const cards = shuffle(makeCards(1));
    this.piles = [
      { id: "stock", kind: "stock", cards: [] },
      { id: "waste", kind: "waste", cards: [] },
      ...[0, 1, 2, 3].map((i): Pile => ({ id: `f${i}`, kind: "foundation", cards: [] })),
      ...[0, 1, 2, 3, 4, 5, 6].map((i): Pile => ({ id: `t${i}`, kind: "tableau", cards: [] })),
    ];
    let k = 0;
    for (let row = 0; row < 7; row++) {
      for (let col = row; col < 7; col++) {
        const c = cards[k++];
        c.up = col === row;
        this.pile(`t${col}`).cards.push(c);
      }
    }
    this.pile("stock").cards = cards.slice(k).map((c) => ({ ...c, up: false }));
  }

  protected layout(w: number, h: number): TableLayout {
    const pad = Math.max(16, w * 0.025);
    const gapK = 0.16;
    const cw = Math.min((w - pad * 2) / (7 + 6 * gapK), (h - pad * 2) / (1.4 * 3.9));
    const ch = cw * 1.4;
    const gap = cw * gapK;
    const left = (w - (7 * cw + 6 * gap)) / 2;
    const col = (i: number) => left + i * (cw + gap);
    const top = pad;
    const tabY = top + ch + gap * 1.6;
    const slots: TableLayout["slots"] = {
      stock: { x: col(0), y: top, fan: "none", mark: RECYCLE_MARK },
      waste: { x: col(1), y: top, fan: "waste" },
    };
    for (let i = 0; i < 4; i++)
      slots[`f${i}`] = { x: col(3 + i), y: top, fan: "none", mark: suitSvg(SUITS[i], "slot-suit") };
    for (let i = 0; i < 7; i++) slots[`t${i}`] = { x: col(i), y: tabY, fan: "down", maxH: h - tabY - pad };
    return { cardW: cw, slots };
  }

  protected canPick(pile: Pile, index: number) {
    const card = pile.cards[index];
    if (!card?.up) return false;
    if (pile.kind === "tableau") return true;
    return index === pile.cards.length - 1 && pile.kind !== "stock";
  }

  private fits(card: Card, count: number, to: Pile): boolean {
    const top = this.top(to);
    if (to.kind === "foundation") {
      if (count !== 1) return false;
      if (!top) return card.rank === 1;
      return top.suit === card.suit && top.rank === card.rank - 1;
    }
    if (to.kind === "tableau") {
      if (!top) return card.rank === 13;
      return top.up && isRed(top.suit) !== isRed(card.suit) && top.rank === card.rank + 1;
    }
    return false;
  }

  protected canDrop(from: Pile, index: number, to: Pile) {
    if (from === to) return false;
    return this.fits(from.cards[index], from.cards.length - index, to);
  }

  protected tap(pile: Pile, index: number) {
    if (pile.kind === "stock") return this.draw();
    if (index < 0 || !this.canPick(pile, index)) return;
    const card = pile.cards[index];
    const count = pile.cards.length - index;
    const dest =
      (count === 1 && this.piles.find((p) => p.kind === "foundation" && this.fits(card, 1, p))) ||
      this.piles.find((p) => p.kind === "tableau" && p !== pile && p.cards.length && this.fits(card, count, p)) ||
      this.piles.find((p) => p.kind === "tableau" && p !== pile && !p.cards.length && this.fits(card, count, p));
    if (dest) this.userMove(pile, index, dest);
    else {
      this.table.nudge(card);
      sfx.error();
    }
  }

  private draw() {
    const stock = this.pile("stock");
    const waste = this.pile("waste");
    if (!stock.cards.length && !waste.cards.length) return;
    this.checkpoint();
    if (!stock.cards.length) {
      stock.cards = waste.cards.reverse().map((c) => ({ ...c, up: false }));
      waste.cards = [];
    } else {
      const n = Math.min(this.drawCount, stock.cards.length);
      for (let i = 0; i < n; i++) {
        const c = stock.cards.pop()!;
        c.up = true;
        waste.cards.push(c);
      }
    }
    this.moves += 1;
    this.afterAction("flip");
  }

  protected settle() {
    for (const p of this.piles) {
      if (p.kind !== "tableau") continue;
      const t = this.top(p);
      if (t && !t.up) t.up = true;
    }
  }

  /** Once everything is face up, finish the game automatically. */
  protected autoplay() {
    if (this.pile("stock").cards.length || this.pile("waste").cards.length) return false;
    const tableaus = this.piles.filter((p) => p.kind === "tableau");
    if (tableaus.some((p) => p.cards.some((c) => !c.up))) return false;
    let best: { from: Pile; to: Pile; rank: number } | null = null;
    for (const from of tableaus) {
      const c = this.top(from);
      if (!c) continue;
      const to = this.piles.find((p) => p.kind === "foundation" && this.fits(c, 1, p));
      if (to && (!best || c.rank < best.rank)) best = { from, to, rank: c.rank };
    }
    if (!best) return false;
    this.transfer(best.from, best.from.cards.length - 1, best.to);
    this.moves += 1;
    return true;
  }

  protected isWon() {
    return this.piles.filter((p) => p.kind === "foundation").every((p) => p.cards.length === 13);
  }
}

export const klondike: GameModule = {
  id: "klondike",
  name: "Klondike",
  group: "cards",
  blurb: "The classic. Build each suit from Ace to King.",
  art: "klondike",
  hasUndo: true,
  options: [
    {
      key: "draw",
      label: "Draw",
      default: "1",
      choices: [
        { value: "1", label: "Draw 1" },
        { value: "3", label: "Draw 3" },
      ],
    },
  ],
  statsKey: (o) => `klondike:draw${o("draw")}`,
  create: (root, ctx) => new Klondike(root, ctx).init(),
};
