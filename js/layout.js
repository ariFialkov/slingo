// Slingo — the layout kit: composable component groups for hand-built
// machines. Everything is in normalised coordinates (u,v ∈ 0..1, y down); the
// launch lane is always down the right side (u 0.90–0.98), flippers at 0.3/0.7.
//
// Real tables are "ordered chaos": components come in pockets (a field of pins,
// a spinner maze, twin lanes down a curve, a one-way gate into a U-turn kicker,
// an intersection with a hole in the middle) arranged so lanes and paths run
// between them. These builders emit those pockets into a spec.

export const LANE_X = 0.9;
export const LANE_CX = 0.94;
export const ASPECT = 1.6; // typical field h/w — used to keep shapes round on screen
const V = (du) => du / ASPECT; // convert a u-distance into the same on-screen distance in v

// ---------------------------------------------------------------------------
// Cabinet + fixtures every machine shares
// ---------------------------------------------------------------------------
export function newSpec(m) {
  const cab = { cl: 0.14, ch: 0.06, cr: 0.24, notch: { v: 0.42, d: 0.07, h: 0.06 }, bl: 0.83, br: 0.83, ...(m.cabinet || {}) };
  const spec = {
    id: m.id, walls: [], rails: [], tris: [], pins: [], bumpers: [], holes: [], gates: [], spinners: [],
    magnets: [], kickouts: [], banks: [], movers: [], oneways: [], flippers: [], decor: [], labels: [],
    plates: [], art: [], inserts: [], exempt: [], ramps: [], cab,
  };
  const laneFloor = 0.985;
  const pts = [[0.3, 1], [0.3, 0.965], [0.02, cab.bl]];
  if (cab.notch) pts.push([0.02, cab.notch.v + cab.notch.h], [0.02 + cab.notch.d, cab.notch.v], [0.02, cab.notch.v - cab.notch.h]);
  pts.push([0.02, 0.02 + cab.ch], [0.02 + cab.cl, 0.02], [0.98 - cab.cr, 0.02]);
  for (let i = 1; i <= 10; i++) {
    const a = -Math.PI / 2 + (Math.PI / 2) * (i / 10);
    pts.push([0.98 - cab.cr + cab.cr * Math.cos(a), 0.02 + cab.cr + cab.cr * Math.sin(a)]);
  }
  pts.push([0.98, laneFloor], [LANE_X, laneFloor], [LANE_X, cab.br], [0.7, 0.965], [0.7, 1]);
  spec.outline = pts;
  for (let i = 0; i < pts.length - 1; i++) spec.walls.push({ a: pts[i], b: pts[i + 1], neon: true });
  const laneTop = 0.02 + cab.cr + 0.02;
  spec.walls.push({ a: [LANE_X, laneTop], b: [LANE_X, cab.br], neon: true, divider: true });
  spec.lane = { top: laneTop, floor: laneFloor, seatV: 0.93, flapV: laneTop - 0.035 };
  spec.oneways.push({ u: 0.9325, v: spec.lane.flapV, angle: Math.PI + 0.35, lane: true, sign: 0, tier: 0 });
  spec.flippers.push({ pivot: [0.3, 0.965], len: 0.14, dir: +1, rest: 0.35, flip: -0.45 });
  spec.flippers.push({ pivot: [0.7, 0.965], len: 0.14, dir: -1, rest: 0.35, flip: -0.45 });
  spec.drainV = 0.985;
  spec.exit = { u0: 0.3, u1: 0.7 };
  spec.topClear = laneTop; // art/title region above this
  return spec;
}

