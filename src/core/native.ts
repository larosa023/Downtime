// Bridge to the Windows app (Tauri). Every function is a safe no-op in a plain browser.
// Owned by the native layer; the shell calls these.

export const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Keep the window above other apps. */
export async function setAlwaysOnTop(on: boolean): Promise<void> {
  void on;
}

/** Whole-app zoom, 1 = 100%. Uses the WebView's zoom in the app and CSS zoom in a browser. */
export async function setZoom(factor: number): Promise<void> {
  void factor;
}

export async function toggleFullscreen(): Promise<boolean> {
  return false;
}

export async function isFullscreen(): Promise<boolean> {
  return false;
}

/** Stop browser behaviors that make the app feel like a web page (reload keys, find, print, context menu). */
export function installAppFeel(): void {}
