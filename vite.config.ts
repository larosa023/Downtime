import { defineConfig } from "vite";
import pkg from "./package.json" with { type: "json" };

// Tauri expects a fixed dev port and a relative build output.
export default defineConfig({
  clearScreen: false,
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    // WebView2 is evergreen Chromium, so ship modern code with no polyfills.
    target: "es2022",
    modulePreload: { polyfill: false },
    // Games load as separate chunks; keep their CSS with them.
    cssCodeSplit: true,
    reportCompressedSize: false,
    outDir: "dist",
    emptyOutDir: true,
  },
});
