// v91: 👷 sub-contractor logins. Users & access gives a subbie (from Subbies) a login to Projects only, for the projects ticked.
// They sign in with username, password and the project code; they see and work on that project only. Everything else (jobs,
// customers, people, other subbies, quotes, deleting the plan, data, users, downloads) is refused by the server.
// node subbie-login-test.js <site>
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const SITE = path.resolve(process.argv[2]);
const XL = path.resolve(process.argv[3] || path.join(__dirname, 'xl'));
const PORT = 8989, BASE = `http://127.0.0.1:${PORT}`;
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => results.push({ area, name, pass: !!pass, detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const csvParse = (s) => { const rows = []; let row = [], cur = '', q = false; for (let i = 0; i < s.length; i++) { const c = s[i]; if (q) { if (c === '"' && s[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; } else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; } else cur += c; } if (cur || row.length) { row.push(cur); rows.push(row); } return rows; };

(async () => {
  let ExcelJS = null; try { ExcelJS = require(require.resolve('exceljs', { paths: [XL, SITE] })); } catch {}
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-sl-blobs'); fs.rmSync(dir, { recursive: true, force: true });
  const blobs = new BlobsServer({ directory: dir, token: 'tok', port: 0 });
  const { port: bport } = await blobs.start();
  const ctxB64 = Buffer.from(JSON.stringify({ siteID: 'mbs', token: 'tok', edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, apiURL: `http://localhost:${bport}` })).toString('base64');
  process.env.NETLIFY_BLOBS_CONTEXT = ctxB64;
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NETLIFY_BLOBS_CONTEXT: ctxB64, ADMIN_USERNAME: 'sashi73', ADMIN_PASSWORD: 'sashi98', LLM_API_KEY: '', TELEGRAM_BOT_TOKEN: '', RESEND_API_KEY: '' };
  const srv = spawn('node', ['local-server.mjs'], { cwd: SITE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 40 && !/running/.test(log); i++) await sleep(150);
  let br = null;
  const tmp = path.join(os.tmpdir(), 'mbs-sl-files'); fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp);
  try {
    const J = await import(path.join(SITE, 'netlify/lib/jobs.mjs')), kv = await import(path.join(SITE, 'netlify/lib/kv.mjs')), P = await import(path.join(SITE, 'netlify/lib/plan.mjs'));
    const XL = path.resolve(process.argv[3] || path.join(__dirname, 'xl')); const mammoth = require(require.resolve('mammoth', { paths: [XL, SITE] }));
    const core = await J.nextCore('G');
    await J.create({ core, name: 'Rachel Raci', phone: '0400 101 202', email: '', suburb: 'Kellyville', service: 'Kitchen renovation', source: 'phone', summary: 'Kitchen renovation.' });
    const core2 = await J.nextCore('G');
    await J.create({ core: core2, name: 'Other Owner', phone: '0400 909 909', email: '', suburb: 'Epping', service: 'Bathroom renovation', source: 'phone', summary: 'Bathroom.' });
    const SUB = await import(path.join(SITE, 'netlify/lib/subbies.mjs'));
    const sc = (await SUB.saveSub({ business: 'Nguyen Plumbing', contact: 'Ben Nguyen', email: 'ben@nguyenplumbing.example', phone: '0400 222 333', trade: 'plumber', status: 'Approved' }, 'test')).sub;
    br = await chromium.launch();
    const oc = await br.newContext({ viewport: { width: 1440, height: 900 } }), sx = await br.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await oc.newPage(), s = await sx.newPage(); p.setDefaultTimeout(20000); s.setDefaultTimeout(20000);
    const errors = []; errorsAll = errors; p.on('pageerror', (e) => errors.push('owner: ' + e.message)); s.on('pageerror', (e) => errors.push('subbie: ' + e.message));
    const api = (pg, a, b) => pg.evaluate(([a, b]) => window.MBS.api(a, b).then((r) => ({ ok: true, r }), (e) => ({ ok: false, e: e.message })), [a, b || {}]);
    await p.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
    await p.fill('[name=username]', 'sashi73'); await p.fill('[name=password]', 'sashi98'); await p.click('#loginForm button'); await p.waitForSelector('#app:not([hidden])');
    const mk = async (c) => { await p.goto(`${BASE}/admin/#plan/${c}`); await p.waitForSelector('#tplType'); await p.selectOption('#tplType', 'kitchen-reno'); await p.click('#tplCreate'); await p.waitForSelector('table.gt'); await sleep(1200); };
    await mk(core); await mk(core2);
    const plans = (await api(p, 'planList', {})).r.plans, ref1 = plans.find((x) => x.core === core).ref, ref2 = plans.find((x) => x.core === core2).ref;

    // 1. Users & access: a sub-contractor login
    await p.goto(`${BASE}/admin/#users`); await p.waitForSelector('#usNewSub');
    await p.click('#usNewSub'); await p.waitForSelector('#usSub');
    ok('Users', '"👷 Sub-contractor login" picks from Subbies and lists the projects with their codes', /Nguyen Plumbing/.test(await p.textContent('#usSub')) && (await p.$$('#usProjs input')).length === 2 && (await p.textContent('#usProjs')).includes(ref1));
    await p.selectOption('#usSub', sc.id);
    ok('Users', 'the username defaults to the subbie\'s email', (await p.inputValue('#usName')) === 'ben@nguyenplumbing.example');
    await p.click('#usSave'); await sleep(500);
    ok('Users', 'at least one project is needed', !!(await p.$('#usSub')));
    await p.check(`#usProjs input[value="${core}"]`); await p.click('#usSave'); await p.waitForSelector('#usTemp');
    const temp = (await p.textContent('#usTemp')).trim(), info = await p.textContent('#modal');
    ok('Users', 'the login is made: temporary password, and the project code they sign in with', /^[a-z]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/.test(temp) && info.includes(ref1) && !info.includes(ref2), info);
    await p.click('#modal [data-close]'); await sleep(500);
    const row = await p.textContent('tr[data-uid]');
    ok('Users', 'listed as a 👷 Sub-contractor with its project; Projects is its only module', /Sub-contractor/.test(row) && row.includes(ref1) && await p.$eval('tr[data-uid]', (tr) => [...tr.querySelectorAll('.us-lv')].map((x) => x.textContent).join('') === '–✎––––––'));
    const pr = await api(p, 'userSave', { user: { personId: 'P-001', role: 'Sub-contractor' } });
    ok('Users', 'the role "Sub-contractor" is only for subbies', !pr.ok);

    // 2. the subbie signs in: username + password, then the project code
    await s.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
    ok('Sign in', 'the sign-in page has no project code box at first', await s.isHidden('#loginProj'));
    await s.fill('[name=username]', 'ben@nguyenplumbing.example'); await s.fill('[name=password]', temp); await s.click('#loginForm button'); await s.waitForSelector('#loginProj:not([hidden])');
    ok('Sign in', 'for a sub-contractor it then asks for the project code', /enter your project code/.test(await s.textContent('#loginMsg')));
    await s.fill('[name=project]', ref2); await s.click('#loginForm button'); await sleep(800);
    ok('Sign in', 'another project\'s code is refused', /not one of your projects/.test(await s.textContent('#loginMsg')) && await s.isHidden('#app'));
    await s.fill('[name=project]', ref1.toLowerCase()); await s.click('#loginForm button'); await s.waitForSelector('#pwF');
    await s.fill('#pwF [name=old]', temp); await s.fill('#pwF [name=pw]', 'Plumber2026x'); await s.fill('#pwF [name=pw2]', 'Plumber2026x'); await s.click('#pwF button[type=submit]');
    await s.waitForSelector('#planTabs', { timeout: 30000 }); await sleep(1500);
    ok('Project', 'with their own code they land straight on that project', s.url().includes(`#plan/${core}/`) && (await s.textContent('#view')).includes('Kitchen'), s.url());
    const menu = await s.$$eval('.side-nav [data-nav]', (x) => x.filter((e) => !e.hidden).map((e) => e.textContent.trim()));
    ok('Project', 'the menu shows Projects only; no job search or New job', menu.length === 1 && /Projects/.test(menu[0]) && await s.isHidden('#q') && await s.isHidden('.top-new'), menu.join('|'));
    ok('Project', 'no money or customer links on the plan: no Delete plan, Quote, or link to the job', await s.isHidden('#planDel') && await s.isHidden('#planQuote') && !(await s.$(`a[href="#job/${core}"]`)) && /Signed in as a sub-contractor/.test(await s.textContent('.plan-subbie')));
    await s.screenshot({ path: path.join(os.tmpdir(), 'subbie-login.png') });
    await s.evaluate(() => { window.__errs = []; new MutationObserver(() => { const t = document.getElementById('toast'); if (/show/.test(t.className) && /err/.test(t.className)) window.__errs.push(t.textContent); }).observe(document.getElementById('toast'), { attributes: true, childList: true }); });
    for (const t of ['overview', 'board', 'bom', 'stake', 'scope', 'risks', 'issues', 'contracts', 'comms', 'reports', 'swms', 'change', 'intel', 'critical', 'schedule']) { await s.click(`#planTabs a[href$="/${t}"]`); await sleep(1100); }
    await s.waitForSelector('table.gt');
    const terr = await s.evaluate(() => window.__errs);
    ok('Project', 'they can open every tab of their project (Schedule, Board, BOM, Stakeholders, Contracts, SWMS, Reports …) without errors or "no access" messages', !terr.length && errors.length === 0, terr.concat(errors).join(' | '));
    // 3. the server keeps them to their project
    let r = await api(s, 'planList', {});
    ok('Server', 'the project list has only their project', r.ok && r.r.plans.length === 1 && r.r.plans[0].core === core);
    r = await api(s, 'planGet', { core: core2 }); ok('Server', 'another project is refused', !r.ok && /own project/.test(r.e), r.e);
    const blocked = [];
    for (const [a, b] of [['jobs', {}], ['pplList', {}], ['subList', {}], ['custList', {}], ['planDelete', { core }], ['planQuote', { core }], ['planQuoteInfo', { core }], ['job', { core }], ['dataList', {}], ['userList', {}], ['invSave', { item: { name: 'x' } }], ['planJobs', {}]]) { const x = await api(s, a, b); if (x.ok) blocked.push(a); }
    ok('Server', 'everything else is refused: jobs, customers, people, other subbies, quotes, deleting the plan, data, users, stock changes', blocked.length === 0, blocked.join(', '));
    const g = await s.evaluate((u) => fetch(u, { credentials: 'same-origin' }).then((x) => x.status), `${BASE}/.netlify/functions/admin?action=export`);
    ok('Server', 'and the downloads (job export, backups)', g === 403, String(g));
    const pg = (await api(s, 'planGet', { core })).r; const pl0 = pg.plan; pl0.tasks[0].pct = 50;
    r = await api(s, 'planSave', { core, plan: pl0, rev: pl0.rev, note: 'subbie' });
    ok('Manage', 'they can update their own project (progress saved)', r.ok && (await P.get(core)).tasks[0].pct === 50, r.e);
    // 4. view only, then the project taken away: signed out straight away
    const uid = (await api(p, 'userList')).r.users[0].id;
    r = await api(p, 'userSave', { user: { id: uid, projects: [core], level: 'view' } });
    r = await api(s, 'planGet', { core }); ok('Changes', 'changing their access signs them out straight away', !r.ok && /(sign|log) in again/i.test(r.e), r.e);
    await s.goto(`${BASE}/admin/`); await s.waitForSelector('#loginForm'); await s.fill('[name=username]', 'ben@nguyenplumbing.example'); await s.fill('[name=password]', 'Plumber2026x'); await s.click('#loginForm button'); await s.waitForSelector('#loginProj:not([hidden])');
    await s.fill('[name=project]', ref1); await s.click('#loginForm button'); await s.waitForSelector('#planTabs'); await sleep(800);
    r = await api(s, 'planSave', { core, plan: (await api(s, 'planGet', { core })).r.plan, rev: (await P.get(core)).rev });
    ok('Changes', 'view only: they can look but not change the plan', !r.ok && /view-only/.test(r.e), r.e);
    await SUB.saveSub({ ...(await SUB.getSub(sc.id)), status: 'Do not use' }, 'test');
    r = await api(s, 'planGet', { core }); ok('Changes', 'marking the subbie "Do not use" in Subbies stops the login', !r.ok);
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close(); br = null;
  } catch (e) { try { if (br) await br.close(); } catch {} ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ') + ' LOG: ' + log.slice(-400)); }
  try { srv.kill(); } catch {} try { await blobs.stop(); } catch {}
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(0);
})();
