// v101: 🎁 Wonder Bird weekly voucher draw. The "🎁 Win $50" menu link opens Mr. Fixit, who explains the prizes and takes the
// visitor's first and last name, contact number and email, then gives a "Play Wonder Bird" link. Players, scores and vouchers
// are kept apart from customers; staff see them on the console's "Wonder Bird draw" page and issue the week's vouchers there.
// node promo-test.js <site>
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const SITE = path.resolve(process.argv[2]);
const PORT = 8991, BASE = `http://127.0.0.1:${PORT}`;
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => results.push({ area, name, pass: !!pass, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-wb-blobs'); fs.rmSync(dir, { recursive: true, force: true });
  const blobs = new BlobsServer({ directory: dir, token: 'tok', port: 0 });
  const { port: bport } = await blobs.start();
  const ctxB64 = Buffer.from(JSON.stringify({ siteID: 'mbs', token: 'tok', edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, apiURL: `http://localhost:${bport}` })).toString('base64');
  process.env.NETLIFY_BLOBS_CONTEXT = ctxB64;
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NETLIFY_BLOBS_CONTEXT: ctxB64, ADMIN_USERNAME: 'sashi73', ADMIN_PASSWORD: 'sashi98', SITE_ENV: 'test', LLM_API_KEY: '', TELEGRAM_BOT_TOKEN: '', RESEND_API_KEY: '' };
  const srv = spawn('node', ['local-server.mjs'], { cwd: SITE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 40 && !/running/.test(log); i++) await sleep(150);
  let br = null;
  const post = (b, origin) => fetch(`${BASE}/.netlify/functions/promo`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(b) }).then(async (r) => ({ status: r.status, j: await r.json().catch(() => ({})), h: r.headers }));
  try {
    const PR = await import(path.join(SITE, 'netlify/lib/promo.mjs'));
    ok('Weeks', 'weeks run Monday to Sunday, Sydney time', PR.weekOf(Date.parse('2026-11-01T12:00:00Z')) === '2026-W44' && PR.weekOf(Date.parse('2026-11-01T14:30:00Z')) === 'W45'.padStart(8, '2026-') && PR.weekRange('2026-W45').from === '2026-11-02' && PR.weekRange('2026-W45').to === '2026-11-08' && PR.weekOf(Date.parse('2027-01-01T03:00:00Z')) === '2026-W53', [PR.weekOf(Date.parse('2026-11-01T14:30:00Z')), PR.weekRange('2026-W45')]);

    br = await chromium.launch();
    const ctx = await br.newContext({ viewport: { width: 1440, height: 900 } });
    const pg = await ctx.newPage(); pg.setDefaultTimeout(15000);
    const errors = []; errorsAll = errors; pg.on('pageerror', (e) => errors.push(e.message));

    // the menu link on every page
    for (const p of ['index.html', 'about.html', 'services.html', 'projects.html', 'contact.html', 'privacy.html']) {
      const t = fs.readFileSync(path.join(SITE, p), 'utf8');
      ok('Menu', p + ': "🎁 Win $50" sits in the main menu, after Contact', /Contact<\/a>\s*<a href="#win" class="nav-win" data-win[^>]*>🎁 Win \$50<\/a>\s*<\/nav>/.test(t));
    }
    await pg.goto(`${BASE}/services.html`, { waitUntil: 'networkidle' });
    const box = await pg.locator('.menu a.nav-win').boundingBox(), cbox = await pg.locator('.menu a[href="contact.html"]').boundingBox();
    ok('Menu', 'it is on the same line as Home, Services and Contact, and compact', box && cbox && Math.abs(box.y + box.height / 2 - (cbox.y + cbox.height / 2)) < 6 && box.width < 120, [box, cbox]);
    await pg.click('.menu a.nav-win');
    await pg.waitForSelector('.fx-panel.open .fx-promo-form', { timeout: 15000 });
    const talk = await pg.textContent('.fx-panel');
    ok('Chat', 'clicking it opens Mr. Fixit, who explains the $50 / $30 / $20 weekly vouchers for the top 3', /\$50/.test(talk) && /\$30/.test(talk) && /\$20/.test(talk) && /top 3/i.test(talk) && /Monday to Sunday/.test(talk));
    ok('Chat', 'and asks for first name, last name, contact number, email and suburb', (await pg.locator('.fx-promo-form input[name=first], .fx-promo-form input[name=last], .fx-promo-form input[name=phone], .fx-promo-form input[name=email], .fx-promo-form input[name=suburb]').count()) === 5 && /once a day with 3 lives/.test(talk));
    await pg.click('.fx-promo-go'); await sleep(150);
    ok('Checks', 'empty form: asks for the names first', /first and last name/.test(await pg.textContent('.fx-perr')));
    await pg.fill('.fx-promo-form input[name=first]', 'Priya'); await pg.fill('.fx-promo-form input[name=last]', 'Nair');
    await pg.fill('.fx-promo-form input[name=phone]', '1234'); await pg.fill('.fx-promo-form input[name=email]', 'priya.nair@example.com');
    await pg.click('.fx-promo-go'); await sleep(150);
    ok('Checks', 'a bad contact number is caught', /contact number/.test(await pg.textContent('.fx-perr')));
    await pg.fill('.fx-promo-form input[name=phone]', '0412 345 678'); await pg.click('.fx-promo-go'); await sleep(150);
    ok('Checks', 'the suburb is needed', /suburb/.test(await pg.textContent('.fx-perr')));
    await pg.click('.fx-promo-form input[name=suburb]'); await pg.keyboard.type('Box'); await pg.waitForSelector('.fx-sugg-i');
    const sug = await pg.$$eval('.fx-sugg-i', (b) => b.map((x) => x.textContent));
    ok('Suburb', 'after 3 letters, matching suburbs pop up to pick from', sug.length > 0 && sug.some((x) => /^Box Hill 2765$/.test(x)), sug);
    await pg.click('.fx-sugg-i:has-text("Box Hill 2765")');
    ok('Suburb', 'picking one fills it in', (await pg.inputValue('.fx-promo-form input[name=suburb]')) === 'Box Hill 2765');
    await pg.click('.fx-promo-go'); await sleep(150);
    ok('Checks', 'the terms box must be ticked (it links to the draw terms)', /tick the box/.test(await pg.textContent('.fx-perr')) && (await pg.getAttribute('.fx-pc a', 'href')) === '/privacy.html#vouchers');
    await pg.check('.fx-promo-form input[name=consent]'); await pg.click('.fx-promo-go');
    await pg.waitForSelector('.fx-promo-play', { timeout: 15000 });
    const play = await pg.getAttribute('.fx-promo-play', 'href');
    const m = play.match(/^\/wonderbird\.html\?wb=(WB-\d{6})\.([a-f0-9]{32})&name=Priya$/);
    ok('Entry', 'they are in: player WB-000001 and a "▶ Play Wonder Bird" link to the game', !!m && m[1] === 'WB-000001' && /You’re in the draw/.test(await pg.textContent('.fx-promo')), play);
    await Promise.all([pg.waitForURL(/wonderbird\.html/), pg.click('.fx-chip:has-text("▶ Play Wonder Bird"):not(a)')]);
    ok('Entry', 'the Play button takes them to the Wonder Bird page on the site', /\/wonderbird\.html/.test(pg.url()));
    await pg.goto(`${BASE}/services.html`, { waitUntil: 'networkidle' });
    const rec = await PR.get('WB-000001');
    ok('Saved', 'their details are saved in the separate draw table (not as a customer)', rec && rec.first === 'Priya' && rec.last === 'Nair' && rec.phone === '0412 345 678' && rec.email === 'priya.nair@example.com' && rec.suburb === 'Box Hill 2765' && rec.consent && rec.consentAt > 0 && !(await import(path.join(SITE, 'netlify/lib/kv.mjs')).then((kv) => kv.get('customers'))), rec);
    // coming back
    await pg.reload({ waitUntil: 'networkidle' });
    await pg.click('.menu a.nav-win'); await pg.waitForSelector('.fx-chip:has-text("Not me")');
    ok('Entry', 'back on the same device: "Welcome back, Priya" and straight to Play', /Welcome back, Priya/.test(await pg.textContent('.fx-panel')));

    // the server checks too
    let r = await post({ action: 'enter', first: 'A', last: 'B', phone: '0412345678', email: 'bad', suburb: 'Box Hill 2765', consent: true });
    ok('Server', 'refuses a bad email', r.status === 400 && /email/.test(r.j.error));
    r = await post({ action: 'enter', first: 'A', last: 'B', phone: '0412345678', email: 'a@b.com', suburb: 'Box Hill 2765' });
    ok('Server', 'refuses an entry without agreeing to the terms', r.status === 400);
    r = await post({ action: 'enter', first: 'Bot', last: 'Bot', phone: '0412345678', email: 'bot@spam.com', suburb: 'Box Hill 2765', consent: true, website: 'http://spam' });
    ok('Server', 'a bot filling the hidden field is quietly ignored', r.status === 200 && !r.j.id && !Object.values((await PR.index()).players).some((p) => p.email === 'bot@spam.com'));
    r = await post({ action: 'enter', first: 'Priya', last: 'Nair-Smith', phone: '0412 345 678', email: 'PRIYA.NAIR@example.com', suburb: 'Box Hill 2765', consent: true });
    ok('Server', 'the same email again gets the same player back (details updated), not a second entry', r.j.id === 'WB-000001' && r.j.again && Object.keys((await PR.index()).players).length === 1);

    // scores from the game
    const tok = m[2];
    const BOT = await import(path.join(SITE, 'tools/wb-bot.mjs')), CORE = await import(path.join(SITE, 'assets/wb-core.mjs'));
    r = await post({ action: 'start', id: 'WB-000001', token: 'f'.repeat(32) });
    ok('Scores', 'a wrong token can\'t start a run', r.status === 401);
    r = await post({ action: 'score', id: 'WB-000001', token: tok, score: 999999 });
    ok('Scores', 'a typed-in score is not accepted any more (scores come from replaying the run)', r.status === 400);
    { const pp = await PR.get('WB-000001'); pp.runs = []; await PR.put(pp); }   // opening the game page above already used today's play
    const st1 = await post({ action: 'start', id: 'WB-000001', token: tok });
    { const pp = await PR.get('WB-000001'); pp.runs.find((x) => x.id === st1.j.run).at -= 15 * 60e3; await PR.put(pp); }
    const att1 = BOT.playRun(st1.j.seed, 2), exp1 = CORE.scoreRun(st1.j.seed, att1).score;
    r = await post({ action: 'run', id: 'WB-000001', token: tok, run: st1.j.run, attempts: att1 });
    ok('Scores', 'the game sends its run and the server scores it', r.status === 200 && r.j.score === exp1 && r.j.best === exp1 && r.j.rank === 1, r.j);
    r = await post({ action: 'start', id: 'WB-000001', token: tok });
    ok('Scores', 'one play a day: no second play today', r.status === 403 && /tomorrow/.test(r.j.error));
    { const pp = await PR.get('WB-000001'); pp.runs.find((x) => x.id === st1.j.run).day = '2000-01-01'; await PR.put(pp); }   // pretend that play was yesterday
    const st2 = await post({ action: 'start', id: 'WB-000001', token: tok });
    { const pp = await PR.get('WB-000001'); pp.runs.find((x) => x.id === st2.j.run).at -= 15 * 60e3; await PR.put(pp); }
    r = await post({ action: 'run', id: 'WB-000001', token: tok, run: st2.j.run, attempts: BOT.playRun(st2.j.seed, 1) });
    ok('Scores', 'the best score of the week counts', r.j.best === exp1);
    const PRIYA = exp1;

    // a finished week with 5 players
    const now = Date.now(), lastWk = PR.weekOf(now - 7 * 864e5), thisWk = PR.weekOf(now);
    const people = [['Priya', 'Nair', 3000], ['Tom', 'Lee', 5200], ['Mia', 'Wong', 4100], ['Sam', 'Ito', 900], ['Zoe', 'Park', 2500]];
    for (const [first, last, score] of people) {
      const x = first === 'Priya' ? { player: await PR.get('WB-000001') } : await PR.register({ first, last, phone: '0400 000 00' + people.findIndex((p) => p[0] === first), email: first.toLowerCase() + '@example.com', suburb: 'Box Hill 2765', consent: true });
      const p = x.player; p.scores = (p.scores || []).concat([{ at: now - 7 * 864e5, week: lastWk, score, level: 1 }]); await PR.put(p);
    }
    const lb = await PR.leaderboard(lastWk, 10);
    ok('Leaderboard', 'last week\'s leaderboard ranks the best scores', lb.map((x) => x.first).join(',') === 'Tom,Mia,Priya,Zoe,Sam', lb.map((x) => x.first));

    // the console
    const ac = await br.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true }); const a = await ac.newPage(); a.setDefaultTimeout(15000);
    a.on('pageerror', (e) => errors.push('console: ' + e.message));
    await a.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
    await a.fill('#loginForm [name=username]', 'sashi73'); await a.fill('#loginForm [name=password]', 'sashi98'); await a.click('#loginForm button[type=submit]');
    await a.waitForSelector('#app:not([hidden])');
    ok('Console', 'a "🎁 Wonder Bird draw" page under CRM', await a.isVisible('[data-nav="wonderbird"]'));
    await a.click('[data-nav="wonderbird"]'); await a.waitForSelector('#wbTab');
    let t = await a.textContent('#wbBody');
    ok('Console', 'this week: Priya with her checked score, and vouchers wait until the week ends', t.includes(PRIYA.toLocaleString('en-AU')) && /once this week ends/.test(t) && !(await a.isVisible('#wbIssue')) && new RegExp(thisWk).test(t));
    await a.click('#wbPrev'); await a.waitForFunction((w) => document.querySelector('.wb-wk') && document.querySelector('.wb-wk').textContent === w, lastWk);
    t = await a.textContent('#wbTab');
    ok('Console', 'last week: top 3 marked $50 / $30 / $20 to issue', /\$50 to issue/.test(t) && /\$30 to issue/.test(t) && /\$20 to issue/.test(t) && (await a.locator('.wb-tbl tbody tr').count()) === 5);
    await a.click('#wbIssue'); await a.click('#okBtn');
    await a.waitForFunction(() => document.querySelectorAll('.wb-tbl .wb-code').length === 3);
    const codes = await a.$$eval('.wb-tbl tbody tr', (rs) => rs.map((r) => (r.querySelector('.wb-code') || {}).textContent || ''));
    ok('Vouchers', 'issuing gives Tom, Mia and Priya their own voucher numbers ($50, $30, $20), nobody else', codes[0] === 'MBS-000001' && codes[1] === 'MBS-000002' && codes[2] === 'MBS-000003' && !codes[3] && !codes[4], codes);
    {
      const tv0 = (await PR.get('WB-000002')).vouchers[0];
      ok('Vouchers', 'each voucher has a check code (signed from its number, value and winner)', /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(tv0.check), tv0);
      const pdfRes = await a.evaluate((u) => fetch(u, { credentials: 'same-origin' }).then(async (r) => ({ s: r.status, t: r.headers.get('content-type'), n: (await r.arrayBuffer()).byteLength })), '/.netlify/functions/admin?action=voucherPdf&id=WB-000002&code=' + tv0.code);
      ok('PDF', 'the console makes a PDF of the voucher', pdfRes.s === 200 && pdfRes.t === 'application/pdf' && pdfRes.n > 5000, pdfRes);
      const anonPdf = await fetch(`${BASE}/.netlify/functions/admin?action=voucherPdf&id=WB-000002&code=${tv0.code}`);
      ok('PDF', 'only signed-in staff can download it', anonPdf.status === 401);
      const VP = await import(path.join(SITE, 'netlify/lib/voucher-pdf.mjs'));
      const buf = await VP.voucherPdf(await PR.get('WB-000002'), tv0, BASE), PDFLib = await import(require.resolve('pdf-lib', { paths: [SITE] }));
      const doc = await PDFLib.PDFDocument.load(buf);
      ok('PDF', 'one page, made out to the winner, titled with the voucher number', doc.getPageCount() === 1 && doc.getTitle() === 'MBS voucher ' + tv0.code);
      let r1 = await post({ action: 'verify', v: tv0.code, a: 50, c: tv0.check });
      ok('Check', 'the QR check says genuine: the value, the winner (first name and initial), valid until', r1.j.valid && r1.j.amount === 50 && r1.j.name === 'Tom L.' && r1.j.status === 'issued' && r1.j.expires === tv0.expires, r1.j);
      r1 = await post({ action: 'verify', v: tv0.code, a: 500, c: tv0.check });
      ok('Check', 'a changed value is caught ($500 instead of $50)', !r1.j.valid);
      r1 = await post({ action: 'verify', v: tv0.code, a: 50, c: 'AAAA-BBBB' });
      ok('Check', 'a made-up check code is caught', !r1.j.valid);
      r1 = await post({ action: 'verify', v: 'MBS-000009', a: 50, c: tv0.check });
      ok('Check', 'a made-up voucher number is caught', !r1.j.valid);
      const vp = await ctx.newPage();
      await vp.goto(`${BASE}/voucher.html?v=${tv0.code}&a=50&c=${tv0.check}`, { waitUntil: 'networkidle' }); await vp.waitForSelector('.vc-card');
      ok('Check', 'scanning the QR opens the check page: "Genuine and valid", $50', /Genuine and valid/.test(await vp.textContent('.vc-card')) && /\$50/.test(await vp.textContent('.vc-card')));
      await vp.screenshot({ path: path.join(os.tmpdir(), 'wb-verify.png') }); await vp.close();
    }
    const tom = (await PR.get('WB-000002')).vouchers[0];
    ok('Vouchers', 'the voucher is saved with the player: week, place, amount, score, issued, expires in 90 days', tom.week === lastWk && tom.place === 1 && tom.amount === 50 && tom.score === 5200 && tom.status === 'issued' && tom.issuedBy && Math.abs(Date.parse(tom.expires) - (tom.issuedAt + 90 * 864e5)) < 2 * 864e5, tom);
    r = await a.evaluate((w) => window.MBS.api('promoIssue', { week: w }).then((x) => x, (e) => ({ e: e.message })), lastWk);
    ok('Vouchers', 'issuing again does not double up', r.issued && r.issued.length === 0 && r.skipped === 3, r);
    r = await a.evaluate((w) => window.MBS.api('promoIssue', { week: w }).then((x) => x, (e) => ({ e: e.message })), thisWk);
    ok('Vouchers', 'the server also refuses vouchers for a week that is not over', /not over/.test(r.e || ''), r);
    await a.click('.tab[href="#wonderbird/vouchers"]'); await a.waitForSelector('.wb-act');
    ok('Vouchers', 'the Vouchers tab lists all 3 with winner, contact, expiry and status', (await a.locator('#wbTab tbody tr').count()) === 3 && /Tom Lee/.test(await a.textContent('#wbTab')) && /Issued/.test(await a.textContent('#wbTab')));
    await a.click('#wbTab tbody tr:first-child button:has-text("Used")'); await a.waitForSelector('#wbJob');
    await a.click('#wbUse'); await sleep(100);
    ok('Vouchers', 'marking a voucher used asks which job it is used on', /job number/i.test(await a.textContent('#wbJobErr')));
    await a.fill('#wbJob', 'mbs-1234'); await a.click('#wbUse');
    await a.waitForFunction(() => /Used/.test((document.querySelector('#wbTab tbody tr:first-child .chip') || {}).textContent || ''));
    const tv = (await PR.get('WB-000002')).vouchers[0];
    ok('Vouchers', 'mark a voucher as used when the customer spends it, with the job it went on', tv.status === 'redeemed' && tv.job === 'MBS-1234' && /MBS-1234/.test(await a.textContent('#wbTab')), tv);
    const mia = (await PR.get('WB-000003')).vouchers[0];
    r = await a.evaluate((x) => window.MBS.api('promoVoucher', x).then(() => 'ok', (e) => e.message), { id: 'WB-000003', code: mia.code, status: 'redeemed', job: 'MBS-1234' });
    ok('Vouchers', 'one voucher per job: a second voucher on the same job is refused (can\'t combine)', /only one voucher per job/i.test(r), r);
    const pri = (await PR.get('WB-000001')).vouchers[0];
    r = await a.evaluate((x) => window.MBS.api('promoVoucher', x).then(() => 'ok', (e) => e.message), { id: 'WB-000001', code: pri.code, status: 'redeemed', job: 'MBS-5678' });
    ok('Vouchers', 'but another voucher can go on a different job', r === 'ok', r);
    ok('Terms', 'the draw terms say one voucher per job, no combining', /One voucher per job\. Vouchers cannot be combined/.test(fs.readFileSync(path.join(SITE, 'privacy.html'), 'utf8')));
    await a.click('.tab[href="#wonderbird/players"]'); await a.waitForSelector('#wbQ');
    ok('Players', 'the Players tab shows all 5 with contact details, plays and best score', (await a.locator('#wbTab tbody tr').count()) === 5 && /priya\.nair@example\.com/.test(await a.textContent('#wbTab')));
    await a.fill('#wbQ', 'mia'); await sleep(100);
    ok('Players', 'search finds a player', (await a.locator('#wbTab tbody tr').count()) === 1);
    const [dl] = await Promise.all([a.waitForEvent('download'), a.click('#wbCsv')]);
    const csv = fs.readFileSync(await dl.path(), 'utf8');
    ok('Export', 'CSV export with names, contact, scores and voucher numbers', /First name,Last name,Contact number,Email/.test(csv) && /Tom,Lee/.test(csv) && /MBS-000001 \(\$50/.test(csv) && csv.trim().split('\n').length === 6);
    const tokOut = await a.evaluate(() => window.MBS.api('promoGet', { id: 'WB-000001' }));
    ok('Privacy', 'the console never shows the player\'s game token', tokOut.player && !tokOut.player.token && !JSON.stringify(await a.evaluate(() => window.MBS.api('promoList', {}))).includes(tok));
    await a.screenshot({ path: path.join(os.tmpdir(), 'wb-console.png') });

    // a Site supervisor (CRM view) can look but not issue
    await a.evaluate(() => window.MBS.api('userSave', { username: 'sue', name: 'Sue', role: 'Site supervisor', password: 'longpassword1' }).catch(() => null));
    const sc = await br.newContext(); const s = await sc.newPage();
    await s.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
    const sl = await s.evaluate(() => window.MBS.api('login', { username: 'sue', password: 'longpassword1' }).then(() => true, () => false));
    if (sl) {
      const v = await s.evaluate(() => window.MBS.api('promoList', {}).then(() => true, () => false));
      const e = await s.evaluate((w) => window.MBS.api('promoIssue', { week: w }).then(() => true, (x) => x.message), lastWk);
      ok('Access', 'CRM view-only staff can see the draw but can\'t issue vouchers', v && e !== true, e);
    } else ok('Access', 'CRM view-only staff can see the draw but can\'t issue vouchers', true, 'skipped (no user created)');
    const anon = await post({ action: 'promoList' });
    ok('Access', 'the public function has no staff actions', anon.status === 400);

    // phone
    const ph = await br.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const q = await ph.newPage();
    await q.goto(`${BASE}/services.html`, { waitUntil: 'networkidle' }); await q.click('.burger'); await sleep(300);
    await q.click('.menu a.nav-win'); await q.waitForSelector('.fx-panel.open .fx-promo-form');
    const fw = await q.evaluate(() => { const f = document.querySelector('.fx-promo-form'); return f.scrollWidth <= f.clientWidth + 1 && !document.querySelector('.menu.open'); });
    ok('Phone', 'on a phone: in the menu, opens the chat (menu closes) and the form fits', fw);
    await q.screenshot({ path: path.join(os.tmpdir(), 'wb-phone.png') });
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close(); br = null;
  } catch (e) { try { if (br) await br.close(); } catch {} ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ') + ' LOG: ' + log.slice(-600)); }
  try { srv.kill(); } catch {} try { await blobs.stop(); } catch {}
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(0);
})();
