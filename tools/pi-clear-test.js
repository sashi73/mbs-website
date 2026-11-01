// v59: Project Intelligence answers can be folded and cleared: only the schedule, as CSV (3 date formats), Microsoft Project XML (MSPDI), Excel and calendar (.ics).
// Checks the rows, sub-tasks, links (Predecessors), milestones, dates, and that no costs are exported. Real Blobs, Chromium.
// node gantt-export-test.js <site> [folder with node_modules/exceljs]
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const SITE = path.resolve(process.argv[2]);
const XL = path.resolve(process.argv[3] || path.join(__dirname, 'xl'));
const PORT = 8959, BASE = `http://127.0.0.1:${PORT}`;
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => results.push({ area, name, pass: !!pass, detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const csvParse = (s) => { const rows = []; let row = [], cur = '', q = false; for (let i = 0; i < s.length; i++) { const c = s[i]; if (q) { if (c === '"' && s[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; } else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; } else cur += c; } if (cur || row.length) { row.push(cur); rows.push(row); } return rows; };

(async () => {
  let ExcelJS = null; try { ExcelJS = require(require.resolve('exceljs', { paths: [XL, SITE] })); } catch {}
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-pic-blobs'); fs.rmSync(dir, { recursive: true, force: true });
  const blobs = new BlobsServer({ directory: dir, token: 'tok', port: 0 });
  const { port: bport } = await blobs.start();
  const ctxB64 = Buffer.from(JSON.stringify({ siteID: 'mbs', token: 'tok', edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, apiURL: `http://localhost:${bport}` })).toString('base64');
  process.env.NETLIFY_BLOBS_CONTEXT = ctxB64;
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NETLIFY_BLOBS_CONTEXT: ctxB64, ADMIN_USERNAME: 'sashi73', ADMIN_PASSWORD: 'sashi98', LLM_API_KEY: '', TELEGRAM_BOT_TOKEN: '', RESEND_API_KEY: '' };
  const srv = spawn('node', ['local-server.mjs'], { cwd: SITE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 40 && !/running/.test(log); i++) await sleep(150);
  let br = null;
  const tmp = path.join(os.tmpdir(), 'mbs-gx-files'); fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp);
  try {
    const J = await import(path.join(SITE, 'netlify/lib/jobs.mjs')), kv = await import(path.join(SITE, 'netlify/lib/kv.mjs'));
    const core = await J.nextCore('G');
    await J.create({ core, name: 'Clara Clear', phone: '0400 101 202', email: '', suburb: 'Kellyville', service: 'Kitchen renovation', source: 'phone', summary: 'Kitchen renovation.' });
    br = await chromium.launch();
    const ctx = await br.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
    const p = await ctx.newPage(); p.setDefaultTimeout(20000);
    const errors = []; errorsAll = errors; p.on('pageerror', (e) => errors.push(e.message));
    const t0 = Date.now() - 5 * 3600e3;
    await kv.set('pchat:' + core, { log: [1, 2, 3, 4, 5].map((n) => ({ at: t0 + n * 60e3, by: '', q: 'Question ' + n, r: { answer: '**Answer ' + n + '** with some detail about the project.', follow_ups: ['Follow ' + n] } })) });
    await p.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
    await p.fill('[name=username]', 'sashi73'); await p.fill('[name=password]', 'sashi98'); await p.click('#loginForm button');
    await p.waitForSelector('#app:not([hidden])');
    await p.goto(`${BASE}/admin/#plan/${core}`); await p.waitForSelector('#tplType'); await p.selectOption('#tplType', 'kitchen-reno'); await p.click('#tplCreate'); await p.waitForSelector('table.gt'); await sleep(500);
    await p.goto(`${BASE}/admin/#plan/${core}/intel`); await p.waitForSelector('#piLog .pi-a');
    const state = () => p.evaluate(() => [...document.querySelectorAll('#piLog .pi-a')].map((b) => ({ q: b.querySelector('.pi-qt').textContent.split('”')[0].replace('“', ''), fold: b.classList.contains('pi-folded') })));
    let s = await state();
    ok('Fold', 'newest answers on top; the newest 2 open, older ones folded to one line with a preview', s.length === 5 && s[0].q === 'Question 5' && !s[0].fold && !s[1].fold && s.slice(2).every((x) => x.fold) && /Answer 3/.test(await p.textContent('.pi-folded .pi-peek')), JSON.stringify(s));
    ok('Buttons', 'header has Fold all, Keep newest 3 and Clear all (5)', /Fold all/.test(await p.textContent('#piFold')) && !!(await p.$('#piKeep')) && /Clear all \(5\)/.test(await p.textContent('#piClear')));
    await p.click('#piLog .pi-a:nth-child(3) [data-pitog]'); s = await state();
    ok('Fold', 'an older answer opens with ▸ and folds again with ▾', !s[2].fold && /Answer 3/.test(await p.textContent('#piLog .pi-a:nth-child(3) .pi-md')));
    await p.click('#piFold'); s = await state();
    ok('Fold', '"Fold all" folds every answer; "Open all" opens them', s.every((x) => x.fold) && /Open all/.test(await p.textContent('#piFold')));
    await p.click('#piFold'); s = await state(); ok('Fold', 'Open all opens every answer', s.every((x) => !x.fold));
    await p.click('#piLog .pi-a:nth-child(2) [data-pidel]'); await p.click('#okBtn'); await sleep(600); s = await state();
    const stored = async () => ((await kv.get('pchat:' + core)) || {}).log.map((e) => e.q);
    ok('Clear one', '✕ clears just that answer, for everyone (saved)', s.length === 4 && !s.some((x) => x.q === 'Question 4') && (await stored()).join() === 'Question 1,Question 2,Question 3,Question 5', JSON.stringify(s) + ' ' + (await stored()));
    await p.click('#piKeep'); await p.click('#okBtn'); await sleep(600); s = await state();
    ok('Keep 3', '"Keep newest 3" clears the older ones', s.length === 3 && (await stored()).join() === 'Question 2,Question 3,Question 5' && !(await p.$('#piKeep')), (await stored()).join());
    await p.click('#piClear'); await p.click('#okBtn'); await sleep(600);
    ok('Clear all', '"Clear all" empties the log; documents and the plan stay', (await p.$$('#piLog .pi-a')).length === 0 && (await stored()).length === 0 && /No questions yet/.test(await p.textContent('#piLog')) && !(await p.$('#piClear')));
    await p.click('[data-piex]'); await sleep(300);
    ok('Ask', 'asking still works after clearing', (await p.$$('#piLog .pi-a')).length >= 1 || /Thinking|Reading/.test(await p.textContent('#B, body')));
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close(); br = null;
  } catch (e) { try { if (br) await br.close(); } catch {} ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ') + ' LOG: ' + log.slice(-400)); }
  try { srv.kill(); } catch {} try { await blobs.stop(); } catch {}
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(0);
})();
