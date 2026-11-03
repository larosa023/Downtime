export type Suit = "S" | "H" | "D" | "C";

export interface Card {
  id: number;
  suit: Suit;
  rank: number; // 1 = Ace … 13 = King
  up: boolean;
}

export const SUITS: Suit[] = ["S", "H", "D", "C"];

export const isRed = (s: Suit) => s === "H" || s === "D";

export const rankLabel = (r: number) =>
  r === 1 ? "A" : r === 11 ? "J" : r === 12 ? "Q" : r === 13 ? "K" : String(r);

const SUIT_NAMES: Record<Suit, string> = { S: "spades", H: "hearts", D: "diamonds", C: "clubs" };
const RANK_NAMES = ["", "Ace", "2", "3", "4", "5", "6", "7", "8", "9", "10", "Jack", "Queen", "King"];
export const cardName = (c: Card) => `${RANK_NAMES[c.rank]} of ${SUIT_NAMES[c.suit]}`;

/** Build `decks` full decks restricted to the given suits (repeated to keep 52 cards per deck). */
export function makeCards(decks: number, suits: Suit[] = SUITS): Card[] {
  const cards: Card[] = [];
  let id = 0;
  const perDeck = 4 / suits.length;
  for (let d = 0; d < decks; d++) {
    for (let rep = 0; rep < perDeck; rep++) {
      for (const suit of suits) {
        for (let rank = 1; rank <= 13; rank++) cards.push({ id: id++, suit, rank, up: false });
      }
    }
  }
  return cards;
}

export function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  const rnd = new Uint32Array(a.length);
  crypto.getRandomValues(rnd);
  for (let i = a.length - 1; i > 0; i--) {
    const j = rnd[i] % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** SVG symbols for the four suits, injected once into the document. */
export function installSuitSprite() {
  if (document.getElementById("suit-sprite")) return;
  const wrap = document.createElement("div");
  wrap.innerHTML = `
<svg id="suit-sprite" width="0" height="0" style="position:absolute" aria-hidden="true">
  <symbol id="s-H" viewBox="0 0 100 100"><path d="M50 90C22 68 5 52 5 31 5 16 16 6 29 6c9 0 16 5 21 13 5-8 12-13 21-13 13 0 24 10 24 25 0 21-17 37-45 59z"/></symbol>
  <symbol id="s-D" viewBox="0 0 100 100"><path d="M50 4 86 50 50 96 14 50z"/></symbol>
  <symbol id="s-S" viewBox="0 0 100 100"><path d="M50 4C78 28 95 42 95 61c0 14-10 23-23 23-8 0-15-4-19-10 1 9 5 16 13 22H34c8-6 12-13 13-22-4 6-11 10-19 10C15 84 5 75 5 61 5 42 22 28 50 4z"/></symbol>
  <symbol id="s-C" viewBox="0 0 100 100"><circle cx="50" cy="28" r="21"/><circle cx="27" cy="59" r="21"/><circle cx="73" cy="59" r="21"/><path d="M44 52c0 22-5 34-13 44h38c-8-10-13-22-13-44z"/></symbol>
</svg>`;
  document.body.prepend(wrap.firstElementChild!);
}

export const suitSvg = (s: Suit, cls = "") =>
  `<svg class="${cls}" viewBox="0 0 100 100" aria-hidden="true"><use href="#s-${s}"/></svg>`;
