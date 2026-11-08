import { GameModule } from "../core/types";

export const breakout: GameModule = {
  id: "breakout",
  name: "Breakout",
  group: "arcade",
  blurb: "Bounce the ball off your paddle and knock out every brick.",
  art: "breakout",
  hasUndo: false,
  statsKey: () => "breakout",
  load: () => import("./impl/breakout"),
};
