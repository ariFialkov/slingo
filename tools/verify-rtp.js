#!/usr/bin/env node
// Verifies (1) every risk profile's prize table has EV = TARGET_RTP, (2) the
// scoring steering keeps components live for the whole ball and the exit
// reconciles any total exactly to the predetermined prize, and (3) all nine
// hand-built machines pass the layout audit (inside the cabinet, no overlaps)
// and the V-pocket trap scan at every field aspect the app can show.
import { PROFILES, TARGET_RTP, SCORE_STEP, BALL_TYPES, round2 } from '../js/config.js';
import { awardFor, pickAim, exitMultiplier, rollMultiplier, findTrap, auditSpec } from '../js/field.js';
import { MACHINES, buildMachine, allowedTypes, buyIn } from '../js/machines.js';

let failed = false;
const report = (ok, msg) => { if (!ok) failed = true; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

for (const [key, t] of Object.entries(PROFILES)) {
  const ev = t.table.reduce((s, [m, p]) => s + m * p, 0);
  const pWin = t.table.reduce((s, [, p]) => s + p, 0);
  report(Math.abs(ev - TARGET_RTP) < 1e-9, `${t.name.padEnd(9)} EV = ${ev.toFixed(4)}  hit rate ${(pWin * 100).toFixed(1).padStart(5)}%  max ×${t.table[t.table.length - 1][0]}`);
}
{
  const N = 500_000;
  let total = 0;
  for (let i = 0; i < N; i++) total += rollMultiplier(PROFILES.lucky.table);
  report(Math.abs(total / N - TARGET_RTP) < 0.05, `monte-carlo LUCKY 7 EV = ${(total / N).toFixed(3)} (highest variance table)`);
}

// Steering: components must never go silent, and the exit multiplier must
// reconcile whatever total the ball arrives with to its predetermined prize.
{
  let trials = 0, badStep = 0, zeroLate = 0, lateAwards = 0, inconsistent = 0, belowFloor = 0;
  const mults = [];
  for (const [key, prof] of Object.entries(PROFILES)) {
    for (const type of BALL_TYPES) {
      const step = round2(SCORE_STEP * type.bet);
      for (const [mult] of [[0], ...prof.table]) {
        for (let k = 0; k < 120; k++) {
          const target = round2(mult * type.bet);
          const ball = { stake: type.bet, target, total: type.bet, aim: pickAim(target, type.bet) };
          const hits = 1 + Math.floor(Math.random() * 40);
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
            if (inconsistent < 4) console.log(`      ${key} ${type.key} ×${mult}: ${ball.total} × ${M} ≠ ${target}`);
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

// Machines: audit + trap scan at the aspects the layout can produce (1.5–1.72).
{
  const t0 = Date.now();
  let clean = 0;
  for (const m of MACHINES) {
    const s = buildMachine(m);
    const probs = auditSpec(s);
    const traps = [1.5, 1.6, 1.72].map((A) => findTrap(s, A)).filter(Boolean);
    const comps = s.bumpers.length + s.pins.length + s.holes.length + s.gates.length + s.spinners.length + s.magnets.length + s.kickouts.length + s.banks.length + s.movers.length + s.oneways.length - 1 + s.rails.length + s.tris.length;
    const ok = probs.length === 0 && traps.length === 0;
    if (ok) clean++;
    const types = allowedTypes(m).map((t) => '$' + t.bet).join('/');
    report(ok, `${m.name.padEnd(16)} ${'★'.repeat(m.stars).padEnd(5)} ${PROFILES[m.profile].name.padEnd(9)} bets ${types.padEnd(14)} buy-in $${buyIn(m)}  ${comps} components`);
    for (const p of probs) console.log(`        audit: ${p}`);
    for (const t of traps) console.log(`        trap at (${t.u.toFixed(3)}, ${t.v.toFixed(3)})`);
  }
  report(clean === MACHINES.length, `${clean}/${MACHINES.length} machines clean (audit + trap scan at 3 aspects, ${Date.now() - t0} ms)`);
}

process.exit(failed ? 1 : 0);
