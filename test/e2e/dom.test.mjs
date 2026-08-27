/**
 * Browser tests for the DOM half of the extension.
 *
 * The modules are loaded into an ordinary page in the same order the manifest
 * loads them, then driven directly - so a failure points at the module, not at
 * Chrome's extension plumbing. The extension as an installed product is covered
 * by extension.test.mjs.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert';
import { launchPlain, injectModules, injectStyles, runPass, startServer } from './support.mjs';

let browser;
let page;
let server;
const consoleErrors = [];
const failedRequests = [];

before(async () => {
  server = await startServer();
  browser = await launchPlain();
  page = await browser.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));
  page.on('response', (response) => {
    if (response.status() >= 400) failedRequests.push(`${response.status()} ${response.url()}`);
  });
  page.on('requestfailed', (request) => failedRequests.push(`failed ${request.url()}`));
  await page.goto(server.url('test/fixtures/conversation.html'));
  await injectStyles(page, server.origin);
  await injectModules(page);
  await runPass(page);
});

after(async () => {
  if (browser) await browser.close();
  if (server) await server.close();
});

/** Attributes and content of one element, as the assertions need them. */
function inspect(selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const math = Array.from(el.querySelectorAll('.clh-math'));
    return {
      dir: el.getAttribute('dir'),
      clhDir: el.getAttribute('data-clh-dir'),
      computedDirection: getComputedStyle(el).direction,
      text: el.textContent,
      mathCount: math.length,
      latex: math.map((m) => m.getAttribute('data-clh-latex')),
      displayCount: el.querySelectorAll('.clh-math-display').length,
      katexCount: el.querySelectorAll('.katex').length
    };
  }, selector);
}

test('inline math in a Hebrew paragraph is rendered', async () => {
  const p = await inspect('#p-he-math');
  assert.strictEqual(p.mathCount, 1);
  assert.deepStrictEqual(p.latex, ['$E = mc^2$']);
  assert.strictEqual(p.katexCount, 1);
  assert.strictEqual(p.dir, 'rtl');
});

test('inline math in an English paragraph is rendered left to right', async () => {
  const p = await inspect('#p-en');
  assert.strictEqual(p.mathCount, 1);
  assert.strictEqual(p.dir, 'ltr');
  assert.strictEqual(p.computedDirection, 'ltr');
});

test('display math becomes its own centred block', async () => {
  const p = await inspect('#p-display');
  assert.strictEqual(p.mathCount, 1);
  assert.strictEqual(p.displayCount, 1);
  assert.strictEqual(p.latex[0], '$$\\int_0^1 x^2\\,dx = \\frac{1}{3}$$');
  assert.strictEqual(p.dir, 'rtl');
});

test('an align environment is rendered without dollar signs', async () => {
  const p = await inspect('#p-env');
  assert.strictEqual(p.mathCount, 1);
  assert.strictEqual(p.displayCount, 1);
  assert.match(p.latex[0], /^\\begin\{align\}/);
});

test('prices in a Hebrew sentence are left alone', async () => {
  const p = await inspect('#p-money');
  assert.strictEqual(p.mathCount, 0);
  assert.strictEqual(p.text, 'המחיר הוא $5 והמשלוח $10 בלבד.');
  assert.strictEqual(p.dir, 'rtl');
});

test('a dollar sign inside inline code is not math', async () => {
  const p = await inspect('#p-inline-code');
  assert.strictEqual(p.mathCount, 0);
  assert.match(p.text, /echo \$HOME/);
  assert.strictEqual(p.dir, 'rtl');
});

test('an unbalanced expression is left exactly as written', async () => {
  const p = await inspect('#p-broken');
  assert.strictEqual(p.mathCount, 0);
  assert.strictEqual(p.text, 'הביטוי $\\frac{a$ שבור ולכן נשאר כמו שהוא.');
});

test('math split across an emphasis element is reassembled', async () => {
  const p = await inspect('#p-emph');
  assert.strictEqual(p.mathCount, 1);
  assert.deepStrictEqual(p.latex, ['$a_i + b_j$']);
});

test('Hebrew inside a formula keeps its letters in order', async () => {
  const rendered = await page.evaluate(() => {
    const el = document.querySelector('#p-hebrew-in-math .clh-math .katex-html');
    return el ? el.textContent : null;
  });
  assert.ok(rendered && rendered.includes('מהירות'),
    `expected the Hebrew word intact, got: ${rendered}`);
});

