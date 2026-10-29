// v39-v41: new-plan page: Start date, Finish by and Emergency job in one row, with the remark that the AI can work out the end date.
// A Finish by date carries into the new plan. Stand-in AI, real Blobs, local site, Chromium.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const SITE = path.resolve(process.argv[2]);
const PORT = 8937, BASE = `http://127.0.0.1:${PORT}`;
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => results.push({ area, name, pass: !!pass, detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dmy = (x) => x.slice(8, 10) + '/' + x.slice(5, 7) + '/' + x.slice(0, 4);

const mock = http.createServer((req, res) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => {
  const plan = { emergency: false, name: 'Balcony edge concrete repair', objective: 'Repair the spalling and stop the rust.', in_scope: '- Repair', out_of_scope: '- Tiles', deliverables: '- Photos', acceptance: '- Sound edge', assumptions: '',
    tips: ['Check strata.'], risks: [['Hidden rust', 'more steel exposed', 3, 3, 'Mitigate', 'Allow for extra treatment']],
    tasks: [{ n: 'Site inspection', d: 1, after: [] }, { n: 'Quote accepted', d: 0, after: [1] }, { n: 'Break out loose concrete', d: 2, after: [2], q: 12, u: 'h', r: 80 },
      { n: 'Treat steel and patch', d: 3, after: [3], q: 18, u: 'h', r: 85 }, { n: 'Handover', d: 0, after: [4] }] };
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(plan) }, finish_reason: 'stop' }], usage: { total_tokens: 700 } }));
}); });

