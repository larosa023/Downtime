import { allStats, formatTime, GameStats, resetStatsKey } from "../../core/stats";
import { GROUPS } from "../../core/types";
import { dailyStreak } from "../../core/daily";
import { ACHIEVEMENTS, unlockedCount } from "../../core/achievements";
import { GAMES, gameById } from "../../games";
import { formatDuration, relativeDay } from "../shared";

export function variantLabel(key: string): { game: string; variant: string } {
  const [id, ...rest] = key.split(":");
  const g = gameById(id);
  const name = g?.name ?? id;
  const labels: Record<string, string> = {
    "1suit": "1 suit", "2suit": "2 suits", "4suit": "4 suits",
    easy: "Easy", medium: "Medium", hard: "Hard", relaxed: "Relaxed", normal: "Normal", fast: "Fast",
    small: "Small", large: "Large", daily: "Daily", practice: "Practice",
    walls: "walls", wrap: "wrap", std: "",
  };
  return { game: name, variant: rest.map((r) => labels[r] ?? r).filter(Boolean).join(", ") };
}

let groupFilter = "all";
let openKey = "";

/** Small hand-drawn chart of recent results. */
function historyChart(s: GameStats): string {
  const h = (s.history ?? []).slice(-30);
  if (!h.length) return `<p class="dim">Results from now on will show up here as a chart.</p>`;
  const W = 520;
  const H = 120;
  const gap = 3;
  const bw = Math.min(26, (W - gap * (h.length - 1)) / h.length);
  const timed = h.some((e) => e.time != null);
  const scored = !timed && h.some((e) => e.score != null);
  const val = (e: (typeof h)[number]) => (timed ? e.time : scored ? e.score : null) ?? null;
  const max = Math.max(1, ...h.map((e) => val(e) ?? 0));
  const bars = h
    .map((e, i) => {
      const x = i * (bw + gap);
      const v = val(e);
      const date = new Date(e.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      const label = `${date}: ${e.won === true ? "won" : e.won === false ? "lost" : ""}${v != null ? `${e.won != null ? ", " : ""}${timed ? formatTime(v) : `score ${v}`}` : ""}`;
      if (v == null) {
        // Win/loss only: full-height marks.
        const hh = e.won ? H * 0.75 : H * 0.3;
        return `<rect x="${x}" y="${H - hh}" width="${bw}" height="${hh}" rx="2" class="${e.won ? "bar-won" : "bar-lost"}"><title>${label}</title></rect>`;
      }
      const hh = Math.max(3, (v / max) * (H - 6));
      return `<rect x="${x}" y="${H - hh}" width="${bw}" height="${hh}" rx="2" class="${e.won === false ? "bar-lost" : "bar-won"}"><title>${label}</title></rect>`;
    })
    .join("");
  const what = timed ? "Time per game (shorter is faster)" : scored ? "Score per game" : "Wins and losses";
  return `<figure class="chart">
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${what}, last ${h.length} games">${bars}</svg>
    <figcaption><span>${what}</span><span class="legend"><i class="bar-won"></i>won${h.some((e) => e.won === false) ? `<i class="bar-lost"></i>lost` : ""}</span></figcaption>
  </figure>`;
}

function detail(key: string, s: GameStats): string {
  const h = s.history ?? [];
  const times = h.filter((e) => e.won && e.time != null).map((e) => e.time!);
  const scores = h.filter((e) => e.score != null).map((e) => e.score!);
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const facts: [string, string][] = [
    ["Played", String(s.played)],
    ["Won", s.played ? `${s.won} (${Math.round((s.won / s.played) * 100)}%)` : "0"],
    ["Current streak", String(s.streak)],
    ["Time played", formatDuration(s.timePlayed ?? 0)],
  ];
  if (times.length) facts.push(["Average win", formatTime(avg(times))]);
  if (s.bestTime != null) facts.push(["Fastest", formatTime(s.bestTime)]);
  if (scores.length) facts.push(["Average score", String(Math.round(avg(scores)))]);
  if (s.bestScore != null) facts.push(["Best score", String(s.bestScore)]);
  if (s.lastPlayed) facts.push(["Last played", relativeDay(s.lastPlayed)]);
  return `<div class="detail">
    <dl class="facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>
    ${historyChart(s)}
    <div class="detail-actions">
      <a class="btn ghost" href="#/play/${key.split(":")[0]}">Play</a>
      <button class="btn danger" data-reset-key="${key}">Reset these stats</button>
    </div>
  </div>`;
}

export function showStats(stage: HTMLElement) {
  document.title = "Stats — Downtime";
  const all = allStats();
  const known = Object.entries(all).filter(([key]) => gameById(key.split(":")[0]));
  const totals = known.reduce(
    (t, [, s]) => ({ played: t.played + s.played, won: t.won + s.won, time: t.time + (s.timePlayed ?? 0) }),
    { played: 0, won: 0, time: 0 },
  );
  const entries = known
    .filter(([key, s]) => (s.played > 0 || (s.timePlayed ?? 0) > 0) && (groupFilter === "all" || gameById(key.split(":")[0])?.group === groupFilter))
    .sort(([a], [b]) => GAMES.findIndex((g) => a.split(":")[0] === g.id) - GAMES.findIndex((g) => b.split(":")[0] === g.id) || a.localeCompare(b));

  const rows = entries
    .map(([key, s]) => {
      const { game, variant } = variantLabel(key);
      const rate = s.played ? Math.round((s.won / s.played) * 100) : 0;
      const scoreGame = s.bestScore != null && s.bestTime == null && !s.won;
      const open = key === openKey;
      return `<tr class="row${open ? " open" : ""}" data-key="${key}" tabindex="0" aria-expanded="${open}">
          <th scope="row">${game}${variant ? `<span class="variant">${variant}</span>` : ""}</th>
          <td>${s.played}</td>
          <td>${scoreGame ? "—" : `${s.won} <span class="dim">(${rate}%)</span>`}</td>
          <td>${s.bestTime != null ? formatTime(s.bestTime) : "—"}</td>
          <td>${s.bestScore != null ? s.bestScore : "—"}</td>
          <td>${scoreGame ? "—" : s.bestStreak}</td>
          <td>${s.timePlayed ? formatDuration(s.timePlayed) : "—"}</td>
        </tr>${open ? `<tr class="detail-row"><td colspan="7">${detail(key, s)}</td></tr>` : ""}`;
    })
    .join("");

  const figure = (label: string, value: string) => `<div class="figure"><strong>${value}</strong><span>${label}</span></div>`;
  const usedGroups = GROUPS.filter((g) => known.some(([k, s]) => s.played > 0 && gameById(k.split(":")[0])?.group === g.id));
  stage.innerHTML = `
    <div class="page wide">
      <header class="page-head"><h1>Stats</h1><p>Everything you play on this computer. Click a row for details.</p></header>
      <div class="figures">
        ${figure("Games played", String(totals.played))}
        ${figure("Won", String(totals.won))}
        ${figure("Win rate", totals.played ? `${Math.round((totals.won / totals.played) * 100)}%` : "—")}
        ${figure("Time played", totals.time ? formatDuration(totals.time) : "—")}
        ${figure("Daily streak", `${dailyStreak()} ${dailyStreak() === 1 ? "day" : "days"}`)}
        ${figure("Trophies", `${unlockedCount()} of ${ACHIEVEMENTS.length}`)}
      </div>
      ${
        known.some(([, s]) => s.played > 0)
          ? `<div class="seg" role="tablist" aria-label="Group">
              <button role="tab" data-gf="all" aria-selected="${groupFilter === "all"}">All</button>
              ${usedGroups.map((g) => `<button role="tab" data-gf="${g.id}" aria-selected="${groupFilter === g.id}">${g.name}</button>`).join("")}
            </div>
            <div class="table-wrap"><table class="stats">
              <thead><tr><th scope="col">Game</th><th scope="col">Played</th><th scope="col">Won</th><th scope="col">Best time</th><th scope="col">Best score</th><th scope="col">Best streak</th><th scope="col">Time played</th></tr></thead>
              <tbody>${rows || `<tr><td colspan="7" class="dim" style="text-align:center">Nothing played in this group yet.</td></tr>`}</tbody>
            </table></div>`
          : `<div class="empty"><p>No games played yet. Your results will show up here.</p><a class="btn" href="#/">Choose a game</a></div>`
      }
    </div>`;

  stage.querySelectorAll<HTMLElement>("[data-gf]").forEach((b) =>
    b.addEventListener("click", () => {
      groupFilter = b.dataset.gf!;
      showStats(stage);
    }),
  );
  const toggleRow = (key: string) => {
    openKey = openKey === key ? "" : key;
    const top = stage.scrollTop;
    showStats(stage);
    stage.scrollTop = top;
    stage.querySelector<HTMLElement>(`tr[data-key="${key}"]`)?.focus();
  };
  stage.querySelectorAll<HTMLElement>("tr[data-key]").forEach((r) => {
    r.addEventListener("click", () => toggleRow(r.dataset.key!));
    r.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleRow(r.dataset.key!);
      }
    });
  });
  const reset = stage.querySelector<HTMLButtonElement>("[data-reset-key]");
  reset?.addEventListener("click", () => {
    if (!reset.dataset.confirm) {
      reset.dataset.confirm = "1";
      reset.textContent = "Click again to reset";
      return;
    }
    resetStatsKey(reset.dataset.resetKey!);
    openKey = "";
    showStats(stage);
  });
}
