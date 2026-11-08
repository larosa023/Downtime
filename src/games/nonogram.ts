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
        { value: "huge", label: "20×20" },
      ],
    },
    {
      key: "autox",
      label: "Auto X",
      default: "on",
      choices: [
        { value: "on", label: "Auto X on" },
        { value: "off", label: "Auto X off" },
      ],
    },
  ],
  keys: [
    ["Click or drag", "Fill cells"],
    ["Right-click or drag", "Mark X"],
    ["Ctrl+click", "Mark X"],
  ],
  statsKey: (o) => (o("mode") === "daily" ? "nonogram:daily" : `nonogram:${o("size")}`),
  load: () => import("./impl/nonogram"),
};
