// v107: People > Payroll. Worked examples (award rates, overtime, weekends, RDO, leave and loading, casuals, ATO tax and HELP),
// then the console: pay profiles, timesheets, a pay run, payslip PDF, CSV for the payroll service, labour cost per job, TPAR.
// node payroll-test.js <site>
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const SITE = path.resolve(process.argv[2]);
const PORT = 8993, BASE = `http://127.0.0.1:${PORT}`;
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => results.push({ area, name, pass: !!pass, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const near = (a, b, e = 0.011) => Math.abs(a - b) <= e;

(async () => {
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-prl-blobs'); fs.rmSync(dir, { recursive: true, force: true });
  const blobs = new BlobsServer({ directory: dir, token: 'tok', port: 0 });
  const { port: bport } = await blobs.start();
  const ctxB64 = Buffer.from(JSON.stringify({ siteID: 'mbs', token: 'tok', edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, apiURL: `http://localhost:${bport}` })).toString('base64');
  process.env.NETLIFY_BLOBS_CONTEXT = ctxB64;
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NETLIFY_BLOBS_CONTEXT: ctxB64, ADMIN_USERNAME: 'sashi73', ADMIN_PASSWORD: 'sashi98', SITE_ENV: 'test', LLM_API_KEY: '', TELEGRAM_BOT_TOKEN: '', RESEND_API_KEY: '' };
  const srv = spawn('node', ['local-server.mjs'], { cwd: SITE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 40 && !/running/.test(log); i++) await sleep(150);
  let br = null;
  try {
    const P = await import(path.join(SITE, 'netlify/lib/payroll.mjs')), S = P.DEFAULTS;
    // ---- rates ----
    ok('Rates', '2026-27 award rates: 2025 rates + 4.75%, e.g. CW1 (a) $1,013.50 and CW3 $1,119.10 a week', S.classes[0].weekly === 1013.5 && S.classes.find((c) => c.key === 'CW3').weekly === 1119.1, S.classes.map((c) => c.weekly));
    const cw1 = { classification: 'CW1a', tool: '', hourly: 0, employment: 'Full-time', residency: 'resident', tft: true, balances: { annual: 0, personal: 0, rdo: 0 } };
    ok('Rates', 'hourly rate = (weekly + industry allowance + tool allowance) ÷ 38: CW1 $28.44 (the published 2026-27 figure)', P.baseRate(cw1, S).rate === 28.44, P.baseRate(cw1, S));
    const carp = { ...cw1, classification: 'CW3', tool: 'carpenter' };
    const R = P.baseRate(carp, S).rate;
    ok('Rates', 'a carpenter (CW3 + tool allowance): $32.26 an hour', R === 32.26, R);
    ok('Rates', 'an agreed above-award rate is used when it is higher', P.baseRate({ ...carp, hourly: 40 }, S).rate === 40 && P.baseRate({ ...carp, hourly: 20 }, S).rate === 32.26);
    // ---- a full-time week ----
    const wk = { week: '2026-11-02', days: { '2026-11-02': { hours: 8, job: 'J1' }, '2026-11-03': { hours: 10, job: 'J1' }, '2026-11-04': { hours: 8, job: 'J2' }, '2026-11-05': { hours: 8, job: 'J2' }, '2026-11-06': { hours: 0, leave: 'annual', leaveHours: 7.6 }, '2026-11-07': { hours: 4, job: 'J1' } } };
    const c = P.calcPerson([wk], carp, S), L = (lab) => c.lines.find((l) => l.label.startsWith(lab)) || { hours: 0, amount: 0 };
    ok('Award', 'RDO system: each 8-hour day pays 7.6 hours and banks 0.4 hours (4 days → 30.4 paid, 1.6 banked)', L('Ordinary').hours === 30.4 && c.accrued.rdo === 1.6, [L('Ordinary'), c.accrued]);
    ok('Award', 'overtime after 8 hours on a weekday: first 2 hours at 150%', L('Overtime (first').hours === 2 && L('Overtime (first').rate === r2(R * 1.5));
    ok('Award', 'meal allowance after 1.5 hours of overtime ($19.74)', L('Meal').amount === 19.74);
    ok('Award', 'Saturday: 2 hours at 150%, then 200%', L('Saturday (first').hours === 2 && L('Saturday (after').hours === 2 && L('Saturday (after').rate === r2(R * 2));
    ok('Award', 'fares and travel allowance for each day on site (5 × $22.41)', L('Fares').amount === r2(5 * 22.41));
    ok('Award', 'annual leave paid at the ordinary rate plus 17.5% loading', L('Annual leave').hours === 7.6 && near(L('Annual leave loading').amount, 7.6 * R * 0.175));
    ok('Award', 'super (12%) is on ordinary time earnings only: not on overtime, Saturday, fares or meals', near(c.ote, L('Ordinary').amount + L('Annual leave').amount + L('Annual leave loading').amount) && near(c.super, c.ote * 0.12));
    ok('Award', 'leave accrues on ordinary hours paid (4 weeks a year, 10 days personal)', near(c.accrued.annual, (30.4 + 7.6) * 152 / 1976, 0.02) && near(c.accrued.personal, (30.4 + 7.6) * 76 / 1976, 0.02), c.accrued);
    ok('Award', 'labour cost per job adds up to the wages for hours worked', near((c.perJob.J1 || 0) + (c.perJob.J2 || 0), c.gross - L('Annual leave').amount - L('Annual leave loading').amount), c.perJob);
    const sun = P.calcPerson([{ week: '2026-11-02', days: { '2026-11-08': { hours: 5 } } }], carp, S);
    ok('Award', 'Sunday at 200%', sun.lines[0].label === 'Sunday' && sun.lines[0].rate === r2(R * 2));
    const ph = P.calcPerson([{ week: '2026-12-21', days: { '2026-12-25': { hours: 6 } } }], carp, S);
    ok('Award', 'a public holiday worked at 250% (Christmas Day)', ph.lines.find((l) => l.label === 'Public holiday worked').rate === r2(R * 2.5));
    const phOff = P.calcPerson([{ week: '2026-12-21', days: { '2026-12-22': { hours: 8 } } }], carp, S);
    ok('Award', 'a public holiday not worked is paid (7.6 hours) for full-time staff', !!phOff.lines.find((l) => l.label === 'Public holiday (not worked)' && l.hours === 7.6));
    const cas = P.calcPerson([{ week: '2026-11-02', days: { '2026-11-02': { hours: 9 } } }], { ...carp, employment: 'Casual' }, S);
    ok('Award', 'casuals: 25% loading on ordinary hours, overtime after 7.6 hours at 175%, no leave or RDO', cas.lines[0].rate === r2(R * 1.25) && cas.lines[0].hours === 7.6 && cas.lines.find((l) => l.label.startsWith('Overtime (first')).rate === r2(R * 1.75) && cas.accrued.annual === 0 && cas.accrued.rdo === 0);
    // ---- tax ----
    const tft = { tft: true, residency: 'resident' };
    ok('Tax', 'ATO 2026-27 formulas: $361 a week with the tax-free threshold: no tax', P.withholding(361, tft).tax === 0);
    ok('Tax', '$1,500 a week with the threshold: $299 (0.32 × 1500.99 − 181.7319)', P.withholding(1500, tft).tax === Math.round(0.32 * 1500.99 - 181.7319));
    ok('Tax', 'without the threshold, scale 1: $1,500 → $409', P.withholding(1500, { tft: false, residency: 'resident' }).tax === Math.round(0.32 * 1500.99 - 71.6508));
    ok('Tax', 'HELP/STSL: $1,500 a week with the threshold → $25', P.withholding(1500, { ...tft, stsl: true }).stsl === Math.round(0.15 * 1500.99 - 200.5615));
    ok('Tax', 'fortnightly: worked on half the pay, rounded, then doubled', P.withholding(3000, tft, 2).tax === 2 * Math.round(0.32 * 1500.99 - 181.7319));
    ok('Tax', 'no TFN: 47%', P.withholding(1000, { noTfn: true, residency: 'resident' }).tax === 470);
    ok('Tax', 'foreign resident: scale 3', P.withholding(1000, { tft: false, residency: 'foreign' }).scale === 3 && P.withholding(1000, { tft: false, residency: 'foreign' }).tax === Math.round(0.30 * 1000.99 - 0.30));

    // ---- the console ----
    br = await chromium.launch();
    const ctx = await br.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true }); const a = await ctx.newPage(); a.setDefaultTimeout(15000);
    const errors = []; errorsAll = errors; a.on('pageerror', (e) => errors.push(e.message));
    await a.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
    await a.fill('#loginForm [name=username]', 'sashi73'); await a.fill('#loginForm [name=password]', 'sashi98'); await a.click('#loginForm button[type=submit]'); await a.waitForSelector('#app:not([hidden])');
    const api = (x, b) => a.evaluate(([x, b]) => window.MBS.api(x, b).then((r) => r, (e) => ({ error: e.message })), [x, b || {}]);
    const e1 = (await api('pplSave', { person: { type: 'Employee', name: 'Jack Carpenter', role: 'Tradesperson', trade: 'carpenter', employment: 'Full-time', status: 'Active' } })).person;
    const e2 = (await api('pplSave', { person: { type: 'Employee', name: 'Lily Labourer', role: 'Labourer', employment: 'Casual', status: 'Active' } })).person;
    await api('pplSave', { person: { type: 'Contractor', name: 'Sam Sparky', business: 'Sparky Electrical', abn: '12 345 678 901', status: 'Active' } });
    await api('subSave', { sub: { business: 'Ace Plumbing', trade: 'plumber', abn: '98 765 432 109' } });
    await api('expSave', { fields: { date: '2026-08-10', supplier: 'Ace Plumbing', desc: 'Rough-in', category: 'Subcontractors', inc: 2200 } });
    await api('expSave', { fields: { date: '2026-09-01', supplier: 'Sparky Electrical', desc: 'Switchboard', category: 'Materials', inc: 1100 } });
    await api('expSave', { fields: { date: '2026-09-05', supplier: 'Mystery Tiler', desc: 'Tiling', category: 'Subcontractors', inc: 550 } });
    await api('expSave', { fields: { date: '2026-09-05', supplier: 'Bunnings', desc: 'Screws', category: 'Materials', inc: 80 } });
    ok('Console', 'Payroll sits under People', await a.isVisible('[data-nav="payroll"]'));
    await a.click('[data-nav="payroll"]'); await a.waitForSelector('#prlBody');
    ok('Console', 'until the rates are checked, a banner asks to compare them with the Fair Work pay guide', /Check the rates before the first pay run/.test(await a.textContent('#view')));
    // pay profile
    await a.click('.tab[href="#payroll/people"]'); await a.waitForSelector('[data-pp]');
    ok('Profiles', 'employees are listed (contractors are not: they invoice)', /Jack Carpenter/.test(await a.textContent('#prlBody')) && !/Sam Sparky/.test(await a.textContent('#prlBody')));
    let r = await api('prlProfileSave', { profile: { pid: e1.id, employment: 'Full-time', classification: 'CW3', tool: 'carpenter', tft: true, stsl: true, balances: { annual: 40, personal: 20, rdo: 0 } } });
    ok('Profiles', 'a pay profile saves (classification, tool allowance, tax-free threshold, HELP, leave balances)', r.profile && r.profile.tool === 'carpenter' && r.profile.balances.annual === 40);
    r = await api('prlProfileSave', { profile: { pid: e2.id, employment: 'Casual', classification: 'CW1a' } });
    // timesheets through the screen
    const week = '2026-11-02';
    await a.click('.tab[href="#payroll/ts"]'); await a.waitForSelector('#tsPrev');
    for (let i = 0; i < 8 && !(await a.textContent('#prlBody')).includes('2 Nov'); i++) { const cur = await a.textContent('#prlBody'); await a.click(/Week of .*Nov|Week of .*Dec/.test(cur) && !cur.includes('Oct') ? '#tsPrev' : '#tsNext'); await sleep(200); }
    await a.click(`[data-ts="${e1.id}"]`); await a.waitForSelector('#tsSave');
    const fillDay = async (d, h, job) => { const tr = `#tsEdit tr[data-d="${d}"]`; await a.fill(tr + ' [name=hours]', String(h)); if (job) await a.fill(tr + ' [name=job]', job); };
    await fillDay('2026-11-02', 8, 'MBS-101'); await fillDay('2026-11-03', 10, 'MBS-101'); await fillDay('2026-11-04', 8, 'MBS-102'); await fillDay('2026-11-05', 8, 'MBS-102'); await fillDay('2026-11-07', 4, 'MBS-101');
    await a.selectOption('#tsEdit tr[data-d="2026-11-06"] [name=leave]', 'annual'); await a.fill('#tsEdit tr[data-d="2026-11-06"] [name=leaveHours]', '7.6');
    await a.click('#tsApprove'); await a.waitForFunction(() => /Approved/.test(document.querySelector('#prlBody').textContent) && document.querySelector('#tsPrev2 table'));
    const pv = await a.textContent('#tsPrev2');
    ok('Timesheets', 'entering a week shows the pay straight away (ordinary, overtime, Saturday, leave + loading, allowances, tax, HELP, super)', /Overtime \(first 2 hours\)/.test(pv) && /Saturday/.test(pv) && /Annual leave loading/.test(pv) && /HELP/.test(pv) && /Super \(12%/.test(pv), pv.slice(0, 300));
    await a.screenshot({ path: path.join(os.tmpdir(), 'prl-timesheet.png'), fullPage: true });
    await api('prlTimesheetSave', { timesheet: { pid: e2.id, week, status: 'draft', days: { '2026-11-02': { hours: 7.6, job: 'MBS-101' } } } });
    // pay run
    await a.click('.tab[href="#payroll/runs"]'); await a.waitForSelector('#runNew');
    await a.fill('#runFrom', week); await a.click('#runNew'); await a.waitForSelector('#runFin');
    const rt = await a.textContent('#prlBody');
    ok('Pay run', 'a draft pay run takes approved timesheets only (a draft timesheet is left out and named)', /Jack Carpenter/.test(rt) && /Lily Labourer \(timesheet not approved\)/.test(rt));
    const runId = (rt.match(/PR-\d{4}/) || [])[0];
    const run = (await api('prlRunGet', { id: runId })).run, jl = run.lines[0];
    ok('Pay run', 'its figures match the worked example (gross, tax, HELP, net, super)', near(jl.gross, c.gross) && jl.tax === P.withholding(c.gross, { tft: true, residency: 'resident' }).tax && jl.stsl === P.withholding(c.gross, { tft: true, residency: 'resident', stsl: true }).stsl && near(jl.net, jl.gross - jl.tax - jl.stsl) && near(jl.super, c.super), jl);
    const pdf = await a.evaluate((u) => fetch(u, { credentials: 'same-origin' }).then(async (r) => ({ s: r.status, t: r.headers.get('content-type'), n: (await r.arrayBuffer()).byteLength })), `/.netlify/functions/admin?action=payslipPdf&run=${runId}&pid=${e1.id}`);
    ok('Payslip', 'a payslip PDF for each person', pdf.s === 200 && pdf.t === 'application/pdf' && pdf.n > 4000, pdf);
    const PS = await import(path.join(SITE, 'netlify/lib/payslip-pdf.mjs')), PDFLib = await import(require.resolve('pdf-lib', { paths: [SITE] }));
    const pbuf = await PS.payslipPdf(run, jl); fs.writeFileSync(path.join(os.tmpdir(), 'payslip.pdf'), pbuf);
    ok('Payslip', 'one A4 page titled with the run and the employee', (await PDFLib.PDFDocument.load(pbuf)).getTitle() === `Payslip ${runId} Jack Carpenter`);
    ok('Payslip', 'not for anyone without a login', (await fetch(`${BASE}/.netlify/functions/admin?action=payslipPdf&run=${runId}&pid=${e1.id}`)).status === 401);
    const [dl] = await Promise.all([a.waitForEvent('download'), a.click('#runCsv')]);
    const csv = fs.readFileSync(await dl.path(), 'utf8');
    ok('Export', 'CSV for the payroll service: a row per pay line and a total row with PAYG, HELP, super and net', /Pay item,Hours,Rate,Amount/.test(csv) && /Overtime \(first 2 hours\)/.test(csv) && new RegExp('TOTAL,,,' + jl.gross.toFixed(2)).test(csv) && csv.includes(jl.net.toFixed(2)));
    await a.screenshot({ path: path.join(os.tmpdir(), 'prl-run.png'), fullPage: true });
    await a.click('#runFin'); await a.click('#okBtn'); await a.waitForSelector('.chip.prl-paid');
    const prof = (await api('prlPeople')).people.find((p) => p.pid === e1.id);
    ok('Pay run', 'finalising updates the leave balances (40 + accrued − 7.6 taken)', near(prof.balances.annual, 40 + c.accrued.annual - 7.6) && near(prof.balances.rdo, 1.6), prof.balances);
    r = await api('prlTimesheetSave', { timesheet: { pid: e1.id, week, status: 'draft', days: {} } });
    ok('Pay run', 'a paid week is locked', /already paid/.test(r.error || ''));
    r = await api('prlRunCreate', { from: week });
    ok('Pay run', 'no second pay run for the same period', /already a pay run/.test(r.error || ''));
    // labour cost per job
    const jc = (await api('prlJobCosts', { from: '2026-11-01', to: '2026-11-30' })).jobs;
    const j101 = jc.find((j) => j.job === 'MBS-101');
    ok('Job cost', 'labour cost per job: hours, wages, super and on-costs (MBS-101: 22 hours)', j101 && j101.hours === 22 && near(j101.total, j101.wages + j101.super + j101.oncost) && j101.people.includes('Jack Carpenter'), jc);
    // TPAR
    const tp = await api('prlTpar', { fy: 2026 });
    const names = tp.rows.map((x) => x.name);
    ok('TPAR', 'contractor payments for the year: sub-contractors and People contractors, with ABNs', names.includes('Ace Plumbing') && names.includes('Sparky Electrical') && tp.rows.find((x) => x.name === 'Ace Plumbing').abn === '98 765 432 109' && tp.rows.find((x) => x.name === 'Ace Plumbing').gross === 2200, tp.rows);
    ok('TPAR', 'subcontractor expenses from someone not on file are flagged (no ABN); materials from shops are not included', names.includes('Mystery Tiler') && tp.missingAbn === 1 && !names.includes('Bunnings') && tp.due === '2027-08-28', tp);
    // rates & rules
    await a.click('.tab[href="#payroll/rates"]'); await a.waitForSelector('#s_save');
    await a.check('#s_checked'); await a.click('#s_save'); await a.waitForFunction(() => !/Check the rates before/.test(document.querySelector('#view').textContent));
    ok('Rates', 'ticking "Checked" removes the banner', (await api('prlSettings')).settings.checked === true);
    // access: a role with People view only can't see pay
    const U = await import(path.join(SITE, 'netlify/lib/users.mjs'));
    const nd = ['prlPeople', 'prlRuns', 'prlRunGet', 'prlTimesheet'].map((x) => U.need(x));
    ok('Access', 'every payroll action needs edit access to People: someone with only view access can\'t see anyone\'s pay', nd.every((x) => x.mod === 'people' && x.level === 'edit'), nd);
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close(); br = null;
  } catch (e) { try { if (br) await br.close(); } catch {} ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ') + ' LOG: ' + log.slice(-600)); }
  try { srv.kill(); } catch {} try { await blobs.stop(); } catch {}
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(0);
})();
function r2(n) { return Math.round(n * 100) / 100; }
