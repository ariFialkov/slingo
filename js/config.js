// Slingo — game configuration & RTP math.
//
// Every ball is an isolated bet. At launch a multiplier is drawn from
// PRIZE_TABLE (Σ m·p = TARGET_RTP), fixing the ball's target prize. The
// pinball physics that follows is purely visual: scoring components steer the
// running total toward the target in SCORE_STEP increments, and whichever
// pocket or hole finally swallows the ball reveals the exact residual — so the
// deterministic outcome is reached on every possible route.

export const TARGET_RTP = 0.96;

export const START_BALANCE = 1000;
export const TOPUP_AMOUNT = 500;

// Ball types: the bet is chosen by cycling the ball type.
export const BALL_TYPES = [
  { key: 'bronze', name: 'BRONZE', bet: 1, color: '#c98f2d', hi: '#ffe9a8' },
  { key: 'silver', name: 'SILVER', bet: 5, color: '#aab6c8', hi: '#f4f8ff' },
  { key: 'gold', name: 'GOLD', bet: 10, color: '#ffd65a', hi: '#fff6d8' },
  { key: 'platinum', name: 'PLATINUM', bet: 25, color: '#7fd8ff', hi: '#e9fbff' },
  { key: 'diamond', name: 'DIAMOND', bet: 100, color: '#d9a1ff', hi: '#fbefff' },
];

// Prize table: [multiplier, probability]. Remaining probability = ×0.
// Σ m·p = 0.96 (verified by tools/verify-rtp.js). ~64.8% of balls win something.
export const PRIZE_TABLE = [
  [0.5, 0.2],
  [1, 0.2],
  [1.5, 0.1],
  [2, 0.08],
  [3, 0.04],
  [5, 0.02],
  [10, 0.006],
  [25, 0.0012],
  [100, 0.0004],
];

// Component awards are multiples of SCORE_STEP × stake (5% of the bet), which
// keeps every running total and pocket reveal a clean amount.
export const SCORE_STEP = 0.05;

// Physics (all speeds/accelerations scale with the field height).
export const PHYS = {
  gravity: 0.78,       // × fieldHeight / s²  (a gently tilted table)
  restitutionWall: 0.6,
  restitutionPin: 0.8,
  restitutionBumper: 0.45,
  bumperKick: 0.8,     // × fieldHeight / s
  drag: 0.08,          // per second
  maxSpeed: 2.6,       // × fieldHeight / s
  ballRadius: 0.017,   // × fieldWidth
  entrySpeed: [0.22, 0.42], // × fieldHeight / s at min/max pull
  softLifeMs: 18000,   // after this, gravity ramps up to drain stuck balls
  hardLifeMs: 30000,   // after this, the ball is force-settled
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
