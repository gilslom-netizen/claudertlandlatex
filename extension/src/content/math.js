/*!
 * math.js - Renders LaTeX found in a block with KaTeX and swaps it into the DOM.
 *
 * Design rules that keep this safe on a live React page:
 *   - the original source nodes are never destroyed, only hidden inside the
 *     rendered element, so the text can always be restored;
 *   - every expression keeps its exact source in `data-clh-latex`, which makes
 *     the pass idempotent and copy-to-clipboard faithful;
 *   - KaTeX output is built through DOMParser rather than innerHTML, so a page
 *     with Trusted Types enforcement cannot reject it.
 */
(function (root) {
  'use strict';
  var CLH = root.CLH = root.CLH || {};

  var templateCache = new Map();   // key -> parsed template element
  var failureCache = new Set();    // key -> KaTeX could not parse it
  var MAX_CACHE = 500;

  function katexLib() {
    if (root.katex) return root.katex;
    return typeof katex !== 'undefined' ? katex : null;
  }

  function cacheKey(latex, display) {
    return (display ? 'D ' : 'I ') + latex;
  }

  /**
   * KaTeX warns on every character it has no metrics for - every Hebrew letter,
   * on every render. Keep the page console usable.
   */
  function withQuietWarnings(fn) {
    var original = console.warn;
    try {
      console.warn = function (msg) {
        if (typeof msg === 'string' && msg.indexOf('No character metrics') >= 0) return;
        return original.apply(console, arguments);
      };
      return fn();
    } finally {
      console.warn = original;
    }
  }

  function katexOptions(display, settings) {
    var macros = {};
    var src = (settings.math && settings.math.macros) || {};
    for (var k in src) {
      if (Object.prototype.hasOwnProperty.call(src, k)) macros[k] = src[k];
    }
    return {
      displayMode: !!display,
      output: 'htmlAndMathml',
      // Hebrew inside \text{} is a normal thing to write; do not complain.
      strict: 'ignore',
      trust: false,
      throwOnError: true,
      macros: macros,      // KaTeX mutates this, so it must be a fresh copy
      maxSize: 40,
      maxExpand: 1000
    };
  }

  /** Parse an HTML string into nodes without ever touching an innerHTML sink. */
  function parseTemplate(html) {
    var doc = new DOMParser().parseFromString('<span>' + html + '</span>', 'text/html');
    return doc.body.firstElementChild;
  }

  /**
   * KaTeX emits each run of characters as its own span and lays them out in DOM
   * order, which is left to right. A single Hebrew run is fine - the browser
   * reorders inside it - but two adjacent RTL runs would appear swapped. Wrap
   * such a group in an RTL box so the browser puts them back in reading order.
   */
  function groupRtlRuns(scope) {
    var Bidi = CLH.Bidi;
    if (!Bidi) return;

    function isRtlSpan(el) {
      return !!el && el.nodeType === 1 && el.tagName === 'SPAN' &&
             el.children.length === 0 && Bidi.hasRtl(el.textContent);
    }

    function flush(parent, run) {
      if (run.length < 2) return;
      var wrapper = parent.ownerDocument.createElement('span');
      wrapper.className = 'clh-rtl-run';
      wrapper.setAttribute('dir', 'rtl');
      parent.insertBefore(wrapper, run[0]);
      for (var i = 0; i < run.length; i++) wrapper.appendChild(run[i]);
    }

    function collectRuns(parent) {
      var run = [];
      var child = parent.firstElementChild;
      while (child) {
        var next = child.nextElementSibling;
        if (isRtlSpan(child)) {
          run.push(child);
        } else {
          flush(parent, run);
          run = [];
        }
        child = next;
      }
      flush(parent, run);
    }

    var parents = scope.querySelectorAll('.mord, .mrel, .mbin, .base');
    for (var i = 0; i < parents.length; i++) collectRuns(parents[i]);
    collectRuns(scope);
  }

  /**
   * Render one expression. Returns a template element whose children are the
   * rendered nodes, or null when KaTeX cannot parse it - in which case the
   * caller leaves the source text exactly as Claude wrote it.
   */
  function renderTemplate(latex, display, settings) {
    var key = cacheKey(latex, display);
    if (failureCache.has(key)) return null;
    var cached = templateCache.get(key);
    if (cached) return cached;

    var lib = katexLib();
    if (!lib) return null;

    var html = null;
    withQuietWarnings(function () {
      try {
        html = lib.renderToString(latex, katexOptions(display, settings));
      } catch (err) {
        if (settings.math && settings.math.showErrors) {
          try {
            var opts = katexOptions(display, settings);
            opts.throwOnError = false;
            html = lib.renderToString(latex, opts);
          } catch (ignored) {
            html = null;
          }
        }
      }
    });

    if (html == null) {
      if (failureCache.size < MAX_CACHE) failureCache.add(key);
      return null;
    }

    var template;
    try {
      template = parseTemplate(html);
      groupRtlRuns(template);
    } catch (err) {
      return null;
    }

    if (templateCache.size >= MAX_CACHE) templateCache.clear();
    templateCache.set(key, template);
    return template;
  }

  /** Build the element that replaces the source text of one expression. */
  function buildMathElement(doc, segment, template) {
    var el = doc.createElement('span');
    el.className = 'clh-math' + (segment.display ? ' clh-math-display' : '');
    el.setAttribute('dir', 'ltr');
    el.setAttribute('data-clh-latex', segment.raw);
    el.setAttribute('data-clh-atom', '');

    var rendered = doc.createElement('span');
    rendered.className = 'clh-math-render';
    for (var child = template.firstChild; child; child = child.nextSibling) {
      rendered.appendChild(doc.importNode(child, true));
    }
    el.appendChild(rendered);
    return el;
  }

  /** Put a rendered expression back to its LaTeX source. */
  function restore(el) {
    var latex = el.getAttribute('data-clh-latex');
    var doc = el.ownerDocument;
    var replacement = null;

    // Prefer the original nodes we tucked away - they may still be owned by
    // the page's framework.
    var holder = null;
    for (var child = el.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 1 && child.className === 'clh-math-source') {
        holder = child;
        break;
      }
    }

    if (holder && holder.firstChild) {
      replacement = doc.createDocumentFragment();
      while (holder.firstChild) replacement.appendChild(holder.firstChild);
    } else {
      replacement = doc.createTextNode(latex == null ? '' : latex);
    }
    if (el.parentNode) el.parentNode.replaceChild(replacement, el);
  }

  function restoreAll(scope) {
    var nodes = scope.querySelectorAll('.clh-math[data-clh-latex]');
    for (var i = nodes.length - 1; i >= 0; i--) {
      try {
        restore(nodes[i]);
      } catch (err) {
        // Keep going: one stuck expression must not block the rest.
      }
    }
  }

  /**
   * Render every expression in one block.
   *
   * Returns the number of expressions rendered. Zero means the DOM was not
   * touched at all - the steady state while nothing changes.
   */
  function processBlock(block, settings, providedModel) {
    var DomText = CLH.DomText;
    var LatexScan = CLH.LatexScan;
    if (!LatexScan || !DomText) return 0;

    var scanOpts = {
      singleDollar: settings.math.singleDollar,
      environments: settings.math.environments
    };

    var model = providedModel || DomText.buildTextModel(block);
    if (!LatexScan.hasMath(model.text, scanOpts)) return 0;

    var segments = LatexScan.scan(model.text, scanOpts);
    var i, seg;
    var pending = 0;
    for (i = 0; i < segments.length; i++) {
      seg = segments[i];
      if (seg.type !== 'math') continue;
      if (DomText.spanCrossesAtom(model, seg.start, seg.end)) continue;
      if (DomText.spanIsRendered(model, seg.start, seg.end, seg.raw)) continue;
      pending++;
    }
    if (!pending) return 0;

    // Something changed. Unwind every expression in this block and render the
    // whole block from its source, so a partially streamed expression that
    // just gained its closing delimiter is picked up correctly.
    restoreAll(block);
    model = DomText.buildTextModel(block);
    segments = LatexScan.scan(model.text, scanOpts);

    var doc = block.ownerDocument;
    var work = [];
    for (i = 0; i < segments.length; i++) {
      seg = segments[i];
      if (seg.type !== 'math') continue;
      if (DomText.spanCrossesAtom(model, seg.start, seg.end)) continue;
      var template = renderTemplate(seg.value, seg.display, settings);
      if (!template) continue;
      work.push({ segment: seg, template: template });
    }
    if (!work.length) return 0;

    // Replace from the end so the earlier offsets stay valid.
    var rendered = 0;
    for (var w = work.length - 1; w >= 0; w--) {
      var item = work[w];
      try {
        var range = DomText.rangeFor(model, item.segment.start, item.segment.end);
        var el = buildMathElement(doc, item.segment, item.template);
        var source = doc.createElement('span');
        source.className = 'clh-math-source';
        source.setAttribute('aria-hidden', 'true');
        source.hidden = true;
        source.appendChild(range.extractContents());
        el.appendChild(source);
        range.insertNode(el);
        rendered++;
      } catch (err) {
        // A range that no longer matches the DOM (the page re-rendered while
        // we worked) is skipped; the next pass tries again.
      }
    }
    return rendered;
  }

  CLH.Math = {
    processBlock: processBlock,
    restore: restore,
    restoreAll: restoreAll,
    renderTemplate: renderTemplate,
    groupRtlRuns: groupRtlRuns,
    _caches: { templateCache: templateCache, failureCache: failureCache }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
