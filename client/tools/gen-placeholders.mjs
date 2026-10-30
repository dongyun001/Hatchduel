#!/usr/bin/env node
/* global Buffer, console */
/**
 * 生成占位图（ART_SPEC §8.3：基础尺寸色块 + 1px 描边）。
 *
 * - 宠物战斗精灵 96×96（与最终资源同尺寸，pivot 0.5/0.5）；
 * - 图标 32×32；白色底图 8×8。
 * 文本标签不烘焙进图片，由 UI 用 Label 叠加（中文正文用系统字体，ART_SPEC §1）。
 *
 * 用法：node client/tools/gen-placeholders.mjs
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '..', 'assets', 'resources', 'placeholders');

const BORDER = [0x0a, 0x10, 0x15, 255];

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
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

function hexToRgb(hex) {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** 色块 + 1px 描边 + 中心菱形标记（避免纯色块之间难以区分）。 */
function makeBlock(width, height, hex, mark, border = true) {
  const [r, g, b] = hexToRgb(hex);
  const rgba = Buffer.alloc(width * height * 4);
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const radius = Math.floor(Math.min(width, height) * 0.22);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const isBorder = border && (x === 0 || y === 0 || x === width - 1 || y === height - 1);
      const inMark = mark && Math.abs(x - cx) + Math.abs(y - cy) <= radius;
      if (isBorder) {
        rgba[i] = BORDER[0];
        rgba[i + 1] = BORDER[1];
        rgba[i + 2] = BORDER[2];
        rgba[i + 3] = 255;
      } else if (inMark) {
        rgba[i] = Math.round(r * 0.7);
        rgba[i + 1] = Math.round(g * 0.7);
        rgba[i + 2] = Math.round(b * 0.7);
        rgba[i + 3] = 255;
      } else {
        rgba[i] = r;
        rgba[i + 1] = g;
        rgba[i + 2] = b;
        rgba[i + 3] = 255;
      }
    }
  }
  return encodePng(width, height, rgba);
}

const FILES = [
  { name: 'white', width: 8, height: 8, hex: '#ffffff', mark: false, border: false },
  { name: 'pet_turtle_water_idle', width: 96, height: 96, hex: '#3f8fd2', mark: true },
  { name: 'pet_fish_thunder_idle', width: 96, height: 96, hex: '#e8c547', mark: true },
  { name: 'pet_frog_grass_idle', width: 96, height: 96, hex: '#5aa84f', mark: true },
  { name: 'pet_silhouette', width: 96, height: 96, hex: '#2a3540', mark: true },
  { name: 'portrait_placeholder', width: 256, height: 256, hex: '#24384a', mark: true },
  { name: 'egg_placeholder', width: 48, height: 48, hex: '#e8e2d0', mark: true },
  { name: 'icon_coin', width: 32, height: 32, hex: '#f2c14e', mark: true },
  { name: 'icon_food', width: 32, height: 32, hex: '#d98a4a', mark: true },
  { name: 'icon_gene', width: 32, height: 32, hex: '#b07de0', mark: true },
];

mkdirSync(outDir, { recursive: true });
for (const file of FILES) {
  const png = makeBlock(file.width, file.height, file.hex, file.mark, file.border !== false);
  writeFileSync(join(outDir, `${file.name}.png`), png);
  console.log(`[placeholder] ${file.name}.png ${file.width}x${file.height}`);
}
