import type { GameModule } from "../core/types";

export const freecell: GameModule = {
  id: "freecell",
  name: "FreeCell",
  group: "cards",
  blurb: "Every card face up. Four free cells. Almost every deal can be won.",
  art: "freecell",
  hasUndo: true,
  statsKey: () => "freecell",
  load: () => import("./impl/freecell"),
};
