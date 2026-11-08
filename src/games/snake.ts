import { GameModule } from "../core/types";

export const snake: GameModule = {
  id: "snake",
  name: "Snake",
  group: "arcade",
  blurb: "Eat, grow, and don't run into yourself.",
  art: "snake",
  hasUndo: false,
  options: [
    {
      key: "speed",
      label: "Speed",
      default: "normal",
      choices: [
        { value: "relaxed", label: "Relaxed" },
        { value: "normal", label: "Normal" },
        { value: "fast", label: "Fast" },
      ],
    },
    {
      key: "walls",
      label: "Edges",
      default: "walls",
      choices: [
        { value: "walls", label: "Solid walls" },
        { value: "wrap", label: "Wrap around" },
      ],
    },
    {
      key: "size",
      label: "Board",
      default: "normal",
      choices: [
        { value: "small", label: "Small board" },
        { value: "normal", label: "Medium board" },
        { value: "large", label: "Large board" },
      ],
    },
  ],
  statsKey: (o) => `snake:${o("speed")}:${o("walls")}${o("size") && o("size") !== "normal" ? `:${o("size")}` : ""}`,
  keys: [
    ["Arrows or WASD", "Steer"],
    ["Space", "Pause"],
    ["Swipe", "Steer on a touch screen"],
  ],
  load: () => import("./impl/snake"),
};
