/*!
 * options.js - The settings page, which doubles as the toolbar popup.
 *
 * Every control writes straight to chrome.storage; open tabs pick the change up
 * through storage.onChanged, so there is no "apply" button to forget.
 */
(function () {
  'use strict';

  var Settings = globalThis.CLH.Settings;
  var current = Settings.normalize(null);
  var saveTimer = null;

  function $(id) {
    return document.getElementById(id);
  }

  var fields = {
    enabled: $('enabled'),
    mathEnabled: $('math-enabled'),
    singleDollar: $('math-single-dollar'),
    environments: $('math-environments'),
    showErrors: $('math-show-errors'),
    macros: $('math-macros'),
    macrosError: $('macros-error'),
    rtlEnabled: $('rtl-enabled'),
    rtlMode: $('rtl-mode'),
    rtlThreshold: $('rtl-threshold'),
    rtlThresholdValue: $('rtl-threshold-value'),
    thresholdRow: $('threshold-row'),
    composer: $('rtl-composer'),
    forceCodeLtr: $('rtl-force-code-ltr'),
    copyAsLatex: $('copy-as-latex'),
    fixHtmlTags: $('fix-html-tags'),
    settleMs: $('settle-ms'),
    settleValue: $('settle-value'),
    scope: $('scope'),
    reset: $('reset'),
    status: $('status')
  };

  function render(settings) {
    current = settings;
    fields.enabled.checked = settings.enabled;
    fields.mathEnabled.checked = settings.math.enabled;
    fields.singleDollar.checked = settings.math.singleDollar;
    fields.environments.checked = settings.math.environments;
    fields.showErrors.checked = settings.math.showErrors;

    var macros = settings.math.macros || {};
    fields.macros.value = Object.keys(macros).length ? JSON.stringify(macros, null, 2) : '';

    fields.rtlEnabled.checked = settings.rtl.enabled;
    fields.rtlMode.value = settings.rtl.mode;
    fields.rtlThreshold.value = Math.round(settings.rtl.rtlThreshold * 100);
    fields.composer.checked = settings.rtl.composer;
    fields.forceCodeLtr.checked = settings.rtl.forceCodeLtr;

    fields.copyAsLatex.checked = settings.copyAsLatex;
    fields.fixHtmlTags.checked = settings.fixHtmlTags;
    fields.settleMs.value = settings.settleMs;
    fields.scope.value = settings.scope;

    syncLabels();
  }

  function syncLabels() {
    fields.rtlThresholdValue.textContent = fields.rtlThreshold.value + '%';
    fields.settleValue.textContent = fields.settleMs.value + 'ms';
    fields.thresholdRow.hidden = fields.rtlMode.value !== 'auto';
    document.body.classList.toggle('off', !fields.enabled.checked);
  }

  /** Read the form. Returns null when the macro JSON is not usable yet. */
  function collect() {
    var macros = {};
    var raw = fields.macros.value.trim();
    var macrosOk = true;
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
        macros = parsed;
      } catch (err) {
        macrosOk = false;
        macros = current.math.macros;
      }
    }
    fields.macrosError.hidden = macrosOk;

    return {
      settings: {
        enabled: fields.enabled.checked,
        math: {
          enabled: fields.mathEnabled.checked,
          singleDollar: fields.singleDollar.checked,
          environments: fields.environments.checked,
          showErrors: fields.showErrors.checked,
          macros: macros
        },
        rtl: {
          enabled: fields.rtlEnabled.checked,
          mode: fields.rtlMode.value,
          rtlThreshold: parseInt(fields.rtlThreshold.value, 10) / 100,
          composer: fields.composer.checked,
          forceCodeLtr: fields.forceCodeLtr.checked
        },
        copyAsLatex: fields.copyAsLatex.checked,
        fixHtmlTags: fields.fixHtmlTags.checked,
        settleMs: parseInt(fields.settleMs.value, 10),
        scope: fields.scope.value
      },
      macrosOk: macrosOk
    };
  }

  function status(message) {
    fields.status.textContent = message;
    if (message) setTimeout(function () { fields.status.textContent = ''; }, 1600);
  }

  function save() {
    var result = collect();
    Settings.save(result.settings).then(function (stored) {
      current = stored;
      status(result.macrosOk ? 'נשמר' : 'נשמר (מלבד המאקרו)');
    }, function () {
      status('השמירה נכשלה');
    });
  }

  function onInput() {
    syncLabels();
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 250);
  }

  function bind() {
    var inputs = document.querySelectorAll('input, select, textarea');
    for (var i = 0; i < inputs.length; i++) {
      inputs[i].addEventListener('change', onInput);
      inputs[i].addEventListener('input', onInput);
    }
    fields.reset.addEventListener('click', function () {
      render(Settings.normalize(null));
      save();
    });
  }

  Settings.load().then(function (settings) {
    render(settings);
    bind();
  });
})();
