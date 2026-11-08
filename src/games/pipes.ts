import "./pipes.css";
import type { GameModule } from "../core/types";

export const pipes: GameModule = {
  id: "pipes",
  name: "Pipes",
  group: "puzzles",
  blurb: "Rotate tiles until every pipe connects to the source with no loose ends.",
  art: "pipes",
  artSvg: `
    <g class="pp-a">
      ${[0, 1, 2, 3, 4].map((r) => [0, 1, 2, 3, 4].map((c) => `<rect x="${71 + c * 22}" y="${17 + r * 22}" width="20" height="20" rx="4" class="pp-a-cell"/>`).join("")).join("")}
      <path class="pp-a-lit" d="M126 72H104V50H82M126 72V94H148V116M126 72H148V50M104 72V94H82V116"/>
      <path class="pp-a-off" d="M148 50V28H170M82 50V28M170 72V94"/>
      <circle cx="126" cy="72" r="6.5" class="pp-a-src"/>
    </g>`,
  iconSvg: `<path d="M4 12h6a2 2 0 0 0 2-2V4"/><path d="M12 20v-4a2 2 0 0 1 2-2h6"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/>`,
  hasUndo: false,
  options: [
    {
      key: "size",
      label: "Size",
      default: "medium",
      choices: [
        { value: "small", label: "5×5" },
        { value: "medium", label: "7×7" },
        { value: "large", label: "9×9" },
      ],
    },
  ],
  statsKey: (o) => `pipes:${o("size")}`,
  load: () => import("./impl/pipes"),
};