// The classic slingshot pair above the flippers (always −).
export function slingshots(spec, sign = -1) {
  spec.tris.push({ pts: [[0.02, 0.69], [0.02, 0.82], [0.16, 0.8]], sign, tier: 1, sling: true });
  spec.tris.push({ pts: [[LANE_X, 0.66], [LANE_X, 0.79], [LANE_X - 0.13, 0.77]], sign, tier: 1, sling: true });
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------
export const pin = (spec, u, v, sign = 0, r = sign ? 0.013 : 0.011) => spec.pins.push({ u, v, r, sign, tier: 1 });
export const bumper = (spec, u, v, r, sign, label, kind = 'pop') => spec.bumpers.push({ u, v, r, sign, tier: kind === 'pop' ? 2 : 3, kind, label });
export const reactor = (spec, u, v, label = 'CORE', r = 0.058) => bumper(spec, u, v, r, +1, label, 'reactor');
export const bonusDisc = (spec, u, v, label = 'BONUS') => bumper(spec, u, v, 0.042, +1, label, 'bonus');
export const tri = (spec, pts, sign) => spec.tris.push({ pts, sign, tier: 2 });
export const rail = (spec, a, b, sign) => spec.rails.push({ a, b, sign, tier: 2 });
export const hole = (spec, u, v, kind = 'hole', label = '', r = 0.03) => spec.holes.push({ u, v, r, kind, label });
export const kickout = (spec, u, v, eu, ev, dir, label = 'KICK') => spec.kickouts.push({ u, v, r: 0.028, eu, ev, dir, sign: +1, tier: 2, label });
export const magnet = (spec, u, v, sign, label = 'MAGNET') => spec.magnets.push({ u, v, r: 0.026, range: 0.16, sign, tier: 2, label });
export const bank = (spec, u, v, angle = 0, label = 'TARGETS') => spec.banks.push({ u, v, angle, sign: +1, tier: 1, label });
export const mover = (spec, u, v, angle, amp, sign, period = 2.8, label = '') => spec.movers.push({ u, v, r: 0.034, amp, angle, period, sign, tier: 2, label });
export const gate = (spec, u, v, angle, kind, label = '', opts = {}) => spec.gates.push({ u, v, angle, kind, sign: +1, tier: 1, label, ...opts });
export const insert = (spec, u, v, kind = 'dot', color, angle = 0, r = 0.012) => spec.inserts.push({ u, v, kind, color, angle, r });
export const oneway = (spec, u, v, angle, label = 'ONE-WAY') => spec.oneways.push({ u, v, angle, sign: +1, tier: 1, label });
export const spinner = (spec, u, v, angle = 0, label = 'SPIN') => spec.spinners.push({ u, v, angle, sign: +1, tier: 1, label });
export const label = (spec, u, v, text, size = 0.03, style = {}) => spec.labels.push({ u, v, text, size, ...style });
export const art = (spec, item) => spec.art.push(item);
export const plate = (spec, u, v, w, h, ch = 0.03) => spec.plates.push({ u, v, w, h, ch });
// An exempt zone tells the trap scan that a resting spot here is fine: either
// a kicker sits on it and fires the ball out, or the zone is sealed off and a
// ball can never get in. Circle {u,v,r} or rect {u,v,w,h}.
export const exempt = (spec, zone) => spec.exempt.push(zone);

// Plain wall polylines (chrome wire or rubber). pts: [[u,v],...]
export function wall(spec, pts, style = 'chrome') {
  for (let i = 0; i < pts.length - 1; i++) spec.walls.push({ a: pts[i], b: pts[i + 1], style });
}
export function arcWall(spec, cu, cv, r, a0, a1, style = 'chrome', n = 16) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    pts.push([cu + r * Math.cos(a), cv + V(r * Math.sin(a))]);
  }
  wall(spec, pts, style);
  return pts;
}
export function curveWall(spec, p0, pc, p1, style = 'chrome', n = 14) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([(1 - t) * (1 - t) * p0[0] + 2 * (1 - t) * t * pc[0] + t * t * p1[0], (1 - t) * (1 - t) * p0[1] + 2 * (1 - t) * t * pc[1] + t * t * p1[1]]);
  }
  wall(spec, pts, style);
  return pts;
}
// Two links of the tapered lit ribbon look (the old orbit/swoosh): a curve wall
// the renderer draws as a ramp.
export function ramp(spec, pts, color) {
  for (let i = 0; i < pts.length - 1; i++) spec.walls.push({ a: pts[i], b: pts[i + 1], style: 'ramp', color });
  spec.ramps.push({ pts, color });
}
// A quadratic-curve ramp (wireform look).
export function curveRamp(spec, p0, pc, p1, color, n = 16) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([(1 - t) * (1 - t) * p0[0] + 2 * (1 - t) * t * pc[0] + t * t * p1[0], (1 - t) * (1 - t) * p0[1] + 2 * (1 - t) * t * pc[1] + t * t * p1[1]]);
  }
  ramp(spec, pts, color);
  return pts;
}

