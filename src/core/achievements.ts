import { allStats, GameStats } from "./stats";
import { dailyLog, dailyStreak } from "./daily";
import { load, save } from "./storage";
import { GAMES } from "../games";

// One-off things the player did that stats don't capture (used a custom theme, made a backup).
type Flags = Record<string, number>;
let flags: Flags = load<Flags>("flags", {});
export function setFlag(id: string): void {
  if (flags[id]) return;
  flags = { ...flags, [id]: Date.now() };
  save("flags", flags);
}
const flag = (id: string) => !!flags[id];

export interface Achievement {
  id: string;
  name: string;
  desc: string;
  test: () => boolean;
}

/** Sum a stat over every key for a game (all variants), or over keys matching a prefix. */
function sum(prefix: string, field: "won" | "played"): number {
  let n = 0;
  for (const [k, s] of Object.entries(allStats())) if (k === prefix || k.startsWith(prefix + ":")) n += s[field];
  return n;
}
function stat(key: string): GameStats | undefined {
  return allStats()[key];
}
const won = (prefix: string, n = 1) => sum(prefix, "won") >= n;
const bestScore = (prefix: string) =>
  Math.max(0, ...Object.entries(allStats()).filter(([k]) => k === prefix || k.startsWith(prefix + ":")).map(([, s]) => s.bestScore ?? 0));
const fastest = (key: string, seconds: number) => {
  const t = stat(key)?.bestTime;
  return t != null && t <= seconds;
};
const distinctWins = (ids: string[]) => ids.filter((id) => won(id)).length;
const anyStreak = (n: number) => Object.values(allStats()).some((s) => s.bestStreak >= n);

const totalTime = () => Object.values(allStats()).reduce((n, s) => n + (s.timePlayed ?? 0), 0);
const idsWith = (pred: (s: GameStats) => boolean) =>
  new Set(Object.entries(allStats()).filter(([, s]) => pred(s)).map(([k]) => k.split(":")[0]));
const groupPlayed = (): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [k, s] of Object.entries(allStats())) {
    const g = GAMES.find((x) => x.id === k.split(":")[0])?.group;
    if (g) out[g] = (out[g] ?? 0) + s.played;
  }
  return out;
};
const lateWin = () =>
  Object.values(allStats()).some((s) => (s.history ?? []).some((h) => h.won === true && new Date(h.at).getHours() < 4));

const CARD_GAMES = ["spider", "freecell", "tripeaks", "pyramid", "golf", "yukon", "scorpion", "fortythieves", "canfield"];
const BOARD_GAMES = ["checkers", "reversi", "chess", "connect4"];

