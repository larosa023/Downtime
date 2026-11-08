import "./wordguess.css";
import type { GameModule } from "../core/types";

export const wordguess: GameModule = {
  id: "wordguess",
  name: "Word Guess",
  group: "words",
  blurb: "Find the hidden five-letter word in six tries. A new daily word every day.",
  art: "wordguess",
  hasUndo: false,
  daily: true,
  options: [
    {
      key: "mode",
      label: "Mode",
      default: "daily",
      choices: [
        { value: "daily", label: "Daily word" },
        { value: "practice", label: "Practice" },
      ],
    },
  ],
  statsKey: (o) => `wordguess:${o("mode")}`,
  iconSvg: `<rect x="3" y="8" width="5" height="8" rx="1.2"/><rect x="9.5" y="8" width="5" height="8" rx="1.2" fill="currentColor"/><rect x="16" y="8" width="5" height="8" rx="1.2"/>`,
  artSvg: (() => {
    const rows = [
      ["s", "t", "o", "n", "e"],
      ["p", "l", "a", "n", "t"],
      ["b", "r", "a", "v", "e"],
    ];
    const marks = [
      ["miss", "near", "miss", "miss", "hit"],
      ["miss", "miss", "hit", "miss", "near"],
      ["hit", "hit", "hit", "hit", "hit"],
    ];
    let out = "";
    rows.forEach((row, r) =>
      row.forEach((ch, c) => {
        const x = 51 + c * 31;
        const y = 18 + r * 36;
        const m = marks[r][c];
        out += `<rect class="wg-a-${m}" x="${x}" y="${y}" width="28" height="31" rx="5"/>`;
        if (m === "near") out += `<circle class="wg-a-dot" cx="${x + 22}" cy="${y + 6}" r="2.2"/>`;
        out += `<text class="wg-a-t wg-a-t-${m}" x="${x + 14}" y="${y + 21.5}">${ch.toUpperCase()}</text>`;
      }),
    );
    return out;
  })(),
  load: () => import("./impl/wordguess"),
};
