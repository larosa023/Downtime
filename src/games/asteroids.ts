import { GameModule } from "../core/types";

export const asteroids: GameModule = {
  id: "asteroids",
  name: "Rocks",
  group: "arcade",
  blurb: "Fly, turn and shoot. Break up the rocks before they hit you.",
  art: "asteroids",
  artSvg: `
    <rect x="12" y="10" width="228" height="124" rx="10" fill="var(--board)"/>
    ${[[30, 30], [70, 110], [200, 24], [222, 100], [150, 120], [110, 22]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.2" fill="var(--board-line)"/>`).join("")}
    <path d="M60 40l14-8 15 4 7 13-4 14-15 6-13-5-7-12z" fill="none" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round"/>
    <path d="M172 72l10-6 11 3 5 10-3 10-11 4-9-4-5-8z" fill="none" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round"/>
    <path d="M196 30l7-4 7 2 3 6-2 6-7 3-6-3z" fill="none" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round"/>
    <path d="M118 96l-9 22 9-6 9 6z" transform="rotate(40 118 106)" fill="none" stroke="var(--accent)" stroke-width="2.4" stroke-linejoin="round"/>
    <circle cx="140" cy="88" r="2.4" fill="var(--accent-strong)"/><circle cx="154" cy="78" r="2.4" fill="var(--accent-strong)"/>`,
  iconSvg: `<path d="M5 18 12 4l7 14-7-4z"/>`,
  hasUndo: false,
  statsKey: () => "asteroids",
  load: () => import("./impl/asteroids"),
};
