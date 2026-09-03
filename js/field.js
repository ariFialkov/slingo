// Slingo — procedural playfield generation and deterministic scoring.
//
// A board is generated from a formula: an asymmetric chamfered cabinet outline
// with a side notch, a one-sided orbit rail, top rollover lanes, then scoring
// components placed by rejection sampling inside the polygon. Everything is
// specified in normalised 0..1 coordinates (y down) and realised to pixels.
import { THEMES, THEME_WEIGHTS, SCORE_STEP, round2 } from './config.js';

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const coin = (p = 0.5) => Math.random() < p;

// ---------------------------------------------------------------------------
// Outcome & steering
// ---------------------------------------------------------------------------
export function pickTheme() {
  const total = THEME_WEIGHTS.reduce((s, [, w]) => s + w, 0);
  let roll = Math.random() * total;
  for (const [key, w] of THEME_WEIGHTS) {
    roll -= w;
    if (roll <= 0) return THEMES[key];
  }
  return THEMES.solar;
}

export function rollMultiplier(table) {
  let roll = Math.random();
  for (const [mult, p] of table) {
    roll -= p;
    if (roll <= 0) return mult;
  }
  return 0;
}

// Tier = how big a share of the remaining gap a component takes.
const SHARE = { 1: [0.12, 0.3], 2: [0.3, 0.55], 3: [0.55, 0.95] };

// Amount a signed component of `tier` awards to `ball` right now. Positive
// components close a share of the remaining gap; negative ones pull an
// overshoot back (or nibble a nominal amount so later positives have
// something to fill). Every award is a multiple of SCORE_STEP × stake.
export function awardFor(ball, sign, tier = 1) {
  const step = round2(SCORE_STEP * ball.stake);
  const nice = (x) => round2(Math.round(x / step) * step);
  const [lo, hi] = SHARE[tier] || SHARE[1];
  const gap = round2(ball.target - ball.total);
  if (sign > 0) {
    if (gap >= step) return Math.min(gap, Math.max(step, nice(gap * rand(lo, hi))));
    // nominal overshoot; − components / the exit settle it. Bounded per ball so
    // a ball pinned against a + component can't farm it.
    if ((ball.overshoots || 0) >= 3) return 0;
    ball.overshoots = (ball.overshoots || 0) + 1;
    return round2(step * tier);
  }
  const over = round2(ball.total - ball.target);
  if (over >= step) return -Math.min(over, Math.max(step, nice(over * rand(Math.min(0.9, lo + 0.25), 1))));
  const nib = round2(step * tier);
  if (ball.total >= nib) return -nib;
  if (ball.total >= step) return -step;
  return 0;
}

export function residualFor(ball) {
  return round2(ball.target - ball.total);
}

export const tierLabel = (sign, tier) => (sign > 0 ? '+' : '−').repeat(tier);

// ---------------------------------------------------------------------------
// Geometry helpers (normalised or px — they're unit-agnostic)
// ---------------------------------------------------------------------------
export function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function segDist(x, y, a, b) {
  const abx = b[0] - a[0], aby = b[1] - a[1];
  const len2 = abx * abx + aby * aby || 1e-9;
  const t = Math.max(0, Math.min(1, ((x - a[0]) * abx + (y - a[1]) * aby) / len2));
  return Math.hypot(x - (a[0] + abx * t), y - (a[1] + aby * t));
}
function polyEdges(poly) {
  const out = [];
  for (let i = 0; i < poly.length; i++) out.push([poly[i], poly[(i + 1) % poly.length]]);
  return out;
}

