// End-to-end test of v31 emergency detection: the customer said "Emergency" in the Mr. Fixit chat, or the scope / AI
// description says so -> Emergency ticked -> the work can start the same day as the site inspection. Real Blobs, local site, Chromium.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const SITE = path.resolve(process.argv[2]);
const PORT = 8908, BASE = `http://127.0.0.1:${PORT}`;
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => { results.push({ area, name, pass: !!pass, detail }); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-emerg-blobs'); fs.rmSync(dir, { recursive: true, force: true });
  const blobs = new BlobsServer({ directory: dir, token: 'tok', port: 0 });
  const { port: bport } = await blobs.start();
  const ctxB64 = Buffer.from(JSON.stringify({ siteID: 'mbs', token: 'tok', edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, apiURL: `http://localhost:${bport}` })).toString('base64');
  process.env.NETLIFY_BLOBS_CONTEXT = ctxB64;
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NETLIFY_BLOBS_CONTEXT: ctxB64, ADMIN_USERNAME: 'sashi73', ADMIN_PASSWORD: 'sashi98', LLM_API_KEY: '', TELEGRAM_BOT_TOKEN: '', RESEND_API_KEY: '', LIMIT_LEAD: '100/1' };
  const srv = spawn('node', ['local-server.mjs'], { cwd: SITE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 40 && !/running/.test(log); i++) await sleep(150);
  let br = null;
  const cleanup = async () => { try { srv.kill(); } catch {} try { await blobs.stop(); } catch {} };
  try {
    const J = await import(path.join(SITE, 'netlify/lib/jobs.mjs'));
    const kv = await import(path.join(SITE, 'netlify/lib/kv.mjs'));
    const P = await import(path.join(SITE, 'netlify/lib/plan.mjs'));
    br = await chromium.launch();
    const ctx = await br.newContext({ viewport: { width: 1500, height: 950 } });
    const p = await ctx.newPage(); p.setDefaultTimeout(10000);
    const errors = []; errorsAll = errors;
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('dialog', (x) => { errors.push('dialog: ' + x.message()); x.dismiss(); });
    // 1. the customer chose "Emergency" in the Mr. Fixit chat (website lead)
    await p.request.post(`${BASE}/.netlify/functions/lead`, { data: { lead: { name: 'Ella Urgent', phone: '0411 222 333', email: '', suburb: 'Box Hill', service: 'Leak', urgency: 'Emergency', summary: 'Ella has a leak through the ceiling.', details: 'water through the ceiling' }, channels: ['email'], source: 'chat' } });
    const ella = (await J.all()).find((j) => j.name === 'Ella Urgent');
    const ej = await kv.get('job:' + ella.core);
    ok('Chat', 'the urgency the customer picked in the chat ("Emergency") is saved on the job', ej.urgency === 'Emergency');
    ok('Chat', 'the job reads as an emergency', P.isEmergency(ej));
    const calm = await J.nextCore('M');
    await J.create({ core: calm, name: 'Carl Calm', phone: '0400 999 888', email: '', suburb: 'Kellyville', service: 'Painting', source: 'chat', summary: 'Customer Carl Calm has asked about painting two bedrooms.' });

    await p.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
    await p.fill('[name=username]', 'sashi73'); await p.fill('[name=password]', 'sashi98'); await p.click('#loginForm button');
    await p.waitForSelector('#app:not([hidden])');
    await p.goto(`${BASE}/admin/#plan/${ella.core}`); await p.waitForSelector('#tplEmerg');
    ok('Chat', 'starting her plan: 🚨 Emergency is already ticked, and it says the customer said so', await p.isChecked('#tplEmerg') && /said this is an emergency/.test(await p.textContent('.toast')));
    await p.selectOption('#tplType', 'plumb-leak'); await p.click('#tplCreate'); await p.waitForSelector('table.gt');
    const ep = await kv.get('plan:' + ella.core), es = P.schedule(JSON.parse(JSON.stringify(ep)));
    const insp = es.tasks.find((t) => /inspection/i.test(t.name)), work = es.tasks.find((t) => /Order materials/.test(t.name)), ms = es.tasks.find((t) => /Quote accepted/.test(t.name));
    ok('Start now', 'the plan is an emergency: the work starts the same day as the site inspection', ep.emergency === true && work.es === insp.es && ms.es === insp.es, JSON.stringify([insp.es, ms.es, work.es]));
    ok('Start now', 'the plan page shows 🚨 Emergency ticked', await p.isChecked('#pEmerg') && /Emergency:/.test(await p.textContent('.qgate')));

    // 2. you type that it is an emergency
    await p.goto(`${BASE}/admin/#plan/${calm}`); await p.waitForSelector('#tplEmerg');
    ok('Typed', 'a normal job: not ticked', !(await p.isChecked('#tplEmerg')));
    await p.fill('#tplScope', 'Paint two bedrooms. Actually it is urgent: burst pipe in the roof, water everywhere, start straight away');
    ok('Typed', 'typing that it is urgent / a burst pipe ticks Emergency (with a message)', await p.isChecked('#tplEmerg') && /you said it is an emergency/.test(await p.textContent('.toast')));
    await p.uncheck('#tplEmerg'); await p.fill('#tplScope', 'Paint two bedrooms, emergency');
    ok('Typed', 'if you untick it yourself, typing does not tick it again', !(await p.isChecked('#tplEmerg')));
    await p.check('#tplEmerg');
    await p.click('[data-mode=ai]'); await p.click('[data-mode=type]');
    await p.selectOption('#tplType', 'paint-room'); await p.click('#tplCreate'); await p.waitForSelector('table.gt');
    ok('Typed', 'the plan is made as an emergency', (await kv.get('plan:' + calm)).emergency === true);

    // 4. dates in plain words: "starts tomorrow and ends in one day"
    const day1 = await J.nextCore('M');
    await J.create({ core: day1, name: 'Dan Quick', phone: '0400 777 666', email: '', suburb: 'Box Hill', service: 'Gate', source: 'phone', summary: 'Customer Dan Quick has asked about fixing a gate.' });
    const AI = await import(path.join(SITE, 'netlify/lib/ai.mjs'));
    const tday = AI.sydToday(), tom = P.nextWork(new Date(Date.parse(tday + 'T00:00:00Z') + 864e5).toISOString().slice(0, 10));
    const dmy = (x) => x.slice(8, 10) + '/' + x.slice(5, 7) + '/' + x.slice(0, 4);
    await p.goto(`${BASE}/admin/#plan/${day1}`); await p.waitForSelector('#tplScope');
    await p.fill('#tplScope', 'Fix the side gate latch and hinges. The work starts tomorrow and ends in one day.');
    await p.waitForFunction(() => /From what you wrote/.test((document.querySelector('.toast') || {}).textContent || ''), null, { timeout: 5000 });
    ok('Dates in words', '"starts tomorrow and ends in one day": Start date set to tomorrow (DD/MM/YYYY), with a message', (await p.inputValue('#tplStart')) === tom && (await p.inputValue('.dbox:has(#tplStart) .dtext')) === dmy(tom) && /starts /.test(await p.textContent('.toast')), await p.inputValue('#tplStart'));
    ok('Dates in words', '…the cooling-off is set to 0 so the work can really start tomorrow (customer must agree)', /cooling-off set to 0/.test(await p.textContent('.toast')));
    await p.click('[data-mode=ai]');
    ok('Dates in words', '…and ✨ Ask AI gets Finish by = tomorrow (one day)', (await p.inputValue('#aiFinish')) === tom);
    await p.click('[data-mode=type]'); await p.selectOption('#tplType', 'gate'); await p.click('#tplCreate'); await p.waitForSelector('table.gt');
    const dp = await kv.get('plan:' + day1);
    ok('Dates in words', 'the plan starts tomorrow with no cooling-off', dp.start === tom && dp.coolOff === 0, JSON.stringify([dp.start, dp.coolOff]));
    // your own date wins
    const day2 = await J.nextCore('M');
    await J.create({ core: day2, name: 'Dot Later', phone: '0400 555 444', email: '', suburb: 'Box Hill', service: 'Fence', source: 'phone', summary: 'Customer Dot Later has asked about a fence.' });
    await p.goto(`${BASE}/admin/#plan/${day2}`); await p.waitForSelector('#tplScope');
    const mine = P.addWork(P.nextWork(tday), 10);
    await p.fill('.dbox:has(#tplStart) .dtext', dmy(mine)); await p.press('.dbox:has(#tplStart) .dtext', 'Enter');
    await p.fill('#tplScope', 'New fence. Start tomorrow.'); await sleep(900);
    ok('Dates in words', 'a date you set yourself is not overwritten by the words', (await p.inputValue('#tplStart')) === mine);

    // 3. the pipeline board shows it
    const b = await (await p.request.post(`${BASE}/.netlify/functions/admin`, { data: { action: 'pipelineBoard' }, headers: { 'X-MBS-Admin': '1' } })).json();
    ok('Board', 'emergency jobs are flagged on the pipeline board', b.cards.find((c) => c.core === ella.core).emergency === true && b.cards.find((c) => c.core === calm).emergency === true);
    await p.evaluate(() => { try { localStorage.setItem('mbsDash', 'board'); } catch (e) {} });
    await p.goto(`${BASE}/admin/#dashboard`); await p.waitForSelector('.pcard');
    ok('Board', 'the card shows 🚨 Emergency', /🚨 Emergency/.test(await p.textContent(`.pcard[data-core="${ella.core}"]`)));
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close(); br = null;
  } catch (e) { try { if (br) await br.close(); } catch {} ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ')); }
  await cleanup();
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  if (pass !== results.length) console.log('\n--- server log ---\n' + log.slice(-2500));
})();
