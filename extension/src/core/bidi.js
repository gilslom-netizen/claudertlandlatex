/*!
 * bidi.js — Direction detection for mixed Hebrew / Arabic / Latin text.
 *
 * Pure logic, no DOM. Shared by the content script and the unit tests.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.CLH = root.CLH || {};
    root.CLH.Bidi = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Strongly right-to-left blocks: Hebrew, Arabic, Syriac, Thaana, N'Ko,
  // Samaritan, Mandaic, Arabic Extended-A and the two presentation-form blocks.
  var RTL_RANGES = [
    [0x0590, 0x05FF], [0x0600, 0x07BF], [0x07C0, 0x08FF],
    [0xFB1D, 0xFB4F], [0xFB50, 0xFDFF], [0xFE70, 0xFEFF]
  ];

  // Characters inside the RTL blocks that carry no direction of their own
  // (Arabic-Indic digits, tatweel, combining marks) must not decide a
  // paragraph's direction.
  var RTL_NEUTRALS = [
    [0x0600, 0x0605], [0x0640, 0x0640], [0x0660, 0x066C], [0x0670, 0x0670],
    [0x06DD, 0x06DD], [0x06F0, 0x06F9], [0x08E2, 0x08E2],
    [0x0591, 0x05BD], [0x05BF, 0x05BF], [0x05C1, 0x05C2],
    [0x05C4, 0x05C5], [0x05C7, 0x05C7]
  ];

  // Explicit bidi controls — ignored when sampling text.
  var BIDI_CONTROLS = /[‎‏؜‪-‮⁦-⁩]/g;

  var LATIN_LIKE = /[A-Za-zÀ-ɏɐ-ʯͰ-֏Ѐ-ԯḀ-῿]/;
  var CJK_LIKE = /[぀-ヿ㐀-䶿一-鿿가-힯]/;

  var DEFAULTS = {
    // 'auto'        — first strong character decides, but a Latin opener is
    //                 overridden when the paragraph is mostly RTL.
    // 'first-strong' — plain Unicode first-strong heuristic (UAX #9 P2/P3).
    // 'majority'    — whichever script has more letters wins.
    mode: 'auto',
    // Share of strong letters that must be RTL for 'auto' to override a
    // Latin first character. 0.45 keeps an English paragraph that quotes a
    // Hebrew phrase left-to-right.
    rtlThreshold: 0.45
  };

  function inRanges(code, ranges) {
    for (var i = 0; i < ranges.length; i++) {
      if (code >= ranges[i][0] && code <= ranges[i][1]) return true;
    }
    return false;
  }

  function isRtlChar(ch) {
    var code = ch.charCodeAt(0);
    if (code < 0x0590) return false;
    return inRanges(code, RTL_RANGES) && !inRanges(code, RTL_NEUTRALS);
  }

  function isLtrChar(ch) {
    var code = ch.charCodeAt(0);
    if (code < 0x0041) return false;
    if (isRtlChar(ch)) return false;
    return LATIN_LIKE.test(ch) || CJK_LIKE.test(ch);
  }

  function clean(text) {
    return String(text == null ? '' : text).replace(BIDI_CONTROLS, '');
  }

  /** UAX #9 first-strong direction: 'rtl', 'ltr' or null when undetermined. */
  function firstStrong(text) {
    var s = clean(text);
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (isRtlChar(ch)) return 'rtl';
      if (isLtrChar(ch)) return 'ltr';
    }
    return null;
  }

  /** Count strongly directional letters on each side. */
  function countStrong(text) {
    var s = clean(text);
    var rtl = 0, ltr = 0;
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (isRtlChar(ch)) rtl++;
      else if (isLtrChar(ch)) ltr++;
    }
    return { rtl: rtl, ltr: ltr, total: rtl + ltr };
  }

  /** Share of strong letters that are RTL, 0 when there are none. */
  function rtlRatio(text) {
    var c = countStrong(text);
    return c.total === 0 ? 0 : c.rtl / c.total;
  }

  /**
   * Decide the base direction of one paragraph.
   *
   * Returns 'rtl', 'ltr', or null when the text holds no directional letter at
   * all (a lone formula, a number, a bullet) — the caller then inherits the
   * direction of the surrounding block, which is what a reader expects.
   */
  function detectDirection(text, opts) {
    var mode = (opts && opts.mode) || DEFAULTS.mode;
    var threshold = (opts && typeof opts.rtlThreshold === 'number')
      ? opts.rtlThreshold : DEFAULTS.rtlThreshold;

    var counts = countStrong(text);
    if (counts.total === 0) return null;

    if (mode === 'majority') return counts.rtl > counts.ltr ? 'rtl' : 'ltr';

    var first = firstStrong(text);
    if (mode === 'first-strong') return first;

    // 'auto': a Hebrew sentence that happens to open with a Latin technical
    // term ("LaTeX הוא ...") should still be laid out right-to-left.
    if (first === 'ltr' && counts.rtl / counts.total >= threshold) return 'rtl';
    return first;
  }

  /** Does this string contain any RTL letter at all? */
  function hasRtl(text) {
    var s = clean(text);
    for (var i = 0; i < s.length; i++) if (isRtlChar(s.charAt(i))) return true;
    return false;
  }

  return {
    DEFAULTS: DEFAULTS,
    isRtlChar: isRtlChar,
    isLtrChar: isLtrChar,
    firstStrong: firstStrong,
    countStrong: countStrong,
    rtlRatio: rtlRatio,
    detectDirection: detectDirection,
    hasRtl: hasRtl
  };
});
