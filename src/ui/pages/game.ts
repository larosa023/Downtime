import { getSettings, setGameOption, toggleFavorite } from "../../core/settings";
import { addPlayTime } from "../../core/stats";
import { setGlobalPause } from "../../core/timer";
import { GameContext, GameInstance, GameModule, StatusItem } from "../../core/types";
import { miniOn, onMiniChange, setMini } from "../../core/miniplayer";
import { confetti } from "../confetti";
import { ICONS } from "../icons";
import { optionValue, statsKeyFor } from "../shared";

export interface GameView {
  teardown(): void;
  /** New game, asking first if the setting is on and a game is under way. */
  requestNew(): void;
  togglePause(): void;
  instance(): GameInstance | null;
}

const KIND: Record<string, string> = { time: "time", moves: "moves" };

export function showGame(stage: HTMLElement, game: GameModule): GameView {
  document.title = `${game.name} — Downtime`;
  const opt = (key: string) => optionValue(game, key);
  const fav = () => getSettings().favorites.includes(game.id);
  stage.innerHTML = `
    <div class="play">
      <header class="bar${(game.options?.length ?? 0) >= 3 ? " many-opts" : ""}">
        <h1>${game.name}</h1>
        <button class="icon-btn fav-btn${fav() ? " on" : ""}" data-act="fav" aria-pressed="${fav()}" title="Favorite">${fav() ? ICONS.starFilled : ICONS.star}</button>
        <div class="opts">
          ${(game.options ?? [])
            .map(
              (o) => `<label class="select"><span class="sr-only">${o.label}</span>
                <select data-opt="${o.key}" title="${o.label}">${o.choices
                  .map((c) => `<option value="${c.value}" ${c.value === opt(o.key) ? "selected" : ""}>${c.label}</option>`)
                  .join("")}</select></label>`,
            )
            .join("")}
        </div>
        <dl class="status" aria-live="off"></dl>
        <div class="actions">
          <button class="btn ghost" data-act="finish" title="Finish the game automatically" hidden>${ICONS.finish}<span>Finish</span></button>
          <button class="btn ghost" data-act="hint" title="Hint (H)" hidden>${ICONS.hint}<span>Hint</span></button>
          ${game.hasUndo ? `<button class="btn ghost" data-act="undo" title="Undo (Ctrl+Z)" disabled>${ICONS.undo}<span>Undo</span></button>` : ""}
          <span class="new-wrap">
            <button class="btn" data-act="new" title="New game (F2)">${ICONS.refresh}<span>New game</span></button>
            <span class="confirm-pop" role="dialog" aria-label="Start a new game?" hidden>
              <span>Start a new game? This one will end.</span>
              <span class="confirm-actions">
                <button class="btn ghost" data-act="keep">Keep playing</button>
                <button class="btn" data-act="new-yes">New game</button>
              </span>
            </span>
          </span>
          <button class="icon-btn" data-act="pause" title="Pause (P)" aria-pressed="false">${ICONS.pause}</button>
          <button class="icon-btn" data-act="mini" title="Mini player (M)" aria-pressed="${miniOn()}">${miniOn() ? ICONS.expand : ICONS.mini}</button>
        </div>
      </header>
      <div class="board-wrap">
        <div class="board" data-game="${game.id}"></div>
        <div class="end" hidden></div>
        <div class="pause-overlay" hidden>
          <div class="end-card">
            <h2>Paused</h2>
            <p>The clock is stopped.</p>
            <div class="end-actions"><button class="btn" data-act="resume">${ICONS.play}<span>Resume</span></button></div>
          </div>
        </div>
        <div class="toast" role="status" aria-live="polite"></div>
      </div>
    </div>`;

  const q = <T extends Element = HTMLElement>(sel: string) => stage.querySelector<T>(sel)!;
  const board = q(".board");
  const wrap = q(".board-wrap");
  const statusEl = q(".status");
  const undoBtn = stage.querySelector<HTMLButtonElement>('[data-act="undo"]');
  const hintBtn = q<HTMLButtonElement>('[data-act="hint"]');
  const finishBtn = q<HTMLButtonElement>('[data-act="finish"]');
  const miniBtn = q<HTMLButtonElement>('[data-act="mini"]');
  const pauseBtn = q<HTMLButtonElement>('[data-act="pause"]');
  const endEl = q(".end");
  const pauseEl = q(".pause-overlay");
  const confirmEl = q(".confirm-pop");
  const toastEl = q(".toast");
  let current: GameInstance | null = null;
  let toastTimer = 0;
  let lastStatus = "";
  let lastItems: StatusItem[] = [];
  let ended = false;
  let paused = false;

  // ---------- play time ----------
  // Counted while the game is on screen, not paused, and the player has done something in the last two minutes.
  let since = performance.now();
  let lastInput = performance.now();
  const active = () => !paused && !document.hidden;
  const flushPlay = () => {
    const now = performance.now();
    if (active()) {
      const end = Math.min(now, lastInput + 120_000);
      const secs = (end - since) / 1000;
      if (secs > 0) addPlayTime(statsKeyFor(game), Math.round(secs));
    }
    since = now;
  };
  const onInput = () => {
    if (performance.now() - lastInput > 120_000) since = performance.now();
    lastInput = performance.now();
  };
  const playTimer = window.setInterval(flushPlay, 15_000);

  // ---------- pause ----------
  const hasClock = () => lastItems.some((i) => i.label.toLowerCase() === "time");
  const underway = () => {
    if (ended || !current) return false;
    if (current.inProgress) return current.inProgress();
    return lastItems.some((i) => {
      const l = i.label.toLowerCase();
      return (l === "moves" && parseInt(i.value, 10) > 0) || (l === "time" && /[1-9]/.test(i.value)) || (l === "score" && parseInt(i.value, 10) > 0);
    });
  };
  const setPause = (on: boolean) => {
    if (on === paused || (on && ended)) return;
    flushPlay();
    paused = on;
    pauseEl.hidden = !on;
    wrap.classList.toggle("paused", on);
    current?.setPaused?.(on);
    setGlobalPause(on);
    pauseBtn.setAttribute("aria-pressed", String(on));
    pauseBtn.innerHTML = on ? ICONS.play : ICONS.pause;
    pauseBtn.title = on ? "Resume (P)" : "Pause (P)";
    if (on) pauseEl.querySelector<HTMLButtonElement>("[data-act=resume]")?.focus();
  };
  const autoPause = () => {
    if (!getSettings().autoPause || paused || !current) return;
    if (!(current.setPaused || hasClock()) || !underway()) return;
    setPause(true);
  };
  const onVisibility = () => {
    if (document.hidden) autoPause();
    flushPlay();
  };
  const onBlur = () => autoPause();

  // ---------- new game ----------
  const showConfirm = (on: boolean) => {
    confirmEl.hidden = !on;
    if (on) confirmEl.querySelector<HTMLButtonElement>('[data-act="new-yes"]')!.focus();
  };
  const doNew = () => {
    showConfirm(false);
    if (paused) setPause(false);
    current?.newGame();
  };
  const requestNew = () => {
    if (getSettings().confirmNew && underway()) showConfirm(true);
    else doNew();
  };

  const ctx: GameContext = {
    setStatus(items: StatusItem[]) {
      lastItems = items;
      // Same labels as last time: only touch the values that changed, so a clock tick is one text update.
      const shape = items.map((i) => i.label).join("|");
      if (shape === lastStatus) {
        const dds = statusEl.querySelectorAll("dd");
        items.forEach((i, n) => {
          if (dds[n] && dds[n].textContent !== i.value) dds[n].textContent = i.value;
        });
        return;
      }
      lastStatus = shape;
      statusEl.innerHTML = items.map((i) => `<div data-kind="${KIND[i.label.toLowerCase()] ?? ""}"><dt>${i.label}</dt><dd>${i.value}</dd></div>`).join("");
    },
    setUndo(enabled) {
      if (undoBtn) undoBtn.disabled = !enabled;
    },
    end(summary) {
      ended = true;
      if (paused) setPause(false);
      flushPlay();
      finishBtn.hidden = true;
      endEl.hidden = false;
      endEl.className = `end ${summary.won ? "won" : "lost"}`;
      endEl.innerHTML = `
        <div class="end-card" role="dialog" aria-label="${summary.title}">
          <h2>${summary.title}</h2>
          ${summary.lines.map((l) => `<p>${l}</p>`).join("")}
          <div class="end-actions">
            ${game.hasUndo && !summary.won ? `<button class="btn ghost" data-act="undo">${ICONS.undo}<span>Undo last move</span></button>` : ""}
            <button class="btn" data-act="new-yes" autofocus>${ICONS.refresh}<span>New game</span></button>
          </div>
        </div>`;
      endEl.querySelector<HTMLButtonElement>('[data-act="new-yes"]')?.focus();
      if (summary.won) confetti(wrap);
    },
    clearEnd() {
      ended = false;
      endEl.hidden = true;
      endEl.innerHTML = "";
    },
    toast(message) {
      toastEl.textContent = message;
      toastEl.classList.add("show");
      clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => toastEl.classList.remove("show"), 2600);
    },
    option: opt,
    setFinish(visible) {
      finishBtn.hidden = !visible;
    },
  };

  let mountSeq = 0;
  const mount = async () => {
    const seq = ++mountSeq;
    board.innerHTML = "";
    finishBtn.hidden = true;
    ended = false;
    lastItems = [];
    let create = game.create;
    if (!create && game.load) {
      board.classList.add("loading");
      try {
        create = (await game.load()).create;
      } catch (e) {
        console.error(e);
        ctx.toast("This game couldn't load. Try restarting Downtime.");
        return;
      } finally {
        board.classList.remove("loading");
      }
      // The player may have left or changed options while the code loaded.
      if (seq !== mountSeq || !board.isConnected) return;
    }
    current = create!(board, ctx);
    hintBtn.hidden = typeof current.requestHint !== "function";
  };
  void mount();

  const play = q(".play");
  play.addEventListener("click", (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>("[data-act]")?.dataset.act;
    if (act === "new") requestNew();
    else if (act === "new-yes") doNew();
    else if (act === "keep") showConfirm(false);
    else if (act === "undo") current?.undo?.();
    else if (act === "hint") current?.requestHint?.();
    else if (act === "finish") current?.autoFinish?.();
    else if (act === "pause") setPause(!paused);
    else if (act === "resume") setPause(false);
    else if (act === "mini") void setMini(!miniOn());
    else if (act === "fav") {
      const on = toggleFavorite(game.id);
      const b = q('[data-act="fav"]');
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
      b.innerHTML = on ? ICONS.starFilled : ICONS.star;
    }
  });
  // Clicking elsewhere closes the confirm popover.
  const onDocDown = (e: PointerEvent) => {
    if (!confirmEl.hidden && !(e.target as HTMLElement).closest(".new-wrap")) showConfirm(false);
    onInput();
  };
  document.addEventListener("pointerdown", onDocDown, true);

  stage.querySelectorAll<HTMLSelectElement>("select[data-opt]").forEach((sel) =>
    sel.addEventListener("change", () => {
      flushPlay();
      if (paused) setPause(false);
      setGameOption(game.id, sel.dataset.opt!, sel.value);
      sel.blur();
      current?.destroy();
      current = null;
      ctx.clearEnd();
      void mount();
    }),
  );

  const offMini = onMiniChange((on) => {
    miniBtn.innerHTML = on ? ICONS.expand : ICONS.mini;
    miniBtn.setAttribute("aria-pressed", String(on));
    setTimeout(() => current?.resize?.(), 250);
  });

  // Capture phase, so the shell's pause and shortcuts win over a game's own keys.
  const onKey = (e: KeyboardEvent) => {
    onInput();
    const typing = !!(e.target as HTMLElement)?.closest?.("select, input, textarea");
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    const k = e.key.toLowerCase();
    if (!confirmEl.hidden && e.key === "Escape") {
      e.preventDefault();
      e.stopImmediatePropagation();
      showConfirm(false);
      return;
    }
    if (paused && !typing) {
      if (plain && (k === "p" || e.key === "Escape" || e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        setPause(false);
      }
      // Nothing else reaches a paused game, apart from app-wide shortcuts.
      if (!(e.ctrlKey && (k === "k" || k === "p")) && e.key !== "F11") e.stopImmediatePropagation();
      return;
    }
    if (typing) return;
    if ((e.ctrlKey || e.metaKey) && k === "z") {
      e.preventDefault();
      current?.undo?.();
    } else if (e.key === "F2" || ((e.ctrlKey || e.metaKey) && k === "n")) {
      e.preventDefault();
      requestNew();
    } else if (plain && k === "p" && game.group !== "words" && !ended) {
      e.preventDefault();
      e.stopImmediatePropagation();
      setPause(true);
    } else if (plain && k === "m" && game.group !== "words") {
      void setMini(!miniOn());
    } else if (plain && k === "h" && game.group === "cards") {
      if (getSettings().hints) current?.requestHint?.();
    }
  };
  window.addEventListener("keydown", onKey, true);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("blur", onBlur);

  return {
    teardown() {
      flushPlay();
      clearInterval(playTimer);
      if (paused) setGlobalPause(false);
      paused = false;
      mountSeq++;
      current?.destroy();
      current = null;
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("pointerdown", onDocDown, true);
      offMini();
    },
    requestNew,
    togglePause: () => setPause(!paused),
    instance: () => current,
  };
}
