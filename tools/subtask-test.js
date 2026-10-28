// End-to-end test of planner sub-tasks (v25b): real Blobs, local site, headless Chromium.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const SITE = path.resolve(process.argv[2]);
const PORT = 8902, BASE = `http://127.0.0.1:${PORT}`;
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => { results.push({ area, name, pass: !!pass, detail }); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-sub-test-blobs'); fs.rmSync(dir, { recursive: true, force: true });
  const blobs = new BlobsServer({ directory: dir, token: 'tok', port: 0 });
  const { port: bport } = await blobs.start();
  const ctxB64 = Buffer.from(JSON.stringify({ siteID: 'mbs', token: 'tok', edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, apiURL: `http://localhost:${bport}` })).toString('base64');
  process.env.NETLIFY_BLOBS_CONTEXT = ctxB64;
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NETLIFY_BLOBS_CONTEXT: ctxB64, ADMIN_USERNAME: 'sashi73', ADMIN_PASSWORD: 'sashi98', TELEGRAM_BOT_TOKEN: '', RESEND_API_KEY: '', LLM_API_KEY: '', LIMIT_ADMIN: '100000/1' };
  const srv = spawn('node', ['local-server.mjs'], { cwd: SITE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 40 && !/running/.test(log); i++) await sleep(150);
  const cleanup = async () => { try { srv.kill(); } catch {} try { await blobs.stop(); } catch {} };

  try {
    const J = await import(path.join(SITE, 'netlify/lib/jobs.mjs'));
    const kv = await import(path.join(SITE, 'netlify/lib/kv.mjs'));
    const P = await import(path.join(SITE, 'netlify/lib/plan.mjs'));
    const core = await J.nextCore('W');
    await J.create({ core, name: 'Priya Nair', phone: '0400 000 001', email: 'priya@example.com', suburb: 'Castle Hill', service: 'Bathroom', source: 'chat' });
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date());
    const stored = () => kv.get('plan:' + core);

    const br = await chromium.launch();
    const ctx = await br.newContext({ viewport: { width: 1500, height: 950 } });
    const p = await ctx.newPage(); p.setDefaultTimeout(15000);
    const errors = []; errorsAll = errors;
    p.on('pageerror', (e) => errors.push(e.message));
    const api = (action, data = {}) => p.request.post(`${BASE}/.netlify/functions/admin`, { data: { action, ...data }, headers: { 'X-MBS-Admin': '1' } });
    const S = () => p.evaluate(() => JSON.parse(JSON.stringify(window.MBS.planState.plan)));
    const saved = async () => { await p.waitForTimeout(150); await p.waitForFunction(() => document.querySelector('#planSave') && document.querySelector('#planSave').textContent === 'Saved ✓', null, { timeout: 8000 }); };
    const T = async (name) => (await S()).tasks.find((t) => t.name === name);

    await p.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
    await p.fill('[name=username]', 'sashi73'); await p.fill('[name=password]', 'sashi98'); await p.click('#loginForm button');
    await p.waitForSelector('#app:not([hidden])');
    await p.goto(`${BASE}/admin/#plan/${core}`); await p.waitForSelector('[data-tk=bathroom]');
    await p.fill('#tplStart', today); await p.click('[data-tk=bathroom]'); await p.waitForSelector('table.gt');
    await p.click('[data-cols=a]');

    // ---- template sub-tasks ----
    let strip = await T('Strip-out & rubbish removal'), tile = await T('Wall & floor tiling');
    ok('Template', 'bathroom template has sub-tasks: strip-out (3) and tiling (3)', strip.subs.length === 3 && tile.subs.length === 3 && tile.subs[2].name === 'Wall tiles');
    const subRows = await p.$$eval(`tr[data-ptid="${strip.id}"]`, (rs) => rs.map((r) => r.cells[0].textContent.trim()));
    ok('Grid', 'sub-tasks show under their task, numbered like 6.1, 6.2, 6.3', subRows.length === 3 && /^\d+\.1$/.test(subRows[0]) && /^\d+\.3$/.test(subRows[2]), subRows.join(','));
    const inside = async (tid) => p.evaluate((tid) => {
      const tr = document.querySelector(`tr[data-tid="${tid}"]`), pb = tr.querySelector('.gbar').getBoundingClientRect();
      return [...document.querySelectorAll(`tr[data-ptid="${tid}"]`)].every((r) => { const s = r.querySelector('.gsub').getBoundingClientRect(); return s.left >= pb.left - 1 && s.right <= pb.right + 1; })
        && [...document.querySelectorAll(`tr[data-ptid="${tid}"] [data-sk=start]`)].every((i) => i.value >= i.min && i.value <= i.max);
    }, tid);
    ok('Boundary', 'every sub-task date and Gantt bar is inside its task\'s bar', await inside(strip.id) && await inside(tile.id));
    ok('Cost', 'sub-tasks have no cost of their own ("–"); the plan budget is unchanged', (await p.$$eval(`tr[data-ptid="${strip.id}"] .subcost`, (c) => c.every((x) => x.textContent === '–'))) && /8,580\.00/.test(await p.textContent('table.gt tfoot')));
    await p.screenshot({ path: 'MBS_plan_subtasks.jpg', type: 'jpeg', quality: 80 });

    // ---- ticking sub-tasks drives the task % ----
    const sel = (tid, sid, k) => `tr[data-ptid="${tid}"][data-sid="${sid}"] [data-sk=${k}]`;
    await p.check(sel(strip.id, strip.subs[1].id, 'done')); await saved();
    strip = await T('Strip-out & rubbish removal');
    ok('Progress', 'ticking a 2-day sub-task of 4 sub-task days → task 50%, In progress', strip.pct === 50 && strip.status === 'doing', strip.pct + ' ' + strip.status);
    ok('Progress', 'the task\'s % box is locked (worked out from sub-tasks)', await p.isDisabled(`tr[data-tid="${strip.id}"] [data-k=pct]`));
    await p.selectOption(sel(strip.id, strip.subs[0].id, 'status'), 'review'); await saved();
    strip = await T('Strip-out & rubbish removal');
    ok('Progress', 'a sub-task In review / QA counts 67% (task now 67%, In review / QA)', strip.pct === 67 && strip.status === 'review', strip.pct + ' ' + strip.status);
    let st = await stored();
    ok('Server', 'the server works out the same % and status', st.tasks.find((t) => t.id === strip.id).pct === 67 && st.tasks.find((t) => t.id === strip.id).status === 'review');

    // ---- add a sub-task to a 1-day task, try to push it outside ----
    const grout = await T('Grout & silicone');
    await p.click(`tr[data-tid="${grout.id}"] [data-addsub]`); await p.waitForTimeout(100);
    await p.keyboard.type('Silicone the shower'); await saved();
    let g = await T('Grout & silicone');
    ok('Add', '"＋ sub-task" adds one under the task (inside its 1 day)', g.subs.length === 1 && g.subs[0].name === 'Silicone the shower' && g.subs[0].off === 0 && g.subs[0].dur === 1);
    const gs = g.subs[0].id;
    await p.fill(sel(grout.id, gs, 'owner'), 'Ali'); await saved();
    await p.fill(sel(grout.id, gs, 'dur'), '5'); await p.dispatchEvent(sel(grout.id, gs, 'dur'), 'change'); await saved();
    g = await T('Grout & silicone');
    ok('Boundary', 'asking for 5 days on a 1-day task keeps it at 1 day (with a message)', g.subs[0].dur === 1 && /Kept inside the task/.test(await p.textContent('#toast')));
    const far = P.addWork(g.ef, 10);
    await p.fill(sel(grout.id, gs, 'start'), far); await saved();
    g = await T('Grout & silicone');
    ok('Boundary', 'picking a start date after the task ends is pulled back inside', g.subs[0].off === 0 && /stay inside the task/.test(await p.textContent('#toast')));
    ok('Owner', 'a sub-task can have its own owner', g.subs[0].owner === 'Ali');

    // ---- the task gets shorter or moves: sub-tasks follow ----
    tile = await T('Wall & floor tiling');
    const es0 = tile.es;
    await p.fill(`tr[data-tid="${tile.id}"] [data-k=dur]`, '2'); await p.dispatchEvent(`tr[data-tid="${tile.id}"] [data-k=dur]`, 'change'); await saved();
    tile = await T('Wall & floor tiling');
    ok('Boundary', 'shortening the task to 2 days shortens its sub-tasks to fit (Wall tiles 2 → 1 day)', tile.subs.every((x) => x.off + x.dur <= 2) && tile.subs[2].dur === 1 && /shortened to fit/.test(await p.textContent('#toast')), JSON.stringify(tile.subs));
    const strip0 = await T('Strip-out & rubbish removal');
    await p.fill(`tr[data-tid="${strip0.id}"] [data-k=dur]`, '4'); await p.dispatchEvent(`tr[data-tid="${strip0.id}"] [data-k=dur]`, 'change'); await saved();
    tile = await T('Wall & floor tiling');
    ok('Boundary', 'when an earlier task gets longer, the task and its sub-tasks move later together', tile.es > es0 && await inside(tile.id));

    // ---- parent status moves all sub-tasks ----
    await p.selectOption(`tr[data-tid="${tile.id}"] [data-k=status]`, 'done'); await saved();
    tile = await T('Wall & floor tiling');
    ok('Status', 'setting the task to Done marks all its sub-tasks Done', tile.pct === 100 && tile.subs.every((x) => x.status === 'done'));

    // ---- collapse ----
    await p.click(`tr[data-tid="${tile.id}"] [data-tog]`);
    ok('Grid', 'the ▾ button hides a task\'s sub-tasks', (await p.$$(`tr[data-ptid="${tile.id}"]`)).length === 0);
    await p.click(`tr[data-tid="${tile.id}"] [data-tog]`);

    // ---- board checklist ----
    await p.click('#planTabs >> text=Board'); await p.waitForSelector('.kanban');
    strip = await T('Strip-out & rubbish removal');
    const card = `.kcard[data-tid="${strip.id}"]`;
    ok('Board', 'board cards show a sub-task checklist ("1 of 3 sub-tasks done")', /1 of 3 sub-tasks done/.test(await p.textContent(card)) && (await p.$$(`${card} [data-subtick]`)).length === 3);
    for (const x of strip.subs.filter((s) => s.status !== 'done')) { await p.check(`${card} [data-subtick="${x.id}"]`); await saved(); }
    strip = await T('Strip-out & rubbish removal');
    ok('Board', 'ticking the rest on the card completes the task and moves it to Done', strip.pct === 100 && strip.status === 'done' && (await p.$(`.kcol[data-col=done] ${card}`)));
    await p.screenshot({ path: 'MBS_plan_subtasks_board.jpg', type: 'jpeg', quality: 80 });

    // ---- server rules ----
    st = await stored();
    const bad = JSON.parse(JSON.stringify(st));
    const tt = bad.tasks.find((t) => t.name === 'Wall & floor tiling');
    tt.subs.push({ id: 'zz', name: 'Too long', off: 40, dur: 50, status: 'odd' });
    const mile = bad.tasks.find((t) => t.dur === 0); mile.subs = [{ id: 'm1', name: 'x', off: 0, dur: 1 }];
    let r = await api('planSave', { core, plan: bad, rev: st.rev });
    st = await stored();
    const zz = st.tasks.find((t) => t.name === 'Wall & floor tiling').subs.find((x) => x.id === 'zz');
    ok('Server', 'the server keeps sub-tasks inside the task even if a bad copy is sent (off 40, 50 days → last day, 1 day)', r.status() === 200 && zz.off === 1 && zz.dur === 1 && zz.status === 'todo', JSON.stringify(zz));
    ok('Server', 'milestones cannot have sub-tasks', st.tasks.find((t) => t.dur === 0).subs.length === 0);

    // ---- SQL ----
    r = await api('sqlData'); const sd = await r.json();
    const ps = sd.data.plan_subtasks || [];
    ok('SQL', 'SQL wizard has plan_subtasks with start/finish inside each task', ps.length >= 7 && ps.every((x) => { const t = sd.data.plan_tasks.find((y) => y.task === x.task); return t && x.start >= t.start && x.finish <= t.finish; }) && ps.some((x) => x.owner === 'Ali'), JSON.stringify(ps.slice(0, 2)));
    ok('SQL', 'sub-tasks have no cost columns', !('planned_cost' in (ps[0] || {})));

    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close();
  } catch (e) { ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ')); }
  await cleanup();
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  if (pass !== results.length) console.log('\n--- server log ---\n' + log.slice(-2000));
})();
