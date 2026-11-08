import { GameModule } from "../core/types";

export const flapper: GameModule = {
  id: "flapper",
  name: "Flapper",
  group: "arcade",
  blurb: "Tap to flap and squeeze through the gaps.",
  art: "flapper",
  artSvg: `
    <rect x="12" y="10" width="228" height="124" rx="10" fill="var(--board)"/>
    <ellipse cx="70" cy="122" rx="60" ry="30" fill="var(--table-2)"/>
    <ellipse cx="190" cy="122" rx="70" ry="24" fill="var(--table-2)"/>
    <rect x="12" y="118" width="228" height="16" fill="var(--surface)"/>
    <rect x="140" y="10" width="30" height="36" fill="var(--accent-strong)"/>
    <rect x="136" y="38" width="38" height="10" rx="3" fill="var(--accent)"/>
    <rect x="140" y="90" width="30" height="28" fill="var(--accent-strong)"/>
    <rect x="136" y="86" width="38" height="10" rx="3" fill="var(--accent)"/>
    <ellipse cx="88" cy="66" rx="14" ry="12.5" fill="var(--accent)"/>
    <ellipse cx="86" cy="71" rx="9" ry="6" fill="var(--card)" opacity="0.85"/>
    <ellipse cx="82" cy="62" rx="8" ry="4.5" fill="var(--accent-strong)" transform="rotate(-25 82 62)"/>
    <circle cx="94" cy="62" r="3.6" fill="var(--card)"/><circle cx="95" cy="62" r="1.7" fill="var(--ink)"/>
    <path d="M100 64l8 3-8 4z" fill="#f2b33d"/>`,
  iconSvg: `<ellipse cx="11" cy="13" rx="6" ry="5"/><path d="M17 12.5l3.5 1.5-3.5 1.5"/><path d="M8 11.5c1-2 3-2.5 4-1.5"/>`,
  hasUndo: false,
  options: [
    {
      key: "level",
      label: "Difficulty",
      default: "normal",
      choices: [
        { value: "easy", label: "Easy" },
        { value: "normal", label: "Normal" },
        { value: "hard", label: "Hard" },
      ],
    },
  ],
  statsKey: (o) => (o("level") === "easy" || o("level") === "hard" ? `flapper:${o("level")}` : "flapper"),
  keys: [
    ["Click, Space or ↑", "Flap"],
    ["Esc", "Pause"],
  ],
  load: () => import("./impl/flapper"),
};
