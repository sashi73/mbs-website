// v88: test site only: "🧪 Load 10 sample people" in People and "🧪 Make Guest logins for the sample people" in Users & access
// (role Guest: view Jobs & customers and Projects; one test password). Not offered, and refused, when it is not the test site.
// node guest-test.js <site> [xl] [notest]
// Checks the rows, sub-tasks, links (Predecessors), milestones, dates, and that no costs are exported. Real Blobs, Chromium.
// node gantt-export-test.js <site> [folder with node_modules/exceljs]
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const SITE = path.resolve(process.argv[2]);
const XL = path.resolve(process.argv[3] || path.join(__dirname, 'xl'));
const PORT = 8985, BASE = `http://127.0.0.1:${PORT}`;
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => results.push({ area, name, pass: !!pass, detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const csvParse = (s) => { const rows = []; let row = [], cur = '', q = false; for (let i = 0; i < s.length; i++) { const c = s[i]; if (q) { if (c === '"' && s[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; } else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; } else cur += c; } if (cur || row.length) { row.push(cur); rows.push(row); } return rows; };

(async () => {
  let ExcelJS = null; try { ExcelJS = require(require.resolve('exceljs', { paths: [XL, SITE] })); } catch {}
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-gu-blobs'); fs.rmSync(dir, { recursive: true, force: true });
  const blobs = new BlobsServer({ directory: dir, token: 'tok', port: 0 });
  const { port: bport } = await blobs.start();
  const ctxB64 = Buffer.from(JSON.stringify({ siteID: 'mbs', token: 'tok', edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, apiURL: `http://localhost:${bport}` })).toString('base64');
  process.env.NETLIFY_BLOBS_CONTEXT = ctxB64;
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NETLIFY_BLOBS_CONTEXT: ctxB64, ADMIN_USERNAME: 'sashi73', ADMIN_PASSWORD: 'sashi98', SITE_ENV: process.argv[4] === 'notest' ? '' : 'test', LLM_API_KEY: '', TELEGRAM_BOT_TOKEN: '', RESEND_API_KEY: '' };
  const srv = spawn('node', ['local-server.mjs'], { cwd: SITE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 40 && !/running/.test(log); i++) await sleep(150);
  let br = null;
  const tmp = path.join(os.tmpdir(), 'mbs-gu-files'); fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp);
  try {
    const J = await import(path.join(SITE, 'netlify/lib/jobs.mjs')), kv = await import(path.join(SITE, 'netlify/lib/kv.mjs')), P = await import(path.join(SITE, 'netlify/lib/plan.mjs'));
    const XL = path.resolve(process.argv[3] || path.join(__dirname, 'xl')); const mammoth = require(require.resolve('mammoth', { paths: [XL, SITE] }));
    const core = await J.nextCore('G');
    await J.create({ core, name: 'Rachel Raci', phone: '0400 101 202', email: '', suburb: 'Kellyville', service: 'Kitchen renovation', source: 'phone', summary: 'Kitchen renovation.' });
    br = await chromium.launch();
    const oc = await br.newContext({ viewport: { width: 1440, height: 900 } }), uc = await br.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await oc.newPage(), u = await uc.newPage(); p.setDefaultTimeout(20000); u.setDefaultTimeout(20000);
    const errors = []; errorsAll = errors; p.on('pageerror', (e) => errors.push('owner: ' + e.message)); u.on('pageerror', (e) => errors.push('guest: ' + e.message));
    const signIn = async (pg, user, pw) => { await pg.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' }); await pg.fill('[name=username]', user); await pg.fill('[name=password]', pw); await pg.click('#loginForm button'); };
    const api = (pg, a, b) => pg.evaluate(([a, b]) => window.MBS.api(a, b).then((r) => ({ ok: true, r }), (e) => ({ ok: false, e: e.message })), [a, b || {}]);
    await signIn(p, 'sashi73', 'sashi98'); await p.waitForSelector('#app:not([hidden])');
    if (process.argv[4] === 'notest') {
      await p.goto(`${BASE}/admin/#people`); await p.waitForSelector('#ppNew');
      ok('Live', 'not the test site: no "Load 10 sample people" button', !(await p.$('#ppSample')));
      let r = await api(p, 'pplSampleLoad'); ok('Live', 'and the server refuses it', !r.ok && /only be loaded on the test site/.test(r.e), r.e);
      r = await api(p, 'userGuestLoad', { personIds: ['P-001'] }); ok('Live', 'Guest logins are refused too', !r.ok && /only be made on the test site/.test(r.e), r.e);
      await p.goto(`${BASE}/admin/#users`); await p.waitForSelector('#usNew'); ok('Live', 'no "Make Guest logins" button', !(await p.$('#usGuest')));
    } else {
      await p.goto(`${BASE}/admin/#people`); await p.waitForSelector('#ppSample');
      await p.click('#ppSample'); await p.waitForFunction(() => document.querySelectorAll('tr[data-ppid]').length === 10, null, { timeout: 20000 });
      const rows = await p.$$eval('tr[data-ppid]', (r) => r.map((x) => x.textContent));
      ok('Sample', '"🧪 Load 10 sample people" adds 10 people: employees and contractors, roles, rates', rows.length === 10 && rows.some((x) => /Olivia Bennett.*Project director/.test(x)) && rows.some((x) => /Ben Nguyen.*Nguyen Plumbing/.test(x)) && rows.some((x) => /\$120/.test(x)));
      ok('Sample', 'with a mix of ticket states to test with (an expired licence, things due soon)', rows.some((x) => /Liam O'Connor.*Expired/.test(x)) && rows.some((x) => /Jack Morrison.*Due soon/.test(x)) && rows.some((x) => /Daniel Park.*Due soon/.test(x)));
      await p.click('#ppSample'); await sleep(1200);
      ok('Sample', 'pressing it again does not add them twice', (await p.$$('tr[data-ppid]')).length === 10);
      await p.goto(`${BASE}/admin/#users`); await p.waitForSelector('#usGuest');
      ok('Guest role', 'Users & access has a "Guest" role: view Jobs & customers and Projects, nothing else', await p.$$eval('.us-roles tbody tr', (r) => r.some((x) => /^Guest/.test(x.cells[0].textContent) && x.cells[1].textContent.includes('👁') && x.cells[2].textContent.includes('👁') && [3, 4, 5, 6, 7, 8].every((i) => x.cells[i].textContent.includes('–')))));
      await p.click('#usGuest'); await p.waitForSelector('.us-pw');
      const pw = (await p.textContent('.us-pw')).trim(), made = await p.$$eval('#modal tbody tr', (r) => r.length);
      ok('Guest logins', '"🧪 Make Guest logins" gives all 10 a Guest login with one test password', made === 10 && pw === 'GuestTest2026', pw + ' ' + made);
      await p.click('#modal [data-close]'); await sleep(500);
      ok('Guest logins', 'they are listed as Guest', (await p.$$eval('tr[data-uid]', (r) => r.filter((x) => /Guest/.test(x.textContent)).length)) === 10);
      await signIn(u, 'mei.chen@example.com', 'GuestTest2026'); await u.waitForSelector('#app:not([hidden])'); await sleep(800);
      const um = await u.$$eval('.side-nav [data-nav]', (x) => x.filter((e) => !e.hidden).map((e) => e.textContent.trim()));
      ok('Sign in', 'a sample person signs in straight away (no password change) and sees only Jobs & customers and Projects', !(await u.$('#pwF')) && um.some((x) => /Projects/.test(x)) && um.some((x) => /Jobs/.test(x)) && !um.some((x) => /Quotes|Inventory|Subbies|Employees|Users/.test(x)), um.join(' | '));
      let r = await api(u, 'acctLists'); const r2 = await api(u, 'pplSave', { person: { name: 'X' } }); ok('Sign in', 'and the server refuses the rest (Accounts, saving People)', !r.ok && !r2.ok);
      await p.click('#usGuest'); await sleep(800); ok('Guest logins', 'pressing it again makes no duplicates', (await p.$$eval('tr[data-uid]', (r) => r.length)) === 10);
      await p.screenshot({ path: path.join(os.tmpdir(), 'guest-users.png') });
    }
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close(); br = null;
  } catch (e) { try { if (br) await br.close(); } catch {} ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ') + ' LOG: ' + log.slice(-400)); }
  try { srv.kill(); } catch {} try { await blobs.stop(); } catch {}
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(0);
})();
