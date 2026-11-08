import type { GameModule } from "../core/types";

export const g2048: GameModule = {
  id: "2048",
  name: "2048",
  group: "puzzles",
  blurb: "Slide tiles together. Match numbers until you reach 2048.",
  art: "2048",
  hasUndo: true,
  options: [
    {
      key: "size",
      label: "Board",
      default: "4",
      choices: [
        { value: "3", label: "3×3" },
        { value: "4", label: "4×4" },
        { value: "5", label: "5×5" },
        { value: "6", label: "6×6" },
      ],
    },
  ],
  keys: [
    ["Arrow keys or WASD", "Slide tiles"],
    ["Swipe", "Slide tiles"],
  ],
  statsKey: (o) => (o("size") && o("size") !== "4" ? `2048:${o("size")}` : "2048"),
  load: () => import("./impl/g2048"),
};
