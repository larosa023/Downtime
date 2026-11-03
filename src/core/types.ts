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
}

export interface GameInstance {
  newGame(): void;
  undo?(): void;
  /** Called when the window or board is resized. */
  resize?(): void;
  /** Persist anything worth resuming before the game is torn down. */
  destroy(): void;
}

export interface GameModule {
  id: string;
  name: string;
  group: "cards" | "puzzles" | "arcade";
  blurb: string;
  /** Small SVG illustration for the home screen. */
  art: string;
  options?: GameOption[];
  /** Key under which stats are kept, given current options. */
  statsKey(option: (key: string) => string): string;
  /** Whether the game supports Undo. */
  hasUndo: boolean;
  create(root: HTMLElement, ctx: GameContext): GameInstance;
}