// ---------------------------------------------------------------------------
// Spec generation (normalised)
// ---------------------------------------------------------------------------
export function generateSpec(theme = pickTheme()) {
  const mix = theme.mix;
  const spec = {
    theme: theme.key, walls: [], rails: [], tris: [], pins: [], bumpers: [], lanes: [], holes: [],
    flippers: [], decor: [], labels: [],
  };

  // --- cabinet outline: chamfered, notched, asymmetric ---------------------
  const cl = rand(0.08, 0.2), cr = rand(0.08, 0.24);   // top chamfer widths
  const ch = rand(0.03, 0.1), chr = rand(0.03, 0.12);  // top chamfer heights
  const notchLeft = coin();
  const nv = rand(0.3, 0.58), nd = rand(0.05, 0.09), nh = rand(0.05, 0.08);
  const bl = rand(0.8, 0.86), br = rand(0.78, 0.86);   // where the side walls start converging
  // The exit is a well between the flipper pivots (0.3/0.7, v 0.965) down to v=1.
  const pts = [[0.3, 1], [0.3, 0.965], [0.02, bl]];
  if (notchLeft) pts.push([0.02, nv + nh], [0.02 + nd, nv], [0.02, nv - nh]);
  pts.push([0.02, 0.02 + ch], [0.02 + cl, 0.02], [0.98 - cr, 0.02], [0.98, 0.02 + chr]);
  if (!notchLeft) pts.push([0.98, nv - nh], [0.98 - nd, nv], [0.98, nv + nh]);
  pts.push([0.98, br], [0.7, 0.965], [0.7, 1]);
  spec.outline = pts;
  // walls = every outline edge except the closing one (the drain at the bottom of the well)
  for (let i = 0; i < pts.length - 1; i++) spec.walls.push({ a: pts[i], b: pts[i + 1], neon: true });
  const poly = pts;
  const inside = (u, v, m = 0) => pointInPoly(u, v, poly) && polyEdges(poly).every(([a, b]) => segDist(u, v, a, b) >= m);

  // --- top rollover lanes -------------------------------------------------
  const nLanes = 2 + ((Math.random() * 3) | 0);
  const laneW = 0.11;
  const laneU0 = rand(0.3, 0.7 - nLanes * laneW);
  const gTop = 0.02 + Math.max(ch, chr) + 0.03, gBot = gTop + 0.1;
  for (let i = 0; i <= nLanes; i++) spec.walls.push({ a: [laneU0 + i * laneW, gTop], b: [laneU0 + i * laneW, gBot], cap: true });
  for (let i = 0; i < nLanes; i++) spec.lanes.push({ u: laneU0 + (i + 0.5) * laneW, v: gBot - 0.025, halfW: laneW * 0.42, sign: +1, tier: 1 });

  // --- one-sided orbit rail (partial ring) ---------------------------------
  const orbitRight = notchLeft; // orbit on the side opposite the notch
  const ocu = orbitRight ? rand(0.6, 0.7) : rand(0.3, 0.4), ocv = rand(0.3, 0.42), orr = rand(0.17, 0.23);
  const a0 = orbitRight ? -Math.PI * 0.95 : -Math.PI * 0.05, a1 = orbitRight ? Math.PI * 0.35 : Math.PI * 0.65;
  const ring = [];
  for (let i = 0; i <= 14; i++) {
    const a = a0 + ((a1 - a0) * i) / 14;
    const u = ocu + orr * Math.cos(a), v = ocv + orr * Math.sin(a);
    ring.push(inside(u, v, 0.035) && v > gBot + 0.02 ? [u, v] : null);
  }
  for (let i = 0; i < ring.length - 1; i++) if (ring[i] && ring[i + 1]) spec.walls.push({ a: ring[i], b: ring[i + 1], neon: true, orbit: true });
  spec.orbit = { u: ocu, v: ocv, r: orr };

  // --- component placement with collision avoidance -----------------------
  const placed = []; // {u,v,r}
  const wallsFor = () => spec.walls.map((w) => [w.a, w.b]);
  const clearOf = (u, v, r) =>
    inside(u, v, r + 0.02) &&
    wallsFor().every(([a, b]) => segDist(u, v, a, b) >= r + 0.02) &&
    placed.every((p) => Math.hypot(u - p.u, v - p.v) >= r + p.r + 0.03) &&
    !(v > 0.8 && u > 0.3 && u < 0.7); // keep the exit approach clear
  const place = (r, vmin, vmax, umin = 0.08, umax = 0.92) => {
    for (let k = 0; k < 80; k++) {
      const u = rand(umin, umax), v = rand(vmin, vmax);
      if (clearOf(u, v, r)) { placed.push({ u, v, r }); return { u, v }; }
    }
    return null;
  };
  const sign = () => (coin(mix.plusBias) ? +1 : -1);

  // core reactor: big + bumper, tier 3
  {
    const r = 0.058;
    const p = place(r, 0.42, 0.58, 0.36, 0.64) || { u: 0.5, v: 0.5 };
    spec.bumpers.push({ u: p.u, v: p.v, r, sign: +1, tier: 3, kind: 'reactor' });
  }
  // bonus discs (nebula)
  for (let i = 0; i < mix.bonus; i++) {
    const r = 0.042;
    const p = place(r, 0.26, 0.74);
    if (p) spec.bumpers.push({ u: p.u, v: p.v, r, sign: +1, tier: 3, kind: 'bonus' });
  }
  // pop bumpers
  for (let i = 0; i < mix.bumpers; i++) {
    const r = rand(0.036, 0.048);
    const p = place(r, 0.26, 0.74);
    if (p) spec.bumpers.push({ u: p.u, v: p.v, r, sign: i === 0 ? +1 : i === 1 ? -1 : sign(), tier: 2, kind: 'pop' });
  }
  // slingshot-style triangle kickers above the flippers (always −, tier 2)
  const j = () => rand(-0.02, 0.02);
  spec.tris.push({ pts: [[0.06, 0.68 + j()], [0.06, 0.82 + j()], [0.17 + j(), 0.8 + j()]], sign: -1, tier: 2 });
  spec.tris.push({ pts: [[0.94, 0.66 + j()], [0.94, 0.82 + j()], [0.83 + j(), 0.79 + j()]], sign: -1, tier: 2 });
  placed.push({ u: 0.1, v: 0.76, r: 0.07 }, { u: 0.9, v: 0.75, r: 0.07 });
  // an extra mid-field triangle kicker (+)
  if (coin(0.7)) {
    const p = place(0.05, 0.28, 0.7);
    if (p) {
      const rot = rand(0, Math.PI * 2), R = 0.05;
      const tp = [0, 1, 2].map((k) => [p.u + R * Math.cos(rot + (k * 2 * Math.PI) / 3), p.v + R * Math.sin(rot + (k * 2 * Math.PI) / 3)]);
      spec.tris.push({ pts: tp, sign: +1, tier: 2 });
    }
  }
  // holes / baskets
  for (let i = 0; i < mix.holes; i++) {
    const r = rand(0.028, 0.034);
    const p = place(r, 0.3, 0.78);
    if (p) spec.holes.push({ u: p.u, v: p.v, r, kind: coin() ? 'hole' : 'basket' });
  }
  // signed rails hugging the side walls
  const nRails = 2 + (coin() ? 1 : 0);
  for (let i = 0; i < nRails; i++) {
    const left = i % 2 === 0 ? !notchLeft : notchLeft;
    for (let k = 0; k < 30; k++) {
      const u = left ? rand(0.09, 0.24) : rand(0.76, 0.91), v = rand(0.3, 0.72);
      const ang = (left ? 1 : -1) * rand(0.35, 0.9) * (coin() ? 1 : -1);
      const L = 0.12;
      const a = [u - (L / 2) * Math.cos(ang), v - (L / 2) * Math.sin(ang)], b = [u + (L / 2) * Math.cos(ang), v + (L / 2) * Math.sin(ang)];
      if (clearOf(u, v, 0.05) && inside(a[0], a[1], 0.02) && inside(b[0], b[1], 0.02)) {
        spec.rails.push({ a, b, sign: sign(), tier: 2 });
        placed.push({ u, v, r: 0.05 });
        break;
      }
    }
  }
  // pins: signed kicker pins and plain deflectors
  for (let i = 0; i < mix.pins; i++) {
    const signed = coin(0.6);
    const r = signed ? rand(0.012, 0.014) : rand(0.01, 0.012);
    const p = place(r + 0.012, 0.2, 0.8);
    if (p) spec.pins.push({ u: p.u, v: p.v, r, sign: signed ? sign() : 0, tier: 1 });
  }

  // --- flippers, exit, no-aim zone -----------------------------------------
  spec.flippers.push({ pivot: [0.3, 0.965], len: 0.14, dir: +1, rest: 0.35, flip: -0.45 });
  spec.flippers.push({ pivot: [0.7, 0.965], len: 0.14, dir: -1, rest: 0.35, flip: -0.45 });
  spec.drainV = 0.985;
  spec.exit = { u0: 0.3, u1: 0.7 };
  spec.forbid = { u0: 0.33, u1: 0.67, v0: 0.82, v1: 1.0 };

  // --- decor: circuit traces + labels --------------------------------------
  for (let i = 0; i < 3; i++) {
    const left = coin();
    let u = left ? rand(0.05, 0.12) : rand(0.88, 0.95), v = rand(0.2, 0.7);
    const line = [[u, v]];
    for (let k = 0; k < 3; k++) {
      const du = (left ? 1 : -1) * rand(0.03, 0.08), dv = rand(-0.06, 0.1);
      u += du; v += dv;
      if (!inside(u, v, 0.02)) break;
      line.push([u, v]);
    }
    if (line.length > 1) spec.decor.push(line);
  }
  spec.labels.push({ u: 0.5, v: 0.02 + Math.max(ch, chr) * 0.5 + 0.02, text: `${theme.name} · ${theme.tag.split(' · ')[0]}`, size: 0.028, main: true });
  spec.labels.push({ u: notchLeft ? 0.86 : 0.14, v: 0.26, text: `SECTOR ${1 + ((Math.random() * 9) | 0)}`, size: 0.024 });
  spec.labels.push({ u: notchLeft ? 0.14 : 0.86, v: 0.26, text: `PX-${1 + ((Math.random() * 9) | 0)}`, size: 0.024 });
  return spec;
}

