'use strict';

/**
 * Генератор иконки приложения без внешних зависимостей.
 * Рисует «радар» с сектором обзора и сохраняет PNG 512x512 в assets/icon.png.
 *
 * Запуск: npm run icon
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 512;

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function buildPixels() {
  const pixels = Buffer.alloc(SIZE * SIZE * 4);
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const radius = SIZE * 0.47;

  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy) / radius;
      const angle = Math.atan2(dy, dx); // -PI..PI, 0 = вправо

      let r = 10;
      let g = 16;
      let b = 24;
      let a = 255;

      // Скруглённый квадрат-подложка
      const half = SIZE / 2 - 8;
      const corner = 108;
      const qx = Math.abs(dx);
      const qy = Math.abs(dy);
      const outside = Math.max(
        Math.max(qx - half + corner, 0) ** 2 + Math.max(qy - half + corner, 0) ** 2 > corner ** 2,
        qx > half || qy > half,
      );

      if (outside) {
        a = 0;
      } else {
        // фон: вертикальный градиент
        const t = y / SIZE;
        r = lerp(14, 8, t);
        g = lerp(26, 14, t);
        b = lerp(38, 22, t);
        if (!outside && (qx > half - 1.2 || qy > half - 1.2)) {
          // тонкая рамка
          r = 32; g = 54; b = 74;
        }

        if (dist < 1) {
          // Сектор обзора радара: от -60° до 0°
          const sweep = angle > -Math.PI / 1.6 && angle < 0;
          if (sweep) {
            const strength = (1 - dist) * (1 + angle / (Math.PI / 1.6)) * 0.55;
            r = lerp(r, 36, Math.min(1, strength));
            g = lerp(g, 211, Math.min(1, strength));
            b = lerp(b, 162, Math.min(1, strength));
          }

          // кольца
          for (const ring of [0.34, 0.62, 0.9]) {
            const delta = Math.abs(dist - ring) * SIZE * 0.5;
            if (delta < 2.4) {
              const k = 1 - delta / 2.4;
              r = lerp(r, 40, k * 0.55);
              g = lerp(g, 170, k * 0.55);
              b = lerp(b, 140, k * 0.55);
            }
          }

          // луч
          const beam = Math.abs(angle) * dist * SIZE * 0.5;
          if (beam < 3 && dist < 0.92) {
            r = lerp(r, 60, 0.6);
            g = lerp(g, 235, 0.6);
            b = lerp(b, 190, 0.6);
          }

          // центральная точка
          if (dist < 0.075) {
            r = 36; g = 211; b = 162;
          }

          // «найденное объявление»
          const markerX = 0.44;
          const markerY = -0.42;
          const markerDist = Math.hypot(dx / radius - markerX, dy / radius - markerY);
          if (markerDist < 0.07) {
            r = 36; g = 211; b = 162;
          } else if (markerDist < 0.11) {
            r = lerp(r, 36, 0.4);
            g = lerp(g, 211, 0.4);
            b = lerp(b, 162, 0.4);
          }
        }
      }

      const offset = (y * SIZE + x) * 4;
      pixels[offset] = Math.round(r);
      pixels[offset + 1] = Math.round(g);
      pixels[offset + 2] = Math.round(b);
      pixels[offset + 3] = a;
    }
  }
  return pixels;
}

function writePng(filePath, pixels) {
  const width = SIZE;
  const raw = Buffer.alloc((width * 4 + 1) * SIZE);
  for (let y = 0; y < SIZE; y += 1) {
    raw[y * (width * 4 + 1)] = 0; // фильтр «none»
    pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // бит на канал
  ihdr[9] = 6; // RGBA
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, png);
  return png.length;
}

const target = path.join(__dirname, '..', 'assets', 'icon.png');
const size = writePng(target, buildPixels());
console.log(`Иконка сохранена: ${target} (${(size / 1024).toFixed(1)} КБ)`);
