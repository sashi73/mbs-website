// v60: 📞 Comms. Set up meetings on Google Meet, Microsoft Teams (links) and Zoom (connected: created through a stand-in
// Zoom API), pick people from the Stakeholder register, add a guest by email and put them on the register, the meeting
// log (cancel, reschedule), upload a .vtt transcript, ✨ analyse its impact (stand-in AI), preview and apply the changes
// (Gantt, budget, scope, risks, issues, stakeholders), undo, and ask Project Intelligence about the meeting by its date.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const SITE = path.resolve(process.argv[2]);
const PORT = 8960, BASE = `http://127.0.0.1:${PORT}`;
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => results.push({ area, name, pass: !!pass, detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const seen = [], zoomSeen = [];
const mock = http.createServer((req, res) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => {
  const raw = Buffer.concat(c).toString();
  if (/oauth\/token/.test(req.url)) { zoomSeen.push({ url: req.url, auth: req.headers.authorization }); res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ access_token: 'zt', expires_in: 3600 })); }
  if (/\/users\/me\/meetings/.test(req.url)) { zoomSeen.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(raw) }); res.writeHead(201, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ id: 81234567890, join_url: 'https://us02web.zoom.us/j/81234567890?pwd=abc', password: '4321' })); }
  const body = JSON.parse(raw || '{}'), sys = body.messages[0].content, u = JSON.parse(body.messages[1].content);
  seen.push({ sys, u, raw: body.messages[1].content });
  let out = { answer: 'OK' };
  if (/TRANSCRIPT of one project meeting/.test(sys)) {
    const bench = u.tasks.find((t) => /benchtop/i.test(t.task)), paint = u.tasks.find((t) => /paint/i.test(t.task));
    out = { outcome: 'The stone benchtop lead time is now three weeks, which pushes the finish out.', summary: ['Stone supplier lead time extended to 3 weeks', 'Customer asked for an extra power point', 'Greg (Oakwood Joinery) confirmed cabinets on time'],
      decisions: ['Order the stone this week'], actions: [{ action: 'Place the stone order', owner: 'Sashi', due: u.today }],
      impact: { scope: { level: 'Low', text: 'Extra double power point at the island.' }, time: { level: 'High', text: 'Benchtop task #' + bench.n + ' is on the critical path: the finish moves about 12 working days.' }, cost: { level: 'Medium', text: 'Express freight $800.' },
        quality: { level: 'Low', text: 'Check the slab for chips on delivery.' }, risk: { level: 'High', text: 'Further supplier delays.' }, issues: { level: 'Medium', text: 'Stone not ordered yet.' }, stakeholders: { level: 'Low', text: 'Stone supplier now involved.' } },
      task_changes: [{ n: bench.n, days: 18, extra_cost: 800, why: 'Stone lead time now 3 weeks' }],
      new_tasks: [{ name: 'Install extra power point at island', days: 1, after: [paint.n - 1], cost: 350, why: 'Customer request' }],
      scope_changes: [{ type: 'Add', text: 'Extra double power point at the island', why: 'Customer request in the meeting' }],
      risks: [{ title: 'Stone supplier delays again', cause: 'Quarry backlog', p: 3, i: 4, response: 'Mitigate', action: 'Weekly check with supplier', owner: 'Sashi', critical: true }],
      issues: [{ title: 'Stone not yet ordered', detail: 'Order needed this week', priority: 'High', owner: 'Sashi', due: u.today }],
      stakeholders: [{ name: 'Stone Co', role: 'Stone supplier', raci: 'C' }], quality: ['Inspect the slab for chips on delivery'], follow_ups: ['What can run alongside the benchtop?'] };
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(out) }, finish_reason: 'stop' }], usage: { total_tokens: 2100 } }));
}); });

