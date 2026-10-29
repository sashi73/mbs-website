// End-to-end test of v29: drag and drop on the dashboard pipeline board. Each move must update the job stage and
// everything that goes with it (reminder, quote, plan, invoice, payment). Real Blobs, local site, headless Chromium.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const SITE = path.resolve(process.argv[2]);
const PORT = 8906, BASE = `http://127.0.0.1:${PORT}`;
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => { results.push({ area, name, pass: !!pass, detail }); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-drag-blobs'); fs.rmSync(dir, { recursive: true, force: true });
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
    const AI = await import(path.join(SITE, 'netlify/lib/ai.mjs'));
    const today = AI.sydToday();
    const C = {};
    const mk = async (key, name, summary, stages = []) => { const core = await J.nextCore('M'); await J.create({ core, name, phone: '0400 000 0' + String(Object.keys(C).length).padStart(2, '0'), email: '', suburb: 'Box Hill', service: 'Repair', source: 'chat', summary }); for (const [s, x] of stages) await J.setStage(core, s, 'test', x || {}); C[key] = core; return core; };
    const T = (id, name, dur, qty, rate, pred) => ({ id, name, dur, qty, unit: 'h', rate, pred, res: [], status: 'todo', pct: 0, subs: [] });
    const planFor = (core, start) => P.save(core, { name: 'Deck repair plan', start, tasks: [T('t1', 'Quote accepted', 0, 0, 0, []), T('t2', 'Replace boards', 2, 10, 80, ['t1']), T('t3', 'Oil the deck', 1, 6, 70, ['t2'])], risks: [], issues: [], charter: {} }, 0, 'test');
    await mk('nina', 'Nina New', 'Customer Nina New has asked about a leaking tap.');
    await mk('bea', 'Bea Book', 'Customer Bea Book has asked about rotten fascia boards.', [['called']]);
    await mk('cal', 'Cal Quote', 'Customer Cal Quote has asked about a new fence.', [['called']]);
    await mk('dee', 'Dee Deck', 'Customer Dee Deck has asked about a deck with rotten boards.', [['called']]);
    await planFor(C.dee, '2099-03-02');
    await mk('eve', 'Eve Noplan', 'Customer Eve Noplan has asked about a gate.', [['called'], ['quoted', { amount: 900 }], ['won']]);
    await mk('fay', 'Fay Lost', 'Customer Fay Lost has asked about painting.', [['called'], ['quoted', { amount: 3000 }]]);
    await mk('hal', 'Hal Started', 'Customer Hal Started has asked about tiling.', [['called'], ['quoted', { amount: 2000 }], ['won']]);
    await planFor(C.hal, today); const hp = await kv.get('plan:' + C.hal); hp.tasks[1].status = 'doing'; hp.tasks[1].pct = 33; await kv.set('plan:' + C.hal, hp);

    br = await chromium.launch();
    const ctx = await br.newContext({ viewport: { width: 1700, height: 1000 } });
    const p = await ctx.newPage(); p.setDefaultTimeout(10000);
    const errors = []; errorsAll = errors;
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('dialog', (x) => { errors.push('dialog: ' + x.message()); x.dismiss(); });
    const api = async (action, data = {}) => (await p.request.post(`${BASE}/.netlify/functions/admin`, { data: { action, ...data }, headers: { 'X-MBS-Admin': '1' } })).json();
    let r = await p.request.post(`${BASE}/.netlify/functions/admin`, { data: { action: 'boardMove', core: C.nina, to: 'called' }, headers: { 'X-MBS-Admin': '1' } });
    ok('Security', 'moving cards needs a login', r.status() === 401, r.status());
    await p.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
    await p.fill('[name=username]', 'sashi73'); await p.fill('[name=password]', 'sashi98'); await p.click('#loginForm button');
    await p.waitForSelector('#app:not([hidden])');
    // Dee: a quote from the plan, sent
    const q = await api('planQuote', { core: C.dee }); await api('docStatus', { id: q.doc.id, status: 'sent' });

    await p.evaluate(() => { try { localStorage.setItem('mbsDash', 'board'); } catch (e) {} });
    await p.goto(`${BASE}/admin/#dashboard`); await p.waitForSelector('.pcard');
    const heads = await p.$$eval('.pcol .pcol-h b', (h) => h.map((x) => x.textContent));
    ok('Board', 'columns: …, Called, Site visit, planned & quoted, Job won, Job in progress… (no Planning column)', heads.join('|') === 'New enquiry|Called|Site visit, planned & quoted|Job won|Job in progress|Completed|Invoiced|Closed', heads.join('|'));
    const colOf = (k) => p.evaluate((core) => { const c = document.querySelector(`.pcard[data-core="${core}"]`); return c ? c.closest('.pcol').getAttribute('data-col') : ''; }, C[k]);
    ok('Board', 'a called job with a plan and a quote sits in "Site visit, planned & quoted"', (await colOf('dee')) === 'visit');
    const full = async () => { if (!(await p.evaluate(() => document.body.classList.contains('board-full')))) await p.click('#pbFull'); };
    const drag = async (k, to) => {
      await full();
      const card = await p.$(`.pcard[data-core="${C[k]}"] .pc-name`); await card.scrollIntoViewIfNeeded();
      const a = await card.boundingBox(), b = await (await p.$(`.pcol[data-col="${to}"] header`)).boundingBox();
      await p.mouse.move(a.x + 10, a.y + 5); await p.mouse.down();
      await p.mouse.move(a.x + 30, a.y + 20, { steps: 3 });
      await p.mouse.move(b.x + b.width / 2, b.y + b.height + 40, { steps: 8 });
      const lit = await p.$(`.pcol[data-col="${to}"].dropok`);
      await p.mouse.up();
      return !!lit;
    };
    const settle = async () => { await p.waitForFunction(() => !document.querySelector('.pcard.moving'), null, { timeout: 10000 }); await sleep(150); };
    const job = async (k) => kv.get('job:' + C[k]);

    // 1. new -> called (no questions)
    let lit = await drag('nina', 'called'); await settle();
    ok('Drag', 'drag a card to the next column: the target column lights up, the card moves', lit && (await colOf('nina')) === 'called');
    ok('Sync', 'Nina: job stage is now Called', (await job('nina')).stage === 'called');
    // 2. called -> visit: book a site visit
    await drag('bea', 'visit'); await p.waitForSelector('#mvForm');
    await p.check('#mvForm [name=mode][value=visit]'); await p.fill('#mvForm [name=when]', 'tomorrow 10am'); await p.fill('#mvForm [name=note]', 'measure the fascia'); await p.click('#mvOk'); await settle();
    const rems = (await J.reminders()).filter((x) => x.core === C.bea);
    ok('Sync', 'Bea → Site visit: a site-visit reminder is booked and the card moves there', rems.length === 1 && /Site visit: measure the fascia/.test(rems[0].text) && (await colOf('bea')) === 'visit');
    // 3. called -> visit: quote given
    await drag('cal', 'visit'); await p.waitForSelector('#mvForm');
    await p.check('#mvForm [name=mode][value=quoted]'); await p.fill('#mvForm [name=amount]', '5,000'); await p.click('#mvOk'); await settle();
    ok('Sync', 'Cal → quote given $5,000: job Quoted with the amount', (await job('cal')).stage === 'quoted' && (await job('cal')).quote.amount === 5000 && (await colOf('cal')) === 'visit');
    // 4. Dee: visit -> won (quote accepted)
    await drag('dee', 'won'); await p.waitForSelector('#mvForm [name=acceptQuote]');
    ok('Dialog', 'moving to Job won offers to mark the quote accepted', /accepted/.test(await p.textContent('#mvForm')));
    await p.click('#mvOk'); await settle();
    ok('Sync', 'Dee → Job won: job won AND quote ' + q.doc.id + ' accepted in Quotes', (await job('dee')).stage === 'won' && (await kv.get('quote:' + q.doc.id)).status === 'accepted' && (await colOf('dee')) === 'won');
    // 5. Dee: won -> in progress: plan starts today, first task in progress
    await drag('dee', 'progress'); await p.waitForSelector('#mvForm [name=startToday]');
    await p.click('#mvOk'); await settle();
    let plan = await kv.get('plan:' + C.dee);
    ok('Sync', 'Dee → Job in progress: the project plan now starts today; milestone done, first task In progress', plan.start === today && plan.tasks[0].status === 'done' && plan.tasks[1].status === 'doing' && plan.tasks[1].pct === 33 && (await colOf('dee')) === 'progress', JSON.stringify(plan.tasks.map((t) => t.status)) + ' ' + plan.start);
    await p.goto(`${BASE}/admin/#plan/${C.dee}/schedule`); await p.waitForSelector('table.gt');
    ok('Plan page', 'the project plan page shows it: "Replace boards" In progress', (await p.inputValue('tr[data-tid="t2"] [data-k=status]')) === 'doing');
    await p.goto(`${BASE}/admin/#dashboard`); await p.waitForSelector('.pcard');
    // 6. Eve: won without plan -> progress => asked to make the plan first
    await drag('eve', 'progress'); await p.waitForSelector('#mvForm');
    ok('Dialog', 'no plan yet: moving to Job in progress asks to make the project plan first', /Make a project plan first/.test(await p.textContent('#modalBody')));
    await p.click('#mvForm [data-close]'); await sleep(200);
    ok('Board', '…cancel keeps the card where it was', (await colOf('eve')) === 'won' && (await job('eve')).stage === 'won');
    // 7. Dee: progress -> completed (all tasks done)
    await drag('dee', 'completed'); await p.waitForSelector('#mvForm [name=finishPlan]'); await p.click('#mvOk'); await settle();
    plan = await kv.get('plan:' + C.dee);
    ok('Sync', 'Dee → Completed: job completed and every plan task Done', (await job('dee')).stage === 'completed' && plan.tasks.every((t) => t.status === 'done' && t.pct === 100));
    // 8. Dee: completed -> invoiced (invoice made from the quote)
    await drag('dee', 'invoiced'); await p.waitForSelector('#mvForm [name=inv]'); await p.click('#mvOk'); await settle();
    const lists = await api('acctLists'); const inv = lists.invoices.find((i) => i.core === C.dee);
    ok('Sync', 'Dee → Invoiced: a tax invoice is made from the accepted quote (draft) and the job is Invoiced', inv && inv.fromQuote === q.doc.id && (await job('dee')).stage === 'invoiced' && (await job('dee')).invoice.amount === inv.inc);
    // 9. Dee: invoiced -> closed, paid with the payment recorded
    await drag('dee', 'closed'); await p.waitForSelector('#mvForm [name=recordPayment]');
    ok('Dialog', 'closing an invoiced job offers Paid with "record the payment"', await p.isChecked('#mvForm [name=outcome][value=paid]') && await p.isChecked('#mvForm [name=recordPayment]'));
    await p.click('#mvOk'); await settle();
    const invDoc = await kv.get('invoice:' + inv.id);
    ok('Sync', 'Dee → Closed (Paid): payment recorded on the invoice, invoice paid, job paid', invDoc.status === 'paid' && invDoc.paid === inv.inc && (await job('dee')).stage === 'paid');
    // 10. Fay: quoted -> closed lost
    await drag('fay', 'closed'); await p.waitForSelector('#mvForm'); await p.check('#mvForm [name=outcome][value=lost]'); await p.fill('#mvForm [name=reason]', 'too expensive'); await p.click('#mvOk'); await settle();
    ok('Sync', 'Fay → Closed (Lost): job lost with the reason', (await job('fay')).stage === 'lost' && (await job('fay')).lost_reason === 'too expensive');
    // 11. a job with a plan can't go back to New enquiry
    const fa = await kv.get('job:' + C.cal);
    await planFor(C.cal, '2099-04-06'); await p.click('#pbRefresh'); await sleep(400);
    await drag('cal', 'new'); await sleep(400);
    ok('Rules', 'a job with a project plan cannot be dragged back to New enquiry (message shown, nothing changes)', (await colOf('cal')) === 'visit' && (await job('cal')).stage === fa.stage && /project plan/.test(await p.textContent('.toast')));
    // 12. Hal: in progress -> back to won resets the plan (asks first)
    ok('Board', 'a won job whose plan has started shows in Job in progress', (await colOf('hal')) === 'progress');
    await drag('hal', 'won'); await p.waitForSelector('#okBtn');
    ok('Dialog', 'moving back from In progress warns that the plan goes back to To do', /To do/.test(await p.textContent('#modalBody')));
    await p.click('#okBtn'); await settle();
    plan = await kv.get('plan:' + C.hal);
    ok('Sync', 'Hal → Job won: plan tasks back to To do, card in Job won', plan.tasks.every((t) => t.status === 'todo' && t.pct === 0) && (await colOf('hal')) === 'won');
    // 13. the ⇄ Move menu (for phones / keyboard)
    await p.click(`.pcard[data-core="${C.eve}"] [data-move]`); await p.waitForSelector('.pmenu');
    ok('Menu', '⇄ opens a "Move to…" menu with the other 7 columns', (await p.$$('.pmenu [data-to]')).length === 7);
    await p.click('.pmenu [data-to=completed]'); await p.waitForSelector('#mvForm'); await p.click('#mvOk'); await settle();
    ok('Menu', 'Eve moved to Completed from the menu', (await job('eve')).stage === 'completed' && (await colOf('eve')) === 'completed');
    // 14. a plain click still opens the job
    await p.click(`.pcard[data-core="${C.nina}"] .pc-title`); await p.waitForFunction(() => /#job\//.test(location.hash));
    ok('Click', 'a plain click (no drag) still opens the job', new RegExp(C.nina).test(p.url()));
    await p.goto(`${BASE}/admin/#dashboard`); await p.waitForSelector('.pcard'); await p.screenshot({ path: 'MBS_board_drag.jpg', type: 'jpeg', quality: 80 });
    const audit = JSON.stringify(await api('log'));
    ok('Audit', 'every move is in the activity log', /Pipeline board: .* → progress/.test(audit) && /Pipeline board: .* → closed/.test(audit));
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close(); br = null;
  } catch (e) { try { if (br) await br.close(); } catch {} ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ')); }
  await cleanup();
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  if (pass !== results.length) console.log('\n--- server log ---\n' + log.slice(-2500));
})();
