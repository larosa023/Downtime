import "./wordguess.css";
import { GameContext, GameInstance, GameModule } from "../core/types";
import { recordLoss, recordStart, recordWin } from "../core/stats";
import { load, save } from "../core/storage";
import { sfx } from "../core/sound";
import { motionEnabled } from "../core/settings";
import { dailyRng, dayNumber, todayKey } from "../core/rng";
import { markDailyDone } from "../core/daily";
import words from "./words.json";

const LEN = 5;
const TRIES = 6;
const ANSWERS: string[] = words.answers;
const VALID = new Set<string>([...words.guesses, ...words.answers]);
const ROWS = ["qwertyuiop", "asdfghjkl", "+zxcvbnm-"]; // + Enter, - Backspace

type Mark = "hit" | "near" | "miss";

interface Saved {
  answer: string;
  guesses: string[];
  over: boolean;
  won: boolean;
  counted: boolean;
  date?: string;
}

/** Score a guess, handling repeated letters the usual way. */
function score(guess: string, answer: string): Mark[] {
  const marks: Mark[] = Array(LEN).fill("miss");
  const left: Record<string, number> = {};
  for (let i = 0; i < LEN; i++) {
    if (guess[i] === answer[i]) marks[i] = "hit";
    else left[answer[i]] = (left[answer[i]] ?? 0) + 1;
  }
  for (let i = 0; i < LEN; i++) {
    if (marks[i] === "hit") continue;
    if (left[guess[i]]) {
      marks[i] = "near";
      left[guess[i]]--;
    }
  }
  return marks;
}

const RANK: Record<Mark, number> = { miss: 1, near: 2, hit: 3 };

class WordGuess implements GameInstance {
  private el: HTMLDivElement;
  private board: HTMLDivElement;
  private keys: HTMLDivElement;
  private mode: "daily" | "practice";
  private s!: Saved;
  private current = "";
  private busy = false;
  private pendingEnter = false;
  private resizeObs: ResizeObserver;

