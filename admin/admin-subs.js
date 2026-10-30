/* MBS Console v47: Sub-contractors (subbies). A register of the trades MBS hires in: plumbers, sparkies, cleaners and more,
   with licence, insurance, workers comp, white card and SWMS checks, rates, areas, rating and status. */
(function () {
  'use strict';
  var M = window.MBS; if (!M) return;
  var api = M.api, esc = M.esc, toast = M.toast, fail = M.fail, $ = M.$;
  var V = function () { return M.view(); };
  var S = { tab: 'list', q: '', trade: '', status: '', showArchived: false, data: null };
  var money = function (n) { return n ? '$' + (Math.round(n * 100) / 100).toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : ''; };
  var dmy = function (d) { return d ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) : ''; };
  var CW = { ok: ['✓ Compliant', 'ok'], due: ['Due soon', 'due'], expired: ['Expired', 'bad'], missing: ['Missing papers', 'miss'], 'n/a': ['n/a', 'na'] };
  var DOC = { ok: 'OK', due: 'due soon', expired: 'EXPIRED', missing: 'missing', 'n/a': 'n/a' };
  var STC = { Preferred: 'pref', Approved: 'ok', 'On trial': 'trial', 'On hold': 'hold', 'Do not use': 'bad' };
  var tradeName = function (k) { var t = ((S.data && S.data.trades) || []).filter(function (x) { return x.key === k; })[0]; return t ? t.name : k; };
  var stars = function (n) { n = n || 0; return n ? '<span class="sc-stars" title="' + n + ' out of 5">' + '★★★★★'.slice(0, n) + '<i>' + '★★★★★'.slice(n) + '</i></span>' : '<span class="muted">–</span>'; };
  var cchip = function (w) { var c = CW[w] || CW.ok; return '<span class="scchip scchip-' + c[1] + '">' + c[0] + '</span>'; };
  var schip = function (s) { return '<span class="scst scst-' + (STC[s] || 'ok') + '">' + esc(s) + '</span>'; };

  function load() { return api('subList').then(function (d) { S.data = d; badge(d); return d; }); }
  function badge(d) {
    var n = d.subs.filter(function (s) { return !s.archived && s.status !== 'Do not use' && (s.comp.worst === 'expired' || s.comp.worst === 'due'); }).length;
    var a = document.querySelector('[data-nav=subscomp]'); if (!a) return;
    var b = a.querySelector('.nbadge'); if (!b) { b = document.createElement('b'); b.className = 'nbadge'; a.appendChild(b); }
    b.textContent = n; b.hidden = !n; b.title = n + ' sub-contractor' + (n === 1 ? '' : 's') + ' with a licence or insurance expired or due';
  }
  function navOn() { document.querySelectorAll('[data-nav]').forEach(function (n) { var k = n.getAttribute('data-nav'); if (k === 'subs' || k === 'subscomp') n.classList.toggle('on', k === (S.tab === 'compliance' ? 'subscomp' : 'subs')); }); }

  function subsPage(args) {
    S.tab = args && args[0] === 'compliance' ? 'compliance' : 'list';
    return load().then(function () { draw(); if (args && /^SC-\d+$/.test(args[0] || '')) edit(args[0]); });
  }
  function draw() {
    navOn();
    var d = S.data, act = d.subs.filter(function (s) { return !s.archived; });
    var probs = act.filter(function (s) { return s.status !== 'Do not use' && (s.comp.worst === 'expired' || s.comp.worst === 'due'); });   // same count as the menu badge
    V().innerHTML = '<div class="row" style="margin-bottom:12px"><div class="tabs" style="margin:0">' +
        '<button class="tab' + (S.tab === 'list' ? ' on' : '') + '" data-stab="list">👷 Sub-contractors <b>' + act.length + '</b></button>' +
        '<button class="tab' + (S.tab === 'compliance' ? ' on' : '') + '" data-stab="compliance">🛡 Licences &amp; insurance' + (probs.length ? ' <b class="bad">' + probs.length + '</b>' : '') + '</button></div>' +
        '<span class="sp"></span><button class="btn btn-gold" id="scNew">＋ Sub-contractor</button></div><div id="scBody"></div>';
    V().querySelectorAll('[data-stab]').forEach(function (b) { b.onclick = function () { S.tab = b.getAttribute('data-stab'); history.replaceState(null, '', S.tab === 'list' ? '#subs' : '#subs/compliance'); draw(); }; });
    $('#scNew').onclick = function () { edit(''); };
    if (S.tab === 'compliance') compTab(); else listTab();
  }

  function listTab() {
    var d = S.data, all = d.subs.filter(function (s) { return S.showArchived || !s.archived; });
    var count = {}; all.forEach(function (s) { count[s.trade] = (count[s.trade] || 0) + 1; (s.trades || []).forEach(function (t) { count[t] = (count[t] || 0) + 1; }); });
    var q = S.q.toLowerCase();
    var L = all.filter(function (s) {
      if (S.trade && s.trade !== S.trade && (s.trades || []).indexOf(S.trade) < 0) return false;
      if (S.status && s.status !== S.status) return false;
      return !q || [s.business, s.contact, s.phone, s.email, s.suburb, s.areas, tradeName(s.trade), s.id, s.licenceNo].join(' ').toLowerCase().indexOf(q) >= 0;
    });
    $('#scBody').innerHTML = '<div class="card"><div class="row" style="margin-bottom:10px;gap:8px">' +
        '<input id="scQ" type="search" placeholder="Search name, phone, suburb, licence…" value="' + esc(S.q) + '" style="max-width:280px">' +
        '<select id="scTrade" style="width:auto"><option value="">All trades</option>' + d.trades.map(function (t) { return '<option value="' + t.key + '"' + (S.trade === t.key ? ' selected' : '') + '>' + esc(t.name) + (count[t.key] ? ' (' + count[t.key] + ')' : '') + '</option>'; }).join('') + '</select>' +
        '<select id="scStatus" style="width:auto"><option value="">Any status</option>' + d.statuses.map(function (s) { return '<option' + (S.status === s ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select>' +
        '<label class="muted" style="display:flex;gap:6px;align-items:center;font-size:13px"><input type="checkbox" id="scArch" style="width:auto"' + (S.showArchived ? ' checked' : '') + '>Show archived</label>' +
        '<span class="sp"></span><span class="muted" style="font-size:13px">' + L.length + ' shown</span></div>' +
        '<div class="sc-chips">' + d.trades.filter(function (t) { return count[t.key]; }).map(function (t) { return '<button class="sc-tchip' + (S.trade === t.key ? ' on' : '') + '" data-tr="' + t.key + '">' + esc(t.name) + ' <b>' + count[t.key] + '</b></button>'; }).join('') + '</div>' +
      (L.length ? '<div class="table-wrap"><table class="sc-table"><thead><tr><th>Business</th><th>Trade</th><th>Phone</th><th class="hide-sm">Email</th><th class="num">Rate</th><th>Rating</th><th>Licence &amp; insurance</th><th>Status</th><th></th></tr></thead><tbody>' +
        L.map(function (s) {
          var tel = String(s.phone || '').replace(/[^\d+]/g, '');
          return '<tr data-scid="' + esc(s.id) + '"' + (s.archived ? ' class="tdone"' : '') + '><td><button class="linkish" data-scedit>' + esc(s.business) + '</button><br><small class="muted">' + esc([s.contact, s.suburb].filter(Boolean).join(' · ')) + '</small></td>' +
            '<td>' + esc(tradeName(s.trade)) + ((s.trades || []).length ? '<br><small class="muted">+ ' + esc(s.trades.map(tradeName).join(', ')) + '</small>' : '') + '</td>' +
            '<td class="nowrap">' + (tel ? '<a href="tel:' + esc(tel) + '">' + esc(s.phone) + '</a>' : '') + '</td><td class="hide-sm">' + (s.email ? '<a href="mailto:' + esc(s.email) + '">' + esc(s.email) + '</a>' : '') + '</td>' +
            '<td class="num nowrap">' + (s.rate ? money(s.rate) + '<small class="muted">/hr</small>' : '') + (s.callout ? '<br><small class="muted">call-out ' + money(s.callout) + '</small>' : '') + '</td>' +
            '<td class="nowrap">' + stars(s.rating) + '</td><td>' + cchip(s.comp.worst) + (s.comp.problems.length ? '<br><small class="muted">' + esc(s.comp.problems.join(' · ')) + '</small>' : '') + '</td>' +
            '<td>' + schip(s.status) + '</td><td><button class="btn btn-sm" data-scedit>Edit</button></td></tr>';
        }).join('') + '</tbody></table></div>'
        : '<div class="empty">' + (all.length ? 'No sub-contractors match.' : 'No sub-contractors yet. Add your plumbers, sparkies, tilers, cleaners and other trades with <b>＋ Sub-contractor</b>.') + '</div>') + '</div>';
    var B = $('#scBody');
    $('#scQ').oninput = function () { S.q = this.value; var pos = this.selectionStart; listTab(); var i = $('#scQ'); i.focus(); try { i.setSelectionRange(pos, pos); } catch (e) {} };
    $('#scTrade').onchange = function () { S.trade = this.value; listTab(); };
    $('#scStatus').onchange = function () { S.status = this.value; listTab(); };
    $('#scArch').onchange = function () { S.showArchived = this.checked; listTab(); };
    B.querySelectorAll('[data-tr]').forEach(function (b) { b.onclick = function () { var k = b.getAttribute('data-tr'); S.trade = S.trade === k ? '' : k; listTab(); }; });
    B.querySelectorAll('[data-scedit]').forEach(function (b) { b.onclick = function () { edit(b.closest('tr').getAttribute('data-scid')); }; });
  }

  function compTab() {
    var d = S.data, act = d.subs.filter(function (s) { return !s.archived && s.status !== 'Do not use'; });
    var n = { ok: 0, due: 0, expired: 0, missing: 0 }; act.forEach(function (s) { n[s.comp.worst]++; });
    var rows = [];
    act.forEach(function (s) {
      [['Licence', s.comp.lic, s.licenceExpiry, s.licenceNo], ['Public liability', s.comp.pl, s.plExpiry, ''], ['Workers comp', s.comp.wc, s.wcExpiry, '']].forEach(function (x) {
        if (x[1] === 'expired' || x[1] === 'due' || x[1] === 'missing') rows.push({ s: s, doc: x[0], st: x[1], exp: x[2], no: x[3] });
      });
      if (!s.whiteCard) rows.push({ s: s, doc: 'White card', st: 'missing', exp: '' });
      if (!s.swms) rows.push({ s: s, doc: 'SWMS', st: 'missing', exp: '' });
    });
    var rank = { expired: 0, due: 1, missing: 2 };
    rows.sort(function (a, b) { return rank[a.st] - rank[b.st] || (a.exp || '9') .localeCompare(b.exp || '9') || a.s.business.localeCompare(b.s.business); });
    var kpi = function (k, v, s, cls) { return '<div class="card kpi' + (cls ? ' ' + cls : '') + '"><div class="k">' + k + '</div><div class="v">' + v + '</div><div class="s">' + s + '</div></div>'; };
    $('#scBody').innerHTML = '<div class="grid kpis ckpis">' + kpi('Active sub-contractors', act.length, 'not archived or "do not use"') + kpi('All papers in order', n.ok, 'licence, insurance, white card, SWMS') +
        kpi('Expiring in 30 days', n.due, 'ask for the new certificate', n.due ? 'kpi-warn' : '') + kpi('Expired', n.expired, 'don\'t send them to site', n.expired ? 'kpi-bad' : '') + kpi('Papers missing', n.missing, 'ask for copies', '') + '</div>' +
      '<div class="card" style="margin-top:14px"><h2>To follow up</h2><p class="muted" style="margin:-4px 0 10px;font-size:13px">Before a subbie starts on site they need a current licence for their trade, public liability insurance, workers comp (or their own cover as a sole trader), a white card and a SWMS for high-risk work.</p>' +
      (rows.length ? '<div class="table-wrap"><table class="sc-table"><thead><tr><th>Sub-contractor</th><th>Document</th><th>State</th><th>Expiry</th><th>Contact</th></tr></thead><tbody>' + rows.map(function (r) {
        var tel = String(r.s.phone || '').replace(/[^\d+]/g, ''), subj = encodeURIComponent('Updated ' + r.doc.toLowerCase() + ' needed: ' + r.s.business);
        return '<tr data-scid="' + esc(r.s.id) + '" class="click"><td><b>' + esc(r.s.business) + '</b><br><small class="muted">' + esc(tradeName(r.s.trade)) + '</small></td><td>' + r.doc + (r.no ? '<br><small class="muted">' + esc(r.no) + '</small>' : '') + '</td>' +
          '<td><span class="scdoc scdoc-' + r.st + '">' + DOC[r.st] + '</span></td><td class="nowrap">' + (r.exp ? dmy(r.exp) : '–') + '</td>' +
          '<td class="nowrap">' + (tel ? '<a class="btn btn-sm" href="tel:' + esc(tel) + '" title="Call">📞</a> ' : '') + (r.s.email ? '<a class="btn btn-sm" href="mailto:' + esc(r.s.email) + '?subject=' + subj + '" title="Email">✉</a>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<div class="empty">Everyone\'s papers are in order. 👍</div>') + '</div>';
    $('#scBody').querySelectorAll('tr[data-scid]').forEach(function (tr) { tr.onclick = function (e) { if (e.target.closest('a')) return; edit(tr.getAttribute('data-scid')); }; });
  }

  function edit(id) {
    var go = function (s, comp) {
      s = s || { trade: S.trade || 'plumber', status: 'Approved', rating: 0, trades: [] };
      var L = s.licence || {}, I = s.insurance || {}, W = s.workersComp || {}, T = S.data.trades;
      var f = function (k, label, v, ph, type, extra) { return '<label' + (extra || '') + '>' + label + '<input data-k="' + k + '" value="' + esc(v == null ? '' : v) + '" placeholder="' + esc(ph || '') + '"' + (type ? ' type="' + type + '"' : '') + '></label>'; };
      var cb = function (k, label, v) { return '<label class="sc-cb"><input type="checkbox" data-k="' + k + '"' + (v ? ' checked' : '') + '> ' + label + '</label>'; };
      M.modal('<h2>' + (id ? esc(s.business) + ' <small class="muted">' + esc(id) + '</small>' : 'New sub-contractor') + '</h2>' + (comp && comp.problems.length ? '<p class="sk-warn" style="margin:8px 0 0">⚠ ' + esc(comp.problems.join(' · ')) + '</p>' : '') +
        '<div class="form sc-form" style="margin-top:12px">' +
        '<h3 class="full">Business</h3>' + f('business', 'Business name', s.business, 'e.g. Hills Plumbing Services') + f('contact', 'Contact person', s.contact, 'e.g. Mick') +
        '<label>Main trade<select data-k="trade">' + T.map(function (t) { return '<option value="' + t.key + '"' + (s.trade === t.key ? ' selected' : '') + '>' + esc(t.name) + '</option>'; }).join('') + '</select></label>' +
        f('phone', 'Mobile', s.phone, '04xx xxx xxx', 'tel') + f('phone2', 'Other phone', s.phone2, '', 'tel') + f('email', 'Email', s.email, 'name@business.com.au', 'email') +
        f('abn', 'ABN', s.abn, '11 digits') + '<label>GST<span class="sc-inline">' + cb('gst', 'Registered for GST', s.gst) + '</span></label>' +
        f('address', 'Address', s.address, '', '', ' class="full"') + f('suburb', 'Based in (suburb)', s.suburb, 'e.g. Castle Hill') + f('areas', 'Areas they cover', s.areas, 'e.g. Hills District, Parramatta, Blacktown') +
        '<details class="full sc-more"' + ((s.trades || []).length ? ' open' : '') + '><summary>Other trades they do (' + (s.trades || []).length + ')</summary><div class="sc-trades">' +
          T.map(function (t) { return '<label class="sc-cb"><input type="checkbox" data-tr2="' + t.key + '"' + ((s.trades || []).indexOf(t.key) >= 0 ? ' checked' : '') + '> ' + esc(t.name) + '</label>'; }).join('') + '</div></details>' +
        '<h3 class="full">Licence &amp; insurance</h3>' + f('lic.number', 'Licence number', L.number, 'NSW Fair Trading') + f('lic.class', 'Licence class', L.class, 'e.g. Plumber, drainer') + f('lic.expiry', 'Licence expiry', L.expiry, '', 'date') +
        f('ins.insurer', 'Public liability insurer', I.insurer, '') + f('ins.policy', 'Policy number', I.policy, '') + f('ins.cover', 'Cover ($)', I.cover || '', 'e.g. 20000000') + f('ins.expiry', 'Public liability expiry', I.expiry, '', 'date') +
        f('wc.policy', 'Workers comp policy', W.policy, '') + f('wc.expiry', 'Workers comp expiry', W.expiry, '', 'date') + '<label>Sole trader<span class="sc-inline">' + cb('wc.soleTrader', 'No employees (own cover)', W.soleTrader) + '</span></label>' +
        f('whiteCard', 'White card number', s.whiteCard, 'General construction induction') + '<label>SWMS<span class="sc-inline">' + cb('swms', 'Safe Work Method Statement on file', s.swms) + '</span></label>' +
        '<h3 class="full">Rates &amp; work</h3>' + f('rate', 'Hourly rate ($, ex GST)', s.rate || '', 'e.g. 95') + f('callout', 'Call-out fee ($)', s.callout || '', '') + f('afterHours', 'After-hours rate ($/hr)', s.afterHours || '', '') +
        f('rateNote', 'Pricing notes', s.rateNote, 'e.g. fixed price per bathroom') + f('terms', 'Payment terms', s.terms, 'e.g. 7 days') + f('availability', 'Availability', s.availability, 'e.g. Mon–Sat, 24/7 emergencies') +
        '<label>Status<select data-k="status">' + S.data.statuses.map(function (x) { return '<option' + (s.status === x ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select></label>' +
        '<label>Rating<select data-k="rating">' + [0, 1, 2, 3, 4, 5].map(function (x) { return '<option value="' + x + '"' + (+s.rating === x ? ' selected' : '') + '>' + (x ? '★★★★★'.slice(0, x) + ' (' + x + ')' : 'Not rated') + '</option>'; }).join('') + '</select></label>' +
        f('lastUsed', 'Last used', s.lastUsed, '', 'date') +
        '<label class="full">Notes<textarea data-k="notes" rows="3" placeholder="Quality, reliability, who to ask for…">' + esc(s.notes || '') + '</textarea></label></div>' +
        '<div class="actions" style="justify-content:space-between;margin-top:14px">' + (id ? '<button class="btn" id="scArchB" type="button">' + (s.archived ? 'Restore' : 'Archive') + '</button>' : '<span></span>') +
        '<span><button class="btn" data-close type="button">Cancel</button> <button class="btn btn-gold" id="scSave" type="button">Save sub-contractor</button></span></div>');
      $('#modal .modal-card').classList.add('sc-wide');
      var collect = function () {
        var o = { id: id || '', licence: {}, insurance: {}, workersComp: {}, trades: [] }, map = { lic: 'licence', ins: 'insurance', wc: 'workersComp' };
        document.querySelectorAll('#modal [data-k]').forEach(function (el) {
          var k = el.getAttribute('data-k'), v = el.type === 'checkbox' ? el.checked : el.value, p = k.split('.');
          if (p.length === 2) o[map[p[0]]][p[1]] = v; else o[k] = v;
        });
        document.querySelectorAll('#modal [data-tr2]:checked').forEach(function (el) { o.trades.push(el.getAttribute('data-tr2')); });
        return o;
      };
      var save = function (o, msg) { return api('subSave', { sub: o }).then(function () { M.closeModal(); toast(msg); return load().then(function () { if (location.hash.indexOf('#subs') === 0) { history.replaceState(null, '', S.tab === 'list' ? '#subs' : '#subs/compliance'); draw(); } }); }).catch(fail); };
      $('#scSave').onclick = function () { save(Object.assign({}, s, collect()), 'Sub-contractor saved'); };
      var ar = $('#scArchB'); if (ar) ar.onclick = function () { var o = Object.assign({}, s, collect()); o.archived = !s.archived; save(o, o.archived ? 'Archived' : 'Restored'); };
    };
    if (id) api('subGet', { id: id }).then(function (r) { go(r.sub, r.comp); }).catch(fail); else go(null);
  }

  new MutationObserver(function () { if ($('#modal').hidden) $('#modal .modal-card').classList.remove('sc-wide'); }).observe($('#modal'), { attributes: true, attributeFilter: ['hidden'] });
  M.subs = { load: load, list: function () { return S.data ? S.data.subs : []; }, tradeName: tradeName };
  M.addView('subs', 'Sub-contractors', subsPage, 'subs');
  var tick = function () { if (!document.getElementById('app').hidden) load().catch(function () {}); };
  new MutationObserver(function () { if (!document.getElementById('app').hidden) tick(); }).observe(document.getElementById('app'), { attributes: true, attributeFilter: ['hidden'] });
  setTimeout(tick, 1800);
})();
