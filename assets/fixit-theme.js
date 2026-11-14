/* MBS FixIT (TEST SITE ONLY, v110): skins and layout, ported from GKH Project Champ (champ-theme.js).
   Loaded in <head> so the chosen skin applies before the page paints. In the top-right of the header (website) or the
   top bar (console): a ☀/☾ light-dark switch and 🎨 (skin: Black & Gold, White, Harbour Navy, Emerald, Slate & Copper;
   density; width). Kept in this browser (localStorage), shared by the website and the console.
   Only switched on for the test site (fixittest) and local runs: on any other host this file does nothing. */
window.FX_UI = /^([\w-]+--)?fixittest\.netlify\.app$/i.test(location.hostname) || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
if (window.FX_UI) (function () {
  'use strict';
  var root = document.documentElement;
  var isConsoleEarly = /\/admin\//.test(location.pathname);
  var SKINS = [
    ['black', 'Black & Gold', '#0A0A0A', '#D4AF37'],
    ['white', 'White', '#FFFFFF', '#A8841C'],
    ['navy', 'Harbour Navy', '#0A1628', '#4FA3FF'],
    ['emerald', 'Emerald', '#06140F', '#34D399'],
    ['slate', 'Slate & Copper', '#16181C', '#E0793F']
  ];
  var KEYS = { skin: 'fxSkin', density: 'fxDensity', width: 'fxWidth' };
  function get(k, d) { try { return localStorage.getItem(KEYS[k]) || d; } catch (e) { return d; } }
  function put(k, v) { try { localStorage.setItem(KEYS[k], v); } catch (e) {} }
  function apply() {
    root.setAttribute('data-skin', get('skin', 'black'));
    root.setAttribute('data-density', get('density', 'comfortable'));
    root.setAttribute('data-width', get('width', 'wide'));
  }
  apply();
  if (isConsoleEarly) root.classList.add('fx-console');
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
    var c = document.getElementById('fxCtl'); if (c) return c;
    var host = document.querySelector('header.site .nav-login') || document.querySelector('.top .top-new');
    if (!host) return null;
    c = document.createElement('div'); c.id = 'fxCtl'; c.className = 'ct-ctl';
    host.parentNode.insertBefore(c, host); return c;
  }
  window.FxCtl = cluster;
  function build() {
    if (document.getElementById('fxTheme')) return;
    var btn = document.createElement('button');
    btn.type = 'button'; btn.id = 'fxThemeBtn'; btn.className = 'ct-btn'; btn.setAttribute('aria-label', 'Change skin and layout'); btn.title = 'Skin & layout';
    btn.innerHTML = '🎨';
    var panel = document.createElement('div');
    panel.id = 'fxTheme'; panel.className = 'ct-panel'; panel.hidden = true; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Skin and layout');
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
    if (!ctl || document.getElementById('fxQuick')) return;
    var t = document.createElement('button');
    t.type = 'button'; t.id = 'fxQuick'; t.className = 'ct-quick'; t.setAttribute('role', 'switch'); t.title = 'Light or dark';
    var sync = function () { var dark = get('skin', 'black') !== 'white'; t.setAttribute('aria-checked', dark ? 'true' : 'false'); t.setAttribute('aria-label', dark ? 'Dark skin on: switch to light' : 'Light skin on: switch to dark'); };
    t.innerHTML = '<span class="ct-track" aria-hidden="true"></span>';
    t.onclick = function () {
      var cur = get('skin', 'black');
      if (cur === 'white') put('skin', get('dark', 'black'));
      else { try { localStorage.setItem('fxDarkSkin', cur); } catch (e) {} put('skin', 'white'); }
      apply(); sync(); var pn = document.getElementById('fxTheme'); if (pn && !pn.hidden) pn.innerHTML = panelHtml();
      window.dispatchEvent(new Event('resize'));
    };
    ctl.insertBefore(t, ctl.querySelector('.ct-btn')); sync();
    window.addEventListener('storage', sync);
  }
  KEYS.dark = 'fxDarkSkin';
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', build); document.addEventListener('DOMContentLoaded', quick); } else { build(); quick(); }
  window.FxTheme = { skins: SKINS.map(function (s) { return s[0]; }), apply: apply };
})();
