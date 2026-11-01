// v55: the console menu folds into a slim strip of icons and comes back: tap the ‹ › tab, drag it, swipe the menu, or press [.
// Remembered after a reload; phones keep the slide-in menu. Real Blobs, local TEST site copy (GKH branding), Chromium.
const { chromium } = require('playwright');
const { spawn, spawnSync } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const SRC = path.resolve(process.argv[2]);
const PORT = 8955, BASE = `http://127.0.0.1:${PORT}`;
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => results.push({ area, name, pass: !!pass, detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const SITE = path.join(os.tmpdir(), 'mbs-fold-site'); fs.rmSync(SITE, { recursive: true, force: true });
  fs.cpSync(SRC, SITE, { recursive: true, filter: (s) => !/[\\/](node_modules|\.git)$/.test(s) });
  fs.symlinkSync(path.join(SRC, 'node_modules'), path.join(SITE, 'node_modules'));
  spawnSync('node', ['tools/site-env.mjs', '.'], { cwd: SITE, env: { ...process.env, SITE_ENV: 'test' } });
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SRC] }));
  const dir = path.join(os.tmpdir(), 'mbs-fold-blobs'); fs.rmSync(dir, { recursive: true, force: true });
  const blobs = new BlobsServer({ directory: dir, token: 'tok', port: 0 });
  const { port: bport } = await blobs.start();
  const ctxB64 = Buffer.from(JSON.stringify({ siteID: 'mbs', token: 'tok', edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, apiURL: `http://localhost:${bport}` })).toString('base64');
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NETLIFY_BLOBS_CONTEXT: ctxB64, ADMIN_USERNAME: 'sashi73', ADMIN_PASSWORD: 'sashi98', SITE_ENV: 'test', LLM_API_KEY: '', TELEGRAM_BOT_TOKEN: '', RESEND_API_KEY: '' };
  const srv = spawn('node', ['local-server.mjs'], { cwd: SITE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 40 && !/running/.test(log); i++) await sleep(150);
  let br = null;
  try {
    br = await chromium.launch();
    const ctx = await br.newContext({ viewport: { width: 1400, height: 900 }, hasTouch: true });
    const p = await ctx.newPage(); p.setDefaultTimeout(15000);
    const errors = []; errorsAll = errors; p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
    await p.fill('[name=username]', 'sashi73'); await p.fill('[name=password]', 'sashi98'); await p.click('#loginForm button');
    await p.waitForSelector('#app:not([hidden])'); await p.goto(`${BASE}/admin/#jobs`); await sleep(400);
    const sw = async () => (await p.$eval('#side', (s) => s.getBoundingClientRect().width));
    const mainW = async () => (await p.$eval('.main', (s) => s.getBoundingClientRect().width));
    const w0 = await sw(), m0 = await mainW();
    ok('Start', 'the full menu shows with a ‹ tab on its edge', w0 > 200 && (await p.textContent('#sideFold')) === '‹' && await p.isVisible('#sideFold'), w0);
    await p.click('#sideFold'); await sleep(400);
    const w1 = await sw(), m1 = await mainW();
    ok('Tap', 'one tap folds it to a slim strip of icons and the page gets the room', w1 <= 70 && m1 > m0 + 150 && (await p.textContent('#sideFold')) === '›', w1 + ' / ' + m0 + '→' + m1);
    const nav = await p.$$eval('.side-nav a', (x) => x.map((a) => ({ w: a.getBoundingClientRect().width, icon: getComputedStyle(a.querySelector('i')).fontSize, title: a.title })));
    ok('Icons', 'the icons stay, the names show as tooltips', nav.every((a) => a.w <= 60 && parseFloat(a.icon) >= 15 && a.title.length > 2), JSON.stringify(nav.slice(0, 2)));
    await p.click('.side-nav a[data-nav=customers]'); await sleep(300);
    ok('Icons', 'the icons still work as links', /#customers/.test(await p.evaluate(() => location.hash)));
    await p.screenshot({ path: path.join(__dirname, 'shot55-folded.png') });
    await p.reload(); await p.waitForSelector('#app:not([hidden])'); await sleep(400);
    ok('Remember', 'it stays folded after a reload', (await sw()) <= 70);
    await p.click('#sideFold'); await sleep(400);
    ok('Tap', 'tapping › brings the full menu back', (await sw()) > 200 && (await p.textContent('#sideFold')) === '‹');
    // drag the tab like a slider
    const b = await p.$eval('#sideFold', (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await p.mouse.move(b.x, b.y); await p.mouse.down(); await p.mouse.move(b.x - 60, b.y, { steps: 6 }); await p.mouse.up(); await sleep(400);
    ok('Slide', 'dragging the tab left folds it', (await sw()) <= 70);
    const b2 = await p.$eval('#sideFold', (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await p.mouse.move(b2.x, b2.y); await p.mouse.down(); await p.mouse.move(b2.x + 80, b2.y, { steps: 6 }); await p.mouse.up(); await sleep(400);
    ok('Slide', 'dragging it right brings it back', (await sw()) > 200);
    // swipe on a touch screen
    const swipe = (x0, x1) => p.evaluate(([a, b]) => { const s = document.getElementById('side'); const T = (x) => new Touch({ identifier: 1, target: s, clientX: x, clientY: 300 });
      s.dispatchEvent(new TouchEvent('touchstart', { touches: [T(a)], changedTouches: [T(a)], bubbles: true })); s.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [T(b)], bubbles: true })); }, [x0, x1]);
    await swipe(180, 40); await sleep(400);
    ok('Swipe', 'swiping the menu left folds it', (await sw()) <= 70);
    await swipe(20, 140); await sleep(400);
    ok('Swipe', 'swiping right brings it back', (await sw()) > 200);
    await p.keyboard.press('['); await sleep(400); const k1 = await sw(); await p.keyboard.press('['); await sleep(400);
    ok('Keys', 'the [ key folds and unfolds it', k1 <= 70 && (await sw()) > 200);
    await p.click('#topSearch input'); await p.keyboard.press('['); await sleep(300);
    ok('Keys', 'typing [ in a box does not fold it', (await sw()) > 200);
    await p.keyboard.press('Escape');
    // test-site branding: the globe stays, the words hide
    await p.click('#sideFold'); await sleep(400);
    ok('Brand', 'folded, the logo stays and the words are hidden', await p.$eval('.side-brand img', (i) => i.getBoundingClientRect().width > 30 && i.getBoundingClientRect().width < 60) && !(await p.isVisible('.side-brand span')));
    // phone: the slide-in menu is unchanged even if folded on a computer
    await p.setViewportSize({ width: 390, height: 844 }); await sleep(400);
    ok('Phone', 'on a phone the tab is hidden and the ☰ menu slides in with full names', !(await p.isVisible('#sideFold')) && await p.isVisible('#menuBtn'));
    await p.click('#menuBtn'); await sleep(400);
    ok('Phone', 'the phone menu shows the names', (await p.$eval('#side', (s) => s.getBoundingClientRect().width)) > 200 && (await p.$eval('.side-nav a[data-nav=jobs]', (a) => parseFloat(getComputedStyle(a).fontSize))) > 10);
    ok('Phone', 'no sideways scrolling', (await p.evaluate(() => document.documentElement.scrollWidth)) <= 391);
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close(); br = null;
  } catch (e) { try { if (br) await br.close(); } catch {} ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ')); }
  try { srv.kill(); } catch {} try { await blobs.stop(); } catch {}
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(0);
})();
