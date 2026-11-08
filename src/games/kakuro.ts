import "./kakuro.css";
import type { GameModule } from "../core/types";

export const kakuro: GameModule = {
  id: "kakuro",
  name: "Kakuro",
  group: "puzzles",
  blurb: "A crossword of numbers. Each run adds up to its clue, with no digit repeated.",
  art: "kakuro",
  artSvg: (() => {
    // 5×5 board: '#' block, 'c' clue, digits white.
    const g = ["##cc#", "#c39c", "c1287", "c7981", "#c42#"];
    const clues: Record<string, [string, string]> = { "0,2": ["", "8"], "0,3": ["", "24"], "1,1": ["12", "4"], "1,4": ["", "16"], "2,0": ["", "18"], "3,0": ["25", ""], "4,1": ["6", ""] };
    let s = "";
    g.forEach((row, r) =>
      [...row].forEach((ch, c) => {
        const x = 66 + c * 24;
        const y = 12 + r * 24;
        if (ch === "#") s += `<rect x="${x}" y="${y}" width="23" height="23" rx="2" class="kk-a-block"/>`;
        else if (ch === "c") {
          const [a, d] = clues[`${r},${c}`] ?? ["", ""];
          s += `<rect x="${x}" y="${y}" width="23" height="23" rx="2" class="kk-a-block"/><line x1="${x}" y1="${y}" x2="${x + 23}" y2="${y + 23}" class="kk-a-line"/>`;
          if (a) s += `<text x="${x + 21}" y="${y + 9}" text-anchor="end" class="kk-a-clue">${a}</text>`;
          if (d) s += `<text x="${x + 2}" y="${y + 21}" class="kk-a-clue">${d}</text>`;
        } else s += `<rect x="${x}" y="${y}" width="23" height="23" rx="2" class="kk-a-cell"/><text x="${x + 11.5}" y="${y + 17}" text-anchor="middle" class="kk-a-num">${ch}</text>`;
      }),
    );
    return s;
  })(),
  iconSvg: `<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 4l6 6M10 4v16M4 10h16"/>`,
  hasUndo: true,
  options: [
    {
      key: "size",
      label: "Size",
      default: "small",
      choices: [
        { value: "small", label: "Small" },
        { value: "medium", label: "Medium" },
        { value: "large", label: "Large" },
      ],
    },
  ],
  statsKey: (o) => `kakuro:${o("size")}`,
  load: () => import("./impl/kakuro"),
};
