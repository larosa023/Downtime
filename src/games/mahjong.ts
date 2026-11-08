import type { GameModule } from "../core/types";

export const mahjong: GameModule = {
  id: "mahjong",
  name: "Mahjong",
  group: "puzzles",
  blurb: "Match free tiles in pairs until the board is clear. Press H for a hint, S to shuffle.",
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
    {
      key: "layout",
      label: "Layout",
      default: "pyramid",
      choices: [
        { value: "pyramid", label: "Pyramid" },
        { value: "fortress", label: "Fortress" },
        { value: "peaks", label: "Twin peaks" },
        { value: "cross", label: "Cross" },
      ],
    },
  ],
  keys: [
    ["H", "Show a matching pair"],
    ["S", "Shuffle the remaining tiles"],
    ["Esc", "Deselect"],
  ],
  statsKey: (o) => (o("mode") === "daily" ? "mahjong:daily" : !o("layout") || o("layout") === "pyramid" ? "mahjong" : `mahjong:${o("layout")}`),
  load: () => import("./impl/mahjong"),
};
