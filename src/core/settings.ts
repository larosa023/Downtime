import { load, save } from "./storage";

export type ThemeId = "paper" | "mint" | "slate" | "felt" | "midnight" | "ember" | "dusk" | "contrast";
export type CardBack = "weave" | "dots" | "plain" | "stripes" | "checker";
export type SoundGroup = "cards" | "moves" | "results";

export interface Settings {
  theme: ThemeId;
  /** Custom accent color as #rrggbb, or "" to use the theme's. */
  accent: string;
  cardBack: CardBack;
  /** Diamonds blue and clubs green. */
  fourColor: boolean;
  /** Bigger corner indexes on cards. */
  largeCards: boolean;
  sound: boolean;
  /** 0–100 */
  volume: number;
  soundGroups: Record<SoundGroup, boolean>;
  motion: boolean;
  /** Icon-only sidebar. */
  compactRail: boolean;
  /** Sidebar groups the player has collapsed. */
  collapsed: string[];
  favorites: string[];
  /** Per-game option choices, e.g. { spider: { suits: "2" } } */
  options: Record<string, Record<string, string>>;
}

export const THEMES: { id: ThemeId; name: string; swatch: [string, string, string] }[] = [
  { id: "paper", name: "Paper", swatch: ["#E9EDF1", "#2E6F8E", "#D2453A"] },
  { id: "mint", name: "Mint", swatch: ["#E3EEE8", "#1F7A5C", "#D2453A"] },
  { id: "slate", name: "Slate", swatch: ["#171C23", "#6FB3D2", "#F07A6E"] },
  { id: "felt", name: "Felt", swatch: ["#1C5A41", "#E8C565", "#F3EFE2"] },
  { id: "midnight", name: "Midnight", swatch: ["#15122B", "#A68CFF", "#5EE6D0"] },
  { id: "ember", name: "Ember", swatch: ["#2A1B17", "#F29A4A", "#F5E6D8"] },
  { id: "dusk", name: "Dusk", swatch: ["#1E1A26", "#E58FB2", "#8FD3C8"] },
  { id: "contrast", name: "High contrast", swatch: ["#000000", "#FFD400", "#FFFFFF"] },
];

const DEFAULTS: Settings = {
  theme: "paper",
  accent: "",
  cardBack: "weave",
  fourColor: false,
  largeCards: false,
  sound: true,
  volume: 70,
  soundGroups: { cards: true, moves: true, results: true },
  motion: true,
  compactRail: false,
  collapsed: [],
  favorites: [],
  options: {},
};

const stored = load<Partial<Settings>>("settings", {});
let current: Settings = {
  ...DEFAULTS,
  ...stored,
  soundGroups: { ...DEFAULTS.soundGroups, ...stored.soundGroups },
};
if (!THEMES.some((t) => t.id === current.theme)) current.theme = "paper";
const listeners = new Set<(s: Settings) => void>();

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  save("settings", current);
  applySettings();
  listeners.forEach((fn) => fn(current));
}

export function getGameOption(game: string, key: string, fallback: string): string {
  return current.options[game]?.[key] ?? fallback;
}

export function setGameOption(game: string, key: string, value: string): void {
  const options = { ...current.options, [game]: { ...current.options[game], [key]: value } };
  updateSettings({ options });
}

export function toggleFavorite(id: string): boolean {
  const on = !current.favorites.includes(id);
  updateSettings({ favorites: on ? [...current.favorites, id] : current.favorites.filter((f) => f !== id) });
  return on;
}

export function onSettingsChange(fn: (s: Settings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function applySettings(): void {
  const root = document.documentElement;
  root.dataset.theme = current.theme;
  root.dataset.back = current.cardBack;
  root.classList.toggle("no-motion", !current.motion);
  root.classList.toggle("four-color", current.fourColor);
  root.classList.toggle("large-cards", current.largeCards);
  root.classList.toggle("compact-rail", current.compactRail);
  if (/^#[0-9a-f]{6}$/i.test(current.accent)) {
    const a = current.accent;
    root.style.setProperty("--accent", a);
    root.style.setProperty("--accent-strong", `color-mix(in oklab, ${a} 82%, var(--ink))`);
    root.style.setProperty("--accent-soft", `color-mix(in oklab, ${a} 22%, var(--surface))`);
    // Pick readable text on the accent.
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16) / 255);
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    root.style.setProperty("--accent-ink", lum > 0.55 ? "#141414" : "#ffffff");
  } else {
    for (const v of ["--accent", "--accent-strong", "--accent-soft", "--accent-ink"]) root.style.removeProperty(v);
  }
}

export function motionEnabled(): boolean {
  return current.motion && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
