// v82: 🔁 Change control: a change request raised by hand, its impact assessed by AI (stand-in), what goes ahead edited,
// approved and signed by the PM (then added to the plan and registers), rejected and deferred ones, a change control meeting
// set up on Comms, the change request and change register as Word / PDF, and the tab just before Project Intelligence.
// node cr-test.js <site> [folder with node_modules/mammoth]
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const SITE = path.resolve(process.argv[2]);
const XL = path.resolve(process.argv[3] || path.join(__dirname, 'xl'));
const PORT = 8979, BASE = `http://127.0.0.1:${PORT}`;
const http = require('http');
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => results.push({ area, name, pass: !!pass, detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const csvParse = (s) => { const rows = []; let row = [], cur = '', q = false; for (let i = 0; i < s.length; i++) { const c = s[i]; if (q) { if (c === '"' && s[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; } else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; } else cur += c; } if (cur || row.length) { row.push(cur); rows.push(row); } return rows; };

(async () => {
  let ExcelJS = null; try { ExcelJS = require(require.resolve('exceljs', { paths: [XL, SITE] })); } catch {}
  const seen = [];
  const mock = http.createServer((req, res) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => {
    const b = JSON.parse(Buffer.concat(c).toString() || '{}'), sys = b.messages[0].content, u = JSON.parse(b.messages[1].content); seen.push({ sys, u, raw: b.messages[1].content });
    let out = { answer: 'OK' };
    if (/proposed CHANGE REQUEST/.test(sys)) {
      const el = u.tasks.find((t) => /electrical/i.test(t.task)), tile = u.tasks.find((t) => /splashback/i.test(t.task));
      out = { outcome: 'Adding an island bench with power adds about 3 working days and $4,200.', summary: ['Island bench with two power points'], decisions: ['Approve the island bench', 'Agree the extra cost with the customer'], actions: [{ action: 'Update the joinery order', owner: 'PM', due: '' }],
        impact: { scope: { level: 'Medium', text: 'Island bench added.' }, time: { level: 'Medium', text: 'Electrical rough-in #' + el.n + ' is on the critical path: +2 days.' }, cost: { level: 'Medium', text: 'About $4,200.' }, quality: { level: 'Low', text: 'Level check.' }, risk: { level: 'Low', text: 'Lead time on the stone.' }, issues: { level: 'None', text: '' }, stakeholders: { level: 'Low', text: 'Joiner.' } },
        task_changes: [{ n: el.n, days: el.days + 2, extra_cost: 600, why: 'Two more circuits for the island' }], new_tasks: [{ name: 'Build and install the island bench', days: 1, after: [tile.n], cost: 3600, why: 'The change' }],
        scope_changes: [{ type: 'Add', text: 'Island bench with two power points', why: 'Customer request' }], risks: [{ title: 'Island stone lead time', cause: 'Extra slab', p: 2, i: 3, response: 'Mitigate', action: 'Order with the main benchtop', owner: 'PM', critical: false }],
        issues: [], stakeholders: [{ name: 'Oakwood Joinery', role: 'Joiner', raci: 'R' }], quality: ['Island level within 2 mm'], follow_ups: [] };
    }
    setTimeout(() => { res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(out) }, finish_reason: 'stop' }], usage: { total_tokens: 1500 } })); }, 400);
  }); });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-cr-blobs'); fs.rmSync(dir, { recursive: true, force: true });
  const blobs = new BlobsServer({ directory: dir, token: 'tok', port: 0 });
  const { port: bport } = await blobs.start();
  const ctxB64 = Buffer.from(JSON.stringify({ siteID: 'mbs', token: 'tok', edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, apiURL: `http://localhost:${bport}` })).toString('base64');
  process.env.NETLIFY_BLOBS_CONTEXT = ctxB64;
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NETLIFY_BLOBS_CONTEXT: ctxB64, ADMIN_USERNAME: 'sashi73', ADMIN_PASSWORD: 'sashi98', LLM_API_KEY: 'test', LLM_BASE_URL: `http://127.0.0.1:${mock.address().port}`, TELEGRAM_BOT_TOKEN: '', RESEND_API_KEY: '' };
  const srv = spawn('node', ['local-server.mjs'], { cwd: SITE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 40 && !/running/.test(log); i++) await sleep(150);
  let br = null;
  const tmp = path.join(os.tmpdir(), 'mbs-cr-files'); fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp);
  try {
    const J = await import(path.join(SITE, 'netlify/lib/jobs.mjs')), kv = await import(path.join(SITE, 'netlify/lib/kv.mjs')), P = await import(path.join(SITE, 'netlify/lib/plan.mjs'));
    const XL = path.resolve(process.argv[3] || path.join(__dirname, 'xl')); const mammoth = require(require.resolve('mammoth', { paths: [XL, SITE] }));
    const core = await J.nextCore('G');
    await J.create({ core, name: 'Carla Charter', phone: '0400 101 202', email: 'carla@example.com', suburb: 'Kellyville', service: 'Kitchen renovation', source: 'phone', summary: 'Full kitchen renovation with stone benchtops and a tiled splashback. Call Carla Charter on 0400 101 202.' });
    br = await chromium.launch();
    const ctx = await br.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const p = await ctx.newPage(); p.setDefaultTimeout(20000);
    const errors = []; errorsAll = errors; p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
    await p.fill('[name=username]', 'sashi73'); await p.fill('[name=password]', 'sashi98'); await p.click('#loginForm button'); await p.waitForSelector('#app:not([hidden])');
    await p.goto(`${BASE}/admin/#plan/${core}`); await p.waitForSelector('#tplType'); await p.selectOption('#tplType', 'kitchen-reno'); await p.click('#tplCreate'); await p.waitForSelector('table.gt'); await sleep(1200);
    const pl = await P.get(core); pl.charter.manager = 'Priya Shah'; pl.stakeholders = [{ id: 's1', name: 'Carla Charter', role: 'Customer', raci: 'A', email: 'carla@example.com' }, { id: 's2', name: 'Priya Shah', role: 'Project manager', raci: 'R', email: 'priya@example.com' }, { id: 's3', name: 'Strata Co', role: 'Strata', raci: 'I', email: 'strata@example.com' }];
    await P.save(core, pl, pl.rev, 'test'); await p.goto(`${BASE}/admin/#projects`); await sleep(300);
    await p.goto(`${BASE}/admin/#plan/${core}/change`); await p.waitForSelector('#crAdd');
    const tabs = await p.$$eval('#planTabs .tab', (t) => t.map((x) => x.textContent.trim()));
    ok('Tab', '🔁 Change control is just before 🧠 Project Intelligence', tabs.indexOf('🔁 Change control') >= 0 && tabs.indexOf('🧠 Project Intelligence') === tabs.indexOf('🔁 Change control') + 1, JSON.stringify(tabs));
    ok('Tab', 'it explains the rule (nothing goes into the plan until approved and signed) and the 5 steps', /Nothing goes into the plan or the registers until it is approved and signed/.test(await p.textContent('#planBody')) && (await p.$$('.cr-flow li')).length === 5 && !!(await p.$('.empty')));
    const before = await P.get(core), el0 = before.tasks.find((t) => /electrical/i.test(t.name));
    // raise by hand, with AI
    await p.click('#crAdd'); await p.waitForSelector('#crForm');
    await p.fill('#crForm [name=title]', 'Add an island bench'); await p.fill('#crForm [name=desc]', 'Customer Carla Charter (0400 101 202) wants an island bench with two power points.'); await p.fill('#crForm [name=reason]', 'Customer request'); await p.selectOption('#crForm [name=priority]', 'High');
    await p.click('#crForm [type=submit]'); await p.waitForSelector('#crCard .im-tbl', { timeout: 40000 }); await sleep(400);
    const ask = seen.find((x) => /proposed CHANGE REQUEST/.test(x.sys));
    ok('Assess', 'the AI assesses the change against the plan, with the customer\'s name and phone hidden', ask && /island bench/.test(ask.u.change_request.description) && !/Carla|0400 101 202/.test(ask.raw) && ask.u.tasks.length > 5, ask ? ask.u.change_request.description : '');
    let c = await p.evaluate(() => window.MBS.planState.plan.changes[0]);
    ok('Raised', 'CR-001 is raised (by hand, High), Proposed, with the impact and the changes; the plan is unchanged', c.num === 1 && c.source === 'manual' && c.priority === 'High' && c.status === 'Proposed' && c.items && c.items.new_tasks.length === 1 && (await p.evaluate(() => window.MBS.planState.plan.tasks.length)) === before.tasks.length);
    const prev = await p.textContent('#crCard [data-imprev]');
    ok('Preview', 'it shows the effect: finish later, budget up by $4,200', /\(\+\d+ working days?\)/.test(prev) && /\+\$4,200/.test(prev), prev);
    await p.click('#crCard [data-cra=review]'); await sleep(300);
    ok('Review', '"Start the review": Under review', (await p.evaluate(() => window.MBS.planState.plan.changes[0].status)) === 'Under review');
    await p.uncheck('#crCard [data-im="r:0"]'); await sleep(300);
    // change control meeting
    await p.click('#crCard [data-cra=meet]'); await p.waitForSelector('#crMGo'); await p.fill('#crMDate', '2026-12-01'); await p.click('#crMGo'); await p.waitForSelector('#cmTitle');
    const mt = await p.inputValue('#cmTitle'), ag = await p.inputValue('#cmAgenda');
    ok('Meeting', 'a change control meeting is set up on 📞 Comms: title, date, agenda with CR-001 and its impact, decisions and sign-off', /^Change control meeting: CR-001/.test(mt) && (await p.inputValue('#cmDate')) === '2026-12-01' && /CR-001: Add an island bench \(\+\d+ days?/.test(ag) && /Decisions and sign-off/.test(ag), mt + ' | ' + ag);
    const att = await p.evaluate(() => window.MBS.planState.comms.d.attendees);
    ok('Meeting', 'the accountable and responsible stakeholders are invited (not the informed ones); CR-001 is marked "CCB meeting"', JSON.stringify(att) === '["s1","s2"]' && (await p.evaluate(() => window.MBS.planState.plan.changes[0].status)) === 'CCB meeting', JSON.stringify(att));
    // approve and sign
    await p.goto(`${BASE}/admin/#plan/${core}/change`); await p.waitForSelector('#crAdd'); if (!(await p.$('#crCard'))) await p.click('tr[data-crid]'); await p.waitForSelector('#crCard');
    ok('Picks', 'what you untick stays unticked (the risk will not go ahead)', !(await p.$eval('#crCard [data-im="r:0"]', (x) => x.checked)) && await p.$eval('#crCard [data-im="n:0"]', (x) => x.checked));
    await p.click('#crCard [data-cra=Approved]'); await p.waitForSelector('#crSignF');
    ok('Sign', 'the sign-off form: name (the PM), role, typed signature, and "I approve CR-001: the ticked changes will be added now"', (await p.inputValue('#crSignF [name=by]')) === 'Priya Shah' && /Project director/.test(await p.textContent('#crSignF [name=role]')) && /I approve CR-001/.test(await p.textContent('#crSignF')) && /4 ticked changes|ticked change/.test(await p.textContent('#crSignF')));
    await p.selectOption('#crSignF [name=role]', 'Project director'); await p.fill('#crSignF [name=sig]', 'Priya Shah'); await p.fill('#crSignF [name=note]', 'Customer to sign the variation'); await p.check('#crSignF [name=go]'); await p.click('#crSignF [type=submit]'); await sleep(1600);
    const sv = await P.get(core); c = sv.changes[0];
    const el1 = sv.tasks.find((t) => t.id === el0.id);
    ok('Implemented', 'CR-001 is Implemented: the tasks, scope, quality and stakeholder are added, tagged (CR-001)', c.status === 'Implemented' && el1.dur === el0.dur + 2 && /\(CR-001\)/.test(el1.notes) && sv.tasks.some((t) => /island bench/i.test(t.name)) && /Island bench with two power points \(CR-001\)/.test(sv.charter.inScope) && /Island level within 2 mm/.test(sv.charter.acceptance) && sv.stakeholders.some((x) => x.name === 'Oakwood Joinery'));
    ok('Implemented', 'the unticked risk is not added', !sv.risks.some((r) => /Island stone/.test(r.title)));
    ok('Decision', 'the decision is recorded: by Priya Shah, Project director, signed, with the note and the history', c.decision.by === 'Priya Shah' && c.decision.role === 'Project director' && c.decision.sig === 'Priya Shah' && /variation/.test(c.decision.note) && c.log.length >= 4 && /Added to the plan and registers/.test(c.log[c.log.length - 1].what));
    ok('Locked', 'once decided, nothing can be changed (no approve buttons, ticks locked)', !(await p.$('#crCard [data-cra=Approved]')) && await p.$eval('#crCard [data-im="n:0"]', (x) => x.disabled) && /Implemented/.test(await p.textContent('.cr-tbl')));
    ok('Locked', 'the decided request shows the effect recorded when it was approved (not counted twice) and no "(listed)" notes', /Effect when approved:.*\(\+\$4,200/.test(await p.textContent('#crCard [data-imprev]')) && !/\(listed\)/.test(await p.textContent('#crCard')), await p.textContent('#crCard [data-imprev]'));
    await p.evaluate(() => window.scrollTo(0, 0)); await (await p.$('#planBody')).screenshot({ path: path.join(os.tmpdir(), 'change-control.png') });
    // a second one: reject, a third: defer (no AI)
    for (const [t, act] of [['Change the tiles to marble', 'Rejected'], ['Paint the ceiling too', 'Deferred']]) {
      await p.click('#crAdd'); await p.waitForSelector('#crForm'); await p.fill('#crForm [name=title]', t); await p.fill('#crForm [name=desc]', t + ' please'); await p.uncheck('#crForm [name=ai]'); await p.click('#crForm [type=submit]'); await p.waitForSelector('#crCard');
      await p.fill('#crCard [data-crf=estDays]', '2'); await p.fill('#crCard [data-crf=estCost]', '1500'); await sleep(200);
      await p.click(`#crCard [data-cra=${act}]`); await p.waitForSelector('#crSignF'); await p.click('#crSignF [type=submit]'); await sleep(200);
      ok(act, act + ' needs a reason', !!(await p.$('#crSignF')));
      await p.fill('#crSignF [name=note]', 'Over budget'); await p.click('#crSignF [type=submit]'); await sleep(800);
    }
    const sv2 = await P.get(core);
    ok('Rejected', 'rejected and deferred requests are recorded and change nothing in the plan', sv2.changes.length === 3 && sv2.changes[1].status === 'Rejected' && sv2.changes[2].status === 'Deferred' && sv2.changes[1].estCost === 1500 && sv2.tasks.length === sv.tasks.length && !/marble/i.test(JSON.stringify(sv2.charter)));
    // documents
    await p.click(`tr[data-crid="${c.id}"]`); await p.waitForSelector(`#crCard`); await sleep(200);
    if (!/CR-001/.test(await p.textContent('#crCard h2'))) { await p.click(`tr[data-crid="${c.id}"]`); await sleep(200); }
    await p.click('#crCard [data-crdoc]'); await p.waitForSelector('#crDocx');
    const [d1] = await Promise.all([p.waitForEvent('download'), p.click('#crDocx')]); const f1 = path.join(tmp, d1.suggestedFilename()); await d1.saveAs(f1);
    const w1 = (await mammoth.extractRawText({ path: f1 })).value;
    ok('Document', 'the change request (Word): number, the change, justification, effect on finish and budget, impact, the changes (goes ahead yes / no), decision, signature and history', /CHANGE REQUEST CR-001/.test(w1) && /Add an island bench/.test(w1) && /Effect on the plan/.test(w1) && /Impact assessment/.test(w1) && /Island stone lead time/.test(w1) && /\bNo\b/.test(w1) && /Priya Shah, Project director/.test(w1) && /typed signature/.test(w1) && /History/.test(w1), w1.slice(0, 400));
    await p.click('#crReg'); await p.waitForSelector('#crPdf');
    const [d2] = await Promise.all([p.waitForEvent('download'), p.click('#crPdf')]); const f2 = path.join(tmp, d2.suggestedFilename()); await d2.saveAs(f2);
    ok('Document', 'the change register as a PDF', fs.readFileSync(f2).slice(0, 4).toString() === '%PDF' && fs.statSync(f2).size > 3000 && /Change-register/.test(d2.suggestedFilename()));
    await p.click('#crReg'); await p.waitForSelector('#crDocx');
    const [d3] = await Promise.all([p.waitForEvent('download'), p.click('#crDocx')]); const f3 = path.join(tmp, d3.suggestedFilename()); await d3.saveAs(f3);
    const w3 = (await mammoth.extractRawText({ path: f3 })).value;
    ok('Document', 'the change register lists all 3 with status and decision (and CR-001 keeps its +$4,200 after it is added)', /\+\$4,200/.test(w3) && /\+\d+ d/.test(w3.split('CR-002')[0]) && /CHANGE REGISTER/.test(w3) && /CR-001/.test(w3) && /CR-003/.test(w3) && /Rejected/.test(w3) && /Deferred/.test(w3) && /Implemented/.test(w3));
    // an open one gets a sign-off block
    await p.click('#crAdd'); await p.waitForSelector('#crForm'); await p.fill('#crForm [name=title]', 'Move the pantry'); await p.fill('#crForm [name=desc]', 'Move the pantry 1 m left'); await p.uncheck('#crForm [name=ai]'); await p.click('#crForm [type=submit]'); await p.waitForSelector('#crCard');
    await p.click('#crCard [data-crdoc]'); await p.waitForSelector('#crDocx');
    const [d4] = await Promise.all([p.waitForEvent('download'), p.click('#crDocx')]); const f4 = path.join(tmp, d4.suggestedFilename()); await d4.saveAs(f4);
    const w4 = (await mammoth.extractRawText({ path: f4 })).value;
    ok('Document', 'an open change request prints with a decision and sign-off block (PM, project director, sponsor)', /Decision and sign-off/.test(w4) && /Approved\s+☐ Rejected/.test(w4) && /Project director/.test(w4), w4.slice(-500));
    // charter governance text
    await p.goto(`${BASE}/admin/#plan/${core}/scope`); await p.waitForSelector('#chDoc'); await p.click('#chDoc'); await p.waitForSelector('#chDocx');
    const [d5] = await Promise.all([p.waitForEvent('download'), p.click('#chDocx')]); const f5 = path.join(tmp, d5.suggestedFilename()); await d5.saveAs(f5);
    ok('Charter', 'the charter\'s governance section describes change control (change request, change control meeting, signed by the PM or PD)', /raised as a change request in change control/.test((await mammoth.extractRawText({ path: f5 })).value));
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close(); br = null;
  } catch (e) { try { if (br) await br.close(); } catch {} ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ') + ' LOG: ' + log.slice(-400)); }
  try { srv.kill(); } catch {} try { await blobs.stop(); } catch {}
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  mock.close(); process.exit(0);
})();
