// v78: ✨ indicative costs: AI benchmark costs per task (hours actually worked per day x people x rate, or lump sums), clearly marked
// "≈ est" with a firm warning until the consultant reviews them; a data centre is sized to $12.1M per MW; on the test site sample plans
// are filled the first time they are opened; quotes need the costs confirmed; built-in benchmarks when the AI is down.
// node cost-test.js <site> [folder with node_modules/mammoth]
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const SITE = path.resolve(process.argv[2]);
const XL = path.resolve(process.argv[3] || path.join(__dirname, 'xl'));
const PORT = 8977, BASE = `http://127.0.0.1:${PORT}`;
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
    const costs = (user.tasks || []).map((t, i) => i % 2 ? { id: t.id, q: 1, u: 'lot', r: 40000, b: 'benchmark package, lot' } : { id: t.id, q: t.days * 5, u: 'h', r: 220, b: t.days + ' d x 5 h/d x 1 consultant @ $220/h' });
    setTimeout(() => { res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ costs, caveat: 'Equipment prices move with the market.' }) }, finish_reason: 'stop' }], usage: { total_tokens: 900 } })); }, 400);
  }); });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-ct-blobs'); fs.rmSync(dir, { recursive: true, force: true });
  const blobs = new BlobsServer({ directory: dir, token: 'tok', port: 0 });
  const { port: bport } = await blobs.start();
  const ctxB64 = Buffer.from(JSON.stringify({ siteID: 'mbs', token: 'tok', edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, apiURL: `http://localhost:${bport}` })).toString('base64');
  process.env.NETLIFY_BLOBS_CONTEXT = ctxB64;
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NETLIFY_BLOBS_CONTEXT: ctxB64, ADMIN_USERNAME: 'sashi73', ADMIN_PASSWORD: 'sashi98', SITE_ENV: 'test', LLM_API_KEY: 'test', LLM_BASE_URL: `http://127.0.0.1:${mock.address().port}`, TELEGRAM_BOT_TOKEN: '', RESEND_API_KEY: '' };
  const srv = spawn('node', ['local-server.mjs'], { cwd: SITE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 40 && !/running/.test(log); i++) await sleep(150);
  let br = null;
  const tmp = path.join(os.tmpdir(), 'mbs-ct-files'); fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp);
  try {
    const J = await import(path.join(SITE, 'netlify/lib/jobs.mjs')), kv = await import(path.join(SITE, 'netlify/lib/kv.mjs')), P = await import(path.join(SITE, 'netlify/lib/plan.mjs'));
    const XL = path.resolve(process.argv[3] || path.join(__dirname, 'xl')); const mammoth = require(require.resolve('mammoth', { paths: [XL, SITE] }));
    const core = await J.nextCore('G'), core2 = await J.nextCore('G');
    await J.create({ core: core2, name: 'Kim Kitchen', phone: '0400 555 111', email: '', suburb: 'Kellyville', service: 'Kitchen renovation', source: 'phone', summary: 'Kitchen renovation.' });
    await J.create({ core, name: 'Dana Centre', phone: '0400 101 202', email: '', suburb: 'Marsden Park', service: 'Construction', source: 'chat', summary: 'I want to build a comprehensive 100 MW AI data centre, Tier IV, hybrid cooling.' });
    br = await chromium.launch();
    const ctx = await br.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const p = await ctx.newPage(); p.setDefaultTimeout(20000);
    const errors = []; errorsAll = errors; p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
    await p.fill('[name=username]', 'sashi73'); await p.fill('[name=password]', 'sashi98'); await p.click('#loginForm button'); await p.waitForSelector('#app:not([hidden])');
    const mk = async (c) => { await p.goto(`${BASE}/admin/#plan/${c}`); await p.waitForSelector('#tplType'); await p.selectOption('#tplType', 'kitchen-reno'); await p.click('#tplCreate'); await p.waitForSelector('table.gt'); await sleep(1200); };
    // 1. the "100 MW data centre" sample plan, with almost no costs
    await mk(core);
    let pl = await P.get(core); pl.name = '100 MW AI data centre, Marsden Park'; pl.tasks.forEach((t, i) => { t.qty = i === 2 ? 10 : 0; t.rate = i === 2 ? 650 : 0; t.unit = 'h'; t.mats = []; }); pl.estAuto = ''; await P.save(core, pl, pl.rev, 'test');
    const bench = P.benchTarget(await P.get(core), await J.find(core));
    ok('Benchmark', 'a 100 MW data centre is benchmarked at $12.1M per MW: $1.21 billion', bench && bench.total === 1210000000, JSON.stringify(bench));
    await p.goto(`${BASE}/admin/#projects`); await sleep(300);
    await p.goto(`${BASE}/admin/#plan/${core}/schedule`); await p.waitForSelector('table.gt');
    await p.waitForSelector('.est-warn', { timeout: 30000 }); await sleep(1600);
    pl = await P.get(core);
    const BAC = pl.tasks.reduce((a, t) => a + P.taskCost(t), 0), work = pl.tasks.filter((t) => t.dur > 0);
    ok('Auto (test site)', 'opening the sample plan on the test site fills in indicative costs by itself, once', !!pl.estAuto && work.every((t) => t.est && P.taskCost(t) > 0), pl.estAuto);
    ok('Auto (test site)', 'and the plan now totals about $1.21 billion (the benchmark), not a few thousand', Math.abs(BAC - 1210000000) / 1210000000 < 0.02, Math.round(BAC));
    const hrs = work.filter((t) => t.unit === 'h');
    ok('Basis', 'hourly work keeps realistic hours a day and rates (5 h/d at $220/h); lump sums take up the rest', hrs.length > 0 && hrs.every((t) => t.rate === 220) && work.some((t) => t.unit === 'lot' && t.rate > 1e7) && work.every((t) => t.basis), JSON.stringify(work.slice(0, 2).map((t) => [t.qty, t.unit, t.rate, t.basis])));
    const sent = seen[seen.length - 1];
    ok('Prompt', 'the AI is told: hours ACTUALLY worked per day (not 8), benchmarks, and the $1.21B target', /ACTUALLY worked/.test(sent.sys) && /Do not assume 8 hours/.test(sent.sys) && /1,210,000,000/.test(sent.sys) && /international/.test(sent.sys) && !/Dana/.test(JSON.stringify(sent.user)));
    const warn = await p.textContent('.est-warn');
    ok('Warning', 'a firm warning: reference benchmark only; 8-day feasibility may be 5 h a day; must review and change; complications', /reference benchmark only/.test(warn) && /5 hours a day, not 8/.test(warn) && /must review and change/.test(warn) && /complications/.test(warn), warn.slice(0, 200));
    await p.click('[data-estshow]'); await sleep(800);
    ok('Marked', 'each AI cost shows "≈ est" with its basis, and its boxes are dashed amber', (await p.$$('td.est-c .est-tag')).length === work.length && (await p.$$('input.est-in')).length === work.length * 3 && /consultant @ \$220\/h/.test(await p.getAttribute('td.est-c', 'title')));
    await p.goto(`${BASE}/admin/#plan/${core}/overview`); await sleep(800);
    ok('Overview', 'the Overview carries the same warning', !!(await p.$('.est-warn')));
    // reload: no second run
    const n0 = seen.length; await p.goto(`${BASE}/admin/#projects`); await sleep(300); await p.goto(`${BASE}/admin/#plan/${core}/schedule`); await p.waitForSelector('table.gt'); await sleep(2500);
    ok('Auto (test site)', 'it only happens once per plan', seen.length === n0);
    // quote guard
    const qb = await p.$('[data-qact=new]');
    if (qb) { await qb.click(); await p.waitForSelector('#qForm'); await sleep(300);
      ok('Quote', 'making a quote shows a red warning and needs "I have reviewed these costs" ticked first', /indicative AI benchmark costs/.test(await p.textContent('.est-q')) && await p.$eval('#qGo', (b) => b.disabled));
      await p.check('#qEstOk'); await sleep(200); ok('Quote', 'ticking it lets the quote be made', !(await p.$eval('#qGo', (b) => b.disabled)));
      await p.click('[data-close]'); await sleep(300); } else ok('Quote', 'quote button found', false);
    // edit one: reviewed
    const t1 = work[0];
    await p.fill(`tr[data-tid="${t1.id}"] [data-k=rate]`, '180'); await p.press(`tr[data-tid="${t1.id}"] [data-k=rate]`, 'Tab'); await sleep(1600);
    ok('Review', 'changing a task\'s Unit $ marks it reviewed (no ≈ est tag), the others stay marked', !(await P.get(core)).tasks.find((t) => t.id === t1.id).est && !(await p.$(`tr[data-tid="${t1.id}"] .est-tag`)) && (await p.$$('td.est-c')).length === work.length - 1);
    // charter note
    await p.goto(`${BASE}/admin/#plan/${core}/scope`); await p.waitForSelector('#chDoc'); await p.click('#chDoc'); await p.waitForSelector('#chDocx');
    const [d] = await Promise.all([p.waitForEvent('download'), p.click('#chDocx')]); const f = path.join(tmp, d.suggestedFilename()); await d.saveAs(f);
    const w = (await mammoth.extractRawText({ path: f })).value;
    ok('Charter', 'the charter\'s budget says how much is indicative benchmark cost, not yet reviewed', /of indicative benchmark costs on \d+ tasks, not yet reviewed/.test(w));
    await p.keyboard.press('Escape'); await sleep(300);
    // mark all reviewed
    await p.goto(`${BASE}/admin/#plan/${core}/schedule`); await p.waitForSelector('[data-estok]'); await p.click('[data-estok]'); await p.waitForSelector('#modal:not([hidden])');
    ok('Review', '"I have reviewed them all" asks first', /Only do this if you have checked all/.test(await p.textContent('#modal')));
    await p.click('#modal .btn-gold'); await sleep(1500);
    ok('Review', 'then the tags and warnings go', !(await p.$('.est-warn')) && !(await p.$('.est-tag')) && (await P.get(core)).tasks.every((t) => !t.est));

    // 2. a kitchen plan: the ✨ Indicative costs dialog, preview, tick to confirm, undo
    await mk(core2);
    pl = await P.get(core2); pl.tasks.forEach((t, i) => { if (i > 1 && i < 6) { t.qty = 0; t.rate = 0; t.mats = []; } }); pl.estAuto = 'x'; await P.save(core2, pl, pl.rev, 'test');
    const keep = pl.tasks.filter((t) => P.taskCost(t) > 0).map((t) => [t.id, P.taskCost(t)]);
    await p.goto(`${BASE}/admin/#projects`); await sleep(300); await p.goto(`${BASE}/admin/#plan/${core2}/schedule`); await p.waitForSelector('#estAi'); await sleep(600);
    await p.click('#estAi'); await p.waitForSelector('#estGo');
    ok('Dialog', 'the dialog warns first, and offers "tasks with no cost yet" (4) or also unreviewed AI costs', /reference benchmark only/i.test(await p.textContent('#modal')) && /4 tasks/.test(await p.textContent('.est-opts')) && !(await p.$('#estTgt')));
    await p.click('#estGo'); await p.waitForSelector('#estApply', { timeout: 30000 });
    ok('Preview', 'a preview lists each task with its basis, and Add is locked until you tick "I understand…"', (await p.$$('.est-tbl tbody tr')).length === 4 && await p.$eval('#estApply', (b) => b.disabled) && /8 d x 5 h\/d|d x 5 h\/d/.test(await p.textContent('.est-tbl')));
    await p.check('#estAck'); await p.click('#estApply'); await sleep(1600);
    let pk = await P.get(core2);
    ok('Apply', 'only the 4 tasks without a cost get one; your own costs are untouched', pk.tasks.filter((t) => t.est).length === 4 && keep.every(([id, c]) => P.taskCost(pk.tasks.find((t) => t.id === id)) === c));
    await p.click('[data-estundo]'); await sleep(1600);
    pk = await P.get(core2);
    ok('Undo', '↶ Undo puts the costs back as they were', pk.tasks.filter((t) => t.est).length === 0 && pk.tasks.filter((t) => P.taskCost(t) > 0).length === keep.length);
    // 3. the AI down: built-in benchmarks
    down = true;
    await p.click('#estAi'); await p.waitForSelector('#estGo'); await p.click('#estGo'); await p.waitForSelector('#estApply', { timeout: 30000 });
    const pv = await p.textContent('#modal');
    ok('Fallback', 'when the AI is down, the built-in benchmarks still give a starting point, and say so', /built-in benchmarks/.test(pv) && (await p.$$('.est-tbl tbody tr')).length === 4 && /h\/d/.test(pv));
    await p.screenshot({ path: path.join(os.tmpdir(), 'cost-preview.png') });
    await p.click('[data-close]'); down = false;
    await p.goto(`${BASE}/admin/#plan/${core}/schedule`); await sleep(1500);
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close(); br = null;
  } catch (e) { try { if (br) await br.close(); } catch {} ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ') + ' LOG: ' + log.slice(-400)); }
  try { srv.kill(); } catch {} try { await blobs.stop(); } catch {}
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  mock.close(); process.exit(0);
})();
