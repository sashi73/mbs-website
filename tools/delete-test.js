// v84: delete a task or a sub-task with the 🗑 next to its name (visible in the task list, even when the columns are narrow);
// a task with sub-tasks says how many go with it; the links close up (A → deleted → C becomes A → C); ↶ Undo brings it back.
// Checks the rows, sub-tasks, links (Predecessors), milestones, dates, and that no costs are exported. Real Blobs, Chromium.
// node gantt-export-test.js <site> [folder with node_modules/exceljs]
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const SITE = path.resolve(process.argv[2]);
const XL = path.resolve(process.argv[3] || path.join(__dirname, 'xl'));
const PORT = 8980, BASE = `http://127.0.0.1:${PORT}`;
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => results.push({ area, name, pass: !!pass, detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const csvParse = (s) => { const rows = []; let row = [], cur = '', q = false; for (let i = 0; i < s.length; i++) { const c = s[i]; if (q) { if (c === '"' && s[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; } else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; } else cur += c; } if (cur || row.length) { row.push(cur); rows.push(row); } return rows; };

(async () => {
  let ExcelJS = null; try { ExcelJS = require(require.resolve('exceljs', { paths: [XL, SITE] })); } catch {}
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-dl-blobs'); fs.rmSync(dir, { recursive: true, force: true });
  const blobs = new BlobsServer({ directory: dir, token: 'tok', port: 0 });
  const { port: bport } = await blobs.start();
  const ctxB64 = Buffer.from(JSON.stringify({ siteID: 'mbs', token: 'tok', edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, apiURL: `http://localhost:${bport}` })).toString('base64');
  process.env.NETLIFY_BLOBS_CONTEXT = ctxB64;
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NETLIFY_BLOBS_CONTEXT: ctxB64, ADMIN_USERNAME: 'sashi73', ADMIN_PASSWORD: 'sashi98', LLM_API_KEY: '', TELEGRAM_BOT_TOKEN: '', RESEND_API_KEY: '' };
  const srv = spawn('node', ['local-server.mjs'], { cwd: SITE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 40 && !/running/.test(log); i++) await sleep(150);
  let br = null;
  const tmp = path.join(os.tmpdir(), 'mbs-dl-files'); fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp);
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
    await p.goto(`${BASE}/admin/#plan/${core}`); await p.waitForSelector('#tplType'); await p.selectOption('#tplType', 'kitchen-reno'); await p.click('#tplCreate'); await p.waitForSelector('table.gt'); await sleep(1200);
    let pl = await P.get(core);
    const tA = pl.tasks[3], tB = pl.tasks[4], tC = pl.tasks[5];
    tB.pred = [tA.id]; tC.pred = [tB.id]; tB.subs = [{ id: 'sx1', name: 'Rough-in water', off: 0, dur: 1, owner: '', status: 'todo' }, { id: 'sx2', name: 'Rough-in power', off: 0, dur: 1, owner: '', status: 'todo' }];
    pl.tasks.splice(7, 0, { id: 'tEmpty', phase: pl.tasks[0].phase, name: '', dur: 2, res: [], pred: [], qty: 0, rate: 0, actual: 0, pct: 0, status: 'todo', subs: [] });
    await P.save(core, pl, pl.rev, 'test'); await p.goto(`${BASE}/admin/#projects`); await sleep(300);
    await p.goto(`${BASE}/admin/#plan/${core}/schedule`); await p.waitForSelector('table.gt'); await sleep(600);
    const nT = (await P.get(core)).tasks.length;
    const vis = await p.evaluate(() => { const L = document.querySelector('#gLeft').getBoundingClientRect(); return Array.from(document.querySelectorAll('tr[data-tid] .tdel, tr.tsub .tdel')).every((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.left >= L.left && r.right <= L.right; }); });
    ok('Button', 'every task and sub-task has a 🗑 next to its name, inside the visible task list', (await p.$$('tr[data-tid] .tdel')).length === nT && (await p.$$('tr.tsub[data-ptid] .tdel')).length >= 2 && !!(await p.$('tr.tsub[data-sid="sx2"] .tdel')) && vis, JSON.stringify(await p.evaluate(() => { const L = document.querySelector('#gLeft').getBoundingClientRect(); return [Math.round(L.left), Math.round(L.right), Array.from(document.querySelectorAll('tr[data-tid] .tdel, tr.tsub .tdel')).map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right), Math.round(r.width)]; }).filter((x) => !(x[2] > 0 && x[0] >= L.left && x[1] <= L.right))]; })) + ' n=' + (await p.$$('tr[data-tid] .tdel')).length + '/' + nT);
    // narrow the list (like the screenshot): still visible
    await p.evaluate(() => { const l = document.querySelector('#gLeft'); l.style.flex = '0 0 640px'; l.style.maxWidth = 'none'; });
    const vis2 = await p.evaluate(() => { const L = document.querySelector('#gLeft').getBoundingClientRect(); const b = document.querySelector('tr[data-tid] .tdel').getBoundingClientRect(); return b.left >= L.left && b.right <= L.right; });
    ok('Button', 'it stays in view when the task list is narrow (unlike the ✕ in the last column)', vis2);
    // sub-task delete + undo
    await p.click('tr.tsub[data-sid="sx2"] .tdel'); await sleep(1500);
    ok('Sub-task', 'deleting a sub-task removes just that one, and is saved', (await P.get(core)).tasks.find((t) => t.id === tB.id).subs.map((x) => x.id).join() === 'sx1' && !!(await p.$('#undoBar')));
    await p.click('#undoBar button'); await sleep(1500);
    ok('Undo', '↶ Undo brings the sub-task back', (await P.get(core)).tasks.find((t) => t.id === tB.id).subs.length === 2);
    // task with sub-tasks
    await sleep(3500); await p.$eval(`tr[data-tid="${tB.id}"]`, (r) => r.scrollIntoView({ block: 'center' }));
    await p.click(`tr[data-tid="${tB.id}"] .tdel`); await p.waitForSelector('#modal:not([hidden])');
    const msg = await p.textContent('#modal');
    ok('Task', 'deleting a task with sub-tasks says they go too, and that the order is kept', /and its 2 sub-tasks/.test(msg) && /1 task that came after it will now wait for what it was waiting for/.test(msg), msg.slice(0, 200));
    await p.click('#modal .btn-gold, #modal .btn-danger, #modal [data-ok]').catch(() => {}); await sleep(1500);
    let sv = await P.get(core);
    if (sv.tasks.length === nT) { await p.click('#modal button:last-child'); await sleep(1500); sv = await P.get(core); }
    ok('Task', 'the task and its sub-tasks are gone, and the next task now follows the one before (A → C)', sv.tasks.length === nT - 1 && !sv.tasks.some((t) => t.id === tB.id) && sv.tasks.find((t) => t.id === tC.id).pred.includes(tA.id), JSON.stringify(sv.tasks.find((t) => t.id === tC.id).pred));
    await p.click('#undoBar button'); await sleep(1500); sv = await P.get(core);
    ok('Undo', '↶ Undo restores the task, its sub-tasks and its links', sv.tasks.length === nT && sv.tasks.find((t) => t.id === tB.id).subs.length === 2 && sv.tasks.find((t) => t.id === tC.id).pred.join() === tB.id);
    // the empty one
    await sleep(3500); await p.$eval('tr[data-tid="tEmpty"]', (r) => r.scrollIntoView({ block: 'center' }));
    await p.click('tr[data-tid="tEmpty"] .tdel'); await p.waitForSelector('#modal:not([hidden])');
    ok('Untitled', 'a task with no name (saved as "New task") can be deleted too', /Delete “(New task|this untitled task)”/.test(await p.textContent('#modal')));
    await p.click('#modal button:last-child'); await sleep(1500);
    ok('Untitled', 'and it is gone', !(await P.get(core)).tasks.some((t) => t.id === 'tEmpty'));
    await p.screenshot({ path: path.join(os.tmpdir(), 'delete-task.png'), clip: { x: 0, y: 0, width: 1440, height: 700 } });
    // the Board
    await p.goto(`${BASE}/admin/#plan/${core}/board`); await p.waitForSelector('.kcard'); await sleep(600);
    const nb = (await P.get(core)).tasks.length;
    const card = `.kcard[data-tid="${tB.id}"]`;
    ok('Board', 'each theme card has a 🗑 in its footer (same line as the arrows), and each story one', !!(await p.$(`${card} .kfoot [data-kdel]`)) && (await p.$$(`${card} .kst [data-kdels]`)).length === 2 && await p.$eval(`${card} .kfoot`, (f) => { const a = f.querySelector('.pbar').getBoundingClientRect(), b = f.querySelector('[data-kdel]').getBoundingClientRect(); return Math.abs(a.top + a.height / 2 - (b.top + b.height / 2)) < 14; }));
    await p.hover(`${card} .kst[data-sid="sx1"]`); await p.click(`${card} .kst[data-sid="sx1"] [data-kdels]`); await sleep(1500);
    ok('Board', 'deleting a story on the Board removes it from the plan too', (await P.get(core)).tasks.find((t) => t.id === tB.id).subs.map((x) => x.id).join() === 'sx2' && !(await p.$(`${card} .kst[data-sid="sx1"]`)));
    await p.click('#undoBar button'); await sleep(1500);
    ok('Board', '↶ Undo brings the story back', (await P.get(core)).tasks.find((t) => t.id === tB.id).subs.length === 2);
    await sleep(3000);
    await p.click(`${card} [data-kdel]`); await p.waitForSelector('#modal:not([hidden])');
    ok('Board', 'deleting a theme asks first (with its stories)', /and its 2 sub-tasks/.test(await p.textContent('#modal')));
    await p.click('#modal button:last-child'); await sleep(1500);
    ok('Board', 'the theme is deleted from the plan (and the Gantt chart)', (await P.get(core)).tasks.length === nb - 1 && !(await p.$(card)));
    await p.click('#undoBar button'); await sleep(1500);
    ok('Board', 'and ↶ Undo puts it back', (await P.get(core)).tasks.length === nb && !!(await p.$(card)));
    await (await p.$(card)).screenshot({ path: path.join(os.tmpdir(), 'delete-board.png') });
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close(); br = null;
  } catch (e) { try { if (br) await br.close(); } catch {} ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ') + ' LOG: ' + log.slice(-400)); }
  try { srv.kill(); } catch {} try { await blobs.stop(); } catch {}
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(0);
})();
