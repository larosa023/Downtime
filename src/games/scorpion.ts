import type { GameModule } from "../core/types";

const aCard = (x: number, y: number, red: boolean, label: string) =>
  `<g transform="translate(${x} ${y})"><rect class="a-card" width="38" height="54" rx="5"/><text class="${red ? "a-red" : "a-ink"} a-idx" x="6" y="15">${label}</text></g>`;
const aBack = (x: number, y: number) =>
  `<g transform="translate(${x} ${y})"><rect class="a-back" width="38" height="54" rx="5"/><rect class="a-back-line" x="4" y="4" width="30" height="46" rx="3"/></g>`;

export const scorpion: GameModule = {
  id: "scorpion",
  name: "Scorpion",
  group: "cards",
  blurb: "Build four same-suit runs from King to Ace. Any face-up card can move.",
  art: "scorpion",
  hasUndo: true,
  statsKey: () => "scorpion",
  artSvg: `
    ${[0, 1, 2, 3, 4].map((i) => (i < 3 ? [0, 1].map((k) => aBack(14 + i * 40, 8 + k * 9)).join("") : "") + [0, 1, 2].map((k) => aCard(14 + i * 40, (i < 3 ? 26 : 8) + k * 18, false, ["K", "Q", "J", "9", "8", "7", "5"][(i * 2 + k) % 7])).join("")).join("")}
    ${aBack(214, 10)}`,
  iconSvg: `<path d="M12 20v-4M8 16h8l-1-5H9z"/><path d="M9 11 7 6M15 11l2-5"/><path d="M12 11V8a3 3 0 0 1 6 0v1l-2 1"/>`,
  keys: [
    ["Click", "Send a card to the best spot"],
    ["Double-click", "Send a card when click-to-move is off"],
    ["Drag", "Move a card or run"],
    ["H", "Hint"],
    ["Click the stock", "Deal the last three cards"],
  ],
  load: () => import("./impl/scorpion"),
};
