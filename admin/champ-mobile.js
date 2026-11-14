/* GKH Project Champ on a phone: a simpler console. A bottom bar (Home, Projects, 🎙 Champ, People, More) takes the place of
   the side menu, the big brand bar folds away, each project's tools fold into "⋯ More", the schedule is a list of cards
   (the Gantt is a tap away), the Board swipes column by column and windows fill the screen. Tablets and computers keep
   the full console. */
(function () {
  'use strict';
  var M = window.MBS; if (!M) return;
  var mq = window.matchMedia('(max-width: 700px)');
  var $ = function (s) { return document.querySelector(s); };
  function set() { document.body.classList.toggle('is-phone', mq.matches); if (mq.matches) bar(); }
  var ITEMS = [['home', '🏠', 'Home', '#portfolio/summary', /^#(portfolio|programs|deps)/], ['proj', '📅', 'Projects', '#projects', /^#(projects|plan\/)/], ['champ', '🎙', 'Champ', '', null],
    ['people', '👥', 'People', '#people', /^#(people|me)/], ['more', '☰', 'More', '', null]];
  function bar() {
    if ($('#mNav') || !document.getElementById('app') || document.getElementById('app').hidden) return;
    var n = document.createElement('nav'); n.id = 'mNav'; n.setAttribute('aria-label', 'Main');
    n.innerHTML = ITEMS.map(function (x) { return '<button type="button" data-m="' + x[0] + '"' + (x[0] === 'champ' ? ' class="m-champ"' : '') + '><span>' + (x[0] === 'champ' ? '<img src="../assets/gkh-globe.webp" alt="">' : x[1]) + '</span><small>' + x[2] + '</small></button>'; }).join('');
    document.body.appendChild(n);
    n.querySelectorAll('[data-m]').forEach(function (b) { b.onclick = function () {
      var k = b.getAttribute('data-m'), it = ITEMS.filter(function (x) { return x[0] === k; })[0];
      if (k === 'champ') { var cg = $('#cgBtn'); if (cg) cg.click(); return; }
      if (k === 'more') { var mb = $('#menuBtn'); if (mb) mb.click(); return; }
      if (k === 'people' && M.allowed && !M.allowed('people', 'view')) { location.hash = '#me'; return; }
      location.hash = it[3];
    }; });
    on();
  }
  function on() { var h = location.hash || '#'; document.querySelectorAll('#mNav [data-m]').forEach(function (b) { var it = ITEMS.filter(function (x) { return x[0] === b.getAttribute('data-m'); })[0]; b.classList.toggle('on', !!(it[4] && it[4].test(h))); }); }
  addEventListener('hashchange', function () { on(); if (mq.matches) { var sd = document.getElementById('side'); if (sd) sd.classList.remove('open'); window.scrollTo(0, 0); } });
  mq.addEventListener ? mq.addEventListener('change', set) : mq.addListener(set);
  new MutationObserver(function () { if (!document.getElementById('app').hidden) set(); }).observe(document.getElementById('app'), { attributes: true, attributeFilter: ['hidden'] });
  set(); setTimeout(set, 800);
})();
