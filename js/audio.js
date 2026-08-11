// Slingo — tiny WebAudio synth (no assets, PWA-friendly).
let ctx = null;
let muted = false;

export function initAudio() {
  if (!ctx) {
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
  }
  if (ctx.state === 'suspended') ctx.resume();
}

export function toggleMute() { muted = !muted; return muted; }
export function isMuted() { return muted; }

function tone(freq, dur, { type = 'sine', gain = 0.15, slide = 0, delay = 0 } = {}) {
  if (!ctx || muted) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise(dur, { gain = 0.12, delay = 0 } = {}) {
  if (!ctx || muted) return;
  const t0 = ctx.currentTime + delay;
  const len = Math.max(1, (dur * ctx.sampleRate) | 0);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  src.connect(g).connect(ctx.destination);
  src.start(t0);
}

export const sfx = {
  fire(power) { noise(0.12 + 0.1 * power, { gain: 0.1 + 0.12 * power }); tone(220 + 260 * power, 0.12, { type: 'triangle', gain: 0.08, slide: 300 }); },
  hit() { noise(0.05, { gain: 0.1 }); tone(140, 0.08, { type: 'square', gain: 0.06, slide: -60 }); },
  flip() { tone(520, 0.05, { type: 'triangle', gain: 0.05 }); tone(700, 0.05, { type: 'triangle', gain: 0.04, delay: 0.06 }); },
  win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.14, { type: 'triangle', gain: 0.1, delay: i * 0.07 })); },
  bigwin() { [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, 0.2, { type: 'triangle', gain: 0.12, delay: i * 0.08 })); },
  lose() { tone(200, 0.18, { type: 'sawtooth', gain: 0.05, slide: -110 }); },
  bonus() { [392, 523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(f, 0.16, { type: 'square', gain: 0.06, delay: i * 0.06 })); },
  led() { tone(880, 0.06, { type: 'square', gain: 0.05 }); },
  fill() { tone(600, 0.07, { type: 'triangle', gain: 0.08, slide: 220 }); },
  step() { tone(440, 0.08, { type: 'triangle', gain: 0.08, slide: 120 }); },
  miss() { tone(160, 0.1, { type: 'sine', gain: 0.05, slide: -60 }); },
};
