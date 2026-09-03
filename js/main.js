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
let W = 0, H = 0, DPR = 1;
let board = null;
const sling = { ax: 0, ay: 0, maxPull: 0 };
const fieldRect = { x: 0, y: 0, w: 0, h: 0 };

function layout() {
  W = window.innerWidth;
  H = window.innerHeight;
  DPR = Math.min(window.devicePixelRatio || 1, 2.5);
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
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
  if (state.spec) board = realize(state.spec, fieldRect.x, fieldRect.y, fw, fh);
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
  launched: 0,       // balls launched on the current board
  boardFadeT: 0,     // when the current board appeared
  flights: [],
  balls: [],
  effects: [],
  drag: null,
  loaded: true,
  reloadAt: 0,
  shake: { mag: 0, t: 0 },
  now: performance.now(),
  last: performance.now(),
  settled: [],       // {target, paid, res, hits, life} log (used by tests)
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
newBoard(); // first board (also runs layout + HUD)
updateTypeUI();
window.addEventListener('resize', layout);

// ---------------------------------------------------------------------------
// Slingshot input (pointer events → touch and mouse alike)
// ---------------------------------------------------------------------------
canvas.addEventListener('pointerdown', (e) => {
  initAudio();
  if (state.drag) return;
  if (e.clientY < board.y0 + board.h + 6) return; // grab below the field
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
// The whole cabinet is open to aim at, except the zone just above the exit.
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
  const mult = rollMultiplier(theme().table); // the isolated bet is decided here
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  state.flights.push({
    x0: from.x, y0: from.y, x1: to.x, y1: to.y,
    cx: (from.x + to.x) / 2, cy: Math.min(from.y, to.y) - (H * 0.05 + H * 0.06 * power),
    t: 0, dur: 300 + 220 * Math.min(1, dist / (H * 0.8)), power, type,
    stake: type.bet, mult, flips: theme().flips, table: theme().key,
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
    lastComp: null, repeat: 0, overshoots: 0,
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
  // a ball rattling against the same component: stop scoring it and kick it loose
  if (comp === ball.lastComp) ball.repeat++; else { ball.lastComp = comp; ball.repeat = 0; }
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
  // hard bounds (safety net)
  if (b.x < F.x0 + b.r) { b.x = F.x0 + b.r; b.vx = Math.abs(b.vx) * 0.5; }
  if (b.x > F.x0 + F.w - b.r) { b.x = F.x0 + F.w - b.r; b.vx = -Math.abs(b.vx) * 0.5; }
  if (b.y < F.y0 + b.r) { b.y = F.y0 + b.r; b.vy = Math.abs(b.vy) * 0.5; }

  if (Math.hypot(b.vx, b.vy) < 0.03 * F.h) {
    if (!b.slowSince) b.slowSince = state.now;
    else if (state.now - b.slowSince > 450) {
      b.vx += (Math.random() - 0.5) * 0.4 * F.h;
      b.vy -= 0.15 * F.h;
      b.slowSince = 0;
    }
  } else b.slowSince = 0;
}

// kickAway: optional {cx,cy} centre to push away from (triangle kickers)
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
  const rr = b.r + c.r;
  if (d >= rr) return false;
  if (d < 1e-6) { nx = 0; ny = -1; } else { nx /= d; ny /= d; }
  const pen = rr - d;
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
      const rr = a.r + b.r;
      if (d >= rr || d < 1e-6) continue;
      nx /= d; ny /= d;
      const pen = (rr - d) / 2;
      a.x -= nx * pen; a.y -= ny * pen; b.x += nx * pen; b.y += ny * pen;
      const rvn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rvn < 0) {
        const jimp = -(1 + 0.8) * rvn / 2;
        a.vx -= jimp * nx; a.vy -= jimp * ny; b.vx += jimp * nx; b.vy += jimp * ny;
      }
    }
  }
}

