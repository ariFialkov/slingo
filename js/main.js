// Slingo — slingshot pinball on procedurally generated boards.
import {
  BALL_TYPES, START_BALANCE, TOPUP_AMOUNT, BOARD_BALLS, PHYS, fmtMoney, round2,
} from './config.js';
import {
  generateSpec, realize, pickTheme, rollMultiplier, awardFor, residualFor,
  tierLabel, clampAim, flipperSegment,
} from './field.js';
import { initAudio, sfx, toggleMute } from './audio.js';

// ---------------------------------------------------------------------------
// Canvas / layout
// ---------------------------------------------------------------------------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const staticCanvas = document.createElement('canvas'); // cached cabinet render
const sctx = staticCanvas.getContext('2d');
let W = 0, H = 0, DPR = 1;
let board = null;
const sling = { ax: 0, ay: 0, maxPull: 0 };
const fieldRect = { x: 0, y: 0, w: 0, h: 0 };

function layout() {
  W = window.innerWidth;
  H = window.innerHeight;
  DPR = Math.min(window.devicePixelRatio || 1, 2.5);
  for (const c of [canvas, staticCanvas]) {
    c.width = Math.round(W * DPR);
    c.height = Math.round(H * DPR);
  }
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';

  const top = H * 0.07;
  const availH = H * 0.79 - top;
  const fw = Math.min(W * 0.94, availH * 0.8);
  const fh = Math.min(availH, fw / 0.58);
  fieldRect.x = (W - fw) / 2;
  fieldRect.y = top + (availH - fh) / 2;
  fieldRect.w = fw;
  fieldRect.h = fh;
  const old = board;
  if (state.spec) {
    board = realize(state.spec, fieldRect.x, fieldRect.y, fw, fh);
    buildStatic();
  }
  if (old && board) rescaleBalls(old, board);

  sling.ax = W / 2;
  sling.ay = H * 0.875;
  sling.maxPull = Math.min(Math.min(W, H) * 0.22, (H - sling.ay) * 1.6);
}

