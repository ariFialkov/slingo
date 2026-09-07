// Slingo — the launch planner (module worker).
//
// For a machine at a given screen geometry, simulate the deterministic
// physics for many launch powers and seeds and report, for each, the ordered
// fixed hits the ball would collect before it settles. The main thread picks,
// at launch, the candidate nearest the player's pull whose hits add up to the
// prize drawn for that ball. Results stream back in coverage-first order so a
// launch can use whatever is ready.
import { MACHINES, buildMachine, machineProfile } from './machines.js';
import { realize, hitFraction } from './field.js';
import { createWorld, simulateLaunch } from './physics.js';

const POWERS = 64, SEEDS = 4, BATCH = 16;

// van der Corput order: coarse coverage of the power range first
function vdc(i) { let r = 0, d = 0.5; for (; i > 0; i = Math.floor(i / 2), d /= 2) if (i & 1) r += d; return r; }

let current = null; // {id, cancelled}
self.onmessage = (e) => {
  const req = e.data;
  if (req.type !== 'plan') return;
  if (current) current.cancelled = true;
  const job = { id: req.id, cancelled: false };
  current = job;
  const m = MACHINES.find((mm) => mm.id === req.machineId);
  if (!m) return;
  const spec = buildMachine(m);
  const { x0, y0, w, h } = req.rect;
  const board = realize(spec, x0, y0, w, h);
  const world = createWorld(board, machineProfile(m));
  const lo = 0.26, hi = 1.0;
  let i = 0;
  const step = () => {
    if (job.cancelled) return;
    const out = [];
    for (let k = 0; k < BATCH && i < POWERS * SEEDS; k++, i++) {
      const pi = Math.floor(i / SEEDS), si = i % SEEDS;
      const p = lo + (hi - lo) * vdc(pi + 1);
      const seed = 1000 + pi * 97 + si * 7919;
      const r = simulateLaunch(world, p, seed, hitFraction);
      out.push({ p: r.p, seed: r.seed, hits: r.hits, life: r.life, settled: r.settled });
    }
    self.postMessage({ type: 'cands', id: job.id, cands: out, done: i >= POWERS * SEEDS });
    if (i < POWERS * SEEDS) setTimeout(step, 0);
  };
  step();
};
