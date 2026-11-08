import type { GameModule } from "../core/types";

const aCard = (x: number, y: number, red: boolean, label: string) =>
  `<g transform="translate(${x} ${y})"><rect class="a-card" width="38" height="54" rx="5"/><text class="${red ? "a-red" : "a-ink"} a-idx" x="6" y="15">${label}</text></g>`;
const aBack = (x: number, y: number) =>
  `<g transform="translate(${x} ${y})"><rect class="a-back" width="38" height="54" rx="5"/><rect class="a-back-line" x="4" y="4" width="30" height="46" rx="3"/></g>`;

export const yukon: GameModule = {
  id: "yukon",
  name: "Yukon",
  group: "cards",
  blurb: "Like Klondike with no stock: move any face-up card, and everything on it.",
  art: "yukon",
  hasUndo: true,
  statsKey: () => "yukon",
  artSvg: `
    ${[0, 1, 2, 3, 4].map((i) => [...Array(i)].map((_, k) => aBack(14 + i * 40, 8 + k * 8)).join("") + [0, 1, 2].map((k) => aCard(14 + i * 40, 8 + i * 8 + k * 18, (i + k) % 2 === 0, ["K", "Q", "J", "10", "9", "8", "7"][(i + k) % 7])).join("")).join("")}
    ${[0, 1, 2, 3].map((i) => `<rect class="a-slot" x="218" y="${10 + i * 32}" width="22" height="28" rx="3"/>`).join("")}`,
  iconSvg: `<path d="M4 4h5v5H4zM4 11h5v9H4z"/><path d="M12 4h8v16h-8"/><path d="M12 9h8M12 14h8"/>`,
  load: () => import("./impl/yukon"),
};