export const ACHIEVEMENTS: Achievement[] = [
  // Getting started
  { id: "first-win", name: "First of many", desc: "Win any game.", test: () => Object.values(allStats()).some((s) => s.won > 0) },
  { id: "explorer", name: "Explorer", desc: "Play 10 different games.", test: () => new Set(Object.keys(allStats()).filter((k) => allStats()[k].played > 0).map((k) => k.split(":")[0])).size >= 10 },
  { id: "regular", name: "Regular", desc: "Play 100 games in total.", test: () => Object.values(allStats()).reduce((n, s) => n + s.played, 0) >= 100 },
  { id: "on-a-roll", name: "On a roll", desc: "Win 5 games of one kind in a row.", test: () => anyStreak(5) },
  { id: "unstoppable", name: "Unstoppable", desc: "Win 15 games of one kind in a row.", test: () => anyStreak(15) },

  // Cards
  { id: "card-shark", name: "Card shark", desc: "Win 5 different solitaire games.", test: () => distinctWins(CARD_GAMES) >= 5 },
  { id: "full-house", name: "Full house", desc: "Win every solitaire game.", test: () => distinctWins(CARD_GAMES) === CARD_GAMES.length },
  { id: "spider-4", name: "Eight legs", desc: "Win Spider with 4 suits.", test: () => won("spider:4suit") },
  { id: "spider-2", name: "Two-tone", desc: "Win Spider with 2 suits.", test: () => won("spider:2suit") },
  { id: "freecell-10", name: "Cell block", desc: "Win 10 games of FreeCell.", test: () => won("freecell", 10) },
  { id: "freecell-fast", name: "Quick hands", desc: "Win FreeCell in under 3 minutes.", test: () => fastest("freecell", 180) },
  { id: "tripeaks-win", name: "Summit", desc: "Clear all three peaks in TriPeaks.", test: () => won("tripeaks") },
  { id: "pyramid-win", name: "Pharaoh", desc: "Clear the Pyramid.", test: () => won("pyramid") },
  { id: "golf-win", name: "Hole in one", desc: "Clear every column in Golf.", test: () => won("golf") },

  // Puzzles
  { id: "mahjong-win", name: "Tile master", desc: "Clear a Mahjong board.", test: () => won("mahjong") },
  { id: "mahjong-fast", name: "Swift hands", desc: "Clear Mahjong in under 5 minutes.", test: () => fastest("mahjong", 300) },
  { id: "mines-hard", name: "Bomb squad", desc: "Clear Minesweeper on Hard.", test: () => won("minesweeper:hard") },
  { id: "mines-fast", name: "Sweeper", desc: "Clear Minesweeper on Easy in under 30 seconds.", test: () => fastest("minesweeper:easy", 30) },
  { id: "sudoku-hard", name: "Number cruncher", desc: "Solve a Hard Sudoku.", test: () => won("sudoku:hard") },
  { id: "sudoku-10", name: "Grid habit", desc: "Solve 10 Sudoku puzzles.", test: () => won("sudoku", 10) },
  { id: "nonogram-large", name: "Pixel artist", desc: "Solve a 15×15 Nonogram.", test: () => won("nonogram:large") },
  { id: "kakuro-win", name: "Cross sums", desc: "Solve a Kakuro.", test: () => won("kakuro") },
  { id: "lights-win", name: "Lights out", desc: "Turn off every light.", test: () => won("lightsout") },
  { id: "pipes-win", name: "Plumber", desc: "Connect every pipe.", test: () => won("pipes") },
  { id: "fifteen-win", name: "In order", desc: "Solve a 4×4 Fifteen puzzle.", test: () => won("slide15:medium") || won("slide15:4") },
  { id: "2048", name: "2048", desc: "Make the 2048 tile.", test: () => won("2048") },
  { id: "memory-perfect", name: "Total recall", desc: "Finish Memory with 18 pairs.", test: () => won("memory:large") },

  // Words
  { id: "word-win", name: "Wordsmith", desc: "Guess a word in Word Guess.", test: () => won("wordguess") },
  { id: "word-10", name: "Vocabulary", desc: "Guess 10 words.", test: () => won("wordguess", 10) },
  { id: "search-win", name: "Found them all", desc: "Finish a Word Search.", test: () => won("wordsearch") },

  // Board games
  { id: "board-win", name: "Opponent down", desc: "Beat the computer at any board game.", test: () => distinctWins(BOARD_GAMES) >= 1 },
  { id: "board-all", name: "Grandmaster of everything", desc: "Beat the computer at every board game.", test: () => distinctWins(BOARD_GAMES) === BOARD_GAMES.length },
  { id: "chess-hard", name: "Checkmate", desc: "Beat the computer at Chess on Hard.", test: () => won("chess:hard") },
  { id: "checkers-hard", name: "Crowned", desc: "Beat the computer at Checkers on Hard.", test: () => won("checkers:hard") },
  { id: "reversi-hard", name: "Flipped", desc: "Beat the computer at Reversi on Hard.", test: () => won("reversi:hard") },
  { id: "c4-hard", name: "Four in a row", desc: "Beat the computer at Connect Four on Hard.", test: () => won("connect4:hard") },

  // Arcade
  { id: "snake-30", name: "Long boi", desc: "Score 30 in Snake.", test: () => bestScore("snake") >= 30 },
  { id: "blocks-10k", name: "Stacker", desc: "Score 10,000 in Blocks.", test: () => bestScore("blocks") >= 10000 },
  { id: "breakout-2k", name: "Brick by brick", desc: "Score 2,000 in Breakout.", test: () => bestScore("breakout") >= 2000 },
  { id: "pong-hard", name: "Rally", desc: "Beat the computer at Pong on Hard.", test: () => won("pong:hard") },
  { id: "rocks-5k", name: "Rock breaker", desc: "Score 5,000 in Rocks.", test: () => bestScore("asteroids") >= 5000 },
  { id: "flapper-20", name: "Frequent flyer", desc: "Score 20 in Flapper.", test: () => bestScore("flapper") >= 20 },

  // Daily
  { id: "daily-1", name: "Daily habit", desc: "Finish a daily puzzle.", test: () => Object.values(dailyLog()).some((d) => d.length > 0) },
  { id: "daily-all", name: "Clean sweep", desc: "Finish every daily puzzle on the same day.", test: () => Object.values(dailyLog()).some((d) => d.length >= 4) },
  { id: "daily-7", name: "A week straight", desc: "Finish a daily puzzle 7 days in a row.", test: () => dailyStreak() >= 7 },
  { id: "daily-30", name: "A month straight", desc: "Finish a daily puzzle 30 days in a row.", test: () => dailyStreak() >= 30 },
  { id: "daily-50", name: "Fifty days", desc: "Finish daily puzzles on 50 different days.", test: () => Object.values(dailyLog()).filter((d) => d.length > 0).length >= 50 },

  // Time and habits
  { id: "time-1h", name: "An hour well spent", desc: "Play for an hour in total.", test: () => totalTime() >= 3600 },
  { id: "time-10h", name: "Ten hours in", desc: "Play for 10 hours in total.", test: () => totalTime() >= 36000 },
  { id: "time-50h", name: "Part of the furniture", desc: "Play for 50 hours in total.", test: () => totalTime() >= 180000 },
  { id: "tourist", name: "Tourist", desc: "Play every game at least once.", test: () => GAMES.every((g) => idsWith((s) => s.played > 0).has(g.id)) },
  { id: "all-rounder", name: "All-rounder", desc: "Win 20 different games.", test: () => idsWith((s) => s.won > 0).size >= 20 },
  { id: "specialist", name: "Specialist", desc: "Play 50 games from one group.", test: () => Object.values(groupPlayed()).some((n) => n >= 50) },
  { id: "fixture", name: "Fixture", desc: "Play 500 games in total.", test: () => Object.values(allStats()).reduce((n, s) => n + s.played, 0) >= 500 },
  { id: "night-owl", name: "Night owl", desc: "Win a game between midnight and 4 a.m.", test: lateWin },

  // Making it yours
  { id: "decorator", name: "Interior design", desc: "Make your own theme.", test: () => flag("custom-theme") },
  { id: "backup", name: "Belt and braces", desc: "Save a backup of your data.", test: () => flag("backup") },
];

type Unlocked = Record<string, number>; // id -> timestamp
let unlocked: Unlocked = load<Unlocked>("achievements", {});

export function unlockedAt(id: string): number | undefined {
  return unlocked[id];
}

export function unlockedCount(): number {
  return ACHIEVEMENTS.filter((a) => unlocked[a.id]).length;
}

/** Check every achievement; returns the ones that just unlocked. */
export function evaluateAchievements(): Achievement[] {
  const fresh: Achievement[] = [];
  for (const a of ACHIEVEMENTS) {
    if (unlocked[a.id]) continue;
    let ok = false;
    try {
      ok = a.test();
    } catch {
      ok = false;
    }
    if (ok) {
      unlocked = { ...unlocked, [a.id]: Date.now() };
      fresh.push(a);
    }
  }
  if (fresh.length) save("achievements", unlocked);
  return fresh;
}

export function resetAchievements() {
  unlocked = {};
  save("achievements", unlocked);
}
