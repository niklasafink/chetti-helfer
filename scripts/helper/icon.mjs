// Menüleistensymbol des Helfers: ein Ring wie im Logo, schwarz auf transparent (macOS färbt „Template“-Bilder selbst).
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = buffer => { let c = 0xffffffff; for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length, 0); out.write(type, 4, 'ascii'); data.copy(out, 8); out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length); return out; };

function ring(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1)), c = size / 2, outer = size * 0.42, inner = size * 0.22;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
      // Kantenglättung über einen halben Pixel.
      const edge = Math.min(1, Math.max(0, outer - d + 0.5)) * Math.min(1, Math.max(0, d - inner + 0.5));
      raw[y * (size * 4 + 1) + 1 + x * 4 + 3] = Math.round(edge * 255);
    }
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export function writeIcons(directory) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, 'trayTemplate.png'), ring(16));
  writeFileSync(path.join(directory, 'trayTemplate@2x.png'), ring(32));
}
