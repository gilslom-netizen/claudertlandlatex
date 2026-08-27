'use strict';

const test = require('node:test');
const assert = require('node:assert');
const bidi = require('../../extension/src/core/bidi.js');

test('pure Hebrew is right to left', () => {
  assert.strictEqual(bidi.detectDirection('שלום עולם'), 'rtl');
});

test('pure English is left to right', () => {
  assert.strictEqual(bidi.detectDirection('Hello world'), 'ltr');
});

test('Arabic is right to left', () => {
  assert.strictEqual(bidi.detectDirection('مرحبا بالعالم'), 'rtl');
});

test('text with no letters has no direction of its own', () => {
  assert.strictEqual(bidi.detectDirection('123 — !?'), null);
  assert.strictEqual(bidi.detectDirection(''), null);
  assert.strictEqual(bidi.detectDirection('   '), null);
});

test('a Hebrew sentence opening with an English term stays right to left', () => {
  assert.strictEqual(bidi.detectDirection('LaTeX הוא מערכת סימון מתמטית מצוינת'), 'rtl');
  assert.strictEqual(bidi.detectDirection('React מאפשר לבנות ממשקים מורכבים בקלות'), 'rtl');
});

test('an English sentence quoting Hebrew stays left to right', () => {
  assert.strictEqual(bidi.detectDirection('The phrase שלום עולם means hello'), 'ltr');
});

test('leading punctuation and digits do not decide direction', () => {
  assert.strictEqual(bidi.detectDirection('1. שלום לכולם'), 'rtl');
  assert.strictEqual(bidi.detectDirection('"..." Hello there'), 'ltr');
  assert.strictEqual(bidi.detectDirection('(2026) שנה טובה'), 'rtl');
});

test('first-strong mode follows the Unicode rule literally', () => {
  const opts = { mode: 'first-strong' };
  assert.strictEqual(bidi.detectDirection('LaTeX הוא מערכת סימון', opts), 'ltr');
  assert.strictEqual(bidi.detectDirection('מערכת LaTeX היא טובה', opts), 'rtl');
});

test('majority mode counts letters', () => {
  const opts = { mode: 'majority' };
  assert.strictEqual(bidi.detectDirection('LaTeX הוא מערכת סימון', opts), 'rtl');
  assert.strictEqual(bidi.detectDirection('The phrase שלום means hello', opts), 'ltr');
});

test('the auto threshold is adjustable', () => {
  const text = 'The phrase שלום עולם means hello';
  assert.strictEqual(bidi.detectDirection(text, { rtlThreshold: 0.2 }), 'rtl');
  assert.strictEqual(bidi.detectDirection(text, { rtlThreshold: 0.9 }), 'ltr');
});

test('Hebrew vowel points and cantillation marks are not strong letters', () => {
  assert.strictEqual(bidi.firstStrong('ְ֑ word'), 'ltr');
  assert.strictEqual(bidi.countStrong('שָׁלוֹם').rtl, 4);   // 4 letters, 3 marks
});

test('Arabic-Indic digits are not strong letters', () => {
  assert.strictEqual(bidi.firstStrong('٠١ word'), 'ltr');
});

test('bidi control characters are ignored', () => {
  assert.strictEqual(bidi.firstStrong('‏‫hello'), 'ltr');
  assert.strictEqual(bidi.firstStrong('‎שלום'), 'rtl');
});

test('CJK counts as left to right', () => {
  assert.strictEqual(bidi.detectDirection('日本語のテキスト'), 'ltr');
});

test('hasRtl spots a single Hebrew letter', () => {
  assert.strictEqual(bidi.hasRtl('all latin here'), false);
  assert.strictEqual(bidi.hasRtl('one א letter'), true);
  assert.strictEqual(bidi.hasRtl('١٢٣'), false);
});

test('rtlRatio reports the mix', () => {
  assert.strictEqual(bidi.rtlRatio('abcd'), 0);
  assert.strictEqual(bidi.rtlRatio('אבגד'), 1);
  assert.strictEqual(bidi.rtlRatio('ab גד'), 0.5);
  assert.strictEqual(bidi.rtlRatio('12345'), 0);
});

test('null and undefined do not throw', () => {
  assert.strictEqual(bidi.detectDirection(null), null);
  assert.strictEqual(bidi.detectDirection(undefined), null);
  assert.strictEqual(bidi.firstStrong(null), null);
});

test('a Latin-heavy formula does not flip a Hebrew paragraph', () => {
  // What the caller passes in: the paragraph without its formulas.
  const withoutMath = 'הפונקציה  גדלה בקצב  עבור כל ערך של ';
  assert.strictEqual(bidi.detectDirection(withoutMath), 'rtl');
  // And with the formula text included, majority still holds the line.
  const withMath = 'הפונקציה f(x) = x^2 גדלה בקצב O(n) עבור כל ערך של x';
  assert.strictEqual(bidi.detectDirection(withMath), 'rtl');
});
