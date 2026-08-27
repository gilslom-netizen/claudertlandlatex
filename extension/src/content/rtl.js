/*!
 * rtl.js - Gives every paragraph, list item, heading and table cell the base
 * direction its own text calls for.
 *
 * Direction is decided per block, not per message, so a Hebrew answer that
 * quotes an English sentence - or the other way round - stays readable in both
 * halves. Formulas and code spans are excluded from the decision: they are
 * always Latin and would otherwise drag a Hebrew paragraph left to right.
 */
(function (root) {
  'use strict';
  var CLH = root.CLH = root.CLH || {};

  // Never look inside these.
  var SKIP_TAGS = ['PRE', 'CODE', 'SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'SELECT',
                   'SVG', 'CANVAS', 'VIDEO', 'AUDIO', 'IFRAME', 'NOSCRIPT'];

  var SKIP_SET = Object.create(null);
  for (var s = 0; s < SKIP_TAGS.length; s++) SKIP_SET[SKIP_TAGS[s]] = true;

  function isSkipped(el) {
    if (SKIP_SET[el.tagName]) return true;
    if (el.isContentEditable) return true;
    if (el.classList && (el.classList.contains('katex') || el.classList.contains('clh-math'))) return true;
    return el.hasAttribute('data-clh-skip');
  }

  /**
   * Collect every block-level element of a subtree, in document order.
   *
   * A model built for one of these covers only its own inline content - nested
   * blocks stop the walk - so a candidate that turns out to hold nothing but
   * other blocks simply produces an empty model and is skipped by the caller.
   */
  function collectBlocks(scope) {
    var DomText = CLH.DomText;
    var blocks = [];
    (function walk(el) {
      for (var child = el.firstElementChild; child; child = child.nextElementSibling) {
        if (child.nodeType !== 1 || isSkipped(child)) continue;
        if (DomText.isBlockLevel(child)) blocks.push(child);
        walk(child);
      }
    })(scope);
    return blocks;
  }

  function setDirection(el, dir) {
    if (el.getAttribute('data-clh-dir') === dir && el.getAttribute('dir') === dir) return false;
    el.setAttribute('dir', dir);
    el.setAttribute('data-clh-dir', dir);
    if (el.classList) {
      el.classList.toggle('clh-rtl', dir === 'rtl');
      el.classList.toggle('clh-ltr', dir === 'ltr');
    }
    return true;
  }

  function clearDirection(el) {
    if (!el.hasAttribute('data-clh-dir')) return;
    el.removeAttribute('data-clh-dir');
    el.removeAttribute('dir');
    if (el.classList) {
      el.classList.remove('clh-rtl');
      el.classList.remove('clh-ltr');
    }
  }

  /**
   * The direction of a container that holds directional children: whichever
   * side more of them chose. Keeps list bullets and table columns on the side
   * the reader expects.
   */
  function majorityDirection(container, selector) {
    var kids = container.querySelectorAll(selector);
    var rtl = 0, ltr = 0;
    for (var i = 0; i < kids.length; i++) {
      var dir = kids[i].getAttribute('data-clh-dir');
      if (dir === 'rtl') rtl++;
      else if (dir === 'ltr') ltr++;
    }
    if (!rtl && !ltr) return null;
    return rtl > ltr ? 'rtl' : 'ltr';
  }

  /**
   * Apply direction to one block. `previous` is the direction of the block
   * before it, used when this one has no directional letter of its own - a
   * lone formula or a bare number inherits the paragraph around it.
   */
  function applyBlock(block, model, settings, previous) {
    var Bidi = CLH.Bidi;
    var sample = model ? model.sample : block.textContent;
    var dir = Bidi.detectDirection(sample, {
      mode: settings.rtl.mode,
      rtlThreshold: settings.rtl.rtlThreshold
    });
    if (!dir) dir = previous;
    if (!dir) return null;
    setDirection(block, dir);
    return dir;
  }

  /** Second pass: containers whose direction follows their children. */
  function applyContainers(scope, settings) {
    var lists = scope.querySelectorAll('ul, ol');
    var i, dir;
    for (i = 0; i < lists.length; i++) {
      dir = majorityDirection(lists[i], ':scope > li[data-clh-dir]');
      if (dir) setDirection(lists[i], dir);
    }
    var tables = scope.querySelectorAll('table');
    for (i = 0; i < tables.length; i++) {
      dir = majorityDirection(tables[i], 'td[data-clh-dir], th[data-clh-dir]');
      if (dir) setDirection(tables[i], dir);
    }
    if (settings.rtl.forceCodeLtr) {
      var pres = scope.querySelectorAll('pre');
      for (i = 0; i < pres.length; i++) {
        pres[i].setAttribute('dir', 'ltr');
        pres[i].setAttribute('data-clh-dir', 'ltr');
        if (pres[i].classList) pres[i].classList.add('clh-code-ltr');
      }
    }
  }

  /** Give the message container the direction most of its blocks chose. */
  function applyRootDirection(scope) {
    var dir = majorityDirection(scope, '[data-clh-dir]');
    if (dir) setDirection(scope, dir);
    return dir;
  }

  /** Undo everything this module did, for when the user turns RTL off. */
  function clearAll(scope) {
    var nodes = scope.querySelectorAll('[data-clh-dir]');
    for (var i = 0; i < nodes.length; i++) clearDirection(nodes[i]);
    if (scope.hasAttribute && scope.hasAttribute('data-clh-dir')) clearDirection(scope);
    var codes = scope.querySelectorAll('.clh-code-ltr');
    for (var j = 0; j < codes.length; j++) codes[j].classList.remove('clh-code-ltr');
  }

  CLH.Rtl = {
    collectBlocks: collectBlocks,
    applyBlock: applyBlock,
    applyContainers: applyContainers,
    applyRootDirection: applyRootDirection,
    setDirection: setDirection,
    clearAll: clearAll,
    isSkipped: isSkipped
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
