/* MBS FixIT (TEST SITE ONLY, v110): switch the language of the website and the console on the fly, ported from
   GKH Project Champ (champ-i18n.js). 🌐 in the top-right cluster: English, Bahasa Melayu, 简体中文, தமிழ், မြန်မာ, বাংলা.
   Text is translated by the AI (chat function, header X-MBS-I18n) once per language and cached on the server
   (Netlify Blobs "mbs-i18n") and in this browser, so it is quick after the first time. What people type stays as typed.
   English is the original and needs no translation. Needs fixit-theme.js (it decides whether this is the test site). */
if (window.FX_UI) (function () {
  'use strict';
  var API = '/.netlify/functions/chat';
  var LANGS = [['en', 'English', 'EN'], ['ms', 'Bahasa Melayu', 'MS'], ['zh', '简体中文', '中文'], ['ta', 'தமிழ்', 'TA'], ['my', 'မြန်မာ (Myanmar)', 'MY'], ['bn', 'বাংলা (Bangladesh)', 'BN']];
  var BY = {}; LANGS.forEach(function (l) { BY[l[0]] = l; });
  var isConsole = /\/admin\//.test(location.pathname);
  var ls = function (k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } };
  var lang = BY[ls('fxLang')] ? ls('fxLang') : 'en';
  var root = document.documentElement;
  root.setAttribute('lang', lang === 'en' ? 'en-AU' : lang);

  // what gets translated
  var SKIP = 'script,style,noscript,code,pre,svg,canvas,textarea,input,.ct-lang,.who,[contenteditable],[data-noi18n],.ct-langmenu,.fx-msg.me,.fx-langmenu,.logo';
  var CONSOLE_UI = 'nav,button,.btn,label,th,h1,h2,h3,h4,legend,summary,.side-h,.card-h,.pcol-h,.pcol header small,.cs-tile span,.cs-tile small,.cs-note,.cs-health small,.cs-tagline,.empty,.noaccess,.pflag,.gkh-bar,.login-card,.ct-panel,.tabs,[role=tab],.pkpis,.hint,.help,p.muted,small.muted';
  var CONSOLE_DATA = 'td,.pc-name,.pc-title,.pc-meta,.who,#newPlanJob,.gantt,.gt-name,.bar-label,[data-plan] b,.plan-name,.ptask,.ttl';
  var SKIP_TEXT = /^[\s\d.,:;%$€£¥+\-–—/()#@*×x=<>|·•→←↻✓✕⇄✨📊▦📅＋🔐🕘🎨🌐☀☾]*$/;
  // email addresses, web addresses and codes such as MBS-000001 or INV-0012 are never sent for translation
  var NOT_WORDS = /^\S+@\S+\.\S+$|^(https?:\/\/|www\.)\S+$|^[A-Z]{1,5}-?\d[\w-]*$/;
  var orig = new WeakMap(), origAttr = new WeakMap();
  var mem = {};   // lang -> { english: translation }
  function cacheOf(l) {
    if (!mem[l]) { try { mem[l] = JSON.parse(ls('fxI18n:' + l) || '{}'); } catch (e) { mem[l] = {}; } }
    return mem[l];
  }
  function saveCache(l) {
    try { var s = JSON.stringify(mem[l]); if (s.length > 900000) { mem[l] = {}; s = '{}'; } localStorage.setItem('fxI18n:' + l, s); } catch (e) {}
  }
  function wanted(el) {
    return !!el && !el.closest(SKIP);   // GKH Project Champ: the whole console, not only its labels (someone who reads no English must not meet half-English screens)
  }
  function collect(scope) {
    var items = [], w = document.createTreeWalker(scope || document.body, NodeFilter.SHOW_TEXT, null);
    for (var n = w.nextNode(); n; n = w.nextNode()) {
      var o = orig.has(n) ? orig.get(n) : n.nodeValue, t = o.trim();
      if (!t || t.length > 700 || SKIP_TEXT.test(t) || NOT_WORDS.test(t) || !/\p{L}/u.test(t) || !wanted(n.parentElement)) continue;
      if (!orig.has(n)) orig.set(n, o);
      items.push({ n: n, t: t });
    }
    (scope && scope.querySelectorAll ? scope : document).querySelectorAll('[placeholder],[title],[aria-label]').forEach(function (el) {
      if (!wanted(el) && !(el.matches && el.matches('input,textarea') && wanted(el.parentElement))) return;
      ['placeholder', 'title', 'aria-label'].forEach(function (a) {
        var m = origAttr.get(el) || {}; var v = a in m ? m[a] : el.getAttribute(a);
        if (!v || !/\p{L}/u.test(v) || v.length > 300) return;
        m[a] = v; origAttr.set(el, m); items.push({ el: el, a: a, t: v.trim() });
      });
    });
    return items;
  }
  function put(it, tr) {
    if (it.n) { var o = orig.get(it.n); it.n.nodeValue = o.replace(it.t, tr); }
    else it.el.setAttribute(it.a, tr);
  }
  function restore(scope) {
    var w = document.createTreeWalker(scope || document.body, NodeFilter.SHOW_TEXT, null);
    for (var n = w.nextNode(); n; n = w.nextNode()) if (orig.has(n)) n.nodeValue = orig.get(n);
    document.querySelectorAll('[placeholder],[title],[aria-label]').forEach(function (el) { var m = origAttr.get(el); if (m) Object.keys(m).forEach(function (a) { el.setAttribute(a, m[a]); }); });
  }
  // what is still untranslated is gathered from every redraw and sent together (a few big requests instead of one per redraw)
  var busy = 0, queue = [], waiters = [], flushT = null, inflight = 0, failNote = 0;
  function flush() {
    flushT = null; if (!queue.length || inflight >= 3) return;
    var l = lang, cache = cacheOf(l), batch = [];
    while (queue.length && batch.length < 80) { var t = queue.shift(); if (cache[t] == null && batch.indexOf(t) < 0) batch.push(t); }
    if (!batch.length) { settle(); if (queue.length) flush(); return; }
    inflight++; busy++; root.classList.add('i18n-busy');
    fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-MBS-I18n': '1' }, body: JSON.stringify({ mode: 'i18n', lang: l, strings: batch }) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) { var e = new Error(j.error || 'Translation unavailable'); e.retry = r.status === 429 || r.status >= 500; throw e; } return j; }); })
      .then(function (j) { Object.keys(j.map || {}).forEach(function (k) { cache[k] = j.map[k]; }); saveCache(l); })
      .catch(function (e) { if (Date.now() - failNote > 60000) { failNote = Date.now(); note(e.message); } if (e.retry) setTimeout(function () { batch.forEach(function (t) { if (queue.indexOf(t) < 0) queue.push(t); }); schedule(8000); }, 0); })
      .then(function () { inflight--; busy--; if (!busy) root.classList.remove('i18n-busy'); settle(); if (queue.length) schedule(60); });
    if (queue.length) flush();   // up to three requests at a time
  }
  function schedule(ms) { if (!flushT) flushT = setTimeout(flush, ms == null ? 250 : ms); }
  function settle() { var l = lang, cache = cacheOf(l); waiters = waiters.filter(function (w) { if (w.l !== l) return false; var left = false; w.items.forEach(function (it) { if (cache[it.t] != null) put(it, cache[it.t]); else left = true; }); return left; }); }
  function translate(scope) {
    if (lang === 'en') return Promise.resolve();
    var l = lang, cache = cacheOf(l), items = collect(scope), need = 0;
    items.forEach(function (it) { if (cache[it.t] != null) put(it, cache[it.t]); else { need++; if (queue.indexOf(it.t) < 0) queue.push(it.t); } });
    if (!need) return Promise.resolve();
    waiters.push({ l: l, items: items.filter(function (it) { return cache[it.t] == null; }) });
    if (!scope) root.classList.add('i18n-busy');
    schedule(); return Promise.resolve();
  }
  function note(msg) {
    var d = document.createElement('div'); d.className = 'ct-note'; d.textContent = msg;
    d.style.cssText = 'position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:2147483003;background:#7C2D12;color:#fff;padding:8px 16px;border-radius:999px;font:700 13px Manrope,sans-serif';
    document.body.appendChild(d); setTimeout(function () { d.remove(); }, 4000);
  }
  function setLang(l, fromChat) {
    if (!BY[l] || l === lang) return;
    lang = l; ls('fxLang', l); root.setAttribute('lang', l === 'en' ? 'en-AU' : l);
    window.dispatchEvent(new CustomEvent('fx:lang', { detail: l }));
    var b = document.getElementById('fxLangBtn'); if (b) b.innerHTML = '🌐 ' + BY[l][2];
    restore(); if (l !== 'en') translate();
  }

  function picker() {
    var ctl = window.FxCtl && window.FxCtl(); if (!ctl || document.getElementById('fxLangBtn')) return;
    var b = document.createElement('button');
    b.type = 'button'; b.id = 'fxLangBtn'; b.className = 'ct-lang'; b.setAttribute('aria-haspopup', 'true'); b.setAttribute('aria-expanded', 'false');
    b.title = 'Language'; b.setAttribute('aria-label', 'Change language'); b.innerHTML = '🌐 ' + BY[lang][2];
    ctl.insertBefore(b, ctl.firstChild);
    var m = document.createElement('div'); m.className = 'ct-langmenu'; m.hidden = true; m.setAttribute('role', 'menu');
    document.body.appendChild(m);
    var draw = function () {
      m.innerHTML = '<b>🌐 Language</b>' + LANGS.map(function (x) { return '<button type="button" role="menuitem" data-l="' + x[0] + '"' + (x[0] === lang ? ' aria-current="true"' : '') + '>' + x[1] + '</button>'; }).join('') +
        '<small data-noi18n>' + (isConsole ? 'Everything on screen is translated by AI; what you type stays as typed.' : 'Translated by AI. Mr. Fixit reads his replies out in the same language.') + ' Test site only.</small>';
    };
    var open = function (on) { if (on) draw(); m.hidden = !on; b.setAttribute('aria-expanded', on ? 'true' : 'false'); };
    b.onclick = function (e) { e.stopPropagation(); open(m.hidden); };
    m.onclick = function (e) { var x = e.target.closest('[data-l]'); if (!x) return; open(false); setLang(x.getAttribute('data-l')); };
    document.addEventListener('click', function (e) { if (!m.hidden && !m.contains(e.target) && e.target !== b) open(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !m.hidden) { open(false); b.focus(); } });
  }
  // re-translate what the console (or the chat-free parts of the page) draws later
  var timer = null, pending = [];
  var mo = new MutationObserver(function (list) {
    if (lang === 'en') return;
    list.forEach(function (r) { r.addedNodes.forEach(function (n) { if (n.nodeType === 1 || n.nodeType === 3) pending.push(n.nodeType === 3 ? n.parentElement : n); }); });
    clearTimeout(timer); timer = setTimeout(function () {
      var scopes = pending.filter(function (n) { return n && n.isConnected; }); pending = [];
      if (scopes.length > 40) return translate();
      scopes.forEach(function (sc) { translate(sc); });
    }, 120);
  });
  function start() {
    picker();
    mo.observe(document.body, { childList: true, subtree: true });
    if (lang !== 'en') translate();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  // translate a list of strings (documents: the project charter and plan), using the same cache; returns { english: translation }
  function strings(list, l) {
    l = l || lang; if (l === 'en' || !BY[l]) return Promise.resolve({});
    var cache = cacheOf(l), need = [], out = {};
    list.forEach(function (t) { t = String(t || '').trim(); if (!t || SKIP_TEXT.test(t) || !/\p{L}/u.test(t)) return; if (cache[t] != null) out[t] = cache[t]; else if (need.indexOf(t) < 0) need.push(t); });
    var batches = []; for (var i = 0; i < need.length; i += 25) batches.push(need.slice(i, i + 25));
    // three batches at a time
    return Promise.all([0, 1, 2].map(function (start) { var chain = Promise.resolve(); for (var k = start; k < batches.length; k += 3) (function (kk) { chain = chain.then(function () { return run1(kk); }); })(k); return chain; }))
      .then(function () { saveCache(l); return out; });
    function run1(k) { return fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-MBS-I18n': '1' }, body: JSON.stringify({ mode: 'i18n', lang: l, strings: batches[k] }) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Translation unavailable'); return j; }); })
      .then(function (j) { Object.keys(j.map || {}).forEach(function (x) { cache[x] = j.map[x]; out[x] = j.map[x]; }); }); }
  }
  window.FxI18n = { set: setLang, get: function () { return lang; }, langs: LANGS, strings: strings, cached: function (t, l) { l = l || lang; if (l === 'en') return t; var c = cacheOf(l)[String(t || '').trim()]; return c == null ? null : c; }, name: function (l) { return (BY[l || lang] || BY.en)[1]; } };
})();
