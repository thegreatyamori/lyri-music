#!/usr/bin/env node
/**
 * Generates the extension icons.
 *
 * Hand-rolled rather than taken from a design tool: the icon must not resemble
 * YouTube's or Google's marks, and a generated one is trivially reproducible
 * and free of any third-party asset. Committed output lives in `public/icons`.
 *
 * The mark is three lines of text with the middle one lit — the same idea the
 * Overlay draws while a track plays.
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = fileURLToPath(new URL('../public/icons', import.meta.url));
const SIZES = [16, 32, 48, 128];
/** Rendered at this multiple and box-downsampled, which is the cheap way to
 *  get smooth edges without a rasteriser. */
const SUPERSAMPLE = 4;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, rgba) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function insideRoundedRect(px, py, x, y, w, h, r) {
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}

/** Unit coordinates in [0,1] so one description serves every size. */
const BARS = [
  { y: 0.355, width: 0.60, alpha: 0.52 },
  { y: 0.495, width: 0.44, alpha: 0.97 },
  { y: 0.635, width: 0.54, alpha: 0.52 },
];
const BAR_X = 0.20;
const BAR_HEIGHT = 0.088;

function sample(u, v) {
  if (!insideRoundedRect(u, v, 0, 0, 1, 1, 0.22)) return [0, 0, 0, 0];

  // Diagonal indigo → violet.
  const t = (u + v) / 2;
  let r = Math.round(99 + (139 - 99) * t);
  let g = Math.round(102 + (92 - 102) * t);
  let b = Math.round(241 + (246 - 241) * t);
  let a = 255;

  for (const bar of BARS) {
    const radius = BAR_HEIGHT / 2;
    if (insideRoundedRect(u, v, BAR_X, bar.y, bar.width, BAR_HEIGHT, radius)) {
      r = Math.round(r * (1 - bar.alpha) + 255 * bar.alpha);
      g = Math.round(g * (1 - bar.alpha) + 255 * bar.alpha);
      b = Math.round(b * (1 - bar.alpha) + 255 * bar.alpha);
    }
  }

  return [r, g, b, a];
}

function render(size) {
  const hi = size * SUPERSAMPLE;
  const out = Buffer.alloc(size * size * 4);
  const samples = SUPERSAMPLE * SUPERSAMPLE;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const [sr, sg, sb, sa] = sample((x * SUPERSAMPLE + sx + 0.5) / hi, (y * SUPERSAMPLE + sy + 0.5) / hi);
          r += sr;
          g += sg;
          b += sb;
          a += sa;
        }
      }

      const offset = (y * size + x) * 4;
      out[offset] = Math.round(r / samples);
      out[offset + 1] = Math.round(g / samples);
      out[offset + 2] = Math.round(b / samples);
      out[offset + 3] = Math.round(a / samples);
    }
  }

  return out;
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = join(OUT_DIR, `${size}.png`);
  writeFileSync(file, encodePng(size, render(size)));
  console.log(`wrote ${file}`);
}
