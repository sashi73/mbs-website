// End-to-end test of GKH Project Champ: the 5-page site, the login page (built-in owner login, no ADMIN_* settings),
// Google sign-in (against a fake Google token checker), and a new project from the form to a plan.
// Run: node tools/champ-test.js .
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http'), path = require('path'), fs = require('fs');
const SITE = path.resolve(process.argv[2] || '.');
const PORT = 8911, BASE = `http://127.0.0.1:${PORT}`;
const results = [];
const ok = (area, name, pass, detail = '') => results.push({ area, name, pass: !!pass, detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CLIENT = 'champ-test.apps.googleusercontent.com';

(async () => {
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(require('os').tmpdir(), 'champ-test-blobs'); fs.rmSync(dir, { recursive: true, force: true });
  const blobs = new BlobsServer({ directory: dir, token: 'tok', port: 0 });
  const { port: bport } = await blobs.start();
  const ctxB64 = Buffer.from(JSON.stringify({ siteID: 'champ', token: 'tok', edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, apiURL: `http://localhost:${bport}` })).toString('base64');
  // a fake Google tokeninfo: any token is "Jane Tester", verified, for our client ID
  const g = http.createServer((q, s) => { s.setHeader('Content-Type', 'application/json'); s.end(JSON.stringify({ aud: CLIENT, iss: 'https://accounts.google.com', email_verified: 'true', exp: String(Math.floor(Date.now() / 1000) + 600), email: 'jane.tester@example.com', name: 'Jane Tester' })); }).listen(0);
  await sleep(100);
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NETLIFY_BLOBS_CONTEXT: ctxB64, ADMIN_USERNAME: '', ADMIN_PASSWORD: '', ADMIN_SESSION_SECRET: '',
    GOOGLE_CLIENT_ID: CLIENT, GOOGLE_TOKENINFO_URL: `http://127.0.0.1:${g.address().port}/tokeninfo`, LLM_API_KEY: '', TELEGRAM_BOT_TOKEN: '', RESEND_API_KEY: '', SITE_ENV: '' };
  const srv = spawn('node', ['local-server.mjs'], { cwd: SITE, env, stdio: ['ignore', 'pipe', 'pipe'] }); global.SRV = srv;
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 60 && !/running/i.test(log); i++) await sleep(150);

  const b = await chromium.launch({ executablePath: fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined });
  const ctx = await b.newContext({ viewport: { width: 1366, height: 900 } });
  await ctx.route(/images\.unsplash\.com|accounts\.google\.com/, (r) => r.abort());   // no internet in the test
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(p.url() + ' :: ' + e.message));
  const api = (action, data = {}, headers = { 'X-MBS-Admin': '1' }) => p.request.post(`${BASE}/.netlify/functions/admin`, { data: { action, ...data }, headers });

  // ---- public site ----
  const pages = [['index.html', 'Every project'], ['features.html', 'Everything a project'], ['agile.html', 'One plan'], ['industries.html', 'Built for teams'], ['contact.html', 'on your project'], ['privacy.html', 'Privacy'], ['login.html', 'Project Champ']];
  for (const [f, text] of pages) {
    const r = await p.goto(`${BASE}/${f}`);
    const body = await p.textContent('body');
    ok('Site', `${f} loads (${r.status()})`, r.status() === 200 && body.includes(text));
  }
  await p.goto(`${BASE}/index.html`);
  const nav = await p.$$eval('header .menu a', (as) => as.map((a) => a.getAttribute('href')));
  ok('Site', 'menu has the 5 pages', JSON.stringify(nav) === JSON.stringify(['index.html', 'features.html', 'agile.html', 'industries.html', 'contact.html']), nav.join(','));
  ok('Site', 'header has a Login link to login.html', (await p.getAttribute('header .nav-login', 'href')) === 'login.html');
  ok('Site', 'no MBS wording on the home page', !/Modern Building|0420 494 990|Mr\.? Fixit|Wonder Bird/i.test(await p.content()));
  ok('Site', 'footer credit "Designed by © Sashi Kumar Sivam"', (await p.textContent('footer')).includes('Designed by © Sashi Kumar Sivam'));
  const r404 = await p.goto(`${BASE}/nope.html`);
  ok('Site', 'unknown page gives the 404 page', r404.status() === 404 && (await p.textContent('body')).includes('critical path'));

  // ---- security ----
  let r = await api('planList');
  ok('Security', 'API refuses without a login (401)', r.status() === 401, r.status());
  r = await p.request.post(`${BASE}/.netlify/functions/admin`, { data: { action: 'planList' }, headers: { 'X-MBS-Admin': '1', Cookie: 'mbs_admin=eyJ1Ijoic2FzaGk3MyJ9.forged' } });
  ok('Security', 'a forged cookie is refused', r.status() === 401, r.status());
  r = await api('login', { username: 'sashi73', password: 'wrong' }, { 'X-MBS-Admin': '1', 'X-Forwarded-For': '203.0.113.7' });
  ok('Security', 'wrong password refused', r.status() === 401, r.status());
  r = await api('loginOptions');
  ok('Google', 'login page is told the Google client ID', (await r.json()).google === CLIENT);

  // ---- login page with the built-in owner login ----
  await p.goto(`${BASE}/login.html`);
  await p.fill('[name=username]', 'sashi73'); await p.fill('[name=password]', 'sashi98');
  await Promise.all([p.waitForURL(/\/admin\/#portfolio/, { timeout: 15000 }).catch(() => {}), p.click('#loginForm button[type=submit]')]);
  ok('Login', 'sashi73 / sashi98 signs in and lands on the Portfolio', /\/admin\/#portfolio/.test(p.url()), p.url());
  await p.waitForSelector('#app:not([hidden])', { timeout: 10000 }).catch(() => {});
  await sleep(800);
  const menu = await p.$$eval('.side-nav a:not([hidden])', (as) => as.map((a) => a.textContent.trim()));
  ok('Console', 'menu shows only the project element (+ admin)', JSON.stringify(menu) === JSON.stringify(['📊Summary', '▦Pipeline board', '📅All projects', '＋New project', '🔐Users & access', '🕘Activity log']), menu.join(' | '));
  ok('Console', 'branded GKH Project Champ', (await p.textContent('.gkh-bar')).includes('GKH Project Champ') && (await p.title()).includes('Project Champ'));
  await p.waitForSelector('.pcol', { timeout: 8000 }).catch(() => {});
  ok('Portfolio', 'pipeline board has the 5 PMBOK phases', JSON.stringify(await p.$$eval('.pcol .pcol-h b', (b) => b.map((x) => x.textContent))) === JSON.stringify(['Initiation', 'Planning', 'Execution', 'Monitoring & Evaluation', 'Closing']));

  // ---- new project → plan ----
  await p.click('.top-new');
  await p.waitForSelector('#champNew');
  await p.fill('#champNew [name=name]', 'Head office fit-out');
  await p.fill('#champNew [name=client]', 'Acme Pty Ltd');
  await p.fill('#champNew [name=site]', 'Parramatta NSW');
  await p.fill('#champNew [name=summary]', 'Fit out level 3: 40 desks, two meeting rooms, kitchen, data cabling. Budget $250k, finish by March.');
  await p.click('#champNew button[type=submit]');
  await p.waitForFunction(() => /#plan\//.test(location.hash), null, { timeout: 10000 }).catch(() => {});
  const core = decodeURIComponent(p.url().split('#plan/')[1] || '').split('/')[0];
  ok('Project', 'New project creates a project and opens its plan', /^P-\d{6}-\d{6}$/.test(core), p.url());
  await p.waitForSelector('#tplCreate', { timeout: 10000 }).catch(() => {});
  ok('Project', 'scope is filled from the description', ((await p.inputValue('#tplScope').catch(() => '')) || '').includes('40 desks'));
  await p.click('[data-mode=blank]').catch(() => {});
  await p.click('#tplCreate').catch(() => {});
  await sleep(2500);
  r = await api('planList', { today: new Date().toISOString().slice(0, 10) });
  const pl = r.ok() ? (await r.json()).plans : [];
  ok('Project', 'blank plan saved and listed', pl.some((x) => x.core === core), JSON.stringify(pl.map((x) => x.name)));
  await p.goto(`${BASE}/admin/#projects`); await sleep(1500);
  await p.waitForSelector('[data-plan]', { timeout: 8000 }).catch(() => {}); const vt = await p.textContent('#view'); ok('Project', 'Projects list shows the new project', vt.includes('Head office fit-out'), vt.slice(0, 300));
  await p.goto(`${BASE}/admin/#plan/${core}/gantt`); await sleep(2500);
  ok('Project', 'Gantt tab opens', /gantt/i.test(await p.content()));
  await p.goto(`${BASE}/admin/#plan/${core}/board`); await sleep(2000);
  ok('Project', 'Board tab opens', (await p.$$('.view [class*=board], .view [class*=kan]')).length > 0);

  // ---- portfolio: summary and pipeline board ----
  await p.goto(`${BASE}/admin/#portfolio/board`); await p.reload(); await p.waitForSelector('.pcard', { timeout: 8000 }).catch(() => {});
  const colOf = () => p.evaluate((c) => { const el = document.querySelector('.pcard[data-core="' + c + '"]'); return el ? el.closest('.pcol').getAttribute('data-col') : ''; }, core);
  ok('Portfolio', 'new planned project sits in Planning', (await colOf()) === 'plan', await colOf());
  const r2 = await api('planNewProject', { name: 'ERP rollout', client: 'Finance' });
  await p.click('#pbRefresh'); await sleep(1200);
  const core2 = (await r2.json()).core;
  ok('Portfolio', 'project without a plan sits in Initiation', (await p.evaluate((c) => { const el = document.querySelector('.pcard[data-core="' + c + '"]'); return el ? el.closest('.pcol').getAttribute('data-col') : ''; }, core2)) === 'init');
  await p.click(`.pcard[data-core="${core}"] [data-move]`); await p.click('.pmenu [data-to=exec]'); await sleep(1500);
  ok('Portfolio', 'moving a card (⇄) puts it in Execution', (await colOf()) === 'exec', await colOf());
  ok('Portfolio', 'a moved card is marked as moved by hand', (await p.textContent(`.pcard[data-core="${core}"]`)).includes('Moved by hand'));
  await p.click(`.pcard[data-core="${core}"] [data-move]`); await p.click('.pmenu [data-to=auto]'); await sleep(1500);
  ok('Portfolio', '"Automatic" puts it back by its plan', (await colOf()) === 'plan', await colOf());
  await p.click('[data-tab=summary]'); await p.waitForSelector('.cs-tiles', { timeout: 8000 }).catch(() => {});
  const st = await p.textContent('#view');
  ok('Portfolio', 'Summary shows tiles, phases and the health table', st.includes('Total budget') && st.includes('Projects by PMBOK phase') && st.includes('ERP rollout') && st.includes('Head office fit-out'));

  // ---- logout → login page ----
  await p.goto(`${BASE}/admin/#projects`); await sleep(1000);
  await Promise.all([p.waitForURL(/login\.html/, { timeout: 8000 }).catch(() => {}), p.click('#logout')]);
  ok('Login', 'Sign out goes back to the login page', /login\.html/.test(p.url()), p.url());

  // ---- Google sign-in (fake Google) ----
  r = await api('loginGoogle', { credential: 'aaa.bbb.ccc' });
  ok('Google', 'Google sign-in accepted', r.status() === 200, r.status() + ' ' + (await r.text()).slice(0, 120));
  r = await api('me'); const me = r.ok() ? await r.json() : {};
  ok('Google', 'Google user is view-only', me.kind === 'google' && /view only/i.test(me.role || ''), me.role);
  r = await api('planNewProject', { name: 'X', client: 'Y' });
  ok('Google', 'Google view-only user cannot create projects', r.status() === 403, r.status());

  // ---- skins and layout ----
  await p.goto(`${BASE}/index.html`);
  await p.click('#champThemeBtn'); await p.click('.ct-skin[data-v=white]');
  ok('Theme', 'website skin changes to White', (await p.getAttribute('html', 'data-skin')) === 'white');
  const bg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok('Theme', 'White skin gives a white page', /255, 255, 255/.test(bg), bg);
  await p.click('.ct-seg [data-v=compact]');
  ok('Theme', 'density switches to compact', (await p.getAttribute('html', 'data-density')) === 'compact');
  await p.goto(`${BASE}/login.html`);
  ok('Theme', 'skin is remembered on the next page', (await p.getAttribute('html', 'data-skin')) === 'white');
  await p.evaluate(() => { localStorage.setItem('champSkin', 'navy'); });
  await p.goto(`${BASE}/admin/`); await sleep(600);
  ok('Theme', 'console uses the chosen skin (Navy)', (await p.getAttribute('html', 'data-skin')) === 'navy' && /rgb\(10, 22, 40\)/.test(await p.evaluate(() => getComputedStyle(document.querySelector('.side') || document.body).backgroundColor)));
  await p.evaluate(() => { localStorage.clear(); });

  ok('Errors', 'no script errors on any page', errors.length === 0, errors.slice(0, 5).join(' || '));
  await b.close(); srv.kill(); g.close(); await blobs.stop();
  const bad = results.filter((x) => !x.pass);
  for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.pass ? '' : '  → ' + x.detail}`);
  console.log(`\n${results.length - bad.length}/${results.length} passed`);
  if (bad.length) { console.log('\nserver log tail:\n' + log.slice(-1500)); process.exit(1); }
})().catch((e) => { for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.pass ? '' : '  → ' + x.detail}`); console.error('CRASH: ' + e.message.split('\n')[0]); if (global.SRV) global.SRV.kill(); process.exit(1); });
