// v49: Ask AI about sub-contractors, e.g. "List me all subbies - cleaners in Western Sydney, sorted by preference,
// show licence and insurance and flag expired". A stand-in AI writes the SQL; the query runs in the browser on the real
// subcontractors table. Checks the AI is told about the table, regions and preference order, the right subbies come back
// in the right order, expired papers are flagged, and no phone, email or contact name goes to the AI.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const SITE = path.resolve(process.argv[2]);
const PORT = 8949, BASE = `http://127.0.0.1:${PORT}`;
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => results.push({ area, name, pass: !!pass, detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SQL = "SELECT business, compliance, problems, trade, suburb, region, status, rating, licence_no, licence_expiry, licence_state, pl_expiry, pl_state, wc_expiry, wc_state FROM subcontractors " +
  "WHERE archived = false AND (LOWER(trade) LIKE '%clean%' OR LOWER(other_trades) LIKE '%clean%') AND (western_sydney = true OR LOWER(areas_covered) LIKE '%western sydney%' OR LOWER(areas_covered) LIKE '%greater sydney%') " +
  'ORDER BY preference_rank, rating DESC';
let toSql = null, toAnswer = null; const asked = [];
// other kinds of questions about subbies, with the SQL a good answer needs
const MORE = [
  { re: /no one for/, title: 'Trades with nobody', sql: 'SELECT trade, licence_needed FROM sub_trades WHERE subbies = 0 ORDER BY trade' },
  { re: /Average rating/, title: 'Average rating by trade', sql: 'SELECT trade, subbies, avg_rating FROM sub_trades WHERE subbies > 0 ORDER BY avg_rating DESC, trade' },
  { re: /haven't we used/, title: 'Not used in 6 months', sql: 'SELECT business, trade, last_used, days_since_used FROM subcontractors WHERE archived = false AND (days_since_used IS NULL OR days_since_used > 182) ORDER BY days_since_used DESC' },
  { re: /next 90 days/, title: 'Insurance expiring in 90 days', sql: "SELECT business, trade, pl_expiry, pl_state FROM subcontractors WHERE archived = false AND pl_expiry BETWEEN '@T' AND '@T60' ORDER BY pl_expiry" },
  { re: /working on job/, title: 'Subbies on the job', sql: "SELECT s.business, s.trade, ps.role, ps.raci, s.compliance FROM plan_stakeholders ps JOIN subcontractors s ON ps.sub_id = s.id WHERE ps.job = '@JOB'" },
  { re: /sparky/, title: 'Electricians in the Hills', sql: "SELECT business, suburb, status, rating, compliance FROM subcontractors WHERE archived = false AND (LOWER(trade) LIKE '%electric%' OR LOWER(other_trades) LIKE '%electric%') AND region = 'Hills District' ORDER BY preference_rank, rating DESC" },
];
const mock = http.createServer((req, res) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => {
  const body = JSON.parse(Buffer.concat(c).toString() || '{}'), sys = body.messages[0].content, user = body.messages[1].content;
  let out = {};
  if (/Turn the question/.test(sys)) {
    toSql = JSON.parse(user); asked.push(toSql);
    const m = MORE.find((x) => x.re.test(toSql.q));
    out = m ? { sql: m.sql, title: m.title, note: '', chart: null } : { sql: SQL, title: 'Cleaners in Western Sydney by preference', note: 'Cleaners based in or covering Western Sydney, best first.', chart: null };
  }
  else { toAnswer = user; out = { answer: 'You have 4 cleaners for Western Sydney. One has expired public liability insurance.' }; }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(out) }, finish_reason: 'stop' }], usage: { total_tokens: 700 } }));
}); });

