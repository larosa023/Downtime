// Runs the chess search off the main thread so the board stays responsive while the computer thinks.
import { engineMove, hintMove, Pos } from "./chess-engine";

self.onmessage = (e: MessageEvent<{ id: number; pos: Pos; level: string; hint: boolean }>) => {
  const { id, pos, level, hint } = e.data;
  const m = hint ? hintMove(pos) : engineMove(pos, level);
  (self as unknown as Worker).postMessage({ id, move: m });
};
