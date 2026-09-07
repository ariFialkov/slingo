// Slingo — the nine machines. Each is a hand-built table with its own style,
// palette, risk profile (stars), stake range and signature features, composed
// from the layout kit: pockets of components (a pin field, a spinner maze, twin
// lanes down a curve, a one-way gate into a U-turn kicker, an intersection
// with a hole in the middle) with lanes and pathways running between them.
import { PROFILES, BALL_TYPES, BUYIN_BALLS } from './config.js';
import {
  newSpec, slingshots, pin, bumper, reactor, bonusDisc, rail, hole, kickout, magnet, bank, mover, gate, oneway,
  spinner, label, art, insert, wall, curveWall, curveRamp, pinField, bumperTriangle, dangerZone, spinnerMaze, twinLanes,
  uTurn, intersection, LANE_X,
} from './layout.js';

const V = (du) => du / 1.6;

export const MACHINES = [
  {
    id: 'rookie', name: 'ROOKIE ROAD', sub: 'DINER DASH', stars: 1, profile: 'safe', stakes: [1, 5], motif: 'star', cabinet: { notch: null },
    palette: { wood: ['#6b2f12', '#a8562a'], field: ['#f4e7c6', '#e8d3a2'], ink: '#1f3a4d', accent: '#d62839', accent2: '#2ec4b6', accent3: '#ffb703', rubber: '#d62839', insert: '#ffb703', cap: '#d62839', title: ['#ffffff', '#2ec4b6'] },
    signature: 'ROUTE 66 twin lanes · BLUE PLATE reactor',
    build(s) {
      art(s, { kind: 'road', u: 0.42, v: 0.06, w: 0.16, h: 0.9 });
      s.art.unshift({ kind: 'rays', u: 0.2, v: 0.14, colors: ['#f4e7c6', '#b9ddd3'], n: 22 });
      art(s, { kind: 'bigmotif', motif: 'star', u: 0.5, v: 0.6, R: 0.12, color: '#d62839', alpha: 0.55 });
      art(s, { kind: 'ribbon', text: 'ROUTE 66', u: 0.12, v: 0.24, size: 0.028, color: '#1f3a4d', ink: '#f4e7c6' });
      art(s, { kind: 'speedlines', u: 0.6, v: 0.5, w: 0.26, h: 0.12, color: '#2ec4b6', n: 5, dir: -1 });
      art(s, { kind: 'checker', u: 0.02, v: 0.83, w: 0.3, h: 0.03, angle: 0.45, colors: ['#1f3a4d', '#f4e7c6'] });
      art(s, { kind: 'checker', u: 0.6, v: 0.83, w: 0.3, h: 0.03, angle: -0.45, colors: ['#1f3a4d', '#f4e7c6'] });
      art(s, { kind: 'burst', u: 0.2, v: 0.12, R: 0.16, color: '#2ec4b6', alpha: 0.35 });
      art(s, { kind: 'burst', u: 0.8, v: 0.8, R: 0.12, color: '#ffb703', alpha: 0.3 });
      art(s, { kind: 'stars', u: 0.6, v: 0.1, w: 0.3, h: 0.16, color: '#d62839', n: 7 });
      slingshots(s);
      bumperTriangle(s, 0.56, 0.2, 0.042, 0.135, [+1, +1, -1], ['POP', 'POP', 'FLAT']);
      twinLanes(s, { v0: 0.28, v1: 0.56, gates: ['boost', 'brake'], labels: ['RT 66', 'DETOUR'] });
      pinField(s, { u: 0.34, v: 0.36, cols: 5, rows: 3, pitch: 0.09, plus: 0.5, minus: 0.15 });
      label(s, 0.52, 0.33, 'JUKEBOX', 0.022);
      reactor(s, 0.5, 0.6, 'BLUE PLATE', 0.052);
      hole(s, 0.79, 0.5, 'hole', 'MILKSHAKE');
      spinner(s, 0.8, 0.28, -0.4, 'SPIN');
      kickout(s, 0.13, 0.19, 0.3, 0.64, [0.7, -0.7], 'DRIVE-THRU');
      pin(s, 0.24, 0.66, -1); pin(s, 0.74, 0.62, -1);
      for (let i = 0; i < 5; i++) insert(s, 0.5, 0.7 + i * 0.03, 'arrow', '#ffb703', Math.PI);
    },
  },
  {
    id: 'surf', name: "SURF'S UP", sub: 'ENDLESS SUMMER', stars: 2, profile: 'marathon', stakes: [1, 10], motif: 'wave',
    palette: { wood: ['#3b2a1a', '#7a5233'], field: ['#0b5f9e', '#053a66'], ink: '#fff4d6', accent: '#ff8c42', accent2: '#5ee1ff', accent3: '#ffe66d', rubber: '#ff8c42', insert: '#5ee1ff', cap: '#ff8c42', title: ['#ffe66d', '#ff8c42'] },
    signature: 'BIG WAVE ramp · RIP TIDE kickout · THE BARREL',
    build(s) {
      art(s, { kind: 'halftone', u: 0.02, v: 0.02, w: 0.96, h: 0.35, color: '#ff8c42', alpha: 0.25 });
      s.art.unshift({ kind: 'rays', u: 0.2, v: 0.14, colors: ['#0b5f9e', '#1478bd'], n: 20 });
      art(s, { kind: 'bigmotif', motif: 'wave', u: 0.5, v: 0.34, R: 0.16, color: '#5ee1ff', alpha: 0.5 });
      art(s, { kind: 'ribbon', text: 'HANG TEN', u: 0.7, v: 0.42, size: 0.026, color: '#ff8c42', ink: '#fff4d6', angle: -0.15 });
      art(s, { kind: 'burst', u: 0.2, v: 0.14, R: 0.2, color: '#ffe66d', alpha: 0.35 });
      art(s, { kind: 'waves', u: 0.02, v: 0.8, w: 0.88, h: 0.16, colors: ['#5ee1ff', '#ffffff'] });
      art(s, { kind: 'waves', u: 0.02, v: 0.52, w: 0.88, h: 0.1, colors: ['#5ee1ff', '#0b5f9e'], alpha: 0.4 });
      slingshots(s);
      curveRamp(s, [0.08, 0.55], [0.3, 0.16], [0.52, 0.46], '#5ee1ff');
      label(s, 0.28, 0.26, 'BIG WAVE', 0.024, { chrome: true });
      spinnerMaze(s, { u: 0.36, v: 0.5, n: 2, dx: 0.11, dy: 0.07, angle: 0.45 });
      label(s, 0.42, 0.44, 'THE BARREL', 0.02);
      bumperTriangle(s, 0.7, 0.24, 0.042, 0.135, [+1, +1, -1], ['SWELL', 'SWELL', 'CHOP']);
      kickout(s, 0.76, 0.5, 0.6, 0.12, [-0.6, 0.8], 'RIP TIDE');
      pinField(s, { u: 0.18, v: 0.64, cols: 4, rows: 2, pitch: 0.08, plus: 0.5, minus: 0.25 });
      label(s, 0.3, 0.61, 'THE REEF', 0.02);
      reactor(s, 0.64, 0.64, 'TUBE', 0.054);
      hole(s, 0.16, 0.5, 'basket', 'SHARK');
      magnet(s, 0.8, 0.36, -1, 'UNDERTOW');
      for (let i = 0; i < 4; i++) insert(s, 0.16 + i * 0.05, 0.16, 'dot', '#5ee1ff');
    },
  },
  {
    id: 'roadhouse', name: 'ROADHOUSE', sub: 'ROCK & ROLL ALL NIGHT', stars: 2, profile: 'moderate', stakes: [1, 10], motif: 'note',
    palette: { wood: ['#2a1a10', '#5c3a22'], field: ['#1a1a1a', '#0a0a0a'], ink: '#fff1c1', accent: '#ff3b1f', accent2: '#ffd400', accent3: '#ffffff', rubber: '#ffd400', insert: '#ff3b1f', cap: '#ff3b1f', title: ['#ffd400', '#ff3b1f'] },
    signature: 'AMP STACK · VOLUME targets · BACKSTAGE kickout',
    build(s) {
      art(s, { kind: 'flames', u: 0.02, v: 0.98, w: 0.88, h: 0.34, colors: ['#ff3b1f', '#ffd400', '#fff1c1'] });
      s.art.unshift({ kind: 'rays', u: 0.5, v: 0.2, colors: ['#1a1a1a', '#2a2410'], n: 24 });
      art(s, { kind: 'bigmotif', motif: 'note', u: 0.24, v: 0.66, R: 0.09, color: '#ffd400', alpha: 0.7 });
      art(s, { kind: 'ribbon', text: 'LIVE TONITE', u: 0.5, v: 0.36, size: 0.026, color: '#ff3b1f', ink: '#fff1c1', angle: -0.08 });
      art(s, { kind: 'speedlines', u: 0.62, v: 0.36, w: 0.22, h: 0.1, color: '#ffd400', n: 4, dir: -1 });
      art(s, { kind: 'checker', u: 0.02, v: 0.09, w: 0.24, h: 0.025, angle: 0, colors: ['#ffffff', '#1a1a1a'] });
      art(s, { kind: 'text', u: 0.52, v: 0.44, text: 'ROCK', size: 0.16, color: '#ff3b1f', alpha: 0.18, angle: -0.35 });
      art(s, { kind: 'bolts', u: 0.62, v: 0.5, w: 0.2, h: 0.2, color: '#ffd400', n: 3 });
      slingshots(s);
      bumperTriangle(s, 0.5, 0.2, 0.044, 0.14, [+1, +1, -1], ['AMP', 'AMP', 'HUM']);
      label(s, 0.5, 0.31, 'AMP STACK', 0.022, { chrome: true });
      bank(s, 0.24, 0.3, -0.3, 'VOLUME');
      kickout(s, 0.8, 0.44, 0.24, 0.56, [0.7, 0.7], 'BACKSTAGE');
      magnet(s, 0.62, 0.42, +1, 'PICKUP');
      spinnerMaze(s, { u: 0.3, v: 0.44, n: 3, dx: 0.11, dy: 0.07, angle: 0.45 });
      label(s, 0.36, 0.4, 'MOSH PIT', 0.02);
      dangerZone(s, 0.68, 0.62, 'FEEDBACK');
      reactor(s, 0.5, 0.74, 'ENCORE', 0.05);
      pinField(s, { u: 0.1, v: 0.5, cols: 2, rows: 2, pitch: 0.075, plus: 0.5, minus: 0.5 });
      hole(s, 0.14, 0.64, 'hole', 'GREEN ROOM');
      for (let i = 0; i < 3; i++) insert(s, 0.14 + i * 0.045, 0.18, 'dot', '#ff3b1f');
    },
  },
  {
    id: 'circuit', name: 'CIRCUIT BREAKER', sub: 'HIGH VOLTAGE', stars: 3, profile: 'bonus', stakes: [5, 25], motif: 'bolt',
    palette: { wood: ['#1c2430', '#3a4a5c'], field: ['#0a2a2a', '#03151a'], ink: '#d9fff7', accent: '#ffe600', accent2: '#00e5ff', accent3: '#ff2e88', rubber: '#ffe600', insert: '#00e5ff', cap: '#ffe600', title: ['#00e5ff', '#ffe600'] },
    signature: 'THE JOLT U-turn kicker · TESLA magnets · FUSES',
    build(s) {
      art(s, { kind: 'circuit', u: 0.02, v: 0.02, w: 0.88, h: 0.96, color: '#00e5ff', alpha: 0.22 });
      s.art.unshift({ kind: 'rays', u: 0.5, v: 0.55, colors: ['#0a2a2a', '#0e3838'], n: 16 });
      art(s, { kind: 'dots', u: 0.02, v: 0.02, w: 0.88, h: 0.96, color: '#00e5ff', alpha: 0.18 });
      art(s, { kind: 'bigmotif', motif: 'bolt', u: 0.16, v: 0.4, R: 0.08, color: '#ffe600', alpha: 0.8 });
      art(s, { kind: 'ribbon', text: '10,000 VOLTS', u: 0.5, v: 0.34, size: 0.024, color: '#ffe600', ink: '#111' });
      art(s, { kind: 'hazard', u: 0.36, v: 0.13, w: 0.22, h: 0.02 });
      art(s, { kind: 'bolts', u: 0.1, v: 0.6, w: 0.16, h: 0.16, color: '#ffe600', n: 2 });
      art(s, { kind: 'bolts', u: 0.7, v: 0.66, w: 0.16, h: 0.14, color: '#ffe600', n: 2 });
      slingshots(s);
      spinnerMaze(s, { u: 0.16, v: 0.18, n: 2, dx: 0.11, dy: 0.07, angle: 0.45 });
      label(s, 0.2, 0.13, 'SHORT CIRCUIT', 0.018);
      dangerZone(s, 0.47, 0.2, 'SURGE');
      bank(s, 0.7, 0.16, 0, 'FUSES');
      magnet(s, 0.3, 0.36, +1, 'TESLA +'); magnet(s, 0.64, 0.36, -1, 'TESLA −');
      uTurn(s, { u: 0.5, v: 0.6, R: 0.14, gap: 0.07, armTop: 0.42, entry: 'right', label: 'THE JOLT' });
      bonusDisc(s, 0.15, 0.52, 'BONUS'); bonusDisc(s, 0.8, 0.5, 'BONUS');
      hole(s, 0.2, 0.7, 'hole', 'GROUND');
      pin(s, 0.8, 0.3, -1); pin(s, 0.86, 0.6, +1);
      for (let i = 0; i < 4; i++) insert(s, 0.72 + i * 0.04, 0.6 + i * 0.015, 'arrow', '#00e5ff', Math.PI * 0.75);
    },
  },
  {
    id: 'grandprix', name: 'GRAND PRIX', sub: 'FULL THROTTLE', stars: 3, profile: 'moderate', stakes: [5, 25], motif: 'flag', cabinet: { notch: null },
    palette: { wood: ['#2b0d0d', '#6b1f1f'], field: ['#3a3f47', '#1c1f25'], ink: '#ffffff', accent: '#e10600', accent2: '#ffffff', accent3: '#ffcc00', rubber: '#e10600', insert: '#ffcc00', cap: '#e10600', title: ['#ffffff', '#e10600'] },
    signature: 'PIT LANES both sides · CHICANE · PACE CAR',
    build(s) {
      art(s, { kind: 'road', u: 0.36, v: 0.06, w: 0.28, h: 0.9, curve: true });
      s.art.unshift({ kind: 'rays', u: 0.5, v: 0.12, colors: ['#3a3f47', '#4a5059'], n: 20 });
      art(s, { kind: 'bigmotif', motif: 'flag', u: 0.5, v: 0.42, R: 0.07, color: '#ffffff', alpha: 0.6 });
      art(s, { kind: 'ribbon', text: 'FINAL LAP', u: 0.5, v: 0.55, size: 0.024, color: '#e10600', ink: '#fff' });
      art(s, { kind: 'speedlines', u: 0.06, v: 0.62, w: 0.2, h: 0.1, color: '#ffffff', n: 4, dir: 1 });
      art(s, { kind: 'checker', u: 0.02, v: 0.06, w: 0.18, h: 0.03, angle: 0, colors: ['#ffffff', '#1c1f25'] });
      art(s, { kind: 'checker', u: 0.3, v: 0.83, w: 0.4, h: 0.03, angle: 0, colors: ['#ffffff', '#1c1f25'] });
      art(s, { kind: 'stripes', u: 0.02, v: 0.6, w: 0.88, h: 0.2, colors: ['#e10600', '#ffffff'], alpha: 0.25 });
      slingshots(s);
      mover(s, 0.5, 0.19, 0, 0.08, +1, 2.6, 'PACE CAR');
      twinLanes(s, { v0: 0.26, v1: 0.54, side: 'left', gates: ['boost', 'brake'], labels: ['PIT IN', 'PIT OUT'] });
      twinLanes(s, { v0: 0.32, v1: 0.58, side: 'right', gates: ['boost', 'warp'], labels: ['SLIPSTREAM', 'TUNNEL'] });
      rail(s, [0.36, 0.3], [0.5, 0.36], +1);
      rail(s, [0.64, 0.44], [0.5, 0.5], -1);
      rail(s, [0.36, 0.58], [0.5, 0.64], +1);
      label(s, 0.5, 0.27, 'CHICANE', 0.02, { chrome: true });
      hole(s, 0.29, 0.44, 'hole', 'PIT STOP');
      reactor(s, 0.5, 0.75, 'PODIUM', 0.05);
      pinField(s, { u: 0.25, v: 0.65, cols: 2, rows: 1, pitch: 0.07, plus: 0, minus: 1 });
      pinField(s, { u: 0.66, v: 0.65, cols: 2, rows: 1, pitch: 0.07, plus: 0, minus: 1 });
      label(s, 0.28, 0.61, 'GRAVEL', 0.018); label(s, 0.69, 0.61, 'GRAVEL', 0.018);
      gate(s, 0.7, 0.28, 0.4, 'warp', 'TUNNEL');
      for (let i = 0; i < 6; i++) insert(s, 0.5, 0.4 + i * 0.05, 'arrow', '#ffcc00', 0);
    },
  },
  {
    id: 'space', name: 'DEEP SPACE', sub: 'BEYOND THE STARS', stars: 3, profile: 'volatile', stakes: [10, 25], motif: 'planet',
    palette: { wood: ['#12081f', '#2d1a4a'], field: ['#150b2e', '#05030f'], ink: '#e9e4ff', accent: '#ff3cac', accent2: '#2ef2ff', accent3: '#ffd166', rubber: '#ff3cac', insert: '#2ef2ff', cap: '#7b2cff', title: ['#2ef2ff', '#ff3cac'] },
    signature: 'BLACK HOLE intersection · WORMHOLE warp · GRAVITY WELL',
    build(s) {
      art(s, { kind: 'stars', u: 0.02, v: 0.02, w: 0.88, h: 0.96, color: '#ffffff', n: 60 });
      s.art.unshift({ kind: 'rays', u: 0.5, v: 0.5, colors: ['#150b2e', '#1e1040'], n: 24 });
      art(s, { kind: 'ribbon', text: 'WARP 9', u: 0.5, v: 0.34, size: 0.024, color: '#ff3cac', ink: '#fff' });
      art(s, { kind: 'bigmotif', motif: 'planet', u: 0.8, v: 0.68, R: 0.06, color: '#2ef2ff', alpha: 0.8 });
      art(s, { kind: 'halftone', u: 0.5, v: 0.3, w: 0.4, h: 0.5, color: '#ff3cac', alpha: 0.2 });
      art(s, { kind: 'planet', u: 0.5, v: 0.5, R: 0.2, colors: ['#7b2cff', '#2ef2ff'] });
      art(s, { kind: 'comet', u: 0.14, v: 0.1, w: 0.3, h: 0.1, color: '#2ef2ff' });
      slingshots(s);
      bumperTriangle(s, 0.5, 0.2, 0.042, 0.135, [+1, +1, +1], ['NOVA', 'NOVA', 'NOVA']);
      intersection(s, { u: 0.5, v: 0.5, kind: 'hole', label: 'BLACK HOLE' });
      gate(s, 0.16, 0.28, -0.3, 'warp', 'WORMHOLE A');
      gate(s, 0.78, 0.44, 0.3, 'warp', 'WORMHOLE B');
      magnet(s, 0.3, 0.68, +1, 'GRAVITY +'); magnet(s, 0.72, 0.3, -1, 'GRAVITY −');
      pinField(s, { u: 0.6, v: 0.6, cols: 3, rows: 2, pitch: 0.075, plus: 0.4, minus: 0.3 });
      label(s, 0.68, 0.56, 'ASTEROIDS', 0.018);
      mover(s, 0.24, 0.5, 0.5, 0.06, -1, 3.0, 'SATELLITE');
      kickout(s, 0.13, 0.62, 0.3, 0.16, [0.7, 0.7], 'LAUNCH PAD');
      for (let i = 0; i < 5; i++) insert(s, 0.36 + i * 0.07, 0.36, 'dot', '#2ef2ff');
    },
  },
  {
    id: 'castle', name: 'CASTLE SIEGE', sub: 'STORM THE KEEP', stars: 4, profile: 'volatile', stakes: [10, 100], motif: 'crown',
    palette: { wood: ['#2a1d12', '#5e4530'], field: ['#4a4f5a', '#23262d'], ink: '#f5e6c8', accent: '#c1121f', accent2: '#ffc300', accent3: '#3a86ff', rubber: '#c1121f', insert: '#ffc300', cap: '#3a86ff', title: ['#ffc300', '#c1121f'] },
    signature: 'PORTCULLIS · MOAT · DUNGEON kickout',
    build(s) {
      art(s, { kind: 'bricks', u: 0.02, v: 0.02, w: 0.88, h: 0.96, color: '#23262d', alpha: 0.5 });
      s.art.unshift({ kind: 'rays', u: 0.5, v: 0.45, colors: ['#4a4f5a', '#555b67'], n: 16 });
      art(s, { kind: 'bigmotif', motif: 'crown', u: 0.5, v: 0.32, R: 0.08, color: '#ffc300', alpha: 0.75 });
      art(s, { kind: 'ribbon', text: 'HOLD THE LINE', u: 0.5, v: 0.535, size: 0.022, color: '#c1121f', ink: '#f5e6c8' });
      art(s, { kind: 'crenels', u: 0.02, v: 0.085, w: 0.7, h: 0.04, color: '#f5e6c8' });
      art(s, { kind: 'banner', u: 0.12, v: 0.14, w: 0.06, h: 0.14, color: '#c1121f' });
      art(s, { kind: 'banner', u: 0.62, v: 0.14, w: 0.06, h: 0.14, color: '#3a86ff' });
      art(s, { kind: 'waves', u: 0.02, v: 0.66, w: 0.88, h: 0.08, colors: ['#3a86ff', '#0b5f9e'], alpha: 0.5 });
      slingshots(s);
      bank(s, 0.5, 0.22, 0, 'PORTCULLIS');
      kickout(s, 0.13, 0.3, 0.7, 0.34, [-0.5, 0.85], 'DUNGEON');
      rail(s, [0.16, 0.46], [0.26, 0.53], -1);
      rail(s, [0.74, 0.46], [0.64, 0.53], -1);
      label(s, 0.21, 0.42, 'ARROW SLIT', 0.016); label(s, 0.69, 0.42, 'ARROW SLIT', 0.016);
      reactor(s, 0.5, 0.45, 'THE KEEP', 0.055);
      oneway(s, 0.5, 0.58, 0, 'DRAWBRIDGE');
      pinField(s, { u: 0.2, v: 0.68, cols: 7, rows: 1, pitch: 0.085, plus: 0, minus: 1, r: 0.012 });
      label(s, 0.5, 0.65, 'THE MOAT', 0.02);
      dangerZone(s, 0.5, 0.79, 'TRAP DOOR');
      bumper(s, 0.8, 0.28, 0.038, +1, 'TOWER');
      hole(s, 0.82, 0.58, 'hole', 'OUBLIETTE');
      for (let i = 0; i < 4; i++) insert(s, 0.32 + i * 0.12, 0.34, 'shield', '#ffc300');
    },
  },
  {
    id: 'inferno', name: 'INFERNO PEAK', sub: 'INTO THE VOLCANO', stars: 5, profile: 'extreme', stakes: [25, 100], motif: 'flame',
    palette: { wood: ['#1a0a05', '#4a1f0d'], field: ['#2b0a05', '#0d0402'], ink: '#ffe3c2', accent: '#ff6a00', accent2: '#ffd000', accent3: '#ff1f1f', rubber: '#ff6a00', insert: '#ffd000', cap: '#ff1f1f', title: ['#ffd000', '#ff1f1f'] },
    signature: 'LAVA FLOW maze · MAGMA danger zone · ERUPTION',
    build(s) {
      art(s, { kind: 'mountain', u: 0.14, v: 0.28, w: 0.7, h: 0.22, color: '#0d0402' });
      s.art.unshift({ kind: 'rays', u: 0.42, v: 0.2, colors: ['#2b0a05', '#4a1206'], n: 22 });
      art(s, { kind: 'bigmotif', motif: 'flame', u: 0.5, v: 0.76, R: 0.1, color: '#ff6a00', alpha: 0.8 });
      art(s, { kind: 'ribbon', text: '3000°', u: 0.82, v: 0.42, size: 0.024, color: '#ff1f1f', ink: '#ffe3c2' });
      art(s, { kind: 'lava', u: 0.02, v: 0.02, w: 0.88, h: 0.96, color: '#ff6a00', alpha: 0.5 });
      art(s, { kind: 'flames', u: 0.02, v: 0.98, w: 0.88, h: 0.4, colors: ['#ff1f1f', '#ff6a00', '#ffd000'] });
      art(s, { kind: 'halftone', u: 0.02, v: 0.02, w: 0.88, h: 0.3, color: '#ffd000', alpha: 0.18 });
      slingshots(s);
      reactor(s, 0.36, 0.2, 'SUMMIT', 0.054);
      spinnerMaze(s, { u: 0.14, v: 0.32, n: 3, dx: 0.11, dy: 0.07, angle: 0.45 });
      label(s, 0.2, 0.27, 'LAVA FLOW', 0.02);
      art(s, { kind: 'hazard', u: 0.5, v: 0.4, w: 0.24, h: 0.02 });
      bumperTriangle(s, 0.64, 0.3, 0.042, 0.135, [-1, -1, -1], ['MAGMA', 'MAGMA', 'MAGMA']);
      label(s, 0.64, 0.42, 'DANGER', 0.02, { color: '#ff1f1f' });
      hole(s, 0.5, 0.46, 'hole', 'CALDERA');
      kickout(s, 0.5, 0.6, 0.42, 0.16, [0.3, -0.9], 'ERUPTION');
      magnet(s, 0.24, 0.56, -1, 'ASH');
      pinField(s, { u: 0.68, v: 0.52, cols: 2, rows: 2, pitch: 0.08, plus: 0.2, minus: 0.8 });
      label(s, 0.72, 0.48, 'CINDERS', 0.018);
      bumper(s, 0.78, 0.68, 0.036, +1, 'VENT');
      for (let i = 0; i < 4; i++) insert(s, 0.5, 0.68 + i * 0.03, 'flame', '#ffd000');
    },
  },
  {
    id: 'vegas', name: 'VEGAS ROYALE', sub: 'LUCKY SEVENS', stars: 5, profile: 'lucky', stakes: [25, 100], motif: 'seven',
    palette: { wood: ['#2a0a12', '#6b1a2e'], field: ['#0c0c14', '#050508'], ink: '#fff2c4', accent: '#e63946', accent2: '#ffd700', accent3: '#ffffff', rubber: '#ffd700', insert: '#ffd700', cap: '#e63946', title: ['#ffd700', '#ffffff'] },
    signature: 'JACKPOT reactor · 777 · ROULETTE intersection',
    build(s) {
      art(s, { kind: 'curtain', u: 0.02, v: 0.02, w: 0.1, h: 0.96, color: '#e63946' });
      art(s, { kind: 'curtain', u: 0.8, v: 0.28, w: 0.1, h: 0.55, color: '#e63946' });
      art(s, { kind: 'cards', u: 0.16, v: 0.06, w: 0.62, h: 0.9, color: '#ffffff', alpha: 0.12, n: 14 });
      s.art.unshift({ kind: 'rays', u: 0.5, v: 0.42, colors: ['#0c0c14', '#2a2208'], n: 24 });
      art(s, { kind: 'bigmotif', motif: 'seven', u: 0.5, v: 0.55, R: 0.09, color: '#e63946', alpha: 0.7 });
      art(s, { kind: 'ribbon', text: 'WIN BIG', u: 0.5, v: 0.32, size: 0.024, color: '#ffd700', ink: '#111' });
      art(s, { kind: 'marquee', u: 0.2, v: 0.06, w: 0.5, h: 0.09, color: '#ffd700' });
      slingshots(s);
      bumperTriangle(s, 0.5, 0.21, 0.042, 0.135, [+1, +1, +1], ['7', '7', '7']);
      bank(s, 0.2, 0.32, -0.4, 'BAR BAR BAR');
      kickout(s, 0.78, 0.22, 0.2, 0.2, [0.6, 0.8], 'CHERRY');
      reactor(s, 0.5, 0.42, 'JACKPOT', 0.06);
      intersection(s, { u: 0.5, v: 0.66, kind: 'hole', label: 'ROULETTE', d1: 0.065, d2: 0.13 });
      mover(s, 0.78, 0.44, 1.2, 0.07, -1, 2.8, 'DEALER');
      pinField(s, { u: 0.14, v: 0.5, cols: 2, rows: 2, pitch: 0.075, plus: 0.5, minus: 0.5 });
      label(s, 0.18, 0.46, 'DICE', 0.018);
      pin(s, 0.3, 0.6, +1); pin(s, 0.7, 0.62, -1);
      hole(s, 0.8, 0.64, 'basket', 'PAYOUT');
      for (let i = 0; i < 6; i++) insert(s, 0.3 + i * 0.08, 0.3, 'dot', i % 2 ? '#ffd700' : '#e63946');
    },
  },
];

