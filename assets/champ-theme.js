/* GKH Project Champ: skins and layout. Loaded in <head> so the chosen skin applies before the page paints.
   A 🎨 button (bottom right) opens a small panel: skin (Black & Gold, White, Navy, Emerald, Slate & Copper),
   density (comfortable / compact), width (wide / boxed) and, in the console, the menu (full / icons only).
   The choice is kept in this browser (localStorage) and shared by the website and the console. */
// ---- Remembering visitors: OFF for now (the site is shared by several people). Set to true to remember people between visits. ----
window.CHAMP_REMEMBER = false;
(function () {
  // not remembering: every new visit (a new browser tab or window) starts fresh: no name, no language, no microphone setting from the last person
  if (window.CHAMP_REMEMBER || /\/admin\//.test(location.pathname)) return;
  try {
    if (sessionStorage.getItem('champFresh')) return;
    ['champVisitor', 'champLang', 'champChatLang', 'champStartLang', 'champHandsFree', 'champSttLangs', 'champSttMode', 'champVoice', 'champChatSeen'].forEach(function (k) { localStorage.removeItem(k); });
    sessionStorage.setItem('champFresh', '1');
  } catch (e) {}
})();
(function () {
  'use strict';
  var root = document.documentElement;
  var SKINS = [
    ['black', 'Black & Gold', '#0A0A0A', '#D4AF37'],
    ['white', 'White', '#FFFFFF', '#A8841C'],
    ['navy', 'GKH Navy', '#0A1628', '#4FA3FF'],
    ['emerald', 'Emerald', '#06140F', '#34D399'],
    ['slate', 'Slate & Copper', '#16181C', '#E0793F']
  ];
  var KEYS = { skin: 'champSkin', density: 'champDensity', width: 'champWidth' };
  function get(k, d) { try { return localStorage.getItem(KEYS[k]) || d; } catch (e) { return d; } }
  function put(k, v) { try { localStorage.setItem(KEYS[k], v); } catch (e) {} }
  function apply() {
    root.setAttribute('data-skin', get('skin', 'black'));
    root.setAttribute('data-density', get('density', 'comfortable'));
    root.setAttribute('data-width', get('width', 'wide'));
  }
  apply();
  window.addEventListener('storage', apply);   // another tab changed it

  var isConsole = /\/admin\//.test(location.pathname);
  function seg(name, opts, cur) {
    return '<div class="ct-row"><span>' + name + '</span><div class="ct-seg">' + opts.map(function (o) {
      return '<button type="button" data-k="' + o[0] + '" data-v="' + o[1] + '"' + (cur === o[1] ? ' aria-pressed="true"' : '') + '>' + o[2] + '</button>';
    }).join('') + '</div></div>';
  }
  function panelHtml() {
    var skin = get('skin', 'black');
    var mini = document.body.classList.contains('side-mini') ? 'icons' : 'full';
    return '<div class="ct-head"><b>Skin &amp; layout</b><button type="button" class="ct-x" aria-label="Close">✕</button></div>' +
      '<div class="ct-skins">' + SKINS.map(function (s) {
        return '<button type="button" class="ct-skin" data-k="skin" data-v="' + s[0] + '"' + (skin === s[0] ? ' aria-pressed="true"' : '') + ' title="' + s[1] + '">' +
          '<i style="background:linear-gradient(135deg,' + s[2] + ' 0 55%,' + s[3] + ' 55% 100%)"></i><small>' + s[1] + '</small></button>';
      }).join('') + '</div>' +
      seg('Density', [['density', 'comfortable', 'Comfortable'], ['density', 'compact', 'Compact']], get('density', 'comfortable')) +
      seg('Width', [['width', 'wide', 'Wide'], ['width', 'boxed', 'Boxed']], get('width', 'wide')) +
      (isConsole && window.MBS_sideMini ? seg('Menu', [['menu', 'full', 'Full'], ['menu', 'icons', 'Icons only']], mini) : '') +
      '<button type="button" class="ct-reset" data-k="reset">Reset to default</button>';
  }
  // the top-right cluster (website header / console top bar) that holds 🌐 language, ☀/☾ and 🎨
  function cluster() {
    var c = document.getElementById('champCtl'); if (c) return c;
    var host = document.querySelector('header.site .nav-login') || document.querySelector('.top .top-new');
    if (!host) return null;
    c = document.createElement('div'); c.id = 'champCtl'; c.className = 'ct-ctl';
    host.parentNode.insertBefore(c, host); return c;
  }
  window.ChampCtl = cluster;
  function build() {
    if (document.getElementById('champTheme')) return;
    var btn = document.createElement('button');
    btn.type = 'button'; btn.id = 'champThemeBtn'; btn.className = 'ct-btn'; btn.setAttribute('aria-label', 'Change skin and layout'); btn.title = 'Skin & layout';
    btn.innerHTML = '🎨';
    var panel = document.createElement('div');
    panel.id = 'champTheme'; panel.className = 'ct-panel'; panel.hidden = true; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Skin and layout');
    var ctl = cluster(); if (ctl) { btn.classList.add('ct-in'); ctl.appendChild(btn); } else document.body.appendChild(btn);
    document.body.appendChild(panel);
    var open = function (on) { panel.hidden = !on; if (on) panel.innerHTML = panelHtml(); btn.setAttribute('aria-expanded', on ? 'true' : 'false'); };
    btn.addEventListener('click', function () { open(panel.hidden); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !panel.hidden) open(false); });
    document.addEventListener('click', function (e) { var path = e.composedPath ? e.composedPath() : []; if (!panel.hidden && path.indexOf(panel) < 0 && path.indexOf(btn) < 0) open(false); });
    panel.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.classList.contains('ct-x')) return open(false);
      var k = b.getAttribute('data-k'), v = b.getAttribute('data-v');
      if (k === 'reset') { put('skin', 'black'); put('density', 'comfortable'); put('width', 'wide'); if (window.MBS_sideMini) window.MBS_sideMini(false); }
      else if (k === 'menu') { if (window.MBS_sideMini) window.MBS_sideMini(v === 'icons'); }
      else put(k, v);
      apply(); panel.innerHTML = panelHtml();
      window.dispatchEvent(new Event('resize'));   // charts and the Gantt re-fit
    });
  }
  // one-click light/dark slider: White <-> the last dark skin used (Black & Gold by default)
  function quick() {
    var ctl = cluster();
    if (!ctl || document.getElementById('champQuick')) return;
    var t = document.createElement('button');
    t.type = 'button'; t.id = 'champQuick'; t.className = 'ct-quick'; t.setAttribute('role', 'switch'); t.title = 'Light or dark';
    var sync = function () { var dark = get('skin', 'black') !== 'white'; t.setAttribute('aria-checked', dark ? 'true' : 'false'); t.setAttribute('aria-label', dark ? 'Dark skin on: switch to light' : 'Light skin on: switch to dark'); };
    t.innerHTML = '<span class="ct-track" aria-hidden="true"></span>';
    t.onclick = function () {
      var cur = get('skin', 'black');
      if (cur === 'white') put('skin', get('dark', 'black'));
      else { try { localStorage.setItem('champDarkSkin', cur); } catch (e) {} put('skin', 'white'); }
      apply(); sync(); var pn = document.getElementById('champTheme'); if (pn && !pn.hidden) pn.innerHTML = panelHtml();
      window.dispatchEvent(new Event('resize'));
    };
    ctl.insertBefore(t, ctl.querySelector('.ct-btn')); sync();
    window.addEventListener('storage', sync);
  }
  KEYS.dark = 'champDarkSkin';
  // the build number in the website footer, from /build.json (written on Netlify for each deploy)
  function buildTag() {
    var el = document.querySelector('[data-build]'); if (!el) return;
    fetch('/build.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (b) {
      if (!b) return; el.textContent = 'Build ' + b.label; el.title = 'Build ' + b.build + (b.commit ? ' · commit ' + String(b.commit).slice(0, 7) : ''); el.hidden = false;
    }).catch(function () {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildTag); else buildTag();
  // visitor counter: each browser counts once as a visitor, each browser session once as a visit; the total shows in the footer
  function visits() {
    if (/\/admin\//.test(location.pathname)) return;
    var el = document.querySelector('[data-visits]');
    var ls = function (k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } };
    var ss = function (k, v) { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch (e) { return null; } };
    var first = !ls('champCounted'), newVisit = !ss('champCounted');
    fetch('/.netlify/functions/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'count', unique: first, visit: newVisit, page: location.pathname }) })
      .then(function (r) { return r.ok ? r.json() : null; }).then(function (c) {
        if (!c) return; ls('champCounted', '1'); ss('champCounted', '1');
        if (el && c.visitors) { el.innerHTML = '👁 <b data-noi18n style="font-weight:inherit">' + Number(c.visitors).toLocaleString('en-AU') + '</b> <span>visitors</span>'; el.title = Number(c.visits || 0).toLocaleString('en-AU') + ' visits in all'; el.hidden = false; }
      }).catch(function () {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', visits); else visits();
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', build); document.addEventListener('DOMContentLoaded', quick); } else { build(); quick(); }
  window.ChampTheme = { skins: SKINS.map(function (s) { return s[0]; }), apply: apply };
})();