function rescaleBalls(oldF, newF) {
  const sx = newF.w / oldF.w, sy = newF.h / oldF.h;
  for (const b of state.balls) {
    b.x = newF.x0 + (b.x - oldF.x0) * sx;
    b.y = newF.y0 + (b.y - oldF.y0) * sy;
    b.vx *= sx; b.vy *= sy;
    b.r = PHYS.ballRadius * newF.w;
  }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const state = {
  balance: START_BALANCE,
  lastWin: 0,
  typeIdx: 0,
  spec: null,
  launched: 0,
  boardFadeT: 0,
  flights: [],
  balls: [],
  effects: [],
  drag: null,
  loaded: true,
  reloadAt: 0,
  shake: { mag: 0, t: 0 },
  now: performance.now(),
  last: performance.now(),
  settled: [],
  boards: 0,
};
window.__slingo = state;

const ballType = () => BALL_TYPES[state.typeIdx];
const theme = () => board.theme;
const phys = (k) => (theme().physics && theme().physics[k] !== undefined ? theme().physics[k] : PHYS[k]);

function newBoard(themeObj = pickTheme()) {
  state.spec = generateSpec(themeObj);
  state.launched = 0;
  state.boards++;
  state.boardFadeT = performance.now();
  layout();
  updateHUD();
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
const $balance = document.getElementById('balance');
const $lastwin = document.getElementById('lastwin');
const $inplay = document.getElementById('inplay');
const $toast = document.getElementById('toast');
const $type = document.getElementById('balltype');
const $typeDot = document.getElementById('balldot');
const $typeName = document.getElementById('ballname');
const $boardinfo = document.getElementById('boardinfo');
const $newboard = document.getElementById('newboard');
let toastTimer = 0;

function fieldEmpty() { return state.balls.length === 0 && state.flights.length === 0; }

function updateHUD() {
  $balance.textContent = fmtMoney(state.balance);
  $lastwin.textContent = state.lastWin > 0 ? 'WIN ' + fmtMoney(state.lastWin) : '';
  const n = state.balls.length + state.flights.length;
  $inplay.textContent = n ? `${n} IN PLAY` : '';
  const t = theme();
  $boardinfo.textContent = `${t.name} · ${Math.min(state.launched, BOARD_BALLS)}/${BOARD_BALLS}`;
  $boardinfo.style.color = t.primary;
  $newboard.disabled = !fieldEmpty();
}
function updateTypeUI() {
  const t = ballType();
  $typeDot.style.background = `radial-gradient(circle at 35% 35%, ${t.hi}, ${t.color})`;
  $typeDot.style.boxShadow = `0 0 10px ${t.color}`;
  $typeName.textContent = `${t.name} · ${fmtMoney(t.bet)}`;
}
function toast(msg) {
  $toast.textContent = msg;
  $toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.remove('show'), 1800);
}
const $topup = document.getElementById('topup');
$topup.textContent = '+' + fmtMoney(TOPUP_AMOUNT);
$topup.addEventListener('click', () => {
  state.balance += TOPUP_AMOUNT;
  toast(`+${fmtMoney(TOPUP_AMOUNT)} added`);
  updateHUD();
});
const $mute = document.getElementById('mute');
$mute.addEventListener('click', () => { $mute.textContent = toggleMute() ? '🔇' : '🔊'; });
$type.addEventListener('click', () => {
  initAudio();
  state.typeIdx = (state.typeIdx + 1) % BALL_TYPES.length;
  updateTypeUI();
  sfx.led();
});
$newboard.addEventListener('click', () => {
  if (!fieldEmpty()) return;
  initAudio();
  sfx.flip();
  newBoard();
});
// ---------------------------------------------------------------------------
// Slingshot input
// ---------------------------------------------------------------------------
canvas.addEventListener('pointerdown', (e) => {
  initAudio();
  if (state.drag) return;
  if (e.clientY < board.y0 + board.h + 6) return;
  canvas.setPointerCapture(e.pointerId);
  state.drag = { id: e.pointerId, px: e.clientX, py: e.clientY, buzzed: false };
  e.preventDefault();
});
canvas.addEventListener('pointermove', (e) => {
  const d = state.drag;
  if (!d || e.pointerId !== d.id) return;
  d.px = e.clientX;
  d.py = e.clientY;
  const p = pullPower();
  if (p >= 0.98 && !d.buzzed) {
    d.buzzed = true;
    if (navigator.vibrate) navigator.vibrate(18);
  } else if (p < 0.9) d.buzzed = false;
  e.preventDefault();
});
function endDrag(e) {
  const d = state.drag;
  if (!d || e.pointerId !== d.id) return;
  const power = pullPower();
  const from = pouchPos();
  const to = aimTarget();
  state.drag = null;
  if (power > 0.1) fire(from, to, power);
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', (e) => { if (state.drag && e.pointerId === state.drag.id) state.drag = null; });

function pouchPos() {
  const d = state.drag;
  if (!d) return { x: sling.ax, y: sling.ay };
  let dx = d.px - sling.ax, dy = d.py - sling.ay;
  const len = Math.hypot(dx, dy);
  if (len > sling.maxPull) { dx *= sling.maxPull / len; dy *= sling.maxPull / len; }
  return { x: sling.ax + dx, y: sling.ay + dy };
}
function pullPower() {
  const p = pouchPos();
  return Math.hypot(p.x - sling.ax, p.y - sling.ay) / sling.maxPull;
}
function aimTarget() {
  const p = pouchPos();
  const gain = (sling.ay - (board.y0 + board.h * 0.06)) / sling.maxPull;
  const x = sling.ax + (sling.ax - p.x) * gain;
  const y = sling.ay + (sling.ay - p.y) * gain;
  return clampAim(board, x, y, PHYS.ballRadius * board.w * 2.5);
}

function fire(from, to, power) {
  const type = ballType();
  if (type.bet > state.balance + 1e-9) {
    toast(`Not enough balance for a ${type.name} ball — tap ${$topup.textContent}`);
    return;
  }
  state.balance -= type.bet;
  const mult = rollMultiplier(theme().table);
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  state.flights.push({
    x0: from.x, y0: from.y, x1: to.x, y1: to.y,
    cx: (from.x + to.x) / 2, cy: Math.min(from.y, to.y) - (H * 0.05 + H * 0.06 * power),
    t: 0, dur: 300 + 220 * Math.min(1, dist / (H * 0.8)), power, type,
    stake: type.bet, mult, flips: theme().flips,
  });
  state.launched++;
  state.loaded = false;
  state.reloadAt = state.now + 120;
  sfx.fire(power);
  shake(0.25 + 0.75 * power);
  updateHUD();
}

function shake(mag) {
  state.shake.mag = Math.max(state.shake.mag, 3 + 8 * mag);
  state.shake.t = state.now;
}

function spawnBall(f) {
  const dx = f.x1 - f.x0, dy = f.y1 - f.y0;
  const len = Math.hypot(dx, dy) || 1;
  const [s0, s1] = PHYS.entrySpeed;
  const speed = board.h * (s0 + (s1 - s0) * f.power);
  const r = PHYS.ballRadius * board.w;
  state.balls.push({
    x: f.x1, y: f.y1, vx: (dx / len) * speed, vy: (dy / len) * speed, r,
    type: f.type, stake: f.stake, mult: f.mult, target: round2(f.mult * f.stake), total: 0,
    born: state.now, cd: new Map(), slowSince: 0, dying: null, hits: 0, flips: f.flips,
    lastComp: null, repeat: 0, overshoots: 0, ax: f.x1, ay: f.y1, at: state.now,
    sides: new Map(), gcd: new Map(),
  });
  sfx.hit();
  state.effects.push({ type: 'puff', x: f.x1, y: f.y1, t0: state.now, dur: 350 });
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------
function award(ball, comp, sign, tier, x, y) {
  const until = ball.cd.get(comp) || 0;
  if (state.now < until) return;
  ball.cd.set(comp, state.now + 160);
  comp.flashT = state.now;
  if (!comp.posts) { // spinners legitimately award repeatedly while they spin
    if (comp === ball.lastComp) ball.repeat++; else { ball.lastComp = comp; ball.repeat = 0; }
  }
  if (ball.repeat >= 3 || state.now - ball.born > PHYS.softLifeMs) {
    ball.vx += (Math.random() - 0.5) * 0.6 * board.h;
    ball.vy -= 0.25 * board.h;
    return;
  }
  ball.hits++;
  const a = awardFor(ball, sign, tier);
  if (a === 0) { sfx.miss(); return; }
  ball.total = round2(ball.total + a);
  (a > 0 ? sfx.fill : sfx.lose)();
  state.effects.push({
    type: 'float', x, y, text: (a > 0 ? '+' : '−') + fmtMoney(Math.abs(a)).slice(1),
    color: a > 0 ? '#7dffb9' : '#ff8d8d', t0: state.now, dur: 1000, size: 13 + 2 * tier,
  });
}

function settle(ball, x, y, where) {
  const res = residualFor(ball);
  ball.total = ball.target;
  ball.dying = { t0: state.now, x, y };
  state.balance += ball.target;
  state.settled.push({ target: ball.target, paid: ball.target, res, hits: ball.hits, life: Math.round(state.now - ball.born) });
  const win = ball.target > 0;
  if (win) state.lastWin = ball.target;
  if (where) where.flashT = state.now;
  const big = ball.mult >= 10;
  schedule(150, () => (win ? (big ? sfx.bigwin() : sfx.win()) : sfx.lose()));
  state.effects.push({
    type: 'reveal', x: Math.max(board.x0 + 62, Math.min(board.x0 + board.w - 62, x)), y: Math.min(y, board.y0 + board.h - 30),
    t0: state.now, dur: 2200,
    line1: (res >= 0 ? '+' : '−') + fmtMoney(Math.abs(res)).slice(1),
    line2: win ? `×${ball.mult} · ${fmtMoney(ball.target)}` : '×0',
    color: win ? '#7dffb9' : '#ff8d8d',
  });
  if (big) {
    state.effects.push({ type: 'banner', t0: state.now, dur: 2600, text: `${ball.type.name} BALL ×${ball.mult}`, sub: '+' + fmtMoney(ball.target).slice(1) });
    state.effects.push({ type: 'burst', x, y, t0: state.now, dur: 900 });
    shake(0.8);
  }
  updateHUD();
}

const pending = [];
function schedule(delay, fn) { pending.push({ at: state.now + delay, fn }); }

// ---------------------------------------------------------------------------
// Physics
// ---------------------------------------------------------------------------
const SUBSTEP = 1 / 240;

function stepPhysics(dtTotal) {
  let dt = Math.min(dtTotal, 0.05);
  while (dt > 0) {
    const h = Math.min(SUBSTEP, dt);
    for (const b of state.balls) if (!b.dying) integrate(b, h);
    ballPairs();
    dt -= h;
  }
  for (const b of state.balls) if (!b.dying) checkSensors(b);
  state.balls = state.balls.filter((b) => !b.dying || state.now - b.dying.t0 < 360);
}

function flipperAngle(f) {
  const t = state.now - f.flipT;
  if (t < 0 || t > 380) return f.rest;
  if (t < 110) return f.rest + (f.flip - f.rest) * (t / 110);
  if (t < 200) return f.flip;
  return f.flip + (f.rest - f.flip) * ((t - 200) / 180);
}

function integrate(b, h) {
  const F = board;
  const age = state.now - b.born;
  let g = phys('gravity') * F.h;
  if (age > PHYS.softLifeMs) g *= 1 + (age - PHYS.softLifeMs) / 3000;
  b.vy += g * h;
  const drag = Math.max(0, 1 - phys('drag') * h);
  b.vx *= drag; b.vy *= drag;
  const vmax = PHYS.maxSpeed * F.h;
  const sp = Math.hypot(b.vx, b.vy);
  if (sp > vmax) { b.vx *= vmax / sp; b.vy *= vmax / sp; }
  b.prevY = b.y;
  b.x += b.vx * h;
  b.y += b.vy * h;

  for (const s of F.walls) collideSegment(b, s, PHYS.restitutionWall);
  for (const g of F.gates) for (const gd of g.guides) collideSegment(b, gd, PHYS.restitutionWall);
  for (const sp of F.spinners) for (const post of sp.posts) collideCircle(b, post, PHYS.restitutionPin, 0);
  for (const s of F.rails) {
    if (collideSegment(b, s, PHYS.restitutionWall)) award(b, s, s.sign, s.tier, (s.a.x + s.b.x) / 2, (s.a.y + s.b.y) / 2 - 14);
  }
  for (const t of F.tris) {
    let hit = false;
    for (const e of t.edges) if (collideSegment(b, e, 0.7, 0.45 * F.h, t)) hit = true;
    if (hit) award(b, t, t.sign, t.tier, t.cx, t.cy - 18);
  }
  for (const p of F.pins) {
    if (collideCircle(b, p, PHYS.restitutionPin, 0)) {
      if (p.sign) award(b, p, p.sign, p.tier, p.x, p.y - p.r - 10);
      else p.flashT = state.now;
    }
  }
  for (const bp of F.bumpers) {
    if (collideCircle(b, bp, PHYS.restitutionBumper, PHYS.bumperKick * F.h)) {
      award(b, bp, bp.sign, bp.tier, bp.x, bp.y - bp.r - 10);
      shake(bp.tier === 3 ? 0.25 : 0.12);
    }
  }
  for (const f of F.flippers) {
    f.angle = flipperAngle(f);
    collideSegment(b, flipperSegment(f), 0.5);
  }
  if (b.x < F.x0 + b.r) { b.x = F.x0 + b.r; b.vx = Math.abs(b.vx) * 0.5; }
  if (b.x > F.x0 + F.w - b.r) { b.x = F.x0 + F.w - b.r; b.vx = -Math.abs(b.vx) * 0.5; }
  if (b.y < F.y0 + b.r) { b.y = F.y0 + b.r; b.vy = Math.abs(b.vy) * 0.5; }

  // slow-ball nudge
  if (Math.hypot(b.vx, b.vy) < 0.03 * F.h) {
    if (!b.slowSince) b.slowSince = state.now;
    else if (state.now - b.slowSince > 450) {
      b.vx += (Math.random() - 0.5) * 0.4 * F.h;
      b.vy -= 0.15 * F.h;
      b.slowSince = 0;
    }
  } else b.slowSince = 0;
  // trap detector: a ball that hasn't left a small region for 2.5 s is
  // bouncing in a pocket of geometry → launch it up and sideways
  if (Math.hypot(b.x - b.ax, b.y - b.ay) > b.r * 5) { b.ax = b.x; b.ay = b.y; b.at = state.now; }
  else if (state.now - b.at > 2500) {
    b.vx = (b.x < F.x0 + F.w / 2 ? 1 : -1) * (0.3 + Math.random() * 0.3) * F.h;
    b.vy = -(0.5 + Math.random() * 0.3) * F.h;
    b.at = state.now;
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
  if (vn < 0) {
    b.vx -= (1 + e) * vn * nx;
    b.vy -= (1 + e) * vn * ny;
  }
  if (kick) { b.vx += nx * kick; b.vy += ny * kick; }
  return true;
}

function ballPairs() {
  const bs = state.balls;
  for (let i = 0; i < bs.length; i++) {
    const a = bs[i];
    if (a.dying) continue;
    for (let j = i + 1; j < bs.length; j++) {
      const b = bs[j];
      if (b.dying) continue;
      let nx = b.x - a.x, ny = b.y - a.y;
      const d = Math.hypot(nx, ny);
      const rr2 = a.r + b.r;
      if (d >= rr2 || d < 1e-6) continue;
      nx /= d; ny /= d;
      const pen = (rr2 - d) / 2;
      a.x -= nx * pen; a.y -= ny * pen; b.x += nx * pen; b.y += ny * pen;
      const rvn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rvn < 0) {
        const jimp = -(1 + 0.8) * rvn / 2;
        a.vx -= jimp * nx; a.vy -= jimp * ny; b.vx += jimp * nx; b.vy += jimp * ny;
      }
    }
  }
}

// Which side of a sensor line the ball is on, and whether it's within its span.
function sideOf(b, s) { return Math.sign((s.b.x - s.a.x) * (b.y - s.a.y) - (s.b.y - s.a.y) * (b.x - s.a.x)); }
function withinSpan(b, s) {
  const abx = s.b.x - s.a.x, aby = s.b.y - s.a.y;
  const t = ((b.x - s.a.x) * abx + (b.y - s.a.y) * aby) / (abx * abx + aby * aby || 1e-9);
  return t >= 0 && t <= 1;
}
function crossed(b, comp, sensor, cooldown) {
  const side = sideOf(b, sensor);
  const prev = b.sides.get(comp);
  b.sides.set(comp, side);
  if (prev === undefined || prev === side || side === 0 || !withinSpan(b, sensor)) return false;
  if (state.now < (b.gcd.get(comp) || 0)) return false;
  b.gcd.set(comp, state.now + cooldown);
  return true;
}

// Gates: score, then boost / brake / warp the ball.
function gateCross(b, g) {
  if (!crossed(b, g, g.sensor, 500)) return;
  award(b, g, g.sign, g.tier, g.x - g.ax * (g.L + 12), g.y - g.ay * (g.L + 12));
  const sp = Math.hypot(b.vx, b.vy);
  let ax = g.ax, ay = g.ay;
  if (b.vx * ax + b.vy * ay < 0) { ax = -ax; ay = -ay; } // follow the ball's direction
  if (g.kind === 'boost') {
    const s = Math.max(sp * 1.6, 0.9 * board.h);
    b.vx = ax * s; b.vy = ay * s;
    sfx.fire(0.6);
  } else if (g.kind === 'brake') {
    b.vx = ax * sp * 0.35; b.vy = ay * sp * 0.35;
    sfx.miss();
  } else if (g.kind === 'warp' && g.twin !== undefined) {
    const t = board.gates[g.twin];
    state.effects.push({ type: 'puff', x: b.x, y: b.y, t0: state.now, dur: 400 });
    b.x = t.x + t.ax * (t.L + b.r * 2);
    b.y = t.y + t.ay * (t.L + b.r * 2);
    const s = Math.max(sp * 0.8, 0.4 * board.h);
    b.vx = t.ax * s; b.vy = t.ay * s;
    b.sides.set(t, sideOf(b, t.sensor));
    b.gcd.set(t, state.now + 600);
    t.flashT = state.now;
    b.ax = b.x; b.ay = b.y; b.at = state.now;
    state.effects.push({ type: 'puff', x: b.x, y: b.y, t0: state.now, dur: 400 });
    sfx.flip();
  }
}

// Spinners: the ball spins the paddle (and loses some speed); each revolution scores.
function spinnerCross(b, sp) {
  if (!crossed(b, sp, sp.sensor, 300)) return;
  const speed = Math.hypot(b.vx, b.vy);
  sp.omega = Math.max(10, Math.min(45, (speed / board.h) * 28)) * (sideOf(b, sp.sensor) > 0 ? 1 : -1);
  sp.owner = b; sp.revs = 0; sp.flashT = state.now;
  b.vx *= 0.72; b.vy *= 0.72;
  const jit = (Math.random() - 0.5) * 0.25, c = Math.cos(jit), s = Math.sin(jit);
  const vx = b.vx * c - b.vy * s, vy = b.vx * s + b.vy * c;
  b.vx = vx; b.vy = vy;
  sfx.led();
}
function updateSpinners(dt) {
  for (const sp of board.spinners) {
    if (Math.abs(sp.omega) < 0.3) { sp.omega = 0; continue; }
    const before = sp.rot;
    sp.rot += sp.omega * dt;
    sp.omega *= Math.exp(-1.4 * dt);
    if (Math.floor(before / (2 * Math.PI)) !== Math.floor(sp.rot / (2 * Math.PI)) && sp.revs < 5) {
      sp.revs++;
      const o = sp.owner;
      if (o && !o.dying && state.balls.includes(o)) { o.cd.delete(sp); award(o, sp, sp.sign, sp.tier, sp.x, sp.y - 20); }
    }
  }
}

function checkSensors(b) {
  const F = board;
  for (const g of F.gates) gateCross(b, g);
  for (const sp of F.spinners) spinnerCross(b, sp);
  for (const hole of F.holes) {
    if (Math.hypot(b.x - hole.x, b.y - hole.y) < hole.r * 0.62) { settle(b, hole.x, hole.y, hole); return; }
  }
  for (const f of F.flippers) {
    const reach = f.len * 0.95;
    const within = f.dir > 0 ? b.x > f.px - b.r && b.x < f.px + reach : b.x < f.px + b.r && b.x > f.px - reach;
    if (within && b.vy > 0 && b.y > f.py - F.h * 0.085 && b.y < f.py + F.h * 0.02 && b.flips > 0 && state.now - f.flipT > 400) {
      f.flipT = state.now;
      b.flips--;
      const k = PHYS.flipperKick * F.h;
      b.vx = f.dir * k * (0.25 + Math.random() * 0.3);
      b.vy = -k * (0.85 + Math.random() * 0.25);
      b.y = Math.min(b.y, f.py - F.h * 0.02);
      sfx.step();
      shake(0.2);
      state.effects.push({ type: 'puff', x: b.x, y: b.y, t0: state.now, dur: 300 });
    }
  }
  if (b.y > F.drainY) { settle(b, (F.exit.x0 + F.exit.x1) / 2, F.drainY - 14, F.exit); return; }
  if (state.now - b.born > PHYS.hardLifeMs) settle(b, (F.exit.x0 + F.exit.x1) / 2, F.drainY - 14, F.exit);
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------
function update() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - state.last) / 1000);
  state.last = now;
  state.now = now;
  for (let i = pending.length - 1; i >= 0; i--) if (now >= pending[i].at) pending.splice(i, 1)[0].fn();
  for (let i = state.flights.length - 1; i >= 0; i--) {
    const f = state.flights[i];
    f.t += (dt * 1000) / f.dur;
    if (f.t >= 1) { state.flights.splice(i, 1); spawnBall(f); updateHUD(); }
  }
  if (!state.loaded && now >= state.reloadAt) state.loaded = true;
  const hadBalls = state.balls.length;
  stepPhysics(dt);
  updateSpinners(dt);
  if (state.balls.length !== hadBalls) {
    updateHUD();
    if (fieldEmpty() && state.launched >= BOARD_BALLS && !state.boardPending) {
      state.boardPending = true;
      schedule(1500, () => { state.boardPending = false; if (fieldEmpty() && state.launched >= BOARD_BALLS) { sfx.flip(); newBoard(); } });
    }
  }
  state.effects = state.effects.filter((fx) => now - fx.t0 < fx.dur);
}

// ---------------------------------------------------------------------------
// Drawing helpers (work on any 2D context `c`)
// ---------------------------------------------------------------------------
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const flash = (comp, dur = 350) => (comp.flashT ? Math.max(0, 1 - (state.now - comp.flashT) / dur) : 0);
const SIGN_COL = (s) => (s > 0 ? '#39d97a' : '#e0455a');
const SIGN_DARK = (s) => (s > 0 ? '#12532c' : '#5a1520');
const GATE_COL = { boost: '#7dffb9', brake: '#7fd8ff', warp: '#ff5ed2' };

function rr(c, x, y, w, h, r) {
  c.beginPath();
  if (c.roundRect) c.roundRect(x, y, w, h, r);
  else c.rect(x, y, w, h);
}
function text(c, str, x, y, size, color, { bold = true, align = 'center', glow = 0, spacing = '', emboss = false } = {}) {
  c.font = `${bold ? '700' : '500'} ${size}px system-ui, -apple-system, sans-serif`;
  c.textAlign = align;
  c.textBaseline = 'middle';
  if (spacing && 'letterSpacing' in c) c.letterSpacing = spacing;
  if (emboss) { c.fillStyle = 'rgba(0,0,0,0.7)'; c.fillText(str, x + 1, y + 1.5); }
  if (glow) { c.shadowColor = color; c.shadowBlur = glow; }
  c.fillStyle = color;
  c.fillText(str, x, y);
  c.shadowBlur = 0;
  if (spacing && 'letterSpacing' in c) c.letterSpacing = '0px';
}
function polyPath(c, poly) {
  c.beginPath();
  c.moveTo(poly[0][0], poly[0][1]);
  for (let i = 1; i < poly.length; i++) c.lineTo(poly[i][0], poly[i][1]);
  c.closePath();
}
function linePath(c, pts) {
  c.beginPath();
  c.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y);
}
// Neon tube with depth: drop shadow, dark housing, lit core, specular highlight.
function tube(c, pathFn, color, width, glow = 10) {
  c.lineCap = 'round'; c.lineJoin = 'round';
  c.save(); c.translate(2, 3); pathFn(); c.strokeStyle = 'rgba(0,0,0,0.55)'; c.lineWidth = width + 3; c.stroke(); c.restore();
  pathFn(); c.strokeStyle = '#0b0d18'; c.lineWidth = width + 3.5; c.stroke();
  pathFn(); c.strokeStyle = color; c.lineWidth = width; c.shadowColor = color; c.shadowBlur = glow; c.stroke(); c.shadowBlur = 0;
  pathFn(); c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = Math.max(1, width * 0.3); c.stroke();
}
// Tapered lit curve: a filled ribbon whose width swells in the middle.
function taperedCurve(c, pts, color, wMax) {
  if (pts.length < 2) return;
  const L = [], R = [];
  for (let i = 0; i < pts.length; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[Math.min(pts.length - 1, i + 1)];
    let nx = -(p1.y - p0.y), ny = p1.x - p0.x;
    const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
    const t = i / (pts.length - 1);
    const w = wMax * (0.18 + 0.82 * Math.pow(Math.sin(Math.PI * t), 0.7));
    L.push({ x: pts[i].x + nx * w, y: pts[i].y + ny * w });
    R.push({ x: pts[i].x - nx * w, y: pts[i].y - ny * w });
  }
  const ribbon = () => {
    c.beginPath();
    c.moveTo(L[0].x, L[0].y);
    for (let i = 1; i < L.length; i++) c.lineTo(L[i].x, L[i].y);
    for (let i = R.length - 1; i >= 0; i--) c.lineTo(R[i].x, R[i].y);
    c.closePath();
  };
  // drop shadow, dark housing, then a lit ribbon that fades toward its edges
  c.save(); c.translate(3, 4); ribbon(); c.fillStyle = 'rgba(0,0,0,0.5)'; c.fill(); c.restore();
  ribbon(); c.fillStyle = '#0b0d18'; c.fill();
  c.save(); ribbon(); c.clip();
  c.globalAlpha = 0.55; c.fillStyle = color; c.shadowColor = color; c.shadowBlur = 18;
  linePath(c, pts); c.strokeStyle = color; c.lineWidth = wMax * 1.2; c.stroke();
  c.globalAlpha = 1; c.shadowBlur = 0;
  c.restore();
  ribbon(); c.strokeStyle = 'rgba(255,255,255,0.18)'; c.lineWidth = 1; c.stroke();
  linePath(c, pts); c.strokeStyle = '#ffffff'; c.globalAlpha = 0.85; c.lineWidth = 1.6; c.shadowColor = color; c.shadowBlur = 8; c.stroke(); c.shadowBlur = 0; c.globalAlpha = 1;
}
// Raised dome (pop bumper / disc) with housing, shadow and specular.
function dome(c, x, y, r, col, dark, rim) {
  c.beginPath(); c.ellipse(x + 3, y + 5, r * 1.05, r * 0.95, 0, 0, Math.PI * 2); c.fillStyle = 'rgba(0,0,0,0.55)'; c.fill();
  c.beginPath(); c.arc(x, y, r * 1.12, 0, Math.PI * 2);
  const hg = c.createRadialGradient(x, y, r * 0.8, x, y, r * 1.12);
  hg.addColorStop(0, '#2a3050'); hg.addColorStop(1, '#0c0e1c');
  c.fillStyle = hg; c.fill();
  c.strokeStyle = 'rgba(255,255,255,0.12)'; c.lineWidth = 1; c.stroke();
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
  const g = c.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.18, col); g.addColorStop(1, dark);
  c.fillStyle = g; c.shadowColor = rim; c.shadowBlur = 14; c.fill(); c.shadowBlur = 0;
  c.strokeStyle = rim; c.lineWidth = 2; c.stroke();
  c.beginPath(); c.ellipse(x - r * 0.3, y - r * 0.45, r * 0.32, r * 0.16, -0.5, 0, Math.PI * 2);
  c.fillStyle = 'rgba(255,255,255,0.55)'; c.fill();
}
// Metal post (pin).
function post(c, x, y, r, col, lit) {
  c.beginPath(); c.arc(x + 1.5, y + 2.5, r * 1.05, 0, Math.PI * 2); c.fillStyle = 'rgba(0,0,0,0.5)'; c.fill();
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
  const g = c.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, col); g.addColorStop(1, lit ? SIGN_DARK(lit) : '#2a3450');
  c.fillStyle = g;
  if (lit) { c.shadowColor = col; c.shadowBlur = 10; }
  c.fill(); c.shadowBlur = 0;
}
// Chamfered plate with bevel.
function chamferPath(c, x, y, w, h, ch) {
  c.beginPath();
  c.moveTo(x + ch, y); c.lineTo(x + w - ch, y); c.lineTo(x + w, y + ch); c.lineTo(x + w, y + h - ch);
  c.lineTo(x + w - ch, y + h); c.lineTo(x + ch, y + h); c.lineTo(x, y + h - ch); c.lineTo(x, y + ch); c.closePath();
}

