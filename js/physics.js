// Slingo — the deterministic pinball engine.
//
// Pure and headless: the same code runs the live table and the launch
// planner (in a worker). Everything random inside the physics comes from the
// ball's own seeded generator, time is the world's fixed-step clock, and the
// step is fixed, so a ball launched with the same power and seed into the
// same world follows exactly the same path. Scoring and presentation happen
// outside, through hooks.
import { PHYS } from './config.js';
import { flipperSegment } from './field.js';

export const SUBSTEP = 1 / 240;   // s
export const STEP_MS = 1000 / 240;

// mulberry32: tiny, fast, deterministic
export function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createWorld(board, profile) {
  return { board, profile, time: 0, moverT0: 0 };
}
export const phys = (world, k) => (world.profile.physics && world.profile.physics[k] !== undefined ? world.profile.physics[k] : PHYS[k]);

// Speed that just carries a ball from the slot to the lane flap.
export function clearSpeed(world) {
  const F = world.board;
  const rise = F.lane.seatY - F.lane.flapY + PHYS.ballRadius * F.w;
  return Math.sqrt(2 * phys(world, 'gravity') * F.h * rise);
}
// Launch speed is a pure function of the charge: below the threshold the ball
// always falls back to the slot; at or above it the ball always reaches the field.
export function launchSpeed(world, p) {
  const { threshold: th, weak, strong } = PHYS.launch;
  const v = clearSpeed(world);
  return p < th
    ? v * (weak[0] + (weak[1] - weak[0]) * (p / th))
    : v * (strong[0] + (strong[1] - strong[0]) * ((p - th) / (1 - th)));
}

// A fresh ball sitting on the plunger.
export function newBall(world, seed, extra = {}) {
  const F = world.board;
  const r = PHYS.ballRadius * F.w;
  return {
    x: F.lane.x, y: F.lane.seatY - r, vx: 0, vy: 0, r, prevY: 0,
    born: world.time, cd: new Map(), slowSince: 0, dying: null, hits: 0, flips: world.profile.flips,
    lastComp: null, repeat: 0, ax: F.lane.x, ay: F.lane.seatY - r, at: world.time, popT: -1e9,
    sides: new Map(), gcd: new Map(), seated: false, held: null, charged: false,
    seed, rng: makeRng(seed), ...extra,
  };
}
// Fire a ball from the slot at charge p.
export function fire(world, b, p) {
  const F = world.board;
  b.seated = false;
  b.x = F.lane.x; b.y = F.lane.seatY - b.r;
  b.vx = 0; b.vy = -launchSpeed(world, p);
  b.born = world.time; b.ax = b.x; b.ay = b.y; b.at = world.time;
}

// ---------------------------------------------------------------------------
// One fixed step of the whole world
// ---------------------------------------------------------------------------
export function stepWorld(world, balls, hooks) {
  const F = world.board, h = SUBSTEP;
  world.time += STEP_MS;
  const now = world.time;
  const mt = (now - world.moverT0) / 1000;
  for (const mv of F.movers) { const s = Math.sin(mt * (2 * Math.PI / mv.period) + mv.phase); mv.x = mv.cx + mv.dx * mv.amp * s; mv.y = mv.cy + mv.dy * mv.amp * s; }
  for (const b of balls) if (!b.dying && !b.seated && !b.held) integrate(world, b, h, hooks);
  for (const b of balls) if (!b.dying && !b.seated) checkSensors(world, b, hooks);
  updateSpinners(world, balls, h, hooks);
}

export function flipperAngle(world, f) {
  const t = world.time - f.flipT;
  if (t < 0 || t > 380) return f.rest;
  if (t < 110) return f.rest + (f.flip - f.rest) * (t / 110);
  if (t < 200) return f.flip;
  return f.flip + (f.rest - f.flip) * ((t - 200) / 180);
}

// A scoring contact: cooldown per component, and a ball rattling on one
// component is kicked loose instead of scoring it again.
function hit(world, b, comp, sign, tier, x, y, hooks) {
  if (!sign) { comp.flashT = world.time; return; }
  const until = b.cd.get(comp) || 0;
  if (world.time < until) return;
  b.cd.set(comp, world.time + 160);
  comp.flashT = world.time;
  if (!comp.posts) {
    if (comp === b.lastComp) b.repeat++; else { b.lastComp = comp; b.repeat = 0; }
  }
  if (b.repeat >= 4) {
    b.vx += (b.rng() - 0.5) * 0.6 * world.board.h;
    b.vy -= 0.25 * world.board.h;
    b.repeat = 0;
    return;
  }
  b.hits++;
  hooks.hit(b, comp, sign, tier, x, y);
}

