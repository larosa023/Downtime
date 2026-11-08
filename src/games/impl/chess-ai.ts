// Asks the engine for a move in a Web Worker, falling back to the main thread if workers aren't available.
import { engineMove, hintMove, Move, Pos } from "./chess-engine";

let worker: Worker | null = null;
let failed = false;
let seq = 0;
const waiting = new Map<number, (m: Move | null) => void>();

function getWorker(): Worker | null {
  if (worker || failed) return worker;
  try {
    worker = new Worker(new URL("./chess-worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ id: number; move: Move | null }>) => {
      waiting.get(e.data.id)?.(e.data.move);
      waiting.delete(e.data.id);
    };
    worker.onerror = () => {
      failed = true;
      worker?.terminate();
      worker = null;
      // Anything still waiting gets answered on the main thread by the caller's fallback.
      for (const fn of waiting.values()) fn(undefined as unknown as null);
      waiting.clear();
    };
  } catch {
    failed = true;
    worker = null;
  }
  return worker;
}

export function askEngine(pos: Pos, level: string, hint = false): Promise<Move | null> {
  const w = getWorker();
  const local = () => (hint ? hintMove(pos) : engineMove(pos, level));
  if (!w) return new Promise((res) => setTimeout(() => res(local()), 0));
  const id = ++seq;
  return new Promise((res) => {
    waiting.set(id, (m) => res(m === undefined ? local() : m));
    w.postMessage({ id, pos, level, hint });
  });
}
