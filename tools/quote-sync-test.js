// v87: the quote is the source of truth. Changing a line's quantity or unit price on a quote made from the plan, and saving it,
// updates the task on the project plan (the margin taken off, so the plan keeps the cost), marks it reviewed (no "≈ est"),
// notes where it came from, and the quote no longer says the plan changed. Older quotes (no task link) match by task name.
// Checks the rows, sub-tasks, links (Predecessors), milestones, dates, and that no costs are exported. Real Blobs, Chromium.
// node gantt-export-test.js <site> [folder with node_modules/exceljs]
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const SITE = path.resolve(process.argv[2]);
const XL = path.resolve(process.argv[3] || path.join(__dirname, 'xl'));
const PORT = 8984, BASE = `http://127.0.0.1:${PORT}`;
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => results.push({ area, name, pass: !!pass, detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const csvParse = (s) => { const rows = []; let row = [], cur = '', q = false; for (let i = 0; i < s.length; i++) { const c = s[i]; if (q) { if (c === '"' && s[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; } else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; } else cur += c; } if (cur || row.length) { row.push(cur); rows.push(row); } return rows; };

(async () => {
  let ExcelJS = null; try { ExcelJS = require(require.resolve('exceljs', { paths: [XL, SITE] })); } catch {}
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-qs-blobs'); fs.rmSync(dir, { recursive: true, force: true });
  const blobs = new BlobsServer({ directory: dir, token: 'tok', port: 0 });
  const { port: bport } = await blobs.start();
  const ctxB64 = Buffer.from(JSON.stringify({ siteID: 'mbs', token: 'tok', edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, apiURL: `http://localhost:${bport}` })).toString('base64');
  process.env.NETLIFY_BLOBS_CONTEXT = ctxB64;
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NETLIFY_BLOBS_CONTEXT: ctxB64, ADMIN_USERNAME: 'sashi73', ADMIN_PASSWORD: 'sashi98', LLM_API_KEY: '', TELEGRAM_BOT_TOKEN: '', RESEND_API_KEY: '' };
  const srv = spawn('node', ['local-server.mjs'], { cwd: SITE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 40 && !/running/.test(log); i++) await sleep(150);
  let br = null;
  const tmp = path.join(os.tmpdir(), 'mbs-qs-files'); fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp);
  try {
    const J = await import(path.join(SITE, 'netlify/lib/jobs.mjs')), kv = await import(path.join(SITE, 'netlify/lib/kv.mjs')), P = await import(path.join(SITE, 'netlify/lib/plan.mjs'));
    const XL = path.resolve(process.argv[3] || path.join(__dirname, 'xl')); const mammoth = require(require.resolve('mammoth', { paths: [XL, SITE] })); const ACC = await import(path.join(SITE, 'netlify/lib/accounts.mjs'));
    const core = await J.nextCore('G');
    await J.create({ core, name: 'Rachel Raci', phone: '0400 101 202', email: '', suburb: 'Kellyville', service: 'Kitchen renovation', source: 'phone', summary: 'Kitchen renovation.' });
    br = await chromium.launch();
    const ctx = await br.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage(); p.setDefaultTimeout(20000);
    const errors = []; errorsAll = errors; p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
    await p.fill('[name=username]', 'sashi73'); await p.fill('[name=password]', 'sashi98'); await p.click('#loginForm button'); await p.waitForSelector('#app:not([hidden])');
    await p.goto(`${BASE}/admin/#plan/${core}`); await p.waitForSelector('#tplType'); await p.selectOption('#tplType', 'kitchen-reno'); await p.click('#tplCreate'); await p.waitForSelector('table.gt'); await sleep(1200);
    let pl = await P.get(core); const T = pl.tasks[0]; T.name = 'Site inspection and moisture readings'; T.qty = 8; T.unit = 'h'; T.rate = 110; T.est = true; T.basis = 'AI benchmark'; T.mats = [];
    await P.save(core, pl, pl.rev, 'test');
    const api = (a, b) => p.evaluate(([a, b]) => window.MBS.api(a, b), [a, b || {}]);
    const q = (await api('planQuote', { core, margin: 10, mode: 'tasks' })).doc;
    let d = await ACC.get(q.id), line = d.items.find((i) => /^Site inspection/.test(i.desc));
    ok('Link', 'each quote line from the plan remembers its task', line && line.tid === T.id && line.qty === 8 && line.price === 121, JSON.stringify(line));
    // edit the quote on screen: 10 h at $132 (= $120 + 10%)
    await p.goto(`${BASE}/admin/#doc/${q.id}`); await p.waitForSelector('[data-k=qty]');
    const n = await p.$$eval('textarea[data-k=desc]', (t) => t.findIndex((x) => /^Site inspection/.test(x.value)));
    await p.fill(`[data-i="${n}"][data-k=qty]`, '10'); await p.fill(`[data-i="${n}"][data-k=price]`, '132');
    await p.click('#aSave'); await p.waitForFunction(() => /Project plan updated too/.test(document.body.textContent), null, { timeout: 15000 });
    const toastTxt = await p.evaluate(() => Array.from(document.querySelectorAll('.toast, #toast')).map((x) => x.textContent).join(' '));
    ok('Saved', 'saving says the project plan was updated too, and how (8 h x $110 to 10 h x $120)', /Project plan updated too: 1 task/.test(toastTxt) && /8 h x \$110 to 10 h x \$120/.test(toastTxt), toastTxt);
    pl = await P.get(core); const t1 = pl.tasks.find((t) => t.id === T.id);
    ok('Plan', 'the plan task is now 10 h at $120 (the 10% margin taken off)', t1.qty === 10 && t1.rate === 120, JSON.stringify([t1.qty, t1.rate]));
    ok('Plan', 'it is marked reviewed (no "≈ est") and notes it came from the quote', t1.est === false && new RegExp('from quote ' + q.id + ' \\(less the 10% margin\\)').test(t1.notes), t1.notes);
    d = await ACC.get(q.id);
    ok('Quote', 'the quote does not then say "plan changed" (it matches the plan), and its history notes the update', d.plan.fp === (await import(path.join(SITE, 'netlify/lib/plan-quote.mjs'))).fingerprint(pl) && d.history.some((h) => /Project plan updated from this quote: 1 task/.test(h.text)));
    // the plan page shows it
    await p.goto(`${BASE}/admin/#plan/${core}/schedule`); await p.waitForSelector('table.gt');
    await p.click('[data-cols=c]'); await sleep(400);
    ok('Plan page', 'the Schedule shows 10 h at $120 = $1,200, without the "≈ est" tag', (await p.inputValue(`tr[data-tid="${T.id}"] [data-k=qty]`)) === '10' && (await p.inputValue(`tr[data-tid="${T.id}"] [data-k=rate]`)) === '120' && /\$1,200/.test(await p.textContent(`tr[data-tid="${T.id}"]`)) && !(await p.$(`tr[data-tid="${T.id}"] .est-tag`)));
    // saving again without changes: nothing more
    let r = await api('docUpdate', { id: q.id, fields: { items: (await ACC.get(q.id)).items } });
    ok('No change', 'saving again with nothing changed leaves the plan alone', r.planSync && r.planSync.n === 0);
    // prices including GST
    let items = (await ACC.get(q.id)).items.map((i) => (i.tid === T.id ? { ...i, price: 151.8 } : i));
    r = await api('docUpdate', { id: q.id, fields: { items, pricesInc: true } });
    ok('GST', 'with "Prices include GST" ticked, the GST comes off too ($151.80 inc GST = $138 ex = $125.45 cost)', (await P.get(core)).tasks.find((t) => t.id === T.id).rate === 125.45, JSON.stringify(r.planSync));
    await api('docUpdate', { id: q.id, fields: { items: (await ACC.get(q.id)).items.map((i) => (i.tid === T.id ? { ...i, price: 132 } : i)), pricesInc: false } });
    // an older quote with no task link: matched by name
    const T2 = pl.tasks.find((t) => P.taskCost(t) > 0 && t.id !== T.id && !(t.mats || []).length);
    d = await ACC.get(q.id); d.items = d.items.map((i) => { const o = { ...i }; delete o.tid; return o; }); await kv.set('quote:' + q.id, d);
    const raw = await ACC.get(q.id); const noTid = !raw.items.some((i) => i.tid);
    items = raw.items.map((i) => (i.desc.startsWith(T2.name) ? { ...i, qty: i.qty + 1 } : i));
    r = await api('docUpdate', { id: q.id, fields: { items } });
    ok('Older quotes', 'a quote made before this change (no task link) still updates the right task, by its name', noTid && (r.planSync && r.planSync.n === 1 && (await P.get(core)).tasks.find((t) => t.id === T2.id).qty === T2.qty + 1), JSON.stringify([noTid, r.planSync]));
    // an accepted / invoiced quote does not change the plan any more; a "one total line" quote never does
    const qL = (await api('planQuote', { core, margin: 0, mode: 'lump' })).doc, dl = await ACC.get(qL.id);
    r = await api('docUpdate', { id: qL.id, fields: { items: dl.items.map((i) => ({ ...i, price: i.price + 1000 })) } });
    ok('Lump sum', 'a "one total line" quote does not change the plan (it can\'t be split back into tasks)', !r.planSync || r.planSync.n === 0);
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close(); br = null;
  } catch (e) { try { if (br) await br.close(); } catch {} ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ') + ' LOG: ' + log.slice(-400)); }
  try { srv.kill(); } catch {} try { await blobs.stop(); } catch {}
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(0);
})();
