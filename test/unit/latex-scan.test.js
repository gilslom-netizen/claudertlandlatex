'use strict';

const test = require('node:test');
const assert = require('node:assert');
const scanner = require('../../extension/src/core/latex-scan.js');

/** Compact view of a scan: math segments only, as [value, 'display'|'inline']. */
function math(text, opts) {
  return scanner.scan(text, opts)
    .filter((s) => s.type === 'math')
    .map((s) => [s.value, s.display ? 'display' : 'inline']);
}

/** The text as the reader sees it, with math cut out. */
function plain(text, opts) {
  return scanner.scan(text, opts)
    .filter((s) => s.type === 'text')
    .map((s) => s.value)
    .join('');
}

/** Every scan must be able to rebuild the input exactly. */
function assertLossless(text, opts) {
  const rebuilt = scanner.scan(text, opts)
    .map((s) => (s.type === 'math' ? s.raw : s.value))
    .join('');
  assert.strictEqual(rebuilt, text, 'scan lost or duplicated characters');
}

test('inline dollar math', () => {
  assert.deepStrictEqual(math('the value $x^2$ here'), [['x^2', 'inline']]);
  assertLossless('the value $x^2$ here');
});

test('display dollar math', () => {
  assert.deepStrictEqual(math('before $$\\frac{a}{b}$$ after'), [['\\frac{a}{b}', 'display']]);
});

test('paren and bracket delimiters', () => {
  assert.deepStrictEqual(math('\\(a+b\\) and \\[c=d\\]'), [['a+b', 'inline'], ['c=d', 'display']]);
});

test('several expressions in one paragraph', () => {
  assert.deepStrictEqual(math('$a$ ואז $b$ ולבסוף $$c$$'),
    [['a', 'inline'], ['b', 'inline'], ['c', 'display']]);
});

test('hebrew text around math is preserved', () => {
  const text = 'המשוואה $E=mc^2$ מתארת שקילות מסה-אנרגיה';
  assert.deepStrictEqual(math(text), [['E=mc^2', 'inline']]);
  assert.strictEqual(plain(text), 'המשוואה  מתארת שקילות מסה-אנרגיה');
  assertLossless(text);
});

test('prices are not math', () => {
  assert.deepStrictEqual(math('it costs $5 and then $10 more'), []);
  assert.deepStrictEqual(math('between $100 and $200'), []);
  assert.deepStrictEqual(math('המחיר הוא $5 ואילו השני $10'), []);
});

test('a lone dollar amount is not math', () => {
  assert.deepStrictEqual(math('the price is $5'), []);
  assert.deepStrictEqual(math('$1,500$'), []);
});

test('escaped dollars never open math', () => {
  assert.deepStrictEqual(math('costs \\$100 exactly'), []);
  assert.deepStrictEqual(math('\\$a\\$ plain'), []);
});

test('an escaped dollar inside math stays part of it', () => {
  assert.deepStrictEqual(math('$\\$5$'), [['\\$5', 'inline']]);
});

test('opening delimiter followed by space is not math', () => {
  assert.deepStrictEqual(math('give me $ 5 or $ 10'), []);
});

test('shell variables are left alone', () => {
  assert.deepStrictEqual(math('run $HOME and then $PATH lookups'), []);
});

test('unclosed expression is left as text - the streaming case', () => {
  assert.deepStrictEqual(math('the answer is $x^2 + y'), []);
  assert.deepStrictEqual(math('displayed $$\\frac{a}{b'), []);
  assert.deepStrictEqual(math('\\(x^2'), []);
});

test('a closing delimiter arriving later completes the expression', () => {
  const streamed = 'the answer is $x^2 + y$';
  assert.deepStrictEqual(math(streamed), [['x^2 + y', 'inline']]);
});

test('a blank line stops delimiter pairing', () => {
  assert.deepStrictEqual(math('cost $5\n\nand another $5 here'), []);
  assert.deepStrictEqual(math('open $$a\n\nb$$ close'), []);
});

test('display delimiters win over inline ones', () => {
  assert.deepStrictEqual(math('$$a+b$$'), [['a+b', 'display']]);
});

test('empty expressions are ignored', () => {
  assert.deepStrictEqual(math('$$ $$'), []);
  assert.deepStrictEqual(math('$$$$'), []);
});

test('environments render without delimiters', () => {
  const src = '\\begin{align} a &= b \\\\ c &= d \\end{align}';
  assert.deepStrictEqual(math(src), [[src, 'display']]);
});

test('an unknown environment is not math', () => {
  assert.deepStrictEqual(math('\\begin{lstlisting} x \\end{lstlisting}'), []);
});

test('environments can be switched off', () => {
  assert.deepStrictEqual(math('\\begin{align} a \\end{align}', { environments: false }), []);
});

test('single dollar mode can be switched off', () => {
  assert.deepStrictEqual(math('$x$ and $$y$$', { singleDollar: false }), [['y', 'display']]);
});

test('an over-long expression is rejected', () => {
  const long = '$' + 'a'.repeat(2000) + '$';
  assert.deepStrictEqual(math(long), []);
  assert.deepStrictEqual(math('$' + 'a'.repeat(50) + '$', { maxLength: 10 }), []);
});

test('multi-line display math is allowed', () => {
  assert.deepStrictEqual(math('$$\n a = b \\\\\n c = d\n$$'), [['\n a = b \\\\\n c = d\n', 'display']]);
});

test('offsets point at the source text', () => {
  const text = 'abc $x$ def';
  const seg = scanner.scan(text).find((s) => s.type === 'math');
  assert.strictEqual(text.slice(seg.start, seg.end), '$x$');
  assert.strictEqual(seg.raw, '$x$');
});

test('hasMath is a cheap pre-check that agrees with scan', () => {
  const samples = [
    'plain text', 'costs $5', '$x$', '$$y$$', '\\(z\\)', 'טקסט בעברית',
    '\\begin{align}a\\end{align}', 'a $ b $ c'
  ];
  for (const sample of samples) {
    assert.strictEqual(scanner.hasMath(sample), math(sample).length > 0, sample);
  }
});

test('scanning is lossless for a mixed paragraph', () => {
  assertLossless('שלום $a_1$ world $$\\sum_{i=1}^n i$$ סוף \\(z\\) tail');
  assertLossless('no math at all, just $ signs and \\backslashes');
});

test('subscripts and superscripts survive', () => {
  assert.deepStrictEqual(math('$a_1 + b^{2}$'), [['a_1 + b^{2}', 'inline']]);
});

test('adjacent punctuation does not break a match', () => {
  assert.deepStrictEqual(math('הערך הוא $x$.'), [['x', 'inline']]);
  assert.deepStrictEqual(math('(ראו $y$),'), [['y', 'inline']]);
});
