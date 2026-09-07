// Slingo — plunger pinball on nine hand-built machines.
import { BALL_TYPES, START_BALANCE, TOPUP_AMOUNT, PHYS, LAUNCH_CREDIT, EXIT_BANDS, POWER_WINDOWS, fmtMoney, round2 } from './config.js';
import { realize, rollMultiplier, applyHit, hitFraction, totalAfter, exitMultiplier, flipperSegment } from './field.js';
import { createWorld, stepWorld, newBall, fire, resetFixtures, flipperAngle, makeRng, SUBSTEP } from './physics.js';
import { MACHINES, buildMachine, buyIn, allowedTypes, machineProfile } from './machines.js';
import {
  SIGN_COL, GATE_COL, AMBER, rr, polyPath, shade, withAlpha, chromeStroke, post, bumperCap,
  lampInsert, bar, drawMotif, buildStatic, renderThumb, drawBallSprite,
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
let world = null;
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
    world = createWorld(board, profile());
    world.time = state.now;
    buildStatic(sctx, board, W, H, DPR);
    requestPlan();
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
  screen: 'lobby',   // 'lobby' (overlay on the live machine) | 'play'
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
  demoAt: 0,         // next attract-mode ball while in the lobby
  acc: 0,            // fixed-step accumulator
  plan: null,        // {key, cands, done} from the launch planner
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

// Put a machine on the table (lobby or play) and refresh everything that
// depends on it. The lobby is an overlay on this live machine.
function showMachine(idx) {
  const m = MACHINES[idx];
  state.machine = m;
  state.machineIdx = idx;
  state.spec = buildMachine(m);
  state.balls = [];
  state.seated = null;
  state.effects = [];
  state.launched = 0;
  state.boardFadeT = performance.now();
  state.demoAt = performance.now() + 900;
  const types = allowedTypes(m);
  if (!types.includes(ballType())) state.typeIdx = BALL_TYPES.indexOf(types[0]);
  layout();
  updateTypeUI();
  updateHUD();
  updateLobby();
  try { localStorage.setItem('slingo.machine', m.id); } catch (e) { /* private mode */ }
}
function canAfford(m) { return state.balance + 1e-9 >= buyIn(m); }
// Tap anywhere on the lobby: the overlay lifts off and the machine is live.
function enterMachine() {
  const m = state.machine;
  if (!canAfford(m)) { toast(`${m.name} needs a ${fmtMoney(buyIn(m))} buy-in — tap ${$topup.textContent}`); sfx.miss(); return false; }
  state.balls = state.balls.filter((b) => !b.demo);
  state.screen = 'play';
  document.body.classList.add('playing');
  $lobby.classList.add('leaving');
  setTimeout(() => { if (state.screen === 'play') $lobby.hidden = true; }, 480);
  updateHUD();
  sfx.flip();
  return true;
}
function toLobby(idx = state.machineIdx) {
  if (!fieldEmpty()) return;
  state.screen = 'lobby';
  document.body.classList.remove('playing');
  if (idx !== state.machineIdx) showMachine(idx); else { state.balls = []; state.seated = null; state.demoAt = performance.now() + 600; updateLobby(); }
  $lobby.hidden = false;
  $lobby.classList.remove('leaving');
  $lobby.classList.add('entering');
  requestAnimationFrame(() => requestAnimationFrame(() => $lobby.classList.remove('entering')));
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
  $typeName.textContent = `${t.name} · ${fmtMoney(t.bet).replace('.00', '')}`;
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
$machines.addEventListener('click', () => { if (!fieldEmpty()) return; initAudio(); openStrip(); });

// ---------------------------------------------------------------------------
// Lobby overlay + machine strip
// ---------------------------------------------------------------------------
const $lobby = document.getElementById('lobby');
const $lobbyName = document.getElementById('lobbyName');
const $lobbySub = document.getElementById('lobbySub');
const $lobbyIndex = document.getElementById('lobbyIndex');
const $lobbyStars = document.getElementById('lobbyStars');
const $lobbyProfile = document.getElementById('lobbyProfile');
const $lobbyStakes = document.getElementById('lobbyStakes');
const $lobbyBuyin = document.getElementById('lobbyBuyin');
const $lobbySig = document.getElementById('lobbySig');
const $lobbyCta = document.getElementById('lobbyCta');
const $strip = document.getElementById('strip');
const $stripRow = document.getElementById('stripRow');
const money = (v) => fmtMoney(v).replace('.00', '');

function updateLobby() {
  const m = state.machine; if (!m) return;
  const prof = machineProfile(m), locked = !canAfford(m);
  $lobbyIndex.textContent = `${state.machineIdx + 1} / ${MACHINES.length}`;
  $lobbyName.textContent = m.name;
  $lobbySub.textContent = m.sub;
  $lobbyStars.textContent = '★'.repeat(m.stars) + '☆'.repeat(5 - m.stars);
  $lobbyProfile.textContent = `${prof.name} · ${prof.tag.toUpperCase()}`;
  $lobbyStakes.textContent = `${money(m.stakes[0])}–${money(m.stakes[1])} BALLS`;
  $lobbyBuyin.textContent = `BUY-IN ${money(buyIn(m))}`;
  $lobbyBuyin.classList.toggle('locked', locked);
  $lobbySig.textContent = m.signature;
  $lobbyCta.textContent = locked ? `NEEDS ${money(buyIn(m))} · TAP +${money(TOPUP_AMOUNT)} TO TOP UP` : 'TAP ANYWHERE TO PLAY';
  $lobbyCta.classList.toggle('locked', locked);
}
const step = (d) => { initAudio(); sfx.led(); showMachine((state.machineIdx + d + MACHINES.length) % MACHINES.length); };
document.getElementById('prev').addEventListener('click', (e) => { e.stopPropagation(); step(-1); });
document.getElementById('next').addEventListener('click', (e) => { e.stopPropagation(); step(1); });
document.getElementById('lobbyMachines').addEventListener('click', (e) => { e.stopPropagation(); initAudio(); openStrip(); });
$lobby.addEventListener('click', (e) => { if (e.target.closest('button')) return; initAudio(); enterMachine(); });
window.addEventListener('keydown', (e) => {
  if (state.screen !== 'lobby' || !$strip.hidden) return;
  if (e.key === 'ArrowLeft') step(-1); else if (e.key === 'ArrowRight') step(1); else if (e.key === 'Enter' || e.key === ' ') enterMachine();
});

const thumbs = new Map();
function thumbFor(m) {
  if (!thumbs.has(m.id)) thumbs.set(m.id, renderThumb(buildMachine(m), 354, 450, realize)); // rendered large, shown small
  return thumbs.get(m.id);
}
function openStrip() {
  $stripRow.innerHTML = '';
  MACHINES.forEach((m, i) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'card' + (i === state.machineIdx ? ' selected' : '') + (canAfford(m) ? '' : ' locked');
    card.innerHTML = `<img alt="" src="${thumbFor(m)}"><div class="card-body"><div class="card-name">${m.name}</div><div class="card-meta"><span class="s">${'★'.repeat(m.stars)}</span><span>${money(m.stakes[0])}–${money(m.stakes[1])}</span></div></div>`;
    card.addEventListener('click', () => { closeStrip(); sfx.led(); if (state.screen === 'play') toLobby(i); else showMachine(i); });
    $stripRow.appendChild(card);
  });
  $strip.hidden = false;
  const sel = $stripRow.children[state.machineIdx];
  if (sel) sel.scrollIntoView({ inline: 'center', block: 'nearest' });
}
function closeStrip() { $strip.hidden = true; }
document.getElementById('stripClose').addEventListener('click', closeStrip);
$strip.querySelector('.strip-backdrop').addEventListener('click', closeStrip);

// ---------------------------------------------------------------------------
// Input: machine cards on the select screen; the plunger strip in play
// ---------------------------------------------------------------------------
canvas.addEventListener('pointerdown', (e) => {
  initAudio();
  if (state.screen !== 'play' || state.drag) return;
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
  const d = state.drag;
  if (!d || e.pointerId !== d.id) return;
  state.drag = null;
  if (d.pull > 0.06) launch(d.pull);
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', (e) => { if (state.drag && e.pointerId === state.drag.id) state.drag = null; });

const pull = () => (state.drag ? state.drag.pull : 0);
const minClearPull = () => PHYS.launch.threshold;

// ---------------------------------------------------------------------------
// Launch planning: the outcome is drawn when the ball is created; the
// planner's candidates (power, seed → fixed hits) let us fire the ball on the
// path nearest the player's pull whose hits add up to that prize.
// ---------------------------------------------------------------------------
let planner = null;
let planSeq = 0;
try { planner = new Worker('js/planner.js', { type: 'module' }); } catch (e) { planner = null; }
const planKey = () => `${state.machine.id}:${Math.round(fieldRect.x)},${Math.round(fieldRect.y)},${Math.round(fieldRect.w)},${Math.round(fieldRect.h)}`;
function requestPlan() {
  if (!planner || !state.machine) return;
  const key = planKey();
  if (state.plan && state.plan.key === key) return;
  state.plan = { key, id: ++planSeq, cands: [], done: false };
  planner.postMessage({ type: 'plan', id: planSeq, machineId: state.machine.id, rect: { x0: fieldRect.x, y0: fieldRect.y, w: fieldRect.w, h: fieldRect.h } });
}
if (planner) planner.onmessage = (e) => {
  const msg = e.data;
  if (!state.plan || msg.id !== state.plan.id) return;
  state.plan.cands.push(...msg.cands);
  state.plan.done = msg.done;
};
// Pick the candidate nearest the pull whose hits reach the prize with the
// smallest exit bonus, widening the power window before loosening the bonus.
function choosePath(ball, pullP) {
  const cands = state.plan && state.plan.key === planKey() ? state.plan.cands : [];
  if (!cands.length) return null;
  const scored = cands.map((c) => ({ c, d: Math.abs(c.p - pullP), M: ball.target / totalAfter(ball.stake, ball.target, c.hits) }));
  for (const win of POWER_WINDOWS) {
    for (const band of EXIT_BANDS) {
      let pick = null;
      for (const s of scored) if (s.c.settled && s.d <= win && s.M <= band && (!pick || s.d < pick.d)) pick = s;
      if (pick) return pick.c;
    }
  }
  let pick = null;
  for (const s of scored) if (!pick || s.M < pick.M) pick = s; // least the exit has to lift
  return pick ? pick.c : null;
}

function launch(p, demo = false) {
  let ball = state.seated;
  if (demo) { ball = newBall(world, (Math.random() * 1e9) >>> 0, { demo: true, type: BALL_TYPES[0], stake: 1, target: 0.2, total: 0.1, mult: 0.2 }); state.balls.push(ball); }
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
  // A launch into an empty field starts from the clean fixtures every plan assumes.
  if (state.balls.every((b) => b === ball || b.dying)) { resetFixtures(world); world.moverT0 = world.time; }
  let fireP = p, seed = ball.seed;
  if (!demo && p >= PHYS.launch.threshold) {
    const c = choosePath(ball, p);
    if (c) { fireP = c.p; seed = c.seed; ball.planned = true; ball.plan = c.hits; ball.log = []; }
  }
  ball.seed = seed; ball.rng = makeRng(seed);
  ball.power = fireP;
  fire(world, ball, fireP);
  sfx.fire(p);
  shake(0.2 + 0.7 * p);
  state.effects.push({ type: 'puff', x: ball.x, y: ball.y, t0: state.now, dur: 350 });
  updateHUD();
}

function makeBall(type, mult) {
  const target = round2(mult * type.bet);
  return newBall(world, (Math.random() * 1e9) >>> 0, { type, stake: type.bet, mult, target, total: round2(LAUNCH_CREDIT * type.bet) });
}

function shake(mag) {
  state.shake.mag = Math.max(state.shake.mag, 3 + 8 * mag);
  state.shake.t = state.now;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------
// Engine hooks: scoring, presentation and sound live here, not in the engine.
const hooks = {
  hit(ball, comp, sign, tier, x, y) {
    if (ball.demo) return; // attract mode: lights only
    if (ball.log) ball.log.push(sign * hitFraction(comp, tier, sign));
    const a = applyHit(ball, sign, hitFraction(comp, tier, sign));
    if (a === 0) {
      // A + hit at the ceiling: the ball has already reached its prize.
      if (sign > 0) { ball.maxT = state.now; state.effects.push({ type: 'float', x, y, text: 'MAX', color: AMBER, t0: state.now, dur: 800, size: 12 }); sfx.led(); }
      else sfx.miss();
      return;
    }
    if (world.time - ball.born > 10000) state.lateAwards++;
    ball.total = round2(ball.total + a);
    ball.popT = state.now;
    (a > 0 ? sfx.fill : sfx.lose)();
    state.effects.push({
      type: 'float', x, y, text: (a > 0 ? '+' : '−') + fmtMoney(Math.abs(a)).slice(1),
      color: a > 0 ? '#7dffb9' : '#ff8d8d', t0: state.now, dur: 1000, size: 13 + 2 * Math.min(3, tier),
    });
  },
  settle(ball, x, y, where) { settle(ball, x, y, where); },
  charge(ball) { state.balance -= ball.stake; state.launched++; updateHUD(); },
  seat(ball) {
    if (state.seated) return false;
    state.seated = ball; updateHUD(); sfx.hit();
    return true;
  },
  fx(o) { state.effects.push({ ...o, t0: state.now }); },
  sfx(name, arg) { if (sfx[name]) sfx[name](arg); },
  shake(mag) { shake(mag); },
};

function settle(ball, x, y, where) {
  if (!ball.charged || ball.demo) { // never reached the field / attract ball: no bet, no prize
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
  state.settled.push({ machine: state.machine.id, target: ball.target, paid, mult: M, total: ball.total, hits: ball.hits, life: Math.round(world.time - ball.born), planned: !!ball.planned, power: ball.power, onPlan: ball.plan ? JSON.stringify(ball.log) === JSON.stringify(ball.plan) : null });
  // The exit's bonus: "$6.50 × 2" for a real lift, "+$0.40" for a nudge,
  // "MAX" when the ball had already reached its prize. Never a cut.
  if (ball.hits > 0) {
    const gap = round2(paid - ball.total);
    const text = gap < 0.005 ? `${fmtMoney(ball.total)} MAX` : M >= 1.2 ? `${fmtMoney(ball.total)} × ${M >= 10 ? M.toFixed(0) : M.toFixed(2)}` : `${fmtMoney(ball.total)} + ${fmtMoney(gap)}`;
    state.effects.push({ type: 'mystery', x, y: y + 26, t0: state.now, dur: 1500, text, color: AMBER });
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
// Update
// ---------------------------------------------------------------------------
function update() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - state.last) / 1000);
  state.last = now;
  state.now = now;
  for (let i = pending.length - 1; i >= 0; i--) if (now >= pending[i].at) pending.splice(i, 1)[0].fn();
  if (!board) return;
  // Attract mode: while the lobby overlay is up, free demo balls show the
  // machine in action (no bet, no prize).
  if (state.screen === 'lobby' && now >= state.demoAt && state.balls.length < 2) {
    launch(0.55 + Math.random() * 0.45, true);
    state.demoAt = now + 3000 + Math.random() * 2500;
  }
  const hadBalls = state.balls.length;
  // Fixed-step physics: identical steps to the planner's, so a planned ball
  // follows its planned path. The world clock is kept within a step of the
  // wall clock (and resynced after a hidden tab) so flashes line up.
  state.acc = Math.min(state.acc + dt, 0.1);
  while (state.acc >= SUBSTEP) { stepWorld(world, state.balls, hooks); state.acc -= SUBSTEP; }
  if (world.time < now - 150 && !state.balls.some((b) => !b.dying && !b.seated)) world.time = now; // resync only with nothing in play
  state.balls = state.balls.filter((b) => !b.dying || now - b.dying.t0 < 360);
  if (state.balls.length !== hadBalls) updateHUD();
  state.effects = state.effects.filter((fx) => now - fx.t0 < fx.dur);
}

// ---------------------------------------------------------------------------
// Frame rendering
// ---------------------------------------------------------------------------
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const flash = (comp, dur = 350) => (comp.flashT ? Math.max(0, 1 - (world.time - comp.flashT) / dur) : 0);

function render() {
  const now = state.now;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
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
    const f = k.ejectT ? Math.max(0, 1 - (world.time - k.ejectT) / 500) : 0; if (!f) continue;
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
    f.angle = flipperAngle(world, f);
    const seg = flipperSegment(f), active = world.time - f.flipT < 380;
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
    if (b.held) { const t = Math.min(1, (world.time - (b.held.until - 700)) / 250); r = b.r * Math.max(0, 1 - t); if (r < 0.5) continue; }
    if (b.seated) y += pull() * 10;
    drawBallSprite(ctx, x, y, r, b.type);
    if (!b.dying && !b.held && !b.demo) {
      const atMax = b.total >= b.target - 1e-9;
      const col = atMax ? AMBER : '#7dffb9';
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
let startIdx = 0;
try { const saved = localStorage.getItem('slingo.machine'); const i = MACHINES.findIndex((m) => m.id === saved); if (i >= 0) startIdx = i; } catch (e) { /* private mode */ }
showMachine(startIdx);
window.addEventListener('resize', layout);
requestAnimationFrame(frame);

// expose for tests
state.showMachine = showMachine;
state.enterMachine = enterMachine;
state.toLobby = toLobby;
