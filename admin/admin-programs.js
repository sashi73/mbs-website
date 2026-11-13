/* GKH Project Champ: Programs (the top level: every project belongs to one) and the Dependency board.
   #programs            every program with its roll-up (health, % complete, budget, SPI, CPI, forecast finish, links)
   #programs/<id>       one program: its projects, its roadmap with dependency arrows, edit, move projects in and out
   #deps                the Dependency board: every program as a swimlane on one timeline, projects as bars, links as arrows */
(function () {
  'use strict';
  var M = window.MBS; if (!M) return;
  var api = M.api, esc = M.esc, fail = M.fail, toast = M.toast;
  var money = function (n) { n = Math.round(n || 0); return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-AU'); };   // whole dollars on the boards
  var DAY = 864e5, MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var PH = { init: ['Initiation', '#3B82F6'], plan: ['Planning', '#8B5CF6'], exec: ['Execution', '#F59E0B'], monitor: ['Monitoring & Evaluation', '#10B981'], close: ['Closing', '#6B7280'] };
  var HN = { green: 'On track', amber: 'Watch', red: 'At risk', grey: 'No plan yet' };
  var DS = { conflict: ['Clash', '#DC2626'], risk: ['At risk', '#F59E0B'], unknown: ['No dates', '#94A3B8'], ok: ['OK', '#10B981'], done: ['Done', '#64748B'] };
  var DSRANK = { conflict: 0, risk: 1, unknown: 2, ok: 3, done: 4 };
  var COLORS = ['#C9A227', '#3B82F6', '#10B981', '#8B5CF6', '#EF4444', '#F97316', '#14B8A6', '#EC4899', '#64748B', '#84CC16'];
  var D = null;   // the last planProgramList answer
  var t2ms = function (s) { return s ? Date.parse(s + 'T00:00:00Z') : NaN; };
  var pretty = function (s) { if (!s) return '–'; var a = s.split('-').map(Number); return a[2] + ' ' + MON[a[1] - 1] + ' ' + String(a[0]).slice(2); };
  var evC = function (v) { return v == null ? 'grey' : v >= 1 ? 'green' : v >= 0.9 ? 'amber' : 'red'; };
  var today = function () { var o = {}; new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).forEach(function (p) { o[p.type] = p.value; }); return o.year + '-' + o.month + '-' + o.day; };
  var canEdit = function () { return M.allowed('projects', 'edit') && !(M.me && M.me.scope); };
  function load() { return api('planProgramList', { today: today() }).then(function (d) { D = d; return d; }); }

  /* ---------------- roll-ups ---------------- */
  function projectsOf(p) { return D.cards.filter(function (c) { return c.program === p.name; }); }
  function depsOf(cores) { return D.deps.filter(function (d) { return cores[d.from] || cores[d.to]; }); }
  function roll(p) {
    var L = projectsOf(p), sum = function (k) { return L.reduce(function (s, c) { return s + (c[k] || 0); }, 0); };
    var BAC = sum('BAC'), EV = sum('EV'), AC = sum('AC'), PV = sum('PV'), H = { red: 0, amber: 0, green: 0, grey: 0 };
    L.forEach(function (c) { H[c.health || 'grey']++; });
    var pct = BAC > 0 ? Math.round(L.reduce(function (s, c) { return s + (c.pct || 0) * (c.BAC || 0); }, 0) / BAC) : (L.length ? Math.round(sum('pct') / L.length) : 0);
    var starts = L.map(function (c) { return c.start; }).filter(Boolean).sort(), ends = L.map(function (c) { return c.forecast || c.finish; }).filter(Boolean).sort();
    var cores = {}; L.forEach(function (c) { cores[c.core] = 1; });
    var dl = depsOf(cores), probs = dl.filter(function (d) { return d.status === 'conflict' || d.status === 'risk'; });
    var spi = PV > 0 ? EV / PV : null, cpi = AC > 0 ? EV / AC : null;
    var health = !L.length ? 'grey' : H.red || (spi != null && spi < 0.9) || (cpi != null && cpi < 0.9) || dl.some(function (d) { return d.status === 'conflict'; }) ? 'red'
      : H.amber || probs.length || (spi != null && spi < 1) || (cpi != null && cpi < 1) ? 'amber' : H.green ? 'green' : 'grey';
    return { list: L, n: L.length, BAC: BAC, EV: EV, AC: AC, PV: PV, spi: spi, cpi: cpi, pct: pct, H: H, health: health, start: starts[0] || '', finish: ends[ends.length - 1] || '', deps: dl, probs: probs, late: sum('late') };
  }
  function rag(h, title) { return '<span class="cs-rag cs-' + h + '" title="' + esc(title || HN[h] || '') + '"></span>'; }
  function tile(label, value, sub, cls) { return '<div class="cs-tile' + (cls ? ' ' + cls : '') + '"><span>' + label + '</span><b>' + value + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</div>'; }
  function phaseStack(L) {
    var n = {}; L.forEach(function (c) { n[c.phase] = (n[c.phase] || 0) + 1; });
    return '<div class="pg-phases" title="Projects by PMBOK phase">' + Object.keys(PH).map(function (k) { return n[k] ? '<span style="flex:' + n[k] + ';background:' + PH[k][1] + '" title="' + PH[k][0] + ': ' + n[k] + '"></span>' : ''; }).join('') + '</div>';
  }
  function head(active) {
    return '<div class="cs-head"><div class="cs-tabs"><a href="#programs" class="btn btn-sm' + (active === 'programs' ? ' on' : '') + '">🗂 Programs</a>' +
      '<a href="#deps" class="btn btn-sm' + (active === 'deps' ? ' on' : '') + '">🔗 Dependency board</a><a href="#portfolio/summary" class="btn btn-sm">📊 Summary</a><a href="#portfolio/board" class="btn btn-sm">▦ Pipeline board</a></div>' +
      '<span class="muted cs-tagline">Programs → projects. Every project belongs to a program.</span></div>';
  }

  /* ---------------- #programs ---------------- */
  var Q = { q: '' };
  function programsView(args) {
    if (args && args[0]) return programView(args[0]);
    var el = M.$('#view'); el.innerHTML = head('programs') + '<div class="empty">Loading programs…</div>';
    load().then(function () {
      var R = D.programs.map(function (p) { return { p: p, r: roll(p) }; });
      var all = D.cards, BAC = all.reduce(function (s, c) { return s + (c.BAC || 0); }, 0), EV = all.reduce(function (s, c) { return s + (c.EV || 0); }, 0), AC = all.reduce(function (s, c) { return s + (c.AC || 0); }, 0), PV = all.reduce(function (s, c) { return s + (c.PV || 0); }, 0);
      var spi = PV > 0 ? EV / PV : null, cpi = AC > 0 ? EV / AC : null, probs = D.deps.filter(function (d) { return d.status === 'conflict' || d.status === 'risk'; });
      var red = R.filter(function (x) { return x.r.health === 'red'; }).length;
      el.innerHTML = head('programs') +
        '<div class="cs-tiles">' + tile('Programs', D.programs.length, R.filter(function (x) { return x.p.status === 'active'; }).length + ' active') +
        tile('Projects', all.length, 'every one in a program') + tile('Programs at risk', red, 'a project at risk, SPI/CPI under 0.90 or a clash', red ? 'cs-red' : 'cs-green') +
        tile('Total budget', money(BAC), 'earned ' + money(EV) + ' · spent ' + money(AC)) +
        tile('Portfolio SPI', spi == null ? '–' : spi.toFixed(2), 'schedule', 'ev-' + evC(spi)) + tile('Portfolio CPI', cpi == null ? '–' : cpi.toFixed(2), 'cost', 'ev-' + evC(cpi)) +
        tile('Dependencies', D.deps.length, probs.length ? '<a href="#deps">' + probs.length + ' need attention →</a>' : 'all clear', probs.length ? 'cs-amber' : '') + '</div>' +
        '<div class="pbtool"><input id="pgQ" type="search" placeholder="Find a program or project…" value="' + esc(Q.q) + '"><span class="sp"></span>' +
        (canEdit() ? '<button class="btn btn-sm btn-gold" id="pgNew">＋ New program</button>' : '') + '<a class="btn btn-sm" href="#deps">🔗 Dependency board</a></div>' +
        '<div class="pg-grid" id="pgGrid"></div>';
      var draw = function () {
        var q = Q.q.trim().toLowerCase();
        var list = R.filter(function (x) { return !q || (x.p.name + ' ' + (x.p.key || '') + ' ' + x.p.manager + ' ' + x.p.sponsor + ' ' + x.r.list.map(function (c) { return c.name + ' ' + c.ref; }).join(' ')).toLowerCase().indexOf(q) >= 0; })
          .sort(function (a, b) { var k = { red: 0, amber: 1, green: 2, grey: 3 }; return (a.p.status === 'closed') - (b.p.status === 'closed') || k[a.r.health] - k[b.r.health] || a.p.name.localeCompare(b.p.name); });
        el.querySelector('#pgGrid').innerHTML = list.length ? list.map(progCard).join('') : '<div class="empty">No program matches that.</div>';
        el.querySelectorAll('[data-pg]').forEach(function (c) { c.onclick = function (e) { if (e.target.closest('a')) return; location.hash = '#programs/' + c.getAttribute('data-pg'); }; });
      };
      el.querySelector('#pgQ').oninput = function () { Q.q = this.value; draw(); };
      var nb = el.querySelector('#pgNew'); if (nb) nb.onclick = function () { editProgram(null); };
      draw();
    }).catch(fail);
  }
  function progCard(x) {
    var p = x.p, r = x.r, st = D.statuses[p.status] || 'Active';
    var top = r.list.slice().sort(function (a, b) { var k = { red: 0, amber: 1, grey: 2, green: 3 }; return k[a.health] - k[b.health]; }).slice(0, 4);
    return '<article class="pg-card" data-pg="' + esc(p.id) + '" style="--pg:' + esc(p.color || '#C9A227') + '" tabindex="0">' +
      '<div class="pg-top">' + rag(r.health) + (p.key ? '<span class="pgref">' + esc(p.key) + '</span>' : '') + '<h3>' + esc(p.name) + '</h3><span class="pg-st pg-' + esc(p.status || 'active') + '">' + esc(st) + '</span></div>' +
      (p.manager || p.sponsor ? '<p class="pg-who">' + [p.manager ? 'Manager: ' + esc(p.manager) : '', p.sponsor ? 'Sponsor: ' + esc(p.sponsor) : ''].filter(Boolean).join(' · ') + '</p>' : '') +
      '<div class="pbar"><span style="width:' + r.pct + '%"></span></div><div class="pg-nums"><span><b>' + r.pct + '%</b> complete</span><span><b>' + r.n + '</b> project' + (r.n === 1 ? '' : 's') + '</span><span><b>' + money(r.BAC) + '</b></span></div>' +
      '<div class="pg-nums"><span>SPI ' + (r.spi == null ? '–' : '<b class="ev-' + evC(r.spi) + '-t">' + r.spi.toFixed(2) + '</b>') + '</span><span>CPI ' + (r.cpi == null ? '–' : '<b class="ev-' + evC(r.cpi) + '-t">' + r.cpi.toFixed(2) + '</b>') + '</span><span>' + pretty(r.start) + ' → ' + pretty(r.finish) + '</span></div>' +
      phaseStack(r.list) +
      '<ul class="pg-projs">' + (top.length ? top.map(function (c) { return '<li>' + rag(c.health) + '<a href="#plan/' + esc(c.core) + '">' + esc(c.name) + '</a><small>' + (c.hasPlan ? c.pct + '%' : 'no plan') + '</small></li>'; }).join('') + (r.n > 4 ? '<li class="muted">… and ' + (r.n - 4) + ' more</li>' : '') : '<li class="muted">No projects yet</li>') + '</ul>' +
      '<div class="pg-foot">' + (r.deps.length ? '<span>🔗 ' + r.deps.length + ' link' + (r.deps.length === 1 ? '' : 's') + (r.probs.length ? ' · <b style="color:#B45309">' + r.probs.length + ' need attention</b>' : '') + '</span>' : '<span class="muted">No dependencies</span>') + '<span class="sp"></span><b>Open →</b></div></article>';
  }

  /* ---------------- #programs/<id> ---------------- */
  function programView(id) {
    var el = M.$('#view'); el.innerHTML = head('programs') + '<div class="empty">Loading…</div>';
    load().then(function () {
      var p = D.programs.filter(function (x) { return x.id === id; })[0];
      if (!p) { el.innerHTML = head('programs') + '<div class="card"><h2>Program not found</h2><p class="muted">It may have been deleted.</p><a class="btn" href="#programs">← All programs</a></div>'; return; }
      var r = roll(p), ed = canEdit(), others = D.programs.filter(function (x) { return x.id !== p.id; });
      el.innerHTML = head('programs') +
        '<div class="pg-hero" style="--pg:' + esc(p.color || '#C9A227') + '"><a href="#programs" class="muted">← All programs</a>' +
        '<div class="pg-hero-t">' + rag(r.health) + (p.key ? '<span class="pgref pgref-lg" title="Program reference key: shown on every project in this program">' + esc(p.key) + '</span>' : '') + '<h1>' + esc(p.name) + '</h1><span class="pg-st pg-' + esc(p.status || 'active') + '">' + esc(D.statuses[p.status] || 'Active') + '</span><span class="sp"></span>' +
        (ed ? '<button class="btn btn-sm" id="pgEdit">✎ Edit program</button><button class="btn btn-sm" id="pgDel">🗑 Delete</button>' : '') + '</div>' +
        (p.objective ? '<p class="pg-obj">' + esc(p.objective) + '</p>' : '') +
        '<p class="pg-who">' + [p.manager ? '<b>Program manager:</b> ' + esc(p.manager) : '', p.sponsor ? '<b>Sponsor:</b> ' + esc(p.sponsor) : '', p.start || p.finish ? '<b>Target:</b> ' + pretty(p.start) + ' → ' + pretty(p.finish) : ''].filter(Boolean).join(' &nbsp;·&nbsp; ') + '</p></div>' +
        '<div class="cs-tiles">' + tile('Projects', r.n, r.H.red ? r.H.red + ' at risk' : r.H.amber ? r.H.amber + ' to watch' : 'all on track', r.H.red ? 'cs-red' : '') +
        tile('Complete', r.pct + '%', 'weighted by budget') + tile('Budget', money(r.BAC), 'earned ' + money(r.EV) + ' · spent ' + money(r.AC)) +
        tile('SPI', r.spi == null ? '–' : r.spi.toFixed(2), 'schedule', 'ev-' + evC(r.spi)) + tile('CPI', r.cpi == null ? '–' : r.cpi.toFixed(2), 'cost', 'ev-' + evC(r.cpi)) +
        tile('Forecast finish', pretty(r.finish), p.finish ? (r.finish && r.finish > p.finish ? '<b style="color:#B91C1C">after the ' + pretty(p.finish) + ' target</b>' : 'target ' + pretty(p.finish)) : 'from the plans', r.finish && p.finish && r.finish > p.finish ? 'cs-red' : '') +
        tile('Dependencies', r.deps.length, r.probs.length ? r.probs.length + ' need attention' : 'all clear', r.probs.length ? 'cs-amber' : '') + '</div>' +
        '<div class="card"><div class="card-h"><h2>🗺 Roadmap and dependencies</h2><span class="sp"></span>' + (ed ? '<button class="btn btn-sm" data-link>🔗 Link projects</button>' : '') + '<a class="btn btn-sm" href="#deps">Whole portfolio →</a></div><div id="pgBoard"></div></div>' +
        '<div class="card"><div class="card-h"><h2>Projects in this program</h2><span class="sp"></span>' +
        (ed ? '<button class="btn btn-sm" id="pgMoveIn"' + (others.length ? '' : ' disabled') + '>⇄ Move a project here</button><button class="btn btn-sm btn-gold" id="pgNewProj">＋ New project in this program</button>' : '') + '</div>' +
        (r.n ? '<div class="table-wrap"><table><thead><tr><th></th><th>Project</th><th>Phase</th><th>Progress</th><th class="hide-sm">Start</th><th>Forecast finish</th><th>SPI</th><th>CPI</th><th class="hide-sm">Budget</th><th class="hide-sm">Links</th>' + (ed && others.length ? '<th>Move to</th>' : '') + '</tr></thead><tbody>' +
          r.list.slice().sort(function (a, b) { return (a.start || '9') < (b.start || '9') ? -1 : 1; }).map(function (c) {
            var ph = PH[c.phase] || PH.init, links = D.deps.filter(function (d) { return d.from === c.core || d.to === c.core; }), bad = links.filter(function (d) { return d.status === 'conflict' || d.status === 'risk'; }).length;
            return '<tr><td>' + rag(c.health) + '</td><td><a href="#plan/' + esc(c.core) + '"><b>' + esc(c.name) + '</b></a><br><small class="muted">' + esc(c.ref || '') + (c.client ? ' · ' + esc(c.client) : '') + '</small></td>' +
              '<td><span class="cs-chip" style="--pc:' + ph[1] + '">' + esc(ph[0]) + '</span></td>' +
              '<td style="min-width:120px">' + (c.hasPlan ? '<div class="pbar"><span style="width:' + c.pct + '%"></span></div><small>' + c.pct + '%</small>' : '<small class="muted">No plan yet</small>') + '</td>' +
              '<td class="hide-sm">' + pretty(c.start) + '</td><td>' + pretty(c.forecast || c.finish) + (c.forecast && c.finish && c.forecast > c.finish ? ' <small style="color:#B91C1C" title="Planned ' + pretty(c.finish) + '">late</small>' : '') + '</td>' +
              '<td>' + (c.SPI == null ? '–' : '<b class="ev-' + evC(c.SPI) + '-t">' + c.SPI.toFixed(2) + '</b>') + '</td><td>' + (c.CPI == null ? '–' : '<b class="ev-' + evC(c.CPI) + '-t">' + c.CPI.toFixed(2) + '</b>') + '</td>' +
              '<td class="hide-sm">' + (c.BAC ? money(c.BAC) : '–') + '</td><td class="hide-sm">' + (links.length ? links.length + (bad ? ' <b style="color:#B45309">(' + bad + ' ⚠)</b>' : '') : '–') + '</td>' +
              (ed && others.length ? '<td><select data-move="' + esc(c.core) + '" aria-label="Move ' + esc(c.name) + ' to another program"><option value="">Move to…</option>' + others.map(function (o) { return '<option value="' + esc(o.id) + '">' + esc(o.name) + '</option>'; }).join('') + '</select></td>' : '') + '</tr>';
          }).join('') + '</tbody></table></div>' : '<div class="empty">No projects in this program yet.' + (ed ? ' Start one with ＋ New project, or move one here.' : '') + '</div>') + '</div>';
      board(el.querySelector('#pgBoard'), { program: p.name });
      var b;
      if ((b = el.querySelector('#pgEdit'))) b.onclick = function () { editProgram(p); };
      if ((b = el.querySelector('#pgDel'))) b.onclick = function () { deleteProgram(p, r); };
      if ((b = el.querySelector('#pgNewProj'))) b.onclick = function () { try { sessionStorage.setItem('champNewProg', p.name); } catch (e) {} location.hash = '#projects/new'; };
      if ((b = el.querySelector('#pgMoveIn'))) b.onclick = function () { moveIn(p); };
      if ((b = el.querySelector('[data-link]'))) b.onclick = function () { depForm(null, { program: p.name }); };
      el.querySelectorAll('[data-move]').forEach(function (s) {
        s.onchange = function () {
          if (!s.value) return;
          var to = D.programs.filter(function (x) { return x.id === s.value; })[0];
          api('planProgramMove', { core: s.getAttribute('data-move'), id: s.value }).then(function () { toast('Moved to ' + to.name); programView(id); }).catch(function (e) { fail(e); s.value = ''; });
        };
      });
    }).catch(fail);
  }
  function editProgram(p) {
    var x = p || { name: '', manager: '', sponsor: '', objective: '', status: 'active', color: COLORS[D.programs.length % COLORS.length], start: '', finish: '' };
    M.modal('<h2>' + (p ? '✎ Edit program' : '＋ New program') + '</h2><p class="muted">A program groups related projects that deliver a shared outcome (for example “Hospital redevelopment” or “ERP rollout”).</p>' +
      '<form id="pgForm" class="champ-form"><label>Program name<input name="name" required maxlength="80" value="' + esc(x.name) + '"></label>' +
      '<div class="champ-2"><label>Program manager<input name="manager" maxlength="80" value="' + esc(x.manager || '') + '"></label><label>Sponsor<input name="sponsor" maxlength="80" value="' + esc(x.sponsor || '') + '"></label></div>' +
      '<label>Objective and benefits<textarea name="objective" rows="3" maxlength="600" placeholder="What the program delivers, and the benefits it should bring">' + esc(x.objective || '') + '</textarea></label>' +
      '<div class="champ-2"><label>Status<select name="status">' + Object.keys(D.statuses).map(function (k) { return '<option value="' + k + '"' + (x.status === k ? ' selected' : '') + '>' + esc(D.statuses[k]) + '</option>'; }).join('') + '</select></label>' +
      '<label>Colour<span class="pg-colors">' + COLORS.map(function (c) { return '<label><input type="radio" name="color" value="' + c + '"' + (x.color === c ? ' checked' : '') + '><i style="background:' + c + '"></i></label>'; }).join('') + '</span></label></div>' +
      '<div class="champ-2"><label>Target start <small class="muted">(optional)</small><input type="date" name="start" value="' + esc(x.start || '') + '"></label><label>Target finish <small class="muted">(optional)</small><input type="date" name="finish" value="' + esc(x.finish || '') + '"></label></div>' +
      '<div class="actions" style="justify-content:flex-end"><button class="btn" type="button" data-close>Cancel</button><button class="btn btn-gold" type="submit">' + (p ? 'Save' : 'Create program') + '</button></div></form>');
    var f = document.getElementById('pgForm');
    f.onsubmit = function (e) {
      e.preventDefault();
      var col = f.querySelector('input[name=color]:checked');
      api('planProgramSave', { id: p ? p.id : '', name: f.name.value, manager: f.manager.value, sponsor: f.sponsor.value, objective: f.objective.value, status: f.status.value, color: col ? col.value : '', start: f.start.value, finish: f.finish.value })
        .then(function (r) { M.closeModal(); toast(p ? 'Program saved' : 'Program created'); location.hash = '#programs/' + r.program.id; if (p) programView(p.id); }).catch(fail);
    };
  }
  function deleteProgram(p, r) {
    var others = D.programs.filter(function (x) { return x.id !== p.id; });
    if (r.n && !others.length) { M.modal('<h2>Can\'t delete the only program</h2><p class="muted">Every project must belong to a program. Create another program first, then move the projects across.</p><div class="actions" style="justify-content:flex-end"><button class="btn" data-close>OK</button></div>'); return; }
    M.modal('<h2>🗑 Delete “' + esc(p.name) + '”?</h2>' + (r.n ? '<p>It has <b>' + r.n + ' project' + (r.n === 1 ? '' : 's') + '</b>. Every project must belong to a program, so choose where ' + (r.n === 1 ? 'it goes' : 'they go') + ':</p><select id="pgTo">' + others.map(function (o) { return '<option value="' + esc(o.id) + '">' + esc(o.name) + '</option>'; }).join('') + '</select>' : '<p class="muted">It has no projects.</p>') +
      '<div class="actions" style="justify-content:flex-end;margin-top:14px"><button class="btn" data-close>Cancel</button><button class="btn btn-danger" id="pgDelGo">Delete program</button></div>');
    document.getElementById('pgDelGo').onclick = function () {
      var to = document.getElementById('pgTo');
      api('planProgramDelete', { id: p.id, moveTo: to ? to.value : '' }).then(function (x) { M.closeModal(); toast(x.moved ? 'Program deleted; ' + x.moved + ' project' + (x.moved === 1 ? '' : 's') + ' moved to ' + x.to : 'Program deleted'); location.hash = '#programs'; }).catch(fail);
    };
  }
  function moveIn(p) {
    var opts = D.programs.filter(function (x) { return x.id !== p.id; }).map(function (o) {
      var L = projectsOf(o); return L.length ? '<optgroup label="' + esc(o.name) + '">' + L.map(function (c) { return '<option value="' + esc(c.core) + '">' + esc(c.name) + '</option>'; }).join('') + '</optgroup>' : '';
    }).join('');
    M.modal('<h2>⇄ Move a project into “' + esc(p.name) + '”</h2>' + (opts ? '<select id="pgPick" size="8" style="width:100%">' + opts + '</select>' : '<p class="muted">There are no projects in other programs.</p>') +
      '<div class="actions" style="justify-content:flex-end;margin-top:14px"><button class="btn" data-close>Cancel</button>' + (opts ? '<button class="btn btn-gold" id="pgPickGo">Move here</button>' : '') + '</div>');
    var go = document.getElementById('pgPickGo');
    if (go) go.onclick = function () { var v = document.getElementById('pgPick').value; if (!v) return; api('planProgramMove', { core: v, id: p.id }).then(function () { M.closeModal(); toast('Moved into ' + p.name); programView(p.id); }).catch(fail); };
  }

  /* ---------------- the dependency form ---------------- */
  function projectOptions(sel, onlyProgram) {
    return D.programs.map(function (p) {
      var L = projectsOf(p); if (!L.length) return '';
      return '<optgroup label="' + esc(p.name) + '">' + L.map(function (c) { return '<option value="' + esc(c.core) + '"' + (c.core === sel ? ' selected' : '') + '>' + esc(c.name) + (c.start ? ' (' + pretty(c.start) + ' → ' + pretty(c.forecast || c.finish) + ')' : ' (no schedule yet)') + '</option>'; }).join('') + '</optgroup>';
    }).join('');
  }
  function depForm(dep, pre) {
    pre = pre || {}; var d = dep || { from: pre.from || '', to: pre.to || '', type: 'FS', lag: 0, note: '' };
    var TY = [['FS', 'Finish to start', 'B can only start when A has finished (the usual one)'], ['SS', 'Start to start', 'B can only start once A has started'], ['FF', 'Finish to finish', 'B can only finish once A has finished']];
    M.modal('<h2>' + (dep ? '✎ Edit dependency' : '🔗 Link two projects') + '</h2><p class="muted">Project B depends on project A. The board checks the dates in both plans and warns you when they clash or A is slipping.</p>' +
      '<form id="depForm" class="champ-form"><label>A: the project that comes first<select name="from" required><option value="">Choose…</option>' + projectOptions(d.from) + '</select></label>' +
      '<label>B: the project that depends on it<select name="to" required><option value="">Choose…</option>' + projectOptions(d.to) + '</select></label>' +
      '<fieldset class="dep-types"><legend>Kind of link</legend>' + TY.map(function (t) { return '<label><input type="radio" name="type" value="' + t[0] + '"' + (d.type === t[0] ? ' checked' : '') + '><span><b>' + t[1] + '</b><small>' + t[2] + '</small></span></label>'; }).join('') + '</fieldset>' +
      '<div class="champ-2"><label>Lag (days) <small class="muted">wait after A, e.g. 5 for curing or approval</small><input type="number" name="lag" min="-365" max="365" value="' + (d.lag || 0) + '"></label>' +
      '<label>Note <small class="muted">(optional)</small><input name="note" maxlength="300" value="' + esc(d.note || '') + '" placeholder="e.g. Fit-out needs the building handed over"></label></div>' +
      '<p class="dep-err" hidden></p><div class="actions" style="justify-content:flex-end"><button class="btn" type="button" data-close>Cancel</button><button class="btn btn-gold" type="submit">' + (dep ? 'Save' : 'Link them') + '</button></div></form>');
    var f = document.getElementById('depForm'), er = f.querySelector('.dep-err');
    f.onsubmit = function (e) {
      e.preventDefault();
      if (f.from.value === f.to.value) { er.textContent = 'Choose two different projects.'; er.hidden = false; return; }
      api('planDepSave', { id: dep ? dep.id : '', from: f.from.value, to: f.to.value, type: (f.querySelector('input[name=type]:checked') || {}).value || 'FS', lag: f.lag.value, note: f.note.value })
        .then(function () { M.closeModal(); toast(dep ? 'Dependency saved' : 'Projects linked'); refresh(); })
        .catch(function (x) { er.textContent = x.message; er.hidden = false; });
    };
  }
  function refresh() { var h = location.hash.replace(/^#/, '').split('/'); if (h[0] === 'deps') depsView(); else if (h[0] === 'programs') programsView(h.slice(1)); }
  function depMenu(d, x, y) {
    var A = byCore(d.from), B = byCore(d.to), s = DS[d.status] || DS.unknown;
    pop('<b class="dep-pop-t"><i style="background:' + s[1] + '"></i>' + esc(s[0]) + '</b><p><b>' + esc(A.name) + '</b> → <b>' + esc(B.name) + '</b><br><small class="muted">' + esc(D.types[d.type] || d.type) + (d.lag ? ', ' + d.lag + ' day lag' : '') + '</small></p>' +
      '<p>' + esc(d.why || '') + '</p>' + (d.note ? '<p class="muted">📝 ' + esc(d.note) + '</p>' : '') +
      (canEdit() ? '<div class="dep-pop-a"><button class="btn btn-sm" data-ed>✎ Edit</button><button class="btn btn-sm btn-danger" data-rm>Remove link</button></div>' : ''), x, y, function (m) {
        var e1 = m.querySelector('[data-ed]'), r1 = m.querySelector('[data-rm]');
        if (e1) e1.onclick = function () { closePop(); depForm(d); };
        if (r1) r1.onclick = function () { closePop(); M.confirmBox('Remove this link?', esc(A.name) + ' → ' + esc(B.name), 'Remove', true).then(function (ok) { if (ok) api('planDepDelete', { id: d.id }).then(function () { toast('Link removed'); refresh(); }).catch(fail); }); };
      });
  }
  function byCore(core) { return D.cards.filter(function (c) { return c.core === core; })[0] || { name: core }; }
  var popEl = null;
  function closePop() { if (popEl) { popEl.remove(); popEl = null; } }
  function pop(html, x, y, bind) {
    closePop(); popEl = document.createElement('div'); popEl.className = 'dep-pop'; popEl.innerHTML = html; document.body.appendChild(popEl);
    var w = popEl.offsetWidth, h = popEl.offsetHeight;
    popEl.style.left = Math.max(8, Math.min(innerWidth - w - 8, x - w / 2)) + 'px'; popEl.style.top = Math.max(8, Math.min(innerHeight - h - 8, y + 12)) + 'px';
    if (bind) bind(popEl);
    setTimeout(function () { document.addEventListener('pointerdown', function out(e) { if (popEl && !popEl.contains(e.target)) { closePop(); document.removeEventListener('pointerdown', out, true); } }, true); }, 0);
  }

  /* ---------------- the board: swimlanes on a timeline, arrows for links ---------------- */
  var LINK = null;   // link mode: { from }
  function board(host, opts) {
    opts = opts || {};
    var lanes = [], inLane = {};
    var mine = opts.program ? D.cards.filter(function (c) { return c.program === opts.program; }) : null;
    var mineSet = {}; (mine || []).forEach(function (c) { mineSet[c.core] = 1; });
    var deps = opts.program ? D.deps.filter(function (d) { return mineSet[d.from] || mineSet[d.to]; }) : D.deps.filter(function (d) { return !opts.only || d.status === 'conflict' || d.status === 'risk'; });
    var touched = {}; deps.forEach(function (d) { touched[d.from] = 1; touched[d.to] = 1; });
    D.programs.forEach(function (p) {
      if (opts.prog && p.name !== opts.prog) return;
      var L = projectsOf(p).filter(function (c) { return !opts.program ? (!opts.only || touched[c.core]) : (p.name === opts.program || touched[c.core]); });
      if (!L.length) return;
      L.sort(function (a, b) { return (a.start || '9999') < (b.start || '9999') ? -1 : (a.start || '9999') > (b.start || '9999') ? 1 : a.name.localeCompare(b.name); });
      lanes.push({ p: p, list: L }); L.forEach(function (c) { inLane[c.core] = 1; });
    });
    deps = deps.filter(function (d) { return inLane[d.from] && inLane[d.to]; });
    if (!lanes.length) { host.innerHTML = '<div class="empty">' + (opts.only ? 'No dependencies need attention. 🎉' : 'Nothing to show yet.') + '</div>'; return; }
    // the time range
    var T = today(), ds = [T];
    lanes.forEach(function (l) { l.list.forEach(function (c) { if (c.start) ds.push(c.start); if (c.finish) ds.push(c.finish); if (c.forecast) ds.push(c.forecast); }); });
    ds.sort(); var a = t2ms(ds[0]) - 10 * DAY, b = t2ms(ds[ds.length - 1]) + 21 * DAY;
    var days = Math.max(60, Math.round((b - a) / DAY)), LBL = 220, ROW = 44, LANE = 34;
    var avail = Math.max(400, (host.clientWidth || 900) - LBL - 4), px = Math.max(3, Math.min(40, avail / days)), W = LBL + Math.round(days * px);
    var X = function (s) { return LBL + Math.round((t2ms(s) - a) / DAY * px); };
    var y = 26, rows = [], pos = {};
    lanes.forEach(function (l) {
      rows.push({ lane: l.p, y: y }); y += LANE;
      l.list.forEach(function (c) {
        var has = !!(c.start && (c.finish || c.forecast)), x1 = has ? X(c.start) : X(T), x2 = has ? Math.max(x1 + 6, X(c.finish || c.forecast)) : x1 + 70, xf = has && c.forecast && c.forecast > (c.finish || '') ? X(c.forecast) : x2;
        pos[c.core] = { x1: x1, x2: x2, xf: Math.max(x2, xf), y: y + ROW / 2, has: has };
        rows.push({ c: c, y: y, lane: l.p }); y += ROW;
      });
      y += 6;
    });
    var H = y + 8;
    // months along the top
    var grid = '', m = new Date(a); m.setUTCDate(1); m.setUTCMonth(m.getUTCMonth() + 1);
    while (m.getTime() < b) { var xm = LBL + Math.round((m.getTime() - a) / DAY * px); grid += '<i class="db-m" style="left:' + xm + 'px"></i><span class="db-ml" style="left:' + (xm + 4) + 'px">' + MON[m.getUTCMonth()] + (m.getUTCMonth() === 0 ? ' ' + m.getUTCFullYear() : '') + '</span>'; m.setUTCMonth(m.getUTCMonth() + 1); }
    var html = '<div class="db-wrap"><div class="db" style="width:' + W + 'px;height:' + H + 'px;--lbl:' + LBL + 'px">' + grid +
      '<i class="db-today" style="left:' + X(T) + 'px" title="Today ' + pretty(T) + '"><span>Today</span></i>';
    rows.forEach(function (r) {
      if (!r.c) { html += '<div class="db-lane" style="top:' + r.y + 'px;--pg:' + esc(r.lane.color || '#C9A227') + '"><a href="#programs/' + esc(r.lane.id) + '">🗂 ' + esc(r.lane.name) + '</a></div>'; return; }
      var c = r.c, P = pos[c.core], dim = opts.program && c.program !== opts.program;
      html += '<div class="db-row' + (dim ? ' db-ext' : '') + '" style="top:' + r.y + 'px;height:' + ROW + 'px"><div class="db-name" title="' + esc(c.name) + '">' + rag(c.health) + '<a href="#plan/' + esc(c.core) + '">' + esc(c.name) + '</a></div></div>' +
        (P.has ? '<div class="db-bar db-' + esc(c.health) + '" data-core="' + esc(c.core) + '" style="left:' + P.x1 + 'px;top:' + (r.y + 9) + 'px;width:' + (P.x2 - P.x1) + 'px" title="' + esc(c.name + ': ' + pretty(c.start) + ' → ' + pretty(c.finish) + (c.forecast && c.forecast > c.finish ? ' (forecast ' + pretty(c.forecast) + ')' : '') + ' · ' + c.pct + '% done') + '"><u style="width:' + (c.pct || 0) + '%"></u><span>' + esc(c.name) + '</span></div>' +
          (P.xf > P.x2 + 2 ? '<div class="db-slip" style="left:' + P.x2 + 'px;top:' + (r.y + 9) + 'px;width:' + (P.xf - P.x2) + 'px" title="Forecast to finish ' + pretty(c.forecast) + '"></div>' : '')
          : '<div class="db-bar db-none" data-core="' + esc(c.core) + '" style="left:' + P.x1 + 'px;top:' + (r.y + 9) + 'px;width:70px" title="' + esc(c.name) + ': no schedule yet"><span>no schedule</span></div>');
    });
    // arrows
    var svg = '<svg class="db-svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '"><defs>' + Object.keys(DS).map(function (k) { return '<marker id="dbA-' + k + '" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="' + DS[k][1] + '"/></marker>'; }).join('') + '</defs>';
    deps.forEach(function (d) {
      var A = pos[d.from], B = pos[d.to]; if (!A || !B) return;
      var x1 = d.type === 'SS' ? A.x1 : A.xf, y1 = A.y, x2 = d.type === 'FF' ? B.x2 : B.x1, y2 = B.y, col = (DS[d.status] || DS.unknown)[1];
      var dx = Math.max(28, Math.abs(x2 - x1) / 2), path;
      if (d.type === 'FF') path = 'M' + x1 + ' ' + y1 + ' C' + (x1 + dx) + ' ' + y1 + ',' + (x2 + dx) + ' ' + y2 + ',' + (x2 + 2) + ' ' + y2;
      else if (x2 - x1 >= 24) path = 'M' + x1 + ' ' + y1 + ' C' + (x1 + dx) + ' ' + y1 + ',' + (x2 - dx) + ' ' + y2 + ',' + (x2 - 2) + ' ' + y2;
      else { var my = (y1 + y2) / 2; path = 'M' + x1 + ' ' + y1 + ' C' + (x1 + 30) + ' ' + y1 + ',' + (x1 + 30) + ' ' + my + ',' + ((x1 + x2) / 2) + ' ' + my + ' S' + (x2 - 30) + ' ' + y2 + ',' + (x2 - 2) + ' ' + y2; }
      var cross = d.cross ? ' db-cross' : '';
      svg += '<g class="db-link db-' + esc(d.status) + cross + '" data-dep="' + esc(d.id) + '"><path class="db-hit" d="' + path + '"/><path d="' + path + '" stroke="' + col + '" marker-end="url(#dbA-' + esc(d.status) + ')"/></g>';
    });
    svg += '</svg>';
    html += svg + '</div></div>' +
      '<div class="db-legend"><span><i class="db-bar-k"></i>Planned (fill = % done)</span><span><i class="db-slip-k"></i>Forecast slip</span>' + Object.keys(DS).map(function (k) { return '<span><i style="background:' + DS[k][1] + '"></i>' + DS[k][0] + '</span>'; }).join('') + '<span><b>Bold arrows</b> cross programs</span>' +
      (canEdit() ? '<span class="sp"></span><span class="muted">Tip: click a bar to link it to another project</span>' : '') + '</div>';
    host.innerHTML = html;
    host.querySelectorAll('[data-dep]').forEach(function (g) { g.addEventListener('click', function (e) { var d = deps.filter(function (x) { return x.id === g.getAttribute('data-dep'); })[0]; if (d) depMenu(d, e.clientX, e.clientY); }); });
    host.querySelectorAll('.db-bar').forEach(function (bar) {
      bar.addEventListener('click', function (e) {
        var core = bar.getAttribute('data-core'), c = byCore(core);
        if (LINK && LINK.from && LINK.from !== core) { var f = LINK.from; setLink(null); depForm(null, { from: f, to: core }); return; }
        pop('<b>' + esc(c.name) + '</b><p class="muted">' + esc(c.program || '') + ' · ' + (c.start ? pretty(c.start) + ' → ' + pretty(c.forecast || c.finish) : 'no schedule yet') + ' · ' + (c.pct || 0) + '% done</p>' +
          '<div class="dep-pop-a"><a class="btn btn-sm" href="#plan/' + esc(core) + '">Open plan</a>' + (canEdit() ? '<button class="btn btn-sm btn-gold" data-lk>🔗 Link to…</button>' : '') + '</div>', e.clientX, e.clientY, function (m) {
          var lk = m.querySelector('[data-lk]'); if (lk) lk.onclick = function () { closePop(); setLink(core); };
        });
      });
    });
    // keep the view near today
    var wrap = host.querySelector('.db-wrap'); if (wrap && W > wrap.clientWidth) wrap.scrollLeft = Math.max(0, X(T) - LBL - wrap.clientWidth / 3);
  }
  function setLink(core) {
    LINK = core ? { from: core } : null;
    var b = document.getElementById('dbLinkBar');
    if (!core) { if (b) b.remove(); document.body.classList.remove('db-linking'); return; }
    if (!b) { b = document.createElement('div'); b.id = 'dbLinkBar'; b.className = 'db-linkbar'; document.body.appendChild(b); }
    b.innerHTML = '🔗 Linking from <b>' + esc(byCore(core).name) + '</b>: now click the project that depends on it. <button class="btn btn-sm" type="button">Cancel</button>';
    b.querySelector('button').onclick = function () { setLink(null); };
    document.body.classList.add('db-linking');
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { setLink(null); closePop(); } });
  window.addEventListener('hashchange', function () { setLink(null); closePop(); });

  /* ---------------- #deps ---------------- */
  var DV = { prog: '', only: false };
  function depsView() {
    var el = M.$('#view'); el.innerHTML = head('deps') + '<div class="empty">Loading the dependency board…</div>';
    load().then(function () {
      var dl = D.deps, n = function (s) { return dl.filter(function (d) { return d.status === s; }).length; };
      el.innerHTML = head('deps') +
        '<div class="cs-tiles">' + tile('Dependencies', dl.length, dl.filter(function (d) { return d.cross; }).length + ' cross-program') +
        tile('Clashes', n('conflict'), 'the plans already clash', n('conflict') ? 'cs-red' : 'cs-green') + tile('At risk', n('risk'), 'a slipping predecessor or thin buffer', n('risk') ? 'cs-amber' : '') +
        tile('OK', n('ok') + n('done'), n('unknown') ? n('unknown') + ' still need dates' : 'buffers in place', 'cs-green') + '</div>' +
        '<div class="pbtool"><select id="dbProg" style="width:auto"><option value="">🗂 All programs</option>' + D.programs.map(function (p) { return '<option' + (DV.prog === p.name ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') + '</select>' +
        '<label class="db-only"><input type="checkbox" id="dbOnly"' + (DV.only ? ' checked' : '') + '> Only problems</label><span class="sp"></span>' +
        (canEdit() ? '<button class="btn btn-sm btn-gold" id="dbAdd">🔗 Link projects</button>' : '') + '<button class="btn btn-sm" id="dbRef">↻ Refresh</button></div>' +
        '<div class="card db-card"><div id="dbBoard"></div></div>' +
        '<div class="card"><div class="card-h"><h2>Every dependency, problems first</h2></div><div id="dbList"></div></div>';
      var draw = function () {
        board(el.querySelector('#dbBoard'), { prog: DV.prog, only: DV.only });
        var L = dl.filter(function (d) { return (!DV.only || d.status === 'conflict' || d.status === 'risk') && (!DV.prog || byCore(d.from).program === DV.prog || byCore(d.to).program === DV.prog); })
          .sort(function (x, y) { return DSRANK[x.status] - DSRANK[y.status] || (x.slack == null ? 999 : x.slack) - (y.slack == null ? 999 : y.slack); });
        el.querySelector('#dbList').innerHTML = L.length ? '<div class="table-wrap"><table><thead><tr><th>Status</th><th>A: comes first</th><th></th><th>B: depends on it</th><th>Kind</th><th>Buffer</th><th>What it means</th>' + (canEdit() ? '<th></th>' : '') + '</tr></thead><tbody>' + L.map(function (d) {
          var A = byCore(d.from), B = byCore(d.to), s = DS[d.status] || DS.unknown;
          return '<tr><td><span class="dep-chip" style="--dc:' + s[1] + '">' + s[0] + '</span></td><td><a href="#plan/' + esc(A.core) + '"><b>' + esc(A.name) + '</b></a><br><small class="muted">' + esc(A.program || '') + '</small></td><td>' + (d.cross ? '⇢' : '→') + '</td>' +
            '<td><a href="#plan/' + esc(B.core) + '"><b>' + esc(B.name) + '</b></a><br><small class="muted">' + esc(B.program || '') + '</small></td><td><small>' + esc(D.types[d.type] || d.type) + (d.lag ? ' +' + d.lag + 'd' : '') + '</small></td>' +
            '<td>' + (d.slack == null ? '–' : '<b style="color:' + (d.slack < 0 ? '#B91C1C' : d.slack <= 5 ? '#B45309' : 'inherit') + '">' + d.slack + ' d</b>') + '</td><td><small>' + esc(d.why || '') + (d.note ? '<br>📝 ' + esc(d.note) : '') + '</small></td>' +
            (canEdit() ? '<td style="white-space:nowrap"><button class="btn btn-sm" data-ed="' + esc(d.id) + '">✎</button><button class="btn btn-sm" data-rm="' + esc(d.id) + '" title="Remove link">🗑</button></td>' : '') + '</tr>';
        }).join('') + '</tbody></table></div>' : '<div class="empty">' + (dl.length ? 'Nothing matches.' : 'No dependencies yet. Use 🔗 Link projects, or click a bar on the board and choose “Link to…”.') + '</div>';
        el.querySelectorAll('#dbList [data-ed]').forEach(function (b) { b.onclick = function () { depForm(dl.filter(function (d) { return d.id === b.getAttribute('data-ed'); })[0]); }; });
        el.querySelectorAll('#dbList [data-rm]').forEach(function (b) { b.onclick = function () { M.confirmBox('Remove this link?', '', 'Remove', true).then(function (ok) { if (ok) api('planDepDelete', { id: b.getAttribute('data-rm') }).then(function () { toast('Link removed'); depsView(); }).catch(fail); }); }; });
      };
      el.querySelector('#dbProg').onchange = function () { DV.prog = this.value; draw(); };
      el.querySelector('#dbOnly').onchange = function () { DV.only = this.checked; draw(); };
      el.querySelector('#dbRef').onclick = depsView;
      var add = el.querySelector('#dbAdd'); if (add) add.onclick = function () { depForm(null); };
      draw();
    }).catch(fail);
  }

  M.addView('programs', 'Programs', programsView);
  M.addView('deps', 'Dependency board', depsView);
})();
