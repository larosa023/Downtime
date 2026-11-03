import { getSettings } from "./settings";

// Tiny synthesized sound effects, so the app ships with no audio files.

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (!getSettings().sound) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, dur: number, type: OscillatorType, gain: number, delay = 0, slideTo?: number) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + delay;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise(dur: number, gain: number, freq = 2400) {
  const a = audio();
  if (!a) return;
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  const src = a.createBufferSource();
  src.buffer = buf;
  const filter = a.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = freq;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(a.destination);
  src.start();
}

export const sfx = {
  place: () => noise(0.06, 0.35, 1800),
  flip: () => noise(0.05, 0.25, 3200),
  deal: () => noise(0.04, 0.18, 2600),
  pick: () => tone(520, 0.05, "sine", 0.04),
  tick: () => tone(880, 0.04, "triangle", 0.035),
  eat: () => tone(660, 0.09, "sine", 0.07, 0, 990),
  merge: () => tone(440, 0.08, "sine", 0.05, 0, 620),
  flag: () => tone(740, 0.06, "triangle", 0.05),
  error: () => tone(180, 0.14, "sine", 0.06, 0, 120),
  lose: () => {
    tone(330, 0.18, "sine", 0.07, 0, 220);
    tone(220, 0.3, "sine", 0.06, 0.16, 140);
  },
  win: () => {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, "sine", 0.07, i * 0.09));
  },
};
