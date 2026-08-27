/*!
 * latex-scan.js — Finds LaTeX math segments inside a plain-text string.
 *
 * Pure logic, no DOM. Shared by the content script and the unit tests.
 *
 * The scanner is deliberately conservative: when in doubt it returns text, not
 * math. A missed formula is a cosmetic loss; a false positive mangles prose
 * (prices, shell snippets, stray delimiters) and is much worse.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.CLH = root.CLH || {};
    root.CLH.LatexScan = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** Environments KaTeX renders without surrounding math delimiters. */
  var ENVIRONMENTS = [
    'equation', 'equation*',
    'align', 'align*', 'alignat', 'alignat*', 'aligned', 'alignedat',
    'gather', 'gather*', 'gathered',
    'multline', 'multline*',
    'split',
    'cases', 'dcases', 'rcases',
    'matrix', 'pmatrix', 'bmatrix', 'Bmatrix', 'vmatrix', 'Vmatrix',
    'smallmatrix', 'array', 'darray', 'subarray', 'CD'
  ];

  var ENV_SET = Object.create(null);
  for (var e = 0; e < ENVIRONMENTS.length; e++) ENV_SET[ENVIRONMENTS[e]] = true;

  var DEFAULTS = {
    // Treat `$ ... $` as inline math. `$$`, `\(` and `\[` are always honoured.
    singleDollar: true,
    // Hard cap on one expression, so a stray delimiter cannot swallow a message.
    maxLength: 1200,
    // Recognise a bare `\begin{align} ... \end{align}` block.
    environments: true
  };

  var BLANK_LINE = /\n[ \t ]*\n/;

  function options(opts) {
    var o = {}, k;
    for (k in DEFAULTS) o[k] = DEFAULTS[k];
    if (opts) for (k in opts) if (opts[k] !== undefined) o[k] = opts[k];
    return o;
  }

  function isSpace(ch) {
    return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' ||
           ch === '\f' || ch === ' ';
  }

  function isDigit(ch) {
    return ch >= '0' && ch <= '9';
  }

  /** True when text[i] is preceded by an odd number of backslashes. */
  function isEscaped(text, i) {
    var n = 0;
    for (var j = i - 1; j >= 0 && text.charAt(j) === '\\'; j--) n++;
    return n % 2 === 1;
  }

  function findUnescaped(text, needle, from) {
    var idx = from;
    for (;;) {
      idx = text.indexOf(needle, idx);
      if (idx < 0) return -1;
      if (!isEscaped(text, idx)) return idx;
      idx += 1;
    }
  }

  /**
   * Where a delimiter search must stop: the maximum expression length, or the
   * first blank line — a blank line means the opening delimiter was never
   * closed and the "closer" we would find belongs to a later paragraph.
   */
  function searchLimit(text, from, maxLength) {
    var limit = Math.min(text.length, from + maxLength);
    var blank = text.slice(from, limit).search(BLANK_LINE);
    return blank < 0 ? limit : from + blank;
  }

  /** Reject `$1,500$`-shaped matches: that is money, not mathematics. */
  function looksLikeCurrency(body) {
    return /^[\s\d.,]+$/.test(body);
  }

  /**
   * Locate the closing `$` of an inline expression opened at `open`, or -1 when
   * no candidate passes the anti-false-positive rules.
   */
  function findInlineDollarClose(text, open, maxLength) {
    var start = open + 1;
    var after = text.charAt(start);
    if (after === '' || isSpace(after)) return -1;  // `$ x$` never opens math
    if (after === '$') return -1;                   // `$$` is the caller's job

    var limit = searchLimit(text, start, maxLength + 1);
    for (var i = start; i < limit; i++) {
      if (text.charAt(i) !== '$' || isEscaped(text, i)) continue;
      if (i === start) return -1;                   // empty body
      if (isSpace(text.charAt(i - 1))) continue;    // `x $` does not close
      if (isDigit(text.charAt(i + 1))) continue;    // `$5 and $10` is money
      return i;
    }
    return -1;
  }

  /**
   * Split `text` into alternating text and math segments.
   *
   * Every segment has `{ type, value, start, end }`; math segments also carry
   * `display` (block vs inline) and `raw` (source text including delimiters).
   */
  function scan(text, opts) {
    var o = options(opts);
    var segments = [];
    var textStart = 0;
    var i = 0;
    var n = text.length;

    function pushText(end) {
      if (end > textStart) {
        segments.push({
          type: 'text',
          value: text.slice(textStart, end),
          start: textStart,
          end: end
        });
      }
    }

    // open .. open+openLen        the opening delimiter
    // open+openLen .. bodyEnd     the expression itself
    // bodyEnd .. bodyEnd+closeLen the closing delimiter
    function pushMath(open, openLen, bodyEnd, closeLen, display) {
      pushText(open);
      segments.push({
        type: 'math',
        value: text.slice(open + openLen, bodyEnd),
        raw: text.slice(open, bodyEnd + closeLen),
        display: display,
        start: open,
        end: bodyEnd + closeLen
      });
      i = bodyEnd + closeLen;
      textStart = i;
    }

    function bodyIsSane(body) {
      return !!body && !!body.trim() && body.length <= o.maxLength && !BLANK_LINE.test(body);
    }

    while (i < n) {
      var ch = text.charAt(i);

      if (ch === '\\') {
        var next = text.charAt(i + 1);

        if (next === '[' || next === '(') {
          var closer = next === '[' ? '\\]' : '\\)';
          var limit = searchLimit(text, i + 2, o.maxLength + 2);
          var close = findUnescaped(text, closer, i + 2);
          if (close >= 0 && close <= limit) {
            var body = text.slice(i + 2, close);
            if (bodyIsSane(body)) {
              pushMath(i, 2, close, 2, next === '[');
              continue;
            }
          }
        } else if (o.environments && next === 'b') {
          var m = /^\\begin\{([A-Za-z*]+)\}/.exec(text.slice(i, i + 40));
          if (m && ENV_SET[m[1]]) {
            var endTag = '\\end{' + m[1] + '}';
            var closeE = text.indexOf(endTag, i + m[0].length);
            if (closeE > 0 && closeE - i <= o.maxLength) {
              pushMath(i, 0, closeE + endTag.length, 0, true);
              continue;
            }
          }
        }

        // `\$`, `\\`, `\%`, … — consume the escape pair so the escaped
        // character can never open a delimiter of its own.
        i += next ? 2 : 1;
        continue;
      }

      if (ch === '$') {
        if (text.charAt(i + 1) === '$') {
          var closeD = findUnescaped(text, '$$', i + 2);
          var limitD = searchLimit(text, i + 2, o.maxLength + 2);
          if (closeD >= 0 && closeD <= limitD && bodyIsSane(text.slice(i + 2, closeD))) {
            pushMath(i, 2, closeD, 2, true);
            continue;
          }
          i += 2;
          continue;
        }

        if (o.singleDollar) {
          var closeS = findInlineDollarClose(text, i, o.maxLength);
          if (closeS > 0) {
            var bodyS = text.slice(i + 1, closeS);
            if (bodyIsSane(bodyS) && !looksLikeCurrency(bodyS)) {
              pushMath(i, 1, closeS, 1, false);
              continue;
            }
          }
        }
      }

      i++;
    }

    pushText(n);
    return segments;
  }

  /** Cheap pre-check: is there anything in this string worth rendering? */
  function hasMath(text, opts) {
    if (text.indexOf('$') < 0 && text.indexOf('\\') < 0) return false;
    var segs = scan(text, opts);
    for (var i = 0; i < segs.length; i++) if (segs[i].type === 'math') return true;
    return false;
  }

  return {
    scan: scan,
    hasMath: hasMath,
    ENVIRONMENTS: ENVIRONMENTS,
    DEFAULTS: DEFAULTS,
    _internals: {
      isEscaped: isEscaped,
      findInlineDollarClose: findInlineDollarClose,
      looksLikeCurrency: looksLikeCurrency
    }
  };
});
