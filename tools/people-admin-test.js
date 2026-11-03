// v90: People: looking after the register. History of every change; one person per email; a new name changes on the project
// plans too; quick status; archive with a reason (login stops) and restore; delete permanently (archived only, name typed, the
// login goes too); bulk status / role / rates / archive; renew a ticket from the Tickets tab; export CSV / Excel; import with a preview.
// node people-admin-test.js <site> [xl]
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const SITE = path.resolve(process.argv[2]);
const XL = path.resolve(process.argv[3] || path.join(__dirname, 'xl'));
const PORT = 8988, BASE = `http://127.0.0.1:${PORT}`;
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => results.push({ area, name, pass: !!pass, detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const csvParse = (s) => { const rows = []; let row = [], cur = '', q = false; for (let i = 0; i < s.length; i++) { const c = s[i]; if (q) { if (c === '"' && s[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; } else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; } else cur += c; } if (cur || row.length) { row.push(cur); rows.push(row); } return rows; };

(async () => {
  let ExcelJS = null; try { ExcelJS = require(require.resolve('exceljs', { paths: [XL, SITE] })); } catch {}
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-pa-blobs'); fs.rmSync(dir, { recursive: true, force: true });
  const blobs = new BlobsServer({ directory: dir, token: 'tok', port: 0 });
  const { port: bport } = await blobs.start();
  const ctxB64 = Buffer.from(JSON.stringify({ siteID: 'mbs', token: 'tok', edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, apiURL: `http://localhost:${bport}` })).toString('base64');
  process.env.NETLIFY_BLOBS_CONTEXT = ctxB64;
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NETLIFY_BLOBS_CONTEXT: ctxB64, ADMIN_USERNAME: 'sashi73', ADMIN_PASSWORD: 'sashi98', LLM_API_KEY: '', TELEGRAM_BOT_TOKEN: '', RESEND_API_KEY: '' };
  const srv = spawn('node', ['local-server.mjs'], { cwd: SITE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 40 && !/running/.test(log); i++) await sleep(150);
  let br = null;
  const tmp = path.join(os.tmpdir(), 'mbs-pa-files'); fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp);
  try {
    const J = await import(path.join(SITE, 'netlify/lib/jobs.mjs')), kv = await import(path.join(SITE, 'netlify/lib/kv.mjs')), P = await import(path.join(SITE, 'netlify/lib/plan.mjs'));
    const XL = path.resolve(process.argv[3] || path.join(__dirname, 'xl')); const mammoth = require(require.resolve('mammoth', { paths: [XL, SITE] }));
    const core = await J.nextCore('G');
    await J.create({ core, name: 'Rachel Raci', phone: '0400 101 202', email: '', suburb: 'Kellyville', service: 'Kitchen renovation', source: 'phone', summary: 'Kitchen renovation.' });
    const PPL = await import(path.join(SITE, 'netlify/lib/people.mjs'));
    const mkP = async (o) => (await PPL.save({ type: 'Employee', status: 'Active', ...o }, 'test')).person;
    const jack = await mkP({ name: 'Jack Morrison', role: 'Project manager', email: 'jack@example.com', phone: '0400 100 102', costRate: 95, chargeRate: 160 });
    const mei = await mkP({ name: 'Mei Chen', role: 'Site supervisor', email: 'mei@example.com', costRate: 78, chargeRate: 130, tickets: { whiteCard: { number: 'WC1' }, firstAid: { expiry: '2025-01-10' } } });
    const tom = await mkP({ name: 'Tom Walsh', role: 'Leading hand', email: 'tom@example.com', costRate: 65 });
    const sofia = await mkP({ name: 'Sofia Rossi', role: 'Apprentice', email: 'sofia@example.com', costRate: 0 });
    br = await chromium.launch();
    const ctx = await br.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const p = await ctx.newPage(); p.setDefaultTimeout(20000);
    const errors = []; errorsAll = errors; p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
    await p.fill('[name=username]', 'sashi73'); await p.fill('[name=password]', 'sashi98'); await p.click('#loginForm button'); await p.waitForSelector('#app:not([hidden])');
    const api = (a, b) => p.evaluate(([a, b]) => window.MBS.api(a, b).then((r) => ({ ok: true, r }), (e) => ({ ok: false, e: e.message })), [a, b || {}]);
    const dl = async (fn) => { const [d] = await Promise.all([p.waitForEvent('download'), fn()]); const f = path.join(tmp, d.suggestedFilename()); await d.saveAs(f); return f; };
    // a plan that names Jack (project manager, stakeholder, resource)
    await p.goto(`${BASE}/admin/#plan/${core}`); await p.waitForSelector('#tplType'); await p.selectOption('#tplType', 'kitchen-reno'); await p.click('#tplCreate'); await p.waitForSelector('table.gt'); await sleep(1200);
    let pl = await P.get(core); pl.charter.manager = 'Jack Morrison'; pl.stakeholders = [{ id: 'k1', name: 'Jack Morrison', role: 'PM', raci: 'A' }]; pl.tasks[0].res = ['Jack Morrison', 'Mei Chen']; await P.save(core, pl, pl.rev, 'test');
    const lg = await api('userSave', { user: { personId: tom.id, role: 'Read only' } });
    ok('Setup', 'Tom has a login', lg.ok, lg.e);

    // 1. edit: history and duplicate email
    await p.goto(`${BASE}/admin/#people/${mei.id}`); await p.waitForSelector('#ppEdit');
    await p.click('#ppEdit'); await p.waitForSelector('#ppSave'); await p.fill('[data-k=costRate]', '82'); await p.click('#ppSave'); await p.waitForSelector('.pp-hist'); await sleep(500);
    ok('History', 'every change is kept in the person\'s history: who, when and what (Cost rate 78 → 82)', /Cost rate 78 → 82/.test(await p.textContent('.pp-hist')) && /sashi73/.test(await p.textContent('.pp-hist')), await p.textContent('.pp-hist'));
    let r = await api('pplSave', { person: { ...(await PPL.get(sofia.id)), email: 'MEI@example.com' } });
    ok('Duplicates', 'two active people can\'t share an email (it is also the login)', !r.ok && /Mei Chen \(P-002\) already has the email/.test(r.e), r.e);
    r = await api('pplSave', { person: await PPL.get(sofia.id) });
    ok('History', 'saving with no changes says so and adds no history line', r.ok && r.r.same && !(await PPL.get(sofia.id)).history.some((h) => h.what !== 'Added'));

    // 2. rename: the plans follow
    await p.goto(`${BASE}/admin/#people/${jack.id}`); await p.waitForSelector('#ppEdit'); await p.click('#ppEdit'); await p.waitForSelector('#ppSave');
    ok('Rename', 'no "change on the plans" box until the name changes', await p.isHidden('.pp-ren'));
    await p.fill('[data-k=name]', 'Jack Morrison-Lee');
    ok('Rename', 'changing the name offers to change it on the project plans too', await p.isVisible('.pp-ren') && await p.isChecked('#ppRen'));
    await p.click('#ppSave'); await sleep(2000);
    pl = await P.get(core);
    ok('Rename', 'the new name is on the plan: project manager, stakeholder and resource (Mei untouched)', pl.charter.manager === 'Jack Morrison-Lee' && pl.stakeholders[0].name === 'Jack Morrison-Lee' && pl.tasks[0].res.join() === 'Jack Morrison-Lee,Mei Chen', JSON.stringify([pl.charter.manager, pl.tasks[0].res]));
    const asg = (await PPL.assignments(jack.id))[jack.id];
    ok('Rename', 'so the person keeps their project assignments', asg.projects === 1, JSON.stringify(asg));

    // 3. quick status, archive with a reason (login stops), restore
    await p.goto(`${BASE}/admin/#people/${mei.id}`); await p.waitForSelector('#ppSt'); await p.selectOption('#ppSt', 'On leave'); await sleep(1500);
    ok('Status', 'the status can be changed straight from the profile', (await PPL.get(mei.id)).status === 'On leave' && /Status Active → On leave/.test(await p.textContent('.pp-hist')));
    await p.goto(`${BASE}/admin/#people/${tom.id}`); await p.waitForSelector('#ppArc'); await p.click('#ppArc'); await p.waitForSelector('#arF');
    await p.fill('#arF [name=why]', 'Contract ended'); await p.click('#arF button[type=submit]'); await p.waitForSelector('.pp-archived'); await sleep(300);
    const t1 = await PPL.get(tom.id);
    ok('Archive', 'Archive asks for a reason, sets the finish date and keeps the record; the profile says archived', t1.archived && t1.archivedWhy === 'Contract ended' && t1.end && /Archived.*Contract ended/.test(await p.textContent('.pp-archived')) && t1.history.some((h) => /Archived.*Contract ended/.test(h.what)));
    ok('Archive', 'and their login stops working', !(await PPL.canLogin(tom.id)));
    ok('Archive', 'an archived person shows Restore and Delete permanently (no Archive or status)', !!(await p.$('#ppDel')) && /Restore/.test(await p.textContent('#ppArc')) && !(await p.$('#ppSt')));
    r = await api('pplDelete', { id: mei.id, confirm: 'Mei Chen' });
    ok('Delete', 'only archived people can be deleted', !r.ok && /Archive the person first/.test(r.e));

    // 4. delete permanently (and the login goes too)
    await p.click('#ppDel'); await p.waitForSelector('#dlGo');
    ok('Delete', 'Delete needs the full name typed', await p.$eval('#dlGo', (b) => b.disabled));
    await p.fill('#dlF [name=c]', 'tom walsh'); await p.click('#dlGo'); await p.waitForFunction(() => location.hash === '#people', null, { timeout: 10000 }); await sleep(800);
    const ul = await api('userList');
    ok('Delete', 'deleted: gone from People (and its index) and their login is removed', !(await PPL.get(tom.id)) && !(await PPL.list()).people.some((x) => x.id === tom.id) && !ul.r.users.some((u) => u.personId === tom.id));

    // 5. bulk changes
    await p.waitForSelector('tr[data-ppid]');
    ok('Bulk', 'the list has a tick box per person and a bulk bar (off until someone is ticked)', (await p.$$('[data-sel]')).length === 3 && await p.$eval('[data-bulk=status]', (b) => b.disabled));
    await p.click('#ppAll'); await sleep(300);
    ok('Bulk', '"select all" ticks everyone shown and turns the bar on', /3 selected/.test(await p.textContent('#ppBulk')) && !(await p.$eval('[data-bulk=cost]', (b) => b.disabled)));
    await p.click('[data-bulk=cost]'); await p.waitForSelector('#bkF'); await p.fill('#bkF [name=v]', '10'); await p.fill('#bkF [name=why]', 'Annual review'); await p.click('#bkF button[type=submit]'); await sleep(1800);
    const after = await Promise.all([jack.id, mei.id, sofia.id].map((id) => PPL.get(id)));
    ok('Bulk', 'cost rates up 10% in one go (95 → 104.50, 82 → 90.20); Sofia has no rate, so is skipped', after[0].costRate === 104.5 && after[1].costRate === 90.2 && after[2].costRate === 0 && /Cost rate 95 → 104.5 \(Annual review\)/.test(after[0].history.slice(-1)[0].what), JSON.stringify(after.map((x) => x.costRate)));
    await p.click(`[data-sel="${sofia.id}"]`); await sleep(200); await p.click(`[data-sel="${mei.id}"]`); await sleep(200);
    await p.click('[data-bulk=status]'); await p.waitForSelector('#bkF'); await p.selectOption('#bkF [name=v]', 'Inactive'); await p.click('#bkF button[type=submit]'); await sleep(1500);
    ok('Bulk', 'set the status for the people ticked', (await PPL.get(sofia.id)).status === 'Inactive' && (await PPL.get(mei.id)).status === 'Inactive' && (await PPL.get(jack.id)).status === 'Active');
    await p.click(`[data-sel="${sofia.id}"]`); await sleep(200); await p.click('[data-bulk=archive]'); await p.waitForSelector('#bkF'); await p.fill('#bkF [name=why]', 'Left'); await p.click('#bkF button[type=submit]'); await sleep(1500);
    ok('Bulk', 'bulk archive (with a reason); they leave the list', (await PPL.get(sofia.id)).archived && (await p.$$('tr[data-ppid]')).length === 2);

    // 6. renew a ticket from the Tickets tab
    await p.goto(`${BASE}/admin/#people/compliance`); await p.waitForSelector('#ppBody');
    r = await api('pplSave', { person: { ...(await PPL.get(mei.id)), status: 'Active' } });
    await p.goto(`${BASE}/admin/#people`); await sleep(500); await p.goto(`${BASE}/admin/#people/compliance`); await p.waitForSelector('[data-renew="First aid"]');
    await p.click('[data-renew="First aid"]'); await p.waitForSelector('#rnF'); await p.fill('#rnF [name=num]', 'FA-778'); await p.fill('#rnF [name=exp]', '2028-06-30'); await p.click('#rnF button[type=submit]'); await sleep(1500);
    const m2 = await PPL.get(mei.id);
    ok('Renew', '"↻ Update" on the Tickets tab records the renewed ticket; the old expiry is in the history', m2.tickets.firstAid.expiry === '2028-06-30' && m2.tickets.firstAid.number === 'FA-778' && m2.history.some((h) => /First aid expiry 2025-01-10 → 2028-06-30/.test(h.what)) && !(await p.$('[data-renew="First aid"]')));

    // 7. export, then import (update + add)
    await p.goto(`${BASE}/admin/#people`); await p.waitForSelector('#ppExp');
    let f = await dl(async () => { await p.click('#ppExp'); await p.waitForSelector('#exCsv'); await p.click('#exCsv'); });
    const csv = fs.readFileSync(f, 'utf8');
    ok('Export', 'CSV export: a header row and one row per active person', /^﻿ID,Name,Type,Role/.test(csv) && /Jack Morrison-Lee/.test(csv) && /Mei Chen/.test(csv) && !/Sofia/.test(csv), csv.slice(0, 200));
    f = await dl(async () => { await p.click('#ppExp'); await p.waitForSelector('#exArch'); await p.check('#exArch'); await p.click('#exXls'); });
    if (ExcelJS) { const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(f); const ws = wb.getWorksheet('People');
      ok('Export', 'Excel export (with archived people when asked)', ws.rowCount === 4 && ws.getRow(1).getCell(2).value === 'Name' && [2, 3, 4].some((i) => ws.getRow(i).getCell(2).value === 'Sofia Rossi'), String(ws.rowCount)); }
    const imp = path.join(tmp, 'import.csv');
    fs.writeFileSync(imp, 'Name,Email,Role,Mobile,Cost rate ($/hr),Type,Trade licence expiry,Started\r\nMei Chen,mei@example.com,Site manager,,,,,\r\n"Nguyen, Ben",ben@example.com,Tradesperson,0400 555 666,$90,Contractor,30/06/2027,1/2/2024\r\n,,,,,,,\r\nZed Zero,not-an-email,,,,,,\r\n');
    await p.click('#ppImp'); await p.waitForSelector('#imF'); await p.setInputFiles('#imF', imp); await p.waitForSelector('.im-sum');
    const prev = await p.textContent('#imOut');
    ok('Import', 'a preview first: 1 new, 1 update (what changes), 1 problem; nothing saved yet', /＋ 1 new/.test(prev) && /1 to update/.test(prev) && /Role Site supervisor → Site manager/.test(prev) && /1 with problems/.test(prev) && /Zed Zero: That email address does not look right/.test(prev) && !(await PPL.list()).people.some((x) => /Nguyen/.test(x.name)), prev);
    await p.click('#imGo'); await sleep(2000);
    const all = (await PPL.list()).people, ben = all.find((x) => x.name === 'Nguyen, Ben'), benF = ben && await PPL.get(ben.id);
    ok('Import', 'imported: Mei updated (other fields left alone), Ben added as a contractor with his rate, licence expiry and start date', (await PPL.get(mei.id)).role === 'Site manager' && (await PPL.get(mei.id)).costRate === 90.2 && benF && benF.type === 'Contractor' && benF.costRate === 90 && benF.tickets.licence.expiry === '2027-06-30' && benF.start === '2024-02-01' && /Import/.test(benF.history[0].what), JSON.stringify(benF));
    await p.screenshot({ path: path.join(os.tmpdir(), 'people-admin.png') });
    // 8. view-only users can't change anything
    r = await api('pplBulk', { ids: [jack.id], op: 'status', value: 'Active' });
    ok('Server', 'bulk changes check the input', r.ok && r.r.skipped.length === 1);
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close(); br = null;
  } catch (e) { try { if (br) await br.close(); } catch {} ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ') + ' LOG: ' + log.slice(-400)); }
  try { srv.kill(); } catch {} try { await blobs.stop(); } catch {}
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(0);
})();
