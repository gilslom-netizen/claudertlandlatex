/**
 * Direction must not leak onto the app's own furniture.
 *
 * Two failures this covers, both reported from a real session:
 *   1. an English-only "Resumed session" control ending up right-aligned;
 *   2. prompt bubbles jumping to the left-hand side of the conversation.
 *
 * Both come from structural elements - a flex row, a header holding a button -
 * that have no text of their own, so nothing about them says which way they
 * should read.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert';
import { launchPlain, injectModules, injectStyles, runPass, startServer } from './support.mjs';

let browser;
let page;
let server;

before(async () => {
  server = await startServer();
  browser = await launchPlain();
  page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  await page.goto(server.url('test/fixtures/session-ui.html'));
  await injectStyles(page, server.origin);
  await injectModules(page);
  await runPass(page);
});

after(async () => {
  if (browser) await browser.close();
  if (server) await server.close();
});

function attr(selector, name) {
  return page.evaluate(
    ([sel, attribute]) => {
      const el = document.querySelector(sel);
      return el ? el.getAttribute(attribute) : null;
    },
    [selector, name]
  );
}

/** Which half of its row does an element sit in? */
function side(selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const parent = el.parentElement;
    const box = el.getBoundingClientRect();
    const row = parent.getBoundingClientRect();
    const centre = box.left + box.width / 2;
    return centre > row.left + row.width / 2 ? 'right' : 'left';
  }, selector);
}

test('a prompt bubble stays on the side its layout puts it', async () => {
  assert.strictEqual(await side('#bubble-1'), 'right');
  assert.strictEqual(await side('#bubble-2'), 'right');
});

test('a flex row with no text of its own is never given a direction', async () => {
  assert.strictEqual(await attr('#row-user-1', 'dir'), null);
  assert.strictEqual(await attr('#row-user-2', 'dir'), null);
  assert.strictEqual(await attr('#turn-1', 'dir'), null);
});

test('a bubble held in place by a logical margin does not move either', async () => {
  assert.strictEqual(await side('#bubble-3'), 'right');
  // The text still needs sorting out, just not by changing the box's direction.
  assert.strictEqual(await attr('#bubble-3', 'data-clh-mode'), 'plaintext');
  assert.strictEqual(await attr('#bubble-3', 'data-clh-dir'), 'rtl');
  assert.strictEqual(await attr('#bubble-3', 'dir'), null);
});

test('the text inside a prompt bubble still reads right to left', async () => {
  assert.strictEqual(await attr('#prompt-1', 'dir'), 'rtl');
  assert.strictEqual(await attr('#prompt-2', 'dir'), 'rtl');
});

test('an English control between turns is not dragged right', async () => {
  const header = await attr('#resumed-header-1', 'dir');
  assert.notStrictEqual(header, 'rtl', 'an English-only header must not become RTL');
  assert.strictEqual(await attr('#session-note-1', 'dir'), 'ltr');
});

test('a second English control after Hebrew behaves the same', async () => {
  assert.notStrictEqual(await attr('#resumed-header-2', 'dir'), 'rtl');
});

test('a paragraph holding only a formula still follows the text around it', async () => {
  assert.strictEqual(await attr('#answer-math-only', 'dir'), 'rtl');
  assert.strictEqual(await attr('#answer-text-2', 'dir'), 'rtl');
});

test('answers keep the direction of their own language', async () => {
  assert.strictEqual(await attr('#answer-text-1', 'dir'), 'rtl');
});

test('math in a prompt is still rendered', async () => {
  const count = await page.evaluate(() => document.querySelectorAll('.clh-math').length);
  assert.strictEqual(count, 2);
});
