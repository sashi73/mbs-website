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
      if (!Array.isArray(t.res)) t.res = t.resource ? String(t.resource).split(/\s*,\s*/).filter(Boolean) : [];
      fixRes(t);
      if (!stPct.hasOwnProperty(t.status) || (t.status === 'done') !== (t.pct >= 100)) t.status = statusFromPct(t.pct || 0);
      fitSubs(t); derive(t);
    });
    return p;
  }

  /* ---------- state + saving ---------- */
  var S = { split: (function () { try { return +localStorage.getItem('mbsPlanSplit') || 0; } catch (e) { return 0; } })(), closed: {}, cols: (function () { try { return localStorage.getItem('mbsPlanCols') || 's'; } catch (e) { return 's'; } })(), core: '', plan: null, rev: 0, job: null, tab: 'schedule', zoom: 'day', saving: false, timer: null, reminders: [], expensesEx: 0 };
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
      return api('planJobs', {}).then(function (j) {
        var avail = j.jobs;
        V().innerHTML = '<div class="card"><div class="card-h"><h2>Project plans (' + d.plans.length + ')</h2>' +
          '<div class="row"><select id="newPlanJob" style="width:auto"><option value="">Plan a job…</option>' + avail.map(function (x) { return '<option value="' + esc(x.core) + '">' + esc(x.ref + ' · ' + x.name + ': ' + x.title + (x.kind && x.title.toLowerCase().indexOf(x.kind.toLowerCase()) < 0 ? ' (' + x.kind + ')' : '') + (x.suburb ? ' · ' + x.suburb : '')) + '</option>'; }).join('') + '</select><button class="btn btn-gold btn-sm" id="newPlanGo">＋ Start a plan</button></div></div>' +
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
    var p = newPlan({ name: d.name || (job.title || 'Project plan'), objective: d.objective || '', scope: d.inScope ? d.inScope : '', rows: rows, risks: d.risks || [] }, job, start, scope,
      { outScope: d.outScope, deliverables: d.deliverables, acceptance: d.acceptance, assumptions: d.assumptions, notes: (d.tips || []).map(function (x) { return '• ' + x; }).join('\n') });
    var cs = String(scope || '').trim();
    p.charter.inScope = cs && d.inScope ? cs + '\n\nPlanned work (AI): ' + d.inScope : cs || d.inScope || '';
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
    $('#title').textContent = 'Project plan';
    var j = S.job, scope0 = j.scope || '';
    var guess = guessType(j.title + ' ' + scope0);
    S.mode = 'type'; S.aiDraft = null; S.aiId = ''; S.aiText = ''; S.tplType = '';
    V().innerHTML = '<div class="row" style="margin-bottom:14px"><a class="btn btn-sm" href="#job/' + esc(j.core) + '">← ' + esc(j.ref) + '</a><h2 style="font-size:22px">Plan this job: ' + esc(j.name) + ': ' + esc(j.title || j.service || 'Job') + '</h2></div>' +
      '<div class="card"><h2>1. What the customer wants (scope of work)</h2>' +
      '<p class="jobline"><span class="ref">' + esc(j.ref) + '</span> <b>' + esc(j.title || '') + '</b>' + [j.suburb, j.source ? 'from ' + j.source : ''].filter(Boolean).map(function (x) { return ' · ' + esc(x); }).join('') + '</p>' +
      '<p class="muted" style="margin:0 0 8px">The tasks (WBS) and Gantt chart are built from this, so it is needed. It is filled in from the enquiry and notes: check it and add what is missing (what, where, sizes, materials, access, deadline).</p>' +
      '<textarea id="tplScope" rows="5" placeholder="e.g. Bathroom exhaust fan is noisy and has stopped working. Replace it with a quieter fan, duct it outside through the eave, patch and paint the ceiling around it.">' + esc(scope0) + '</textarea></div>' +
      '<div class="card"><h2>2. How do you want to build the plan?</h2><div class="tpl-grid tmodes">' +
      [['type', '📋 Pick a job type', CATALOG.length + ' common job types, each with sub-types. Builds tasks, sub-tasks, example costs and risks.'], ['blank', '⬜ Blank plan', 'Two rows to start from. Add your own tasks.'], ['ai', '✨ Ask AI to build it', 'Describe the job; AI works out the tasks, sub-tasks, costs, scope and risks, plus tips to help you plan.']]
        .map(function (m) { return '<button class="tpl tmode' + (S.mode === m[0] ? ' on' : '') + '" data-mode="' + m[0] + '"><b>' + m[1] + '</b><small>' + m[2] + '</small></button>'; }).join('') + '</div>' +
      '<div id="modeBody" style="margin-top:14px"></div>' +
      '<div class="row" style="margin-top:16px;align-items:flex-end"><label style="display:grid;gap:4px;font-weight:700">Start date<input type="date" id="tplStart" value="' + today() + '" style="width:auto"></label><span class="sp"></span><button class="btn btn-gold" id="tplCreate">Create plan</button></div></div>';
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
          '<div class="row" style="margin-top:8px"><button class="btn btn-gold btn-sm" id="aiGo">✨ Build the plan with AI</button><small class="muted">Usually 20–60 seconds. No names or contact details are sent.</small></div><div id="aiOut"></div>';
        $('#aiDescribe').oninput = function () { S.aiText = this.value; };
        $('#aiGo').onclick = aiRun;
        create.disabled = !S.aiDraft; create.textContent = 'Use this plan';
        if (S.aiDraft) showDraft();
      }
    };
    function showDraft() {
      var out = $('#aiOut'); if (!out) return;
      var p = fromAi(S.aiDraft, j, $('#tplStart').value || today(), $('#tplScope').value);
      out.innerHTML = previewHtml(p, S.aiDraft.tips, S.aiDraft) + '<p class="muted" style="font-size:12.5px;margin:6px 0 0">This is an AI draft: check the tasks, days, prices, scope and risks (all go into the Scope and Risks tabs). People (resources) are left blank. Press <b>Use this plan</b> to create it, or <b>Build the plan with AI</b> again for another version.</p>';
      $('#tplCreate').disabled = false;
    }
    function aiRun() {
      var desc = $('#aiDescribe').value.trim(), scope = $('#tplScope').value.trim();
      if ((desc || scope).length < 10) { toast('Describe the job first (what the customer wants done)', true); ($('#aiDescribe').value ? $('#aiDescribe') : $('#tplScope')).focus(); return; }
      var id = rid(), go = $('#aiGo'), out = $('#aiOut');
      S.aiId = id; S.aiDraft = null; $('#tplCreate').disabled = true; go.disabled = true;
      out.innerHTML = '<p class="ask-think" style="margin:10px 0 0">AI is building the plan… this usually takes 20–60 seconds</p>';
      var t0 = Date.now(), cat = catalogItem($('#tplType') ? $('#tplType').value : S.tplType || '');
      var poll = function () {
        return new Promise(function (res) { setTimeout(res, 2000); }).then(function () { return api('planAiStatus', { id: id }); }).then(function (d) {
          if (S.aiId !== id) return;
          if (d.status === 'done' && d.plan) { S.aiDraft = d.plan; go.disabled = false; showDraft(); if (d.today != null) toast('AI plan ready (' + (d.tokens || 0) + ' tokens)'); return; }
          if (d.status === 'error') throw new Error(d.error || 'The AI plan could not be made');
          if (Date.now() - t0 > 170000) throw new Error('The AI is taking too long. Try again, or pick a job type instead.');
          return poll();
        });
      };
      fetch('/.netlify/functions/planai-background', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-MBS-Admin': '1' },
        body: JSON.stringify({ id: id, core: j.core, describe: desc, scope: scope, type: cat ? cat.cat + ': ' + cat.item.n : '', start: $('#tplStart').value || today() }) })
        .then(function (r) {
          if (r.status === 401 || r.status === 403) throw new Error('Your session has ended. Sign in again.');
          if (r.status !== 202 && !r.ok) throw new Error('Could not start the AI (' + r.status + '). Try again.');
          return poll();
        }).catch(function (e) { if (S.aiId !== id) return; go.disabled = false; var o = $('#aiOut'); if (o) o.innerHTML = '<p class="bad" style="margin:10px 0 0">' + esc(e.message) + '</p>'; });
    }
    V().querySelectorAll('[data-mode]').forEach(function (b) { b.onclick = function () { S.mode = b.getAttribute('data-mode'); mode(); }; });
    $('#tplStart').onchange = function () { if (S.mode === 'type' && $('#tplType') && $('#tplType').value) $('#tplType').onchange(); };
    mode();
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
      var btn = this; btn.disabled = true;
      S.plan = plan; S.rev = 0; S.tab = 'schedule';
      api('planSave', { core: S.core, plan: S.plan, rev: 0, note: note }).then(function (r) { S.plan = normalise(r.plan); S.rev = r.plan.rev; S.aiDraft = null; S.aiText = ''; S.tplType = ''; toast('Plan created'); history.replaceState(null, '', '#plan/' + S.core + '/schedule'); render(); }).catch(function (e) { btn.disabled = false; S.plan = null; fail(e); });
    };
  }

  function render() {
    var p = S.plan, R = rollup(p, today());
    $('#title').textContent = 'Project plan';
    var tabs = [['overview', '◎ Overview'], ['schedule', '▤ Schedule & Gantt'], ['board', '▦ Board'], ['scope', '🎯 Scope'], ['risks', '⚠ Risks'], ['issues', '❗ Issues']];
    V().innerHTML = '<div class="row" style="margin-bottom:12px"><a class="btn btn-sm" href="#job/' + esc(S.core) + '">← ' + esc(S.job.ref) + '</a>' +
      '<h2 style="font-size:21px">' + esc(p.name) + '</h2><span class="muted">' + esc(S.job.name + (S.job.title ? ': ' + S.job.title : '')) + '</span><span class="sp"></span>' +
      '<span class="muted" id="planSave" style="font-size:13px">' + (S.timer || S.busy ? 'Saving…' : 'Saved ✓') + '</span><button class="btn btn-sm" id="planBase" title="Freeze today\'s dates and costs to compare against">📌 ' + (p.baseline ? 'Re-set baseline' : 'Set baseline') + '</button><button class="btn btn-sm" id="planWide" title="Hide the menu and use the whole screen">⛶ ' + (document.body.classList.contains('plan-wide') ? 'Normal view' : 'Wide view') + '</button><button class="btn btn-sm" id="planXls" title="Download the whole plan as an Excel workbook">⬇ Excel</button><button class="btn btn-sm" onclick="window.print()">🖨 Print</button><button class="btn btn-sm btn-danger" id="planDel" title="Delete this plan">🗑 Delete plan</button></div>' +
      '<div class="grid pkpis">' +
        mini('Scope', R.pct + '% complete', R.done + ' of ' + R.total + ' tasks done', rag(R.total ? R.pct / Math.max(1, timePct(R)) : null, 0.95, 0.8)) +
        mini('Time', 'Finish ' + prettyY(R.finish), (R.SPI == null ? 'not started' : 'SPI ' + R.SPI) + (R.late.length ? ' · ' + R.late.length + ' late' : '') + (p.baseline && p.baseline.finish && R.finish ? ' · ' + varDays(p.baseline.finish, R.finish) : ''), R.late.length ? 'red' : rag(R.SPI, 0.95, 0.85)) +
        mini('Cost', money(R.AC) + ' of ' + money(R.BAC), (R.CPI == null ? 'no actual costs yet' : 'CPI ' + R.CPI + ' · forecast ' + money(R.EAC)), rag(R.CPI, 0.95, 0.85)) +
        mini('Risks & issues', pl((p.risks || []).filter(function (r) { return r.status !== 'Closed'; }).length, 'risk') + ' · ' + pl((p.issues || []).filter(function (x) { return x.status !== 'Resolved'; }).length, 'issue'), pl((p.risks || []).filter(function (r) { return r.status !== 'Closed' && r.p * r.i >= 12; }).length, 'high risk'), (p.risks || []).some(function (r) { return r.status !== 'Closed' && r.p * r.i >= 15; }) ? 'red' : (p.issues || []).some(function (x) { return x.status !== 'Resolved' && /High|Critical/.test(x.priority); }) ? 'amber' : 'green') +
      '</div>' +
      '<div class="tabs" id="planTabs">' + tabs.map(function (t) { return '<a class="tab' + (S.tab === t[0] ? ' on' : '') + '" href="#plan/' + esc(S.core) + '/' + t[0] + '" style="text-decoration:none">' + t[1] + '</a>'; }).join('') + '</div><div id="planBody"></div>';
    $('#planWide').onclick = function () { document.body.classList.toggle('plan-wide'); render(); };
    $('#planXls').onclick = function () { exportExcel(); };
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
      '<span class="muted" style="font-size:12.5px">To move a task, type its new number in <b>#</b> (1 = first) or drag <b>⠿</b>. Sub-tasks move inside their own task. Days are working days (Mon–Fri). “After #” = starts when those rows finish. Moving a card on the Board updates the % here.</span><span class="sp"></span>' +
      '<label style="display:flex;gap:6px;align-items:center;font-weight:700">Project start<input type="date" id="pStart" value="' + esc(p.start) + '" style="width:auto"></label>' +
      '<div class="tabs" style="margin:0" title="Which columns to show"><button class="tab' + (S.cols === 's' ? ' on' : '') + '" data-cols="s">📅 Dates</button><button class="tab' + (S.cols === 'c' ? ' on' : '') + '" data-cols="c">$ Costs</button><button class="tab' + (S.cols === 'a' ? ' on' : '') + '" data-cols="a">All columns</button></div>' +
      '<div class="tabs" style="margin:0"><button class="tab' + (S.zoom === 'day' ? ' on' : '') + '" data-zoom="day">Days</button><button class="tab' + (S.zoom === 'week' ? ' on' : '') + '" data-zoom="week">Weeks</button></div></div>' +
      '<div class="gsplit" id="gSplit"><div class="gpane gleft" id="gLeft"' + (S.split ? ' style="flex:0 0 ' + S.split + 'px;max-width:none"' : '') + '><table class="gt v-' + S.cols + '"><thead><tr><th>#</th><th title="Done">✓</th><th style="min-width:160px">Task</th><th style="min-width:136px">Resources <span class="muted" style="text-transform:none;letter-spacing:0">(★ lead)</span></th><th>Days</th><th>Start</th><th>Finish</th><th>After #</th><th>Qty</th><th>Unit</th><th>Unit $</th><th>Cost</th><th>Actual $</th><th>Status</th><th>%</th><th></th></tr></thead><tbody>';
    var G = '';   // rows of the Gantt pane (kept the same height as the grid rows)
    rows.forEach(function (r) {
      var t = r.t, late = t.pct < 100 && t.ef < t0, base = p.baseline && p.baseline.tasks ? p.baseline.tasks[t.id] : null;
      var subs = t.subs || [], open = subs.length && !S.closed[t.id];
      html += '<tr data-tid="' + esc(t.id) + '" class="' + (t.pct >= 100 ? 'tdone' : '') + (late ? ' tlate' : '') + (t.dur === 0 ? ' tmile' : '') + (subs.length ? ' tparent' : '') + '"><td class="muted nowrap">' + '<span class="grip" data-grip title="Drag up or down to move this task">⠿</span>' + (subs.length ? '<button class="subtog" type="button" data-tog title="' + (open ? 'Hide' : 'Show') + ' sub-tasks">' + (open ? '▾' : '▸') + '</button>' : '') + '<input class="posin" data-pos inputmode="numeric" value="' + r.n + '" title="Type a number to move this task there (1 = first)"></td>' +
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
          '<td><input data-sk="start" type="date" value="' + esc(d.es) + '" min="' + esc(t.es) + '" max="' + esc(t.ef) + '" title="Between ' + esc(pretty(t.es)) + ' and ' + esc(pretty(t.ef)) + ' (the task\'s dates)"></td>' +
          '<td class="nowrap">' + esc(pretty(d.ef)) + '</td><td class="muted" style="font-size:11.5px">in #' + r.n + '</td><td></td><td></td><td></td>' +
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
    splitPanes(x(t0));
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
      ['Time: planned finish', D(R.finish), (R.SPI == null ? 'not started' : 'SPI ' + R.SPI) + (R.late.length ? ' · ' + R.late.length + ' late task' + (R.late.length === 1 ? '' : 's') : ''), R.late.length ? 'red' : rag(R.SPI, 0.95, 0.85), dateF],
      ['Cost: spent so far (actual)', R.AC, 'of ' + money(R.BAC) + ' budget' + (R.CPI == null ? '' : ' · CPI ' + R.CPI + ' · forecast ' + money(R.EAC)), rag(R.CPI, 0.95, 0.85), money$],
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
    var cols = ['#', 'Task / sub-task', 'People (lead first)', 'Lead', 'Days', 'Start', 'Finish', 'After #', 'Qty', 'Unit', 'Unit $', 'Cost', 'Actual $', 'Status', '% complete', 'Late', 'Stock item'];
    sc.columns = [6, 40, 28, 14, 7, 13, 13, 9, 8, 8, 11, 13, 12, 15, 11, 7, 26].map(function (w) { return { width: w }; });
    titleBlock(sc, 'Schedule', cols.length);
    header(sc, 4, cols);
    var row = 5, first = 5;
    p.tasks.forEach(function (t, i) {
      var late = t.pct < 100 && t.ef && t.ef < t0, it = invItem(t.item);
      var r = sc.getRow(row);
      r.values = [i + 1, (t.dur === 0 ? '◆ ' : '') + t.name, resText(t), t.lead || '', t.dur, D(t.es), D(t.ef), (t.pred || []).map(function (id) { return num[id]; }).filter(Boolean).join(', '),
        Number(t.qty) || 0, t.unit || '', Number(t.rate) || 0, { formula: 'I' + row + '*K' + row, result: cost(t) }, Number(t.actual) || 0, stName[t.status], (t.pct || 0) / 100, late ? 'Yes' : '', it ? it.name : (t.item || '')];
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
        (t.subs || []).forEach(function (sb) { lines.push((sb.status === 'done' ? '☑ ' : '☐ ') + sb.name + (sb.owner ? ' (' + sb.owner + ')' : '')); });
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

    /* 8. Materials from stock (only when tasks use stock items) */
    var by = {};
    p.tasks.forEach(function (t) { if (!t.item) return; var b = by[t.item] = by[t.item] || { need: 0, used: 0, tasks: [] }; if (t.status === 'done') b.used += Number(t.qty) || 0; else b.need += Number(t.qty) || 0; b.tasks.push(t.name); });
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
    sync();
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
  window.addEventListener('hashchange', function () { if (!/^#plan\//.test(location.hash)) { document.body.classList.remove('plan-wide'); if (S.timer) saveNow(); } });
  window.MBS.planState = S;   // for tests
})();
