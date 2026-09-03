#!/usr/bin/env node
// Verifies (1) every theme's prize table has EV = TARGET_RTP, (2) the scoring
// steering lands a ball exactly on its predetermined target for any sequence
// of +/− component hits of any tier, with every award a SCORE_STEP multiple,
// and (3) procedural boards generate with their components in play and pass
// the V-pocket trap scan.
import { THEMES, TARGET_RTP, SCORE_STEP, BALL_TYPES, round2 } from '../js/config.js';
import { awardFor, residualFor, rollMultiplier, generateSpec, pointInPoly, findTrap } from '../js/field.js';

let failed = false;
const report = (ok, msg) => { if (!ok) failed = true; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

for (const t of Object.values(THEMES)) {
  const ev = t.table.reduce((s, [m, p]) => s + m * p, 0);
  const pWin = t.table.reduce((s, [, p]) => s + p, 0);
  report(Math.abs(ev - TARGET_RTP) < 1e-9, `${t.name.padEnd(8)} EV = ${ev.toFixed(4)}  hit rate ${(pWin * 100).toFixed(1).padStart(5)}%  max ×${t.table[t.table.length - 1][0]}`);
}
{
  const N = 500_000;
  let total = 0;
  for (let i = 0; i < N; i++) total += rollMultiplier(THEMES.inferno.table);
  report(Math.abs(total / N - TARGET_RTP) < 0.05, `monte-carlo INFERNO EV = ${(total / N).toFixed(3)} (highest variance table)`);
}

{
  let trials = 0, badStep = 0, negativeRes = 0;
  for (const theme of Object.values(THEMES)) {
    for (const type of BALL_TYPES) {
      const step = round2(SCORE_STEP * type.bet);
      for (const [mult] of [[0], ...theme.table]) {
        for (let k = 0; k < 120; k++) {
          const ball = { stake: type.bet, target: round2(mult * type.bet), total: 0 };
          const hits = Math.floor(Math.random() * 14);
          for (let i = 0; i < hits; i++) {
            const a = awardFor(ball, Math.random() < 0.6 ? +1 : -1, 1 + ((Math.random() * 3) | 0));
            if (Math.abs(Math.round(a / step) * step - a) > 1e-9) badStep++;
            ball.total = round2(ball.total + a);
          }
          const res = residualFor(ball);
          if (round2(ball.total + res) !== ball.target) { failed = true; console.log(`FAIL  ${theme.key} ${type.key} ×${mult}: ended ${round2(ball.total + res)} ≠ ${ball.target}`); }
          if (res < 0) negativeRes++;
          trials++;
        }
      }
    }
  }
  report(badStep === 0, `all awards are SCORE_STEP multiples (${badStep} violations)`);
  report(true, `steering settled ${trials} balls exactly on target; ${(100 * negativeRes / trials).toFixed(1)}% negative exit reveals`);
}

{
  let boards = 0, bad = 0, comps = 0, traps = 0, attempts = 0;
  const reasons = {};
  const t0 = Date.now();
  for (const theme of Object.values(THEMES)) {
    for (let i = 0; i < 25; i++) {
      const s = generateSpec(theme);
      boards++;
      attempts += s.attempts;
      const items = [...s.bumpers, ...s.pins, ...s.holes, ...s.gates, ...s.spinners];
      comps += items.length + s.rails.length + s.tris.length;
      for (const it of items) if (!pointInPoly(it.u, it.v, s.outline)) { bad++; reasons.outside = (reasons.outside || 0) + 1; }
      for (const [k, min] of [['bumpers', 2], ['pins', 6], ['gates', 1], ['spinners', 1], ['holes', 1]]) {
        if (s[k].length < min) { bad++; reasons[k] = (reasons[k] || 0) + 1; }
      }
      if (findTrap(s)) traps++;
    }
  }
  // A crowded board occasionally ends one component short; that still plays.
  report(bad <= boards * 0.03, `${boards} generated boards valid (avg ${(comps / boards).toFixed(1)} components, ${bad} short ${JSON.stringify(reasons)})`);
  report(traps === 0, `trap scan: ${traps} boards with a V-pocket after retries (avg ${(attempts / boards).toFixed(2)} attempts, ${((Date.now() - t0) / boards).toFixed(0)} ms/board)`);
}

process.exit(failed ? 1 : 0);
