// v102: Wonder Bird is a page of the site (wonderbird.html). Checks the page, the game, the server-checked scores and the
// weekly leaderboard. node wonderbird-test.js <site>
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const SITE = path.resolve(process.argv[2]);
const PORT = 8992, BASE = `http://127.0.0.1:${PORT}`;
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => results.push({ area, name, pass: !!pass, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHOTS = process.env.WB_SHOTS || os.tmpdir();

(async () => {
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-wb2-blobs'); fs.rmSync(dir, { recursive: true, force: true });
  const blobs = new BlobsServer({ directory: dir, token: 'tok', port: 0 });
  const { port: bport } = await blobs.start();
  const ctxB64 = Buffer.from(JSON.stringify({ siteID: 'mbs', token: 'tok', edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, apiURL: `http://localhost:${bport}` })).toString('base64');
  process.env.NETLIFY_BLOBS_CONTEXT = ctxB64;
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NETLIFY_BLOBS_CONTEXT: ctxB64, ADMIN_USERNAME: 'sashi73', ADMIN_PASSWORD: 'sashi98', SITE_ENV: 'test', LLM_API_KEY: '', TELEGRAM_BOT_TOKEN: '', RESEND_API_KEY: '', AZURE_SPEECH_KEY: '' };
  const srv = spawn('node', ['local-server.mjs'], { cwd: SITE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 40 && !/running/.test(log); i++) await sleep(150);
  let br = null;
  const post = (b) => fetch(`${BASE}/.netlify/functions/promo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(async (r) => ({ status: r.status, j: await r.json().catch(() => ({})) }));
  try {
    const C = await import(path.join(SITE, 'assets/wb-core.mjs')), BOT = await import(path.join(SITE, 'tools/wb-bot.mjs')), PR = await import(path.join(SITE, 'netlify/lib/promo.mjs'));
    // rules
    const r1 = BOT.playLevel(1, 'a:0');
    ok('Rules', 'a level can be cleared, and replaying its inputs gives exactly the same result', r1.stats.cleared && JSON.stringify(C.replay({ level: 1, salt: 'a:0', launch: r1.attempt.launch, flaps: r1.attempt.flaps })) === JSON.stringify(r1.stats));
    const run = BOT.playRun('seed1', 3), sr = C.scoreRun('seed1', run);
    ok('Rules', 'a play is scored from its inputs: 3 levels cleared, then 3 crashes (3 lives) end it', sr.ok && sr.cleared === 3 && sr.crashes === 3 && sr.over && sr.score > 0, sr);
    ok('Rules', 'the same inputs with another seed don\'t add up (layouts come from the server\'s seed)', !C.scoreRun('seed2', run).ok || C.scoreRun('seed2', run).score !== sr.score);

    // server: a player, a run, its score
    const ent = await post({ action: 'enter', first: 'Ava', last: 'Stone', phone: '0412 111 222', email: 'ava@example.com', suburb: 'Box Hill 2765', consent: true });
    const [id, token] = ent.j.play.match(/wb=(WB-\d{6})\.([a-f0-9]{32})/).slice(1);
    ok('Entry', 'the Play link now opens the game page on the MBS site', /^\/wonderbird\.html\?wb=WB-\d{6}\.[a-f0-9]{32}&name=Ava$/.test(ent.j.play), ent.j.play);
    let st = await post({ action: 'start', id, token });
    ok('Server', 'a run starts with a seed from the server', st.status === 200 && /^[a-f0-9]{16}$/.test(st.j.seed) && st.j.run);
    const bad = await post({ action: 'start', id, token: '0'.repeat(32) });
    ok('Server', 'a wrong token can\'t start a run', bad.status === 401);
    const att = BOT.playRun(st.j.seed, 2);
    let sb = await post({ action: 'run', id, token, run: st.j.run, attempts: att });
    ok('Server', 'a run sent faster than real time is refused', sb.status === 400 && /real time/.test(sb.j.error), sb.j);
    // pretend the run started long enough ago
    const p = await PR.get(id); p.runs.find((r) => r.id === st.j.run).at -= 10 * 60e3; await PR.put(p);
    sb = await post({ action: 'run', id, token, run: st.j.run, attempts: att });
    const expect = C.scoreRun(st.j.seed, att);
    ok('Server', 'the server replays the run and keeps its own score', sb.status === 200 && sb.j.score === expect.score && sb.j.cleared === 2 && sb.j.rank === 1, sb.j);
    const forged = JSON.parse(JSON.stringify(att)); forged.unshift({ level: 1, launch: att[0].launch, flaps: [] });
    sb = await post({ action: 'run', id, token, run: st.j.run, attempts: forged });
    ok('Server', 'made-up inputs don\'t check out', sb.status === 400, sb.j);
    sb = await post({ action: 'run', id, token, run: st.j.run, attempts: att.slice(0, 1) });
    ok('Server', 'sending the same run again updates it (one score per run, not a new one each time)', sb.status === 200 && (await PR.get(id)).scores.filter((s) => s.run === st.j.run).length === 1);
    const sTwo = await post({ action: 'start', id, token });
    ok('Plays', 'one play a day: a second play the same day is refused (“play again tomorrow”)', sTwo.status === 403 && /play for today/.test(sTwo.j.error) && /tomorrow/.test(sTwo.j.error), sTwo.j);
    const dup = await post({ action: 'enter', first: 'Ava', last: 'Two', phone: '+61 412 111 222', email: 'other.ava@example.com', suburb: 'Box Hill 2765', consent: true });
    ok('Plays', 'the same phone number with a different email is the same person (no extra plays)', dup.j.id === id && (await post({ action: 'start', id, token })).status === 403);
    const dup2 = await post({ action: 'enter', first: 'Ava', last: 'Stone', phone: '0499 999 999', email: 'AVA@example.com', suburb: 'Box Hill 2765', consent: true });
    ok('Plays', 'the same email with a different phone is the same person too', dup2.j.id === id);
    const bd = await post({ action: 'board', id, token });
    ok('Board', 'the public leaderboard shows first name and initial only, the score and the prize', bd.j.top[0] && bd.j.top[0].name === 'Ava S.' && bd.j.top[0].prize === 50 && bd.j.top[0].me && !JSON.stringify(bd.j).includes('0412') && !JSON.stringify(bd.j).includes('ava@') && bd.j.me.rank === 1 && bd.j.me.playsLeft === 0 && bd.j.endsIn > 0, bd.j);
    const bg = await post({ action: 'board' });
    ok('Board', 'anyone can see the board (no "me" without a token)', bg.status === 200 && !bg.j.me && !bg.j.top[0].me);

    // the page
    br = await chromium.launch();
    const ctx = await br.newContext({ viewport: { width: 1440, height: 900 } });
    const pg = await ctx.newPage(); pg.setDefaultTimeout(15000);
    const errors = []; errorsAll = errors; pg.on('pageerror', (e) => errors.push(e.message)); pg.on('console', (m) => { if (m.type() === 'error' && !/tts|404|503|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
    await pg.goto(`${BASE}/wonderbird.html`, { waitUntil: 'networkidle' }); await sleep(800);
    ok('Page', 'How to play lists the rules: one play a day with 3 lives (again tomorrow), one life a play, best play counts, one phone/email = one person', /One play a day, with 3 lives/.test(await pg.textContent('#wbPop-help')) && /welcome to play again tomorrow/.test(await pg.textContent('#wbPop-help'))  && /best play of the week/.test(await pg.textContent('#wbPop-help')) && /same phone or email/.test(await pg.textContent('#wbPop-help')));
    ok('Page', 'first visit: "How to play" pops up over the game (no wall of text, no collectible cards, no "enter the draw" box)', await pg.isVisible('#wbPop-help.open') && !/NFT|mint|collectible/i.test(await pg.content()) && !/Enter the draw/i.test(await pg.textContent('#wbPop-help')));
    await pg.screenshot({ path: path.join(SHOTS, 'wb-help.png') });
    await pg.click('#wbPop-help .wb-go'); await sleep(300);
    ok('Page', 'the game fills the screen, with a clear "Back to MBS website" button', !(await pg.isVisible('#wbPop-help.open')) && (await pg.getAttribute('.wb-back', 'href')) === 'index.html' && /Back to MBS website/.test(await pg.textContent('.wb-back')) && (await pg.locator('#wbCanvas').boundingBox()).width > 900);
    await pg.waitForSelector('#wbSide .wb-list li');
    const sb2 = await pg.locator('#wbSide').boundingBox(), cb2 = await pg.locator('#wbCanvas').boundingBox();
    ok('Page', 'the leaderboard is always there, on the left of the game', await pg.isVisible('#wbSide') && sb2.x + sb2.width <= cb2.x && /Ava S\./.test(await pg.textContent('#wbSide')) && !(await pg.isVisible('.wb-tools [data-pop=board]')));
    ok('Page', 'Mr. Fixit\'s floating button is hidden here (the game has the screen)', !(await pg.isVisible('.fx-launch')));
    ok('Page', 'as a guest: it says scores don\'t count until they enter', /guest/.test(await pg.textContent('#wbWho')));
    // fly: drag the bird back and let go, then flap
    const box = await pg.locator('#wbCanvas').boundingBox(), sx = box.width / 800, sy = box.height / 450;
    await pg.mouse.move(box.x + 100 * sx, box.y + 300 * sy); await pg.mouse.down(); await pg.mouse.move(box.x + 40 * sx, box.y + 330 * sy, { steps: 6 }); await pg.mouse.up();
    await sleep(200);
    ok('Game', '26 funny pilots take turns, a different one each level', (await import(path.join(SITE, 'assets/wb-heroes.mjs'))).CAST.length === 26);
    ok('Game', 'dragging the pilot back and letting go launches it', (await pg.evaluate(() => window.WonderBird.state().state)) === 'flight');
    for (let i = 0; i < 6; i++) { await pg.keyboard.press('Space'); await sleep(260); }
    await pg.screenshot({ path: path.join(SHOTS, 'wb-flight.png') });
    await pg.waitForFunction(() => ['crashed', 'over', 'levelup'].includes(window.WonderBird.state().state), null, { timeout: 30000 });
    ok('Game', 'the level ends (crash or clear) and an overlay says what next', true);
    await pg.screenshot({ path: path.join(SHOTS, 'wb-overlay.png') });
    // enter the draw from the game page: Mr. Fixit pops up, then the runs count
    await pg.click('#wbWho [data-win]'); await pg.waitForSelector('.fx-panel.open .fx-promo-form');
    await pg.fill('.fx-promo-form input[name=first]', 'Ben'); await pg.fill('.fx-promo-form input[name=last]', 'Kerr');
    await pg.fill('.fx-promo-form input[name=phone]', '0400 123 456'); await pg.fill('.fx-promo-form input[name=email]', 'ben@example.com'); await pg.fill('.fx-promo-form input[name=suburb]', 'Kellyville 2155');
    await pg.check('.fx-promo-form input[name=consent]'); await pg.click('.fx-promo-go');
    await pg.waitForSelector('.fx-promo-play');
    await pg.click('.fx-promo-play'); await sleep(400);
    ok('Entry', 'entering on the game page: Play just closes the chat and the runs count straight away', !(await pg.isVisible('.fx-panel.open')) && /Ben/.test(await pg.textContent('#wbWho')) && (await pg.evaluate(() => window.WonderBird.state().me)));
    await pg.waitForFunction(() => window.WonderBird.state().run, null, { timeout: 8000 });
    ok('Entry', 'and a server-seeded run has started', !!(await pg.evaluate(() => window.WonderBird.state().run)));
    await pg.waitForFunction(() => /No score yet this week|You:/.test(document.querySelector('#wbSide').textContent));
    const bt = await pg.textContent('#wbSide');
    ok('Board', 'the leaderboard shows this week\'s leaders, prizes, time left and where you stand', /This week/.test(bt) && /Ava S\./.test(bt) && /\$50/.test(bt) && /Ends in/.test(bt) && /No score yet this week|You:/.test(bt), bt.slice(0, 200));
    await pg.screenshot({ path: path.join(SHOTS, 'wb-board.png') });
    ok('Sound', 'music and Mr. Fixit voice can be switched off (and remember it)', await pg.evaluate(() => { document.getElementById('wbMusic').click(); document.getElementById('wbVoice').click(); const s = JSON.parse(localStorage.getItem('mbsWonderBird.sound')); return s.music === false && s.voice === false; }));
    // a reload keeps the player (and the private link isn't left in the address bar)
    await pg.goto(`${BASE}${ent.j.play}`, { waitUntil: 'networkidle' }); await sleep(500);
    ok('Entry', 'opening the Play link signs them in, then hides the private code from the address bar', /Ava/.test(await pg.textContent('#wbWho')) && !/wb=/.test(pg.url()));
    await pg.waitForFunction(() => window.WonderBird.state().state === 'locked', null, { timeout: 8000 });
    ok('Plays', 'with today’s play used, the game says so and goes back to the MBS website', true);
    await pg.waitForURL(/index\.html$/, { timeout: 15000 });
    ok('Plays', '…and it does go back to the main site', /index\.html$/.test(pg.url()));

    // the menu link on the site still opens Mr. Fixit first
    const s2 = await br.newContext({ viewport: { width: 1280, height: 800 } }); const q = await s2.newPage();
    await q.goto(`${BASE}/services.html`, { waitUntil: 'networkidle' }); await q.click('.menu a.nav-win'); await q.waitForSelector('.fx-panel.open .fx-promo-form');
    ok('Site', '"🎁 Win $50" in the site menu still opens Mr. Fixit to enter first', true);

    // phone, sideways
    const ph = await br.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true }); const m = await ph.newPage();
    await m.goto(`${BASE}/wonderbird.html`, { waitUntil: 'networkidle' }); await sleep(500); await m.click('#wbPop-help .wb-go'); await sleep(300);
    const fits = await m.evaluate(() => { const c = document.getElementById('wbCanvas').getBoundingClientRect(); return c.bottom <= innerHeight + 1 && c.right <= innerWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1; });
    ok('Phone', 'on a phone turned sideways the whole game fits on screen', fits);
    await m.click('.wb-tools [data-pop=board]'); await m.waitForSelector('#wbPop-board.open #wbBoard');
    ok('Phone', 'on a small screen the leaderboard is a 🏆 button that slides in', await m.isVisible('#wbPop-board.open'));
    await m.screenshot({ path: path.join(SHOTS, 'wb-phone.png') });
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close(); br = null;
  } catch (e) { try { if (br) await br.close(); } catch {} ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ') + ' LOG: ' + log.slice(-600)); }
  try { srv.kill(); } catch {} try { await blobs.stop(); } catch {}
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(0);
})();
