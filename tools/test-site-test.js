// v32 test-site switch: build step (badge, no Google), email and Telegram on the test site, and the live site unchanged.
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const SITE = path.resolve(process.argv[2]);
const results = [];
const ok = (area, name, pass, detail = '') => results.push({ area, name, pass: !!pass, detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function copySite(dest) {
  fs.rmSync(dest, { recursive: true, force: true }); fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(SITE)) {
    if (f === 'node_modules') { fs.symlinkSync(path.join(SITE, f), path.join(dest, f)); continue; }
    fs.cpSync(path.join(SITE, f), path.join(dest, f), { recursive: true });
  }
}
const htmlFiles = (d) => [...fs.readdirSync(d).filter((f) => f.endsWith('.html')).map((f) => path.join(d, f)), ...fs.readdirSync(path.join(d, 'admin')).filter((f) => f.endsWith('.html')).map((f) => path.join(d, 'admin', f))];
const snap = (d) => htmlFiles(d).map((f) => fs.readFileSync(f, 'utf8')).join('\n') + fs.readFileSync(path.join(d, 'robots.txt'), 'utf8');

(async () => {
  // ---------- 1. the build step ----------
  const live = path.join(os.tmpdir(), 'mbs32-live'), test = path.join(os.tmpdir(), 'mbs32-test');
  copySite(live); copySite(test);
  const before = snap(live);
  const envNo = { ...process.env }; delete envNo.SITE_ENV;
  const outLive = execFileSync('node', ['tools/site-env.mjs'], { cwd: live, env: envNo }).toString();
  ok('Build', 'live site (no SITE_ENV): the build step changes nothing', snap(live) === before && !fs.existsSync(path.join(live, '_headers')) && /nothing to change/.test(outLive));
  const outLive2 = execFileSync('node', ['tools/site-env.mjs'], { cwd: live, env: { ...envNo, SITE_ENV: 'production' } }).toString();
  ok('Build', 'any other SITE_ENV value also changes nothing', snap(live) === before && /nothing to change/.test(outLive2));
  const out = execFileSync('node', ['tools/site-env.mjs'], { cwd: test, env: { ...envNo, SITE_ENV: 'Test' } }).toString();
  const files = htmlFiles(test);
  const all = files.map((f) => fs.readFileSync(f, 'utf8'));
  ok('Build', `test site: every page (${files.length}) gets the TEST badge`, all.every((h) => (h.match(/id="mbs-test-badge"/g) || []).length === 1) && files.length >= 7, out.trim());
  ok('Build', 'every page title starts with "TEST ·" and says noindex', all.every((h) => /<title>TEST · /.test(h) && /<meta name="robots" content="noindex, nofollow">/.test(h)));
  ok('Build', 'robots.txt blocks the whole test site; _headers says noindex', fs.readFileSync(path.join(test, 'robots.txt'), 'utf8') === 'User-agent: *\nDisallow: /\n' && /X-Robots-Tag: noindex, nofollow/.test(fs.readFileSync(path.join(test, '_headers'), 'utf8')));
  execFileSync('node', ['tools/site-env.mjs'], { cwd: test, env: { ...envNo, SITE_ENV: 'test' } });
  ok('Build', 'running it twice does not add a second badge', htmlFiles(test).every((f) => (fs.readFileSync(f, 'utf8').match(/id="mbs-test-badge"/g) || []).length === 1 && (fs.readFileSync(f, 'utf8').match(/TEST · /g) || []).length === 1));
  const toml = fs.readFileSync(path.join(SITE, 'netlify.toml'), 'utf8');
  ok('Build', 'netlify.toml runs the build step; the setup guide is not public', /command = "node tools\/site-env\.mjs"/.test(toml) && /from = "\/TEST-SITE-SETUP\.txt"/.test(toml) && fs.existsSync(path.join(SITE, 'TEST-SITE-SETUP.txt')));

  // ---------- 2. email and Telegram ----------
  const got = [];
  const mock = http.createServer((q, r) => { let b = ''; q.on('data', (d) => (b += d)); q.on('end', () => { got.push({ url: q.url, body: b }); r.writeHead(200, { 'Content-Type': 'application/json' }); r.end('{"ok":true,"id":"x"}'); }); });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${mock.address().port}`;
  Object.assign(process.env, { RESEND_API_KEY: 'k', RESEND_API_BASE: base, TELEGRAM_API_BASE: base, TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: '111', OWNER_EMAIL: 'sashi1973@gmail.com' });
  delete process.env.SITE_ENV; delete process.env.TELEGRAM_ALERT_IDS;
  const S = await import(path.join(SITE, 'netlify/lib/shared.mjs'));
  const last = () => JSON.parse(got[got.length - 1].body);
  await S.sendEmail({ subject: 'New enquiry', html: '<p>x</p>', text: 'x' });
  ok('Live', 'live site: owner email unchanged', last().subject === 'New enquiry' && last().to.join() === 'sashi1973@gmail.com');
  await S.sendEmail({ subject: 'Your quote Q-1', html: 'x', text: 'x', to: 'ella@example.com', bcc: 'sashi1973@gmail.com' });
  ok('Live', 'live site: a customer email still goes to the customer (with bcc)', last().to.join() === 'ella@example.com' && last().subject === 'Your quote Q-1' && last().bcc.join() === 'sashi1973@gmail.com');
  await S.sendTelegram('<b>New enquiry</b>');
  ok('Live', 'live site: Telegram alert unchanged', last().text === '<b>New enquiry</b>');

  process.env.SITE_ENV = 'test';
  await S.sendEmail({ subject: 'New enquiry', html: '<p>x</p>', text: 'x' });
  ok('Test', 'test site: owner email has [TEST] in the subject', last().subject === '[TEST] New enquiry' && last().to.join() === 'sashi1973@gmail.com');
  await S.sendEmail({ subject: 'Your quote Q-1', html: 'x', text: 'x', to: 'ella@example.com', bcc: 'someone@example.com' });
  ok('Test', 'test site: a customer email goes to you instead, and says who it was meant for', last().to.join() === 'sashi1973@gmail.com' && last().subject === '[TEST] Your quote Q-1 (would have gone to ella@example.com)' && !last().bcc, JSON.stringify(last()));
  await S.sendTelegram('<b>New enquiry</b>');
  ok('Test', 'test site: Telegram alert is marked 🧪 TEST', last().text === '🧪 <b>TEST</b>\n<b>New enquiry</b>');
  mock.close();

  // ---------- 3. how it looks ----------
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const bdir = path.join(os.tmpdir(), 'mbs32-blobs'); fs.rmSync(bdir, { recursive: true, force: true });
  const blobs = new BlobsServer({ directory: bdir, token: 'tok', port: 0 });
  const { port: bport } = await blobs.start();
  const ctxB64 = Buffer.from(JSON.stringify({ siteID: 'mbs', token: 'tok', edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, apiURL: `http://localhost:${bport}` })).toString('base64');
  const env = { ...process.env, NETLIFY_BLOBS_CONTEXT: ctxB64, PORT: '8932', HOST: '127.0.0.1', LLM_API_KEY: '', TELEGRAM_BOT_TOKEN: '', RESEND_API_KEY: '', ADMIN_USERNAME: 'sashi73', ADMIN_PASSWORD: 'sashi98' };
  const srv = spawn('node', ['local-server.mjs'], { cwd: test, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 40 && !/running/.test(log); i++) await sleep(150);
  let br;
  try {
    br = await chromium.launch();
    const errors = [];
    for (const [name, w, h] of [['desktop', 1400, 900], ['phone', 390, 800]]) {
      const p = await br.newPage({ viewport: { width: w, height: h } });
      p.on('pageerror', (e) => errors.push(e.message));
      await p.goto('http://127.0.0.1:8932/', { waitUntil: 'networkidle' });
      const box = await p.locator('#mbs-test-badge').boundingBox();
      ok('Looks', `${name}: the badge shows at the top of the website`, box && box.y === 0 && box.width < w && /TEST SITE/.test(await p.textContent('#mbs-test-badge')));
      ok('Looks', `${name}: the badge does not block clicks`, (await p.evaluate(() => getComputedStyle(document.getElementById('mbs-test-badge')).pointerEvents)) === 'none');
      await p.screenshot({ path: path.join(__dirname, `shot32-site-${name}.png`) });
      await p.close();
    }
    const p = await br.newPage({ viewport: { width: 1400, height: 900 } });
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto('http://127.0.0.1:8932/admin/', { waitUntil: 'networkidle' });
    ok('Looks', 'the MBS Console login also shows the badge', await p.isVisible('#mbs-test-badge') && /^TEST · /.test(await p.title()));
    await p.fill('[name=username]', 'sashi73'); await p.fill('[name=password]', 'sashi98'); await p.click('#loginForm button');
    await p.waitForSelector('#app:not([hidden])');
    ok('Looks', 'after logging in the Console works with the badge', await p.isVisible('#mbs-test-badge'));
    await p.screenshot({ path: path.join(__dirname, 'shot32-admin.png') });
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close();
  } catch (e) { try { await br.close(); } catch {} ok('Run', 'completed', false, e.stack.split('\n').slice(0, 3).join(' / ') + '\n' + log.slice(-800)); }
  srv.kill(); try { await blobs.stop(); } catch {}
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(0);
})();
