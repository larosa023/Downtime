import { ACHIEVEMENTS, unlockedAt, unlockedCount } from "../../core/achievements";
import { ICONS } from "../icons";

export function showTrophies(stage: HTMLElement) {
  document.title = "Trophies — Downtime";
  const n = unlockedCount();
  const sorted = [...ACHIEVEMENTS].sort((a, b) => (unlockedAt(b.id) ? 1 : 0) - (unlockedAt(a.id) ? 1 : 0));
  stage.innerHTML = `
    <div class="page wide">
      <header class="page-head"><h1>Trophies</h1><p>${n} of ${ACHIEVEMENTS.length} unlocked.</p>
        <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${ACHIEVEMENTS.length}" aria-valuenow="${n}"><i style="width:${(n / ACHIEVEMENTS.length) * 100}%"></i></div>
      </header>
      <div class="seg trophy-filter" role="tablist" aria-label="Show">
        <button role="tab" aria-selected="true" data-tf="all">All</button>
        <button role="tab" aria-selected="false" data-tf="got">Unlocked</button>
        <button role="tab" aria-selected="false" data-tf="locked">Locked</button>
      </div>
      <div class="trophies">
        ${sorted
          .map((a) => {
            const at = unlockedAt(a.id);
            return `<div class="trophy${at ? " got" : ""}">
            <span class="trophy-icon">${at ? ICONS.trophy : ICONS.lock}</span>
            <span class="trophy-text"><strong>${a.name}</strong><small>${a.desc}</small>${at ? `<em>${new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</em>` : ""}</span>
          </div>`;
          })
          .join("")}
      </div>
    </div>`;
  stage.querySelectorAll<HTMLButtonElement>("[data-tf]").forEach((b) =>
    b.addEventListener("click", () => {
      stage.querySelectorAll("[data-tf]").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
      const f = b.dataset.tf;
      stage.querySelectorAll<HTMLElement>(".trophy").forEach((t) => {
        const got = t.classList.contains("got");
        t.hidden = (f === "got" && !got) || (f === "locked" && got);
      });
    }),
  );
}
