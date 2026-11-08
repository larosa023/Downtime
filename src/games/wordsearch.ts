import "./wordsearch.css";
import type { GameModule } from "../core/types";

export const wordsearch: GameModule = {
  id: "wordsearch",
  name: "Word Search",
  group: "words",
  blurb: "Find every hidden word. Words run in any of eight directions.",
  art: "wordsearch",
  hasUndo: false,
  options: [
    {
      key: "size",
      label: "Size",
      default: "medium",
      choices: [
        { value: "small", label: "10×10" },
        { value: "medium", label: "13×13" },
        { value: "large", label: "16×16" },
      ],
    },
  ],
  statsKey: (o) => `wordsearch:${o("size")}`,
  iconSvg: `<rect x="3.5" y="3.5" width="17" height="17" rx="2.5"/><path d="M7.5 7.5 16.5 16.5" stroke-width="3.2" opacity="0.45"/>`,
  artSvg: (() => {
    const rows = ["QPLANETSM", "WOCEANRAK", "STREEVLEI", "MOUNTAINR", "BCLOUDTFX"];
    let out = `<rect class="ws-a-bg" x="54" y="10" width="144" height="124" rx="10"/>`;
    out += `<line class="ws-a-m1" x1="81" y1="30" x2="165" y2="30"/>`;
    out += `<line class="ws-a-m2" x1="67" y1="93" x2="165" y2="93"/>`;
    out += `<line class="ws-a-m3" x1="81" y1="51" x2="137" y2="51"/>`;
    rows.forEach((row, r) =>
      [...row].forEach((ch, c) => {
        out += `<text class="ws-a-t" x="${67 + c * 14}" y="${35 + r * 21}">${ch}</text>`;
      }),
    );
    return out;
  })(),
  load: () => import("./impl/wordsearch"),
};
