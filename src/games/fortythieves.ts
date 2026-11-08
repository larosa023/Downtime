import type { GameModule } from "../core/types";

const aCard = (x: number, y: number, red: boolean, label: string) =>
  `<g transform="translate(${x} ${y})"><rect class="a-card" width="38" height="54" rx="5"/><text class="${red ? "a-red" : "a-ink"} a-idx" x="6" y="15">${label}</text></g>`;
const aBack = (x: number, y: number) =>
  `<g transform="translate(${x} ${y})"><rect class="a-back" width="38" height="54" rx="5"/><rect class="a-back-line" x="4" y="4" width="30" height="46" rx="3"/></g>`;

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
  keys: [
    ["Click", "Send a card to the best spot"],
    ["Double-click", "Send a card when click-to-move is off"],
    ["Drag", "Move a card or run"],
    ["H", "Hint"],
    ["Click the stock", "Turn the next card"],
  ],
  load: () => import("./impl/fortythieves"),
};
