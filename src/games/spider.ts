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
  load: () => import("./impl/spider"),
};
