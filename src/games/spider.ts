import type { GameModule } from "../core/types";

export const spider: GameModule = {
  id: "spider",
  name: "Spider",
  group: "cards",
  blurb: "Two decks, ten columns. Clear runs from King down to Ace.",
  art: "spider",
  hasUndo: true,
  options: [
    {
      key: "suits",
      label: "Suits",
      default: "1",
      choices: [
        { value: "1", label: "1 suit" },
        { value: "2", label: "2 suits" },
        { value: "4", label: "4 suits" },
      ],
    },
  ],
  statsKey: (o) => `spider:${o("suits")}suit`,
  keys: [
    ["Click", "Send a card to the best spot"],
    ["Double-click", "Send a card when click-to-move is off"],
    ["Drag", "Move a card or run"],
    ["H", "Hint"],
    ["Click the stock", "Deal a new row"],
  ],
  load: () => import("./impl/spider"),
};
