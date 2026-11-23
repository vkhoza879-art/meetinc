import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const root = path.resolve('resources');
fs.mkdirSync(root, { recursive: true });
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  return c >>> 0;
});

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}

function lineDistance(x, y, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

function render(size, background, filename) {
  const rowBytes = size * 4 + 1;
  const pixels = Buffer.alloc(rowBytes * size);
  const scale = size / 1024;
  const segments = [[320, 270, 488, 735], [488, 735, 720, 270]];
  for (let y = 0; y < size; y++) {
    const row = y * rowBytes;
    for (let x = 0; x < size; x++) {
      let red = 0, green = 0, blue = 0, alpha = 0;
      const px = x / scale, py = y / scale;
      if (background) {
        const t = Math.max(0, Math.min(1, (px + py * 0.3) / 1330));
        red = Math.round(21 + t * 21);
        green = Math.round(72 + t * 38);
        blue = Math.round(53 + t * 25);
        alpha = 255;
      }
      const vDistance = Math.min(...segments.map(([ax, ay, bx, by]) => lineDistance(px, py, ax, ay, bx, by)));
      const sparkleDistance = Math.min(lineDistance(px, py, 790, 230, 790, 175), lineDistance(px, py, 763, 203, 817, 203));
      if (vDistance < 34 || sparkleDistance < 8) {
        red = 245; green = 255; blue = 226; alpha = 255;
      }
      const offset = row + 1 + x * 4;
      pixels[offset] = red;
      pixels[offset + 1] = green;
      pixels[offset + 2] = blue;
      pixels[offset + 3] = alpha;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
  fs.writeFileSync(path.join(root, filename), png);
}

render(1024, true, 'icon-only.png');
render(1024, false, 'icon-foreground.png');
render(1024, true, 'icon-background.png');
render(2732, true, 'splash.png');
