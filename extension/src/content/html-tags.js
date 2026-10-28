/*!
 * html-tags.js - Turns literal `<sub>` / `<sup>` text back into real sub- and
 * superscripts.
 *
 * Claude sometimes writes subscripts as HTML - `a<sub>n</sub>` - where no
 * Unicode subscript character exists (there is a ₁ but no usable ₙ). The chat
 * renders raw HTML as text, so the reader gets the tags instead of the
 * subscript. Only these two tags are touched, only with short plain content,
 * and never inside code or math. The new elements are built with textContent,
 * never by parsing markup, so nothing else can sneak in.
 *
 * Like the math renderer, the original text node is kept hidden next to the
 * result, so the change can always be undone.
 */
(function (root) {
  'use strict';
  var CLH = root.CLH = root.CLH || {};

  // <sub>…</sub> or <sup>…</sup> with short content and no markup inside.
  var TAG = /<(sub|sup)>([^<>\n]{1,40})<\/\1>/g;

  function repairTextNode(node) {
    var text = node.data;
    if (text.indexOf('<su') < 0) return 0;

    var doc = node.ownerDocument;
    var fragment = null;
    var last = 0;
    var count = 0;
    var match;

    TAG.lastIndex = 0;
    while ((match = TAG.exec(text))) {
      if (!fragment) fragment = doc.createDocumentFragment();
      if (match.index > last) fragment.appendChild(doc.createTextNode(text.slice(last, match.index)));
      var el = doc.createElement(match[1]);
      el.textContent = match[2];
      fragment.appendChild(el);
      last = match.index + match[0].length;
      count++;
    }
    if (!fragment || !node.parentNode) return 0;
    if (last < text.length) fragment.appendChild(doc.createTextNode(text.slice(last)));

    var wrapper = doc.createElement('span');
    wrapper.className = 'clh-tags';
    wrapper.setAttribute('data-clh-raw', text);
    node.parentNode.replaceChild(wrapper, node);
    wrapper.appendChild(fragment);

    var source = doc.createElement('span');
    source.className = 'clh-tags-source';
    source.hidden = true;
    source.appendChild(node);
    wrapper.appendChild(source);
    return count;
  }

  /**
   * Repair the block's own text. Only the model's text parts are looked at,
   * which already excludes code, rendered math and nested blocks.
   */
  function repairBlock(model) {
    var count = 0;
    for (var i = 0; i < model.parts.length; i++) {
      var part = model.parts[i];
      if (part.kind !== 'text') continue;
      try {
        count += repairTextNode(part.node);
      } catch (err) {
        // Leave this node as it was; the next pass can try again.
      }
    }
    return count;
  }

  function restore(wrapper) {
    var doc = wrapper.ownerDocument;
    var source = null;
    for (var child = wrapper.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 1 && child.className === 'clh-tags-source') { source = child; break; }
    }
    var replacement = (source && source.firstChild)
      ? source.firstChild
      : doc.createTextNode(wrapper.getAttribute('data-clh-raw') || '');
    if (wrapper.parentNode) wrapper.parentNode.replaceChild(replacement, wrapper);
  }

  function restoreAll(scope) {
    var nodes = scope.querySelectorAll('.clh-tags');
    for (var i = nodes.length - 1; i >= 0; i--) {
      try {
        restore(nodes[i]);
      } catch (err) {
        // Keep going.
      }
    }
  }

  CLH.HtmlTags = {
    repairBlock: repairBlock,
    repairTextNode: repairTextNode,
    restore: restore,
    restoreAll: restoreAll
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
