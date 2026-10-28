// End-to-end test of the project planner (v24): real Blobs, local site server, headless Chromium.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const SITE = path.resolve(process.argv[2]);
const PORT = 8897, BASE = `http://127.0.0.1:${PORT}`;
const results = []; let errorsAll = [];
const ok0 = (a, n, p, d) => { console.log((p ? 'pass ' : 'FAIL ') + n + (p ? '' : ' :: ' + d)); };
const ok = (area, name, pass, detail = '') => { results.push({ area, name, pass: !!pass, detail }); ok0(area, name, pass, detail); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-plan-test-blobs'); fs.rmSync(dir, { recursive: true, force: true });
  const blobs = new BlobsServer({ directory: dir, token: 'tok', port: 0 });
  const { port: bport } = await blobs.start();
  const ctxB64 = Buffer.from(JSON.stringify({ siteID: 'mbs', token: 'tok', edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, apiURL: `http://localhost:${bport}` })).toString('base64');
  process.env.NETLIFY_BLOBS_CONTEXT = ctxB64;
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NETLIFY_BLOBS_CONTEXT: ctxB64, ADMIN_USERNAME: 'sashi73', ADMIN_PASSWORD: 'sashi98', TELEGRAM_BOT_TOKEN: '', RESEND_API_KEY: '', LLM_API_KEY: '' };
  const srv = spawn('node', ['local-server.mjs'], { cwd: SITE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 40 && !/running/.test(log); i++) await sleep(150);
  const cleanup = async () => { try { srv.kill(); } catch {} try { await blobs.stop(); } catch {} };

  try {
    const J = await import(path.join(SITE, 'netlify/lib/jobs.mjs'));
    const kv = await import(path.join(SITE, 'netlify/lib/kv.mjs'));
    const P = await import(path.join(SITE, 'netlify/lib/plan.mjs'));
    const ACC = await import(path.join(SITE, 'netlify/lib/accounts.mjs'));
    const core = await J.nextCore('W');
    await J.create({ core, name: 'Priya Nair', phone: '0400 000 001', email: 'priya@example.com', suburb: 'Castle Hill', service: 'Bathroom waterproofing', source: 'chat' });
    await J.setStage(core, 'quoted', 'test', { amount: 9800 });
    await ACC.saveExpense({ supplier: 'Beaumont Tiles', desc: 'Floor tiles', category: 'Materials', inc: 858, core }, 'test');
    const core2 = await J.nextCore('F');
    await J.create({ core: core2, name: 'Tom Lee', phone: '0400 000 002', email: 'tom@example.com', suburb: 'Kellyville', service: 'Exterior repaint', source: 'chat' });
    const today = ACC.today();
    const start = P.prevWork(P.prevWork(P.prevWork(P.prevWork(P.prevWork(today)))));   // 5 working days ago, so some work is due
    const stored = async () => kv.get('plan:' + core);

    const br = await chromium.launch();
    const ctx = await br.newContext({ viewport: { width: 1500, height: 950 } });
    const p = await ctx.newPage(); p.setDefaultTimeout(10000);
    const errors = []; errorsAll = errors;
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('dialog', (x) => { errors.push('dialog: ' + x.message()); x.dismiss(); });
    const api = (action, data = {}) => p.request.post(`${BASE}/.netlify/functions/admin`, { data: { action, ...data }, headers: { 'X-MBS-Admin': '1' } });
    const S = () => p.evaluate(() => JSON.parse(JSON.stringify(window.MBS.planState.plan)));
    const tid = (name) => p.evaluate((n) => window.MBS.planState.plan.tasks.find((t) => t.name === n).id, name);
    const saved = async () => { await p.waitForTimeout(150); await p.waitForFunction(() => document.querySelector('#planSave') && document.querySelector('#planSave').textContent === 'Saved ✓', null, { timeout: 8000 }); };
    const setCell = async (name, k, v) => { const id = await tid(name); const sel = `tr[data-tid="${id}"] [data-k=${k}]`; await p.fill(sel, String(v)); if (k !== 'snet') await p.dispatchEvent(sel, 'change'); await saved(); };

    let r = await api('planList');
    ok('Security', 'project plans need a login', r.status() === 401, r.status());

    await p.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
    await p.fill('[name=username]', 'sashi73'); await p.fill('[name=password]', 'sashi98'); await p.click('#loginForm button');
    await p.waitForSelector('#app:not([hidden])');
    ok('Menu', 'left column has "Projects" under CRM', /CRM\s*Dashboard\s*Jobs\s*New job\s*Reminders\s*Projects/.test((await p.textContent('.side-nav')).replace(/[^\w &]+/g, ' ').replace(/\s+/g, ' ')));

    // ---- start from the job page ----
    await p.goto(`${BASE}/admin/#job/${core}`); await p.waitForSelector('#jobPlan a.btn');
    ok('Job page', 'job page has a "Create a project plan" button', /Create a project plan/.test(await p.textContent('#jobPlan')));
    await p.click('#jobPlan a.btn'); await p.waitForSelector('#tplType');
    ok('Templates', 'job types offered in groups (20+), incl. Bathroom > Waterproofing & retiling', (await p.$$('#tplType optgroup')).length >= 20 && /Waterproofing & retiling/.test(await p.textContent('#tplType optgroup[label=Bathroom]')));
    await p.fill('#tplStart', start);
    await p.selectOption('#tplType', 'bathroom'); await p.click('#tplCreate'); await p.waitForSelector('table.gt');
    ok('Schedule', 'opens on the Dates columns so the Gantt chart is in view', (await p.evaluate(() => document.querySelector('th.gcol').getBoundingClientRect().left)) < 1150, await p.evaluate(() => [...document.querySelectorAll('table.gt thead th')].map((h) => h.textContent.slice(0, 6) + ':' + Math.round(h.getBoundingClientRect().width)).join(' ')));
    await p.screenshot({ path: 'MBS_plan_gantt.jpg', type: 'jpeg', quality: 80 });
    await p.click('[data-cols=c]');
    ok('Cost', '"$ Costs" shows qty, unit, unit cost and actual columns', await p.isVisible('tr[data-tid] [data-k=rate]') && !(await p.isVisible('tr[data-tid] [data-k=pred]')));
    await p.click('[data-cols=a]');
    let st = await stored();
    ok('Templates', 'plan created and saved with 16 tasks (no phases), 2 milestones and 3 risks', st && st.tasks.length === 16 && st.tasks.filter((t) => t.dur === 0).length === 2 && st.risks.length === 3 && !(await p.$('tr.gphase')) && !(await p.$('#addPhase')), st && st.tasks.length);
    ok('Templates', 'no names filled in: resources, project manager and risk owners are blank', st.tasks.every((t) => !t.res.length && !t.resource) && st.charter.manager === '' && st.risks.every((r) => r.owner === '') && !/Sashi/.test(await p.textContent('#view')));
    ok('Templates', 'every task starts as "To do" at 0%', st.tasks.every((t) => t.status === 'todo' && t.pct === 0));
    const names = await p.$$eval('tr[data-tid] [data-k=name]', (els) => els.map((e) => e.value));
    ok('Templates', 'tasks include "Site inspection & measure" and "Buy tiles"', names.includes('Site inspection & measure') && names.includes('Buy tiles'));
    ok('Templates', 'charter (scope) is filled in with the customer and objective', st.charter.customer === 'Priya Nair' && /AS 3740/.test(st.charter.objective));

    // ---- schedule matches the server maths ----
    const check = async () => { const ui = await S(); const srvPlan = P.schedule(JSON.parse(JSON.stringify(await stored()))); const uiPlan = await p.evaluate(() => window.MBS.planState.plan.tasks.map((t) => [t.id, t.es, t.ef]));
      return uiPlan.every(([id, es, ef]) => { const s = srvPlan.tasks.find((x) => x.id === id); return s && s.es === es && s.ef === ef; }) && ui.tasks.length === srvPlan.tasks.length; };
    ok('Schedule', 'dates on screen match the server schedule (working days, predecessors)', await check());
    const first = await p.evaluate(() => window.MBS.planState.plan.tasks[0]);
    ok('Schedule', 'first task starts on the project start date', first.es === P.nextWork(start), first.es + ' vs ' + start);
    const noWeekend = await p.evaluate(() => window.MBS.planState.plan.tasks.every((t) => [t.es, t.ef].every((s) => { const d = new Date(s + 'T00:00:00Z').getUTCDay(); return d !== 0 && d !== 6; })));
    ok('Schedule', 'no task starts or finishes on a weekend', noWeekend);
    const tiles = await p.evaluate(() => window.MBS.planState.plan.tasks.find((t) => t.name === 'Buy tiles'));
    const qa = await p.evaluate(() => window.MBS.planState.plan.tasks.find((t) => t.name === 'Quote accepted'));
    ok('Schedule', '"Buy tiles" waits for the "Quote accepted" milestone', tiles.pred.includes(qa.id) && tiles.es >= qa.ef);
    const rollS = P.rollup(JSON.parse(JSON.stringify(await stored())), today);
    ok('Cost', 'unit costing: Buy tiles = 12 m² × $65 = $780', /\$780\.00/.test(await p.textContent(`tr[data-tid="${tiles.id}"]`)));
    ok('Cost', 'total budget (BAC) shown matches the server: ' + rollS.BAC, (await p.textContent('table.gt tfoot')).includes(rollS.BAC.toLocaleString('en-AU', { minimumFractionDigits: 2 })), rollS.BAC);
    ok('Gantt', 'Gantt has a bar per task, milestones as diamonds and a today line', (await p.$$('.gbar')).length === 14 && (await p.$$('.gmile')).length === 2 && (await p.$$('.gsum')).length === 0 && (await p.$$('.gtoday')).length > 0, (await p.$$('.gbar')).length + '/' + (await p.$$('.gmile')).length);
    ok('Gantt', 'tasks past their finish date are marked late (red)', (await p.$$('tr.tlate')).length >= 1 && (await p.$$('.gbar.late')).length >= 1);

    // ---- tick box, % complete, actual cost ----
    const siteId = await tid('Site inspection & measure');
    await p.check(`tr[data-tid="${siteId}"] [data-k=done]`); await saved();
    st = await stored();
    ok('Progress', 'ticking the box marks the task 100% done and saves it', st.tasks.find((t) => t.id === siteId).pct === 100 && (await p.$(`tr.tdone[data-tid="${siteId}"]`)));
    await setCell('Site inspection & measure', 'actual', 170);
    await setCell('Buy tiles', 'pct', 50);
    await setCell('Buy tiles', 'actual', '$858');
    st = await stored();
    const bt = st.tasks.find((t) => t.name === 'Buy tiles');
    ok('Progress', '% complete and actual cost save ($858 typed with a $ sign)', bt.pct === 50 && bt.actual === 858, JSON.stringify(bt));

    // ---- changing a duration moves everything after it ----
    const fin0 = P.rollup(JSON.parse(JSON.stringify(st)), today).finish;
    await setCell('Wall & floor tiling', 'dur', 5);
    const fin1 = P.rollup(JSON.parse(JSON.stringify(await stored())), today).finish;
    ok('Schedule', 'tiling 3 → 5 days pushes the finish date 2 working days later', P.workBetween(fin0, fin1) - 1 === 2, fin0 + ' → ' + fin1);
    ok('Schedule', 'still matches the server after the change', await check());

    // ---- predecessors by row number ----
    const rowOf = async (n) => p.evaluate((n) => { const tr = [...document.querySelectorAll('tr[data-tid]')].find((r) => r.querySelector('[data-k=name]').value === n); return +tr.querySelector('[data-pos]').value; }, n);
    const bookRow = await rowOf('Book plumber & tiler'), stripRow = await rowOf('Strip-out & rubbish removal');
    await setCell('Strip-out & rubbish removal', 'pred', String(bookRow));
    st = await stored();
    ok('Schedule', '"After #" takes row numbers (strip-out now only waits for row ' + bookRow + ')', JSON.stringify(st.tasks.find((t) => t.name === 'Strip-out & rubbish removal').pred) === JSON.stringify([await tid('Book plumber & tiler')]));
    ok('Schedule', 'still matches the server after changing predecessors', await check());

    // ---- start no earlier than ----
    const later = P.addWork(P.nextWork(today), 25);
    await setCell('Final inspection & defects', 'snet', later);
    st = await stored();
    ok('Schedule', 'picking a later start date holds the task back (start no earlier than)', st.tasks.find((t) => t.name === 'Final inspection & defects').snet === later && (await S()).tasks.find((t) => t.name === 'Final inspection & defects').es >= later);

    // ---- add a task with unit costing ----
    await p.click('#addTask'); await p.waitForTimeout(100);
    const newId = await p.evaluate(() => { const t = window.MBS.planState.plan.tasks.find((x) => x.name === 'New task'); return t.id; });
    const sel = (k) => `tr[data-tid="${newId}"] [data-k=${k}]`;
    await p.fill(sel('name'), 'Hire skip bin');
    // people: type a name + Enter, more than one, first is lead, click to change lead
    const radd = `tr[data-tid="${newId}"] [data-radd]`;
    await p.click(radd);
    ok('Resources', 'a floating tip explains you can add more than one and who is the lead', await p.isVisible('#resTip') && /more than one/.test(await p.textContent('#resTip')) && /lead/.test(await p.textContent('#resTip')));
    await p.keyboard.type('Skip hire'); await p.keyboard.press('Enter'); await p.keyboard.type('Ali'); await p.keyboard.press('Enter'); await p.keyboard.type('Ben,'); await saved(); await p.evaluate(() => { const r = document.querySelector('[data-radd]:focus'); if (r) r.scrollIntoView({ block: 'center' }); }); await p.waitForTimeout(100); await p.screenshot({ path: 'MBS_plan_resources.jpg', type: 'jpeg', quality: 80 });
    let sk = (await stored()).tasks.find((t) => t.id === newId);
    ok('Resources', 'three people added (Enter or comma); the first one is the lead ★', JSON.stringify(sk.res) === '["Skip hire","Ali","Ben"]' && sk.lead === 'Skip hire' && /★ Skip hire/.test(await p.textContent(`tr[data-tid="${newId}"] .rbox`)), JSON.stringify(sk));
    await p.click(`tr[data-tid="${newId}"] [data-rlead="Ali"]`); await saved();
    sk = (await stored()).tasks.find((t) => t.id === newId);
    ok('Resources', 'clicking a name makes them the lead (shown first in reports)', sk.lead === 'Ali' && sk.resource === 'Ali, Skip hire, Ben' && /★ Ali/.test(await p.textContent(`tr[data-tid="${newId}"] .rbox`)), JSON.stringify(sk));
    ok('Resources', 'the Gantt bar label shows the lead and how many others', /★ Ali \+2/.test(await p.textContent(`tr[data-gtid="${newId}"] .glab`)), await p.textContent(`tr[data-gtid="${newId}"] .glab`));
    await p.click(`tr[data-tid="${newId}"] [data-rx="Ben"]`); await saved();
    ok('Resources', 'a person can be removed', JSON.stringify((await stored()).tasks.find((t) => t.id === newId).res) === '["Skip hire","Ali"]');
    await p.fill(sel('qty'), '1'); await p.dispatchEvent(sel('qty'), 'change');
    await p.fill(sel('unit'), 'bin'); await p.fill(sel('rate'), '420'); await p.dispatchEvent(sel('rate'), 'change'); await saved();
    st = await stored(); const skip = st.tasks.find((t) => t.id === newId);
    ok('Edit', 'new task added with resource and unit cost (1 bin × $420)', skip && skip.name === 'Hire skip bin' && skip.qty === 1 && skip.rate === 420 && /\$420\.00/.test(await p.textContent(`tr[data-tid="${newId}"]`)), JSON.stringify(skip));
    await p.click('#addMile'); await saved();
    st = await stored();
    ok('Edit', 'milestone added (0 days)', st.tasks.some((t) => t.name === 'New milestone' && t.dur === 0));
    const mileId = st.tasks.find((t) => t.name === 'New milestone').id;
    await p.click(`tr[data-tid="${mileId}"] [data-del]`); await p.click('#okBtn'); await saved();
    ok('Edit', 'a task can be deleted', !(await stored()).tasks.some((t) => t.id === mileId));
    const before = (await S()).tasks.findIndex((t) => t.id === newId);
    const pos = async (id, v) => { const sel = `tr[data-tid="${id}"] [data-pos]`; await p.fill(sel, String(v)); await p.press(sel, 'Enter'); await saved(); };
    await pos(newId, before); // before is 0-based, so this is one place up
    ok('Edit', 'typing a number in # moves the task there (one up)', (await stored()).tasks.findIndex((t) => t.id === newId) === before - 1);
    await pos(newId, 1);
    st = await stored();
    ok('Edit', 'typing 1 moves the task to the first position; numbers and "After #" follow', st.tasks[0].id === newId && (await p.inputValue(`tr[data-tid="${newId}"] [data-pos]`)) === '1' && (await p.inputValue(`tr[data-tid="${st.tasks[1].id}"] [data-pos]`)) === '2');
    const third = st.tasks[5].id;
    await pos(third, 3);
    st = await stored();
    ok('Edit', 'typing 3 puts the task third, after the first two', st.tasks[2].id === third && st.tasks[0].id === newId);
    await pos(third, 'x'); 
    ok('Edit', 'a non-number is ignored (stays where it was)', (await stored()).tasks[2].id === third && (await p.inputValue(`tr[data-tid="${third}"] [data-pos]`)) === '3');
    await pos(third, 999);
    st = await stored();
    ok('Edit', 'a number past the end moves it to the last place', st.tasks[st.tasks.length - 1].id === third);
    ok('Edit', 'no ↑ ↓ arrow buttons any more', !(await p.$('[data-move]')) && !(await p.$('[data-smove]')));
    // drag the ⠿ handle: last task onto the top
    const dragTo = async (fromSel, toSel, after) => {
      const g = await p.$(fromSel + ' [data-grip]'); const gb = await g.boundingBox(); const tb = await (await p.$(toSel)).boundingBox();
      await p.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2); await p.mouse.down();
      const y = after ? tb.y + tb.height - 3 : tb.y + 3;
      await p.mouse.move(gb.x + 2, (gb.y + y) / 2, { steps: 4 }); await p.mouse.move(gb.x + 2, y, { steps: 4 });
      const shown = await p.$('tr.drop-before, tr.drop-after');
      await p.mouse.up(); await saved(); return !!shown;
    };
    const L = st.tasks.length, aboveId = st.tasks[L - 4].id;
    await p.$eval(`tr[data-tid="${aboveId}"]`, (e) => e.scrollIntoView({ block: 'center' }));
    const line = await dragTo(`tr[data-tid="${third}"]`, `tr[data-tid="${aboveId}"]`, false);
    st = await stored();
    ok('Edit', 'dragging ⠿ moves a task (last one dropped above the 4th from last, with a drop line shown)', line && st.tasks[L - 4].id === third && st.tasks[L - 3].id === aboveId, line + ' ' + st.tasks.slice(-5).map((t) => t.name).join(' | '));

    // ---- reminder ----
    await p.click(`tr[data-tid="${await tid('Hire skip bin')}"] [data-rem]`); await p.waitForSelector('#modal [data-w=start]');
    await p.click('#modal [data-w=start]'); await p.waitForSelector('#modal', { state: 'hidden' });
    const rems = await J.reminders();
    const rem = rems.find((x) => x.core === core && /Hire skip bin/.test(x.text));
    const skipStart = (await S()).tasks.find((t) => t.id === newId).es;
    ok('Reminders', 'reminder set for the task\'s start day at 7am (Telegram)', rem && new Date(rem.at).toLocaleString('en-AU', { timeZone: 'Australia/Sydney', hour: 'numeric', hour12: false }).replace(/\D/g, '') === '07' && new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date(rem.at)) === skipStart, rem ? new Date(rem.at).toISOString() + ' vs ' + skipStart : JSON.stringify(rems));
    await p.click(`tr[data-tid="${siteId}"] [data-rem]`); await p.fill('#remWhen', 'tomorrow 8am'); await p.click('#remGo'); await p.waitForSelector('#modal', { state: 'hidden' });
    ok('Reminders', 'free-text reminder ("tomorrow 8am") works too', (await J.reminders()).filter((x) => x.core === core).length === 2);

    // ---- board ----
    await p.click('#planTabs >> text=Board'); await p.waitForSelector('.kanban');
    const col = async (k) => p.$$eval(`.kcol[data-col=${k}] .kcard`, (cs) => cs.map((c) => c.textContent));
    ok('Board', 'board has To do / In progress / In review / QA / Done', JSON.stringify(await p.$$eval('.kcol', (c) => c.map((x) => x.getAttribute('data-col')))) === '["todo","doing","review","done"]' && /In review \/ QA/.test(await p.textContent('.kanban')));
    ok('Board', 'cards are in the right columns (ticked = Done, 50% = In progress)', (await col('done')).some((t) => /Site inspection/.test(t)) && (await col('doing')).some((t) => /Buy tiles/.test(t)) && (await col('todo')).length >= 13);
    ok('Board', 'cards show the people with the lead ★', (await col('todo')).some((t) => /★ Ali/.test(t) && /Skip hire/.test(t)));
    const orderId = await tid('Order membrane & plumbing parts');
    const gpct = async (id) => { await p.click('#planTabs >> text=Schedule'); await p.waitForSelector('table.gt'); const r = await p.evaluate((id) => [document.querySelector(`tr[data-gtid="${id}"] .gpct`).textContent, document.querySelector(`tr[data-gtid="${id}"] .gfill`).style.width], id); await p.click('#planTabs >> text=Board'); await p.waitForSelector('.kanban'); return r.join(' '); };
    await p.dragAndDrop(`.kcard[data-tid="${orderId}"]`, '.kcol[data-col=doing]'); await saved();
    ok('Board → Gantt', 'In progress: 33% on the Gantt bar', (await stored()).tasks.find((t) => t.id === orderId).pct === 33 && (await gpct(orderId)) === '33% 33%', await gpct(orderId));
    await p.dragAndDrop(`.kcard[data-tid="${orderId}"]`, '.kcol[data-col=review]'); await saved();
    ok('Board → Gantt', 'In review / QA: 67% on the Gantt bar', (await stored()).tasks.find((t) => t.id === orderId).status === 'review' && (await gpct(orderId)) === '67% 67%', await gpct(orderId));
    await p.screenshot({ path: 'MBS_plan_board.jpg', type: 'jpeg', quality: 80 });
    await p.click(`.kcard[data-tid="${orderId}"] [data-step="1"]`); await saved();
    ok('Board → Gantt', 'Done (→ button): 100% and ticked in the schedule', (await stored()).tasks.find((t) => t.id === orderId).pct === 100 && (await gpct(orderId)) === '100% 100%');
    const bookId = await tid('Book plumber & tiler');
    await p.check(`.kcard[data-tid="${bookId}"] [data-tick]`); await saved();
    ok('Board', 'tick box on a card completes it', (await stored()).tasks.find((t) => t.id === bookId).pct === 100 && (await col('done')).some((t) => /Book plumber/.test(t)));
    await p.click('#planTabs >> text=Schedule'); await p.waitForSelector('table.gt');
    await p.selectOption(`tr[data-tid="${bookId}"] [data-k=status]`, 'review'); await saved();
    await p.click('[data-cols=s]'); await p.screenshot({ path: 'MBS_plan_gantt2.jpg', type: 'jpeg', quality: 80 }); await p.click('[data-cols=a]');
    ok('Schedule → Board', 'changing Status in the schedule moves the card (In review / QA, 67%)', (await stored()).tasks.find((t) => t.id === bookId).pct === 67 && (await p.inputValue(`tr[data-tid="${bookId}"] [data-k=pct]`)) === '67');
    await p.click('#planTabs >> text=Board'); await p.waitForSelector('.kanban');
    ok('Schedule → Board', 'card is now in the In review / QA column', (await col('review')).some((t) => /Book plumber/.test(t)));
    { const sd0 = await (await api('sqlData')).json();
      ok('SQL', 'SQL wizard plan_tasks has resource (lead first), lead and status', sd0.data.plan_tasks.some((x) => x.lead === 'Ali' && x.resource === 'Ali, Skip hire') && sd0.data.plan_tasks.some((x) => x.status === 'In review / QA') && !('phase' in sd0.data.plan_tasks[0])); }

    // ---- scope ----
    await p.click('#planTabs >> text=Scope'); await p.waitForSelector('[data-c=outScope]');
    await p.fill('[data-c=outScope]', 'Electrical work; painting outside the bathroom'); await p.fill('[data-c=budget]', '9800'); await saved();
    st = await stored();
    ok('Scope', 'out-of-scope and approved budget saved in the charter', /Electrical work/.test(st.charter.outScope) && st.charter.budget === 9800);

    // ---- risks ----
    await p.click('#planTabs >> text=Risks'); await p.waitForSelector('#addRisk');
    ok('Risks', 'risk register shows the template risks with scores', (await p.$$('tr[data-rid]')).length === 3 && /12/.test(await p.textContent('table.rt')));
    await p.click('#addRisk'); await p.keyboard.type('Asbestos found in old wall sheeting');
    let rows = await p.$$('tr[data-rid]'); const last = rows[rows.length - 1];
    await (await last.$('[data-r=p]')).selectOption('4'); await saved();
    rows = await p.$$('tr[data-rid]'); await (await rows[rows.length - 1].$('[data-r=i]')).selectOption('5'); await saved();
    st = await stored(); const asb = st.risks.find((x) => /Asbestos/.test(x.title));
    ok('Risks', 'new risk added: P4 × I5 = 20 (red)', asb && asb.p === 4 && asb.i === 5 && (await p.$$eval('.score.sc-red', (s) => s.map((x) => x.textContent))).includes('20'), JSON.stringify(asb));
    ok('Risks', 'heat map shows open risks in the right cell', (await p.$$eval('.heat-g span', (s) => s.map((x) => x.textContent)))[(5 - 4) * 5 + (5 - 1)] === '1');
    rows = await p.$$('tr[data-rid]'); await (await rows[0].$('[data-r=status]')).selectOption('Closed'); await saved();
    ok('Risks', 'a risk can be closed when reviewed', (await stored()).risks[0].status === 'Closed');
    await p.screenshot({ path: 'MBS_plan_risks.jpg', type: 'jpeg', quality: 80 });

    // ---- issues ----
    await p.click('#planTabs >> text=Issues'); await p.waitForSelector('#addIssue');
    await p.click('#addIssue'); await p.keyboard.type('Water damage under the shower base');
    await p.selectOption('tr[data-iid] [data-x=priority]', 'High'); await saved();
    st = await stored();
    ok('Issues', 'issue logged with priority High and today\'s date', st.issues.length === 1 && /Water damage/.test(st.issues[0].title) && st.issues[0].priority === 'High' && st.issues[0].raised === today);

    // ---- overview, earned value, baseline ----
    await p.click('#planTabs >> text=Overview'); await p.waitForSelector('#planBody >> text=Time & cost (earned value)');
    const ov = await p.textContent('#planBody');
    const R = P.rollup(JSON.parse(JSON.stringify(await stored())), today);
    ok('Earned value', `BAC ${R.BAC}, PV ${R.PV}, EV ${R.EV}, AC ${R.AC} shown as the server works them out`, [R.BAC, R.PV, R.EV, R.AC].every((v) => ov.includes(v.toLocaleString('en-AU', { minimumFractionDigits: 2 }))), ov.slice(0, 300));
    ok('Earned value', `SPI ${R.SPI} and CPI ${R.CPI} shown`, ov.includes(String(R.SPI)) && ov.includes(String(R.CPI)));
    ok('Overview', 'shows Accounts expenses for the job ($780 ex GST)', /780\.00/.test(ov));
    ok('Overview', 'lists late tasks, top risks (Asbestos first) and open issues', /Late tasks/.test(ov) && /Top risks\s*Asbestos/.test(ov) && /Water damage/.test(ov));
    ok('Overview', 'shows the reminders for this job', /Hire skip bin/.test(ov));
    const kp = await p.textContent('.pkpis');
    ok('Status', 'scope, time, cost and risk cards at the top', /Scope/.test(kp) && /Time/.test(kp) && /Cost/.test(kp) && /Risks & issues/.test(kp) && /1 issue(?!s)/.test(kp));
    await p.screenshot({ path: 'MBS_plan_overview.jpg', type: 'jpeg', quality: 80 });
    await p.click('#planBase'); await p.click('#okBtn'); await saved();
    st = await stored();
    ok('Baseline', 'baseline saves the finish date, budget and every task\'s dates', st.baseline && st.baseline.finish === R.finish && st.baseline.BAC === R.BAC && Object.keys(st.baseline.tasks).length === st.tasks.length);
    await p.click('#planTabs >> text=Schedule'); await p.waitForSelector('table.gt');
    await setCell('Final inspection & defects', 'dur', 3);
    ok('Baseline', 'slipping a task shows "base <date>" against the new finish', /base /.test(await p.textContent('table.gt')));
    ok('Baseline', 'status card says how many days behind the baseline', /2 days behind baseline/.test(await p.textContent('.pkpis')), await p.textContent('.pkpis'));

    // ---- two people editing ----
    r = await api('planSave', { core, plan: await stored(), rev: 1 });
    ok('Safety', 'saving an out-of-date copy is refused (409) instead of overwriting', r.status() === 409);
    const rev = (await stored()).rev;
    r = await api('planSave', { core, plan: { ...(await stored()), name: 'Edited elsewhere' }, rev });
    await setCell('Final inspection & defects', 'dur', 2);
    ok('Safety', 'after someone else saves, the page reloads their version and warns you', (await S()).name === 'Edited elsewhere' && /changed this plan/.test(await p.textContent('#toast')));
    r = await api('planSave', { core, plan: { name: '<img src=x onerror=alert(1)>', tasks: [{ id: 't1', name: 'x', dur: 9999, pct: 500 }] }, rev: (await stored()).rev });
    const bad = await stored();
    ok('Safety', 'saved values are cleaned (duration max 365, % max 100)', bad.tasks[0].dur === 365 && bad.tasks[0].pct === 100);
    await p.goto(`${BASE}/admin/#projects`); await p.waitForSelector('table'); await p.waitForTimeout(300);
    ok('Safety', 'HTML in names is shown as text, not run', errors.every((e) => !/alert/.test(e)) && /<img src=x/.test(await p.textContent('#view')));

    // ---- projects list ----
    ok('Projects', 'projects list shows the plan with progress, time and cost status', /Priya Nair/.test(await p.textContent('#view')) && (await p.$$('.rag')).length >= 2 && (await p.$$('.pbar')).length >= 1);
    ok('Projects', 'jobs without a plan can be picked to start one', /Tom Lee/.test(await p.textContent('#newPlanJob')) && !/Priya Nair/.test(await p.textContent('#newPlanJob')));
    await p.selectOption('#newPlanJob', core2); await p.click('#newPlanGo'); await p.waitForSelector('#tplType');
    await p.selectOption('#tplType', 'repaint'); await p.click('#tplCreate'); await p.waitForSelector('table.gt');
    ok('Projects', 'second plan (exterior repaint, buy paint) created from the list', (await p.$$eval('tr[data-tid] [data-k=name]', (e) => e.map((x) => x.value))).includes('Buy paint'));

    // ---- job page card ----
    await p.goto(`${BASE}/admin/#job/${core2}`); await p.waitForSelector('#jobPlan .pbar');
    ok('Job page', 'job page shows the plan\'s progress and an Open plan button', /Open plan/.test(await p.textContent('#jobPlan')) && /complete/.test(await p.textContent('#jobPlan')));

    // ---- SQL wizard and data explorer ----
    r = await api('sqlData'); const sd = await r.json();
    ok('SQL', 'SQL wizard has plan_tasks, plan_risks and plan_issues tables', sd.data && Array.isArray(sd.data.plan_tasks) && sd.data.plan_tasks.length >= 13 && Array.isArray(sd.data.plan_risks) && Array.isArray(sd.data.plan_issues), Object.keys(sd.data || {}).join(',') + ' ' + (sd.data && sd.data.plan_tasks && sd.data.plan_tasks.length));
    await p.goto(`${BASE}/admin/#sql`); await p.waitForSelector('#sqlTabs', { timeout: 15000 }); await p.click('[data-tab=templates]'); await p.waitForSelector('.tpl');
    ok('SQL', 'Projects templates offered (late tasks, planned vs actual, risks, issues)', /Projects/.test(await p.textContent('#view')) && /Late tasks/.test(await p.textContent('#view')) && /Planned vs actual cost/.test(await p.textContent('#view')));
    await p.click('.tpl >> text=Planned vs actual cost by job'); await p.waitForSelector('#chCanvas');
    const sq = await p.evaluate(() => window.MBS.sqlState.rows);
    ok('SQL', '"Planned vs actual cost by job" runs as a bar chart (2 jobs)', sq.length === 2 && sq.some((x) => x.planned === 8180), JSON.stringify(sq));
    r = await api('dataList', { store: 'mbs-jobs' }); const dk = await r.json().catch(() => ({}));
    ok('Data explorer', 'plans appear in the data explorer as "project plan"', /project plan/.test(JSON.stringify(dk)), r.status());

    // ---- phone ----
    const m = await ctx.newPage(); await m.setViewportSize({ width: 390, height: 844 });
    m.on('pageerror', (e) => errors.push('phone: ' + e.message));
    await m.goto(`${BASE}/admin/#plan/${core2}/schedule`, { waitUntil: 'domcontentloaded' }); await m.waitForSelector('table.gt', { timeout: 15000 });
    ok('Phone', 'schedule works on a phone (grid scrolls inside its box, page does not)', await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await m.goto(`${BASE}/admin/#plan/${core2}/board`); await m.waitForSelector('.kanban');
    ok('Phone', 'board stacks into one column on a phone', await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await m.screenshot({ path: 'MBS_plan_phone.jpg', type: 'jpeg', quality: 80 });
    await m.close();
    // ---- deleting plans ----
    await p.goto(`${BASE}/admin/#plan/${core2}/overview`); await p.waitForSelector('#planDel');
    await p.click('#planDel'); await p.waitForSelector('#okBtn'); await p.click('#okBtn');
    await p.waitForFunction(() => location.hash === '#projects');
    ok('Delete', '"Delete plan" (after confirming) removes the plan and goes back to Projects', !(await kv.get('plan:' + core2)) && (await J.find(core2)) !== null);
    await p.waitForSelector(`[data-pdel="${core}"]`);
    await p.click(`[data-pdel="${core}"]`); await p.waitForSelector('#okBtn'); await p.click('#modal [data-close]');
    ok('Delete', 'Cancel keeps the plan', !!(await kv.get('plan:' + core)));
    await p.click(`[data-pdel="${core}"]`); await p.waitForSelector('#okBtn'); await p.click('#okBtn'); await p.waitForTimeout(600);
    ok('Delete', 'plans can also be deleted from the Projects list (job, quotes and invoices stay)', !(await kv.get('plan:' + core)) && (await J.find(core)) !== null && /No plans yet/.test(await p.textContent('#view')));
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close();
  } catch (e) { ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ')); }
  await cleanup();
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  if (pass !== results.length) console.log('\n--- server log ---\n' + log.slice(-2000));
})();