  constructor(root: HTMLElement, private ctx: GameContext) {
    this.mode = ctx.option("mode") === "practice" ? "practice" : "daily";
    this.el = document.createElement("div");
    this.el.className = "wordguess";
    this.el.innerHTML = `<div class="wg-board" role="grid" aria-label="Guesses"></div><div class="wg-keys"></div>`;
    root.appendChild(this.el);
    this.board = this.el.querySelector(".wg-board")!;
    this.keys = this.el.querySelector(".wg-keys")!;
    for (let r = 0; r < TRIES; r++) {
      const row = document.createElement("div");
      row.className = "wg-row";
      row.setAttribute("role", "row");
      for (let c = 0; c < LEN; c++) {
        const t = document.createElement("div");
        t.className = "wg-tile";
        t.setAttribute("role", "gridcell");
        row.appendChild(t);
      }
      this.board.appendChild(row);
    }
    this.keys.innerHTML = ROWS.map(
      (row) =>
        `<div class="wg-krow">${[...row]
          .map((k) =>
            k === "+"
              ? `<button class="wg-key wide" data-k="Enter">Enter</button>`
              : k === "-"
                ? `<button class="wg-key wide" data-k="Backspace" aria-label="Delete letter"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5h11v14H9l-6-7z"/><path d="m12 9 5 6M17 9l-5 6"/></svg></button>`
                : `<button class="wg-key" data-k="${k}">${k}</button>`,
          )
          .join("")}</div>`,
    ).join("");
    this.keys.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-k]");
      if (b) this.press(b.dataset.k!);
      (e.target as HTMLElement).closest("button")?.blur();
    });
    window.addEventListener("keydown", this.onKey);
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(this.el);
    this.start(false);
  }

  private get key() {
    return `wordguess:${this.mode}`;
  }
  private get saveKey() {
    return `save:wordguess:${this.mode}`;
  }

  private dailyAnswer() {
    const rng = dailyRng("wordguess");
    return ANSWERS[Math.floor(rng() * ANSWERS.length)];
  }

  /** Load today's daily / the practice game in progress, or start fresh. */
  private start(fresh: boolean) {
    this.ctx.clearEnd();
    const saved = load<Saved | null>(this.saveKey, null);
    if (this.mode === "daily") {
      const today = todayKey();
      if (saved && saved.date === today) this.s = saved;
      else this.s = { answer: this.dailyAnswer(), guesses: [], over: false, won: false, counted: false, date: today };
    } else if (!fresh && saved && !saved.over) {
      this.s = saved;
    } else {
      this.s = { answer: ANSWERS[Math.floor(Math.random() * ANSWERS.length)], guesses: [], over: false, won: false, counted: false };
    }
    this.current = "";
    this.busy = false;
    this.pendingEnter = false;
    this.paintAll();
    this.persist();
    this.status();
    this.ctx.setUndo(false);
    if (this.s.over) setTimeout(() => this.showEnd(), 200);
  }

  newGame() {
    if (this.mode === "daily") {
      if (this.s.over) {
        this.ctx.toast("Today's word is done. Switch to Practice for more, or come back tomorrow.");
        this.showEnd();
      }
      return;
    }
    if (this.s.counted && !this.s.over) recordLoss(this.key);
    this.start(true);
  }

  destroy() {
    window.removeEventListener("keydown", this.onKey);
    this.resizeObs.disconnect();
    this.persist();
    this.el.remove();
  }

  resize() {
    const r = this.el.getBoundingClientRect();
    // Board is 5 wide, 6 tall; keyboard needs roughly 3.6 tile-heights below it.
    const tile = Math.floor(Math.min((r.width - 40) / 5.6, (r.height - 40) / (TRIES + 0.8 + 3.4), 72));
    this.el.style.setProperty("--wt", `${Math.max(tile, 34)}px`);
  }

  private persist() {
    save(this.saveKey, this.s);
  }

  private onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.closest?.("select, input") || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Enter" || e.key === "Backspace" || /^[a-zA-Z]$/.test(e.key)) {
      e.preventDefault();
      this.press(e.key.length === 1 ? e.key.toLowerCase() : e.key);
    }
  };

  private press(k: string) {
    if (this.s.over) return;
    // Typing ahead is fine while a row is flipping; Enter waits until it's done.
    if (k === "Enter") {
      if (this.busy) this.pendingEnter = true;
      else this.submit();
      return;
    }
    if (k === "Backspace") {
      if (!this.current) return;
      this.current = this.current.slice(0, -1);
      this.paintRow(this.s.guesses.length);
      return;
    }
    if (this.current.length >= LEN || !/^[a-z]$/.test(k)) return;
    this.current += k;
    sfx.tick();
    this.paintRow(this.s.guesses.length);
    const t = this.tileAt(this.s.guesses.length, this.current.length - 1);
    t.classList.remove("pop");
    void t.offsetWidth;
    t.classList.add("pop");
  }

  private submit() {
    const row = this.s.guesses.length;
    if (this.current.length < LEN) return this.reject(row, "Not enough letters.");
    if (!VALID.has(this.current)) return this.reject(row, "That's not in the word list.");
    if (!this.s.counted) {
      this.s.counted = true;
      recordStart(this.key);
    }
    const guess = this.current;
    this.s.guesses.push(guess);
    this.current = "";
    const won = guess === this.s.answer;
    const lost = !won && this.s.guesses.length >= TRIES;
    if (won || lost) {
      this.s.over = true;
      this.s.won = won;
    }
    this.persist();
    this.reveal(row, () => {
      if (won) this.finish(true);
      else if (lost) this.finish(false);
      this.status();
    });
  }

  private reject(row: number, message: string) {
    this.ctx.toast(message);
    sfx.error();
    const r = this.board.children[row] as HTMLElement;
    r.classList.remove("shake");
    void r.offsetWidth;
    r.classList.add("shake");
  }

  private tileAt(r: number, c: number) {
    return this.board.children[r].children[c] as HTMLElement;
  }

  /** Flip each tile in turn, showing its mark halfway through the flip. */
  private reveal(row: number, done: () => void) {
    const guess = this.s.guesses[row];
    const marks = score(guess, this.s.answer);
    const animate = motionEnabled();
    const step = animate ? 260 : 0;
    this.busy = true;
    marks.forEach((m, c) => {
      const t = this.tileAt(row, c);
      t.textContent = guess[c];
      if (animate) {
        setTimeout(() => t.classList.add("flip"), c * step);
        setTimeout(() => {
          t.dataset.mark = m;
          sfx.flip();
        }, c * step + 170);
      } else t.dataset.mark = m;
    });
    setTimeout(
      () => {
        this.busy = false;
        this.paintKeys();
        done();
        if (this.pendingEnter) {
          this.pendingEnter = false;
          if (!this.s.over) this.submit();
        }
      },
      animate ? (LEN - 1) * step + 420 : 0,
    );
  }

  private finish(won: boolean) {
    const n = this.s.guesses.length;
    if (won) {
      recordWin(this.key);
      sfx.win();
      // A little hop across the winning row.
      if (motionEnabled())
        for (let c = 0; c < LEN; c++) {
          const t = this.tileAt(n - 1, c);
          setTimeout(() => t.classList.add("hop"), c * 90);
        }
    } else {
      recordLoss(this.key);
      sfx.lose();
    }
    const dist = load<number[]>(`dist:${this.key}`, Array(TRIES + 1).fill(0));
    dist[won ? n - 1 : TRIES] += 1;
    save(`dist:${this.key}`, dist);
    if (this.mode === "daily") markDailyDone("wordguess");
    setTimeout(() => this.showEnd(), won ? 900 : 500);
  }

  private showEnd() {
    const dist = load<number[]>(`dist:${this.key}`, Array(TRIES + 1).fill(0));
    const n = this.s.guesses.length;
    const lines: string[] = [];
    lines.push(this.s.won ? `Got it in ${n} of ${TRIES}` : `The word was ${this.s.answer.toUpperCase()}`);
    lines.push(`Wins by guess count: ${dist.slice(0, TRIES).map((v, i) => `${i + 1}→${v}`).join("  ")}${dist[TRIES] ? `  missed→${dist[TRIES]}` : ""}`);
    if (this.mode === "daily") lines.push("A new word comes tomorrow. Practice mode has unlimited words.");
    this.ctx.end({
      won: this.s.won,
      title: this.s.won ? (n <= 2 ? "Brilliant" : n <= 4 ? "Nicely done" : "Phew") : "Out of guesses",
      lines,
    });
  }

  private paintRow(r: number) {
    const text = r < this.s.guesses.length ? this.s.guesses[r] : r === this.s.guesses.length ? this.current : "";
    for (let c = 0; c < LEN; c++) {
      const t = this.tileAt(r, c);
      t.textContent = text[c] ?? "";
      t.classList.toggle("filled", !!text[c]);
    }
  }

  private paintAll() {
    for (let r = 0; r < TRIES; r++) {
      const row = this.board.children[r] as HTMLElement;
      row.classList.remove("shake");
      for (let c = 0; c < LEN; c++) {
        const t = this.tileAt(r, c);
        t.className = "wg-tile";
        delete t.dataset.mark;
      }
      this.paintRow(r);
      if (r < this.s.guesses.length) {
        const marks = score(this.s.guesses[r], this.s.answer);
        marks.forEach((m, c) => (this.tileAt(r, c).dataset.mark = m));
      }
    }
    this.paintKeys();
  }

  private paintKeys() {
    const best: Record<string, Mark> = {};
    for (const g of this.s.guesses) {
      score(g, this.s.answer).forEach((m, i) => {
        const ch = g[i];
        if (!best[ch] || RANK[m] > RANK[best[ch]]) best[ch] = m;
      });
    }
    this.keys.querySelectorAll<HTMLElement>("[data-k]").forEach((k) => {
      const m = best[k.dataset.k!];
      if (m) k.dataset.mark = m;
      else delete k.dataset.mark;
    });
  }

  private status() {
    const items = [{ label: "Guess", value: `${Math.min(this.s.guesses.length + (this.s.over ? 0 : 1), TRIES)}/${TRIES}` }];
    if (this.mode === "daily") items.unshift({ label: "Puzzle", value: `#${dayNumber()}` });
    this.ctx.setStatus(items);
  }
}

