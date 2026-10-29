// v40: "Weekends (Sat, Sun) allowed" tick box, more flexible Work starts (shorter cooling-off instead of a refusal),
// and the "plan is now late" choices (Fit with AI, Allow weekends, Move Finish by, Keep). Stand-in AI, real Blobs, local site, Chromium.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const SITE = path.resolve(process.argv[2]);
const PORT = 8938, BASE = `http://127.0.0.1:${PORT}`;
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => results.push({ area, name, pass: !!pass, detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dmy = (x) => x.slice(8, 10) + '/' + x.slice(5, 7) + '/' + x.slice(0, 4);
const dow = (s) => new Date(s + 'T00:00:00Z').getUTCDay();

let asked = null;
const mock = http.createServer((req, res) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => {
  const body = JSON.parse(Buffer.concat(c).toString() || '{}'), user = JSON.parse(body.messages[1].content);
  asked = user;
  const out = { can_fit: false, summary: 'Nothing safe to change.', changes: [], tips: [], risks: [] };   // the AI finds nothing: the weekend option must still be offered
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(out) }, finish_reason: 'stop' }], usage: { total_tokens: 300 } }));
}); });

(async () => {
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-wkflex-blobs'); fs.rmSync(dir, { recursive: true, force: true });
  const blobs = new BlobsServer({ directory: dir, token: 'tok', port: 0 });
  const { port: bport } = await blobs.start();
  const ctxB64 = Buffer.from(JSON.stringify({ siteID: 'mbs', token: 'tok', edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, apiURL: `http://localhost:${bport}` })).toString('base64');
  process.env.NETLIFY_BLOBS_CONTEXT = ctxB64;
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NETLIFY_BLOBS_CONTEXT: ctxB64, ADMIN_USERNAME: 'sashi73', ADMIN_PASSWORD: 'sashi98',
    LLM_API_KEY: 'test', LLM_BASE_URL: `http://127.0.0.1:${mock.address().port}`, TELEGRAM_BOT_TOKEN: '', RESEND_API_KEY: '' };
  const srv = spawn('node', ['local-server.mjs'], { cwd: SITE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 40 && !/running/.test(log); i++) await sleep(150);
  let br = null;
  try {
    const J = await import(path.join(SITE, 'netlify/lib/jobs.mjs'));
    const kv = await import(path.join(SITE, 'netlify/lib/kv.mjs'));
    const P = await import(path.join(SITE, 'netlify/lib/plan.mjs'));
    const AI = await import(path.join(SITE, 'netlify/lib/ai.mjs'));
    // ---------- rules ----------
    ok('Rules', '"Weekends allowed" makes every day count, like an emergency', P.allDays({ weekends: true }) && P.allDays({ emergency: true }) && !P.allDays({}));

    const core = await J.nextCore('O');
    await J.create({ core, name: 'Del Deck', phone: '0400 777 111', email: '', suburb: 'Kellyville', service: 'Deck', source: 'phone', summary: 'New timber deck at the back.' });
    br = await chromium.launch();
    const p = await (await br.newContext({ viewport: { width: 1500, height: 950 } })).newPage(); p.setDefaultTimeout(15000);
    const errors = []; errorsAll = errors;
    p.on('pageerror', (e) => errors.push(e.message)); p.on('dialog', (x) => { errors.push('dialog: ' + x.message()); x.dismiss(); });
    await p.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
    await p.fill('[name=username]', 'sashi73'); await p.fill('[name=password]', 'sashi98'); await p.click('#loginForm button');
    await p.waitForSelector('#app:not([hidden])');
    const stored = async () => kv.get('plan:' + core);
    const saved = async () => { await p.waitForFunction(() => /Saved/.test((document.querySelector('#planSave') || {}).textContent || ''), null, { timeout: 15000 }); await sleep(300); };
    const finishOf = async () => { const s = await stored(); return P.rollup(JSON.parse(JSON.stringify(s)), AI.sydToday()).finish; };

    // ---------- new plan page ----------
    await p.goto(`${BASE}/admin/#plan/${core}`); await p.waitForSelector('#tplWeek');
    const s1 = await p.locator('.dbox:has(#tplStart)').boundingBox(), w1 = await p.locator('.pdates label:has(#tplWeek)').boundingBox();
    ok('New plan', 'the "Weekends (Sat, Sun) allowed" tick box is in the same row as the dates and Emergency', w1 && s1 && w1.y < s1.y + 80);
    await p.selectOption('#tplType', 'deck-timber'); await p.click('#tplCreate'); await p.waitForSelector('table.gt');
    let st = await stored();
    ok('New plan', 'not ticked: the plan is weekdays only', st.weekends === false && !(await p.isChecked('#pWeek')));
    const fWeekdays = await finishOf();
    const datesOf = (s) => P.schedule(JSON.parse(JSON.stringify(s))).tasks.flatMap((t) => [t.es, t.ef]).filter(Boolean);
    ok('Schedule', 'weekdays only: no task on a Saturday or Sunday', datesOf(st).every((d) => dow(d) !== 0 && dow(d) !== 6));

    // ---------- tick box on the Schedule tab ----------
    await p.check('#pWeek'); await saved();
    st = await stored(); const fWeekend = await finishOf();
    ok('Schedule', 'tick "Weekends allowed": saved, and the plan finishes sooner', st.weekends === true && fWeekend < fWeekdays, fWeekend + ' vs ' + fWeekdays);
    ok('Schedule', '...and tasks now run on Saturdays and Sundays', datesOf(st).some((d) => dow(d) === 0 || dow(d) === 6));
    ok('Schedule', 'the Time card and the hint say weekends are included', /weekends included/.test(await p.textContent('.pkpis')) && /weekends allowed: every day/.test(await p.textContent('#planBody')));
    await p.uncheck('#pWeek'); await saved();
    ok('Schedule', 'untick: back to weekdays only and the old finish', (await stored()).weekends === false && (await finishOf()) === fWeekdays);

    // ---------- Finish by earlier than the weekday finish, but reachable with weekends ----------
    const fb = fWeekend;   // weekends make it exactly; weekdays are late
    await p.fill('.dbox:has(#pFinishBy) .dtext', dmy(fb)); await p.press('.dbox:has(#pFinishBy) .dtext', 'Enter');
    await p.waitForSelector('.fitopts', { timeout: 8000 });
    const mt = await p.textContent('#modalBody');
    ok('Late', 'setting an earlier Finish by asks what to do straight away', /The plan now finishes/.test(mt) && /late for your Finish by/.test(mt));
    ok('Late', 'choices: Fit with AI (crashing and fast-tracking), Allow weekends (with its finish date), Move Finish by, Keep', /Fit it with AI/.test(mt) && /Crashing/.test(mt) && /fast-tracking/.test(mt) && new RegExp('Allow weekends \\(Sat, Sun\\)Finishes ' + dmy(fWeekend).replace(/\//g, '\\/') + ': on time').test(mt.replace(/\s+/g, ' ').replace(/\) Finishes/, ')Finishes')) && /Move Finish by/.test(mt) && /Keep it as it is/.test(mt), mt.slice(0, 500));
    await p.screenshot({ path: path.join(__dirname, 'shot40-late.png') });
    await p.click('#aoWeek'); await saved();
    ok('Late', '"Allow weekends": ticked, saved, and the plan is on time (no second question)', (await stored()).weekends === true && /on time/.test(await p.textContent('.fitbar')) && !(await p.isVisible('.fitopts')));

    // unticking makes it late again: asked again; this time move the Finish by
    await p.uncheck('#pWeek'); await p.waitForSelector('.fitopts', { timeout: 8000 });
    ok('Late', 'untick weekends: late again, so it asks again', /weekend work changed/i.test(await p.textContent('#modalBody')));
    await p.click('#aoKeep').catch(async () => { await p.click('.fitopts [data-close]'); });
    await sleep(300); await saved();
    ok('Late', '"Keep it as it is": nothing changes, the late bar offers ✨ Fit and 📅 Allow weekends', /late/.test(await p.textContent('.fitbar')) && await p.isVisible('#fitGo') && /Allow weekends: finishes/.test(await p.textContent('#fitWeek')));

    // ---------- the AI finds nothing: the preview still offers weekends ----------
    await p.click('#fitGo'); await p.waitForSelector('#fitUseWeek', { timeout: 30000 });
    const pv = await p.textContent('#modalBody');
    ok('AI', 'the AI is told whether weekends are allowed', asked && asked.weekends_allowed === false);
    ok('AI', 'no safe changes found, but the preview says weekends would make it on time', /Allowing weekends \(Sat, Sun\) on top of the plan would finish/.test(pv) && /on time/.test(pv), pv.slice(0, 400));
    await p.click('#fitUseWeek'); await saved();
    ok('AI', '"Allow weekends" from the preview: ticked and on time, with Undo', (await stored()).weekends === true && /on time/.test(await p.textContent('.fitbar')) && await p.isVisible('#fitUndo'));
    await p.click('#fitUndo'); await saved();
    ok('AI', 'Undo puts weekdays back', (await stored()).weekends === false);

    // ---------- Move Finish by ----------
    await p.fill('.dbox:has(#pFinishBy) .dtext', dmy(P.prevWork(fb))); await p.press('.dbox:has(#pFinishBy) .dtext', 'Enter');
    await p.waitForSelector('#aoMove', { timeout: 8000 }); await p.click('#aoMove'); await saved();
    ok('Late', '"Move Finish by" sets it to the planned finish', (await stored()).finishBy === fWeekdays);

    // ---------- Work starts: shorter cooling-off instead of a refusal ----------
    await p.fill('.dbox:has(#pFinishBy) .dtext', ''); await p.press('.dbox:has(#pFinishBy) .dtext', 'Enter'); await saved();
    const q = await (await p.request.post(`${BASE}/.netlify/functions/admin`, { data: { action: 'planQuote', core, mode: 'lump', margin: 0 }, headers: { 'X-MBS-Admin': '1' } })).json();
    await p.goto(`${BASE}/admin/#plan/${core}/schedule`); await p.reload({ waitUntil: 'networkidle' }); await p.waitForSelector('#pWork');
    await p.waitForFunction(() => /Quote \S+ is not accepted yet|accepted on/.test((document.querySelector('.qgate') || {}).textContent || ''), null, { timeout: 15000 });   // the plan knows about the quote
    const qd = q.doc ? q.doc.issued : AI.sydToday();
    const want = P.addWork(P.nextWork(qd), 1);   // one business day after the quote: needs the cooling-off cut from 3 to 1
    ok('Work starts', 'the Work starts date box no longer greys out dates before the cooling-off ends', !((await p.getAttribute('#pWork', 'min')) > want));
    await p.fill('.dbox:has(#pWork) .dtext', dmy(want)); await p.press('.dbox:has(#pWork) .dtext', 'Enter');
    await sleep(2500);
    st = await stored();
    const toastT = await p.textContent('#toast');
    ok('Work starts', 'a date inside the cooling-off is accepted: cooling-off shortened to 1 business day', st.coolOff === 1 && /Cooling-off shortened to 1 business day/.test(toastT), JSON.stringify({ cool: st.coolOff, ws: st.workStart, toast: toastT.slice(0, 200) }));
    ok('Work starts', '...with the warning that the customer must agree to waive the rest', /must agree in writing/.test(toastT));
    // a task can be moved past the current finish (no greyed-out dates): the project just gets longer
    const f1 = await finishOf(), later = P.addWork(f1, 3);
    const tid = (await stored()).tasks.find((x) => /Bearers|joists/i.test(x.name)) || (await stored()).tasks[3];
    ok('Dates', 'task Start date boxes no longer grey out dates after the current finish', (await p.getAttribute(`tr[data-tid="${tid.id}"] input[data-k="snet"]`, 'max')) === null);
    await p.fill(`tr[data-tid="${tid.id}"] .dbox .dtext`, dmy(later)); await p.press(`tr[data-tid="${tid.id}"] .dbox .dtext`, 'Enter'); await saved();
    const st2 = await stored(), t2 = P.schedule(JSON.parse(JSON.stringify(st2))).tasks.find((x) => x.id === tid.id);
    ok('Dates', 'a task moved past the old finish keeps that date, and the project gets longer', t2.es === later && (await finishOf()) > f1, JSON.stringify([t2.es, later]));
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close(); br = null;
  } catch (e) { try { if (br) await br.close(); } catch {} ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ') + ' LOG: ' + log.slice(-500)); }
  try { srv.kill(); } catch {} try { mock.close(); } catch {} try { await blobs.stop(); } catch {}
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(0);
})();
