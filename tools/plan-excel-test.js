// Test of the planner split view (draggable divider, wide view) and the Excel export (v25c).
// node xlstest.js <site> [folder with node_modules/exceljs]
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const SITE = path.resolve(process.argv[2]);
const XL = path.resolve(process.argv[3] || path.join(__dirname, 'xl'));
const PORT = 8903, BASE = `http://127.0.0.1:${PORT}`;
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => { results.push({ area, name, pass: !!pass, detail }); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const ExcelJS = require(require.resolve('exceljs', { paths: [XL] }));
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-xls-test-blobs'); fs.rmSync(dir, { recursive: true, force: true });
  const blobs = new BlobsServer({ directory: dir, token: 'tok', port: 0 });
  const { port: bport } = await blobs.start();
  const ctxB64 = Buffer.from(JSON.stringify({ siteID: 'mbs', token: 'tok', edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, apiURL: `http://localhost:${bport}` })).toString('base64');
  process.env.NETLIFY_BLOBS_CONTEXT = ctxB64;
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NETLIFY_BLOBS_CONTEXT: ctxB64, ADMIN_USERNAME: 'sashi73', ADMIN_PASSWORD: 'sashi98', TELEGRAM_BOT_TOKEN: '', RESEND_API_KEY: '', LLM_API_KEY: '', LIMIT_ADMIN: '100000/1' };
  const srv = spawn('node', ['local-server.mjs'], { cwd: SITE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 40 && !/running/.test(log); i++) await sleep(150);
  const cleanup = async () => { try { srv.kill(); } catch {} try { await blobs.stop(); } catch {} };

  try {
    const J = await import(path.join(SITE, 'netlify/lib/jobs.mjs'));
    const INV = await import(path.join(SITE, 'netlify/lib/inventory.mjs'));
    const core = await J.nextCore('W');
    await J.create({ core, name: 'Priya Nair', phone: '0400 000 001', email: 'priya@example.com', suburb: 'Castle Hill', service: 'Bathroom', source: 'chat' });
    const sup = (await INV.saveSupplier({ name: 'Beaumont Tiles', phone: '02 9634 1111', email: 'orders@b.example' }, 'test')).supplier;
    await INV.saveItem({ name: 'Floor tiles 600x600', unit: 'm²', onHand: 30, reorderLevel: 5, prices: [{ supplier: sup.id, price: 65, ref: 'Q-1' }], preferred: sup.id }, 'test');
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date());

    const br = await chromium.launch();
    const ctx = await br.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
    const p = await ctx.newPage(); p.setDefaultTimeout(15000);
    const errors = []; errorsAll = errors;
    p.on('pageerror', (e) => errors.push(e.message));
    const saved = async () => { await p.waitForTimeout(150); await p.waitForFunction(() => document.querySelector('#planSave') && document.querySelector('#planSave').textContent === 'Saved ✓', null, { timeout: 8000 }); };

    await p.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
    await p.fill('[name=username]', 'sashi73'); await p.fill('[name=password]', 'sashi98'); await p.click('#loginForm button');
    await p.waitForSelector('#app:not([hidden])');
    await p.goto(`${BASE}/admin/#plan/${core}`); await p.waitForSelector('#tplType');
    await p.fill('#tplStart', today); await p.fill('#tplScope', 'Waterproof and retile the main bathroom'); await p.selectOption('#tplType', 'bathroom'); await p.click('#tplCreate'); await p.waitForSelector('#gSplit');
    const buy = await p.evaluate(() => window.MBS.planState.plan.tasks.find((t) => t.name === 'Buy tiles').id);
    await p.click(`tr[data-tid="${buy}"] [data-pick]`); await p.waitForSelector('#pkList [data-pk]'); await p.click('#pkList [data-pk]'); await saved();
    // a risk and an issue
    await p.click('#planTabs >> text=Issues'); await p.click('#addIssue'); await p.keyboard.type('Leak found under the shower'); await p.selectOption('tr[data-iid] [data-x=priority]', 'High'); await saved();
    await p.click('#planTabs >> text=Schedule'); await p.waitForSelector('#gSplit');

    // ---- split view ----
    const geo = () => p.evaluate(() => {
      const L = document.querySelector('#gLeft'), R = document.querySelector('#gRight');
      const lr = [...L.querySelectorAll('tbody tr')], rr = [...R.querySelectorAll('tbody tr')];
      return { lw: L.getBoundingClientRect().width, rl: R.getBoundingClientRect().left, rows: lr.length, rrows: rr.length,
        same: lr.every((tr, i) => rr[i] && Math.abs(tr.getBoundingClientRect().height - rr[i].getBoundingClientRect().height) < 1.5 && Math.abs(tr.getBoundingClientRect().top - rr[i].getBoundingClientRect().top) < 1.5) };
    });
    let g = await geo();
    ok('Split', 'task list and Gantt chart are two panes with a divider, rows lined up exactly', g.rows === g.rrows && g.rows > 16 && g.same, JSON.stringify(g));
    await p.evaluate(() => { document.querySelector('#gLeft').scrollTop = 240; });
    await p.waitForTimeout(150);
    ok('Split', 'scrolling the task list scrolls the Gantt chart with it', await p.evaluate(() => Math.abs(document.querySelector('#gRight').scrollTop - document.querySelector('#gLeft').scrollTop) < 2 && document.querySelector('#gRight').scrollTop > 0));
    g = await geo();
    ok('Split', 'rows still line up after scrolling', g.same);
    const bar = await p.$('#gSplitter'); const bb = await bar.boundingBox();
    await p.mouse.move(bb.x + bb.width / 2, bb.y + 60); await p.mouse.down(); await p.mouse.move(bb.x - 250, bb.y + 60, { steps: 8 }); await p.mouse.up();
    await p.waitForTimeout(200);
    const g2 = await geo();
    ok('Divider', 'dragging the divider left gives the Gantt chart about 250 px more', g.lw - g2.lw > 200 && g2.same, `${Math.round(g.lw)} → ${Math.round(g2.lw)}`);
    await p.mouse.move(bb.x - 250 + 4, bb.y + 60); await p.mouse.down(); await p.mouse.move(bb.x + 300, bb.y + 60, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(200);
    const g3 = await geo();
    ok('Divider', 'dragging it right gives the task list more room', g3.lw > g2.lw + 400, `${Math.round(g2.lw)} → ${Math.round(g3.lw)}`);
    await p.reload(); await p.waitForSelector('#gSplit'); await p.waitForTimeout(300);
    ok('Divider', 'the divider position is remembered', Math.abs((await geo()).lw - g3.lw) < 4);
    await p.dblclick('#gSplitter'); await p.waitForTimeout(200);
    ok('Divider', 'double-click puts it back to normal', Math.abs((await geo()).lw - g.lw) < 30, Math.round((await geo()).lw) + ' vs ' + Math.round(g.lw));
    await p.screenshot({ path: 'MBS_plan_split.jpg', type: 'jpeg', quality: 80 });
    await p.click('#planWide'); await p.waitForTimeout(200);
    ok('Wide view', '"Wide view" hides the menu so the plan uses the whole screen', await p.evaluate(() => getComputedStyle(document.querySelector('.side')).display === 'none' && document.querySelector('#gSplit').getBoundingClientRect().width > 1400));
    await p.screenshot({ path: 'MBS_plan_wide.jpg', type: 'jpeg', quality: 80 });
    await p.goto(`${BASE}/admin/#projects`); await p.waitForTimeout(300);
    ok('Wide view', 'leaving the plan brings the menu back', await p.evaluate(() => getComputedStyle(document.querySelector('.side')).display !== 'none'));

    // ---- Excel export ----
    await p.goto(`${BASE}/admin/#plan/${core}/overview`); await p.waitForSelector('#planXls');
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#planXls')]);
    const file = path.join(os.tmpdir(), 'mbs-plan-test.xlsx'); await dl.saveAs(file);
    ok('Excel', 'the "⬇ Excel" button downloads MBS-plan-<job>-<date>.xlsx', /^MBS-plan-.+-\d{4}-\d{2}-\d{2}\.xlsx$/.test(dl.suggestedFilename()) && fs.statSync(file).size > 8000, dl.suggestedFilename());
    const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(file);
    const names = wb.worksheets.map((w) => w.name);
    ok('Excel', 'tabs: Overview, Schedule, Gantt, Board, Scope, Risks, Issues, Materials', JSON.stringify(names) === JSON.stringify(['Overview', 'Schedule', 'Gantt', 'Board', 'Scope', 'Risks', 'Issues', 'Materials']), names.join(','));
    const ov = wb.getWorksheet('Overview');
    ok('Overview', 'overview has scope / time / cost status with colours and the earned-value table', ov.getCell('A5').value === 'Scope: % complete' && ov.getCell('B5').numFmt === '0%' && /Budget at completion/.test(ov.getCell('A12').value) && ov.getCell('B12').value === 8580 && ov.getCell('A5').fill.fgColor.argb);
    const sc = wb.getWorksheet('Schedule');
    const hdr = sc.getRow(4).values.slice(1);
    ok('Schedule', 'schedule header: task, people, days, start, finish, qty, unit, unit $, cost, actual, status, %', hdr[1] === 'Task / sub-task' && hdr.includes('Unit $') && hdr.includes('% complete') && sc.getRow(4).getCell(1).fill.fgColor.argb === 'FF151515');
    let subRow = null, buyRow = null, totRow = null;
    sc.eachRow((r, n) => { if (/↳ Remove tiles and screed/.test(r.getCell(2).value || '')) subRow = r; if (r.getCell(2).value === 'Buy tiles') buyRow = r; if (r.getCell(2).value === 'Total (budget at completion)') totRow = r; });
    ok('Schedule', 'sub-tasks sit under their task, indented and grouped (Excel outline)', subRow && subRow.outlineLevel === 1 && /^\d+\.\d+$/.test(subRow.getCell(1).value));
    ok('Schedule', 'cost is a live formula (Qty × Unit $) in $ format; dates are real Excel dates', buyRow && /^I\d+\*K\d+$/.test(buyRow.getCell(12).value.formula) && buyRow.getCell(12).numFmt.includes('$') && buyRow.getCell(6).value instanceof Date && buyRow.getCell(17).value === 'Floor tiles 600x600');
    ok('Schedule', 'total row adds up the costs (SUBTOTAL formula, 8,580) and the sheet has filters and frozen headings', totRow && /SUBTOTAL\(9,L5:L\d+\)/.test(totRow.getCell(12).value.formula) && totRow.getCell(12).value.result === 8580 && sc.autoFilter && sc.views[0].state === 'frozen');
    const gs = wb.getWorksheet('Gantt');
    let tileRow = null; gs.eachRow((r) => { if (r.getCell(2).value === 'Wall & floor tiling') tileRow = r; });
    let filled = 0; tileRow && tileRow.eachCell({ includeEmpty: true }, (c, col) => { if (col > 5 && c.fill && c.fill.fgColor) filled++; });
    ok('Gantt', 'Gantt tab colours one cell per working day: tiling (3 days) = 3 cells', filled === 3, filled);
    ok('Gantt', 'Gantt has dates across the top and a colour legend', typeof gs.getRow(5).getCell(6).value === 'number' && /Colours:/.test(JSON.stringify(gs.getSheetValues())));
    const bd = wb.getWorksheet('Board');
    ok('Board', 'board tab: the 4 columns with task cards and sub-task checklists', /To do/.test(bd.getCell('A4').value) && /In review \/ QA/.test(bd.getCell('C4').value) && /☐ Remove tiles and screed/.test(JSON.stringify(bd.getSheetValues())));
    ok('Scope', 'scope tab has the charter (objective, in / out of scope)', /AS 3740/.test(JSON.stringify(wb.getWorksheet('Scope').getSheetValues())));
    const rk = wb.getWorksheet('Risks');
    ok('Risks', 'risks tab: score is a formula (P × I = 12) coloured by level, plus a heat map', rk.getCell('F5').value.formula === 'D5*E5' && rk.getCell('F5').value.result === 12 && rk.getCell('F5').fill.fgColor.argb === 'FFFEF3C7' && /Heat map/.test(JSON.stringify(rk.getSheetValues())));
    ok('Issues', 'issues tab has the issue with its priority colour', wb.getWorksheet('Issues').getCell('B5').value === 'Leak found under the shower' && wb.getWorksheet('Issues').getCell('D5').fill.fgColor.argb === 'FFFED7AA');
    ok('Materials', 'materials tab lists the stock item used by the plan', wb.getWorksheet('Materials').getCell('A5').value === 'Floor tiles 600x600');
    // the file opens in a real spreadsheet program (LibreOffice) and prints
    const out = path.join(os.tmpdir(), 'mbs-xls-pdf'); fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out);
    const r = require('child_process').spawnSync('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', out, file], { timeout: 120000 });
    const pdf = path.join(out, 'mbs-plan-test.pdf');
    ok('Excel', 'the workbook opens in LibreOffice (converted to PDF without errors)', fs.existsSync(pdf) && fs.statSync(pdf).size > 5000, String(r.stderr || '').slice(0, 200));
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close();
  } catch (e) { ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ')); }
  await cleanup();
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  if (pass !== results.length) console.log('\n--- server log ---\n' + log.slice(-2000));
})();