test('a Hebrew paragraph that opens with a Latin term is right to left', async () => {
  const p = await inspect('#p-en-start');
  assert.strictEqual(p.dir, 'rtl');
  assert.strictEqual(p.computedDirection, 'rtl');
});

test('an English paragraph quoting Hebrew stays left to right', async () => {
  const p = await inspect('#p-quote-he');
  assert.strictEqual(p.dir, 'ltr');
});

test('plain paragraphs still get the direction of their language', async () => {
  assert.strictEqual((await inspect('#p-plain')).dir, 'rtl');
  assert.strictEqual((await inspect('#p-plain-en')).dir, 'ltr');
});

test('lists follow the direction of their items', async () => {
  assert.strictEqual((await inspect('#list-he')).dir, 'rtl');
  assert.strictEqual((await inspect('#list-en')).dir, 'ltr');
  const padding = await page.evaluate(() => {
    const style = getComputedStyle(document.querySelector('#list-he'));
    return { left: style.paddingLeft, right: style.paddingRight };
  });
  assert.strictEqual(padding.left, '0px');
  assert.notStrictEqual(padding.right, '0px');
});

test('a nested list of another language keeps its own direction', async () => {
  assert.strictEqual((await inspect('#li-outer')).dir, 'rtl');
  assert.strictEqual((await inspect('#li-inner')).dir, 'ltr');
  assert.strictEqual((await inspect('#li-inner')).mathCount, 1);
});

test('math inside a list item and a table cell is rendered', async () => {
  assert.strictEqual((await inspect('#li-he-1')).mathCount, 1);
  assert.strictEqual((await inspect('#td-math')).mathCount, 1);
  assert.strictEqual((await inspect('#tbl')).dir, 'rtl');
});

test('a blockquote gets direction and a border on the right side', async () => {
  const bq = await inspect('#bq');
  assert.strictEqual(bq.dir, 'rtl');
  assert.strictEqual(bq.mathCount, 1);
  const border = await page.evaluate(() => {
    const style = getComputedStyle(document.querySelector('#bq'));
    return { left: style.borderLeftWidth, right: style.borderRightWidth };
  });
  assert.strictEqual(border.left, '0px');
  assert.strictEqual(border.right, '3px');
});

test('code blocks stay left to right and are never scanned for math', async () => {
  const block = await inspect('#code-block');
  assert.strictEqual(block.mathCount, 0);
  assert.strictEqual(block.computedDirection, 'ltr');
  assert.match(block.text, /\$notmath\$/);
});

test('inline code inside a Hebrew line is isolated from the bidi run', async () => {
  const style = await page.evaluate(() => {
    const code = document.querySelector('#p-inline-code code');
    const computed = getComputedStyle(code);
    return { direction: computed.direction, unicodeBidi: computed.unicodeBidi };
  });
  assert.strictEqual(style.direction, 'ltr');
  assert.strictEqual(style.unicodeBidi, 'isolate');
});

test('the composer is marked for per-paragraph direction', async () => {
  const composer = await page.evaluate(() => {
    const el = document.querySelector('#composer');
    return {
      marked: el.classList.contains('clh-composer'),
      unicodeBidi: getComputedStyle(el).unicodeBidi
    };
  });
  assert.strictEqual(composer.marked, true);
  assert.strictEqual(composer.unicodeBidi, 'plaintext');
});

test('repeated passes change nothing further', async () => {
  const before = await page.evaluate(() => document.querySelectorAll('.clh-math').length);
  await runPass(page);
  await runPass(page);
  const after = await page.evaluate(() => document.querySelectorAll('.clh-math').length);
  assert.strictEqual(after, before);
  assert.strictEqual((await inspect('#p-he-math')).mathCount, 1);
});

test('restoring gives back the original source text', async () => {
  const result = await page.evaluate(() => {
    const CLH = globalThis.CLH;
    const el = document.querySelector('#p-he-math');
    CLH.Math.restoreAll(el);
    const text = el.textContent;
    CLH.state.blocks = new WeakMap();
    CLH.Boot.pass();
    CLH.Boot.pass();
    return { text, mathAgain: el.querySelectorAll('.clh-math').length };
  });
  assert.strictEqual(result.text, 'הנוסחה $E = mc^2$ מתארת את שקילות המסה והאנרגיה.');
  assert.strictEqual(result.mathAgain, 1);
});

