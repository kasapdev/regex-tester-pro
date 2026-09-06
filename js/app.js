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

  var explainPanel = document.getElementById('explainPanel');
  var explainList  = document.getElementById('explainList');

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
     PLAIN-ENGLISH EXPLANATION
     Walks the pattern source (not the compiled RegExp — JS exposes no
     AST) into a flat, depth-tagged list of {depth, token, desc} rows,
     one per atom/group boundary/alternation, in source order. Only
     ever called on a pattern that already compiled successfully via
     `new RegExp(pattern, flags)`, and still defensively try/caught by
     the caller since this hand-written scanner doesn't re-validate
     full regex grammar.
     ================================================================= */
  function explainRegex(pattern, flags) {
    var entries = [];
    var depth = 0;
    var i = 0;
    var n = pattern.length;
    var groupCounter = 0;
    var multiline = flags.indexOf('m') > -1;
    var dotAll = flags.indexOf('s') > -1;
    var META = '\\^$.|?*+()[]{}';

    function isMeta(ch) { return ch !== undefined && META.indexOf(ch) > -1; }
    function isQuantStart(ch) { return ch === '*' || ch === '+' || ch === '?' || ch === '{'; }

    function pushRow(token, desc) {
      entries.push({ depth: depth, token: token, desc: desc });
    }

    // Consume a quantifier at the current position, if any, WITHOUT requiring
    // one to be there. Returns {text, desc} and advances i, or returns null
    // and leaves i untouched.
    function tryConsumeQuantifier() {
      var c = pattern[i];
      var start = i;
      var desc;
      if (c === '{') {
        var m = /^\{(\d+)(,(\d*))?\}/.exec(pattern.slice(i));
        if (!m) return null; // not a real quantifier (e.g. literal "{abc}") — leave as-is
        i += m[0].length;
        var min = m[1], hasComma = m[2] !== undefined, max = m[3];
        if (!hasComma) desc = 'exactly ' + min + (min === '1' ? ' time' : ' times');
        else if (!max) desc = min + ' or more times';
        else desc = 'between ' + min + ' and ' + max + ' times';
      } else if (c === '*' || c === '+' || c === '?') {
        i++;
        desc = c === '*' ? 'zero or more times' : c === '+' ? 'one or more times' : 'zero or one time (optional)';
      } else {
        return null;
      }
      if (pattern[i] === '?') { i++; desc += ', as few times as possible (lazy)'; }
      return { text: pattern.slice(start, i), desc: desc };
    }

    function applyTrailingQuantifier() {
      var q = tryConsumeQuantifier();
      if (q && entries.length) {
        var row = entries[entries.length - 1];
        row.token += q.text;
        row.desc += ', ' + q.desc;
      }
    }

    function readCharClass() {
      var start = i;
      i++; // skip [
      if (pattern[i] === '^') i++;
      while (i < n && pattern[i] !== ']') {
        if (pattern[i] === '\\') i += 2; else i++;
      }
      if (i < n) i++; // skip closing ]
      var text = pattern.slice(start, i);
      var neg = text.charAt(1) === '^';
      var inner = text.slice(neg ? 2 : 1, -1);
      pushRow(text, (neg ? 'any character NOT in the set: ' : 'any character in the set: ') + (inner || '(empty)'));
    }

    function describeSimpleEscape(seq) {
      switch (seq) {
        case '\\d': return 'a digit (0-9)';
        case '\\D': return 'a non-digit character';
        case '\\w': return 'a word character (letter, digit, or underscore)';
        case '\\W': return 'a non-word character';
        case '\\s': return 'a whitespace character';
        case '\\S': return 'a non-whitespace character';
        case '\\b': return 'a word boundary';
        case '\\B': return 'not a word boundary';
        case '\\n': return 'a newline';
        case '\\r': return 'a carriage return';
        case '\\t': return 'a tab';
        case '\\f': return 'a form feed';
        case '\\v': return 'a vertical tab';
        case '\\0': return 'a NUL character';
        default: return 'the literal character "' + seq.slice(1) + '"';
      }
    }

    function readEscape() {
      var start = i;
      i++; // skip backslash
      var c = pattern[i];
      if (c === undefined) { pushRow('\\', 'a literal backslash'); return; }
      if (c === 'u') {
        i++;
        if (pattern[i] === '{') {
          var end = pattern.indexOf('}', i);
          i = end === -1 ? n : end + 1;
        } else {
          i += 4;
        }
        var text = pattern.slice(start, i);
        pushRow(text, 'the Unicode code point ' + text);
        return;
      }
      if (c === 'x') {
        i += 3;
        pushRow(pattern.slice(start, i), 'the character ' + pattern.slice(start, i));
        return;
      }
      if (c === 'k' && pattern[i + 1] === '<') {
        var end2 = pattern.indexOf('>', i);
        var closeAt = end2 === -1 ? n : end2 + 1;
        var name = pattern.slice(start + 3, end2 === -1 ? n : end2);
        i = closeAt;
        pushRow(pattern.slice(start, i), 'backreference to the "' + name + '" group');
        return;
      }
      if (/[1-9]/.test(c)) {
        var j = i;
        while (j < n && /[0-9]/.test(pattern[j])) j++;
        i = j;
        pushRow(pattern.slice(start, i), 'backreference to group ' + pattern.slice(start + 1, i));
        return;
      }
      i++;
      var seq = pattern.slice(start, i);
      pushRow(seq, describeSimpleEscape(seq));
    }

    function readGroup() {
      var openStart = i;
      i++; // skip (
      var openLabel, closeLabel;
      if (pattern[i] === '?') {
        var c2 = pattern[i + 1];
        if (c2 === ':') { i += 2; openLabel = 'non-capturing group:'; closeLabel = 'end of group'; }
        else if (c2 === '=') { i += 2; openLabel = 'lookahead — must be followed by:'; closeLabel = 'end of lookahead'; }
        else if (c2 === '!') { i += 2; openLabel = 'negative lookahead — must NOT be followed by:'; closeLabel = 'end of negative lookahead'; }
        else if (c2 === '<' && pattern[i + 2] === '=') { i += 3; openLabel = 'lookbehind — must be preceded by:'; closeLabel = 'end of lookbehind'; }
        else if (c2 === '<' && pattern[i + 2] === '!') { i += 3; openLabel = 'negative lookbehind — must NOT be preceded by:'; closeLabel = 'end of negative lookbehind'; }
        else if (c2 === '<') {
          var end = pattern.indexOf('>', i + 2);
          var name = pattern.slice(i + 2, end === -1 ? n : end);
          i = end === -1 ? n : end + 1;
          groupCounter++;
          openLabel = 'capturing group ' + groupCounter + ' (named "' + name + '"):';
          closeLabel = 'end of group ' + groupCounter + ' ("' + name + '")';
        } else { i++; openLabel = 'special group construct:'; closeLabel = 'end of group'; }
      } else {
        groupCounter++;
        openLabel = 'capturing group ' + groupCounter + ':';
        closeLabel = 'end of group ' + groupCounter;
      }
      pushRow(pattern.slice(openStart, i), openLabel);
      depth++;
      parseBody(true);
      depth--;
      if (pattern[i] === ')') i++;
      pushRow(')', closeLabel);
      applyTrailingQuantifier();
    }

    function parseBody(stopAtParen) {
      while (i < n) {
        var c = pattern[i];
        if (c === ')') {
          if (stopAtParen) return;
          i++; continue; // stray/unbalanced — shouldn't happen on a compiled pattern
        }
        if (c === '|') { pushRow('|', 'OR — matches either what comes before or after this point'); i++; continue; }
        if (c === '(') { readGroup(); continue; }
        if (c === '[') { readCharClass(); applyTrailingQuantifier(); continue; }
        if (c === '\\') { readEscape(); applyTrailingQuantifier(); continue; }
        if (c === '^') { pushRow('^', multiline ? 'the start of a line (multiline mode)' : 'the start of the string'); i++; applyTrailingQuantifier(); continue; }
        if (c === '$') { pushRow('$', multiline ? 'the end of a line (multiline mode)' : 'the end of the string'); i++; applyTrailingQuantifier(); continue; }
        if (c === '.') { pushRow('.', dotAll ? 'any character, including line breaks' : 'any character except line breaks'); i++; applyTrailingQuantifier(); continue; }
        if (c === '*' || c === '+' || c === '?' || c === '{') {
          var dangling = tryConsumeQuantifier();
          if (dangling) pushRow(dangling.text, 'the literal text "' + dangling.text + '" (no preceding token to repeat)');
          else { pushRow(c, 'the character "' + c + '"'); i++; }
          continue;
        }
        // Literal run: greedily consume plain characters, but stop one
        // character early whenever the next character is about to be
        // quantified (so e.g. "abc+" splits into "ab" and a quantified "c").
        var start = i;
        i++;
        while (i < n && !isMeta(pattern[i]) && !isQuantStart(pattern[i + 1])) i++;
        var run = pattern.slice(start, i);
        pushRow(run, (run.length === 1 ? 'the character "' : 'the characters "') + run + '"');
        applyTrailingQuantifier();
      }
    }

    parseBody(false);
    return entries;
  }

  function renderExplanation(pattern, flags) {
    if (!pattern) { explainPanel.hidden = true; explainList.innerHTML = ''; return; }
    try {
      var rows = explainRegex(pattern, flags);
      if (!rows.length) { explainPanel.hidden = true; explainList.innerHTML = ''; return; }
      explainList.innerHTML = '';
      rows.forEach(function (r) {
        var row = document.createElement('div');
        row.className = 'explain-row';
        row.style.paddingLeft = (6 + r.depth * 18) + 'px';
        var tok = document.createElement('span');
        tok.className = 'explain-token';
        tok.textContent = r.token;
        var desc = document.createElement('span');
        desc.className = 'explain-desc';
        desc.textContent = r.desc;
        row.appendChild(tok);
        row.appendChild(desc);
        explainList.appendChild(row);
      });
      explainPanel.hidden = false;
    } catch (e) {
      // Defensive: never let an explanation-rendering bug break the tester.
      explainPanel.hidden = true;
      explainList.innerHTML = '';
      // eslint-disable-next-line no-console
      console.error('[explain] failed to explain pattern:', e);
    }
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
      renderExplanation('', flags);
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
      renderExplanation('', flags);
      showError(e.message);
      setStatus('error', 'Invalid pattern');
      return;
    }

    renderHighlight(text, matches);
    renderStats(matches);
    renderMatchList(matches, parseGroupNames(pattern));
    updateReplace(pattern, flags, text);
    renderExplanation(pattern, flags);
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
