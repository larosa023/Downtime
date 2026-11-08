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
        { value: "hard", label: "Expert 30×16" },
        { value: "huge", label: "Huge 30×24" },
      ],
    },
    {
      key: "guess",
      label: "Board",
      default: "classic",
      choices: [
        { value: "classic", label: "Classic" },
        { value: "noguess", label: "No guessing" },
      ],
    },
    {
      key: "marks",
      label: "Question marks",
      default: "off",
      choices: [
        { value: "off", label: "No ? marks" },
        { value: "on", label: "? marks" },
      ],
    },
  ],
  keys: [
    ["Right-click", "Flag a cell (or mark ?)"],
    ["Ctrl+click", "Flag a cell"],
    ["Click a number", "Open around it when its flags are set"],
  ],
  statsKey: (o) => `minesweeper:${o("level")}`,
  load: () => import("./impl/minesweeper"),
};
