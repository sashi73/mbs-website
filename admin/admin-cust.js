/* MBS Console: Customers. Every enquiry is linked to a customer automatically (same phone + email = same customer;
   no email = phone only). List, customer page, map of Sydney, insights with ✨ AI analysis, and ✨ Ask AI questions. */
(function () {
  'use strict';
  var M = window.MBS; if (!M) return;
  var api = M.api, esc = M.esc, money = M.money, toast = M.toast, fail = M.fail, $ = M.$;
  var V = function () { return M.view(); };
  var C = { data: null, at: 0, tab: 'list', q: '', filter: 'all', sort: 'last', dir: -1, show: 200, metric: 'customers', mapFilter: 'all', analysis: null };
  var STAGE = { new: 'New enquiry', called: 'Called', quoted: 'Quoted', won: 'Job won', completed: 'Completed', invoiced: 'Invoiced', paid: 'Paid', lost: 'Lost' };
  var day = function (ms) { return ms ? new Date(ms).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Australia/Sydney' }) : ''; };
  var monthOf = function (ms) { var p = {}; new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit' }).formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; }); return p.year + '-' + p.month; };
  var pct = function (a, b) { return b ? Math.round(a / b * 100) : 0; };
  var phoneTxt = function (p) { return /^04\d{8}$/.test(p) ? p.replace(/^(\d{4})(\d{3})(\d{3})$/, '$1 $2 $3') : /^0\d{9}$/.test(p) ? p.replace(/^(\d{2})(\d{4})(\d{4})$/, '$1 $2 $3') : p; };
  var srcTxt = function (s) { s = String(s || '').toLowerCase(); return ({ 'website chat': 'Website chat / Mr. Fixit', 'website contact form': 'Website form', chat: 'Website chat / Mr. Fixit', web: 'Website form', website: 'Website form', phone: 'Phone', telegram: 'Telegram', console: 'Console', admin: 'Console', other: 'Other' })[s] || s; };
  function loadScript(src, test) { return test() ? Promise.resolve() : new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = function () { rej(new Error('Could not load ' + src)); }; document.head.appendChild(s); }); }
  function loadCss(href) { if (!document.querySelector('link[href="' + href + '"]')) { var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l); } }
  function load(force) {
    if (!force && C.data && Date.now() - C.at < 60000) return Promise.resolve(C.data);
    return api('custList').then(function (d) { C.data = d; C.at = Date.now(); return d; });
  }

  /* ---------- page with tabs ---------- */
  function page(args) {
    var tab = args && args[0] && ['list', 'map', 'insights', 'ask'].indexOf(args[0]) >= 0 ? args[0] : C.tab;
    C.tab = tab;
    $('#title').textContent = 'Customers';
    V().innerHTML = '<div class="row" style="margin-bottom:12px"><div class="tabs" id="custTabs" style="margin:0">' +
      [['list', '👥 Customers'], ['map', '🗺 Map'], ['insights', '📊 Insights'], ['ask', '✨ Ask AI']].map(function (t) { return '<a class="tab' + (tab === t[0] ? ' on' : '') + '" href="#customers/' + t[0] + '">' + t[1] + '</a>'; }).join('') +
      '</div><span class="sp"></span><button class="btn btn-sm" id="custRebuild" title="Link every job to its customer again (keeps names, notes and tags you edited)">↻ Rebuild from jobs</button></div><div id="custBody"><div class="empty">Loading…</div></div>';
    $('#custRebuild').onclick = function () {
      var b = this; b.disabled = true;
      api('custRebuild').then(function (r) { toast(r.customers + ' customers from ' + r.jobs + ' jobs'); return load(true); }).then(function () { b.disabled = false; draw(); }).catch(function (e) { b.disabled = false; fail(e); });
    };
    return load().then(draw);
  }
  function draw() {
    var B = $('#custBody'); if (!B || !C.data) return;
    if (C.tab === 'map') return mapTab(B);
    if (C.tab === 'insights') return insights(B);
    if (C.tab === 'ask') return askTab(B);
    return listTab(B);
  }

  /* ---------- list ---------- */
  var FILTERS = [['all', 'All'], ['repeat', 'Repeat (2+ enquiries)'], ['confirmed', 'Confirmed jobs'], ['quotes', 'Quotes waiting'], ['owing', 'Owing'], ['open', 'Open jobs'], ['lost', 'Lost only'], ['new', 'New this month']];
  function passes(c, f) {
    var m = monthOf(Date.now());
    return f === 'all' || (f === 'repeat' && c.enquiries > 1) || (f === 'confirmed' && c.confirmed > 0) || (f === 'quotes' && c.openQuotes > 0) || (f === 'owing' && c.owed > 0) ||
      (f === 'open' && c.open > 0) || (f === 'lost' && c.lost > 0 && c.confirmed === 0 && c.open === 0) || (f === 'new' && monthOf(c.first) === m);
  }
  var COLS = [['name', 'Customer'], ['suburb', 'Suburb'], ['enquiries', 'Enquiries'], ['confirmed', 'Confirmed jobs'], ['lost', 'Lost'], ['openQuotes', 'Quotes waiting'], ['value', 'Value'], ['paid', 'Paid'], ['owed', 'Owed'], ['first', 'Customer since'], ['last', 'Last contact']];
  function listTab(B) {
    var T = C.data.totals, q = C.q.toLowerCase().trim();
    var rows = C.data.customers.filter(function (c) { return passes(c, C.filter) && (!q || (c.id + ' ' + c.name + ' ' + c.phone + ' ' + c.email + ' ' + c.suburb + ' ' + (c.tags || []).join(' ')).toLowerCase().indexOf(q.replace(/\s+/g, ' ')) >= 0 || (q.replace(/\D/g, '').length >= 4 && c.phone.indexOf(q.replace(/\D/g, '')) >= 0)); });
    rows.sort(function (a, b) { var x = a[C.sort], y = b[C.sort]; if (typeof x === 'string') return C.dir * x.localeCompare(y); return C.dir * ((x || 0) - (y || 0)); });
    B.innerHTML = '<div class="grid kpis ckpis">' +
      kpi('Customers', T.customers, T.newThisMonth + ' new this month') + kpi('Repeat customers', T.repeat, pct(T.repeat, T.customers) + '% came back') +
      kpi('Became jobs', T.conversion + '%', T.withConfirmed + ' customers with a confirmed job') + kpi('Value of jobs', money(T.value), 'avg ' + money(T.avgValue) + ' per customer with jobs') +
      kpi('Quotes waiting', T.openQuotes, money(T.quotedValue)) + kpi('Owed', money(T.owed), 'invoiced, not paid') + '</div>' +
      '<div class="card" style="margin-top:14px"><div class="row" style="margin-bottom:10px"><input id="custQ" type="search" placeholder="Find a name, phone, email, suburb or tag…" value="' + esc(C.q) + '" style="max-width:340px">' +
      '<div class="chips">' + FILTERS.map(function (f) { return '<button class="chipf' + (C.filter === f[0] ? ' on' : '') + '" data-f="' + f[0] + '">' + f[1] + '</button>'; }).join('') + '</div><span class="sp"></span><span class="muted" style="font-size:13px">' + rows.length + ' shown</span></div>' +
      (rows.length ? '<div class="table-wrap"><table class="ctable"><thead><tr>' + COLS.map(function (c) { return '<th class="sortable' + (C.sort === c[0] ? ' on' : '') + (['enquiries', 'confirmed', 'lost', 'openQuotes', 'value', 'paid', 'owed'].indexOf(c[0]) >= 0 ? ' num' : '') + (['lost', 'paid', 'first'].indexOf(c[0]) >= 0 ? ' hide-sm' : '') + '" data-sort="' + c[0] + '">' + c[1] + (C.sort === c[0] ? (C.dir > 0 ? ' ▲' : ' ▼') : '') + '</th>'; }).join('') + '</tr></thead><tbody>' +
        rows.slice(0, C.show).map(function (c) {
          return '<tr class="click" data-cust="' + esc(c.id) + '"><td><b>' + esc(c.name) + '</b>' + (c.enquiries > 1 ? ' <span class="cbadge">repeat</span>' : '') + (c.tags || []).map(function (t) { return ' <span class="cbadge tag">' + esc(t) + '</span>'; }).join('') +
            '<br><small class="muted">' + esc(phoneTxt(c.phone)) + (c.email ? ' · ' + esc(c.email) : '') + '</small></td><td>' + esc((c.suburb || '').replace(/\s+NSW\b.*$/i, '')) + '</td>' +
            '<td class="num">' + c.enquiries + '</td><td class="num">' + (c.confirmed ? '<b>' + c.confirmed + '</b>' : '0') + '</td><td class="num hide-sm">' + c.lost + '</td><td class="num">' + (c.openQuotes ? '<b class="warn">' + c.openQuotes + '</b>' : '0') + '</td>' +
            '<td class="num">' + (c.value ? money(c.value) : '–') + '</td><td class="num hide-sm">' + (c.paid ? money(c.paid) : '–') + '</td><td class="num">' + (c.owed ? '<b class="bad">' + money(c.owed) + '</b>' : '–') + '</td>' +
            '<td class="hide-sm">' + esc(day(c.first)) + '</td><td>' + esc(day(c.last)) + '<br><small class="muted">' + esc(STAGE[c.lastStage] || '') + '</small></td></tr>';
        }).join('') + '</tbody></table></div>' + (rows.length > C.show ? '<p style="text-align:center"><button class="btn btn-sm" id="custMore">Show more (' + (rows.length - C.show) + ' more)</button></p>' : '')
        : '<div class="empty">' + (C.data.customers.length ? 'No customers match.' : 'No customers yet. They appear here automatically when enquiries come in.') + '</div>') + '</div>';
    var qi = $('#custQ'); qi.oninput = function () { C.q = this.value; var pos = this.selectionStart; listTab(B); var n = $('#custQ'); n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} };
    B.querySelectorAll('[data-f]').forEach(function (b) { b.onclick = function () { C.filter = b.getAttribute('data-f'); C.show = 200; listTab(B); }; });
    B.querySelectorAll('[data-sort]').forEach(function (th) { th.onclick = function () { var k = th.getAttribute('data-sort'); if (C.sort === k) C.dir = -C.dir; else { C.sort = k; C.dir = ['name', 'suburb'].indexOf(k) >= 0 ? 1 : -1; } listTab(B); }; });
    B.querySelectorAll('[data-cust]').forEach(function (tr) { tr.onclick = function () { location.hash = '#customer/' + tr.getAttribute('data-cust'); }; });
    var more = $('#custMore'); if (more) more.onclick = function () { C.show += 200; listTab(B); };
  }
  function kpi(k, v, s) { return '<div class="card kpi"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div><div class="s">' + esc(s) + '</div></div>'; }

  /* ---------- map of Sydney ---------- */
  var SUB = null;
  function suburbs() {
    if (SUB) return Promise.resolve(SUB);
    return fetch('../assets/suburbs-sydney.json').then(function (r) { return r.json(); }).then(function (j) {
      var byNP = {}, byN = {};
      (j.suburbs || []).forEach(function (s) { var n = s[0].toLowerCase(); byNP[n + '|' + s[1]] = s; if (!byN[n]) byN[n] = s; });
      SUB = { byNP: byNP, byN: byN }; return SUB;
    });
  }
  function place(text) {
    var t = String(text || '').trim(); if (!t || !SUB) return null;
    var pc = (t.match(/\b(2\d{3})\b/) || [])[1] || '';
    var name = t.replace(/,.*$/, '').replace(/\b(NSW|New South Wales|Australia)\b.*$/i, '').replace(/\b2\d{3}\b/, '').trim().toLowerCase();
    return SUB.byNP[name + '|' + pc] || SUB.byN[name] || null;
  }
  var METRICS = [['customers', 'Customers'], ['enquiries', 'Enquiries'], ['confirmed', 'Confirmed jobs'], ['value', 'Value ($)']];
  function mapTab(B) {
    B.innerHTML = '<div class="cmapwrap"><div class="card cmapcard"><div class="row" style="margin-bottom:8px"><label class="muted" style="display:flex;gap:6px;align-items:center;font-size:13px">Bubble size<select id="mapMetric" style="width:auto">' +
      METRICS.map(function (m) { return '<option value="' + m[0] + '"' + (C.metric === m[0] ? ' selected' : '') + '>' + m[1] + '</option>'; }).join('') + '</select></label>' +
      '<label class="muted" style="display:flex;gap:6px;align-items:center;font-size:13px">Show<select id="mapFilter" style="width:auto">' + [['all', 'All customers'], ['confirmed', 'Customers with confirmed jobs'], ['quotes', 'Quotes waiting'], ['open', 'Open jobs'], ['repeat', 'Repeat customers']].map(function (m) { return '<option value="' + m[0] + '"' + (C.mapFilter === m[0] ? ' selected' : '') + '>' + m[1] + '</option>'; }).join('') + '</select></label>' +
      '<span class="sp"></span><span class="muted" id="mapNote" style="font-size:12.5px"></span></div><div id="cmap" class="cmap"></div>' +
      '<div class="cmkey"><b>Colour = how many customers there became jobs:</b><span><i style="background:#15803D"></i>50% or more</span><span><i style="background:#D97706"></i>25–49%</span><span><i style="background:#C2410C"></i>under 25%</span><span><i style="background:#9CA3AF"></i>no confirmed jobs yet</span></div></div>' +
      '<div class="card cmapside"><h2>Top suburbs</h2><div id="mapTop"><div class="empty">Loading…</div></div></div></div>';
    loadCss('vendor/leaflet.css?v=194');
    Promise.all([loadScript('vendor/leaflet.js?v=194', function () { return !!window.L; }), suburbs()]).then(function () { drawMap(); }).catch(function (e) { $('#cmap').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
    $('#mapMetric').onchange = function () { C.metric = this.value; drawMap(); };
    $('#mapFilter').onchange = function () { C.mapFilter = this.value; drawMap(); };
  }
  var MAP = null, LAYER = null;
  function drawMap() {
    var el = $('#cmap'); if (!el || !window.L) return;
    if (!MAP || MAP.getContainer() !== el) {
      if (MAP) { try { MAP.remove(); } catch (e) {} }
      MAP = L.map(el, { scrollWheelZoom: true }).setView([-33.80, 151.0], 10);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(MAP);
      LAYER = null;
    }
    if (LAYER) LAYER.remove();
    LAYER = L.layerGroup().addTo(MAP);
    var groups = {}, missing = 0;
    C.data.customers.filter(function (c) { return passes(c, C.mapFilter); }).forEach(function (c) {
      var s = place(c.suburb); if (!s) { missing++; return; }
      var k = s[0] + '|' + s[1], g = groups[k] = groups[k] || { s: s, list: [], customers: 0, enquiries: 0, confirmed: 0, value: 0, withJob: 0 };
      g.list.push(c); g.customers++; g.enquiries += c.enquiries; g.confirmed += c.confirmed; g.value += c.value; if (c.confirmed) g.withJob++;
    });
    var all = Object.keys(groups).map(function (k) { return groups[k]; });
    var max = Math.max.apply(null, all.map(function (g) { return g[C.metric]; }).concat([1]));
    var pts = [];
    all.sort(function (a, b) { return b[C.metric] - a[C.metric]; }).forEach(function (g) {
      var conv = pct(g.withJob, g.customers), col = !g.withJob ? '#9CA3AF' : conv >= 50 ? '#15803D' : conv >= 25 ? '#D97706' : '#C2410C';
      var r = 6 + 22 * Math.sqrt(g[C.metric] / max);
      var m = L.circleMarker([g.s[2], g.s[3]], { radius: r, color: '#fff', weight: 1.5, fillColor: col, fillOpacity: 0.75 }).addTo(LAYER);
      m.bindTooltip(g.s[0] + ': ' + g.customers + ' customer' + (g.customers === 1 ? '' : 's'));
      m.bindPopup('<div class="cpop"><b>' + esc(g.s[0]) + ' ' + esc(g.s[1]) + '</b><br>' + g.customers + ' customers · ' + g.enquiries + ' enquiries · ' + g.confirmed + ' confirmed jobs (' + conv + '% became jobs)' + (g.value ? ' · ' + money(g.value) : '') +
        '<ul>' + g.list.sort(function (a, b) { return b.value - a.value || b.enquiries - a.enquiries; }).slice(0, 8).map(function (c) { return '<li><a href="#customer/' + esc(c.id) + '">' + esc(c.name) + '</a> <small>' + c.enquiries + ' enq · ' + c.confirmed + ' jobs' + (c.value ? ' · ' + money(c.value) : '') + '</small></li>'; }).join('') +
        (g.list.length > 8 ? '<li><small>and ' + (g.list.length - 8) + ' more</small></li>' : '') + '</ul></div>');
      pts.push([g.s[2], g.s[3]]);
    });
    if (pts.length > 1) MAP.fitBounds(pts, { padding: [30, 30], maxZoom: 12 }); else if (pts.length === 1) MAP.setView(pts[0], 12);
    setTimeout(function () { try { MAP.invalidateSize(); } catch (e) {} }, 50);
    $('#mapNote').textContent = all.length + ' suburb' + (all.length === 1 ? '' : 's') + (missing ? ' · ' + missing + ' customer' + (missing === 1 ? '' : 's') + ' not on the map (suburb not recognised)' : '');
    var top = all.slice(0, 12);
    $('#mapTop').innerHTML = top.length ? '<table class="mini"><thead><tr><th>Suburb</th><th class="num">Cust.</th><th class="num">Jobs</th><th class="num">Value</th></tr></thead><tbody>' + top.map(function (g) {
      return '<tr class="click" data-ll="' + g.s[2] + ',' + g.s[3] + '"><td>' + esc(g.s[0]) + '</td><td class="num">' + g.customers + '</td><td class="num">' + g.confirmed + '</td><td class="num">' + (g.value ? money(g.value).replace(/\.00$/, '') : '–') + '</td></tr>'; }).join('') + '</tbody></table>' : '<div class="empty">No customers to show.</div>';
    $('#mapTop').querySelectorAll('[data-ll]').forEach(function (tr) { tr.onclick = function () { var a = tr.getAttribute('data-ll').split(',').map(Number); MAP.setView(a, 13); LAYER.eachLayer(function (l) { var p = l.getLatLng(); if (Math.abs(p.lat - a[0]) < 1e-6 && Math.abs(p.lng - a[1]) < 1e-6) l.openPopup(); }); }; });
  }

  /* ---------- insights ---------- */
  var charts = [];
  function insights(B) {
    var d = C.data, T = d.totals, L2 = d.customers, F = T.funnel;
    var top = function (k, n, f) { return L2.filter(f || function (c) { return c[k] > 0; }).sort(function (a, b) { return b[k] - a[k] || b.value - a.value; }).slice(0, n || 10); };
    var tbl = function (list, cols) {
      return list.length ? '<table class="mini"><tbody>' + list.map(function (c) { return '<tr class="click" data-cust="' + esc(c.id) + '"><td><b>' + esc(c.name) + '</b><br><small class="muted">' + esc((c.suburb || '').replace(/\s+NSW\b.*$/i, '')) + '</small></td>' + cols.map(function (x) { return '<td class="num">' + x(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>' : '<div class="empty" style="padding:10px">None</div>';
    };
    var now = Date.now(), lapsed = L2.filter(function (c) { return c.confirmed > 0 && c.open === 0 && c.last < now - 365 * 864e5; });
    var fun = [['Enquiries', F.enquiries], ['Quoted', F.quoted], ['Won', F.won], ['Paid', F.paid]];
    B.innerHTML = '<div class="grid kpis ckpis">' +
      kpi('Customers', T.customers, T.newThisMonth + ' new this month') + kpi('Repeat customers', pct(T.repeat, T.customers) + '%', T.repeat + ' with 2+ enquiries · ' + T.repeatConfirmed + ' with 2+ jobs') +
      kpi('Customers who became jobs', T.conversion + '%', T.withConfirmed + ' of ' + T.customers) + kpi('Average value', money(T.avgValue), 'per customer with jobs') +
      kpi('Quotes waiting', money(T.quotedValue), T.openQuotes + ' quote' + (T.openQuotes === 1 ? '' : 's')) + kpi('To win back', lapsed.length, 'had jobs, quiet for a year') + '</div>' +
      '<div class="card cai" style="margin-top:14px"><div class="card-h"><h2>✨ AI analysis</h2><button class="btn btn-gold btn-sm" id="custAi">' + (C.analysis ? '↻ Analyse again' : '✨ Analyse my customers') + '</button></div>' +
        '<div id="custAiOut">' + (C.analysis ? aiHtml(C.analysis) : '<p class="muted" style="margin:0">A short written analysis with recommendations. Only totals go to the AI (DeepSeek): no names, phone numbers or emails.</p>') + '</div></div>' +
      '<div class="grid two" style="margin-top:14px">' +
        '<div class="card"><h2>From enquiry to paid</h2><div class="funnel">' + fun.map(function (f, i) { return '<div class="fn"><span>' + f[0] + '</span><div class="fbar"><i style="width:' + Math.max(2, pct(f[1], F.enquiries)) + '%"></i></div><b>' + f[1] + '</b><small>' + (i ? pct(f[1], fun[i - 1][1]) + '% of ' + fun[i - 1][0].toLowerCase() : '') + '</small></div>'; }).join('') +
          '</div><p class="muted" style="font-size:12.5px;margin:8px 0 0">' + F.lost + ' enquir' + (F.lost === 1 ? 'y' : 'ies') + ' lost.</p></div>' +
        '<div class="card"><h2>New customers per month</h2><div class="cchart"><canvas id="chMonths"></canvas></div></div>' +
        '<div class="card"><h2>Top suburbs</h2><div class="cchart"><canvas id="chSubs"></canvas></div></div>' +
        '<div class="card"><h2>Where customers come from</h2><div class="cchart"><canvas id="chSrc"></canvas></div></div>' +
        '<div class="card"><h2>Most orders (confirmed jobs)</h2>' + tbl(top('confirmed'), [function (c) { return '<b>' + c.confirmed + '</b> job' + (c.confirmed === 1 ? '' : 's'); }, function (c) { return money(c.value); }]) + '</div>' +
        '<div class="card"><h2>Biggest customers by value</h2>' + tbl(top('value'), [function (c) { return money(c.value); }, function (c) { return c.owed ? '<b class="bad">owes ' + money(c.owed) + '</b>' : c.paid ? 'paid ' + money(c.paid) : ''; }]) + '</div>' +
        '<div class="card"><h2>Quotes waiting: follow up</h2>' + tbl(top('quotedValue', 10, function (c) { return c.openQuotes > 0; }), [function (c) { return c.openQuotes + ' quote' + (c.openQuotes === 1 ? '' : 's'); }, function (c) { return money(c.quotedValue); }]) + '</div>' +
        '<div class="card"><h2>Owing money</h2>' + tbl(top('owed'), [function (c) { return '<b class="bad">' + money(c.owed) + '</b>'; }]) + '</div>' +
        '<div class="card"><h2>Most enquiries (repeat customers)</h2>' + tbl(top('enquiries', 10, function (c) { return c.enquiries > 1; }), [function (c) { return c.enquiries + ' enquiries'; }, function (c) { return c.confirmed + ' job' + (c.confirmed === 1 ? '' : 's'); }]) + '</div>' +
        '<div class="card"><h2>To win back</h2><p class="muted" style="font-size:12.5px;margin:-4px 0 8px">Had jobs with you, nothing open, no contact for over a year.</p>' + tbl(lapsed.sort(function (a, b) { return b.value - a.value; }).slice(0, 10), [function (c) { return 'last ' + esc(day(c.last)); }, function (c) { return money(c.value); }]) + '</div>' +
      '</div>';
    B.querySelectorAll('[data-cust]').forEach(function (tr) { tr.onclick = function () { location.hash = '#customer/' + tr.getAttribute('data-cust'); }; });
    $('#custAi').onclick = function () {
      var b = this; b.disabled = true; b.textContent = 'Analysing…';
      $('#custAiOut').innerHTML = '<p class="ask-think" style="margin:0">The AI is reading your customer figures…</p>';
      api('custAnalyse').then(function (r) { C.analysis = r; $('#custAiOut').innerHTML = aiHtml(r); b.textContent = '↻ Analyse again'; })
        .catch(function (e) { $('#custAiOut').innerHTML = '<p class="bad" style="margin:0">' + esc(e.message) + '</p>'; b.textContent = '✨ Analyse my customers'; }).then(function () { b.disabled = false; });
    };
    loadScript('vendor/chart.umd.min.js?v=451', function () { return !!window.Chart; }).then(function () { drawCharts(L2); }).catch(function () {});
  }
  function aiHtml(r) {
    return '<p style="margin:0 0 8px">' + esc(r.summary) + '</p><div class="grid two" style="gap:12px"><div><b>What stands out</b><ul>' + r.insights.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>' +
      '<div><b>What to do</b><ul>' + r.recommendations.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div></div>' + (r.tokens ? '<small class="muted">Used about ' + r.tokens.toLocaleString('en-AU') + ' tokens.</small>' : '');
  }
  function drawCharts(list) {
    charts.forEach(function (c) { try { c.destroy(); } catch (e) {} }); charts = [];
    if (!$('#chMonths')) return;
    var months = [], now = new Date();
    for (var i = 11; i >= 0; i--) { var dt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 15)); months.push(dt.toISOString().slice(0, 7)); }
    var mc = months.map(function (m) { return list.filter(function (c) { return monthOf(c.first) === m; }).length; });
    var lab = months.map(function (m) { return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m.slice(5) - 1] + ' ' + m.slice(2, 4); });
    var opts = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } };
    charts.push(new Chart($('#chMonths'), { type: 'bar', data: { labels: lab, datasets: [{ label: 'New customers', data: mc, backgroundColor: '#C9A227', borderRadius: 4 }] }, options: opts }));
    var subs = {}; list.forEach(function (c) { var s = (c.suburb || 'Unknown').replace(/\s+NSW\b.*$/i, '') || 'Unknown'; var g = subs[s] = subs[s] || { n: 0, j: 0 }; g.n++; if (c.confirmed) g.j++; });
    var st = Object.keys(subs).sort(function (a, b) { return subs[b].n - subs[a].n; }).slice(0, 10);
    charts.push(new Chart($('#chSubs'), { type: 'bar', data: { labels: st, datasets: [{ label: 'Customers', data: st.map(function (s) { return subs[s].n; }), backgroundColor: '#1B2A41', borderRadius: 4 }, { label: 'With confirmed jobs', data: st.map(function (s) { return subs[s].j; }), backgroundColor: '#15803D', borderRadius: 4 }] },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } } }));
    var src = {}; list.forEach(function (c) { Object.keys(c.sources || {}).forEach(function (k) { src[k] = (src[k] || 0) + c.sources[k]; }); });
    var sk = Object.keys(src).sort(function (a, b) { return src[b] - src[a]; });
    charts.push(new Chart($('#chSrc'), { type: 'doughnut', data: { labels: sk.map(srcTxt), datasets: [{ data: sk.map(function (k) { return src[k]; }), backgroundColor: ['#C9A227', '#1B2A41', '#15803D', '#6366F1', '#C2410C', '#0EA5E9', '#9CA3AF'] }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } } } }));
  }

  /* ---------- ✨ Ask AI (runs on the AI query) ---------- */
  var QUESTIONS = ['Which customers have the most orders?', 'Who are my top 10 customers by total value?', 'Which suburbs have the most customers?', 'Which suburbs have the most confirmed jobs?',
    'How many repeat customers do I have?', 'What percentage of customers became a confirmed job?', 'Which customers have quotes waiting for an answer?', 'Which customers owe me money?',
    'How many new customers did I get each month this year?', 'Which customers had a job but no contact for over a year?', 'Where do my customers come from (website, phone, Mr. Fixit)?', 'Average value of a customer\'s jobs by suburb'];
  function askTab(B) {
    B.innerHTML = '<div class="card"><div class="card-h"><h2>✨ Ask AI about your customers</h2></div><p class="muted" style="margin:-4px 0 12px">Pick a common question or type your own. It runs on the AI query: the AI writes the query, it runs on your data here, then you get a plain-English answer, a table and a chart.</p>' +
      '<form class="askbar" id="custAskForm"><input id="custAskQ" maxlength="400" placeholder="e.g. Which customers in Box Hill have had more than one job?"><button class="btn btn-gold" type="submit">Ask</button></form>' +
      '<div class="ask-ex">' + QUESTIONS.map(function (q) { return '<button type="button" class="chipq" data-q="' + esc(q) + '">' + esc(q) + '</button>'; }).join('') + '</div>' +
      '<p class="muted" style="font-size:12px;margin:12px 0 0">The AI never sees names, phone numbers or emails: only table and column names to write the query, and the results with contact details removed to word the answer.</p></div>';
    var go = function (q) { q = String(q || '').trim(); if (!q) return toast('Type a question first', true); if (!M.askAI) return toast('The AI query is not available', true); M.askAI(q); };
    $('#custAskForm').onsubmit = function (e) { e.preventDefault(); go($('#custAskQ').value); };
    B.querySelectorAll('[data-q]').forEach(function (b) { b.onclick = function () { go(b.getAttribute('data-q')); }; });
  }

  /* ---------- one customer ---------- */
  function customerView(args) {
    var id = args[0];
    $('#title').textContent = 'Customer';
    return api('custGet', { id: id }).then(function (d) {
      var c = d.customer, s = d.stats;
      V().innerHTML = '<div class="row" style="margin-bottom:12px"><a class="btn btn-sm" href="#customers/list">← Customers</a><h2 style="font-size:22px">' + esc(c.name || 'Customer') + '</h2><span class="ref">' + esc(c.id) + '</span>' + (s.enquiries > 1 ? '<span class="cbadge">repeat customer</span>' : '') + '</div>' +
        '<div class="grid kpis ckpis">' + kpi('Enquiries', s.enquiries, s.open + ' open') + kpi('Confirmed jobs', s.confirmed, s.lost + ' lost') + kpi('Value of jobs', money(s.value), 'inc GST') +
          kpi('Paid', money(s.paid), s.owed ? 'owes ' + money(s.owed) : 'nothing owed') + kpi('Quotes waiting', s.openQuotes, money(s.quotedValue)) + kpi('Customer since', day(s.first), 'last contact ' + day(s.last)) + '</div>' +
        '<div class="grid two" style="margin-top:14px"><div class="card"><h2>Jobs (' + d.jobs.length + ')</h2>' +
          (d.jobs.length ? '<div class="table-wrap"><table><thead><tr><th>Job</th><th>What</th><th>Stage</th><th class="num">Value</th><th class="hide-sm">Date</th></tr></thead><tbody>' + d.jobs.map(function (j) {
            return '<tr class="click" data-job="' + esc(j.core) + '"><td class="ref">' + esc(j.ref) + '</td><td>' + esc(j.title) + (j.plan ? ' <a class="cbadge" href="#plan/' + esc(j.core) + '">📅 plan</a>' : '') + '<br><small class="muted">' + esc((j.suburb || '').replace(/\s+NSW\b.*$/i, '')) + ' · ' + esc(srcTxt(j.source || 'other')) + '</small></td>' +
              '<td>' + (M.chip ? M.chip(j.stage) : esc(STAGE[j.stage] || j.stage)) + '</td><td class="num">' + (j.value ? money(j.value) + '<br><small class="muted">' + (j.valueKind === 'invoice' ? 'invoiced' : 'quoted') + '</small>' : '–') + '</td><td class="hide-sm">' + esc(day(j.created)) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="empty">No jobs linked.</div>') + '</div>' +
          '<div class="card"><h2>Contact &amp; notes</h2><dl class="kv">' +
            '<dt>Phone</dt><dd>' + (c.phone ? '<a href="tel:' + esc(c.phone) + '">' + esc(phoneTxt(c.phone)) + '</a>' : '–') + '</dd><dt>Email</dt><dd>' + (c.email ? '<a href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a>' : '–') + '</dd>' +
            '<dt>Came from</dt><dd>' + esc(Object.keys(c.sources || {}).map(function (k) { return srcTxt(k) + ' (' + c.sources[k] + ')'; }).join(', ') || '–') + '</dd></dl>' +
            '<p class="muted" style="font-size:12px;margin:4px 0 10px">Phone and email come from the enquiries and identify the customer (same phone + email = same customer).</p>' +
            '<form id="custForm" class="form"><label>Name<input name="name" value="' + esc(c.name) + '" maxlength="120"></label><label>Suburb<input name="suburb" value="' + esc(c.suburb) + '" maxlength="80"></label>' +
            '<label class="full">Tags <small class="muted">(comma between them, e.g. strata, VIP, landlord)</small><input name="tags" value="' + esc((c.tags || []).join(', ')) + '"></label>' +
            '<label class="full">Notes<textarea name="notes" rows="4" maxlength="3000">' + esc(c.notes) + '</textarea></label><div class="full"><button class="btn btn-gold btn-sm">Save</button></div></form></div></div>';
      V().querySelectorAll('[data-job]').forEach(function (tr) { tr.onclick = function (e) { if (e.target.closest('a')) return; location.hash = '#job/' + tr.getAttribute('data-job'); }; });
      $('#custForm').onsubmit = function (e) {
        e.preventDefault(); var f = e.target;
        api('custSave', { id: c.id, name: f.name.value, suburb: f.suburb.value, tags: f.tags.value, notes: f.notes.value }).then(function () { toast('Customer saved'); C.data = null; customerView([c.id]); }).catch(fail);
      };
    });
  }

  /* ---------- on the job page: who the customer is ---------- */
  M.onJob(function (j) {
    var col = V().querySelectorAll('.grid.two > .grid')[1] || V().querySelector('.grid.two > .grid'); if (!col) return;
    var box = document.createElement('div'); box.className = 'card'; box.id = 'jobCust';
    box.innerHTML = '<div class="card-h"><h2>Customer</h2></div><div class="empty" style="padding:8px">Loading…</div>';
    col.insertBefore(box, col.firstChild);
    api('custFor', { core: j.core }).then(function (d) {
      var c = d.customer;
      if (!c) { box.innerHTML = '<div class="card-h"><h2>Customer</h2></div><p class="muted" style="margin:0">No phone or email on this job, so it is not linked to a customer.</p>'; return; }
      box.innerHTML = '<div class="card-h"><h2>Customer</h2><a class="btn btn-sm" href="#customer/' + esc(c.id) + '">View customer →</a></div><b>' + esc(c.name) + '</b> <span class="ref">' + esc(c.id) + '</span>' + (c.enquiries > 1 ? ' <span class="cbadge">repeat customer</span>' : '') +
        '<p style="margin:6px 0 0;font-size:13.5px">' + c.enquiries + ' enquir' + (c.enquiries === 1 ? 'y' : 'ies') + ' · ' + c.confirmed + ' confirmed job' + (c.confirmed === 1 ? '' : 's') + (c.value ? ' · ' + money(c.value) : '') + (c.owed ? ' · <b class="bad">owes ' + money(c.owed) + '</b>' : '') + ' · customer since ' + esc(day(c.first)) + '</p>';
    }).catch(function () { box.remove(); });
  });

  M.addView('customers', 'Customers', page);
  M.addView('customer', 'Customer', customerView, 'customers');
  window.MBS.custState = C;   // for tests
})();
