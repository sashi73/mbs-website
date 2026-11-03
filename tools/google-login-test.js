// v97: "Sign in with Google" on the test site: anyone with a verified Google account gets View on every module and no access to
// Users & access. The ID token is checked with Google (here a stand-in tokeninfo server). Not offered (and refused) off the test site.
// node google-login-test.js <site> [xl] [notest]
const NOTEST = process.argv[4] === 'notest';
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const SITE = path.resolve(process.argv[2]);
const XL = path.resolve(process.argv[3] || path.join(__dirname, 'xl'));
const PORT = 8990, BASE = `http://127.0.0.1:${PORT}`;
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => results.push({ area, name, pass: !!pass, detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const csvParse = (s) => { const rows = []; let row = [], cur = '', q = false; for (let i = 0; i < s.length; i++) { const c = s[i]; if (q) { if (c === '"' && s[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; } else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; } else cur += c; } if (cur || row.length) { row.push(cur); rows.push(row); } return rows; };

(async () => {
  const http0 = require('http'), now = Math.floor(Date.now() / 1000), CID = 'test-client.apps.googleusercontent.com';
  const TOK = { 'good.alice.sig': { aud: CID, iss: 'https://accounts.google.com', email: 'Alice.Tester@gmail.com', email_verified: 'true', name: 'Alice Tester', exp: String(now + 3600) },
    'bad.aud.sig': { aud: 'other.apps.googleusercontent.com', iss: 'accounts.google.com', email: 'eve@gmail.com', email_verified: 'true', exp: String(now + 3600) },
    'bad.unverified.sig': { aud: CID, iss: 'accounts.google.com', email: 'eve@gmail.com', email_verified: 'false', exp: String(now + 3600) },
    'bad.expired.sig': { aud: CID, iss: 'accounts.google.com', email: 'eve@gmail.com', email_verified: 'true', exp: String(now - 60) } };
  const ti = http0.createServer((req, res) => { const t = TOK[new URL(req.url, 'http://x').searchParams.get('id_token')]; res.writeHead(t ? 200 : 400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(t || { error: 'invalid_token' })); });
  await new Promise((r) => ti.listen(0, '127.0.0.1', r));
  let ExcelJS = null; try { ExcelJS = require(require.resolve('exceljs', { paths: [XL, SITE] })); } catch {}
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-gg-blobs'); fs.rmSync(dir, { recursive: true, force: true });
  const blobs = new BlobsServer({ directory: dir, token: 'tok', port: 0 });
  const { port: bport } = await blobs.start();
  const ctxB64 = Buffer.from(JSON.stringify({ siteID: 'mbs', token: 'tok', edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, apiURL: `http://localhost:${bport}` })).toString('base64');
  process.env.NETLIFY_BLOBS_CONTEXT = ctxB64;
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NETLIFY_BLOBS_CONTEXT: ctxB64, ADMIN_USERNAME: 'sashi73', ADMIN_PASSWORD: 'sashi98', SITE_ENV: NOTEST ? '' : 'test', GOOGLE_CLIENT_ID: CID, GOOGLE_TOKENINFO_URL: `http://127.0.0.1:${ti.address().port}/tokeninfo`, LLM_API_KEY: '', TELEGRAM_BOT_TOKEN: '', RESEND_API_KEY: '' };
  const srv = spawn('node', ['local-server.mjs'], { cwd: SITE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 40 && !/running/.test(log); i++) await sleep(150);
  let br = null;
  const tmp = path.join(os.tmpdir(), 'mbs-gg-files'); fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp);
  try {
    const J = await import(path.join(SITE, 'netlify/lib/jobs.mjs')), kv = await import(path.join(SITE, 'netlify/lib/kv.mjs')), P = await import(path.join(SITE, 'netlify/lib/plan.mjs'));
    const XL = path.resolve(process.argv[3] || path.join(__dirname, 'xl')); const mammoth = require(require.resolve('mammoth', { paths: [XL, SITE] }));
    const core = await J.nextCore('G');
    await J.create({ core, name: 'Rachel Raci', phone: '0400 101 202', email: '', suburb: 'Kellyville', service: 'Kitchen renovation', source: 'phone', summary: 'Kitchen renovation.' });
    br = await chromium.launch();
    const oc = await br.newContext({ viewport: { width: 1440, height: 900 } }), gc = await br.newContext({ viewport: { width: 1440, height: 900 } });
    await gc.route('https://accounts.google.com/**', (r) => r.abort());   // no Google here: the button can't load, the server check is what is tested
    const p = await oc.newPage(), g = await gc.newPage(); p.setDefaultTimeout(20000); g.setDefaultTimeout(20000);
    const errors = []; errorsAll = errors; p.on('pageerror', (e) => errors.push('owner: ' + e.message)); g.on('pageerror', (e) => errors.push('google: ' + e.message));
    const api = (pg, a, b) => pg.evaluate(([a, b]) => window.MBS.api(a, b).then((r) => ({ ok: true, r }), (e) => ({ ok: false, e: e.message })), [a, b || {}]);
    await g.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' }); await sleep(600);
    if (NOTEST) {
      ok('Live', 'not the test site: no "Sign in with Google"', await g.isHidden('#gsiBox'));
      const r = await api(g, 'loginGoogle', { credential: 'good.alice.sig' });
      ok('Live', 'and the server refuses a Google sign-in', !r.ok && /not available/.test(r.e), r.e);
    } else {
      ok('Sign in', 'the sign-in page offers "Sign in with Google" (test site), saying it gives view-only access', await g.isVisible('#gsiBox') && /view-only access/.test(await g.textContent('#gsiBox')));
      for (const [cred, why] of [['bad.aud.sig', 'another app\'s token'], ['bad.unverified.sig', 'an unverified email'], ['bad.expired.sig', 'an expired token'], ['bad.rejected.sig', 'a token Google rejects']]) {
        const r = await api(g, 'loginGoogle', { credential: cred });
        ok('Checks', 'refused: ' + why, !r.ok, r.e);
      }
      let r = await api(g, 'loginGoogle', { credential: 'good.alice.sig' });
      ok('Sign in', 'a verified Google account signs in', r.ok && r.r.user === 'alice.tester@gmail.com', r.e);
      await g.goto(`${BASE}/admin/#dashboard`); await g.reload(); await g.waitForSelector('#app:not([hidden])'); await sleep(1000);
      const me = (await api(g, 'me')).r;
      ok('Access', 'view on every module, no access to Users & access, no password to set', me.kind === 'google' && Object.entries(me.mods).every(([k, v]) => (k === 'users' ? v === 'none' : v === 'view')) && !me.mustChange, JSON.stringify(me.mods));
      const menu = await g.$$eval('.side-nav [data-nav]', (x) => x.filter((e) => !e.hidden).map((e) => e.getAttribute('data-nav')));
      ok('Access', 'the menu has everything except Users & access', menu.includes('dashboard') && menu.includes('projects') && menu.includes('quotes') && menu.includes('inventory') && menu.includes('people') && !menu.includes('users'), menu.join(','));
      const reads = await Promise.all([['jobs', {}], ['planList', {}], ['pplList', {}], ['subList', {}], ['invList', {}]].map(([a, b]) => api(g, a, b)));
      ok('Access', 'they can look at jobs, projects, people, subbies and stock', reads.every((x) => x.ok), reads.map((x) => x.e).join(' | '));
      const writes = await Promise.all([['pplSave', { person: { name: 'X' } }], ['invSave', { item: { name: 'Y' } }], ['userList', {}], ['userSave', { user: {} }], ['planSave', { core, plan: {} }]].map(([a, b]) => api(g, a, b)));
      ok('Access', 'but not change anything, and not open Users & access', writes.every((x) => !x.ok), writes.map((x) => x.ok).join(','));
      await g.click('#who'); await sleep(400);
      ok('Access', 'clicking their name says they sign in with Google (no password here)', /Google account/.test(await g.textContent('#modal')));
      await g.click('#modal [data-close]');
      r = await api(g, 'loginGoogle', { credential: 'good.alice.sig' });
      // the Owner sees them in Users & access and can switch them off
      await p.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' }); await p.fill('[name=username]', 'sashi73'); await p.fill('[name=password]', 'sashi98'); await p.click('#loginForm button'); await p.waitForSelector('#app:not([hidden])');
      await p.goto(`${BASE}/admin/#users`); await p.waitForSelector('tr[data-uid]');
      const urows = await p.$$eval('tr[data-uid]', (x) => x.map((e) => e.textContent));
      ok('Users', 'Users & access lists them once as "G Google · view only"', urows.length === 1 && /G Google/.test(urows[0]) && /view only/.test(urows[0]) && /alice\.tester@gmail\.com/.test(urows[0]), urows.join(' / '));
      await p.click('tr[data-uid]'); await p.waitForSelector('#usActive'); await p.uncheck('#usActive'); await p.click('#usSave'); await sleep(1000);
      r = await api(g, 'planList', {});
      ok('Users', 'switching it off signs them out straight away, and they can\'t sign in with Google again', !r.ok && !(await api(g, 'loginGoogle', { credential: 'good.alice.sig' })).ok);
      r = await api(g, 'login', { username: 'alice.tester@gmail.com', password: '' });
      ok('Checks', 'a Google account can\'t sign in with a password', !r.ok);
      await g.goto(`${BASE}/admin/`); await sleep(500); await g.screenshot({ path: path.join(os.tmpdir(), 'google-login.png') });
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
