import {
  CardBack,
  CustomTheme,
  getSettings,
  resetSettings,
  Settings,
  SoundGroup,
  THEMES,
  updateSettings,
} from "../../core/settings";
import { allStats, reloadStats, resetStats } from "../../core/stats";
import { exportAll, importAll } from "../../core/storage";
import { evaluateAchievements, resetAchievements, setFlag } from "../../core/achievements";
import { appVersion, checkForUpdate, installUpdate, updateState } from "../../core/updater";
import { sfx } from "../../core/sound";
import { GAMES, gameById } from "../../games";
import { ICONS } from "../icons";
import { esc } from "../shared";

export const SECTIONS = [
  { id: "appearance", name: "Appearance" },
  { id: "cards", name: "Cards" },
  { id: "gameplay", name: "Gameplay" },
  { id: "sound", name: "Sound" },
  { id: "window", name: "Window and startup" },
  { id: "updates", name: "Updates" },
  { id: "data", name: "Data" },
  { id: "shortcuts", name: "Shortcuts" },
  { id: "about", name: "About" },
] as const;

export const GLOBAL_KEYS: [string, string][] = [
  ["Ctrl K", "Search games, pages and actions"],
  ["F2 or Ctrl N", "New game"],
  ["Ctrl Z", "Undo"],
  ["P", "Pause (P or Esc to resume)"],
  ["H", "Hint"],
  ["M", "Mini player"],
  ["F11", "Full screen"],
  ["?", "Show these shortcuts"],
];

// ---------- small builders ----------

const item = (label: string, body: string, extra = "") =>
  `<div class="set-item" data-label="${esc(label.toLowerCase())}${extra ? " " + esc(extra.toLowerCase()) : ""}">${body}</div>`;

function toggle(key: keyof Settings, label: string, on: boolean, hint = "") {
  return item(
    label,
    `<label class="toggle"><input type="checkbox" data-set="${key}" ${on ? "checked" : ""}/><span class="switch"></span><span>${label}${hint ? `<small>${hint}</small>` : ""}</span></label>`,
    hint,
  );
}

function choice(key: keyof Settings, label: string, options: [string, string][], value: string, hint = "") {
  return item(
    label,
    `<div class="choice-row">
      <span class="choice-label">${label}${hint ? `<small>${hint}</small>` : ""}</span>
      <div class="seg" role="radiogroup" aria-label="${label}" data-choice="${key}">
        ${options.map(([v, l]) => `<button role="radio" type="button" data-v="${v}" aria-checked="${v === value}">${l}</button>`).join("")}
      </div>
    </div>`,
    hint,
  );
}

/** Normalize any CSS color to #rrggbb. */
function toHex(color: string): string {
  const c = document.createElement("canvas").getContext("2d")!;
  c.fillStyle = "#000";
  c.fillStyle = color.trim();
  const v = c.fillStyle;
  if (v.startsWith("#")) return v;
  const m = v.match(/\d+(\.\d+)?/g);
  if (!m) return "#000000";
  return "#" + m.slice(0, 3).map((n) => Math.round(Number(n)).toString(16).padStart(2, "0")).join("");
}

const CT_FIELDS: { key: keyof CustomTheme; label: string }[] = [
  { key: "bg", label: "Background" },
  { key: "surface", label: "Panels" },
  { key: "ink", label: "Text" },
  { key: "accent", label: "Accent" },
  { key: "table", label: "Table" },
];

function customEditor(s: Settings) {
  const ct = s.customTheme;
  return `<div class="ct-editor" ${s.theme === "custom" ? "" : "hidden"}>
    <div class="ct-fields">
      ${CT_FIELDS.map(
        (f) => `<label class="ct-field"><input type="color" data-ct="${f.key}" value="${ct[f.key]}"/><span>${f.label}<small data-ct-hex="${f.key}">${ct[f.key].toUpperCase()}</small></span></label>`,
      ).join("")}
    </div>
    <div class="ct-actions">
      <span class="dim">Start from</span>
      ${THEMES.filter((t) => t.id !== "custom")
        .map((t) => `<button type="button" class="theme-dot" data-ct-from="${t.id}" title="${t.name}" aria-label="Start from ${t.name}" style="--a:${t.swatch[0]};--b:${t.swatch[1]}"></button>`)
        .join("")}
    </div>
  </div>`;
}

