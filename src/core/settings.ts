import { load, save } from "./storage";

export type ThemeId = "paper" | "slate" | "felt" | "midnight" | "ember";
export type CardBack = "weave" | "dots" | "plain";

export interface Settings {
  theme: ThemeId;
  cardBack: CardBack;
  sound: boolean;
  motion: boolean;
  /** Per-game option choices, e.g. { klondike: { draw: "3" } } */
  options: Record<string, Record<string, string>>;
}

export const THEMES: { id: ThemeId; name: string; swatch: [string, string, string] }[] = [
  { id: "paper", name: "Paper", swatch: ["#E9EDF1", "#2E6F8E", "#D2453A"] },
  { id: "slate", name: "Slate", swatch: ["#171C23", "#6FB3D2", "#F07A6E"] },
  { id: "felt", name: "Felt", swatch: ["#1C5A41", "#E8C565", "#F3EFE2"] },
  { id: "midnight", name: "Midnight", swatch: ["#15122B", "#A68CFF", "#5EE6D0"] },
  { id: "ember", name: "Ember", swatch: ["#2A1B17", "#F29A4A", "#F5E6D8"] },
];

const DEFAULTS: Settings = {
  theme: "paper",
  cardBack: "weave",
  sound: true,
  motion: true,
  options: {},
};

let current: Settings = { ...DEFAULTS, ...load<Partial<Settings>>("settings", {}) };
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

export function onSettingsChange(fn: (s: Settings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function applySettings(): void {
  const root = document.documentElement;
  root.dataset.theme = current.theme;
  root.dataset.back = current.cardBack;
  root.classList.toggle("no-motion", !current.motion);
}

export function motionEnabled(): boolean {
  return current.motion && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
