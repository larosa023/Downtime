import { CardGame } from "../../cards/cardgame";
import { Card, makeCards, shuffle } from "../../cards/deck";
import { Pile, TableLayout } from "../../cards/table";
import { GameContext } from "../../core/types";
import { sfx } from "../../core/sound";


class Scorpion extends CardGame {
  constructor(root: HTMLElement, ctx: GameContext) {
    super(root, ctx, "save:scorpion");
  }

  variant() {
    return "std";
  }
  statsKey() {
    return "scorpion";
  }
  protected dealFrom() {
    return "stock";
  }

  protected deal() {
    const cards = shuffle(makeCards(1));
    this.piles = [
      { id: "stock", kind: "stock", cards: [] },
      ...[0, 1, 2, 3].map((i): Pile => ({ id: `f${i}`, kind: "foundation", cards: [] })),
      ...Array.from({ length: 7 }, (_, i): Pile => ({ id: `t${i}`, kind: "tableau", cards: [] })),
    ];
    // Seven columns of seven. The first four columns start with three cards face down.
    for (let row = 0; row < 7; row++)
      for (let col = 0; col < 7; col++) {
        const c = cards[row * 7 + col];
        c.up = !(col < 4 && row < 3);
        this.pile(`t${col}`).cards.push(c);
      }
    this.pile("stock").cards = cards.slice(49).map((c) => ({ ...c, up: false }));
  }

  protected layout(w: number, h: number): TableLayout {
    const pad = Math.max(16, w * 0.025);
    const gapK = 0.16;
    const cw = Math.min((w - pad * 2) / (8 + 7 * gapK + 0.3), (h - pad * 2) / (1.4 * 4.6));
    const ch = cw * 1.4;
    const gap = cw * gapK;
    const total = 8 * cw + 7 * gap + cw * 0.3;
    const left = (w - total) / 2;
    const slots: TableLayout["slots"] = {};
    for (let i = 0; i < 7; i++) slots[`t${i}`] = { x: left + i * (cw + gap), y: pad, fan: "down", maxH: h - pad * 2 };
    const sx = left + 7 * (cw + gap) + cw * 0.3;
    slots.stock = { x: sx, y: pad, fan: "none" };
    // Finished runs stack up below the stock.
    const fstep = Math.min(ch * 0.4, (h - pad * 2 - ch * 2 - gap) / 3);
    for (let i = 0; i < 4; i++) slots[`f${i}`] = { x: sx, y: pad + ch + gap * 2 + i * fstep, fan: "none", z: i * 20, ghost: i > 0 };
    return { cardW: cw, slots };
  }

  private fits(card: Card, to: Pile) {
    if (to.kind !== "tableau") return false;
    const top = this.top(to);
    if (!top) return card.rank === 13;
    return top.up && top.suit === card.suit && top.rank === card.rank + 1;
  }

  protected canPick(pile: Pile, index: number) {
    return pile.kind === "tableau" && !!pile.cards[index]?.up;
  }

  protected canDrop(from: Pile, index: number, to: Pile) {
    return from !== to && this.fits(from.cards[index], to);
  }

  protected tap(pile: Pile, index: number) {
    if (pile.kind === "stock") return this.dealStock();
    if (index < 0 || !this.canPick(pile, index)) return;
    const card = pile.cards[index];
    const others = this.piles.filter((p) => p.kind === "tableau" && p !== pile);
    const dest = others.find((p) => p.cards.length && this.fits(card, p)) || (index > 0 ? others.find((p) => this.fits(card, p)) : undefined);
    if (dest) this.userMove(pile, index, dest);
    else {
      this.table.nudge(card);
      sfx.error();
    }
  }

  /** The last three cards go one each onto the first three columns. */
  private dealStock() {
    const stock = this.pile("stock");
    if (!stock.cards.length) return;
    this.checkpoint();
    for (let i = 0; i < 3 && stock.cards.length; i++) {
      const c = stock.cards.pop()!;
      c.up = true;
      this.pile(`t${i}`).cards.push(c);
    }
    this.moves += 1;
    this.afterAction("deal");
  }

  private isRun(p: Pile, index: number) {
    const c = p.cards;
    if (!c[index]?.up) return false;
    for (let i = index; i < c.length - 1; i++) if (c[i + 1].suit !== c[i].suit || c[i + 1].rank !== c[i].rank - 1) return false;
    return true;
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
    return [{ label: "Stock", value: String(stock?.cards.length ?? 3) }];
  }

  protected isStuck() {
    if (this.piles.find((p) => p.id === "stock")?.cards.length) return false;
    for (const from of this.piles) {
      if (from.kind !== "tableau") continue;
      for (let i = 0; i < from.cards.length; i++) {
        if (!from.cards[i].up) continue;
        for (const to of this.piles) {
          if (to === from || !this.canDrop(from, i, to)) continue;
          if (!to.cards.length && i === 0) continue;
          return false;
        }
      }
    }
    return true;
  }

  protected isWon() {
    return this.piles.filter((p) => p.kind === "foundation").every((p) => p.cards.length === 13);
  }
}

export function create(root: HTMLElement, ctx: GameContext) {
  return new Scorpion(root, ctx).init();
}
