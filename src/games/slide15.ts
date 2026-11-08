import "./slide15.css";
import type { GameModule } from "../core/types";

export const slide15: GameModule = {
  id: "slide15",
  name: "Fifteen",
  group: "puzzles",
  blurb: "Slide the tiles back into order. Click a tile in the gap's row or column to move the whole line.",
  art: "slide15",
  artSvg: (() => {
    const order = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 0, 13, 14, 11, 15];
    let s = `<rect x="70" y="8" width="112" height="128" rx="10" class="sl-a-board"/>`;
    order.forEach((v, i) => {
      if (!v) return;
      const x = 76 + (i % 4) * 25.5;
      const y = 16 + Math.floor(i / 4) * 29;
      s += `<rect x="${x}" y="${y}" width="23" height="26" rx="4" class="sl-a-tile${v === i + 1 ? " home" : ""}"/><text x="${x + 11.5}" y="${y + 18}" class="sl-a-num">${v}</text>`;
    });
    return s;
  })(),
  iconSvg: `<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><path d="M14 16.5h5M17 14l2.5 2.5L17 19"/>`,
  hasUndo: true,
  options: [
    {
      key: "size",
      label: "Size",
      default: "medium",
      choices: [
        { value: "small", label: "3×3" },
        { value: "medium", label: "4×4" },
        { value: "large", label: "5×5" },
        { value: "huge", label: "6×6" },
      ],
    },
    {
      key: "look",
      label: "Tiles",
      default: "numbers",
      choices: [
        { value: "numbers", label: "Numbers" },
        { value: "picture", label: "Picture" },
      ],
    },
  ],
  keys: [
    ["Arrow keys", "Slide a tile into the gap"],
    ["Click", "Slide a tile, or a whole line"],
  ],
  statsKey: (o) => `slide15:${o("size")}`,
  load: () => import("./impl/slide15"),
};
