// Slingo — tile creation, outcome resolution and per-type hit logic.
import {
  TABLES, TYPES, TILE_RTP, HILO_VARIANTS, RISK_MAX_MULT, RISK_PERIOD_MS,
  ROULETTE_MULT, stepperStepProb, STEPPER_MAX_STEPS, RANDOMIZER_COUNTS,
  FILL_INCREMENTS, fmtMoney,
} from './config.js';

export function weightedPick(pairs) {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let roll = Math.random() * total;
  for (const [value, w] of pairs) {
    roll -= w;
    if (roll <= 0) return value;
  }
  return pairs[pairs.length - 1][0];
}

// Roll a prize table → multiplier (0 on lose).
export function rollTable(table) {
  let roll = Math.random();
  for (const [mult, p] of table) {
    roll -= p;
    if (roll <= 0) return mult;
  }
  return 0;
}

export function randomTypeKey() {
  return weightedPick(Object.entries(TYPES).map(([k, d]) => [k, d.weight]));
}

// Create a fresh tile instance with per-type state.
export function makeTile(typeKey = randomTypeKey()) {
  const def = TYPES[typeKey];
  const tile = { type: typeKey, def, cost: def.cost };
  switch (typeKey) {
    case 'hilo':
      tile.variant = HILO_VARIANTS[(Math.random() * HILO_VARIANTS.length) | 0];
      break;
    case 'fill':
      tile.increment = weightedPick(FILL_INCREMENTS);
      tile.fill = 0;
      break;
    case 'risk':
      tile.phase = Math.random() * RISK_PERIOD_MS; // desync sliders
      break;
    case 'randomizer':
      tile.count = weightedPick(RANDOMIZER_COUNTS);
      break;
    case 'roulette':
      tile.selected = new Set();
      tile.reveal = null; // {winner, until}
      break;
    case 'stepper':
      tile.active = false;
      tile.step = 0;
      tile.value = 0;
      tile.crashStep = 0;
      break;
  }
  return tile;
}

// Current risk-slider position r∈[0,1] (triangle wave).
export function riskPosition(tile, now) {
  const t = ((now + tile.phase) % RISK_PERIOD_MS) / RISK_PERIOD_MS; // 0..1
  return t < 0.5 ? t * 2 : 2 - t * 2;
}

// Predetermine the stepper crash step in one isolated event.
export function rollCrashStep() {
  for (let k = 1; k <= STEPPER_MAX_STEPS; k++) {
    if (Math.random() >= stepperStepProb(k)) return k;
  }
  return STEPPER_MAX_STEPS + 1;
}

// Instant resolution for a tile hit by the Randomizer (interactive types fall
// back to the standard table so the stake resolves in a single event).
export function instantOutcome(tile, stake, now) {
  switch (tile.type) {
    case 'standard':
    case 'safe':
    case 'wild':
    case 'jackpot':
    case 'double':
      return rollTable(TABLES[tile.type]) * stake;
    case 'hilo': {
      const v = tile.variant;
      return (Math.random() < v.pHigh ? v.high : v.low) * stake;
    }
    case 'risk': {
      const r = riskPosition(tile, now);
      const mult = 1 + (RISK_MAX_MULT - 1) * r;
      return Math.random() < TILE_RTP / mult ? mult * stake : 0;
    }
    default:
      return rollTable(TABLES.standard) * stake;
  }
}

