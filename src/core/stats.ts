import { load, save } from "./storage";

export interface GameStats {
  played: number;
  won: number;
  streak: number;
  bestStreak: number;
  /** Fastest win in seconds. */
  bestTime?: number;
  /** Highest score (Snake, 2048). */
  bestScore?: number;
  lastPlayed?: number;
  /** Seconds spent in this game (counted by the shell while the game is on screen). */
  timePlayed?: number;
  /** Most recent results, newest last (capped at HISTORY). */
  history?: ResultEntry[];
}

export interface ResultEntry {
  /** When it finished (ms since epoch). */
  at: number;
  /** true won, false lost, null for score-only games. */
  won: boolean | null;
  /** Seconds taken, when the game tracks time. */
  time?: number;
  score?: number;
}

const HISTORY = 40;

type AllStats = Record<string, GameStats>;

const empty = (): GameStats => ({ played: 0, won: 0, streak: 0, bestStreak: 0 });

let all: AllStats = load<AllStats>("stats", {});
const listeners = new Set<() => void>();

/** Called after any stat changes (used to check achievements). */
export function onStatsChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function persist() {
  save("stats", all);
  listeners.forEach((fn) => fn());
}

export function getStats(key: string): GameStats {
  return all[key] ?? empty();
}

export function allStats(): AllStats {
  return all;
}

function edit(key: string, fn: (s: GameStats) => void) {
  const s = { ...getStats(key) };
  fn(s);
  s.lastPlayed = Date.now();
  all = { ...all, [key]: s };
  persist();
}

/** Call once per game, the first time the player actually does something. */
export function recordStart(key: string) {
  edit(key, (s) => {
    s.played += 1;
  });
}

function pushHistory(s: GameStats, e: ResultEntry) {
  const h = s.history ? [...s.history] : [];
  const last = h[h.length - 1];
  // A game that reports both a win and a score lands as one entry.
  if (last && e.at - last.at < 3000) {
    h[h.length - 1] = { ...last, ...e, won: e.won ?? last.won, time: e.time ?? last.time, score: e.score ?? last.score };
  } else h.push(e);
  s.history = h.slice(-HISTORY);
}

export function recordWin(key: string, seconds?: number): { newBestTime: boolean } {
  let newBestTime = false;
  edit(key, (s) => {
    pushHistory(s, { at: Date.now(), won: true, time: seconds != null ? Math.round(seconds) : undefined });
    s.won += 1;
    s.streak += 1;
    s.bestStreak = Math.max(s.bestStreak, s.streak);
    if (seconds != null && (s.bestTime == null || seconds < s.bestTime)) {
      s.bestTime = seconds;
      newBestTime = true;
    }
  });
  return { newBestTime };
}

export function recordLoss(key: string) {
  edit(key, (s) => {
    pushHistory(s, { at: Date.now(), won: false });
    s.streak = 0;
  });
}

export function recordScore(key: string, score: number): { newBest: boolean } {
  let newBest = false;
  edit(key, (s) => {
    pushHistory(s, { at: Date.now(), won: null, score });
    if (s.bestScore == null || score > s.bestScore) {
      s.bestScore = score;
      newBest = score > 0;
    }
  });
  return { newBest };
}

/** Add seconds of play time without touching lastPlayed or notifying listeners every second. */
export function addPlayTime(key: string, seconds: number) {
  if (seconds <= 0) return;
  const s = { ...getStats(key) };
  s.timePlayed = (s.timePlayed ?? 0) + seconds;
  all = { ...all, [key]: s };
  save("stats", all);
}

export function resetStats(prefix?: string) {
  if (prefix) {
    all = Object.fromEntries(Object.entries(all).filter(([k]) => k !== prefix && !k.startsWith(prefix + ":")));
  } else all = {};
  persist();
}

/** Remove exactly one stats key (one game variant). */
export function resetStatsKey(key: string) {
  const { [key]: _gone, ...rest } = all;
  void _gone;
  all = rest;
  persist();
}

/** Reload from storage (after importing a backup). */
export function reloadStats() {
  all = load<AllStats>("stats", {});
  persist();
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const ss = String(s % 60).padStart(2, "0");
  if (h > 0) return `${h}:${String(m % 60).padStart(2, "0")}:${ss}`;
  return `${m}:${ss}`;
}
