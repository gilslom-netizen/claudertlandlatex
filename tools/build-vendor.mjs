/**
 * Builds the KaTeX assets the extension ships.
 *
 *   node tools/build-vendor.mjs
 *
 * Upstream KaTeX lives in vendor/katex. The one transformation that matters is
 * the fonts: a stylesheet injected by a content script has its relative URLs
 * resolved against the *page*, not against the extension, so `url(fonts/…)`
 * would ask claude.ai for files it has never heard of. Inlining every face as a
 * data: URI removes the question entirely - no extra requests, no
 * web-accessible resources, and nothing for a page's CSP to refuse.
 */
import path from 'node:path';
import { readFile, writeFile, mkdir, copyFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'vendor', 'katex');
const TARGET = path.join(ROOT, 'extension', 'src', 'vendor', 'katex');

const version = (await readFile(path.join(SOURCE, 'VERSION'), 'utf8')).trim();

await mkdir(TARGET, { recursive: true });
await copyFile(path.join(SOURCE, 'katex.min.js'), path.join(TARGET, 'katex.min.js'));
await copyFile(path.join(SOURCE, 'LICENSE'), path.join(TARGET, 'LICENSE'));
await writeFile(path.join(TARGET, 'VERSION'), `${version}\n`);

const fontFiles = (await readdir(path.join(SOURCE, 'fonts'))).filter((f) => f.endsWith('.woff2'));
const fonts = new Map();
for (const name of fontFiles) {
  const data = await readFile(path.join(SOURCE, 'fonts', name));
  fonts.set(name, `data:font/woff2;base64,${data.toString('base64')}`);
}

let css = await readFile(path.join(SOURCE, 'katex.min.css'), 'utf8');

// Keep only the woff2 source in every @font-face; the woff and ttf fallbacks
// exist for browsers Chrome extensions never run on.
css = css.replace(/,url\(fonts\/[^)]+\.(?:woff|ttf)\)\s*format\("(?:woff|truetype)"\)/g, '');

let inlined = 0;
css = css.replace(/url\(fonts\/([^)]+\.woff2)\)/g, (match, name) => {
  const uri = fonts.get(name);
  if (!uri) throw new Error(`missing font file: ${name}`);
  inlined++;
  return `url(${uri})`;
});

const remaining = css.match(/url\((?!data:)[^)]*\)/g);
if (remaining) throw new Error(`stylesheet still points at external files: ${remaining.join(', ')}`);

const header = `/*! KaTeX v${version} | MIT | fonts inlined by tools/build-vendor.mjs */\n`;
await writeFile(path.join(TARGET, 'katex.min.css'), header + css);

console.log(`KaTeX ${version}: inlined ${inlined} font faces from ${fontFiles.length} files`);
console.log(`stylesheet: ${Math.round((header.length + css.length) / 1024)} KB`);
