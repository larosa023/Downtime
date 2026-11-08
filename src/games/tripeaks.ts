import type { GameModule } from "../core/types";

export const tripeaks: GameModule = {
  id: "tripeaks",
  name: "TriPeaks",
  group: "cards",
  blurb: "Clear three peaks by playing cards one higher or lower.",
  art: "tripeaks",
  hasUndo: true,
  statsKey: () => "tripeaks",
  keys: [
    ["Click", "Play a card one higher or lower"],
    ["Click the stock", "Turn the next card"],
    ["H", "Hint"],
  ],
  load: () => import("./impl/tripeaks"),
};