function integrate(world, b, h, hooks) {
  const F = world.board;
  const age = world.time - b.born;
  let g = phys(world, 'gravity') * F.h;
  if (age > PHYS.softLifeMs) g *= 1 + (age - PHYS.softLifeMs) / 3000;
  b.vy += g * h;
  for (const m of F.magnets) {
    const dx = m.x - b.x, dy = m.y - b.y, d = Math.hypot(dx, dy);
    if (d < m.range && d > 1e-6) { const a = 0.5 * F.h * (1 - d / m.range); b.vx += (dx / d) * a * h; b.vy += (dy / d) * a * h; }
  }
  const drag = Math.max(0, 1 - phys(world, 'drag') * h);
  b.vx *= drag; b.vy *= drag;
  const vmax = PHYS.maxSpeed * F.h;
  const sp = Math.hypot(b.vx, b.vy);
  if (sp > vmax) { b.vx *= vmax / sp; b.vy *= vmax / sp; }
  b.prevY = b.y;
  b.x += b.vx * h;
  b.y += b.vy * h;

  for (const s of F.walls) collideSegment(b, s, PHYS.restitutionWall);
  for (const g of F.gates) for (const gd of g.guides) collideSegment(b, gd, PHYS.restitutionWall);
  for (const sp2 of F.spinners) for (const post of sp2.posts) collideCircle(b, post, PHYS.restitutionPin, 0);
  for (const o of F.oneways) {
    if ((b.x - o.x) * o.nx + (b.y - o.y) * o.ny > 0) collideSegment(b, o.seg, 0.4);
  }
  for (const bk of F.banks) {
    for (const t of bk.targets) {
      if (t.down) continue;
      if (collideSegment(b, t.seg, 0.5)) {
        t.down = true; t.flashT = world.time;
        hit(world, b, t, bk.sign, bk.tier, t.x, t.y - 14, hooks);
        if (bk.targets.every((tt) => tt.down)) {
          hit(world, b, bk, +1, 4, bk.x, bk.y - 26, hooks);
          bk.resetAt = world.time + 1600;
          hooks.sfx('bonus');
        }
      }
    }
  }
  for (const s of F.rails) {
    if (collideSegment(b, s, PHYS.restitutionWall)) hit(world, b, s, s.sign, s.tier, (s.a.x + s.b.x) / 2, (s.a.y + s.b.y) / 2 - 14, hooks);
  }
  for (const t of F.tris) {
    let hitT = false;
    for (const e of t.edges) if (collideSegment(b, e, 0.7, 0.45 * F.h, t)) hitT = true;
    if (hitT) hit(world, b, t, t.sign, t.tier, t.cx, t.cy - 18, hooks);
  }
  for (const p of F.pins) {
    if (collideCircle(b, p, PHYS.restitutionPin, 0)) hit(world, b, p, p.sign, p.tier, p.x, p.y - p.r - 10, hooks);
  }
  for (const bp of F.bumpers) {
    if (collideCircle(b, bp, PHYS.restitutionBumper, PHYS.bumperKick * F.h)) {
      hit(world, b, bp, bp.sign, bp.tier, bp.x, bp.y - bp.r - 10, hooks);
      hooks.shake(bp.tier === 3 ? 0.25 : 0.12);
    }
  }
  for (const mv of F.movers) {
    if (collideCircle(b, mv, PHYS.restitutionBumper, PHYS.bumperKick * F.h)) { hit(world, b, mv, mv.sign, mv.tier, mv.x, mv.y - mv.r - 10, hooks); hooks.shake(0.12); }
  }
  for (const m of F.magnets) {
    if (collideCircle(b, m, 0.5, 0)) hit(world, b, m, m.sign, m.tier, m.x, m.y - m.r - 12, hooks);
  }
  for (const f of F.flippers) { f.angle = flipperAngle(world, f); collideSegment(b, flipperSegment(f), 0.5); }
  if (b.x < F.x0 + b.r) { b.x = F.x0 + b.r; b.vx = Math.abs(b.vx) * 0.5; }
  if (b.x > F.x0 + F.w - b.r) { b.x = F.x0 + F.w - b.r; b.vx = -Math.abs(b.vx) * 0.5; }
  if (b.y < F.y0 + b.r) { b.y = F.y0 + b.r; b.vy = Math.abs(b.vy) * 0.5; }

  const inLane = b.x > F.lane.left && b.y > F.lane.flapY;
  if (Math.hypot(b.vx, b.vy) < 0.03 * F.h && !inLane) {
    if (!b.slowSince) b.slowSince = world.time;
    else if (world.time - b.slowSince > 450) { b.vx += (b.rng() - 0.5) * 0.4 * F.h; b.vy -= 0.15 * F.h; b.slowSince = 0; }
  } else b.slowSince = 0;
  if (Math.hypot(b.x - b.ax, b.y - b.ay) > b.r * 5) { b.ax = b.x; b.ay = b.y; b.at = world.time; }
  else if (world.time - b.at > 2500 && !inLane) {
    b.vx = (b.x < F.x0 + F.w / 2 ? 1 : -1) * (0.3 + b.rng() * 0.3) * F.h;
    b.vy = -(0.5 + b.rng() * 0.3) * F.h;
    b.at = world.time;
  }
}

