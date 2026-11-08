import "./checkers.css";
import { GameModule } from "../core/types";

export const checkers: GameModule = {
  id: "checkers",
  name: "Checkers",
  group: "board",
  blurb: "Jump the computer's pieces and reach the far side to make kings.",
  art: "checkers",
  hasUndo: true,
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
  statsKey: (o) => `checkers:${o("level")}`,
  iconSvg: `<circle cx="9" cy="9" r="4"/><circle cx="15" cy="15" r="4" fill="currentColor"/>`,
  artSvg: (() => {
    let s = `<rect x="70" y="10" width="112" height="112" rx="8" class="ck-art-light"/>`;
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) if ((r + c) % 2) s += `<rect x="${70 + c * 14}" y="${10 + r * 14}" width="14" height="14" class="ck-art-dark"/>`;
    const disc = (r: number, c: number, cls: string) => `<circle cx="${77 + c * 14}" cy="${17 + r * 14}" r="5.2" class="${cls}"/>`;
    for (const [r, c] of [[0, 1], [0, 5], [1, 2], [1, 6], [2, 3], [3, 0]]) s += disc(r, c, "ck-art-cpu");
    for (const [r, c] of [[5, 0], [5, 4], [6, 1], [6, 5], [7, 2], [4, 3]]) s += disc(r, c, "ck-art-you");
    return s;
  })(),
  load: () => import("./impl/checkers"),
};
