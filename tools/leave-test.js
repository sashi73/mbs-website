// v108: Leave. Staff ask for leave from their own login (My leave); managers approve or decline in People > Leave, with
// balances and clash warnings; approved leave lands in the timesheet and the pay run pays it; calendar; balances; rules.
// node leave-test.js <site>
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const SITE = path.resolve(process.argv[2]);
const PORT = 8994, BASE = `http://127.0.0.1:${PORT}`;
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => results.push({ area, name, pass: !!pass, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-lv-blobs'); fs.rmSync(dir, { recursive: true, force: true });
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
    br = await chromium.launch();
    const errors = []; errorsAll = errors;
    const mk = async () => { const c = await br.newContext({ viewport: { width: 1440, height: 900 } }); const pg = await c.newPage(); pg.setDefaultTimeout(15000); pg.on('pageerror', (e) => errors.push(e.message)); return pg; };
    const a = await mk(), api = (pg, x, b) => pg.evaluate(([x, b]) => window.MBS.api(x, b).then((r) => r, (e) => ({ error: e.message })), [x, b || {}]);
    const signIn = async (pg, u, pw) => { await pg.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' }); await pg.fill('#loginForm [name=username]', u); await pg.fill('#loginForm [name=password]', pw); await pg.click('#loginForm button[type=submit]'); };
    await signIn(a, 'sashi73', 'sashi98'); await a.waitForSelector('#app:not([hidden])');
    const jack = (await api(a, 'pplSave', { person: { type: 'Employee', name: 'Jack Carpenter', role: 'Tradesperson', email: 'jack@example.com', employment: 'Full-time', status: 'Active' } })).person;
    const mia = (await api(a, 'pplSave', { person: { type: 'Employee', name: 'Mia Painter', role: 'Tradesperson', email: 'mia@example.com', employment: 'Full-time', status: 'Active' } })).person;
    const lily = (await api(a, 'pplSave', { person: { type: 'Employee', name: 'Lily Labourer', role: 'Labourer', employment: 'Casual', status: 'Active' } })).person;
    await api(a, 'prlProfileSave', { profile: { pid: jack.id, employment: 'Full-time', classification: 'CW3', tool: 'carpenter', balances: { annual: 76, personal: 30, rdo: 0 } } });
    await api(a, 'prlProfileSave', { profile: { pid: mia.id, employment: 'Full-time', classification: 'CW3', balances: { annual: 10, personal: 10, rdo: 0 } } });
    await api(a, 'prlProfileSave', { profile: { pid: lily.id, employment: 'Casual', classification: 'CW1a' } });
    // Jack gets a login (read only) and asks for leave himself
    const u = await api(a, 'userSave', { user: { personId: jack.id, username: 'jack@example.com', role: 'Read only' } });
    const j = await mk(); await signIn(j, 'jack@example.com', u.temp); await j.waitForSelector('#pwF');
    await j.fill('#pwF [name=old]', u.temp); await j.fill('#pwF [name=pw]', 'BuildIt2026now'); await j.fill('#pwF [name=pw2]', 'BuildIt2026now'); await j.click('#pwF [type=submit]');
    await j.waitForLoadState('load'); await j.waitForSelector('#app:not([hidden])'); await sleep(800);
    ok('My leave', 'staff see "My leave" in the menu (a read-only login too)', await j.isVisible('[data-nav="myleave"]'));
    ok('My leave', 'but not the managers\' Leave or Payroll pages', !(await j.isVisible('[data-nav="leave"]')) && !(await j.isVisible('[data-nav="payroll"]')));
    await j.click('[data-nav="myleave"]'); await j.waitForSelector('#lvSend');
    ok('My leave', 'they see their balances (annual 76 h = 10 days)', /76 h/.test(await j.textContent('#view')) && /10 d/.test(await j.textContent('#view')));
    // Mon 30 Nov – Fri 4 Dec 2026 (5 working days)
    await j.selectOption('#lvType', 'annual'); await j.fill('#lvFrom', '2026-11-30'); await j.fill('#lvTo', '2026-12-04'); await j.fill('#lvWhy', 'Family holiday');
    ok('My leave', 'each kind of leave says what it gives', /4 weeks a year/.test(await j.textContent('#lvHint')));
    await j.click('#lvSend'); await j.waitForFunction(() => /LV-0001/.test(document.querySelector('#view').textContent));
    ok('My leave', 'the request is sent and shows as waiting, 38 h (5 working days)', /Waiting/.test(await j.textContent('#view')) && /38 h/.test(await j.textContent('#view')));
    let r = await api(j, 'lvRequest', { type: 'annual', from: '2026-12-26', to: '2026-12-27' });
    ok('Rules', 'weekends and public holidays aren\'t counted (Boxing Day Sat + Sunday = nothing to take)', /only weekends or public holidays/.test(r.error || ''), r);
    r = await api(j, 'lvRequest', { type: 'annual', from: '2026-12-24', to: '2026-12-29' });
    ok('Rules', 'leave over Christmas skips the public holidays (Thu 24, Tue 29 = 2 days, 15.2 h)', r.request && r.request.days.length === 2 && r.request.hours === 15.2, r.request && r.request.days);
    await api(j, 'lvCancel', { id: r.request.id });
    r = await api(j, 'lvList');
    ok('Access', 'staff can\'t see everyone\'s leave', !!r.error);
    r = await api(j, 'lvRequest', { pid: mia.id, type: 'annual', from: '2026-12-07', to: '2026-12-07' });
    ok('Access', 'and can only ask for their own (asking for Mia makes it Jack\'s)', r.request && r.request.pid === jack.id);
    await api(j, 'lvCancel', { id: r.request.id });
    // Mia (no login) – the manager enters a clashing request, then a casual's annual leave is refused
    r = await api(a, 'lvRequest', {});
    ok('My leave', 'the Owner login (not a person) is told it isn\'t linked', /not linked/.test(r.error || ''));
    r = await api(a, 'lvSave', { pid: lily.id, type: 'annual', from: '2026-12-01', to: '2026-12-01' });
    ok('Rules', 'casuals can\'t take paid annual leave (they get the 25% loading)', /Casuals don/.test(r.error || ''));
    r = await api(a, 'lvSave', { pid: lily.id, type: 'fdv', from: '2026-12-01', to: '2026-12-01', approve: false });
    ok('Rules', 'family and domestic violence leave is open to casuals too', r.request && r.request.status === 'pending');
    await api(a, 'lvDecide', { id: r.request.id, decision: 'declined' });
    await api(a, 'lvSave', { pid: mia.id, type: 'annual', from: '2026-12-02', to: '2026-12-03', approve: false });
    // the manager's page
    await a.goto(`${BASE}/admin/#leave`, { waitUntil: 'networkidle' }); await a.waitForSelector('.lv-req');
    ok('Manager', 'People > Leave shows a waiting count in the menu', (await a.textContent('[data-nav="leave"] .lv-badge')) === '2');
    const req = await a.textContent('.lv-req');
    ok('Manager', 'each request shows the balance before and after, the reason and who else is away', /Jack Carpenter/.test(req) && /76 h → 38 h after this/.test(req) && /Family holiday/.test(req) && /Also away: Mia Painter/.test(req), req);
    await a.screenshot({ path: path.join(os.tmpdir(), 'lv-requests.png'), fullPage: true });
    await a.fill('.lv-note[data-note="LV-0001"]', 'Enjoy!');
    await a.click('[data-dec="LV-0001"][data-d="approved"]'); await a.waitForFunction(() => document.querySelectorAll('.lv-req').length === 1);
    const ts = (await api(a, 'prlTimesheet', { pid: jack.id, week: '2026-11-30' })).timesheet;
    ok('Payroll', 'approving writes the leave into the timesheet for each working day', ['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04'].every((d) => ts.days[d] && ts.days[d].leave === 'annual' && ts.days[d].leaveHours === 7.6), ts.days);
    // the pay run pays it
    await api(a, 'prlTimesheetSave', { timesheet: { ...ts, status: 'approved' } });
    const run = (await api(a, 'prlRunCreate', { from: '2026-11-30' })).run, jl = run.lines.find((l) => l.pid === jack.id);
    ok('Payroll', 'the pay run pays 38 h of annual leave with the 17.5% loading', jl && jl.lines.find((l) => l.label === 'Annual leave').hours === 38 && jl.lines.some((l) => /loading/.test(l.label)), jl && jl.lines);
    await api(a, 'prlRunFinalise', { id: run.id });
    const bal = await api(j, 'lvMine');
    ok('Payroll', 'and the balance goes down once it is paid (76 − 38 + accrued)', bal.balance.balances.annual < 41 && bal.balance.balances.annual > 38, bal.balance);
    r = await api(a, 'lvDecide', { id: 'LV-0001', decision: 'cancelled' });
    ok('Payroll', 'cancelling leave in a week already paid leaves that week alone (and says so)', r.request.status === 'cancelled' && r.skipped.length === 5);
    // decline Mia; calendar; balances
    await a.reload(); await a.waitForSelector('.lv-req');
    await a.click('.lv-req [data-d="declined"]'); await a.waitForFunction(() => /Nothing waiting/.test(document.querySelector('#view').textContent));
    ok('Manager', 'decline works and the waiting list empties', true);
    await api(a, 'lvSave', { pid: mia.id, type: 'personal', from: '2026-11-17', to: '2026-11-17' });
    await api(a, 'lvSave', { pid: jack.id, type: 'rdo', from: '2026-11-17', to: '2026-11-17' });
    await a.click('.tab[href="#leave/cal"]'); await a.waitForSelector('.lv-cal');
    for (let i = 0; i < 3 && !/November 2026/.test(await a.textContent('#lvBody')); i++) { await a.click(/December/.test(await a.textContent('#lvBody')) ? '#calPrev' : '#calNext'); await sleep(250); }
    const t17 = (await api(a, 'prlTimesheet', { pid: jack.id, week: '2026-11-16' })).timesheet.days['2026-11-17'];
    ok('Manager', 'leave a manager enters is approved and goes straight into the timesheet', t17 && t17.leave === 'rdo' && t17.leaveHours === 7.6, t17);
    const busy = await a.$$eval('.lv-day.lv-busy', (x) => x.map((e) => e.textContent));
    ok('Calendar', 'the calendar shows who is away, and marks days with more than one person off', busy.some((t) => /17/.test(t) && /Mia/.test(t) && /Jack/.test(t)), busy);
    await a.screenshot({ path: path.join(os.tmpdir(), 'lv-calendar.png') });
    await a.click('.tab[href="#leave/bal"]'); await a.waitForSelector('#lvBody table');
    ok('Balances', 'everyone\'s balances in one table', /Jack Carpenter/.test(await a.textContent('#lvBody')) && /Mia Painter/.test(await a.textContent('#lvBody')));
    await a.click('.tab[href="#leave/nes"]'); await a.waitForFunction(() => /Leave types/.test(document.querySelector('#lvBody').textContent));
    ok('Rules', 'the leave types table (NES): family and domestic violence 10 days paid, long service via the NSW scheme', /10 days paid each year/.test(await a.textContent('#lvBody')) && /portable long service/.test(await a.textContent('#lvBody')));
    // FDV is private
    const fd = await api(a, 'lvSave', { pid: mia.id, type: 'fdv', from: '2026-11-24', to: '2026-11-24' });
    const t24 = (await api(a, 'prlTimesheet', { pid: mia.id, week: '2026-11-23' }));
    const pl = t24.preview.lines.map((l) => l.label).join('|');
    ok('Privacy', 'family and domestic violence leave is paid but the payslip shows it as ordinary hours, never by name', /Ordinary hours/.test(pl) && !/violence|fdv|confidential/i.test(pl), pl);
    const mm = await api(j, 'lvMine');
    ok('My leave', 'Jack sees his own history (approved, then cancelled)', mm.requests.some((x) => x.id === 'LV-0001' && x.status === 'cancelled'));
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close(); br = null;
  } catch (e) { try { if (br) await br.close(); } catch {} ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ') + ' LOG: ' + log.slice(-600)); }
  try { srv.kill(); } catch {} try { await blobs.stop(); } catch {}
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(0);
})();
