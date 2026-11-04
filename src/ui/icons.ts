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
  star: svg(`<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/>`),
  starFilled: svg(`<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z" fill="currentColor"/>`),
  hint: svg(`<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>`),
  finish: svg(`<path d="M5 6l7 6-7 6zM13 6l7 6-7 6z"/>`),
  mini: svg(`<rect x="3" y="5" width="18" height="14" rx="2"/><rect x="12" y="11" width="7" height="6" rx="1" fill="currentColor"/>`),
  expand: svg(`<path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5"/>`),
  trophy: svg(`<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7M10 17h4"/>`),
  calendar: svg(`<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>`),
  chevron: svg(`<path d="m8 10 4 4 4-4"/>`),
  sidebar: svg(`<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M9 4.5v15"/>`),
  check: svg(`<path d="m5 12.5 4.5 4.5L19 7.5"/>`),
  lock: svg(`<rect x="5.5" y="11" width="13" height="9" rx="2"/><path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3"/>`),
};

export const GAME_ICONS: Record<string, string> = {
  spider: `<span class="gicon">${suitSvg("S")}</span>`,
  freecell: `<span class="gicon">${suitSvg("D")}</span>`,
  golf: `<span class="gicon">${suitSvg("C")}</span>`,
  mahjong: svg(`<rect x="5" y="4" width="11" height="15" rx="2"/><path d="M8 19v1.5h11V8.5H16"/><circle cx="10.5" cy="11.5" r="2.2"/>`),
  nonogram: svg(`<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16"/><rect x="9.3" y="9.3" width="5.4" height="5.4" fill="currentColor"/>`),
  connect4: svg(`<rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="8" cy="10" r="1.6"/><circle cx="12" cy="10" r="1.6"/><circle cx="16" cy="10" r="1.6" fill="currentColor"/><circle cx="8" cy="14.5" r="1.6" fill="currentColor"/><circle cx="12" cy="14.5" r="1.6" fill="currentColor"/><circle cx="16" cy="14.5" r="1.6"/>`),
  memory: svg(`<rect x="3.5" y="5" width="7.5" height="10" rx="1.5"/><rect x="13" y="9" width="7.5" height="10" rx="1.5" fill="currentColor"/>`),
  tripeaks: svg(`<path d="M3 19 8 8l4 7 4-9 5 13z"/>`),
  pyramid: svg(`<path d="M12 4 21 19H3z"/><path d="M8.5 13h7"/>`),
  sudoku: svg(`<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9.3 4v16M14.7 4v16M4 9.3h16M4 14.7h16"/>`),
  blocks: svg(`<rect x="4" y="13" width="5" height="5" rx="1"/><rect x="9.5" y="13" width="5" height="5" rx="1"/><rect x="9.5" y="7.5" width="5" height="5" rx="1"/><rect x="15" y="13" width="5" height="5" rx="1" fill="currentColor"/>`),
  breakout: svg(`<path d="M4 6h4M10 6h4M16 6h4M7 10h4M13 10h4"/><path d="M8 20h8"/><circle cx="13" cy="15" r="1.4" fill="currentColor"/>`),
  minesweeper: svg(`<circle cx="12" cy="12" r="4.5" fill="currentColor"/><path d="M12 4v3M12 17v3M4 12h3M17 12h3M6.3 6.3l2 2M15.7 15.7l2 2M6.3 17.7l2-2M15.7 8.3l2-2"/>`),
  snake: svg(`<path d="M4 17h7a3 3 0 0 0 3-3v-4a3 3 0 0 1 3-3h3"/><circle cx="20" cy="7" r="0.6" fill="currentColor"/>`),
  "2048": svg(`<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5" fill="currentColor"/>`),
};
