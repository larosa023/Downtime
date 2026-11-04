// Seeded randomness, so a "daily" puzzle is the same for everyone on a given day.

/** Small fast PRNG. Returns a function giving floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Local date as YYYY-MM-DD. */
export function todayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Days since 2026-01-01, for numbering daily puzzles. */
export function dayNumber(d = new Date()): number {
  const start = new Date(2026, 0, 1);
  return Math.floor((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - start.getTime()) / 86400000) + 1;
}

/** A seeded RNG for today's puzzle of a given game (and variant). */
export function dailyRng(gameId: string, d = new Date()): () => number {
  return mulberry32(hash(`${gameId}:${todayKey(d)}`));
}

/** Plain Math.random, wrapped so callers can take an rng parameter. */
export const random: () => number = () => Math.random();

/** Fisher–Yates with a given rng. */
export function shuffleWith<T>(arr: T[], rng: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
