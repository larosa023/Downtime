import { CardGame } from "../cards/cardgame";
import { Card, isRed, makeCards, rankLabel, shuffle, SUITS } from "../cards/deck";
import { Pile, TableLayout } from "../cards/table";
import { GameContext, GameModule } from "../core/types";
import { sfx } from "../core/sound";
import { RECYCLE_MARK } from "./marks";

const aCard = (x: number, y: number, red: boolean, label: string) =>
  `<g transform="translate(${x} ${y})"><rect class="a-card" width="38" height="54" rx="5"/><text class="${red ? "a-red" : "a-ink"} a-idx" x="6" y="15">${label}</text></g>`;
const aBack = (x: number, y: number) =>
  `<g transform="translate(${x} ${y})"><rect class="a-back" width="38" height="54" rx="5"/><rect class="a-back-line" x="4" y="4" width="30" height="46" rx="3"/></g>`;

/** Rank after r, wrapping King to Ace. */
const up = (r: number) => (r % 13) + 1;

class Canfield extends CardGame {
  private base = 1;

  constructor(root: HTMLElement, ctx: GameContext) {
    super(root, ctx, "save:canfield");
  }

  variant() {
    return "draw3";
  }
  statsKey() {
    return "canfield";
  }
  protected dealFrom() {
    return "stock";
  }
  protected wasteFan() {
    return Math.min(3, this.pile("waste").cards.length);
  }

  protected deal() {
    const cards = shuffle(makeCards(1));
    this.piles = [
      { id: "stock", kind: "stock", cards: [] },
      { id: "waste", kind: "waste", cards: [] },
      { id: "reserve", kind: "cell", cards: [] },
      ...[0, 1, 2, 3].map((i): Pile => ({ id: `f${i}`, kind: "foundation", cards: [] })),
      ...[0, 1, 2, 3].map((i): Pile => ({ id: `t${i}`, kind: "tableau", cards: [] })),
    ];
    this.pile("reserve").cards = cards.slice(0, 13).map((c, i) => ({ ...c, up: i === 12 }));
    // The next card starts the first foundation and sets the base rank for all four.
    const first = { ...cards[13], up: true };
    this.base = first.rank;
    this.pile("f0").cards.push(first);
    for (let i = 0; i < 4; i++) this.pile(`t${i}`).cards.push({ ...cards[14 + i], up: true });
    this.pile("stock").cards = cards.slice(18).map((c) => ({ ...c, up: false }));
  }

  protected layout(w: number, h: number): TableLayout {
    const pad = Math.max(16, w * 0.025);
    const gapK = 0.16;
    const cw = Math.min((w - pad * 2) / (7 + 6 * gapK), (h - pad * 2) / (1.4 * 3.9));
    const ch = cw * 1.4;
    const gap = cw * gapK;
    const left = (w - (7 * cw + 6 * gap)) / 2;
    const col = (i: number) => left + i * (cw + gap);
    const tabY = pad + ch + gap * 1.6;
    const mark = `<span class="slot-letter">${rankLabel(this.base)}</span>`;
    const slots: TableLayout["slots"] = {
      stock: { x: col(0), y: pad, fan: "none", mark: RECYCLE_MARK },
      waste: { x: col(1), y: pad, fan: "waste" },
      reserve: { x: col(0), y: tabY, fan: "none" },
    };
    for (let i = 0; i < 4; i++) slots[`f${i}`] = { x: col(3 + i), y: pad, fan: "none", mark };
    for (let i = 0; i < 4; i++) slots[`t${i}`] = { x: col(3 + i), y: tabY, fan: "down", maxH: h - tabY - pad };
    return { cardW: cw, slots };
  }

  private fits(card: Card, count: number, to: Pile) {
    const top = this.top(to);
    if (to.kind === "foundation") {
      if (count !== 1) return false;
      if (!top) return card.rank === this.base && !this.piles.some((p) => p.kind === "foundation" && this.top(p)?.suit === card.suit);
      return top.suit === card.suit && card.rank === up(top.rank) && top.rank !== (this.base + 11) % 13 + 1;
    }
    if (to.kind === "tableau") {
      if (!top) return true;
      return isRed(top.suit) !== isRed(card.suit) && up(card.rank) === top.rank;
    }
    return false;
  }

  /** Alternating colors, each one rank lower (Ace can take a King). */
  private isRun(p: Pile, index: number) {
    const c = p.cards;
    for (let i = index; i < c.length - 1; i++) if (isRed(c[i].suit) === isRed(c[i + 1].suit) || up(c[i + 1].rank) !== c[i].rank) return false;
    return index < c.length;
  }

