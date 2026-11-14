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
  // Mon-Fri; an emergency plan (v34), or one with "Weekends allowed" ticked (v40), also works Saturday and Sunday. ALL follows the plan being scheduled (set in schedule()).
  var ALL = false;
  var wk = function (d) { if (ALL) return true; var w = d.getUTCDay(); return w !== 0 && w !== 6; };
  function nextWork(s) { var d = toD(s); while (!wk(d)) d = new Date(d.getTime() + 864e5); return toS(d); }
  function addWork(s, n) { var d = toD(s); while (n > 0) { d = new Date(d.getTime() + 864e5); if (wk(d)) n--; } return toS(d); }
  function workBetween(a, b) { if (!a || !b || b < a) return 0; var n = 0, d = toD(a), e = toD(b); while (d <= e) { if (wk(d)) n++; d = new Date(d.getTime() + 864e5); } return n; }
  function daysBetween(a, b) { return Math.round((toD(b) - toD(a)) / 864e5); }
  function today() { var o = {}; new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).forEach(function (p) { o[p.type] = p.value; }); return o.year + '-' + o.month + '-' + o.day; }
  var dmy = function (s) { return s ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : ''; };
  function parseDmy(v) {
    var m = String(v || '').trim().match(/^(\d{1,2})[\/.\-\s](\d{1,2})[\/.\-\s](\d{2}|\d{4})$/); if (!m) return null;
    var d = +m[1], mo = +m[2], y = +m[3]; if (y < 100) y += 2000;
    var dt = new Date(Date.UTC(y, mo - 1, d)); return dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null;
  }
  // every date box in the planner shows and takes DD/MM/YYYY (the browser's own date box follows the computer's region, e.g. MM/DD/YYYY);
  // the real date input stays underneath (for the 📅 calendar and for the code), so nothing else changes
  function dateBoxes(root) {
    (root || document).querySelectorAll('input[type=date]:not([data-dmy])').forEach(function (n) {
      n.setAttribute('data-dmy', '1');
      var w = document.createElement('span'); w.className = 'dbox' + (n.classList.contains('pinned') ? ' pinned' : '');
      var t = document.createElement('input'); t.type = 'text'; t.className = 'dtext'; t.placeholder = 'DD/MM/YYYY'; t.inputMode = 'numeric'; t.maxLength = 10; t.autocomplete = 'off';
      t.value = dmy(n.value); t.title = n.title; t.disabled = n.disabled; if (n.id) t.setAttribute('data-for', n.id);
      var b = document.createElement('button'); b.type = 'button'; b.className = 'dpick'; b.textContent = '📅'; b.title = 'Pick from a calendar'; b.tabIndex = -1; b.disabled = n.disabled;
      n.parentNode.insertBefore(w, n); w.appendChild(t); w.appendChild(b); w.appendChild(n); n.classList.add('dnative'); n.tabIndex = -1;
      var fire = function () { n.dispatchEvent(new Event('input', { bubbles: true })); n.dispatchEvent(new Event('change', { bubbles: true })); };
      t.addEventListener('input', function () { var v = t.value.replace(/[^\d]/g, ''); if (/^\d{8}$/.test(v) && !/\D/.test(t.value)) t.value = v.slice(0, 2) + '/' + v.slice(2, 4) + '/' + v.slice(4); });
      t.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); t.blur(); } });
      t.addEventListener('change', function () {
        if (!t.value.trim()) { n.value = ''; fire(); return; }
        var iso = parseDmy(t.value);
        if (!iso) { toast('Type the date as DD/MM/YYYY, e.g. ' + dmy(today()), true); t.value = dmy(n.value); return; }
        n.value = iso; t.value = dmy(iso); fire();
      });
      var back = function () { if (document.activeElement !== t) t.value = dmy(n.value); };
      n.addEventListener('input', back); n.addEventListener('change', back);
      b.onclick = function () { try { n.showPicker(); } catch (e) { n.focus(); } };
    });
  }
  var pretty = function (s) { if (!s) return ''; var a = s.split('-').map(Number); return a[2] + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][a[1] - 1]; };
  var prettyY = function (s) { return s ? pretty(s) + ' ' + s.slice(0, 4) : ''; };

  // which tasks wait for the quote (same rule as the server): the "Quote accepted" milestone and everything not leading up to it
  function gatedTasks(p) {
    var byId = {}, out = []; p.tasks.forEach(function (t) { byId[t.id] = t; });
    var m = p.tasks.filter(function (t) { return t.dur === 0 && /quote/i.test(t.name); })[0];
    if (m) {
      var before = [], walk = function (t) { (t.pred || []).forEach(function (id) { var q = byId[id]; if (q && before.indexOf(q) < 0) { before.push(q); walk(q); } }); };
      walk(m);
      p.tasks.forEach(function (t) { if (before.indexOf(t) < 0 && !((t.pct || 0) > 0)) out.push(t); });
    } else p.tasks.forEach(function (t) { if (!/inspect|measure|quot|site visit/i.test(t.name) && !((t.pct || 0) > 0)) out.push(t); });
    return out;
  }
  // When can the work start (same rule as the server)? Emergency: straight away, the same day as the site inspection.
  // Otherwise: quote accepted (until then: the quote date) + cooling-off (default 3 business days). "Work starts" can only make it later.
  function coolOf(p) { return 0; }   // Project Champ: no cooling-off period (that was the builder's consumer-law rule)
  function gateOf(p) {
    p.emergency = false;   // Project Champ: no emergency mode
    ALL = !!(p.emergency || p.weekends);
    var re = /^\d{4}-\d{2}-\d{2}$/, ws = re.test(p.workStart || '') ? nextWork(p.workStart) : '';
    if (p.emergency) return { date: ws, why: ws ? 'work' : 'emergency' };
    var g = p.gate, q = g && re.test(g.date || '') ? addWork(nextWork(g.date), coolOf(p)) : '';
    if (ws && ws > q) return { date: ws, why: 'work' };
    return { date: q, why: q ? (g.accepted ? 'accepted' : 'quoted') : '' };
  }
  function gateDate(p) { return gateOf(Object.assign({}, p, { workStart: '' })).date; }   // quote + cooling-off only
  function holdDate(p) { return gateOf(p).date; }
  function gateText(p) {
    var G = gateOf(p), c = coolOf(p), g = p.gate, days = c + ' business day' + (c === 1 ? '' : 's');
    if (p.emergency) return '🚨 <b>Emergency:</b> the work can start straight away, the same day as the site inspection, and Saturday and Sunday are work days' + (G.date ? '; "Work starts" set to <b>' + esc(dmy(G.date)) + '</b>' : '') + '.';
    var w = G.why === 'work' ? '📅 Work starts <b>' + esc(dmy(G.date)) + '</b> ("Work starts" date). ' : '';
    if (!g) return w + 'Once there is a quote or proposal, the work waits for it to be accepted.';
    if (g.accepted) return w + '✅ Quote <b>' + esc(g.id) + '</b> accepted on ' + esc(dmy(g.date)) + '; the work starts <b>' + esc(dmy(gateDate(p))) + '</b>.';
    return w + '🔒 Quote <b>' + esc(g.id) + '</b> is not accepted yet. The work waits for acceptance: assuming acceptance on the quote date (' + esc(dmy(g.date)) + '), the work starts <b>' + esc(dmy(gateDate(p))) + '</b>. It moves if the client accepts later.';
  }
  function schedule(p) {
    ALL = !!(p.emergency || p.weekends);   // emergency, or "Weekends (Sat, Sun) allowed": weekends are work days
    var start = nextWork(p.start || today()), byId = {}, gate = holdDate(p), gated = gate ? gatedTasks(p) : [];
    var quoteMs = p.emergency ? p.tasks.filter(function (t) { return t.dur === 0 && /quote/i.test(t.name); })[0] : null;   // emergency: work the same day as the inspection
    p.tasks.forEach(function (t) { byId[t.id] = t; t.es = ''; t.ef = ''; });
    for (var pass = 0; pass < 30; pass++) {
      var changed = false;
      p.tasks.forEach(function (t) {
        var es = start;
        if (gate && gated.indexOf(t) >= 0 && gate > es) es = gate;   // no work before the quote is accepted (or until it expires)
        if (t.fixed && t.snet) { if (t.snet > es) es = t.snet; }   // start date set by hand: runs in parallel, "After #" not used
        else {
          (t.pred || []).forEach(function (id) { var q = byId[id]; if (q && q.ef && q !== t) { var after = t === quoteMs ? q.es : q.dur === 0 ? nextWork(q.ef) : addWork(nextWork(q.ef), 1); if (after > es) es = after; } });
          if (t.snet && t.snet > es) es = t.snet;
        }
        es = nextWork(es);
        var ef = t.dur === 0 ? es : addWork(es, Math.max(1, t.dur) - 1);
        if (es !== t.es || ef !== t.ef) { t.es = es; t.ef = ef; changed = true; }
      });
      if (!changed) break;
    }
  }
  // v56: a task's cost = its own qty x rate (labour, hire ...) + its stock materials (each item x its quantity)
  var matsOf = function (t) { return Array.isArray(t.mats) ? t.mats : []; };
  var matCost = function (t) { return r2(matsOf(t).reduce(function (a, m) { return a + (Number(m.qty) || 0) * (Number(m.price) || 0); }, 0)); };
  var cost = function (t) { return r2((Number(t.qty) || 0) * (Number(t.rate) || 0) + matCost(t) + (Number(t.bomx) || 0)); };   // v93: + BOM materials not in stock
  function rollup(p, day) {
    schedule(p);
    var T = p.tasks, frac = function (t) { return !t.es ? 0 : day < t.es ? 0 : day >= t.ef ? 1 : workBetween(t.es, day) / Math.max(1, workBetween(t.es, t.ef)); };
    var BAC = r2(T.reduce(function (a, t) { return a + cost(t); }, 0)), PV = r2(T.reduce(function (a, t) { return a + cost(t) * frac(t); }, 0));
    var EV = r2(T.reduce(function (a, t) { return a + cost(t) * (t.pct || 0) / 100; }, 0));
    // spent so far: what was entered in $ Actual; a task with progress but no actual entered counts at its cost × % complete (as planned), so the cost moves with the work
    var has = function (t) { return Number(t.actual) > 0; }, ACin = r2(T.reduce(function (a, t) { return a + (has(t) ? Number(t.actual) : 0); }, 0)), EVin = r2(T.reduce(function (a, t) { return a + (has(t) ? cost(t) * (t.pct || 0) / 100 : 0); }, 0));
    var ACest = r2(T.reduce(function (a, t) { return a + (has(t) ? 0 : cost(t) * (t.pct || 0) / 100); }, 0)), AC = r2(ACin + ACest);
    var durW = T.reduce(function (a, t) { return a + Math.max(1, t.dur); }, 0) || 1;
    var CPI = ACin > 0 ? r2(EVin / ACin) : null, SPI = PV > 0 ? r2(EV / PV) : null;   // CPI from real (entered) costs only
    return { BAC: BAC, PV: PV, EV: EV, AC: AC, ACin: ACin, ACest: ACest, CPI: CPI, SPI: SPI, EAC: CPI ? r2(BAC / CPI) : null,
      start: T.reduce(function (m, t) { return !m || (t.es && t.es < m) ? t.es : m; }, ''), finish: T.reduce(function (m, t) { return t.ef > m ? t.ef : m; }, ''),
      done: T.filter(function (t) { return t.pct >= 100; }).length, total: T.length, late: T.filter(function (t) { return t.pct < 100 && t.ef && t.ef < day; }),
      pct: T.length ? Math.round(T.reduce(function (a, t) { return a + Math.max(1, t.dur) * (t.pct || 0); }, 0) / durW) : 0 };
  }
  var pl = function (n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); };
  // SPI / CPI colours: green 1.00 or more, yellow 0.90-0.99 (watch), red below 0.90 (act), grey = not enough data yet
  var evRag = function (v) { return rag(v, 1, 0.9); };
  var EV_WORD = { green: 'On track', amber: 'Watch', red: 'Act now', grey: 'No data yet' };
  function evChip(kind, v) {
    var c = evRag(v), what = kind === 'SPI' ? { green: 'on or ahead of schedule', amber: 'slightly behind schedule', red: 'behind schedule', grey: 'no work due or done yet' } : { green: 'on or under budget', amber: 'slightly over budget', red: 'over budget', grey: 'no actual costs recorded yet' };
    return '<span class="rag ev rag-' + c + '" title="' + kind + ' ' + (v == null ? '–' : v.toFixed(2)) + ': ' + what[c] + '"><i class="evdot"></i>' + (v == null ? '–' : v.toFixed(2)) + '</span><small class="evword ev-' + c + '">' + EV_WORD[c] + '</small>';
  }
  function evLegend() {
    return '<div class="evkey"><b>SPI</b> (schedule) = work done ÷ work planned by today. <b>CPI</b> (cost) = value of work done ÷ actual cost.' +
      '<span><i class="evdot g"></i><b>1.00 or more</b>: on or ahead of schedule / on or under budget</span>' +
      '<span><i class="evdot y"></i><b>0.90 – 0.99</b>: slightly behind / slightly over. Watch it</span>' +
      '<span><i class="evdot r"></i><b>below 0.90</b>: behind schedule / over budget. Act now</span>' +
      '<span><i class="evdot n"></i><b>–</b>: not enough progress or actual costs recorded yet</span></div>';
  }
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
  function fromTemplate(key, job, start, scope) { var p = newPlan(TEMPLATES[key] || buildTemplate(key), job, start, scope); if (key === 'blank') p.name = job.title || job.service || 'Project plan'; return p; }


  /* ---------- job types: 22 common types with sub-types; each builds a starting plan (example rates: change them to yours) ---------- */
  var RISK = {
    c_data: ['Client data or documents arrive late', 4, 4, 'Mitigate', 'Agree data deadlines at kick-off; escalate weekly; draft with placeholders'],
    c_signoff: ['Client sign-off at review gates takes longer than planned', 4, 3, 'Mitigate', 'Agree sign-off turnaround (e.g. 5 working days) in the charter; track gate dates'],
    c_scope: ['Scope creep: extra requests outside the agreed scope', 3, 4, 'Mitigate', 'Log every request; use change control; agree a variation before doing extra work'],
    c_people: ['Stakeholders not available for interviews or workshops', 3, 3, 'Mitigate', 'Book sessions in a block early; offer remote options'],
    c_keyperson: ['Key consultant or client lead leaves or is unavailable', 2, 4, 'Mitigate', 'Keep a back-up for each key role; document as you go'],
    c_resist: ['Resistance to change from staff or managers', 3, 4, 'Mitigate', 'Visible sponsor; change champions; communicate early and often'],
    c_vendor: ['Vendor or integration delays', 3, 4, 'Mitigate', 'Contract milestones with the vendor; weekly vendor stand-up; test integrations early'],
    c_reg: ['Regulation or reporting standards change during the project', 2, 3, 'Accept', 'Track the regulator; build flexibility into the framework'],
    c_adopt: ['Low adoption after go-live or training', 3, 3, 'Mitigate', 'Super-users, refresher sessions and adoption metrics for 90 days'],
    c_budget: ['Client budget cut or funding delayed', 2, 4, 'Mitigate', 'Stage the work in milestone payments; agree what can be deferred'],
    c_market: ['Market or partner conditions differ from the research', 3, 3, 'Mitigate', 'Validate with in-country partners before committing'],
    c_quality: ['Data quality is too poor to rely on', 3, 4, 'Mitigate', 'Run a data quality check early; agree estimation methods'],
    f_budget: ['Spending goes over the budget', 3, 3, 'Mitigate', 'Keep a simple budget sheet; get quotes before booking; hold back 10% for surprises'],
    f_vendor: ['A supplier or venue cancels or lets you down', 2, 4, 'Mitigate', 'Get bookings in writing; keep a back-up contact for each key supplier'],
    f_rsvp: ['People reply late, so numbers are unclear', 4, 2, 'Mitigate', 'Set an RSVP date; send one friendly reminder; plan for +10%'],
    f_weather: ['Bad weather on the day', 3, 3, 'Mitigate', 'Have a rain plan (indoor space, marquee) and check the forecast a week out'],
    f_ill: ['Someone key is sick or can\'t make it', 2, 3, 'Accept', 'Share the run sheet so a helper can step in'],
    f_time: ['Things are left to the last minute', 3, 3, 'Mitigate', 'Weekly 15-minute check-in on the plan; tick tasks off as you go'],
    k_cost: ['Cloud costs run higher than estimated', 3, 3, 'Mitigate', 'Budgets and billing alerts from day one; tag every resource; weekly cost review'],
    k_sec: ['Misconfiguration exposes data (public bucket, open port, broad IAM role)', 3, 5, 'Mitigate', 'Guardrails and policy as code; least privilege; automated security scans before go-live'],
    k_down: ['Downtime or data loss during cutover', 2, 5, 'Mitigate', 'Rehearse the cutover; tested backups and a rollback plan; cut over in a quiet window'],
    k_skill: ['Team lacks cloud skills to run it after go-live', 3, 3, 'Mitigate', 'Pair with the client team; runbooks; training before handover'],
    k_lock: ['Lock-in to one provider\'s services', 2, 3, 'Accept', 'Use open standards (containers, Terraform, OpenTelemetry) where it matters'],
    k_quota: ['Service limits, quotas or region capacity block the build', 2, 3, 'Mitigate', 'Check limits early and raise quota requests in week one'],
    k_comp: ['Data residency or compliance rules not met (Privacy Act, PDPA, APRA, ISO 27001)', 2, 4, 'Mitigate', 'Confirm regions and controls with the compliance owner before the design is signed'],
    k_legacy: ['Legacy apps do not behave as expected in the cloud', 3, 4, 'Mitigate', 'Proof of concept for the hardest app first; test with production-like data'],
    c_travel: ['Travel, visas or time zones slow the team down', 2, 2, 'Mitigate', 'Plan trips early; mix on-site and remote work'],
    weather: ['Rain or wind stops outdoor work', 4, 3, 'Mitigate', 'Check the forecast daily; keep a buffer day'], hidden: ['Hidden damage found once it is opened up', 3, 4, 'Mitigate', 'Agree a contingency and variations in writing up front'],
    supply: ['Materials late or out of stock', 2, 3, 'Mitigate', 'Confirm stock before ordering; order on day 1'], access: ['Access, keys or parking problems on site', 2, 2, 'Avoid', 'Confirm access and parking with the customer before starting'],
    approval: ['Approval (council / strata / engineer) takes longer than planned', 3, 3, 'Mitigate', 'Lodge early; do not start until approved in writing'], services: ['Hitting pipes, cables or underground services', 2, 4, 'Avoid', 'Locate services first (Dial Before You Dig)'],
    finish: ['Customer unhappy with the colour or finish', 2, 3, 'Avoid', 'Sample or test patch signed off before full work'], asbestos: ['Asbestos in older materials', 2, 5, 'Avoid', 'Test before demolition; licensed removalist if positive'],
    cure: ['Products need longer to cure (cold or humid weather)', 2, 2, 'Accept', 'Allow an extra day before the next trade'], licensed: ['Part of the work needs a licensed plumber or electrician', 3, 3, 'Transfer', 'Book the licensed trade early; keep the compliance certificate'],
    structure: ['Structural problem needs an engineer', 2, 5, 'Transfer', 'Engineer to inspect and certify before continuing'], leak: ['Leak comes back after the repair', 2, 4, 'Mitigate', 'Water or flood test with photos before closing up'],
    height: ['Work at height (falls)', 2, 5, 'Mitigate', 'Scaffold or edge protection; SWMS signed before work'], dust: ['Dust and noise upset the customer or neighbours', 3, 2, 'Mitigate', 'Dust sheets, extraction and agreed work hours']
  };
  function St(n, d, q, u, r, subs) { return [n, d, q, u, r, subs || []]; }
  var CATALOG = [
    { c: 'ESG consulting', g: 1, items: [
      { id: 'esg-strategy', n: 'ESG strategy and roadmap (AS-IS, To-Be, gap, roadmap)', dr: 1800, o: 'Set a clear ESG direction: where the organisation is today, where it needs to be, the gaps, and a costed roadmap to get there.', d: 'AS-IS ESG assessment; To-Be vision, targets and KPIs; gap analysis register; costed ESG roadmap; ESG governance model', ph: [
        ['AS-IS assessment', [['Document and data review', 5, 1], ['Stakeholder interviews (E, S, G)', 8, 2], ['AS-IS ESG baseline report', 5, 1]]], ['To-Be design', [['ESG vision, targets and KPIs', 6, 2]]],
        ['Gap analysis', [['Gap analysis register (AS-IS vs To-Be)', 5, 1]]], ['Roadmap', [['Costed ESG initiatives and roadmap', 6, 2], ['ESG governance and reporting model', 4, 1]]]], r: ['c_data', 'c_signoff', 'c_people', 'c_scope'] },
      { id: 'esg-baseline', n: 'ESG baseline and materiality assessment', dr: 1800, o: 'Measure current ESG performance and find the topics that matter most to the business and its stakeholders.', d: 'ESG baseline report; peer benchmark; materiality matrix and report', ph: [
        ['Baseline', [['Document and data review', 5, 2], ['Stakeholder interviews', 8, 2], ['ESG baseline report', 5, 1]]], ['Materiality', [['Peer benchmarking', 5, 1], ['Materiality survey and workshop', 4, 2], ['Materiality matrix and report', 4, 1]]]], r: ['c_data', 'c_people', 'c_quality'] },
      { id: 'esg-report', n: 'Sustainability report (GRI / ISSB aligned)', dr: 1800, o: 'Publish a credible sustainability report aligned to GRI and ISSB (IFRS S1 and S2), ready for assurance.', d: 'Reporting framework and boundary; data collection templates; sustainability report (about 100 pages); assurance readiness note', ph: [
        ['Framework', [['Reporting framework and boundary (GRI, ISSB, TCFD)', 4, 1], ['Data collection templates', 3, 1]]], ['Data', [['Collect E, S and G data', 15, 2], ['Data validation and gap fixes', 5, 1]]],
        ['Reporting', [['Draft the report', 15, 2], ['Client review round 1', 5, 1], ['Revisions and design layout', 6, 2], ['Assurance readiness check', 3, 1]]]], r: ['c_data', 'c_quality', 'c_signoff', 'c_reg'] },
      { id: 'esg-carbon', n: 'Carbon footprint and decarbonisation plan', dr: 1800, o: 'Measure Scope 1, 2 and 3 emissions and set a costed, science-based pathway to net zero.', d: 'GHG inventory (Scope 1, 2, 3); emissions baseline report; reduction options (MAC curve); net-zero targets; decarbonisation roadmap', ph: [
        ['Footprint', [['Scope 1 and 2 inventory', 8, 1], ['Scope 3 screening', 8, 2], ['Emissions baseline report', 4, 1]]], ['Pathway', [['Reduction opportunities (MAC curve)', 8, 2], ['Net-zero targets (SBTi aligned)', 4, 1], ['Decarbonisation roadmap and costs', 6, 1]]]], r: ['c_data', 'c_quality', 'c_reg'] }] },
    { c: 'Technology consulting', g: 1, items: [
      { id: 'tech-strategy', n: 'IT strategy and digital roadmap', dr: 1700, o: 'Align technology with the business: a target architecture and a funded digital roadmap.', d: 'Current-state assessment; target architecture; options and business case; 3-year digital roadmap', ph: [
        ['Current state', [['Systems and process review', 8, 2], ['Business unit interviews', 6, 2], ['Current-state architecture', 4, 1]]], ['Future state', [['Target architecture', 6, 1], ['Options and business case', 6, 2]]],
        ['Roadmap', [['Roadmap and investment plan', 5, 1], ['Board presentation', 2, 1]]]], r: ['c_people', 'c_data', 'c_budget'] },
      { id: 'tech-selection', n: 'System selection (RFP and vendor evaluation)', dr: 1700, o: 'Choose the right system and vendor through a fair, documented selection process.', d: 'Requirements specification; RFP pack; vendor scoring; recommendation report', ph: [
        ['Requirements', [['Business requirements workshops', 6, 2], ['Requirements specification', 5, 1]]], ['Market', [['Market scan and long list', 4, 1], ['RFP pack', 5, 1], ['RFP open period', 15, 0.2]]],
        ['Evaluation', [['Vendor demonstrations and scoring', 6, 2], ['Reference checks', 3, 1], ['Recommendation and negotiation support', 5, 1]]]], r: ['c_vendor', 'c_signoff', 'c_scope'] },
      { id: 'tech-erp', n: 'ERP or core system implementation', dr: 1700, o: 'Implement the new system on time, with clean data, trained users and a smooth go-live.', d: 'Solution design; configured system; migrated data; tested integrations; trained users; go-live and hypercare', ph: [
        ['Design', [['Process design workshops', 10, 2], ['Solution design sign-off', 3, 1]]], ['Build', [['Configuration and build', 30, 3], ['Data migration', 15, 2], ['Integrations', 15, 2]]],
        ['Test', [['System and integration testing', 10, 2], ['User acceptance testing', 10, 2]]], ['Deploy', [['End-user training', 5, 2], ['Go-live and cutover', 3, 3], ['Hypercare', 15, 1]]]], r: ['c_vendor', 'c_quality', 'c_adopt', 'c_scope', 'c_keyperson'] },
      { id: 'tech-cyber', n: 'Cybersecurity and data protection review', dr: 1700, o: 'Find and fix security and privacy gaps before they become incidents.', d: 'Controls assessment (ISO 27001 / Essential Eight); vulnerability and penetration test results; privacy (PDPA / Privacy Act) review; remediation plan', ph: [
        ['Assessment', [['Policy and controls review (ISO 27001 / Essential Eight)', 6, 1], ['Vulnerability scan and penetration test', 8, 1], ['Privacy review (PDPA / Privacy Act)', 5, 1]]],
        ['Report', [['Findings and risk ratings', 4, 1], ['Remediation plan', 4, 1], ['Board briefing', 1, 1]]]], r: ['c_data', 'c_reg', 'c_people'] }] },
    { c: 'Project and program management', g: 1, items: [
      { id: 'ppm-pmo', n: 'PMO set-up', dr: 1600, o: 'Stand up a PMO that gives leaders one view of every project and consistent delivery.', d: 'PMO charter and operating model; PMBOK-based methodology and templates; governance and stage gates; Project Champ set up; trained project managers', ph: [
        ['Design', [['PMO charter and operating model', 6, 1], ['Methodology and templates (PMBOK)', 8, 1], ['Governance and stage gates', 4, 1]]], ['Tools', [['Project Champ set-up and reporting', 5, 1], ['Portfolio intake and prioritisation', 4, 1]]],
        ['Embed', [['Train the project managers', 4, 2], ['First portfolio review', 2, 1]]]], r: ['c_resist', 'c_adopt', 'c_people'] },
      { id: 'ppm-recovery', n: 'Project recovery (health check and turnaround)', dr: 1600, o: 'Get a troubled project back under control with a realistic re-plan and tight governance.', d: 'Health check report; root causes; re-plan and new baseline; recovery governance; lessons learned', ph: [
        ['Diagnose', [['Health check: schedule, cost, scope and risk', 6, 2], ['Stakeholder interviews', 4, 1], ['Root cause analysis', 3, 1]]], ['Recover', [['Re-plan and re-baseline', 5, 1], ['Recovery governance', 3, 1], ['Weekly recovery tracking (6 weeks)', 30, 0.5]]],
        ['Close', [['Lessons learned', 2, 1]]]], r: ['c_signoff', 'c_keyperson', 'c_budget'] },
      { id: 'ppm-program', n: 'Program management (several related projects)', dr: 1600, o: 'Deliver a group of related projects as one program, so the benefits arrive together.', d: 'Program charter and benefits map; integrated schedule and dependencies; steering committee; benefits review; closure report', ph: [
        ['Mobilise', [['Program charter and benefits map', 5, 1], ['Program schedule and dependencies', 5, 1], ['Governance board set-up', 3, 1]]], ['Deliver', [['Program delivery management (3 months)', 60, 1], ['Monthly steering committees', 60, 0.1]]],
        ['Close', [['Benefits review', 4, 1], ['Program closure report', 3, 1]]]], r: ['c_scope', 'c_vendor', 'c_keyperson', 'c_budget'] },
      { id: 'ppm-national', n: 'National program (e.g. national ID or e-government)', dr: 1600, o: 'Plan and deliver a national-scale program from feasibility through pilot to national rollout.', d: 'Feasibility study; business case; program plan and WBS; procurement; pilot; national rollout; evaluation', ph: [
        ['Initiation', [['Feasibility study', 15, 2], ['Business case and funding', 10, 2]]], ['Planning', [['Program plan and WBS', 10, 2], ['Procurement strategy and tenders', 30, 1]]],
        ['Delivery', [['Pilot rollout', 30, 3], ['National rollout', 90, 3]]], ['Closing', [['Evaluation and handover', 10, 2]]]], r: ['c_vendor', 'c_budget', 'c_reg', 'c_travel', 'c_resist'] }] },
    { c: 'Training and capacity building', g: 1, items: [
      { id: 'trn-pmp', n: 'PMP / CAPM exam preparation course', dr: 1400, o: 'Prepare a cohort to pass the PMP or CAPM exam first time.', d: 'Course materials and mock exams; 5-day course; coaching; results report', ph: [
        ['Prepare', [['Training needs and cohort set-up', 3, 1], ['Course materials and mock exams', 6, 1]]], ['Deliver', [['Classroom course (5 days)', 5, 1], ['Practice exams and coaching', 10, 0.5]]], ['Evaluate', [['Results and certificates', 2, 1]]]], r: ['c_people', 'c_travel'] },
      { id: 'trn-agile', n: 'Agile and Scrum training (CSM / PMI-ACP)', dr: 1400, o: 'Give teams practical agile skills they use on real work the next week.', d: 'Agile maturity check; course (2 to 3 days); team coaching; adoption report', ph: [
        ['Prepare', [['Agile maturity check', 3, 1], ['Tailored course and exercises', 4, 1]]], ['Deliver', [['Course delivery (3 days)', 3, 1], ['Team coaching in sprints', 15, 0.5]]], ['Evaluate', [['Adoption and feedback report', 2, 1]]]], r: ['c_adopt', 'c_people'] },
      { id: 'trn-esg', n: 'ESG awareness and reporting training', dr: 1400, o: 'Build ESG understanding from the board to the teams who collect and report the data.', d: 'Needs analysis; tailored ESG modules; board briefing; staff workshops; assessment report', ph: [
        ['Design', [['Needs analysis', 3, 1], ['Tailored ESG modules', 5, 1]]], ['Deliver', [['Board briefing', 1, 1], ['Staff workshops (3 cohorts)', 6, 1]]], ['Evaluate', [['Assessment and feedback report', 2, 1]]]], r: ['c_people', 'c_reg'] },
      { id: 'trn-academy', n: 'Capacity building program (train the trainer)', dr: 1400, o: 'Build in-house capability that lasts after the consultants leave.', d: 'Skills gap assessment; curriculum and learning paths; certified internal trainers; rollout; impact evaluation', ph: [
        ['Assess', [['Skills gap assessment', 8, 2]]], ['Build', [['Curriculum and learning paths', 10, 1], ['Train the trainers', 10, 2]]], ['Deliver', [['Rollout to staff', 30, 1], ['Mentoring', 30, 0.5]]], ['Evaluate', [['Impact evaluation', 5, 1]]]], r: ['c_keyperson', 'c_adopt', 'c_budget'] }] },
    { c: 'Strategic planning', g: 1, items: [
      { id: 'stp-plan', n: 'Corporate strategic plan (3 to 5 years)', dr: 2000, o: 'Agree where the organisation is heading and the few initiatives that will get it there.', d: 'Environmental scan (PESTEL); SWOT and competitor analysis; vision, mission and objectives; strategic initiatives and KPIs; implementation plan', ph: [
        ['Analyse', [['Environmental scan (PESTEL)', 5, 1], ['Interviews with leaders', 5, 2], ['SWOT and competitor analysis', 5, 1]]], ['Formulate', [['Strategy workshops', 3, 2], ['Vision, mission and objectives', 4, 1], ['Strategic initiatives and KPIs', 5, 1]]],
        ['Plan', [['Implementation plan and budget', 5, 1], ['Board approval', 2, 1]]]], r: ['c_people', 'c_signoff', 'c_scope'] },
      { id: 'stp-feasibility', n: 'Feasibility study and business case', dr: 2000, o: 'Decide whether an investment stacks up, with the numbers to back it.', d: 'Market and demand study; technical options; financial model (NPV, IRR); risk and sensitivity analysis; feasibility report', ph: [
        ['Research', [['Market and demand study', 10, 2], ['Technical options', 6, 1]]], ['Analyse', [['Financial model (NPV, IRR)', 8, 1], ['Risk and sensitivity analysis', 4, 1]]],
        ['Report', [['Feasibility report and recommendation', 6, 1], ['Investment committee presentation', 1, 1]]]], r: ['c_data', 'c_market', 'c_quality'] },
      { id: 'stp-national', n: 'National or sector strategy (e.g. e-commerce, ICT park)', dr: 2000, o: 'Shape a national or sector strategy that government and industry can act on.', d: 'Country benchmarks; consultation report; strategic thrusts and policies; implementation roles; strategy document', ph: [
        ['Discover', [['Benchmark other countries', 8, 2], ['Stakeholder consultations', 10, 2]]], ['Design', [['Strategic thrusts and policies', 10, 2], ['Implementing agencies and roles', 5, 1]]],
        ['Deliver', [['Strategy document', 10, 2], ['Ministerial launch', 2, 1]]]], r: ['c_people', 'c_signoff', 'c_travel', 'c_reg'] },
      { id: 'stp-okr', n: 'Strategy execution (balanced scorecard and OKRs)', dr: 2000, o: 'Turn the strategy into measurable goals that every division tracks.', d: 'Company OKRs; divisional scorecards; performance dashboard; quarterly business review', ph: [
        ['Translate', [['Strategy into OKRs', 5, 1], ['Scorecards for each division', 8, 2]]], ['Embed', [['Performance dashboard set-up', 5, 1], ['First quarterly business review', 2, 1]]]], r: ['c_adopt', 'c_resist'] }] },
    { c: 'Change management', g: 1, items: [
      { id: 'chg-transform', n: 'Organisational transformation', dr: 1600, o: 'Lead people through a major change so it sticks.', d: 'Change impact assessment; readiness analysis; change strategy and roadmap; communication plan; champions network; adoption report', ph: [
        ['Assess', [['Change impact assessment', 6, 1], ['Stakeholder and readiness analysis', 5, 1]]], ['Plan', [['Change strategy and roadmap', 5, 1], ['Communication plan', 4, 1]]],
        ['Deliver', [['Change champions network', 10, 1], ['Communications and engagement', 40, 0.5]]], ['Sustain', [['Adoption measurement', 5, 1], ['Reinforcement plan', 3, 1]]]], r: ['c_resist', 'c_adopt', 'c_keyperson'] },
      { id: 'chg-system', n: 'Change management for a system rollout (ADKAR)', dr: 1600, o: 'Make sure people are ready, able and willing to use the new system from day one.', d: 'ADKAR assessment; training needs analysis; communication and training plans; super-user network; adoption survey', ph: [
        ['Prepare', [['ADKAR assessment', 4, 1], ['Training needs analysis', 4, 1], ['Communication and training plans', 4, 1]]], ['Support', [['Super-user network', 10, 0.5], ['Go-live support', 5, 2]]], ['Measure', [['Adoption survey', 3, 1]]]], r: ['c_adopt', 'c_resist', 'c_vendor'] },
      { id: 'chg-restructure', n: 'Restructure and new operating model', dr: 1600, o: 'Move to a new structure fairly, with clear roles and minimal disruption.', d: 'Current structure review; target operating model; role mapping and job descriptions; consultation; transition plan', ph: [
        ['Design', [['Current structure review', 5, 1], ['Target operating model', 8, 2], ['Role mapping and job descriptions', 8, 1]]], ['Transition', [['Consultation process', 15, 0.5], ['Transition and implementation', 20, 1]]]], r: ['c_resist', 'c_reg', 'c_keyperson'] },
      { id: 'chg-culture', n: 'Culture and engagement program', dr: 1600, o: 'Shift culture and engagement with measurable results.', d: 'Culture survey; focus group findings; values and behaviours; leadership coaching; pulse survey results', ph: [
        ['Diagnose', [['Culture survey', 5, 1], ['Focus groups', 5, 1]]], ['Shape', [['Values and behaviours', 5, 1], ['Leadership coaching', 20, 0.5]]], ['Measure', [['Pulse survey', 3, 1]]]], r: ['c_resist', 'c_people'] }] },
    { c: 'Go-to-market', g: 1, items: [
      { id: 'gtm-entry', n: 'Market entry strategy (new country)', dr: 1700, o: 'Decide how to enter a new market, with whom, and what it will take.', d: 'Market sizing and segments; regulatory and licensing scan; competitor analysis; entry mode and partners; business plan', ph: [
        ['Research', [['Market sizing and segments', 8, 2], ['Regulatory and licensing scan', 5, 1], ['Competitor analysis', 5, 1]]], ['Strategy', [['Entry mode and partners', 5, 1], ['Pricing and channel strategy', 4, 1], ['Business plan and financials', 6, 1]]]], r: ['c_market', 'c_reg', 'c_travel'] },
      { id: 'gtm-partner', n: 'Partner and distributor search', dr: 1700, o: 'Find and sign the right local partners.', d: 'Partner criteria; screened long list; due diligence reports; introductions; partner agreement support', ph: [
        ['Search', [['Partner criteria', 3, 1], ['Long list and screening', 6, 1], ['Due diligence', 8, 1]]], ['Sign', [['Introductions and meetings', 10, 1], ['Partner agreement support', 5, 1]]]], r: ['c_market', 'c_travel'] },
      { id: 'gtm-launch', n: 'Product or service launch', dr: 1700, o: 'Launch with a clear message, ready sales teams and a measurable campaign.', d: 'Value proposition and messaging; launch plan; sales enablement kit; campaign; post-launch review', ph: [
        ['Prepare', [['Value proposition and messaging', 5, 1], ['Launch plan and calendar', 4, 1], ['Sales enablement', 5, 1]]], ['Launch', [['Launch campaign', 20, 1], ['Post-launch review', 3, 1]]]], r: ['c_market', 'c_budget'] },
      { id: 'gtm-tender', n: 'Government tender and bid support', dr: 1700, o: 'Submit a compliant, winning bid on time.', d: 'Bid/no-bid decision; bid plan and compliance matrix; solution and pricing; proposal; red team review', ph: [
        ['Qualify', [['Bid / no-bid decision', 1, 1], ['Bid plan and compliance matrix', 3, 1]]], ['Write', [['Solution and pricing', 8, 2], ['Write the proposal', 10, 2], ['Red team review', 3, 2]]], ['Submit', [['Final submission', 1, 1]]]], r: ['c_people', 'c_signoff'] }] },
    { c: 'Cloud projects', g: 1, items: [
      { id: 'cl-static', n: 'Static website hosting with a CDN', dr: 1700, o: 'Host a fast, secure and low-cost website on object storage behind a CDN, with HTTPS and automatic deployment.', d: 'Hosting design; storage bucket and CDN; custom domain and TLS certificate; WAF rules; deployment pipeline; runbook', ph: [
        ['Design', [['Requirements and hosting design', 2, 1], ['Domain, DNS and certificate plan', 1, 1]]], ['Build', [['Storage bucket and CDN distribution', 2, 1], ['HTTPS, custom domain and redirects', 1, 1], ['WAF and security headers', 1, 1], ['Deploy pipeline from Git', 2, 1]]],
        ['Go live', [['Performance and security tests', 1, 1], ['DNS cutover', 1, 0.5], ['Runbook and handover', 1, 1]]]], r: ['k_cost', 'k_sec'] },
      { id: 'cl-3tier', n: 'Three-tier web application (web, app, database)', dr: 1700, o: 'Run a highly available web application in the cloud: load-balanced web tier, auto-scaling app tier and a managed database.', d: 'Architecture and network design (VPC, subnets); load balancer; auto-scaling app tier; managed database with backups; monitoring and alerts; deployment pipeline; runbook', ph: [
        ['Design', [['Requirements and sizing', 3, 1], ['Architecture and network design (VPC, subnets, security groups)', 4, 1]]], ['Build', [['Network and IAM foundations', 3, 1], ['Web and app tiers with load balancer and auto-scaling', 6, 2], ['Managed database, backups and failover', 4, 1], ['Deployment pipeline', 3, 1]]],
        ['Test', [['Load and failover tests', 3, 1], ['Security review', 2, 1]]], ['Go live', [['Data migration and cutover', 2, 2], ['Monitoring, alerts and runbook', 2, 1], ['Hypercare', 5, 0.5]]]], r: ['k_down', 'k_sec', 'k_cost', 'k_skill'] },
      { id: 'cl-backup', n: 'Automatic cloud backup and disaster recovery', dr: 1700, o: 'Protect critical systems with automatic backups and a tested disaster recovery plan that meets the agreed RPO and RTO.', d: 'Business impact analysis (RPO/RTO); backup policies; cross-region copies; DR runbooks; DR test report', ph: [
        ['Assess', [['Business impact analysis and RPO/RTO targets', 4, 1], ['Inventory of systems and data', 3, 1]]], ['Design', [['Backup and DR strategy (backup and restore, pilot light, warm standby)', 4, 1]]],
        ['Build', [['Backup policies and vaults (immutable copies)', 4, 1], ['Cross-region replication', 3, 1], ['DR automation and runbooks', 5, 1]]], ['Test', [['DR test (failover and failback)', 3, 2], ['DR test report and fixes', 2, 1]]]], r: ['k_down', 'k_cost', 'k_comp'] },
      { id: 'cl-cicd', n: 'CI/CD pipeline for microservices', dr: 1700, o: 'Ship every microservice safely and often: automated build, test, security scan and deployment for each service.', d: 'Branching and release strategy; pipeline templates; automated tests and security scans; artefact registry; blue-green or canary deployments; dashboards', ph: [
        ['Design', [['Current delivery process review', 2, 1], ['Branching, release and environment strategy', 2, 1]]], ['Build', [['Pipeline templates (build, test, scan)', 5, 1], ['Artefact and container registry', 1, 1], ['Deployment stages with approvals', 4, 1], ['Blue-green or canary releases', 3, 1]]],
        ['Roll out', [['Onboard the microservices', 6, 1], ['DORA metrics dashboard', 2, 1], ['Team training', 2, 1]]]], r: ['k_skill', 'k_sec', 'c_adopt'] },
      { id: 'cl-iac', n: 'Infrastructure as Code (Terraform)', dr: 1700, o: 'Define the whole cloud environment in code so it is repeatable, reviewed and versioned.', d: 'IaC standards and module library; remote state and locking; environments as code; policy checks; pipeline for plan and apply; documentation', ph: [
        ['Design', [['Current environment review', 3, 1], ['IaC standards, module structure and state design', 3, 1]]], ['Build', [['Reusable modules (network, compute, data, IAM)', 8, 1], ['Import existing resources', 4, 1], ['Policy as code checks', 2, 1], ['Plan and apply pipeline', 3, 1]]],
        ['Handover', [['Documentation and training', 2, 1]]]], r: ['k_skill', 'k_sec', 'k_legacy'] },
      { id: 'cl-k8s', n: 'Containerised app deployment on managed Kubernetes (EKS, AKS, GKE)', dr: 1700, o: 'Run the applications as containers on managed Kubernetes, with autoscaling, observability and secure deployments.', d: 'Containerised services; cluster design; ingress, TLS and secrets; Helm charts or GitOps; autoscaling; logging, metrics and tracing; runbooks', ph: [
        ['Design', [['Application assessment for containers', 3, 1], ['Cluster and network design', 3, 1]]], ['Build', [['Containerise the services (Dockerfiles)', 6, 1], ['Managed cluster and node pools', 3, 1], ['Ingress, TLS and secrets', 2, 1], ['Helm charts and GitOps deployments', 4, 1], ['Autoscaling and resource limits', 2, 1]]],
        ['Operate', [['Logging, metrics and tracing', 3, 1], ['Load and resilience tests', 3, 1], ['Go-live and hypercare', 5, 0.5], ['Runbooks and training', 2, 1]]]], r: ['k_skill', 'k_cost', 'k_sec', 'k_legacy'] },
      { id: 'cl-migrate', n: 'On-premises to cloud migration', dr: 1700, o: 'Move workloads from the data centre to the cloud in planned waves, with minimal downtime and lower running costs.', d: 'Discovery and dependency map; 7R decision per application; landing zone; wave plan; migrated workloads; decommissioning plan; cost comparison', ph: [
        ['Discover', [['Discovery and dependency mapping', 8, 2], ['7R assessment (rehost, replatform, refactor ...)', 5, 1], ['Business case and TCO', 4, 1]]], ['Prepare', [['Landing zone and connectivity', 8, 1], ['Wave plan and runbooks', 4, 1], ['Pilot migration', 5, 2]]],
        ['Migrate', [['Wave 1 migration', 10, 2], ['Wave 2 migration', 10, 2], ['Wave 3 migration', 10, 2]]], ['Optimise', [['Right-sizing and cost optimisation', 4, 1], ['Decommission old servers', 3, 1]]]], r: ['k_down', 'k_legacy', 'k_cost', 'c_data', 'k_skill'] },
      { id: 'cl-events', n: 'Event-driven serverless data pipeline', dr: 1700, o: 'Process data as it arrives with an event-driven, serverless pipeline that scales automatically and costs nothing when idle.', d: 'Event and data model; ingestion (queues, streams); serverless processing functions; data lake storage; error handling and replays; monitoring; cost model', ph: [
        ['Design', [['Event and data model', 3, 1], ['Pipeline architecture (queues, streams, functions)', 3, 1]]], ['Build', [['Ingestion and event bus', 3, 1], ['Processing functions', 5, 1], ['Data lake storage and catalogue', 3, 1], ['Dead-letter queues and replays', 2, 1]]],
        ['Test', [['Load and failure tests', 3, 1], ['Monitoring and cost alerts', 2, 1]]], ['Go live', [['Go-live and handover', 2, 1]]]], r: ['k_cost', 'c_quality', 'k_skill'] },
      { id: 'cl-network', n: 'Multi-cloud or hybrid cloud networking', dr: 1700, o: 'Connect data centres and cloud providers securely and reliably, with one addressing plan and central routing and DNS.', d: 'Network and IP addressing design; VPN or private links (Direct Connect, ExpressRoute); transit hub; DNS; firewall policies; monitoring', ph: [
        ['Design', [['Current network review', 3, 1], ['IP addressing, routing and DNS design', 4, 1]]], ['Build', [['Site-to-site VPN and private links', 5, 1], ['Transit hub and routing', 4, 1], ['Hybrid DNS', 2, 1], ['Firewall and segmentation policies', 3, 1]]],
        ['Test', [['Failover and performance tests', 3, 1]]], ['Handover', [['Monitoring, runbooks and handover', 2, 1]]]], r: ['k_down', 'k_sec', 'c_vendor', 'k_quota'] },
      { id: 'cl-cspm', n: 'Cloud security posture management (CSPM)', dr: 1700, o: 'Find and fix cloud misconfigurations continuously, against CIS benchmarks and the organisation\'s policies.', d: 'CSPM tool set-up across accounts; CIS benchmark baseline; findings report by risk; remediation of critical findings; alerting and reporting; operating process', ph: [
        ['Assess', [['Accounts and subscriptions inventory', 2, 1], ['CSPM tool selection and set-up', 3, 1], ['Baseline scan against CIS benchmarks', 2, 1]]], ['Remediate', [['Findings report and risk ratings', 3, 1], ['Fix critical and high findings', 8, 1], ['Guardrails to stop repeats', 3, 1]]],
        ['Operate', [['Alerting, dashboards and monthly report', 2, 1], ['Operating process and handover', 2, 1]]]], r: ['k_sec', 'k_comp', 'c_people'] },
      { id: 'cl-zerotrust', n: 'Zero Trust network', dr: 1700, o: 'Move from a trusted network to Zero Trust: verify every user, device and request, and give least-privilege access to each application.', d: 'Zero Trust maturity assessment; identity and MFA; device posture; ZTNA replacing VPN; micro-segmentation; logging and monitoring; roadmap', ph: [
        ['Assess', [['Zero Trust maturity assessment', 4, 1], ['Users, apps and data flows map', 3, 1]]], ['Design', [['Target architecture and roadmap', 4, 1]]],
        ['Implement', [['Identity, single sign-on and MFA', 5, 1], ['Device posture checks', 3, 1], ['ZTNA for priority apps (replacing VPN)', 6, 1], ['Micro-segmentation', 5, 1]]], ['Operate', [['Logging, monitoring and policy review', 3, 1], ['User communication and training', 2, 1]]]], r: ['k_sec', 'c_resist', 'c_adopt', 'k_legacy'] },
      { id: 'cl-landing', n: 'Cloud landing zone and governance (Well-Architected)', dr: 1700, o: 'Set up a secure, governed multi-account cloud foundation that every future workload can land on.', d: 'Account and subscription structure; identity and access; network hub; guardrails and policies; logging and security baseline; tagging and cost governance; Well-Architected review', ph: [
        ['Design', [['Requirements and Well-Architected review', 3, 1], ['Account structure, identity and network design', 4, 1]]], ['Build', [['Accounts, organisation and SSO', 3, 1], ['Network hub and shared services', 4, 1], ['Guardrails, logging and security baseline', 4, 1], ['Tagging and cost governance', 2, 1]]],
        ['Handover', [['Documentation and training', 2, 1]]]], r: ['k_sec', 'k_comp', 'k_skill'] },
      { id: 'cl-finops', n: 'Cloud cost optimisation (FinOps) review', dr: 1700, o: 'Cut cloud spend without hurting performance, and set up the habits that keep it down.', d: 'Spend analysis; right-sizing and idle resources; savings plans and reservations; storage tiering; tagging and showback; FinOps operating model; savings report', ph: [
        ['Analyse', [['Billing data and spend analysis', 3, 1], ['Tagging and allocation review', 2, 1]]], ['Optimise', [['Right-size and remove idle resources', 4, 1], ['Savings plans and reservations', 2, 1], ['Storage tiering and lifecycle rules', 2, 1]]],
        ['Embed', [['Budgets, alerts and showback dashboards', 2, 1], ['FinOps operating model and savings report', 2, 1]]]], r: ['k_cost', 'c_data', 'c_resist'] },
      { id: 'cl-serverless', n: 'Serverless API (API gateway and functions)', dr: 1700, o: 'Build an API that scales on demand and costs little when quiet, using an API gateway, functions and a managed database.', d: 'API design (OpenAPI); gateway, authentication and throttling; functions; managed NoSQL or SQL database; tests; monitoring; pipeline', ph: [
        ['Design', [['API design (OpenAPI) and data model', 3, 1]]], ['Build', [['API gateway, authentication and throttling', 3, 1], ['Functions for each endpoint', 6, 1], ['Managed database', 2, 1], ['Deployment pipeline', 2, 1]]],
        ['Test', [['Load and security tests', 3, 1]]], ['Go live', [['Monitoring, go-live and handover', 2, 1]]]], r: ['k_cost', 'k_sec', 'k_quota'] },
      { id: 'cl-data', n: 'Cloud data platform (data lake and analytics)', dr: 1700, o: 'Bring the organisation\'s data into one governed cloud platform for reporting, analytics and AI.', d: 'Data platform architecture; ingestion from source systems; lakehouse or warehouse; data quality and catalogue; access controls; dashboards; operating model', ph: [
        ['Design', [['Data sources and use cases', 4, 1], ['Platform architecture (lakehouse or warehouse)', 4, 1]]], ['Build', [['Ingestion from priority sources', 8, 2], ['Modelling and transformations', 8, 1], ['Data quality checks and catalogue', 4, 1], ['Access controls and governance', 3, 1]]],
        ['Deliver', [['First dashboards', 5, 1], ['Training and operating model', 3, 1]]]], r: ['c_quality', 'k_comp', 'k_cost', 'c_data'] },
      { id: 'cl-observe', n: 'Observability and SRE (monitoring, logging, tracing)', dr: 1700, o: 'See what is happening in every system, find problems before users do, and agree reliability targets (SLOs).', d: 'Observability architecture; logs, metrics and traces (OpenTelemetry); dashboards; SLOs and error budgets; alerting and on-call; incident runbooks', ph: [
        ['Design', [['Current monitoring review', 2, 1], ['Observability architecture (OpenTelemetry)', 3, 1]]], ['Build', [['Logs, metrics and traces collection', 5, 1], ['Dashboards for each service', 3, 1], ['SLOs and error budgets', 3, 1], ['Alerting and on-call', 2, 1]]],
        ['Embed', [['Incident runbooks and game day', 3, 1], ['Training and handover', 2, 1]]]], r: ['k_skill', 'k_cost', 'c_adopt'] }] },
    { c: 'General and fun projects (learn project management)', g: 1, fun: 1, items: [
      { id: 'fun-birthday', n: 'Birthday party', o: 'Throw a memorable birthday party on the day, within budget, with everyone looked after.', d: 'Guest list; venue; invitations; food and cake; decorations; run sheet for the day', ph: [
        ['Plan', [['Guest list and theme', 2, 0, 0], ['Book the venue', 3, 0, 400]]], ['Prepare', [['Send invitations and track RSVPs', 10, 0, 30], ['Order food and cake', 2, 0, 900], ['Decorations and party bags', 3, 0, 250], ['Music and games', 2, 0, 150]]],
        ['The day', [['Set up the venue', 1, 0, 0], ['Party time', 1, 0, 0], ['Pack down and clean up', 1, 0, 0]], 'seq']], r: ['f_budget', 'f_rsvp', 'f_vendor', 'f_weather'] },
      { id: 'fun-wedding', n: 'Wedding', o: 'Plan a wedding that feels like the couple, on the date, within the agreed budget.', d: 'Budget and guest list; venue and celebrant; suppliers booked; invitations; run sheet; thank-you cards', ph: [
        ['Plan', [['Budget and guest list', 5, 0, 0], ['Book the venue and date', 10, 0, 12000], ['Book the celebrant', 5, 0, 900]]],
        ['Suppliers', [['Caterer and menu tasting', 10, 0, 15000], ['Photographer and videographer', 5, 0, 4500], ['Music or DJ', 5, 0, 2000], ['Flowers and styling', 5, 0, 3500], ['Attire and rings', 20, 0, 6000]]],
        ['Guests', [['Save the dates and invitations', 15, 0, 600], ['RSVPs and seating plan', 20, 0, 0]]],
        ['The day', [['Final run sheet and supplier briefing', 3, 0, 0], ['Rehearsal', 1, 0, 0], ['Wedding day', 1, 0, 0]], 'seq'], ['After', [['Pay final invoices', 3, 0, 0], ['Thank-you cards', 7, 0, 200]]]], r: ['f_budget', 'f_vendor', 'f_rsvp', 'f_weather', 'f_ill'] },
      { id: 'fun-holiday', n: 'Family holiday', o: 'Take a relaxed family holiday that everyone enjoys, with no travel surprises.', d: 'Destination and budget; travel and stay booked; documents ready; itinerary; packing list', ph: [
        ['Plan', [['Pick destination and dates', 3, 0, 0], ['Set the budget', 1, 0, 0]]], ['Book', [['Flights', 2, 0, 3200], ['Accommodation', 2, 0, 2800], ['Travel insurance', 1, 0, 250], ['Passports and visas check', 10, 0, 0]]],
        ['Prepare', [['Day-by-day itinerary', 3, 0, 0], ['Packing list and pet or house care', 3, 0, 150]]], ['Travel', [['Holiday', 7, 0, 1500]]]], r: ['f_budget', 'f_ill', 'f_weather', 'f_time'] },
      { id: 'fun-move', n: 'Moving house', o: 'Move into the new home on the planned day, with nothing lost or broken.', d: 'Moving date; removalist booked; packing done; utilities and address changed; old place cleaned', ph: [
        ['Plan', [['Set the moving date', 1, 0, 0], ['Get removalist quotes and book', 5, 0, 1800]]], ['Prepare', [['Declutter and donate', 10, 0, 0], ['Packing boxes and materials', 1, 0, 150], ['Pack room by room', 10, 0, 0], ['Connect utilities and internet at the new place', 5, 0, 200], ['Change address (bank, licence, mail)', 3, 0, 0]]],
        ['Move', [['Moving day', 1, 0, 0], ['Unpack the essentials', 2, 0, 0]], 'seq'], ['Close', [['End-of-lease clean', 1, 0, 450]]]], r: ['f_vendor', 'f_time', 'f_budget'] },
      { id: 'fun-fundraiser', n: 'Charity or community fundraiser', o: 'Run a community event that meets its fundraising target and leaves everyone wanting to come back.', d: 'Target and permits; venue; sponsors; promotion; volunteers; the event; results report', ph: [
        ['Plan', [['Set the target and date', 2, 0, 0], ['Council permit and insurance', 10, 0, 350], ['Book the venue', 3, 0, 600]]], ['Prepare', [['Find sponsors and prizes', 15, 0, 0], ['Promote (posters, social media)', 15, 0, 200], ['Recruit and brief volunteers', 10, 0, 100], ['Stalls, food and equipment', 5, 0, 800]]],
        ['Event', [['Set up', 1, 0, 0], ['Event day', 1, 0, 0], ['Count and bank the money', 1, 0, 0]], 'seq'], ['Close', [['Thank sponsors and share results', 3, 0, 0]]]], r: ['f_rsvp', 'f_weather', 'f_vendor', 'f_budget'] },
      { id: 'fun-garden', n: 'Backyard or room makeover (DIY)', o: 'Finish a DIY makeover on time and on budget, and learn how to plan the work.', d: 'Design idea; shopping list; tools; finished makeover; before and after photos', ph: [
        ['Plan', [['Measure and sketch the design', 2, 0, 0], ['Shopping list and budget', 1, 0, 0]]], ['Prepare', [['Buy materials', 2, 0, 1200], ['Hire or borrow tools', 1, 0, 150]]],
        ['Do it', [['Clear and prepare the area', 2, 0, 0], ['Build or paint', 4, 0, 0], ['Plants, furniture and finishing touches', 2, 0, 400]], 'seq'], ['Close', [['Clean up and take before and after photos', 1, 0, 0]]]], r: ['f_budget', 'f_weather', 'f_time'] }] },
    { c: 'Bathroom', items: [
      { id: 'bathroom', n: 'Waterproofing & retiling', legacy: 'bathroom' },
      { id: 'bath-reno', n: 'Full bathroom renovation', m: 6500, s: [St('Strip-out & rubbish removal', 2, 16, 'h', 55, [['Remove fixtures', 0, 1], ['Remove tiles and screed', 0, 2], ['Rubbish removal', 1, 1]]), St('Plumbing & electrical rough-in', 2, 1, 'lot', 2400, [['Plumber rough-in', 0, 1], ['Electrician rough-in', 1, 1]]), St('Wall sheeting & set', 2, 1, 'lot', 1400), St('Screed & falls', 1, 8, 'h', 85), St('Waterproofing membrane', 2, 1, 'lot', 950, [['Primer and bond breaker', 0, 1], ['Membrane, two coats', 0, 2]]), St('Flood test (24 h) & photos', 1, 1, 'h', 90), St('Wall & floor tiling', 4, 32, 'h', 85, [['Floor tiles', 0, 1], ['Wall tiles', 1, 3]]), St('Fit-off: vanity, toilet, tapware, screen', 2, 1, 'lot', 1600), St('Paint ceiling & touch-ups', 1, 6, 'h', 70)], r: ['hidden', 'asbestos', 'supply', 'cure', 'licensed'] },
      { id: 'shower-leak', n: 'Shower leak repair (no full strip-out)', m: 600, s: [St('Find the leak (moisture readings, water test)', 1, 3, 'h', 90), St('Remove grout & silicone, regrout or reseal', 1, 8, 'h', 85), St('Replace damaged tiles at the hob / floor waste', 1, 6, 'h', 85), St('Water test & photos', 1, 1, 'h', 90)], r: ['leak', 'hidden', 'supply'] },
      { id: 'exhaust-fan', n: 'Exhaust fan repair or replacement', m: 250, s: [St('Isolate power & remove the old fan', 1, 1, 'h', 110), St('Install the new fan and duct it outside', 1, 3, 'h', 110, [['Cut or enlarge the ceiling opening', 0, 1], ['Duct to eave or roof', 0, 1], ['Wire and test', 0, 1]]), St('Patch & paint the ceiling', 1, 3, 'h', 70)], r: ['licensed', 'access', 'asbestos'] },
      { id: 'vanity', n: 'Vanity, toilet or tapware replacement', m: 1200, s: [St('Disconnect & remove old fittings', 1, 3, 'h', 110), St('Install new vanity / toilet / tapware', 1, 6, 'h', 110), St('Silicone, test for leaks & clean', 1, 2, 'h', 85)], r: ['licensed', 'supply', 'hidden'] }] },
    { c: 'Kitchen', items: [
      { id: 'kitchen-reno', n: 'Full kitchen renovation', m: 12000, s: [St('Strip-out & rubbish removal', 2, 16, 'h', 55), St('Plumbing & electrical rough-in', 2, 1, 'lot', 2200), St('Wall repairs & set', 1, 8, 'h', 80), St('Install cabinets', 2, 16, 'h', 75), St('Benchtop template, make & install', 6, 1, 'lot', 3500, [['Template', 0, 1], ['Fabrication (supplier)', 1, 4], ['Install', 5, 1]]), St('Splashback tiling', 1, 8, 'h', 85), St('Appliances & fit-off', 1, 1, 'lot', 900), St('Paint & touch-ups', 1, 8, 'h', 70)], r: ['supply', 'hidden', 'licensed', 'dust'] },
      { id: 'splashback', n: 'Splashback tiling', m: 600, s: [St('Prepare walls & set out', 1, 4, 'h', 85), St('Tile splashback', 1, 6, 'h', 85), St('Grout, silicone & clean', 1, 3, 'h', 85)], r: ['supply', 'finish'] },
      { id: 'benchtop', n: 'Benchtop replacement', m: 3000, s: [St('Measure & template', 1, 2, 'h', 90), St('Fabrication (supplier)', 5, 1, 'lot', 0), St('Remove old & install new benchtop', 1, 6, 'h', 75), St('Reconnect sink & cooktop', 1, 1, 'lot', 450)], r: ['supply', 'licensed'] }] },
    { c: 'Laundry', items: [
      { id: 'laundry-reno', n: 'Laundry renovation', m: 4000, s: [St('Strip-out', 1, 8, 'h', 55), St('Plumbing rough-in', 1, 1, 'lot', 1200), St('Waterproofing', 2, 1, 'lot', 600), St('Tiling', 2, 16, 'h', 85), St('Cabinets, tub & fit-off', 2, 1, 'lot', 1400)], r: ['hidden', 'cure', 'licensed'] },
      { id: 'laundry-tub', n: 'Tub or cabinet replacement', m: 900, s: [St('Remove old tub / cabinet', 1, 2, 'h', 110), St('Install new & connect', 1, 4, 'h', 110), St('Silicone & test', 1, 1, 'h', 85)], r: ['licensed', 'supply'] }] },
    { c: 'Waterproofing', items: [
      { id: 'balcony', n: 'Balcony remediation (concrete cancer)', legacy: 'balcony' },
      { id: 'wp-balcony', n: 'Balcony membrane & retile', m: 2500, a: ['strata'], s: [St('Remove tiles & screed', 2, 16, 'h', 55), St('Repair substrate & new screed with falls', 2, 16, 'h', 85), St('Membrane & upturns', 2, 1, 'lot', 1400, [['Primer', 0, 1], ['Membrane, two coats', 0, 2]]), St('Flood test & photos', 1, 1, 'h', 90), St('Retile balcony', 3, 24, 'h', 85)], r: ['weather', 'hidden', 'cure', 'approval', 'leak'] },
      { id: 'wp-planter', n: 'Planter box waterproofing', m: 900, s: [St('Empty planter & remove soil', 1, 8, 'h', 55), St('Prepare & membrane', 2, 1, 'lot', 700), St('Drainage cell & geofabric', 1, 4, 'h', 55), St('Refill soil & replant', 1, 6, 'h', 55)], r: ['weather', 'cure', 'leak'] },
      { id: 'wp-retaining', n: 'Retaining wall / basement waterproofing', m: 2200, s: [St('Excavate behind wall', 2, 16, 'h', 55), St('Clean & apply membrane', 2, 1, 'lot', 1500), St('Ag pipe & drainage', 1, 8, 'h', 55), St('Backfill & compact', 1, 8, 'h', 55)], r: ['weather', 'services', 'leak'] }] },
    { c: 'Remedial & concrete repair', items: [
      { id: 'concrete-cancer', n: 'Concrete cancer (spalling) repair', m: 1500, a: ['engineer'], s: [St('Break out spalled concrete', 1, 8, 'h', 85), St('Treat & prime steel', 1, 4, 'h', 85), St('Repair mortar & cure', 2, 1, 'lot', 900), St('Coating to match', 1, 6, 'h', 70)], r: ['structure', 'height', 'cure', 'weather'] },
      { id: 'crack-repair', n: 'Crack injection & repair', m: 500, s: [St('Inspect & mark cracks', 1, 2, 'h', 90), St('Inject / fill cracks', 1, 6, 'h', 85), St('Render & paint to match', 1, 6, 'h', 70)], r: ['structure', 'finish'] },
      { id: 'render-repair', n: 'Render repair & patching', m: 600, s: [St('Remove drummy render', 1, 6, 'h', 80), St('Re-render patches', 1, 8, 'h', 80), St('Paint to match', 1, 6, 'h', 70)], r: ['weather', 'finish', 'height'] }] },
    { c: 'Painting – interior', items: [
      { id: 'paint-house', n: 'Whole-house interior repaint', m: 1600, s: [St('Protect floors & furniture', 1, 6, 'h', 55), St('Patch, sand & prep', 2, 16, 'h', 70), St('Ceilings', 1, 8, 'h', 70), St('Walls two coats', 3, 24, 'h', 70, [['First coat', 0, 2], ['Second coat', 1, 2]]), St('Doors & trims', 2, 16, 'h', 70), St('Touch-ups & clean-up', 1, 6, 'h', 70)], r: ['finish', 'dust', 'access'] },
      { id: 'paint-room', n: 'One or two rooms', m: 400, s: [St('Protect & prep', 1, 4, 'h', 70), St('Ceiling & walls', 1, 8, 'h', 70), St('Trims & touch-ups', 1, 4, 'h', 70)], r: ['finish'] }] },
    { c: 'Painting – exterior', items: [
      { id: 'repaint', n: 'Full exterior repaint', legacy: 'repaint' },
      { id: 'paint-fence', n: 'Fence, deck or eaves painting', m: 500, s: [St('Wash & prep', 1, 6, 'h', 55), St('Prime / first coat', 1, 8, 'h', 70), St('Second coat', 1, 8, 'h', 70)], r: ['weather', 'finish'] }] },
    { c: 'Tiling', items: [
      { id: 'tile-floor', n: 'Floor tiling', m: 1800, s: [St('Remove old flooring', 1, 8, 'h', 55), St('Level & prepare floor', 1, 8, 'h', 85), St('Lay tiles', 3, 24, 'h', 85), St('Grout, silicone & clean', 1, 6, 'h', 85)], r: ['supply', 'hidden', 'finish'] },
      { id: 'tile-outdoor', n: 'Outdoor / alfresco tiling', m: 2200, s: [St('Prepare slab & falls', 1, 8, 'h', 85), St('Lay outdoor tiles', 3, 24, 'h', 85), St('Grout & seal', 1, 6, 'h', 85)], r: ['weather', 'supply', 'cure'] },
      { id: 'tile-feature', n: 'Wall / feature tiling', m: 900, s: [St('Prepare walls & set out', 1, 4, 'h', 85), St('Tile walls', 2, 12, 'h', 85), St('Grout, trims & clean', 1, 4, 'h', 85)], r: ['supply', 'finish'] }] },
    { c: 'Decking', items: [
      { id: 'deck-timber', n: 'Timber deck (new)', m: 6000, a: ['council'], s: [St('Set out & footings', 2, 16, 'h', 75, [['Set out', 0, 1], ['Dig & pour footings', 0, 2]]), St('Bearers & joists', 2, 16, 'h', 75), St('Decking boards', 2, 16, 'h', 75), St('Stairs & balustrade', 2, 16, 'h', 75), St('Oil / stain finish', 1, 6, 'h', 70)], r: ['weather', 'services', 'approval', 'supply'] },
      { id: 'deck-composite', n: 'Composite deck (new)', m: 9000, a: ['council'], s: [St('Set out & footings', 2, 16, 'h', 75), St('Steel or timber sub-frame', 2, 16, 'h', 75), St('Composite boards & fascia', 3, 24, 'h', 75), St('Stairs & balustrade', 2, 16, 'h', 75)], r: ['weather', 'services', 'approval', 'supply'] },
      { id: 'deck-repair', n: 'Deck repair & re-oil', m: 700, s: [St('Inspect & replace rotten boards / joists', 1, 8, 'h', 75), St('Sand & clean', 1, 8, 'h', 55), St('Oil, two coats', 1, 6, 'h', 70)], r: ['weather', 'hidden'] },
      { id: 'deck', n: 'Deck & pergola build', legacy: 'deck' }] },
    { c: 'Pergola & outdoor roof', items: [
      { id: 'pergola-timber', n: 'Timber pergola', m: 4500, a: ['council'], s: [St('Set out & footings', 2, 16, 'h', 75), St('Posts & beams', 2, 16, 'h', 75), St('Rafters & battens', 1, 8, 'h', 75), St('Roof sheets / cover', 1, 8, 'h', 75), St('Gutters & downpipe', 1, 6, 'h', 75)], r: ['weather', 'approval', 'height'] },
      { id: 'pergola-insulated', n: 'Insulated roof patio', m: 9000, a: ['council'], s: [St('Footings & posts', 2, 16, 'h', 75), St('Beam & brackets to house', 1, 8, 'h', 75), St('Insulated panels & flashing', 2, 16, 'h', 75), St('Gutters, downpipe & lights', 1, 1, 'lot', 900)], r: ['weather', 'approval', 'height', 'licensed'] }] },
    { c: 'Fencing & gates', items: [
      { id: 'fence-colorbond', n: 'Colorbond fence', m: 2500, s: [St('Remove old fence', 1, 8, 'h', 55), St('Dig & concrete posts', 1, 8, 'h', 75), St('Rails & panels', 1, 8, 'h', 75), St('Gate & clean-up', 1, 4, 'h', 75)], r: ['services', 'weather', 'access'] },
      { id: 'fence-timber', n: 'Timber paling fence', m: 2000, s: [St('Remove old fence', 1, 8, 'h', 55), St('Posts & rails', 1, 8, 'h', 75), St('Palings & capping', 2, 12, 'h', 75), St('Stain / paint (optional)', 1, 6, 'h', 70)], r: ['services', 'weather'] },
      { id: 'gate', n: 'Gate supply & install', m: 700, s: [St('Measure & order gate', 1, 1, 'h', 90), St('Install posts & gate', 1, 6, 'h', 75), St('Latch, adjust & test', 1, 2, 'h', 75)], r: ['supply'] }] },
    { c: 'Roofing & gutters', items: [
      { id: 'roof-leak', n: 'Roof leak repair', m: 400, s: [St('Find the leak (inspection, water test)', 1, 3, 'h', 90), St('Replace tiles / re-point / flashings', 1, 6, 'h', 90), St('Water test & photos', 1, 1, 'h', 90)], r: ['height', 'weather', 'leak'] },
      { id: 'gutters', n: 'Gutter & downpipe replacement', m: 1500, s: [St('Scaffold / edge protection', 1, 1, 'lot', 600), St('Remove old gutters', 1, 6, 'h', 75), St('Install gutters & downpipes', 2, 16, 'h', 75), St('Water test & clean-up', 1, 2, 'h', 75)], r: ['height', 'weather', 'supply'] },
      { id: 'roof-restore', n: 'Roof restoration', m: 2500, s: [St('Scaffold / edge protection', 1, 1, 'lot', 900), St('Pressure clean', 1, 8, 'h', 55), St('Replace broken tiles & re-point ridges', 2, 16, 'h', 90), St('Seal & two coats of roof paint', 2, 16, 'h', 80)], r: ['height', 'weather', 'finish'] }] },
    { c: 'Plastering & ceilings', items: [
      { id: 'plaster-patch', n: 'Patch & repair walls / ceilings', m: 250, s: [St('Cut out damaged areas', 1, 3, 'h', 80), St('Patch, set & sand', 2, 8, 'h', 80), St('Paint to match', 1, 4, 'h', 70)], r: ['dust', 'finish'] },
      { id: 'ceiling', n: 'Ceiling replacement', m: 1800, s: [St('Remove old ceiling', 1, 8, 'h', 55), St('Check / fix ceiling frame', 1, 6, 'h', 75), St('Sheet ceiling & cornice', 2, 16, 'h', 80), St('Set, sand & paint', 2, 16, 'h', 75)], r: ['asbestos', 'dust', 'hidden'] }] },
    { c: 'Flooring', items: [
      { id: 'floor-floating', n: 'Timber / laminate / hybrid floating floor', m: 3500, s: [St('Remove old flooring', 1, 8, 'h', 55), St('Level the subfloor', 1, 8, 'h', 75), St('Underlay & lay boards', 2, 16, 'h', 75), St('Skirting / trims & clean', 1, 6, 'h', 75)], r: ['supply', 'hidden', 'access'] },
      { id: 'floor-sand', n: 'Floor sanding & polishing', m: 800, s: [St('Prepare & punch nails', 1, 4, 'h', 70), St('Sand, three passes', 1, 8, 'h', 70), St('Stain & coat (3 coats)', 2, 12, 'h', 70)], r: ['cure', 'dust', 'finish'] }] },
    { c: 'Carpentry, doors & windows', items: [
      { id: 'doors', n: 'Doors (hang or replace)', m: 900, s: [St('Remove old doors', 1, 2, 'h', 75), St('Hang doors & fit hardware', 1, 8, 'h', 75), St('Paint / finish', 1, 6, 'h', 70)], r: ['supply'] },
      { id: 'windows', n: 'Window replacement', m: 3500, s: [St('Measure & order windows', 1, 2, 'h', 90), St('Supplier lead time', 10, 1, 'lot', 0), St('Remove old & install new windows', 2, 16, 'h', 75), St('Flash, seal & make good', 1, 8, 'h', 75)], r: ['supply', 'weather', 'hidden'] },
      { id: 'trims', n: 'Skirting, architraves & small carpentry', m: 400, s: [St('Remove & measure', 1, 4, 'h', 75), St('Cut & fix new trims', 1, 8, 'h', 75), St('Fill & paint', 1, 6, 'h', 70)], r: ['finish'] }] },
    { c: 'Concrete & paving', items: [
      { id: 'driveway', n: 'Concrete driveway', m: 4000, s: [St('Excavate & prepare base', 1, 8, 'h', 85), St('Formwork & mesh', 1, 8, 'h', 85), St('Pour & finish concrete', 1, 1, 'lot', 1800), St('Cure, saw cuts & clean-up', 3, 4, 'h', 85)], r: ['weather', 'services', 'cure'] },
      { id: 'pavers', n: 'Paving', m: 2500, s: [St('Excavate & compact base', 1, 8, 'h', 85), St('Screed sand & lay pavers', 2, 16, 'h', 85), St('Cut edges, sand joints & seal', 1, 8, 'h', 85)], r: ['weather', 'services', 'supply'] }] },
    { c: 'Plumbing repairs', items: [
      { id: 'plumb-leak', n: 'Find & fix a leak', m: 300, s: [St('Leak detection', 1, 2, 'h', 110), St('Repair pipe / fitting', 1, 3, 'h', 110), St('Make good walls or floor', 1, 6, 'h', 80)], r: ['licensed', 'hidden', 'leak'] },
      { id: 'hws', n: 'Hot water system replacement', m: 2200, s: [St('Remove old system', 1, 2, 'h', 110), St('Install & connect new system', 1, 4, 'h', 110), St('Test, compliance certificate & clean-up', 1, 1, 'h', 110)], r: ['licensed', 'supply'] },
      { id: 'drains', n: 'Blocked drain / stormwater', m: 400, s: [St('CCTV camera inspection', 1, 1, 'lot', 350), St('Clear or repair the drain', 1, 4, 'h', 110), St('Test & report', 1, 1, 'h', 110)], r: ['licensed', 'services', 'hidden'] }] },
    { c: 'Electrical', items: [
      { id: 'elec-lights', n: 'Lights & power points', m: 500, s: [St('Plan positions & isolate power', 1, 1, 'h', 110), St('Install lights / power points', 1, 6, 'h', 110), St('Test, tag & compliance certificate', 1, 1, 'h', 110)], r: ['licensed', 'asbestos'] },
      { id: 'switchboard', n: 'Switchboard upgrade', m: 1500, s: [St('Book power isolation', 2, 1, 'lot', 0), St('Replace switchboard & safety switches', 1, 8, 'h', 110), St('Test & compliance certificate', 1, 1, 'h', 110)], r: ['licensed', 'asbestos', 'approval'] }] },
    { c: 'Maintenance & handyman', items: [
      { id: 'maint-list', n: 'List of small repairs', m: 300, s: [St('Walk-through & agree the list', 1, 1, 'h', 90), St('Carry out repairs', 2, 12, 'h', 75), St('Customer check & sign-off', 1, 1, 'h', 90)], r: ['access', 'supply'] },
      { id: 'pre-sale', n: 'Pre-sale touch-up', m: 800, s: [St('Patch & repair', 1, 8, 'h', 75), St('Paint touch-ups', 2, 12, 'h', 70), St('Clean & photos', 1, 4, 'h', 55)], r: ['finish', 'access'] },
      { id: 'strata-visit', n: 'Strata maintenance visit', m: 200, a: ['strata'], s: [St('Inspect & report', 1, 3, 'h', 90), St('Carry out approved repairs', 1, 8, 'h', 75), St('Report with photos to strata', 1, 1, 'h', 90)], r: ['approval', 'access'] }] },
    { c: 'Demolition & strip-out', items: [
      { id: 'demo', n: 'Internal strip-out', m: 300, s: [St('Asbestos check', 1, 1, 'lot', 350), St('Strip-out', 2, 16, 'h', 55), St('Skip bin & rubbish removal', 1, 1, 'lot', 600)], r: ['asbestos', 'services', 'dust'] }] },
    { c: 'Extensions & structural', items: [
      { id: 'wall-removal', n: 'Remove a wall (structural)', m: 2500, a: ['engineer'], s: [St('Temporary props', 1, 4, 'h', 75), St('Remove wall', 1, 8, 'h', 55), St('Install beam & posts', 1, 8, 'h', 75), St('Make good: plaster, floor & paint', 3, 24, 'h', 75)], r: ['structure', 'asbestos', 'services', 'dust'] },
      { id: 'extension', n: 'Room extension / granny flat (large)', m: 45000, a: ['council', 'engineer'], s: [St('Site set-up & excavation', 3, 24, 'h', 85), St('Slab or footings', 4, 1, 'lot', 9000), St('Frame & roof', 8, 1, 'lot', 14000), St('Windows, doors & lock-up', 4, 1, 'lot', 8000), St('Rough-in: plumbing & electrical', 3, 1, 'lot', 6000), St('Insulation, plaster & fix-out', 8, 1, 'lot', 9000), St('Wet areas & tiling', 6, 1, 'lot', 7000), St('Painting & final fit-off', 5, 1, 'lot', 5000), St('Final inspection & occupation certificate', 2, 1, 'lot', 800)], r: ['approval', 'weather', 'supply', 'structure', 'licensed'] }] },
    { c: 'Landscaping & retaining walls', items: [
      { id: 'retaining', n: 'Retaining wall', m: 3500, s: [St('Excavate & set out', 1, 8, 'h', 85), St('Footing / base course', 1, 8, 'h', 85), St('Build wall (blocks or sleepers)', 2, 16, 'h', 85), St('Drainage & backfill', 1, 8, 'h', 55)], r: ['services', 'weather', 'structure'] },
      { id: 'garden', n: 'Garden makeover', m: 1500, s: [St('Clear & prepare', 1, 8, 'h', 55), St('Edging, soil & irrigation', 1, 8, 'h', 55), St('Plant & mulch', 1, 8, 'h', 55)], r: ['weather', 'services'] }] }
  ];
  var APPROVAL = { council: ['Council / CDC approval (check if needed)', 10], strata: ['Strata / owner approval', 5], engineer: ['Engineer inspection & design', 5] };
  function catalogItem(id) { var f = null; CATALOG.forEach(function (c) { c.items.forEach(function (i) { if (i.id === id) f = { cat: c.c, item: i }; }); }); return f; }
  // GKH consulting project types: kick-off, the phases (a milestone at the end of each), final presentation and acceptance; priced in consultant-days
  function buildConsult(f) {
    var it = f.item, fun = !it.dr, rows = [], n = 0, key = function () { return 'k' + (++n); }, dr = it.dr || 1600;
    var row = function (name, d, ppl, after, cost) { var k = key(); rows.push(cost != null ? [0, k, name, d, '', cost ? 1 : 0, cost ? 'lot' : '', cost || 0, after ? [after] : []] : [0, k, name, d, '', Math.round(d * ppl * 10) / 10, 'day', dr, after ? [after] : []]); return k; };
    var prev = fun ? row('Project charter: the goal, date and budget', 1, 0, '', 0) : row('Kick-off meeting and project charter', 2, 1, '');
    prev = fun ? row('Stakeholders: who is involved and who decides', 1, 0, prev, 0) : row('Data request and stakeholder map', 3, 1, prev);
    it.ph.forEach(function (ph, i) {
      var par = fun && ph[2] !== 'seq', ends = [], from = prev;   // fun projects: the tasks in a phase run side by side (book the caterer while the invitations go out)
      ph[1].forEach(function (t) { var k = row(t[0], t[1], t[2], par ? from : prev, fun ? t[3] : null); if (par) ends.push(k); else prev = k; });
      var km = key(); rows.push([0, km, '✓ Phase ' + (i + 1) + ' complete: ' + ph[0], 0, '', 0, '', 0, par ? ends : [prev]]); prev = km;
    });
    prev = fun ? row('Lessons learned: what went well, what to do differently', 1, 0, prev, 0) : row('Final presentation and handover', 2, 1, prev);
    rows.push([0, key(), fun ? 'Project closed: celebrate!' : 'Final acceptance and invoice', 0, '', 0, '', 0, [prev]]);
    var t = T(it.n, it.o, '', rows, (it.r || []).map(function (k) { return RISK[k]; }).filter(Boolean));
    t.deliverables = String(it.d || '').split(/;\s*/).map(function (x) { return '- ' + x.charAt(0).toUpperCase() + x.slice(1); }).join('\n');
    t.acceptance = fun ? 'The day went to plan, bills are paid, everyone has been thanked and the lessons are written down.' : 'Each deliverable reviewed and signed off by the client at its phase gate; final presentation given; final acceptance signed; invoice issued.';
    return t;
  }
  function buildTemplate(id) {
    var f = catalogItem(id); if (!f) return TEMPLATES.blank;
    var it = f.item;
    if (it.legacy) return TEMPLATES[it.legacy];
    if (it.ph) return buildConsult(f);
    var rows = [], n = 0, key = function () { return 'k' + (++n); };
    var k1 = key(); rows.push([0, k1, 'Site inspection & measure', 1, '', 2, 'h', 90, []]);
    var k2 = key(); rows.push([0, k2, 'Quote accepted', 0, '', 0, '', 0, [k1]]);
    var prev = k2;
    (it.a || []).forEach(function (a) { var k = key(); rows.push([0, k, APPROVAL[a][0], APPROVAL[a][1], '', a === 'engineer' ? 1 : 0, a === 'engineer' ? 'lot' : '', a === 'engineer' ? 1200 : 0, [prev]]); prev = k; });
    if (it.m) { var km = key(); rows.push([1, km, 'Order materials', 1, '', 1, 'lot', it.m, [prev]]); prev = km; }
    (it.s || []).forEach(function (s) { var k = key(); rows.push([2, k, s[0], s[1], '', s[2], s[3], s[4], [prev], s[5]]); prev = k; });
    var kq = key(); rows.push([3, kq, 'Quality inspection & defects', 1, '', 1, 'h', 90, [prev]]);
    var kh = key(); rows.push([4, kh, 'Clean-up & handover', 1, '', 3, 'h', 55, [kq]]);
    rows.push([4, key(), 'Invoice', 0, '', 0, '', 0, [kh]]);
    var name = /^(Full|Whole|One or two|List of|Find|Remove a|Internal)/.test(it.n) ? it.n : f.cat.replace(/ –.*/, '') + ': ' + it.n;
    return T(name, 'Complete the ' + it.n.toLowerCase() + ' safely and to standard, on time and on budget, and hand over a clean site.', '', rows,
      (it.r || []).map(function (k) { return RISK[k]; }).filter(Boolean));
  }

  /* ---------- status (board columns) and resources (people) ---------- */
  var STATUS = [['todo', 'To do', 0], ['doing', 'In progress', 33], ['review', 'In review / QA', 67], ['done', 'Done', 100]];
  var stPct = { todo: 0, doing: 33, review: 67, done: 100 }, stName = { todo: 'To do', doing: 'In progress', review: 'In review / QA', done: 'Done' };
  function statusFromPct(n) { return n >= 100 ? 'done' : n <= 0 ? 'todo' : n >= 67 ? 'review' : 'doing'; }
  function setStatus(t, k) { (t.subs || []).forEach(function (x) { x.status = k; x.pct = SUBP[k]; if ((x.steps || []).length) { if (k === 'done' || k === 'todo') x.steps.forEach(function (q) { q.done = k === 'done'; }); x.pct = stepPct(x); x.status = x.steps.every(function (q) { return q.done; }) ? 'done' : subStatus(x.pct); } }); t.status = k; t.pct = stPct[k]; if ((t.subs || []).some(function (x) { return (x.steps || []).length; })) derive(t); }
  // v85: dated steps inside a story: off / dur in working days from the story's start; ticked done or not; they drive the story's %
  function stepPct(x) { var L = x.steps || [], w = L.reduce(function (a, q) { return a + q.dur; }, 0) || 1; return Math.round(L.reduce(function (a, q) { return a + (q.done ? q.dur : 0); }, 0) / w * 100); }
  function fitSteps(x) {
    var D = Math.max(1, x.dur); x.steps = x.steps || [];
    x.steps.forEach(function (q) { q.off = Math.max(0, Math.min(D - 1, Math.round(+q.off || 0))); q.dur = Math.max(1, Math.min(D - q.off, Math.round(+q.dur || 1))); q.done = !!q.done; });
  }
  function stepDates(t, x, q) { var d = subDates(t, x); if (!d.es) return { es: '', ef: '' }; var es = q.off ? addWork(d.es, q.off) : d.es; return { es: es, ef: q.dur > 1 ? addWork(es, q.dur - 1) : es }; }
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
      fitSteps(x);
    });
    return moved;
  }
  // v67: a story's progress in quarters (0, 25, 50, 75, 100) set with the slider on the Board; its status follows. Where only the
  // status was changed (Schedule, ticking), the % follows the status.
  var SUBP = { todo: 0, doing: 25, review: 75, done: 100 };
  // v67: Gantt colours by progress: 0 grey, 25 amber, 50 blue, 75 purple, 100 green (late stays red)
  function pband(p) { p = +p || 0; return p >= 100 ? 100 : p >= 63 ? 75 : p >= 38 ? 50 : p > 0 ? 25 : 0; }
  function subStatus(p) { return p >= 100 ? 'done' : p >= 75 ? 'review' : p > 0 ? 'doing' : 'todo'; }
  function subPct(x) { if ((x.steps || []).length) return stepPct(x); var p = Math.round((+x.pct || 0) / 25) * 25; return x.pct != null && subStatus(p) === x.status ? p : SUBP[x.status] || 0; }
  function derive(t) {
    (t.subs || []).forEach(function (x) { x.pct = subPct(x); if ((x.steps || []).length) x.status = x.steps.every(function (q) { return q.done; }) ? 'done' : subStatus(x.pct); });
    if (!t.subs || !t.subs.length) return;
    var w = t.subs.reduce(function (a, x) { return a + x.dur; }, 0) || 1;
    t.pct = Math.round(t.subs.reduce(function (a, x) { return a + x.dur * subPct(x); }, 0) / w); t.status = statusFromPct(t.pct);
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
      if (!Array.isArray(t.mats)) t.mats = [];
      if (t.item && !t.mats.length) { t.mats = [{ item: t.item, qty: Number(t.qty) || 0, price: Number(t.rate) || 0 }]; t.qty = 0; t.rate = 0; t.unit = ''; }   // v56: older single stock item
      t.item = '';
      if (!Array.isArray(t.res)) t.res = t.resource ? String(t.resource).split(/\s*,\s*/).filter(Boolean) : [];
      fixRes(t);
      if (!stPct.hasOwnProperty(t.status) || (t.status === 'done') !== (t.pct >= 100)) t.status = statusFromPct(t.pct || 0);
      fitSubs(t); derive(t);
    });
    return p;
  }

  /* ---------- state + saving ---------- */
  var S = { colW: (function () { try { return JSON.parse(localStorage.getItem('mbsPlanColW') || '{}') || {}; } catch (e) { return {}; } })(),
    freeze: (function () { try { var v = localStorage.getItem('mbsPlanFreeze'); return v == null ? 3 : +v || 0; } catch (e) { return 3; } })(),
    split: (function () { try { return +localStorage.getItem('mbsPlanSplit') || 0; } catch (e) { return 0; } })(), closed: {}, stClosed: {}, kStOpen: {}, cols: (function () { try { return localStorage.getItem('mbsPlanCols') || 's'; } catch (e) { return 's'; } })(), core: '', plan: null, rev: 0, job: null, tab: 'schedule', zoom: 'day', saving: false, timer: null, reminders: [], expensesEx: 0 };
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
        if (plan.tasks.some(function (t) { return matsOf(t).length; })) loadInv().then(function () { if (S.plan === plan && (S.tab === 'schedule' || S.tab === 'overview' || S.tab === 'bom') && !S.timer && !document.activeElement.closest('#planBody')) render(); });
        if (r.low && r.low.length && M.inv) M.inv.prompt(r.low);
        var el = $('#planSave'); if (el && !S.timer) el.textContent = 'Saved ✓';
        if (S.chain && liveQuote(S.chain)) { clearTimeout(S.chainT); S.chainT = setTimeout(loadChain, 1500); }   // is the quote still in step with the plan?
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
  // GKH Project Champ: a project stands on its own (no CRM job needed). The form makes the project record, then opens its plan.
  function newProjectForm() {
    var can = !M.allowed || M.allowed('projects', 'edit');
    if (!can) { V().innerHTML = '<div class="card noaccess"><h2>🔒 View only</h2><p class="muted">Your login can look at projects but not start new ones.</p></div>'; return; }
    V().innerHTML = '<div class="card champ-new"><div class="card-h"><h2>＋ New project</h2><a class="btn btn-sm" href="#projects">← All projects</a></div>' +
      '<p class="muted">Give the project a name and a client. Next you pick a template (or a blank plan, or ✨ AI) and Project Champ builds the schedule, Gantt chart, Board, budget, risks and reports.</p>' +
      '<form id="champNew" class="champ-form">' +
      '<div class="champ-2"><label>Program <small class="muted">(every project belongs to one)</small><select name="progPick" required><option value="">Loading programs…</option></select></label>' +
      '<label class="champ-newprog" hidden>New program name<input name="program" maxlength="80" placeholder="e.g. Hospital redevelopment"></label></div>' +
      '<label>Project name<input name="name" required maxlength="120" placeholder="e.g. Head office fit-out, ERP rollout, Bridge deck repair"></label>' +
      '<p class="champ-fill" id="cnFill" hidden></p>' +
      '<label>Client<input name="client" required maxlength="120" placeholder="e.g. Acme Pty Ltd or Internal: Finance"></label>' +
      '<div class="champ-2"><label>Sponsor <small class="muted">(optional)</small><input name="sponsor" maxlength="80" placeholder="who backs the project"></label>' +
      '<label>Project manager <small class="muted">(optional)</small><input name="manager" maxlength="80"></label></div>' +
      '<div class="champ-2"><label>Site or location <small class="muted">(optional)</small><input name="site" maxlength="80" placeholder="e.g. Parramatta NSW"></label>' +
      '<label>Contact phone <small class="muted">(optional)</small><input name="phone" maxlength="40"></label></div>' +
      '<label>Contact email <small class="muted">(optional)</small><input name="email" type="email" maxlength="160"></label>' +
      '<label>What is the project about? <small class="muted">(the AI uses this to draft the plan)</small><textarea name="summary" rows="4" maxlength="1500" placeholder="Objective, scope, constraints, budget, key dates…"></textarea></label>' +
      '<fieldset class="champ-mods"><legend>Optional modules <small class="muted">(you can change these later with ⚙ Modules)</small></legend>' +
      '<label class="mod-row"><span><b>🧱 Bill of Materials (BOM)</b><small>For projects with materials to buy (construction, fit-outs, installs)</small></span><span class="bom-switch"><input type="checkbox" name="bom" checked><span class="bom-slider"></span></span></label>' +
      '<label class="mod-row"><span><b>🦺 SWMS</b><small>Safe Work Method Statements for high-risk construction work</small></span><span class="bom-switch"><input type="checkbox" name="swms" checked><span class="bom-slider"></span></span></label></fieldset>' +
      '<div class="actions"><button class="btn btn-gold" type="submit">Create project and plan it →</button></div></form></div>';
    var want = ''; try { want = sessionStorage.getItem('champNewProg') || ''; sessionStorage.removeItem('champNewProg'); } catch (e2) {}
    var pick = $('#champNew').progPick, newBox = $('#champNew .champ-newprog'), newIn = $('#champNew').program;
    // picking a program fills in what the program (or its latest project) already knows: client, sponsor, manager, email, phone, location.
    // Only empty boxes, or ones it filled itself before, are changed: anything typed stays.
    var F0 = $('#champNew'), FILL = ['client', 'sponsor', 'manager', 'email', 'phone', 'site'], LBL = { client: 'client', sponsor: 'sponsor', manager: 'project manager', email: 'email', phone: 'phone', site: 'location' };
    FILL.forEach(function (k) { F0[k].addEventListener('input', function () { F0[k].removeAttribute('data-auto'); F0[k].classList.remove('auto'); }); });
    var fillFrom = function (name) {
      var note = $('#cnFill');
      if (!name || name === '__new') { FILL.forEach(function (k) { if (F0[k].hasAttribute('data-auto')) { F0[k].value = ''; F0[k].removeAttribute('data-auto'); F0[k].classList.remove('auto'); } }); note.hidden = true; return; }
      api('planProgramDefaults', { name: name }).then(function (d) {
        if (pick.value !== name) return; var got = [];
        FILL.forEach(function (k) { var el = F0[k], v = d[k] || ''; if (el.value && !el.hasAttribute('data-auto')) return;
          el.value = v; if (v) { el.setAttribute('data-auto', '1'); el.classList.add('auto'); got.push(LBL[k]); } else { el.removeAttribute('data-auto'); el.classList.remove('auto'); } });
        note.hidden = !got.length;
        note.innerHTML = got.length ? '✨ Filled in from the <b>' + esc(d.program || name) + '</b> program' + (d.from.project && !d.from.program ? ' (its latest project, ' + esc(d.from.project) + ')' : d.from.project ? ' and its latest project' : '') + ': ' + esc(got.join(', ')) + '. Change anything that is different for this project.' : '';
      }).catch(function () {});
    };
    var syncProg = function () { var isNew = pick.value === '__new'; newBox.hidden = !isNew; newIn.required = isNew; if (isNew) setTimeout(function () { newIn.focus(); }, 30); fillFrom(pick.value); };
    pick.onchange = syncProg;
    (M.champPrograms ? M.champPrograms() : Promise.resolve([])).then(function (L) {
      pick.innerHTML = '<option value="">Choose a program…</option>' + L.map(function (x) { return '<option' + (x === want ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') + '<option value="__new">＋ New program…</option>';
      if (!want && L.length === 1) pick.value = L[0];
      syncProg();
    });
    $('#champNew').onsubmit = function (e) {
      e.preventDefault(); var f = e.target, b = f.querySelector('button[type=submit]'); b.disabled = true; b.textContent = 'Creating…';
      api('planNewProject', { name: f.name.value, client: f.client.value, site: f.site.value, phone: f.phone.value, email: f.email.value, summary: f.summary.value, sponsor: f.sponsor.value, manager: f.manager.value, program: f.progPick.value === '__new' ? f.program.value : f.progPick.value, bom: f.bom.checked, swms: f.swms.checked })
        .then(function (r) { toast('Project ' + r.ref + ' created'); location.hash = '#plan/' + r.core; })
        .catch(function (err) { fail(err); b.disabled = false; b.textContent = 'Create project and plan it →'; });
    };
  }
  // GKH Project Champ: the project list grouped by program, each group headed by its key (PG-002), so linked projects sit together
  function byProgram(plans) {
    var G = {}, order = [];
    plans.forEach(function (p) {
      var k = p.programKey || ('~' + (p.program || ''));
      if (!G[k]) { G[k] = { key: p.programKey || '', id: p.programId || '', name: p.program || '', color: p.programColor || '#64748B', list: [] }; order.push(k); }
      G[k].list.push(p);
    });
    return order.sort(function (a, b) { return a < b ? -1 : a > b ? 1 : 0; }).map(function (k) { return G[k]; });
  }
  function progRow(g) {
    if (!g.name) return '<tr class="pg-row"><td colspan="8"><b>Not in a program</b></td></tr>';
    var L = g.list, BAC = L.reduce(function (s, p) { return s + (p.BAC || 0); }, 0), hr = L.reduce(function (s, p) { return s + (p.highRisks || 0); }, 0);
    var fin = L.map(function (p) { return p.finish; }).filter(Boolean).sort().pop();
    var spis = L.map(function (p) { return p.SPI; }).filter(function (v) { return v != null; }), low = spis.length ? Math.min.apply(null, spis) : null;
    return '<tr class="pg-row" style="--pg:' + esc(g.color) + '"><td colspan="8"><div class="pg-rowin">' + (g.key ? '<span class="pgref">' + esc(g.key) + '</span>' : '') + '<b>' + esc(g.name) + '</b>' +
      '<small class="muted">' + L.length + ' project' + (L.length === 1 ? '' : 's') + (BAC ? ' · ' + money(BAC) + ' budget' : '') + (fin ? ' · last finish ' + esc(prettyY(fin)) : '') + (low != null ? ' · lowest SPI ' + low.toFixed(2) : '') + (hr ? ' · <b style="color:#C2410C">' + hr + ' high risk' + (hr === 1 ? '' : 's') + '</b>' : '') + '</small>' +
      '<span class="sp"></span>' + (g.id ? '<a class="btn btn-sm" href="#programs/' + esc(g.id) + '" title="Open the program: roadmap and dependencies">🔗 Program →</a>' : '') + '</div></td></tr>';
  }
  function projects(args) {
    if (args && args[0] === 'new') return newProjectForm();
    return api('planList', { today: today() }).then(function (d) {
      return api('planJobs', {}).then(function (j) {
        var avail = j.jobs;
        V().innerHTML = '<div class="card"><div class="card-h"><h2>Project plans (' + d.plans.length + ')</h2>' +
          '<div class="row">' + (avail.length ? '<select id="newPlanJob" style="width:auto;max-width:min(560px,100%)"><option value="">Plan an existing project…</option>' + avail.map(function (x) { return '<option value="' + esc(x.core) + '">' + esc(jobLabel(x)) + '</option>'; }).join('') + '</select><button class="btn btn-sm" id="newPlanGo">Plan it</button>' : '') + '<a class="btn btn-gold btn-sm" href="#projects/new">＋ New project</a></div></div><div id="jobPeek" hidden></div>' +
          (d.plans.length ? '<div class="table-wrap"><table><thead><tr><th>Project</th><th>Progress</th><th class="hide-sm">Finish</th><th title="Schedule Performance Index: work done ÷ work planned by today">SPI <small class="muted" style="text-transform:none;letter-spacing:0">(time)</small></th><th title="Cost Performance Index: value of work done ÷ actual cost">CPI <small class="muted" style="text-transform:none;letter-spacing:0">(cost)</small></th><th class="hide-sm">Risks</th><th class="hide-sm">Issues</th><th></th></tr></thead><tbody>' +
            byProgram(d.plans).map(function (g) {
              return progRow(g) + g.list.map(function (p) {
              return '<tr class="click' + (p.programKey ? ' pg-member' : '') + '" data-plan="' + esc(p.core) + '"' + (p.programKey ? ' style="--pg:' + esc(p.programColor || '#64748B') + '"' : '') + '><td><b>' + esc(p.name) + '</b><br><small class="muted"><span class="ref">' + esc(p.ref) + '</span>' + (p.programKey ? ' · <span class="pgref" style="--pg:' + esc(p.programColor || '#64748B') + '" title="Program: ' + esc(p.program) + '">' + esc(p.programKey) + '</span>' : '') + ' · ' + esc(p.customer) + '</small></td>' +
                '<td style="min-width:140px"><div class="pbar"><span style="width:' + p.pct + '%"></span></div><small>' + p.pct + '% · ' + p.done + '/' + p.total + ' tasks' + (p.late ? ' · <b style="color:#C2410C">' + p.late + ' late</b>' : '') + '</small></td>' +
                '<td class="hide-sm">' + esc(prettyY(p.finish)) + '</td><td class="evcell">' + evChip('SPI', p.SPI) + '</td><td class="evcell">' + evChip('CPI', p.CPI) + '</td>' +
                '<td class="hide-sm">' + p.openRisks + (p.highRisks ? ' <b style="color:#C2410C">(' + p.highRisks + ' high)</b>' : '') + '</td><td class="hide-sm">' + p.openIssues + '</td><td><button class="btn btn-sm" data-pdel="' + esc(p.core) + '" data-pname="' + esc(p.name) + '" title="Delete this project">🗑</button></td></tr>';
            }).join('');
            }).join('') + '</tbody></table></div>' + evLegend() : (avail.length ? '<div class="empty champ-empty"><b>' + avail.length + ' project' + (avail.length > 1 ? 's' : '') + ' waiting for a plan.</b><br>Pick one in “Plan an existing project…” above, or <a class="btn btn-gold btn-sm" href="#projects/new">＋ New project</a></div>' : '<div class="empty champ-empty"><b>No projects yet.</b><br>Start your first one: <a class="btn btn-gold btn-sm" href="#projects/new">＋ New project</a></div>')) + '</div>';
        V().querySelectorAll('[data-plan]').forEach(function (tr) { tr.onclick = function () { location.hash = '#plan/' + tr.getAttribute('data-plan'); }; });
        V().querySelectorAll('[data-pdel]').forEach(function (b) {
          b.onclick = function (e) {
            e.stopPropagation();
            M.champDelete([{ core: b.getAttribute('data-pdel'), name: b.getAttribute('data-pname') }]).then(function (ok) { if (ok) projects(); });   // GKH Project Champ: the whole project
          };
        });
        var byCore = {}; avail.forEach(function (x) { byCore[x.core] = x; });
        if ($('#newPlanJob')) $('#newPlanJob').onchange = function () { var x = byCore[this.value], el = $('#jobPeek'); el.hidden = !x; el.innerHTML = x ? jobPeek(x) : ''; };
        if ($('#newPlanGo')) $('#newPlanGo').onclick = function () { var c = $('#newPlanJob').value; if (!c) return toast('Pick a job first', true); location.hash = '#plan/' + c; };
      });
    });
  }

  /* "Plan a job…": say what the work is, and show the whole request before committing to a plan */
  var VAGUE = /question|fix-?it|enquir|inquir|^general$|^other$/i;
  function jobTag(x) {
    var t = (x.title || '').toLowerCase(), sv = (x.service || '').trim();
    if (sv && !VAGUE.test(sv) && t.indexOf(sv.toLowerCase()) < 0) return sv;
    return x.kind && x.kind !== 'Job' && t.indexOf(x.kind.toLowerCase()) < 0 ? x.kind : '';
  }
  function jobLabel(x) { var tag = jobTag(x); return x.ref + ' · ' + x.name + ': ' + (x.title || 'Job') + (tag ? ' [' + tag + ']' : '') + (x.suburb ? ' · ' + x.suburb : ''); }
  var STAGE_TXT = { new: 'New enquiry', called: 'Called', quoted: 'Quoted', won: 'Job won', completed: 'Completed', invoiced: 'Invoiced', paid: 'Paid', lost: 'Lost' };
  function jobPeek(x) {
    var d = x.created ? new Date(x.created) : null;
    var f = [['Service', x.service], ['Type', x.kind], ['Suburb', x.suburb], ['Stage', STAGE_TXT[x.stage] || x.stage], ['Received', d ? d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Australia/Sydney' }) : ''],
      ['Best time to call', x.bestTime], ['Came from', x.source], ['Photos', x.photos ? String(x.photos) : 'None']].filter(function (r) { return r[1]; });
    return '<div class="jobpeek"><div class="row" style="gap:10px"><span class="ref">' + esc(x.ref) + '</span><b>' + esc(x.name) + ': ' + esc(x.title) + '</b><span class="sp"></span><a class="btn btn-sm" href="#job/' + esc(x.core) + '">Open job</a></div>' +
      '<div class="muted" style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;margin-top:8px">What the customer wants (what we would be committing to)</div>' +
      '<div class="pre">' + (x.scope ? esc(x.scope) : '<i class="muted">No details on this job yet. Open the job and add a note first, or write the scope on the next screen.</i>') + '</div>' +
      '<dl class="peekf">' + f.map(function (r) { return '<div><dt>' + r[0] + '</dt><dd>' + esc(r[1]) + '</dd></div>'; }).join('') + '</dl></div>';
  }

  function planView(args) {
    var core = args[0], tab = args[1] || S.tab;
    if (S.plan && S.job && (core === S.core || core === S.job.ref) && args[1] && !S.away) { S.tab = tab; render(); loadChain(); return; }   // just a tab change (the quote/invoice may have moved on)
    var pending = S.timer ? saveNow() : (S.q || Promise.resolve());
    return pending.then(function () { return api('planGet', { core: core }); }).then(function (d) {
      S.plan = null;
      S.core = d.job.core; S.job = d.job; S.reminders = d.reminders; S.expensesEx = d.expensesEx; S.tab = tab; S.mods = { bom: !d.champ || d.champ.bom !== false, swms: !d.champ || d.champ.swms !== false, change: !d.champ || d.champ.change !== false }; if (S.mods[S.tab] === false) S.tab = 'overview';
      if (!d.plan) return chooser();
      S.plan = normalise(d.plan); S.rev = d.plan.rev; S.chain = null; S.away = false; S.bench = d.bench || null; S.isTest = !!d.test;
      loadChain();
      return loadInv().then(render).then(estAuto);
    });
  }
  // dates written in plain words: "starts tomorrow and ends in one day", "start Monday, takes 3 days", "start 5/11, finish by 12/11", "done by Friday"
  var NUMW = { one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fortnight: 10 };
  var WD = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'], MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  function dayWord(w, base) {   // "today", "tomorrow", "monday", "next friday", "5/11", "5/11/2026", "5 nov", "5th"
    w = String(w || '').toLowerCase().trim(); var d = toD(base);
    if (/^today$/.test(w)) return base;
    if (/^(tomorrow|tmrw|tmr)$/.test(w)) return toS(new Date(d.getTime() + 864e5));
    if (/^next week$/.test(w)) return toS(new Date(d.getTime() + (((8 - d.getUTCDay()) % 7) || 7) * 864e5));   // next Monday
    var m = w.match(/^(next |this )?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)[a-z]*$/);
    if (m) { var want = WD.map(function (x) { return x.slice(0, 3); }).indexOf(m[2].slice(0, 3)), diff = (want - d.getUTCDay() + 7) % 7 || 7; if (m[1] === 'next ' && diff < 7 && d.getUTCDay() !== 0) diff += 0; return toS(new Date(d.getTime() + diff * 864e5)); }
    m = w.match(/^(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?$/);
    if (m) { var y = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : d.getUTCFullYear(), r = parseDmy(m[1] + '/' + m[2] + '/' + y); if (r && !m[3] && r < base) r = parseDmy(m[1] + '/' + m[2] + '/' + (y + 1)); return r; }
    m = w.match(/^(\d{1,2})(?:st|nd|rd|th)?(?: of)? ?([a-z]{3})?[a-z]*$/);
    if (m) { var mo = m[2] ? MON.indexOf(m[2]) : d.getUTCMonth(); if (mo < 0) return null; var yy = d.getUTCFullYear(), r2 = parseDmy(m[1] + '/' + (mo + 1) + '/' + yy); if (r2 && r2 < base) r2 = m[2] ? parseDmy(m[1] + '/' + (mo + 1) + '/' + (yy + 1)) : parseDmy(m[1] + '/' + (mo + 2 > 12 ? 1 : mo + 2) + '/' + (mo + 2 > 12 ? yy + 1 : yy)); return r2; }
    return null;
  }
  function readDates(text) {
    var t = ' ' + String(text || '').toLowerCase().replace(/[,;]/g, ' ').replace(/\s+/g, ' ') + ' ', base = today(), out = {};
    var DAYW = '(today|tomorrow|tmrw|tmr|next week|(?:next |this )?(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*|\\d{1,2}[\\/.\\-]\\d{1,2}(?:[\\/.\\-]\\d{2,4})?|\\d{1,2}(?:st|nd|rd|th)?(?: of)? (?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*|\\d{1,2}(?:st|nd|rd|th))';
    var m = t.match(new RegExp('(?:start(?:s|ing)?|begin(?:s|ning)?|commenc(?:e|es|ing)|kick(?:s)? off|work (?:can )?start(?:s)?)(?: work)?(?: on| from)? ' + DAYW + '\\b'));
    if (m) out.start = dayWord(m[1], base);
    else if ((m = t.match(new RegExp('\\b(?:do it|come|on site) ' + DAYW + '\\b')))) out.start = dayWord(m[1], base);
    var st = out.start || null;
    m = t.match(/(?:end(?:s)?|finish(?:es|ed)?|done|complete(?:d)?|takes?|last(?:s)?|over) (?:in |within )?(\d+|one|a|an|two|three|four|five|six|seven|eight|nine|ten|half a) (working |business )?(day|days|week|weeks)\b/);
    if (m) { var n = /half/.test(m[1]) ? 1 : (+m[1] || NUMW[m[1]] || 1); if (/week/.test(m[3])) n *= 5; out.days = Math.max(1, n); }
    else if (/\b(one|1|a|single) ?-?day (job|job only|work)|\bin (a|one) day\b/.test(t)) out.days = 1;
    m = t.match(new RegExp('(?:finish(?:ed)?|done|complete(?:d)?|end(?:s|ed)?|ready)(?: by| on| before) ' + DAYW + '\\b'));
    if (m) out.finish = dayWord(m[1], base);
    if (out.days && !out.finish) out.finish = addWork(nextWork(st || base), out.days - 1);
    return out;
  }
  var EMERG = /(?!)/;   // Project Champ: no emergency mode
  var EMERG_OLD = /\bemergenc|\burgent|\basap\b|straight away|right away|immediately|burst (pipe|water)|flood(ing|ed)?\b|storm damage|water (is )?(pouring|coming in|everywhere)/i;
  /* ---------- new plan: scope of work + job type / blank / ✨ AI ---------- */
  var GUESS = [[/static (web)?site|\bcdn\b/, 'cl-static'], [/three.?tier|3.?tier/, 'cl-3tier'], [/disaster recovery|\bdr\b plan|cloud backup/, 'cl-backup'], [/ci\/?cd|pipeline for microservices|devops pipeline/, 'cl-cicd'], [/terraform|infrastructure as code|\biac\b/, 'cl-iac'],
    [/kubernetes|\beks\b|\baks\b|\bgke\b|container/, 'cl-k8s'], [/cloud migration|migrat\w* to (the )?cloud|on.?prem/, 'cl-migrate'], [/event.?driven|serverless (data )?pipeline|streaming pipeline/, 'cl-events'], [/hybrid cloud|multi.?cloud|expressroute|direct connect/, 'cl-network'],
    [/\bcspm\b|security posture/, 'cl-cspm'], [/zero trust|\bztna\b/, 'cl-zerotrust'], [/landing zone|well.?architected/, 'cl-landing'], [/finops|cloud cost/, 'cl-finops'], [/serverless api|api gateway/, 'cl-serverless'], [/data lake|lakehouse|data platform|data warehouse/, 'cl-data'], [/observability|\bsre\b|opentelemetry/, 'cl-observe'],
    [/birthday/, 'fun-birthday'], [/wedding/, 'fun-wedding'], [/holiday|vacation|\btrip\b/, 'fun-holiday'], [/moving house|move house|relocat/, 'fun-move'], [/fundrais|charity/, 'fun-fundraiser'], [/makeover|\bdiy\b/, 'fun-garden'],
    [/sustainability report|\bgri\b|\bissb\b/, 'esg-report'], [/carbon|emission|net.?zero|decarbon/, 'esg-carbon'], [/materiality|esg baseline/, 'esg-baseline'], [/\besg\b/, 'esg-strategy'],
    [/\bpmp\b|\bcapm\b/, 'trn-pmp'], [/agile|scrum/, 'trn-agile'], [/train the trainer|capacity building|academy/, 'trn-academy'], [/esg (training|awareness)/, 'trn-esg'],
    [/\berp\b|implementation of|core system/, 'tech-erp'], [/\brfp\b|system selection|vendor (selection|evaluation)/, 'tech-selection'], [/cyber|security review|pdpa|privacy act/, 'tech-cyber'], [/it strategy|digital (roadmap|strategy)/, 'tech-strategy'],
    [/\bpmo\b/, 'ppm-pmo'], [/recovery|turnaround|troubled/, 'ppm-recovery'], [/national (id|program)|e-?government/, 'ppm-national'], [/program management/, 'ppm-program'],
    [/feasibility|business case/, 'stp-feasibility'], [/okr|balanced scorecard/, 'stp-okr'], [/national strategy|sector strategy|ict park/, 'stp-national'], [/strategic plan/, 'stp-plan'],
    [/adkar|system rollout/, 'chg-system'], [/restructur|operating model/, 'chg-restructure'], [/culture|engagement/, 'chg-culture'], [/change management|transformation/, 'chg-transform'],
    [/market entry|new country/, 'gtm-entry'], [/distributor|partner search/, 'gtm-partner'], [/tender|\bbid\b/, 'gtm-tender'], [/launch|go.to.market/, 'gtm-launch'],
    [/exhaust|\bfan\b/, 'exhaust-fan'], [/shower.{0,40}leak|leak.{0,40}shower/, 'shower-leak'], [/vanity|toilet|tapware|\btaps?\b/, 'vanity'], [/bathroom.{0,40}(waterproof|retil)|(waterproof|retil).{0,40}bathroom/, 'bathroom'], [/bathroom|ensuite/, 'bath-reno'],
    [/splashback/, 'splashback'], [/benchtop/, 'benchtop'], [/kitchen/, 'kitchen-reno'], [/laundry/, 'laundry-reno'], [/concrete cancer|spall/, 'concrete-cancer'], [/balcony/, 'wp-balcony'], [/planter/, 'wp-planter'],
    [/basement/, 'wp-retaining'], [/retaining/, 'retaining'], [/crack/, 'crack-repair'], [/render/, 'render-repair'], [/composite/, 'deck-composite'], [/deck.{0,30}pergola|pergola.{0,30}deck/, 'deck'], [/re-?oil|deck.{0,30}(repair|rot)/, 'deck-repair'], [/deck/, 'deck-timber'],
    [/insulated|patio/, 'pergola-insulated'], [/pergola/, 'pergola-timber'], [/colorbond/, 'fence-colorbond'], [/fence/, 'fence-timber'], [/\bgate/, 'gate'], [/gutter|downpipe/, 'gutters'], [/roof.{0,40}leak|leak.{0,40}roof/, 'roof-leak'], [/roof/, 'roof-restore'],
    [/ceiling/, 'ceiling'], [/plaster|hole in (the )?wall/, 'plaster-patch'], [/sand(ing)?.{0,20}polish|polish/, 'floor-sand'], [/laminate|hybrid|floating|timber floor|flooring/, 'floor-floating'], [/outdoor til|alfresco/, 'tile-outdoor'], [/feature wall|wall til/, 'tile-feature'], [/til(e|es|ing)\b/, 'tile-floor'],
    [/window/, 'windows'], [/\bdoors?\b/, 'doors'], [/skirting|architrave/, 'trims'], [/driveway/, 'driveway'], [/paver|paving/, 'pavers'], [/hot water/, 'hws'], [/drain|stormwater|blocked/, 'drains'], [/leak/, 'plumb-leak'],
    [/switchboard/, 'switchboard'], [/light|power point|electric/, 'elec-lights'], [/exterior|outside of the house/, 'repaint'], [/paint/, 'paint-house'], [/strata/, 'strata-visit'], [/remove.{0,20}wall|wall removal/, 'wall-removal'],
    [/demolition|strip.?out/, 'demo'], [/extension|granny/, 'extension'], [/garden|landscap/, 'garden'], [/pre-?sale/, 'pre-sale'], [/handyman|odd jobs|repairs|maintenance/, 'maint-list']];
  function guessType(text) { var s = String(text || '').toLowerCase(), f = ''; GUESS.some(function (g) { if (g[0].test(s)) { f = g[1]; return true; } return false; }); return f; }
  function draftFacts(p) { var q = JSON.parse(JSON.stringify(p)), R = rollup(q, today()); return { tasks: q.tasks.length, days: R.start ? workBetween(R.start, R.finish) : 0, budget: R.BAC, risks: (q.risks || []).length, start: R.start, finish: R.finish }; }
  function newPlan(t, job, start, scope, extra) {   // plan object from template-style rows
    var ids = {}, n = 0;
    var tasks = t.rows.map(function (r) { var id = 't' + (++n); ids[r[1]] = id; return { id: id, phase: 'ph1', name: r[2], dur: r[3], res: [], lead: '', resource: '', qty: r[5], unit: r[6], rate: r[7], est: !!(r[10] && (+r[5] || 0) * (+r[7] || 0) > 0), basis: r[10] || '', pred: r[8], actual: 0, pct: 0, status: 'todo', snet: '', notes: '',
      subs: (r[9] || []).map(function (x, i) { return { id: 's' + n + '_' + (i + 1), name: x[0], off: x[1], dur: x[2], owner: '', status: 'todo' }; }) }; });
    tasks.forEach(function (x) { x.pred = x.pred.map(function (k) { return ids[k]; }).filter(Boolean); fitSubs(x); });
    extra = extra || {};
    var inScope = String(scope || '').trim();
    if (t.scope) inScope = inScope ? inScope + '\n\nTypical work: ' + t.scope : t.scope;
    return { name: t.name, start: start, phases: [{ id: 'ph1', name: 'Work' }], tasks: tasks,
      charter: { objective: t.objective, inScope: inScope, outScope: extra.outScope || '', deliverables: extra.deliverables || t.deliverables || '', acceptance: extra.acceptance || t.acceptance || 'Work complete, inspected and accepted by the customer; site clean; invoice issued.', assumptions: extra.assumptions || '', notes: extra.notes || '',
        budget: r2(tasks.reduce(function (a, x) { return a + cost(x); }, 0)), customer: job.sponsor || job.name || '', manager: job.manager || '' },
      risks: t.risks.map(function (r, i) { return { id: 'r' + (i + 1), title: r[0], cause: r[5] || '', p: r[1], i: r[2], response: r[3], action: r[4], owner: '', review: '', status: 'Open', raised: today() }; }),
      issues: [], baseline: null };
  }
  function fromAi(d, job, start, scope) {   // the AI draft -> the same row format as the templates
    var rows = d.tasks.map(function (x, i) { return [0, 'a' + (i + 1), x.n, x.d, '', x.q, x.u, x.r, (x.after || []).map(function (a) { return 'a' + a; }), x.s, x.b || (x.q * x.r > 0 ? 'AI benchmark' : '')]; });
    // v56: big plans come in phases: mark the end of each phase with a milestone that waits for the phase's last tasks
    var phases = []; d.tasks.forEach(function (x) { var ph = String(x.ph || '').trim(); if (ph && phases.indexOf(ph) < 0) phases.push(ph); });
    if (phases.length > 1) {
      var out = [];
      phases.forEach(function (ph, k) {
        var idx = []; d.tasks.forEach(function (x, i) { if (String(x.ph || '').trim() === ph) idx.push(i); });
        var inPh = idx.map(function (i) { return 'a' + (i + 1); });
        var ends = inPh.filter(function (id) { return !idx.some(function (i) { return (d.tasks[i].after || []).some(function (a) { return 'a' + a === id; }); }); });
        idx.forEach(function (i) { out.push(rows[i]); });
        out.push([0, 'ph' + (k + 1), '✓ Phase ' + (k + 1) + ' complete: ' + ph, 0, '', 0, '', 0, (ends.length ? ends : inPh.slice(-1)).slice(0, 10)]);
      });
      d.tasks.forEach(function (x, i) { if (!String(x.ph || '').trim()) out.push(rows[i]); });
      rows = out;
    }
    var p = newPlan({ name: d.name || (job.title || 'Project plan'), objective: d.objective || '', scope: d.inScope ? d.inScope : '', rows: rows, risks: d.risks || [] }, job, start, scope,
      { outScope: d.outScope, deliverables: d.deliverables, acceptance: d.acceptance, assumptions: d.assumptions, notes: (d.tips || []).map(function (x) { return '• ' + x; }).join('\n') });
    var cs = String(scope || '').trim();
    p.charter.inScope = cs && d.inScope ? cs + '\n\nPlanned work (AI):\n' + d.inScope : cs || d.inScope || '';
    return p;
  }
  function typeOptions(sel) {
    return '<option value="">Choose a project type…</option>' + CATALOG.map(function (c) { return '<optgroup label="' + esc(c.c) + '">' + c.items.map(function (i) { return '<option value="' + i.id + '"' + (i.id === sel ? ' selected' : '') + '>' + esc(i.n) + '</option>'; }).join('') + '</optgroup>'; }).join('');
  }
  function rid() { var a = new Uint8Array(12); (window.crypto || window.msCrypto).getRandomValues(a); return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
  function previewHtml(p, tips, full) {
    var f = draftFacts(p), c = p.charter, sc = function (r) { return r.p * r.i; };
    var scopeBox = full ? '<div class="aiscope"><b>🎯 Scope (worked out by AI)</b>' + [['In scope', full.inScope || ''], ['Out of scope', c.outScope], ['Deliverables', c.deliverables], ['Acceptance', c.acceptance], ['Assumptions', c.assumptions]]
      .filter(function (x) { return x[1]; }).map(function (x) { return '<div><span class="muted">' + x[0] + '</span><div class="pre">' + esc(x[1]) + '</div></div>'; }).join('') + '</div>' : '';
    var riskBox = full && p.risks.length ? '<div class="airisks"><b>⚠ Risks (worked out by AI)</b><table><thead><tr><th>Risk</th><th>Cause</th><th>P×I</th><th>Response</th><th>Action</th></tr></thead><tbody>' + p.risks.map(function (r) { return '<tr><td>' + esc(r.title) + '</td><td>' + esc(r.cause) + '</td><td><span class="score ' + scoreCls(sc(r)) + '">' + sc(r) + '</span></td><td>' + esc(r.response) + '</td><td>' + esc(r.action) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '';
    return '<div class="tplprev"><div class="row" style="gap:16px;flex-wrap:wrap"><b style="font-size:15px">' + esc(p.name) + '</b><span>' + pl(f.tasks, 'task') + '</span><span>about ' + pl(f.days, 'working day') + '</span><span>' + money(f.budget) + ' example budget</span><span>' + pl(f.risks, 'risk') + '</span></div>' +
      (tips && tips.length ? '<div class="aitips"><b>💡 Planning tips</b><ul>' + tips.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>' : '') +
      '<ol class="tpltasks">' + p.tasks.map(function (t) { return '<li>' + (t.dur === 0 ? '◆ ' : '') + esc(t.name) + ' <small class="muted">' + (t.dur === 0 ? 'milestone' : pl(t.dur, 'day')) + (t.subs && t.subs.length ? ' · ' + pl(t.subs.length, 'sub-task') : '') + '</small></li>'; }).join('') + '</ol>' +
      scopeBox + riskBox + (!full && p.risks.length ? '<div class="muted" style="font-size:12.5px"><b>Risks:</b> ' + p.risks.map(function (r) { return esc(r.title); }).join(' · ') + '</div>' : '') + '</div>';
  }
  // a project type belongs to a program of the same name, so related projects sit together and can be linked on the Dependency board
  function typeProgram(id) { var f = catalogItem(id); if (!f) return ''; var c = CATALOG.filter(function (x) { return x.c === f.cat; })[0]; return c && c.g ? f.cat.replace(/\s*\(.*\)\s*$/, '') : ''; }
  function linkBox(v) {
    var el = $('#tplLink'); if (!el) return; var pg = typeProgram(v); if (!pg) { el.innerHTML = ''; return; }
    (S.pgl || (S.pgl = api('planProgramList', { today: today() }).catch(function () { S.pgl = null; return { programs: [], cards: [] }; }))).then(function (d) {
      if (!$('#tplLink') || S.tplType !== v) return;
      var ids = {}; (d.programs || []).forEach(function (p) { ids[p.id] = p.name; });
      var pn = function (c) { return ids[c.program] || c.program || ''; };
      var me = (d.cards || []).filter(function (c) { return c.core === S.core; })[0], cur = me ? pn(me) : '';
      var mates = (d.cards || []).filter(function (c) { return c.core !== S.core && pn(c) === pg; });
      el.innerHTML = '<div class="tpl-link" style="margin:12px 0 4px;padding:12px 14px;border:1px solid var(--line,#e5e2d8);border-radius:12px;display:grid;gap:8px">' +
        '<h4 style="margin:0">🔗 Program and links</h4>' +
        (cur === pg ? '<span>✓ Already in the <b>' + esc(pg) + '</b> program.</span>' :
          '<label style="display:flex;gap:8px;align-items:flex-start"><input type="checkbox" id="tplProgOn" checked> <span>Put this project in the <b>' + esc(pg) + '</b> program' + (cur ? ' <small class="muted">(now in ' + esc(cur) + ')</small>' : '') + '. Related projects then sit together on the Programs page and the Dependency board.</span></label>') +
        '<label style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">Link it to <select id="tplAfter" style="width:auto;max-width:320px"><option value="">no other project</option>' +
          mates.map(function (c) { return '<option value="' + esc(c.core) + '">' + esc(c.name) + '</option>'; }).join('') + '</select>' +
          '<select id="tplDepType" data-i18n style="width:auto"><option value="FS">starts after it finishes</option><option value="SS">starts at the same time</option><option value="FF">finishes at the same time</option></select></label>' +
        (mates.length ? '' : '<small class="muted">No other projects in ' + esc(pg) + ' yet. Create the next one from this type and you can link them here.</small>') + '</div>';
    });
  }
  function linkUp(L) {
    if (!L) return Promise.resolve();
    var p = L.prog ? api('planProgramSet', { core: S.core, id: L.prog }) : Promise.resolve();
    return p.then(function () { if (L.after) return api('planDepSave', { from: L.after, to: S.core, type: L.type || 'FS' }); })
      .then(function () { S.pgl = null; if (L.prog || L.after) toast((L.prog ? 'Added to the ' + L.prog + ' program' : 'Linked') + (L.after ? ' and linked on the Dependency board' : '')); })
      .catch(function (e) { toast('Plan created, but the program link failed: ' + (e.message || e), true); });
  }
  // a ready-made type is a typical length; when a Finish by date is given, squeeze the durations to fit it (costs stay the same: more hands, same work)
  function fitTemplate(plan) {
    if (!plan.finishBy) return '';
    var R = rollup(plan, today()); if (!R.finish || R.finish <= plan.finishBy) return '';
    var span = function (Q) { return workBetween(Q.start, Q.finish); }, need = span(R), avail = workBetween(R.start, plan.finishBy);
    if (avail < 1) return '';
    var orig = plan.tasks.map(function (t) { return t.dur; }), f = avail / need;
    for (var k = 0; k < 12; k++) {
      plan.tasks.forEach(function (t, i) { if (orig[i] > 0) { t.dur = Math.max(1, Math.round(orig[i] * f)); if (t.subs) fitSubs(t); } });
      R = rollup(plan, today()); if (R.finish <= plan.finishBy) break; f *= 0.85;
    }
    var got = span(R);
    return 'Durations squeezed from ' + pl(need, 'working day') + ' to ' + pl(got, 'working day') + ' to finish by ' + dmy(plan.finishBy) + (R.finish > plan.finishBy ? ' (still ' + pl(workBetween(plan.finishBy, R.finish) - 1, 'day') + ' over: every task is already at its shortest)' : '') + '.';
  }
  // GKH Project Champ: a project type in the language the console is in (Tamil, Malay ...): its tasks, sub-tasks, risks and charter text
  function tplLang() { return (window.ChampI18n && window.ChampI18n.get && window.ChampI18n.get()) || 'en'; }
  function tplFor(v) { var l = tplLang(); if (l === 'en' || !window.ChampI18n || !window.ChampI18n.strings) return buildTemplate(v); return (S.tplL || {})[v + '@' + l] || null; }
  function localizeTpl(v) {
    var l = tplLang(), key = v + '@' + l; S.tplL = S.tplL || {}; if (l === 'en' || S.tplL[key]) return Promise.resolve(tplFor(v));
    var t = JSON.parse(JSON.stringify(buildTemplate(v))), list = [], put = [];
    var add = function (get, set) { var x = get(); if (x && /\p{L}/u.test(x)) { list.push(x); put.push([x, set]); } };
    var lines = function (o, k) { if (!o[k]) return; var L = String(o[k]).split('\n'); L.forEach(function (ln, i) { var m = ln.match(/^(\s*[-•]\s+)?(.*)$/); if (m[2]) add(function () { return m[2]; }, function (v2) { L[i] = (m[1] || '') + v2; o[k] = L.join('\n'); }); }); };
    ['name', 'objective', 'scope'].forEach(function (k) { add(function () { return t[k]; }, function (v2) { t[k] = v2; }); }); lines(t, 'deliverables'); add(function () { return t.acceptance; }, function (v2) { t.acceptance = v2; });
    t.rows.forEach(function (r) { add(function () { return r[2]; }, function (v2) { r[2] = v2; }); (r[9] || []).forEach(function (x) { if (Array.isArray(x)) add(function () { return x[0]; }, function (v2) { x[0] = v2; }); }); });
    t.risks.forEach(function (r) { add(function () { return r[0]; }, function (v2) { r[0] = v2; }); add(function () { return r[4]; }, function (v2) { r[4] = v2; }); if (r[5]) add(function () { return r[5]; }, function (v2) { r[5] = v2; }); });
    return window.ChampI18n.strings(list, l).then(function (map) { put.forEach(function (x) { if (map[x[0]]) x[1](map[x[0]]); }); S.tplL[key] = t; return t; });
  }
  function chooser() {
    setTimeout(function () { dateBoxes(V()); }, 0);
    $('#title').textContent = 'Project plan';
    var j = S.job, scope0 = j.scope || '';
    var guess = guessType(j.title + ' ' + scope0);
    S.mode = 'type'; S.aiDraft = null; S.aiId = ''; S.aiText = ''; S.tplType = ''; S.aiFinish = ''; S.tplWeek = false; S.coolZero = false; S.datesTouched = false; S.lastDates = '';
    V().innerHTML = '<div class="row" style="margin-bottom:14px"><a class="btn btn-sm" href="#job/' + esc(j.core) + '">← ' + esc(j.ref) + '</a><h2 style="font-size:22px">Plan this project: ' + esc(j.name) + ': ' + esc(j.title || j.service || 'Job') + '</h2></div>' +
      '<div class="card"><h2>1. What the project must deliver (scope of work)</h2>' +
      '<p class="jobline"><span class="ref">' + esc(j.ref) + '</span> <b>' + esc(j.title || '') + '</b>' + [j.suburb, j.source ? 'from ' + j.source : ''].filter(Boolean).map(function (x) { return ' · ' + esc(x); }).join('') + '</p>' +
      '<p class="muted" style="margin:0 0 8px">The tasks (WBS) and Gantt chart are built from this, so it is needed. It is filled in from the project description: check it and add what is missing (objective, deliverables, where, constraints, budget, deadline).</p>' +
      '<textarea id="tplScope" rows="5" placeholder="e.g. Bathroom exhaust fan is noisy and has stopped working. Replace it with a quieter fan, duct it outside through the eave, patch and paint the ceiling around it.">' + esc(scope0) + '</textarea></div>' +
      '<div class="card"><h2>2. How do you want to build the plan?</h2>' +
      '<div class="row pdates">' +
        '<label style="display:grid;gap:4px;font-weight:700">Start date<input type="date" id="tplStart" value="' + today() + '" style="width:auto"></label>' +
        '<label style="display:grid;gap:4px;font-weight:700"><span>Finish by <small class="muted" style="font-weight:400">(optional)</small></span><input type="date" id="aiFinish" value="' + esc(S.aiFinish || '') + '" style="width:auto"></label>' +
        '<input type="checkbox" id="tplEmerg" hidden>' +
        '<label class="qchk" title="Tick if the crew can work Saturday and Sunday: the schedule counts every day and finishes sooner"><input type="checkbox" id="tplWeek"' + (S.tplWeek ? ' checked' : '') + '> 📅 Weekends (Sat, Sun) allowed</label>' +
        '<p class="pdates-note">✨ <b>Not sure of the end date?</b> Leave <b>Finish by</b> empty and choose <b>Ask AI to build it</b>: the AI works out the end date for this job. If you set a Finish by date, the plan is checked against it (and ✨ Fit to finish-by can bring it in).</p>' +
      '</div><div class="tpl-grid tmodes">' +
      [['type', '📋 Pick a project type', CATALOG.reduce(function (a, c) { return a + c.items.length; }, 0) + ' ready-made project types: GKH consulting (ESG, technology, project and program management, training, strategy, change, go-to-market), cloud projects (hosting, migration, Kubernetes, CI/CD, IaC, DR, zero trust), general and fun projects for learning (birthday, wedding, holiday, moving house) and construction. Builds tasks, milestones, example costs and risks.'], ['blank', '⬜ Blank plan', 'Two rows to start from. Add your own tasks.'], ['ai', '✨ Ask AI to build it', 'Describe the project (any industry); AI works out the tasks, sub-tasks, costs, scope and risks, plus tips to help you plan.']]
        .map(function (m) { return '<button class="tpl tmode' + (S.mode === m[0] ? ' on' : '') + '" data-mode="' + m[0] + '"><b>' + m[1] + '</b><small>' + m[2] + '</small></button>'; }).join('') + '</div>' +
      '<div id="modeBody" style="margin-top:14px"></div>' +
      '<div class="row" style="margin-top:16px;align-items:flex-end"><span class="sp"></span><button class="btn btn-gold" id="tplCreate">Create plan</button></div></div>';
    var mode = function () {
      V().querySelectorAll('[data-mode]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-mode') === S.mode); });
      var mb = $('#modeBody'), create = $('#tplCreate');
      create.disabled = false; create.textContent = 'Create plan';
      if (S.mode === 'type') {
        mb.innerHTML = '<label style="display:grid;gap:4px;font-weight:700">Project type<select id="tplType" style="max-width:520px">' + typeOptions(S.tplType || guess) + '</select></label>' +
          (guess && !S.tplType ? '<small class="muted">Suggested from the description. Change it if it\'s not right.</small>' : '') + '<div id="tplLink"></div><div id="tplPrev"></div>';
        var show = function () { var v = $('#tplType').value; S.tplType = v; linkBox(v); if (!v) { $('#tplPrev').innerHTML = ''; return; }
          var t = tplFor(v); if (t) { $('#tplPrev').innerHTML = previewHtml(newPlan(t, j, $('#tplStart').value || today(), '')); return; }
          $('#tplPrev').innerHTML = '<p class="ask-think" style="margin:10px 0">Writing the tasks in ' + esc(window.ChampI18n.name()) + '…</p>'; $('#tplCreate').disabled = true;
          localizeTpl(v).catch(function () { S.tplL[v + '@' + tplLang()] = buildTemplate(v); toast('Translation is unavailable right now: the tasks are in English', true); })
            .then(function () { if ($('#tplType') && $('#tplType').value === v) { $('#tplCreate').disabled = false; show(); } }); };
        $('#tplType').onchange = show; show();
      } else if (S.mode === 'blank') {
        mb.innerHTML = '<p class="muted" style="margin:0">A plan with a site inspection and a handover. Add tasks, milestones and sub-tasks yourself on the Schedule tab.</p>';
      } else {
        mb.innerHTML = '<label style="display:grid;gap:4px;font-weight:700">Describe the plan for the AI <small class="muted" style="font-weight:400">(leave empty to use the scope above)</small><textarea id="aiDescribe" rows="4" placeholder="e.g. Replace the exhaust fan in a 2nd-floor unit bathroom, duct it outside through the eave, patch and paint the ceiling. Strata building; customer wants it done before Christmas.">' + esc(S.aiText || '') + '</textarea></label>' +
          '<p class="muted" style="font-size:13px;margin:8px 0 0">' + ($('#aiFinish') && $('#aiFinish').value ? 'The AI fits the work between the <b>Start date</b> and <b>Finish by</b> above.' : 'No <b>Finish by</b> date above, so ✨ <b>the AI works out the end date</b> for this job.') + '</p>' +
          '<div class="row" style="margin-top:8px"><button class="btn btn-gold btn-sm" id="aiGo">✨ Build the plan with AI</button><small class="muted">Small jobs take 20–60 seconds; big multi-phase projects a few minutes (up to 10,000 tokens). No names or contact details are sent.</small></div><div id="aiOut"></div>';
        $('#aiDescribe').oninput = function () { S.aiText = this.value; };
        dateBoxes(mb);
        $('#aiGo').onclick = aiRun;
        create.disabled = !S.aiDraft; create.textContent = 'Use this plan';
        if (S.aiDraft) showDraft();
      }
    };
    function showDraft() {
      var out = $('#aiOut'); if (!out) return;
      var p = fromAi(S.aiDraft, j, $('#tplStart').value || today(), $('#tplScope').value);
      var fb = $('#aiFinish') ? $('#aiFinish').value : '', em = !!($('#tplEmerg') && $('#tplEmerg').checked);
      p.emergency = em; p.weekends = !!($('#tplWeek') && $('#tplWeek').checked); p.coolOff = S.coolZero && !em ? 0 : 3; if (fb) p.charter.assumptions = ('Customer wants it finished by ' + dmy(fb) + '.\n' + (p.charter.assumptions || '')).trim();
      // estimate with the quote accepted on the start date and the usual cooling-off (unless emergency)
      var est = JSON.parse(JSON.stringify(p)); est.gate = em ? null : { date: p.start, accepted: true, id: 'quote' }; var ER = rollup(est, today());
      var fit = !fb ? '' : ER.finish <= fb ? '<div class="aifit ok">✅ Planned finish <b>' + esc(dmy(ER.finish)) + '</b>: within your finish-by date (' + esc(dmy(fb)) + ').</div>'
        : '<div class="aifit">⚠ Planned finish <b>' + esc(dmy(ER.finish)) + '</b>: ' + (workBetween(fb, ER.finish) - 1) + ' working day' + (workBetween(fb, ER.finish) - 1 === 1 ? '' : 's') + ' past your finish-by date (' + esc(dmy(fb)) + '). Shorten some tasks, run some in parallel, tick Emergency, or ask the AI again.</div>';
      out.innerHTML = fit + (fb ? '' : '<div class="aifit plain">✨ The AI worked out the end date: <b>' + esc(dmy(ER.finish)) + '</b> (starts ' + esc(dmy(ER.start)) + ', ' + pl(workBetween(ER.start, ER.finish), em || p.weekends ? 'day' : 'working day') + ')' + (em ? ' (emergency: no cooling-off, Saturday and Sunday are work days)' : coolOf(p) ? ' (includes ' + coolOf(p) + ' business days cooling-off after the quote)' : ' (no cooling-off)') + '.</div>') + previewHtml(p, S.aiDraft.tips, S.aiDraft) + '<p class="muted" style="font-size:12.5px;margin:6px 0 0">This is an AI draft: check the tasks, days, prices, scope and risks (all go into the Scope and Risks tabs). People (resources) are left blank. Press <b>Use this plan</b> to create it, or <b>Build the plan with AI</b> again for another version.</p>';
      $('#tplCreate').disabled = false;
    }
    function aiRun() {
      var desc = $('#aiDescribe').value.trim(), scope = $('#tplScope').value.trim();
      if ((desc || scope).length < 10) { toast('Describe the project first (what it must deliver)', true); ($('#aiDescribe').value ? $('#aiDescribe') : $('#tplScope')).focus(); return; }
      var id = rid(), go = $('#aiGo'), out = $('#aiOut');
      S.aiId = id; S.aiDraft = null; $('#tplCreate').disabled = true; go.disabled = true;
      out.innerHTML = '<p class="ask-think" style="margin:10px 0 0">AI is building the plan… a small job takes 20–60 seconds; a big multi-phase project can take 3–8 minutes (up to 10,000 tokens). You can keep working in another tab.</p>';
      var t0 = Date.now(), cat = catalogItem($('#tplType') ? $('#tplType').value : S.tplType || '');
      var poll = function () {
        return new Promise(function (res) { setTimeout(res, 2000); }).then(function () { return api('planAiStatus', { id: id }); }).then(function (d) {
          if (S.aiId !== id) return;
          if (d.status === 'done' && d.plan) {
            S.aiDraft = d.plan; go.disabled = false;
            var eb = $('#tplEmerg'), aiEm = d.plan.emergency && eb && !eb.checked && !S.emergTouched; if (aiEm) eb.checked = true;
            showDraft(); toast(aiEm ? '🚨 The AI reads this as an emergency, so Emergency is ticked (untick it if not)' : 'AI plan ready (' + (d.tokens || 0) + ' tokens)'); return; }
          if (d.status === 'error') throw new Error(d.error || 'The AI plan could not be made');
          if (Date.now() - t0 > 660000) throw new Error('The AI is taking too long. Try again, or pick a job type instead.');
          return poll();
        });
      };
      fetch('/.netlify/functions/planai-background', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-MBS-Admin': '1', 'X-Champ-Lang': (window.ChampI18n && window.ChampI18n.get()) || 'en' },
        body: JSON.stringify({ id: id, core: j.core, lang: tplLang(), describe: desc, scope: scope, type: cat ? cat.cat + ': ' + cat.item.n : '', start: $('#tplStart').value || today(), finish: $('#aiFinish').value || '', emergency: !!($('#tplEmerg') && $('#tplEmerg').checked), weekends: !!($('#tplWeek') && $('#tplWeek').checked) }) })
        .then(function (r) {
          if (r.status === 401 || r.status === 403) throw new Error('Your session has ended. Sign in again.');
          if (r.status !== 202 && !r.ok) throw new Error('Could not start the AI (' + r.status + '). Try again.');
          return poll();
        }).catch(function (e) { if (S.aiId !== id) return; go.disabled = false; var o = $('#aiOut'); if (o) o.innerHTML = '<p class="bad" style="margin:10px 0 0">' + esc(e.message) + '</p>'; });
    }
    V().querySelectorAll('[data-mode]').forEach(function (b) { b.onclick = function () { S.mode = b.getAttribute('data-mode'); mode(); }; });
    $('#tplStart').onchange = function () { if (S.mode === 'type' && $('#tplType') && $('#tplType').value) $('#tplType').onchange(); };
    mode();
    $('#tplEmerg').onchange = function () { S.emergTouched = true; if (S.mode === 'ai' && S.aiDraft) showDraft(); };
    $('#tplWeek').onchange = function () { S.tplWeek = this.checked; if (S.mode === 'ai' && S.aiDraft) showDraft(); else if (S.mode === 'type' && $('#tplType') && $('#tplType').value) $('#tplType').onchange(); };
    var keepOrder = function (changed) {
      var s = $('#tplStart').value, f = $('#aiFinish').value;
      $('#aiFinish').min = s || ''; if (f) $('#tplStart').max = f; else $('#tplStart').removeAttribute('max');
      if (s && f && f < s) { if (changed === 'finish') { setDate('aiFinish', ''); S.aiFinish = ''; toast('Finish by can\'t be before the Start date (' + dmy(s) + ').', true); } else { setDate('tplStart', f); toast('The Start date can\'t be after Finish by (' + dmy(f) + '), so it was set to ' + dmy(f) + '.', true); } return false; }
      return true;
    };
    $('#tplStart').addEventListener('change', function () { keepOrder('start'); });
    $('#aiFinish').addEventListener('change', function () { keepOrder('finish'); });
    setTimeout(function () { keepOrder(''); }, 0);
    $('#aiFinish').onchange = function () { S.aiFinish = this.value; if (S.mode === 'ai') { if (S.aiDraft) showDraft(); else mode(); } };
    // saying it's an emergency (in the scope or the AI description) ticks the box, unless you have unticked it yourself
    S.emergTouched = false;
    var sayEmerg = function (text) {
      var b = $('#tplEmerg'); if (!b || b.checked || S.emergTouched || !EMERG.test(text || '')) return;
      b.checked = true; toast('🚨 Emergency ticked: you said it is an emergency, so the work can start straight away (untick it if not)');
      if (S.mode === 'ai' && S.aiDraft) showDraft();
    };
    // dates written in words ("starts tomorrow and ends in one day") fill in Start date and Finish by, unless you set them yourself
    var setDate = function (id, iso) { var n = document.getElementById(id); if (!n) return; n.value = iso; n.dispatchEvent(new Event('input', { bubbles: true })); n.dispatchEvent(new Event('change', { bubbles: true })); };
    var sayDates = function () {
      if (S.datesTouched || !$('#tplScope')) return;
      var d = readDates(($('#tplScope').value || '') + ' . ' + (($('#aiDescribe') || {}).value || S.aiText || ''));
      if (!d.start && !d.finish) return;
      var key = JSON.stringify(d); if (key === S.lastDates) return; S.lastDates = key;
      var said = [];
      if (d.start) { setDate('tplStart', d.start); said.push('starts ' + dmy(d.start)); }
      if (d.finish) { S.aiFinish = d.finish; setDate('aiFinish', d.finish); said.push('finish by ' + dmy(d.finish)); }
      var st = d.start || $('#tplStart').value, em = $('#tplEmerg') && $('#tplEmerg').checked;
      ALL = false;   // cooling-off is counted in business days (Mon-Fri)
      S.coolZero = !em && !!st && st < addWork(nextWork(today()), 3);
      if (S.coolZero) said.push('cooling-off set to 0 days so the work can start then (the customer must agree to waive it)');
      toast('📅 From what you wrote: ' + said.join(', '));
      if (S.mode === 'ai' && S.aiDraft) showDraft();
    };
    var dT = null, later = function () { clearTimeout(dT); dT = setTimeout(sayDates, 600); };
    // (the view stays between pages, so its listeners are swapped, not added again)
    if (S.vCh) V().removeEventListener('change', S.vCh); if (S.vIn) V().removeEventListener('input', S.vIn);
    S.vCh = function (e) { var t = e.target; if (e.isTrusted && t && (t.id === 'tplStart' || t.id === 'aiFinish' || (t.classList && t.classList.contains('dtext') && /^(tplStart|aiFinish)$/.test(t.getAttribute('data-for') || '')))) S.datesTouched = true; };
    S.vIn = function (e) { if (e.target && e.target.id === 'aiDescribe') { sayEmerg(e.target.value); later(); } };
    V().addEventListener('change', S.vCh); V().addEventListener('input', S.vIn);
    $('#tplScope').addEventListener('input', function () { sayEmerg(this.value); later(); });
    if (j.emergency && $('#tplEmerg').checked && /emergenc/i.test(j.urgency || '')) toast('🚨 The customer said this is an emergency (in the chat), so Emergency is ticked');
    $('#tplCreate').onclick = function () {
      var scope = $('#tplScope').value.trim(), start = $('#tplStart').value || today(), plan, note;
      if (scope.length < 10 && !(S.mode === 'ai' && S.aiDraft)) { toast('Write the scope of work first: what the project must deliver', true); $('#tplScope').focus(); return; }
      if (S.mode === 'type') {
        var v = $('#tplType').value; if (!v) { toast('Pick a project type first', true); $('#tplType').focus(); return; }
        var tl = tplFor(v); if (!tl) { toast('Still writing the tasks in ' + window.ChampI18n.name() + '. A moment…', true); return; }
        plan = newPlan(tl, j, start, scope); note = 'plan created (' + v + (tplLang() !== 'en' ? ', ' + tplLang() : '') + ')';
      } else if (S.mode === 'blank') {
        plan = newPlan(TEMPLATES.blank, j, start, scope); plan.name = j.title || j.service || 'Project plan'; note = 'plan created (blank)';
      } else {
        if (!S.aiDraft) return toast('Build the plan with AI first', true);
        plan = fromAi(S.aiDraft, j, start, scope); note = 'plan created (AI draft)';
      }
      var fb2 = $('#aiFinish') ? $('#aiFinish').value : '';
      if (fb2) { plan.finishBy = fb2; plan.charter.assumptions = ('Customer wants it finished by ' + dmy(fb2) + '.\n' + (plan.charter.assumptions || '')).trim(); }
      var btn = this; btn.disabled = true;
      plan.emergency = false; plan.weekends = !!($('#tplWeek') && $('#tplWeek').checked); plan.coolOff = 0;
      if (S.mode === 'type') { var squeezed = fitTemplate(plan); if (squeezed) { plan.charter.assumptions = (squeezed + '\n' + (plan.charter.assumptions || '')).trim(); note += '; ' + squeezed; } }
      S.plan = plan; S.rev = 0; S.tab = 'schedule';
      var link = S.mode === 'type' && $('#tplLink') && typeProgram(S.tplType || $('#tplType').value) ? { prog: $('#tplProgOn') && $('#tplProgOn').checked ? typeProgram($('#tplType').value) : '', after: $('#tplAfter') ? $('#tplAfter').value : '', type: $('#tplDepType') ? $('#tplDepType').value : 'FS' } : null;
      api('planSave', { core: S.core, plan: S.plan, rev: 0, note: note }).then(function (r) { return linkUp(link).then(function () { return r; }); }).then(function (r) { S.plan = normalise(r.plan); S.rev = r.plan.rev; S.aiDraft = null; S.chain = null; loadChain(); S.aiText = ''; S.tplType = ''; toast('Plan created'); history.replaceState(null, '', '#plan/' + S.core + '/schedule'); render(); }).catch(function (e) { btn.disabled = false; S.plan = null; fail(e); });
    };
  }

  /* ---------- 📄 Quote & PM plan: plan -> quote -> invoice (value chain) ---------- */
  var DOCST = { draft: 'Draft', sent: 'Sent', accepted: 'Accepted', declined: 'Declined', void: 'Void', expired: 'Expired', overdue: 'Overdue', 'part-paid': 'Part-paid', paid: 'Paid' };
  function loadChain() {
    var core = S.core; if (M.me && M.me.scope) return Promise.resolve(null);   // v91: no quotes or invoices for a sub-contractor
    return api('planQuoteInfo', { core: core }).then(function (d) {
      if (S.core !== core) return; S.chain = d;
      if (S.plan && JSON.stringify(d.gate || null) !== JSON.stringify(S.plan.gate || null)) { S.plan.gate = d.gate || null; render(); } else drawChain();
      return d;
    }).catch(function () {});
  }
  function liveQuote(c) { var q = (c.quotes || []).filter(function (x) { return x.status !== 'void'; }); return q[q.length - 1] || null; }
  function liveInvoice(c) { var v = (c.invoices || []).filter(function (x) { return x.status !== 'void'; }); return v[v.length - 1] || null; }
  function drawChain() { return drawDocs(); }
  function drawChainOld() {
    var el = $('#planChain'); if (!el) return;
    var c = S.chain; if (!c) { el.innerHTML = ''; return; }
    var q = liveQuote(c), inv = liveInvoice(c), won = ['won', 'completed', 'invoiced', 'paid'].indexOf(c.stage) >= 0;
    var acc = q && (q.status === 'accepted' || q.invoiceId) || (won && !!q);
    var step = function (done, cur, icon, title, sub, href) {
      return '<' + (href ? 'a href="' + href + '"' : 'div') + ' class="vstep' + (done ? ' done' : '') + (cur ? ' cur' : '') + '"><b>' + icon + ' ' + esc(title) + '</b><small>' + sub + '</small></' + (href ? 'a' : 'div') + '>';
    };
    var R = rollup(S.plan, today());
    var html = '<div class="vchain">' +
      step(true, !q, '📅', 'Plan', esc(money(R.BAC)) + ' cost') +
      step(!!q, q && !acc, '📄', 'Quote', q ? esc(q.id) + ' · ' + esc(DOCST[q.shown || q.status] || q.status) + ' · ' + money(q.inc) + (q.changed && !q.invoiceId ? ' · <b class="warn">plan changed</b>' : '') : 'not quoted yet', q ? '#doc/' + encodeURIComponent(q.id) : '') +
      step(acc, acc && !inv, '✅', 'Accepted', acc ? 'job won' : q && q.status === 'declined' ? 'declined' : 'waiting') +
      step(!!inv, inv && inv.status !== 'paid', '🧾', 'Invoice', inv ? esc(inv.id) + ' · ' + esc(DOCST[inv.shown || inv.status] || inv.status) + ' · ' + money(inv.inc) : 'not invoiced', inv ? '#doc/' + encodeURIComponent(inv.id) : '') +
      step(inv && inv.status === 'paid', false, '💰', 'Paid', inv ? (inv.status === 'paid' ? 'paid in full' : inv.paid ? money(inv.paid) + ' paid · ' + money(inv.balance) + ' owing' : money(inv.balance || inv.inc) + ' owing') : '–') + '</div>';
    var act = '';
    if (!q) act = '<button class="btn btn-sm btn-gold" data-qact="new">📄 Make the quote &amp; PM plan</button>';
    else if (q.changed && q.status === 'draft' && q.fromPlan) act = '<span class="warn" style="font-size:12.5px">The plan changed since ' + esc(q.id) + ' was made.</span><button class="btn btn-sm btn-gold" data-qact="update">↻ Update ' + esc(q.id) + ' from the plan</button>';
    else {
      if (acc && !inv) act = '<button class="btn btn-sm btn-gold" data-qact="invoice">🧾 Make the tax invoice from ' + esc(q.id) + '</button>';
      if (q.changed && !q.invoiceId) act += '<span class="warn" style="font-size:12.5px">The plan changed since ' + esc(q.id) + ' was ' + esc((DOCST[q.status] || q.status).toLowerCase()) + '.</span><button class="btn btn-sm" data-qact="new">📄 Make a revised quote' + (acc ? ' (variation)' : '') + '</button>';
    }
    if (q) act += '<a class="btn btn-sm" target="_blank" rel="noopener" href="' + M.API + '?action=pdf&id=' + encodeURIComponent((inv || q).id) + '">👁 ' + (inv ? 'Invoice' : 'Quote') + ' PDF</a>';
    el.innerHTML = html + (act ? '<div class="vact">' + act + '</div>' : '');
    el.querySelectorAll('[data-qact]').forEach(function (b) {
      b.onclick = function () {
        var a = b.getAttribute('data-qact');
        if (a === 'new') return quoteDialog(null);
        if (a === 'update') return quoteDialog(q);
        if (a === 'invoice') {
          M.confirmBox('Make the tax invoice?', 'Copies the lines of ' + esc(q.id) + ' (' + money(q.inc) + ') into a new draft tax invoice for ' + esc(S.job.name) + '. The invoice PDF carries the project summary with progress. You can still change it before sending.', 'Make invoice').then(function (ok) {
            if (!ok) return;
            api('docToInvoice', { id: q.id }).then(function (r) { toast('Tax invoice ' + r.doc.id + ' made'); loadChain(); location.hash = '#doc/' + r.doc.id; }).catch(fail);
          });
        }
      };
    });
  }
  function quoteLines(mode, margin) {   // same rule as the server (plan-quote.mjs)
    var k = 1 + Math.max(0, Math.min(200, +margin || 0)) / 100;
    var costed = S.plan.tasks.filter(function (t) { return cost(t) > 0; });
    if (mode === 'lump') { var tot = r2(costed.reduce(function (a, t) { return a + cost(t); }, 0) * k); return tot > 0 ? [{ qty: 1, price: tot }] : []; }
    return costed.map(function (t) { return { qty: r2(t.qty), price: r2(r2(t.rate) * k) }; });
  }
  function quoteDialog(updating) {
    var c = (S.chain && S.chain.customer) || {}, p = S.plan;
    var keep = function () { try { return JSON.parse(localStorage.getItem('mbsQuoteOpts') || '{}'); } catch (e) { return {}; } }();
    var mode = updating && updating.mode ? updating.mode : keep.mode || 'tasks', margin = updating ? updating.margin || 0 : keep.margin || 0;
    var R = rollup(p, today());
    M.modal('<h2>📄 ' + (updating ? 'Update ' + esc(updating.id) + ' from the plan' : 'Quote &amp; project management plan') + '</h2>' +
      '<p class="muted" style="margin:-4px 0 12px">' + (updating ? 'The draft quote gets the plan\'s current lines, dates and scope.' : 'Makes a quote in Quotes from this plan with the customer\'s details.') + ' Its PDF is a pack: <b>cover page</b> (MBS logo and slogan), the <b>quote</b>, and <b>2 pages of high-level project management plan</b> (scope, risks, milestones and a Gantt chart).</p>' +
      '<form id="qForm" class="form">' +
        '<label>Customer name<input name="name" value="' + esc(c.name || S.job.name || '') + '" required maxlength="120"></label><label>Phone<input name="phone" value="' + esc(c.phone || '') + '" maxlength="40"></label>' +
        '<label>Email<input name="email" type="email" value="' + esc(c.email || '') + '" maxlength="160"></label><label>Valid for (days)<input name="validDays" type="number" min="1" max="120" value="' + (keep.validDays || 30) + '"></label>' +
        '<label class="full">Site address <small class="muted">(street, suburb, postcode: printed on the quote and saved to the customer)</small><input name="address" value="' + esc(c.address || '') + '" maxlength="300" placeholder="e.g. 12 Smith St, Box Hill NSW 2765"></label>' +
        '<label class="full">Quote title<input name="title" value="' + esc(p.name) + '" maxlength="160"></label>' +
        '<div class="full qmode"><b>Lines on the quote</b><label><input type="radio" name="mode" value="tasks"' + (mode !== 'lump' ? ' checked' : '') + '> One line per task with a cost (sub-steps listed)</label><label><input type="radio" name="mode" value="lump"' + (mode === 'lump' ? ' checked' : '') + '> One total line (the plan pages show the detail)</label></div>' +
        '<label>Margin on the plan\'s unit costs (%)<input name="margin" type="number" min="0" max="200" step="0.5" value="' + margin + '"></label>' +
        (estOf(p).n ? '<div class="full est-q"><b>⚠ ' + pl(estOf(p).n, 'task') + ' (' + money(estOf(p).sum) + ') still have indicative AI benchmark costs.</b> They are a reference only, not a price. Review and change them on the Schedule before quoting: using them unchanged will lead to complications with the customer.' +
          '<label><input type="checkbox" id="qEstOk"> I have reviewed these costs and accept them for this quote</label></div>' : '') +
        '<div class="qprev" id="qPrev"></div>' +
        (S.chain && !updating && liveQuote(S.chain) ? '<p class="full muted" style="font-size:12.5px;margin:0">A new quote is made (a revision of ' + esc(liveQuote(S.chain).id) + '). The old one stays in Quotes: void or decline it there if it is replaced.</p>' : '') +
        '<div class="full actions" style="justify-content:flex-end"><button class="btn" data-close type="button">Cancel</button><button class="btn btn-gold" id="qGo">' + (updating ? '↻ Update ' + esc(updating.id) : '📄 Make the quote') + '</button></div></form>');
    var f = $('#qForm');
    var prev = function () {
      var m = f.querySelector('[name=mode]:checked').value, lines = quoteLines(m, f.margin.value);
      var ex = r2(lines.reduce(function (a, l) { return a + r2(l.qty * l.price); }, 0)), gst = r2(ex * 0.1);
      $('#qPrev').innerHTML = lines.length ? '<b>' + lines.length + ' line' + (lines.length === 1 ? '' : 's') + '</b> · ex GST ' + money(ex) + ' · GST ' + money(gst) + ' · <b>total ' + money(ex + gst) + '</b><br><small class="muted">Plan cost ' + money(R.BAC) + (+f.margin.value ? ' + ' + f.margin.value + '% margin' : '') + ' · planned ' + esc(prettyY(R.start)) + ' to ' + esc(prettyY(R.finish)) + '</small>'
        : '<b class="bad">No task has a cost yet.</b> Fill in Qty and Unit $ on the Schedule first (the "$ Costs" view).';
      $('#qGo').disabled = !lines.length || !!($('#qEstOk') && !$('#qEstOk').checked);
    };
    f.oninput = prev; prev();
    f.onsubmit = function (e) {
      e.preventDefault();
      var b = $('#qGo'); b.disabled = true; b.textContent = 'Making it…';
      var opts = { mode: f.querySelector('[name=mode]:checked').value, margin: +f.margin.value || 0, validDays: +f.validDays.value || 30 };
      try { localStorage.setItem('mbsQuoteOpts', JSON.stringify(opts)); } catch (x) {}
      var go = function () {
        return api('planQuote', { core: S.core, update: updating ? updating.id : '', mode: opts.mode, margin: opts.margin, validDays: opts.validDays, title: f.title.value,
          customer: { name: f.name.value, phone: f.phone.value, email: f.email.value, address: f.address.value } });
      };
      (S.timer ? saveNow() : (S.q || Promise.resolve())).then(go).then(function (r) {
        var d = r.doc;
        M.modal('<h2>✅ Quote ' + esc(d.id) + ' ' + (updating ? 'updated' : 'made') + '</h2><p>' + money(d.totals.inc) + ' inc GST (GST ' + money(d.totals.gst) + '), valid until ' + esc(prettyY(d.validUntil)) + '. It is a draft in <b>Quotes</b>: check it, then email it to the customer from there.</p>' +
          '<div class="actions" style="justify-content:flex-end;flex-wrap:wrap"><button class="btn" data-close type="button">Close</button><a class="btn" target="_blank" rel="noopener" href="' + M.API + '?action=pdf&id=' + encodeURIComponent(d.id) + '&t=' + Date.now() + '">👁 Preview the PDF pack</a><a class="btn btn-gold" href="#doc/' + encodeURIComponent(d.id) + '" id="qOpen">Open in Quotes →</a></div>');
        var o = $('#qOpen'); if (o) o.onclick = function () { M.closeModal(); };
        loadChain();
      }).catch(function (e2) { b.disabled = false; b.textContent = updating ? '↻ Update ' + updating.id : '📄 Make the quote'; fail(e2); });
    };
  }

  var KEYS = ['data-k', 'data-sk', 'data-pos', 'data-spos', 'data-radd', 'data-c', 'data-p', 'data-r', 'data-i'];
  var ROWS = ['data-tid', 'data-sid', 'data-rid', 'data-iid'];
  // "Work starts": on the plan or on the quote; both stay in step (the quote's plan pages and Gantt chart follow)
  function setWorkStart(v) {
    var p = S.plan, g = gateDate(p);
    if (v && v < nextWork(p.start)) { toast('The work can\'t start before the project start (' + dmy(nextWork(p.start)) + ')', true); render(); return; }
    if (v && p.finishBy && v > p.finishBy) { toast('The work can\'t start after your Finish by date (' + dmy(p.finishBy) + '). Pick an earlier date, or move Finish by later first.', true); render(); return; }
    var f0 = rollup(p, today()).finish, waived = '';
    if (v && g && nextWork(v) < g && p.gate && /^\d{4}-\d{2}-\d{2}$/.test(p.gate.date || '')) {
      // v40: more flexible: shorten the cooling-off so the work can start then (the customer must agree to waive the rest)
      ALL = false; var c = coolOf(p) - 1;
      while (c >= 0 && addWork(nextWork(p.gate.date), c) > nextWork(v)) c--;
      if (c < 0) { toast('That is before the quote ' + (p.gate.accepted ? 'was accepted' : 'date') + ' (' + dmy(p.gate.date) + '). The earliest is ' + dmy(nextWork(p.gate.date)) + ' with no cooling-off, or tick 🚨 Emergency to start straight away.', true); render(); return; }
      p.coolOff = c; waived = ' Cooling-off shortened to ' + pl(c, 'business day') + ' so the work can start then: the customer must agree in writing to waive the rest.';
    }
    var q = S.chain && liveQuote(S.chain);
    if (q && q.fromPlan && !q.invoiceId) {   // the server moves the plan and refreshes the quote together
      (S.timer || waived ? saveNow(waived ? 'cooling-off ' + p.coolOff + ' business days' : '') : (S.q || Promise.resolve())).then(function () { return api('quoteStart', { id: q.id, date: v || '' }); }).then(function (r) {
        return api('planGet', { core: S.core }).then(function (d) { S.plan = normalise(d.plan); S.rev = d.plan.rev; render(); afterDates(f0, ''); toast(v ? 'Work starts ' + dmy(r.workStart) + ', finishes ' + dmy(r.finish) + ' (quote ' + q.id + ' updated too)' + waived : '"Work starts" cleared'); loadChain(); });
      }).catch(function (e) { fail(e); render(); });
      return;
    }
    p.workStart = v || ''; dirty('work start ' + (v || 'cleared')); render();
    var R = rollup(p, today()); if (v) toast('Work starts ' + dmy(holdDate(p)) + ', finishes ' + dmy(R.finish) + '.' + waived, !!waived);
    afterDates(f0, 'Work starts changed');
  }
  /* ---------- v38: ✨ fit the plan to its "Finish by" date ---------- */
  function fitBar(p, R) {
    var undo = S.fitUndo && S.fitUndo.core === S.core ? '<button class="btn btn-sm" id="fitUndo" type="button" title="Put the plan back the way it was before the AI changes">↶ Undo the AI changes</button>' : '';
    if (!p.finishBy) return undo ? '<div class="fitbar">' + undo + '</div>' : '';
    if (!R.finish) return '';
    if (R.finish <= p.finishBy) return '<div class="fitbar ok">✅ Planned finish <b>' + esc(dmy(R.finish)) + '</b>: on time for your finish-by date (' + esc(dmy(p.finishBy)) + ')' + (R.finish < p.finishBy ? ', ' + pl(workBetween(R.finish, p.finishBy) - 1, 'working day') + ' to spare' : '') + '.' + undo + '</div>';
    var late = workBetween(p.finishBy, R.finish) - 1;
    return '<div class="fitbar late">⚠ Planned finish <b>' + esc(dmy(R.finish)) + '</b> is <b>' + pl(late, 'working day') + ' late</b> for your finish-by date (' + esc(dmy(p.finishBy)) + '). ' +
      '<button class="btn btn-sm btn-gold" id="fitGo" type="button" title="The AI looks at the critical path and suggests which tasks can run side by side or be done faster with more crew. You see the changes before anything is saved.">✨ Fit to finish-by</button>' +
      (function () { var wf = weekendFinish(p); return wf ? '<button class="btn btn-sm" id="fitWeek" type="button" title="Count Saturday and Sunday as work days">📅 Allow weekends: finishes ' + esc(dmy(wf)) + (wf <= p.finishBy ? ' ✓' : '') + '</button>' : ''; })() + undo + '</div>';
  }
  // v40: after Work starts / Finish by / weekends / cooling-off / emergency changes: if the plan is now late, ask what to do
  function weekendFinish(p) { if (p.emergency || p.weekends) return ''; var w = JSON.parse(JSON.stringify(p)); w.weekends = true; var f = rollup(w, today()).finish; rollup(p, today()); return f; }
  function afterDates(f0, why) {
    var p = S.plan; if (!p || !p.finishBy) return;
    var R = rollup(p, today());
    if (!R.finish || R.finish <= p.finishBy) return;
    if (f0 && f0 > p.finishBy && R.finish <= f0) return;   // it was already late and did not get later: the bar says so
    fitRun(why);   // v42: the dates follow straight away: re-plan to fit (you still see the changes first)
  }
  // v42: built-in re-plan when the AI isn't available: shorten critical tasks one day at a time (crashing: more crew),
  // never the protected ones (approvals, lead times, curing, inspections, milestones, started work), never below half
  var PROTECTED = /(council|approv|permit|certif|engineer|strata|lead.?time|order|deliver|supply|cur(e|ing)|dry|drying|set(ting)? time|flood test|water test|inspect|test|quote|handover|invoice|payment)/i;
  function squeezeFit(p0, why) {
    var fb = p0.finishBy, q = JSON.parse(JSON.stringify(p0)), R0 = rollup(q, today()), orig = {}, byId = {};
    p0.tasks.forEach(function (t) { orig[t.id] = t.dur; });
    q.tasks.forEach(function (t) { byId[t.id] = t; });
    var locked = function (t) { return t.dur === 0 || (t.pct || 0) > 0 || PROTECTED.test(t.name || ''); };
    for (var guard = 0; guard < 300; guard++) {
      var cur = rollup(q, today()).finish; if (cur <= fb) break;
      var best = null, bestFin = cur;
      q.tasks.forEach(function (t) {
        if (locked(t) || t.dur <= Math.ceil(orig[t.id] / 2) || t.dur <= 1) return;
        t.dur -= 1; var f = rollup(q, today()).finish; t.dur += 1;
        if (f < bestFin || (f === bestFin && best && f < cur && t.dur > best.dur)) { best = t; bestFin = f; }
      });
      if (!best || bestFin >= cur) break;
      best.dur -= 1; fitSubs(best);
    }
    var R1 = rollup(q, today()), num = {}; q.tasks.forEach(function (t, i) { num[t.id] = i + 1; });
    var changes = q.tasks.filter(function (t) { return t.dur !== orig[t.id]; }).map(function (t) {
      return { id: t.id, name: t.name, num: num[t.id], durFrom: orig[t.id], durTo: t.dur, afterFrom: t.pred || [], afterTo: t.pred || [], afterFromN: [], afterToN: [], why: 'More crew or longer hours on a critical task', extra: 0 };
    });
    var wf = weekendFinish(q), all = !!(p0.emergency || p0.weekends);
    return { local: true, fits: R1.finish <= fb, before: R0.finish, after: R1.finish, finishBy: fb, stillLate: R1.finish > fb ? workBetween(fb, R1.finish) - 1 : 0, changes: changes, refused: [], extraTotal: 0,
      summary: changes.length ? 'Critical tasks shortened by adding crew or working longer hours. Approvals, lead times, curing, inspections and milestones are left as they are.' : 'Nothing could be shortened safely.',
      tips: changes.length ? ['Check you can get the extra crew for these days, and agree any overtime cost with the customer.'] : [],
      risks: changes.length ? [{ title: 'Compressed schedule', cause: 'tasks shortened with more crew to meet the finish date', p: 3, i: 3, response: 'Mitigate', action: 'Book the crew early and check quality at each step' }] : [],
      weekend: wf && !all && R1.finish > fb ? { finish: weekendFinish(q), fits: weekendFinish(q) <= fb, stillLate: 0 } : null, rev: S.rev, why: why || '' };
  }
  function fitRun(why) {
    if (typeof why !== 'string') why = '';
    var p = S.plan, core = S.core, id = rid(), b = $('#fitGo');
    if (!p.finishBy) return;
    if (b) { b.disabled = true; b.textContent = 'AI is working it out…'; }
    S.fitId = id; var t0 = Date.now();
    M.modal('<h2>✨ Re-planning to finish by ' + esc(dmy(p.finishBy)) + '</h2>' + (why ? '<p>' + esc(why.charAt(0).toUpperCase() + why.slice(1)) + ', so the plan finished after your Finish by date. Working out new dates now.</p>' : '') + '<p class="ask-think">The AI is looking at the critical path and working out what can run side by side or be done faster… this usually takes 20–60 seconds.</p><div class="actions"><button class="btn" data-close type="button">Cancel</button></div>');
    var poll = function () {
      return new Promise(function (res) { setTimeout(res, 2000); }).then(function () { return api('planAiStatus', { id: id }); }).then(function (d) {
        if (S.fitId !== id) return;
        if (d.status === 'done' && d.fit) return fitShow(d.fit);
        if (d.status === 'error') throw new Error(d.error || 'The AI could not fit the plan');
        if (Date.now() - t0 > 170000) throw new Error('The AI is taking too long. Try again in a minute.');
        return poll();
      });
    };
    (S.timer ? saveNow() : (S.q || Promise.resolve())).then(function () {
      return fetch('/.netlify/functions/planai-background', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-MBS-Admin': '1', 'X-Champ-Lang': (window.ChampI18n && window.ChampI18n.get()) || 'en' },
        body: JSON.stringify({ id: id, mode: 'fit', core: core, finishBy: p.finishBy }) });
    }).then(function (r) {
      if (r.status === 401 || r.status === 403) throw new Error('Your session has ended. Sign in again.');
      if (r.status !== 202 && !r.ok) throw new Error('Could not start the AI (' + r.status + '). Try again.');
      return poll();
    }).catch(function (e) {
      if (S.fitId !== id) return;
      if (b) { b.disabled = false; b.textContent = '✨ Fit to finish-by'; }
      var sq = squeezeFit(S.plan, why); sq.aiError = e.message; fitShow(sq);   // v42: the AI isn't available: built-in re-plan instead
    });
  }
  function fitShow(f) {
    var p = S.plan; render();
    if (f.already) { M.closeModal(); toast('The plan already finishes by ' + dmy(f.finishBy)); return; }
    var head = f.fits ? '<div class="aifit ok">✅ With these changes the plan finishes <b>' + esc(dmy(f.after)) + '</b>, on time for ' + esc(dmy(f.finishBy)) + ' (it was ' + esc(dmy(f.before)) + ').</div>'
      : '<div class="aifit">⚠ The best the AI could do: finish <b>' + esc(dmy(f.after)) + '</b>, still ' + pl(f.stillLate, 'working day') + ' after ' + esc(dmy(f.finishBy)) + ' (it was ' + esc(dmy(f.before)) + '). Talk to the customer about a later date, or change the scope.</div>';
    var rows = (f.changes || []).map(function (c) {
      var what = [];
      if (c.durTo !== c.durFrom) what.push('Days ' + c.durFrom + ' → <b>' + c.durTo + '</b>');
      if (c.afterToN.join() !== c.afterFromN.join()) what.push('After # ' + (c.afterFromN.join(', ') || '–') + ' → <b>' + (c.afterToN.join(', ') || 'start') + '</b>' + (function () { var gone = c.afterFromN.filter(function (n) { return c.afterToN.indexOf(n) < 0; }); return gone.length ? ' (runs alongside #' + gone.join(', #') + ')' : ''; })());
      return '<tr><td>' + c.num + '</td><td>' + esc(c.name) + '</td><td>' + what.join('<br>') + '</td><td class="muted">' + esc(c.why || '') + '</td><td style="text-align:right">' + (c.extra ? money(c.extra) : '–') + '</td></tr>';
    }).join('');
    if (!f.weekend && !(p.emergency || p.weekends) && !f.fits) { var wf2 = weekendFinish(p); if (wf2) f.weekend = { finish: wf2, fits: wf2 <= f.finishBy, stillLate: wf2 > f.finishBy ? workBetween(f.finishBy, wf2) - 1 : 0 }; }
    var html = '<h2>✨ New dates to finish by ' + esc(dmy(f.finishBy)) + '</h2>' + head +
      (f.local ? '<p class="muted" style="font-size:12.5px">' + (f.aiError ? 'The AI isn\'t available right now (' + esc(f.aiError) + '), so the' : 'The') + ' plan was re-worked here: critical tasks shortened with more crew (crashing). ✨ Try the AI again later for fast-tracking too.</p>' : '') +
      (f.summary ? '<p>' + esc(f.summary) + '</p>' : '') +
      (rows ? '<div style="max-height:46vh;overflow:auto"><table class="mini"><thead><tr><th>#</th><th>Task</th><th>Change</th><th>Why</th><th style="text-align:right">Extra cost</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
        (f.extraTotal ? '<p><b>Extra cost: ' + money(f.extraTotal) + ' ex GST</b> (more crew or overtime). Add it to the tasks\' costs if the customer agrees to pay for the faster finish.</p>' : '')
        : '<p class="muted">The AI found nothing that could safely be changed.</p>') +
      ((f.refused || []).length ? '<p class="muted" style="font-size:12.5px">Kept as they are: ' + esc(f.refused.join('; ')) + '.</p>' : '') +
      ((f.tips || []).length ? '<ul class="muted" style="font-size:13px">' + f.tips.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') +
      ((f.risks || []).length && rows ? '<label class="qchk" style="margin:6px 0"><input type="checkbox" id="fitRisks" checked> Add ' + pl(f.risks.length, 'risk') + ' of the faster schedule to the Risks tab (' + esc(f.risks.map(function (r) { return r.title; }).join(', ')) + ')</label>' : '') +
      (f.weekend ? '<div class="aifit ' + (f.weekend.fits ? 'ok' : '') + '">📅 Allowing weekends (Sat, Sun) on top of ' + (rows ? 'these changes' : 'the plan') + ' would finish <b>' + esc(dmy(f.weekend.finish)) + '</b>' + (f.weekend.fits ? ': on time.' : ', still ' + pl(f.weekend.stillLate, 'day') + ' late.') + '</div>' : '') +
      '<div class="actions">' + (rows ? '<button class="btn btn-gold" id="fitUse" type="button">Use these changes</button>' : '') + (f.weekend ? '<button class="btn' + (rows ? '' : ' btn-gold') + '" id="fitUseWeek" type="button">' + (rows ? 'Use these changes + allow weekends' : 'Allow weekends') + '</button>' : '') + '<button class="btn" id="fitMove" type="button" title="Keep the plan and give the customer a later date">↔ Move Finish by to ' + esc(dmy(f.before)) + '</button><button class="btn" data-close type="button">Keep it as it is</button></div>';
    M.modal(html);
    var u = $('#fitUse'); if (u) u.onclick = function () { fitApply(f, !!($('#fitRisks') && $('#fitRisks').checked)); };
    var mv = $('#fitMove'); if (mv) mv.onclick = function () { p.finishBy = f.before; dirty('finish by ' + f.before); M.closeModal(); render(); toast('Finish by moved to ' + dmy(f.before)); };
    var uw = $('#fitUseWeek'); if (uw) uw.onclick = function () { fitApply(f, !!($('#fitRisks') && $('#fitRisks').checked), true); };
  }
  function fitApply(f, addRisks, weekends) {
    var p = S.plan;
    if (!f.local && (p.rev || 0) !== (f.rev || 0) && S.rev !== f.rev) { M.closeModal(); toast('The plan changed while the AI was working. Press ✨ Fit to finish-by again.', true); return; }
    S.fitUndo = { core: S.core, plan: JSON.parse(JSON.stringify(p)) };
    if (weekends) p.weekends = true;
    var byId = {}; p.tasks.forEach(function (t) { byId[t.id] = t; });
    f.changes.forEach(function (c) { var t = byId[c.id]; if (!t) return; t.dur = c.durTo; t.pred = c.afterTo.filter(function (x) { return byId[x]; }); fitSubs(t); derive(t); });
    if (addRisks) (f.risks || []).forEach(function (r, i) { p.risks.push({ id: 'r' + Date.now().toString(36) + i, title: r.title, cause: r.cause, p: r.p, i: r.i, response: r.response, action: r.action, owner: (p.charter || {}).manager || '', review: '', status: 'Open', raised: today() }); });
    p.charter = p.charter || {};
    p.charter.assumptions = ('Schedule brought in to finish by ' + dmy(f.finishBy) + ' (' + pl(f.changes.length, 'task') + ' changed' + (weekends ? ', Saturday and Sunday work' : '') + (f.extraTotal ? ', extra cost ' + money(f.extraTotal) + ' ex GST' : '') + ').\n' + (p.charter.assumptions || '')).trim().slice(0, 2000);
    var Rn = rollup(p, today()), R0f = rollup(S.fitUndo.plan, today()), me = bomMe();
    var fc = crNew({ title: 'Schedule brought in to finish by ' + dmy(f.finishBy), source: 'fit', direct: true, raisedBy: me, status: 'Implemented', implementedAt: Date.now(),
      desc: pl(f.changes.length, 'task') + ' changed' + (weekends ? ', Saturday and Sunday work allowed' : '') + (f.extraTotal ? ', extra cost ' + money(f.extraTotal) + ' ex GST' : '') + '.',
      reason: 'Fit the plan to the Finish by date.', estDays: R0f.finish && Rn.finish ? (Rn.finish < R0f.finish ? -workBetween(Rn.finish, R0f.finish) : workBetween(R0f.finish, Rn.finish)) : 0, estCost: Rn.BAC - R0f.BAC });
    fc.decision = { by: me, role: 'Project manager', at: Date.now(), note: 'Applied directly with ✨ Fit to finish-by (no change control board review).', sig: '', outcome: 'Approved' };
    fc.effect = { days: fc.estDays, cost: fc.estCost, f0: R0f.finish || '', f1: Rn.finish || '', b0: R0f.BAC || 0, b1: Rn.BAC || 0, est: false };
    crLog(fc, 'Applied directly by ' + me + ' with Fit to finish-by');
    M.closeModal(); dirty('AI fitted the plan to finish by ' + f.finishBy + ' (' + crNo(fc) + ')'); render(); crRecord(fc, true);
    toast('Plan updated: finishes ' + dmy(Rn.finish) + (Rn.finish <= f.finishBy ? ', on time' : '') + '. Press ↶ Undo the AI changes to put it back.');
  }
  function fitUndo() {
    if (!S.fitUndo || S.fitUndo.core !== S.core) return;
    var keepRev = S.plan.rev; S.plan = normalise(S.fitUndo.plan); S.plan.rev = keepRev; S.fitUndo = null;
    dirty('undid the AI finish-by changes'); render(); toast('The plan is back the way it was before the AI changes');
  }
  function render() {
    pplLoad();   // v86: People for the pickers (once)
    var L0 = $('#gLeft'), R0 = $('#gRight');
    var st = { y: window.scrollY, x: window.scrollX, lt: L0 ? L0.scrollTop : 0, ll: L0 ? L0.scrollLeft : 0, rl: R0 ? R0.scrollLeft : null, tab: S.tab, core: S.core };
    var a = document.activeElement, focus = null;
    if (a && a !== document.body && a.closest && a.closest('#view')) {
      var row = a.closest('[' + ROWS.join('],[') + ']'), dt = a.classList.contains('dtext'), el = dt ? a.parentNode.querySelector('.dnative') : a;
      var key = KEYS.filter(function (k) { return el.hasAttribute(k); })[0];
      focus = { id: el.id, row: row ? ROWS.filter(function (k) { return row.hasAttribute(k); }).map(function (k) { return '[' + k + '="' + row.getAttribute(k) + '"]'; })[0] : '', key: key ? '[' + key + (el.getAttribute(key) ? '="' + el.getAttribute(key) + '"' : '') + ']' : '', dt: dt,
        s: typeof a.selectionStart === 'number' ? a.selectionStart : null, e: typeof a.selectionEnd === 'number' ? a.selectionEnd : null };
    }
    renderNow();
    dateBoxes(V());
    if (st.tab === S.tab && st.core === S.core) {
      var L1 = $('#gLeft'), R1 = $('#gRight');
      if (L1) { L1.scrollTop = st.lt; L1.scrollLeft = st.ll; }
      if (R1) { R1.scrollTop = st.lt; if (st.rl != null) R1.scrollLeft = st.rl; }
      window.scrollTo(st.x, st.y);
    }
    if (focus) {
      var n = focus.id ? document.getElementById(focus.id) : focus.key ? V().querySelector((focus.row ? focus.row + ' ' : '') + focus.key) : null;
      if (n && focus.dt) n = n.parentNode.querySelector('.dtext');
      if (n && !n.disabled) { try { n.focus({ preventScroll: true }); if (focus.s != null && n.setSelectionRange && /^(text|search|tel|url|)$/.test(n.type || '')) n.setSelectionRange(focus.s, focus.e); } catch (e) {} }
    }
  }
  function renderNow() {
    var p = S.plan, R = rollup(p, today());
    $('#title').textContent = 'Project plan';
    var tabs = [['overview', '◎ Overview'], ['schedule', '▤ Schedule & Gantt'], ['budget', '💰 Costing'], ['critical', '⚡ Critical path'], ['board', '▦ Board'], ['bom', '🧱 BOM']].concat([['stake', '👥 Stakeholders'], ['scope', '🎯 Scope'], ['risks', '⚠ Risks'], ['issues', '❗ Issues'], ['contracts', '📜 Contracts'], ['comms', '📞 Comms'], ['reports', '📊 Reports'], ['swms', '🦺 SWMS'], ['change', '🔁 Change control'], ['intel', '🧠 Project Intelligence']]);
    var MODS = S.mods || {}; tabs = tabs.filter(function (t) { return MODS[t[0]] !== false; });   // GKH Project Champ: optional modules switched off
    if (MODS[S.tab] === false) S.tab = 'overview';
    var sub = !!(M.me && M.me.scope), hide = sub ? ' style="display:none"' : '';   // v91: a sub-contractor signed in to this project
    V().innerHTML = (sub ? '<div class="plan-subbie">👷 Signed in as a sub-contractor (' + esc(M.me.name || M.me.user) + ') for project <b>' + esc(S.job.ref) + '</b>. ' + ((M.me.mods || {}).projects === 'edit' ? 'You can update this project.' : 'View only.') + '</div>' : '') +
      '<div class="row" style="margin-bottom:12px">' + (sub ? '' : '<a class="btn btn-sm" href="#job/' + esc(S.core) + '">← ' + esc(S.job.ref) + '</a>') +
      '<h2 style="font-size:21px">' + esc(p.name) + '</h2><span class="muted">' + esc(S.job.name + (S.job.title ? ': ' + S.job.title : '')) + '</span><span class="sp"></span>' +
      (sub ? '' : '<span class="mod-wrap"><button type="button" class="btn btn-sm mod-btn" id="modBtn" aria-haspopup="true" aria-expanded="false" title="Switch optional modules on or off for this project">⚙ Modules <small>' + ['bom', 'swms'].filter(function (m) { return (S.mods || {})[m] !== false; }).map(function (m) { return m.toUpperCase(); }).join(' · ') + '</small></button></span>') + '<span class="muted" id="planSave" style="font-size:13px">' + (S.timer || S.busy ? 'Saving…' : 'Saved ✓') + '</span><button class="btn btn-sm btn-gold" id="planQuote"' + hide + ' title="Work out the costing for this project: cost by phase and category (with the signed-off BOM), contingency, reserve and cash flow">💰 Costing</button><button class="btn btn-sm" id="planBase" title="Freeze today\'s dates and costs to compare against">📌 ' + (p.baseline ? 'Re-set baseline' : 'Set baseline') + '</button><button class="btn btn-sm" id="planWide" title="Hide the menu and use the whole screen">⛶ ' + (document.body.classList.contains('plan-wide') ? 'Normal view' : 'Wide view') + '</button><button class="btn btn-sm" id="planXls" title="Download the whole plan as an Excel workbook">⬇ Excel</button><button class="btn btn-sm" id="planCsv" title="Export the Gantt chart (tasks, dates, links) as CSV, Microsoft Project XML, Excel or calendar, for Microsoft Project, Primavera, Smartsheet, Asana, Monday.com and others">⬇ Gantt export</button><button class="btn btn-sm" onclick="window.print()">🖨 Print</button><button class="btn btn-sm btn-danger" id="planDel"' + hide + ' title="Delete this project and everything in it">🗑 Delete project</button></div>' +
      '<div id="planChain"></div>' +
      '<div class="grid pkpis">' +
        mini('Scope', R.pct + '% complete', R.done + ' of ' + R.total + ' tasks done', rag(R.total ? R.pct / Math.max(1, timePct(R)) : null, 0.95, 0.8)) +
        timeCard(p, R) +
        mini('Cost', money(R.AC) + ' of ' + money(R.BAC), (R.ACest > 0 ? money(R.ACest) + ' estimated from progress' + (R.ACin > 0 ? ' + ' + money(R.ACin) + ' actual' : ' (enter $ Actual for real costs)') : R.AC > 0 ? 'actual costs' : 'nothing spent yet') + (R.CPI == null ? '' : ' · CPI ' + R.CPI + ' · forecast ' + money(R.EAC)), evRag(R.CPI)) +
        mini('Risks & issues', pl((p.risks || []).filter(function (r) { return r.status !== 'Closed'; }).length, 'risk') + ' · ' + pl((p.issues || []).filter(function (x) { return x.status !== 'Resolved'; }).length, 'issue'), pl((p.risks || []).filter(function (r) { return r.status !== 'Closed' && r.p * r.i >= 12; }).length, 'high risk'), (p.risks || []).some(function (r) { return r.status !== 'Closed' && r.p * r.i >= 15; }) ? 'red' : (p.issues || []).some(function (x) { return x.status !== 'Resolved' && /High|Critical/.test(x.priority); }) ? 'amber' : 'green') +
      '</div>' +
      '<div class="tabs" id="planTabs">' + tabs.map(function (t) { return '<a class="tab' + (S.tab === t[0] ? ' on' : '') + '" href="#plan/' + esc(S.core) + '/' + t[0] + '" style="text-decoration:none">' + t[1] + '</a>'; }).join('') + '</div><div id="planBody"></div>';
    $('#planWide').onclick = function () { document.body.classList.toggle('plan-wide'); render(); };
    $('#planQuote').onclick = function () { location.hash = '#plan/' + S.core + '/budget'; };
    (function () { var l = (window.ChampI18n && window.ChampI18n.get()) || 'en', at = $('#planQuote'); if (l === 'en' || !at || $('#planTrData')) return;
      var b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-sm'; b.id = 'planTrData'; b.title = 'Write this project\'s data (task names, risks, BOM lines ...) in the console language'; b.textContent = '🌐 Translate project data';
      b.onclick = translateData;
      if (S.trUndo && S.trUndo.core === S.core) { b.textContent = '↶ Undo translation'; b.title = 'Put the project data back as it was before the translation'; b.onclick = function () { if (!S.trUndo || S.trUndo.core !== S.core) return; S.plan = S.trUndo.plan; S.trUndo = null; dirty('translation undone'); render(); toast('Translation undone'); }; }
      at.parentNode.insertBefore(b, at); })();   // GKH Project Champ: budgeting instead of quotes
    drawDocs();
    $('#planXls').onclick = function () { exportExcel(); };
    $('#planCsv').onclick = function () { ganttCsvDialog(); };
    $('#planDel').onclick = function () {   // GKH Project Champ: delete the whole project
      clearTimeout(S.timer); S.timer = null;
      var core = S.core;
      (S.q || Promise.resolve()).then(function () { return M.champDelete([{ core: core, name: p.name, ref: S.job.ref }]); }).then(function (ok) {
        if (ok) { S.plan = null; S.core = ''; location.hash = '#programs'; }
      });
    };
    if ($('#modBtn')) $('#modBtn').onclick = function (e) {   // GKH Project Champ: optional modules (BOM, SWMS) on or off
      e.stopPropagation();
      var btn = this, old = document.getElementById('modPop'); if (old) { old.remove(); btn.setAttribute('aria-expanded', 'false'); return; }
      var L = [['change', '🔁 Change control', 'Changes are reviewed, approved and signed before they go into the plan. Off (small projects): changes are committed straight away'], ['bom', '🧱 Bill of Materials (BOM)', 'Materials costed and signed off, then added to the costing'], ['swms', '🦺 SWMS', 'Safe Work Method Statements for high-risk construction work']];
      var pop = document.createElement('div'); pop.id = 'modPop'; pop.className = 'mod-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Modules');
      pop.innerHTML = '<b>Modules for this project</b>' + L.map(function (m) {
        return '<label class="mod-row"><span><b>' + m[1] + '</b><small>' + m[2] + '</small></span><span class="bom-switch"><input type="checkbox" data-mod="' + m[0] + '"' + ((S.mods || {})[m[0]] === false ? '' : ' checked') + '><span class="bom-slider"></span></span></label>';
      }).join('') + '<small class="muted">Off hides the tab for this project. Nothing is deleted: switch it back on and it is all still there.</small>';
      btn.parentNode.appendChild(pop); btn.setAttribute('aria-expanded', 'true');
      var shut = function (ev) { if (!pop.contains(ev.target) && ev.target !== btn) { pop.remove(); btn.setAttribute('aria-expanded', 'false'); document.removeEventListener('click', shut); } };
      setTimeout(function () { document.addEventListener('click', shut); }, 0);
      pop.querySelectorAll('[data-mod]').forEach(function (box) {
        box.onchange = function () {
          var mod = box.getAttribute('data-mod'), on = box.checked; box.disabled = true;
          api('planModuleSet', { core: S.core, mod: mod, on: on }).then(function () {
            S.mods = S.mods || {}; S.mods[mod] = on; if (!on && S.tab === mod) S.tab = 'overview';
            toast(({ bom: '🧱 Bill of Materials', swms: '🦺 SWMS', change: '🔁 Change control' }[mod] || mod) + (on ? ' switched on' : ' switched off for this project') + (mod === 'change' && !on ? ': changes are now committed straight away' : ''));
            document.removeEventListener('click', shut); render();
          }).catch(function (err) { box.checked = !on; box.disabled = false; fail(err); });
        };
      });
    };
    $('#planBase').onclick = function () {
      M.confirmBox(p.baseline ? 'Re-set the baseline?' : 'Set the baseline?', 'Saves today\'s planned dates and costs so you can see later how far the job moved (PMI baseline). ' + (p.baseline ? 'The old baseline from ' + M.day(p.baseline.at) + ' is replaced.' : ''), 'Set baseline').then(function (ok) {
        if (!ok) return; schedule(p); var tasks = {}; p.tasks.forEach(function (t) { tasks[t.id] = { es: t.es, ef: t.ef, cost: cost(t) }; });
        p.baseline = { at: Date.now(), finish: R.finish, BAC: R.BAC, tasks: tasks }; saveNow('baseline set'); toast('Baseline set'); render();
      });
    };
    ({ overview: overview, schedule: scheduleTab, budget: budgetTab, critical: criticalTab, board: board, bom: bomTab, scope: scope, risks: risks, issues: issues, stake: stakeholders, contracts: contractsTab, comms: commsTab, reports: reportsTab, swms: swmsTab, change: changeTab, intel: intelTab }[S.tab] || scheduleTab)(R);
  }
  function timePct(R) { var t = today(); if (!R.start || t < R.start) return 0; if (t >= R.finish) return 100; return Math.round(workBetween(R.start, t) / Math.max(1, workBetween(R.start, R.finish)) * 100); }
  function varDays(base, now) { var d = workBetween(base, now) - 1; if (now <= base) { d = -(workBetween(now, base) - 1); } return d === 0 ? 'on baseline' : d > 0 ? d + ' days behind baseline' : (-d) + ' days ahead of baseline'; }
  // Time card: Start, Finish and Duration in plain words, with the progress status underneath
  function timeCard(p, R) {
    var c = R.late.length ? 'red' : evRag(R.SPI), n = R.start && R.finish ? workBetween(R.start, R.finish) : 0;
    var wk = n >= 10 ? ' (about ' + pl(Math.round(n / (p.emergency || p.weekends ? 7 : 5)), 'week') + ')' : '';
    var row = function (k, v) { return '<dt>' + esc(k) + '</dt><dd>' + esc(v || '-') + '</dd>'; };
    var s = (R.SPI == null ? 'not started' : 'SPI ' + R.SPI) + (R.late.length ? ' · ' + R.late.length + ' late' : '') + (p.baseline && p.baseline.finish && R.finish ? ' · ' + varDays(p.baseline.finish, R.finish) : '');
    return '<div class="card kpi rag-card rag-b-' + c + '"><div class="k">Time <span class="dot dot-' + c + '"></span></div>' +
      '<dl class="tdl">' + row('Start', prettyY(R.start)) + row('Finish', prettyY(R.finish)) + row('Duration', n ? p.emergency || p.weekends ? pl(n, 'day') + ' (weekends included)' : pl(n, 'working day') + wk : '') + '</dl>' +
      '<div class="s">' + esc(s) + '</div></div>';
  }
  function mini(k, v, s, c) { return '<div class="card kpi rag-card rag-b-' + (c || 'grey') + '"><div class="k">' + esc(k) + ' <span class="dot dot-' + (c || 'grey') + '"></span></div><div class="v" style="font-size:20px">' + esc(v) + '</div><div class="s">' + esc(s) + '</div></div>'; }
  function ordered() {   // tasks in order, with their row numbers (like Microsoft Project's ID column)
    return S.plan.tasks.map(function (t, i) { return { t: t, n: i + 1 }; });
  }
  // stock items (Inventory) used by tasks
  function invItem(id) { return id && S.inv ? S.inv[id] : null; }
  function stockChip(t) {
    var ms = matsOf(t); if (!ms.length) return '';
    if (ms.length > 1) {
      var shortN = t.status !== 'done' ? ms.filter(function (m) { var x = invItem(m.item); return x && x.available < 0; }).length : 0;
      return '<span class="pkchip' + (shortN ? ' short' : '') + '" title="' + esc(ms.map(function (m) { var x = invItem(m.item); return (m.qty || 0) + ' × ' + (x ? x.name + ' (' + x.unit + ')' : m.item); }).join('\n')) + '">📦 ' + ms.length + ' items · ' + money(matCost(t)) + (shortN ? ' · ' + shortN + ' short' : '') + '</span>';
    }
    var i = invItem(ms[0].item), qn = Number(ms[0].qty) || 0;
    if (!i) return '<span class="pkchip">📦 ' + qn + ' × stock item ' + esc(ms[0].item) + '</span>';
    if (true) { var sh = t.status !== 'done' && i.available < 0; return '<span class="pkchip' + (sh ? ' short' : '') + '" title="' + esc(qn + ' ' + i.unit + ' of ' + i.name + ': ' + i.available + ' ' + i.unit + ' available after what jobs have set aside') + '">📦 ' + qn + ' × ' + esc(i.name) + ' · ' + (t.status === 'done' ? 'used' : sh ? 'short ' + (-i.available) + ' ' + esc(i.unit) : i.available + ' ' + esc(i.unit) + ' left') + '</span>'; }
    var short = t.status !== 'done' && i.available < 0;
    return '<span class="pkchip' + (short ? ' short' : '') + '" title="' + esc(i.name + ': ' + i.available + ' ' + i.unit + ' available after what jobs have set aside') + '">📦 ' + esc(i.name) + ' · ' + (t.status === 'done' ? 'used' : short ? 'short ' + (-i.available) + ' ' + esc(i.unit) : i.available + ' ' + esc(i.unit) + ' left') + '</span>';
  }
  // v56: 📦 materials on a task: any number of stock items, each with its own quantity (e.g. 4 × Paint 10L, 2 × Roller kit)
  function matsEditor(t) {
    if (!M.inv) return toast('Inventory is not available', true);
    var list = matsOf(t).map(function (m) { return { item: m.item, qty: m.qty, price: m.price }; }), all = [];
    var draw = function () {
      var tot = list.reduce(function (a, m) { return a + (Number(m.qty) || 0) * (Number(m.price) || 0); }, 0), q = (($('#mtQ') || {}).value || '').toLowerCase();
      $('#mtRows').innerHTML = list.length ? '<table class="mt-tbl"><thead><tr><th>Stock item</th><th class="num">Qty</th><th>Unit</th><th class="num">Price each</th><th class="num">Total</th><th class="num">Available</th><th></th></tr></thead><tbody>' + list.map(function (m, k) {
        var x = all.filter(function (i) { return i.id === m.item; })[0] || invItem(m.item) || { name: m.item, unit: '', available: '' };
        return '<tr data-mk="' + k + '"><td><b>' + esc(x.name) + '</b>' + (x.sku ? '<br><small class="muted">' + esc(x.sku) + '</small>' : '') + '</td><td class="num"><span class="mt-q"><button class="btn btn-sm" data-mq="-1" type="button" aria-label="Less">−</button><input data-mqty type="number" min="0" step="any" value="' + (m.qty || 0) + '"><button class="btn btn-sm" data-mq="1" type="button" aria-label="More">+</button></span></td>' +
          '<td>' + esc(x.unit || '') + '</td><td class="num"><input data-mprice type="number" min="0" step="any" value="' + (m.price || 0) + '" style="width:90px"></td><td class="num"><b>' + money((Number(m.qty) || 0) * (Number(m.price) || 0)) + '</b></td>' +
          '<td class="num' + (typeof x.available === 'number' && x.available < (Number(m.qty) || 0) && t.status !== 'done' ? ' bad' : '') + '">' + (x.available === '' ? '' : x.available + ' ' + esc(x.unit || '')) + '</td><td><button class="btn btn-sm" data-mdel type="button" title="Remove">✕</button></td></tr>';
      }).join('') + '</tbody><tfoot><tr><td colspan="4"><b>Materials on this task</b></td><td class="num"><b>' + money(tot) + '</b></td><td colspan="2"></td></tr></tfoot></table>'
        : '<div class="empty" style="padding:12px">No materials yet. Find a stock item below and press it to add it.</div>';
      var have = list.map(function (m) { return m.item; });
      var l = all.filter(function (i) { return !q || [i.name, i.sku, i.category].join(' ').toLowerCase().indexOf(q) >= 0; }).slice(0, 60);
      $('#mtList').innerHTML = l.length ? l.map(function (i) { var on = have.indexOf(i.id) >= 0;
        return '<button class="item pk' + (on ? ' on' : '') + '" data-madd="' + esc(i.id) + '" type="button"><div style="text-align:left"><b>' + esc(i.name) + '</b>' + (on ? ' <small class="muted">(on the task: + adds 1 more)</small>' : '') + '<br><small>' + [i.sku, i.category].filter(Boolean).map(esc).join(' · ') + '</small></div>' +
          '<div style="text-align:right"><b' + (i.low ? ' style="color:#B42318"' : '') + '>' + i.available + ' ' + esc(i.unit) + '</b><br><small>' + (i.price ? money(i.price) + '/' + esc(i.unit) : 'no price') + '</small></div></button>'; }).join('') : '<div class="empty">No stock items' + (q ? ' match' : ' yet') + '.</div>';
      var B = $('#modalBody');
      B.querySelectorAll('tr[data-mk]').forEach(function (tr) {
        var m = list[+tr.getAttribute('data-mk')];
        tr.querySelector('[data-mqty]').onchange = function () { m.qty = Math.max(0, parseFloat(this.value) || 0); draw(); };
        tr.querySelector('[data-mprice]').onchange = function () { m.price = Math.max(0, parseFloat(this.value) || 0); draw(); };
        tr.querySelectorAll('[data-mq]').forEach(function (b) { b.onclick = function () { m.qty = Math.max(0, Math.round(((Number(m.qty) || 0) + Number(b.getAttribute('data-mq'))) * 1000) / 1000); draw(); }; });
        tr.querySelector('[data-mdel]').onclick = function () { list.splice(+tr.getAttribute('data-mk'), 1); draw(); };
      });
      B.querySelectorAll('[data-madd]').forEach(function (b) { b.onclick = function () {
        var id = b.getAttribute('data-madd'), x = all.filter(function (i) { return i.id === id; })[0], m = list.filter(function (y) { return y.item === id; })[0];
        if (m) m.qty = (Number(m.qty) || 0) + 1; else list.push({ item: id, qty: 1, price: x.price || 0 });
        S.inv = S.inv || {}; S.inv[id] = x; draw();
        var r = $('#mtRows tr[data-mk="' + (m ? list.indexOf(m) : list.length - 1) + '"] [data-mqty]'); if (r) { r.focus(); r.select(); }
      }; });
    };
    M.inv.load().then(function (d) {
      all = (d.items || []).filter(function (i) { return !i.archived; }); S.inv = S.inv || {}; all.forEach(function (i) { S.inv[i.id] = i; });
      M.modal('<h2>📦 Materials for “' + esc(t.name) + '”</h2><p class="muted" style="margin:4px 0 10px">Add as many stock items as the task needs, each with its quantity (e.g. 4 buckets of paint). While the task is not done the quantities are set aside; when it is Done they are taken out of stock. The task cost adds them up.</p>' +
        '<div id="mtRows"></div><h3 style="font-size:14px;margin:14px 0 6px">Add from stock</h3><input id="mtQ" placeholder="Search stock: name, code or category…" autocomplete="off"><div class="list" id="mtList" style="margin-top:8px;max-height:34vh;overflow:auto"></div>' +
        '<div class="actions" style="justify-content:space-between;margin-top:12px"><a class="btn" href="#inventory">Manage stock</a><span><button class="btn" data-close type="button">Cancel</button> <button class="btn btn-gold" id="mtSave" type="button">Save materials</button></span></div>');
      $('#modal .modal-card').classList.add('sc-wide');
      $('#mtQ').oninput = draw; draw(); $('#mtQ').focus();
      $('#mtSave').onclick = function () {
        var before = matsOf(t).length;
        t.mats = list.filter(function (m) { return m.item; }).map(function (m) { return { item: m.item, qty: Number(m.qty) || 0, price: Number(m.price) || 0 }; });
        if (t.mats.length && /^New (task|milestone)$/.test(t.name)) t.name = 'Supply ' + (S.inv[t.mats[0].item] || {}).name + (t.mats.length > 1 ? ' and ' + (t.mats.length - 1) + ' more' : '');
        M.closeModal(); dirty('materials on ' + t.name + ': ' + t.mats.length + ' item' + (t.mats.length === 1 ? '' : 's')); render();
        toast(t.mats.length ? pl(t.mats.length, 'stock item') + ' on “' + t.name + '”: ' + money(matCost(t)) : before ? 'Materials removed' : 'No materials');
      };
    }).catch(fail);
  }
  function loadInv() { return M.inv ? M.inv.load().then(function (d) { S.inv = {}; d.items.forEach(function (i) { S.inv[i.id] = i; }); bomBaseNow(); }).catch(function () {}) : Promise.resolve(); }
  function bomBaseNow() {   // v89: what this plan has set aside when the stock levels were read (so the BOM does not count it twice)
    var base = {}; if (S.plan && S.plan.tasks) S.plan.tasks.forEach(function (t) { if (t.status === 'done') return; matsOf(t).forEach(function (m) { base[m.item] = Math.round(((base[m.item] || 0) + (Number(m.qty) || 0)) * 1000) / 1000; }); });
    S.bomBase = base;
  }
  function resCell(t) {
    var r = t.res || [];
    return '<div class="rbox">' + r.map(function (name) {
      var lead = name === t.lead;
      return '<span class="rchip' + (lead ? ' lead' : '') + '"><button type="button" class="rname" data-rlead="' + esc(name) + '" title="' + (lead ? 'Lead for this task' : 'Make ' + esc(name) + ' the lead') + '">' + (lead ? '★ ' : '') + esc(name) + '</button><button type="button" class="rx" data-rx="' + esc(name) + '" title="Remove">×</button></span>';
    }).join('') + '<input class="radd" data-radd list="resList" placeholder="' + (r.length ? '+ add' : 'Type a name') + '" aria-label="Add a person or trade"></div>';
  }

  /* ---------- schedule grid + Gantt ---------- */
  /* ---------- v78: ✨ indicative costs: AI benchmarks, clearly marked until the consultant reviews them ---------- */
  function isEst(t) { return !!t.est && cost(t) > 0; }
  function estAttr(t) { return isEst(t) ? ' class="est-in" title="' + esc('Indicative benchmark: ' + (t.basis || 'AI estimate') + '. Change it to mark it reviewed.') + '"' : ''; }
  function estOf(p) { var n = 0, sum = 0; (p.tasks || []).forEach(function (t) { if (isEst(t)) { n++; sum += cost(t); } }); return { n: n, sum: r2(sum) }; }
  function estBanner(p) {
    var e = estOf(p), u = S.estUndo && S.estUndo.core === S.core;
    if (!e.n && !u) return '';
    return '<div class="est-warn"><div class="est-ic">⚠</div><div class="est-tx"><b>Indicative costs: a reference benchmark only, not a price.</b> ' +
      (e.n ? pl(e.n, 'task') + ' (' + money(e.sum) + ' of the budget) have costs worked out by AI from Australian and international benchmarks. ' : '') +
      'Real hours, rates and quantities differ on every job: an 8-day feasibility study may be 5 hours a day, not 8. <b>The consultant must review and change every one before quoting, setting the budget or reporting costs. Using them unchanged will lead to complications.</b> ' +
      'Changing a task\'s Qty, Unit or Unit $ marks it reviewed; the ≈ est tag shows which are left.' +
      '<div class="est-b">' + (e.n && S.cols !== 'c' && S.tab === 'schedule' ? '<button class="btn btn-sm" type="button" data-estshow>$ Show the costs</button>' : '') + (u ? '<button class="btn btn-sm" type="button" data-estundo>↶ Undo the indicative costs</button>' : '') +
      (e.n ? '<button class="btn btn-sm" type="button" data-estok>✓ I have reviewed them all</button>' : '') + '</div></div></div>';
  }
  function estWire(B) {
    var a = B.querySelector('#estAi'); if (a) a.onclick = estDialog;
    var sh = B.querySelector('[data-estshow]'); if (sh) sh.onclick = function () { S.cols = 'c'; try { localStorage.setItem('mbsPlanCols', 'c'); } catch (e) {} render(); };
    var un = B.querySelector('[data-estundo]'); if (un) un.onclick = function () {
      var u = S.estUndo; if (!u || u.core !== S.core) return;
      S.plan.tasks.forEach(function (t) { var o = u.prev[t.id]; if (o) { t.qty = o.qty; t.unit = o.unit; t.rate = o.rate; t.est = o.est; t.basis = o.basis; } });
      S.estUndo = null; dirty('Indicative costs undone'); render(); toast('Indicative costs removed: back to what you had');
    };
    var ok = B.querySelector('[data-estok]'); if (ok) ok.onclick = function () {
      var e = estOf(S.plan);
      M.confirmBox('Mark all indicative costs as reviewed?', 'Only do this if you have checked all ' + pl(e.n, 'task') + ' (' + money(e.sum) + '): the hours actually worked per day, the rates and the quantities for this job. The ≈ est tags and these warnings will go, and the costs will be treated as yours on quotes, the charter and reports.', 'Yes, I have reviewed them').then(function (y) {
        if (!y) return; S.plan.tasks.forEach(function (t) { if (t.est) t.est = false; }); S.estUndo = null; dirty('Indicative costs reviewed'); render(); toast('Costs marked as reviewed');
      });
    };
  }
  // v78: on the test site, sample plans get indicative costs the first time they are opened (once per plan; marked ≈ est until reviewed)
  function estAuto() {
    var p = S.plan; if (!p || !S.isTest || p.estAuto || S.estId) return;
    var work = p.tasks.filter(function (t) { return t.dur > 0; }); if (!work.length) return;
    var R = rollup(p, today()), zero = work.filter(function (t) { return cost(t) <= 0; });
    var low = S.bench && R.BAC < S.bench.total * 0.5;
    if (!low && zero.length < work.length * 0.4) return;
    var ids = (low ? work : zero).map(function (t) { return t.id; });
    p.estAuto = today(); dirty('');
    estRun(ids, '', { auto: true, target: S.bench ? S.bench.total : 0 });
  }
  function estDialog() {
    var p = S.plan, work = p.tasks.filter(function (t) { return t.dur > 0; }), none = work.filter(function (t) { return cost(t) <= 0; }), open = work.filter(function (t) { return cost(t) <= 0 || t.est; });
    if (!work.length) return toast('Add some tasks first');
    M.modal('<h2>✨ Indicative costs</h2>' +
      '<div class="est-warn est-in-dlg"><div class="est-ic">⚠</div><div class="est-tx"><b>A reference benchmark only.</b> The AI estimates each task from Australian and international benchmarks: hours actually worked per day × people × a typical rate, or a lump sum for materials, equipment and fees. ' +
      'It cannot know your job: an 8-day feasibility study may be 5 hours a day, not 8, and rates vary. <b>You must review and change every cost before you quote or set the budget.</b> Using them unchanged will lead to complications.</div></div>' +
      '<div class="est-opts"><label><input type="radio" name="estW" value="none" checked> <span><b>Tasks with no cost yet</b> <small>' + pl(none.length, 'task') + '</small></span></label>' +
      '<label><input type="radio" name="estW" value="open"> <span><b>Also re-estimate the AI costs you have not reviewed</b> <small>' + pl(open.length, 'task') + '; costs you entered or reviewed are never changed</small></span></label></div>' +
      (S.bench ? '<label class="est-bench"><input type="checkbox" id="estTgt" checked> <span><b>Size it to the benchmark: about ' + money(S.bench.total) + '</b><small>' + esc(S.bench.basis) + '. Lump sums are scaled to reach it; hourly labour stays as estimated.</small></span></label>' : '') +
      '<label style="margin-top:10px">Anything the AI should know? <small class="muted">(optional)</small><input id="estNote" maxlength="300" placeholder="e.g. Tier IV fit-out; consultant rate $250/h; crews of 4"></label>' +
      '<div class="actions"><button class="btn" data-close type="button">Cancel</button><button class="btn btn-gold" id="estGo" type="button"' + (open.length ? '' : ' disabled') + '>✨ Work out the costs</button></div>');
    var sel = function () { return document.querySelector('[name=estW]:checked').value === 'open' ? open : none; };
    var upd = function () { $('#estGo').disabled = !sel().length; }; document.querySelectorAll('[name=estW]').forEach(function (r) { r.onchange = upd; }); upd();
    $('#estGo').onclick = function () { estRun(sel().map(function (t) { return t.id; }), $('#estNote').value.trim(), { target: S.bench && $('#estTgt') && $('#estTgt').checked ? S.bench.total : 0 }); };
  }
  function estRun(ids, note, o) {
    o = o || {}; var core = S.core, id = rid(), t0 = Date.now(); S.estId = id;
    if (o.auto) toast('Adding sample indicative costs to this plan (benchmarks)…'); else M.modal('<h2>✨ Indicative costs</h2><p class="ask-think">The AI is benchmarking ' + pl(ids.length, 'task') + ': hours per day, people, rates and lump sums… this usually takes 20–90 seconds.</p><div class="actions"><button class="btn" data-close type="button">Cancel</button></div>');
    var poll = function () {
      return new Promise(function (res) { setTimeout(res, 2000); }).then(function () { return api('planAiStatus', { id: id }); }).then(function (d) {
        if (S.estId !== id) return;
        if (d.status === 'done' && d.cost) { if (S.core !== core) return; S.estId = null; return o.auto ? estApply(d.cost, true) : estShow(d.cost); }
        if (d.status === 'error') throw new Error(d.error || 'The AI could not work out the costs');
        if (Date.now() - t0 > 290000) throw new Error('The AI is taking too long. Try again in a minute.');
        return poll();
      });
    };
    (S.timer ? saveNow() : (S.q || Promise.resolve())).then(function () {
      return fetch('/.netlify/functions/planai-background', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-MBS-Admin': '1', 'X-Champ-Lang': (window.ChampI18n && window.ChampI18n.get()) || 'en' }, body: JSON.stringify({ id: id, mode: 'cost', core: core, ids: ids, note: note, target: o.target || 0 }) });
    }).then(function (r) { if (r.status === 401 || r.status === 403) throw new Error('Your session has ended. Sign in again.'); if (r.status >= 400) throw new Error('Could not start the AI (' + r.status + ')'); return poll(); })
      .catch(function (e) { if (S.estId !== id) return; S.estId = null; if (!o.auto) M.closeModal(); fail(e); });
  }
  function estRows(r) {
    var by = {}; S.plan.tasks.forEach(function (t) { by[t.id] = t; });
    return r.costs.filter(function (c) { var t = by[c.id]; return t && (cost(t) <= 0 || t.est || r.target); });
  }
  function estApply(r, auto) {
    var by = {}, rows = estRows(r), prev = {}; S.plan.tasks.forEach(function (t) { by[t.id] = t; });
    rows.forEach(function (c) { var t = by[c.id]; prev[t.id] = { qty: t.qty, unit: t.unit, rate: t.rate, est: !!t.est, basis: t.basis || '' }; t.qty = c.qty; t.unit = c.unit; t.rate = c.rate; t.est = true; t.basis = c.basis || 'AI benchmark'; });
    S.estUndo = { core: S.core, prev: prev }; M.closeModal(); dirty('Indicative costs added (' + rows.length + ' tasks)'); render();
    var R = rollup(S.plan, today());
    toast((auto ? 'Sample indicative costs added: ' : 'Indicative costs added: ') + pl(rows.length, 'task') + ', plan budget now ' + money(R.BAC) + '. Review and change each one (marked ≈ est).');
  }
  function estShow(r) {
    var p = S.plan, num = {}, by = {}; ordered().forEach(function (x) { num[x.t.id] = x.n; }); p.tasks.forEach(function (t) { by[t.id] = t; });
    var rows = estRows(r).sort(function (a, b) { return (num[a.id] || 0) - (num[b.id] || 0); });
    var tot = r2(rows.reduce(function (a, c) { return a + c.qty * c.rate; }, 0)), R0 = rollup(p, today());
    M.modal('<h2>✨ Indicative costs: ' + pl(rows.length, 'task') + ', ' + money(tot) + '</h2>' +
      '<div class="est-warn est-in-dlg"><div class="est-ic">⚠</div><div class="est-tx"><b>Reference benchmarks only, based on our research of Australian and international benchmarks.</b> Check the basis of each one: the hours actually worked per day, the people, the rate and the quantity. ' +
      '<b>Change them for accuracy before you quote or set the budget.</b> They stay marked <span class="est-tag">≈ est</span> until you change them.' + (r.scaled ? '<br><b>' + esc(r.scaled) + '</b>' : '') + (r.builtIn ? '<br><i>The AI was not available' + (r.why ? ' (' + esc(r.why) + ')' : '') + ', so these come from the console\'s built-in benchmarks: rougher still.</i>' : '') + (r.caveat ? '<br><i>Biggest uncertainty: ' + esc(r.caveat) + '</i>' : '') + '</div></div>' +
      '<div class="table-wrap" style="max-height:44vh;overflow:auto"><table class="mini est-tbl"><thead><tr><th>#</th><th>Task</th><th>Basis</th><th class="num">Qty</th><th>Unit</th><th class="num">Unit $</th><th class="num">Cost</th></tr></thead><tbody>' +
      rows.map(function (c) { var t = by[c.id]; return '<tr><td>' + (num[c.id] || '') + '</td><td>' + esc(t.name) + '<br><small class="muted">' + pl(t.dur, 'day') + '</small></td><td class="muted">' + esc(c.basis || '–') + '</td><td class="num">' + c.qty + '</td><td>' + esc(c.unit) + '</td><td class="num">' + money(c.rate) + '</td><td class="num"><b>' + money(r2(c.qty * c.rate)) + '</b></td></tr>'; }).join('') +
      '</tbody><tfoot><tr><td></td><td colspan="5"><b>Total indicative</b> <small class="muted">(plan budget now ' + money(R0.BAC) + ')</small></td><td class="num"><b>' + money(tot) + '</b></td></tr></tfoot></table></div>' +
      '<label class="est-ack"><input type="checkbox" id="estAck"> I understand these are indicative benchmarks only, and I will review and change them before quoting or setting the budget.</label>' +
      '<div class="actions"><button class="btn" data-close type="button">Cancel</button><button class="btn btn-gold" id="estApply" type="button" disabled>Add them as indicative costs</button></div>');
    $('#estAck').onchange = function () { $('#estApply').disabled = !this.checked || !rows.length; };
    $('#estApply').onclick = function () { estApply(r, false); };
  }

  // v84: delete a task (with its sub-tasks) or a sub-task, from the Schedule or the Board; the links close up; ↶ Undo
  function taskDelete(t) {
    var p = S.plan; if (!t) return;
    var nm = String(t.name || '').replace(/^[✓◆\s]+/, '').trim() || 'this untitled task', ns = (t.subs || []).length, after = p.tasks.filter(function (x) { return (x.pred || []).indexOf(t.id) >= 0; });
    M.confirmBox('Delete “' + nm + '”' + (ns ? ' and its ' + pl(ns, 'sub-task') : '') + '?', (after.length ? pl(after.length, 'task') + ' that came after it will now wait for what it was waiting for, so the order stays. ' : '') + 'You can undo it straight after.', 'Delete', true).then(function (ok) { if (!ok) return;
      var snap = JSON.parse(JSON.stringify(p.tasks));
      p.tasks = p.tasks.filter(function (x) { return x !== t; });
      p.tasks.forEach(function (x) { var i = (x.pred || []).indexOf(t.id); if (i < 0) return; x.pred.splice(i, 1); (t.pred || []).forEach(function (id) { if (x.pred.indexOf(id) < 0 && id !== x.id) x.pred.push(id); }); });   // keep the chain: A → (deleted) → C becomes A → C
      dirty('task deleted: ' + nm); render(); undoBar('Deleted “' + nm + '”' + (ns ? ' and ' + pl(ns, 'sub-task') : ''), function () { S.plan.tasks = snap; dirty('task restored: ' + nm); render(); });
    });
  }
  function subDelete(t, sb) {
    if (!t || !sb) return;
    var keep = JSON.parse(JSON.stringify(t)), nm = String(sb.name || '').trim() || 'untitled sub-task';
    t.subs = t.subs.filter(function (x) { return x !== sb; }); derive(t); if (!t.subs.length) setStatus(t, t.status); dirty('sub-task deleted: ' + nm); render();
    undoBar('Deleted “' + nm + '”', function () { var x = S.plan.tasks.filter(function (y) { return y.id === keep.id; })[0]; if (x) { x.subs = keep.subs; x.pct = keep.pct; x.status = keep.status; } dirty('sub-task restored: ' + nm); render(); });
  }
  function stepAdd(t, sb) {
    sb.steps = sb.steps || []; var D = Math.max(1, sb.dur), last = sb.steps[sb.steps.length - 1], off = last ? Math.min(D - 1, last.off + last.dur) : 0;
    if (last && last.off + last.dur >= D) off = last.off;   // the story is full: start alongside the last one
    var q = { id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 4), name: 'New step', off: off, dur: 1, done: false };
    sb.steps.push(q); fitSteps(sb); derive(t); S.stClosed[sb.id] = false; S.closed[t.id] = false; dirty('step added to ' + sb.name); render();
    setTimeout(function () { var i = $('#planBody tr[data-qid="' + q.id + '"] [data-qk=name]'); if (i) { i.focus(); i.select(); } }, 30);
    return q;
  }
  function stepDelete(t, sb, q) {
    if (!t || !sb || !q) return;
    var keep = JSON.parse(JSON.stringify(sb.steps)), nm = String(q.name || '').trim() || 'untitled step';
    sb.steps = sb.steps.filter(function (x) { return x !== q; }); derive(t); dirty('step deleted: ' + nm); render();
    undoBar('Deleted step “' + nm + '”', function () { var x = S.plan.tasks.filter(function (y) { return y.id === t.id; })[0], y = x && (x.subs || []).filter(function (z) { return z.id === sb.id; })[0]; if (y) { y.steps = keep; derive(x); } dirty('step restored: ' + nm); render(); });
  }
  function undoBar(msg, fn) {   // v84: a few seconds to take a delete back
    var old = document.getElementById('undoBar'); if (old) old.remove(); clearTimeout(S.undoT);
    var d = document.createElement('div'); d.id = 'undoBar'; d.className = 'undo-bar'; d.innerHTML = '<span>' + esc(msg) + '</span><button type="button" class="btn btn-sm">↶ Undo</button>';
    document.body.appendChild(d);
    d.querySelector('button').onclick = function () { d.remove(); clearTimeout(S.undoT); fn(); toast('Undone'); };
    S.undoT = setTimeout(function () { d.remove(); }, 9000);
  }
  function scheduleTab(R) {
    var p = S.plan, rows = ordered(), num = {}, idOf = {};
    rows.forEach(function (r) { num[r.t.id] = r.n; idOf[r.n] = r.t.id; });
    var t0 = today();
    var from = R.start ? toS(new Date(toD(R.start).getTime() - 2 * 864e5)) : t0, to = R.finish ? toS(new Date(toD(R.finish).getTime() + 6 * 864e5)) : t0;
    if (t0 < from) from = t0; if (t0 > to) to = toS(new Date(toD(t0).getTime() + 3 * 864e5));
    var dayW = S.zoom === 'week' ? 7 : 20, days = daysBetween(from, to) + 1, W = days * dayW;
    var x = function (s) { return daysBetween(from, s) * dayW; };
    var firstW = toD(from).getUTCDay(), satOff = ((6 - firstW + 7) % 7) * dayW;
    var weekendBg = p.emergency || p.weekends ? '' : 'background-image:repeating-linear-gradient(90deg,transparent 0,transparent ' + satOff + 'px,rgba(0,0,0,.045) ' + satOff + 'px,rgba(0,0,0,.045) ' + (satOff + 2 * dayW) + 'px,transparent ' + (satOff + 2 * dayW) + 'px,transparent ' + 7 * dayW + 'px);background-size:' + 7 * dayW + 'px 100%';
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
      var lab = '<span class="glab" style="left:' + ((t.dur === 0 ? left + dayW : left + w) + 4) + 'px">' + stkBtn(t, 'pin') + (t.dur === 0 ? esc(pretty(t.es)) + ' ' : '') + '<b class="gpct">' + t.pct + '%</b> ' + esc(resShort(t)) + '</span>';
      if (t.dur === 0) return b + '<span class="gmile' + (t.pct >= 100 ? ' done' : '') + '" style="left:' + (left + dayW / 2 - 7) + 'px" title="' + esc(t.name + ' · ' + pretty(t.es) + ' · ' + stName[t.status]) + '"></span>' + lab;
      return b + '<span class="gbar st-' + t.status + ' pb-' + pband(t.pct) + (late ? ' late' : '') + '" style="left:' + left + 'px;width:' + w + 'px" title="' + esc(t.name + ' · ' + pretty(t.es) + ' – ' + pretty(t.ef) + ' · ' + stName[t.status] + ' ' + t.pct + '%') + '"><span class="gfill" style="width:' + t.pct + '%"></span></span>' + lab;
    };
    var html = '<div class="card" style="padding:12px"><div class="row" style="margin-bottom:10px"><button class="btn btn-sm btn-gold" id="addTask">＋ Task</button><button class="btn btn-sm" id="addMile">◆ Milestone</button><button class="btn btn-sm est-ai" id="estAi" type="button" title="AI fills in indicative costs from Australian and international benchmarks: a reference only, to review and change">✨ Indicative costs</button>' +
      '<div class="qgate' + (p.emergency ? ' emerg' : p.gate && p.gate.accepted ? ' ok' : '') + '"><div class="qrow"><input type="checkbox" id="pEmerg" hidden>' +
        '<label class="qchk" title="' + (p.emergency ? 'Emergency jobs already work Saturday and Sunday' : 'Tick if the crew can work Saturday and Sunday on this job: the schedule then counts every day and finishes sooner') + '"><input type="checkbox" id="pWeek"' + (p.emergency || p.weekends ? ' checked' : '') + (p.emergency ? ' disabled' : '') + '> 📅 Weekends (Sat, Sun) allowed</label>' +
        '<select id="pCool" hidden><option value="0" selected>0</option></select></div><div>' + gateText(p) + '</div></div>' +
      fitBar(p, R) + estBanner(p) +
      '<span class="muted phint" style="font-size:12.5px">To move a task, type its new number in <b>#</b> (1 = first) or drag <b>⠿</b>. Sub-tasks move inside their own task. Days are working days (' + (p.emergency ? 'emergency: every day, Saturday and Sunday included' : p.weekends ? 'weekends allowed: every day, Saturday and Sunday included' : 'Mon–Fri') + '). “After #” = starts when those rows finish. Moving a card on the Board updates the % here.</span>' +
      '<div class="pdline" title="Project start, Work starts and Finish by: the plan\'s dates follow them">' +
      '<label style="display:flex;gap:6px;align-items:center;font-weight:700">Project start<input type="date" id="pStart" value="' + esc(p.start) + '"' + (p.finishBy ? ' max="' + esc(p.finishBy) + '"' : '') + ' style="width:auto"></label>' +
      '<label style="display:flex;gap:6px;align-items:center;font-weight:700" title="The day the work itself starts (after the quote is accepted). Tasks before the quote, like the site inspection, are not affected. Also on the quote.">Work starts<input type="date" id="pWork" value="' + esc(p.workStart || '') + '" min="' + esc(nextWork(p.start)) + '"' + (p.finishBy ? ' max="' + esc(p.finishBy) + '"' : '') + ' style="width:auto"></label>' +
      '<label style="display:flex;gap:6px;align-items:center;font-weight:700" title="The date the customer needs it finished. If the plan finishes later, ✨ Fit to finish-by asks the AI how to bring it in.">Finish by<input type="date" id="pFinishBy" value="' + esc(p.finishBy || '') + '" min="' + esc(p.workStart && p.workStart > p.start ? p.workStart : nextWork(p.start)) + '" style="width:auto"></label>' +
      '</div><div class="pviews">' +
      '<div class="tabs" style="margin:0" title="Which columns to show"><button class="tab' + (S.cols === 's' ? ' on' : '') + '" data-cols="s">📅 Dates</button><button class="tab' + (S.cols === 'c' ? ' on' : '') + '" data-cols="c">$ Costs</button><button class="tab' + (S.cols === 'a' ? ' on' : '') + '" data-cols="a">All columns</button></div>' +
      '<div class="tabs" style="margin:0"><button class="tab' + (S.zoom === 'day' ? ' on' : '') + '" data-zoom="day">Days</button><button class="tab' + (S.zoom === 'week' ? ' on' : '') + '" data-zoom="week">Weeks</button></div></div></div>' +
      '<div class="gsplit" id="gSplit"><div class="gpane gleft" id="gLeft"' + (S.split ? ' style="flex:0 0 ' + S.split + 'px;max-width:none"' : '') + '><table class="gt v-' + S.cols + '"><thead><tr><th>#</th><th title="Done">✓</th><th style="min-width:160px">Task <button type="button" class="gfz-chip" id="gFreezeBtn" title="Freeze columns (like Excel) and column widths">❄ ' + esc(gfzName()) + '</button></th><th style="min-width:136px">Resources <span class="muted" style="text-transform:none;letter-spacing:0">(★ lead)</span></th><th>Days</th><th>Start</th><th>Finish</th><th>After #</th><th>Qty</th><th>Unit</th><th>Unit $</th><th>Cost</th><th>Actual $</th><th>Status</th><th>%</th><th></th></tr></thead><tbody>';
    var G = '';   // rows of the Gantt pane (kept the same height as the grid rows)
    rows.forEach(function (r) {
      var t = r.t, late = t.pct < 100 && t.ef < t0, base = p.baseline && p.baseline.tasks ? p.baseline.tasks[t.id] : null;
      var subs = t.subs || [], open = subs.length && !S.closed[t.id];
      html += '<tr data-tid="' + esc(t.id) + '" class="' + (t.pct >= 100 ? 'tdone' : '') + (late ? ' tlate' : '') + (t.dur === 0 ? ' tmile' : '') + (subs.length ? ' tparent' : '') + '"><td class="muted nowrap">' + '<span class="grip" data-grip title="Drag up or down to move this task">⠿</span>' + (subs.length ? '<button class="subtog" type="button" data-tog title="' + (open ? 'Hide' : 'Show') + ' sub-tasks">' + (open ? '▾' : '▸') + '</button>' : '') + '<input class="posin" data-pos inputmode="numeric" value="' + r.n + '" title="Type a number to move this task there (1 = first)">' + stkBtn(t, 'row') + '</td>' +
        '<td><input type="checkbox" data-k="done"' + (t.pct >= 100 ? ' checked' : '') + ' title="Done" style="width:auto"></td>' +
        '<td><div class="tname"><input data-k="name" value="' + esc(t.name) + '" title="' + esc(t.name) + (t.dur === 0 ? ' (milestone)' : '') + (late ? ' · LATE: was due ' + pretty(t.ef) : '') + '"><button class="tdel" type="button" data-del title="Delete this task' + (subs.length ? ' and its ' + pl(subs.length, 'sub-task') : '') + '" aria-label="Delete task">🗑</button><button class="tins" type="button" data-ins title="Add a level-1 task below this one" aria-label="Add a task below">＋</button><button class="pkbtn" type="button" data-pick title="' + (matsOf(t).length ? 'Materials from stock (' + matsOf(t).length + '): change them' : 'Add materials from stock (any number, each with a quantity)') + '">📦</button></div>' + stockChip(t) +
          (t.dur === 0 ? '' : '<button class="subadd" type="button" data-addsub title="Break this task into smaller steps (they stay inside its dates)">＋ sub-task' + (subs.length ? ' · ' + subs.filter(function (x) { return x.status === 'done'; }).length + '/' + subs.length + ' done' : '') + '</button>') + '</td>' +
        '<td>' + resCell(t) + '</td>' +
        '<td><input data-k="dur" type="number" min="0" max="365" value="' + t.dur + '" style="width:50px" title="0 days = milestone"></td>' +
        '<td><input data-k="snet" type="date" value="' + esc(t.es) + '" min="' + esc(nextWork(p.start)) + '" class="' + (t.snet ? 'pinned' : '') + '" title="' + (t.fixed && t.snet ? 'Start set by hand: ' + dmy(t.snet) + '. It runs in parallel (the After # link is not used). Clear the date to follow After # again.' : t.snet ? 'Starts no earlier than ' + dmy(t.snet) + ' (clear the date box to remove)' : 'Worked out from the tasks before it. Type or pick a date to start it earlier (in parallel) or later: between the project start and finish.') + '"></td>' +
        '<td class="nowrap">' + esc(dmy(t.ef)) + (base && base.ef && base.ef !== t.ef ? '<br><small class="' + (t.ef > base.ef ? 'bad' : 'good') + '">base ' + esc(dmy(base.ef)) + '</small>' : '') + '</td>' +
        '<td><input data-k="pred" value="' + esc((t.pred || []).map(function (id) { return num[id]; }).filter(Boolean).join(', ')) + '" placeholder="e.g. 2,3" style="width:58px"' + (t.fixed && t.snet ? ' class="predoff" title="Not used while the start date is set by hand (runs in parallel)"' : '') + '></td>' +
        '<td><input data-k="qty" inputmode="decimal" value="' + esc(t.qty || '') + '" style="width:60px"' + estAttr(t) + '></td>' +
        '<td><input data-k="unit" value="' + esc(t.unit || '') + '" placeholder="h, m², lot" style="width:56px"' + estAttr(t) + '></td>' +
        '<td><input data-k="rate" inputmode="decimal" value="' + esc(t.rate || '') + '" style="width:74px"' + estAttr(t) + '></td>' +
        '<td class="num' + (isEst(t) ? ' est-c' : '') + '"' + (isEst(t) ? ' title="' + esc('≈ Indicative benchmark, not reviewed: ' + (t.basis || 'AI estimate') + '. Check the hours actually worked per day, the rate and the quantity, then change it.') + '"' : '') + '>' + (isEst(t) ? '<span class="est-tag">≈ est</span> ' : '') + money(cost(t)) + '</td>' +
        '<td><input data-k="actual" inputmode="decimal" value="' + esc(t.actual || '') + '" style="width:80px"></td>' +
        '<td><select data-k="status" class="stsel st-' + t.status + '"' + (subs.length ? ' title="Setting this moves all its sub-tasks too"' : '') + '>' + STATUS.map(function (x) { return '<option value="' + x[0] + '"' + (t.status === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select></td>' +
        '<td><input data-k="pct" type="number" min="0" max="100" step="1" value="' + t.pct + '" style="width:54px"' + (subs.length ? ' disabled title="Worked out from the sub-tasks"' : '') + '></td>' +
        '<td class="acts"><button class="btn btn-sm" data-rem title="Reminder">🔔</button><button class="btn btn-sm" data-del title="Delete">✕</button></td>' +
        '</tr>';
      G += '<tr data-gtid="' + esc(t.id) + '"><td class="gcol"><div class="gtrack" style="width:' + W + 'px;' + weekendBg + '">' + todayLine + bar(t, base) + '</div></td></tr>';
      if (open) subs.forEach(function (sb, j) {
        var d = subDates(t, sb), sl = sb.status !== 'done' && d.ef && d.ef < t0, maxDur = Math.max(1, t.dur) - sb.off;
        var left = d.es ? x(d.es) : 0, sw = d.es ? (daysBetween(d.es, d.ef) + 1) * dayW : 0;
        var stp = sb.steps || [], sOpen = stp.length && !S.stClosed[sb.id];
        html += '<tr class="tsub' + (sb.status === 'done' ? ' tdone' : '') + (sl ? ' tlate' : '') + (stp.length ? ' tsubp' : '') + '" data-sid="' + esc(sb.id) + '" data-ptid="' + esc(t.id) + '"><td class="muted nowrap subn"><span class="grip" data-grip title="Drag up or down to reorder (stays inside this task)">⠿</span>' + (stp.length ? '<button class="subtog" type="button" data-stog title="' + (sOpen ? 'Hide' : 'Show') + ' its steps">' + (sOpen ? '▾' : '▸') + '</button>' : '') + r.n + '.<input class="posin sub" data-spos inputmode="numeric" value="' + (j + 1) + '" title="Type a number to move this sub-task there (inside this task)"></td>' +
          '<td><input type="checkbox" data-sk="done"' + (sb.status === 'done' ? ' checked' : '') + ' style="width:auto" title="Done"></td>' +
          '<td><div class="subname"><span class="subarrow">↳</span><input data-sk="name" value="' + esc(sb.name) + '"><button class="tdel" type="button" data-sdel title="Delete this sub-task' + (stp.length ? ' and its ' + pl(stp.length, 'step') : '') + '" aria-label="Delete sub-task">🗑</button></div>' +
            '<button class="stepadd" type="button" data-addstep title="Break this story into dated steps (they stay inside its dates)">＋ step' + (stp.length ? ' · ' + stp.filter(function (q) { return q.done; }).length + '/' + stp.length + ' done' : '') + '</button></td>' +
          '<td><input data-sk="owner" list="resList" value="' + esc(sb.owner || '') + '" placeholder="Who" style="min-width:90px;width:110px"></td>' +
          '<td><input data-sk="dur" type="number" min="1" max="' + maxDur + '" value="' + sb.dur + '" style="width:50px" title="At most ' + maxDur + ' day' + (maxDur === 1 ? '' : 's') + ' (to stay inside the task)"></td>' +
          '<td><input data-sk="start" type="date" value="' + esc(d.es) + '" min="' + esc(t.es) + '" max="' + esc(t.ef) + '" title="Between ' + esc(dmy(t.es)) + ' and ' + esc(dmy(t.ef)) + ' (the task\'s dates)"></td>' +
          '<td class="nowrap">' + esc(dmy(d.ef)) + '</td><td class="muted" style="font-size:11.5px">in #' + r.n + '</td><td></td><td></td><td></td>' +
          '<td class="muted subcost" title="Costs stay on the task">–</td><td></td>' +
          '<td><select data-sk="status" class="stsel st-' + sb.status + '"' + (stp.length ? ' disabled title="Worked out from its steps: tick them"' : '') + '>' + STATUS.map(function (o) { return '<option value="' + o[0] + '"' + (sb.status === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></td>' +
          '<td class="muted"' + (stp.length ? ' title="From its steps (weighted by days)"' : '') + '>' + subPct(sb) + '</td>' +
          '<td class="acts"><button class="btn btn-sm" data-sdel title="Delete sub-task">✕</button></td>' +
          '</tr>';
        G += '<tr data-gsid="' + esc(sb.id) + '" data-gptid="' + esc(t.id) + '"><td class="gcol"><div class="gtrack gtrack-sub" style="width:' + W + 'px;' + weekendBg + '">' + todayLine + (d.es ? '<span class="gsub st-' + sb.status + ' pb-' + pband(subPct(sb)) + (sl ? ' late' : '') + '" style="left:' + left + 'px;width:' + sw + 'px" title="' + esc(sb.name + ' · ' + pretty(d.es) + ' – ' + pretty(d.ef) + ' · ' + stName[sb.status]) + '"><span class="gfill" style="width:' + subPct(sb) + '%"></span></span><span class="glab" style="left:' + (left + sw + 4) + 'px">' + esc(sb.owner || '') + '</span>' : '') + '</div></td></tr>';
        if (sOpen) stp.forEach(function (q, k) {
          var qd = stepDates(t, sb, q), ql = !q.done && qd.ef && qd.ef < t0, qMax = Math.max(1, sb.dur) - q.off, ql2 = qd.es ? x(qd.es) : 0, qw = qd.es ? (daysBetween(qd.es, qd.ef) + 1) * dayW : 0;
          html += '<tr class="tstep' + (q.done ? ' tdone' : '') + (ql ? ' tlate' : '') + '" data-qid="' + esc(q.id) + '" data-qsid="' + esc(sb.id) + '" data-qtid="' + esc(t.id) + '"><td class="muted nowrap stepn">' + r.n + '.' + (j + 1) + '.' + (k + 1) + '</td>' +
            '<td><input type="checkbox" data-qk="done"' + (q.done ? ' checked' : '') + ' style="width:auto" title="Done"></td>' +
            '<td><div class="stepname"><span class="subarrow">↳</span><input data-qk="name" value="' + esc(q.name) + '"><button class="tdel" type="button" data-qdel title="Delete this step" aria-label="Delete step">🗑</button></div></td><td></td>' +
            '<td><input data-qk="dur" type="number" min="1" max="' + qMax + '" value="' + q.dur + '" style="width:50px" title="At most ' + pl(qMax, 'day') + ' (to stay inside the story)"></td>' +
            '<td><input data-qk="start" type="date" value="' + esc(qd.es) + '" min="' + esc(d.es) + '" max="' + esc(d.ef) + '" title="Between ' + esc(dmy(d.es)) + ' and ' + esc(dmy(d.ef)) + ' (the story\'s dates)"></td>' +
            '<td class="nowrap">' + esc(dmy(qd.ef)) + '</td><td class="muted" style="font-size:11px">in #' + r.n + '.' + (j + 1) + '</td><td></td><td></td><td></td><td class="muted subcost">–</td><td></td>' +
            '<td class="muted" style="font-size:11.5px">' + (q.done ? '✓ Done' : ql ? 'Late' : 'To do') + '</td><td class="muted">' + (q.done ? 100 : 0) + '</td><td></td></tr>';
          G += '<tr data-gqid="' + esc(q.id) + '"><td class="gcol"><div class="gtrack gtrack-step" style="width:' + W + 'px;' + weekendBg + '">' + todayLine + (qd.es ? '<span class="gstep' + (q.done ? ' done' : '') + (ql ? ' late' : '') + '" style="left:' + ql2 + 'px;width:' + qw + 'px" title="' + esc(q.name + ' · ' + pretty(qd.es) + (qd.ef !== qd.es ? ' – ' + pretty(qd.ef) : '') + (q.done ? ' · done' : '')) + '"></span>' + (q.done ? '<span class="glab gstep-l" style="left:' + (ql2 + qw + 3) + 'px">✓</span>' : '') : '') + '</div></td></tr>';
        });
      });
    });
    if (!rows.length) { html += '<tr><td colspan="16"><div class="empty">No tasks yet. Press “＋ Task”.</div></td></tr>'; G += '<tr><td class="gcol"></td></tr>'; }
    if (rows.length) { html += '<tr class="taddrow"><td></td><td></td><td colspan="14"><button class="btn btn-sm" type="button" data-addend>＋ Task (level 1)</button> <button class="btn btn-sm" type="button" data-addendm>◆ Milestone</button> <small class="muted">A level-1 task carries the costing: Qty × Unit $ = Cost, and Actual $.</small></td></tr>'; G += '<tr class="taddrow"><td class="gcol"></td></tr>'; }
    html += '</tbody><tfoot><tr><td></td><td></td><td><b>Total (budget at completion)</b></td><td></td><td></td><td>' + esc(pretty(R.start)) + '</td><td>' + esc(pretty(R.finish)) + '</td><td></td><td></td><td></td><td></td><td class="num"><b>' + money(R.BAC) + '</b></td><td class="num"><b>' + money(R.AC) + '</b></td><td></td><td><b>' + R.pct + '%</b></td><td></td></tr></tfoot></table></div>' +
      '<div class="gsplitter" id="gSplitter" title="Drag to make the task list or the Gantt chart wider (double-click to reset)"><span></span></div>' +
      '<div class="gpane gright" id="gRight"><table class="gt gtr"><thead><tr><th class="gcol">' + scale + '</th></tr></thead><tbody>' + G + '</tbody><tfoot><tr><td class="gcol"><div class="gleg" title="Bar colours: how far each task and sub-task has got">' + [0, 25, 50, 75, 100].map(function (n) { return '<span><i class="pb-' + n + '"></i>' + (n === 100 ? '100% done' : n + '%') + '</span>'; }).join('') + '<span><i class="pb-late"></i>Late</span><span><i class="pb-mile"></i>Milestone</span></div></td></tr></tfoot></table></div></div>' +
      '<div class="res-tip" id="resTip" hidden><b>Tip:</b> you can add more than one person or trade. Press <kbd>Enter</kbd> or type a comma after each name. <b>★</b> = the lead: the first one added is the lead; click another name to make them the lead.</div>' +
      '<datalist id="resList">' + pplOpts() + Array.from(new Set([].concat.apply([], p.tasks.map(function (t) { return t.res || []; })).concat(['Labourer', 'Tiler', 'Plumber', 'Electrician', 'Painter', 'Carpenter', 'Waterproofer', 'Supplier', 'Customer']))).filter(function (r) { return r && !pplNames()[r.toLowerCase()]; }).map(function (r) { return '<option value="' + esc(r) + '">'; }).join('') + '</datalist></div>';
    $('#planBody').innerHTML = html;
    var B = $('#planBody'); estWire(B);
    dateBoxes(B);   // before the rows are lined up with the Gantt chart
    splitPanes(x(t0));
    $('#gFreezeBtn').onclick = function (e) { e.stopPropagation(); gFreezeMenu(this); };
    B.querySelectorAll('[data-cols]').forEach(function (b) { b.onclick = function () { S.cols = b.getAttribute('data-cols'); try { localStorage.setItem('mbsPlanCols', S.cols); } catch (e) {} render(); }; });
    B.querySelectorAll('[data-zoom]').forEach(function (b) { b.onclick = function () { S.zoom = b.getAttribute('data-zoom'); render(); }; });
    $('#pStart').onchange = function () { if (this.value && p.finishBy && this.value > p.finishBy) { toast('The project can\'t start after your Finish by date (' + dmy(p.finishBy) + '). Move Finish by later first, or clear it.', true); render(); return; } if (this.value) { var f0 = rollup(p, today()).finish; p.start = this.value; dirty(); render(); afterDates(f0, 'the project start changed'); } };
    $('#pWork').onchange = function () { setWorkStart(this.value); };
    $('#pFinishBy').onchange = function () { var first = p.workStart && p.workStart > p.start ? p.workStart : p.start; if (this.value && this.value < first) { toast('Finish by can\'t be before the ' + (first === p.start ? 'project starts' : 'work starts') + ' (' + dmy(first) + ').', true); render(); return; } p.finishBy = this.value || ''; S.fitUndo = null; dirty('finish by ' + (p.finishBy || 'cleared')); render(); afterDates('', 'Finish by changed'); };
    $('#pWeek').onchange = function () { var f0 = rollup(p, today()).finish; p.weekends = this.checked; dirty(p.weekends ? 'weekends allowed' : 'weekdays only'); render(); var Rw = rollup(p, today()); toast(p.weekends ? '📅 Saturday and Sunday are work days now: finishes ' + dmy(Rw.finish) : 'Weekdays only (Mon–Fri): finishes ' + dmy(Rw.finish)); afterDates(f0, 'weekend work changed'); };
    var fw = $('#fitWeek'); if (fw) fw.onclick = function () { var f0 = rollup(p, today()).finish; p.weekends = true; dirty('weekends allowed'); render(); toast('📅 Weekends allowed: finishes ' + dmy(rollup(p, today()).finish)); afterDates(f0, ''); };
    var fg = $('#fitGo'); if (fg) fg.onclick = fitRun;
    var fu = $('#fitUndo'); if (fu) fu.onclick = fitUndo;
    $('#pEmerg').onchange = function () { var f0e = rollup(p, today()).finish; setTimeout(function () { afterDates(f0e, 'Emergency changed'); }, 0); p.emergency = this.checked; dirty(p.emergency ? 'emergency: work can start straight away' : 'not an emergency: cooling-off applies'); render(); var R = rollup(p, today()); toast(p.emergency ? 'Emergency: the work starts the same day as the site inspection (finish ' + dmy(R.finish) + ')' : 'Cooling-off applies again (finish ' + dmy(R.finish) + ')'); };
    $('#pCool').onchange = function () { var f0 = rollup(p, today()).finish; p.coolOff = +this.value; dirty('cooling-off ' + p.coolOff + ' business days'); render(); afterDates(f0, 'the cooling-off changed'); };
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
        else if (k === 'snet') {
          var v = el.value || '';
          if (!v) { var was = t.fixed; t.snet = ''; t.fixed = false; if (was) toast('Start date cleared: it follows "After #" again'); }
          else {
            var R0 = rollup(p, today()), ps = nextWork(p.start || today()), said = [], warn = false;
            if (v < ps) { said.push('A task can\'t start before the project start (' + dmy(ps) + ').'); warn = true; v = ps; }
            else if (R0.finish && v > R0.finish) said.push('Starts after the current finish (' + dmy(R0.finish) + '), so the project gets longer.');
            v = nextWork(v);
            var gd = holdDate(p);
            if (gd && v < gd && gatedTasks(p).indexOf(t) >= 0) { said.push(gateOf(p).why === 'work' ? 'The work starts on ' + dmy(gd) + ' ("Work starts" date).' : 'Work can only start once the quote is accepted plus the ' + coolOf(p) + '-day cooling-off, so it starts ' + dmy(gd) + ' (tick Emergency to start straight away).'); warn = true; v = gd; }
            var probe = JSON.parse(JSON.stringify(p)), pt = probe.tasks.filter(function (x) { return x.id === t.id; })[0]; pt.snet = ''; pt.fixed = false; schedule(probe);
            t.snet = v; t.fixed = true;
            if (v < pt.es) said.push('Runs in parallel: starts ' + dmy(v) + ' instead of waiting for #' + (t.pred || []).map(function (id) { return num[id]; }).filter(Boolean).join(', #') + ' (' + dmy(pt.es) + '). Clear the date to follow "After #" again.');
            if (said.length) toast(said.join(' '), warn);
            setTimeout(function () { afterDates(R0.finish, 'a task start date changed'); }, 50);
          }
        }
        else if (k === 'pred') { t.pred = el.value.split(/[,\s]+/).map(function (s) { return idOf[+s]; }).filter(function (id) { return id && id !== t.id; }); }
        else if (['qty', 'rate', 'actual'].indexOf(k) >= 0) { t[k] = r2(String(el.value).replace(/[$,]/g, '')); if (k !== 'actual' && t.est) t.est = false; }
        else { t[k] = el.value; if (k === 'unit' && t.est) { t.est = false; var tr = el.closest('tr'); tr.querySelectorAll('.est-in').forEach(function (i) { i.classList.remove('est-in'); i.removeAttribute('title'); }); var tg = tr.querySelector('.est-tag'); if (tg) { tg.parentNode.classList.remove('est-c'); tg.parentNode.removeAttribute('title'); tg.remove(); } } }
        dirty(k === 'done' || k === 'status' ? stName[t.status] + ': ' + t.name : '');
        if (!live) setTimeout(render, 0);
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
    B.querySelectorAll('[data-del]').forEach(function (b) { b.onclick = function () { taskDelete(task(b)); }; });
    // type a number in # to move it there (1 = first); the rest close up behind it
    var place = function (arr, item, v) {
      var a = arr.indexOf(item), c = Math.max(1, Math.min(arr.length, Math.round(+v || 0))) - 1;
      if (!(+v >= 1) || a === c) return false;
      arr.splice(a, 1); arr.splice(c, 0, item); return true;
    };
    var posKeys = function (inp, keep) {
      inp.addEventListener('focus', function () { inp.select(); });
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } else if (e.key === 'Escape') { inp.value = keep; inp.blur(); } });
    };
    B.querySelectorAll('[data-pos]').forEach(function (inp) {
      var keep = inp.value; posKeys(inp, keep);
      inp.addEventListener('change', function () {
        var t = task(inp);
        if (place(p.tasks, t, inp.value)) { dirty('task moved to #' + (p.tasks.indexOf(t) + 1) + ': ' + t.name); render(); var n = $('#planBody tr[data-tid="' + t.id + '"]'); if (n) n.classList.add('just-moved'); }
        else inp.value = keep;
      });
    });
    B.querySelectorAll('[data-rem]').forEach(function (b) { b.onclick = function () { reminderBox(task(b)); }; });
    dragRows(B, p);
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
        if (k === 'done') { sb.status = el.checked ? 'done' : 'todo'; (sb.steps || []).forEach(function (q) { q.done = el.checked; }); }
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
    B.querySelectorAll('[data-sdel]').forEach(function (b) { b.onclick = function () { var o = subOf(b); subDelete(o.t, o.sb); }; });
    // v85: steps (the third level)
    B.querySelectorAll('[data-stog]').forEach(function (b) { b.onclick = function () { var o = subOf(b); S.stClosed[o.sb.id] = !S.stClosed[o.sb.id]; render(); }; });
    B.querySelectorAll('[data-addstep]').forEach(function (b) { b.onclick = function () { var o = subOf(b); stepAdd(o.t, o.sb); }; });
    var stepOf = function (el) { var tr = el.closest('tr'), t = p.tasks.filter(function (x) { return x.id === tr.getAttribute('data-qtid'); })[0], sb = t && (t.subs || []).filter(function (x) { return x.id === tr.getAttribute('data-qsid'); })[0];
      return { t: t, sb: sb, q: sb && (sb.steps || []).filter(function (x) { return x.id === tr.getAttribute('data-qid'); })[0] }; };
    B.querySelectorAll('tr[data-qid] [data-qk]').forEach(function (el) {
      var k = el.getAttribute('data-qk');
      el.addEventListener(k === 'name' ? 'input' : 'change', function () {
        var o = stepOf(el), t = o.t, sb = o.sb, q = o.q; if (!q) return;
        if (k === 'name') { q.name = el.value; dirty(); return; }
        if (k === 'done') q.done = el.checked;
        else if (k === 'dur') { var want = Math.max(1, Math.round(+el.value || 1)); q.dur = want; fitSteps(sb); if (q.dur < want) toast('Kept inside the story: at most ' + pl(q.dur, 'day') + ' from its start'); }
        else if (k === 'start') {
          var d = subDates(t, sb), v = el.value || d.es;
          if (v < d.es || v > d.ef) toast('Steps stay inside the story (' + pretty(d.es) + ' – ' + pretty(d.ef) + ')', true);
          v = v < d.es ? d.es : v > d.ef ? d.ef : v; v = nextWork(v); if (v > d.ef) v = d.ef;
          q.off = Math.max(0, workBetween(d.es, v) - 1); fitSteps(sb);
        }
        derive(t); dirty(k === 'done' ? (q.done ? 'Done: ' : 'To do: ') + q.name + ' (' + sb.name + ')' : ''); render();
      });
    });
    B.querySelectorAll('[data-qdel]').forEach(function (b) { b.onclick = function () { var o = stepOf(b); stepDelete(o.t, o.sb, o.q); }; });
    B.querySelectorAll('[data-spos]').forEach(function (inp) {
      var keep = inp.value; posKeys(inp, keep);
      inp.addEventListener('change', function () {
        var o = subOf(inp); if (!o.sb) return;
        if (place(o.t.subs, o.sb, inp.value)) { dirty('sub-task moved: ' + o.sb.name + ' (' + o.t.name + ')'); render(); var n = $('#planBody tr[data-sid="' + o.sb.id + '"]'); if (n) n.classList.add('just-moved'); }
        else inp.value = keep;
      });
    });
    B.querySelectorAll('[data-pick]').forEach(function (b) {
      b.onclick = function () {
        var t = task(b);
        if (!M.inv) return toast('Inventory is not available', true);
        if (S.plan.bom) { location.hash = '#plan/' + S.core + '/bom'; return toast('This project has a 🧱 BOM: change the materials there (it keeps the tasks up to date)'); }   // v89
        matsEditor(t);
      };
    });
    var add = function (mile, after) {   // a level-1 task (with its costing), at the end or straight after another level-1 task
      var last = after || p.tasks[p.tasks.length - 1];
      var t = { id: 't' + Date.now().toString(36), phase: (last && last.phase) || 'ph1', name: mile ? 'New milestone' : 'New task', dur: mile ? 0 : 1, res: [], lead: '', resource: '', qty: 0, unit: '', rate: 0, actual: 0, pct: 0, status: 'todo', pred: last ? [last.id] : [], snet: '', notes: '' };
      if (after) { var at = p.tasks.indexOf(after), nx = p.tasks[at + 1]; if (nx && (nx.pred || []).indexOf(after.id) >= 0) nx.pred = nx.pred.map(function (id) { return id === after.id ? t.id : id; }); p.tasks.splice(at + 1, 0, t); }
      else p.tasks.push(t);
      dirty(); render();
      setTimeout(function () { var i = $('#planBody tr[data-tid="' + t.id + '"] [data-k=name]'); if (i) { i.focus(); i.select(); } }, 30);
    };
    $('#addTask').onclick = function () { add(false); };
    B.querySelectorAll('[data-addend]').forEach(function (b) { b.onclick = function () { add(false); }; });
    B.querySelectorAll('[data-addendm]').forEach(function (b) { b.onclick = function () { add(true); }; });
    B.querySelectorAll('[data-ins]').forEach(function (b) { b.onclick = function () { add(false, task(b)); }; });
    $('#addMile').onclick = function () { add(true); };
  }

  /* ---------- drag a task (or a sub-task, inside its own task) up or down ---------- */
  function dragRows(B, p) {
    var st = null;
    var clear = function () { st.rows.forEach(function (r) { r.classList.remove('drop-before', 'drop-after'); }); };
    function mv(e) {
      if (!st) return;
      e.preventDefault(); clear();
      var y = e.clientY, best = null, after = false;
      for (var i = 0; i < st.rows.length; i++) { var rc = st.rows[i].getBoundingClientRect(); if (y < rc.top + rc.height / 2) { best = st.rows[i]; break; } }
      if (!best) { best = st.rows[st.rows.length - 1]; after = true; }
      var me = st.rows.indexOf(st.tr), at = st.rows.indexOf(best);
      if (best === st.tr || (!after && at === me + 1)) { st.target = null; }   // no change: dropped where it already is
      else { st.target = best; st.after = after; best.classList.add(after ? 'drop-after' : 'drop-before'); }
      if (y < 70) scrollBy(0, -14); else if (y > innerHeight - 70) scrollBy(0, 14);
    }
    function up() {
      document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', up);
      if (!st) return;
      var s = st; clear(); st = null;
      s.tr.classList.remove('dragging'); document.body.classList.remove('rowdrag');
      if (!s.target) return;
      var arr, from, to, label;
      if (s.sub) {
        var t = p.tasks.filter(function (x) { return x.id === s.tr.getAttribute('data-ptid'); })[0]; if (!t) return;
        arr = t.subs; from = arr.filter(function (x) { return x.id === s.tr.getAttribute('data-sid'); })[0]; to = arr.filter(function (x) { return x.id === s.target.getAttribute('data-sid'); })[0];
        label = 'sub-task moved: ' + (from && from.name) + ' (' + t.name + ')';
      } else {
        arr = p.tasks; from = arr.filter(function (x) { return x.id === s.tr.getAttribute('data-tid'); })[0]; to = arr.filter(function (x) { return x.id === s.target.getAttribute('data-tid'); })[0];
        label = 'task moved: ' + (from && from.name);
      }
      if (!from || !to || from === to) return;
      arr.splice(arr.indexOf(from), 1); arr.splice(arr.indexOf(to) + (s.after ? 1 : 0), 0, from);
      dirty(label); render();
    }
    B.querySelectorAll('[data-grip]').forEach(function (g) {
      g.addEventListener('pointerdown', function (e) {
        if (e.button) return;
        e.preventDefault();
        var tr = g.closest('tr'), sub = tr.hasAttribute('data-sid');
        var rows = Array.prototype.slice.call(B.querySelectorAll('#gLeft tbody ' + (sub ? 'tr[data-sid][data-ptid="' + tr.getAttribute('data-ptid') + '"]' : 'tr[data-tid]')));
        if (rows.length < 2) return toast(sub ? 'Only one sub-task in this task' : 'Only one task so far');
        st = { tr: tr, sub: sub, rows: rows, target: null, after: false };
        tr.classList.add('dragging'); document.body.classList.add('rowdrag');
        document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up); document.addEventListener('pointercancel', up);
      });
    });
  }

  /* ---------- export the whole plan to Excel (one formatted tab per section) ---------- */
  var xlsLib = null;
  function loadXls() {
    if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
    if (!xlsLib) xlsLib = new Promise(function (res, rej) { var sc = document.createElement('script'); sc.src = 'vendor/exceljs.min.js?v=440'; sc.onload = function () { res(window.ExcelJS); }; sc.onerror = function () { xlsLib = null; rej(new Error('Could not load the Excel tool. Check your connection and try again.')); }; document.head.appendChild(sc); });
    return xlsLib;
  }
  /* ---------- v58: ⬇ Gantt export: only the schedule (tasks, sub-tasks, dates, durations, links, progress, who), no costs.
     CSV (any tool), Microsoft Project XML (MS Project, Primavera P6, ProjectLibre, GanttProject, Smartsheet), Excel (.xlsx)
     and calendar (.ics for Google, Outlook, Apple). ---------- */
  var GX_FORMATS = [['csv', 'CSV (.csv)', 'Any tool: Microsoft Project, Smartsheet, Asana, Monday.com, Wrike, ClickUp, Jira, Excel'],
    ['mspdi', 'Microsoft Project XML (.xml)', 'Opens in Microsoft Project with links and calendar; imports into Primavera P6, ProjectLibre, GanttProject, Smartsheet'],
    ['xlsx', 'Excel (.xlsx)', 'Smartsheet, Monday.com, Asana and Excel itself (real dates)'],
    ['ics', 'Calendar (.ics)', 'Google Calendar, Outlook, Apple Calendar: each task as an all-day event']];
  var CSV_DATES = [['dmy', 'DD/MM/YYYY (Australia: Microsoft Project, Excel set to Australia)'], ['ymd', 'YYYY-MM-DD (Smartsheet, Asana, Monday.com, Jira, most web tools)'], ['mdy', 'MM/DD/YYYY (US settings)']];
  function ganttRows(p, subsOn) {   // the schedule as flat rows: tasks (level 1), their sub-tasks (level 2) and (v85) the sub-tasks' steps (level 3)
    schedule(p);
    var rows = [], idOf = {}, n = 0;
    p.tasks.forEach(function (t) { idOf[t.id] = ++n; if (subsOn) (t.subs || []).forEach(function (sb) { n += 1 + (sb.steps || []).length; }); });
    p.tasks.forEach(function (t, i) {
      var subs = subsOn ? (t.subs || []) : [];
      rows.push({ uid: idOf[t.id], wbs: String(i + 1), lvl: 1, name: t.name, es: t.es, ef: t.dur === 0 ? t.es : t.ef, dur: t.dur, preds: (t.pred || []).map(function (x) { return idOf[x]; }).filter(Boolean),
        mile: t.dur === 0, pct: t.pct || 0, status: stName[t.status] || '', res: (t.res || []).slice(), resTxt: resText(t), lead: t.lead || '', summary: subs.length > 0, notes: t.notes || '' });
      var u = idOf[t.id];
      subs.forEach(function (sb, j) { var d = subDates(t, sb), stp = sb.steps || [];
        rows.push({ uid: ++u, wbs: (i + 1) + '.' + (j + 1), lvl: 2, name: sb.name, es: d.es, ef: d.ef, dur: sb.dur, preds: [], mile: false, pct: subPct(sb) || 0, status: stName[sb.status] || '',
          res: sb.owner ? [sb.owner] : [], resTxt: sb.owner || '', lead: sb.owner || '', summary: stp.length > 0, parent: t.name, notes: '' });
        stp.forEach(function (q, k) { var qd = stepDates(t, sb, q);
          rows.push({ uid: ++u, wbs: (i + 1) + '.' + (j + 1) + '.' + (k + 1), lvl: 3, name: q.name, es: qd.es, ef: qd.ef, dur: q.dur, preds: [], mile: false, pct: q.done ? 100 : 0, status: q.done ? 'Done' : 'To do',
            res: sb.owner ? [sb.owner] : [], resTxt: sb.owner || '', lead: sb.owner || '', summary: false, parent: sb.name, notes: '' }); });
      });
    });
    return rows;
  }
  var gxFmt = function (s, dates) { if (!s) return ''; var y = s.slice(0, 4), m = s.slice(5, 7), d = s.slice(8, 10); return dates === 'ymd' ? s : dates === 'mdy' ? m + '/' + d + '/' + y : d + '/' + m + '/' + y; };
  var GX_HEAD = ['ID', 'WBS', 'Outline Level', 'Task Name', 'Start Date', 'Finish Date', 'Duration', 'Duration (days)', 'Predecessors', 'Milestone', '% Complete', 'Status', 'Resource Names', 'Assignee', 'Parent Task', 'Notes'];
  function gxValues(r, dates, all) { return [r.uid, r.wbs, r.lvl, r.name, gxFmt(r.es, dates), gxFmt(r.ef, dates), r.dur + (r.dur === 1 ? ' day' : ' days') + (all ? ' (calendar)' : ''), r.dur, r.preds.join(','), r.mile ? 'Yes' : 'No', r.pct + '%', r.status, r.resTxt, r.lead, r.parent || '', r.notes]; }
  function ganttCsv(p, o) {
    o = o || {}; var rows = ganttRows(p, o.subs !== false), all = !!(p.emergency || p.weekends);
    var q = function (v) { v = String(v == null ? '' : v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    return '﻿' + [GX_HEAD.map(q).join(',')].concat(rows.map(function (r) { return gxValues(r, o.dates, all).map(q).join(','); })).join('\r\n') + '\r\n';
  }
  function ganttMspdi(p, o) {   // Microsoft Project XML (MSPDI); 8-hour days 08:00-17:00 with a lunch hour
    o = o || {}; var rows = ganttRows(p, o.subs !== false), all = !!(p.emergency || p.weekends);
    var x = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
    var st = function (d) { return d ? d + 'T08:00:00' : ''; }, fi = function (d, mile) { return d ? d + (mile ? 'T08:00:00' : 'T17:00:00') : ''; };
    var dur = function (n) { return 'PT' + (n * 8) + 'H0M0S'; };
    var R = rows.filter(function (r) { return r.es; }), first = R.reduce(function (m, r) { return !m || r.es < m ? r.es : m; }, ''), last = R.reduce(function (m, r) { return r.ef > m ? r.ef : m; }, '');
    var res = []; rows.forEach(function (r) { r.res.forEach(function (n) { if (n && res.indexOf(n) < 0) res.push(n); }); });
    var day = function (n, work) { return '<WeekDay><DayType>' + n + '</DayType><DayWorking>' + (work ? 1 : 0) + '</DayWorking>' + (work ? '<WorkingTimes><WorkingTime><FromTime>08:00:00</FromTime><ToTime>12:00:00</ToTime></WorkingTime><WorkingTime><FromTime>13:00:00</FromTime><ToTime>17:00:00</ToTime></WorkingTime></WorkingTimes>' : '') + '</WeekDay>'; };
    var out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>', '<Project xmlns="http://schemas.microsoft.com/project">',
      '<SaveVersion>14</SaveVersion><Name>' + x(p.name) + '.xml</Name><Title>' + x(p.name) + '</Title><Company>' + x((S.job && S.job.ref) || '') + '</Company>',
      '<ScheduleFromStart>1</ScheduleFromStart><StartDate>' + st(first) + '</StartDate><FinishDate>' + fi(last) + '</FinishDate><CalendarUID>1</CalendarUID>',
      '<DefaultStartTime>08:00:00</DefaultStartTime><DefaultFinishTime>17:00:00</DefaultFinishTime><MinutesPerDay>480</MinutesPerDay><MinutesPerWeek>' + (all ? 3360 : 2400) + '</MinutesPerWeek><DaysPerMonth>' + (all ? 30 : 20) + '</DaysPerMonth><DurationFormat>7</DurationFormat>',
      '<Calendars><Calendar><UID>1</UID><Name>' + (all ? 'Seven-day week' : 'Standard') + '</Name><IsBaseCalendar>1</IsBaseCalendar><WeekDays>' + [1, 2, 3, 4, 5, 6, 7].map(function (n) { return day(n, all || (n > 1 && n < 7)); }).join('') + '</WeekDays></Calendar></Calendars>',
      '<Tasks><Task><UID>0</UID><ID>0</ID><Name>' + x(p.name) + '</Name><OutlineNumber>0</OutlineNumber><OutlineLevel>0</OutlineLevel><Summary>1</Summary><Start>' + st(first) + '</Start><Finish>' + fi(last) + '</Finish></Task>'];
    rows.forEach(function (r) {
      out.push('<Task><UID>' + r.uid + '</UID><ID>' + r.uid + '</ID><Name>' + x(r.name) + '</Name><Type>1</Type><Manual>0</Manual><WBS>' + r.wbs + '</WBS><OutlineNumber>' + r.wbs + '</OutlineNumber><OutlineLevel>' + r.lvl + '</OutlineLevel>' +
        (r.es ? '<Start>' + st(r.es) + '</Start><Finish>' + fi(r.ef, r.mile) + '</Finish>' : '') + '<Duration>' + dur(r.dur) + '</Duration><DurationFormat>7</DurationFormat><Milestone>' + (r.mile ? 1 : 0) + '</Milestone><Summary>' + (r.summary ? 1 : 0) + '</Summary><PercentComplete>' + r.pct + '</PercentComplete>' +
        (!r.preds.length && r.es && !r.summary ? '<ConstraintType>4</ConstraintType><ConstraintDate>' + st(r.es) + '</ConstraintDate>' : '<ConstraintType>0</ConstraintType>') +
        (r.notes ? '<Notes>' + x(r.notes) + '</Notes>' : '') +
        r.preds.map(function (u) { return '<PredecessorLink><PredecessorUID>' + u + '</PredecessorUID><Type>1</Type><CrossProject>0</CrossProject><LinkLag>0</LinkLag><LagFormat>7</LagFormat></PredecessorLink>'; }).join('') + '</Task>');
    });
    out.push('</Tasks><Resources><Resource><UID>0</UID><ID>0</ID><Type>1</Type><IsNull>0</IsNull></Resource>' + res.map(function (n, k) { return '<Resource><UID>' + (k + 1) + '</UID><ID>' + (k + 1) + '</ID><Name>' + x(n) + '</Name><Type>1</Type><CalendarUID>1</CalendarUID></Resource>'; }).join('') + '</Resources><Assignments>');
    var a = 0; rows.forEach(function (r) { if (r.summary) return; r.res.forEach(function (n) { out.push('<Assignment><UID>' + (++a) + '</UID><TaskUID>' + r.uid + '</TaskUID><ResourceUID>' + (res.indexOf(n) + 1) + '</ResourceUID><Units>1</Units></Assignment>'); }); });
    out.push('</Assignments></Project>');
    return out.join('\r\n');
  }
  function ganttIcs(p, o) {   // each task an all-day event (sub-tasks too if ticked); milestones as one-day events
    o = o || {}; var rows = ganttRows(p, o.subs !== false).filter(function (r) { return r.es && !r.summary; });
    var esc2 = function (s) { return String(s || '').replace(/\\/g, '\\\\').replace(/[,;]/g, '\\$&').replace(/\n/g, '\\n'); };
    var d8 = function (s) { return s.replace(/-/g, ''); }, next = function (s) { var dt = new Date(s + 'T00:00:00Z'); dt.setUTCDate(dt.getUTCDate() + 1); return dt.toISOString().slice(0, 10); };
    var fold = function (l) { var out = '', u = l; while (u.length > 73) { out += u.slice(0, 73) + '\r\n '; u = u.slice(73); } return out + u; };
    var stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    var L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MBS Console//Gantt export//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:' + esc2(p.name)];
    rows.forEach(function (r) {
      L.push('BEGIN:VEVENT', 'UID:' + (S.core || 'plan') + '-' + r.uid + '@mbs-console', 'DTSTAMP:' + stamp, 'DTSTART;VALUE=DATE:' + d8(r.es), 'DTEND;VALUE=DATE:' + d8(next(r.ef || r.es)),
        fold('SUMMARY:' + esc2((r.mile ? '◆ ' : '') + '#' + r.wbs + ' ' + r.name)), fold('DESCRIPTION:' + esc2([p.name + (S.job ? ' (' + S.job.ref + ')' : ''), r.parent ? 'Part of: ' + r.parent : '', r.preds.length ? 'After task ID ' + r.preds.join(', ') : '', r.resTxt ? 'Who: ' + r.resTxt : '', r.pct + '% complete · ' + r.status].filter(Boolean).join('\n'))),
        'TRANSP:TRANSPARENT', 'END:VEVENT');
    });
    L.push('END:VCALENDAR'); return L.join('\r\n') + '\r\n';
  }
  function ganttXlsx(p, o) {
    o = o || {}; var rows = ganttRows(p, o.subs !== false), all = !!(p.emergency || p.weekends);
    return loadXls().then(function (XL) {
      var wb = new XL.Workbook(), ws = wb.addWorksheet('Gantt', { views: [{ state: 'frozen', ySplit: 1, xSplit: 4 }] });
      ws.columns = [6, 7, 8, 44, 12, 12, 12, 9, 13, 9, 10, 15, 28, 18, 30, 30].map(function (w, k) { return { header: GX_HEAD[k], width: w }; });
      var D = function (s) { if (!s) return null; var a = s.split('-').map(Number); return new Date(Date.UTC(a[0], a[1] - 1, a[2])); };
      rows.forEach(function (r) { var v = gxValues(r, 'ymd', all); v[4] = D(r.es); v[5] = D(r.ef); v[10] = r.pct / 100; var row = ws.addRow(v); row.getCell(5).numFmt = row.getCell(6).numFmt = 'dd/mm/yyyy'; row.getCell(11).numFmt = '0%'; if (r.lvl === 2) { row.outlineLevel = 1; row.getCell(4).alignment = { indent: 2 }; } if (r.summary) row.font = { bold: true }; });
      ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: GX_HEAD.length } };
      return wb.xlsx.writeBuffer();
    });
  }
  function ganttCsvDialog() {
    var get = function (k, d) { try { return localStorage.getItem(k) || d; } catch (e) { return d; } }, put = function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} };
    var fmt0 = get('mbsGxFmt', 'csv'), dates0 = get('mbsCsvDates', 'dmy');
    M.modal('<h2>⬇ Export the Gantt chart</h2><p class="muted" style="margin:6px 0 12px">Only the schedule: tasks and sub-tasks, start and finish dates, durations, links (Predecessors), milestones, % complete and who. No costs or other plan details.</p>' +
      '<div class="gx-fmts">' + GX_FORMATS.map(function (f) { return '<label class="gx-fmt"><input type="radio" name="gxf" value="' + f[0] + '"' + (f[0] === fmt0 ? ' checked' : '') + '><span><b>' + esc(f[1]) + '</b><small>' + esc(f[2]) + '</small></span></label>'; }).join('') + '</div>' +
      '<label id="gxDatesL" style="margin-top:10px">Date format (CSV)<select id="csvDates">' + CSV_DATES.map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === dates0 ? ' selected' : '') + '>' + esc(x[1]) + '</option>'; }).join('') + '</select></label>' +
      '<label class="sc-cb" style="margin-top:10px"><input type="checkbox" id="csvSubs" checked> Include sub-tasks (under their task)</label>' +
      '<details style="margin-top:10px;font-size:13px"><summary style="cursor:pointer;font-weight:700">How to import</summary><ul style="margin:6px 0 0;padding-left:18px;line-height:1.5">' +
        '<li><b>Microsoft Project:</b> best with the XML file: File › Open › choose it (tasks, links, sub-tasks, calendar and people come across). With CSV: Import Wizard › match Task Name, Start, Finish, Duration, Predecessors, Outline Level, Resource Names.</li>' +
        '<li><b>Primavera P6:</b> File › Import › Microsoft Project (XML) with the XML file.</li>' +
        '<li><b>ProjectLibre / GanttProject:</b> open or import the XML file.</li>' +
        '<li><b>Smartsheet:</b> Import › Microsoft Project (XML) keeps the links; or Import › Excel/CSV and set Start Date, Finish Date, Duration and Predecessors in Project settings.</li>' +
        '<li><b>Asana / Monday.com / ClickUp / Wrike / Jira:</b> import CSV or Excel; match Task Name, Start Date, Finish Date (due date), Assignee, Status. Use YYYY-MM-DD dates for CSV.</li>' +
        '<li><b>Google / Outlook / Apple Calendar:</b> import the .ics file into a calendar (best a new one for this project).</li></ul></details>' +
      '<div class="actions" style="margin-top:14px"><button class="btn" data-close type="button">Cancel</button> <button class="btn btn-gold" id="csvGo" type="button">⬇ Download</button></div>');
    var sync = function () { var f = (document.querySelector('input[name=gxf]:checked') || {}).value; $('#gxDatesL').style.display = f === 'csv' ? '' : 'none'; };
    document.querySelectorAll('input[name=gxf]').forEach(function (r) { r.onchange = sync; }); sync();
    $('#csvGo').onclick = function () {
      var f = document.querySelector('input[name=gxf]:checked').value, dates = $('#csvDates').value, o = { dates: dates, subs: $('#csvSubs').checked }, plan = JSON.parse(JSON.stringify(S.plan));
      put('mbsGxFmt', f); put('mbsCsvDates', dates);
      var base = 'Gantt-' + (S.job.ref || S.core) + '-' + today();
      var save = function (data, type, ext) { var url = URL.createObjectURL(new Blob([data], { type: type })), a = document.createElement('a'); a.href = url; a.download = base + '.' + ext; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 5000); M.closeModal(); toast('Gantt chart downloaded: ' + base + '.' + ext); };
      if (f === 'csv') save(ganttCsv(plan, o), 'text/csv;charset=utf-8', 'csv');
      else if (f === 'mspdi') save(ganttMspdi(plan, o), 'application/xml;charset=utf-8', 'xml');
      else if (f === 'ics') save(ganttIcs(plan, o), 'text/calendar;charset=utf-8', 'ics');
      else ganttXlsx(plan, o).then(function (buf) { save(buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx'); }).catch(fail);
    };
  }
  function exportExcel() {
    var btn = $('#planXls'); if (btn) { btn.disabled = true; btn.textContent = 'Preparing…'; }
    var done = function () { var b = $('#planXls'); if (b) { b.disabled = false; b.textContent = '⬇ Excel'; } };
    (S.timer ? saveNow() : Promise.resolve()).then(loadXls).then(function (XL) { return buildWorkbook(XL); }).then(function (wb) { return wb.xlsx.writeBuffer(); }).then(function (buf) {
      var name = 'MBS-plan-' + (S.job.ref || S.core) + '-' + today() + '.xlsx';
      var url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      var a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      S.lastExport = name; toast('Excel downloaded: ' + name);
    }).catch(fail).then(done);
  }
  function buildWorkbook(XL) {
    var p = JSON.parse(JSON.stringify(S.plan)), t0 = today(), R = rollup(p, t0), job = S.job;
    schedule(p);
    var wb = new XL.Workbook(); wb.creator = 'MBS Console'; wb.created = new Date(); wb.title = p.name;
    var INK = 'FF151515', GOLD = 'FFC9A227', GOLDSOFT = 'FFFBF4DC', GREY = 'FF6B675E', LINE = 'FFE4E0D6', WHITE = 'FFFFFFFF';
    var STC = { todo: 'FFE5E7EB', doing: 'FFDBEAFE', review: 'FFEDE9FE', done: 'FFDCFCE7' }, STB = { todo: 'FF9CA3AF', doing: 'FF2563EB', review: 'FF7C3AED', done: 'FF16A34A' };
    var PBC = { 0: 'FFE5E7EB', 25: 'FFFEF3C7', 50: 'FFDBEAFE', 75: 'FFEDE9FE', 100: 'FFDCFCE7' }, PBB = { 0: 'FF94A3B8', 25: 'FFF59E0B', 50: 'FF2563EB', 75: 'FF7C3AED', 100: 'FF16A34A' };
    var fill = function (c) { return { type: 'pattern', pattern: 'solid', fgColor: { argb: c } }; };
    var thin = { style: 'thin', color: { argb: LINE } }, box = { top: thin, left: thin, bottom: thin, right: thin };
    var D = function (s) { if (!s) return null; var a = s.split('-').map(Number); return new Date(Date.UTC(a[0], a[1] - 1, a[2])); };
    var money$ = '"$"#,##0.00', dateF = 'd mmm yyyy';
    var titleBlock = function (ws, title, cols) {
      ws.mergeCells(1, 1, 1, cols); var c = ws.getCell(1, 1); c.value = title; c.font = { bold: true, size: 16, color: { argb: INK } };
      ws.mergeCells(2, 1, 2, cols); var d = ws.getCell(2, 1);
      d.value = p.name + '  ·  ' + (job.ref || '') + (job.name ? '  ·  ' + job.name : '') + (job.suburb ? ', ' + job.suburb : '') + '  ·  exported ' + prettyY(t0);
      d.font = { size: 10, color: { argb: GREY } };
      ws.getRow(1).height = 24;
    };
    var header = function (ws, rowNo, labels) {
      var r = ws.getRow(rowNo); r.values = labels; r.height = 22;
      r.eachCell(function (c) { c.font = { bold: true, color: { argb: WHITE } }; c.fill = fill(INK); c.alignment = { vertical: 'middle', wrapText: true }; c.border = box; });
      return r;
    };
    var footer = function (ws, rowNo) { var c = ws.getCell(rowNo, 1); c.value = 'GKH Project Champ · Global Knowledge House · ' + prettyY(t0); c.font = { size: 9, italic: true, color: { argb: GREY } }; };
    var ragFill = function (c) { return fill(c === 'green' ? 'FFDCFCE7' : c === 'amber' ? 'FFFEF3C7' : c === 'red' ? 'FFFDE2D8' : 'FFF1EEE6'); };
    var num = {}; p.tasks.forEach(function (t, i) { num[t.id] = i + 1; });

    /* 1. Overview */
    var ov = wb.addWorksheet('Overview', { views: [{ showGridLines: false }] });
    ov.columns = [{ width: 34 }, { width: 22 }, { width: 50 }];
    titleBlock(ov, 'Project overview', 3);
    var openRisks = (p.risks || []).filter(function (r) { return r.status !== 'Closed'; }), openIssues = (p.issues || []).filter(function (x) { return x.status !== 'Resolved'; });
    header(ov, 4, ['Status', 'Value', 'Notes']);
    var kp = [
      ['Scope: % complete', R.pct / 100, R.done + ' of ' + R.total + ' tasks done', rag(R.total ? R.pct / Math.max(1, timePct(R)) : null, 0.95, 0.8), '0%'],
      ['Time: planned finish', D(R.finish), (R.SPI == null ? 'not started' : 'SPI ' + R.SPI) + (R.late.length ? ' · ' + R.late.length + ' late task' + (R.late.length === 1 ? '' : 's') : ''), R.late.length ? 'red' : evRag(R.SPI), dateF],
      ['Cost: spent so far', R.AC, 'of ' + money(R.BAC) + ' budget' + (R.ACest > 0 ? ' (' + money(R.ACest) + ' estimated from progress where no actual is entered)' : '') + (R.CPI == null ? '' : ' · CPI ' + R.CPI + ' · forecast ' + money(R.EAC)), evRag(R.CPI), money$],
      ['Risks open (high)', openRisks.length, openRisks.filter(function (r) { return r.p * r.i >= 12; }).length + ' high risk(s)', openRisks.some(function (r) { return r.p * r.i >= 15; }) ? 'red' : 'green', '0'],
      ['Issues open', openIssues.length, openIssues.filter(function (x) { return /High|Critical/.test(x.priority); }).length + ' high or critical', openIssues.some(function (x) { return /High|Critical/.test(x.priority); }) ? 'amber' : 'green', '0']
    ];
    kp.forEach(function (k, i) { var r = ov.getRow(5 + i); r.values = [k[0], k[1], k[2]]; r.getCell(2).numFmt = k[4]; r.getCell(2).font = { bold: true }; r.eachCell(function (c) { c.border = box; c.fill = ragFill(k[3]); }); });
    header(ov, 11, ['Earned value (time & cost)', 'Value', 'What it means']);
    var ev = [['Budget at completion (BAC)', R.BAC, 'Total planned cost', money$], ['Planned value (PV)', R.PV, 'Work that should be done by today', money$], ['Earned value (EV)', R.EV, 'Work actually done (cost × % complete)', money$],
      ['Actual cost (AC)', R.AC, 'Money spent so far', money$], ['Schedule performance (SPI = EV ÷ PV)', R.SPI, R.SPI == null ? '' : R.SPI >= 1 ? 'on or ahead of schedule' : 'behind schedule', '0.00'],
      ['Cost performance (CPI = EV ÷ AC)', R.CPI, R.CPI == null ? '' : R.CPI >= 1 ? 'on or under budget' : 'over budget', '0.00'], ['Forecast final cost (EAC = BAC ÷ CPI)', R.EAC, '', money$]];
    ev.forEach(function (e, i) { var r = ov.getRow(12 + i); r.values = [e[0], e[1] == null ? '–' : e[1], e[2]]; r.getCell(2).numFmt = e[3]; r.eachCell(function (c) { c.border = box; }); });
    var rr = 20;
    ov.getCell(rr, 1).value = 'Project start'; ov.getCell(rr, 2).value = D(R.start); ov.getCell(rr, 2).numFmt = dateF;
    ov.getCell(rr + 1, 1).value = 'Planned finish'; ov.getCell(rr + 1, 2).value = D(R.finish); ov.getCell(rr + 1, 2).numFmt = dateF;
    if (p.baseline) { ov.getCell(rr + 2, 1).value = 'Baseline finish (set ' + M.day(p.baseline.at) + ')'; ov.getCell(rr + 2, 2).value = D(p.baseline.finish); ov.getCell(rr + 2, 2).numFmt = dateF; ov.getCell(rr + 2, 3).value = varDays(p.baseline.finish, R.finish); ov.getCell(rr + 3, 1).value = 'Baseline budget'; ov.getCell(rr + 3, 2).value = p.baseline.BAC; ov.getCell(rr + 3, 2).numFmt = money$; }
    if (R.late.length) { var lr = rr + 5; ov.getCell(lr, 1).value = 'Late tasks'; ov.getCell(lr, 1).font = { bold: true }; R.late.forEach(function (t, i) { ov.getCell(lr + 1 + i, 1).value = t.name; ov.getCell(lr + 1 + i, 2).value = D(t.ef); ov.getCell(lr + 1 + i, 2).numFmt = dateF; ov.getCell(lr + 1 + i, 3).value = t.pct + '% done, was due ' + prettyY(t.ef); ov.getRow(lr + 1 + i).font = { color: { argb: 'FFB42318' } }; }); rr = lr + R.late.length + 1; }
    footer(ov, rr + 7);

    /* 2. Schedule (tasks + sub-tasks grouped under them) */
    var sc = wb.addWorksheet('Schedule', { views: [{ state: 'frozen', xSplit: 2, ySplit: 4 }], properties: { outlineProperties: { summaryBelow: false } } });
    var cols = ['#', 'Task / sub-task', 'People (lead first)', 'Lead', 'Days', 'Start', 'Finish', 'After #', 'Qty', 'Unit', 'Unit $', 'Cost', 'Actual $', 'Status', '% complete', 'Late'];
    sc.columns = [6, 40, 28, 14, 7, 13, 13, 9, 8, 8, 11, 13, 12, 15, 11, 7, 26].map(function (w) { return { width: w }; });
    titleBlock(sc, 'Schedule', cols.length);
    header(sc, 4, cols);
    var row = 5, first = 5;
    p.tasks.forEach(function (t, i) {
      var late = t.pct < 100 && t.ef && t.ef < t0, mts = matsOf(t).map(function (m) { var x = invItem(m.item); return (m.qty || 0) + ' × ' + (x ? x.name : m.item); }).join(', ');
      var r = sc.getRow(row);
      r.values = [i + 1, (t.dur === 0 ? '◆ ' : '') + t.name, resText(t), t.lead || '', t.dur, D(t.es), D(t.ef), (t.pred || []).map(function (id) { return num[id]; }).filter(Boolean).join(', '),
        Number(t.qty) || 0, t.unit || '', Number(t.rate) || 0, (matsOf(t).length ? { formula: 'I' + row + '*K' + row + '+' + matCost(t), result: cost(t) } : { formula: 'I' + row + '*K' + row, result: cost(t) }), Number(t.actual) || 0, stName[t.status], (t.pct || 0) / 100, late ? 'Yes' : ''];
      r.font = { bold: !!(t.subs && t.subs.length), color: late ? { argb: 'FFB42318' } : undefined };
      [6, 7].forEach(function (c) { r.getCell(c).numFmt = dateF; }); [11, 12, 13].forEach(function (c) { r.getCell(c).numFmt = money$; }); r.getCell(15).numFmt = '0%';
      r.getCell(14).fill = fill(STC[t.status]); r.eachCell({ includeEmpty: true }, function (c) { c.border = box; c.alignment = { vertical: 'top', wrapText: c.col === 2 || c.col === 3 }; });
      row++;
      (t.subs || []).forEach(function (sb, j) {
        var d = subDates(t, sb), sl = sb.status !== 'done' && d.ef && d.ef < t0, s2 = sc.getRow(row);
        s2.values = [(i + 1) + '.' + (j + 1), '    ↳ ' + sb.name, sb.owner || '', '', sb.dur, D(d.es), D(d.ef), 'in #' + (i + 1), null, null, null, null, null, stName[sb.status], subPct(sb) / 100, sl ? 'Yes' : '', ''];
        s2.outlineLevel = 1; s2.font = { size: 10, color: { argb: sl ? 'FFB42318' : 'FF4A463D' } };
        [6, 7].forEach(function (c) { s2.getCell(c).numFmt = dateF; }); s2.getCell(15).numFmt = '0%'; s2.getCell(14).fill = fill(STC[sb.status]);
        s2.eachCell({ includeEmpty: true }, function (c) { c.border = box; c.fill = c.col === 14 ? c.fill : fill('FFFCFBF8'); });
        row++;
        (sb.steps || []).forEach(function (q, k) {   // v85: steps (outline level 2)
          var qd = stepDates(t, sb, q), ql = !q.done && qd.ef && qd.ef < t0, s3 = sc.getRow(row);
          s3.values = [(i + 1) + '.' + (j + 1) + '.' + (k + 1), '        ↳ ' + (q.done ? '☑ ' : '☐ ') + q.name, '', '', q.dur, D(qd.es), D(qd.ef), 'in #' + (i + 1) + '.' + (j + 1), null, null, null, null, null, q.done ? 'Done' : 'To do', q.done ? 1 : 0, ql ? 'Yes' : '', ''];
          s3.outlineLevel = 2; s3.font = { size: 9, color: { argb: ql ? 'FFB42318' : 'FF6B665A' } };
          [6, 7].forEach(function (c) { s3.getCell(c).numFmt = dateF; }); s3.getCell(15).numFmt = '0%';
          s3.eachCell({ includeEmpty: true }, function (c) { c.border = box; c.fill = fill('FFFDFDFB'); });
          row++;
        });
      });
    });
    var tot = sc.getRow(row);
    tot.values = ['', 'Total (budget at completion)', '', '', '', D(R.start), D(R.finish), '', '', '', '', { formula: 'SUBTOTAL(9,L' + first + ':L' + (row - 1) + ')', result: R.BAC }, { formula: 'SUBTOTAL(9,M' + first + ':M' + (row - 1) + ')', result: R.AC }, '', R.pct / 100, '', ''];
    tot.font = { bold: true }; [6, 7].forEach(function (c) { tot.getCell(c).numFmt = dateF; }); [12, 13].forEach(function (c) { tot.getCell(c).numFmt = money$; }); tot.getCell(15).numFmt = '0%';
    tot.eachCell({ includeEmpty: true }, function (c) { c.fill = fill(GOLDSOFT); c.border = box; });
    sc.autoFilter = { from: { row: 4, column: 1 }, to: { row: row - 1, column: cols.length } };
    footer(sc, row + 2);

    /* 3. Gantt (one column per working day, or per week for long jobs) */
    var gs = wb.addWorksheet('Gantt', { views: [{ state: 'frozen', xSplit: 5, ySplit: 5, showGridLines: false }] });
    var startS = R.start || t0, endS = R.finish || t0, days = [], dd = startS;
    if (t0 < startS) startS = t0;
    var guard = 0; dd = nextWork(startS); while (dd <= endS && guard++ < 400) { days.push(dd); dd = addWork(dd, 1); }
    var weekly = days.length > 90, slots = weekly ? days.filter(function (x, i) { return i === 0 || toD(x).getUTCDay() === 1; }) : days;
    var slotOf = function (s) { if (!weekly) return days.indexOf(s); var k = -1; slots.forEach(function (x, i) { if (x <= s) k = i; }); return k; };
    gs.columns = [{ width: 6 }, { width: 34 }, { width: 11 }, { width: 11 }, { width: 7 }].concat(slots.map(function () { return { width: weekly ? 4 : 3.2 }; }));
    titleBlock(gs, 'Gantt chart (' + (weekly ? 'weeks' : 'working days') + ')', Math.min(5 + slots.length, 30));
    var mRow = gs.getRow(4), dRow = gs.getRow(5);
    dRow.values = ['#', 'Task', 'Start', 'Finish', '%'].concat(slots.map(function (x) { return +x.slice(8); }));
    dRow.eachCell(function (c) { c.font = { bold: true, size: c.col > 5 ? 8 : 10, color: { argb: WHITE } }; c.fill = fill(INK); c.alignment = { horizontal: 'center', vertical: 'middle' }; });
    var lastM = '';
    slots.forEach(function (x, i) { var m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+x.slice(5, 7) - 1] + ' ' + x.slice(2, 4); if (m !== lastM) { mRow.getCell(6 + i).value = m; mRow.getCell(6 + i).font = { bold: true, size: 9 }; lastM = m; } if (x === t0 || (weekly && slotOf(t0) === i)) { dRow.getCell(6 + i).fill = fill('FFC2410C'); } });
    var gr = 6;
    var paint = function (r, es, ef, status, late, light) {
      if (!es) return; var a = slotOf(es), b = slotOf(ef);
      for (var k = Math.max(0, a); k <= b && k < slots.length; k++) { var c = r.getCell(6 + k); c.fill = fill(late ? 'FFFCA5A5' : light ? PBC[status] : PBB[status]); }
    };
    var tCol = slotOf(t0);
    p.tasks.forEach(function (t, i) {
      var r = gs.getRow(gr), late = t.pct < 100 && t.ef && t.ef < t0;
      r.values = [i + 1, (t.dur === 0 ? '◆ ' : '') + t.name, D(t.es), D(t.ef), (t.pct || 0) / 100];
      r.getCell(3).numFmt = 'd mmm'; r.getCell(4).numFmt = 'd mmm'; r.getCell(5).numFmt = '0%'; r.font = { bold: !!(t.subs && t.subs.length), size: 10 };
      if (tCol >= 0) r.getCell(6 + tCol).border = { left: { style: 'thin', color: { argb: 'FFC2410C' } } };
      if (t.dur === 0) { var mc = r.getCell(6 + Math.max(0, slotOf(t.es))); mc.value = '◆'; mc.font = { bold: true, color: { argb: t.pct >= 100 ? 'FF16A34A' : INK } }; mc.alignment = { horizontal: 'center' }; }
      else paint(r, t.es, t.ef, pband(t.pct), late, false);
      gr++;
      (t.subs || []).forEach(function (sb, j) {
        var d = subDates(t, sb), s2 = gs.getRow(gr);
        s2.values = [(i + 1) + '.' + (j + 1), '    ↳ ' + sb.name, D(d.es), D(d.ef), subPct(sb) / 100];
        s2.getCell(3).numFmt = 'd mmm'; s2.getCell(4).numFmt = 'd mmm'; s2.getCell(5).numFmt = '0%'; s2.font = { size: 9, color: { argb: 'FF4A463D' } }; s2.outlineLevel = 1;
        paint(s2, d.es, d.ef, pband(subPct(sb)), sb.status !== 'done' && d.ef < t0, true); gr++;
        (sb.steps || []).forEach(function (q, k) {   // v85: steps
          var qd = stepDates(t, sb, q), s3 = gs.getRow(gr);
          s3.values = [(i + 1) + '.' + (j + 1) + '.' + (k + 1), '        ↳ ' + (q.done ? '☑ ' : '☐ ') + q.name, D(qd.es), D(qd.ef), q.done ? 1 : 0];
          s3.getCell(3).numFmt = 'd mmm'; s3.getCell(4).numFmt = 'd mmm'; s3.getCell(5).numFmt = '0%'; s3.font = { size: 8, color: { argb: 'FF6B665A' } }; s3.outlineLevel = 2;
          paint(s3, qd.es, qd.ef, q.done ? 100 : 0, !q.done && qd.ef < t0, true); gr++;
        });
      });
    });
    var legend = gs.getRow(gr + 1);
    legend.getCell(2).value = 'Colours by progress: grey 0% · amber 25% · blue 50% · purple 75% · green 100% done · red late · ◆ milestone · orange header = today'; legend.getCell(2).font = { size: 9, italic: true, color: { argb: GREY } };
    footer(gs, gr + 3);

    /* 4. Board */
    var bd = wb.addWorksheet('Board', { views: [{ state: 'frozen', ySplit: 4, showGridLines: false }] });
    bd.columns = STATUS.map(function () { return { width: 38 }; });
    titleBlock(bd, 'Board', 4);
    var bh = header(bd, 4, STATUS.map(function (x) { return x[1] + ' (' + x[2] + '%)'; }));
    STATUS.forEach(function (x, i) { bh.getCell(i + 1).fill = fill(STB[x[0]]); });
    STATUS.forEach(function (x, ci) {
      var list = p.tasks.filter(function (t) { return t.status === x[0]; });
      list.forEach(function (t, ri) {
        var lines = [(t.dur === 0 ? '◆ ' : '') + t.name, (resShort(t) || 'No one assigned') + ' · ' + pretty(t.es) + (t.dur ? ' – ' + pretty(t.ef) : '') + ' · ' + t.pct + '%'];
        if (t.owner || t.priority || t.points) lines.push([ownerOf(t) ? 'Owner: ' + ownerOf(t) : '', t.priority ? t.priority + ' priority' : '', t.points ? t.points + ' pts' : ''].filter(Boolean).join(' · '));
        (t.subs || []).forEach(function (sb) { lines.push((sb.status === 'done' ? '☑ ' : '☐ ') + sb.name + [sb.owner, sb.priority ? PL[sb.priority] : '', sb.points ? sb.points + ' pts' : ''].filter(Boolean).map(function (x, i) { return (i ? ', ' : ' (') + x; }).join('') + ([sb.owner, sb.priority, sb.points].some(Boolean) ? ')' : '')); });
        var c = bd.getCell(5 + ri, ci + 1); c.value = lines.join('\n'); c.alignment = { wrapText: true, vertical: 'top' }; c.border = box; c.fill = fill(STC[x[0]]);
        var h = 16 * lines.length + 6; if ((bd.getRow(5 + ri).height || 0) < h) bd.getRow(5 + ri).height = h;
        if (t.pct < 100 && t.ef < t0) c.font = { color: { argb: 'FFB42318' } };
      });
    });
    footer(bd, 6 + Math.max.apply(null, STATUS.map(function (x) { return p.tasks.filter(function (t) { return t.status === x[0]; }).length; }).concat([1])));

    /* 5. Scope (project charter) */
    var sp = wb.addWorksheet('Scope', { views: [{ showGridLines: false }] });
    sp.columns = [{ width: 30 }, { width: 90 }];
    titleBlock(sp, 'Project charter (scope)', 2);
    var c = p.charter || {};
    header(sp, 4, ['Item', 'Details']);
    [['Plan name', p.name], ['Customer (sponsor)', c.customer], ['Project manager', c.manager], ['Approved budget', c.budget ? Number(c.budget) : ''], ['Planned cost (BAC)', R.BAC], ['Objective', c.objective], ['In scope', c.inScope], ['Out of scope', c.outScope], ['Deliverables', c.deliverables], ['Acceptance criteria', c.acceptance], ['Assumptions & constraints', c.assumptions], ['Planning notes & tips', c.notes]]
      .forEach(function (x, i) { var r = sp.getRow(5 + i); r.values = [x[0], x[1] == null ? '' : x[1]]; r.getCell(1).font = { bold: true }; r.getCell(1).fill = fill(GOLDSOFT); r.getCell(2).alignment = { wrapText: true, vertical: 'top' }; if (typeof x[1] === 'number') r.getCell(2).numFmt = money$; r.eachCell(function (cc) { cc.border = box; }); var len = String(x[1] || '').length; if (len > 90) r.height = 15 * Math.ceil(len / 90) + 4; });
    footer(sp, 18);

    /* 6. Risks (register + heat map) */
    var rk = wb.addWorksheet('Risks', { views: [{ state: 'frozen', ySplit: 4 }] });
    rk.columns = [6, 38, 30, 11, 9, 8, 12, 44, 16, 13, 10].map(function (w) { return { width: w }; });
    titleBlock(rk, 'Risk register', 11);
    header(rk, 4, ['#', 'Risk', 'Cause / trigger', 'Probability (1-5)', 'Impact (1-5)', 'Score', 'Response', 'Action', 'Owner', 'Review date', 'Status']);
    var scoreFill = function (sv) { return fill(sv >= 15 ? 'FFFDE2D8' : sv >= 8 ? 'FFFEF3C7' : 'FFDCFCE7'); };
    (p.risks || []).forEach(function (r, i) {
      var x = rk.getRow(5 + i), sv = r.p * r.i;
      x.values = [i + 1, r.title, r.cause, r.p, r.i, { formula: 'D' + (5 + i) + '*E' + (5 + i), result: sv }, r.response, r.action, r.owner, D(r.review), r.status];
      x.getCell(6).fill = scoreFill(sv); x.getCell(6).font = { bold: true }; x.getCell(10).numFmt = dateF;
      x.eachCell({ includeEmpty: true }, function (cc) { cc.border = box; cc.alignment = { vertical: 'top', wrapText: [2, 3, 8].indexOf(cc.col) >= 0 }; });
      if (r.status === 'Closed') x.font = { color: { argb: 'FF8A867C' }, strike: true };
    });
    var hm = 7 + (p.risks || []).length;
    rk.getCell(hm, 2).value = 'Heat map: open risks (probability down, impact across)'; rk.getCell(hm, 2).font = { bold: true };
    for (var pr = 5; pr >= 1; pr--) {
      var hr = rk.getRow(hm + 1 + (5 - pr)); hr.getCell(3).value = 'P' + pr; hr.getCell(3).alignment = { horizontal: 'right' };
      for (var im = 1; im <= 5; im++) { var n = openRisks.filter(function (r) { return r.p === pr && r.i === im; }).length, cc = hr.getCell(3 + im); cc.value = n || ''; cc.fill = scoreFill(pr * im); cc.border = box; cc.alignment = { horizontal: 'center' }; cc.font = { bold: true }; }
    }
    var ix = rk.getRow(hm + 6); for (var im2 = 1; im2 <= 5; im2++) { ix.getCell(3 + im2).value = 'I' + im2; ix.getCell(3 + im2).alignment = { horizontal: 'center' }; }
    footer(rk, hm + 8);

    /* 7. Issues */
    var is = wb.addWorksheet('Issues', { views: [{ state: 'frozen', ySplit: 4 }] });
    is.columns = [6, 38, 40, 11, 16, 13, 13, 13, 44].map(function (w) { return { width: w }; });
    titleBlock(is, 'Issue log', 9);
    header(is, 4, ['#', 'Issue', 'Details', 'Priority', 'Owner', 'Raised', 'Due', 'Status', 'Resolution']);
    var prFill = { Low: 'FFDCFCE7', Medium: 'FFFEF3C7', High: 'FFFED7AA', Critical: 'FFFDE2D8' };
    (p.issues || []).forEach(function (x, i) {
      var r = is.getRow(5 + i), overdue = x.status !== 'Resolved' && x.due && x.due < t0;
      r.values = [i + 1, x.title, x.detail, x.priority, x.owner, D(x.raised), D(x.due), x.status, x.resolution];
      r.getCell(4).fill = fill(prFill[x.priority] || 'FFF1EEE6'); [6, 7].forEach(function (cc) { r.getCell(cc).numFmt = dateF; });
      if (overdue) r.getCell(7).font = { bold: true, color: { argb: 'FFB42318' } };
      r.eachCell({ includeEmpty: true }, function (cc) { cc.border = box; cc.alignment = { vertical: 'top', wrapText: [2, 3, 9].indexOf(cc.col) >= 0 }; });
      if (x.status === 'Resolved') r.font = { color: { argb: 'FF8A867C' } };
    });
    if (!(p.issues || []).length) is.getCell(5, 2).value = 'No issues logged.';
    footer(is, 7 + (p.issues || []).length);

    /* 7b. v45: Stakeholders (RACI) */
    var sk = wb.addWorksheet('Stakeholders', { views: [{ state: 'frozen', ySplit: 4 }] });
    sk.columns = [6, 28, 26, 18, 18, 34].map(function (w) { return { width: w }; });
    titleBlock(sk, 'Stakeholder list (RACI)', 6);
    header(sk, 4, ['#', 'Name', 'Role', 'RACI', 'Contact number', 'Email']);
    var raFill = { R: 'FFDBEAFE', A: 'FFFDE68A', C: 'FFDCFCE7', I: 'FFF1EEE6' };
    (p.stakeholders || []).forEach(function (x, i) {
      var r = sk.getRow(5 + i);
      r.values = [i + 1, x.name, x.role, x.raci + ' – ' + RACI[x.raci][0], x.phone, x.email];
      r.getCell(4).fill = fill(raFill[x.raci] || 'FFF1EEE6');
      r.eachCell({ includeEmpty: true }, function (cc) { cc.border = box; cc.alignment = { vertical: 'top', wrapText: cc.col === 2 || cc.col === 3 }; });
    });
    if (!(p.stakeholders || []).length) sk.getCell(5, 2).value = 'No stakeholders listed.';
    footer(sk, 7 + (p.stakeholders || []).length);

    /* 7c. v53: Contracts (only when there are some) */
    if ((p.contracts || []).length) {
      var cs = wb.addWorksheet('Contracts', { views: [{ state: 'frozen', ySplit: 4 }] });
      cs.columns = [6, 20, 36, 44, 14].map(function (w) { return { width: w }; });
      titleBlock(cs, 'Contracts', 5);
      header(cs, 4, ['#', 'Type', 'With', 'Document', 'Uploaded']);
      var dn = {}; ((S.intel && S.intel.docs) || []).forEach(function (d) { dn[d.id] = d.name; });
      p.contracts.forEach(function (c, i) {
        var r = cs.getRow(5 + i);
        r.values = [i + 1, c.type === 'Customer' ? 'Customer contract' : c.type, c.party, dn[(c.docs || [])[0]] || '', c.at ? new Date(c.at) : null];
        r.getCell(5).numFmt = dateF; r.eachCell({ includeEmpty: true }, function (cc) { cc.border = box; cc.alignment = { vertical: 'top', wrapText: cc.col >= 3 && cc.col <= 4 }; });
      });
      footer(cs, 7 + p.contracts.length);
    }

    /* 8. Materials from stock (only when tasks use stock items) */
    var by = {};
    p.tasks.forEach(function (t) { matsOf(t).forEach(function (m) { var b = by[m.item] = by[m.item] || { need: 0, used: 0, tasks: [] }; if (t.status === 'done') b.used += Number(m.qty) || 0; else b.need += Number(m.qty) || 0; b.tasks.push(t.name + ' (' + (m.qty || 0) + ')'); }); });
    if (false && Object.keys(by).length) {   // GKH Project Champ: no Inventory
      var mt = wb.addWorksheet('Materials', { views: [{ state: 'frozen', ySplit: 4 }] });
      mt.columns = [34, 10, 12, 12, 14, 12, 40].map(function (w) { return { width: w }; });
      titleBlock(mt, 'Materials from stock', 7);
      header(mt, 4, ['Stock item', 'Unit', 'Still needed', 'Used', 'Available now', 'Unit price', 'Tasks']);
      Object.keys(by).forEach(function (id, i) {
        var it = invItem(id) || { name: id, unit: '', available: '', price: 0 }, b = by[id], r = mt.getRow(5 + i);
        r.values = [it.name, it.unit, b.need, b.used, it.available, it.price || 0, b.tasks.join(', ')]; r.getCell(6).numFmt = money$;
        if (typeof it.available === 'number' && it.available < 0) r.getCell(5).font = { bold: true, color: { argb: 'FFB42318' } };
        r.eachCell({ includeEmpty: true }, function (cc) { cc.border = box; cc.alignment = { vertical: 'top', wrapText: cc.col === 7 }; });
      });
    }
    wb.eachSheet(function (ws) { ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 }; });
    return wb;
  }


  /* ---------- v61: the task list like Excel: drag a heading's edge to size a column, and freeze the first columns ---------- */
  var GFZ = [[0, 'None'], [3, '# and Task'], [4, 'up to Resources'], [5, 'up to Days'], [6, 'up to Start'], [7, 'up to Finish']];
  function gfzName() { var o = GFZ.filter(function (x) { return x[0] === S.freeze; })[0]; return o ? o[1] : 'None'; }
  function gFreezeMenu(btn) {
    var old = document.getElementById('gFzMenu'); if (old) { old.remove(); return; }
    var r = btn.getBoundingClientRect(), m = document.createElement('div');
    m.id = 'gFzMenu'; m.className = 'gfz-menu';
    m.innerHTML = '<b>❄ Freeze columns</b><small class="muted">They stay put while you scroll the task list sideways. The heading row is always frozen.</small>' +
      '<label class="gfz-pick">Freeze <select id="gFreeze">' + GFZ.map(function (o) { return '<option value="' + o[0] + '"' + (S.freeze === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>' +
      '<b style="margin-top:8px">↔ Column widths</b><small class="muted">Drag the edge of a column heading to make it wider or narrower; double-click the edge for its normal width.</small>' +
      '<button type="button" class="btn btn-sm" id="gColReset"' + (Object.keys(S.colW).length ? '' : ' disabled') + '>↺ All columns to normal width</button>';
    document.body.appendChild(m);
    m.style.left = Math.max(8, Math.min(window.innerWidth - m.offsetWidth - 8, r.left)) + 'px'; m.style.top = (r.bottom + 6) + 'px';
    var close = function (e) { if (e && m.contains(e.target)) return; m.remove(); document.removeEventListener('pointerdown', close, true); window.removeEventListener('hashchange', close); };
    setTimeout(function () { document.addEventListener('pointerdown', close, true); window.addEventListener('hashchange', close); }, 0);
    $('#gFreeze').onchange = function () { S.freeze = +this.value; try { localStorage.setItem('mbsPlanFreeze', S.freeze); } catch (e) {} gFreeze(); var b = $('#gFreezeBtn'); if (b) b.textContent = '❄ ' + gfzName(); };
    $('#gColReset').onclick = function () { S.colW = {}; try { localStorage.removeItem('mbsPlanColW'); } catch (e) {} gColCss(); close(); render(); };
  }
  function gStyle(id) { var el = document.getElementById(id); if (!el) { el = document.createElement('style'); el.id = id; document.head.appendChild(el); } return el; }
  function gColCss() {
    gStyle('gtColW').textContent = Object.keys(S.colW).map(function (k) {
      var w = Math.round(S.colW[k]), c = '#gLeft table.gt tr>:nth-child(' + k + ')';
      return c + '{width:' + w + 'px!important;min-width:' + w + 'px!important;max-width:' + w + 'px!important;overflow:hidden;text-overflow:ellipsis}' +
        c + ' input:not([type=checkbox]),' + c + ' select,' + c + ' .dtext{width:100%!important;min-width:0!important;max-width:100%!important;box-sizing:border-box}';
    }).join('\n');
  }
  function gFreeze() {
    var L = $('#gLeft'), css = '';
    if (L && S.freeze) {
      var ths = L.querySelectorAll('thead th'), x = 0, last = 0;
      for (var i = 1; i <= S.freeze && i <= ths.length; i++) {
        var w = ths[i - 1].getBoundingClientRect().width; if (!w) continue;   // hidden in this view
        var c = '#gLeft table.gt tr>:nth-child(' + i + ')';
        css += c + '{position:sticky;left:' + Math.round(x) + 'px}#gLeft table.gt tbody td:nth-child(' + i + '){z-index:2}#gLeft table.gt thead th:nth-child(' + i + '),#gLeft table.gt tfoot td:nth-child(' + i + '){z-index:5}\n';
        x += w; last = i;
      }
      if (last) css += '#gLeft table.gt tr>:nth-child(' + last + '){box-shadow:inset -2px 0 0 #C9A227}';
    }
    gStyle('gtFreeze').textContent = css;
    if (L) L.classList.toggle('gfz-on', !!css);
  }
  function gColHandles(L, sync) {
    var ths = L.querySelectorAll('thead th');
    Array.prototype.forEach.call(ths, function (th, i) {
      if (i === ths.length - 1) return;   // the buttons column
      var k = i + 1, h = document.createElement('span');
      h.className = 'gcr'; h.title = 'Drag to size this column · double-click for its normal width';
      th.appendChild(h); th.classList.add('gcr-th');
      h.addEventListener('pointerdown', function (e) {
        e.preventDefault(); e.stopPropagation(); h.setPointerCapture(e.pointerId); document.body.classList.add('gcr-drag');
        var x0 = e.clientX, w0 = th.getBoundingClientRect().width, raf = 0;
        var move = function (ev) { S.colW[k] = Math.max(28, Math.min(600, w0 + ev.clientX - x0)); gColCss(); if (!raf) raf = requestAnimationFrame(function () { raf = 0; gFreeze(); sync(); }); };
        var up = function () { h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); document.body.classList.remove('gcr-drag'); try { localStorage.setItem('mbsPlanColW', JSON.stringify(S.colW)); } catch (er) {} gFreeze(); sync(); };
        h.addEventListener('pointermove', move); h.addEventListener('pointerup', up);
      });
      h.addEventListener('dblclick', function (e) { e.stopPropagation(); delete S.colW[k]; try { localStorage.setItem('mbsPlanColW', JSON.stringify(S.colW)); } catch (er) {} gColCss(); gFreeze(); sync(); });
    });
  }
  /* ---------- the grid and the Gantt chart side by side, with a divider you can drag ---------- */
  function splitPanes(todayX) {
    var L = $('#gLeft'), Rt = $('#gRight'), bar = $('#gSplitter'), box = $('#gSplit');
    if (!L || !Rt) return;
    var sync = function () {
      var pairs = [[L.querySelector('thead tr'), Rt.querySelector('thead tr')], [L.querySelector('tfoot tr'), Rt.querySelector('tfoot tr')]];
      var lr = L.querySelectorAll('tbody tr'), rr = Rt.querySelectorAll('tbody tr');
      for (var i = 0; i < lr.length; i++) pairs.push([lr[i], rr[i]]);
      pairs.forEach(function (pr) { if (!pr[0] || !pr[1]) return; pr[0].style.height = pr[1].style.height = ''; });
      pairs.forEach(function (pr) { if (!pr[0] || !pr[1]) return; var tk = pr[1].querySelector('.gtrack'); if (tk) tk.style.height = ''; });
      pairs.forEach(function (pr) { if (!pr[0] || !pr[1]) return; var h = Math.max(pr[0].getBoundingClientRect().height, pr[1].getBoundingClientRect().height); pr[0].style.height = pr[1].style.height = h + 'px'; var tk = pr[1].querySelector('.gtrack'); if (tk) tk.style.height = (h - 1) + 'px'; });
    };
    gColCss(); gColHandles(L, sync);
    sync(); gFreeze();
    if (window.ResizeObserver) { if (S.ro) S.ro.disconnect(); S.ro = new ResizeObserver(function () { window.requestAnimationFrame(sync); }); S.ro.observe(L.querySelector('table')); }
    var lock = false;
    L.addEventListener('scroll', function () { if (lock) { lock = false; return; } lock = true; Rt.scrollTop = L.scrollTop; });
    Rt.addEventListener('scroll', function () { if (lock) { lock = false; return; } lock = true; L.scrollTop = Rt.scrollTop; });
    if (S.scrollX != null && S.scrollCore === S.core) Rt.scrollLeft = S.scrollX; else { Rt.scrollLeft = Math.max(0, todayX - 140); S.scrollCore = S.core; }
    Rt.addEventListener('scroll', function () { S.scrollX = Rt.scrollLeft; });
    bar.addEventListener('pointerdown', function (e) {
      e.preventDefault(); bar.setPointerCapture(e.pointerId); box.classList.add('dragging');
      var x0 = box.getBoundingClientRect().left, maxW = box.getBoundingClientRect().width - 140;
      var moveTo = function (ev) { var w = Math.max(220, Math.min(maxW, ev.clientX - x0)); L.style.flex = '0 0 ' + w + 'px'; L.style.maxWidth = 'none'; S.split = Math.round(w); };
      var up = function () { bar.removeEventListener('pointermove', moveTo); bar.removeEventListener('pointerup', up); box.classList.remove('dragging'); try { localStorage.setItem('mbsPlanSplit', S.split); } catch (er) {} sync(); };
      bar.addEventListener('pointermove', moveTo); bar.addEventListener('pointerup', up);
    });
    bar.addEventListener('dblclick', function () { S.split = 0; try { localStorage.removeItem('mbsPlanSplit'); } catch (er) {} L.style.flex = ''; L.style.maxWidth = ''; sync(); });
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
  /* ---------- board (v65): one card per THEME (a task), its USER STORIES inside (the sub-tasks); each story has an owner,
     a priority (H, M, L) and points (Fibonacci up to 13); the theme's points add up its stories; the card is green when on
     track, amber when due within 3 days, red when the due date has passed ---------- */
  var PRIO = ['High', 'Medium', 'Low'], PTS = [1, 2, 3, 5, 8, 13], PL = { High: 'H', Medium: 'M', Low: 'L' };
  function bfState() { if (!S.bf) { var v = {}; try { v = JSON.parse(localStorage.getItem('mbsBoardF') || '{}') || {}; } catch (e) {} S.bf = { owner: v.owner || '', prio: v.prio || '', sort: v.sort || 'plan', q: '' }; } return S.bf; }
  function bfSave() { try { localStorage.setItem('mbsBoardF', JSON.stringify({ owner: S.bf.owner, prio: S.bf.prio, sort: S.bf.sort })); } catch (e) {} }
  // v86: People (employees and contractors) in the plan's pickers: resources, story owners, stakeholders, the project manager
  function pplAll() { return M.people ? M.people.list() : []; }
  function pplNames() { var o = {}; pplAll().forEach(function (x) { o[x.name.toLowerCase()] = x; }); return o; }
  function pplOpts() { return pplAll().map(function (x) { return '<option value="' + esc(x.name) + '" label="' + esc((x.role || x.type) + (x.costRate ? ' · $' + x.costRate + '/hr' : '')) + '">'; }).join(''); }
  function pplLoad() {   // once; never redraws the whole plan (that would close an open picker): the lists update in place
    if (!M.people || S.pplLoaded || !(M.allowed && M.allowed('people', 'view', ['projects']))) return;
    S.pplLoaded = true; if (pplAll().length) return;
    M.people.load().then(function () {
      if (!S.plan || !pplAll().length) return;
      var rl = document.getElementById('resList'); if (rl) rl.insertAdjacentHTML('afterbegin', pplOpts());
      var pm = document.getElementById('chPM'); if (pm) pm.innerHTML = pplAll().map(function (x) { return '<option value="' + esc(x.name) + '" label="' + esc(x.role || x.type) + '">'; }).join('');
      if (S.tab === 'stake' && !document.querySelector('#rcDrawer, .kpop')) render();
    }).catch(function () {});
  }
  function ownerOf(t) { var sh = (S.plan.stakeholders || []).filter(function (x) { return x.id === t.owner; })[0]; return sh ? (sh.name || sh.role) : (t.owner || ''); }
  function initials(n) { return String(n || '').split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0].toUpperCase(); }).join('') || '?'; }
  function kFit() {   // each column scrolls on its own, in the space left on the screen
    var first = document.querySelector('#planBody .kcards'); if (!first || window.innerWidth <= 820) return;
    var h = Math.max(260, window.innerHeight - first.getBoundingClientRect().top - 14);
    document.querySelectorAll('#planBody .kcards').forEach(function (k) { k.style.maxHeight = h + 'px'; });
  }
  function calDays(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5); }
  function kRag(es, ef, done, t0) {   // green on track, amber due within 3 days, red past the due date
    if (done) return { c: 'g', txt: 'Done' };
    if (!ef) return { c: 'g', txt: '' };
    var left = calDays(t0, ef);
    if (left < 0) return { c: 'r', txt: pl(-left, 'day') + ' late' };
    if (left <= 3) return { c: 'a', txt: left === 0 ? 'Due today' : 'Due in ' + pl(left, 'day') };
    return { c: 'g', txt: es > t0 ? 'Starts in ' + pl(calDays(t0, es), 'day') : pl(left, 'day') + ' left' };
  }
  function kShort(a, b) {   // 28 Oct, or 28–30 Oct, or 30 Oct – 2 Nov
    if (!a) return ''; var f = function (x) { return new Date(x + 'T00:00:00Z').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' }); };
    if (!b || a === b) return f(a); return a.slice(0, 7) === b.slice(0, 7) ? +a.slice(8) + '–' + f(b) : f(a) + ' – ' + f(b);
  }
  // v85: a story's dated steps on the Board: a tick list inside the story card (no slider), folded to a "☑ 2/4 steps" chip
  function kSteps(t, x) {
    var L = x.steps || [];
    if (!L.length) return kSlide(x) + '<button type="button" class="kstep-first" data-kstadd title="Break this story into dated steps with tick boxes">＋ steps</button><div class="kst-addrow" data-kstrow></div>';
    var n = L.filter(function (q) { return q.done; }).length, open = !!S.kStOpen[x.id], v = stepPct(x);
    return '<div class="ksteps' + (open ? ' open' : '') + '"><button type="button" class="kst-chip' + (n === L.length ? ' all' : '') + '" data-kstog aria-expanded="' + open + '"><span>' + (n === L.length ? '☑' : '☐') + ' ' + n + '/' + L.length + ' steps</span><span class="kst-bar"><i style="width:' + v + '%"></i></span><span class="kst-pc">' + v + '%</span><span>' + (open ? '▾' : '▸') + '</span></button>' +
      (open ? '<ul class="kst-list">' + L.map(function (q) { var d = stepDates(t, x, q), late = !q.done && d.ef && d.ef < today();
        return '<li class="' + (q.done ? 'done' : '') + (late ? ' late' : '') + '" data-kq="' + esc(q.id) + '"><label><input type="checkbox" data-kqdone' + (q.done ? ' checked' : '') + '><span>' + esc(q.name) + '</span></label><small title="' + esc(pretty(d.es) + (d.ef !== d.es ? ' – ' + pretty(d.ef) : '')) + '">' + esc(kShort(d.es, d.ef)) + '</small><button type="button" class="kdel-s" data-kqdel title="Delete this step" aria-label="Delete step">🗑</button></li>'; }).join('') +
        '</ul><div class="kst-addrow" data-kstrow></div><button type="button" class="kstep-add" data-kstadd>＋ step</button>' : '') + '</div>';
  }
  function kSlide(x) {   // 0 · 25 · 50 · 75 · 100 (done)
    var v = subPct(x);
    return '<div class="kslide kslide-' + v + '"><input type="range" min="0" max="100" step="25" value="' + v + '" data-sp="' + esc(x.id) + '" aria-label="Progress of ' + esc(x.name) + '" style="--v:' + v + '%">' +
      '<span class="kslide-v">' + (v >= 100 ? 'Done ✓' : v + '%') + '</span></div>';
  }
  function kInfo(key, desc) {   // v69: a small (i): the description of a theme or story
    return '<button type="button" class="kinfo' + (desc ? ' has' : '') + '" data-ki="' + key + '" title="' + esc(desc || 'Add a description') + '" aria-label="Description">i</button>';
  }
  function kDesc(it, after) {
    var o = it.o, max = 300;
    M.modal('<h2 class="kd-h"><span class="kinfo has">i</span> ' + esc(o.name.replace(/^[✓◆\s]+/, '')) + '</h2><p class="muted" style="margin:2px 0 10px">' + (it.theme ? 'Theme' : 'User story in “' + esc(it.task.name) + '”') + ': what it is about, then its <b>Definition of Done (DoD)</b>: the checks that must all be true before it is marked done.</p>' +
      '<textarea id="kdTxt" rows="4" maxlength="' + max + '" placeholder="e.g. ' + (it.theme ? 'Site walkover, survey and services scan so design can start.&#10;Definition of Done: report signed off by the PM; services located and marked; survey file received.' : 'Walk the site with the surveyor and mark boundaries and levels.&#10;Definition of Done: survey file received; levels checked against the plans.') + '">' + esc(o.desc || '') + '</textarea>' +
      '<div class="kd-foot"><button type="button" class="btn btn-sm btn-gold" id="kdAi">✨ Write it with AI</button><button type="button" class="btn btn-sm" id="kdDod" title="Add a Definition of Done line">＋ DoD</button><span class="muted" id="kdMsg"></span><span class="sp"></span><span class="kd-count" id="kdCnt"></span></div>' +
      '<p class="kd-warn" id="kdWarn" hidden>No Definition of Done yet: add what must be true before this is marked done (press ＋ DoD).</p>' +
      '<div class="actions" style="justify-content:flex-end"><button class="btn" data-close type="button">Cancel</button><button class="btn btn-gold" id="kdSave" type="button">Save</button></div>');
    var hasDod = function (v) { return /definition of done|\bdod\b/i.test(v); };
    var ta = $('#kdTxt'), cnt = function () { var n = ta.value.length; $('#kdCnt').textContent = n + ' / ' + max; $('#kdCnt').className = 'kd-count' + (n >= max ? ' full' : n > max - 20 ? ' near' : ''); $('#kdWarn').hidden = !ta.value.trim() || hasDod(ta.value); };
    $('#kdDod').onclick = function () { if (hasDod(ta.value)) { ta.focus(); return; } var v = ta.value.replace(/\s+$/, ''); ta.value = (v ? v + '\n' : '') + 'Definition of Done: '; ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); cnt(); };
    ta.oninput = cnt; cnt(); setTimeout(function () { ta.focus(); }, 30);
    $('#kdAi').onclick = function () {
      var b = this; b.disabled = true; $('#kdMsg').innerHTML = '<span class="ask-think">Writing…</span>';
      (S.timer ? saveNow() : (S.q || Promise.resolve())).then(function () {
        return api('planDescribe', { core: S.core, taskId: it.task.id, subId: it.theme ? '' : o.id, name: o.name, current: ta.value });
      }).then(function (r) { ta.value = r.text.slice(0, max); cnt(); $('#kdMsg').textContent = 'Check it and change anything, then Save.'; b.disabled = false; })
        .catch(function (e) { b.disabled = false; $('#kdMsg').textContent = ''; fail(e); });
    };
    $('#kdSave').onclick = function () { o.desc = ta.value.trim().slice(0, max); dirty('description of ' + o.name); M.closeModal(); toast(o.desc ? 'Description saved' : 'Description cleared'); after(); };
  }
  function themePts(t) { return (t.subs || []).length ? t.subs.reduce(function (a, x) { return a + (x.points || 0); }, 0) : (t.points || 0); }
  function kPop(btn, html, wire) {   // a small menu under a button (like the stock picker)
    var old = document.getElementById('kPop'); if (old) { var same = old.getAttribute('data-for') === btn.getAttribute('data-k'); old.remove(); if (same) return; }
    var r = btn.getBoundingClientRect(), m = document.createElement('div'); m.id = 'kPop'; m.className = 'kpop'; m.setAttribute('data-for', btn.getAttribute('data-k') || ''); m.innerHTML = html; document.body.appendChild(m);
    m.style.left = Math.max(8, Math.min(window.innerWidth - m.offsetWidth - 8, r.left)) + 'px';
    m.style.top = (r.bottom + m.offsetHeight + 8 > window.innerHeight ? Math.max(8, r.top - m.offsetHeight - 4) : r.bottom + 4) + 'px';
    var close = function (e) { if (e && (m.contains(e.target) || e.target === btn)) return; m.remove(); document.removeEventListener('pointerdown', close, true); };
    setTimeout(function () { document.addEventListener('pointerdown', close, true); }, 0);
    wire(m, function () { close(); m.remove(); document.removeEventListener('pointerdown', close, true); });
  }
  function ownerPick(btn, cur, set0) {
    var sh = (S.plan.stakeholders || []).filter(function (x) { return x.name || x.role; });
    // v67: a new name typed here goes into the Stakeholder register too (RACI R), so the register stays complete
    var set = function (n) {
      if (n && !sh.some(function (x) { return (x.name || x.role || '').toLowerCase() === n.toLowerCase(); })) {
        var pe = pplNames()[n.toLowerCase()];
        (S.plan.stakeholders = S.plan.stakeholders || []).push({ id: 's' + Date.now().toString(36), name: n, role: pe ? pe.role || '' : '', raci: 'R', phone: pe ? pe.phone || '' : '', email: pe ? pe.email || '' : '', sub: '', person: pe ? pe.id : '' });
        toast(n + ' added to the Stakeholder register' + (pe ? ' (from People, with their contact details)' : ': add their role and contact details on the 👥 Stakeholders tab'));
      }
      set0(n);
    };
    kPop(btn, '<input class="kpop-q" placeholder="Search, or type a name">' + '<div class="kpop-list"></div>' + (cur ? '<button type="button" class="kpop-clear">✕ No owner</button>' : ''), function (m, done) {
      var q = m.querySelector('.kpop-q'), L = m.querySelector('.kpop-list');
      var draw = function () {
        var v = q.value.trim(), lv = v.toLowerCase(), hits = sh.filter(function (x) { return !lv || ((x.name || '') + ' ' + (x.role || '')).toLowerCase().indexOf(lv) >= 0; });
        var known = {}; sh.forEach(function (x) { known[(x.name || x.role || '').toLowerCase()] = 1; });
        var pp = pplAll().filter(function (x) { return !known[x.name.toLowerCase()] && (!lv || (x.name + ' ' + (x.role || '')).toLowerCase().indexOf(lv) >= 0); }).slice(0, 8);
        L.innerHTML = hits.map(function (x) { var n = x.name || x.role; return '<button type="button" data-own="' + esc(n) + '"' + (n === cur ? ' class="on"' : '') + '><span class="kav">' + esc(initials(n)) + '</span><span><b>' + esc(n) + '</b><small>' + esc(x.role || '') + '</small></span></button>'; }).join('') +
          (pp.length ? '<div class="kpop-sep">From People</div>' + pp.map(function (x) { return '<button type="button" data-own="' + esc(x.name) + '" data-pid="' + esc(x.id) + '"><span class="kav pp">' + esc(initials(x.name)) + '</span><span><b>' + esc(x.name) + '</b><small>' + esc(x.role || x.type) + ' · adds them as a stakeholder</small></span></button>'; }).join('') : '') +
          (v && !sh.some(function (x) { return (x.name || x.role || '').toLowerCase() === lv; }) && !pplNames()[lv] ? '<button type="button" data-own="' + esc(v) + '"><span class="kav none">+</span><span><b>Add “' + esc(v) + '”</b><small>also adds them to the Stakeholder register</small></span></button>' : '') +
          (!hits.length && !v ? '<p class="muted" style="margin:6px;font-size:12px">No stakeholders yet: type a name.</p>' : '');
        L.querySelectorAll('[data-own]').forEach(function (b) { b.onclick = function () { set(b.getAttribute('data-own')); done(); }; });
      };
      q.oninput = draw; q.onkeydown = function (e) { if (e.key === 'Enter' && q.value.trim()) { set(q.value.trim()); done(); } if (e.key === 'Escape') done(); }; draw(); setTimeout(function () { q.focus(); }, 0);
      var cl = m.querySelector('.kpop-clear'); if (cl) cl.onclick = function () { set(''); done(); };
    });
  }
  function ptsPick(btn, cur, set) {
    kPop(btn, '<div class="kpop-pts">' + PTS.map(function (n) { return '<button type="button" data-pt="' + n + '"' + (n === cur ? ' class="on"' : '') + '>' + n + '</button>'; }).join('') + '</div>' + (cur ? '<button type="button" class="kpop-clear">✕ No points</button>' : '') + '<small class="muted" style="display:block;margin-top:4px">Story points (Fibonacci): effort and complexity, not hours.</small>', function (m, done) {
      m.querySelectorAll('[data-pt]').forEach(function (b) { b.onclick = function () { set(+b.getAttribute('data-pt')); done(); }; });
      var cl = m.querySelector('.kpop-clear'); if (cl) cl.onclick = function () { set(0); done(); };
    });
  }
  function kCtl(key, own, prio, pts) {   // owner button, H/M/L, points button
    return '<div class="kctl"><button type="button" class="kown' + (own ? '' : ' none') + '" data-k="o:' + key + '" title="Owner: pick from the Stakeholder register or type a name"><span class="kav' + (own ? '' : ' none') + '">' + (own ? esc(initials(own)) : '+') + '</span><span class="kown-n">' + (own ? esc(own) : 'Owner') + '</span></button>' +
      '<span class="kseg" title="Priority">' + PRIO.map(function (x) { return '<button type="button" class="kseg-' + PL[x] + (prio === x ? ' on' : '') + '" data-k="p:' + key + ':' + x + '" title="' + x + ' priority">' + PL[x] + '</button>'; }).join('') + '</span>' +
      '<button type="button" class="kptb' + (pts ? ' on' : '') + '" data-k="n:' + key + '" title="Story points">' + (pts ? pts + ' pts' : 'pts') + '</button></div>';
  }
  /* ---------- 🗒 sticky notes on tasks (Kanban and Gantt): ad hoc remarks the team can read; red urgent, amber semi-urgent, green fine ---------- */
  var STK = { R: ['Urgent', '#DC2626'], A: ['Semi-urgent', '#D97706'], G: ['Fine', '#16A34A'], B: ['All done', '#2563EB'] };
  function stkOpen(t) { return (t.stickies || []).filter(function (n) { return !n.done; }); }
  function stkTop(t) { var o = stkOpen(t); return o.some(function (n) { return n.c === 'R'; }) ? 'R' : o.some(function (n) { return n.c === 'A'; }) ? 'A' : o.length ? 'G' : (t.stickies || []).length ? 'B' : ''; }   // B: every note done (blue, ✓)
  function stkBtn(t, kind) {   // kind: 'row' (schedule table), 'pin' (Gantt bar), 'card' (Kanban)
    var all = t.stickies || [], o = stkOpen(t), c = stkTop(t), last = o[o.length - 1];
    if (kind === 'pin') return all.length ? '<button type="button" class="gstk stk-' + (c || 'X') + '" data-stk="' + esc(t.id) + '" title="' + esc(pl(o.length, 'open note') + (last ? ': ' + last.text.slice(0, 80) : '')) + '">🗒' + (c === 'B' ? '✓' : o.length > 1 ? o.length : '') + '</button>' : '';
    if (kind === 'card') return all.length ? '<button type="button" class="kstk stk-' + (c || 'X') + '" data-stk="' + esc(t.id) + '" title="Open the notes"><b>🗒 ' + (o.length ? (STK[c] || STK.G)[0] : '✓ All done') + '</b><span>' + esc(last ? last.text : all[all.length - 1].text) + '</span>' + (all.length > 1 ? '<i>' + all.length + '</i>' : '') + '</button>'
      : '<button type="button" class="kstk-add" data-stk="' + esc(t.id) + '" title="Add a sticky note for the team">🗒 ＋ note</button>';
    return '<button type="button" class="stkb stk-' + (c || 'X') + (all.length ? '' : ' none') + '" data-stk="' + esc(t.id) + '" title="' + (all.length ? esc(pl(o.length, 'open note') + ' (click to read or add)') : 'Add a sticky note for the team') + '">🗒' + (c === 'B' ? ' ✓' : o.length ? ' ' + o.length : '') + '</button>';
  }
  var STK_LI = /^\s*[-•*]\s+(\[( |x|X)\]\s*)?/;
  function stkBody(x, ro) {   // a note: plain text, or a checklist when lines start with "- "
    var L = String(x.text).split('\n'); if (!L.some(function (l) { return STK_LI.test(l); })) return '<div class="stk-tx" data-sedit title="Double-click to edit">' + esc(x.text).replace(/\n/g, '<br>') + '</div>';
    return '<div class="stk-tx stk-cl" data-sedit>' + L.map(function (l, i) { var m = l.match(STK_LI); if (!m) return l.trim() ? '<div class="stk-p">' + esc(l) + '</div>' : '';
      var on = !!(m[2] && m[2].toLowerCase() === 'x'); return '<label class="stk-li' + (on ? ' on' : '') + '"><input type="checkbox" data-sitem="' + i + '"' + (on ? ' checked' : '') + (ro ? ' disabled' : '') + '><span>' + esc(l.replace(STK_LI, '')) + '</span></label>'; }).join('') + '</div>';
  }
  function stkNl(e) {   // Shift+Enter: a new line in the note (a checklist line carries on with "- "); plain Enter saves
    if (e.key !== 'Enter' || !e.shiftKey) return false; var ta = e.target, v = ta.value, i = ta.selectionStart, ls = v.lastIndexOf('\n', i - 1) + 1, li = v.slice(ls, i);
    if (STK_LI.test(li)) { e.preventDefault(); var ins = '\n- '; ta.value = v.slice(0, i) + ins + v.slice(ta.selectionEnd); ta.selectionStart = ta.selectionEnd = i + ins.length; }
    return true;
  }
  function stkPanel(tid, anchor) {
    var p = S.plan, t = p.tasks.filter(function (x) { return x.id === tid; })[0]; if (!t) return;
    var old = document.getElementById('stkPop'); if (old) old.remove();
    var n = ordered().filter(function (x) { return x.t.id === tid; })[0], me = (M.me && (M.me.name || M.me.user)) || 'Admin', ro = !!(M.me && M.me.scope && (M.me.mods || {}).projects !== 'edit');
    S.stkEdit = null; var first = true, pop = document.createElement('div'); pop.id = 'stkPop'; pop.className = 'stkpop' + (S.stkBig ? ' big' : ''); document.body.appendChild(pop);
    var when = function (ms) { return new Date(ms).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); };
    var draw = function () {
      var L = (t.stickies || []).slice().sort(function (a, b) { return (a.done - b.done) || (b.at - a.at); }), col = S.stkCol || 'G';
      pop.innerHTML = '<div class="stk-h" title="Drag to move the note"><span class="stk-grip">⠿</span><b>🗒 Notes</b><span class="stk-t">#' + (n ? n.n : '') + ' ' + esc(String(t.name).replace(/^[✓◆\s]+/, '')) + '</span><span class="sp"></span><button type="button" class="stk-x" data-sbig title="' + (S.stkBig ? 'Make smaller' : 'Expand') + '">' + (S.stkBig ? '⤡' : '⤢') + '</button><button type="button" class="stk-x" data-sclose title="Close">✕</button></div>' +
        '<div class="stk-list">' + (L.length ? L.map(function (x) {
            var ed = S.stkEdit === x.id && !ro, items = String(x.text).split('\n').filter(function (l) { return STK_LI.test(l); }), ticked = items.filter(function (l) { return /\[(x|X)\]/.test(l.match(STK_LI)[0]); }).length;
            return '<div class="stk-n stk-' + x.c + (x.done ? ' done' : '') + (ed ? ' editing' : '') + '" data-nid="' + esc(x.id) + '"><div class="stk-m">' +
              '<label class="stk-ck" title="' + (x.done ? 'Done: untick to open it again' : 'Tick when it is done') + '"><input type="checkbox" data-sdone' + (x.done ? ' checked' : '') + (ro ? ' disabled' : '') + '></label>' +
              (x.done ? '<span class="stk-tag stk-alldone">✓ All done</span>' : '<span class="stk-tag">' + STK[x.c][0] + '</span>') + (items.length ? '<span class="stk-cnt">' + ticked + '/' + items.length + '</span>' : '') +
              '<small>' + esc(x.by || '') + ' · ' + esc(when(x.at)) + (x.editedAt ? ' · edited' + (x.editedBy && x.editedBy !== x.by ? ' by ' + esc(x.editedBy) : '') : '') + (x.done ? ' · done' + (x.doneBy ? ' by ' + esc(x.doneBy) : '') : '') + '</small><span class="sp"></span>' +
              (ro || ed ? '' : '<button type="button" data-sed title="Edit this note">✏</button><button type="button" data-sdel title="Delete this note">🗑</button>') + '</div>' +
              (ed ? '<div class="stk-ed"><textarea data-setx rows="' + Math.max(3, Math.min(10, String(x.text).split('\n').length + 1)) + '" maxlength="1500">' + esc(x.text) + '</textarea><div class="stk-row">' +
                ['R', 'A', 'G'].map(function (k) { return '<button type="button" class="stk-c stk-' + k + (x.c === k ? ' on' : '') + '" data-secol="' + k + '"><i></i>' + STK[k][0] + '</button>'; }).join('') +
                '<span class="sp"></span><button type="button" class="btn btn-sm" data-secancel>Cancel</button><button type="button" class="btn btn-sm btn-gold" data-sesave>Save</button></div></div>' : stkBody(x, ro)) + '</div>'; }).join('')
          : '<p class="muted" style="margin:6px 2px">No notes yet. Leave a remark for the team: what is happening, what is blocked, what to watch.</p>') + '</div>' +
        (ro ? '' : '<div class="stk-add"><textarea id="stkTx" rows="' + (S.stkBig ? 4 : 2) + '" maxlength="1500" placeholder="Write a note, press Enter to save.  Shift+Enter for a new line; start lines with - for a checklist"></textarea><div class="stk-row">' +
          ['R', 'A', 'G'].map(function (k) { return '<button type="button" class="stk-c stk-' + k + (col === k ? ' on' : '') + '" data-scol="' + k + '" title="' + STK[k][0] + '"><i></i>' + STK[k][0] + '</button>'; }).join('') + '<span class="sp"></span><button type="button" class="btn btn-sm btn-gold" data-sadd>Add note</button></div></div>');
      var place = function () { var r = anchor && document.body.contains(anchor) ? anchor.getBoundingClientRect() : null, w = pop.offsetWidth, h = pop.offsetHeight;
        if (S.stkPos) { pop.style.left = Math.max(4, Math.min(innerWidth - w - 4, S.stkPos.x)) + 'px'; pop.style.top = Math.max(4, Math.min(innerHeight - 40, S.stkPos.y)) + 'px'; return; }   // where it was dragged to
        if (S.stkBig || !r) { pop.style.left = Math.max(10, (innerWidth - w) / 2) + 'px'; pop.style.top = Math.max(10, (innerHeight - h) / 2) + 'px'; return; }
        var x = Math.min(innerWidth - w - 10, Math.max(10, r.left)), y = r.bottom + 6; if (y + h > innerHeight - 10) y = Math.max(10, r.top - h - 6); pop.style.left = x + 'px'; pop.style.top = y + 'px'; };
      place();
      var save = function (what) { dirty('note on #' + (n ? n.n : '') + ': ' + what); var keep = S.stkBig; setTimeout(function () { render(); var a2 = document.querySelector('[data-stk="' + tid + '"]'); anchor = a2 || anchor; S.stkBig = keep; draw(); }, 0); };
      pop.querySelector('[data-sclose]').onclick = function () { pop.remove(); };
      // ✥ drag the note anywhere on the screen by its top bar (mouse or touch); it stays there for the next note
      var hd = pop.querySelector('.stk-h'); hd.onpointerdown = function (e) { if (e.target.closest('button')) return; e.preventDefault(); var r = pop.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top; pop.classList.add('dragging');
        var mv = function (ev) { S.stkPos = { x: ev.clientX - dx, y: ev.clientY - dy }; pop.style.left = Math.max(4, Math.min(innerWidth - pop.offsetWidth - 4, S.stkPos.x)) + 'px'; pop.style.top = Math.max(4, Math.min(innerHeight - 40, S.stkPos.y)) + 'px'; };
        var up = function () { pop.classList.remove('dragging'); document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); };
        document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up); };
      pop.querySelector('[data-sbig]').onclick = function () { S.stkBig = !S.stkBig; S.stkPos = null; pop.classList.toggle('big', S.stkBig); draw(); };
      pop.querySelectorAll('[data-scol]').forEach(function (b) { b.onclick = function () { S.stkCol = b.getAttribute('data-scol'); pop.querySelectorAll('[data-scol]').forEach(function (x) { x.classList.toggle('on', x === b); }); }; });
      var add = pop.querySelector('[data-sadd]'); if (add) add.onclick = function () { var tx = $('#stkTx').value.trim(); if (!tx) { $('#stkTx').focus(); return; }
        t.stickies = (t.stickies || []).concat([{ id: 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), c: S.stkCol || 'G', text: tx, by: me, at: Date.now(), done: false }]); save('added (' + STK[S.stkCol || 'G'][0].toLowerCase() + ')'); };
      var noteOf = function (el) { var id = el.closest('[data-nid]').getAttribute('data-nid'); return (t.stickies || []).filter(function (q) { return q.id === id; })[0]; };
      pop.querySelectorAll('[data-sdone]').forEach(function (b) { b.onchange = function () { var x = noteOf(b); if (!x) return; x.done = b.checked; x.doneBy = x.done ? me : '';
        if (x.done) x.text = String(x.text).split('\n').map(function (l) { return STK_LI.test(l) ? '- [x] ' + l.replace(STK_LI, '') : l; }).join('\n');   // done: every item ticked
        save(x.done ? 'done' : 'opened again'); }; });
      pop.querySelectorAll('[data-sitem]').forEach(function (b) { b.onchange = function () { var x = noteOf(b); if (!x) return; var L = String(x.text).split('\n'), i = +b.getAttribute('data-sitem');
        L = L.map(function (l, k) { return STK_LI.test(l) ? '- [' + (k === i ? (b.checked ? 'x' : ' ') : (/\[(x|X)\]/.test(l.match(STK_LI)[0]) ? 'x' : ' ')) + '] ' + l.replace(STK_LI, '') : l; }); x.text = L.join('\n');
        var its = L.filter(function (l) { return STK_LI.test(l); }), all = its.every(function (l) { return /\[(x|X)\]/.test(l.match(STK_LI)[0]); });
        if (all !== !!x.done) { x.done = all; x.doneBy = all ? me : ''; }   // the note is done when every item is ticked
        save(b.checked ? 'item ticked' : 'item unticked'); }; });
      var edit = function (el) { if (ro) return; var x = noteOf(el); if (!x) return; S.stkEdit = x.id; S.stkEditCol = x.c; draw(); var ta = pop.querySelector('[data-setx]'); if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } };
      pop.querySelectorAll('[data-sed]').forEach(function (b) { b.onclick = function () { edit(b); }; });
      pop.querySelectorAll('[data-sedit]').forEach(function (d) { d.ondblclick = function (e) { if (e.target.tagName !== 'INPUT') edit(d); }; });
      pop.querySelectorAll('[data-secol]').forEach(function (b) { b.onclick = function () { S.stkEditCol = b.getAttribute('data-secol'); pop.querySelectorAll('[data-secol]').forEach(function (q) { q.classList.toggle('on', q === b); }); }; });
      var ec = pop.querySelector('[data-secancel]'); if (ec) ec.onclick = function () { S.stkEdit = null; draw(); };
      var es = pop.querySelector('[data-sesave]'); if (es) { var doSave = function () { var x = noteOf(es), tx = pop.querySelector('[data-setx]').value.trim(); if (!x) return; if (!tx) { pop.querySelector('[data-setx]').focus(); return; }
          var changed = tx !== x.text || (S.stkEditCol && S.stkEditCol !== x.c); S.stkEdit = null; if (!changed) { draw(); return; }
          x.text = tx; if (S.stkEditCol) x.c = S.stkEditCol; x.editedAt = Date.now(); x.editedBy = me; save('edited'); };
        es.onclick = doSave; pop.querySelector('[data-setx]').onkeydown = function (e) { if (stkNl(e)) return; if (e.key === 'Enter') { e.preventDefault(); doSave(); } if (e.key === 'Escape') { e.stopPropagation(); S.stkEdit = null; draw(); } }; }
      pop.querySelectorAll('[data-sdel]').forEach(function (b) { b.onclick = function () { var id = b.closest('[data-nid]').getAttribute('data-nid'); t.stickies = (t.stickies || []).filter(function (q) { return q.id !== id; }); save('deleted'); }; });
      var ta = $('#stkTx'); if (ta) { ta.onkeydown = function (e) { if (stkNl(e)) return; if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); add.onclick(); } }; if (first && !S.stkEdit) setTimeout(function () { ta.focus(); }, 30); } first = false;
    };
    draw();
  }
  if (!window.__champStk) { window.__champStk = true;
    document.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('[data-stk]'); if (b && S.plan) { e.preventDefault(); e.stopPropagation(); stkPanel(b.getAttribute('data-stk'), b); return; }
      var pop = document.getElementById('stkPop'); if (pop && !pop.contains(e.target) && !S.stkBig) pop.remove(); }, true);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { var pop = document.getElementById('stkPop'); if (pop) pop.remove(); } });
    window.addEventListener('hashchange', function () { var pop = document.getElementById('stkPop'); if (pop && !/^#plan\//.test(location.hash)) pop.remove(); });
  }
  function board() {
    var p = S.plan, t0 = today(), F = bfState();
    var owners = []; p.tasks.forEach(function (t) { [ownerOf(t)].concat((t.subs || []).map(function (x) { return x.owner; })).forEach(function (n) { if (n && owners.indexOf(n) < 0) owners.push(n); }); });
    (p.stakeholders || []).forEach(function (x) { var n = x.name || x.role; if (n && owners.indexOf(n) < 0) owners.push(n); });
    var filt = !!(F.owner || F.prio);
    var storyOk = function (x) { if (F.owner && (F.owner === '-' ? x.owner : x.owner !== F.owner)) return false; if (F.prio && (F.prio === '-' ? x.priority : x.priority !== F.prio)) return false; return true; };
    var themeOk = function (t) { if (F.owner && (F.owner === '-' ? ownerOf(t) : ownerOf(t) !== F.owner)) return false; if (F.prio && (F.prio === '-' ? t.priority : t.priority !== F.prio)) return false; return true; };
    var rows = ordered().filter(function (r) {
      var t = r.t; if (F.q && (t.name + ' ' + (t.desc || '') + ' ' + (t.subs || []).map(function (x) { return x.name + ' ' + x.owner + ' ' + (x.desc || ''); }).join(' ') + ' ' + ownerOf(t)).toLowerCase().indexOf(F.q.toLowerCase()) < 0) return false;
      return !filt || ((t.subs || []).length ? t.subs.some(storyOk) : themeOk(t));
    });
    var tprio = function (t) { var ps = (t.subs || []).length ? t.subs.map(function (x) { return x.priority; }) : [t.priority]; for (var i = 0; i < PRIO.length; i++) if (ps.indexOf(PRIO[i]) >= 0) return i; return 9; };
    var sorter = { prio: function (a, b) { return tprio(a.t) - tprio(b.t) || a.n - b.n; }, points: function (a, b) { return themePts(b.t) - themePts(a.t) || a.n - b.n; },
      due: function (a, b) { return (a.t.ef || '9') < (b.t.ef || '9') ? -1 : (a.t.ef || '9') > (b.t.ef || '9') ? 1 : a.n - b.n; } }[F.sort] || function (a, b) { return a.n - b.n; };
    var totP = 0, doneP = 0;
    rows.forEach(function (r) { var t = r.t; if ((t.subs || []).length) t.subs.forEach(function (x) { totP += x.points || 0; if (x.status === 'done') doneP += x.points || 0; }); else { totP += t.points || 0; if (t.status === 'done') doneP += t.points || 0; } });
    var ragN = { g: 0, a: 0, r: 0 }; rows.forEach(function (r) { ragN[kRag(r.t.es, r.t.ef, r.t.pct >= 100, t0).c]++; });
    var opt = function (v, label, cur) { return '<option value="' + esc(v) + '"' + (String(cur) === String(v) ? ' selected' : '') + '>' + esc(label) + '</option>'; };
    var bar = '<div class="kbar"><input type="search" id="kbQ" placeholder="Search themes and stories…" value="' + esc(F.q) + '">' +
      '<label>Owner <select id="kbOwner">' + opt('', 'Everyone', F.owner) + opt('-', 'No owner', F.owner) + owners.map(function (n) { return opt(n, n, F.owner); }).join('') + '</select></label>' +
      '<label>Priority <select id="kbPrio">' + opt('', 'All', F.prio) + PRIO.map(function (x) { return opt(x, x, F.prio); }).join('') + opt('-', 'Not set', F.prio) + '</select></label>' +
      '<label>Sort <select id="kbSort">' + opt('plan', 'Plan order', F.sort) + opt('prio', 'Priority', F.sort) + opt('points', 'Points', F.sort) + opt('due', 'Due date', F.sort) + '</select></label>' +
      '<span class="sp"></span><span class="krag-sum" title="Themes on track / due within 3 days / late"><i class="kd kd-g"></i>' + ragN.g + ' <i class="kd kd-a"></i>' + ragN.a + ' <i class="kd kd-r"></i>' + ragN.r + '</span>' +
      '<span class="kpts" title="Story points done of the points on the board">' + doneP + ' of ' + totP + ' points done' + (totP ? ' (' + Math.round(doneP / totP * 100) + '%)' : '') + '</span></div>';
    $('#planBody').innerHTML = bar + '<div class="kanban">' + STATUS.map(function (c) {
      var list = rows.filter(function (r) { return r.t.status === c[0]; }).sort(sorter), pts = list.reduce(function (a, r) { return a + themePts(r.t); }, 0);
      return '<div class="kcol kcol-' + c[0] + '" data-col="' + c[0] + '"><h3><span>' + c[1] + '</span><span class="kcount">' + pl(list.length, 'theme') + (pts ? ' · ' + pts + ' pts' : '') + '</span><button type="button" class="kaddt" data-kaddt="' + c[0] + '" title="Add a level-1 task (theme) here, with its costing">＋ Task</button></h3><div class="kcards">' + list.map(function (r) {
        var t = r.t, rg = kRag(t.es, t.ef, t.pct >= 100, t0), subs = t.subs || [], tp = themePts(t), sdone = subs.filter(function (x) { return x.status === 'done'; }).length;
        var shown = filt ? subs.filter(storyOk) : subs;
        return '<div class="kcard kr-' + rg.c + '" draggable="true" data-tid="' + esc(t.id) + '">' +
          '<div class="kth"><div class="kth-l"><span class="kid">#' + r.n + (subs.length ? ' · THEME' : t.dur === 0 ? ' · MILESTONE' : '') + '</span><label class="kname"><input type="checkbox" data-tick' + (t.pct >= 100 ? ' checked' : '') + ' title="Done"><span>' + esc(t.name.replace(/^[✓◆\s]+/, '')) + kInfo('t:' + t.id, t.desc) + '</span></label>' +
            ((t.res || []).length ? '<span class="kcrew" title="Crew on this task (from the Schedule): ' + esc(resText(t)) + '">' + esc(resShort(t)) + '</span>' : '') +
            (tp ? '<span class="ktp" title="' + (subs.length ? 'Theme points: the stories added up' : 'Points') + '">' + tp + ' pts</span>' : '') + '</div>' +
            '<div class="kth-r"><div class="kdates">' + esc(pretty(t.es)) + (t.dur > 1 ? ' – ' + esc(pretty(t.ef)) : '') + '</div><div class="kdays">' + (t.dur ? pl(t.dur, 'day') : 'Milestone') + '</div>' + (rg.txt ? '<div class="kdue kdue-' + rg.c + '">' + esc(rg.txt) + '</div>' : '') + '</div></div>' +
          stkBtn(t, 'card') +
          (subs.length ? '<div class="kstories">' + shown.map(function (x) { var d = subDates(t, x), sr = kRag(d.es, d.ef, x.status === 'done', t0);
              return '<div class="kst' + (x.status === 'done' ? ' done' : '') + '" data-sid="' + esc(x.id) + '"><div class="kst-h"><i class="kd kd-' + sr.c + '" title="' + esc(pretty(d.es) + (d.ef !== d.es ? ' – ' + pretty(d.ef) : '') + (sr.txt ? ' · ' + sr.txt : '')) + '"></i><span class="kst-n">' + esc(x.name) + kInfo('s:' + x.id, x.desc) + '</span>' +
                '<span class="kst-d kst-d-' + sr.c + '">' + esc(kShort(d.es, d.ef)) + (sr.txt ? ' <b>(' + esc(sr.txt.charAt(0).toLowerCase() + sr.txt.slice(1)) + ')</b>' : '') + '</span><button type="button" class="kdel-s" data-kdels title="Delete this story" aria-label="Delete story">🗑</button></div>' + kSteps(t, x) + kCtl('s:' + x.id, x.owner, x.priority, x.points) + '</div>'; }).join('') +
            (filt && shown.length < subs.length ? '<div class="kmore">' + (subs.length - shown.length) + ' more ' + (subs.length - shown.length === 1 ? 'story' : 'stories') + ' hidden by the filter</div>' : '') + '</div>'
            : kCtl('t:' + t.id, ownerOf(t), t.priority, t.points)) +
          (t.dur > 0 ? '<div class="kaddrow" data-addrow></div><button type="button" class="kadd" data-kadd>＋ story</button>' : '') +
          '<div class="kfoot"><div class="pbar st-' + t.status + '"><span style="width:' + t.pct + '%"></span></div>' + (subs.length ? '<span class="muted">' + sdone + '/' + subs.length + '</span>' : '<span class="muted">' + t.pct + '%</span>') +
            (c[0] !== 'todo' ? '<button class="btn btn-sm" data-step="-1" title="Back one column">←</button>' : '') + (c[0] !== 'done' ? '<button class="btn btn-sm" data-step="1" title="Next column">→</button>' : '') + '<button type="button" class="btn btn-sm kdel" data-kdel title="Delete this ' + (subs.length ? 'theme and its ' + subs.length + (subs.length === 1 ? ' story' : ' stories') : t.dur === 0 ? 'milestone' : 'task') + '" aria-label="Delete">🗑</button></div></div>';
      }).join('') + (list.length ? '' : '<div class="kempty">' + (rows.length < p.tasks.length ? 'Nothing matches the filter' : 'Drop a theme here') + '</div>') + '</div></div>';
    }).join('') + '</div><p class="muted" style="margin:8px 0 0;font-size:12px">Each card is a theme (a task) with its user stories (sub-tasks). The theme\'s points add up its stories. 🟩 on track · 🟨 due within 3 days · 🟥 past its due date. Drag a card to another column as the work moves on; the Gantt chart follows.</p>';
    var B = $('#planBody'), find = function (id) { return p.tasks.filter(function (t) { return t.id === id; })[0]; };
    var move = function (t, k) { if (!t || t.status === k) return; setStatus(t, k); dirty(stName[k] + ': ' + t.name); render(); };
    B.querySelectorAll('[data-kdel]').forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); taskDelete(find(b.closest('.kcard').getAttribute('data-tid'))); }; });
    B.querySelectorAll('[data-kdels]').forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); var t = find(b.closest('.kcard').getAttribute('data-tid')), id = b.closest('.kst').getAttribute('data-sid'); subDelete(t, t && (t.subs || []).filter(function (x) { return x.id === id; })[0]); }; });
    var keep = function () { var cs = Array.prototype.map.call(B.querySelectorAll('.kcards'), function (k) { return k.scrollTop; }); board(); B.querySelectorAll('.kcards').forEach(function (k, i) { k.scrollTop = cs[i] || 0; }); };
    kFit(); setTimeout(kFit, 80); setTimeout(kFit, 700); if (!S.kFitOn) { S.kFitOn = true; window.addEventListener('resize', function () { if (S.tab === 'board') kFit(); }); }
    $('#kbQ').oninput = function () { F.q = this.value; var pos = this.selectionStart; board(); var q = $('#kbQ'); q.focus(); try { q.setSelectionRange(pos, pos); } catch (e) {} };
    $('#kbOwner').onchange = function () { F.owner = this.value; bfSave(); board(); };
    $('#kbPrio').onchange = function () { F.prio = this.value; bfSave(); board(); };
    $('#kbSort').onchange = function () { F.sort = this.value; bfSave(); board(); };
    B.querySelectorAll('.kcard').forEach(function (c) { c.addEventListener('dragstart', function (e) { e.dataTransfer.setData('text/plain', c.getAttribute('data-tid')); }); });
    B.querySelectorAll('.kcol').forEach(function (col) {
      col.addEventListener('dragover', function (e) { e.preventDefault(); col.classList.add('over'); });
      col.addEventListener('dragleave', function () { col.classList.remove('over'); });
      col.addEventListener('drop', function (e) { e.preventDefault(); col.classList.remove('over'); move(find(e.dataTransfer.getData('text/plain')), col.getAttribute('data-col')); });
    });
    var item = function (key) { var k = key.split(':'), t = k[0] === 't' ? find(k[1]) : null; if (t) return { o: t, theme: true, task: t }; var tt = p.tasks.filter(function (x) { return (x.subs || []).some(function (y) { return y.id === k[1]; }); })[0]; return tt ? { o: tt.subs.filter(function (y) { return y.id === k[1]; })[0], theme: false, task: tt } : null; };
    B.querySelectorAll('[data-ki]').forEach(function (b) { b.onclick = function (e) { e.preventDefault(); e.stopPropagation(); var it = item(b.getAttribute('data-ki')); if (it) kDesc(it, keep); }; });
    B.querySelectorAll('[data-k]').forEach(function (b) {
      var k = b.getAttribute('data-k'), kind = k[0], it = item(k.slice(2).replace(/:(High|Medium|Low)$/, '')); if (!it) return;
      b.onclick = function (e) {
        e.stopPropagation();
        if (kind === 'p') { var v = k.split(':').pop(); it.o.priority = it.o.priority === v ? '' : v; dirty('priority of ' + it.o.name + ': ' + (it.o.priority || 'none')); keep(); return; }
        if (kind === 'n') return ptsPick(b, it.o.points || 0, function (v) { it.o.points = v; dirty('points of ' + it.o.name + ': ' + v); keep(); });
        if (kind === 'o') return ownerPick(b, it.theme ? ownerOf(it.o) : it.o.owner, function (v) {
          if (it.theme) { var sh = (p.stakeholders || []).filter(function (x) { return (x.name || x.role) === v; })[0]; it.o.owner = sh ? sh.id : v; } else it.o.owner = v;
          if (!it.theme) fixRes(it.task);
          dirty('owner of ' + it.o.name + ': ' + (v || 'none')); keep();
        });
      };
    });
    B.querySelectorAll('[data-kaddt]').forEach(function (b) { b.onclick = function () { kAddTask(b.getAttribute('data-kaddt')); }; });
    function kAddTask(col) {   // a level-1 task from the board: name, days and its costing (Qty × Unit $), in this column
      M.modal('<h2>＋ Level-1 task</h2><p class="muted" style="margin:-4px 0 10px">It goes at the end of the schedule, after the last task, in <b>' + esc(stName[col]) + '</b>. Stories (1.1) and steps (1.1.1) are added on the card.</p>' +
        '<form class="form" id="ktF"><label>Task<input name="name" required maxlength="160" placeholder="e.g. Venue booking"></label>' +
        '<div class="row" style="gap:10px;flex-wrap:wrap"><label style="flex:1">Days<input name="dur" type="number" min="1" max="999" value="1"></label><label style="flex:1">Qty<input name="qty" type="number" min="0" step="any" value="0"></label>' +
        '<label style="flex:1">Unit<input name="unit" maxlength="12" placeholder="h, m², lot"></label><label style="flex:1">Unit $<input name="rate" type="number" min="0" step="any" value="0"></label></div>' +
        '<p class="muted" style="font-size:12.5px;margin:6px 0">Cost = Qty × Unit $: <b id="ktC">' + money(0) + '</b>. It counts in the Costing and the budget at completion.</p>' +
        '<div class="actions"><button class="btn" data-close type="button">Cancel</button><button class="btn btn-gold" type="submit">Add the task</button></div></form>');
      var f = $('#ktF'), calc = function () { $('#ktC').textContent = money((Number(f.qty.value) || 0) * (Number(f.rate.value) || 0)); };
      f.qty.oninput = calc; f.rate.oninput = calc; setTimeout(function () { f.name.focus(); }, 30);
      f.onsubmit = function (e) { e.preventDefault(); var last = p.tasks[p.tasks.length - 1];
        var t = { id: 't' + Date.now().toString(36), phase: (last && last.phase) || 'ph1', name: f.name.value.trim() || 'New task', dur: Math.max(1, Math.round(Number(f.dur.value) || 1)), res: [], lead: '', resource: '', qty: Number(f.qty.value) || 0, unit: f.unit.value.trim(), rate: Number(f.rate.value) || 0, actual: 0, pct: 0, status: 'todo', pred: last ? [last.id] : [], snet: '', notes: '' };
        p.tasks.push(t); if (col !== 'todo') setStatus(t, col); M.closeModal(); dirty('Task added: ' + t.name); render(); };
    }
    B.querySelectorAll('[data-kadd]').forEach(function (b) { b.onclick = function () {
      var card = b.closest('.kcard'), t = find(card.getAttribute('data-tid')), row = card.querySelector('[data-addrow]');
      row.innerHTML = '<input class="kadd-in" placeholder="New user story, then Enter" maxlength="160">'; b.style.display = 'none';
      var inp = row.querySelector('input'); inp.focus();
      var once = false, add = function () { if (once) return; once = true; var v = inp.value.trim(); if (!v) { keep(); return; } t.subs = t.subs || []; t.subs.push({ id: 's' + Date.now().toString(36), name: v, owner: '', off: 0, dur: Math.max(1, t.dur), status: 'todo', priority: '', points: 0 }); fitSubs(t); derive(t); dirty('story added to ' + t.name + ': ' + v); keep(); };
      inp.onkeydown = function (e) { if (e.key === 'Enter') add(); if (e.key === 'Escape') keep(); }; inp.onblur = function () { setTimeout(add, 120); };
    }; });
    B.querySelectorAll('[data-step]').forEach(function (b) { b.onclick = function () { var t = find(b.closest('.kcard').getAttribute('data-tid')), i = STATUS.map(function (x) { return x[0]; }).indexOf(t.status) + (+b.getAttribute('data-step')); if (STATUS[i]) move(t, STATUS[i][0]); }; });
    B.querySelectorAll('[data-tick]').forEach(function (cb) { cb.onchange = function () { move(find(cb.closest('.kcard').getAttribute('data-tid')), cb.checked ? 'done' : 'todo'); }; });
    // v85: steps on the story card
    var kst = function (el) { var t = find(el.closest('.kcard').getAttribute('data-tid')), id = el.closest('.kst').getAttribute('data-sid'); return { t: t, sb: t && (t.subs || []).filter(function (x) { return x.id === id; })[0] }; };
    B.querySelectorAll('[data-kstog]').forEach(function (b) { b.onclick = function () { var o = kst(b); S.kStOpen[o.sb.id] = !S.kStOpen[o.sb.id]; keep(); }; });
    B.querySelectorAll('[data-kqdone]').forEach(function (cb) { cb.onchange = function () { var o = kst(cb), q = (o.sb.steps || []).filter(function (x) { return x.id === cb.closest('[data-kq]').getAttribute('data-kq'); })[0]; if (!q) return;
      q.done = cb.checked; derive(o.t); dirty((q.done ? 'Done: ' : 'To do: ') + q.name + ' (' + o.sb.name + ')'); render(); }; });
    B.querySelectorAll('[data-kqdel]').forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); var o = kst(b), q = (o.sb.steps || []).filter(function (x) { return x.id === b.closest('[data-kq]').getAttribute('data-kq'); })[0]; stepDelete(o.t, o.sb, q); }; });
    B.querySelectorAll('[data-kstadd]').forEach(function (b) { b.onclick = function () {
      var o = kst(b), row = b.closest('.kst').querySelector('[data-kstrow]'); if (!row) return;
      row.innerHTML = '<input class="kadd-in" placeholder="New step, then Enter (Esc to stop)" maxlength="160">'; b.style.display = 'none';
      var inp = row.querySelector('input'); inp.focus();
      var once = false, add = function (again) { if (once) return; once = true; var v = inp.value.trim(); if (!v) { keep(); return; }
        o.sb.steps = o.sb.steps || []; var D = Math.max(1, o.sb.dur), last = o.sb.steps[o.sb.steps.length - 1], off = last ? Math.min(D - 1, last.off + last.dur) : 0; if (last && last.off + last.dur >= D) off = last.off;
        o.sb.steps.push({ id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 4), name: v, off: off, dur: 1, done: false }); fitSteps(o.sb); derive(o.t); S.kStOpen[o.sb.id] = true; dirty('step added to ' + o.sb.name); keep();
        if (again) setTimeout(function () { var c = $('#planBody .kst[data-sid="' + o.sb.id + '"] [data-kstadd]'); if (c) c.click(); }, 30); };
      inp.onkeydown = function (e) { if (e.key === 'Enter') add(true); if (e.key === 'Escape') { once = true; keep(); } }; inp.onblur = function () { setTimeout(function () { add(false); }, 120); };
    }; });
    B.querySelectorAll('[data-sp]').forEach(function (r) {
      var show = function () { var v = +r.value; r.style.setProperty('--v', v + '%'); r.parentNode.className = 'kslide kslide-' + v; r.parentNode.querySelector('.kslide-v').textContent = v >= 100 ? 'Done ✓' : v + '%'; };
      r.oninput = show;
      r.onchange = function () {
        var t = find(r.closest('.kcard').getAttribute('data-tid')), sb = t.subs.filter(function (x) { return x.id === r.getAttribute('data-sp'); })[0], v = +r.value;
        sb.pct = v; sb.status = subStatus(v); derive(t); dirty(sb.name + ' ' + v + '% (' + t.name + ')'); render();
      };
    });
  }

  /* ---------- scope (project charter) ---------- */
  /* ---------- scope (project charter): v74 full width, numbered like the charter document, boxes that grow, a sign-off checklist ---------- */
  var CH_F = [['objective', 1500], ['background', 3000], ['inScope', 3000], ['outScope', 2000], ['deliverables', 2000], ['acceptance', 2000], ['assumptions', 2000], ['notes', 3000]];
  function chGrow(el) { el.style.height = 'auto'; el.style.height = Math.max(el.scrollHeight + 2, 64) + 'px'; }
  function chChecks(p) {
    var c = p.charter || {}, has = function (k) { return String(c[k] || '').trim().length > 2; };
    var sk = (p.stakeholders || []).filter(function (x) { return x.name; });
    return [['Project manager named', !!String(c.manager || '').trim()], ['Customer (sponsor) named', !!String(c.customer || '').trim()], ['Objective', has('objective')],
      ['Stakeholders identified (before scope)', sk.length > 0], ['One person Accountable', sk.filter(function (x) { return x.raci === 'A'; }).length === 1], ['In scope', has('inScope')], ['Out of scope', has('outScope')],
      ['Deliverables', has('deliverables')], ['Acceptance criteria', has('acceptance')], ['Assumptions and constraints', has('assumptions')], ['Approved budget', !!c.budget], ['Risks recorded', (p.risks || []).some(function (x) { return x.title && x.status !== 'Closed'; })]];
  }
  function scope() {
    var c = S.plan.charter, p = S.plan, R = rollup(p, today());
    var money0 = function (v) { return v ? '$' + Number(v).toLocaleString('en-AU', { maximumFractionDigits: 2 }) : ''; };
    var lim = {}; CH_F.forEach(function (x) { lim[x[0]] = x[1]; });
    var f = function (k, label, hint, ph, list) { return '<div class="chf"><label class="chf-l" for="ch_' + k + '">' + label + '<span class="chf-c" data-cc="' + k + '"></span></label>' + (hint ? '<div class="chf-h">' + hint + '</div>' : '') +
      '<textarea id="ch_' + k + '" data-c="' + k + '"' + (list ? ' data-list' : '') + ' maxlength="' + lim[k] + '" placeholder="' + esc(ph || '') + '">' + esc(c[k] || '') + '</textarea></div>'; };
    var sec = function (n, title, body, extra, ai) { return '<section class="chs' + (ai && S.chBusy && ai.some(function (k) { return S.chBusy.indexOf(k) >= 0; }) ? ' ch-busy' : '') + '"' + (ai ? ' data-ais="' + ai.join(',') + '"' : '') + '><div class="chs-h"><span class="chs-n">' + n + '</span><h3>' + title + '</h3>' + (extra || '') +
      (ai ? '<button type="button" class="btn btn-sm ch-ai" data-ai="' + ai.join(',') + '" title="Let the AI improve, expand or correct this section, using the plan, the tasks and the customer\'s request">✨ AI</button>' : '') + '</div>' + (ai ? '<div class="ch-ainote" data-ain="' + ai.join(',') + '"></div>' : '') + body + '</section>'; };
    var listHint = 'One item per line. Press Enter for the next “- ” line.', hasBg = !!(S.job.scope || c.background), skN = (p.stakeholders || []).filter(function (x) { return x.name; }).length;
    var main =
      sec(1, 'Project details', '<div class="chg chg-4"><div class="chf"><label class="chf-l" for="ch_name">Plan name</label><input id="ch_name" data-p="name" value="' + esc(p.name) + '"></div>' +
        '<div class="chf"><label class="chf-l" for="ch_customer">Customer (sponsor)</label><input id="ch_customer" data-c="customer" value="' + esc(c.customer) + '" placeholder="Who approves and pays"></div>' +
        '<div class="chf"><label class="chf-l" for="ch_manager">Project manager</label><input id="ch_manager" data-c="manager" list="chPM" value="' + esc(c.manager) + '" placeholder="Who runs the project"><datalist id="chPM">' + pplAll().slice().sort(function (a, b) { var r = function (x) { return /director|manager/i.test(x.role || '') ? 0 : /supervisor|leading/i.test(x.role || '') ? 1 : 2; }; return r(a) - r(b) || (a.name > b.name ? 1 : -1); }).map(function (x) { return '<option value="' + esc(x.name) + '" label="' + esc(x.role || x.type) + '">'; }).join('') + '</datalist></div>' +
        '<div class="chf"><label class="chf-l" for="ch_budget">Approved budget</label><input id="ch_budget" data-c="budget" inputmode="decimal" value="' + esc(money0(c.budget)) + '" placeholder="$0"></div></div>' +
        '<div class="ch-facts"><span>Start <b>' + esc(dmy(R.start) || '–') + '</b></span><span>Finish <b>' + esc(dmy(R.finish) || '–') + '</b></span>' + (p.finishBy ? '<span>Finish by <b>' + esc(dmy(p.finishBy)) + '</b></span>' : '') +
        '<span>Planned cost <b>' + money(R.BAC) + '</b></span>' + (c.budget ? '<span class="' + (R.BAC > c.budget ? 'ch-over' : 'ch-ok') + '">' + (R.BAC > c.budget ? 'Over budget by <b>' + money(R.BAC - c.budget) + '</b>' : 'Contingency <b>' + money(c.budget - R.BAC) + '</b>') + '</span>' : '') +
        '<span class="muted">from the Schedule</span></div>') +
      sec(2, 'Purpose and objective', f('objective', 'Objective: why we are doing this', 'One or two sentences on the outcome the customer wants.', 'e.g. Deliver a Tier IV, 100 MW data centre from feasibility to handover within 12 months'), '', ['objective']) +
      (hasBg ? sec(3, 'Background: the customer\'s request', (S.job.scope ? '<details class="ch-req"' + (c.background ? '' : ' open') + '><summary>The customer\'s request (from the enquiry)</summary><div class="jobreq"><div>' + esc(S.job.scope) + '</div></div></details>' : '') +
        f('background', 'Background for the charter', c.background ? 'This goes into the charter as the background. Clear it to use the customer\'s request as it is.' : 'Empty: the charter uses the customer\'s request as it is. ✨ AI writes a professional background from it.', 'A short background: who, where, what was asked for, key requirements'), (S.job.scope ? '<button type="button" class="btn btn-sm" id="chUseReq" title="Copy the customer\'s request into In scope, to edit">↓ Copy into In scope</button>' : ''), ['background']) : '') +
      chStake(hasBg ? 4 : 3, sec) +
      sec(hasBg ? 5 : 4, 'Scope', (skN ? '' : '<p class="ch-skfirst">↑ Identify the stakeholders first: their needs, approvals and sign-off shape what is in and out of scope.</p>') + '<div class="chg chg-2">' + f('inScope', 'In scope: what we will do', listHint, '- Site works and earthworks\n- …', true) + f('outScope', 'Out of scope: what we will not do', listHint, '- Land purchase and legal costs\n- …', true) + '</div>', '', ['inScope', 'outScope']) +
      sec(hasBg ? 6 : 5, 'Deliverables and acceptance', '<div class="chg chg-2">' + f('deliverables', 'Deliverables: what the customer receives', listHint, '- Certificates, warranties, as-built drawings\n- …', true) + f('acceptance', 'Acceptance criteria: how we know it is done', listHint, '- All systems pass testing\n- Defects list closed\n- …', true) + '</div>', '', ['deliverables', 'acceptance']) +
      sec(hasBg ? 7 : 6, 'Assumptions, constraints and notes', '<div class="chg chg-2">' + f('assumptions', 'Assumptions and constraints', listHint, '- Site access weekdays 7am to 5pm\n- …', true) + f('notes', 'Planning notes and tips (optional in the charter)', listHint, '- Order long-lead items first\n- …', true) + '</div>', '', ['assumptions', 'notes']);
    var checks = chChecks(p), done = checks.filter(function (x) { return x[1]; }).length, pc = Math.round(done / checks.length * 100);
    var side = '<aside class="ch-side"><div class="card ch-card"><div class="ch-doc"><span class="ch-ver">v' + esc(c.docVersion || '1.0') + ' · ' + esc(c.docStatus || 'Draft') + '</span></div>' +
      '<button class="btn btn-gold ch-big" id="chDoc" type="button" title="The project charter as a professional PDF or Word document, with the Gantt chart, critical path, stakeholder register and a sign-off block">📄 Charter: PDF / Word</button>' +
      '<button class="btn ch-big ch-aiall" type="button" data-ai="all" title="Let the AI go through sections 2 to 6 in one go: structure, grammar and the missing pieces">✨ Improve the whole charter with AI</button>' +
      '<div class="ch-ready"><div class="row" style="justify-content:space-between"><b>Ready to sign off</b><b>' + pc + '%</b></div><div class="ch-bar"><span style="width:' + pc + '%" class="' + (pc >= 100 ? 'ok' : pc >= 70 ? 'mid' : 'low') + '"></span></div></div>' +
      '<ul class="ch-list">' + checks.map(function (x) { return '<li class="' + (x[1] ? 'ok' : '') + '">' + (x[1] ? '✓' : '○') + ' ' + esc(x[0]) + '</li>'; }).join('') + '</ul>' +
      '<p class="muted" style="font-size:12px;margin:8px 0 0">Stakeholders and risks come from their own tabs. Everything saves as you type.</p></div></aside>';
    $('#planBody').innerHTML = '<div class="ch-wrap"><div class="ch-main"><div class="ch-top"><div><h2>Project charter (scope)</h2><p class="muted">What is (and isn\'t) being delivered. Agree it with the customer before work starts, then have it signed off. The numbers match the charter document.</p></div></div>' + main + '</div>' + side + '</div>';
    var B = $('#planBody');
    var count = function (el) { var k = el.getAttribute('data-c'), m = lim[k], n = el.value.length, cc = B.querySelector('[data-cc="' + k + '"]'); if (cc) { cc.textContent = n > m * 0.8 ? n + ' / ' + m : ''; cc.className = 'chf-c' + (n >= m ? ' full' : ''); } };
    var refreshSide = function () { var ch = chChecks(p), d = ch.filter(function (x) { return x[1]; }).length, q = Math.round(d / ch.length * 100), side2 = B.querySelector('.ch-side');
      if (!side2) return; side2.querySelector('.ch-ready b:last-child').textContent = q + '%'; var bar = side2.querySelector('.ch-bar span'); bar.style.width = q + '%'; bar.className = q >= 100 ? 'ok' : q >= 70 ? 'mid' : 'low';
      side2.querySelector('.ch-list').innerHTML = ch.map(function (x) { return '<li class="' + (x[1] ? 'ok' : '') + '">' + (x[1] ? '✓' : '○') + ' ' + esc(x[0]) + '</li>'; }).join(''); };
    B.querySelectorAll('textarea[data-c]').forEach(function (el) {
      chGrow(el); count(el);
      el.addEventListener('input', function () { c[el.getAttribute('data-c')] = el.value; chGrow(el); count(el); dirty(); refreshSide(); });
      if (el.hasAttribute('data-list')) el.addEventListener('keydown', function (e) {   // lists: Enter starts the next "- " line
        if (e.key !== 'Enter' || e.shiftKey) return;
        var v = el.value, at = el.selectionStart, ls = v.lastIndexOf('\n', at - 1) + 1, line = v.slice(ls, at);
        if (!/^\s*[-•]\s/.test(line) && v.trim()) return;
        e.preventDefault();
        if (/^\s*[-•]\s*$/.test(line)) { el.value = v.slice(0, ls) + v.slice(at); el.selectionStart = el.selectionEnd = ls; }   // an empty "- " line: end the list
        else { var ins = '\n- '; if (!v.trim()) ins = '- '; el.value = v.slice(0, at) + ins + v.slice(el.selectionEnd); el.selectionStart = el.selectionEnd = at + ins.length; }
        el.dispatchEvent(new Event('input'));
      });
    });
    B.querySelectorAll('input[data-c]').forEach(function (el) {
      var k = el.getAttribute('data-c');
      el.addEventListener('input', function () { c[k] = k === 'budget' ? r2(String(el.value).replace(/[$,\s]/g, '')) : el.value; dirty(); refreshSide(); });
      if (k === 'budget') el.addEventListener('blur', function () { el.value = money0(c.budget); });   // typed as 45000, $45,000 or 45,000
    });
    B.querySelector('[data-p=name]').oninput = function () { p.name = this.value; dirty(); };
    var ur = $('#chUseReq'); if (ur) ur.onclick = function () { var t = $('#ch_inScope'); var lines = String(S.job.scope).split(/\n+/).map(function (x) { return x.trim(); }).filter(Boolean).map(function (x) { return /^[-•]/.test(x) ? x : '- ' + x; });
      t.value = (t.value.trim() ? t.value.replace(/\s+$/, '') + '\n' : '') + lines.join('\n'); t.dispatchEvent(new Event('input')); t.focus(); toast('Copied into In scope: trim it to what you will deliver'); };
    $('#chDoc').onclick = charterDialog;
    chStakeWire(B);
    B.querySelectorAll('[data-ai]').forEach(function (b) { b.onclick = function (e) { e.stopPropagation();
      var keys = b.getAttribute('data-ai') === 'all' ? CH_F.map(function (x) { return x[0]; }).filter(function (k) { return k !== 'background' || hasBg; }) : b.getAttribute('data-ai').split(',');
      chAiPop(keys, b); }; });
    if (S.chBusy) chAiBusy(true);
    chAiNotes();
  }

  /* ---------- v76: ✨ AI for the charter (sections 2 to 6): improve, expand or correct, with undo ---------- */
  /* ---------- v79: stakeholders are identified before the scope (PMBOK: Identify Stakeholders comes first, in initiating) ---------- */
  var SK_ROLE = [['Customer', 'A'], ['Project manager', 'R'], ['Site supervisor', 'R'], ['Certifier', 'C'], ['Council', 'C'], ['Engineer', 'C'], ['Architect', 'C'], ['Strata manager', 'C'], ['Utility provider', 'C'], ['Neighbours', 'I'], ['Tenants', 'I'], ['Supplier', 'I'], ['Insurer', 'I']];
  var SK_RISK = ['miss requirements and acceptance criteria that matter to the people who sign off',
    'face late changes, rework and scope creep when someone is brought in after the scope is set',
    'have no clear sign-off (nobody Accountable), so approvals and payments stall',
    'meet objections or conflict from people who were never consulted (neighbours, strata, council, tenants)',
    'miss approvals, inspections or compliance obligations owned by authorities and certifiers',
    'overrun on time and cost, with no one agreed to decide on changes'];
  function chStake(n, sec) {
    var p = S.plan, L = (p.stakeholders || []).filter(function (x) { return x.name; }), nA = L.filter(function (x) { return x.raci === 'A'; }).length;
    var have = function (role) { return L.some(function (x) { return String(x.role || '').toLowerCase() === role.toLowerCase() || String(x.name || '').toLowerCase() === role.toLowerCase(); }); };
    var cust = S.job && S.job.name && L.some(function (x) { return x.name.toLowerCase() === String(S.job.name).toLowerCase() || /customer|owner|client|sponsor/i.test(x.role || ''); });
    var chips = SK_ROLE.filter(function (r) { return !have(r[0]) && !(r[0] === 'Customer' && cust); }).map(function (r) { return '<button type="button" class="ch-skchip" data-skrole="' + esc(r[0]) + '" data-skraci="' + r[1] + '">＋ ' + esc(r[0]) + '</button>'; }).join('');
    var body = !L.length
      ? '<div class="ch-skwarn"><b>⚠ No stakeholders identified yet. Do this before you write the scope.</b> Without identifying stakeholders, the project could:<ul>' + SK_RISK.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>'
      : '<div class="ch-skl">' + L.map(function (x) { return '<span class="ch-sk"><span class="raci raci-' + esc(x.raci) + '">' + esc(x.raci) + '</span><b>' + esc(x.name) + '</b>' + (x.role ? '<small>' + esc(x.role) + '</small>' : '') + '</span>'; }).join('') + '</div>' +
        (nA !== 1 ? '<p class="ch-skmsg">⚠ ' + (nA ? nA + ' people are Accountable: usually one person signs off, so decisions do not stall.' : 'Nobody is Accountable yet: name the one person who signs off and has the final say.') + '</p>' : '') +
        (!cust ? '<p class="ch-skmsg">⚠ The customer is not on the list yet.</p>' : '');
    var add = '<div class="ch-skadd"><input id="chSkName" maxlength="120" placeholder="Name or organisation"><input id="chSkRole" maxlength="120" placeholder="Role, e.g. Certifier" list="chSkRoles">' +
      '<select id="chSkRaci">' + Object.keys(RACI).map(function (k) { return '<option value="' + k + '"' + (k === 'C' ? ' selected' : '') + '>' + k + ' – ' + RACI[k][0] + '</option>'; }).join('') + '</select><button type="button" class="btn btn-sm btn-gold" id="chSkAdd">＋ Add</button></div>' +
      '<datalist id="chSkRoles">' + SK_ROLE.map(function (r) { return '<option value="' + esc(r[0]) + '">'; }).join('') + '</datalist>';
    return sec(n, 'Stakeholders: identify them before the scope', '<p class="chf-h" style="margin:0 0 8px">Best practice: list everyone who affects or is affected by the project, and what they do (RACI), before you agree the scope. Their needs become the scope and acceptance criteria.</p>' +
      body + (chips ? '<div class="ch-skchips"><span class="muted">Commonly involved:</span>' + (S.job && S.job.name && !cust ? '<button type="button" class="ch-skchip" data-skcust>＋ The customer (' + esc(S.job.name) + ')</button>' : '') + chips + '</div>' : '') + add,
      '<span class="ch-key" title="PMBOK: Identify Stakeholders is done at the start, before Collect Requirements and Define Scope">Key step</span><span class="ch-skn' + (L.length ? '' : ' none') + '">' + (L.length ? pl(L.length, 'stakeholder') : 'none yet') + '</span><a class="btn btn-sm" href="#plan/' + esc(S.core) + '/stake">👥 Open the register</a>');
  }
  function chStakeWire(B) {
    var p = S.plan; p.stakeholders = p.stakeholders || [];
    var add = function (x) { p.stakeholders.push(Object.assign({ id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: '', role: '', raci: 'I', phone: '', email: '' }, x)); dirty('Stakeholder added: ' + x.name); var y = window.scrollY; scope(); window.scrollTo(0, y); };
    B.querySelectorAll('[data-skrole]').forEach(function (b) { b.onclick = function () { var r = b.getAttribute('data-skrole'); add({ name: r, role: r, raci: b.getAttribute('data-skraci') }); toast('Added ' + r + ': put in the name and contact on the Stakeholders tab'); }; });
    var c = B.querySelector('[data-skcust]'); if (c) c.onclick = function () { add({ name: S.job.name || 'Customer', role: 'Customer', raci: 'A', phone: S.job.phone || '', email: S.job.email || '' }); };
    var go = function () { var n = $('#chSkName').value.trim(); if (!n) { $('#chSkName').focus(); return toast('Type a name first', true); } add({ name: n, role: $('#chSkRole').value.trim(), raci: $('#chSkRaci').value }); var i = $('#chSkName'); if (i) i.focus(); };
    var b = $('#chSkAdd'); if (b) { b.onclick = go; ['#chSkName', '#chSkRole'].forEach(function (k) { $(k).onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); go(); } }; }); }
  }
  var CH_LBL = { objective: 'Objective', background: 'Background', inScope: 'In scope', outScope: 'Out of scope', deliverables: 'Deliverables', acceptance: 'Acceptance criteria', assumptions: 'Assumptions and constraints', notes: 'Planning notes' };
  function chAiPopClose() { var o = document.getElementById('chPop'); if (o) o.remove(); document.removeEventListener('mousedown', chAiPopOut, true); document.removeEventListener('keydown', chAiPopKey, true); }
  function chAiPopOut(e) { var o = document.getElementById('chPop'); if (o && !o.contains(e.target)) chAiPopClose(); }
  function chAiPopKey(e) { if (e.key === 'Escape') { e.stopPropagation(); chAiPopClose(); } }
  function chAiPop(keys, btn) {
    chAiPopClose();
    if (S.chBusy) return toast('The AI is still writing. One moment.');
    var c = S.plan.charter, empty = keys.every(function (k) { return !String(c[k] || '').trim(); });
    var opt = function (v, t, d, on) { return '<label class="ch-mode"><input type="radio" name="chm" value="' + v + '"' + (on ? ' checked' : '') + '><span><b>' + t + '</b><small>' + d + '</small></span></label>'; };
    var o = document.createElement('div'); o.id = 'chPop'; o.className = 'ch-pop';
    o.innerHTML = '<div class="ch-pop-h">✨ AI: ' + esc(keys.length > 3 ? 'the whole charter (sections 2 to ' + (keys.indexOf('background') >= 0 ? 6 : 5) + ')' : keys.map(function (k) { return CH_LBL[k]; }).join(' and ')) + '</div>' +
      (empty ? '<p class="muted" style="margin:0 0 8px;font-size:12.5px">Empty now: the AI writes it from the plan, the tasks and the customer\'s request.</p>' : '') +
      opt('improve', empty ? 'Write it' : 'Improve', 'Fix the structure and grammar, tidy pasted text, fill the gaps', true) +
      opt('expand', 'Expand', 'Add the detail a professional charter would have') +
      (empty ? '' : opt('grammar', 'Correct only', 'Spelling, grammar and punctuation; nothing added or removed')) +
      '<input class="ch-note" id="chNote" maxlength="300" placeholder="Anything to tell the AI? (optional) e.g. mention the substation">' +
      '<div class="ch-pop-b"><button type="button" class="btn btn-sm" data-x>Cancel</button><button type="button" class="btn btn-gold btn-sm" id="chGo">✨ Go</button></div>' +
      '<p class="muted" style="margin:6px 0 0;font-size:11.5px">You can undo it afterwards.</p>';
    document.body.appendChild(o);
    var r = btn.getBoundingClientRect(), w = o.offsetWidth, top = r.bottom + 6;
    if (top + o.offsetHeight > innerHeight - 8) top = Math.max(8, r.top - o.offsetHeight - 6);
    o.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + 'px'; o.style.top = top + 'px';
    o.querySelector('[data-x]').onclick = chAiPopClose;
    var go = function () { var how = (o.querySelector('input[name=chm]:checked') || {}).value || 'improve', note = $('#chNote').value.trim(); chAiPopClose(); chAiRun(keys, how, note); };
    $('#chGo').onclick = go; $('#chNote').onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); go(); } };
    document.addEventListener('mousedown', chAiPopOut, true); document.addEventListener('keydown', chAiPopKey, true);
  }
  function chAiBusy(on) {
    var B = $('#planBody'); if (!B || S.tab !== 'scope') return;
    B.querySelectorAll('[data-ais]').forEach(function (sec) { var ks = sec.getAttribute('data-ais').split(','), hit = on && S.chBusy && ks.some(function (k) { return S.chBusy.indexOf(k) >= 0; });
      sec.classList.toggle('ch-busy', !!hit); var b = sec.querySelector('.ch-ai'); if (b) { b.disabled = !!on; b.textContent = hit ? '✨ Writing…' : '✨ AI'; }
      ks.forEach(function (k) { var t = $('#ch_' + k); if (t) t.readOnly = !!hit; }); });
    var all = B.querySelector('.ch-aiall'); if (all) { all.disabled = !!on; all.textContent = on ? '✨ The AI is writing…' : '✨ Improve the whole charter with AI'; }
  }
  function chAiNotes() {
    var B = $('#planBody'); if (!B || S.tab !== 'scope') return;
    B.querySelectorAll('[data-ain]').forEach(function (n) {
      var u = S.chUndo, ks = n.getAttribute('data-ain').split(','), hit = u && u.core === S.core && ks.some(function (k) { return k in u.prev; });
      n.innerHTML = hit ? '<span>✨ ' + esc(u.what) + (u.changes ? ': ' + esc(u.changes) : '') + '</span><button type="button" class="btn btn-sm ch-undo">↶ Undo</button><button type="button" class="ch-keep" title="Keep it">✓ Keep</button>' : '';
      n.classList.toggle('on', !!hit);
      if (hit) { n.querySelector('.ch-undo').onclick = chAiUndo; n.querySelector(".ch-keep").onclick = function () { S.chUndo = null; chAiNotes(); }; }
    });
  }
  function chAiSet(k, v, flash) {
    S.plan.charter[k] = v; var t = $('#ch_' + k);
    if (t && S.tab === 'scope') { t.value = v; chGrow(t); if (flash) { t.classList.remove('ch-flash'); void t.offsetWidth; t.classList.add('ch-flash'); } }
  }
  function chAiUndo() {
    var u = S.chUndo; if (!u || u.core !== S.core) return;
    Object.keys(u.prev).forEach(function (k) { chAiSet(k, u.prev[k], false); });
    S.chUndo = null; dirty(); if (S.tab === 'scope') scope(); toast('Undone: back to what you had');
  }
  function chAiRun(keys, how, note) {
    var c = S.plan.charter, core = S.core, id = rid(), t0 = Date.now(), texts = {};
    CH_F.forEach(function (x) { texts[x[0]] = String(c[x[0]] || ''); });
    S.chBusy = keys.slice(); S.chAiId = id; chAiBusy(true);
    var end = function () { if (S.chAiId !== id) return false; S.chBusy = null; S.chAiId = null; chAiBusy(false); return true; };
    var poll = function () {
      return new Promise(function (res) { setTimeout(res, 2000); }).then(function () { return api('planAiStatus', { id: id }); }).then(function (d) {
        if (S.chAiId !== id) return;
        if (d.status === 'done' && d.charter) {
          if (!end()) return;
          if (S.core !== core) return toast('The AI finished, but you have moved to another project', true);
          var f = d.charter.fields, prev = {}, n = 0;
          Object.keys(f).forEach(function (k) { if (keys.indexOf(k) < 0) return; prev[k] = String(c[k] || ''); if (prev[k] !== f[k]) n++; chAiSet(k, f[k], true); });
          if (!n) { toast('The AI found nothing to change'); return; }
          S.chUndo = { core: core, prev: prev, changes: d.charter.changes || '', what: how === 'grammar' ? 'Corrected by AI' : how === 'expand' ? 'Expanded by AI' : 'Improved by AI' };
          dirty(); if (S.tab === 'scope') scope();
          var first = $('#ch_' + keys[0]); if (first && keys.length < 3) first.closest('.chs').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          toast('✨ ' + S.chUndo.what + ': check it, or ↶ Undo'); return;
        }
        if (d.status === 'error') throw new Error(d.error || 'The AI could not write it');
        if (Date.now() - t0 > 170000) throw new Error('The AI is taking too long. Try again in a minute.');
        return poll();
      });
    };
    fetch('/.netlify/functions/planai-background', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-MBS-Admin': '1', 'X-Champ-Lang': (window.ChampI18n && window.ChampI18n.get()) || 'en' },
      body: JSON.stringify({ id: id, mode: 'charter', core: core, fields: keys, how: how, note: note, texts: texts }) })
      .then(function (r) { if (r.status === 401 || r.status === 403) throw new Error('Your session has ended. Sign in again.'); if (r.status >= 400) throw new Error('Could not start the AI (' + r.status + ')'); return poll(); })
      .catch(function (e) { if (end()) fail(e); });
  }

  /* ---------- v73: 📄 the project charter as a document (PDF / Word): sign-off ready ---------- */
  var CH_OPT = [['background', 'Background: the customer\'s request', true], ['milestones', 'Key milestones', true], ['gantt', 'Summary Gantt chart', true], ['critical', 'Critical path', true],
    ['stake', 'Stakeholder register', true], ['contacts', '… with phone numbers and emails', true], ['racimap', 'RACI map (activities × people)', true], ['risks', 'Key risks', true], ['issues', 'Open issues', false], ['budget', 'Budget ($ figures)', true],
    ['governance', 'Governance and change control', true], ['notes', 'Planning notes', false]];
  function chOpts() { var o = {}; try { o = JSON.parse(localStorage.getItem('mbsCharterOpt') || '{}') || {}; } catch (e) {} CH_OPT.forEach(function (x) { if (typeof o[x[0]] !== 'boolean') o[x[0]] = x[2]; }); return o; }
  function charterSnapshot(o) {
    var p = S.plan, c = p.charter || {}, t0 = today(), R = rollup(p, t0), C = cpm(p), all = !!(p.emergency || p.weekends); R = rollup(p, t0);
    var crit = {}; Object.keys(C.tasks).forEach(function (id) { if (C.tasks[id].float === 0) crit[id] = 1; });
    var rows = ordered(), v = c.docVersion || '1.0', st = c.docStatus || 'Draft', unit = all ? 'day' : 'working day';
    var clean = function (n) { return String(n || '').replace(/^[✓◆\s]+/, ''); };
    var dur = R.start && R.finish ? (all ? Math.round((Date.parse(R.finish) - Date.parse(R.start)) / 864e5) + 1 : workBetween(R.start, R.finish)) : 0;
    var glance = [['Project', p.name], ['Job reference', S.job.ref || ''], ['Customer (sponsor)', c.customer || S.job.name || ''], ['Location', S.job.suburb || ''], ['Project manager', c.manager || 'To be confirmed'],
      ['Planned start', dmy(R.start)], ['Planned finish', dmy(R.finish) + (p.finishBy ? '  (finish by ' + dmy(p.finishBy) + ')' : '')], ['Duration', pl(dur, unit) + (all ? ' (weekends worked)' : ' (Monday to Friday)')],
      ['Scope', pl(rows.filter(function (x) { return x.t.dur > 0; }).length, 'task') + ', ' + pl(rows.filter(function (x) { return x.t.dur === 0; }).length, 'milestone')], ['Document', 'Version ' + v + ' · ' + st + ' · issued ' + dmy(t0)]];
    var S2 = [{ kind: 'kv', title: '1. Project at a glance', rows: glance },
      { kind: 'text', title: '2. Purpose and objective', text: c.objective, always: true, empty: 'Not stated yet.' }];
    var n = 3, H = function (t) { return (n++) + '. ' + t; };
    if (o.background && (c.background || S.job.scope)) S2.push({ kind: 'text', title: H(c.background ? 'Background' : 'Background: the customer\'s request'), text: c.background || S.job.scope });
    // v79: stakeholders are identified before the scope (PMBOK), so the register comes first
    if (o.stake) {
      var sh = (p.stakeholders || []).filter(function (x) { return x.name || x.role; });
      S2.push({ kind: 'table', title: H('Stakeholder register'), head: o.contacts ? ['Name', 'Role', 'RACI', 'Phone', 'Email'] : ['Name', 'Role', 'RACI'], wordCols: o.contacts ? [3, 3, 1, 2, 4] : [4, 5, 1],
        cols: o.contacts ? { 2: { cellWidth: 13, halign: 'center' }, 3: { cellWidth: 28 } } : { 2: { cellWidth: 16, halign: 'center' } },
        rows: sh.map(function (x) { var r = [{ t: x.name || '', b: true }, x.role || '', x.raci || '']; if (o.contacts) r.push(x.phone || '', x.email || ''); return r; }), always: true, empty: 'No stakeholders identified yet: identify them before the scope is agreed.' },
        { kind: 'text', text: 'RACI: R = Responsible (does the work) · A = Accountable (approves) · C = Consulted · I = Informed.', title: '' });
    }
    S2.push({ kind: 'text', title: H('In scope'), text: c.inScope, always: true, empty: 'Not stated yet.' }, { kind: 'text', title: H('Out of scope'), text: c.outScope, always: true, empty: 'Nothing excluded yet: state what is not included.' },
      { kind: 'text', title: H('Deliverables'), text: c.deliverables, always: true, empty: 'Not stated yet.' }, { kind: 'text', title: H('Acceptance criteria'), text: c.acceptance, always: true, empty: 'Not stated yet.' },
      { kind: 'text', title: H('Assumptions and constraints'), text: c.assumptions, always: true, empty: 'None stated.' });
    if (o.milestones) S2.push({ kind: 'table', title: H('Key milestones'), head: ['#', 'Milestone', 'Date', 'Status'], wordCols: [1, 7, 2, 2], cols: { 0: { cellWidth: 10 }, 2: { cellWidth: 26 }, 3: { cellWidth: 24 } },
      rows: rows.filter(function (x) { return x.t.dur === 0; }).map(function (x) { var late = x.t.pct < 100 && x.t.ef < t0; return [String(x.n), clean(x.t.name), dmy(x.t.es), { t: x.t.pct >= 100 ? 'Done' : late ? 'Late' : 'Planned', rag: x.t.pct >= 100 ? 'G' : late ? 'R' : undefined }]; }), always: true, empty: 'No milestones in the plan.' });
    if (o.gantt) S2.push({ kind: 'gantt', title: H('Summary schedule (Gantt chart)') });
    if (o.critical) {
      var cr = rows.filter(function (x) { return crit[x.t.id] && x.t.es; }).sort(function (a, b) { return a.t.es < b.t.es ? -1 : a.t.es > b.t.es ? 1 : a.n - b.n; });
      S2.push({ kind: 'text', title: H('Critical path'), text: 'These ' + pl(cr.length, 'task') + ' set the finish date of ' + dmy(R.finish) + ': any delay to one of them delays completion. Tasks off the critical path have slack (float).' },
        { kind: 'table', head: ['#', 'Task', 'Start', 'Finish', 'Duration'], wordCols: [1, 7, 2, 2, 2], cols: { 0: { cellWidth: 10 }, 2: { cellWidth: 24 }, 3: { cellWidth: 24 }, 4: { cellWidth: 24 } },
          rows: cr.map(function (x) { return [String(x.n), { t: clean(x.t.name), b: true }, dmy(x.t.es), dmy(x.t.ef), x.t.dur ? pl(x.t.dur, unit) : 'Milestone']; }), always: true, empty: 'No critical path yet (add task links).' });
    }
    if (o.racimap) {   // v75: the RACI map: activities × people
      var ppl = raciPeople(p).filter(function (sh) { return raciActs(p).some(function (x) { return raciCell(p, x.t, sh).v; }); }).slice(0, 14), used = {};
      var ini = ppl.map(function (sh) { var w = String(sh.name || sh.role).replace(/\(.*?\)/g, '').split(/[\s/]+/).filter(Boolean), k = (w.length > 1 ? w[0][0] + w[1][0] : (w[0] || '?').slice(0, 2)).toUpperCase(), k2 = k, i = 2; while (used[k2]) k2 = k + i++; used[k2] = 1; return k2; });
      var FILL = { R: { fill: [219, 234, 254], hex: 'DBEAFE' }, A: { fill: [253, 230, 138], hex: 'FDE68A' }, C: { fill: [220, 252, 231], hex: 'DCFCE7' }, I: { fill: [241, 238, 230], hex: 'F1EEE6' } };
      if (ppl.length) {
        var wc = [6].concat(ppl.map(function () { return 1; })), cols = { 0: { cellWidth: Math.max(48, 182 - ppl.length * 10.5) } }; ppl.forEach(function (x, i) { cols[i + 1] = { halign: 'center', cellWidth: Math.min(14, (182 - 48) / ppl.length) }; });
        S2.push({ kind: 'table', title: H('RACI map'), head: ['Activity'].concat(ini), wordCols: wc, cols: cols,
          rows: raciActs(p).map(function (x) { return [('#' + x.n + ' ' + clean(x.t.name))].concat(ppl.map(function (sh) { var v = raciCell(p, x.t, sh).v; return v ? { t: v, fill: FILL[v].fill, hex: FILL[v].hex, b: true, center: true } : ''; })); }) },
          { kind: 'text', title: '', text: 'Key: ' + ppl.map(function (sh, i) { return ini[i] + ' = ' + (sh.name || sh.role) + (sh.role && sh.name ? ' (' + sh.role + ')' : ''); }).join(' · ') + '. Each activity has one A (accountable) and at least one R (responsible).' });
      }
    }
    if (o.risks) { var rk = (p.risks || []).filter(function (x) { return x.status !== 'Closed' && x.title; }).sort(function (a, b) { return b.p * b.i - a.p * a.i; });
      S2.push({ kind: 'table', title: H('Key risks'), head: ['Risk', 'Score', 'Response and action', 'Owner'], wordCols: [4, 1, 5, 2], cols: { 1: { cellWidth: 14, halign: 'center' }, 3: { cellWidth: 28 } },
        rows: rk.slice(0, 12).map(function (x) { var sc = x.p * x.i; return [x.title, { t: String(sc), rag: sc >= 15 ? 'R' : sc >= 12 ? 'A' : 'G' }, x.response + (x.action ? ': ' + x.action : ''), x.owner || '']; }), always: true, empty: 'No open risks recorded.' }); }
    if (o.issues) { var is = (p.issues || []).filter(function (x) { return x.status !== 'Resolved' && x.title; });
      S2.push({ kind: 'table', title: H('Open issues'), head: ['Issue', 'Priority', 'Owner', 'Due'], wordCols: [6, 2, 3, 2], cols: { 1: { cellWidth: 20 }, 3: { cellWidth: 24 } },
        rows: is.map(function (x) { return [x.title, { t: x.priority, rag: x.priority === 'Critical' ? 'R' : x.priority === 'High' ? 'A' : undefined }, x.owner || '', dmy(x.due)]; }), always: true, empty: 'No open issues.' }); }
    if (o.budget) S2.push({ kind: 'kv', title: H('Budget'), rows: [['Approved budget', c.budget ? money(c.budget) : 'Not set'], ['Planned cost (BAC)', money(R.BAC) + (estOf(p).n ? '  (includes ' + money(estOf(p).sum) + ' of indicative benchmark costs on ' + pl(estOf(p).n, 'task') + ', not yet reviewed)' : '')]]
      .concat(c.budget ? [['Contingency (budget less planned cost)', money(Math.round((c.budget - R.BAC) * 100) / 100)]] : []).concat(R.AC ? [['Spent to date', money(R.AC)]] : []) });
    if (o.notes && c.notes) S2.push({ kind: 'text', title: H('Planning notes'), text: c.notes });
    if (o.governance) S2.push({ kind: 'text', title: H('Governance and change control'), text: '- The project manager runs the project day to day and reports progress to the customer (sponsor) and stakeholders.\n- Any change to scope, time, cost, quality, risks or stakeholders is raised as a change request in change control: its impact is assessed, it is reviewed (at a change control meeting where needed) and it is approved and signed by the project manager or project director (and agreed with the customer where it changes the contract) before it is added to the plan and registers.\n- Risks and issues are reviewed at every progress meeting and recorded in the project registers.\n- The work is accepted when the acceptance criteria above are met and the customer signs off.' });
    var signers = [{ role: 'Customer (sponsor)', name: c.customer || S.job.name || '' }, { role: 'Project manager', name: c.manager || '' }, { role: 'Project sponsor', name: '' }];
    (p.stakeholders || []).filter(function (x) { return x.raci === 'A' && x.name && !signers.some(function (y) { return y.name && y.name.toLowerCase() === x.name.toLowerCase(); }); }).slice(0, 3).forEach(function (x) { signers.push({ role: x.role || 'Accountable stakeholder', name: x.name }); });
    S2.push({ kind: 'sign', title: H('Approval and sign-off'), intro: 'By signing, the parties agree to the scope, schedule, budget and acceptance criteria in this project charter (version ' + v + ', ' + dmy(t0) + ').', rows: signers });
    var topRows = rows.filter(function (x) { return x.t.es; });
    return { id: 'ch' + Date.now().toString(36), full: true, no: 1, title: 'PROJECT CHARTER', date: t0, headRight: ['Version ' + v + '  ·  ' + st, 'Issued ' + dmy(t0), S.job.ref || ''], footer: 'Project charter v' + v + '  ·  ' + p.name.slice(0, 70),
      project: { name: p.name, ref: S.job.ref }, sections: S2, fileBase: ((S.job.ref || 'Project') + '-Project-Charter-v' + v).replace(/[^\w.-]+/g, '-'),
      gantt: { title: 'Task', from: addDays(R.start || t0, -2), to: addDays(R.finish || t0, 3), today: t0, rows: topRows.map(function (x) { var t = x.t; return { label: '#' + x.n + ' ' + clean(t.name), es: t.es, ef: t.ef, pct: t.pct, mile: t.dur === 0, crit: !!crit[t.id], late: t.pct < 100 && t.ef < t0, status: t.status, level: 1 }; }) } };
  }
  /* ---------- 💰 Budget: work out the project budget (replaces the quote step in GKH Project Champ) ---------- */
  var BCATS = ['Labour', 'Materials', 'Subcontractors', 'Equipment', 'Travel and expenses', 'Other'];
  function bCfg(p) { p.budgetCfg = p.budgetCfg || {}; var b = p.budgetCfg; ['cont', 'res', 'margin', 'gst'].forEach(function (k, i) { if (b[k] == null || isNaN(+b[k])) b[k] = [10, 5, 0, 10][i]; }); b.cat = b.cat || {}; return b; }
  function catOf(p, t) {
    var o = bCfg(p).cat[t.id]; if (o && BCATS.indexOf(o) >= 0) return o;
    var u = String(t.unit || '').toLowerCase().trim(), n = String(t.name || '').toLowerCase(), who = String(t.resource || '').toLowerCase();
    if (/travel|flight|airfare|accommodation|hotel|per diem|visa/.test(n)) return 'Travel and expenses';
    if (/hire|equipment|scaffold|crane|plant|licen[cs]e|software|laptop/.test(n)) return 'Equipment';
    if (/subcontract|sub-contract|\bsub\b/.test(who + ' ' + n) || u === 'sub') return 'Subcontractors';
    if (/^(h|hr|hrs|hour|hours|d|day|days|wk|week|weeks|person|ppl|fte|shift)s?$/.test(u)) return 'Labour';
    if ((t.mats || []).length || /^(m|m2|m²|m3|m³|lm|kg|t|l|item|items|ea|each|sheet|bag|box|roll|unit|pc|pcs)$/.test(u)) return 'Materials';
    return 'Other';
  }
  function phaseGroups() {   // the work between milestones (a phase ends at its milestone)
    var G = [], cur = { name: '', rows: [] };
    ordered().forEach(function (x) { if (x.t.dur === 0) { if (cur.rows.length) { cur.name = String(x.t.name).replace(/^[✓◆\s]+/, '').replace(/^Phase \d+ complete:\s*/i, ''); G.push(cur); } cur = { name: '', rows: [] }; } else cur.rows.push(x); });
    if (cur.rows.length) { cur.name = G.length ? 'Close-out' : 'Work'; G.push(cur); }
    return G;
  }
  function budgetCalc(p) {
    var b = bCfg(p), R = rollup(p, today()), base = 0, byCat = {}, byPh = [], tasks = [], months = {};
    BCATS.forEach(function (k) { byCat[k] = 0; });
    var spread = function (t, c) { if (!t.es || !t.ef) return; var d0 = Date.parse(t.es), d1 = Date.parse(t.ef), days = Math.max(1, Math.round((d1 - d0) / 864e5) + 1), per = c / days; for (var i = 0; i < days; i++) { var m = new Date(d0 + i * 864e5).toISOString().slice(0, 7); months[m] = (months[m] || 0) + per; } };
    var bomSum = 0, add = function (x, c, k, ph, bom) { byCat[k] += c; base += c; tasks.push({ n: x.n, t: x.t, c: c, cat: k, ph: ph, bom: !!bom }); spread(x.t, c); };
    phaseGroups().forEach(function (g) { var sum = 0; g.rows.forEach(function (x) { var lab = Math.round((Number(x.t.qty) || 0) * (Number(x.t.rate) || 0) * 100) / 100, mat = Math.round((cost(x.t) - lab) * 100) / 100;
        if (lab) { add(x, lab, catOf(p, x.t), g.name); sum += lab; } if (mat > 0.004) { add(x, mat, 'Materials', 'Bill of Materials', true); bomSum += mat; } });
      if (sum) byPh.push({ name: g.name, v: sum }); });
    var msLab = 0; ordered().forEach(function (x) { if (x.t.dur !== 0) return; var lab = Math.round((Number(x.t.qty) || 0) * (Number(x.t.rate) || 0) * 100) / 100, mat = Math.round((cost(x.t) - lab) * 100) / 100;   // the 🧱 BOM milestone carries the materials
      if (lab > 0.004) { add(x, lab, catOf(p, x.t), 'Milestones'); msLab += lab; } if (mat > 0.004) { add(x, mat, 'Materials', 'Bill of Materials', true); bomSum += mat; } });
    if (msLab) byPh.push({ name: 'Milestones', v: Math.round(msLab * 100) / 100 });
    if (p.bomLoose > 0) { add({ n: '', t: { name: 'BOM lines not linked to a task', id: '' } }, Number(p.bomLoose), 'Materials', 'Bill of Materials', true); bomSum += Number(p.bomLoose); }
    if (bomSum) byPh.push({ name: 'Bill of Materials', v: Math.round(bomSum * 100) / 100 });
    var r2_ = function (v) { return Math.round(v * 100) / 100; }, cont = r2_(base * b.cont / 100), res = r2_(base * b.res / 100), total = r2_(base + cont + res), price = r2_(total * (1 + b.margin / 100)), gst = r2_(price * b.gst / 100);
    var mk = Object.keys(months).sort(); return { cfg: b, R: R, base: r2_(base), cont: cont, res: res, total: total, price: price, gst: gst, inc: r2_(price + gst), byCat: byCat, byPh: byPh, tasks: tasks,
      months: mk.map(function (m) { return { m: m, v: r2_(months[m]) }; }), approved: (p.charter || {}).budget || 0, bom: r2_(bomSum) };
  }
  var mon = function (m) { var loc = { en: 'en-AU', zh: 'zh-CN', tl: 'fil-PH', ms: 'ms-MY', km: 'km-KH' }[typeof DOCL === 'string' ? DOCL : 'en'] || DOCL; try { return new Date(m + '-01T00:00:00Z').toLocaleDateString(loc, { month: 'short', year: '2-digit', timeZone: 'UTC' }); } catch (e) { return m; } };
  function budgetTab() {
    DOCL = 'en';
    var p = S.plan, B = $('#planBody'), K = budgetCalc(p), b = K.cfg, ro = !!(M.me && M.me.scope && (M.me.mods || {}).projects !== 'edit');
    var pct = function (k, lab, tip) { return '<label class="bd-in" title="' + esc(tip) + '">' + lab + '<span><input type="number" min="0" max="100" step="0.5" data-bcfg="' + k + '" value="' + b[k] + '"' + (ro ? ' disabled' : '') + '> %</span></label>'; };
    var cl = (window.ChampI18n && window.ChampI18n.get()) || 'en', miss = [];
    var tr = function (t) { if (cl === 'en' || !t) return t; var v = window.ChampI18n.cached(t, cl); if (v == null) { miss.push(t); return t; } return v; };
    var trData = function (d) { d = JSON.parse(JSON.stringify(d)); (d.items || []).forEach(function (x) { x.l = tr(x.l); }); if (d.centerLabel) d.centerLabel = tr(d.centerLabel); return d; };
    if (M.studio && M.studio.setWords) M.studio.setWords(cl === 'en' ? null : { spend: tr('Spend in the month'), cumulative: tr('Cumulative (S-curve)'), total: tr('Total') }, cl);
    var img = function (kind, data, alt) { data = trData(data); try { var c = M.studio ? M.studio.chart({ kind: kind, data: data }) : null; return c ? '<img class="bd-ch" alt="' + esc(alt) + '" src="' + c.png + '">' : ''; } catch (e) { return ''; } };
    var tile = function (v, l, cls) { return '<div class="bd-t ' + (cls || '') + '"><b>' + v + '</b><small>' + l + '</small></div>'; };
    var diff = K.approved ? Math.round((K.approved - K.total) * 100) / 100 : 0;
    B.innerHTML = '<div class="card bd"><div class="card-h"><h2>💰 Costing</h2><span class="sp"></span>' +
      '<button class="btn btn-sm" id="bdCsv" type="button">⬇ Costing (CSV)</button><button class="btn btn-sm btn-gold" id="bdSet" type="button"' + (ro ? ' disabled' : '') + '>✍ Approve the budget</button></div>' +
      '<p class="muted" style="margin:-4px 0 12px">Work out the costing from the plan: every task\'s cost (quantity × rate) and the signed-off Bill of Materials, by phase and by category, plus contingency for known risks and a management reserve for the unknown. Change a quantity, rate or category below and the totals follow.</p>' +
      '<div class="bd-tiles">' + tile(money(K.base), 'Base cost (BAC)', 'dark') + tile(money(K.cont), 'Contingency ' + b.cont + '%') + tile(money(K.res), 'Management reserve ' + b.res + '%') + tile(money(K.total), 'Total budget', 'gold') +
        tile(money(K.price), b.margin ? 'Client price (+' + b.margin + '% margin)' : 'Client price') + tile(money(K.inc), 'Including GST ' + b.gst + '%') + '</div>' +
      '<div class="bd-cfg">' + pct('cont', 'Contingency', 'For identified risks (known unknowns). PMBOK: part of the cost baseline.') + pct('res', 'Management reserve', 'For unforeseen work (unknown unknowns). Held by the sponsor, outside the cost baseline.') +
        pct('margin', 'Margin', 'Mark-up on the total budget, for the price to the client (0 for an internal project).') + pct('gst', 'GST / tax', 'Tax on the client price (10% GST in Australia, 8% SST in Malaysia).') +
        '<div class="bd-ap">' + (K.approved ? 'Approved budget <b>' + money(K.approved) + '</b>' + (b.setBy && b.setSig ? ' <small class="muted">✍ signed by ' + esc(b.setBy) + (b.setRole ? ', ' + esc(b.setRole) : '') + (b.setAt ? ' on ' + esc(dmy(new Date(b.setAt).toISOString().slice(0, 10))) : '') + '</small>' : '') + (Math.abs(diff) >= 1 ? ' · <span class="' + (diff < 0 ? 'bad' : 'good') + '">' + (diff < 0 ? money(-diff) + ' short of this budget' : money(diff) + ' to spare') + '</span>' : ' · <span class="good">matches</span>') : '<span class="muted">No approved budget yet</span>') + '</div></div>' +
      (function () { var bm = S.plan.bom; if (!bm || !(bm.lines || []).length || (S.mods && S.mods.bom === false)) return ''; var v = bm.lines.reduce(function (a, l) { return a + (Number(l.qty) || 0) * (Number(l.price) || 0); }, 0);
        return bm.status === 'Signed off' ? '<div class="bd-bomst ok">🧱 <b>Bill of Materials signed off</b> by ' + esc(bm.signedBy || '') + ': <b>' + money(v) + '</b> is in this costing as Materials.</div>'
          : '<div class="bd-bomst">🧱 <b>Bill of Materials: ' + money(v) + ' waiting for sign-off.</b> It is added to this costing once the preparer signs it off. <a href="#plan/' + esc(S.core) + '/bom">Open the BOM</a></div>'; })() +
      '<div class="bd-charts"><div><h3>Cost by phase</h3>' + (K.byPh.length ? img('bar', { items: K.byPh.map(function (x) { return { l: x.name, v: x.v, t: money(x.v) }; }) }, 'Cost by phase') : '<p class="muted">No costs yet.</p>') + '</div>' +
        '<div><h3>Cost by category</h3>' + (K.base ? img('donut', { items: BCATS.map(function (k) { return { l: k, v: K.byCat[k], t: money(K.byCat[k]) }; }), center: money(K.base), centerLabel: 'Base cost' }, 'Cost by category') : '<p class="muted">No costs yet.</p>') + '</div></div>' +
      (K.months.length ? '<h3>Cash flow by month</h3>' + img('scurve', { points: K.months.map(function (x) { return { l: mon(x.m), v: x.v }; }) }, 'Cash flow') : '') +
      '<h3>Cost breakdown</h3><div class="table-wrap"><table class="rt bd-tbl"><thead><tr><th>#</th><th>Task</th><th>Phase</th><th>Category</th><th class="num">Qty</th><th>Unit</th><th class="num">Rate</th><th class="num">Cost</th></tr></thead><tbody>' +
      K.tasks.map(function (x) { if (x.bom) return '<tr class="bd-bom" data-gobom title="Open the BOM to change it, then sign it off again to put it back in the costing"><td>' + x.n + '</td><td>🧱 ' + esc(String(x.t.name).replace(/^[🧱\s]+/, '')) + '</td><td><small>Bill of Materials</small></td><td>Materials</td><td class="num" colspan="3"><small class="muted">from the signed-off BOM · <u>edit in the BOM</u></small></td><td class="num"><b>' + money(x.c) + '</b></td></tr>';
        return '<tr><td>' + x.n + '</td><td>' + esc(x.t.name) + '</td><td><small>' + esc(x.ph) + '</small></td><td><select data-bcat="' + esc(x.t.id) + '"' + (ro ? ' disabled' : '') + '>' + BCATS.map(function (k) { return '<option' + (k === x.cat ? ' selected' : '') + '>' + k + '</option>'; }).join('') + '</select></td>' +
        '<td class="num"><input type="number" step="any" min="0" data-bq="' + esc(x.t.id) + '" value="' + (x.t.qty || 0) + '"' + (ro ? ' disabled' : '') + '></td><td>' + esc(x.t.unit || '') + '</td><td class="num"><input type="number" step="any" min="0" data-br="' + esc(x.t.id) + '" value="' + (x.t.rate || 0) + '"' + (ro ? ' disabled' : '') + '></td><td class="num"><b>' + money(x.c) + '</b></td></tr>'; }).join('') +
      '</tbody><tfoot><tr><td colspan="7">Base cost (BAC)</td><td class="num"><b>' + money(K.base) + '</b></td></tr><tr><td colspan="7">Contingency (' + b.cont + '%)</td><td class="num">' + money(K.cont) + '</td></tr><tr><td colspan="7">Management reserve (' + b.res + '%)</td><td class="num">' + money(K.res) + '</td></tr><tr class="bd-tot"><td colspan="7">Total budget</td><td class="num"><b>' + money(K.total) + '</b></td></tr></tfoot></table></div>' +
      (K.tasks.length ? '' : '<div class="empty">No task has a cost yet. Give tasks a quantity and a rate on the Schedule tab (Costs view), or here once they have one.</div>') + '</div>';
    B.querySelectorAll('[data-gobom]').forEach(function (r) { r.onclick = function () { location.hash = '#plan/' + S.core + '/bom'; if (bomLocked()) setTimeout(function () { toast('The BOM is signed off: 🔓 Reopen it to edit, then ✍ sign it off again to put it back in the costing'); }, 300); }; });
    if (miss.length && !S.bdTr) { S.bdTr = true; window.ChampI18n.strings(miss, cl).then(function () { S.bdTr = false; if (S.tab === 'budget' && $('.bd-tiles')) budgetTab(); }, function () { S.bdTr = false; }); }
    var byId = {}; p.tasks.forEach(function (t) { byId[t.id] = t; });
    B.querySelectorAll('[data-bcfg]').forEach(function (i) { i.onchange = function () { var v = Math.max(0, Math.min(100, +this.value || 0)); bCfg(p)[this.getAttribute('data-bcfg')] = v; dirty('budget ' + this.getAttribute('data-bcfg') + ' ' + v + '%'); setTimeout(budgetTab, 0); }; });
    B.querySelectorAll('[data-bcat]').forEach(function (s0) { s0.onchange = function () { bCfg(p).cat[this.getAttribute('data-bcat')] = this.value; dirty('budget category'); setTimeout(budgetTab, 0); }; });
    B.querySelectorAll('[data-bq],[data-br]').forEach(function (i) { i.onchange = function () { var t = byId[this.getAttribute('data-bq') || this.getAttribute('data-br')]; if (!t) return; if (this.hasAttribute('data-bq')) t.qty = Math.max(0, +this.value || 0); else t.rate = Math.max(0, +this.value || 0); derive && derive(t); dirty('budget: ' + t.name); setTimeout(render, 0); }; });
    $('#bdSet').onclick = function () { var c = p.charter = p.charter || {}, old = c.budget || 0;
      M.modal('<h2>✍ Approve the budget</h2><p class="muted" style="margin:-4px 0 10px">The approved budget becomes <b>' + money(K.total) + '</b> (base ' + money(K.base) + ' + contingency ' + money(K.cont) + ' + reserve ' + money(K.res) + ')' + (old ? ', replacing ' + money(old) : '') + '. It is the budget in the charter and the project plan, and the cost baseline progress is measured against.</p>' +
        '<form class="form" id="bdF"><label>Name<input name="by" required maxlength="80" value="' + esc((p.charter || {}).manager || bomMe()) + '"></label><label>Role<select name="role">' + CR_ROLES.map(function (r) { return '<option>' + r + '</option>'; }).join('') + '</select></label>' +
        '<label class="full">Signature <small class="muted">(type your full name)</small><input name="sig" required maxlength="80" class="cr-sigin" autocomplete="off"></label>' +
        '<div class="actions full"><button class="btn" data-close type="button">Cancel</button><button class="btn btn-gold" type="submit">✍ Approve and sign</button></div></form>');
      $('#bdF').onsubmit = function (e) { e.preventDefault(); var f = this, by = f.by.value.trim(), sig = f.sig.value.trim(); if (!by || !sig) return;
        var g = bCfg(p); c.budget = K.total; g.setAt = Date.now(); g.setBy = by; g.setRole = f.role.value; g.setSig = sig; g.setAmt = K.total;
        M.closeModal(); dirty('budget ' + money(K.total) + ' approved and signed by ' + by + ' (' + f.role.value + ')'); budgetTab(); toast('✍ Approved budget: ' + money(K.total) + ', signed by ' + by); }; };
    $('#bdCsv').onclick = function () {
      var q = function (v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
      var L = [['#', 'Task', 'Phase', 'Category', 'Qty', 'Unit', 'Rate', 'Cost']].concat(K.tasks.map(function (x) { return [x.n, x.t.name, x.ph, x.cat, x.t.qty || 0, x.t.unit || '', x.t.rate || 0, x.c]; }))
        .concat([[], ['', 'Base cost (BAC)', '', '', '', '', '', K.base], ['', 'Contingency ' + b.cont + '%', '', '', '', '', '', K.cont], ['', 'Management reserve ' + b.res + '%', '', '', '', '', '', K.res], ['', 'Total budget', '', '', '', '', '', K.total], ['', 'Client price', '', '', '', '', '', K.price], ['', 'GST ' + b.gst + '%', '', '', '', '', '', K.gst], ['', 'Including GST', '', '', '', '', '', K.inc]]);
      M.report.save(new Blob(['﻿' + L.map(function (r) { return r.map(q).join(','); }).join('\r\n')], { type: 'text/csv' }), ((S.job.ref || 'Project') + '-Costing.csv').replace(/[^\w.-]+/g, '-')); };
  }

  /* ---------- documents bar (replaces Plan → Quote → Invoice in GKH Project Champ) ---------- */
  function drawDocs() {
    var el = $('#planChain'); if (!el) return; var p = S.plan, K = budgetCalc(p), c = p.charter || {}, last = S.pdoc && S.pdoc.core === S.core ? S.pdoc.doc : null;
    var step = function (on, icon, title, sub, btn) { return '<div class="vstep' + (on ? ' done' : '') + '"><b>' + icon + ' ' + esc(title) + '</b><small>' + sub + '</small>' + btn + '</div>'; };
    el.innerHTML = '<div class="vchain docs3">' +
      step(!!c.budget, '💰', 'Costing', c.budget ? 'approved ' + esc(money(c.budget)) + (Math.abs(c.budget - K.total) >= 1 ? ' · works out at ' + esc(money(K.total)) : '') : 'works out at ' + esc(money(K.total)) + ' · not approved yet', '<button class="btn btn-sm btn-gold" data-dact="budget">💰 Work out the costing</button>') +
      step(c.docStatus === 'Approved', '📜', 'Project charter', 'v' + esc(c.docVersion || '1.0') + ' · ' + esc(c.docStatus || 'Draft') + ' · up to 4 pages', '<button class="btn btn-sm" data-dact="charter">📜 Generate the charter</button>') +
      step(!!last, '📘', 'Project plan', last ? 'AI narrative ' + esc(new Date(last.at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })) + ' · about 20 pages' : 'about 20 pages · PDF and Word', '<button class="btn btn-sm" data-dact="plan">📘 Generate the project plan</button>') + '</div>';
    el.querySelectorAll('[data-dact]').forEach(function (b) { b.onclick = function () { var a = b.getAttribute('data-dact'); if (a === 'budget') location.hash = '#plan/' + S.core + '/budget'; else if (a === 'charter') charterDialog(); else planDocDialog(); }; });
    if (!S.pdoc || S.pdoc.core !== S.core) { var core = S.core; S.pdoc = { core: core, doc: null }; api('intelPlanDocGet', { core: core }).then(function (d) { if (S.core === core) { S.pdoc = { core: core, doc: d.doc }; if (d.doc) drawDocs(); } }).catch(function () {}); }
  }

  /* ---------- 🎨 designed documents: shared pieces ---------- */
  // 🎨 the colour scheme of the charter and the plan (kept with the project, so the whole team gets the same look)
  function docTheme() { var t = S.plan.docTheme; return t && typeof t === 'object' ? t : t || 'champ'; }
  function themePick() {
    var cur = docTheme(), T = (M.studio && M.studio.themes()) || [], cus = typeof cur === 'object' ? cur : { ink: '#1E293B', accent: '#0EA5E9' };
    return '<div class="full thm"><span class="thm-l">Colour scheme</span><div class="thm-row">' + T.map(function (t) {
        return '<button type="button" class="thm-b' + (cur === t.id ? ' on' : '') + '" data-thm="' + t.id + '" title="' + esc(t.name) + '"><i style="background:linear-gradient(135deg,' + t.ink + ' 0 55%,' + t.accent + ' 55% 78%,' + t.light + ' 78%)"></i><small>' + esc(t.name) + '</small></button>'; }).join('') +
      '<span class="thm-b thm-c' + (typeof cur === 'object' ? ' on' : '') + '" data-thm="custom" title="Your own colours"><i class="thm-ci"><input type="color" data-thc="ink" value="' + esc(cus.ink) + '" title="Dark colour (title bands, cover)"><input type="color" data-thc="accent" value="' + esc(cus.accent) + '" title="Accent colour (lines, labels, charts)"></i><small>Your colours</small></span></div></div>';
  }
  function themeWire(box) {
    var set = function (v) { S.plan.docTheme = v; dirty('document colours'); box.querySelectorAll('.thm-b').forEach(function (b) { b.classList.toggle('on', typeof v === 'object' ? b.getAttribute('data-thm') === 'custom' : b.getAttribute('data-thm') === v); }); };
    box.querySelectorAll('button[data-thm]').forEach(function (b) { b.onclick = function () { set(b.getAttribute('data-thm')); }; });
    var cs = function () { set({ ink: box.querySelector('[data-thc=ink]').value, accent: box.querySelector('[data-thc=accent]').value }); };
    box.querySelectorAll('[data-thc]').forEach(function (i) { i.oninput = cs; i.onclick = function () { if (typeof docTheme() !== 'object') cs(); }; });
  }
  // 🌐 the project's data (typed or drafted in another language) into the console language, in one go: task names, phases, risks, issues, stakeholder roles, charter, BOM lines
  function dataStrings(p, fn) {   // fn(text, set) for each piece of project data people read
    var f = function (o, k) { if (o && typeof o[k] === 'string' && /\p{L}/u.test(o[k]) && !/@/.test(o[k])) fn(o[k], function (v) { o[k] = v; }); };
    f(p, 'name'); (p.phases || []).forEach(function (x) { f(x, 'name'); });
    (p.tasks || []).forEach(function (t) { f(t, 'name'); f(t, 'desc'); f(t, 'basis'); (t.subs || []).forEach(function (x) { f(x, 'name'); f(x, 'desc'); (x.steps || []).forEach(function (q) { f(q, 'name'); f(q, 'text'); }); }); });
    (p.risks || []).forEach(function (r) { ['title', 'cause', 'action'].forEach(function (k) { f(r, k); }); });
    (p.issues || []).forEach(function (r) { ['title', 'detail', 'resolution'].forEach(function (k) { f(r, k); }); });
    (p.stakeholders || []).forEach(function (r) { f(r, 'role'); });
    var c = p.charter || {}; ['objective', 'background', 'inScope', 'outScope', 'deliverables', 'acceptance', 'assumptions'].forEach(function (k) { f(c, k); });
    ((p.bom || {}).lines || []).forEach(function (l) { f(l, 'name'); f(l, 'note'); f(l, 'basis'); });
  }
  function translateData() {
    var l = (window.ChampI18n && window.ChampI18n.get()) || 'en'; if (l === 'en') return;
    var p = S.plan, list = [], jobs = [];
    var split = function (t) { return String(t).split('\n').map(function (ln) { var m = ln.match(/^(\s*(?:[-•*]|\d+[.)])\s+)?(.*)$/); return { pre: m[1] || '', body: m[2] || '' }; }); };
    dataStrings(p, function (t, set) { var L = split(t); L.forEach(function (x) { if (/\p{L}/u.test(x.body) && x.body.length < 700) list.push(x.body.trim()); }); jobs.push([L, set]); });
    if (!list.length) { toast('Nothing to translate'); return; }
    M.confirmBox('Translate this project\'s data?', 'Task names, phases, risks, issues, stakeholder roles, the charter and the BOM lines (' + pl(list.length, 'piece') + ' of text) are written in <b>' + esc(window.ChampI18n.name(l)) + '</b>, so everyone reads the same language. Names, emails, numbers and codes stay as they are. You can undo it straight after.', 'Translate').then(function (ok) {
      if (!ok) return; toast('Translating the project data…');
      var snap = JSON.parse(JSON.stringify(p));
      window.ChampI18n.strings(list, l).then(function (map) {
        var n = 0; jobs.forEach(function (j) { var changed = false, v = j[0].map(function (x) { var k = x.body.trim(), tr = map[k]; if (tr && tr !== k) { changed = true; n++; return x.pre + tr; } return x.pre + x.body; }).join('\n'); if (changed) j[1](v); });
        S.trUndo = { core: S.core, plan: snap }; dirty('project data translated (' + l + ')'); render();
        toast(pl(n, 'piece') + ' translated. “Undo translation” puts it back.');
      }).catch(fail);
    });
  }
  function docLang() { var l = (window.ChampI18n && window.ChampI18n.get && window.ChampI18n.get()) || 'en'; return l; }
  function langSelect(id, l) { var L = (window.ChampI18n && window.ChampI18n.langs) || [['en', 'English']]; return '<label>Language<select id="' + id + '" data-noi18n>' + L.map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === l ? ' selected' : '') + '>' + esc(x[1]) + '</option>'; }).join('') + '</select></label>'; }
  function ganttOf(p, R, crit, rows, t0) { var clean = function (n) { return String(n || '').replace(/^[✓◆\s]+/, ''); };
    return { title: 'Task', from: addDays(R.start || t0, -2), to: addDays(R.finish || t0, 3), today: t0, rows: rows.filter(function (x) { return x.t.es; }).map(function (x) { var t = x.t; return { label: '#' + x.n + ' ' + clean(t.name), es: t.es, ef: t.ef, pct: t.pct, mile: t.dur === 0, crit: !!crit[t.id], late: t.pct < 100 && t.ef < t0, status: t.status, level: 1 }; }) }; }
  function docFacts() {
    var p = S.plan, c = p.charter || {}, t0 = today(), R = rollup(p, t0), C = cpm(p), crit = {}; Object.keys(C.tasks).forEach(function (id) { if (C.tasks[id].float === 0) crit[id] = 1; });
    var rows = ordered(), all = !!p.weekends, dur = R.start && R.finish ? (all ? Math.round((Date.parse(R.finish) - Date.parse(R.start)) / 864e5) + 1 : workBetween(R.start, R.finish)) : 0;
    var miles = rows.filter(function (x) { return x.t.dur === 0; }), K = budgetCalc(p), clean = function (n) { return String(n || '').replace(/^[✓◆\s]+/, ''); };
    var wk = Math.max(1, Math.round(dur / (all ? 7 : 5)));
    return { p: p, c: c, t0: t0, R: R, crit: crit, rows: rows, dur: dur, weeks: wk, miles: miles, K: K, clean: clean, unit: all ? 'day' : 'working day', ref: S.job.ref || '', program: S.job.program || '',
      sponsor: c.customer || S.job.name || '', pm: c.manager || 'To be confirmed', v: c.docVersion || '1.0', st: c.docStatus || 'Draft' };
  }
  var DOCL = 'en';   // the language of the document being made: dates are written in it
  var fd = function (s) { var loc = { en: 'en-AU', zh: 'zh-CN', tl: 'fil-PH', ms: 'ms-MY', km: 'km-KH' }[DOCL] || DOCL; try { return s ? new Date(s + 'T00:00:00Z').toLocaleDateString(loc, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : 'To be set'; } catch (e) { return s; } };
  function shStakeRows(p, contacts) { return (p.stakeholders || []).filter(function (x) { return x.name || x.role; }).map(function (x) { var r = [{ t: x.name || '', b: true }, x.role || '', { t: x.raci || '', center: true }]; if (contacts) r.push(x.email || ''); return r; }); }
  function riskRows(p, n) { return (p.risks || []).filter(function (x) { return x.status !== 'Closed' && x.title; }).sort(function (a, b) { return b.p * b.i - a.p * a.i; }).slice(0, n).map(function (x) { var sc = x.p * x.i; return [x.title, { t: String(sc), rag: sc >= 15 ? 'R' : sc >= 8 ? 'A' : 'G' }, x.response + (x.action ? ': ' + x.action : ''), x.owner || '']; }); }
  function heatOf(p) { var cells = {}; (p.risks || []).forEach(function (r) { if (r.status === 'Closed' || !r.p || !r.i) return; var k = r.p + 'x' + r.i; cells[k] = (cells[k] || 0) + 1; }); return { cells: cells }; }
  function genDoc(D, fmt, msgEl) {   // PDF (or a print view for scripts the PDF fonts can't draw), or Word
    var say = function (t) { if (msgEl) msgEl.innerHTML = t ? '<span class="ask-think">' + esc(t) + '</span>' : ''; };
    if (!M.studio) return Promise.reject(new Error('The document designer did not load. Reload the page.'));
    var tr = D.lang && D.lang !== 'en' ? ' in ' + ((window.ChampI18n && window.ChampI18n.name(D.lang)) || D.lang) : '';
    if (fmt === 'pdf' && M.studio.needsPrint(D)) { var win = window.open('', '_blank'); say('Translating and laying out' + tr + '…'); return M.studio.print(D, win).then(function (r) { say(''); toast('Print view open: choose “Save as PDF” in the print window'); return r; }); }
    say((fmt === 'pdf' ? 'Designing the PDF' : 'Designing the Word file') + tr + '…');
    return M.studio[fmt](D).then(function (r) { M.report.save(r.blob, r.name); say(''); toast((fmt === 'pdf' ? 'PDF' : 'Word') + ' ready' + (r.pages ? ': ' + pl(r.pages, 'page') : '')); return r; });
  }

  /* ---------- 📜 the project charter, designed (at most 4 pages) ---------- */
  function charterDoc(o, lim, lang) {
    DOCL = lang || 'en';
    var F = docFacts(), p = F.p, c = F.c, R = F.R, K = F.K, L = [1, 0.75, 0.5, 0.35][lim || 0], n = 0, ch = function (title, kicker, blocks, lead) { return { no: ++n, title: title, kicker: kicker, lead: lead, blocks: blocks.filter(Boolean) }; };
    var miles = F.miles.slice(0, Math.max(4, Math.round(12 * L))).map(function (x) { var late = x.t.pct < 100 && x.t.ef < F.t0; return [F.clean(x.t.name).replace(/^Phase \d+ complete:\s*/i, ''), fd(x.t.es), { t: x.t.pct >= 100 ? 'Done' : late ? 'Late' : 'Planned', rag: x.t.pct >= 100 ? 'G' : late ? 'R' : undefined, center: true }]; });
    var signers = [{ role: 'Project sponsor', name: F.sponsor }, { role: 'Project manager', name: c.manager || '' }];
    (p.stakeholders || []).filter(function (x) { return x.raci === 'A' && x.name && !signers.some(function (y) { return y.name && y.name.toLowerCase() === x.name.toLowerCase(); }); }).slice(0, 2).forEach(function (x) { signers.push({ role: x.role || 'Accountable stakeholder', name: x.name }); });
    var C = [
      ch('Purpose and objective', 'Why', [{ t: 'p', text: c.objective || 'Not stated yet.' }, (o.background && (c.background || S.job.scope)) ? { t: 'callout', title: 'Background', text: c.background || S.job.scope } : null]),
      ch('Scope', 'What', [{ t: 'cards', items: [{ title: 'In scope', text: c.inScope || 'Not stated yet.', tag: 'Included' }, { title: 'Out of scope', text: c.outScope || 'Nothing excluded yet.', tag: 'Excluded', color: C_MUTED }] },
        { t: 'cards', items: [{ title: 'Deliverables', text: c.deliverables || 'Not stated yet.' }, { title: 'Acceptance criteria', text: c.acceptance || 'Not stated yet.' }] }]),
      ch('Schedule and milestones', 'When', [o.milestones && miles.length ? { t: 'table', head: ['Milestone', 'Date', 'Status'], rows: miles, widths: [4, 1.6, 1] } : null,
        o.gantt && L >= 0.5 ? { t: 'chart', kind: 'gantt', data: ganttOf(p, R, F.crit, F.rows, F.t0), max: Math.round(24 * L), maxH: 92 * L + 20 } : null]),
      ch('Budget', 'How much', [{ t: 'stats', items: [{ v: money(K.base), l: 'Base cost (BAC)' }, { v: money(K.cont + K.res), l: 'Contingency and reserve' }, { v: money(c.budget || K.total), l: c.budget ? 'Approved budget' : 'Proposed budget' }] }]),
      o.stake ? ch('Stakeholders', 'Who', [{ t: 'table', head: o.contacts ? ['Name', 'Role', 'RACI', 'Email'] : ['Name', 'Role', 'RACI'], rows: shStakeRows(p, o.contacts).slice(0, Math.round(12 * L)), widths: o.contacts ? [2, 2.4, 0.6, 2.4] : [2, 3, 0.7], empty: 'No stakeholders identified yet.' }]) : null,
      o.risks ? ch('Key risks', 'What could go wrong', [{ t: 'table', head: ['Risk', 'Score', 'Response', 'Owner'], rows: riskRows(p, Math.round(8 * L)), widths: [3, 0.7, 4, 1.4], empty: 'No open risks recorded.' }]) : null,
      ch('Assumptions, constraints and governance', 'How it is run', [{ t: 'p', text: (c.assumptions ? c.assumptions + '\n' : '') + '- The project manager runs the project day to day and reports to the sponsor.\n- Any change to scope, time or cost is raised in change control and approved and signed before it is made.' }]),
      ch('Approval', 'Sign-off', [{ t: 'sign', intro: 'By signing, the parties agree to the purpose, scope, schedule, budget and acceptance criteria in this charter (version ' + F.v + ', ' + fd(F.t0) + ').', rows: signers }])
    ].filter(Boolean);
    return { lang: lang, flow: true, cover: 'band', kicker: 'Project charter', title: p.name, subtitle: (F.sponsor ? F.sponsor + ' · ' : '') + (F.program ? F.program : 'Project charter'), short: 'Project charter',
      headRight: ['Version ' + F.v + ' · ' + F.st, 'Issued ' + fd(F.t0), F.ref], footer: 'Project charter v' + F.v + ' · ' + p.name.slice(0, 70),
      stats: [{ v: fd(R.start).replace(/ \d{4}$/, ''), l: 'Start' }, { v: fd(R.finish).replace(/ \d{4}$/, ''), l: 'Finish' }, { v: F.weeks + ' weeks', l: 'Duration' }, { v: money(c.budget || K.total), l: c.budget ? 'Approved budget' : 'Budget' }],
      chapters: C, fileBase: ((F.ref || 'Project') + '-Project-Charter-v' + F.v + (lang && lang !== 'en' ? '-' + lang : '')).replace(/[^\w.-]+/g, '-') };
  }
  var C_MUTED = [107, 102, 90];

  /* ---------- 📘 the project management plan, designed (about 20 pages) ---------- */
  function planDoc(N, lang) {
    DOCL = lang || 'en';
    var F = docFacts(), p = F.p, c = F.c, R = F.R, K = F.K, n = 0, S2 = (N && N.sections) || {}, nl = N && N.lang === lang;   // narrative already in this language: not translated again
    var T = function (text) { return text ? { t: 'p', text: text, noTr: nl } : null; };
    var ch = function (title, kicker, blocks, lead, blurb) { return { no: ++n, title: title, kicker: kicker, lead: lead, blurb: blurb, blocks: blocks.filter(Boolean) }; };
    var part = function (no, name, title, blurb, list) { return { divider: true, part: name, partNo: no, title: title, blurb: blurb, list: list }; };
    var crs = (p.changes || []).slice().sort(function (a, b) { return a.num - b.num; });
    var miles = F.miles.map(function (x) { var late = x.t.pct < 100 && x.t.ef < F.t0; return [String(x.n), F.clean(x.t.name).replace(/^Phase \d+ complete:\s*/i, ''), fd(x.t.es), { t: x.t.pct >= 100 ? 'Done' : late ? 'Late' : 'Planned', rag: x.t.pct >= 100 ? 'G' : late ? 'R' : undefined, center: true }]; });
    var critRows = F.rows.filter(function (x) { return F.crit[x.t.id] && x.t.es && x.t.dur > 0; }).map(function (x) { return [String(x.n), { t: F.clean(x.t.name), b: true }, fd(x.t.es), fd(x.t.ef), pl(x.t.dur, F.unit)]; });
    var obj = (S2.objectives || []).map(function (o) { return [{ t: o.objective, b: true }, o.measure]; });
    var dlv = (S2.deliverables || []).map(function (o) { return [{ t: o.deliverable, b: true }, o.description, o.acceptance]; });
    var phases = phaseGroups().map(function (g) { return { name: g.name, from: g.rows[0] && g.rows[0].t.es, to: g.rows[g.rows.length - 1] && g.rows[g.rows.length - 1].t.ef, n: g.rows.length }; });
    var D = { lang: lang, toc: true, kicker: 'Project management plan', title: p.name, short: 'Project management plan',
      subtitle: (c.objective || '').split(/(?<=[.!?])\s/)[0].slice(0, 200), coverNote: 'Prepared with GKH Project Champ · ' + fd(F.t0),
      headRight: ['Version ' + F.v + ' · ' + F.st, F.ref], footer: 'Project management plan v' + F.v + ' · ' + p.name.slice(0, 70),
      meta: [['Sponsor', F.sponsor || 'To be confirmed'], ['Project manager', F.pm], ['Program', F.program || 'Not in a program'], ['Reference', F.ref], ['Version', F.v + ' · ' + F.st], ['Issued', fd(F.t0)]],
      stats: [{ v: money(c.budget || K.total), l: c.budget ? 'Approved budget' : 'Budget' }, { v: F.weeks + ' weeks', l: fd(R.start) + ' to ' + fd(R.finish) }, { v: String(R.total), l: 'Tasks' }, { v: String(F.miles.length), l: 'Milestones' }],
      fileBase: ((F.ref || 'Project') + '-Project-Management-Plan-v' + F.v + (lang && lang !== 'en' ? '-' + lang : '')).replace(/[^\w.-]+/g, '-'), chapters: [] };
    var X = D.chapters;
    X.push(part(1, 'Part 1', 'Define the project', 'Why the project exists, what it will deliver and how success is judged.', [['01', 'Executive summary'], ['02', 'Project overview'], ['03', 'Scope']]));
    X.push(ch('Executive summary', 'Overview', [{ t: 'stats', items: D.stats },
      T(S2.executive_summary || c.objective || 'Write the executive summary with ✨ AI, or describe the project in the charter.'),
      { t: 'cards', cols: 3, items: [{ title: 'Start', text: fd(R.start), dark: true }, { title: 'Finish', text: fd(R.finish) + (p.finishBy ? ' (finish by ' + fd(p.finishBy) + ')' : '') }, { title: 'Health', text: R.pct + '% complete · ' + pl(Number(R.late) || 0, 'late task') }] }], '', 'The project on one page'));
    X.push(ch('Project overview', 'Context', [T(S2.background || c.background || S.job.scope), { t: 'h', text: 'Objectives' }, obj.length ? { t: 'table', head: ['Objective', 'How success is measured'], rows: obj, widths: [3, 2.4], noTr: nl } : T(c.objective),
      (S2.success_criteria || []).length ? { t: 'h', text: 'Success criteria' } : null, (S2.success_criteria || []).length ? { t: 'cards', cols: 2, items: S2.success_criteria.map(function (s, i) { return { title: 'Criterion ' + (i + 1), text: s }; }), noTr: false } : null], '', 'Background, objectives and success criteria'));
    X.push(ch('Scope', 'Boundaries', [T(S2.scope_statement), { t: 'cards', items: [{ title: 'In scope', text: c.inScope || 'Not stated yet.', tag: 'Included' }, { title: 'Out of scope', text: c.outScope || 'Nothing excluded yet.', tag: 'Excluded', color: C_MUTED }] },
      { t: 'h', text: 'Deliverables' }, dlv.length ? { t: 'table', head: ['Deliverable', 'Description', 'Acceptance'], rows: dlv, widths: [1.6, 3, 2.4], noTr: nl } : T(c.deliverables || 'Not stated yet.'),
      { t: 'cards', items: [{ title: 'Assumptions', text: (S2.assumptions || []).length ? S2.assumptions.map(function (x) { return '- ' + x; }).join('\n') : c.assumptions || 'None stated.' }, { title: 'Constraints', text: (S2.constraints || []).length ? S2.constraints.map(function (x) { return '- ' + x; }).join('\n') : 'Time: finish by ' + fd(p.finishBy || R.finish) + '. Budget: ' + money(c.budget || K.total) + '.' }] },
      { t: 'callout', title: 'Acceptance criteria', text: c.acceptance || 'Not stated yet.' }], '', 'What is delivered, and what is not'));
    X.push(part(2, 'Part 2', 'Plan the work', 'When the work happens, what it costs and who does it.', [['04', 'Schedule'], ['05', 'Budget and cost'], ['06', 'Resources and roles'], ['07', 'Stakeholders and communications']]));
    X.push(ch('Schedule', 'Time', [T(S2.schedule_management || 'The schedule below is the baseline. Progress is updated weekly against it.'),
      { t: 'cards', cols: Math.min(3, Math.max(1, phases.length)), items: phases.slice(0, 6).map(function (g, i) { return { title: 'Phase ' + (i + 1) + ': ' + g.name, text: fd(g.from) + ' to ' + fd(g.to) + ' · ' + pl(g.n, 'task'), dark: i === 0 }; }) },
      { t: 'chart', kind: 'gantt', title: 'Gantt chart', data: ganttOf(p, R, F.crit, F.rows, F.t0), max: 40, maxH: 175 },
      { t: 'table', title: 'Milestones', head: ['#', 'Milestone', 'Date', 'Status'], rows: miles, widths: [0.5, 4, 1.8, 1] },
      { t: 'table', title: 'Critical path', head: ['#', 'Task', 'Start', 'Finish', 'Duration'], rows: critRows, widths: [0.5, 3.6, 1.6, 1.6, 1.3], note: 'Any delay to a task on the critical path delays the finish date of ' + fd(R.finish) + '.', empty: 'No critical path yet: link the tasks.' }], '', 'Phases, Gantt chart, milestones and critical path'));
    X.push(ch('Budget and cost', 'Cost', [{ t: 'stats', items: [{ v: money(K.base), l: 'Base cost (BAC)' }, { v: money(K.cont), l: 'Contingency ' + K.cfg.cont + '%' }, { v: money(K.res), l: 'Reserve ' + K.cfg.res + '%' }, { v: money(c.budget || K.total), l: c.budget ? 'Approved budget' : 'Total budget' }] },
      T(S2.cost_management || 'The budget is built from each task\'s quantity and rate, with contingency for identified risks and a management reserve held by the sponsor.'),
      K.byPh.length ? { t: 'chart', kind: 'bar', title: 'Cost by phase', data: { items: K.byPh.map(function (x) { return { l: x.name, v: x.v, t: money(x.v) }; }) }, maxH: 70 } : null,
      K.base ? { t: 'chart', kind: 'donut', title: 'Cost by category', data: { items: BCATS.map(function (k) { return { l: k, v: K.byCat[k], t: money(K.byCat[k]) }; }), center: money(K.base), centerLabel: 'Base cost' }, maxH: 72 } : null,
      K.months.length ? { t: 'chart', kind: 'scurve', title: 'Cash flow by month (S-curve)', data: { points: K.months.map(function (x) { return { l: mon(x.m), v: x.v }; }) }, maxH: 80 } : null,
      { t: 'table', title: 'Budget summary', head: ['Item', 'Amount'], rows: [['Base cost (BAC)', { t: money(K.base), right: true }], ['Contingency (' + K.cfg.cont + '%)', { t: money(K.cont), right: true }], ['Management reserve (' + K.cfg.res + '%)', { t: money(K.res), right: true }], [{ t: 'Total budget', total: true }, { t: money(K.total), total: true, right: true }]].concat(K.cfg.margin ? [['Client price (+' + K.cfg.margin + '% margin)', { t: money(K.price), right: true }]] : []).concat(K.cfg.gst ? [['Including GST ' + K.cfg.gst + '%', { t: money(K.inc), right: true }]] : []), widths: [3, 1.4] }], '', 'Cost baseline, contingency and cash flow'));
    X.push(ch('Resources and roles', 'People', [T(S2.resource_management), (S2.roles || []).length ? { t: 'table', title: 'Roles and responsibilities', head: ['Role', 'Responsibilities'], rows: S2.roles.map(function (r) { return [{ t: r.role, b: true }, r.responsibilities]; }), widths: [1.4, 4], noTr: nl } : null,
      { t: 'table', title: 'Project team and stakeholders (RACI)', head: ['Name', 'Role', 'RACI'], rows: shStakeRows(p), widths: [2, 3, 0.7], note: 'R = Responsible · A = Accountable · C = Consulted · I = Informed', empty: 'No team members or stakeholders recorded yet.' }], '', 'Who does the work and who decides'));
    X.push(ch('Stakeholders and communications', 'Engagement', [T(S2.stakeholder_engagement), (S2.communication_plan || []).length ? { t: 'table', title: 'Communication plan', head: ['Audience', 'What', 'How', 'When', 'Owner'], rows: S2.communication_plan.map(function (r) { return [{ t: r.audience, b: true }, r.information, r.method, r.frequency, r.owner]; }), widths: [1.4, 2.6, 1.2, 1, 1.1], noTr: nl } : null,
      { t: 'callout', title: 'Reporting', text: 'Status reports go to the sponsor and stakeholders on a regular cycle with a red, amber or green rating for schedule, cost, scope, risks and issues, made from the live plan in Project Champ.' }], '', 'Who needs to know what, and when'));
    X.push(part(3, 'Part 3', 'Control and close', 'How risks, quality and change are managed, how the project is governed, and how it is closed.', [['08', 'Risk management'], ['09', 'Quality management'], ['10', 'Change control'], ['11', 'Procurement and contracts'], ['12', 'Governance'], ['13', 'Closure and next steps']]));
    var rk = riskRows(p, 15);
    X.push(ch('Risk management', 'Risk', [T(S2.risk_management || 'Risks are identified, scored (probability × impact, 1 to 5 each), owned and reviewed every week.'), rk.length ? { t: 'chart', kind: 'heat', title: 'Risk heat map (open risks)', data: heatOf(p), maxH: 70 } : null,
      { t: 'table', title: 'Risk register', head: ['Risk', 'Score', 'Response and action', 'Owner'], rows: rk, widths: [3, 0.7, 4, 1.4], empty: 'No open risks recorded yet.' },
      (p.issues || []).filter(function (x) { return x.status !== 'Resolved' && x.title; }).length ? { t: 'table', title: 'Open issues', head: ['Issue', 'Priority', 'Owner', 'Due'], rows: (p.issues || []).filter(function (x) { return x.status !== 'Resolved' && x.title; }).map(function (x) { return [x.title, { t: x.priority, rag: x.priority === 'Critical' ? 'R' : x.priority === 'High' ? 'A' : undefined }, x.owner || '', fd(x.due)]; }), widths: [4, 1, 1.6, 1.4] } : null], '', 'Risk register, heat map and open issues'));
    X.push(ch('Quality management', 'Quality', [T(S2.quality_management || 'Each deliverable is checked against its acceptance criteria before it is handed over.'), (S2.quality_checks || []).length ? { t: 'table', title: 'Quality checks', head: ['Deliverable', 'Standard', 'How it is checked'], rows: S2.quality_checks.map(function (r) { return [{ t: r.deliverable, b: true }, r.standard, r.check]; }), widths: [1.6, 2.4, 2.6], noTr: nl } : null], '', 'Standards and checks'));
    X.push(ch('Change control', 'Change', [T(S2.change_control || 'Every change to scope, time or cost is raised as a change request, assessed for its impact, approved and signed, and kept on record.'),
      { t: 'cards', cols: 3, items: [{ title: '1. Raise', text: 'From a meeting, Project Intelligence or by hand.', dark: true }, { title: '2. Assess', text: 'Scope, time, cost, quality, risks, issues, stakeholders.' }, { title: '3. Decide and sign', text: 'Approve, reject or defer; the signed PDF is kept on record.' }] },
      { t: 'table', title: 'Change register', head: ['CR', 'Change', 'Status', 'Decision', 'Effect'], rows: crs.map(function (x) { var e = x.effect || {}; return ['CR-' + ('00' + x.num).slice(-3), x.title, x.status, x.decision ? x.decision.outcome + ' by ' + x.decision.by + (x.decision.role ? ' (' + x.decision.role + ')' : '') : 'Open', e.f1 ? 'Finish ' + fd(e.f1) + (e.b1 ? ', budget ' + money(e.b1) : '') : '']; }), widths: [0.8, 3, 1.1, 2.4, 2], empty: 'No change requests yet.' }], '', 'How changes are approved'));
    X.push(ch('Procurement and contracts', 'Contracts', [T(S2.procurement || 'Goods and services are bought through the organisation\'s procurement process, with contracts recorded against the project.'),
      (p.contracts || []).length ? { t: 'table', title: 'Contracts', head: ['Type', 'With', 'Value', 'Status'], rows: (p.contracts || []).map(function (x) { return [x.type || '', x.type === 'Customer' ? F.sponsor : x.party || '', x.value ? money(x.value) : '', x.status || '']; }), widths: [1.2, 2.6, 1.2, 1.2] } : null], '', 'Buying and contracts'));
    X.push(ch('Governance', 'Governance', [T(S2.governance || 'The sponsor owns the business case and approves major changes; the project manager runs the project day to day.'), (S2.governance_forums || []).length ? { t: 'table', title: 'Governance forums', head: ['Forum', 'Members', 'How often', 'Purpose'], rows: S2.governance_forums.map(function (r) { return [{ t: r.forum, b: true }, r.members, r.frequency, r.purpose]; }), widths: [1.4, 2.2, 1, 2.6], noTr: nl } : null], '', 'Who decides, and where'));
    X.push(ch('Closure and next steps', 'Close', [T(S2.closure || 'The project closes when every deliverable is accepted, the handover is complete, final costs are settled and lessons learned are recorded.'),
      (S2.next_steps || []).length ? { t: 'callout', title: 'Next 30 days', dark: true, text: S2.next_steps.map(function (x) { return '- ' + x; }).join('\n'), noTr: nl } : null,
      { t: 'sign', title: 'Approval', intro: 'By signing, the parties approve this project management plan (version ' + F.v + ', ' + fd(F.t0) + ') as the baseline for the project.', rows: [{ role: 'Project sponsor', name: F.sponsor }, { role: 'Project manager', name: c.manager || '' }] }], '', 'Acceptance, handover and sign-off'));
    X.push(ch('Appendix: task list', 'Appendix', [{ t: 'table', head: ['#', 'Task', 'Start', 'Finish', 'Days', 'Cost'], rows: F.rows.map(function (x) { return [String(x.n), x.t.dur === 0 ? { t: F.clean(x.t.name), b: true } : F.clean(x.t.name), fd(x.t.es), fd(x.t.ef), x.t.dur ? String(x.t.dur) : '◆', cost(x.t) ? { t: money(cost(x.t)), right: true } : '']; }), widths: [0.5, 4, 1.6, 1.6, 0.6, 1.2], size: 7.2 }], '', 'Every task, with dates and cost'));
    return D;
  }
  function planDocDialog() {
    var core = S.core, last = S.pdoc && S.pdoc.core === core ? S.pdoc.doc : null, l = docLang();
    M.modal('<h2>📘 Project management plan</h2><p class="muted" style="margin:4px 0 10px">A designed plan of about 20 pages: cover, contents, three parts (define, plan, control and close), 13 chapters with the Gantt chart, budget charts, cash flow, risk heat map and registers, and an approval page. ✨ The AI writes the narrative from this plan (up to 50,000 tokens, about 1 to 3 minutes). Download it as PDF or Word.</p>' +
      '<div class="form ch-form">' + themePick() + langSelect('pdLang', l) + '<div class="full" id="pdState" style="font-size:13px"></div></div>' +
      '<div class="row" style="gap:6px;margin-top:12px;flex-wrap:wrap"><button class="btn btn-gold" id="pdAi" type="button">✨ Write the narrative with AI</button><button class="btn" id="pdPdf" type="button">⬇ PDF</button><button class="btn" id="pdDocx" type="button">⬇ Word</button><span class="muted" id="pdMsg" style="font-size:12.5px"></span></div>' +
      '<div class="actions" style="justify-content:flex-end"><button class="btn" data-close type="button">Close</button></div>');
    var state = function () { var d = S.pdoc && S.pdoc.doc, e = $('#pdState'); if (!e) return; e.innerHTML = d ? '✓ Narrative written ' + esc(new Date(d.at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })) + ' by ' + esc(d.by || '') + ' · ' + (d.lang && d.lang !== 'en' ? esc((window.ChampI18n && window.ChampI18n.name(d.lang)) || d.lang) + ' · ' : '') + Number(d.tokens || 0).toLocaleString('en-AU') + ' tokens' + (d.partial ? ' · <span class="warn">' + esc(d.partial) + '</span>' : '') + '. Write it again after big changes to the plan.' + ((d.lang || 'en') !== ($('#pdLang') ? $('#pdLang').value : 'en') ? '<br><span class="warn">⚠ The narrative is in ' + esc((window.ChampI18n && window.ChampI18n.name(d.lang || 'en')) || d.lang) + '. ' + ($('#pdLang').value === 'en' ? 'Press ✨ to write it again in English, otherwise it stays in ' + esc((window.ChampI18n && window.ChampI18n.name(d.lang)) || d.lang) + '.' : 'It will be translated; for the best wording press ✨ to write it in ' + esc(window.ChampI18n.name($('#pdLang').value)) + '.') + '</span>' : '') : '<span class="warn">No AI narrative yet:</span> the plan can still be made from the plan data, but ✨ the AI adds the executive summary, objectives, deliverables and the management plans.'; };
    state(); themeWire($('#modal')); $('#pdLang').onchange = state;
    var busy = false, msg = $('#pdMsg');
    var make = function (fmt) { if (busy) return; busy = true; var lang = $('#pdLang').value; var D = planDoc(S.pdoc && S.pdoc.doc, lang); D.theme = docTheme(); genDoc(D, fmt, msg).catch(function (e) { msg.innerHTML = ''; fail(e); }).then(function () { busy = false; }); };
    $('#pdPdf').onclick = function () { make('pdf'); }; $('#pdDocx').onclick = function () { make('docx'); };
    $('#pdAi').onclick = function () {
      if (busy) return; busy = true; var b = this, id = rid(), lang = $('#pdLang').value, K = budgetCalc(S.plan), t0 = Date.now(); b.disabled = true; msg.innerHTML = '<span class="ask-think">✨ The AI is writing the plan in three parts at once (about 1 to 3 minutes)…</span>';
      fetch('/.netlify/functions/planai-background', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-MBS-Admin': '1', 'X-Champ-Lang': (window.ChampI18n && window.ChampI18n.get()) || 'en' },
        body: JSON.stringify({ id: id, core: core, mode: 'plandoc', lang: lang, budget: { base: K.base, contingency: K.cont, reserve: K.res, total: K.total, approved: (S.plan.charter || {}).budget || 0, by_phase: K.byPh, by_category: K.byCat, months: K.months.length } }) })
        .then(function (r) { if (r.status === 401 || r.status === 403) throw new Error('Your session has ended, or you need edit access to projects.'); if (r.status !== 202 && !r.ok) throw new Error('Could not start the AI (' + r.status + ')'); })
        .then(function poll() { return new Promise(function (res) { setTimeout(res, 2500); }).then(function () { return api('planAiStatus', { id: id }); }).then(function (d) {
          if (d.status === 'done' && d.plandoc) { S.pdoc = { core: core, doc: d.plandoc }; state(); drawDocs(); msg.innerHTML = ''; toast('Narrative written (' + Number(d.plandoc.tokens || 0).toLocaleString('en-AU') + ' tokens). Download the PDF or Word.'); return; }
          if (d.status === 'error') throw new Error(d.error || 'The AI could not write the plan');
          if (Date.now() - t0 > 600000) throw new Error('The AI is taking too long. Try again.');
          return poll(); }); })
        .catch(function (e) { msg.innerHTML = ''; fail(e); }).then(function () { busy = false; b.disabled = false; });
    };
  }
  function charterDialog() {
    var p = S.plan, c = p.charter, o = chOpts();
    M.modal('<h2>📄 Project charter</h2><p class="muted" style="margin:4px 0 10px">A sign-off document from this plan: objective, scope, deliverables, acceptance criteria, milestones, the Gantt chart, critical path, stakeholder register, risks and budget, with signature lines. Download it as PDF, or as Word to change it.</p>' +
      '<div class="form ch-form">' + themePick() + langSelect('chLang', docLang()) + '<label>Version<input id="chV" maxlength="10" value="' + esc(c.docVersion || '1.0') + '"></label><label>Status<select id="chS">' + ['Draft', 'For approval', 'Approved'].map(function (x) { return '<option' + ((c.docStatus || 'Draft') === x ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select></label></div>' +
      '<b style="font-size:13px;display:block;margin:10px 0 4px">Include</b><div class="ch-opts">' + CH_OPT.map(function (x) { return '<label class="qchk' + (x[0] === 'contacts' ? ' ch-sub' : '') + '"><input type="checkbox" data-cho="' + x[0] + '"' + (o[x[0]] ? ' checked' : '') + '> ' + esc(x[1]) + '</label>'; }).join('') + '</div>' +
      '<p class="muted" style="font-size:12px;margin:8px 0 0">Always included: project at a glance, objective, scope in and out, deliverables, acceptance criteria, assumptions, and the approval and sign-off block.</p>' +
      '<div class="row" style="gap:6px;margin-top:12px"><button class="btn" id="chPrev" type="button">👁 Preview</button><button class="btn btn-gold" id="chPdf" type="button">⬇ PDF</button><button class="btn" id="chDocx" type="button">⬇ Word (to edit)</button><span class="muted" id="chMsg" style="font-size:12.5px"></span></div>' +
      '<div class="ch-signed"><b>📎 Signed copy</b> <span class="muted" style="font-size:12.5px">Upload the signed charter (PDF or Word) to keep it with the project; 🧠 Project Intelligence can read it.</span><label class="btn btn-sm" style="margin-left:auto">⬆ Upload signed charter<input type="file" id="chUp" hidden accept=".pdf,.docx"></label></div>' +
      '<div class="actions" style="justify-content:flex-end"><button class="btn" data-close type="button">Close</button></div>');
    var label = function () { var e = document.querySelector('.ch-ver'); if (e) e.textContent = 'v' + (c.docVersion || '1.0') + ' · ' + (c.docStatus || 'Draft'); };
    var keep = function () { var nv = $('#chV').value.trim() || '1.0', ns = $('#chS').value; if (nv !== c.docVersion || ns !== c.docStatus) { c.docVersion = nv; c.docStatus = ns; dirty('charter version ' + nv + ' ' + ns); } label();
      document.querySelectorAll('[data-cho]').forEach(function (b) { o[b.getAttribute('data-cho')] = b.checked; }); try { localStorage.setItem('mbsCharterOpt', JSON.stringify(o)); } catch (e) {} };
    var msg = function (t) { $('#chMsg').innerHTML = t ? '<span class="ask-think">' + esc(t) + '</span>' : ''; };
    var busy = false, go = function (fmt, preview) { if (busy) return; busy = true; keep(); var lang = $('#chLang').value, el = $('#chMsg');
      var D0 = charterDoc(o, 0, lang); D0.theme = docTheme();
      if (fmt === 'docx' || M.studio.needsPrint(D0)) { genDoc(D0, fmt, el).catch(function (e) { msg(''); fail(e); }).then(function () { busy = false; }); return; }
      var win = preview ? window.open('', '_blank') : null;
      msg('Designing the charter' + (lang !== 'en' ? ' in ' + window.ChampI18n.name(lang) : '') + '…');
      var tryLim = function (lim, D) { return M.studio.pdf(D).then(function (r) { if (r.pages > 4 && lim < 3) { var D2 = charterDoc(o, lim + 1, lang); D2.theme = docTheme(); return tryLim(lim + 1, D2); } return r; }); };   // at most 4 pages: tables and the Gantt chart shrink until it fits
      tryLim(0, D0).then(function (r) { if (preview) { var u = URL.createObjectURL(r.blob); if (win) win.location = u; else M.report.save(r.blob, r.name); } else M.report.save(r.blob, r.name); msg(''); toast('Charter ready: ' + pl(r.pages, 'page')); })
        .catch(function (e) { msg(''); fail(e); }).then(function () { busy = false; }); };
    themeWire($('#modal'));
    $('#chPrev').onclick = function () { go('pdf', true); }; $('#chPdf').onclick = function () { go('pdf'); }; $('#chDocx').onclick = function () { go('docx'); };
    $('#chV').onchange = keep; $('#chS').onchange = keep;
    $('#chUp').onchange = function () { var f = this.files[0]; this.value = ''; if (!f) return; msg('Reading “' + f.name + '”…'); var core = S.core;
      piExtract(f).then(function (x) {
        var send = function (b64) { return api('intelUpload', { core: core, name: f.name, type: f.type, size: f.size, pages: x.pages, text: x.text || ('Signed project charter ' + f.name), file: b64, kind: 'Project charter (signed)' }); };
        return new Promise(function (res) { var rd = new FileReader(); rd.onload = function () { res(String(rd.result).replace(/^data:[^,]*,/, '')); }; rd.readAsDataURL(f); }).then(send);
      }).then(function (r) { if (S.intel && S.intel.core === core) S.intel.docs.push(r.doc); if (c.docStatus !== 'Approved') { c.docStatus = 'Approved'; $('#chS').value = 'Approved'; dirty('charter signed'); } label(); msg(''); toast('Signed charter kept with the project (status: Approved)'); })
        .catch(function (e) { msg(''); toast(e.message, true); }); };
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


  /* ---------- v45: 👥 Stakeholders (RACI) ---------- */
  var RACI = { R: ['Responsible', 'does the work'], A: ['Accountable', 'signs off, has the final say'], C: ['Consulted', 'asked before decisions'], I: ['Informed', 'kept up to date'] };
  function pplPick() {   // v86: people not yet on this plan's register, employees first
    var on = {}; (S.plan.stakeholders || []).forEach(function (x) { on[(x.name || '').toLowerCase()] = 1; });
    var L = pplAll().filter(function (x) { return !on[x.name.toLowerCase()]; });
    return ['Employee', 'Contractor'].map(function (t) { var g = L.filter(function (x) { return x.type === t; }); return g.length ? '<optgroup label="' + t + 's">' + g.map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.name + (x.role ? ' · ' + x.role : '')) + (x.comp && x.comp.worst === 'expired' ? ' ⚠ tickets expired' : '') + '</option>'; }).join('') + '</optgroup>' : ''; }).join('');
  }
  function subOpts() {   // active subbies, not "Do not use", grouped by trade
    var by = {}; M.subs.list().filter(function (s) { return !s.archived && s.status !== 'Do not use'; }).forEach(function (s) { var t = M.subs.tradeName(s.trade); (by[t] = by[t] || []).push(s); });
    return Object.keys(by).sort().map(function (t) { return '<optgroup label="' + esc(t) + '">' + by[t].map(function (s) { return '<option value="' + esc(s.id) + '">' + esc(s.business) + (s.comp && s.comp.worst === 'expired' ? ' ⚠ papers expired' : '') + '</option>'; }).join('') + '</optgroup>'; }).join('');
  }

  /* ---------- v75: 🧭 RACI map: activities × stakeholders, in a panel that slides in from the right; also in the charter ---------- */
  var RACI_ORDER = ['', 'R', 'A', 'C', 'I'];
  function raciActs(p) { return ordered().filter(function (x) { return x.t.dur > 0; }); }
  function raciPeople(p) { return (p.stakeholders || []).filter(function (x) { return x.name || x.role; }); }
  function raciCell(p, t, sh) {   // { v: 'R'|'A'|'C'|'I'|'', sug: true when it is only a suggestion }
    var row = (p.raciMap || {})[t.id] || {}, e = row[sh.id];
    if (e) return { v: e === '-' ? '' : e, sug: false };
    var nm = String(sh.name || '').toLowerCase().trim(), on = nm && ((t.res || []).some(function (r) { return String(r).toLowerCase() === nm; }) || (t.subs || []).some(function (x) { return String(x.owner || '').toLowerCase() === nm; }) || ownerOf(t).toLowerCase() === nm);
    if (on) return { v: 'R', sug: true };
    return { v: sh.raci === 'R' ? '' : sh.raci, sug: true };
  }
  function raciCheck(p, t) { var ppl = raciPeople(p), a = 0, r = 0; ppl.forEach(function (sh) { var c = raciCell(p, t, sh).v; if (c === 'A') a++; if (c === 'R') r++; }); return !ppl.length ? '' : a === 0 ? 'No A' : a > 1 ? a + ' × A' : r === 0 ? 'No R' : ''; }
  function raciStrip() {
    var p = S.plan, acts = raciActs(p), ppl = raciPeople(p); if (!acts.length || !ppl.length) return '';
    var bad = acts.filter(function (x) { return raciCheck(p, x.t); }).length;
    return '<button type="button" class="rc-strip" id="raciStrip" title="Open the RACI map"><b>🧭 RACI map</b> ' + acts.length + ' activities × ' + ppl.length + ' people · ' + (bad ? '<span class="rc-bad">' + pl(bad, 'activity', 'activities').replace('activitys', 'activities') + ' to check</span>' : '<span class="rc-ok">all set</span>') + ' ›</button>';
  }
  function raciDrawer() {
    var p = S.plan; p.raciMap = p.raciMap || {};
    var old = document.getElementById('rcDrawer'); if (old) old.remove();
    var d = document.createElement('div'); d.id = 'rcDrawer'; d.className = 'rc-wrap'; document.body.appendChild(d);
    var close = function () { d.classList.remove('open'); setTimeout(function () { d.remove(); if (S.tab === 'stake') render(); }, 200); document.removeEventListener('keydown', esc1); };
    var esc1 = function (e) { if (e.key === 'Escape') close(); }; document.addEventListener('keydown', esc1);
    var draw = function () {
      var acts = raciActs(p), ppl = raciPeople(p);
      var head = '<tr><th class="rc-act">Activity</th>' + ppl.map(function (sh) { return '<th class="rc-p" title="' + esc((sh.name || '') + ' · ' + (sh.role || '') + ' · overall ' + sh.raci) + '"><span>' + esc(sh.name || sh.role) + '</span></th>'; }).join('') + '<th class="rc-chk">Check</th></tr>';
      var body = acts.map(function (x) { var t = x.t, chk = raciCheck(p, t);
        return '<tr data-rt="' + esc(t.id) + '"><th class="rc-act"><b>#' + x.n + '</b> ' + esc(t.name.replace(/^[✓◆\s]+/, '')) + '<small>' + esc(dmy(t.es)) + (t.dur > 1 ? ' – ' + esc(dmy(t.ef)) : '') + '</small></th>' +
          ppl.map(function (sh) { var c = raciCell(p, t, sh); return '<td><button type="button" class="rc-c rc-' + (c.v || 'x') + (c.sug ? ' sug' : '') + '" data-rs="' + esc(sh.id) + '" title="' + esc((sh.name || sh.role) + ': ' + (c.v ? RACI[c.v][0] : 'no part') + (c.sug ? ' (suggested)' : '')) + '">' + (c.v || '·') + '</button></td>'; }).join('') +
          '<td class="rc-chk">' + (chk ? '<span class="rc-bad" title="Each activity needs exactly one A and at least one R">⚠ ' + chk + '</span>' : '<span class="rc-ok">✓</span>') + '</td></tr>'; }).join('');
      var sug = acts.some(function (x) { return ppl.some(function (sh) { return raciCell(p, x.t, sh).sug && raciCell(p, x.t, sh).v; }); });
      d.innerHTML = '<div class="rc-back"></div><aside class="rc-panel" role="dialog" aria-label="RACI map"><div class="rc-top"><h2>🧭 RACI map</h2><span class="sp"></span>' +
        (sug ? '<button class="btn btn-sm btn-gold" id="rcAccept" type="button" title="Keep every suggested letter">✓ Accept the suggestions</button>' : '') + '<button class="btn btn-sm" id="rcClear" type="button">Clear</button><button class="btn btn-sm" id="rcClose" type="button" aria-label="Close">✕</button></div>' +
        '<p class="muted rc-help">Who does what on each activity. <b>Click a cell</b> to change it: R → A → C → I → none. Faint letters are suggestions from the stakeholder list and who is on the task. Each activity needs <b>one A</b> and at least <b>one R</b>. It goes into the project charter.</p>' +
        '<div class="rc-leg">' + Object.keys(RACI).map(function (k) { return '<span><span class="rc-c rc-' + k + '">' + k + '</span> ' + RACI[k][0] + ' (' + RACI[k][1] + ')</span>'; }).join('') + '</div>' +
        (acts.length && ppl.length ? '<div class="rc-scroll"><table class="rc-tbl"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>' : '<div class="empty">Add stakeholders and tasks first.</div>') + '</aside>';
      requestAnimationFrame(function () { d.classList.add('open'); });
      d.querySelector('.rc-back').onclick = close; d.querySelector('#rcClose').onclick = close;
      var acc = d.querySelector('#rcAccept'); if (acc) acc.onclick = function () { acts.forEach(function (x) { ppl.forEach(function (sh) { var c = raciCell(p, x.t, sh); if (c.sug && c.v) { (p.raciMap[x.t.id] = p.raciMap[x.t.id] || {})[sh.id] = c.v; } }); }); dirty('RACI map: suggestions accepted'); draw(); };
      d.querySelector('#rcClear').onclick = function () { M.confirmBox('Clear the RACI map?', 'Every letter you set goes back to the suggestions.', 'Clear', true).then(function (y) { if (!y) return; p.raciMap = {}; dirty('RACI map cleared'); draw(); }); };
      d.querySelectorAll('tr[data-rt]').forEach(function (tr) { var tid = tr.getAttribute('data-rt'), t = p.tasks.filter(function (x) { return x.id === tid; })[0];
        tr.querySelectorAll('[data-rs]').forEach(function (b) { b.onclick = function () { var sh = ppl.filter(function (x) { return x.id === b.getAttribute('data-rs'); })[0], cur = raciCell(p, t, sh).v, nx = RACI_ORDER[(RACI_ORDER.indexOf(cur) + 1) % RACI_ORDER.length];
          (p.raciMap[tid] = p.raciMap[tid] || {})[sh.id] = nx || '-'; dirty('RACI: ' + (sh.name || sh.role) + ' ' + (nx || 'none') + ' on ' + t.name); var sc = d.querySelector('.rc-scroll'), top = sc.scrollTop, left = sc.scrollLeft; draw(); var s2 = d.querySelector('.rc-scroll'); s2.scrollTop = top; s2.scrollLeft = left; }; }); });
    };
    draw();
  }
  function stakeholders() {
    var p = S.plan; p.stakeholders = p.stakeholders || [];
    var L = p.stakeholders, n = { R: 0, A: 0, C: 0, I: 0 }; L.forEach(function (x) { n[x.raci] = (n[x.raci] || 0) + 1; });
    var warn = !L.length ? '' : n.A === 0 ? '<p class="sk-warn">⚠ Nobody is <b>Accountable</b>. One person should sign off and have the final say.</p>'
      : n.A > 1 ? '<p class="sk-warn">⚠ ' + n.A + ' people are <b>Accountable</b>. Usually only one person is, so decisions don\'t stall.</p>' : '';
    var haveCust = L.some(function (x) { return S.job && x.name && x.name.toLowerCase() === String(S.job.name || '').toLowerCase(); });
    var mgr = (p.charter || {}).manager || '', haveMgr = !mgr || L.some(function (x) { return x.name.toLowerCase() === mgr.toLowerCase(); });
    $('#planBody').innerHTML = '<div class="card"><div class="card-h"><h2>Stakeholder list</h2><span class="sp"></span>' +
        (S.job && !haveCust ? '<button class="btn btn-sm" id="skCust">＋ Add the customer</button> ' : '') + (!haveMgr ? '<button class="btn btn-sm" id="skMgr">＋ Add the project manager</button> ' : '') +
        (pplAll().length ? '<select id="skPpl" style="width:auto;max-width:240px"><option value="">🧑‍🔧 Add from People…</option>' + pplPick() + '</select> ' : '') +
        (M.subs ? '<select id="skSub" style="width:auto;max-width:240px"><option value="">👷 Add a subbie…</option>' + subOpts() + '</select> ' : '') +
        '<button class="btn btn-sm" id="raciOpen" title="Who is R, A, C or I for each activity: a grid of activities and people">🧭 RACI map</button> <button class="btn btn-sm btn-gold" id="addStake">＋ Add stakeholder</button></div>' +
      '<p class="muted" style="margin:-4px 0 10px">Everyone with a part in this job and what they do, using <b>RACI</b>: ' +
        Object.keys(RACI).map(function (k) { return '<span class="raci raci-' + k + '">' + k + '</span> ' + RACI[k][0] + ' (' + RACI[k][1] + ')'; }).join(' · ') + '.</p>' +
      (L.length ? '<div class="sk-sum">' + Object.keys(RACI).map(function (k) { return '<span><span class="raci raci-' + k + '">' + k + '</span> ' + RACI[k][0] + ': <b>' + n[k] + '</b></span>'; }).join('') + raciStrip() + '</div>' + warn +
        '<div class="table-wrap"><table class="rt sk"><thead><tr><th>#</th><th>Name</th><th>Role</th><th>RACI</th><th>Contact number</th><th>Email</th><th></th></tr></thead><tbody>' +
        L.map(function (x, i) {
          var tel = String(x.phone || '').replace(/[^\d+]/g, '');
          return '<tr data-sid="' + esc(x.id) + '"><td class="muted">' + (i + 1) + '</td><td><input data-s="name" value="' + esc(x.name) + '" placeholder="Name" maxlength="120"></td>' +
            '<td><input data-s="role" value="' + esc(x.role) + '" placeholder="e.g. Site supervisor" maxlength="120" list="skRoles"></td>' +
            '<td><select data-s="raci" class="raci-sel raci-' + esc(x.raci) + '">' + Object.keys(RACI).map(function (k) { return '<option value="' + k + '"' + (x.raci === k ? ' selected' : '') + '>' + k + ' – ' + RACI[k][0] + '</option>'; }).join('') + '</select></td>' +
            '<td><div class="sk-c"><input data-s="phone" type="tel" value="' + esc(x.phone) + '" placeholder="04xx xxx xxx" maxlength="40">' + (tel ? '<a class="btn btn-sm" href="tel:' + esc(tel) + '" title="Call">📞</a>' : '') + '</div></td>' +
            '<td><div class="sk-c"><input data-s="email" type="email" value="' + esc(x.email) + '" placeholder="name@example.com" maxlength="160">' + (/@/.test(x.email || '') ? '<a class="btn btn-sm" href="mailto:' + esc(x.email) + '" title="Email">✉</a>' : '') + '</div></td>' +
            '<td class="nowrap"><button class="btn btn-sm" data-sup title="Move up"' + (i ? '' : ' disabled') + '>↑</button> <button class="btn btn-sm" data-sdel title="Delete">✕</button></td></tr>';
        }).join('') + '</tbody></table></div>' : '<div class="empty">No stakeholders yet. Add the customer, the project manager, the trades and anyone who signs off or needs to be kept informed.</div>') +
      '<datalist id="skRoles">' + ['Customer', 'Property owner', 'Project manager', 'Site supervisor', 'Builder', 'Carpenter', 'Electrician', 'Plumber', 'Tiler', 'Painter', 'Waterproofer', 'Certifier', 'Council', 'Strata manager', 'Tenant', 'Supplier', 'Insurer', 'Architect', 'Engineer'].map(function (r) { return '<option value="' + r + '">'; }).join('') + '</datalist>' +
      '<p class="muted" style="font-size:12.5px;margin:10px 0 0">Contact details stay in this plan. They are never sent to the AI.</p></div>';
    var B = $('#planBody'), find = function (el) { var id = el.closest('tr').getAttribute('data-sid'); return L.filter(function (x) { return x.id === id; })[0]; };
    B.querySelectorAll('tr[data-sid] [data-s]').forEach(function (el) {
      var k = el.getAttribute('data-s'), live = el.tagName === 'INPUT';
      el.addEventListener(live ? 'input' : 'change', function () { find(el)[k] = el.value; dirty(); if (!live) render(); });
      if (k === 'phone' || k === 'email') el.addEventListener('input', function () {   // update the call / email button in place (no redraw, so focus stays)
        var box = el.parentNode, a = box.querySelector('a'), v = el.value.trim(), href = k === 'phone' ? (v.replace(/[^\d+]/g, '') ? 'tel:' + v.replace(/[^\d+]/g, '') : '') : (/@/.test(v) ? 'mailto:' + v : '');
        if (!href) { if (a) a.remove(); return; }
        if (!a) { a = document.createElement('a'); a.className = 'btn btn-sm'; a.title = k === 'phone' ? 'Call' : 'Email'; a.textContent = k === 'phone' ? '📞' : '✉'; box.appendChild(a); }
        a.href = href;
      });
    });
    B.querySelectorAll('[data-sdel]').forEach(function (b) { b.onclick = function () { var x = find(b); p.stakeholders = L.filter(function (y) { return y !== x; }); dirty(); render(); }; });
    B.querySelectorAll('[data-sup]').forEach(function (b) { b.onclick = function () { var i = L.indexOf(find(b)); if (i > 0) { L.splice(i - 1, 0, L.splice(i, 1)[0]); dirty(); render(); } }; });
    var add = function (x) { L.push(Object.assign({ id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: '', role: '', raci: 'I', phone: '', email: '' }, x)); dirty(); render(); };
    $('#raciOpen').onclick = raciDrawer; var rs = $('#raciStrip'); if (rs) rs.onclick = raciDrawer;
    $('#addStake').onclick = function () { add({ raci: 'R' }); var i = document.querySelectorAll('#planBody [data-s=name]'); if (i.length) i[i.length - 1].focus(); };
    if ($('#skCust')) $('#skCust').onclick = function () { add({ name: S.job.name || '', role: 'Customer', raci: 'C', phone: S.job.phone || '', email: S.job.email || '' }); };
    if ($('#skSub')) $('#skSub').onchange = function () {
      var sb = M.subs.list().filter(function (x) { return x.id === this.value; }, this)[0]; if (!sb) return;
      add({ name: sb.business + (sb.contact ? ' (' + sb.contact + ')' : ''), role: M.subs.tradeName(sb.trade), raci: 'R', phone: sb.phone || '', email: sb.email || '', sub: sb.id });
      if (sb.comp && /expired/.test(sb.comp.worst)) toast('Heads up: ' + sb.business + ' has expired papers (' + sb.comp.problems.join(', ') + ')');
    };
    if ($('#skPpl')) $('#skPpl').onchange = function () {
      var pe = pplAll().filter(function (x) { return x.id === this.value; }, this)[0]; if (!pe) return;
      add({ name: pe.name, role: pe.role || (pe.type === 'Contractor' ? 'Contractor' : 'Employee'), raci: /manager|director/i.test(pe.role || '') ? 'A' : 'R', phone: pe.phone || '', email: pe.email || '', person: pe.id });
      if (pe.comp && pe.comp.worst === 'expired') toast('Heads up: ' + pe.name + ' has expired tickets (' + pe.comp.problems.join(', ') + ')');
    };
    pplLoad();
    if (M.subs && !S.subsLoaded) { S.subsLoaded = true; M.subs.load().then(function () { if (S.tab === 'stake' && $('#skSub')) render(); }).catch(function () {}); }
    if ($('#skMgr')) $('#skMgr').onclick = function () { add({ name: mgr, role: 'Project manager', raci: 'A' }); };
  }

  /* ---------- v53: 📜 Contracts (plain uploader) ---------- */
  // One line per contract: the type, who it is with, and the signed contract (Word or PDF). The details are read by
  // 🧠 Project Intelligence, so ask there ("What are the payment terms in the plumbing sub-contract?").
  var CT_TYPES = [['Customer', '🏠', 'Customer contract'], ['Sub-contractor', '👷', 'Sub-contractor'], ['Supply', '📦', 'Supply'], ['Consultant', '📐', 'Consultant']];
  function contractsTab() {
    var p = S.plan; p.contracts = p.contracts || [];
    if (!S.intel || S.intel.core !== S.core) {
      $('#planBody').innerHTML = '<div class="empty">Loading contracts…</div>';
      api('intelGet', { core: S.core }).then(function (d) { S.intel = { core: S.core, docs: d.docs, log: d.log, open: {} }; if (S.tab === 'contracts') contractsTab(); }).catch(fail);
      return;
    }
    var subs = (p.stakeholders || []).filter(function (x) { return x.sub; }), ty = S.ctType || 'Customer', docs = S.intel.docs;
    var who = ty === 'Customer' ? '<input value="' + esc(S.job.name || 'Customer') + '" disabled>'
      : ty === 'Sub-contractor' ? (subs.length ? '<select id="ctWho"><option value="">Choose the sub-contractor…</option>' + subs.map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.name) + (x.role ? ' · ' + esc(x.role) : '') + '</option>'; }).join('') + '</select>'
        : '<input disabled value="No sub-contractors yet: add them on the Stakeholders tab (👷 Add a subbie)">')
      : '<input id="ctWho" placeholder="' + (ty === 'Supply' ? 'Supplier name, e.g. Western Tiles Direct' : 'Consultant, e.g. Hills Certifiers') + '" maxlength="120">';
    var row = function (c) {
      var d = docs.filter(function (x) { return x.id === (c.docs || [])[0]; })[0], T = CT_TYPES.filter(function (x) { return x[0] === c.type; })[0] || CT_TYPES[3];
      return '<tr data-ctid="' + esc(c.id) + '"><td class="nowrap">' + T[1] + ' ' + esc(T[2]) + '</td><td><b>' + esc(c.party) + '</b></td>' +
        '<td>' + (d ? esc(d.name) + '<br><small class="muted">' + (d.pages ? pl(d.pages, 'page') + ' · ' : '') + (d.words || 0).toLocaleString('en-AU') + ' words</small>' : '<span class="muted">document missing</span>') + '</td>' +
        '<td class="nowrap">' + dmy(new Date((c.at || Date.now()) + 10 * 3600e3).toISOString().slice(0, 10)) + '</td>' +
        '<td class="nowrap">' + (d ? '<button class="btn btn-sm" data-ctdl title="Download">⬇</button> <button class="btn btn-sm btn-ai" data-ctask title="Ask Project Intelligence about this contract">🧠 Ask</button> ' : '') + '<button class="btn btn-sm" data-ctdel title="Delete">✕</button></td></tr>';
    };
    $('#planBody').innerHTML = '<div class="card"><div class="card-h"><h2>📜 Contracts</h2></div>' +
      '<p class="muted" style="margin:-4px 0 12px">Upload the signed contracts for this job (Word or PDF). Ask <b>🧠 Project Intelligence</b> about what is in them: price, payment stages, dates, variations, defects period and more.</p>' +
      '<div class="ct-add"><select id="ctType">' + CT_TYPES.map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === ty ? ' selected' : '') + '>' + x[1] + ' ' + x[2] + '</option>'; }).join('') + '</select>' + who +
        '<label class="btn btn-gold" for="ctFile" id="ctUpBtn">⬆ Upload contract (Word or PDF)</label><input type="file" id="ctFile" hidden accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"></div><div id="ctMsg"></div>' +
      (p.contracts.length ? '<div class="table-wrap"><table class="ct-list"><thead><tr><th>Type</th><th>With</th><th>Contract</th><th>Uploaded</th><th></th></tr></thead><tbody>' + p.contracts.map(row).join('') + '</tbody></table></div>'
        : '<div class="empty">No contracts yet. Choose the type, who it is with, and upload the signed contract.</div>') + '</div>';
    $('#ctType').onchange = function () { S.ctType = this.value; contractsTab(); };
    $('#ctFile').onchange = function () { var f = this.files[0]; this.value = ''; if (f) ctUpload(f); };
    $('#planBody').querySelectorAll('tr[data-ctid]').forEach(function (tr) {
      var c = p.contracts.filter(function (x) { return x.id === tr.getAttribute('data-ctid'); })[0], id = (c.docs || [])[0];
      var q = function (s) { return tr.querySelector(s); };
      if (q('[data-ctdl]')) q('[data-ctdl]').onclick = function () { api('intelDocFile', { core: S.core, id: id }).then(function (r) {
        var bin = atob(r.file), u8 = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        var url = URL.createObjectURL(new Blob([u8], { type: r.type })), a = document.createElement('a'); a.href = url; a.download = r.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 5000); }).catch(fail); };
      if (q('[data-ctask]')) q('[data-ctask]').onclick = function () { S.piDraft = 'Summarise the ' + (c.type === 'Customer' ? 'customer contract' : c.type.toLowerCase() + ' contract with ' + c.party) + ': price, payment stages, key dates, variations, defects period and anything we must watch.'; location.hash = '#plan/' + S.core + '/intel'; };
      q('[data-ctdel]').onclick = function () { M.confirmBox('Delete this contract?', 'The ' + c.type.toLowerCase() + ' contract with ' + c.party + ' and its document are removed from this job.', 'Delete').then(function (y) {
        if (!y) return; (id ? api('intelDocDelete', { core: S.core, id: id }) : Promise.resolve()).then(function () {
          S.intel.docs = S.intel.docs.filter(function (x) { return x.id !== id; }); p.contracts = p.contracts.filter(function (x) { return x !== c; }); dirty(); toast('Contract deleted'); contractsTab(); }).catch(fail); }); };
    });
  }
  function ctUpload(f) {
    var p = S.plan, ty = S.ctType || 'Customer', msg = $('#ctMsg'), party = '', ref = '';
    if (!/\.(pdf|docx)$/i.test(f.name)) return toast('Contracts must be a Word (.docx) or PDF file.', true);
    if (ty === 'Customer') { party = S.job.name || 'Customer'; ref = S.core; }
    else if (ty === 'Sub-contractor') { var sid = ($('#ctWho') || {}).value, x = (p.stakeholders || []).filter(function (y) { return y.id === sid; })[0]; if (!x) return toast('Choose the sub-contractor first', true); party = x.name; ref = x.sub; }
    else { party = (($('#ctWho') || {}).value || '').trim(); if (!party) return toast('Type who the contract is with first', true); }
    if (msg) msg.innerHTML = '<p class="ask-think" style="margin:8px 0">Reading “' + esc(f.name) + '”…</p>';
    var id = 'c' + Date.now().toString(36);
    piExtract(f).then(function (x) {
      if (!x.text || x.text.replace(/\[page \d+\]/g, '').trim().length < 20) throw new Error('No text found in “' + f.name + '”. If it is a scanned PDF, save it as a text PDF or Word file first.');
      var send = function (b64) { return api('intelUpload', { core: S.core, name: f.name, type: f.type, size: f.size, pages: x.pages, text: x.text, file: b64, kind: 'Contract', contractId: id }); };
      if (f.size > 3.5 * 1024 * 1024) return send('');
      return new Promise(function (res) { var rd = new FileReader(); rd.onload = function () { res(String(rd.result).replace(/^data:[^,]*,/, '')); }; rd.readAsDataURL(f); }).then(send);
    }).then(function (r) {
      S.intel.docs.push(r.doc);
      p.contracts.push({ id: id, type: ty, party: party, partyRef: ref, docs: [r.doc.id], at: Date.now() });
      dirty(); toast('Contract uploaded'); contractsTab();
    }).catch(function (e) { if (msg) msg.innerHTML = ''; toast(e.message, true); });
  }

  /* ---------- v57: 🦺 SWMS (Safe Work Method Statement) ---------- */
  // Written by the AI from this plan, then checked and changed in its own editor (#swms/<job>) and downloaded as Word or PDF.
  function swmsTab() {
    var B = $('#planBody'), core = S.core;
    B.innerHTML = '<div class="empty">Loading the SWMS…</div>';
    api('swmsGet', { core: core }).then(function (d) {
      if (S.tab !== 'swms' || S.core !== core) return;
      var w = d.swms, H = {}; d.hrcw.forEach(function (h) { H[h[0]] = h[1]; });
      var when = function (ms) { return ms ? new Date(ms).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Sydney' }) : ''; };
      var high = w ? w.steps.filter(function (s) { return /High|Extreme/.test(s.risk); }).length : 0;
      B.innerHTML = '<div class="card sw-card"><div class="card-h"><h2>🦺 Safe Work Method Statement (SWMS)</h2><span class="sp"></span>' + (w ? '<span class="sw-status-chip sw-' + w.status.toLowerCase() + '">' + w.status + ' · version ' + w.version + '</span>' : '') + '</div>' +
        '<p class="muted" style="margin:-4px 0 12px">Needed before high-risk construction work starts (WHS Regulation 2017 NSW, Part 6.3). The AI writes it from this plan: the high-risk work involved, every job step with its hazards, risk and control measures, PPE, plant, licences, emergency arrangements and a sign-on sheet. Then open it to check and change anything, and download it as Word or PDF. You can also ask 🧠 Project Intelligence: “Generate a SWMS for this project”.</p>' +
        (w ? '<div class="sw-sum"><div><b>' + w.steps.length + '</b><span>job steps</span></div><div><b>' + high + '</b><span>high or extreme before controls</span></div><div><b>' + w.hrcw.length + '</b><span>high-risk work categories</span></div><div><b>' + w.signon.filter(function (s) { return s.name; }).length + '</b><span>workers signed on</span></div></div>' +
            (w.hrcw.length ? '<div class="sw-hr">' + w.hrcw.map(function (k) { return '<span class="sw-chip">⚠ ' + esc(H[k] || k) + '</span>'; }).join('') + '</div>' : '') +
            '<p class="muted" style="font-size:12.5px">' + (w.edited ? 'Last changed ' + when(w.updated) : 'Written by the AI ' + when(w.generated) + ': not checked yet') + '</p>' +
            '<div class="row" style="gap:6px"><a class="btn btn-gold" href="#swms/' + esc(core) + '">🦺 Open the SWMS (check and change)</a><button class="btn" data-swdl="docx">⬇ Word</button><button class="btn" data-swdl="pdf">⬇ PDF</button><span class="sp"></span><button class="btn btn-sm" id="swAgain">✨ Write again from the plan</button></div>'
          : '<button class="btn btn-gold" id="swGo">✨ Write the SWMS from this plan</button>') + '<p id="swOut" class="muted" style="margin:10px 0 0"></p></div>';
      B.querySelectorAll('[data-swdl]').forEach(function (b) { b.onclick = function () { M.swms.download(core, b.getAttribute('data-swdl')).catch(fail); }; });
      var run = function (btn) {
        btn.disabled = true;
        M.swms.generate(core, function (m) { $('#swOut').innerHTML = '<span class="ask-think">' + esc(m) + '</span>'; })
          .then(function (r) { toast('SWMS written (' + (r.tokens || 0) + ' tokens)'); location.hash = '#swms/' + core; })
          .catch(function (e) { btn.disabled = false; $('#swOut').innerHTML = '<span class="bad">' + esc(e.message) + '</span>'; });
      };
      var g = $('#swGo'); if (g) g.onclick = function () { run(g); };
      var a = $('#swAgain'); if (a) a.onclick = function () { M.confirmBox('Write the SWMS again?', 'The AI writes a new version from the plan as it is now. Changes made to the current version are replaced.', 'Write again').then(function (y) { if (y) run(a); }); };
    }).catch(fail);
  }

  /* ---------- v60: 📞 Comms: set up meetings (Google Meet, Teams, Zoom), the meeting log, transcripts and their impact ---------- */
  var MST = ['Scheduled', 'Took place', 'Rescheduled', 'Cancelled'];
  var LVL_C = { None: 'lv-none', Low: 'lv-low', Medium: 'lv-med', High: 'lv-high' };
  var AREA_N = [['scope', '🎯 Scope'], ['time', '⏱ Time'], ['cost', '💲 Cost'], ['quality', '✅ Quality'], ['risk', '⚠ Risk'], ['issues', '❗ Issues'], ['stakeholders', '👥 Stakeholders']];
  function cmDraft() {
    var p = S.plan, plat = 'google'; try { plat = localStorage.getItem('mbsMeetPlat') || 'google'; } catch (e) {}
    return { platform: PLAT[plat] ? plat : 'google', title: 'Project meeting: ' + p.name, date: addWork(nextWork(today()), 1), start: '10:00', minutes: 45,
      attendees: (p.stakeholders || []).filter(function (x) { return /@/.test(x.email || ''); }).map(function (x) { return x.id; }), guests: [], agenda: '', link: '' };
  }
  function cmState() { if (!S.comms || S.comms.core !== S.core) S.comms = { core: S.core, d: cmDraft(), view: '', an: {}, busy: '' }; return S.comms; }
  function cmWhen(m) { return dmy(m.date) + ' · ' + m.start; }
  function cmGuestNote(e) { return '<span class="cm-gnote">Not in the Stakeholder register</span>'; }
  function commsTab() {
    var B = $('#planBody'), p = S.plan, C = cmState(), d = C.d;
    p.meetings = p.meetings || [];
    p.meetings.forEach(function (m) { if (MST.indexOf(m.status) < 0) m.status = 'Scheduled'; if (!PLAT[m.platform]) m.platform = 'google'; m.was = m.was || []; m.guests = m.guests || []; m.attendees = m.attendees || []; });
    if (!S.commsSetup) { B.innerHTML = '<div class="empty">Loading Comms…</div>'; api('commsSetup', {}).then(function (r) { S.commsSetup = r; }).catch(function () { S.commsSetup = {}; }).then(function () { if (S.tab === 'comms') commsTab(); }); return; }
    if ((!S.intel || S.intel.core !== S.core) && !S.cmIntel) { var cmc = S.core; S.cmIntel = cmc; api('intelGet', { core: cmc }).then(function (r) { if (S.core === cmc) S.intel = { core: cmc, docs: r.docs, log: r.log, open: {} }; }).catch(function () {}).then(function () { S.cmIntel = ''; if (S.tab === 'comms') commsTab(); }); }
    var SU = S.commsSetup, sh = p.stakeholders || [], L = piMeetLinks(Object.assign({ id: 'draft' }, d)), direct = !!SU[d.platform];
    var log = p.meetings.slice().sort(function (a, b) { return (b.date + b.start).localeCompare(a.date + a.start); });
    var form = '<div class="card cm-new"><div class="card-h"><h2>📞 Set up a meeting</h2></div>' +
      '<p class="muted" style="margin:-4px 0 10px">Pick the platform and the people from the Stakeholder register. Every meeting goes into the meeting log below, where you mark what happened and upload the transcript for the AI to work out what it means for the plan.</p>' +
      '<div class="cm-plats">' + ['google', 'teams', 'zoom'].map(function (k) { return '<button type="button" class="cm-plat' + (d.platform === k ? ' on' : '') + '" data-plat="' + k + '"><b>' + PLAT[k][1] + ' ' + PLAT[k][0] + '</b><small>' + (SU[k] ? '✓ Connected: created directly' : k === 'google' ? 'Opens Google Calendar with Meet' : k === 'teams' ? 'Opens a new Teams meeting' : 'Opens Zoom to schedule') + '</small></button>'; }).join('') + '</div>' +
      '<div class="form cm-form"><label class="full">Title<input id="cmTitle" maxlength="160" value="' + esc(d.title) + '"></label><label>Date<input type="date" id="cmDate" value="' + esc(d.date) + '"></label><label>Start<input type="time" id="cmStart" value="' + esc(d.start) + '"></label>' +
        '<label>Length<select id="cmMin">' + [15, 30, 45, 60, 90, 120].map(function (n) { return '<option value="' + n + '"' + (d.minutes === n ? ' selected' : '') + '>' + n + ' min</option>'; }).join('') + '</select></label></div>' +
      '<div class="cm-sec"><div class="row" style="gap:8px"><b>Who</b><span class="muted" style="font-size:12.5px">from the 👥 Stakeholder register</span><span class="sp"></span>' + (sh.length ? '<button class="btn btn-sm" id="cmAll" type="button">All</button><button class="btn btn-sm" id="cmNone" type="button">None</button>' : '') + '</div>' +
        (sh.length ? '<div class="cm-who">' + sh.map(function (x) { var em = /@/.test(x.email || ''); return '<label class="sc-cb' + (em ? '' : ' cm-noem') + '"><input type="checkbox" data-cmw="' + esc(x.id) + '"' + (d.attendees.indexOf(x.id) >= 0 ? ' checked' : '') + '> <span><b>' + esc(x.name || x.role) + '</b> <span class="raci raci-' + x.raci + '">' + x.raci + '</span><br><small class="muted">' + esc(x.role) + (em ? ' · ' + esc(x.email) : ' · no email: add it on Stakeholders') + '</small></span></label>'; }).join('') + '</div>'
          : '<p class="muted" style="margin:6px 0">No stakeholders yet. Add the people on the <a href="#plan/' + esc(S.core) + '/stake">👥 Stakeholders</a> tab, or type their email below.</p>') + '</div>' +
      '<div class="cm-sec"><b>Someone not on the list?</b><div class="inline-form" style="margin-top:6px"><input type="email" id="cmGuest" placeholder="name@company.com.au"><button class="btn btn-sm" id="cmGuestAdd" type="button">＋ Add guest</button></div>' +
        (d.guests.length ? '<div class="cm-guests">' + d.guests.map(function (e, i) { return '<div class="cm-guest"><span>✉ ' + esc(e) + '</span>' + cmGuestNote(e) + '<span class="sp"></span><button class="btn btn-sm btn-gold" data-cmreg="' + i + '" type="button">＋ Add to Stakeholders</button><button class="btn btn-sm" data-cmgx="' + i + '" type="button" title="Remove">✕</button></div>'; }).join('') + '</div>' +
          '<p class="sk-warn" style="margin:8px 0 0">💡 Best to add everyone who takes part to the Stakeholder register (name, role and RACI), so the register stays a true record of who is involved in this project.</p>' : '') + '</div>' +
      '<label class="cm-sec" style="display:block"><b>Agenda</b><textarea id="cmAgenda" rows="4" placeholder="One item per line, e.g. Progress against the plan&#10;Lead times and deliveries&#10;Risks and issues&#10;Next steps">' + esc(d.agenda) + '</textarea></label>' +
      (direct ? '' : '<label class="cm-sec" style="display:block"><b>Join link</b> <small class="muted">(optional: paste it once ' + esc(PLAT[d.platform][0]) + ' has made the meeting)</small><input id="cmLink" placeholder="https://…" value="' + esc(d.link) + '"></label>') +
      (L.missing.length ? '<p class="sk-warn" style="margin:8px 0 0">No email for ' + esc(L.missing.map(function (x) { return x.name || x.role; }).join(', ')) + ': add it on the Stakeholders tab to invite them.</p>' : '') +
      '<div class="row" style="gap:6px;margin-top:10px"><button class="btn btn-gold" id="cmGo" type="button">' + (direct ? '📞 Create the ' + esc(PLAT[d.platform][0]) + ' meeting' : '📅 Open ' + esc(d.platform === 'google' ? 'Google Calendar' : PLAT[d.platform][0]) + ' and add to the log') + '</button>' +
        '<button class="btn btn-sm" id="cmIcs" type="button">⬇ Invite (.ics)</button><a class="btn btn-sm" id="cmMail" href="' + esc(L.mail) + '">✉ Email the invite</a><span class="muted" style="font-size:12.5px">' + (L.emails.length === 1 ? '1 person' : L.emails.length + ' people') + ' invited</span></div>' +
      '<p class="muted" style="font-size:12px;margin:8px 0 0">' + (direct ? 'Created straight in ' + esc(PLAT[d.platform][0]) + ' (connected in Netlify); the join link is saved on the log.' + (d.platform === 'teams' ? ' Outlook emails the invites.' : ' Send the invite with ✉ or the .ics file.')
        : 'Not connected, so it opens ' + esc(PLAT[d.platform][0]) + ' with the details filled in' + (d.platform === 'zoom' ? ' (Zoom\'s page doesn\'t take the details: copy them from the invite)' : '') + '. To create meetings directly, add the ' + (d.platform === 'teams' ? 'Microsoft Teams (MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_ORGANIZER)' : d.platform === 'zoom' ? 'Zoom (ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET)' : 'Teams or Zoom') + ' keys in Netlify.') + '</p></div>';
    var rows = log.map(function (m) {
      var who = piPeople(m.attendees), g = (m.guests || []).length, busy = C.busy === m.id;
      return '<tr data-mid="' + esc(m.id) + '" class="' + (C.view === m.id ? 'on ' : '') + 'cm-' + m.status.replace(' ', '').toLowerCase() + '"><td class="nowrap"><b>' + esc(cmWhen(m)) + '</b><br><small class="muted">' + m.minutes + ' min' + ((m.was || []).length ? ' · moved from ' + esc(m.was[m.was.length - 1]) : '') + '</small></td>' +
        '<td><b>' + esc(m.title) + '</b>' + (m.link ? '<br><a href="' + esc(m.link) + '" target="_blank" rel="noopener" class="cm-join">🔗 Join</a>' : '') + '</td><td class="nowrap">' + PLAT[m.platform || 'google'][1] + ' ' + esc(PLAT[m.platform || 'google'][0]) + '</td>' +
        '<td title="' + esc(who.map(function (x) { return x.name || x.role; }).concat(m.guests || []).join(', ')) + '">' + pl(who.length, 'stakeholder') + (g ? '<br><small class="cm-gnote">+ ' + pl(g, 'guest') + ' not in the register</small>' : '') + '</td>' +
        '<td><select data-mst class="cm-st">' + MST.map(function (s) { return '<option' + (m.status === s ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></td>' +
        '<td>' + (m.doc ? '<span class="cm-tx">🎙 ' + esc(cmDocName(m.doc)) + '</span> <button class="btn btn-sm" data-mtdl title="Download the transcript">⬇</button>' : '<label class="btn btn-sm" title="Word, PDF, text or the Teams / Zoom .vtt transcript">⬆ Transcript<input type="file" data-mtx hidden accept=".pdf,.docx,.txt,.md,.vtt,.srt"></label>') + '</td>' +
        '<td class="nowrap">' + (busy ? '<span class="ask-think">Analysing…</span>' : m.doc ? (m.analysed ? '<button class="btn btn-sm btn-gold" data-mview>📊 Impact</button> <button class="btn btn-sm" data-man title="Analyse again">↻</button>' : '<button class="btn btn-sm btn-gold" data-man>✨ Analyse impact</button>') : '<span class="muted" style="font-size:12px">upload the transcript</span>') + (m.applied ? '<br><small class="cm-ok">✓ applied to the plan</small>' : '') + '</td>' +
        '<td class="nowrap acts"><button class="btn btn-sm" data-mics title="Invite (.ics)">⬇</button><a class="btn btn-sm" data-mmail title="Email" href="' + esc(piMeetLinks(m).mail) + '">✉</a><button class="btn btn-sm" data-mdel title="Delete">✕</button></td></tr>';
    }).join('');
    var logH = '<div class="card cm-log"><div class="card-h"><h2>🗒 Meeting log</h2><span class="sp"></span><span class="muted">' + pl(log.length, 'meeting') + (log.filter(function (m) { return m.doc; }).length ? ' · ' + pl(log.filter(function (m) { return m.doc; }).length, 'transcript') : '') + '</span></div>' +
      (log.length ? '<div class="table-wrap"><table class="pi-tbl cm-tbl"><thead><tr><th>When</th><th>Meeting</th><th>Platform</th><th>Who</th><th>Status</th><th>Transcript</th><th>AI: impact on the plan</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
        '<p class="muted" style="font-size:12px;margin:8px 0 0">Meetings set up here or by 🧠 Project Intelligence are logged automatically. You can also ask Project Intelligence: “Analyse my meeting on ' + dmy(log[0].date) + ', summarise the outcome and the impact on the project”.</p>'
        : '<div class="empty">No meetings yet. Set one up above.</div>') + '</div>';
    B.innerHTML = '<div class="cm-wrap">' + form + logH + '<div id="cmView"></div></div>';
    commsWire(B, L);
    if (C.view) cmShow(C.view);
  }
  function cmDocName(id) { var d = S.intel && S.intel.core === S.core ? S.intel.docs.filter(function (x) { return x.id === id; })[0] : null; return d ? d.name : 'transcript'; }
  function commsWire(B, L) {
    var p = S.plan, C = S.comms, d = C.d;
    var keep = function () { d.title = $('#cmTitle').value; d.date = $('#cmDate').value; d.start = $('#cmStart').value; d.minutes = +$('#cmMin').value; d.agenda = $('#cmAgenda').value; if ($('#cmLink')) d.link = $('#cmLink').value.trim(); };
    var refresh = function () { keep(); var L2 = piMeetLinks(Object.assign({ id: 'draft' }, d)); $('#cmMail').href = L2.mail; };
    ['#cmTitle', '#cmDate', '#cmStart', '#cmMin', '#cmAgenda', '#cmLink'].forEach(function (k) { var el = $(k); if (el) el.addEventListener('input', refresh); if (el) el.addEventListener('change', refresh); });
    B.querySelectorAll('[data-plat]').forEach(function (b) { b.onclick = function () { keep(); d.platform = b.getAttribute('data-plat'); try { localStorage.setItem('mbsMeetPlat', d.platform); } catch (e) {} commsTab(); }; });
    B.querySelectorAll('[data-cmw]').forEach(function (c) { c.onchange = function () { keep(); var id = c.getAttribute('data-cmw'); d.attendees = d.attendees.filter(function (x) { return x !== id; }); if (c.checked) d.attendees.push(id); commsTab(); }; });
    var all = $('#cmAll'); if (all) all.onclick = function () { keep(); d.attendees = (p.stakeholders || []).map(function (x) { return x.id; }); commsTab(); };
    var none = $('#cmNone'); if (none) none.onclick = function () { keep(); d.attendees = []; commsTab(); };
    var addG = function () {
      keep(); var e = $('#cmGuest').value.trim().toLowerCase();
      if (!/^[^\s@<>,;]+@[^\s@<>,;]+\.[a-z]{2,}$/i.test(e)) return toast('Type a full email address', true);
      var st = (p.stakeholders || []).filter(function (x) { return (x.email || '').toLowerCase() === e; })[0];
      if (st) { if (d.attendees.indexOf(st.id) < 0) d.attendees.push(st.id); toast((st.name || e) + ' is already in the Stakeholder register: ticked'); commsTab(); return; }
      if (d.guests.indexOf(e) < 0) d.guests.push(e); commsTab(); toast('Guest added. Best to add them to the Stakeholder register too.');
    };
    $('#cmGuestAdd').onclick = addG; $('#cmGuest').onkeydown = function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); addG(); } };
    B.querySelectorAll('[data-cmgx]').forEach(function (b) { b.onclick = function () { keep(); d.guests.splice(+b.getAttribute('data-cmgx'), 1); commsTab(); }; });
    B.querySelectorAll('[data-cmreg]').forEach(function (b) { b.onclick = function () { keep(); var e = d.guests[+b.getAttribute('data-cmreg')]; cmRegister(e, function (st) { d.guests = d.guests.filter(function (x) { return x !== e; }); d.attendees.push(st.id); commsTab(); }); }; });
    $('#cmIcs').onclick = function () { keep(); piIcs(Object.assign({ id: 'm' + Date.now().toString(36) }, d)); };
    $('#cmGo').onclick = function () {
      keep();
      if (!d.title.trim()) return toast('Give the meeting a title', true);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return toast('Pick a date', true);
      if (d.link && !/^https:\/\//.test(d.link)) return toast('The join link must start with https://', true);
      var m = { id: 'm' + Date.now().toString(36), title: d.title.trim(), date: d.date, start: d.start || '10:00', minutes: d.minutes, attendees: d.attendees.slice(), guests: d.guests.slice(), agenda: d.agenda.trim(), platform: d.platform, link: d.link, status: 'Scheduled', was: [], at: Date.now() };
      var Lm = piMeetLinks(m), save = function (msg) { p.meetings.push(m); dirty('meeting set up: ' + m.title); C.d = cmDraft(); C.d.platform = m.platform; commsTab(); toast(msg); };
      if (S.commsSetup[d.platform]) {
        var btn = $('#cmGo'); btn.disabled = true; btn.textContent = 'Creating…';
        api('commsCreate', { core: S.core, platform: m.platform, title: m.title, date: m.date, start: m.start, minutes: m.minutes, agenda: m.agenda, emails: Lm.emails }).then(function (r) {
          m.link = r.link || ''; m.extId = r.extId || ''; m.passcode = r.passcode || '';
          save(PLAT[m.platform][0] + ' meeting created' + (r.invited ? ': invites sent' : ': send the invite with ✉ or ⬇') + ', and added to the meeting log');
        }).catch(function (e) { btn.disabled = false; btn.textContent = 'Try again'; fail(e); });
        return;
      }
      window.open(Lm.open, '_blank', 'noopener');
      save('Added to the meeting log. Finish it in ' + PLAT[m.platform][0] + (m.platform === 'google' ? ' (press Save there)' : '') + '.');
    };
    // the meeting log
    B.querySelectorAll('tr[data-mid]').forEach(function (tr) {
      var m = p.meetings.filter(function (x) { return x.id === tr.getAttribute('data-mid'); })[0]; if (!m) return;
      var q = function (k) { return tr.querySelector(k); };
      q('[data-mst]').onchange = function () {
        var v = this.value, old = m.status;
        if (v === 'Rescheduled') { this.value = old; return cmReschedule(m); }
        m.status = v; dirty('meeting ' + m.title + ': ' + v); commsTab();
        toast(v === 'Cancelled' ? 'Marked cancelled. Use ✉ to let everyone know (the email and the .ics now say cancelled).' : v === 'Took place' ? 'Marked as held. Upload the transcript to see what it means for the plan.' : 'Status: ' + v);
      };
      q('[data-mics]').onclick = function () { piIcs(m); };
      q('[data-mdel]').onclick = function () {
        M.confirmBox('Delete this meeting?', '“' + esc(m.title) + '” on ' + esc(cmWhen(m)) + ' is taken off the meeting log' + (m.doc ? ', with its transcript and analysis' : '') + '. Changes already applied to the plan stay.', 'Delete', true).then(function (y) {
          if (!y) return;
          if (m.doc) { api('intelDocDelete', { core: S.core, id: m.doc }).catch(function () {}); if (S.intel && S.intel.core === S.core) S.intel.docs = S.intel.docs.filter(function (x) { return x.id !== m.doc; }); api('commsForget', { core: S.core, id: m.id }).catch(function () {}); }
          p.meetings = p.meetings.filter(function (x) { return x !== m; }); if (C.view === m.id) C.view = ''; dirty('meeting deleted'); commsTab();
        });
      };
      var tx = q('[data-mtx]'); if (tx) tx.onchange = function () { var f = this.files[0]; this.value = ''; if (f) cmTranscript(m, f); };
      var tdl = q('[data-mtdl]'); if (tdl) tdl.onclick = function () { api('intelDocFile', { core: S.core, id: m.doc }).then(function (r) {
        var bin = atob(r.file), u8 = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        var url = URL.createObjectURL(new Blob([u8], { type: r.type })), a = document.createElement('a'); a.href = url; a.download = r.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 5000); }).catch(fail); };
      var an = q('[data-man]'); if (an) an.onclick = function () { cmAnalyse(m); };
      var vw = q('[data-mview]'); if (vw) vw.onclick = function () { C.view = C.view === m.id ? '' : m.id; commsTab(); if (C.view) setTimeout(function () { var v = $('#cmView'); if (v) v.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 50); };
    });
  }
  function cmRegister(email, then) {
    var raci = ['R', 'A', 'C', 'I'];
    M.modal('<h2>＋ Add to the Stakeholder register</h2><p class="muted" style="margin:4px 0 10px">So the register stays a true record of who is involved in this project.</p><div class="form"><label>Name<input id="crName" maxlength="120" value="' + esc(email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); })) + '"></label>' +
      '<label>Role<input id="crRole" maxlength="120" placeholder="e.g. Tiling supplier, Certifier"></label><label>RACI<select id="crRaci">' + raci.map(function (r) { return '<option' + (r === 'C' ? ' selected' : '') + '>' + r + '</option>'; }).join('') + '</select></label><label>Phone<input id="crPhone" maxlength="40"></label><label class="full">Email<input id="crEmail" value="' + esc(email) + '" readonly></label></div>' +
      '<p class="muted" style="font-size:12px">R Responsible (does the work) · A Accountable (signs off) · C Consulted · I Informed</p><div class="actions" style="justify-content:flex-end"><button class="btn" data-close type="button">Cancel</button><button class="btn btn-gold" id="crSave" type="button">Add to Stakeholders</button></div>');
    setTimeout(function () { var r = $('#crRole'); if (r) r.focus(); }, 30);
    $('#crSave').onclick = function () {
      var p = S.plan, st = { id: 's' + Date.now().toString(36), name: $('#crName').value.trim(), role: $('#crRole').value.trim(), raci: $('#crRaci').value, phone: $('#crPhone').value.trim(), email: email, sub: '' };
      if (!st.name) return toast('Type their name', true);
      (p.stakeholders = p.stakeholders || []).push(st); dirty('stakeholder added from Comms: ' + st.name); M.closeModal(); toast(st.name + ' added to the Stakeholder register'); then(st);
    };
  }
  function cmReschedule(m) {
    M.modal('<h2>↔ Reschedule</h2><p class="muted" style="margin:4px 0 10px">“' + esc(m.title) + '”, now ' + esc(cmWhen(m)) + '.</p><div class="form"><label>New date<input type="date" id="rsDate" value="' + esc(m.date) + '"></label><label>Start<input type="time" id="rsStart" value="' + esc(m.start) + '"></label></div>' +
      '<div class="actions" style="justify-content:flex-end"><button class="btn" data-close type="button">Cancel</button><button class="btn btn-gold" id="rsSave" type="button">Save the new time</button></div>');
    $('#rsSave').onclick = function () {
      var nd = $('#rsDate').value, ns = $('#rsStart').value || m.start;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(nd)) return toast('Pick the new date', true);
      if (nd === m.date && ns === m.start) return toast('That is the same time', true);
      (m.was = m.was || []).push(cmWhen(m)); m.date = nd; m.start = ns; m.status = 'Rescheduled'; dirty('meeting rescheduled: ' + m.title); M.closeModal();
      var Lm = piMeetLinks(m);
      M.modal('<h2>✓ Moved to ' + esc(cmWhen(m)) + '</h2><p>Let everyone know the new time:</p><div class="row" style="gap:6px">' + (m.platform !== 'zoom' || !m.link ? '<a class="btn btn-gold" target="_blank" rel="noopener" href="' + esc(Lm.open) + '">📅 Open ' + esc(m.platform === 'google' ? 'Google Calendar' : PLAT[m.platform][0]) + '</a>' : '') +
        '<button class="btn" id="rsIcs" type="button">⬇ New invite (.ics)</button><a class="btn" href="' + esc(Lm.mail) + '">✉ Email the new time</a></div><div class="actions" style="justify-content:flex-end"><button class="btn" data-close type="button">Done</button></div>');
      $('#rsIcs').onclick = function () { piIcs(m); };
      commsTab();
    };
  }
  function cmTranscript(m, f) {
    var core = S.core; toast('Reading “' + f.name + '”…');
    piExtract(f).then(function (x) {
      if (!x.text || x.text.replace(/\[page \d+\]/g, '').trim().length < 40) throw new Error('No text found in “' + f.name + '”. If it is a scanned PDF, save it as a text PDF or Word file first.');
      var send = function (b64) { return api('intelUpload', { core: core, name: f.name, type: f.type, size: f.size, pages: x.pages, text: x.text, file: b64, kind: 'Meeting transcript' }); };
      if (f.size > 3.5 * 1024 * 1024) return send('');
      return new Promise(function (res) { var rd = new FileReader(); rd.onload = function () { res(String(rd.result).replace(/^data:[^,]*,/, '')); }; rd.readAsDataURL(f); }).then(send);
    }).then(function (r) {
      if (S.core !== core) return;
      if (S.intel && S.intel.core === core) S.intel.docs.push(r.doc); else S.intel = null;
      m.doc = r.doc.id; m.analysed = 0; m.applied = 0; if (m.status === 'Scheduled' || m.status === 'Rescheduled') m.status = 'Took place';
      dirty('transcript uploaded for ' + m.title); if (S.tab === 'comms') commsTab(); toast('Transcript added. Press ✨ Analyse impact to see what it means for the plan.');
    }).catch(function (e) { toast(e.message, true); });
  }
  function cmAnalyse(m) {
    var C = S.comms, core = S.core;
    if (C.busy) return toast('One analysis at a time', true);
    C.busy = m.id; commsTab();
    var id = Array.from(crypto.getRandomValues(new Uint8Array(10))).map(function (b) { return b.toString(16).padStart(2, '0'); }).join(''), t0 = Date.now();
    var end = function () { C.busy = ''; if (S.tab === 'comms' && S.core === core) commsTab(); };
    var poll = function () {
      if (Date.now() - t0 > 300000) { end(); return toast('The AI took too long. Try again.', true); }
      return new Promise(function (res) { setTimeout(res, 2500); }).then(function () { return api('planAiStatus', { id: id }); }).then(function (d) {
        if (d.status === 'done') { C.an[m.id] = d.analysis; m.analysed = Date.now(); m.applied = 0; C.view = m.id; dirty('meeting analysed: ' + m.title); end(); return; }
        if (d.status === 'error') { end(); return toast(d.error || 'The AI could not analyse the meeting', true); }
        return poll();
      });
    };
    (S.timer ? saveNow() : (S.q || Promise.resolve())).then(function () {
      return fetch('/.netlify/functions/planai-background', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-MBS-Admin': '1', 'X-Champ-Lang': (window.ChampI18n && window.ChampI18n.get()) || 'en' }, body: JSON.stringify({ mode: 'meet', id: id, core: core, meeting: m.id }) });
    }).then(function (r) { if (r.status >= 400) throw new Error('Could not start the AI (' + r.status + ')'); return poll(); }).catch(function (e) { end(); fail(e); });
  }
  function cmShow(mid) {
    var C = S.comms, box = $('#cmView'), m = (S.plan.meetings || []).filter(function (x) { return x.id === mid; })[0];
    if (!box || !m) return;
    var a = C.an[mid];
    if (!a) { box.innerHTML = '<div class="card"><p class="ask-think">Loading the analysis…</p></div>'; api('commsAnalysis', { core: S.core, id: mid }).then(function (r) { if (!r.analysis) { C.view = ''; return toast('No analysis yet: press ✨ Analyse impact', true); } C.an[mid] = r.analysis; if (S.tab === 'comms' && C.view === mid) cmShow(mid); }).catch(fail); return; }
    box.innerHTML = '<div class="card cm-an"><div class="card-h"><h2>📊 What this meeting means for the project</h2><span class="sp"></span><button class="btn btn-sm" id="cmClose" type="button">✕ Close</button></div>' +
      '<div class="pi-md">' + piMd(a.report) + '</div>' + impactHtml(a, m) + '<small class="muted">Analysed ' + esc(new Date(a.at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Sydney' })) + (a.tokens ? ' · about ' + a.tokens.toLocaleString('en-AU') + ' tokens' : '') + '. AI suggestions: check them before relying on them.</small></div>';
    $('#cmClose').onclick = function () { C.view = ''; commsTab(); };
    impactWire(box, a, m, function () { commsTab(); });
  }

  // the impact block, used on the Comms tab and in Project Intelligence answers
  function impactHtml(a, m, cr) {
    var p = S.plan, num = {}; p.tasks.forEach(function (t, i) { num[t.id] = i + 1; });
    var applied = !cr && m && m.applied && m.analysed && m.applied >= m.analysed, crLock = cr && CR_DONE[cr.status], hasPk = cr && cr.picks && Object.keys(cr.picks).length;
    var sent = !cr && m && m.cr ? (p.changes || []).filter(function (c) { return c.id === m.cr; })[0] : null; if (sent) { cr = null; hasPk = sent.picks && Object.keys(sent.picks).length; if (hasPk) cr = { picks: sent.picks }; }
    var area = '<h4>Impact on the project</h4><div class="table-wrap"><table class="pi-tbl im-tbl"><thead><tr><th>Area</th><th>Impact</th><th>What it means</th></tr></thead><tbody>' +
      AREA_N.map(function (x) { var v = a.impact[x[0]] || { level: 'None', text: '' }; return '<tr><td class="nowrap"><b>' + x[1] + '</b></td><td><span class="lv ' + LVL_C[v.level] + '">' + v.level + '</span></td><td>' + (esc(v.text) || '<span class="muted">No change</span>') + '</td></tr>'; }).join('') + '</tbody></table></div>';
    var item = function (k, i, on, html) { if (hasPk) on = !!cr.picks[k + ':' + i]; return '<label class="im-it"><input type="checkbox" data-im="' + k + ':' + i + '"' + (on ? ' checked' : '') + (applied || crLock || sent ? ' disabled' : '') + '><span>' + html + '</span></label>'; };
    var g = [];
    var have = function (id) { return p.tasks.some(function (t) { return t.id === id; }); };
    if (a.task_changes.length) g.push(['⏱ Schedule and cost', a.task_changes.map(function (c, i) {
      var w = []; if (c.durTo !== c.durFrom) w.push('days ' + c.durFrom + ' → <b>' + c.durTo + '</b>'); if (c.notBefore) w.push('not before <b>' + esc(dmy(c.notBefore)) + '</b>'); if (c.extra) w.push('<b>' + (c.extra > 0 ? '+' : '−') + money(Math.abs(c.extra)) + '</b>');
      return item('t', i, have(c.id), '<b>#' + (num[c.id] || c.n) + ' ' + esc(c.name) + '</b>: ' + w.join(', ') + (c.why ? '<br><small class="muted">' + esc(c.why) + '</small>' : '') + (have(c.id) ? '' : ' <small class="bad">(task no longer in the plan)</small>'));
    })]);
    if (a.new_tasks.length) g.push(['＋ New tasks', a.new_tasks.map(function (t, i) { return item('n', i, true, '<b>' + esc(t.name) + '</b>: ' + pl(t.days, 'day') + (t.after.length ? ', after #' + t.after.map(function (x) { return num[x]; }).filter(Boolean).join(', #') : '') + (t.cost ? ', ' + money(t.cost) : '') + (t.why ? '<br><small class="muted">' + esc(t.why) + '</small>' : '')); })]);
    if (a.scope_changes.length) g.push(['🎯 Scope', a.scope_changes.map(function (x, i) { return item('s', i, true, '<b>' + x.type + ':</b> ' + esc(x.text) + (x.why ? '<br><small class="muted">' + esc(x.why) + '</small>' : '')); })]);
    if (a.risks.length) g.push(['⚠ Risks for the register', a.risks.map(function (x, i) { var dup = (p.risks || []).some(function (y) { return y.title.toLowerCase() === x.title.toLowerCase(); }); if (crLock || sent) dup = false; return item('r', i, !dup, '<b>' + esc(x.title) + '</b> ' + (x.critical ? '<span class="pi-crit">⚡ Critical</span> ' : '') + '<small>P' + x.p + ' × I' + x.i + ' = <b>' + (x.p * x.i) + '</b> · ' + esc(x.response) + '</small><br><small class="muted">' + esc(x.cause) + (x.action ? ' → ' + esc(x.action) : '') + '</small>' + (dup ? ' <small class="muted">(already in the register)</small>' : '')); })]);
    if (a.issues.length) g.push(['❗ Issues for the log', a.issues.map(function (x, i) { return item('i', i, true, '<b>' + esc(x.title) + '</b> <small>' + esc(x.priority) + (x.owner ? ' · ' + esc(x.owner) : '') + (x.due ? ' · due ' + esc(dmy(x.due)) : '') + '</small>' + (x.detail ? '<br><small class="muted">' + esc(x.detail) + '</small>' : '')); })]);
    if (a.stakeholders.length) g.push(['👥 New stakeholders', a.stakeholders.map(function (x, i) { var dup = (p.stakeholders || []).some(function (y) { return y.name && y.name.toLowerCase() === x.name.toLowerCase(); }); if (crLock || sent) dup = false; return item('k', i, !dup, '<b>' + esc(x.name) + '</b> · ' + esc(x.role) + ' <span class="raci raci-' + x.raci + '">' + x.raci + '</span>' + (dup ? ' <small class="muted">(listed)</small>' : '')); })]);
    if (a.quality.length) g.push(['✅ Quality (added to the acceptance criteria)', a.quality.map(function (x, i) { return item('q', i, true, esc(x)); })]);
    if (!g.length) return area + '<p class="muted">No changes to the plan came out of ' + (cr ? 'this change request' : 'this meeting') + '.</p>';
    if (cr && !sent) return area + '<div class="im-box"><h4>' + (crLock ? 'The changes in this request' : 'Changes in this request: untick any that should not go ahead') + '</h4><div class="im-prev" data-imprev></div>' + g.map(function (x) { return '<div class="im-g"><b class="im-gh">' + x[0] + '</b>' + x[1].join('') + '</div>'; }).join('') + '</div>';
    if (sent) return area + '<div class="im-box"><h4>Proposed changes (sent to change control)</h4>' + g.map(function (x) { return '<div class="im-g"><b class="im-gh">' + x[0] + '</b>' + x[1].join('') + '</div>'; }).join('') + '<div class="cr-sent" style="margin-top:10px">🔁 Sent to change control as <b>' + crNo(sent) + '</b> · <span class="cr-st ' + CR_CLS[sent.status] + '">' + esc(sent.status) + '</span> <button class="btn btn-sm" type="button" data-imcropen="' + esc(sent.id) + '">Open ' + crNo(sent) + '</button></div></div>';
    if (!applied) return area + '<div class="im-box"><h4>Proposed changes to the plan</h4><div class="im-prev" data-imprev></div>' + g.map(function (x) { return '<div class="im-g"><b class="im-gh">' + x[0] + '</b>' + x[1].join('') + '</div>'; }).join('') +
      '<div class="row" style="gap:8px;margin-top:10px;align-items:center">' + (ccOff() ? '<button class="btn btn-gold" data-imcr type="button">✓ Commit to the plan</button><span class="muted" style="font-size:12.5px">Change control is off for this project: the ticked changes go into the plan and registers straight away (kept on record).</span>' : '<button class="btn btn-gold" data-imcr type="button">➜ Send to change control</button><span class="muted" style="font-size:12.5px">Nothing changes yet. The ticked changes become a change request: reviewed (at a change control meeting if needed) and approved and signed by the project manager or project director before they go into the plan and registers.</span>') + '</div></div>';
    return area + '<div class="im-box"><h4>Changes to apply to the plan</h4><div class="im-prev" data-imprev></div>' + g.map(function (x) { return '<div class="im-g"><b class="im-gh">' + x[0] + '</b>' + x[1].join('') + '</div>'; }).join('') +
      '<div class="row" style="gap:6px;margin-top:8px">' + (applied ? '<span class="cm-ok">✓ Applied to the plan ' + esc(new Date(m.applied).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Sydney' })) + '</span>' + (S.fitUndo && S.fitUndo.core === S.core && S.fitUndo.meet === m.id ? '<button class="btn btn-sm" data-imundo type="button">↶ Undo</button>' : '')
        : '<button class="btn btn-gold" data-imgo type="button">✓ Apply the ticked changes</button><span class="muted" style="font-size:12.5px">The Gantt chart, budget, scope and registers update; ↶ Undo puts it back.</span>') + '</div></div>';
  }
  function impactPicks(box) { var o = {}; box.querySelectorAll('[data-im]:checked').forEach(function (c) { o[c.getAttribute('data-im')] = 1; }); return o; }
  function impactApply(p, a, picks, m) {   // works on any plan object (the real one, or a copy for the preview)
    var byId = {}; p.tasks.forEach(function (t) { byId[t.id] = t; });
    var tag = m && typeof m.tag === 'string' ? m.tag : m ? ' (meeting ' + dmy(m.date) + ')' : ' (meeting)', n = 0;
    a.task_changes.forEach(function (c, i) {
      var t = byId[c.id]; if (!picks['t:' + i] || !t) return; n++;
      if (c.durTo !== c.durFrom) { t.dur = c.durTo; fitSubs(t); derive(t); }
      if (c.notBefore && (!t.snet || c.notBefore > t.snet)) t.snet = c.notBefore;
      if (c.extra) { if ((+t.qty || 0) > 0) t.rate = Math.round(((+t.rate || 0) + c.extra / t.qty) * 100) / 100; else { t.qty = 1; t.rate = c.extra; t.unit = t.unit || 'item'; } }
      t.notes = ((t.notes ? t.notes + '\n' : '') + (c.why || 'Changed') + tag).slice(0, 1000);
    });
    a.new_tasks.forEach(function (x, i) {
      if (!picks['n:' + i]) return; n++;
      var after = x.after.filter(function (id) { return byId[id]; }), at = after.length ? Math.max.apply(null, after.map(function (id) { return p.tasks.indexOf(byId[id]); })) + 1 : p.tasks.length;
      var t = { id: 't' + Date.now().toString(36) + i, phase: 'ph1', name: x.name, dur: x.days, res: [], lead: '', resource: '', qty: x.cost ? 1 : 0, unit: x.cost ? 'item' : '', rate: x.cost || 0, actual: 0, pct: 0, status: 'todo', pred: after, snet: '', notes: ((x.why || '') + tag).trim(), mats: [], subs: [] };
      p.tasks.splice(at, 0, t); byId[t.id] = t;
    });
    p.charter = p.charter || {};
    a.scope_changes.forEach(function (x, i) {
      if (!picks['s:' + i]) return; n++;
      var line = '- ' + x.text + tag;
      if (x.type === 'Remove') p.charter.outScope = ((p.charter.outScope ? p.charter.outScope + '\n' : '') + line).slice(0, 2000);
      else p.charter.inScope = ((p.charter.inScope ? p.charter.inScope + '\n' : '') + (x.type === 'Change' ? '- Changed: ' + x.text + tag : line)).slice(0, 3000);
    });
    a.quality.forEach(function (x, i) { if (!picks['q:' + i]) return; n++; p.charter.acceptance = ((p.charter.acceptance ? p.charter.acceptance + '\n' : '') + '- ' + x + tag).slice(0, 2000); });
    p.risks = p.risks || []; p.issues = p.issues || []; p.stakeholders = p.stakeholders || [];
    a.risks.forEach(function (x, i) { if (!picks['r:' + i]) return; n++; p.risks.push({ id: 'r' + Date.now().toString(36) + 'm' + i, title: x.title, cause: x.cause + (x.critical ? ' (affects the critical path)' : '') + tag, p: x.p, i: x.i, response: x.response, action: x.action, owner: x.owner || p.charter.manager || '', review: '', status: 'Open', raised: today() }); });
    a.issues.forEach(function (x, i) { if (!picks['i:' + i]) return; n++; p.issues.push({ id: 'i' + Date.now().toString(36) + 'm' + i, title: x.title, detail: (x.detail + tag).trim(), priority: x.priority, owner: x.owner || p.charter.manager || '', raised: today(), due: x.due || '', status: 'Open', resolution: '' }); });
    if (a.replan && n) {   // an approved re-plan also moves the Finish by date and the charter budget
      var Rr = rollup(p, today());
      if (p.finishBy && Rr.finish) p.finishBy = Rr.finish;
      if (p.charter && p.charter.budget != null) p.charter.budget = Rr.BAC;
    }
    a.stakeholders.forEach(function (x, i) { if (!picks['k:' + i]) return; n++; p.stakeholders.push({ id: 's' + Date.now().toString(36) + 'm' + i, name: x.name, role: x.role, raci: x.raci, phone: '', email: '', sub: '' }); });
    return n;
  }
  function impactWire(box, a, m, after, cr) {
    var prev = box.querySelector('[data-imprev]');
    var show = function () {
      if (!prev) return;
      if (cr && CR_DONE[cr.status] && cr.effect) { var e = cr.effect; prev.className = 'im-prev' + (e.days > 0 || e.cost > 0 ? ' worse' : '');
        prev.innerHTML = '<b>Effect when ' + esc(cr.status === 'Implemented' ? 'approved' : cr.status.toLowerCase()) + ':</b> finish ' + esc(dmy(e.f0)) + ' → <b>' + esc(dmy(e.f1)) + '</b> (' + (e.days ? (e.days > 0 ? '+' : '') + pl(e.days, 'working day') : 'no change') + ') · budget ' + money(e.b0) + ' → <b>' + money(e.b1) + '</b> (' + (e.cost ? (e.cost > 0 ? '+' : '−') + money(Math.abs(e.cost)) : 'no change') + ')'; return; }
      var picks = impactPicks(box), R0 = rollup(S.plan, today()), copy = JSON.parse(JSON.stringify(S.plan)); impactApply(copy, a, picks, m); var R1 = rollup(copy, today());
      var dd = R0.finish && R1.finish ? (R1.finish > R0.finish ? workBetween(R0.finish, R1.finish) - 1 : R1.finish < R0.finish ? -(workBetween(R1.finish, R0.finish) - 1) : 0) : 0, dc = Math.round((R1.BAC - R0.BAC) * 100) / 100;
      prev.className = 'im-prev' + (dd > 0 || dc > 0 ? ' worse' : '');
      prev.innerHTML = '<b>With the ticked changes:</b> finish ' + esc(dmy(R0.finish)) + ' → <b>' + esc(dmy(R1.finish)) + '</b> (' + (dd ? (dd > 0 ? '+' : '') + pl(dd, 'working day') : 'no change') + ')' +
        ' · budget ' + money(R0.BAC) + ' → <b>' + money(R1.BAC) + '</b> (' + (dc ? (dc > 0 ? '+' : '−') + money(Math.abs(dc)) : 'no change') + ')' + (p0finishBy(R1) ? ' · <span class="bad">after the Finish by date ' + esc(dmy(S.plan.finishBy)) + '</span>' : '');
    };
    box.querySelectorAll('[data-im]').forEach(function (c) { c.onchange = function () { show(); if (cr && !CR_DONE[cr.status]) { cr.picks = {}; box.querySelectorAll('[data-im]').forEach(function (x) { cr.picks[x.getAttribute('data-im')] = x.checked ? 1 : 0; }); dirty(); } }; });
    show();
    var op = box.querySelector('[data-imcropen]'); if (op) op.onclick = function () { S.crView = op.getAttribute('data-imcropen'); location.hash = '#plan/' + S.core + '/change'; };
    var send = box.querySelector('[data-imcr]'); if (send) send.onclick = function () {
      var picks = impactPicks(box); if (!Object.keys(picks).length) return toast('Tick the changes to send', true);
      var items = JSON.parse(JSON.stringify(a)); delete items.report; delete items.tokens; delete items.today;
      var c = crNew({ title: m ? 'Changes from the meeting: ' + m.title : 'Changes suggested by Project Intelligence', desc: a.outcome || (a.summary || []).join('\n'), reason: (a.decisions || []).map(function (x) { return '- ' + x; }).join('\n'),
        source: m ? 'meeting' : 'intel', srcRef: m ? m.id : '', srcTitle: m ? m.title + ' (' + dmy(m.date) + ')' : 'Project Intelligence answer', items: items, picks: picks });
      if (m) { var mm = (S.plan.meetings || []).filter(function (x) { return x.id === m.id; })[0]; if (mm) mm.cr = c.id; }
      if (ccOff()) { crCommitNow(c); return; }
      dirty(crNo(c) + ' raised'); S.crView = c.id; toast(crNo(c) + ' raised in change control: review it, then approve and sign to add it to the plan');
      location.hash = '#plan/' + S.core + '/change';
    };
    var go = box.querySelector('[data-imgo]'); if (go) go.onclick = function () {
      var picks = impactPicks(box); if (!Object.keys(picks).length) return toast('Tick the changes to apply', true);
      var R0 = rollup(S.plan, today());
      S.fitUndo = { core: S.core, plan: JSON.parse(JSON.stringify(S.plan)), meet: m ? m.id : 'pi' };
      var n = impactApply(S.plan, a, picks, m);
      var mm = m ? (S.plan.meetings || []).filter(function (x) { return x.id === m.id; })[0] : null; if (mm) mm.applied = Date.now();
      dirty('meeting changes applied' + (m ? ': ' + m.title : '')); var R1 = rollup(S.plan, today());
      toast(pl(n, 'change') + ' applied. Finish ' + dmy(R1.finish) + (R1.finish !== R0.finish ? ' (was ' + dmy(R0.finish) + ')' : '') + ', budget ' + money(R1.BAC) + '.');
      after();
    };
    var un = box.querySelector('[data-imundo]'); if (un) un.onclick = function () { fitUndo(); after(); };
  }
  // ---------- re-plan: a new total length (weeks or a finish date) and/or a new total budget, worked out task by task ----------
  // Unfinished, non-milestone tasks are stretched (or squeezed) in proportion until the finish date hits the target; review gates are added as tasks;
  // the budget difference is spread over unfinished tasks in proportion to their cost (or their days when they have no cost). Done tasks never change.
  function replanImpact(rp) {
    var base = JSON.parse(JSON.stringify(S.plan)), R0 = rollup(base, today());
    if (!base.tasks.length || !R0.start) return null;
    var num = {}; base.tasks.forEach(function (t, i) { num[t.id] = i + 1; });
    var gates = (rp.gates || []).filter(function (g) { return num[g.after]; }).map(function (g) { return { name: g.name, days: g.days, after: [g.after], cost: 0, why: 'Review or approval gate added by the re-plan' }; });
    var target = rp.finish || '';
    if (!target && rp.weeks) { var d = new Date(R0.start + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + rp.weeks * 7 - 1); target = d.toISOString().slice(0, 10); }
    if (target && target < R0.start) target = '';
    var open = function (t) { return (t.pct || 0) < 100 && t.dur > 0; };
    var trial = function (f) {   // stretch factor f → the plan with the gates and new durations
      var c = JSON.parse(JSON.stringify(base)), by = {}; c.tasks.forEach(function (t) { by[t.id] = t; });
      var a = { task_changes: [], new_tasks: gates, scope_changes: [], risks: [], issues: [], stakeholders: [], quality: [] };
      base.tasks.forEach(function (t) { if (!open(t) || f === 1) return; var nd = Math.max(1, Math.round(t.dur * f)); if (nd !== t.dur) a.task_changes.push({ id: t.id, n: num[t.id], name: t.name, durFrom: t.dur, durTo: nd, notBefore: '', extra: 0, why: 'Re-plan' }); });
      var pk = {}; a.task_changes.forEach(function (_, i) { pk['t:' + i] = 1; }); a.new_tasks.forEach(function (_, i) { pk['n:' + i] = 1; });
      impactApply(c, a, pk, { tag: '' }); return { a: a, R: rollup(c, today()) };
    };
    var best = trial(1);
    if (target) {   // find the stretch that lands on the target finish (a few rounds: dependencies and rounding)
      var lo = 0.2, hi = 6, f = Math.max(lo, Math.min(hi, workBetween(R0.start, target) / Math.max(1, workBetween(R0.start, best.R.finish))));
      for (var k = 0; k < 14; k++) {
        var t = trial(f), diff = workBetween(R0.start, t.R.finish) - workBetween(R0.start, target);
        if (Math.abs(diff) < Math.abs(workBetween(R0.start, best.R.finish) - workBetween(R0.start, target))) best = t;
        if (diff === 0) break;
        if (diff > 0) hi = f; else lo = f;
        f = (lo + hi) / 2;
      }
    }
    var a = best.a;
    // the budget: spread the difference over the unfinished work
    var B1 = rp.budget > 0 ? rp.budget : 0, cur = best.R.BAC, gap = B1 ? Math.round((B1 - cur) * 100) / 100 : 0;
    if (gap) {
      var pool = base.tasks.filter(function (t) { return (t.pct || 0) < 100; }), lab = function (t) { return Math.max(0, (Number(t.qty) || 0) * (Number(t.rate) || 0)); };
      var w = pool.map(function (t) { return lab(t) || (gap > 0 ? Math.max(1, t.dur) * 0.0001 : 0); }), W = w.reduce(function (x, y) { return x + y; }, 0);
      if (W > 0) {
        var left = gap, byChange = {}; a.task_changes.forEach(function (c) { byChange[c.id] = c; });
        pool.forEach(function (t, i) {
          if (!w[i]) return;
          var ex = i === pool.length - 1 ? left : Math.round(gap * w[i] / W * 100) / 100;
          if (gap < 0) ex = Math.max(ex, -lab(t));   // never below nothing
          left = Math.round((left - ex) * 100) / 100; if (!ex) return;
          var c = byChange[t.id]; if (!c) { c = byChange[t.id] = { id: t.id, n: num[t.id], name: t.name, durFrom: t.dur, durTo: t.dur, notBefore: '', extra: 0, why: 'Re-plan' }; a.task_changes.push(c); }
          c.extra = Math.round((c.extra + ex) * 100) / 100;
        });
        if (Math.abs(left) >= 0.01 && a.task_changes.length) { var lc = a.task_changes[a.task_changes.length - 1]; lc.extra = Math.round((lc.extra + left) * 100) / 100; }
      }
      a.task_changes.sort(function (x, y) { return x.n - y.n; });
    }
    var pk = {}; a.task_changes.forEach(function (_, i) { pk['t:' + i] = 1; }); a.new_tasks.forEach(function (_, i) { pk['n:' + i] = 1; });
    var c2 = JSON.parse(JSON.stringify(base)); impactApply(c2, a, pk, { tag: '' }); var R1 = rollup(c2, today());
    var dd = R1.finish > R0.finish ? workBetween(R0.finish, R1.finish) - 1 : -(workBetween(R1.finish, R0.finish) - 1), dc = Math.round((R1.BAC - R0.BAC) * 100) / 100;
    var wk = function (a1, b1) { return Math.round(((Date.parse(b1) - Date.parse(a1)) / 864e5 + 1) / 7 * 10) / 10; };
    var lvl = function (x, big) { x = Math.abs(x); return !x ? 'None' : x >= big ? 'High' : x >= big / 3 ? 'Medium' : 'Low'; };
    a.impact = {
      time: { level: lvl(dd, 20), text: 'Finish ' + dmy(R0.finish) + ' → ' + dmy(R1.finish) + ' (' + wk(R0.start, R0.finish) + ' → ' + wk(R1.start, R1.finish) + ' weeks).' },
      cost: { level: lvl(dc, Math.max(1, R0.BAC * 0.3)), text: 'Budget ' + money(R0.BAC) + ' → ' + money(R1.BAC) + (dc ? ' (' + (dc > 0 ? '+' : '−') + money(Math.abs(dc)) + ')' : '') + '.' },
      scope: { level: gates.length ? 'Low' : 'None', text: gates.length ? pl(gates.length, 'review gate') + ' added to the schedule.' : '' },
      quality: { level: 'None', text: '' }, risk: { level: dd < 0 ? 'Medium' : 'Low', text: dd < 0 ? 'A shorter schedule adds delivery risk: check resources.' : 'More time: watch for idle teams and drifting scope.' }
    };
    a.outcome = 'Re-plan' + (target ? ' to ' + wk(R1.start, R1.finish) + ' weeks (finish ' + dmy(R1.finish) + ')' : '') + (B1 ? (target ? ' and ' : ' to ') + money(R1.BAC) : '');
    a.summary = [rp.why || ''].filter(Boolean); a.decisions = []; a.actions = []; a.follow_ups = [];
    a.replan = { weeks: rp.weeks || 0, finish: target, budget: B1, rebaseline: true };
    return { a: a, R0: R0, R1: R1, target: target, budget: B1 };
  }
  function p0finishBy(R) { return S.plan.finishBy && R.finish && R.finish > S.plan.finishBy; }

  /* ---------- v82: 🔁 Change control: every proposed change is a change request (CR); reviewed, approved and signed by the PM / PD (or the
     change control board) before it goes into the plan and the registers. Changes from meetings and Project Intelligence come here first. ---------- */
  var CR_DONE = { Approved: 1, Implemented: 1, Rejected: 1, Deferred: 1 };
  var CR_CLS = { Proposed: 'cr-p', 'Under review': 'cr-r', 'CCB meeting': 'cr-m', Approved: 'cr-a', Implemented: 'cr-i', Rejected: 'cr-x', Deferred: 'cr-d' };
  var CR_ROLES = ['Project manager', 'Project director', 'Sponsor (customer)', 'Change control board (chair)'];
  var CR_SRC = { manual: '✍ Raised by hand', meeting: '📞 From a meeting', intel: '🧠 From Project Intelligence', fit: '✨ Fit to finish-by (applied directly)' };
  function crNo(c) { return 'CR-' + ('00' + c.num).slice(-3); }
  function crNew(o) {
    var p = S.plan; p.changes = p.changes || [];
    var c = Object.assign({ id: 'cr' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), num: p.changes.reduce(function (a, x) { return Math.max(a, x.num || 0); }, 0) + 1, title: 'Change request', desc: '', reason: '',
      source: 'manual', srcRef: '', srcTitle: '', raisedBy: (p.charter || {}).manager || '', raisedAt: Date.now(), priority: 'Medium', status: 'Proposed', estDays: 0, estCost: 0, items: null, picks: {}, ccb: '', decision: null, implementedAt: 0, log: [] }, o);
    c.log = [{ at: Date.now(), what: 'Raised' + (c.srcTitle ? ' from ' + c.srcTitle : '') + (c.raisedBy ? ' by ' + c.raisedBy : '') }];
    p.changes.push(c); return c;
  }
  function crLog(c, what) { c.log = (c.log || []).concat([{ at: Date.now(), what: what }]).slice(-40); }
  // every decision is kept for good: the signed change request as a PDF plus a database record (who decided, when, the effect),
  // so the team can open it any time, query it (change_records) and Project Intelligence can read it
  function crRecord(c, quiet) {
    if (!c || !c.decision || !M.report || !M.report.pdf) return Promise.resolve(null);
    S.crBusy = S.crBusy || {}; var bk = c.id + '@' + c.decision.at; if (S.crBusy[bk]) return S.crBusy[bk];   // already being kept
    var core = S.core, snap = crSnapshot(c), pr;
    var text = [snap.title, S.plan.name].concat(snap.sections.map(function (x) { return x.title + ': ' + (x.rows ? x.rows.map(function (r) { return Array.isArray(r) ? r.map(function (v) { return v && v.t != null ? v.t : v; }).join(' ') : ''; }).join('; ') : x.text || ''); })).join('\n');
    pr = M.report.pdf(snap).then(function (r) {
      return new Promise(function (res) { var rd = new FileReader(); rd.onload = function () { res(String(rd.result).replace(/^data:[^,]*,/, '')); }; rd.readAsDataURL(r.blob); }).then(function (b64) {
        return api('intelCrRecord', { core: core, project: S.plan.name, name: r.name, file: b64, text: text,
          cr: { id: c.id, num: c.num, title: c.title, desc: c.desc, reason: c.reason, source: c.source, raisedBy: c.raisedBy, raisedAt: c.raisedAt, status: c.status, decision: c.decision, effect: c.effect || null, implementedAt: c.implementedAt || 0, direct: !!c.direct } });
      });
    }).then(function (d) {
      if (S.core === core) { c.recorded = d.record.at; c.recKey = d.record.key; S.crRecs = null; dirty(crNo(c) + ' record kept'); if (S.tab === 'change' && $('#planBody') && location.hash.indexOf('#plan/' + core) === 0) changeTab(); }
      if (!quiet) toast('📁 ' + crNo(c) + ' kept on record with the signed PDF');
      return d.record;
    }).catch(function (e) { if (!quiet) toast('The decision is saved in the plan, but the PDF record could not be kept: ' + (e.message || e) + '. Open Change control to try again.', true); return null; })
      .then(function (x) { delete S.crBusy[bk]; return x; });
    S.crBusy[bk] = pr; return pr;
  }
  function crBackfill() {   // decisions made before records were kept (or whose record failed): keep them now, one at a time
    if (S.crFilling || M.me && M.me.scope) return; var todo = (S.plan.changes || []).filter(function (c) { return c.decision && !c.recorded && !(S.crBusy && S.crBusy[c.id + '@' + c.decision.at]); }); if (!todo.length) return;
    S.crFilling = true; var core = S.core;
    api('intelCrList', { core: core }).then(function (d) {   // already on record (e.g. the page was left before the plan saved the mark): just mark it
      var have = {}; (d.records || []).forEach(function (r) { have[r.crId + '@' + r.at] = r; });
      var marked = 0; todo = todo.filter(function (c) { var r = have[c.id + '@' + c.decision.at]; if (r) { c.recorded = r.at; c.recKey = r.key; marked++; return false; } return true; });
      if (marked && S.core === core) dirty('change records marked');
      return todo.reduce(function (pr, c) { return pr.then(function () { if (S.core === core) return crRecord(c, true); }); }, Promise.resolve());
    }).then(function () { S.crFilling = false; if (S.core === core && todo.length) toast('📁 ' + pl(todo.length, 'earlier decision') + ' kept on record with signed PDFs'); }, function () { S.crFilling = false; });
  }
  function crPicks(c) {   // what goes ahead: the ticked items (all of them if never changed)
    var a = c.items; if (!a) return {};
    var all = {}; [['t', a.task_changes], ['n', a.new_tasks], ['s', a.scope_changes], ['r', a.risks], ['i', a.issues], ['k', a.stakeholders], ['q', a.quality]].forEach(function (x) { (x[1] || []).forEach(function (_, i) { all[x[0] + ':' + i] = 1; }); });
    if (c.picks && Object.keys(c.picks).length) Object.keys(all).forEach(function (k) { all[k] = c.picks[k] ? 1 : 0; });
    Object.keys(all).forEach(function (k) { if (!all[k]) delete all[k]; }); return all;
  }
  function crDelta(c) {
    var e = c.effect; if (e && CR_DONE[c.status]) return { R0: { finish: e.f0, BAC: e.b0 }, R1: { finish: e.f1, BAC: e.b1 }, days: e.days, cost: e.cost, est: !!e.est };
    var R0 = rollup(S.plan, today()); if (!c.items) return { R0: R0, R1: R0, days: c.estDays || 0, cost: c.estCost || 0, est: true };
    var copy = JSON.parse(JSON.stringify(S.plan)); impactApply(copy, c.items, crPicks(c), { tag: '' }); var R1 = rollup(copy, today());
    var dd = R0.finish && R1.finish ? (R1.finish > R0.finish ? workBetween(R0.finish, R1.finish) - 1 : R1.finish < R0.finish ? -(workBetween(R1.finish, R0.finish) - 1) : 0) : 0;
    return { R0: R0, R1: R1, days: dd, cost: r2(R1.BAC - R0.BAC) };
  }
  function crImpTxt(d) { return (d.days ? (d.days > 0 ? '+' : '') + pl(d.days, 'day') : 'no change') + ' · ' + (d.cost ? (d.cost > 0 ? '+' : '−') + money(Math.abs(d.cost)) : 'no cost change'); }
  /* ---------- v89: 🧱 Bill of Materials. The BOM is the source of truth for the materials: lines that are Inventory items are
     written onto their tasks as stock materials (so stock is set aside, task costs and quotes include them). The AI drafts it,
     staff check each line and sign it off; then it is locked and reopening needs a reason. Reusable templates. ---------- */
  var BOM_SRC = { ai: '✨ AI', manual: '✍ added', template: '📋 template', plan: '📦 plan' };
  var q3c = function (n) { return Math.round((Number(n) || 0) * 1000) / 1000; };
  function bomMe() { var m = M.me || {}; return m.name || m.user || 'Admin'; }
  function bomOf() { return S.plan.bom || null; }
  function bomHas() { var b = bomOf(); return !!(b && (b.lines || []).length); }
  function bomLocked() { var b = bomOf(); return !!(b && b.status === 'Signed off'); }
  function bomLog(what) { var b = bomOf(); b.log = (b.log || []).concat([{ at: Date.now(), what: what }]).slice(-60); }
  function bomLine(o) { var ms = bomMs(); return { id: 'b' + rid().slice(0, 12), task: o.task || (ms ? ms.id : ''), name: o.name || 'Material', item: o.item || '', qty: q3c(o.qty), unit: o.unit || 'each', price: r2(o.price), lead: Math.max(0, Math.round(Number(o.lead) || 0)), note: o.note || '', source: o.source || 'manual', est: !!o.est, checked: false, checkedBy: '' }; }
  // v99: the BOM is ONE milestone in the Gantt chart, "🧱 Bill of Materials", just before the build starts (e.g. site set-out and
  // excavation). All the materials are costed and set aside there, not spread over the planning tasks.
  function bomMs() { var b = bomOf(); return b && b.milestone ? S.plan.tasks.filter(function (t) { return t.id === b.milestone; })[0] || null : null; }
  var BUILD_RX = /set.?out|excavat|demoli|strip.?out|mobilis|site (works|prep|establish)|establish|install|construct|build|fram(e|ing)|footing|pour|slab|start (of )?(work|construction)|commenc|remov|replac|lay(ing)? |erect|fit.?out|waterproof|tiling|tile |render|paint|deck(ing)? (build|install)|injection|repair|rectif/i;
  var PRE_RX = /quote|scope|plan(ning)?\b|design|drawing|approv|council|permit|cdc|\bda\b|inspect|measure|survey|diagnos|assess|layout|concept|order|procure|purchas|contract|deposit|consult|report|pric|check|confirm|meeting|book|enquir|milestone|accepted|complete/i;
  function bomBuildStart() {   // the first task where the physical work starts (the AI can say otherwise when it drafts the BOM)
    var ms = bomMs(), T = S.plan.tasks.filter(function (t) { return !ms || t.id !== ms.id; });
    var hit = T.filter(function (t) { return t.dur > 0 && BUILD_RX.test(t.name) && !PRE_RX.test(t.name); })[0];
    if (hit) return hit;
    var lastPre = -1; T.forEach(function (t, i) { if (PRE_RX.test(t.name)) lastPre = i; });
    return T.slice(lastPre + 1).filter(function (t) { return t.dur > 0; })[0] || T.filter(function (t) { return t.dur > 0; })[0] || null;
  }
  function bomPlace(before) {   // put the milestone just before `before` (null = at the end), with every BOM line on it
    var p = S.plan, b = bomOf(), ms = bomMs();
    if (!ms) {
      ms = { id: 't' + Date.now().toString(36) + 'bm', phase: (p.phases[0] || {}).id || 'ph1', name: '🧱 Bill of Materials', dur: 0, res: [], lead: '', resource: '', qty: 0, unit: '', rate: 0, actual: 0, pct: 0, status: 'todo', pred: [], snet: '', mats: [],
        notes: 'All the materials for the job (the Bill of Materials): ordered, checked and on site before the build starts. Tick it done when the build starts (the stock is then used).' };
      b.milestone = ms.id;
    } else { p.tasks.splice(p.tasks.indexOf(ms), 1); p.tasks.forEach(function (t) { t.pred = (t.pred || []).filter(function (x) { return x !== ms.id; }); }); }
    if (before && before.id !== ms.id) { ms.pred = (before.pred || []).filter(function (x) { return x !== ms.id; }); p.tasks.splice(p.tasks.indexOf(before), 0, ms); before.pred = (before.pred || []).concat([ms.id]); }
    else { var last = p.tasks[p.tasks.length - 1]; ms.pred = last ? [last.id] : []; p.tasks.push(ms); }
    b.buildStart = before ? before.id : '';
    b.lines.forEach(function (l) { l.task = ms.id; });
    return ms;
  }
  function bomEnsure() {   // older BOMs (lines on several tasks) move onto the one milestone
    var b = bomOf(); if (!b) return false;
    var ms = bomMs(), moved = false;
    if (!ms) { ms = bomPlace(bomBuildStart()); moved = true; }
    b.lines.forEach(function (l) { if (l.task !== ms.id) { l.task = ms.id; moved = true; } });
    if (moved) { bomLog('Materials gathered on the 🧱 Bill of Materials milestone (before ' + (((S.plan.tasks.filter(function (t) { return t.id === b.buildStart; })[0]) || {}).name || 'the end') + ')'); bomSync(); dirty('BOM milestone'); }
    return moved;
  }
  function bomPhases() {   // a small picture of the key phases, to refer to while working out the materials
    var p = S.plan, ms = bomMs(), T = p.tasks.filter(function (t) { return t.es && t.ef; });
    if (!T.length) return '';
    var a = T.reduce(function (m, t) { return !m || t.es < m ? t.es : m; }, ''), z = T.reduce(function (m, t) { return t.ef > m ? t.ef : m; }, '');
    var span = Math.max(1, (toD(z) - toD(a)) / 864e5 + 1), pos = function (d) { return Math.max(0, Math.min(100, (toD(d) - toD(a)) / 864e5 / span * 100)); };
    return '<details class="card bom-ph" id="bomPh"' + (S.bomPhOpen === false ? '' : ' open') + '><summary><b>Key phases</b> <small class="muted">to refer to while working out the materials · ' + esc(dmy(a)) + ' to ' + esc(dmy(z)) + '</small></summary><div class="bom-phl">' + T.map(function (t) {
      var isMs = ms && t.id === ms.id, done = t.pct >= 100;
      return '<div class="bom-phr' + (isMs ? ' ms' : '') + (done ? ' done' : '') + '" title="' + esc(t.name + ': ' + dmy(t.es) + (t.ef !== t.es ? ' to ' + dmy(t.ef) : '')) + '"><span class="n">' + (p.tasks.indexOf(t) + 1) + '</span><span class="nm">' + esc(t.name) + '</span><span class="tr">' +
        (t.dur ? '<i style="left:' + pos(t.es) + '%;width:' + Math.max(1.5, ((toD(t.ef) - toD(t.es)) / 864e5 + 1) / span * 100) + '%"></i>' : '<b style="left:' + pos(t.es) + '%"></b>') + '</span><span class="d">' + esc(dmy(t.es).slice(0, 5)) + '</span></div>';
    }).join('') + '</div></details>';
  }
  function bomStart() {   // the first time: the materials already on the tasks become the first lines
    var p = S.plan, lines = [];
    p.tasks.forEach(function (t) { matsOf(t).forEach(function (m) { var i = invItem(m.item) || {}; lines.push(bomLine({ task: t.id, name: i.name || 'Stock item ' + m.item, item: m.item, qty: m.qty, unit: i.unit || 'each', price: m.price, source: 'plan' })); }); });
    p.bom = { status: 'Draft', lines: lines, signedBy: '', signedRole: '', signedAt: 0, sig: '', template: '', log: [], milestone: '', buildStart: '' };
    var at = bomBuildStart(); bomPlace(at);
    bomLog('BOM started by ' + bomMe() + (lines.length ? ' with ' + pl(lines.length, 'line') + ' from the materials already on the tasks' : '') + '; 🧱 Bill of Materials milestone ' + (at ? 'before “' + at.name + '”' : 'added'));
    return p.bom;
  }
  function bomSync() {   // BOM ➜ tasks: each task's stock materials are the BOM lines on it that are Inventory items
    var p = S.plan, b = bomOf(); if (!b) return;
    if (b.status !== 'Signed off') { p.tasks.forEach(function (t) { t.mats = []; delete t.bomx; }); p.bomLoose = 0; return; }   // GKH Project Champ: the BOM goes into the costing once it is signed off
    var by = {};
    b.lines.forEach(function (l) { if (!l.task || !l.item) return; var g = by[l.task] = by[l.task] || {}, x = g[l.item] = g[l.item] || { qty: 0, val: 0 }; x.qty += Number(l.qty) || 0; x.val += (Number(l.qty) || 0) * (Number(l.price) || 0); });
    p.tasks.forEach(function (t) { var g = by[t.id] || {}; t.mats = Object.keys(g).map(function (id) { var x = g[id]; return { item: id, qty: q3c(x.qty), price: x.qty ? r2(x.val / x.qty) : 0 }; }); });
    // v93: lines not in Inventory still cost money: in the task's cost (bomx); lines with no task: bomLoose (their own quote line)
    var bx = {}, loose = 0; b.lines.forEach(function (l) { var v = (Number(l.qty) || 0) * (Number(l.price) || 0); if (!l.task) loose += v; else if (!l.item) bx[l.task] = (bx[l.task] || 0) + v; });
    p.tasks.forEach(function (t) { if (bx[t.id]) t.bomx = r2(bx[t.id]); else delete t.bomx; }); p.bomLoose = r2(loose);
  }
  function bomSave(what) { bomSync(); dirty(what); bomTab(); }
  function bomLoadStock() {   // stock levels, and what this plan itself has set aside (so it is not counted twice)
    return (S.timer ? saveNow() : (S.q || Promise.resolve())).then(loadInv).then(function () { S.bomStockAt = Date.now(); });
  }
  function bomStock() {
    var b = bomOf(), done = {}, need = {}, lead = {}, base = S.bomBase || {}, r = {};
    S.plan.tasks.forEach(function (t) { done[t.id] = t.status === 'done'; });
    b.lines.forEach(function (l) { if (!l.item || done[l.task]) return; need[l.item] = q3c((need[l.item] || 0) + (Number(l.qty) || 0)); lead[l.item] = Math.max(lead[l.item] || 0, l.lead || 0); });
    Object.keys(need).forEach(function (id) {
      var i = invItem(id); if (!i) { r[id] = { need: need[id], unknown: true }; return; }
      var free = Math.max(0, q3c((Number(i.available) || 0) + (base[id] || 0)));   // other jobs' shortfall is theirs, not this job's
      r[id] = { need: need[id], onHand: q3c(i.onHand), free: free, short: Math.max(0, q3c(need[id] - free)), onOrder: Number(i.onOrder && i.onOrder.qty != null ? i.onOrder.qty : i.onOrder) || 0, unit: i.unit, name: i.name, lead: lead[id] };
    });
    // v96: materials that are not in Inventory have none in stock: the whole quantity is to be ordered (keyed by the line)
    b.lines.forEach(function (l) { if (l.item || done[l.task] || !(Number(l.qty) > 0)) return;
      r[l.id] = { need: q3c(l.qty), onHand: 0, free: 0, short: q3c(l.qty), onOrder: 0, unit: l.unit || 'each', name: l.name, lead: l.lead || 0, nostock: true, task: l.task }; });
    return r;
  }
  function bomTotals(b) {
    var v = 0, inPlan = 0; b.lines.forEach(function (l) { var x = (Number(l.qty) || 0) * (Number(l.price) || 0); v += x; if (l.task) inPlan += x; });
    return { value: r2(v), inPlan: r2(inPlan), checked: b.lines.filter(function (l) { return l.checked; }).length, est: b.lines.filter(function (l) { return l.est; }).length, noItem: b.lines.filter(function (l) { return !l.item; }).length, zero: b.lines.filter(function (l) { return !(Number(l.price) > 0); }).length, noTask: b.lines.filter(function (l) { return !l.task; }).length };
  }
  function bomMatch(l) {   // an Inventory item with the same name, to link an unmatched line to
    if (l.item || !S.inv) return null; var n = String(l.name || '').trim().toLowerCase();
    return Object.keys(S.inv).map(function (k) { return S.inv[k]; }).filter(function (i) { return !i.archived && String(i.name || '').trim().toLowerCase() === n; })[0] || null;
  }
  function bomGroups(b) {
    var num = {}, g = {}, order = [];
    S.plan.tasks.forEach(function (t, i) { num[t.id] = i + 1; });
    b.lines.forEach(function (l, k) { var key = l.task && num[l.task] ? l.task : ''; if (!g[key]) { g[key] = []; order.push(key); } g[key].push({ l: l, k: k }); });
    order.sort(function (a, c) { return (a ? num[a] : 1e9) - (c ? num[c] : 1e9); });
    return order.map(function (key) { var t = key ? S.plan.tasks[num[key] - 1] : null; return { t: t, n: t ? num[key] : 0, rows: g[key] }; });
  }

  function bomTab() {
    var B = $('#planBody'), b = bomOf();
    if (!b) {
      var have = 0; S.plan.tasks.forEach(function (t) { have += matsOf(t).length; });
      B.innerHTML = '<div class="card bom-intro"><h2>🧱 Bill of Materials: ' + esc(S.plan.name) + '</h2><p>Every material, fixing and consumable the job needs, with quantities and prices: checked and signed off <b>before the work starts</b>. In the Gantt chart it is one milestone, <b>🧱 Bill of Materials</b>, just before the build starts (e.g. before site set-out and excavation), and all the materials are costed there.</p>' +
        '<ol class="bom-how"><li><b>✨ Draft with AI</b> from the plan and the scope, or start from a <b>📋 template</b> (e.g. a standard bathroom), or add lines yourself.</li>' +
        '<li><b>One milestone:</b> all of it sits on the 🧱 Bill of Materials milestone in the Gantt chart, just before the work starts.</li>' +
        '<li><b>Check and sign off:</b> the preparer ticks each line as checked, then signs. Signed off, the BOM is locked and its total goes into the 💰 Costing as materials.</li></ol>' +
        (have ? '<p class="muted">The ' + pl(have, 'material') + ' already on the tasks (📦) will become the first lines.</p>' : '') +
        '<div class="actions" style="justify-content:flex-start"><button class="btn btn-gold" id="bomGo" type="button">🧱 Start the BOM</button></div></div>';
      $('#bomGo').onclick = function () { bomStart(); bomSave('BOM started'); };
      return;
    }
    if (!bomLocked() && bomEnsure()) b = bomOf();   // v99: one milestone for all the materials
    var NOINV = true;   // GKH Project Champ: no Inventory (the BOM is for costing only)
    if (!NOINV && (!S.bomStockAt || S.bomStockCore !== S.core)) { S.bomStockCore = S.core; S.bomStockAt = 1; bomLoadStock().then(function () { if (S.tab === 'bom') bomTab(); }); }
    var lock = bomLocked(), T = bomTotals(b), st = NOINV ? {} : bomStock(), dis = lock ? ' disabled' : '';
    var shorts = Object.keys(st).filter(function (id) { return st[id].short > 0; });
    var opts = function (cur) { return '<option value="">– not linked to a task –</option>' + S.plan.tasks.map(function (t, i) { return '<option value="' + esc(t.id) + '"' + (t.id === cur ? ' selected' : '') + '>#' + (i + 1) + ' ' + esc(t.name.slice(0, 60)) + '</option>'; }).join(''); };
    var stockCell = function (l) {
      if (!l.item) { var m = bomMatch(l); return '<span class="bom-ns">Not in stock</span>' + (lock ? '' : m ? '<button class="btn btn-sm" data-bmatch="' + esc(m.id) + '" type="button" title="Use ' + esc(m.name) + ' from Inventory for this line">📦 ' + esc(m.name.slice(0, 24)) + '</button>' : '<button class="btn btn-sm" data-binv type="button" title="Add this material to Inventory so it can be set aside and ordered">＋ Add to Inventory</button>') + (lock ? '' : '<button class="btn btn-sm bom-pk" data-blink type="button" title="Pick the stock item from Inventory">📦</button>'); }
      var s = st[l.item], i = invItem(l.item);
      if (!i) return '<span class="muted">Stock item ' + esc(l.item) + '</span>';
      if (!s) return '<span class="muted">' + esc(i.name) + '</span>';
      return '<span class="bom-st' + (s.short ? ' short' : '') + '" title="' + esc(i.name + ': ' + s.onHand + ' ' + s.unit + ' on hand, ' + s.free + ' free for this job' + (s.onOrder ? ', ' + s.onOrder + ' on order' : '')) + '">' + (s.short ? 'Short ' + s.short + ' ' + esc(s.unit) : '✓ ' + s.free + ' ' + esc(s.unit) + ' free') + (s.onOrder ? ' · ' + s.onOrder + ' on order' : '') + '</span>' + (lock ? '' : '<button class="btn btn-sm bom-pk" data-blink type="button" title="Change the stock item (Inventory)">📦</button>');
    };
    // v100: numbered lines, a search and quick filters, compact rows
    var BF = { all: ['All', function () { return true; }], check: ['To check', function (l) { return !l.checked; }], noprice: ['No price', function (l) { return !(Number(l.price) > 0); }] };
    var fk = BF[S.bomF] ? S.bomF : 'all', q = String(S.bomQ || '').toLowerCase().trim();
    var vis = function (l) { return BF[fk][1](l) && (!q || [l.name, l.note, l.unit].join(' ').toLowerCase().indexOf(q) >= 0); }, shown = b.lines.filter(vis).length;
    var fbar = '<div class="bom-fbar"><input id="bomQ" type="search" placeholder="Find a material…" value="' + esc(S.bomQ || '') + '" autocomplete="off">' + Object.keys(BF).map(function (k) { var n = b.lines.filter(BF[k][1]).length;
      return k === 'all' || n ? '<button class="bom-chip' + (k === fk ? ' on' : '') + (k === 'noprice' || k === 'short' ? ' warn' : '') + '" data-bomf="' + k + '" type="button">' + BF[k][0] + ' <b>' + n + '</b></button>' : ''; }).join('') +
      '<span class="sp"></span><span class="muted">' + (shown === b.lines.length ? pl(b.lines.length, 'line') : shown + ' of ' + b.lines.length + ' lines') + '</span></div>';
    var rows = b.lines.map(function (l, k) { if (!vis(l)) return ''; var tot = r2((Number(l.qty) || 0) * (Number(l.price) || 0));   // v99: one plain list (no phases)
          return '<tr data-bk="' + k + '" class="' + (l.checked ? 'ok' : '') + '"><td class="bom-no">' + (k + 1) + '</td><td class="c"><label class="bom-ck" title="' + (l.checked ? 'Checked' + (l.checkedBy ? ' by ' + esc(l.checkedBy) : '') : 'Tick when you have checked the quantity and price') + '"><input type="checkbox" data-bf="checked"' + (l.checked ? ' checked' : '') + dis + '></label></td>' +
            '<td><input data-bf="name" value="' + esc(l.name) + '"' + dis + '><div class="bom-tags"><span class="bom-src">' + (BOM_SRC[l.source] || '') + '</span>' + (l.est ? '<span class="est-tag" title="An estimate (AI or template): check it">≈ est</span>' : '') + (l.note ? '<small class="muted">' + esc(l.note) + '</small>' : '') + '</div></td>' +
            '<td class="num"><input data-bf="qty" type="number" min="0" step="any" value="' + l.qty + '"' + dis + '></td><td><input data-bf="unit" value="' + esc(l.unit) + '" class="bom-u"' + dis + '></td>' +
            '<td class="num"><input data-bf="price" type="number" min="0" step="any" value="' + l.price + '"' + (!(Number(l.price) > 0) ? ' class="bom-zero" title="No price: this line adds $0 to the quote"' : '') + dis + '></td><td class="num"><b>' + money(tot) + '</b></td>' +
            '<td class="num"><input data-bf="lead" type="number" min="0" max="365" value="' + (l.lead || 0) + '" title="Lead time: working days to arrive after ordering"' + dis + '></td>' +
            (NOINV ? '' : '<td class="bom-stk">' + stockCell(l) + '</td>') + '<td>' + (lock ? '' : '<button class="btn btn-sm bom-del" data-bdel type="button" title="Delete this line" aria-label="Delete line">🗑</button>') + '</td></tr>';
    }).join('');
    var ords = b.orders || {}, still = function (id) { return Math.max(0, q3c(st[id].short - ((ords[id] || {}).qty || 0))); }, toOrder = shorts.filter(function (id) { return still(id) > 0; });   // v92: what has been re-ordered
    var shortHtml = shorts.length ? '<div class="card bom-short' + (toOrder.length ? '' : ' all-ordered') + '"><div class="card-h"><h2>Shortfall: ' + pl(shorts.length, 'item') + '</h2><span class="bom-ostat">' + (shorts.length - toOrder.length ? '<span class="ok">✓ ' + (shorts.length - toOrder.length) + ' ordered</span>' : '') + (toOrder.length ? '<span class="bad">' + toOrder.length + ' still to order</span>' : '') + '</span><span class="sp"></span>' +
      (toOrder.length > 1 && !lock ? '<button class="btn btn-sm" id="bomMarkSel" type="button" disabled title="Tick the items you ordered, then record how (phone, email, online)">✓ Mark ticked as ordered</button>' : '') +
      (shorts.some(function (id) { return st[id].lead > 0; }) && !lock ? '<button class="btn btn-sm" id="bomOrdT" type="button" title="Add a task to order each long-lead item, linked before the task that needs it">＋ Ordering tasks for long-lead items</button>' : '') + '</div>' +
      '<p class="muted" style="margin:-4px 0 8px;font-size:12.5px"><b>Re-order</b> opens Inventory\'s re-order (call or email the supplier); it is marked here when you mark it ordered by phone or send the email. Ordered some other way, or no supplier saved? Press <b>✓ Mark ordered</b> and say how.</p>' +
      '<div class="table-wrap bom-scroll"><table class="mini bom-otbl"><colgroup><col style="width:34px">' + (toOrder.length > 1 && !lock ? '<col style="width:32px">' : '') + '<col><col style="width:86px"><col style="width:64px"><col style="width:86px"><col style="width:52px"><col style="width:330px"></colgroup><thead><tr><th class="bom-no">#</th>' + (toOrder.length > 1 && !lock ? '<th class="c"><input type="checkbox" id="bomOAll" title="Tick all still to order"></th>' : '') + '<th>Item</th><th class="num">Needed</th><th class="num">Free</th><th class="num">Short</th><th class="num">Lead</th><th>Order</th></tr></thead><tbody>' +
      shorts.slice().sort(function (a, c) { return (still(c) > 0) - (still(a) > 0) || (st[c].lead || 0) - (st[a].lead || 0) || String(st[a].name).localeCompare(String(st[c].name)); }).map(function (id, n) { var s = st[id], o = ords[id], left = still(id);
        return '<tr class="' + (left ? '' : 'bom-done') + '"><td class="bom-no">' + (n + 1) + '</td>' + (toOrder.length > 1 && !lock ? '<td class="c">' + (left ? '<input type="checkbox" data-bosel="' + esc(id) + '">' : '') + '</td>' : '') + '<td><b>' + esc(s.name) + '</b>' + (s.nostock ? ' <small class="bom-ns bom-nsb">not in Inventory</small>' : '') + '</td><td class="num">' + s.need + ' ' + esc(s.unit) + '</td><td class="num">' + s.free + '</td><td class="num' + (left ? ' bad' : '') + '"><b>' + s.short + ' ' + esc(s.unit) + '</b></td><td class="num">' + (s.lead ? s.lead + ' d' : '–') + '</td><td class="bom-ocell"><div class="bom-oact">' +
          (o ? '<span class="bom-ord" title="' + esc('Recorded by ' + (o.by || '') + (o.ref ? ', order ' + o.ref : '')) + '">' + (VIA_IC[o.via] || '✓') + ' ' + esc(o.qty + ' ' + s.unit) + ' ordered by ' + esc(o.via) + ' · ' + esc(dmy(new Date(o.at).toISOString().slice(0, 10))) + (o.supplier ? ' · ' + esc(o.supplier) : '') + (o.expected ? ' · due ' + esc(dmy(o.expected)) : '') + '</span>' + (lock ? '' : ' <button class="btn btn-sm bom-oundo" data-bundo="' + esc(id) + '" type="button" title="Not ordered after all: undo">↶</button>') : '') +
          (left && !lock ? (o ? '<small class="bad bom-left">' + left + ' ' + esc(s.unit) + ' still to order</small>' : '') + (s.nostock ? '<button class="btn btn-sm" data-binvl="' + esc(id) + '" type="button" title="Add it to Inventory, so it can be re-ordered from a supplier and tracked in stock">＋ Add to Inventory</button>' : '<button class="btn btn-sm btn-gold" data-bro="' + esc(id) + '" type="button">Re-order ' + left + '</button>') + ' <button class="btn btn-sm" data-bmark="' + esc(id) + '" type="button">✓ Mark ordered</button>' : left ? '<span class="bad">' + left + ' ' + esc(s.unit) + ' to order</span>' : '') + '</div></td></tr>'; }).join('') +
      '</tbody></table></div></div>' : '';
    var ms = bomMs(), msN = ms ? S.plan.tasks.indexOf(ms) + 1 : 0, bs = S.plan.tasks.filter(function (t) { return t.id === b.buildStart; })[0];
    var place = ms ? '<div class="bom-place"><span>🧱 In the Gantt chart: milestone <b>#' + msN + ' Bill of Materials</b>' + (ms.es ? ' on ' + esc(dmy(ms.es)) : '') + ', just before</span>' +
      (lock ? '<b>' + esc(bs ? bs.name : 'the end') + '</b>' : '<select id="bomBefore" title="Where the build (physical work) starts: the materials are needed before it"><option value="">– the end of the plan –</option>' + S.plan.tasks.filter(function (t) { return t.id !== ms.id; }).map(function (t) { return '<option value="' + esc(t.id) + '"' + (bs && bs.id === t.id ? ' selected' : '') + '>#' + (S.plan.tasks.indexOf(t) + 1) + ' ' + esc(t.name.slice(0, 70)) + '</option>'; }).join('') + '</select>') +
      '<small class="muted">where the build starts. All the materials are costed and set aside there.</small></div>' : '';
    B.innerHTML = bomPhases() + '<div class="card"><div class="card-h"><h2>🧱 Bill of Materials: ' + esc(S.plan.name) + '</h2><span class="bom-pill ' + (lock ? 'ok' : '') + '">' + (lock ? '✓ Signed off' : 'Draft') + '</span><span class="sp"></span>' +
        (lock ? '' : '<button class="btn btn-sm" id="bomAi" type="button"' + (bomHas() ? ' disabled title="One BOM per project: delete this BOM first to generate a new one"' : '') + '>✨ Draft with AI</button><button class="btn btn-sm" id="bomAdd" type="button">＋ Line</button>' + (NOINV ? '' : '<button class="btn btn-sm" id="bomStock" type="button" title="Pick materials from Inventory">📦 From stock</button>') + '') +
        '<button class="btn btn-sm" id="bomTpl" type="button"' + (bomHas() ? ' disabled title="One BOM per project: delete this BOM first to generate a new one"' : '') + '>📋 Templates</button><button class="btn btn-sm" id="bomDoc" type="button">📄 Document</button><button class="btn btn-sm" id="bomXls" type="button">⬇ Excel</button><button class="btn btn-sm btn-danger-soft" id="bomDel" type="button" title="Delete the whole BOM: its lines, its milestone and its materials in the costing">🗑 Delete BOM</button>' +
        (lock ? '<button class="btn btn-sm" id="bomOpen" type="button">🔓 Reopen</button>' : '<button class="btn btn-sm btn-gold" id="bomSign" type="button"' + (b.lines.length && T.checked === b.lines.length && !T.noTask && !T.zero ? '' : ' disabled title="' + (T.zero ? 'Every line needs a price first (no $0 lines)' : T.noTask ? 'Link every line to a task first (so its cost is in the plan)' : 'Tick every line as checked first') + '"') + '>✍ Sign off</button>') + '</div>' +
      '<div class="bom-kpi"><span><b>' + pl(b.lines.length, 'line') + '</b></span><span>Value <b>' + money(T.value) + '</b> ex GST</span><span>' + (lock ? 'In the costing' : 'In the costing once signed off') + ' <b>' + money(lock ? T.inPlan : T.value) + '</b></span>' + (T.value - T.inPlan > 0.005 ? '<span class="bad" title="Lines not linked to a task: the quote adds them as a separate line, but the plan budget does not have them">Not in the budget <b>' + money(r2(T.value - T.inPlan)) + '</b></span>' : '') + '<span>Checked <b>' + T.checked + ' / ' + b.lines.length + '</b></span>' +
        '' + (shorts.length ? (toOrder.length ? '<span class="bad">To order: <b>' + toOrder.length + '</b></span>' : '<span class="ok">✓ Shortfall ordered</span>') : '') + (T.noItem && !NOINV ? '<span>Not in stock: <b>' + T.noItem + '</b></span>' : '') + '</div>' +
      place + (lock ? '<p class="bom-signed">✍ Signed off by <b>' + esc(b.signedBy) + '</b>' + (b.signedRole ? ', ' + esc(b.signedRole) : '') + ' on ' + esc(dmy(new Date(b.signedAt).toISOString().slice(0, 10))) + (b.sig ? ' · signature: <i>' + esc(b.sig) + '</i>' : '') + '. The BOM is locked: to change it, reopen it with a reason' + ' (raise a 🔁 change request where it changes the contract or budget).</p>' : '') +
      (T.zero && !lock ? '<div class="est-warn bom-zwarn"><div class="est-ic">$</div><div class="est-tx"><b>' + pl(T.zero, 'line') + ' with no price</b> (highlighted): ' + (T.zero === 1 ? 'it adds' : 'they add') + ' $0 to the plan and the quote, so the job would be under-priced. Put in the unit price (ex GST). The BOM can\'t be signed off until every line has a price.</div></div>' : '') +
      (T.est && !lock ? '<div class="est-warn"><div class="est-ic">⚠</div><div class="est-tx"><b>' + pl(T.est, 'line') + ' marked ≈ est</b> came from the AI or a template: check the quantity and price of each (and the waste allowance) against the drawings and supplier quotes, then tick it as checked.</div></div>' : '') +
      (T.noItem && !lock && !NOINV ? '<p class="muted" style="font-size:12.5px;margin:6px 0">Every line is costed: the 🧱 Bill of Materials milestone and the quote include it. Lines that are not in Inventory are not set aside or tracked in stock: press <b>＋ Add to Inventory</b> (or 📦 to pick an existing stock item)' + (T.noItem > 1 ? ', or <button class="btn btn-sm" id="bomInvAll" type="button">＋ Add all ' + T.noItem + ' to Inventory</button>' : '') + '.</p>' : '') +
      (b.lines.length ? fbar + '<div class="table-wrap bom-scroll"><table class="rt bom-tbl"><thead><tr><th class="bom-no">#</th><th class="c" title="Checked">✓</th><th class="bom-mat">Material</th><th class="num">Qty</th><th>Unit</th><th class="num">Unit $</th><th class="num">Total</th><th class="num" title="Lead time (working days)">Lead</th>' + (NOINV ? '' : '<th>Stock</th>') + '<th></th></tr></thead><tbody>' + rows +
        (rows ? '' : '<tr><td colspan="10" class="empty" style="padding:14px">No lines match. <button class="btn btn-sm" data-bomf="all" type="button">Show all</button></td></tr>') + (lock ? '' : '<tr class="bom-addrow"><td></td><td></td><td colspan="8"><button class="btn btn-sm" id="bomAdd2" type="button">＋ Add a line</button> <small class="muted">Anything else the project needs: type it in.</small></td></tr>') +
        '</tbody><tfoot><tr><td></td><td></td><td colspan="4"><b>Total materials</b> <small class="muted">(' + pl(b.lines.length, 'line') + ')</small> <small class="muted">ex GST</small></td><td class="num"><b>' + money(T.value) + '</b></td><td colspan="3"></td></tr></tfoot></table></div>'
        : '<div class="empty">No lines yet. ✨ Draft with AI, apply a 📋 template, or ＋ add a line.</div>') + '</div>' + shortHtml +
      ((b.log || []).length ? '<details class="card bom-log"><summary><b>History</b> (' + b.log.length + ')</summary><ul>' + b.log.slice().reverse().map(function (x) { return '<li><small class="muted">' + esc(new Date(x.at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Sydney' })) + '</small> ' + esc(x.what) + '</li>'; }).join('') + '</ul></details>' : '');
    bomWire(B, b, st);
  }
  function bomWire(B, b, st) {
    var line = function (el) { var tr = el.closest('tr[data-bk]'); return b.lines[+tr.getAttribute('data-bk')]; };
    B.querySelectorAll('[data-bf]').forEach(function (el) {
      el.onchange = function () {
        var l = line(el), k = el.getAttribute('data-bf');
        if (k === 'checked') { l.checked = el.checked; l.checkedBy = el.checked ? bomMe() : ''; if (el.checked) l.est = false; return bomSave((el.checked ? 'BOM line checked: ' : 'BOM line unticked: ') + l.name); }
        var v = el.value;
        if (k === 'qty' || k === 'price') v = Math.max(0, parseFloat(v) || 0); if (k === 'lead') v = Math.max(0, Math.min(365, parseInt(v, 10) || 0));
        if (k === 'name') { v = String(v).trim(); if (!v) { el.value = l.name; return; } }
        if (l[k] === v) return;
        l[k] = k === 'qty' ? q3c(v) : k === 'price' ? r2(v) : v;
        if (l.checked && k !== 'task') { l.checked = false; l.checkedBy = ''; }   // a changed line needs checking again
        bomSave('BOM line ' + l.name + ': ' + k);
      };
    });
    B.querySelectorAll('[data-bdel]').forEach(function (el) { el.onclick = function () { var l = line(el); b.lines.splice(b.lines.indexOf(l), 1); bomLog('Line deleted: ' + l.qty + ' ' + l.unit + ' ' + l.name + ' by ' + bomMe()); bomSave('BOM line deleted'); }; });
    B.querySelectorAll('[data-bmatch]').forEach(function (el) { el.onclick = function () { var l = line(el), i = invItem(el.getAttribute('data-bmatch')); l.item = i.id; if (!l.price && i.price) l.price = i.price; l.unit = i.unit || l.unit; bomSave('BOM line linked to stock'); }; });
    B.querySelectorAll('[data-blink]').forEach(function (el) { el.onclick = function () { var l = line(el); M.inv.pick(l.item, function (i) { M.closeModal(); var was = invItem(l.item);
      // v95: the line takes the stock item's name (unless someone typed their own name for it)
      if (i && (!String(l.name || '').trim() || /^new material$/i.test(String(l.name).trim()) || (was && l.name === was.name) || !l.item)) l.name = i.name;
      l.item = i ? i.id : ''; if (i) { S.inv = S.inv || {}; S.inv[i.id] = i; l.unit = i.unit || l.unit; if (!l.price && i.price) l.price = i.price; l.checked = false; l.checkedBy = ''; } bomSave('BOM line stock item'); }); }; });
    B.querySelectorAll('[data-binv]').forEach(function (el) { el.onclick = function () { el.disabled = true; bomToInv([line(el)]); }; });
    var left = function (id) { return Math.max(0, q3c(st[id].short - (((b.orders || {})[id] || {}).qty || 0))); };
    B.querySelectorAll('[data-bro]').forEach(function (el) { el.onclick = function () { var id = el.getAttribute('data-bro'); M.inv.reorder(id, left(id), function (o) { bomOrdered([id], o, st); }); }; });   // v92: marked here once ordered
    B.querySelectorAll('[data-binvl]').forEach(function (el) { el.onclick = function () { var l = b.lines.filter(function (x) { return x.id === el.getAttribute('data-binvl'); })[0]; if (l) { el.disabled = true; bomToInv([l]); } }; });   // v96
    B.querySelectorAll('[data-bmark]').forEach(function (el) { el.onclick = function () { bomMarkDialog([el.getAttribute('data-bmark')], st); }; });
    B.querySelectorAll('[data-bundo]').forEach(function (el) { el.onclick = function () { bomUnorder(el.getAttribute('data-bundo'), st); }; });
    var osel = function () { return Array.prototype.map.call(B.querySelectorAll('[data-bosel]:checked'), function (x) { return x.getAttribute('data-bosel'); }); }, ms = $('#bomMarkSel');
    B.querySelectorAll('[data-bosel]').forEach(function (x) { x.onchange = function () { var n = osel().length; ms.disabled = !n; ms.textContent = n ? '✓ Mark ' + n + ' as ordered' : '✓ Mark ticked as ordered'; }; });
    var oa = $('#bomOAll'); if (oa) oa.onchange = function () { var c = this.checked; B.querySelectorAll('[data-bosel]').forEach(function (x) { x.checked = c; }); var n = osel().length; ms.disabled = !n; ms.textContent = n ? '✓ Mark ' + n + ' as ordered' : '✓ Mark ticked as ordered'; };
    if (ms) ms.onclick = function () { var ids = osel(); if (ids.length) bomMarkDialog(ids, st); };
    var on = function (id, f) { var e = $('#' + id); if (e) e.onclick = f; };
    on('bomInvAll', function () { this.disabled = true; bomToInv(b.lines.filter(function (l) { return !l.item; })); });
    B.querySelectorAll('[data-bomf]').forEach(function (x) { x.onclick = function () { S.bomF = x.getAttribute('data-bomf'); bomTab(); }; });   // v100
    var bq = $('#bomQ'); if (bq) bq.oninput = function () { S.bomQ = this.value; var pos = this.selectionStart; bomTab(); var i = $('#bomQ'); if (i) { i.focus(); try { i.setSelectionRange(pos, pos); } catch (e) {} } };
    var ph = $('#bomPh'); if (ph) ph.ontoggle = function () { S.bomPhOpen = ph.open; };
    var bb = $('#bomBefore'); if (bb) bb.onchange = function () { var t = S.plan.tasks.filter(function (x) { return x.id === bb.value; })[0] || null; bomPlace(t); bomLog('🧱 Bill of Materials milestone moved before ' + (t ? '“' + t.name + '”' : 'the end') + ' by ' + bomMe()); bomSave('BOM milestone moved'); toast('The 🧱 Bill of Materials milestone is now before ' + (t ? '“' + t.name + '”' : 'the end of the plan')); };   // v99
    var addLine = function (task) { b.lines.push(bomLine({ name: 'New material', source: 'manual', task: task || '', qty: 1 })); bomSave('BOM line added'); var k = b.lines.length - 1; setTimeout(function () { var r = B.querySelector('tr[data-bk="' + k + '"] [data-bf=name]'); if (r) { r.focus(); r.select(); r.scrollIntoView({ block: 'center' }); } }, 30); };
    B.querySelectorAll('[data-gadd]').forEach(function (x) { x.onclick = function () { addLine(x.getAttribute('data-gadd')); }; });   // v94
    B.querySelectorAll('[data-gstock]').forEach(function (x) { x.onclick = function () { bomStockDialog(x.getAttribute('data-gstock')); }; });
    on('bomStock', function () { bomStockDialog(''); }); on('bomStock2', function () { bomStockDialog(''); }); on('bomAdd2', function () { addLine(''); });
    on('bomAdd', function () { b.lines.push(bomLine({ name: 'New material', source: 'manual' })); bomSave('BOM line added'); setTimeout(function () { var r = B.querySelector('tr[data-bk="' + (b.lines.length - 1) + '"] [data-bf=name]'); if (r) { r.focus(); r.select(); } }, 30); });
    on('bomAi', bomAiDialog); on('bomTpl', bomTplDialog); on('bomSign', bomSignDialog); on('bomOpen', bomReopenDialog); on('bomDel', bomDelete); on('bomOrdT', function () { bomOrderTasks(st); });
    on('bomDoc', function () {
      M.modal('<h2>📄 Bill of Materials</h2><p class="muted">The BOM by task with quantities, prices and lead times, and the sign-off (or a sign-off block while it is a draft).</p><div class="actions"><button class="btn" data-close type="button">Cancel</button><button class="btn" id="bdDocx" type="button">⬇ Word</button><button class="btn btn-gold" id="bdPdf" type="button">⬇ PDF</button></div>');
      var go = function (fmt) { M.report[fmt](bomSnapshot()).then(function (r) { M.report.save(r.blob, r.name); M.closeModal(); toast((fmt === 'pdf' ? 'PDF' : 'Word') + ' ready'); }).catch(fail); };
      $('#bdPdf').onclick = function () { go('pdf'); }; $('#bdDocx').onclick = function () { go('docx'); };
    });
    on('bomXls', bomExcel);
  }
  // v92: re-orders. Recorded on the BOM (how, how many, from whom, when due) and in Inventory as "on order"
  var VIA_IC = { phone: '📞', email: '✉', online: '🌐', 'in person': '🤝', other: '✓' };
  function bomOrdered(ids, o, st) {
    var b = bomOf(); if (!b) return; b.orders = b.orders || {};
    ids.forEach(function (id) { var prev = b.orders[id], q = ids.length === 1 && o.qty ? o.qty : Math.max(0, q3c(st[id].short - ((prev || {}).qty || 0)));
      b.orders[id] = { qty: q3c(((prev || {}).qty || 0) + q), via: o.via, supplier: o.supplier || (prev || {}).supplier || '', ref: o.ref || (prev || {}).ref || '', expected: o.expected || (prev || {}).expected || '', at: Date.now(), by: bomMe() }; });
    bomLog((ids.length === 1 ? (st[ids[0]] || {}).name + ': ' + b.orders[ids[0]].qty + ' ' + ((st[ids[0]] || {}).unit || '') : pl(ids.length, 'item')) + ' ordered by ' + o.via + (o.supplier ? ' from ' + o.supplier : '') + (o.expected ? ', due ' + dmy(o.expected) : '') + ' (' + bomMe() + ')');
    bomSave('BOM: re-order recorded'); bomLoadStock().then(function () { if (S.tab === 'bom') bomTab(); });
  }
  function bomMarkDialog(ids, st) {
    var one = ids.length === 1 ? st[ids[0]] : null, b = bomOf(), lead = Math.max.apply(null, ids.map(function (id) { return st[id].lead || 0; }).concat([0]));
    var due = lead ? toS(new Date(toD(today()).getTime() + Math.ceil(lead * 7 / 5) * 864e5)) : '';
    var left = function (id) { return Math.max(0, q3c(st[id].short - (((b.orders || {})[id] || {}).qty || 0))); };
    M.modal('<h2>✓ Mark as ordered</h2><p class="muted" style="margin:-4px 0 10px">' + (one ? '<b>' + esc(one.name) + '</b>: ' + left(ids[0]) + ' ' + esc(one.unit) + ' to order.' : pl(ids.length, 'item') + ': ' + esc(ids.map(function (id) { return st[id].name; }).slice(0, 8).join(', ') + (ids.length > 8 ? ' …' : '')) + ', each for the quantity still to order.') + ' It is recorded on the BOM and shows as on order in Inventory.</p>' +
      '<form class="form" id="moF"><div class="full est-opts bom-via">' + ['phone', 'email', 'online', 'in person', 'other'].map(function (v, k) { return '<label><input type="radio" name="via" value="' + v + '"' + (k ? '' : ' checked') + '> <span><b>' + VIA_IC[v] + ' ' + v.charAt(0).toUpperCase() + v.slice(1) + '</b></span></label>'; }).join('') + '</div>' +
      (one ? '<label>Quantity ordered (' + esc(one.unit) + ')<input name="qty" type="number" min="0" step="any" required value="' + left(ids[0]) + '"></label>' : '') +
      '<label>Supplier<input name="sup" maxlength="120" placeholder="e.g. Bunnings Trade, Reece"></label><label>Order or quote number <small class="muted">(optional)</small><input name="ref" maxlength="60"></label>' +
      '<label>Expected delivery<input name="exp" type="date" value="' + esc(due) + '"></label>' +
      '<div class="actions full"><button class="btn" data-close type="button">Cancel</button><button class="btn btn-gold" type="submit">✓ Mark ' + (one ? '' : ids.length + ' ') + 'as ordered</button></div></form>');
    $('#moF').onsubmit = function (e) {
      e.preventDefault(); var f = this, via = f.querySelector('[name=via]:checked').value, o = { via: via, supplier: f.sup.value.trim(), ref: f.ref.value.trim(), expected: f.exp.value, qty: one ? Math.max(0, parseFloat(f.qty.value) || 0) : 0 };
      var bt = f.querySelector('button[type=submit]'); bt.disabled = true;
      var chain = Promise.resolve();
      ids.forEach(function (id) { var q = one ? o.qty : left(id); chain = chain.then(function () { if (st[id].nostock) return null; return api('invOrdered', { id: id, qty: q, expected: o.expected, via: via }); }); });
      chain.then(function () { M.closeModal(); bomOrdered(ids, o, st); toast((one ? one.name : pl(ids.length, 'item')) + ' marked as ordered (' + via + ')'); }).catch(function (er) { bt.disabled = false; fail(er); });
    };
  }
  function bomUnorder(id, st) {
    var b = bomOf(), o = (b.orders || {})[id], s = st[id]; if (!o) return;
    M.confirmBox('Undo the order for ' + s.name + '?', 'It goes back to “still to order” on the BOM. ' + (o.qty >= (s.onOrder || 0) ? 'Inventory stops showing it as on order.' : 'Inventory keeps the other jobs\' orders for it.'), 'Undo the order').then(function (y) {
      if (!y) return;
      (!s.nostock && o.qty >= (s.onOrder || 0) ? api('invOrdered', { id: id, qty: 0 }) : Promise.resolve()).then(function () {
        delete b.orders[id]; bomLog('Order undone: ' + s.name + ' (' + bomMe() + ')'); bomSave('BOM: order undone'); return bomLoadStock();
      }).then(function () { if (S.tab === 'bom') bomTab(); }).catch(fail);
    });
  }
  // v94: 📦 pick materials straight from Inventory: any number, each with a quantity, onto a task
  function bomStockDialog(task) {
    if (!M.inv) return toast('Inventory is not available', true);
    var pick = [], all = [];
    var draw = function () {
      var q = (($('#bsQ') || {}).value || '').toLowerCase(), tot = pick.reduce(function (a, m) { return a + (Number(m.qty) || 0) * (Number(m.price) || 0); }, 0);
      $('#bsRows').innerHTML = pick.length ? '<table class="mt-tbl"><thead><tr><th>Stock item</th><th class="num">Qty</th><th>Unit</th><th class="num">Unit $</th><th class="num">Total</th><th class="num">Available</th><th></th></tr></thead><tbody>' + pick.map(function (m, k) { var x = m.it;
        return '<tr data-sk="' + k + '"><td><b>' + esc(x.name) + '</b></td><td class="num"><input data-sq type="number" min="0" step="any" value="' + m.qty + '" style="width:80px"></td><td>' + esc(x.unit || '') + '</td><td class="num"><input data-sp type="number" min="0" step="any" value="' + m.price + '" style="width:90px"' + (m.price > 0 ? '' : ' class="bom-zero"') + '></td><td class="num"><b>' + money((Number(m.qty) || 0) * (Number(m.price) || 0)) + '</b></td><td class="num">' + x.available + ' ' + esc(x.unit || '') + '</td><td><button class="btn btn-sm" data-sdel type="button">✕</button></td></tr>'; }).join('') +
        '</tbody><tfoot><tr><td colspan="4"><b>Adding</b></td><td class="num"><b>' + money(tot) + '</b></td><td colspan="2"></td></tr></tfoot></table>' : '<div class="empty" style="padding:12px">Press a stock item below to add it.</div>';
      var have = pick.map(function (m) { return m.it.id; });
      $('#bsList').innerHTML = all.filter(function (i) { return !q || [i.name, i.sku, i.category].join(' ').toLowerCase().indexOf(q) >= 0; }).slice(0, 60).map(function (i) { var on = have.indexOf(i.id) >= 0;
        return '<button class="item pk' + (on ? ' on' : '') + '" data-sadd="' + esc(i.id) + '" type="button"><div style="text-align:left"><b>' + esc(i.name) + '</b>' + (on ? ' <small class="muted">(added: + adds 1 more)</small>' : '') + '<br><small>' + [i.sku, i.category].filter(Boolean).map(esc).join(' · ') + '</small></div><div style="text-align:right"><b>' + i.available + ' ' + esc(i.unit) + '</b><br><small>' + (i.price ? money(i.price) + '/' + esc(i.unit) : 'no price') + '</small></div></button>'; }).join('') || '<div class="empty">No stock items' + (q ? ' match' : ' yet') + '.</div>';
      var MB = $('#modalBody');
      MB.querySelectorAll('tr[data-sk]').forEach(function (tr) { var m = pick[+tr.getAttribute('data-sk')];
        tr.querySelector('[data-sq]').onchange = function () { m.qty = Math.max(0, parseFloat(this.value) || 0); draw(); };
        tr.querySelector('[data-sp]').onchange = function () { m.price = Math.max(0, parseFloat(this.value) || 0); draw(); };
        tr.querySelector('[data-sdel]').onclick = function () { pick.splice(+tr.getAttribute('data-sk'), 1); draw(); }; });
      MB.querySelectorAll('[data-sadd]').forEach(function (bt) { bt.onclick = function () { var id = bt.getAttribute('data-sadd'), x = all.filter(function (i) { return i.id === id; })[0], m = pick.filter(function (y) { return y.it.id === id; })[0];
        if (m) m.qty = q3c(m.qty + 1); else pick.push({ it: x, qty: 1, price: x.price || 0 }); draw(); }; });
    };
    M.inv.load().then(function (d) {
      all = (d.items || []).filter(function (i) { return !i.archived; }); S.inv = S.inv || {}; all.forEach(function (i) { S.inv[i.id] = i; });
      M.modal('<h2>📦 Add from Inventory</h2><p class="muted" style="margin:-4px 0 6px">Pick the stock items and their quantities: they go into the Bill of Materials.</p>' +
        '<div id="bsRows" style="margin-top:10px"></div><h3 style="font-size:14px;margin:14px 0 6px">Stock</h3><input id="bsQ" placeholder="Search stock: name, code or category…" autocomplete="off"><div class="list" id="bsList" style="margin-top:8px;max-height:34vh;overflow:auto"></div>' +
        '<div class="actions" style="justify-content:space-between;margin-top:12px"><a class="btn" href="#inventory">Manage stock</a><span><button class="btn" data-close type="button">Cancel</button> <button class="btn btn-gold" id="bsSave" type="button">Add to the BOM</button></span></div>');
      $('#modal .modal-card').classList.add('sc-wide'); $('#bsQ').oninput = draw; draw(); $('#bsQ').focus();
      $('#bsSave').onclick = function () {
        var b = bomOf(), tk = (bomMs() || {}).id || '', n = 0; if (!pick.length) return M.closeModal();
        pick.forEach(function (m) { if (!(m.qty > 0)) return; var ex = b.lines.filter(function (l) { return l.item === m.it.id && l.task === tk; })[0];
          if (ex) { ex.qty = q3c(ex.qty + m.qty); if (m.price > 0) ex.price = r2(m.price); ex.checked = false; ex.checkedBy = ''; } else b.lines.push(bomLine({ task: tk, name: m.it.name, item: m.it.id, qty: m.qty, unit: m.it.unit || 'each', price: m.price, source: 'manual' })); n++; });
        bomLog(pl(n, 'stock item') + ' added from Inventory by ' + bomMe()); M.closeModal(); bomSave('BOM: lines from stock'); bomLoadStock().then(function () { if (S.tab === 'bom') bomTab(); });
        toast(pl(n, 'stock item') + ' added to the BOM');
      };
    }).catch(fail);
  }
  function bomToInv(lines) {   // ＋ Add to Inventory: a stock item for each unmatched line (no stock on hand yet), then link it
    var n = 0, chain = Promise.resolve();
    lines.forEach(function (l) { chain = chain.then(function () { return M.inv.save({ name: l.name, unit: l.unit, category: 'From BOM', onHand: 0, notes: 'Added from the BOM of ' + (S.job.ref || S.plan.name) }).then(function (r) { var b0 = bomOf(); if (b0 && b0.orders && b0.orders[l.id]) { b0.orders[r.item.id] = b0.orders[l.id]; delete b0.orders[l.id]; } l.item = r.item.id; S.inv = S.inv || {}; S.inv[r.item.id] = r.item; n++; }); }); });
    chain.then(function () { bomLog(pl(n, 'material') + ' added to Inventory by ' + bomMe()); bomSync(); return saveNow('BOM materials added to Inventory'); }).then(bomLoadStock).then(function () { bomTab(); toast(pl(n, 'material') + ' added to Inventory (no stock yet: re-order the shortfall)'); })
      .catch(function (e) { fail(e); bomTab(); });
  }
  function bomOrderTasks(st) {   // a task to order each long-lead shortfall item, linked before the task that needs it
    var p = S.plan, b = bomOf(), made = 0;
    Object.keys(st).forEach(function (id) {
      var s = st[id]; if (!(s.short > 0 && s.lead > 0)) return;
      var name = 'Order: ' + s.name; if (p.tasks.some(function (t) { return t.name === name; })) return;
      var users = s.nostock ? (s.task ? [s.task] : []) : b.lines.filter(function (l) { return l.item === id && l.task; }).map(function (l) { return l.task; }), first = p.tasks.filter(function (t) { return users.indexOf(t.id) >= 0; })[0];
      var t = { id: 't' + Date.now().toString(36) + made, phase: first ? first.phase : (p.phases[0] || {}).id, name: name, dur: s.lead, res: [], lead: '', resource: '', qty: 0, unit: '', rate: 0, actual: 0, pct: 0, status: 'todo', pred: [], snet: '', notes: 'Order ' + s.short + ' ' + s.unit + ' (lead time ' + s.lead + ' working days). From the BOM.' };
      p.tasks.splice(first ? p.tasks.indexOf(first) : p.tasks.length, 0, t);
      p.tasks.forEach(function (x) { if (users.indexOf(x.id) >= 0 && x.pred.indexOf(t.id) < 0) x.pred.push(t.id); });
      made++;
    });
    if (!made) return toast('The ordering tasks are already in the plan');
    bomLog(pl(made, 'ordering task') + ' added to the plan by ' + bomMe()); bomSave('Ordering tasks added from the BOM');
    toast(pl(made, 'ordering task') + ' added to the schedule, linked before the tasks that need them');
  }
  function bomSignDialog() {
    var b = bomOf(), T = bomTotals(b);
    M.modal('<h2>✍ Sign off the BOM</h2><p class="muted" style="margin:-4px 0 10px">' + pl(b.lines.length, 'line') + ', ' + money(T.value) + ' ex GST, every line checked. Once signed, the BOM is locked.</p>' +
      '<form class="form" id="bsF"><label>Name<input name="by" required maxlength="80" value="' + esc((S.plan.charter || {}).manager || bomMe()) + '"></label><label>Role<select name="role">' + CR_ROLES.map(function (r) { return '<option>' + r + '</option>'; }).join('') + '</select></label>' +
      '<label class="full">Signature <small class="muted">(type your full name)</small><input name="sig" required maxlength="80" class="cr-sigin" autocomplete="off"></label>' +
      '<div class="actions full"><button class="btn" data-close type="button">Cancel</button><button class="btn btn-gold" type="submit">✍ Sign off</button></div></form>');
    $('#bsF').onsubmit = function (e) {
      e.preventDefault(); var f = this;
      b.status = 'Signed off'; b.signedBy = f.by.value.trim(); b.signedRole = f.role.value; b.sig = f.sig.value.trim(); b.signedAt = Date.now();
      bomLog('Signed off by ' + b.signedBy + ', ' + b.signedRole + ' (' + money(T.value) + '): added to the costing'); M.closeModal(); bomSync(); dirty('BOM signed off: ' + money(T.value) + ' added to the costing');
      toast('✍ BOM signed off: ' + money(T.value) + ' added to the 💰 Costing as materials'); location.hash = '#plan/' + S.core + '/budget';
    };
  }
  // 🗑 delete the whole BOM: lines, the 🧱 milestone (the plan keeps its order) and its materials come out of the costing
  function bomDelete() {
    var p = S.plan, b = bomOf(); if (!b) return; var T = bomTotals(b), signed = b.status === 'Signed off';
    M.confirmBox('Delete the Bill of Materials?', pl(b.lines.length, 'line') + ' (' + money(T.value) + ' ex GST)' + (signed ? ', signed off by ' + esc(b.signedBy || '') : '') + ' and the 🧱 Bill of Materials milestone are removed' + (signed ? ', and ' + money(T.value) + ' comes out of the 💰 Costing' : '') + '.', 'Delete the BOM').then(function (ok) {
      if (!ok) return;
      var ms = bomMs();
      if (ms) { var before = ms.pred || []; p.tasks.splice(p.tasks.indexOf(ms), 1);
        p.tasks.forEach(function (t) { if ((t.pred || []).indexOf(ms.id) >= 0) t.pred = t.pred.filter(function (x) { return x !== ms.id; }).concat(before.filter(function (x) { return (t.pred || []).indexOf(x) < 0; })); }); }   // whatever followed the milestone now follows what came before it
      p.tasks.forEach(function (t) { t.mats = []; delete t.bomx; }); p.bomLoose = 0; delete p.bom;
      dirty('BOM deleted (' + money(T.value) + (signed ? ', out of the costing' : '') + ')'); render();
      toast('🗑 BOM deleted' + (signed ? ': ' + money(T.value) + ' taken out of the costing' : ''));
    });
  }
  function bomReopenDialog() {
    var b = bomOf();
    M.modal('<h2>🔓 Reopen the BOM</h2><p class="muted" style="margin:-4px 0 10px">It was signed off by ' + esc(b.signedBy) + '. Say why it needs to change: the reason is kept in its history. While it is reopened its materials come out of the costing; sign it off again to put them back.</p>' +
      '<form class="form" id="boF"><label class="full">Reason<textarea name="why" rows="2" required maxlength="280"></textarea></label><div class="actions full"><button class="btn" data-close type="button">Cancel</button><button class="btn btn-gold" type="submit">🔓 Reopen</button></div></form>');
    $('#boF').onsubmit = function (e) {
      e.preventDefault(); var why = this.why.value.trim(); if (!why) return;
      bomLog('Reopened by ' + bomMe() + ' (was signed off by ' + b.signedBy + '): ' + why); b.status = 'Draft'; b.signedBy = ''; b.signedRole = ''; b.sig = ''; b.signedAt = 0;
      M.closeModal(); bomSave('BOM reopened'); toast('BOM reopened: its materials are out of the costing until it is signed off again');
    };
  }
  function bomAiDialog() {   // v99: the whole job, physical materials only
    if (bomHas()) return toast('This project already has a BOM. Delete it first (🗑 Delete BOM) to generate a new one.', true);
    var b = bomOf(), aiN = b.lines.filter(function (l) { return l.source === 'ai' && !l.checked; }).length;
    M.modal('<h2>✨ Draft the BOM with AI</h2><p class="muted" style="margin:-4px 0 10px">The AI reads the plan, the scope and our stock catalogue and lists the <b>physical materials</b> the build needs (no services, fees, approvals, reports or labour), with quantities, waste allowance and Sydney trade prices, using our stock items where they match. It also says where the build starts, for the 🧱 Bill of Materials milestone. Every line comes in marked <span class="est-tag">≈ est</span> for you to check.</p>' +
      '<label>Anything the AI should know? <small class="muted">(optional)</small><input id="bomNote" maxlength="300" placeholder="e.g. 18 m² deck, hardwood boards, galvanised fixings, 600 mm footings"></label>' +
      (aiN ? '<label class="sc-cb" style="margin-top:10px"><input type="checkbox" id="bomRepl" checked style="width:auto"> Replace the ' + pl(aiN, 'AI line') + ' not checked yet (lines you added or checked are kept)</label>' : '') +
      '<div class="actions"><button class="btn" data-close type="button">Cancel</button><button class="btn btn-gold" id="bomGo" type="button">✨ Draft the materials</button></div>');
    $('#bomGo').onclick = function () { S.bomRepl = !!($('#bomRepl') && $('#bomRepl').checked); bomAiRun([], $('#bomNote').value.trim()); };
  }
  function bomAiRun(only, note) {
    var core = S.core, id = rid(), t0 = Date.now(); S.bomAiId = id;
    M.modal('<h2>✨ Bill of Materials</h2><p class="ask-think">The AI is working out the materials for ' + pl(only.length, 'task') + '… this usually takes 20 to 90 seconds.</p><div class="actions"><button class="btn" data-close type="button">Cancel</button></div>');
    var poll = function () {
      return new Promise(function (res) { setTimeout(res, 2000); }).then(function () { return api('planAiStatus', { id: id }); }).then(function (d) {
        if (S.bomAiId !== id) return;
        if (d.status === 'done' && d.bom) { S.bomAiId = null; if (S.core === core) bomAiShow(d.bom); return; }
        if (d.status === 'error') throw new Error(d.error || 'The AI could not draft the BOM');
        if (Date.now() - t0 > 290000) throw new Error('The AI is taking too long. Try again in a minute.');
        return poll();
      });
    };
    (S.timer ? saveNow() : (S.q || Promise.resolve())).then(function () {
      return fetch('/.netlify/functions/planai-background', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-MBS-Admin': '1', 'X-Champ-Lang': (window.ChampI18n && window.ChampI18n.get()) || 'en' }, body: JSON.stringify({ id: id, mode: 'bom', core: core, only: only, note: note }) });
    }).then(function (r) { if (r.status === 401 || r.status === 403) throw new Error('Your session has ended, or you cannot edit projects.'); if (r.status >= 400) throw new Error('Could not start the AI (' + r.status + ')'); return poll(); })
      .catch(function (e) { if (S.bomAiId !== id) return; S.bomAiId = null; M.closeModal(); fail(e); });
  }
  function bomAiShow(r) {
    var num = {}, by = {}; S.plan.tasks.forEach(function (t, i) { num[t.id] = i + 1; by[t.id] = t; });
    var L = r.lines, tot = r2(L.reduce(function (a, l) { return a + l.qty * l.price; }, 0));
    M.modal('<h2>✨ Suggested materials: ' + pl(L.length, 'line') + ', ' + money(tot) + '</h2>' +
      '<div class="est-warn est-in-dlg"><div class="est-ic">⚠</div><div class="est-tx"><b>Estimates only.</b> Check each quantity, waste allowance and price against the drawings and supplier quotes before you order. Lines stay marked <span class="est-tag">≈ est</span> until you tick them as checked.' + (r.caveat ? '<br><i>Double-check: ' + esc(r.caveat) + '</i>' : '') + '</div></div>' +
      '<div class="table-wrap" style="max-height:46vh;overflow:auto"><table class="mini est-tbl"><thead><tr><th><input type="checkbox" id="baAll" checked title="All"></th><th>Material</th><th class="num">Qty</th><th>Unit</th><th class="num">Unit $</th><th class="num">Total</th><th>Stock</th></tr></thead><tbody>' +
      L.map(function (l, k) { var i = invItem(l.item); return '<tr><td><input type="checkbox" data-ba="' + k + '" checked></td><td>' + esc(l.name) + (l.note ? '<br><small class="muted">' + esc(l.note) + '</small>' : '') + (l.lead ? '<br><small>lead ' + l.lead + ' d</small>' : '') + '</td><td class="num">' + l.qty + '</td><td>' + esc(l.unit) + '</td><td class="num">' + money(l.price) + '</td><td class="num"><b>' + money(r2(l.qty * l.price)) + '</b></td><td>' + (i ? '📦 ' + esc(i.name.slice(0, 26)) : '<span class="muted">not in stock</span>') + '</td></tr>'; }).join('') +
      '</tbody></table></div>' + (r.buildStart && by[r.buildStart] && r.buildStart !== (bomOf() || {}).buildStart ? '<label class="sc-cb" style="margin-top:10px"><input type="checkbox" id="baMs" checked style="width:auto"> Put the 🧱 Bill of Materials milestone before <b>#' + num[r.buildStart] + ' ' + esc(by[r.buildStart].name) + '</b> (the AI says the build starts there)</label>' : '') +
      '<div class="actions"><button class="btn" data-close type="button">Cancel</button><button class="btn btn-gold" id="baGo" type="button">' + (S.bomRepl ? 'Replace the AI lines with the ticked lines' : 'Add the ticked lines to the BOM') + '</button></div>');
    $('#modal .modal-card').classList.add('sc-wide');
    $('#baAll').onchange = function () { var c = this.checked; document.querySelectorAll('[data-ba]').forEach(function (x) { x.checked = c; }); };
    $('#baGo').onclick = function () {
      var b = bomOf(), add = [], gone = 0;
      if ($('#baMs') && $('#baMs').checked) bomPlace(by[r.buildStart]);
      if (S.bomRepl) { var keep = b.lines.filter(function (l) { return !(l.source === 'ai' && !l.checked); }); gone = b.lines.length - keep.length; b.lines = keep; }
      document.querySelectorAll('[data-ba]:checked').forEach(function (x) { var l = L[+x.getAttribute('data-ba')]; add.push(bomLine({ task: '', name: l.name, item: l.item, qty: l.qty, unit: l.unit, price: l.price, lead: l.lead, note: l.note, source: 'ai', est: true })); });
      if (!add.length && !gone) return M.closeModal();
      b.lines = b.lines.concat(add); bomLog(pl(add.length, 'line') + ' drafted by the AI, added by ' + bomMe() + (gone ? ' (replacing ' + pl(gone, 'earlier AI line') + ')' : ''));
      M.closeModal(); bomSave('BOM: ' + add.length + ' AI lines'); bomLoadStock().then(bomTab);
      toast(pl(add.length, 'line') + ' added (≈ est): check each one, then tick it');
    };
  }
  // 📋 reusable templates: save this BOM, or apply one (scaled) to this job, matched to its tasks by name
  function bomTplDialog() {
    if (bomHas()) return toast('This project already has a BOM. Delete it first (🗑 Delete BOM) to generate a new one from a template.', true);
    var b = bomOf(), lock = bomLocked();
    M.modal('<h2>📋 BOM templates</h2><p class="muted" style="margin:-4px 0 10px">Save a BOM you trust (e.g. a standard bathroom) and use it on the next similar job. Lines are matched to this job\'s tasks by name and marked ≈ est to check.</p><div id="btList"><p class="ask-think">Loading…</p></div>' +
      (b.lines.length ? '<h3 style="font-size:14px;margin:16px 0 6px">Save this BOM as a template</h3><form class="form" id="btF"><label>Name<input name="name" required maxlength="100" placeholder="e.g. Standard bathroom 2.4 × 1.8 m"></label><label>Kind of job<input name="kind" maxlength="80" placeholder="e.g. Bathroom renovation" value="' + esc(S.job.service || '') + '"></label>' +
        '<div class="actions full"><button class="btn btn-gold" type="submit">💾 Save as a template (' + pl(b.lines.length, 'line') + ')</button></div></form>' : '') +
      '<div class="actions"><button class="btn" data-close type="button">Close</button></div>');
    var list = function () {
      api('planBomTplList').then(function (d) {
        var T = d.templates || [];
        $('#btList').innerHTML = T.length ? '<div class="list">' + T.map(function (t) { return '<div class="item"><div><b>' + esc(t.name) + '</b> <small class="muted">' + esc(t.id) + '</small><br><small>' + [t.kind, pl(t.lines, 'line'), money(t.value)].filter(Boolean).map(esc).join(' · ') + '</small></div><div class="nowrap">' +
          (lock ? '' : '<button class="btn btn-sm btn-gold" data-tapply="' + esc(t.id) + '" type="button">Use on this job</button> ') + '<button class="btn btn-sm" data-tdel="' + esc(t.id) + '" type="button" title="Delete the template">🗑</button></div></div>'; }).join('') + '</div>' : '<div class="empty">No templates yet.</div>';
        document.querySelectorAll('[data-tapply]').forEach(function (x) { x.onclick = function () { bomTplApply(x.getAttribute('data-tapply')); }; });
        document.querySelectorAll('[data-tdel]').forEach(function (x) { x.onclick = function () { M.confirmBox('Delete this BOM template?', 'Jobs that already used it keep their lines.', 'Delete', true).then(function (yes) { if (!yes) return bomTplDialog(); return api('planBomTplDelete', { id: x.getAttribute('data-tdel') }).then(function () { toast('Template deleted'); bomTplDialog(); }); }).catch(fail); }; });
      }).catch(fail);
    };
    list();
    var f = $('#btF'); if (f) f.onsubmit = function (e) {
      e.preventDefault(); var by = {}; S.plan.tasks.forEach(function (t) { by[t.id] = t; });
      api('planBomTplSave', { name: f.name.value.trim(), kind: f.kind.value.trim(), lines: b.lines.map(function (l) { return { name: l.name, item: l.item, qty: l.qty, unit: l.unit, price: l.price, lead: l.lead, note: l.note, taskHint: l.task && by[l.task] ? by[l.task].name : '' }; }) })
        .then(function (r) { bomLog('Saved as template ' + r.template.id + ' ' + r.template.name + ' by ' + bomMe()); dirty('BOM saved as a template'); toast('Template saved: ' + r.template.name); bomTplDialog(); }).catch(fail);
    };
  }
  function bomTaskFor(hint) {   // the task on this job that best matches a template line's task name
    var h = String(hint || '').toLowerCase().trim(); if (!h) return '';
    var words = function (s) { return s.toLowerCase().split(/[^a-z0-9]+/).filter(function (w) { return w.length > 2; }); }, hw = words(h), best = '', score = 0;
    S.plan.tasks.forEach(function (t) {
      var n = t.name.toLowerCase().trim(); if (n === h) { best = t.id; score = 9; return; }
      var tw = words(n), common = hw.filter(function (w) { return tw.indexOf(w) >= 0; }).length, sc = hw.length ? common / Math.max(hw.length, tw.length) : 0;
      if (sc > score && sc >= 0.5) { score = sc; best = t.id; }
    });
    return best;
  }
  function bomTplApply(id) {
    api('planBomTplGet', { id: id }).then(function (d) {
      var t = d.template;
      M.modal('<h2>📋 Use “' + esc(t.name) + '”</h2><p class="muted" style="margin:-4px 0 10px">' + pl(t.lines.length, 'line') + '. Scale the quantities to the size of this job (1 = the same; 1.5 = half as much again).</p>' +
        '<form class="form" id="taF"><label>Scale quantities ×<input name="k" type="number" min="0.05" max="50" step="0.05" value="1" required></label><div class="actions full"><button class="btn" data-close type="button">Cancel</button><button class="btn btn-gold" type="submit">Add to this BOM</button></div></form>');
      $('#taF').onsubmit = function (e) {
        e.preventDefault(); var k = Math.max(0.05, parseFloat(this.k.value) || 1), b = bomOf(), linked = 0;
        var add = t.lines.map(function (l) { linked++; return bomLine({ task: '', name: l.name, item: l.item && invItem(l.item) ? l.item : '', qty: q3c(l.qty * k), unit: l.unit, price: l.price, lead: l.lead, note: l.note, source: 'template', est: true }); });
        b.lines = b.lines.concat(add); b.template = t.id; bomLog('Template ' + t.id + ' ' + t.name + ' applied × ' + k + ' by ' + bomMe() + ' (' + pl(add.length, 'line') + ', ' + linked + ' matched to tasks)');
        M.closeModal(); bomSave('BOM template applied'); bomLoadStock().then(bomTab);
        toast(pl(add.length, 'line') + ' added from the template' + (linked < add.length ? ': ' + (add.length - linked) + ' not matched to a task, link them' : '') + '. Check each one.');
      };
    }).catch(fail);
  }
  function bomSnapshot() {
    var p = S.plan, b = bomOf(), t0 = today(), T = bomTotals(b), st = bomStock(), L = [], no = 'BOM-' + (S.job.ref || S.core);
    L.push({ kind: 'kv', title: '1. Summary', rows: [['Project', p.name + (S.job.ref ? ' (' + S.job.ref + ')' : '')], ['Customer', (p.charter || {}).customer || S.job.name || ''], ['Status', b.status], ['Lines', String(b.lines.length)], ['Total materials', money(T.value) + ' ex GST'], ['Checked', T.checked + ' of ' + b.lines.length]].concat(T.est ? [['Estimates (≈ est)', pl(T.est, 'line') + ' still to check']] : []) });
    var rows = [];
    bomGroups(b).forEach(function (g) {
      rows.push([{ t: g.t ? '#' + g.n + ' ' + g.t.name : 'Not linked to a task', b: true, fill: [240, 236, 222] }, { t: '', fill: [240, 236, 222] }, { t: '', fill: [240, 236, 222] }, { t: '', fill: [240, 236, 222] }, { t: money(r2(g.rows.reduce(function (a, x) { return a + x.l.qty * x.l.price; }, 0))), b: true, fill: [240, 236, 222] }, { t: '', fill: [240, 236, 222] }, { t: '', fill: [240, 236, 222] }]);
      g.rows.forEach(function (x) { var l = x.l, s = l.item ? st[l.item] : null; rows.push([l.name + (l.est ? ' (≈ est)' : '') + (l.note ? '. ' + l.note : ''), String(l.qty), l.unit, money(l.price), money(r2(l.qty * l.price)), !l.item ? 'Not in stock' : s && s.short ? 'Short ' + s.short : 'In stock', l.checked ? 'Yes' : 'No']); });
    });
    rows.push([{ t: 'Total materials (ex GST)', b: true }, '', '', '', { t: money(T.value), b: true }, '', '']);
    L.push({ kind: 'table', title: '2. Materials by task', head: ['Material', 'Qty', 'Unit', 'Unit $', 'Total', 'Stock', 'Checked'], wordCols: [6, 1, 1, 1.5, 1.5, 1.5, 1], cols: { 1: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } }, rows: rows });
    var sh = Object.keys(st).filter(function (id) { return st[id].short > 0; });
    var ords = b.orders || {};
    L.push({ kind: 'table', title: '3. To order (shortfall)', head: ['Item', 'Needed', 'Free in stock', 'Short', 'Lead time', 'Ordered'], wordCols: [4, 1.3, 1.3, 1.3, 1.5, 3.5], rows: sh.map(function (id) { var s = st[id], o = ords[id], left = Math.max(0, q3c(s.short - ((o || {}).qty || 0)));
      return [s.name, s.need + ' ' + s.unit, String(s.free), { t: s.short + ' ' + s.unit, rag: left ? 'R' : 'G' }, s.lead ? s.lead + ' working days' : '–', o ? o.qty + ' ' + s.unit + ' by ' + o.via + ', ' + dmy(new Date(o.at).toISOString().slice(0, 10)) + (o.supplier ? ', ' + o.supplier : '') + (o.ref ? ' (' + o.ref + ')' : '') + (o.expected ? ', due ' + dmy(o.expected) : '') + (left ? '. ' + left + ' still to order' : '') : 'Not yet']; }), always: true, empty: 'Nothing to order: the stock covers this BOM.' });
    if (b.status === 'Signed off') L.push({ kind: 'kv', title: '4. Sign-off', rows: [['Signed off by', b.signedBy + (b.signedRole ? ', ' + b.signedRole : '')], ['Date', dmy(new Date(b.signedAt).toISOString().slice(0, 10))]].concat(b.sig ? [['Signed', b.sig + ' (typed signature)']] : []) });
    else L.push({ kind: 'sign', title: '4. Checked and signed off', intro: 'Every line checked against the drawings and supplier quotes.', rows: [{ role: 'Estimator', name: '' }, { role: 'Project manager', name: (p.charter || {}).manager || '' }] });
    if ((b.log || []).length) L.push({ kind: 'table', title: '5. History', head: ['When', 'What'], wordCols: [2, 7], cols: { 0: { cellWidth: 34 } }, rows: b.log.map(function (x) { return [new Date(x.at).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Sydney' }), x.what]; }) });
    return { id: 'bom' + Date.now().toString(36), full: true, no: 1, title: 'BILL OF MATERIALS', date: t0, headRight: [no + '  ·  ' + b.status, 'Issued ' + dmy(t0), S.job.ref || ''], footer: no + '  ·  ' + p.name.slice(0, 70),
      project: { name: p.name, ref: S.job.ref }, sections: L, fileBase: no.replace(/[^\w.-]+/g, '-') };
  }
  function bomExcel() {
    var b = bomOf(), st = bomStock();
    loadXls().then(function (XL) {
      var wb = new XL.Workbook(), ws = wb.addWorksheet('BOM'), money$ = '"$"#,##0.00', num = {};
      S.plan.tasks.forEach(function (t, i) { num[t.id] = i + 1; });
      ws.columns = [{ width: 8 }, { width: 34 }, { width: 40 }, { width: 10 }, { width: 9 }, { width: 12 }, { width: 13 }, { width: 8 }, { width: 18 }, { width: 10 }, { width: 10 }];
      ws.addRow(['Bill of Materials: ' + S.plan.name + (S.job.ref ? ' (' + S.job.ref + ')' : '')]).font = { bold: true, size: 14 };
      ws.addRow([b.status + (b.signedBy ? ', signed off by ' + b.signedBy : '') + ' · ' + dmy(today())]);
      ws.addRow([]);
      var h = ws.addRow(['Task #', 'Task', 'Material', 'Qty', 'Unit', 'Unit $', 'Total', 'Lead', 'Stock', 'Checked', 'Estimate']); h.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      h.eachCell(function (c) { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2A44' } }; });
      var first = 5;
      bomGroups(b).forEach(function (g) { g.rows.forEach(function (x) {
        var l = x.l, s = l.item ? st[l.item] : null, r = ws.addRow([g.t ? g.n : '', g.t ? g.t.name : '(not linked)', l.name, l.qty, l.unit, l.price, null, l.lead || '', !l.item ? 'Not in stock' : s && s.short ? 'Short ' + s.short : 'In stock', l.checked ? 'Yes' : 'No', l.est ? '≈ est' : '']);
        r.getCell(7).value = { formula: 'D' + r.number + '*F' + r.number, result: r2(l.qty * l.price) }; r.getCell(6).numFmt = money$; r.getCell(7).numFmt = money$;
      }); });
      var last = ws.rowCount, tr = ws.addRow(['', '', 'Total materials (ex GST)', '', '', '', null]);
      tr.getCell(7).value = { formula: 'SUM(G' + first + ':G' + Math.max(first, last) + ')', result: bomTotals(b).value }; tr.getCell(7).numFmt = money$; tr.font = { bold: true };
      ws.views = [{ state: 'frozen', ySplit: 4 }];
      return wb.xlsx.writeBuffer();
    }).then(function (buf) {
      M.report.save(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), ('BOM-' + (S.job.ref || S.core) + '-' + today()).replace(/[^\w.-]+/g, '-') + '.xlsx'); toast('Excel ready');
    }).catch(fail);
  }
  function changeTab() {
    var p = S.plan; p.changes = p.changes || []; var L = p.changes.slice().sort(function (a, b) { return b.num - a.num; }), B = $('#planBody');
    var open = L.filter(function (c) { return !CR_DONE[c.status]; }), cnt = {}; L.forEach(function (c) { cnt[c.status] = (cnt[c.status] || 0) + 1; });
    var cur = S.crView ? p.changes.filter(function (c) { return c.id === S.crView; })[0] : null;
    var steps = [['📝', 'Raised', 'From a meeting, Project Intelligence or by hand'], ['🔍', 'Impact assessed', 'Scope, time, cost, quality, risks, issues, stakeholders'], ['👥', 'Reviewed', 'At a change control meeting where needed'],
      ['✍', 'Approved and signed', 'By the project manager or project director (or the board)'], ['✅', 'Added to the plan', 'Schedule, scope, risk, issue and stakeholder registers']];
    B.innerHTML = '<div class="card"><div class="card-h"><h2>🔁 Change control</h2><span class="sp"></span><button class="btn btn-sm" id="crMeet" type="button"' + (open.length ? '' : ' disabled') + ' title="Call a change control meeting to review the open change requests">📞 Call a change control meeting</button>' +
        '<button class="btn btn-sm" id="crReg" type="button"' + (L.length ? '' : ' disabled') + ' title="The change register as a PDF or Word document">📄 Change register</button><button class="btn btn-sm btn-gold" id="crAdd" type="button">＋ New change request</button></div>' +
      '<p class="muted" style="margin:-4px 0 10px">Every proposed change to scope, time, cost, quality, risks, issues or stakeholders comes here first. <b>Nothing goes into the plan or the registers until it is approved and signed</b> by the project manager or project director (or the change control board).</p>' +
      '<ol class="cr-flow">' + steps.map(function (x, i) { return '<li><span>' + x[0] + '</span><b>' + (i + 1) + '. ' + x[1] + '</b><small>' + x[2] + '</small></li>'; }).join('') + '</ol>' +
      (L.length ? '<div class="cr-cnt">' + Object.keys(CR_CLS).filter(function (k) { return cnt[k]; }).map(function (k) { return '<span class="cr-st ' + CR_CLS[k] + '">' + k + ': ' + cnt[k] + '</span>'; }).join('') + '</div>' +
        '<div class="table-wrap"><table class="rt cr-tbl"><thead><tr><th>CR</th><th>Change</th><th>Raised</th><th>Time</th><th>Cost</th><th>Priority</th><th>Status</th><th>Decision</th></tr></thead><tbody>' +
        L.map(function (c) { var d = crDelta(c); return '<tr data-crid="' + esc(c.id) + '" class="' + (cur && cur.id === c.id ? 'on' : '') + '"><td class="nowrap"><b>' + crNo(c) + '</b></td><td>' + esc(c.title) + '<br><small class="muted">' + esc(CR_SRC[c.source] || '') + '</small></td><td class="nowrap">' + esc(dmy(new Date(c.raisedAt).toISOString().slice(0, 10))) + '</td>' +
          '<td class="nowrap ' + (d.days > 0 ? 'bad' : '') + '">' + (d.days ? (d.days > 0 ? '+' : '') + d.days + ' d' : '–') + (d.est && d.days ? '*' : '') + '</td><td class="nowrap num ' + (d.cost > 0 ? 'bad' : '') + '">' + (d.cost ? (d.cost > 0 ? '+' : '−') + money(Math.abs(d.cost)) : '–') + (d.est && d.cost ? '*' : '') + '</td>' +
          '<td>' + esc(c.priority) + '</td><td><span class="cr-st ' + CR_CLS[c.status] + '">' + esc(c.status) + '</span>' + (c.ccb && !CR_DONE[c.status] ? '<br><small class="muted">meeting ' + esc(dmy(c.ccb)) + '</small>' : '') + '</td>' +
          '<td>' + (c.decision ? esc(c.decision.outcome) + ' by ' + esc(c.decision.by) + '<br><small class="muted">' + esc(c.decision.role) + ', ' + esc(dmy(new Date(c.decision.at).toISOString().slice(0, 10))) + '</small>' : '<span class="muted">Waiting</span>') + '</td></tr>'; }).join('') + '</tbody></table></div>'
        : '<div class="empty">No change requests yet. Changes from meetings (📞 Comms) and Project Intelligence come here when you press <b>➜ Send to change control</b>, or raise one with <b>＋ New change request</b>.</div>') + '</div>' +
      (cur ? crCard(cur) : '');
    B.querySelectorAll('tr[data-crid]').forEach(function (tr) { tr.onclick = function () { S.crView = S.crView === tr.getAttribute('data-crid') ? '' : tr.getAttribute('data-crid'); changeTab(); var k = $('#crCard'); if (k) k.scrollIntoView({ block: 'start', behavior: 'smooth' }); }; });
    $('#crAdd').onclick = crAddDialog; $('#crMeet').onclick = function () { crMeetDialog(); }; $('#crReg').onclick = function () { crDocDialog(null); };
    if (cur) crWire(cur);
    crRecCard(); crBackfill();
  }
  function crRecCard() {
    var core = S.core, pb = $('#planBody'); if (!pb) return; var box = document.createElement('div'); box.className = 'card cr-recs'; box.id = 'crRecs'; pb.appendChild(box);
    box.innerHTML = '<div class="card-h"><h2>📁 Decision records</h2></div><p class="muted">Loading…</p>';
    (S.crRecs && S.crRecs.core === core ? Promise.resolve(S.crRecs) : api('intelCrList', { core: core }).then(function (d) { S.crRecs = { core: core, list: d.records || [] }; return S.crRecs; })).then(function (R) {
      var el = $('#crRecs'); if (!el || S.core !== core) return;
      var L = R.list.slice().sort(function (a, b) { return b.at - a.at; });
      el.innerHTML = '<div class="card-h"><h2>📁 Decision records (' + L.length + ')</h2></div>' +
        '<p class="muted" style="margin:-4px 0 10px">Every approval, rejection or deferral is kept in the database with its signed PDF and who decided. Open them here, query them in Ask (table <code>change_records</code>), and Project Intelligence reads them.</p>' +
        (L.length ? '<div class="table-wrap"><table class="rt"><thead><tr><th>CR</th><th>Change</th><th>Decision</th><th>By</th><th>Date</th><th>Effect</th><th></th></tr></thead><tbody>' + L.map(function (r) {
          return '<tr><td class="nowrap"><b>' + esc(r.cr) + '</b></td><td>' + esc(r.title) + (r.direct ? '<br><small class="muted">Applied directly (no board review)</small>' : '') + '</td><td>' + esc(r.outcome) + '</td>' +
            '<td>' + esc(r.by) + '<br><small class="muted">' + esc(r.role) + (r.sig ? ' · signed' : '') + '</small></td><td class="nowrap">' + esc(new Date(r.at).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })) + '</td>' +
            '<td class="nowrap"><small>' + (r.f0 || r.f1 ? 'Finish ' + esc(dmy(r.f0)) + ' → ' + esc(dmy(r.f1)) + '<br>' : '') + (r.b0 || r.b1 ? 'Budget ' + money(r.b0) + ' → ' + money(r.b1) : '') + '</small></td>' +
            '<td>' + (r.hasPdf ? '<button class="btn btn-sm" type="button" data-crpdf="' + esc(r.key) + '">⬇ PDF</button>' : '') + '</td></tr>'; }).join('') + '</tbody></table></div>'
          : '<div class="empty">No decisions yet. When a change request is approved, rejected or deferred, its signed PDF is kept here.</div>');
      el.querySelectorAll('[data-crpdf]').forEach(function (b) { b.onclick = function () { b.disabled = true; api('intelCrGet', { core: core, key: b.getAttribute('data-crpdf') }).then(function (f) {
        var bin = atob(f.file), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); M.report.save(new Blob([u], { type: 'application/pdf' }), f.name); }).catch(fail).then(function () { b.disabled = false; }); }; });
    }).catch(function (e) { var el = $('#crRecs'); if (el) el.innerHTML = '<div class="card-h"><h2>📁 Decision records</h2></div><p class="bad">' + esc(e.message || e) + '</p>'; });
  }
  function crCard(c) {
    var lock = CR_DONE[c.status], d = crDelta(c), dec = c.decision;
    var info = [['Raised', dmy(new Date(c.raisedAt).toISOString().slice(0, 10)) + (c.raisedBy ? ' by ' + c.raisedBy : '')], ['Source', (CR_SRC[c.source] || '') + (c.srcTitle ? ': ' + c.srcTitle : '')],
      ['Effect on the plan', d.est ? (d.days || d.cost ? crImpTxt(d) + ' (estimate)' : 'Not assessed yet') : 'Finish ' + dmy(d.R0.finish) + ' → ' + dmy(d.R1.finish) + ' · budget ' + money(d.R0.BAC) + ' → ' + money(d.R1.BAC) + ' (' + crImpTxt(d) + ')']];
    var acts = lock ? '' : '<div class="cr-acts">' + (c.status === 'Proposed' ? '<button class="btn" type="button" data-cra="review">🔍 Start the review</button>' : '') +
      '<button class="btn" type="button" data-cra="meet">📞 Take it to a change control meeting</button><span class="sp"></span><button class="btn" type="button" data-cra="Deferred">⏸ Defer</button><button class="btn" type="button" data-cra="Rejected">✕ Reject</button>' +
      '<button class="btn btn-gold" type="button" data-cra="Approved">✍ Approve and sign</button></div>';
    var decision = dec ? '<div class="cr-dec cr-dec-' + dec.outcome.toLowerCase() + '"><div><b>' + esc(dec.outcome) + '</b> by <b>' + esc(dec.by) + '</b>, ' + esc(dec.role) + ' · ' + esc(new Date(dec.at).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Sydney' })) +
      (dec.sig ? '<span class="cr-sig">' + esc(dec.sig) + '</span>' : '') + (dec.note ? '<br><small>' + esc(dec.note) + '</small>' : '') +
      (c.status === 'Implemented' ? '<br><small class="good">✓ Added to the plan and registers ' + esc(dmy(new Date(c.implementedAt).toISOString().slice(0, 10))) + '</small>' : '') + '</div>' +
      (S.crUndo && S.crUndo.core === S.core && S.crUndo.id === c.id ? '<button class="btn btn-sm" type="button" data-cra="undo">↶ Undo</button>' : '') + '</div>' : '';
    return '<div class="card cr-card" id="crCard"><div class="card-h"><h2>' + crNo(c) + ' · ' + esc(c.title) + '</h2><span class="cr-st ' + CR_CLS[c.status] + '">' + esc(c.status) + '</span><span class="sp"></span>' +
      '<button class="btn btn-sm" type="button" data-crdoc>📄 PDF / Word</button><button class="btn btn-sm" type="button" data-cra="close" title="Close">✕</button></div>' +
      '<div class="cr-info">' + info.map(function (x) { return '<div><small>' + esc(x[0]) + '</small><b>' + esc(x[1]) + '</b></div>'; }).join('') +
        '<div><small>Priority</small>' + (lock ? '<b>' + esc(c.priority) + '</b>' : '<select data-crf="priority" style="width:auto">' + ['Low', 'Medium', 'High', 'Urgent'].map(function (x) { return '<option' + (c.priority === x ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select>') + '</div></div>' +
      '<div class="cr-tx"><label>What is the change?<textarea data-crf="desc" rows="2" maxlength="4000"' + (lock ? ' readonly' : '') + '>' + esc(c.desc) + '</textarea></label><label>Why is it needed? (justification)<textarea data-crf="reason" rows="2" maxlength="2000"' + (lock ? ' readonly' : '') + '>' + esc(c.reason) + '</textarea></label></div>' +
      (c.items ? impactHtml(c.items, null, c) + (lock ? '' : '<p style="margin:6px 0 0"><button class="btn btn-sm" type="button" data-cra="assess">↻ Assess the impact again with AI</button></p>')
        : '<div class="cr-noimp"><b>No impact assessment yet.</b> ' + (lock ? '' : 'Let the AI work out what this change means for the plan (tasks, dates, costs, scope, risks, issues, stakeholders, quality), or put in your own estimate.') +
          (lock ? '' : '<div class="row" style="gap:8px;margin-top:8px;align-items:center"><button class="btn btn-gold btn-sm" type="button" data-cra="assess">✨ Assess the impact with AI</button><label class="cr-est">Time (days)<input data-crf="estDays" type="number" value="' + (c.estDays || 0) + '"></label><label class="cr-est">Cost ($)<input data-crf="estCost" inputmode="decimal" value="' + (c.estCost || 0) + '"></label></div>') + '</div>') +
      decision + acts +
      '<details class="cr-log"><summary>History (' + (c.log || []).length + ')</summary><ul>' + (c.log || []).slice().reverse().map(function (x) { return '<li><small>' + esc(new Date(x.at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Sydney' })) + '</small> ' + esc(x.what) + '</li>'; }).join('') + '</ul></details></div>';
  }
  function crWire(c) {
    var box = $('#crCard'); if (!box) return;
    if (c.items) impactWire(box, c.items, null, changeTab, c);
    box.querySelectorAll('[data-crf]').forEach(function (el) { var k = el.getAttribute('data-crf');
      el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', function () { c[k] = k === 'estDays' ? Math.round(+el.value || 0) : k === 'estCost' ? r2(String(el.value).replace(/[$,]/g, '')) : el.value; dirty(); }); });
    box.querySelector('[data-crdoc]').onclick = function () { crDocDialog(c); };
    box.querySelectorAll('[data-cra]').forEach(function (b) { b.onclick = function () { var a = b.getAttribute('data-cra');
      if (a === 'close') { S.crView = ''; return changeTab(); }
      if (a === 'review') { c.status = 'Under review'; crLog(c, 'Review started'); dirty(crNo(c) + ' under review'); return changeTab(); }
      if (a === 'meet') return crMeetDialog([c.id]);
      if (a === 'assess') return crAssess(c);
      if (a === 'undo') { var u = S.crUndo; if (!u || u.id !== c.id) return; var keepRev = S.plan.rev; S.plan = normalise(u.plan); S.plan.rev = keepRev; S.crUndo = null; dirty('Undid ' + crNo(c)); changeTab(); return toast(crNo(c) + ' undone: the plan is back as it was and the request is open again'); }
      crSign(c, a);
    }; });
  }
  function crAddDialog() {
    var p = S.plan;
    M.modal('<h2>＋ New change request</h2><p class="muted" style="margin:-4px 0 10px">Raise any change to the scope, schedule, cost, quality, risks or stakeholders. It is reviewed and signed off here before anything in the plan changes.</p>' +
      '<form class="form" id="crForm"><label class="full">Title<input name="title" required maxlength="200" placeholder="e.g. Add a second substation feed"></label>' +
      '<label class="full">What is the change?<textarea name="desc" rows="4" required maxlength="4000" placeholder="What should be added, removed or done differently. Name the tasks, dates and amounts if you know them."></textarea></label>' +
      '<label class="full">Why is it needed? (justification)<textarea name="reason" rows="2" maxlength="2000" placeholder="e.g. Required by the network operator; customer request; design clash"></textarea></label>' +
      '<label>Raised by<input name="raisedBy" maxlength="80" value="' + esc((p.charter || {}).manager || '') + '"></label><label>Priority<select name="priority"><option>Low</option><option selected>Medium</option><option>High</option><option>Urgent</option></select></label>' +
      '<label class="full cr-chk"><input type="checkbox" name="ai" checked> <span>✨ Assess the impact with AI now <small class="muted">(tasks, dates, costs, scope, risks, issues, stakeholders, quality)</small></span></label>' +
      '<div class="full actions"><button class="btn" data-close type="button">Cancel</button><button class="btn btn-gold" type="submit">Raise the change request</button></div></form>');
    $('#crForm').onsubmit = function (e) { e.preventDefault(); var f = e.target;
      var c = crNew({ title: f.title.value.trim(), desc: f.desc.value.trim(), reason: f.reason.value.trim(), raisedBy: f.raisedBy.value.trim(), priority: f.priority.value });
      M.closeModal(); dirty(crNo(c) + ' raised'); S.crView = c.id; S.tab = 'change'; render(); toast(crNo(c) + ' raised');
      if (f.ai.checked) crAssess(c);
    };
  }
  function crAssess(c) {
    if (!String(c.desc || '').trim()) return toast('Describe the change first', true);
    var core = S.core, id = rid(), t0 = Date.now(); S.crAi = id;
    M.modal('<h2>✨ ' + crNo(c) + ': assessing the impact</h2><p class="ask-think">The AI is working out what this change means for the tasks, dates, costs, scope, risks, issues, stakeholders and quality… this usually takes 20–60 seconds.</p><div class="actions"><button class="btn" data-close type="button">Cancel</button></div>');
    var poll = function () { return new Promise(function (res) { setTimeout(res, 2000); }).then(function () { return api('planAiStatus', { id: id }); }).then(function (d) {
      if (S.crAi !== id) return;
      if (d.status === 'done' && d.cr) { S.crAi = null; M.closeModal(); if (S.core !== core) return; var it = d.cr; delete it.tokens; delete it.today; c.items = it; c.picks = {}; crLog(c, 'Impact assessed by AI'); dirty(crNo(c) + ' impact assessed'); S.crView = c.id; if (S.tab === 'change') changeTab(); toast(crNo(c) + ': impact assessed. Untick anything that should not go ahead, then approve and sign.'); return; }
      if (d.status === 'error') throw new Error(d.error || 'The AI could not assess it');
      if (Date.now() - t0 > 250000) throw new Error('The AI is taking too long. Try again in a minute.');
      return poll(); }); };
    (S.timer ? saveNow() : (S.q || Promise.resolve())).then(function () { return fetch('/.netlify/functions/planai-background', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-MBS-Admin': '1', 'X-Champ-Lang': (window.ChampI18n && window.ChampI18n.get()) || 'en' }, body: JSON.stringify({ id: id, mode: 'cr', core: core, title: c.title, text: c.desc + (c.reason ? '\nWhy: ' + c.reason : '') }) }); })
      .then(function (r) { if (r.status >= 400) throw new Error('Could not start the AI (' + r.status + ')'); return poll(); }).catch(function (e) { if (S.crAi !== id) return; S.crAi = null; M.closeModal(); fail(e); });
  }
  function crSign(c, outcome) {
    var p = S.plan, pk = crPicks(c), n = Object.keys(pk).length, d = crDelta(c), ok = outcome === 'Approved';
    M.modal('<h2>' + (ok ? '✍ Approve and sign ' : outcome === 'Rejected' ? '✕ Reject ' : '⏸ Defer ') + crNo(c) + '</h2>' +
      '<p class="muted" style="margin:-4px 0 10px">' + esc(c.title) + (ok && c.items ? '<br>Effect: finish ' + esc(dmy(d.R0.finish)) + ' → <b>' + esc(dmy(d.R1.finish)) + '</b>, budget ' + money(d.R0.BAC) + ' → <b>' + money(d.R1.BAC) + '</b> (' + esc(crImpTxt(d)) + ')' : '') + '</p>' +
      '<form class="form" id="crSignF"><label>Name<input name="by" required maxlength="80" value="' + esc((p.charter || {}).manager || '') + '"></label><label>Role<select name="role">' + CR_ROLES.map(function (r) { return '<option>' + r + '</option>'; }).join('') + '</select></label>' +
      (ok ? '<label class="full">Signature <small class="muted">(type your full name)</small><input name="sig" required maxlength="80" class="cr-sigin" autocomplete="off"></label>' : '') +
      '<label class="full">' + (ok ? 'Conditions or notes (optional)' : 'Reason (required)') + '<textarea name="note" rows="2" maxlength="1000"' + (ok ? '' : ' required') + '></textarea></label>' +
      (ok ? '<label class="full cr-chk"><input type="checkbox" name="go" required> <span><b>I approve ' + crNo(c) + '.</b> ' + (n ? 'The ' + pl(n, 'ticked change') + ' will be added to the plan and registers now (schedule, scope, risks, issues, stakeholders, quality).' : 'There are no plan changes to add; the decision is recorded.') + '</span></label>' : '') +
      '<div class="full actions"><button class="btn" data-close type="button">Cancel</button><button class="btn ' + (ok ? 'btn-gold' : '') + '" type="submit">' + (ok ? '✍ Approve and add to the plan' : outcome === 'Rejected' ? '✕ Reject' : '⏸ Defer') + '</button></div></form>');
    $('#crSignF').onsubmit = function (e) { e.preventDefault(); var f = e.target, by = f.by.value.trim();
      if (ok && f.sig.value.trim().toLowerCase() !== by.toLowerCase()) return toast('The signature must be your full name, as typed in Name', true);
      var msg = crDecide(c, outcome, by, f.role.value, f.note.value.trim(), ok ? f.sig.value.trim() : '');
      M.closeModal(); dirty(msg); changeTab(); toast(msg); crRecord(c);
    };
  }
  // the decision on a change request: recorded, and when approved added to the plan and registers (also used when change control is switched off)
  function crDecide(c, outcome, by, role, note, sig, direct) {
    var ok = outcome === 'Approved', pk = crPicks(c), n = Object.keys(pk).length;
      var snap = JSON.parse(JSON.stringify(S.plan)), d0 = crDelta(c);
      c.effect = { days: d0.days, cost: d0.cost, f0: d0.R0.finish || '', f1: d0.R1.finish || '', b0: d0.R0.BAC || 0, b1: d0.R1.BAC || 0, est: !!d0.est };
      c.decision = { by: by, role: role, at: Date.now(), note: note || '', sig: sig || '', outcome: outcome }; if (direct) c.direct = true;
      c.status = outcome; crLog(c, outcome + ' by ' + by + ' (' + role + ')' + (c.decision.note ? ': ' + c.decision.note : ''));
      var msg = crNo(c) + ' ' + outcome.toLowerCase();
      if (ok && c.items && n) {
        var R0 = rollup(S.plan, today()), k = impactApply(S.plan, c.items, pk, { tag: ' (' + crNo(c) + ')' }), R1 = rollup(S.plan, today());
        if (c.items.replan && c.items.replan.rebaseline) {   // an approved re-plan is the new performance baseline (PMBOK)
          var bp = S.plan; schedule(bp); var bt = {}; bp.tasks.forEach(function (t) { bt[t.id] = { es: t.es, ef: t.ef, cost: cost(t) }; });
          c.prevBaseline = bp.baseline ? { at: bp.baseline.at, finish: bp.baseline.finish, BAC: bp.baseline.BAC } : null;
          bp.baseline = { at: Date.now(), finish: R1.finish, BAC: R1.BAC, tasks: bt }; crLog(c, 'New baseline set: finish ' + dmy(R1.finish) + ', budget ' + money(R1.BAC));
        }
        c.status = 'Implemented'; c.implementedAt = Date.now(); crLog(c, 'Added to the plan and registers: ' + pl(k, 'change') + '. Finish ' + dmy(R0.finish) + ' → ' + dmy(R1.finish) + ', budget ' + money(R0.BAC) + ' → ' + money(R1.BAC));
        if (c.source === 'meeting' && c.srcRef) { var mm = (S.plan.meetings || []).filter(function (x) { return x.id === c.srcRef; })[0]; if (mm) mm.applied = Date.now(); }
        msg = crNo(c) + ' approved and added to the plan: ' + pl(k, 'change') + '. Finish ' + dmy(R1.finish) + ', budget ' + money(R1.BAC);
      }
      S.crUndo = { core: S.core, id: c.id, plan: snap };
      return msg;
  }
  // GKH Project Champ: change control is a module. Switched off (small projects), a change is committed straight away: no review
  function ccOff() { return !!(S.mods && S.mods.change === false); }
  function crCommitNow(c) {
    var me = bomMe(), msg = crDecide(c, 'Approved', me, 'Project manager', 'Change control is switched off for this project: committed straight away, without a review.', '', true);
    dirty(msg); render(); toast('✓ ' + msg.replace(/^CR-\d+ approved and added/, 'Committed and added')); crRecord(c, true); return msg;
  }
  function crMeetDialog(ids) {
    var p = S.plan, open = (p.changes || []).filter(function (c) { return !CR_DONE[c.status]; }).sort(function (a, b) { return a.num - b.num; });
    if (!open.length) return toast('No open change requests');
    var pre = ids || open.map(function (c) { return c.id; });
    M.modal('<h2>📞 Call a change control meeting</h2><p class="muted" style="margin:-4px 0 10px">Pick the change requests for the board to review. The meeting is set up on the 📞 Comms tab with the agenda filled in and the accountable and responsible stakeholders invited; choose the platform there and create it.</p>' +
      '<div class="cr-pick">' + open.map(function (c) { var d = crDelta(c); return '<label><input type="checkbox" value="' + esc(c.id) + '"' + (pre.indexOf(c.id) >= 0 ? ' checked' : '') + '> <span><b>' + crNo(c) + ' ' + esc(c.title) + '</b><small>' + esc(c.status) + ' · ' + esc(crImpTxt(d)) + '</small></span></label>'; }).join('') + '</div>' +
      '<div class="form" style="margin-top:10px"><label>Date<input type="date" id="crMDate" value="' + esc(addWork(nextWork(today()), 1)) + '"></label><label>Start<input type="time" id="crMTime" value="10:00"></label></div>' +
      '<div class="actions"><button class="btn" data-close type="button">Cancel</button><button class="btn btn-gold" id="crMGo" type="button">📞 Set up the meeting</button></div>');
    $('#crMGo').onclick = function () {
      var pick = Array.prototype.map.call(document.querySelectorAll('.cr-pick input:checked'), function (x) { return x.value; }); if (!pick.length) return toast('Pick at least one change request', true);
      var crs = open.filter(function (c) { return pick.indexOf(c.id) >= 0; }), date = $('#crMDate').value || addWork(nextWork(today()), 1);
      crs.forEach(function (c) { c.status = 'CCB meeting'; c.ccb = date; crLog(c, 'Taken to the change control meeting on ' + dmy(date)); });
      var C = cmState(); C.view = '';
      C.d.title = 'Change control meeting: ' + crs.map(crNo).join(', ') + ' (' + p.name + ')'; C.d.date = date; C.d.start = $('#crMTime').value || '10:00'; C.d.minutes = crs.length > 3 ? 60 : 45;
      C.d.agenda = ['Purpose: review the change requests and decide: approve, reject or defer'].concat(crs.map(function (c) { return crNo(c) + ': ' + c.title + ' (' + crImpTxt(crDelta(c)) + ')'; })).concat(['Decisions and sign-off (project manager / project director)', 'Actions and who updates the plan']).join('\n');
      var who = (p.stakeholders || []).filter(function (x) { return /@/.test(x.email || '') && (x.raci === 'A' || x.raci === 'R'); }); if (!who.length) who = (p.stakeholders || []).filter(function (x) { return /@/.test(x.email || ''); });
      C.d.attendees = who.map(function (x) { return x.id; });
      M.closeModal(); dirty('Change control meeting set up for ' + crs.map(crNo).join(', ')); location.hash = '#plan/' + S.core + '/comms';
      toast('Change control meeting filled in: pick the platform and create it');
    };
  }
  function crDocDialog(c) {
    M.modal('<h2>📄 ' + (c ? crNo(c) + ': change request' : 'Change register') + '</h2><p class="muted">' + (c ? 'The change request with its impact, the changes, the effect on the finish date and budget, the decision and signature (or a sign-off block if it is still open), and its history.' : 'Every change request with its impact, status and decision.') + '</p>' +
      '<div class="actions"><button class="btn" data-close type="button">Cancel</button><button class="btn" id="crDocx" type="button">⬇ Word</button><button class="btn btn-gold" id="crPdf" type="button">⬇ PDF</button></div>');
    var go = function (fmt) { var s0 = c ? crSnapshot(c) : crRegSnapshot(); M.report[fmt](s0).then(function (r) { M.report.save(r.blob, r.name); M.closeModal(); toast((fmt === 'pdf' ? 'PDF' : 'Word') + ' ready'); }).catch(fail); };
    $('#crPdf').onclick = function () { go('pdf'); }; $('#crDocx').onclick = function () { go('docx'); };
  }
  function crSnapshot(c) {
    var p = S.plan, t0 = today(), d = crDelta(c), a = c.items, pk = crPicks(c), dec = c.decision, L = [];
    var RG = { High: 'R', Medium: 'A', Low: 'G' };
    L.push({ kind: 'kv', title: '1. Change request', rows: [['Number', crNo(c)], ['Title', c.title], ['Project', p.name + (S.job.ref ? ' (' + S.job.ref + ')' : '')], ['Raised', dmy(new Date(c.raisedAt).toISOString().slice(0, 10)) + (c.raisedBy ? ' by ' + c.raisedBy : '')],
      ['Source', (CR_SRC[c.source] || '').replace(/^\S+\s/, '') + (c.srcTitle ? ': ' + c.srcTitle : '')], ['Priority', c.priority], ['Status', c.status]] });
    L.push({ kind: 'text', title: '2. The change', text: c.desc, always: true, empty: 'Not described.' }, { kind: 'text', title: '3. Justification', text: c.reason, always: true, empty: 'Not stated.' });
    L.push({ kind: 'kv', title: '4. Effect on the plan', rows: d.est ? [['Time', d.days ? pl(d.days, 'day') + ' (estimate)' : 'Not assessed'], ['Cost', d.cost ? money(d.cost) + ' (estimate)' : 'Not assessed']]
      : [['Finish date', dmy(d.R0.finish) + '  →  ' + dmy(d.R1.finish) + (d.days ? '  (' + (d.days > 0 ? '+' : '') + pl(d.days, 'working day') + ')' : '  (no change)')], ['Budget (planned cost)', money(d.R0.BAC) + '  →  ' + money(d.R1.BAC) + (d.cost ? '  (' + (d.cost > 0 ? '+' : '−') + money(Math.abs(d.cost)) + ')' : '  (no change)')]] });
    if (a) {
      L.push({ kind: 'table', title: '5. Impact assessment', head: ['Area', 'Impact', 'What it means'], wordCols: [2, 1, 7], cols: { 0: { cellWidth: 28 }, 1: { cellWidth: 20 } },
        rows: AREA_N.map(function (x) { var v = (a.impact || {})[x[0]] || { level: 'None', text: '' }; return [x[1].replace(/^\S+\s/, ''), { t: v.level, rag: RG[v.level] }, v.text || 'No change']; }) });
      var rows = [], num = {}; p.tasks.forEach(function (t, i) { num[t.id] = i + 1; });
      var add = function (k, i, type, txt) { rows.push([type, txt, pk[k + ':' + i] ? 'Yes' : 'No']); };
      (a.task_changes || []).forEach(function (x, i) { add('t', i, 'Schedule / cost', '#' + (num[x.id] || x.n) + ' ' + x.name + ': ' + [x.durTo !== x.durFrom ? 'days ' + x.durFrom + ' → ' + x.durTo : '', x.notBefore ? 'not before ' + dmy(x.notBefore) : '', x.extra ? '+' + money(x.extra) : ''].filter(Boolean).join(', ') + (x.why ? '. ' + x.why : '')); });
      (a.new_tasks || []).forEach(function (x, i) { add('n', i, 'New task', x.name + ': ' + pl(x.days, 'day') + (x.cost ? ', ' + money(x.cost) : '') + (x.why ? '. ' + x.why : '')); });
      (a.scope_changes || []).forEach(function (x, i) { add('s', i, 'Scope (' + x.type + ')', x.text + (x.why ? '. ' + x.why : '')); });
      (a.risks || []).forEach(function (x, i) { add('r', i, 'Risk', x.title + ' (P' + x.p + ' × I' + x.i + ' = ' + x.p * x.i + ', ' + x.response + ')'); });
      (a.issues || []).forEach(function (x, i) { add('i', i, 'Issue', x.title + ' (' + x.priority + ')'); });
      (a.stakeholders || []).forEach(function (x, i) { add('k', i, 'Stakeholder', x.name + ', ' + x.role + ' (' + x.raci + ')'); });
      (a.quality || []).forEach(function (x, i) { add('q', i, 'Quality', x); });
      L.push({ kind: 'table', title: '6. The changes', head: ['Type', 'Change', 'Goes ahead'], wordCols: [2, 7, 1], cols: { 0: { cellWidth: 30 }, 2: { cellWidth: 20, halign: 'center' } }, rows: rows, always: true, empty: 'No plan changes.' });
    }
    var n = a ? 7 : 5;
    if (dec) L.push({ kind: 'kv', title: n + '. Decision', rows: [['Decision', dec.outcome], ['By', dec.by + ', ' + dec.role], ['Date', new Date(dec.at).toLocaleString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Sydney' })]]
      .concat(dec.sig ? [['Signed', dec.sig + ' (typed signature)']] : []).concat(dec.note ? [['Notes', dec.note]] : []).concat(c.implementedAt ? [['Added to the plan', dmy(new Date(c.implementedAt).toISOString().slice(0, 10))]] : []) });
    else L.push({ kind: 'sign', title: n + '. Decision and sign-off', intro: 'Decision:  ☐ Approved   ☐ Rejected   ☐ Deferred.  Once approved and signed, the changes are added to the plan and registers.', rows: [{ role: 'Project manager', name: (p.charter || {}).manager || '' }, { role: 'Project director', name: '' }, { role: 'Sponsor (customer), where it changes the contract', name: (p.charter || {}).customer || S.job.name || '' }] });
    if ((c.log || []).length) L.push({ kind: 'table', title: (n + 1) + '. History', head: ['When', 'What'], wordCols: [2, 7], cols: { 0: { cellWidth: 34 } }, rows: c.log.map(function (x) { return [new Date(x.at).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Sydney' }), x.what]; }) });
    return { id: 'cr' + Date.now().toString(36), full: true, no: 1, title: 'CHANGE REQUEST ' + crNo(c), date: t0, headRight: [crNo(c) + '  ·  ' + c.status, 'Issued ' + dmy(t0), S.job.ref || ''], footer: crNo(c) + '  ·  ' + p.name.slice(0, 70),
      project: { name: p.name, ref: S.job.ref }, sections: L, fileBase: ((S.job.ref || 'Project') + '-' + crNo(c)).replace(/[^\w.-]+/g, '-') };
  }
  function crRegSnapshot() {
    var p = S.plan, t0 = today(), L = (p.changes || []).slice().sort(function (a, b) { return a.num - b.num; }), cnt = {}; L.forEach(function (c) { cnt[c.status] = (cnt[c.status] || 0) + 1; });
    var RS = { Implemented: 'G', Approved: 'G', Rejected: 'R', Deferred: 'A' };
    return { id: 'crr' + Date.now().toString(36), full: true, no: 1, title: 'CHANGE REGISTER', date: t0, headRight: [pl(L.length, 'change request'), 'Issued ' + dmy(t0), S.job.ref || ''], footer: 'Change register  ·  ' + p.name.slice(0, 70), project: { name: p.name, ref: S.job.ref }, fileBase: ((S.job.ref || 'Project') + '-Change-register').replace(/[^\w.-]+/g, '-'),
      sections: [{ kind: 'kv', title: '1. Summary', rows: [['Project', p.name], ['Change requests', String(L.length)]].concat(Object.keys(CR_CLS).filter(function (k) { return cnt[k]; }).map(function (k) { return [k, String(cnt[k])]; })) },
        { kind: 'table', title: '2. Change requests', head: ['CR', 'Change', 'Raised', 'Time', 'Cost', 'Status', 'Decision'], wordCols: [1, 5, 2, 1, 2, 2, 3], cols: { 0: { cellWidth: 16 }, 2: { cellWidth: 20 }, 3: { cellWidth: 14 }, 4: { cellWidth: 22 }, 5: { cellWidth: 22 } },
          rows: L.map(function (c) { var d = crDelta(c); return [{ t: crNo(c), b: true }, c.title, dmy(new Date(c.raisedAt).toISOString().slice(0, 10)), d.days ? (d.days > 0 ? '+' : '') + d.days + ' d' : '–', d.cost ? (d.cost > 0 ? '+' : '−') + money(Math.abs(d.cost)) : '–', { t: c.status, rag: RS[c.status] }, c.decision ? c.decision.by + ', ' + c.decision.role + ', ' + dmy(new Date(c.decision.at).toISOString().slice(0, 10)) : 'Waiting']; }) },
        { kind: 'text', title: '3. How changes are controlled', text: '- Every proposed change is raised as a change request, from a meeting, Project Intelligence or by hand.\n- Its impact on scope, time, cost, quality, risks, issues and stakeholders is assessed.\n- It is reviewed, at a change control meeting where needed.\n- It is approved and signed (or rejected or deferred) by the project manager or project director.\n- Only then are the changes added to the plan and registers.' }] };
  }

  /* ---------- v62: 📊 Reports: customer, team and all stakeholders; weekly or ad hoc; RAG; Gantt; Word/PDF; email; log ---------- */
  var RAUD = {
    customer: { name: 'Customer update', icon: '🏠', who: 'The customer', blurb: 'Plain-English progress: what was done, what we plan to do, anything holding us up, the risks and issues we are managing, milestones, what we need from them and the programme Gantt chart. No internal costs.',
      asks: 'What we need from you', points: 'Highlights', next: 'Coming up (next 2 weeks)' },
    team: { name: 'Team look-ahead', icon: '👷', who: 'Crew and trades', blurb: 'What was done, the next 2 weeks task by task (who, when, critical tasks), blockers, risks and issues, safety (SWMS) and a 3-week look-ahead Gantt chart.',
      asks: 'Help needed / blockers to clear', points: 'This week\'s focus', next: 'Next steps' },
    all: { name: 'Stakeholder status report', icon: '📣', who: 'All stakeholders', blurb: 'Executive summary with RAG for scope, time, cost, risks and issues: what was done, what we plan to do, blockers, top risks, open issues, milestones, decisions needed, meetings and the programme Gantt chart.',
      asks: 'Decisions needed', points: 'Executive summary', next: 'Next steps' } };
  var RAGW = { G: 'Green', A: 'Amber', R: 'Red' }, RORD = { G: 0, A: 1, R: 2 };
  function repState() {
    if (!S.rep || S.rep.core !== S.core) S.rep = { core: S.core, aud: 'customer', type: 'Weekly', to: today(), from: '', over: {}, words: null, rcp: null, guests: [], showCost: false, log: null, email: false, test: false, swms: undefined, id: '', message: '' };
    var r = S.rep; if (!r.from) r.from = repFrom(r); return r;
  }
  function repFrom(r) {
    if (r.type === 'Weekly') { var d = new Date(r.to + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 6); return d.toISOString().slice(0, 10); }
    var last = (r.log || []).filter(function (e) { return e.audience === r.aud && e.to < r.to; }).sort(function (a, b) { return a.to < b.to ? 1 : -1; })[0];
    if (last) { var d2 = new Date(last.to + 'T00:00:00Z'); d2.setUTCDate(d2.getUTCDate() + 1); return d2.toISOString().slice(0, 10); }
    return S.plan.start || r.to;
  }
  function addDays(s, n) { var d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function dLong(s) { return s ? new Date(s + 'T00:00:00Z').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) : ''; }
  function wdLeft(R) { var t = today(); return R.finish && R.finish >= t ? workBetween(t, R.finish) : 0; }
  // what happened, what is next: the facts for one period
  function repFacts(r) {
    var p = S.plan, R = rollup(p, today()), t0 = today(), key = JSON.stringify(p.tasks.map(function (t) { return [t.id, t.dur, t.pred, t.snet, t.fixed]; })) + p.start + p.workStart + !!p.weekends + !!p.emergency, crit;
    if (r.critKey === key) crit = r.crit; else { var C = cpm(p); crit = {}; Object.keys(C.tasks).forEach(function (id) { if (C.tasks[id].float === 0) crit[id] = 1; }); r.crit = crit; r.critKey = key; R = rollup(p, today()); }
    var rows = ordered(), horizon = addDays(r.to, 14);
    var done = rows.filter(function (x) { return x.t.dur > 0 && x.t.status === 'done' && x.t.ef >= r.from && x.t.ef <= r.to; });
    var doing = rows.filter(function (x) { return x.t.status !== 'done' && x.t.es <= r.to && x.t.ef >= r.from && x.t.dur > 0; });
    var next = rows.filter(function (x) { return x.t.status !== 'done' && x.t.es > r.to && x.t.es <= horizon; });
    var late = rows.filter(function (x) { return x.t.pct < 100 && x.t.ef < t0; });
    var miles = rows.filter(function (x) { return x.t.dur === 0; });
    var risks = (p.risks || []).filter(function (x) { return x.status !== 'Closed' && x.title; }).sort(function (a, b) { return b.p * b.i - a.p * a.i; });
    var issues = (p.issues || []).filter(function (x) { return x.status !== 'Resolved' && x.title; }).sort(function (a, b) { return ['Critical', 'High', 'Medium', 'Low'].indexOf(a.priority) - ['Critical', 'High', 'Medium', 'Low'].indexOf(b.priority); });
    var meets = (p.meetings || []).filter(function (m) { return m.status !== 'Cancelled' && m.date >= t0 && m.date <= horizon; }).sort(function (a, b) { return (a.date + a.start).localeCompare(b.date + b.start); });
    return { p: p, R: R, crit: crit, rows: rows, done: done, doing: doing, next: next, late: late, miles: miles, risks: risks, issues: issues, meets: meets, horizon: horizon };
  }
  function repRag(r, F) {
    var p = F.p, R = F.R, tp = timePct(R), o = {};
    var fb = p.finishBy || (p.baseline && p.baseline.finish) || '';
    var time = R.finish && fb && R.finish > fb ? ['R', 'Forecast ' + dmy(R.finish) + ', after ' + (p.finishBy ? 'Finish by' : 'baseline') + ' ' + dmy(fb)]
      : R.SPI != null && R.SPI < 0.85 ? ['R', 'Well behind plan (SPI ' + R.SPI + ')'] : (R.SPI != null && R.SPI < 0.95) || F.late.length ? ['A', F.late.length ? pl(F.late.length, 'task') + ' late' : 'Slightly behind (SPI ' + R.SPI + ')'] : ['G', 'On track for ' + dmy(R.finish)];
    var ratio = tp ? R.pct / tp : 1, scope = ratio < 0.8 ? 'R' : ratio < 0.95 ? 'A' : 'G';
    var cost = R.CPI == null ? ['G', 'No costs over budget'] : R.CPI < 0.9 ? ['R', 'Over budget (CPI ' + R.CPI + ')'] : R.CPI < 0.97 ? ['A', 'Watch costs (CPI ' + R.CPI + ')'] : ['G', 'Within budget (CPI ' + R.CPI + ')'];
    var hiR = F.risks.filter(function (x) { return x.p * x.i >= 15; }).length, mdR = F.risks.filter(function (x) { return x.p * x.i >= 12; }).length;
    var risk = hiR ? ['R', pl(hiR, 'high risk') + ' open'] : mdR ? ['A', pl(mdR, 'significant risk') + ' open'] : ['G', F.risks.length ? pl(F.risks.length, 'risk') + ', all under control' : 'No open risks'];
    var crI = F.issues.filter(function (x) { return x.priority === 'Critical'; }).length, hiI = F.issues.filter(function (x) { return x.priority === 'High'; }).length;
    var iss = crI ? ['R', pl(crI, 'critical issue')] : hiI ? ['A', pl(hiI, 'high-priority issue')] : ['G', F.issues.length ? pl(F.issues.length, 'issue') + ', none urgent' : 'No open issues'];
    var sw = S.rep.swms, safety = sw === undefined ? ['A', 'Checking the SWMS…'] : !sw ? ['A', 'No SWMS yet'] : sw.status === 'Issued' ? ['G', 'SWMS v' + sw.version + ' issued'] : ['A', 'SWMS v' + sw.version + ' not issued yet'];
    var set = function (k, label, v) { o[k] = { label: label, c: v[0], note: v[1] }; };
    if (r.aud === 'customer') { set('time', 'Programme', time); set('scope', 'Progress', [scope, R.pct + '% done, ' + tp + '% of the time used']); set('risk', 'Risks & issues', RORD[risk[0]] >= RORD[iss[0]] ? risk : iss); }
    else if (r.aud === 'team') { set('time', 'Programme', time); set('issues', 'Blockers', iss); set('safety', 'Safety', safety); }
    else { set('scope', 'Scope', [scope, R.pct + '% done, ' + tp + '% of the time used']); set('time', 'Time', time); set('cost', 'Cost', cost); set('risk', 'Risks', risk); set('issues', 'Issues', iss); }
    Object.keys(o).forEach(function (k) { var v = r.over[k]; if (v) { if (v.c) o[k].c = v.c; if (v.note != null) o[k].note = v.note; } });   // changed by hand
    var worst = Object.keys(o).reduce(function (m, k) { return RORD[o[k].c] > RORD[m] ? o[k].c : m; }, 'G');
    var bad = Object.keys(o).filter(function (k) { return o[k].c !== 'G'; }).map(function (k) { return o[k].label.toLowerCase(); });
    var all = { overall: { label: 'Overall', c: worst, note: worst === 'G' ? 'On track' : (worst === 'R' ? 'Action needed: ' : 'Watch: ') + bad.join(', ') } };
    Object.keys(o).forEach(function (k) { all[k] = o[k]; });
    var ov = r.over.overall; if (ov) { if (ov.c) all.overall.c = ov.c; if (ov.note != null) all.overall.note = ov.note; }
    return all;
  }
  function repWords(r, F, rag) {   // a first draft of the wording, from the facts (✨ the AI can rewrite it)
    var R = F.R, nm = function (x) { return x.t.name; }, list = function (a, n) { return a.slice(0, n).map(nm).join(', ') + (a.length > n ? ' and ' + (a.length - n) + ' more' : ''); };
    var ov = rag.overall.c, fin = dmy(R.finish), cust = (S.job.name || '').split(' ')[0];
    var headline = ov === 'G' ? 'On track: ' + R.pct + '% complete and heading for completion on ' + fin + '.' : ov === 'A' ? R.pct + '% complete. A few things need watching (' + rag.overall.note.replace(/^Watch: /, '') + '); we are on it. Forecast completion ' + fin + '.' : 'Action needed: ' + rag.overall.note.replace(/^Action needed: /, '') + '. ' + R.pct + '% complete, forecast completion ' + fin + '.';
    var pts = [], next = F.next.slice(0, 8).map(function (x) { return dLong(x.t.es) + ': ' + x.t.name + (r.aud === 'team' && x.t.resource ? ' (' + x.t.resource + ')' : '') + (x.t.dur ? ', ' + pl(x.t.dur, 'day') : ''); }), asks = [];
    if (F.done.length) pts.push('Completed: ' + list(F.done, 5) + '.');
    if (F.doing.length) pts.push('Under way: ' + list(F.doing, 4) + '.');
    if (r.aud === 'customer') {
      var mNext = F.miles.filter(function (x) { return x.t.pct < 100; })[0]; if (mNext) pts.push('Next milestone: ' + mNext.t.name.replace(/^[✓◆\s]+/, '') + ' on ' + dmy(mNext.t.es) + '.');
      pts.push(R.finish ? 'Forecast completion: ' + fin + ' (' + pl(wdLeft(R), 'working day') + ' to go).' : '');
      asks = F.issues.filter(function (x) { return /customer|client|owner/i.test(x.owner + ' ' + x.title) || (cust && x.owner.indexOf(cust) >= 0); }).map(function (x) { return x.title + (x.due ? ' (by ' + dmy(x.due) + ')' : ''); });
    } else if (r.aud === 'team') {
      var wk = F.rows.filter(function (x) { return x.t.status !== 'done' && x.t.es <= addDays(r.to, 7) && x.t.ef >= r.to; });
      var critW = wk.filter(function (x) { return F.crit[x.t.id]; });
      if (critW.length) pts.push('Critical this week (they set the finish date): ' + list(critW, 4) + '.');
      if (F.late.length) pts.push('Late, catch up first: ' + F.late.slice(0, 4).map(function (x) { return '#' + x.n + ' ' + x.t.name; }).join(', ') + '.');
      if (S.rep.swms && S.rep.swms.hrcw && S.rep.swms.hrcw.length) pts.push('Safety: read and sign the SWMS (v' + S.rep.swms.version + ') before high-risk work.');
      asks = F.issues.filter(function (x) { return /High|Critical/.test(x.priority); }).map(function (x) { return x.title + (x.owner ? ' (' + x.owner + (x.due ? ', by ' + dmy(x.due) : '') + ')' : ''); });
    } else {
      Object.keys(rag).filter(function (k) { return k !== 'overall' && rag[k].c !== 'G'; }).forEach(function (k) { pts.push(rag[k].label + ' (' + RAGW[rag[k].c].toLowerCase() + '): ' + rag[k].note + '.'); });
      if (F.risks[0]) pts.push('Top risk: ' + F.risks[0].title + ' (score ' + F.risks[0].p * F.risks[0].i + ').');
      asks = F.issues.filter(function (x) { return /High|Critical/.test(x.priority); }).map(function (x) { return x.title + (x.due ? ' (by ' + dmy(x.due) + ')' : ''); })
        .concat(F.risks.filter(function (x) { return x.p * x.i >= 15; }).map(function (x) { return 'Agree the response to "' + x.title + '"' + (x.action ? ': ' + x.action : ''); })).slice(0, 5);
    }
    return { headline: headline, points: pts.filter(Boolean), next: next, asks: asks };
  }
  function repRecipients(r) {   // who it goes to: the customer (from the job), stakeholders, guests
    var sh = (S.plan.stakeholders || []).filter(function (x) { return /@/.test(x.email || ''); }), out = [];
    if (/@/.test(S.job.email || '')) out.push({ id: 'job', name: S.job.name, role: 'Customer (from the job)', email: S.job.email, raci: 'A' });
    sh.forEach(function (x) { if (!out.some(function (y) { return y.email.toLowerCase() === x.email.toLowerCase(); })) out.push({ id: x.id, name: x.name || x.role, role: x.role, email: x.email, raci: x.raci }); });
    return out;
  }
  function repDefaultRcp(r, list) {
    return list.filter(function (x) {
      if (r.aud === 'customer') return x.id === 'job' || /customer|client|owner|sponsor/i.test(x.role);
      if (r.aud === 'team') return x.raci === 'R' && !/customer|client|owner/i.test(x.role);
      return true;
    }).map(function (x) { return x.id; });
  }
  function repSnapshot(r) {
    var F = repFacts(r), p = F.p, R = F.R, rag = repRag(r, F), w = r.words || (r.words = repWords(r, F, rag)), A = RAUD[r.aud];
    var no = (r.log || []).filter(function (e) { return e.audience === r.aud && e.id !== r.id; }).length + 1;
    if (!r.id) r.id = 'rp' + Date.now().toString(36);
    var all = repRecipients(r), chosen = all.filter(function (x) { return r.rcp.indexOf(x.id) >= 0; }).map(function (x) { return { name: x.name, email: x.email }; }).concat(r.guests.map(function (e) { return { name: e, email: e }; }));
    var st = function (t) { var late = t.pct < 100 && t.ef < today(); return late ? 'Late' : stName[t.status].replace(' / QA', ''); };
    var milesRows = F.miles.map(function (x) { var t = x.t, late = t.pct < 100 && t.ef < today(); return [x.t.name.replace(/^[✓◆\s]+/, ''), dmy(t.es), { t: t.pct >= 100 ? 'Done' : late ? 'Late' : 'Coming', rag: t.pct >= 100 ? 'G' : late ? 'R' : undefined }]; });
    var topRows = F.rows.filter(function (x) { return x.t.es; });
    var g = { title: 'Task', from: addDays(R.start || r.from, -2), to: addDays(R.finish || r.to, 3), today: today(), rows: topRows.map(function (x) { var t = x.t; return { label: '#' + x.n + ' ' + t.name.replace(/^[✓◆\s]+/, ''), es: t.es, ef: t.ef, pct: t.pct, mile: t.dur === 0, crit: !!F.crit[t.id], late: t.pct < 100 && t.ef < today(), status: t.status, level: 1 }; }) };
    var kpis, sections = [];
    var pctRow = { label: 'Complete', value: R.pct + '%' }, cust = r.aud === 'customer';
    // v63: the same four parts in every report: what was done, what we plan to do, blockers, risks and issues
    var who = function (t) { return t.resource || (cust ? 'MBS' : 'Not assigned'); }, rag3 = function (pr) { return pr === 'Critical' ? 'R' : pr === 'High' ? 'A' : undefined; };
    var doneRows = F.done.map(function (x) { return { x: x, s: { t: 'Done ' + dmy(x.t.ef), rag: 'G' } }; }).concat(F.doing.map(function (x) { var late = x.t.ef < today(); return { x: x, s: { t: x.t.pct + '% done' + (late ? ', late' : ''), rag: late ? 'R' : undefined } }; }));
    var SDone = { kind: 'table', title: 'What was done (' + dmy(r.from) + ' to ' + dmy(r.to) + ')', head: cust ? ['Work', 'Progress'] : ['#', 'Task', 'Who', 'Progress'], wordCols: cust ? [7, 3] : [1, 6, 4, 3],
      rows: doneRows.map(function (d) { return cust ? [d.x.t.name, d.s] : [String(d.x.n), d.x.t.name, who(d.x.t), d.s]; }), cols: cust ? { 1: { cellWidth: 40 } } : { 0: { cellWidth: 9 }, 3: { cellWidth: 32 } }, always: true, empty: 'No work finished or under way in this period.' };
    var plan = F.rows.filter(function (x) { return x.t.es && x.t.status !== 'done' && x.t.es <= F.horizon && x.t.ef >= r.to; });
    var SPlan = { kind: 'table', title: 'What we plan to do (next 2 weeks)', head: cust ? ['Work', 'Starts', 'Finishes'] : ['#', 'Task', 'Who', 'Start', 'Finish', 'Status', 'Critical'], wordCols: cust ? [6, 2, 2] : [1, 6, 4, 2, 2, 2, 2],
      rows: plan.map(function (x) { var t = x.t; return cust ? [t.name.replace(/^[✓◆\s]+/, ''), dLong(t.es), dLong(t.ef)] : [String(x.n), { t: t.name, b: !!F.crit[t.id] }, who(t), dmy(t.es), dmy(t.ef), { t: st(t), rag: st(t) === 'Late' ? 'R' : undefined }, F.crit[t.id] ? { t: 'Yes', rag: 'A' } : '']; }),
      cols: cust ? { 1: { cellWidth: 30 }, 2: { cellWidth: 30 } } : { 0: { cellWidth: 9 }, 3: { cellWidth: 20 }, 4: { cellWidth: 20 }, 5: { cellWidth: 20 }, 6: { cellWidth: 16 } }, always: true, empty: 'Nothing scheduled in the next two weeks.' };
    var blk = F.late.map(function (x) { var d = workBetween(x.t.ef, today()) - 1; return [cust ? x.t.name + ' is running late' : '#' + x.n + ' ' + x.t.name + ' is late (' + x.t.pct + '% done)', { t: 'Late task', rag: F.crit[x.t.id] ? 'R' : 'A' }, who(x.t), { t: 'Due ' + dmy(x.t.ef) + (d > 0 ? ' (' + pl(d, 'day') + ' ago)' : '') }]; })
      .concat(F.issues.filter(function (x) { return /High|Critical/.test(x.priority); }).map(function (x) { return [x.title, { t: x.priority + ' issue', rag: rag3(x.priority) }, x.owner || '', x.due ? 'Due ' + dmy(x.due) : '']; }));
    var SBlock = { kind: 'table', title: cust ? 'Anything holding us up' : 'Blockers', head: ['Blocker', 'Type', 'Owner', 'When'], wordCols: [6, 2, 3, 3], rows: blk, cols: { 1: { cellWidth: 26 }, 2: { cellWidth: 30 }, 3: { cellWidth: 34 } }, always: true, empty: 'Nothing is blocking the work right now.' };
    var SRisk = { kind: 'table', title: cust ? 'Risks we are managing' : 'Risks', head: ['Risk', 'Score', 'What we are doing', 'Owner'], wordCols: [4, 1, 5, 2], rows: F.risks.map(function (x) { var sc = x.p * x.i; return [x.title, { t: String(sc), rag: sc >= 15 ? 'R' : sc >= 12 ? 'A' : 'G' }, x.response + (x.action ? ': ' + x.action : ''), x.owner]; }), cols: { 1: { cellWidth: 14, halign: 'center' }, 3: { cellWidth: 28 } }, always: true, empty: 'No open risks.' };
    var SIss = { kind: 'table', title: 'Open issues', head: ['Issue', 'Priority', 'Owner', 'Due'], wordCols: [6, 2, 3, 2], rows: F.issues.map(function (x) { return [x.title, { t: x.priority, rag: rag3(x.priority) }, x.owner, dmy(x.due)]; }), cols: { 1: { cellWidth: 20 }, 3: { cellWidth: 22 } }, always: true, empty: 'No open issues.' };
    var SMiles = { kind: 'table', title: 'Milestones', head: ['Milestone', 'Date', 'Status'], rows: milesRows, wordCols: [6, 2, 2], cols: { 1: { cellWidth: 28 }, 2: { cellWidth: 24 } } };
    if (cust) {
      kpis = [pctRow, { label: 'Started', value: dmy(R.start) }, { label: 'Forecast finish', value: dmy(R.finish) }, { label: p.finishBy ? 'Agreed finish' : 'Working days to go', value: p.finishBy ? dmy(p.finishBy) : String(wdLeft(R)) }];
      sections = [{ kind: 'bullets', title: A.points, items: w.points }, { kind: 'gantt', title: 'Where we are: the programme' }, SDone, SPlan, SBlock, SRisk, SIss, SMiles,
        { kind: 'bullets', title: 'What it means for you', items: w.next }, { kind: 'bullets', title: A.asks, items: w.asks, box: true, always: true, empty: 'Nothing needed from you right now. Thank you!' }];
    } else if (r.aud === 'team') {
      var win0 = addDays(r.to, -3), win1 = addDays(r.to, 21);
      g = { title: 'Task (3-week look-ahead)', from: win0, to: win1, today: today(), rows: [] };
      F.rows.forEach(function (x) { var t = x.t; if (!t.es || t.ef < win0 || t.es > win1) return; g.rows.push({ label: '#' + x.n + ' ' + t.name.replace(/^[✓◆\s]+/, '') + (t.resource ? ' · ' + t.resource : ''), es: t.es, ef: t.ef, pct: t.pct, mile: t.dur === 0, crit: !!F.crit[t.id], late: t.pct < 100 && t.ef < today(), status: t.status, level: 1 });
        (t.subs || []).forEach(function (sb) { var d = subDates(t, sb); if (d.ef < win0 || d.es > win1) return; g.rows.push({ label: sb.name + (sb.owner ? ' · ' + sb.owner : ''), es: d.es, ef: d.ef, pct: subPct(sb), status: sb.status, level: 2 });
          (sb.steps || []).forEach(function (q) { var qd = stepDates(t, sb, q); if (qd.ef < win0 || qd.es > win1) return; g.rows.push({ label: (q.done ? '✓ ' : '') + q.name, es: qd.es, ef: qd.ef, pct: q.done ? 100 : 0, status: q.done ? 'done' : 'todo', late: !q.done && qd.ef < today(), level: 3 }); }); }); });
      kpis = [pctRow, { label: 'Tasks next 2 weeks', value: String(plan.length) }, { label: 'Late tasks', value: String(F.late.length) }, { label: 'Critical next 2 weeks', value: String(plan.filter(function (x) { return F.crit[x.t.id]; }).length) }, { label: 'Open issues', value: String(F.issues.length) }];
      var sw = S.rep.swms, safety = sw ? ['SWMS version ' + sw.version + ' (' + sw.status + '): ' + sw.steps + ' job steps. Read and sign it before starting high-risk work.'] : ['No SWMS yet for this job: write it on the SWMS tab before high-risk work starts.'];
      if (sw && sw.hrcw.length) safety.push('High-risk work on this job: ' + sw.hrcw.join('; ') + '.');
      safety.push('Toolbox talk: go over this week\'s tasks, the hazards and who does what before starting.');
      SPlan.title = 'What we plan to do: the next 2 weeks';
      sections = [{ kind: 'bullets', title: A.points, items: w.points }, SDone, SPlan, { kind: 'gantt', title: '3-week look-ahead' }, SBlock, SRisk, SIss,
        { kind: 'bullets', title: 'Safety', items: safety }, { kind: 'bullets', title: A.asks, items: w.asks, box: true }];
    } else {
      kpis = [pctRow, { label: 'Forecast finish', value: dmy(R.finish) }, { label: p.finishBy ? 'Finish by' : 'Baseline finish', value: dmy(p.finishBy || (p.baseline && p.baseline.finish)) || 'Not set' }, { label: 'SPI (time)', value: R.SPI == null ? 'n/a' : String(R.SPI) }];
      if (r.showCost) kpis = kpis.concat([{ label: 'Budget', value: money(R.BAC) }, { label: 'Spent', value: money(R.AC) }, { label: 'CPI (cost)', value: R.CPI == null ? 'n/a' : String(R.CPI) }]);
      else kpis.push({ label: 'Open risks / issues', value: F.risks.length + ' / ' + F.issues.length });
      SRisk.title = 'Top risks';
      sections = [{ kind: 'bullets', title: A.points, items: w.points }, { kind: 'gantt', title: 'Programme' }, SDone, SPlan, SBlock, SRisk, SIss, SMiles,
        { kind: 'bullets', title: A.next, items: w.next }, { kind: 'bullets', title: A.asks, items: w.asks, box: true, always: true, empty: 'No decisions needed this period.' },
        { kind: 'table', title: 'Coming meetings', head: ['When', 'Meeting', 'Platform'], wordCols: [3, 6, 2], rows: F.meets.map(function (m) { return [dmy(m.date) + ' ' + m.start, m.title, PLAT[m.platform || 'google'][0]]; }), cols: { 0: { cellWidth: 32 }, 2: { cellWidth: 32 } } }];
    }
    var nameSafe = (S.job.ref + '-' + A.name.replace(/\s+/g, '-') + '-' + r.to).replace(/[^\w.-]+/g, '');
    return { id: r.id, no: no, audience: r.aud, type: r.type, from: r.from, to: r.to, periodText: dmy(r.from) + ' to ' + dmy(r.to), date: today(), title: A.name,
      project: { name: p.name, ref: S.job.ref, client: S.job.name, manager: (p.charter || {}).manager || '' }, rag: rag, headline: w.headline, points: w.points, next: w.next, asks: w.asks, kpis: kpis, gantt: g, sections: sections,
      recipients: chosen, fileBase: nameSafe };
  }
  function reportsTab() {
    var B = $('#planBody'), r = repState(), A = RAUD[r.aud];
    if (r.log === null) { B.innerHTML = '<div class="empty">Loading reports…</div>'; var core = S.core;
      Promise.all([api('reportLog', { core: core }), api('swmsGet', { core: core }).catch(function () { return {}; })]).then(function (x) {
        if (S.core !== core) return; r.log = x[0].list || []; r.email = !!x[0].email; r.test = !!x[0].test;
        var H = {}; (x[1].hrcw || []).forEach(function (h) { H[h[0]] = h[1]; }); var sw = x[1].swms; r.swms = sw ? { version: sw.version, status: sw.status, steps: sw.steps.length, hrcw: sw.hrcw.map(function (k) { return H[k] || k; }) } : null;
        r.from = repFrom(r); if (S.tab === 'reports') reportsTab(); }).catch(fail); return; }
    var list = repRecipients(r); if (!r.rcp) r.rcp = repDefaultRcp(r, list);
    var s = repSnapshot(r), rag = s.rag, w = r.words;
    var card = function (k) { var a = RAUD[k], last = (r.log || []).filter(function (e) { return e.audience === k; }).slice(-1)[0]; return '<button type="button" class="rp-aud' + (r.aud === k ? ' on' : '') + '" data-aud="' + k + '"><b>' + a.icon + ' ' + a.name + '</b><small>' + a.who + ' · ' + (last ? 'last #' + last.no + ' on ' + dmy(new Date(last.at + 11 * 3600e3).toISOString().slice(0, 10)) : 'none sent yet') + '</small></button>'; };
    var ragBox = '<div class="rp-rag">' + Object.keys(rag).map(function (k) { var x = rag[k]; return '<div class="rp-r rp-' + x.c + '"><b>' + esc(x.label) + '</b><select data-rg="' + k + '" title="Automatic from the plan: change it if you know better">' + ['G', 'A', 'R'].map(function (c) { return '<option value="' + c + '"' + (x.c === c ? ' selected' : '') + '>' + RAGW[c] + '</option>'; }).join('') + '</select><input data-rn="' + k + '" value="' + esc(x.note) + '" maxlength="140"></div>'; }).join('') + '</div>';
    var ta = function (k, label, rows, ph) { var v = Array.isArray(w[k]) ? w[k].join('\n') : w[k]; return '<label class="full">' + label + '<textarea data-rw="' + k + '" rows="' + rows + '" placeholder="' + esc(ph || '') + '">' + esc(v) + '</textarea></label>'; };
    var logRows = (r.log || []).slice().reverse().map(function (e) { var a = RAUD[e.audience] || RAUD.all; return '<tr data-rid="' + esc(e.id) + '"><td class="nowrap">' + esc(new Date(e.at).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Sydney' })) + '</td><td class="nowrap">' + a.icon + ' ' + esc(a.name) + ' <b>#' + e.no + '</b></td><td>' + esc(e.type) + '<br><small class="muted">' + esc(dmy(e.from)) + ' – ' + esc(dmy(e.to)) + '</small></td>' +
      '<td><span class="rp-chip rp-' + e.overall + '">' + RAGW[e.overall] + '</span></td><td class="rp-hl">' + esc(e.headline) + '</td><td title="' + esc(e.recipients.map(function (x) { return x.name + ' <' + x.email + '>'; }).join(', ')) + '">' + (e.recipients.length ? pl(e.recipients.length, 'person', 'people').replace(/persons$/, 'people') : '<span class="muted">–</span>') + '</td>' +
      '<td>' + (e.emailed ? '<span class="cm-ok">✉ Emailed</span>' : '<span class="muted">' + esc(e.action) + '</span>') + '</td><td class="nowrap acts"><button class="btn btn-sm" data-rdl="pdf">⬇ PDF</button><button class="btn btn-sm" data-rdl="docx">⬇ Word</button><button class="btn btn-sm" data-rdel title="Delete">✕</button></td></tr>'; }).join('');
    B.innerHTML = '<div class="rp-wrap"><div class="card"><div class="card-h"><h2>📊 Project reports</h2><span class="sp"></span>' + (r.id && (r.log || []).some(function (e) { return e.id === r.id; }) ? '<button class="btn btn-sm" id="rpNew" type="button">＋ New report</button>' : '') + '</div>' +
      '<p class="muted" style="margin:-4px 0 10px">One plan, three messages: each report says what matters to its readers, with a RAG status, the Gantt chart, what was done, what we plan to do, blockers, risks and issues, in at most 4 pages. Download it as Word or PDF, or email it; every report is kept in the log below.</p>' +
      '<div class="rp-auds">' + ['customer', 'team', 'all'].map(card).join('') + '</div><p class="rp-blurb">' + esc(A.blurb) + '</p>' +
      '<div class="form rp-period"><label>Report<select id="rpType"><option' + (r.type === 'Weekly' ? ' selected' : '') + '>Weekly</option><option' + (r.type === 'Ad hoc' ? ' selected' : '') + '>Ad hoc</option></select></label><label>From<input type="date" id="rpFrom" value="' + esc(r.from) + '"></label><label>To<input type="date" id="rpTo" value="' + esc(r.to) + '"></label>' +
        (r.aud === 'all' ? '<label class="qchk" style="align-self:end"><input type="checkbox" id="rpCost"' + (r.showCost ? ' checked' : '') + '> Show $ amounts (budget, spent)</label>' : '<span></span>') + '</div>' +
      '<h3 class="rp-h">Status (RAG) <small class="muted">worked out from the plan; change it if you know better</small></h3>' + ragBox +
      '<h3 class="rp-h">The message <small class="muted">a first draft from the plan: edit it, or let the AI write it for ' + esc(A.who.toLowerCase()) + '</small><span class="sp"></span><button class="btn btn-sm btn-gold" id="rpAi" type="button">' + (r.aiBusy ? 'Writing…' : '✨ Write it with AI') + '</button><button class="btn btn-sm" id="rpRedo" type="button" title="Back to the draft from the plan">↺ Draft from the plan</button></h3>' +
      '<div class="form rp-words">' + ta('headline', 'Headline', 2) + ta('points', A.points + ' (one per line)', 5) + ta('next', A.next + ' (one per line)', 4) + ta('asks', A.asks + ' (one per line)', 3, r.aud === 'customer' ? 'e.g. Choose the splashback tiles by Friday' : '') + '</div>' +
      '<h3 class="rp-h">Who gets it <small class="muted">from the Stakeholder register' + (r.aud === 'all' ? ': everyone by default' : '') + '</small></h3>' +
      (list.length ? '<div class="cm-who">' + list.map(function (x) { return '<label class="sc-cb"><input type="checkbox" data-rr="' + esc(x.id) + '"' + (r.rcp.indexOf(x.id) >= 0 ? ' checked' : '') + '> <span><b>' + esc(x.name) + '</b>' + (x.raci ? ' <span class="raci raci-' + x.raci + '">' + x.raci + '</span>' : '') + '<br><small class="muted">' + esc(x.role) + ' · ' + esc(x.email) + '</small></span></label>'; }).join('') + '</div>' : '<p class="muted">Nobody with an email yet: add people on the 👥 Stakeholders tab, or type an email below.</p>') +
      '<div class="inline-form" style="margin-top:8px"><input type="email" id="rpGuest" placeholder="Someone else? name@company.com.au"><button class="btn btn-sm" id="rpGuestAdd" type="button">＋ Add</button></div>' +
      (r.guests.length ? '<div class="cm-guests">' + r.guests.map(function (e, i) { return '<div class="cm-guest"><span>✉ ' + esc(e) + '</span><span class="cm-gnote">Not in the Stakeholder register</span><span class="sp"></span><button class="btn btn-sm btn-gold" data-rpreg="' + i + '" type="button">＋ Add to Stakeholders</button><button class="btn btn-sm" data-rpgx="' + i + '" type="button">✕</button></div>'; }).join('') + '</div><p class="sk-warn" style="margin:8px 0 0">💡 Best to add them to the Stakeholder register so it stays a true record of who is involved.</p>' : '') +
      '<div class="rp-go"><button class="btn" id="rpPrev" type="button">👁 Preview</button><button class="btn" id="rpPdf" type="button">⬇ PDF</button><button class="btn" id="rpDocx" type="button">⬇ Word</button>' +
        '<button class="btn btn-gold" id="rpSend" type="button">✉ ' + (r.email ? 'Email it to ' + (s.recipients.length === 1 ? '1 person' : s.recipients.length + ' people') : 'Email it') + '</button><span class="muted" id="rpMsg" style="font-size:12.5px"></span></div>' +
      (r.email ? (r.test ? '<p class="muted" style="font-size:12px;margin:6px 0 0">🧪 Test site: emails go to the owner only, marked [TEST], with the names they would have gone to.</p>' : '') : '<p class="muted" style="font-size:12px;margin:6px 0 0">Email sending is not set up (RESEND_API_KEY), so ✉ opens your email app with the summary: attach the PDF you download.</p>') + '</div>' +
      '<div class="card"><div class="card-h"><h2>🗂 Report log</h2><span class="sp"></span><span class="muted">' + pl((r.log || []).length, 'report') + '</span></div>' +
        ((r.log || []).length ? '<div class="table-wrap"><table class="pi-tbl rp-log"><thead><tr><th>When</th><th>Report</th><th>Type / period</th><th>RAG</th><th>Headline</th><th>To</th><th>How</th><th></th></tr></thead><tbody>' + logRows + '</tbody></table></div>' : '<div class="empty">No reports yet. Every report you download or email is kept here.</div>') + '</div></div>';
    reportsWire(B, r, list);
  }
  function reportsWire(B, r, list) {
    var redraw = function () { reportsTab(); };
    B.querySelectorAll('[data-aud]').forEach(function (b) { b.onclick = function () { var k = b.getAttribute('data-aud'); if (k === r.aud) return; r.aud = k; r.words = null; r.over = {}; r.rcp = null; r.guests = []; r.id = ''; r.from = repFrom(r); redraw(); }; });
    $('#rpType').onchange = function () { r.type = this.value; r.from = repFrom(r); r.words = null; r.id = ''; redraw(); };
    $('#rpFrom').onchange = function () { if (this.value) { r.from = this.value; r.words = null; r.id = ''; redraw(); } };
    $('#rpTo').onchange = function () { if (this.value) { r.to = this.value; if (r.type === 'Weekly') r.from = repFrom(r); r.words = null; r.id = ''; redraw(); } };
    var c = $('#rpCost'); if (c) c.onchange = function () { r.showCost = this.checked; redraw(); };
    B.querySelectorAll('[data-rg]').forEach(function (el) { el.onchange = function () { var k = el.getAttribute('data-rg'); (r.over[k] = r.over[k] || {}).c = el.value; redraw(); }; });
    B.querySelectorAll('[data-rn]').forEach(function (el) { el.oninput = function () { var k = el.getAttribute('data-rn'); (r.over[k] = r.over[k] || {}).note = el.value; }; });
    B.querySelectorAll('[data-rw]').forEach(function (el) { el.oninput = function () { var k = el.getAttribute('data-rw'); r.words[k] = k === 'headline' ? el.value : el.value.split('\n').map(function (x) { return x.replace(/^[-•*]\s*/, '').trim(); }).filter(Boolean); }; });
    $('#rpRedo').onclick = function () { r.words = null; redraw(); toast('Back to the draft from the plan'); };
    $('#rpAi').onclick = function () { repAi(r); };
    B.querySelectorAll('[data-rr]').forEach(function (el) { el.onchange = function () { var id = el.getAttribute('data-rr'); r.rcp = r.rcp.filter(function (x) { return x !== id; }); if (el.checked) r.rcp.push(id); redraw(); }; });
    var addG = function () { var e = $('#rpGuest').value.trim().toLowerCase(); if (!/^[^\s@<>,;]+@[^\s@<>,;]+\.[a-z]{2,}$/i.test(e)) return toast('Type a full email address', true);
      var hit = list.filter(function (x) { return x.email.toLowerCase() === e; })[0]; if (hit) { if (r.rcp.indexOf(hit.id) < 0) r.rcp.push(hit.id); toast(hit.name + ' is already on the list: ticked'); redraw(); return; }
      if (r.guests.indexOf(e) < 0) r.guests.push(e); redraw(); };
    $('#rpGuestAdd').onclick = addG; $('#rpGuest').onkeydown = function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); addG(); } };
    B.querySelectorAll('[data-rpgx]').forEach(function (b) { b.onclick = function () { r.guests.splice(+b.getAttribute('data-rpgx'), 1); redraw(); }; });
    B.querySelectorAll('[data-rpreg]').forEach(function (b) { b.onclick = function () { var e = r.guests[+b.getAttribute('data-rpreg')]; cmRegister(e, function (st) { r.guests = r.guests.filter(function (x) { return x !== e; }); r.rcp.push(st.id); redraw(); }); }; });
    var nw = $('#rpNew'); if (nw) nw.onclick = function () { r.id = ''; r.words = null; r.over = {}; r.to = today(); r.from = repFrom(r); redraw(); };
    var msg = function (t) { var m = $('#rpMsg'); if (m) m.innerHTML = t ? '<span class="ask-think">' + esc(t) + '</span>' : ''; };
    var busy = false, run = function (fn) { if (busy) return; busy = true; return fn().catch(fail).then(function () { busy = false; msg(''); }); };
    var logIt = function (s, how) { return api('reportKeep', { core: S.core, report: s, how: how }).then(function (d) { var i = r.log.map(function (e) { return e.id; }).indexOf(d.entry.id); if (i >= 0) r.log[i] = d.entry; else r.log.push(d.entry); }); };
    $('#rpPrev').onclick = function () { var win = window.open('', '_blank'); run(function () { msg('Making the PDF…'); var s = repSnapshot(r); return M.report.pdf(s).then(function (o) { var u = URL.createObjectURL(o.blob); if (win) win.location = u; else M.report.save(o.blob, o.name); toast(pl(o.pages, 'page')); }); }); };
    $('#rpPdf').onclick = function () { run(function () { msg('Making the PDF…'); var s = repSnapshot(r); return M.report.pdf(s).then(function (o) { M.report.save(o.blob, o.name); return logIt(s, 'PDF downloaded'); }).then(redraw); }); };
    $('#rpDocx').onclick = function () { run(function () { msg('Making the Word file…'); var s = repSnapshot(r); return M.report.docx(s).then(function (o) { M.report.save(o.blob, o.name); return logIt(s, 'Word downloaded'); }).then(redraw); }); };
    $('#rpSend').onclick = function () {
      var s = repSnapshot(r);
      if (!s.recipients.length) return toast('Tick who the report goes to', true);
      if (!r.email) {   // no email set up: the email app, with the summary; attach the PDF
        var body = (s.headline + '\n\n' + s.points.map(function (x) { return '- ' + x; }).join('\n') + (s.next.length ? '\n\nNext:\n' + s.next.map(function (x) { return '- ' + x; }).join('\n') : '') + '\n\nThe full report is attached.\n\nRegards');
        location.href = 'mailto:' + s.recipients.map(function (x) { return x.email; }).join(',') + '?subject=' + encodeURIComponent(s.title + ': ' + s.project.name + ' (' + s.periodText + ')') + '&body=' + encodeURIComponent(body);
        return run(function () { return M.report.pdf(s).then(function (o) { M.report.save(o.blob, o.name); return logIt(s, 'Email drafted'); }).then(redraw); });
      }
      M.modal('<h2>✉ Email the ' + esc(s.title.toLowerCase()) + '</h2><p class="muted" style="margin:4px 0 8px">To ' + esc(s.recipients.map(function (x) { return x.name === x.email ? x.email : x.name; }).join(', ')) + '. The email shows the RAG status, the headline and the key points; the full report is attached.</p>' +
        '<div class="form"><label class="full">Subject<input id="rsSubj" value="' + esc(s.title + ': ' + s.project.name + ' (' + s.periodText + ')') + '"></label><label class="full">Message (optional)<textarea id="rsMsg" rows="3" placeholder="Hi all, here is this week\'s update.">' + esc(r.message || '') + '</textarea></label>' +
        '<label class="qchk full"><input type="checkbox" id="rsPdf" checked> Attach the PDF</label><label class="qchk full"><input type="checkbox" id="rsDocx"> Attach the Word file too</label></div>' +
        '<div class="actions" style="justify-content:flex-end"><button class="btn" data-close type="button">Cancel</button><button class="btn btn-gold" id="rsGo" type="button">✉ Send</button></div>');
      $('#rsGo').onclick = function () {
        var go = $('#rsGo'), subj = $('#rsSubj').value, mess = $('#rsMsg').value, wantPdf = $('#rsPdf').checked, wantDoc = $('#rsDocx').checked; r.message = mess;
        if (!wantPdf && !wantDoc) return toast('Attach the PDF or the Word file', true);
        go.disabled = true; go.textContent = 'Sending…';
        M.report.pdf(s).then(function (pdf) { return (wantDoc ? M.report.docx(s) : Promise.resolve(null)).then(function (doc) {
          return api('reportSend', { core: S.core, report: s, subject: subj, message: mess, pdf: wantPdf ? pdf.base64 : '', pdfName: pdf.name, docx: doc ? doc.base64 : '', docxName: doc ? doc.name : '' }); }); })
          .then(function (d) { M.closeModal(); var i = r.log.map(function (e) { return e.id; }).indexOf(d.entry.id); if (i >= 0) r.log[i] = d.entry; else r.log.push(d.entry); toast(d.test ? 'Sent to you only (test site), marked [TEST]' : 'Emailed to ' + pl(s.recipients.length, 'person', 'people').replace(/persons$/, 'people')); redraw(); })
          .catch(function (e) { go.disabled = false; go.textContent = '✉ Send'; fail(e); });
      };
    };
    B.querySelectorAll('tr[data-rid]').forEach(function (tr) {
      var id = tr.getAttribute('data-rid');
      tr.querySelectorAll('[data-rdl]').forEach(function (b) { b.onclick = function () { var f = b.getAttribute('data-rdl'); api('reportGet', { core: S.core, id: id }).then(function (d) { return M.report[f](d.report); }).then(function (o) { M.report.save(o.blob, o.name); }).catch(fail); }; });
      tr.querySelector('[data-rdel]').onclick = function () { M.confirmBox('Delete this report from the log?', 'It can\'t be downloaded again afterwards. Emails already sent are not affected.', 'Delete', true).then(function (y) { if (!y) return; api('reportDelete', { core: S.core, id: id }).then(function () { r.log = r.log.filter(function (e) { return e.id !== id; }); if (r.id === id) r.id = ''; redraw(); }).catch(fail); }); };
    });
  }
  function repAi(r) {
    if (r.aiBusy) return;
    var s = repSnapshot(r), core = S.core;
    var facts = { audience: r.aud === 'customer' ? 'CUSTOMER' : r.aud === 'team' ? 'TEAM' : 'ALL STAKEHOLDERS', report: s.type, period: s.periodText, project: s.project.name, today: today(),
      rag: Object.keys(s.rag).map(function (k) { return s.rag[k].label + ': ' + RAGW[s.rag[k].c] + ' (' + s.rag[k].note + ')'; }), kpis: s.kpis.map(function (k) { return k.label + ': ' + k.value; }),
      draft: { headline: s.headline, points: s.points, next: s.next, asks: s.asks },
      tables: s.sections.filter(function (x) { return x.kind === 'table'; }).map(function (x) { return { title: x.title, head: x.head, rows: x.rows.slice(0, 12).map(function (row) { return row.map(function (c) { return c && c.t != null ? c.t : c; }); }) }; }) };
    if (r.aud === 'customer') delete facts.tables;   // no internal detail for the customer
    r.aiBusy = true; reportsTab();
    var id = Array.from(crypto.getRandomValues(new Uint8Array(10))).map(function (b) { return b.toString(16).padStart(2, '0'); }).join(''), t0 = Date.now();
    var end = function () { r.aiBusy = false; if (S.tab === 'reports' && S.core === core) reportsTab(); };
    var poll = function () {
      if (Date.now() - t0 > 180000) { end(); return toast('The AI took too long. Try again.', true); }
      return new Promise(function (res) { setTimeout(res, 2000); }).then(function () { return api('planAiStatus', { id: id }); }).then(function (d) {
        if (d.status === 'done') { var x = d.words; r.words = { headline: x.headline || s.headline, points: x.points.length ? x.points : s.points, next: x.next.length ? x.next : s.next, asks: x.asks.length ? x.asks : s.asks }; end(); toast('Written for ' + RAUD[r.aud].who.toLowerCase() + ': check it, then download or email'); return; }
        if (d.status === 'error') { end(); return toast(d.error || 'The AI could not write it', true); }
        return poll();
      });
    };
    fetch('/.netlify/functions/planai-background', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-MBS-Admin': '1', 'X-Champ-Lang': (window.ChampI18n && window.ChampI18n.get()) || 'en' }, body: JSON.stringify({ mode: 'report', id: id, core: core, facts: facts }) })
      .then(function (x) { if (x.status >= 400) throw new Error('Could not start the AI (' + x.status + ')'); return poll(); }).catch(function (e) { end(); fail(e); });
  }

  /* ---------- v52: 🧠 Project Intelligence ---------- */
  // Ask anything about this project. The AI answers from the plan and the documents uploaded here (contract, specs ...),
  // can suggest risks and a stakeholder register, and set up a team meeting (Google Calendar invite with Google Meet, .ics).
  var PI_EX = ['Work out the critical and non-critical risks for this project', 'What would a stakeholder register look like for this project?',
    'Summarise the contract: price, payment stages, variations, defects period and delays', 'What could delay the finish date, and what should we do this week?',
    'Set up a 45-minute Google Meet with the stakeholders next Tuesday at 10am to review progress', 'Generate a SWMS for this project',
    'Analyse my last meeting: summarise the outcome and the impact on scope, time, cost, risks, issues and stakeholders'];
  var PI_KIND = { Contract: '📜', Specification: '📐', Quote: '💲', Variation: '🔁', Drawings: '🗺', Invoice: '🧾', Certificate: '✅', 'Meeting notes': '🗒', 'Meeting transcript': '🎙', 'Project charter (signed)': '✍', Correspondence: '✉', Document: '📄' };
  function piLoad(src, test) { return test() ? Promise.resolve() : new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = function () { rej(new Error('Could not load ' + src)); }; document.head.appendChild(s); }); }
  function piMd(s) {   // small, safe markdown: escaped first, then headings, bullets, tables, bold, code
    var L = esc(String(s || '')).split('\n'), out = [], list = null, tbl = null;
    var inl = function (x) { return x.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>'); };
    var close = function () { if (list) { out.push('</' + list + '>'); list = null; } if (tbl) { out.push(piTable(tbl)); tbl = null; } };
    L.forEach(function (ln) {
      var x = ln.trim(), m;
      if (/^\|.*\|$/.test(x)) { if (list) { out.push('</' + list + '>'); list = null; } (tbl = tbl || []).push(x); return; }
      if (tbl) { out.push(piTable(tbl)); tbl = null; }
      if ((m = x.match(/^#{1,4}\s+(.*)$/))) { close(); out.push('<h4>' + inl(m[1]) + '</h4>'); return; }
      if ((m = x.match(/^[-*•]\s+(.*)$/))) { if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; } out.push('<li>' + inl(m[1]) + '</li>'); return; }
      if ((m = x.match(/^\d+[.)]\s+(.*)$/))) { if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol'; } out.push('<li>' + inl(m[1]) + '</li>'); return; }
      close(); if (x) out.push('<p>' + inl(x) + '</p>');
    });
    close(); return out.join('');
  }
  function piTable(rows) {
    var cells = function (r) { return r.replace(/^\||\|$/g, '').split('|').map(function (c) { return c.trim().replace(/\*\*(.+?)\*\*/g, '<b>$1</b>'); }); };
    rows = rows.filter(function (r) { return !/^\|[\s:|-]+\|$/.test(r); });
    if (!rows.length) return '';
    return '<div class="table-wrap"><table class="pi-tbl"><thead><tr>' + cells(rows[0]).map(function (c) { return '<th>' + c + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.slice(1).map(function (r) { return '<tr>' + cells(r).map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
  }
  // meeting times: Sydney local -> UTC for the .ics file
  function piUtc(date, hm) {
    var a = date.split('-').map(Number), b = hm.split(':').map(Number), guess = Date.UTC(a[0], a[1] - 1, a[2], b[0], b[1]);
    var f = function (ms) { var o = {}; new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ms)).forEach(function (q) { o[q.type] = q.value; }); return Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour, +o.minute); };
    var off = f(guess) - guess; return new Date(guess - off);
  }
  function piStamp(d) { return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }
  function piLocal(date, hm, plus) { var a = date.split('-').map(Number), b = hm.split(':').map(Number), d = new Date(Date.UTC(a[0], a[1] - 1, a[2], b[0], b[1] + (plus || 0))); return d.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', 'T') + '00'; }
  function piPeople(ids) { return (S.plan.stakeholders || []).filter(function (x) { return ids.indexOf(x.id) >= 0; }); }
  var PLAT = { google: ['Google Meet', '🟢'], teams: ['Microsoft Teams', '🟣'], zoom: ['Zoom', '🔵'] };
  function piMeetLinks(m) {
    var who = piPeople(m.attendees), guests = (m.guests || []).filter(function (e) { return /@/.test(e); }), plat = PLAT[m.platform] ? m.platform : 'google', pn = PLAT[plat][0], off = m.status === 'Cancelled';
    var emails = who.map(function (x) { return x.email; }).filter(function (e) { return /@/.test(e || ''); }).concat(guests).filter(function (e, i, a) { return a.indexOf(e) === i; });
    var details = (m.agenda ? 'Agenda:\n' + m.agenda.split('\n').map(function (x) { return '- ' + x; }).join('\n') + '\n\n' : '') + 'Project: ' + S.plan.name + ' (' + S.job.ref + ')\n' +
      (m.link ? pn + ': ' + m.link + (m.passcode ? ' (passcode ' + m.passcode + ')' : '') : plat === 'google' ? 'Google Meet: the video link is added by Google Calendar.' : pn + ': the join link is in the invite.') + (m.link && plat === 'google' ? '\nJoin: ' + m.link : '');
    var g = 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(m.title) + '&dates=' + piLocal(m.date, m.start) + '/' + piLocal(m.date, m.start, m.minutes) +
      '&ctz=Australia/Sydney&details=' + encodeURIComponent(details) + '&location=' + encodeURIComponent(m.link || pn) + (emails.length ? '&add=' + encodeURIComponent(emails.join(',')) : '');
    var s = piUtc(m.date, m.start), e = new Date(s.getTime() + m.minutes * 60000);
    var teams = 'https://teams.microsoft.com/l/meeting/new?subject=' + encodeURIComponent(m.title) + '&startTime=' + encodeURIComponent(s.toISOString()) + '&endTime=' + encodeURIComponent(e.toISOString()) +
      '&content=' + encodeURIComponent(details.slice(0, 900)) + (emails.length ? '&attendees=' + encodeURIComponent(emails.join(',')) : '');
    var ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MBS Console//Project Intelligence//EN', 'METHOD:' + (off ? 'CANCEL' : 'REQUEST'), 'BEGIN:VEVENT', 'UID:' + (m.id || ('m' + Date.now())) + '@mbs-console', 'DTSTAMP:' + piStamp(new Date()),
      'SEQUENCE:' + ((m.was || []).length + (off ? 1 : 0)), 'DTSTART:' + piStamp(s), 'DTEND:' + piStamp(e), 'SUMMARY:' + ((off ? 'Cancelled: ' : '') + m.title).replace(/[,;]/g, '\\$&'), 'LOCATION:' + (m.link || pn), 'DESCRIPTION:' + details.replace(/[,;]/g, '\\$&').replace(/\n/g, '\\n')]
      .concat(off ? ['STATUS:CANCELLED'] : [])
      .concat(who.filter(function (x) { return /@/.test(x.email || ''); }).map(function (x) { return 'ATTENDEE;CN=' + (x.name || x.email).replace(/[,;:"]/g, ' ') + ';ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:' + x.email; }))
      .concat(guests.map(function (x) { return 'ATTENDEE;CN=' + x + ';ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:' + x; }))
      .concat(off ? [] : ['BEGIN:VALARM', 'TRIGGER:-PT15M', 'ACTION:DISPLAY', 'DESCRIPTION:Reminder', 'END:VALARM']).concat(['END:VEVENT', 'END:VCALENDAR']).join('\r\n');
    var when = new Date(m.date + 'T00:00:00Z').toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) + ' at ' + m.start + ' (Sydney time), ' + m.minutes + ' minutes';
    var mail = 'mailto:' + emails.join(',') + '?subject=' + encodeURIComponent((off ? 'Cancelled: ' : (m.was || []).length ? 'New time: ' : '') + m.title + ': ' + when) + '&body=' + encodeURIComponent(off ? 'Hello,\n\nOur project meeting "' + m.title + '" on ' + when + ' is cancelled. We will be in touch with a new time.\n\nRegards' :
      'Hello,\n\nPlease join our project meeting on ' + pn + '.\n\nWhen: ' + when + '\n' + ((m.was || []).length ? '(This replaces the earlier time: ' + m.was[m.was.length - 1] + '.)\n' : '') + (m.link ? 'Join: ' + m.link + (m.passcode ? ' (passcode ' + m.passcode + ')' : '') + '\n' : 'The ' + pn + ' link is in the calendar invite.\n') + '\n' + details + '\n\nRegards');
    return { gcal: g, teams: teams, zoom: 'https://zoom.us/meeting/schedule', open: plat === 'teams' ? teams : plat === 'zoom' ? 'https://zoom.us/meeting/schedule' : g, ics: ics, mail: mail, emails: emails, missing: who.filter(function (x) { return !/@/.test(x.email || ''); }), when: when, name: pn };
  }
  function intelTab() {
    var B = $('#planBody'); if (!B) return;   // the answer came back after leaving the project
    if (!S.intel || S.intel.core !== S.core) {
      B.innerHTML = '<div class="empty">Loading Project Intelligence…</div>';
      api('intelGet', { core: S.core }).then(function (d) { S.intel = { core: S.core, docs: d.docs, log: d.log, open: {} }; if (S.tab === 'intel') intelTab(); }).catch(fail);
      return;
    }
    var I = S.intel, p = S.plan;
    B.innerHTML = '<div class="pi-wrap"><div class="pi-main"><div class="card"><div class="card-h"><h2>🧠 Project Intelligence</h2><span class="sp"></span>' + (I.log.length > 1 ? '<button class="btn btn-sm" id="piFold" title="Fold or open all the answers">' + (I.log.every(function (e, k) { return piFolded(k); }) ? '▾ Open all' : '▸ Fold all') + '</button>' : '') + (I.log.length > 3 ? '<button class="btn btn-sm" id="piKeep" title="Keep only the 3 newest answers">🧹 Keep newest 3</button>' : '') + (I.log.length ? '<button class="btn btn-sm" id="piClear" title="Clear every question and answer">🗑 Clear all (' + I.log.length + ')</button>' : '') + '</div>' +
        '<p class="muted" style="margin:-4px 0 10px">Ask anything about this project. The AI reads the plan (tasks, dates, critical path, costs, risks, issues, stakeholders) and the documents on the right, and can add risks and stakeholders or set up a Google Meet.</p>' +
        '<div class="pi-ask"><textarea id="piQ" rows="2" placeholder="e.g. Work out the critical and non-critical risks for this project">' + esc(S.piDraft || '') + '</textarea><button class="btn btn-gold" id="piGo"' + (S.piBusy ? ' disabled' : '') + '>' + (S.piBusy ? 'Thinking…' : 'Ask') + '</button></div>' +
        '<div class="pi-ex">' + PI_EX.map(function (x) { return '<button class="pi-chip" data-piex="' + esc(x) + '">' + esc(x) + '</button>'; }).join('') + '</div>' +
        '<div id="piLog">' + (S.piBusy ? '<div class="pi-a"><div class="pi-q">“' + esc(S.piBusy) + '”</div><p class="ask-think">Reading the plan' + (I.docs.length ? ' and ' + pl(I.docs.length, 'document') : '') + '… (this can take up to a minute)</p></div>' : '') +
          I.log.slice().reverse().map(function (e, k) { return piAnswer(e, I.log.length - 1 - k); }).join('') + (!I.log.length && !S.piBusy ? '<div class="empty">No questions yet. Try one of the examples above.</div>' : '') + '</div></div></div>' +
      '<div class="pi-side"><div class="card"><div class="card-h"><h2>📎 Documents</h2><span class="sp"></span><label class="btn btn-sm btn-gold" for="piFile">＋ Upload</label><input type="file" id="piFile" multiple hidden accept=".pdf,.docx,.txt,.md,.csv,.html,.htm,.eml,.json,.vtt,.srt"></div>' +
        '<p class="muted" style="font-size:12.5px;margin:-4px 0 8px">The contract, specification, quotes, variations, letters or meeting notes (PDF, Word .docx or text). The text is read here in your browser and kept with this project.</p>' +
        '<div id="piUp"></div>' + (I.docs.length ? '<ul class="pi-docs">' + I.docs.map(function (d) { return '<li data-did="' + esc(d.id) + '"><span class="pi-dk" title="' + esc(d.kind) + '">' + (PI_KIND[d.kind] || '📄') + '</span><div><b>' + esc(d.name) + '</b><br><small class="muted">' + esc(d.kind) + (d.pages ? ' · ' + pl(d.pages, 'page') : '') + ' · ' + (d.words || 0).toLocaleString('en-AU') + ' words · ' + dmy(new Date(d.at + 10 * 3600e3).toISOString().slice(0, 10)) + '</small></div><span class="sp"></span><button class="btn btn-sm" data-ddl title="Download">⬇</button><button class="btn btn-sm" data-ddel title="Delete">✕</button></li>'; }).join('') + '</ul>' : '<div class="empty" style="padding:12px">No documents yet. Upload the contract to ask about it.</div>') +
        '<p class="muted" style="font-size:12px;margin:10px 0 0">🔒 Before anything goes to the AI, the customer\'s name, phone numbers and emails are taken out, and stakeholders\' phone numbers and emails never leave MBS.</p></div>' +
      '<div class="card" style="margin-top:14px"><h2>📅 Meetings</h2>' + ((p.meetings || []).length ? '<ul class="pi-meets">' + p.meetings.slice().reverse().map(function (m) { var L = piMeetLinks(m); return '<li><b>' + esc(m.title) + '</b><br><small class="muted">' + esc(L.when) + ' · ' + pl(m.attendees.length, 'attendee') + '</small><div class="row" style="gap:6px;margin-top:4px"><a class="btn btn-sm" target="_blank" rel="noopener" href="' + esc(L.gcal) + '">📅 Google Calendar</a><button class="btn btn-sm" data-mics="' + esc(m.id) + '">⬇ .ics</button><button class="btn btn-sm" data-mdel="' + esc(m.id) + '">✕</button></div></li>'; }).join('') + '</ul>' : '<p class="muted" style="margin:0;font-size:13px">None yet. Ask, for example: “Set up a 45-minute Google Meet with the stakeholders next Tuesday at 10am”.</p>') +
        '<p style="margin:10px 0 0"><a class="btn btn-sm" href="https://meet.google.com/new" target="_blank" rel="noopener">🎥 Start a Google Meet now</a></p></div></div></div>';
    var go = function () { var q = $('#piQ').value.trim(); if (q) piAsk(q); };
    $('#piGo').onclick = go;
    $('#piQ').oninput = function () { S.piDraft = this.value; };
    $('#piQ').onkeydown = function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); } };
    B.querySelectorAll('[data-piex]').forEach(function (b) { b.onclick = function () { $('#piQ').value = S.piDraft = b.getAttribute('data-piex'); go(); }; });
    B.querySelectorAll('[data-pifu]').forEach(function (b) { b.onclick = function () { $('#piQ').value = S.piDraft = b.getAttribute('data-pifu'); go(); }; });
    var cl = $('#piClear'); if (cl) cl.onclick = function () { M.confirmBox('Clear all the answers?', 'All ' + pl(I.log.length, 'question') + ' and answers on this project are cleared for everyone. Documents, risks, stakeholders, meetings and the SWMS stay.', 'Clear all', true).then(function (y) { if (!y) return; api('intelClear', { core: S.core }).then(function () { I.log = []; I.open = {}; toast('Answers cleared'); intelTab(); }).catch(fail); }); };
    var kp = $('#piKeep'); if (kp) kp.onclick = function () { M.confirmBox('Keep only the 3 newest?', pl(I.log.length - 3, 'older answer') + ' will be cleared for everyone. Documents, risks, stakeholders, meetings and the SWMS stay.', 'Clear older', true).then(function (y) { if (!y) return; api('intelClear', { core: S.core, keep: 3 }).then(function (d) { I.log = d.log || I.log.slice(-3); I.open = {}; toast('Older answers cleared'); intelTab(); }).catch(fail); }); };
    var fo = $('#piFold'); if (fo) fo.onclick = function () { var shut = !I.log.every(function (e, k) { return piFolded(k); }); I.log.forEach(function (e, k) { (I.open[k] = I.open[k] || {}).fold = shut; }); intelTab(); };
    $('#piFile').onchange = function () { piUpload(Array.prototype.slice.call(this.files)); this.value = ''; };
    B.querySelectorAll('[data-ddel]').forEach(function (b) { b.onclick = function () { var id = b.closest('li').getAttribute('data-did'), d = I.docs.filter(function (x) { return x.id === id; })[0];
      M.confirmBox('Delete this document?', '“' + d.name + '” is removed from this project. Answers already given stay.', 'Delete').then(function (y) { if (!y) return; api('intelDocDelete', { core: S.core, id: id }).then(function () { I.docs = I.docs.filter(function (x) { return x.id !== id; }); intelTab(); toast('Document deleted'); }).catch(fail); }); }; });
    B.querySelectorAll('[data-ddl]').forEach(function (b) { b.onclick = function () { api('intelDocFile', { core: S.core, id: b.closest('li').getAttribute('data-did') }).then(function (r) {
      var bin = atob(r.file), u8 = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      var url = URL.createObjectURL(new Blob([u8], { type: r.type })), a = document.createElement('a'); a.href = url; a.download = r.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 5000); }).catch(fail); }; });
    B.querySelectorAll('[data-mics]').forEach(function (b) { b.onclick = function () { var m = p.meetings.filter(function (x) { return x.id === b.getAttribute('data-mics'); })[0]; piIcs(m); }; });
    B.querySelectorAll('[data-mdel]').forEach(function (b) { b.onclick = function () { p.meetings = p.meetings.filter(function (x) { return x.id !== b.getAttribute('data-mdel'); }); dirty(); intelTab(); }; });
    piWire(B);
  }
  function piIcs(m) { var L = piMeetLinks(m), url = URL.createObjectURL(new Blob([L.ics], { type: 'text/calendar' })), a = document.createElement('a'); a.href = url; a.download = (m.title || 'meeting').replace(/[^\w -]+/g, '').slice(0, 60) + '.ics'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 5000); }
  // newest 2 answers are open, older ones folded to one line (unless opened)
  function piFolded(i) { var st = S.intel.open[i]; return st && typeof st.fold === 'boolean' ? st.fold : i < S.intel.log.length - 2; }
  function piCrRef(e, kind) { return 'pi' + (e.at || 0) + ':' + kind; }
  function piCrFoot(e, kind, attr, label, what) {
    var c = (S.plan.changes || []).filter(function (x) { return x.srcRef === piCrRef(e, kind); })[0];
    if (c) return '<div class="cr-sent" style="margin-top:8px">🔁 Sent to change control as <b>' + crNo(c) + '</b> · <span class="cr-st ' + CR_CLS[c.status] + '">' + esc(c.status) + '</span> <button class="btn btn-sm" type="button" data-picropen="' + esc(c.id) + '">Open ' + crNo(c) + '</button></div>';
    return '<div class="row" style="gap:8px;margin-top:8px;align-items:center"><button class="btn btn-sm btn-gold" type="button" ' + attr + '>' + label + '</button><span class="muted" style="font-size:12.5px">Nothing is added yet: the ticked ' + what + ' go to the register once the change request is approved and signed by the project manager or project director.</span></div>';
  }
  function piCrSend(e, kind, title, desc, impact, parts) {
    var imp = {}; AREA_N.forEach(function (x) { imp[x[0]] = impact[x[0]] || { level: 'None', text: '' }; });
    var items = Object.assign({ meeting: null, outcome: title, summary: [], decisions: [], actions: [], impact: imp, task_changes: [], new_tasks: [], scope_changes: [], risks: [], issues: [], stakeholders: [], quality: [], follow_ups: [] }, parts);
    var c = crNew({ title: title, desc: desc, reason: 'Suggested by Project Intelligence in answer to: “' + String(e.q || '').slice(0, 300) + '”', source: 'intel', srcRef: piCrRef(e, kind), srcTitle: 'Project Intelligence answer', items: items, picks: {} });
    if (ccOff()) { crCommitNow(c); return; }
    dirty(crNo(c) + ' raised'); S.crView = c.id; toast(crNo(c) + ' raised in change control: approve and sign it to add them to the register');
    location.hash = '#plan/' + S.core + '/change';
  }
  function piAnswer(e, i) {
    var r = e.r || {}, p = S.plan, st = S.intel.open[i] = S.intel.open[i] || {}, fold = piFolded(i);
    var head = '<div class="pi-q"><button class="pi-tog" data-pitog title="' + (fold ? 'Open' : 'Fold') + ' this answer">' + (fold ? '▸' : '▾') + '</button><span class="pi-qt">“' + esc(e.q) + '”<small class="muted"> · ' + esc(new Date(e.at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Sydney' })) + (e.by ? ' · ' + esc(String(e.by).replace(/^Admin \((.*)\)$/, '$1')) : '') + '</small></span><button class="pi-x" data-pidel title="Clear this answer">✕</button></div>';
    if (fold) return '<div class="pi-a pi-folded" data-pia="' + i + '">' + head + '<div class="pi-peek">' + esc(String(r.answer || '').replace(/[#*_`>|-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)) + '</div></div>';
    var h = '<div class="pi-a" data-pia="' + i + '">' + head +
      '<div class="pi-md">' + piMd(r.answer) + '</div>';
    if (r.risks && r.risks.length) {
      var crit = r.risks.filter(function (x) { return x.critical; }).length;
      h += '<div class="pi-act"><h4>⚠ Suggested risks <small class="muted">(' + crit + ' critical, ' + (r.risks.length - crit) + ' non-critical)</small></h4><div class="table-wrap"><table class="pi-tbl"><thead><tr><th></th><th>Risk</th><th>Path</th><th>P</th><th>I</th><th>Score</th><th>Response</th><th>Action</th></tr></thead><tbody>' +
        r.risks.map(function (x, k) { var have = (p.risks || []).some(function (y) { return y.title.toLowerCase() === x.title.toLowerCase(); }); return '<tr><td>' + (have ? '<span class="pi-have" title="Already in the Risk register">✓ In register</span>' : '<input type="checkbox" class="pi-cb" data-rk="' + k + '" checked aria-label="Send this risk">') + '</td><td><b>' + esc(x.title) + '</b><br><small class="muted">' + esc(x.cause) + '</small></td><td>' + (x.critical ? '<span class="pi-crit">⚡ Critical</span>' : '<span class="muted">Non-critical</span>') + '</td><td>' + x.p + '</td><td>' + x.i + '</td><td><b>' + (x.p * x.i) + '</b></td><td>' + esc(x.response) + '</td><td><small>' + esc(x.action) + '</small></td></tr>'; }).join('') +
        '</tbody></table></div>' + (r.risks.some(function (x) { return !(p.risks || []).some(function (y) { return y.title.toLowerCase() === x.title.toLowerCase(); }); }) || (p.changes || []).some(function (c) { return c.srcRef === piCrRef(e, 'r'); }) ? piCrFoot(e, 'r', 'data-addrisks', '➜ Send ticked risks to change control', 'risks') : '<p class="muted" style="margin:8px 0 0">✓ All of these risks are already in the Risk register.</p>') + '</div>';
    }
    if (r.stakeholders && r.stakeholders.length) {
      h += '<div class="pi-act"><h4>👥 Stakeholder register</h4><div class="table-wrap"><table class="pi-tbl"><thead><tr><th></th><th>Name</th><th>Role</th><th>RACI</th><th>Interest</th><th>Influence</th><th>How to engage</th></tr></thead><tbody>' +
        r.stakeholders.map(function (x, k) { var have = !!x.id || (p.stakeholders || []).some(function (y) { return y.name && y.name.toLowerCase() === x.name.toLowerCase(); }); return '<tr><td>' + (have ? '<span class="pi-have" title="Already a stakeholder">✓ Listed</span>' : '<input type="checkbox" class="pi-cb" data-sk="' + k + '" checked aria-label="Send this stakeholder">') + '</td><td><b>' + esc(x.name) + '</b>' + (have ? ' <small class="muted">(listed)</small>' : '') + '</td><td>' + esc(x.role) + '</td><td><span class="raci raci-' + x.raci + '">' + x.raci + '</span></td><td>' + x.interest + '</td><td>' + x.influence + '</td><td><small>' + esc(x.engagement) + '</small></td></tr>'; }).join('') +
        '</tbody></table></div>' + piCrFoot(e, 'k', 'data-addsk', '➜ Send ticked stakeholders to change control', 'stakeholders') + '</div>';
    }
    if (r.meeting) {
      var m = st.meeting || (st.meeting = Object.assign({ id: 'm' + Date.now().toString(36) + i }, r.meeting)), all = p.stakeholders || [];
      var L = piMeetLinks(m), saved = (p.meetings || []).some(function (x) { return x.id === m.id; });
      h += '<div class="pi-act pi-meet"><h4>🎥 Team meeting (Google Meet)</h4><div class="form pi-mform">' +
          '<label>Title<input data-mf="title" value="' + esc(m.title) + '"></label><label>Date<input type="date" data-mf="date" value="' + esc(m.date) + '"></label><label>Start<input type="time" data-mf="start" value="' + esc(m.start) + '"></label>' +
          '<label>Length<select data-mf="minutes">' + [30, 45, 60].map(function (n) { return '<option value="' + n + '"' + (m.minutes === n ? ' selected' : '') + '>' + n + ' min</option>'; }).join('') + '</select></label>' +
          '<div class="full"><b style="font-size:13px">Who</b><div class="pi-who">' + (all.length ? all.map(function (x) { return '<label class="sc-cb"><input type="checkbox" data-mw="' + esc(x.id) + '"' + (m.attendees.indexOf(x.id) >= 0 ? ' checked' : '') + '> ' + esc(x.name || x.role) + ' <small class="muted">' + esc(x.role) + (/@/.test(x.email || '') ? '' : ' · no email') + '</small></label>'; }).join('') : '<span class="muted">No stakeholders yet: add them on the Stakeholders tab first.</span>') + '</div></div>' +
          '<label class="full">Agenda<textarea data-mf="agenda" rows="4">' + esc(m.agenda) + '</textarea></label></div>' +
        (L.missing.length ? '<p class="sk-warn" style="margin:8px 0">No email for ' + esc(L.missing.map(function (x) { return x.name || x.role; }).join(', ')) + ': add it on the Stakeholders tab to invite them.</p>' : '') +
        '<div class="row" style="gap:6px;margin-top:8px"><a class="btn btn-gold btn-sm" data-mgo target="_blank" rel="noopener" href="' + esc(L.gcal) + '">📅 Create in Google Calendar + Meet</a><button class="btn btn-sm" data-mdl>⬇ Invite (.ics)</button><a class="btn btn-sm" data-mmail href="' + esc(L.mail) + '">✉ Email the invite</a><button class="btn btn-sm" data-msave' + (saved ? ' disabled' : '') + '>' + (saved ? '✓ Saved to this project' : '💾 Save to this project') + '</button></div>' +
        '<p class="muted" style="font-size:12px;margin:8px 0 0">Google Calendar opens with the time, guests and agenda filled in and adds the Google Meet video link; press <b>Save</b> there and Google emails the invites. A free Google account allows group calls up to 60 minutes, so 45 minutes fits.</p></div>';
    }
    if (r.replan) {
      var rc = (p.changes || []).filter(function (x) { return x.srcRef === piCrRef(e, 'p'); })[0];
      if (rc) h += '<div class="pi-act pi-imp"><h4>📐 Re-plan</h4>' + (rc.effect ? '<p><b>Effect:</b> finish ' + esc(dmy(rc.effect.f0)) + ' → <b>' + esc(dmy(rc.effect.f1)) + '</b>, budget ' + money(rc.effect.b0) + ' → <b>' + money(rc.effect.b1) + '</b></p>' : '<p>' + esc(rc.title) + '</p>') + piCrFoot(e, 'p', '', '', '') + '</div>';
      else {
        var RP = st.rp || (st.rp = replanImpact(r.replan));
        h += '<div class="pi-act pi-imp" data-replan><h4>📐 Re-plan: ' + esc(RP ? RP.a.outcome.replace(/^Re-plan /, '') : '') + '</h4>' + (RP ? '<p class="muted" style="margin:-2px 0 8px">Worked out from the plan: unfinished tasks are stretched in proportion' + (RP.budget ? ', and the budget difference is spread over the unfinished work in proportion to its cost' : '') + '. Completed tasks don\'t change. Untick anything that should stay as it is.</p>' + impactHtml(RP.a, null) : '<p class="muted">This plan has no scheduled tasks to re-plan yet.</p>') + '</div>';
      }
    }
    if (r.impact) { var im = (p.meetings || []).filter(function (x) { return x.id === r.impact.meeting.id; })[0] || null; h += '<div class="pi-act pi-imp">' + impactHtml(r.impact, im) + (im ? '<p style="margin:6px 0 0"><a class="btn btn-sm" href="#plan/' + esc(S.core) + '/comms">📞 Open the meeting log</a></p>' : '') + '</div>'; }
    if (r.swms) h += '<div class="pi-act"><div class="row" style="gap:6px"><a class="btn btn-gold btn-sm" href="#swms/' + esc(S.core) + '">🦺 Open the SWMS</a><button class="btn btn-sm" data-swdl="docx">⬇ Word</button><button class="btn btn-sm" data-swdl="pdf">⬇ PDF</button></div></div>';
    if ((r.sources || []).length) h += '<p class="pi-src">📎 ' + r.sources.map(esc).join(' · ') + (r.partial ? ' <span class="muted">(the most relevant parts of long documents were read)</span>' : '') + '</p>';
    if ((r.follow_ups || []).length) h += '<div class="pi-ex" style="margin-top:6px">' + r.follow_ups.map(function (x) { return '<button class="pi-chip" data-pifu="' + esc(x) + '">' + esc(x) + '</button>'; }).join('') + '</div>';
    if (r.tokens) h += '<small class="muted">About ' + r.tokens.toLocaleString('en-AU') + ' tokens.</small>';
    return h + '</div>';
  }
  function piWire(B) {
    var p = S.plan;
    B.querySelectorAll('[data-pia]').forEach(function (box) {
      var i = +box.getAttribute('data-pia'), e = S.intel.log[i], r = e.r || {}, st = S.intel.open[i] = S.intel.open[i] || {};
      box.querySelector('[data-pitog]').onclick = function () { st.fold = !piFolded(i); intelTab(); };
      box.querySelector('[data-pidel]').onclick = function () { M.confirmBox('Clear this answer?', '“' + esc(String(e.q).slice(0, 120)) + '” and its answer are cleared for everyone. Anything already added to the plan stays.', 'Clear', true).then(function (y) { if (!y) return;
        api('intelClear', { core: S.core, at: e.at }).then(function () { S.intel.log = S.intel.log.filter(function (x) { return x !== e; }); S.intel.open = {}; toast('Answer cleared'); intelTab(); }).catch(fail); }); };
      if (r.impact && box.querySelector('[data-imprev]')) impactWire(box, r.impact, (p.meetings || []).filter(function (x) { return x.id === r.impact.meeting.id; })[0] || null, intelTab);
      box.querySelectorAll('[data-swdl]').forEach(function (b) { b.onclick = function () { if (M.swms) M.swms.download(S.core, b.getAttribute('data-swdl')).catch(fail); }; });
      // v83: AI-suggested risks and stakeholders go to change control first (a change request), not straight into the register
      var ar = box.querySelector('[data-addrisks]'); if (ar) ar.onclick = function () {
        var list = Array.prototype.map.call(box.querySelectorAll('[data-rk]:checked:not(:disabled)'), function (c) { return r.risks[+c.getAttribute('data-rk')]; });
        if (!list.length) return toast('Tick the risks to send', true);
        var crit = list.filter(function (x) { return x.critical; }).length;
        piCrSend(e, 'r', 'Risks suggested by Project Intelligence: ' + pl(list.length, 'risk'), list.map(function (x) { return '- ' + x.title + (x.critical ? ' (critical path)' : '') + ': P' + x.p + ' × I' + x.i + ' = ' + x.p * x.i; }).join('\n'),
          { risk: { level: crit ? 'High' : list.some(function (x) { return x.p * x.i >= 12; }) ? 'Medium' : 'Low', text: pl(list.length, 'new risk') + ' for the Risk register' + (crit ? ', ' + crit + ' on the critical path (they can delay the finish date)' : '') + '.' } },
          { risks: list.map(function (x) { return { title: x.title, cause: x.cause || '', p: x.p, i: x.i, response: x.response, action: x.action || '', owner: x.owner || '', critical: !!x.critical }; }) });
      };
      var as = box.querySelector('[data-addsk]'); if (as) as.onclick = function () {
        var list = Array.prototype.map.call(box.querySelectorAll('[data-sk]:checked:not(:disabled)'), function (c) { return r.stakeholders[+c.getAttribute('data-sk')]; });
        if (!list.length) return toast('Tick the stakeholders to send', true);
        piCrSend(e, 'k', 'Stakeholders suggested by Project Intelligence: ' + pl(list.length, 'stakeholder'), list.map(function (x) { return '- ' + x.name + ', ' + x.role + ' (' + x.raci + ')'; }).join('\n'),
          { stakeholders: { level: list.some(function (x) { return x.raci === 'A'; }) ? 'Medium' : 'Low', text: pl(list.length, 'stakeholder') + ' to add to the Stakeholder register' + (list.some(function (x) { return x.raci === 'A'; }) ? ', including someone Accountable (check there is only one)' : '') + '.' } },
          { stakeholders: list.map(function (x) { return { name: x.name, role: x.role || '', raci: x.raci || 'I' }; }) });
      };
      box.querySelectorAll('[data-picropen]').forEach(function (b) { b.onclick = function () { S.crView = b.getAttribute('data-picropen'); location.hash = '#plan/' + S.core + '/change'; }; });
      var rpb = box.querySelector('[data-replan]');
      if (rpb && st.rp) {
        impactWire(rpb, st.rp.a, null, intelTab);
        var sendR = rpb.querySelector('[data-imcr]');
        if (sendR) { sendR.textContent = ccOff() ? '✓ Commit the re-plan' : '➜ Send the re-plan to change control'; sendR.onclick = function () {
          var picks = impactPicks(rpb); if (!Object.keys(picks).length) return toast('Tick the changes to send', true);
          var a = JSON.parse(JSON.stringify(st.rp.a)), d = st.rp;
          var c = crNew({ title: a.outcome, desc: 'Finish ' + dmy(d.R0.finish) + ' → ' + dmy(d.R1.finish) + '; budget ' + money(d.R0.BAC) + ' → ' + money(d.R1.BAC) + '.' + (a.summary.length ? '\n' + a.summary.join('\n') : '') + '\nOnce approved and signed, the new schedule and budget become the baseline.',
            reason: 'Suggested by Project Intelligence in answer to: “' + String(e.q || '').slice(0, 300) + '”', source: 'intel', srcRef: piCrRef(e, 'p'), srcTitle: 'Project Intelligence answer', items: a, picks: picks, priority: 'High',
            estDays: d.R1.finish && d.R0.finish ? (d.R1.finish > d.R0.finish ? workBetween(d.R0.finish, d.R1.finish) - 1 : -(workBetween(d.R1.finish, d.R0.finish) - 1)) : 0, estCost: Math.round((d.R1.BAC - d.R0.BAC) * 100) / 100 });
          if (ccOff()) { crCommitNow(c); return; }
          dirty(crNo(c) + ' raised'); S.crView = c.id; toast(crNo(c) + ' raised: approve and sign it to redraw the Gantt chart and re-baseline the budget');
          location.hash = '#plan/' + S.core + '/change';
        }; }
      }
      if (!r.meeting || !st.meeting || !box.querySelector('[data-mgo]')) return;
      var m = st.meeting;
      var refresh = function () { var L = piMeetLinks(m); box.querySelector('[data-mgo]').href = L.gcal; box.querySelector('[data-mmail]').href = L.mail; };
      box.querySelectorAll('[data-mf]').forEach(function (el) { el.addEventListener('input', function () { var k = el.getAttribute('data-mf'); m[k] = k === 'minutes' ? +el.value : el.value; refresh(); }); el.addEventListener('change', function () { var k = el.getAttribute('data-mf'); m[k] = k === 'minutes' ? +el.value : el.value; refresh(); }); });
      box.querySelectorAll('[data-mw]').forEach(function (el) { el.onchange = function () { var id = el.getAttribute('data-mw'); m.attendees = m.attendees.filter(function (x) { return x !== id; }); if (el.checked) m.attendees.push(id); intelTab(); }; });
      box.querySelector('[data-mdl]').onclick = function () { piIcs(m); };
      box.querySelector('[data-mgo]').addEventListener('click', function () { if (!(p.meetings || []).some(function (x) { return x.id === m.id; })) { (p.meetings = p.meetings || []).push(JSON.parse(JSON.stringify(m))); dirty(); setTimeout(intelTab, 50); } });
      box.querySelector('[data-msave]').onclick = function () { (p.meetings = p.meetings || []).push(JSON.parse(JSON.stringify(m))); dirty(); toast('Meeting saved to this project'); intelTab(); };
    });
  }
  function piAsk(q) {
    if (S.piBusy) return;
    S.piBusy = q; S.piDraft = ''; intelTab();
    var id = Array.from(crypto.getRandomValues(new Uint8Array(10))).map(function (b) { return b.toString(16).padStart(2, '0'); }).join(''), t0 = Date.now(), core = S.core;
    var hist = S.intel.log.slice(-3).map(function (e) { return { q: e.q, a: String((e.r || {}).answer || '').slice(0, 600) }; });
    var done = function () { S.piBusy = false; if (S.tab === 'intel' && S.core === core) intelTab(); };
    var poll = function () {
      if (Date.now() - t0 > 180000) { done(); return toast('The AI took too long. Try again, or ask a shorter question.', true); }
      return new Promise(function (res) { setTimeout(res, 2000); }).then(function () { return api('planAiStatus', { id: id }); }).then(function (d) {
        if (d.status === 'done') { S.intel.log.push({ at: Date.now(), by: '', q: q, r: d.intel }); S.intel.log = S.intel.log.slice(-30);
          if (d.intel && d.intel.impact && S.core === core) { var mm = (S.plan.meetings || []).filter(function (x) { return x.id === d.intel.impact.meeting.id; })[0]; if (mm) { mm.analysed = Date.now(); mm.applied = 0; if (S.comms && S.comms.core === core) S.comms.an[mm.id] = d.intel.impact; dirty('meeting analysed by Project Intelligence'); } }
          done(); return; }
        if (d.status === 'error') { done(); toast(d.error || 'The AI could not answer', true); return; }
        return poll();
      });
    };
    fetch('/.netlify/functions/planai-background', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-MBS-Admin': '1', 'X-Champ-Lang': (window.ChampI18n && window.ChampI18n.get()) || 'en' },
      body: JSON.stringify({ mode: 'intel', id: id, core: core, question: q, history: hist }) })
      .then(function (r) { if (r.status >= 400) throw new Error('Could not start the AI (' + r.status + ')'); return poll(); })
      .catch(function (e) { done(); fail(e); });
  }
  function piExtract(f) {
    var name = f.name.toLowerCase();
    if (/\.pdf$/.test(name)) return piLoad('vendor/pdf.min.js?v=3111', function () { return !!window.pdfjsLib; }).then(function () {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js?v=3111';
      return f.arrayBuffer().then(function (buf) { return window.pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise; }).then(function (doc) {
        var parts = [], n = doc.numPages, chain = Promise.resolve();
        for (var k = 1; k <= n; k++) (function (k) { chain = chain.then(function () { return doc.getPage(k).then(function (pg) { return pg.getTextContent(); }).then(function (c) {
          var s = ''; c.items.forEach(function (it) { s += it.str + (it.hasEOL ? '\n' : ' '); }); parts.push('[page ' + k + ']\n' + s.replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim()); }); }); })(k);
        return chain.then(function () { return { text: parts.join('\n\n'), pages: n }; });
      });
    });
    if (/\.docx$/.test(name)) return piLoad('vendor/mammoth.browser.min.js?v=180', function () { return !!window.mammoth; }).then(function () { return f.arrayBuffer(); }).then(function (buf) { return window.mammoth.extractRawText({ arrayBuffer: buf }); }).then(function (r) { return { text: r.value, pages: 0 }; });
    if (/\.doc$/.test(name)) return Promise.reject(new Error('Old Word .doc files can\'t be read: open it in Word and save as .docx or PDF.'));
    if (/\.(txt|md|csv|json|eml|html?|vtt|srt)$/.test(name) || /^text\//.test(f.type)) return f.text().then(function (t) { if (/\.html?$/.test(name)) { var d = document.createElement('div'); d.innerHTML = t.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ''); t = d.textContent; } return { text: t, pages: 0 }; });
    return Promise.reject(new Error('“' + f.name + '” is not a PDF, Word (.docx) or text file.'));
  }
  function piUpload(files) {
    var box = $('#piUp'), I = S.intel, core = S.core;
    var one = function (f) {
      if (box) box.innerHTML = '<p class="ask-think" style="margin:0 0 8px">Reading “' + esc(f.name) + '”…</p>';
      return piExtract(f).then(function (x) {
        if (!x.text || x.text.replace(/\[page \d+\]/g, '').trim().length < 20) throw new Error('No text found in “' + f.name + '”. If it is a scanned PDF (pictures of pages), save it as a text PDF or Word file first.');
        var send = function (b64) { return api('intelUpload', { core: core, name: f.name, type: f.type, size: f.size, pages: x.pages, text: x.text, file: b64 }); };
        if (f.size > 3.5 * 1024 * 1024) return send('');
        return new Promise(function (res) { var rd = new FileReader(); rd.onload = function () { res(String(rd.result).replace(/^data:[^,]*,/, '')); }; rd.readAsDataURL(f); }).then(send);
      }).then(function (r) { I.docs.push(r.doc); toast('Added “' + r.doc.name + '”' + (r.truncated ? ' (very long: the first 400,000 characters are kept)' : '')); })
        .catch(function (e) { toast(e.message, true); });
    };
    files.reduce(function (c, f) { return c.then(function () { return one(f); }); }, Promise.resolve()).then(function () { if (S.tab === 'intel' && S.core === core) intelTab(); });
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
  /* ---------- v43: ⚡ Critical path ---------- */
  // Total float of each task = how many working days it can start later before the project finish moves.
  // Worked out with the same scheduler as the Gantt (working days or weekends, the quote and cooling-off,
  // "After #" links, start dates set by hand), so it always agrees with the Schedule tab. Float 0 = critical.
  function cpm(p) {
    var base = JSON.parse(JSON.stringify(p)), R0 = rollup(base, today()), F = R0.finish, out = {};
    var maxK = Math.max(5, workBetween(R0.start || F, F) + 5);
    base.tasks.forEach(function (t) {
      var moved = function (k) {
        var q = JSON.parse(JSON.stringify(p)), qt = q.tasks.filter(function (x) { return x.id === t.id; })[0];
        var later = addWork(nextWork(t.es), k);
        if (!qt.snet || later > qt.snet) qt.snet = later;
        schedule(q);
        return q.tasks.reduce(function (m, x) { return x.ef > m ? x.ef : m; }, '') > F;
      };
      var lo = 0, hi = maxK;
      if (!moved(hi)) { out[t.id] = { es: t.es, ef: t.ef, float: hi, open: true }; return; }
      while (lo < hi) { var mid = Math.ceil((lo + hi) / 2); if (moved(mid)) hi = mid - 1; else lo = mid; }
      out[t.id] = { es: t.es, ef: t.ef, float: lo };
    });
    rollup(p, today());   // put the working-day setting back for this plan
    return { finish: F, start: R0.start, tasks: out };
  }
  function criticalTab(R) {
    var p = S.plan, C = cpm(p), rows = ordered(), all = !!(p.emergency || p.weekends);
    var fl = function (r) { return C.tasks[r.t.id] ? C.tasks[r.t.id].float : 0; };
    var crit = rows.filter(function (r) { return fl(r) === 0; }).sort(function (a, b) { return a.t.es < b.t.es ? -1 : a.t.es > b.t.es ? 1 : a.n - b.n; });
    var near = rows.filter(function (r) { var f = fl(r); return f > 0 && f <= 2; });
    var unit = all ? 'day' : 'working day';
    var kind = function (f) { return f === 0 ? 'crit' : f <= 2 ? 'near' : 'ok'; };
    var word = { crit: 'Critical', near: 'Near-critical', ok: 'Has slack' };
    var span = C.start && C.finish ? workBetween(C.start, C.finish) : 0;
    // the chain, in date order (tasks that run at the same time are shown together)
    var steps = [], last = null;
    crit.forEach(function (r) { if (last && last.es === r.t.es) last.items.push(r); else { last = { es: r.t.es, items: [r] }; steps.push(last); } });
    var chain = steps.map(function (s) {
      return '<div class="cp-step">' + s.items.map(function (r) {
        return '<div class="cp-box' + (r.t.dur === 0 ? ' mile' : '') + (r.t.pct >= 100 ? ' done' : '') + '"><b>#' + r.n + ' ' + esc(r.t.name) + '</b><small>' + (r.t.dur === 0 ? '◆ ' + esc(pretty(r.t.es)) : pl(r.t.dur, unit) + ' · ' + esc(pretty(r.t.es)) + (r.t.ef !== r.t.es ? ' – ' + esc(pretty(r.t.ef)) : '')) + (r.t.pct ? ' · ' + r.t.pct + '%' : '') + (r.t.fixed && r.t.snet ? ' · 📌 start set by hand' : '') + '</small></div>';
      }).join('') + '</div>';
    }).join('<div class="cp-arrow">→</div>');
    // timeline: bars, with the slack shown as a faint tail
    var d0 = C.start, dN = C.finish, maxEnd = dN;
    rows.forEach(function (r) { var f = fl(r); if (f > 0 && r.t.ef) { var e = addWork(r.t.ef, f); if (e > maxEnd) maxEnd = e; } });
    var days = Math.max(1, daysBetween(d0, maxEnd) + 1), pc = function (d) { return (daysBetween(d0, d) / days * 100).toFixed(3) + '%'; };
    var finLine = '<i class="cp-fin" style="left:' + ((daysBetween(d0, dN) + 1) / days * 100).toFixed(3) + '%" title="Planned finish ' + esc(dmy(dN)) + '"></i>';
    var tl = rows.map(function (r) {
      var t = r.t, f = fl(r), k = kind(f); if (!t.es) return '';
      var w = ((daysBetween(t.es, t.ef) + 1) / days * 100).toFixed(3) + '%';
      var tail = f > 0 ? '<span class="cp-slack" style="left:calc(' + pc(t.ef) + ' + ' + (100 / days).toFixed(3) + '%);width:' + (daysBetween(t.ef, addWork(t.ef, f)) / days * 100).toFixed(3) + '%" title="Can slip ' + pl(f, unit) + '"></span>' : '';
      return '<div class="cp-row"><span class="cp-name">#' + r.n + ' ' + esc(t.name) + '</span><span class="cp-track">' + finLine + tail +
        (t.dur === 0 ? '<span class="cp-mile ' + k + '" style="left:' + pc(t.es) + '" title="' + esc(t.name + ' · ' + dmy(t.es)) + '"></span>'
          : '<span class="cp-bar ' + k + '" style="left:' + pc(t.es) + ';width:' + w + '" title="' + esc(t.name + ' · ' + dmy(t.es) + ' – ' + dmy(t.ef) + ' · ' + (f ? 'slack ' + pl(f, unit) : 'critical')) + '"></span>') + '</span></div>';
    }).join('');
    var table = rows.map(function (r) {
      var t = r.t, f = fl(r), k = kind(f);
      return '<tr class="cp-' + k + '"><td>' + r.n + '</td><td>' + esc(t.name) + (t.dur === 0 ? ' <small class="muted">milestone</small>' : '') + '</td><td>' + t.dur + '</td><td>' + esc(dmy(t.es)) + '</td><td>' + esc(dmy(t.ef)) + '</td>' +
        '<td><b>' + (f === 0 ? '0' : (C.tasks[t.id] && C.tasks[t.id].open ? f + '+' : f)) + '</b> <small class="muted">' + (f === 1 ? unit : unit + 's') + '</small></td><td><span class="cp-tag ' + k + '">' + word[k] + '</span></td></tr>';
    }).join('');
    var fb = p.finishBy ? (C.finish <= p.finishBy ? '✅ On time for Finish by (' + esc(dmy(p.finishBy)) + ').' : '⚠ ' + pl(workBetween(p.finishBy, C.finish) - 1, 'working day') + ' late for Finish by (' + esc(dmy(p.finishBy)) + '): shorten or overlap critical tasks, or press ✨ Fit to finish-by on the Schedule tab.') : '';
    $('#planBody').innerHTML =
      '<div class="card"><h2>⚡ Critical path</h2>' +
        '<p>The <b>critical path</b> is the chain of tasks that sets the finish date: <b>' + pl(crit.length, 'task') + '</b> running from <b>' + esc(dmy(C.start)) + '</b> to <b>' + esc(dmy(C.finish)) + '</b> (' + pl(span, unit) + '). ' +
        'A day lost on any of them moves the finish by a day; to finish sooner, shorten or overlap them. Other tasks have <b>slack</b> (float): they can slip that many ' + unit + 's without moving the finish.</p>' +
        (fb ? '<p class="cp-fb">' + fb + '</p>' : '') +
        '<div class="cp-chain">' + (chain || '<p class="muted">No tasks yet.</p>') + '</div>' +
        (near.length ? '<p class="muted" style="margin:10px 0 0">Watch these too (only 1–2 ' + unit + 's of slack): ' + near.map(function (r) { return '#' + r.n + ' ' + esc(r.t.name) + ' (' + fl(r) + ')'; }).join(', ') + '.</p>' : '') +
      '</div>' +
      '<div class="card"><h2>Timeline</h2><div class="cp-key"><span><i class="cp-bar crit"></i>Critical</span><span><i class="cp-bar near"></i>Near-critical (1–2 ' + unit + 's slack)</span><span><i class="cp-bar ok"></i>Has slack</span><span><i class="cp-slack"></i>How far it can slip</span><span><i class="cp-fin"></i>Finish</span></div>' +
        '<div class="cp-tl">' + tl + '</div></div>' +
      '<div class="card"><h2>Slack (float) of every task</h2><div class="table-wrap"><table class="cp-table"><thead><tr><th>#</th><th>Task</th><th>Days</th><th>Start</th><th>Finish</th><th>Slack</th><th></th></tr></thead><tbody>' + table + '</tbody></table></div>' +
        '<p class="muted" style="font-size:12.5px;margin:8px 0 0">Slack is worked out from the plan as it is now (working days' + (all ? ', weekends included' : ', Monday to Friday') + ', the quote and cooling-off, “After #” links and start dates set by hand). Change the plan on the Schedule tab and this updates.</p></div>';
  }
  /* ---------- v81: the order to set up a plan (PMBOK): stakeholders first, then scope, schedule and costs, risks, sign-off ---------- */
  function setupSteps(p, R) {
    var c = p.charter || {}, has = function (k) { return String(c[k] || '').trim().length > 2; }, sk = (p.stakeholders || []).filter(function (x) { return x.name; });
    var nA = sk.filter(function (x) { return x.raci === 'A'; }).length, work = p.tasks.filter(function (t) { return t.dur > 0; }), est = estOf(p);
    var go = function (tab) { return '#plan/' + esc(S.core) + '/' + tab; };
    var steps = [
      ['👥', 'Identify the stakeholders', 'stake', sk.length > 0 && nA === 1, sk.length ? pl(sk.length, 'stakeholder') + (nA === 1 ? ', one Accountable' : nA ? ', ' + nA + ' Accountable (should be one)' : ', nobody Accountable yet') : 'Who affects or is affected by the project, and their RACI. Without them the scope can miss requirements and sign-off stalls.'],
      ['🎯', 'Agree the scope', 'scope', has('objective') && has('inScope') && has('outScope'), 'Objective, in scope and out of scope, shaped by the stakeholders\' needs' + (has('objective') && has('inScope') && !has('outScope') ? ': out of scope still empty' : '')],
      ['▤', 'Plan the schedule and costs', 'schedule', work.length >= 2 && R.BAC > 0 && !est.n, work.length < 2 ? 'Tasks, dates and links' : !R.BAC ? pl(work.length, 'task') + ', no costs yet' : est.n ? pl(est.n, 'indicative cost') + ' still to review' : pl(work.length, 'task') + ', ' + money(R.BAC)],
      ['⚠', 'Record the risks', 'risks', (p.risks || []).some(function (r) { return r.title && r.status !== 'Closed'; }), pl((p.risks || []).filter(function (r) { return r.title && r.status !== 'Closed'; }).length, 'open risk')],
      ['✍', 'Sign off the project charter', 'scope', c.docStatus === 'Approved', c.docStatus === 'Approved' ? 'Approved' : 'Status: ' + (c.docStatus || 'Draft') + '. Make the charter, have it signed, upload the signed copy']];
    var next = -1; steps.some(function (x, i) { if (!x[3]) { next = i; return true; } return false; });
    if (next < 0) return '<div class="su-done">✓ Plan set-up complete: stakeholders, scope, schedule and costs, risks and a signed charter.</div>';
    var done = steps.filter(function (x) { return x[3]; }).length;
    return '<div class="card su"><div class="su-h"><h2>Plan set-up: do these in order</h2><span class="muted">' + done + ' of ' + steps.length + ' done</span></div><ol class="su-l">' + steps.map(function (x, i) {
      var cls = x[3] ? 'ok' : i === next ? 'now' : '';
      return '<li class="' + cls + '"><a href="' + go(x[2]) + '"><span class="su-n">' + (x[3] ? '✓' : i + 1) + '</span><span class="su-t"><b>' + x[0] + ' ' + esc(x[1]) + (i === 0 ? ' <em class="su-first">Start here</em>' : '') + (i === next && i ? ' <em class="su-next">Next</em>' : '') + '</b><small>' + esc(x[4]) + '</small></span></a></li>';
    }).join('') + '</ol>' + (next === 0 ? '<p class="su-why"><b>Why stakeholders first?</b> Best practice (PMBOK) identifies the stakeholders before the scope: their needs become the requirements, the acceptance criteria and the sign-off. Skip it and the project risks late changes, rework, scope creep and stalled approvals.</p>' : '') + '</div>';
  }
  function overview(R) {
    var p = S.plan, t0 = today(), soon = toS(new Date(toD(t0).getTime() + 6 * 864e5));
    var coming = ordered().filter(function (r) { return r.t.pct < 100 && r.t.es <= soon && r.t.ef >= t0; });
    var evm = [['Budget at completion (BAC)', money(R.BAC), 'Total planned cost'], ['Planned value (PV)', money(R.PV), 'Work that should be done by today'], ['Earned value (EV)', money(R.EV), 'Work actually done (cost × % complete)'],
      ['Actual cost (AC)', money(R.AC), 'Money spent so far (Actual $ column)'], ['Schedule performance (SPI = EV ÷ PV)', R.SPI == null ? '—' : R.SPI, R.SPI == null ? '' : R.SPI >= 1 ? 'on or ahead of schedule' : 'behind schedule'],
      ['Cost performance (CPI = EV ÷ AC)', R.CPI == null ? '—' : R.CPI, R.CPI == null ? '' : R.CPI >= 1 ? 'on or under budget' : 'over budget'], ['Forecast final cost (EAC = BAC ÷ CPI)', R.EAC == null ? '—' : money(R.EAC), '']];
    $('#planBody').innerHTML = setupSteps(p, R) + estBanner(p) + '<div class="grid two"><div class="grid" style="align-content:start">' +
      '<div class="card"><h2>Time & cost (earned value)</h2><div class="table-wrap"><table><tbody>' + evm.map(function (e) { return '<tr><td>' + esc(e[0]) + '<br><small class="muted">' + esc(e[2]) + '</small></td><td class="num" style="font-weight:800;font-size:15px">' + esc(e[1]) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
        (S.expensesEx ? '<p class="muted" style="margin:10px 0 0">Expenses recorded for this job in Accounts: <b>' + money(S.expensesEx) + '</b> ex GST.</p>' : '') +
        (p.baseline ? '<p class="muted" style="margin:6px 0 0">Baseline set ' + esc(M.day(p.baseline.at)) + ': finish ' + esc(prettyY(p.baseline.finish)) + ', budget ' + money(p.baseline.BAC) + '. Now: finish ' + esc(prettyY(R.finish)) + ' (' + esc(varDays(p.baseline.finish, R.finish)) + ').</p>' : '<p class="muted" style="margin:6px 0 0">Tip: press “Set baseline” once the plan is agreed, so you can track slippage.</p>') + '</div>' +
      '<div class="card"><h2>This week <small class="muted" style="font-weight:500">(' + esc(pretty(t0)) + ' to ' + esc(pretty(soon)) + ')</small></h2>' + (coming.length ? '<div class="list">' + coming.map(function (r) { return '<div class="item"><div><b>#' + r.n + ' ' + esc(r.t.name) + '</b><br><small>' + esc(pretty(r.t.es)) + ' – ' + esc(pretty(r.t.ef)) + (r.t.res && r.t.res.length ? ' · ' + esc(resText(r.t)) : '') + '</small></div><b>' + r.t.pct + '%</b></div>'; }).join('') + '</div>' : '<div class="empty">Nothing scheduled this week.</div>') + '</div></div>' +
      '<div class="grid" style="align-content:start">' +
      materialsCard() +
      '<div class="card"><h2>Late tasks</h2>' + (R.late.length ? '<div class="list">' + R.late.map(function (t) { return '<div class="item"><div><b>' + esc(t.name) + '</b><br><small style="color:#C2410C">was due ' + esc(pretty(t.ef)) + '</small></div><b>' + t.pct + '%</b></div>'; }).join('') + '</div>' : '<div class="empty">Nothing late. 👍</div>') + '</div>' +
      '<div class="card"><h2>Top risks</h2>' + ((p.risks || []).filter(function (r) { return r.status !== 'Closed'; }).sort(function (a, b) { return b.p * b.i - a.p * a.i; }).slice(0, 4).map(function (r) { return '<div class="item"><div><b>' + esc(r.title || '(untitled)') + '</b><br><small>' + esc(r.response) + (r.action ? ': ' + esc(r.action) : '') + '</small></div><span class="score ' + scoreCls(r.p * r.i) + '">' + r.p * r.i + '</span></div>'; }).join('') || '<div class="empty">No open risks.</div>') + '</div>' +
      '<div class="card"><h2>Open issues</h2>' + ((p.issues || []).filter(function (x) { return x.status !== 'Resolved'; }).map(function (x) { return '<div class="item"><div><b>' + esc(x.title || '(untitled)') + '</b><br><small>' + esc(x.priority) + (x.owner ? ' · ' + esc(x.owner) : '') + (x.due ? ' · due ' + esc(pretty(x.due)) : '') + '</small></div><small>' + esc(x.status) + '</small></div>'; }).join('') || '<div class="empty">No open issues.</div>') + '</div>' +
      (S.reminders.length ? '<div class="card"><h2>Reminders for this job</h2><div class="list">' + S.reminders.map(function (r) { return '<div class="item"><div><b>' + esc(r.when) + '</b><br><small>' + esc(r.text) + '</small></div></div>'; }).join('') + '</div></div>' : '') +
      '</div></div>';
    ordWire($('#planBody'));
    estWire($('#planBody'));
  }

  // 🛒 things to order (from the BOM, no Inventory): what, how many, order by when; tick when ordered; a note on what is happening (Enter or 💾 saves)
  function materialsCard() {
    var b = S.plan.bom, L = b && (b.lines || []); if (!L || !L.length || (S.mods && S.mods.bom === false)) return '';
    var ms = bomMs(), need = ms && ms.es ? ms.es : '', t0 = today(), done = L.filter(function (l) { return l.ordered; }).length;
    var by = function (l) { if (!need) return ''; var d = addDays(need, -(Number(l.lead) || 0)); return d; };
    var rows = L.slice().sort(function (a, c) { return (a.ordered - c.ordered) || String(by(a)).localeCompare(String(by(c))); });
    return '<div class="card ord"><div class="card-h"><h2>🛒 Things to order</h2><span class="sp"></span><small class="muted">' + done + ' of ' + L.length + ' ordered</small></div>' +
      '<p class="muted" style="margin:-4px 0 8px;font-size:12.5px">From the Bill of Materials' + (need ? ': needed by ' + esc(prettyY(need)) + ' (the 🧱 milestone)' : '') + '. Tick each one when it is ordered, and note what is happening.</p><div class="ord-list">' +
      rows.map(function (l) { var d = by(l), late = !l.ordered && d && d < t0, soon = !l.ordered && d && !late && d <= addDays(t0, 7);
        return '<div class="ord-row' + (l.ordered ? ' done' : '') + '" data-ol="' + esc(l.id) + '"><label class="ord-ck" title="' + (l.ordered ? 'Ordered' + (l.orderedBy ? ' by ' + esc(l.orderedBy) : '') : 'Tick when it is ordered') + '"><input type="checkbox" data-ord' + (l.ordered ? ' checked' : '') + '></label>' +
          '<div class="ord-main"><b>' + esc(l.name) + '</b><small>' + esc(q3c(l.qty) + ' ' + (l.unit || '')) + (d ? ' · <span class="' + (late ? 'bad' : soon ? 'warn' : '') + '">' + (l.ordered ? 'ordered' + (l.orderedAt ? ' ' + esc(pretty(new Date(l.orderedAt).toISOString().slice(0, 10))) : '') : (late ? 'order now (was due ' : 'order by ') + esc(pretty(d)) + (late ? ')' : '')) + '</span>' : '') + (l.lead ? ' · ' + l.lead + '-day lead time' : '') + '</small>' +
          '<div class="ord-note"><input data-onote maxlength="300" placeholder="Note: what is happening (supplier, quote, delivery date…)" value="' + esc(l.orderNote || '') + '"><button type="button" class="btn btn-sm" data-osave title="Save the note (or press Enter)">💾 Save</button></div>' +
          (l.orderNote && l.orderNoteBy ? '<small class="muted ord-by">Note by ' + esc(l.orderNoteBy) + (l.orderNoteAt ? ', ' + esc(new Date(l.orderNoteAt).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })) : '') + '</small>' : '') + '</div></div>'; }).join('') + '</div></div>';
  }
  function ordWire(box) {
    if (!box) return; var line = function (el) { var id = el.closest('[data-ol]').getAttribute('data-ol'); return ((S.plan.bom || {}).lines || []).filter(function (l) { return l.id === id; })[0]; };
    box.querySelectorAll('[data-ord]').forEach(function (c) { c.onchange = function () { var l = line(c); if (!l) return; l.ordered = c.checked; l.orderedBy = c.checked ? bomMe() : ''; l.orderedAt = c.checked ? Date.now() : 0; dirty((c.checked ? 'ordered: ' : 'not ordered: ') + l.name); setTimeout(render, 0); }; });
    var save = function (el) { var l = line(el), inp = el.closest('[data-ol]').querySelector('[data-onote]'), v = inp.value.trim(); if (!l || v === (l.orderNote || '')) { flash(inp); return; }
      l.orderNote = v; l.orderNoteBy = bomMe(); l.orderNoteAt = Date.now(); dirty('order note: ' + l.name); toast('Note saved'); setTimeout(render, 0); };
    var flash = function (inp) { inp.classList.add('ord-ok'); setTimeout(function () { inp.classList.remove('ord-ok'); }, 700); };
    box.querySelectorAll('[data-osave]').forEach(function (bt) { bt.onclick = function () { save(bt); }; });
    box.querySelectorAll('[data-onote]').forEach(function (inp) { inp.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); save(inp); } }; });
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

  M.dateBoxes = dateBoxes; M.dmy = dmy;
  M.addView('projects', 'Projects', projects);
  M.addView('plan', 'Project plan', planView, 'projects');
  window.addEventListener('hashchange', function () { if (!/^#plan\//.test(location.hash)) { S.away = true; document.body.classList.remove('plan-wide'); if (S.timer) saveNow(); } });
  window.MBS.planState = S;   // for tests
})();
