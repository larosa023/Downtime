import { GameModule } from "../core/types";

// Every file in this folder that exports a GameModule is picked up automatically.
const modules = import.meta.glob<Record<string, unknown>>("./*.ts", { eager: true });

/** Display order. Games not listed here go at the end of their group. */
const ORDER = [
  // cards
  "spider", "freecell", "tripeaks", "pyramid", "golf", "yukon", "scorpion", "fortythieves", "canfield",
  // puzzles
  "mahjong", "minesweeper", "sudoku", "kakuro", "nonogram", "2048", "slide15", "lightsout", "pipes", "memory",
  // words
  "wordguess", "wordsearch",
  // board
  "checkers", "reversi", "chess", "connect4",
  // arcade
  "snake", "blocks", "breakout", "pong", "asteroids", "flapper",
];

const isGame = (v: unknown): v is GameModule =>
  !!v && typeof v === "object" && "id" in v && "create" in v && "statsKey" in v;

export const GAMES: GameModule[] = Object.values(modules)
  .flatMap((m) => Object.values(m).filter(isGame))
  .sort((a, b) => {
    const ia = ORDER.indexOf(a.id);
    const ib = ORDER.indexOf(b.id);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.name.localeCompare(b.name);
  });

export const gameById = (id: string) => GAMES.find((g) => g.id === id);
