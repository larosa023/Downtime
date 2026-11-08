import type { GameModule } from "../core/types";

export const minesweeper: GameModule = {
  id: "minesweeper",
  name: "Minesweeper",
  group: "puzzles",
  blurb: "Clear the field without touching a mine. Right-click to flag.",
  art: "minesweeper",
  hasUndo: false,
  options: [
    {
      key: "level",
      label: "Level",
      default: "easy",
      choices: [
        { value: "easy", label: "Easy 9×9" },
        { value: "medium", label: "Medium 16×16" },
        { value: "hard", label: "Hard 30×16" },
      ],
    },
  ],
  statsKey: (o) => `minesweeper:${o("level")}`,
  load: () => import("./impl/minesweeper"),
};
