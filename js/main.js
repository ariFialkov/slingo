// Slingo — main game: board, slingshot, projectile, streak bonuses, rendering.
import {
  TYPES, BONUS, GRID, START_BALANCE, TOPUP_AMOUNT, RESPAWN_DELAY_MS,
  RISK_MAX_MULT, ROULETTE_MULT, stepperStepProb, fmtMoney, TILE_RTP,
} from './config.js';
import {
  makeTile, hitTile, riskPosition, instantOutcome, rouletteCubeRect,
  tileCostLabel,
} from './tiles.js';
import { initAudio, sfx, toggleMute, isMuted } from './audio.js';

// ---------------------------------------------------------------------------
// Canvas / layout
// ---------------------------------------------------------------------------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let W = 0, H = 0, DPR = 1;

const board = { top: 0, bottom: 0, cx: 0, wTop: 0, wBottom: 0 };
const sling = { ax: 0, ay: 0, maxPull: 0 };

function layout() {
  W = window.innerWidth;
  H = window.innerHeight;
  DPR = Math.min(window.devicePixelRatio || 1, 2.5);
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';

  // Board fills the screen in at least one dimension, leaving a small strip
  // at the bottom for the slingshot.
  const availTop = H * 0.075;
  const availH = H * 0.8 - availTop;
  const bw = Math.min(W * 0.97, availH * 1.05);
  const bh = Math.min(availH, bw * 1.25); // cap tile stretch
  board.top = availTop + (availH - bh) / 2; // centre in the available area
  board.bottom = board.top + bh;
  board.cx = W / 2;
  board.wBottom = bw;
  board.wTop = bw * 0.87;

  sling.ax = W / 2;
  sling.ay = H * 0.895;
  sling.maxPull = Math.min(Math.min(W, H) * 0.22, (H - sling.ay) * 1.8);
}
window.addEventListener('resize', layout);
layout();

