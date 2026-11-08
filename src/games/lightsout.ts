import "./lightsout.css";
import type { GameModule } from "../core/types";

export const lightsout: GameModule = {
  id: "lightsout",
  name: "Lights Out",
  group: "puzzles",
  blurb: "Each press flips a light and its neighbors. Switch every light off.",
  art: "lightsout",
  artSvg: (() => {
    const on = [0, 1, 0, 1, 1, 1, 0, 0, 0, 1, 1, 0, 1, 1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 1, 0];
    let s = "";
    on.forEach((v, i) => {
      const x = 66 + (i % 5) * 24;
      const y = 12 + Math.floor(i / 5) * 24;
      s += `<rect x="${x}" y="${y}" width="20" height="20" rx="5" class="${v ? "lo-a-on" : "lo-a-off"}"/>`;
    });
    return s;
  })(),
  iconSvg: `<circle cx="12" cy="10" r="5"/><path d="M10 18h4M10.5 21h3"/><path d="M12 2.5v1M5 5l.8.8M19 5l-.8.8"/>`,
  hasUndo: true,
  options: [
    {
      key: "size",
      label: "Size",
      default: "small",
      choices: [
        { value: "small", label: "5×5" },
        { value: "medium", label: "6×6" },
        { value: "large", label: "7×7" },
      ],
    },
  ],
  statsKey: (o) => `lightsout:${o("size")}`,
  load: () => import("./impl/lightsout"),
};
