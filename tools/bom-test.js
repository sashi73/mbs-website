// v89: 🧱 Bill of Materials: started from the materials already on the tasks; ✨ AI draft (≈ est); stock matching, shortfall and
// re-order; ＋ Add to Inventory; ordering tasks for long-lead items; lines written onto the tasks (the plan cost); checked, signed
// off and locked, reopened with a reason; reusable templates (scaled, matched to tasks); PDF, Word and Excel.
// node bom-test.js <site> [folder with node_modules/mammoth, exceljs]
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const SITE = path.resolve(process.argv[2]);
const XL = path.resolve(process.argv[3] || path.join(__dirname, 'xl'));
const PORT = 8987, BASE = `http://127.0.0.1:${PORT}`;
const http = require('http');
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => results.push({ area, name, pass: !!pass, detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const csvParse = (s) => { const rows = []; let row = [], cur = '', q = false; for (let i = 0; i < s.length; i++) { const c = s[i]; if (q) { if (c === '"' && s[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; } else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; } else cur += c; } if (cur || row.length) { row.push(cur); rows.push(row); } return rows; };

(async () => {
  let ExcelJS = null; try { ExcelJS = require(require.resolve('exceljs', { paths: [XL, SITE] })); } catch {}
  const seen = []; let down = false;
  const mock = http.createServer((req, res) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => {
    if (down) { res.writeHead(500); return res.end('{"error":"down"}'); }
    const b = JSON.parse(Buffer.concat(c).toString() || '{}'), sys = b.messages[0].content, user = JSON.parse(b.messages[1].content); seen.push({ sys, user });
    let out;
    if (/Bill of Materials/.test(sys)) { const T = user.tasks || [], tile = (user.stock_catalogue || []).find((c) => /tile/i.test(c.name));
      out = { lines: [{ n: T[0].n, name: 'Porcelain tile', qty: 25, unit: 'm2', item: tile ? tile.id : '', price: 60, lead_days: 0, note: 'includes 10% waste' },
        { n: T[1].n, name: 'Waterproofing membrane', qty: 2, unit: 'each', item: '', price: 180, lead_days: 0, note: '' },
        { n: T[2].n, name: 'Stone benchtop', qty: 1, unit: 'each', item: '', price: 2400, lead_days: 15, note: 'templated after cabinets — order early' }], caveat: 'Check the tile area against the drawings.' }; }
    else out = { costs: (user.tasks || []).map((t) => ({ id: t.id, q: 1, u: 'lot', r: 1000, b: 'lot' })), caveat: '' };
    setTimeout(() => { res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(out) }, finish_reason: 'stop' }], usage: { total_tokens: 900 } })); }, 300);
  }); });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-bom-blobs'); fs.rmSync(dir, { recursive: true, force: true });
  const blobs = new BlobsServer({ directory: dir, token: 'tok', port: 0 });
  const { port: bport } = await blobs.start();
  const ctxB64 = Buffer.from(JSON.stringify({ siteID: 'mbs', token: 'tok', edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, apiURL: `http://localhost:${bport}` })).toString('base64');
  process.env.NETLIFY_BLOBS_CONTEXT = ctxB64;
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NETLIFY_BLOBS_CONTEXT: ctxB64, ADMIN_USERNAME: 'sashi73', ADMIN_PASSWORD: 'sashi98', SITE_ENV: 'test', LLM_API_KEY: 'test', LLM_BASE_URL: `http://127.0.0.1:${mock.address().port}`, TELEGRAM_BOT_TOKEN: '', RESEND_API_KEY: '' };
  const srv = spawn('node', ['local-server.mjs'], { cwd: SITE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 40 && !/running/.test(log); i++) await sleep(150);
  let br = null;
  const tmp = path.join(os.tmpdir(), 'mbs-bom-files'); fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp);
  try {
    const J = await import(path.join(SITE, 'netlify/lib/jobs.mjs')), kv = await import(path.join(SITE, 'netlify/lib/kv.mjs')), P = await import(path.join(SITE, 'netlify/lib/plan.mjs'));
    const XL = path.resolve(process.argv[3] || path.join(__dirname, 'xl')); const mammoth = require(require.resolve('mammoth', { paths: [XL, SITE] }));
    const INV = await import(path.join(SITE, 'netlify/lib/inventory.mjs')), BOM = await import(path.join(SITE, 'netlify/lib/bom.mjs'));
    const core = await J.nextCore('G'), core2 = await J.nextCore('G');
    await J.create({ core, name: 'Bea Bathroom', phone: '0400 555 111', email: '', suburb: 'Kellyville', service: 'Kitchen renovation', source: 'phone', summary: 'Kitchen and splashback renovation, 3 m run.' });
    await J.create({ core: core2, name: 'Cal Cooper', phone: '0400 101 202', email: '', suburb: 'Castle Hill', service: 'Kitchen renovation', source: 'chat', summary: 'Larger kitchen renovation.' });
    await INV.saveSupplier({ name: 'Tile Depot', phone: '02 9000 0000', email: 'orders@tiledepot.example' }, 'test');
    const tile = (await INV.saveItem({ name: 'Porcelain tile 600x600', unit: 'm2', onHand: 10, category: 'Tiles' }, 'test')).item;
    const glue = (await INV.saveItem({ name: 'Tile adhesive 20kg', unit: 'bag', onHand: 50, category: 'Tiles' }, 'test')).item;
    br = await chromium.launch();
    const ctx = await br.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const p = await ctx.newPage(); p.setDefaultTimeout(20000);
    const errors = []; errorsAll = errors; p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
    await p.fill('[name=username]', 'sashi73'); await p.fill('[name=password]', 'sashi98'); await p.click('#loginForm button'); await p.waitForSelector('#app:not([hidden])');
    const mk = async (c) => { await p.goto(`${BASE}/admin/#plan/${c}`); await p.waitForSelector('#tplType'); await p.selectOption('#tplType', 'kitchen-reno'); await p.click('#tplCreate'); await p.waitForSelector('table.gt'); await sleep(1200); };
    const prep = async (c, mats) => { const x = await P.get(c); x.estAuto = 'done'; x.tasks.forEach((t, i) => { t.mats = i === 1 && mats ? [{ item: glue.id, qty: 4, price: 30 }] : []; }); await P.save(c, x, x.rev, 'test'); };
    await mk(core); await prep(core, true); await mk(core2); await prep(core2, false);
    const dl = async (fn) => { const [d] = await Promise.all([p.waitForEvent('download'), fn()]); const f = path.join(tmp, d.suggestedFilename()); await d.saveAs(f); return f; };
    const line = (name) => p.locator('tr[data-bk]').filter({ has: p.locator(`[data-bf=name][value="${name}"]`) });

    // 1. the tab, and starting the BOM from the materials on the tasks
    await p.goto(`${BASE}/admin/#plan/${core}/bom`); await p.waitForSelector('#bomGo');
    const tabs = await p.$$eval('#planTabs .tab', (x) => x.map((e) => e.textContent));
    ok('Tab', 'a 🧱 BOM tab, straight after the Board', tabs[tabs.indexOf('▦ Board') + 1] === '🧱 BOM', tabs.join(' | '));
    ok('Start', 'before it starts, it explains the steps and that the 1 material on the tasks becomes the first line', /Stock first/.test(await p.textContent('#planBody')) && /1 material already on the tasks/.test(await p.textContent('#planBody')));
    await p.click('#bomGo'); await p.waitForSelector('.bom-tbl'); await sleep(1500);
    let pl = await P.get(core);
    ok('Start', '"Start the BOM" imports the 📦 materials already on the tasks (4 bags of tile adhesive)', pl.bom && pl.bom.lines.length === 1 && pl.bom.lines[0].item === glue.id && pl.bom.lines[0].qty === 4 && pl.bom.lines[0].source === 'plan' && pl.bom.lines[0].task === pl.tasks[1].id, JSON.stringify(pl.bom));

    // 2. ✨ AI draft
    await p.click('#bomAi'); await p.waitForSelector('#bomGo');
    await p.fill('#bomNote', '3 m kitchen run'); await p.click('#bomGo'); await p.waitForSelector('#baGo', { timeout: 30000 });
    const sent = seen[seen.length - 1];
    ok('AI', 'the AI gets the tasks still without materials, the scope, the note and our stock catalogue (to use stock first)', /Bill of Materials/.test(sent.sys) && /3 m kitchen run/.test(sent.sys) && sent.user.stock_catalogue.some((c) => c.id === tile.id && c.in_stock === 10) && !sent.user.tasks.some((t) => t.n === 2) && /Kitchen/.test(sent.user.description), JSON.stringify(sent.user.tasks.map((t) => t.n)));
    ok('AI', 'the preview shows each line with its task, total and whether it is in stock, and a warning', (await p.$$('#modal .est-tbl tbody tr')).length === 3 && /Porcelain tile 600x600/.test(await p.textContent('#modal')) && /Estimates only/.test(await p.textContent('#modal')) && /not in stock/.test(await p.textContent('#modal')));
    await p.click('#baGo'); await sleep(2500);
    pl = await P.get(core);
    const tl = pl.bom.lines.find((l) => l.item === tile.id), bench = pl.bom.lines.find((l) => /benchtop/.test(l.name));
    ok('AI', 'the lines are added marked ≈ est, matched to our stock item where it is the same thing (no em dashes)', pl.bom.lines.length === 4 && pl.bom.lines.filter((l) => l.est && l.source === 'ai').length === 3 && tl && tl.name === 'Porcelain tile 600x600' && bench.lead === 15 && !/—/.test(bench.note), JSON.stringify(pl.bom.lines));
    ok('Plan', 'stock lines go onto their tasks automatically (set aside and in the task cost)', pl.tasks.find((t) => t.id === tl.task).mats.some((m) => m.item === tile.id && m.qty === 25 && m.price === 60) && pl.tasks[1].mats.length === 1);
    await p.waitForSelector('.bom-short'); await sleep(500);
    ok('Stock', 'the shortfall: 25 m2 of tile needed, 10 in stock, short 15 (not counting this job twice)', /Short 15 m2/.test(await line('Porcelain tile 600x600').textContent()) && /Shortfall: 1 item/.test(await p.textContent('.bom-short')), await p.textContent('.bom-short'));
    ok('Stock', 'the adhesive is covered by stock', /✓ 50 bag free/.test(await line('Tile adhesive 20kg').textContent()), await line('Tile adhesive 20kg').textContent());
    ok('Warning', 'a warning to check the ≈ est lines', /3 lines marked ≈ est/.test(await p.textContent('#planBody .est-warn')));

    // 3. ＋ Add to Inventory, ordering tasks, re-order
    await line('Stone benchtop').locator('[data-binv]').click(); await p.waitForFunction(() => /Short 1 each/.test(document.querySelector('#planBody').textContent), null, { timeout: 15000 });
    pl = await P.get(core); const bi = pl.bom.lines.find((l) => /benchtop/.test(l.name)).item;
    const it = (await kv.get('inv-index')).items[bi];
    ok('Inventory', '"＋ Add to Inventory" makes a stock item (no stock yet) and links the line: it is now set aside and short 1', bi && it && it.name === 'Stone benchtop' && pl.tasks.some((t) => t.mats.some((m) => m.item === bi)), JSON.stringify(it));
    await p.click('#bomOrdT'); await sleep(1800);
    pl = await P.get(core); const ot = pl.tasks.find((t) => t.name === 'Order: Stone benchtop'), user = pl.tasks.find((t) => t.mats.some((m) => m.item === bi));
    ok('Ordering task', 'long-lead items get an ordering task (15 days) linked before the task that needs the benchtop', ot && ot.dur === 15 && user.pred.includes(ot.id), JSON.stringify(ot));
    await p.click('#bomOrdT').catch(() => {}); await sleep(800);
    ok('Ordering task', 'not added twice', (await P.get(core)).tasks.filter((t) => t.name === 'Order: Stone benchtop').length === 1);
    await p.click(`[data-bro="${tile.id}"]`); await p.waitForSelector('#roQty');
    ok('Re-order', '"Re-order 15" opens the Inventory re-order with the shortfall as the quantity', (await p.inputValue('#roQty')) === '15', await p.inputValue('#roQty'));
    await p.click('#modal [data-close]'); await sleep(300);

    // 4. edit a line: the task follows
    const q = line('Porcelain tile 600x600').locator('[data-bf=qty]'); await q.fill('30'); await q.press('Tab'); await sleep(1800);
    pl = await P.get(core);
    ok('Edit', 'changing a quantity in the BOM changes the task\'s materials (the BOM is the source of truth)', pl.tasks.find((t) => t.mats.some((m) => m.item === tile.id)).mats.find((m) => m.item === tile.id).qty === 30);
    await p.goto(`${BASE}/admin/#plan/${core}/schedule`); await p.waitForSelector('table.gt'); await p.click('tr[data-tid] [data-pick]'); await sleep(800);
    ok('📦 button', 'with a BOM, 📦 on a task opens the BOM tab instead of a separate picker', /\/bom$/.test(p.url()) && !(await p.$('#mtSave')));
    await p.waitForSelector('.bom-tbl');

    // 5. check, sign off, locked, reopen
    ok('Sign off', 'Sign off is disabled until every line is checked', await p.$eval('#bomSign', (b) => b.disabled));
    for (let i = 0; i < 4; i++) { await p.locator('tr[data-bk] [data-bf=checked]:not(:checked)').first().click(); await sleep(400); }
    await sleep(1200); pl = await P.get(core);
    ok('Checked', 'ticking a line as checked clears ≈ est and records who', pl.bom.lines.every((l) => l.checked && !l.est && l.checkedBy));
    await p.click('#bomSign'); await p.fill('#bsF [name=by]', 'Olivia Bennett'); await p.fill('#bsF [name=sig]', 'Olivia Bennett'); await p.click('#bsF button[type=submit]'); await sleep(1800);
    pl = await P.get(core);
    ok('Sign off', 'signed off: saved with name, role and signature; locked (no editing)', pl.bom.status === 'Signed off' && pl.bom.signedBy === 'Olivia Bennett' && pl.bom.sig && await p.$eval('[data-bf=qty]', (x) => x.disabled) && !(await p.$('#bomAi')) && /Signed off by Olivia Bennett/.test(await p.textContent('.bom-signed')));
    ok('Server', 'the server never keeps a BOM as signed off with an unchecked line', BOM.cleanBom({ ...pl.bom, lines: pl.bom.lines.map((l, i) => ({ ...l, checked: i > 0 })) }, new Set(pl.tasks.map((t) => t.id))).status === 'Draft');
    // documents (signed)
    let f = await dl(async () => { await p.click('#bomDoc'); await p.waitForSelector('#bdDocx'); await p.click('#bdDocx'); });
    const txt = (await mammoth.extractRawText({ path: f })).value;
    ok('Document', 'Word: the BOM by task with totals, the shortfall to order and the sign-off', /BILL OF MATERIALS/.test(txt) && /Materials by task/.test(txt) && /Stone benchtop/.test(txt) && /To order \(shortfall\)/.test(txt) && /Olivia Bennett/.test(txt) && /15 working days/.test(txt), txt.slice(0, 300));
    f = await dl(async () => { await p.click('#bomDoc'); await p.waitForSelector('#bdPdf'); await p.click('#bdPdf'); });
    ok('Document', 'PDF too', fs.readFileSync(f).slice(0, 5).toString() === '%PDF-' && fs.statSync(f).size > 3000);
    f = await dl(() => p.click('#bomXls'));
    if (ExcelJS) { const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(f); const ws = wb.getWorksheet('BOM'); const vals = []; ws.eachRow((r) => vals.push(r.values.slice(1).map((v) => (v && v.formula ? '=' + v.formula : v)).join('|')));
      ok('Excel', 'Excel: one row per line with a Qty × Unit $ formula and a SUM total', vals.some((v) => /Porcelain tile 600x600\|30\|m2\|60\|=D\d+\*F\d+/.test(v)) && vals.some((v) => /Total materials.*=SUM\(G5:G\d+\)/.test(v)), vals.join(' // ')); }
    await p.click('#bomOpen'); await p.fill('#boF [name=why]', 'Customer changed the tile to 300x600'); await p.click('#boF button[type=submit]'); await sleep(1800);
    pl = await P.get(core);
    ok('Reopen', 'reopening needs a reason, which is kept in the history', pl.bom.status === 'Draft' && pl.bom.log.some((x) => /Reopened by .*Customer changed the tile/.test(x.what)) && /Customer changed the tile/.test(await p.textContent('.bom-log')));

    // 6. templates
    await p.click('#bomTpl'); await p.waitForSelector('#btF'); await p.fill('#btF [name=name]', 'Standard kitchen 3 m'); await p.click('#btF button[type=submit]'); await p.waitForSelector('[data-tapply]');
    const tpls = JSON.parse(await p.evaluate(() => window.MBS.api('planBomTplList').then((r) => JSON.stringify(r.templates))));
    ok('Template', 'save the BOM as a reusable template (BT-001, 4 lines)', tpls.length === 1 && tpls[0].id === 'BT-001' && tpls[0].lines === 4, JSON.stringify(tpls));
    await p.click('#modal [data-close]');
    await p.goto(`${BASE}/admin/#plan/${core2}/bom`); await p.waitForSelector('#bomGo'); await p.click('#bomGo'); await p.waitForSelector('#bomTpl'); await sleep(800);
    await p.click('#bomTpl'); await p.waitForSelector('[data-tapply]'); await p.click('[data-tapply]'); await p.waitForSelector('#taF'); await p.fill('#taF [name=k]', '2'); await p.click('#taF button[type=submit]'); await sleep(2500);
    const p1 = await P.get(core), p2 = await P.get(core2), nm = (pl, id) => (pl.tasks.find((t) => t.id === id) || {}).name;
    ok('Template', 'applied to another job: quantities scaled × 2, lines matched to the same-named tasks, marked ≈ est', p2.bom.lines.length === 4 && p2.bom.lines.every((l) => l.source === 'template' && l.est) && p2.bom.lines.find((l) => l.item === tile.id).qty === 60 &&
      p1.bom.lines.every((l) => { const m = p2.bom.lines.find((x) => x.name === l.name); return m && nm(p2, m.task) === nm(p1, l.task); }) && p2.bom.template === 'BT-001', JSON.stringify(p2.bom.lines.map((l) => [l.name, l.qty, nm(p2, l.task)])));
    ok('Template', 'and its stock lines are on that job\'s tasks too', p2.tasks.some((t) => t.mats.some((m) => m.item === tile.id && m.qty === 60)));
    await p.screenshot({ path: path.join(os.tmpdir(), 'bom-tab.png'), fullPage: true });
    await p.click('#bomTpl'); await p.waitForSelector('[data-tdel]'); await p.click('[data-tdel]'); await p.waitForSelector('#okBtn'); await p.click('#okBtn'); await sleep(1200);
    ok('Template', 'a template can be deleted', JSON.parse(await p.evaluate(() => window.MBS.api('planBomTplList').then((r) => JSON.stringify(r.templates)))).length === 0);
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close(); br = null;
  } catch (e) { try { if (br) await br.close(); } catch {} ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ') + ' LOG: ' + log.slice(-400)); }
  try { srv.kill(); } catch {} try { await blobs.stop(); } catch {}
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  mock.close(); process.exit(0);
})();
