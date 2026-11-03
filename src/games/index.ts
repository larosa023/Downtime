import { GameModule } from "../core/types";
import { klondike } from "./klondike";
import { spider } from "./spider";
import { freecell } from "./freecell";
import { minesweeper } from "./minesweeper";
import { snake } from "./snake";
import { g2048 } from "./g2048";

export const GAMES: GameModule[] = [klondike, spider, freecell, minesweeper, snake, g2048];

export const gameById = (id: string) => GAMES.find((g) => g.id === id);
