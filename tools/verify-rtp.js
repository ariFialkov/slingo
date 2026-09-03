#!/usr/bin/env node
// Verifies (1) the prize table's EV equals TARGET_RTP and (2) the scoring
// steering always lands a ball exactly on its predetermined target, for any
// sequence of +/− component hits, with every award a clean SCORE_STEP multiple.
import { PRIZE_TABLE, TARGET_RTP, SCORE_STEP, BALL_TYPES, round2 } from '../js/config.js';
import { awardFor, residualFor, rollMultiplier } from '../js/field.js';

let failed = false;
const report = (ok, msg) => { if (!ok) failed = true; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

// 1. Prize table
const ev = PRIZE_TABLE.reduce((s, [m, p]) => s + m * p, 0);
const pWin = PRIZE_TABLE.reduce((s, [, p]) => s + p, 0);
report(Math.abs(ev - TARGET_RTP) < 1e-9, `prize table EV = ${ev.toFixed(4)} (target ${TARGET_RTP}), hit rate ${(pWin * 100).toFixed(1)}%`);

// Monte Carlo on rollMultiplier
{
  const N = 2_000_000;
  let total = 0;
  for (let i = 0; i < N; i++) total += rollMultiplier();
  report(Math.abs(total / N - TARGET_RTP) < 0.01, `monte-carlo rollMultiplier EV = ${(total / N).toFixed(4)}`);
}

// 2. Steering: random hit sequences must settle exactly on target
{
  let worstAbsRes = 0, negativeRes = 0, trials = 0, badStep = 0;
  for (const type of BALL_TYPES) {
    const step = round2(SCORE_STEP * type.bet);
    for (const [mult] of [[0], ...PRIZE_TABLE]) {
      for (let k = 0; k < 400; k++) {
        const ball = { stake: type.bet, target: round2(mult * type.bet), total: 0 };
        const hits = Math.floor(Math.random() * 12);
        for (let i = 0; i < hits; i++) {
          const sign = Math.random() < 0.6 ? +1 : -1;
          const a = awardFor(ball, sign);
          if (Math.abs(Math.round(a / step) * step - a) > 1e-9) badStep++;
          ball.total = round2(ball.total + a);
        }
        const res = residualFor(ball);
        const final = round2(ball.total + res);
        if (final !== ball.target) { failed = true; console.log(`FAIL  ${type.key} ×${mult}: ended ${final} ≠ ${ball.target}`); }
        worstAbsRes = Math.max(worstAbsRes, Math.abs(res) / Math.max(type.bet, 1));
        if (res < 0) negativeRes++;
        trials++;
      }
    }
  }
  report(badStep === 0, `all awards are SCORE_STEP multiples (${badStep} violations)`);
  report(true, `steering settled ${trials} balls exactly on target; max |residual| = ${worstAbsRes.toFixed(2)}× stake; ${(100 * negativeRes / trials).toFixed(1)}% negative pocket reveals`);
}

process.exit(failed ? 1 : 0);
