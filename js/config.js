// Slingo — game configuration & RTP math.
//
// Every ball is an isolated bet. At launch a multiplier is drawn from the
// current board's prize table (Σ m·p = TARGET_RTP for every theme), fixing the
// ball's target prize. The pinball physics that follows is purely visual:
// signed components steer the running total toward the target in SCORE_STEP
// increments and whichever exit swallows the ball reveals the exact residual,
// so the deterministic outcome is reached on every possible route.

export const TARGET_RTP = 0.96;

export const START_BALANCE = 1000;
export const TOPUP_AMOUNT = 500;

// Balls launched per board before a new board is generated.
export const BOARD_BALLS = 5;

export const BALL_TYPES = [
  { key: 'bronze', name: 'BRONZE', bet: 1, color: '#c98f2d', hi: '#ffe9a8' },
  { key: 'silver', name: 'SILVER', bet: 5, color: '#aab6c8', hi: '#f4f8ff' },
  { key: 'gold', name: 'GOLD', bet: 10, color: '#ffd65a', hi: '#fff6d8' },
  { key: 'platinum', name: 'PLATINUM', bet: 25, color: '#7fd8ff', hi: '#e9fbff' },
  { key: 'diamond', name: 'DIAMOND', bet: 100, color: '#d9a1ff', hi: '#fbefff' },
];

// Component awards are multiples of SCORE_STEP × stake (5% of the bet).
export const SCORE_STEP = 0.05;

// Board themes. Each pairs a colour palette with a risk profile: a prize
// table of identical EV (0.96) but very different variance, plus physics and
// component-mix tweaks. Tables are verified by tools/verify-rtp.js.
export const THEMES = {
  verdant: {
    key: 'verdant', name: 'VERDANT', tag: 'SAFE · slow & steady', risk: 1,
    primary: '#39d97a', secondary: '#1fb6a0', glow: 'rgba(57,217,122,0.55)', panel: '#0f2a1f', surface: ['#10241c', '#173328'],
    table: [[0.5, 0.3], [1, 0.3], [1.5, 0.16], [2, 0.1], [3, 0.02], [5, 0.002]],
    physics: { gravity: 0.8 }, flips: 1, mix: { plusBias: 0.65, bumpers: 3, pins: 12, holes: 2, bonus: 0 },
  },
  solar: {
    key: 'solar', name: 'SOLAR', tag: 'MODERATE · balanced', risk: 2,
    primary: '#ffd65a', secondary: '#ffb347', glow: 'rgba(255,214,90,0.55)', panel: '#2a230f', surface: ['#221d0f', '#332b14'],
    table: [[0.5, 0.22], [1, 0.2], [2, 0.12], [3, 0.05], [5, 0.02], [10, 0.007], [25, 0.0036]],
    physics: { gravity: 0.85 }, flips: 1, mix: { plusBias: 0.55, bumpers: 3, pins: 12, holes: 2, bonus: 0 },
  },
  ember: {
    key: 'ember', name: 'EMBER', tag: 'VOLATILE · high potential', risk: 3,
    primary: '#ff8a3d', secondary: '#ff5e3a', glow: 'rgba(255,138,61,0.55)', panel: '#2b1a0f', surface: ['#24160f', '#361f14'],
    table: [[0.5, 0.15], [1, 0.12], [2, 0.08], [5, 0.04], [10, 0.015], [25, 0.006], [50, 0.002], [100, 0.00005]],
    physics: { gravity: 0.9 }, flips: 1, mix: { plusBias: 0.5, bumpers: 4, pins: 11, holes: 3, bonus: 0 },
  },
  inferno: {
    key: 'inferno', name: 'INFERNO', tag: 'EXTREME · rare huge wins', risk: 4,
    primary: '#ff3b5c', secondary: '#ff1f4b', glow: 'rgba(255,59,92,0.55)', panel: '#2d0f18', surface: ['#240f16', '#37141f'],
    table: [[1, 0.08], [3, 0.05], [10, 0.02], [25, 0.008], [100, 0.002], [500, 0.00026]],
    physics: { gravity: 0.95 }, flips: 1, mix: { plusBias: 0.45, bumpers: 4, pins: 10, holes: 3, bonus: 0 },
  },
  aurora: {
    key: 'aurora', name: 'AURORA', tag: 'MARATHON · long-lasting balls', risk: 2,
    primary: '#40e0ff', secondary: '#4b7bff', glow: 'rgba(64,224,255,0.55)', panel: '#0f1e2d', surface: ['#0f1a2b', '#15263d'],
    table: [[0.5, 0.25], [1, 0.25], [1.5, 0.1], [2, 0.1], [3, 0.05], [5, 0.017]],
    physics: { gravity: 0.62, drag: 0.05 }, flips: 3, mix: { plusBias: 0.55, bumpers: 4, pins: 14, holes: 1, bonus: 0 },
  },
  nebula: {
    key: 'nebula', name: 'NEBULA', tag: 'BONUS · big-pop discs', risk: 3,
    primary: '#b46bff', secondary: '#ff5ed2', glow: 'rgba(180,107,255,0.55)', panel: '#1e0f2d', surface: ['#190f27', '#26153a'],
    table: [[0.5, 0.2], [1, 0.18], [2, 0.1], [4, 0.06], [8, 0.02], [20, 0.004]],
    physics: { gravity: 0.82 }, flips: 2, mix: { plusBias: 0.6, bumpers: 3, pins: 10, holes: 2, bonus: 2 },
  },
};
export const THEME_WEIGHTS = [['verdant', 22], ['solar', 22], ['ember', 16], ['inferno', 10], ['aurora', 15], ['nebula', 15]];

// Physics defaults (speeds/accelerations scale with the field height).
export const PHYS = {
  gravity: 0.85,       // × fieldHeight / s²
  restitutionWall: 0.6,
  restitutionPin: 0.8,
  restitutionBumper: 0.45,
  bumperKick: 0.8,     // × fieldHeight / s
  flipperKick: 1.15,   // × fieldHeight / s
  drag: 0.08,          // per second
  maxSpeed: 2.6,       // × fieldHeight / s
  ballRadius: 0.017,   // × fieldWidth
  entrySpeed: [0.18, 0.4], // × fieldHeight / s at min/max pull
  softLifeMs: 12000,   // after this, scoring stops and gravity ramps up to drain the ball
  hardLifeMs: 22000,   // after this, the ball is force-settled
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
