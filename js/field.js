// Slingo — deterministic scoring, the trap scan, and spec → pixel realisation.
//
// Machines are hand-built in js/machines.js from the layout kit; this module
// decides outcomes (pure luck, fixed at launch), audits layouts for V-pockets
// a ball could rest in, and maps normalised specs onto the screen.
import { SCORE_STEP, EXIT_MULTS, MIN_TOTAL_FRAC, round2 } from './config.js';

const rand = (a, b) => a + Math.random() * (b - a);
export const BALL_R = 0.017; // ball radius as a fraction of field width
export const LANE_X = 0.9;   // lane divider; the lane is LANE_X..0.98
export const LANE_CX = 0.94; // plunger / lane centre

// ---------------------------------------------------------------------------
// Outcome & steering
// ---------------------------------------------------------------------------
export function rollMultiplier(table) {
  let roll = Math.random();
  for (const [mult, p] of table) {
    roll -= p;
    if (roll <= 0) return mult;
  }
  return 0;
}

const SHARE = { 1: [0.12, 0.3], 2: [0.3, 0.55], 3: [0.55, 0.95] };

// The running total steers toward `ball.aim` — the total that, times the
// multiplier the ball's exit is expected to reveal, equals its prize. Awards
// are never zero: once the total is inside the band around the aim, components
// keep nudging it up and down, so bumpers, gates and spinners stay alive for
// the whole ball. Correctness does not depend on hitting the aim — the exit
// computes the exact multiplier for whatever total the ball arrives with.
export function awardFor(ball, sign, tier = 1) {
  const step = round2(SCORE_STEP * ball.stake);
  const nice = (x) => round2(Math.max(step, Math.round(x / step) * step));
  const [lo, hi] = SHARE[tier] || SHARE[1];
  const aim = ball.aim, band = Math.max(step * 2, aim * 0.12);
  const lively = () => nice(step * tier * rand(0.6, 1.6));
  if (sign > 0) {
    const gap = round2(aim - ball.total);
    if (gap > band) return Math.min(gap, nice(gap * rand(lo, hi)));
    if (ball.total > aim * 1.6) return step; // far over: barely nudge, let − pull back
    return lively();
  }
  const over = round2(ball.total - aim);
  const floor = MIN_TOTAL_FRAC * ball.stake;
  const stepsTo = (bound) => round2(Math.floor((ball.total - bound) / step) * step);
  const room = stepsTo(floor); // step-aligned headroom above the hard floor
  if (room <= 0) return 0;
  if (over > band) return -Math.min(room, over, nice(over * rand(Math.min(0.9, lo + 0.25), 1)));
  // Inside the band, take from the band's own depth so the total wobbles
  // instead of walking down to the floor and leaving − components nothing.
  const inBand = stepsTo(Math.max(floor, aim - band));
  if (inBand >= step) return -Math.min(inBand, lively());
  return -step;
}

// The aim: the running total the ball trends toward, so its exit multiplier
// lands on something satisfying. Losing balls still build a total — their exit
// simply reveals ×0. Snapped to the SCORE_STEP grid.
export function pickAim(target, stake) {
  const tot = EXIT_MULTS.reduce((s, [, w]) => s + w, 0);
  let roll = Math.random() * tot, m = 1;
  for (const [v, w] of EXIT_MULTS) { roll -= w; if (roll <= 0) { m = v; break; } }
  const raw = target > 0 ? target / m : stake * rand(0.6, 2.5);
  const step = SCORE_STEP * stake;
  const aim = Math.max(stake, Math.min(stake * 400, raw));
  return round2(Math.max(step, Math.round(aim / step) * step));
}

