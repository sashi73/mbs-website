/* MBS Console v86: People: employees and contractors (MBS's own team). Like Subbies: details, role and trade, rates, tickets and
   licences with expiry checks, insurance for contractors, status and rating. Linked to the project plans: each person's
   assignments and workload come from the plans (resources, story owners, stakeholders, project manager). Only people in this
   register can be given a login (Users & access). */
(function () {
  'use strict';
  var M = window.MBS; if (!M) return;
  var api = M.api, esc = M.esc, toast = M.toast, fail = M.fail, $ = M.$;
  var V = function () { return M.view(); };
  var S = { tab: 'list', q: '', group: '', calFrom: '', type: '', role: '', status: '', showArchived: false, data: null, assign: null, users: null, sel: {} };
  var money = function (n) { return n ? '$' + (Math.round(n * 100) / 100).toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : ''; };
  var dmy = function (d) { return d ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) : ''; };
  var CW = { ok: ['✓ Up to date', 'ok'], due: ['Due soon', 'due'], expired: ['Expired', 'bad'], missing: ['Missing', 'miss'] };
  var DOC = { ok: 'OK', due: 'due soon', expired: 'EXPIRED', missing: 'missing' };
  var STC = { Active: 'ok', 'On leave': 'hold', Inactive: 'bad' };
  // GKH Project Champ: only the project manager (super user) adds or changes people; others look (and keep their own My profile)
  var can = function (lv) { var me = M.me || {}; if (lv === 'edit') return !!me.owner; return me.owner || ['view', 'edit'].indexOf((me.mods || {}).people) >= 0; };
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
  function navOn() { document.querySelectorAll('[data-nav]').forEach(function (n) { var k = n.getAttribute('data-nav'); if (k === 'people' || k === 'peoplecomp' || k === 'peoplework' || k === 'peoplecal') n.classList.toggle('on', k === { list: 'people', compliance: 'people', work: 'peoplework', cal: 'peoplecal' }[S.tab]); }); }

  function page(args) {
    var a = args || [];
    if (/^P-\d+$/.test(a[0] || '')) return load().then(function () { profile(a[0]); });
    S.tab = a[0] === 'compliance' ? 'compliance' : a[0] === 'workload' ? 'work' : a[0] === 'calendar' ? 'cal' : 'list';
    var users = canUsers() ? api('userList').then(function (u) { S.users = u.users; }).catch(function () { S.users = null; }) : Promise.resolve();
    return Promise.all([load(), users]).then(function () { draw(); });
  }
  function loginOf(id) { return (S.users || []).filter(function (u) { return u.personId === id; })[0]; }
  function draw() {
    navOn();
    var d = S.data, act = d.people.filter(function (p) { return !p.archived; });
    var probs = act.filter(function (p) { return p.status !== 'Inactive' && (p.comp.worst === 'expired' || p.comp.worst === 'due'); });
    var tech = act.filter(function (p) { return (p.group || 'Construction') !== 'Construction'; }).length;
    V().innerHTML = '<div class="row" style="margin-bottom:12px"><div class="tabs" style="margin:0">' +
        '<button class="tab' + (S.tab === 'list' ? ' on' : '') + '" data-ptab="list">🧑‍🔧 People <b>' + act.length + '</b></button>' +
        '<button class="tab' + (S.tab === 'compliance' ? ' on' : '') + '" data-ptab="compliance">🎓 Credentials &amp; compliance' + (probs.length ? ' <b class="bad">' + probs.length + '</b>' : '') + '</button>' +
        '<button class="tab' + (S.tab === 'cal' ? ' on' : '') + '" data-ptab="cal">📅 Calendar</button>' +
        '<button class="tab' + (S.tab === 'work' ? ' on' : '') + '" data-ptab="work">📊 Workload</button></div>' +
        '<span class="muted" style="font-size:13px">💻 ' + tech + ' technical &amp; general · 🏗 ' + (act.length - tech) + ' construction</span>' +
        '<span class="sp"></span>' + ((M.me || {}).test && can('edit') ? '<button class="btn btn-sm" id="ppSample" title="Test site only: 10 made-up employees and contractors to try things out with">🧪 Load 10 sample people</button>' : '') +
        '<button class="btn btn-sm" id="ppExp" type="button" title="Download People as CSV or Excel">⬇ Export</button>' + (can('edit') ? '<button class="btn btn-sm" id="ppImp" type="button" title="Update or add people from a CSV or Excel file">⬆ Import</button>' : '') +
        (can('edit') ? '<button class="btn btn-gold" id="ppNew">＋ Person</button>' : '<span class="muted" style="font-size:12.5px">View only</span>') + '</div><div id="ppBody"></div>';
    V().querySelectorAll('[data-ptab]').forEach(function (b) { b.onclick = function () { S.tab = b.getAttribute('data-ptab'); history.replaceState(null, '', { list: '#people', compliance: '#people/compliance', work: '#people/workload', cal: '#people/calendar' }[S.tab]); draw(); }; });
    var nb = $('#ppNew'); if (nb) nb.onclick = function () { edit(''); };
    $('#ppExp').onclick = function () { exportDialog(null); }; var ib = $('#ppImp'); if (ib) ib.onclick = importDialog;   // v90
    var sb = $('#ppSample'); if (sb) sb.onclick = function () {   // v88: test site only
      sb.disabled = true; api('pplSampleLoad').then(function (r) { toast(r.ids.length ? r.ids.length + ' sample people added' + (r.skipped ? ' (' + r.skipped + ' were already there)' : '') + '. Give them Guest logins in Users & access.' : 'The sample people are already there'); return load(); }).then(draw).catch(function (e) { sb.disabled = false; fail(e); });
    };
    if (S.tab === 'compliance') compTab(); else if (S.tab === 'work') workTab(); else if (S.tab === 'cal') calTab(); else listTab();
  }

  function listTab() {
    var d = S.data, all = d.people.filter(function (p) { return S.showArchived || !p.archived; }), q = S.q.toLowerCase();
    var L = all.filter(function (p) {
      if (S.group && (p.group || 'Construction') !== S.group) return false; if (S.type && p.type !== S.type) return false; if (S.role && p.role !== S.role) return false; if (S.status && p.status !== S.status) return false;
      return !q || [p.name, p.role, p.phone, p.email, p.suburb, p.business, tradeName(p.trade), p.id].join(' ').toLowerCase().indexOf(q) >= 0;
    });
    var roles = {}; all.forEach(function (p) { if (p.role) roles[p.role] = (roles[p.role] || 0) + 1; });
    Object.keys(S.sel).forEach(function (k) { if (!all.some(function (p) { return p.id === k; })) delete S.sel[k]; }); var nSel = Object.keys(S.sel).length;
    $('#ppBody').innerHTML = '<div class="card"><div class="pp-groups">' + [['', '👥 Everyone'], ['Technical & general', '💻 Technical & general'], ['Construction', '🏗 Construction']].map(function (g) { var n = all.filter(function (p) { return !g[0] || (p.group || 'Construction') === g[0]; }).length; return '<button class="pp-gbtn' + (S.group === g[0] ? ' on' : '') + '" data-grp="' + esc(g[0]) + '" type="button">' + g[1] + ' <b>' + n + '</b></button>'; }).join('') + '</div><div class="row" style="margin-bottom:10px;gap:8px">' +
        '<input id="ppQ" type="search" placeholder="Search name, role, phone, suburb…" value="' + esc(S.q) + '" style="max-width:280px">' +
        '<select id="ppType" style="width:auto"><option value="">Employees and contractors</option>' + d.types.map(function (t) { return '<option' + (S.type === t ? ' selected' : '') + '>' + t + '</option>'; }).join('') + '</select>' +
        '<select id="ppStatus" style="width:auto"><option value="">Any status</option>' + d.statuses.map(function (s) { return '<option' + (S.status === s ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select>' +
        '<label class="muted" style="display:flex;gap:6px;align-items:center;font-size:13px"><input type="checkbox" id="ppArch" style="width:auto"' + (S.showArchived ? ' checked' : '') + '>Show archived</label>' +
        '<span class="sp"></span><span class="muted" style="font-size:13px">' + L.length + ' shown</span></div>' +
        '<div class="sc-chips">' + Object.keys(roles).sort().map(function (r) { return '<button class="sc-tchip' + (S.role === r ? ' on' : '') + '" data-role="' + esc(r) + '">' + esc(r) + ' <b>' + roles[r] + '</b></button>'; }).join('') + '</div>' +
      (can('edit') && L.length ? '<div class="pp-bulk' + (nSel ? ' on' : '') + '" id="ppBulk"><b>' + nSel + ' selected</b>' + BULK.map(function (b) { return '<button class="btn btn-sm" data-bulk="' + b[0] + '" type="button"' + (nSel ? '' : ' disabled') + '>' + b[1] + '</button>'; }).join('') +
        '<button class="btn btn-sm" data-bulk="export" type="button"' + (nSel ? '' : ' disabled') + '>⬇ Export</button><button class="btn btn-sm" data-bulk="none" type="button"' + (nSel ? '' : ' disabled') + '>Clear</button></div>' : '') +
      (L.length ? '<div class="table-wrap"><table class="sc-table pp-table"><thead><tr>' + (can('edit') ? '<th class="pp-sel"><input type="checkbox" id="ppAll" title="Select all shown"' + (L.length && L.every(function (p) { return S.sel[p.id]; }) ? ' checked' : '') + '></th>' : '') + '<th>Person</th><th>Role</th><th>Phone</th><th class="hide-sm">Email</th><th class="num">Rate /hr</th><th>Credentials &amp; compliance</th><th>Status</th>' + (S.users ? '<th>Login</th>' : '') + '</tr></thead><tbody>' +
        L.map(function (p) {
          var tel = String(p.phone || '').replace(/[^\d+]/g, ''), lg = loginOf(p.id);
          return '<tr data-ppid="' + esc(p.id) + '" class="click' + (p.archived ? ' tdone' : '') + (S.sel[p.id] ? ' pp-on' : '') + '">' + (can('edit') ? '<td class="pp-sel"><input type="checkbox" data-sel="' + esc(p.id) + '"' + (S.sel[p.id] ? ' checked' : '') + ' aria-label="Select"></td>' : '') + '<td><span class="pp-av pp-' + (p.type === 'Contractor' ? 'c' : 'e') + '">' + esc(ini(p.name)) + '</span><b>' + esc(p.name) + '</b> <span title="' + esc(p.group || 'Construction') + '">' + (GI[p.group || 'Construction'] || ['🏗'])[0] + '</span>' + (p.cv ? ' <span title="Resume on file">📄</span>' : '') + (p.certN ? ' <span class="pp-certn" title="Certifications">🎓' + p.certN + '</span>' : '') + '<br><small class="muted">' + esc([p.type === 'Contractor' ? 'Contractor' + (p.business ? ' · ' + p.business : '') : (p.group || 'Construction') === 'Construction' ? p.employment : '', p.suburb].filter(Boolean).join(' · ')) + '</small></td>' +
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
    B.querySelectorAll('[data-grp]').forEach(function (b) { b.onclick = function () { S.group = b.getAttribute('data-grp'); S.role = ''; listTab(); }; });
    $('#ppStatus').onchange = function () { S.status = this.value; listTab(); };
    $('#ppArch').onchange = function () { S.showArchived = this.checked; listTab(); };
    B.querySelectorAll('[data-role]').forEach(function (b) { b.onclick = function () { var k = b.getAttribute('data-role'); S.role = S.role === k ? '' : k; listTab(); }; });
    B.querySelectorAll('tr[data-ppid]').forEach(function (tr) { tr.onclick = function (e) { if (e.target.closest('a') || e.target.closest('.pp-sel')) return; location.hash = '#people/' + tr.getAttribute('data-ppid'); }; });
    B.querySelectorAll('[data-sel]').forEach(function (x) { x.onchange = function () { var k = x.getAttribute('data-sel'); if (x.checked) S.sel[k] = 1; else delete S.sel[k]; listTab(); }; });   // v90: bulk changes
    var all2 = $('#ppAll'); if (all2) all2.onchange = function () { var on = this.checked; L.forEach(function (p) { if (on) S.sel[p.id] = 1; else delete S.sel[p.id]; }); listTab(); };
    B.querySelectorAll('[data-bulk]').forEach(function (b) { b.onclick = function () { var op = b.getAttribute('data-bulk'); if (op === 'none') { S.sel = {}; return listTab(); } if (op === 'export') return exportDialog(Object.keys(S.sel)); bulkDialog(op); }; });
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
          '<td class="nowrap">' + (tel ? '<a class="btn btn-sm" href="tel:' + esc(tel) + '" title="Call">📞</a> ' : '') + (r.p.email ? '<a class="btn btn-sm" href="mailto:' + esc(r.p.email) + '?subject=' + subj + '" title="Email">✉</a>' : '') +
            (can('edit') ? ' <button class="btn btn-sm btn-gold" data-renew="' + esc(r.doc) + '" type="button" title="Record the renewed ticket, licence or policy">↻ Update</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<div class="empty">Everyone\'s tickets and licences are in order. 👍</div>') + '</div>';
    $('#ppBody').querySelectorAll('tr[data-ppid]').forEach(function (tr) { tr.onclick = function (e) { if (e.target.closest('a') || e.target.closest('[data-renew]')) return; location.hash = '#people/' + tr.getAttribute('data-ppid'); }; });
    $('#ppBody').querySelectorAll('[data-renew]').forEach(function (b) { b.onclick = function () { renewDialog(b.closest('tr').getAttribute('data-ppid'), b.getAttribute('data-renew')); }; });   // v90
  }
  function expiryOf(p, docName) {
    var t = p.tickets || {}, k = { 'Trade licence': 'licence', 'First aid': 'firstAid', 'Working at heights': 'heights', 'Confined spaces': 'confined', 'EWP': 'ewp', 'Forklift': 'forklift', 'Asbestos awareness': 'asbestos', 'Driver\'s licence': 'driver' }[docName];
    if (k && t[k]) return t[k].expiry; if (docName === 'Public liability' || docName === 'Insurance') return (p.insurance || {}).expiry;
    var cx = (p.certs || []).concat((p.permits || []).map(function (x) { return Object.assign({}, x, { name: 'Permit: ' + x.name }); })).filter(function (x) { return x.name === docName; })[0]; if (cx) return cx.expiry; if (docName === 'Workers comp') return (p.workersComp || {}).expiry; return '';
  }

  // ---------- 📅 team calendar: who is on what, day by day (from the project plans), 4 weeks at a time ----------
  function calTab() {
    var ymd = function (d) { return d.toISOString().slice(0, 10); }, add = function (s, n) { var d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
    if (!S.calFrom) { var t = new Date((S.data.today || ymd(new Date())) + 'T00:00:00Z'), wd = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - wd); S.calFrom = ymd(t); }
    $('#ppBody').innerHTML = '<div class="card"><div class="empty">Reading the project plans…</div></div>';
    api('pplAssign').then(function (r) {
      S.assign = r.assign; var days = []; for (var i = 0; i < 28; i++) days.push(add(S.calFrom, i));
      var today = S.data.today || '', act = S.data.people.filter(function (p) { return !p.archived && p.status !== 'Inactive' && (!S.group || (p.group || 'Construction') === S.group); });
      var mon = function (d) { return new Date(d + 'T00:00:00Z').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' }); };
      var head = days.map(function (d) { var dt = new Date(d + 'T00:00:00Z'), w = dt.getUTCDay(); return '<th class="pc-d' + (w === 0 || w === 6 ? ' we' : '') + (d === today ? ' td' : '') + '" title="' + esc(mon(d)) + '"><small>' + 'SMTWTFS'[w] + '</small><b>' + dt.getUTCDate() + '</b></th>'; }).join('');
      var rows = act.map(function (p) {
        var L = ((r.assign[p.id] || {}).list || []).filter(function (x) { return x.es && x.ef && !x.done; }), busy = 0;
        var cells = days.map(function (d) { var on = L.filter(function (x) { return x.es <= d && x.ef >= d; }), w = new Date(d + 'T00:00:00Z').getUTCDay(), late = on.some(function (x) { return x.ef < today; });
          if (on.length) busy++;
          return '<td class="pc-c' + (w === 0 || w === 6 ? ' we' : '') + (d === today ? ' td' : '') + '">' + (on.length ? '<span class="pc-b pc-n' + Math.min(on.length, 3) + (late ? ' late' : '') + '" title="' + esc(mon(d) + ': ' + on.map(function (x) { return x.plan + ' · ' + (x.what || x.kind); }).join('\n')) + '">' + (on.length > 1 ? on.length : '') + '</span>' : '') + '</td>'; }).join('');
        return '<tr data-ppid="' + esc(p.id) + '" class="click"><td class="pc-p"><b>' + esc(p.name) + '</b> ' + (GI[p.group || 'Construction'] || ['🏗'])[0] + '<br><small class="muted">' + esc(p.role || '') + ' · ' + busy + ' busy day' + (busy === 1 ? '' : 's') + '</small></td>' + cells + '</tr>';
      }).join('');
      $('#ppBody').innerHTML = '<div class="card"><div class="row" style="margin-bottom:10px;gap:8px"><h2 style="margin:0">📅 Team calendar</h2><span class="muted" style="font-size:13px">' + esc(mon(days[0])) + ' – ' + esc(mon(days[27])) + '</span><span class="sp"></span>' +
          '<div class="pp-groups" style="margin:0">' + [['', 'Everyone'], ['Technical & general', '💻'], ['Construction', '🏗']].map(function (g) { return '<button class="pp-gbtn' + (S.group === g[0] ? ' on' : '') + '" data-grp="' + esc(g[0]) + '" type="button" title="' + esc(g[0] || 'Everyone') + '">' + g[1] + '</button>'; }).join('') + '</div>' +
          '<button class="btn btn-sm" data-cal="-7" type="button">◀ Week</button><button class="btn btn-sm" data-cal="0" type="button">Today</button><button class="btn btn-sm" data-cal="7" type="button">Week ▶</button></div>' +
        '<p class="muted" style="margin:-2px 0 10px;font-size:12.5px">From the project plans: every task, story or step a person is on (resource, lead or owner), day by day. A darker square = more at once; red = running late. Hover a square for what it is.</p>' +
        (act.length ? '<div class="table-wrap pc-wrap"><table class="pc-t"><thead><tr><th class="pc-p">Person</th>' + head + '</tr></thead><tbody>' + rows + '</tbody></table></div>' : '<div class="empty">No people yet.</div>') + '</div>';
      var B = $('#ppBody');
      B.querySelectorAll('[data-cal]').forEach(function (b) { b.onclick = function () { var n = +b.getAttribute('data-cal'); if (!n) S.calFrom = ''; else S.calFrom = add(S.calFrom, n); calTab(); }; });
      B.querySelectorAll('[data-grp]').forEach(function (b) { b.onclick = function () { S.group = b.getAttribute('data-grp'); calTab(); }; });
      B.querySelectorAll('tr[data-ppid]').forEach(function (tr) { tr.onclick = function () { location.hash = '#people/' + tr.getAttribute('data-ppid'); }; });
    }).catch(fail);
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
          (can('edit') ? (p.archived ? '<button class="btn btn-sm btn-danger" id="ppDel" type="button">🗑 Delete permanently</button><button class="btn" id="ppArc" type="button">↩ Restore</button>'
            : '<label class="pp-qs" title="Change the status">Status <select id="ppSt">' + S.data.statuses.map(function (x) { return '<option' + (x === p.status ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select></label><button class="btn" id="ppArc" type="button">🗄 Archive</button>') + '<button class="btn btn-gold" id="ppEdit">✎ Edit</button>' : '') + '</div>' +
        (p.archived ? '<div class="pp-archived">🗄 <b>Archived</b>' + (p.archivedAt ? ' on ' + esc(new Date(p.archivedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })) : '') + (p.archivedWhy ? ': ' + esc(p.archivedWhy) : '') + '. Not in the lists or pickers, and cannot log in. Restore them to use them again.</div>' : '') +
        '<div class="grid two"><div class="grid" style="align-content:start">' +
          '<div class="card pp-head"><span class="pp-av big pp-' + (p.type === 'Contractor' ? 'c' : 'e') + '">' + esc(ini(p.name)) + '</span><div><h2 style="margin:0">' + esc(p.name) + ' <small class="muted">' + esc(p.id) + '</small></h2>' +
            '<div class="muted">' + esc([p.role, p.type === 'Contractor' ? 'Contractor' + (p.business ? ', ' + p.business : '') : p.employment + ' employee', tradeName(p.trade)].filter(Boolean).join(' · ')) + '</div>' +
            '<div style="margin-top:6px">' + schip(p.status) + ' ' + cchip(c.worst) + ' ' + stars(p.rating) + '</div></div></div>' +
          '<div class="card"><h2>Contact &amp; work</h2><table class="pp-kv"><tbody>' + row('Phone', tel ? '<a href="tel:' + esc(tel) + '">' + esc(p.phone) + '</a>' : '') + row('Email', p.email ? '<a href="mailto:' + esc(p.email) + '">' + esc(p.email) + '</a>' : '') +
            row('Address', esc([p.address, p.suburb].filter(Boolean).join(', '))) + row('Started', esc(dmy(p.start))) + row('Hours a week', p.hours ? String(p.hours) : '') + row('Availability', esc(p.availability)) +
            row('Rate per hour', p.costRate ? '<b>' + money(p.costRate) + '</b> /hr <small class="muted">(the rate they quote)</small>' : '<span class="bad">Not given yet</span>') + row('Group', esc((GI[p.group || 'Construction'] || [''])[0] + ' ' + (p.group || 'Construction'))) + row('Charge-out rate', p.chargeRate ? money(p.chargeRate) + ' /hr' : '') + row('Skills', esc(p.skills)) +
            (p.type === 'Contractor' ? row('ABN', esc(p.abn)) + row('GST', p.gst ? 'Registered' : '') : '') +
            row('Emergency contact', esc([(p.emergency || {}).name, (p.emergency || {}).phone].filter(Boolean).join(' · '))) + '</tbody></table>' + (p.notes ? '<p style="white-space:pre-wrap;margin:10px 0 0">' + esc(p.notes) + '</p>' : '') + '</div>' +
          credCard(p) +
          ((p.group || 'Construction') !== 'Construction' ? (c.problems.length ? '<div class="card"><p class="sk-warn" style="margin:0">⚠ ' + esc(c.problems.join(' · ')) + '</p></div>' : '') : '<div class="card"><h2>Tickets, licences' + (p.type === 'Contractor' ? ' &amp; insurance' : '') + '</h2><table class="pp-kv"><tbody>' +
            T.map(function (t) { var x = tk[t.key]; return x ? '<tr><td class="muted">' + esc(t.name) + '</td><td>' + esc([x.number, x.class].filter(Boolean).join(' · ') || (x.has ? 'Yes' : '')) + (x.expiry ? ' <small class="muted">expires ' + esc(dmy(x.expiry)) + '</small>' : '') + '</td></tr>' : ''; }).join('') +
            (p.type === 'Contractor' ? row('Public liability', esc([(p.insurance || {}).insurer, (p.insurance || {}).policy].filter(Boolean).join(' · ')) + ((p.insurance || {}).expiry ? ' <small class="muted">expires ' + dmy(p.insurance.expiry) + '</small>' : '')) +
              row('Workers comp', (p.workersComp || {}).soleTrader ? 'Sole trader (own cover)' : esc((p.workersComp || {}).policy || '') + ((p.workersComp || {}).expiry ? ' <small class="muted">expires ' + dmy(p.workersComp.expiry) + '</small>' : '')) : '') + '</tbody></table>' +
            ((p.permits || []).length ? '<tr><td class="muted">Permits</td><td>' + p.permits.map(function (x) { return esc(x.name + (x.number ? ' ' + x.number : '')) + (x.expiry ? ' <small class="muted">expires ' + dmy(x.expiry) + '</small>' : ''); }).join('<br>') + '</td></tr>' : '') +
            (c.problems.length ? '<p class="sk-warn" style="margin:8px 0 0">⚠ ' + esc(c.problems.join(' · ')) + '</p>' : '<p class="good" style="margin:8px 0 0">✓ All in order</p>') + '</div>') +
          (canUsers() ? '<div class="card"><h2>🔐 Login</h2>' + (lg ? '<p style="margin:0"><b>' + esc(lg.username) + '</b> · ' + esc(lg.role) + (lg.active ? '' : ' · <span class="bad">disabled</span>') + '</p>' : '<p class="muted" style="margin:0">No login. ' + (p.email ? '' : 'Add an email first, then ') + 'give them one in Users &amp; access.</p>') +
            '<p style="margin:8px 0 0"><a class="btn btn-sm" href="#users' + (lg ? '/' + esc(lg.id) : '/new/' + esc(p.id)) + '">' + (lg ? 'Manage the login' : '＋ Give ' + esc(p.name.split(' ')[0]) + ' a login') + '</a></p></div>' : '') +
        '</div><div class="grid" style="align-content:start"><div class="card"><h2>📅 On the projects</h2>' +
          (Object.keys(proj).length ? '<p class="muted" style="margin:-4px 0 8px;font-size:13px">' + Object.keys(proj).length + ' project' + (Object.keys(proj).length === 1 ? '' : 's') + ' · ' + a.now + ' task' + (a.now === 1 ? '' : 's') + ' now · ' + a.next + ' in the next 14 days' + (a.late ? ' · <b class="bad">' + a.late + ' late</b>' : '') + '</p>' +
            Object.keys(proj).map(function (core) { var g = proj[core]; return '<div class="pp-proj"><a href="#plan/' + esc(core) + '/schedule"><b>' + esc(g.plan) + '</b></a><table class="pp-asg"><tbody>' +
              g.rows.map(function (x) { var late = x.es && !x.done && x.ef < (S.data.today || ''); return '<tr><td><span class="pp-kind">' + esc(x.kind) + '</span></td><td>' + esc(x.what || '') + '</td><td class="nowrap muted">' + (x.es ? esc(dmy(x.es)) + (x.ef && x.ef !== x.es ? ' – ' + esc(dmy(x.ef)) : '') : '') + '</td><td class="num">' + (x.es ? (x.done ? '✓' : late ? '<b class="bad">late</b>' : (x.pct || 0) + '%') : '') + '</td></tr>'; }).join('') + '</tbody></table></div>'; }).join('')
            : '<div class="empty">Not on any project plan yet. Put their name in a task\'s Resources, as a story owner or a stakeholder, or as the project manager.</div>') + '</div>' +
          '<div class="card pp-hist"><h2>🕘 History</h2>' + ((p.history || []).length ? '<ul>' + p.history.slice().reverse().map(function (h) { return '<li><small class="muted">' + esc(new Date(h.at).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Sydney' })) + (h.by ? ' · ' + esc(String(h.by).replace(/^Admin \((.*)\)$/, '$1')) : '') + '</small><br>' + esc(h.what) + '</li>'; }).join('') + '</ul>'
            : '<p class="muted" style="margin:0">No changes recorded yet. From now on every change (who, when, what) is kept here.</p>') + '</div></div></div>';
      var e = $('#ppEdit'); if (e) e.onclick = function () { edit(p.id, p); };
      var cvb = $('#ppCv'); if (cvb) cvb.onclick = function () { cvDownload(p.id); };
      var back = function () { profile(p.id); };   // v90
      var ar = $('#ppArc'); if (ar) ar.onclick = function () { archiveDialog(p, back); };
      var dl = $('#ppDel'); if (dl) dl.onclick = function () { deleteDialog(p); };
      var st = $('#ppSt'); if (st) st.onchange = function () { var v = st.value; api('pplSave', { person: Object.assign({}, p, { status: v }) }).then(function () { toast(p.name + ': ' + v); return load(); }).then(back).catch(fail); };
    }).catch(fail);
  }

  // ---------- the person form: the project manager for anyone, or "My profile" for yourself ----------
  // Two groups: 💻 Technical & general (PM, director, contractor, personnel) and 🏗 Construction (trades, tickets, permits,
  // insurance, workers comp). Both: contact, the rate per hour they quote, credentials (education, qualifications,
  // certifications) and a resume. Most of it is optional.
  var GI = { 'Technical & general': ['💻', 'IT, cloud, ESG, consulting, events and other projects'], Construction: ['🏗', 'Builds and fit-outs: trades, tickets, permits, insurance'] };
  var REP = {
    education: [['qual', 'Degree / diploma', 'e.g. BSc (Hons) Computing'], ['inst', 'Institution', 'e.g. University of Sydney'], ['year', 'Year', '2015']],
    quals: [['name', 'Qualification', 'e.g. PRINCE2 Practitioner, Cert IV WHS'], ['year', 'Year', '2020']],
    certs: [['name', 'Certification', 'e.g. PMP, AWS Solutions Architect'], ['issuer', 'Issued by', 'e.g. PMI'], ['number', 'Number', ''], ['expiry', 'Expiry', '', 'date']],
    permits: [['name', 'Permit / licence', 'e.g. Hot work permit, Builder licence'], ['number', 'Number', ''], ['issuer', 'Issued by', 'e.g. NSW Fair Trading'], ['expiry', 'Expiry', '', 'date']] };
  function repRows(k, L) {
    var F = REP[k], row = function (x) { x = x || {}; return '<div class="pp-rep-r">' + F.map(function (f) { return '<label>' + esc(f[1]) + '<input data-rf="' + f[0] + '" value="' + esc(x[f[0]] || '') + '" placeholder="' + esc(f[2] || '') + '"' + (f[3] ? ' type="' + f[3] + '"' : '') + '></label>'; }).join('') + '<button type="button" class="btn btn-sm pp-rep-x" data-rx title="Remove">✕</button></div>'; };
    return '<div class="full pp-rep" data-rep="' + k + '">' + (L || []).map(row).join('') + '<button type="button" class="btn btn-sm" data-radd="' + k + '">＋ Add</button></div>';
  }
  function repWire(box) {
    box.querySelectorAll('[data-radd]').forEach(function (b) { b.onclick = function () { var k = b.getAttribute('data-radd'), tmp = document.createElement('div'); tmp.innerHTML = repRows(k, [{}]); var r = tmp.querySelector('.pp-rep-r'); b.parentNode.insertBefore(r, b); r.querySelector('[data-rx]').onclick = function () { r.remove(); }; var i = r.querySelector('input'); if (i) i.focus(); }; });
    box.querySelectorAll('[data-rx]').forEach(function (x) { x.onclick = function () { x.closest('.pp-rep-r').remove(); }; });
  }
  function repRead(box, k) { var el = box.querySelector('[data-rep="' + k + '"]'); if (!el) return []; return Array.prototype.map.call(el.querySelectorAll('.pp-rep-r'), function (r) { var o = {}; r.querySelectorAll('[data-rf]').forEach(function (i) { o[i.getAttribute('data-rf')] = i.value.trim(); }); return o; }).filter(function (o) { return Object.keys(o).some(function (q) { return o[q]; }); }); }
  function personForm(p, d, o) {   // o: { self, id, title }
    p = p || {}; var tk = p.tickets || {}, I = p.insurance || {}, W = p.workersComp || {}, E = p.emergency || {}, grp = p.group || 'Technical & general', self = !!o.self;
    var f = function (k, label, v, ph, type, extra) { return '<label' + (extra || '') + '>' + label + '<input data-k="' + k + '" value="' + esc(v == null ? '' : v) + '" placeholder="' + esc(ph || '') + '"' + (type ? ' type="' + type + '"' : '') + '></label>'; };
    var sel = function (k, label, v, opts, extra) { return '<label' + (extra || '') + '>' + label + '<select data-k="' + k + '">' + opts.map(function (x) { var val = Array.isArray(x) ? x[0] : x, t = Array.isArray(x) ? x[1] : x; return '<option value="' + esc(val) + '"' + (v === val ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('') + '</select></label>'; };
    var cb = function (k, label, v) { return '<label class="sc-cb"><input type="checkbox" data-k="' + k + '"' + (v ? ' checked' : '') + '> ' + label + '</label>'; };
    var opt = '<small class="muted pp-opt">optional</small>';
    M.modal('<h2>' + esc(o.title) + '</h2>' + (self ? '<p class="muted" style="margin:-4px 0 8px">Your details and credentials, for the project manager and the team. Most of it is optional: fill in what applies to you.</p>' : '') +
      '<div class="form sc-form" id="pfF" style="margin-top:10px">' +
      '<div class="full"><b>Which projects do you work on?</b><div class="us-rpick">' + d.groups.map(function (g) { return '<label class="us-rcard"><input type="radio" name="pfGroup" value="' + esc(g) + '"' + (grp === g ? ' checked' : '') + '><span><b>' + GI[g][0] + ' ' + esc(g) + '</b><small>' + esc(GI[g][1]) + '</small></span></label>'; }).join('') + '</div></div>' +
      '<h3 class="full">Person</h3>' + f('name', 'Full name', p.name, 'e.g. Priya Shah') +
      (self ? '<label>Role<input value="' + esc(p.role || o.role || '') + '" disabled title="Set by the project manager"></label>'
        : '<div data-g="Technical & general">' + sel('roleT', 'Role', d.techRoles.indexOf(p.role) >= 0 ? p.role : 'Project personnel', d.techRoles) + '</div>' +
          '<div data-g="Construction"><label>Role<input data-k="roleC" list="ppRoles" value="' + esc(p.role || '') + '" placeholder="e.g. Site supervisor"></label><datalist id="ppRoles">' + d.roles.map(function (r) { return '<option value="' + esc(r) + '">'; }).join('') + '</datalist></div>') +
      '<div class="full" data-g="Construction"><div class="pp-type">' + d.types.map(function (t) { return '<label class="pp-tbtn"><input type="radio" name="ppType" value="' + t + '"' + ((p.type || 'Employee') === t ? ' checked' : '') + '><span><b>' + (t === 'Employee' ? '🧑‍🔧 Employee' : '🧾 Contractor') + '</b><small>' + (t === 'Employee' ? 'On the team\'s books' : 'Own business: ABN, insurance') + '</small></span></label>'; }).join('') + '</div></div>' +
      '<div data-g="Construction">' + sel('trade', 'Trade ' + opt, p.trade || '', [['', '–']].concat(d.trades.map(function (t) { return [t.key, t.name]; }))) + '</div>' +
      f('phone', 'Mobile', p.phone, '04xx xxx xxx', 'tel') + (self ? '<label>Email (your login)<input value="' + esc(o.email || p.email || '') + '" disabled></label>' : f('email', 'Email (also their login)', p.email, 'name@company.com', 'email')) +
      f('suburb', 'City / suburb ' + opt, p.suburb, '') + f('linkedin', 'LinkedIn ' + opt, p.linkedin, 'https://linkedin.com/in/…') +
      f('availability', 'Availability ' + opt, p.availability, 'e.g. Mon–Fri, 3 days a week') + f('hours', 'Hours a week ' + opt, p.hours || '', 'e.g. 38', 'number') +
      '<h3 class="full">💲 Rate</h3><label class="pp-rate">Your rate per hour (AUD)<input data-k="costRate" type="number" min="0" step="any" value="' + esc(p.costRate || '') + '" placeholder="e.g. 95"><small class="muted">What you quote for an hour of your time. The project manager uses it for costing.</small></label>' +
      (self ? '' : f('chargeRate', 'Charge-out rate ($/hr) ' + opt, p.chargeRate || '', 'what the client is charged', 'number')) +
      '<div class="full form" data-ctr style="padding:0">' + f('business', 'Business / trading name ' + opt, p.business, '') + f('abn', 'ABN ' + opt, p.abn, '11 digits') + '<label>GST<span class="sc-inline">' + cb('gst', 'Registered for GST', p.gst) + '</span></label></div>' +
      '<h3 class="full">🎓 Credentials</h3><p class="full muted pp-sub">Education</p>' + repRows('education', p.education) +
      '<p class="full muted pp-sub">Qualifications</p>' + repRows('quals', p.quals) +
      '<p class="full muted pp-sub">Certifications <small>(an expiry date is checked: you are reminded 30 days before)</small></p>' + repRows('certs', p.certs) +
      '<h3 class="full">📄 Resume</h3><div class="full pp-cv" id="pfCv">' + (p.cv && p.cv.name ? '<span>📄 <b>' + esc(p.cv.name) + '</b> <small class="muted">' + Math.round((p.cv.size || 0) / 1024) + ' KB · ' + esc(new Date(p.cv.at).toLocaleDateString('en-AU')) + '</small></span> <button class="btn btn-sm" type="button" id="pfCvGet">⬇ Download</button>' : '<span class="muted">No resume yet.</span>') +
        ' <label class="btn btn-sm pp-cvbtn">⬆ ' + (p.cv && p.cv.name ? 'Replace' : 'Upload') + ' resume<input type="file" id="pfCvIn" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden></label> <small class="muted">PDF or Word, up to 3 MB</small></div>' +
      '<div class="full form" data-g="Construction" style="padding:0"><h3 class="full">🎫 Tickets &amp; licences ' + opt + '</h3>' +
        d.tickets.map(function (t) { var x = tk[t.key] || {}; return '<div class="full pp-tk"><b>' + esc(t.name) + '</b>' + f('tk.' + t.key + '.number', 'Number', x.number, '') + (t.key === 'licence' || t.key === 'driver' ? f('tk.' + t.key + '.class', 'Class', x.class, '') : '') + (t.key === 'whiteCard' ? '' : f('tk.' + t.key + '.expiry', 'Expiry', x.expiry, '', 'date')) + '</div>'; }).join('') +
        '<h3 class="full">📋 Permits ' + opt + '</h3>' + repRows('permits', p.permits) + '</div>' +
      '<div class="full form" data-ins style="padding:0"><h3 class="full">🛡 Insurance ' + opt + '</h3>' + f('ins.insurer', 'Insurer (public liability / professional indemnity)', I.insurer, '') + f('ins.policy', 'Policy number', I.policy, '') + f('ins.expiry', 'Expiry', I.expiry, '', 'date') +
        '<div class="full form" data-g="Construction" style="padding:0">' + f('wc.policy', 'Workers comp policy', W.policy, '') + f('wc.expiry', 'Workers comp expiry', W.expiry, '', 'date') + '<label>Sole trader<span class="sc-inline">' + cb('wc.soleTrader', 'No employees (own cover)', W.soleTrader) + '</span></label></div></div>' +
      '<h3 class="full">Other ' + opt + '</h3>' + f('em.name', 'Emergency contact', E.name, 'name and relationship') + f('em.phone', 'Emergency phone', E.phone, '', 'tel') +
      (self ? '' : sel('status', 'Status', p.status || 'Active', d.statuses) + '<label>Rating<select data-k="rating">' + [0, 1, 2, 3, 4, 5].map(function (x) { return '<option value="' + x + '"' + (+p.rating === x ? ' selected' : '') + '>' + (x ? '★★★★★'.slice(0, x) : 'Not rated') + '</option>'; }).join('') + '</select></label>' +
        '<label class="full">Notes (the project manager\'s)<textarea data-k="notes" rows="3">' + esc(p.notes || '') + '</textarea></label>' +
        (o.id ? '<label class="sc-cb full pp-ren" hidden><input type="checkbox" id="ppRen" checked style="width:auto"> Also change the name on the project plans</label>' : '')) +
      '</div><div class="actions" style="justify-content:space-between;margin-top:14px">' + (!self && o.id ? '<button class="btn" id="ppArchB" type="button">' + (p.archived ? 'Restore' : 'Archive') + '</button>' : '<span></span>') +
      '<span><button class="btn" data-close type="button">Cancel</button> <button class="btn btn-gold" id="ppSave" type="button">' + (self ? 'Save my profile' : 'Save') + '</button></span></div>');
    $('#modal .modal-card').classList.add('sc-wide');
    var box = $('#pfF'); repWire(box);
    var show = function () {
      var g = (box.querySelector('[name=pfGroup]:checked') || {}).value || 'Technical & general', con = g === 'Construction';
      var type = con ? ((box.querySelector('[name=ppType]:checked') || {}).value || 'Employee') : (self ? (p.role === 'Contractor' ? 'Contractor' : 'Employee') : ((box.querySelector('[data-k=roleT]') || {}).value === 'Contractor' ? 'Contractor' : 'Employee'));
      box.querySelectorAll('[data-g]').forEach(function (el) { el.hidden = el.getAttribute('data-g') !== g; });
      box.querySelector('[data-ctr]').hidden = type !== 'Contractor'; box.querySelector('[data-ins]').hidden = !(con || type === 'Contractor');
    };
    box.querySelectorAll('[name=pfGroup],[name=ppType],[data-k=roleT]').forEach(function (r) { r.onchange = show; }); show();
    var collect = function () {
      var g = (box.querySelector('[name=pfGroup]:checked') || {}).value || 'Technical & general', x = { group: g, tickets: {}, insurance: {}, workersComp: {}, emergency: {} }, map = { ins: 'insurance', wc: 'workersComp', em: 'emergency' };
      box.querySelectorAll('[data-k]').forEach(function (el) { if (el.closest('[hidden]')) return; var k = el.getAttribute('data-k'), v = el.type === 'checkbox' ? el.checked : el.value, q = k.split('.');
        if (q[0] === 'tk') (x.tickets[q[1]] = x.tickets[q[1]] || {})[q[2]] = v; else if (q.length === 2) x[map[q[0]]][q[1]] = v; else x[k] = v; });
      if (!self) x.role = g === 'Construction' ? (x.roleC || '') : (x.roleT || 'Project personnel'); delete x.roleC; delete x.roleT;
      x.type = g === 'Construction' ? ((box.querySelector('[name=ppType]:checked') || {}).value || 'Employee') : '';
      ['education', 'quals', 'certs', 'permits'].forEach(function (k) { x[k] = repRead(box, k); });
      return x;
    };
    var cvIn = $('#pfCvIn'); cvIn.onchange = function () {
      var file = cvIn.files[0]; if (!file) return; if (file.size > 3 * 1024 * 1024) return toast('The resume is over 3 MB', true);
      if (!o.id && !self) return toast('Save the person first, then upload the resume', true);
      var rd = new FileReader(); rd.onload = function () {
        var go = function () { return api(self ? 'pplMeCv' : 'pplCvUpload', { id: o.id, name: file.name, type: file.type || (/\.docx$/i.test(file.name) ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : /\.doc$/i.test(file.name) ? 'application/msword' : 'application/pdf'), data: String(rd.result).split(',')[1] }); };
        (self && !o.id ? api('pplMeSave', { person: Object.assign({}, p, collect()) }).then(function (r) { o.id = r.person.id; p = r.person; }) : Promise.resolve()).then(go).then(function (r) {
          p.cv = r.cv; $('#pfCv').querySelector('span').innerHTML = '📄 <b>' + esc(r.cv.name) + '</b> <small class="muted">' + Math.round(r.cv.size / 1024) + ' KB · uploaded</small>'; toast('Resume uploaded'); }).catch(fail);
      }; rd.readAsDataURL(file);
    };
    var cg = $('#pfCvGet'); if (cg) cg.onclick = function () { cvDownload(self ? null : o.id); };
    var nm = box.querySelector('[data-k=name]'), rn = document.querySelector('#modal .pp-ren');
    if (nm && rn) nm.oninput = function () { rn.hidden = nm.value.trim() === (p.name || ''); };
    return { collect: collect, renamePlans: function () { return !!(rn && !rn.hidden && $('#ppRen').checked); }, get p() { return p; } };
  }
  function cvDownload(id) {
    api(id ? 'pplCvGet' : 'pplMeCvGet', id ? { id: id } : {}).then(function (r) {
      var bin = atob(r.data), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      saveBlob(new Blob([u], { type: r.type }), r.name);
    }).catch(fail);
  }
  function credCard(p) {   // 🎓 education, qualifications, certifications, resume, rate
    var li = function (L, fn) { return (L || []).length ? '<ul class="pp-cr">' + L.map(fn).join('') + '</ul>' : ''; };
    var body = (p.education || []).length || (p.quals || []).length || (p.certs || []).length ? (
      ((p.education || []).length ? '<p class="pp-sub muted">Education</p>' + li(p.education, function (x) { return '<li><b>' + esc(x.qual) + '</b> ' + esc([x.inst, x.year].filter(Boolean).join(', ')) + '</li>'; }) : '') +
      ((p.quals || []).length ? '<p class="pp-sub muted">Qualifications</p>' + li(p.quals, function (x) { return '<li><b>' + esc(x.name) + '</b> ' + esc(x.year || '') + '</li>'; }) : '') +
      ((p.certs || []).length ? '<p class="pp-sub muted">Certifications</p>' + li(p.certs, function (x) { return '<li><b>' + esc(x.name) + '</b> ' + esc([x.issuer, x.number].filter(Boolean).join(' · ')) + (x.expiry ? ' <small class="muted">expires ' + dmy(x.expiry) + '</small>' : '') + '</li>'; }) : ''))
      : '<p class="muted" style="margin:0">No credentials yet. ' + esc(p.name.split(' ')[0]) + ' can add them in <b>My profile</b>, or press Edit.</p>';
    return '<div class="card"><h2>🎓 Credentials</h2>' + body + '<p style="margin:10px 0 0">' + (p.cv && p.cv.name ? '📄 <b>' + esc(p.cv.name) + '</b> <button class="btn btn-sm" id="ppCv" type="button">⬇ Resume</button>' : '<span class="muted">No resume on file.</span>') +
      (p.linkedin ? ' · <a href="' + esc(/^https?:/.test(p.linkedin) ? p.linkedin : 'https://' + p.linkedin) + '" target="_blank" rel="noopener">LinkedIn ↗</a>' : '') + '</p></div>';
  }
  function edit(id, given) {
    var go = function (p) {
      p = p || { group: 'Technical & general', type: 'Employee', status: 'Active', tickets: {}, rating: 0 };
      var F = personForm(p, S.data, { id: id, title: id ? p.name + ' · ' + id : 'New person' });
      $('#ppSave').onclick = function () {
        api('pplSave', { person: Object.assign({}, F.p, F.collect(), { id: id || '' }), renamePlans: F.renamePlans() }).then(function (r) {
          M.closeModal(); toast(r.same ? 'No changes' : 'Saved' + (r.plans ? ': name changed on ' + r.plans + ' project plan' + (r.plans === 1 ? '' : 's') : ''));
          return load().then(function () { if (location.hash.indexOf('#people/P-') === 0 || !id) location.hash = '#people/' + r.person.id; if (location.hash.indexOf('#people/P-') === 0) profile(r.person.id); else draw(); });
        }).catch(fail);
      };
      var ar = $('#ppArchB'); if (ar) ar.onclick = function () { archiveDialog(p, function () { if (location.hash.indexOf('#people/P-') === 0) profile(p.id); else draw(); }); };
    };
    if (given) go(given); else if (id) api('pplGet', { id: id }).then(function (r) { go(r.person); }).catch(fail); else go(null);
  }

  // ---------- 🙋 My profile: anyone signed in fills in their own details, credentials, rate and resume ----------
  function mePage() {
    V().innerHTML = '<div class="empty">Loading…</div>';
    return api('pplMe').then(function (r) {
      var p = r.person, me = M.me || {};
      if (me.owner) { V().innerHTML = '<div class="card"><h2>🙋 My profile</h2><p>You are the <b>project manager (super user)</b>. Add yourself in <a href="#people">People</a> like anyone else if you want your own credentials and rate on file.</p></div>'; return; }
      var crd = function (t, L, fn) { return L && L.length ? '<p class="pp-sub muted">' + t + '</p><ul class="pp-cr">' + L.map(fn).join('') + '</ul>' : ''; };
      V().innerHTML = '<div class="row" style="margin-bottom:12px"><div><h2 style="margin:0">🙋 My profile</h2><p class="muted" style="margin:2px 0 0;font-size:13px">' + esc(r.email) + ' · ' + esc(p ? p.role : r.role) + '</p></div><span class="sp"></span><button class="btn btn-gold" id="meEdit" type="button">' + (p ? '✏ Edit my profile' : '＋ Fill in my profile') + '</button></div>' +
        (p ? '<div class="grid two"><div class="card"><h2>' + (GI[p.group] || ['', ''])[0] + ' ' + esc(p.name) + '</h2><table class="pp-kv"><tbody>' +
            '<tr><td class="muted">Group</td><td>' + esc(p.group || '') + '</td></tr><tr><td class="muted">Rate per hour</td><td>' + (p.costRate ? '<b>' + money(p.costRate) + '</b> /hr' : '<span class="bad">Not given yet</span>') + '</td></tr>' +
            (p.phone ? '<tr><td class="muted">Mobile</td><td>' + esc(p.phone) + '</td></tr>' : '') + (p.availability ? '<tr><td class="muted">Availability</td><td>' + esc(p.availability) + '</td></tr>' : '') +
            '<tr><td class="muted">Resume</td><td>' + (p.cv && p.cv.name ? '📄 ' + esc(p.cv.name) + ' <button class="btn btn-sm" id="meCv" type="button">⬇</button>' : '<span class="muted">Not uploaded</span>') + '</td></tr></tbody></table></div>' +
          '<div class="card"><h2>🎓 Credentials</h2>' + (crd('Education', p.education, function (x) { return '<li><b>' + esc(x.qual) + '</b> ' + esc([x.inst, x.year].filter(Boolean).join(', ')) + '</li>'; }) +
            crd('Qualifications', p.quals, function (x) { return '<li><b>' + esc(x.name) + '</b> ' + esc(x.year || '') + '</li>'; }) +
            crd('Certifications', p.certs, function (x) { return '<li><b>' + esc(x.name) + '</b> ' + esc([x.issuer, x.number].filter(Boolean).join(' · ')) + (x.expiry ? ' <small class="muted">expires ' + dmy(x.expiry) + '</small>' : '') + '</li>'; }) +
            crd('Permits', p.permits, function (x) { return '<li><b>' + esc(x.name) + '</b> ' + esc(x.number || '') + (x.expiry ? ' <small class="muted">expires ' + dmy(x.expiry) + '</small>' : '') + '</li>'; }) || '<p class="muted">None yet. Add your education, qualifications and certifications.</p>') +
            (r.comp && r.comp.problems.length ? '<p class="sk-warn">⚠ ' + esc(r.comp.problems.join(' · ')) + '</p>' : '') + '</div></div>' +
          '<div class="card" style="margin-top:14px"><h2>📅 My work</h2>' + ((r.assign && r.assign.list.length) ? '<table class="sc-table"><thead><tr><th>Project</th><th>What</th><th>Dates</th></tr></thead><tbody>' + r.assign.list.map(function (x) { return '<tr><td>' + esc(x.plan) + '</td><td>' + esc(x.kind + ': ' + (x.what || '')) + '</td><td class="nowrap">' + (x.es ? esc(dmy(x.es)) + (x.ef && x.ef !== x.es ? ' – ' + esc(dmy(x.ef)) : '') : '') + '</td></tr>'; }).join('') + '</tbody></table>' : '<p class="muted">Nothing on the project plans for you yet.</p>') + '</div>'
          : '<div class="card"><div class="empty">Your profile is empty. Press <b>＋ Fill in my profile</b>: your details, the rate per hour you quote, your education, qualifications, certifications and your resume.</div></div>');
      var c = $('#meCv'); if (c) c.onclick = function () { cvDownload(null); };
      $('#meEdit').onclick = function () {
        var F = personForm(p || { group: 'Technical & general', name: me.name || '' }, r, { self: true, id: p ? p.id : '', email: r.email, role: r.role, title: '🙋 My profile' });
        $('#ppSave').onclick = function () { api('pplMeSave', { person: Object.assign({}, F.p, F.collect()) }).then(function (x) { M.closeModal(); toast(x.same ? 'No changes' : 'Profile saved'); mePage(); }).catch(fail); };
      };
    }).catch(fail);
  }
  M.addView('me', 'My profile', mePage, null);

  /* ---------- v90: looking after the register: archive / restore (with a reason), bulk changes, renew a ticket, history,
     delete permanently (archived only), export (CSV / Excel) and import (update or add from a spreadsheet) ---------- */
  var XCOLS = [['ID', function (p) { return p.id; }], ['Name', 'name'], ['Type', 'type'], ['Role', 'role'], ['Trade', function (p) { return tradeName(p.trade); }], ['Employment', 'employment'], ['Trading name', 'business'], ['ABN', 'abn'],
    ['GST', function (p) { return p.type === 'Contractor' ? (p.gst ? 'Yes' : 'No') : ''; }], ['Mobile', 'phone'], ['Email', 'email'], ['Address', 'address'], ['Suburb', 'suburb'], ['Started', 'start'], ['Status', 'status'], ['Hours a week', 'hours'],
    ['Availability', 'availability'], ['Cost rate ($/hr)', 'costRate'], ['Charge-out rate ($/hr)', 'chargeRate'], ['Rating', 'rating'],
    ['White card', function (p) { return ((p.tickets || {}).whiteCard || {}).number || ''; }], ['Trade licence', function (p) { return ((p.tickets || {}).licence || {}).number || ''; }], ['Trade licence expiry', function (p) { return ((p.tickets || {}).licence || {}).expiry || ''; }],
    ['Driver licence', function (p) { return ((p.tickets || {}).driver || {}).number || ''; }], ['Driver licence expiry', function (p) { return ((p.tickets || {}).driver || {}).expiry || ''; }], ['First aid expiry', function (p) { return ((p.tickets || {}).firstAid || {}).expiry || ''; }],
    ['Working at heights expiry', function (p) { return ((p.tickets || {}).heights || {}).expiry || ''; }], ['Public liability expiry', function (p) { return (p.insurance || {}).expiry || ''; }], ['Workers comp expiry', function (p) { return (p.workersComp || {}).expiry || ''; }],
    ['Emergency contact', function (p) { return (p.emergency || {}).name || ''; }], ['Emergency phone', function (p) { return (p.emergency || {}).phone || ''; }], ['Skills', 'skills'], ['Notes', 'notes'], ['Archived', function (p) { return p.archived ? 'Yes' : ''; }]];
  var cellOf = function (c, p) { var v = typeof c[1] === 'function' ? c[1](p) : p[c[1]]; return v == null || (v === 0 && /rate|Hours|Rating/i.test(c[0])) ? '' : v; };
  function saveBlob(blob, name) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }
  var xlsLib = null;
  function loadXls() {
    if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
    if (!xlsLib) xlsLib = new Promise(function (res, rej) { var sc = document.createElement('script'); sc.src = 'vendor/exceljs.min.js?v=440'; sc.onload = function () { res(window.ExcelJS); }; sc.onerror = function () { xlsLib = null; rej(new Error('Could not load the Excel tool. Check your connection and try again.')); }; document.head.appendChild(sc); });
    return xlsLib;
  }
  var csvCell = function (v) { v = String(v == null ? '' : v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  function csvParse(s) {
    var rows = [], row = [], cur = '', q = false; s = String(s || '').replace(/^﻿/, '');
    for (var i = 0; i < s.length; i++) { var c = s[i];
      if (q) { if (c === '"' && s[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; } else cur += c; }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (x) { return String(x).trim(); }); });
  }
  var toObjs = function (rows) { var h = (rows[0] || []).map(function (x) { return String(x || '').trim(); }); return rows.slice(1).map(function (r) { var o = {}; h.forEach(function (k, i) { if (k) o[k] = r[i] == null ? '' : r[i]; }); return o; }); };
  function exportDialog(ids) {
    M.modal('<h2>⬇ Export people</h2><p class="muted" style="margin:-4px 0 10px">' + (ids ? ids.length + ' selected' : 'Everyone in People') + ': contact details, roles, rates, tickets and licences. The same columns can be imported back (⬆ Import) to update or add people. Payroll details are not kept, so they are not in it.</p>' +
      (ids ? '' : '<label class="sc-cb"><input type="checkbox" id="exArch" style="width:auto"> Include archived people</label>') +
      '<div class="actions"><button class="btn" data-close type="button">Cancel</button><button class="btn" id="exCsv" type="button">⬇ CSV</button><button class="btn btn-gold" id="exXls" type="button">⬇ Excel</button></div>');
    var get = function () { return api('pplExport', { archived: ids ? true : !!($('#exArch') || {}).checked }).then(function (r) { return r.people.filter(function (p) { return !ids || ids.indexOf(p.id) >= 0; }); }); };
    var stamp = new Date().toISOString().slice(0, 10);
    $('#exCsv').onclick = function () { get().then(function (L) {
      var t = '﻿' + [XCOLS.map(function (c) { return csvCell(c[0]); }).join(',')].concat(L.map(function (p) { return XCOLS.map(function (c) { return csvCell(cellOf(c, p)); }).join(','); })).join('\r\n');
      saveBlob(new Blob([t], { type: 'text/csv;charset=utf-8' }), 'MBS-people-' + stamp + '.csv'); M.closeModal(); toast(L.length + ' people exported');
    }).catch(fail); };
    $('#exXls').onclick = function () { Promise.all([get(), loadXls()]).then(function (x) {
      var L = x[0], wb = new x[1].Workbook(), ws = wb.addWorksheet('People');
      ws.columns = XCOLS.map(function (c) { return { header: c[0], width: Math.max(10, Math.min(36, c[0].length + 4)) }; });
      L.forEach(function (p) { ws.addRow(XCOLS.map(function (c) { return cellOf(c, p); })); });
      ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; ws.getRow(1).eachCell(function (c) { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2A44' } }; });
      ws.views = [{ state: 'frozen', ySplit: 1, xSplit: 2 }]; ws.autoFilter = { from: 'A1', to: { row: 1, column: XCOLS.length } };
      return wb.xlsx.writeBuffer().then(function (buf) { saveBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'MBS-people-' + stamp + '.xlsx'); M.closeModal(); toast(L.length + ' people exported'); });
    }).catch(fail); };
  }
  function importDialog() {
    M.modal('<h2>⬆ Import people</h2><p class="muted" style="margin:-4px 0 10px">A CSV or Excel file with one person per row and a header row (the same columns as ⬇ Export). People are matched by <b>ID</b>, then <b>email</b>, then <b>exact name</b>: a match is <b>updated</b> (only the columns in the file, blanks are left alone); anyone else is <b>added</b>. You see what will change before anything is saved.</p>' +
      '<input type="file" id="imF" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"><div id="imOut" style="margin-top:12px"></div>' +
      '<div class="actions" style="justify-content:space-between"><button class="btn btn-sm" id="imTpl" type="button">⬇ Blank template (CSV)</button><span><button class="btn" data-close type="button">Cancel</button> <button class="btn btn-gold" id="imGo" type="button" disabled>Import</button></span></div>');
    var rows = null;
    $('#imTpl').onclick = function () { saveBlob(new Blob(['﻿' + XCOLS.filter(function (c) { return c[0] !== 'Archived'; }).map(function (c) { return csvCell(c[0]); }).join(',') + '\r\n'], { type: 'text/csv;charset=utf-8' }), 'MBS-people-template.csv'); };
    var read = function (file) {
      if (/\.xlsx$/i.test(file.name)) return Promise.all([file.arrayBuffer(), loadXls()]).then(function (x) { var wb = new x[1].Workbook(); return wb.xlsx.load(x[0]).then(function () {
        var ws = wb.worksheets[0], out = []; if (!ws) return [];
        ws.eachRow({ includeEmpty: false }, function (r) { var a = []; for (var i = 1; i <= ws.columnCount; i++) { var v = r.getCell(i).value; if (v && v instanceof Date) v = v.toISOString().slice(0, 10); else if (v && typeof v === 'object') v = v.text != null ? v.text : v.result != null ? v.result : v.richText ? v.richText.map(function (t) { return t.text; }).join('') : ''; a.push(v == null ? '' : v); } out.push(a); });
        return toObjs(out); }); });
      return file.text().then(function (t) { return toObjs(csvParse(t)); });
    };
    $('#imF').onchange = function () {
      var file = this.files[0]; rows = null; $('#imGo').disabled = true; if (!file) return;
      $('#imOut').innerHTML = '<p class="ask-think">Reading ' + esc(file.name) + '…</p>';
      read(file).then(function (r) { rows = r; if (!r.length) throw new Error('No rows found under the header row'); return api('pplImport', { rows: r, dry: true }); }).then(function (d) {
        var li = function (a) { return a.slice(0, 40).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + (a.length > 40 ? '<li class="muted">… and ' + (a.length - 40) + ' more</li>' : ''); };
        $('#imOut').innerHTML = '<div class="im-sum"><span class="ok">＋ ' + d.added.length + ' new</span><span>✎ ' + d.updated.length + ' to update</span><span class="muted">' + d.same + ' unchanged</span>' + (d.errors.length ? '<span class="bad">' + d.errors.length + ' with problems</span>' : '') + '</div>' +
          '<div style="max-height:40vh;overflow:auto">' + (d.added.length ? '<h3 class="im-h">New</h3><ul class="im-l">' + li(d.added) + '</ul>' : '') + (d.updated.length ? '<h3 class="im-h">Updates</h3><ul class="im-l">' + li(d.updated) + '</ul>' : '') +
          (d.errors.length ? '<h3 class="im-h">Problems (skipped)</h3><ul class="im-l bad">' + li(d.errors.map(function (e) { return 'Row ' + e.row + (e.name ? ' ' + e.name : '') + ': ' + e.error; })) + '</ul>' : '') + '</div>';
        $('#imGo').disabled = !(d.added.length || d.updated.length); $('#imGo').textContent = 'Import: ' + d.added.length + ' new, ' + d.updated.length + ' updates';
      }).catch(function (e) { $('#imOut').innerHTML = '<p class="bad">' + esc(e.message) + '</p>'; });
    };
    $('#imGo').onclick = function () { var b = this; b.disabled = true; api('pplImport', { rows: rows }).then(function (d) {
      M.closeModal(); toast('Imported: ' + d.added.length + ' added, ' + d.updated.length + ' updated' + (d.errors.length ? ', ' + d.errors.length + ' skipped' : '')); return load().then(draw);
    }).catch(function (e) { b.disabled = false; fail(e); }); };
  }
  function archiveDialog(p, then) {
    var arch = !p.archived;
    M.modal('<h2>' + (arch ? '🗄 Archive ' : '↩ Restore ') + esc(p.name) + '</h2><p class="muted" style="margin:-4px 0 10px">' + (arch ? 'They leave the lists, pickers and workload, and their login (if any) stops working straight away. Their record, tickets and history are kept, and their name stays on past project plans. You can restore them at any time.' : 'They come back into the lists and pickers. A login they had works again if it is still active in Users &amp; access.') + '</p>' +
      '<form class="form" id="arF"><label class="full">' + (arch ? 'Reason <small class="muted">(e.g. left the company, contract ended)</small>' : 'Reason <small class="muted">(optional)</small>') + '<input name="why" maxlength="200"' + (arch ? ' required' : '') + '></label>' +
      (arch ? '<label class="full">Finished on<input name="end" type="date" value="' + esc(p.end || new Date(Date.now() + 11 * 3600000).toISOString().slice(0, 10)) + '"></label>' : '') +
      '<div class="actions full"><button class="btn" data-close type="button">Cancel</button><button class="btn ' + (arch ? 'btn-danger' : 'btn-gold') + '" type="submit">' + (arch ? '🗄 Archive' : '↩ Restore') + '</button></div></form>');
    $('#arF').onsubmit = function (e) {
      e.preventDefault(); var f = this, o = Object.assign({}, p, { archived: arch }); if (arch && f.end) o.end = f.end.value;
      api('pplSave', { person: o, reason: f.why.value.trim() }).then(function () { M.closeModal(); toast(arch ? p.name + ' archived' : p.name + ' restored'); return load(); }).then(then || function () {}).catch(fail);
    };
  }
  function deleteDialog(p) {
    M.modal('<h2>🗑 Delete ' + esc(p.name) + ' permanently?</h2><p>This removes their record, tickets and history from People for good' + (loginOf(p.id) ? ', and their login' : '') + '. Their name stays on past project plans as text. <b>It cannot be undone.</b> Keeping them archived is usually better (for records and audits).</p>' +
      '<form class="form" id="dlF"><label class="full">Type their full name to confirm<input name="c" autocomplete="off" required></label><div class="actions full"><button class="btn" data-close type="button">Cancel</button><button class="btn btn-danger" type="submit" id="dlGo" disabled>Delete permanently</button></div></form>');
    $('#dlF').c.oninput = function () { $('#dlGo').disabled = this.value.trim().toLowerCase() !== p.name.toLowerCase(); };
    $('#dlF').onsubmit = function (e) { e.preventDefault(); api('pplDelete', { id: p.id, confirm: this.c.value.trim() }).then(function (r) { M.closeModal(); toast(r.name + ' deleted' + (r.logins ? ' (and their login)' : '')); return load(); }).then(function () { location.hash = '#people'; }).catch(fail); };
  }
  var BULK = [['status', '◐ Set status'], ['role', '🏷 Set role'], ['cost', '$ Cost rate'], ['charge', '$ Charge-out rate'], ['archive', '🗄 Archive'], ['restore', '↩ Restore']];
  function bulkDialog(op) {
    var ids = Object.keys(S.sel), d = S.data, names = d.people.filter(function (p) { return S.sel[p.id]; }).map(function (p) { return p.name; });
    var body = op === 'status' ? '<label class="full">New status<select name="v">' + d.statuses.map(function (s) { return '<option>' + s + '</option>'; }).join('') + '</select></label>'
      : op === 'role' ? '<label class="full">New role<input name="v" list="ppRoles2" required maxlength="60"></label><datalist id="ppRoles2">' + d.roles.map(function (r) { return '<option value="' + esc(r) + '">'; }).join('') + '</datalist>'
      : op === 'cost' || op === 'charge' ? '<div class="full est-opts"><label><input type="radio" name="m" value="pct" checked> <span><b>Change by a percentage</b> <small>e.g. 4 for a 4% pay rise, −10 to lower; people without a rate are skipped</small></span></label><label><input type="radio" name="m" value="set"> <span><b>Set to an amount</b> <small>the same $/hr for everyone selected</small></span></label></div><label class="full">' + (op === 'cost' ? 'Cost rate' : 'Charge-out rate') + ': % or $/hr<input name="v" type="number" step="any" required></label>'
      : '';
    var title = { status: 'Set the status', role: 'Set the role', cost: 'Change the cost rate', charge: 'Change the charge-out rate', archive: 'Archive', restore: 'Restore' }[op];
    M.modal('<h2>' + title + ' for ' + ids.length + ' ' + (ids.length === 1 ? 'person' : 'people') + '</h2><p class="muted" style="margin:-4px 0 10px">' + esc(names.slice(0, 12).join(', ') + (names.length > 12 ? ' and ' + (names.length - 12) + ' more' : '')) + '</p>' +
      (op === 'archive' ? '<p class="muted">Their logins stop working straight away. Records and history are kept.</p>' : '') +
      '<form class="form" id="bkF">' + body + '<label class="full">Reason <small class="muted">' + (op === 'archive' ? '' : '(optional) ') + 'kept in each person\'s history</small><input name="why" maxlength="200"' + (op === 'archive' ? ' required' : '') + '></label>' +
      '<div class="actions full"><button class="btn" data-close type="button">Cancel</button><button class="btn ' + (op === 'archive' ? 'btn-danger' : 'btn-gold') + '" type="submit">Apply to ' + ids.length + '</button></div></form>');
    $('#bkF').onsubmit = function (e) {
      e.preventDefault(); var f = this, val = f.v ? f.v.value : '';
      if (op === 'cost' || op === 'charge') val = { kind: op, mode: (f.querySelector('[name=m]:checked') || {}).value, n: parseFloat(val) };
      api('pplBulk', { ids: ids, op: op === 'cost' || op === 'charge' ? 'rate' : op, value: val, reason: f.why.value.trim() }).then(function (r) {
        M.closeModal(); S.sel = {}; toast(r.done.length + ' updated' + (r.skipped.length ? ', ' + r.skipped.length + ' unchanged or skipped' : '')); return load().then(draw);
      }).catch(fail);
    };
  }
  var TKEY = { 'White card': 'whiteCard', 'Trade licence': 'licence', 'First aid': 'firstAid', 'Working at heights': 'heights', 'Confined spaces': 'confined', 'EWP': 'ewp', 'Forklift': 'forklift', 'Asbestos awareness': 'asbestos', 'Driver\'s licence': 'driver' };
  function renewDialog(id, docName) {
    api('pplGet', { id: id }).then(function (r) {
      var p = r.person, k = TKEY[docName], ins = docName === 'Public liability', wc = docName === 'Workers comp', cur = k ? (p.tickets || {})[k] || {} : ins ? p.insurance || {} : p.workersComp || {};
      M.modal('<h2>↻ ' + esc(docName) + ': ' + esc(p.name) + '</h2><p class="muted" style="margin:-4px 0 10px">Record the renewed ' + esc(docName.toLowerCase()) + '. The old expiry goes into their history.</p>' +
        '<form class="form" id="rnF">' + (ins ? '<label>Insurer<input name="insurer" value="' + esc(cur.insurer || '') + '"></label>' : '') + '<label>' + (ins || wc ? 'Policy number' : 'Number') + '<input name="num" value="' + esc((ins || wc ? cur.policy : cur.number) || '') + '"></label>' +
        (k === 'whiteCard' ? '' : '<label>New expiry<input name="exp" type="date" required value="' + esc(cur.expiry || '') + '"></label>') +
        '<div class="actions full"><button class="btn" data-close type="button">Cancel</button><button class="btn btn-gold" type="submit">Save</button></div></form>');
      $('#rnF').onsubmit = function (e) {
        e.preventDefault(); var f = this, o = JSON.parse(JSON.stringify(p)), exp = f.exp ? f.exp.value : '';
        if (k) { o.tickets = o.tickets || {}; o.tickets[k] = Object.assign({}, o.tickets[k] || {}, { number: f.num.value.trim(), expiry: exp }); }
        else if (ins) o.insurance = Object.assign({}, o.insurance || {}, { insurer: f.insurer.value.trim(), policy: f.num.value.trim(), expiry: exp });
        else o.workersComp = Object.assign({}, o.workersComp || {}, { policy: f.num.value.trim(), expiry: exp });
        api('pplSave', { person: o, reason: 'renewed' }).then(function () { M.closeModal(); toast(docName + ' updated for ' + p.name); return load(); }).then(draw).catch(fail);
      };
    }).catch(fail);
  }
  new MutationObserver(function () { if ($('#modal').hidden) $('#modal .modal-card').classList.remove('sc-wide'); }).observe($('#modal'), { attributes: true, attributeFilter: ['hidden'] });
  // for the plans: names, roles and rates of the active people (resources, stakeholders, project manager, story owners)
  M.people = { load: load, list: function () { return S.data ? S.data.people.filter(function (p) { return !p.archived && p.status !== 'Inactive'; }) : []; } };
  M.addView('people', 'People', page, 'people');
  var tick = function () { if (!document.getElementById('app').hidden && M.allowed && M.allowed('people', 'view', ['projects', 'subbies', 'crm'])) load().catch(function () {}); };
  new MutationObserver(function () { if (!document.getElementById('app').hidden) setTimeout(tick, 400); }).observe(document.getElementById('app'), { attributes: true, attributeFilter: ['hidden'] });
  setTimeout(tick, 2000);
})();
