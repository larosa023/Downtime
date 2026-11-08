import type { GameModule } from "../core/types";

export const memory: GameModule = {
  id: "memory",
  name: "Memory",
  group: "puzzles",
  blurb: "Flip two cards at a time and find every matching pair.",
  art: "memory",
  hasUndo: false,
  options: [
    {
      key: "size",
      label: "Size",
      default: "medium",
      choices: [
        { value: "small", label: "8 pairs" },
        { value: "medium", label: "12 pairs" },
        { value: "large", label: "18 pairs" },
      ],
    },
  ],
  statsKey: (o) => `memory:${o("size")}`,
  load: () => import("./impl/memory"),
};
