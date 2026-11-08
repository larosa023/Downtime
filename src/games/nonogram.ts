import type { GameModule } from "../core/types";

export const nonogram: GameModule = {
  id: "nonogram",
  name: "Nonograms",
  group: "puzzles",
  blurb: "Fill cells so each row and column matches its numbers. Right-click to mark an X.",
  art: "nonogram",
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
      key: "size",
      label: "Size",
      default: "medium",
      choices: [
        { value: "small", label: "5×5" },
        { value: "medium", label: "10×10" },
        { value: "large", label: "15×15" },
      ],
    },
  ],
  statsKey: (o) => (o("mode") === "daily" ? "nonogram:daily" : `nonogram:${o("size")}`),
  load: () => import("./impl/nonogram"),
};
