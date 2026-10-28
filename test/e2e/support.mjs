/**
 * Shared plumbing for the browser tests: a real Chromium, a static server, and
 * a copy of the extension whose manifest also matches the test origin.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdtemp, cp, writeFile } from 'node:fs/promises';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const EXTENSION_DIR = path.join(ROOT, 'extension');
export const FIXTURES_DIR = path.join(ROOT, 'test', 'fixtures');

/**
 * Playwright ships with a pinned Chromium revision that may not be the one
 * installed in this environment; fall back to whatever build is present.
 */
export function chromiumExecutable() {
  const preferred = chromium.executablePath();
  if (existsSync(preferred)) return preferred;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  // Any installed revision will do; newer builds ship as chrome-linux64.
  const revisions = existsSync(base)
    ? readdirSync(base).filter((name) => /^chromium(-\d+)?$/.test(name)).sort().reverse()
    : [];
  const candidates = revisions.flatMap((name) => [
    path.join(base, name, 'chrome-linux64', 'chrome'),
    path.join(base, name, 'chrome-linux', 'chrome')
  ]);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error('no Chromium build found for the browser tests');
  return found;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8'
};

/** Minimal static file server over the repository, for a realistic origin. */
export async function startServer(rootDir = ROOT) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      const filePath = path.join(rootDir, decodeURIComponent(url.pathname));
      if (!filePath.startsWith(rootDir)) {
        res.writeHead(403).end('forbidden');
        return;
      }
      const body = await readFile(filePath);
      res.writeHead(200, { 'content-type': MIME[path.extname(filePath)] || 'application/octet-stream' });
      res.end(body);
    } catch (err) {
      res.writeHead(404).end('not found');
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    port,
    origin: `http://127.0.0.1:${port}`,
    url: (relative) => `http://127.0.0.1:${port}/${relative.replace(/^\//, '')}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

/**
 * Chrome derives an extension's id from its public key: the first 16 bytes of
 * the SHA-256 digest, with every hex digit shifted into the letters a-p.
 */
function extensionIdFor(publicKeyDer) {
  const digest = createHash('sha256').update(publicKeyDer).digest().subarray(0, 16);
  return Array.from(digest)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .replace(/[0-9a-f]/g, (hex) => String.fromCharCode(97 + parseInt(hex, 16)));
}

/**
 * Copy the extension to a temporary directory, widen its manifest to the test
 * origin and pin its key so the id is known up front - which is what lets the
 * test open the options page. The shipped manifest keeps neither change.
 */
export async function buildTestExtension(origin) {
  const dir = await mkdtemp(path.join(tmpdir(), 'clh-ext-'));
  const target = path.join(dir, 'extension');
  await cp(EXTENSION_DIR, target, { recursive: true });

  const { publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'der' }
  });

  const manifestPath = path.join(target, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const pattern = `${origin}/*`;
  manifest.content_scripts[0].matches.push(pattern);
  manifest.key = publicKey.toString('base64');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  return { path: target, id: extensionIdFor(publicKey) };
}

/** A browser context with the extension loaded, plus its console messages. */
export async function launchWithExtension(extensionPath) {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'clh-profile-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath: chromiumExecutable(),
    // Playwright's own headless switch loads the old headless mode, which
    // ignores extensions; ask for the new one by hand instead.
    headless: false,
    args: [
      '--headless=new',
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-sandbox'
    ]
  });
  return context;
}

/** A plain browser, for tests that inject the modules themselves. */
export async function launchPlain() {
  return chromium.launch({ executablePath: chromiumExecutable(), args: ['--no-sandbox'] });
}

/** The extension's scripts, in the order the manifest loads them. */
export const SCRIPT_ORDER = [
  'src/vendor/katex/katex.min.js',
  'src/core/latex-scan.js',
  'src/core/bidi.js',
  'src/core/settings.js',
  'src/content/dom-text.js',
  'src/content/math.js',
  'src/content/rtl.js',
  'src/content/html-tags.js',
  'src/content/copy.js',
  'src/content/boot.js'
];

/** Load the extension's scripts into an ordinary page, exactly as the manifest would. */
export async function injectModules(page, { includeBoot = true } = {}) {
  const files = includeBoot ? SCRIPT_ORDER : SCRIPT_ORDER.filter((f) => !f.endsWith('boot.js'));
  for (const file of files) {
    await page.addScriptTag({ path: path.join(EXTENSION_DIR, file) });
  }
  if (includeBoot) {
    await page.waitForFunction(() => globalThis.CLH && globalThis.CLH.state && globalThis.CLH.state.observer);
  }
}

/**
 * Load the extension's stylesheets into an ordinary page.
 *
 * When a base URL is given the sheets are linked rather than inlined, so the
 * relative font URLs inside KaTeX's CSS still resolve - which is what happens
 * in the real extension too.
 */
export async function injectStyles(page, baseUrl) {
  for (const file of ['src/vendor/katex/katex.min.css', 'styles/claude-rtl.css']) {
    if (baseUrl) await page.addStyleTag({ url: `${baseUrl}/extension/${file}` });
    else await page.addStyleTag({ path: path.join(EXTENSION_DIR, file) });
  }
}

/** Run one processing pass with the settle delay taken out of the way. */
export async function runPass(page, overrides = {}) {
  await page.evaluate((settingsOverrides) => {
    const CLH = globalThis.CLH;
    CLH.state.settings = CLH.Settings.normalize(
      Object.assign({ settleMs: 0 }, settingsOverrides)
    );
    CLH.state.blocks = new WeakMap();
    CLH.Boot.pass();   // first pass records the text
    CLH.Boot.pass();   // second pass acts on it, the settle window being zero
  }, overrides);
}
