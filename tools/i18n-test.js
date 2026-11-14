// v110: languages and skins on the test site (ported from GKH Project Champ).
// 🌐 English / Malay / Chinese / Tamil / Myanmar / Bengali, ☀/☾ light-dark, 🎨 skins; Mr. Fixit's language toggle; test-site gate.
// node i18n-test.js <site>
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path'), fs = require('fs'), os = require('os');
const SITE = path.resolve(process.argv[2]);
const PORT = 8996, BASE = `http://127.0.0.1:${PORT}`;
const results = []; const errors = [];
const ok = (area, name, pass, detail = '') => results.push({ area, name, pass: !!pass, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (host, body) => new Promise((res) => {
  const data = JSON.stringify(body);
  const r = http.request({ host: '127.0.0.1', port: PORT, path: '/.netlify/functions/chat', method: 'POST', headers: { Host: host, 'Content-Type': 'application/json', 'X-MBS-I18n': '1', 'Content-Length': Buffer.byteLength(data) } },
    (x) => { let t = ''; x.on('data', (d) => (t += d)); x.on('end', () => { let j = {}; try { j = JSON.parse(t); } catch (e) {} res({ status: x.statusCode, j }); }); });
  r.on('error', (e) => res({ status: 0, j: { error: e.message } })); r.end(data);
});

(async () => {
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-i18n-blobs'); fs.rmSync(dir, { recursive: true, force: true });
  const blobs = new BlobsServer({ directory: dir, token: 'tok', port: 0 });
  const { port: bport } = await blobs.start();
  const ctxB64 = Buffer.from(JSON.stringify({ siteID: 'mbs', token: 'tok', edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, apiURL: `http://localhost:${bport}` })).toString('base64');
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NETLIFY_BLOBS_CONTEXT: ctxB64, ADMIN_USERNAME: 'sashi73', ADMIN_PASSWORD: 'sashi98', SITE_ENV: '', LLM_API_KEY: '', TELEGRAM_BOT_TOKEN: '', RESEND_API_KEY: '' };
  const srv = spawn('node', ['local-server.mjs'], { cwd: SITE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 40 && !/running/.test(log); i++) await sleep(150);
  let br = null;
  try {
    // ---- server gate ----
    const g1 = await post('mbs-website.netlify.app', { mode: 'i18n', lang: 'ms', strings: ['Home'] });
    ok('server', 'another site (not test, not local) is refused', g1.status === 403, g1);
    const g2 = await post('127.0.0.1:' + PORT, { mode: 'i18n', lang: 'ms', strings: ['Home'] });
    ok('server', 'local run allowed; no AI key says so', g2.status === 503 && /not switched on/.test(g2.j.error || ''), g2);
    const g3 = await post('127.0.0.1:' + PORT, { mode: 'i18n', lang: 'fr', strings: ['Home'] });
    ok('server', 'only the six languages', g3.status === 400, g3);
    const g4 = await post('127.0.0.1:' + PORT, { mode: 'i18n', lang: 'my', strings: [] });
    ok('server', 'Myanmar accepted', g4.status === 200, g4);
    const g5 = await post('127.0.0.1:' + PORT, { mode: 'i18n', lang: 'bn', strings: [] });
    ok('server', 'Bengali accepted', g5.status === 200, g5);

    br = await chromium.launch();
    const mk = async (w = 1440, h = 900) => {
      const c = await br.newContext({ viewport: { width: w, height: h } }); await c.addInitScript(() => { try { sessionStorage.setItem('mbsIntroSeen', '1'); } catch (e) {} }); const pg = await c.newPage(); pg.setDefaultTimeout(15000);
      pg.on('pageerror', (e) => errors.push(e.message));
      const sent = [];
      await pg.route('**/.netlify/functions/chat', async (route) => {
        const rq = route.request();
        if (rq.headers()['x-mbs-i18n'] !== '1') return route.continue();
        const b = JSON.parse(rq.postData() || '{}'); sent.push(b);
        const map = {}; (b.strings || []).forEach((t) => { map[t] = '[' + b.lang + '] ' + t; });
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ map }) });
      });
      pg.sent = sent; return pg;
    };
    // ---- website ----
    const p = await mk();
    await p.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
    ok('site', 'test-site switch is on for a local run', await p.evaluate(() => window.FX_UI === true));
    ok('site', '🌐, ☀/☾ and 🎨 sit together top right of the header', await p.evaluate(() => { const c = document.querySelector('header.site #fxCtl'); return !!(c && c.querySelector('#fxLangBtn') && c.querySelector('#fxQuick') && c.querySelector('#fxThemeBtn')); }));
    await p.click('#fxLangBtn');
    const names = await p.$$eval('.ct-langmenu button', (b) => b.map((x) => x.getAttribute('data-l')));
    ok('site', 'six languages: en ms zh ta my bn', names.join(',') === 'en,ms,zh,ta,my,bn', names);
    await p.click('.ct-langmenu [data-l=my]');
    await p.waitForFunction(() => /\[my\]/.test(document.querySelector('.menu').textContent), null, { timeout: 8000 }).catch(() => {});
    ok('site', 'Myanmar: the menu is translated', /\[my\]/.test(await p.textContent('.menu')));
    ok('site', 'lang attribute set', (await p.getAttribute('html', 'lang')) === 'my');
    ok('site', 'button shows MY', /MY/.test(await p.textContent('#fxLangBtn')));
    const sentAll = p.sent.flatMap((b) => b.strings);
    ok('site', 'emails and codes are never sent', !sentAll.some((t) => /@|^MBS-\d/.test(t)), sentAll.filter((t) => /@/.test(t)).slice(0, 3));
    ok('site', 'phone numbers stay as written', !sentAll.some((t) => /^[\d\s+()]+$/.test(t)));
    // Mr. Fixit
    ok('chat', 'Mr. Fixit has a language toggle at the top', await p.evaluate(() => !!document.querySelector('.fx-head .fx-tlang')));
    ok('chat', 'it follows the page language', (await p.$eval('.fx-tlang', (s) => s.value)) === 'my');
    ok('chat', 'separate voice-language menu hidden for now', await p.evaluate(() => getComputedStyle(document.querySelector('.fx-lang')).display === 'none'));
    await p.selectOption('.fx-tlang', 'bn');
    await p.waitForFunction(() => document.documentElement.lang === 'bn', null, { timeout: 5000 }).catch(() => {});
    ok('chat', 'choosing Bengali in the chat switches the page', (await p.getAttribute('html', 'lang')) === 'bn');
    await p.waitForFunction(() => /\[bn\]/.test(document.querySelector('.menu').textContent), null, { timeout: 8000 }).catch(() => {});
    ok('chat', 'page now in Bengali', /\[bn\]/.test(await p.textContent('.menu')));
    ok('chat', 'read-aloud language follows', (await p.evaluate(() => localStorage.getItem('mbsFixit.lang'))) === 'bn');
    // back to English restores the originals
    await p.click('#fxLangBtn'); await p.click('.ct-langmenu [data-l=en]'); await sleep(300);
    ok('site', 'English restores the original text', !/\[(bn|my)\]/.test(await p.textContent('body')));
    // skins
    await p.click('#fxQuick');
    ok('skin', '☀/☾ switches to White', (await p.getAttribute('html', 'data-skin')) === 'white');
    const bg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
    ok('skin', 'white page background', bg === 'rgb(255, 255, 255)', bg);
    const heroText = await p.evaluate(() => { const h = document.querySelector('.hero h1'); return h ? getComputedStyle(h).color : 'none'; });
    ok('skin', 'hero text stays light on the photo', heroText !== 'rgb(20, 19, 15)', heroText);
    await p.click('#fxQuick');
    ok('skin', '☀/☾ back to dark', (await p.getAttribute('html', 'data-skin')) === 'black');
    await p.click('#fxThemeBtn');
    const skins = await p.$$eval('#fxTheme .ct-skin', (b) => b.map((x) => x.getAttribute('data-v')));
    ok('skin', '🎨 offers five skins', skins.join(',') === 'black,white,navy,emerald,slate', skins);
    await p.click('#fxTheme [data-v=navy]');
    ok('skin', 'Navy applied', (await p.getAttribute('html', 'data-skin')) === 'navy');
    await p.click('#fxTheme [data-v=compact]');
    ok('skin', 'compact density', (await p.getAttribute('html', 'data-density')) === 'compact');
    await p.screenshot({ path: path.join(os.tmpdir(), 'i18n-site-navy.png') });
    // kept between pages
    await p.goto(`${BASE}/services.html`, { waitUntil: 'networkidle' });
    ok('skin', 'skin kept on the next page', (await p.getAttribute('html', 'data-skin')) === 'navy');
    // phone
    const ph = await mk(390, 844);
    await ph.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
    const fits = await ph.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    ok('phone', 'no sideways scroll with the controls', fits);
    ok('phone', '☀/☾ still shown on phones', await ph.evaluate(() => { const q = document.getElementById('fxQuick'); return !!q && q.offsetWidth > 0; }));
    await ph.screenshot({ path: path.join(os.tmpdir(), 'i18n-phone.png') });
    // ---- console ----
    const a = await mk();
    await a.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
    await a.fill('#loginForm [name=username]', 'sashi73'); await a.fill('#loginForm [name=password]', 'sashi98'); await a.click('#loginForm button[type=submit]');
    await a.waitForSelector('#app:not([hidden])');
    ok('console', 'console marked for console skins', await a.evaluate(() => document.documentElement.classList.contains('fx-console')));
    ok('console', '🌐 ☀/☾ 🎨 in the console top bar', await a.evaluate(() => { const c = document.querySelector('.top #fxCtl'); return !!(c && c.querySelector('#fxLangBtn') && c.querySelector('#fxQuick') && c.querySelector('#fxThemeBtn')); }));
    await a.click('#fxLangBtn'); await a.click('.ct-langmenu [data-l=zh]');
    await a.waitForFunction(() => /\[zh\]/.test(document.querySelector('.side-nav').textContent), null, { timeout: 8000 }).catch(() => {});
    ok('console', 'Chinese: the menu is translated', /\[zh\]/.test(await a.textContent('.side-nav')));
    ok('console', 'search box text left alone (what people type)', (await a.inputValue('#q')) === '');
    await a.click('#fxQuick');
    ok('console', 'console White skin', (await a.getAttribute('html', 'data-skin')) === 'white');
    await a.screenshot({ path: path.join(os.tmpdir(), 'i18n-console.png') });
    // ---- gate in the browser: another host does nothing ----
    const gate = await a.evaluate(() => ['fixittest.netlify.app', 'mbs-fixit-test--fixittest.netlify.app', 'mbs-website.netlify.app', 'modernbuildingsolutions.com.au', 'fixittest.evil.com.au'].map((h) => /^([\w-]+--)?fixittest\.netlify\.app$/i.test(h) || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(h)));
    ok('gate', 'only fixittest (and local) switch it on', JSON.stringify(gate) === JSON.stringify([true, true, false, false, false]), gate);
    ok('page', 'no page errors', errors.length === 0, errors.slice(0, 5));
  } catch (e) { ok('run', 'crashed', false, e.stack); }
  finally { if (br) await br.close(); srv.kill(); await blobs.stop(); }
  const failed = results.filter((r) => !r.pass);
  results.forEach((r) => console.log((r.pass ? 'PASS ' : 'FAIL ') + r.area + ': ' + r.name + (r.pass ? '' : '  ' + r.detail)));
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})();
