// Slingo — plunger pinball on nine hand-built machines.
import { BALL_TYPES, START_BALANCE, TOPUP_AMOUNT, PHYS, fmtMoney, round2 } from './config.js';
import { realize, rollMultiplier, awardFor, pickAim, exitMultiplier, flipperSegment } from './field.js';
import { MACHINES, buildMachine, buyIn, allowedTypes, machineProfile } from './machines.js';
import {
  SIGN_COL, GATE_COL, AMBER, rr, polyPath, shade, withAlpha, chromeStroke, post, bumperCap,
  lampInsert, bar, drawMotif, buildStatic, drawSelect, selectCards, drawBallSprite,
} from './render.js';
import { dmText, dmWidth, printText } from './font.js';
import { initAudio, sfx, toggleMute } from './audio.js';

// ---------------------------------------------------------------------------
// Canvas / layout
// ---------------------------------------------------------------------------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const staticCanvas = document.createElement('canvas');
const sctx = staticCanvas.getContext('2d');
let W = 0, H = 0, DPR = 1;
let board = null;
const fieldRect = { x: 0, y: 0, w: 0, h: 0 };
const plunger = { maxPull: 0, knobY: 0 };

function layout() {
  W = window.innerWidth;
  H = window.innerHeight;
  DPR = Math.min(window.devicePixelRatio || 1, 2.5);
  for (const c of [canvas, staticCanvas]) { c.width = Math.round(W * DPR); c.height = Math.round(H * DPR); }
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  // Field fills the screen above the plunger strip; its aspect is kept between
  // 1.5 and 1.72 so every machine's geometry plays the same on every screen.
  const top = H * 0.07;
  const availH = H * 0.84 - top;
  const fw = Math.min(W * 0.94, availH / 1.5);
  const fh = Math.min(availH, fw * 1.72);
  fieldRect.x = (W - fw) / 2;
  fieldRect.y = top + (availH - fh) / 2;
  fieldRect.w = fw;
  fieldRect.h = fh;
  const old = board;
  if (state.spec) {
    board = realize(state.spec, fieldRect.x, fieldRect.y, fw, fh);
    buildStatic(sctx, board, W, H, DPR);
  }
  if (old && board) rescaleBalls(old, board);
  plunger.maxPull = H * 0.11;
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
  screen: 'select',  // 'select' | 'play'
  balance: START_BALANCE,
  lastWin: 0,
  typeIdx: 0,
  machine: null,
  machineIdx: -1,
  spec: null,
  launched: 0,
  boardFadeT: 0,
  balls: [],
  seated: null,      // ball resting on the plunger (a weak plunge came back)
  effects: [],
  drag: null,        // {id, y0, pull}
  pressed: -1,       // select-screen card being pressed
  shake: { mag: 0, t: 0 },
  now: performance.now(),
  last: performance.now(),
  settled: [],
  lateAwards: 0, // component awards made after 10 s of ball life (liveliness check)
};
window.__slingo = state;
state.machines = MACHINES;

const ballType = () => BALL_TYPES[state.typeIdx];
const profile = () => machineProfile(state.machine);
const phys = (k) => (profile().physics && profile().physics[k] !== undefined ? profile().physics[k] : PHYS[k]);

