/* GKH Project Champ: switch the language of the website and the console on the fly.
   🌐 in the top-right cluster. Text is translated by the AI (chat function, mode "i18n") once per language and
   cached on the server (Netlify Blobs) and in this browser, so it is quick after the first time.
   Website: the whole page. Console: menus, buttons, tabs, headings and labels only; project data stays as typed.
   The choice also sets Champ's language. English is the original and needs no translation. */
(function () {
  'use strict';
  var API = '/.netlify/functions/chat';
  var LANGS = [['en', 'English', 'EN'], ['ms', 'Bahasa Melayu', 'MS'], ['id', 'Bahasa Indonesia', 'ID'], ['ta', 'தமிழ்', 'TA'], ['zh', '简体中文', '中文'], ['hi', 'हिन्दी', 'HI'],
    ['ar', 'العربية', 'AR'], ['fa', 'فارسی', 'FA'], ['vi', 'Tiếng Việt', 'VI'], ['th', 'ไทย', 'TH'], ['tl', 'Filipino', 'TL'], ['ja', '日本語', 'JA'], ['ko', '한국어', 'KO'],
    ['es', 'Español', 'ES'], ['fr', 'Français', 'FR'], ['de', 'Deutsch', 'DE'], ['pt', 'Português', 'PT'], ['sw', 'Kiswahili', 'SW'], ['rw', 'Kinyarwanda', 'RW']];
  var BY = {}; LANGS.forEach(function (l) { BY[l[0]] = l; });
  var isConsole = /\/admin\//.test(location.pathname);
  var ls = function (k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } };
  var lang = BY[ls('champLang')] ? ls('champLang') : 'en';
  var root = document.documentElement;
  root.setAttribute('lang', lang === 'en' ? 'en-AU' : lang);

  // what gets translated
  var SKIP = 'script,style,noscript,code,pre,svg,textarea,input,select:not([data-i18n]),[contenteditable],[data-noi18n],.cc-box,.ct-langmenu,.ref';
  var CONSOLE_UI = 'nav,button,.btn,label,th,h1,h2,h3,h4,legend,summary,.side-h,.card-h,.pcol-h,.pcol header small,.cs-tile span,.cs-tile small,.cs-note,.cs-health small,.cs-tagline,.empty,.noaccess,.pflag,.gkh-bar,.login-card,.ct-panel,.tabs,[role=tab],.pkpis,.hint,.help,p.muted,small.muted';
  var CONSOLE_DATA = 'td,.pc-name,.pc-title,.pc-meta,.who,#newPlanJob,.gantt,.gt-name,.bar-label,[data-plan] b,.plan-name,.ptask,.ttl';
  var SKIP_TEXT = /^[\s\d.,:;%$€£¥+\-–—/()#@*×x=<>|·•→←↻✓✕⇄✨📊▦📅＋🔐🕘🎨🌐☀☾]*$/;
  var orig = new WeakMap(), origAttr = new WeakMap();
  var mem = {};   // lang -> { english: translation }
  function cacheOf(l) {
    if (!mem[l]) { try { mem[l] = JSON.parse(ls('champI18n:' + l) || '{}'); } catch (e) { mem[l] = {}; } }
    return mem[l];
  }
  function saveCache(l) {
    try { var s = JSON.stringify(mem[l]); if (s.length > 900000) { mem[l] = {}; s = '{}'; } localStorage.setItem('champI18n:' + l, s); } catch (e) {}
  }
  function wanted(el) {
    if (!el || el.closest(SKIP)) return false;
    if (!isConsole) return true;
    if (el.closest(CONSOLE_DATA)) return false;
    return !!el.closest(CONSOLE_UI);
  }
  function collect(scope) {
    var items = [], w = document.createTreeWalker(scope || document.body, NodeFilter.SHOW_TEXT, null);
    for (var n = w.nextNode(); n; n = w.nextNode()) {
      var o = orig.has(n) ? orig.get(n) : n.nodeValue, t = o.trim();
      if (!t || t.length > 700 || SKIP_TEXT.test(t) || !/\p{L}/u.test(t) || !wanted(n.parentElement)) continue;
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
  var busy = 0, queued = false;
  function translate(scope) {
    if (lang === 'en') return Promise.resolve();
    var l = lang, cache = cacheOf(l), items = collect(scope), need = [];
    items.forEach(function (it) { if (cache[it.t] != null) put(it, cache[it.t]); else if (need.indexOf(it.t) < 0) need.push(it.t); });
    if (!need.length) return Promise.resolve();
    busy++; if (!scope) root.classList.add('i18n-busy');
    var batches = []; for (var i = 0; i < need.length; i += 80) batches.push(need.slice(i, i + 80));
    return Promise.all(batches.map(function (b) {
      return fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'i18n', lang: l, strings: b }) })
        .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Translation unavailable'); return j; }); })
        .then(function (j) { Object.keys(j.map || {}).forEach(function (k) { cache[k] = j.map[k]; }); });
    })).then(function () {
      saveCache(l);
      if (l === lang) items.forEach(function (it) { if (cache[it.t] != null) put(it, cache[it.t]); });
    }).catch(function (e) { if (!scope) note(e.message); })
      .then(function () { busy--; if (!busy) root.classList.remove('i18n-busy'); });
  }
  function note(msg) {
    var d = document.createElement('div'); d.className = 'ct-note'; d.textContent = msg;
    d.style.cssText = 'position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:2147483003;background:#7C2D12;color:#fff;padding:8px 16px;border-radius:999px;font:700 13px Manrope,sans-serif';
    document.body.appendChild(d); setTimeout(function () { d.remove(); }, 4000);
  }
  function setLang(l, fromChat) {
    if (!BY[l] || l === lang) return;
    lang = l; ls('champLang', l); root.setAttribute('lang', l === 'en' ? 'en-AU' : l);
    if (!fromChat) { ls('champChatLang', l); window.dispatchEvent(new CustomEvent('champ:lang', { detail: l })); }
    var b = document.getElementById('champLangBtn'); if (b) b.innerHTML = '🌐 ' + BY[l][2];
    restore(); if (l !== 'en') translate();
  }
  // the chat's own language picker keeps the page in step (but "Auto" leaves the page alone)
  window.addEventListener('champ:chatlang', function (e) { if (BY[e.detail]) setLang(e.detail, true); });

  function picker() {
    var ctl = window.ChampCtl && window.ChampCtl(); if (!ctl || document.getElementById('champLangBtn')) return;
    var b = document.createElement('button');
    b.type = 'button'; b.id = 'champLangBtn'; b.className = 'ct-lang'; b.setAttribute('aria-haspopup', 'true'); b.setAttribute('aria-expanded', 'false');
    b.title = 'Language'; b.setAttribute('aria-label', 'Change language'); b.innerHTML = '🌐 ' + BY[lang][2];
    ctl.insertBefore(b, ctl.firstChild);
    var m = document.createElement('div'); m.className = 'ct-langmenu'; m.hidden = true; m.setAttribute('role', 'menu');
    document.body.appendChild(m);
    var draw = function () {
      m.innerHTML = '<b>🌐 Language</b>' + LANGS.map(function (x) { return '<button type="button" role="menuitem" data-l="' + x[0] + '"' + (x[0] === lang ? ' aria-current="true"' : '') + '>' + x[1] + '</button>'; }).join('') +
        '<small>' + (isConsole ? 'Menus and labels are translated by AI; your project data stays as typed.' : 'Translated by AI.') + ' Champ answers in the same language.</small>';
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
      scopes.forEach(function (sc) { if (!sc.closest || !sc.closest('.cc-box')) translate(sc); });
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
    function run1(k) { return fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'i18n', lang: l, strings: batches[k] }) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Translation unavailable'); return j; }); })
      .then(function (j) { Object.keys(j.map || {}).forEach(function (x) { cache[x] = j.map[x]; out[x] = j.map[x]; }); }); }
  }
  window.ChampI18n = { set: setLang, get: function () { return lang; }, langs: LANGS, strings: strings, name: function (l) { return (BY[l || lang] || BY.en)[1]; } };
})();
