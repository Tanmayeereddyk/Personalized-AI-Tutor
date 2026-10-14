/**
 * One-off helper: build a square favicon from the Lumino logo.
 *
 * Pure Node (zlib only) — no image dependencies. It decodes the
 * source PNG, box-average downscales it to fit a square canvas
 * (aspect ratio preserved, letterboxed on black so the bee and
 * wordmark are never cropped), and writes the result as an ICO
 * containing a PNG image (supported by every modern browser).
 */
const fs = require("node:fs");
const zlib = require("node:zlib");

const SRC = "public/logo.png";
const DEST = "public/favicon.ico";
const SIZE = 96;

const buf = fs.readFileSync(SRC);
if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a png");

let offset = 8;
let width = 0;
let height = 0;
let bitDepth = 0;
let colorType = 0;
const idat = [];
while (offset < buf.length) {
  const len = buf.readUInt32BE(offset);
  const type = buf.toString("ascii", offset + 4, offset + 8);
  const data = buf.subarray(offset + 8, offset + 8 + len);
  if (type === "IHDR") {
    width = data.readUInt32BE(0);
    height = data.readUInt32BE(4);
    bitDepth = data[8];
    colorType = data[9];
  } else if (type === "IDAT") {
    idat.push(data);
  } else if (type === "IEND") {
    break;
  }
  offset += 12 + len;
}
if (bitDepth !== 8 || colorType !== 6) {
  throw new Error(`unsupported png: depth=${bitDepth} colorType=${colorType}`);
}

// --- inflate + defilter (filters 0-4) ---
const raw = zlib.inflateSync(Buffer.concat(idat));
const bpp = 4;
const stride = width * bpp;
const pixels = Buffer.alloc(width * height * bpp);

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

let pos = 0;
for (let y = 0; y < height; y++) {
  const filter = raw[pos++];
  const rowStart = y * stride;
  for (let x = 0; x < stride; x++) {
    const rawVal = raw[pos + x];
    const left = x >= bpp ? pixels[rowStart + x - bpp] : 0;
    const up = y > 0 ? pixels[rowStart - stride + x] : 0;
    const upLeft = x >= bpp && y > 0 ? pixels[rowStart - stride + x - bpp] : 0;
    let v;
    switch (filter) {
      case 0: v = rawVal; break;
      case 1: v = rawVal + left; break;
      case 2: v = rawVal + up; break;
      case 3: v = rawVal + Math.floor((left + up) / 2); break;
      case 4: v = rawVal + paeth(left, up, upLeft); break;
      default: throw new Error(`bad filter ${filter}`);
    }
    pixels[rowStart + x] = v & 0xff;
  }
  pos += stride;
}

// --- box-average downscale, letterboxed on black ---
const scale = Math.min(SIZE / width, SIZE / height);
const dw = Math.max(1, Math.round(width * scale));
const dh = Math.max(1, Math.round(height * scale));
const dx = Math.floor((SIZE - dw) / 2);
const dy = Math.floor((SIZE - dh) / 2);

const out = Buffer.alloc(SIZE * SIZE * 4);
out.fill(0);
for (let i = 3; i < out.length; i += 4) out[i] = 0xff;

for (let y = 0; y < dh; y++) {
  for (let x = 0; x < dw; x++) {
    const sx0 = Math.floor(x / scale);
    const sx1 = Math.max(sx0 + 1, Math.floor((x + 1) / scale));
    const sy0 = Math.floor(y / scale);
    const sy1 = Math.max(sy0 + 1, Math.floor((y + 1) / scale));
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let sy = sy0; sy < Math.min(sy1, height); sy++) {
      for (let sx = sx0; sx < Math.min(sx1, width); sx++) {
        const idx = (sy * width + sx) * 4;
        const alpha = pixels[idx + 3] / 255;
        r += pixels[idx] * alpha;
        g += pixels[idx + 1] * alpha;
        b += pixels[idx + 2] * alpha;
        n += alpha;
      }
    }
    const oi = ((dy + y) * SIZE + dx + x) * 4;
    if (n > 0) {
      out[oi] = r / n;
      out[oi + 1] = g / n;
      out[oi + 2] = b / n;
      out[oi + 3] = Math.round((255 * n) / (dw * 0 + (sy1 - sy0) * (sx1 - sx0)) || 255);
    }
  }
}

// --- encode PNG (filter 0 per scanline) ---
function crc32(data) {
  if (!crc32.table) {
    crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crc32.table[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = crc32.table[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

const rawOut = Buffer.alloc(SIZE * (1 + SIZE * 4));
for (let y = 0; y < SIZE; y++) {
  rawOut[y * (1 + SIZE * 4)] = 0;
  out.copy(rawOut, y * (1 + SIZE * 4) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;
ihdr[9] = 6;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(rawOut, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

// --- wrap as ICO (single PNG entry) ---
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);

const entry = Buffer.alloc(16);
entry[0] = SIZE;
entry[1] = SIZE;
entry.writeUInt16LE(1, 4);
entry.writeUInt16LE(32, 6);
entry.writeUInt32LE(png.length, 8);
entry.writeUInt32LE(22, 12);

fs.writeFileSync(DEST, Buffer.concat([header, entry, png]));
console.log(`wrote ${DEST} (${fs.statSync(DEST).size} bytes) — ${SIZE}x${SIZE} from ${width}x${height}`);
