import { GameModule } from "../core/types";

export const blocks: GameModule = {
  id: "blocks",
  name: "Blocks",
  group: "arcade",
  blurb: "Stack falling pieces and clear full lines before the well fills up.",
  art: "blocks",
  hasUndo: false,
  options: [
    {
      key: "mode",
      label: "Mode",
      default: "marathon",
      choices: [
        { value: "marathon", label: "Marathon" },
        { value: "sprint", label: "Sprint 40 lines" },
        { value: "ultra", label: "Ultra 2 minutes" },
      ],
    },
    {
      key: "preview",
      label: "Next pieces",
      default: "3",
      choices: [
        { value: "1", label: "Show 1 next" },
        { value: "3", label: "Show 3 next" },
        { value: "5", label: "Show 5 next" },
      ],
    },
    {
      key: "ghost",
      label: "Ghost piece",
      default: "on",
      choices: [
        { value: "on", label: "Ghost on" },
        { value: "off", label: "Ghost off" },
      ],
    },
  ],
  statsKey: (o) => (o("mode") === "sprint" || o("mode") === "ultra" ? `blocks:${o("mode")}` : "blocks"),
  keys: [
    ["← → or A D", "Move (hold to slide)"],
    ["↑, W or X", "Rotate clockwise"],
    ["Z", "Rotate counterclockwise"],
    ["↓ or S", "Soft drop"],
    ["Space", "Hard drop"],
    ["C or Shift", "Hold"],
    ["Esc", "Pause"],
  ],
  load: () => import("./impl/blocks"),
};