function collideSegment(b, s, e, kick = 0, kickAway = null) {
  const abx = s.b.x - s.a.x, aby = s.b.y - s.a.y;
  const len2 = abx * abx + aby * aby || 1e-9;
  let t = ((b.x - s.a.x) * abx + (b.y - s.a.y) * aby) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = s.a.x + abx * t, cy = s.a.y + aby * t;
  let nx = b.x - cx, ny = b.y - cy;
  const d = Math.hypot(nx, ny);
  if (d >= b.r) return false;
  if (d < 1e-6) { nx = -aby; ny = abx; const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l; }
  else { nx /= d; ny /= d; }
  const pen = b.r - d;
  b.x += nx * pen; b.y += ny * pen;
  const vn = b.vx * nx + b.vy * ny;
  if (vn < 0) {
    b.vx -= (1 + e) * vn * nx;
    b.vy -= (1 + e) * vn * ny;
    const tx = -ny, ty = nx;
    const vt = b.vx * tx + b.vy * ty;
    b.vx -= vt * 0.04 * tx; b.vy -= vt * 0.04 * ty;
  }
  if (kick) {
    let kx = nx, ky = ny;
    if (kickAway) { kx = b.x - kickAway.cx; ky = b.y - kickAway.cy; const l = Math.hypot(kx, ky) || 1; kx /= l; ky /= l; }
    b.vx += kx * kick; b.vy += ky * kick;
  }
  return true;
}

function collideCircle(b, c, e, kick) {
  let nx = b.x - c.x, ny = b.y - c.y;
  const d = Math.hypot(nx, ny);
  const rr2 = b.r + c.r;
  if (d >= rr2) return false;
  if (d < 1e-6) { nx = 0; ny = -1; } else { nx /= d; ny /= d; }
  const pen = rr2 - d;
  b.x += nx * pen; b.y += ny * pen;
  const vn = b.vx * nx + b.vy * ny;
  if (vn < 0) { b.vx -= (1 + e) * vn * nx; b.vy -= (1 + e) * vn * ny; }
  if (kick) { b.vx += nx * kick; b.vy += ny * kick; }
  return true;
}

const sideOf = (b, s) => Math.sign((s.b.x - s.a.x) * (b.y - s.a.y) - (s.b.y - s.a.y) * (b.x - s.a.x));
function withinSpan(b, s) {
  const abx = s.b.x - s.a.x, aby = s.b.y - s.a.y;
  const t = ((b.x - s.a.x) * abx + (b.y - s.a.y) * aby) / (abx * abx + aby * aby || 1e-9);
  return t >= 0 && t <= 1;
}
function crossed(world, b, comp, sensor, cooldown) {
  const side = sideOf(b, sensor);
  const prev = b.sides.get(comp);
  b.sides.set(comp, side);
  if (prev === undefined || prev === side || side === 0 || !withinSpan(b, sensor)) return false;
  if (world.time < (b.gcd.get(comp) || 0)) return false;
  b.gcd.set(comp, world.time + cooldown);
  return true;
}
const ageDecay = (world, b, span) => { const over = world.time - b.born - PHYS.softLifeMs; return over > 0 ? 1 / (1 + over / span) : 1; };

