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
let toSql = null, toAnswer = null;
const mock = http.createServer((req, res) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => {
  const body = JSON.parse(Buffer.concat(c).toString() || '{}'), sys = body.messages[0].content, user = body.messages[1].content;
  let out = {};
  if (/Turn the question/.test(sys)) { toSql = JSON.parse(user); out = { sql: SQL, title: 'Cleaners in Western Sydney by preference', note: 'Cleaners based in or covering Western Sydney, best first.', chart: null }; }
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

    // Data explorer / SQL wizard know the table too
    const T = await p.evaluate(() => window.MBS.sqlState && Object.keys((window.MBS.sqlState.db || {}).tables || {}));
    const tabs = await p.evaluate(() => fetch('/.netlify/functions/admin', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-MBS-Admin': '1' }, body: JSON.stringify({ action: 'sqlData' }) }).then((r) => r.json()).then((d) => ({ s: Object.keys(d.schema), n: d.data.subcontractors.length })));
    ok('Tables', 'the SQL wizard has a subcontractors table with every subbie', tabs.s.includes('subcontractors') && tabs.n === 54, JSON.stringify(tabs));
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close(); br = null;
  } catch (e) { try { if (br) await br.close(); } catch {} ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ') + ' LOG: ' + log.slice(-500)); }
  try { srv.kill(); } catch {} try { mock.close(); } catch {} try { await blobs.stop(); } catch {}
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(0);
})();
