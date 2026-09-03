// Slingo — slingshot pinball: state, input, physics, scoring and rendering.
import {
  BALL_TYPES, START_BALANCE, TOPUP_AMOUNT, PHYS, fmtMoney, round2,
} from './config.js';
import { buildField, rollMultiplier, awardFor, residualFor } from './field.js';
import { initAudio, sfx, toggleMute } from './audio.js';

// ---------------------------------------------------------------------------
// Canvas / layout
// ---------------------------------------------------------------------------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let W = 0, H = 0, DPR = 1;
let field = null;
const sling = { ax: 0, ay: 0, maxPull: 0 };

function layout() {
  W = window.innerWidth;
  H = window.innerHeight;
  DPR = Math.min(window.devicePixelRatio || 1, 2.5);
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';

  // Playfield fills the screen above a slim slingshot strip.
  const top = H * 0.07;
  const availH = H * 0.79 - top;
  let fw = Math.min(W * 0.96, availH * 0.8);
  let fh = Math.min(availH, fw / 0.58);
  const fx = (W - fw) / 2;
  const fy = top + (availH - fh) / 2;
  const old = field;
  field = buildField(fx, fy, fw, fh);
  if (old) rescaleBalls(old, field);

  sling.ax = W / 2;
  sling.ay = H * 0.875;
  sling.maxPull = Math.min(Math.min(W, H) * 0.22, (H - sling.ay) * 1.6);
}

// Keep balls in place (relative to the field) across resizes.
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
  flights: [],   // balls arcing from the slingshot into the field
  balls: [],     // balls in play on the field
  effects: [],
  drag: null,
  loaded: true,
  reloadAt: 0,
  shake: { mag: 0, t: 0 },
  now: performance.now(),
  last: performance.now(),
  settled: [],   // {target, paid} log (used by tests)
};
window.__slingo = state;
layout();
window.addEventListener('resize', layout);

const ballType = () => BALL_TYPES[state.typeIdx];

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
let toastTimer = 0;

