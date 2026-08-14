// アプリアイコンPNGを依存ゼロで生成する（Pillow等を入れずに済ませるため）。
//   node tools/make-icons.js
// 生成物: icons/apple-touch-icon.png(180) / icon-192.png / icon-512.png
// デザイン: 青のグラデーション地に、白い道路と黄色いセンターライン。

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(ROOT, "icons");

// ---- PNG 書き出し ----
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function writePng(path, size, pixel) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y, size);
      const o = y * stride + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  writeFileSync(
    path,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw, { level: 9 })),
      chunk("IEND", Buffer.alloc(0)),
    ])
  );
}

// ---- デザイン ----
const lerp = (a, b, t) => a + (b - a) * t;

function pixel(x, y, size) {
  const u = x / size;
  const v = y / size;

  // 背景: 上から下へ青のグラデーション
  let r = Math.round(lerp(10, 0, v));
  let g = Math.round(lerp(132, 96, v));
  let b = Math.round(lerp(255, 223, v));

  // 道路（下が広く上が狭い台形）
  const roadTop = 0.24;
  const roadBottom = 0.92;
  if (v >= roadTop && v <= roadBottom) {
    const t = (v - roadTop) / (roadBottom - roadTop);
    const half = lerp(0.075, 0.32, t * t * 0.6 + t * 0.4);
    const d = Math.abs(u - 0.5);
    if (d <= half) {
      r = 255;
      g = 255;
      b = 255;
      // センターライン（黄色の破線）
      const lineHalf = lerp(0.009, 0.032, t);
      const period = 0.16;
      const phase = ((v - roadTop) % period) / period;
      if (d <= lineHalf && phase < 0.55) {
        r = 255;
        g = 200;
        b = 0;
      }
    }
  }
  return [r, g, b, 255];
}

mkdirSync(OUT, { recursive: true });
for (const [name, size] of [
  ["apple-touch-icon.png", 180],
  ["icon-192.png", 192],
  ["icon-512.png", 512],
]) {
  writePng(join(OUT, name), size, pixel);
  console.log(`generated icons/${name} (${size}x${size})`);
}
