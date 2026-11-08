import type { GameModule } from "../core/types";

export const mahjong: GameModule = {
  id: "mahjong",
  name: "Mahjong",
  group: "puzzles",
  blurb: "Match free tiles in pairs until the board is clear. Press H for a hint.",
  art: "mahjong",
  hasUndo: true,
  daily: true,
  options: [
    {
      key: "mode",
      label: "Mode",
      default: "practice",
      choices: [
        { value: "practice", label: "Practice" },
        { value: "daily", label: "Daily puzzle" },
      ],
    },
  ],
  statsKey: (o) => (o("mode") === "daily" ? "mahjong:daily" : "mahjong"),
  load: () => import("./impl/mahjong"),
};
