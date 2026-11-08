// Mini player: a small always-on-top window for playing in a corner of the screen.
// In a plain browser it just switches to the compact layout.

import { load, save } from "./storage";
import { getSettings } from "./settings";

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

let on = false;
let restore: { w: number; h: number } | null = null;
const listeners = new Set<(on: boolean) => void>();

export function miniOn(): boolean {
  return on;
}

export function onMiniChange(fn: (on: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function setMini(next: boolean): Promise<void> {
  if (next === on) return;
  on = next;
  document.documentElement.classList.toggle("mini", on);
  listeners.forEach((fn) => fn(on));
  if (!isTauri()) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const { LogicalSize } = await import("@tauri-apps/api/dpi");
    const win = getCurrentWindow();
    if (on) {
      const factor = await win.scaleFactor();
      const size = (await win.innerSize()).toLogical(factor);
      restore = { w: size.width, h: size.height };
      const saved = load<{ w: number; h: number }>("mini-size", { w: 520, h: 620 });
      await win.setMinSize(new LogicalSize(360, 420));
      await win.setSize(new LogicalSize(saved.w, saved.h));
      await win.setAlwaysOnTop(true);
    } else {
      const factor = await win.scaleFactor();
      const size = (await win.innerSize()).toLogical(factor);
      save("mini-size", { w: Math.round(size.width), h: Math.round(size.height) });
      // Back to whatever the player chose in Settings.
      await win.setAlwaysOnTop(getSettings().alwaysOnTop);
      await win.setMinSize(new LogicalSize(900, 620));
      if (restore) await win.setSize(new LogicalSize(Math.max(900, restore.w), Math.max(620, restore.h)));
    }
  } catch (e) {
    console.warn("mini player window change failed", e);
  }
}
