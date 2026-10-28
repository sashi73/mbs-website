/* MBS Console: project planner (PMI, waterfall). Inspired by Microsoft Project / Planner:
   schedule grid + Gantt, board, scope (charter), time & cost (earned value), risks, issues, baseline, reminders. */
(function () {
  'use strict';
  var M = window.MBS; if (!M) return;
  var api = M.api, esc = M.esc, money = M.money, toast = M.toast, fail = M.fail, $ = M.$;
  var V = function () { return M.view(); };
  var r2 = function (n) { return Math.round((Number(n) || 0) * 100) / 100; };

  /* ---------- working days (same rules as the server) ---------- */
  var toD = function (s) { var a = s.split('-').map(Number); return new Date(Date.UTC(a[0], a[1] - 1, a[2])); };
  var toS = function (d) { return d.toISOString().slice(0, 10); };
  var wk = function (d) { var w = d.getUTCDay(); return w !== 0 && w !== 6; };
  function nextWork(s) { var d = toD(s); while (!wk(d)) d = new Date(d.getTime() + 864e5); return toS(d); }
  function addWork(s, n) { var d = toD(s); while (n > 0) { d = new Date(d.getTime() + 864e5); if (wk(d)) n--; } return toS(d); }
  function workBetween(a, b) { if (!a || !b || b < a) return 0; var n = 0, d = toD(a), e = toD(b); while (d <= e) { if (wk(d)) n++; d = new Date(d.getTime() + 864e5); } return n; }
  function daysBetween(a, b) { return Math.round((toD(b) - toD(a)) / 864e5); }
  function today() { var o = {}; new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).forEach(function (p) { o[p.type] = p.value; }); return o.year + '-' + o.month + '-' + o.day; }
  var pretty = function (s) { if (!s) return ''; var a = s.split('-').map(Number); return a[2] + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][a[1] - 1]; };
  var prettyY = function (s) { return s ? pretty(s) + ' ' + s.slice(0, 4) : ''; };

  function schedule(p) {
    var start = nextWork(p.start || today()), byId = {};
    p.tasks.forEach(function (t) { byId[t.id] = t; t.es = ''; t.ef = ''; });
    for (var pass = 0; pass < 30; pass++) {
      var changed = false;
      p.tasks.forEach(function (t) {
        var es = start;
        (t.pred || []).forEach(function (id) { var q = byId[id]; if (q && q.ef && q !== t) { var after = q.dur === 0 ? nextWork(q.ef) : addWork(nextWork(q.ef), 1); if (after > es) es = after; } });
        if (t.snet && t.snet > es) es = t.snet;
        es = nextWork(es);
        var ef = t.dur === 0 ? es : addWork(es, Math.max(1, t.dur) - 1);
        if (es !== t.es || ef !== t.ef) { t.es = es; t.ef = ef; changed = true; }
      });
      if (!changed) break;
    }
  }
  var cost = function (t) { return r2((Number(t.qty) || 0) * (Number(t.rate) || 0)); };
  function rollup(p, day) {
    schedule(p);
    var T = p.tasks, frac = function (t) { return !t.es ? 0 : day < t.es ? 0 : day >= t.ef ? 1 : workBetween(t.es, day) / Math.max(1, workBetween(t.es, t.ef)); };
    var BAC = r2(T.reduce(function (a, t) { return a + cost(t); }, 0)), PV = r2(T.reduce(function (a, t) { return a + cost(t) * frac(t); }, 0));
    var EV = r2(T.reduce(function (a, t) { return a + cost(t) * (t.pct || 0) / 100; }, 0)), AC = r2(T.reduce(function (a, t) { return a + (Number(t.actual) || 0); }, 0));
    var durW = T.reduce(function (a, t) { return a + Math.max(1, t.dur); }, 0) || 1;
    var CPI = AC > 0 ? r2(EV / AC) : null, SPI = PV > 0 ? r2(EV / PV) : null;
    return { BAC: BAC, PV: PV, EV: EV, AC: AC, CPI: CPI, SPI: SPI, EAC: CPI ? r2(BAC / CPI) : null,
      start: T.reduce(function (m, t) { return !m || (t.es && t.es < m) ? t.es : m; }, ''), finish: T.reduce(function (m, t) { return t.ef > m ? t.ef : m; }, ''),
      done: T.filter(function (t) { return t.pct >= 100; }).length, total: T.length, late: T.filter(function (t) { return t.pct < 100 && t.ef && t.ef < day; }),
      pct: T.length ? Math.round(T.reduce(function (a, t) { return a + Math.max(1, t.dur) * (t.pct || 0); }, 0) / durW) : 0 };
  }
  var pl = function (n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); };
  var rag = function (v, g, a) { return v == null ? 'grey' : v >= g ? 'green' : v >= a ? 'amber' : 'red'; };

  /* ---------- templates (example rates: change them to yours) ---------- */
  function T(name, objective, scope, rows, risks) { return { name: name, objective: objective, scope: scope, rows: rows, risks: risks || [] }; }
  var TEMPLATES = {
    bathroom: T('Bathroom waterproofing & retiling', 'Strip, waterproof to AS 3740 and retile the bathroom with no leaks, on time and on budget.', 'Strip-out, plumbing rough-in and fit-off, screed and falls, Ardex membrane, flood test, floor and wall tiles, grout and silicone, clean and handover.', [
      [0, 'k1', 'Site inspection & measure', 1, '', 2, 'h', 90, []], [0, 'k2', 'Quote accepted', 0, '', 0, '', 0, ['k1']],
      [1, 'k3', 'Buy tiles', 1, '', 12, 'm²', 65, ['k2']], [1, 'k4', 'Order membrane & plumbing parts', 1, '', 1, 'lot', 650, ['k2']], [1, 'k5', 'Book plumber & tiler', 1, '', 1, 'h', 90, ['k2']],
      [2, 'k6', 'Strip-out & rubbish removal', 2, '', 16, 'h', 55, ['k3', 'k4', 'k5'], [['Remove vanity, toilet and screen', 0, 1], ['Remove tiles and screed', 0, 2], ['Rubbish removal', 1, 1]]], [2, 'k7', 'Plumbing rough-in', 1, '', 8, 'h', 110, ['k6']], [2, 'k8', 'Screed & falls', 1, '', 8, 'h', 85, ['k7']],
      [2, 'k9', 'Waterproofing membrane (Ardex)', 2, '', 1, 'lot', 900, ['k8']], [3, 'k10', 'Flood test (24 h) & photos', 1, '', 1, 'h', 90, ['k9']],
      [2, 'k11', 'Wall & floor tiling', 3, '', 24, 'h', 85, ['k10'], [['Set out and cut', 0, 1], ['Floor tiles', 0, 1], ['Wall tiles', 1, 2]]], [2, 'k12', 'Grout & silicone', 1, '', 6, 'h', 85, ['k11']], [2, 'k13', 'Fit-off: vanity, tapware, screen', 1, '', 6, 'h', 110, ['k12']],
      [3, 'k14', 'Final inspection & defects', 1, '', 1, 'h', 90, ['k13']], [4, 'k15', 'Clean & handover', 1, '', 3, 'h', 50, ['k14']], [4, 'k16', 'Invoice & warranty certificate', 0, '', 0, '', 0, ['k15']]],
      [['Hidden water damage found during strip-out', 3, 4, 'Mitigate', 'Inspect with moisture meter early; agree a contingency allowance in the quote'], ['Tile delivery delay', 2, 3, 'Mitigate', 'Confirm stock before ordering; order on day 1'], ['Membrane slow to cure (cold or humid)', 2, 2, 'Accept', 'Allow an extra day before the flood test']]),
    balcony: T('Balcony remediation (concrete cancer)', 'Repair concrete cancer and re-waterproof the balcony so it stays dry, with strata approval and safe access.', 'Inspection and report, approvals, scaffold, remove tiles and screed, concrete repair, new screed, membrane, flood test, retile, reinstate balustrade, handover.', [
      [0, 'k1', 'Site inspection & moisture readings', 1, '', 2, 'h', 90, []], [0, 'k2', 'Engineer report', 3, '', 1, 'lot', 1200, ['k1']], [0, 'k3', 'Strata / owner approval', 0, '', 0, '', 0, ['k2']],
      [1, 'k4', 'Safety & scaffold plan', 1, '', 2, 'h', 90, ['k3']], [1, 'k5', 'Order materials', 1, '', 1, 'lot', 1500, ['k3']], [1, 'k6', 'Scaffold hire', 1, '', 1, 'lot', 800, ['k4']],
      [2, 'k7', 'Remove tiles & screed', 2, '', 16, 'h', 55, ['k5', 'k6']], [2, 'k8', 'Concrete repair', 3, '', 1, 'lot', 2400, ['k7']], [2, 'k9', 'New screed & falls', 2, '', 16, 'h', 85, ['k8']],
      [2, 'k10', 'Waterproofing membrane', 2, '', 1, 'lot', 1400, ['k9']], [3, 'k11', 'Flood test & photos', 1, '', 1, 'h', 90, ['k10']], [2, 'k12', 'Retile balcony', 3, '', 24, 'h', 85, ['k11']],
      [2, 'k13', 'Reinstate balustrade', 1, '', 1, 'lot', 600, ['k12']], [3, 'k14', 'Final inspection', 1, '', 1, 'h', 90, ['k13']], [4, 'k15', 'Strike scaffold & handover', 1, '', 1, 'lot', 300, ['k14']],
      [4, 'k16', 'Invoice & warranty', 0, '', 0, '', 0, ['k15']]],
      [['Rain delays membrane or tiling', 4, 3, 'Mitigate', 'Weather covers; keep a 2-day buffer'], ['Concrete damage worse than the report', 3, 4, 'Mitigate', 'Variation process agreed with strata up front'], ['Access through neighbouring units', 2, 3, 'Avoid', 'Confirm access dates with strata in writing']]),
    repaint: T('Exterior repaint', 'Repaint the exterior with a durable, even finish, protecting gardens and neighbours.', 'Colour consult, wash, preparation and repairs, primer, two top coats, touch-ups, clean-up and handover.', [
      [0, 'k1', 'Inspection & colour consult', 1, '', 2, 'h', 90, []], [0, 'k2', 'Quote accepted', 0, '', 0, '', 0, ['k1']],
      [1, 'k3', 'Buy paint', 1, '', 60, 'L', 45, ['k2']], [1, 'k4', 'Book access equipment', 1, '', 1, 'lot', 350, ['k2']],
      [2, 'k5', 'Pressure wash', 1, '', 8, 'h', 55, ['k3', 'k4']], [2, 'k6', 'Prep & repairs', 2, '', 16, 'h', 70, ['k5']], [2, 'k7', 'Prime', 1, '', 8, 'h', 70, ['k6']],
      [2, 'k8', 'First coat', 2, '', 16, 'h', 70, ['k7']], [2, 'k9', 'Second coat', 2, '', 16, 'h', 70, ['k8']], [2, 'k10', 'Touch-ups', 1, '', 4, 'h', 70, ['k9']],
      [3, 'k11', 'Quality inspection', 1, '', 1, 'h', 90, ['k10']], [4, 'k12', 'Clean-up & handover', 1, '', 4, 'h', 55, ['k11']], [4, 'k13', 'Invoice', 0, '', 0, '', 0, ['k12']]],
      [['Rain or wind stops painting', 4, 3, 'Mitigate', 'Check the forecast daily; move to sheltered sides'], ['Customer unhappy with colour once applied', 2, 3, 'Avoid', 'Paint a test patch and get sign-off']]),
    deck: T('Deck & pergola build', 'Build a safe, compliant deck and pergola that drains well and looks good for years.', 'Design and set-out, footings, sub-frame, decking, pergola, balustrade and stairs, oil finish, handover.', [
      [0, 'k1', 'Measure & design', 1, '', 3, 'h', 90, []], [0, 'k2', 'Quote accepted', 0, '', 0, '', 0, ['k1']], [0, 'k3', 'Council / exempt development check', 2, '', 2, 'h', 90, ['k2']],
      [1, 'k4', 'Order timber & hardware', 1, '', 1, 'lot', 3200, ['k3']],
      [2, 'k5', 'Set out & footings', 2, '', 16, 'h', 75, ['k4']], [2, 'k6', 'Bearers & joists', 2, '', 16, 'h', 75, ['k5']], [2, 'k7', 'Decking boards', 2, '', 16, 'h', 75, ['k6']],
      [2, 'k8', 'Pergola frame & roof', 2, '', 16, 'h', 75, ['k7']], [2, 'k9', 'Balustrade & stairs', 2, '', 16, 'h', 75, ['k8']], [2, 'k10', 'Oil / stain finish', 1, '', 6, 'h', 70, ['k9']],
      [3, 'k11', 'Safety & quality check', 1, '', 1, 'h', 90, ['k10']], [4, 'k12', 'Handover', 1, '', 1, 'h', 90, ['k11']], [4, 'k13', 'Invoice', 0, '', 0, '', 0, ['k12']]],
      [['Underground services where footings go', 2, 4, 'Avoid', 'Dial Before You Dig before set-out'], ['Timber price or supply changes', 3, 2, 'Mitigate', 'Lock in the order when the quote is accepted']]),
    blank: T('Project plan', '', '', [[0, 'k1', 'Site inspection', 1, '', 1, 'h', 90, []], [4, 'k2', 'Handover', 1, '', 1, 'h', 90, ['k1']]], [])
  };
  function fromTemplate(key, job, start) {
    var t = TEMPLATES[key], ids = {}, n = 0;
    var tasks = t.rows.map(function (r) { var id = 't' + (++n); ids[r[1]] = id; return { id: id, phase: 'ph1', name: r[2], dur: r[3], res: [], lead: '', resource: '', qty: r[5], unit: r[6], rate: r[7], pred: r[8], actual: 0, pct: 0, status: 'todo', snet: '', notes: '',
      subs: (r[9] || []).map(function (x, i) { return { id: 's' + n + '_' + (i + 1), name: x[0], off: x[1], dur: x[2], owner: '', status: 'todo' }; }) }; });
    tasks.forEach(function (x) { x.pred = x.pred.map(function (k) { return ids[k]; }).filter(Boolean); });
    var budget = r2(tasks.reduce(function (a, x) { return a + cost(x); }, 0));
    return { name: key === 'blank' ? (job.service || 'Project plan') : t.name, start: start, phases: [{ id: 'ph1', name: 'Work' }], tasks: tasks,
      charter: { objective: t.objective, inScope: t.scope, outScope: '', deliverables: '', acceptance: 'Work complete, inspected and accepted by the customer; site clean; invoice issued.', assumptions: '', budget: budget, customer: job.name || '', manager: '' },
      risks: t.risks.map(function (r, i) { return { id: 'r' + (i + 1), title: r[0], cause: '', p: r[1], i: r[2], response: r[3], action: r[4], owner: '', review: '', status: 'Open', raised: today() }; }),
      issues: [], baseline: null };
  }

  /* ---------- status (board columns) and resources (people) ---------- */
  var STATUS = [['todo', 'To do', 0], ['doing', 'In progress', 33], ['review', 'In review / QA', 67], ['done', 'Done', 100]];
  var stPct = { todo: 0, doing: 33, review: 67, done: 100 }, stName = { todo: 'To do', doing: 'In progress', review: 'In review / QA', done: 'Done' };
  function statusFromPct(n) { return n >= 100 ? 'done' : n <= 0 ? 'todo' : n >= 67 ? 'review' : 'doing'; }
  function setStatus(t, k) { (t.subs || []).forEach(function (x) { x.status = k; }); t.status = k; t.pct = stPct[k]; }
  /* sub-tasks: inside the task's dates, no costs of their own; the task's % comes from them (weighted by days) */
  function fitSubs(t) {
    var moved = false;
    if (!t.subs) t.subs = [];
    if (t.dur === 0 && t.subs.length) { t.subs = []; return true; }
    var D = Math.max(1, t.dur);
    t.subs.forEach(function (x) {
      var off = Math.max(0, Math.min(D - 1, Math.round(+x.off || 0))), dur = Math.max(1, Math.min(D - off, Math.round(+x.dur || 1)));
      if (off !== x.off || dur !== x.dur) moved = true;
      x.off = off; x.dur = dur; if (!stPct.hasOwnProperty(x.status)) x.status = 'todo';
    });
    return moved;
  }
  function derive(t) {
    if (!t.subs || !t.subs.length) return;
    var w = t.subs.reduce(function (a, x) { return a + x.dur; }, 0) || 1;
    t.pct = Math.round(t.subs.reduce(function (a, x) { return a + x.dur * stPct[x.status]; }, 0) / w); t.status = statusFromPct(t.pct);
  }
  function subDates(t, x) { if (!t.es) return { es: '', ef: '' }; var es = x.off ? addWork(t.es, x.off) : t.es; return { es: es, ef: x.dur > 1 ? addWork(es, x.dur - 1) : es }; }
  function resText(t) { var r = t.res || []; if (!r.length) return ''; var others = r.filter(function (x) { return x !== t.lead; }); return [t.lead].concat(others).filter(Boolean).join(', '); }
  function resShort(t) { var r = t.res || []; return r.length ? '★ ' + (t.lead || r[0]) + (r.length > 1 ? ' +' + (r.length - 1) : '') : ''; }
  function fixRes(t) { t.res = (t.res || []).filter(Boolean); if (t.res.indexOf(t.lead) < 0) t.lead = t.res[0] || ''; t.resource = resText(t); }
  function normalise(p) {   // older plans: phases and a single "resource" text
    if (p.phases && p.phases.length > 1) {
      var order = p.phases.map(function (f) { return f.id; });
      p.tasks = p.tasks.map(function (t, i) { return { t: t, i: i }; }).sort(function (a, b) { return (order.indexOf(a.t.phase) - order.indexOf(b.t.phase)) || (a.i - b.i); }).map(function (x) { return x.t; });
    }
    p.phases = [{ id: 'ph1', name: 'Work' }];
    p.tasks.forEach(function (t) {
      t.phase = 'ph1';
      if (!Array.isArray(t.res)) t.res = t.resource ? String(t.resource).split(/\s*,\s*/).filter(Boolean) : [];
      fixRes(t);
      if (!stPct.hasOwnProperty(t.status) || (t.status === 'done') !== (t.pct >= 100)) t.status = statusFromPct(t.pct || 0);
      fitSubs(t); derive(t);
    });
    return p;
  }

  /* ---------- state + saving ---------- */
  var S = { closed: {}, cols: (function () { try { return localStorage.getItem('mbsPlanCols') || 's'; } catch (e) { return 's'; } })(), core: '', plan: null, rev: 0, job: null, tab: 'schedule', zoom: 'day', saving: false, timer: null, reminders: [], expensesEx: 0 };
  function dirty(note) {
    $('#planSave').textContent = 'Saving…';
    clearTimeout(S.timer);
    S.timer = setTimeout(function () { saveNow(note); }, 700);
  }
  function saveNow(note) {   // saves run one after another so each one carries the latest revision
    clearTimeout(S.timer); S.timer = null;
    var core = S.core, plan = S.plan;
    var run = function () {
      if (S.core !== core || S.plan !== plan) return;
      S.busy = true;
      return api('planSave', { core: core, plan: plan, rev: S.rev, note: note || '' }).then(function (r) {
        S.busy = false;
        if (S.core !== core) return;
        S.rev = r.plan.rev; plan.rev = r.plan.rev;
        if (plan.tasks.some(function (t) { return t.item; })) loadInv().then(function () { if (S.plan === plan && (S.tab === 'schedule' || S.tab === 'overview') && !S.timer && !document.activeElement.closest('#planBody')) render(); });
        if (r.low && r.low.length && M.inv) M.inv.prompt(r.low);
        var el = $('#planSave'); if (el && !S.timer) el.textContent = 'Saved ✓';
      }).catch(function (e) {
        S.busy = false;
        if (/changed this plan/.test(e.message)) { return api('planGet', { core: core }).then(function (d) { S.plan = normalise(d.plan); S.rev = d.plan.rev; toast(e.message, true); render(); }); }
        var el = $('#planSave'); if (el) el.textContent = 'Not saved'; fail(e);
      });
    };
    S.q = (S.q || Promise.resolve()).then(run, run);
    return S.q;
  }

  /* ---------- views ---------- */
  function projects() {
    return api('planList', { today: today() }).then(function (d) {
      return api('jobs', { stage: 'open' }).then(function (j) {
        var planned = {}; d.plans.forEach(function (p) { planned[p.core] = 1; });
        var avail = j.jobs.filter(function (x) { return !planned[x.core]; });
        V().innerHTML = '<div class="card"><div class="card-h"><h2>Project plans (' + d.plans.length + ')</h2>' +
          '<div class="row"><select id="newPlanJob" style="width:auto"><option value="">Plan a job…</option>' + avail.map(function (x) { return '<option value="' + esc(x.core) + '">' + esc(x.ref + ' · ' + x.name + (x.service ? ' · ' + x.service : '')) + '</option>'; }).join('') + '</select><button class="btn btn-gold btn-sm" id="newPlanGo">＋ Start a plan</button></div></div>' +
          (d.plans.length ? '<div class="table-wrap"><table><thead><tr><th>Project</th><th>Progress</th><th class="hide-sm">Finish</th><th>Time</th><th>Cost</th><th class="hide-sm">Risks</th><th class="hide-sm">Issues</th><th></th></tr></thead><tbody>' +
            d.plans.map(function (p) {
              var tC = rag(p.SPI, 0.95, 0.85), cC = rag(p.CPI, 0.95, 0.85);
              return '<tr class="click" data-plan="' + esc(p.core) + '"><td><b>' + esc(p.name) + '</b><br><small class="muted"><span class="ref">' + esc(p.ref) + '</span> · ' + esc(p.customer) + '</small></td>' +
                '<td style="min-width:140px"><div class="pbar"><span style="width:' + p.pct + '%"></span></div><small>' + p.pct + '% · ' + p.done + '/' + p.total + ' tasks' + (p.late ? ' · <b style="color:#C2410C">' + p.late + ' late</b>' : '') + '</small></td>' +
                '<td class="hide-sm">' + esc(prettyY(p.finish)) + '</td><td><span class="rag rag-' + tC + '">' + (p.SPI == null ? '—' : 'SPI ' + p.SPI) + '</span></td><td><span class="rag rag-' + cC + '">' + (p.CPI == null ? '—' : 'CPI ' + p.CPI) + '</span></td>' +
                '<td class="hide-sm">' + p.openRisks + (p.highRisks ? ' <b style="color:#C2410C">(' + p.highRisks + ' high)</b>' : '') + '</td><td class="hide-sm">' + p.openIssues + '</td><td><button class="btn btn-sm" data-pdel="' + esc(p.core) + '" data-pname="' + esc(p.name) + '" title="Delete this plan">🗑</button></td></tr>';
            }).join('') + '</tbody></table></div>' : '<div class="empty">No plans yet. Pick a job above, or open a job and press “Project plan”.</div>') + '</div>';
        V().querySelectorAll('[data-plan]').forEach(function (tr) { tr.onclick = function () { location.hash = '#plan/' + tr.getAttribute('data-plan'); }; });
        V().querySelectorAll('[data-pdel]').forEach(function (b) {
          b.onclick = function (e) {
            e.stopPropagation();
            M.confirmBox('Delete this project plan?', 'The plan “' + esc(b.getAttribute('data-pname')) + '” will be deleted: tasks, dates, costs, risks and issues. The job itself, its quotes and invoices stay. This can\'t be undone.', 'Delete plan', true).then(function (ok) {
              if (!ok) return;
              api('planDelete', { core: b.getAttribute('data-pdel') }).then(function () { toast('Plan deleted'); projects(); }).catch(fail);
            });
          };
        });
        $('#newPlanGo').onclick = function () { var c = $('#newPlanJob').value; if (!c) return toast('Pick a job first', true); location.hash = '#plan/' + c; };
      });
    });
  }

  function planView(args) {
    var core = args[0], tab = args[1] || S.tab;
    if (S.plan && S.job && (core === S.core || core === S.job.ref) && args[1]) { S.tab = tab; render(); return; }   // just a tab change
    var pending = S.timer ? saveNow() : (S.q || Promise.resolve());
    return pending.then(function () { return api('planGet', { core: core }); }).then(function (d) {
      S.plan = null;
      S.core = d.job.core; S.job = d.job; S.reminders = d.reminders; S.expensesEx = d.expensesEx; S.tab = tab;
      if (!d.plan) return chooser();
      S.plan = normalise(d.plan); S.rev = d.plan.rev;
      return loadInv().then(render);
    });
  }
  function chooser() {
    $('#title').textContent = 'Project plan';
    var j = S.job;
    V().innerHTML = '<div class="row" style="margin-bottom:14px"><a class="btn btn-sm" href="#job/' + esc(j.core) + '">← ' + esc(j.ref) + '</a><h2 style="font-size:22px">Plan this job: ' + esc(j.name) + '</h2></div>' +
      '<div class="card"><h2>1. Pick a starting template</h2><p class="muted" style="margin:-4px 0 12px">Each one has the usual tasks and milestones, example unit costs and common risks. People (resources) are left blank for you to fill in. Change anything afterwards.</p>' +
      '<div class="tpl-grid">' + Object.keys(TEMPLATES).map(function (k) { var t = TEMPLATES[k]; return '<button class="tpl" data-tk="' + k + '"><b>' + esc(k === 'blank' ? 'Blank plan' : t.name) + '</b><small>' + (k === 'blank' ? 'Two tasks to start from' : t.rows.length + ' tasks · ' + t.risks.length + ' risks · ' + money(t.rows.reduce(function (a, r) { return a + r[5] * r[7]; }, 0)) + ' budget') + '</small></button>'; }).join('') + '</div>' +
      '<h2 style="margin-top:18px">2. Start date</h2><input type="date" id="tplStart" value="' + today() + '" style="width:auto"></div>';
    V().querySelectorAll('[data-tk]').forEach(function (b) {
      b.onclick = function () {
        S.plan = fromTemplate(b.getAttribute('data-tk'), j, $('#tplStart').value || today()); S.rev = 0; S.tab = 'schedule';
        api('planSave', { core: S.core, plan: S.plan, rev: 0, note: 'plan created (' + b.getAttribute('data-tk') + ')' }).then(function (r) { S.plan = normalise(r.plan); S.rev = r.plan.rev; toast('Plan created'); history.replaceState(null, '', '#plan/' + S.core + '/schedule'); render(); }).catch(fail);
      };
    });
  }

  function render() {
    var p = S.plan, R = rollup(p, today());
    $('#title').textContent = 'Project plan';
    var tabs = [['overview', '◎ Overview'], ['schedule', '▤ Schedule & Gantt'], ['board', '▦ Board'], ['scope', '🎯 Scope'], ['risks', '⚠ Risks'], ['issues', '❗ Issues']];
    V().innerHTML = '<div class="row" style="margin-bottom:12px"><a class="btn btn-sm" href="#job/' + esc(S.core) + '">← ' + esc(S.job.ref) + '</a>' +
      '<h2 style="font-size:21px">' + esc(p.name) + '</h2><span class="muted">' + esc(S.job.name) + '</span><span class="sp"></span>' +
      '<span class="muted" id="planSave" style="font-size:13px">' + (S.timer || S.busy ? 'Saving…' : 'Saved ✓') + '</span><button class="btn btn-sm" id="planBase" title="Freeze today\'s dates and costs to compare against">📌 ' + (p.baseline ? 'Re-set baseline' : 'Set baseline') + '</button><button class="btn btn-sm" onclick="window.print()">🖨 Print</button><button class="btn btn-sm btn-danger" id="planDel" title="Delete this plan">🗑 Delete plan</button></div>' +
      '<div class="grid pkpis">' +
        mini('Scope', R.pct + '% complete', R.done + ' of ' + R.total + ' tasks done', rag(R.total ? R.pct / Math.max(1, timePct(R)) : null, 0.95, 0.8)) +
        mini('Time', 'Finish ' + prettyY(R.finish), (R.SPI == null ? 'not started' : 'SPI ' + R.SPI) + (R.late.length ? ' · ' + R.late.length + ' late' : '') + (p.baseline && p.baseline.finish && R.finish ? ' · ' + varDays(p.baseline.finish, R.finish) : ''), R.late.length ? 'red' : rag(R.SPI, 0.95, 0.85)) +
        mini('Cost', money(R.AC) + ' of ' + money(R.BAC), (R.CPI == null ? 'no actual costs yet' : 'CPI ' + R.CPI + ' · forecast ' + money(R.EAC)), rag(R.CPI, 0.95, 0.85)) +
        mini('Risks & issues', pl((p.risks || []).filter(function (r) { return r.status !== 'Closed'; }).length, 'risk') + ' · ' + pl((p.issues || []).filter(function (x) { return x.status !== 'Resolved'; }).length, 'issue'), pl((p.risks || []).filter(function (r) { return r.status !== 'Closed' && r.p * r.i >= 12; }).length, 'high risk'), (p.risks || []).some(function (r) { return r.status !== 'Closed' && r.p * r.i >= 15; }) ? 'red' : (p.issues || []).some(function (x) { return x.status !== 'Resolved' && /High|Critical/.test(x.priority); }) ? 'amber' : 'green') +
      '</div>' +
      '<div class="tabs" id="planTabs">' + tabs.map(function (t) { return '<a class="tab' + (S.tab === t[0] ? ' on' : '') + '" href="#plan/' + esc(S.core) + '/' + t[0] + '" style="text-decoration:none">' + t[1] + '</a>'; }).join('') + '</div><div id="planBody"></div>';
    $('#planDel').onclick = function () {
      M.confirmBox('Delete this project plan?', 'The plan “' + esc(p.name) + '” for ' + esc(S.job.ref) + ' will be deleted: tasks, dates, costs, risks and issues. The job itself, its quotes and invoices stay. This can\'t be undone.', 'Delete plan', true).then(function (ok) {
        if (!ok) return;
        clearTimeout(S.timer); S.timer = null;
        var core = S.core;
        (S.q || Promise.resolve()).then(function () { return api('planDelete', { core: core }); }).then(function () {
          S.plan = null; S.core = ''; toast('Plan deleted'); location.hash = '#projects';
        }).catch(fail);
      });
    };
    $('#planBase').onclick = function () {
      M.confirmBox(p.baseline ? 'Re-set the baseline?' : 'Set the baseline?', 'Saves today\'s planned dates and costs so you can see later how far the job moved (PMI baseline). ' + (p.baseline ? 'The old baseline from ' + M.day(p.baseline.at) + ' is replaced.' : ''), 'Set baseline').then(function (ok) {
        if (!ok) return; schedule(p); var tasks = {}; p.tasks.forEach(function (t) { tasks[t.id] = { es: t.es, ef: t.ef, cost: cost(t) }; });
        p.baseline = { at: Date.now(), finish: R.finish, BAC: R.BAC, tasks: tasks }; saveNow('baseline set'); toast('Baseline set'); render();
      });
    };
    ({ overview: overview, schedule: scheduleTab, board: board, scope: scope, risks: risks, issues: issues }[S.tab] || scheduleTab)(R);
  }
  function timePct(R) { var t = today(); if (!R.start || t < R.start) return 0; if (t >= R.finish) return 100; return Math.round(workBetween(R.start, t) / Math.max(1, workBetween(R.start, R.finish)) * 100); }
  function varDays(base, now) { var d = workBetween(base, now) - 1; if (now <= base) { d = -(workBetween(now, base) - 1); } return d === 0 ? 'on baseline' : d > 0 ? d + ' days behind baseline' : (-d) + ' days ahead of baseline'; }
  function mini(k, v, s, c) { return '<div class="card kpi rag-card rag-b-' + (c || 'grey') + '"><div class="k">' + esc(k) + ' <span class="dot dot-' + (c || 'grey') + '"></span></div><div class="v" style="font-size:20px">' + esc(v) + '</div><div class="s">' + esc(s) + '</div></div>'; }
  function ordered() {   // tasks in order, with their row numbers (like Microsoft Project's ID column)
    return S.plan.tasks.map(function (t, i) { return { t: t, n: i + 1 }; });
  }
  // stock items (Inventory) used by tasks
  function invItem(id) { return id && S.inv ? S.inv[id] : null; }
  function stockChip(t) {
    if (!t.item) return '';
    var i = invItem(t.item);
    if (!i) return '<span class="pkchip">📦 stock item ' + esc(t.item) + '</span>';
    var short = t.status !== 'done' && i.available < 0;
    return '<span class="pkchip' + (short ? ' short' : '') + '" title="' + esc(i.name + ': ' + i.available + ' ' + i.unit + ' available after what jobs have set aside') + '">📦 ' + esc(i.name) + ' · ' + (t.status === 'done' ? 'used' : short ? 'short ' + (-i.available) + ' ' + esc(i.unit) : i.available + ' ' + esc(i.unit) + ' left') + '</span>';
  }
  function loadInv() { return M.inv ? M.inv.load().then(function (d) { S.inv = {}; d.items.forEach(function (i) { S.inv[i.id] = i; }); }).catch(function () {}) : Promise.resolve(); }
  function resCell(t) {
    var r = t.res || [];
    return '<div class="rbox">' + r.map(function (name) {
      var lead = name === t.lead;
      return '<span class="rchip' + (lead ? ' lead' : '') + '"><button type="button" class="rname" data-rlead="' + esc(name) + '" title="' + (lead ? 'Lead for this task' : 'Make ' + esc(name) + ' the lead') + '">' + (lead ? '★ ' : '') + esc(name) + '</button><button type="button" class="rx" data-rx="' + esc(name) + '" title="Remove">×</button></span>';
    }).join('') + '<input class="radd" data-radd list="resList" placeholder="' + (r.length ? '+ add' : 'Type a name') + '" aria-label="Add a person or trade"></div>';
  }

  /* ---------- schedule grid + Gantt ---------- */
  function scheduleTab(R) {
    var p = S.plan, rows = ordered(), num = {}, idOf = {};
    rows.forEach(function (r) { num[r.t.id] = r.n; idOf[r.n] = r.t.id; });
    var t0 = today();
    var from = R.start ? toS(new Date(toD(R.start).getTime() - 2 * 864e5)) : t0, to = R.finish ? toS(new Date(toD(R.finish).getTime() + 6 * 864e5)) : t0;
    if (t0 < from) from = t0; if (t0 > to) to = toS(new Date(toD(t0).getTime() + 3 * 864e5));
    var dayW = S.zoom === 'week' ? 7 : 20, days = daysBetween(from, to) + 1, W = days * dayW;
    var x = function (s) { return daysBetween(from, s) * dayW; };
    var firstW = toD(from).getUTCDay(), satOff = ((6 - firstW + 7) % 7) * dayW;
    var weekendBg = 'background-image:repeating-linear-gradient(90deg,transparent 0,transparent ' + satOff + 'px,rgba(0,0,0,.045) ' + satOff + 'px,rgba(0,0,0,.045) ' + (satOff + 2 * dayW) + 'px,transparent ' + (satOff + 2 * dayW) + 'px,transparent ' + 7 * dayW + 'px);background-size:' + 7 * dayW + 'px 100%';
    var scale = '<div class="gscale" style="width:' + W + 'px">';
    for (var i = 0; i < days; i++) {
      var d = toS(new Date(toD(from).getTime() + i * 864e5)), dd = +d.slice(8), wd = toD(d).getUTCDay();
      if (dd === 1 || i === 0) scale += '<span class="gm" style="left:' + i * dayW + 'px">' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+d.slice(5, 7) - 1] + ' ' + d.slice(2, 4) + '</span>';
      if (S.zoom === 'day') scale += '<span class="gd' + (wd === 0 || wd === 6 ? ' we' : '') + (d === t0 ? ' td' : '') + '" style="left:' + i * dayW + 'px;width:' + dayW + 'px">' + dd + '</span>';
      else if (wd === 1) scale += '<span class="gd" style="left:' + i * dayW + 'px;width:' + 7 * dayW + 'px">' + dd + '</span>';
    }
    scale += '</div>';
    var todayLine = '<i class="gtoday" style="left:' + (x(t0) + dayW / 2) + 'px"></i>';
    var bar = function (t, base) {
      if (!t.es) return '';
      var late = t.pct < 100 && t.ef < t0, left = x(t.es), w = (daysBetween(t.es, t.ef) + 1) * dayW;
      var b = base && base.es ? '<span class="gbase" style="left:' + x(base.es) + 'px;width:' + ((daysBetween(base.es, base.ef) + 1) * dayW) + 'px" title="Baseline"></span>' : '';
      var lab = '<span class="glab" style="left:' + ((t.dur === 0 ? left + dayW : left + w) + 4) + 'px">' + (t.dur === 0 ? esc(pretty(t.es)) + ' ' : '') + '<b class="gpct">' + t.pct + '%</b> ' + esc(resShort(t)) + '</span>';
      if (t.dur === 0) return b + '<span class="gmile' + (t.pct >= 100 ? ' done' : '') + '" style="left:' + (left + dayW / 2 - 7) + 'px" title="' + esc(t.name + ' · ' + pretty(t.es) + ' · ' + stName[t.status]) + '"></span>' + lab;
      return b + '<span class="gbar st-' + t.status + (late ? ' late' : '') + '" style="left:' + left + 'px;width:' + w + 'px" title="' + esc(t.name + ' · ' + pretty(t.es) + ' – ' + pretty(t.ef) + ' · ' + stName[t.status] + ' ' + t.pct + '%') + '"><span class="gfill" style="width:' + t.pct + '%"></span></span>' + lab;
    };
    var html = '<div class="card" style="padding:12px"><div class="row" style="margin-bottom:10px"><button class="btn btn-sm btn-gold" id="addTask">＋ Task</button><button class="btn btn-sm" id="addMile">◆ Milestone</button>' +
      '<span class="muted" style="font-size:12.5px">Days are working days (Mon–Fri). “After #” = starts when those rows finish. Moving a card on the Board updates the % here.</span><span class="sp"></span>' +
      '<label style="display:flex;gap:6px;align-items:center;font-weight:700">Project start<input type="date" id="pStart" value="' + esc(p.start) + '" style="width:auto"></label>' +
      '<div class="tabs" style="margin:0" title="Which columns to show"><button class="tab' + (S.cols === 's' ? ' on' : '') + '" data-cols="s">📅 Dates</button><button class="tab' + (S.cols === 'c' ? ' on' : '') + '" data-cols="c">$ Costs</button><button class="tab' + (S.cols === 'a' ? ' on' : '') + '" data-cols="a">All columns</button></div>' +
      '<div class="tabs" style="margin:0"><button class="tab' + (S.zoom === 'day' ? ' on' : '') + '" data-zoom="day">Days</button><button class="tab' + (S.zoom === 'week' ? ' on' : '') + '" data-zoom="week">Weeks</button></div></div>' +
      '<div class="gwrap"><table class="gt v-' + S.cols + '"><thead><tr><th>#</th><th title="Done">✓</th><th style="min-width:160px">Task</th><th style="min-width:136px">Resources <span class="muted" style="text-transform:none;letter-spacing:0">(★ lead)</span></th><th>Days</th><th>Start</th><th>Finish</th><th>After #</th><th>Qty</th><th>Unit</th><th>Unit $</th><th>Cost</th><th>Actual $</th><th>Status</th><th>%</th><th></th><th class="gcol">' + scale + '</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var t = r.t, late = t.pct < 100 && t.ef < t0, base = p.baseline && p.baseline.tasks ? p.baseline.tasks[t.id] : null;
      var subs = t.subs || [], open = subs.length && !S.closed[t.id];
      html += '<tr data-tid="' + esc(t.id) + '" class="' + (t.pct >= 100 ? 'tdone' : '') + (late ? ' tlate' : '') + (t.dur === 0 ? ' tmile' : '') + (subs.length ? ' tparent' : '') + '"><td class="muted nowrap">' + (subs.length ? '<button class="subtog" type="button" data-tog title="' + (open ? 'Hide' : 'Show') + ' sub-tasks">' + (open ? '▾' : '▸') + '</button>' : '') + r.n + '</td>' +
        '<td><input type="checkbox" data-k="done"' + (t.pct >= 100 ? ' checked' : '') + ' title="Done" style="width:auto"></td>' +
        '<td><div class="tname"><input data-k="name" value="' + esc(t.name) + '" title="' + esc(t.name) + (t.dur === 0 ? ' (milestone)' : '') + (late ? ' · LATE: was due ' + pretty(t.ef) : '') + '"><button class="pkbtn" type="button" data-pick title="' + (t.item ? 'Change the stock item' : 'Use a stock item from Inventory') + '">📦</button></div>' + stockChip(t) +
          (t.dur === 0 ? '' : '<button class="subadd" type="button" data-addsub title="Break this task into smaller steps (they stay inside its dates)">＋ sub-task' + (subs.length ? ' · ' + subs.filter(function (x) { return x.status === 'done'; }).length + '/' + subs.length + ' done' : '') + '</button>') + '</td>' +
        '<td>' + resCell(t) + '</td>' +
        '<td><input data-k="dur" type="number" min="0" max="365" value="' + t.dur + '" style="width:50px" title="0 days = milestone"></td>' +
        '<td><input data-k="snet" type="date" value="' + esc(t.es) + '" class="' + (t.snet ? 'pinned' : '') + '" title="' + (t.snet ? 'Starts no earlier than ' + pretty(t.snet) + ' (clear the date box to remove)' : 'Worked out from the tasks before it. Pick a later date to hold it back.') + '"></td>' +
        '<td class="nowrap">' + esc(pretty(t.ef)) + (base && base.ef && base.ef !== t.ef ? '<br><small class="' + (t.ef > base.ef ? 'bad' : 'good') + '">base ' + esc(pretty(base.ef)) + '</small>' : '') + '</td>' +
        '<td><input data-k="pred" value="' + esc((t.pred || []).map(function (id) { return num[id]; }).filter(Boolean).join(', ')) + '" placeholder="e.g. 2,3" style="width:58px"></td>' +
        '<td><input data-k="qty" inputmode="decimal" value="' + esc(t.qty || '') + '" style="width:60px"></td>' +
        '<td><input data-k="unit" value="' + esc(t.unit || '') + '" placeholder="h, m², lot" style="width:56px"></td>' +
        '<td><input data-k="rate" inputmode="decimal" value="' + esc(t.rate || '') + '" style="width:74px"></td>' +
        '<td class="num">' + money(cost(t)) + '</td>' +
        '<td><input data-k="actual" inputmode="decimal" value="' + esc(t.actual || '') + '" style="width:80px"></td>' +
        '<td><select data-k="status" class="stsel st-' + t.status + '"' + (subs.length ? ' title="Setting this moves all its sub-tasks too"' : '') + '>' + STATUS.map(function (x) { return '<option value="' + x[0] + '"' + (t.status === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select></td>' +
        '<td><input data-k="pct" type="number" min="0" max="100" step="1" value="' + t.pct + '" style="width:54px"' + (subs.length ? ' disabled title="Worked out from the sub-tasks"' : '') + '></td>' +
        '<td class="acts"><button class="btn btn-sm" data-rem title="Reminder">🔔</button><button class="btn btn-sm" data-move="-1" title="Move up">↑</button><button class="btn btn-sm" data-move="1" title="Move down">↓</button><button class="btn btn-sm" data-del title="Delete">✕</button></td>' +
        '<td class="gcol"><div class="gtrack" style="width:' + W + 'px;' + weekendBg + '">' + todayLine + bar(t, base) + '</div></td></tr>';
      if (open) subs.forEach(function (sb, j) {
        var d = subDates(t, sb), sl = sb.status !== 'done' && d.ef && d.ef < t0, maxDur = Math.max(1, t.dur) - sb.off;
        var left = d.es ? x(d.es) : 0, sw = d.es ? (daysBetween(d.es, d.ef) + 1) * dayW : 0;
        html += '<tr class="tsub' + (sb.status === 'done' ? ' tdone' : '') + (sl ? ' tlate' : '') + '" data-sid="' + esc(sb.id) + '" data-ptid="' + esc(t.id) + '"><td class="muted nowrap subn">' + r.n + '.' + (j + 1) + '</td>' +
          '<td><input type="checkbox" data-sk="done"' + (sb.status === 'done' ? ' checked' : '') + ' style="width:auto" title="Done"></td>' +
          '<td><div class="subname"><span class="subarrow">↳</span><input data-sk="name" value="' + esc(sb.name) + '"></div></td>' +
          '<td><input data-sk="owner" list="resList" value="' + esc(sb.owner || '') + '" placeholder="Who" style="min-width:90px;width:110px"></td>' +
          '<td><input data-sk="dur" type="number" min="1" max="' + maxDur + '" value="' + sb.dur + '" style="width:50px" title="At most ' + maxDur + ' day' + (maxDur === 1 ? '' : 's') + ' (to stay inside the task)"></td>' +
          '<td><input data-sk="start" type="date" value="' + esc(d.es) + '" min="' + esc(t.es) + '" max="' + esc(t.ef) + '" title="Between ' + esc(pretty(t.es)) + ' and ' + esc(pretty(t.ef)) + ' (the task\'s dates)"></td>' +
          '<td class="nowrap">' + esc(pretty(d.ef)) + '</td><td class="muted" style="font-size:11.5px">in #' + r.n + '</td><td></td><td></td><td></td>' +
          '<td class="muted subcost" title="Costs stay on the task">–</td><td></td>' +
          '<td><select data-sk="status" class="stsel st-' + sb.status + '">' + STATUS.map(function (o) { return '<option value="' + o[0] + '"' + (sb.status === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></td>' +
          '<td class="muted">' + stPct[sb.status] + '</td>' +
          '<td class="acts"><button class="btn btn-sm" data-smove="-1" title="Move up">↑</button><button class="btn btn-sm" data-smove="1" title="Move down">↓</button><button class="btn btn-sm" data-sdel title="Delete sub-task">✕</button></td>' +
          '<td class="gcol"><div class="gtrack gtrack-sub" style="width:' + W + 'px;' + weekendBg + '">' + todayLine + (d.es ? '<span class="gsub st-' + sb.status + (sl ? ' late' : '') + '" style="left:' + left + 'px;width:' + sw + 'px" title="' + esc(sb.name + ' · ' + pretty(d.es) + ' – ' + pretty(d.ef) + ' · ' + stName[sb.status]) + '"><span class="gfill" style="width:' + stPct[sb.status] + '%"></span></span><span class="glab" style="left:' + (left + sw + 4) + 'px">' + esc(sb.owner || '') + '</span>' : '') + '</div></td></tr>';
      });
    });
    if (!rows.length) html += '<tr><td colspan="17"><div class="empty">No tasks yet. Press “＋ Task”.</div></td></tr>';
    html += '</tbody><tfoot><tr><td></td><td></td><td><b>Total (budget at completion)</b></td><td></td><td></td><td>' + esc(pretty(R.start)) + '</td><td>' + esc(pretty(R.finish)) + '</td><td></td><td></td><td></td><td></td><td class="num"><b>' + money(R.BAC) + '</b></td><td class="num"><b>' + money(R.AC) + '</b></td><td></td><td><b>' + R.pct + '%</b></td><td></td><td class="gcol"></td></tr></tfoot></table></div>' +
      '<div class="res-tip" id="resTip" hidden><b>Tip:</b> you can add more than one person or trade. Press <kbd>Enter</kbd> or type a comma after each name. <b>★</b> = the lead: the first one added is the lead; click another name to make them the lead.</div>' +
      '<datalist id="resList">' + Array.from(new Set([].concat.apply([], p.tasks.map(function (t) { return t.res || []; })).concat(['Labourer', 'Tiler', 'Plumber', 'Electrician', 'Painter', 'Carpenter', 'Waterproofer', 'Supplier', 'Customer']))).filter(Boolean).map(function (r) { return '<option value="' + esc(r) + '">'; }).join('') + '</datalist></div>';
    $('#planBody').innerHTML = html;
    var B = $('#planBody');
    B.querySelectorAll('[data-cols]').forEach(function (b) { b.onclick = function () { S.cols = b.getAttribute('data-cols'); try { localStorage.setItem('mbsPlanCols', S.cols); } catch (e) {} render(); }; });
    B.querySelectorAll('[data-zoom]').forEach(function (b) { b.onclick = function () { S.zoom = b.getAttribute('data-zoom'); render(); }; });
    $('#pStart').onchange = function () { if (this.value) { p.start = this.value; dirty(); render(); } };
    var task = function (el) { var id = el.closest('tr').getAttribute('data-tid'); return p.tasks.filter(function (t) { return t.id === id; })[0]; };
    B.querySelectorAll('tr[data-tid] [data-k]').forEach(function (el) {
      var k = el.getAttribute('data-k');
      var live = ['name', 'unit'].indexOf(k) >= 0;
      el.addEventListener(live ? 'input' : 'change', function () {
        var t = task(el);
        if (k === 'done') { setStatus(t, el.checked ? 'done' : 'todo'); }
        else if (k === 'status') { setStatus(t, el.value); }
        else if (k === 'pct') { t.pct = Math.max(0, Math.min(100, Math.round(+el.value || 0))); t.status = statusFromPct(t.pct); }
        else if (k === 'dur') { t.dur = Math.max(0, Math.min(365, Math.round(+el.value || 0))); if (fitSubs(t)) toast(t.dur === 0 ? 'A milestone has no sub-tasks, so they were removed' : 'Sub-tasks were shortened to fit inside the task\'s ' + t.dur + ' day' + (t.dur === 1 ? '' : 's')); derive(t); }
        else if (k === 'snet') { t.snet = el.value || ''; }
        else if (k === 'pred') { t.pred = el.value.split(/[,\s]+/).map(function (s) { return idOf[+s]; }).filter(function (id) { return id && id !== t.id; }); }
        else if (['qty', 'rate', 'actual'].indexOf(k) >= 0) { t[k] = r2(String(el.value).replace(/[$,]/g, '')); }
        else t[k] = el.value;
        dirty(k === 'done' || k === 'status' ? stName[t.status] + ': ' + t.name : '');
        if (!live) render();
      });
    });
    // resources: several people per task, one lead
    var tip = $('#resTip');
    var addNames = function (t, text) {
      var added = false;
      String(text).split(',').map(function (x) { return x.trim().slice(0, 60); }).filter(Boolean).forEach(function (name) {
        if (t.res.map(function (x) { return x.toLowerCase(); }).indexOf(name.toLowerCase()) < 0 && t.res.length < 12) { t.res.push(name); added = true; }
      });
      if (added) { fixRes(t); dirty(); }
      return added;
    };
    B.querySelectorAll('[data-radd]').forEach(function (inp) {
      var refocus = function () { var id = task(inp).id; render(); var n = $('#planBody tr[data-tid="' + id + '"] [data-radd]'); if (n) n.focus(); };
      inp.addEventListener('focus', function () {
        var rc = inp.getBoundingClientRect(); tip.hidden = false;
        tip.style.top = (rc.bottom + 6) + 'px'; tip.style.left = Math.max(8, Math.min(rc.left, innerWidth - 340)) + 'px';
      });
      inp.addEventListener('blur', function () { tip.hidden = true; if (inp.value.trim() && addNames(task(inp), inp.value)) { inp.value = ''; render(); } });
      inp.addEventListener('keydown', function (e) {
        if ((e.key === 'Enter' || e.key === ',') && inp.value.trim()) { e.preventDefault(); if (addNames(task(inp), inp.value)) { inp.value = ''; refocus(); } else inp.value = ''; }
        else if (e.key === 'Backspace' && !inp.value) { var t = task(inp); if (t.res.length) { t.res.pop(); fixRes(t); dirty(); refocus(); } }
      });
      inp.addEventListener('input', function () { if (inp.value.indexOf(',') >= 0 && addNames(task(inp), inp.value)) { inp.value = ''; refocus(); } });
    });
    B.querySelectorAll('[data-rlead]').forEach(function (b) { b.onclick = function () { var t = task(b); t.lead = b.getAttribute('data-rlead'); fixRes(t); dirty(); render(); }; });
    B.querySelectorAll('[data-rx]').forEach(function (b) { b.onclick = function () { var t = task(b), n = b.getAttribute('data-rx'); t.res = t.res.filter(function (x) { return x !== n; }); fixRes(t); dirty(); render(); }; });
    B.querySelectorAll('[data-del]').forEach(function (b) { b.onclick = function () { var t = task(b); M.confirmBox('Delete “' + t.name + '”?', 'Tasks that come after it will no longer wait for it.', 'Delete', true).then(function (ok) { if (!ok) return; p.tasks = p.tasks.filter(function (x) { return x !== t; }); p.tasks.forEach(function (x) { x.pred = (x.pred || []).filter(function (id) { return id !== t.id; }); }); dirty(); render(); }); }; });
    B.querySelectorAll('[data-move]').forEach(function (b) {
      b.onclick = function () {
        var t = task(b), a = p.tasks.indexOf(t), c = a + (+b.getAttribute('data-move'));
        if (c < 0 || c >= p.tasks.length) return;
        p.tasks[a] = p.tasks[c]; p.tasks[c] = t; dirty(); render();
      };
    });
    B.querySelectorAll('[data-rem]').forEach(function (b) { b.onclick = function () { reminderBox(task(b)); }; });
    // sub-tasks
    B.querySelectorAll('[data-tog]').forEach(function (b) { b.onclick = function () { var t = task(b); S.closed[t.id] = !S.closed[t.id]; render(); }; });
    B.querySelectorAll('[data-addsub]').forEach(function (b) {
      b.onclick = function () {
        var t = task(b), D = Math.max(1, t.dur); t.subs = t.subs || [];
        var last = t.subs[t.subs.length - 1], off = last ? Math.min(D - 1, last.off + last.dur) : 0;
        if (last && last.off + last.dur >= D) off = last.off;   // the task is full: start alongside the last one
        var sb = { id: 's' + Date.now().toString(36), name: 'New sub-task', owner: '', off: off, dur: 1, status: 'todo' };
        t.subs.push(sb); fitSubs(t); derive(t); S.closed[t.id] = false; dirty('sub-task added to ' + t.name); render();
        setTimeout(function () { var i = $('#planBody tr[data-sid="' + sb.id + '"] [data-sk=name]'); if (i) { i.focus(); i.select(); } }, 30);
      };
    });
    var subOf = function (el) { var tr = el.closest('tr'), t = p.tasks.filter(function (x) { return x.id === tr.getAttribute('data-ptid'); })[0]; return { t: t, sb: t && (t.subs || []).filter(function (x) { return x.id === tr.getAttribute('data-sid'); })[0] }; };
    B.querySelectorAll('tr[data-sid] [data-sk]').forEach(function (el) {
      var k = el.getAttribute('data-sk'), live = k === 'name' || k === 'owner';
      el.addEventListener(live ? 'input' : 'change', function () {
        var o = subOf(el), t = o.t, sb = o.sb; if (!sb) return;
        if (k === 'name' || k === 'owner') { sb[k] = el.value; dirty(); return; }
        if (k === 'done') sb.status = el.checked ? 'done' : 'todo';
        else if (k === 'status') sb.status = el.value;
        else if (k === 'dur') { var want = Math.max(1, Math.round(+el.value || 1)); sb.dur = want; fitSubs(t); if (sb.dur < want) toast('Kept inside the task: at most ' + sb.dur + ' day' + (sb.dur === 1 ? '' : 's') + ' from its start'); }
        else if (k === 'start') {
          var v = el.value || t.es;
          if (v < t.es || v > t.ef) toast('Sub-tasks stay inside the task (' + pretty(t.es) + ' – ' + pretty(t.ef) + ')', true);
          v = v < t.es ? t.es : v > t.ef ? t.ef : v; v = nextWork(v); if (v > t.ef) v = t.ef;
          sb.off = Math.max(0, workBetween(t.es, v) - 1); fitSubs(t);
        }
        derive(t); dirty(k === 'done' || k === 'status' ? stName[sb.status] + ': ' + sb.name + ' (' + t.name + ')' : ''); render();
      });
    });
    B.querySelectorAll('[data-sdel]').forEach(function (b) { b.onclick = function () { var o = subOf(b); o.t.subs = o.t.subs.filter(function (x) { return x !== o.sb; }); derive(o.t); if (!o.t.subs.length) setStatus(o.t, o.t.status); dirty('sub-task deleted: ' + o.sb.name); render(); }; });
    B.querySelectorAll('[data-smove]').forEach(function (b) { b.onclick = function () { var o = subOf(b), a = o.t.subs.indexOf(o.sb), c = a + (+b.getAttribute('data-smove')); if (c < 0 || c >= o.t.subs.length) return; o.t.subs[a] = o.t.subs[c]; o.t.subs[c] = o.sb; dirty(); render(); }; });
    B.querySelectorAll('[data-pick]').forEach(function (b) {
      b.onclick = function () {
        var t = task(b);
        if (!M.inv) return toast('Inventory is not available', true);
        M.inv.pick(t.item, function (it) {
          if (!it) { t.item = ''; dirty('stock item removed: ' + t.name); render(); return; }
          t.item = it.id; t.unit = it.unit; if (it.price) t.rate = it.price; if (!t.qty) t.qty = 1;
          if (/^New (task|milestone)$/.test(t.name)) t.name = 'Supply ' + it.name;
          S.inv = S.inv || {}; S.inv[it.id] = it;
          dirty('stock item: ' + it.name + ' on ' + t.name); render(); toast('Linked to ' + it.name + ': unit and price filled in');
        });
      };
    });
    var add = function (mile) {
      var last = p.tasks[p.tasks.length - 1];
      var t = { id: 't' + Date.now().toString(36), phase: 'ph1', name: mile ? 'New milestone' : 'New task', dur: mile ? 0 : 1, res: [], lead: '', resource: '', qty: 0, unit: '', rate: 0, actual: 0, pct: 0, status: 'todo', pred: last ? [last.id] : [], snet: '', notes: '' };
      p.tasks.push(t); dirty(); render();
      setTimeout(function () { var i = $('#planBody tr[data-tid="' + t.id + '"] [data-k=name]'); if (i) { i.focus(); i.select(); } }, 30);
    };
    $('#addTask').onclick = function () { add(false); };
    $('#addMile').onclick = function () { add(true); };
  }
  function reminderBox(t) {
    M.modal('<h2>Reminder for “' + esc(t.name) + '”</h2><p class="muted">Sent to Telegram (everyone who gets the job alerts).</p><div class="actions" style="margin:12px 0">' +
      '<button class="btn" data-w="daybefore">Working day before start, 7am</button><button class="btn" data-w="start">Start day, 7am (' + esc(pretty(t.es)) + ')</button><button class="btn" data-w="due">Finish day, 7am (' + esc(pretty(t.ef)) + ')</button></div>' +
      '<div class="inline-form"><input id="remWhen" placeholder="or type: tomorrow 8am, fri 2pm, 12/11 9am"><button class="btn btn-sm btn-dark" id="remGo">Set</button></div>' +
      '<div class="actions" style="justify-content:flex-end;margin-top:12px"><button class="btn" data-close>Close</button></div>');
    var go = function (w) { saveNow().then(function () { return api('planRemind', { core: S.core, taskId: t.id, when: w }); }).then(function (r) { M.closeModal(); S.reminders.push(r.reminder); toast('Reminder set for ' + r.reminder.when); }).catch(fail); };
    document.querySelectorAll('#modal [data-w]').forEach(function (b) { b.onclick = function () { go(b.getAttribute('data-w')); }; });
    $('#remGo').onclick = function () { go($('#remWhen').value); };
  }

  /* ---------- board (Planner style): To do → In progress → In review / QA → Done ---------- */
  function board() {
    var p = S.plan, t0 = today();
    $('#planBody').innerHTML = '<p class="muted" style="margin:0 0 10px">Drag a card to the next column as the work moves on. The Gantt chart follows automatically: To do 0%, In progress 33%, In review / QA 67%, Done 100%.</p><div class="kanban">' + STATUS.map(function (c) {
      var list = ordered().filter(function (r) { return r.t.status === c[0]; });
      return '<div class="kcol kcol-' + c[0] + '" data-col="' + c[0] + '"><h3>' + c[1] + ' <span class="muted">' + list.length + ' · ' + c[2] + '%</span></h3>' + list.map(function (r) {
        var t = r.t, late = t.pct < 100 && t.ef < t0;
        return '<div class="kcard' + (late ? ' late' : '') + '" draggable="true" data-tid="' + esc(t.id) + '"><label class="row" style="gap:8px;font-weight:700;flex-wrap:nowrap"><input type="checkbox" data-tick' + (t.pct >= 100 ? ' checked' : '') + ' style="width:auto" title="Done">' + (t.dur === 0 ? '◆ ' : '') + esc(t.name) + '</label>' +
          ((t.res || []).length ? '<div class="kres">' + t.res.map(function (n) { return '<span class="rchip' + (n === t.lead ? ' lead' : '') + '">' + (n === t.lead ? '★ ' : '') + esc(n) + '</span>'; }).join('') + '</div>' : '<small class="muted">No one assigned yet</small>') +
          '<small>#' + r.n + ' · ' + esc(pretty(t.es)) + (t.dur ? ' – ' + esc(pretty(t.ef)) : '') + (late ? ' · <b style="color:#C2410C">late</b>' : '') + (cost(t) ? ' · ' + money(cost(t)) : '') + '</small>' +
          ((t.subs || []).length ? '<div class="kchk"><small class="muted">' + t.subs.filter(function (x) { return x.status === 'done'; }).length + ' of ' + t.subs.length + ' sub-tasks done</small>' + t.subs.map(function (x) {
            return '<label class="kchk-i' + (x.status === 'done' ? ' done' : '') + '"><input type="checkbox" data-subtick="' + esc(x.id) + '"' + (x.status === 'done' ? ' checked' : '') + ' style="width:auto">' + esc(x.name) + (x.owner ? ' <small class="muted">· ' + esc(x.owner) + '</small>' : '') + '</label>'; }).join('') + '</div>' : '') +
          '<div class="pbar st-' + t.status + '"><span style="width:' + t.pct + '%"></span></div>' +
          '<div class="kmove">' + (c[0] !== 'todo' ? '<button class="btn btn-sm" data-step="-1" title="Back one column">←</button>' : '') + '<span class="muted">' + t.pct + '%</span>' + (c[0] !== 'done' ? '<button class="btn btn-sm" data-step="1" title="Next column">→</button>' : '') + '</div></div>';
      }).join('') + '</div>';
    }).join('') + '</div>';
    var B = $('#planBody'), find = function (id) { return p.tasks.filter(function (t) { return t.id === id; })[0]; };
    var move = function (t, k) { if (!t || t.status === k) return; setStatus(t, k); dirty(stName[k] + ': ' + t.name); render(); };
    B.querySelectorAll('.kcard').forEach(function (c) { c.addEventListener('dragstart', function (e) { e.dataTransfer.setData('text/plain', c.getAttribute('data-tid')); }); });
    B.querySelectorAll('.kcol').forEach(function (col) {
      col.addEventListener('dragover', function (e) { e.preventDefault(); col.classList.add('over'); });
      col.addEventListener('dragleave', function () { col.classList.remove('over'); });
      col.addEventListener('drop', function (e) { e.preventDefault(); col.classList.remove('over'); move(find(e.dataTransfer.getData('text/plain')), col.getAttribute('data-col')); });
    });
    B.querySelectorAll('[data-step]').forEach(function (b) { b.onclick = function () { var t = find(b.closest('.kcard').getAttribute('data-tid')), i = STATUS.map(function (x) { return x[0]; }).indexOf(t.status) + (+b.getAttribute('data-step')); if (STATUS[i]) move(t, STATUS[i][0]); }; });
    B.querySelectorAll('[data-tick]').forEach(function (cb) { cb.onchange = function () { move(find(cb.closest('.kcard').getAttribute('data-tid')), cb.checked ? 'done' : 'todo'); }; });
    B.querySelectorAll('[data-subtick]').forEach(function (cb) {
      cb.onchange = function () {
        var t = find(cb.closest('.kcard').getAttribute('data-tid')), sb = t.subs.filter(function (x) { return x.id === cb.getAttribute('data-subtick'); })[0];
        sb.status = cb.checked ? 'done' : (sb.status === 'done' ? 'todo' : sb.status); derive(t); dirty(stName[sb.status] + ': ' + sb.name + ' (' + t.name + ')'); render();
      };
    });
  }

  /* ---------- scope (project charter) ---------- */
  function scope() {
    var c = S.plan.charter, p = S.plan;
    var f = function (k, label, rows, ph) { return '<label class="full">' + label + '<textarea data-c="' + k + '" rows="' + rows + '" placeholder="' + esc(ph || '') + '">' + esc(c[k] || '') + '</textarea></label>'; };
    $('#planBody').innerHTML = '<div class="card" style="max-width:980px"><h2>Project charter (scope)</h2><p class="muted" style="margin:-4px 0 12px">What is (and isn\'t) being delivered. Agree it with the customer before work starts.</p><div class="form">' +
      '<label>Plan name<input data-p="name" value="' + esc(p.name) + '"></label><label>Customer (sponsor)<input data-c="customer" value="' + esc(c.customer) + '"></label>' +
      '<label>Project manager<input data-c="manager" value="' + esc(c.manager) + '"></label><label>Approved budget ($)<input data-c="budget" inputmode="decimal" value="' + esc(c.budget || '') + '"></label>' +
      f('objective', 'Objective (why we are doing this)', 2, 'e.g. Stop the leak into the unit below and give the customer a modern bathroom') +
      f('inScope', 'In scope', 3, 'What is included') + f('outScope', 'Out of scope', 2, 'What is NOT included (avoids arguments later), e.g. electrical work, painting outside the bathroom') +
      f('deliverables', 'Deliverables', 2, 'e.g. Waterproofing certificate, flood-test photos, finished bathroom, warranty') +
      f('acceptance', 'Acceptance criteria (how we know it\'s done)', 2, '') + f('assumptions', 'Assumptions & constraints', 2, 'e.g. Access weekdays 7am-5pm; no work in heavy rain; customer supplies tapware') +
      '</div>' + (c.budget ? '<p style="margin:12px 0 0">Planned cost <b>' + money(rollup(p, today()).BAC) + '</b> against an approved budget of <b>' + money(c.budget) + '</b>.</p>' : '') + '</div>';
    $('#planBody').querySelectorAll('[data-c]').forEach(function (el) { el.oninput = function () { var k = el.getAttribute('data-c'); c[k] = k === 'budget' ? r2(String(el.value).replace(/[$,]/g, '')) : el.value; dirty(); }; });
    $('#planBody').querySelector('[data-p=name]').oninput = function () { p.name = this.value; dirty(); };
  }

  /* ---------- risks + issues ---------- */
  var scoreCls = function (s) { return s >= 15 ? 'sc-red' : s >= 8 ? 'sc-amber' : 'sc-green'; };
  function risks() {
    var p = S.plan; p.risks = p.risks || [];
    var open = p.risks.filter(function (r) { return r.status !== 'Closed'; });
    var heat = '<div class="heat"><div class="heat-y">Probability</div><div class="heat-g">';
    for (var pr = 5; pr >= 1; pr--) for (var im = 1; im <= 5; im++) { var n = open.filter(function (r) { return r.p === pr && r.i === im; }).length; heat += '<span class="' + scoreCls(pr * im) + '" title="P' + pr + ' × I' + im + '">' + (n || '') + '</span>'; }
    heat += '</div><div class="heat-x">Impact →</div></div>';
    var sel = function (k, v, list) { return '<select data-r="' + k + '">' + list.map(function (o) { return '<option' + (String(o) === String(v) ? ' selected' : '') + '>' + o + '</option>'; }).join('') + '</select>'; };
    $('#planBody').innerHTML = '<div class="grid riskgrid" id="riskGrid"><div class="card"><div class="card-h"><h2>Risk register</h2><button class="btn btn-sm btn-gold" id="addRisk">＋ Add risk</button></div>' +
      '<p class="muted" style="margin:-4px 0 10px">Things that MIGHT happen. Score = probability × impact (1–5 each). Review them as the job goes. Press <b>✨ Ask AI</b> on a risk for possible resolutions.</p>' +
      (p.risks.length ? '<div class="table-wrap"><table class="rt"><thead><tr><th>Risk</th><th>P</th><th>I</th><th>Score</th><th>Response</th><th>Action / owner / review</th><th>Status</th><th></th></tr></thead><tbody>' +
        p.risks.map(function (r) { return '<tr data-rid="' + esc(r.id) + '"' + (r.status === 'Closed' ? ' class="tdone"' : '') + '><td><input data-r="title" value="' + esc(r.title) + '" placeholder="What could go wrong?"><input data-r="cause" value="' + esc(r.cause) + '" placeholder="Cause / trigger" class="sub"></td>' +
          '<td>' + sel('p', r.p, [1, 2, 3, 4, 5]) + '</td><td>' + sel('i', r.i, [1, 2, 3, 4, 5]) + '</td><td><span class="score ' + scoreCls(r.p * r.i) + '">' + r.p * r.i + '</span></td>' +
          '<td>' + sel('response', r.response, ['Avoid', 'Mitigate', 'Transfer', 'Accept', 'Exploit']) + '</td>' +
          '<td><input data-r="action" value="' + esc(r.action) + '" placeholder="What we will do"><div class="row" style="gap:6px;flex-wrap:nowrap"><input data-r="owner" value="' + esc(r.owner) + '" placeholder="Owner" class="sub"><input data-r="review" type="date" value="' + esc(r.review) + '" class="sub" title="Review date"></div></td>' +
          '<td>' + sel('status', r.status, ['Open', 'Closed']) + '</td><td class="nowrap"><button class="btn btn-sm btn-ai" data-rai title="Ask AI for possible resolutions">✨ Ask AI</button> <button class="btn btn-sm" data-rdel title="Delete">✕</button></td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="empty">No risks yet.</div>') +
      '</div><div class="card"><h2>Heat map</h2>' + heat + '<p class="muted" style="font-size:12.5px;margin:10px 0 0">Open risks by probability and impact. Red = act now.</p></div></div>';
    var B = $('#planBody');
    B.querySelectorAll('tr[data-rid] [data-r]').forEach(function (el) {
      var k = el.getAttribute('data-r'), live = el.tagName === 'INPUT' && el.type !== 'date';
      el.addEventListener(live ? 'input' : 'change', function () { var r = p.risks.filter(function (x) { return x.id === el.closest('tr').getAttribute('data-rid'); })[0]; r[k] = k === 'p' || k === 'i' ? +el.value : el.value; dirty(); if (!live) render(); });
    });
    B.querySelectorAll('[data-rai]').forEach(function (b) { b.onclick = function () { var id = b.closest('tr').getAttribute('data-rid'); askAI('risk', p.risks.filter(function (x) { return x.id === id; })[0]); }; });
    B.querySelectorAll('[data-rdel]').forEach(function (b) { b.onclick = function () { var id = b.closest('tr').getAttribute('data-rid'); p.risks = p.risks.filter(function (x) { return x.id !== id; }); dirty(); render(); }; });
    $('#addRisk').onclick = function () { p.risks.push({ id: 'r' + Date.now().toString(36), title: '', cause: '', p: 3, i: 3, response: 'Mitigate', action: '', owner: (p.charter || {}).manager || '', review: '', status: 'Open', raised: today() }); dirty(); render(); var i = document.querySelectorAll('#planBody [data-r=title]'); if (i.length) i[i.length - 1].focus(); };
  }
  function issues() {
    var p = S.plan; p.issues = p.issues || [];
    var sel = function (k, v, list) { return '<select data-x="' + k + '">' + list.map(function (o) { return '<option' + (o === v ? ' selected' : '') + '>' + o + '</option>'; }).join('') + '</select>'; };
    $('#planBody').innerHTML = '<div class="card"><div class="card-h"><h2>Issue log</h2><button class="btn btn-sm btn-gold" id="addIssue">＋ Add issue</button></div>' +
      '<p class="muted" style="margin:-4px 0 10px">Problems that HAVE happened and need action (a risk that came true becomes an issue). Press <b>✨ Ask AI</b> on an issue for possible resolutions.</p>' +
      (p.issues.length ? '<div class="table-wrap"><table class="rt"><thead><tr><th>Issue</th><th>Priority</th><th>Owner</th><th>Raised</th><th>Due</th><th>Status</th><th>Resolution</th><th></th></tr></thead><tbody>' +
        p.issues.map(function (x) { return '<tr data-iid="' + esc(x.id) + '"' + (x.status === 'Resolved' ? ' class="tdone"' : '') + '><td><input data-x="title" value="' + esc(x.title) + '" placeholder="What happened?"><input data-x="detail" value="' + esc(x.detail) + '" placeholder="Details" class="sub"></td>' +
          '<td>' + sel('priority', x.priority, ['Low', 'Medium', 'High', 'Critical']) + '</td><td><input data-x="owner" value="' + esc(x.owner) + '" style="width:110px"></td>' +
          '<td><input data-x="raised" type="date" value="' + esc(x.raised) + '"></td><td><input data-x="due" type="date" value="' + esc(x.due) + '"></td>' +
          '<td>' + sel('status', x.status, ['Open', 'In progress', 'Resolved']) + '</td><td><input data-x="resolution" value="' + esc(x.resolution) + '" placeholder="How it was fixed"></td><td class="nowrap"><button class="btn btn-sm btn-ai" data-xai title="Ask AI for possible resolutions">✨ Ask AI</button> <button class="btn btn-sm" data-xdel title="Delete">✕</button></td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="empty">No issues. 👍</div>') + '</div>';
    var B = $('#planBody');
    B.querySelectorAll('tr[data-iid] [data-x]').forEach(function (el) {
      var k = el.getAttribute('data-x'), live = el.tagName === 'INPUT' && el.type !== 'date';
      el.addEventListener(live ? 'input' : 'change', function () { var x = p.issues.filter(function (i) { return i.id === el.closest('tr').getAttribute('data-iid'); })[0]; x[k] = el.value; dirty(); if (!live) render(); });
    });
    B.querySelectorAll('[data-xai]').forEach(function (b) { b.onclick = function () { var id = b.closest('tr').getAttribute('data-iid'); askAI('issue', p.issues.filter(function (x) { return x.id === id; })[0]); }; });
    B.querySelectorAll('[data-xdel]').forEach(function (b) { b.onclick = function () { var id = b.closest('tr').getAttribute('data-iid'); p.issues = p.issues.filter(function (x) { return x.id !== id; }); dirty(); render(); }; });
    $('#addIssue').onclick = function () { p.issues.push({ id: 'i' + Date.now().toString(36), title: '', detail: '', priority: 'Medium', owner: (p.charter || {}).manager || '', raised: today(), due: '', status: 'Open', resolution: '' }); dirty(); render(); var i = document.querySelectorAll('#planBody [data-x=title]'); if (i.length) i[i.length - 1].focus(); };
  }


  /* ---------- ✨ Ask AI: possible resolutions for a risk or an issue (DeepSeek, token-capped) ---------- */
  S.advice = S.advice || {};
  function askAI(kind, item) {
    if (!item) return;
    if (!String(item.title || '').trim()) return toast('Write the ' + kind + ' first, then ask the AI', true);
    var key = kind + ':' + item.id;
    M.modal('<h2>✨ Ask AI: possible resolutions</h2>' +
      '<p class="muted" style="margin:6px 0 10px">' + (kind === 'risk' ? 'Risk' : 'Issue') + ': <b style="color:#151515">' + esc(item.title) + '</b>' + (kind === 'risk' ? ' · score ' + item.p * item.i : ' · ' + esc(item.priority)) + '</p>' +
      '<div class="inline-form" style="margin-top:0"><input id="aiAsk" maxlength="300" placeholder="Anything to add? e.g. customer needs it done before Christmas (optional)"><button class="btn btn-sm btn-gold" id="aiGo" type="button">✨ Ask AI</button></div>' +
      '<div id="aiOut"></div>' +
      '<div class="actions" style="justify-content:flex-end;margin-top:12px"><button class="btn" data-close type="button">Close</button></div>');
    var show = function (r) {
      var useLabel = kind === 'risk' ? 'Use as the action' : 'Use as the resolution';
      $('#aiOut').innerHTML = '<h3 class="ai-h">Possible resolutions</h3>' +
        '<p class="muted" style="font-size:12.5px;margin:0 0 8px">Suggestions from AI. Check them with the right trade, engineer, insurer or council before acting.</p>' +
        r.options.map(function (o, i) {
          return '<div class="ai-opt"><div class="row" style="justify-content:space-between;gap:8px"><b>' + (i + 1) + '. ' + esc(o.title) + '</b><span>' + (o.response ? '<span class="badge-soft">' + esc(o.response) + '</span>' : '') + (o.effort ? ' <span class="badge-soft">' + esc(o.effort) + ' effort</span>' : '') + '</span></div>' +
            (o.steps.length ? '<ul>' + o.steps.map(function (st) { return '<li>' + esc(st) + '</li>'; }).join('') + '</ul>' : '') +
            '<button class="btn btn-sm" data-use="' + i + '" type="button">' + useLabel + '</button></div>';
        }).join('') +
        (r.watch ? '<p style="margin:8px 0 0"><b>Keep an eye on:</b> ' + esc(r.watch) + '</p>' : '') +
        (r.tokens ? '<p class="muted" style="font-size:12px;margin:8px 0 0">Used about ' + Number(r.tokens).toLocaleString('en-AU') + ' tokens' + (r.today ? ' · today ' + r.today.questions + ' of ' + r.today.limit + ' AI questions' : '') + '.</p>' : '');
      document.querySelectorAll('#aiOut [data-use]').forEach(function (b) {
        b.onclick = function () {
          var o = r.options[+b.getAttribute('data-use')], text = (o.title + (o.steps.length ? ': ' + o.steps.join('; ') : '')).slice(0, 300);
          if (kind === 'risk') { item.action = text; if (['Avoid', 'Mitigate', 'Transfer', 'Accept'].indexOf(o.response) >= 0) item.response = o.response; }
          else { item.resolution = text; if (item.status === 'Open') item.status = 'In progress'; }
          dirty('AI suggestion used for ' + kind + ': ' + item.title); M.closeModal(); render(); toast(kind === 'risk' ? 'Added as the action' : 'Added as the resolution (status: In progress)');
        };
      });
    };
    if (S.advice[key]) show(S.advice[key]);
    $('#aiGo').onclick = function () {
      var b = $('#aiGo'); b.disabled = true; b.textContent = 'Thinking…';
      $('#aiOut').innerHTML = '<p class="ask-think" style="margin:12px 0">Working out possible resolutions…</p>';
      var draft = kind === 'risk' ? { title: item.title, cause: item.cause, p: item.p, i: item.i, response: item.response, action: item.action }
        : { title: item.title, detail: item.detail, priority: item.priority, due: item.due, status: item.status, resolution: item.resolution };
      var payload = { core: S.core, kind: kind, id: item.id, ask: $('#aiAsk').value, item: draft };
      var slow = function (e) { return /took too long|slow right now|Error 50[234]|Failed to fetch/i.test(String(e && e.message)); };
      api('planAdvise', payload).catch(function (e) {
        if (!slow(e)) throw e;
        $('#aiOut').innerHTML = '<p class="ask-think" style="margin:12px 0">The AI is slow right now, trying once more…</p>';
        return api('planAdvise', payload);
      }).then(function (r) { S.advice[key] = r; show(r); })
        .catch(function (e) { $('#aiOut').innerHTML = '<p class="ai-err">' + esc(e.message) + '</p>'; })
        .then(function () { var bb = $('#aiGo'); if (bb) { bb.disabled = false; bb.textContent = '✨ Ask AI'; } });
    };
  }

  /* ---------- overview (status report) ---------- */
  function overview(R) {
    var p = S.plan, t0 = today(), soon = toS(new Date(toD(t0).getTime() + 14 * 864e5));
    var coming = ordered().filter(function (r) { return r.t.pct < 100 && r.t.es <= soon && r.t.ef >= t0; });
    var evm = [['Budget at completion (BAC)', money(R.BAC), 'Total planned cost'], ['Planned value (PV)', money(R.PV), 'Work that should be done by today'], ['Earned value (EV)', money(R.EV), 'Work actually done (cost × % complete)'],
      ['Actual cost (AC)', money(R.AC), 'Money spent so far (Actual $ column)'], ['Schedule performance (SPI = EV ÷ PV)', R.SPI == null ? '—' : R.SPI, R.SPI == null ? '' : R.SPI >= 1 ? 'on or ahead of schedule' : 'behind schedule'],
      ['Cost performance (CPI = EV ÷ AC)', R.CPI == null ? '—' : R.CPI, R.CPI == null ? '' : R.CPI >= 1 ? 'on or under budget' : 'over budget'], ['Forecast final cost (EAC = BAC ÷ CPI)', R.EAC == null ? '—' : money(R.EAC), '']];
    $('#planBody').innerHTML = '<div class="grid two"><div class="grid" style="align-content:start">' +
      '<div class="card"><h2>Time & cost (earned value)</h2><div class="table-wrap"><table><tbody>' + evm.map(function (e) { return '<tr><td>' + esc(e[0]) + '<br><small class="muted">' + esc(e[2]) + '</small></td><td class="num" style="font-weight:800;font-size:15px">' + esc(e[1]) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
        (S.expensesEx ? '<p class="muted" style="margin:10px 0 0">Expenses recorded for this job in Accounts: <b>' + money(S.expensesEx) + '</b> ex GST.</p>' : '') +
        (p.baseline ? '<p class="muted" style="margin:6px 0 0">Baseline set ' + esc(M.day(p.baseline.at)) + ': finish ' + esc(prettyY(p.baseline.finish)) + ', budget ' + money(p.baseline.BAC) + '. Now: finish ' + esc(prettyY(R.finish)) + ' (' + esc(varDays(p.baseline.finish, R.finish)) + ').</p>' : '<p class="muted" style="margin:6px 0 0">Tip: press “Set baseline” once the plan is agreed, so you can track slippage.</p>') + '</div>' +
      '<div class="card"><h2>Next 14 days</h2>' + (coming.length ? '<div class="list">' + coming.map(function (r) { return '<div class="item"><div><b>#' + r.n + ' ' + esc(r.t.name) + '</b><br><small>' + esc(pretty(r.t.es)) + ' – ' + esc(pretty(r.t.ef)) + (r.t.res && r.t.res.length ? ' · ' + esc(resText(r.t)) : '') + '</small></div><b>' + r.t.pct + '%</b></div>'; }).join('') + '</div>' : '<div class="empty">Nothing scheduled in the next two weeks.</div>') + '</div></div>' +
      '<div class="grid" style="align-content:start">' +
      materialsCard() +
      '<div class="card"><h2>Late tasks</h2>' + (R.late.length ? '<div class="list">' + R.late.map(function (t) { return '<div class="item"><div><b>' + esc(t.name) + '</b><br><small style="color:#C2410C">was due ' + esc(pretty(t.ef)) + '</small></div><b>' + t.pct + '%</b></div>'; }).join('') + '</div>' : '<div class="empty">Nothing late. 👍</div>') + '</div>' +
      '<div class="card"><h2>Top risks</h2>' + ((p.risks || []).filter(function (r) { return r.status !== 'Closed'; }).sort(function (a, b) { return b.p * b.i - a.p * a.i; }).slice(0, 4).map(function (r) { return '<div class="item"><div><b>' + esc(r.title || '(untitled)') + '</b><br><small>' + esc(r.response) + (r.action ? ': ' + esc(r.action) : '') + '</small></div><span class="score ' + scoreCls(r.p * r.i) + '">' + r.p * r.i + '</span></div>'; }).join('') || '<div class="empty">No open risks.</div>') + '</div>' +
      '<div class="card"><h2>Open issues</h2>' + ((p.issues || []).filter(function (x) { return x.status !== 'Resolved'; }).map(function (x) { return '<div class="item"><div><b>' + esc(x.title || '(untitled)') + '</b><br><small>' + esc(x.priority) + (x.owner ? ' · ' + esc(x.owner) : '') + (x.due ? ' · due ' + esc(pretty(x.due)) : '') + '</small></div><small>' + esc(x.status) + '</small></div>'; }).join('') || '<div class="empty">No open issues.</div>') + '</div>' +
      (S.reminders.length ? '<div class="card"><h2>Reminders for this job</h2><div class="list">' + S.reminders.map(function (r) { return '<div class="item"><div><b>' + esc(r.when) + '</b><br><small>' + esc(r.text) + '</small></div></div>'; }).join('') + '</div></div>' : '') +
      '</div></div>';
    $('#planBody').querySelectorAll('[data-invro]').forEach(function (b) { b.onclick = function () { M.inv.reorder(b.getAttribute('data-invro')); }; });
  }

  function materialsCard() {
    var p = S.plan, by = {};
    p.tasks.forEach(function (t) { if (!t.item) return; var b = by[t.item] = by[t.item] || { need: 0, used: 0, tasks: 0 }; b.tasks++; if (t.status === 'done') b.used += Number(t.qty) || 0; else b.need += Number(t.qty) || 0; });
    var ids = Object.keys(by);
    if (!ids.length) return '<div class="card"><h2>Materials from stock</h2><p class="muted" style="margin:0">Press 📦 next to a task name to use an item from Inventory. Its quantity is set aside for this job and taken out of stock when the task is Done.</p></div>';
    return '<div class="card"><h2>Materials from stock</h2><div class="list">' + ids.map(function (id) {
      var i = invItem(id) || { name: id, unit: '', available: 0 }, b = by[id], short = i.available < 0;
      return '<div class="item"><div><b>' + esc(i.name) + '</b><br><small>' + (b.need ? 'needed ' + b.need + ' ' + esc(i.unit) : '') + (b.need && b.used ? ' · ' : '') + (b.used ? 'used ' + b.used + ' ' + esc(i.unit) : '') + ' · ' + (short ? '<b style="color:#B42318">short ' + (-i.available) + ' ' + esc(i.unit) + '</b>' : i.available + ' ' + esc(i.unit) + ' left in stock') + '</small></div>' +
        (short || i.low ? '<button class="btn btn-sm btn-gold" data-invro="' + esc(id) + '">Re-order</button>' : '<a class="btn btn-sm" href="#inventory/' + esc(id) + '">Stock</a>') + '</div>';
    }).join('') + '</div></div>';
  }

  /* ---------- job page card ---------- */
  M.onJob(function (j) {
    var col = V().querySelectorAll('.grid.two > .grid')[1]; if (!col) return;
    var box = document.createElement('div'); box.className = 'card'; box.id = 'jobPlan';
    box.innerHTML = '<div class="card-h"><h2>Project plan</h2></div><div class="empty" style="padding:8px">Loading…</div>';
    col.insertBefore(box, col.firstChild);
    api('planGet', { core: j.core }).then(function (d) {
      if (!d.plan) { box.innerHTML = '<div class="card-h"><h2>Project plan</h2></div><p class="muted" style="margin:0 0 10px">Plan the work: tasks, dates, resources, costs, risks and issues.</p><a class="btn btn-gold btn-sm" href="#plan/' + esc(j.core) + '">📅 Create a project plan</a>'; return; }
      var R = rollup(d.plan, today());
      box.innerHTML = '<div class="card-h"><h2>Project plan</h2><a class="btn btn-sm btn-gold" href="#plan/' + esc(j.core) + '">Open plan →</a></div><b>' + esc(d.plan.name) + '</b>' +
        '<div class="pbar" style="margin:8px 0 4px"><span style="width:' + R.pct + '%"></span></div><small>' + R.pct + '% complete · finish ' + esc(prettyY(R.finish)) + (R.late.length ? ' · <b style="color:#C2410C">' + R.late.length + ' late</b>' : '') + ' · ' + money(R.AC) + ' of ' + money(R.BAC) + ' spent</small>';
    }).catch(function () {});
  });

  M.addView('projects', 'Projects', projects);
  M.addView('plan', 'Project plan', planView, 'projects');
  window.addEventListener('hashchange', function () { if (S.timer && !/^#plan\//.test(location.hash)) saveNow(); });
  window.MBS.planState = S;   // for tests
})();
