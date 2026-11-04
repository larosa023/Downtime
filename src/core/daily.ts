import { load, save } from "./storage";
import { todayKey } from "./rng";

// Record of which daily puzzles were completed on which days.
type DailyLog = Record<string, string[]>; // date -> game ids

let log: DailyLog = load<DailyLog>("daily", {});

/** Call when a daily puzzle is solved. */
export function markDailyDone(gameId: string, d = new Date()) {
  const k = todayKey(d);
  const done = new Set(log[k] ?? []);
  done.add(gameId);
  log = { ...log, [k]: [...done] };
  save("daily", log);
}

export function dailyDone(gameId: string, d = new Date()): boolean {
  return (log[todayKey(d)] ?? []).includes(gameId);
}

export function dailyLog(): DailyLog {
  return log;
}

/** Consecutive days (ending today or yesterday) with at least one daily solved. */
export function dailyStreak(): number {
  let n = 0;
  const d = new Date();
  if (!log[todayKey(d)]?.length) d.setDate(d.getDate() - 1);
  while (log[todayKey(d)]?.length) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}