function gateCross(world, b, g, hooks) {
  if (!crossed(world, b, g, g.sensor, 500)) return;
  const F = world.board;
  hit(world, b, g, g.sign, g.tier, g.x - g.ax * (g.L + 12), g.y - g.ay * (g.L + 12), hooks);
  const sp = Math.hypot(b.vx, b.vy);
  let ax = g.ax, ay = g.ay;
  if (g.dir) { ax *= g.dir; ay *= g.dir; }
  else if (b.vx * ax + b.vy * ay < 0) { ax = -ax; ay = -ay; }
  if (g.kind === 'boost') {
    const k = ageDecay(world, b, 4000);
    const s = Math.max(sp * 1.6 * k, (g.kicker ? 1.4 : 0.9) * F.h * (g.kicker ? Math.max(0.78, k) : k));
    b.vx = ax * s; b.vy = ay * s; hooks.sfx('fire', 0.6); if (g.kicker) hooks.shake(0.3);
  } else if (g.kind === 'brake') { b.vx = ax * sp * 0.35; b.vy = ay * sp * 0.35; hooks.sfx('miss'); }
  else if (g.kind === 'warp' && g.twin !== undefined) {
    const t = F.gates[g.twin];
    hooks.fx({ type: 'puff', x: b.x, y: b.y, dur: 400 });
    b.x = t.x + t.ax * (t.L + b.r * 2); b.y = t.y + t.ay * (t.L + b.r * 2);
    const s = Math.max(sp * 0.8, 0.4 * F.h);
    b.vx = t.ax * s; b.vy = t.ay * s;
    b.sides.set(t, sideOf(b, t.sensor)); b.gcd.set(t, world.time + 600);
    t.flashT = world.time; b.ax = b.x; b.ay = b.y; b.at = world.time;
    hooks.fx({ type: 'puff', x: b.x, y: b.y, dur: 400 });
    hooks.sfx('flip');
  }
}
function spinnerCross(world, b, sp, hooks) {
  if (!crossed(world, b, sp, sp.sensor, 300)) return;
  const speed = Math.hypot(b.vx, b.vy);
  sp.omega = Math.max(10, Math.min(45, (speed / world.board.h) * 28)) * (sideOf(b, sp.sensor) > 0 ? 1 : -1);
  sp.owner = b; sp.revs = 0; sp.flashT = world.time;
  b.vx *= 0.72; b.vy *= 0.72;
  const jit = (b.rng() - 0.5) * 0.25, c = Math.cos(jit), s = Math.sin(jit);
  const vx = b.vx * c - b.vy * s, vy = b.vx * s + b.vy * c;
  b.vx = vx; b.vy = vy;
  hooks.sfx('led');
}
function onewayCross(world, b, o, hooks) {
  const side = (b.x - o.x) * o.nx + (b.y - o.y) * o.ny > 0 ? 1 : -1;
  const prev = b.sides.get(o);
  b.sides.set(o, side);
  if (prev === -1 && side === 1 && withinSpan(b, o.seg)) { o.flashT = world.time; if (o.sign) hit(world, b, o, o.sign, o.tier, o.x, o.y - 14, hooks); }
}
function updateSpinners(world, balls, dt, hooks) {
  const F = world.board;
  for (const sp of F.spinners) {
    if (Math.abs(sp.omega) < 0.3) { sp.omega = 0; continue; }
    const before = sp.rot;
    sp.rot += sp.omega * dt;
    sp.omega *= Math.exp(-1.4 * dt);
    if (Math.floor(before / (2 * Math.PI)) !== Math.floor(sp.rot / (2 * Math.PI)) && sp.revs < 5) {
      sp.revs++;
      const o = sp.owner;
      if (o && !o.dying && balls.includes(o)) { o.cd.delete(sp); hit(world, o, sp, sp.sign, sp.tier, sp.x, sp.y - 20, hooks); }
    }
  }
  for (const bk of F.banks) {
    if (bk.resetAt && world.time >= bk.resetAt) { bk.resetAt = 0; for (const t of bk.targets) { t.down = false; t.flashT = world.time; } hooks.sfx('flip'); }
  }
}

