import "./reversi.css";
import { GameModule } from "../core/types";

export const reversi: GameModule = {
  id: "reversi",
  name: "Reversi",
  group: "board",
  blurb: "Trap the computer's discs between yours to flip them. Most discs wins.",
  art: "reversi",
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
    {
      key: "dots",
      label: "Legal moves",
      default: "on",
      choices: [
        { value: "on", label: "Show legal moves" },
        { value: "off", label: "Hide legal moves" },
      ],
    },
  ],
  statsKey: (o) => `reversi:${o("level")}`,
  keys: [
    ["Click a square", "Place a disc"],
    ["Ctrl+Z", "Take back your last move"],
  ],
  iconSvg: `<rect x="3.5" y="3.5" width="17" height="17" rx="2.5"/><circle cx="9.5" cy="9.5" r="2.6" fill="currentColor"/><circle cx="14.5" cy="14.5" r="2.6" fill="currentColor"/><circle cx="14.5" cy="9.5" r="2.6"/><circle cx="9.5" cy="14.5" r="2.6"/>`,
  artSvg: (() => {
    let s = `<rect x="70" y="10" width="112" height="112" rx="8" class="rv-art-board"/>`;
    for (let i = 1; i < 8; i++)
      s += `<path class="rv-art-line" d="M${70 + i * 14} 10v112M70 ${10 + i * 14}h112"/>`;
    const disc = (r: number, c: number, dark: boolean) => `<circle cx="${77 + c * 14}" cy="${17 + r * 14}" r="5.4" class="${dark ? "rv-art-dark" : "rv-art-light"}"/>`;
    const dark = [[2, 3], [3, 3], [3, 4], [4, 4], [4, 2], [5, 5], [2, 5]];
    const light = [[3, 2], [4, 3], [2, 4], [5, 4], [4, 5], [1, 4]];
    for (const [r, c] of dark) s += disc(r, c, true);
    for (const [r, c] of light) s += disc(r, c, false);
    return s;
  })(),
  load: () => import("./impl/reversi"),
};
