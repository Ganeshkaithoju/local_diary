/**
 * Generates the installable app icons in public/.
 *
 * Chrome/Edge (desktop + Android WebAPK) and iOS all prefer real PNG icons —
 * an SVG-only manifest installs with a blank or screenshot icon on several
 * platforms. Run with:  bun scripts/generate-icons.mjs
 *
 * Pure pixel math + zlib (no image libraries) so it stays dependency-free.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public");
const SS = 4; // supersampling factor (antialiasing)

/* ----------------------------- PNG encoding ----------------------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1,
    );
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ------------------------------- Painting ------------------------------- */

const hex = (value) => ({
  r: parseInt(value.slice(1, 3), 16),
  g: parseInt(value.slice(3, 5), 16),
  b: parseInt(value.slice(5, 7), 16),
  a: 1,
});

const INK_TOP = hex("#17171f");
const INK_BOTTOM = hex("#08080b");
const GLOW = hex("#4f46e5");
const COVER_TOP = hex("#6f70f7");
const COVER_BOTTOM = hex("#3a3ab0");
const COVER_EDGE = hex("#9a9bfd");
const PAGE = hex("#f6f6fa");
const RULE = hex("#e9e9f2");

class Canvas {
  constructor(size) {
    this.size = size;
    this.px = size * SS;
    this.data = new Uint8ClampedArray(this.px * this.px * 4);
  }

  /** Fill every pixel using (x, y) in normalized 0..1 coordinates. */
  fill(colorAt) {
    for (let y = 0; y < this.px; y++) {
      for (let x = 0; x < this.px; x++) {
        this.blend(x, y, colorAt((x + 0.5) / this.px, (y + 0.5) / this.px));
      }
    }
  }

  fillRect(x0, y0, x1, y1, colorAt) {
    const ax = Math.max(0, Math.floor(x0 * this.px));
    const bx = Math.min(this.px, Math.ceil(x1 * this.px));
    const ay = Math.max(0, Math.floor(y0 * this.px));
    const by = Math.min(this.px, Math.ceil(y1 * this.px));
    for (let y = ay; y < by; y++) {
      for (let x = ax; x < bx; x++) {
        this.blend(x, y, resolve(colorAt, (x + 0.5) / this.px, (y + 0.5) / this.px));
      }
    }
  }

  fillRoundRect(x0, y0, x1, y1, radius, colorAt) {
    const ax = Math.max(0, Math.floor(x0 * this.px));
    const bx = Math.min(this.px, Math.ceil(x1 * this.px));
    const ay = Math.max(0, Math.floor(y0 * this.px));
    const by = Math.min(this.px, Math.ceil(y1 * this.px));
    const r = radius;
    for (let y = ay; y < by; y++) {
      const ny = (y + 0.5) / this.px;
      for (let x = ax; x < bx; x++) {
        const nx = (x + 0.5) / this.px;
        if (nx < x0 || nx > x1 || ny < y0 || ny > y1) continue;
        const cx = Math.min(Math.max(nx, x0 + r), x1 - r);
        const cy = Math.min(Math.max(ny, y0 + r), y1 - r);
        const dx = nx - cx;
        const dy = ny - cy;
        if (dx * dx + dy * dy > r * r) continue;
        this.blend(x, y, resolve(colorAt, nx, ny));
      }
    }
  }

  fillPolygon(points, colorAt) {
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const ax = Math.max(0, Math.floor(Math.min(...xs) * this.px));
    const bx = Math.min(this.px, Math.ceil(Math.max(...xs) * this.px));
    const ay = Math.max(0, Math.floor(Math.min(...ys) * this.px));
    const by = Math.min(this.px, Math.ceil(Math.max(...ys) * this.px));
    for (let y = ay; y < by; y++) {
      const ny = (y + 0.5) / this.px;
      for (let x = ax; x < bx; x++) {
        const nx = (x + 0.5) / this.px;
        if (!inPolygon(points, nx, ny)) continue;
        this.blend(x, y, resolve(colorAt, nx, ny));
      }
    }
  }

  blend(x, y, color) {
    if (!color || color.a <= 0) return;
    const i = (y * this.px + x) * 4;
    const src = this.data;
    if (color.a >= 1) {
      src[i] = color.r;
      src[i + 1] = color.g;
      src[i + 2] = color.b;
      src[i + 3] = 255;
      return;
    }
    const a = color.a;
    src[i] = src[i] * (1 - a) + color.r * a;
    src[i + 1] = src[i + 1] * (1 - a) + color.g * a;
    src[i + 2] = src[i + 2] * (1 - a) + color.b * a;
    src[i + 3] = Math.max(src[i + 3], Math.round(255 * a));
  }

