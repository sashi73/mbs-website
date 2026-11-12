/* GKH Project Champ: the portfolio. Two tabs over every project:
   📊 Summary: health tiles, projects per PMBOK phase, and a health table (worst first).
   ▦ Pipeline board: one column per PMBOK phase (Initiation, Planning, Execution, Monitoring & Evaluation, Closing).
   The phase is worked out from the plan (see planPipelineList); drag a card or use ⇄ to pin it to another phase. */
(function () {
  'use strict';
  var M = window.MBS; if (!M) return;
  var api = M.api, esc = M.esc, fail = M.fail, toast = M.toast, $ = M.$;
  var money = M.money || function (n) { return '$' + Math.round(n || 0).toLocaleString('en-AU'); };
  var COLS = [
    ['init', 'Initiation', '#3B82F6', 'Charter, sponsor, stakeholders'],
    ['plan', 'Planning', '#8B5CF6', 'Scope, schedule, budget, risks'],
    ['exec', 'Execution', '#F59E0B', 'Work under way'],
    ['monitor', 'Monitoring & Evaluation', '#10B981', 'Track, test, accept (80%+ done)'],
    ['close', 'Closing', '#6B7280', 'Hand-over, lessons learned, sign-off']
  ];
  var ORDER = COLS.map(function (c) { return c[0]; });
  var NAME = {}; COLS.forEach(function (c) { NAME[c[0]] = c[1]; });
  var store = function (k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } };
  var P = { data: null, q: '', el: null, tab: store('champTab') || 'board', dragging: false };
  var DAY = 864e5;
  var age = function (ms) { return ms ? Math.max(0, Math.floor((Date.now() - ms) / DAY)) : 0; };
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var pretty = function (s) { if (!s) return ''; var a = s.split('-').map(Number); return a[2] + ' ' + MON[a[1] - 1] + ' ' + String(a[0]).slice(2); };
  var evC = function (v) { return v == null ? 'grey' : v >= 1 ? 'green' : v >= 0.9 ? 'amber' : 'red'; };
  var today = function () { var o = {}; new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).forEach(function (p) { o[p.type] = p.value; }); return o.year + '-' + o.month + '-' + o.day; };
  // health: red / amber / green from schedule, cost, late tasks and high risks
  function health(c) {
    if (!c.hasPlan) return 'grey';
    if ((c.SPI != null && c.SPI < 0.9) || (c.CPI != null && c.CPI < 0.9) || c.late >= 3 || c.highRisks >= 3) return 'red';
    if ((c.SPI != null && c.SPI < 1) || (c.CPI != null && c.CPI < 1) || c.late > 0 || c.highRisks > 0) return 'amber';
    return 'green';
  }
  var HN = { red: 'At risk', amber: 'Watch', green: 'On track', grey: 'Not planned' };

  /* ---------------- delete projects ---------------- */
  // one or many: the whole project goes (plan, tasks, costs, risks, issues, stakeholders, reports and the project record)
  function delProjects(list) {
    if (!list.length) return Promise.resolve(false);
    var one = list.length === 1;
    var names = list.slice(0, 6).map(function (c) { return '<li><b>' + esc(c.name) + '</b> <small class="muted">' + esc(c.ref || '') + '</small></li>'; }).join('') + (list.length > 6 ? '<li>… and ' + (list.length - 6) + ' more</li>' : '');
    return M.confirmBox(one ? 'Delete this project?' : 'Delete ' + list.length + ' projects?',
      '<ul style="margin:6px 0 10px;padding-left:18px">' + names + '</ul>Everything in ' + (one ? 'it' : 'them') + ' is deleted: the plan, tasks, dates, costs, risks, issues, stakeholders and reports. <b>This can\'t be undone.</b>',
      one ? '🗑 Delete project' : '🗑 Delete ' + list.length + ' projects', true).then(function (ok) {
      if (!ok) return false;
      var done = 0, bad = [];
      return list.reduce(function (pr, c) { return pr.then(function () { return api('planProjectDelete', { core: c.core }).then(function () { done++; }).catch(function (e) { bad.push(c.name + ': ' + e.message); }); }); }, Promise.resolve())
        .then(function () { if (done) toast(done === 1 ? 'Project deleted' : done + ' projects deleted'); if (bad.length) fail(new Error(bad.join(' · '))); return done > 0; });
    });
  }
  M.champDelete = delProjects;

  /* ---------------- board ---------------- */
  function flags(c) {
    var f = [], w = function (t, l) { f.push('<span class="pflag pf-' + l + '">' + esc(t) + '</span>'); };
    if (!c.hasPlan) w('No project plan yet', 'amber');
    if (c.hasPlan && c.phase === 'plan' && c.start) w('Starts ' + pretty(c.start), 'blue');
    if (c.late) w(c.late + ' late task' + (c.late === 1 ? '' : 's'), 'red');
    if (c.highRisks && c.phase !== 'close') w(c.highRisks + ' high risk' + (c.highRisks === 1 ? '' : 's'), 'amber');
    if (c.openIssues && c.phase !== 'close') w(c.openIssues + ' open issue' + (c.openIssues === 1 ? '' : 's'), 'amber');
    if (c.CPI != null && c.CPI < 0.9) w('Over budget (CPI ' + c.CPI.toFixed(2) + ')', 'red');
    if (c.phase === 'close' && c.total && c.done >= c.total) w('All tasks done ✓', 'green');
    if (c.pinned) w('📌 Moved by hand', 'grey');
    return f.join('');
  }
  function card(c) {
    var a = age(c.since);
    var planBit = c.hasPlan ? '<div class="pc-plan"><div class="pbar"><span style="width:' + Math.min(100, c.pct) + '%"></span></div><div class="pc-pl"><span>' + c.pct + '% · ' + c.done + '/' + c.total + ' tasks</span>' +
      (c.SPI != null ? '<span class="pc-ev ev-' + evC(c.SPI) + '" title="SPI (schedule): green 1.00 or more, yellow 0.90–0.99, red below 0.90"><i class="evdot"></i>SPI ' + c.SPI.toFixed(2) + '</span>' : '') + '</div>' +
      (c.finish ? '<div class="pc-fin">Finish ' + esc(pretty(c.finish)) + '</div>' : '') + '</div>' : '';
    return '<div class="pcard" data-core="' + esc(c.core) + '" tabindex="0" role="link" title="Open ' + esc(c.ref) + ' (drag it to another phase to move it)">' +
      '<div class="pc-top"><span class="ref">' + esc(c.ref) + '</span><span class="pc-age" title="Days since the project was created">' + (a ? a + 'd' : 'today') + '</span><button class="pc-move" type="button" data-move title="Move to another phase (or drag the card)" aria-label="Move">⇄</button></div>' +
      '<b class="pc-name">' + esc(c.name) + '</b><div class="pc-title">' + esc(c.client) + '</div>' +
      '<div class="pc-meta">' + [c.site ? esc(c.site) : '', c.BAC ? '<b>' + money(c.BAC) + '</b> <small>budget</small>' : ''].filter(Boolean).join(' · ') + '</div>' +
      planBit + '<div class="pc-flags">' + flags(c) + '</div>' +
      '<a class="pc-plink" href="#plan/' + esc(c.core) + '" title="Open the project plan">📅 ' + (c.hasPlan ? 'Plan' : 'Make the plan') + '</a></div>';
  }
  function moveTo(c, to) {
    if (!c || (to !== 'auto' && c.phase === to)) return;
    if (to === 'auto' && !c.pinned) return toast('This project already follows its plan automatically');
    return api('planPhaseSet', { core: c.core, phase: to }).then(function () {
      toast(c.name + ': ' + (to === 'auto' ? 'phase follows the plan again' : 'moved to ' + NAME[to]));
      return load();
    }).catch(function (e) { fail(e); load(); });
  }
  function moveMenu(c, btn) {
    var rc = btn.getBoundingClientRect(), m = document.createElement('div');
    m.className = 'pmenu';
    m.innerHTML = '<b>Move to…</b>' + COLS.filter(function (x) { return x[0] !== c.phase; }).map(function (x) { return '<button type="button" data-to="' + x[0] + '" style="--pc:' + x[2] + '"><i></i>' + esc(x[1]) + '</button>'; }).join('') +
      (c.pinned ? '<button type="button" data-to="auto" style="--pc:#C9A227"><i></i>Automatic (' + esc(NAME[c.auto]) + ')</button>' : '') +
      (M.allowed('projects', 'edit') && !(M.me && M.me.scope) ? '<hr style="border:0;border-top:1px solid var(--line);margin:4px 0"><button type="button" data-del style="--pc:#DC2626;color:#B91C1C"><i></i>🗑 Delete project…</button>' : '');
    document.body.appendChild(m);
    m.style.top = Math.min(innerHeight - m.offsetHeight - 8, rc.bottom + 4) + 'px'; m.style.left = Math.max(8, Math.min(innerWidth - m.offsetWidth - 8, rc.right - m.offsetWidth)) + 'px';
    var close = function () { m.remove(); document.removeEventListener('pointerdown', out, true); };
    var out = function (e) { if (!m.contains(e.target)) close(); };
    setTimeout(function () { document.addEventListener('pointerdown', out, true); }, 0);
    m.querySelectorAll('[data-to]').forEach(function (b) { b.onclick = function () { close(); moveTo(c, b.getAttribute('data-to')); }; });
    var d = m.querySelector('[data-del]'); if (d) d.onclick = function () { close(); delProjects([c]).then(function (ok) { if (ok) load(); }); };
  }
  function bindDrag(host, byCore) {
    host.querySelectorAll('.pcard').forEach(function (el) {
      var c = byCore[el.getAttribute('data-core')];
      var mv = el.querySelector('[data-move]'); if (mv) mv.onclick = function (e) { e.stopPropagation(); moveMenu(c, mv); };
      el.addEventListener('pointerdown', function (e) {
        if (e.pointerType === 'touch' || e.button !== 0 || e.target.closest('a,button')) return;
        var sx = e.clientX, sy = e.clientY, ghost = null, over = null;
        var mvH = function (ev) {
          if (!ghost) {
            if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 7) return;
            ghost = el.cloneNode(true); ghost.classList.add('pghost'); ghost.style.width = el.offsetWidth + 'px'; document.body.appendChild(ghost);
            el.classList.add('dragging'); document.body.classList.add('pdragging'); P.dragging = true;
          }
          ev.preventDefault();
          ghost.style.left = (ev.clientX - 20) + 'px'; ghost.style.top = (ev.clientY - 14) + 'px';
          var under = document.elementFromPoint(ev.clientX, ev.clientY), col = under && under.closest('.pcol');
          if (over && over !== col) over.classList.remove('dropok');
          over = col; if (col && col.getAttribute('data-col') !== c.phase) col.classList.add('dropok');
        };
        var upH = function () {
          document.removeEventListener('pointermove', mvH); document.removeEventListener('pointerup', upH); document.removeEventListener('pointercancel', upH);
          if (!ghost) return;
          ghost.remove(); el.classList.remove('dragging'); document.body.classList.remove('pdragging');
          setTimeout(function () { P.dragging = false; }, 0);
          if (over) { over.classList.remove('dropok'); moveTo(c, over.getAttribute('data-col')); }
        };
        document.addEventListener('pointermove', mvH); document.addEventListener('pointerup', upH); document.addEventListener('pointercancel', upH);
      });
    });
  }
  function filtered() {
    var q = P.q.toLowerCase().trim();
    return P.data.cards.filter(function (c) { return !q || (c.ref + ' ' + c.name + ' ' + c.client + ' ' + c.site).toLowerCase().indexOf(q) >= 0; });
  }
  function drawBoard(host) {
    var cards = filtered(), byCore = {};
    cards.forEach(function (c) { byCore[c.core] = c; });
    host.innerHTML = '<div class="pboard champ-pboard" id="pboard">' + COLS.map(function (col) {
      var list = cards.filter(function (c) { return c.phase === col[0]; }).sort(function (a, b) { return (a.finish || '9') < (b.finish || '9') ? -1 : 1; });
      var val = list.reduce(function (s, c) { return s + (c.BAC || 0); }, 0);
      return '<section class="pcol" data-col="' + col[0] + '" style="--pc:' + col[2] + '"><header><div class="pcol-h"><b>' + col[1] + '</b><span class="pcol-n">' + list.length + '</span></div>' +
        '<small>' + (val ? money(val) + ' · ' : '') + esc(col[3]) + '</small></header>' +
        '<div class="pcol-b">' + (list.length ? list.map(card).join('') : '<div class="pcol-empty">Nothing here</div>') + '</div></section>';
    }).join('') + '</div>';
    host.querySelectorAll('.pcard').forEach(function (el) {
      var go = function (e) { if (P.dragging || e.target.closest('.pc-plink,.pc-move')) return; location.hash = '#plan/' + el.getAttribute('data-core'); };
      el.addEventListener('click', go);
      el.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(e); });
    });
    bindDrag(host, byCore);
  }

  /* ---------------- summary ---------------- */
  function tile(label, value, sub, cls) { return '<div class="cs-tile' + (cls ? ' ' + cls : '') + '"><span>' + label + '</span><b>' + value + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</div>'; }
  function drawSummary(host) {
    var cards = filtered(), n = cards.length;
    var H = { red: 0, amber: 0, green: 0, grey: 0 }; cards.forEach(function (c) { H[health(c)]++; });
    var sum = function (k) { return cards.reduce(function (s, c) { return s + (c[k] || 0); }, 0); };
    var BAC = sum('BAC'), EV = sum('EV'), AC = sum('AC'), PV = sum('PV');
    var spi = PV > 0 ? EV / PV : null, cpi = AC > 0 ? EV / AC : null;
    var late = sum('late'), hr = sum('highRisks'), iss = sum('openIssues');
    var tiles = tile('Projects', n, H.grey ? H.grey + ' waiting for a plan' : 'all planned') +
      tile('On track', H.green, 'SPI and CPI 1.00+, nothing late', 'cs-green') +
      tile('Watch', H.amber, 'slipping a little or open risks', 'cs-amber') +
      tile('At risk', H.red, 'SPI or CPI under 0.90, or 3+ late', 'cs-red') +
      tile('Total budget', money(BAC), 'earned ' + money(EV) + ' · spent ' + money(AC)) +
      tile('Portfolio SPI', spi == null ? '–' : spi.toFixed(2), 'schedule: work done ÷ planned', 'ev-' + evC(spi)) +
      tile('Portfolio CPI', cpi == null ? '–' : cpi.toFixed(2), 'cost: value of work ÷ cost', 'ev-' + evC(cpi)) +
      tile('Late tasks', late, hr + ' high risk' + (hr === 1 ? '' : 's') + ' · ' + iss + ' open issue' + (iss === 1 ? '' : 's'), late ? 'cs-red' : '');
    var max = 1; var per = COLS.map(function (c) { var l = cards.filter(function (x) { return x.phase === c[0]; }); max = Math.max(max, l.length); return [c, l]; });
    var funnel = per.map(function (x) {
      var c = x[0], l = x[1], b = l.reduce(function (s, y) { return s + (y.BAC || 0); }, 0);
      return '<div class="cs-ph"><span class="cs-phn"><i style="background:' + c[2] + '"></i>' + esc(c[1]) + '</span><div class="cs-bar"><span style="width:' + Math.round(100 * l.length / max) + '%;background:' + c[2] + '"></span></div><b>' + l.length + '</b><small>' + (b ? money(b) : '') + '</small></div>';
    }).join('');
    var rank = { red: 0, amber: 1, grey: 2, green: 3 };
    var canDel = M.allowed('projects', 'edit') && !(M.me && M.me.scope);
    var rows = cards.slice().sort(function (a, b) { return rank[health(a)] - rank[health(b)] || ORDER.indexOf(a.phase) - ORDER.indexOf(b.phase); }).map(function (c) {
      var h = health(c), col = COLS[ORDER.indexOf(c.phase)];
      return '<tr class="click" data-plan="' + esc(c.core) + '">' + (canDel ? '<td class="cs-pick"><input type="checkbox" data-pick="' + esc(c.core) + '" aria-label="Select ' + esc(c.name) + '"></td>' : '') + '<td><span class="cs-rag cs-' + h + '" title="' + HN[h] + '"></span></td><td><b>' + esc(c.name) + '</b><br><small class="muted"><span class="ref">' + esc(c.ref) + '</span> · ' + esc(c.client) + '</small></td>' +
        '<td><span class="cs-chip" style="--pc:' + col[2] + '">' + esc(col[1]) + '</span></td>' +
        '<td style="min-width:130px">' + (c.hasPlan ? '<div class="pbar"><span style="width:' + c.pct + '%"></span></div><small>' + c.pct + '% · ' + c.done + '/' + c.total + '</small>' : '<small class="muted">No plan yet</small>') + '</td>' +
        '<td class="hide-sm">' + esc(pretty(c.finish)) + '</td><td>' + (c.SPI == null ? '–' : '<b class="ev-' + evC(c.SPI) + '-t">' + c.SPI.toFixed(2) + '</b>') + '</td><td>' + (c.CPI == null ? '–' : '<b class="ev-' + evC(c.CPI) + '-t">' + c.CPI.toFixed(2) + '</b>') + '</td>' +
        '<td class="hide-sm">' + (c.BAC ? money(c.BAC) : '–') + '</td><td class="hide-sm">' + (c.late ? '<b style="color:#C2410C">' + c.late + '</b>' : '0') + '</td><td class="hide-sm">' + c.openRisks + (c.highRisks ? ' <b style="color:#C2410C">(' + c.highRisks + ' high)</b>' : '') + '</td></tr>';
    }).join('');
    host.innerHTML = '<div class="cs-tiles">' + tiles + '</div>' +
      '<div class="cs-grid"><div class="card"><div class="card-h"><h2>Projects by PMBOK phase</h2></div>' + funnel +
      '<p class="muted cs-note">Initiation: no plan yet · Planning: planned, not started · Execution: under way · Monitoring &amp; Evaluation: 80%+ done · Closing: all done. Move a card on the Pipeline board to change it by hand.</p></div>' +
      '<div class="card"><div class="card-h"><h2>Health</h2></div><div class="cs-health">' +
      ['green', 'amber', 'red', 'grey'].map(function (k) { return '<div><span class="cs-rag cs-' + k + '"></span><b>' + H[k] + '</b><small>' + HN[k] + '</small></div>'; }).join('') +
      '</div><div class="cs-stack">' + ['green', 'amber', 'red', 'grey'].map(function (k) { return H[k] ? '<span class="cs-' + k + '" style="flex:' + H[k] + '" title="' + HN[k] + ': ' + H[k] + '"></span>' : ''; }).join('') + '</div></div></div>' +
      '<div class="card"><div class="card-h"><h2>Every project, worst first</h2>' + (canDel && n ? '<span class="sp"></span><button class="btn btn-sm btn-danger" id="csDel" disabled>🗑 Delete selected</button>' : '') + '</div>' + (n ? '<div class="table-wrap"><table><thead><tr>' + (canDel ? '<th class="cs-pick"><input type="checkbox" id="csAll" aria-label="Select all"></th>' : '') + '<th></th><th>Project</th><th>Phase</th><th>Progress</th><th class="hide-sm">Finish</th><th>SPI</th><th>CPI</th><th class="hide-sm">Budget</th><th class="hide-sm">Late</th><th class="hide-sm">Risks</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<div class="empty">No projects yet. <a class="btn btn-gold btn-sm" href="#projects/new">＋ New project</a></div>') + '</div>';
    host.querySelectorAll('[data-plan]').forEach(function (tr) { tr.onclick = function (e) { if (e.target.closest('.cs-pick')) return; location.hash = '#plan/' + tr.getAttribute('data-plan'); }; });
    var picks = function () { return [].slice.call(host.querySelectorAll('[data-pick]:checked')).map(function (x) { return cards.filter(function (c) { return c.core === x.getAttribute('data-pick'); })[0]; }); };
    var syncDel = function () { var b = host.querySelector('#csDel'), n2 = picks().length; if (b) { b.disabled = !n2; b.textContent = n2 ? '🗑 Delete ' + n2 + ' selected' : '🗑 Delete selected'; } };
    host.querySelectorAll('[data-pick]').forEach(function (x) { x.onchange = syncDel; });
    var all = host.querySelector('#csAll'); if (all) all.onchange = function () { host.querySelectorAll('[data-pick]').forEach(function (x) { x.checked = all.checked; }); syncDel(); };
    var del = host.querySelector('#csDel'); if (del) del.onclick = function () { delProjects(picks()).then(function (ok) { if (ok) load(); }); };
  }

  /* ---------------- page ---------------- */
  function draw() {
    if (!P.el || !P.data) return;
    var host = P.el.querySelector('#csBody'), cards = filtered();
    var b = cards.reduce(function (s, c) { return s + (c.BAC || 0); }, 0);
    P.el.querySelector('#pbSum').innerHTML = '<b>' + cards.length + '</b> project' + (cards.length === 1 ? '' : 's') + ' · <b>' + money(b) + '</b> total budget';
    P.el.querySelector('#pbAt').textContent = 'Updated ' + new Date(P.data.at).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Sydney' });
    P.el.querySelectorAll('[data-tab]').forEach(function (t) { t.classList.toggle('on', t.getAttribute('data-tab') === P.tab); });
    if (P.tab === 'summary') drawSummary(host); else drawBoard(host);
  }
  function load() {
    var btn = P.el && P.el.querySelector('#pbRefresh'); if (btn) btn.disabled = true;
    return api('planPipelineList', { today: today() }).then(function (d) { P.data = d; draw(); }).catch(fail).then(function () { if (btn) btn.disabled = false; });
  }
  function setFull(on) {
    document.body.classList.toggle('board-full', on);
    var b = P.el && P.el.querySelector('#pbFull'); if (b) b.textContent = on ? '✕ Exit full screen' : '⛶ Full screen';
  }
  function portfolio(args) {
    if (args && (args[0] === 'summary' || args[0] === 'board')) { P.tab = args[0]; store('champTab', P.tab); }
    var el = M.$('#view'); P.el = el;
    el.innerHTML = '<div class="cs-head"><div class="cs-tabs"><a href="#portfolio/summary" data-tab="summary" class="btn btn-sm">📊 Summary</a><a href="#portfolio/board" data-tab="board" class="btn btn-sm">▦ Pipeline board</a></div>' +
      '<span class="muted cs-tagline">Every project, from initiation to closing (PMBOK life cycle)</span></div>' +
      '<div class="pbtool"><input id="pbQ" type="search" placeholder="Find a project, client or location…" value="' + esc(P.q) + '">' +
      '<span id="pbSum" class="muted" style="font-size:13px"></span><span class="sp"></span><small class="muted" id="pbAt"></small>' +
      '<button class="btn btn-sm" id="pbRefresh">↻ Refresh</button><a class="btn btn-sm" href="#projects/new">＋ New project</a><button class="btn btn-sm btn-gold" id="pbFull">⛶ Full screen</button></div>' +
      '<div id="csBody"><div class="empty">Loading…</div></div>';
    el.querySelector('#pbQ').oninput = function () { P.q = this.value; draw(); };
    el.querySelector('#pbRefresh').onclick = load;
    el.querySelector('#pbFull').onclick = function () { setFull(!document.body.classList.contains('board-full')); };
    return load();
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && document.body.classList.contains('board-full')) setFull(false); });
  window.addEventListener('hashchange', function () { if (!/^#portfolio/.test(location.hash)) setFull(false); });
  M.addView('portfolio', 'Portfolio', portfolio);
})();
