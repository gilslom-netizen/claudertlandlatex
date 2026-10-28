/*!
 * boot.js - Wires everything together on the page.
 *
 * The loop is deliberately boring: watch for DOM changes, wait for a block to
 * stop changing, then render its math and set its direction. Waiting for the
 * text to settle is what keeps us out of the way while Claude is still
 * streaming an answer - we never fight the page for the same nodes.
 */
(function (root) {
  'use strict';
  var CLH = root.CLH = root.CLH || {};

  // Containers that hold conversation text. Tried in order; whatever matches
  // is used, and if none does we fall back to the main region so the extension
  // keeps working after a redesign.
  var MESSAGE_SELECTORS = [
    '[data-testid="user-message"]',
    '[data-testid="assistant-message"]',
    '[data-test-render-count] .font-claude-message',
    '.font-claude-message',
    '.font-claude-response',
    '[data-is-streaming]'
  ];

  var MIN_DELAY = 50;
  var MAX_ERRORS = 8;

  var state = CLH.state = {
    settings: (CLH.Settings ? CLH.Settings.normalize(null) : null),
    blocks: new WeakMap(),
    observer: null,
    timer: null,
    timerDue: 0,
    errors: 0,
    disabled: false,
    passes: 0
  };

  function now() {
    return Date.now();
  }

  /** djb2 over the block's source text: cheap and good enough to spot edits. */
  function signature(text) {
    var h = 5381;
    for (var i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
    return h + ':' + text.length;
  }

  function uniqueOutermost(elements) {
    var out = [];
    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];
      var nested = false;
      for (var j = 0; j < elements.length; j++) {
        if (i !== j && elements[j] !== el && elements[j].contains(el)) { nested = true; break; }
      }
      if (!nested && out.indexOf(el) < 0) out.push(el);
    }
    return out;
  }

  /**
   * The subtrees to work on.
   *
   * `isMessage` marks a container we are confident holds one answer: only
   * those get a direction of their own, because flipping a whole region of the
   * app - toolbars and all - is not what anyone asked for.
   */
  function findRoots() {
    var scope = state.settings.scope;
    if (scope !== 'page') {
      var found = [];
      for (var i = 0; i < MESSAGE_SELECTORS.length; i++) {
        var nodes = document.querySelectorAll(MESSAGE_SELECTORS[i]);
        for (var j = 0; j < nodes.length; j++) found.push(nodes[j]);
      }
      if (found.length) {
        return uniqueOutermost(found).map(function (element) {
          return { element: element, isMessage: true };
        });
      }
      if (scope === 'messages') return [];
    }
    var main = document.querySelector('main') || document.body;
    return main ? [{ element: main, isMessage: false }] : [];
  }

  /** Per-paragraph direction in the composer, done with CSS only. */
  function markComposers() {
    if (!state.settings.rtl.enabled || !state.settings.rtl.composer) return;
    var nodes = document.querySelectorAll('[contenteditable="true"], textarea');
    for (var i = 0; i < nodes.length; i++) {
      if (!nodes[i].classList.contains('clh-composer')) nodes[i].classList.add('clh-composer');
    }
  }

  /**
   * Has the page thrown our work away since we did it? A framework that
   * re-renders a paragraph puts the source text back, and the text alone
   * cannot tell us - it reads the same either way.
   */
  function isStale(block, record, settings) {
    if (settings.math.enabled &&
        record.mathCount !== block.getElementsByClassName('clh-math').length) return true;
    if (settings.rtl.enabled && record.dir &&
        block.getAttribute('data-clh-dir') !== record.dir) return true;
    return false;
  }

  function processRoot(root) {
    var scope = root.element;
    var DomText = CLH.DomText;
    var settings = state.settings;
    var blocks = CLH.Rtl.collectBlocks(scope);
    var deadline = now();
    var pendingSoon = 0;
    var undecided = [];
    var touched = false;

    for (var i = 0; i < blocks.length; i++) {
      var block = blocks[i];
      var model = DomText.buildTextModel(block);

      // Scaffolding - a row, a wrapper, a turn - holds no text of its own.
      // It gets no direction: on a flex or grid container that would move the
      // boxes, and there is nothing there to read either way.
      if (!model.hasInline) continue;
      if (!model.text || !model.text.trim()) continue;

      var sig = signature(model.text);
      var record = state.blocks.get(block);

      if (!record || record.sig !== sig) {
        // New or edited text: let it settle before touching it.
        state.blocks.set(block, { sig: sig, at: deadline, done: false, mathCount: 0, dir: null });
        pendingSoon++;
        continue;
      }

      if (record.done) {
        if (!isStale(block, record, settings)) continue;
        record.done = false;
        record.at = deadline;
        pendingSoon++;
        continue;
      }

      if (deadline - record.at < settings.settleMs) {
        pendingSoon++;
        continue;
      }

      if (settings.math.enabled) {
        if (CLH.Math.processBlock(block, settings, model)) {
          touched = true;
          model = DomText.buildTextModel(block);
        }
      }
      // After math, so a formula's own source is never rewritten; before
      // direction, so the letters of "sub" and "sup" do not vote.
      if (settings.fixHtmlTags && CLH.HtmlTags.repairBlock(model)) {
        touched = true;
        model = DomText.buildTextModel(block);
      }
      if (settings.rtl.enabled) {
        if (CLH.Rtl.applyBlock(block, model, settings)) touched = true;
        else undecided.push(block);
      }

      record.done = true;
      record.sig = signature(DomText.buildTextModel(block).text);
      record.mathCount = block.getElementsByClassName('clh-math').length;
      record.dir = block.getAttribute('data-clh-dir');
    }

    // Blocks whose own text says nothing - a lone formula, a bare number -
    // read with the blocks beside them, once those have been decided.
    for (var u = 0; u < undecided.length; u++) {
      var inherited = CLH.Rtl.inheritDirection(undecided[u]);
      if (!inherited) continue;
      CLH.Rtl.setDirection(undecided[u], inherited);
      touched = true;
      var pending = state.blocks.get(undecided[u]);
      if (pending) pending.dir = undecided[u].getAttribute('data-clh-dir');
    }

    if (settings.rtl.enabled && touched) CLH.Rtl.applyContainers(scope, settings);
    return pendingSoon;
  }

  function pass() {
    state.timer = null;
    state.timerDue = 0;
    if (state.disabled || !state.settings || !state.settings.enabled) return;

    var pendingSoon = 0;
    try {
      markComposers();
      var roots = findRoots();
      for (var i = 0; i < roots.length; i++) pendingSoon += processRoot(roots[i]);
      state.passes++;
    } catch (err) {
      state.errors++;
      if (state.errors >= MAX_ERRORS) {
        state.disabled = true;
        console.warn('[claude-rtl-latex] disabled after repeated errors:', err);
      }
    } finally {
      // Drop the mutations we just caused; only the page should wake us.
      if (state.observer) state.observer.takeRecords();
    }

    if (pendingSoon) schedule(state.settings.settleMs + 20);
  }

  function schedule(delay) {
    var wait = Math.max(MIN_DELAY, delay || MIN_DELAY);
    var due = now() + wait;
    if (state.timer && state.timerDue <= due) return;   // an earlier run is coming
    if (state.timer) clearTimeout(state.timer);
    state.timerDue = due;
    state.timer = setTimeout(pass, wait);
  }

  function isOurs(node) {
    var el = node && node.nodeType === 1 ? node : (node ? node.parentElement : null);
    if (!el) return false;
    return !!(el.closest && el.closest('.clh-math, .clh-math-source'));
  }

  function onMutations(records) {
    for (var i = 0; i < records.length; i++) {
      if (!isOurs(records[i].target)) {
        schedule(MIN_DELAY);
        return;
      }
    }
  }

  function startObserver() {
    if (state.observer) return;
    state.observer = new MutationObserver(onMutations);
    state.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  /** Forget what we know and look at the page again from scratch. */
  function reset() {
    state.blocks = new WeakMap();
    state.disabled = false;
    state.errors = 0;
    schedule(MIN_DELAY);
  }

  function applySettings(next) {
    var previous = state.settings;
    state.settings = next;

    // Unwind everything and derive it again from the source text. Settings
    // change rarely, and a full re-derivation is the only way a narrower rule
    // - "stop treating $…$ as math" - can take back what a wider one rendered.
    try { CLH.Math.restoreAll(document.body); } catch (err) { /* ignore */ }
    try { CLH.HtmlTags.restoreAll(document.body); } catch (err) { /* ignore */ }
    try { CLH.Rtl.clearAll(document.body); } catch (err) { /* ignore */ }

    if (!next.enabled) {
      var composers = document.querySelectorAll('.clh-composer');
      for (var i = 0; i < composers.length; i++) composers[i].classList.remove('clh-composer');
    }

    document.documentElement.classList.toggle('clh-active', !!next.enabled);
    if (previous && previous.rtl.forceCodeLtr && !next.rtl.forceCodeLtr) {
      var pres = document.querySelectorAll('.clh-code-ltr');
      for (var j = 0; j < pres.length; j++) pres[j].classList.remove('clh-code-ltr');
    }
    reset();
  }

  function watchSettings() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.onChanged) return;
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'sync' || !changes[CLH.Settings.STORAGE_KEY]) return;
      applySettings(CLH.Settings.normalize(changes[CLH.Settings.STORAGE_KEY].newValue));
    });
  }

  function start() {
    CLH.Settings.load().then(function (settings) {
      state.settings = settings;
      document.documentElement.classList.toggle('clh-active', !!settings.enabled);
      CLH.Copy.install();
      watchSettings();
      startObserver();
      schedule(MIN_DELAY);
      // A single-page app keeps rebuilding the conversation; a few early
      // passes cover the first render before the observer has much to say.
      setTimeout(function () { schedule(MIN_DELAY); }, 500);
      setTimeout(function () { schedule(MIN_DELAY); }, 1500);
    });
  }

  CLH.Boot = {
    start: start,
    pass: pass,
    schedule: schedule,
    reset: reset,
    applySettings: applySettings,
    findRoots: findRoots,
    signature: signature,
    MESSAGE_SELECTORS: MESSAGE_SELECTORS
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
