// End-to-end test of the dashboard pipeline board (v26): real Blobs, local site, headless Chromium.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const SITE = path.resolve(process.argv[2]);
const PORT = 8903, BASE = `http://127.0.0.1:${PORT}`;
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => { results.push({ area, name, pass: !!pass, detail }); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 864e5;

(async () => {
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-board-blobs'); fs.rmSync(dir, { recursive: true, force: true });
  const blobs = new BlobsServer({ directory: dir, token: 'tok', port: 0 });
  const { port: bport } = await blobs.start();
  const ctxB64 = Buffer.from(JSON.stringify({ siteID: 'mbs', token: 'tok', edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, apiURL: `http://localhost:${bport}` })).toString('base64');
  process.env.NETLIFY_BLOBS_CONTEXT = ctxB64;
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NETLIFY_BLOBS_CONTEXT: ctxB64, ADMIN_USERNAME: 'sashi73', ADMIN_PASSWORD: 'sashi98', LLM_API_KEY: '', TELEGRAM_BOT_TOKEN: '', RESEND_API_KEY: '' };
  const srv = spawn('node', ['local-server.mjs'], { cwd: SITE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 40 && !/running/.test(log); i++) await sleep(150);
  const cleanup = async () => { try { srv.kill(); } catch {} try { await blobs.stop(); } catch {} };

  try {
    const J = await import(path.join(SITE, 'netlify/lib/jobs.mjs'));
    const kv = await import(path.join(SITE, 'netlify/lib/kv.mjs'));
    const P = await import(path.join(SITE, 'netlify/lib/plan.mjs'));
    const AI = await import(path.join(SITE, 'netlify/lib/ai.mjs'));
    const today = AI.sydToday();
    const C = {};
    const mk = async (key, name, summary, stages = [], back = {}) => {
      const core = await J.nextCore('M');
      await J.create({ core, name, phone: '0400 000 000', email: '', suburb: 'Box Hill', service: 'Repair question (Ask Mr. Fixit)', source: 'chat', summary });
      for (const [st, extra] of stages) await J.setStage(core, st, 'test', extra || {});
      if (Object.keys(back).length) {   // pretend things happened some days ago
        const j = await kv.get('job:' + core);
        for (const [f, d] of Object.entries(back)) j[f] = Date.now() - d * DAY;
        await kv.set('job:' + core, j); await J.setStage(core, j.stage, 'test');
        const j2 = await kv.get('job:' + core); for (const [f, d] of Object.entries(back)) j2[f] = Date.now() - d * DAY; await kv.set('job:' + core, j2);
        await kv.update('index', (idx) => { idx.jobs[core] = J.summary(j2); return idx; });
      }
      C[key] = core; return core;
    };
    await mk('new', 'Nina New', 'Customer Nina New from Box Hill has asked about a leaking gutter over the back door.');
    await mk('newOld', 'Oscar Old', 'Customer Oscar Old has asked about cracked bathroom tiles.', [], { created: 4 });
    await mk('called', 'Cal Called', 'Customer Cal Called has asked about a sticking front door.', [['called']]);
    await mk('visit', 'Vera Visit', 'Customer Vera Visit has asked about a deck that has rotten boards.', [['called']]);
    await J.addReminder({ at: Date.now() + 2 * DAY, core: C.visit, chat: 'alerts', text: 'Site visit: measure the deck', by: 'test' });
    await mk('quoted', 'Quinn Quote', 'Customer Quinn Quote has asked about a new Colorbond fence.', [['called'], ['quoted', { amount: 5200 }]], { quoted_at: 10 });
    await mk('won', 'Wendy Won', 'Customer Wendy Won has asked about a balcony leak.', [['called'], ['quoted', { amount: 8000 }], ['won']]);
    await mk('planning', 'Pat Plan', 'Customer Pat Plan has asked about an exterior repaint.', [['called'], ['quoted', { amount: 12000 }], ['won']]);
    await mk('progress', 'Pia Progress', 'Customer Pia Progress has asked about a bathroom renovation.', [['called'], ['quoted', { amount: 22000 }], ['won']]);
    const start = P.prevWork(P.prevWork(P.prevWork(today)));
    const task = (id, name, dur, pct, pred) => ({ id, name, dur, qty: 1, unit: 'lot', rate: 1000, pct, status: pct >= 100 ? 'done' : pct > 0 ? 'doing' : 'todo', pred: pred || [], res: [], actual: 0 });
    await P.save(C.planning, { name: 'Repaint plan', start: P.nextWork(P.prevWork(today)), tasks: [task('t1', 'Prep', 2, 0), task('t2', 'Paint', 3, 0, ['t1'])], risks: [], issues: [], charter: {} }, 0, 'test');
    // move the planning plan's start into the future so it is clearly "not started"
    const pp = await kv.get('plan:' + C.planning); pp.start = '2099-01-05'; await kv.set('plan:' + C.planning, pp);
    await P.save(C.progress, { name: 'Bathroom plan', start, tasks: [task('t1', 'Strip-out', 1, 100), task('t2', 'Waterproof', 1, 0, ['t1']), task('t3', 'Tile', 5, 0, ['t2'])],
      risks: [{ id: 'r1', title: 'Asbestos', p: 4, i: 4, status: 'Open' }], issues: [], charter: {} }, 0, 'test');
    await mk('completed', 'Cora Complete', 'Customer Cora Complete has asked about a new laundry tub.', [['called'], ['quoted', { amount: 900 }], ['won'], ['completed']], { completed_at: 3 });
    await mk('invoiced', 'Ivan Invoice', 'Customer Ivan Invoice has asked about a hot water system.', [['called'], ['quoted', { amount: 2400 }], ['won'], ['completed'], ['invoiced', { amount: 2400 }]], { invoiced_at: 20 });
    await mk('paid', 'Paula Paid', 'Customer Paula Paid has asked about a ceiling patch.', [['called'], ['quoted', { amount: 600 }], ['won'], ['completed'], ['invoiced', { amount: 600 }], ['paid']]);
    await mk('lostOld', 'Larry Lost', 'Customer Larry Lost has asked about a pergola.', [['called'], ['lost', { reason: 'price' }]], { lost_at: 60, updated: 60 });

    // ---- server ----
    const b = await P.pipelineBoard({ closedDays: 30 });
    const col = (k) => (b.cards.find((c) => c.core === C[k]) || {}).col;
    ok('Server', 'nine columns in order', b.cols.join(',') === 'new,called,visit,won,planning,progress,completed,invoiced,closed');
    ok('Server', 'each job lands in the right column', col('new') === 'new' && col('newOld') === 'new' && col('called') === 'called' && col('visit') === 'visit' && col('quoted') === 'visit' && col('won') === 'won' && col('planning') === 'planning' && col('progress') === 'progress' && col('completed') === 'completed' && col('invoiced') === 'invoiced' && col('paid') === 'closed',
      JSON.stringify(Object.fromEntries(Object.keys(C).map((k) => [k, col(k)]))));
    ok('Server', 'closed jobs older than the chosen period are left out (lost 60 days ago, period 30 days)', !col('lostOld'));
    ok('Server', '…and shown with a longer period (90 days)', (await P.pipelineBoard({ closedDays: 90 })).cards.some((c) => c.core === C.lostOld));
    const pr = b.cards.find((c) => c.core === C.progress);
    ok('Server', 'in-progress card carries plan %, SPI, finish and late tasks', pr.plan && pr.plan.pct > 0 && pr.plan.SPI !== null && pr.plan.finish && typeof pr.plan.late === 'number', JSON.stringify(pr.plan));
    ok('Server', 'cards say what the work is, not "Repair question"', b.cards.find((c) => c.core === C.new).title === 'Leaking gutter over the back door', b.cards.find((c) => c.core === C.new).title);

    // ---- browser ----
    const br = await chromium.launch();
    const ctx = await br.newContext({ viewport: { width: 1600, height: 950 } });
    const p = await ctx.newPage(); p.setDefaultTimeout(10000);
    const errors = []; errorsAll = errors;
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('dialog', (x) => { errors.push('dialog: ' + x.message()); x.dismiss(); });
    let r = await p.request.post(`${BASE}/.netlify/functions/admin`, { data: { action: 'pipelineBoard' }, headers: { 'X-MBS-Admin': '1' } });
    ok('Security', 'the board needs a login', r.status() === 401, r.status());
    await p.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
    await p.fill('[name=username]', 'sashi73'); await p.fill('[name=password]', 'sashi98'); await p.click('#loginForm button');
    await p.waitForSelector('#app:not([hidden])'); await p.waitForSelector('[data-dash]');
    ok('Toggle', 'dashboard opens on Summary with a "Pipeline board" switch', await p.isVisible('.kpis') && /Pipeline board/.test(await p.textContent('.dashmode')));
    await p.click('[data-dash=board]'); await p.waitForSelector('.pcard');
    const heads = await p.$$eval('.pcol .pcol-h b', (h) => h.map((x) => x.textContent));
    ok('Board', 'columns: New enquiry, Called, Site visit & quoted, Job won, Planning, Job in progress, Completed, Invoiced, Closed', heads.join('|') === 'New enquiry|Called|Site visit & quoted|Job won|Planning|Job in progress|Completed|Invoiced|Closed', heads.join('|'));
    const counts = await p.$$eval('.pcol', (c) => c.map((x) => x.getAttribute('data-col') + ':' + x.querySelector('.pcol-n').textContent));
    ok('Board', 'counts per column (2 new, 1 called, 2 visit/quoted, 1 won, 1 planning, 1 in progress, 1 completed, 1 invoiced, 1 closed)', counts.join(',') === 'new:2,called:1,visit:2,won:1,planning:1,progress:1,completed:1,invoiced:1,closed:1', counts.join(','));
    const inCol = (k, who) => p.evaluate(([k, w]) => !!document.querySelector(`.pcol[data-col=${k}]`).textContent.includes(w), [k, who]);
    ok('Board', 'cards sit in the right columns', await inCol('visit', 'Vera Visit') && await inCol('visit', 'Quinn Quote') && await inCol('progress', 'Pia Progress') && await inCol('closed', 'Paula Paid'));
    const txt = async (k) => p.textContent(`.pcard[data-core="${C[k]}"]`);
    ok('Card', 'card shows ref, customer, the work, suburb and value', /Quinn Quote/.test(await txt('quoted')) && /Colorbond fence/.test(await txt('quoted')) && /Box Hill/.test(await txt('quoted')) && /\$5,200/.test(await txt('quoted')), await txt('quoted'));
    ok('Card', 'warnings: not called for 4 days (red), quote follow-up after 10 days, no plan yet', /Not called yet: 4 days/.test(await txt('newOld')) && !!(await p.$(`.pcard[data-core="${C.newOld}"] .pf-red`)) && /Quote sent 10 days ago: follow up/.test(await txt('quoted')) && /No project plan yet/.test(await txt('won')));
    ok('Card', 'site visit booked: shown with the reminder', /Site visit booked/.test(await txt('visit')) && /Site visit: measure the deck/.test(await txt('visit')));
    ok('Card', 'in progress: progress bar, SPI with colour, finish date, high risk', !!(await p.$(`.pcard[data-core="${C.progress}"] .pbar`)) && /SPI \d\.\d\d/.test(await txt('progress')) && /Finish/.test(await txt('progress')) && /1 high risk/.test(await txt('progress')) && !!(await p.$(`.pcard[data-core="${C.progress}"] .pc-ev`)), await txt('progress'));
    ok('Card', 'completed but not invoiced for 3 days; invoiced and unpaid for 20 days; closed shows Paid', /Not invoiced: 3 days/.test(await txt('completed')) && /Unpaid: 20 days/.test(await txt('invoiced')) && /Paid ✓/.test(await txt('paid')));
    ok('Board', 'column totals: Site visit & quoted shows $5,200', /\$5,200/.test(await p.textContent('.pcol[data-col=visit] header')));
    ok('Board', 'summary line: open jobs and value', /10<\/b> open jobs/.test(await p.innerHTML('#pbSum')) || /10 open jobs/.test(await p.textContent('#pbSum')), await p.textContent('#pbSum'));
    await p.screenshot({ path: 'MBS_board.jpg', type: 'jpeg', quality: 80 });

    // search
    await p.fill('#pbQ', 'fence'); await sleep(100);
    ok('Search', 'search narrows the board (fence → Quinn only)', (await p.$$('.pcard')).length === 1 && /Quinn/.test(await p.textContent('#pboard')));
    await p.fill('#pbQ', ''); await sleep(100);
    // closed period
    await p.selectOption('#pbDays', '90'); await p.waitForFunction(() => document.querySelector('.pcol[data-col=closed] .pcol-n').textContent === '2');
    ok('Closed', 'closed period 90 days brings back the job lost 60 days ago (shown faded, "Lost")', /Larry Lost/.test(await p.textContent('.pcol[data-col=closed]')) && !!(await p.$('.pcard.lost')));
    // full screen
    await p.click('#pbFull');
    const fs1 = await p.evaluate(() => ({ full: document.body.classList.contains('board-full'), side: getComputedStyle(document.querySelector('.side')).display, right: Math.max(...[...document.querySelectorAll('.pcol')].map((c) => c.getBoundingClientRect().right)), w: innerWidth }));
    ok('Full screen', 'Full screen hides the menu and all nine columns fit across 1600 px', fs1.full && fs1.side === 'none' && fs1.right <= fs1.w + 1, JSON.stringify(fs1));
    await p.screenshot({ path: 'MBS_board_full.jpg', type: 'jpeg', quality: 80 });
    await p.keyboard.press('Escape');
    ok('Full screen', 'Esc leaves full screen', !(await p.evaluate(() => document.body.classList.contains('board-full'))));
    // click through
    await p.click(`.pcard[data-core="${C.progress}"] .pc-plink`); await p.waitForSelector('table.gt, #planBody');
    ok('Links', '"📅 Plan" on a card opens the project plan', /#plan\//.test(p.url()));
    await p.goto(`${BASE}/admin/#dashboard`); await p.waitForSelector('.pcard');
    ok('Toggle', 'the board choice is remembered', await p.isVisible('#pboard'));
    await p.click(`.pcard[data-core="${C.quoted}"]`); await p.waitForFunction(() => /#job\//.test(location.hash));
    ok('Links', 'clicking a card opens the job', new RegExp(C.quoted).test(p.url()));
    await p.goto(`${BASE}/admin/#dashboard`); await p.waitForSelector('[data-dash=summary]');
    await p.click('[data-dash=summary]'); await p.waitForSelector('.kpis');
    ok('Toggle', 'flip back to Summary', await p.isVisible('.kpis') && !(await p.$('#pboard')));
    await p.reload(); await p.waitForSelector('.kpis');
    ok('Toggle', 'Summary is remembered too', !(await p.$('#pboard')));
    // phone
    const ph = await ctx.newPage(); await ph.setViewportSize({ width: 390, height: 844 });
    ph.on('pageerror', (e) => errors.push('phone: ' + e.message));
    await ph.goto(`${BASE}/admin/#dashboard`, { waitUntil: 'domcontentloaded' }); await ph.waitForSelector('[data-dash=board]'); await ph.click('[data-dash=board]'); await ph.waitForSelector('.pcard');
    ok('Phone', 'on a phone the board scrolls sideways inside itself; the page does not', await ph.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await ph.screenshot({ path: 'MBS_board_phone.jpg', type: 'jpeg', quality: 80 });
    await ph.click('[data-dash=summary]'); await ph.close();
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close();
  } catch (e) { ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ')); }
  await cleanup();
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  if (pass !== results.length) console.log('\n--- server log ---\n' + log.slice(-2000));
})();
