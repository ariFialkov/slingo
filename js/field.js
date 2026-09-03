// Slingo — procedural playfield generation and deterministic scoring.
//
// A board is generated from a formula: an asymmetric chamfered cabinet outline
// with a side notch, a one-sided orbit rail, an optional swoosh ramp, then
// scoring components placed by rejection sampling inside the polygon. A trap
// scan rejects any layout with a V-shaped pocket a ball could rest in.
// Geometry is specified in normalised 0..1 coordinates (y down) and realised
// to pixels; gates and spinners are realised with true angles in pixel space.
import { THEMES, THEME_WEIGHTS, SCORE_STEP, round2 } from './config.js';

const rand = (a, b) => a + Math.random() * (b - a);
const coin = (p = 0.5) => Math.random() < p;
export const BALL_R = 0.017; // ball radius as a fraction of field width

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

const SHARE = { 1: [0.12, 0.3], 2: [0.3, 0.55], 3: [0.55, 0.95] };

export function awardFor(ball, sign, tier = 1) {
  const step = round2(SCORE_STEP * ball.stake);
  const nice = (x) => round2(Math.round(x / step) * step);
  const [lo, hi] = SHARE[tier] || SHARE[1];
  const gap = round2(ball.target - ball.total);
  if (sign > 0) {
    if (gap >= step) return Math.min(gap, Math.max(step, nice(gap * rand(lo, hi))));
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
// Geometry helpers
// ---------------------------------------------------------------------------
export function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function closestOnSeg(x, y, a, b) {
  const abx = b[0] - a[0], aby = b[1] - a[1];
  const len2 = abx * abx + aby * aby || 1e-9;
  const t = Math.max(0, Math.min(1, ((x - a[0]) * abx + (y - a[1]) * aby) / len2));
  return [a[0] + abx * t, a[1] + aby * t];
}
function segDist(x, y, a, b) {
  const c = closestOnSeg(x, y, a, b);
  return Math.hypot(x - c[0], y - c[1]);
}
function polyEdges(poly) {
  const out = [];
  for (let i = 0; i < poly.length; i++) out.push([poly[i], poly[(i + 1) % poly.length]]);
  return out;
}

// ---------------------------------------------------------------------------
// Trap scan: does any resting position exist where a ball is wedged between
// two surfaces whose normals point up and inward (a V pocket)? Runs in
// aspect-corrected units (u, v·ASPECT) so the ball is a true circle.
// ---------------------------------------------------------------------------
const ASPECT = 1.6; // typical field h/w; conservative for wider fields
export function specSurfaces(spec) {
  const S = (p) => [p[0], p[1] * ASPECT];
  const segs = spec.walls.map((w) => [S(w.a), S(w.b)]);
  for (const r of spec.rails) segs.push([S(r.a), S(r.b)]);
  for (const t of spec.tris) for (let i = 0; i < 3; i++) segs.push([S(t.pts[i]), S(t.pts[(i + 1) % 3])]);
  for (const g of spec.gates) for (const seg of gateGuides(g)) segs.push([S(seg[0]), S(seg[1])]);
  const circles = [];
  for (const p of spec.pins) circles.push([p.u, p.v * ASPECT, p.r]);
  for (const b of spec.bumpers) circles.push([b.u, b.v * ASPECT, b.r]);
  for (const sp of spec.spinners) for (const post of spinnerPosts(sp)) circles.push([post[0], post[1] * ASPECT, 0.01]);
  return { segs, circles };
}
export function findTrap(spec) {
  const { segs, circles } = specSurfaces(spec);
  const r = BALL_R, tol = 0.0025, step = 0.006;
  const poly = spec.outline.map((p) => [p[0], p[1] * ASPECT]);
  // spatial hash: each cell lists the surfaces whose (expanded) bbox touches it
  const CELL = 0.06, cols = Math.ceil(1 / CELL) + 1, rows = Math.ceil(ASPECT / CELL) + 1;
  const cells = new Array(cols * rows);
  const addBox = (x0, y0, x1, y1, item) => {
    const pad = r + tol + 0.001;
    for (let cy = Math.max(0, Math.floor((y0 - pad) / CELL)); cy <= Math.min(rows - 1, Math.floor((y1 + pad) / CELL)); cy++) {
      for (let cx = Math.max(0, Math.floor((x0 - pad) / CELL)); cx <= Math.min(cols - 1, Math.floor((x1 + pad) / CELL)); cx++) {
        (cells[cy * cols + cx] ||= []).push(item);
      }
    }
  };
  for (const s of segs) addBox(Math.min(s[0][0], s[1][0]), Math.min(s[0][1], s[1][1]), Math.max(s[0][0], s[1][0]), Math.max(s[0][1], s[1][1]), { s });
  for (const c of circles) addBox(c[0] - c[2], c[1] - c[2], c[0] + c[2], c[1] + c[2], { c });

  for (let v = 0.06 * ASPECT; v < 0.96 * ASPECT; v += step) {
    for (let u = 0.03; u < 0.97; u += step) {
      const bucket = cells[Math.floor(v / CELL) * cols + Math.floor(u / CELL)];
      if (!bucket || bucket.length < 2) continue;
      if (!pointInPoly(u, v, poly)) continue;
      const contacts = []; // {n:[nx,ny], p:[x,y]}
      let overlap = false;
      for (const item of bucket) {
        if (item.s) {
          const [a, b] = item.s;
          const c = closestOnSeg(u, v, a, b);
          const d = Math.hypot(u - c[0], v - c[1]);
          if (d < r - tol) { overlap = true; break; }
          if (Math.abs(d - r) < tol) contacts.push({ n: [(u - c[0]) / d, (v - c[1]) / d], p: c });
        } else {
          const [cx, cy, cr] = item.c;
          const d = Math.hypot(u - cx, v - cy);
          if (d < r + cr - tol) { overlap = true; break; }
          if (Math.abs(d - (r + cr)) < tol) contacts.push({ n: [(u - cx) / d, (v - cy) / d], p: [cx + ((u - cx) / d) * cr, cy + ((v - cy) / d) * cr] });
        }
      }
      if (overlap || contacts.length < 2) continue;
      // A pocket (∨): a support to the lower-left pushing up-right and one to
      // the lower-right pushing up-left, at distinct contact points. A convex
      // roof (∧) has its left contact pushing up-left instead, and a ball on
      // an apex touches both edges at one point — neither is a trap.
      const lefts = contacts.filter((c) => c.p[0] < u && c.n[0] > 0.25 && c.n[1] < -0.05);
      const rights = contacts.filter((c) => c.p[0] > u && c.n[0] < -0.25 && c.n[1] < -0.05);
      const pocket = lefts.some((l) => rights.some((rt) => Math.hypot(l.p[0] - rt.p[0], l.p[1] - rt.p[1]) > r * 0.6));
      if (pocket) return { u, v: v / ASPECT };
    }
  }
  return null;
}

// Gate guide segments (normalised, approximate aspect) — used for clearance
// and trap scanning; realised precisely in pixels.
const GATE_L = 0.05, GATE_G = 0.04; // half-length (u) and half-gap (u)
function gateGuides(g) {
  const ax = Math.sin(g.angle), ay = Math.cos(g.angle) / ASPECT; // axis, pointing down
  const px = Math.cos(g.angle), py = -Math.sin(g.angle) / ASPECT; // perpendicular
  const out = [];
  for (const s of [-1, 1]) {
    const cx = g.u + px * GATE_G * s, cy = g.v + py * GATE_G * s;
    out.push([[cx - ax * GATE_L, cy - ay * GATE_L], [cx + ax * GATE_L, cy + ay * GATE_L]]);
  }
  return out;
}
const SPIN_HW = 0.045;
function spinnerPosts(sp) {
  const px = Math.cos(sp.angle), py = Math.sin(sp.angle) / ASPECT;
  return [[sp.u - px * SPIN_HW, sp.v - py * SPIN_HW], [sp.u + px * SPIN_HW, sp.v + py * SPIN_HW]];
}

// ---------------------------------------------------------------------------
// Spec generation (normalised); retried until the trap scan passes
// ---------------------------------------------------------------------------
export function generateSpec(theme = pickTheme()) {
  let spec = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    spec = generateOnce(theme);
    if (!findTrap(spec)) { spec.attempts = attempt + 1; return spec; }
  }
  spec.attempts = 12;
  return spec;
}

function generateOnce(theme) {
  const mix = theme.mix;
  const spec = {
    theme: theme.key, walls: [], rails: [], tris: [], pins: [], bumpers: [], holes: [],
    gates: [], spinners: [], flippers: [], decor: [], labels: [], plates: [],
  };

  // --- cabinet outline: chamfered, notched, asymmetric ---------------------
  const cl = rand(0.08, 0.2), cr = rand(0.08, 0.24);
  const ch = rand(0.03, 0.1), chr = rand(0.03, 0.12);
  const notchLeft = coin();
  const nv = rand(0.3, 0.58), nd = rand(0.05, 0.09), nh = rand(0.05, 0.08);
  const bl = rand(0.8, 0.86), br = rand(0.78, 0.86);
  const pts = [[0.3, 1], [0.3, 0.965], [0.02, bl]];
  if (notchLeft) pts.push([0.02, nv + nh], [0.02 + nd, nv], [0.02, nv - nh]);
  pts.push([0.02, 0.02 + ch], [0.02 + cl, 0.02], [0.98 - cr, 0.02], [0.98, 0.02 + chr]);
  if (!notchLeft) pts.push([0.98, nv - nh], [0.98 - nd, nv], [0.98, nv + nh]);
  pts.push([0.98, br], [0.7, 0.965], [0.7, 1]);
  spec.outline = pts;
  for (let i = 0; i < pts.length - 1; i++) spec.walls.push({ a: pts[i], b: pts[i + 1], neon: true });
  const poly = pts;
  const inside = (u, v, m = 0) => pointInPoly(u, v, poly) && polyEdges(poly).every(([a, b]) => segDist(u, v, a, b) >= m);
  const topClear = 0.02 + Math.max(ch, chr) + 0.06;

  // --- one-sided orbit rail (opening always faces down) ----------------------
  // Kept ≥ 0.075 (> 2 ball diameters) away from the cabinet walls so the gap
  // between rail and wall is never a dead end.
  const orbitRight = notchLeft;
  const ocu = orbitRight ? rand(0.6, 0.7) : rand(0.3, 0.4), ocv = rand(0.3, 0.42), orr = rand(0.17, 0.23);
  const a0 = orbitRight ? -Math.PI * 0.95 : Math.PI * 0.65, a1 = orbitRight ? Math.PI * 0.35 : Math.PI * 1.95;
  const ring = [];
  for (let i = 0; i <= 30; i++) {
    const a = a0 + ((a1 - a0) * i) / 30;
    const u = ocu + orr * Math.cos(a), v = ocv + orr * Math.sin(a);
    ring.push(inside(u, v, 0.075) && v > topClear ? [u, v] : null);
  }
  const orbitPts = [];
  for (let i = 0; i < ring.length - 1; i++) {
    if (ring[i] && ring[i + 1]) { spec.walls.push({ a: ring[i], b: ring[i + 1], curve: 'orbit' }); orbitPts.push(ring[i], ring[i + 1]); }
  }
  spec.orbit = { u: ocu, v: ocv, r: orr, pts: orbitPts.filter((p, i) => i === 0 || p !== orbitPts[i - 1]) };

  // --- tapered swoosh ramp on the notch side, detached from the wall ----------
  if (coin(0.65)) {
    const left = notchLeft;
    const sx = left ? 0.05 : 0.95, bulge = left ? rand(0.22, 0.3) : 1 - rand(0.22, 0.3);
    const v0 = rand(0.22, 0.3), v1 = rand(0.62, 0.74);
    const p0 = [sx, v0], pc = [bulge, (v0 + v1) / 2], p1 = [sx, v1];
    const sw = [];
    for (let i = 0; i <= 22; i++) {
      const t = i / 22;
      const u = (1 - t) * (1 - t) * p0[0] + 2 * (1 - t) * t * pc[0] + t * t * p1[0];
      const v = (1 - t) * (1 - t) * p0[1] + 2 * (1 - t) * t * pc[1] + t * t * p1[1];
      sw.push(inside(u, v, 0.075) && v > topClear ? [u, v] : null);
    }
    const swPts = [];
    for (let i = 0; i < sw.length - 1; i++) if (sw[i] && sw[i + 1]) { spec.walls.push({ a: sw[i], b: sw[i + 1], curve: 'swoosh' }); swPts.push(sw[i], sw[i + 1]); }
    spec.swoosh = { pts: swPts.filter((p, i) => i === 0 || p !== swPts[i - 1]) };
  }

  // --- placement with clearance ≥ a ball diameter + margin ---------------------
  const placed = [];
  const wallsFor = () => spec.walls.map((w) => [w.a, w.b]);
  const clearOf = (u, v, r) =>
    inside(u, v, r + 0.045) &&
    wallsFor().every(([a, b]) => segDist(u, v, a, b) >= r + 0.045) &&
    placed.every((p) => Math.hypot(u - p.u, v - p.v) >= r + p.r + 0.05) &&
    !(v > 0.8 && u > 0.3 && u < 0.7);
  const place = (r, vmin, vmax, umin = 0.08, umax = 0.92) => {
    for (let k = 0; k < 80; k++) {
      const u = rand(umin, umax), v = rand(vmin, vmax);
      if (clearOf(u, v, r)) { placed.push({ u, v, r }); return { u, v }; }
    }
    return null;
  };
  const sign = () => (coin(mix.plusBias) ? +1 : -1);

  // core reactor
  {
    const r = 0.058;
    const p = place(r, 0.42, 0.58, 0.36, 0.64) || { u: 0.5, v: 0.5 };
    spec.bumpers.push({ u: p.u, v: p.v, r, sign: +1, tier: 3, kind: 'reactor' });
  }
  for (let i = 0; i < mix.bonus; i++) {
    const r = 0.042;
    const p = place(r, 0.24, 0.74);
    if (p) spec.bumpers.push({ u: p.u, v: p.v, r, sign: +1, tier: 3, kind: 'bonus' });
  }
  for (let i = 0; i < mix.bumpers; i++) {
    const r = rand(0.036, 0.048);
    const p = i % 2 === 0 ? place(r, 0.24, 0.74, 0.1, 0.46) : place(r, 0.24, 0.74, 0.54, 0.9);
    if (p) spec.bumpers.push({ u: p.u, v: p.v, r, sign: i === 0 ? +1 : i === 1 ? -1 : sign(), tier: 2, kind: 'pop' });
  }
  // holes / baskets (side exits, placed early so there is always at least one):
  // the first sits low on the notch side, the rest are random
  for (let i = 0; i < mix.holes; i++) {
    const r = rand(0.028, 0.034);
    const p = i === 0
      ? (notchLeft ? place(r, 0.5, 0.72, 0.1, 0.3) : place(r, 0.5, 0.72, 0.7, 0.9)) || place(r, 0.3, 0.78) || place(r, 0.24, 0.8, 0.06, 0.94)
      : place(r, 0.3, 0.78);
    if (p) spec.holes.push({ u: p.u, v: p.v, r, kind: coin() ? 'hole' : 'basket' });
  }
  // spinners (placed early so they always find room): paddles on an axle
  // between two posts, spun by passing balls
  const nSpin = 1 + ((Math.random() * 2) | 0);
  for (let i = 0; i < nSpin; i++) {
    const p = place(0.05, topClear + 0.04, 0.76);
    if (p) spec.spinners.push({ u: p.u, v: p.v, angle: rand(-0.5, 0.5), sign: +1, tier: 1 });
  }
  // gates: scattered channels that score and do something to the ball.
  // kinds: boost (accelerates), brake (slows), warp (teleports to its twin)
  const nGates = 2 + ((Math.random() * 3) | 0);
  const kinds = ['boost', 'brake', 'boost', 'warp', 'warp'].sort(() => Math.random() - 0.5).slice(0, nGates);
  if (kinds.filter((k) => k === 'warp').length === 1) kinds[kinds.indexOf('warp')] = 'boost';
  for (const kind of kinds) {
    const p = place(0.062, topClear + 0.04, 0.76);
    if (p) spec.gates.push({ u: p.u, v: p.v, angle: rand(-0.6, 0.6), kind, sign: +1, tier: 1 });
  }
  const warps = spec.gates.filter((g) => g.kind === 'warp');
  if (warps.length >= 2) { warps[0].twin = spec.gates.indexOf(warps[1]); warps[1].twin = spec.gates.indexOf(warps[0]); }
  else for (const g of warps) g.kind = 'boost';
  // slingshot triangles flush against the walls
  const j = () => rand(-0.02, 0.02);
  spec.tris.push({ pts: [[0.02, 0.68 + j()], [0.02, 0.82 + j()], [0.16 + j(), 0.8 + j()]], sign: -1, tier: 2 });
  spec.tris.push({ pts: [[0.98, 0.66 + j()], [0.98, 0.82 + j()], [0.84 + j(), 0.79 + j()]], sign: -1, tier: 2 });
  placed.push({ u: 0.08, v: 0.76, r: 0.08 }, { u: 0.92, v: 0.75, r: 0.08 });
  if (coin(0.7)) {
    const p = place(0.05, 0.26, 0.7);
    if (p) {
      const rot = rand(0, Math.PI * 2), R = 0.05;
      spec.tris.push({ pts: [0, 1, 2].map((k) => [p.u + R * Math.cos(rot + (k * 2 * Math.PI) / 3), p.v + R * Math.sin(rot + (k * 2 * Math.PI) / 3)]), sign: +1, tier: 2 });
    }
  }
  // signed rails near the side walls (kept clear of them)
  const nRails = 2 + (coin() ? 1 : 0);
  for (let i = 0; i < nRails; i++) {
    const left = i % 2 === 0 ? !notchLeft : notchLeft;
    for (let k = 0; k < 30; k++) {
      const u = left ? rand(0.12, 0.26) : rand(0.74, 0.88), v = rand(0.3, 0.72);
      const ang = (left ? 1 : -1) * rand(0.35, 0.9) * (coin() ? 1 : -1);
      const L = 0.12;
      const a = [u - (L / 2) * Math.cos(ang), v - (L / 2) * Math.sin(ang)], b = [u + (L / 2) * Math.cos(ang), v + (L / 2) * Math.sin(ang)];
      if (clearOf(u, v, 0.05) && inside(a[0], a[1], 0.06) && inside(b[0], b[1], 0.06)) {
        spec.rails.push({ a, b, sign: sign(), tier: 2 });
        placed.push({ u, v, r: 0.05 });
        break;
      }
    }
  }
  // pins on a jittered staggered lattice
  const lattice = [];
  for (let row = 0; row < 8; row++) {
    const v = 0.22 + row * 0.08;
    for (let col = 0; col < 9; col++) lattice.push([0.1 + col * 0.1 + (row % 2 ? 0.05 : 0) + rand(-0.015, 0.015), v + rand(-0.012, 0.012)]);
  }
  for (let i = lattice.length - 1; i > 0; i--) { const k = (Math.random() * (i + 1)) | 0; [lattice[i], lattice[k]] = [lattice[k], lattice[i]]; }
  let pinsLeft = mix.pins;
  for (const [u, v] of lattice) {
    if (pinsLeft <= 0) break;
    if (v < topClear) continue;
    const signed = coin(0.6);
    const r = signed ? rand(0.012, 0.014) : rand(0.01, 0.012);
    if (clearOf(u, v, r)) { placed.push({ u, v, r }); spec.pins.push({ u, v, r, sign: signed ? sign() : 0, tier: 1 }); pinsLeft--; }
  }
  // sector plates
  for (let k = 0; k < 40 && spec.plates.length < 4; k++) {
    const w = rand(0.14, 0.26), h = rand(0.08, 0.16), u = rand(0.06, 0.94 - w), v = rand(0.2, 0.78 - h);
    const corners = [[u, v], [u + w, v], [u, v + h], [u + w, v + h]];
    if (corners.every(([cu, cv]) => inside(cu, cv, 0.02)) && spec.plates.every((pl) => u > pl.u + pl.w + 0.02 || u + w < pl.u - 0.02 || v > pl.v + pl.h + 0.02 || v + h < pl.v - 0.02)) {
      spec.plates.push({ u, v, w, h, ch: rand(0.02, 0.04) });
    }
  }

  // --- flippers, exit, no-aim zone -----------------------------------------
  spec.flippers.push({ pivot: [0.3, 0.965], len: 0.14, dir: +1, rest: 0.35, flip: -0.45 });
  spec.flippers.push({ pivot: [0.7, 0.965], len: 0.14, dir: -1, rest: 0.35, flip: -0.45 });
  spec.drainV = 0.985;
  spec.exit = { u0: 0.3, u1: 0.7 };
  spec.forbid = { u0: 0.33, u1: 0.67, v0: 0.82, v1: 1.0 };

  // --- decor ----------------------------------------------------------------
  for (let i = 0; i < 3; i++) {
    const left = coin();
    let u = left ? rand(0.05, 0.12) : rand(0.88, 0.95), v = rand(0.2, 0.7);
    const line = [[u, v]];
    for (let k = 0; k < 3; k++) {
      u += (left ? 1 : -1) * rand(0.03, 0.08); v += rand(-0.06, 0.1);
      if (!inside(u, v, 0.02)) break;
      line.push([u, v]);
    }
    if (line.length > 1) spec.decor.push(line);
  }
  spec.labels.push({ u: 0.5, v: 0.02 + Math.max(ch, chr) * 0.5 + 0.02, text: `${theme.name} · ${theme.tag.split(' · ')[0]}`, size: 0.028, main: true });
  spec.labels.push({ u: notchLeft ? 0.86 : 0.14, v: 0.2, text: `SECTOR ${1 + ((Math.random() * 9) | 0)}`, size: 0.024 });
  spec.labels.push({ u: notchLeft ? 0.14 : 0.86, v: 0.2, text: `PX-${1 + ((Math.random() * 9) | 0)}`, size: 0.024 });
  return spec;
}

// ---------------------------------------------------------------------------
// Realise a spec into pixels
// ---------------------------------------------------------------------------
export function realize(spec, x0, y0, w, h) {
  const P = (uv) => ({ x: x0 + uv[0] * w, y: y0 + uv[1] * h });
  const seg = (s) => ({ ...s, a: P(s.a), b: P(s.b) });
  const theme = THEMES[spec.theme];
  const gates = spec.gates.map((g, i) => {
    const c = P([g.u, g.v]);
    const ax = Math.sin(g.angle), ay = Math.cos(g.angle);   // axis (down)
    const px = Math.cos(g.angle), py = -Math.sin(g.angle);  // perpendicular
    const L = GATE_L * w, G = GATE_G * w;
    const guides = [-1, 1].map((s) => ({
      a: { x: c.x + px * G * s - ax * L, y: c.y + py * G * s - ay * L },
      b: { x: c.x + px * G * s + ax * L, y: c.y + py * G * s + ay * L },
    }));
    return { ...g, i, x: c.x, y: c.y, ax, ay, px, py, L, G, guides, sensor: { a: { x: c.x - px * G, y: c.y - py * G }, b: { x: c.x + px * G, y: c.y + py * G } }, flashT: 0 };
  });
  const spinners = spec.spinners.map((sp) => {
    const c = P([sp.u, sp.v]);
    const px = Math.cos(sp.angle), py = Math.sin(sp.angle);
    const hw = SPIN_HW * w;
    return {
      ...sp, x: c.x, y: c.y, px, py, hw, rot: 0, omega: 0, revs: 0, owner: null, flashT: 0,
      sensor: { a: { x: c.x - px * hw, y: c.y - py * hw }, b: { x: c.x + px * hw, y: c.y + py * hw } },
      posts: [{ x: c.x - px * hw, y: c.y - py * hw, r: 0.01 * w }, { x: c.x + px * hw, y: c.y + py * hw, r: 0.01 * w }],
    };
  });
  return {
    x0, y0, w, h, theme, spec,
    poly: spec.outline.map((p) => [x0 + p[0] * w, y0 + p[1] * h]),
    walls: spec.walls.map(seg),
    rails: spec.rails.map((r) => ({ ...seg(r), flashT: 0 })),
    tris: spec.tris.map((t) => {
      const pts = t.pts.map(P);
      const cx = (pts[0].x + pts[1].x + pts[2].x) / 3, cy = (pts[0].y + pts[1].y + pts[2].y) / 3;
      return { ...t, pts, edges: [0, 1, 2].map((i) => ({ a: pts[i], b: pts[(i + 1) % 3] })), cx, cy, flashT: 0 };
    }),
    pins: spec.pins.map((p) => ({ ...p, ...P([p.u, p.v]), r: p.r * w, flashT: 0 })),
    bumpers: spec.bumpers.map((b) => ({ ...b, ...P([b.u, b.v]), r: b.r * w, flashT: 0 })),
    holes: spec.holes.map((hh) => ({ ...hh, ...P([hh.u, hh.v]), r: hh.r * w, flashT: 0 })),
    gates, spinners,
    flippers: spec.flippers.map((f) => ({ ...f, px: x0 + f.pivot[0] * w, py: y0 + f.pivot[1] * h, len: f.len * w, angle: f.rest, flipT: -1e9 })),
    drainY: y0 + spec.drainV * h,
    exit: { x0: x0 + spec.exit.u0 * w, x1: x0 + spec.exit.u1 * w, flashT: 0 },
    forbid: { x0: x0 + spec.forbid.u0 * w, x1: x0 + spec.forbid.u1 * w, y0: y0 + spec.forbid.v0 * h, y1: y0 + spec.forbid.v1 * h },
    decor: spec.decor.map((line) => line.map(P)),
    plates: spec.plates.map((pl) => ({ x: x0 + pl.u * w, y: y0 + pl.v * h, w: pl.w * w, h: pl.h * h, ch: pl.ch * w })),
    labels: spec.labels.map((l) => ({ ...l, ...P([l.u, l.v]), px: l.size * w })),
    orbit: spec.orbit ? { x: x0 + spec.orbit.u * w, y: y0 + spec.orbit.v * h, r: spec.orbit.r * w, pts: spec.orbit.pts.map(P) } : null,
    swoosh: spec.swoosh ? { pts: spec.swoosh.pts.map(P) } : null,
    centroid: { x: x0 + 0.5 * w, y: y0 + 0.45 * h },
  };
}

export function flipperSegment(f) {
  return { a: { x: f.px, y: f.py }, b: { x: f.px + f.dir * f.len * Math.cos(f.angle), y: f.py + f.len * Math.sin(f.angle) } };
}

export function clampAim(board, x, y, margin) {
  const F = board.forbid;
  let px = x, py = y;
  if (!pointInPoly(px, py, board.poly)) {
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