// ---------------------------------------------------------------------------
// Pockets / groups
// ---------------------------------------------------------------------------
// A field of pins in a staggered lattice. plus/minus = fraction of signed pins.
export function pinField(spec, { u, v, cols, rows, pitch = 0.08, plus = 0.4, minus = 0.15, stagger = true, r }) {
  let k = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const uu = u + col * pitch + (stagger && row % 2 ? pitch / 2 : 0);
      const vv = v + V(row * pitch * 0.9);
      const t = ((k * 7919) % 100) / 100; // deterministic spread of signs
      const sign = t < plus ? +1 : t < plus + minus ? -1 : 0;
      pin(spec, uu, vv, sign, r);
      k++;
    }
  }
}

// The classic three pop bumpers in a triangle.
// (spread ≥ 2r + ball diameter + margin so a ball never wedges between them)
export function bumperTriangle(spec, u, v, r = 0.042, spread = 0.135, signs = [+1, +1, -1], labels = ['', '', '']) {
  const pts = [[u, v - V(spread * 0.58)], [u - spread * 0.5, v + V(spread * 0.42)], [u + spread * 0.5, v + V(spread * 0.42)]];
  pts.forEach((p, i) => bumper(spec, p[0], p[1], r, signs[i], labels[i]));
}

// A danger zone: a − bumper flanked by − pins over hazard art, spaced so a
// ball always fits between the bumper and every pin.
export function dangerZone(spec, u, v, label = 'DANGER') {
  art(spec, { kind: 'hazard', u: u - 0.12, v: v - V(0.085), w: 0.24, h: V(0.17) });
  bumper(spec, u, v, 0.04, -1, label);
  pin(spec, u - 0.1, v - V(0.03), -1);
  pin(spec, u + 0.1, v - V(0.03), -1);
  pin(spec, u - 0.085, v + V(0.075), -1);
  pin(spec, u + 0.085, v + V(0.075), -1);
}

// A few spinners staggered into a little maze, with a post on the outside of
// each step so the ball zig-zags through.
export function spinnerMaze(spec, { u, v, n = 3, dx = 0.11, dy = 0.075, angle = 0.45 }) {
  for (let i = 0; i < n; i++) {
    const uu = u + (i % 2 ? dx : 0), vv = v + V(i * dy * 1.6);
    spinner(spec, uu, vv, i % 2 ? -angle : angle);
    if (i < n - 1) pin(spec, u + dx * 0.5 + (i % 2 ? dx : -dx) * 0.95, vv + V(dy * 0.8), 0, 0.011);
  }
}

