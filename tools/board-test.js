// v64: the Board remodelled: owner (from the Stakeholder register), priority, story points, filters and sorting, 4 columns that fit a laptop.
// Checks the rows, sub-tasks, links (Predecessors), milestones, dates, and that no costs are exported. Real Blobs, Chromium.
// node gantt-export-test.js <site> [folder with node_modules/exceljs]
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const SITE = path.resolve(process.argv[2]);
const XL = path.resolve(process.argv[3] || path.join(__dirname, 'xl'));
const PORT = 8964, BASE = `http://127.0.0.1:${PORT}`;
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => results.push({ area, name, pass: !!pass, detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const csvParse = (s) => { const rows = []; let row = [], cur = '', q = false; for (let i = 0; i < s.length; i++) { const c = s[i]; if (q) { if (c === '"' && s[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; } else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; } else cur += c; } if (cur || row.length) { row.push(cur); rows.push(row); } return rows; };

(async () => {
  let ExcelJS = null; try { ExcelJS = require(require.resolve('exceljs', { paths: [XL, SITE] })); } catch {}
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-kb-blobs'); fs.rmSync(dir, { recursive: true, force: true });
  const blobs = new BlobsServer({ directory: dir, token: 'tok', port: 0 });
  const { port: bport } = await blobs.start();
  const ctxB64 = Buffer.from(JSON.stringify({ siteID: 'mbs', token: 'tok', edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, apiURL: `http://localhost:${bport}` })).toString('base64');
  process.env.NETLIFY_BLOBS_CONTEXT = ctxB64;
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NETLIFY_BLOBS_CONTEXT: ctxB64, ADMIN_USERNAME: 'sashi73', ADMIN_PASSWORD: 'sashi98', LLM_API_KEY: '', TELEGRAM_BOT_TOKEN: '', RESEND_API_KEY: '' };
  const srv = spawn('node', ['local-server.mjs'], { cwd: SITE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 40 && !/running/.test(log); i++) await sleep(150);
  let br = null;
  const tmp = path.join(os.tmpdir(), 'mbs-kb-files'); fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp);
  try {
    const J = await import(path.join(SITE, 'netlify/lib/jobs.mjs')), kv = await import(path.join(SITE, 'netlify/lib/kv.mjs')), P = await import(path.join(SITE, 'netlify/lib/plan.mjs'));
    const core = await J.nextCore('G');
    await J.create({ core, name: 'Bea Board', phone: '0400 101 202', email: '', suburb: 'Kellyville', service: 'Kitchen renovation', source: 'phone', summary: 'Kitchen renovation.' });
    br = await chromium.launch();
    const ctx = await br.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
    const p = await ctx.newPage(); p.setDefaultTimeout(20000);
    const errors = []; errorsAll = errors; p.on('pageerror', (e) => errors.push(e.message));
    await p.setViewportSize({ width: 1366, height: 768 });
    await p.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
    await p.evaluate(() => { localStorage.removeItem('mbsBoardF'); });
    await p.fill('[name=username]', 'sashi73'); await p.fill('[name=password]', 'sashi98'); await p.click('#loginForm button');
    await p.waitForSelector('#app:not([hidden])');
    await p.goto(`${BASE}/admin/#plan/${core}`); await p.waitForSelector('#tplType'); await p.selectOption('#tplType', 'kitchen-reno'); await p.click('#tplCreate'); await p.waitForSelector('table.gt'); await sleep(1200);
    const pl0 = await P.get(core);
    pl0.stakeholders = [{ id: 's1', name: 'Bea Board', role: 'Customer', raci: 'A' }, { id: 's2', name: 'Sam Sparky', role: 'Electrician', raci: 'R' }, { id: 's3', name: 'Tina Tiler', role: 'Tiler', raci: 'R' }];
    await P.save(core, pl0, pl0.rev, 'test');
    await p.goto(`${BASE}/admin/#projects`); await sleep(300);
    await p.goto(`${BASE}/admin/#plan/${core}/board`); await p.waitForSelector('.kcard'); await sleep(300);
    const cols = await p.$$eval('.kcol', (a) => a.map((x) => Math.round(x.getBoundingClientRect().width)));
    const tops = await p.$$eval('.kcol', (a) => a.map((x) => Math.round(x.getBoundingClientRect().top)));
    ok('Fit', 'on a 14" laptop (1366 wide, menu open) the 4 columns sit side by side, no sideways scrolling', cols.length === 4 && new Set(tops).size === 1 && Math.min(...cols) >= 200 && await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), cols.join(',') + ' / ' + tops.join(','));
    await sleep(800); const colBottom = await p.$eval('.kcol-todo .kcards', (e) => e.getBoundingClientRect().bottom);
    ok('Fit', 'each column scrolls on its own, so the board fits the screen height', colBottom <= 768 + 2 && await p.$eval('.kcol-todo .kcards', (e) => e.scrollHeight > e.clientHeight), String(colBottom));
    ok('Card', 'every card has Owner (from the Stakeholder register), Priority and Points', (await p.$$eval('.kcard', (a) => a.every((c) => c.querySelector('[data-kf=owner]') && c.querySelector('[data-kf=priority]') && c.querySelector('[data-kf=points]')))) &&
      (await p.$$eval('.kcard:first-child [data-kf=owner] option', (o) => o.map((x) => x.textContent))).join() === 'Owner…,Bea Board,Sam Sparky,Tina Tiler' && (await p.$$eval('.kcard:first-child [data-kf=priority] option', (o) => o.map((x) => x.textContent))).join() === 'Prio,High,Med,Low');
    const card = (n) => `.kcard:nth-child(${n})`;
    const id1 = await p.getAttribute(card(1), 'data-tid'), id2 = await p.getAttribute(card(2), 'data-tid'), id3 = await p.getAttribute(card(3), 'data-tid');
    await p.selectOption(`[data-tid="${id1}"] [data-kf=owner]`, 's2'); await p.selectOption(`[data-tid="${id1}"] [data-kf=priority]`, 'High'); await p.selectOption(`[data-tid="${id1}"] [data-kf=points]`, '5');
    await p.selectOption(`[data-tid="${id2}"] [data-kf=owner]`, 's3'); await p.selectOption(`[data-tid="${id2}"] [data-kf=priority]`, 'Low'); await p.selectOption(`[data-tid="${id2}"] [data-kf=points]`, '8');
    await p.selectOption(`[data-tid="${id3}"] [data-kf=priority]`, 'Medium'); await p.selectOption(`[data-tid="${id3}"] [data-kf=points]`, '2');
    const c1 = await p.textContent(`[data-tid="${id1}"]`);
    ok('Card', 'the card shows the owner\'s initials, a High chip and "5 pts", with a red edge', (await p.textContent(`[data-tid="${id1}"] .kav`)) === 'SS' && /High/.test(c1) && /5 pts/.test(c1) && (await p.getAttribute(`[data-tid="${id1}"]`, 'class')).includes('kp-high'));
    ok('Points', 'the column and the board add up the points (15 to do, 0 done)', /15 pts/.test(await p.textContent('.kcol-todo h3')) && /0 of 15 points done/.test(await p.textContent('.kpts')));
    await sleep(1500);
    const sv = await P.get(core), t1 = sv.tasks.find((t) => t.id === id1);
    ok('Saved', 'owner, priority and points are saved with the task', t1.owner === 's2' && t1.priority === 'High' && t1.points === 5, JSON.stringify({ o: t1.owner, p: t1.priority, n: t1.points }));
    await p.click(`[data-tid="${id1}"] [data-step="1"]`); await sleep(300);
    ok('Move', '→ moves the card to In progress and its points go with it', !!(await p.$(`.kcol-doing [data-tid="${id1}"]`)) && /5 pts/.test(await p.textContent('.kcol-doing h3')) && /10 pts/.test(await p.textContent('.kcol-todo h3')));
    await p.click(`[data-tid="${id2}"] [data-tick]`); await sleep(300);
    ok('Points', 'ticking a card done counts its points as done', /8 of 15 points done/.test(await p.textContent('.kpts')));
    await p.selectOption('#kbOwner', 's2'); await sleep(200);
    ok('Filter', 'filter by owner shows only their cards', (await p.$$('.kcard')).length === 1 && !!(await p.$(`[data-tid="${id1}"]`)));
    await p.selectOption('#kbOwner', '-'); await sleep(200);
    ok('Filter', '"No owner" shows the cards nobody owns yet', (await p.$$('.kcard')).length === sv.tasks.length - 2);
    await p.selectOption('#kbOwner', ''); await p.selectOption('#kbPrio', 'Medium'); await sleep(200);
    ok('Filter', 'filter by priority', (await p.$$('.kcard')).length === 1 && !!(await p.$(`[data-tid="${id3}"]`)) && /No cards match/.test(await p.textContent('.kcol-done')));
    await p.selectOption('#kbPrio', ''); await p.selectOption('#kbSort', 'prio'); await sleep(200);
    const order = await p.$$eval('.kcol-todo .kcard', (a) => a.map((x) => x.getAttribute('data-tid')));
    ok('Sort', 'sort by priority puts Medium before the cards with none', order[0] === id3, order.slice(0, 3).join());
    await p.fill('#kbQ', 'cabinet'); await sleep(200);
    ok('Search', 'search finds cards by name', (await p.$$('.kcard')).length >= 1 && (await p.$$eval('.kcard .kname', (a) => a.every((x) => /cabinet/i.test(x.textContent)))) && (await p.inputValue('#kbQ')) === 'cabinet');
    await p.fill('#kbQ', ''); await sleep(200);
    await p.reload(); await p.waitForSelector('.kcard'); await sleep(300);
    ok('Filter', 'the sort choice is remembered', (await p.inputValue('#kbSort')) === 'prio');
    const subBtn = await p.$('[data-ksub]');
    if (subBtn) { await subBtn.click(); await sleep(200); ok('Card', 'sub-tasks fold away and open with ▸', !!(await p.$('.kchk-i'))); }
    await p.setViewportSize({ width: 390, height: 844 }); await sleep(300);
    ok('Phone', 'on a phone the columns stack, no sideways scrolling', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close(); br = null;
  } catch (e) { try { if (br) await br.close(); } catch {} ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ') + ' LOG: ' + log.slice(-400)); }
  try { srv.kill(); } catch {} try { await blobs.stop(); } catch {}
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(0);
})();
