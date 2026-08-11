// Slingo — game configuration & RTP math.
//
// Every slingshot hit is an isolated bet. Each tile type resolves with an
// expected value of TILE_RTP × stake; the gap between TILE_RTP and TARGET_RTP
// is the (deterministic) budget for the pattern bonuses, which multiply the
// last won prize when 3/5-tile lines of consecutive winners are completed.

export const TARGET_RTP = 0.96;
export const TILE_RTP = 0.94; // per-bet EV; ~2% headroom funds pattern bonuses

export const START_BALANCE = 200;
export const TOPUP_AMOUNT = 100;

// Board is GRID × GRID.
export const GRID = 3;

// Pattern bonuses: extra payout = (mult - 1) × last won prize.
// On a 3×3 board a full line is 3 tiles; diagonals (through the centre) pay more.
export const BONUS = {
  line3: { mult: 2, label: 'LINE' },
  diag3: { mult: 3, label: 'DIAGONAL' },
};

// Prize tables: [multiplier, probability]. Remaining probability = lose (×0).
// Each table's Σ m·p must equal TILE_RTP (verified by tools/verify-rtp.js).
export const TABLES = {
  // Normal prize spread.
  standard: [
    [0.5, 0.24],
    [1, 0.16],
    [2, 0.1],
    [5, 0.045],
    [10, 0.016],
    [25, 0.003],
  ],
  // High hit rate (75.5% overall, 70% in the 0.5–2× band), small wins.
  safe: [
    [0.5, 0.3],
    [1, 0.25],
    [1.5, 0.1],
    [2, 0.05],
    [5, 0.05],
    [8, 0.005],
  ],
  // Low hit rate (~5.4%), much larger multipliers.
  wild: [
    [10, 0.03],
    [20, 0.02],
    [50, 0.004],
    [100, 0.0004],
  ],
  // Almost always loses / tiny return, 0.17% chance of a fixed 500×.
  jackpot: [
    [0.5, 0.08],
    [1, 0.05],
    [500, 0.0017],
  ],
  // Binary; probability chosen to hit tile RTP.
  double: [[2, TILE_RTP / 2]],
};

// High-Low variants: strictly binary — pHigh + pLow = 1, so every bet lands on
// one of the two options. pH·H + (1-pH)·L = TILE_RTP. A miss only exists when
// the low option is ×0. One variant is chosen per tile.
export const HILO_VARIANTS = [
  { high: 1.6, pHigh: 0.4, low: 0.5 },
  { high: 2.7, pHigh: 0.2, low: 0.5 },
  { high: 9.4, pHigh: 0.1, low: 0 },
];

// Risk slider: risk r∈[0,1] → multiplier M(r) = 1 + (RISK_MAX_MULT-1)·r,
// win probability p(r) = TILE_RTP / M(r)  ⇒  EV = TILE_RTP for every r.
export const RISK_MAX_MULT = 50;
export const RISK_PERIOD_MS = 2000; // 0%→100%→0% round trip

// Roulette: winning cube uniform over 9; prize per selected winning square is
// 9 × TILE_RTP (= 8.46× at 94%), so EV per square staked = TILE_RTP.
export const ROULETTE_MULT = 9 * TILE_RTP;

// Stepper: immediate cash-out returns TILE_RTP × cost; every further step is
// EV-neutral (value ÷= p on success), so any strategy has EV = TILE_RTP.
export function stepperStepProb(k) {
  // Success probability of attempting step k (1-based).
  return Math.max(0.55, 0.86 - 0.02 * (k - 1));
}
export const STEPPER_MAX_STEPS = 40;

// Randomizer tile count weights (2–3 most common).
export const RANDOMIZER_COUNTS = [
  [1, 0.1],
  [2, 0.3],
  [3, 0.3],
  [4, 0.2],
  [5, 0.1],
];

// Fill & Deal per-shot increments (one is chosen per tile instance).
export const FILL_INCREMENTS = [
  [1, 0.35],
  [2, 0.3],
  [5, 0.2],
  [10, 0.1],
  [25, 0.05],
];

// Tile type registry: costs, colors, board-population weights.
export const TYPES = {
  standard: { name: 'STANDARD', cost: 1, color: '#3b4a6b', accent: '#8fb4ff', weight: 20 },
  safe: { name: 'SAFE', cost: 1, color: '#1f7a4d', accent: '#7dffb9', weight: 12 },
  wild: { name: 'WILD', cost: 1, color: '#6b2fa0', accent: '#d9a1ff', weight: 10 },
  jackpot: { name: 'JACKPOT', cost: 1, color: '#7a5c10', accent: '#ffd94d', weight: 7 },
  double: { name: 'DOUBLE OR NOTHING', cost: 1, color: '#a03030', accent: '#ff9d9d', weight: 10 },
  hilo: { name: 'HIGH / LOW', cost: 1, color: '#146e73', accent: '#7ef3f9', weight: 10 },
  fill: { name: 'FILL & DEAL', cost: 0, color: '#8a4b1f', accent: '#ffc07d', weight: 8 },
  risk: { name: 'RISK SLIDER', cost: 1, color: '#a02864', accent: '#ff8ec4', weight: 8 },
  randomizer: { name: 'RANDOMIZER', cost: 2, color: '#2b7fb8', accent: '#9fdcff', weight: 6 },
  roulette: { name: 'ROULETTE', cost: 0.5, color: '#7a1f3d', accent: '#ff7da0', weight: 5 },
  stepper: { name: 'STEPPER', cost: 2, color: '#35389a', accent: '#a3a6ff', weight: 6 },
};

export const RESPAWN_DELAY_MS = 2600;

export function fmtMoney(v) {
  const s = Math.abs(v) < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(2) : Math.round(v).toString();
  return '$' + s;
}
