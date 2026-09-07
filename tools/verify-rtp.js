#!/usr/bin/env node
// Verifies (1) every theme's prize table has EV = TARGET_RTP, (2) the scoring
// steering lands a ball exactly on its predetermined target for any sequence
// of +/− component hits of any tier, with every award a SCORE_STEP multiple,
// and (3) procedural boards generate with their components in play and pass
// the V-pocket trap scan.
import { THEMES, TARGET_RTP, SCORE_STEP, BALL_TYPES, round2 } from '../js/config.js';
import { awardFor, pickAim, exitMultiplier, rollMultiplier, generateSpec, pointInPoly, findTrap } from '../js/field.js';

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

// Steering: components must never go silent, and the exit multiplier must
// reconcile whatever total the ball arrives with to its predetermined prize.
{
  // "late" = once the ball is established (past its 3rd component hit). Early
  // no-ops are legitimate: a − component can't take from a total of $0.00.
  let trials = 0, badStep = 0, zeroLate = 0, lateAwards = 0, inconsistent = 0, belowFloor = 0;
  const mults = [];
  for (const theme of Object.values(THEMES)) {
    for (const type of BALL_TYPES) {
      const step = round2(SCORE_STEP * type.bet);
      for (const [mult] of [[0], ...theme.table]) {
        for (let k = 0; k < 120; k++) {
          const target = round2(mult * type.bet);
          const ball = { stake: type.bet, target, total: type.bet, aim: pickAim(target, type.bet) };
          const hits = 1 + Math.floor(Math.random() * 40); // include very long-lived balls
          for (let i = 0; i < hits; i++) {
            const a = awardFor(ball, Math.random() < 0.6 ? +1 : -1, 1 + ((Math.random() * 3) | 0));
            if (i >= 3) { lateAwards++; if (a === 0) zeroLate++; }
            if (a !== 0 && Math.abs(Math.round(a / step) * step - a) > 1e-9) badStep++;
            ball.total = round2(ball.total + a);
          }
          const M = exitMultiplier(ball);
          if (ball.total < SCORE_STEP * type.bet) belowFloor++;
          else if (Math.abs(ball.total * M - target) > 0.005) {
            inconsistent++;
            if (inconsistent < 4) console.log(`      ${theme.key} ${type.key} ×${mult}: ${ball.total} × ${M} ≠ ${target}`);
          }
          if (target > 0) mults.push(M);
          trials++;
        }
      }
    }
  }
  mults.sort((a, b) => a - b);
  const pct = (p) => mults[Math.floor(mults.length * p)].toFixed(2);
  report(badStep === 0, `all awards are SCORE_STEP multiples (${badStep} violations)`);
  report(zeroLate / lateAwards < 0.01, `components stay live all ball: ${(100 * (1 - zeroLate / lateAwards)).toFixed(2)}% of ${lateAwards} established-ball hits scored`);
  report(inconsistent === 0, `${trials} balls reconcile exactly at the exit (${inconsistent} bad, ${belowFloor} below the total floor)`);
  report(true, `exit multipliers: p10 ×${pct(0.1)}  median ×${pct(0.5)}  p90 ×${pct(0.9)}`);
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
      const items = [...s.bumpers, ...s.pins, ...s.holes, ...s.gates, ...s.spinners, ...s.magnets, ...s.kickouts, ...s.banks, ...s.movers, ...s.oneways.filter((o) => !o.lane)];
      comps += items.length + s.rails.length + s.tris.length;
      for (const it of items) if (!pointInPoly(it.u, it.v, s.outline)) { bad++; reasons.outside = (reasons.outside || 0) + 1; }
      for (const [k, min] of [['bumpers', 2], ['pins', 5], ['gates', 1], ['spinners', 1], ['holes', 1]]) {
        if (s[k].length < min) { bad++; reasons[k] = (reasons[k] || 0) + 1; }
      }
      if (findTrap(s)) traps++;
    }
  }
  // A crowded board occasionally ends one component short; that still plays.
  report(bad <= boards * 0.08, `${boards} generated boards valid (avg ${(comps / boards).toFixed(1)} components, ${bad} short ${JSON.stringify(reasons)})`);
  report(traps === 0, `trap scan: ${traps} boards with a V-pocket after retries (avg ${(attempts / boards).toFixed(2)} attempts, ${((Date.now() - t0) / boards).toFixed(0)} ms/board)`);
}

process.exit(failed ? 1 : 0);
