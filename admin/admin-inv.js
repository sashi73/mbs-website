/* MBS Console: inventory (stock items + supplier quotes) and suppliers.
   Low stock: the console asks whether to call or email the supplier; the AI can write the re-order email. */
(function () {
  'use strict';
  var M = window.MBS; if (!M) return;
  var api = M.api, esc = M.esc, money = M.money, toast = M.toast, fail = M.fail, $ = M.$;
  var V = function () { return M.view(); };
  var S = { tab: 'items', q: '', cat: '', lowOnly: false, showArchived: false, data: null, queue: [] };
  var UNITS = ['each', 'box', 'bag', 'L', 'kg', 'm', 'm²', 'm³', 'roll', 'sheet', 'tube', 'pack', 'tin', 'pair', 'set'];
  var num = function (v) { return Math.round((Number(v) || 0) * 1000) / 1000; };
  var fmtQ = function (n) { return (Math.round((Number(n) || 0) * 1000) / 1000).toLocaleString('en-AU'); };
  function today() { var o = {}; new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).forEach(function (p) { o[p.type] = p.value; }); return o.year + '-' + o.month + '-' + o.day; }
  var chip = function (st) { return '<span class="ichip ichip-' + (st === 'on order' ? 'order' : st) + '">' + (st === 'low' ? 'Low' : st === 'on order' ? 'On order' : st === 'archived' ? 'Archived' : 'OK') + '</span>'; };

  function load() { return api('invList').then(function (d) { S.data = d; badge(d); return d; }); }
  function badge(d) {
    var n = (d.items || []).filter(function (i) { return i.low && !i.archived; }).length;
    var a = document.querySelector('[data-nav=inventory]'); if (!a) return;
    var b = a.querySelector('.nbadge'); if (!b) { b = document.createElement('b'); b.className = 'nbadge'; a.appendChild(b); }
    b.textContent = n; b.hidden = !n; b.title = n + ' item' + (n === 1 ? '' : 's') + ' low on stock';
  }
  function supById(id) { return ((S.data && S.data.suppliers) || []).filter(function (s) { return s.id === id; })[0]; }

  /* ---------- pages ---------- */
  function page(args) {
    if (args && ['suppliers', 'insights', 'map'].indexOf(args[0]) >= 0) S.tab = args[0];
    else if (args && args[0]) S.tab = 'items';
    return load().then(function () { draw(); if (args && /^I-\d+$/.test(args[0] || '')) editItem(args[0]); });
  }
  function navOn() { document.querySelectorAll('[data-nav]').forEach(function (n) { var k = n.getAttribute('data-nav'); if (k === 'inventory' || k === 'suppliers') n.classList.toggle('on', k === (S.tab === 'suppliers' ? 'suppliers' : 'inventory')); }); }
  function draw() {
    navOn();
    var d = S.data, low = d.items.filter(function (i) { return i.low && !i.archived; });
    V().innerHTML = '<div class="row" style="margin-bottom:12px"><div class="tabs" style="margin:0">' +
        '<button class="tab' + (S.tab === 'items' ? ' on' : '') + '" data-itab="items">📦 Stock items <b>' + d.items.filter(function (i) { return !i.archived; }).length + '</b></button>' +
        '<button class="tab' + (S.tab === 'suppliers' ? ' on' : '') + '" data-itab="suppliers">🏭 Suppliers <b>' + d.suppliers.filter(function (s) { return !s.archived; }).length + '</b></button>' +
        '<button class="tab' + (S.tab === 'insights' ? ' on' : '') + '" data-itab="insights">📊 Insights</button>' +
        '<button class="tab' + (S.tab === 'map' ? ' on' : '') + '" data-itab="map">🗺 Map</button></div><span class="sp"></span>' +
        '<button class="btn btn-sm" id="newSup">＋ Supplier</button><button class="btn btn-sm btn-gold" id="newItem">＋ Stock item</button></div>' +
      (low.length ? '<div class="lowbar"><b>⚠️ ' + low.length + ' item' + (low.length === 1 ? ' is' : 's are') + ' low on stock:</b> ' + low.slice(0, 6).map(function (i) { return '<button class="btn btn-sm" data-reorder="' + esc(i.id) + '">' + esc(i.name) + ' (' + fmtQ(i.available) + ' ' + esc(i.unit) + ')</button>'; }).join(' ') + ' <span class="muted">Tap one to call or email the supplier.</span></div>' : '') +
      '<div class="card" id="invBody"></div>';
    V().querySelectorAll('[data-itab]').forEach(function (b) { b.onclick = function () { S.tab = b.getAttribute('data-itab'); history.replaceState(null, '', S.tab === 'items' ? '#inventory' : '#inventory/' + S.tab); navOn(); draw(); }; });
    $('#newItem').onclick = function () { editItem(null); };
    $('#newSup').onclick = function () { editSupplier(null); };
    V().querySelectorAll('.lowbar [data-reorder]').forEach(function (b) { b.onclick = function () { reorder(b.getAttribute('data-reorder'), true); }; });
    if (S.tab === 'suppliers') suppliersTab(); else if (S.tab === 'insights') insightsTab(); else if (S.tab === 'map') mapTab(); else itemsTab();
  }

  /* ---------- v44: 📊 Insights (stock and suppliers) and 🗺 Map ---------- */
  var esc2 = esc, money2 = function (n) { return M.money ? M.money(n) : '$' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  function loadScript(src, test) { return test() ? Promise.resolve() : new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = function () { rej(new Error('Could not load ' + src)); }; document.head.appendChild(s); }); }
  function loadCss(href) { if (!document.querySelector('link[href="' + href + '"]')) { var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l); } }
  function insightsData(force) { if (S.ins && !force && Date.now() - S.insAt < 60000) return Promise.resolve(S.ins); return api('invInsights').then(function (d) { S.ins = d; S.insAt = Date.now(); return d; }); }
  function ikpi(k, v, s, cls) { return '<div class="card kpi' + (cls ? ' ' + cls : '') + '"><div class="k">' + esc2(k) + '</div><div class="v">' + esc2(v) + '</div><div class="s">' + esc2(s) + '</div></div>'; }
  function itbl(list, cols, empty) {
    if (!list.length) return '<p class="muted" style="margin:0">' + (empty || 'Nothing here.') + '</p>';
    return '<table class="mini"><tbody>' + list.map(function (r) { return '<tr' + (r.id ? ' class="click" data-iid="' + esc2(r.id) + '"' : '') + '>' + cols.map(function (c, i) { return '<td' + (i ? ' class="num"' : '') + '>' + c(r) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>';
  }
  var nm = function (r) { return '<b>' + esc2(r.name) + '</b><br><small class="muted">' + esc2(r.category || '') + (r.location ? ' · ' + esc2(r.location) : '') + '</small>'; };
  function insightsTab() {
    var B = $('#invBody'); B.innerHTML = '<div class="empty">Working out the figures…</div>';
    insightsData(true).then(function (I) {
      var T = I.totals;
      B.innerHTML = '<div class="grid kpis ckpis">' +
          ikpi('Stock value', money2(T.value), T.items + ' items · ' + T.suppliers + ' suppliers') +
          ikpi('Used in the last 90 days', money2(T.used90), 'at today\'s prices') +
          ikpi('Running low', T.low, T.onOrder + ' on order' + (T.overdue ? ' · ' + T.overdue + ' overdue' : ''), T.low ? 'kpi-warn' : '') +
          ikpi('Dead stock', money2(T.deadValue), T.dead + ' items not used for 4 months') +
          ikpi('Cheaper elsewhere', money2(T.savingYear), 'a year, from better prices on file') +
          ikpi('Biggest supplier', T.topShare + '%', 'of what you used in 6 months' + (T.noEmail ? ' · ' + T.noEmail + ' suppliers without email' : '')) + '</div>' +
        '<div class="card cai" style="margin-top:14px"><div class="card-h"><h2>✨ AI analysis</h2><button class="btn btn-gold btn-sm" id="invAi">' + (S.ai ? '↻ Analyse again' : '✨ Analyse my stock and suppliers') + '</button></div>' +
          '<div id="invAiOut">' + (S.ai ? aiHtml(S.ai) : '<p class="muted" style="margin:0">A short written analysis with what to re-order, what to stop buying and which suppliers to talk to. Only the stock and supplier figures go to the AI (DeepSeek).</p>') + '</div></div>' +
        '<div class="grid two" style="margin-top:14px">' +
          '<div class="card"><h2>Stock used per month</h2><div class="cchart"><canvas id="chInvMonths"></canvas></div></div>' +
          '<div class="card"><h2>Stock value by category</h2><div class="cchart"><canvas id="chInvCats"></canvas></div></div>' +
          '<div class="card"><h2>⚠️ Running low (re-order now)</h2><p class="muted" style="font-size:12.5px;margin:-4px 0 8px">Low, or less than 3 weeks left at the current rate of use.</p>' +
            itbl(I.atRisk, [nm, function (r) { return '<b>' + r.available + '</b> ' + esc2(r.unit) + '<br><small class="muted">re-order at ' + r.reorderLevel + '</small>'; }, function (r) { return r.cover == null ? '<small class="muted">no recent use</small>' : '<b' + (r.cover < 14 ? ' class="bad"' : '') + '>' + r.cover + ' day' + (r.cover === 1 ? '' : 's') + '</b><br><small class="muted">left</small>'; }], 'Nothing is running low.') + '</div>' +
          '<div class="card"><h2>🚀 Fast movers (90 days)</h2>' + itbl(I.fast, [nm, function (r) { return r.used90 + ' ' + esc2(r.unit); }, function (r) { return money2(r.usedValue90); }]) + '</div>' +
          '<div class="card"><h2>💤 Dead stock (cash tied up)</h2><p class="muted" style="font-size:12.5px;margin:-4px 0 8px">In stock, not used for over 4 months.</p>' + itbl(I.dead, [nm, function (r) { return r.onHand + ' ' + esc2(r.unit); }, function (r) { return '<b>' + money2(r.value) + '</b>'; }], 'No dead stock.') + '</div>' +
          '<div class="card"><h2>📦 Over-stocked (more than a year left)</h2>' + itbl(I.over, [nm, function (r) { return r.cover + ' days'; }, function (r) { return money2(r.value); }], 'Nothing is over-stocked.') + '</div>' +
          '<div class="card"><h2>💲 Cheaper elsewhere</h2><p class="muted" style="font-size:12.5px;margin:-4px 0 8px">A current quote from another supplier beats your preferred one.</p>' + itbl(I.savings, [nm, function (r) { return esc2(r.toName) + '<br><small class="muted">instead of ' + esc2(r.fromName) + '</small>'; }, function (r) { return '<b>' + money2(r.saving.year) + '</b><br><small class="muted">a year</small>'; }], 'Your preferred suppliers are the cheapest on file.') + '</div>' +
          '<div class="card"><h2>🏭 Suppliers by use (6 months)</h2>' + itbl(I.suppliers.slice(0, 12), [function (s) { return '<b>' + esc2(s.name) + '</b><br><small class="muted">' + esc2(s.terms || '') + (s.email ? '' : ' · <span class="bad">no email</span>') + '</small>'; }, function (s) { return s.items + ' items'; }, function (s) { return '<b>' + money2(s.spend180) + '</b>'; }]) + '</div>' +
          '<div class="card"><h2>🚚 On order</h2>' + itbl(I.orders, [function (o) { return '<b>' + esc2(o.name) + '</b><br><small class="muted">' + esc2(o.supplier) + '</small>'; }, function (o) { return o.qty + ' ' + esc2(o.unit); }, function (o) { return o.expected ? '<span' + (o.overdue ? ' class="bad"' : '') + '>' + (o.overdue ? 'overdue: ' : 'due ') + esc2(o.expected.split('-').reverse().join('/')) + '</span>' : '–'; }], 'Nothing on order.') + '</div>' +
          '<div class="card"><h2>📅 Supplier quotes ending in 30 days</h2>' + itbl(I.expiring, [function (r) { return '<b>' + esc2(r.name) + '</b>'; }, function (r) { return r.quotes.map(function (q) { return esc2(q.name) + ' ' + money2(q.price) + ' until ' + esc2(q.until.split('-').reverse().join('/')); }).join('<br>'); }], 'No quotes ending soon.') + (T.expired ? '<p class="muted" style="font-size:12.5px;margin:8px 0 0">' + T.expired + ' items also have a quote that has already ended: ask for new prices.</p>' : '') + '</div>' +
        '</div>';
      B.querySelectorAll('[data-iid]').forEach(function (tr) { tr.onclick = function () { editItem(tr.getAttribute('data-iid')); }; });
      $('#invAi').onclick = function () {
        var b = this; b.disabled = true; b.textContent = 'Analysing…';
        $('#invAiOut').innerHTML = '<p class="ask-think" style="margin:0">The AI is reading your stock and supplier figures…</p>';
        api('invAnalyse').then(function (r) { S.ai = r; $('#invAiOut').innerHTML = aiHtml(r); b.textContent = '↻ Analyse again'; })
          .catch(function (e) { $('#invAiOut').innerHTML = '<p class="bad" style="margin:0">' + esc2(e.message) + '</p>'; b.textContent = '✨ Analyse my stock and suppliers'; }).then(function () { b.disabled = false; });
      };
      loadScript('vendor/chart.umd.min.js?v=451', function () { return !!window.Chart; }).then(function () { invCharts(I); }).catch(function () {});
    }).catch(function (e) { B.innerHTML = '<div class="empty bad">' + esc2(e.message) + '</div>'; });
  }
  function aiHtml(r) {
    return '<p style="margin:0 0 8px">' + esc2(r.summary) + '</p><div class="grid two" style="gap:12px"><div><b>What stands out</b><ul>' + r.insights.map(function (x) { return '<li>' + esc2(x) + '</li>'; }).join('') + '</ul></div>' +
      '<div><b>What to do</b><ul>' + r.recommendations.map(function (x) { return '<li>' + esc2(x) + '</li>'; }).join('') + '</ul></div></div>' + (r.tokens ? '<small class="muted">Used about ' + r.tokens.toLocaleString('en-AU') + ' tokens.</small>' : '');
  }
  var CH = [];
  function invCharts(I) {
    CH.forEach(function (c) { try { c.destroy(); } catch (e) {} }); CH = [];
    var mk = Object.keys(I.months), m1 = document.getElementById('chInvMonths'), m2 = document.getElementById('chInvCats');
    var lab = function (k) { var a = k.split('-'); return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+a[1] - 1] + ' ' + a[0].slice(2); };
    if (m1) CH.push(new Chart(m1, { type: 'bar', data: { labels: mk.map(lab), datasets: [{ label: 'Stock used ($)', data: mk.map(function (k) { return I.months[k]; }), backgroundColor: '#C9A227' }] }, options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: function (v) { return '$' + v.toLocaleString('en-AU'); } } } } } }));
    var cats = I.categories.slice(0, 15);
    if (m2) CH.push(new Chart(m2, { type: 'bar', data: { labels: cats.map(function (c) { return c.category; }), datasets: [{ label: 'Stock value ($)', data: cats.map(function (c) { return c.value; }), backgroundColor: '#1F2937' }, { label: 'Used in 90 days ($)', data: cats.map(function (c) { return c.used90; }), backgroundColor: '#C9A227' }] }, options: { indexAxis: 'y', maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } } }));
  }
  // map: suppliers (where they are) and where stock is used (job suburbs)
  var SUB = null, MAP = null, LAYER = null;
  function suburbs() {
    if (SUB) return Promise.resolve(SUB);
    return fetch('../assets/suburbs-sydney.json').then(function (r) { return r.json(); }).then(function (j) {
      var byNP = {}, byN = {}; (j.suburbs || []).forEach(function (s) { var n = s[0].toLowerCase(); byNP[n + '|' + s[1]] = s; if (!byN[n]) byN[n] = s; }); SUB = { byNP: byNP, byN: byN }; return SUB;
    });
  }
  function place(text) {   // "12 Trade Way, Smithfield NSW 2164", "Smithfield NSW 2164" or "Smithfield"
    var t = String(text || ''); if (!t || !SUB) return null;
    var m = t.match(/([A-Za-z][A-Za-z' .-]*?)\s+NSW\s*(2\d{3})?/i), name = m ? m[1] : t.replace(/^.*,\s*/, ''), pc = m && m[2] ? m[2] : (t.match(/\b(2\d{3})\b/) || [])[1] || '';
    name = name.replace(/^\d+\s+/, '').trim().toLowerCase();
    return SUB.byNP[name + '|' + pc] || SUB.byN[name] || null;
  }
  function mapTab() {
    var B = $('#invBody'); S.mapMode = S.mapMode || 'suppliers';
    B.innerHTML = '<div class="row" style="margin-bottom:8px"><div class="tabs" style="margin:0"><button class="tab' + (S.mapMode === 'suppliers' ? ' on' : '') + '" data-mm="suppliers">🏭 Suppliers</button><button class="tab' + (S.mapMode === 'usage' ? ' on' : '') + '" data-mm="usage">📍 Where stock is used</button></div>' +
      '<label class="muted" id="mapCatWrap" style="display:flex;gap:6px;align-items:center;font-size:13px">Category<select id="mapCat" style="width:auto"><option value="">All</option></select></label><span class="sp"></span><span class="muted" id="mapNote" style="font-size:12.5px"></span></div>' +
      '<div class="cmapwrap"><div class="card cmapcard"><div id="imap" class="cmap"></div><div class="cmkey" id="mapKey"></div></div><div class="card cmapside"><h2 id="mapSideH">Top</h2><div id="mapTop"><div class="empty">Loading…</div></div></div></div>';
    B.querySelectorAll('[data-mm]').forEach(function (b) { b.onclick = function () { S.mapMode = b.getAttribute('data-mm'); mapTab(); }; });
    loadCss('vendor/leaflet.css?v=194');
    Promise.all([loadScript('vendor/leaflet.js?v=194', function () { return !!window.L; }), suburbs(), insightsData()]).then(function (r) { drawMap(r[2]); }).catch(function (e) { $('#imap').innerHTML = '<div class="empty">' + esc2(e.message) + '</div>'; });
  }
  function drawMap(I) {
    var el = $('#imap'); if (!el || !window.L) return;
    if (!MAP || MAP.getContainer() !== el) {
      if (MAP) { try { MAP.remove(); } catch (e) {} }
      MAP = L.map(el, { scrollWheelZoom: true }).setView([-33.80, 151.0], 10);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(MAP);
      LAYER = null;
    }
    if (LAYER) LAYER.remove(); LAYER = L.layerGroup().addTo(MAP);
    var pts = [], missing = 0, groups = [];
    if (S.mapMode === 'suppliers') {
      var cs = {}; I.suppliers.forEach(function (s) { (s.categories || '').split(/\s*,\s*/).filter(Boolean).forEach(function (c) { cs[c] = 1; }); });
      var sel = $('#mapCat'); Object.keys(cs).sort().forEach(function (c) { sel.insertAdjacentHTML('beforeend', '<option' + (S.mapCat === c ? ' selected' : '') + '>' + esc2(c) + '</option>'); });
      sel.onchange = function () { S.mapCat = this.value; drawMap(I); };
      var by = {};
      I.suppliers.filter(function (s) { return !S.mapCat || (s.categories || '').indexOf(S.mapCat) >= 0; }).forEach(function (s) {
        var p = place(s.address); if (!p) { missing++; return; }
        var k = p[0] + '|' + p[1], g = by[k] = by[k] || { s: p, list: [], spend: 0, items: 0 }; g.list.push(s); g.spend += s.spend180; g.items += s.items;
      });
      groups = Object.keys(by).map(function (k) { return by[k]; });
      var max = Math.max.apply(null, groups.map(function (g) { return g.spend; }).concat([1]));
      groups.sort(function (a, b) { return b.spend - a.spend; }).forEach(function (g) {
        var r = 7 + 20 * Math.sqrt(g.spend / max), col = g.spend > max * 0.4 ? '#C9A227' : g.spend > 0 ? '#1F2937' : '#9CA3AF';
        var m = L.circleMarker([g.s[2], g.s[3]], { radius: r, color: '#fff', weight: 1.5, fillColor: col, fillOpacity: 0.8 }).addTo(LAYER);
        m.bindTooltip(g.s[0] + ': ' + g.list.length + ' supplier' + (g.list.length === 1 ? '' : 's'));
        m.bindPopup('<div class="cpop"><b>' + esc2(g.s[0]) + ' ' + esc2(g.s[1]) + '</b><ul>' + g.list.map(function (s) { return '<li><b>' + esc2(s.name) + '</b><br><small>' + s.items + ' items · ' + money2(s.spend180) + ' used in 6 months · ' + esc2(s.terms || '') + '</small></li>'; }).join('') + '</ul></div>');
        pts.push([g.s[2], g.s[3]]);
      });
      $('#mapCatWrap').style.display = '';
      $('#mapKey').innerHTML = '<b>Bubble size = what you used from them in 6 months.</b><span><i style="background:#C9A227"></i>Main suppliers</span><span><i style="background:#1F2937"></i>Used</span><span><i style="background:#9CA3AF"></i>Not used yet</span>';
      $('#mapSideH').textContent = 'Suppliers by use';
      $('#mapTop').innerHTML = itbl(I.suppliers.filter(function (s) { return !S.mapCat || (s.categories || '').indexOf(S.mapCat) >= 0; }).slice(0, 12), [function (s) { var p = place(s.address); return '<b>' + esc2(s.name) + '</b><br><small class="muted">' + esc2(p ? p[0] : '') + '</small>'; }, function (s) { return money2(s.spend180); }], 'No suppliers.');
      $('#mapNote').textContent = groups.length + ' suburbs' + (missing ? ' · ' + missing + ' supplier' + (missing === 1 ? '' : 's') + ' without a recognised address' : '');
    } else {
      $('#mapCatWrap').style.display = 'none';
      var max2 = Math.max.apply(null, I.suburbs.map(function (s) { return s.value; }).concat([1]));
      I.suburbs.forEach(function (s) {
        var p = place(s.suburb); if (!p) { missing++; return; }
        var r = 6 + 20 * Math.sqrt(s.value / max2);
        var m = L.circleMarker([p[2], p[3]], { radius: r, color: '#fff', weight: 1.5, fillColor: '#C2410C', fillOpacity: 0.75 }).addTo(LAYER);
        m.bindTooltip(p[0] + ': ' + money2(s.value) + ' of stock');
        m.bindPopup('<div class="cpop"><b>' + esc2(p[0]) + '</b><br>' + money2(s.value) + ' of stock on ' + s.jobs + ' job' + (s.jobs === 1 ? '' : 's') + '<ul>' + s.top.map(function (x) { return '<li>' + esc2(x.name) + ' <small>' + money2(x.value) + '</small></li>'; }).join('') + '</ul></div>');
        pts.push([p[2], p[3]]); groups.push(s);
      });
      $('#mapKey').innerHTML = '<b>Bubble size = value of stock used on jobs there (6 months).</b>';
      $('#mapSideH').textContent = 'Where stock is used';
      $('#mapTop').innerHTML = itbl(I.suburbs.slice(0, 12).map(function (s) { return { name: s.suburb.replace(/\s+NSW.*$/i, ''), value: s.value, jobs: s.jobs }; }), [function (s) { return '<b>' + esc2(s.name) + '</b>'; }, function (s) { return s.jobs + ' jobs'; }, function (s) { return money2(s.value); }], 'No stock has been used on jobs yet. Use stock on a job (Use, with the job number) and it shows here.');
      $('#mapNote').textContent = groups.length + ' suburbs' + (missing ? ' · ' + missing + ' not recognised' : '');
    }
    if (pts.length > 1) MAP.fitBounds(pts, { padding: [30, 30], maxZoom: 12 }); else if (pts.length === 1) MAP.setView(pts[0], 12);
    setTimeout(function () { try { MAP.invalidateSize(); } catch (e) {} }, 50);
  }
  function itemsTab() {
    var d = S.data, cats = Array.from(new Set(d.items.map(function (i) { return i.category; }).filter(Boolean))).sort();
    var list = d.items.filter(function (i) {
      if (!S.showArchived && i.archived) return false;
      if (S.lowOnly && !i.low) return false;
      if (S.cat && i.category !== S.cat) return false;
      var q = S.q.toLowerCase(); return !q || [i.name, i.sku, i.category, i.location, i.priceSupplierName].join(' ').toLowerCase().indexOf(q) >= 0;
    });
    var value = list.reduce(function (a, i) { return a + (i.archived ? 0 : i.value || 0); }, 0);
    $('#invBody').innerHTML = '<div class="row" style="margin-bottom:10px"><input id="invQ" placeholder="Search item, code, supplier…" value="' + esc(S.q) + '" style="max-width:280px">' +
      '<select id="invCat" style="width:auto"><option value="">All categories</option>' + cats.map(function (c) { return '<option' + (c === S.cat ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>' +
      '<label class="row" style="gap:6px;font-weight:700"><input type="checkbox" id="invLow" style="width:auto"' + (S.lowOnly ? ' checked' : '') + '>Low only</label>' +
      '<label class="row" style="gap:6px;font-weight:600" class="muted"><input type="checkbox" id="invArch" style="width:auto"' + (S.showArchived ? ' checked' : '') + '>Show archived</label><span class="sp"></span>' +
      '<span class="muted">Stock value <b>' + money(value) + '</b> ex GST</span></div>' +
      (list.length ? '<div class="table-wrap"><table class="itab"><thead><tr><th>Item</th><th class="num">On hand</th><th class="num" title="Set aside by project plan tasks that are not done yet">For jobs</th><th class="num">Available</th><th class="num">Re-order at</th><th>Best price</th><th>Status</th><th></th></tr></thead><tbody>' +
        list.map(function (i) {
          return '<tr data-iid="' + esc(i.id) + '"' + (i.archived ? ' class="tdone"' : '') + '><td><button class="linkish" data-edit>' + esc(i.name) + '</button><br><small class="muted">' + [i.sku, i.category, i.location].filter(Boolean).map(esc).join(' · ') + '</small></td>' +
            '<td class="num">' + fmtQ(i.onHand) + ' <small class="muted">' + esc(i.unit) + '</small></td><td class="num">' + (i.allocated ? fmtQ(i.allocated) : '–') + '</td>' +
            '<td class="num"><b' + (i.low ? ' style="color:#B42318"' : '') + '>' + fmtQ(i.available) + '</b>' + (i.onOrder ? '<br><small class="muted">+' + fmtQ(i.onOrder) + ' on order</small>' : '') + '</td>' +
            '<td class="num">' + (i.reorderLevel ? fmtQ(i.reorderLevel) : '–') + '</td>' +
            '<td>' + (i.price ? money(i.price) + ' <small class="muted">/' + esc(i.unit) + '</small><br><small class="muted">' + esc(i.priceSupplierName || '') + '</small>' : '<small class="muted">no quote</small>') + '</td>' +
            '<td>' + chip(i.state) + '</td>' +
            '<td class="nowrap"><button class="btn btn-sm" data-mv="out" title="Use stock">− Use</button> <button class="btn btn-sm" data-mv="in" title="Add stock">＋ Add</button> ' +
              (i.onOrder ? '<button class="btn btn-sm" data-recv title="Order arrived">📥 Receive</button> ' : '') + '<button class="btn btn-sm' + (i.low ? ' btn-gold' : '') + '" data-reorder="' + esc(i.id) + '">Re-order</button></td></tr>';
        }).join('') + '</tbody></table></div>' : '<div class="empty">' + (d.items.length ? 'Nothing matches.' : 'No stock items yet. Add your first one with “＋ Stock item”. Add suppliers first if you want to save their prices.') + '</div>');
    var B = $('#invBody');
    $('#invQ').oninput = function () { S.q = this.value; var c = this.selectionStart; itemsTab(); var n = $('#invQ'); n.focus(); n.setSelectionRange(c, c); };
    $('#invCat').onchange = function () { S.cat = this.value; itemsTab(); };
    $('#invLow').onchange = function () { S.lowOnly = this.checked; itemsTab(); };
    $('#invArch').onchange = function () { S.showArchived = this.checked; itemsTab(); };
    var idOf = function (el) { return el.closest('tr').getAttribute('data-iid'); };
    B.querySelectorAll('[data-edit]').forEach(function (b) { b.onclick = function () { editItem(idOf(b)); }; });
    B.querySelectorAll('[data-mv]').forEach(function (b) { b.onclick = function () { stockChange(idOf(b), b.getAttribute('data-mv')); }; });
    B.querySelectorAll('[data-recv]').forEach(function (b) { b.onclick = function () { receive(idOf(b)); }; });
    B.querySelectorAll('tbody [data-reorder]').forEach(function (b) { b.onclick = function () { reorder(b.getAttribute('data-reorder'), false); }; });
  }
  function suppliersTab() {
    var d = S.data, list = d.suppliers.filter(function (s) { return S.showArchived || !s.archived; });
    var count = function (id) { return d.items.filter(function (i) { return !i.archived && (i.priceSupplier === id || i.preferred === id); }).length; };
    $('#invBody').innerHTML = list.length ? '<div class="table-wrap"><table><thead><tr><th>Supplier</th><th>Contact</th><th>Phone</th><th>Email</th><th>Address</th><th class="hide-sm">Supplies</th><th class="num">Items</th><th></th></tr></thead><tbody>' +
      list.map(function (s) {
        return '<tr data-sid="' + esc(s.id) + '"' + (s.archived ? ' class="tdone"' : '') + '><td><button class="linkish" data-sedit>' + esc(s.name) + '</button>' + (s.terms ? '<br><small class="muted">' + esc(s.terms) + '</small>' : '') + '</td><td>' + esc(s.contact || '') + '</td>' +
          '<td>' + (s.phone ? '<a href="tel:' + esc(s.phone.replace(/[^\d+]/g, '')) + '">' + esc(s.phone) + '</a>' : '') + '</td><td>' + (s.email ? '<a href="mailto:' + esc(s.email) + '">' + esc(s.email) + '</a>' : '') + '</td>' +
          '<td class="sup-addr">' + (s.address ? '<a href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(s.address) + '" target="_blank" rel="noopener" title="Open in Google Maps">' + esc(s.address) + '</a>' : '<span class="muted">–</span>') + '</td>' +
          '<td class="hide-sm">' + esc(s.categories || '') + '</td><td class="num">' + count(s.id) + '</td><td><button class="btn btn-sm" data-sedit>Edit</button></td></tr>';
      }).join('') + '</tbody></table></div>' : '<div class="empty">No suppliers yet. Add one with “＋ Supplier”.</div>';
    $('#invBody').querySelectorAll('[data-sedit]').forEach(function (b) { b.onclick = function () { editSupplier(b.closest('tr').getAttribute('data-sid')); }; });
  }

  /* ---------- supplier editor ---------- */
  function editSupplier(id, after) {
    var go = function (s) {
      s = s || {};
      var f = function (k, label, ph, type) { return '<label>' + label + '<input data-s="' + k + '" value="' + esc(s[k] || '') + '" placeholder="' + esc(ph || '') + '"' + (type ? ' type="' + type + '"' : '') + '></label>'; };
      M.modal('<h2>' + (id ? 'Edit supplier' : 'New supplier') + '</h2><div class="form" style="margin-top:12px">' +
        f('name', 'Business name', 'e.g. Bunnings Castle Hill') + f('contact', 'Contact person', 'e.g. Dave (trade desk)') + f('phone', 'Phone', 'e.g. 02 9634 0000', 'tel') + f('email', 'Email (for orders)', 'orders@supplier.com.au', 'email') +
        f('account', 'Our account number', '') + f('terms', 'Payment terms', 'e.g. 30 days EOM') + f('categories', 'What they supply', 'e.g. tiles, membrane, plumbing') + f('website', 'Website', '') +
        '<label class="full">Address<input data-s="address" value="' + esc(s.address || '') + '"></label><label class="full">Notes<textarea data-s="notes" rows="2">' + esc(s.notes || '') + '</textarea></label></div>' +
        '<div class="actions" style="justify-content:space-between;margin-top:14px">' + (id ? '<button class="btn" id="supArch" type="button">' + (s.archived ? 'Restore' : 'Archive') + '</button>' : '<span></span>') +
        '<span><button class="btn" data-close type="button">Cancel</button> <button class="btn btn-gold" id="supSave" type="button">Save supplier</button></span></div>');
      var collect = function () { var o = { id: id || '' }; document.querySelectorAll('#modal [data-s]').forEach(function (el) { o[el.getAttribute('data-s')] = el.value; }); return o; };
      $('#supSave').onclick = function () {
        api('supSave', { supplier: collect() }).then(function (r) { M.closeModal(); toast('Supplier saved'); return load().then(function () { if (after) after(r.supplier); else if (location.hash.indexOf('#inventory') === 0) draw(); }); }).catch(fail);
      };
      var ar = $('#supArch'); if (ar) ar.onclick = function () { var o = collect(); o.archived = !s.archived; api('supSave', { supplier: o }).then(function () { M.closeModal(); toast(o.archived ? 'Supplier archived' : 'Supplier restored'); return load().then(draw); }).catch(fail); };
    };
    if (id) api('supGet', { id: id }).then(function (r) { go(r.supplier); }).catch(fail); else go(null);
  }

  /* ---------- item editor (with supplier quotes) ---------- */
  function editItem(id) {
    var go = function (r) {
      var isNew = !r || r.fresh;
      var it = r ? r.item : { unit: 'each', prices: [], reorderLevel: 0, reorderQty: 0, packSize: 0, onHand: 0 };
      var sups = ((r && r.suppliers) || S.data.suppliers).filter(function (s) { return !s.archived; });
      var prices = (it.prices || []).map(function (p) { return Object.assign({}, p); });
      var pref = it.preferred || '';
      var cats = Array.from(new Set(S.data.items.map(function (i) { return i.category; }).filter(Boolean)));
      var priceRows = function () {
        if (!prices.length) return '<div class="empty" style="padding:10px">No supplier quotes yet. Add one so jobs and re-orders use the right price.</div>';
        return '<div class="table-wrap"><table class="items"><thead><tr><th>Preferred</th><th>Supplier</th><th>Price ex GST</th><th>Pack</th><th>Quote ref</th><th>Quoted</th><th>Valid until</th><th></th></tr></thead><tbody>' +
          prices.map(function (p, i) {
            var exp = p.validUntil && p.validUntil < today();
            return '<tr data-pi="' + i + '"><td style="text-align:center"><input type="radio" name="pref" data-pref' + (p.supplier && p.supplier === pref ? ' checked' : '') + ' style="width:auto"></td>' +
              '<td><select data-p="supplier"><option value="">Choose…</option>' + sups.map(function (s) { return '<option value="' + esc(s.id) + '"' + (s.id === p.supplier ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') + '</select></td>' +
              '<td><input data-p="price" inputmode="decimal" value="' + esc(p.price || '') + '" style="width:90px"></td><td><input data-p="packSize" inputmode="decimal" value="' + esc(p.packSize || '') + '" style="width:60px" placeholder="1"></td>' +
              '<td><input data-p="ref" value="' + esc(p.ref || '') + '" style="width:110px"></td><td><input data-p="quoted" type="date" value="' + esc(p.quoted || today()) + '"></td>' +
              '<td><input data-p="validUntil" type="date" value="' + esc(p.validUntil || '') + '"' + (exp ? ' class="expired" title="This quote has expired"' : '') + '></td><td><button class="btn btn-sm" data-prm type="button">✕</button></td></tr>';
          }).join('') + '</tbody></table></div>';
      };
      var hist = !isNew ? '<h3 class="ai-h">Stock history</h3>' + ((it.moves || []).length ? '<div class="table-wrap" style="max-height:200px"><table><tbody>' + it.moves.slice(0, 25).map(function (m) {
          return '<tr><td class="nowrap">' + esc(M.day(m.at)) + '</td><td>' + esc(m.kind === 'plan' ? 'job' : m.kind) + '</td><td class="num">' + (m.qty > 0 ? '+' : '') + (m.qty ? fmtQ(m.qty) : '') + '</td><td>' + esc(m.reason || '') + (m.job ? ' <span class="ref">' + esc(m.job) + '</span>' : '') + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="muted">No movements yet.</p>') +
        (r.uses.length ? '<h3 class="ai-h">Used in project plans</h3><div class="list">' + r.uses.map(function (u) { return '<div class="item"><div><b>' + esc(u.task) + '</b><br><small>' + esc(u.plan) + ' · <a href="#plan/' + esc(u.job) + '">' + esc(u.job) + '</a></small></div><small>' + fmtQ(u.qty) + ' ' + esc(it.unit) + (u.done ? ' · used' : ' · set aside') + '</small></div>'; }).join('') + '</div>' : '') : '';
      M.modal('<h2>' + (!isNew ? esc(it.name) + ' <span class="ref">' + esc(it.id) + '</span>' : 'New stock item') + '</h2>' +
        '<div class="form" style="margin-top:12px">' +
        '<label class="full">Item name<input data-i="name" value="' + esc(it.name || '') + '" placeholder="e.g. Ardex WPM 300 waterproofing membrane 15 L"></label>' +
        '<label>Code / SKU<input data-i="sku" value="' + esc(it.sku || '') + '"></label>' +
        '<label>Category<input data-i="category" list="invCats" value="' + esc(it.category || '') + '" placeholder="e.g. Waterproofing"></label><datalist id="invCats">' + cats.map(function (c) { return '<option value="' + esc(c) + '">'; }).join('') + '</datalist>' +
        '<label>Unit<select data-i="unit">' + UNITS.concat(UNITS.indexOf(it.unit) < 0 && it.unit ? [it.unit] : []).map(function (u) { return '<option' + (u === it.unit ? ' selected' : '') + '>' + esc(u) + '</option>'; }).join('') + '</select></label>' +
        '<label>Where it is kept<input data-i="location" value="' + esc(it.location || '') + '" placeholder="e.g. Van 1, shed"></label>' +
        (!isNew ? '<label>On hand<input value="' + fmtQ(it.onHand) + ' ' + esc(it.unit) + '" disabled><small class="muted">Change it with − Use, ＋ Add or a stock-take.</small></label>' : '<label>On hand now<input data-i="onHand" inputmode="decimal" value="' + esc(it.onHand || 0) + '"></label>') +
        '<label>Re-order when available is at or below<input data-i="reorderLevel" inputmode="decimal" value="' + esc(it.reorderLevel || 0) + '"></label>' +
        '<label>Usual order quantity<input data-i="reorderQty" inputmode="decimal" value="' + esc(it.reorderQty || 0) + '"></label>' +
        '<label>Comes in packs of (optional)<input data-i="packSize" inputmode="decimal" value="' + esc(it.packSize || '') + '" placeholder="e.g. 4"></label>' +
        '<label class="full">Notes<textarea data-i="notes" rows="2">' + esc(it.notes || '') + '</textarea></label></div>' +
        '<div class="row" style="margin:14px 0 6px;justify-content:space-between"><h3 class="ai-h" style="margin:0">Supplier quotes (prices)</h3><span><button class="btn btn-sm" id="addQuote" type="button">＋ Add quote</button> <button class="btn btn-sm" id="addSupInline" type="button">＋ New supplier</button></span></div>' +
        '<div id="priceBox">' + priceRows() + '</div>' + hist +
        '<div class="actions" style="justify-content:space-between;margin-top:14px">' + (!isNew ? '<span><button class="btn" id="itArch" type="button">' + (it.archived ? 'Restore' : 'Archive') + '</button> <button class="btn" id="itCount" type="button">Stock-take</button></span>' : '<span></span>') +
        '<span><button class="btn" data-close type="button">Cancel</button> <button class="btn btn-gold" id="itSave" type="button">Save item</button></span></div>');
      var wire = function () {
        document.querySelectorAll('#priceBox [data-p]').forEach(function (el) { el.onchange = el.oninput = function () { var p = prices[+el.closest('tr').getAttribute('data-pi')], k = el.getAttribute('data-p'); p[k] = el.value; if (k === 'supplier' && !pref) pref = el.value; }; });
        document.querySelectorAll('#priceBox [data-pref]').forEach(function (el) { el.onchange = function () { pref = prices[+el.closest('tr').getAttribute('data-pi')].supplier; }; });
        document.querySelectorAll('#priceBox [data-prm]').forEach(function (b) { b.onclick = function () { prices.splice(+b.closest('tr').getAttribute('data-pi'), 1); $('#priceBox').innerHTML = priceRows(); wire(); }; });
      };
      wire();
      $('#addQuote').onclick = function () { if (!sups.length) return toast('Add a supplier first (＋ New supplier)', true); prices.push({ supplier: sups.length === 1 ? sups[0].id : '', price: '', quoted: today() }); if (!pref && sups.length === 1) pref = sups[0].id; $('#priceBox').innerHTML = priceRows(); wire(); };
      $('#addSupInline').onclick = function () { var keep = collect(); editSupplier(null, function () { go(Object.assign({}, r || { uses: [], fresh: true }, { item: keep, suppliers: S.data.suppliers })); }); };
      var collect = function () { var o = Object.assign({}, it); document.querySelectorAll('#modal [data-i]').forEach(function (el) { o[el.getAttribute('data-i')] = el.value; }); o.prices = prices.map(function (p) { return Object.assign({}, p, { price: num(p.price), packSize: num(p.packSize) }); }); o.preferred = pref; return o; };
      $('#itSave').onclick = function () {
        var o = collect(); if (isNew) o.id = '';
        api('invSave', { item: o }).then(function (x) { M.closeModal(); toast('Item saved'); return load().then(function () { if (location.hash.indexOf('#inventory') === 0) draw(); prompt(x.low); }); }).catch(fail);
      };
      var ar = $('#itArch'); if (ar) ar.onclick = function () { api('invArchive', { id: it.id, archived: !it.archived }).then(function () { M.closeModal(); toast(it.archived ? 'Item restored' : 'Item archived'); return load().then(draw); }).catch(fail); };
      var ct = $('#itCount'); if (ct) ct.onclick = function () { M.closeModal(); stockChange(it.id, 'count'); };
    };
    if (id) api('invGet', { id: id }).then(go).catch(fail); else go(null);
  }

  /* ---------- stock in / out / count ---------- */
  function stockChange(id, kind) {
    var it = S.data.items.filter(function (i) { return i.id === id; })[0]; if (!it) return;
    var title = kind === 'out' ? 'Use stock' : kind === 'in' ? 'Add stock' : 'Stock-take (count)';
    M.modal('<h2>' + title + ': ' + esc(it.name) + '</h2><p class="muted">On hand ' + fmtQ(it.onHand) + ' ' + esc(it.unit) + (it.allocated ? ' · ' + fmtQ(it.allocated) + ' set aside for jobs' : '') + '</p>' +
      '<div class="form" style="margin-top:10px"><label>' + (kind === 'count' ? 'Counted on hand' : 'Quantity') + ' (' + esc(it.unit) + ')<input id="mvQty" inputmode="decimal" autofocus></label>' +
      '<label>Job (optional)<select id="mvJob"><option value="">–</option></select></label><label class="full">Note<input id="mvReason" placeholder="' + (kind === 'out' ? 'e.g. Used at Castle Hill bathroom' : kind === 'in' ? 'e.g. Bought at Bunnings' : 'e.g. Monthly stock-take') + '"></label></div>' +
      '<div class="actions" style="justify-content:flex-end;margin-top:12px"><button class="btn" data-close type="button">Cancel</button><button class="btn btn-gold" id="mvGo" type="button">Save</button></div>');
    api('jobs', { stage: 'open' }).then(function (j) { var s = $('#mvJob'); if (s) s.innerHTML = '<option value="">–</option>' + j.jobs.map(function (x) { return '<option value="' + esc(x.core) + '">' + esc(x.ref + ' · ' + x.name) + '</option>'; }).join(''); }).catch(function () {});
    $('#mvGo').onclick = function () {
      api('invMove', { id: id, kind: kind, qty: $('#mvQty').value, job: $('#mvJob').value, reason: $('#mvReason').value }).then(function (r) {
        M.closeModal(); toast('Stock updated: ' + fmtQ(r.item.onHand) + ' ' + r.item.unit + ' on hand');
        return load().then(function () { if (location.hash.indexOf('#inventory') === 0) draw(); prompt(r.low); });
      }).catch(fail);
    };
  }
  function receive(id) {
    var it = S.data.items.filter(function (i) { return i.id === id; })[0]; if (!it) return;
    M.modal('<h2>📥 Order arrived: ' + esc(it.name) + '</h2><p class="muted">On order: ' + fmtQ(it.onOrder) + ' ' + esc(it.unit) + '</p><div class="form" style="margin-top:10px"><label>Received (' + esc(it.unit) + ')<input id="rcQty" inputmode="decimal" value="' + fmtQ(it.onOrder) + '"></label><label>Delivery docket / note<input id="rcRef"></label></div>' +
      '<div class="actions" style="justify-content:flex-end;margin-top:12px"><button class="btn" data-close type="button">Cancel</button><button class="btn btn-gold" id="rcGo" type="button">Add to stock</button></div>');
    $('#rcGo').onclick = function () {
      api('invMove', { id: id, kind: 'in', received: true, qty: $('#rcQty').value, reason: 'Order received' + ($('#rcRef').value ? ' (' + $('#rcRef').value + ')' : '') }).then(function (r) { M.closeModal(); toast('Received'); return load().then(function () { if (location.hash.indexOf('#inventory') === 0) draw(); prompt(r.low); }); }).catch(fail);
    };
  }

  /* ---------- low stock: call or email the supplier (AI can write the email) ---------- */
  function prompt(low) {
    (low || []).forEach(function (l) { if (S.queue.indexOf(l.id) < 0) S.queue.push(l.id); });
    if (!S.queue.length || !document.getElementById('modal').hidden) return;
    reorder(S.queue.shift(), true);
  }
  function reorder(id, triggered) {
    api('invGet', { id: id }).then(function (r) {
      var it = r.item, s = r.summary, sups = r.suppliers.filter(function (x) { return !x.archived; });
      var quoted = (it.prices || []).map(function (p) { return p.supplier; });
      var order = sups.slice().sort(function (a, b) { return (b.id === it.preferred) - (a.id === it.preferred) || (quoted.indexOf(b.id) >= 0) - (quoted.indexOf(a.id) >= 0); });
      var sel = it.preferred || (order[0] && order[0].id) || '';
      var priceOf = function (sid) { var p = (it.prices || []).filter(function (x) { return x.supplier === sid; })[0]; return p ? money(p.price) + ' ex GST per ' + it.unit + (p.ref ? ' (quote ' + p.ref + ')' : '') + (p.validUntil && p.validUntil < today() ? ' · expired' : '') : 'no quote saved'; };
      M.modal('<h2>' + (triggered ? '⚠️ ' + esc(it.name) + ' is low on stock' : 'Re-order ' + esc(it.name)) + '</h2>' +
        '<p style="margin:6px 0 2px">Available <b>' + fmtQ(s.available) + ' ' + esc(it.unit) + '</b>' + (s.allocated ? ' (' + fmtQ(s.onHand) + ' on hand, ' + fmtQ(s.allocated) + ' set aside for jobs)' : '') + ' · re-order at ' + fmtQ(it.reorderLevel) + (s.onOrder ? ' · ' + fmtQ(s.onOrder) + ' already on order' : '') + '</p>' +
        (triggered ? '<p class="muted" style="margin:0 0 10px">Do you want to contact the supplier by phone or email?</p>' : '') +
        (sups.length ? '<div class="form" style="margin-top:8px"><label>Supplier<select id="roSup">' + order.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === sel ? ' selected' : '') + '>' + esc(x.name) + (x.id === it.preferred ? ' (preferred)' : '') + '</option>'; }).join('') + '</select></label>' +
          '<label>Quantity to order (' + esc(it.unit) + ')<input id="roQty" inputmode="decimal" value="' + fmtQ(r.suggested) + '"></label></div><p class="muted" id="roInfo" style="margin:6px 0"></p>' +
          '<div class="ro-ways"><div class="ro-way"><h3>📞 Phone</h3><div id="roCall"></div><button class="btn btn-sm" id="roMarked" type="button">I ordered by phone: mark as on order</button></div>' +
          '<div class="ro-way"><h3>✉ Email</h3><p class="muted" style="margin:0 0 8px">Write it yourself or let the AI write it with the quantity.</p><button class="btn btn-sm" id="roEmail" type="button">Write the email</button> <button class="btn btn-sm btn-ai" id="roAI" type="button">✨ Write it with AI</button></div></div>' +
          '<div id="roMail"></div>'
          : '<div class="empty">No suppliers saved yet. <button class="btn btn-sm" id="roNewSup" type="button">＋ Add a supplier</button></div>') +
        '<div class="actions" style="justify-content:flex-end;margin-top:12px"><label class="row" style="gap:6px;margin-right:auto">Expected delivery<input type="date" id="roExp" style="width:auto"></label><button class="btn" data-close type="button" id="roLater">' + (triggered ? 'Later' : 'Close') + '</button></div>');
      var info = function () {
        var x = sups.filter(function (y) { return y.id === $('#roSup').value; })[0] || {};
        $('#roInfo').textContent = [x.contact, priceOf(x.id)].filter(Boolean).join(' · ');
        $('#roCall').innerHTML = x.phone ? '<a class="btn btn-gold" href="tel:' + esc(x.phone.replace(/[^\d+]/g, '')) + '">📞 Call ' + esc(x.phone) + '</a>' : '<p class="muted">No phone number saved for this supplier.</p>';
        return x;
      };
      if (!sups.length) { $('#roNewSup').onclick = function () { M.closeModal(); editSupplier(null, function () { reorder(id, triggered); }); }; return; }
      info(); $('#roSup').onchange = function () { info(); $('#roMail').innerHTML = ''; };
      $('#roMarked').onclick = function () {
        api('invOrdered', { id: id, qty: $('#roQty').value, supplier: $('#roSup').value, expected: $('#roExp').value, via: 'phone' }).then(function () { M.closeModal(); toast('Marked as on order'); afterOrder(); }).catch(fail);
      };
      var draft = function (ai) {
        var btn = ai ? $('#roAI') : $('#roEmail'); var old = btn.textContent; btn.disabled = true; btn.textContent = ai ? 'Writing…' : old;
        if (ai) $('#roMail').innerHTML = '<p class="ask-think" style="margin:10px 0">The AI is writing the email…</p>';
        api('invReorderDraft', { id: id, supplier: $('#roSup').value, qty: $('#roQty').value, ai: !!ai }).then(function (d) {
          $('#roMail').innerHTML = '<div class="ro-mail">' + (d.note ? '<p class="muted" style="margin:0 0 6px">' + esc(d.note) + '</p>' : '') +
            '<label>To<input id="emTo" type="email" value="' + esc(d.to || '') + '" placeholder="supplier email"></label><label>Subject<input id="emSub" value="' + esc(d.subject) + '"></label>' +
            '<label>Message<textarea id="emBody" rows="10">' + esc(d.body) + '</textarea></label>' +
            (d.ai ? '<p class="muted" style="font-size:12px;margin:4px 0">Written by AI' + (d.tokens ? ' · about ' + Number(d.tokens).toLocaleString('en-AU') + ' tokens' : '') + (d.today ? ' · today ' + d.today.questions + ' of ' + d.today.limit + ' AI questions' : '') + '. Check it before sending.</p>' : '') +
            '<div class="actions" style="margin-top:8px"><label class="row" style="gap:6px"><input type="checkbox" id="emCopy" checked style="width:auto">Send me a copy</label><span class="sp"></span>' +
            '<a class="btn" id="emApp" href="#">Open in my email app</a><button class="btn btn-gold" id="emSend" type="button">Send email &amp; mark on order</button></div></div>';
          $('#emApp').onclick = function (e) { e.preventDefault(); location.href = 'mailto:' + encodeURIComponent($('#emTo').value) + '?subject=' + encodeURIComponent($('#emSub').value) + '&body=' + encodeURIComponent($('#emBody').value); };
          $('#emSend').onclick = function () {
            var b = $('#emSend'); b.disabled = true; b.textContent = 'Sending…';
            api('invReorderSend', { id: id, supplier: $('#roSup').value, qty: $('#roQty').value, expected: $('#roExp').value, to: $('#emTo').value, subject: $('#emSub').value, body: $('#emBody').value, copyMe: $('#emCopy').checked })
              .then(function (x) { M.closeModal(); toast('Order emailed to ' + x.to); afterOrder(); })
              .catch(function (e) { b.disabled = false; b.textContent = 'Send email & mark on order'; fail(e); });
          };
        }).catch(function (e) { $('#roMail').innerHTML = '<p class="ai-err">' + esc(e.message) + '</p>'; }).then(function () { btn.disabled = false; btn.textContent = old; });
      };
      $('#roEmail').onclick = function () { draft(false); };
      $('#roAI').onclick = function () { draft(true); };
      $('#roLater').addEventListener('click', function () { setTimeout(function () { prompt([]); }, 50); });
      function afterOrder() { load().then(function () { if (location.hash.indexOf('#inventory') === 0) draw(); prompt([]); }); }
    }).catch(fail);
  }

  /* ---------- for the planner: pick a stock item ---------- */
  function pick(currentId, cb) {
    load().then(function (d) {
      var items = d.items.filter(function (i) { return !i.archived; });
      M.modal('<h2>📦 Use a stock item on this task</h2><p class="muted" style="margin:4px 0 10px">The task gets the item\'s unit and supplier price. While the task is not done the quantity is set aside; when it is Done the stock is used.</p>' +
        '<input id="pkQ" placeholder="Search stock…" autocomplete="off"><div class="list" id="pkList" style="margin-top:10px;max-height:50vh;overflow:auto"></div>' +
        '<div class="actions" style="justify-content:space-between;margin-top:12px">' + (currentId ? '<button class="btn" id="pkNone" type="button">Remove the stock item</button>' : '<a class="btn" href="#inventory">Manage stock</a>') + '<button class="btn" data-close type="button">Cancel</button></div>');
      var draw2 = function () {
        var q = $('#pkQ').value.toLowerCase();
        var l = items.filter(function (i) { return !q || [i.name, i.sku, i.category].join(' ').toLowerCase().indexOf(q) >= 0; });
        $('#pkList').innerHTML = l.length ? l.map(function (i) {
          return '<button class="item pk' + (i.id === currentId ? ' on' : '') + '" data-pk="' + esc(i.id) + '" type="button"><div style="text-align:left"><b>' + esc(i.name) + '</b><br><small>' + [i.sku, i.category].filter(Boolean).map(esc).join(' · ') + '</small></div>' +
            '<div style="text-align:right"><b' + (i.low ? ' style="color:#B42318"' : '') + '>' + fmtQ(i.available) + ' ' + esc(i.unit) + '</b><br><small>' + (i.price ? money(i.price) + '/' + esc(i.unit) : 'no price') + '</small></div></button>';
        }).join('') : '<div class="empty">No stock items' + (q ? ' match' : ' yet') + '.</div>';
        document.querySelectorAll('#pkList [data-pk]').forEach(function (b) { b.onclick = function () { var it = items.filter(function (x) { return x.id === b.getAttribute('data-pk'); })[0]; M.closeModal(); cb(it); }; });
      };
      $('#pkQ').oninput = draw2; draw2(); $('#pkQ').focus();
      var none = $('#pkNone'); if (none) none.onclick = function () { M.closeModal(); cb(null); };
    }).catch(fail);
  }

  M.inv = { load: load, prompt: prompt, reorder: function (id) { reorder(id, false); }, pick: pick, items: function () { return S.data ? S.data.items : []; } };
  M.addView('inventory', 'Inventory & suppliers', page);
  window.MBS.invState = S;   // for tests
  // low-stock badge in the menu: on start and whenever the dashboard is opened
  var tick = function () { if (!document.getElementById('app').hidden) load().catch(function () {}); };
  window.addEventListener('hashchange', function () { if (/^#(dashboard)?$/.test(location.hash)) tick(); });
  new MutationObserver(function () { if (!document.getElementById('app').hidden) tick(); }).observe(document.getElementById('app'), { attributes: true, attributeFilter: ['hidden'] });
  setTimeout(tick, 1500);
})();
