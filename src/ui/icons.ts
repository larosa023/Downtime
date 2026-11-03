import { suitSvg } from "../cards/deck";

const svg = (body: string) =>
  `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  home: svg(`<path d="M4 11 12 4l8 7"/><path d="M6 10v9h12v-9"/>`),
  stats: svg(`<path d="M5 19V11M12 19V5M19 19v-6"/>`),
  settings: svg(`<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>`),
  undo: svg(`<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>`),
  refresh: svg(`<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/>`),
  close: svg(`<path d="M6 6l12 12M18 6 6 18"/>`),
};

export const GAME_ICONS: Record<string, string> = {
  klondike: `<span class="gicon">${suitSvg("H")}</span>`,
  spider: `<span class="gicon">${suitSvg("S")}</span>`,
  freecell: `<span class="gicon">${suitSvg("D")}</span>`,
  minesweeper: svg(`<circle cx="12" cy="12" r="4.5" fill="currentColor"/><path d="M12 4v3M12 17v3M4 12h3M17 12h3M6.3 6.3l2 2M15.7 15.7l2 2M6.3 17.7l2-2M15.7 8.3l2-2"/>`),
  snake: svg(`<path d="M4 17h7a3 3 0 0 0 3-3v-4a3 3 0 0 1 3-3h3"/><circle cx="20" cy="7" r="0.6" fill="currentColor"/>`),
  "2048": svg(`<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5" fill="currentColor"/>`),
};
