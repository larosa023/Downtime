import type { GameModule } from "../core/types";

export const golf: GameModule = {
  id: "golf",
  name: "Golf",
  group: "cards",
  blurb: "Clear seven columns by playing cards one higher or lower.",
  art: "golf",
  hasUndo: true,
  statsKey: () => "golf",
  load: () => import("./impl/golf"),
};
