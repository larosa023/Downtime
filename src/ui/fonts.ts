// Load only the Latin files of the two variable fonts. The packages' own CSS also ships
// latin-ext and Vietnamese files, which an English UI never uses.

import displayUrl from "@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2?url";
import uiUrl from "@fontsource-variable/figtree/files/figtree-latin-wght-normal.woff2?url";

export function loadFonts(): void {
  const faces = [
    new FontFace("Bricolage Grotesque Variable", `url(${displayUrl}) format("woff2")`, { weight: "200 800", display: "swap" }),
    new FontFace("Figtree Variable", `url(${uiUrl}) format("woff2")`, { weight: "300 900", display: "swap" }),
  ];
  for (const f of faces) {
    document.fonts.add(f);
    f.load().catch(() => {
      /* fall back to Segoe UI */
    });
  }
}
