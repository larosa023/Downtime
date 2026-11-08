// Bridge to the Windows app (Tauri). Every function is a safe no-op (or a browser fallback)
// in a plain browser, and the Tauri API is only loaded inside the app.

export const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const win = async () => (await import("@tauri-apps/api/window")).getCurrentWindow();

/** Keep the window above other apps. */
export async function setAlwaysOnTop(on: boolean): Promise<void> {
  if (!isTauri()) return;
  try {
    await (await win()).setAlwaysOnTop(on);
  } catch (e) {
    console.warn("always on top failed", e);
  }
}

let zoom = 1;

/** Whole-app zoom, 1 = 100%. Uses the WebView's zoom in the app and CSS zoom in a browser. */
export async function setZoom(factor: number): Promise<void> {
  const f = Math.min(2, Math.max(0.5, Number.isFinite(factor) ? factor : 1));
  if (Math.abs(f - zoom) < 0.001) return;
  zoom = f;
  if (isTauri()) {
    try {
      const { getCurrentWebview } = await import("@tauri-apps/api/webview");
      await getCurrentWebview().setZoom(f);
      // Games size themselves from their container; nudge them once the new zoom has applied.
      requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
      return;
    } catch (e) {
      console.warn("webview zoom failed, using CSS zoom", e);
    }
  }
  const root = document.documentElement;
  if (f === 1) root.style.removeProperty("zoom");
  else root.style.setProperty("zoom", String(f));
  requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
}

export async function isFullscreen(): Promise<boolean> {
  if (isTauri()) {
    try {
      return await (await win()).isFullscreen();
    } catch {
      return false;
    }
  }
  return !!document.fullscreenElement;
}

/** Toggle fullscreen and return the new state. */
export async function toggleFullscreen(): Promise<boolean> {
  if (isTauri()) {
    try {
      const w = await win();
      const next = !(await w.isFullscreen());
      await w.setFullscreen(next);
      return next;
    } catch (e) {
      console.warn("fullscreen failed", e);
      return false;
    }
  }
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return false;
    }
    await document.documentElement.requestFullscreen();
    return true;
  } catch {
    return false;
  }
}

let installed = false;

/** Stop browser behaviors that make the app feel like a web page (reload keys, find, print,
 *  context menu, browser zoom, dragging images out) and show the window once the first frame is painted. */
export function installAppFeel(): void {
  if (installed) return;
  installed = true;

  // The window starts hidden to avoid a blank flash; show it after the first real paint.
  // (The Rust side also shows it after a moment as a fallback.)
  if (isTauri()) {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        void win()
          .then((w) => w.show())
          .catch(() => {});
      }),
    );
  }

  // In a plain browser during development, keep the browser's normal keys (reload etc.).
  if (!isTauri() && import.meta.env.DEV) return;

  const editable = (t: EventTarget | null) =>
    t instanceof HTMLElement && !!t.closest("input, textarea, [contenteditable=''], [contenteditable='true']");

  document.addEventListener("contextmenu", (e) => {
    if (!editable(e.target)) e.preventDefault();
  });

  document.addEventListener(
    "keydown",
    (e) => {
      const k = e.key.toLowerCase();
      const ctrl = e.ctrlKey || e.metaKey;
      const block =
        k === "f5" ||
        k === "f3" ||
        k === "f7" || // caret browsing
        (ctrl && ["r", "f", "g", "u", "s", "j", "+", "=", "-", "_", "0"].includes(k)) ||
        (ctrl && e.shiftKey && ["i", "c"].includes(k) && !import.meta.env.DEV) ||
        (e.altKey && (k === "arrowleft" || k === "arrowright")); // back / forward
      if (block) {
        e.preventDefault();
        return;
      }
      // Ctrl+P belongs to the command palette: stop the print dialog but let the shell see the key.
      if (ctrl && k === "p") e.preventDefault();
    },
    { capture: true },
  );

  // Ctrl+wheel and pinch would zoom the WebView; the app has its own scale setting.
  window.addEventListener(
    "wheel",
    (e) => {
      if (e.ctrlKey) e.preventDefault();
    },
    { passive: false, capture: true },
  );

  // Don't let images and links be dragged out of the window (games use pointer events, not HTML drag).
  document.addEventListener("dragstart", (e) => {
    const t = e.target;
    if (t instanceof HTMLImageElement || t instanceof HTMLAnchorElement || (t instanceof Node && t.nodeType === Node.TEXT_NODE)) {
      e.preventDefault();
    }
  });
  // Dropping a file onto the window would navigate away from the app.
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());
}

/** Open a web page in the default browser (a new tab in a plain browser). */
export async function openExternal(url: string): Promise<void> {
  if (!isTauri()) {
    window.open(url, "_blank", "noopener");
    return;
  }
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } catch (e) {
    console.warn("couldn't open link", e);
  }
}

// Any link to an outside site opens in the default browser instead of inside the app.
if (typeof document !== "undefined") {
  document.addEventListener("click", (e) => {
    const a = (e.target as HTMLElement | null)?.closest?.("a[href^='http']") as HTMLAnchorElement | null;
    if (!a || !isTauri()) return;
    e.preventDefault();
    void openExternal(a.href);
  });
}
