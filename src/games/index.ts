import { GameModule } from "../core/types";
import { klondike } from "./klondike";
import { spider } from "./spider";
import { freecell } from "./freecell";
import { tripeaks } from "./tripeaks";
import { pyramid } from "./pyramid";
import { minesweeper } from "./minesweeper";
import { sudoku } from "./sudoku";
import { g2048 } from "./g2048";
import { snake } from "./snake";
import { blocks } from "./blocks";
import { breakout } from "./breakout";

export const GAMES: GameModule[] = [
  klondike, spider, freecell, tripeaks, pyramid,
  minesweeper, sudoku, g2048,
  snake, blocks, breakout,
];

export const gameById = (id: string) => GAMES.find((g) => g.id === id);
