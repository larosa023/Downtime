import type { GameModule } from "../core/types";

export const sudoku: GameModule = {
  id: "sudoku",
  name: "Sudoku",
  group: "puzzles",
  blurb: "Fill the grid so every row, column and box has 1 through 9.",
  art: "sudoku",
  hasUndo: true,
  daily: true,
  options: [
    {
      key: "mode",
      label: "Mode",
      default: "practice",
      choices: [
        { value: "practice", label: "Practice" },
        { value: "daily", label: "Daily puzzle" },
      ],
    },
    {
      key: "level",
      label: "Level",
      default: "easy",
      choices: [
        { value: "easy", label: "Easy" },
        { value: "medium", label: "Medium" },
        { value: "hard", label: "Hard" },
      ],
    },
  ],
  statsKey: (o) => (o("mode") === "daily" ? "sudoku:daily" : `sudoku:${o("level")}`),
  load: () => import("./impl/sudoku"),
};
