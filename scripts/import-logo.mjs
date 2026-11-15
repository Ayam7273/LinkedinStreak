// Import a new logo artwork and make it the single logo everywhere. Dev-only:
//   node scripts/import-logo.mjs "path/to/artwork.png"
//   npm run icons
// The artwork is not redrawn or recoloured: it is only trimmed to its visible pixels,
// centred on a transparent square, and written to assets/logo.png (+ the two SVG wrappers
// that js/ui/logo.js and sw.js reference).
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = process.argv[2];
if (!src) {
  console.error('Usage: node scripts/import-logo.mjs <artwork.png>');
  process.exit(1);
}

const data = `data:image/png;base64,${readFileSync(src).toString('base64')}`;
const full = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg"><image href="${data}"/></svg>`).render();
const { width: W, height: H, pixels } = full;

// Bounding box of the visible pixels.
let minX = W, minY = H, maxX = 0, maxY = 0;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (pixels[(y * W + x) * 4 + 3] > 8) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
}
if (maxX < minX) throw new Error('The artwork has no visible pixels.');

const PAD = 0.04; // small breathing room so edges never touch the frame
const side = Math.ceil(Math.max(maxX - minX + 1, maxY - minY + 1) * (1 + PAD * 2));
const cx = (minX + maxX + 1) / 2;
const cy = (minY + maxY + 1) / 2;
const ox = side / 2 - cx;
const oy = side / 2 - cy;

const square = `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}" viewBox="0 0 ${side} ${side}">
  <image x="${ox}" y="${oy}" width="${W}" height="${H}" href="${data}"/>
</svg>`;
const png = new Resvg(square, { fitTo: { mode: 'width', value: side } }).render().asPng();
writeFileSync(join(root, 'assets', 'logo.png'), png);

// The pages show the logo at 52px at most, so they get a light 256px copy (sharp up to 4x screens).
// assets/logo.png stays full size as the source for the app icons.
const WEB = 256;
const b64 = new Resvg(square, { fitTo: { mode: 'width', value: WEB } }).render().asPng().toString('base64');
const wrapper = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WEB} ${WEB}" width="${WEB}" height="${WEB}" role="img" aria-label="LinkedInStreak">
  <!-- The LinkedInStreak logo (assets/logo.png at ${WEB}px), embedded unchanged. Regenerate with scripts/import-logo.mjs. -->
  <image width="${WEB}" height="${WEB}" href="data:image/png;base64,${b64}"/>
</svg>
`;
writeFileSync(join(root, 'assets', 'logo.svg'), wrapper);
writeFileSync(join(root, 'assets', 'logo-mark.svg'), wrapper);

console.log(`assets/logo.png  ${side}x${side}  ${png.length} bytes (trimmed from ${W}x${H}, content ${maxX - minX + 1}x${maxY - minY + 1})`);
console.log('assets/logo.svg, assets/logo-mark.svg updated. Now run: npm run icons');