// The multiplier the exit reveals: total × M = the prize fixed at launch.
export function exitMultiplier(ball) {
  return ball.target / Math.max(SCORE_STEP * ball.stake, MIN_TOTAL_FRAC * ball.stake, ball.total);
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
export function segDist(x, y, a, b) {
  const c = closestOnSeg(x, y, a, b);
  return Math.hypot(x - c[0], y - c[1]);
}

// ---------------------------------------------------------------------------
// Trap scan (aspect-corrected units so the ball is a true circle)
// ---------------------------------------------------------------------------
export const ASPECT = 1.6;
export const GATE_L = 0.05, GATE_G = 0.04;
function gateGuides(g, A) {
  if (g.noGuides) return [];
  const ax = Math.sin(g.angle), ay = Math.cos(g.angle) / A;
  const px = Math.cos(g.angle), py = -Math.sin(g.angle) / A;
  const out = [];
  for (const s of [-1, 1]) {
    const cx = g.u + px * GATE_G * s, cy = g.v + py * GATE_G * s;
    out.push([[cx - ax * GATE_L, cy - ay * GATE_L], [cx + ax * GATE_L, cy + ay * GATE_L]]);
  }
  return out;
}
export const SPIN_HW = 0.045, ONEWAY_HW = 0.035, BANK_SP = 0.045, BANK_HW = 0.016;
function spinnerPosts(sp, A) {
  const px = Math.cos(sp.angle), py = Math.sin(sp.angle) / A;
  return [[sp.u - px * SPIN_HW, sp.v - py * SPIN_HW], [sp.u + px * SPIN_HW, sp.v + py * SPIN_HW]];
}
function bankTargets(bk, A) {
  const dx = Math.cos(bk.angle), dy = Math.sin(bk.angle) / A;
  const out = [];
  for (let k = -1; k <= 1; k++) {
    const cx = bk.u + dx * BANK_SP * k, cy = bk.v + dy * BANK_SP * k;
    out.push([[cx - dx * BANK_HW, cy - dy * BANK_HW], [cx + dx * BANK_HW, cy + dy * BANK_HW]]);
  }
  return out;
}
// Every solid surface of a spec in scan units (u, v·aspect).
export function specSurfaces(spec, A = ASPECT) {
  const S = (p) => [p[0], p[1] * A];
  const segs = spec.walls.map((w) => [S(w.a), S(w.b)]);
  for (const r of spec.rails) segs.push([S(r.a), S(r.b)]);
  for (const t of spec.tris) for (let i = 0; i < 3; i++) segs.push([S(t.pts[i]), S(t.pts[(i + 1) % 3])]);
  for (const g of spec.gates) for (const seg of gateGuides(g, A)) segs.push([S(seg[0]), S(seg[1])]);
  // A drop-target bank scans as one bar: a ball resting on its targets drops
  // them and falls through, so the gaps between targets can't hold a ball.
  for (const bk of spec.banks) {
    const t = bankTargets(bk, A);
    segs.push([S(t[0][0]), S(t[2][1])]);
  }
  const circles = [];
  for (const p of spec.pins) circles.push([p.u, p.v * A, p.r]);
  for (const b of spec.bumpers) circles.push([b.u, b.v * A, b.r]);
  for (const m of spec.magnets) circles.push([m.u, m.v * A, m.r]);
  // A moving bumper scans as the capsule it sweeps: a ball resting on the
  // sweep is bumped off by the moving cap, never wedged.
  const capsules = [];
  for (const mv of spec.movers) {
    const dx = Math.cos(mv.angle), dy = Math.sin(mv.angle);
    capsules.push([[mv.u - dx * mv.amp, (mv.v - (dy * mv.amp) / A) * A], [mv.u + dx * mv.amp, (mv.v + (dy * mv.amp) / A) * A], mv.r]);
  }
  for (const sp of spec.spinners) for (const post of spinnerPosts(sp, A)) circles.push([post[0], post[1] * A, 0.01]);
  return { segs, circles, capsules };
}
function inExempt(spec, u, v) {
  for (const z of spec.exempt || []) {
    if (z.r !== undefined) { if (Math.hypot(u - z.u, (v - z.v) * ASPECT) <= z.r) return true; }
    else if (u >= z.u && u <= z.u + z.w && v >= z.v && v <= z.v + z.h) return true;
  }
  return false;
}
// Finds a spot where a resting ball would touch surfaces on both its left and
// right from below — a V-pocket it could never leave. Returns the first one
// (in normalised coordinates) or null. `A` is the field's height/width.
export function findTrap(spec, A = ASPECT) {
  const { segs, circles, capsules } = specSurfaces(spec, A);
  const r = BALL_R, tol = 0.0025, step = 0.006;
  const poly = spec.outline.map((p) => [p[0], p[1] * A]);
  const CELL = 0.06, cols = Math.ceil(1 / CELL) + 1, rows = Math.ceil(A / CELL) + 1;
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
  for (const k of capsules) addBox(Math.min(k[0][0], k[1][0]) - k[2], Math.min(k[0][1], k[1][1]) - k[2], Math.max(k[0][0], k[1][0]) + k[2], Math.max(k[0][1], k[1][1]) + k[2], { k });
  for (let v = 0.06 * A; v < 0.96 * A; v += step) {
    for (let u = 0.03; u < 0.97; u += step) {
      const bucket = cells[Math.floor(v / CELL) * cols + Math.floor(u / CELL)];
      if (!bucket || bucket.length < 2) continue;
      if (!pointInPoly(u, v, poly)) continue;
      if (inExempt(spec, u, v / A)) continue;
      const contacts = [];
      let overlap = false;
      for (const item of bucket) {
        if (item.s || item.k) {
          const [a, b, kr = 0] = item.s || item.k;
          const c = closestOnSeg(u, v, a, b);
          const d = Math.hypot(u - c[0], v - c[1]);
          if (d < r + kr - tol) { overlap = true; break; }
          if (Math.abs(d - (r + kr)) < tol) contacts.push({ n: [(u - c[0]) / d, (v - c[1]) / d], p: [c[0] + ((u - c[0]) / d) * kr, c[1] + ((v - c[1]) / d) * kr] });
        } else {
          const [cx, cy, cr] = item.c;
          const d = Math.hypot(u - cx, v - cy);
          if (d < r + cr - tol) { overlap = true; break; }
          if (Math.abs(d - (r + cr)) < tol) contacts.push({ n: [(u - cx) / d, (v - cy) / d], p: [cx + ((u - cx) / d) * cr, cy + ((v - cy) / d) * cr] });
        }
      }
      if (overlap || contacts.length < 2) continue;
      const lefts = contacts.filter((c) => c.p[0] < u && c.n[0] > 0.25 && c.n[1] < -0.05);
      const rights = contacts.filter((c) => c.p[0] > u && c.n[0] < -0.25 && c.n[1] < -0.05);
      const pocket = lefts.some((l) => rights.some((rt) => Math.hypot(l.p[0] - rt.p[0], l.p[1] - rt.p[1]) > r * 0.6));
      if (pocket) return { u, v: v / A };
    }
  }
  return null;
}

// Layout audit: every component inside the cabinet, clear of walls, and not
// overlapping another. Returns a list of problems (empty = clean).
export function auditSpec(spec) {
  const problems = [];
  const circles = [];
  const push = (kind, it, r, label) => circles.push({ kind, u: it.u, v: it.v, r, label: label || it.label || '' });
  for (const p of spec.pins) push('pin', p, p.r);
  for (const b of spec.bumpers) push('bumper', b, b.r);
  for (const m of spec.magnets) push('magnet', m, m.r);
  for (const h of spec.holes) push('hole', h, h.r);
  for (const k of spec.kickouts) push('kickout', k, k.r);
  for (const mv of spec.movers) push('mover', mv, mv.r + mv.amp);
  for (const sp of spec.spinners) push('spinner', sp, SPIN_HW + 0.01);
  for (const bk of spec.banks) push('bank', bk, BANK_SP + BANK_HW);
  for (const g of spec.gates) push('gate', g, g.noGuides ? 0.02 : Math.max(GATE_L, GATE_G) * 0.9);
  for (const o of spec.oneways) if (!o.lane) push('oneway', o, ONEWAY_HW);
  const walls = spec.walls.map((w) => [w.a, w.b]);
  const S = (p) => [p[0], p[1] * ASPECT];
  for (const c of circles) {
    if (!pointInPoly(c.u, c.v, spec.outline) || c.u > LANE_X - 0.01) problems.push(`${c.kind} ${c.label} at (${c.u.toFixed(2)},${c.v.toFixed(2)}) is outside the cabinet`);
    if (c.kind === 'pin' && c.r <= 0.009) continue; // posts sit on wall ends on purpose
    if (c.kind === 'gate' || c.kind === 'spinner' || c.kind === 'bank' || c.kind === 'oneway') continue; // their own walls
    const [su, sv] = S([c.u, c.v]);
    for (const [a, b] of walls) {
      const d = segDist(su, sv, S(a), S(b));
      if (d < c.r + 0.004) { problems.push(`${c.kind} ${c.label} at (${c.u.toFixed(2)},${c.v.toFixed(2)}) overlaps a wall (${d.toFixed(3)})`); break; }
    }
  }
  for (let i = 0; i < circles.length; i++) {
    for (let j = i + 1; j < circles.length; j++) {
      const a = circles[i], b = circles[j];
      if (a.kind === 'gate' && b.kind === 'gate') continue; // twin lanes share a guide wall
      const d = Math.hypot(a.u - b.u, (a.v - b.v) * ASPECT);
      if (d < a.r + b.r + 0.004) problems.push(`${a.kind} ${a.label} (${a.u.toFixed(2)},${a.v.toFixed(2)}) overlaps ${b.kind} ${b.label} (${b.u.toFixed(2)},${b.v.toFixed(2)})`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Realise a spec into pixels
// ---------------------------------------------------------------------------
export function realize(spec, x0, y0, w, h) {
  const P = (uv) => ({ x: x0 + uv[0] * w, y: y0 + uv[1] * h });
  const seg = (s) => ({ ...s, a: P(s.a), b: P(s.b) });
  const gates = spec.gates.map((g, i) => {
    const c = P([g.u, g.v]);
    const ax = Math.sin(g.angle), ay = Math.cos(g.angle);
    const px = Math.cos(g.angle), py = -Math.sin(g.angle);
    const L = GATE_L * w, G = GATE_G * w;
    const guides = g.noGuides ? [] : [-1, 1].map((s) => ({
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
  const oneways = spec.oneways.map((o) => {
    const c = P([o.u, o.v]);
    const nx = Math.sin(o.angle), ny = Math.cos(o.angle);   // pass direction
    const px = Math.cos(o.angle), py = -Math.sin(o.angle);  // along the flap
    const hw = (o.lane ? 0.0475 : ONEWAY_HW) * w;
    return { ...o, x: c.x, y: c.y, nx, ny, px, py, hw, seg: { a: { x: c.x - px * hw, y: c.y - py * hw }, b: { x: c.x + px * hw, y: c.y + py * hw } }, flashT: 0 };
  });
  const banks = spec.banks.map((bk) => {
    const c = P([bk.u, bk.v]);
    const dx = Math.cos(bk.angle), dy = Math.sin(bk.angle);
    const sp = BANK_SP * w, hw = BANK_HW * w;
    const targets = [-1, 0, 1].map((k) => {
      const cx = c.x + dx * sp * k, cy = c.y + dy * sp * k;
      return { x: cx, y: cy, seg: { a: { x: cx - dx * hw, y: cy - dy * hw }, b: { x: cx + dx * hw, y: cy + dy * hw } }, down: false, flashT: 0 };
    });
    return { ...bk, x: c.x, y: c.y, dx, dy, sp, hw, targets, resetAt: 0, flashT: 0 };
  });
  const movers = spec.movers.map((mv) => {
    const c = P([mv.u, mv.v]);
    return { ...mv, cx: c.x, cy: c.y, x: c.x, y: c.y, r: mv.r * w, amp: mv.amp * w, dx: Math.cos(mv.angle), dy: Math.sin(mv.angle), phase: Math.random() * Math.PI * 2, flashT: 0 };
  });
  const lane = {
    x: x0 + LANE_CX * w, left: x0 + LANE_X * w, right: x0 + 0.98 * w,
    top: y0 + spec.lane.top * h, floor: y0 + spec.lane.floor * h, seatY: y0 + spec.lane.seatV * h, flapY: y0 + spec.lane.flapV * h,
  };
  return {
    x0, y0, w, h, spec, machine: spec.machine,
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
    kickouts: spec.kickouts.map((k) => ({ ...k, ...P([k.u, k.v]), r: k.r * w, ex: x0 + k.eu * w, ey: y0 + k.ev * h, flashT: 0, ejectT: 0 })),
    magnets: spec.magnets.map((m) => ({ ...m, ...P([m.u, m.v]), r: m.r * w, range: m.range * w, flashT: 0 })),
    gates, spinners, oneways, banks, movers, lane,
    flippers: spec.flippers.map((f) => ({ ...f, px: x0 + f.pivot[0] * w, py: y0 + f.pivot[1] * h, len: f.len * w, angle: f.rest, flipT: -1e9 })),
    drainY: y0 + spec.drainV * h,
    exit: { x0: x0 + spec.exit.u0 * w, x1: x0 + spec.exit.u1 * w, flashT: 0 },
    labels: spec.labels.map((l) => ({ ...l, ...P([l.u, l.v]), px: l.size * w })),
    inserts: spec.inserts.map((it) => ({ ...it, ...P([it.u, it.v]), r: it.r * w })),
    art: spec.art.map((a) => ({ ...a, x: x0 + a.u * w, y: y0 + a.v * h, W: (a.w || 0) * w, H: (a.h || 0) * h, R: (a.R || a.r || 0) * w })),
    ramps: spec.ramps.map((rp) => ({ ...rp, pts: rp.pts.map(P) })),
    P,
  };
}

export function flipperSegment(f) {
  return { a: { x: f.px, y: f.py }, b: { x: f.px + f.dir * f.len * Math.cos(f.angle), y: f.py + f.len * Math.sin(f.angle) } };
}
