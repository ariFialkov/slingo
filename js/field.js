// Slingo — playfield layout and deterministic scoring.
import { PRIZE_TABLE, SCORE_STEP, round2 } from './config.js';

// ---------------------------------------------------------------------------
// Outcome & steering
// ---------------------------------------------------------------------------
export function rollMultiplier() {
  let roll = Math.random();
  for (const [mult, p] of PRIZE_TABLE) {
    roll -= p;
    if (roll <= 0) return mult;
  }
  return 0;
}

const rand = (a, b) => a + Math.random() * (b - a);

// Amount a signed component awards to `ball` right now. Positive components
// close a share of the remaining gap; negative ones pull an overshoot back
// (or nibble a nominal step so later positives have something to fill).
// Every award is a multiple of SCORE_STEP × stake.
export function awardFor(ball, sign) {
  const step = round2(SCORE_STEP * ball.stake);
  const nice = (x) => round2(Math.round(x / step) * step);
  const gap = round2(ball.target - ball.total);
  if (sign > 0) {
    if (gap >= step) return Math.min(gap, Math.max(step, nice(gap * rand(0.25, 0.7))));
    return step; // nominal overshoot; minus components / the pocket settle it
  }
  const over = round2(ball.total - ball.target);
  if (over >= step) return -Math.min(over, Math.max(step, nice(over * rand(0.5, 1))));
  if (ball.total >= step) return -step;
  return 0;
}

// The residual a pocket or hole reveals so the ball ends exactly on target.
export function residualFor(ball) {
  return round2(ball.target - ball.total);
}

// ---------------------------------------------------------------------------
// Layout (normalised 0..1, y down) → pixels
// ---------------------------------------------------------------------------
const ARCH_POINTS = 14;

export function buildField(x0, y0, w, h) {
  const P = (u, v) => ({ x: x0 + u * w, y: y0 + v * h });
  const seg = (u1, v1, u2, v2, extra = {}) => ({ a: P(u1, v1), b: P(u2, v2), ...extra });
  const R = (ru) => ru * w; // radii scale with width

  const walls = [];
  // top arch
  const arch = [];
  for (let i = 0; i <= ARCH_POINTS; i++) {
    const a = Math.PI - (i / ARCH_POINTS) * Math.PI;
    arch.push([0.5 + 0.5 * Math.cos(a), 0.15 - 0.13 * Math.sin(a)]);
  }
  for (let i = 0; i < arch.length - 1; i++) walls.push(seg(...arch[i], ...arch[i + 1]));
  // side walls
  walls.push(seg(0, 0.15, 0, 1));
  walls.push(seg(1, 0.15, 1, 1));
  // lane guides at the top (three rollover lanes)
  for (const u of [0.31, 0.44, 0.56, 0.69]) walls.push(seg(u, 0.17, u, 0.27));
  // pocket dividers
  for (const u of [0.2, 0.4, 0.6, 0.8]) walls.push(seg(u, 0.87, u, 1));

  // signed rails: slanted pieces that award on contact
  const rails = [
    { ...seg(0, 0.62, 0.13, 0.69), sign: -1 },
    { ...seg(1, 0.62, 0.87, 0.69), sign: -1 },
    { ...seg(0, 0.79, 0.11, 0.86), sign: +1 },
    { ...seg(1, 0.79, 0.89, 0.86), sign: +1 },
  ];

  const pins = [];
  const addPin = (u, v, r = 0.011, sign = 0) => pins.push({ ...P(u, v), r: R(r), sign });
  // plinko lattice woven between the bumpers/holes; the mid rows are signed
  // "kicker pins" that score (no kick), so every route has +/− avenues
  for (const u of [0.2, 0.35, 0.5, 0.65, 0.8]) addPin(u, 0.31);
  [0.125, 0.275, 0.425, 0.575, 0.725, 0.875].forEach((u, i) => addPin(u, 0.385, 0.012, i % 2 ? -1 : +1));
  [0.14, 0.38, 0.62, 0.86].forEach((u, i) => addPin(u, 0.535, 0.013, i % 2 ? +1 : -1));
  [0.3, 0.42, 0.58, 0.7].forEach((u, i) => addPin(u, 0.665, 0.013, i % 2 ? -1 : +1));
  for (const u of [0.15, 0.3, 0.5, 0.7, 0.85]) addPin(u, 0.79);
  for (const u of [0.2, 0.4, 0.6, 0.8]) addPin(u, 0.87, 0.012); // divider caps
  for (const u of [0.31, 0.44, 0.56, 0.69]) addPin(u, 0.17, 0.008); // lane-guide caps

  const bumpers = [
    { ...P(0.27, 0.5), r: R(0.05), sign: +1 },
    { ...P(0.73, 0.5), r: R(0.05), sign: +1 },
    { ...P(0.5, 0.44), r: R(0.036), sign: +1 },
    { ...P(0.5, 0.6), r: R(0.048), sign: -1 },
    { ...P(0.17, 0.73), r: R(0.034), sign: -1 },
    { ...P(0.83, 0.73), r: R(0.034), sign: -1 },
  ];

  // holes swallow the ball (settles the bet)
  const holes = [
    { ...P(0.5, 0.735), r: R(0.032) },
    { ...P(0.085, 0.52), r: R(0.03) },
    { ...P(0.915, 0.52), r: R(0.03) },
  ];

  // rollover sensors inside the top lanes (award + when crossed downward)
  const lanes = [0.375, 0.5, 0.625].map((u) => ({
    x: x0 + u * w, y: y0 + 0.245 * h, halfW: 0.05 * w, sign: +1,
  }));

  // bottom pockets
  const pocketLine = y0 + 0.955 * h;
  const pockets = [];
  for (let i = 0; i < 5; i++) {
    pockets.push({ x0: x0 + i * 0.2 * w, x1: x0 + (i + 1) * 0.2 * w, yTop: y0 + 0.87 * h, yLine: pocketLine });
  }

  // where the slingshot may drop a ball in
  const entry = { x0: x0 + 0.1 * w, x1: x0 + 0.9 * w, y0: y0 + 0.06 * h, y1: y0 + 0.235 * h };

  return { x0, y0, w, h, walls, rails, pins, bumpers, holes, lanes, pockets, pocketLine, entry, arch: arch.map(([u, v]) => P(u, v)) };
}
