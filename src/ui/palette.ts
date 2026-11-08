// Ctrl+K: jump to any game, page, setting section or action.

import { GROUPS } from "../core/types";
import { GAMES } from "../games";
import { ICONS } from "./icons";
import { esc, gameIcon } from "./shared";

export interface PaletteItem {
  label: string;
  /** Extra words to match, e.g. the group name. */
  keywords?: string;
  hint?: string;
  icon?: string;
  run(): void;
}

/** Simple fuzzy score: every query character in order; bonus for word starts and runs. -1 when no match. */
function score(text: string, q: string): number {
  if (!q) return 0;
  const t = text.toLowerCase();
  const idx = t.indexOf(q);
  if (idx >= 0) return 1000 - idx * 2 - (t.length - q.length) * 0.5 + (idx === 0 || t[idx - 1] === " " ? 200 : 0);
  let ti = 0;
  let s = 0;
  let run = 0;
  for (const ch of q) {
    if (ch === " ") continue;
    const at = t.indexOf(ch, ti);
    if (at < 0) return -1;
    run = at === ti ? run + 1 : 0;
    s += 10 + run * 6 + (at === 0 || t[at - 1] === " " ? 12 : 0) - Math.min(8, at - ti);
    ti = at + 1;
  }
  return s;
}

let open: HTMLElement | null = null;

export function closePalette() {
  open?.remove();
  open = null;
}

export function paletteOpen() {
  return !!open;
}

export function openPalette(extra: () => PaletteItem[]) {
  if (open) return closePalette();
  const items: PaletteItem[] = [
    ...extra(),
    ...GAMES.map((g) => ({
      label: g.name,
      keywords: `${GROUPS.find((x) => x.id === g.group)?.name ?? ""} play game`,
      hint: GROUPS.find((x) => x.id === g.group)?.name,
      icon: gameIcon(g),
      run: () => (location.hash = `#/play/${g.id}`),
    })),
  ];
  const back = document.createElement("div");
  back.className = "palette-back";
  back.innerHTML = `
    <div class="palette" role="dialog" aria-label="Search">
      <label class="palette-input">${ICONS.search}<input type="text" placeholder="Search games, pages and actions" aria-label="Search" autocomplete="off" spellcheck="false"/><kbd>Esc</kbd></label>
      <ul class="palette-list" role="listbox"></ul>
    </div>`;
  document.body.appendChild(back);
  open = back;
  const input = back.querySelector("input")!;
  const list = back.querySelector<HTMLElement>(".palette-list")!;
  let shown: PaletteItem[] = [];
  let sel = 0;

  const render = () => {
    const q = input.value.trim().toLowerCase();
    shown = items
      .map((it, i) => ({ it, s: Math.max(score(it.label, q), score(`${it.label} ${it.keywords ?? ""}`, q) - 50), i }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => (q ? b.s - a.s : 0) || a.i - b.i)
      .slice(0, q ? 12 : 14)
      .map((x) => x.it);
    sel = Math.min(sel, Math.max(0, shown.length - 1));
    list.innerHTML = shown.length
      ? shown
          .map(
            (it, i) =>
              `<li role="option" data-i="${i}" aria-selected="${i === sel}"><span class="pi-icon">${it.icon ?? ""}</span><span class="pi-label">${esc(it.label)}</span>${it.hint ? `<span class="pi-hint">${esc(it.hint)}</span>` : ""}</li>`,
          )
          .join("")
      : `<li class="pi-empty">Nothing matches that.</li>`;
  };
  const move = (d: number) => {
    if (!shown.length) return;
    sel = (sel + d + shown.length) % shown.length;
    list.querySelectorAll("[data-i]").forEach((li) => li.setAttribute("aria-selected", String(Number((li as HTMLElement).dataset.i) === sel)));
    list.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  };
  const run = (i: number) => {
    const it = shown[i];
    if (!it) return;
    closePalette();
    it.run();
  };
  input.addEventListener("input", () => {
    sel = 0;
    render();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") move(1);
    else if (e.key === "ArrowUp") move(-1);
    else if (e.key === "Enter") run(sel);
    else if (e.key === "Escape") closePalette();
    else return;
    e.preventDefault();
    e.stopPropagation();
  });
  list.addEventListener("pointermove", (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
    if (li && Number(li.dataset.i) !== sel) move(Number(li.dataset.i) - sel);
  });
  list.addEventListener("click", (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
    if (li) run(Number(li.dataset.i));
  });
  // Keys typed here never reach the game underneath.
  back.addEventListener("keydown", (e) => e.stopPropagation());
  back.addEventListener("pointerdown", (e) => {
    if (e.target === back) closePalette();
  });
  render();
  input.focus();
}
