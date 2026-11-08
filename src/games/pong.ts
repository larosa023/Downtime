import { GameModule } from "../core/types";

export const pong: GameModule = {
  id: "pong",
  name: "Pong",
  group: "arcade",
  blurb: "Bat the ball past the computer. First to 7 wins.",
  art: "pong",
  artSvg: `
    <rect x="12" y="10" width="228" height="124" rx="10" fill="var(--board)"/>
    ${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="124" y="${18 + i * 20}" width="4" height="11" rx="1" fill="var(--board-line)"/>`).join("")}
    <text x="92" y="48" text-anchor="middle" font-family="Bricolage Grotesque Variable, sans-serif" font-weight="700" font-size="28" fill="var(--muted)" opacity="0.6">3</text>
    <text x="160" y="48" text-anchor="middle" font-family="Bricolage Grotesque Variable, sans-serif" font-weight="700" font-size="28" fill="var(--muted)" opacity="0.6">2</text>
    <rect x="26" y="58" width="7" height="40" rx="3.5" fill="var(--accent)"/>
    <rect x="219" y="76" width="7" height="40" rx="3.5" fill="var(--danger)"/>
    <path d="M40 78 L150 96" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="3 4" fill="none"/>
    <circle cx="156" cy="97" r="6" fill="var(--ink)"/>`,
  iconSvg: `<path d="M5 6v6M19 12v6"/><circle cx="12" cy="10" r="1.4" fill="currentColor"/>`,
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
  statsKey: (o) => `pong:${o("level")}`,
  load: () => import("./impl/pong"),
};
