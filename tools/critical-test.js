// v43: ⚡ Critical path tab. Checks the float shown for every task against the server's own scheduler, a different way:
// making a task longer by its float must not move the finish, one day more must. Real Blobs, local site, Chromium.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const SITE = path.resolve(process.argv[2]);
const PORT = 8939, BASE = `http://127.0.0.1:${PORT}`;
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => results.push({ area, name, pass: !!pass, detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-crit-blobs'); fs.rmSync(dir, { recursive: true, force: true });
  const blobs = new BlobsServer({ directory: dir, token: 'tok', port: 0 });
  const { port: bport } = await blobs.start();
  const ctxB64 = Buffer.from(JSON.stringify({ siteID: 'mbs', token: 'tok', edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, apiURL: `http://localhost:${bport}` })).toString('base64');
  process.env.NETLIFY_BLOBS_CONTEXT = ctxB64;
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NETLIFY_BLOBS_CONTEXT: ctxB64, ADMIN_USERNAME: 'sashi73', ADMIN_PASSWORD: 'sashi98', LLM_API_KEY: '', TELEGRAM_BOT_TOKEN: '', RESEND_API_KEY: '' };
  const srv = spawn('node', ['local-server.mjs'], { cwd: SITE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 40 && !/running/.test(log); i++) await sleep(150);
  let br = null;
  try {
    const J = await import(path.join(SITE, 'netlify/lib/jobs.mjs'));
    const kv = await import(path.join(SITE, 'netlify/lib/kv.mjs'));
    const P = await import(path.join(SITE, 'netlify/lib/plan.mjs'));
    const core = await J.nextCore('O');
    await J.create({ core, name: 'Cara Crit', phone: '0400 888 111', email: '', suburb: 'Rouse Hill', service: 'Deck', source: 'phone', summary: 'New timber deck and pergola.' });
    br = await chromium.launch();
    const p = await (await br.newContext({ viewport: { width: 1500, height: 950 } })).newPage(); p.setDefaultTimeout(15000);
    const errors = []; errorsAll = errors;
    p.on('pageerror', (e) => errors.push(e.message)); p.on('dialog', (x) => { errors.push('dialog: ' + x.message()); x.dismiss(); });
    await p.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
    await p.fill('[name=username]', 'sashi73'); await p.fill('[name=password]', 'sashi98'); await p.click('#loginForm button');
    await p.waitForSelector('#app:not([hidden])');
    await p.goto(`${BASE}/admin/#plan/${core}`); await p.waitForSelector('#tplType');
    await p.selectOption('#tplType', 'deck-timber'); await p.click('#tplCreate'); await p.waitForSelector('table.gt');
    const saved = async () => { await p.waitForFunction(() => /Saved/.test((document.querySelector('#planSave') || {}).textContent || ''), null, { timeout: 15000 }); await sleep(300); };
    // make one branch run in parallel so some tasks have slack: the last work task before handover starts with the first work task
    let st = await kv.get('plan:' + core);

    const tabs = await p.$$eval('#planTabs .tab', (x) => x.map((a) => a.textContent.trim()));
    ok('Tab', '"⚡ Critical path" comes right after "Schedule & Gantt"', tabs.indexOf('⚡ Critical path') === tabs.findIndex((x) => /Schedule & Gantt/.test(x)) + 1, tabs.join(' | '));
    await p.click('#planTabs >> text=Critical path'); await p.waitForSelector('.cp-chain');
    ok('Tab', 'opens at #plan/<job>/critical', /\/critical$/.test(await p.evaluate(() => location.hash)));

    const check = async (label) => {
      st = await kv.get('plan:' + core);
      const S0 = P.schedule(JSON.parse(JSON.stringify(st))), F = S0.tasks.reduce((m, t) => (t.ef > m ? t.ef : m), '');
      const shown = await p.$$eval('.cp-table tbody tr', (rows) => rows.map((r) => ({ n: +r.cells[0].textContent, f: r.cells[5].querySelector('b').textContent, tag: r.cells[6].textContent })));
      ok(label, 'the slack table lists every task', shown.length === st.tasks.length, shown.length + ' vs ' + st.tasks.length);
      const bad = [];
      st.tasks.forEach((t, i) => {
        const s = shown.find((x) => x.n === i + 1); if (!s) { bad.push('#' + (i + 1) + ' missing'); return; }
        const f = parseInt(s.f, 10), open = /\+$/.test(s.f);
        const longer = (k) => { const q = JSON.parse(JSON.stringify(st)); const qt = q.tasks[i]; if (qt.dur === 0) { qt.snet = P.addWork(P.nextWork(S0.tasks[i].es, P.allDays(q)), k, P.allDays(q)); } else qt.dur += k; P.schedule(q); return q.tasks.reduce((m, x) => (x.ef > m ? x.ef : m), ''); };
        if (longer(f) !== F) bad.push(`#${i + 1} ${t.name}: +${f} moves the finish`);
        if (!open && longer(f + 1) === F) bad.push(`#${i + 1} ${t.name}: +${f + 1} still does not move the finish`);
        if ((f === 0) !== /^Critical$/.test(s.tag)) bad.push(`#${i + 1} tag ${s.tag} for float ${f}`);
      });
      ok(label, 'every task\'s slack is right: longer by its slack keeps the finish, one day more moves it', bad.length === 0, bad.slice(0, 5).join('; '));
      const crit = shown.filter((x) => x.f === '0');
      ok(label, 'the critical chain shows exactly the critical tasks, and the last task to finish is one of them', (await p.$$eval('.cp-box', (x) => x.length)) === crit.length && crit.some((x) => S0.tasks[x.n - 1].ef === F));
      ok(label, 'the timeline has a bar or diamond for every task, critical ones in red', (await p.$$eval('.cp-row', (x) => x.length)) === st.tasks.length && (await p.$$eval('.cp-tl .cp-bar.crit, .cp-tl .cp-mile.crit', (x) => x.length)) === crit.length);
      return shown;
    };
    let s1 = await check('Weekdays');

    // make some slack: put one mid-plan task in parallel (start set by hand at the project start)
    await p.click('#planTabs >> text=Schedule'); await p.waitForSelector('table.gt');
    st = await kv.get('plan:' + core);
    const idx = st.tasks.findIndex((t) => /Stairs|balustrade/i.test(t.name));
    const tid = st.tasks[idx >= 0 ? idx : 6].id;
    await p.fill(`tr[data-tid="${tid}"] .dbox .dtext`, (() => { const d = P.schedule(JSON.parse(JSON.stringify(st))).tasks.find((t) => /Bearers/i.test(t.name)) || st.tasks[4]; return d.es.slice(8, 10) + '/' + d.es.slice(5, 7) + '/' + d.es.slice(0, 4); })());
    await p.press(`tr[data-tid="${tid}"] .dbox .dtext`, 'Enter'); await saved();
    await p.click('#planTabs >> text=Critical path'); await p.waitForSelector('.cp-chain');
    const s2 = await check('Parallel task');
    ok('Parallel task', 'after running a task alongside, some tasks have slack and show the dotted "can slip" tail', s2.some((x) => x.f !== '0') && (await p.$$eval('.cp-tl .cp-slack', (x) => x.length)) > 0, JSON.stringify(s2.map((x) => x.f)));

    // weekends allowed: the units change and the checks still hold
    await p.click('#planTabs >> text=Schedule'); await p.waitForSelector('#pWeek'); await p.check('#pWeek'); await saved();
    await p.click('#planTabs >> text=Critical path'); await p.waitForSelector('.cp-chain');
    await check('Weekends');
    ok('Weekends', 'with weekends allowed, slack is counted in days (weekends included)', /weekends included/.test(await p.textContent('#planBody')));
    await p.screenshot({ path: path.join(__dirname, 'shot43-critical.png'), fullPage: true });
    await p.setViewportSize({ width: 390, height: 844 }); await sleep(500);
    ok('Phone', 'no sideways scrolling on a phone', (await p.evaluate(() => document.documentElement.scrollWidth)) <= 391);
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close(); br = null;
  } catch (e) { try { if (br) await br.close(); } catch {} ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ')); }
  try { srv.kill(); } catch {} try { await blobs.stop(); } catch {}
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(0);
})();
