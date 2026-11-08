import { CardGame } from "../../cards/cardgame";
import { Card, makeCards, shuffle } from "../../cards/deck";
import { Pile, TableLayout } from "../../cards/table";
import { GameContext } from "../../core/types";
import { sfx } from "../../core/sound";
import { RECYCLE_MARK } from "../marks";

// Seven rows; row r holds r + 1 cards. x is in card-width units.
const SPOTS = Array.from({ length: 7 }, (_, r) => Array.from({ length: r + 1 }, (_, i) => ({ r, x: (6 - r) / 2 + i }))).flat();
const PASSES = 3;

class Pyramid extends CardGame {
  private passesLeft = PASSES - 1;
  private selected: number | null = null; // card id

  constructor(root: HTMLElement, ctx: GameContext) {
    super(root, ctx, "save:pyramid");
  }

  variant() {
    return "std";
  }
  statsKey() {
    return "pyramid";
  }
  protected dealFrom() {
    return "stock";
  }

  protected deal() {
    const cards = shuffle(makeCards(1)).map((c, i) => ({ ...c, up: i < 28 }));
    this.piles = [
      ...SPOTS.map((_, i): Pile => ({ id: `p${i}`, kind: "tableau", cards: [cards[i]] })),
      { id: "stock", kind: "stock", cards: cards.slice(28) },
      { id: "waste", kind: "waste", cards: [] },
      { id: "done", kind: "foundation", cards: [] },
    ];
    this.passesLeft = PASSES - 1;
    this.selected = null;
  }

  protected layout(w: number, h: number): TableLayout {
    const pad = Math.max(16, w * 0.025);
    const unitK = 1.04;
    const cw = Math.min((w - pad * 2) / (6 * unitK + 1 + 2 * 1.5), (h - pad * 2) / (1.4 * 4.05));
    const ch = cw * 1.4;
    const unit = cw * unitK;
    const pyrW = 6 * unit + cw;
    const left = (w - pyrW) / 2;
    const slots: TableLayout["slots"] = {};
    SPOTS.forEach((s, i) => {
      slots[`p${i}`] = { x: left + s.x * unit, y: pad + s.r * ch * 0.5, fan: "none", z: s.r * 10, ghost: true };
    });
    const sideL = Math.max(pad, left - cw * 1.5);
    slots.stock = { x: sideL, y: pad, fan: "none", mark: RECYCLE_MARK };
    slots.waste = { x: sideL, y: pad + ch + cw * 0.25, fan: "none" };
    slots.done = { x: Math.min(w - pad - cw, left + pyrW + cw * 0.5), y: pad, fan: "none" };
    return { cardW: cw, slots };
  }

  private covered(i: number) {
    const { r, x } = SPOTS[i];
    return SPOTS.some((s, j) => s.r === r + 1 && Math.abs(s.x - x) === 0.5 && this.piles[j].cards.length > 0);
  }

  /** Cards that can be paired right now. */
  private available(p: Pile): boolean {
    if (!p.cards.length) return false;
    if (p.kind === "waste") return true;
    if (p.kind !== "tableau") return false;
    return !this.covered(this.piles.indexOf(p));
  }

  private pileOf(cardId: number) {
    return this.piles.find((p) => p.cards.some((c) => c.id === cardId));
  }

  protected isSelected(c: Card) {
    return c.id === this.selected;
  }

  protected canPick(pile: Pile, index: number) {
    return index === pile.cards.length - 1 && this.available(pile);
  }

  protected canDrop(from: Pile, index: number, to: Pile) {
    if (from === to || !this.available(to)) return false;
    return from.cards[index].rank + this.top(to)!.rank === 13;
  }

  /** Dragging one card onto its partner removes both. */
  protected userMove(from: Pile, _index: number, to: Pile) {
    this.removePair(from, to);
  }

  private removePair(a: Pile, b: Pile | null) {
    this.checkpoint();
    const done = this.pile("done");
    done.cards.push({ ...a.cards.pop()!, up: true });
    if (b) done.cards.push({ ...b.cards.pop()!, up: true });
    this.selected = null;
    this.moves += 1;
    this.afterAction("flip");
    sfx.merge();
  }

  protected tap(pile: Pile, index: number) {
    if (pile.kind === "stock") return this.draw();
    if (index < 0 || !this.available(pile) || index !== pile.cards.length - 1) return;
    const card = pile.cards[index];
    if (card.rank === 13) return this.removePair(pile, null);
    if (this.selected === card.id) {
      this.selected = null;
    } else if (this.selected != null) {
      const other = this.pileOf(this.selected);
      const otherCard = other && this.top(other);
      if (other && otherCard && this.available(other) && otherCard.rank + card.rank === 13) return this.removePair(other, pile);
      this.selected = card.id;
      sfx.pick();
    } else {
      this.selected = card.id;
      sfx.pick();
    }
    this.table.render();
  }

  private draw() {
    const stock = this.pile("stock");
    const waste = this.pile("waste");
    if (!stock.cards.length) {
      if (!waste.cards.length || this.passesLeft <= 0) {
        this.ctx.toast(this.passesLeft <= 0 ? "No passes left through the deck." : "The deck is empty.");
        sfx.error();
        return;
      }
      this.checkpoint();
      stock.cards = waste.cards.reverse().map((c) => ({ ...c, up: false }));
      waste.cards = [];
      this.passesLeft -= 1;
    } else {
      this.checkpoint();
      const c = stock.cards.pop()!;
      c.up = true;
      waste.cards.push(c);
    }
    this.selected = null;
    this.moves += 1;
    this.afterAction("flip");
  }

  protected extraState() {
    return { passesLeft: this.passesLeft };
  }
  protected restoreExtra(x: unknown) {
    this.passesLeft = (x as { passesLeft?: number } | null)?.passesLeft ?? PASSES - 1;
    this.selected = null;
  }

  /** 5 points per pyramid card, 1 per deck card, and 50 for clearing the pyramid. */
  protected score() {
    const left = this.piles.filter((p) => p.kind === "tableau").reduce((n, p) => n + p.cards.length, 0);
    const done = this.piles.find((p) => p.id === "done")?.cards.length ?? 0;
    const fromPyramid = 28 - left;
    return fromPyramid * 5 + Math.max(0, done - fromPyramid) + (left === 0 ? 50 : 0);
  }

  protected extraStatus() {
    const left = this.piles.filter((p) => p.kind === "tableau" && p.cards.length).length;
    return [
      { label: "Passes", value: String(this.passesLeft + 1) },
      { label: "Left", value: String(left) },
    ];
  }

  protected isStuck() {
    const stock = this.piles.find((p) => p.id === "stock");
    const waste = this.piles.find((p) => p.id === "waste");
    if (!stock || !waste) return false;
    if (stock.cards.length || (waste.cards.length && this.passesLeft > 0)) return false;
    const open = this.piles.filter((p) => this.available(p)).map((p) => this.top(p)!.rank);
    if (open.includes(13)) return false;
    return !open.some((r, i) => open.some((s, j) => i !== j && r + s === 13));
  }

  protected isWon() {
    return this.piles.every((p) => p.kind !== "tableau" || !p.cards.length);
  }
}

export function create(root: HTMLElement, ctx: GameContext) {
  return new Pyramid(root, ctx).init();
}
