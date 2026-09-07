// Slingo — retro cabinet renderer: wood rails, chrome wire guides, rubber
// rings, classic pop-bumper caps with printed labels, lit plastic inserts,
// screen-printed playfield art and chrome-gradient lettering. Static things go
// into a cached layer (buildStatic); the machine-select screen is here too.
import { PROFILES, BALL_TYPES, fmtMoney } from './config.js';
import { dmText, dmWidth, printText, printWidth } from './font.js';
import { tierLabel } from './field.js';
import { machineProfile, allowedTypes } from './machines.js';

export const SIGN_COL = (s) => (s > 0 ? '#2fd36b' : '#ff3b3b');
export const SIGN_DARK = (s) => (s > 0 ? '#0f5a2b' : '#6a1010');
export const GATE_COL = { boost: '#ffd23f', brake: '#5ec8ff', warp: '#ff4fd8' };
export const AMBER = '#ffb000';

export function rr(c, x, y, w, h, r) { c.beginPath(); if (c.roundRect) c.roundRect(x, y, w, h, r); else c.rect(x, y, w, h); }
export function polyPath(c, poly) { c.beginPath(); c.moveTo(poly[0][0], poly[0][1]); for (let i = 1; i < poly.length; i++) c.lineTo(poly[i][0], poly[i][1]); c.closePath(); }
export function linePath(c, pts) { c.beginPath(); c.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y); }
const MONO = 'ui-monospace, "SF Mono", "Segoe UI Mono", "Roboto Mono", Menlo, Consolas, monospace';
export function text(c, str, x, y, size, color, { bold = true, align = 'center', glow = 0, spacing = '' } = {}) {
  c.font = `${bold ? '700' : '500'} ${size}px ${MONO}`;
  c.textAlign = align; c.textBaseline = 'middle';
  if (spacing && 'letterSpacing' in c) c.letterSpacing = spacing;
  if (glow) { c.shadowColor = color; c.shadowBlur = glow; }
  c.fillStyle = color; c.fillText(str, x, y); c.shadowBlur = 0;
  if (spacing && 'letterSpacing' in c) c.letterSpacing = '0px';
}
const shadeCache = new Map();
export function shade(hex, f) {
  const key = hex + f; if (shadeCache.has(key)) return shadeCache.get(key);
  const n = parseInt(hex.slice(1), 16); const ch = (s) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * f)));
  const out = `rgb(${ch(16)},${ch(8)},${ch(0)})`; shadeCache.set(key, out); return out;
}
export function withAlpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
let noisePattern = null;
export function getNoise(c) {
  if (noisePattern) return noisePattern;
  const n = document.createElement('canvas'); n.width = n.height = 128;
  const nc = n.getContext('2d'); const img = nc.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) { const v = 100 + Math.random() * 155; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
  nc.putImageData(img, 0, 0);
  noisePattern = c.createPattern(n, 'repeat');
  return noisePattern;
}
let grainPattern = null;
function getGrain(c) {
  if (grainPattern) return grainPattern;
  const n = document.createElement('canvas'); n.width = 256; n.height = 64;
  const nc = n.getContext('2d');
  nc.fillStyle = 'rgba(0,0,0,0)'; nc.fillRect(0, 0, 256, 64);
  for (let i = 0; i < 40; i++) {
    nc.beginPath(); let y = Math.random() * 64; nc.moveTo(0, y);
    for (let x = 0; x <= 256; x += 16) { y += (Math.random() - 0.5) * 3; nc.lineTo(x, y); }
    nc.strokeStyle = `rgba(0,0,0,${0.12 + Math.random() * 0.2})`; nc.lineWidth = 0.6 + Math.random() * 1.2; nc.stroke();
  }
  grainPattern = c.createPattern(n, 'repeat');
  return grainPattern;
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------
export function chromeStroke(c, pathFn, width, tint = '#dfe6f0') {
  c.lineCap = 'round'; c.lineJoin = 'round';
  c.save(); c.translate(1.5, 2.5); pathFn(); c.strokeStyle = 'rgba(0,0,0,0.5)'; c.lineWidth = width + 1; c.stroke(); c.restore();
  pathFn(); c.strokeStyle = '#3b4250'; c.lineWidth = width + 1; c.stroke();
  pathFn(); c.strokeStyle = '#8d97a6'; c.lineWidth = width; c.stroke();
  c.save(); c.translate(-width * 0.18, -width * 0.22); pathFn(); c.strokeStyle = tint; c.lineWidth = Math.max(1, width * 0.45); c.stroke(); c.restore();
}
export function rubberStroke(c, pathFn, width, color) {
  c.lineCap = 'round'; c.lineJoin = 'round';
  c.save(); c.translate(1.5, 2.5); pathFn(); c.strokeStyle = 'rgba(0,0,0,0.5)'; c.lineWidth = width + 1; c.stroke(); c.restore();
  pathFn(); c.strokeStyle = shade(color, 0.45); c.lineWidth = width + 1.5; c.stroke();
  pathFn(); c.strokeStyle = color; c.lineWidth = width; c.stroke();
  c.save(); c.translate(-width * 0.15, -width * 0.25); pathFn(); c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = Math.max(1, width * 0.3); c.stroke(); c.restore();
}
// Chrome stud with a rubber ring around it.
export function post(c, x, y, r, ring, lit = 0) {
  c.beginPath(); c.arc(x + 1.2, y + 2, r * 1.05, 0, Math.PI * 2); c.fillStyle = 'rgba(0,0,0,0.5)'; c.fill();
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
  const g = c.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r); g.addColorStop(0, 'rgba(255,255,255,0.5)'); g.addColorStop(0.5, ring); g.addColorStop(1, shade(ring, 0.5));
  c.fillStyle = g; if (lit) { c.shadowColor = ring; c.shadowBlur = 10; } c.fill(); c.shadowBlur = 0;
  c.beginPath(); c.arc(x, y, r * 0.5, 0, Math.PI * 2);
  const m = c.createRadialGradient(x - r * 0.2, y - r * 0.2, 0, x, y, r * 0.5); m.addColorStop(0, '#ffffff'); m.addColorStop(0.5, '#c9d2dd'); m.addColorStop(1, '#5a6472');
  c.fillStyle = m; c.fill();
}
// Classic pop bumper: skirt, chrome ring, coloured cap with a printed label.
export function bumperCap(c, x, y, r, color, label, tier, sign, motif, ink = '#fff', lit = 0) {
  c.beginPath(); c.ellipse(x + 2, y + r * 0.25, r * 1.5, r * 1.4, 0, 0, Math.PI * 2); c.fillStyle = 'rgba(0,0,0,0.5)'; c.fill();
  // skirt
  c.beginPath(); c.arc(x, y, r * 1.42, 0, Math.PI * 2);
  const sk = c.createRadialGradient(x, y, r * 0.9, x, y, r * 1.42); sk.addColorStop(0, shade(color, 0.7)); sk.addColorStop(1, shade(color, 0.3));
  c.fillStyle = sk; c.fill();
  c.strokeStyle = 'rgba(0,0,0,0.5)'; c.lineWidth = 1;
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) { c.beginPath(); c.moveTo(x + Math.cos(a) * r * 1.02, y + Math.sin(a) * r * 1.02); c.lineTo(x + Math.cos(a) * r * 1.4, y + Math.sin(a) * r * 1.4); c.stroke(); }
  // chrome ring
  c.beginPath(); c.arc(x, y, r * 1.12, 0, Math.PI * 2); c.arc(x, y, r * 0.98, 0, Math.PI * 2, true);
  const cg = c.createLinearGradient(x, y - r, x, y + r); cg.addColorStop(0, '#ffffff'); cg.addColorStop(0.3, '#aab4c0'); cg.addColorStop(0.55, '#e9eef3'); cg.addColorStop(1, '#4e5866');
  c.fillStyle = cg; c.fill('evenodd');
  // cap
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
  const g = c.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r); g.addColorStop(0, lit ? '#ffffff' : shade(color, 1.35)); g.addColorStop(0.5, color); g.addColorStop(1, shade(color, 0.55));
  c.fillStyle = g; if (lit) { c.shadowColor = color; c.shadowBlur = 24 * lit; } c.fill(); c.shadowBlur = 0;
  c.beginPath(); c.arc(x, y, r * 0.74, 0, Math.PI * 2); c.strokeStyle = 'rgba(255,255,255,0.75)'; c.lineWidth = Math.max(1.2, r * 0.07); c.stroke();
  if (motif) drawMotif(c, motif, x, y - r * 0.02, r * 0.42, 'rgba(255,255,255,0.22)');
  c.beginPath(); c.ellipse(x - r * 0.3, y - r * 0.45, r * 0.34, r * 0.16, -0.5, 0, Math.PI * 2); c.fillStyle = 'rgba(255,255,255,0.45)'; c.fill();
  if (label) printText(c, label, x, y - r * 0.2, Math.min(r * 0.42, (r * 1.2) / Math.max(1, label.length * 0.5)), { fill: ink, stroke: 'rgba(0,0,0,0.75)' });
  printText(c, tierLabel(sign, tier), x, y + r * 0.35, r * 0.42, { fill: SIGN_COL(sign), stroke: 'rgba(0,0,0,0.8)' });
}
// A lit plastic insert (lamp under the playfield).
export function lampInsert(c, x, y, r, kind, color, lit, angle = 0) {
  c.save(); c.translate(x, y); c.rotate(angle);
  c.beginPath();
  if (kind === 'arrow') { c.moveTo(0, -r * 1.3); c.lineTo(r, r * 0.4); c.lineTo(r * 0.45, r * 0.4); c.lineTo(r * 0.45, r * 1.2); c.lineTo(-r * 0.45, r * 1.2); c.lineTo(-r * 0.45, r * 0.4); c.lineTo(-r, r * 0.4); c.closePath(); }
  else if (kind === 'shield') { c.moveTo(-r, -r); c.lineTo(r, -r); c.lineTo(r, r * 0.3); c.quadraticCurveTo(r * 0.5, r * 1.1, 0, r * 1.3); c.quadraticCurveTo(-r * 0.5, r * 1.1, -r, r * 0.3); c.closePath(); }
  else if (kind === 'flame') { c.moveTo(0, -r * 1.4); c.quadraticCurveTo(r * 1.1, -r * 0.2, r * 0.6, r * 0.7); c.quadraticCurveTo(r * 0.5, r * 1.2, 0, r * 1.2); c.quadraticCurveTo(-r * 0.9, r * 1.1, -r * 0.6, r * 0.2); c.quadraticCurveTo(-r * 0.2, r * 0.3, 0, -r * 1.4); c.closePath(); }
  else c.arc(0, 0, r, 0, Math.PI * 2);
  c.fillStyle = lit ? color : shade(color, 0.32);
  if (lit) { c.shadowColor = color; c.shadowBlur = 14 * lit; }
  c.fill(); c.shadowBlur = 0;
  c.strokeStyle = 'rgba(0,0,0,0.65)'; c.lineWidth = 1.2; c.stroke();
  if (lit) { c.beginPath(); c.arc(-r * 0.25, -r * 0.3, r * 0.3, 0, Math.PI * 2); c.fillStyle = 'rgba(255,255,255,0.6)'; c.fill(); }
  c.restore();
}
// Drop-target / flap bar rotated about its centre.
export function bar(c, x, y, ang, hw, th, col, lit) {
  c.save(); c.translate(x, y); c.rotate(ang);
  c.save(); c.translate(2, 3); rr(c, -hw, -th / 2, hw * 2, th, 2); c.fillStyle = 'rgba(0,0,0,0.5)'; c.fill(); c.restore();
  rr(c, -hw, -th / 2, hw * 2, th, 2);
  const g = c.createLinearGradient(0, -th / 2, 0, th / 2); g.addColorStop(0, lit ? shade(col, 1.4) : '#4a4f5a'); g.addColorStop(1, lit ? shade(col, 0.6) : '#1c1f26');
  c.fillStyle = g; if (lit) { c.shadowColor = col; c.shadowBlur = 8; } c.fill(); c.shadowBlur = 0;
  c.strokeStyle = 'rgba(0,0,0,0.7)'; c.lineWidth = 1.2; c.stroke();
  c.restore();
}
export function drawHole(c, x, y, r, rim) {
  c.beginPath(); c.arc(x, y, r * 1.3, 0, Math.PI * 2);
  const cg = c.createLinearGradient(x, y - r, x, y + r); cg.addColorStop(0, '#f2f5f8'); cg.addColorStop(0.5, '#8d97a6'); cg.addColorStop(1, '#3b4250');
  c.fillStyle = cg; c.fill();
  c.beginPath(); c.arc(x, y, r * 1.08, 0, Math.PI * 2); c.fillStyle = rim; c.fill();
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
  const hg = c.createRadialGradient(x + r * 0.2, y + r * 0.3, r * 0.1, x, y, r); hg.addColorStop(0, '#000'); hg.addColorStop(0.75, '#05060a'); hg.addColorStop(1, '#2a2f3a');
  c.fillStyle = hg; c.fill();
  c.beginPath(); c.arc(x, y, r - 2, Math.PI * 1.1, Math.PI * 1.9); c.strokeStyle = 'rgba(255,255,255,0.3)'; c.lineWidth = 1.2; c.stroke();
}
// Printed motifs, drawn centred with "radius" r.
export function drawMotif(c, kind, x, y, r, color) {
  c.save(); c.translate(x, y); c.fillStyle = color; c.strokeStyle = color; c.lineJoin = 'round'; c.lineWidth = Math.max(1, r * 0.12);
  c.beginPath();
  switch (kind) {
    case 'star': for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, d = i % 2 ? r * 0.45 : r; c.lineTo(Math.cos(a) * d, Math.sin(a) * d); } c.closePath(); c.fill(); break;
    case 'flame': c.moveTo(0, -r); c.quadraticCurveTo(r * 0.9, -r * 0.1, r * 0.55, r * 0.6); c.quadraticCurveTo(r * 0.45, r, 0, r); c.quadraticCurveTo(-r * 0.8, r * 0.9, -r * 0.55, r * 0.1); c.quadraticCurveTo(-r * 0.2, r * 0.2, 0, -r); c.fill(); break;
    case 'bolt': c.moveTo(r * 0.2, -r); c.lineTo(-r * 0.55, r * 0.1); c.lineTo(-r * 0.05, r * 0.1); c.lineTo(-r * 0.3, r); c.lineTo(r * 0.55, -r * 0.15); c.lineTo(r * 0.05, -r * 0.15); c.closePath(); c.fill(); break;
    case 'wave': c.moveTo(-r, r * 0.3); c.quadraticCurveTo(-r * 0.5, -r * 0.8, 0, r * 0.1); c.quadraticCurveTo(r * 0.5, r * 0.9, r, -r * 0.2); c.lineWidth = Math.max(1.5, r * 0.28); c.stroke(); break;
    case 'note': c.arc(-r * 0.35, r * 0.55, r * 0.38, 0, Math.PI * 2); c.fill(); c.beginPath(); c.moveTo(0, r * 0.5); c.lineTo(0, -r); c.lineTo(r * 0.7, -r * 0.7); c.lineTo(r * 0.7, -r * 0.3); c.lineWidth = Math.max(1.5, r * 0.2); c.stroke(); break;
    case 'flag': for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if ((i + j) % 2 === 0) c.rect(-r + (i * r) / 2, -r + (j * r) / 2, r / 2, r / 2); c.fill(); break;
    case 'planet': c.arc(0, 0, r * 0.6, 0, Math.PI * 2); c.fill(); c.beginPath(); c.ellipse(0, 0, r * 1.1, r * 0.3, -0.4, 0, Math.PI * 2); c.lineWidth = Math.max(1.5, r * 0.16); c.stroke(); break;
    case 'crown': c.moveTo(-r, r * 0.7); c.lineTo(-r, -r * 0.4); c.lineTo(-r * 0.45, r * 0.1); c.lineTo(0, -r); c.lineTo(r * 0.45, r * 0.1); c.lineTo(r, -r * 0.4); c.lineTo(r, r * 0.7); c.closePath(); c.fill(); break;
    case 'seven': printText(c, '7', 0, 0, r * 2.2, { fill: color, stroke: 'rgba(0,0,0,0)' }); break;
    case 'skull': c.arc(0, -r * 0.2, r * 0.7, 0, Math.PI * 2); c.fill(); c.fillRect(-r * 0.4, r * 0.2, r * 0.8, r * 0.6); break;
    default: c.arc(0, 0, r * 0.6, 0, Math.PI * 2); c.fill();
  }
  c.restore();
}