(async () => {
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-row-blobs'); fs.rmSync(dir, { recursive: true, force: true });
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
    const a = await J.nextCore('C'), b = await J.nextCore('C');
    await J.create({ core: a, name: 'Wes Westmead', phone: '0400 333 444', email: '', suburb: 'Westmead NSW 2145', service: 'Concrete spalling', source: 'phone', summary: 'Concrete spalling on the balcony edge with some rust showing through.' });
    await J.create({ core: b, name: 'Bea Box', phone: '0400 333 555', email: '', suburb: 'Box Hill NSW 2765', service: 'Concrete spalling', source: 'phone', summary: 'Concrete spalling on the balcony edge with some rust showing through.' });
    br = await chromium.launch();
    const p = await (await br.newContext({ viewport: { width: 1500, height: 950 } })).newPage(); p.setDefaultTimeout(15000);
    const errors = []; errorsAll = errors;
    p.on('pageerror', (e) => errors.push(e.message)); p.on('dialog', (x) => { errors.push('dialog: ' + x.message()); x.dismiss(); });
    await p.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
    await p.fill('[name=username]', 'sashi73'); await p.fill('[name=password]', 'sashi98'); await p.click('#loginForm button');
    await p.waitForSelector('#app:not([hidden])');

    // 1. the row
    await p.goto(`${BASE}/admin/#plan/${a}`); await p.waitForSelector('.pdates');
    const box = async (sel) => p.locator(sel).boundingBox();
    const s = await box('.dbox:has(#tplStart)'), f = await box('.dbox:has(#aiFinish)'), e = await box('.pdates .emergpick');
    ok('Row', 'Start date, Finish by and Emergency job sit side by side in one row', s && f && e && Math.abs(s.y - f.y) < 4 && f.x > s.x && e.x > f.x && Math.abs((e.y + e.height / 2) - (f.y + f.height / 2)) < 30, JSON.stringify([s, f, e].map((x) => x && [Math.round(x.x), Math.round(x.y)])));
    ok('Row', 'the row is above the three ways to build the plan', (await box('.pdates')).y < (await box('.tmodes')).y);
    ok('Remark', 'says the AI can work out the end date if Finish by is left empty', /Leave Finish by empty and choose Ask AI to build it: the AI works out the end date/.test((await p.textContent('.pdates-note')).replace(/\s+/g, ' ')));
    await p.screenshot({ path: path.join(__dirname, 'shot39-row.png'), clip: { x: 230, y: 0, width: 1270, height: 700 } });

    // 2. AI mode without a Finish by: the AI works out the end date
    await p.click('[data-mode=ai]');
    ok('AI', 'AI mode says the AI works out the end date (no Finish by set)', /the AI works out the end date/.test(await p.textContent('#modeBody')));
    await p.click('#aiGo'); await p.waitForSelector('.aifit', { timeout: 30000 });
    const d1 = await p.textContent('#aiOut');
    ok('AI', 'the draft says: "The AI worked out the end date: <date>"', /The AI worked out the end date: \d\d\/\d\d\/\d{4}/.test(d1), d1.slice(0, 200));
    await p.click('#tplCreate'); await p.waitForSelector('table.gt');
    const pa = await kv.get('plan:' + a);
    ok('AI', 'that plan has no Finish by (the AI chose the end date)', !pa.finishBy && pa.tasks.length >= 4);

    // 3. a Finish by date carries into the new plan (job type mode)
    await p.goto(`${BASE}/admin/#plan/${b}`); await p.waitForSelector('.pdates');
    const fb = P.addWork(P.nextWork(AI.sydToday()), 30);
    await p.fill('.dbox:has(#aiFinish) .dtext', dmy(fb)); await p.press('.dbox:has(#aiFinish) .dtext', 'Enter');
    await p.click('[data-mode=ai]');
    ok('AI', 'with a Finish by, AI mode says it fits the work between the two dates', /fits the work between the Start date and Finish by/.test(await p.textContent('#modeBody')));
    // v41: Finish by can't be before the Start date
    const st0 = await p.inputValue('#tplStart');
    ok('Order', 'new plan: Finish by greys out dates before the Start date', (await p.getAttribute('#aiFinish', 'min')) === st0);
    const before = P.addWork(st0, -0) > st0 ? st0 : st0;
    const bad = new Date(Date.parse(st0 + 'T00:00:00Z') - 3 * 864e5).toISOString().slice(0, 10);
    await p.fill('.dbox:has(#aiFinish) .dtext', dmy(bad)); await p.press('.dbox:has(#aiFinish) .dtext', 'Enter'); await sleep(400);
    ok('Order', 'new plan: a Finish by before the Start date is refused (cleared, with a message)', (await p.inputValue('#aiFinish')) === '' && /can't be before the Start date/.test(await p.textContent('#toast')));
    await p.fill('.dbox:has(#aiFinish) .dtext', dmy(fb)); await p.press('.dbox:has(#aiFinish) .dtext', 'Enter'); await sleep(300);
    await p.click('[data-mode=type]'); await p.waitForSelector('#tplType');
    await p.selectOption('#tplType', 'crack-repair'); await p.click('#tplCreate'); await p.waitForSelector('table.gt');
    const pb = await kv.get('plan:' + b);
    ok('Carry', 'the Finish by date is saved on the new plan, and noted in the assumptions', pb.finishBy === fb && /Customer wants it finished by/.test(pb.charter.assumptions), pb.finishBy);
    ok('Carry', 'the Schedule tab shows it straight away (on time or late)', /finish-by date/.test(await p.textContent('.fitbar')));
    // v41: Schedule tab keeps Project start <= Work starts <= Finish by
    await p.click('#planTabs >> text=Schedule').catch(() => {}); await p.waitForSelector('#pWork');
    ok('Order', 'Schedule: Work starts and Project start grey out dates after Finish by; Finish by greys out dates before the start', (await p.getAttribute('#pWork', 'max')) === fb && (await p.getAttribute('#pStart', 'max')) === fb && !!(await p.getAttribute('#pFinishBy', 'min')));
    const after = P.addWork(fb, 2);
    await p.fill('.dbox:has(#pWork) .dtext', dmy(after)); await p.press('.dbox:has(#pWork) .dtext', 'Enter'); await sleep(500);
    ok('Order', 'Schedule: a Work starts after Finish by is refused, with a message', !((await kv.get('plan:' + b)).workStart) && /can't start after your Finish by/.test(await p.textContent('#toast')));
    await p.fill('.dbox:has(#pStart) .dtext', dmy(after)); await p.press('.dbox:has(#pStart) .dtext', 'Enter'); await sleep(500);
    ok('Order', 'Schedule: a Project start after Finish by is refused, with a message', (await kv.get('plan:' + b)).start < fb && /project can't start after your Finish by/.test(await p.textContent('#toast')));
    const pb2 = await kv.get('plan:' + b);
    const early = new Date(Date.parse(pb2.start + 'T00:00:00Z') - 2 * 864e5).toISOString().slice(0, 10);
    await p.fill('.dbox:has(#pFinishBy) .dtext', dmy(early)); await p.press('.dbox:has(#pFinishBy) .dtext', 'Enter'); await sleep(500);
    ok('Order', 'Schedule: a Finish by before the start is refused, with a message', (await kv.get('plan:' + b)).finishBy === fb && /Finish by can't be before the/.test(await p.textContent('#toast')));
    // phone
    await p.setViewportSize({ width: 390, height: 844 }); await p.goto(`${BASE}/admin/#plan/${a}/schedule`); await sleep(600);
    ok('Phone', 'no sideways scrolling on a phone', (await p.evaluate(() => document.documentElement.scrollWidth)) <= 391);
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close(); br = null;
  } catch (e) { try { if (br) await br.close(); } catch {} ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ')); }
  try { srv.kill(); } catch {} try { mock.close(); } catch {} try { await blobs.stop(); } catch {}
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(0);
})();
