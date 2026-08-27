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

  // On these, `direction` decides where the children sit, not just how the
  // text reads: setting it would slide a prompt bubble to the other side of
  // the conversation.
  var LAYOUT_DISPLAYS = {
    'flex': true, 'inline-flex': true, 'grid': true, 'inline-grid': true
  };

  // Alignment we may replace with a direction-relative one. Anything else -
  // centred, justified - was a deliberate choice by the page.
  var REPLACEABLE_ALIGN = {
    'start': true, 'end': true, 'left': true, 'right': true, '': true
  };

  function layoutFacts(el) {
    var style;
    try {
      style = el.ownerDocument.defaultView.getComputedStyle(el);
    } catch (err) {
      return { layout: false, align: false };
    }
    if (!style) return { layout: false, align: false };
    return {
      layout: !!LAYOUT_DISPLAYS[style.display],
      align: !!REPLACEABLE_ALIGN[style.textAlign]
    };
  }

  // Elements that exist to hold text. A direction belongs on them by right,
  // and their box is laid out by the flow, not by the direction.
  var TEXT_ELEMENTS = {
    P: true, LI: true, H1: true, H2: true, H3: true, H4: true, H5: true, H6: true,
    BLOCKQUOTE: true, TD: true, TH: true, CAPTION: true, DD: true, DT: true,
    FIGCAPTION: true, UL: true, OL: true, DL: true, TABLE: true, TR: true,
    THEAD: true, TBODY: true, TFOOT: true, SUMMARY: true
  };

  function boxLeft(el) {
    try {
      var rect = el.getBoundingClientRect();
      return (rect.width || rect.height) ? rect.left : null;
    } catch (err) {
      return null;
    }
  }

  function writeDirection(el, dir, mode, align) {
    el.setAttribute('data-clh-dir', dir);
    el.setAttribute('data-clh-mode', mode);
    if (mode === 'dir') el.setAttribute('dir', dir);
    else el.removeAttribute('dir');

    if (el.classList) {
      el.classList.toggle('clh-rtl', mode === 'dir' && dir === 'rtl');
      el.classList.toggle('clh-ltr', mode === 'dir' && dir === 'ltr');
      el.classList.toggle('clh-align', align);
    }
  }

  /**
   * Give one element a direction.
   *
   * On a generic container, `direction` can decide placement as much as
   * reading order - a flex row, a logical `margin-inline-start: auto`, an
   * `inset-inline` offset. Rather than guess which property is at work, we
   * check the only thing that matters: whether the element's own box moved. If
   * it did, the direction is taken back and the text is sorted out with
   * `unicode-bidi: plaintext` instead, which no layout depends on.
   */
  function setDirection(el, dir) {
    var current = el.getAttribute('data-clh-mode');
    var facts = layoutFacts(el);
    var mode = facts.layout ? 'plaintext' : 'dir';
    if (el.getAttribute('data-clh-dir') === dir &&
        (current === mode || current === 'plaintext')) {
      return false;
    }

    var before = (mode === 'dir' && !TEXT_ELEMENTS[el.tagName]) ? boxLeft(el) : null;
    writeDirection(el, dir, mode, facts.align);

    if (before !== null) {
      var after = boxLeft(el);
      if (after !== null && Math.abs(after - before) > 1) {
        writeDirection(el, dir, 'plaintext', facts.align);
      }
    }
    return true;
  }

  function clearDirection(el) {
    if (!el.hasAttribute('data-clh-dir')) return;
    el.removeAttribute('data-clh-dir');
    el.removeAttribute('data-clh-mode');
    el.removeAttribute('dir');
    if (el.classList) {
      el.classList.remove('clh-rtl');
      el.classList.remove('clh-ltr');
      el.classList.remove('clh-align');
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
   * The text a direction decision may be based on.
   *
   * Formulas are cut out, whether they have been rendered yet or not: LaTeX is
   * all Latin letters, and on the pass that renders a paragraph the source is
   * still sitting in the sample. Without this, a paragraph whose only content
   * is a formula reads as English.
   */
  function directionSample(model, settings) {
    var text = model.sample;
    var LatexScan = CLH.LatexScan;
    if (!text || !LatexScan) return text;
    if (text.indexOf('$') < 0 && text.indexOf('\\') < 0) return text;

    var segments = LatexScan.scan(text, {
      singleDollar: settings.math.singleDollar,
      environments: settings.math.environments
    });
    var out = '';
    for (var i = 0; i < segments.length; i++) {
      if (segments[i].type === 'text') out += segments[i].value;
    }
    return out;
  }

  /**
   * Work out which way one block reads, or null when its own text does not say.
   */
  function decideDirection(model, settings) {
    return CLH.Bidi.detectDirection(directionSample(model, settings), {
      mode: settings.rtl.mode,
      rtlThreshold: settings.rtl.rtlThreshold
    });
  }

  /**
   * Apply direction to one block that has text of its own. Returns the
   * direction applied, or null when the text carries no direction - the caller
   * then settles it from the blocks beside it.
   */
  function applyBlock(block, model, settings) {
    var dir = decideDirection(model, settings);
    if (!dir) return null;
    setDirection(block, dir);
    return dir;
  }

  /**
   * A block whose text says nothing about direction - a lone formula, a bare
   * number - reads with the blocks around it. Only true siblings count: a
   * paragraph must never take its direction from an unrelated part of the app.
   */
  function inheritDirection(block) {
    var sibling;
    for (sibling = block.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
      var before = sibling.getAttribute('data-clh-dir');
      if (before) return before;
    }
    for (sibling = block.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
      var after = sibling.getAttribute('data-clh-dir');
      if (after) return after;
    }
    return null;
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
    decideDirection: decideDirection,
    directionSample: directionSample,
    inheritDirection: inheritDirection,
    setDirection: setDirection,
    clearAll: clearAll,
    isSkipped: isSkipped
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
