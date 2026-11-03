// Self-update via Tauri's updater plugin. Releases are signed in CI and the
// app only installs updates whose signature matches the key in tauri.conf.json.
// In a plain browser (npm run dev) none of this runs.

import type { Update } from "@tauri-apps/plugin-updater";

export type UpdateState =
  | { kind: "unsupported" }
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "current"; checkedAt: number }
  | { kind: "available"; version: string; notes?: string }
  | { kind: "downloading"; version: string; progress: number }
  | { kind: "installing"; version: string }
  | { kind: "error"; message: string };

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

let state: UpdateState = isTauri() ? { kind: "idle" } : { kind: "unsupported" };
let pending: Update | null = null;
let version = "";
const listeners = new Set<(s: UpdateState) => void>();

function set(next: UpdateState) {
  state = next;
  listeners.forEach((fn) => fn(state));
}

export function updateState(): UpdateState {
  return state;
}

export function onUpdateState(fn: (s: UpdateState) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function appVersion(): Promise<string> {
  if (version) return version;
  if (!isTauri()) return (version = __APP_VERSION__);
  const { getVersion } = await import("@tauri-apps/api/app");
  return (version = await getVersion());
}

export async function checkForUpdate(quiet = false): Promise<void> {
  if (!isTauri() || state.kind === "checking" || state.kind === "downloading" || state.kind === "installing") return;
  set({ kind: "checking" });
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (update) {
      pending = update;
      set({ kind: "available", version: update.version, notes: update.body ?? undefined });
    } else {
      set({ kind: "current", checkedAt: Date.now() });
    }
  } catch (e) {
    // A failed background check shouldn't nag; only report it when asked.
    if (quiet) set({ kind: "idle" });
    else set({ kind: "error", message: "Couldn't reach GitHub to check for updates. Check your connection and try again." });
    console.warn("update check failed", e);
  }
}

export async function installUpdate(): Promise<void> {
  if (!pending) return;
  const v = pending.version;
  let total = 0;
  let got = 0;
  try {
    set({ kind: "downloading", version: v, progress: 0 });
    await pending.downloadAndInstall((ev) => {
      if (ev.event === "Started") total = ev.data.contentLength ?? 0;
      else if (ev.event === "Progress") {
        got += ev.data.chunkLength;
        set({ kind: "downloading", version: v, progress: total ? got / total : 0 });
      } else if (ev.event === "Finished") set({ kind: "installing", version: v });
    });
    // On Windows the installer closes the app itself; elsewhere, restart.
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch (e) {
    console.warn("update install failed", e);
    set({ kind: "error", message: "The update didn't finish installing. Try again, or download it from the Releases page." });
  }
}
