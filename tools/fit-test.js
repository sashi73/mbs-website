// v38: "Finish by" + ✨ Fit to finish-by. A stand-in AI gives two good changes (crash a task, fast-track a task)
// and three bad ones (shorten a protected task, cut a task below half, a circular "after" link): only the good ones get through.
// Real Blobs, local site, Chromium.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const SITE = path.resolve(process.argv[2]);
const PORT = 8936, BASE = `http://127.0.0.1:${PORT}`;
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => results.push({ area, name, pass: !!pass, detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dmy = (x) => x.slice(8, 10) + '/' + x.slice(5, 7) + '/' + x.slice(0, 4);

let lastAsk = null;
const mock = http.createServer((req, res) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => {
  const body = JSON.parse(Buffer.concat(c).toString() || '{}'), sys = body.messages[0].content, user = JSON.parse(body.messages[1].content);
  let out = { changes: [] };
  if (/project scheduler/.test(sys)) {
    lastAsk = user;
    const id = (re) => (user.tasks.find((t) => re.test(t.n)) || {}).id;
    const remove = user.tasks.find((t) => /Remove old/.test(t.n));
    out = { can_fit: true, summary: 'Lay the tiles with a second tiler and level the floor while the old floor comes up.', tips: ['Book the second tiler now.'],
      risks: [['Rushed tiling', 'two tilers working fast', 2, 3, 'Mitigate', 'Check levels twice a day']],
      changes: [
        { id: id(/^Lay tiles/), d: 2, after: [id(/^Grout/)], why: 'Second tiler (bad part: after Grout goes in a circle)', extra_cost: 450 },
        { id: id(/^Level/), after: remove.after, why: 'Level the cleared half while the rest comes up', extra_cost: 0 },
        { id: id(/inspection/i), d: 0, why: 'bad: protected' },
        { id: id(/^Grout/), d: 0, why: 'bad: below half' }] };
  }
  const txt = JSON.stringify(out);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { content: txt }, finish_reason: 'stop' }], usage: { total_tokens: 900 } }));
}); });