function checkSensors(b) {
  const F = board;
  for (const l of F.lanes) {
    if (b.prevY < l.y && b.y >= l.y && Math.abs(b.x - l.x) < l.halfW) award(b, l, l.sign, l.tier, l.x, l.y - 12);
  }
  for (const hole of F.holes) {
    if (Math.hypot(b.x - hole.x, b.y - hole.y) < hole.r * 0.62) { settle(b, hole.x, hole.y, hole); return; }
  }
  // auto-reactive flippers: fire when a ball drops onto them (limited charges per ball)
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
  if (state.balls.length !== hadBalls) {
    updateHUD();
    // board exhausted and field empty → roll a new board after the reveal
    if (fieldEmpty() && state.launched >= BOARD_BALLS && !state.boardPending) {
      state.boardPending = true;
      schedule(1500, () => { state.boardPending = false; if (fieldEmpty() && state.launched >= BOARD_BALLS) { sfx.flip(); newBoard(); } });
    }
  }
  state.effects = state.effects.filter((fx) => now - fx.t0 < fx.dur);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const flash = (comp, dur = 350) => (comp.flashT ? Math.max(0, 1 - (state.now - comp.flashT) / dur) : 0);

function rr(x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}
function text(str, x, y, size, color, { bold = true, align = 'center', glow = 0, spacing = '' } = {}) {
  ctx.font = `${bold ? '700' : '500'} ${size}px system-ui, -apple-system, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  if (spacing && 'letterSpacing' in ctx) ctx.letterSpacing = spacing;
  if (glow) { ctx.shadowColor = color; ctx.shadowBlur = glow; }
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
  ctx.shadowBlur = 0;
  if (spacing && 'letterSpacing' in ctx) ctx.letterSpacing = '0px';
}
function polyPath(poly) {
  ctx.beginPath();
  ctx.moveTo(poly[0][0], poly[0][1]);
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
  ctx.closePath();
}
function neonLine(a, b, color, width, glow) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.shadowColor = color;
  ctx.shadowBlur = glow;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.shadowBlur = 0;
}

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
  bg.addColorStop(0, '#07080f');
  bg.addColorStop(0.5, '#0b0d1a');
  bg.addColorStop(1, '#06070d');
  ctx.fillStyle = bg;
  ctx.fillRect(-20, -20, W + 40, H + 40);

  const fade = Math.min(1, (now - state.boardFadeT) / 600);
  ctx.globalAlpha = fade;
  drawCabinet(T, now);
  ctx.globalAlpha = 1;
  drawFlights();
  drawBalls(now);
  drawSlingshot(now, T);
  drawEffects(now);
}

function drawCabinet(T, now) {
  const F = board;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // outer carbon shell
  polyPath(F.poly);
  ctx.strokeStyle = '#141826';
  ctx.lineWidth = 22;
  ctx.stroke();
  polyPath(F.poly);
  ctx.strokeStyle = '#1d2236';
  ctx.lineWidth = 14;
  ctx.stroke();

  // table surface
  polyPath(F.poly);
  const g = ctx.createLinearGradient(0, F.y0, 0, F.y0 + F.h);
  g.addColorStop(0, T.surface[0]);
  g.addColorStop(1, T.surface[1]);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.save();
  polyPath(F.poly);
  ctx.clip();

  // ambient glow + hex-ish grid
  const rg = ctx.createRadialGradient(F.x0 + F.w * 0.5, F.y0 + F.h * 0.4, 10, F.x0 + F.w * 0.5, F.y0 + F.h * 0.4, F.w * 0.9);
  rg.addColorStop(0, T.glow.replace('0.55', '0.14'));
  rg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = rg;
  ctx.fillRect(F.x0, F.y0, F.w, F.h);
  ctx.strokeStyle = 'rgba(255,255,255,0.035)';
  ctx.lineWidth = 1;
  const gs = F.w / 12;
  for (let x = F.x0; x <= F.x0 + F.w; x += gs) { ctx.beginPath(); ctx.moveTo(x, F.y0); ctx.lineTo(x, F.y0 + F.h); ctx.stroke(); }
  for (let y = F.y0; y <= F.y0 + F.h; y += gs) { ctx.beginPath(); ctx.moveTo(F.x0, y); ctx.lineTo(F.x0 + F.w, y); ctx.stroke(); }

  // circuit traces
  ctx.strokeStyle = T.secondary;
  ctx.globalAlpha = 0.22;
  ctx.lineWidth = 1.5;
  for (const line of F.decor) {
    ctx.beginPath();
    ctx.moveTo(line[0].x, line[0].y);
    for (let i = 1; i < line.length; i++) ctx.lineTo(line[i].x, line[i].y);
    ctx.stroke();
    for (const p of line) { ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, Math.PI * 2); ctx.fillStyle = T.secondary; ctx.fill(); }
  }
  ctx.globalAlpha = 1;

  // orbit halo
  if (F.orbit) {
    ctx.beginPath();
    ctx.arc(F.orbit.x, F.orbit.y, F.orbit.r * 0.82, 0, Math.PI * 2);
    ctx.strokeStyle = T.secondary;
    ctx.globalAlpha = 0.18;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 6]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  // labels
  for (const l of F.labels) {
    if (l.main) {
      const size = Math.max(9, l.px * 0.55);
      ctx.font = `700 ${size}px system-ui, -apple-system, sans-serif`;
      const tw = ctx.measureText(l.text).width + 4;
      const total = tw + 16 + 30 + 36;
      const x0 = l.x - total / 2;
      text(l.text, x0 + tw / 2, l.y, size, T.primary, { glow: 10, spacing: '2px' });
      // risk pips
      const px = x0 + tw + 16 + 30, py = l.y;
      text('RISK', px - 18, py, 8, 'rgba(255,255,255,0.55)');
      for (let i = 0; i < 4; i++) {
        rr(px + i * 9, py - 3, 6, 6, 1.5);
        ctx.fillStyle = i < T.risk ? T.primary : 'rgba(255,255,255,0.15)';
        ctx.fill();
      }
    } else {
      text(l.text, l.x, l.y, Math.max(8, l.px * 0.5), 'rgba(255,255,255,0.28)', { spacing: '1px' });
    }
  }

  // no-aim zone (shown while aiming)
  if (state.drag) {
    const z = F.forbid;
    ctx.save();
    rr(z.x0, z.y0, z.x1 - z.x0, F.y0 + F.h - z.y0, 6);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,90,90,0.35)';
    ctx.lineWidth = 2;
    for (let d = -F.h; d < F.w + F.h; d += 12) { ctx.beginPath(); ctx.moveTo(z.x0 + d, z.y0); ctx.lineTo(z.x0 + d - 60, z.y0 + 60); ctx.stroke(); }
    ctx.restore();
    text('NO AIM', (z.x0 + z.x1) / 2, z.y0 + 16, 9, 'rgba(255,120,120,0.8)', { spacing: '2px' });
  }

  // exit slot
  {
    const f = flash(F.exit, 900);
    const ex0 = F.exit.x0 + 6, ex1 = F.exit.x1 - 6;
    const wellTop = F.y0 + F.h * 0.965;
    rr(ex0, wellTop + 2, ex1 - ex0, F.y0 + F.h - wellTop + 30, 4);
    ctx.fillStyle = f ? `rgba(255,214,90,${0.25 + 0.5 * f})` : '#05060f';
    ctx.fill();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = f ? '#ffd65a' : T.secondary;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(ex0, F.drainY);
    ctx.lineTo(ex1, F.drainY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    text('? EXIT', (ex0 + ex1) / 2, (wellTop + F.drainY) / 2 + 1, Math.min(10, F.h * 0.016), f ? '#fff' : 'rgba(255,255,255,0.5)', { glow: f ? 10 : 0, spacing: '2px' });
  }

  // holes & baskets
  for (const hole of F.holes) {
    const f = flash(hole, 900);
    if (hole.kind === 'basket') {
      ctx.beginPath();
      ctx.arc(hole.x, hole.y, hole.r, 0, Math.PI, false);
      ctx.lineTo(hole.x - hole.r, hole.y - hole.r * 0.6);
      ctx.moveTo(hole.x + hole.r, hole.y);
      ctx.lineTo(hole.x + hole.r, hole.y - hole.r * 0.6);
      ctx.strokeStyle = f ? '#ffd65a' : T.secondary;
      ctx.lineWidth = 3;
      ctx.shadowColor = '#ffd65a';
      ctx.shadowBlur = 14 * f;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(hole.x, hole.y, hole.r * 0.9, 0, Math.PI);
      ctx.fillStyle = f ? `rgba(255,214,90,${0.4 * f})` : 'rgba(5,6,15,0.9)';
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(hole.x, hole.y, hole.r, 0, Math.PI * 2);
      const hg = ctx.createRadialGradient(hole.x, hole.y, hole.r * 0.2, hole.x, hole.y, hole.r);
      hg.addColorStop(0, '#04050c');
      hg.addColorStop(1, f ? `rgba(255,214,90,${0.6 * f})` : '#12152a');
      ctx.fillStyle = hg;
      ctx.fill();
      ctx.strokeStyle = f ? '#ffd65a' : T.secondary;
      ctx.lineWidth = 2;
      ctx.shadowColor = '#ffd65a';
      ctx.shadowBlur = 14 * f;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    text('?', hole.x, hole.y + (hole.kind === 'basket' ? 2 : 1), hole.r * 1.1, 'rgba(255,255,255,0.5)');
  }

  // rollover lanes
  for (const l of F.lanes) {
    const f = flash(l, 500);
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = f ? `rgba(125,255,185,${0.5 + 0.5 * f})` : 'rgba(125,255,185,0.4)';
    ctx.lineWidth = f ? 3 : 1.5;
    ctx.shadowColor = '#7dffb9';
    ctx.shadowBlur = 12 * f;
    ctx.beginPath();
    ctx.moveTo(l.x - l.halfW, l.y);
    ctx.lineTo(l.x + l.halfW, l.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;
    text(tierLabel(l.sign, l.tier), l.x, l.y - 11, 11, '#7dffb9');
  }

  // walls: neon outline + guides
  for (const s of F.walls) {
    if (s.neon) neonLine(s.a, s.b, T.primary, s.orbit ? 4 : 3, 10);
    else neonLine(s.a, s.b, T.secondary, 2.5, 6);
    if (s.cap) { ctx.beginPath(); ctx.arc(s.a.x, s.a.y, 3.5, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); }
  }

  // signed rails
  for (const s of F.rails) {
    const f = flash(s);
    const col = s.sign > 0 ? '#39d97a' : '#e0455a';
    neonLine(s.a, s.b, col, 6 + 3 * f, 10 + 16 * f);
    const mx = (s.a.x + s.b.x) / 2, my = (s.a.y + s.b.y) / 2;
    text(tierLabel(s.sign, s.tier), mx, my - 13, 13, col, { glow: 6 });
  }

  // triangle kickers
  for (const t of F.tris) {
    const f = flash(t);
    const col = t.sign > 0 ? '#39d97a' : '#e0455a';
    ctx.beginPath();
    ctx.moveTo(t.pts[0].x, t.pts[0].y);
    ctx.lineTo(t.pts[1].x, t.pts[1].y);
    ctx.lineTo(t.pts[2].x, t.pts[2].y);
    ctx.closePath();
    ctx.fillStyle = f ? col : '#0d1020';
    ctx.globalAlpha = f ? 0.5 + 0.5 * f : 1;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = col;
    ctx.lineWidth = 3;
    ctx.shadowColor = col;
    ctx.shadowBlur = 8 + 14 * f;
    ctx.stroke();
    ctx.shadowBlur = 0;
    text(tierLabel(t.sign, t.tier), t.cx, t.cy, 12, col, { glow: 6 });
  }

  // pins
  for (const p of F.pins) {
    const f = flash(p, 250);
    const base = p.sign > 0 ? '#39d97a' : p.sign < 0 ? '#e0455a' : '#9fb4e8';
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = f ? '#ffffff' : base;
    ctx.shadowColor = p.sign ? base : '#cfe0ff';
    ctx.shadowBlur = (p.sign ? 9 : 6) + 10 * f;
    ctx.fill();
    ctx.shadowBlur = 0;
    if (p.sign) text(p.sign > 0 ? '+' : '−', p.x, p.y - p.r - 7, 10, base);
  }

  // bumpers: reactor / bonus / pop
  for (const bp of F.bumpers) {
    const f = flash(bp);
    const col = bp.sign > 0 ? '#39d97a' : '#e0455a';
    const ring = bp.kind === 'reactor' ? T.primary : bp.kind === 'bonus' ? T.secondary : col;
    if (f) {
      ctx.beginPath();
      ctx.arc(bp.x, bp.y, bp.r + 22 * (1 - f), 0, Math.PI * 2);
      ctx.strokeStyle = ring;
      ctx.globalAlpha = f;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (bp.kind !== 'pop') {
      // concentric tech rings
      ctx.strokeStyle = ring;
      ctx.shadowColor = ring;
      ctx.shadowBlur = 10 + 14 * f;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(bp.x, bp.y, bp.r, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([2, 4]);
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(bp.x, bp.y, bp.r * 0.8, now / 900, now / 900 + Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(bp.x, bp.y, bp.r * 0.6, 0, Math.PI * 2);
      const cg = ctx.createRadialGradient(bp.x, bp.y, 1, bp.x, bp.y, bp.r * 0.6);
      cg.addColorStop(0, f ? '#fff' : ring);
      cg.addColorStop(1, '#0a0c1c');
      ctx.fillStyle = cg;
      ctx.fill();
      text(bp.kind === 'reactor' ? 'CORE' : 'BONUS', bp.x, bp.y - bp.r * 0.16, Math.max(7, bp.r * 0.22), '#fff', { spacing: '1px' });
      text(tierLabel(bp.sign, bp.tier), bp.x, bp.y + bp.r * 0.2, Math.max(9, bp.r * 0.3), col, { glow: 6 });
    } else {
      ctx.beginPath();
      ctx.arc(bp.x, bp.y, bp.r, 0, Math.PI * 2);
      const bgr = ctx.createRadialGradient(bp.x - bp.r * 0.3, bp.y - bp.r * 0.3, bp.r * 0.1, bp.x, bp.y, bp.r);
      bgr.addColorStop(0, f ? '#ffffff' : (bp.sign > 0 ? '#8affc0' : '#ff9aa8'));
      bgr.addColorStop(1, bp.sign > 0 ? '#1d8a4a' : '#8f1f30');
      ctx.fillStyle = bgr;
      ctx.shadowColor = col;
      ctx.shadowBlur = 12 + 20 * f;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 2;
      ctx.stroke();
      text(tierLabel(bp.sign, bp.tier), bp.x, bp.y + 1, bp.r * 0.9, '#fff', { glow: 4 });
    }
  }

  // flippers
  for (const f of F.flippers) {
    const seg = flipperSegment(f);
    const active = state.now - f.flipT < 380;
    ctx.beginPath();
    ctx.moveTo(seg.a.x, seg.a.y);
    ctx.lineTo(seg.b.x, seg.b.y);
    ctx.strokeStyle = '#1d2236';
    ctx.lineWidth = 12;
    ctx.stroke();
    neonLine(seg.a, seg.b, active ? '#ffffff' : T.primary, 4, active ? 18 : 8);
    ctx.beginPath();
    ctx.arc(seg.a.x, seg.a.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
  }
  ctx.restore();

  // cabinet neon edge
  polyPath(F.poly);
  ctx.strokeStyle = T.primary;
  ctx.lineWidth = 2.5;
  ctx.shadowColor = T.primary;
  ctx.shadowBlur = 14;
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function drawBallSprite(x, y, radius, type, { glow = 10 } = {}) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  const g = ctx.createRadialGradient(x - radius / 3, y - radius / 3, radius / 5, x, y, radius);
  g.addColorStop(0, type.hi);
  g.addColorStop(0.55, type.color);
  g.addColorStop(1, shade(type.color, 0.65));
  ctx.fillStyle = g;
  ctx.shadowColor = type.color;
  ctx.shadowBlur = glow;
  ctx.fill();
  ctx.shadowBlur = 0;
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
      ctx.beginPath();
      ctx.arc(p.x, p.y, (r0 + (r1 - r0) * t) * (1 - i * 0.2), 0, Math.PI * 2);
      ctx.fillStyle = f.type.color;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    const p = bez(f, t);
    drawBallSprite(p.x, p.y, r0 + (r1 - r0) * t, f.type);
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
      text(fmtMoney(b.total), x, y - b.r - 10, 12, col, { glow: 6 });
      if (b.flips > 0) {
        for (let i = 0; i < b.flips; i++) {
          ctx.beginPath();
          ctx.arc(x - (b.flips - 1) * 3 + i * 6, y + b.r + 6, 2, 0, Math.PI * 2);
          ctx.fillStyle = theme().primary;
          ctx.fill();
        }
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
    ctx.moveTo(sling.ax, baseY);
    ctx.lineTo(sling.ax, crotchY);
    ctx.moveTo(sling.ax, crotchY);
    ctx.quadraticCurveTo(forkL.x, sling.ay + S * 0.008, forkL.x, forkY);
    ctx.moveTo(sling.ax, crotchY);
    ctx.quadraticCurveTo(forkR.x, sling.ay + S * 0.008, forkR.x, forkY);
  };
  ctx.strokeStyle = '#1d2236';
  ctx.lineWidth = 11;
  framePath();
  ctx.stroke();
  ctx.strokeStyle = T.primary;
  ctx.lineWidth = 2.2;
  ctx.shadowColor = T.primary;
  ctx.shadowBlur = 9;
  framePath();
  ctx.stroke();
  ctx.shadowBlur = 0;

  rr(sling.ax - S * 0.035, baseY - 4, S * 0.07, 8, 4);
  ctx.fillStyle = '#1d2236';
  ctx.fill();
  ctx.strokeStyle = T.primary;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.globalAlpha = 1;

  const bandTo = state.loaded ? pouch : { x: sling.ax, y: sling.ay + 6 };
  for (const tip of [forkL, forkR]) {
    const bg = ctx.createLinearGradient(tip.x, tip.y, bandTo.x, bandTo.y);
    bg.addColorStop(0, T.primary);
    bg.addColorStop(1, '#ffd65a');
    ctx.strokeStyle = bg;
    ctx.lineWidth = 3.2;
    ctx.shadowColor = T.primary;
    ctx.shadowBlur = 7;
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(bandTo.x + (tip === forkL ? -8 : 8), bandTo.y);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  for (const tip of [forkL, forkR]) {
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = T.primary;
    ctx.shadowBlur = 12;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  if (state.loaded) {
    ctx.beginPath();
    ctx.arc(pouch.x, pouch.y - 3, 13, Math.PI * 0.15, Math.PI * 0.85);
    ctx.strokeStyle = T.primary;
    ctx.lineWidth = 3;
    ctx.shadowColor = T.primary;
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;
    drawBallSprite(pouch.x, pouch.y - 5, 9, ballType());
  }

  if (state.drag && state.loaded) {
    const power = pullPower();
    if (power > 0.08) {
      const to = aimTarget();
      const f = { x0: pouch.x, y0: pouch.y, x1: to.x, y1: to.y, cx: (pouch.x + to.x) / 2, cy: Math.min(pouch.y, to.y) - (H * 0.05 + H * 0.06 * power) };
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      for (let i = 1; i <= 14; i++) {
        const t = i / 15;
        const p = bez(f, t);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.8 - 1.4 * t, 0, Math.PI * 2);
        ctx.fill();
      }
      const pu = 0.6 + 0.4 * Math.sin(now / 140);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.2;
      ctx.shadowColor = T.primary;
      ctx.shadowBlur = 12 * pu;
      ctx.beginPath();
      ctx.arc(to.x, to.y, 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        ctx.moveTo(to.x + dx * 13, to.y + dy * 13);
        ctx.lineTo(to.x + dx * 6, to.y + dy * 6);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(to.x, to.y, 2.6, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(pouch.x, pouch.y, 22, -Math.PI / 2, -Math.PI / 2 + power * Math.PI * 2);
      ctx.strokeStyle = power >= 0.98 ? '#ff6a6a' : '#ffd65a';
      ctx.lineWidth = 3;
      ctx.stroke();
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
      text(fx.text, fx.x, fx.y - 26 * easeOutCubic(t), fx.size || 18, fx.color, { glow: 8 });
      ctx.globalAlpha = 1;
    } else if (fx.type === 'puff') {
      ctx.globalAlpha = (1 - t) * 0.5;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, 4 + 18 * easeOutCubic(t), 0, Math.PI * 2);
      ctx.strokeStyle = '#ffe9a8';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else if (fx.type === 'reveal') {
      const inT = Math.min(1, t * 6);
      const outT = Math.max(0, (t - 0.75) * 4);
      ctx.globalAlpha = inT * (1 - outT);
      const y = fx.y - 22 * easeOutCubic(inT);
      rr(fx.x - 58, y - 24, 116, 46, 8);
      ctx.fillStyle = 'rgba(8,10,28,0.92)';
      ctx.fill();
      ctx.strokeStyle = fx.color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      text(fx.line1, fx.x, y - 9, 16, fx.color, { glow: 8 });
      text(fx.line2, fx.x, y + 11, 11, 'rgba(255,255,255,0.85)');
      ctx.globalAlpha = 1;
    } else if (fx.type === 'burst') {
      ctx.globalAlpha = 1 - t;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 + fx.t0;
        const d = 12 + 60 * easeOutCubic(t);
        ctx.beginPath();
        ctx.arc(fx.x + Math.cos(a) * d, fx.y + Math.sin(a) * d, 3 * (1 - t) + 1, 0, Math.PI * 2);
        ctx.fillStyle = i % 2 ? '#ffd65a' : '#7dffb9';
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    } else if (fx.type === 'banner') {
      const inT = Math.min(1, t * 5);
      const outT = Math.max(0, (t - 0.8) * 5);
      ctx.globalAlpha = inT * (1 - outT);
      ctx.save();
      ctx.translate(W / 2, H * 0.3);
      ctx.scale(0.8 + 0.2 * easeInOut(inT), 0.8 + 0.2 * easeInOut(inT));
      text(fx.text, 0, -14, 26, '#ffd65a', { glow: 18 });
      text(fx.sub, 0, 22, 32, '#7dffb9', { glow: 14 });
      ctx.restore();
      ctx.globalAlpha = 1;
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
requestAnimationFrame(frame);
