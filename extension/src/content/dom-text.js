/*!
 * dom-text.js — Linearises the inline content of a block element into a single
 * string, keeping an exact map back to the original nodes.
 *
 * This is what lets the scanner see `$\frac{a}{b}$` as one string even when the
 * markdown renderer spread it over several text nodes and `<em>` wrappers, and
 * lets us turn a match back into a precise DOM Range.
 */
(function (root) {
  'use strict';
  var CLH = root.CLH = root.CLH || {};

  // Object Replacement Character: stands in for content we must not look
  // inside and must never split, such as an inline code span.
  var OBJ = '￼';

  // Elements whose contents are opaque to the math scanner.
  var ATOM_TAGS = ['CODE', 'KBD', 'SAMP', 'PRE', 'SVG', 'IMG', 'BUTTON',
                   'INPUT', 'TEXTAREA', 'SELECT', 'VIDEO', 'CANVAS', 'IFRAME'];

  // Elements that end the current bidi paragraph. A model stops at them, so a
  // block only ever describes its own inline content and a delimiter can never
  // pair across a paragraph boundary.
  var BLOCK_LEVEL_TAGS = ['ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'CAPTION',
    'DD', 'DETAILS', 'DIALOG', 'DIV', 'DL', 'DT', 'FIELDSET', 'FIGCAPTION',
    'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER',
    'HGROUP', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'SUMMARY',
    'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL'];

  // Markdown emphasis: the source characters were consumed by the renderer, so
  // we put them back before scanning. Otherwise `$a_{i}$` rendered as
  // `$a<em>{i}</em>$` would scan as broken math.
  var EMPHASIS = { EM: '_', I: '_', STRONG: '**', B: '**', DEL: '~~', S: '~~' };

  // Atoms whose text is a human-readable label rather than code: their words
  // count towards the direction of the line they sit on.
  var LABELLED_ATOMS = { BUTTON: true, SELECT: true };

  var BLOCK_LEVEL = Object.create(null);
  for (var b = 0; b < BLOCK_LEVEL_TAGS.length; b++) BLOCK_LEVEL[BLOCK_LEVEL_TAGS[b]] = true;

  function isElement(node) {
    return node && node.nodeType === 1;
  }

  function isBlockLevel(el) {
    return !!BLOCK_LEVEL[el.tagName];
  }

  function isAtomElement(el) {
    if (ATOM_TAGS.indexOf(el.tagName) >= 0) return true;
    if (el.classList && (el.classList.contains('katex') ||
                         el.classList.contains('katex-display') ||
                         el.classList.contains('clh-math'))) return true;
    if (el.hasAttribute && el.hasAttribute('data-clh-atom')) return true;
    return false;
  }

  /** Our own rendered math contributes its LaTeX source back to the model. */
  function isOwnMath(el) {
    return isElement(el) && el.classList && el.classList.contains('clh-math') &&
           el.hasAttribute('data-clh-latex');
  }

  /**
   * Build the text model of a block.
   *
   * Returns:
   *   text   the linearised string the scanner runs on
   *   parts  ordered spans of `text`, each tied to a node
   *   sample the same content with atoms removed — used for direction
   *          detection, so a Latin-heavy formula cannot flip a Hebrew
   *          paragraph to left-to-right
   */
  function buildTextModel(block) {
    var text = '';
    var sample = '';
    var parts = [];
    var hasInline = false;

    function push(kind, node, value, sampleValue) {
      if (!value) return;
      parts.push({ kind: kind, node: node, start: text.length, end: text.length + value.length });
      text += value;
      if (sampleValue) sample += sampleValue;
      if (kind !== 'block' && (kind !== 'text' || value.trim())) hasInline = true;
    }

    function walk(node) {
      for (var child = node.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === 3) {                       // text
          push('text', child, child.data, child.data);
          continue;
        }
        if (!isElement(child)) continue;                  // comment, etc.

        if (child !== block && isBlockLevel(child)) {
          // A nested paragraph, list or table belongs to its own model. It is
          // not inline content, so a container holding nothing else has no
          // text of its own and no direction to speak of.
          push('block', child, OBJ, null);
          continue;
        }

        if (child.tagName === 'BR') {
          push('virtual', child, '\n', '\n');
          continue;
        }

        if (isOwnMath(child)) {
          push('math-atom', child, child.getAttribute('data-clh-latex'), null);
          continue;
        }

        if (isAtomElement(child)) {
          // A control's label is ordinary prose: opaque to the math scanner,
          // but it is exactly what decides which way the control reads.
          push('atom', child, OBJ, LABELLED_ATOMS[child.tagName] ? child.textContent : null);
          continue;
        }

        var marker = EMPHASIS[child.tagName];
        if (marker) {
          push('virtual', child, marker, null);
          walk(child);
          push('virtual', child, marker, null);
          continue;
        }

        walk(child);
      }
    }

    walk(block);
    return {
      block: block,
      text: text,
      sample: sample,
      parts: parts,
      // Does this block hold anything of its own, or is it only scaffolding
      // around other blocks?
      hasInline: hasInline
    };
  }

  function partAt(model, pos, preferEnd) {
    var parts = model.parts;
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (preferEnd ? (pos > p.start && pos <= p.end) : (pos >= p.start && pos < p.end)) return p;
    }
    return parts.length ? parts[parts.length - 1] : null;
  }

  function indexOfNode(node) {
    var i = 0;
    for (var n = node; (n = n.previousSibling); ) i++;
    return i;
  }

  /** Place one boundary of a Range at model position `pos`. */
  function setBoundary(range, model, pos, isStart) {
    var part = partAt(model, pos, !isStart);
    if (!part) {
      if (isStart) range.setStart(model.block, 0);
      else range.setEnd(model.block, model.block.childNodes.length);
      return;
    }

    if (part.kind === 'text') {
      var offset = Math.max(0, Math.min(part.node.data.length, pos - part.start));
      if (isStart) range.setStart(part.node, offset);
      else range.setEnd(part.node, offset);
      return;
    }

    // Atoms and synthetic emphasis markers have no character of their own to
    // point at, so snap outward to the element boundary.
    var parent = part.node.parentNode;
    if (!parent) return;
    var idx = indexOfNode(part.node);
    if (isStart) range.setStart(parent, idx);
    else range.setEnd(parent, idx + 1);
  }

  /** Turn a [start, end) span of the model text into a live DOM Range. */
  function rangeFor(model, start, end) {
    var doc = model.block.ownerDocument;
    var range = doc.createRange();
    setBoundary(range, model, start, true);
    setBoundary(range, model, end, false);
    return range;
  }

  /** Does this span cross an opaque atom (inline code, an image, …)? */
  function spanCrossesAtom(model, start, end) {
    for (var i = 0; i < model.parts.length; i++) {
      var p = model.parts[i];
      if (p.kind !== 'atom' && p.kind !== 'block') continue;
      if (p.start < end && p.end > start) return true;
    }
    return false;
  }

  /**
   * Is this span exactly one already-rendered math element with the same
   * source? Then there is nothing to do — the common case while streaming.
   */
  function spanIsRendered(model, start, end, raw) {
    for (var i = 0; i < model.parts.length; i++) {
      var p = model.parts[i];
      if (p.kind !== 'math-atom') continue;
      if (p.start === start && p.end === end) {
        return p.node.getAttribute('data-clh-latex') === raw ? p.node : null;
      }
    }
    return null;
  }

  CLH.DomText = {
    OBJ: OBJ,
    ATOM_TAGS: ATOM_TAGS,
    BLOCK_LEVEL_TAGS: BLOCK_LEVEL_TAGS,
    EMPHASIS: EMPHASIS,
    isBlockLevel: isBlockLevel,
    buildTextModel: buildTextModel,
    rangeFor: rangeFor,
    spanCrossesAtom: spanCrossesAtom,
    spanIsRendered: spanIsRendered,
    isAtomElement: isAtomElement,
    isOwnMath: isOwnMath
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