// ---------------------------------------------------------------------------
// Realise a spec into pixels
// ---------------------------------------------------------------------------
export function realize(spec, x0, y0, w, h) {
  const P = (uv) => ({ x: x0 + uv[0] * w, y: y0 + uv[1] * h });
  const seg = (s) => ({ ...s, a: P(s.a), b: P(s.b) });
  const theme = THEMES[spec.theme];
  const board = {
    x0, y0, w, h, theme, spec,
    poly: spec.outline.map((p) => [x0 + p[0] * w, y0 + p[1] * h]),
    walls: spec.walls.map(seg),
    rails: spec.rails.map((r) => ({ ...seg(r), flashT: 0 })),
    tris: spec.tris.map((t) => {
      const pts = t.pts.map(P);
      const cx = (pts[0].x + pts[1].x + pts[2].x) / 3, cy = (pts[0].y + pts[1].y + pts[2].y) / 3;
      const edges = [0, 1, 2].map((i) => ({ a: pts[i], b: pts[(i + 1) % 3] }));
      return { ...t, pts, edges, cx, cy, flashT: 0 };
    }),
    pins: spec.pins.map((p) => ({ ...p, ...P([p.u, p.v]), r: p.r * w, flashT: 0 })),
    bumpers: spec.bumpers.map((b) => ({ ...b, ...P([b.u, b.v]), r: b.r * w, flashT: 0 })),
    lanes: spec.lanes.map((l) => ({ ...l, ...P([l.u, l.v]), halfW: l.halfW * w, flashT: 0 })),
    holes: spec.holes.map((hh) => ({ ...hh, ...P([hh.u, hh.v]), r: hh.r * w, flashT: 0 })),
    flippers: spec.flippers.map((f) => ({ ...f, px: x0 + f.pivot[0] * w, py: y0 + f.pivot[1] * h, len: f.len * w, angle: f.rest, flipT: -1e9 })),
    drainY: y0 + spec.drainV * h,
    exit: { x0: x0 + spec.exit.u0 * w, x1: x0 + spec.exit.u1 * w, flashT: 0 },
    forbid: { x0: x0 + spec.forbid.u0 * w, x1: x0 + spec.forbid.u1 * w, y0: y0 + spec.forbid.v0 * h, y1: y0 + spec.forbid.v1 * h },
    decor: spec.decor.map((line) => line.map(P)),
    labels: spec.labels.map((l) => ({ ...l, ...P([l.u, l.v]), px: l.size * w })),
    orbit: spec.orbit ? { x: x0 + spec.orbit.u * w, y: y0 + spec.orbit.v * h, r: spec.orbit.r * w } : null,
    centroid: { x: x0 + 0.5 * w, y: y0 + 0.45 * h },
  };
  return board;
}

// Current flipper segment (px) for its animated angle.
export function flipperSegment(f) {
  // angle is measured downward from horizontal; dir mirrors the x extent only
  return { a: { x: f.px, y: f.py }, b: { x: f.px + f.dir * f.len * Math.cos(f.angle), y: f.py + f.len * Math.sin(f.angle) } };
}

// Clamp an aim point so the slingshot can only shoot into play: inside the
// cabinet polygon and outside the no-aim zone above the exit.
export function clampAim(board, x, y, margin) {
  const F = board.forbid;
  let px = x, py = y;
  if (!pointInPoly(px, py, board.poly)) {
    // binary search along the segment centroid → point for the boundary
    let lo = 0, hi = 1;
    const c = board.centroid;
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      const mx = c.x + (px - c.x) * mid, my = c.y + (py - c.y) * mid;
      if (pointInPoly(mx, my, board.poly)) lo = mid; else hi = mid;
    }
    const t = Math.max(0, lo - margin / Math.max(1, Math.hypot(px - c.x, py - c.y)));
    px = c.x + (px - c.x) * t;
    py = c.y + (py - c.y) * t;
  }
  if (px > F.x0 && px < F.x1 && py > F.y0) py = F.y0 - margin;
  return { x: px, y: py };
}
