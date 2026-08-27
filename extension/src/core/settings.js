/*!
 * settings.js — Default settings, merging and validation.
 *
 * Shared by the content script, the options page and the unit tests.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.CLH = root.CLH || {};
    root.CLH.Settings = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var STORAGE_KEY = 'clh:settings';

  var DEFAULTS = {
    // Master switch.
    enabled: true,

    math: {
      enabled: true,
      // `$ ... $` as inline math. Turn off if you discuss prices a lot.
      singleDollar: true,
      // Bare `\begin{align} ... \end{align}` blocks.
      environments: true,
      // Show KaTeX's red error text. Off by default: an expression KaTeX
      // cannot parse is left exactly as Claude wrote it.
      showErrors: false,
      // Custom `\newcommand`-style macros, e.g. {"\\RR": "\\mathbb{R}"}.
      macros: {}
    },

    rtl: {
      enabled: true,
      // 'auto' | 'first-strong' | 'majority' — see core/bidi.js.
      mode: 'auto',
      rtlThreshold: 0.45,
      // Per-paragraph direction in the message composer (CSS only).
      composer: true,
      // Keep code blocks left-to-right even inside an RTL answer.
      forceCodeLtr: true
    },

    // Copying rendered math yields the original LaTeX source.
    copyAsLatex: true,

    // How long a paragraph must stay unchanged before we touch it, in ms.
    // Streaming text is left alone until it settles, which keeps us out of
    // Claude's way while it is still writing.
    settleMs: 350,

    // 'auto'     — known message containers, falling back to the main region
    // 'messages' — known message containers only
    // 'page'     — the whole main region
    scope: 'auto'
  };

  var MODES = ['auto', 'first-strong', 'majority'];
  var SCOPES = ['auto', 'messages', 'page'];

  function isPlainObject(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
  }

  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  function bool(v, fallback) {
    return typeof v === 'boolean' ? v : fallback;
  }

  function num(v, fallback, min, max) {
    var n = typeof v === 'number' ? v : parseFloat(v);
    if (!isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function oneOf(v, list, fallback) {
    return list.indexOf(v) >= 0 ? v : fallback;
  }

  /** Keep only string→string entries; anything else would break KaTeX. */
  function sanitizeMacros(v) {
    var out = {};
    if (!isPlainObject(v)) return out;
    for (var k in v) {
      if (Object.prototype.hasOwnProperty.call(v, k) &&
          typeof k === 'string' && k && typeof v[k] === 'string') {
        out[k] = v[k];
      }
    }
    return out;
  }

  /**
   * Merge stored settings over the defaults, dropping anything malformed.
   * Never throws: a corrupt store degrades to defaults, field by field.
   */
  function normalize(stored) {
    var d = clone(DEFAULTS);
    if (!isPlainObject(stored)) return d;

    d.enabled = bool(stored.enabled, d.enabled);
    d.copyAsLatex = bool(stored.copyAsLatex, d.copyAsLatex);
    d.settleMs = Math.round(num(stored.settleMs, d.settleMs, 0, 5000));
    d.scope = oneOf(stored.scope, SCOPES, d.scope);

    var m = isPlainObject(stored.math) ? stored.math : {};
    d.math.enabled = bool(m.enabled, d.math.enabled);
    d.math.singleDollar = bool(m.singleDollar, d.math.singleDollar);
    d.math.environments = bool(m.environments, d.math.environments);
    d.math.showErrors = bool(m.showErrors, d.math.showErrors);
    d.math.macros = sanitizeMacros(m.macros);

    var r = isPlainObject(stored.rtl) ? stored.rtl : {};
    d.rtl.enabled = bool(r.enabled, d.rtl.enabled);
    d.rtl.mode = oneOf(r.mode, MODES, d.rtl.mode);
    d.rtl.rtlThreshold = num(r.rtlThreshold, d.rtl.rtlThreshold, 0, 1);
    d.rtl.composer = bool(r.composer, d.rtl.composer);
    d.rtl.forceCodeLtr = bool(r.forceCodeLtr, d.rtl.forceCodeLtr);

    return d;
  }

  /** Read settings from chrome.storage, falling back to defaults on error. */
  function load() {
    return new Promise(function (resolve) {
      try {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.sync) {
          resolve(clone(DEFAULTS));
          return;
        }
        chrome.storage.sync.get(STORAGE_KEY, function (items) {
          if (chrome.runtime && chrome.runtime.lastError) {
            resolve(clone(DEFAULTS));
            return;
          }
          resolve(normalize(items && items[STORAGE_KEY]));
        });
      } catch (err) {
        resolve(clone(DEFAULTS));
      }
    });
  }

  function save(settings) {
    return new Promise(function (resolve, reject) {
      var payload = {};
      payload[STORAGE_KEY] = normalize(settings);
      try {
        chrome.storage.sync.set(payload, function () {
          var err = chrome.runtime && chrome.runtime.lastError;
          if (err) reject(new Error(err.message)); else resolve(payload[STORAGE_KEY]);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  return {
    STORAGE_KEY: STORAGE_KEY,
    DEFAULTS: DEFAULTS,
    MODES: MODES,
    SCOPES: SCOPES,
    normalize: normalize,
    load: load,
    save: save,
    clone: clone
  };
});
