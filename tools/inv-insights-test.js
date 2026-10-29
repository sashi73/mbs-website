// v44: inventory test data, 📊 Insights and 🗺 Map. A copy of the site is built as the TEST site (tools/site-env.mjs),
// the real loader (tools/load-test-data.mjs) loads 150 enquiries, 50 suppliers and 150 stock items into it, then the
// console's Insights and Map tabs are checked against the data files. A stand-in AI answers the ✨ analysis.
// Real Blobs, local site, Chromium.
const { chromium } = require('playwright');
const { spawn, spawnSync } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const SRC = path.resolve(process.argv[2]);
const PORT = 8944, BASE = `http://127.0.0.1:${PORT}`;
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => results.push({ area, name, pass: !!pass, detail });
const run = (args, env, ms) => new Promise((res) => { const c = spawn('node', args.slice(2), { cwd: args[0], env }); let out = ''; c.stdout.on('data', (d) => (out += d)); c.stderr.on('data', (d) => (out += d)); const k = setTimeout(() => c.kill(), ms); c.on('close', (code) => { clearTimeout(k); res({ status: code, stdout: out }); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let lastAsk = null;
const mock = http.createServer((req, res) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => {
  const body = JSON.parse(Buffer.concat(c).toString() || '{}');
  lastAsk = body.messages.map((m) => m.content).join('\n');
  const out = { summary: 'Stock is healthy overall but cash is tied up in slow lines.', insights: ['Two suppliers carry most of the spend.', 'Several fast movers have under two weeks left.'], recommendations: ['Re-order the fast movers this week.', 'Return or sell the dead stock.'] };
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(out) }, finish_reason: 'stop' }], usage: { total_tokens: 1234 } }));
}); });