  protected canPick(pile: Pile, index: number) {
    if (index < 0 || !pile.cards[index]?.up) return false;
    if (pile.kind === "tableau") return this.isRun(pile, index);
    return (pile.kind === "waste" || pile.kind === "cell") && index === pile.cards.length - 1;
  }

  protected canDrop(from: Pile, index: number, to: Pile) {
    if (from === to) return false;
    // While the reserve has cards, empty columns are filled from it automatically.
    if (to.kind === "tableau" && !to.cards.length && this.pile("reserve").cards.length) return false;
    return this.fits(from.cards[index], from.cards.length - index, to);
  }

  protected tap(pile: Pile, index: number) {
    if (pile.kind === "stock") return this.draw();
    if (!this.canPick(pile, index)) return;
    const card = pile.cards[index];
    const n = pile.cards.length - index;
    const others = this.piles.filter((p) => p !== pile);
    const dest =
      others.find((p) => p.kind === "foundation" && this.canDrop(pile, index, p)) ||
      others.find((p) => p.kind === "tableau" && p.cards.length && this.canDrop(pile, index, p)) ||
      (pile.kind !== "tableau" || index > 0 ? others.find((p) => p.kind === "tableau" && !p.cards.length && this.canDrop(pile, index, p)) : undefined);
    if (dest && n >= 1) this.userMove(pile, index, dest);
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
      for (let i = 0; i < 3 && stock.cards.length; i++) {
        const c = stock.cards.pop()!;
        c.up = true;
        waste.cards.push(c);
      }
    }
    this.moves += 1;
    this.afterAction("flip");
  }

  protected settle() {
    const reserve = this.pile("reserve");
    for (const p of this.piles) if (p.kind === "tableau" && !p.cards.length && reserve.cards.length) p.cards.push({ ...reserve.cards.pop()!, up: true });
    const t = this.top(reserve);
    if (t) t.up = true;
  }

  /** Distance of a rank above the base, 0 for the base card itself. */
  private rel(rank: number) {
    return (rank - this.base + 13) % 13;
  }

  protected autoplay() {
    const found = this.piles.filter((p) => p.kind === "foundation");
    const height = (red: boolean) =>
      Math.min(...SUITS.filter((s) => isRed(s) === red).map((s) => found.find((p) => this.top(p)?.suit === s)?.cards.length ?? 0));
    for (const from of this.piles) {
      if (from.kind !== "tableau" && from.kind !== "cell" && from.kind !== "waste") continue;
      const c = this.top(from);
      if (!c?.up) continue;
      const r = this.rel(c.rank);
      if (r > 1 && height(!isRed(c.suit)) < r) continue;
      const to = found.find((p) => this.fits(c, 1, p));
      if (to) {
        this.transfer(from, from.cards.length - 1, to);
        this.moves += 1;
        return true;
      }
    }
    return false;
  }

  protected extraState() {
    return { base: this.base };
  }
  protected restoreExtra(x: unknown) {
    this.base = (x as { base?: number } | null)?.base ?? this.base;
  }

  protected extraStatus() {
    const reserve = this.piles.find((p) => p.id === "reserve");
    return [{ label: "Reserve", value: String(reserve?.cards.length ?? 13) }];
  }

  protected isWon() {
    return this.piles.filter((p) => p.kind === "foundation").every((p) => p.cards.length === 13);
  }
}

export const canfield: GameModule = {
  id: "canfield",
  name: "Canfield",
  group: "cards",
  blurb: "Empty a 13-card reserve while building foundations up from a random starting rank.",
  art: "canfield",
  hasUndo: true,
  statsKey: () => "canfield",
  artSvg: `
    ${aBack(14, 10)}${aCard(60, 10, true, "4")}${aCard(70, 10, false, "9")}${aCard(80, 10, true, "J")}
    ${aCard(150, 10, true, "7")}${aCard(196, 10, false, "7")}
    ${[0, 1, 2].map((k) => aBack(14 + k * 2, 76 - k * 2)).join("")}${aCard(18, 74, false, "Q")}
    ${[0, 1, 2].map((i) => [0, 1].map((k) => aCard(110 + i * 46, 76 + k * 16, (i + k) % 2 === 0, ["8", "6", "K", "5", "A", "4"][(i * 2 + k) % 6])).join("")).join("")}`,
  iconSvg: `<rect x="4" y="4" width="8" height="11" rx="1.5"/><path d="M6 17v3h8v-3"/><rect x="14" y="9" width="6" height="11" rx="1.5"/>`,
  create: (root, ctx) => new Canfield(root, ctx).init(),
};
