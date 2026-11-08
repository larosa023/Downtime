// Helpers shared by the shell's pages.

import { getGameOption } from "../core/settings";
import { GameModule } from "../core/types";
import { GAME_ICONS } from "./icons";

export const optionValue = (g: GameModule, key: string) =>
  getGameOption(g.id, key, g.options?.find((o) => o.key === key)?.default ?? "");

/** Stats key for a game with its current options. */
export const statsKeyFor = (g: GameModule) => g.statsKey((k) => optionValue(g, k));

export function gameIcon(g: GameModule): string {
  if (g.iconSvg)
    return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${g.iconSvg}</svg>`;
  return GAME_ICONS[g.id] ?? "";
}

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Hours and minutes, e.g. "2 h 05 m", "14 m", "40 s". */
export function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} m`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} m`;
}

export function relativeDay(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const a = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const b = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((a - b) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}
