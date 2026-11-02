// v75: 🧭 RACI map: activities × stakeholders in a panel that slides in from the right of the Stakeholders tab; suggestions,
// click to change, checks (one A, at least one R), saved with the plan, and the RACI map section in the project charter.
// Checks the rows, sub-tasks, links (Predecessors), milestones, dates, and that no costs are exported. Real Blobs, Chromium.
// node gantt-export-test.js <site> [folder with node_modules/exceljs]
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const SITE = path.resolve(process.argv[2]);
const XL = path.resolve(process.argv[3] || path.join(__dirname, 'xl'));
const PORT = 8975, BASE = `http://127.0.0.1:${PORT}`;
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => results.push({ area, name, pass: !!pass, detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const csvParse = (s) => { const rows = []; let row = [], cur = '', q = false; for (let i = 0; i < s.length; i++) { const c = s[i]; if (q) { if (c === '"' && s[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; } else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; } else cur += c; } if (cur || row.length) { row.push(cur); rows.push(row); } return rows; };

(async () => {
  let ExcelJS = null; try { ExcelJS = require(require.resolve('exceljs', { paths: [XL, SITE] })); } catch {}
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-rc-blobs'); fs.rmSync(dir, { recursive: true, force: true });
  const blobs = new BlobsServer({ directory: dir, token: 'tok', port: 0 });
  const { port: bport } = await blobs.start();
  const ctxB64 = Buffer.from(JSON.stringify({ siteID: 'mbs', token: 'tok', edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, apiURL: `http://localhost:${bport}` })).toString('base64');
  process.env.NETLIFY_BLOBS_CONTEXT = ctxB64;
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NETLIFY_BLOBS_CONTEXT: ctxB64, ADMIN_USERNAME: 'sashi73', ADMIN_PASSWORD: 'sashi98', LLM_API_KEY: '', TELEGRAM_BOT_TOKEN: '', RESEND_API_KEY: '' };
  const srv = spawn('node', ['local-server.mjs'], { cwd: SITE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 40 && !/running/.test(log); i++) await sleep(150);
  let br = null;
  const tmp = path.join(os.tmpdir(), 'mbs-rc-files'); fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp);
  try {
    const J = await import(path.join(SITE, 'netlify/lib/jobs.mjs')), kv = await import(path.join(SITE, 'netlify/lib/kv.mjs')), P = await import(path.join(SITE, 'netlify/lib/plan.mjs'));
    const XL = path.resolve(process.argv[3] || path.join(__dirname, 'xl')); const mammoth = require(require.resolve('mammoth', { paths: [XL, SITE] }));
    const core = await J.nextCore('G');
    await J.create({ core, name: 'Rachel Raci', phone: '0400 101 202', email: '', suburb: 'Kellyville', service: 'Kitchen renovation', source: 'phone', summary: 'Kitchen renovation.' });
    br = await chromium.launch();
    const ctx = await br.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
    const p = await ctx.newPage(); p.setDefaultTimeout(20000);
    const errors = []; errorsAll = errors; p.on('pageerror', (e) => errors.push(e.message));
    await p.setViewportSize({ width: 1440, height: 900 });
    await p.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
    await p.fill('[name=username]', 'sashi73'); await p.fill('[name=password]', 'sashi98'); await p.click('#loginForm button'); await p.waitForSelector('#app:not([hidden])');
    await p.goto(`${BASE}/admin/#plan/${core}`); await p.waitForSelector('#tplType'); await p.selectOption('#tplType', 'kitchen-reno'); await p.click('#tplCreate'); await p.waitForSelector('table.gt'); await sleep(1200);
    const pl = await P.get(core);
    pl.stakeholders = [{ id: 's1', name: 'Rachel Raci', role: 'Customer', raci: 'A' }, { id: 's2', name: 'Sam Ortega', role: 'Electrician', raci: 'R' }, { id: 's3', name: 'Priya Shah', role: 'Project manager', raci: 'C' }, { id: 's4', name: 'Strata Manager', role: 'Strata', raci: 'I' }];
    const pe = pl.tasks.find((t) => /plumbing/i.test(t.name)); pe.res = ['Sam Ortega']; pe.lead = 'Sam Ortega';
    await P.save(core, pl, pl.rev, 'test');
    await p.goto(`${BASE}/admin/#projects`); await sleep(300);
    await p.goto(`${BASE}/admin/#plan/${core}/stake`); await p.waitForSelector('#raciOpen');
    const nActs = (await P.get(core)).tasks.filter((t) => t.dur > 0).length;
    ok('Strip', 'the Stakeholders tab shows a RACI map strip (activities × people) and a 🧭 RACI map button', new RegExp(nActs + ' activities × 4 people').test(await p.textContent('#raciStrip')));
    await p.click('#raciOpen'); await p.waitForSelector('#rcDrawer.open .rc-tbl'); await sleep(300);
    const box = await p.$eval('.rc-panel', (e) => { const r = e.getBoundingClientRect(); return { l: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) }; });
    ok('Panel', 'it slides in from the right, full height, wide enough for the grid', box.l > 0 && box.w > 1100 && box.h >= 890, JSON.stringify(box));
    ok('Grid', 'one row per activity, one column per stakeholder (names written upwards)', (await p.$$('.rc-tbl tbody tr')).length === nActs && (await p.$$('.rc-tbl thead th.rc-p')).length === 4);
    const row = `tr[data-rt="${pe.id}"]`;
    const cellTxt = async (r, sid) => p.$eval(`${r} [data-rs="${sid}"]`, (b) => [b.textContent, b.className.includes('sug')]);
    ok('Suggest', 'suggestions (faint): the trade on the task is R, the customer A, the PM C, strata I', JSON.stringify(await cellTxt(row, 's2')) === '["R",true]' && JSON.stringify(await cellTxt(row, 's1')) === '["A",true]' && JSON.stringify(await cellTxt(row, 's3')) === '["C",true]' && JSON.stringify(await cellTxt(row, 's4')) === '["I",true]');
    const other = `tr[data-rt="${(await P.get(core)).tasks.find((t) => /wall repairs/i.test(t.name)).id}"]`;
    ok('Check', 'an activity with nobody Responsible is flagged "No R"; the plumbing one is ✓', /No R/.test(await p.textContent(`${other} .rc-chk`)) && /✓/.test(await p.textContent(`${row} .rc-chk`)));
    await p.click(`${other} [data-rs="s2"]`); await sleep(200);
    ok('Click', 'clicking a cell sets it (R), solid not faint, and the check turns ✓', JSON.stringify(await cellTxt(other, 's2')) === '["R",false]' && /✓/.test(await p.textContent(`${other} .rc-chk`)));
    await p.click(`${other} [data-rs="s3"]`); await sleep(200);
    ok('Click', 'clicking again moves on: C → I', JSON.stringify(await cellTxt(other, 's3')) === '["I",false]');
    await p.click(`${other} [data-rs="s3"]`); await p.click(`${other} [data-rs="s3"]`); await sleep(200);
    ok('Click', 'I → none → R (round the cycle)', JSON.stringify(await cellTxt(other, 's3')) === '["R",false]');
    for (let i = 0; i < 6 && (await cellTxt(row, 's3'))[0] !== 'A'; i++) { await p.click(`${row} [data-rs="s3"]`); await sleep(120); }
    ok('Check', 'two people Accountable on one activity is flagged "2 × A"', /2 × A/.test(await p.textContent(`${row} .rc-chk`)), await p.textContent(`${row} .rc-chk`));
    await p.click(`${row} [data-rs="s3"]`); await sleep(200);
    await p.click('#rcAccept'); await sleep(300);
    ok('Accept', '"Accept the suggestions" turns every faint letter into a real one', !(await p.$('.rc-c.sug:not(.rc-x)')) && !(await p.$('#rcAccept')));
    await sleep(1300);
    const sv = await P.get(core);
    ok('Saved', 'the RACI map is saved with the plan', sv.raciMap && sv.raciMap[pe.id] && sv.raciMap[pe.id].s2 === 'R' && Object.keys(sv.raciMap).length === nActs, JSON.stringify(sv.raciMap && sv.raciMap[pe.id]));
    await p.screenshot({ path: path.join(os.tmpdir(), 'raci-drawer.png') });
    await p.keyboard.press('Escape'); await sleep(400);
    ok('Panel', 'Esc closes it, and the strip on the tab updates', !(await p.$('#rcDrawer')) && /all set|to check/.test(await p.textContent('#raciStrip')));
    // the charter
    await p.goto(`${BASE}/admin/#plan/${core}/scope`); await p.waitForSelector('#chDoc'); await p.click('#chDoc'); await p.waitForSelector('#chDocx');
    ok('Charter', 'the charter options include "RACI map (activities × people)"', !!(await p.$('[data-cho=racimap]:checked')));
    const [d] = await Promise.all([p.waitForEvent('download'), p.click('#chDocx')]); const f = path.join(tmp, d.suggestedFilename()); await d.saveAs(f);
    const w = (await mammoth.extractRawText({ path: f })).value;
    ok('Charter', 'the charter has the RACI map: activities × people with initials and a key', /RACI map/.test(w) && /Key: RR = Rachel Raci \(Customer\)/.test(w) && /SO = Sam Ortega/.test(w) && /Plumbing & electrical rough-in/.test(w.split('RACI map')[1] || ''), (w.split('RACI map')[1] || '').slice(0, 300));
    const [d2] = await Promise.all([p.waitForEvent('download'), p.click('#chPdf')]); const f2 = path.join(tmp, d2.suggestedFilename()); await d2.saveAs(f2); fs.copyFileSync(f2, path.join(os.tmpdir(), 'charter-raci.pdf'));
    ok('Charter', 'and the PDF is made', fs.statSync(f2).size > 50000);
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close(); br = null;
  } catch (e) { try { if (br) await br.close(); } catch {} ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ') + ' LOG: ' + log.slice(-400)); }
  try { srv.kill(); } catch {} try { await blobs.stop(); } catch {}
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(0);
})();