function checkSensors(world, b, hooks) {
  const F = world.board;
  if (!b.charged && !b.demo && b.y < F.lane.flapY) { b.charged = true; hooks.charge(b); }
  if (b.held) {
    if (world.time >= b.held.until) {
      const k = b.held.kick;
      const e = 0.65 * F.h * Math.max(0.5, ageDecay(world, b, 4000));
      b.x = k.ex; b.y = k.ey; b.vx = k.dir[0] * e; b.vy = k.dir[1] * e;
      b.held = null; k.ejectT = world.time; b.ax = b.x; b.ay = b.y; b.at = world.time;
      hooks.fx({ type: 'puff', x: b.x, y: b.y, dur: 400 });
      hooks.sfx('step');
    }
    return;
  }
  for (const g of F.gates) gateCross(world, b, g, hooks);
  for (const sp of F.spinners) spinnerCross(world, b, sp, hooks);
  for (const o of F.oneways) onewayCross(world, b, o, hooks);
  for (const k of F.kickouts) {
    if (Math.hypot(b.x - k.x, b.y - k.y) < k.r * 0.65) {
      hit(world, b, k, k.sign, k.tier, k.x, k.y - k.r - 12, hooks);
      b.held = { until: world.time + 700, kick: k };
      b.vx = b.vy = 0; b.x = k.x; b.y = k.y;
      k.flashT = world.time;
      hooks.sfx('fill');
      return;
    }
  }
  for (const hole of F.holes) {
    if (Math.hypot(b.x - hole.x, b.y - hole.y) < hole.r * 0.62) { hooks.settle(b, hole.x, hole.y, hole); return; }
  }
  for (const f of F.flippers) {
    const reach = f.len * 0.95;
    const within = f.dir > 0 ? b.x > f.px - b.r && b.x < f.px + reach : b.x < f.px + b.r && b.x > f.px - reach;
    if (within && b.vy > 0 && b.y > f.py - F.h * 0.085 && b.y < f.py + F.h * 0.02 && b.flips > 0 && world.time - f.flipT > 400) {
      f.flipT = world.time;
      b.flips--;
      const k = PHYS.flipperKick * F.h;
      b.vx = f.dir * k * (0.25 + b.rng() * 0.3);
      b.vy = -k * (0.85 + b.rng() * 0.25);
      b.y = Math.min(b.y, f.py - F.h * 0.02);
      hooks.sfx('step'); hooks.shake(0.2);
      hooks.fx({ type: 'puff', x: b.x, y: b.y, dur: 300 });
    }
  }
  // A charge too weak to clear the flap drops the ball back into the slot.
  if (!b.charged && !b.demo && b.x > F.lane.left && b.vy >= 0 && b.y >= F.lane.seatY - b.r * 1.2) {
    if (hooks.seat(b)) { b.seated = true; b.vx = b.vy = 0; b.x = F.lane.x; b.y = F.lane.seatY - b.r; }
    return;
  }
  if (b.y > F.drainY && b.x < F.lane.left) { hooks.settle(b, (F.exit.x0 + F.exit.x1) / 2, F.drainY - 14, F.exit); return; }
  if (world.time - b.born > PHYS.hardLifeMs) hooks.settle(b, (F.exit.x0 + F.exit.x1) / 2, F.drainY - 14, F.exit);
}

// Reset the world's mutable fixtures to the clean state every plan assumes.
export function resetFixtures(world) {
  const F = world.board;
  for (const bk of F.banks) { bk.resetAt = 0; for (const t of bk.targets) t.down = false; }
  for (const sp of F.spinners) { sp.omega = 0; sp.rot = 0; sp.revs = 0; sp.owner = null; }
  for (const f of F.flippers) { f.flipT = -1e9; f.angle = f.rest; }
  for (const k of F.kickouts) k.ejectT = 0;
}

// ---------------------------------------------------------------------------
// Headless simulation of one launch: the ordered list of scoring hits
// (as fractions of the stake, signed) until the ball settles.
// ---------------------------------------------------------------------------
export function simulateLaunch(world, p, seed, values, maxMs = 16000) {
  resetFixtures(world);
  world.time = 0; world.moverT0 = 0;
  const b = newBall(world, seed);
  fire(world, b, p);
  const hits = [];
  let settled = false;
  const noop = () => {};
  const hooks = {
    hit: (ball, comp, sign, tier) => hits.push(sign * values(comp, tier, sign)),
    settle: () => { settled = true; },
    charge: noop, seat: () => false, fx: noop, sfx: noop, shake: noop,
  };
  const balls = [b];
  while (!settled && world.time < maxMs) stepWorld(world, balls, hooks);
  return { p, seed, hits, life: world.time, settled };
}
