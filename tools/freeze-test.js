// v61: the task list like Excel: drag a column heading's edge to size it (remembered, double-click or ↺ to reset), and ❄ Freeze the first columns.
// Checks the rows, sub-tasks, links (Predecessors), milestones, dates, and that no costs are exported. Real Blobs, Chromium.
// node gantt-export-test.js <site> [folder with node_modules/exceljs]
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const SITE = path.resolve(process.argv[2]);
const XL = path.resolve(process.argv[3] || path.join(__dirname, 'xl'));
const PORT = 8961, BASE = `http://127.0.0.1:${PORT}`;
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => results.push({ area, name, pass: !!pass, detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const csvParse = (s) => { const rows = []; let row = [], cur = '', q = false; for (let i = 0; i < s.length; i++) { const c = s[i]; if (q) { if (c === '"' && s[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; } else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; } else cur += c; } if (cur || row.length) { row.push(cur); rows.push(row); } return rows; };

(async () => {
  let ExcelJS = null; try { ExcelJS = require(require.resolve('exceljs', { paths: [XL, SITE] })); } catch {}
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-fz-blobs'); fs.rmSync(dir, { recursive: true, force: true });
  const blobs = new BlobsServer({ directory: dir, token: 'tok', port: 0 });
  const { port: bport } = await blobs.start();
  const ctxB64 = Buffer.from(JSON.stringify({ siteID: 'mbs', token: 'tok', edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, apiURL: `http://localhost:${bport}` })).toString('base64');
  process.env.NETLIFY_BLOBS_CONTEXT = ctxB64;
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NETLIFY_BLOBS_CONTEXT: ctxB64, ADMIN_USERNAME: 'sashi73', ADMIN_PASSWORD: 'sashi98', LLM_API_KEY: '', TELEGRAM_BOT_TOKEN: '', RESEND_API_KEY: '' };
  const srv = spawn('node', ['local-server.mjs'], { cwd: SITE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 40 && !/running/.test(log); i++) await sleep(150);
  let br = null;
  const tmp = path.join(os.tmpdir(), 'mbs-fz-files'); fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp);
  try {
    const J = await import(path.join(SITE, 'netlify/lib/jobs.mjs')), kv = await import(path.join(SITE, 'netlify/lib/kv.mjs'));
    const core = await J.nextCore('G');
    await J.create({ core, name: 'Fred Freeze', phone: '0400 101 202', email: '', suburb: 'Kellyville', service: 'Kitchen renovation', source: 'phone', summary: 'Kitchen renovation.' });
    br = await chromium.launch();
    const ctx = await br.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
    const p = await ctx.newPage(); p.setDefaultTimeout(20000);
    const errors = []; errorsAll = errors; p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
    await p.evaluate(() => { localStorage.removeItem('mbsPlanColW'); localStorage.removeItem('mbsPlanFreeze'); localStorage.setItem('mbsPlanCols', 'a'); localStorage.setItem('mbsPlanSplit', '420'); });
    await p.fill('[name=username]', 'sashi73'); await p.fill('[name=password]', 'sashi98'); await p.click('#loginForm button');
    await p.waitForSelector('#app:not([hidden])');
    await p.goto(`${BASE}/admin/#plan/${core}`); await p.waitForSelector('#tplType'); await p.selectOption('#tplType', 'kitchen-reno'); await p.click('#tplCreate'); await p.waitForSelector('table.gt'); await sleep(700);
    const cellX = (n) => p.evaluate((n) => { const r = document.querySelector('#gLeft tbody tr[data-tid]:nth-of-type(3) > :nth-child(' + n + ')'); return Math.round(r.getBoundingClientRect().left); }, n);
    const aligned = () => p.evaluate(() => { const l = [...document.querySelectorAll('#gLeft tbody tr')], r = [...document.querySelectorAll('#gRight tbody tr')]; return l.length === r.length && l.every((x, i) => Math.abs(x.getBoundingClientRect().top - r[i].getBoundingClientRect().top) < 1.5); });
    const setFz = async (v) => { if (!(await p.$('#gFzMenu'))) await p.click('#gFreezeBtn'); await p.selectOption('#gFreeze', v); await p.click('#title'); await sleep(150); };
    await p.click('#gFreezeBtn'); await p.waitForSelector('#gFzMenu');
    ok('Freeze', 'the ❄ chip on the Task heading opens the freeze choices (None, # and Task, up to Resources … Finish); # and Task frozen to start with', /# and Task/.test(await p.textContent('#gFreezeBtn')) && (await p.inputValue('#gFreeze')) === '3' && (await p.$$eval('#gFreeze option', (o) => o.length)) === 6);
    await p.click('#title'); await sleep(150);
    ok('Freeze', 'clicking elsewhere closes the menu', !(await p.$('#gFzMenu')));
    const t0 = await cellX(3), d0 = await cellX(6);
    const sx = await p.evaluate(() => { const L = document.querySelector('#gLeft'); L.scrollLeft = 1e5; return L.scrollLeft; }); await sleep(200);
    const t1 = await cellX(3), d1 = await cellX(6);
    ok('Freeze', 'scrolling the task list sideways: # and Task stay put, the other columns move under them', sx > 50 && Math.abs(t1 - t0) <= 1 && Math.abs(d0 - d1 - sx) <= 2, [sx, t0, t1, d0, d1].join(','));
    await setFz('6');
    const d2 = await cellX(6), r2 = await cellX(4);
    ok('Freeze', '"up to Start" freezes Resources, Days and Start too', Math.abs(d2 - d0) <= 1 && r2 < d2, [d0, d2, r2].join(','));
    await setFz('0');
    ok('Freeze', '"None" lets everything scroll', Math.abs((await cellX(3)) - (t0 - sx)) <= 2);
    await p.evaluate(() => { document.querySelector('#gLeft').scrollLeft = 0; });
    await setFz('3');
    // size the Task column
    const th = await p.$('#gLeft thead th:nth-child(3)'), w0 = (await th.boundingBox()).width;
    const hb = await (await p.$('#gLeft thead th:nth-child(3) .gcr')).boundingBox();
    await p.mouse.move(hb.x + 3, hb.y + hb.height / 2); await p.mouse.down(); await p.mouse.move(hb.x + 123, hb.y + hb.height / 2, { steps: 6 }); await p.mouse.up(); await sleep(500);
    const w1 = (await (await p.$('#gLeft thead th:nth-child(3)')).boundingBox()).width;
    ok('Columns', 'dragging the Task heading\'s edge 120 px to the right makes the column 120 px wider', Math.abs(w1 - w0 - 120) < 4, w0 + ' -> ' + w1);
    const inW = await p.evaluate(() => document.querySelector('#gLeft tbody tr[data-tid] > :nth-child(3) input').getBoundingClientRect().width);
    ok('Columns', 'the task name box fills the wider column', inW > w1 - 60, inW + ' in ' + w1);
    ok('Columns', 'rows still line up with the Gantt chart', await aligned());
    const r4 = await p.$('#gLeft thead th:nth-child(4) .gcr'), b4 = await r4.boundingBox(), w4 = (await (await p.$('#gLeft thead th:nth-child(4)')).boundingBox()).width;
    await p.mouse.move(b4.x + 3, b4.y + b4.height / 2); await p.mouse.down(); await p.mouse.move(b4.x - 80, b4.y + b4.height / 2, { steps: 6 }); await p.mouse.up(); await sleep(500);
    const w4b = (await (await p.$('#gLeft thead th:nth-child(4)')).boundingBox()).width;
    ok('Columns', 'a column can be made narrower too (Resources)', w4b < w4 - 60 && await aligned(), w4 + ' -> ' + w4b);
    await p.reload(); await p.waitForSelector('table.gt'); await sleep(600);
    const w1r = (await (await p.$('#gLeft thead th:nth-child(3)')).boundingBox()).width;
    ok('Columns', 'the widths are remembered after a reload', Math.abs(w1r - w1) < 4 && !(await p.$('#gFzMenu')), w1r + ' vs ' + w1);
    await p.dblclick('#gLeft thead th:nth-child(3) .gcr'); await sleep(300);
    const w1d = (await (await p.$('#gLeft thead th:nth-child(3)')).boundingBox()).width;
    ok('Columns', 'double-clicking the edge puts that column back to normal', Math.abs(w1d - w0) < 4, w1d + ' vs ' + w0);
    await p.click('#gFreezeBtn'); await p.click('#gColReset'); await sleep(400);
    const w4r = (await (await p.$('#gLeft thead th:nth-child(4)')).boundingBox()).width;
    ok('Columns', '↺ "All columns to normal width" (in the ❄ menu) puts them all back', Math.abs(w4r - w4) < 4 && (await p.evaluate(() => localStorage.getItem('mbsPlanColW'))) === null, w4r + ' vs ' + w4);
    ok('Freeze', 'the freeze choice is remembered', /# and Task/.test(await p.textContent('#gFreezeBtn')) && (await p.evaluate(() => localStorage.getItem('mbsPlanFreeze'))) === '3');
    await p.evaluate(() => { document.querySelector('#gLeft').scrollLeft = 300; document.querySelector('#gLeft').scrollTop = 200; }); await sleep(200);
    await p.screenshot({ path: path.join(os.tmpdir(), 'freeze.png') });
    const head = await p.evaluate(() => { const h = document.querySelector('#gLeft thead th:nth-child(3)').getBoundingClientRect(), L = document.querySelector('#gLeft').getBoundingClientRect(); return Math.abs(h.top - L.top) < 2; });
    ok('Freeze', 'the heading row stays at the top when scrolling down', head);
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close(); br = null;
  } catch (e) { try { if (br) await br.close(); } catch {} ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ') + ' LOG: ' + log.slice(-400)); }
  try { srv.kill(); } catch {} try { await blobs.stop(); } catch {}
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(0);
})();
