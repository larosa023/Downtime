import { load, save } from "./storage";

export type ThemeId = "paper" | "mint" | "slate" | "felt" | "midnight" | "ember" | "dusk" | "contrast" | "custom";
export type AnimSpeed = "off" | "fast" | "normal" | "slow";
export type FontChoice = "default" | "figtree" | "system";
export type Corners = "sharp" | "normal" | "round";
export type Texture = "plain" | "grain" | "felt" | "dots";
export type CardFace = "classic" | "simple" | "bold";
export type AutoMove = "off" | "safe" | "all";
export type StartPage = "home" | "last" | "today";
export type UpdateMode = "auto" | "notify" | "off";

/** Colors for the "custom" theme. */
export interface CustomTheme {
  /** App background. */
  bg: string;
  /** Panels, cards, sidebar. */
  surface: string;
  /** Main text. */
  ink: string;
  /** Buttons and highlights. */
  accent: string;
  /** Card-table / board background. */
  table: string;
}
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
  /** Kept in sync with animSpeed (false when animSpeed is "off"). Read motionEnabled() instead. */
  motion: boolean;
  animSpeed: AnimSpeed;
  /** UI zoom in percent, 80–150. */
  scale: number;
  font: FontChoice;
  corners: Corners;
  /** Texture drawn on the play area. */
  texture: Texture;
  customTheme: CustomTheme;
  /** Card face design. */
  cardFace: CardFace;
  /** Move cards to the foundations automatically: never, only when safe, or whenever possible. */
  autoMove: AutoMove;
  /** Clicking a card sends it to the best spot. */
  clickToMove: boolean;
  /** Ask before starting a new game when one is in progress. */
  confirmNew: boolean;
  /** Pause timed games when Downtime loses focus. */
  autoPause: boolean;
  showTimer: boolean;
  showMoves: boolean;
  /** Show Hint buttons. */
  hints: boolean;
  /** Celebrate wins with a short animation. */
  celebrate: boolean;
  startPage: StartPage;
  /** Last game route, used when startPage is "last". */
  lastRoute: string;
  /** Keep the window above other apps (outside the mini player too). */
  alwaysOnTop: boolean;
  updates: UpdateMode;
  /** Battery saver: caps arcade games at 30 fps and turns off blur effects. */
  lowPower: boolean;
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
  { id: "custom", name: "Custom", swatch: ["#1A1F26", "#6FB3D2", "#E8EDF2"] },
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
  animSpeed: "normal",
  scale: 100,
  font: "default",
  corners: "normal",
  texture: "plain",
  customTheme: { bg: "#1A1F26", surface: "#232A33", ink: "#E8EDF2", accent: "#6FB3D2", table: "#1F4D3C" },
  cardFace: "classic",
  autoMove: "safe",
  clickToMove: true,
  confirmNew: false,
  autoPause: true,
  showTimer: true,
  showMoves: true,
  hints: true,
  celebrate: true,
  startPage: "home",
  lastRoute: "",
  alwaysOnTop: false,
  updates: "notify",
  lowPower: false,
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
  customTheme: { ...DEFAULTS.customTheme, ...stored.customTheme },
};
// Older versions only had the on/off motion switch.
if (stored.animSpeed == null && stored.motion === false) current.animSpeed = "off";
current.motion = current.animSpeed !== "off";
if (!THEMES.some((t) => t.id === current.theme)) current.theme = "paper";
const listeners = new Set<(s: Settings) => void>();

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  if (patch.animSpeed) current.motion = patch.animSpeed !== "off";
  else if (patch.motion != null) current.animSpeed = patch.motion ? (current.animSpeed === "off" ? "normal" : current.animSpeed) : "off";
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

/** Settings back to defaults, keeping favorites and per-game choices. */
export function resetSettings(): void {
  current = { ...DEFAULTS, favorites: current.favorites, options: current.options, collapsed: current.collapsed };
  save("settings", current);
  applySettings();
  listeners.forEach((fn) => fn(current));
}

/** Multiplier for animation durations: 0 when off. CSS gets the same value as --speed. */
export function animScale(): number {
  if (!motionEnabled()) return 0;
  return { off: 0, fast: 0.6, normal: 1, slow: 1.5 }[current.animSpeed];
}

const hex = (v: string) => /^#[0-9a-f]{6}$/i.test(v);
const lum = (a: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

let applyHook: ((s: Settings) => void) | null = null;
/** Lets the native layer (zoom, always on top) react to settings without settings.ts importing Tauri. */
export function setApplyHook(fn: (s: Settings) => void): void {
  applyHook = fn;
  fn(current);
}

export function applySettings(): void {
  const root = document.documentElement;
  root.dataset.theme = current.theme;
  root.dataset.font = current.font;
  root.dataset.corners = current.corners;
  root.dataset.texture = current.texture;
  root.dataset.face = current.cardFace;
  root.classList.toggle("low-power", current.lowPower);
  root.classList.toggle("hide-timer", !current.showTimer);
  root.classList.toggle("hide-moves", !current.showMoves);
  root.classList.toggle("no-hints", !current.hints);
  root.style.setProperty("--speed", String(animScale() || 0.001));
  // Custom theme colors. The CSS for [data-theme="custom"] derives the rest from these.
  const ct = current.customTheme;
  for (const [k, v] of Object.entries(ct)) {
    if (current.theme === "custom" && hex(v)) root.style.setProperty(`--ct-${k}`, v);
    else root.style.removeProperty(`--ct-${k}`);
  }
  if (current.theme === "custom") {
    root.style.setProperty("--ct-dark", lum(ct.bg) < 0.45 ? "1" : "0");
    root.style.colorScheme = lum(ct.bg) < 0.45 ? "dark" : "light";
  } else root.style.removeProperty("color-scheme");
  root.dataset.back = current.cardBack;
  root.classList.toggle("no-motion", !motionEnabled());
  root.classList.toggle("four-color", current.fourColor);
  root.classList.toggle("large-cards", current.largeCards);
  root.classList.toggle("compact-rail", current.compactRail);
  applyHook?.(current);
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
  return current.animSpeed !== "off" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
