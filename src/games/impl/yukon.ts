import { CardGame } from "../../cards/cardgame";
import { Card, isRed, makeCards, shuffle, SUITS, suitSvg } from "../../cards/deck";
import { Pile, TableLayout } from "../../cards/table";
import { GameContext } from "../../core/types";
import { sfx } from "../../core/sound";


class Yukon extends CardGame {
  protected sendsOnTap = true;
  protected usesAutoMove = true;
  constructor(root: HTMLElement, ctx: GameContext) {
    super(root, ctx, "save:yukon");
  }

  variant() {
    return "std";
  }
  statsKey() {
    return "yukon";
  }
  protected dealFrom() {
    return "t3";
  }

  protected deal() {
    const cards = shuffle(makeCards(1));
    this.piles = [
      ...[0, 1, 2, 3].map((i): Pile => ({ id: `f${i}`, kind: "foundation", cards: [] })),
      ...Array.from({ length: 7 }, (_, i): Pile => ({ id: `t${i}`, kind: "tableau", cards: [] })),
    ];
    // Column i gets i face-down cards, then 5 face-up (column 0 gets a single card).
    let k = 0;
    for (let i = 0; i < 7; i++) {
      const n = i === 0 ? 1 : i + 5;
      for (let j = 0; j < n; j++) {
        const c = cards[k++];
        c.up = i === 0 || j >= i;
        this.pile(`t${i}`).cards.push(c);
      }
    }
  }

  protected layout(w: number, h: number): TableLayout {
    const pad = Math.max(16, w * 0.025);
    const gapK = 0.16;
    // Foundations sit in a column on the right.
    const cw = Math.min((w - pad * 2) / (8 + 7 * gapK + 0.3), (h - pad * 2) / (1.4 * 4.6));
    const ch = cw * 1.4;
    const gap = cw * gapK;
    const total = 8 * cw + 7 * gap + cw * 0.3;
    const left = (w - total) / 2;
    const slots: TableLayout["slots"] = {};
    for (let i = 0; i < 7; i++) slots[`t${i}`] = { x: left + i * (cw + gap), y: pad, fan: "down", maxH: h - pad * 2 };
    const fx = left + 7 * (cw + gap) + cw * 0.3;
    const fstep = Math.min(ch + gap, (h - pad * 2 - ch) / 3);
    for (let i = 0; i < 4; i++) slots[`f${i}`] = { x: fx, y: pad + i * fstep, fan: "none", mark: suitSvg(SUITS[i], "slot-suit") };
    return { cardW: cw, slots };
  }

  private fits(card: Card, count: number, to: Pile) {
    const top = this.top(to);
    if (to.kind === "foundation") {
      if (count !== 1) return false;
      return top ? top.suit === card.suit && top.rank === card.rank - 1 : card.rank === 1;
    }
    if (to.kind === "tableau") {
      if (!top) return card.rank === 13;
      return isRed(top.suit) !== isRed(card.suit) && top.rank === card.rank + 1;
    }
    return false;
  }

  // Any face-up card can move, along with everything on top of it.
  protected canPick(pile: Pile, index: number) {
    return pile.kind === "tableau" ? !!pile.cards[index]?.up : pile.kind === "foundation" && index === pile.cards.length - 1;
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
      (index > 0 || pile.kind !== "tableau" ? others.find((p) => p.kind === "tableau" && !p.cards.length && this.fits(card, n, p)) : undefined);
    if (dest) this.userMove(pile, index, dest);
    else {
      this.table.nudge(card);
      sfx.error();
    }
  }

  protected settle() {
    for (const p of this.piles) {
      const t = this.top(p);
      if (p.kind === "tableau" && t && !t.up) t.up = true;
    }
  }

  private foundHeight(red: boolean) {
    const found = this.piles.filter((p) => p.kind === "foundation");
    return Math.min(
      ...SUITS.filter((s) => isRed(s) === red).map((s) => found.find((p) => this.top(p)?.suit === s)?.cards.length ?? 0),
    );
  }

  protected autoplay() {
    for (const from of this.piles) {
      if (from.kind !== "tableau") continue;
      const c = this.top(from);
      if (!c || !c.up) continue;
      if (c.rank > 2 && this.foundHeight(!isRed(c.suit)) < c.rank - 1) continue;
      const to = this.piles.find((p) => p.kind === "foundation" && this.fits(c, 1, p));
      if (to) {
        this.transfer(from, from.cards.length - 1, to);
        this.moves += 1;
        return true;
      }
    }
    return false;
  }

  protected isStuck() {
    for (const from of this.piles) {
      if (from.kind !== "tableau") continue;
      for (let i = 0; i < from.cards.length; i++) {
        if (!from.cards[i].up) continue;
        for (const to of this.piles) {
          if (to === from || !this.canDrop(from, i, to)) continue;
          // Moving a King that's already at the bottom of a column to another empty column changes nothing.
          if (to.kind === "tableau" && !to.cards.length && i === 0) continue;
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
  return new Yukon(root, ctx).init();
}
