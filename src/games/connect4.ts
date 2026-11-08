import { GameModule } from "../core/types";

export const connect4: GameModule = {
  id: "connect4",
  name: "Connect Four",
  group: "arcade",
  blurb: "Drop discs and line up four in a row before the computer does.",
  art: "connect4",
  hasUndo: false,
  options: [
    {
      key: "level",
      label: "Opponent",
      default: "normal",
      choices: [
        { value: "easy", label: "Easy" },
        { value: "normal", label: "Normal" },
        { value: "hard", label: "Hard" },
      ],
    },
  ],
  statsKey: (o) => `connect4:${o("level")}`,
  load: () => import("./impl/connect4"),
};