test('a streaming answer is only rendered once the expression closes', async () => {
  const steps = await page.evaluate(async () => {
    const CLH = globalThis.CLH;
    const el = document.querySelector('#p-stream');
    const observed = [];

    function pass() {
      CLH.state.blocks = new WeakMap();
      CLH.Boot.pass();
      CLH.Boot.pass();
      return el.querySelectorAll('.clh-math').length;
    }

    el.textContent = 'המהירות היא $v';
    observed.push(pass());
    el.textContent = 'המהירות היא $v = \\frac{d}';
    observed.push(pass());
    el.textContent = 'המהירות היא $v = \\frac{d}{t}$';
    observed.push(pass());
    el.textContent = 'המהירות היא $v = \\frac{d}{t}$ בכל רגע.';
    observed.push(pass());
    return { observed, latex: el.querySelector('.clh-math').getAttribute('data-clh-latex'), dir: el.getAttribute('dir') };
  });
  assert.deepStrictEqual(steps.observed, [0, 0, 1, 1]);
  assert.strictEqual(steps.latex, '$v = \\frac{d}{t}$');
  assert.strictEqual(steps.dir, 'rtl');
});

test('text that is still changing is not touched before it settles', async () => {
  const result = await page.evaluate(async () => {
    const CLH = globalThis.CLH;
    const el = document.querySelector('#p-stream');
    CLH.state.settings = CLH.Settings.normalize({ settleMs: 400 });
    CLH.state.blocks = new WeakMap();
    CLH.Math.restoreAll(el);
    el.textContent = 'הערך $x^2$ נשאר';
    CLH.Boot.pass();
    const immediately = el.querySelectorAll('.clh-math').length;
    await new Promise((resolve) => setTimeout(resolve, 500));
    CLH.Boot.pass();
    return { immediately, afterSettling: el.querySelectorAll('.clh-math').length };
  });
  assert.strictEqual(result.immediately, 0);
  assert.strictEqual(result.afterSettling, 1);
});

test('copying rendered math yields the LaTeX source', async () => {
  const copied = await page.evaluate(() => {
    const CLH = globalThis.CLH;
    const el = document.querySelector('#p-he-math');
    const range = document.createRange();
    range.selectNodeContents(el);
    const holder = document.createElement('div');
    holder.appendChild(range.cloneContents());
    CLH.Copy.rewriteMath(holder);
    return CLH.Copy.serialize(holder);
  });
  assert.strictEqual(copied, 'הנוסחה $E = mc^2$ מתארת את שקילות המסה והאנרגיה.');
});

test('copying a whole answer keeps paragraphs on separate lines', async () => {
  const copied = await page.evaluate(() => {
    const CLH = globalThis.CLH;
    const range = document.createRange();
    range.setStartBefore(document.querySelector('#p-he-math'));
    range.setEndAfter(document.querySelector('#p-en'));
    const holder = document.createElement('div');
    holder.appendChild(range.cloneContents());
    CLH.Copy.rewriteMath(holder);
    return CLH.Copy.serialize(holder);
  });
  // A blank line between paragraphs, the way a browser copies block elements.
  assert.strictEqual(copied,
    'הנוסחה $E = mc^2$ מתארת את שקילות המסה והאנרגיה.\n\n' +
    'The identity $e^{i\\pi} + 1 = 0$ links five constants.');
});

test('turning math off restores every expression on the page', async () => {
  const result = await page.evaluate(() => {
    const CLH = globalThis.CLH;
    CLH.Boot.applySettings(CLH.Settings.normalize({ math: { enabled: false } }));
    return {
      math: document.querySelectorAll('.clh-math').length,
      text: document.querySelector('#p-he-math').textContent
    };
  });
  assert.strictEqual(result.math, 0);
  assert.strictEqual(result.text, 'הנוסחה $E = mc^2$ מתארת את שקילות המסה והאנרגיה.');
});

test('turning the extension off clears every direction it set', async () => {
  const result = await page.evaluate(() => {
    const CLH = globalThis.CLH;
    CLH.Boot.applySettings(CLH.Settings.normalize({ enabled: false }));
    return {
      dirs: document.querySelectorAll('[data-clh-dir]').length,
      math: document.querySelectorAll('.clh-math').length,
      composer: document.querySelectorAll('.clh-composer').length,
      paragraphDir: document.querySelector('#p-he-math').getAttribute('dir')
    };
  });
  assert.strictEqual(result.dirs, 0);
  assert.strictEqual(result.math, 0);
  assert.strictEqual(result.composer, 0);
  assert.strictEqual(result.paragraphDir, null);
});

test('nothing failed to load and nothing was logged as an error', () => {
  assert.deepStrictEqual(failedRequests, []);
  assert.deepStrictEqual(consoleErrors, []);
});
