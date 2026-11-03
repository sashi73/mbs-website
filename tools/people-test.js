// v86: 🧑‍🔧 People: employees and contractors. The register (add / edit, employee vs contractor fields), tickets and licences with
// expiry checks, the profile with the projects a person is on, workload, and the links into the project plans (stakeholders from
// People, resources, the project manager, the Board owner picker).
// Checks the rows, sub-tasks, links (Predecessors), milestones, dates, and that no costs are exported. Real Blobs, Chromium.
// node gantt-export-test.js <site> [folder with node_modules/exceljs]
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const SITE = path.resolve(process.argv[2]);
const XL = path.resolve(process.argv[3] || path.join(__dirname, 'xl'));
const PORT = 8982, BASE = `http://127.0.0.1:${PORT}`;
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => results.push({ area, name, pass: !!pass, detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const csvParse = (s) => { const rows = []; let row = [], cur = '', q = false; for (let i = 0; i < s.length; i++) { const c = s[i]; if (q) { if (c === '"' && s[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; } else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; } else cur += c; } if (cur || row.length) { row.push(cur); rows.push(row); } return rows; };

(async () => {
  let ExcelJS = null; try { ExcelJS = require(require.resolve('exceljs', { paths: [XL, SITE] })); } catch {}
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-pp-blobs'); fs.rmSync(dir, { recursive: true, force: true });
  const blobs = new BlobsServer({ directory: dir, token: 'tok', port: 0 });
  const { port: bport } = await blobs.start();
  const ctxB64 = Buffer.from(JSON.stringify({ siteID: 'mbs', token: 'tok', edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, apiURL: `http://localhost:${bport}` })).toString('base64');
  process.env.NETLIFY_BLOBS_CONTEXT = ctxB64;
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NETLIFY_BLOBS_CONTEXT: ctxB64, ADMIN_USERNAME: 'sashi73', ADMIN_PASSWORD: 'sashi98', LLM_API_KEY: '', TELEGRAM_BOT_TOKEN: '', RESEND_API_KEY: '' };
  const srv = spawn('node', ['local-server.mjs'], { cwd: SITE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 40 && !/running/.test(log); i++) await sleep(150);
  let br = null;
  const tmp = path.join(os.tmpdir(), 'mbs-pp-files'); fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp);
  try {
    const J = await import(path.join(SITE, 'netlify/lib/jobs.mjs')), kv = await import(path.join(SITE, 'netlify/lib/kv.mjs')), P = await import(path.join(SITE, 'netlify/lib/plan.mjs'));
    const XL = path.resolve(process.argv[3] || path.join(__dirname, 'xl')); const mammoth = require(require.resolve('mammoth', { paths: [XL, SITE] }));
    const core = await J.nextCore('G');
    await J.create({ core, name: 'Rachel Raci', phone: '0400 101 202', email: '', suburb: 'Kellyville', service: 'Kitchen renovation', source: 'phone', summary: 'Kitchen renovation.' });
    br = await chromium.launch();
    const ctx = await br.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage(); p.setDefaultTimeout(20000);
    const errors = []; errorsAll = errors; p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
    await p.fill('[name=username]', 'sashi73'); await p.fill('[name=password]', 'sashi98'); await p.click('#loginForm button'); await p.waitForSelector('#app:not([hidden])');
    const menu = await p.$$eval('.side-nav > *', (x) => x.filter((e) => !e.hidden).map((e) => e.textContent.trim()));
    const gi = menu.indexOf('People');
    ok('Menu', 'a "People" group: Employees & contractors, Tickets & licences, Workload; and Admin › Users & access', gi > 0 && /Employees & contractors/.test(menu[gi + 1]) && /Tickets & licences/.test(menu[gi + 2]) && /Workload/.test(menu[gi + 3]) && menu.some((x) => /Users & access/.test(x)), menu.join(' | '));
    await p.click('[data-nav=people]'); await p.waitForSelector('#ppNew');
    ok('Empty', 'with nobody yet, it says what to add', /No people yet/.test(await p.textContent('#ppBody')));
    // add an employee through the editor
    await p.click('#ppNew'); await p.waitForSelector('#ppSave');
    ok('Editor', 'Employee or Contractor: an employee has Employment, not ABN or insurance', await p.isVisible('[data-k=employment]') && !(await p.isVisible('[data-k=abn]')) && !(await p.isVisible('[data-k="ins.expiry"]')));
    await p.check('[name=ppType][value=Contractor]'); await sleep(100);
    ok('Editor', 'a contractor has ABN, GST and public liability / workers comp', await p.isVisible('[data-k=abn]') && await p.isVisible('[data-k="ins.expiry"]') && !(await p.isVisible('[data-k=employment]')));
    await p.check('[name=ppType][value=Employee]');
    await p.fill('[data-k=name]', 'Priya Shah'); await p.fill('[data-k=role]', 'Project manager'); await p.fill('[data-k=phone]', '0411 222 333'); await p.fill('[data-k=email]', 'Priya@example.com');
    await p.fill('[data-k=costRate]', '85'); await p.fill('[data-k=chargeRate]', '140'); await p.fill('[data-k="tk.whiteCard.number"]', 'WC123456');
    const soon = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10); await p.fill('[data-k="tk.firstAid.expiry"]', soon);
    ok('Privacy', 'it says payroll details (TFN, bank, super) are not kept here', /tax file number, bank, super/.test(await p.textContent('#modal')));
    await p.click('#ppSave'); await p.waitForSelector('.pp-head'); await sleep(300);
    ok('Profile', 'saving opens their profile: role, rates, tickets, "First aid due soon"', /#people\/P-001$/.test(p.url()) && /Project manager/.test(await p.textContent('.pp-head')) && /\$85 \/hr/.test(await p.textContent('#view')) && /First aid: due/.test(await p.textContent('#view')));
    const P1 = await kv.get('ppl:P-001');
    ok('Saved', 'saved: email lower-case, white card, first aid expiry, rates', P1.email === 'priya@example.com' && P1.tickets.whiteCard.number === 'WC123456' && P1.tickets.firstAid.expiry === soon && P1.costRate === 85 && P1.chargeRate === 140);
    // more people by the API
    const save = (o) => p.evaluate((x) => window.MBS.api('pplSave', { person: x }), o);
    const past = new Date(Date.now() - 5 * 864e5).toISOString().slice(0, 10), far = new Date(Date.now() + 300 * 864e5).toISOString().slice(0, 10);
    await save({ type: 'Employee', name: 'Sam Ortega', role: 'Tradesperson', trade: 'electrician', phone: '0400 111 999', email: 'sam@example.com', costRate: 62, tickets: { whiteCard: { number: 'WC9' }, licence: { number: 'EC1', expiry: past } } });
    await save({ type: 'Contractor', name: 'Lee Tran', role: 'Site supervisor', business: 'Tran Building Services', abn: '12 345 678 901', costRate: 95, insurance: { insurer: 'QBE', expiry: far }, workersComp: { soleTrader: true }, tickets: { whiteCard: { number: 'WC7' } } });
    await save({ type: 'Employee', name: 'Ana Office', role: 'Accounts', email: 'ana@example.com' });
    await p.goto(`${BASE}/admin/#people`); await p.waitForSelector('tr[data-ppid]');
    ok('List', 'the list shows 4 people with role, rates and a ticket check', (await p.$$('tr[data-ppid]')).length === 4 && /Expired/.test(await p.textContent('tr[data-ppid="P-002"]')) && /\$95/.test(await p.textContent('tr[data-ppid="P-003"]')) && /Tran Building Services/.test(await p.textContent('tr[data-ppid="P-003"]')));
    await p.selectOption('#ppType', 'Contractor'); await sleep(200);
    ok('List', 'filter: contractors only', (await p.$$('tr[data-ppid]')).length === 1);
    await p.selectOption('#ppType', '');
    await p.click('[data-ptab=compliance]'); await sleep(300);
    const comp = await p.textContent('#ppBody');
    ok('Tickets', 'Tickets & licences: Sam\'s licence EXPIRED first, then Priya\'s first aid due soon; office staff need no white card', /Sam Ortega[\s\S]*Trade licence[\s\S]*EXPIRED/.test(comp) && /Priya Shah[\s\S]*First aid[\s\S]*due soon/.test(comp) && !/Ana Office/.test(comp) && comp.indexOf('Sam Ortega') < comp.indexOf('Priya Shah'));
    ok('Menu badge', 'the menu badge counts people with something expired or due (2)', (await p.textContent('[data-nav=peoplecomp] .nbadge')) === '2');
    // the plan: stakeholders from People
    await p.goto(`${BASE}/admin/#plan/${core}`); await p.waitForSelector('#tplType'); await p.selectOption('#tplType', 'kitchen-reno'); await p.click('#tplCreate'); await p.waitForSelector('table.gt'); await sleep(1200);
    await p.goto(`${BASE}/admin/#plan/${core}/stake`); await p.waitForSelector('#skPpl');
    const opts = await p.$$eval('#skPpl option', (o) => o.map((x) => x.textContent));
    ok('Plan', 'Stakeholders: "🧑‍🔧 Add from People…" lists employees and contractors', opts.some((x) => /Priya Shah · Project manager/.test(x)) && opts.some((x) => /Lee Tran/.test(x)) && opts.some((x) => /Sam Ortega.*tickets expired/.test(x)));
    await p.selectOption('#skPpl', 'P-001'); await sleep(1500);
    let pl = await P.get(core); const st = pl.stakeholders.find((x) => x.name === 'Priya Shah');
    ok('Plan', 'Priya is added with her role, phone, email, Accountable, and linked to People', st && st.role === 'Project manager' && st.raci === 'A' && st.phone === '0411 222 333' && st.email === 'priya@example.com' && st.person === 'P-001', JSON.stringify(st));
    ok('Plan', 'and she is no longer offered (already on the register)', !(await p.$$eval('#skPpl option', (o) => o.map((x) => x.textContent))).some((x) => /Priya/.test(x)));
    // resources and the project manager
    await p.goto(`${BASE}/admin/#plan/${core}/schedule`); await p.waitForSelector('#resList', { state: 'attached' });
    const rl = await p.$$eval('#resList option', (o) => o.map((x) => [x.value, x.label]));
    ok('Plan', 'the Resources list offers People first, with role and cost rate', rl[0][0] === 'Ana Office' && rl.some((x) => x[0] === 'Sam Ortega' && /Tradesperson · \$62\/hr/.test(x[1])), JSON.stringify(rl.slice(0, 4)));
    await p.goto(`${BASE}/admin/#plan/${core}/scope`); await p.waitForSelector('#chPM', { state: 'attached' });
    const pm = await p.$$eval('#chPM option', (o) => o.map((x) => x.value));
    ok('Plan', 'the Project manager box suggests People (managers and supervisors first)', pm[0] === 'Priya Shah' && pm[1] === 'Lee Tran' && pm.length === 4, JSON.stringify(pm));
    // assign through the plan, then see it on the profile and workload
    pl = await P.get(core); pl.charter.manager = 'Priya Shah'; const t2 = pl.tasks.find((t) => /plumbing/i.test(t.name)); t2.res = ['Sam Ortega']; t2.lead = 'Sam Ortega';
    const t3 = pl.tasks.find((t) => /cabinet/i.test(t.name)); t3.subs = [{ id: 'sx', name: 'Carcasses', off: 0, dur: 1, status: 'todo', owner: 'Lee Tran' }];
    await P.save(core, pl, pl.rev, 'test');
    await p.goto(`${BASE}/admin/#people/P-002`); await p.waitForSelector('.pp-proj');
    const prof = await p.textContent('.pp-proj');
    ok('Profile', 'Sam\'s profile shows the project and his task (lead), with dates', /Lead on a task/.test(prof) && /Plumbing/.test(prof) && /\d\d\/\d\d\/\d{4}/.test(prof));
    await p.goto(`${BASE}/admin/#people/P-001`); await p.waitForSelector('.pp-proj');
    ok('Profile', 'Priya: project manager and stakeholder (A) on the plan', /Project manager/.test(await p.textContent('.pp-proj')) && /Stakeholder \(A\)/.test(await p.textContent('.pp-proj')));
    await p.goto(`${BASE}/admin/#people/workload`); await p.waitForSelector('.pp-work tbody tr');
    const wl = await p.$$eval('.pp-work tbody tr', (r) => r.map((x) => Array.from(x.cells).map((c) => c.textContent.trim()).join('|')));
    ok('Workload', 'Workload lists everyone with projects, now, next 14 days and late', wl.length === 4 && wl.some((x) => /^Sam Ortega.*\|Tradesperson\|1\|/.test(x)) && wl.some((x) => /^Lee Tran.*\|Site supervisor\|1\|/.test(x)), wl.join(' / '));
    await p.screenshot({ path: path.join(os.tmpdir(), 'people-workload.png') });
    await p.goto(`${BASE}/admin/#people`); await p.waitForSelector('tr[data-ppid]'); await p.screenshot({ path: path.join(os.tmpdir(), 'people-list.png') });
    // Board owner picker: People appear
    await p.goto(`${BASE}/admin/#plan/${core}/board`); await p.waitForSelector('.kcard'); await sleep(400);
    const ob = await p.$('.kcard [data-ko], .kcard .kown, .kcard [data-kown]');
    if (ob) { await ob.click(); await p.waitForSelector('.kpop-list'); await sleep(200);
      const pop = await p.textContent('.kpop-list');
      ok('Board', 'the Board\'s owner picker lists People (not yet stakeholders) under "From People"', /From People/.test(pop) && /Sam Ortega/.test(pop) && /Lee Tran/.test(pop)); }
    else ok('Board', 'owner button found', false);
    // a picker opened straight after the plan loads stays open (loading People does not redraw the plan)
    const p2 = await ctx.newPage(); p2.on('pageerror', (e) => errors.push(e.message));
    await p2.goto(`${BASE}/admin/#plan/${core}/schedule`); await p2.waitForSelector('tr[data-tid] [data-pick]');
    await p2.click('tr[data-tid] [data-pick]'); await sleep(3500);
    ok('No redraw', 'a picker opened as the plan loads stays open (People load without redrawing the plan)', await p2.isVisible('#pkList') || await p2.isVisible('#modal:not([hidden])'));
    await p2.close();
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close(); br = null;
  } catch (e) { try { if (br) await br.close(); } catch {} ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ') + ' LOG: ' + log.slice(-400)); }
  try { srv.kill(); } catch {} try { await blobs.stop(); } catch {}
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(0);
})();
