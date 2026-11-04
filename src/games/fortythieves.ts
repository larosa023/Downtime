import { CardGame } from "../cards/cardgame";
import { Card, makeCards, shuffle, SUITS, suitSvg } from "../cards/deck";
import { Pile, TableLayout } from "../cards/table";
import { GameContext, GameModule } from "../core/types";
import { sfx } from "../core/sound";

const aCard = (x: number, y: number, red: boolean, label: string) =>
  `<g transform="translate(${x} ${y})"><rect class="a-card" width="38" height="54" rx="5"/><text class="${red ? "a-red" : "a-ink"} a-idx" x="6" y="15">${label}</text></g>`;
const aBack = (x: number, y: number) =>
  `<g transform="translate(${x} ${y})"><rect class="a-back" width="38" height="54" rx="5"/><rect class="a-back-line" x="4" y="4" width="30" height="46" rx="3"/></g>`;

class FortyThieves extends CardGame {
  constructor(root: HTMLElement, ctx: GameContext) {
    super(root, ctx, "save:fortythieves");
  }

  variant() {
    return "std";
  }
  statsKey() {
    return "fortythieves";
  }
  protected dealFrom() {
    return "stock";
  }

  protected deal() {
    const cards = shuffle(makeCards(2));
    this.piles = [
      { id: "stock", kind: "stock", cards: [] },
      { id: "waste", kind: "waste", cards: [] },
      ...Array.from({ length: 8 }, (_, i): Pile => ({ id: `f${i}`, kind: "foundation", cards: [] })),
      ...Array.from({ length: 10 }, (_, i): Pile => ({ id: `t${i}`, kind: "tableau", cards: [] })),
    ];
    for (let i = 0; i < 40; i++) this.pile(`t${i % 10}`).cards.push({ ...cards[i], up: true });
    this.pile("stock").cards = cards.slice(40).map((c) => ({ ...c, up: false }));
  }

  protected layout(w: number, h: number): TableLayout {
    const pad = Math.max(14, w * 0.02);
    const gapK = 0.12;
    const cw = Math.min((w - pad * 2) / (10 + 9 * gapK), (h - pad * 2) / (1.4 * 4.2));
    const ch = cw * 1.4;
    const gap = cw * gapK;
    const left = (w - (10 * cw + 9 * gap)) / 2;
    const col = (i: number) => left + i * (cw + gap);
    const tabY = pad + ch + gap * 1.6;
    const slots: TableLayout["slots"] = {
      stock: { x: col(0), y: pad, fan: "none" },
      waste: { x: col(1), y: pad, fan: "none" },
    };
    for (let i = 0; i < 8; i++) slots[`f${i}`] = { x: col(2 + i), y: pad, fan: "none", mark: suitSvg(SUITS[i % 4], "slot-suit") };
    for (let i = 0; i < 10; i++) slots[`t${i}`] = { x: col(i), y: tabY, fan: "down", maxH: h - tabY - pad };
    return { cardW: cw, slots };
  }

  private fits(card: Card, to: Pile) {
    const top = this.top(to);
    if (to.kind === "foundation") return top ? top.suit === card.suit && top.rank === card.rank - 1 : card.rank === 1;
    if (to.kind === "tableau") return !top || (top.suit === card.suit && top.rank === card.rank + 1);
    return false;
  }

  // One card at a time, from the top of a column or the waste.
  protected canPick(pile: Pile, index: number) {
    return (pile.kind === "tableau" || pile.kind === "waste") && index === pile.cards.length - 1 && index >= 0;
  }

  protected canDrop(from: Pile, index: number, to: Pile) {
    return from !== to && index === from.cards.length - 1 && this.fits(from.cards[index], to);
  }

  protected tap(pile: Pile, index: number) {
    if (pile.kind === "stock") return this.draw();
    if (index < 0 || !this.canPick(pile, index)) return;
    const card = pile.cards[index];
    const others = this.piles.filter((p) => p !== pile);
    const dest =
      others.find((p) => p.kind === "foundation" && this.fits(card, p)) ||
      others.find((p) => p.kind === "tableau" && p.cards.length && this.fits(card, p)) ||
      (pile.kind === "waste" || pile.cards.length > 1 ? others.find((p) => p.kind === "tableau" && !p.cards.length) : undefined);
    if (dest) this.userMove(pile, index, dest);
    else {
      this.table.nudge(card);
      sfx.error();
    }
  }

  private draw() {
    const stock = this.pile("stock");
    if (!stock.cards.length) {
      this.ctx.toast("The stock is used up. There's only one pass in Forty Thieves.");
      return;
    }
    this.checkpoint();
    const c = stock.cards.pop()!;
    c.up = true;
    this.pile("waste").cards.push(c);
    this.moves += 1;
    this.afterAction("flip");
  }

  /** Aces and twos always go straight home; nothing ever needs them in the tableau. */
  protected autoplay() {
    for (const from of this.piles) {
      if (from.kind !== "tableau" && from.kind !== "waste") continue;
      const c = this.top(from);
      if (!c || c.rank > 2) continue;
      const to = this.piles.find((p) => p.kind === "foundation" && this.fits(c, p));
      if (to) {
        this.transfer(from, from.cards.length - 1, to);
        this.moves += 1;
        return true;
      }
    }
    return false;
  }

  protected extraStatus() {
    const stock = this.piles.find((p) => p.id === "stock");
    return [{ label: "Stock", value: String(stock?.cards.length ?? 64) }];
  }

  protected isStuck() {
    if (this.piles.find((p) => p.id === "stock")?.cards.length) return false;
    for (const from of this.piles) {
      if (from.kind !== "tableau" && from.kind !== "waste") continue;
      const i = from.cards.length - 1;
      if (i < 0) continue;
      for (const to of this.piles) {
        if (to === from || !this.canDrop(from, i, to)) continue;
        if (to.kind === "tableau" && !to.cards.length && from.kind === "tableau" && i === 0) continue;
        return false;
      }
    }
    return true;
  }

  protected isWon() {
    return this.piles.filter((p) => p.kind === "foundation").every((p) => p.cards.length === 13);
  }
}

export const fortythieves: GameModule = {
  id: "fortythieves",
  name: "Forty Thieves",
  group: "cards",
  blurb: "Two decks, one pass through the stock, and only one card moves at a time.",
  art: "fortythieves",
  hasUndo: true,
  statsKey: () => "fortythieves",
  artSvg: `
    ${aBack(10, 8)}
    ${[0, 1, 2, 3, 4].map((i) => `<rect class="a-slot" x="${60 + i * 37}" y="8" width="32" height="44" rx="4"/>`).join("")}
    ${Array.from({ length: 6 }, (_, i) => [0, 1, 2].map((k) => aCard(10 + i * 39, 64 + k * 14, i % 2 === 1, ["9", "8", "7", "6", "5", "4"][(i + k) % 6])).join("")).join("")}`,
  iconSvg: `<rect x="3" y="5" width="7" height="10" rx="1.5"/><rect x="8" y="9" width="7" height="10" rx="1.5"/><rect x="14" y="5" width="7" height="10" rx="1.5"/>`,
  create: (root, ctx) => new FortyThieves(root, ctx).init(),
};