// ---------------------------------------------------------------------------
// Hit handling. Returns one of:
//   {kind:'none'}                          — dud (no bet placed)
//   {kind:'interact', sound}               — sub-target hit, no bet yet
//   {kind:'bet', cost, prize, label}       — an isolated bet resolved
//   {kind:'randomizer', cost, count}       — caller resolves the chosen tiles
//   {kind:'roulette-place', cost, win, prize, winner} — grid bet placed
// fx, fy are tile-local coordinates in [0,1] (origin top-left).
// ---------------------------------------------------------------------------
export function hitTile(tile, fx, fy, now) {
  switch (tile.type) {
    case 'standard':
    case 'safe':
    case 'wild':
    case 'jackpot': {
      const mult = rollTable(TABLES[tile.type]);
      return { kind: 'bet', cost: tile.cost, prize: mult * tile.cost, label: multLabel(mult) };
    }
    case 'double': {
      const mult = rollTable(TABLES.double);
      return { kind: 'bet', cost: tile.cost, prize: mult * tile.cost, label: mult ? '×2' : 'NOTHING' };
    }
    case 'hilo': {
      const v = tile.variant;
      const isHigh = Math.random() < v.pHigh;
      const mult = isHigh ? v.high : v.low;
      return {
        kind: 'bet', cost: tile.cost, prize: mult * tile.cost,
        label: isHigh ? `HIGH ×${v.high}` : `LOW ×${v.low}`,
      };
    }
    case 'fill': {
      // Doggy-door slot: lower middle of the tile.
      if (fx > 0.32 && fx < 0.68 && fy > 0.58 && fy < 0.95) {
        tile.fill += tile.increment;
        tile.doorT = now; // swing the door open and drop the ball through
        return { kind: 'interact', sound: 'fill', swallow: true };
      }
      if (tile.fill <= 0) return { kind: 'none' };
      const stake = tile.fill;
      const mult = rollTable(TABLES.standard);
      return { kind: 'bet', cost: stake, prize: mult * stake, label: multLabel(mult) };
    }
    case 'risk': {
      const r = riskPosition(tile, now);
      const mult = 1 + (RISK_MAX_MULT - 1) * r;
      const won = Math.random() < TILE_RTP / mult;
      return {
        kind: 'bet', cost: tile.cost, prize: won ? mult * tile.cost : 0,
        label: won ? `×${mult.toFixed(1)}` : `RISK ${(r * 100) | 0}%`,
      };
    }
    case 'randomizer':
      return { kind: 'randomizer', cost: tile.cost, count: tile.count };
    case 'roulette': {
      const idx = rouletteCubeAt(fx, fy);
      if (idx >= 0) {
        if (tile.selected.has(idx)) tile.selected.delete(idx);
        else tile.selected.add(idx);
        return { kind: 'interact', sound: 'led' };
      }
      if (tile.selected.size === 0) return { kind: 'none' };
      const winner = (Math.random() * 9) | 0;
      const won = tile.selected.has(winner);
      const cost = tile.selected.size * tile.cost;
      return { kind: 'roulette-place', cost, winner, win: won, prize: won ? ROULETTE_MULT * tile.cost : 0 };
    }
    case 'stepper': {
      const btn = stepperButtonAt(fx, fy);
      if (btn === 0) return { kind: 'none' };
      if (!tile.active) {
        // First hit on either button starts the game and places the bet.
        tile.active = true;
        tile.step = 0;
        tile.value = TILE_RTP * tile.cost;
        tile.crashStep = rollCrashStep();
        return { kind: 'interact', sound: 'step', startCost: tile.cost };
      }
      if (btn === 1) {
        // Top button: take another step.
        const k = tile.step + 1;
        if (k >= tile.crashStep) {
          tile.active = false;
          return { kind: 'bet', cost: 0, prize: 0, label: 'CRASH', prePaid: true };
        }
        tile.value = tile.value / stepperStepProb(k);
        tile.step = k;
        return { kind: 'interact', sound: 'step' };
      }
      // Bottom button: cash out at the current value.
      const prize = tile.value;
      tile.active = false;
      return { kind: 'bet', cost: 0, prize, label: 'CASH OUT', prePaid: true };
    }
    default:
      return { kind: 'none' };
  }
}

export function multLabel(mult) {
  return mult > 0 ? `×${+mult.toFixed(2)}` : 'NOTHING';
}

// Roulette 3×3 cube geometry (tile-local). Returns cube index 0-8 or -1.
const ROU = { x0: 0.22, y0: 0.3, size: 0.56, gap: 0.04 };
export function rouletteCubeAt(fx, fy) {
  const cell = ROU.size / 3;
  const cx = (fx - ROU.x0) / cell;
  const cy = (fy - ROU.y0) / cell;
  if (cx < 0 || cy < 0 || cx >= 3 || cy >= 3) return -1;
  // small gap between cubes is a dead zone
  const inX = cx % 1, inY = cy % 1;
  const pad = ROU.gap / cell / 2;
  if (inX < pad || inX > 1 - pad || inY < pad || inY > 1 - pad) return -1;
  return (cy | 0) * 3 + (cx | 0);
}
export function rouletteCubeRect(i) {
  const cell = ROU.size / 3;
  return {
    x: ROU.x0 + (i % 3) * cell + ROU.gap / 2,
    y: ROU.y0 + ((i / 3) | 0) * cell + ROU.gap / 2,
    w: cell - ROU.gap,
    h: cell - ROU.gap,
  };
}

// Stepper buttons (tile-local): 1 = top (step), 2 = bottom (cash out), 0 = none.
export function stepperButtonAt(fx, fy) {
  if (fx < 0.18 || fx > 0.82) return 0;
  if (fy > 0.3 && fy < 0.58) return 1;
  if (fy > 0.64 && fy < 0.92) return 2;
  return 0;
}

export function tileCostLabel(tile) {
  switch (tile.type) {
    case 'fill':
      return tile.fill > 0 ? fmtMoney(tile.fill) : `+${fmtMoney(tile.increment)}/shot`;
    case 'roulette':
      return `${fmtMoney(tile.cost)}/sq`;
    default:
      return fmtMoney(tile.cost);
  }
}
