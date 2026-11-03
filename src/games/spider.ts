import { CardGame } from "../cards/cardgame";
import { Card, makeCards, shuffle, Suit } from "../cards/deck";
import { Pile, TableLayout } from "../cards/table";
import { GameContext, GameModule } from "../core/types";
import { sfx } from "../core/sound";

const SUIT_SETS: Record<string, Suit[]> = {
  "1": ["S"],
  "2": ["S", "H"],
  "4": ["S", "H", "D", "C"],
};

class Spider extends CardGame {
  private suits: string;

  constructor(root: HTMLElement, ctx: GameContext) {
    super(root, ctx, "save:spider");
    this.suits = ctx.option("suits") in SUIT_SETS ? ctx.option("suits") : "1";
  }

  variant() {
    return `${this.suits}suit`;
  }
  statsKey() {
    return `spider:${this.variant()}`;
  }
  protected dealFrom() {
    return "stock";
  }

  protected deal() {
    const cards = shuffle(makeCards(2, SUIT_SETS[this.suits]));
    this.piles = [
      ...Array.from({ length: 10 }, (_, i): Pile => ({ id: `t${i}`, kind: "tableau", cards: [] })),
      ...Array.from({ length: 8 }, (_, i): Pile => ({ id: `f${i}`, kind: "foundation", cards: [] })),
      { id: "stock", kind: "stock", cards: [] },
    ];
    let k = 0;
    for (let i = 0; i < 54; i++) {
      const c = cards[k++];
      this.pile(`t${i % 10}`).cards.push(c);
    }
    for (let i = 0; i < 10; i++) this.top(this.pile(`t${i}`))!.up = true;
    this.pile("stock").cards = cards.slice(k);
  }

  protected layout(w: number, h: number): TableLayout {
    const pad = Math.max(14, w * 0.02);
    const gapK = 0.12;
    const cw = Math.min((w - pad * 2) / (10 + 9 * gapK), (h - pad * 2) / (1.4 * 4.4));
    const ch = cw * 1.4;
    const gap = cw * gapK;
    const left = (w - (10 * cw + 9 * gap)) / 2;
    const col = (i: number) => left + i * (cw + gap);
    const bottomY = h - pad - ch;
    const slots: TableLayout["slots"] = {};
    for (let i = 0; i < 10; i++) slots[`t${i}`] = { x: col(i), y: pad, fan: "down", maxH: bottomY - gap - pad };
    // Completed runs fan out along the bottom left; the stock sits bottom right.
    for (let i = 0; i < 8; i++) slots[`f${i}`] = { x: col(0) + i * cw * 0.32, y: bottomY, fan: "none", z: i * 20, ghost: i > 0 };
    slots.stock = { x: col(9), y: bottomY, fan: "none" };
    return { cardW: cw, slots };
  }

  /** Same-suit descending run from index to the end of the pile. */
  private isRun(p: Pile, index: number) {
    const cards = p.cards;
    if (!cards[index]?.up) return false;
    for (let i = index; i < cards.length - 1; i++) {
      if (cards[i + 1].suit !== cards[i].suit || cards[i + 1].rank !== cards[i].rank - 1) return false;
    }
    return true;
  }

  protected canPick(pile: Pile, index: number) {
    return pile.kind === "tableau" && this.isRun(pile, index);
  }

  private fits(card: Card, to: Pile) {
    if (to.kind !== "tableau") return false;
    const top = this.top(to);
    return !top || top.rank === card.rank + 1;
  }

  protected canDrop(from: Pile, index: number, to: Pile) {
    return from !== to && this.fits(from.cards[index], to);
  }

  protected tap(pile: Pile, index: number) {
    if (pile.kind === "stock") return this.dealRow();
    if (index < 0 || !this.canPick(pile, index)) return;
    const card = pile.cards[index];
    const others = this.piles.filter((p) => p.kind === "tableau" && p !== pile);
    const dest =
      others.find((p) => this.top(p)?.suit === card.suit && this.fits(card, p)) ||
      others.find((p) => p.cards.length && this.fits(card, p)) ||
      (index > 0 ? others.find((p) => !p.cards.length) : undefined);
    if (dest) this.userMove(pile, index, dest);
    else {
      this.table.nudge(card);
      sfx.error();
    }
  }

  private dealRow() {
    const stock = this.pile("stock");
    if (!stock.cards.length) return;
    const tableaus = this.piles.filter((p) => p.kind === "tableau");
    if (tableaus.some((p) => !p.cards.length)) {
      this.ctx.toast("Fill every column before dealing a new row.");
      sfx.error();
      return;
    }
    this.checkpoint();
    for (const p of tableaus) {
      const c = stock.cards.pop()!;
      c.up = true;
      p.cards.push(c);
    }
    this.moves += 1;
    this.afterAction("deal");
  }

  protected settle() {
    for (const p of this.piles) {
      if (p.kind !== "tableau") continue;
      const n = p.cards.length;
      if (n >= 13 && p.cards[n - 13].rank === 13 && this.isRun(p, n - 13)) {
        const f = this.piles.find((x) => x.kind === "foundation" && !x.cards.length);
        if (f) {
          f.cards = p.cards.splice(n - 13);
          setTimeout(() => sfx.merge(), 120);
        }
      }
      const t = this.top(p);
      if (t && !t.up) t.up = true;
    }
  }

  protected extraStatus() {
    const stock = this.piles.find((p) => p.id === "stock");
    return [{ label: "Deals left", value: String(Math.ceil((stock?.cards.length ?? 50) / 10)) }];
  }

  protected isWon() {
    return this.piles.filter((p) => p.kind === "foundation").every((p) => p.cards.length === 13);
  }
}

export const spider: GameModule = {
  id: "spider",
  name: "Spider",
  group: "cards",
  blurb: "Two decks, ten columns. Clear runs from King down to Ace.",
  art: "spider",
  hasUndo: true,
  options: [
    {
      key: "suits",
      label: "Suits",
      default: "1",
      choices: [
        { value: "1", label: "1 suit" },
        { value: "2", label: "2 suits" },
        { value: "4", label: "4 suits" },
      ],
    },
  ],
  statsKey: (o) => `spider:${o("suits")}suit`,
  create: (root, ctx) => new Spider(root, ctx).init(),
};
