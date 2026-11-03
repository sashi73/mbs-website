// v86: 🔐 Users & access. Only people in People can get a login; a temporary password they must change; roles with None / View /
// Edit per module, enforced by the server (and the menu hides the rest); a change of access, disabling, a reset or archiving the
// person signs them out; the Owner (the Netlify login) always gets in.
// Checks the rows, sub-tasks, links (Predecessors), milestones, dates, and that no costs are exported. Real Blobs, Chromium.
// node gantt-export-test.js <site> [folder with node_modules/exceljs]
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const SITE = path.resolve(process.argv[2]);
const XL = path.resolve(process.argv[3] || path.join(__dirname, 'xl'));
const PORT = 8983, BASE = `http://127.0.0.1:${PORT}`;
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => results.push({ area, name, pass: !!pass, detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const csvParse = (s) => { const rows = []; let row = [], cur = '', q = false; for (let i = 0; i < s.length; i++) { const c = s[i]; if (q) { if (c === '"' && s[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; } else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; } else cur += c; } if (cur || row.length) { row.push(cur); rows.push(row); } return rows; };

(async () => {
  let ExcelJS = null; try { ExcelJS = require(require.resolve('exceljs', { paths: [XL, SITE] })); } catch {}
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-ac-blobs'); fs.rmSync(dir, { recursive: true, force: true });
  const blobs = new BlobsServer({ directory: dir, token: 'tok', port: 0 });
  const { port: bport } = await blobs.start();
  const ctxB64 = Buffer.from(JSON.stringify({ siteID: 'mbs', token: 'tok', edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, apiURL: `http://localhost:${bport}` })).toString('base64');
  process.env.NETLIFY_BLOBS_CONTEXT = ctxB64;
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NETLIFY_BLOBS_CONTEXT: ctxB64, ADMIN_USERNAME: 'sashi73', ADMIN_PASSWORD: 'sashi98', LLM_API_KEY: '', TELEGRAM_BOT_TOKEN: '', RESEND_API_KEY: '' };
  const srv = spawn('node', ['local-server.mjs'], { cwd: SITE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 40 && !/running/.test(log); i++) await sleep(150);
  let br = null;
  const tmp = path.join(os.tmpdir(), 'mbs-ac-files'); fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp);
  try {
    const J = await import(path.join(SITE, 'netlify/lib/jobs.mjs')), kv = await import(path.join(SITE, 'netlify/lib/kv.mjs')), P = await import(path.join(SITE, 'netlify/lib/plan.mjs'));
    const XL = path.resolve(process.argv[3] || path.join(__dirname, 'xl')); const mammoth = require(require.resolve('mammoth', { paths: [XL, SITE] }));
    const core = await J.nextCore('G');
    await J.create({ core, name: 'Rachel Raci', phone: '0400 101 202', email: '', suburb: 'Kellyville', service: 'Kitchen renovation', source: 'phone', summary: 'Kitchen renovation.' });
    br = await chromium.launch();
    const oc = await br.newContext({ viewport: { width: 1440, height: 900 } }), uc = await br.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await oc.newPage(), u = await uc.newPage(); p.setDefaultTimeout(20000); u.setDefaultTimeout(20000);
    const errors = []; errorsAll = errors; p.on('pageerror', (e) => errors.push('owner: ' + e.message)); u.on('pageerror', (e) => errors.push('user: ' + e.message));
    const signIn = async (pg, user, pw) => { await pg.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' }); await pg.fill('[name=username]', user); await pg.fill('[name=password]', pw); await pg.click('#loginForm button'); };
    await signIn(p, 'sashi73', 'sashi98'); await p.waitForSelector('#app:not([hidden])');
    const api = (pg, a, b) => pg.evaluate(([a, b]) => window.MBS.api(a, b).then((r) => ({ ok: true, r }), (e) => ({ ok: false, e: e.message })), [a, b || {}]);
    // the team
    await api(p, 'pplSave', { person: { type: 'Employee', name: 'Priya Shah', role: 'Project manager', email: 'priya@example.com', tickets: { whiteCard: { number: 'W1' } } } });
    await api(p, 'pplSave', { person: { type: 'Employee', name: 'Sam Ortega', role: 'Tradesperson', email: 'sam@example.com' } });
    await api(p, 'pplSave', { person: { type: 'Contractor', name: 'Lee Tran', role: 'Site supervisor' } });
    await p.goto(`${BASE}/admin/#users`); await p.waitForSelector('#usNew');
    ok('Page', 'Users & access: the Owner row (full access), no logins yet, and the roles table', /Owner/.test(await p.textContent('.us-owner')) && /No logins yet/.test(await p.textContent('#view')) && (await p.$$('.us-roles tbody tr')).length === 5);
    await p.click('#usNew'); await p.waitForSelector('#usPerson');
    const po = await p.$$eval('#usPerson option', (o) => o.map((x) => x.textContent));
    ok('Only People', 'only people in the People register can be picked', po.length === 4 && po.some((x) => /Priya Shah · Project manager/.test(x)) && po.some((x) => /Lee Tran.*no email/.test(x)));
    await p.selectOption('#usPerson', 'P-001'); await sleep(100);
    ok('New login', 'the username fills in with their email', (await p.inputValue('#usName')) === 'priya@example.com');
    await p.selectOption('#usRole', 'Project manager'); await sleep(100);
    ok('Roles', 'picking a role sets each module (Project manager: Projects edit, Accounts view, Users none)', await p.$eval('[name=um_projects][value=edit]', (x) => x.checked) && await p.$eval('[name=um_accounts][value=view]', (x) => x.checked) && await p.$eval('[name=um_users][value=none]', (x) => x.checked));
    await p.check('[name=um_people][value=edit]'); await sleep(50);
    ok('Roles', 'changing a module turns the role into Custom', (await p.inputValue('#usRole')) === 'Custom');
    await p.selectOption('#usRole', 'Project manager');
    await p.click('#usSave'); await p.waitForSelector('#usTemp');
    const temp = (await p.textContent('#usTemp')).trim();
    ok('Temporary password', 'a temporary password is shown once (xxxx-xxxx-xxxx)', /^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/.test(temp), temp);
    const AL = await import(path.join(SITE, 'netlify/lib/admin-lib.mjs')), adm = await AL.store(AL.ADMIN), rec = await adm.get('user:U-001', { type: 'json' });
    const dl = await api(p, 'dataList', { store: 'mbs-jobs' });
    ok('Stored safely', 'logins live in the private admin store: the Data explorer can\'t list them', dl.ok && !dl.r.rows.some((x) => /^user/.test(x.key || x)), JSON.stringify((dl.r && dl.r.rows || []).slice(0, 3)));
    ok('Stored safely', 'the password is stored hashed (scrypt with a salt), never as text', rec && rec.hash && rec.salt && !JSON.stringify(rec).includes(temp) && rec.mustChange === true && rec.personId === 'P-001');
    await p.click('#modal [data-close]'); await sleep(300);
    ok('Page', 'Priya is listed: Project manager, password not set yet', /Priya Shah/.test(await p.textContent('tr[data-uid="U-001"]')) && /password not set yet/.test(await p.textContent('tr[data-uid="U-001"]')));
    // a second login for the same person is refused
    let r = await api(p, 'userSave', { user: { personId: 'P-001', username: 'priya2', role: 'Read only' } });
    ok('One each', 'a person can only have one login', !r.ok && /already has a login/.test(r.e), r.e);
    r = await api(p, 'userSave', { user: { personId: 'P-999', username: 'ghost', role: 'Administrator' } });
    ok('Only People', 'the server refuses a login for someone not in People', !r.ok && /only people in the register/.test(r.e), r.e);
    // Priya signs in
    await signIn(u, 'priya@example.com', 'wrong-password'); await u.waitForSelector('#loginMsg:not(:empty)');
    ok('Sign in', 'a wrong password is refused', /Wrong username or password/.test(await u.textContent('#loginMsg')));
    await signIn(u, 'Priya@Example.com', temp); await u.waitForSelector('#pwF');
    ok('First sign-in', 'with the temporary password she must set her own before anything else (it can\'t be closed)', /Set your own password/.test(await u.textContent('#modal')) && !(await u.$('#modal [data-close]')));
    await u.keyboard.press('Escape'); await sleep(200);
    ok('First sign-in', 'Esc does not close it', await u.isVisible('#pwF'));
    r = await api(u, 'jobs');
    ok('First sign-in', 'the server blocks everything until she does', !r.ok && /Set your own password first/.test(r.e), r.e);
    await u.fill('#pwF [name=old]', temp); await u.fill('#pwF [name=pw]', 'short'); await u.fill('#pwF [name=pw2]', 'short'); await u.click('#pwF [type=submit]'); await sleep(400);
    ok('Password rules', 'a short password is refused (10+ characters, letters and a number)', await u.isVisible('#pwF'));
    await u.fill('#pwF [name=pw]', 'BuildIt2026now'); await u.fill('#pwF [name=pw2]', 'BuildIt2026now'); await u.click('#pwF [type=submit]');
    await u.waitForLoadState('load'); await u.waitForSelector('#app:not([hidden])'); await sleep(800);
    const um = await u.$$eval('.side-nav > *', (x) => x.filter((e) => !e.hidden).map((e) => e.textContent.trim()));
    ok('Menu', 'her menu shows what a project manager uses and hides Users & access', um.some((x) => /Projects/.test(x)) && um.some((x) => /Quotes/.test(x)) && um.some((x) => /Employees & contractors/.test(x)) && !um.some((x) => /Users & access/.test(x)) && !um.includes('Admin'), um.join(' | '));
    ok('Menu', 'her name and role are at the bottom', /Priya Shah/.test(await u.textContent('#who')) && /Project manager/.test(await u.textContent('#whoRole')));
    // what she can and cannot do (the server decides)
    r = await api(u, 'userList'); ok('Server', 'Users & access: refused ("You don\'t have access")', !r.ok && /don't have access to Users & access/.test(r.e), r.e);
    r = await api(u, 'pplSave', { person: { name: 'Sneaky', type: 'Employee' } }); ok('Server', 'People is view only: saving is refused', !r.ok && /view-only access to People/.test(r.e), r.e);
    r = await api(u, 'pplList'); ok('Server', 'but she can see People', r.ok && r.r.people.length === 3);
    r = await api(u, 'docCreate', { kind: 'quote' }); ok('Server', 'Accounts is view only: making a document is refused', !r.ok && /view-only access to Accounts/.test(r.e), r.e);
    r = await api(u, 'jobs'); ok('Server', 'Jobs & customers: allowed', r.ok);
    await u.goto(`${BASE}/admin/#users`); await u.waitForSelector('.noaccess');
    ok('Page', 'opening Users & access by its link shows "No access"', /No access/.test(await u.textContent('#view')));
    await u.goto(`${BASE}/admin/#people`); await u.waitForSelector('#ppBody tr[data-ppid]');
    ok('Page', 'People opens view only: no "＋ Person" button', !(await u.$('#ppNew')) && /View only/.test(await u.textContent('#view')));
    await u.screenshot({ path: path.join(os.tmpdir(), 'access-user.png') });
    // the AI background jobs follow the same rule
    const bg = await u.evaluate(() => fetch('/.netlify/functions/planai-background', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-MBS-Admin': '1' }, body: JSON.stringify({ id: 'abcdefabcdef123', mode: 'charter', core: 'x' }) }).then((r) => r.status));
    ok('Server', 'the AI background work checks access too (Projects edit: accepted)', bg === 202, String(bg));
    // the Owner changes her to Site supervisor: she is signed out at once
    await p.goto(`${BASE}/admin/#users`); await p.waitForSelector('tr[data-uid="U-001"]'); await p.click('tr[data-uid="U-001"]'); await p.waitForSelector('#usRole');
    await p.selectOption('#usRole', 'Site supervisor'); await p.click('#usSave'); await sleep(800);
    r = await api(u, 'jobs');
    ok('Change', 'changing her access signs her out straight away', !r.ok && /access has changed|log in/i.test(r.e), r.e);
    await signIn(u, 'priya@example.com', 'BuildIt2026now'); await u.waitForSelector('#app:not([hidden])'); await sleep(500);
    r = await api(u, 'docForJob', { core: 'x' }); const r2 = await api(u, 'acctLists');
    ok('Change', 'signed in again as Site supervisor: Accounts gone from her menu and refused by the server', !(await u.isVisible('[data-nav=quotes]')) && !r2.ok, r2.e);
    const bg2 = await u.evaluate(() => fetch('/.netlify/functions/planai-background', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-MBS-Admin': '1' }, body: JSON.stringify({ id: 'abcdefabcdef124', mode: 'intel', core: 'x' }) }).then((r) => r.status));
    ok('Server', 'Project Intelligence questions (view) are still allowed', bg2 === 202, String(bg2));
    // reset password
    await p.click('tr[data-uid="U-001"]'); await p.waitForSelector('#usReset'); await p.click('#usReset'); await p.waitForSelector('#okBtn'); await p.click('#okBtn'); await p.waitForSelector('#usTemp');
    const temp2 = (await p.textContent('#usTemp')).trim(); await p.click('#modal [data-close]');
    r = await api(u, 'jobs'); ok('Reset', 'a password reset signs her out', !r.ok);
    await signIn(u, 'priya@example.com', 'BuildIt2026now'); await u.waitForSelector('#loginMsg:not(:empty)');
    ok('Reset', 'her old password no longer works; the new temporary one does (and asks for her own again)', /Wrong/.test(await u.textContent('#loginMsg')) && await (async () => { await signIn(u, 'priya@example.com', temp2); await u.waitForSelector('#pwF'); return true; })());
    // disable
    await p.click('tr[data-uid="U-001"]'); await p.waitForSelector('#usActive'); await p.uncheck('#usActive'); await p.click('#usSave'); await sleep(600);
    await signIn(u, 'priya@example.com', temp2); await u.waitForSelector('#loginMsg:not(:empty)');
    ok('Disable', 'a disabled login can\'t sign in', /Wrong username or password/.test(await u.textContent('#loginMsg')));
    await p.click('tr[data-uid="U-001"]'); await p.waitForSelector('#usActive'); await p.check('#usActive'); await p.click('#usSave'); await sleep(600);
    // archive the person in People: the login stops working
    await signIn(u, 'priya@example.com', temp2); await u.waitForSelector('#pwF');
    const P1 = await kv.get('ppl:P-001'); await api(p, 'pplSave', { person: { ...P1, archived: true } });
    r = await api(u, 'me'); ok('People', 'archiving Priya in People ends her login', !r.ok);
    await signIn(u, 'priya@example.com', temp2); await u.waitForSelector('#loginMsg:not(:empty)');
    ok('People', 'and she can\'t sign in again', /Wrong/.test(await u.textContent('#loginMsg')));
    // the Owner
    await p.goto(`${BASE}/admin/#users`); await p.waitForSelector('.us-owner');
    await p.screenshot({ path: path.join(os.tmpdir(), 'access-users.png') });
    r = await api(p, 'userPassword', { old: 'x', password: 'abcdefghij1' }); ok('Owner', 'the Owner\'s password stays in Netlify (it says so)', !r.ok && /set in Netlify/.test(r.e));
    const log = (await api(p, 'log')).r.log.map((x) => x.text || x.what || JSON.stringify(x)).join(' | ');
    ok('Audit', 'the activity log records the logins and changes (who did what)', /User added: priya@example.com/.test(log) && /Password reset for priya@example.com/.test(log) && /Logged in \(Project manager\)/.test(log), log.slice(0, 300));
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close(); br = null;
  } catch (e) { try { if (br) await br.close(); } catch {} ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ') + ' LOG: ' + log.slice(-400)); }
  try { srv.kill(); } catch {} try { await blobs.stop(); } catch {}
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(0);
})();
