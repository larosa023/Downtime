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
  tripeaks: (() => {
    const rows = [[1.5, 4.5, 7.5], [1, 2, 4, 5, 7, 8], [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5]];
    let out = "";
    rows.forEach((xs, r) =>
      xs.forEach((x, i) => {
        const px = 10 + x * 22;
        const py = 10 + r * 22;
        out += r < 2 ? `<g transform="scale(0.55) translate(${px / 0.55} ${py / 0.55})">${back(0, 0)}</g>` : `<g transform="scale(0.55) translate(${px / 0.55} ${py / 0.55})">${card(0, 0, 0, i % 3 === 0, ["7", "8", "6", "9", "5", "J", "4", "10", "3"][i])}</g>`;
      }),
    );
    return out + back(84, 92) + card(130, 88, 0, true, "6");
  })(),
  pyramid: (() => {
    let out = "";
    const labels = ["K", "6", "7", "Q", "A", "5", "8", "3", "J", "9"];
    let k = 0;
    for (let r = 0; r < 4; r++)
      for (let i = 0; i <= r; i++) {
        const px = 126 - r * 13 + i * 26 - 11;
        const py = 8 + r * 22;
        out += `<g transform="scale(0.58) translate(${px / 0.58} ${py / 0.58})">${card(0, 0, 0, (r + i) % 2 === 1, labels[k++ % labels.length])}</g>`;
      }
    return back(14, 30) + card(14, 82, 0, false, "8") + out;
  })(),
  sudoku: (() => {
    const vals = "5 3 . . 7 . . . . 6 . . 1 9 5 . . . . 9 8 . . . . 6 .".split(" ");
    let out = `<rect class="a-grid" x="66" y="9" width="120" height="120" rx="8"/>`;
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 9; c++) {
        const v = vals[r * 9 + c];
        const x = 66 + c * 13.33;
        const y = 9 + r * 13.33;
        if (v !== ".") out += `<text class="a-sdk${c === 4 && r === 0 ? " a-sdk-sel" : ""}" x="${x + 6.6}" y="${y + 10}">${v}</text>`;
      }
    for (let i = 1; i < 9; i++) {
      const w = i % 3 === 0 ? 1.6 : 0.6;
      out += `<line class="a-gl" x1="${66 + i * 13.33}" y1="9" x2="${66 + i * 13.33}" y2="129" stroke-width="${w}"/><line class="a-gl" x1="66" y1="${9 + i * 13.33}" x2="186" y2="${9 + i * 13.33}" stroke-width="${w}"/>`;
    }
    return out + `<rect class="a-sdk-hi" x="${66 + 4 * 13.33}" y="${9 + 5 * 13.33}" width="13.33" height="13.33"/><text class="a-sdk a-sdk-sel" x="${66 + 4 * 13.33 + 6.6}" y="${9 + 5 * 13.33 + 10}">7</text>`;
  })(),
  blocks: (() => {
    const s = 14;
    const ox = 91;
    const cells: [number, number, string][] = [
      [0, 8, "#5b8def"], [0, 7, "#5b8def"], [1, 8, "#5b8def"], [2, 8, "#5b8def"],
      [3, 8, "#f2c14e"], [4, 8, "#f2c14e"], [3, 7, "#f2c14e"], [4, 7, "#f2c14e"],
      [5, 8, "#62c27a"], [6, 8, "#62c27a"], [6, 7, "#62c27a"], [7, 7, "#62c27a"],
      [1, 7, "#ef6f6c"], [2, 7, "#ef6f6c"], [2, 6, "#ef6f6c"], [3, 6, "#ef6f6c"],
      [4, 2, "#a77bd8"], [3, 3, "#a77bd8"], [4, 3, "#a77bd8"], [5, 3, "#a77bd8"],
    ];
    let out = `<rect class="a-well" x="${ox - 4}" y="2" width="${s * 5 + 8}" height="${s * 9 + 6}" rx="6"/>`;
    for (const [x, y, c] of cells) if (x < 5) out += `<rect x="${ox + x * s + 1}" y="${4 + y * s + 1}" width="${s - 2}" height="${s - 2}" rx="3" fill="${c}"/>`;
    return out;
  })(),
  breakout: (() => {
    const colors = ["#ef6f6c", "#f2994a", "#f2c14e", "#62c27a"];
    let out = "";
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 8; c++)
        if (!(r === 3 && (c === 2 || c === 3)) && !(r === 2 && c === 3))
          out += `<rect x="${22 + c * 27}" y="${14 + r * 13}" width="24" height="10" rx="3" fill="${colors[r]}"/>`;
    return out + `<circle class="a-ink-f" cx="118" cy="96" r="6"/><rect class="a-paddle" x="128" y="122" width="54" height="8" rx="4"/><path class="a-trail" d="M118 96 L150 122"/>`;
  })(),
};

export function gameArt(id: string): string {
  return `<svg class="art" viewBox="0 0 252 144" aria-hidden="true">${ART[id] ?? ""}</svg>`;
}
