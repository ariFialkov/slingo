#!/usr/bin/env node
// Generates PWA icons (PNG) with no dependencies: draws a 5x5 board with a
// gold tile + slingshot ball into an RGBA buffer and encodes it as PNG.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function makeIcon(size, { pad = 0 } = {}) {
  const img = Buffer.alloc(size * size * 4);
  const put = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    img[i] = r; img[i + 1] = g; img[i + 2] = b; img[i + 3] = a;
  };
  const fillRect = (x0, y0, w, h, r, g, b, a = 255) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) put(x | 0, y | 0, r, g, b, a);
  };
  const fillCircle = (cx, cy, rad, r, g, b) => {
    for (let y = cy - rad; y <= cy + rad; y++)
      for (let x = cx - rad; x <= cx + rad; x++)
        if ((x - cx) ** 2 + (y - cy) ** 2 <= rad * rad) put(x | 0, y | 0, r, g, b);
  };

  // background: rounded dark-navy square with subtle vertical gradient
  const corner = size * 0.16;
  for (let y = 0; y < size; y++) {
    const t = y / size;
    const r = Math.round(13 + 12 * t), g = Math.round(16 + 14 * t), b = Math.round(38 + 30 * t);
    for (let x = 0; x < size; x++) {
      // rounded corners (skip when maskable padding is used — full bleed)
      if (!pad) {
        const dx = Math.max(corner - x, x - (size - 1 - corner), 0);
        const dy = Math.max(corner - y, y - (size - 1 - corner), 0);
        if (dx * dx + dy * dy > corner * corner) { put(x, y, 0, 0, 0, 0); continue; }
      }
      put(x, y, r, g, b);
    }
  }

  // 5x5 tile grid (upper 2/3)
  const inset = size * (0.14 + pad);
  const gridW = size - inset * 2;
  const cell = gridW / 5;
  const tile = cell * 0.82;
  for (let ry = 0; ry < 5; ry++) {
    for (let cx = 0; cx < 5; cx++) {
      const x = inset + cx * cell + (cell - tile) / 2;
      const y = size * (0.1 + pad * 0.7) + ry * cell * 0.62 + (cell * 0.62 - tile * 0.62) / 2;
      const gold = ry === 2 && cx === 2;
      const [r, g, b] = gold ? [255, 214, 90] : [70 + ry * 8, 88 + ry * 8, 170];
      fillRect(x, y, tile, tile * 0.62, r, g, b);
    }
  }

  // slingshot: Y frame + ball at bottom
  const sy = size * (0.86 - pad);
  const sx = size / 2;
  const arm = size * 0.1;
  for (let i = 0; i < size * 0.09; i++) {
    fillRect(sx - size * 0.016, sy - i + size * 0.05, size * 0.032, 1, 122, 77, 42);
  }
  for (let i = 0; i < arm; i++) {
    const t = i / arm;
    fillCircle(sx - t * size * 0.07, sy + size * 0.05 - i, size * 0.014, 122, 77, 42);
    fillCircle(sx + t * size * 0.07, sy + size * 0.05 - i, size * 0.014, 122, 77, 42);
  }
  fillCircle(sx, sy - size * 0.045, size * 0.045, 255, 214, 90);

  return encodePNG(size, img);
}

const outDir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'icon-192.png'), makeIcon(192));
fs.writeFileSync(path.join(outDir, 'icon-512.png'), makeIcon(512));
fs.writeFileSync(path.join(outDir, 'icon-maskable-512.png'), makeIcon(512, { pad: 0.1 }));
console.log('icons written to', outDir);