(async () => {
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const MOCK = `http://127.0.0.1:${mock.address().port}`;
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-comms-blobs'); fs.rmSync(dir, { recursive: true, force: true });
  const blobs = new BlobsServer({ directory: dir, token: 'tok', port: 0 });
  const { port: bport } = await blobs.start();
  const ctxB64 = Buffer.from(JSON.stringify({ siteID: 'mbs', token: 'tok', edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, apiURL: `http://localhost:${bport}` })).toString('base64');
  process.env.NETLIFY_BLOBS_CONTEXT = ctxB64;
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NETLIFY_BLOBS_CONTEXT: ctxB64, ADMIN_USERNAME: 'sashi73', ADMIN_PASSWORD: 'sashi98',
    LLM_API_KEY: 'test', LLM_BASE_URL: MOCK, TELEGRAM_BOT_TOKEN: '', RESEND_API_KEY: '',
    ZOOM_ACCOUNT_ID: 'acc', ZOOM_CLIENT_ID: 'cid', ZOOM_CLIENT_SECRET: 'sec', ZOOM_OAUTH_URL: MOCK, ZOOM_API_BASE: MOCK, MS_TENANT_ID: '', MS_CLIENT_ID: '' };
  const srv = spawn('node', ['local-server.mjs'], { cwd: SITE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 40 && !/running/.test(log); i++) await sleep(150);
  let br = null;
  const tmp = path.join(os.tmpdir(), 'mbs-comms-files'); fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp);
  try {
    const J = await import(path.join(SITE, 'netlify/lib/jobs.mjs')), P = await import(path.join(SITE, 'netlify/lib/plan.mjs')), kv = await import(path.join(SITE, 'netlify/lib/kv.mjs'));
    const core = await J.nextCore('K');
    await J.create({ core, name: 'Kate Kitchen', phone: '0400 555 666', email: 'kate@example.com', suburb: 'Castle Hill', service: 'Kitchen renovation', source: 'phone', summary: 'Kitchen renovation.' });
    br = await chromium.launch();
    const ctx = await br.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
    const opened = [];
    await ctx.route(/calendar\.google\.com|teams\.microsoft\.com|zoom\.us/, (r) => { opened.push(r.request().url()); r.fulfill({ status: 200, contentType: 'text/html', body: '<p>ok</p>' }); });
    const p = await ctx.newPage(); p.setDefaultTimeout(30000);
    const errors = []; errorsAll = errors; p.on('pageerror', (e) => errors.push(e.message)); p.on('dialog', (x) => { errors.push('dialog: ' + x.message()); x.dismiss(); });
    await p.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
    await p.fill('[name=username]', 'sashi73'); await p.fill('[name=password]', 'sashi98'); await p.click('#loginForm button');
    await p.waitForSelector('#app:not([hidden])');
    await p.goto(`${BASE}/admin/#plan/${core}`); await p.waitForSelector('#tplType'); await p.selectOption('#tplType', 'kitchen-reno'); await p.click('#tplCreate'); await p.waitForSelector('table.gt'); await sleep(1200);
    // stakeholders on the plan (server side), then reload
    const pl0 = await P.get(core);
    pl0.stakeholders = [{ id: 's1', name: 'Kate Kitchen', role: 'Customer', raci: 'A', phone: '0400 555 666', email: 'kate@example.com' }, { id: 's2', name: 'Sam Sparky', role: 'Electrician', raci: 'R', phone: '', email: 'sam@sparky.com.au' }, { id: 's3', name: 'Phil Plumber', role: 'Plumber', raci: 'R', phone: '', email: '' }];
    await P.save(core, pl0, pl0.rev, 'test');
    await p.goto(`${BASE}/admin/#projects`); await sleep(300);
    await p.goto(`${BASE}/admin/#plan/${core}/comms`); await p.waitForSelector('#cmGo');
    const tabs = await p.$$eval('#planTabs .tab', (a) => a.map((x) => x.textContent.trim()));
    ok('Tab', '"📞 Comms" sits after Contracts, before SWMS', tabs.indexOf('📞 Comms') === tabs.indexOf('📜 Contracts') + 1 && tabs.indexOf('🦺 SWMS') === tabs.indexOf('📞 Comms') + 1, tabs.join(' | '));
    const plats = await p.$$eval('.cm-plat', (a) => a.map((x) => x.textContent));
    ok('Platforms', 'Google Meet, Microsoft Teams and Zoom; Zoom shows connected (API keys set), the others open the app', plats.length === 3 && /Google Meet/.test(plats[0]) && /Teams/.test(plats[1]) && /Zoom.*Connected/.test(plats[2]) && !/Connected/.test(plats[0] + plats[1]), plats.join(' / '));
    const who = await p.$$eval('[data-cmw]', (a) => a.map((x) => [x.getAttribute('data-cmw'), x.checked]));
    ok('Who', 'people come from the Stakeholder register, those with an email ticked', who.length === 3 && who[0][1] && who[1][1] && !who[2][1] && /no email/.test(await p.textContent('.cm-who')), JSON.stringify(who));
    // a guest who is not on the register
    await p.fill('#cmGuest', 'greg@oakwood.com.au'); await p.click('#cmGuestAdd');
    ok('Guest', 'an email not on the list is added as a guest, flagged "Not in the Stakeholder register" with advice to add them', /greg@oakwood/.test(await p.textContent('.cm-guests')) && /Not in the Stakeholder register/.test(await p.textContent('.cm-guests')) && /Stakeholder register stays a true record|true record/.test(await p.textContent('.cm-new')));
    await p.click('[data-cmreg="0"]'); await p.waitForSelector('#crRole'); await p.fill('#crName', 'Greg'); await p.fill('#crRole', 'Joiner (Oakwood Joinery)'); await p.selectOption('#crRaci', 'R'); await p.click('#crSave'); await sleep(300);
    const sk = await p.evaluate(() => window.MBS.planState.plan.stakeholders.find((x) => x.email === 'greg@oakwood.com.au'));
    ok('Guest', '"＋ Add to Stakeholders" puts them on the register (name, role, RACI, email) and ticks them', sk && sk.name === 'Greg' && sk.raci === 'R' && (await p.$(`[data-cmw="${sk.id}"]:checked`)) && !(await p.$('.cm-guests')), JSON.stringify(sk));
    await p.fill('#cmGuest', 'anna@council.nsw.gov.au'); await p.click('#cmGuestAdd');
    await p.fill('#cmTitle', 'Site meeting: kitchen progress'); await p.fill('#cmAgenda', 'Progress\nBenchtop lead time\nRisks');
    // Google (link)
    let pg = ctx.waitForEvent('page'); await p.click('#cmGo'); await (await pg).waitForLoadState().catch(() => {}); await sleep(300);
    const gUrl = opened.find((u) => /calendar\.google\.com/.test(u)) || '';
    ok('Google Meet', 'opens Google Calendar with the title, time, agenda and everyone with an email (stakeholders and the guest)', /text=Site%20meeting/.test(gUrl) && /ctz=Australia\/Sydney/.test(gUrl) && /kate%40example\.com/.test(gUrl) && /sam%40sparky/.test(gUrl) && /greg%40oakwood/.test(gUrl) && /anna%40council/.test(gUrl) && /Benchtop%20lead%20time/.test(gUrl), gUrl.slice(0, 300));
    let rows = await p.$$('tr[data-mid]');
    ok('Log', 'the meeting goes into the meeting log as Scheduled, with the guest noted as not in the register', rows.length === 1 && (await p.$eval('tr[data-mid] [data-mst]', (s) => s.value)) === 'Scheduled' && /1 guest not in the register/.test(await p.textContent('tr[data-mid]')));
    // Teams (link)
    await p.click('[data-plat=teams]'); await p.fill('#cmTitle', 'Teams catch-up');
    pg = ctx.waitForEvent('page'); await p.click('#cmGo'); await (await pg).waitForLoadState().catch(() => {}); await sleep(300);
    const tUrl = opened.find((u) => /teams\.microsoft\.com\/l\/meeting\/new/.test(u)) || '';
    ok('Teams', 'opens a new Microsoft Teams meeting with subject, start and end time (UTC) and the attendees', /subject=Teams%20catch-up/.test(tUrl) && /startTime=\d{4}-\d{2}-\d{2}T\d{2}%3A\d{2}/.test(tUrl) && /attendees=.*kate%40example\.com/.test(tUrl), tUrl.slice(0, 300));
    // Zoom (connected: created through the API)
    await p.click('[data-plat=zoom]'); await p.fill('#cmTitle', 'Zoom: benchtop and lead times');
    const zDate = await p.inputValue('#cmDate');
    ok('Zoom', 'the button says it creates the meeting directly', /Create the Zoom meeting/.test(await p.textContent('#cmGo')));
    await p.click('#cmGo'); await p.waitForFunction(() => document.querySelectorAll('tr[data-mid]').length === 3); await sleep(800);
    const zc = zoomSeen.find((x) => x.body);
    ok('Zoom', 'the Zoom API is called (server-to-server OAuth, then a meeting in Sydney time with the agenda and invitees)', zoomSeen[0] && /account_id=acc/.test(zoomSeen[0].url) && /^Basic /.test(zoomSeen[0].auth) && zc && zc.auth === 'Bearer zt' && zc.body.topic === 'Zoom: benchtop and lead times' && zc.body.timezone === 'Australia/Sydney' && zc.body.start_time === zDate + 'T10:00:00' && zc.body.duration === 45 && zc.body.settings.meeting_invitees.length >= 3, JSON.stringify(zc && zc.body).slice(0, 300));
    const zm = await p.evaluate(() => window.MBS.planState.plan.meetings.find((m) => m.platform === 'zoom'));
    ok('Zoom', 'the join link and passcode are saved on the log with a 🔗 Join link', zm && zm.link === 'https://us02web.zoom.us/j/81234567890?pwd=abc' && zm.passcode === '4321' && (await p.$(`tr[data-mid="${zm.id}"] a.cm-join[href*="zoom.us/j/"]`)), JSON.stringify(zm));
    await sleep(1200);
    const saved = await P.get(core);
    ok('Saved', 'the meetings are saved with the plan (platform, guests, status, link)', saved.meetings.length === 3 && saved.meetings.some((m) => m.platform === 'teams') && saved.meetings.find((m) => m.platform === 'zoom').link.includes('zoom.us') && saved.meetings.some((m) => m.guests.includes('anna@council.nsw.gov.au')), JSON.stringify(saved.meetings.map((m) => [m.platform, m.status, m.guests])));
    // cancel the Teams one, reschedule the Google one
    const tm = await p.evaluate(() => window.MBS.planState.plan.meetings.find((m) => m.platform === 'teams').id), gm = await p.evaluate(() => window.MBS.planState.plan.meetings.find((m) => m.platform === 'google').id);
    await p.selectOption(`tr[data-mid="${tm}"] [data-mst]`, 'Cancelled'); await sleep(300);
    const cHref = await p.getAttribute(`tr[data-mid="${tm}"] [data-mmail]`, 'href');
    ok('Status', 'Cancelled: the row is struck out and the email says it is cancelled', (await p.getAttribute(`tr[data-mid="${tm}"]`, 'class')).includes('cm-cancelled') && /subject=Cancelled/.test(cHref) && /is%20cancelled/.test(cHref));
    await p.selectOption(`tr[data-mid="${gm}"] [data-mst]`, 'Rescheduled'); await p.waitForSelector('#rsDate');
    const newD = await p.evaluate(() => { const d = new Date(document.querySelector('#rsDate').value + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 7); return d.toISOString().slice(0, 10); });
    await p.fill('#rsDate', newD); await p.fill('#rsStart', '14:00'); await p.click('#rsSave'); await p.waitForSelector('#rsIcs');
    const rsMail = await p.getAttribute('.modal a[href^="mailto:"]', 'href'); await p.click('.modal [data-close]'); await sleep(300);
    const gmm = await p.evaluate((id) => window.MBS.planState.plan.meetings.find((m) => m.id === id), gm);
    ok('Status', 'Rescheduled: new date and time, the old time kept ("moved from"), and a "New time" email', gmm.status === 'Rescheduled' && gmm.date === newD && gmm.start === '14:00' && gmm.was.length === 1 && /moved from/.test(await p.textContent(`tr[data-mid="${gm}"]`)) && /subject=New%20time/.test(rsMail), JSON.stringify(gmm));
    // transcript for the Zoom meeting
    const vtt = 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:05.000\n<v Sashi>Thanks all. First, the stone benchtop.\n\n2\n00:00:06.000 --> 00:00:12.000\n<v Stone Co>Our lead time is now three weeks, not one. Call me on 0412 345 678 or bob@stoneco.com.au.\n\n3\n00:00:13.000 --> 00:00:20.000\n<v Kate>Can we add a double power point at the island?\n\n4\n00:00:21.000 --> 00:00:25.000\n<v Greg>Cabinets are on time.\n';
    fs.writeFileSync(path.join(tmp, 'zoom-transcript.vtt'), vtt);
    await p.setInputFiles(`tr[data-mid="${zm.id}"] [data-mtx]`, path.join(tmp, 'zoom-transcript.vtt'));
    await p.waitForSelector(`tr[data-mid="${zm.id}"] .cm-tx`); await sleep(400);
    const zm2 = await p.evaluate((id) => window.MBS.planState.plan.meetings.find((m) => m.id === id), zm.id);
    const docs = (await kv.get('pdocs:' + core)).docs;
    ok('Transcript', 'uploading the transcript (.vtt) keeps it as a "Meeting transcript" document and marks the meeting as held', zm2.doc && docs.some((d) => d.id === zm2.doc && d.kind === 'Meeting transcript') && zm2.status === 'Took place' && !!(await p.$(`tr[data-mid="${zm.id}"] [data-man]`)), JSON.stringify(docs.map((d) => [d.name, d.kind])));
    // analyse
    const before = await p.evaluate(() => { const P = window.MBS.planState.plan; return { n: P.tasks.length, bench: P.tasks.find((t) => /benchtop/i.test(t.name)) }; });
    await p.click(`tr[data-mid="${zm.id}"] [data-man]`);
    await p.waitForSelector('.cm-an [data-imprev] b', { timeout: 60000 });
    const ask = seen.find((x) => /TRANSCRIPT of one project meeting/.test(x.sys));
    ok('AI', 'the AI gets the transcript (timings removed) with the plan, critical path, risks and stakeholders', ask && /Our lead time is now three weeks/.test(ask.u.transcript) && !/-->/.test(ask.u.transcript) && ask.u.tasks.length === before.n && ask.u.tasks.some((t) => t.critical) && Array.isArray(ask.u.risks) && ask.u.stakeholders.length >= 3);
    ok('Privacy', 'phone numbers, emails and the customer\'s details are taken out before the AI sees anything', ask && !/0412 345 678|bob@stoneco|kate@example|0400 555 666|greg@oakwood/.test(ask.raw), (ask ? ask.u.transcript : '').slice(0, 300));
    const panel = await p.textContent('.cm-an');
    const areas = await p.$$eval('.cm-an .im-tbl tbody tr', (r) => r.map((x) => x.textContent));
    ok('Analysis', 'summary, decisions and actions, and the impact on scope, time, cost, quality, risk, issues and stakeholders', /Outcome/.test(panel) && /Decisions/.test(panel) && /Place the stone order/.test(panel) && areas.length === 7 && /Time.*High/.test(areas[1]), areas.join(' / '));
    const prev1 = await p.textContent('.cm-an [data-imprev]');
    ok('Preview', 'the preview shows the finish date and budget with the ticked changes (later and dearer)', /finish .* → .*\(\+\d+ working days\)/.test(prev1) && /budget .* → .*\(\+\$1,150/.test(prev1), prev1);
    await p.uncheck('.cm-an [data-im="n:0"]'); await sleep(200);
    const prev2 = await p.textContent('.cm-an [data-imprev]');
    ok('Preview', 'unticking a change updates the preview (no extra power point: +$800 only)', /\(\+\$800/.test(prev2), prev2);
    await p.check('.cm-an [data-im="n:0"]');
    await p.click('.cm-an [data-imgo]'); await sleep(1500);
    const after = await p.evaluate(() => { const P = window.MBS.planState.plan; return { n: P.tasks.length, bench: P.tasks.find((t) => /benchtop/i.test(t.name)), np: P.tasks.find((t) => /power point/i.test(t.name)), risks: P.risks.map((r) => r.title), issues: P.issues.map((i) => i.title), sk: P.stakeholders.map((s) => s.name), inScope: P.charter.inScope, acc: P.charter.acceptance, m: P.meetings.find((m) => m.platform === 'zoom') }; });
    const benchCost = (t) => (t.qty || 0) * (t.rate || 0);
    ok('Apply', 'the benchtop task is 18 days, with +$800 on its cost and a note why', after.bench.dur === 18 && Math.abs(benchCost(after.bench) - benchCost(before.bench) - 800) < 0.02 && /Stone lead time now 3 weeks \(meeting/.test(after.bench.notes), JSON.stringify(after.bench));
    ok('Apply', 'the new task is added after the right task with its cost', after.n === before.n + 1 && after.np && after.np.dur === 1 && after.np.pred.length === 1 && after.np.qty * after.np.rate === 350);
    ok('Apply', 'scope, acceptance (quality), risk, issue and the new stakeholder are added', /Extra double power point/.test(after.inScope) && /Inspect the slab/.test(after.acc) && after.risks.includes('Stone supplier delays again') && after.issues.includes('Stone not yet ordered') && after.sk.includes('Stone Co'));
    ok('Apply', 'the meeting shows "✓ applied to the plan" and the changes can\'t be applied twice', after.m.applied > 0 && /applied to the plan/.test(await p.textContent(`tr[data-mid="${zm.id}"]`)) && !(await p.$('.cm-an [data-imgo]')) && !!(await p.$('.cm-an [data-imundo]')));
    await sleep(1200);
    const sv = await P.get(core);
    ok('Saved', 'the changed plan is saved (the Gantt chart uses the new days)', sv.tasks.find((t) => /benchtop/i.test(t.name)).dur === 18 && sv.meetings.find((m) => m.platform === 'zoom').applied > 0 && sv.meetings.find((m) => m.platform === 'zoom').analysed > 0);
    await p.click('.cm-an [data-imundo]'); await sleep(800);
    const und = await p.evaluate(() => { const P = window.MBS.planState.plan; return { n: P.tasks.length, dur: P.tasks.find((t) => /benchtop/i.test(t.name)).dur, risks: P.risks.length }; });
    ok('Undo', '↶ Undo puts the plan back as it was', und.n === before.n && und.dur === before.bench.dur, JSON.stringify(und));
    // Project Intelligence: ask about the meeting by its date
    const zd = zm2.date, dd = +zd.slice(8, 10), mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+zd.slice(5, 7) - 1];
    await p.goto(`${BASE}/admin/#plan/${core}/intel`); await p.waitForSelector('#piQ');
    const nAsk = seen.length;
    await p.fill('#piQ', `Analyse my meeting log on ${dd} ${mon}, summarise the outcome and advise me how it impacts the project, and list any changes to scope, time, cost, risks, issues or stakeholders`); await p.click('#piGo');
    await p.waitForSelector('#piLog .pi-a .pi-imp', { timeout: 60000 });
    const pia = await p.textContent('#piLog .pi-a');
    ok('Project Intelligence', 'asking about the meeting by date reads that meeting\'s transcript and gives the outcome and the impact', seen.length === nAsk + 1 && /TRANSCRIPT/.test(seen[nAsk].sys) && /Zoom: benchtop and lead times/.test(pia) && /Outcome/.test(pia) && (await p.$$('#piLog .pi-a .im-tbl tbody tr')).length === 7, pia.slice(0, 200));
    ok('Project Intelligence', 'the changes can be applied from the answer too (with the finish / budget preview)', !!(await p.$('#piLog .pi-a [data-imgo]')) && /working day/.test(await p.textContent('#piLog .pi-a [data-imprev]')));
    await p.fill('#piQ', 'Analyse the meeting on 2/1/2025 and summarise the outcome'); await p.click('#piGo');
    await p.waitForFunction(() => /No meeting on/.test(document.querySelector('#piLog').textContent), null, { timeout: 30000 });
    ok('Project Intelligence', 'a date with no meeting gets a plain answer (no AI call)', seen.length === nAsk + 1);
    ok('Project Intelligence', 'there is an example question for the last meeting', /Analyse my last meeting/.test(await p.textContent('.pi-ex')));
    // phone
    await p.setViewportSize({ width: 390, height: 844 }); await p.goto(`${BASE}/admin/#plan/${core}/comms`); await p.waitForSelector('#cmGo'); await sleep(400);
    ok('Phone', 'no sideways scrolling on a phone', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await p.evaluate(() => document.documentElement.scrollWidth));
    await p.setViewportSize({ width: 1500, height: 950 });
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close(); br = null;
  } catch (e) { try { if (br) await br.close(); } catch {} ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ') + ' LOG: ' + log.slice(-600)); }
  try { srv.kill(); } catch {} try { await blobs.stop(); } catch {} mock.close();
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(0);
})();