export const wordguess: GameModule = {
  id: "wordguess",
  name: "Word Guess",
  group: "words",
  blurb: "Find the hidden five-letter word in six tries. A new daily word every day.",
  art: "wordguess",
  hasUndo: false,
  daily: true,
  options: [
    {
      key: "mode",
      label: "Mode",
      default: "daily",
      choices: [
        { value: "daily", label: "Daily word" },
        { value: "practice", label: "Practice" },
      ],
    },
  ],
  statsKey: (o) => `wordguess:${o("mode")}`,
  iconSvg: `<rect x="3" y="8" width="5" height="8" rx="1.2"/><rect x="9.5" y="8" width="5" height="8" rx="1.2" fill="currentColor"/><rect x="16" y="8" width="5" height="8" rx="1.2"/>`,
  artSvg: (() => {
    const rows = [
      ["s", "t", "o", "n", "e"],
      ["p", "l", "a", "n", "t"],
      ["b", "r", "a", "v", "e"],
    ];
    const marks = [
      ["miss", "near", "miss", "miss", "hit"],
      ["miss", "miss", "hit", "miss", "near"],
      ["hit", "hit", "hit", "hit", "hit"],
    ];
    let out = "";
    rows.forEach((row, r) =>
      row.forEach((ch, c) => {
        const x = 51 + c * 31;
        const y = 18 + r * 36;
        const m = marks[r][c];
        out += `<rect class="wg-a-${m}" x="${x}" y="${y}" width="28" height="31" rx="5"/>`;
        if (m === "near") out += `<circle class="wg-a-dot" cx="${x + 22}" cy="${y + 6}" r="2.2"/>`;
        out += `<text class="wg-a-t wg-a-t-${m}" x="${x + 14}" y="${y + 21.5}">${ch.toUpperCase()}</text>`;
      }),
    );
    return out;
  })(),
  create: (root, ctx) => new WordGuess(root, ctx),
};

