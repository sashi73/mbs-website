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
  var P = { data: null, q: '', prog: store('champProg') || '', el: null, tab: store('champTab') || 'board', dragging: false };
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

  /* ---------------- programs (a group of related projects) ---------------- */
  function progList() { return (P.data && P.data.programs) || []; }
  function setProgram(c) {
    M.modal('<h2>📁 Program for “' + esc(c.name) + '”</h2><p class="muted">A program groups related projects (for example “ERP rollout” or “Head office move”). Ask AI and the Summary can then report on the whole program. Leave it empty to take the project out of its program.</p>' +
      '<form id="progForm"><label style="display:grid;gap:6px;font-weight:700">Program<input id="progIn" list="progDL" maxlength="80" value="' + esc(c.program || '') + '" placeholder="New or existing program"></label>' +
      '<datalist id="progDL">' + progList().map(function (x) { return '<option value="' + esc(x) + '">'; }).join('') + '</datalist>' +
      '<div class="actions" style="justify-content:flex-end;margin-top:14px"><button class="btn" type="button" data-close>Cancel</button><button class="btn btn-gold" type="submit">Save</button></div></form>');
    var f = document.getElementById('progForm'), inp = document.getElementById('progIn'); setTimeout(function () { inp.focus(); inp.select(); }, 30);
    f.onsubmit = function (e) {
      e.preventDefault();
      api('planProgramSet', { core: c.core, program: inp.value }).then(function (r) { M.closeModal(); toast(r.program ? c.name + ' is now in ' + r.program : c.name + ' taken out of its program'); load(); }).catch(fail);
    };
  }
  M.champPrograms = function () { return api('planPipelineList', { today: today() }).then(function (d) { return d.programs || []; }).catch(function () { return []; }); };

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
      (c.program ? '<div class="pc-prog" title="Program">📁 ' + esc(c.program) + '</div>' : '') +
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
      (M.allowed('projects', 'edit') && !(M.me && M.me.scope) ? '<button type="button" data-prog style="--pc:#64748B"><i></i>📁 ' + (c.program ? 'Program: ' + esc(c.program) + '…' : 'Put in a program…') + '</button>' : '') +
      (M.allowed('projects', 'edit') && !(M.me && M.me.scope) ? '<hr style="border:0;border-top:1px solid var(--line);margin:4px 0"><button type="button" data-del style="--pc:#DC2626;color:#B91C1C"><i></i>🗑 Delete project…</button>' : '');
    document.body.appendChild(m);
    m.style.top = Math.min(innerHeight - m.offsetHeight - 8, rc.bottom + 4) + 'px'; m.style.left = Math.max(8, Math.min(innerWidth - m.offsetWidth - 8, rc.right - m.offsetWidth)) + 'px';
    var close = function () { m.remove(); document.removeEventListener('pointerdown', out, true); };
    var out = function (e) { if (!m.contains(e.target)) close(); };
    setTimeout(function () { document.addEventListener('pointerdown', out, true); }, 0);
    m.querySelectorAll('[data-to]').forEach(function (b) { b.onclick = function () { close(); moveTo(c, b.getAttribute('data-to')); }; });
    var pg = m.querySelector('[data-prog]'); if (pg) pg.onclick = function () { close(); setProgram(c); };
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
    return P.data.cards.filter(function (c) { return (!P.prog || (P.prog === '-' ? !c.program : c.program === P.prog)) && (!q || (c.ref + ' ' + c.name + ' ' + c.client + ' ' + c.site + ' ' + (c.program || '')).toLowerCase().indexOf(q) >= 0); });
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
    var progs = {}; cards.forEach(function (c) { var k = c.program || ''; (progs[k] = progs[k] || []).push(c); });
    var progRows = Object.keys(progs).filter(function (k) { return k; }).sort().map(function (k) {
      var L = progs[k], s2 = function (f) { return L.reduce(function (a, c) { return a + (c[f] || 0); }, 0); };
      var pv = s2('PV'), ev = s2('EV'), ac = s2('AC'), sp = pv > 0 ? ev / pv : null, cp = ac > 0 ? ev / ac : null;
      var red = L.filter(function (c) { return health(c) === 'red'; }).length;
      return '<tr><td><b>📁 ' + esc(k) + '</b></td><td>' + L.length + '</td><td>' + money(s2('BAC')) + '</td><td class="hide-sm">' + money(ev) + '</td><td class="hide-sm">' + money(ac) + '</td>' +
        '<td>' + (sp == null ? '–' : '<b class="ev-' + evC(sp) + '-t">' + sp.toFixed(2) + '</b>') + '</td><td>' + (cp == null ? '–' : '<b class="ev-' + evC(cp) + '-t">' + cp.toFixed(2) + '</b>') + '</td>' +
        '<td>' + s2('late') + '</td><td>' + (red ? '<b style="color:#B91C1C">' + red + '</b>' : '0') + '</td></tr>';
    }).join('');
    var progCard = '<div class="card"><div class="card-h"><h2>By program</h2><span class="sp"></span><a class="btn btn-sm" href="#sql/ask">✨ Ask AI about a program</a></div>' + (progRows ?
      '<div class="table-wrap"><table><thead><tr><th>Program</th><th>Projects</th><th>Budget</th><th class="hide-sm">Earned</th><th class="hide-sm">Spent</th><th>SPI</th><th>CPI</th><th>Late tasks</th><th>At risk</th></tr></thead><tbody>' + progRows + '</tbody></table></div>' +
      (progs[''] ? '<p class="muted cs-note">' + progs[''].length + ' project' + (progs[''].length === 1 ? '' : 's') + ' not in a program.</p>' : '')
      : '<p class="muted">No programs yet. Group related projects into a program with ⇄ → “Put in a program…” on the Pipeline board, or when you make a new project.</p>') + '</div>';
    host.innerHTML = '<div class="cs-tiles">' + tiles + '</div>' +
      '<div class="cs-grid"><div class="card"><div class="card-h"><h2>Projects by PMBOK phase</h2></div>' + funnel +
      '<p class="muted cs-note">Initiation: no plan yet · Planning: planned, not started · Execution: under way · Monitoring &amp; Evaluation: 80%+ done · Closing: all done. Move a card on the Pipeline board to change it by hand.</p></div>' +
      '<div class="card"><div class="card-h"><h2>Health</h2></div><div class="cs-health">' +
      ['green', 'amber', 'red', 'grey'].map(function (k) { return '<div><span class="cs-rag cs-' + k + '"></span><b>' + H[k] + '</b><small>' + HN[k] + '</small></div>'; }).join('') +
      '</div><div class="cs-stack">' + ['green', 'amber', 'red', 'grey'].map(function (k) { return H[k] ? '<span class="cs-' + k + '" style="flex:' + H[k] + '" title="' + HN[k] + ': ' + H[k] + '"></span>' : ''; }).join('') + '</div></div></div>' +
      progCard + '<div class="card"><div class="card-h"><h2>Every project, worst first</h2>' + (canDel && n ? '<span class="sp"></span><button class="btn btn-sm btn-danger" id="csDel" disabled>🗑 Delete selected</button>' : '') + '</div>' + (n ? '<div class="table-wrap"><table><thead><tr>' + (canDel ? '<th class="cs-pick"><input type="checkbox" id="csAll" aria-label="Select all"></th>' : '') + '<th></th><th>Project</th><th>Phase</th><th>Progress</th><th class="hide-sm">Finish</th><th>SPI</th><th>CPI</th><th class="hide-sm">Budget</th><th class="hide-sm">Late</th><th class="hide-sm">Risks</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<div class="empty">No projects yet. <a class="btn btn-gold btn-sm" href="#projects/new">＋ New project</a></div>') + '</div>';
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
    var ps = P.el.querySelector('#pbProg'), pl = progList();
    if (P.prog && P.prog !== '-' && pl.indexOf(P.prog) < 0) { P.prog = ''; store('champProg', ''); }
    ps.innerHTML = '<option value="">📁 All programs</option>' + pl.map(function (x) { return '<option value="' + esc(x) + '"' + (x === P.prog ? ' selected' : '') + '>📁 ' + esc(x) + '</option>'; }).join('') + (pl.length ? '<option value="-"' + (P.prog === '-' ? ' selected' : '') + '>Not in a program</option>' : '');
    ps.hidden = !pl.length;
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
      '<select id="pbProg" aria-label="Program" style="width:auto"></select><span id="pbSum" class="muted" style="font-size:13px"></span><span class="sp"></span><small class="muted" id="pbAt"></small>' +
      '<button class="btn btn-sm" id="pbRefresh">↻ Refresh</button><a class="btn btn-sm" href="#projects/new">＋ New project</a><button class="btn btn-sm btn-gold" id="pbFull">⛶ Full screen</button></div>' +
      '<div id="csBody"><div class="empty">Loading…</div></div>';
    el.querySelector('#pbQ').oninput = function () { P.q = this.value; draw(); };
    el.querySelector('#pbProg').onchange = function () { P.prog = this.value; store('champProg', P.prog); draw(); };
    el.querySelector('#pbRefresh').onclick = load;
    el.querySelector('#pbFull').onclick = function () { setFull(!document.body.classList.contains('board-full')); };
    return load();
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && document.body.classList.contains('board-full')) setFull(false); });
  window.addEventListener('hashchange', function () { if (!/^#portfolio/.test(location.hash)) setFull(false); });
  M.addView('portfolio', 'Portfolio', portfolio);

  /* ---------------- Admin > Builds: every build that went live ---------------- */
  function builds() {
    var el = M.$('#view');
    if (!(M.me && M.me.owner)) { el.innerHTML = '<div class="card noaccess"><h2>🔒 Owner only</h2><p class="muted">The build registry is for the owner login.</p></div>'; return; }
    el.innerHTML = '<div class="empty">Loading builds…</div>';
    return api('buildList').then(function (d) {
      var c = d.current || {}, repo = d.repo, short = function (x) { return (x || '').slice(0, 7); };
      var when = function (t) { return t ? new Date(t).toLocaleString('en-AU', { timeZone: 'Australia/Sydney', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; };
      var link = function (b) {
        return (b.commit ? '<a href="' + repo + '/commit/' + esc(b.commit) + '" target="_blank" rel="noopener"><code>' + esc(short(b.commit)) + '</code></a>' : '<span class="muted">local</span>');
      };
      var dep = function (b) { return b.deployId && b.site ? '<a href="https://app.netlify.com/projects/' + esc(b.site) + '/deploys/' + esc(b.deployId) + '" target="_blank" rel="noopener">' + esc(b.deployId.slice(-8)) + '</a>' : '<span class="muted">–</span>'; };
      el.innerHTML = '<div class="cs-tiles">' +
        '<div class="cs-tile cs-green"><span>Running now</span><b>PC ' + esc(c.version + '.' + c.build) + '</b><small>Build ' + esc(String(c.build)) + ' · ' + esc(c.context || '') + '</small></div>' +
        '<div class="cs-tile"><span>Commit</span><b style="font-size:20px">' + link(c) + '</b><small>' + esc(c.subject || c.branch || '') + '</small></div>' +
        '<div class="cs-tile"><span>Deploy</span><b style="font-size:20px">' + dep(c) + '</b><small>Built ' + esc(c.builtAt ? when(Date.parse(c.builtAt)) : '') + '</small></div>' +
        '<div class="cs-tile"><span>Registry</span><b>' + d.list.length + '</b><small>builds that went live · <a href="' + repo + '/blob/' + esc(c.branch || 'GKH-Project-Champ') + '/BUILDS.md" target="_blank" rel="noopener">BUILDS.md</a></small></div></div>' +
        '<div class="card"><div class="card-h"><h2>🏷 Build registry</h2><span class="sp"></span><small class="muted">Every build gets its number on commit (BUILDS.md and “Build: N” in the commit message); this list records when each one went live.</small></div>' +
        (d.list.length ? '<div class="table-wrap"><table><thead><tr><th>Build</th><th>Version</th><th>Live since</th><th>Commit</th><th>Change</th><th class="hide-sm">Branch</th><th class="hide-sm">Deploy</th></tr></thead><tbody>' +
          d.list.map(function (b, i) { return '<tr' + (i === 0 ? ' style="background:var(--gold-soft,#FFF8E1)"' : '') + '><td><b>' + esc(String(b.build)) + '</b>' + (i === 0 ? ' <span class="pflag pf-green">live</span>' : '') + '</td><td>' + esc(b.label) + '</td><td>' + esc(when(b.liveSince)) + '</td><td>' + link(b) + '</td><td>' + esc(b.subject || '') + '</td><td class="hide-sm">' + esc(b.branch || '') + '</td><td class="hide-sm">' + dep(b) + '</td></tr>'; }).join('') + '</tbody></table></div>'
          : '<div class="empty">No builds recorded yet.</div>') + '</div>';
    }).catch(fail);
  }
  M.addView('builds', 'Builds', builds);

  /* ---------------- Customers > Visitors: people who introduced themselves to Champ (potential customers) ---------------- */
  var VS = { q: '', sel: {} };
  var LNAME = { en: 'English', ms: 'Bahasa Melayu', id: 'Bahasa Indonesia', ta: 'தமிழ் Tamil', zh: '中文 Chinese', hi: 'हिन्दी Hindi', ar: 'العربية Arabic', fa: 'فارسی Persian', vi: 'Tiếng Việt', th: 'ไทย Thai',
    tl: 'Filipino', ja: '日本語 Japanese', ko: '한국어 Korean', es: 'Español', fr: 'Français', de: 'Deutsch', pt: 'Português', sw: 'Kiswahili', rw: 'Kinyarwanda' };
  function visitors() {
    var el = M.$('#view');
    if (!M.allowed('crm', 'view')) { el.innerHTML = '<div class="card noaccess"><h2>🔒 No access</h2><p class="muted">Visitors need access to Jobs &amp; customers.</p></div>'; return; }
    el.innerHTML = '<div class="empty">Loading visitors…</div>';
    var canDel = M.allowed('crm', 'edit');
    return api('visitorList').then(function (d) {
      var all = d.list || [];
      var when = function (t) { return t ? new Date(t).toLocaleString('en-AU', { timeZone: 'Australia/Sydney', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; };
      var week = Date.now() - 7 * 864e5;
      var wpk = function (v) {
        if (v.welcome === 'yes') return v.welcomeStatus === 'sent' ? '<span class="pflag pf-green" title="Sent ' + esc(when(v.welcomeAt)) + '">✓ Sent</span>'
          : v.welcomeStatus === 'failed' ? '<span class="pflag pf-red" title="' + esc(v.welcomeNote || '') + '">Failed: send manually</span>'
          : '<span class="pflag pf-amber" title="Email sending is not set up yet">Wants it: send manually</span>';
        return v.welcome === 'no' ? '<span class="muted">No thanks</span>' : '<span class="muted">–</span>';
      };
      var tiles = '<div class="cs-tiles">' +
        '<div class="cs-tile"><span>Visitors</span><b>' + all.length + '</b><small>introduced themselves to Champ</small></div>' +
        '<div class="cs-tile cs-green"><span>With contact details</span><b>' + all.filter(function (v) { return v.email || v.phone; }).length + '</b><small>phone or email</small></div>' +
        '<div class="cs-tile"><span>Want the welcome package</span><b>' + all.filter(function (v) { return v.welcome === 'yes'; }).length + '</b><small>' + all.filter(function (v) { return v.welcome === 'yes' && v.welcomeStatus !== 'sent'; }).length + ' still to send</small></div>' +
        '<div class="cs-tile"><span>This week</span><b>' + all.filter(function (v) { return Date.parse(v.created) > week; }).length + '</b><small>new in the last 7 days</small></div></div>';
      var c = d.counter || {}, n = function (x) { return Number(x || 0).toLocaleString('en-AU'); };
      var mx = Math.max.apply(null, (c.last14 || []).map(function (x) { return x[2]; }).concat([1]));
      var traffic = '<div class="card"><div class="card-h"><h2>👁 Website visitor counter</h2><span class="sp"></span><small class="muted">' + (c.since ? 'Counting since ' + esc(when(c.since)) : '') + '</small></div>' +
        '<div class="cs-tiles" style="margin:0 0 12px">' +
        '<div class="cs-tile cs-green"><span>Visitors</span><b>' + n(c.visitors) + '</b><small>different browsers, all time</small></div>' +
        '<div class="cs-tile"><span>Today</span><b>' + n(c.today) + '</b><small>' + n(c.todayVisits) + ' visits</small></div>' +
        '<div class="cs-tile"><span>Last 7 days</span><b>' + n(c.week) + '</b><small>' + n(c.weekVisits) + ' visits</small></div>' +
        '<div class="cs-tile"><span>Visits</span><b>' + n(c.visits) + '</b><small>all time</small></div></div>' +
        '<div style="display:flex;gap:4px;align-items:flex-end;height:90px;padding:0 2px" aria-label="Visits, last 14 days">' + (c.last14 || []).map(function (x) {
          return '<div title="' + esc(x[0]) + ': ' + x[1] + ' new visitors, ' + x[2] + ' visits" style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%"><small class="muted" style="font-size:10px">' + (x[2] || '') + '</small><div style="width:100%;border-radius:4px 4px 0 0;background:#C9A227;height:' + Math.max(2, Math.round(70 * x[2] / mx)) + 'px"></div><small class="muted" style="font-size:9.5px">' + esc(x[0].slice(8)) + '</small></div>'; }).join('') + '</div>' +
        ((c.pages || []).length ? '<p class="muted" style="font-size:12.5px;margin:10px 2px 0">Most visited: ' + c.pages.map(function (p) { return esc(p[0]) + ' (' + n(p[1]) + ')'; }).join(' · ') + '</p>' : '') + '</div>';
      el.innerHTML = traffic + tiles + (d.email ? '' : '<div class="card" style="border-left:4px solid #c9a227"><b>Welcome packages are not emailed automatically yet.</b> <span class="muted">Add RESEND_API_KEY (and FROM_EMAIL from a verified domain) in Netlify; until then, the people marked “Wants it” are waiting for you to send one.</span></div>') +
        '<div class="card"><div class="card-h"><h2>👋 Visitors &amp; potential customers</h2><span class="sp"></span>' +
        '<input id="vsQ" type="search" placeholder="Find a name, email, phone, language or country…" value="' + esc(VS.q) + '" style="max-width:300px">' +
        '<button class="btn btn-sm" id="vsCsv">⬇ CSV</button>' + (canDel ? '<button class="btn btn-sm" id="vsDel" disabled>🗑 Delete</button>' : '') + '<button class="btn btn-sm" id="vsRef">↻</button></div>' +
        '<div id="vsBody"></div><p class="muted" style="font-size:12px;margin:10px 2px 0">Champ greets every new visitor, asks their language (by voice or tap), then asks them to type their name, phone, email and reason for visiting, with the PDPA privacy notice and a consent tick. The welcome pack is only emailed with consent on record. A visitor can skip, or tell Champ “forget me”.</p></div>';
      function rows() {
        var q = VS.q.trim().toLowerCase();
        return all.filter(function (v) { return !q || [v.name, v.email, v.phone, v.purpose, v.more, LNAME[v.lang] || v.lang, v.country, v.city].join(' ').toLowerCase().indexOf(q) >= 0; });
      }
      function draw() {
        var r = rows(), b = el.querySelector('#vsBody');
        if (!r.length) { b.innerHTML = '<div class="empty">' + (all.length ? 'No visitor matches that.' : 'No visitors yet. When someone opens Ask Champ on the website and introduces themselves, they appear here.') + '</div>'; return; }
        b.innerHTML = '<div class="table-wrap"><table><thead><tr>' + (canDel ? '<th style="width:28px"><input type="checkbox" id="vsAll" aria-label="Select all"></th>' : '') +
          '<th>Name</th><th>Phone</th><th>Email</th><th>Reason for visit</th><th>Language</th><th>Welcome pack</th><th class="hide-sm">PDPA consent</th><th class="hide-sm">From</th><th class="hide-sm">First seen</th><th class="hide-sm">Last seen</th><th class="hide-sm">Visits</th></tr></thead><tbody>' +
          r.map(function (v) {
            return '<tr>' + (canDel ? '<td><input type="checkbox" data-vid="' + esc(v.id) + '"' + (VS.sel[v.id] ? ' checked' : '') + '></td>' : '') +
              '<td><b>' + (v.name ? esc(v.name) : '<span class="muted">(skipped)</span>') + '</b></td>' +
              '<td>' + (v.phone ? '<a href="tel:' + esc(v.phone) + '">' + esc(v.phone) + '</a> <a href="https://wa.me/' + esc(v.phone.replace('+', '')) + '" target="_blank" rel="noopener" title="WhatsApp">💬</a>' : '<span class="muted">–</span>') + '</td>' +
              '<td>' + (v.email ? '<a href="mailto:' + esc(v.email) + '">' + esc(v.email) + '</a>' : '<span class="muted">–</span>') + '</td>' +
              '<td>' + (v.purpose ? esc(v.purpose) + (v.more ? '<br><small class="muted">' + esc(v.more) + '</small>' : '') : '<span class="muted">–</span>') + '</td>' +
              '<td>' + esc(LNAME[v.lang] || v.lang || '–') + '</td><td>' + wpk(v) + '</td>' +
              '<td class="hide-sm">' + (v.consentAt ? '<span class="pflag pf-green" title="' + esc(v.consentVer || '') + '">✓ ' + esc(when(v.consentAt)) + '</span>' : '<span class="muted">–</span>') + '</td>' +
              '<td class="hide-sm">' + esc([v.city, v.country].filter(Boolean).join(', ') || '–') + '</td>' +
              '<td class="hide-sm">' + esc(when(v.created)) + '</td><td class="hide-sm">' + esc(when(v.lastSeen || v.updated)) + '</td><td class="hide-sm">' + esc(String(v.visits || 1)) + '</td></tr>';
          }).join('') + '</tbody></table></div>';
        b.querySelectorAll('[data-vid]').forEach(function (c) { c.onchange = function () { if (c.checked) VS.sel[c.getAttribute('data-vid')] = 1; else delete VS.sel[c.getAttribute('data-vid')]; selCount(); }; });
        var a = b.querySelector('#vsAll'); if (a) a.onchange = function () { r.forEach(function (v) { if (a.checked) VS.sel[v.id] = 1; else delete VS.sel[v.id]; }); draw(); selCount(); };
      }
      function selCount() { var n = Object.keys(VS.sel).length, d2 = el.querySelector('#vsDel'); if (d2) { d2.disabled = !n; d2.textContent = n ? '🗑 Delete ' + n : '🗑 Delete'; } }
      el.querySelector('#vsQ').oninput = function () { VS.q = this.value; draw(); };
      el.querySelector('#vsRef').onclick = visitors;
      el.querySelector('#vsCsv').onclick = function () {
        var cols = ['first', 'last', 'name', 'phone', 'email', 'purpose', 'more', 'lang', 'consentAt', 'welcome', 'welcomeStatus', 'city', 'country', 'created', 'lastSeen', 'visits'];
        var q = function (x) { x = x == null ? '' : String(x); if (/^[=+\-@]/.test(x) && !/^\+\d+$/.test(x)) x = "'" + x; return '"' + x.replace(/"/g, '""') + '"'; };
        var csv = cols.join(',') + '\n' + rows().map(function (v) { return cols.map(function (c) { return q(c === 'lang' ? (LNAME[v.lang] || v.lang) : v[c]); }).join(','); }).join('\n');
        var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); a.download = 'champ-visitors-' + new Date().toISOString().slice(0, 10) + '.csv'; a.click();
      };
      var del = el.querySelector('#vsDel');
      if (del) del.onclick = function () {
        var ids = Object.keys(VS.sel); if (!ids.length) return;
        M.confirmBox('Delete ' + (ids.length === 1 ? 'this visitor' : ids.length + ' visitors') + '?', 'Their name and contact details are removed from Project Champ. <b>This can\'t be undone.</b>', '🗑 Delete', true).then(function (ok) {
          if (!ok) return;
          api('visitorDelete', { ids: ids }).then(function (r) { toast((r.removed || 0) + ' deleted'); VS.sel = {}; visitors(); }).catch(fail);
        });
      };
      draw(); selCount();
    }).catch(fail);
  }
  M.addView('visitors', 'Visitors', visitors);
})();