// ---------------------------------------------------------------------------
// Screen-printed playfield art — bold flat colour, heavy keylines, halftone
// ---------------------------------------------------------------------------
const KEY = 'rgba(0,0,0,0.85)';
function keyFill(c, fill, lw = 2, alpha = 1) {
  c.fillStyle = fill; c.fill();
  c.lineJoin = 'round'; c.strokeStyle = KEY; c.lineWidth = lw; c.globalAlpha *= alpha; c.stroke(); c.globalAlpha /= alpha;
}
function flamesPath(c, x0, yBase, w, h, seed) {
  c.beginPath(); c.moveTo(x0, yBase);
  const n = Math.max(4, Math.round(w / 34));
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = x0 + t * w;
    const hh = h * (0.45 + 0.55 * Math.abs(Math.sin(i * 2.3 + seed) * Math.cos(i * 0.7 + seed)));
    const px = x0 + (i - 0.5) / n * w;
    c.quadraticCurveTo(px - w / n * 0.25, yBase - hh * 0.35, px, yBase - hh);
    c.quadraticCurveTo(px + w / n * 0.15, yBase - hh * 0.45, x, yBase - h * 0.12);
  }
  c.lineTo(x0 + w, yBase); c.closePath();
}
// A motif with a heavy keyline (drawn black and slightly larger underneath).
export function motifKeyed(c, kind, x, y, r, color) {
  drawMotif(c, kind, x + 1.5, y + 2.5, r * 1.16, 'rgba(0,0,0,0.45)');
  drawMotif(c, kind, x, y, r * 1.16, KEY);
  drawMotif(c, kind, x, y, r, color);
}
// A printed plate: rounded rect, flat fill, keyline, bold lettering.
export function plateText(c, str, x, y, size, fill, ink, { angle = 0, pad = 6, alpha = 1, notch = false } = {}) {
  const w = printWidth(c, str, size) + pad * 2, h = size * 1.35;
  c.save(); c.translate(x, y); c.rotate(angle); c.globalAlpha = alpha;
  c.save(); c.translate(1.5, 2.5); if (notch) ribbonPath(c, -w / 2, -h / 2, w, h); else rr(c, -w / 2, -h / 2, w, h, h * 0.3); c.fillStyle = 'rgba(0,0,0,0.5)'; c.fill(); c.restore();
  if (notch) ribbonPath(c, -w / 2, -h / 2, w, h); else rr(c, -w / 2, -h / 2, w, h, h * 0.3);
  keyFill(c, fill, 1.8);
  printText(c, str, 0, 0.5, size, { fill: ink, stroke: 'rgba(0,0,0,0)' });
  c.restore();
}
function ribbonPath(c, x, y, w, h) {
  const n = h * 0.35;
  c.beginPath(); c.moveTo(x, y); c.lineTo(x + w, y); c.lineTo(x + w - n, y + h / 2); c.lineTo(x + w, y + h); c.lineTo(x, y + h); c.lineTo(x + n, y + h / 2); c.closePath();
}
export function drawArt(c, F, a, pal) {
  const { x, y, W, H, R } = a;
  const alpha = a.alpha === undefined ? 1 : a.alpha;
  c.save(); c.globalAlpha = alpha;
  switch (a.kind) {
    case 'rays': {
      // alternating radial bands from a point — the classic backglass burst
      const cols = a.colors || [pal.accent, pal.accent2], n = a.n || 18, Rr = Math.max(F ? F.w + F.h : 1200, 600);
      c.translate(x, y);
      for (let i = 0; i < n; i++) { const a0 = (i * Math.PI * 2) / n, a1 = a0 + Math.PI / n; c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(a0) * Rr, Math.sin(a0) * Rr); c.lineTo(Math.cos(a1) * Rr, Math.sin(a1) * Rr); c.closePath(); c.fillStyle = cols[i % cols.length]; c.fill(); }
      break;
    }
    case 'flames': {
      const cols = a.colors || ['#ff3b1f', '#ffd400', '#fff1c1'];
      cols.forEach((col, i) => { flamesPath(c, x, y, W, H * (1 - i * 0.28), i * 1.7); keyFill(c, col, 2.5, 0.9); });
      break;
    }
    case 'checker': {
      const cols = a.colors || ['#fff', '#000'], n = Math.max(2, Math.round(W / Math.max(4, H / 2)));
      c.translate(x, y); c.rotate(a.angle || 0);
      for (let i = 0; i < n; i++) for (let j = 0; j < 2; j++) { c.fillStyle = cols[(i + j) % 2]; c.fillRect((i * W) / n, (j * H) / 2, W / n + 0.5, H / 2 + 0.5); }
      c.strokeStyle = KEY; c.lineWidth = 2; c.strokeRect(0, 0, W, H);
      break;
    }
    case 'burst': {
      c.translate(x, y);
      for (let i = 0; i < 16; i++) { const a0 = (i * Math.PI) / 8, a1 = a0 + Math.PI / 16; c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(a0) * R, Math.sin(a0) * R); c.lineTo(Math.cos(a1) * R, Math.sin(a1) * R); c.closePath(); keyFill(c, a.color, 1.5, 0.6); }
      break;
    }
    case 'stars': {
      const n = a.n || 10;
      for (let i = 0; i < n; i++) { const t = ((i * 7919) % 1000) / 1000, s = ((i * 104729) % 1000) / 1000; motifKeyed(c, 'star', x + t * W, y + s * H, 3 + ((i * 31) % 5), a.color); }
      break;
    }
    case 'halftone': {
      c.fillStyle = a.color;
      for (let yy = y; yy < y + H; yy += 9) { const t = (yy - y) / H; for (let xx = x; xx < x + W; xx += 9) { c.beginPath(); c.arc(xx, yy, 3.2 * (1 - t) + 0.3, 0, Math.PI * 2); c.fill(); } }
      break;
    }
    case 'dots': {
      c.fillStyle = a.color;
      for (let yy = y; yy < y + H; yy += 12) for (let xx = x; xx < x + W; xx += 12) { c.beginPath(); c.arc(xx, yy, 1.6, 0, Math.PI * 2); c.fill(); }
      break;
    }
    case 'waves': {
      const cols = a.colors || ['#5ee1ff', '#fff'];
      cols.forEach((col, k) => {
        c.beginPath(); c.moveTo(x, y + H);
        const n = 4 + k, amp = H * 0.28;
        for (let i = 0; i <= n; i++) { const xx = x + (i / n) * W, cx = xx - W / n / 2; c.quadraticCurveTo(cx, y + H * 0.3 - amp + k * 6, xx, y + H * 0.55 + k * 6); c.quadraticCurveTo(xx + W / n * 0.2, y + H * 0.8 + k * 6, xx + W / n * 0.35, y + H * 0.7 + k * 6); }
        c.lineTo(x + W, y + H); c.closePath(); c.globalAlpha = alpha * (k === 0 ? 0.85 : 0.6); keyFill(c, col, 2.5, 0.9);
      });
      break;
    }
    case 'text': printText(c, a.text, x, y, a.size * F.w, { fill: a.color, stroke: a.keyline ? KEY : 'rgba(0,0,0,0)', angle: a.angle || 0, alpha }); break;
    case 'ribbon': plateText(c, a.text, x, y, a.size * F.w, a.color || pal.accent, a.ink || '#fff', { angle: a.angle || 0, pad: 10, notch: true }); break;
    case 'bigmotif': {
      motifKeyed(c, a.motif, x, y, R, a.color);
      c.save(); c.beginPath(); c.arc(x, y, R * 1.1, 0, Math.PI * 2); c.clip();
      c.fillStyle = 'rgba(0,0,0,0.35)';
      for (let yy = y - R; yy < y + R * 1.1; yy += 7) { const t = Math.max(0, (yy - y + R) / (2.1 * R)); for (let xx = x - R; xx < x + R * 1.1; xx += 7) { c.beginPath(); c.arc(xx, yy, 0.2 + 2.4 * t, 0, Math.PI * 2); c.fill(); } }
      c.restore();
      break;
    }
    case 'speedlines': {
      c.strokeStyle = a.color; c.lineCap = 'round';
      const n = a.n || 6;
      for (let i = 0; i < n; i++) { const yy = y + (H * (i + 0.5)) / n, len = W * (0.5 + 0.5 * Math.abs(Math.sin(i * 1.7))); c.lineWidth = 2 + (i % 3); c.beginPath(); c.moveTo(a.dir < 0 ? x + W : x, yy); c.lineTo(a.dir < 0 ? x + W - len : x + len, yy); c.stroke(); }
      break;
    }
    case 'bolts': {
      const n = a.n || 2;
      for (let i = 0; i < n; i++) motifKeyed(c, 'bolt', x + ((i + 0.5) / n) * W, y + H * (0.3 + 0.4 * (i % 2)), Math.min(W / n, H) * 0.42, a.color);
      break;
    }
    case 'circuit': {
      c.strokeStyle = a.color; c.lineWidth = 2.5; c.fillStyle = a.color;
      let seed = 3;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      for (let i = 0; i < 26; i++) {
        let px = x + rnd() * W, py = y + rnd() * H;
        c.beginPath(); c.moveTo(px, py);
        for (let k = 0; k < 3; k++) { if (rnd() < 0.5) px += (rnd() - 0.5) * W * 0.3; else py += (rnd() - 0.5) * H * 0.2; c.lineTo(px, py); }
        c.stroke(); c.beginPath(); c.arc(px, py, 4, 0, Math.PI * 2); c.fill(); c.strokeStyle = KEY; c.lineWidth = 1.2; c.stroke(); c.strokeStyle = a.color; c.lineWidth = 2.5;
      }
      break;
    }
    case 'hazard': {
      c.save(); c.beginPath(); c.rect(x, y, W, H); c.clip();
      c.fillStyle = '#111'; c.fillRect(x, y, W, H); c.fillStyle = '#ffd400';
      for (let xx = x - H; xx < x + W + H; xx += H * 2) { c.beginPath(); c.moveTo(xx, y + H); c.lineTo(xx + H, y); c.lineTo(xx + H * 2, y); c.lineTo(xx + H, y + H); c.closePath(); c.fill(); }
      c.restore(); c.strokeStyle = KEY; c.lineWidth = 2; c.strokeRect(x, y, W, H);
      break;
    }
    case 'lanes': {
      rr(c, x, y, W, H, 6); keyFill(c, withAlpha(pal.accent2, 0.18), 2);
      for (const lx of [x + W * 0.25, x + W * 0.75]) for (let k = 0; k < 5; k++) { const yy = y + H * (0.15 + k * 0.17); c.beginPath(); c.moveTo(lx, yy + 7); c.lineTo(lx - 6, yy - 2); c.lineTo(lx + 6, yy - 2); c.closePath(); keyFill(c, pal.accent2, 1.5); }
      break;
    }
    case 'uturn': {
      const ri = a.ri * F.w, cx = x, cy = y, top = F.y0 + a.armTop * F.h;
      c.beginPath(); c.moveTo(cx - ri, top); c.arc(cx, top, ri, Math.PI, Math.PI * 2); c.lineTo(cx + ri, cy); c.arc(cx, cy, ri, 0, Math.PI); c.closePath();
      const g = c.createLinearGradient(cx - ri, 0, cx + ri, 0); g.addColorStop(0, shade(pal.accent, 0.6)); g.addColorStop(0.5, pal.accent); g.addColorStop(1, shade(pal.accent, 0.6));
      keyFill(c, g, 2.5);
      motifKeyed(c, F.machine.motif, cx, (top + cy) / 2, ri * 0.5, 'rgba(255,255,255,0.8)');
      for (let k = 0; k < 4; k++) { const yy = top + (cy - top) * (0.2 + k * 0.2); for (const [lx, dir] of [[cx + (a.R + a.ri) / 2 * F.w * (a.entry === 'left' ? -1 : 1), 1], [cx - (a.R + a.ri) / 2 * F.w * (a.entry === 'left' ? -1 : 1), -1]]) { c.beginPath(); c.moveTo(lx, yy + 7 * dir); c.lineTo(lx - 6, yy - 2 * dir); c.lineTo(lx + 6, yy - 2 * dir); c.closePath(); keyFill(c, pal.accent2, 1.5); } }
      break;
    }
    case 'cross': {
      const d = a.d * F.w;
      c.beginPath(); c.arc(x, y, d * 1.05, 0, Math.PI * 2); keyFill(c, withAlpha(pal.accent, 0.35), 2.5);
      c.beginPath(); c.arc(x, y, d * 0.55, 0, Math.PI * 2); c.strokeStyle = KEY; c.lineWidth = 2; c.stroke();
      c.strokeStyle = withAlpha(pal.ink, 0.6); c.lineWidth = 3; c.setLineDash([6, 6]);
      for (let k = 0; k < 4; k++) { const an = (k * Math.PI) / 2; c.beginPath(); c.moveTo(x + Math.cos(an) * d * 0.35, y + Math.sin(an) * d * 0.35); c.lineTo(x + Math.cos(an) * d * 1.05, y + Math.sin(an) * d * 1.05); c.stroke(); }
      c.setLineDash([]);
      break;
    }
    case 'road': {
      c.save(); c.beginPath();
      if (a.curve) { c.moveTo(x, y); c.quadraticCurveTo(x - W * 0.3, y + H * 0.5, x, y + H); c.lineTo(x + W, y + H); c.quadraticCurveTo(x + W * 1.3, y + H * 0.5, x + W, y); c.closePath(); }
      else c.rect(x, y, W, H);
      c.fillStyle = 'rgba(30,32,38,0.6)'; c.fill(); c.strokeStyle = '#ffffff'; c.lineWidth = 3; c.stroke(); c.strokeStyle = KEY; c.lineWidth = 1.2; c.stroke();
      c.setLineDash([14, 12]); c.strokeStyle = pal.accent3 || '#ffd400'; c.lineWidth = 4;
      c.beginPath(); c.moveTo(x + W / 2, y); c.lineTo(x + W / 2, y + H); c.stroke(); c.setLineDash([]); c.restore();
      break;
    }
    case 'stripes': {
      c.save(); c.beginPath(); c.rect(x, y, W, H); c.clip();
      const cols = a.colors || ['#fff', '#000'];
      for (let i = 0, xx = x - H; xx < x + W + H; xx += 22, i++) { c.beginPath(); c.moveTo(xx, y + H); c.lineTo(xx + H, y); c.lineTo(xx + H + 11, y); c.lineTo(xx + 11, y + H); c.closePath(); keyFill(c, cols[i % cols.length], 1.5, 0.5); }
      c.restore();
      break;
    }
    case 'planet': {
      c.beginPath(); c.arc(x, y, R, 0, Math.PI * 2);
      const g = c.createRadialGradient(x - R * 0.3, y - R * 0.3, R * 0.1, x, y, R); g.addColorStop(0, a.colors[1]); g.addColorStop(1, a.colors[0]);
      c.globalAlpha = alpha * 0.55; keyFill(c, g, 3);
      c.globalAlpha = alpha * 0.75; c.beginPath(); c.ellipse(x, y, R * 1.6, R * 0.35, -0.35, 0, Math.PI * 2); c.strokeStyle = KEY; c.lineWidth = 9; c.stroke(); c.strokeStyle = a.colors[1]; c.lineWidth = 5; c.stroke();
      break;
    }
    case 'comet': {
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + W, y + H * 0.3); c.lineTo(x + W * 0.95, y + H * 0.7); c.closePath();
      const g = c.createLinearGradient(x, y, x + W, y); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, a.color);
      c.fillStyle = g; c.fill(); c.beginPath(); c.arc(x + W, y + H * 0.5, H * 0.35, 0, Math.PI * 2); keyFill(c, '#fff', 2);
      break;
    }
    case 'bricks': {
      c.strokeStyle = withAlpha(a.color, 0.9); c.lineWidth = 2;
      const bh = 16, bw = 34;
      for (let row = 0, yy = y; yy < y + H; yy += bh, row++) { c.beginPath(); c.moveTo(x, yy); c.lineTo(x + W, yy); c.stroke(); for (let xx = x + (row % 2 ? bw / 2 : 0); xx < x + W; xx += bw) { c.beginPath(); c.moveTo(xx, yy); c.lineTo(xx, yy + bh); c.stroke(); } }
      break;
    }
    case 'crenels': {
      const n = Math.round(W / 22);
      for (let i = 0; i < n; i += 2) { c.beginPath(); c.rect(x + (i * W) / n, y, W / n, H); keyFill(c, withAlpha(a.color, 0.7), 1.5); }
      c.beginPath(); c.rect(x, y + H, W, 4); keyFill(c, withAlpha(a.color, 0.7), 1.5);
      break;
    }
    case 'banner': {
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + W, y); c.lineTo(x + W, y + H * 0.8); c.lineTo(x + W / 2, y + H); c.lineTo(x, y + H * 0.8); c.closePath();
      keyFill(c, a.color, 2.5);
      motifKeyed(c, 'crown', x + W / 2, y + H * 0.4, W * 0.3, '#ffdc64');
      break;
    }
    case 'mountain': {
      c.beginPath(); c.moveTo(x, y + H); c.lineTo(x + W * 0.35, y + H * 0.1); c.lineTo(x + W * 0.45, y + H * 0.3); c.lineTo(x + W * 0.55, y); c.lineTo(x + W * 0.7, y + H * 0.4); c.lineTo(x + W, y + H); c.closePath();
      keyFill(c, a.color, 3); c.strokeStyle = pal.accent; c.lineWidth = 1.5; c.stroke();
      break;
    }
    case 'lava': {
      c.strokeStyle = a.color; c.lineWidth = 3; c.shadowColor = a.color; c.shadowBlur = 10; c.lineCap = 'round';
      let seed = 11; const rnd = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
      for (let i = 0; i < 14; i++) { let px = x + rnd() * W, py = y + rnd() * H; c.beginPath(); c.moveTo(px, py); for (let k = 0; k < 5; k++) { px += (rnd() - 0.5) * 40; py += rnd() * 30; c.lineTo(px, py); } c.stroke(); }
      c.shadowBlur = 0;
      break;
    }
    case 'curtain': {
      const n = Math.max(2, Math.round(W / 10));
      for (let i = 0; i < n; i++) { const g = c.createLinearGradient(x + (i * W) / n, 0, x + ((i + 1) * W) / n, 0); g.addColorStop(0, shade(a.color, 0.45)); g.addColorStop(0.5, a.color); g.addColorStop(1, shade(a.color, 0.4)); c.fillStyle = g; c.fillRect(x + (i * W) / n, y, W / n + 0.5, H); }
      c.beginPath(); c.rect(x, y + H * 0.45, W, 8); keyFill(c, pal.accent2, 1.5);
      c.strokeStyle = KEY; c.lineWidth = 2; c.strokeRect(x, y, W, H);
      break;
    }
    case 'cards': {
      const suits = ['♠', '♥', '♦', '♣'], n = a.n || 10;
      c.font = `900 28px serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineWidth = 3; c.strokeStyle = KEY; c.lineJoin = 'round';
      for (let i = 0; i < n; i++) { const t = ((i * 7919) % 1000) / 1000, s = ((i * 104729) % 1000) / 1000; const xx = x + t * W, yy = y + s * H; c.strokeText(suits[i % 4], xx, yy); c.fillStyle = i % 2 ? pal.accent : a.color; c.fillText(suits[i % 4], xx, yy); }
      break;
    }
    case 'marquee': {
      rr(c, x, y, W, H, 8); keyFill(c, 'rgba(0,0,0,0.45)', 2.5);
      const n = Math.round(W / 14);
      for (let i = 0; i <= n; i++) for (const yy of [y, y + H]) { c.beginPath(); c.arc(x + (i * W) / n, yy, 3, 0, Math.PI * 2); keyFill(c, a.color, 1.2); }
      break;
    }
    default: break;
  }
  c.restore();
}

// ---------------------------------------------------------------------------
// Static cabinet layer
// ---------------------------------------------------------------------------
export function buildStatic(c, F, W, H, DPR) {
  const pal = F.machine.palette, M = F.machine;
  c.setTransform(DPR, 0, 0, DPR, 0, 0);
  c.clearRect(0, 0, W, H);
  c.lineJoin = 'round'; c.lineCap = 'round';

  // --- cabinet: wood rails around the outline, chrome inner edge ------------
  c.save(); c.translate(0, 12); polyPath(c, F.poly); c.strokeStyle = 'rgba(0,0,0,0.65)'; c.lineWidth = 42; c.shadowColor = '#000'; c.shadowBlur = 28; c.stroke(); c.restore();
  polyPath(c, F.poly);
  const wg = c.createLinearGradient(F.x0, F.y0, F.x0 + F.w, F.y0 + F.h); wg.addColorStop(0, pal.wood[1]); wg.addColorStop(0.5, pal.wood[0]); wg.addColorStop(1, pal.wood[1]);
  c.strokeStyle = wg; c.lineWidth = 36; c.stroke();
  c.save(); polyPath(c, F.poly); c.lineWidth = 36; c.strokeStyle = getGrain(c); c.globalAlpha = 0.7; c.stroke(); c.restore();
  polyPath(c, F.poly); c.strokeStyle = 'rgba(255,255,255,0.12)'; c.lineWidth = 1.5; c.save(); c.translate(-10, -10); c.stroke(); c.restore();
  polyPath(c, F.poly); c.strokeStyle = '#0d0f14'; c.lineWidth = 9; c.stroke();
  chromeStroke(c, () => polyPath(c, F.poly), 4.5);

  // apron (below the bottom diagonals, outside the outline): printed card
  {
    const P = F.P;
    const apron = (pts) => { c.beginPath(); pts.forEach((p, i) => { const q = P(p); i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y); }); c.closePath(); };
    for (const pts of [[[0.02, 0.835], [0.3, 0.965], [0.3, 1.0], [0.02, 1.0]], [[0.9, 0.835], [0.7, 0.965], [0.7, 1.0], [0.98, 1.0]]]) {
      apron(pts); c.fillStyle = shade(pal.accent, 0.75); c.fill();
      c.save(); apron(pts); c.clip(); flamesPath(c, F.x0, F.y0 + F.h, F.w, F.h * 0.12, 2); c.fillStyle = withAlpha(pal.accent2, 0.35); c.fill(); c.restore();
    }
    printText(c, M.name, F.x0 + F.w * 0.15, F.y0 + F.h * 0.955, Math.max(8, F.w * 0.028), { chrome: pal.title, angle: Math.atan2(F.h * 0.13, F.w * 0.28) });
    printText(c, machineProfile(M).name, F.x0 + F.w * 0.85, F.y0 + F.h * 0.955, Math.max(7, F.w * 0.02), { fill: pal.ink, angle: -Math.atan2(F.h * 0.13, F.w * 0.2) });
  }

  // --- playfield surface --------------------------------------------------
  polyPath(c, F.poly);
  const g = c.createLinearGradient(0, F.y0, 0, F.y0 + F.h); g.addColorStop(0, pal.field[0]); g.addColorStop(1, pal.field[1]);
  c.fillStyle = g; c.fill();
  c.save(); polyPath(c, F.poly); c.clip();
  c.globalAlpha = 0.06; c.fillStyle = getNoise(c); c.fillRect(F.x0, F.y0, F.w, F.h); c.globalAlpha = 1;
  // printed art
  for (const a of F.art) drawArt(c, F, a, pal);
  // launch lane floor: darker channel with a printed "SHOOT" chevron ladder
  rr(c, F.lane.left, F.lane.top, F.lane.right - F.lane.left, F.lane.floor - F.lane.top, 0);
  const lg = c.createLinearGradient(F.lane.left, 0, F.lane.right, 0); lg.addColorStop(0, 'rgba(0,0,0,0.5)'); lg.addColorStop(0.5, 'rgba(0,0,0,0.2)'); lg.addColorStop(1, 'rgba(0,0,0,0.5)');
  c.fillStyle = lg; c.fill();
  // clear-coat sheen
  const sheen = c.createLinearGradient(F.x0, F.y0, F.x0 + F.w * 0.6, F.y0 + F.h); sheen.addColorStop(0, 'rgba(255,255,255,0.10)'); sheen.addColorStop(0.35, 'rgba(255,255,255,0.0)'); sheen.addColorStop(1, 'rgba(0,0,0,0.12)');
  c.fillStyle = sheen; c.fillRect(F.x0, F.y0, F.w, F.h);

  // titles and printed labels
  for (const l of F.labels) {
    if (l.title) printText(c, l.text, l.x, l.y, Math.max(12, l.px * 0.9), { chrome: pal.title, glow: 6, spacing: '1px' });
    else if (l.sub) printText(c, l.text, l.x, l.y, Math.max(7, l.px * 0.9), { fill: pal.ink, spacing: '2px' });
    else if (l.chrome) printText(c, l.text, l.x, l.y, Math.max(8, l.px * 0.8), { chrome: pal.title });
    else plateText(c, l.text, l.x, l.y, Math.max(7, l.px * 0.7), l.color || pal.accent, l.ink || '#ffffff');
  }

  // exit well between the flippers
  {
    const ex0 = F.exit.x0 + 6, ex1 = F.exit.x1 - 6, wellTop = F.y0 + F.h * 0.965;
    rr(c, ex0, wellTop + 2, ex1 - ex0, F.y0 + F.h - wellTop + 30, 4);
    const wgd = c.createLinearGradient(0, wellTop, 0, F.y0 + F.h); wgd.addColorStop(0, '#000'); wgd.addColorStop(1, '#101218');
    c.fillStyle = wgd; c.fill(); c.strokeStyle = 'rgba(255,255,255,0.1)'; c.lineWidth = 1; c.stroke();
    printText(c, '? OUTHOLE', (ex0 + ex1) / 2, (wellTop + F.drainY) / 2 + 1, Math.min(10, F.h * 0.016), { fill: 'rgba(255,255,255,0.55)', stroke: 'rgba(0,0,0,0)' });
  }

  // inserts (unlit state; lit chase drawn dynamically)
  for (const it of F.inserts) lampInsert(c, it.x, it.y, it.r, it.kind, it.color, 0, it.angle);

  // holes & baskets
  for (const hole of F.holes) {
    if (hole.kind === 'basket') {
      c.beginPath(); c.arc(hole.x, hole.y, hole.r * 0.92, 0, Math.PI); c.closePath();
      const bgd = c.createLinearGradient(0, hole.y, 0, hole.y + hole.r); bgd.addColorStop(0, '#02030a'); bgd.addColorStop(1, '#1a1e33');
      c.fillStyle = bgd; c.fill();
      chromeStroke(c, () => { c.beginPath(); c.arc(hole.x, hole.y, hole.r, 0, Math.PI, false); c.lineTo(hole.x - hole.r, hole.y - hole.r * 0.6); c.moveTo(hole.x + hole.r, hole.y); c.lineTo(hole.x + hole.r, hole.y - hole.r * 0.6); }, 3);
    } else drawHole(c, hole.x, hole.y, hole.r, pal.accent);
    printText(c, '?', hole.x, hole.y + 1, hole.r * 1.1, { fill: 'rgba(255,255,255,0.6)', stroke: 'rgba(0,0,0,0)' });
    if (hole.label) printText(c, hole.label, hole.x, hole.y - hole.r * 1.5 - 6, 8, { fill: pal.ink });
  }
  // kickout scoops + ejector nozzles
  for (const k of F.kickouts) {
    c.setLineDash([3, 6]); c.strokeStyle = pal.accent2; c.globalAlpha = 0.35; c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(k.x, k.y); c.lineTo(k.ex, k.ey); c.stroke(); c.setLineDash([]); c.globalAlpha = 1;
    // hood
    rr(c, k.x - k.r * 1.3, k.y - k.r * 1.9, k.r * 2.6, k.r * 1.5, 5);
    const hg = c.createLinearGradient(0, k.y - k.r * 1.9, 0, k.y - k.r * 0.4); hg.addColorStop(0, shade(pal.accent, 1.2)); hg.addColorStop(1, shade(pal.accent, 0.5));
    c.fillStyle = hg; c.fill(); c.strokeStyle = 'rgba(0,0,0,0.7)'; c.lineWidth = 1.5; c.stroke();
    drawHole(c, k.x, k.y, k.r, pal.accent2);
    printText(c, k.label || 'KICK', k.x, k.y - k.r * 1.15, Math.min(8, (k.r * 2.4) / Math.max(1, (k.label || 'KICK').length * 0.5)), { fill: '#fff' });
    printText(c, tierLabel(k.sign, k.tier), k.x, k.y + 1, k.r * 0.9, { fill: SIGN_COL(k.sign), stroke: 'rgba(0,0,0,0)' });
    c.save(); c.translate(k.ex, k.ey); c.rotate(Math.atan2(k.dir[1], k.dir[0]));
    rr(c, -10, -7, 20, 14, 3); c.fillStyle = '#2a2f3a'; c.fill(); chromeStroke(c, () => rr(c, -10, -7, 20, 14, 3), 1.5);
    c.beginPath(); c.moveTo(4, -4); c.lineTo(9, 0); c.lineTo(4, 4); c.strokeStyle = pal.accent2; c.lineWidth = 2; c.stroke();
    c.restore();
  }
  // magnets: chrome disc with rings
  for (const m of F.magnets) {
    const col = SIGN_COL(m.sign);
    c.strokeStyle = col; c.globalAlpha = 0.18; c.lineWidth = 1; c.setLineDash([2, 5]);
    for (const k of [0.45, 0.7, 1]) { c.beginPath(); c.arc(m.x, m.y, m.range * k, 0, Math.PI * 2); c.stroke(); }
    c.setLineDash([]); c.globalAlpha = 1;
    c.beginPath(); c.arc(m.x + 1.5, m.y + 2.5, m.r * 1.15, 0, Math.PI * 2); c.fillStyle = 'rgba(0,0,0,0.5)'; c.fill();
    c.beginPath(); c.arc(m.x, m.y, m.r * 1.15, 0, Math.PI * 2);
    const mg = c.createLinearGradient(m.x, m.y - m.r, m.x, m.y + m.r); mg.addColorStop(0, '#f4f7fa'); mg.addColorStop(0.5, '#8d97a6'); mg.addColorStop(1, '#3b4250');
    c.fillStyle = mg; c.fill();
    c.beginPath(); c.arc(m.x, m.y, m.r * 0.8, 0, Math.PI * 2); c.fillStyle = col; c.fill();
    c.beginPath(); c.arc(m.x, m.y, m.r * 0.5, 0, Math.PI * 2); c.fillStyle = '#1a1d24'; c.fill();
    printText(c, m.label || 'MAGNET', m.x, m.y - m.r - 10, 8, { fill: col });
  }
  // gates: chrome guides, printed chevrons, lamp
  for (const g2 of F.gates) {
    const col = GATE_COL[g2.kind];
    if (g2.guides.length) {
      c.save(); c.translate(g2.x, g2.y); c.rotate(-g2.angle);
      rr(c, -g2.G + 3, -g2.L, (g2.G - 3) * 2, g2.L * 2, 4);
      c.fillStyle = 'rgba(0,0,0,0.35)'; c.fill();
      c.strokeStyle = col; c.lineWidth = 2; c.globalAlpha = 0.85; c.lineCap = 'round';
      if (g2.kind === 'boost') { for (let k = -1; k <= 1; k++) { c.beginPath(); c.moveTo(-7, k * 11 - 4); c.lineTo(0, k * 11 + 3); c.lineTo(7, k * 11 - 4); c.stroke(); } }
      else if (g2.kind === 'brake') { for (let k = -1; k <= 1; k++) { c.beginPath(); c.moveTo(-7, k * 9); c.lineTo(7, k * 9); c.stroke(); } }
      else { c.beginPath(); c.moveTo(0, -9); c.lineTo(8, 0); c.lineTo(0, 9); c.lineTo(-8, 0); c.closePath(); c.stroke(); c.beginPath(); c.arc(0, 0, 3, 0, Math.PI * 2); c.fillStyle = col; c.fill(); }
      c.globalAlpha = 1; c.restore();
      for (const gd of g2.guides) chromeStroke(c, () => { c.beginPath(); c.moveTo(gd.a.x, gd.a.y); c.lineTo(gd.b.x, gd.b.y); }, 3);
      for (const gd of g2.guides) { post(c, gd.a.x, gd.a.y, 3.6, pal.rubber); post(c, gd.b.x, gd.b.y, 3.6, pal.rubber); }
    } else {
      // kicker plate at the bottom of a U-turn
      c.save(); c.translate(g2.x, g2.y);
      rr(c, -14, -9, 28, 18, 4); c.fillStyle = shade(col, 0.5); c.fill(); c.strokeStyle = 'rgba(0,0,0,0.7)'; c.lineWidth = 1.5; c.stroke();
      drawMotif(c, 'bolt', 0, 0, 7, col);
      c.restore();
    }
    c.setLineDash([3, 3]); c.strokeStyle = col; c.globalAlpha = 0.6; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(g2.sensor.a.x, g2.sensor.a.y); c.lineTo(g2.sensor.b.x, g2.sensor.b.y); c.stroke(); c.setLineDash([]); c.globalAlpha = 1;
    const name = g2.label || (g2.kind === 'warp' ? `WARP ${g2.i < g2.twin ? 'A' : 'B'}` : g2.kind === 'boost' ? 'BOOST' : 'SLOW');
    const off = (g2.guides.length ? g2.L + 10 : 16) + (g2.labelOff || 0) * 12;
    // labels of gates hugging a side wall are anchored to that wall so they
    // never run into the launch lane or off the cabinet
    const lx = g2.x + g2.ax * off, ly = g2.y + g2.ay * off;
    const nearRight = g2.x > F.x0 + F.w * 0.78, nearLeft = g2.x < F.x0 + F.w * 0.2;
    printText(c, `${name} ${tierLabel(g2.sign, g2.tier)}`, nearRight ? F.lane.left - 4 : nearLeft ? F.x0 + 6 : lx, ly, 8, { fill: col, align: nearRight ? 'right' : nearLeft ? 'left' : 'center' });
  }
  // spinners: bracket + posts (blade drawn dynamically)
  for (const sp of F.spinners) {
    c.save(); c.translate(sp.x, sp.y); c.rotate(sp.angle);
    rr(c, -sp.hw, -7, sp.hw * 2, 14, 3); c.fillStyle = 'rgba(0,0,0,0.35)'; c.fill(); c.strokeStyle = 'rgba(255,255,255,0.15)'; c.lineWidth = 1; c.stroke();
    c.restore();
    chromeStroke(c, () => { c.beginPath(); c.moveTo(sp.posts[0].x, sp.posts[0].y); c.lineTo(sp.posts[1].x, sp.posts[1].y); }, 2);
    for (const p of sp.posts) post(c, p.x, p.y, p.r, pal.rubber);
    printText(c, `${sp.label || 'SPIN'} +`, sp.x, sp.y - 16, 8, { fill: pal.ink });
  }
  // one-way gates: hinge + pass arrow (flap drawn dynamically)
  for (const o of F.oneways) {
    c.save(); c.translate(o.x, o.y); c.rotate(Math.atan2(o.ny, o.nx));
    c.strokeStyle = o.lane ? pal.accent2 : SIGN_COL(1); c.globalAlpha = 0.7; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(-4, 0); c.lineTo(14, 0); c.moveTo(9, -5); c.lineTo(14, 0); c.lineTo(9, 5); c.stroke();
    c.globalAlpha = 1; c.restore();
    post(c, o.seg.a.x, o.seg.a.y, 3.8, pal.rubber);
    if (!o.lane) printText(c, `${o.label || 'ONE-WAY'} ${tierLabel(o.sign, o.tier)}`, o.x, o.y - 13, 8, { fill: pal.ink });
  }
  // drop-target banks: base plate (targets drawn dynamically)
  for (const bk of F.banks) {
    c.save(); c.translate(bk.x, bk.y); c.rotate(bk.angle);
    rr(c, -bk.sp - bk.hw - 6, -6, (bk.sp + bk.hw + 6) * 2, 18, 4);
    c.fillStyle = '#14171d'; c.fill(); c.strokeStyle = 'rgba(255,255,255,0.15)'; c.lineWidth = 1; c.stroke();
    c.restore();
    printText(c, `${bk.label || 'TARGETS'} ${tierLabel(bk.sign, bk.tier)} · BANK +++`, bk.x, bk.y - 21, 8, { fill: pal.ink });
  }
  // moving bumper rails
  for (const mv of F.movers) {
    const a = { x: mv.cx - mv.dx * mv.amp, y: mv.cy - mv.dy * mv.amp }, b = { x: mv.cx + mv.dx * mv.amp, y: mv.cy + mv.dy * mv.amp };
    chromeStroke(c, () => { c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); }, 3);
    post(c, a.x, a.y, 4, pal.rubber); post(c, b.x, b.y, 4, pal.rubber);
    if (mv.label) printText(c, mv.label, mv.cx, mv.cy - mv.r - 16, 8, { fill: pal.ink });
  }

  // walls: chrome wire guides, rubber, wireform ramps; the outline is the cabinet
  const divider = F.walls.filter((s) => s.divider);
  chromeStroke(c, () => { c.beginPath(); for (const s of divider) { c.moveTo(s.a.x, s.a.y); c.lineTo(s.b.x, s.b.y); } }, 4);
  const chrome = F.walls.filter((s) => !s.neon && s.style === 'chrome');
  if (chrome.length) chromeStroke(c, () => { c.beginPath(); for (const s of chrome) { c.moveTo(s.a.x, s.a.y); c.lineTo(s.b.x, s.b.y); } }, 3.5);
  const rubber = F.walls.filter((s) => !s.neon && s.style === 'rubber');
  if (rubber.length) rubberStroke(c, () => { c.beginPath(); for (const s of rubber) { c.moveTo(s.a.x, s.a.y); c.lineTo(s.b.x, s.b.y); } }, 5, pal.rubber);
  for (const rp of F.ramps) {
    // wireform: translucent ribbon, two rails, cross ties
    linePath(c, rp.pts); c.strokeStyle = withAlpha(rp.color || pal.accent2, 0.25); c.lineWidth = 14; c.stroke();
    for (const off of [-4, 4]) {
      chromeStroke(c, () => { c.beginPath(); for (let i = 0; i < rp.pts.length; i++) { const p0 = rp.pts[Math.max(0, i - 1)], p1 = rp.pts[Math.min(rp.pts.length - 1, i + 1)]; let nx = -(p1.y - p0.y), ny = p1.x - p0.x; const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l; const q = { x: rp.pts[i].x + nx * off, y: rp.pts[i].y + ny * off }; i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y); } }, 2.2);
    }
    for (let i = 0; i < rp.pts.length; i += 2) { const p0 = rp.pts[Math.max(0, i - 1)], p1 = rp.pts[Math.min(rp.pts.length - 1, i + 1)]; let nx = -(p1.y - p0.y), ny = p1.x - p0.x; const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l; c.beginPath(); c.moveTo(rp.pts[i].x - nx * 5, rp.pts[i].y - ny * 5); c.lineTo(rp.pts[i].x + nx * 5, rp.pts[i].y + ny * 5); c.strokeStyle = '#c9d2dd'; c.lineWidth = 1.5; c.stroke(); }
  }
  for (const s of F.rails) {
    rubberStroke(c, () => { c.beginPath(); c.moveTo(s.a.x, s.a.y); c.lineTo(s.b.x, s.b.y); }, 6, SIGN_COL(s.sign));
    post(c, s.a.x, s.a.y, 4.5, SIGN_COL(s.sign)); post(c, s.b.x, s.b.y, 4.5, SIGN_COL(s.sign));
    printText(c, tierLabel(s.sign, s.tier), (s.a.x + s.b.x) / 2, (s.a.y + s.b.y) / 2 - 14, 13, { fill: SIGN_COL(s.sign) });
  }
  // slingshots / kicker triangles: printed plastic top, rubber band, posts
  for (const t of F.tris) {
    const col = SIGN_COL(t.sign);
    const tri = () => { c.beginPath(); c.moveTo(t.pts[0].x, t.pts[0].y); c.lineTo(t.pts[1].x, t.pts[1].y); c.lineTo(t.pts[2].x, t.pts[2].y); c.closePath(); };
    c.save(); c.translate(3, 5); tri(); c.fillStyle = 'rgba(0,0,0,0.55)'; c.fill(); c.restore();
    tri(); const tg = c.createLinearGradient(t.cx, t.cy - 30, t.cx, t.cy + 30); tg.addColorStop(0, shade(pal.accent, 1.15)); tg.addColorStop(1, shade(pal.accent, 0.5)); c.fillStyle = tg; c.fill();
    c.save(); tri(); c.clip(); drawMotif(c, M.motif, t.cx, t.cy, 16, 'rgba(255,255,255,0.22)'); c.restore();
    rubberStroke(c, tri, 4, pal.rubber);
    for (const p of t.pts) post(c, p.x, p.y, 4.5, pal.rubber);
    printText(c, tierLabel(t.sign, t.tier), t.cx, t.cy, 12, { fill: col });
  }
  for (const p of F.pins) {
    post(c, p.x, p.y, p.r, p.sign ? SIGN_COL(p.sign) : pal.rubber, 0);
    if (p.sign) printText(c, p.sign > 0 ? '+' : '−', p.x, p.y - p.r - 7, 10, { fill: SIGN_COL(p.sign) });
  }
  for (const bp of F.bumpers) {
    if (bp.kind === 'pop') bumperCap(c, bp.x, bp.y, bp.r, bp.sign > 0 ? pal.cap : '#2a2f3a', bp.label, bp.tier, bp.sign, M.motif, bp.sign > 0 ? '#fff' : '#ff8d8d');
    else {
      // reactor / bonus: big cap with a marquee bulb ring
      const col = bp.kind === 'reactor' ? pal.accent2 : pal.accent3;
      bumperCap(c, bp.x, bp.y, bp.r, col, bp.label, bp.tier, bp.sign, M.motif, '#fff');
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 10) { c.beginPath(); c.arc(bp.x + Math.cos(a) * bp.r * 1.3, bp.y + Math.sin(a) * bp.r * 1.3, 2.6, 0, Math.PI * 2); c.fillStyle = '#2a2016'; c.fill(); c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = 1; c.stroke(); }
    }
  }
  c.restore();
}

// ---------------------------------------------------------------------------
// Machine thumbnails for the lobby strip (a real render of the playfield)
// ---------------------------------------------------------------------------
export function renderThumb(spec, w, h, realizeFn) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const c = cv.getContext('2d');
  const F = realizeFn(spec, 26, 22, w - 52, h - 44);
  buildStatic(c, F, w, h, 1);
  return cv.toDataURL('image/png');
}

export function drawBallSprite(ctx, x, y, radius, type, { glow = 10, shadow = true } = {}) {
  if (shadow) { ctx.beginPath(); ctx.ellipse(x + radius * 0.35, y + radius * 0.6, radius * 1.05, radius * 0.8, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fill(); }
  ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2);
  const g = ctx.createRadialGradient(x - radius / 3, y - radius / 3, radius / 5, x, y, radius); g.addColorStop(0, type.hi); g.addColorStop(0.55, type.color); g.addColorStop(1, shade(type.color, 0.55));
  ctx.fillStyle = g; ctx.shadowColor = type.color; ctx.shadowBlur = glow; ctx.fill(); ctx.shadowBlur = 0;
  ctx.beginPath(); ctx.ellipse(x - radius * 0.3, y - radius * 0.42, radius * 0.3, radius * 0.16, -0.5, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fill();
}

export { allowedTypes, BALL_TYPES, dmText, dmWidth, printText, printWidth };