(async () => {
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  // build a TEST copy of the site
  const SITE = path.join(os.tmpdir(), 'mbs-inv-site'); fs.rmSync(SITE, { recursive: true, force: true });
  fs.cpSync(SRC, SITE, { recursive: true, filter: (s) => !/[\\/](node_modules|\.git)$/.test(s) });
  fs.symlinkSync(path.join(SRC, 'node_modules'), path.join(SITE, 'node_modules'));
  spawnSync('node', ['tools/site-env.mjs', '.'], { cwd: SITE, env: { ...process.env, SITE_ENV: 'test' } });
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SRC] }));
  const dir = path.join(os.tmpdir(), 'mbs-inv-blobs'); fs.rmSync(dir, { recursive: true, force: true });
  const blobs = new BlobsServer({ directory: dir, token: 'tok', port: 0 });
  const { port: bport } = await blobs.start();
  const ctxB64 = Buffer.from(JSON.stringify({ siteID: 'mbs', token: 'tok', edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, apiURL: `http://localhost:${bport}` })).toString('base64');
  process.env.NETLIFY_BLOBS_CONTEXT = ctxB64;
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NETLIFY_BLOBS_CONTEXT: ctxB64, ADMIN_USERNAME: 'sashi73', ADMIN_PASSWORD: 'sashi98', SITE_ENV: 'test',
    LLM_API_KEY: 'test', LLM_BASE_URL: `http://127.0.0.1:${mock.address().port}`, TELEGRAM_BOT_TOKEN: '', RESEND_API_KEY: '' };
  const srv = spawn('node', ['local-server.mjs'], { cwd: SITE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 40 && !/running/.test(log); i++) await sleep(150);
  let br = null;
  try {
    const I = await import(path.join(SITE, 'netlify/lib/inventory.mjs'));
    const SUP = JSON.parse(fs.readFileSync(path.join(SRC, 'tools/test-data/suppliers-50.json'))).suppliers;
    const INV = JSON.parse(fs.readFileSync(path.join(SRC, 'tools/test-data/inventory-150.json'))).items;
    ok('Data', 'the data files hold 50 suppliers and 150 stock items in at least 12 categories', SUP.length === 50 && INV.length === 150 && new Set(INV.map((x) => x.category)).size >= 12);
    ok('Data', 'every item\'s supplier codes point at a real test supplier, and the test data is clearly made up (.example.com, 02 5550 3…)',
      INV.every((it) => it.prices.every((p) => SUP.some((s) => s.code === p.supplier))) && SUP.every((s) => !s.email || /\.example\.com$/.test(s.email)) && SUP.every((s) => /^02 5550 3/.test(s.phone)));

    // the server refuses test data when SITE_ENV is not test (this process has no SITE_ENV)
    delete process.env.SITE_ENV;
    const refused = await I.testLoad({ kind: 'suppliers', suppliers: SUP.slice(0, 1) }, 'x');
    ok('Safety', 'test data is refused unless the site is the test site (SITE_ENV=test)', refused && refused.code === 403, JSON.stringify(refused));

    // the real loader, against the local TEST copy
    const t0 = Date.now();
    const ld = await run([SITE, 'node', 'tools/load-test-data.mjs', '--site', BASE], { ...process.env, MBS_LOAD_USER: 'sashi73', MBS_LOAD_PASS: 'sashi98' }, 900000);
    const lout = ld.stdout;
    ok('Loader', 'loads 150 enquiries, 50 suppliers and 150 stock items', /Enquiries: 150 added/.test(lout) && /Suppliers: 50 added/.test(lout) && /Stock items: 150 added/.test(lout), lout.slice(-700));
    console.log(`  (loader took ${Math.round((Date.now() - t0) / 1000)}s)`);
    const ld2 = await run([SITE, 'node', 'tools/load-test-data.mjs', '--site', BASE, '--what', 'inventory'], { ...process.env, MBS_LOAD_USER: 'sashi73', MBS_LOAD_PASS: 'sashi98' }, 120000);
    ok('Loader', 'running it again skips what is already there', /Suppliers and stock: already there \(50 test suppliers\), skipped/.test(ld2.stdout), ld2.stdout.slice(-300));
    const live = await run([SITE, 'node', 'tools/load-test-data.mjs', '--site', 'https://mbsplc.com.au'], { ...process.env, MBS_LOAD_USER: 'a', MBS_LOAD_PASS: 'b' }, 30000);
    ok('Safety', 'the loader refuses the live site', live.status !== 0 && /LIVE site/.test(live.stdout));

    const ins = await I.insights(Date.now());
    const T = ins.totals;
    ok('Figures', 'insights count all 150 items and 50 suppliers', T.items === 150 && T.suppliers === 50, JSON.stringify(T));
    const value = INV.reduce((s, it) => { const v = it.prices.filter((p) => p.validDays == null || p.validDays >= 0), pr = v.find((p) => p.supplier === it.preferred) || v.slice().sort((x, y) => x.price - y.price)[0]; return s + it.onHand * (pr ? pr.price : 0); }, 0);
    ok('Figures', 'stock value matches the data file (on hand × current preferred price, or the cheapest current one)', Math.abs(T.value - value) < 1, T.value + ' vs ' + value.toFixed(2));
    ok('Figures', 'there are items running low, on order, dead, and cheaper elsewhere', T.low > 10 && T.onOrder > 5 && T.dead > 10 && ins.savings.length > 0 && T.savingYear > 0, JSON.stringify(T));
    ok('Figures', 'stock used on jobs shows up by suburb', ins.suburbs.length >= 10 && ins.suburbs.every((s) => s.value > 0), ins.suburbs.length);
    ok('Figures', '6 months of use per month', Object.keys(ins.months).length >= 6 && Object.values(ins.months).filter((v) => v > 0).length >= 6, JSON.stringify(ins.months));

    br = await chromium.launch();
    const p = await (await br.newContext({ viewport: { width: 1500, height: 950 } })).newPage(); p.setDefaultTimeout(20000);
    const errors = []; errorsAll = errors;
    p.on('pageerror', (e) => errors.push(e.message)); p.on('dialog', (x) => { errors.push('dialog: ' + x.message()); x.dismiss(); });
    await p.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') }));
    await p.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
    await p.fill('[name=username]', 'sashi73'); await p.fill('[name=password]', 'sashi98'); await p.click('#loginForm button');
    await p.waitForSelector('#app:not([hidden])');
    await p.goto(`${BASE}/admin/#inventory`); await p.waitForSelector('[data-itab="insights"]');
    const tabs = await p.$$eval('[data-itab]', (x) => x.map((a) => a.textContent.trim()));
    ok('Tabs', 'Inventory has Stock items, Suppliers, 📊 Insights and 🗺 Map', tabs.length === 4 && /Insights/.test(tabs[2]) && /Map/.test(tabs[3]), tabs.join(' | '));

    await p.click('[data-itab="insights"]'); await p.waitForSelector('#invAi');
    ok('Insights', 'opens at #inventory/insights', /#inventory\/insights$/.test(await p.evaluate(() => location.hash)));
    const kp = await p.$$eval('#invBody .kpi', (x) => x.map((k) => k.textContent));
    ok('Insights', 'six headline figures, starting with the stock value', kp.length === 6 && kp[0].includes(T.value.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })), kp[0]);
    await p.waitForFunction(() => window.Chart && document.querySelectorAll('#invBody canvas').length === 2, null, { timeout: 15000 }).catch(() => {});
    ok('Insights', 'both charts draw (use per month, value by category)', await p.evaluate(() => !!window.Chart && ['chInvMonths', 'chInvCats'].every((id) => window.Chart.getChart(document.getElementById(id)))));
    const h2 = await p.$$eval('#invBody h2', (x) => x.map((h) => h.textContent).join(' | '));
    ok('Insights', 'running low, fast movers, dead stock, over-stocked, cheaper elsewhere, suppliers, on order and quotes ending are all there',
      ['Running low', 'Fast movers', 'Dead stock', 'Over-stocked', 'Cheaper elsewhere', 'Suppliers by use', 'On order', 'quotes ending'].every((w) => h2.includes(w)), h2);
    ok('Insights', 'the running-low table shows days left', /days/.test(await p.textContent('#invBody .card:has(h2:has-text("Running low")) table')));
    await p.screenshot({ path: path.join(__dirname, 'shot44-insights.png'), fullPage: true });
    await p.click('#invAi'); await p.waitForFunction(() => /What to do/.test((document.querySelector('#invAiOut') || {}).textContent || ''));
    ok('AI', '✨ Analyse shows the summary, what stands out and what to do', /cash is tied up/.test(await p.textContent('#invAiOut')) && (await p.$$eval('#invAiOut li', (x) => x.length)) === 4);
    ok('AI', 'only stock and supplier figures go to the AI: no phone numbers or emails', lastAsk && !/02 5550|example\.com|0400/.test(lastAsk), (lastAsk || '').match(/02 5550[^"]{0,20}|[\w.]+@[\w.]+/g));
    // clicking a row opens that item
    await p.click('#invBody tr[data-iid] >> nth=0'); await p.waitForSelector('#modalBody', { state: 'visible' });
    ok('Insights', 'clicking an item opens it', await p.isVisible('#modalBody'));
    await p.keyboard.press('Escape'); await sleep(300);
    if (await p.isVisible('#modalBody')) await p.click('.modal-card .x, .modal-card [data-close], #modalClose').catch(() => {});

    await p.goto(`${BASE}/admin/#inventory/map`); await p.waitForSelector('#imap .leaflet-container, #imap.leaflet-container');
    await p.waitForFunction(() => document.querySelectorAll('#imap path.leaflet-interactive').length > 0, null, { timeout: 15000 });
    const supN = await p.$$eval('#imap path.leaflet-interactive', (x) => x.length);
    const note = await p.textContent('#mapNote');
    ok('Map', 'suppliers show as bubbles, every test address recognised', supN >= 20 && !/without/.test(note), supN + ' bubbles · ' + note);
    const cats = await p.$$eval('#mapCat option', (x) => x.map((o) => o.textContent));
    await p.selectOption('#mapCat', cats[1]); await sleep(400);
    const supF = await p.$$eval('#imap path.leaflet-interactive', (x) => x.length);
    ok('Map', 'the category filter narrows the suppliers', supF > 0 && supF < supN, cats[1] + ': ' + supF + ' of ' + supN);
    await p.screenshot({ path: path.join(__dirname, 'shot44-map-suppliers.png') });
    await p.click('[data-mm="usage"]'); await p.waitForFunction(() => /Where stock is used/.test(document.querySelector('#mapSideH').textContent));
    await p.waitForFunction(() => document.querySelectorAll('#imap path.leaflet-interactive').length > 0, null, { timeout: 15000 });
    const useN = await p.$$eval('#imap path.leaflet-interactive', (x) => x.length);
    ok('Map', '"Where stock is used" shows job suburbs', useN >= Math.min(10, ins.suburbs.length) - 1, useN + ' of ' + ins.suburbs.length);
    await p.click('#imap path.leaflet-interactive >> nth=0', { force: true }); await sleep(400);
    ok('Map', 'a bubble opens a popup with the top items used there', /of stock on/.test(await p.textContent('#imap')));
    await p.screenshot({ path: path.join(__dirname, 'shot44-map-usage.png') });

    // the existing tabs still work
    await p.click('[data-itab="items"]'); await p.waitForSelector('#invBody table');
    ok('Tabs', 'Stock items still lists the stock', (await p.$$eval('#invBody tbody tr', (x) => x.length)) >= 50);
    await p.setViewportSize({ width: 390, height: 844 }); await p.goto(`${BASE}/admin/#inventory/insights`); await p.waitForSelector('#invAi'); await sleep(800);
    ok('Phone', 'no sideways scrolling on a phone (Insights)', (await p.evaluate(() => document.documentElement.scrollWidth)) <= 391, await p.evaluate(() => [document.documentElement.scrollWidth].concat([...document.querySelectorAll('#app *')].filter((e) => e.getBoundingClientRect().right > 392 && getComputedStyle(e).position !== 'fixed').slice(0, 6).map((e) => e.tagName + '.' + e.className + '#' + e.id + ' ' + Math.round(e.getBoundingClientRect().right))).join(' ; ')));
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close(); br = null;
  } catch (e) { try { if (br) await br.close(); } catch {} ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ') + ' LOG: ' + log.slice(-600)); }
  try { srv.kill(); } catch {} try { mock.close(); } catch {} try { await blobs.stop(); } catch {}
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(0);
})();
