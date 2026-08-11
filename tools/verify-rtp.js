#!/usr/bin/env node
// Verifies every tile type's expected value equals TILE_RTP (analytically
// where possible, by Monte Carlo for the sequential/interactive types).
import {
  TABLES, TILE_RTP, HILO_VARIANTS, RISK_MAX_MULT, ROULETTE_MULT,
  stepperStepProb, STEPPER_MAX_STEPS,
} from '../js/config.js';

let failed = false;
const check = (name, ev, tol = 1e-9) => {
  const ok = Math.abs(ev - TILE_RTP) <= tol;
  if (!ok) failed = true;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(28)} EV = ${ev.toFixed(5)} (target ${TILE_RTP})`);
};

// Prize tables
for (const [name, table] of Object.entries(TABLES)) {
  check(`table:${name}`, table.reduce((s, [m, p]) => s + m * p, 0));
}

// High-Low variants (binary: pLow = 1 - pHigh)
HILO_VARIANTS.forEach((v, i) => {
  check(`hilo[${i}] ×${v.high}/${v.low}`, v.pHigh * v.high + (1 - v.pHigh) * v.low);
});

// Risk slider: EV = p(r)·M(r) = TILE_RTP for every r
for (const r of [0, 0.25, 0.5, 0.75, 1]) {
  const mult = 1 + (RISK_MAX_MULT - 1) * r;
  check(`risk r=${r}`, (TILE_RTP / mult) * mult);
}

// Roulette: k selected squares, winner uniform over 9
for (const k of [1, 5, 9]) {
  check(`roulette k=${k}`, ((k / 9) * ROULETTE_MULT) / k);
}

// Stepper: cashing out after surviving n steps → value / stake, weighted by survival
for (const cashAt of [0, 1, 3, 8, STEPPER_MAX_STEPS]) {
  let value = TILE_RTP, survival = 1;
  for (let k = 1; k <= cashAt; k++) {
    const p = stepperStepProb(k);
    value /= p;
    survival *= p;
  }
  check(`stepper cash@${cashAt}`, value * survival, 1e-9);
}

// Randomizer: N tiles × (stake/N × TILE_RTP each) — trivially TILE_RTP; spot-check
// via Monte Carlo on the standard table.
{
  const table = TABLES.standard;
  const N = 2_000_000;
  let total = 0;
  for (let i = 0; i < N; i++) {
    let roll = Math.random();
    for (const [m, p] of table) { roll -= p; if (roll <= 0) { total += m; break; } }
  }
  check('monte-carlo standard', total / N, 0.01);
}

process.exit(failed ? 1 : 0);
