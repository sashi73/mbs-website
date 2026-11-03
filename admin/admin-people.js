/* MBS Console v86: People: employees and contractors (MBS's own team). Like Subbies: details, role and trade, rates, tickets and
   licences with expiry checks, insurance for contractors, status and rating. Linked to the project plans: each person's
   assignments and workload come from the plans (resources, story owners, stakeholders, project manager). Only people in this
   register can be given a login (Users & access). */
(function () {
  'use strict';
  var M = window.MBS; if (!M) return;
  var api = M.api, esc = M.esc, toast = M.toast, fail = M.fail, $ = M.$;
  var V = function () { return M.view(); };
  var S = { tab: 'list', q: '', type: '', role: '', status: '', showArchived: false, data: null, assign: null, users: null };
  var money = function (n) { return n ? '$' + (Math.round(n * 100) / 100).toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : ''; };
  var dmy = function (d) { return d ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) : ''; };
  var CW = { ok: ['✓ Up to date', 'ok'], due: ['Due soon', 'due'], expired: ['Expired', 'bad'], missing: ['Missing', 'miss'] };
  var DOC = { ok: 'OK', due: 'due soon', expired: 'EXPIRED', missing: 'missing' };
  var STC = { Active: 'ok', 'On leave': 'hold', Inactive: 'bad' };
  var can = function (lv) { var me = M.me || {}; return me.owner || ((me.mods || {}).people === 'edit') || (lv === 'view' && (me.mods || {}).people === 'view'); };
  var canUsers = function () { var me = M.me || {}; return me.owner || ['view', 'edit'].indexOf((me.mods || {}).users) >= 0; };
  var cchip = function (w) { var c = CW[w] || CW.ok; return '<span class="scchip scchip-' + c[1] + '">' + c[0] + '</span>'; };
  var schip = function (s) { return '<span class="scst scst-' + (STC[s] || 'ok') + '">' + esc(s) + '</span>'; };
  var stars = function (n) { n = n || 0; return n ? '<span class="sc-stars" title="' + n + ' out of 5">' + '★★★★★'.slice(0, n) + '<i>' + '★★★★★'.slice(n) + '</i></span>' : '<span class="muted">–</span>'; };
  var tradeName = function (k) { var t = ((S.data && S.data.trades) || []).filter(function (x) { return x.key === k; })[0]; return t ? t.name : ''; };
  var ini = function (n) { return String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase(); };

  function load() { return api('pplList').then(function (d) { S.data = d; badge(d); return d; }); }
  function badge(d) {
    var n = d.people.filter(function (p) { return !p.archived && p.status !== 'Inactive' && (p.comp.worst === 'expired' || p.comp.worst === 'due'); }).length;
    var a = document.querySelector('[data-nav=peoplecomp]'); if (!a) return;
    var b = a.querySelector('.nbadge'); if (!b) { b = document.createElement('b'); b.className = 'nbadge'; a.appendChild(b); }
    b.textContent = n; b.hidden = !n; b.title = n + ' with a ticket, licence or insurance expired or due';
  }
  function navOn() { document.querySelectorAll('[data-nav]').forEach(function (n) { var k = n.getAttribute('data-nav'); if (k === 'people' || k === 'peoplecomp' || k === 'peoplework') n.classList.toggle('on', k === { list: 'people', compliance: 'peoplecomp', work: 'peoplework' }[S.tab]); }); }

  function page(args) {
    var a = args || [];
    if (/^P-\d+$/.test(a[0] || '')) return load().then(function () { profile(a[0]); });
    S.tab = a[0] === 'compliance' ? 'compliance' : a[0] === 'workload' ? 'work' : 'list';
    var users = canUsers() ? api('userList').then(function (u) { S.users = u.users; }).catch(function () { S.users = null; }) : Promise.resolve();
    return Promise.all([load(), users]).then(function () { draw(); });
  }
  function loginOf(id) { return (S.users || []).filter(function (u) { return u.personId === id; })[0]; }
  function draw() {
    navOn();
    var d = S.data, act = d.people.filter(function (p) { return !p.archived; });
    var probs = act.filter(function (p) { return p.status !== 'Inactive' && (p.comp.worst === 'expired' || p.comp.worst === 'due'); });
    var emp = act.filter(function (p) { return p.type === 'Employee'; }).length;
    V().innerHTML = '<div class="row" style="margin-bottom:12px"><div class="tabs" style="margin:0">' +
        '<button class="tab' + (S.tab === 'list' ? ' on' : '') + '" data-ptab="list">🧑‍🔧 People <b>' + act.length + '</b></button>' +
        '<button class="tab' + (S.tab === 'compliance' ? ' on' : '') + '" data-ptab="compliance">🎫 Tickets &amp; licences' + (probs.length ? ' <b class="bad">' + probs.length + '</b>' : '') + '</button>' +
        '<button class="tab' + (S.tab === 'work' ? ' on' : '') + '" data-ptab="work">📅 Workload</button></div>' +
        '<span class="muted" style="font-size:13px">' + emp + ' employee' + (emp === 1 ? '' : 's') + ' · ' + (act.length - emp) + ' contractor' + (act.length - emp === 1 ? '' : 's') + '</span>' +
        '<span class="sp"></span>' + (can('edit') ? '<button class="btn btn-gold" id="ppNew">＋ Person</button>' : '<span class="muted" style="font-size:12.5px">View only</span>') + '</div><div id="ppBody"></div>';
    V().querySelectorAll('[data-ptab]').forEach(function (b) { b.onclick = function () { S.tab = b.getAttribute('data-ptab'); history.replaceState(null, '', { list: '#people', compliance: '#people/compliance', work: '#people/workload' }[S.tab]); draw(); }; });
    var nb = $('#ppNew'); if (nb) nb.onclick = function () { edit(''); };
    if (S.tab === 'compliance') compTab(); else if (S.tab === 'work') workTab(); else listTab();
  }

  function listTab() {
    var d = S.data, all = d.people.filter(function (p) { return S.showArchived || !p.archived; }), q = S.q.toLowerCase();
    var L = all.filter(function (p) {
      if (S.type && p.type !== S.type) return false; if (S.role && p.role !== S.role) return false; if (S.status && p.status !== S.status) return false;
      return !q || [p.name, p.role, p.phone, p.email, p.suburb, p.business, tradeName(p.trade), p.id].join(' ').toLowerCase().indexOf(q) >= 0;
    });
    var roles = {}; all.forEach(function (p) { if (p.role) roles[p.role] = (roles[p.role] || 0) + 1; });
    $('#ppBody').innerHTML = '<div class="card"><div class="row" style="margin-bottom:10px;gap:8px">' +
        '<input id="ppQ" type="search" placeholder="Search name, role, phone, suburb…" value="' + esc(S.q) + '" style="max-width:280px">' +
        '<select id="ppType" style="width:auto"><option value="">Employees and contractors</option>' + d.types.map(function (t) { return '<option' + (S.type === t ? ' selected' : '') + '>' + t + '</option>'; }).join('') + '</select>' +
        '<select id="ppStatus" style="width:auto"><option value="">Any status</option>' + d.statuses.map(function (s) { return '<option' + (S.status === s ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select>' +
        '<label class="muted" style="display:flex;gap:6px;align-items:center;font-size:13px"><input type="checkbox" id="ppArch" style="width:auto"' + (S.showArchived ? ' checked' : '') + '>Show archived</label>' +
        '<span class="sp"></span><span class="muted" style="font-size:13px">' + L.length + ' shown</span></div>' +
        '<div class="sc-chips">' + Object.keys(roles).sort().map(function (r) { return '<button class="sc-tchip' + (S.role === r ? ' on' : '') + '" data-role="' + esc(r) + '">' + esc(r) + ' <b>' + roles[r] + '</b></button>'; }).join('') + '</div>' +
      (L.length ? '<div class="table-wrap"><table class="sc-table pp-table"><thead><tr><th>Person</th><th>Role</th><th>Phone</th><th class="hide-sm">Email</th><th class="num">Cost / charge-out</th><th>Tickets &amp; licences</th><th>Status</th>' + (S.users ? '<th>Login</th>' : '') + '</tr></thead><tbody>' +
        L.map(function (p) {
          var tel = String(p.phone || '').replace(/[^\d+]/g, ''), lg = loginOf(p.id);
          return '<tr data-ppid="' + esc(p.id) + '" class="click' + (p.archived ? ' tdone' : '') + '"><td><span class="pp-av pp-' + (p.type === 'Contractor' ? 'c' : 'e') + '">' + esc(ini(p.name)) + '</span><b>' + esc(p.name) + '</b><br><small class="muted">' + esc([p.type === 'Contractor' ? 'Contractor' + (p.business ? ' · ' + p.business : '') : p.employment, p.suburb].filter(Boolean).join(' · ')) + '</small></td>' +
            '<td>' + esc(p.role || '') + (p.trade ? '<br><small class="muted">' + esc(tradeName(p.trade)) + '</small>' : '') + '</td>' +
            '<td class="nowrap">' + (tel ? '<a href="tel:' + esc(tel) + '">' + esc(p.phone) + '</a>' : '') + '</td><td class="hide-sm">' + (p.email ? '<a href="mailto:' + esc(p.email) + '">' + esc(p.email) + '</a>' : '') + '</td>' +
            '<td class="num nowrap">' + (p.costRate ? money(p.costRate) + '<small class="muted">/hr</small>' : '') + (p.chargeRate ? '<br><small class="muted">charge ' + money(p.chargeRate) + '/hr</small>' : '') + '</td>' +
            '<td>' + cchip(p.comp.worst) + (p.comp.problems.length ? '<br><small class="muted">' + esc(p.comp.problems.join(' · ')) + '</small>' : '') + '</td><td>' + schip(p.status) + '</td>' +
            (S.users ? '<td>' + (lg ? '<span class="pp-login' + (lg.active ? '' : ' off') + '" title="' + esc(lg.username) + '">🔐 ' + esc(lg.role) + '</span>' : '<span class="muted">–</span>') + '</td>' : '') + '</tr>';
        }).join('') + '</tbody></table></div>'
        : '<div class="empty">' + (all.length ? 'Nobody matches.' : 'No people yet. Add your project managers, supervisors, tradespeople, apprentices and contractors with <b>＋ Person</b>.') + '</div>') + '</div>';
    var B = $('#ppBody');
    $('#ppQ').oninput = function () { S.q = this.value; var pos = this.selectionStart; listTab(); var i = $('#ppQ'); i.focus(); try { i.setSelectionRange(pos, pos); } catch (e) {} };
    $('#ppType').onchange = function () { S.type = this.value; listTab(); };
    $('#ppStatus').onchange = function () { S.status = this.value; listTab(); };
    $('#ppArch').onchange = function () { S.showArchived = this.checked; listTab(); };
    B.querySelectorAll('[data-role]').forEach(function (b) { b.onclick = function () { var k = b.getAttribute('data-role'); S.role = S.role === k ? '' : k; listTab(); }; });
    B.querySelectorAll('tr[data-ppid]').forEach(function (tr) { tr.onclick = function (e) { if (e.target.closest('a')) return; location.hash = '#people/' + tr.getAttribute('data-ppid'); }; });
  }

  function compTab() {
    var d = S.data, act = d.people.filter(function (p) { return !p.archived && p.status !== 'Inactive'; }), n = { ok: 0, due: 0, expired: 0, missing: 0 }, rows = [];
    act.forEach(function (p) { n[p.comp.worst]++; p.comp.items.forEach(function (x) { if (x[1] !== 'ok') rows.push({ p: p, doc: x[0], st: x[1], exp: expiryOf(p, x[0]) }); }); });
    var rank = { expired: 0, due: 1, missing: 2 };
    rows.sort(function (a, b) { return rank[a.st] - rank[b.st] || (a.exp || '9').localeCompare(b.exp || '9') || a.p.name.localeCompare(b.p.name); });
    var kpi = function (k, v, s, cls) { return '<div class="card kpi' + (cls ? ' ' + cls : '') + '"><div class="k">' + k + '</div><div class="v">' + v + '</div><div class="s">' + s + '</div></div>'; };
    $('#ppBody').innerHTML = '<div class="grid kpis ckpis">' + kpi('Active people', act.length, 'not inactive or archived') + kpi('All in order', n.ok, 'tickets, licences, insurance') +
        kpi('Expiring in 30 days', n.due, 'book the renewal', n.due ? 'kpi-warn' : '') + kpi('Expired', n.expired, 'not on site until renewed', n.expired ? 'kpi-bad' : '') + kpi('Missing', n.missing, 'get a copy on file') + '</div>' +
      '<div class="card" style="margin-top:14px"><h2>To follow up</h2><p class="muted" style="margin:-4px 0 10px;font-size:13px">Everyone who goes on site needs a white card; tradespeople a current licence for their trade; contractors public liability and workers comp (unless a sole trader). Any ticket with an expiry date is checked too: first aid, working at heights, confined spaces, EWP, forklift, driver\'s licence.</p>' +
      (rows.length ? '<div class="table-wrap"><table class="sc-table"><thead><tr><th>Person</th><th>Ticket / document</th><th>State</th><th>Expiry</th><th>Contact</th></tr></thead><tbody>' + rows.map(function (r) {
        var tel = String(r.p.phone || '').replace(/[^\d+]/g, ''), subj = encodeURIComponent(r.doc + ': renewal needed');
        return '<tr data-ppid="' + esc(r.p.id) + '" class="click"><td><b>' + esc(r.p.name) + '</b><br><small class="muted">' + esc(r.p.role || r.p.type) + '</small></td><td>' + esc(r.doc) + '</td>' +
          '<td><span class="scdoc scdoc-' + r.st + '">' + DOC[r.st] + '</span></td><td class="nowrap">' + (r.exp ? dmy(r.exp) : '–') + '</td>' +
          '<td class="nowrap">' + (tel ? '<a class="btn btn-sm" href="tel:' + esc(tel) + '" title="Call">📞</a> ' : '') + (r.p.email ? '<a class="btn btn-sm" href="mailto:' + esc(r.p.email) + '?subject=' + subj + '" title="Email">✉</a>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<div class="empty">Everyone\'s tickets and licences are in order. 👍</div>') + '</div>';
    $('#ppBody').querySelectorAll('tr[data-ppid]').forEach(function (tr) { tr.onclick = function (e) { if (e.target.closest('a')) return; location.hash = '#people/' + tr.getAttribute('data-ppid'); }; });
  }
  function expiryOf(p, docName) {
    var t = p.tickets || {}, k = { 'Trade licence': 'licence', 'First aid': 'firstAid', 'Working at heights': 'heights', 'Confined spaces': 'confined', 'EWP': 'ewp', 'Forklift': 'forklift', 'Asbestos awareness': 'asbestos', 'Driver\'s licence': 'driver' }[docName];
    if (k && t[k]) return t[k].expiry; if (docName === 'Public liability') return (p.insurance || {}).expiry; if (docName === 'Workers comp') return (p.workersComp || {}).expiry; return '';
  }

  function workTab() {
    $('#ppBody').innerHTML = '<div class="card"><div class="empty">Working out who is on what…</div></div>';
    api('pplAssign').then(function (r) {
      S.assign = r.assign; var act = S.data.people.filter(function (p) { return !p.archived && p.status !== 'Inactive'; });
      var max = Math.max(1, act.reduce(function (a, p) { var x = r.assign[p.id] || {}; return Math.max(a, (x.now || 0) + (x.next || 0)); }, 0));
      $('#ppBody').innerHTML = '<div class="card"><h2>Workload: who is on what</h2><p class="muted" style="margin:-4px 0 10px;font-size:13px">From the project plans: tasks where someone is a resource (★ lead), stories they own, projects they manage, and where they are a stakeholder. <b>Now</b> = tasks running today; <b>next 14 days</b> = starting soon; <b>late</b> = past their finish and not done.</p>' +
        '<div class="table-wrap"><table class="sc-table pp-work"><thead><tr><th>Person</th><th>Role</th><th class="num">Projects</th><th class="num">Now</th><th class="num">Next 14 days</th><th class="num">Late</th><th style="width:28%">Load</th><th class="num">Status</th></tr></thead><tbody>' +
        act.map(function (p) { var x = r.assign[p.id] || { now: 0, next: 0, late: 0, projects: 0 }, w = (x.now + x.next) / max * 100;
          return '<tr data-ppid="' + esc(p.id) + '" class="click"><td><b>' + esc(p.name) + '</b><br><small class="muted">' + esc(p.type) + '</small></td><td>' + esc(p.role || '') + '</td><td class="num">' + x.projects + '</td><td class="num"><b>' + x.now + '</b></td><td class="num">' + x.next + '</td>' +
            '<td class="num' + (x.late ? ' bad' : '') + '">' + (x.late || '–') + '</td><td><div class="pp-load"><i style="width:' + w + '%" class="' + (x.now + x.next > 6 ? 'hi' : x.now + x.next > 3 ? 'mid' : '') + '"></i></div></td><td class="num">' + schip(p.status) + '</td></tr>'; }).join('') +
        '</tbody></table></div></div>';
      $('#ppBody').querySelectorAll('tr[data-ppid]').forEach(function (tr) { tr.onclick = function () { location.hash = '#people/' + tr.getAttribute('data-ppid'); }; });
    }).catch(fail);
  }

  function profile(id) {
    navOn();
    V().innerHTML = '<div class="empty">Loading…</div>';
    Promise.all([api('pplGet', { id: id }), canUsers() ? api('userList').then(function (u) { S.users = u.users; }).catch(function () {}) : null]).then(function (res) {
      var r = res[0], p = r.person, a = r.assign || { list: [] }, c = r.comp, lg = loginOf(p.id), tk = p.tickets || {}, tel = String(p.phone || '').replace(/[^\d+]/g, '');
      var T = S.data.tickets, row = function (k, v) { return v ? '<tr><td class="muted">' + k + '</td><td>' + v + '</td></tr>' : ''; };
      var proj = {}; a.list.forEach(function (x) { (proj[x.core] = proj[x.core] || { plan: x.plan, rows: [] }).rows.push(x); });
      V().innerHTML = '<div class="row" style="margin-bottom:12px"><a class="btn btn-sm" href="#people">← People</a><span class="sp"></span>' +
          (can('edit') ? '<button class="btn btn-gold" id="ppEdit">✎ Edit</button>' : '') + '</div>' +
        '<div class="grid two"><div class="grid" style="align-content:start">' +
          '<div class="card pp-head"><span class="pp-av big pp-' + (p.type === 'Contractor' ? 'c' : 'e') + '">' + esc(ini(p.name)) + '</span><div><h2 style="margin:0">' + esc(p.name) + ' <small class="muted">' + esc(p.id) + '</small></h2>' +
            '<div class="muted">' + esc([p.role, p.type === 'Contractor' ? 'Contractor' + (p.business ? ', ' + p.business : '') : p.employment + ' employee', tradeName(p.trade)].filter(Boolean).join(' · ')) + '</div>' +
            '<div style="margin-top:6px">' + schip(p.status) + ' ' + cchip(c.worst) + ' ' + stars(p.rating) + '</div></div></div>' +
          '<div class="card"><h2>Contact &amp; work</h2><table class="pp-kv"><tbody>' + row('Phone', tel ? '<a href="tel:' + esc(tel) + '">' + esc(p.phone) + '</a>' : '') + row('Email', p.email ? '<a href="mailto:' + esc(p.email) + '">' + esc(p.email) + '</a>' : '') +
            row('Address', esc([p.address, p.suburb].filter(Boolean).join(', '))) + row('Started', esc(dmy(p.start))) + row('Hours a week', p.hours ? String(p.hours) : '') + row('Availability', esc(p.availability)) +
            row('Cost rate', p.costRate ? money(p.costRate) + ' /hr <small class="muted">(what an hour costs MBS)</small>' : '') + row('Charge-out rate', p.chargeRate ? money(p.chargeRate) + ' /hr' : '') + row('Skills', esc(p.skills)) +
            (p.type === 'Contractor' ? row('ABN', esc(p.abn)) + row('GST', p.gst ? 'Registered' : '') : '') +
            row('Emergency contact', esc([(p.emergency || {}).name, (p.emergency || {}).phone].filter(Boolean).join(' · '))) + '</tbody></table>' + (p.notes ? '<p style="white-space:pre-wrap;margin:10px 0 0">' + esc(p.notes) + '</p>' : '') + '</div>' +
          '<div class="card"><h2>Tickets, licences' + (p.type === 'Contractor' ? ' &amp; insurance' : '') + '</h2><table class="pp-kv"><tbody>' +
            T.map(function (t) { var x = tk[t.key]; return x ? '<tr><td class="muted">' + esc(t.name) + '</td><td>' + esc([x.number, x.class].filter(Boolean).join(' · ') || (x.has ? 'Yes' : '')) + (x.expiry ? ' <small class="muted">expires ' + esc(dmy(x.expiry)) + '</small>' : '') + '</td></tr>' : ''; }).join('') +
            (p.type === 'Contractor' ? row('Public liability', esc([(p.insurance || {}).insurer, (p.insurance || {}).policy].filter(Boolean).join(' · ')) + ((p.insurance || {}).expiry ? ' <small class="muted">expires ' + dmy(p.insurance.expiry) + '</small>' : '')) +
              row('Workers comp', (p.workersComp || {}).soleTrader ? 'Sole trader (own cover)' : esc((p.workersComp || {}).policy || '') + ((p.workersComp || {}).expiry ? ' <small class="muted">expires ' + dmy(p.workersComp.expiry) + '</small>' : '')) : '') + '</tbody></table>' +
            (c.problems.length ? '<p class="sk-warn" style="margin:8px 0 0">⚠ ' + esc(c.problems.join(' · ')) + '</p>' : '<p class="good" style="margin:8px 0 0">✓ All in order</p>') + '</div>' +
          (canUsers() ? '<div class="card"><h2>🔐 Login</h2>' + (lg ? '<p style="margin:0"><b>' + esc(lg.username) + '</b> · ' + esc(lg.role) + (lg.active ? '' : ' · <span class="bad">disabled</span>') + '</p>' : '<p class="muted" style="margin:0">No login. ' + (p.email ? '' : 'Add an email first, then ') + 'give them one in Users &amp; access.</p>') +
            '<p style="margin:8px 0 0"><a class="btn btn-sm" href="#users' + (lg ? '/' + esc(lg.id) : '/new/' + esc(p.id)) + '">' + (lg ? 'Manage the login' : '＋ Give ' + esc(p.name.split(' ')[0]) + ' a login') + '</a></p></div>' : '') +
        '</div><div class="grid" style="align-content:start"><div class="card"><h2>📅 On the projects</h2>' +
          (Object.keys(proj).length ? '<p class="muted" style="margin:-4px 0 8px;font-size:13px">' + Object.keys(proj).length + ' project' + (Object.keys(proj).length === 1 ? '' : 's') + ' · ' + a.now + ' task' + (a.now === 1 ? '' : 's') + ' now · ' + a.next + ' in the next 14 days' + (a.late ? ' · <b class="bad">' + a.late + ' late</b>' : '') + '</p>' +
            Object.keys(proj).map(function (core) { var g = proj[core]; return '<div class="pp-proj"><a href="#plan/' + esc(core) + '/schedule"><b>' + esc(g.plan) + '</b></a><table class="pp-asg"><tbody>' +
              g.rows.map(function (x) { var late = x.es && !x.done && x.ef < (S.data.today || ''); return '<tr><td><span class="pp-kind">' + esc(x.kind) + '</span></td><td>' + esc(x.what || '') + '</td><td class="nowrap muted">' + (x.es ? esc(dmy(x.es)) + (x.ef && x.ef !== x.es ? ' – ' + esc(dmy(x.ef)) : '') : '') + '</td><td class="num">' + (x.es ? (x.done ? '✓' : late ? '<b class="bad">late</b>' : (x.pct || 0) + '%') : '') + '</td></tr>'; }).join('') + '</tbody></table></div>'; }).join('')
            : '<div class="empty">Not on any project plan yet. Put their name in a task\'s Resources, as a story owner or a stakeholder, or as the project manager.</div>') + '</div></div></div>';
      var e = $('#ppEdit'); if (e) e.onclick = function () { edit(p.id, p); };
    }).catch(fail);
  }

  function edit(id, given) {
    var go = function (p) {
      p = p || { type: 'Employee', employment: 'Full-time', status: 'Active', tickets: {}, rating: 0 };
      var d = S.data, tk = p.tickets || {}, I = p.insurance || {}, W = p.workersComp || {}, E = p.emergency || {};
      var f = function (k, label, v, ph, type, extra) { return '<label' + (extra || '') + '>' + label + '<input data-k="' + k + '" value="' + esc(v == null ? '' : v) + '" placeholder="' + esc(ph || '') + '"' + (type ? ' type="' + type + '"' : '') + '></label>'; };
      var sel = function (k, label, v, opts, extra) { return '<label' + (extra || '') + '>' + label + '<select data-k="' + k + '">' + opts.map(function (o) { var val = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o; return '<option value="' + esc(val) + '"' + (v === val ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('') + '</select></label>'; };
      var cb = function (k, label, v) { return '<label class="sc-cb"><input type="checkbox" data-k="' + k + '"' + (v ? ' checked' : '') + '> ' + label + '</label>'; };
      M.modal('<h2>' + (id ? esc(p.name) + ' <small class="muted">' + esc(id) + '</small>' : 'New person') + '</h2>' +
        '<div class="form sc-form" style="margin-top:12px">' +
        '<div class="full pp-type">' + d.types.map(function (t) { return '<label class="pp-tbtn"><input type="radio" name="ppType" value="' + t + '"' + (p.type === t ? ' checked' : '') + '><span><b>' + (t === 'Employee' ? '🧑‍🔧 Employee' : '🧾 Contractor') + '</b><small>' + (t === 'Employee' ? 'On the MBS payroll' : 'An individual on an ABN, working as part of the MBS team') + '</small></span></label>'; }).join('') + '</div>' +
        '<h3 class="full">Person</h3>' + f('name', 'Full name', p.name, 'e.g. Priya Shah') +
        '<label>Role<input data-k="role" list="ppRoles" value="' + esc(p.role || '') + '" placeholder="e.g. Project manager"></label><datalist id="ppRoles">' + d.roles.map(function (r) { return '<option value="' + esc(r) + '">'; }).join('') + '</datalist>' +
        sel('trade', 'Trade (if a tradesperson)', p.trade || '', [['', '–']].concat(d.trades.map(function (t) { return [t.key, t.name]; }))) +
        '<div class="full pp-emp" data-show="Employee">' + sel('employment', 'Employment', p.employment || 'Full-time', d.employment) + '</div>' +
        '<div class="full pp-con form" data-show="Contractor" style="padding:0">' + f('business', 'Trading name', p.business, 'if any') + f('abn', 'ABN', p.abn, '11 digits') + '<label>GST<span class="sc-inline">' + cb('gst', 'Registered for GST', p.gst) + '</span></label></div>' +
        f('phone', 'Mobile', p.phone, '04xx xxx xxx', 'tel') + f('email', 'Email (also their login)', p.email, 'name@example.com', 'email') + f('address', 'Address', p.address, '', '', ' class="full"') + f('suburb', 'Suburb', p.suburb, '') +
        f('start', 'Started', p.start, '', 'date') + f('hours', 'Hours a week', p.hours || '', 'e.g. 38') + f('availability', 'Availability', p.availability, 'e.g. Mon–Fri, no Saturdays') +
        f('skills', 'Skills', p.skills, 'e.g. tiling, waterproofing, MS Project', '', ' class="full"') +
        '<h3 class="full">Rates</h3>' + f('costRate', 'Cost rate ($/hr)', p.costRate || '', 'what an hour costs MBS') + f('chargeRate', 'Charge-out rate ($/hr)', p.chargeRate || '', 'what customers are charged') +
        '<h3 class="full">Tickets &amp; licences</h3>' +
          d.tickets.map(function (t) { var x = tk[t.key] || {}; return '<div class="full pp-tk"><b>' + esc(t.name) + '</b>' + f('tk.' + t.key + '.number', 'Number', x.number, '') + (t.key === 'licence' || t.key === 'driver' ? f('tk.' + t.key + '.class', 'Class', x.class, '') : '') + (t.key === 'whiteCard' ? '' : f('tk.' + t.key + '.expiry', 'Expiry', x.expiry, '', 'date')) + '</div>'; }).join('') +
        '<div class="full form" data-show="Contractor" style="padding:0"><h3 class="full">Insurance (contractors)</h3>' + f('ins.insurer', 'Public liability insurer', I.insurer, '') + f('ins.policy', 'Policy number', I.policy, '') + f('ins.expiry', 'Public liability expiry', I.expiry, '', 'date') +
          f('wc.policy', 'Workers comp policy', W.policy, '') + f('wc.expiry', 'Workers comp expiry', W.expiry, '', 'date') + '<label>Sole trader<span class="sc-inline">' + cb('wc.soleTrader', 'No employees (own cover)', W.soleTrader) + '</span></label></div>' +
        '<h3 class="full">Other</h3>' + f('em.name', 'Emergency contact', E.name, 'name and relationship') + f('em.phone', 'Emergency phone', E.phone, '', 'tel') +
        sel('status', 'Status', p.status || 'Active', d.statuses) + '<label>Rating<select data-k="rating">' + [0, 1, 2, 3, 4, 5].map(function (x) { return '<option value="' + x + '"' + (+p.rating === x ? ' selected' : '') + '>' + (x ? '★★★★★'.slice(0, x) : 'Not rated') + '</option>'; }).join('') + '</select></label>' +
        '<label class="full">Notes<textarea data-k="notes" rows="3" placeholder="Strengths, what they\'re working towards…">' + esc(p.notes || '') + '</textarea></label>' +
        '<p class="full muted" style="font-size:12px;margin:0">Payroll details (tax file number, bank, super, date of birth) are not kept here: they stay in your payroll system.</p></div>' +
        '<div class="actions" style="justify-content:space-between;margin-top:14px">' + (id ? '<button class="btn" id="ppArchB" type="button">' + (p.archived ? 'Restore' : 'Archive') + '</button>' : '<span></span>') +
        '<span><button class="btn" data-close type="button">Cancel</button> <button class="btn btn-gold" id="ppSave" type="button">Save</button></span></div>');
      $('#modal .modal-card').classList.add('sc-wide');
      var show = function () { var t = (document.querySelector('#modal [name=ppType]:checked') || {}).value || 'Employee'; document.querySelectorAll('#modal [data-show]').forEach(function (el) { el.hidden = el.getAttribute('data-show') !== t; }); };
      document.querySelectorAll('#modal [name=ppType]').forEach(function (r) { r.onchange = show; }); show();
      var collect = function () {
        var o = { id: id || '', type: (document.querySelector('#modal [name=ppType]:checked') || {}).value || 'Employee', tickets: {}, insurance: {}, workersComp: {}, emergency: {} }, map = { ins: 'insurance', wc: 'workersComp', em: 'emergency' };
        document.querySelectorAll('#modal [data-k]').forEach(function (el) {
          var k = el.getAttribute('data-k'), v = el.type === 'checkbox' ? el.checked : el.value, q = k.split('.');
          if (q[0] === 'tk') { (o.tickets[q[1]] = o.tickets[q[1]] || {})[q[2]] = v; } else if (q.length === 2) o[map[q[0]]][q[1]] = v; else o[k] = v;
        });
        return o;
      };
      var save = function (o, msg) { return api('pplSave', { person: o }).then(function (r) { M.closeModal(); toast(msg); return load().then(function () { if (location.hash.indexOf('#people/P-') === 0 || !id) location.hash = '#people/' + r.person.id; else draw(); if (location.hash === '#people/' + r.person.id) profile(r.person.id); }); }).catch(fail); };
      $('#ppSave').onclick = function () { save(Object.assign({}, p, collect()), 'Saved'); };
      var ar = $('#ppArchB'); if (ar) ar.onclick = function () { var o = Object.assign({}, p, collect()); o.archived = !p.archived; save(o, o.archived ? 'Archived' : 'Restored'); };
    };
    if (given) go(given); else if (id) api('pplGet', { id: id }).then(function (r) { go(r.person); }).catch(fail); else go(null);
  }

  new MutationObserver(function () { if ($('#modal').hidden) $('#modal .modal-card').classList.remove('sc-wide'); }).observe($('#modal'), { attributes: true, attributeFilter: ['hidden'] });
  // for the plans: names, roles and rates of the active people (resources, stakeholders, project manager, story owners)
  M.people = { load: load, list: function () { return S.data ? S.data.people.filter(function (p) { return !p.archived && p.status !== 'Inactive'; }) : []; } };
  M.addView('people', 'People', page, 'people');
  var tick = function () { if (!document.getElementById('app').hidden && M.allowed && M.allowed('people', 'view', ['projects', 'subbies', 'crm'])) load().catch(function () {}); };
  new MutationObserver(function () { if (!document.getElementById('app').hidden) setTimeout(tick, 400); }).observe(document.getElementById('app'), { attributes: true, attributeFilter: ['hidden'] });
  setTimeout(tick, 2000);
})();
