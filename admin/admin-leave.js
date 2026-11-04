/* MBS Console v108: Leave. "My leave" for anyone signed in (balances, ask for leave, my requests); People > Leave for managers
   (requests to approve with balances and clashes, a calendar of who's away, everyone's balances, enter leave for someone).
   Approved leave goes into the timesheet, so Payroll pays it in the next pay run. */
(function () {
  'use strict';
  var M = window.MBS; if (!M) return;
  var api = M.api, esc = M.esc, toast = M.toast, fail = M.fail, $ = M.$;
  var V = function () { return M.view(); };
  var L = { tab: 'req', month: '' };
  var TABS = [['req', '📥 Requests'], ['cal', '📅 Calendar'], ['bal', '⚖ Balances'], ['new', '＋ Enter leave'], ['nes', 'ℹ Leave types']];
  var todayS = function () { return new Date(Date.now() + 11 * 3600e3).toISOString().slice(0, 10); };
  var nice = function (d) { return d ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) : ''; };
  var h = function (n) { return (Math.round((Number(n) || 0) * 100) / 100) + ' h'; };
  var dys = function (n) { return (Math.round((Number(n) || 0) / 7.6 * 10) / 10) + ' d'; };
  var ST = { pending: '<span class="chip lv-pend">Waiting</span>', approved: '<span class="chip prl-ok">Approved</span>', declined: '<span class="chip lv-dec">Declined</span>', cancelled: '<span class="chip">Cancelled</span>' };
  var typeName = function (types, k) { return (types.filter(function (t) { return t[0] === k; })[0] || [k, k])[1]; };
  var period = function (r) { return r.from === r.to ? nice(r.from) : nice(r.from) + ' – ' + nice(r.to); };

  function balCards(b) {
    if (!b) return '';
    return '<div class="grid kpis lv-kpis">' + [['Annual leave', 'annual'], ['Personal / carer\'s', 'personal'], ['RDO bank', 'rdo']].map(function (x) {
      return '<div class="card kpi"><div class="k">' + x[0] + '</div><div class="v">' + h(b.balances[x[1]]) + '</div><div class="s">' + dys(b.balances[x[1]]) + (b.booked[x[1]] ? ' · ' + h(b.booked[x[1]]) + ' booked, ' + h(b.after[x[1]]) + ' after' : '') + '</div></div>';
    }).join('') + '</div>';
  }
  function form(types, people) {
    return '<div class="lv-form">' + (people ? '<label>Employee<select id="lvPid">' + people.map(function (p) { return '<option value="' + esc(p.pid) + '">' + esc(p.name) + '</option>'; }).join('') + '</select></label>' : '') +
      '<label>Kind of leave<select id="lvType">' + types.map(function (t) { return '<option value="' + t[0] + '">' + esc(t[1]) + '</option>'; }).join('') + '</select></label>' +
      '<label>From<input type="date" id="lvFrom" value="' + todayS() + '"></label><label>To<input type="date" id="lvTo" value="' + todayS() + '"></label>' +
      '<label>Hours a day<input type="number" id="lvPer" step="0.1" min="0.5" max="12" value="7.6"></label>' +
      '<label class="lv-wide">Reason (optional)<input id="lvWhy" maxlength="400" placeholder="e.g. family holiday"></label></div>' +
      '<p class="muted lv-hint" id="lvHint"></p>';
  }
  function hint(types) {
    var t = types.filter(function (x) { return x[0] === $('#lvType').value; })[0]; if (t) $('#lvHint').textContent = t[4] + '. Weekends and public holidays are not counted.';
  }
  var readForm = function () { return { type: $('#lvType').value, from: $('#lvFrom').value, to: $('#lvTo').value, perDay: Number($('#lvPer').value) || 7.6, reason: $('#lvWhy').value, pid: $('#lvPid') ? $('#lvPid').value : '' }; };

  /* ---------- My leave (anyone) ---------- */
  function mine() {
    $('#title').textContent = 'My leave';
    return api('lvMine').then(function (d) {
      if (!d.linked) { V().innerHTML = '<div class="card"><h2>My leave</h2><p class="muted">Your login isn\'t linked to a person in People, so there\'s no leave to show. ' + (M.allowed('people', 'edit') ? 'Managers: use <a href="#leave">People → Leave</a>.' : 'Ask an administrator to link your login.') + '</p></div>'; return; }
      V().innerHTML = '<div class="card"><div class="card-h"><h2>' + esc(d.balance.name) + '</h2><span class="muted">' + esc(d.balance.employment) + '</span></div>' + balCards(d.balance) + '</div>' +
        '<div class="card"><h2>Ask for leave</h2>' + form(d.types) + '<div class="actions"><button class="btn btn-gold" id="lvSend">Send to my manager</button></div></div>' +
        '<div class="card"><h2>My requests</h2>' + (d.requests.length ? '<div class="table-wrap"><table class="prl-tbl"><thead><tr><th>Leave</th><th>When</th><th class="num">Hours</th><th>Status</th><th></th></tr></thead><tbody>' +
          d.requests.map(function (r) { return '<tr><td>' + esc(typeName(d.types, r.type)) + ' <span class="muted">' + esc(r.id) + '</span></td><td>' + esc(period(r)) + '</td><td class="num">' + h(r.hours) + '</td><td>' + (ST[r.status] || esc(r.status)) + (r.note && r.status !== 'pending' ? ' <span class="muted">' + esc(r.note) + '</span>' : '') + '</td><td>' + (r.status === 'pending' ? '<button class="btn btn-sm" data-cancel="' + esc(r.id) + '">Cancel</button>' : '') + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="muted">No leave asked for yet.</p>') + '</div>';
      hint(d.types); $('#lvType').onchange = function () { hint(d.types); };
      $('#lvFrom').onchange = function () { if ($('#lvTo').value < $('#lvFrom').value) $('#lvTo').value = $('#lvFrom').value; };
      $('#lvSend').onclick = function () {
        var b = this; b.disabled = true;
        api('lvRequest', readForm()).then(function (r) { toast('Sent: ' + h(r.request.hours) + ' of leave asked for'); mine(); }).catch(function (e) { b.disabled = false; fail(e); });
      };
      V().querySelectorAll('[data-cancel]').forEach(function (b) { b.onclick = function () { api('lvCancel', { id: b.getAttribute('data-cancel') }).then(function () { toast('Request cancelled'); mine(); }).catch(fail); }; });
    }).catch(fail);
  }

  /* ---------- People > Leave (managers) ---------- */
  function page(args) {
    if (args && args[0] && TABS.some(function (t) { return t[0] === args[0]; })) L.tab = args[0];
    $('#title').textContent = 'Leave';
    if (!M.allowed('people', 'edit')) { location.hash = '#myleave'; return; }
    V().innerHTML = '<div class="row" style="margin-bottom:12px"><div class="tabs" style="margin:0">' + TABS.map(function (t) { return '<a class="tab' + (L.tab === t[0] ? ' on' : '') + '" href="#leave/' + t[0] + '">' + t[1] + '</a>'; }).join('') + '</div></div><div id="lvBody"><div class="empty">Loading…</div></div>';
    var B = $('#lvBody');
    return ({ req: reqTab, cal: calTab, bal: balTab, 'new': newTab, nes: nesTab })[L.tab](B);
  }
  function reqTab(B) {
    return api('lvList').then(function (d) {
      var pend = d.requests.filter(function (r) { return r.status === 'pending'; }), rest = d.requests.filter(function (r) { return r.status !== 'pending'; });
      badge(pend.length);
      B.innerHTML = '<div class="card"><h2>Waiting for a decision (' + pend.length + ')</h2>' + (pend.length ? pend.map(function (r) {
        var b = d.balances[r.pid], key = { annual: 'annual', personal: 'personal', carers: 'personal', rdo: 'rdo' }[r.type];
        var left = b && key ? b.balances[key] - r.hours : null;
        return '<div class="lv-req"><div class="lv-req-h"><b>' + esc(r.name) + '</b> · ' + esc(r.label) + ' · ' + esc(period(r)) + ' · <b>' + h(r.hours) + '</b> (' + r.days.length + ' working day' + (r.days.length === 1 ? '' : 's') + ')</div>' +
          (r.reason ? '<div class="muted">“' + esc(r.reason) + '”</div>' : '') +
          (key && b ? '<div class="' + (left < 0 ? 'prl-bad' : 'muted') + '">' + esc(r.label) + ' balance ' + h(b.balances[key]) + ' → ' + h(left) + ' after this' + (left < 0 ? ' (would go below zero: only approve by agreement)' : '') + '</div>' : '') +
          (r.type === 'fdv' && b ? '<div class="muted">Family and domestic violence leave left this year: ' + h(b.fdvLeft) + '. Shown to others as “Away”; payslips show it as ordinary hours.</div>' : '') +
          (r.clashes.length ? '<div class="lv-clash">⚠ Also away: ' + r.clashes.map(function (c) { return esc(c.name) + ' (' + esc(period(c)) + (c.status === 'pending' ? ', waiting' : '') + ')'; }).join(', ') + '</div>' : '') +
          '<div class="actions"><input class="lv-note" data-note="' + esc(r.id) + '" placeholder="Note (optional)"><button class="btn btn-sm btn-danger" data-dec="' + esc(r.id) + '" data-d="declined">Decline</button><button class="btn btn-sm btn-gold" data-dec="' + esc(r.id) + '" data-d="approved">✓ Approve</button></div></div>';
      }).join('') : '<p class="muted">Nothing waiting.</p>') + '</div>' +
        '<div class="card"><h2>All leave</h2>' + (rest.length ? '<div class="table-wrap"><table class="prl-tbl"><thead><tr><th>Request</th><th>Employee</th><th>Leave</th><th>When</th><th class="num">Hours</th><th>Status</th><th></th></tr></thead><tbody>' +
          rest.map(function (r) { return '<tr><td class="muted">' + esc(r.id) + '</td><td><b>' + esc(r.name) + '</b></td><td>' + esc(r.label) + '</td><td>' + esc(period(r)) + '</td><td class="num">' + h(r.hours) + '</td><td>' + (ST[r.status] || '') + (r.decidedBy ? ' <span class="muted">' + esc(r.decidedBy) + '</span>' : '') + '</td><td>' + (r.status === 'approved' ? '<button class="btn btn-sm" data-dec="' + esc(r.id) + '" data-d="cancelled">Cancel leave</button>' : '') + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="muted">No other leave yet.</p>') + '</div>';
      B.querySelectorAll('[data-dec]').forEach(function (b) {
        b.onclick = function () {
          var id = b.getAttribute('data-dec'), dd = b.getAttribute('data-d'), n = B.querySelector('[data-note="' + id + '"]');
          var go = function () { b.disabled = true; api('lvDecide', { id: id, decision: dd, note: n ? n.value : '' }).then(function (r) { toast(id + ' ' + dd + (dd === 'approved' ? ': added to the timesheet' : '') + (r.skipped && r.skipped.length ? ' (' + r.skipped.length + ' day(s) in paid weeks left alone)' : '')); reqTab(B); }).catch(function (e) { b.disabled = false; fail(e); }); };
          if (dd === 'cancelled') M.confirmBox('Cancel ' + id + '?', 'The leave comes out of the timesheet again (weeks already paid are left alone).', 'Cancel leave', true).then(function (ok) { if (ok) go(); }); else go();
        };
      });
    }).catch(fail);
  }
  function calTab(B) {
    L.month = L.month || todayS().slice(0, 7);
    return api('lvCalendar', { month: L.month }).then(function (d) {
      var first = new Date(d.from + 'T00:00:00Z'), lead = (first.getUTCDay() + 6) % 7, cells = [], last = Number(d.to.slice(8));
      for (var i = 0; i < lead; i++) cells.push('<div class="lv-day lv-out"></div>');
      for (var n = 1; n <= last; n++) {
        var date = d.month + '-' + String(n).padStart(2, '0'), wd = new Date(date + 'T00:00:00Z').getUTCDay(), ph = d.holidays.indexOf(date) >= 0;
        var who = d.away.filter(function (a) { return a.from <= date && a.to >= date; });
        cells.push('<div class="lv-day' + (wd === 0 || wd === 6 ? ' lv-wk' : '') + (ph ? ' lv-ph' : '') + (who.length > 1 ? ' lv-busy' : '') + (date === todayS() ? ' lv-today' : '') + '"><span class="lv-n">' + n + '</span>' + (ph ? '<span class="lv-tag">Public holiday</span>' : '') +
          who.map(function (a) { return '<span class="lv-who' + (a.status === 'pending' ? ' lv-w8' : '') + '" title="' + esc(a.name + ': ' + a.label + (a.status === 'pending' ? ' (waiting)' : '')) + '">' + esc(a.name.split(' ')[0]) + '</span>'; }).join('') + '</div>');
      }
      var mName = new Date(d.from + 'T00:00:00Z').toLocaleDateString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      B.innerHTML = '<div class="card"><div class="row" style="gap:8px;margin-bottom:10px"><button class="btn btn-sm" id="calPrev">‹</button><b>' + esc(mName) + '</b><button class="btn btn-sm" id="calNext">›</button><span class="sp"></span><span class="muted" style="font-size:12px"><span class="lv-who">Approved</span> <span class="lv-who lv-w8">Waiting</span> · red days: more than one person away</span></div>' +
        '<div class="lv-cal">' + ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(function (x) { return '<div class="lv-dh">' + x + '</div>'; }).join('') + cells.join('') + '</div></div>';
      var shift = function (k) { var dt = new Date(d.from + 'T00:00:00Z'); dt.setUTCMonth(dt.getUTCMonth() + k); L.month = dt.toISOString().slice(0, 7); calTab(B); };
      $('#calPrev').onclick = function () { shift(-1); }; $('#calNext').onclick = function () { shift(1); };
    }).catch(fail);
  }
  function balTab(B) {
    return api('lvBalances').then(function (d) {
      B.innerHTML = '<div class="card"><div class="card-h"><h2>Leave balances</h2><span class="muted">Hours (7.6 h = 1 day). Balances grow with each pay run; set opening balances in Payroll → Pay profiles.</span></div>' +
        (d.rows.length ? '<div class="table-wrap"><table class="prl-tbl"><thead><tr><th>Employee</th><th>Employment</th><th class="num">Annual</th><th class="num">Booked</th><th class="num">Personal</th><th class="num">RDO bank</th></tr></thead><tbody>' +
          d.rows.map(function (r) { return '<tr><td><b>' + esc(r.name) + '</b></td><td>' + esc(r.employment) + '</td><td class="num">' + h(r.balances.annual) + ' <span class="muted">(' + dys(r.balances.annual) + ')</span></td><td class="num">' + (r.booked.annual ? h(r.booked.annual) : '–') + '</td><td class="num">' + h(r.balances.personal) + '</td><td class="num">' + h(r.balances.rdo) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="empty">No employees yet.</div>') + '</div>';
    }).catch(fail);
  }
  function newTab(B) {
    return Promise.all([api('lvBalances'), api('lvList')]).then(function (r) {
      var people = r[0].rows.map(function (x) { return { pid: x.pid, name: x.name }; }), types = r[1].types;
      B.innerHTML = '<div class="card"><h2>Enter leave for someone</h2><p class="muted">For leave agreed in person or by phone. It is approved straight away and goes into their timesheet.</p>' + form(types, people) +
        '<div class="actions"><button class="btn btn-gold" id="lvAdd">Save approved leave</button></div></div>';
      hint(types); $('#lvType').onchange = function () { hint(types); };
      $('#lvAdd').onclick = function () { var b = this; b.disabled = true; api('lvSave', readForm()).then(function (x) { toast('Leave saved and approved: ' + x.request.id); location.hash = '#leave/req'; }).catch(function (e) { b.disabled = false; fail(e); }); };
    }).catch(fail);
  }
  function nesTab(B) {
    return api('lvList').then(function (d) {
      B.innerHTML = '<div class="card"><h2>Leave types</h2><p class="muted">From the National Employment Standards and the building award. Casuals get the 25% loading instead of paid annual, personal and RDO leave, but do get paid family and domestic violence leave.</p><div class="table-wrap"><table class="prl-tbl"><thead><tr><th>Leave</th><th>Paid by MBS</th><th>What it gives</th></tr></thead><tbody>' +
        d.types.map(function (t) { return '<tr><td><b>' + esc(t[1]) + '</b></td><td>' + (t[3] ? 'Yes' : 'No') + '</td><td>' + esc(t[4]) + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
    }).catch(fail);
  }
  function badge(n) {
    var a = document.querySelector('[data-nav="leave"]'); if (!a) return;
    var b = a.querySelector('.lv-badge'); if (!b) { b = document.createElement('span'); b.className = 'lv-badge'; a.appendChild(b); }
    b.textContent = n || ''; b.hidden = !n;
  }
  // the nav: "My leave" only for logins linked to a person; a waiting-count on "Leave" for managers
  function navSetup() {
    var me = M.me || {}, my = document.querySelector('[data-nav="myleave"]');
    if (my) my.hidden = !me.personId;
    if (!M.allowed('people', 'edit')) ['leave', 'payroll'].forEach(function (k) { var x = document.querySelector('[data-nav="' + k + '"]'); if (x) x.hidden = true; });   // managers only
    if (M.allowed('people', 'edit') && document.querySelector('[data-nav="leave"]')) api('lvCount').then(function (r) { badge(r.pending); }).catch(function () {});
  }
  var tries = 0; (function wait() { if (M.me) navSetup(); else if (tries++ < 40) setTimeout(wait, 250); })();
  M.addView('leave', 'Leave', page, 'leave');
  M.addView('myleave', 'My leave', mine, 'myleave');
})();
