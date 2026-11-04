/* MBS Console v101: 🎁 Wonder Bird voucher draw.
   Website visitors who entered the draw (from the "🎁 Win $50" link and Mr. Fixit): their details, scores, the weekly
   leaderboard, and the vouchers issued to the top 3 each week ($50, $30, $20). Kept apart from Customers: they visited
   the site but are not (yet) customers. */
(function () {
  'use strict';
  var M = window.MBS; if (!M) return;
  var api = M.api, esc = M.esc, toast = M.toast, fail = M.fail, $ = M.$;
  var V = function () { return M.view(); };
  var P = { week: '', data: null, q: '', tab: 'board' };
  var day = function (ms) { return ms ? new Date(ms).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Australia/Sydney' }) : ''; };
  var dd = function (s) { return s ? new Date(s + 'T00:00:00Z').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : ''; };
  var MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' };
  var ST = { issued: 'Issued', redeemed: 'Used', void: 'Cancelled' };
  function isoWeek(ymd) {   // the ISO week a date (YYYY-MM-DD) falls in
    var d = new Date(ymd + 'T00:00:00Z'), dow = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - dow + 3);
    var y = d.getUTCFullYear(), j4 = new Date(Date.UTC(y, 0, 4));
    return y + '-W' + String(1 + Math.round(((d - j4) / 864e5 - 3 + ((j4.getUTCDay() + 6) % 7)) / 7)).padStart(2, '0');
  }
  function shift(n) { var d = new Date(P.data.range.from + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 7 * n); P.week = isoWeek(d.toISOString().slice(0, 10)); load(); }
  function kpi(k, v, s) { return '<div class="card kpi"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div><div class="s">' + esc(s) + '</div></div>'; }

  function page(args) {
    if (args && args[0] && ['board', 'players', 'vouchers'].indexOf(args[0]) >= 0) P.tab = args[0];
    $('#title').textContent = 'Wonder Bird draw';
    V().innerHTML = '<div id="wbBody"><div class="empty">Loading…</div></div>';
    return load();
  }
  function load() {
    return api('promoList', { week: P.week }).then(function (d) { P.data = d; P.week = d.week; draw(); }).catch(fail);
  }
  function draw() {
    var B = $('#wbBody'); if (!B || !P.data) return;
    var D = P.data, wk = D.week, players = D.players || [];
    var inWeek = players.filter(function (p) { return p.best && p.best[wk] != null; });
    var vAll = []; players.forEach(function (p) { (p.vouchers || []).forEach(function (v) { vAll.push(Object.assign({ id: p.id, name: p.first + ' ' + p.last, email: p.email, phone: p.phone }, v)); }); });
    var newWk = players.filter(function (p) { return isoWeek(new Date(p.created + 10 * 3600e3).toISOString().slice(0, 10)) === wk; }).length;
    var tabs = [['board', '🏆 Leaderboard'], ['players', '👥 Players (' + players.length + ')'], ['vouchers', '🎟 Vouchers (' + vAll.length + ')']];
    B.innerHTML = '<div class="row wb-top"><div class="tabs" style="margin:0">' + tabs.map(function (t) { return '<a class="tab' + (P.tab === t[0] ? ' on' : '') + '" href="#wonderbird/' + t[0] + '">' + t[1] + '</a>'; }).join('') + '</div>' +
      '<span class="sp"></span><button class="btn btn-sm" id="wbCsv" type="button">⬇ Export CSV</button></div>' +
      '<div class="grid kpis wb-kpis">' + kpi('Players', players.length, newWk + ' joined in ' + wk) + kpi(wk === D.thisWeek ? 'Played this week' : 'Played that week', inWeek.length, wk + ' · ' + dd(D.range.from) + ' – ' + dd(D.range.to)) +
      kpi('Vouchers issued', vAll.length, vAll.filter(function (v) { return v.status === 'redeemed'; }).length + ' used · ' + vAll.filter(function (v) { return v.status === 'issued'; }).length + ' open') +
      kpi('Prizes each week', '$' + D.prizes.join(' · $'), '1st · 2nd · 3rd, valid 90 days') + '</div>' +
      '<div class="card" style="margin-top:14px" id="wbTab"></div>';
    $('#wbCsv').onclick = function () { csv(players, vAll); };
    var T = $('#wbTab');
    if (P.tab === 'players') return playersTab(T, players);
    if (P.tab === 'vouchers') return vouchersTab(T, vAll);
    return boardTab(T, D);
  }

  function boardTab(T, D) {
    var over = D.week < D.thisWeek, top = D.top || [], done = top.slice(0, 3).filter(function (x) { return x.voucher; }).length;
    var canIssue = over && top.some(function (x, i) { return i < 3 && x.score > 0 && !x.voucher; }) && M.allowed('crm', 'edit');
    T.innerHTML = '<div class="row" style="margin-bottom:12px;gap:8px"><button class="btn btn-sm" id="wbPrev" type="button" title="Week before">‹</button>' +
      '<b class="wb-wk">' + esc(D.week) + '</b><span class="muted">' + esc(dd(D.range.from) + ' – ' + dd(D.range.to)) + '</span>' +
      '<button class="btn btn-sm" id="wbNext" type="button" title="Week after"' + (D.week >= D.thisWeek ? ' disabled' : '') + '>›</button>' +
      (D.week !== D.thisWeek ? '<button class="btn btn-sm" id="wbNow" type="button">This week</button>' : '') + '<span class="sp"></span>' +
      (canIssue ? '<button class="btn btn-gold btn-sm" id="wbIssue" type="button">🎟 Issue this week’s vouchers</button>'
        : '<span class="muted wb-note">' + (!over ? 'Vouchers can be issued once this week ends (after Sunday).' : done ? '✓ Vouchers issued for this week' : top.length ? '' : '') + '</span>') + '</div>' +
      (top.length ? '<div class="wb-scroll"><table class="sc-table wb-tbl"><thead><tr><th>#</th><th>Player</th><th>Contact</th><th class="num">Best score</th><th>Voucher</th></tr></thead><tbody>' +
        top.map(function (x, i) {
          var v = x.voucher, prize = i < 3 && x.score > 0 ? D.prizes[i] : 0;
          return '<tr class="' + (i < 3 ? 'wb-win' : '') + '"><td>' + (MEDAL[i + 1] || i + 1) + '</td><td><b>' + esc(x.first + ' ' + x.last) + '</b><div class="muted wb-id">' + esc(x.id) + '</div></td>' +
            '<td><a href="tel:' + esc(x.phone) + '">' + esc(x.phone) + '</a><div><a href="mailto:' + esc(x.email) + '">' + esc(x.email) + '</a></div></td>' +
            '<td class="num"><b>' + esc(x.score.toLocaleString('en-AU')) + '</b></td>' +
            '<td>' + (v ? '<code class="wb-code">' + esc(v.code) + '</code> <span class="chip wb-st-' + esc(v.status) + '">$' + v.amount + ' · ' + esc(ST[v.status] || v.status) + '</span>' : prize ? '<span class="muted">$' + prize + (over ? ' to issue' : ' if it stays') + '</span>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>'
        : '<div class="empty">Nobody has played in this week yet.</div>');
    $('#wbPrev').onclick = function () { shift(-1); };
    $('#wbNext').onclick = function () { shift(1); };
    if ($('#wbNow')) $('#wbNow').onclick = function () { P.week = ''; load(); };
    if ($('#wbIssue')) $('#wbIssue').onclick = function () {
      var w = top.slice(0, 3).filter(function (x) { return x.score > 0 && !x.voucher; });
      M.confirmBox('Issue vouchers for ' + D.week + '?', w.map(function (x) { var i = top.indexOf(x); return (MEDAL[i + 1] || '') + ' <b>' + esc(x.first + ' ' + x.last) + '</b>: $' + D.prizes[i] + ' (score ' + esc(x.score) + ')'; }).join('<br>') +
        '<br><br>Each gets its own voucher number, valid for 90 days. Then email or call the winners.', 'Issue vouchers').then(function (ok) {
        if (!ok) return;
        api('promoIssue', { week: D.week }).then(function (r) { toast(r.issued.length + ' vouchers issued'); return load(); }).catch(fail);
      });
    };
  }

  function playersTab(T, players) {
    var q = P.q.toLowerCase().trim();
    var rows = players.filter(function (p) { return !q || (p.id + ' ' + p.first + ' ' + p.last + ' ' + p.email + ' ' + p.phone).toLowerCase().indexOf(q) >= 0; });
    T.innerHTML = '<div class="row" style="margin-bottom:10px"><input id="wbQ" type="search" placeholder="Find a name, email or phone…" value="' + esc(P.q) + '" style="max-width:320px"><span class="sp"></span><span class="muted">' + rows.length + ' of ' + players.length + '</span></div>' +
      (rows.length ? '<div class="wb-scroll"><table class="sc-table wb-tbl"><thead><tr><th>Player</th><th>Name</th><th>Contact number</th><th>Email</th><th>Joined</th><th class="num">Plays</th><th class="num">Best ever</th><th>Last played</th><th>Vouchers</th></tr></thead><tbody>' +
        rows.map(function (p) {
          return '<tr><td class="wb-id">' + esc(p.id) + '</td><td><b>' + esc(p.first + ' ' + p.last) + '</b></td><td><a href="tel:' + esc(p.phone) + '">' + esc(p.phone) + '</a></td><td><a href="mailto:' + esc(p.email) + '">' + esc(p.email) + '</a></td>' +
            '<td>' + esc(day(p.created)) + '</td><td class="num">' + esc(p.plays || 0) + '</td><td class="num">' + esc((p.top || 0).toLocaleString('en-AU')) + '</td><td>' + esc(day(p.lastPlayed)) + '</td>' +
            '<td>' + (p.vouchers || []).map(function (v) { return '<span class="chip wb-st-' + esc(v.status) + '" title="' + esc(v.code + ' · ' + v.week) + '">$' + v.amount + '</span>'; }).join(' ') + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<div class="empty">' + (players.length ? 'No player matches.' : 'Nobody has entered yet. Visitors enter from “🎁 Win $50” on the website.') + '</div>');
    var i = $('#wbQ'); i.oninput = function () { P.q = i.value; var pos = i.selectionStart; playersTab(T, players); var j = $('#wbQ'); j.focus(); j.setSelectionRange(pos, pos); };
  }

  function vouchersTab(T, vAll) {
    vAll.sort(function (a, b) { return b.week.localeCompare(a.week) || a.place - b.place; });
    var edit = M.allowed('crm', 'edit');
    T.innerHTML = vAll.length ? '<div class="wb-scroll"><table class="sc-table wb-tbl"><thead><tr><th>Voucher number</th><th>Week</th><th>Place</th><th class="num">Amount</th><th>Winner</th><th>Contact</th><th>Expires</th><th>Status</th><th>Used on job</th>' + (edit ? '<th></th>' : '') + '</tr></thead><tbody>' +
      vAll.map(function (v, k) {
        var expired = v.status === 'issued' && v.expires < new Date().toISOString().slice(0, 10);
        return '<tr><td><code class="wb-code">' + esc(v.code) + '</code></td><td>' + esc(v.week) + '</td><td>' + (MEDAL[v.place] || v.place) + '</td><td class="num">$' + esc(v.amount) + '</td>' +
          '<td><b>' + esc(v.name) + '</b><div class="muted wb-id">' + esc(v.id) + '</div></td><td><a href="tel:' + esc(v.phone) + '">' + esc(v.phone) + '</a><div><a href="mailto:' + esc(v.email) + '">' + esc(v.email) + '</a></div></td>' +
          '<td>' + esc(dd(v.expires)) + (expired ? ' <span class="chip wb-st-void">expired</span>' : '') + '</td><td><span class="chip wb-st-' + esc(v.status) + '">' + esc(ST[v.status] || v.status) + '</span></td><td>' + (v.job ? '<a href="#job/' + encodeURIComponent(v.job) + '">' + esc(v.job) + '</a>' : '') + '</td>' +
          (edit ? '<td class="wb-act">' + (v.status !== 'redeemed' ? '<button class="btn btn-sm" data-k="' + k + '" data-s="redeemed" type="button">✓ Used</button>' : '') +
            (v.status !== 'issued' ? '<button class="btn btn-sm" data-k="' + k + '" data-s="issued" type="button">↺ Reopen</button>' : '') +
            (v.status === 'issued' ? '<button class="btn btn-sm" data-k="' + k + '" data-s="void" type="button">Cancel</button>' : '') + '</td>' : '') + '</tr>';
      }).join('') + '</tbody></table></div>' : '<div class="empty">No vouchers yet. Issue them from the Leaderboard once a week ends.</div>';
    Array.prototype.forEach.call(T.querySelectorAll('[data-k]'), function (b) {
      b.onclick = function () {
        var v = vAll[+b.getAttribute('data-k')], st = b.getAttribute('data-s');
        if (st === 'redeemed') return useDialog(v);
        b.disabled = true;
        api('promoVoucher', { id: v.id, code: v.code, status: st }).then(function () { toast(v.code + ': ' + ST[st]); return load(); }).catch(function (e) { b.disabled = false; fail(e); });
      };
    });
  }

  // one voucher per job: ask which job it is used on (the server refuses a job that already used one)
  function useDialog(v) {
    M.modal('<h2>Mark ' + esc(v.code) + ' as used</h2><p class="muted">$' + esc(v.amount) + ' for ' + esc(v.name) + '. One voucher per job: vouchers can\'t be combined on the same job.</p>' +
      '<label>Job number it is used on<input id="wbJob" maxlength="40" placeholder="e.g. MBS-1234" autocomplete="off"></label><p class="wb-err" id="wbJobErr" role="alert"></p>' +
      '<div class="actions" style="justify-content:flex-end"><button class="btn" data-close type="button">Cancel</button><button class="btn btn-gold" id="wbUse" type="button">✓ Mark used</button></div>');
    var go = function () {
      var job = $('#wbJob').value.trim(), e = $('#wbJobErr');
      if (!job) { e.textContent = 'Type the job number.'; return; }
      $('#wbUse').disabled = true;
      api('promoVoucher', { id: v.id, code: v.code, status: 'redeemed', job: job }).then(function () { M.closeModal(); toast(v.code + ': used on ' + job.toUpperCase()); return load(); })
        .catch(function (x) { $('#wbUse').disabled = false; e.textContent = x.message; });
    };
    $('#wbUse').onclick = go; $('#wbJob').onkeydown = function (k) { if (k.key === 'Enter') go(); }; $('#wbJob').focus();
  }

  function csv(players, vAll) {
    var cell = function (x) { x = String(x == null ? '' : x); return /[",\r\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; };
    var L = [['Player', 'First name', 'Last name', 'Contact number', 'Email', 'Joined', 'Plays', 'Best ever score', 'Best this week (' + P.week + ')', 'Last played', 'Vouchers won', 'Voucher numbers']];
    players.forEach(function (p) {
      L.push([p.id, p.first, p.last, p.phone, p.email, day(p.created), p.plays || 0, p.top || 0, (p.best || {})[P.week] != null ? p.best[P.week] : '', day(p.lastPlayed), (p.vouchers || []).length,
        (p.vouchers || []).map(function (v) { return v.code + ' ($' + v.amount + ', ' + v.week + ', ' + (ST[v.status] || v.status) + (v.job ? ' on ' + v.job : '') + ')'; }).join('; ')]);
    });
    var t = '﻿' + L.map(function (r) { return r.map(cell).join(','); }).join('\r\n') + '\r\n';
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([t], { type: 'text/csv;charset=utf-8' })); a.download = 'MBS-WonderBird-players-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    toast(players.length + ' players exported');
  }

  M.addView('wonderbird', 'Wonder Bird draw', page, 'wonderbird');
})();
