// Render the app icons from icons/icon.svg (and a monochrome badge) to PNG.
// Dev-only. Run once:  npm run icons
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const icons = join(root, 'icons');
const master = readFileSync(join(icons, 'icon.svg'), 'utf8');

// Maskable: same mark, scaled into the 80% safe zone.
const maskable = master.replace('scale(1.4)', 'scale(1.18)');

// Badge: monochrome white on transparent (Android tints it). One stamp.
const badge = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72">
  <circle cx="36" cy="36" r="27" fill="none" stroke="#fff" stroke-width="5"/>
  <path d="M24 37l8 8 16-17" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const jobs = [
  ['icon-192.png', master, 192],
  ['icon-512.png', master, 512],
  ['maskable-512.png', maskable, 512],
  ['apple-touch-icon-180.png', master, 180],
  ['badge-72.png', badge, 72],
];

for (const [name, svg, size] of jobs) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size }, background: 'rgba(0,0,0,0)' }).render().asPng();
  writeFileSync(join(icons, name), png);
  console.log(`icons/${name}  ${size}x${size}  ${png.length} bytes`);
}
