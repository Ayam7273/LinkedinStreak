// Generate every app icon from the logo (assets/logo.png). Dev-only:  npm run icons
// Nothing is redrawn: the logo is only scaled and placed on a background (and, for the
// monochrome notification badge, its own silhouette is used).
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const logo = `data:image/png;base64,${readFileSync(join(root, 'assets', 'logo.png')).toString('base64')}`;

/** SVG canvas of `size`, optional background, logo scaled to `scale` and centred. */
function canvas(size, { bg = null, scale = 1 } = {}) {
  const w = Math.round(size * scale);
  const o = Math.round((size - w) / 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    ${bg ? `<rect width="${size}" height="${size}" fill="${bg}"/>` : ''}
    <image x="${o}" y="${o}" width="${w}" height="${w}" href="${logo}"/>
  </svg>`;
}

const render = (svg, size) => new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render();

// Minimal PNG encoder (RGBA, 8-bit) for the badge.
const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function badge(size) {
  // Android shows badges as a white silhouette, so keep the logo's own shape in white.
  const img = render(canvas(size, { scale: 0.9 }), size);
  const px = Buffer.from(img.pixels);
  for (let i = 0; i < px.length; i += 4) {
    px[i] = px[i + 1] = px[i + 2] = 255;
  }
  return encodePng(img.width, img.height, px);
}

const out = (name, buf) => {
  writeFileSync(join(root, 'icons', name), buf);
  console.log(`icons/${name}  ${buf.length} bytes`);
};

out('icon-192.png', render(canvas(192, { bg: '#FFFFFF', scale: 0.84 }), 192).asPng());
out('icon-512.png', render(canvas(512, { bg: '#FFFFFF', scale: 0.84 }), 512).asPng());
out('maskable-512.png', render(canvas(512, { bg: '#FFFFFF', scale: 0.72 }), 512).asPng()); // inside the 80% safe zone
out('apple-touch-icon-180.png', render(canvas(180, { bg: '#FFFFFF', scale: 0.84 }), 180).asPng()); // iOS has no transparency
out('badge-72.png', badge(72));
