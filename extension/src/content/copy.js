/*!
 * copy.js - Copying a rendered formula puts its LaTeX source on the clipboard.
 *
 * Without this, selecting a paragraph that contains rendered math yields the
 * glyph soup KaTeX lays out, which pastes back as nonsense. Here the selection
 * is rebuilt with every formula written the way Claude wrote it, so a copied
 * answer can be pasted straight into a LaTeX document.
 */
(function (root) {
  'use strict';
  var CLH = root.CLH = root.CLH || {};

  // Elements that start a new line when serialised back to plain text.
  var LINE_BREAKERS = ['P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
                       'BLOCKQUOTE', 'PRE', 'TR', 'SECTION', 'ARTICLE', 'HR',
                       'TABLE', 'UL', 'OL', 'DL', 'DT', 'DD', 'FIGURE'];

  var BREAK_SET = Object.create(null);
  for (var i = 0; i < LINE_BREAKERS.length; i++) BREAK_SET[LINE_BREAKERS[i]] = true;

  /** Plain-text serialisation of a detached fragment (innerText needs layout). */
  function serialize(node) {
    var out = [];

    (function walk(current) {
      for (var child = current.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === 3) {
          out.push(child.data);
          continue;
        }
        if (child.nodeType !== 1) continue;
        if (child.tagName === 'BR') {
          out.push('\n');
          continue;
        }
        var breaks = !!BREAK_SET[child.tagName];
        if (breaks) out.push('\n');
        walk(child);
        if (breaks) out.push('\n');
      }
    })(node);

    return out.join('')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\n+|\n+$/g, '');
  }

  /** The LaTeX source behind an element KaTeX rendered, or null. */
  function katexSource(el) {
    var annotation = el.querySelector('annotation[encoding="application/x-tex"]');
    if (!annotation) return null;
    var text = annotation.textContent;
    if (!text || !text.trim()) return null;
    var display = el.classList.contains('katex-display') ||
                  (el.parentElement && el.parentElement.classList.contains('katex-display'));
    return display ? '$$' + text + '$$' : '$' + text + '$';
  }

  /**
   * Rewrite a cloned selection so that math reads as LaTeX again.
   * Returns true when anything was replaced.
   */
  function rewriteMath(fragment) {
    var doc = fragment.ownerDocument || document;
    var changed = false;
    var i, el, source;

    // Our own rendering keeps the exact source, delimiters included.
    var ours = fragment.querySelectorAll('.clh-math[data-clh-latex]');
    for (i = 0; i < ours.length; i++) {
      el = ours[i];
      if (!el.parentNode) continue;
      el.parentNode.replaceChild(doc.createTextNode(el.getAttribute('data-clh-latex')), el);
      changed = true;
    }

    // Math the page rendered itself carries its source in MathML.
    var theirs = fragment.querySelectorAll('.katex');
    for (i = 0; i < theirs.length; i++) {
      el = theirs[i];
      if (!el.parentNode) continue;
      source = katexSource(el);
      if (!source) continue;
      var target = (el.parentElement && el.parentElement.classList.contains('katex-display'))
        ? el.parentElement : el;
      if (!target.parentNode) continue;
      target.parentNode.replaceChild(doc.createTextNode(source), target);
      changed = true;
    }

    // Leftover hidden source holders would otherwise be copied twice.
    var hidden = fragment.querySelectorAll('.clh-math-source, .clh-tags-source');
    for (i = 0; i < hidden.length; i++) {
      if (hidden[i].parentNode) hidden[i].parentNode.removeChild(hidden[i]);
    }

    return changed;
  }

  function onCopy(event) {
    try {
      if (!CLH.state || !CLH.state.settings.enabled || !CLH.state.settings.copyAsLatex) return;
      var selection = root.getSelection ? root.getSelection() : null;
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;

      var container = document.createElement('div');
      for (var r = 0; r < selection.rangeCount; r++) {
        container.appendChild(selection.getRangeAt(r).cloneContents());
      }
      if (!container.querySelector('.clh-math, .katex, .clh-math-source, .clh-tags-source')) return;
      if (!rewriteMath(container)) return;

      var text = serialize(container);
      if (!text) return;
      event.clipboardData.setData('text/plain', text);
      event.preventDefault();
    } catch (err) {
      // Never break a plain copy because of us.
    }
  }

  function install() {
    document.addEventListener('copy', onCopy, true);
  }

  CLH.Copy = {
    install: install,
    serialize: serialize,
    rewriteMath: rewriteMath,
    katexSource: katexSource
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
