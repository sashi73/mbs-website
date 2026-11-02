// v85: a third level on the Gantt chart: dated steps inside a story (sub-task). Schedule rows with days and a start inside the
// story's dates and a thin Gantt bar; ticks drive the story's %; fold / unfold; delete with undo; the Board's story card shows them
// as a tick list (no slider); saved and clamped by the server; in the CSV, Microsoft Project XML, Excel workbook and report Gantt.
// Checks the rows, sub-tasks, links (Predecessors), milestones, dates, and that no costs are exported. Real Blobs, Chromium.
// node gantt-export-test.js <site> [folder with node_modules/exceljs]
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const SITE = path.resolve(process.argv[2]);
const XL = path.resolve(process.argv[3] || path.join(__dirname, 'xl'));
const PORT = 8981, BASE = `http://127.0.0.1:${PORT}`;
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => results.push({ area, name, pass: !!pass, detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const csvParse = (s) => { const rows = []; let row = [], cur = '', q = false; for (let i = 0; i < s.length; i++) { const c = s[i]; if (q) { if (c === '"' && s[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; } else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; } else cur += c; } if (cur || row.length) { row.push(cur); rows.push(row); } return rows; };

(async () => {
  let ExcelJS = null; try { ExcelJS = require(require.resolve('exceljs', { paths: [XL, SITE] })); } catch {}
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-sp-blobs'); fs.rmSync(dir, { recursive: true, force: true });
  const blobs = new BlobsServer({ directory: dir, token: 'tok', port: 0 });
  const { port: bport } = await blobs.start();
  const ctxB64 = Buffer.from(JSON.stringify({ siteID: 'mbs', token: 'tok', edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, apiURL: `http://localhost:${bport}` })).toString('base64');
  process.env.NETLIFY_BLOBS_CONTEXT = ctxB64;
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NETLIFY_BLOBS_CONTEXT: ctxB64, ADMIN_USERNAME: 'sashi73', ADMIN_PASSWORD: 'sashi98', LLM_API_KEY: '', TELEGRAM_BOT_TOKEN: '', RESEND_API_KEY: '' };
  const srv = spawn('node', ['local-server.mjs'], { cwd: SITE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 40 && !/running/.test(log); i++) await sleep(150);
  let br = null;
  const tmp = path.join(os.tmpdir(), 'mbs-sp-files'); fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp);
  try {
    const J = await import(path.join(SITE, 'netlify/lib/jobs.mjs')), kv = await import(path.join(SITE, 'netlify/lib/kv.mjs')), P = await import(path.join(SITE, 'netlify/lib/plan.mjs'));
    const XL = path.resolve(process.argv[3] || path.join(__dirname, 'xl')); const mammoth = require(require.resolve('mammoth', { paths: [XL, SITE] })); const ExcelJS = require(require.resolve('exceljs', { paths: [XL, SITE] }));
    const core = await J.nextCore('G');
    await J.create({ core, name: 'Rachel Raci', phone: '0400 101 202', email: '', suburb: 'Kellyville', service: 'Kitchen renovation', source: 'phone', summary: 'Kitchen renovation.' });
    br = await chromium.launch();
    const ctx = await br.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
    const p = await ctx.newPage(); p.setDefaultTimeout(20000);
    const errors = []; errorsAll = errors; p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
    await p.fill('[name=username]', 'sashi73'); await p.fill('[name=password]', 'sashi98'); await p.click('#loginForm button'); await p.waitForSelector('#app:not([hidden])');
    await p.goto(`${BASE}/admin/#plan/${core}`); await p.waitForSelector('#tplType'); await p.selectOption('#tplType', 'kitchen-reno'); await p.click('#tplCreate'); await p.waitForSelector('table.gt'); await sleep(1200);
    let pl = await P.get(core); const T = pl.tasks.find((t) => /benchtop/i.test(t.name)); T.dur = 6; T.subs = [{ id: 'sA', name: 'Fabrication', off: 0, dur: 5, status: 'todo', owner: 'Stone Co' }];
    await P.save(core, pl, pl.rev, 'test'); await p.goto(`${BASE}/admin/#projects`); await sleep(300);
    await p.goto(`${BASE}/admin/#plan/${core}/schedule`); await p.waitForSelector('table.gt'); await sleep(600);
    const sRow = 'tr.tsub[data-sid="sA"]';
    ok('Add', 'each story has "＋ step"', !!(await p.$(`${sRow} [data-addstep]`)));
    await p.click(`${sRow} [data-addstep]`); await p.waitForSelector('tr.tstep'); await sleep(200);
    ok('Add', 'a step row appears under the story (#n.1.1), its name selected to type over', /\.1\.1$/.test((await p.textContent('tr.tstep td.stepn')).trim()) && await p.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-qk') === 'name'));
    await p.keyboard.type('Template the stone'); await p.keyboard.press('Tab'); await sleep(300);
    await p.click(`${sRow} [data-addstep]`); await sleep(300); await p.keyboard.type('Cut and polish'); await p.keyboard.press('Tab'); await sleep(300);
    await p.click(`${sRow} [data-addstep]`); await sleep(300); await p.keyboard.type('Deliver'); await p.keyboard.press('Tab'); await sleep(300);
    const q2 = 'tr.tstep >> nth=1';
    await p.fill(`${q2} >> [data-qk=dur]`, '3'); await p.press(`${q2} >> [data-qk=dur]`, 'Tab'); await sleep(400);
    let st = await p.evaluate(() => window.MBS.planState.plan.tasks.find((t) => t.subs && t.subs.some((x) => x.id === 'sA')).subs[0].steps);
    ok('Dates', 'steps run one after another inside the story (off 0, 1, 2); a step\'s days can be changed', st.length === 3 && st[0].off === 0 && st[1].off === 1 && st[1].dur === 3 && st[2].off === 2, JSON.stringify(st.map((q) => [q.name, q.off, q.dur])));
    await p.fill(`${q2} >> [data-qk=dur]`, '9'); await p.press(`${q2} >> [data-qk=dur]`, 'Tab'); await sleep(400);
    st = await p.evaluate(() => window.MBS.planState.plan.tasks.find((t) => t.subs && t.subs.some((x) => x.id === 'sA')).subs[0].steps);
    ok('Dates', 'a step is kept inside its story (9 days asked, 4 allowed from day 2 of a 5-day story)', st[1].dur === 4);
    // start date beyond the story
    const sd = await p.evaluate(() => { const S = window.MBS.planState, t = S.plan.tasks.find((x) => x.subs && x.subs.some((y) => y.id === 'sA')); return [t.es, t.ef]; });
    await p.fill('tr.tstep >> nth=2 >> [data-qk=start]', '2030-01-01'); await p.press('tr.tstep >> nth=2 >> [data-qk=start]', 'Tab'); await sleep(400);
    st = await p.evaluate(() => window.MBS.planState.plan.tasks.find((t) => t.subs && t.subs.some((x) => x.id === 'sA')).subs[0].steps);
    ok('Dates', 'a start date outside the story is pulled back inside it', st[2].off <= 4);
    // Gantt: thin bars, rows aligned
    const g = await p.evaluate(() => ({ L: document.querySelectorAll('#gLeft tbody tr').length, R: document.querySelectorAll('#gRight tbody tr').length, bars: document.querySelectorAll('#gRight .gstep').length,
      h: Array.from(document.querySelectorAll('#gLeft tbody tr.tstep')).map((r, i) => { const qid = r.getAttribute('data-qid'), g = document.querySelector('#gRight tr[data-gqid="' + qid + '"]'); return Math.abs(r.getBoundingClientRect().top - g.getBoundingClientRect().top); }) }));
    ok('Gantt', 'each step has its own thin bar on the Gantt chart, level with its row', g.L === g.R && g.bars === 3 && g.h.every((d) => d < 2), JSON.stringify(g));
    // ticks drive the story
    await p.check('tr.tstep >> nth=0 >> [data-qk=done]'); await sleep(500);
    let sb = await p.evaluate(() => window.MBS.planState.plan.tasks.find((t) => t.subs && t.subs.some((x) => x.id === 'sA')).subs[0]);
    ok('Progress', 'ticking a 1-day step of 1 + 4 + 1 days makes the story 17% and In progress; its status box is locked', sb.pct === 17 && sb.status === 'doing' && await p.$eval(`${sRow} [data-sk=status]`, (x) => x.disabled), JSON.stringify([sb.pct, sb.status]));
    await p.check(`${sRow} [data-sk=done]`); await sleep(500);
    sb = await p.evaluate(() => window.MBS.planState.plan.tasks.find((t) => t.subs && t.subs.some((x) => x.id === 'sA')).subs[0]);
    ok('Progress', 'ticking the story done ticks all its steps', sb.steps.every((q) => q.done) && sb.pct === 100 && sb.status === 'done');
    await p.uncheck('tr.tstep >> nth=2 >> [data-qk=done]'); await sleep(1500);
    let sv = await P.get(core), ss = sv.tasks.find((t) => t.id === T.id).subs[0];
    ok('Saved', 'steps are saved; the server works out the same story % (83) and status', ss.steps.length === 3 && ss.pct === 83 && ss.status === 'review' && ss.steps[0].name === 'Template the stone', JSON.stringify([ss.pct, ss.status]));
    // fold
    await p.click(`${sRow} [data-stog]`); await sleep(300);
    ok('Fold', '▾ folds a story\'s steps away (and ▸ shows them)', (await p.$$('tr.tstep')).length === 0 && /3 done|2\/3 done/.test(await p.textContent(`${sRow} [data-addstep]`)));
    await p.click(`${sRow} [data-stog]`); await sleep(300);
    // delete + undo
    await p.click('tr.tstep >> nth=1 >> [data-qdel]'); await sleep(1500);
    ok('Delete', '🗑 deletes a step', (await P.get(core)).tasks.find((t) => t.id === T.id).subs[0].steps.length === 2);
    await p.click('#undoBar button'); await sleep(1500);
    ok('Delete', '↶ Undo brings it back', (await P.get(core)).tasks.find((t) => t.id === T.id).subs[0].steps.length === 3);
    // server clamps
    pl = await P.get(core); pl.tasks.find((t) => t.id === T.id).subs[0].steps.push({ id: 'pz', name: 'Too long', off: 9, dur: 20, done: false }); await P.save(core, pl, pl.rev, 'test');
    ss = (await P.get(core)).tasks.find((t) => t.id === T.id).subs[0];
    ok('Server', 'the server keeps steps inside the story (off and days clamped)', ss.steps[3].off <= 4 && ss.steps[3].off + ss.steps[3].dur <= 5);
    pl = await P.get(core); pl.tasks.find((t) => t.id === T.id).subs[0].steps.pop(); await P.save(core, pl, pl.rev, 'test');
    await p.goto(`${BASE}/admin/#projects`); await sleep(300); await p.goto(`${BASE}/admin/#plan/${core}/schedule`); await p.waitForSelector('tr.tstep'); await sleep(500);
    await (await p.$('#gSplit')).screenshot({ path: path.join(os.tmpdir(), 'steps-gantt.png') });
    // Board
    await p.goto(`${BASE}/admin/#plan/${core}/board`); await p.waitForSelector('.kcard'); await sleep(500);
    const st0 = `.kst[data-sid="sA"]`;
    ok('Board', 'the story card has no slider, just a "☐ 2/3 steps" chip with a bar (folded)', !(await p.$(`${st0} [data-sp]`)) && /2\/3 steps/.test(await p.textContent(`${st0} .kst-chip`)) && !(await p.$(`${st0} .kst-list`)));
    await p.click(`${st0} [data-kstog]`); await p.waitForSelector(`${st0} .kst-list`);
    ok('Board', 'opening it shows each step with a tick box and its date', (await p.$$(`${st0} .kst-list li`)).length === 3 && (await p.$$(`${st0} .kst-list input[type=checkbox]`)).length === 3 && /Template the stone/.test(await p.textContent(`${st0} .kst-list`)));
    await p.check(`${st0} .kst-list li:nth-child(3) [data-kqdone]`); await sleep(1500);
    ok('Board', 'ticking on the Board updates the story (all done: Done)', (await P.get(core)).tasks.find((t) => t.id === T.id).subs[0].status === 'done' && /3\/3 steps/.test(await p.textContent(`${st0} .kst-chip`)));
    await p.click(`${st0} [data-kstadd]`); await p.fill(`${st0} .kadd-in`, 'Seal'); await p.press(`${st0} .kadd-in`, 'Enter'); await sleep(600);
    ok('Board', '"＋ step" on the card adds one (and opens the next line for another)', (await p.evaluate(() => window.MBS.planState.plan.tasks.find((t) => t.subs && t.subs.some((x) => x.id === 'sA')).subs[0].steps.length)) === 4 && !!(await p.$(`${st0} .kadd-in`)));
    await p.keyboard.press('Escape'); await sleep(1500);
    await (await p.$(`.kcard[data-tid="${T.id}"]`)).screenshot({ path: path.join(os.tmpdir(), 'steps-board.png') });
    // a story without steps keeps its slider and offers "＋ steps"
    pl = await P.get(core); const T2 = pl.tasks.find((t) => /cabinet/i.test(t.name)); T2.subs = [{ id: 'sB', name: 'Carcasses', off: 0, dur: 1, status: 'todo' }]; await P.save(core, pl, pl.rev, 'test');
    await p.goto(`${BASE}/admin/#projects`); await sleep(300); await p.goto(`${BASE}/admin/#plan/${core}/board`); await p.waitForSelector('.kcard'); await sleep(400);
    ok('Board', 'a story with no steps keeps its slider and offers "＋ steps"', !!(await p.$('.kst[data-sid="sB"] [data-sp]')) && !!(await p.$('.kst[data-sid="sB"] .kstep-first')));
    // exports
    await p.goto(`${BASE}/admin/#plan/${core}/schedule`); await p.waitForSelector('#planCsv');
    const exp = async (fmt) => { await p.click('#planCsv'); await p.waitForSelector('input[name=gxf]'); await p.check(`input[name=gxf][value=${fmt}]`); const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#csvGo')]); const f = path.join(tmp, dl.suggestedFilename()); await dl.saveAs(f); return f; };
    const csv = fs.readFileSync(await exp('csv'), 'utf8');
    const ti = (await P.get(core)).tasks.findIndex((t) => t.id === T.id) + 1;
    ok('CSV', 'the CSV has the steps at Outline Level 3 (WBS n.1.1 ...) under their story', new RegExp('\\n\\d+,' + ti + '\\.1\\.1,3,Template the stone').test(csv) && new RegExp(ti + '\\.1\\.4,3,Seal').test(csv), csv.split('\n').filter((l) => l.includes(ti + '.1')).slice(0, 3).join(' | '));
    const xml = fs.readFileSync(await exp('mspdi'), 'utf8');
    ok('MS Project', 'Microsoft Project XML: steps at OutlineLevel 3; the story becomes a summary task', /<Name>Template the stone<\/Name><Type>1<\/Type><Manual>0<\/Manual><WBS>\d+\.1\.1<\/WBS><OutlineNumber>\d+\.1\.1<\/OutlineNumber><OutlineLevel>3<\/OutlineLevel>/.test(xml) && /<Name>Fabrication<\/Name>[\s\S]{0,400}?<Summary>1<\/Summary>/.test(xml));
    const ids = (xml.match(/<Task><UID>\d+<\/UID>/g) || []); ok('MS Project', 'every task has its own ID (no clashes)', new Set(ids).size === ids.length, ids.length + '');
    const xf = await exp('xlsx'); const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(xf); let lv3 = 0; wb.worksheets[0].eachRow((r) => { if (r.getCell(3).value === 3) lv3++; });
    ok('Excel', 'the Excel Gantt export has the 4 steps at outline level 3', lv3 === 4, String(lv3));
    await p.click('#planTabs >> text=Overview'); await p.waitForSelector('#planXls');
    const [x] = await Promise.all([p.waitForEvent('download'), p.click('#planXls')]); const xf2 = path.join(tmp, 'plan.xlsx'); await x.saveAs(xf2);
    const wb2 = new ExcelJS.Workbook(); await wb2.xlsx.readFile(xf2); const sch = wb2.getWorksheet('Schedule'); let found = 0, lvl = 0; sch.eachRow((r) => { if (/Template the stone/.test(String(r.getCell(2).value))) { found++; lvl = r.outlineLevel; } });
    ok('Excel', 'the plan workbook\'s Schedule sheet lists the steps (☑ / ☐) at outline level 2 under the story', found === 1 && lvl === 2);
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close(); br = null;
  } catch (e) { try { if (br) await br.close(); } catch {} ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ') + ' LOG: ' + log.slice(-400)); }
  try { srv.kill(); } catch {} try { await blobs.stop(); } catch {}
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(0);
})();
