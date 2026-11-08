import "./chess.css";
import { GameModule } from "../core/types";
import { PIECE_SVG } from "./impl/chess-pieces";

const colorOf = (p: string) => (p === p.toUpperCase() ? "w" : "b");

export const chess: GameModule = {
  id: "chess",
  name: "Chess",
  group: "board",
  blurb: "Play white against the computer. Drag or click to move.",
  art: "chess",
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
  statsKey: (o) => `chess:${o("level")}`,
  keys: [
    ["Click or drag", "Move a piece"],
    ["Esc", "Cancel a selection"],
    ["Ctrl+Z", "Take back your last move"],
  ],
  iconSvg: `<path d="M9 20h10"/><path d="M10 20l1-6h6l1 6"/><path d="M11 14c-1-2-1-4.5 1-6.5l2-2.5 1 2c2 1 3 3.5 2 7"/><circle cx="13" cy="9" r=".6" fill="currentColor"/>`,
  artSvg: (() => {
    let s = `<rect x="70" y="10" width="112" height="112" rx="8" class="ch-art-light"/>`;
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) if ((r + c) % 2) s += `<rect x="${70 + c * 14}" y="${10 + r * 14}" width="14" height="14" class="ch-art-dark"/>`;
    const put = (pc: string, c: number, r: number) =>
      `<g transform="translate(${70 + c * 14 - 0.5} ${10 + r * 14 - 1}) scale(0.33)" class="cp ${colorOf(pc)}"><g>${PIECE_SVG[pc.toLowerCase()]}</g></g>`;
    s += put("k", 6, 0) + put("r", 5, 0) + put("p", 6, 1) + put("p", 7, 1) + put("q", 3, 2) + put("n", 2, 3);
    s += put("P", 4, 3) + put("B", 2, 4) + put("N", 5, 5) + put("P", 6, 6) + put("K", 6, 7) + put("R", 5, 7) + put("Q", 7, 2);
    return s;
  })(),
  load: () => import("./impl/chess"),
};
