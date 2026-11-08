import { CardGame } from "../../cards/cardgame";
import { Card, makeCards, shuffle } from "../../cards/deck";
import { Pile, TableLayout } from "../../cards/table";
import { GameContext } from "../../core/types";
import { sfx } from "../../core/sound";

class Golf extends CardGame {
  constructor(root: HTMLElement, ctx: GameContext) {
    super(root, ctx, "save:golf");
  }

  variant() {
    return "std";
  }
  statsKey() {
    return "golf";
  }
  protected dealFrom() {
    return "stock";
  }

  protected deal() {
    const cards = shuffle(makeCards(1));
    this.piles = [
      ...Array.from({ length: 7 }, (_, i): Pile => ({
        id: `t${i}`,
        kind: "tableau",
        cards: cards.slice(i * 5, i * 5 + 5).map((c) => ({ ...c, up: true })),
      })),
      { id: "stock", kind: "stock", cards: cards.slice(35, 51) },
      { id: "waste", kind: "waste", cards: [{ ...cards[51], up: true }] },
    ];
  }

  protected layout(w: number, h: number): TableLayout {
    const pad = Math.max(16, w * 0.025);
    const gapK = 0.18;
    const cw = Math.min((w - pad * 2) / (7 + 6 * gapK), (h - pad * 2) / (1.4 * 3.4));
    const ch = cw * 1.4;
    const gap = cw * gapK;
    const left = (w - (7 * cw + 6 * gap)) / 2;
    const slots: TableLayout["slots"] = {};
    const bottom = h - pad - ch;
    for (let i = 0; i < 7; i++) slots[`t${i}`] = { x: left + i * (cw + gap), y: pad, fan: "down", maxH: bottom - pad - gap };
    slots.stock = { x: w / 2 - cw - gap, y: bottom, fan: "none" };
    slots.waste = { x: w / 2 + gap, y: bottom, fan: "none" };
    return { cardW: cw, slots };
  }

  private fits(card: Card) {
    const top = this.top(this.pile("waste"));
    return !!top && Math.abs(card.rank - top.rank) === 1;
  }

  private playable(p: Pile) {
    const c = this.top(p);
    return p.kind === "tableau" && !!c && this.fits(c);
  }

  protected canPick(pile: Pile, index: number) {
    return pile.kind === "tableau" && index === pile.cards.length - 1;
  }

  protected canDrop(from: Pile, _index: number, to: Pile) {
    return to.kind === "waste" && this.playable(from);
  }

  protected tap(pile: Pile, index: number) {
    if (pile.kind === "stock") return this.draw();
    if (pile.kind !== "tableau" || index < 0) return;
    const top = pile.cards.length - 1;
    if (this.playable(pile)) this.userMove(pile, top, this.pile("waste"));
    else if (pile.cards[top]) {
      this.table.nudge(pile.cards[top]);
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
    this.moves += 1;
    this.afterAction("flip");
  }

  protected extraStatus() {
    const left = this.piles.reduce((n, p) => n + (p.kind === "tableau" ? p.cards.length : 0), 0);
    const stock = this.piles.find((p) => p.id === "stock")?.cards.length ?? 16;
    return [
      { label: "Left", value: String(left) },
      { label: "Stock", value: String(stock) },
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
  return new Golf(root, ctx).init();
}
