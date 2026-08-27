/**
 * Renders the extension icons from SVG into the PNG sizes Chrome asks for.
 *
 *   node tools/make-icons.mjs
 *
 * The generated files are committed, so this only needs running when the
 * artwork changes.
 */
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { chromiumExecutable } from '../test/e2e/support.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'extension', 'icons');

const BACKGROUND = '#c8613a';
const FOREGROUND = '#fdf7f2';

/**
 * An aleph over a leftward arrow: right-to-left text, with a formula bar.
 * Below 32px the arrow turns to mush, so small sizes keep the letter alone.
 */
function svg(size) {
  const detailed = size >= 48;
  const radius = Math.round(size * 0.22);
  const letterSize = detailed ? size * 0.58 : size * 0.78;
  const letterY = detailed ? size * 0.58 : size * 0.76;
  const arrow = detailed ? `
    <g stroke="${FOREGROUND}" stroke-width="${size * 0.055}" stroke-linecap="round" stroke-linejoin="round" fill="none">
      <line x1="${size * 0.26}" y1="${size * 0.79}" x2="${size * 0.74}" y2="${size * 0.79}"/>
      <polyline points="${size * 0.38},${size * 0.71} ${size * 0.26},${size * 0.79} ${size * 0.38},${size * 0.87}"/>
    </g>` : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="${BACKGROUND}"/>
    <text x="50%" y="${letterY}" text-anchor="middle"
          font-family="DejaVu Sans, Noto Sans Hebrew, Arial, sans-serif"
          font-size="${letterSize}" font-weight="700" fill="${FOREGROUND}">&#x05D0;</text>
    ${arrow}
  </svg>`;
}

const SIZES = [16, 32, 48, 128];

const browser = await chromium.launch({
  executablePath: chromiumExecutable(),
  args: ['--no-sandbox']
});
await mkdir(OUT_DIR, { recursive: true });

for (const size of SIZES) {
  // A fresh page per size: reusing one and resizing it can leave the
  // screenshot waiting on a viewport that never settles.
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(
    `<style>html,body{margin:0;padding:0;background:transparent}</style>${svg(size)}`,
    { waitUntil: 'load' }
  );
  const png = await page.screenshot({
    omitBackground: true,
    clip: { x: 0, y: 0, width: size, height: size }
  });
  const file = path.join(OUT_DIR, `icon-${size}.png`);
  await writeFile(file, png);
  console.log(`wrote ${path.relative(ROOT, file)} (${png.length} bytes)`);
  await page.close();
}

await browser.close();
