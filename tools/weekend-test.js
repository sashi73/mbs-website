// v34: emergency jobs work Saturday and Sunday. Normal jobs stay Monday to Friday.
// Server rules (plan.mjs), the quote snapshot, and the console planner (admin-plan.js) must all agree. Real Blobs, local site, Chromium.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const SITE = path.resolve(process.argv[2]);
const PORT = 8934, BASE = `http://127.0.0.1:${PORT}`;
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => { results.push({ area, name, pass: !!pass, detail }); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dow = (s) => new Date(s + 'T00:00:00Z').getUTCDay();
const weekend = (s) => s && (dow(s) === 0 || dow(s) === 6);

(async () => {
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-weekend-blobs'); fs.rmSync(dir, { recursive: true, force: true });
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
    const P = await import(path.join(SITE, 'netlify/lib/plan.mjs'));
    const PQ = await import(path.join(SITE, 'netlify/lib/plan-quote.mjs'));
    const J = await import(path.join(SITE, 'netlify/lib/jobs.mjs'));
    const kv = await import(path.join(SITE, 'netlify/lib/kv.mjs'));

    // ---------- 1. the day rules ----------
    const FRI = '2026-10-30', SAT = '2026-10-31', SUN = '2026-11-01', MON = '2026-11-02';
    ok('Rules', 'normal: Saturday moves to Monday; 3 days from Friday ends Wednesday', P.nextWork(SAT) === MON && P.addWork(FRI, 2) === '2026-11-03' && P.workBetween(FRI, MON) === 2);
    ok('Rules', 'emergency: Saturday stays Saturday; 3 days from Friday ends Sunday', P.nextWork(SAT, true) === SAT && P.addWork(FRI, 2, true) === SUN && P.workBetween(FRI, MON, true) === 4);
    ok('Rules', 'a plan is "every day" only when it is an emergency', P.allDays({ emergency: true }) === true && P.allDays({}) === false && P.allDays(null) === false);

    const mk = (emergency) => ({ start: FRI, emergency, coolOff: 0, tasks: [
      { id: 'a', name: 'Site inspection', dur: 1, pred: [] },
      { id: 'q', name: 'Quote accepted', dur: 0, pred: ['a'] },
      { id: 'b', name: 'Make safe and dry out', dur: 3, pred: ['q'] },
      { id: 'c', name: 'Repair and reseal', dur: 2, pred: ['b'] }] });
    const N = P.schedule(mk(false)), E = P.schedule(mk(true));
    const dates = (p) => p.tasks.flatMap((t) => [t.es, t.ef]);
    ok('Schedule', 'normal job: no task starts or ends on a weekend', dates(N).every((d) => !weekend(d)), JSON.stringify(dates(N)));
    ok('Schedule', 'emergency job: the work runs through Saturday and Sunday', E.tasks.find((t) => t.id === 'b').es === FRI && E.tasks.find((t) => t.id === 'b').ef === SUN && dates(E).some(weekend), JSON.stringify(dates(E)));
    const fN = N.tasks.reduce((m, t) => (t.ef > m ? t.ef : m), ''), fE = E.tasks.reduce((m, t) => (t.ef > m ? t.ef : m), '');
    ok('Schedule', 'emergency finishes three days sooner (Tue 3 Nov vs Fri 6 Nov)', fE === '2026-11-03' && fN === '2026-11-06', fE + ' / ' + fN);
    const rN = P.rollup(mk(false), SUN), rE = P.rollup(mk(true), SUN);
    ok('Progress', 'planned progress counts weekend days only for the emergency job', rE.PV > rN.PV || (rE.BAC === 0 && rN.BAC === 0));
    const g = P.gateOf({ emergency: false, gate: { date: FRI, accepted: true }, coolOff: 1 });
    ok('Cooling-off', 'cooling-off is still business days for normal jobs (accepted Fri + 1 = Mon)', g.date === MON, JSON.stringify(g));

    const sN = PQ.snapshot(mk(false), FRI), sE = PQ.snapshot(mk(true), FRI);
    ok('Quote', 'quote plan: normal job counts working days; emergency counts every day', sN.days === 6 && sE.days === 5 && sE.emergency === true && sE.finish === '2026-11-03' && sN.finish === '2026-11-06', JSON.stringify([sN.days, sN.finish, sE.days, sE.finish]));
    const pq = fs.readFileSync(path.join(SITE, 'netlify/lib/plan-quote.mjs'), 'utf8'), pdf = fs.readFileSync(path.join(SITE, 'netlify/lib/pdf.mjs'), 'utf8');
    ok('Quote', 'quote and PDF wording says weekends are included for emergency jobs', /weekends included/.test(pq) && /Saturday and Sunday where needed/.test(pq) && /Emergency job: dates include Saturday and Sunday/.test(pdf));

    // ---------- 2. the console planner shows the same dates ----------
    const core = await J.nextCore('W');
    await J.create({ core, name: 'Wendy Weekend', phone: '0400 123 999', email: '', suburb: 'Box Hill', service: 'Leak', urgency: 'Emergency', source: 'chat', summary: 'Burst pipe, water through the ceiling.' });
    br = await chromium.launch();
    const p = await (await br.newContext({ viewport: { width: 1500, height: 950 } })).newPage(); p.setDefaultTimeout(10000);
    const errors = []; errorsAll = errors;
    p.on('pageerror', (e) => errors.push(e.message)); p.on('dialog', (x) => { errors.push('dialog: ' + x.message()); x.dismiss(); });
    await p.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
    await p.fill('[name=username]', 'sashi73'); await p.fill('[name=password]', 'sashi98'); await p.click('#loginForm button');
    await p.waitForSelector('#app:not([hidden])');
    await p.goto(`${BASE}/admin/#plan/${core}`); await p.waitForSelector('#tplEmerg');
    ok('Console', 'the new plan form says emergency work includes the weekend', await p.isChecked('#tplEmerg'));
    await p.selectOption('#tplType', 'plumb-leak'); await p.click('#tplCreate'); await p.waitForSelector('table.gt');
    const shown = async () => p.$$eval('input[data-k="snet"]', (xs) => xs.map((x) => x.value));
    const serverDates = async () => { const sp = P.schedule(JSON.parse(JSON.stringify(await kv.get('plan:' + core)))); return sp.tasks.map((t) => t.es); };
    let S1 = await shown(), V1 = await serverDates();
    ok('Console', 'emergency plan: the planner and the server agree on every start date', S1.length > 3 && JSON.stringify(S1) === JSON.stringify(V1), JSON.stringify([S1, V1]));
    ok('Console', 'the plan page says Saturday and Sunday are work days, and the Gantt has no weekend shading', /Saturday and Sunday are work days/.test(await p.textContent('.qgate')) && /Saturday and Sunday included/.test(await p.textContent('body')));
    // untick Emergency: back to Monday to Friday
    await p.uncheck('#pEmerg'); await sleep(400);
    const S2 = await shown();
    ok('Console', 'untick Emergency: no task starts on a weekend any more', S2.length && S2.every((d) => !d || !weekend(d)), JSON.stringify(S2));
    await p.check('#pEmerg'); await sleep(400);
    ok('Console', 'tick it again: the weekend dates come back', JSON.stringify(await shown()) === JSON.stringify(S1));
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close(); br = null;
  } catch (e) { try { if (br) await br.close(); } catch {} ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ')); }
  await cleanup();
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  if (pass !== results.length) console.log('\n--- server log ---\n' + log.slice(-2000));
  process.exit(0);
})();
