// v35: Mr. Fixit "Start again" (clears the chat, back to the main menu) and an always-available "Main menu".
// Local site, real Blobs, Chromium. The chat's AI is not set up here, so free questions get the "team will answer" reply.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const SITE = path.resolve(process.argv[2]);
const PORT = 8935, BASE = `http://127.0.0.1:${PORT}`;
const results = [];
const ok = (area, name, pass, detail = '') => results.push({ area, name, pass: !!pass, detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const START = ['Ask a repair question', 'I have a leak', 'Something else is broken', 'Get a free quote', 'What do you do?', 'How much does it cost?'];

(async () => {
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-chat-restart-blobs'); fs.rmSync(dir, { recursive: true, force: true });
  const blobs = new BlobsServer({ directory: dir, token: 'tok', port: 0 });
  const { port: bport } = await blobs.start();
  const ctxB64 = Buffer.from(JSON.stringify({ siteID: 'mbs', token: 'tok', edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, apiURL: `http://localhost:${bport}` })).toString('base64');
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NETLIFY_BLOBS_CONTEXT: ctxB64, LLM_API_KEY: '', TELEGRAM_BOT_TOKEN: '', RESEND_API_KEY: '' };
  const srv = spawn('node', ['local-server.mjs'], { cwd: SITE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 40 && !/running/.test(log); i++) await sleep(150);
  let br = null;
  try {
    br = await chromium.launch();
    const errors = [];
    const p = await (await br.newContext({ viewport: { width: 1400, height: 900 } })).newPage(); p.setDefaultTimeout(15000);
    p.on('pageerror', (e) => errors.push(e.message)); p.on('dialog', (x) => { errors.push('dialog: ' + x.message()); x.dismiss(); });
    const chips = () => p.$$eval('.fx-chips .fx-chip', (x) => x.map((c) => c.textContent.trim()));
    const msgs = () => p.$$eval('.fx-list .fx-msg:not(.fx-typing)', (x) => x.map((c) => c.textContent.trim()));
    const idle = async () => { await sleep(300); await p.waitForFunction(() => !document.querySelector('.fx-typing') && document.querySelectorAll('.fx-chips .fx-chip').length > 0, null, { timeout: 15000 }); await sleep(250); };
    const tap = async (label) => { await p.locator('.fx-chips .fx-chip', { hasText: label }).first().click(); await idle(); };
    const type = async (t) => { await p.fill('.fx-input', t); await p.press('.fx-input', 'Enter'); await idle(); };
    const stored = () => p.evaluate(() => JSON.parse(sessionStorage.getItem('mbsFixit.v1') || 'null'));

    await p.goto(`${BASE}/projects.html`, { waitUntil: 'networkidle' });
    await p.$eval('.fx-launch', (e) => e.click()); await idle();
    let c = await chips();
    ok('Menu', 'opens on the main menu, with no extra "Main menu" chip there', JSON.stringify(c) === JSON.stringify(START), c.join(' | '));
    ok('Start again', 'the footer has a "Start again" button next to the phone number', /Start again/.test(await p.textContent('.fx-foot .fx-restart')) && /Call/.test(await p.textContent('.fx-foot')));

    // Main menu from the middle of an enquiry
    await tap('Get a free quote');
    c = await chips();
    ok('Menu', 'in the middle of a quote request, "☰ Main menu" is on offer', c.includes('☰ Main menu'), c.join(' | '));
    const before = (await msgs()).length;
    await tap('Main menu');
    c = await chips(); const s1 = await stored();
    ok('Menu', 'Main menu: stops the quote request and shows the main choices', JSON.stringify(c) === JSON.stringify(START) && s1.flow === null, c.join(' | '));
    ok('Menu', '...and keeps the conversation so far on screen', (await msgs()).length > before);

    // Main menu from Q&A mode: exactly one menu chip
    await tap('Ask a repair question');
    c = await chips();
    ok('Menu', 'in repair Q&A there is exactly one "☰ Main menu"', c.filter((x) => /Main menu/.test(x)).length === 1, c.join(' | '));
    await type('My gutter is overflowing');
    c = await chips();
    ok('Menu', 'after any answer, Main menu is still there', c.some((x) => /Main menu/.test(x)), c.join(' | '));

    // typed "main menu"
    await type('main menu');
    ok('Menu', 'typing "main menu" goes to the main menu', JSON.stringify(await chips()) === JSON.stringify(START));

    // Start again: asks first, "Keep chatting" keeps everything
    const keep = (await msgs()).length;
    await p.click('.fx-restart');
    ok('Start again', 'asks "Clear this chat and start again?" first', await p.isVisible('.fx-confirm') && /start again/i.test(await p.textContent('.fx-confirm')));
    await p.click('.fx-confirm .fx-no'); await sleep(200);
    ok('Start again', '"Keep chatting" closes the question and keeps the chat', !(await p.isVisible('.fx-confirm')) && (await msgs()).length === keep);

    // Start again: clears the chat (screen and saved copy), back to the main menu
    await tap('Get a free quote');
    await p.click('.fx-restart'); await p.click('.fx-confirm .fx-yes'); await idle();
    let m = await msgs(); const s2 = await stored();
    ok('Start again', '"Yes, start again" clears the chat and shows a fresh start', m.length === 2 && /Fresh start/.test(m[0]) && !m.some((x) => /free quote/i.test(x)), JSON.stringify(m));
    ok('Start again', 'back on the main menu, nothing half-done left behind', JSON.stringify(await chips()) === JSON.stringify(START) && s2.flow === null && s2.mode === null && s2.log.length === 2);

    // a reply still on its way from the old chat never shows up in the new one
    await p.locator('.fx-chips .fx-chip', { hasText: 'What do you do?' }).click();
    await sleep(150);
    await p.click('.fx-restart'); await p.click('.fx-confirm .fx-yes'); await idle(); await sleep(2500);
    m = await msgs();
    ok('Start again', 'tapping Start again while Mr. Fixit is answering: the old answer never appears', m.length === 2 && /Fresh start/.test(m[0]), JSON.stringify(m));

    // nothing typed yet: no question, just a fresh start
    await p.click('.fx-restart'); await idle();
    ok('Start again', 'with nothing said yet, Start again just starts fresh (no question)', !(await p.isVisible('.fx-confirm')) && (await msgs()).length === 2);

    // typed "start again"
    await tap('Ask a repair question'); await type('start again');
    m = await msgs();
    ok('Start again', 'typing "start again" also clears the chat', m.length === 2 && /Fresh start/.test(m[0]), JSON.stringify(m));

    // Escape closes the question, not the chat
    await tap('Get a free quote'); await p.click('.fx-restart');
    await p.keyboard.press('Escape'); await sleep(200);
    ok('Start again', 'Escape cancels the question and leaves the chat open', !(await p.isVisible('.fx-confirm')) && await p.isVisible('.fx-panel.open'));

    // after a page reload the cleared chat stays cleared
    await p.click('.fx-restart'); await p.click('.fx-confirm .fx-yes'); await idle();
    await p.reload({ waitUntil: 'networkidle' }); await p.$eval('.fx-launch', (e) => e.click()); await sleep(800);
    ok('Start again', 'reload the page: the old chat does not come back', (await msgs()).length === 2);

    // phone
    const q = await (await br.newContext({ viewport: { width: 390, height: 800 } })).newPage();
    q.on('pageerror', (e) => errors.push(e.message));
    await q.goto(`${BASE}/services.html`, { waitUntil: 'networkidle' }); await q.$eval('.fx-launch', (e) => e.click()); await sleep(2500);
    await q.locator('.fx-chips .fx-chip', { hasText: 'Get a free quote' }).click(); await sleep(2500);
    await q.click('.fx-restart'); await sleep(300);
    const fb = await q.locator('.fx-foot').boundingBox(), rb = await q.locator('.fx-restart').boundingBox(), cf = await q.locator('.fx-confirm').boundingBox();
    ok('Phone', 'phone: Start again and the question fit on screen', rb && rb.x + rb.width <= 390 && cf && cf.width <= 390 && fb && (await q.evaluate(() => document.documentElement.scrollWidth)) <= 391);
    await q.screenshot({ path: path.join(__dirname, 'shot35-chat-phone.png') });
    await p.screenshot({ path: path.join(__dirname, 'shot35-chat.png') });
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close(); br = null;
  } catch (e) { try { if (br) await br.close(); } catch {} ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ')); }
  try { srv.kill(); } catch {} try { await blobs.stop(); } catch {}
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(0);
})();
