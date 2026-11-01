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
  function coolOf(p) { return p.coolOff == null || p.coolOff === '' ? 3 : Math.max(0, Math.min(10, Math.round(+p.coolOff) || 0)); }
  function gateOf(p) {
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
    if (!g) return w + 'Once there is a quote, the work waits for it to be accepted plus a cooling-off period of ' + days + ' (tick Emergency to start straight away).';
    if (g.accepted) return w + '✅ Quote <b>' + esc(g.id) + '</b> accepted on ' + esc(dmy(g.date)) + '; after the ' + days + ' cooling-off the work starts <b>' + esc(dmy(gateDate(p))) + '</b>.';
    return w + '🔒 Quote <b>' + esc(g.id) + '</b> is not accepted yet. The work waits for acceptance plus ' + days + ' cooling-off: assuming acceptance on the quote date (' + esc(dmy(g.date)) + '), the work starts <b>' + esc(dmy(gateDate(p))) + '</b>. It moves if the customer accepts later.';
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
  var cost = function (t) { return r2((Number(t.qty) || 0) * (Number(t.rate) || 0) + matCost(t)); };
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
  function buildTemplate(id) {
    var f = catalogItem(id); if (!f) return TEMPLATES.blank;
    var it = f.item;
    if (it.legacy) return TEMPLATES[it.legacy];
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
    split: (function () { try { return +localStorage.getItem('mbsPlanSplit') || 0; } catch (e) { return 0; } })(), closed: {}, cols: (function () { try { return localStorage.getItem('mbsPlanCols') || 's'; } catch (e) { return 's'; } })(), core: '', plan: null, rev: 0, job: null, tab: 'schedule', zoom: 'day', saving: false, timer: null, reminders: [], expensesEx: 0 };
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
        if (plan.tasks.some(function (t) { return matsOf(t).length; })) loadInv().then(function () { if (S.plan === plan && (S.tab === 'schedule' || S.tab === 'overview') && !S.timer && !document.activeElement.closest('#planBody')) render(); });
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
  function projects() {
    return api('planList', { today: today() }).then(function (d) {
      return api('planJobs', {}).then(function (j) {
        var avail = j.jobs;
        V().innerHTML = '<div class="card"><div class="card-h"><h2>Project plans (' + d.plans.length + ')</h2>' +
          '<div class="row"><select id="newPlanJob" style="width:auto;max-width:min(760px,100%)"><option value="">Plan a job…</option>' + avail.map(function (x) { return '<option value="' + esc(x.core) + '">' + esc(jobLabel(x)) + '</option>'; }).join('') + '</select><button class="btn btn-gold btn-sm" id="newPlanGo">＋ Start a plan</button></div></div><div id="jobPeek" hidden></div>' +
          (d.plans.length ? '<div class="table-wrap"><table><thead><tr><th>Project</th><th>Progress</th><th class="hide-sm">Finish</th><th title="Schedule Performance Index: work done ÷ work planned by today">SPI <small class="muted" style="text-transform:none;letter-spacing:0">(time)</small></th><th title="Cost Performance Index: value of work done ÷ actual cost">CPI <small class="muted" style="text-transform:none;letter-spacing:0">(cost)</small></th><th class="hide-sm">Risks</th><th class="hide-sm">Issues</th><th></th></tr></thead><tbody>' +
            d.plans.map(function (p) {
              return '<tr class="click" data-plan="' + esc(p.core) + '"><td><b>' + esc(p.name) + '</b><br><small class="muted"><span class="ref">' + esc(p.ref) + '</span> · ' + esc(p.customer) + '</small></td>' +
                '<td style="min-width:140px"><div class="pbar"><span style="width:' + p.pct + '%"></span></div><small>' + p.pct + '% · ' + p.done + '/' + p.total + ' tasks' + (p.late ? ' · <b style="color:#C2410C">' + p.late + ' late</b>' : '') + '</small></td>' +
                '<td class="hide-sm">' + esc(prettyY(p.finish)) + '</td><td class="evcell">' + evChip('SPI', p.SPI) + '</td><td class="evcell">' + evChip('CPI', p.CPI) + '</td>' +
                '<td class="hide-sm">' + p.openRisks + (p.highRisks ? ' <b style="color:#C2410C">(' + p.highRisks + ' high)</b>' : '') + '</td><td class="hide-sm">' + p.openIssues + '</td><td><button class="btn btn-sm" data-pdel="' + esc(p.core) + '" data-pname="' + esc(p.name) + '" title="Delete this plan">🗑</button></td></tr>';
            }).join('') + '</tbody></table></div>' + evLegend() : '<div class="empty">No plans yet. Pick a job above, or open a job and press “Project plan”.</div>') + '</div>';
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
        var byCore = {}; avail.forEach(function (x) { byCore[x.core] = x; });
        $('#newPlanJob').onchange = function () { var x = byCore[this.value], el = $('#jobPeek'); el.hidden = !x; el.innerHTML = x ? jobPeek(x) : ''; };
        $('#newPlanGo').onclick = function () { var c = $('#newPlanJob').value; if (!c) return toast('Pick a job first', true); location.hash = '#plan/' + c; };
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
      S.core = d.job.core; S.job = d.job; S.reminders = d.reminders; S.expensesEx = d.expensesEx; S.tab = tab;
      if (!d.plan) return chooser();
      S.plan = normalise(d.plan); S.rev = d.plan.rev; S.chain = null; S.away = false;
      loadChain();
      return loadInv().then(render);
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
  var EMERG = /\bemergenc|\burgent|\basap\b|straight away|right away|immediately|burst (pipe|water)|flood(ing|ed)?\b|storm damage|water (is )?(pouring|coming in|everywhere)/i;
  /* ---------- new plan: scope of work + job type / blank / ✨ AI ---------- */
  var GUESS = [[/exhaust|\bfan\b/, 'exhaust-fan'], [/shower.{0,40}leak|leak.{0,40}shower/, 'shower-leak'], [/vanity|toilet|tapware|\btaps?\b/, 'vanity'], [/bathroom.{0,40}(waterproof|retil)|(waterproof|retil).{0,40}bathroom/, 'bathroom'], [/bathroom|ensuite/, 'bath-reno'],
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
    var tasks = t.rows.map(function (r) { var id = 't' + (++n); ids[r[1]] = id; return { id: id, phase: 'ph1', name: r[2], dur: r[3], res: [], lead: '', resource: '', qty: r[5], unit: r[6], rate: r[7], pred: r[8], actual: 0, pct: 0, status: 'todo', snet: '', notes: '',
      subs: (r[9] || []).map(function (x, i) { return { id: 's' + n + '_' + (i + 1), name: x[0], off: x[1], dur: x[2], owner: '', status: 'todo' }; }) }; });
    tasks.forEach(function (x) { x.pred = x.pred.map(function (k) { return ids[k]; }).filter(Boolean); fitSubs(x); });
    extra = extra || {};
    var inScope = String(scope || '').trim();
    if (t.scope) inScope = inScope ? inScope + '\n\nTypical work: ' + t.scope : t.scope;
    return { name: t.name, start: start, phases: [{ id: 'ph1', name: 'Work' }], tasks: tasks,
      charter: { objective: t.objective, inScope: inScope, outScope: extra.outScope || '', deliverables: extra.deliverables || '', acceptance: extra.acceptance || 'Work complete, inspected and accepted by the customer; site clean; invoice issued.', assumptions: extra.assumptions || '', notes: extra.notes || '',
        budget: r2(tasks.reduce(function (a, x) { return a + cost(x); }, 0)), customer: job.name || '', manager: '' },
      risks: t.risks.map(function (r, i) { return { id: 'r' + (i + 1), title: r[0], cause: r[5] || '', p: r[1], i: r[2], response: r[3], action: r[4], owner: '', review: '', status: 'Open', raised: today() }; }),
      issues: [], baseline: null };
  }
  function fromAi(d, job, start, scope) {   // the AI draft -> the same row format as the templates
    var rows = d.tasks.map(function (x, i) { return [0, 'a' + (i + 1), x.n, x.d, '', x.q, x.u, x.r, (x.after || []).map(function (a) { return 'a' + a; }), x.s]; });
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
    return '<option value="">Choose a job type…</option>' + CATALOG.map(function (c) { return '<optgroup label="' + esc(c.c) + '">' + c.items.map(function (i) { return '<option value="' + i.id + '"' + (i.id === sel ? ' selected' : '') + '>' + esc(i.n) + '</option>'; }).join('') + '</optgroup>'; }).join('');
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
  function chooser() {
    setTimeout(function () { dateBoxes(V()); }, 0);
    $('#title').textContent = 'Project plan';
    var j = S.job, scope0 = j.scope || '';
    var guess = guessType(j.title + ' ' + scope0);
    S.mode = 'type'; S.aiDraft = null; S.aiId = ''; S.aiText = ''; S.tplType = ''; S.aiFinish = ''; S.tplWeek = false; S.coolZero = false; S.datesTouched = false; S.lastDates = '';
    V().innerHTML = '<div class="row" style="margin-bottom:14px"><a class="btn btn-sm" href="#job/' + esc(j.core) + '">← ' + esc(j.ref) + '</a><h2 style="font-size:22px">Plan this job: ' + esc(j.name) + ': ' + esc(j.title || j.service || 'Job') + '</h2></div>' +
      '<div class="card"><h2>1. What the customer wants (scope of work)</h2>' +
      '<p class="jobline"><span class="ref">' + esc(j.ref) + '</span> <b>' + esc(j.title || '') + '</b>' + [j.suburb, j.source ? 'from ' + j.source : ''].filter(Boolean).map(function (x) { return ' · ' + esc(x); }).join('') + '</p>' +
      '<p class="muted" style="margin:0 0 8px">The tasks (WBS) and Gantt chart are built from this, so it is needed. It is filled in from the enquiry and notes: check it and add what is missing (what, where, sizes, materials, access, deadline).</p>' +
      '<textarea id="tplScope" rows="5" placeholder="e.g. Bathroom exhaust fan is noisy and has stopped working. Replace it with a quieter fan, duct it outside through the eave, patch and paint the ceiling around it.">' + esc(scope0) + '</textarea></div>' +
      '<div class="card"><h2>2. How do you want to build the plan?</h2>' +
      '<div class="row pdates">' +
        '<label style="display:grid;gap:4px;font-weight:700">Start date<input type="date" id="tplStart" value="' + today() + '" style="width:auto"></label>' +
        '<label style="display:grid;gap:4px;font-weight:700"><span>Finish by <small class="muted" style="font-weight:400">(optional)</small></span><input type="date" id="aiFinish" value="' + esc(S.aiFinish || '') + '" style="width:auto"></label>' +
        '<label class="qchk emergpick" title="No cooling-off: the work can start straight away, the same day as the site inspection"><input type="checkbox" id="tplEmerg"' + (j.emergency || EMERG.test((j.title || '') + ' ' + scope0) ? ' checked' : '') + '> 🚨 Emergency job <small class="muted">(start straight away; otherwise the work waits for the quote to be accepted plus 3 business days cooling-off)</small></label>' +
        '<label class="qchk" title="Tick if the crew can work Saturday and Sunday: the schedule counts every day and finishes sooner"><input type="checkbox" id="tplWeek"' + (S.tplWeek ? ' checked' : '') + '> 📅 Weekends (Sat, Sun) allowed</label>' +
        '<p class="pdates-note">✨ <b>Not sure of the end date?</b> Leave <b>Finish by</b> empty and choose <b>Ask AI to build it</b>: the AI works out the end date for this job. If you set a Finish by date, the plan is checked against it (and ✨ Fit to finish-by can bring it in).</p>' +
      '</div><div class="tpl-grid tmodes">' +
      [['type', '📋 Pick a job type', CATALOG.length + ' common job types, each with sub-types. Builds tasks, sub-tasks, example costs and risks.'], ['blank', '⬜ Blank plan', 'Two rows to start from. Add your own tasks.'], ['ai', '✨ Ask AI to build it', 'Describe the job; AI works out the tasks, sub-tasks, costs, scope and risks, plus tips to help you plan.']]
        .map(function (m) { return '<button class="tpl tmode' + (S.mode === m[0] ? ' on' : '') + '" data-mode="' + m[0] + '"><b>' + m[1] + '</b><small>' + m[2] + '</small></button>'; }).join('') + '</div>' +
      '<div id="modeBody" style="margin-top:14px"></div>' +
      '<div class="row" style="margin-top:16px;align-items:flex-end"><span class="sp"></span><button class="btn btn-gold" id="tplCreate">Create plan</button></div></div>';
    var mode = function () {
      V().querySelectorAll('[data-mode]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-mode') === S.mode); });
      var mb = $('#modeBody'), create = $('#tplCreate');
      create.disabled = false; create.textContent = 'Create plan';
      if (S.mode === 'type') {
        mb.innerHTML = '<label style="display:grid;gap:4px;font-weight:700">Job type<select id="tplType" style="max-width:520px">' + typeOptions(S.tplType || guess) + '</select></label>' +
          (guess && !S.tplType ? '<small class="muted">Suggested from the enquiry. Change it if it\'s not right.</small>' : '') + '<div id="tplPrev"></div>';
        var show = function () { var v = $('#tplType').value; S.tplType = v; $('#tplPrev').innerHTML = v ? previewHtml(newPlan(buildTemplate(v), j, $('#tplStart').value || today(), '')) : ''; };
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
      if ((desc || scope).length < 10) { toast('Describe the job first (what the customer wants done)', true); ($('#aiDescribe').value ? $('#aiDescribe') : $('#tplScope')).focus(); return; }
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
      fetch('/.netlify/functions/planai-background', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-MBS-Admin': '1' },
        body: JSON.stringify({ id: id, core: j.core, describe: desc, scope: scope, type: cat ? cat.cat + ': ' + cat.item.n : '', start: $('#tplStart').value || today(), finish: $('#aiFinish').value || '', emergency: !!($('#tplEmerg') && $('#tplEmerg').checked), weekends: !!($('#tplWeek') && $('#tplWeek').checked) }) })
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
      if (scope.length < 10 && !(S.mode === 'ai' && S.aiDraft)) { toast('Write the scope of work first: what the customer wants done', true); $('#tplScope').focus(); return; }
      if (S.mode === 'type') {
        var v = $('#tplType').value; if (!v) { toast('Pick a job type first', true); $('#tplType').focus(); return; }
        plan = newPlan(buildTemplate(v), j, start, scope); note = 'plan created (' + v + ')';
      } else if (S.mode === 'blank') {
        plan = newPlan(TEMPLATES.blank, j, start, scope); plan.name = j.title || j.service || 'Project plan'; note = 'plan created (blank)';
      } else {
        if (!S.aiDraft) return toast('Build the plan with AI first', true);
        plan = fromAi(S.aiDraft, j, start, scope); note = 'plan created (AI draft)';
      }
      var fb2 = $('#aiFinish') ? $('#aiFinish').value : '';
      if (fb2) { plan.finishBy = fb2; plan.charter.assumptions = ('Customer wants it finished by ' + dmy(fb2) + '.\n' + (plan.charter.assumptions || '')).trim(); }
      var btn = this; btn.disabled = true;
      plan.emergency = !!$('#tplEmerg').checked; plan.weekends = !!($('#tplWeek') && $('#tplWeek').checked); plan.coolOff = S.coolZero && !plan.emergency ? 0 : 3;
      S.plan = plan; S.rev = 0; S.tab = 'schedule';
      api('planSave', { core: S.core, plan: S.plan, rev: 0, note: note }).then(function (r) { S.plan = normalise(r.plan); S.rev = r.plan.rev; S.aiDraft = null; S.chain = null; loadChain(); S.aiText = ''; S.tplType = ''; toast('Plan created'); history.replaceState(null, '', '#plan/' + S.core + '/schedule'); render(); }).catch(function (e) { btn.disabled = false; S.plan = null; fail(e); });
    };
  }

  /* ---------- 📄 Quote & PM plan: plan -> quote -> invoice (value chain) ---------- */
  var DOCST = { draft: 'Draft', sent: 'Sent', accepted: 'Accepted', declined: 'Declined', void: 'Void', expired: 'Expired', overdue: 'Overdue', 'part-paid': 'Part-paid', paid: 'Paid' };
  function loadChain() {
    var core = S.core;
    return api('planQuoteInfo', { core: core }).then(function (d) {
      if (S.core !== core) return; S.chain = d;
      if (S.plan && JSON.stringify(d.gate || null) !== JSON.stringify(S.plan.gate || null)) { S.plan.gate = d.gate || null; render(); } else drawChain();
      return d;
    }).catch(function () {});
  }
  function liveQuote(c) { var q = (c.quotes || []).filter(function (x) { return x.status !== 'void'; }); return q[q.length - 1] || null; }
  function liveInvoice(c) { var v = (c.invoices || []).filter(function (x) { return x.status !== 'void'; }); return v[v.length - 1] || null; }
  function drawChain() {
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
        '<div class="qprev" id="qPrev"></div>' +
        (S.chain && !updating && liveQuote(S.chain) ? '<p class="full muted" style="font-size:12.5px;margin:0">A new quote is made (a revision of ' + esc(liveQuote(S.chain).id) + '). The old one stays in Quotes: void or decline it there if it is replaced.</p>' : '') +
        '<div class="full actions" style="justify-content:flex-end"><button class="btn" data-close type="button">Cancel</button><button class="btn btn-gold" id="qGo">' + (updating ? '↻ Update ' + esc(updating.id) : '📄 Make the quote') + '</button></div></form>');
    var f = $('#qForm');
    var prev = function () {
      var m = f.querySelector('[name=mode]:checked').value, lines = quoteLines(m, f.margin.value);
      var ex = r2(lines.reduce(function (a, l) { return a + r2(l.qty * l.price); }, 0)), gst = r2(ex * 0.1);
      $('#qPrev').innerHTML = lines.length ? '<b>' + lines.length + ' line' + (lines.length === 1 ? '' : 's') + '</b> · ex GST ' + money(ex) + ' · GST ' + money(gst) + ' · <b>total ' + money(ex + gst) + '</b><br><small class="muted">Plan cost ' + money(R.BAC) + (+f.margin.value ? ' + ' + f.margin.value + '% margin' : '') + ' · planned ' + esc(prettyY(R.start)) + ' to ' + esc(prettyY(R.finish)) + '</small>'
        : '<b class="bad">No task has a cost yet.</b> Fill in Qty and Unit $ on the Schedule first (the "$ Costs" view).';
      $('#qGo').disabled = !lines.length;
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
      return fetch('/.netlify/functions/planai-background', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-MBS-Admin': '1' },
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
    M.closeModal(); dirty('AI fitted the plan to finish by ' + f.finishBy); render();
    var Rn = rollup(p, today());
    toast('Plan updated: finishes ' + dmy(Rn.finish) + (Rn.finish <= f.finishBy ? ', on time' : '') + '. Press ↶ Undo the AI changes to put it back.');
  }
  function fitUndo() {
    if (!S.fitUndo || S.fitUndo.core !== S.core) return;
    var keepRev = S.plan.rev; S.plan = normalise(S.fitUndo.plan); S.plan.rev = keepRev; S.fitUndo = null;
    dirty('undid the AI finish-by changes'); render(); toast('The plan is back the way it was before the AI changes');
  }
  function render() {
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
    var tabs = [['overview', '◎ Overview'], ['schedule', '▤ Schedule & Gantt'], ['critical', '⚡ Critical path'], ['board', '▦ Board'], ['scope', '🎯 Scope'], ['risks', '⚠ Risks'], ['issues', '❗ Issues'], ['stake', '👥 Stakeholders'], ['contracts', '📜 Contracts'], ['comms', '📞 Comms'], ['reports', '📊 Reports'], ['swms', '🦺 SWMS'], ['intel', '🧠 Project Intelligence']];
    V().innerHTML = '<div class="row" style="margin-bottom:12px"><a class="btn btn-sm" href="#job/' + esc(S.core) + '">← ' + esc(S.job.ref) + '</a>' +
      '<h2 style="font-size:21px">' + esc(p.name) + '</h2><span class="muted">' + esc(S.job.name + (S.job.title ? ': ' + S.job.title : '')) + '</span><span class="sp"></span>' +
      '<span class="muted" id="planSave" style="font-size:13px">' + (S.timer || S.busy ? 'Saving…' : 'Saved ✓') + '</span><button class="btn btn-sm btn-gold" id="planQuote" title="Make a quote in Quotes from this plan (customer details, lines, a cover page and a 2-page project management plan with a Gantt chart)">📄 Quote &amp; PM plan</button><button class="btn btn-sm" id="planBase" title="Freeze today\'s dates and costs to compare against">📌 ' + (p.baseline ? 'Re-set baseline' : 'Set baseline') + '</button><button class="btn btn-sm" id="planWide" title="Hide the menu and use the whole screen">⛶ ' + (document.body.classList.contains('plan-wide') ? 'Normal view' : 'Wide view') + '</button><button class="btn btn-sm" id="planXls" title="Download the whole plan as an Excel workbook">⬇ Excel</button><button class="btn btn-sm" id="planCsv" title="Export the Gantt chart (tasks, dates, links) as CSV, Microsoft Project XML, Excel or calendar, for Microsoft Project, Primavera, Smartsheet, Asana, Monday.com and others">⬇ Gantt export</button><button class="btn btn-sm" onclick="window.print()">🖨 Print</button><button class="btn btn-sm btn-danger" id="planDel" title="Delete this plan">🗑 Delete plan</button></div>' +
      '<div id="planChain"></div>' +
      '<div class="grid pkpis">' +
        mini('Scope', R.pct + '% complete', R.done + ' of ' + R.total + ' tasks done', rag(R.total ? R.pct / Math.max(1, timePct(R)) : null, 0.95, 0.8)) +
        timeCard(p, R) +
        mini('Cost', money(R.AC) + ' of ' + money(R.BAC), (R.CPI == null ? 'no actual costs yet' : 'CPI ' + R.CPI + ' · forecast ' + money(R.EAC)), evRag(R.CPI)) +
        mini('Risks & issues', pl((p.risks || []).filter(function (r) { return r.status !== 'Closed'; }).length, 'risk') + ' · ' + pl((p.issues || []).filter(function (x) { return x.status !== 'Resolved'; }).length, 'issue'), pl((p.risks || []).filter(function (r) { return r.status !== 'Closed' && r.p * r.i >= 12; }).length, 'high risk'), (p.risks || []).some(function (r) { return r.status !== 'Closed' && r.p * r.i >= 15; }) ? 'red' : (p.issues || []).some(function (x) { return x.status !== 'Resolved' && /High|Critical/.test(x.priority); }) ? 'amber' : 'green') +
      '</div>' +
      '<div class="tabs" id="planTabs">' + tabs.map(function (t) { return '<a class="tab' + (S.tab === t[0] ? ' on' : '') + '" href="#plan/' + esc(S.core) + '/' + t[0] + '" style="text-decoration:none">' + t[1] + '</a>'; }).join('') + '</div><div id="planBody"></div>';
    $('#planWide').onclick = function () { document.body.classList.toggle('plan-wide'); render(); };
    $('#planQuote').onclick = function () {
      var q = S.chain && liveQuote(S.chain);
      if (q && q.fromPlan && q.status === 'draft' && !q.invoiceId) return quoteDialog(q);   // keep one draft in step with the plan
      quoteDialog(null);
    };
    drawChain();
    $('#planXls').onclick = function () { exportExcel(); };
    $('#planCsv').onclick = function () { ganttCsvDialog(); };
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
    ({ overview: overview, schedule: scheduleTab, critical: criticalTab, board: board, scope: scope, risks: risks, issues: issues, stake: stakeholders, contracts: contractsTab, comms: commsTab, reports: reportsTab, swms: swmsTab, intel: intelTab }[S.tab] || scheduleTab)(R);
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
      var lab = '<span class="glab" style="left:' + ((t.dur === 0 ? left + dayW : left + w) + 4) + 'px">' + (t.dur === 0 ? esc(pretty(t.es)) + ' ' : '') + '<b class="gpct">' + t.pct + '%</b> ' + esc(resShort(t)) + '</span>';
      if (t.dur === 0) return b + '<span class="gmile' + (t.pct >= 100 ? ' done' : '') + '" style="left:' + (left + dayW / 2 - 7) + 'px" title="' + esc(t.name + ' · ' + pretty(t.es) + ' · ' + stName[t.status]) + '"></span>' + lab;
      return b + '<span class="gbar st-' + t.status + (late ? ' late' : '') + '" style="left:' + left + 'px;width:' + w + 'px" title="' + esc(t.name + ' · ' + pretty(t.es) + ' – ' + pretty(t.ef) + ' · ' + stName[t.status] + ' ' + t.pct + '%') + '"><span class="gfill" style="width:' + t.pct + '%"></span></span>' + lab;
    };
    var html = '<div class="card" style="padding:12px"><div class="row" style="margin-bottom:10px"><button class="btn btn-sm btn-gold" id="addTask">＋ Task</button><button class="btn btn-sm" id="addMile">◆ Milestone</button>' +
      '<div class="qgate' + (p.emergency ? ' emerg' : p.gate && p.gate.accepted ? ' ok' : '') + '"><div class="qrow"><label class="qchk" title="Emergency work (burst pipe, storm damage, a leak that is doing damage): no cooling-off, the work can start straight away, the same day as the site inspection"><input type="checkbox" id="pEmerg"' + (p.emergency ? ' checked' : '') + '> 🚨 Emergency</label>' +
        '<label class="qchk" title="' + (p.emergency ? 'Emergency jobs already work Saturday and Sunday' : 'Tick if the crew can work Saturday and Sunday on this job: the schedule then counts every day and finishes sooner') + '"><input type="checkbox" id="pWeek"' + (p.emergency || p.weekends ? ' checked' : '') + (p.emergency ? ' disabled' : '') + '> 📅 Weekends (Sat, Sun) allowed</label>' +
        '<label class="qchk" title="Days after the quote is accepted before the work can start. The full cooling-off period is 5 business days; most customers agree to start after 3.">Cooling-off <select id="pCool"' + (p.emergency ? ' disabled' : '') + '>' + [0, 1, 2, 3, 4, 5].map(function (n) { return '<option value="' + n + '"' + (coolOf(p) === n ? ' selected' : '') + '>' + n + (n === 3 ? ' (usual)' : n === 5 ? ' (full period)' : '') + '</option>'; }).join('') + '</select> business days</label></div><div>' + gateText(p) + '</div></div>' +
      fitBar(p, R) +
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
      html += '<tr data-tid="' + esc(t.id) + '" class="' + (t.pct >= 100 ? 'tdone' : '') + (late ? ' tlate' : '') + (t.dur === 0 ? ' tmile' : '') + (subs.length ? ' tparent' : '') + '"><td class="muted nowrap">' + '<span class="grip" data-grip title="Drag up or down to move this task">⠿</span>' + (subs.length ? '<button class="subtog" type="button" data-tog title="' + (open ? 'Hide' : 'Show') + ' sub-tasks">' + (open ? '▾' : '▸') + '</button>' : '') + '<input class="posin" data-pos inputmode="numeric" value="' + r.n + '" title="Type a number to move this task there (1 = first)"></td>' +
        '<td><input type="checkbox" data-k="done"' + (t.pct >= 100 ? ' checked' : '') + ' title="Done" style="width:auto"></td>' +
        '<td><div class="tname"><input data-k="name" value="' + esc(t.name) + '" title="' + esc(t.name) + (t.dur === 0 ? ' (milestone)' : '') + (late ? ' · LATE: was due ' + pretty(t.ef) : '') + '"><button class="pkbtn" type="button" data-pick title="' + (matsOf(t).length ? 'Materials from stock (' + matsOf(t).length + '): change them' : 'Add materials from stock (any number, each with a quantity)') + '">📦</button></div>' + stockChip(t) +
          (t.dur === 0 ? '' : '<button class="subadd" type="button" data-addsub title="Break this task into smaller steps (they stay inside its dates)">＋ sub-task' + (subs.length ? ' · ' + subs.filter(function (x) { return x.status === 'done'; }).length + '/' + subs.length + ' done' : '') + '</button>') + '</td>' +
        '<td>' + resCell(t) + '</td>' +
        '<td><input data-k="dur" type="number" min="0" max="365" value="' + t.dur + '" style="width:50px" title="0 days = milestone"></td>' +
        '<td><input data-k="snet" type="date" value="' + esc(t.es) + '" min="' + esc(nextWork(p.start)) + '" class="' + (t.snet ? 'pinned' : '') + '" title="' + (t.fixed && t.snet ? 'Start set by hand: ' + dmy(t.snet) + '. It runs in parallel (the After # link is not used). Clear the date to follow After # again.' : t.snet ? 'Starts no earlier than ' + dmy(t.snet) + ' (clear the date box to remove)' : 'Worked out from the tasks before it. Type or pick a date to start it earlier (in parallel) or later: between the project start and finish.') + '"></td>' +
        '<td class="nowrap">' + esc(dmy(t.ef)) + (base && base.ef && base.ef !== t.ef ? '<br><small class="' + (t.ef > base.ef ? 'bad' : 'good') + '">base ' + esc(dmy(base.ef)) + '</small>' : '') + '</td>' +
        '<td><input data-k="pred" value="' + esc((t.pred || []).map(function (id) { return num[id]; }).filter(Boolean).join(', ')) + '" placeholder="e.g. 2,3" style="width:58px"' + (t.fixed && t.snet ? ' class="predoff" title="Not used while the start date is set by hand (runs in parallel)"' : '') + '></td>' +
        '<td><input data-k="qty" inputmode="decimal" value="' + esc(t.qty || '') + '" style="width:60px"></td>' +
        '<td><input data-k="unit" value="' + esc(t.unit || '') + '" placeholder="h, m², lot" style="width:56px"></td>' +
        '<td><input data-k="rate" inputmode="decimal" value="' + esc(t.rate || '') + '" style="width:74px"></td>' +
        '<td class="num">' + money(cost(t)) + '</td>' +
        '<td><input data-k="actual" inputmode="decimal" value="' + esc(t.actual || '') + '" style="width:80px"></td>' +
        '<td><select data-k="status" class="stsel st-' + t.status + '"' + (subs.length ? ' title="Setting this moves all its sub-tasks too"' : '') + '>' + STATUS.map(function (x) { return '<option value="' + x[0] + '"' + (t.status === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select></td>' +
        '<td><input data-k="pct" type="number" min="0" max="100" step="1" value="' + t.pct + '" style="width:54px"' + (subs.length ? ' disabled title="Worked out from the sub-tasks"' : '') + '></td>' +
        '<td class="acts"><button class="btn btn-sm" data-rem title="Reminder">🔔</button><button class="btn btn-sm" data-del title="Delete">✕</button></td>' +
        '</tr>';
      G += '<tr data-gtid="' + esc(t.id) + '"><td class="gcol"><div class="gtrack" style="width:' + W + 'px;' + weekendBg + '">' + todayLine + bar(t, base) + '</div></td></tr>';
      if (open) subs.forEach(function (sb, j) {
        var d = subDates(t, sb), sl = sb.status !== 'done' && d.ef && d.ef < t0, maxDur = Math.max(1, t.dur) - sb.off;
        var left = d.es ? x(d.es) : 0, sw = d.es ? (daysBetween(d.es, d.ef) + 1) * dayW : 0;
        html += '<tr class="tsub' + (sb.status === 'done' ? ' tdone' : '') + (sl ? ' tlate' : '') + '" data-sid="' + esc(sb.id) + '" data-ptid="' + esc(t.id) + '"><td class="muted nowrap subn"><span class="grip" data-grip title="Drag up or down to reorder (stays inside this task)">⠿</span>' + r.n + '.<input class="posin sub" data-spos inputmode="numeric" value="' + (j + 1) + '" title="Type a number to move this sub-task there (inside this task)"></td>' +
          '<td><input type="checkbox" data-sk="done"' + (sb.status === 'done' ? ' checked' : '') + ' style="width:auto" title="Done"></td>' +
          '<td><div class="subname"><span class="subarrow">↳</span><input data-sk="name" value="' + esc(sb.name) + '"></div></td>' +
          '<td><input data-sk="owner" list="resList" value="' + esc(sb.owner || '') + '" placeholder="Who" style="min-width:90px;width:110px"></td>' +
          '<td><input data-sk="dur" type="number" min="1" max="' + maxDur + '" value="' + sb.dur + '" style="width:50px" title="At most ' + maxDur + ' day' + (maxDur === 1 ? '' : 's') + ' (to stay inside the task)"></td>' +
          '<td><input data-sk="start" type="date" value="' + esc(d.es) + '" min="' + esc(t.es) + '" max="' + esc(t.ef) + '" title="Between ' + esc(dmy(t.es)) + ' and ' + esc(dmy(t.ef)) + ' (the task\'s dates)"></td>' +
          '<td class="nowrap">' + esc(dmy(d.ef)) + '</td><td class="muted" style="font-size:11.5px">in #' + r.n + '</td><td></td><td></td><td></td>' +
          '<td class="muted subcost" title="Costs stay on the task">–</td><td></td>' +
          '<td><select data-sk="status" class="stsel st-' + sb.status + '">' + STATUS.map(function (o) { return '<option value="' + o[0] + '"' + (sb.status === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></td>' +
          '<td class="muted">' + stPct[sb.status] + '</td>' +
          '<td class="acts"><button class="btn btn-sm" data-sdel title="Delete sub-task">✕</button></td>' +
          '</tr>';
        G += '<tr data-gsid="' + esc(sb.id) + '" data-gptid="' + esc(t.id) + '"><td class="gcol"><div class="gtrack gtrack-sub" style="width:' + W + 'px;' + weekendBg + '">' + todayLine + (d.es ? '<span class="gsub st-' + sb.status + (sl ? ' late' : '') + '" style="left:' + left + 'px;width:' + sw + 'px" title="' + esc(sb.name + ' · ' + pretty(d.es) + ' – ' + pretty(d.ef) + ' · ' + stName[sb.status]) + '"><span class="gfill" style="width:' + stPct[sb.status] + '%"></span></span><span class="glab" style="left:' + (left + sw + 4) + 'px">' + esc(sb.owner || '') + '</span>' : '') + '</div></td></tr>';
      });
    });
    if (!rows.length) { html += '<tr><td colspan="16"><div class="empty">No tasks yet. Press “＋ Task”.</div></td></tr>'; G += '<tr><td class="gcol"></td></tr>'; }
    html += '</tbody><tfoot><tr><td></td><td></td><td><b>Total (budget at completion)</b></td><td></td><td></td><td>' + esc(pretty(R.start)) + '</td><td>' + esc(pretty(R.finish)) + '</td><td></td><td></td><td></td><td></td><td class="num"><b>' + money(R.BAC) + '</b></td><td class="num"><b>' + money(R.AC) + '</b></td><td></td><td><b>' + R.pct + '%</b></td><td></td></tr></tfoot></table></div>' +
      '<div class="gsplitter" id="gSplitter" title="Drag to make the task list or the Gantt chart wider (double-click to reset)"><span></span></div>' +
      '<div class="gpane gright" id="gRight"><table class="gt gtr"><thead><tr><th class="gcol">' + scale + '</th></tr></thead><tbody>' + G + '</tbody><tfoot><tr><td class="gcol"></td></tr></tfoot></table></div></div>' +
      '<div class="res-tip" id="resTip" hidden><b>Tip:</b> you can add more than one person or trade. Press <kbd>Enter</kbd> or type a comma after each name. <b>★</b> = the lead: the first one added is the lead; click another name to make them the lead.</div>' +
      '<datalist id="resList">' + Array.from(new Set([].concat.apply([], p.tasks.map(function (t) { return t.res || []; })).concat(['Labourer', 'Tiler', 'Plumber', 'Electrician', 'Painter', 'Carpenter', 'Waterproofer', 'Supplier', 'Customer']))).filter(Boolean).map(function (r) { return '<option value="' + esc(r) + '">'; }).join('') + '</datalist></div>';
    $('#planBody').innerHTML = html;
    var B = $('#planBody');
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
        else if (['qty', 'rate', 'actual'].indexOf(k) >= 0) { t[k] = r2(String(el.value).replace(/[$,]/g, '')); }
        else t[k] = el.value;
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
    B.querySelectorAll('[data-del]').forEach(function (b) { b.onclick = function () { var t = task(b); M.confirmBox('Delete “' + t.name + '”?', 'Tasks that come after it will no longer wait for it.', 'Delete', true).then(function (ok) { if (!ok) return; p.tasks = p.tasks.filter(function (x) { return x !== t; }); p.tasks.forEach(function (x) { x.pred = (x.pred || []).filter(function (id) { return id !== t.id; }); }); dirty(); render(); }); }; });
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
        matsEditor(t);
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
  function ganttRows(p, subsOn) {   // the schedule as flat rows: tasks (level 1) with their sub-tasks (level 2) under them
    schedule(p);
    var rows = [], idOf = {}, n = 0;
    p.tasks.forEach(function (t) { idOf[t.id] = ++n; if (subsOn) n += (t.subs || []).length; });
    p.tasks.forEach(function (t, i) {
      var subs = subsOn ? (t.subs || []) : [];
      rows.push({ uid: idOf[t.id], wbs: String(i + 1), lvl: 1, name: t.name, es: t.es, ef: t.dur === 0 ? t.es : t.ef, dur: t.dur, preds: (t.pred || []).map(function (x) { return idOf[x]; }).filter(Boolean),
        mile: t.dur === 0, pct: t.pct || 0, status: stName[t.status] || '', res: (t.res || []).slice(), resTxt: resText(t), lead: t.lead || '', summary: subs.length > 0, notes: t.notes || '' });
      subs.forEach(function (sb, j) { var d = subDates(t, sb);
        rows.push({ uid: idOf[t.id] + j + 1, wbs: (i + 1) + '.' + (j + 1), lvl: 2, name: sb.name, es: d.es, ef: d.ef, dur: sb.dur, preds: [], mile: false, pct: stPct[sb.status] || 0, status: stName[sb.status] || '',
          res: sb.owner ? [sb.owner] : [], resTxt: sb.owner || '', lead: sb.owner || '', summary: false, parent: t.name, notes: '' }); });
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
    var footer = function (ws, rowNo) { var c = ws.getCell(rowNo, 1); c.value = 'Modern Building Solutions · MBS Console · ' + prettyY(t0); c.font = { size: 9, italic: true, color: { argb: GREY } }; };
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
      ['Cost: spent so far (actual)', R.AC, 'of ' + money(R.BAC) + ' budget' + (R.CPI == null ? '' : ' · CPI ' + R.CPI + ' · forecast ' + money(R.EAC)), evRag(R.CPI), money$],
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
    var cols = ['#', 'Task / sub-task', 'People (lead first)', 'Lead', 'Days', 'Start', 'Finish', 'After #', 'Qty', 'Unit', 'Unit $', 'Cost', 'Actual $', 'Status', '% complete', 'Late', 'Stock materials'];
    sc.columns = [6, 40, 28, 14, 7, 13, 13, 9, 8, 8, 11, 13, 12, 15, 11, 7, 26].map(function (w) { return { width: w }; });
    titleBlock(sc, 'Schedule', cols.length);
    header(sc, 4, cols);
    var row = 5, first = 5;
    p.tasks.forEach(function (t, i) {
      var late = t.pct < 100 && t.ef && t.ef < t0, mts = matsOf(t).map(function (m) { var x = invItem(m.item); return (m.qty || 0) + ' × ' + (x ? x.name : m.item); }).join(', ');
      var r = sc.getRow(row);
      r.values = [i + 1, (t.dur === 0 ? '◆ ' : '') + t.name, resText(t), t.lead || '', t.dur, D(t.es), D(t.ef), (t.pred || []).map(function (id) { return num[id]; }).filter(Boolean).join(', '),
        Number(t.qty) || 0, t.unit || '', Number(t.rate) || 0, (matsOf(t).length ? { formula: 'I' + row + '*K' + row + '+' + matCost(t), result: cost(t) } : { formula: 'I' + row + '*K' + row, result: cost(t) }), Number(t.actual) || 0, stName[t.status], (t.pct || 0) / 100, late ? 'Yes' : '', mts];
      r.font = { bold: !!(t.subs && t.subs.length), color: late ? { argb: 'FFB42318' } : undefined };
      [6, 7].forEach(function (c) { r.getCell(c).numFmt = dateF; }); [11, 12, 13].forEach(function (c) { r.getCell(c).numFmt = money$; }); r.getCell(15).numFmt = '0%';
      r.getCell(14).fill = fill(STC[t.status]); r.eachCell({ includeEmpty: true }, function (c) { c.border = box; c.alignment = { vertical: 'top', wrapText: c.col === 2 || c.col === 3 }; });
      row++;
      (t.subs || []).forEach(function (sb, j) {
        var d = subDates(t, sb), sl = sb.status !== 'done' && d.ef && d.ef < t0, s2 = sc.getRow(row);
        s2.values = [(i + 1) + '.' + (j + 1), '    ↳ ' + sb.name, sb.owner || '', '', sb.dur, D(d.es), D(d.ef), 'in #' + (i + 1), null, null, null, null, null, stName[sb.status], stPct[sb.status] / 100, sl ? 'Yes' : '', ''];
        s2.outlineLevel = 1; s2.font = { size: 10, color: { argb: sl ? 'FFB42318' : 'FF4A463D' } };
        [6, 7].forEach(function (c) { s2.getCell(c).numFmt = dateF; }); s2.getCell(15).numFmt = '0%'; s2.getCell(14).fill = fill(STC[sb.status]);
        s2.eachCell({ includeEmpty: true }, function (c) { c.border = box; c.fill = c.col === 14 ? c.fill : fill('FFFCFBF8'); });
        row++;
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
      for (var k = Math.max(0, a); k <= b && k < slots.length; k++) { var c = r.getCell(6 + k); c.fill = fill(late ? 'FFFCA5A5' : light ? STC[status] : STB[status]); }
    };
    var tCol = slotOf(t0);
    p.tasks.forEach(function (t, i) {
      var r = gs.getRow(gr), late = t.pct < 100 && t.ef && t.ef < t0;
      r.values = [i + 1, (t.dur === 0 ? '◆ ' : '') + t.name, D(t.es), D(t.ef), (t.pct || 0) / 100];
      r.getCell(3).numFmt = 'd mmm'; r.getCell(4).numFmt = 'd mmm'; r.getCell(5).numFmt = '0%'; r.font = { bold: !!(t.subs && t.subs.length), size: 10 };
      if (tCol >= 0) r.getCell(6 + tCol).border = { left: { style: 'thin', color: { argb: 'FFC2410C' } } };
      if (t.dur === 0) { var mc = r.getCell(6 + Math.max(0, slotOf(t.es))); mc.value = '◆'; mc.font = { bold: true, color: { argb: t.pct >= 100 ? 'FF16A34A' : INK } }; mc.alignment = { horizontal: 'center' }; }
      else paint(r, t.es, t.ef, t.status, late, false);
      gr++;
      (t.subs || []).forEach(function (sb, j) {
        var d = subDates(t, sb), s2 = gs.getRow(gr);
        s2.values = [(i + 1) + '.' + (j + 1), '    ↳ ' + sb.name, D(d.es), D(d.ef), stPct[sb.status] / 100];
        s2.getCell(3).numFmt = 'd mmm'; s2.getCell(4).numFmt = 'd mmm'; s2.getCell(5).numFmt = '0%'; s2.font = { size: 9, color: { argb: 'FF4A463D' } }; s2.outlineLevel = 1;
        paint(s2, d.es, d.ef, sb.status, sb.status !== 'done' && d.ef < t0, true); gr++;
      });
    });
    var legend = gs.getRow(gr + 1);
    legend.getCell(2).value = 'Colours: grey To do · blue In progress · purple In review / QA · green Done · red late · ◆ milestone · orange header = today'; legend.getCell(2).font = { size: 9, italic: true, color: { argb: GREY } };
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
    if (Object.keys(by).length) {
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
  function ownerPick(btn, cur, set) {
    var sh = (S.plan.stakeholders || []).filter(function (x) { return x.name || x.role; });
    kPop(btn, '<input class="kpop-q" placeholder="Search, or type a name">' + '<div class="kpop-list"></div>' + (cur ? '<button type="button" class="kpop-clear">✕ No owner</button>' : ''), function (m, done) {
      var q = m.querySelector('.kpop-q'), L = m.querySelector('.kpop-list');
      var draw = function () {
        var v = q.value.trim(), lv = v.toLowerCase(), hits = sh.filter(function (x) { return !lv || ((x.name || '') + ' ' + (x.role || '')).toLowerCase().indexOf(lv) >= 0; });
        L.innerHTML = hits.map(function (x) { var n = x.name || x.role; return '<button type="button" data-own="' + esc(n) + '"' + (n === cur ? ' class="on"' : '') + '><span class="kav">' + esc(initials(n)) + '</span><span><b>' + esc(n) + '</b><small>' + esc(x.role || '') + '</small></span></button>'; }).join('') +
          (v && !sh.some(function (x) { return (x.name || x.role || '').toLowerCase() === lv; }) ? '<button type="button" data-own="' + esc(v) + '"><span class="kav none">+</span><span><b>Use “' + esc(v) + '”</b><small>not in the Stakeholder register</small></span></button>' : '') +
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
  function board() {
    var p = S.plan, t0 = today(), F = bfState();
    var owners = []; p.tasks.forEach(function (t) { [ownerOf(t)].concat((t.subs || []).map(function (x) { return x.owner; })).forEach(function (n) { if (n && owners.indexOf(n) < 0) owners.push(n); }); });
    (p.stakeholders || []).forEach(function (x) { var n = x.name || x.role; if (n && owners.indexOf(n) < 0) owners.push(n); });
    var filt = !!(F.owner || F.prio);
    var storyOk = function (x) { if (F.owner && (F.owner === '-' ? x.owner : x.owner !== F.owner)) return false; if (F.prio && (F.prio === '-' ? x.priority : x.priority !== F.prio)) return false; return true; };
    var themeOk = function (t) { if (F.owner && (F.owner === '-' ? ownerOf(t) : ownerOf(t) !== F.owner)) return false; if (F.prio && (F.prio === '-' ? t.priority : t.priority !== F.prio)) return false; return true; };
    var rows = ordered().filter(function (r) {
      var t = r.t; if (F.q && (t.name + ' ' + (t.subs || []).map(function (x) { return x.name + ' ' + x.owner; }).join(' ') + ' ' + ownerOf(t)).toLowerCase().indexOf(F.q.toLowerCase()) < 0) return false;
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
      return '<div class="kcol kcol-' + c[0] + '" data-col="' + c[0] + '"><h3><span>' + c[1] + '</span><span class="kcount">' + pl(list.length, 'theme') + (pts ? ' · ' + pts + ' pts' : '') + '</span></h3><div class="kcards">' + list.map(function (r) {
        var t = r.t, rg = kRag(t.es, t.ef, t.pct >= 100, t0), subs = t.subs || [], tp = themePts(t), sdone = subs.filter(function (x) { return x.status === 'done'; }).length;
        var shown = filt ? subs.filter(storyOk) : subs;
        return '<div class="kcard kr-' + rg.c + '" draggable="true" data-tid="' + esc(t.id) + '">' +
          '<div class="kth"><div class="kth-l"><span class="kid">#' + r.n + (subs.length ? ' · THEME' : t.dur === 0 ? ' · MILESTONE' : '') + '</span><label class="kname"><input type="checkbox" data-tick' + (t.pct >= 100 ? ' checked' : '') + ' title="Done"><span>' + esc(t.name.replace(/^[✓◆\s]+/, '')) + '</span></label>' +
            ((t.res || []).length ? '<span class="kcrew" title="Crew on this task (from the Schedule): ' + esc(resText(t)) + '">' + esc(resShort(t)) + '</span>' : '') +
            (tp ? '<span class="ktp" title="' + (subs.length ? 'Theme points: the stories added up' : 'Points') + '">' + tp + ' pts</span>' : '') + '</div>' +
            '<div class="kth-r"><div class="kdates">' + esc(pretty(t.es)) + (t.dur > 1 ? ' – ' + esc(pretty(t.ef)) : '') + '</div><div class="kdays">' + (t.dur ? pl(t.dur, 'day') : 'Milestone') + '</div>' + (rg.txt ? '<div class="kdue kdue-' + rg.c + '">' + esc(rg.txt) + '</div>' : '') + '</div></div>' +
          (subs.length ? '<div class="kstories">' + shown.map(function (x) { var d = subDates(t, x), sr = kRag(d.es, d.ef, x.status === 'done', t0);
              return '<div class="kst' + (x.status === 'done' ? ' done' : '') + '" data-sid="' + esc(x.id) + '"><div class="kst-h"><i class="kd kd-' + sr.c + '" title="' + esc(pretty(d.es) + (d.ef !== d.es ? ' – ' + pretty(d.ef) : '') + (sr.txt ? ' · ' + sr.txt : '')) + '"></i><label><input type="checkbox" data-subtick="' + esc(x.id) + '"' + (x.status === 'done' ? ' checked' : '') + '><span>' + esc(x.name) + '</span></label></div>' + kCtl('s:' + x.id, x.owner, x.priority, x.points) + '</div>'; }).join('') +
            (filt && shown.length < subs.length ? '<div class="kmore">' + (subs.length - shown.length) + ' more ' + (subs.length - shown.length === 1 ? 'story' : 'stories') + ' hidden by the filter</div>' : '') + '</div>'
            : kCtl('t:' + t.id, ownerOf(t), t.priority, t.points)) +
          (t.dur > 0 ? '<div class="kaddrow" data-addrow></div><button type="button" class="kadd" data-kadd>＋ story</button>' : '') +
          '<div class="kfoot"><div class="pbar st-' + t.status + '"><span style="width:' + t.pct + '%"></span></div>' + (subs.length ? '<span class="muted">' + sdone + '/' + subs.length + '</span>' : '<span class="muted">' + t.pct + '%</span>') +
            (c[0] !== 'todo' ? '<button class="btn btn-sm" data-step="-1" title="Back one column">←</button>' : '') + (c[0] !== 'done' ? '<button class="btn btn-sm" data-step="1" title="Next column">→</button>' : '') + '</div></div>';
      }).join('') + (list.length ? '' : '<div class="kempty">' + (rows.length < p.tasks.length ? 'Nothing matches the filter' : 'Drop a theme here') + '</div>') + '</div></div>';
    }).join('') + '</div><p class="muted" style="margin:8px 0 0;font-size:12px">Each card is a theme (a task) with its user stories (sub-tasks). The theme\'s points add up its stories. 🟩 on track · 🟨 due within 3 days · 🟥 past its due date. Drag a card to another column as the work moves on; the Gantt chart follows.</p>';
    var B = $('#planBody'), find = function (id) { return p.tasks.filter(function (t) { return t.id === id; })[0]; };
    var move = function (t, k) { if (!t || t.status === k) return; setStatus(t, k); dirty(stName[k] + ': ' + t.name); render(); };
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
    B.querySelectorAll('[data-kadd]').forEach(function (b) { b.onclick = function () {
      var card = b.closest('.kcard'), t = find(card.getAttribute('data-tid')), row = card.querySelector('[data-addrow]');
      row.innerHTML = '<input class="kadd-in" placeholder="New user story, then Enter" maxlength="160">'; b.style.display = 'none';
      var inp = row.querySelector('input'); inp.focus();
      var add = function () { var v = inp.value.trim(); if (!v) { keep(); return; } t.subs = t.subs || []; t.subs.push({ id: 's' + Date.now().toString(36), name: v, owner: '', off: 0, dur: Math.max(1, t.dur), status: 'todo', priority: '', points: 0 }); fitSubs(t); derive(t); dirty('story added to ' + t.name + ': ' + v); keep(); };
      inp.onkeydown = function (e) { if (e.key === 'Enter') add(); if (e.key === 'Escape') keep(); }; inp.onblur = function () { setTimeout(add, 120); };
    }; });
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
      (S.job.scope ? '<div class="full jobreq"><b>Customer\'s request (from the enquiry)</b><div>' + esc(S.job.scope) + '</div></div>' : '') + f('inScope', 'In scope (what the customer wants done)', 4, 'What is included') + f('outScope', 'Out of scope', 2, 'What is NOT included (avoids arguments later), e.g. electrical work, painting outside the bathroom') +
      f('deliverables', 'Deliverables', 2, 'e.g. Waterproofing certificate, flood-test photos, finished bathroom, warranty') +
      f('acceptance', 'Acceptance criteria (how we know it\'s done)', 2, '') + f('assumptions', 'Assumptions & constraints', 2, 'e.g. Access weekdays 7am-5pm; no work in heavy rain; customer supplies tapware') +
      f('notes', 'Planning notes & tips', 3, 'e.g. Order tiles 2 weeks ahead; book the plumber for day 3; strata needs 48 h notice') +
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


  /* ---------- v45: 👥 Stakeholders (RACI) ---------- */
  var RACI = { R: ['Responsible', 'does the work'], A: ['Accountable', 'signs off, has the final say'], C: ['Consulted', 'asked before decisions'], I: ['Informed', 'kept up to date'] };
  function subOpts() {   // active subbies, not "Do not use", grouped by trade
    var by = {}; M.subs.list().filter(function (s) { return !s.archived && s.status !== 'Do not use'; }).forEach(function (s) { var t = M.subs.tradeName(s.trade); (by[t] = by[t] || []).push(s); });
    return Object.keys(by).sort().map(function (t) { return '<optgroup label="' + esc(t) + '">' + by[t].map(function (s) { return '<option value="' + esc(s.id) + '">' + esc(s.business) + (s.comp && s.comp.worst === 'expired' ? ' ⚠ papers expired' : '') + '</option>'; }).join('') + '</optgroup>'; }).join('');
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
        (M.subs ? '<select id="skSub" style="width:auto;max-width:240px"><option value="">👷 Add a subbie…</option>' + subOpts() + '</select> ' : '') +
        '<button class="btn btn-sm btn-gold" id="addStake">＋ Add stakeholder</button></div>' +
      '<p class="muted" style="margin:-4px 0 10px">Everyone with a part in this job and what they do, using <b>RACI</b>: ' +
        Object.keys(RACI).map(function (k) { return '<span class="raci raci-' + k + '">' + k + '</span> ' + RACI[k][0] + ' (' + RACI[k][1] + ')'; }).join(' · ') + '.</p>' +
      (L.length ? '<div class="sk-sum">' + Object.keys(RACI).map(function (k) { return '<span><span class="raci raci-' + k + '">' + k + '</span> ' + RACI[k][0] + ': <b>' + n[k] + '</b></span>'; }).join('') + '</div>' + warn +
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
    $('#addStake').onclick = function () { add({ raci: 'R' }); var i = document.querySelectorAll('#planBody [data-s=name]'); if (i.length) i[i.length - 1].focus(); };
    if ($('#skCust')) $('#skCust').onclick = function () { add({ name: S.job.name || '', role: 'Customer', raci: 'C', phone: S.job.phone || '', email: S.job.email || '' }); };
    if ($('#skSub')) $('#skSub').onchange = function () {
      var sb = M.subs.list().filter(function (x) { return x.id === this.value; }, this)[0]; if (!sb) return;
      add({ name: sb.business + (sb.contact ? ' (' + sb.contact + ')' : ''), role: M.subs.tradeName(sb.trade), raci: 'R', phone: sb.phone || '', email: sb.email || '', sub: sb.id });
      if (sb.comp && /expired/.test(sb.comp.worst)) toast('Heads up: ' + sb.business + ' has expired papers (' + sb.comp.problems.join(', ') + ')');
    };
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
      return fetch('/.netlify/functions/planai-background', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-MBS-Admin': '1' }, body: JSON.stringify({ mode: 'meet', id: id, core: core, meeting: m.id }) });
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
  function impactHtml(a, m) {
    var p = S.plan, num = {}; p.tasks.forEach(function (t, i) { num[t.id] = i + 1; });
    var applied = m && m.applied && m.analysed && m.applied >= m.analysed;
    var area = '<h4>Impact on the project</h4><div class="table-wrap"><table class="pi-tbl im-tbl"><thead><tr><th>Area</th><th>Impact</th><th>What it means</th></tr></thead><tbody>' +
      AREA_N.map(function (x) { var v = a.impact[x[0]] || { level: 'None', text: '' }; return '<tr><td class="nowrap"><b>' + x[1] + '</b></td><td><span class="lv ' + LVL_C[v.level] + '">' + v.level + '</span></td><td>' + (esc(v.text) || '<span class="muted">No change</span>') + '</td></tr>'; }).join('') + '</tbody></table></div>';
    var item = function (k, i, on, html) { return '<label class="im-it"><input type="checkbox" data-im="' + k + ':' + i + '"' + (on ? ' checked' : '') + (applied ? ' disabled' : '') + '><span>' + html + '</span></label>'; };
    var g = [];
    var have = function (id) { return p.tasks.some(function (t) { return t.id === id; }); };
    if (a.task_changes.length) g.push(['⏱ Schedule and cost', a.task_changes.map(function (c, i) {
      var w = []; if (c.durTo !== c.durFrom) w.push('days ' + c.durFrom + ' → <b>' + c.durTo + '</b>'); if (c.notBefore) w.push('not before <b>' + esc(dmy(c.notBefore)) + '</b>'); if (c.extra) w.push('<b>+' + money(c.extra) + '</b>');
      return item('t', i, have(c.id), '<b>#' + (num[c.id] || c.n) + ' ' + esc(c.name) + '</b>: ' + w.join(', ') + (c.why ? '<br><small class="muted">' + esc(c.why) + '</small>' : '') + (have(c.id) ? '' : ' <small class="bad">(task no longer in the plan)</small>'));
    })]);
    if (a.new_tasks.length) g.push(['＋ New tasks', a.new_tasks.map(function (t, i) { return item('n', i, true, '<b>' + esc(t.name) + '</b>: ' + pl(t.days, 'day') + (t.after.length ? ', after #' + t.after.map(function (x) { return num[x]; }).filter(Boolean).join(', #') : '') + (t.cost ? ', ' + money(t.cost) : '') + (t.why ? '<br><small class="muted">' + esc(t.why) + '</small>' : '')); })]);
    if (a.scope_changes.length) g.push(['🎯 Scope', a.scope_changes.map(function (x, i) { return item('s', i, true, '<b>' + x.type + ':</b> ' + esc(x.text) + (x.why ? '<br><small class="muted">' + esc(x.why) + '</small>' : '')); })]);
    if (a.risks.length) g.push(['⚠ Risks for the register', a.risks.map(function (x, i) { var dup = (p.risks || []).some(function (y) { return y.title.toLowerCase() === x.title.toLowerCase(); }); return item('r', i, !dup, '<b>' + esc(x.title) + '</b> ' + (x.critical ? '<span class="pi-crit">⚡ Critical</span> ' : '') + '<small>P' + x.p + ' × I' + x.i + ' = <b>' + (x.p * x.i) + '</b> · ' + esc(x.response) + '</small><br><small class="muted">' + esc(x.cause) + (x.action ? ' → ' + esc(x.action) : '') + '</small>' + (dup ? ' <small class="muted">(already in the register)</small>' : '')); })]);
    if (a.issues.length) g.push(['❗ Issues for the log', a.issues.map(function (x, i) { return item('i', i, true, '<b>' + esc(x.title) + '</b> <small>' + esc(x.priority) + (x.owner ? ' · ' + esc(x.owner) : '') + (x.due ? ' · due ' + esc(dmy(x.due)) : '') + '</small>' + (x.detail ? '<br><small class="muted">' + esc(x.detail) + '</small>' : '')); })]);
    if (a.stakeholders.length) g.push(['👥 New stakeholders', a.stakeholders.map(function (x, i) { var dup = (p.stakeholders || []).some(function (y) { return y.name && y.name.toLowerCase() === x.name.toLowerCase(); }); return item('k', i, !dup, '<b>' + esc(x.name) + '</b> · ' + esc(x.role) + ' <span class="raci raci-' + x.raci + '">' + x.raci + '</span>' + (dup ? ' <small class="muted">(listed)</small>' : '')); })]);
    if (a.quality.length) g.push(['✅ Quality (added to the acceptance criteria)', a.quality.map(function (x, i) { return item('q', i, true, esc(x)); })]);
    if (!g.length) return area + '<p class="muted">No changes to the plan came out of this meeting.</p>';
    return area + '<div class="im-box"><h4>Changes to apply to the plan</h4><div class="im-prev" data-imprev></div>' + g.map(function (x) { return '<div class="im-g"><b class="im-gh">' + x[0] + '</b>' + x[1].join('') + '</div>'; }).join('') +
      '<div class="row" style="gap:6px;margin-top:8px">' + (applied ? '<span class="cm-ok">✓ Applied to the plan ' + esc(new Date(m.applied).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Sydney' })) + '</span>' + (S.fitUndo && S.fitUndo.core === S.core && S.fitUndo.meet === m.id ? '<button class="btn btn-sm" data-imundo type="button">↶ Undo</button>' : '')
        : '<button class="btn btn-gold" data-imgo type="button">✓ Apply the ticked changes</button><span class="muted" style="font-size:12.5px">The Gantt chart, budget, scope and registers update; ↶ Undo puts it back.</span>') + '</div></div>';
  }
  function impactPicks(box) { var o = {}; box.querySelectorAll('[data-im]:checked').forEach(function (c) { o[c.getAttribute('data-im')] = 1; }); return o; }
  function impactApply(p, a, picks, m) {   // works on any plan object (the real one, or a copy for the preview)
    var byId = {}; p.tasks.forEach(function (t) { byId[t.id] = t; });
    var tag = m ? ' (meeting ' + dmy(m.date) + ')' : ' (meeting)', n = 0;
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
    a.stakeholders.forEach(function (x, i) { if (!picks['k:' + i]) return; n++; p.stakeholders.push({ id: 's' + Date.now().toString(36) + 'm' + i, name: x.name, role: x.role, raci: x.raci, phone: '', email: '', sub: '' }); });
    return n;
  }
  function impactWire(box, a, m, after) {
    var prev = box.querySelector('[data-imprev]');
    var show = function () {
      if (!prev) return;
      var picks = impactPicks(box), R0 = rollup(S.plan, today()), copy = JSON.parse(JSON.stringify(S.plan)); impactApply(copy, a, picks, m); var R1 = rollup(copy, today());
      var dd = R0.finish && R1.finish ? (R1.finish > R0.finish ? workBetween(R0.finish, R1.finish) - 1 : R1.finish < R0.finish ? -(workBetween(R1.finish, R0.finish) - 1) : 0) : 0, dc = Math.round((R1.BAC - R0.BAC) * 100) / 100;
      prev.className = 'im-prev' + (dd > 0 || dc > 0 ? ' worse' : '');
      prev.innerHTML = '<b>With the ticked changes:</b> finish ' + esc(dmy(R0.finish)) + ' → <b>' + esc(dmy(R1.finish)) + '</b> (' + (dd ? (dd > 0 ? '+' : '') + pl(dd, 'working day') : 'no change') + ')' +
        ' · budget ' + money(R0.BAC) + ' → <b>' + money(R1.BAC) + '</b> (' + (dc ? (dc > 0 ? '+' : '−') + money(Math.abs(dc)) : 'no change') + ')' + (p0finishBy(R1) ? ' · <span class="bad">after the Finish by date ' + esc(dmy(S.plan.finishBy)) + '</span>' : '');
    };
    box.querySelectorAll('[data-im]').forEach(function (c) { c.onchange = show; });
    show();
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
  function p0finishBy(R) { return S.plan.finishBy && R.finish && R.finish > S.plan.finishBy; }

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
        (t.subs || []).forEach(function (sb) { var d = subDates(t, sb); if (d.ef < win0 || d.es > win1) return; g.rows.push({ label: sb.name + (sb.owner ? ' · ' + sb.owner : ''), es: d.es, ef: d.ef, pct: stPct[sb.status], status: sb.status, level: 2 }); }); });
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
    fetch('/.netlify/functions/planai-background', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-MBS-Admin': '1' }, body: JSON.stringify({ mode: 'report', id: id, core: core, facts: facts }) })
      .then(function (x) { if (x.status >= 400) throw new Error('Could not start the AI (' + x.status + ')'); return poll(); }).catch(function (e) { end(); fail(e); });
  }

  /* ---------- v52: 🧠 Project Intelligence ---------- */
  // Ask anything about this project. The AI answers from the plan and the documents uploaded here (contract, specs ...),
  // can suggest risks and a stakeholder register, and set up a team meeting (Google Calendar invite with Google Meet, .ics).
  var PI_EX = ['Work out the critical and non-critical risks for this project', 'What would a stakeholder register look like for this project?',
    'Summarise the contract: price, payment stages, variations, defects period and delays', 'What could delay the finish date, and what should we do this week?',
    'Set up a 45-minute Google Meet with the stakeholders next Tuesday at 10am to review progress', 'Generate a SWMS for this project',
    'Analyse my last meeting: summarise the outcome and the impact on scope, time, cost, risks, issues and stakeholders'];
  var PI_KIND = { Contract: '📜', Specification: '📐', Quote: '💲', Variation: '🔁', Drawings: '🗺', Invoice: '🧾', Certificate: '✅', 'Meeting notes': '🗒', 'Meeting transcript': '🎙', Correspondence: '✉', Document: '📄' };
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
    var B = $('#planBody');
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
  function piAnswer(e, i) {
    var r = e.r || {}, p = S.plan, st = S.intel.open[i] = S.intel.open[i] || {}, fold = piFolded(i);
    var head = '<div class="pi-q"><button class="pi-tog" data-pitog title="' + (fold ? 'Open' : 'Fold') + ' this answer">' + (fold ? '▸' : '▾') + '</button><span class="pi-qt">“' + esc(e.q) + '”<small class="muted"> · ' + esc(new Date(e.at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Sydney' })) + (e.by ? ' · ' + esc(String(e.by).replace(/^Admin \((.*)\)$/, '$1')) : '') + '</small></span><button class="pi-x" data-pidel title="Clear this answer">✕</button></div>';
    if (fold) return '<div class="pi-a pi-folded" data-pia="' + i + '">' + head + '<div class="pi-peek">' + esc(String(r.answer || '').replace(/[#*_`>|-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)) + '</div></div>';
    var h = '<div class="pi-a" data-pia="' + i + '">' + head +
      '<div class="pi-md">' + piMd(r.answer) + '</div>';
    if (r.risks && r.risks.length) {
      var crit = r.risks.filter(function (x) { return x.critical; }).length;
      h += '<div class="pi-act"><h4>⚠ Suggested risks <small class="muted">(' + crit + ' critical, ' + (r.risks.length - crit) + ' non-critical)</small></h4><div class="table-wrap"><table class="pi-tbl"><thead><tr><th></th><th>Risk</th><th>Path</th><th>P</th><th>I</th><th>Score</th><th>Response</th><th>Action</th></tr></thead><tbody>' +
        r.risks.map(function (x, k) { var have = (p.risks || []).some(function (y) { return y.title.toLowerCase() === x.title.toLowerCase(); }); return '<tr><td><input type="checkbox" data-rk="' + k + '"' + (have ? ' disabled title="Already in the register"' : ' checked') + '></td><td><b>' + esc(x.title) + '</b><br><small class="muted">' + esc(x.cause) + '</small></td><td>' + (x.critical ? '<span class="pi-crit">⚡ Critical</span>' : '<span class="muted">Non-critical</span>') + '</td><td>' + x.p + '</td><td>' + x.i + '</td><td><b>' + (x.p * x.i) + '</b></td><td>' + esc(x.response) + '</td><td><small>' + esc(x.action) + '</small></td></tr>'; }).join('') +
        '</tbody></table></div><button class="btn btn-sm btn-gold" data-addrisks>＋ Add ticked risks to the Risk register</button></div>';
    }
    if (r.stakeholders && r.stakeholders.length) {
      h += '<div class="pi-act"><h4>👥 Stakeholder register</h4><div class="table-wrap"><table class="pi-tbl"><thead><tr><th></th><th>Name</th><th>Role</th><th>RACI</th><th>Interest</th><th>Influence</th><th>How to engage</th></tr></thead><tbody>' +
        r.stakeholders.map(function (x, k) { var have = !!x.id || (p.stakeholders || []).some(function (y) { return y.name && y.name.toLowerCase() === x.name.toLowerCase(); }); return '<tr><td><input type="checkbox" data-sk="' + k + '"' + (have ? ' disabled title="Already a stakeholder"' : ' checked') + '></td><td><b>' + esc(x.name) + '</b>' + (have ? ' <small class="muted">(listed)</small>' : '') + '</td><td>' + esc(x.role) + '</td><td><span class="raci raci-' + x.raci + '">' + x.raci + '</span></td><td>' + x.interest + '</td><td>' + x.influence + '</td><td><small>' + esc(x.engagement) + '</small></td></tr>'; }).join('') +
        '</tbody></table></div><button class="btn btn-sm btn-gold" data-addsk>＋ Add ticked to Stakeholders</button></div>';
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
      var ar = box.querySelector('[data-addrisks]'); if (ar) ar.onclick = function () {
        var n = 0; box.querySelectorAll('[data-rk]:checked:not(:disabled)').forEach(function (c) { var x = r.risks[+c.getAttribute('data-rk')]; n++;
          p.risks.push({ id: 'r' + Date.now().toString(36) + n, title: x.title, cause: x.cause + (x.critical ? ' (affects the critical path)' : ''), p: x.p, i: x.i, response: x.response, action: x.action, owner: x.owner || (p.charter || {}).manager || '', review: '', status: 'Open', raised: today() }); });
        if (!n) return toast('Tick the risks to add', true); dirty(); toast(pl(n, 'risk') + ' added to the Risk register'); intelTab(); };
      var as = box.querySelector('[data-addsk]'); if (as) as.onclick = function () {
        var n = 0; p.stakeholders = p.stakeholders || [];
        box.querySelectorAll('[data-sk]:checked:not(:disabled)').forEach(function (c) { var x = r.stakeholders[+c.getAttribute('data-sk')]; n++; p.stakeholders.push({ id: 's' + Date.now().toString(36) + n, name: x.name, role: x.role, raci: x.raci, phone: '', email: '' }); });
        if (!n) return toast('Tick the stakeholders to add', true); dirty(); toast(pl(n, 'stakeholder') + ' added: add their phone and email on the Stakeholders tab'); intelTab(); };
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
    fetch('/.netlify/functions/planai-background', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-MBS-Admin': '1' },
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
    p.tasks.forEach(function (t) { matsOf(t).forEach(function (m) { var b = by[m.item] = by[m.item] || { need: 0, used: 0, tasks: 0 }; b.tasks++; if (t.status === 'done') b.used += Number(m.qty) || 0; else b.need += Number(m.qty) || 0; }); });
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

  M.dateBoxes = dateBoxes; M.dmy = dmy;
  M.addView('projects', 'Projects', projects);
  M.addView('plan', 'Project plan', planView, 'projects');
  window.addEventListener('hashchange', function () { if (!/^#plan\//.test(location.hash)) { S.away = true; document.body.classList.remove('plan-wide'); if (S.timer) saveNow(); } });
  window.MBS.planState = S;   // for tests
})();
