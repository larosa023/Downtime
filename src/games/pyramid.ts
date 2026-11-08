import type { GameModule } from "../core/types";

export const pyramid: GameModule = {
  id: "pyramid",
  name: "Pyramid",
  group: "cards",
  blurb: "Pair cards that add up to 13 until the pyramid is gone.",
  art: "pyramid",
  hasUndo: true,
  statsKey: () => "pyramid",
  keys: [
    ["Click", "Pick two cards that add up to 13"],
    ["Click a King", "Remove it"],
    ["Click the stock", "Turn the next card"],
    ["H", "Hint"],
  ],
  load: () => import("./impl/pyramid"),
};