function updateHUD() {
  $balance.textContent = fmtMoney(state.balance);
  $lastwin.textContent = state.lastWin > 0 ? 'WIN ' + fmtMoney(state.lastWin) : '';
  const n = state.balls.length + state.flights.length;
  $inplay.textContent = n ? `${n} IN PLAY` : '';
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
updateHUD();
updateTypeUI();

// ---------------------------------------------------------------------------
// Slingshot input (pointer events → touch and mouse alike)
// ---------------------------------------------------------------------------
canvas.addEventListener('pointerdown', (e) => {
  initAudio();
  if (state.drag) return;
  if (e.clientY < field.y0 + field.h + 6) return; // grab below the field
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
  if (power > 0.1) fire(from, to, power); // rapid fire: never drop a pull
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
// Aim is clamped to the field's entry zone: the slingshot can only shoot into play.
function aimTarget() {
  const p = pouchPos();
  const e = field.entry;
  const gain = (sling.ay - e.y0) / sling.maxPull;
  const x = sling.ax + (sling.ax - p.x) * gain;
  const y = sling.ay + (sling.ay - p.y) * gain;
  return { x: Math.min(e.x1, Math.max(e.x0, x)), y: Math.min(e.y1, Math.max(e.y0, y)) };
}

function fire(from, to, power) {
  const type = ballType();
  if (type.bet > state.balance + 1e-9) {
    toast(`Not enough balance for a ${type.name} ball — tap ${$topup.textContent}`);
    return;
  }
  state.balance -= type.bet;
  const mult = rollMultiplier(); // the isolated bet is decided here
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  state.flights.push({
    x0: from.x, y0: from.y, x1: to.x, y1: to.y,
    cx: (from.x + to.x) / 2, cy: Math.min(from.y, to.y) - (H * 0.05 + H * 0.06 * power),
    t: 0, dur: 320 + 200 * Math.min(1, dist / (H * 0.8)), power, type,
    stake: type.bet, mult,
  });
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

// A flight lands: the ball enters the field with the shot's momentum.
function spawnBall(f) {
  const dx = f.x1 - f.x0, dy = f.y1 - f.y0;
  const len = Math.hypot(dx, dy) || 1;
  const [s0, s1] = PHYS.entrySpeed;
  const speed = field.h * (s0 + (s1 - s0) * f.power);
  const r = PHYS.ballRadius * field.w;
  const x = Math.min(field.x0 + field.w - r * 1.5, Math.max(field.x0 + r * 1.5, f.x1));
  state.balls.push({
    x, y: f.y1, vx: (dx / len) * speed, vy: (dy / len) * speed, r,
    type: f.type, stake: f.stake, mult: f.mult, target: round2(f.mult * f.stake), total: 0,
    born: state.now, cd: new Map(), slowSince: 0, dying: null, hits: 0,
  });
  sfx.hit();
  state.effects.push({ type: 'puff', x, y: f.y1, t0: state.now, dur: 350 });
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------
function award(ball, comp, key, sign, x, y) {
  const until = ball.cd.get(key) || 0;
  if (state.now < until) return;
  ball.cd.set(key, state.now + 140);
  comp.flashT = state.now;
  ball.hits++;
  const a = awardFor(ball, sign);
  if (a === 0) { sfx.miss(); return; }
  ball.total = round2(ball.total + a);
  (a > 0 ? sfx.fill : sfx.lose)();
  state.effects.push({
    type: 'float', x, y, text: (a > 0 ? '+' : '−') + fmtMoney(Math.abs(a)).slice(1),
    color: a > 0 ? '#7dffb9' : '#ff8d8d', t0: state.now, dur: 1000, size: 15,
  });
}

// The ball is swallowed by a pocket or hole: reveal the residual, pay out.
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
  if (win) schedule(150, () => (big ? sfx.bigwin() : sfx.win()));
  else schedule(150, () => sfx.lose());
  state.effects.push({
    type: 'reveal', x, y: Math.min(y, field.y0 + field.h - 30), t0: state.now, dur: 2200,
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

function integrate(b, h) {
  const F = field;
  const age = state.now - b.born;
  let g = PHYS.gravity * F.h;
  if (age > PHYS.softLifeMs) g *= 1 + (age - PHYS.softLifeMs) / 3000; // drain stuck balls
  b.vy += g * h;
  const drag = Math.max(0, 1 - PHYS.drag * h);
  b.vx *= drag; b.vy *= drag;
  const vmax = PHYS.maxSpeed * F.h;
  const sp = Math.hypot(b.vx, b.vy);
  if (sp > vmax) { b.vx *= vmax / sp; b.vy *= vmax / sp; }
  b.prevY = b.y;
  b.x += b.vx * h;
  b.y += b.vy * h;

  for (const s of F.walls) collideSegment(b, s, PHYS.restitutionWall);
  for (const s of F.rails) {
    if (collideSegment(b, s, PHYS.restitutionWall)) {
      award(b, s, s, s.sign, (s.a.x + s.b.x) / 2, (s.a.y + s.b.y) / 2 - 14);
    }
  }
  for (const p of F.pins) {
    if (collideCircle(b, p, PHYS.restitutionPin, 0)) {
      if (p.sign) award(b, p, p, p.sign, p.x, p.y - p.r - 10);
      else p.flashT = state.now;
    }
  }
  for (const bp of F.bumpers) {
    if (collideCircle(b, bp, PHYS.restitutionBumper, PHYS.bumperKick * F.h)) {
      award(b, bp, bp, bp.sign, bp.x, bp.y - bp.r - 10);
      shake(0.12);
    }
  }
  // hard bounds (safety net)
  if (b.x < F.x0 + b.r) { b.x = F.x0 + b.r; b.vx = Math.abs(b.vx) * 0.5; }
  if (b.x > F.x0 + F.w - b.r) { b.x = F.x0 + F.w - b.r; b.vx = -Math.abs(b.vx) * 0.5; }
  if (b.y < F.y0 + b.r) { b.y = F.y0 + b.r; b.vy = Math.abs(b.vy) * 0.5; }

  // stuck detection → nudge
  if (Math.hypot(b.vx, b.vy) < 0.03 * F.h) {
    if (!b.slowSince) b.slowSince = state.now;
    else if (state.now - b.slowSince > 450) {
      b.vx += (Math.random() - 0.5) * 0.4 * F.h;
      b.vy -= 0.15 * F.h;
      b.slowSince = 0;
    }
  } else b.slowSince = 0;
}

function collideSegment(b, s, e) {
  const abx = s.b.x - s.a.x, aby = s.b.y - s.a.y;
  const len2 = abx * abx + aby * aby;
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
    // tangential friction
    const tx = -ny, ty = nx;
    const vt = b.vx * tx + b.vy * ty;
    b.vx -= vt * 0.04 * tx; b.vy -= vt * 0.04 * ty;
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
  const F = field;
  // rollover lanes (crossed downward)
  for (const l of F.lanes) {
    if (b.prevY < l.y && b.y >= l.y && Math.abs(b.x - l.x) < l.halfW) {
      award(b, l, l, l.sign, l.x, l.y - 12);
    }
  }
  // holes
  for (const hole of F.holes) {
    if (Math.hypot(b.x - hole.x, b.y - hole.y) < hole.r * 0.62) {
      settle(b, hole.x, hole.y, hole);
      return;
    }
  }
  // pockets
  if (b.y > F.pocketLine) {
    const i = Math.max(0, Math.min(4, Math.floor((b.x - F.x0) / (F.w / 5))));
    const p = F.pockets[i];
    settle(b, (p.x0 + p.x1) / 2, p.yTop + (F.pocketLine - p.yTop) / 2, p);
    return;
  }
  // hard life limit: force-settle into the nearest pocket
  if (state.now - b.born > PHYS.hardLifeMs) {
    const i = Math.max(0, Math.min(4, Math.floor((b.x - F.x0) / (F.w / 5))));
    const p = F.pockets[i];
    settle(b, (p.x0 + p.x1) / 2, p.yTop + (F.pocketLine - p.yTop) / 2, p);
  }
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------
function update() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - state.last) / 1000);
  state.last = now;
  state.now = now;

  for (let i = pending.length - 1; i >= 0; i--) {
    if (now >= pending[i].at) pending.splice(i, 1)[0].fn();
  }

  // flights
  for (let i = state.flights.length - 1; i >= 0; i--) {
    const f = state.flights[i];
    f.t += (dt * 1000) / f.dur;
    if (f.t >= 1) {
      state.flights.splice(i, 1);
      spawnBall(f);
      updateHUD();
    }
  }
  if (!state.loaded && now >= state.reloadAt) state.loaded = true;

  const hadBalls = state.balls.length;
  stepPhysics(dt);
  if (state.balls.length !== hadBalls) updateHUD();

  state.effects = state.effects.filter((fx) => now - fx.t0 < fx.dur);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

function rr(x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}
function text(str, x, y, size, color, { bold = true, align = 'center', glow = 0 } = {}) {
  ctx.font = `${bold ? '700' : '500'} ${size}px system-ui, -apple-system, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  if (glow) { ctx.shadowColor = color; ctx.shadowBlur = glow; }
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
  ctx.shadowBlur = 0;
}
const flash = (comp, dur = 350) => (comp.flashT ? Math.max(0, 1 - (state.now - comp.flashT) / dur) : 0);

function render() {
  const now = state.now;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const sAge = now - state.shake.t;
  if (state.shake.mag > 0 && sAge < 320) {
    const m = state.shake.mag * (1 - sAge / 320);
    ctx.translate((Math.random() * 2 - 1) * m, (Math.random() * 2 - 1) * m);
  } else state.shake.mag = 0;

  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0d1026');
  bg.addColorStop(0.55, '#131735');
  bg.addColorStop(1, '#0a0c1c');
  ctx.fillStyle = bg;
  ctx.fillRect(-20, -20, W + 40, H + 40);

  drawField(now);
  drawFlights();
  drawBalls(now);
  drawSlingshot(now);
  drawEffects(now);
}

function fieldPath() {
  const F = field;
  ctx.beginPath();
  ctx.moveTo(F.x0, F.y0 + F.h);
  ctx.lineTo(F.arch[0].x, F.arch[0].y);
  for (const p of F.arch) ctx.lineTo(p.x, p.y);
  ctx.lineTo(F.x0 + F.w, F.y0 + F.h);
  ctx.closePath();
}

function drawField(now) {
  const F = field;
  // table surface
  fieldPath();
  const g = ctx.createLinearGradient(0, F.y0, 0, F.y0 + F.h);
  g.addColorStop(0, '#1a1f45');
  g.addColorStop(1, '#22285a');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.save();
  ctx.clip();
  // subtle glow + grid
  const rg = ctx.createRadialGradient(F.x0 + F.w / 2, F.y0 + F.h * 0.35, 10, F.x0 + F.w / 2, F.y0 + F.h * 0.35, F.w);
  rg.addColorStop(0, 'rgba(90,140,255,0.16)');
  rg.addColorStop(1, 'rgba(90,140,255,0)');
  ctx.fillStyle = rg;
  ctx.fillRect(F.x0, F.y0, F.w, F.h);
  ctx.strokeStyle = 'rgba(120,150,255,0.07)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 10; i++) {
    ctx.beginPath(); ctx.moveTo(F.x0 + (F.w * i) / 10, F.y0); ctx.lineTo(F.x0 + (F.w * i) / 10, F.y0 + F.h); ctx.stroke();
  }
  for (let i = 1; i < 14; i++) {
    ctx.beginPath(); ctx.moveTo(F.x0, F.y0 + (F.h * i) / 14); ctx.lineTo(F.x0 + F.w, F.y0 + (F.h * i) / 14); ctx.stroke();
  }

  // entry zone hint while aiming
  if (state.drag) {
    const e = F.entry;
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = 'rgba(64,224,255,0.35)';
    ctx.lineWidth = 1.5;
    rr(e.x0, e.y0, e.x1 - e.x0, e.y1 - e.y0, 10);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // pockets
  for (const p of F.pockets) {
    const f = flash(p, 900);
    rr(p.x0 + 4, p.yTop + 4, p.x1 - p.x0 - 8, F.y0 + F.h - p.yTop - 4, 6);
    ctx.fillStyle = f ? `rgba(255,214,90,${0.25 + 0.5 * f})` : '#0b0d20';
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,150,255,0.4)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    text('?', (p.x0 + p.x1) / 2, (p.yTop + F.y0 + F.h) / 2 + 2, Math.min(28, F.w * 0.06), f ? '#fff' : 'rgba(255,255,255,0.35)', { glow: f ? 12 : 0 });
  }

  // holes
  for (const hole of F.holes) {
    const f = flash(hole, 900);
    ctx.beginPath();
    ctx.arc(hole.x, hole.y, hole.r, 0, Math.PI * 2);
    const hg = ctx.createRadialGradient(hole.x, hole.y, hole.r * 0.2, hole.x, hole.y, hole.r);
    hg.addColorStop(0, '#05060f');
    hg.addColorStop(1, f ? `rgba(255,214,90,${0.6 * f})` : '#161a3a');
    ctx.fillStyle = hg;
    ctx.fill();
    ctx.strokeStyle = f ? '#ffd65a' : 'rgba(160,190,255,0.55)';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#ffd65a';
    ctx.shadowBlur = 14 * f;
    ctx.stroke();
    ctx.shadowBlur = 0;
    text('?', hole.x, hole.y + 1, hole.r * 1.1, 'rgba(255,255,255,0.45)');
  }

  // rollover lanes
  for (const l of F.lanes) {
    const f = flash(l, 500);
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = f ? `rgba(125,255,185,${0.5 + 0.5 * f})` : 'rgba(125,255,185,0.35)';
    ctx.lineWidth = f ? 3 : 1.5;
    ctx.shadowColor = '#7dffb9';
    ctx.shadowBlur = 12 * f;
    ctx.beginPath();
    ctx.moveTo(l.x - l.halfW, l.y);
    ctx.lineTo(l.x + l.halfW, l.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;
    text('+', l.x, l.y - 11, 11, 'rgba(125,255,185,0.8)');
  }

  // walls
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(110,200,255,0.85)';
  ctx.lineWidth = 3;
  ctx.shadowColor = '#40e0ff';
  ctx.shadowBlur = 8;
  ctx.beginPath();
  for (const s of F.walls) { ctx.moveTo(s.a.x, s.a.y); ctx.lineTo(s.b.x, s.b.y); }
  ctx.stroke();
  ctx.shadowBlur = 0;

  // signed rails
  for (const s of F.rails) {
    const f = flash(s);
    const col = s.sign > 0 ? '#39d97a' : '#e0455a';
    ctx.strokeStyle = col;
    ctx.lineWidth = 6 + 3 * f;
    ctx.shadowColor = col;
    ctx.shadowBlur = 10 + 16 * f;
    ctx.beginPath(); ctx.moveTo(s.a.x, s.a.y); ctx.lineTo(s.b.x, s.b.y); ctx.stroke();
    ctx.shadowBlur = 0;
    const mx = (s.a.x + s.b.x) / 2, my = (s.a.y + s.b.y) / 2;
    text(s.sign > 0 ? '+' : '−', mx + (s.a.x < F.x0 + F.w / 2 ? 14 : -14), my - 10, 14, col, { glow: 6 });
  }

  // pins (signed kicker pins are tinted green/red)
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
    if (p.sign) {
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // bumpers
  for (const bp of F.bumpers) {
    const f = flash(bp);
    const col = bp.sign > 0 ? '#39d97a' : '#e0455a';
    if (f) {
      ctx.beginPath();
      ctx.arc(bp.x, bp.y, bp.r + 18 * (1 - f), 0, Math.PI * 2);
      ctx.strokeStyle = col;
      ctx.globalAlpha = f;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
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
    text(bp.sign > 0 ? '+' : '−', bp.x, bp.y + 1, bp.r * 1.3, '#fff', { glow: 4 });
  }
  ctx.restore();

  // field outline
  fieldPath();
  ctx.strokeStyle = 'rgba(120,150,255,0.45)';
  ctx.lineWidth = 2;
  ctx.stroke();
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
  const r0 = 9, r1 = PHYS.ballRadius * field.w;
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
    let r = b.r;
    let x = b.x, y = b.y;
    if (b.dying) {
      const t = Math.min(1, (now - b.dying.t0) / 360);
      r = b.r * (1 - t);
      x = b.x + (b.dying.x - b.x) * t;
      y = b.y + (b.dying.y - b.y) * t;
      if (r <= 0.5) continue;
    }
    drawBallSprite(x, y, r, b.type);
    if (!b.dying) {
      const lbl = fmtMoney(b.total);
      const col = b.total > 0 ? '#7dffb9' : b.total < 0 ? '#ff8d8d' : 'rgba(255,255,255,0.85)';
      text(lbl, x, y - b.r - 10, 12, col, { glow: 6 });
    }
  }
}

// ---------------------------------------------------------------------------
// Slingshot
// ---------------------------------------------------------------------------
function drawSlingshot(now) {
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
  ctx.strokeStyle = '#252c52';
  ctx.lineWidth = 11;
  framePath();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(110,200,255,0.85)';
  ctx.lineWidth = 2.2;
  ctx.shadowColor = '#40e0ff';
  ctx.shadowBlur = 9;
  framePath();
  ctx.stroke();
  ctx.shadowBlur = 0;

  rr(sling.ax - S * 0.035, baseY - 4, S * 0.07, 8, 4);
  ctx.fillStyle = '#252c52';
  ctx.fill();
  ctx.strokeStyle = 'rgba(110,200,255,0.5)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const bandTo = state.loaded ? pouch : { x: sling.ax, y: sling.ay + 6 };
  for (const tip of [forkL, forkR]) {
    const bg = ctx.createLinearGradient(tip.x, tip.y, bandTo.x, bandTo.y);
    bg.addColorStop(0, 'rgba(64,224,255,0.95)');
    bg.addColorStop(1, 'rgba(255,214,90,0.95)');
    ctx.strokeStyle = bg;
    ctx.lineWidth = 3.2;
    ctx.shadowColor = '#7fd8ff';
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
    ctx.fillStyle = '#cdf2ff';
    ctx.shadowColor = '#40e0ff';
    ctx.shadowBlur = 12;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  if (state.loaded) {
    ctx.beginPath();
    ctx.arc(pouch.x, pouch.y - 3, 13, Math.PI * 0.15, Math.PI * 0.85);
    ctx.strokeStyle = 'rgba(120,220,255,0.9)';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#40e0ff';
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
      ctx.fillStyle = 'rgba(140,225,255,0.8)';
      for (let i = 1; i <= 14; i++) {
        const t = i / 15;
        const p = bez(f, t);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.8 - 1.4 * t, 0, Math.PI * 2);
        ctx.fill();
      }
      const pu = 0.6 + 0.4 * Math.sin(now / 140);
      ctx.strokeStyle = 'rgba(64,224,255,0.95)';
      ctx.lineWidth = 2.2;
      ctx.shadowColor = '#40e0ff';
      ctx.shadowBlur = 10 * pu;
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
      ctx.fillStyle = 'rgba(8,10,28,0.9)';
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