// ---------- page ----------

export function showSettings(stage: HTMLElement, section?: string): () => void {
  document.title = "Settings — Downtime";
  const s = getSettings();
  const backs: { id: CardBack; name: string }[] = [
    { id: "weave", name: "Weave" },
    { id: "dots", name: "Dots" },
    { id: "plain", name: "Plain" },
    { id: "stripes", name: "Stripes" },
    { id: "checker", name: "Checker" },
  ];
  const groups: { id: SoundGroup; name: string }[] = [
    { id: "cards", name: "Cards (deal, flip, place)" },
    { id: "moves", name: "Moves (ticks, matches, eating)" },
    { id: "results", name: "Results (wins, losses, mistakes, trophies)" },
  ];
  const statGames = GAMES.filter((g) => Object.keys(allStats()).some((k) => k === g.id || k.startsWith(g.id + ":")));
  const gameKeys = GAMES.filter((g) => g.keys?.length);
  const u = updateState();

  const sec = (id: string, title: string, body: string, note = "") =>
    `<section class="set-section" id="set-${id}" data-section="${id}"><h2>${title}</h2>${note ? `<p class="dim set-note">${note}</p>` : ""}${body}</section>`;

  stage.innerHTML = `
    <div class="page settings-page">
      <header class="page-head settings-head">
        <h1>Settings</h1>
        <label class="search">
          ${ICONS.search}
          <span class="sr-only">Search settings</span>
          <input type="search" placeholder="Search settings" data-set-search autocomplete="off" spellcheck="false"/>
        </label>
      </header>
      <div class="settings-layout">
        <nav class="set-nav" aria-label="Settings sections">
          ${SECTIONS.map((x) => `<a href="#/settings/${x.id}" data-nav="${x.id}">${x.name}</a>`).join("")}
        </nav>
        <div class="set-body">
          ${sec(
            "appearance",
            "Appearance",
            item(
              "Theme custom colors",
              `<div class="themes" role="radiogroup" aria-label="Theme">
                ${THEMES.map(
                  (t) => `<button class="theme-card" role="radio" type="button" aria-checked="${t.id === s.theme}" data-set-theme="${t.id}">
                    <span class="theme-preview" data-theme="${t.id}"><i></i><i></i><i></i></span>
                    <span>${t.name}</span>
                  </button>`,
                ).join("")}
              </div>
              ${customEditor(s)}`,
            ) +
              item(
                "Accent color",
                `<div class="accent-row">
                  <label class="accent-pick"><input type="color" data-accent value="${s.accent || toHex(getComputedStyle(document.documentElement).getPropertyValue("--accent"))}"/><span>Custom accent color</span></label>
                  <button class="btn ghost" type="button" data-accent-reset ${s.accent ? "" : "disabled"}>Use the theme's color</button>
                </div>`,
              ) +
              choice("font", "Font", [["default", "Downtime"], ["figtree", "Figtree"], ["system", "Windows"]], s.font, "Windows uses Segoe UI and loads no extra fonts") +
              choice("corners", "Corners", [["sharp", "Sharp"], ["normal", "Normal"], ["round", "Round"]], s.corners) +
              choice("texture", "Table texture", [["plain", "Plain"], ["grain", "Grain"], ["felt", "Felt"], ["dots", "Dots"]], s.texture, "Drawn behind the games") +
              item(
                "Size zoom scale",
                `<label class="slider"><span>Size</span><input type="range" min="80" max="150" step="5" value="${s.scale}" data-scale/><output>${s.scale}%</output></label>
                 <p class="dim set-hint">Makes everything in the window bigger or smaller.</p>`,
              ) +
              choice("animSpeed", "Animations", [["off", "Off"], ["fast", "Fast"], ["normal", "Normal"], ["slow", "Relaxed"]], s.animSpeed, "Motion") +
              toggle("compactRail", "Compact sidebar", s.compactRail, "Show game icons only") +
              toggle("lowPower", "Battery saver", s.lowPower, "Caps arcade games at 30 fps and turns off blur and heavy shadows"),
          )}
          ${sec(
            "cards",
            "Cards",
            item(
              "Card back",
              `<div class="backs" role="radiogroup" aria-label="Card back">
                ${backs
                  .map(
                    (b) => `<button class="back-card" role="radio" type="button" aria-checked="${b.id === s.cardBack}" data-set-back="${b.id}">
                      <span class="back-preview" data-back="${b.id}"><span class="card-back"></span></span>
                      <span>${b.name}</span>
                    </button>`,
                  )
                  .join("")}
              </div>`,
            ) +
              choice("cardFace", "Card faces", [["classic", "Classic"], ["simple", "Simple"], ["bold", "Bold"]], s.cardFace) +
              toggle("fourColor", "Four-color deck", s.fourColor, "Diamonds blue, clubs green") +
              toggle("largeCards", "Large print", s.largeCards, "Bigger numbers in the card corners") +
              choice("autoMove", "Move to foundations", [["off", "Never"], ["safe", "When safe"], ["all", "Always"]], s.autoMove, "Sends cards up automatically") +
              toggle("clickToMove", "Click to move", s.clickToMove, "Clicking a card sends it to the best spot"),
          )}
          ${sec(
            "gameplay",
            "Gameplay",
            toggle("confirmNew", "Ask before starting a new game", s.confirmNew, "Only when a game is under way") +
              toggle("autoPause", "Pause when Downtime is in the background", s.autoPause, "Stops the clock when you switch to another app") +
              toggle("showTimer", "Show the clock", s.showTimer) +
              toggle("showMoves", "Show the move counter", s.showMoves) +
              toggle("hints", "Hints", s.hints, "Shows the Hint button and turns on the H key") +
              toggle("celebrate", "Celebrate wins", s.celebrate, "A short burst of confetti"),
          )}
          ${sec(
            "sound",
            "Sound",
            toggle("sound", "Sound effects", s.sound) +
              item(
                "Volume",
                `<div class="slider-row"><label class="slider"><span>Volume</span><input type="range" min="0" max="100" step="5" value="${s.volume}" data-volume ${s.sound ? "" : "disabled"}/><output>${s.volume}</output></label>
                 <button class="btn ghost" type="button" data-test-sound ${s.sound ? "" : "disabled"}>Play a test sound</button></div>`,
              ) +
              item(
                "Sound groups cards moves results",
                `<div class="sound-groups">
                  ${groups
                    .map(
                      (g) =>
                        `<label class="check"><input type="checkbox" data-sound-group="${g.id}" ${s.soundGroups[g.id] ? "checked" : ""} ${s.sound ? "" : "disabled"}/><span>${g.name}</span></label>`,
                    )
                    .join("")}
                </div>`,
              ),
          )}
          ${sec(
            "window",
            "Window and startup",
            choice("startPage", "Open to", [["home", "Home"], ["last", "Last game"], ["today", "Today"]], s.startPage, "What you see when Downtime starts") +
              toggle("alwaysOnTop", "Always on top", s.alwaysOnTop, "Keep Downtime above other windows") +
              item("Mini player full screen", `<p class="dim">The mini player button in a game's top bar (or M) shrinks Downtime to a small window that stays on top. F11 switches full screen on and off.</p>`),
          )}
          ${sec(
            "updates",
            "Updates",
            (u.kind === "unsupported"
              ? item("Updates", `<p class="dim">Updates are handled by the installed app. This copy is running in a browser.</p>`)
              : choice(
                  "updates",
                  "Install updates",
                  [["auto", "Automatically"], ["notify", "Ask first"], ["off", "Off"]],
                  s.updates,
                  "Automatically downloads in the background and installs when you restart",
                ) +
                item(
                  "Check for updates version",
                  `<p class="dim">Downtime <span data-version></span>.</p>
                   <div class="update-row">
                     <button class="btn ghost" type="button" data-check>${ICONS.refresh}<span>Check for updates</span></button>
                     <span class="update-msg" aria-live="polite"></span>
                   </div>
                   <div class="release-notes" hidden></div>`,
                )),
          )}
          ${sec(
            "data",
            "Data",
            item(
              "Backup export import",
              `<p class="dim">Stats, trophies, settings and games in progress are saved on this computer. A backup file lets you move them to another computer or keep them safe.</p>
               <div class="btn-row">
                 <button class="btn ghost" type="button" data-export>${ICONS.download}<span>Save a backup</span></button>
                 <label class="btn ghost file-btn">${ICONS.upload}<span>Restore from a backup</span><input type="file" accept=".json,application/json" data-import hidden/></label>
               </div>
               <p class="data-msg" aria-live="polite"></p>`,
            ) +
              item(
                "Reset one game's stats",
                `<div class="btn-row">
                  <label class="select"><span class="sr-only">Game</span><select data-reset-game ${statGames.length ? "" : "disabled"}>
                    ${statGames.length ? statGames.map((g) => `<option value="${g.id}">${g.name}</option>`).join("") : `<option>No stats yet</option>`}
                  </select></label>
                  <button class="btn danger" type="button" data-reset-one ${statGames.length ? "" : "disabled"}>Reset this game's stats</button>
                </div>`,
              ) +
              item(
                "Reset everything settings defaults",
                `<div class="btn-row">
                  <button class="btn danger" type="button" data-reset>Reset all stats and trophies</button>
                  <button class="btn ghost" type="button" data-reset-settings>Restore default settings</button>
                </div>`,
              ),
          )}
          ${sec(
            "shortcuts",
            "Shortcuts",
            item(
              "Keyboard shortcuts keys",
              `<table class="keys"><tbody>
                ${GLOBAL_KEYS.map(([k, d]) => `<tr><td>${k.split(" or ").map((x) => x.split(" ").map((p) => `<kbd>${p}</kbd>`).join("")).join(" or ")}</td><td>${d}</td></tr>`).join("")}
              </tbody></table>`,
            ) +
              gameKeys
                .map((g) =>
                  item(
                    `${g.name} keys`,
                    `<h3 class="keys-game">${g.name}</h3><table class="keys"><tbody>${g.keys!.map(([k, d]) => `<tr><td><kbd>${esc(k)}</kbd></td><td>${esc(d)}</td></tr>`).join("")}</tbody></table>`,
                  ),
                )
                .join(""),
            "Game-specific keys are listed under each game.",
          )}
          ${sec(
            "about",
            "About",
            item(
              "About version license github",
              `<div class="about">
                <img src="/icon.png" alt="" width="48" height="48"/>
                <div>
                  <strong>Downtime</strong> <span class="dim" data-version></span>
                  <p class="dim">Classic desk games, done cleanly. ${GAMES.length} games, free and open source under the MIT license.</p>
                  <p><a class="link" href="https://github.com/larosa023/Downtime" target="_blank" rel="noopener">Source code and releases on GitHub</a></p>
                </div>
              </div>`,
            ),
          )}
          <div class="empty set-empty" hidden><p>No settings match that.</p></div>
        </div>
      </div>
    </div>`;

  // ---------- wiring ----------

  const $ = <T extends Element = HTMLElement>(sel: string) => stage.querySelector<T>(sel);
  const $$ = <T extends Element = HTMLElement>(sel: string) => stage.querySelectorAll<T>(sel);

  $$<HTMLElement>("[data-set-theme]").forEach((b) =>
    b.addEventListener("click", () => {
      const theme = b.dataset.setTheme as Settings["theme"];
      updateSettings({ theme });
      $$("[data-set-theme]").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
      $(".ct-editor")!.hidden = theme !== "custom";
      if (theme === "custom") setFlag("custom-theme");
      syncAccent();
    }),
  );
  const setCt = (patch: Partial<CustomTheme>) => {
    updateSettings({ theme: "custom", customTheme: { ...getSettings().customTheme, ...patch } });
    $$("[data-set-theme]").forEach((x) => x.setAttribute("aria-checked", String((x as HTMLElement).dataset.setTheme === "custom")));
    for (const f of CT_FIELDS) {
      const v = getSettings().customTheme[f.key];
      const i = $<HTMLInputElement>(`[data-ct="${f.key}"]`)!;
      if (i.value !== v) i.value = v;
      $(`[data-ct-hex="${f.key}"]`)!.textContent = v.toUpperCase();
    }
    syncAccent();
  };
  $$<HTMLInputElement>("[data-ct]").forEach((i) => {
    i.addEventListener("input", () => setCt({ [i.dataset.ct!]: i.value }));
    i.addEventListener("change", () => {
      setFlag("custom-theme");
      evaluateAchievementsLater();
    });
  });
  $$<HTMLElement>("[data-ct-from]").forEach((b) =>
    b.addEventListener("click", () => {
      // Read the chosen theme's colors off a hidden sample element.
      const probe = document.createElement("div");
      probe.dataset.theme = b.dataset.ctFrom!;
      probe.style.display = "none";
      document.body.appendChild(probe);
      const cs = getComputedStyle(probe);
      const pick = (v: string) => toHex(cs.getPropertyValue(v));
      setCt({ bg: pick("--bg"), surface: pick("--surface"), ink: pick("--ink"), accent: pick("--accent"), table: pick("--table") });
      probe.remove();
    }),
  );

  $$<HTMLElement>("[data-set-back]").forEach((b) =>
    b.addEventListener("click", () => {
      updateSettings({ cardBack: b.dataset.setBack as CardBack });
      $$("[data-set-back]").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
    }),
  );
  $$<HTMLInputElement>("input[data-set]").forEach((i) =>
    i.addEventListener("change", () => {
      updateSettings({ [i.dataset.set!]: i.checked });
      if (i.dataset.set === "sound") {
        $$<HTMLInputElement>("[data-volume], [data-sound-group], [data-test-sound]").forEach((x) => ((x as HTMLInputElement).disabled = !i.checked));
      }
    }),
  );
  $$<HTMLElement>("[data-choice]").forEach((grp) =>
    grp.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-v]");
      if (!b) return;
      updateSettings({ [grp.dataset.choice!]: b.dataset.v } as Partial<Settings>);
      grp.querySelectorAll("[data-v]").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
    }),
  );

  const accent = $<HTMLInputElement>("[data-accent]")!;
  const accentReset = $<HTMLButtonElement>("[data-accent-reset]")!;
  function syncAccent() {
    if (!getSettings().accent) accent.value = toHex(getComputedStyle(document.documentElement).getPropertyValue("--accent"));
  }
  accent.addEventListener("input", () => {
    updateSettings({ accent: accent.value });
    accentReset.disabled = false;
  });
  accentReset.addEventListener("click", () => {
    updateSettings({ accent: "" });
    accentReset.disabled = true;
    syncAccent();
  });

  const scale = $<HTMLInputElement>("[data-scale]")!;
  scale.addEventListener("input", () => (scale.nextElementSibling!.textContent = `${scale.value}%`));
  // Apply on release: zooming while dragging would move the slider under the pointer.
  scale.addEventListener("change", () => updateSettings({ scale: Number(scale.value) }));

  const vol = $<HTMLInputElement>("[data-volume]")!;
  vol.addEventListener("input", () => {
    updateSettings({ volume: Number(vol.value) });
    vol.nextElementSibling!.textContent = vol.value;
  });
  vol.addEventListener("change", () => sfx.place());
  $("[data-test-sound]")!.addEventListener("click", () => sfx.win());
  $$<HTMLInputElement>("[data-sound-group]").forEach((i) =>
    i.addEventListener("change", () => updateSettings({ soundGroups: { ...getSettings().soundGroups, [i.dataset.soundGroup!]: i.checked } })),
  );

  void appVersion().then((v) => $$("[data-version]").forEach((el) => (el.textContent = `version ${v}`)));
  $("[data-check]")?.addEventListener("click", () => {
    const st = updateState();
    if (st.kind === "available" || st.kind === "ready") void installUpdate();
    else void checkForUpdate();
  });

  // Data
  const msg = $(".data-msg")!;
  $("[data-export]")!.addEventListener("click", async () => {
    const backup = { app: "Downtime", version: await appVersion(), exported: new Date().toISOString(), data: exportAll() };
    const blob = new Blob([JSON.stringify(backup, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const d = new Date();
    a.download = `downtime-backup-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    msg.textContent = "Backup saved to your Downloads folder.";
    msg.classList.remove("error");
    setFlag("backup");
    evaluateAchievementsLater();
  });
  $<HTMLInputElement>("[data-import]")!.addEventListener("change", async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || parsed.app !== "Downtime" || typeof parsed.data !== "object" || Array.isArray(parsed.data)) throw new Error("not a backup");
      if (!("settings" in parsed.data) && !("stats" in parsed.data)) throw new Error("empty backup");
      importAll(parsed.data);
      msg.textContent = "Backup restored. Reloading…";
      msg.classList.remove("error");
      setTimeout(() => location.reload(), 400);
    } catch {
      msg.textContent = "That file isn't a Downtime backup. Choose a file saved with Save a backup.";
      msg.classList.add("error");
    }
  });
  const resetOne = $<HTMLButtonElement>("[data-reset-one]")!;
  const resetSel = $<HTMLSelectElement>("[data-reset-game]")!;
  resetSel.addEventListener("change", () => {
    delete resetOne.dataset.confirm;
    resetOne.textContent = "Reset this game's stats";
  });
  resetOne.addEventListener("click", () => {
    const g = gameById(resetSel.value);
    if (!g) return;
    if (!resetOne.dataset.confirm) {
      resetOne.dataset.confirm = "1";
      resetOne.textContent = `Click again to reset ${g.name}`;
      return;
    }
    resetStats(g.id);
    resetOne.textContent = `${g.name} stats reset`;
    resetOne.disabled = true;
  });
  const reset = $<HTMLButtonElement>("[data-reset]")!;
  reset.addEventListener("click", () => {
    if (reset.dataset.confirm) {
      resetStats();
      resetAchievements();
      reloadStats();
      reset.textContent = "Stats and trophies reset";
      reset.disabled = true;
    } else {
      reset.dataset.confirm = "1";
      reset.textContent = "Click again to reset everything";
    }
  });
  const resetSet = $<HTMLButtonElement>("[data-reset-settings]")!;
  resetSet.addEventListener("click", () => {
    if (!resetSet.dataset.confirm) {
      resetSet.dataset.confirm = "1";
      resetSet.textContent = "Click again to restore defaults";
      return;
    }
    resetSettings();
    showSettings(stage, "data");
  });

  // Search
  const search = $<HTMLInputElement>("[data-set-search]")!;
  search.addEventListener("input", () => {
    const words = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let any = false;
    $$<HTMLElement>(".set-section").forEach((secEl) => {
      const title = secEl.querySelector("h2")!.textContent!.toLowerCase();
      let n = 0;
      secEl.querySelectorAll<HTMLElement>(".set-item").forEach((it) => {
        const text = `${title} ${it.dataset.label} ${it.textContent!.toLowerCase()}`;
        const ok = words.every((w) => text.includes(w));
        it.hidden = !ok;
        if (ok) n++;
      });
      secEl.hidden = n === 0;
      if (n) any = true;
    });
    $(".set-empty")!.hidden = any;
    stage.classList.toggle("searching", words.length > 0);
  });

  // Section nav: highlight the section in view.
  const nav = $(".set-nav")!;
  nav.addEventListener("click", (e) => {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("[data-nav]");
    if (!a) return;
    e.preventDefault();
    history.replaceState(null, "", `#/settings/${a.dataset.nav}`);
    scrollToSection(a.dataset.nav!);
  });
  const scrollToSection = (id: string) => {
    const el = $(`#set-${id}`);
    if (el) stage.scrollTo({ top: el.offsetTop - 24, behavior: "instant" as ScrollBehavior });
    markNav(id);
  };
  const markNav = (id: string) => nav.querySelectorAll("[data-nav]").forEach((x) => x.toggleAttribute("aria-current", (x as HTMLElement).dataset.nav === id));
  const onScroll = () => {
    let cur: string = SECTIONS[0].id;
    for (const x of SECTIONS) {
      const el = $(`#set-${x.id}`);
      if (el && !el.hidden && el.offsetTop - 80 <= stage.scrollTop) cur = x.id;
    }
    if (stage.scrollTop + stage.clientHeight >= stage.scrollHeight - 4) cur = [...SECTIONS].reverse().find((x) => !$(`#set-${x.id}`)?.hidden)?.id ?? cur;
    markNav(cur);
  };
  stage.addEventListener("scroll", onScroll, { passive: true });
  if (section) requestAnimationFrame(() => scrollToSection(section));
  else markNav(SECTIONS[0].id);

  renderSettingsUpdates();
  return () => stage.removeEventListener("scroll", onScroll);
}

