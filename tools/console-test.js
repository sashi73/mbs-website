// End-to-end test of the MBS Console (v21): real local Blobs server + the site's local server + headless Chromium.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs');
const SITE = path.resolve(process.argv[2]);
const PORT = 8899, BASE = `http://127.0.0.1:${PORT}`;
const results = [];
const ok = (area, name, pass, detail = '') => results.push({ area, name, pass: !!pass, detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(require('os').tmpdir(), 'mbs-console-test-blobs'); fs.rmSync(dir, { recursive: true, force: true });
  const blobs = new BlobsServer({ directory: dir, token: 'tok', port: 0 });
  const { port: bport } = await blobs.start();
  const ctxB64 = Buffer.from(JSON.stringify({ siteID: 'mbs', token: 'tok', edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, apiURL: `http://localhost:${bport}` })).toString('base64');
  process.env.NETLIFY_BLOBS_CONTEXT = ctxB64;
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NETLIFY_BLOBS_CONTEXT: ctxB64, ADMIN_USERNAME: 'sashi73', ADMIN_PASSWORD: 'sashi98', TELEGRAM_BOT_TOKEN: '', RESEND_API_KEY: '', LLM_API_KEY: '' };
  const srv = spawn('node', ['local-server.mjs'], { cwd: SITE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 40 && !/running/.test(log); i++) await sleep(150);

  // seed: a job with a photo, straight into Blobs (as the website would)
  const J = await import(path.join(SITE, 'netlify/lib/jobs.mjs'));
  const core0 = await J.nextCore('W');
  await J.create({ core: core0, name: 'Priya Nair', phone: '0412 345 678', suburb: 'Castle Hill NSW 2154', service: 'Leak repair', summary: 'Water through the bathroom ceiling', source: 'chat' });
  const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
  await J.savePhotos(core0, [{ buf: JPEG, type: 'image/jpeg' }]);

  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('dialog', (d) => { errors.push('dialog: ' + d.message()); d.dismiss(); });
  const api = (action, data = {}, headers = { 'X-MBS-Admin': '1' }) => p.request.post(`${BASE}/.netlify/functions/admin`, { data: { action, ...data }, headers });

  // ---- security before login ----
  let r = await api('jobs');
  ok('Security', 'API refuses requests without a login (401)', r.status() === 401, r.status());
  r = await p.request.get(`${BASE}/.netlify/functions/admin?action=export`);
  ok('Security', 'CSV export refuses without a login', r.status() === 401, r.status());
  r = await p.request.post(`${BASE}/.netlify/functions/admin`, { data: { action: 'login', username: 'sashi73', password: 'sashi98' } });
  ok('Security', 'requests without the console header are refused (403), so other websites cannot use it', r.status() === 403, r.status());
  r = await p.request.post(`${BASE}/.netlify/functions/admin`, { data: { action: 'jobs' }, headers: { 'X-MBS-Admin': '1', Cookie: 'mbs_admin=eyJ1IjoieCJ9.forged' } });
  ok('Security', 'a forged login cookie is refused', r.status() === 401, r.status());
  // lockout (different device address so the real login still works)
  let last;
  for (let i = 0; i < 5; i++) last = await api('login', { username: 'sashi73', password: 'wrong' + i }, { 'X-MBS-Admin': '1', 'X-Forwarded-For': '203.0.113.9' });
  const lockMsg = (await last.json()).error;
  const sixth = await api('login', { username: 'sashi73', password: 'sashi98' }, { 'X-MBS-Admin': '1', 'X-Forwarded-For': '203.0.113.9' });
  ok('Security', 'after 5 wrong passwords the device is locked for 15 minutes (even with the right password)', sixth.status() === 429 && /Locked|Too many/.test(lockMsg), lockMsg);

  // ---- the page ----
  const page = await p.request.get(`${BASE}/admin/`);
  const html = await page.text();
  ok('Console', '/admin/ loads, marked noindex', page.status() === 200 && /noindex/.test(html), page.status());
  ok('Console', 'no username or password written in the page or script', !/sashi98/.test(html) && !/sashi98/.test(await (await p.request.get(`${BASE}/admin/admin.js`)).text()));
  const robots = await (await p.request.get(`${BASE}/robots.txt`)).text();
  ok('Console', 'robots.txt keeps search engines out of /admin/', /Disallow: \/admin\//.test(robots));

  // header login button
  await p.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  const lb = await p.$eval('.nav-login', (a) => ({ href: a.getAttribute('href'), text: a.textContent.trim(), vis: a.getBoundingClientRect().width > 0 }));
  ok('Website', 'header shows a Login button linking to the console', lb.href === '/admin/' && /Login/.test(lb.text) && lb.vis, JSON.stringify(lb));
  const m = await ctx.newPage(); await m.setViewportSize({ width: 360, height: 760 });
  await m.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  const mob = await m.evaluate(() => ({ scroll: document.documentElement.scrollWidth <= innerWidth + 1, btn: document.querySelector('.nav-login').getBoundingClientRect().width }));
  ok('Website', 'on a phone the Login button shows as a lock icon, no sideways scrolling', mob.scroll && mob.btn > 30 && mob.btn < 60, JSON.stringify(mob));
  await m.close();

  // login screen
  await p.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
  ok('Login', 'login screen appears when signed out', await p.isVisible('#loginForm'));
  await p.fill('[name=username]', 'sashi73'); await p.fill('[name=password]', 'nope'); await p.click('#loginForm button');
  await p.waitForFunction(() => document.querySelector('#loginMsg').textContent.length > 0);
  const msg = await p.textContent('#loginMsg');
  ok('Login', 'a wrong password is refused with tries left', /Wrong username or password \(4 tries left\)/.test(msg), msg);
  await p.fill('[name=username]', 'Sashi73'); await p.fill('[name=password]', 'sashi98'); await p.click('#loginForm button');
  await p.waitForSelector('#app:not([hidden])', { timeout: 5000 });
  ok('Login', 'sashi73 / sashi98 opens the console (username not case-sensitive)', await p.isVisible('.side'));
  const ck = (await ctx.cookies()).find((c) => c.name === 'mbs_admin');
  ok('Security', 'login cookie is HttpOnly and SameSite=Strict (scripts cannot read it)', ck && ck.httpOnly && ck.sameSite === 'Strict', ck && `${ck.httpOnly} ${ck.sameSite}`);

  // dashboard
  await p.waitForSelector('.kpi');
  const kp = await p.$$eval('.kpi .k', (x) => x.map((e) => e.textContent));
  ok('Dashboard', 'shows KPI cards: enquiries, quotes, won, invoiced (GST split), paid, owed', ['Enquiries', 'Quotes sent', 'Jobs won', 'Invoiced', 'Paid', 'Owed now'].every((k) => kp.includes(k)), kp.join(', '));
  ok('Dashboard', 'pipeline and latest enquiries list the seeded job', /Priya Nair/.test(await p.textContent('.view')));
  await p.screenshot({ path: 'MBS_console_dashboard.jpg', type: 'jpeg', quality: 80 });

  // new job (with a nasty name to check escaping)
  await p.click('a[href="#new"] >> nth=0');
  await p.waitForSelector('#newForm');
  await p.fill('[name=name]', 'Tom Lee'); await p.fill('[name=phone]', '0400 111 222');
  await p.fill('[name=suburb]', 'Kellyville'); await p.fill('[name=service]', 'Repaint lounge'); await p.fill('[name=summary]', 'Two coats, ceiling too');
  await p.click('#newForm button.btn-gold');
  await p.waitForSelector('#stageBtns');
  const ref = (await p.textContent('.view h2')).trim();
  ok('Jobs', 'New job creates a preliminary number (P…) and opens it', /^P[A-Z]-\d{6}-\d{6}$/.test(ref), ref);

  // stages
  await p.click('[data-stage=called]'); await p.waitForFunction(() => /Called/.test(((document.querySelector('.view .chip') || {}).textContent || '')));
  await p.click('[data-stage=quoted]'); await p.fill('#stageForm [name=amount]', '4,950');
  const hint = await p.textContent('#gstHint');
  await p.click('#stageForm button'); await p.waitForFunction(() => /Quoted/.test(((document.querySelector('.view .chip') || {}).textContent || '')));
  const refQ = (await p.textContent('.view h2')).trim();
  ok('Jobs', 'Quoted asks the amount, shows GST live, and the number drops the P (PF → F)', /GST \$450\.00 · ex GST \$4,500\.00/.test(hint) && refQ === ref.slice(1), `${hint} | ${refQ}`);
  ok('Jobs', 'quote shown with GST separately', /\$4,950\.00 inc GST \(GST \$450\.00\)/.test(await p.textContent('.view')));
  await p.click('[data-stage=won]'); await p.waitForFunction(() => /Job won/.test(((document.querySelector('.view .chip') || {}).textContent || '')));
  const refW = (await p.textContent('.view h2')).trim();
  ok('Jobs', 'Won turns it into a job number (J…)', refW === 'J' + ref.slice(1), refW);
  await p.fill('#noteForm [name=text]', 'Customer wants Dulux Lexicon'); await p.click('#noteForm button');
  await p.waitForFunction(() => /Dulux Lexicon/.test(((document.querySelector('.view') || {}).textContent || '')));
  ok('Jobs', 'notes are saved and shown', true);
  await p.click('[data-rem="tomorrow 9am"]'); await p.waitForFunction(() => /9:00am/.test(((document.querySelector('.view') || {}).textContent || '')));
  ok('Jobs', 'quick reminder (tomorrow 9am) is added to the job', true);
  ok('Jobs', 'history timeline records each step', /Quoted \$4,950\.00 inc GST/.test(await p.textContent('.timeline')) && /Admin \(sashi73\)/.test(await p.textContent('.timeline')));
  await p.screenshot({ path: 'MBS_console_job.jpg', type: 'jpeg', quality: 80, fullPage: true });

  // seeded job: photo shows
  await p.goto(`${BASE}/admin/#job/${core0}`); await p.waitForSelector('#stageBtns');
  await p.waitForTimeout(500);
  const ph = await p.$$eval('.photos img', (x) => x.map((i) => i.complete && i.naturalWidth > 0));
  ok('Jobs', 'customer photos display in the job', ph.length === 1 && ph[0], JSON.stringify(ph));

  // jobs list + search
  await p.goto(`${BASE}/admin/#jobs/all`); await p.waitForSelector('tr[data-job]');
  ok('Jobs', 'All jobs list shows both jobs', (await p.$$('tr[data-job]')).length === 2);
  await p.fill('#q', 'castle'); await p.press('#q', 'Enter'); await p.waitForFunction(() => /Search/.test(((document.querySelector('.view h2') || {}).textContent || '')));
  await p.waitForTimeout(300);
  ok('Jobs', 'search by suburb finds the right job', (await p.$$('tr[data-job]')).length === 1 && /Priya/.test(await p.textContent('tbody')));
  const csv = await p.request.get(`${BASE}/.netlify/functions/admin?action=export`);
  ok('Jobs', 'CSV export downloads with GST columns', csv.status() === 200 && /invoice_gst/.test(await csv.text()), csv.status());

  // reports
  await p.goto(`${BASE}/admin/#reports/month`); await p.waitForSelector('table');
  const rep = await p.textContent('.view');
  ok('Reports', 'report shows quotes, wins and GST lines', /Quotes sent/.test(rep) && /\$4,950\.00 inc GST/.test(rep) && /GST on invoices/.test(rep));

  // reminders page
  await p.goto(`${BASE}/admin/#reminders`); await p.waitForSelector('#remAll');
  await p.fill('#remAll [name=when]', 'in 2h'); await p.fill('#remAll [name=text]', 'order tiles'); await p.click('#remAll button');
  await p.waitForFunction(() => /order tiles/.test(((document.querySelector('.view') || {}).textContent || '')));
  ok('Reminders', 'reminders page adds a reminder', true);
  const before = (await p.$$('[data-unremind]')).length;
  await p.click('[data-unremind] >> nth=0'); await p.waitForTimeout(800);
  ok('Reminders', 'a reminder can be deleted', (await p.$$('[data-unremind]')).length === before - 1, `${before} -> ${(await p.$$('[data-unremind]')).length}`);

  // data explorer
  await p.goto(`${BASE}/admin/#data/mbs-jobs`); await p.waitForSelector('.sel');
  const keys = await p.$$eval('.sel', (x) => x.map((c) => c.value));
  ok('Data', 'lists every record in the live database (jobs, photo, counter, job list, reminders)', keys.includes('job:' + core0) && keys.some((k) => k.startsWith('photo:')) && keys.includes('seq') && keys.includes('index') && keys.includes('reminders'), keys.join(', '));
  await p.click(`[data-view="job:${core0}"]`); await p.waitForSelector('pre.json');
  ok('Data', 'View shows the full record', /Priya Nair/.test(await p.textContent('pre.json')));
  await p.click('#modal [data-close]');
  await p.screenshot({ path: 'MBS_console_data.jpg', type: 'jpeg', quality: 80 });
  // move to test
  await p.check(`.sel[value="job:${core0}"]`); await p.click('#moveBtn'); await p.click('#okBtn');
  await p.waitForFunction((k) => !document.querySelector(`.sel[value="${k}"]`), 'job:' + core0);
  const liveKeys = await p.$$eval('.sel', (x) => x.map((c) => c.value));
  ok('Data', 'Move to test database takes the job AND its photo out of live', !liveKeys.includes('job:' + core0) && !liveKeys.some((k) => k.startsWith('photo:' + core0)));
  await p.goto(`${BASE}/admin/#data/mbs-jobs-test`); await p.waitForSelector('.sel');
  const testKeys = await p.$$eval('.sel', (x) => x.map((c) => c.value));
  ok('Data', '…and they appear in the test database, with its own job list', testKeys.includes('job:' + core0) && testKeys.some((k) => k.startsWith('photo:' + core0)) && testKeys.includes('index'), testKeys.join(', '));
  r = await api('jobs', { stage: 'all' }); const liveJobs = (await r.json()).jobs.map((j) => j.core);
  ok('Data', 'the moved job no longer shows in the CRM job list', !liveJobs.includes(core0), liveJobs.join(','));
  // move back
  await p.check(`.sel[value="job:${core0}"]`); await p.click('#moveBtn'); await p.click('#okBtn');
  await p.waitForFunction((k) => !document.querySelector(`.sel[value="${k}"]`), 'job:' + core0);
  r = await api('job', { ref: core0 });
  ok('Data', 'it can be moved back to live, photo included', r.status() === 200 && (await r.json()).job.photos.length === 1);
  // delete
  await p.goto(`${BASE}/admin/#data/mbs-jobs`); await p.waitForSelector('.sel');
  await p.check(`.sel[value="job:${core0}"]`); await p.click('#delBtn');
  ok('Data', 'delete asks for confirmation first', /cannot be undone/.test(await p.textContent('#modal')));
  await p.click('#okBtn');
  await p.waitForFunction((k) => !document.querySelector(`.sel[value="${k}"]`), 'job:' + core0);
  const after = await p.$$eval('.sel', (x) => x.map((c) => c.value));
  r = await api('jobs', { stage: 'all' });
  ok('Data', 'Delete removes the job, its photo, its reminders and its job-list entry', !after.some((k) => k.includes(core0)) && !(await r.json()).jobs.some((j) => j.core === core0));
  await p.click('#reindex'); await p.waitForTimeout(800);
  ok('Data', 'Rebuild job list works', /rebuilt: 1 jobs/.test(await p.textContent('#toast')), await p.textContent('#toast'));
  const bk = await p.request.get(`${BASE}/.netlify/functions/admin?action=backup&store=mbs-jobs`);
  ok('Data', 'Backup downloads every record as JSON', bk.status() === 200 && /"store": "mbs-jobs"/.test(await bk.text()));
  await p.goto(`${BASE}/admin/#data/mbs-visits`); await p.waitForSelector('.view .card');
  ok('Data', 'visitor counter store is shown too', /Visitor counter/.test(await p.textContent('.tabs')));

  // activity + analytics
  await p.goto(`${BASE}/admin/#activity`); await p.waitForSelector('.timeline');
  const act = await p.textContent('.timeline');
  ok('Activity', 'activity log records logins, stage changes, moves and deletes', /Logged in/.test(act) && /Quoted/.test(act) && /Moved/.test(act) && /Deleted/.test(act));
  await p.goto(`${BASE}/admin/#analytics`); await p.waitForSelector('.soon');
  ok('Console', 'Analytics & AI placeholder ready for Power BI / trends / AI', /Power BI/.test(await p.textContent('.view')));

  // phone layout
  const ph2 = await ctx.newPage(); await ph2.setViewportSize({ width: 390, height: 844 });
  await ph2.goto(`${BASE}/admin/#dashboard`, { waitUntil: 'networkidle' }); await ph2.waitForSelector('.kpi');
  const pm = await ph2.evaluate(() => ({ scroll: document.documentElement.scrollWidth <= innerWidth + 1, side: getComputedStyle(document.querySelector('.side')).transform !== 'none', wide: [...document.querySelectorAll('.main *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 6).map(e => e.tagName + '.' + e.className + ':' + Math.round(e.getBoundingClientRect().right)) }));
  await ph2.click('#menuBtn'); await ph2.waitForTimeout(400);
  const open = await ph2.evaluate(() => document.querySelector('.side').getBoundingClientRect().left >= -1);
  ok('Console', 'works on a phone: menu slides in, no sideways scrolling', pm.scroll && pm.side && open, JSON.stringify(pm) + ' open=' + open);
  await ph2.mouse.click(370, 600); await ph2.waitForTimeout(400);
  const closed = await ph2.evaluate(() => !document.querySelector('.side').classList.contains('open'));
  ok('Console', 'tapping outside the phone menu closes it', closed);
  await ph2.screenshot({ path: 'MBS_console_phone.jpg', type: 'jpeg', quality: 80 });
  await ph2.close();

  // hostile customer text (anyone can type into the website form) is shown as text, never run
  r = await api('create', { name: 'Eve <img src=x onerror=alert(1)>', phone: '0400 999 999', service: '<script>alert(2)</script>' });
  const evil = (await r.json()).job;
  await p.goto(`${BASE}/admin/#job/${evil.core}`); await p.waitForSelector('#stageBtns');
  await p.goto(`${BASE}/admin/#jobs/all`); await p.waitForSelector('tr[data-job]'); await p.waitForTimeout(400);
  ok('Security', 'customer text is shown as text, never run as code', (await p.$$('img[src="x"]')).length === 0 && !errors.some((e) => /dialog/.test(e)) && /Eve <img/.test(await p.textContent('.view')));

  // logout
  await p.goto(`${BASE}/admin/#dashboard`); await p.waitForSelector('#logout');
  await p.click('#logout'); await p.waitForSelector('#loginForm');
  r = await api('jobs');
  ok('Login', 'Sign out ends the session', r.status() === 401, r.status());
  ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));

  await b.close(); srv.kill(); await blobs.stop();
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  if (pass !== results.length) console.log('\n--- server log ---\n' + log.slice(-3000));
})().catch((e) => { console.error(e); try { require('child_process').execSync('pkill -f "^node local-server.mjs"'); } catch {} process.exit(1); });
