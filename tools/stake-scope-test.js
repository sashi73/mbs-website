// v79: stakeholders are identified before the scope: a "Key step" section in the Scope tab just before Scope, a firm warning
// when there are none (what the project could suffer), quick add, the sign-off checklist, and the charter lists them before In scope.
// Checks the rows, sub-tasks, links (Predecessors), milestones, dates, and that no costs are exported. Real Blobs, Chromium.
// node gantt-export-test.js <site> [folder with node_modules/exceljs]
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const SITE = path.resolve(process.argv[2]);
const XL = path.resolve(process.argv[3] || path.join(__dirname, 'xl'));
const PORT = 8978, BASE = `http://127.0.0.1:${PORT}`;
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => results.push({ area, name, pass: !!pass, detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const csvParse = (s) => { const rows = []; let row = [], cur = '', q = false; for (let i = 0; i < s.length; i++) { const c = s[i]; if (q) { if (c === '"' && s[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; } else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; } else cur += c; } if (cur || row.length) { row.push(cur); rows.push(row); } return rows; };

(async () => {
  let ExcelJS = null; try { ExcelJS = require(require.resolve('exceljs', { paths: [XL, SITE] })); } catch {}
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-ss-blobs'); fs.rmSync(dir, { recursive: true, force: true });
  const blobs = new BlobsServer({ directory: dir, token: 'tok', port: 0 });
  const { port: bport } = await blobs.start();
  const ctxB64 = Buffer.from(JSON.stringify({ siteID: 'mbs', token: 'tok', edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, apiURL: `http://localhost:${bport}` })).toString('base64');
  process.env.NETLIFY_BLOBS_CONTEXT = ctxB64;
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NETLIFY_BLOBS_CONTEXT: ctxB64, ADMIN_USERNAME: 'sashi73', ADMIN_PASSWORD: 'sashi98', LLM_API_KEY: '', TELEGRAM_BOT_TOKEN: '', RESEND_API_KEY: '' };
  const srv = spawn('node', ['local-server.mjs'], { cwd: SITE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 40 && !/running/.test(log); i++) await sleep(150);
  let br = null;
  const tmp = path.join(os.tmpdir(), 'mbs-ss-files'); fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp);
  try {
    const J = await import(path.join(SITE, 'netlify/lib/jobs.mjs')), kv = await import(path.join(SITE, 'netlify/lib/kv.mjs')), P = await import(path.join(SITE, 'netlify/lib/plan.mjs'));
    const XL = path.resolve(process.argv[3] || path.join(__dirname, 'xl')); const mammoth = require(require.resolve('mammoth', { paths: [XL, SITE] }));
    const core = await J.nextCore('G');
    await J.create({ core, name: 'Rachel Raci', phone: '0400 101 202', email: '', suburb: 'Kellyville', service: 'Kitchen renovation', source: 'phone', summary: 'Kitchen renovation.' });
    br = await chromium.launch();
    const ctx = await br.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const p = await ctx.newPage(); p.setDefaultTimeout(20000);
    const errors = []; errorsAll = errors; p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
    await p.fill('[name=username]', 'sashi73'); await p.fill('[name=password]', 'sashi98'); await p.click('#loginForm button'); await p.waitForSelector('#app:not([hidden])');
    await p.goto(`${BASE}/admin/#plan/${core}`); await p.waitForSelector('#tplType'); await p.selectOption('#tplType', 'kitchen-reno'); await p.click('#tplCreate'); await p.waitForSelector('table.gt'); await sleep(1200);
    await p.goto(`${BASE}/admin/#plan/${core}/overview`); await p.waitForSelector('.su');
    const su = await p.$$eval('.su-l li', (l) => l.map((x) => [x.className, x.textContent]));
    ok('Overview', 'the Overview shows "Plan set-up: do these in order", step 1 Identify the stakeholders, marked Start here and highlighted', su.length === 5 && /Identify the stakeholders/.test(su[0][1]) && /Start here/.test(su[0][1]) && su[0][0] === 'now' && /Agree the scope/.test(su[1][1]) && /Why stakeholders first\?/.test(await p.textContent('.su')), JSON.stringify(su.map((x) => x[1].slice(0, 40))));
    await (await p.$('.su')).screenshot({ path: path.join(os.tmpdir(), 'overview-steps.png') });
    await p.click('.su-l li.now a'); await p.waitForSelector('#addStake');
    ok('Overview', 'clicking it opens the Stakeholders tab', /\/stake$/.test(p.url()));
    await p.goto(`${BASE}/admin/#plan/${core}/scope`); await p.waitForSelector('#chDoc');
    const heads = await p.$$eval('.chs-h h3', (h) => h.map((x) => x.textContent));
    const iS = heads.findIndex((x) => /^Stakeholders/.test(x)), iScope = heads.indexOf('Scope');
    ok('Order', 'a Stakeholders section comes just before Scope, marked "Key step"', iS > 0 && iScope === iS + 1 && /Key step/.test(await p.textContent('.chs:has(.ch-skadd) .chs-h')), JSON.stringify(heads));
    await (await p.$('.chs:has(.ch-skadd)')).screenshot({ path: path.join(os.tmpdir(), 'stake-scope-empty.png') });
    const w0 = await p.textContent('.ch-skwarn');
    ok('Warning', 'with none: "Without identifying stakeholders, the project could:" and what could go wrong', /Do this before you write the scope/.test(w0) && /Without identifying stakeholders, the project could/.test(w0) && (await p.$$('.ch-skwarn li')).length === 6 && /scope creep/.test(w0) && /nobody Accountable/.test(w0));
    ok('Warning', 'and the Scope section reminds you to identify them first', /Identify the stakeholders first/.test(await p.textContent('.ch-skfirst')));
    ok('Checklist', 'the sign-off checklist has "Stakeholders identified (before scope)", not ticked, ahead of In scope', await p.$$eval('.ch-list li', (l) => { const t = l.map((x) => x.textContent); const i = t.findIndex((x) => /Stakeholders identified \(before scope\)/.test(x)); return i > 0 && !/✓/.test(t[i]) && i < t.findIndex((x) => /In scope/.test(x)); }));
    await p.click('[data-skcust]'); await sleep(300);
    await p.click('[data-skrole="Certifier"]'); await sleep(300);
    await p.fill('#chSkName', 'Sam Ortega'); await p.fill('#chSkRole', 'Electrician'); await p.selectOption('#chSkRaci', 'R'); await p.press('#chSkName', 'Enter'); await sleep(1500);
    const sv = (await P.get(core)).stakeholders;
    ok('Add', 'quick add: the customer (Accountable, with their contact), a Certifier chip, and a typed name, saved to the register', sv.length === 3 && sv[0].name === 'Rachel Raci' && sv[0].raci === 'A' && sv[0].phone && sv[1].role === 'Certifier' && sv[1].raci === 'C' && sv[2].name === 'Sam Ortega' && sv[2].raci === 'R', JSON.stringify(sv));
    ok('Listed', 'the section now lists them with their RACI, the warning has gone, and the checklist ticks', (await p.$$('.ch-sk')).length === 3 && !(await p.$('.ch-skwarn')) && !(await p.$('.ch-skfirst')) && await p.$$eval('.ch-list li', (l) => l.some((x) => /Stakeholders identified/.test(x.textContent) && x.classList.contains('ok')) && l.some((x) => /One person Accountable/.test(x.textContent) && x.classList.contains('ok'))));
    ok('Focus', 'the name box is ready for the next one', await p.evaluate(() => document.activeElement && document.activeElement.id === 'chSkName'));
    await p.screenshot({ path: path.join(os.tmpdir(), 'stake-scope.png') });
    await p.goto(`${BASE}/admin/#plan/${core}/stake`); await p.waitForSelector('#addStake');
    ok('Register', 'they are on the Stakeholders tab too', (await p.$$('tr[data-sid]')).length === 3);
    await p.goto(`${BASE}/admin/#plan/${core}/scope`); await p.waitForSelector('#chDoc'); await p.click('#chDoc'); await p.waitForSelector('#chDocx');
    const [d] = await Promise.all([p.waitForEvent('download'), p.click('#chDocx')]); const f = path.join(tmp, d.suggestedFilename()); await d.saveAs(f);
    const w = (await mammoth.extractRawText({ path: f })).value, body0 = w.slice(w.indexOf('1. Project at a glance'));
    ok('Charter', 'the charter lists the stakeholder register before In scope', body0.indexOf('Stakeholder register') > 0 && body0.indexOf('Stakeholder register') < body0.indexOf('In scope') && /Certifier/.test(w));
    await p.goto(`${BASE}/admin/#plan/${core}/overview`); await p.waitForSelector('.su');
    const su2 = await p.$$eval('.su-l li', (l) => l.map((x) => x.className));
    ok('Overview', 'once stakeholders are in (one Accountable), step 1 ticks and the next step is highlighted', su2[0] === 'ok' && su2.indexOf('now') > 0 && !(await p.$('.su-why')), JSON.stringify(su2));
    const tabs = await p.$$eval('#planTabs .tab', (t) => t.map((x) => x.textContent.trim()));
    ok('Tabs', 'the 👥 Stakeholders tab comes just before 🎯 Scope', tabs.indexOf('👥 Stakeholders') >= 0 && tabs.indexOf('🎯 Scope') === tabs.indexOf('👥 Stakeholders') + 1, JSON.stringify(tabs));
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close(); br = null;
  } catch (e) { try { if (br) await br.close(); } catch {} ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ') + ' LOG: ' + log.slice(-400)); }
  try { srv.kill(); } catch {} try { await blobs.stop(); } catch {}
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(0);
})();