// Twin lanes down a curve on the left: two guide curves under the cabinet
// wall form two channels; a boost gate and a brake gate wait at the bottom.
// Two channels run down the wall, gently bulging into the field; each ends in
// a gate (boost / brake / warp) whose guides seal onto the channel walls.
export function twinLanes(spec, { v0 = 0.24, v1 = 0.56, gap = 0.08, bulge = 0.07, side = 'left', gates: g = ['boost', 'brake'], labels = ['', ''] }) {
  const left = side === 'left';
  const wallX = left ? 0.02 : LANE_X;
  const dir = left ? 1 : -1;
  const x1 = wallX + dir * gap, x2 = wallX + dir * gap * 2;
  const c1 = curveWall(spec, [x1, v0], [x1 + dir * bulge, (v0 + v1) / 2], [x1, v1]);
  const c2 = curveWall(spec, [x2, v0], [x2 + dir * bulge, (v0 + v1) / 2], [x2, v1]);
  for (const c of [c1, c2]) { pin(spec, c[0][0], c[0][1], 0, 0.009); pin(spec, c[c.length - 1][0], c[c.length - 1][1], 0, 0.009); }
  // Gates sit inline with the channels; guide offset is GATE_G = 0.04 so a
  // gate centred in an 0.08 channel has its guides on the channel walls.
  const gv = v1 + V(0.05);
  gate(spec, wallX + dir * gap * 0.5, gv, 0, g[0], labels[0], { labelOff: 0 });
  gate(spec, wallX + dir * gap * 1.5, gv, 0, g[1], labels[1], { labelOff: 1 });
  art(spec, { kind: 'lanes', u: left ? 0.02 : LANE_X - gap * 2, v: v0, w: gap * 2, h: v1 - v0, side });
}

// One-way gate into a U-turn: the ball drops down the entry arm, swings round
// the U and a kicker fires it back up the exit arm. The middle is a sealed
// island under a domed roof (so nothing can drop into the bowl).
export function uTurn(spec, { u, v, R = 0.15, gap = 0.075, armTop = 0.3, entry = 'right', label: lbl = 'KICK' }) {
  const ri = R - gap;
  const eu = entry === 'right' ? u + (R + ri) / 2 : u - (R + ri) / 2;
  const xu = entry === 'right' ? u - (R + ri) / 2 : u + (R + ri) / 2;
  wall(spec, [[u - R, armTop], [u - R, v]]); wall(spec, [[u - ri, armTop], [u - ri, v]]);
  wall(spec, [[u + R, armTop], [u + R, v]]); wall(spec, [[u + ri, armTop], [u + ri, v]]);
  arcWall(spec, u, v, R, 0, Math.PI, 'chrome', 18);
  arcWall(spec, u, v, ri, 0, Math.PI, 'chrome', 14);
  arcWall(spec, u, armTop, ri, Math.PI, Math.PI * 2, 'chrome', 12); // domed roof
  for (const x of [u - R, u + R]) pin(spec, x, armTop, 0, 0.009);
  oneway(spec, eu, armTop + V(0.05), 0, 'ONE-WAY');
  const kv = v + V((R + ri) / 2);
  gate(spec, u, kv, Math.PI / 2, 'boost', lbl, { noGuides: true, kicker: true, dir: entry === 'right' ? -1 : 1 });
  exempt(spec, { u, v: kv, r: (R + ri) / 2 + 0.03 });
  exempt(spec, { u: u - ri, v: armTop - V(ri) - 0.01, w: ri * 2, h: V(ri) * 2 + (v - armTop) + 0.02 });
  label(spec, xu, armTop - V(0.035), 'EXIT', 0.02);
  label(spec, eu, armTop - V(0.035), 'ENTER', 0.02);
  art(spec, { kind: 'uturn', u, v, R, ri, armTop });
}

// An intersection: four diagonal spokes leave four paths that all lead to a
// hole in the middle.
export function intersection(spec, { u, v, r = 0.036, d1 = 0.07, d2 = 0.14, kind = 'hole', label: lbl = '' }) {
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    wall(spec, [[u + d1 * Math.cos(a), v + V(d1 * Math.sin(a))], [u + d2 * Math.cos(a), v + V(d2 * Math.sin(a))]]);
    // posts only on the upper spokes (balls roll inward on those); a post on
    // the outer end of a lower spoke would stop a ball rolling off it.
    if (Math.sin(a) < 0) pin(spec, u + d2 * Math.cos(a), v + V(d2 * Math.sin(a)), 0, 0.009);
  }
  hole(spec, u, v, kind, lbl, r);
  art(spec, { kind: 'cross', u, v, d: d2 });
}