(async () => {
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-asksub-blobs'); fs.rmSync(dir, { recursive: true, force: true });
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
    const SB = await import(path.join(SITE, 'netlify/lib/subbies.mjs'));
    const R = await import(path.join(SITE, 'netlify/lib/sydney-regions.mjs'));
    const DATA = JSON.parse(fs.readFileSync(path.join(SITE, 'tools/test-data/subcontractors-50.json'))).subs;
    const t0 = new Date(Date.now() + 11 * 3600e3), day = (n) => new Date(t0.getTime() + n * 864e5).toISOString().slice(0, 10);
    const fix = (s) => ({ ...s, licence: { ...s.licence, expiry: s.licence.expiryDays == null ? '' : day(s.licence.expiryDays) }, insurance: { ...s.insurance, expiry: day(s.insurance.expiryDays) },
      workersComp: { ...s.workersComp, expiry: s.workersComp.expiryDays == null ? '' : day(s.workersComp.expiryDays) } });
    for (const s of DATA) await SB.saveSub(fix(s), 'test');
    // a known picture for cleaners: one expired, one in the Eastern Suburbs (left out), one archived (left out), one covering Western Sydney from outside
    const add = (o) => SB.saveSub(fix({ ...DATA.find((s) => s.trade === 'cleaner'), ...o }), 'test');
    await add({ business: 'Expired Clean Co', suburb: 'Blacktown', status: 'Preferred', rating: 5, phone: '02 5550 3201', insurance: { insurer: 'X', policy: 'P1', cover: 1, expiryDays: -3 } });
    await add({ business: 'Bondi Shine Cleaning', suburb: 'Bondi', areas: 'Eastern Suburbs', status: 'Preferred', rating: 5, phone: '02 5550 3202' });
    await add({ business: 'Old Archived Cleaners', suburb: 'Penrith', archived: true, phone: '02 5550 3203' });
    await add({ business: 'Northside Cleaners', suburb: 'Chatswood', areas: 'North Shore, Western Sydney', status: 'Approved', rating: 3, phone: '02 5550 3204' });
    const all = (await SB.list()).subs.filter((s) => !s.archived && (s.trade === 'cleaner' || (s.trades || []).includes('cleaner')));
    const expect = all.filter((s) => R.regionOf(s.suburb).western || /western sydney|greater sydney/i.test(s.areas || ''));
    const RANK = { Preferred: 1, Approved: 2, 'On trial': 3, 'On hold': 4, 'Do not use': 5 };
    expect.sort((a, b) => RANK[a.status] - RANK[b.status] || b.rating - a.rating);

    br = await chromium.launch();
    const p = await (await br.newContext({ viewport: { width: 1500, height: 950 } })).newPage(); p.setDefaultTimeout(20000);
    const errors = []; errorsAll = errors;
    p.on('pageerror', (e) => errors.push(e.message)); p.on('dialog', (x) => { errors.push('dialog: ' + x.message()); x.dismiss(); });
    await p.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
    await p.fill('[name=username]', 'sashi73'); await p.fill('[name=password]', 'sashi98'); await p.click('#loginForm button');
    await p.waitForSelector('#app:not([hidden])');
    await p.click('[data-nav=ask]'); await p.waitForSelector('#askQ');
    await p.fill('#askQ', 'List me all subbies - cleaners in Western Sydney and sort it by preference - indicate the licence and insurance, flag if it is expired'); await p.click('#askGo');
    await p.waitForFunction(() => { const b = document.querySelector('#askGo'); return b && !b.disabled && document.querySelector('#askOut .ask-a') && !document.querySelector('#askOut .ask-think'); });
    ok('AI', 'the AI is given the subcontractors table with licence, insurance, region and preference columns', toSql && /subcontractors\(/.test(toSql.tables) && /licence_state/.test(toSql.tables) && /pl_state/.test(toSql.tables) && /western_sydney/.test(toSql.tables) && /preference_rank/.test(toSql.tables), toSql && toSql.tables.slice(0, 200));
    ok('AI', 'and told what "Western Sydney", "by preference" and "expired" mean', toSql && /Western Sydney/.test(toSql.notes) && /ORDER BY preference_rank, rating DESC/.test(toSql.notes) && /business, compliance, problems/.test(toSql.notes));
    ok('AI', 'the trade names of the subbies are in the hints', toSql && (toSql.values.sub_trades || []).some((t) => /Cleaner/.test(t)), JSON.stringify(toSql && toSql.values));
    const st = await p.evaluate(() => ({ rows: window.MBS.sqlState.rows, cols: window.MBS.sqlState.cols }));
    const names = (st.rows || []).map((r) => r.business);
    ok('Result', 'the query runs and lists exactly the Western Sydney cleaners, best first', JSON.stringify(names) === JSON.stringify(expect.map((s) => s.business)), names.join(', ') + ' vs ' + expect.map((s) => s.business).join(', '));
    ok('Result', 'Eastern Suburbs and archived cleaners are left out; one covering Western Sydney from Chatswood is in', !names.includes('Bondi Shine Cleaning') && !names.includes('Old Archived Cleaners') && names.includes('Northside Cleaners'));
    const ex = (st.rows || []).find((r) => r.business === 'Expired Clean Co');
    ok('Result', 'the expired public liability shows as expired', ex && ex.pl_state === 'expired' && ex.compliance === 'expired' && /Public liability: expired/.test(ex.problems), JSON.stringify(ex));
    await p.waitForSelector('#resBody table');
    const exRow = await p.$$eval('#resBody tbody tr', (x) => x.filter((r) => /Expired Clean Co/.test(r.textContent)).map((r) => ({ cls: r.className, txt: r.textContent, red: !!r.querySelector('.sq-bad') })));
    ok('Flag', 'expired papers are flagged on screen: the row is highlighted and shows ⚠ EXPIRED in red', exRow.length === 1 && /sq-exp/.test(exRow[0].cls) && /⚠ EXPIRED/.test(exRow[0].txt) && exRow[0].red, JSON.stringify(exRow));
    ok('Flag', 'subbies with papers due soon show "due soon", good ones "✓ ok"', /✓ ok/.test(await p.textContent('#resBody')));
    ok('Privacy', 'no phone numbers, emails or contact names go to the AI', toAnswer && !/02 5550|example\.com|"contact"/.test(toAnswer + JSON.stringify(toSql)), (toAnswer || '').slice(0, 300));
    await p.screenshot({ path: path.join(__dirname, 'shot49-ask-subbies.png'), fullPage: true });

    // other kinds of subbie questions: each reaches the right tables and the query gives the right answer
    const T0 = new Date(Date.now() + 11 * 3600e3).toISOString().slice(0, 10), T60 = new Date(Date.now() + 11 * 3600e3 + 90 * 864e5).toISOString().slice(0, 10);
    MORE.forEach((m) => { m.sql = m.sql.replace(/@T60/g, T60).replace(/@T/g, T0); });
    const ask = async (q) => {
      await p.fill('#askQ', q); await p.click('#askGo');
      await p.waitForFunction(() => { const b = document.querySelector('#askGo'); return b && !b.disabled && document.querySelector('#askOut .ask-a') && !document.querySelector('#askOut .ask-think'); });
      return { rows: await p.evaluate(() => window.MBS.sqlState.rows), err: await p.$('#askOut .ask-ans.err'), sent: asked[asked.length - 1] };
    };
    const live = (await SB.list()).subs.filter((s) => !s.archived), act = live.filter((s) => s.status !== 'Do not use');
    let a = await ask('Which trades do we have no one for?');
    const none = SB.TRADES.filter(([k]) => !act.some((s) => s.trade === k || (s.trades || []).includes(k))).map((x) => x[1]).sort();
    ok('More', '"Which trades do we have no one for?" lists every trade with no subbie', !a.err && /sub_trades\(/.test(a.sent.tables) && JSON.stringify(a.rows.map((r) => r.trade)) === JSON.stringify(none), a.rows.map((r) => r.trade).join(', ') + ' vs ' + none.join(', '));
    a = await ask('Average rating by trade');
    const plumb = act.filter((s) => (s.trade === 'plumber' || (s.trades || []).includes('plumber')) && s.rating), avgP = Math.round(plumb.reduce((x, s) => x + s.rating, 0) / plumb.length * 100) / 100;
    ok('More', '"Average rating by trade" works out the average per trade', !a.err && (a.rows.find((r) => r.trade === 'Plumber') || {}).avg_rating === avgP, JSON.stringify(a.rows.find((r) => r.trade === 'Plumber')) + ' vs ' + avgP);
    a = await ask("Who haven't we used in 6 months?");
    const t6 = live.filter((s) => !s.lastUsed || (Date.parse(T0) - Date.parse(s.lastUsed)) / 864e5 > 182).length;
    ok('More', '"Who haven\'t we used in 6 months?" reaches the subbies and counts right', !a.err && /subcontractors\(/.test(a.sent.tables) && a.rows.length === t6 && t6 > 0, a.rows.length + ' vs ' + t6);
    a = await ask('Which tradies have their insurance running out in the next 90 days?');
    const e60 = live.filter((s) => s.plExpiry >= T0 && s.plExpiry <= T60).length;
    ok('More', '"insurance running out in the next 90 days" uses the dates', !a.err && a.rows.length === e60 && e60 > 0, a.rows.length + ' vs ' + e60);
    a = await ask('Find me a sparky in the Hills');
    const hillsE = act.filter((s) => (s.trade === 'electrician' || (s.trades || []).includes('electrician')) && R.regionOf(s.suburb).region === 'Hills District').length;
    ok('More', '"Find me a sparky in the Hills" (slang and region)', !a.err && /subcontractors\(/.test(a.sent.tables) && a.rows.length === hillsE && hillsE > 0, a.rows.length + ' vs ' + hillsE);
    // a project with a subbie on it
    const J = await import(path.join(SITE, 'netlify/lib/jobs.mjs')), core = await J.nextCore('B');
    await J.create({ core, name: 'Bea Bath', phone: '0400 333 444', email: '', suburb: 'Castle Hill', service: 'Bathroom', source: 'phone', summary: 'New bathroom.' });
    await p.goto(`${BASE}/admin/#plan/${core}`); await p.waitForSelector('#tplType'); await p.selectOption('#tplType', { index: 1 }); await p.click('#tplCreate'); await p.waitForSelector('table.gt');
    await p.click('#planTabs >> text=Stakeholders'); await p.waitForSelector('#skSub'); await p.waitForFunction(() => document.querySelectorAll('#skSub option').length > 5);
    const hp = live.find((s) => s.business === 'Hills Plumbing Services'); await p.selectOption('#skSub', hp.id);
    await p.waitForFunction(() => /Saved/.test((document.querySelector('#planSave') || {}).textContent || ''), null, { timeout: 15000 }); await sleep(300);
    MORE.find((m) => /working on/.test(m.re.source)).sql = MORE.find((m) => /working on/.test(m.re.source)).sql.replace('@JOB', core);
    await p.goto(`${BASE}/admin/#sql/ask`); await p.reload(); await p.waitForSelector('#askQ');   // fresh data (the page keeps it for 5 minutes)
    a = await ask('Which subbies are working on job ' + core + '?');
    ok('More', '"Which subbies are working on job …?" joins the project stakeholders to the subbies', !a.err && /plan_stakeholders\(/.test(a.sent.tables) && a.rows.length === 1 && a.rows[0].business === 'Hills Plumbing Services' && a.rows[0].raci === 'R', JSON.stringify(a.rows));

    // Data explorer / SQL wizard know the table too
    const T = await p.evaluate(() => window.MBS.sqlState && Object.keys((window.MBS.sqlState.db || {}).tables || {}));
    const tabs = await p.evaluate(() => fetch('/.netlify/functions/admin', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-MBS-Admin': '1' }, body: JSON.stringify({ action: 'sqlData' }) }).then((r) => r.json()).then((d) => ({ s: Object.keys(d.schema), n: d.data.subcontractors.length })));
    ok('Tables', 'the SQL wizard has subcontractors (every subbie), sub_trades (all 33 trades) and plan_stakeholders tables', tabs.s.includes('subcontractors') && tabs.n === 54 && tabs.s.includes('sub_trades') && tabs.s.includes('plan_stakeholders'), JSON.stringify(tabs));
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close(); br = null;
  } catch (e) { try { if (br) await br.close(); } catch {} ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ') + ' LOG: ' + log.slice(-500)); }
  try { srv.kill(); } catch {} try { mock.close(); } catch {} try { await blobs.stop(); } catch {}
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(0);
})();
