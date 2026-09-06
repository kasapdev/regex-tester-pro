/* =====================================================================
   Regex Tester Pro — app.js
   Live regex matching, nested group highlighting, replace-preview, and
   pattern presets — all via native RegExp. Classic script (no modules).
   Depends on window.WUS (core.js).
   ===================================================================== */
(function () {
  'use strict';

  var WUS = window.WUS;
  var STORE_KEY = 'regextester.state';
  var MAX_MATCHES = 2000;

  /* ----------------------------- DOM refs ---------------------------- */
  var patternInput = document.getElementById('patternInput');
  var flagsInput   = document.getElementById('flagsInput');
  var presetSelect = document.getElementById('presetSelect');
  var btnCopyPattern = document.getElementById('btnCopyPattern');
  var btnClear = document.getElementById('btnClear');

  var statusBadge = document.getElementById('statusBadge');
  var statusText  = document.getElementById('statusText');

  var errorPanel = document.getElementById('errorPanel');
  var errorMsg   = document.getElementById('errorMsg');

  var testInput  = document.getElementById('testInput');
  var inputStats = document.getElementById('inputStats');

  var highlightOutput = document.getElementById('highlightOutput');
  var highlightCode   = document.getElementById('highlightCode');
  var highlightEmpty  = document.getElementById('highlightEmpty');
  var matchStatsEl    = document.getElementById('matchStats');

  var statsBar    = document.getElementById('statsBar');
  var statMatches = document.getElementById('statMatches');
  var statGroups  = document.getElementById('statGroups');
  var statNamed   = document.getElementById('statNamed');

  var matchList      = document.getElementById('matchList');
  var matchListEmpty = document.getElementById('matchListEmpty');

  var replacementInput = document.getElementById('replacementInput');
  var replaceOutput    = document.getElementById('replaceOutput');
  var btnCopyReplace   = document.getElementById('btnCopyReplace');

  var lastReplaceResult = '';

  /* =================================================================
     FEATURE DETECT — the 'd' (hasIndices) flag, used for group spans
     ================================================================= */
  var SUPPORTS_INDICES = (function () {
    try { return !!(new RegExp('a', 'd')); } catch (e) { return false; }
  })();

  /* =================================================================
     PRESETS
     ================================================================= */
  var PRESETS = {
    email:  { pattern: '[\\w.+-]+@[\\w-]+\\.[A-Za-z]{2,}', flags: 'g' },
    url:    { pattern: 'https?:\\/\\/[^\\s<>"\']+', flags: 'g' },
    ipv4:   { pattern: '\\b(?:(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\b', flags: 'g' },
    hex:    { pattern: '#(?:[0-9a-fA-F]{3}){1,2}\\b', flags: 'g' },
    phone:  { pattern: '\\(?\\d{3}\\)?[-.\\s]?\\d{3}[-.\\s]?\\d{4}', flags: 'g' },
    isodate:{ pattern: '\\b\\d{4}-\\d{2}-\\d{2}\\b', flags: 'g' }
  };

  presetSelect.addEventListener('change', function () {
    var p = PRESETS[presetSelect.value];
    if (!p) return;
    patternInput.value = p.pattern;
    flagsInput.value = p.flags;
    presetSelect.value = '';
    recompute();
    persist();
  });

  /* =================================================================
     STATUS helpers
     ================================================================= */
  function setStatus(state, text) {
    statusBadge.classList.remove('is-valid', 'is-error');
    if (state) statusBadge.classList.add('is-' + state);
    statusText.textContent = text;
  }
  function showError(msg) { errorMsg.textContent = msg; errorPanel.hidden = false; }
  function clearError() { errorPanel.hidden = true; }

  /* =================================================================
     NESTED RANGE RENDERER
     Builds a containment tree from a flat list of {start,end,cls,title}
     ranges (properly nested / disjoint, as regex match+group ranges
     always are) and renders escaped text with nested <span>s.
     ================================================================= */
  function buildRangeTree(ranges, textLen) {
    var sorted = ranges.slice().sort(function (a, b) {
      if (a.start !== b.start) return a.start - b.start;
      var lenA = a.end - a.start, lenB = b.end - b.start;
      if (lenA !== lenB) return lenB - lenA; // longer (outer) first
      return (a.pri || 0) - (b.pri || 0);
    });
    var root = { start: 0, end: textLen, children: [] };
    var stack = [root];
    sorted.forEach(function (r) {
      while (stack.length > 1 && stack[stack.length - 1].end <= r.start) stack.pop();
      r.children = [];
      stack[stack.length - 1].children.push(r);
      stack.push(r);
    });
    return root;
  }

  function renderRangeTree(node, text) {
    var out = '';
    var cursor = node.start;
    node.children.forEach(function (child) {
      if (child.start > cursor) out += WUS.escapeHtml(text.slice(cursor, child.start));
      var titleAttr = child.title ? ' title="' + WUS.escapeHtml(child.title) + '"' : '';
      out += '<span class="' + child.cls + '"' + titleAttr + '>';
      out += renderRangeTree(child, text);
      out += '</span>';
      cursor = child.end;
    });
    if (node.end > cursor) out += WUS.escapeHtml(text.slice(cursor, node.end));
    return out;
  }

  /* =================================================================
     MATCHING ENGINE
     ================================================================= */
  function forcedFlags(flags) {
    var f = flags.indexOf('g') === -1 ? flags + 'g' : flags;
    if (SUPPORTS_INDICES && f.indexOf('d') === -1) f += 'd';
    return f;
  }

  function collectMatches(pattern, flags, text) {
    var re = new RegExp(pattern, forcedFlags(flags));
    var matches = [];
    var m;
    var guard = 0;
    while ((m = re.exec(text)) !== null) {
      matches.push(m);
      guard++;
      if (m[0].length === 0) re.lastIndex++; // avoid infinite loop on zero-length matches
      if (guard >= MAX_MATCHES) break;
    }
    return matches;
  }

  function groupNamesOf(pattern) {
    var names = [];
    var re = /\(\?<([a-zA-Z_$][\w$]*)>/g;
    var m;
    while ((m = re.exec(pattern)) !== null) names.push(m[1]);
    return names;
  }

  // Maps each capturing group's 1-based index to its name (or null if unnamed),
  // by walking the pattern source itself — NOT by comparing captured values.
  // (Matching by value is ambiguous: two different groups can legitimately
  // capture the same text, e.g. /(?<year>\d{4})-(\d{4})/ on "2024-2024".)
  function parseGroupNames(pattern) {
    var names = [];
    var inClass = false;
    for (var i = 0; i < pattern.length; i++) {
      var ch = pattern[i];
      if (ch === '\\') { i++; continue; } // skip escaped character
      if (inClass) {
        if (ch === ']') inClass = false;
        continue;
      }
      if (ch === '[') { inClass = true; continue; }
      if (ch !== '(') continue;
      if (pattern[i + 1] === '?') {
        var c2 = pattern[i + 2];
        if (c2 === ':' || c2 === '=' || c2 === '!') continue; // non-capturing / lookahead
        if (c2 === '<') {
          var c3 = pattern[i + 3];
          if (c3 === '=' || c3 === '!') continue; // lookbehind, not capturing
          var end = pattern.indexOf('>', i + 3);
          if (end === -1) continue;
          names.push(pattern.slice(i + 3, end)); // named capturing group
          continue;
        }
        continue; // unrecognized (?...) construct — treat as non-capturing
      }
      names.push(null); // unnamed capturing group
    }
    return names;
  }

  /* =================================================================
     RENDERING
     ================================================================= */
  function renderHighlight(text, matches) {
    if (!matches.length) {
      highlightCode.innerHTML = '';
      highlightEmpty.classList.remove('is-hidden');
      return;
    }
    highlightEmpty.classList.add('is-hidden');
    var ranges = [];
    matches.forEach(function (m, i) {
      ranges.push({ start: m.index, end: m.index + m[0].length, cls: 'match-hl', title: 'Match #' + (i + 1), pri: 0 });
      if (SUPPORTS_INDICES && m.indices) {
        for (var g = 1; g < m.indices.length; g++) {
          var span = m.indices[g];
          if (!span) continue;
          if (span[1] <= span[0]) continue; // skip zero-length groups
          ranges.push({ start: span[0], end: span[1], cls: 'group-hl', title: 'Group ' + g, pri: 1 });
        }
      }
    });
    var tree = buildRangeTree(ranges, text.length);
    highlightCode.innerHTML = renderRangeTree(tree, text);
  }

  function renderMatchList(matches, groupNames) {
    matchList.innerHTML = '';
    if (!matches.length) {
      matchList.appendChild(matchListEmpty);
      matchListEmpty.hidden = false;
      return;
    }
    matchListEmpty.hidden = true;

    matches.forEach(function (m, i) {
      var item = document.createElement('div');
      item.className = 'match-item';

      var head = document.createElement('div');
      head.className = 'match-item-head';
      head.appendChild(badge('#' + (i + 1)));
      head.appendChild(badge('index ' + m.index + '–' + (m.index + m[0].length)));
      var full = document.createElement('span');
      full.className = 'full-match';
      full.textContent = m[0] || '(empty match)';
      head.appendChild(full);
      item.appendChild(head);

      if (m.length > 1) {
        var rows = document.createElement('div');
        rows.className = 'group-rows';
        for (var g = 1; g < m.length; g++) {
          var row = document.createElement('div');
          row.className = 'group-row';
          var label = document.createElement('span');
          label.className = 'g-label';
          var name = groupNames ? groupNames[g - 1] : null;
          label.textContent = 'Group ' + g + (name ? ' (' + name + ')' : '');
          var val = document.createElement('span');
          var participated = m[g] !== undefined;
          val.className = 'g-value' + (participated ? '' : ' is-undefined');
          val.textContent = participated ? m[g] : 'undefined';
          row.appendChild(label);
          row.appendChild(val);
          rows.appendChild(row);
        }
        item.appendChild(rows);
      }

      if (m.groups) {
        var namedRows = document.createElement('div');
        namedRows.className = 'group-rows';
        Object.keys(m.groups).forEach(function (n) {
          var row = document.createElement('div');
          row.className = 'group-row';
          var label = document.createElement('span');
          label.className = 'g-label'; label.textContent = '<' + n + '>';
          var val = document.createElement('span');
          var participated = m.groups[n] !== undefined;
          val.className = 'g-value' + (participated ? '' : ' is-undefined');
          val.textContent = participated ? m.groups[n] : 'undefined';
          row.appendChild(label); row.appendChild(val);
          namedRows.appendChild(row);
        });
        if (namedRows.children.length) item.appendChild(namedRows);
      }

      matchList.appendChild(item);
    });
  }

  function badge(text) {
    var span = document.createElement('span');
    span.className = 'badge';
    span.textContent = text;
    return span;
  }

  function renderStats(matches) {
    if (!matches.length) { statsBar.hidden = true; matchStatsEl.textContent = ''; return; }
    statsBar.hidden = false;
    var maxGroups = 0;
    var namedSet = {};
    matches.forEach(function (m) {
      if (m.length - 1 > maxGroups) maxGroups = m.length - 1;
      if (m.groups) Object.keys(m.groups).forEach(function (n) { namedSet[n] = true; });
    });
    statMatches.textContent = matches.length.toLocaleString() + (matches.length >= MAX_MATCHES ? '+' : '');
    statGroups.textContent = maxGroups;
    statNamed.textContent = Object.keys(namedSet).length;
    matchStatsEl.textContent = matches.length + (matches.length === 1 ? ' match' : ' matches');
  }

  /* =================================================================
     REPLACE PREVIEW
     ================================================================= */
  function updateReplace(pattern, flags, text) {
    var replacement = replacementInput.value;
    if (!pattern || !text) { replaceOutput.textContent = ''; lastReplaceResult = ''; return; }
    try {
      var re = new RegExp(pattern, flags);
      var result = text.replace(re, replacement);
      replaceOutput.textContent = result;
      lastReplaceResult = result;
    } catch (e) {
      replaceOutput.textContent = '';
      lastReplaceResult = '';
    }
  }

  /* =================================================================
     CORE RECOMPUTE
     ================================================================= */
  function recompute() {
    clearError();
    var pattern = patternInput.value;
    var flags = flagsInput.value;
    var text = testInput.value;

    if (!pattern) {
      highlightCode.innerHTML = '';
      highlightEmpty.classList.remove('is-hidden');
      matchStatsEl.textContent = '';
      statsBar.hidden = true;
      renderMatchList([], false);
      updateReplace('', flags, text);
      setStatus('', 'Ready');
      return;
    }

    var matches;
    try {
      matches = collectMatches(pattern, flags, text);
      // Validate the user's exact flags too (constructing may throw on bad flag combos).
      new RegExp(pattern, flags);
    } catch (e) {
      highlightCode.innerHTML = '';
      highlightEmpty.classList.remove('is-hidden');
      statsBar.hidden = true;
      renderMatchList([], false);
      updateReplace('', flags, text);
      showError(e.message);
      setStatus('error', 'Invalid pattern');
      return;
    }

    renderHighlight(text, matches);
    renderStats(matches);
    renderMatchList(matches, parseGroupNames(pattern));
    updateReplace(pattern, flags, text);
    setStatus('valid', matches.length ? (matches.length + ' match' + (matches.length === 1 ? '' : 'es')) : 'No matches');
  }
  var recomputeDebounced = WUS.debounce(recompute, 200);

  /* =================================================================
     ACTIONS
     ================================================================= */
  function copyPattern() {
    if (!patternInput.value) { WUS.toast('Nothing to copy', 'error'); return; }
    WUS.copy(patternInput.value, 'Pattern copied');
  }
  function copyReplaceResult() {
    if (!lastReplaceResult) { WUS.toast('Nothing to copy yet', 'error'); return; }
    WUS.copy(lastReplaceResult, 'Result copied');
  }
  function clearAll() {
    patternInput.value = '';
    flagsInput.value = '';
    testInput.value = '';
    replacementInput.value = '';
    updateInputStats();
    recompute();
    WUS.store.remove(STORE_KEY);
    patternInput.focus();
  }

  function updateInputStats() {
    var len = testInput.value.length;
    inputStats.textContent = len.toLocaleString() + (len === 1 ? ' char' : ' chars');
  }

  /* =================================================================
     PERSISTENCE
     ================================================================= */
  function persist() {
    WUS.store.set(STORE_KEY, {
      pattern: patternInput.value,
      flags: flagsInput.value,
      test: testInput.value,
      replacement: replacementInput.value
    });
  }
  var persistDebounced = WUS.debounce(persist, 400);

  function restore() {
    var saved = WUS.store.get(STORE_KEY, null);
    if (!saved) return;
    if (typeof saved.pattern === 'string') patternInput.value = saved.pattern;
    if (typeof saved.flags === 'string') flagsInput.value = saved.flags;
    if (typeof saved.test === 'string') testInput.value = saved.test;
    if (typeof saved.replacement === 'string') replacementInput.value = saved.replacement;
    updateInputStats();
    recompute();
  }

  /* =================================================================
     SHORTCUTS HELP MODAL
     ================================================================= */
  var helpBackdrop = document.getElementById('helpBackdrop');
  var helpClose    = document.getElementById('helpClose');
  var shortcutRows = document.getElementById('shortcutRows');

  var SHORTCUTS = [
    { keys: ['mod', 'K'], desc: 'Clear everything' },
    { keys: ['?'], desc: 'Show this help' },
    { keys: ['Esc'], desc: 'Close dialog' }
  ];

  function buildShortcutTable() {
    var html = '';
    SHORTCUTS.forEach(function (s) {
      var kbds = s.keys.map(function (k) { return '<kbd>' + WUS.escapeHtml(k) + '</kbd>'; }).join('');
      html += '<tr><td>' + WUS.escapeHtml(s.desc) + '</td><td>' + kbds + '</td></tr>';
    });
    shortcutRows.innerHTML = html;
  }
  function openHelp() { helpBackdrop.hidden = false; helpClose.focus(); }
  function closeHelp() { helpBackdrop.hidden = true; }
  helpClose.addEventListener('click', closeHelp);
  helpBackdrop.addEventListener('click', function (e) { if (e.target === helpBackdrop) closeHelp(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !helpBackdrop.hidden) closeHelp(); });
  var helpBtns = document.querySelectorAll('[data-shortcut-help]');
  for (var i = 0; i < helpBtns.length; i++) helpBtns[i].addEventListener('click', openHelp);

  /* =================================================================
     WIRING
     ================================================================= */
  btnCopyPattern.addEventListener('click', copyPattern);
  btnCopyReplace.addEventListener('click', copyReplaceResult);
  btnClear.addEventListener('click', clearAll);

  [patternInput, flagsInput].forEach(function (el) {
    el.addEventListener('input', function () { recomputeDebounced(); persistDebounced(); });
  });
  testInput.addEventListener('input', function () {
    updateInputStats();
    recomputeDebounced();
    persistDebounced();
  });
  replacementInput.addEventListener('input', function () {
    updateReplace(patternInput.value, flagsInput.value, testInput.value);
    persistDebounced();
  });

  WUS.registerShortcut('mod+k', function () { clearAll(); }, 'Clear everything');
  WUS.registerShortcut('?', function () { openHelp(); }, 'Show shortcuts');

  /* =================================================================
     INIT
     ================================================================= */
  buildShortcutTable();
  updateInputStats();
  restore();
})();
