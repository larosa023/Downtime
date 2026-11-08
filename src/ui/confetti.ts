// A short, light confetti burst for wins. One canvas, removed when done.

import { animScale, getSettings, motionEnabled } from "../core/settings";

export function confetti(host: HTMLElement): void {
  const s = getSettings();
  if (!s.celebrate || !motionEnabled() || s.lowPower) return;
  const rect = host.getBoundingClientRect();
  if (!rect.width) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const c = document.createElement("canvas");
  c.className = "confetti";
  c.width = Math.round(rect.width * dpr);
  c.height = Math.round(rect.height * dpr);
  host.appendChild(c);
  const g = c.getContext("2d")!;
  g.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement);
  const colors = ["--accent", "--accent-strong", "--danger", "--n2", "--n4", "--card"].map((v) => css.getPropertyValue(v).trim() || "#fff");
  const n = Math.min(140, Math.round(rect.width / 7));
  const parts = Array.from({ length: n }, () => {
    const fromLeft = Math.random() < 0.5;
    const ang = (fromLeft ? -60 : -120) * (Math.PI / 180) + (Math.random() - 0.5) * 0.9;
    const speed = 520 + Math.random() * 520;
    return {
      x: fromLeft ? rect.width * 0.08 : rect.width * 0.92,
      y: rect.height * 0.92,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      w: 5 + Math.random() * 5,
      h: 8 + Math.random() * 6,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 14,
      color: colors[Math.floor(Math.random() * colors.length)],
    };
  });
  const dur = 1600 * Math.max(0.6, Math.min(1, animScale()));
  const t0 = performance.now();
  let last = t0;
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = (now - t0) / dur;
    g.clearRect(0, 0, rect.width, rect.height);
    g.globalAlpha = t > 0.7 ? Math.max(0, 1 - (t - 0.7) / 0.3) : 1;
    for (const p of parts) {
      p.vy += 1100 * dt;
      p.vx *= 1 - 1.2 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.r += p.vr * dt;
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.r);
      g.fillStyle = p.color;
      g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 0.7)) + 1);
      g.restore();
    }
    if (t < 1 && c.isConnected) requestAnimationFrame(frame);
    else c.remove();
  };
  requestAnimationFrame(frame);
}