export const machineProfile = (m) => PROFILES[m.profile];
export const buyIn = (m) => m.stakes[0] * BUYIN_BALLS;
export const allowedTypes = (m) => BALL_TYPES.filter((t) => t.bet >= m.stakes[0] && t.bet <= m.stakes[1]);

// Build a machine's spec (pure; safe to call repeatedly).
export function buildMachine(m) {
  const s = newSpec(m);
  s.machine = m;
  s.palette = m.palette;
  s.profile = machineProfile(m);
  s.labels.push({ u: 0.44, v: 0.07, text: m.name, size: 0.05, title: true });
  s.labels.push({ u: 0.44, v: 0.115, text: m.sub, size: 0.018, sub: true });
  m.build(s);
  // twin warp gates pair up by order
  const warps = s.gates.filter((g) => g.kind === 'warp');
  for (let i = 0; i + 1 < warps.length; i += 2) { warps[i].twin = s.gates.indexOf(warps[i + 1]); warps[i + 1].twin = s.gates.indexOf(warps[i]); }
  if (warps.length % 2) warps[warps.length - 1].kind = 'boost';
  return s;
}

export const _kit = { V, LANE_X, wall, curveWall, pinField, bumper, spinner, mover, magnet, hole, rail, kickout, uTurn, twinLanes };
