// Small illustrations for the home screen. Colors come from theme tokens via classes.

const card = (x: number, y: number, r = 0, red = false, label = "") => `
  <g transform="translate(${x} ${y}) rotate(${r})">
    <rect class="a-card" width="38" height="54" rx="5"/>
    ${label ? `<text class="${red ? "a-red" : "a-ink"} a-idx" x="6" y="15">${label}</text>` : ""}
    ${label ? `<path class="${red ? "a-red-f" : "a-ink-f"}" d="M19 22 27 32 19 42 11 32z" transform="translate(0 2) scale(1)"/>` : ""}
  </g>`;

const back = (x: number, y: number, r = 0) => `
  <g transform="translate(${x} ${y}) rotate(${r})">
    <rect class="a-back" width="38" height="54" rx="5"/>
    <rect class="a-back-line" x="4" y="4" width="30" height="46" rx="3"/>
  </g>`;

const ART: Record<string, string> = {
  klondike: `
    ${back(18, 18)}${card(64, 18, 0, false, "")}
    ${[0, 1, 2, 3].map((i) => `<rect class="a-slot" x="${118 + i * 30}" y="18" width="26" height="36" rx="4"/>`).join("")}
    ${[0, 1, 2].map((i) => back(30 + i * 52, 80 + i * 0)).join("")}
    ${card(30, 100, 0, true, "7")}${back(82, 92)}${card(82, 112, 0, false, "9")}${card(134, 88, 0, true, "Q")}${card(134, 108, 0, false, "J")}
    ${card(186, 84, 0, false, "K")}`,
  spider: `
    ${Array.from({ length: 6 }, (_, i) =>
      [0, 1, 2].map((k) => back(14 + i * 38, 14 + k * 10)).join("") +
      card(14 + i * 38, 44, 0, false, ["K", "Q", "J", "10", "9", "8"][i]),
    ).join("")}
    ${[0, 1, 2].map((k) => back(196 + k * 4, 112 - k * 2)).join("")}`,
  freecell: `
    ${[0, 1].map((i) => `<rect class="a-slot" x="${16 + i * 30}" y="14" width="26" height="36" rx="4"/>`).join("")}
    ${[0, 1].map((i) => `<rect class="a-slot" x="${170 + i * 30}" y="14" width="26" height="36" rx="4"/>`).join("")}
    ${Array.from({ length: 5 }, (_, i) =>
      [0, 1, 2].map((k) => card(16 + i * 44, 62 + k * 18, 0, (i + k) % 2 === 0, ["6", "5", "4", "3", "8", "2", "J", "9"][(i + k) % 8])).join(""),
    ).join("")}`,
  minesweeper: (() => {
    let s = "";
    const open = new Set([0, 1, 2, 7, 8, 9, 10, 14, 15, 16, 17, 21, 22, 23]);
    const nums: Record<number, string> = { 2: "1", 9: "2", 10: "1", 16: "1", 17: "3", 23: "1", 15: "1" };
    for (let i = 0; i < 28; i++) {
      const x = 22 + (i % 7) * 28;
      const y = 14 + Math.floor(i / 7) * 28;
      s += `<rect class="${open.has(i) ? "a-open" : "a-closed"}" x="${x}" y="${y}" width="25" height="25" rx="4"/>`;
      if (nums[i]) s += `<text class="a-num a-n${nums[i]}" x="${x + 12.5}" y="${y + 17.5}">${nums[i]}</text>`;
    }
    s += `<path class="a-flag" d="M${22 + 4 * 28 + 9} ${14 + 2 * 28 + 6}h9l-3 4 3 4h-9z"/><rect class="a-flag" x="${22 + 4 * 28 + 8}" y="${14 + 2 * 28 + 6}" width="2" height="14" rx="1"/>`;
    return s;
  })(),
  snake: `
    <path class="a-snake" d="M36 108 H96 Q112 108 112 92 V64 Q112 48 128 48 H176"/>
    <circle class="a-head" cx="182" cy="48" r="11"/>
    <circle class="a-eye" cx="186" cy="44" r="2"/><circle class="a-eye" cx="186" cy="52" r="2"/>
    <circle class="a-food" cx="216" cy="94" r="7"/>`,
  "2048": `
    ${[
      [2, 0, 0, 4],
      [0, 8, 16, 0],
      [32, 0, 128, 2],
    ]
      .map((row, r) =>
        row
          .map((v, c) => {
            const x = 46 + c * 42;
            const y = 12 + r * 42;
            return `<rect class="${v ? `a-t a-t${Math.min(v, 128)}` : "a-tbg"}" x="${x}" y="${y}" width="38" height="38" rx="6"/>${
              v ? `<text class="a-tv${v >= 16 ? " a-tv-light" : ""}" x="${x + 19}" y="${y + 25}">${v}</text>` : ""
            }`;
          })
          .join(""),
      )
      .join("")}`,
};

export function gameArt(id: string): string {
  return `<svg class="art" viewBox="0 0 252 144" aria-hidden="true">${ART[id] ?? ""}</svg>`;
}
