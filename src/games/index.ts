import { GameModule } from "../core/types";
import { spider } from "./spider";
import { freecell } from "./freecell";
import { tripeaks } from "./tripeaks";
import { pyramid } from "./pyramid";
import { golf } from "./golf";
import { mahjong } from "./mahjong";
import { minesweeper } from "./minesweeper";
import { sudoku } from "./sudoku";
import { nonogram } from "./nonogram";
import { g2048 } from "./g2048";
import { memory } from "./memory";
import { snake } from "./snake";
import { blocks } from "./blocks";
import { breakout } from "./breakout";
import { connect4 } from "./connect4";

export const GAMES: GameModule[] = [
  spider, freecell, tripeaks, pyramid, golf,
  mahjong, minesweeper, sudoku, nonogram, g2048, memory,
  snake, blocks, breakout, connect4,
];

export const gameById = (id: string) => GAMES.find((g) => g.id === id);
