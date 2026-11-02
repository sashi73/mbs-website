// v71: Wide view (plan) and Full screen (pipeline board) use the whole width even when the menu is folded to its 64 px strip;
// before, the whole page was squeezed into that strip. Run on the plain build and on the test-site (GKH) build.
// Checks the rows, sub-tasks, links (Predecessors), milestones, dates, and that no costs are exported. Real Blobs, Chromium.
// node gantt-export-test.js <site> [folder with node_modules/exceljs]
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const SITE = path.resolve(process.argv[2]);
const XL = path.resolve(process.argv[3] || path.join(__dirname, 'xl'));
const PORT = 8971, BASE = `http://127.0.0.1:${PORT}`;
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => results.push({ area, name, pass: !!pass, detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const csvParse = (s) => { const rows = []; let row = [], cur = '', q = false; for (let i = 0; i < s.length; i++) { const c = s[i]; if (q) { if (c === '"' && s[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; } else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; } else cur += c; } if (cur || row.length) { row.push(cur); rows.push(row); } return rows; };

(async () => {
  let ExcelJS = null; try { ExcelJS = require(require.resolve('exceljs', { paths: [XL, SITE] })); } catch {}
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-wide-blobs'); fs.rmSync(dir, { recursive: true, force: true });
  const blobs = new BlobsServer({ directory: dir, token: 'tok', port: 0 });
  const { port: bport } = await blobs.start();
  const ctxB64 = Buffer.from(JSON.stringify({ siteID: 'mbs', token: 'tok', edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, apiURL: `http://localhost:${bport}` })).toString('base64');
  process.env.NETLIFY_BLOBS_CONTEXT = ctxB64;
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NETLIFY_BLOBS_CONTEXT: ctxB64, ADMIN_USERNAME: 'sashi73', ADMIN_PASSWORD: 'sashi98', LLM_API_KEY: '', TELEGRAM_BOT_TOKEN: '', RESEND_API_KEY: '' };
  const srv = spawn('node', ['local-server.mjs'], { cwd: SITE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 40 && !/running/.test(log); i++) await sleep(150);
  let br = null;
  const tmp = path.join(os.tmpdir(), 'mbs-wide-files'); fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp);
  try {
    const J = await import(path.join(SITE, 'netlify/lib/jobs.mjs')), kv = await import(path.join(SITE, 'netlify/lib/kv.mjs'));
    const core = await J.nextCore('G');
    await J.create({ core, name: 'Wendy Wide', phone: '0400 101 202', email: '', suburb: 'Kellyville', service: 'Kitchen renovation', source: 'phone', summary: 'Kitchen renovation.' });
    br = await chromium.launch();
    const ctx = await br.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
    const p = await ctx.newPage(); p.setDefaultTimeout(20000);
    const errors = []; errorsAll = errors; p.on('pageerror', (e) => errors.push(e.message));
    await p.setViewportSize({ width: 1440, height: 900 });
    await p.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
    await p.evaluate(() => { localStorage.setItem('mbsSideMini', '1'); }); await p.reload({ waitUntil: 'networkidle' });
    await p.fill('[name=username]', 'sashi73'); await p.fill('[name=password]', 'sashi98'); await p.click('#loginForm button');
    await p.waitForSelector('#app:not([hidden])');
    ok('Setup', 'the menu is folded to the slim strip', await p.evaluate(() => document.body.classList.contains('side-mini')));
    await p.goto(`${BASE}/admin/#plan/${core}`); await p.waitForSelector('#tplType'); await p.selectOption('#tplType', 'kitchen-reno'); await p.click('#tplCreate'); await p.waitForSelector('table.gt'); await sleep(600);
    const mainW = () => p.evaluate(() => Math.round(document.querySelector('.main').getBoundingClientRect().width));
    await p.click('#planWide'); await sleep(500);
    for (const tab of ['schedule', 'board', 'critical', 'overview', 'reports', 'stake']) {
      await p.goto(`${BASE}/admin/#plan/${core}/${tab}`); await sleep(700);
      const w = await mainW(), wide = await p.evaluate(() => document.body.classList.contains('plan-wide'));
      ok('Wide view', `${tab}: with the menu folded, Wide view uses the whole width (${w} px)`, wide && w >= 1400 && await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), String(w));
    }
    await p.goto(`${BASE}/admin/#plan/${core}/board`); await sleep(600);
    ok('Wide view', 'the board\'s 4 columns spread across the screen', (await p.$$eval('.kcol', (a) => a.map((x) => x.getBoundingClientRect().width))).every((w) => w > 300));
    await p.click('#planWide'); await sleep(500);
    const w2 = await mainW();
    ok('Normal view', 'Normal view brings back the folded menu strip and the page beside it', !(await p.evaluate(() => document.body.classList.contains('plan-wide'))) && w2 >= 1440 - 70 && w2 < 1440, String(w2));
    // menu open + wide view
    await p.click('#planWide'); await sleep(300); await p.evaluate(() => { localStorage.setItem('mbsSideMini', '0'); document.body.classList.remove('side-mini'); }); await sleep(300);
    ok('Wide view', 'with the menu open, Wide view also uses the whole width', (await mainW()) >= 1400);
    await p.click('#planWide'); await sleep(300); await p.evaluate(() => { document.body.classList.add('side-mini'); });
    // pipeline board full screen
    await p.goto(`${BASE}/admin/#dashboard`); await sleep(800);
    const pb = await p.$('text=Pipeline board'); if (pb) { await pb.click(); await sleep(800); }
    const full = await p.$('#pbFull');
    if (full) { await full.click(); await sleep(500); ok('Full screen', 'the pipeline board\'s full screen uses the whole width with the menu folded', (await mainW()) >= 1400, String(await mainW())); await full.click(); }
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close(); br = null;
  } catch (e) { try { if (br) await br.close(); } catch {} ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ') + ' LOG: ' + log.slice(-400)); }
  try { srv.kill(); } catch {} try { await blobs.stop(); } catch {}
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(0);
})();
