/**
 * End-to-end test of the packaged extension.
 *
 * Chrome loads the unpacked extension, the content script starts on its own,
 * and everything below is observed the way a user would see it - including the
 * bundled fonts, which only load if the manifest exposes them correctly.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert';
import { buildTestExtension, launchWithExtension, startServer } from './support.mjs';

let server;
let context;
let page;
let extensionId;
const consoleErrors = [];
const failedRequests = [];

before(async () => {
  server = await startServer();
  const built = await buildTestExtension(server.origin);
  extensionId = built.id;
  context = await launchWithExtension(built.path);

  page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));
  page.on('response', (response) => {
    if (response.status() >= 400) failedRequests.push(`${response.status()} ${response.url()}`);
  });

  await page.goto(server.url('test/fixtures/conversation.html'));
  await page.waitForFunction(
    () => document.querySelectorAll('.clh-math').length > 0,
    null,
    { timeout: 15000 }
  );
});

after(async () => {
  if (context) await context.close();
  if (server) await server.close();
});

test('the content script renders every formula on the page', async () => {
  const counts = await page.evaluate(() => ({
    math: document.querySelectorAll('.clh-math').length,
    katex: document.querySelectorAll('.clh-math .katex').length,
    display: document.querySelectorAll('.clh-math-display').length
  }));
  // Nine expressions in the fixture, one of them written twice as display math.
  assert.ok(counts.math >= 9, `expected at least 9 rendered expressions, got ${counts.math}`);
  assert.strictEqual(counts.katex, counts.math);
  assert.ok(counts.display >= 2, `expected display math, got ${counts.display}`);
});

test('the bundled KaTeX fonts load from the extension', async () => {
  await page.waitForFunction(() => document.fonts.status === 'loaded', null, { timeout: 10000 });
  const loaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return {
      main: document.fonts.check('16px KaTeX_Main'),
      math: document.fonts.check('16px KaTeX_Math'),
      families: Array.from(document.fonts).filter((f) => f.family.startsWith('KaTeX')).length
    };
  });
  assert.strictEqual(loaded.main, true, 'KaTeX_Main did not load');
  assert.strictEqual(loaded.math, true, 'KaTeX_Math did not load');
  assert.ok(loaded.families >= 10, `expected the KaTeX faces to be registered, got ${loaded.families}`);
});

test('formulas are laid out, not left as raw text', async () => {
  const box = await page.evaluate(() => {
    const el = document.querySelector('#p-display .clh-math-display');
    const rect = el.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  assert.ok(box.width > 40, `expected a rendered formula, got width ${box.width}`);
  assert.ok(box.height > 10, `expected a rendered formula, got height ${box.height}`);
});

test('direction is applied across the conversation', async () => {
  const dirs = await page.evaluate(() => ({
    hebrew: document.querySelector('#p-he-math').getAttribute('dir'),
    english: document.querySelector('#p-en').getAttribute('dir'),
    latinOpener: document.querySelector('#p-en-start').getAttribute('dir'),
    hebrewList: document.querySelector('#list-he').getAttribute('dir'),
    englishList: document.querySelector('#list-en').getAttribute('dir'),
    code: getComputedStyle(document.querySelector('#code-block')).direction
  }));
  assert.deepStrictEqual(dirs, {
    hebrew: 'rtl',
    english: 'ltr',
    latinOpener: 'rtl',
    hebrewList: 'rtl',
    englishList: 'ltr',
    code: 'ltr'
  });
});

test('prices and shell variables survive the round trip untouched', async () => {
  const text = await page.evaluate(() => ({
    money: document.querySelector('#p-money').textContent,
    code: document.querySelector('#p-inline-code').textContent
  }));
  assert.strictEqual(text.money, 'המחיר הוא $5 והמשלוח $10 בלבד.');
  assert.match(text.code, /echo \$HOME/);
});

test('new content added later is picked up by the observer', async () => {
  await page.evaluate(() => {
    const p = document.createElement('p');
    p.id = 'p-late';
    p.textContent = 'תוצאה מאוחרת: $\\sqrt{16} = 4$ בדיוק.';
    document.querySelector('.font-claude-message').appendChild(p);
  });
  await page.waitForFunction(
    () => document.querySelectorAll('#p-late .clh-math').length === 1,
    null,
    { timeout: 10000 }
  );
  const dir = await page.evaluate(() => document.querySelector('#p-late').getAttribute('dir'));
  assert.strictEqual(dir, 'rtl');
});

test('an answer typed one chunk at a time renders once it is complete', async () => {
  await page.evaluate(async () => {
    const p = document.createElement('p');
    p.id = 'p-streamed';
    document.querySelector('.font-claude-message').appendChild(p);
    const full = 'שטח המעגל הוא $A = \\pi r^2$ ולכן הרדיוס קובע.';
    for (let i = 1; i <= full.length; i += 7) {
      p.textContent = full.slice(0, i);
      await new Promise((resolve) => setTimeout(resolve, 12));
    }
    p.textContent = full;
  });
  await page.waitForFunction(
    () => document.querySelectorAll('#p-streamed .clh-math').length === 1,
    null,
    { timeout: 10000 }
  );
  const result = await page.evaluate(() => {
    const p = document.querySelector('#p-streamed');
    return {
      latex: p.querySelector('.clh-math').getAttribute('data-clh-latex'),
      dir: p.getAttribute('dir'),
      duplicates: p.querySelectorAll('.clh-math').length
    };
  });
  assert.strictEqual(result.latex, '$A = \\pi r^2$');
  assert.strictEqual(result.dir, 'rtl');
  assert.strictEqual(result.duplicates, 1);
});

test('work the page throws away is picked up and done again', async () => {
  // What a framework re-render leaves behind: the source text back in place,
  // our rendering and attributes gone, and not a character of difference in
  // the text itself for us to notice it by.
  await page.evaluate(() => {
    const p = document.querySelector('#p-late');
    p.textContent = 'תוצאה מאוחרת: $\\sqrt{16} = 4$ בדיוק.';
    p.removeAttribute('dir');
    p.removeAttribute('data-clh-dir');
  });
  await page.waitForFunction(
    () => document.querySelectorAll('#p-late .clh-math').length === 1 &&
          document.querySelector('#p-late').getAttribute('dir') === 'rtl',
    null,
    { timeout: 10000 }
  );
});

test('the options page saves a change and the open tab follows it', async () => {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options/options.html`);
  await options.waitForSelector('#enabled');

  // Turning single-dollar math off must leave inline expressions as text.
  await options.uncheck('#math-single-dollar');
  await options.waitForFunction(
    () => document.getElementById('status').textContent !== '' ||
          document.getElementById('status').dataset.settled === '1',
    null,
    { timeout: 5000 }
  );

  // Everything is unwound and derived again, so wait for the settled state:
  // inline math gone, display math back.
  await page.bringToFront();
  await page.waitForFunction(
    () => document.querySelectorAll('#p-he-math .clh-math').length === 0 &&
          document.querySelectorAll('#p-display .clh-math').length === 1,
    null,
    { timeout: 10000 }
  );

  const state = await page.evaluate(() => ({
    inline: document.querySelectorAll('#p-he-math .clh-math').length,
    display: document.querySelectorAll('#p-display .clh-math').length,
    dir: document.querySelector('#p-he-math').getAttribute('dir')
  }));
  assert.strictEqual(state.inline, 0, 'inline math should be off');
  assert.strictEqual(state.display, 1, 'display math should still render');
  assert.strictEqual(state.dir, 'rtl', 'direction should be unaffected');

  // Put it back and make sure the formula returns.
  await options.check('#math-single-dollar');
  await page.bringToFront();
  await page.waitForFunction(
    () => document.querySelectorAll('#p-he-math .clh-math').length === 1,
    null,
    { timeout: 10000 }
  );
  await options.close();
});

test('turning the extension off from the options page reverts the page', async () => {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options/options.html`);
  await options.waitForSelector('#enabled');
  await options.uncheck('#enabled');

  await page.bringToFront();
  await page.waitForFunction(
    () => document.querySelectorAll('.clh-math').length === 0,
    null,
    { timeout: 10000 }
  );
  const state = await page.evaluate(() => ({
    dirs: document.querySelectorAll('[data-clh-dir]').length,
    text: document.querySelector('#p-he-math').textContent
  }));
  assert.strictEqual(state.dirs, 0);
  assert.strictEqual(state.text, 'הנוסחה $E = mc^2$ מתארת את שקילות המסה והאנרגיה.');

  await options.check('#enabled');
  await page.bringToFront();
  await page.waitForFunction(
    () => document.querySelectorAll('.clh-math').length > 0,
    null,
    { timeout: 10000 }
  );
  await options.close();
});

test('the page console stayed clean', () => {
  assert.deepStrictEqual(failedRequests, []);
  assert.deepStrictEqual(consoleErrors, []);
});