let noisePattern = null;
function getNoise(c) {
  if (noisePattern) return noisePattern;
  const n = document.createElement('canvas');
  n.width = n.height = 128;
  const nc = n.getContext('2d');
  const img = nc.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 100 + Math.random() * 155;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  nc.putImageData(img, 0, 0);
  noisePattern = c.createPattern(n, 'repeat');
  return noisePattern;
}

// ---------------------------------------------------------------------------
// Static cabinet layer (rendered once per board / resize)
// ---------------------------------------------------------------------------
function buildStatic() {
  const c = sctx, F = board, T = theme();
  c.setTransform(DPR, 0, 0, DPR, 0, 0);
  c.clearRect(0, 0, W, H);
  c.lineJoin = 'round'; c.lineCap = 'round';

  // --- shell: layered carbon plates with bevel --------------------------------
  c.save(); c.translate(0, 10); polyPath(c, F.poly); c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = 40; c.shadowColor = '#000'; c.shadowBlur = 30; c.stroke(); c.restore();
  polyPath(c, F.poly); c.strokeStyle = '#090b12'; c.lineWidth = 40; c.stroke();
  polyPath(c, F.poly); c.strokeStyle = '#151927'; c.lineWidth = 30; c.stroke();
  c.save(); polyPath(c, F.poly); c.strokeStyle = '#000'; c.lineWidth = 30; c.globalAlpha = 0.18; c.strokeStyle = getNoise(c); c.stroke(); c.restore();
  polyPath(c, F.poly); c.strokeStyle = 'rgba(255,255,255,0.09)'; c.lineWidth = 1.5; c.save(); c.translate(-1, -1); c.stroke(); c.restore();
  polyPath(c, F.poly); c.strokeStyle = '#0a0c14'; c.lineWidth = 12; c.stroke();
  // shell seams
  c.strokeStyle = 'rgba(255,255,255,0.06)'; c.lineWidth = 1;
  for (let i = 0; i < F.poly.length; i++) {
    const p = F.poly[i], cx = F.x0 + F.w / 2, cy = F.y0 + F.h / 2;
    const dx = p[0] - cx, dy = p[1] - cy, l = Math.hypot(dx, dy) || 1;
    c.beginPath(); c.moveTo(p[0] + (dx / l) * 6, p[1] + (dy / l) * 6); c.lineTo(p[0] + (dx / l) * 20, p[1] + (dy / l) * 20); c.stroke();
  }

  // --- table surface ---------------------------------------------------------
  polyPath(c, F.poly);
  const g = c.createLinearGradient(0, F.y0, 0, F.y0 + F.h);
  g.addColorStop(0, T.surface[0]); g.addColorStop(1, T.surface[1]);
  c.fillStyle = g; c.fill();
  c.save();
  polyPath(c, F.poly); c.clip();
  // brushed texture
  c.globalAlpha = 0.07; c.fillStyle = getNoise(c); c.fillRect(F.x0, F.y0, F.w, F.h); c.globalAlpha = 1;
  // ambient light pool
  const rg = c.createRadialGradient(F.x0 + F.w * 0.5, F.y0 + F.h * 0.38, 10, F.x0 + F.w * 0.5, F.y0 + F.h * 0.38, F.w * 0.9);
  rg.addColorStop(0, T.glow.replace('0.55', '0.16')); rg.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = rg; c.fillRect(F.x0, F.y0, F.w, F.h);
  // fine grid
  c.strokeStyle = 'rgba(255,255,255,0.035)'; c.lineWidth = 1;
  const gs = F.w / 12;
  for (let x = F.x0; x <= F.x0 + F.w; x += gs) { c.beginPath(); c.moveTo(x, F.y0); c.lineTo(x, F.y0 + F.h); c.stroke(); }
  for (let y = F.y0; y <= F.y0 + F.h; y += gs) { c.beginPath(); c.moveTo(F.x0, y); c.lineTo(F.x0 + F.w, y); c.stroke(); }
  // sector plates
  for (const pl of F.plates) {
    c.save(); c.translate(2, 3); chamferPath(c, pl.x, pl.y, pl.w, pl.h, pl.ch); c.fillStyle = 'rgba(0,0,0,0.35)'; c.fill(); c.restore();
    chamferPath(c, pl.x, pl.y, pl.w, pl.h, pl.ch);
    const pg = c.createLinearGradient(pl.x, pl.y, pl.x, pl.y + pl.h);
    pg.addColorStop(0, 'rgba(255,255,255,0.06)'); pg.addColorStop(1, 'rgba(0,0,0,0.18)');
    c.fillStyle = pg; c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.1)'; c.lineWidth = 1; c.stroke();
    c.strokeStyle = T.secondary; c.globalAlpha = 0.25; c.setLineDash([6, 4]); c.lineWidth = 1;
    chamferPath(c, pl.x + 4, pl.y + 4, pl.w - 8, pl.h - 8, Math.max(2, pl.ch - 3)); c.stroke();
    c.setLineDash([]); c.globalAlpha = 1;
  }
  // circuit traces
  c.strokeStyle = T.secondary; c.globalAlpha = 0.25; c.lineWidth = 1.5;
  for (const line of F.decor) {
    linePath(c, line); c.stroke();
    for (const p of line) { c.beginPath(); c.arc(p.x, p.y, 2.2, 0, Math.PI * 2); c.fillStyle = T.secondary; c.fill(); }
  }
  c.globalAlpha = 1;
  // orbit halo ticks
  if (F.orbit) {
    c.strokeStyle = T.secondary; c.globalAlpha = 0.2; c.lineWidth = 1;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 18) {
      c.beginPath();
      c.moveTo(F.orbit.x + Math.cos(a) * F.orbit.r * 0.78, F.orbit.y + Math.sin(a) * F.orbit.r * 0.78);
      c.lineTo(F.orbit.x + Math.cos(a) * F.orbit.r * 0.84, F.orbit.y + Math.sin(a) * F.orbit.r * 0.84);
      c.stroke();
    }
    c.globalAlpha = 1;
  }
  // inner shadow (vignette) along the walls
  polyPath(c, F.poly); c.strokeStyle = 'rgba(0,0,0,0.75)'; c.lineWidth = 46; c.shadowColor = '#000'; c.shadowBlur = 24; c.stroke(); c.shadowBlur = 0;

  // --- labels ------------------------------------------------------------------
  for (const l of F.labels) {
    if (l.main) {
      const size = Math.max(9, l.px * 0.55);
      c.font = `700 ${size}px system-ui, -apple-system, sans-serif`;
      const tw = c.measureText(l.text).width + 4;
      const total = tw + 16 + 30 + 36;
      const x0 = l.x - total / 2;
      text(c, l.text, x0 + tw / 2, l.y, size, T.primary, { glow: 10, spacing: '2px', emboss: true });
      const px = x0 + tw + 16 + 30, py = l.y;
      text(c, 'RISK', px - 18, py, 8, 'rgba(255,255,255,0.55)');
      for (let i = 0; i < 4; i++) { rr(c, px + i * 9, py - 3, 6, 6, 1.5); c.fillStyle = i < T.risk ? T.primary : 'rgba(255,255,255,0.15)'; c.fill(); }
    } else text(c, l.text, l.x, l.y, Math.max(8, l.px * 0.5), 'rgba(255,255,255,0.28)', { spacing: '1px', emboss: true });
  }

  // --- exit well ---------------------------------------------------------------
  {
    const ex0 = F.exit.x0 + 6, ex1 = F.exit.x1 - 6, wellTop = F.y0 + F.h * 0.965;
    rr(c, ex0, wellTop + 2, ex1 - ex0, F.y0 + F.h - wellTop + 30, 4);
    const wg = c.createLinearGradient(0, wellTop, 0, F.y0 + F.h);
    wg.addColorStop(0, '#000'); wg.addColorStop(1, '#10131f');
    c.fillStyle = wg; c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.08)'; c.lineWidth = 1; c.stroke();
    text(c, '? EXIT', (ex0 + ex1) / 2, (wellTop + F.drainY) / 2 + 1, Math.min(10, F.h * 0.016), 'rgba(255,255,255,0.5)', { spacing: '2px' });
  }

  // --- holes & baskets (recessed) -------------------------------------------
  for (const hole of F.holes) {
    if (hole.kind === 'basket') {
      c.beginPath(); c.arc(hole.x, hole.y, hole.r * 0.92, 0, Math.PI); c.closePath();
      const bgd = c.createLinearGradient(0, hole.y, 0, hole.y + hole.r); bgd.addColorStop(0, '#02030a'); bgd.addColorStop(1, '#1a1e33');
      c.fillStyle = bgd; c.fill();
      const cup = () => { c.beginPath(); c.arc(hole.x, hole.y, hole.r, 0, Math.PI, false); c.lineTo(hole.x - hole.r, hole.y - hole.r * 0.6); c.moveTo(hole.x + hole.r, hole.y); c.lineTo(hole.x + hole.r, hole.y - hole.r * 0.6); };
      tube(c, cup, T.secondary, 3, 8);
    } else {
      c.beginPath(); c.arc(hole.x, hole.y, hole.r * 1.25, 0, Math.PI * 2);
      const rim = c.createRadialGradient(hole.x, hole.y, hole.r, hole.x, hole.y, hole.r * 1.25); rim.addColorStop(0, '#2a3050'); rim.addColorStop(1, 'rgba(20,24,40,0)');
      c.fillStyle = rim; c.fill();
      c.beginPath(); c.arc(hole.x, hole.y, hole.r, 0, Math.PI * 2);
      const hg = c.createRadialGradient(hole.x + hole.r * 0.2, hole.y + hole.r * 0.3, hole.r * 0.1, hole.x, hole.y, hole.r);
      hg.addColorStop(0, '#000'); hg.addColorStop(0.7, '#05060f'); hg.addColorStop(1, '#1c2140');
      c.fillStyle = hg; c.fill();
      c.strokeStyle = T.secondary; c.lineWidth = 2; c.shadowColor = T.secondary; c.shadowBlur = 8; c.stroke(); c.shadowBlur = 0;
      c.beginPath(); c.arc(hole.x, hole.y, hole.r - 2, Math.PI * 1.1, Math.PI * 1.9); c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 1.2; c.stroke();
    }
    text(c, '?', hole.x, hole.y + (hole.kind === 'basket' ? 2 : 1), hole.r * 1.1, 'rgba(255,255,255,0.5)');
  }

  // --- gates: recessed channel between two guide tubes, kind icon, sensor -------
  for (const g of F.gates) {
    const col = GATE_COL[g.kind];
    c.save(); c.translate(g.x, g.y); c.rotate(-g.angle);
    rr(c, -g.G + 3, -g.L, (g.G - 3) * 2, g.L * 2, 4);
    const cg = c.createLinearGradient(-g.G, 0, g.G, 0); cg.addColorStop(0, 'rgba(0,0,0,0.55)'); cg.addColorStop(0.5, 'rgba(0,0,0,0.25)'); cg.addColorStop(1, 'rgba(0,0,0,0.55)');
    c.fillStyle = cg; c.fill();
    c.strokeStyle = col; c.lineWidth = 1.6; c.globalAlpha = 0.8; c.lineCap = 'round';
    if (g.kind === 'boost') {
      for (let k = -1; k <= 1; k++) { c.beginPath(); c.moveTo(-6, k * 11 - 4); c.lineTo(0, k * 11 + 2); c.lineTo(6, k * 11 - 4); c.stroke(); }
    } else if (g.kind === 'brake') {
      for (let k = -1; k <= 1; k++) { c.beginPath(); c.moveTo(-6, k * 9); c.lineTo(6, k * 9); c.stroke(); }
    } else {
      c.beginPath(); c.moveTo(0, -9); c.lineTo(7, 0); c.lineTo(0, 9); c.lineTo(-7, 0); c.closePath(); c.stroke();
      c.beginPath(); c.arc(0, 0, 3, 0, Math.PI * 2); c.fillStyle = col; c.fill();
    }
    c.globalAlpha = 1;
    c.restore();
    for (const gd of g.guides) tube(c, () => { c.beginPath(); c.moveTo(gd.a.x, gd.a.y); c.lineTo(gd.b.x, gd.b.y); }, T.secondary, 2.5, 6);
    for (const gd of g.guides) { post(c, gd.a.x, gd.a.y, 3.2, '#dfe7ff', 0); post(c, gd.b.x, gd.b.y, 3.2, '#dfe7ff', 0); }
    c.setLineDash([3, 3]); c.strokeStyle = col; c.globalAlpha = 0.7; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(g.sensor.a.x, g.sensor.a.y); c.lineTo(g.sensor.b.x, g.sensor.b.y); c.stroke(); c.setLineDash([]); c.globalAlpha = 1;
    text(c, tierLabel(g.sign, g.tier), g.x - g.ax * (g.L + 11), g.y - g.ay * (g.L + 11), 11, '#7dffb9', { emboss: true });
    const name = g.kind === 'warp' ? `WARP ${g.i < g.twin ? 'A' : 'B'}` : g.kind === 'boost' ? 'BOOST' : 'SLOW';
    text(c, name, g.x + g.ax * (g.L + 10), g.y + g.ay * (g.L + 10), 7, col, { spacing: '1px', emboss: true });
  }
  // --- spinners: axle housing between two posts (paddle drawn dynamically) ----
  for (const sp of F.spinners) {
    c.save(); c.translate(sp.x, sp.y); c.rotate(sp.angle);
    rr(c, -sp.hw, -7, sp.hw * 2, 14, 3); c.fillStyle = 'rgba(0,0,0,0.4)'; c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.12)'; c.lineWidth = 1; c.stroke();
    c.beginPath(); c.moveTo(-sp.hw, 0); c.lineTo(sp.hw, 0); c.strokeStyle = '#6d7aa6'; c.lineWidth = 2; c.stroke();
    c.restore();
    for (const p of sp.posts) post(c, p.x, p.y, p.r, '#dfe7ff', 0);
    text(c, '+ SPIN', sp.x, sp.y - 16, 8, '#7dffb9', { spacing: '1px', emboss: true });
  }

  // --- walls: outline tube, guides, tapered curves -----------------------------
  const outline = F.walls.filter((s) => s.neon);
  tube(c, () => { c.beginPath(); for (const s of outline) { c.moveTo(s.a.x, s.a.y); c.lineTo(s.b.x, s.b.y); } }, T.primary, 3.5, 12);
  for (const s of F.walls.filter((s) => s.cap)) {
    tube(c, () => { c.beginPath(); c.moveTo(s.a.x, s.a.y); c.lineTo(s.b.x, s.b.y); }, T.secondary, 2.5, 6);
    post(c, s.a.x, s.a.y, 3.5, '#dfe7ff', 0);
  }
  if (F.orbit && F.orbit.pts.length > 1) taperedCurve(c, F.orbit.pts, T.primary, 7);
  if (F.swoosh && F.swoosh.pts.length > 1) taperedCurve(c, F.swoosh.pts, T.secondary, 6);

  // --- signed rails ---------------------------------------------------------
  for (const s of F.rails) {
    tube(c, () => { c.beginPath(); c.moveTo(s.a.x, s.a.y); c.lineTo(s.b.x, s.b.y); }, SIGN_COL(s.sign), 6, 12);
    text(c, tierLabel(s.sign, s.tier), (s.a.x + s.b.x) / 2, (s.a.y + s.b.y) / 2 - 14, 13, SIGN_COL(s.sign), { glow: 6, emboss: true });
  }

  // --- triangle kickers (extruded) --------------------------------------------
  for (const t of F.tris) {
    const col = SIGN_COL(t.sign);
    const tri = () => { c.beginPath(); c.moveTo(t.pts[0].x, t.pts[0].y); c.lineTo(t.pts[1].x, t.pts[1].y); c.lineTo(t.pts[2].x, t.pts[2].y); c.closePath(); };
    c.save(); c.translate(3, 5); tri(); c.fillStyle = 'rgba(0,0,0,0.55)'; c.fill(); c.restore();
    tri();
    const tg = c.createLinearGradient(t.cx, t.cy - 30, t.cx, t.cy + 30); tg.addColorStop(0, '#232a48'); tg.addColorStop(1, '#0c0f1e');
    c.fillStyle = tg; c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.12)'; c.lineWidth = 6; c.stroke();
    tube(c, tri, col, 3, 10);
    text(c, tierLabel(t.sign, t.tier), t.cx, t.cy, 12, col, { glow: 6, emboss: true });
  }

  // --- pins ---------------------------------------------------------------------
  for (const p of F.pins) {
    post(c, p.x, p.y, p.r, p.sign ? SIGN_COL(p.sign) : '#aebfe8', p.sign);
    if (p.sign) text(c, p.sign > 0 ? '+' : '−', p.x, p.y - p.r - 7, 10, SIGN_COL(p.sign), { emboss: true });
  }

  // --- bumpers ------------------------------------------------------------------
  for (const bp of F.bumpers) {
    const col = SIGN_COL(bp.sign);
    if (bp.kind === 'pop') {
      dome(c, bp.x, bp.y, bp.r, bp.sign > 0 ? '#5ff0a0' : '#ff8a9a', SIGN_DARK(bp.sign), col);
      text(c, tierLabel(bp.sign, bp.tier), bp.x, bp.y + 1, bp.r * 0.9, '#fff', { glow: 4, emboss: true });
    } else {
      const ring = bp.kind === 'reactor' ? T.primary : T.secondary;
      // raised platform
      c.beginPath(); c.ellipse(bp.x + 3, bp.y + 6, bp.r * 1.3, bp.r * 1.2, 0, 0, Math.PI * 2); c.fillStyle = 'rgba(0,0,0,0.6)'; c.fill();
      c.beginPath(); c.arc(bp.x, bp.y, bp.r * 1.28, 0, Math.PI * 2);
      const pg = c.createRadialGradient(bp.x, bp.y, bp.r, bp.x, bp.y, bp.r * 1.28); pg.addColorStop(0, '#2c3354'); pg.addColorStop(1, '#0d1020');
      c.fillStyle = pg; c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.15)'; c.lineWidth = 1; c.stroke();
      // tick ring
      c.strokeStyle = ring; c.globalAlpha = 0.7; c.lineWidth = 1.5;
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 16) {
        c.beginPath(); c.moveTo(bp.x + Math.cos(a) * bp.r * 1.08, bp.y + Math.sin(a) * bp.r * 1.08); c.lineTo(bp.x + Math.cos(a) * bp.r * 1.18, bp.y + Math.sin(a) * bp.r * 1.18); c.stroke();
      }
      c.globalAlpha = 1;
      tube(c, () => { c.beginPath(); c.arc(bp.x, bp.y, bp.r, 0, Math.PI * 2); }, ring, 3, 12);
      // glass core
      c.beginPath(); c.arc(bp.x, bp.y, bp.r * 0.62, 0, Math.PI * 2);
      const cg = c.createRadialGradient(bp.x - bp.r * 0.2, bp.y - bp.r * 0.25, 1, bp.x, bp.y, bp.r * 0.62);
      cg.addColorStop(0, '#ffffff'); cg.addColorStop(0.25, ring); cg.addColorStop(1, '#070812');
      c.fillStyle = cg; c.shadowColor = ring; c.shadowBlur = 16; c.fill(); c.shadowBlur = 0;
      text(c, bp.kind === 'reactor' ? 'CORE' : 'BONUS', bp.x, bp.y - bp.r * 0.16, Math.max(7, bp.r * 0.22), '#fff', { spacing: '1px', emboss: true });
      text(c, tierLabel(bp.sign, bp.tier), bp.x, bp.y + bp.r * 0.2, Math.max(9, bp.r * 0.3), col, { glow: 6, emboss: true });
    }
  }
  c.restore(); // end clip
}

