// v56: (1) the project plan fits a 14" laptop, (2) the AI plan can use 10,000 tokens and covers every phase of a big project
// (with model / length fallbacks and a cut-off rescue), (3) a task can use many stock items, each with its own quantity.
// Real Blobs, local site, Chromium, stand-in AI.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const SITE = path.resolve(process.argv[2]);
const PORT = 8956, BASE = `http://127.0.0.1:${PORT}`;
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => results.push({ area, name, pass: !!pass, detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// stand-in DeepSeek: refuses "deepseek-chat" and more than 8192 tokens first (like a changed API), then answers
const seen = []; let mode = 'big';
const PH = ['Feasibility & design', 'Approvals & procurement', 'Site & civil works', 'Data hall 1 build', 'Data hall 2 build', 'Power & cooling', 'Commissioning & handover'];
const bigPlan = () => { const tasks = []; PH.forEach((ph, k) => { for (let i = 0; i < 9; i++) tasks.push({ ph, n: `${ph}: step ${i + 1}`, d: 5, after: tasks.length ? [tasks.length] : [], q: 1, u: 'lot', r: 1000, s: [] }); });
  return { emergency: false, name: '100 MW data centre campus', objective: 'Build the campus', in_scope: '- all', out_of_scope: '', deliverables: '', acceptance: '', assumptions: '', tips: ['Order transformers early'], tasks, risks: [['Grid connection delay', 'Utility', 4, 5, 'Mitigate', 'Apply early']] }; };
const mock = http.createServer((req, res) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => {
  const body = JSON.parse(Buffer.concat(c).toString() || '{}'); seen.push({ model: body.model, max: body.max_tokens, sys: body.messages[0].content, user: body.messages[1].content });
  const send = (st, o) => { res.writeHead(st, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (body.model === 'deepseek-chat') return send(400, { error: { message: 'Model Not Exist' } });
  if (body.max_tokens > 8192 && mode === 'limit') return send(400, { error: { message: 'Invalid max_tokens value, the valid range of max_tokens is [1, 8192]' } });
  let txt = JSON.stringify(bigPlan()), fin = 'stop';
  if (mode === 'cut') { txt = txt.slice(0, Math.floor(txt.length * 0.6)); fin = 'length'; }
  send(200, { choices: [{ message: { content: txt }, finish_reason: fin }], usage: { total_tokens: 9800 } });
}); });

(async () => {
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-v56-blobs'); fs.rmSync(dir, { recursive: true, force: true });
  const blobs = new BlobsServer({ directory: dir, token: 'tok', port: 0 });
  const { port: bport } = await blobs.start();
  const ctxB64 = Buffer.from(JSON.stringify({ siteID: 'mbs', token: 'tok', edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, apiURL: `http://localhost:${bport}` })).toString('base64');
  process.env.NETLIFY_BLOBS_CONTEXT = ctxB64;
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NETLIFY_BLOBS_CONTEXT: ctxB64, ADMIN_USERNAME: 'sashi73', ADMIN_PASSWORD: 'sashi98',
    LLM_API_KEY: 'test', LLM_BASE_URL: `http://127.0.0.1:${mock.address().port}`, LLM_MODEL: 'deepseek-chat', TELEGRAM_BOT_TOKEN: '', RESEND_API_KEY: '' };
  process.env.LLM_API_KEY = 'test'; process.env.LLM_BASE_URL = env.LLM_BASE_URL; process.env.LLM_MODEL = 'deepseek-chat';
  const srv = spawn('node', ['local-server.mjs'], { cwd: SITE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 40 && !/running/.test(log); i++) await sleep(150);
  let br = null;
  try {
    const J = await import(path.join(SITE, 'netlify/lib/jobs.mjs')), kv = await import(path.join(SITE, 'netlify/lib/kv.mjs'));
    const INV = await import(path.join(SITE, 'netlify/lib/inventory.mjs')), P = await import(path.join(SITE, 'netlify/lib/plan.mjs'));
    const sup = (await INV.saveSupplier({ name: 'Paint Depot' }, 't')).supplier;
    const paint = (await INV.saveItem({ name: 'Paint 10L', unit: 'tin', onHand: 10, reorderLevel: 2, prices: [{ supplier: sup.id, price: 80 }], preferred: sup.id }, 't')).item;
    const roller = (await INV.saveItem({ name: 'Roller kit', unit: 'each', onHand: 5, prices: [{ supplier: sup.id, price: 15 }], preferred: sup.id }, 't')).item;
    const tape = (await INV.saveItem({ name: 'Masking tape', unit: 'roll', onHand: 20, prices: [{ supplier: sup.id, price: 4 }], preferred: sup.id }, 't')).item;

    br = await chromium.launch();
    const ctx = await br.newContext({ viewport: { width: 1366, height: 650 } });
    const p = await ctx.newPage(); p.setDefaultTimeout(20000);
    const errors = []; errorsAll = errors;
    p.on('pageerror', (e) => errors.push(e.message)); p.on('dialog', (x) => { errors.push('dialog: ' + x.message()); x.dismiss(); });
    await p.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
    await p.fill('[name=username]', 'sashi73'); await p.fill('[name=password]', 'sashi98'); await p.click('#loginForm button');
    await p.waitForSelector('#app:not([hidden])');
    const saved = async () => { await p.waitForFunction(() => /Saved/.test((document.querySelector('#planSave') || {}).textContent || ''), null, { timeout: 15000 }); await sleep(350); };

    // ---- 3. materials ----
    const core = await J.nextCore('M');
    await J.create({ core, name: 'Mia Paint', phone: '0400 555 777', email: '', suburb: 'Kellyville', service: 'Painting', source: 'phone', summary: 'Paint the lounge.' });
    await p.goto(`${BASE}/admin/#plan/${core}`); await p.waitForSelector('#tplType'); await p.selectOption('#tplType', { index: 1 }); await p.click('#tplCreate'); await p.waitForSelector('table.gt');
    let st = await kv.get('plan:' + core); const t3 = st.tasks[3];
    const row = `tr[data-tid="${t3.id}"]`;
    await p.click(`${row} [data-pick]`); await p.waitForSelector('#mtList [data-madd]');
    ok('Materials', 'the 📦 button opens a materials list with the stock to add from', /Materials for/.test(await p.textContent('#modalBody')) && (await p.$$eval('#mtList [data-madd]', (x) => x.length)) === 3);
    await p.click(`#mtList [data-madd="${paint.id}"]`); await p.fill('#mtRows tr[data-mk="0"] [data-mqty]', '4'); await p.press('#mtRows tr[data-mk="0"] [data-mqty]', 'Tab');
    await p.click(`#mtList [data-madd="${roller.id}"]`); await p.click('#mtRows tr[data-mk="1"] [data-mq="1"]');
    await p.click(`#mtList [data-madd="${tape.id}"]`); await p.click('#mtRows tr[data-mk="2"] [data-mdel]');
    const tot = await p.textContent('#mtRows tfoot');
    ok('Materials', 'many items, each with its own quantity (4 × paint, 2 × roller kit, one removed): total $350', /\$350\.00/.test(tot), tot);
    await p.click('#mtSave'); await saved();
    st = await kv.get('plan:' + core); const T = st.tasks.find((x) => x.id === t3.id);
    ok('Materials', 'saved on the task with quantities and prices', T.mats.length === 2 && T.mats[0].item === paint.id && T.mats[0].qty === 4 && T.mats[0].price === 80 && T.mats[1].qty === 2, JSON.stringify(T.mats));
    ok('Materials', 'the task cost = its own qty × rate + the materials', P.taskCost(T) === Math.round(((T.qty || 0) * (T.rate || 0) + 350) * 100) / 100, P.taskCost(T) + ' ' + T.qty + 'x' + T.rate);
    ok('Materials', 'the task shows "📦 2 items · $350.00"', /📦 2 items · \$350\.00/.test(await p.textContent(row)));
    let alloc = await INV.allocations([paint.id, roller.id]);
    ok('Stock', 'while the task is open, 4 tins and 2 roller kits are set aside', alloc[paint.id].qty === 4 && alloc[roller.id].qty === 2, JSON.stringify(alloc));
    await p.check(`${row} input[type=checkbox]`); await saved(); await sleep(500);
    ok('Stock', 'marking the task Done takes them out of stock (10 → 6 tins, 5 → 3 kits)', (await kv.get('inv:' + paint.id)).onHand === 6 && (await kv.get('inv:' + roller.id)).onHand === 3, (await kv.get('inv:' + paint.id)).onHand + ' / ' + (await kv.get('inv:' + roller.id)).onHand);
    await p.uncheck(`${row} input[type=checkbox]`); await saved(); await sleep(500);
    ok('Stock', 'reopening the task gives them back', (await kv.get('inv:' + paint.id)).onHand === 10 && (await kv.get('inv:' + roller.id)).onHand === 5);
    // an older plan with one stock item on a task: converted, same cost
    const legacy = JSON.parse(JSON.stringify(await kv.get('plan:' + core))); const L = legacy.tasks[1]; L.mats = []; L.item = tape.id; L.qty = 3; L.rate = 4; L.unit = 'roll';
    await kv.set('plan:' + core, legacy); await p.reload(); await p.waitForSelector('table.gt');
    ok('Older plans', 'a task from an older plan with one stock item shows it as a 1-line list with the same cost ($12)', /📦 3 × Masking tape/.test(await p.textContent(`tr[data-tid="${L.id}"]`)) && /\$12\.00/.test(await p.evaluate((id) => document.querySelector(`tr[data-tid="${id}"]`).textContent, L.id)) || P.taskCost(L) === 12);
    ok('Older plans', 'the server converts it the same way', (() => { const c = P.taskCost({ item: tape.id, qty: 3, rate: 4 }); return c === 12; })());
    await p.click('#planTabs >> text=Overview'); await p.waitForSelector('#planBody');
    ok('Materials', 'the Overview "Materials from stock" lists each item', /Paint 10L/.test(await p.textContent('#planBody')) && /Roller kit/.test(await p.textContent('#planBody')));
    // quote lines include the materials
    const Q = await import(path.join(SITE, 'netlify/lib/plan-quote.mjs')); const pl = await kv.get('plan:' + core); pl.matNames = { [paint.id]: 'Paint 10L', [roller.id]: 'Roller kit' };
    const lines = Q.linesFromPlan(pl, {}); const ln = lines.find((x) => /materials: 4 x Paint 10L, 2 x Roller kit/.test(x.desc));
    ok('Quote', 'the quote line for the task includes its materials at the full cost', ln && ln.qty === 1 && ln.price === P.taskCost(pl.tasks.find((x) => x.id === t3.id)), JSON.stringify(lines.slice(0, 5)).slice(0, 300));

    // ---- 1. fits a 14" laptop ----
    await p.click('#planTabs >> text=Schedule'); await p.waitForSelector('table.gt'); await sleep(400);
    const lay = await p.evaluate(() => ({ top: document.querySelector('table.gt').getBoundingClientRect().top, row: document.querySelector('table.gt tbody tr').getBoundingClientRect().height, sw: document.documentElement.scrollWidth, tabs: document.querySelector('#planTabs').getBoundingClientRect().height }));
    ok('Laptop', 'on a 14" laptop (1366 × 650 visible) the schedule starts in the top 420 px, with ~35 px rows, tabs on one line, no sideways scroll', lay.top < 420 && lay.row <= 36 && lay.tabs < 40 && lay.sw <= 1366, JSON.stringify(lay));
    await p.screenshot({ path: path.join(__dirname, 'shot56-laptop.png') });
    await p.setViewportSize({ width: 1536, height: 750 }); await sleep(400);
    const lay2 = await p.evaluate(() => ({ top: document.querySelector('table.gt').getBoundingClientRect().top, row: document.querySelector('table.gt tbody tr').getBoundingClientRect().height }));
    ok('Laptop', 'same at 1536 × 750 (14" at 125%)', lay2.top < 400 && lay2.row <= 36, JSON.stringify(lay2));
    await p.setViewportSize({ width: 1920, height: 1080 }); await sleep(400);
    const lay3 = await p.evaluate(() => ({ row: document.querySelector('table.gt tbody tr').getBoundingClientRect().height }));
    ok('Big screen', 'a big screen keeps the roomier layout', lay3.row > 36, JSON.stringify(lay3));
    await p.setViewportSize({ width: 1366, height: 650 }); await sleep(300);
    await p.hover(`${row} input[data-k=name]`); await sleep(150);
    ok('Laptop', '"+ sub-task" appears when you point at a task (no extra line)', (await p.$eval(`${row} .subadd`, (b) => getComputedStyle(b).opacity)) === '1');

    // ---- 2. AI plan: 10,000 tokens, every phase, fallbacks ----
    const core2 = await J.nextCore('D');
    await J.create({ core: core2, name: 'Dana Data', phone: '0400 999 000', email: '', suburb: 'Eastern Creek', service: 'Data centre', source: 'phone', summary: 'Build a data centre campus.' });
    const aiPlan = async () => {
      await p.goto(`${BASE}/admin/#plan/${core2}`); await p.waitForSelector('[data-mode=ai]'); await p.click('[data-mode=ai]'); await p.waitForSelector('#aiDescribe');
      await p.fill('#aiDescribe', 'Plan a 100 MW data centre campus in Western Sydney: two data halls, substation, cooling plant, fibre, commissioning. ' + 'x'.repeat(2500));
      const n0 = seen.length; await p.click('#aiGo'); await p.waitForSelector('#tplCreate:not([disabled])', { timeout: 60000 }).catch(() => {}); await p.waitForFunction(() => /AI plan ready|ran out of room/.test(document.body.textContent) || document.querySelector('.tplprev'), null, { timeout: 60000 });
      return seen.slice(n0);
    };
    mode = 'limit';
    let calls = await aiPlan();
    ok('AI plan', 'asks for up to 10,000 tokens', calls[0].max === 10000, calls.map((c) => c.model + ':' + c.max).join(' '));
    ok('AI plan', 'if "deepseek-chat" is refused it switches to deepseek-flash, and if 10,000 is too many it uses the largest allowed (8192)', calls.some((c) => c.model === 'deepseek-flash' && c.max === 8192) && calls[calls.length - 1].model === 'deepseek-flash', calls.map((c) => c.model + ':' + c.max).join(' '));
    ok('AI plan', 'the AI is told to cover EVERY phase of a big project, and gets the long description (over 1,500 characters)', /MUST cover EVERY phase/.test(calls[0].sys) && /Never stop after phase 1/.test(calls[0].sys) && JSON.parse(calls[calls.length - 1].user).description.length > 2000);
    const prev = await p.textContent('.tplprev');
    ok('AI plan', 'all 63 tasks across 7 phases come back, with a ✓ milestone at the end of each phase', /70 tasks/.test(prev) && (prev.match(/✓ Phase \d complete/g) || []).length === 7 && /Phase 7 complete: Commissioning & handover/.test(prev), (prev.match(/\d+ tasks/) || [''])[0]);
    await p.click('#tplCreate'); await p.waitForSelector('table.gt'); await sleep(500);
    const big = await kv.get('plan:' + core2), m7 = big.tasks.find((x) => /Phase 7 complete/.test(x.name)), last7 = big.tasks.filter((x) => /Commissioning & handover: step 9/.test(x.name))[0];
    ok('AI plan', 'the plan is created: phase milestones wait for the phase\'s last task', big.tasks.length === 70 && m7 && m7.dur === 0 && m7.pred.includes(last7.id), big.tasks.length);
    // a reply cut off by the token limit: the part that came back is kept, with a warning
    mode = 'cut'; await kv.del('plan:' + core2);
    calls = await aiPlan();
    const prev2 = await p.textContent('.tplprev').catch(() => '');
    ok('AI plan', 'if the reply is cut off, the tasks that came back are kept with a warning to add the rest', /ran out of room/.test(prev2) && /\d+ tasks/.test(prev2) && !/70 tasks/.test(prev2), prev2.slice(0, 200));
    await p.screenshot({ path: path.join(__dirname, 'shot56-aiplan.png') });
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close(); br = null;
  } catch (e) { try { if (br) await br.close(); } catch {} ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ') + ' LOG: ' + log.slice(-600)); }
  try { srv.kill(); } catch {} try { mock.close(); } catch {} try { await blobs.stop(); } catch {}
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(0);
})();
