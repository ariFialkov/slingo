// Slingo — game configuration & RTP math.
//
// Every ball is an isolated bet. At launch a multiplier is drawn from the
// machine's risk profile (Σ m·p = TARGET_RTP for every profile), fixing the
// ball's prize. The pinball physics that follows is purely visual: signed
// components steer the running total toward an aim, and whichever exit
// swallows the ball reveals the mystery multiplier that turns that total into
// the fixed prize — so the outcome is deterministic wherever the ball lands.

export const TARGET_RTP = 0.96;

export const START_BALANCE = 500;
export const TOPUP_AMOUNT = 250;
export const BUYIN_BALLS = 20; // a machine's buy-in = its minimum bet × this

export const BALL_TYPES = [
  { key: 'bronze', name: 'BRONZE', bet: 1, color: '#c98f2d', hi: '#ffe9a8' },
  { key: 'silver', name: 'SILVER', bet: 5, color: '#aab6c8', hi: '#f4f8ff' },
  { key: 'gold', name: 'GOLD', bet: 10, color: '#ffd65a', hi: '#fff6d8' },
  { key: 'platinum', name: 'PLATINUM', bet: 25, color: '#7fd8ff', hi: '#e9fbff' },
  { key: 'diamond', name: 'DIAMOND', bet: 100, color: '#d9a1ff', hi: '#fbefff' },
];

// Component awards are multiples of SCORE_STEP × stake (5% of the bet).
export const SCORE_STEP = 0.05;
// Exit multipliers the steering aims for; the exit computes the exact one.
export const EXIT_MULTS = [[0.5, 12], [0.75, 16], [1, 24], [1.5, 20], [2, 14], [3, 8], [5, 4], [10, 2]];
export const MIN_TOTAL_FRAC = 0; // a ball carries its bet as credit and can be knocked to zero

// Risk profiles: prize tables of identical EV (0.96) but very different
// variance, plus physics and flipper charges. Verified by tools/verify-rtp.js.
const luckyP3 = (0.96 - (1 * 0.15 + 2 * 0.1 + 7 * 0.04 + 77 * 0.002 + 777 * 0.0002)) / 3;
export const PROFILES = {
  safe:     { name: 'SAFE',     tag: 'slow & steady',        table: [[0.5, 0.3], [1, 0.3], [1.5, 0.16], [2, 0.1], [3, 0.02], [5, 0.002]], physics: { gravity: 0.8 }, flips: 1 },
  marathon: { name: 'MARATHON', tag: 'long-lasting balls',   table: [[0.5, 0.25], [1, 0.25], [1.5, 0.1], [2, 0.1], [3, 0.05], [5, 0.017]], physics: { gravity: 0.62, drag: 0.05 }, flips: 3 },
  moderate: { name: 'MODERATE', tag: 'balanced',             table: [[0.5, 0.22], [1, 0.2], [2, 0.12], [3, 0.05], [5, 0.02], [10, 0.007], [25, 0.0036]], physics: { gravity: 0.85 }, flips: 1 },
  bonus:    { name: 'BONUS',    tag: 'big-pop discs',        table: [[0.5, 0.2], [1, 0.18], [2, 0.1], [4, 0.06], [8, 0.02], [20, 0.004]], physics: { gravity: 0.82 }, flips: 2 },
  volatile: { name: 'VOLATILE', tag: 'high potential',       table: [[0.5, 0.15], [1, 0.12], [2, 0.08], [5, 0.04], [10, 0.015], [25, 0.006], [50, 0.002], [100, 0.00005]], physics: { gravity: 0.9 }, flips: 1 },
  extreme:  { name: 'EXTREME',  tag: 'rare huge wins',       table: [[1, 0.08], [3, 0.05], [10, 0.02], [25, 0.008], [100, 0.002], [500, 0.00026]], physics: { gravity: 0.95 }, flips: 1 },
  lucky:    { name: 'LUCKY 7',  tag: 'sevens pay',           table: [[1, 0.15], [2, 0.1], [3, luckyP3], [7, 0.04], [77, 0.002], [777, 0.0002]], physics: { gravity: 0.9 }, flips: 1 },
};

// Physics defaults (speeds/accelerations scale with the field height).
export const PHYS = {
  gravity: 0.85,       // × fieldHeight / s²
  restitutionWall: 0.6,
  restitutionPin: 0.8,
  restitutionBumper: 0.45,
  bumperKick: 0.8,     // × fieldHeight / s
  flipperKick: 1.15,   // × fieldHeight / s
  drag: 0.08,          // per second
  maxSpeed: 3.0,       // × fieldHeight / s
  ballRadius: 0.017,   // × fieldWidth
  // Plunger charge → launch speed as a multiple of the speed that clears the
  // lane flap: below `threshold` the ball always falls back, at or above it
  // the ball always reaches the field. Deterministic.
  launch: { threshold: 0.25, weak: [0.5, 0.9], strong: [1.12, 2.27] },
  softLifeMs: 12000,   // gravity ramps up after this to drain lingering balls
  hardLifeMs: 22000,   // force-settle after this
};

export function fmtMoney(v) {
  const neg = v < 0;
  const a = Math.abs(v);
  const s = a < 100 ? a.toFixed(2) : Math.round(a).toString();
  return (neg ? '−$' : '$') + s;
}

export function round2(v) {
  return Math.round(v * 100) / 100;
}
