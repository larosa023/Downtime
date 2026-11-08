import type { GameModule } from "../core/types";

const aCard = (x: number, y: number, red: boolean, label: string) =>
  `<g transform="translate(${x} ${y})"><rect class="a-card" width="38" height="54" rx="5"/><text class="${red ? "a-red" : "a-ink"} a-idx" x="6" y="15">${label}</text></g>`;
const aBack = (x: number, y: number) =>
  `<g transform="translate(${x} ${y})"><rect class="a-back" width="38" height="54" rx="5"/><rect class="a-back-line" x="4" y="4" width="30" height="46" rx="3"/></g>`;

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
  load: () => import("./impl/canfield"),
};
