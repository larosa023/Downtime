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
}

type AllStats = Record<string, GameStats>;

const empty = (): GameStats => ({ played: 0, won: 0, streak: 0, bestStreak: 0 });

let all: AllStats = load<AllStats>("stats", {});

function persist() {
  save("stats", all);
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

export function recordWin(key: string, seconds?: number): { newBestTime: boolean } {
  let newBestTime = false;
  edit(key, (s) => {
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
    s.streak = 0;
  });
}

export function recordScore(key: string, score: number): { newBest: boolean } {
  let newBest = false;
  edit(key, (s) => {
    if (s.bestScore == null || score > s.bestScore) {
      s.bestScore = score;
      newBest = score > 0;
    }
  });
  return { newBest };
}

export function resetStats() {
  all = {};
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
