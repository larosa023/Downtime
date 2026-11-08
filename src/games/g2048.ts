import type { GameModule } from "../core/types";

export const g2048: GameModule = {
  id: "2048",
  name: "2048",
  group: "puzzles",
  blurb: "Slide tiles together. Match numbers until you reach 2048.",
  art: "2048",
  hasUndo: true,
  statsKey: () => "2048",
  load: () => import("./impl/g2048"),
};