(async () => {
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-fit-blobs'); fs.rmSync(dir, { recursive: true, force: true });
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
    const core = await J.nextCore('T');
    await J.create({ core, name: 'Tina Tiles', phone: '0400 111 222', email: '', suburb: 'Box Hill', service: 'Tiling', source: 'phone', summary: 'Retile the kitchen floor.' });
    br = await chromium.launch();
    const p = await (await br.newContext({ viewport: { width: 1500, height: 950 } })).newPage(); p.setDefaultTimeout(15000);
    const errors = []; errorsAll = errors;
    p.on('pageerror', (e) => errors.push(e.message)); p.on('dialog', (x) => { errors.push('dialog: ' + x.message()); x.dismiss(); });
    await p.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
    await p.fill('[name=username]', 'sashi73'); await p.fill('[name=password]', 'sashi98'); await p.click('#loginForm button');
    await p.waitForSelector('#app:not([hidden])');
    await p.goto(`${BASE}/admin/#plan/${core}`); await p.waitForSelector('#tplType');
    await p.selectOption('#tplType', 'tile-floor'); await p.click('#tplCreate'); await p.waitForSelector('table.gt');
    const stored = async () => kv.get('plan:' + core);
    const saved = async () => { await p.waitForFunction(() => /Saved/.test((document.querySelector('#planSave') || {}).textContent || ''), null, { timeout: 15000 }); await sleep(300); };
    let st = await stored(); const R0 = P.rollup(JSON.parse(JSON.stringify(st)), st.start);
    ok('Finish by', 'the Schedule tab has a "Finish by" date box', await p.isVisible('.dbox:has(#pFinishBy) .dtext'));
    // two working days earlier than the plan's finish
    let fb = R0.finish; for (let i = 0; i < 2; i++) fb = P.prevWork(fb);
    await p.fill('.dbox:has(#pFinishBy) .dtext', dmy(fb)); await p.press('.dbox:has(#pFinishBy) .dtext', 'Enter'); await saved();
    st = await stored();
    ok('Finish by', 'the date is saved with the plan', st.finishBy === fb, st.finishBy);
    ok('Finish by', 'the plan says it is 2 working days late, with ✨ Fit to finish-by', /2 working days late/.test(await p.textContent('.fitbar')) && await p.isVisible('#fitGo'), await p.textContent('.fitbar'));
    const before = JSON.stringify(st.tasks.map((t) => [t.id, t.dur, t.pred]));
    await p.locator('.qgate').screenshot({ path: path.join(__dirname, 'shot38-late.png') }).catch(() => {}); await p.locator('.fitbar').screenshot({ path: path.join(__dirname, 'shot38-latebar.png') });

    // v42: an earlier Finish by goes straight to the AI re-plan (no click needed)
    await p.waitForSelector('#fitUse', { timeout: 30000 });
    ok('AI', 'the AI is told which tasks are critical and which are locked', lastAsk && lastAsk.days_late === 2 && lastAsk.tasks.some((t) => t.crit) && lastAsk.tasks.find((t) => /inspection/i.test(t.n)).locked === true);
    ok('AI', 'no customer details are sent to the AI, and task names stay intact ("Lay tiles" for a customer called Tina Tiles)', !JSON.stringify(lastAsk).includes('Tina') && !JSON.stringify(lastAsk).includes('0400 111 222') && lastAsk.tasks.some((t) => t.n === 'Lay tiles'), JSON.stringify(lastAsk.tasks.map((t) => t.n)));
    const m = await p.textContent('#modalBody');
    const rows = await p.$$eval('#modalBody tbody tr', (x) => x.length);
    await p.locator('.modal-card').screenshot({ path: path.join(__dirname, 'shot38-preview.png') });
    ok('Preview', 'shows the new finish is on time', /on time for/.test(m), m.slice(0, 200));
    ok('Preview', 'only the 2 good changes are offered (crash Lay tiles 3 → 2, Level runs alongside)', rows === 2 && /Days 3 → 2/.test(m) && /runs alongside/.test(m), m.slice(0, 600));
    ok('Safety', 'the 3 bad suggestions are refused: protected task, below half, circular order', /can't be rushed/.test(m) && /below half/.test(m) && /go in a circle/.test(m));
    ok('Preview', 'shows the extra cost ($450.00) and offers to add the risk', /\$450\.00/.test(m) && await p.isChecked('#fitRisks'));
    ok('Preview', 'nothing is saved until you press Use', JSON.stringify((await stored()).tasks.map((t) => [t.id, t.dur, t.pred])) === before);

    await p.click('#fitUse'); await saved();
    st = await stored(); const R1 = P.rollup(JSON.parse(JSON.stringify(st)), st.start);
    const lay = st.tasks.find((t) => /^Lay tiles/.test(t.name)), lev = st.tasks.find((t) => /^Level/.test(t.name)), rem = st.tasks.find((t) => /^Remove old/.test(t.name));
    ok('Use', 'the changes are saved: Lay tiles 2 days, Level runs alongside Remove', lay.dur === 2 && JSON.stringify(lev.pred) === JSON.stringify(rem.pred));
    ok('Use', 'the plan now finishes on time', R1.finish <= fb && /on time for your finish-by date/.test(await p.textContent('.fitbar')), R1.finish + ' vs ' + fb);
    ok('Use', 'the risk is added and the assumptions record the change', st.risks.some((r) => r.title === 'Rushed tiling') && /Schedule brought in to finish by/.test(st.charter.assumptions));
    ok('Use', 'protected and refused tasks are unchanged', st.tasks.find((t) => /inspection/i.test(t.name)).dur >= 1 && st.tasks.find((t) => /^Grout/.test(t.name)).dur >= 1 && !(lay.pred || []).includes(st.tasks.find((t) => /^Grout/.test(t.name)).id));

    await p.click('#fitUndo'); await saved();
    st = await stored();
    ok('Undo', '↶ Undo puts the plan back exactly as it was', JSON.stringify(st.tasks.map((t) => [t.id, t.dur, t.pred])) === before && /2 working days late/.test(await p.textContent('.fitbar')));

    // already on time: no button
    await p.fill('.dbox:has(#pFinishBy) .dtext', dmy(R0.finish)); await p.press('.dbox:has(#pFinishBy) .dtext', 'Enter'); await saved();
    ok('Finish by', 'on time: a green note and no Fit button', /on time/.test(await p.textContent('.fitbar')) && !(await p.isVisible('#fitGo')));
    await p.screenshot({ path: path.join(__dirname, 'shot38-fitbar.png'), clip: { x: 0, y: 0, width: 1500, height: 520 } });
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close(); br = null;
  } catch (e) { try { if (br) await br.close(); } catch {} ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ') + ' LOG: ' + log.slice(-600)); }
  try { srv.kill(); } catch {} try { mock.close(); } catch {} try { await blobs.stop(); } catch {}
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(0);
})();
