/* MBS Console: the dashboard's pipeline board. A snapshot of every job, from the first enquiry to closed:
   New enquiry > Called > Site visit & quoted > Job won > Planning > Job in progress > Completed > Invoiced > Closed.
   Flip it on and off from the Dashboard; "Full screen" hides the menu so all nine columns fit. */
(function () {
  'use strict';
  var M = window.MBS; if (!M) return;
  var api = M.api, esc = M.esc, money = M.money, fail = M.fail;
  var COLS = [
    ['new', 'New enquiry', '#3B82F6', 'Call them back'],
    ['called', 'Called', '#8B5CF6', 'Book a site visit'],
    ['visit', 'Site visit & quoted', '#F59E0B', 'Visit, quote, follow up'],
    ['won', 'Job won', '#10B981', 'Make a project plan'],
    ['planning', 'Planning', '#0EA5E9', 'Plan made, work not started'],
    ['progress', 'Job in progress', '#C9A227', 'Work under way'],
    ['completed', 'Completed', '#14B8A6', 'Send the invoice'],
    ['invoiced', 'Invoiced', '#6366F1', 'Waiting for payment'],
    ['closed', 'Closed', '#6B7280', 'Paid or lost']
  ];
  var store = function (k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } };
  var B = { data: null, q: '', days: +(store('mbsBoardDays') || 30), timer: null, el: null };
  var DAY = 864e5;
  var ageDays = function (ms) { return ms ? Math.max(0, Math.floor((Date.now() - ms) / DAY)) : 0; };
  var pretty = function (s) { if (!s) return ''; var a = s.split('-').map(Number); return a[2] + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][a[1] - 1]; };
  var evC = function (v) { return v == null ? 'grey' : v >= 1 ? 'green' : v >= 0.9 ? 'amber' : 'red'; };

  function flags(c) {
    var a = ageDays(c.since), f = [];
    var w = function (txt, lvl) { f.push('<span class="pflag pf-' + lvl + '">' + esc(txt) + '</span>'); };
    if (c.col === 'new' && a >= 1) w('Not called yet: ' + a + ' day' + (a === 1 ? '' : 's'), a >= 3 ? 'red' : 'amber');
    if (c.col === 'called' && a >= 3 && !c.next) w('No visit booked', 'amber');
    if (c.col === 'visit' && c.stage === 'called') w('Site visit booked', 'blue');
    if (c.col === 'visit' && c.stage === 'quoted' && a >= 7) w('Quote sent ' + a + ' days ago: follow up', a >= 14 ? 'red' : 'amber');
    if (c.col === 'won') w('No project plan yet', 'amber');
    if (c.col === 'planning' && c.plan && c.plan.start) w('Starts ' + pretty(c.plan.start), 'blue');
    if (c.col === 'progress' && c.plan) {
      if (c.plan.late) w(c.plan.late + ' late task' + (c.plan.late === 1 ? '' : 's'), 'red');
      if (c.plan.pct >= 100) w('All tasks done: mark it Completed', 'green');
    }
    if (c.plan && c.plan.highRisks && c.col !== 'closed') w(c.plan.highRisks + ' high risk' + (c.plan.highRisks === 1 ? '' : 's'), 'amber');
    if (c.plan && c.plan.openIssues && c.col !== 'closed') w(c.plan.openIssues + ' open issue' + (c.plan.openIssues === 1 ? '' : 's'), 'amber');
    if (c.col === 'completed' && a >= 2) w('Not invoiced: ' + a + ' days', a >= 7 ? 'red' : 'amber');
    if (c.col === 'invoiced' && a >= 14) w('Unpaid: ' + a + ' days', a >= 30 ? 'red' : 'amber');
    if (c.col === 'closed') w(c.stage === 'paid' ? 'Paid ✓' : 'Lost', c.stage === 'paid' ? 'green' : 'grey');
    return f.join('');
  }
  function card(c) {
    var a = ageDays(c.since), p = c.plan;
    var planBit = p && ['planning', 'progress', 'completed', 'invoiced'].indexOf(c.col) >= 0 ?
      '<div class="pc-plan"><div class="pbar"><span style="width:' + Math.min(100, p.pct) + '%"></span></div><div class="pc-pl"><span>' + p.pct + '% · ' + p.done + '/' + p.total + ' tasks</span>' +
        (c.col === 'progress' || c.col === 'planning' ? '<span class="pc-ev ev-' + evC(p.SPI) + '" title="SPI (schedule): green 1.00 or more, yellow 0.90–0.99, red below 0.90"><i class="evdot"></i>SPI ' + (p.SPI == null ? '–' : p.SPI.toFixed(2)) + '</span>' : '') + '</div>' +
        (p.finish ? '<div class="pc-fin">Finish ' + esc(pretty(p.finish)) + '</div>' : '') + '</div>' : '';
    return '<div class="pcard' + (c.stage === 'lost' ? ' lost' : '') + '" data-core="' + esc(c.core) + '" tabindex="0" role="link" title="Open ' + esc(c.ref) + '">' +
      '<div class="pc-top"><span class="ref">' + esc(c.ref) + '</span><span class="pc-age" title="Days in this stage">' + (a ? a + 'd' : 'today') + '</span></div>' +
      '<b class="pc-name">' + esc(c.name) + '</b><div class="pc-title">' + esc(c.title) + '</div>' +
      '<div class="pc-meta">' + [c.suburb ? esc(c.suburb) : '', c.value ? '<b>' + money(c.value) + '</b> <small>' + (c.valueKind === 'invoice' ? 'invoiced' : 'quoted') + '</small>' : ''].filter(Boolean).join(' · ') + '</div>' +
      planBit + '<div class="pc-flags">' + flags(c) + '</div>' +
      (c.next && c.col !== 'closed' ? '<div class="pc-next">⏰ ' + esc(c.next.when) + ': ' + esc(c.next.text) + '</div>' : '') +
      (p ? '<a class="pc-plink" href="#plan/' + esc(c.core) + '" title="Open the project plan">📅 Plan</a>' : '') + '</div>';
  }
  function sortCol(k, list) {
    var by = { progress: function (a, b) { return (a.plan && a.plan.finish || '9') < (b.plan && b.plan.finish || '9') ? -1 : 1; }, planning: function (a, b) { return (a.plan && a.plan.start || '9') < (b.plan && b.plan.start || '9') ? -1 : 1; }, closed: function (a, b) { return b.since - a.since; } };
    return list.sort(by[k] || function (a, b) { return a.since - b.since; });   // the ones waiting longest first
  }
  function draw() {
    var host = B.el && B.el.querySelector('#pboard'); if (!host || !B.data) return;
    var q = B.q.toLowerCase().trim();
    var cards = B.data.cards.filter(function (c) { return !q || (c.ref + ' ' + c.name + ' ' + c.suburb + ' ' + c.title + ' ' + (c.plan ? c.plan.name : '')).toLowerCase().indexOf(q) >= 0; });
    var openN = cards.filter(function (c) { return c.col !== 'closed'; }).length;
    var openV = cards.filter(function (c) { return c.col !== 'closed'; }).reduce(function (s, c) { return s + (c.value || 0); }, 0);
    B.el.querySelector('#pbSum').innerHTML = '<b>' + openN + '</b> open job' + (openN === 1 ? '' : 's') + ' · <b>' + money(openV) + '</b> quoted or invoiced';
    host.innerHTML = COLS.map(function (col) {
      var list = sortCol(col[0], cards.filter(function (c) { return c.col === col[0]; }));
      var val = list.reduce(function (s, c) { return s + (c.value || 0); }, 0);
      return '<section class="pcol" data-col="' + col[0] + '" style="--pc:' + col[2] + '"><header><div class="pcol-h"><b>' + col[1] + '</b><span class="pcol-n">' + list.length + '</span></div>' +
        '<small>' + (val ? money(val) + ' · ' : '') + esc(col[3]) + '</small></header>' +
        '<div class="pcol-b">' + (list.length ? list.map(card).join('') : '<div class="pcol-empty">Nothing here</div>') + '</div></section>';
    }).join('');
    host.querySelectorAll('.pcard').forEach(function (el) {
      var go = function (e) { if (e.target.closest('.pc-plink')) return; location.hash = '#job/' + el.getAttribute('data-core'); };
      el.addEventListener('click', go);
      el.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(e); });
    });
    var t = new Date(B.data.at);
    B.el.querySelector('#pbAt').textContent = 'Updated ' + t.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Sydney' });
  }
  function load() {
    var btn = B.el && B.el.querySelector('#pbRefresh'); if (btn) btn.disabled = true;
    return api('pipelineBoard', { closedDays: B.days }).then(function (d) { B.data = d; draw(); }).catch(fail).then(function () { if (btn) btn.disabled = false; });
  }
  function setFull(on) {
    document.body.classList.toggle('board-full', on);
    var b = B.el && B.el.querySelector('#pbFull'); if (b) b.textContent = on ? '✕ Exit full screen' : '⛶ Full screen';
  }
  function render(el) {
    B.el = el;
    el.innerHTML = '<div class="pbtool"><input id="pbQ" type="search" placeholder="Find a job, customer or suburb…" value="' + esc(B.q) + '">' +
      '<label class="muted" style="display:flex;gap:6px;align-items:center;font-size:13px">Closed jobs<select id="pbDays" style="width:auto">' +
      [[7, 'last 7 days'], [30, 'last 30 days'], [90, 'last 90 days'], [0, 'all']].map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === B.days ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>' +
      '<span id="pbSum" class="muted" style="font-size:13px"></span><span class="sp"></span><small class="muted" id="pbAt"></small>' +
      '<button class="btn btn-sm" id="pbRefresh" title="Load the latest">↻ Refresh</button><button class="btn btn-sm btn-gold" id="pbFull">' + (document.body.classList.contains('board-full') ? '✕ Exit full screen' : '⛶ Full screen') + '</button></div>' +
      '<div class="pboard" id="pboard"><div class="empty">Loading…</div></div>';
    el.querySelector('#pbQ').oninput = function () { B.q = this.value; draw(); };
    el.querySelector('#pbDays').onchange = function () { B.days = +this.value; store('mbsBoardDays', String(B.days)); load(); };
    el.querySelector('#pbRefresh').onclick = load;
    el.querySelector('#pbFull').onclick = function () { setFull(!document.body.classList.contains('board-full')); };
    clearInterval(B.timer);
    B.timer = setInterval(function () {   // keep the snapshot fresh while it is on screen
      if (!document.body.contains(el)) { clearInterval(B.timer); setFull(false); return; }
      if (!document.hidden) load();
    }, 120000);
    return load();
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && document.body.classList.contains('board-full')) setFull(false); });
  window.addEventListener('hashchange', function () { if (document.body.classList.contains('board-full') && !/^#?(dashboard)?$/.test(location.hash)) setFull(false); });
  M.board = { render: render, full: setFull };
})();