  /** Box-filter the supersampled buffer down to the final size. */
  toRgba() {
    const size = this.size;
    const out = new Uint8ClampedArray(size * size * 4);
    const n = SS * SS;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        for (let sy = 0; sy < SS; sy++) {
          for (let sx = 0; sx < SS; sx++) {
            const i = ((y * SS + sy) * this.px + (x * SS + sx)) * 4;
            r += this.data[i];
            g += this.data[i + 1];
            b += this.data[i + 2];
            a += this.data[i + 3];
          }
        }
        const o = (y * size + x) * 4;
        out[o] = r / n;
        out[o + 1] = g / n;
        out[o + 2] = b / n;
        out[o + 3] = a / n;
      }
    }
    return out;
  }
}

function resolve(colorAt, nx, ny) {
  return typeof colorAt === "function" ? colorAt(nx, ny) : colorAt;
}

function inPolygon(points, x, y) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

const mix = (a, b, t) => ({
  r: a.r + (b.r - a.r) * t,
  g: a.g + (b.g - a.g) * t,
  b: a.b + (b.b - a.b) * t,
  a: 1,
});

/* -------------------------------- The mark -------------------------------- */

/**
 * A diary on a dark card: indigo cover, page edge, and a sheet peeling off the
 * right side (the page turn that defines the reader).
 */
function drawIcon(size, { scale = 1 } = {}) {
  const canvas = new Canvas(size);
  // Background: deep ink with an indigo glow from the top-left.
  canvas.fill((nx, ny) => {
    const base = mix(INK_TOP, INK_BOTTOM, Math.min(1, (nx + ny) / 2));
    const d = Math.hypot(nx - 0.16, ny - 0.1);
    const glow = Math.max(0, 1 - d / 0.85) ** 2 * 0.5;
    return {
      r: base.r + (GLOW.r - base.r) * glow,
      g: base.g + (GLOW.g - base.g) * glow,
      b: base.b + (GLOW.b - base.b) * glow,
      a: 1,
    };
  });

  // Everything below is scaled about the centre so the maskable variant keeps
  // its content inside the 80% safe zone.
  const c = (v) => 0.5 + (v - 0.5) * scale;
  const w = (v) => v * scale;
  const r = (v) => v * scale;

  // Page edge behind the cover.
  canvas.fillRoundRect(c(0.3), c(0.235), c(0.735), c(0.775), r(0.05), PAGE);
  // Cover.
  canvas.fillRoundRect(
    c(0.285),
    c(0.225),
    c(0.705),
    c(0.785),
    r(0.055),
    (nx, ny) => mix(COVER_TOP, COVER_BOTTOM, (ny - c(0.225)) / (c(0.785) - c(0.225))),
  );
  // Spine highlight.
  canvas.fillRoundRect(c(0.313), c(0.27), c(0.327), c(0.74), r(0.007), COVER_EDGE);
  // Ruled lines on the cover.
  for (const [y, len] of [
    [0.40, 0.2],
    [0.48, 0.145],
    [0.56, 0.175],
  ]) {
    canvas.fillRoundRect(
      c(0.365),
      c(y + 0.012 - 0.014),
      c(0.365 + len),
      c(y + 0.012),
      r(0.014),
      { ...RULE, a: 0.92 },
    );
  }
  // Sheet lifting off the right edge.
  canvas.fillPolygon(
    [
      [c(0.705), c(0.285)],
      [c(0.87), c(0.35)],
      [c(0.705), c(0.53)],
    ],
    { ...PAGE, a: 0.97 },
  );

  return canvas.toRgba();
}

/* --------------------------------- Output --------------------------------- */

mkdirSync(OUT, { recursive: true });

const targets = [
  { file: "icon-192.png", size: 192, scale: 1 },
  { file: "icon-512.png", size: 512, scale: 1 },
  { file: "icon-maskable-512.png", size: 512, scale: 0.74 },
  { file: "apple-touch-icon.png", size: 180, scale: 1 },
];

for (const { file, size, scale } of targets) {
  const rgba = drawIcon(size, { scale });
  const png = encodePng(size, size, rgba);
  writeFileSync(join(OUT, file), png);
  console.log(`wrote public/${file} — ${size}x${size}, ${png.length} bytes`);
}