// Board mapping: (u,v) ∈ [0,GRID]² → screen, v=0 is the far (top) row.
function rowY(v) { return board.top + (board.bottom - board.top) * (v / GRID); }
function rowW(v) { return board.wTop + (board.wBottom - board.wTop) * (v / GRID); }
function boardPt(u, v) { return { x: board.cx + (u / GRID - 0.5) * rowW(v), y: rowY(v) }; }
function screenToBoard(x, y) {
  const v = ((y - board.top) / (board.bottom - board.top)) * GRID;
  if (v < 0 || v >= GRID) return null;
  const u = ((x - board.cx) / rowW(v) + 0.5) * GRID;
  if (u < 0 || u >= GRID) return null;
  return { u, v };
}
function tileRect(r, c) {
  const p = boardPt(c + 0.5, r + 0.5);
  const w = (rowW(r + 0.5) / GRID) * 0.95;
  const h = (rowY(r + 1) - rowY(r)) * 0.94;
  return { cx: p.x, cy: p.y, w, h };
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
const state = {
  balance: START_BALANCE,
  lastWin: 0,
  cells: [],
  litCells: new Set(),
  streak: { cells: [], dir: null },
  projectile: null,
  loaded: true,
  reloadAt: 0,
  drag: null, // {id, px, py, buzzed}
  shake: { mag: 0, t: 0 },
  effects: [],
  pending: [], // [{at, fn}] scheduled actions
  now: performance.now(),
};

for (let r = 0; r < GRID; r++) {
  for (let c = 0; c < GRID; c++) {
    state.cells.push({
      r, c,
      tile: makeTile(),
      face: 'front',
      flip: null,       // {start, dur, halfTurns, fromFace, toFace}
      result: null,     // {label, prize, win}
      respawnAt: 0,
    });
  }
}
const cellAt = (r, c) => state.cells[r * GRID + c];
const cellKey = (cell) => cell.r + ',' + cell.c;

function schedule(delay, fn) { state.pending.push({ at: state.now + delay, fn }); }

function startFlip(cell, toFace, halfTurns, dur) {
  cell.flip = { start: state.now, dur, halfTurns, fromFace: cell.face, toFace };
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
const $balance = document.getElementById('balance');
const $lastwin = document.getElementById('lastwin');
const $toast = document.getElementById('toast');
let toastTimer = 0;

function updateHUD() {
  $balance.textContent = fmtMoney(state.balance);
  $lastwin.textContent = state.lastWin > 0 ? 'WIN ' + fmtMoney(state.lastWin) : '';
}
function toast(msg) {
  $toast.textContent = msg;
  $toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.remove('show'), 1800);
}
document.getElementById('topup').addEventListener('click', () => {
  state.balance += TOPUP_AMOUNT;
  toast(`+${fmtMoney(TOPUP_AMOUNT)} added`);
  updateHUD();
});
const $mute = document.getElementById('mute');
$mute.addEventListener('click', () => { $mute.textContent = toggleMute() ? '🔇' : '🔊'; });
updateHUD();

// ---------------------------------------------------------------------------
// Streak / pattern bonuses
// ---------------------------------------------------------------------------
function clearStreak(keep) {
  state.streak.cells = keep ? [keep] : [];
  state.streak.dir = null;
  state.litCells.clear();
  if (keep) state.litCells.add(cellKey(keep));
}

function streakOnWin(cell, prize) {
  const s = state.streak;
  const last = s.cells[s.cells.length - 1];
  if (!last) {
    s.cells = [cell];
    state.litCells.add(cellKey(cell));
  } else {
    const dr = cell.r - last.r, dc = cell.c - last.c;
    const adjacent = Math.abs(dr) <= 1 && Math.abs(dc) <= 1 && !(dr === 0 && dc === 0);
    if (s.cells.length === 1 && adjacent) {
      s.dir = [dr, dc];
      s.cells.push(cell);
      state.litCells.add(cellKey(cell));
    } else if (s.cells.length > 1 && adjacent && dr === s.dir[0] && dc === s.dir[1]) {
      s.cells.push(cell);
      state.litCells.add(cellKey(cell));
    } else {
      clearStreak(cell); // pattern disrupted → only the newest winner stays lit
      return;
    }
  }
  const len = s.cells.length;
  const diag = s.dir && s.dir[0] !== 0 && s.dir[1] !== 0;
  if (len === GRID) {
    awardBonus(diag ? BONUS.diag3 : BONUS.line3, prize);
    clearStreak(null);
  }
}

function awardBonus(bonus, lastPrize) {
  const extra = (bonus.mult - 1) * lastPrize;
  state.balance += extra;
  state.lastWin = extra;
  sfx.bonus();
  state.effects.push({
    type: 'banner', t0: state.now, dur: 2600,
    text: `${bonus.label} BONUS ×${bonus.mult}`,
    sub: `+${fmtMoney(extra)}`,
  });
  shake(0.8);
  updateHUD();
}

// ---------------------------------------------------------------------------
// Betting / settlement
// ---------------------------------------------------------------------------
function settle(cell, res) {
  const win = res.prize > 0;
  cell.result = { label: res.label, prize: res.prize, win };
  startFlip(cell, 'back', 3, 900);
  cell.respawnAt = state.now + 900 + RESPAWN_DELAY_MS;
  sfx.flip();
  const { cx, cy } = tileRect(cell.r, cell.c);
  if (win) {
    state.balance += res.prize;
    state.lastWin = res.prize;
    const big = res.prize >= 20 || (res.cost > 0 && res.prize / res.cost >= 10);
    schedule(430, () => (big ? sfx.bigwin() : sfx.win()));
    state.effects.push({ type: 'float', x: cx, y: cy, text: '+' + fmtMoney(res.prize), color: '#7dffb9', t0: state.now, dur: 1400 });
    if (big) state.effects.push({ type: 'burst', x: cx, y: cy, t0: state.now, dur: 900 });
    streakOnWin(cell, res.prize);
  } else {
    schedule(430, () => sfx.lose());
    state.effects.push({ type: 'float', x: cx, y: cy, text: '×0', color: '#ff8d8d', t0: state.now, dur: 1000 });
    clearStreak(null); // a losing hit breaks any pattern
  }
  updateHUD();
}

function charge(cost) {
  if (cost > state.balance + 1e-9) {
    toast('Not enough balance — tap +$100');
    return false;
  }
  state.balance -= cost;
  updateHUD();
  return true;
}

function handleHit(cell, fx, fy) {
  const tile = cell.tile;
  const res = hitTile(tile, fx, fy, state.now);
  switch (res.kind) {
    case 'none':
      sfx.miss();
      return;
    case 'interact':
      if (res.startCost !== undefined) { // stepper game start
        if (!charge(res.startCost)) { tile.active = false; tile.value = 0; return; }
      }
      sfx[res.sound] ? sfx[res.sound]() : sfx.led();
      return;
    case 'bet':
      if (!res.prePaid && !charge(res.cost)) return;
      settle(cell, res);
      return;
    case 'roulette-place': {
      if (!charge(res.cost)) return;
      tile.reveal = { winner: res.winner, win: res.win };
      sfx.led();
      schedule(1100, () => {
        tile.reveal = null;
        tile.selected.clear();
        settle(cell, {
          cost: res.cost, prize: res.prize,
          label: res.win ? `HIT ×${ROULETTE_MULT.toFixed(2)}` : 'WRONG BOX',
        });
      });
      return;
    }
    case 'randomizer':
      if (!charge(res.cost)) return;
      resolveRandomizer(cell, res);
      return;
  }
}

function resolveRandomizer(cell, res) {
  const candidates = state.cells.filter((other) =>
    other !== cell && other.face === 'front' && !other.flip && !other.respawnAt &&
    !tileBusy(other.tile));
  shuffle(candidates);
  const chosen = candidates.slice(0, res.count);
  sfx.flip();
  let total = 0;
  if (chosen.length === 0) {
    total = instantOutcome({ type: 'standard' }, res.cost, state.now);
  } else {
    const stake = res.cost / chosen.length;
    chosen.forEach((other, i) => {
      const prize = instantOutcome(other.tile, stake, state.now);
      total += prize;
      schedule(250 + i * 220, () => {
        other.result = { label: prize > 0 ? '+' + fmtMoney(prize) : '×0', prize, win: prize > 0 };
        startFlip(other, 'back', 3, 800);
        other.respawnAt = state.now + 800 + RESPAWN_DELAY_MS;
        sfx.flip();
      });
    });
  }
  const totalPrize = total;
  schedule(300 + chosen.length * 220, () => {
    settle(cell, { cost: res.cost, prize: totalPrize, label: `${chosen.length || 1} TILES` });
  });
}

function tileBusy(tile) {
  return (tile.type === 'fill' && tile.fill > 0) ||
    (tile.type === 'roulette' && (tile.selected.size > 0 || tile.reveal)) ||
    (tile.type === 'stepper' && tile.active);
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// ---------------------------------------------------------------------------
// Slingshot input (pointer events → works for touch and mouse alike)
// ---------------------------------------------------------------------------
canvas.addEventListener('pointerdown', (e) => {
  initAudio();
  if (state.drag || !state.loaded) return;
  if (e.clientY < board.bottom + 8) return; // must grab below the board
  canvas.setPointerCapture(e.pointerId);
  state.drag = { id: e.pointerId, px: e.clientX, py: e.clientY, buzzed: false };
  e.preventDefault();
});
canvas.addEventListener('pointermove', (e) => {
  const d = state.drag;
  if (!d || e.pointerId !== d.id) return;
  d.px = e.clientX;
  d.py = e.clientY;
  if (pullPower() >= 0.98 && !d.buzzed) {
    d.buzzed = true;
    if (navigator.vibrate) navigator.vibrate(18); // max-strength buzz
  } else if (pullPower() < 0.9) {
    d.buzzed = false;
  }
  e.preventDefault();
});
function endDrag(e) {
  const d = state.drag;
  if (!d || e.pointerId !== d.id) return;
  const power = pullPower();
  const from = pouchPos();
  const to = aimTarget();
  state.drag = null;
  if (power > 0.1 && state.loaded) fire(from, to, power);
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
  const gain = (sling.ay - (board.top - H * 0.02)) / sling.maxPull;
  return { x: sling.ax + (sling.ax - p.x) * gain, y: sling.ay + (sling.ay - p.y) * gain };
}

function fire(from, to, power) {
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  state.projectile = {
    x0: from.x, y0: from.y, x1: to.x, y1: to.y,
    cx: (from.x + to.x) / 2, cy: Math.min(from.y, to.y) - (H * 0.05 + H * 0.07 * power),
    t: 0, dur: 340 + 200 * Math.min(1, dist / (H * 0.8)), power,
  };
  state.loaded = false;
  sfx.fire(power);
  shake(0.25 + 0.75 * power); // camera kick scales with shot strength
}

function shake(mag) {
  state.shake.mag = Math.max(state.shake.mag, 3 + 8 * mag);
  state.shake.t = state.now;
}

function impact(x, y, power) {
  sfx.hit();
  shake(0.15 * power);
  state.reloadAt = state.now + 240;
  const hit = screenToBoard(x, y);
  if (!hit) {
    state.effects.push({ type: 'puff', x, y, t0: state.now, dur: 500 });
    sfx.miss();
    return;
  }
  const r = Math.floor(hit.v), c = Math.floor(hit.u);
  const cell = cellAt(r, c);
  state.effects.push({ type: 'puff', x, y, t0: state.now, dur: 400 });
  if (cell.flip || cell.face === 'back') return; // spinning / resolved → dud
  handleHit(cell, hit.u - c, hit.v - r);
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------
function update() {
  const now = performance.now();
  state.now = now;

  // scheduled actions
  for (let i = state.pending.length - 1; i >= 0; i--) {
    if (now >= state.pending[i].at) {
      const { fn } = state.pending.splice(i, 1)[0];
      fn();
    }
  }

  // projectile flight (quadratic bezier with mid-air arc)
  const p = state.projectile;
  if (p) {
    p.t += (now - (p.last || now - 16)) / p.dur;
    p.last = now;
    if (p.t >= 1) {
      state.projectile = null;
      impact(p.x1, p.y1, p.power);
    }
  }
  if (!state.loaded && !state.projectile && now >= state.reloadAt) state.loaded = true;

  // flips
  for (const cell of state.cells) {
    if (cell.flip && now - cell.flip.start >= cell.flip.dur) {
      cell.face = cell.flip.toFace;
      cell.flip = null;
    }
    if (cell.respawnAt && now >= cell.respawnAt && !cell.flip) {
      cell.tile = makeTile();
      cell.result = null;
      cell.respawnAt = 0;
      startFlip(cell, 'front', 1, 500);
    }
  }

  // effects cleanup
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

function render() {
  const now = state.now;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  // camera shake
  const sAge = now - state.shake.t;
  if (state.shake.mag > 0 && sAge < 320) {
    const decay = 1 - sAge / 320;
    const m = state.shake.mag * decay;
    ctx.translate((Math.random() * 2 - 1) * m, (Math.random() * 2 - 1) * m);
  } else {
    state.shake.mag = 0;
  }

  // background
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0d1026');
  bg.addColorStop(0.55, '#131735');
  bg.addColorStop(1, '#0a0c1c');
  ctx.fillStyle = bg;
  ctx.fillRect(-20, -20, W + 40, H + 40);

  drawBoardPanel();
  for (const cell of state.cells) drawCell(cell, now);
  drawLitPerimeters(now);
  drawSlingshot(now);
  drawProjectile();
  drawEffects(now);
}

function drawBoardPanel() {
  // jumbo-board backing (trapezoid for the 2.5D look)
  const m = 14;
  const tl = boardPt(0, 0), tr = boardPt(GRID, 0), bl = boardPt(0, GRID), br = boardPt(GRID, GRID);
  ctx.beginPath();
  ctx.moveTo(tl.x - m, tl.y - m);
  ctx.lineTo(tr.x + m, tr.y - m);
  ctx.lineTo(br.x + m * 1.4, br.y + m);
  ctx.lineTo(bl.x - m * 1.4, bl.y + m);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, tl.y, 0, br.y);
  g.addColorStop(0, '#1b2044');
  g.addColorStop(1, '#232a58');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = 'rgba(120,140,255,0.35)';
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawCell(cell, now) {
  const { cx, cy, w, h } = tileRect(cell.r, cell.c);
  let face = cell.face;
  let k = 1;
  if (cell.flip) {
    const t = Math.min(1, (now - cell.flip.start) / cell.flip.dur);
    const angle = easeOutCubic(t) * cell.flip.halfTurns * Math.PI;
    k = Math.max(0.04, Math.abs(Math.cos(angle)));
    const half = Math.floor((angle + Math.PI / 2) / Math.PI);
    const flipped = half % 2 === 1;
    face = flipped
      ? (cell.flip.fromFace === 'front' ? 'back' : 'front')
      : cell.flip.fromFace;
  }
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale((w / 100) * k, h / 100);
  if (face === 'back' || cell.result || cell.tile) {
    if (face === 'front') drawTileFront(cell.tile, now);
    else drawTileBack(cell);
  }
  ctx.restore();
}

// Tile faces are drawn in a 100×100 unit space centred on the origin.
function tileBase(color, borderColor) {
  rr(-50, -50, 100, 100, 10);
  const g = ctx.createLinearGradient(0, -50, 0, 50);
  g.addColorStop(0, shade(color, 1.25));
  g.addColorStop(1, shade(color, 0.75));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = borderColor || 'rgba(255,255,255,0.28)';
  ctx.lineWidth = 2.5;
  ctx.stroke();
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

function text(str, x, y, size, color, { bold = true, align = 'center', glow = 0 } = {}) {
  ctx.font = `${bold ? '700' : '500'} ${size}px system-ui, -apple-system, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  if (glow) { ctx.shadowColor = color; ctx.shadowBlur = glow; }
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
  ctx.shadowBlur = 0;
}

function drawTileFront(tile, now) {
  const def = tile.def || TYPES[tile.type];
  tileBase(def.color);

  // question-mark watermark
  text('?', 0, 6, 64, 'rgba(255,255,255,0.10)');

  // type name
  text(def.name, 0, -40, tile.type === 'double' ? 8 : 9.5, 'rgba(255,255,255,0.85)');

  // glowing cost (pulses)
  const pulse = 6 + 4 * Math.sin(now / 300);
  const costLabel = tileCostLabel(tile);

  switch (tile.type) {
    case 'standard':
      text(costLabel, 0, 8, 26, def.accent, { glow: pulse });
      break;
    case 'safe':
      text(costLabel, 0, 4, 26, def.accent, { glow: pulse });
      text('HIGH HIT RATE', 0, 32, 8, 'rgba(255,255,255,0.6)');
      break;
    case 'wild':
      text(costLabel, 0, 4, 26, def.accent, { glow: pulse });
      text('UP TO ×100', 0, 32, 8, 'rgba(255,255,255,0.6)');
      break;
    case 'jackpot':
      text(costLabel, 0, 2, 24, def.accent, { glow: pulse });
      text('★ ×500 ★', 0, 30, 11, '#ffd94d', { glow: 4 });
      break;
    case 'double':
      text(costLabel, 0, 2, 24, def.accent, { glow: pulse });
      text('×2 OR ×0', 0, 30, 11, 'rgba(255,255,255,0.75)');
      break;
    case 'hilo': {
      const v = tile.variant;
      text(costLabel, 0, -16, 20, def.accent, { glow: pulse });
      text(`▲ ×${v.high}  ${(v.pHigh * 100) | 0}%`, 0, 12, 11, '#9dffb0');
      text(`▼ ×${v.low}  ${(v.pLow * 100) | 0}%`, 0, 30, 11, '#ffb3a0');
      break;
    }
    case 'fill':
      drawFillFront(tile, def, pulse);
      break;
    case 'risk':
      drawRiskFront(tile, def, now, pulse);
      break;
    case 'randomizer':
      text(String(tile.count), 0, 2, 40, def.accent, { glow: pulse });
      text('RANDOM TILES', 0, 32, 8.5, 'rgba(255,255,255,0.7)');
      text(costLabel, 0, -22, 12, '#fff', { glow: 3 });
      break;
    case 'roulette':
      drawRouletteFront(tile, def, pulse);
      break;
    case 'stepper':
      drawStepperFront(tile, def, pulse);
      break;
  }
}

function drawFillFront(tile, def, pulse) {
  // electronic counter
  rr(-26, -26, 52, 18, 3);
  ctx.fillStyle = '#0a0a12';
  ctx.fill();
  text(fmtMoney(tile.fill), 0, -17, 12, '#7dff8a', { glow: 3 });
  // doggy-door slot (lower middle)
  rr(-18, 9, 36, 36, 4);
  ctx.fillStyle = '#140b05';
  ctx.fill();
  ctx.strokeStyle = def.accent;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,192,125,0.5)';
  ctx.beginPath();
  ctx.moveTo(-18, 17); ctx.lineTo(18, 17);
  ctx.stroke();
  text('FEED', 0, 30, 9, def.accent, { glow: pulse * 0.5 });
  text(`+${fmtMoney(tile.increment)}/shot`, 0, 0, 9, '#fff');
}

function drawRiskFront(tile, def, now, pulse) {
  const r = riskPosition(tile, now);
  const mult = 1 + (RISK_MAX_MULT - 1) * r;
  text(fmtMoney(tile.cost), 0, -24, 16, def.accent, { glow: pulse });
  // slider track
  rr(-38, 2, 76, 10, 5);
  const g = ctx.createLinearGradient(-38, 0, 38, 0);
  g.addColorStop(0, '#2f9e57');
  g.addColorStop(0.55, '#e0b13a');
  g.addColorStop(1, '#d0344a');
  ctx.fillStyle = g;
  ctx.fill();
  // marker
  const mx = -38 + 76 * r;
  rr(mx - 3, -2, 6, 18, 3);
  ctx.fillStyle = '#fff';
  ctx.shadowColor = '#fff';
  ctx.shadowBlur = 6;
  ctx.fill();
  ctx.shadowBlur = 0;
  text(`${(r * 100) | 0}%  ×${mult.toFixed(1)}`, 0, 28, 11, '#fff');
  text(`win ${(TILE_RTP / mult * 100).toFixed(mult > 10 ? 1 : 0)}%`, 0, 40, 7.5, 'rgba(255,255,255,0.65)');
}

function drawRouletteFront(tile, def, pulse) {
  text(tileCostLabel(tile), 0, -29, 11, def.accent, { glow: pulse });
  for (let i = 0; i < 9; i++) {
    const rect = rouletteCubeRect(i);
    const x = rect.x * 100 - 50, y = rect.y * 100 - 50, w = rect.w * 100, h = rect.h * 100;
    const sel = tile.selected.has(i);
    let fill = sel ? '#e8c33a' : '#2a1020';
    let glow = sel ? 8 : 0;
    if (tile.reveal && tile.reveal.winner === i) {
      fill = tile.reveal.win ? '#39d97a' : '#e0455a';
      glow = 12;
    }
    rr(x, y, w, h, 3);
    if (glow) { ctx.shadowColor = fill; ctx.shadowBlur = glow; }
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  text(`win ×${ROULETTE_MULT.toFixed(2)}`, 0, 44, 7, 'rgba(255,255,255,0.7)');
}

function drawStepperFront(tile, def, pulse) {
  // two electronic counters
  rr(-42, -33, 40, 15, 3); ctx.fillStyle = '#0a0a12'; ctx.fill();
  rr(2, -33, 40, 15, 3); ctx.fillStyle = '#0a0a12'; ctx.fill();
  const left = tile.active ? fmtMoney(tile.value) : fmtMoney(tile.cost);
  const right = tile.active ? `${Math.round(stepperStepProb(tile.step + 1) * 100)}%` : 'COST';
  text(left, -22, -25.5, 9.5, '#7dff8a', { glow: 3 });
  text(right, 22, -25.5, 9.5, tile.active ? '#ffd94d' : '#8a8fa8', { glow: tile.active ? 3 : 0 });
  // buttons
  rr(-32, -14, 64, 26, 6);
  ctx.fillStyle = tile.active ? '#3d9e46' : '#2c2f6e';
  ctx.fill();
  ctx.strokeStyle = def.accent; ctx.lineWidth = 2; ctx.stroke();
  text(tile.active ? 'STEP ▲' : 'START ▲', 0, -1, 11, '#fff', { glow: pulse * 0.4 });
  rr(-32, 16, 64, 26, 6);
  ctx.fillStyle = tile.active ? '#9e6b2c' : '#2c2f6e';
  ctx.fill();
  ctx.strokeStyle = def.accent; ctx.lineWidth = 2; ctx.stroke();
  text(tile.active ? 'CASH ▼' : 'START ▼', 0, 29, 11, '#fff');
  if (tile.active) text(`step ${tile.step}`, 0, 46, 7, 'rgba(255,255,255,0.7)');
}

function drawTileBack(cell) {
  const res = cell.result;
  const win = res && res.win;
  tileBase(win ? '#1d6b3f' : '#3a2030', win ? '#7dffb9' : 'rgba(255,255,255,0.2)');
  if (!res) { text('•', 0, 0, 20, 'rgba(255,255,255,0.4)'); return; }
  if (win) {
    text('WIN', 0, -26, 14, '#c9ffdd');
    text(fmtMoney(res.prize), 0, 2, 24, '#7dffb9', { glow: 8 });
    text(res.label, 0, 30, 11, 'rgba(255,255,255,0.85)');
  } else {
    text(res.label === 'CRASH' ? '💥' : '✕', 0, -18, 26, '#ff8d8d');
    text(res.label, 0, 16, 12, 'rgba(255,255,255,0.85)');
  }
}

function drawLitPerimeters(now) {
  if (!state.litCells.size) return;
  const pulse = 0.55 + 0.45 * Math.sin(now / 200);
  for (const key of state.litCells) {
    const [r, c] = key.split(',').map(Number);
    const { cx, cy, w, h } = tileRect(r, c);
    ctx.save();
    ctx.translate(cx, cy);
    rr(-w / 2 - 3, -h / 2 - 3, w + 6, h + 6, 12);
    ctx.strokeStyle = `rgba(255,214,90,${0.5 + 0.5 * pulse})`;
    ctx.lineWidth = 3.5;
    ctx.shadowColor = '#ffd65a';
    ctx.shadowBlur = 14 * pulse + 6;
    ctx.stroke();
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Slingshot + projectile
// ---------------------------------------------------------------------------
function drawSlingshot(now) {
  const pouch = pouchPos();
  const S = Math.min(W, H);
  const forkY = sling.ay - S * 0.045;
  const forkL = { x: sling.ax - S * 0.07, y: forkY };
  const forkR = { x: sling.ax + S * 0.07, y: forkY };
  const baseY = Math.min(H - 8, sling.ay + S * 0.11);

  // frame
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#7a4d2a';
  ctx.lineWidth = 11;
  ctx.beginPath();
  ctx.moveTo(sling.ax, baseY);
  ctx.lineTo(sling.ax, sling.ay + S * 0.045);
  ctx.stroke();
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(sling.ax, sling.ay + S * 0.045);
  ctx.quadraticCurveTo(forkL.x, sling.ay + S * 0.01, forkL.x, forkY);
  ctx.moveTo(sling.ax, sling.ay + S * 0.045);
  ctx.quadraticCurveTo(forkR.x, sling.ay + S * 0.01, forkR.x, forkY);
  ctx.stroke();

  // elastic bands
  const bandTo = state.loaded ? pouch : { x: sling.ax, y: sling.ay + 6 };
  ctx.strokeStyle = '#d8c08a';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(forkL.x, forkY);
  ctx.lineTo(bandTo.x - 9, bandTo.y);
  ctx.moveTo(forkR.x, forkY);
  ctx.lineTo(bandTo.x + 9, bandTo.y);
  ctx.stroke();

  // pouch + loaded ball
  if (state.loaded) {
    rr(pouch.x - 13, pouch.y - 7, 26, 15, 6);
    ctx.fillStyle = '#4a3320';
    ctx.fill();
    drawBall(pouch.x, pouch.y - 5, 9);
  }

  // aim preview + power meter while dragging
  if (state.drag && state.loaded) {
    const power = pullPower();
    if (power > 0.08) {
      const to = aimTarget();
      const cxp = (pouch.x + to.x) / 2;
      const cyp = Math.min(pouch.y, to.y) - (H * 0.05 + H * 0.07 * power);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      for (let i = 1; i <= 7; i++) {
        const t = i / 8;
        const x = (1 - t) * (1 - t) * pouch.x + 2 * (1 - t) * t * cxp + t * t * to.x;
        const y = (1 - t) * (1 - t) * pouch.y + 2 * (1 - t) * t * cyp + t * t * to.y;
        ctx.beginPath();
        ctx.arc(x, y, 2.6 - t, 0, Math.PI * 2);
        ctx.fill();
      }
      // power arc around pouch
      ctx.beginPath();
      ctx.arc(pouch.x, pouch.y, 22, -Math.PI / 2, -Math.PI / 2 + power * Math.PI * 2);
      ctx.strokeStyle = power >= 0.98 ? '#ff6a6a' : '#ffd65a';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }
}

function drawBall(x, y, radius) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  const g = ctx.createRadialGradient(x - radius / 3, y - radius / 3, radius / 5, x, y, radius);
  g.addColorStop(0, '#ffe9a8');
  g.addColorStop(1, '#c98f2d');
  ctx.fillStyle = g;
  ctx.fill();
}

function drawProjectile() {
  const p = state.projectile;
  if (!p) return;
  const t = Math.min(1, p.t);
  const x = (1 - t) * (1 - t) * p.x0 + 2 * (1 - t) * t * p.cx + t * t * p.x1;
  const y = (1 - t) * (1 - t) * p.y0 + 2 * (1 - t) * t * p.cy + t * t * p.y1;
  const radius = 9 - 3.8 * t; // shrinks as it travels into the board (depth)
  // trail
  ctx.globalAlpha = 0.35;
  for (let i = 1; i <= 3; i++) {
    const tt = Math.max(0, t - i * 0.05);
    const tx = (1 - tt) * (1 - tt) * p.x0 + 2 * (1 - tt) * tt * p.cx + tt * tt * p.x1;
    const ty = (1 - tt) * (1 - tt) * p.y0 + 2 * (1 - tt) * tt * p.cy + tt * tt * p.y1;
    ctx.beginPath();
    ctx.arc(tx, ty, radius * (1 - i * 0.2), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,220,140,0.5)';
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  drawBall(x, y, radius);
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------
function drawEffects(now) {
  for (const fx of state.effects) {
    const t = Math.min(1, (now - fx.t0) / fx.dur);
    if (fx.type === 'float') {
      ctx.globalAlpha = 1 - t * t;
      text(fx.text, fx.x, fx.y - 30 * easeOutCubic(t), 18, fx.color, { glow: 8 });
      ctx.globalAlpha = 1;
    } else if (fx.type === 'puff') {
      ctx.globalAlpha = (1 - t) * 0.5;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, 4 + 18 * easeOutCubic(t), 0, Math.PI * 2);
      ctx.strokeStyle = '#ffe9a8';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else if (fx.type === 'burst') {
      ctx.globalAlpha = 1 - t;
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + fx.t0;
        const d = 12 + 55 * easeOutCubic(t);
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
      const y = H * 0.33;
      ctx.save();
      ctx.translate(W / 2, y);
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
