/* GKH Project Champ: 📘 Lessons learned (a project tab).
   - a living log of lessons (what happened, root cause, what to do next time), captured as the work goes
   - ✨ the AI suggests lessons from the project's own history (plan vs baseline, risks, issues, changes)
   - 📚 lessons from past projects, ranked for this one, reused as lessons, risks or tasks (the library)
   - 📄 an AI-written 4-page illustrated report (charts and drawings from the real numbers), printable as PDF, as Word,
     saved to the project's Documents, with a 30-second scribe video (drawn on a whiteboard, narrated by Champ) */
(function () {
  var M = window.MBS; if (!M) return;
  var api = M.api, esc = M.esc, toast = M.toast, fail = M.fail, $ = M.$, money = M.money;
  var dmy = function (s) { return s ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : ''; };
  var CATS = ['Schedule', 'Cost', 'Scope', 'Quality', 'Risk', 'Stakeholders', 'People and resources', 'Vendors and procurement', 'Technical', 'Communication', 'Governance', 'Change control'];
  var C, L = { core: '' };   // C: the plan page (state and helpers); L: this tab's state

  // hand-drawn style icons (24 x 24), used in the report and drawn stroke by stroke in the video
  var IC = {
    calendar: 'M4 6h16v14H4z M4 10h16 M8 3v5 M16 3v5 M8 14h2 M12 14h2 M16 14h1 M8 17h2',
    money: 'M3 7h18v10H3z M12 9.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5 M6 10v4 M18 10v4',
    warning: 'M12 3L22 20H2z M12 9v5 M12 16.5v1',
    people: 'M8 8a3 3 0 1 0 0.01 0 M16 8a3 3 0 1 0 0.01 0 M2 20c0-4 3-6 6-6s6 2 6 6 M12 16c1-1.5 2.5-2 4-2 3 0 6 2 6 6',
    up: 'M3 19l6-6 4 4 8-9 M15 8h6v6',
    down: 'M3 6l6 6 4-4 8 9 M15 17h6v-6',
    check: 'M12 3a9 9 0 1 0 0.01 0 M7.5 12.5l3 3 6-7',
    idea: 'M9 18h6 M10 21h4 M12 3a6 6 0 0 0-4 10.5c1 1 1 2 1 3h6c0-1 0-2 1-3A6 6 0 0 0 12 3 M12 7v3',
    puzzle: 'M4 8h4a2 2 0 1 1 4 0h4v4a2 2 0 1 1 0 4v4H4v-4a2 2 0 1 0 0-4z',
    handshake: 'M2 12l4-4 4 2 4-3 4 1 4 4 M6 8l-2 9 M18 8l2 9 M8 14l2 2 M11 13l3 3 M14 12l2 2',
    rocket: 'M12 2c4 3 5 8 3 13H9C7 10 8 5 12 2 M9 15l-3 3 M15 15l3 3 M12 8a1.5 1.5 0 1 0 0.01 0 M10 18l2 4 2-4',
    flag: 'M5 21V3 M5 4h12l-3 4 3 4H5',
    gear: 'M12 8a4 4 0 1 0 0.01 0 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M19 5l-2 2 M7 17l-2 2',
    document: 'M6 2h9l4 4v16H6z M15 2v4h4 M9 11h7 M9 14h7 M9 17h5',
    clock: 'M12 3a9 9 0 1 0 0.01 0 M12 7v5l3 2',
    target: 'M12 3a9 9 0 1 0 0.01 0 M12 7a5 5 0 1 0 0.01 0 M12 11a1 1 0 1 0 0.01 0 M12 12l7-7 M17 5h2v2'
  };
  var icon = function (k, size, col) { return '<svg class="ll-ic" viewBox="0 0 24 24" width="' + (size || 26) + '" height="' + (size || 26) + '" fill="none" stroke="' + (col || 'currentColor') + '" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="' + (IC[k] || IC.idea) + '"/></svg>'; };
  var uid = function () { return 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); };
  var plan = function () { return C.S.plan; };
  var canEdit = function () { return M.allowed && M.allowed('projects', 'edit'); };
  function bg(body) {
    var id = 'll' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    return fetch('/.netlify/functions/planai-background', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-MBS-Admin': '1', 'X-Champ-Lang': (window.ChampI18n && window.ChampI18n.get()) || 'en' }, body: JSON.stringify(Object.assign({ id: id }, body)) })
      .then(function (r) { if (r.status === 401 || r.status === 403) throw new Error('Your session has ended, or you can view this project only.'); return id; });
  }
  function poll(id, max) { return new Promise(function (res, rej) { var n = 0; (function go() { setTimeout(function () { api('planAiStatus', { id: id }).then(function (st) { if (st.status === 'done') return res(st.result); if (st.status === 'error' || ++n > (max || 150)) return rej(new Error(st.error || 'The AI took too long. Try again.')); go(); }).catch(function () { if (++n <= (max || 150)) go(); else rej(new Error('No answer')); }); }, n < 3 ? 2000 : 3000); })(); }); }
  function chartLib() { return C.piLoad('vendor/chart.umd.min.js?v=451', function () { return !!window.Chart; }); }

  /* ---------------- the tab ---------------- */
  function tab(ctx) {
    C = ctx; var core = C.S.core, p = plan(); p.lessons = p.lessons || []; p.lessonsUsed = p.lessonsUsed || [];
    if (L.core !== core) { L = { core: core, lib: null, rep: undefined, open: {} }; api('intelLessonsLibraryGet', { core: core, limit: 12 }).then(function (r) { L.lib = r; if (C.S.tab === 'lessons' && C.S.core === core) draw(); }).catch(function () { L.lib = { lessons: [] }; });
      api('intelLessonsReportGet', { core: core }).then(function (r) { L.rep = r.report || null; if (C.S.tab === 'lessons' && C.S.core === core) draw(); }).catch(function () { L.rep = null; }); }
    draw();
  }
  function draw() {
    var p = plan(), B = $('#planBody'), ed = canEdit(), Ls = p.lessons, pos = Ls.filter(function (l) { return l.impact === 'positive'; }).length;
    var used = {}; (p.lessonsUsed || []).forEach(function (k) { used[k] = 1; });
    var sug = ((L.lib || {}).lessons || []).filter(function (x) { return !used[x.core + ':' + x.id]; }).slice(0, 6);
    var phases = (p.phases || []).map(function (f) { return f.name; });
    B.innerHTML =
      '<div class="card ll-top"><div class="ll-h"><div><h3 style="margin:0">📘 Lessons learned</h3><p class="muted" style="margin:2px 0 0;font-size:12.5px">Capture lessons as the project runs, not only at the end. Agreed lessons go into the library that every other project in Project Champ learns from.</p></div><span class="sp"></span>' +
        (ed ? '<button class="btn btn-sm" id="llAdd" type="button">＋ Add a lesson</button><button class="btn btn-sm" id="llAi" type="button" title="The AI reads this project\'s history (plan vs baseline, risks, issues, changes) and suggests lessons for you to review">✨ Suggest lessons</button>' : '') +
        '<button class="btn btn-sm" id="llLib" type="button">📚 Lessons library</button>' +
        (ed ? '<button class="btn btn-sm btn-gold" id="llRep" type="button" title="The AI writes a 4-page illustrated lessons-learned report, with a 30-second scribe video">📄 ' + (L.rep ? 'Rewrite the report' : 'Write the report') + '</button>' : '') + '</div>' +
        '<div class="ll-stat"><span>📘 <b>' + Ls.length + '</b> lesson' + (Ls.length === 1 ? '' : 's') + '</span><span>👍 ' + pos + ' to repeat</span><span>⚠ ' + (Ls.length - pos) + ' to avoid</span><span>✓ ' + Ls.filter(function (l) { return l.status === 'Agreed'; }).length + ' agreed</span>' +
        (L.rep ? '<button class="ll-link" id="llOpen" type="button">📄 Open the report (' + esc(dmy(new Date(L.rep.at).toISOString().slice(0, 10))) + ') ›</button>' : L.rep === undefined ? '<span class="muted">Loading the report…</span>' : '') + '</div>' +
        (Ls.length ? '<div class="ll-charts"><div><canvas id="llCat" height="150"></canvas></div><div><canvas id="llImp" height="150"></canvas></div></div>' : '') + '</div>' +
      (sug.length ? '<div class="card ll-past"><h4 style="margin:0 0 4px">📚 From past projects <small class="muted" style="font-weight:400">lessons other projects learned that fit this one</small></h4><div class="ll-cards">' + sug.map(function (x) {
        return '<div class="ll-card ' + (x.impact === 'positive' ? 'pos' : 'neg') + '"><div class="ll-ct"><b>' + esc(x.title) + '</b><small class="muted">' + esc(x.project) + (x.program ? ' · ' + esc(x.program) : '') + ' · ' + esc(x.category || '') + '</small></div>' +
          (x.rec ? '<p>➜ ' + esc(x.rec) + '</p>' : '') + (ed ? '<div class="ll-use"><button class="btn btn-sm" data-lladd="' + esc(x.core + ':' + x.id) + '">＋ Lesson</button><button class="btn btn-sm" data-llrisk="' + esc(x.core + ':' + x.id) + '">⚠ As a risk</button><button class="btn btn-sm" data-lltask="' + esc(x.core + ':' + x.id) + '">✓ As a task</button><button class="btn btn-sm" data-llno="' + esc(x.core + ':' + x.id) + '" title="Not relevant here">✕</button></div>' : '') + '</div>'; }).join('') + '</div></div>' : '') +
      '<div class="ll-log">' + (Ls.length ? Ls.slice().sort(function (a, b) { return b.at - a.at; }).map(function (l) {
        var open = L.open[l.id];
        return '<div class="ll-item ' + (l.impact === 'positive' ? 'pos' : 'neg') + '"><div class="ll-ih" data-llo="' + esc(l.id) + '"><span class="ll-dot">' + (l.impact === 'positive' ? '👍' : '⚠') + '</span><b>' + esc(l.title || '(untitled lesson)') + '</b><span class="ll-tag">' + esc(l.category || '') + '</span>' + (l.phase ? '<span class="ll-tag">' + esc(l.phase) + '</span>' : '') + (l.source === 'ai' ? '<span class="ll-tag">✨ AI</span>' : l.source === 'library' ? '<span class="ll-tag" title="' + esc(l.from) + '">📚 ' + esc(l.from) + '</span>' : '') + '<span class="sp"></span><span class="ll-st ' + (l.status === 'Agreed' ? 'ok' : '') + '">' + esc(l.status) + '</span><span class="muted">' + (open ? '▴' : '▾') + '</span></div>' +
          (open ? '<div class="ll-body">' + (ed ? '<div class="form-grid ll-form"><label>Lesson<input data-llf="title" data-id="' + esc(l.id) + '" maxlength="200" value="' + esc(l.title) + '"></label>' +
            '<label>Category<select data-llf="category" data-id="' + esc(l.id) + '">' + CATS.map(function (c) { return '<option' + (c === l.category ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select></label>' +
            '<label>Phase<select data-llf="phase" data-id="' + esc(l.id) + '"><option value="">Whole project</option>' + phases.map(function (f) { return '<option' + (f === l.phase ? ' selected' : '') + '>' + esc(f) + '</option>'; }).join('') + '</select></label>' +
            '<label>Impact<select data-llf="impact" data-id="' + esc(l.id) + '"><option value="positive"' + (l.impact === 'positive' ? ' selected' : '') + '>👍 Went well (repeat it)</option><option value="negative"' + (l.impact !== 'positive' ? ' selected' : '') + '>⚠ Went wrong (avoid it)</option></select></label>' +
            '<label class="ll-wide">What happened<textarea rows="2" data-llf="what" data-id="' + esc(l.id) + '" maxlength="1500">' + esc(l.what) + '</textarea></label><label class="ll-wide">Root cause<textarea rows="2" data-llf="cause" data-id="' + esc(l.id) + '" maxlength="800">' + esc(l.cause) + '</textarea></label>' +
            '<label class="ll-wide">Next time (the recommendation)<textarea rows="2" data-llf="rec" data-id="' + esc(l.id) + '" maxlength="800">' + esc(l.rec) + '</textarea></label>' +
            '<label>Status<select data-llf="status" data-id="' + esc(l.id) + '"><option' + (l.status !== 'Agreed' ? ' selected' : '') + '>Draft</option><option' + (l.status === 'Agreed' ? ' selected' : '') + '>Agreed</option></select></label>' +
            '<label class="qchk" style="align-self:end"><input type="checkbox" data-llf="reuse" data-id="' + esc(l.id) + '"' + (l.reuse !== false ? ' checked' : '') + '> 📚 Share with future projects</label></div><div class="ll-ib"><button class="btn btn-sm" data-llx="' + esc(l.id) + '">🗑 Delete</button></div>'
            : '<p><b>What happened:</b> ' + esc(l.what) + '</p><p><b>Root cause:</b> ' + esc(l.cause) + '</p><p><b>Next time:</b> ' + esc(l.rec) + '</p>') + '</div>' : '') + '</div>'; }).join('')
        : '<div class="dm-empty">No lessons yet. ' + (ed ? 'Add one as soon as something teaches the team something, or press ✨ Suggest lessons and the AI will draft them from this project\'s history.' : '') + '</div>') + '</div>';
    wire(); if (Ls.length) charts();
  }
  function wire() {
    var p = plan(), B = $('#planBody'), byId = {}; p.lessons.forEach(function (l) { byId[l.id] = l; });
    var lib = {}; ((L.lib || {}).lessons || []).forEach(function (x) { lib[x.core + ':' + x.id] = x; });
    var on = function (sel, fn) { var e = $(sel); if (e) e.onclick = fn; };
    on('#llAdd', function () { var l = { id: uid(), title: '', category: 'Schedule', phase: '', impact: 'negative', what: '', cause: '', rec: '', status: 'Draft', reuse: true, source: 'manual', by: (M.me || {}).name || '', at: Date.now() }; p.lessons.push(l); L.open[l.id] = true; C.dirty('lesson added'); draw(); var f = B.querySelector('[data-llf="title"][data-id="' + l.id + '"]'); if (f) f.focus(); });
    on('#llAi', suggest); on('#llLib', library); on('#llRep', writeReport); on('#llOpen', function () { openReport(L.rep); });
    B.querySelectorAll('[data-llo]').forEach(function (h) { h.onclick = function () { var id = h.getAttribute('data-llo'); L.open[id] = !L.open[id]; draw(); }; });
    B.querySelectorAll('[data-llf]').forEach(function (i) { i.onchange = function () { var l = byId[i.getAttribute('data-id')]; if (!l) return; var k = i.getAttribute('data-llf'); l[k] = k === 'reuse' ? i.checked : i.value; C.dirty('lesson: ' + (l.title || 'edited')); if (k === 'title' || k === 'impact' || k === 'category' || k === 'status' || k === 'phase') draw(); }; });
    B.querySelectorAll('[data-llx]').forEach(function (b) { b.onclick = function () { if (!window.confirm('Delete this lesson?')) return; p.lessons = p.lessons.filter(function (l) { return l.id !== b.getAttribute('data-llx'); }); C.dirty('lesson deleted'); draw(); }; });
    var use = function (k, how) {
      var x = lib[k]; if (!x) return; p.lessonsUsed.push(k); var tag = ' (lesson from ' + x.project + ')';
      if (how === 'lesson') p.lessons.push({ id: uid(), title: x.title, category: x.category, phase: '', impact: x.impact, what: x.what, cause: x.cause, rec: x.rec, status: 'Draft', reuse: false, source: 'library', from: x.project, by: (M.me || {}).name || '', at: Date.now() });
      if (how === 'risk') { p.risks = p.risks || []; p.risks.push({ id: 'r' + Date.now().toString(36), title: x.title, cause: (x.cause || x.what) + tag, p: 3, i: 3, response: 'Mitigate', action: x.rec, owner: (p.charter || {}).manager || '', review: '', status: 'Open', raised: C.today() }); }
      if (how === 'task') { var last = p.tasks[p.tasks.length - 1]; p.tasks.push({ id: 't' + Date.now().toString(36) + 'l', phase: (last && last.phase) || ((p.phases || [])[0] || {}).id || 'ph1', name: (x.rec || x.title).slice(0, 120), dur: 2, pred: last ? [last.id] : [], res: [], lead: '', resource: '', qty: 0, unit: '', rate: 0, actual: 0, pct: 0, status: 'todo', note: x.title + tag }); }
      C.dirty(how === 'no' ? 'past lesson dismissed' : 'past lesson used as a ' + how); draw();
      toast(how === 'no' ? 'Hidden for this project' : how === 'lesson' ? 'Added to this project\'s lessons' : how === 'risk' ? 'Added to the Risks tab' : 'Added to the Gantt (at the end; move it where it belongs)');
    };
    B.querySelectorAll('[data-lladd]').forEach(function (b) { b.onclick = function () { use(b.getAttribute('data-lladd'), 'lesson'); }; });
    B.querySelectorAll('[data-llrisk]').forEach(function (b) { b.onclick = function () { use(b.getAttribute('data-llrisk'), 'risk'); }; });
    B.querySelectorAll('[data-lltask]').forEach(function (b) { b.onclick = function () { use(b.getAttribute('data-lltask'), 'task'); }; });
    B.querySelectorAll('[data-llno]').forEach(function (b) { b.onclick = function () { use(b.getAttribute('data-llno'), 'no'); }; });
  }
  var charts0 = [];
  function charts() {
    chartLib().then(function () {
      charts0.forEach(function (c) { try { c.destroy(); } catch (e) {} }); charts0 = [];
      var p = plan(), by = {}, posN = 0; p.lessons.forEach(function (l) { by[l.category || 'Other'] = by[l.category || 'Other'] || [0, 0]; by[l.category || 'Other'][l.impact === 'positive' ? 0 : 1]++; if (l.impact === 'positive') posN++; });
      var k = Object.keys(by), c1 = $('#llCat'), c2 = $('#llImp'); if (!c1 || !c2) return;
      charts0.push(new window.Chart(c1, { type: 'bar', data: { labels: k, datasets: [{ label: 'Went well', data: k.map(function (x) { return by[x][0]; }), backgroundColor: '#17B26A' }, { label: 'Went wrong', data: k.map(function (x) { return by[x][1]; }), backgroundColor: '#F04438' }] }, options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { position: 'bottom' }, title: { display: true, text: 'Lessons by category' } }, scales: { x: { stacked: true, ticks: { precision: 0 } }, y: { stacked: true } } } }));
      charts0.push(new window.Chart(c2, { type: 'doughnut', data: { labels: ['Went well', 'Went wrong'], datasets: [{ data: [posN, p.lessons.length - posN], backgroundColor: ['#17B26A', '#F04438'] }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' }, title: { display: true, text: 'Repeat vs avoid' } } } }));
    }).catch(function () {});
  }

  /* ---------------- ✨ suggested lessons ---------------- */
  function suggest() {
    var core = C.S.core;
    M.modal('<h2>✨ Lessons from this project\'s history</h2><p class="muted" style="margin:-4px 0 10px">The AI reads the plan against the baseline, the risks, issues and change requests, and drafts the lessons. Tick the ones to keep; you can edit them after.</p><div id="llS"><p class="cr-wait">✨ Reading the project…</p></div>');
    bg({ mode: 'lessonsSuggest', core: core }).then(poll).then(function (r) {
      if (!$('#llS')) return; var X = r.lessons || [];
      $('#llS').innerHTML = X.map(function (l, i) { return '<label class="ll-sg ' + (l.impact === 'positive' ? 'pos' : 'neg') + '"><input type="checkbox" data-lls="' + i + '" checked><span><b>' + (l.impact === 'positive' ? '👍 ' : '⚠ ') + esc(l.title) + '</b> <small class="muted">' + esc(l.category) + (l.phase ? ' · ' + esc(l.phase) : '') + '</small><br><small>' + esc(l.what) + '</small><br><small><b>Next time:</b> ' + esc(l.rec) + '</small></span></label>'; }).join('') +
        '<div class="actions"><button class="btn" data-close type="button">Cancel</button><button class="btn btn-gold" id="llSGo" type="button">＋ Add the ticked lessons</button></div>';
      $('#llSGo').onclick = function () { var p = plan(), n = 0; $('#llS').querySelectorAll('[data-lls]:checked').forEach(function (c) { var l = X[+c.getAttribute('data-lls')]; p.lessons.push({ id: uid(), title: l.title, category: l.category, phase: l.phase, impact: l.impact, what: l.what + (l.evidence ? ' (' + l.evidence + ')' : ''), cause: l.cause, rec: l.rec, status: 'Draft', reuse: true, source: 'ai', by: 'AI', at: Date.now() }); n++; });
        M.closeModal(); if (n) { C.dirty(n + ' lessons from the AI'); draw(); toast(n + ' lesson' + (n === 1 ? '' : 's') + ' added. Review them, then mark them Agreed.'); } };
    }).catch(function (e) { if ($('#llS')) $('#llS').innerHTML = '<p class="cr-wait" style="color:#B42318">' + esc(e.message) + '</p>'; });
  }
  /* ---------------- 📚 the library ---------------- */
  function library() {
    var core = C.S.core;
    M.modal('<h2>📚 Lessons library</h2><p class="muted" style="margin:-4px 0 8px">Every lesson shared by every project in Project Champ. Search, then reuse one here.</p><input id="llQ" type="search" placeholder="🔎 e.g. vendor, payments, data migration, stakeholder sign-off" style="width:100%"><div id="llLibL" style="margin-top:10px"><p class="cr-wait">Loading…</p></div><div class="actions"><button class="btn" data-close type="button">Close</button></div>');
    var show = function (q) { api('intelLessonsLibraryGet', { core: core, q: q, limit: 60 }).then(function (r) { if (!$('#llLibL')) return;
      $('#llLibL').innerHTML = (r.lessons.length ? r.lessons.map(function (x) { return '<div class="ll-card ' + (x.impact === 'positive' ? 'pos' : 'neg') + '"><div class="ll-ct"><b>' + esc(x.title) + '</b><small class="muted">' + esc(x.project) + (x.client ? ' · ' + esc(x.client) : '') + ' · ' + esc(x.category || '') + '</small></div>' + (x.what ? '<p><small>' + esc(x.what) + '</small></p>' : '') + (x.rec ? '<p>➜ ' + esc(x.rec) + '</p>' : '') +
        (canEdit() ? '<div class="ll-use"><button class="btn btn-sm" data-llpick="' + esc(x.core + ':' + x.id) + '">＋ Use as a lesson here</button></div>' : '') + '</div>'; }).join('') : '<p class="muted">' + (q ? 'Nothing found.' : 'No shared lessons from other projects yet.') + '</p>') + '<p class="muted" style="font-size:12px">' + r.total + ' lesson' + (r.total === 1 ? '' : 's') + ' in the library.</p>';
      $('#llLibL').querySelectorAll('[data-llpick]').forEach(function (b) { b.onclick = function () { var x = r.lessons.find(function (y) { return y.core + ':' + y.id === b.getAttribute('data-llpick'); }), p = plan(); p.lessons.push({ id: uid(), title: x.title, category: x.category, phase: '', impact: x.impact, what: x.what, cause: x.cause, rec: x.rec, status: 'Draft', reuse: false, source: 'library', from: x.project, by: (M.me || {}).name || '', at: Date.now() }); p.lessonsUsed.push(b.getAttribute('data-llpick')); C.dirty('lesson from the library'); b.disabled = true; b.textContent = '✓ Added'; draw(); }; });
    }).catch(fail); };
    var t; $('#llQ').oninput = function () { clearTimeout(t); var q = this.value; t = setTimeout(function () { show(q); }, 350); }; show('');
  }

  /* ---------------- 📄 the report ---------------- */
  function writeReport() {
    var core = C.S.core;
    if (C.S.timer || C.S.busy) toast('Saving the plan first…');
    M.modal('<h2>📄 The lessons-learned report</h2><p class="muted" style="margin:-4px 0 10px">The AI reads the whole project (up to about 80,000 tokens: the numbers, the lessons log, risks, issues, changes and the project\'s documents) and writes a 4-page illustrated report, with a 30-second video script. This takes a minute or two.</p><div id="llW"><p class="cr-wait">✨ Writing the report…</p></div>');
    (C.saveNow ? C.saveNow() : Promise.resolve()).then(function () { return bg({ mode: 'lessonsReport', core: core }); }).then(function (id) { return poll(id, 160); }).then(function (rep) { L.rep = rep; M.closeModal(); if (C.S.tab === 'lessons') draw(); openReport(rep); })
      .catch(function (e) { if ($('#llW')) $('#llW').innerHTML = '<p class="cr-wait" style="color:#B42318">' + esc(e.message) + '</p><div class="actions"><button class="btn" data-close type="button">Close</button></div>'; });
  }
  var rcharts = [];
  function openReport(rep) {
    if (!rep) return; var D = rep.data, F = rep.facts, p = plan(), job = C.S.job || {};
    var old = $('#llDoc'); if (old) old.remove();
    var kpi = function (lab, val, sub, cls) { return '<div class="ll-k ' + (cls || '') + '"><small>' + esc(lab) + '</small><b>' + esc(val) + '</b><span>' + esc(sub || '') + '</span></div>'; };
    var slip = F.slip_days || 0, over = F.budget ? Math.round(((F.EAC || F.BAC) - F.budget) / F.budget * 100) : 0;
    var foot = function (n) { return '<div class="ll-foot"><span>' + esc(D.title) + ' · ' + esc(F.project) + '</span><span>Project Champ · page ' + n + ' of 4</span></div>'; };
    var cards = function (arr, cls) { return arr.map(function (x) { return '<div class="ll-rc ' + cls + '">' + icon(x.icon, 30) + '<div><b>' + esc(x.title) + '</b><p>' + esc(x.detail) + '</p>' + (x.cause ? '<p class="ll-cause"><b>Root cause:</b> ' + esc(x.cause) + '</p>' : '') + '</div></div>'; }).join(''); };
    var html = '<div id="llDoc" class="ll-doc"><div class="ll-bar"><b>📄 ' + esc(D.title) + '</b><span class="sp"></span>' +
      '<button class="btn btn-sm" id="llVid" type="button">🎬 Play the 30-second video</button><button class="btn btn-sm" id="llPrint" type="button">🖨 Print or save as PDF</button><button class="btn btn-sm" id="llWord" type="button">⬇ Word</button>' + (canEdit() ? '<button class="btn btn-sm btn-gold" id="llKeep" type="button" title="Save the report (Word) and the video into this project\'s Documents (Reports folder, kept in R2)">💾 Save to Documents</button>' : '') + '<button class="btn btn-sm" id="llClose" type="button">✕ Close</button></div><div class="ll-pages">' +
      // page 1: the story at a glance
      '<section class="ll-pg"><div class="ll-cover"><small>LESSONS LEARNED · ' + esc((job.ref || '') + ' · ' + dmy(new Date(rep.at).toISOString().slice(0, 10))) + '</small><h1>' + esc(D.title) + '</h1><p>' + esc(D.subtitle) + '</p></div>' +
        '<p class="ll-head">' + esc(D.headline) + '</p><div class="ll-kpis">' + kpi('Finish', dmy(F.finish), F.baseline_finish ? (slip > 0 ? slip + ' days after the baseline (' + dmy(F.baseline_finish) + ')' : slip < 0 ? (-slip) + ' days early' : 'on the baseline') : 'no baseline set', slip > 21 ? 'bad' : slip > 0 ? 'warn' : 'good') +
        kpi('Forecast cost', money(F.EAC || F.BAC), F.budget ? (over > 0 ? over + '% over the ' + money(F.budget) + ' budget' : 'within the ' + money(F.budget) + ' budget') : '', over > 10 ? 'bad' : over > 0 ? 'warn' : 'good') +
        kpi('Schedule (SPI)', F.SPI == null ? '–' : F.SPI.toFixed(2), F.pct + '% complete', F.SPI != null && F.SPI < 0.9 ? 'bad' : F.SPI != null && F.SPI < 1 ? 'warn' : 'good') + kpi('Cost (CPI)', F.CPI == null ? '–' : F.CPI.toFixed(2), money(F.AC) + ' spent', F.CPI != null && F.CPI < 0.9 ? 'bad' : F.CPI != null && F.CPI < 1 ? 'warn' : 'good') + '</div>' +
        '<div class="ll-two"><div>' + D.story.map(function (x) { return '<p>' + esc(x) + '</p>'; }).join('') + '</div><div class="ll-gr"><h4>Planned vs actual, by phase</h4><canvas id="rgPh" height="250"></canvas></div></div>' + foot(1) + '</section>' +
      // page 2: what went well, the timeline
      '<section class="ll-pg"><h2 class="ll-h2 good">👍 What went well</h2><div class="ll-rcs">' + cards(D.went_well, 'good') + '</div><h4>The journey: milestones, planned and actual</h4><div id="rgTl"></div>' + (D.quote ? '<blockquote class="ll-q">“' + esc(D.quote) + '”</blockquote>' : '') + foot(2) + '</section>' +
      // page 3: what went wrong, root causes, cost
      '<section class="ll-pg"><h2 class="ll-h2 bad">⚠ What didn\'t go well</h2><div class="ll-rcs">' + cards(D.went_wrong, 'bad') + '</div><div class="ll-two"><div class="ll-gr"><h4>Root causes</h4><div id="rgFish"></div></div><div class="ll-gr"><h4>Cost by phase: baseline, forecast, spent</h4><canvas id="rgCost" height="230"></canvas></div></div>' + foot(3) + '</section>' +
      // page 4: recommendations, reuse, the video
      '<section class="ll-pg"><h2 class="ll-h2">➜ Recommendations</h2><table class="ll-rec"><thead><tr><th>#</th><th>Recommendation</th><th>Owner</th><th>When</th><th>Applies to</th></tr></thead><tbody>' + D.recommendations.map(function (r, i) { return '<tr><td>' + (i + 1) + '</td><td><b>' + esc(r.title) + '</b><br><small>' + esc(r.detail) + '</small></td><td>' + esc(r.owner) + '</td><td>' + esc(r.when) + '</td><td>' + esc(r.applies_to) + '</td></tr>'; }).join('') + '</tbody></table>' +
        '<div class="ll-two"><div><h4>📚 Reuse checklist for future projects</h4><ul class="ll-chk">' + D.reuse.map(function (x) { return '<li>☐ ' + esc(x) + '</li>'; }).join('') + '</ul></div><div><h4>🎬 The story in 30 seconds</h4><div class="ll-story">' + D.video.scenes.map(function (s, i) { return '<div class="ll-sc">' + icon(s.icon, 34) + '<small>' + (i + 1) + '. ' + esc(s.caption) + '</small></div>'; }).join('') + '</div><p class="muted ll-noprint" style="font-size:12px">▶ Press “Play the 30-second video” above; save it to Documents to keep it with the project.</p></div></div>' +
        '<p class="muted" style="font-size:11px;margin-top:10px">Written by AI from the project\'s records (' + Math.round((rep.context || 0) / 1000) + 'k tokens read' + (rep.docs ? ', ' + rep.docs + ' documents' : '') + '). Check it before you share it.</p>' + foot(4) + '</section></div></div>';
    document.body.insertAdjacentHTML('beforeend', html); document.body.classList.add('ll-open');
    $('#llClose').onclick = function () { $('#llDoc').remove(); document.body.classList.remove('ll-open'); stopVideo(); };
    $('#llPrint').onclick = function () { window.print(); };
    $('#llWord').onclick = function () { word(rep).then(function (b) { var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = fileName(rep, 'docx'); document.body.appendChild(a); a.click(); a.remove(); }).catch(fail); };
    $('#llVid').onclick = function () { video(rep, false); };
    var kp = $('#llKeep'); if (kp) kp.onclick = function () { keep(rep, kp); };
    graphics(rep);
  }
  function fileName(rep, ext) { return ('Lessons learned - ' + rep.facts.project).replace(/[\\/:*?"<>|]+/g, '-').slice(0, 90) + '.' + ext; }
  function graphics(rep) {
    var F = rep.facts, D = rep.data;
    // the timeline of milestones: planned (grey) and actual (colour), on one date axis
    var ms = (F.milestones || []).filter(function (m) { return m.date; }).slice(0, 10);
    var tl = $('#rgTl'); if (tl) {
      var all = []; ms.forEach(function (m) { all.push(m.date); if (m.planned) all.push(m.planned); }); if (F.start) all.push(F.start);
      all.sort(); var t0 = Date.parse(all[0] || F.start), t1 = Date.parse(all[all.length - 1] || F.finish), W = 760, x = function (d) { return 30 + (Date.parse(d) - t0) / Math.max(1, t1 - t0) * (W - 60); };
      var svg = '<svg viewBox="0 0 ' + W + ' ' + (60 + ms.length * 26) + '" width="100%" class="ll-tl"><line x1="30" y1="30" x2="' + (W - 30) + '" y2="30" stroke="#151515" stroke-width="2"/>' +
        '<text x="30" y="18" font-size="11">' + esc(dmy(all[0])) + '</text><text x="' + (W - 30) + '" y="18" font-size="11" text-anchor="end">' + esc(dmy(all[all.length - 1])) + '</text>';
      ms.forEach(function (m, i) { var y = 54 + i * 26, late = m.planned && m.date > m.planned;
        if (m.planned) svg += '<circle cx="' + x(m.planned) + '" cy="' + y + '" r="5" fill="#fff" stroke="#98A2B3" stroke-width="2"/><line x1="' + x(m.planned) + '" y1="' + y + '" x2="' + x(m.date) + '" y2="' + y + '" stroke="' + (late ? '#F04438' : '#17B26A') + '" stroke-width="2" stroke-dasharray="4 3"/>';
        svg += '<path d="M' + x(m.date) + ' ' + (y - 7) + 'l7 7-7 7-7-7z" fill="' + (m.done ? (late ? '#F79009' : '#17B26A') : late ? '#F04438' : '#5B6B8C') + '"/><text x="' + (x(m.date) + 12) + '" y="' + (y + 4) + '" font-size="11">' + esc(m.name.slice(0, 60)) + (late ? ' (' + Math.round((Date.parse(m.date) - Date.parse(m.planned)) / 864e5) + 'd late)' : '') + '</text>'; });
      tl.innerHTML = ms.length ? svg + '</svg><p class="muted" style="font-size:11px;margin:2px 0 0">○ planned · ◆ actual or forecast (green on time, orange done late, red still late)</p>' : '<p class="muted">No milestones in the plan.</p>';
    }
    // the fishbone: the causes of what went wrong, grouped by category
    var fb = $('#rgFish'); if (fb) {
      var G = {}; D.went_wrong.forEach(function (x) { (G[x.cause_category] = G[x.cause_category] || []).push(x.cause || x.title); });
      var cats = Object.keys(G).slice(0, 6), W2 = 380, H = 230, svg2 = '<svg viewBox="0 0 ' + W2 + ' ' + H + '" width="100%"><line x1="10" y1="115" x2="300" y2="115" stroke="#151515" stroke-width="2.5"/><path d="M300 95h70v40h-70z" fill="#FEE4E2" stroke="#B42318"/><text x="335" y="112" font-size="10" text-anchor="middle" font-weight="700">What went</text><text x="335" y="125" font-size="10" text-anchor="middle" font-weight="700">wrong</text>';
      cats.forEach(function (c, i) { var top = i % 2 === 0, bx = 40 + Math.floor(i / 2) * 90, y0 = top ? 25 : 205;
        svg2 += '<line x1="' + bx + '" y1="' + y0 + '" x2="' + (bx + 50) + '" y2="115" stroke="#5B6B8C" stroke-width="1.6"/><text x="' + bx + '" y="' + (top ? 16 : 222) + '" font-size="10.5" font-weight="700">' + esc(c) + '</text>';
        G[c].slice(0, 2).forEach(function (t, j) { var yy = top ? 45 + j * 22 : 185 - j * 22, xx = bx + 50 * ((yy - y0) / (115 - y0)); svg2 += '<line x1="' + (xx - 4) + '" y1="' + yy + '" x2="' + (xx + 34) + '" y2="' + yy + '" stroke="#98A2B3"/><text x="' + (xx + 2) + '" y="' + (yy - 3) + '" font-size="8">' + esc(t.slice(0, 34)) + '</text>'; }); });
      fb.innerHTML = cats.length ? svg2 + '</svg>' : '<p class="muted">No root causes recorded.</p>';
    }
    chartLib().then(function () {
      rcharts.forEach(function (c) { try { c.destroy(); } catch (e) {} }); rcharts = [];
      var ph = F.phases || [], base = Date.parse(F.start || (ph[0] || {}).start || new Date().toISOString().slice(0, 10)), d = function (s) { return s ? Math.round((Date.parse(s) - base) / 864e5) : null; };
      var c1 = $('#rgPh'); if (c1 && ph.length) rcharts.push(new window.Chart(c1, { type: 'bar', data: { labels: ph.map(function (x) { return x.phase.slice(0, 26); }), datasets: [{ label: 'Planned (baseline)', data: ph.map(function (x) { return x.planned_start ? [d(x.planned_start), d(x.planned_finish)] : null; }), backgroundColor: '#D0D5DD' }, { label: 'Actual / forecast', data: ph.map(function (x) { return [d(x.start), d(x.finish)]; }), backgroundColor: ph.map(function (x) { return x.slip_days > 10 ? '#F04438' : x.slip_days > 0 ? '#F79009' : '#17B26A'; }) }] },
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { position: 'bottom' } }, scales: { x: { title: { display: true, text: 'days from the start' } } } } }));
      var c2 = $('#rgCost'); if (c2 && ph.length) rcharts.push(new window.Chart(c2, { type: 'bar', data: { labels: ph.map(function (x) { return x.phase.slice(0, 20); }), datasets: [{ label: 'Baseline', data: ph.map(function (x) { return x.planned_cost; }), backgroundColor: '#D0D5DD' }, { label: 'Forecast', data: ph.map(function (x) { return x.cost; }), backgroundColor: '#5B6B8C' }, { label: 'Spent', data: ph.map(function (x) { return x.actual; }), backgroundColor: '#C9A227' }] },
        options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { position: 'bottom' } }, scales: { y: { ticks: { callback: function (v) { return '$' + (v >= 1000 ? Math.round(v / 1000) + 'k' : v); } } } } } }));
    }).catch(function () {});
  }

  /* ---------------- ⬇ Word ---------------- */
  function word(rep) {
    var D = rep.data, F = rep.facts;
    return C.piLoad('vendor/docx.iife.js?v=951', function () { return !!window.docx; }).then(function () {
      var X = window.docx, P = function (t, o) { return new X.Paragraph(Object.assign({ children: [new X.TextRun(Object.assign({ text: String(t || '') }, (o && o.run) || {}))] }, o || {})); };
      var H = function (t, l) { return new X.Paragraph({ text: t, heading: l || X.HeadingLevel.HEADING_2 }); };
      var img = function (id, w, h) { var c = $('#' + id); if (!c || !c.toDataURL) return null; var u = c.toDataURL('image/png'), b = atob(u.split(',')[1]), a = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return new X.Paragraph({ children: [new X.ImageRun({ data: a, transformation: { width: w, height: h }, type: 'png' })] }); };
      var kids = [new X.Paragraph({ text: D.title, heading: X.HeadingLevel.TITLE }), P(D.subtitle), P(F.project + ' · ' + (C.S.job || {}).ref), P(D.headline, { run: { bold: true } }),
        P('Finish ' + dmy(F.finish) + (F.baseline_finish ? ' (baseline ' + dmy(F.baseline_finish) + ', ' + F.slip_days + ' days)' : '') + ' · forecast cost ' + money(F.EAC || F.BAC) + (F.budget ? ' of ' + money(F.budget) : '') + ' · SPI ' + (F.SPI == null ? '–' : F.SPI) + ' · CPI ' + (F.CPI == null ? '–' : F.CPI))]
        .concat(D.story.map(function (x) { return P(x); })).concat([img('rgPh', 560, 260), H('What went well')].filter(Boolean))
        .concat([].concat.apply([], D.went_well.map(function (x) { return [P(x.title, { run: { bold: true } }), P(x.detail)]; })))
        .concat([H('What didn\'t go well')]).concat([].concat.apply([], D.went_wrong.map(function (x) { return [P(x.title, { run: { bold: true } }), P(x.detail), P('Root cause: ' + x.cause, { run: { italics: true } })]; })))
        .concat([img('rgCost', 560, 240), H('Recommendations')].filter(Boolean)).concat(D.recommendations.map(function (r, i) { return P((i + 1) + '. ' + r.title + ': ' + r.detail + ' (' + [r.owner, r.when, r.applies_to].filter(Boolean).join(' · ') + ')'); }))
        .concat([H('Reuse checklist for future projects')]).concat(D.reuse.map(function (x) { return P('☐ ' + x); }))
        .concat(D.quote ? [P('“' + D.quote + '”', { run: { italics: true } })] : []).concat([H('The 30-second story'), P(D.video.scenes.map(function (s, i) { return (i + 1) + '. ' + s.caption + ': ' + s.say; }).join('  '))]);
      return X.Packer.toBlob(new X.Document({ creator: 'Project Champ', title: D.title, sections: [{ children: kids }] }));
    });
  }
  function reportText(rep) { var D = rep.data; return [D.title, D.subtitle, D.headline].concat(D.story).concat(['What went well']).concat(D.went_well.map(function (x) { return x.title + ': ' + x.detail; })).concat(['What did not go well']).concat(D.went_wrong.map(function (x) { return x.title + ': ' + x.detail + ' Root cause: ' + x.cause; })).concat(['Recommendations']).concat(D.recommendations.map(function (r) { return r.title + ': ' + r.detail; })).concat(D.reuse).join('\n\n'); }
  function keep(rep, btn) {
    var core = C.S.core; btn.disabled = true; btn.textContent = 'Saving…';
    var up = function (blob, name, text, kind) { var f = new File([blob], name, { type: blob.type }); return C.storeFile(f, 'project', core).then(function (ff) { return api('intelUpload', { core: core, name: name, type: blob.type, size: blob.size, pages: 4, text: text, file: ff.file || '', r2Key: ff.r2Key || '', allowEmpty: !text, folder: 'reports', kind: kind, title: kind === 'Video' ? 'Lessons learned video (30 s)' : 'Lessons learned report' }); }); };
    word(rep).then(function (b) { return up(b, fileName(rep, 'docx'), reportText(rep), 'Lessons learned'); })
      .then(function () { return L.videoBlob ? up(L.videoBlob, fileName(rep, 'webm').replace('.webm', ' - video.webm'), 'Lessons learned video script. ' + rep.data.video.scenes.map(function (s) { return s.caption + ': ' + s.say; }).join(' '), 'Video') : null; })
      .then(function () { btn.textContent = '✓ Saved to Documents'; if (C.S.dms) C.S.dms = null; toast('Saved to Documents › 📊 Reports and status' + (L.videoBlob ? ' (the report and the video)' : ' (play the video first to save it too)')); })
      .catch(function (e) { btn.disabled = false; btn.textContent = '💾 Save to Documents'; fail(e); });
  }

  /* ---------------- 🎬 the 30-second scribe video ---------------- */
  var V = null;
  function stopVideo() { if (V) { V.stop = true; try { if (V.ac && V.ac.state !== 'closed') { var cp = V.ac.close(); if (cp && cp.catch) cp.catch(function () {}); } } catch (e) {} try { V.rec && V.rec.state !== 'inactive' && V.rec.stop(); } catch (e) {} } }
  function pathLen(d) { var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); s.style.position = 'absolute'; s.style.width = '0'; s.style.height = '0'; p.setAttribute('d', d); s.appendChild(p); document.body.appendChild(s); var o = { el: p, len: p.getTotalLength(), s: s }; return o; }
  function video(rep) {
    stopVideo(); var D = rep.data, sc = D.video.scenes.slice(0, 5);
    M.modal('<h2>🎬 ' + esc(D.video.title) + '</h2><canvas id="llCv" width="1280" height="720" class="ll-cv"></canvas><p class="muted" id="llVs" style="font-size:12.5px;margin:6px 0">Getting Champ\'s voice ready…</p><div id="llVo"></div><div class="actions"><button class="btn" id="llVStop" type="button">Close</button></div>');
    $('#llVStop').onclick = function () { stopVideo(); M.closeModal(); };
    var cv = $('#llCv'), g = cv.getContext('2d'), lang = (window.ChampI18n && window.ChampI18n.get()) || 'en';
    V = { stop: false }; var me = V;
    // the narration for each scene (Champ's voice), decoded so it can be mixed into the recording
    var AC = window.AudioContext || window.webkitAudioContext, ac = AC ? new AC() : null; V.ac = ac;
    var dest = ac && ac.createMediaStreamDestination ? ac.createMediaStreamDestination() : null;
    var say = function (t) { if (!ac || !t) return Promise.resolve(null); return fetch('/.netlify/functions/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: t, lang: lang, clear: true }) }).then(function (r) { if (!r.ok) throw new Error('voice'); return r.arrayBuffer(); }).then(function (b) { return new Promise(function (res) { var pr; try { pr = ac.decodeAudioData(b, res, function () { res(null); }); } catch (e) { res(null); } if (pr && pr.catch) pr.catch(function () { res(null); }); }); }).catch(function () { return null; }); };
    Promise.all(sc.map(function (s) { return say(s.say); })).then(function (aud) { return (ac && ac.state === 'suspended' ? ac.resume().catch(function () {}) : Promise.resolve()).then(function () { return aud; }); }).then(function (aud) {
      if (me.stop) return; var withSound = !!(dest && ac && ac.state === 'running' && aud.some(Boolean));
      // each scene lasts as long as its narration (4 to 6.5 seconds), the whole video at most 30 seconds with the title and the close
      var dur = sc.map(function (s, i) { return Math.min(6.5, Math.max(4, aud[i] ? aud[i].duration + 0.5 : 5)); }), intro = 2.2, outro = 2.5, tot = intro + dur.reduce(function (a, b) { return a + b; }, 0) + outro;
      if (tot > 30) { var k = (30 - intro - outro) / (tot - intro - outro); dur = dur.map(function (d) { return d * k; }); tot = 30; }
      var stream = cv.captureStream ? cv.captureStream(30) : null, rec = null, chunks = [];
      if (stream && window.MediaRecorder) { if (withSound) dest.stream.getAudioTracks().forEach(function (t) { stream.addTrack(t); });
        var mime = (withSound ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'] : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']).find(function (m) { return MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m); });
        try { rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 2500000 } : undefined); rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); }; rec.start(250); me.rec = rec; } catch (e) { rec = null; } }
      var paths = sc.map(function (s) { return (IC[s.icon] || IC.idea).split(/(?=M)/).map(function (d) { return Object.assign({ d: d }, pathLen(d)); }); });
      var t0 = performance.now(), started = {};
      $('#llVs').textContent = rec ? '● Recording while it plays (' + Math.round(tot) + ' seconds)…' : 'Playing (' + Math.round(tot) + ' seconds)…';
      var hand = "'Segoe Print','Bradley Hand','Comic Sans MS','Chalkboard SE',cursive";
      var wrap = function (text, x, y, max, lh) { var w = String(text).split(' '), line = ''; w.forEach(function (word) { var tt = line ? line + ' ' + word : word; if (g.measureText(tt).width > max && line) { g.fillText(line, x, y); line = word; y += lh; } else line = tt; }); g.fillText(line, x, y); };
      function frame() {
        if (me.stop) return; var t = (performance.now() - t0) / 1000;
        g.fillStyle = '#FFFEFA'; g.fillRect(0, 0, 1280, 720); g.strokeStyle = '#EEE7D3'; g.lineWidth = 2; g.strokeRect(18, 18, 1244, 684);
        g.fillStyle = '#9A8F6F'; g.font = "600 22px 'Poppins',sans-serif"; g.textAlign = 'left'; g.fillText('Lessons learned · ' + rep.facts.project.slice(0, 60), 50, 62);
        if (t < intro) { var a = Math.min(1, t / 0.8); g.globalAlpha = a; g.fillStyle = '#151515'; g.textAlign = 'center'; g.font = "700 64px " + hand; wrap(D.video.title, 640, 340, 1000, 76); g.font = "28px " + hand; g.fillStyle = '#7A5C00'; g.fillText('by Champ', 640, 470); g.globalAlpha = 1; }
        else if (t < tot - outro) {
          var acc = intro, i = 0; while (i < dur.length - 1 && t > acc + dur[i]) { acc += dur[i]; i++; }
          var lt = (t - acc) / dur[i], s = sc[i];
          if (!started[i]) { started[i] = 1; if (aud[i] && ac) { var src = ac.createBufferSource(); src.buffer = aud[i]; src.connect(ac.destination); if (dest) src.connect(dest); src.start(); } }
          g.fillStyle = '#C9A227'; g.font = "700 26px 'Poppins',sans-serif"; g.textAlign = 'left'; g.fillText(String(i + 1) + ' / ' + sc.length, 50, 690);
          // the icon, drawn stroke by stroke with the pen following the line
          var P = paths[i], total = P.reduce(function (x, q) { return x + q.len; }, 0), drawn = Math.min(1, lt / 0.55) * total, pen = null;
          g.save(); g.translate(170, 170); g.scale(14, 14); g.lineWidth = 0.24; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#151515';
          P.forEach(function (q) { if (drawn <= 0) return; var part = Math.min(q.len, drawn); drawn -= q.len; g.setLineDash([part, q.len + 1]); g.stroke(new Path2D(q.d)); if (part < q.len || drawn <= 0 && !pen) { var pt = q.el.getPointAtLength(part); pen = { x: pt.x, y: pt.y }; } });
          g.restore(); g.setLineDash([]);
          if (pen && lt < 0.6) { var px = 170 + pen.x * 14, py = 170 + pen.y * 14; g.save(); g.translate(px, py); g.rotate(-0.5); g.fillStyle = '#C9A227'; g.fillRect(0, -7, 70, 14); g.fillStyle = '#151515'; g.beginPath(); g.moveTo(0, -7); g.lineTo(-16, 0); g.lineTo(0, 7); g.fill(); g.restore(); }
          // the caption, written out, and the narration underneath
          var cap = s.caption, n = Math.floor(Math.min(1, Math.max(0, (lt - 0.15) / 0.45)) * cap.length);
          g.fillStyle = '#151515'; g.textAlign = 'left'; g.font = "700 58px " + hand; wrap(cap.slice(0, n), 600, 300, 620, 70);
          if (lt > 0.35) { g.globalAlpha = Math.min(1, (lt - 0.35) / 0.2); g.fillStyle = '#4A4537'; g.font = "30px 'Poppins',sans-serif"; wrap(s.say, 600, 470, 620, 42); g.globalAlpha = 1; }
          g.strokeStyle = '#C9A227'; g.lineWidth = 6; g.beginPath(); g.moveTo(600, 330 + 12); g.lineTo(600 + Math.min(1, lt / 0.6) * 380, 330 + 12); g.stroke();
        } else { var b2 = Math.min(1, (t - (tot - outro)) / 0.6); g.globalAlpha = b2; g.fillStyle = '#151515'; g.textAlign = 'center'; g.font = "700 50px " + hand; wrap(D.quote || D.headline, 640, 320, 1050, 62); g.font = "600 26px 'Poppins',sans-serif"; g.fillStyle = '#7A5C00'; g.fillText('Project Champ · GKH', 640, 560); g.globalAlpha = 1; }
        if (t < tot) requestAnimationFrame(frame); else finish();
      }
      function finish() {
        paths.forEach(function (P) { P.forEach(function (q) { q.s.remove(); }); });
        if (!rec) { $('#llVs').textContent = 'Done. (This browser cannot record video: use Chrome or Edge to save it.)'; return; }
        rec.onstop = function () { var b = new Blob(chunks, { type: (rec.mimeType || 'video/webm').split(';')[0] }); if (!b.size) { if ($('#llVs')) $('#llVs').textContent = 'This browser played the video but could not record it. Try Chrome or Edge on a computer.'; return; } L.videoBlob = b; var u = URL.createObjectURL(b);
          if (!$('#llVo')) return; $('#llVs').textContent = '✓ The video is ready (' + Math.round(b.size / 1024) + ' KB).';
          $('#llVo').innerHTML = '<video src="' + u + '" controls class="ll-cv"></video><div class="actions" style="justify-content:flex-start"><a class="btn btn-sm" href="' + u + '" download="' + esc(fileName(rep, /mp4/.test(b.type) ? 'mp4' : 'webm')) + '">⬇ Download the video</a>' + (canEdit() ? '<button class="btn btn-sm btn-gold" id="llVKeep" type="button">💾 Save the report and video to Documents</button>' : '') + '</div>';
          cv.remove(); var vk = $('#llVKeep'); if (vk) vk.onclick = function () { keep(rep, vk); }; };
        try { rec.stop(); } catch (e) {}
      }
      if (ac && ac.state === 'suspended') ac.resume();
      requestAnimationFrame(frame);
    });
  }

  M.lessonsTab = tab;
})();
