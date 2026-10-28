// End-to-end test of the new-plan chooser (v25d): job titles in the Projects list, scope of work (required),
// 22 job types with sub-types, blank plan, and "✨ Ask AI to build it" through the planai-background function
// (202 at once, then the console polls). Real Blobs, local site, a stand-in for DeepSeek, headless Chromium.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http'), path = require('path'), fs = require('fs'), os = require('os');
const SITE = path.resolve(process.argv[2]);
const PORT = 8902, BASE = `http://127.0.0.1:${PORT}`;
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => { results.push({ area, name, pass: !!pass, detail }); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-plan25d-blobs'); fs.rmSync(dir, { recursive: true, force: true });
  const blobs = new BlobsServer({ directory: dir, token: 'tok', port: 0 });
  const { port: bport } = await blobs.start();
  const ctxB64 = Buffer.from(JSON.stringify({ siteID: 'mbs', token: 'tok', edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, apiURL: `http://localhost:${bport}` })).toString('base64');
  process.env.NETLIFY_BLOBS_CONTEXT = ctxB64;

  // ---- stand-in for DeepSeek: takes 3 s (longer than a quick request), returns a plan ----
  const seen = []; let mode = 'good';
  const mock = http.createServer((req, res) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => {
    let body = {}; try { body = JSON.parse(Buffer.concat(c).toString()); } catch {}
    const sys = body.messages?.[0]?.content || ''; let u = {}; try { u = JSON.parse(body.messages?.[1]?.content || '{}'); } catch {}
    seen.push({ sys, u, raw: Buffer.concat(c).toString(), max: body.max_tokens });
    let content;
    if (/WATERFALL project plan/.test(sys)) {
      content = mode === 'junk' ? JSON.stringify({ tasks: [{ n: 'Only one' }] }) : JSON.stringify({
        name: 'Bathroom exhaust fan replacement', objective: 'Replace the noisy exhaust fan and vent it outside.',
        in_scope: ['New quiet fan in the same position', 'Duct to the eave', 'Ceiling patch and paint'], out_of_scope: 'Other electrical work.', deliverables: 'Working fan venting outside; electrical compliance certificate; photos.',
        acceptance: 'Fan clears steam within 10 minutes; no noise; ceiling finish matches.', assumptions: 'Ceiling space is accessible.',
        tips: ['Check the fan size fits the existing ceiling hole', 'A licensed electrician must do the wiring', 'Strata may need notice before roof or eave work'],
        tasks: [{ n: 'Site inspection & measure', d: 1, after: [], q: 1, u: 'h', r: 90 }, { n: 'Quote accepted', d: 0, after: [1] },
          { n: 'Buy fan & ducting', d: 1, after: [2], q: 1, u: 'lot', r: 260 },
          { n: 'Remove old fan & install new', d: 2, after: [3], q: 6, u: 'h', r: 110, s: [['Remove old fan', 0, 1], ['Duct to eave', 1, 1], ['Wire & test', 1, 5]] },
          { n: 'Patch & paint ceiling', d: 1, after: [4], q: 3, u: 'h', r: 70 }, { n: 'Handover & invoice', d: 0, after: [5] }],
        risks: [['Asbestos in the old ceiling', 'House built before 1990', 2, 5, 'Avoid', 'Test before cutting'], ['Fan out of stock', 'Popular model', 2, 2, 'Bogus', 'Order early'], ['No safe route for the duct', 'Roof framing in the way', 3, 3, 'Mitigate', 'Check the roof space at inspection']] });
      return setTimeout(() => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }], usage: { total_tokens: 900 } })), 3000);
    }
    content = JSON.stringify({ ok: true });
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }], usage: { total_tokens: 50 } }));
  }); });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NETLIFY_BLOBS_CONTEXT: ctxB64, ADMIN_USERNAME: 'sashi73', ADMIN_PASSWORD: 'sashi98',
    LLM_API_KEY: 'test', LLM_BASE_URL: `http://127.0.0.1:${mock.address().port}`, AI_PLAN_MAX_TOKENS: '1600', AI_TIMEOUT_SECONDS: '2', TELEGRAM_BOT_TOKEN: '', RESEND_API_KEY: '' };
  const srv = spawn('node', ['local-server.mjs'], { cwd: SITE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 40 && !/running/.test(log); i++) await sleep(150);
  const cleanup = async () => { try { srv.kill(); } catch {} try { mock.close(); } catch {} try { await blobs.stop(); } catch {} };

  try {
    const J = await import(path.join(SITE, 'netlify/lib/jobs.mjs'));
    const kv = await import(path.join(SITE, 'netlify/lib/kv.mjs'));
    const P = await import(path.join(SITE, 'netlify/lib/plan.mjs'));
    const fan = await J.nextCore('E');
    await J.create({ core: fan, name: 'Sashi Test', phone: '0400 111 222', email: 'sashi.t@example.com', suburb: 'Box Hill', service: 'General question', source: 'chat',
      summary: 'Customer asked a question about repairing his bathroom exhaust fan. It is noisy and has stopped pulling steam out.' });
    const deck = await J.nextCore('C');
    await J.create({ core: deck, name: 'Ana Ruiz', phone: '0400 333 444', email: 'ana@example.com', suburb: 'Kellyville', service: 'Composite deck', source: 'web',
      summary: 'Wants a 6 x 4 m composite deck off the family room.' });
    const blank = await J.nextCore('M');
    await J.create({ core: blank, name: 'Lee Wong', phone: '0400 555 666', email: 'lee@x.com', suburb: 'Rouse Hill', service: '', source: 'phone', summary: '' });

    // ---- server: what the job is ----
    const fanJob = await kv.get('job:' + fan);
    ok('Title', 'a "Customer asked a question about…" enquiry becomes a short job title', P.jobTitle(fanJob) === 'Repairing his bathroom exhaust fan', P.jobTitle(fanJob));
    ok('Title', 'the kind of job is worked out (Repair)', P.jobKind(fanJob) === 'Repair', P.jobKind(fanJob));
    ok('Title', 'a real service name is kept as the title', P.jobTitle(await kv.get('job:' + deck)) === 'Composite deck');
    ok('Scope', 'scope comes from the service and the enquiry summary (generic "General question" left out)', /exhaust fan/.test(P.jobScope(fanJob)) && !/General question/.test(P.jobScope(fanJob)));

    const br = await chromium.launch();
    const ctx = await br.newContext({ viewport: { width: 1400, height: 950 } });
    const p = await ctx.newPage(); p.setDefaultTimeout(10000);
    const errors = []; errorsAll = errors;
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('dialog', (x) => { errors.push('dialog: ' + x.message()); x.dismiss(); });
    const bg = await p.request.post(`${BASE}/.netlify/functions/planai-background`, { data: { id: 'abcdefabcdef12', core: fan, describe: 'x'.repeat(20) }, headers: { 'X-MBS-Admin': '1' } });
    await sleep(400);
    ok('Security', 'the AI plan function does nothing without a login (no AI call, no draft saved)', !(await kv.get('aiplan:abcdefabcdef12')) && !seen.length, bg.status());

    await p.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
    await p.fill('[name=username]', 'sashi73'); await p.fill('[name=password]', 'sashi98'); await p.click('#loginForm button');
    await p.waitForSelector('#app:not([hidden])');

    // ---- Projects list labels ----
    await p.goto(`${BASE}/admin/#projects`); await p.waitForSelector('#newPlanJob');
    const opts = await p.$$eval('#newPlanJob option', (o) => o.map((x) => x.textContent));
    ok('List', 'the "Plan a job…" list says what each job is: "Sashi Test: Repairing his bathroom exhaust fan"', opts.some((t) => /Sashi Test: Repairing his bathroom exhaust fan/.test(t) && /Box Hill/.test(t)), opts.join(' / '));
    ok('List', 'no raw "Customer asked a question" text in the list', !opts.some((t) => /Customer asked/i.test(t)));
    ok('List', 'kind added when the title does not say it (Composite deck (New work))', opts.some((t) => /Ana Ruiz: Composite deck \(New work\)/.test(t)), opts.join(' / '));

    // ---- chooser: scope + job types ----
    await p.selectOption('#newPlanJob', fan); await p.click('#newPlanGo'); await p.waitForSelector('#tplScope');
    ok('Chooser', 'heading names the job: "Sashi Test: Repairing his bathroom exhaust fan"', /Sashi Test: Repairing his bathroom exhaust fan/.test(await p.textContent('#view h2')));
    ok('Chooser', 'scope of work box is filled from the enquiry', /exhaust fan/.test(await p.inputValue('#tplScope')));
    const groups = await p.$$eval('#tplType optgroup', (g) => g.map((x) => x.label + ':' + x.children.length));
    ok('Types', 'job types grouped by type: at least 20 groups (Bathroom, Kitchen, Decking, Pergola…) with sub-types', groups.length >= 20 && groups.some((g) => /^Decking:[3-9]/.test(g)) && groups.some((g) => /^Pergola/.test(g)), groups.join(', '));
    ok('Types', 'the job type is suggested from the enquiry (Bathroom > Exhaust fan)', (await p.inputValue('#tplType')) === 'exhaust-fan');
    ok('Types', 'a preview shows tasks, days, budget and risks', /tasks/.test(await p.textContent('#tplPrev')) && /working day/.test(await p.textContent('#tplPrev')) && /Isolate power/.test(await p.textContent('#tplPrev')));
    await p.selectOption('#tplType', 'deck-composite');
    ok('Types', 'changing the type changes the preview (composite deck includes council approval)', /Composite boards/.test(await p.textContent('#tplPrev')) && /Council/.test(await p.textContent('#tplPrev')));
    await p.fill('#tplScope', 'fan'); await p.click('#tplCreate'); await sleep(300);
    ok('Chooser', 'scope of work is required (too short = not created)', !(await kv.get('plan:' + fan)) && (await p.isVisible('#tplScope')));
    // every type builds a valid plan
    const all = await p.$$eval('#tplType option[value]:not([value=""])', (o) => o.map((x) => x.value));
    const bad = await p.evaluate((ids) => ids.filter((id) => { const s = document.getElementById('tplType'); s.value = id; s.onchange(); const t = document.getElementById('tplPrev').textContent; return !/\d+ tasks/.test(t); }), all);
    ok('Types', `all ${all.length} sub-types build a plan preview`, all.length >= 50 && bad.length === 0, bad.join(','));

    // ---- AI build ----
    await p.fill('#tplScope', 'Bathroom exhaust fan is noisy and has stopped pulling steam out. Replace it and duct it outside; patch the ceiling.');
    await p.click('[data-mode=ai]');
    ok('AI', '"Use this plan" is off until the AI has made a draft', await p.isDisabled('#tplCreate') && /Use this plan/.test(await p.textContent('#tplCreate')));
    await p.fill('#aiDescribe', 'Second-floor unit. Replace exhaust fan, duct through the eave. Before Christmas.');
    const t0 = Date.now();
    await p.click('#aiGo');
    await p.waitForSelector('#aiOut .ask-think');
    ok('AI', 'shows it is working while the AI builds the plan', true);
    await p.waitForSelector('#aiOut .tplprev', { timeout: 20000 });
    ok('AI', 'draft arrives through the background function and polling (took ' + Math.round((Date.now() - t0) / 1000) + ' s)', /Remove old fan & install new/.test(await p.textContent('#aiOut')));
    ok('AI', 'planning tips are shown', /licensed electrician/.test(await p.textContent('#aiOut .aitips')));
    ok('AI', 'the AI works out the scope too: in/out of scope, deliverables, acceptance, assumptions shown', /Duct to the eave/.test(await p.textContent('#aiOut .aiscope')) && /Other electrical work/.test(await p.textContent('#aiOut .aiscope')) && /compliance certificate/.test(await p.textContent('#aiOut .aiscope')) && /clears steam/.test(await p.textContent('#aiOut .aiscope')));
    ok('AI', 'and the risks: cause, P×I score, response and action shown', (await p.$$('#aiOut .airisks tbody tr')).length === 3 && /House built before 1990/.test(await p.textContent('#aiOut .airisks')) && /10/.test(await p.textContent('#aiOut .airisks .score')));
    const req = seen.find((x) => /WATERFALL/.test(x.sys));
    ok('AI', 'AI is asked for tasks, scope and risks, capped at AI_PLAN_MAX_TOKENS (1600 here, default 3000)', req && req.max === 1600 && /eave/.test(req.u.description) && /SCOPE/.test(req.sys) && /RISKS/.test(req.sys));
    ok('Privacy', 'no customer name, phone or email sent to the AI', req && !/Sashi Test|0400 111|example\.com/.test(req.raw));
    ok('AI', 'draft is kept as aiplan:<id> (status done)', (await kv.keys('aiplan:')).length === 1);
    await p.click('#tplCreate'); await p.waitForSelector('table.gt');
    let st = await kv.get('plan:' + fan);
    const inst = st && st.tasks.find((t) => /install new/.test(t.name));
    ok('AI', 'plan created from the AI draft: 6 tasks, dependencies kept', st && st.tasks.length === 6 && st.tasks[3].pred[0] === st.tasks[2].id);
    ok('AI', 'sub-tasks kept inside their task (5-day sub-task cut to fit the 2-day task)', inst && inst.subs.length === 3 && inst.subs.every((x) => x.off + x.dur <= inst.dur));
    ok('Scope', 'the scope of work is carried into the plan charter (In scope)', st && /stopped pulling steam/.test(st.charter.inScope) && /Planned work \(AI\)/.test(st.charter.inScope));
    ok('Scope', 'AI scope saved in the charter: in scope lines, out of scope, deliverables, acceptance, assumptions; tips as planning notes', st && /- Duct to the eave/.test(st.charter.inScope) && st.charter.outScope === 'Other electrical work.' && /compliance certificate/.test(st.charter.deliverables) && /clears steam/.test(st.charter.acceptance) && /accessible/.test(st.charter.assumptions) && /licensed electrician/.test(st.charter.notes), st && JSON.stringify(st.charter).slice(0, 300));
    ok('AI', 'AI risks saved with cause, P, I and action (bad response fixed to Mitigate); resources left blank', st && st.risks.length === 3 && st.risks[0].cause === 'House built before 1990' && st.risks[0].p === 2 && st.risks[0].i === 5 && st.risks[1].response === 'Mitigate' && st.tasks.every((t) => !t.res.length));
    await p.click('[data-tab=scope]').catch(() => p.goto(`${BASE}/admin/#plan/${fan}/scope`)); await p.waitForSelector('.jobreq');
    ok('Scope', 'Scope tab shows the customer\'s request and the planning notes', /exhaust fan/.test(await p.textContent('.jobreq')) && /licensed electrician/.test(await p.inputValue('[data-c=notes]')));

    // ---- AI error path + blank plan ----
    mode = 'junk';
    await p.goto(`${BASE}/admin/#plan/${blank}`); await p.waitForSelector('#tplScope');
    ok('Chooser', 'job with no details: scope box empty, nothing suggested', (await p.inputValue('#tplScope')) === '' && (await p.inputValue('#tplType')) === '');
    await p.click('[data-mode=ai]'); await p.click('#aiGo'); await sleep(300);
    ok('AI', 'AI will not start without a description', !(await p.$('#aiOut .ask-think')));
    await p.fill('#tplScope', 'Fix three sticking doors and re-hang the laundry door.');
    await p.click('#aiGo'); await p.waitForSelector('#aiOut .bad', { timeout: 20000 });
    ok('AI', 'an unusable AI answer shows a clear message, no plan made', /did not return a usable plan/.test(await p.textContent('#aiOut')) && !(await kv.get('plan:' + blank)));
    await p.click('[data-mode=blank]'); await p.click('#tplCreate'); await p.waitForSelector('table.gt');
    st = await kv.get('plan:' + blank);
    ok('Blank', 'blank plan: two rows, the scope saved in the charter', st && st.tasks.length === 2 && /sticking doors/.test(st.charter.inScope));

    // ---- job type plan ----
    await p.goto(`${BASE}/admin/#plan/${deck}`); await p.waitForSelector('#tplType');
    ok('Types', 'composite deck enquiry suggests Decking > Composite deck', (await p.inputValue('#tplType')) === 'deck-composite');
    await p.click('#tplCreate'); await p.waitForSelector('table.gt');
    st = await kv.get('plan:' + deck);
    ok('Types', 'plan from a job type: inspection, quote, council check, materials, trade steps, QA, handover, invoice', st && /Site inspection/.test(st.tasks[0].name) && st.tasks.some((t) => /Council/.test(t.name)) && /Invoice/.test(st.tasks[st.tasks.length - 1].name) && st.tasks.length === 11, st && st.tasks.map((t) => t.name).join(' | '));
    ok('Types', 'tasks run one after another and the budget is filled in', st && st.tasks.slice(1).every((t, i) => t.pred[0] === st.tasks[i].id) && st.charter.budget > 5000);
    await p.screenshot({ path: 'MBS_plan25d.jpg', type: 'jpeg', quality: 80 });

    // ---- phone ----
    const ph = await ctx.newPage(); await ph.setViewportSize({ width: 390, height: 844 });
    ph.on('pageerror', (e) => errors.push('phone: ' + e.message));
    const lone = await J.nextCore('P');
    await J.create({ core: lone, name: 'Jo Bloggs', phone: '1', email: '', suburb: 'Castle Hill', service: 'Paint two bedrooms', source: 'chat' });
    await ph.goto(`${BASE}/admin/#plan/${lone}`, { waitUntil: 'domcontentloaded' }); await ph.waitForSelector('#tplType');
    ok('Phone', 'the new-plan page fits on a phone', await ph.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await ph.screenshot({ path: 'MBS_plan25d_phone.jpg', type: 'jpeg', quality: 80, fullPage: true });
    await ph.close();
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close();
  } catch (e) { ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ')); }
  await cleanup();
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  if (pass !== results.length) console.log('\n--- server log ---\n' + log.slice(-2000));
})();
