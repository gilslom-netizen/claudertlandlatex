'use strict';

const test = require('node:test');
const assert = require('node:assert');
const Settings = require('../../extension/src/core/settings.js');

test('defaults are returned for an empty store', () => {
  const s = Settings.normalize(undefined);
  assert.strictEqual(s.enabled, true);
  assert.strictEqual(s.math.enabled, true);
  assert.strictEqual(s.rtl.mode, 'auto');
  assert.strictEqual(s.settleMs, 350);
});

test('normalize never returns the shared defaults object', () => {
  const a = Settings.normalize(null);
  a.math.macros['\\X'] = 'y';
  const b = Settings.normalize(null);
  assert.deepStrictEqual(b.math.macros, {});
});

test('stored values override defaults', () => {
  const s = Settings.normalize({ enabled: false, settleMs: 100, scope: 'page' });
  assert.strictEqual(s.enabled, false);
  assert.strictEqual(s.settleMs, 100);
  assert.strictEqual(s.scope, 'page');
});

test('malformed values fall back instead of throwing', () => {
  const s = Settings.normalize({
    enabled: 'yes',
    settleMs: 'soon',
    scope: 'everywhere',
    math: 'on',
    rtl: { mode: 'sideways', rtlThreshold: 'half' }
  });
  assert.strictEqual(s.enabled, true);
  assert.strictEqual(s.settleMs, 350);
  assert.strictEqual(s.scope, 'auto');
  assert.strictEqual(s.math.enabled, true);
  assert.strictEqual(s.rtl.mode, 'auto');
  assert.strictEqual(s.rtl.rtlThreshold, 0.45);
});

test('numbers are clamped to a usable range', () => {
  assert.strictEqual(Settings.normalize({ settleMs: -50 }).settleMs, 0);
  assert.strictEqual(Settings.normalize({ settleMs: 99999 }).settleMs, 5000);
  assert.strictEqual(Settings.normalize({ rtl: { rtlThreshold: 4 } }).rtl.rtlThreshold, 1);
  assert.strictEqual(Settings.normalize({ rtl: { rtlThreshold: -1 } }).rtl.rtlThreshold, 0);
});

test('a numeric string is accepted where a number is expected', () => {
  assert.strictEqual(Settings.normalize({ settleMs: '420' }).settleMs, 420);
});

test('macros keep only string to string entries', () => {
  const s = Settings.normalize({
    math: { macros: { '\\RR': '\\mathbb{R}', bad: 3, worse: null, '': 'x' } }
  });
  assert.deepStrictEqual(s.math.macros, { '\\RR': '\\mathbb{R}' });
});

test('a non-object macros value becomes an empty map', () => {
  assert.deepStrictEqual(Settings.normalize({ math: { macros: 'nope' } }).math.macros, {});
  assert.deepStrictEqual(Settings.normalize({ math: { macros: ['a'] } }).math.macros, {});
});

test('every declared mode and scope is accepted', () => {
  for (const mode of Settings.MODES) {
    assert.strictEqual(Settings.normalize({ rtl: { mode } }).rtl.mode, mode);
  }
  for (const scope of Settings.SCOPES) {
    assert.strictEqual(Settings.normalize({ scope }).scope, scope);
  }
});

test('normalize is idempotent', () => {
  const once = Settings.normalize({ settleMs: 700, rtl: { mode: 'majority' } });
  assert.deepStrictEqual(Settings.normalize(once), once);
});

test('load falls back to defaults without a chrome API', async () => {
  const s = await Settings.load();
  assert.deepStrictEqual(s, Settings.normalize(null));
});