let evalTimer = 0;
let evalHook: (() => void) | null = null;
/** main.ts registers its achievement check so flags set here pop a toast. */
export function setAchievementHook(fn: () => void) {
  evalHook = fn;
}
function evaluateAchievementsLater() {
  clearTimeout(evalTimer);
  evalTimer = window.setTimeout(() => (evalHook ? evalHook() : evaluateAchievements()), 300);
}

/** Refresh the update controls on the Settings page, if it's open. */
export function renderSettingsUpdates() {
  const s = updateState();
  const msg = document.querySelector<HTMLElement>(".update-msg");
  const btn = document.querySelector<HTMLButtonElement>("[data-check]");
  const notes = document.querySelector<HTMLElement>(".release-notes");
  const busy = s.kind === "downloading" || s.kind === "installing";
  if (msg) {
    msg.textContent = updateLabel();
    msg.classList.toggle("error", s.kind === "error");
  }
  if (btn) {
    btn.disabled = s.kind === "checking" || busy;
    btn.querySelector("span")!.textContent =
      s.kind === "available" ? `Install ${s.version}` : s.kind === "ready" ? "Restart to update" : "Check for updates";
  }
  if (notes) {
    const ok = s.kind === "available" || s.kind === "ready";
    const text = ok ? s.notes?.trim() : "";
    notes.hidden = !text;
    if (ok && text) notes.innerHTML = `<h3>What's new in ${s.version}</h3><p>${esc(text)}</p>`;
  }
}

export function updateLabel(): string {
  const s = updateState();
  switch (s.kind) {
    case "checking":
      return "Checking…";
    case "current":
      return "You're on the latest version.";
    case "available":
      return `Version ${s.version} is ready to install.`;
    case "ready":
      return `Version ${s.version} is downloaded. It installs when you restart.`;
    case "downloading":
      return `Downloading ${Math.round(s.progress * 100)}%`;
    case "installing":
      return "Installing. Downtime will restart.";
    case "error":
      return s.message;
    default:
      return "";
  }
}