function enterMachine(idx) {
  const m = MACHINES[idx];
  const cost = buyIn(m);
  if (state.balance + 1e-9 < cost) { toast(`${m.name} needs a ${fmtMoney(cost)} buy-in — tap ${$topup.textContent}`); sfx.miss(); return false; }
  state.machine = m;
  state.machineIdx = idx;
  state.spec = buildMachine(m);
  state.launched = 0;
  state.boardFadeT = performance.now();
  const types = allowedTypes(m);
  if (!types.includes(ballType())) state.typeIdx = BALL_TYPES.indexOf(types[0]);
  state.screen = 'play';
  document.body.classList.add('playing');
  layout();
  updateTypeUI();
  updateHUD();
  try { localStorage.setItem('slingo.machine', m.id); } catch (e) { /* private mode */ }
  sfx.flip();
  return true;
}
function leaveMachine() {
  if (!fieldEmpty()) return;
  state.screen = 'select';
  state.seated = null;
  document.body.classList.remove('playing');
  updateHUD();
  sfx.led();
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
const $machine = document.getElementById('machine');
const $machines = document.getElementById('machines');
let toastTimer = 0;

function fieldEmpty() { return state.balls.length === 0; }
function inPlay() { return state.balls.filter((b) => !b.seated).length; }

function updateHUD() {
  $balance.textContent = fmtMoney(state.balance);
  $lastwin.textContent = state.lastWin > 0 ? 'WIN ' + fmtMoney(state.lastWin) : '';
  const n = inPlay();
  $inplay.textContent = n ? `${n} IN PLAY` : '';
  if (state.machine) {
    $machine.textContent = `${state.machine.name} ${'★'.repeat(state.machine.stars)}`;
    $machine.style.color = state.machine.palette.accent2;
  }
  $machines.disabled = !fieldEmpty();
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
$topup.addEventListener('click', () => { state.balance += TOPUP_AMOUNT; toast(`+${fmtMoney(TOPUP_AMOUNT)} added`); updateHUD(); });
const $mute = document.getElementById('mute');
$mute.addEventListener('click', () => { $mute.textContent = toggleMute() ? '🔇' : '🔊'; });
$type.addEventListener('click', () => {
  initAudio();
  const types = allowedTypes(state.machine);
  const i = types.indexOf(ballType());
  state.typeIdx = BALL_TYPES.indexOf(types[(i + 1) % types.length]);
  updateTypeUI(); sfx.led();
});
$machines.addEventListener('click', () => { if (!fieldEmpty()) return; initAudio(); leaveMachine(); });

// ---------------------------------------------------------------------------
// Input: machine cards on the select screen; the plunger strip in play
// ---------------------------------------------------------------------------
const cardAt = (x, y) => selectCards.find((c) => x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h);
canvas.addEventListener('pointerdown', (e) => {
  initAudio();
  if (state.screen === 'select') {
    const c = cardAt(e.clientX, e.clientY);
    state.pressed = c ? c.idx : -1;
    if (c) sfx.led();
    e.preventDefault();
    return;
  }
  if (state.drag) return;
  if (e.clientY < board.y0 + board.h * 0.78) return; // the plunger strip
  canvas.setPointerCapture(e.pointerId);
  state.drag = { id: e.pointerId, y0: e.clientY, pull: 0, buzzed: false };
  e.preventDefault();
});
canvas.addEventListener('pointermove', (e) => {
  const d = state.drag;
  if (!d || e.pointerId !== d.id) return;
  d.pull = Math.max(0, Math.min(1, (e.clientY - d.y0) / plunger.maxPull));
  if (d.pull >= 0.98 && !d.buzzed) { d.buzzed = true; if (navigator.vibrate) navigator.vibrate(18); }
  else if (d.pull < 0.9) d.buzzed = false;
  e.preventDefault();
});
function endDrag(e) {
  if (state.screen === 'select') {
    const c = cardAt(e.clientX, e.clientY);
    const idx = state.pressed; state.pressed = -1;
    if (c && c.idx === idx) enterMachine(idx);
    return;
  }
  const d = state.drag;
  if (!d || e.pointerId !== d.id) return;
  state.drag = null;
  if (d.pull > 0.06) launch(d.pull);
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', (e) => { state.pressed = -1; if (state.drag && e.pointerId === state.drag.id) state.drag = null; });

const pull = () => (state.drag ? state.drag.pull : 0);
// Speed that just carries a ball from the slot to the lane flap on this machine.
function clearSpeed() {
  const rise = board.lane.seatY - board.lane.flapY + PHYS.ballRadius * board.w;
  return Math.sqrt(2 * phys('gravity') * board.h * rise);
}
// Launch speed is a pure function of the charge — deterministic. Below the
// threshold the ball always falls back to the slot; at or above it the ball
// always reaches the field, on every machine.
function launchSpeed(p) {
  const { threshold: th, weak, strong } = PHYS.launch;
  const v = clearSpeed();
  return p < th
    ? v * (weak[0] + (weak[1] - weak[0]) * (p / th))
    : v * (strong[0] + (strong[1] - strong[0]) * ((p - th) / (1 - th)));
}
const minClearPull = () => PHYS.launch.threshold;

function launch(p) {
  let ball = state.seated;
  if (!ball) {
    const type = ballType();
    if (type.bet > state.balance + 1e-9) { toast(`Not enough balance for a ${type.name} ball — tap ${$topup.textContent}`); return; }
    const mult = rollMultiplier(profile().table); // the isolated bet is decided here
    ball = makeBall(type, mult);
    state.balls.push(ball);
    // The bet is not placed yet: a charge too weak to reach the field drops the
    // ball back into the slot costing nothing, so launching is never a skill test.
  }
  state.seated = null;
  ball.seated = false;
  ball.x = board.lane.x;
  ball.y = board.lane.seatY - ball.r;
  ball.vx = 0;
  ball.vy = -launchSpeed(p);
  ball.born = state.now; ball.ax = ball.x; ball.ay = ball.y; ball.at = state.now;
  sfx.fire(p);
  shake(0.2 + 0.7 * p);
  state.effects.push({ type: 'puff', x: ball.x, y: ball.y, t0: state.now, dur: 350 });
  updateHUD();
}

function makeBall(type, mult) {
  const r = PHYS.ballRadius * board.w;
  const target = round2(mult * type.bet);
  return {
    x: board.lane.x, y: board.lane.seatY - r, vx: 0, vy: 0, r,
    type, stake: type.bet, mult, target, total: type.bet, aim: pickAim(target, type.bet),
    born: state.now, cd: new Map(), slowSince: 0, dying: null, hits: 0, flips: profile().flips,
    lastComp: null, repeat: 0, ax: 0, ay: 0, at: state.now, popT: -1e9,
    sides: new Map(), gcd: new Map(), seated: false, held: null, charged: false,
  };
}

function shake(mag) {
  state.shake.mag = Math.max(state.shake.mag, 3 + 8 * mag);
  state.shake.t = state.now;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------
function award(ball, comp, sign, tier, x, y) {
  if (!sign) return;
  const until = ball.cd.get(comp) || 0;
  if (state.now < until) return;
  ball.cd.set(comp, state.now + 160);
  comp.flashT = state.now;
  // Only a ball rattling on one component is silenced (and kicked loose);
  // scoring never stops with age, so the field stays alive for the whole ball.
  if (!comp.posts) {
    if (comp === ball.lastComp) ball.repeat++; else { ball.lastComp = comp; ball.repeat = 0; }
  }
  if (ball.repeat >= 4) {
    ball.vx += (Math.random() - 0.5) * 0.6 * board.h;
    ball.vy -= 0.25 * board.h;
    ball.repeat = 0;
    return;
  }
  ball.hits++;
  const a = awardFor(ball, sign, tier);
  if (a === 0) { sfx.miss(); return; }
  if (state.now - ball.born > 10000) state.lateAwards++;
  ball.total = round2(ball.total + a);
  ball.popT = state.now;
  (a > 0 ? sfx.fill : sfx.lose)();
  state.effects.push({
    type: 'float', x, y, text: (a > 0 ? '+' : '−') + fmtMoney(Math.abs(a)).slice(1),
    color: a > 0 ? '#7dffb9' : '#ff8d8d', t0: state.now, dur: 1000, size: 13 + 2 * tier,
  });
}

function settle(ball, x, y, where) {
  if (!ball.charged) { // never reached the field: no bet was placed, no prize
    ball.dying = { t0: state.now, x, y };
    updateHUD();
    return;
  }
  // The exit is a mystery multiplier: total × M is exactly the prize fixed at
  // launch, so wherever the ball lands the result is the predetermined one.
  const M = exitMultiplier(ball);
  const paid = ball.target;
  ball.dying = { t0: state.now, x, y };
  state.balance += paid;
  state.settled.push({ machine: state.machine.id, target: ball.target, paid, mult: M, total: ball.total, hits: ball.hits, life: Math.round(state.now - ball.born) });
  if (ball.hits > 0 && Math.abs(ball.total * M - paid) < 0.005) {
    state.effects.push({
      type: 'mystery', x, y: y + 26, t0: state.now, dur: 1500,
      text: `${fmtMoney(ball.total)} × ${M >= 10 ? M.toFixed(0) : M.toFixed(2)}`,
      color: paid > 0 ? AMBER : '#ff8d8d',
    });
  }
  ball.total = paid;
  const win = paid > 0;
  if (win) state.lastWin = paid;
  if (where) where.flashT = state.now;
  const big = ball.mult >= 10;
  schedule(150, () => (win ? (big ? sfx.bigwin() : sfx.win()) : sfx.lose()));
  // One row: prize (green if ≥ bet, red otherwise) and its multiplier in grey.
  state.effects.push({
    type: 'reveal', x: Math.max(board.x0 + 70, Math.min(board.x0 + board.w - 70, x)), y: Math.min(y, board.y0 + board.h - 30),
    t0: state.now, dur: 2200,
    prize: fmtMoney(ball.target), mult: `×${ball.mult}`,
    color: ball.target >= ball.stake ? '#7dffb9' : '#ff8d8d',
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
    for (const mv of board.movers) { const s = Math.sin(state.now / 1000 * (2 * Math.PI / mv.period) + mv.phase); mv.x = mv.cx + mv.dx * mv.amp * s; mv.y = mv.cy + mv.dy * mv.amp * s; }
    for (const b of state.balls) if (!b.dying && !b.seated && !b.held) integrate(b, h);
    ballPairs();
    dt -= h;
  }
  for (const b of state.balls) if (!b.dying && !b.seated) checkSensors(b);
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
  // magnets pull nearby balls
  for (const m of F.magnets) {
    const dx = m.x - b.x, dy = m.y - b.y, d = Math.hypot(dx, dy);
    if (d < m.range && d > 1e-6) { const a = 0.5 * F.h * (1 - d / m.range); b.vx += (dx / d) * a * h; b.vy += (dy / d) * a * h; }
  }
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
  for (const sp2 of F.spinners) for (const post of sp2.posts) collideCircle(b, post, PHYS.restitutionPin, 0);
  for (const o of F.oneways) {
    // block only from the passed side
    if ((b.x - o.x) * o.nx + (b.y - o.y) * o.ny > 0) collideSegment(b, o.seg, 0.4);
  }
  for (const bk of F.banks) {
    for (const t of bk.targets) {
      if (t.down) continue;
      if (collideSegment(b, t.seg, 0.5)) {
        t.down = true; t.flashT = state.now;
        award(b, t, bk.sign, bk.tier, t.x, t.y - 14);
        if (bk.targets.every((tt) => tt.down)) {
          award(b, bk, +1, 3, bk.x, bk.y - 26);
          bk.resetAt = state.now + 1600;
          sfx.bonus();
        }
      }
    }
  }
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
  for (const mv of F.movers) {
    if (collideCircle(b, mv, PHYS.restitutionBumper, PHYS.bumperKick * F.h)) { award(b, mv, mv.sign, mv.tier, mv.x, mv.y - mv.r - 10); shake(0.12); }
  }
  for (const m of F.magnets) {
    if (collideCircle(b, m, 0.5, 0)) award(b, m, m.sign, m.tier, m.x, m.y - m.r - 12);
  }
  for (const f of F.flippers) { f.angle = flipperAngle(f); collideSegment(b, flipperSegment(f), 0.5); }
  if (b.x < F.x0 + b.r) { b.x = F.x0 + b.r; b.vx = Math.abs(b.vx) * 0.5; }
  if (b.x > F.x0 + F.w - b.r) { b.x = F.x0 + F.w - b.r; b.vx = -Math.abs(b.vx) * 0.5; }
  if (b.y < F.y0 + b.r) { b.y = F.y0 + b.r; b.vy = Math.abs(b.vy) * 0.5; }

  const inLane = b.x > F.lane.left && b.y > F.lane.flapY; // below the flap, on the plunger side
  if (Math.hypot(b.vx, b.vy) < 0.03 * F.h && !inLane) {
    if (!b.slowSince) b.slowSince = state.now;
    else if (state.now - b.slowSince > 450) { b.vx += (Math.random() - 0.5) * 0.4 * F.h; b.vy -= 0.15 * F.h; b.slowSince = 0; }
  } else b.slowSince = 0;
  if (Math.hypot(b.x - b.ax, b.y - b.ay) > b.r * 5) { b.ax = b.x; b.ay = b.y; b.at = state.now; }
  else if (state.now - b.at > 2500 && !inLane) {
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
  if (vn < 0) { b.vx -= (1 + e) * vn * nx; b.vy -= (1 + e) * vn * ny; }
  if (kick) { b.vx += nx * kick; b.vy += ny * kick; }
  return true;
}

function ballPairs() {
  const bs = state.balls;
  for (let i = 0; i < bs.length; i++) {
    const a = bs[i];
    if (a.dying || a.held) continue;
    for (let j = i + 1; j < bs.length; j++) {
      const b = bs[j];
      if (b.dying || b.held) continue;
      let nx = b.x - a.x, ny = b.y - a.y;
      const d = Math.hypot(nx, ny);
      const rr2 = a.r + b.r;
      if (d >= rr2 || d < 1e-6) continue;
      nx /= d; ny /= d;
      const pen = rr2 - d;
      const wa = a.seated ? 0 : b.seated ? 1 : 0.5, wb = 1 - wa; // seated balls are immovable
      a.x -= nx * pen * wa; a.y -= ny * pen * wa; b.x += nx * pen * wb; b.y += ny * pen * wb;
      const rvn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rvn < 0) {
        const jimp = -(1 + 0.8) * rvn / 2;
        if (!a.seated) { a.vx -= jimp * nx; a.vy -= jimp * ny; }
        if (!b.seated) { b.vx += jimp * nx; b.vy += jimp * ny; }
      }
    }
  }
}

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

function gateCross(b, g) {
  if (!crossed(b, g, g.sensor, 500)) return;
  award(b, g, g.sign, g.tier, g.x - g.ax * (g.L + 12), g.y - g.ay * (g.L + 12));
  const sp = Math.hypot(b.vx, b.vy);
  let ax = g.ax, ay = g.ay;
  // A kicker fires in its fixed direction (toward the U-turn's exit arm);
  // other gates push the ball on along whichever way it was going.
  if (g.dir) { ax *= g.dir; ay *= g.dir; }
  else if (b.vx * ax + b.vy * ay < 0) { ax = -ax; ay = -ay; }
  if (g.kind === 'boost') {
    // Boosts fade once a ball outlives its soft life so a kicker loop can't
    // keep a ball up forever (a U-turn kicker always still clears its arm).
    const k = ageDecay(b, 4000);
    const s = Math.max(sp * 1.6 * k, (g.kicker ? 1.4 : 0.9) * board.h * (g.kicker ? Math.max(0.78, k) : k));
    b.vx = ax * s; b.vy = ay * s; sfx.fire(0.6); if (g.kicker) shake(0.3);
  }
  else if (g.kind === 'brake') { b.vx = ax * sp * 0.35; b.vy = ay * sp * 0.35; sfx.miss(); }
  else if (g.kind === 'warp' && g.twin !== undefined) {
    const t = board.gates[g.twin];
    state.effects.push({ type: 'puff', x: b.x, y: b.y, t0: state.now, dur: 400 });
    b.x = t.x + t.ax * (t.L + b.r * 2); b.y = t.y + t.ay * (t.L + b.r * 2);
    const s = Math.max(sp * 0.8, 0.4 * board.h);
    b.vx = t.ax * s; b.vy = t.ay * s;
    b.sides.set(t, sideOf(b, t.sensor)); b.gcd.set(t, state.now + 600);
    t.flashT = state.now; b.ax = b.x; b.ay = b.y; b.at = state.now;
    state.effects.push({ type: 'puff', x: b.x, y: b.y, t0: state.now, dur: 400 });
    sfx.flip();
  }
}
const ageDecay = (b, span) => { const over = state.now - b.born - PHYS.softLifeMs; return over > 0 ? 1 / (1 + over / span) : 1; };
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
function onewayCross(b, o) {
  // score when passing in the allowed direction (sensor = the flap line)
  const side = (b.x - o.x) * o.nx + (b.y - o.y) * o.ny > 0 ? 1 : -1;
  const prev = b.sides.get(o);
  b.sides.set(o, side);
  if (prev === -1 && side === 1 && withinSpan(b, o.seg)) { o.flashT = state.now; if (o.sign) award(b, o, o.sign, o.tier, o.x, o.y - 14); }
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
  for (const bk of board.banks) {
    if (bk.resetAt && state.now >= bk.resetAt) { bk.resetAt = 0; for (const t of bk.targets) { t.down = false; t.flashT = state.now; } sfx.flip(); }
  }
}

function checkSensors(b) {
  const F = board;
  // The bet is placed the moment the ball clears the lane flap into the field.
  if (!b.charged && b.y < F.lane.flapY) {
    b.charged = true;
    state.balance -= b.stake;
    state.launched++;
    updateHUD();
  }
  if (b.held) {
    if (state.now >= b.held.until) {
      const k = b.held.kick;
      const e = 0.65 * F.h * Math.max(0.5, ageDecay(b, 4000));
      b.x = k.ex; b.y = k.ey; b.vx = k.dir[0] * e; b.vy = k.dir[1] * e;
      b.held = null; k.ejectT = state.now; b.ax = b.x; b.ay = b.y; b.at = state.now;
      state.effects.push({ type: 'puff', x: b.x, y: b.y, t0: state.now, dur: 400 });
      sfx.step();
    }
    return;
  }
  for (const g of F.gates) gateCross(b, g);
  for (const sp of F.spinners) spinnerCross(b, sp);
  for (const o of F.oneways) onewayCross(b, o);
  for (const k of F.kickouts) {
    if (Math.hypot(b.x - k.x, b.y - k.y) < k.r * 0.65) {
      award(b, k, k.sign, k.tier, k.x, k.y - k.r - 12);
      b.held = { until: state.now + 700, kick: k };
      b.vx = b.vy = 0; b.x = k.x; b.y = k.y;
      k.flashT = state.now;
      sfx.fill();
      return;
    }
  }
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
      sfx.step(); shake(0.2);
      state.effects.push({ type: 'puff', x: b.x, y: b.y, t0: state.now, dur: 300 });
    }
  }
  // A charge too weak to clear the flap drops the ball back into the slot,
  // where it re-seats un-bet and can simply be launched again.
  if (!b.charged && b.x > F.lane.left && b.vy >= 0 && b.y >= F.lane.seatY - b.r * 1.2 && !state.seated) {
    state.seated = b; b.seated = true; b.vx = b.vy = 0; b.x = F.lane.x; b.y = F.lane.seatY - b.r;
    updateHUD(); sfx.hit();
    return;
  }
  if (b.y > F.drainY && b.x < F.lane.left) { settle(b, (F.exit.x0 + F.exit.x1) / 2, F.drainY - 14, F.exit); return; }
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
  if (state.screen !== 'play') return;
  const hadBalls = state.balls.length;
  stepPhysics(dt);
  updateSpinners(dt);
  if (state.balls.length !== hadBalls) updateHUD();
  state.effects = state.effects.filter((fx) => now - fx.t0 < fx.dur);
}

// ---------------------------------------------------------------------------
// Frame rendering
// ---------------------------------------------------------------------------
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const flash = (comp, dur = 350) => (comp.flashT ? Math.max(0, 1 - (state.now - comp.flashT) / dur) : 0);

function render() {
  const now = state.now;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (state.screen === 'select') { drawSelect(ctx, W, H, MACHINES, state.balance, state.pressed, now); return; }
  const sAge = now - state.shake.t;
  if (state.shake.mag > 0 && sAge < 320) { const m = state.shake.mag * (1 - sAge / 320); ctx.translate((Math.random() * 2 - 1) * m, (Math.random() * 2 - 1) * m); }
  else state.shake.mag = 0;
  const pal = state.machine.palette;
  const bg = ctx.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#0a0508'); bg.addColorStop(0.5, shade(pal.wood[0], 0.35)); bg.addColorStop(1, '#040305');
  ctx.fillStyle = bg; ctx.fillRect(-20, -20, W + 40, H + 40);
  const fade = Math.min(1, (now - state.boardFadeT) / 600);
  ctx.globalAlpha = fade;
  ctx.drawImage(staticCanvas, 0, 0, staticCanvas.width, staticCanvas.height, 0, 0, W, H);
  drawDynamic(pal, now);
  ctx.globalAlpha = 1;
  drawPlunger(pal, now);
  drawBalls(now);
  drawEffects(now);
}

function drawDynamic(pal, now) {
  const F = board;
  ctx.save(); polyPath(ctx, F.poly); ctx.clip();
  // insert chase: lamps light in a running pattern, faster while balls play
  const tick = Math.floor(now / (inPlay() ? 110 : 220));
  F.inserts.forEach((it, i) => { const lit = (i + tick) % 3 === 0 ? 1 : 0; if (lit) lampInsert(ctx, it.x, it.y, it.r, it.kind, it.color, 1, it.angle); });
  const fe = flash(F.exit, 900);
  if (fe) { const ex0 = F.exit.x0 + 6, ex1 = F.exit.x1 - 6, wellTop = F.y0 + F.h * 0.965; rr(ctx, ex0, wellTop + 2, ex1 - ex0, F.y0 + F.h - wellTop + 30, 4); ctx.fillStyle = withAlpha('#ffb000', 0.6 * fe); ctx.fill(); }
  for (const hole of [...F.holes, ...F.kickouts]) {
    const f = flash(hole, 900); if (!f) continue;
    ctx.beginPath(); ctx.arc(hole.x, hole.y, hole.r * (1 + 0.5 * (1 - f)), 0, Math.PI * 2);
    ctx.strokeStyle = withAlpha('#ffb000', f); ctx.lineWidth = 3; ctx.shadowColor = AMBER; ctx.shadowBlur = 16 * f; ctx.stroke(); ctx.shadowBlur = 0;
  }
  for (const k of F.kickouts) {
    const f = k.ejectT ? Math.max(0, 1 - (now - k.ejectT) / 500) : 0; if (!f) continue;
    ctx.beginPath(); ctx.arc(k.ex, k.ey, 8 + 20 * (1 - f), 0, Math.PI * 2); ctx.strokeStyle = withAlpha(pal.accent2, f); ctx.lineWidth = 2; ctx.stroke();
  }
  for (const g of F.gates) {
    const f = flash(g, 600); if (!f) continue;
    const col = GATE_COL[g.kind];
    ctx.save(); ctx.translate(g.x, g.y); ctx.rotate(-g.angle);
    if (g.guides.length) rr(ctx, -g.G + 3, -g.L, (g.G - 3) * 2, g.L * 2, 4); else ctx.arc(0, 0, 22, 0, Math.PI * 2);
    ctx.fillStyle = col; ctx.globalAlpha = 0.45 * f; ctx.shadowColor = col; ctx.shadowBlur = 20 * f; ctx.fill(); ctx.restore(); ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  }
  for (const sp of F.spinners) {
    const spinning = sp.omega !== 0, thick = 2.5 + 7 * Math.abs(Math.cos(sp.rot)), facing = Math.cos(sp.rot) >= 0;
    ctx.save(); ctx.translate(sp.x, sp.y); ctx.rotate(sp.angle);
    ctx.save(); ctx.translate(2, 3); rr(ctx, -sp.hw * 0.82, -thick / 2, sp.hw * 1.64, thick, 2); ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fill(); ctx.restore();
    rr(ctx, -sp.hw * 0.82, -thick / 2, sp.hw * 1.64, thick, 2);
    const pg = ctx.createLinearGradient(0, -thick / 2, 0, thick / 2); pg.addColorStop(0, facing ? '#f4f7fa' : shade(pal.accent, 1.3)); pg.addColorStop(1, facing ? '#5a6472' : shade(pal.accent, 0.5));
    ctx.fillStyle = pg; if (spinning) { ctx.shadowColor = pal.accent2; ctx.shadowBlur = 12; } ctx.fill(); ctx.shadowBlur = 0;
    ctx.strokeStyle = spinning ? pal.accent2 : 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1; ctx.stroke();
    if (facing && thick > 6) drawMotif(ctx, state.machine.motif, 0, 0, thick * 0.4, 'rgba(0,0,0,0.35)');
    ctx.restore();
  }
  // one-way flaps swing open when passed
  for (const o of F.oneways) {
    const f = flash(o, 450);
    const swing = f * 1.1;
    const base = Math.atan2(o.py, o.px);
    const len = o.hw * 2, ang = base + swing;
    ctx.save(); ctx.translate(o.seg.a.x, o.seg.a.y); ctx.rotate(ang);
    chromeStroke(ctx, () => { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(len, 0); ctx.moveTo(len * 0.35, -3); ctx.lineTo(len * 0.35, 3); ctx.moveTo(len * 0.7, -3); ctx.lineTo(len * 0.7, 3); }, 2.2, f ? '#ffffff' : '#dfe6f0');
    ctx.restore();
  }
  // drop targets
  for (const bk of F.banks) {
    for (const t of bk.targets) {
      const f = flash(t, 400);
      if (t.down) bar(ctx, t.x, t.y, bk.angle, bk.hw, 3, pal.accent, false);
      else { bar(ctx, t.x, t.y, bk.angle, bk.hw, 10, pal.accent, true); drawMotif(ctx, state.machine.motif, t.x, t.y, 3.5, 'rgba(255,255,255,0.75)'); }
      if (f) { ctx.beginPath(); ctx.arc(t.x, t.y, 6 + 14 * (1 - f), 0, Math.PI * 2); ctx.strokeStyle = withAlpha(pal.accent2, f); ctx.lineWidth = 2; ctx.stroke(); }
    }
    const fb = flash(bk, 900);
    if (fb) { ctx.save(); ctx.translate(bk.x, bk.y); ctx.rotate(bk.angle); rr(ctx, -bk.sp - bk.hw - 6, -6, (bk.sp + bk.hw + 6) * 2, 18, 4); ctx.fillStyle = withAlpha(pal.accent2, 0.5 * fb); ctx.shadowColor = pal.accent2; ctx.shadowBlur = 20 * fb; ctx.fill(); ctx.restore(); ctx.shadowBlur = 0; }
  }
  // moving bumpers
  for (const mv of F.movers) {
    const f = flash(mv), col = SIGN_COL(mv.sign);
    bumperCap(ctx, mv.x, mv.y, mv.r, mv.sign > 0 ? pal.cap : '#2a2f3a', '', mv.tier, mv.sign, state.machine.motif, '#fff', f);
    if (f) { ctx.beginPath(); ctx.arc(mv.x, mv.y, mv.r + 22 * (1 - f), 0, Math.PI * 2); ctx.strokeStyle = col; ctx.globalAlpha = f; ctx.lineWidth = 3; ctx.stroke(); ctx.globalAlpha = 1; }
  }
  for (const m of F.magnets) {
    const col = SIGN_COL(m.sign);
    const pulse = 0.5 + 0.5 * Math.sin(now / 400);
    ctx.beginPath(); ctx.arc(m.x, m.y, m.range * (0.3 + 0.7 * ((now / 1400) % 1)), 0, Math.PI * 2);
    ctx.strokeStyle = col; ctx.globalAlpha = 0.25 * (1 - ((now / 1400) % 1)) * (0.6 + 0.4 * pulse); ctx.lineWidth = 1.5; ctx.stroke(); ctx.globalAlpha = 1;
    const f = flash(m); if (f) { ctx.beginPath(); ctx.arc(m.x, m.y, m.r + 22 * (1 - f), 0, Math.PI * 2); ctx.strokeStyle = col; ctx.globalAlpha = f; ctx.lineWidth = 3; ctx.stroke(); ctx.globalAlpha = 1; }
  }
  for (const s of F.rails) { const f = flash(s); if (!f) continue; ctx.beginPath(); ctx.moveTo(s.a.x, s.a.y); ctx.lineTo(s.b.x, s.b.y); ctx.strokeStyle = `rgba(255,255,255,${f})`; ctx.lineWidth = 6; ctx.shadowColor = '#fff'; ctx.shadowBlur = 18 * f; ctx.stroke(); ctx.shadowBlur = 0; }
  for (const t of F.tris) { const f = flash(t); if (!f) continue; ctx.beginPath(); ctx.moveTo(t.pts[0].x, t.pts[0].y); ctx.lineTo(t.pts[1].x, t.pts[1].y); ctx.lineTo(t.pts[2].x, t.pts[2].y); ctx.closePath(); ctx.fillStyle = '#fff'; ctx.globalAlpha = 0.5 * f; ctx.fill(); ctx.globalAlpha = 1; }
  for (const p of F.pins) { const f = flash(p, 250); if (!f) continue; ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 6 * (1 - f), 0, Math.PI * 2); ctx.strokeStyle = `rgba(255,255,255,${f})`; ctx.lineWidth = 2; ctx.stroke(); }
  for (const bp of F.bumpers) {
    const f = flash(bp);
    if (bp.kind !== 'pop') {
      // marquee bulbs chase around reactors / bonus discs
      const n = 20, t2 = Math.floor(now / 90);
      for (let i = 0; i < n; i++) { const lit = (i + t2) % 4 === 0 || f > 0.5; if (!lit) continue; const a = (i * Math.PI * 2) / n; ctx.beginPath(); ctx.arc(bp.x + Math.cos(a) * bp.r * 1.3, bp.y + Math.sin(a) * bp.r * 1.3, 2.6, 0, Math.PI * 2); ctx.fillStyle = '#ffe9a8'; ctx.shadowColor = AMBER; ctx.shadowBlur = 8; ctx.fill(); ctx.shadowBlur = 0; }
    }
    if (f) {
      const ring = bp.kind === 'pop' ? SIGN_COL(bp.sign) : pal.accent2;
      ctx.beginPath(); ctx.arc(bp.x, bp.y, bp.r + 26 * (1 - f), 0, Math.PI * 2); ctx.strokeStyle = ring; ctx.globalAlpha = f; ctx.lineWidth = 3; ctx.shadowColor = ring; ctx.shadowBlur = 16; ctx.stroke(); ctx.shadowBlur = 0;
      ctx.beginPath(); ctx.arc(bp.x, bp.y, bp.r, 0, Math.PI * 2); ctx.fillStyle = `rgba(255,255,255,${0.6 * f})`; ctx.fill(); ctx.globalAlpha = 1;
    }
  }
  // rubber flippers
  for (const f of F.flippers) {
    f.angle = flipperAngle(f);
    const seg = flipperSegment(f), active = now - f.flipT < 380;
    const path = () => { ctx.beginPath(); ctx.moveTo(seg.a.x, seg.a.y); ctx.lineTo(seg.b.x, seg.b.y); };
    ctx.save(); ctx.translate(2, 4); path(); ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 15; ctx.lineCap = 'round'; ctx.stroke(); ctx.restore();
    path(); ctx.strokeStyle = shade(pal.rubber, 0.45); ctx.lineWidth = 14; ctx.lineCap = 'round'; ctx.stroke();
    path(); ctx.strokeStyle = active ? '#ffffff' : pal.rubber; ctx.lineWidth = 11; ctx.stroke();
    // black tip stripe
    const tx = seg.a.x + (seg.b.x - seg.a.x) * 0.72, ty = seg.a.y + (seg.b.y - seg.a.y) * 0.72;
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(seg.a.x + (seg.b.x - seg.a.x) * 0.8, seg.a.y + (seg.b.y - seg.a.y) * 0.8); ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.lineWidth = 11; ctx.lineCap = 'butt'; ctx.stroke(); ctx.lineCap = 'round';
    post(ctx, seg.a.x, seg.a.y, 5.5, pal.rubber);
  }
  // Launch charge ladder inside the lane, lighting from the plunger upward.
  {
    const p = pull(), N = 16;
    const g0 = F.lane.seatY - F.h * 0.03, g1 = F.lane.top + F.h * 0.02;
    const segH = Math.max(2.5, (g0 - g1) / N * 0.42), pitch = (g0 - g1) / N;
    const halfW = (F.lane.right - F.lane.left) * 0.26;
    const litCount = Math.round(p * N);
    const minIdx = Math.round(minClearPull() * N);
    for (let i = 0; i < N; i++) {
      const y = g0 - i * pitch - segH / 2;
      const lit = i < litCount;
      const hot = i / N > 0.86;
      rr(ctx, F.lane.x - halfW, y, halfW * 2, segH, segH / 2);
      if (lit) { ctx.fillStyle = hot ? '#ff4a3a' : AMBER; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 8; ctx.fill(); ctx.shadowBlur = 0; }
      else { ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fill(); }
      if (i === minIdx) {
        ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(F.lane.x - halfW - 5, y + segH / 2); ctx.lineTo(F.lane.x - halfW - 2, y + segH / 2);
        ctx.moveTo(F.lane.x + halfW + 2, y + segH / 2); ctx.lineTo(F.lane.x + halfW + 5, y + segH / 2);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

// Plunger: chrome rod + coil spring below the lane, a red knob that moves with the pull.
function drawPlunger(pal, now) {
  const F = board, p = pull();
  const x = F.lane.x, top = F.lane.floor, S = Math.min(W, H);
  const knobY = Math.min(H - 60, top + 26 + p * plunger.maxPull * 0.6);
  // housing
  rr(ctx, x - 14, top - 2, 28, 24, 4); ctx.fillStyle = '#2a2f3a'; ctx.fill(); chromeStroke(ctx, () => rr(ctx, x - 14, top - 2, 28, 24, 4), 2);
  // spring: coil compressed toward the knob
  const coils = 7, y0 = top + 20, y1 = knobY - 10;
  ctx.beginPath(); ctx.moveTo(x, y0);
  for (let i = 1; i <= coils * 2; i++) ctx.lineTo(x + (i % 2 ? 9 : -9), y0 + ((y1 - y0) * i) / (coils * 2));
  ctx.lineTo(x, y1);
  ctx.strokeStyle = '#3b4250'; ctx.lineWidth = 3.5; ctx.stroke(); ctx.strokeStyle = '#c9d2dd'; ctx.lineWidth = 2; ctx.stroke();
  // rod
  chromeStroke(ctx, () => { ctx.beginPath(); ctx.moveTo(x, top + 8); ctx.lineTo(x, knobY); }, 6);
  // knob: red ball with a highlight
  const kr = Math.max(12, S * 0.028);
  ctx.beginPath(); ctx.arc(x + 2, knobY + 11, kr, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fill();
  ctx.beginPath(); ctx.arc(x, knobY + 8, kr, 0, Math.PI * 2);
  const kg = ctx.createRadialGradient(x - kr * 0.35, knobY + 8 - kr * 0.4, kr * 0.1, x, knobY + 8, kr); kg.addColorStop(0, '#ffb3a8'); kg.addColorStop(0.3, '#e63946'); kg.addColorStop(1, '#5a0d14');
  ctx.fillStyle = kg; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1.5; ctx.stroke();
  printText(ctx, 'PULL', x, knobY + 9, 8, { fill: '#fff' });
  ctx.beginPath(); ctx.moveTo(x - 6, knobY + kr + 12); ctx.lineTo(x, knobY + kr + 18); ctx.lineTo(x + 6, knobY + kr + 12); ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.5; ctx.stroke();
  // charge readout: an amber DMD panel below the cabinet, beside the plunger
  {
    const pct = String(Math.round(p * 100)).padStart(2, '0') + '%';
    const pw = 62, ph = 24, px0 = Math.max(6, x - 32 - pw), py0 = F.y0 + F.h + 8;
    rr(ctx, px0, py0, pw, ph, 3);
    ctx.fillStyle = 'rgba(12,8,4,0.95)'; ctx.fill();
    chromeStroke(ctx, () => rr(ctx, px0, py0, pw, ph, 3), 1.5);
    dmText(ctx, pct, px0 + pw / 2, py0 + ph / 2, 12, p >= 0.98 ? '#ff4a3a' : AMBER, { align: 'center', glow: 7, panel: true });
    printText(ctx, 'CHARGE', px0 + pw / 2, py0 - 8, 8, { fill: 'rgba(255,255,255,0.55)', stroke: 'rgba(0,0,0,0.6)' });
  }
  // seated ball preview (a new ball waits on the plunger when none is seated)
  if (!state.seated) {
    const r = PHYS.ballRadius * F.w;
    drawBallSprite(ctx, x, F.lane.seatY - r + p * 10, r, ballType());
  }
}

function drawBalls(now) {
  for (const b of state.balls) {
    let r = b.r, x = b.x, y = b.y;
    if (b.dying) {
      const t = Math.min(1, (now - b.dying.t0) / 360);
      r = b.r * (1 - t); x = b.x + (b.dying.x - b.x) * t; y = b.y + (b.dying.y - b.y) * t;
      if (r <= 0.5) continue;
    }
    if (b.held) { const t = Math.min(1, (now - (b.held.until - 700)) / 250); r = b.r * Math.max(0, 1 - t); if (r < 0.5) continue; }
    if (b.seated) y += pull() * 10;
    drawBallSprite(ctx, x, y, r, b.type);
    if (!b.dying && !b.held) {
      const col = b.total > 0 ? '#7dffb9' : b.total < 0 ? '#ff8d8d' : 'rgba(255,255,255,0.85)';
      const pop = Math.max(0, 1 - (now - b.popT) / 260); // scoreboard flicker on each award
      dmText(ctx, fmtMoney(b.total), x, y - b.r - 12, 9 + 2.5 * pop, pop > 0.5 ? '#ffffff' : col, { align: 'center', glow: 6 + 10 * pop });
      for (let i = 0; i < b.flips; i++) { ctx.beginPath(); ctx.arc(x - (b.flips - 1) * 3 + i * 6, y + b.r + 6, 2, 0, Math.PI * 2); ctx.fillStyle = AMBER; ctx.fill(); }
    }
  }
}

function drawEffects(now) {
  for (const fx of state.effects) {
    const t = Math.min(1, (now - fx.t0) / fx.dur);
    if (fx.type === 'float') {
      dmText(ctx, fx.text, fx.x, fx.y - 26 * easeOutCubic(t), (fx.size || 18) * 0.72, fx.color, { align: 'center', glow: 8, alpha: 1 - t * t });
    } else if (fx.type === 'mystery') {
      const inT = Math.min(1, t * 5), outT = Math.max(0, (t - 0.7) * 3.3);
      dmText(ctx, fx.text, fx.x, fx.y + 8 * (1 - easeOutCubic(inT)), 9, fx.color, { align: 'center', glow: 10, alpha: inT * (1 - outT) });
    } else if (fx.type === 'puff') {
      ctx.globalAlpha = (1 - t) * 0.5; ctx.beginPath(); ctx.arc(fx.x, fx.y, 4 + 18 * easeOutCubic(t), 0, Math.PI * 2); ctx.strokeStyle = '#ffe9a8'; ctx.lineWidth = 2; ctx.stroke(); ctx.globalAlpha = 1;
    } else if (fx.type === 'reveal') {
      const inT = Math.min(1, t * 6), outT = Math.max(0, (t - 0.75) * 4);
      ctx.globalAlpha = inT * (1 - outT);
      const y = fx.y - 22 * easeOutCubic(inT);
      const wPrize = dmWidth(fx.prize, 14), wMult = dmWidth(fx.mult, 10);
      const cw = wPrize + wMult + 36, x0 = fx.x - cw / 2;
      ctx.save(); ctx.translate(3, 4); rr(ctx, x0, y - 17, cw, 34, 4); ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fill(); ctx.restore();
      rr(ctx, x0, y - 17, cw, 34, 4); ctx.fillStyle = 'rgba(14,9,4,0.95)'; ctx.fill();
      chromeStroke(ctx, () => rr(ctx, x0, y - 17, cw, 34, 4), 2, fx.color);
      dmText(ctx, fx.prize, x0 + 13, y, 14, fx.color, { align: 'left', glow: 9, panel: true });
      dmText(ctx, fx.mult, x0 + 13 + wPrize + 12, y + 1, 10, 'rgba(255,200,120,0.8)', { align: 'left' });
      ctx.globalAlpha = 1;
    } else if (fx.type === 'burst') {
      ctx.globalAlpha = 1 - t;
      for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2 + fx.t0, d = 12 + 60 * easeOutCubic(t); ctx.beginPath(); ctx.arc(fx.x + Math.cos(a) * d, fx.y + Math.sin(a) * d, 3 * (1 - t) + 1, 0, Math.PI * 2); ctx.fillStyle = i % 2 ? AMBER : '#7dffb9'; ctx.fill(); }
      ctx.globalAlpha = 1;
    } else if (fx.type === 'banner') {
      const inT = Math.min(1, t * 5), outT = Math.max(0, (t - 0.8) * 5);
      ctx.globalAlpha = inT * (1 - outT);
      ctx.save(); ctx.translate(W / 2, H * 0.3); ctx.scale(0.8 + 0.2 * easeInOut(inT), 0.8 + 0.2 * easeInOut(inT));
      printText(ctx, fx.text, 0, -18, 22, { chrome: state.machine.palette.title, glow: 18 });
      dmText(ctx, fx.sub, 0, 20, 26, '#7dffb9', { align: 'center', glow: 16 });
      ctx.restore(); ctx.globalAlpha = 1;
    }
  }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
function frame() { update(); render(); requestAnimationFrame(frame); }
layout();
updateTypeUI();
updateHUD();
window.addEventListener('resize', layout);
requestAnimationFrame(frame);

// expose for tests
state.enterMachine = enterMachine;
state.leaveMachine = leaveMachine;
state.cards = selectCards;
