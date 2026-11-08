import { GameModule } from "../core/types";

export const breakout: GameModule = {
  id: "breakout",
  name: "Breakout",
  group: "arcade",
  blurb: "Bounce the ball off your paddle and knock out every brick.",
  art: "breakout",
  hasUndo: false,
  options: [
    {
      key: "powerups",
      label: "Power-ups",
      default: "on",
      choices: [
        { value: "on", label: "Power-ups on" },
        { value: "off", label: "Power-ups off" },
      ],
    },
  ],
  statsKey: () => "breakout",
  keys: [
    ["Mouse or ← →", "Move the paddle"],
    ["Click or Space", "Launch the ball"],
    ["Space or Esc", "Pause"],
  ],
  load: () => import("./impl/breakout"),
};