// ---------------------------------------------------------------------------
// Frame rendering: static layer + dynamic overlay
// ---------------------------------------------------------------------------
function render() {
  const now = state.now;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const sAge = now - state.shake.t;
  if (state.shake.mag > 0 && sAge < 320) {
    const m = state.shake.mag * (1 - sAge / 320);
    ctx.translate((Math.random() * 2 - 1) * m, (Math.random() * 2 - 1) * m);
  } else state.shake.mag = 0;

  const T = theme();
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#05060b'); bg.addColorStop(0.5, '#090b15'); bg.addColorStop(1, '#04050a');
  ctx.fillStyle = bg;
  ctx.fillRect(-20, -20, W + 40, H + 40);

  const fade = Math.min(1, (now - state.boardFadeT) / 600);
  ctx.globalAlpha = fade;
  ctx.drawImage(staticCanvas, 0, 0, staticCanvas.width, staticCanvas.height, 0, 0, W, H);
  drawDynamic(T, now);
  ctx.globalAlpha = 1;
  drawFlights();
  drawBalls(now);
  drawSlingshot(now, T);
  drawEffects(now);
}

function drawDynamic(T, now) {
  const F = board;
  ctx.save();
  polyPath(ctx, F.poly); ctx.clip();

  if (state.drag) {
    const z = F.forbid;
    ctx.save();
    rr(ctx, z.x0, z.y0, z.x1 - z.x0, F.y0 + F.h - z.y0, 6); ctx.clip();
    ctx.strokeStyle = 'rgba(255,90,90,0.35)'; ctx.lineWidth = 2;
    for (let d = -F.h; d < F.w + F.h; d += 12) { ctx.beginPath(); ctx.moveTo(z.x0 + d, z.y0); ctx.lineTo(z.x0 + d - 60, z.y0 + 60); ctx.stroke(); }
    ctx.restore();
    text(ctx, 'NO AIM', (z.x0 + z.x1) / 2, z.y0 + 16, 9, 'rgba(255,120,120,0.8)', { spacing: '2px' });
  }

  // exit / holes lit on settle
  const fe = flash(F.exit, 900);
  if (fe) {
    const ex0 = F.exit.x0 + 6, ex1 = F.exit.x1 - 6, wellTop = F.y0 + F.h * 0.965;
    rr(ctx, ex0, wellTop + 2, ex1 - ex0, F.y0 + F.h - wellTop + 30, 4);
    ctx.fillStyle = `rgba(255,214,90,${0.6 * fe})`; ctx.fill();
  }
  for (const hole of F.holes) {
    const f = flash(hole, 900);
    if (!f) continue;
    ctx.beginPath(); ctx.arc(hole.x, hole.y, hole.r * (1 + 0.5 * (1 - f)), 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,214,90,${f})`; ctx.lineWidth = 3; ctx.shadowColor = '#ffd65a'; ctx.shadowBlur = 16 * f; ctx.stroke(); ctx.shadowBlur = 0;
  }
  // gates lit
  for (const g of F.gates) {
    const f = flash(g, 600);
    if (!f) continue;
    const col = GATE_COL[g.kind];
    ctx.save(); ctx.translate(g.x, g.y); ctx.rotate(-g.angle);
    rr(ctx, -g.G + 3, -g.L, (g.G - 3) * 2, g.L * 2, 4);
    ctx.fillStyle = col; ctx.globalAlpha = 0.45 * f; ctx.shadowColor = col; ctx.shadowBlur = 20 * f; ctx.fill();
    ctx.restore(); ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  }
  // spinner paddles (rotate about the axle; foreshortened by cos)
  for (const sp of F.spinners) {
    const spinning = sp.omega !== 0;
    const thick = 2.5 + 6 * Math.abs(Math.cos(sp.rot));
    const facing = Math.cos(sp.rot) >= 0;
    ctx.save(); ctx.translate(sp.x, sp.y); ctx.rotate(sp.angle);
    ctx.save(); ctx.translate(2, 3); rr(ctx, -sp.hw * 0.82, -thick / 2, sp.hw * 1.64, thick, 2); ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fill(); ctx.restore();
    rr(ctx, -sp.hw * 0.82, -thick / 2, sp.hw * 1.64, thick, 2);
    const pg = ctx.createLinearGradient(0, -thick / 2, 0, thick / 2);
    pg.addColorStop(0, facing ? '#e8f0ff' : '#7dffb9'); pg.addColorStop(1, facing ? '#5a6690' : '#1d8a4a');
    ctx.fillStyle = pg;
    if (spinning) { ctx.shadowColor = '#7dffb9'; ctx.shadowBlur = 12; }
    ctx.fill(); ctx.shadowBlur = 0;
    ctx.strokeStyle = spinning ? '#7dffb9' : 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();
  }
  // rails / tris / pins flash
  for (const s of F.rails) {
    const f = flash(s); if (!f) continue;
    neon(ctx, () => { ctx.beginPath(); ctx.moveTo(s.a.x, s.a.y); ctx.lineTo(s.b.x, s.b.y); }, `rgba(255,255,255,${f})`, 4, 18 * f);
  }
  for (const t of F.tris) {
    const f = flash(t); if (!f) continue;
    ctx.beginPath(); ctx.moveTo(t.pts[0].x, t.pts[0].y); ctx.lineTo(t.pts[1].x, t.pts[1].y); ctx.lineTo(t.pts[2].x, t.pts[2].y); ctx.closePath();
    ctx.fillStyle = SIGN_COL(t.sign); ctx.globalAlpha = 0.6 * f; ctx.fill(); ctx.globalAlpha = 1;
  }
  for (const p of F.pins) {
    const f = flash(p, 250); if (!f) continue;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 6 * (1 - f), 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,255,255,${f})`; ctx.lineWidth = 2; ctx.stroke();
  }
  // bumpers: rotating ring on reactor/bonus, hit ring + flash
  for (const bp of F.bumpers) {
    const f = flash(bp);
    const ring = bp.kind === 'reactor' ? T.primary : bp.kind === 'bonus' ? T.secondary : SIGN_COL(bp.sign);
    if (bp.kind !== 'pop') {
      ctx.setLineDash([3, 5]); ctx.strokeStyle = ring; ctx.lineWidth = 2; ctx.globalAlpha = 0.8;
      ctx.beginPath(); ctx.arc(bp.x, bp.y, bp.r * 0.82, now / 900, now / 900 + Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
    if (f) {
      ctx.beginPath(); ctx.arc(bp.x, bp.y, bp.r + 26 * (1 - f), 0, Math.PI * 2);
      ctx.strokeStyle = ring; ctx.globalAlpha = f; ctx.lineWidth = 3; ctx.shadowColor = ring; ctx.shadowBlur = 16; ctx.stroke(); ctx.shadowBlur = 0;
      ctx.beginPath(); ctx.arc(bp.x, bp.y, bp.r * (bp.kind === 'pop' ? 1 : 0.62), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${0.7 * f})`; ctx.fill(); ctx.globalAlpha = 1;
    }
  }
  // flippers (animated)
  for (const f of F.flippers) {
    f.angle = flipperAngle(f);
    const seg = flipperSegment(f);
    const active = now - f.flipT < 380;
    ctx.save(); ctx.translate(2, 4); ctx.beginPath(); ctx.moveTo(seg.a.x, seg.a.y); ctx.lineTo(seg.b.x, seg.b.y); ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 14; ctx.stroke(); ctx.restore();
    ctx.beginPath(); ctx.moveTo(seg.a.x, seg.a.y); ctx.lineTo(seg.b.x, seg.b.y);
    const fg = ctx.createLinearGradient(seg.a.x, seg.a.y - 6, seg.a.x, seg.a.y + 6); fg.addColorStop(0, '#3a4266'); fg.addColorStop(1, '#141828');
    ctx.strokeStyle = fg; ctx.lineWidth = 12; ctx.stroke();
    neon(ctx, () => { ctx.beginPath(); ctx.moveTo(seg.a.x, seg.a.y); ctx.lineTo(seg.b.x, seg.b.y); }, active ? '#ffffff' : T.primary, 3, active ? 18 : 8);
    post(ctx, seg.a.x, seg.a.y, 5, '#dfe7ff', 0);
  }
  ctx.restore();
}
function neon(c, pathFn, color, width, glow) {
  pathFn(); c.strokeStyle = color; c.lineWidth = width; c.shadowColor = color; c.shadowBlur = glow; c.stroke(); c.shadowBlur = 0;
}

function drawBallSprite(x, y, radius, type, { glow = 10, shadow = true } = {}) {
  if (shadow) { ctx.beginPath(); ctx.ellipse(x + radius * 0.35, y + radius * 0.6, radius * 1.05, radius * 0.8, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fill(); }
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  const g = ctx.createRadialGradient(x - radius / 3, y - radius / 3, radius / 5, x, y, radius);
  g.addColorStop(0, type.hi); g.addColorStop(0.55, type.color); g.addColorStop(1, shade(type.color, 0.55));
  ctx.fillStyle = g; ctx.shadowColor = type.color; ctx.shadowBlur = glow; ctx.fill(); ctx.shadowBlur = 0;
  ctx.beginPath(); ctx.ellipse(x - radius * 0.3, y - radius * 0.42, radius * 0.3, radius * 0.16, -0.5, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fill();
}
const shadeCache = new Map();
function shade(hex, f) {
  const key = hex + f;
  if (shadeCache.has(key)) return shadeCache.get(key);
  const n = parseInt(hex.slice(1), 16);
  const ch = (s) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * f)));
  const out = `rgb(${ch(16)},${ch(8)},${ch(0)})`;
  shadeCache.set(key, out);
  return out;
}
function bez(f, t) {
  return {
    x: (1 - t) * (1 - t) * f.x0 + 2 * (1 - t) * t * f.cx + t * t * f.x1,
    y: (1 - t) * (1 - t) * f.y0 + 2 * (1 - t) * t * f.cy + t * t * f.y1,
  };
}

function drawFlights() {
  const r0 = 9, r1 = PHYS.ballRadius * board.w;
  for (const f of state.flights) {
    const t = Math.min(1, f.t);
    ctx.globalAlpha = 0.35;
    for (let i = 1; i <= 3; i++) {
      const p = bez(f, Math.max(0, t - i * 0.05));
      ctx.beginPath(); ctx.arc(p.x, p.y, (r0 + (r1 - r0) * t) * (1 - i * 0.2), 0, Math.PI * 2); ctx.fillStyle = f.type.color; ctx.fill();
    }
    ctx.globalAlpha = 1;
    const p = bez(f, t);
    drawBallSprite(p.x, p.y, r0 + (r1 - r0) * t, f.type, { shadow: false });
  }
}

function drawBalls(now) {
  for (const b of state.balls) {
    let r = b.r, x = b.x, y = b.y;
    if (b.dying) {
      const t = Math.min(1, (now - b.dying.t0) / 360);
      r = b.r * (1 - t);
      x = b.x + (b.dying.x - b.x) * t;
      y = b.y + (b.dying.y - b.y) * t;
      if (r <= 0.5) continue;
    }
    drawBallSprite(x, y, r, b.type);
    if (!b.dying) {
      const col = b.total > 0 ? '#7dffb9' : b.total < 0 ? '#ff8d8d' : 'rgba(255,255,255,0.85)';
      text(ctx, fmtMoney(b.total), x, y - b.r - 10, 12, col, { glow: 6, emboss: true });
      for (let i = 0; i < b.flips; i++) {
        ctx.beginPath(); ctx.arc(x - (b.flips - 1) * 3 + i * 6, y + b.r + 6, 2, 0, Math.PI * 2); ctx.fillStyle = theme().primary; ctx.fill();
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Slingshot
// ---------------------------------------------------------------------------
function drawSlingshot(now, T) {
  const pouch = pouchPos();
  const S = Math.min(W, H);
  const forkY = sling.ay - S * 0.05;
  const forkL = { x: sling.ax - S * 0.07, y: forkY };
  const forkR = { x: sling.ax + S * 0.07, y: forkY };
  const baseY = Math.min(H - 8, sling.ay + S * 0.085);
  const crotchY = sling.ay + S * 0.035;
  ctx.lineCap = 'round';
  const framePath = () => {
    ctx.beginPath();
    ctx.moveTo(sling.ax, baseY); ctx.lineTo(sling.ax, crotchY);
    ctx.moveTo(sling.ax, crotchY); ctx.quadraticCurveTo(forkL.x, sling.ay + S * 0.008, forkL.x, forkY);
    ctx.moveTo(sling.ax, crotchY); ctx.quadraticCurveTo(forkR.x, sling.ay + S * 0.008, forkR.x, forkY);
  };
  tube(ctx, framePath, T.primary, 5, 10);
  rr(ctx, sling.ax - S * 0.035, baseY - 4, S * 0.07, 8, 4);
  ctx.fillStyle = '#1d2236'; ctx.fill();
  ctx.strokeStyle = T.primary; ctx.globalAlpha = 0.5; ctx.lineWidth = 1.5; ctx.stroke(); ctx.globalAlpha = 1;

  const bandTo = state.loaded ? pouch : { x: sling.ax, y: sling.ay + 6 };
  for (const tip of [forkL, forkR]) {
    const bg = ctx.createLinearGradient(tip.x, tip.y, bandTo.x, bandTo.y);
    bg.addColorStop(0, T.primary); bg.addColorStop(1, '#ffd65a');
    ctx.strokeStyle = bg; ctx.lineWidth = 3.2; ctx.shadowColor = T.primary; ctx.shadowBlur = 7;
    ctx.beginPath(); ctx.moveTo(tip.x, tip.y); ctx.lineTo(bandTo.x + (tip === forkL ? -8 : 8), bandTo.y); ctx.stroke(); ctx.shadowBlur = 0;
  }
  for (const tip of [forkL, forkR]) post(ctx, tip.x, tip.y, 5, '#ffffff', 0);

  if (state.loaded) {
    ctx.beginPath(); ctx.arc(pouch.x, pouch.y - 3, 13, Math.PI * 0.15, Math.PI * 0.85);
    ctx.strokeStyle = T.primary; ctx.lineWidth = 3; ctx.shadowColor = T.primary; ctx.shadowBlur = 8; ctx.stroke(); ctx.shadowBlur = 0;
    drawBallSprite(pouch.x, pouch.y - 5, 9, ballType(), { shadow: false });
  }

  if (state.drag && state.loaded) {
    const power = pullPower();
    if (power > 0.08) {
      const to = aimTarget();
      const f = { x0: pouch.x, y0: pouch.y, x1: to.x, y1: to.y, cx: (pouch.x + to.x) / 2, cy: Math.min(pouch.y, to.y) - (H * 0.05 + H * 0.06 * power) };
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      for (let i = 1; i <= 14; i++) { const t = i / 15; const p = bez(f, t); ctx.beginPath(); ctx.arc(p.x, p.y, 2.8 - 1.4 * t, 0, Math.PI * 2); ctx.fill(); }
      const pu = 0.6 + 0.4 * Math.sin(now / 140);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.2; ctx.shadowColor = T.primary; ctx.shadowBlur = 12 * pu;
      ctx.beginPath(); ctx.arc(to.x, to.y, 10, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(to.x + dx * 13, to.y + dy * 13); ctx.lineTo(to.x + dx * 6, to.y + dy * 6); }
      ctx.stroke(); ctx.shadowBlur = 0;
      ctx.beginPath(); ctx.arc(to.x, to.y, 2.6, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
      ctx.beginPath(); ctx.arc(pouch.x, pouch.y, 22, -Math.PI / 2, -Math.PI / 2 + power * Math.PI * 2);
      ctx.strokeStyle = power >= 0.98 ? '#ff6a6a' : '#ffd65a'; ctx.lineWidth = 3; ctx.stroke();
    }
  }
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------
function drawEffects(now) {
  for (const fx of state.effects) {
    const t = Math.min(1, (now - fx.t0) / fx.dur);
    if (fx.type === 'float') {
      ctx.globalAlpha = 1 - t * t;
      text(ctx, fx.text, fx.x, fx.y - 26 * easeOutCubic(t), fx.size || 18, fx.color, { glow: 8, emboss: true });
      ctx.globalAlpha = 1;
    } else if (fx.type === 'puff') {
      ctx.globalAlpha = (1 - t) * 0.5;
      ctx.beginPath(); ctx.arc(fx.x, fx.y, 4 + 18 * easeOutCubic(t), 0, Math.PI * 2); ctx.strokeStyle = '#ffe9a8'; ctx.lineWidth = 2; ctx.stroke();
      ctx.globalAlpha = 1;
    } else if (fx.type === 'reveal') {
      const inT = Math.min(1, t * 6), outT = Math.max(0, (t - 0.75) * 4);
      ctx.globalAlpha = inT * (1 - outT);
      const y = fx.y - 22 * easeOutCubic(inT);
      ctx.save(); ctx.translate(3, 4); rr(ctx, fx.x - 58, y - 24, 116, 46, 8); ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fill(); ctx.restore();
      rr(ctx, fx.x - 58, y - 24, 116, 46, 8); ctx.fillStyle = 'rgba(8,10,28,0.94)'; ctx.fill();
      ctx.strokeStyle = fx.color; ctx.lineWidth = 1.5; ctx.stroke();
      text(ctx, fx.line1, fx.x, y - 9, 16, fx.color, { glow: 8 });
      text(ctx, fx.line2, fx.x, y + 11, 11, 'rgba(255,255,255,0.85)');
      ctx.globalAlpha = 1;
    } else if (fx.type === 'burst') {
      ctx.globalAlpha = 1 - t;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 + fx.t0, d = 12 + 60 * easeOutCubic(t);
        ctx.beginPath(); ctx.arc(fx.x + Math.cos(a) * d, fx.y + Math.sin(a) * d, 3 * (1 - t) + 1, 0, Math.PI * 2); ctx.fillStyle = i % 2 ? '#ffd65a' : '#7dffb9'; ctx.fill();
      }
      ctx.globalAlpha = 1;
    } else if (fx.type === 'banner') {
      const inT = Math.min(1, t * 5), outT = Math.max(0, (t - 0.8) * 5);
      ctx.globalAlpha = inT * (1 - outT);
      ctx.save(); ctx.translate(W / 2, H * 0.3); ctx.scale(0.8 + 0.2 * easeInOut(inT), 0.8 + 0.2 * easeInOut(inT));
      text(ctx, fx.text, 0, -14, 26, '#ffd65a', { glow: 18, emboss: true });
      text(ctx, fx.sub, 0, 22, 32, '#7dffb9', { glow: 14, emboss: true });
      ctx.restore(); ctx.globalAlpha = 1;
    }
  }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
function frame() {
  update();
  render();
  requestAnimationFrame(frame);
}
// Boot (after every declaration above is initialised).
newBoard();
updateTypeUI();
window.addEventListener('resize', layout);
requestAnimationFrame(frame);
