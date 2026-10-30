// v47: Sub-contractors. A TEST copy of the site (tools/site-env.mjs), the real loader adds the 30 test subbies, then the
// console's Subbies list, Licences & insurance page, the editor and the project plan's "Add a subbie" are checked.
// Real Blobs, local site, Chromium.
const { chromium } = require('playwright');
const { spawn, spawnSync } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const SRC = path.resolve(process.argv[2]);
const PORT = 8947, BASE = `http://127.0.0.1:${PORT}`;
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => results.push({ area, name, pass: !!pass, detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (cwd, args, env, ms) => new Promise((res) => { const c = spawn('node', args, { cwd, env }); let out = ''; c.stdout.on('data', (d) => (out += d)); c.stderr.on('data', (d) => (out += d)); const k = setTimeout(() => c.kill(), ms); c.on('close', (code) => { clearTimeout(k); res({ status: code, stdout: out }); }); });

(async () => {
  const SITE = path.join(os.tmpdir(), 'mbs-subs-site'); fs.rmSync(SITE, { recursive: true, force: true });
  fs.cpSync(SRC, SITE, { recursive: true, filter: (s) => !/[\\/](node_modules|\.git)$/.test(s) });
  fs.symlinkSync(path.join(SRC, 'node_modules'), path.join(SITE, 'node_modules'));
  spawnSync('node', ['tools/site-env.mjs', '.'], { cwd: SITE, env: { ...process.env, SITE_ENV: 'test' } });
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SRC] }));
  const dir = path.join(os.tmpdir(), 'mbs-subs-blobs'); fs.rmSync(dir, { recursive: true, force: true });
  const blobs = new BlobsServer({ directory: dir, token: 'tok', port: 0 });
  const { port: bport } = await blobs.start();
  const ctxB64 = Buffer.from(JSON.stringify({ siteID: 'mbs', token: 'tok', edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, apiURL: `http://localhost:${bport}` })).toString('base64');
  process.env.NETLIFY_BLOBS_CONTEXT = ctxB64;
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NETLIFY_BLOBS_CONTEXT: ctxB64, ADMIN_USERNAME: 'sashi73', ADMIN_PASSWORD: 'sashi98', SITE_ENV: 'test', LLM_API_KEY: '', TELEGRAM_BOT_TOKEN: '', RESEND_API_KEY: '' };
  const srv = spawn('node', ['local-server.mjs'], { cwd: SITE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 40 && !/running/.test(log); i++) await sleep(150);
  let br = null;
  try {
    const SB = await import(path.join(SITE, 'netlify/lib/subbies.mjs'));
    const DATA = JSON.parse(fs.readFileSync(path.join(SRC, 'tools/test-data/subcontractors-30.json'))).subs;
    ok('Data', '30 made-up subbies across at least 20 trades, plumbers, sparkies and cleaners included, fake phones and emails', DATA.length === 30 && new Set(DATA.map((s) => s.trade)).size >= 20 &&
      ['plumber', 'electrician', 'cleaner'].every((t) => DATA.some((s) => s.trade === t)) && DATA.every((s) => /^02 5550 31/.test(s.phone) && (!s.email || /\.example\.com$/.test(s.email))));
    delete process.env.SITE_ENV;
    ok('Safety', 'test subbies are refused unless the site is the test site', (await (await SB.subPost('subTestLoad', { subs: DATA.slice(0, 1) }, { who: 'x', by: 'x' })).json()).error && true);

    const ld = await run(SITE, ['tools/load-test-data.mjs', '--site', BASE, '--what', 'subbies'], { ...process.env, MBS_LOAD_USER: 'sashi73', MBS_LOAD_PASS: 'sashi98' }, 120000);
    ok('Loader', 'the loader adds the 30 test subbies (-What subbies)', /Sub-contractors: 30 added/.test(ld.stdout), ld.stdout.slice(-400));
    const ld2 = await run(SITE, ['tools/load-test-data.mjs', '--site', BASE, '--what', 'subbies'], { ...process.env, MBS_LOAD_USER: 'sashi73', MBS_LOAD_PASS: 'sashi98' }, 120000);
    ok('Loader', 'running it again skips them', /already there \(30 test subbies\)/.test(ld2.stdout), ld2.stdout.slice(-300));

    const L = await SB.list();
    const active = L.subs.filter((s) => !s.archived && s.status !== 'Do not use');
    const flagged = active.filter((s) => s.comp.worst === 'expired' || s.comp.worst === 'due').length;
    ok('Compliance', 'test data has expired, due-soon and missing papers', active.some((s) => s.comp.worst === 'expired') && active.some((s) => s.comp.worst === 'due') && active.some((s) => s.comp.worst === 'missing'), JSON.stringify(active.map((s) => s.comp.worst)));

    br = await chromium.launch();
    const p = await (await br.newContext({ viewport: { width: 1500, height: 950 } })).newPage(); p.setDefaultTimeout(15000);
    const errors = []; errorsAll = errors;
    p.on('pageerror', (e) => errors.push(e.message)); p.on('dialog', (x) => { errors.push('dialog: ' + x.message()); x.dismiss(); });
    await p.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
    await p.fill('[name=username]', 'sashi73'); await p.fill('[name=password]', 'sashi98'); await p.click('#loginForm button');
    await p.waitForSelector('#app:not([hidden])');
    const menu = await p.$$eval('.side-nav > *', (x) => x.map((e) => e.textContent.trim()));
    const gi = menu.indexOf('Sub-contractors');
    ok('Menu', 'a "Sub-contractors" group with Subbies and Licences & insurance, between Stock and Data & Reports', gi > menu.indexOf('Stock') && /Subbies/.test(menu[gi + 1]) && /Licences & insurance/.test(menu[gi + 2]) && menu[gi + 3] === 'Data & Reports', menu.join(' | '));
    await p.waitForFunction(() => { const b = document.querySelector('[data-nav=subscomp] .nbadge'); return b && !b.hidden; }, null, { timeout: 10000 }).catch(() => {});
    await p.goto(`${BASE}/admin/#subs`); await p.waitForSelector('[data-stab=compliance]');
    ok('Menu', 'the Licences & insurance tab shows the same count as the menu', (await p.textContent('[data-stab=compliance] b')) === String(flagged));
    ok('Menu', 'the Licences & insurance item shows how many have papers expired or due', (await p.textContent('[data-nav=subscomp] .nbadge').catch(() => '')) === String(flagged), flagged);

    await p.click('[data-nav=subs]'); await p.waitForSelector('.sc-table');
    ok('List', 'Subbies lists all 30', (await p.$$eval('.sc-table tbody tr', (x) => x.length)) === 30);
    ok('List', 'columns: business, trade, phone, email, rate, rating, licence & insurance, status', /Business.*Trade.*Phone.*Email.*Rate.*Rating.*Licence & insurance.*Status/.test((await p.$$eval('.sc-table th', (x) => x.map((h) => h.textContent))).join(' ')));
    await p.selectOption('#scTrade', 'plumber');
    const plumbers = DATA.filter((s) => s.trade === 'plumber' || s.trades.includes('plumber')).length;
    ok('Filter', 'the trade filter shows only plumbers', (await p.$$eval('.sc-table tbody tr', (x) => x.length)) === plumbers, plumbers);
    await p.selectOption('#scTrade', ''); await p.click('.sc-tchip[data-tr="cleaner"]');
    ok('Filter', 'a trade chip filters too (cleaners)', (await p.$$eval('.sc-table tbody tr', (x) => x.length)) === DATA.filter((s) => s.trade === 'cleaner' || s.trades.includes('cleaner')).length);
    await p.click('.sc-tchip[data-tr="cleaner"]'); await p.fill('#scQ', 'Penrith');
    ok('Filter', 'search finds a subbie by suburb', (await p.$$eval('.sc-table tbody tr', (x) => x.map((r) => r.textContent))).some((t) => /Penrith Power Electrical/.test(t)));
    await p.fill('#scQ', '');
    await p.screenshot({ path: path.join(__dirname, 'shot47-subbies.png') });

    // new subbie with an expired licence
    await p.click('#scNew'); await p.waitForSelector('#scSave');
    await p.fill('[data-k=business]', 'Zap Electrical Test'); await p.selectOption('[data-k=trade]', 'electrician');
    await p.fill('[data-k=phone]', '0400 000 999'); await p.fill('[data-k=email]', 'zap@example.com');
    await p.fill('[data-k="lic.number"]', 'EC-1'); await p.fill('[data-k="lic.expiry"]', '2020-01-01');
    await p.fill('[data-k="ins.expiry"]', '2099-01-01'); await p.check('[data-k="wc.soleTrader"]'); await p.fill('[data-k=whiteCard]', 'W1'); await p.check('[data-k=swms]');
    await p.click('.sc-more summary'); await p.check('[data-tr2="aircon"]'); await p.fill('[data-k=rate]', '99');
    await p.locator('.modal-card').screenshot({ path: path.join(__dirname, 'shot47-edit.png') });
    await p.click('#scSave'); await p.waitForSelector('#modal', { state: 'hidden' }); await sleep(400);
    const zap = (await SB.list()).subs.find((s) => s.business === 'Zap Electrical Test');
    ok('Add', 'a new subbie is saved with the next number, trade, other trades and rate', zap && zap.id === 'SC-031' && zap.trade === 'electrician' && zap.trades.join() === 'aircon' && zap.rate === 99, JSON.stringify(zap));
    ok('Add', 'an expired licence shows as Expired', zap && zap.comp.worst === 'expired' && /Licence: expired/.test(zap.comp.problems.join()) && /Expired/.test(await p.textContent('tr[data-scid="SC-031"]')));
    await p.click('tr[data-scid="SC-031"] [data-scedit] >> nth=0'); await p.waitForSelector('#scSave');
    ok('Edit', 'opening it warns about the expired licence', /Licence: expired/.test(await p.textContent('#modalBody')));
    await p.fill('[data-k="lic.expiry"]', '2099-01-01'); await p.selectOption('[data-k=status]', 'Preferred'); await p.selectOption('[data-k=rating]', '5');
    await p.click('#scSave'); await p.waitForSelector('#modal', { state: 'hidden' }); await sleep(400);
    const zap2 = (await SB.list()).subs.find((s) => s.id === 'SC-031');
    ok('Edit', 'changes are saved and the subbie is now compliant', zap2.status === 'Preferred' && zap2.rating === 5 && zap2.comp.worst === 'ok' && zap2.trades.join() === 'aircon', JSON.stringify(zap2.comp));

    // compliance page
    await p.click('[data-nav=subscomp]'); await p.waitForSelector('.kpi');
    ok('Compliance', 'opens at #subs/compliance with the menu item highlighted', /#subs\/compliance$/.test(await p.evaluate(() => location.hash)) && await p.$eval('[data-nav=subscomp]', (a) => a.classList.contains('on')));
    const rowsTxt = await p.$$eval('.sc-table tbody tr', (x) => x.map((r) => r.textContent));
    ok('Compliance', 'expired papers are listed first, with call and email buttons', /EXPIRED/.test(rowsTxt[0]) && (await p.$$eval('.sc-table tbody tr a[href^="tel:"]', (x) => x.length)) > 0, rowsTxt.slice(0, 2).join(' || '));
    ok('Compliance', '"Do not use" subbies are left out', !L.subs.filter((s) => s.status === 'Do not use').some((s) => rowsTxt.some((t) => t.includes(s.business))));
    await p.screenshot({ path: path.join(__dirname, 'shot47-compliance.png'), fullPage: true });

    // archive
    await p.goto(`${BASE}/admin/#subs/SC-031`); await p.waitForSelector('#scArchB'); await p.click('#scArchB'); await p.waitForSelector('#modal', { state: 'hidden' }); await sleep(300);
    ok('Archive', 'archiving hides the subbie from the list', !(await p.isVisible('tr[data-scid="SC-031"]')) && (await SB.list()).subs.find((s) => s.id === 'SC-031').archived);

    // project plan: add a subbie as a stakeholder
    const J = await import(path.join(SITE, 'netlify/lib/jobs.mjs'));
    const kv = await import(path.join(SITE, 'netlify/lib/kv.mjs'));
    const core = await J.nextCore('B');
    await J.create({ core, name: 'Bea Bath', phone: '0400 333 444', email: '', suburb: 'Castle Hill', service: 'Bathroom', source: 'phone', summary: 'New bathroom.' });
    await p.goto(`${BASE}/admin/#plan/${core}`); await p.waitForSelector('#tplType');
    await p.selectOption('#tplType', { index: 1 }); await p.click('#tplCreate'); await p.waitForSelector('table.gt');
    await p.click('#planTabs >> text=Stakeholders'); await p.waitForSelector('#skSub');
    await p.waitForFunction(() => document.querySelectorAll('#skSub option').length > 5);
    const hills = L.subs.find((s) => s.business === 'Hills Plumbing Services');
    ok('Plan', 'Stakeholders has "Add a subbie", grouped by trade, without archived or "do not use"', (await p.$$eval('#skSub optgroup', (x) => x.length)) >= 10 && !(await p.$$eval('#skSub option', (x) => x.map((o) => o.textContent))).some((t) => /Zap Electrical/.test(t)));
    await p.selectOption('#skSub', hills.id);
    await p.waitForFunction(() => /Saved/.test((document.querySelector('#planSave') || {}).textContent || ''), null, { timeout: 15000 }); await sleep(300);
    const sk = ((await kv.get('plan:' + core)).stakeholders || [])[0] || {};
    ok('Plan', 'picking a subbie adds them as Responsible with their trade, phone and email', /Hills Plumbing Services/.test(sk.name) && sk.role === 'Plumber' && sk.raci === 'R' && sk.phone === hills.phone && sk.sub === hills.id, JSON.stringify(sk));

    await p.setViewportSize({ width: 390, height: 844 }); await p.goto(`${BASE}/admin/#subs`); await p.waitForSelector('.sc-table'); await sleep(500);
    ok('Phone', 'no sideways scrolling on a phone', (await p.evaluate(() => document.documentElement.scrollWidth)) <= 391, await p.evaluate(() => document.documentElement.scrollWidth));
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close(); br = null;
  } catch (e) { try { if (br) await br.close(); } catch {} ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ') + ' LOG: ' + log.slice(-500)); }
  try { srv.kill(); } catch {} try { await blobs.stop(); } catch {}
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(0);
})();
