import type { GameModule } from "../core/types";

export const golf: GameModule = {
  id: "golf",
  name: "Golf",
  group: "cards",
  blurb: "Clear seven columns by playing cards one higher or lower.",
  art: "golf",
  hasUndo: true,
  statsKey: () => "golf",
  keys: [
    ["Click", "Play a column's bottom card"],
    ["Click the stock", "Turn the next card"],
    ["H", "Hint"],
  ],
  load: () => import("./impl/golf"),
};
