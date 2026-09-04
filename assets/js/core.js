/* =====================================================================
   Web Utility Suite — Shared Core (core.js)
   Classic script (no ES modules) so every app runs by opening index.html
   directly from the file system. Exposes a single global: window.WUS
   ===================================================================== */
(function () {
  'use strict';

  var NS = 'wus';

  /* ----------------------------- Storage ----------------------------- */
  var store = {
    get: function (key, fallback) {
      try {
        var v = localStorage.getItem(NS + '.' + key);
        return v === null ? fallback : JSON.parse(v);
      } catch (e) { return fallback; }
    },
    set: function (key, val) {
      try { localStorage.setItem(NS + '.' + key, JSON.stringify(val)); return true; }
      catch (e) { return false; }
    },
    remove: function (key) {
      try { localStorage.removeItem(NS + '.' + key); } catch (e) {}
    }
  };

  /* ------------------------------ Theme ------------------------------ */
  var THEME_KEY = 'theme';
  function applyTheme(t) { document.documentElement.setAttribute('data-theme', t); }
  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }
  function initTheme() {
    var t = store.get(THEME_KEY, null);
    if (t !== 'light' && t !== 'dark') {
      t = (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
    }
    applyTheme(t);
    return t;
  }
  function toggleTheme() {
    var next = currentTheme() === 'light' ? 'dark' : 'light';
    applyTheme(next);
    store.set(THEME_KEY, next);
    document.dispatchEvent(new CustomEvent('wus:theme', { detail: next }));
    return next;
  }
  /* Wire up any [data-theme-toggle] button automatically once DOM is ready */
  function wireThemeToggle() {
    var btns = document.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () { toggleTheme(); });
    }
  }

  /* ------------------------------ Toast ------------------------------ */
  var toastWrap = null;
  function ensureToastWrap() {
    if (!toastWrap) {
      toastWrap = document.createElement('div');
      toastWrap.className = 'toast-wrap';
      toastWrap.setAttribute('role', 'status');
      toastWrap.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastWrap);
    }
    return toastWrap;
  }
  function toast(msg, type, ms) {
    var wrap = ensureToastWrap();
    var el = document.createElement('div');
    el.className = 'toast' + (type === 'error' ? ' --error' : '');
    var dot = document.createElement('span'); dot.className = 'dot';
    var span = document.createElement('span'); span.textContent = msg;
    el.appendChild(dot); el.appendChild(span);
    wrap.appendChild(el);
    var life = ms || 2400;
    setTimeout(function () {
      el.classList.add('--out');
      setTimeout(function () { el.remove(); }, 320);
    }, life);
    return el;
  }

  /* ---------------------------- Clipboard ---------------------------- */
  function copy(text, okMsg) {
    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch (e) { return false; }
    }
    return new Promise(function (resolve) {
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(function () {
          toast(okMsg || 'Copied to clipboard'); resolve(true);
        }).catch(function () {
          var ok = fallback();
          toast(ok ? (okMsg || 'Copied to clipboard') : 'Copy failed', ok ? '' : 'error');
          resolve(ok);
        });
      } else {
        var ok = fallback();
        toast(ok ? (okMsg || 'Copied to clipboard') : 'Copy failed', ok ? '' : 'error');
        resolve(ok);
      }
    });
  }

  /* ---------------------------- Download ----------------------------- */
  function download(filename, content, mime) {
    var blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1200);
  }

  /* -------------------------- File reading --------------------------- */
  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
      r.readAsText(file);
    });
  }

  /* ---------------------------- Shortcuts ---------------------------- */
  var shortcuts = [];
  function registerShortcut(combo, handler, desc) {
    shortcuts.push({ combo: combo, handler: handler, desc: desc || '' });
  }
  function comboMatches(e, combo) {
    var parts = combo.toLowerCase().split('+').map(function (s) { return s.trim(); });
    var key = parts[parts.length - 1];
    var needMod = parts.indexOf('ctrl') > -1 || parts.indexOf('cmd') > -1 || parts.indexOf('mod') > -1;
    var needShift = parts.indexOf('shift') > -1;
    var needAlt = parts.indexOf('alt') > -1;
    var hasMod = e.ctrlKey || e.metaKey;
    if (needMod !== hasMod) return false;
    if (needAlt !== e.altKey) return false;
    /* Enforce shift state only for alphanumeric keys; symbol keys (?, /, +)
       are often produced with shift, so we don't reject on it. */
    if (key.length === 1 && /[a-z0-9]/.test(key)) {
      if (needShift !== e.shiftKey) return false;
    } else if (needShift && !e.shiftKey) {
      return false;
    }
    var pressed = e.key.toLowerCase();
    if (key === 'esc') key = 'escape';
    if (key === 'space') key = ' ';
    return pressed === key;
  }
  document.addEventListener('keydown', function (e) {
    var tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
    var typing = tag === 'input' || tag === 'textarea' || tag === 'select' || (e.target && e.target.isContentEditable);
    for (var i = 0; i < shortcuts.length; i++) {
      var s = shortcuts[i];
      /* Always allow combos that use a modifier; bare keys ignored while typing */
      var usesMod = /ctrl|cmd|mod|alt/.test(s.combo.toLowerCase());
      if (typing && !usesMod) continue;
      if (comboMatches(e, s.combo)) { e.preventDefault(); s.handler(e); return; }
    }
  });

  /* --------------------------- Misc helpers -------------------------- */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function debounce(fn, ms) {
    var t;
    return function () {
      var ctx = this, args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, ms);
    };
  }
  function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }
  function uid() {
    return 'id-' + Math.floor(performance.now() * 1000).toString(36) + '-' + (uid._n = (uid._n || 0) + 1).toString(36);
  }
  function formatDate(ts) {
    try { return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); }
    catch (e) { return new Date(ts).toString(); }
  }
  /* tiny element helper: el('div', {class:'x'}, [children|text]) */
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') node.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
      else if (attrs[k] !== false && attrs[k] != null) node.setAttribute(k, attrs[k]);
    }
    if (children != null) {
      if (!Array.isArray(children)) children = [children];
      children.forEach(function (c) {
        if (c == null) return;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return node;
  }

  /* ------------------------------ Init ------------------------------- */
  initTheme();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireThemeToggle);
  } else {
    wireThemeToggle();
  }

  window.WUS = {
    store: store,
    initTheme: initTheme, toggleTheme: toggleTheme, applyTheme: applyTheme, currentTheme: currentTheme,
    toast: toast, copy: copy, download: download, readFile: readFile,
    registerShortcut: registerShortcut, shortcuts: shortcuts,
    escapeHtml: escapeHtml, debounce: debounce, clamp: clamp, uid: uid, formatDate: formatDate, el: el
  };
})();
