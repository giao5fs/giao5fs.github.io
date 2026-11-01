/* Shared browser behaviour: theme toggle, syntax highlighting, copy buttons, blog filtering. */
(function () {
  'use strict';

  // Light / dark toggle (the saved choice is applied early by an inline script in <head>)
  var themeBtn = document.getElementById('theme');
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var root = document.documentElement;
      var current = root.dataset.theme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      var next = current === 'dark' ? 'light' : 'dark';
      root.dataset.theme = next;
      try { localStorage.setItem('theme', next); } catch (e) { /* storage unavailable */ }
    });
  }

  // Copy-email button on the About page
  var copyEmail = document.getElementById('copy');
  if (copyEmail) {
    var note = document.getElementById('copied');
    var mailEl = document.getElementById('mail');
    var say = function (msg) {
      note.textContent = msg;
      setTimeout(function () { note.textContent = ''; }, 2500);
    };
    copyEmail.addEventListener('click', function () {
      var selectMail = function () {
        var r = document.createRange();
        r.selectNodeContents(mailEl);
        var s = window.getSelection();
        s.removeAllRanges();
        s.addRange(r);
        say('Selected. Press Ctrl+C to copy');
      };
      try {
        navigator.clipboard.writeText(mailEl.textContent.trim()).then(function () { say('Copied to clipboard'); }, selectMail);
      } catch (e) { selectMail(); }
    });
  }

  // Syntax highlighting (highlight.js is loaded on post pages only)
  if (window.hljs) {
    document.querySelectorAll('pre code').forEach(function (el) {
      try { window.hljs.highlightElement(el); } catch (e) { /* leave plain text */ }
    });
  }

  // Copy buttons on code blocks
  document.querySelectorAll('button[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var code = btn.closest('.code').querySelector('code');
      var text = code.textContent;
      var done = function (msg) {
        btn.textContent = msg;
        setTimeout(function () { btn.textContent = 'Copy'; }, 1800);
      };
      var fallback = function () {
        var r = document.createRange();
        r.selectNodeContents(code);
        var s = window.getSelection();
        s.removeAllRanges();
        s.addRange(r);
        done('Selected');
      };
      try {
        navigator.clipboard.writeText(text).then(function () { done('Copied'); }, fallback);
      } catch (e) { fallback(); }
    });
  });

  // Blog list: tag filter (#tag in the URL) and text search
  var list = document.getElementById('postlist');
  if (!list) return;
  var rows = Array.prototype.slice.call(list.querySelectorAll('.postrow'));
  var buttons = Array.prototype.slice.call(document.querySelectorAll('button[data-tag]'));
  var input = document.getElementById('q');
  var empty = document.getElementById('empty');
  var tag = '';

  function apply() {
    var q = input ? input.value.trim().toLowerCase() : '';
    var shown = 0;
    rows.forEach(function (row) {
      var okTag = !tag || (' ' + row.dataset.tags + ' ').indexOf(' ' + tag + ' ') !== -1;
      var okText = !q || row.dataset.search.indexOf(q) !== -1;
      row.hidden = !(okTag && okText);
      if (!row.hidden) shown++;
    });
    if (empty) empty.hidden = shown !== 0;
    buttons.forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.tag === tag)); });
  }

  function fromHash() {
    var h = decodeURIComponent(location.hash.replace(/^#/, ''));
    tag = buttons.some(function (b) { return b.dataset.tag === h; }) ? h : '';
    apply();
  }

  buttons.forEach(function (b) {
    b.addEventListener('click', function () {
      tag = b.dataset.tag;
      history.replaceState(null, '', tag ? '#' + tag : location.pathname + location.search);
      apply();
    });
  });
  if (input) input.addEventListener('input', apply);
  window.addEventListener('hashchange', fromHash);
  fromHash();
})();
