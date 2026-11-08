export interface StatusItem {
  label: string;
  value: string;
}

export interface GameOption {
  key: string;
  label: string;
  choices: { value: string; label: string }[];
  default: string;
}

export interface EndSummary {
  won: boolean;
  title: string;
  lines: string[];
}

/** What the shell hands a running game. */
export interface GameContext {
  /** Values shown in the top bar, e.g. time and moves. */
  setStatus(items: StatusItem[]): void;
  /** Enable or disable the Undo button. */
  setUndo(enabled: boolean): void;
  /** Show the end-of-game panel. */
  end(summary: EndSummary): void;
  /** Hide the end-of-game panel (e.g. after undoing out of a loss). */
  clearEnd(): void;
  /** Brief message at the bottom of the board. */
  toast(message: string): void;
  /** Current values of this game's options. */
  option(key: string): string;
  /** Show or hide the Finish button (auto-complete). Optional for games to call. */
  setFinish(visible: boolean): void;
}

export interface GameInstance {
  newGame(): void;
  undo?(): void;
  /** Called when the window or board is resized. */
  resize?(): void;
  /** Point out a possible move. Shows a Hint button when present. */
  requestHint?(): void;
  /** Play out the rest of the game automatically (see GameContext.setFinish). */
  autoFinish?(): void;
  /** Freeze or resume the game: clocks, animation loops and input. The shell draws its own pause overlay
   *  and calls this when the player pauses, or when the window loses focus (Settings → Auto-pause). */
  setPaused?(paused: boolean): void;
  /** True while a game is under way (moves made, not finished). Used to ask before starting a new one. */
  inProgress?(): boolean;
  /** Persist anything worth resuming before the game is torn down. */
  destroy(): void;
}

export type GameGroup = "cards" | "puzzles" | "words" | "board" | "arcade";

export const GROUPS: { id: GameGroup; name: string }[] = [
  { id: "cards", name: "Cards" },
  { id: "puzzles", name: "Puzzles" },
  { id: "words", name: "Words" },
  { id: "board", name: "Board games" },
  { id: "arcade", name: "Arcade" },
];

export interface GameModule {
  id: string;
  name: string;
  group: GameGroup;
  blurb: string;
  /** Key of a built-in illustration in ui/art.ts (older games). */
  art: string;
  /** Inner SVG markup for the home tile, drawn in a 252×144 viewBox. Used instead of `art` when set. */
  artSvg?: string;
  /** Inner SVG markup for the sidebar icon, drawn in a 24×24 viewBox with stroke="currentColor". */
  iconSvg?: string;
  /** True if the game offers a daily puzzle (the option key "mode" with value "daily"). */
  daily?: boolean;
  options?: GameOption[];
  /** Key under which stats are kept, given current options. */
  statsKey(option: (key: string) => string): string;
  /** Whether the game supports Undo. */
  hasUndo: boolean;
  /** Builds the game. Use either create (code ships with the app shell) or load (code in its own chunk,
   *  fetched the first time the game opens — keeps startup fast). */
  create?(root: HTMLElement, ctx: GameContext): GameInstance;
  load?: () => Promise<{ create(root: HTMLElement, ctx: GameContext): GameInstance }>;
  /** Extra keyboard shortcuts shown in the shortcuts sheet, e.g. [["Space", "Hard drop"]]. */
  keys?: [string, string][];
}
