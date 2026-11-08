import type { GameModule } from "../core/types";

export const freecell: GameModule = {
  id: "freecell",
  name: "FreeCell",
  group: "cards",
  blurb: "Every card face up. Four free cells. Almost every deal can be won.",
  art: "freecell",
  hasUndo: true,
  daily: true,
  options: [
    {
      key: "mode",
      label: "Deal",
      default: "random",
      choices: [
        { value: "random", label: "Random deal" },
        { value: "daily", label: "Daily deal" },
      ],
    },
  ],
  statsKey: (o) => (o("mode") === "daily" ? "freecell:daily" : "freecell"),
  keys: [
    ["Click", "Send a card to the best spot"],
    ["Double-click", "Send a card when click-to-move is off"],
    ["H", "Hint"],
  ],
  load: () => import("./impl/freecell"),
};
