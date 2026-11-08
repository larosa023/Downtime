import type { GameModule } from "../core/types";

export const tripeaks: GameModule = {
  id: "tripeaks",
  name: "TriPeaks",
  group: "cards",
  blurb: "Clear three peaks by playing cards one higher or lower.",
  art: "tripeaks",
  hasUndo: true,
  statsKey: () => "tripeaks",
  load: () => import("./impl/tripeaks"),
};
