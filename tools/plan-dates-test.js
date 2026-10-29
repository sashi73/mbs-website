// End-to-end test of v30: the plan keeps your place while editing, dates are DD/MM/YYYY, tasks can start in parallel
// (within the project start and finish), and work can only start once the quote is accepted. Real Blobs, local site, Chromium.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const SITE = path.resolve(process.argv[2]);
const PORT = 8907, BASE = `http://127.0.0.1:${PORT}`;
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => { results.push({ area, name, pass: !!pass, detail }); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-plan30-blobs'); fs.rmSync(dir, { recursive: true, force: true });
  const blobs = new BlobsServer({ directory: dir, token: 'tok', port: 0 });
  const { port: bport } = await blobs.start();
  const ctxB64 = Buffer.from(JSON.stringify({ siteID: 'mbs', token: 'tok', edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, apiURL: `http://localhost:${bport}` })).toString('base64');
  process.env.NETLIFY_BLOBS_CONTEXT = ctxB64;
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NETLIFY_BLOBS_CONTEXT: ctxB64, ADMIN_USERNAME: 'sashi73', ADMIN_PASSWORD: 'sashi98', LLM_API_KEY: '', TELEGRAM_BOT_TOKEN: '', RESEND_API_KEY: '' };
  const srv = spawn('node', ['local-server.mjs'], { cwd: SITE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 40 && !/running/.test(log); i++) await sleep(150);
  let br = null;
  const cleanup = async () => { try { srv.kill(); } catch {} try { await blobs.stop(); } catch {} };

  try {
    const J = await import(path.join(SITE, 'netlify/lib/jobs.mjs'));
    const kv = await import(path.join(SITE, 'netlify/lib/kv.mjs'));
    const P = await import(path.join(SITE, 'netlify/lib/plan.mjs'));
    const ACC = await import(path.join(SITE, 'netlify/lib/accounts.mjs'));
    const today = ACC.today();
    const dmy = (s) => s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4);
    const core = await J.nextCore('W');
    await J.create({ core, name: 'Priya Nair', phone: '0400 000 001', email: 'priya@example.com', suburb: 'Castle Hill', service: 'Bathroom', source: 'chat', summary: 'Waterproof and retile the bathroom' });
    // a long plan (lots of rows) so editing low down would scroll; work tasks wait for the "Quote accepted" milestone
    const T = (id, name, dur, pred, extra = {}) => ({ id, name, dur, qty: 1, unit: 'h', rate: 50, pred, res: [], status: 'todo', pct: 0, subs: [], ...extra });
    const tasks = [T('t1', 'Site inspection & measure', 1, []), T('t2', 'Quote accepted', 0, ['t1']), T('t3', 'Order materials', 1, ['t2'])];
    for (let i = 4; i <= 30; i++) tasks.push(T('t' + i, 'Work step ' + i, 1, ['t' + (i - 1)]));
    await P.save(core, { name: 'Long plan', start: today, tasks, risks: [], issues: [], charter: {} }, 0, 'test');

    br = await chromium.launch();
    const ctx = await br.newContext({ viewport: { width: 1500, height: 900 }, locale: 'en-US' });   // a US-English computer would show MM/DD/YYYY in normal date boxes
    const p = await ctx.newPage(); p.setDefaultTimeout(10000);
    const errors = []; errorsAll = errors;
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('dialog', (x) => { errors.push('dialog: ' + x.message()); x.dismiss(); });
    const api = async (action, data = {}) => (await p.request.post(`${BASE}/.netlify/functions/admin`, { data: { action, ...data }, headers: { 'X-MBS-Admin': '1' } })).json();
    const saved = async () => { await p.waitForTimeout(150); await p.waitForFunction(() => document.querySelector('#planSave') && document.querySelector('#planSave').textContent === 'Saved ✓', null, { timeout: 8000 }); };
    const ui = (id) => p.evaluate((i) => window.MBS.planState.plan.tasks.find((t) => t.id === i), id);
    await p.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
    await p.fill('[name=username]', 'sashi73'); await p.fill('[name=password]', 'sashi98'); await p.click('#loginForm button');
    await p.waitForSelector('#app:not([hidden])');
    await p.goto(`${BASE}/admin/#plan/${core}/schedule`); await p.waitForSelector('table.gt');
    await p.click('[data-cols=a]'); await p.waitForSelector('table.gt.v-a');

    // ---- 1. keeps your place ----
    const row = 'tr[data-tid="t26"]';
    await p.$eval(row, (e) => e.scrollIntoView({ block: 'center' }));
    const before = await p.evaluate(() => ({ y: window.scrollY, l: document.querySelector('#gLeft').scrollTop }));
    await p.click(`${row} [data-k=dur]`); await p.fill(`${row} [data-k=dur]`, '3');
    await p.click(`${row} [data-k=qty]`);   // click the next box: the change is saved and the plan redrawn
    await saved(); await sleep(200);
    const after = await p.evaluate(() => ({ y: window.scrollY, l: document.querySelector('#gLeft').scrollTop, f: document.activeElement && document.activeElement.getAttribute('data-k'), tid: document.activeElement && document.activeElement.closest('tr') && document.activeElement.closest('tr').getAttribute('data-tid') }));
    ok('Place', 'editing a task low in the list does not jump back to the top (page and task list stay put)', before.l > 200 && Math.abs(after.l - before.l) < 40 && Math.abs(after.y - before.y) < 40, JSON.stringify([before, after]));
    ok('Place', 'the box you clicked next keeps the cursor (Qty of the same task)', after.f === 'qty' && after.tid === 't26', JSON.stringify(after));
    ok('Place', 'the change was made (Work step 26 is 3 days)', (await ui('t26')).dur === 3);
    await p.keyboard.type('4'); await p.keyboard.press('Tab'); await saved();
    ok('Place', 'typing carries on in the box you moved to', (await ui('t26')).qty === 4 || (await ui('t26')).qty === 14, JSON.stringify((await ui('t26')).qty));

    // ---- 2. DD/MM/YYYY ----
    const startText = await p.inputValue('tr[data-tid="t1"] .dtext');
    ok('Dates', 'start dates show as DD/MM/YYYY (even on a US-English computer)', startText === dmy((await ui('t1')).es), startText);
    ok('Dates', 'finish dates show as DD/MM/YYYY too', (await p.textContent('tr[data-tid="t1"] td:nth-child(7)')).trim() === dmy((await ui('t1')).ef), await p.textContent('tr[data-tid="t1"] td:nth-child(7)'));
    ok('Dates', 'project start box is DD/MM/YYYY with a 📅 calendar button', (await p.inputValue('.dbox:has(#pStart) .dtext')) === dmy(today) && !!(await p.$('.dbox:has(#pStart) .dpick')));
    ok('Dates', 'the plan\'s own date boxes are all DD/MM/YYYY', await p.evaluate(() => [...document.querySelectorAll('#view .dtext')].every((t) => !t.value || /^\d{2}\/\d{2}\/\d{4}$/.test(t.value))));

    // ---- 3. parallel start (within the project) ----
    await p.$eval('tr[data-tid="t5"]', (e) => e.scrollIntoView({ block: 'center' }));
    const t5 = await ui('t5'), t4 = await ui('t4');
    const tgt = t4.es;   // start step 5 together with step 4 (normally it waits for step 4 to finish)
    await p.fill('tr[data-tid="t5"] .dtext', dmy(tgt)); await p.press('tr[data-tid="t5"] .dtext', 'Enter'); await saved();
    let x5 = await ui('t5');
    ok('Parallel', 'typing an earlier start (DD/MM/YYYY) lets a task run in parallel with the one before it', x5.es === tgt && x5.es < t5.es && x5.fixed === true, JSON.stringify([t4.es, t5.es, x5.es]));
    ok('Parallel', '…and says so (runs in parallel; After # no longer used, shown struck through)', /Runs in parallel/.test(await p.textContent('.toast')) && !!(await p.$('tr[data-tid="t5"] input.predoff')));
    let st = await kv.get('plan:' + core), r;
    const srv5 = P.schedule(JSON.parse(JSON.stringify(st))).tasks.find((t) => t.id === 't5');
    ok('Parallel', 'the server works out the same dates', srv5.es === tgt && st.tasks.find((t) => t.id === 't5').fixed === true);
    // before the project start: refused
    const prev = P.prevWork(today);
    await p.fill('tr[data-tid="t5"] .dtext', dmy(prev)); await p.press('tr[data-tid="t5"] .dtext', 'Enter'); await saved();
    ok('Limits', 'a start before the project start is not allowed (moved to the project start, with a message)', (await ui('t5')).es === P.nextWork(today) && /before the project start/.test(await p.textContent('.toast')), (await ui('t5')).es);
    // after the project finish: allowed since v40 (the project gets longer)
    const fin = (await p.evaluate(() => window.MBS.planState.plan.tasks.reduce((m, t) => (t.ef > m ? t.ef : m), '')));
    await p.fill('tr[data-tid="t5"] .dtext', dmy(P.addWork(fin, 10))); await p.press('tr[data-tid="t5"] .dtext', 'Enter'); await saved();
    ok('Limits', 'v40: a start after the project finish is allowed: the task keeps the date and the project gets longer (with a message)', (await ui('t5')).es === P.addWork(fin, 10) && /project gets longer/.test(await p.textContent('.toast')), (await ui('t5')).es);
    // clearing the date follows "After #" again
    await p.fill('tr[data-tid="t5"] .dtext', ''); await p.press('tr[data-tid="t5"] .dtext', 'Enter'); await saved();
    x5 = await ui('t5');
    ok('Parallel', 'clearing the date: the task follows "After #" again', !x5.fixed && !x5.snet && x5.es === t5.es);
    // bad date text
    await p.fill('tr[data-tid="t5"] .dtext', '31/02/2027'); await p.press('tr[data-tid="t5"] .dtext', 'Enter'); await sleep(200);
    ok('Dates', 'a date that does not exist (31/02) is refused with a hint', /DD\/MM\/YYYY/.test(await p.textContent('.toast')) && (await ui('t5')).es === t5.es);

    // ---- 4. the quote gates the work: accepted + cooling-off (3 business days); emergency = straight away ----
    const q = await api('planQuote', { core, validDays: 10 });
    const G3 = P.addWork(P.nextWork(today), 3), G5 = P.addWork(P.nextWork(today), 5);
    st = await kv.get('plan:' + core);
    ok('Quote gate', 'making the quote records it on the plan (not accepted yet: the quote date counts as acceptance)', st.gate && st.gate.date === today && st.gate.accepted === false && st.gate.id === q.doc.id, JSON.stringify(st.gate));
    await p.reload(); await p.waitForSelector('.qgate #pEmerg');
    const g3 = await ui('t3'), g1 = await ui('t1'), g2 = await ui('t2');
    ok('Cooling-off', 'not an emergency: the work starts 3 business days after the quote (cooling-off)', g2.es === G3 && g3.es >= G3, JSON.stringify([g2.es, g3.es, G3]));
    ok('Cooling-off', 'tasks before the quote (site inspection) are not held back', g1.es === P.nextWork(today));
    ok('Cooling-off', 'the plan says so: not accepted yet, 3 business days cooling-off, work starts DD/MM/YYYY', /not accepted yet/.test(await p.textContent('.qgate')) && /3 business days cooling-off/.test(await p.textContent('.qgate')) && (await p.textContent('.qgate')).includes(dmy(G3)), await p.textContent('.qgate'));
    const pdf = await api('docGet', { id: q.doc.id });
    ok('Cooling-off', 'the quote\'s plan pages use the same dates and the quote notes explain the cooling-off', pdf.doc.plan.snapshot.tasks.find((t) => t.n === 'Quote accepted').es === G3 && /cooling-off period of 3 business days/.test(pdf.doc.notes), pdf.doc.notes);
    await p.$eval('tr[data-tid="t6"]', (e) => e.scrollIntoView({ block: 'center' }));
    await p.fill('tr[data-tid="t6"] .dtext', dmy(P.nextWork(today))); await p.press('tr[data-tid="t6"] .dtext', 'Enter'); await saved();
    ok('Cooling-off', 'a hand-set start inside the cooling-off is moved to the first allowed day, with a message', (await ui('t6')).es >= G3 && /cooling-off/.test(await p.textContent('.toast')), (await ui('t6')).es);
    await p.fill('tr[data-tid="t6"] .dtext', ''); await p.press('tr[data-tid="t6"] .dtext', 'Enter'); await saved();
    // cooling-off can be changed (full period = 5)
    await p.selectOption('#pCool', '5'); await saved();
    ok('Cooling-off', 'cooling-off set to 5 business days (the full period): the work moves 2 days later', (await ui('t2')).es === G5 && (await kv.get('plan:' + core)).coolOff === 5);
    await p.selectOption('#pCool', '3'); await saved();
    // emergency: straight away, the same day as the site inspection
    await p.check('#pEmerg'); await saved();
    let e2 = await ui('t2'), e3 = await ui('t3');
    ok('Emergency', 'Emergency ticked: the work starts the same day as the site inspection (no cooling-off)', e2.es === g1.es && e3.es === g1.es && (await kv.get('plan:' + core)).emergency === true, JSON.stringify([g1.es, e2.es, e3.es]));
    ok('Emergency', 'the plan says so and the cooling-off box is off', /Emergency:/.test(await p.textContent('.qgate')) && await p.isDisabled('#pCool'));
    ok('Emergency', 'the server schedules it the same way', P.schedule(JSON.parse(JSON.stringify(await kv.get('plan:' + core)))).tasks.find((t) => t.id === 't3').es === g1.es);
    await p.uncheck('#pEmerg'); await saved();
    ok('Emergency', 'untick: the cooling-off applies again', (await ui('t2')).es === G3);
    // accepted (today): accepted date + cooling-off
    await api('docStatus', { id: q.doc.id, status: 'accepted' });
    st = await kv.get('plan:' + core);
    ok('Cooling-off', 'quote accepted: the gate is the acceptance date', st.gate.accepted === true && st.gate.date === today, JSON.stringify(st.gate));
    await p.goto(`${BASE}/admin/#plan/${core}/overview`); await p.goto(`${BASE}/admin/#plan/${core}/schedule`); await p.waitForFunction(() => /accepted on/.test((document.querySelector('.qgate') || {}).textContent || ''));
    ok('Cooling-off', 'the plan updates by itself: ✅ accepted on DD/MM/YYYY, work 3 business days later', (await ui('t2')).es === G3 && (await p.textContent('.qgate')).includes(dmy(today)));
    const board = await api('pipelineBoard', {});
    ok('Cooling-off', 'the pipeline board uses the same dates', board.cards.find((c) => c.core === core).plan.finish === (await p.evaluate(() => window.MBS.planState.plan.tasks.reduce((m, t) => (t.ef > m ? t.ef : m), ''))));
    await api('planQuote', { core });
    st = await kv.get('plan:' + core);
    ok('Cooling-off', 'a later quote (variation) does not hold the job back again: the accepted quote still counts', st.gate.accepted === true && st.gate.id === q.doc.id);

    // ---- 5. "Work starts" on the quote moves the plan and its Gantt chart ----
    const ws = P.addWork(P.nextWork(today), 15);
    await p.goto(`${BASE}/admin/#doc/${q.doc.id}`); await p.waitForSelector('#docPlan .dtext');
    ok('Quote start', 'the quote page has a "Work starts" date (DD/MM/YYYY)', /^\d{2}\/\d{2}\/\d{4}$/.test(await p.inputValue('#docPlan .dtext')));
    await p.fill('#docPlan .dtext', dmy(ws)); await p.press('#docPlan .dtext', 'Enter');
    await p.waitForSelector('.toast >> text=plan and Gantt chart updated');
    st = await kv.get('plan:' + core);
    const sched = P.schedule(JSON.parse(JSON.stringify(st)));
    let qd = await kv.get('quote:' + q.doc.id);
    ok('Quote start', 'changing it on the quote moves the project plan: work tasks start that day, site inspection stays', st.workStart === ws && sched.tasks.find((t) => t.id === 't3').es === ws && sched.tasks.find((t) => t.id === 't1').es === P.nextWork(today), JSON.stringify([st.workStart, sched.tasks.find((t) => t.id === 't3').es]));
    ok('Quote start', 'the quote\'s plan pages (Gantt chart in the PDF) and its dates line follow', qd.plan.snapshot.workStart === ws && qd.plan.snapshot.tasks.find((t) => t.n === 'Order materials').es === ws && new RegExp('Work planned to start ' + ACC.prettyDate(ws)).test(qd.notes), qd.notes);
    await p.goto(`${BASE}/admin/#plan/${core}/schedule`); await p.waitForSelector('#pWork');
    ok('Quote start', 'the plan page shows the same "Work starts" date and the Gantt chart moved', (await p.inputValue('.dbox:has(#pWork) .dtext')) === dmy(ws) && (await ui('t3')).es === ws);
    // before the project start: refused on the quote
    r = await p.request.post(`${BASE}/.netlify/functions/admin`, { data: { action: 'quoteStart', id: q.doc.id, date: P.prevWork(today) }, headers: { 'X-MBS-Admin': '1' } });
    ok('Quote start', 'a work start before the project start is refused', r.status() === 400 && /before the project start/.test((await r.json()).error));
    // changing it on the plan page keeps the latest quote (from the plan) in step
    const ws2 = P.addWork(ws, 5), live = (await api('acctLists')).quotes.filter((x) => x.core === core && x.status !== 'void').sort((a, b) => (a.id > b.id ? 1 : -1)).pop();
    await p.fill('.dbox:has(#pWork) .dtext', dmy(ws2)); await p.press('.dbox:has(#pWork) .dtext', 'Enter');
    await p.waitForSelector('.toast >> text=updated too');
    qd = await kv.get('quote:' + live.id); st = await kv.get('plan:' + core);
    ok('Quote start', 'changing "Work starts" on the plan updates the quote too (' + live.id + ')', st.workStart === ws2 && qd.plan.snapshot.workStart === ws2 && (await ui('t3')).es === ws2, JSON.stringify([st.workStart, qd.plan.snapshot.workStart]));
    ok('PDF', 'quote PDF wording: "You get an update frequently, and any change is agreed in writing first"', /You get an update frequently, and any change is agreed in writing first/.test(fs.readFileSync(path.join(SITE, 'netlify/lib/pdf.mjs'), 'utf8')) && (await (await p.request.get(`${BASE}/.netlify/functions/admin?action=pdf&id=${q.doc.id}`)).body()).length > 5000);
    await p.screenshot({ path: 'MBS_plan30.jpg', type: 'jpeg', quality: 80 });
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close(); br = null;
  } catch (e) { try { if (br) await br.close(); } catch {} ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ')); }
  await cleanup();
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  if (pass !== results.length) console.log('\n--- server log ---\n' + log.slice(-2500));
})();
