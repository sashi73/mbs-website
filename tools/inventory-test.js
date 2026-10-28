// End-to-end test of Inventory & suppliers (v25): real Blobs, local site, stand-ins for DeepSeek / Resend / Telegram, headless Chromium.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http'), path = require('path'), fs = require('fs'), os = require('os');
const SITE = path.resolve(process.argv[2]);
const PORT = 8901, BASE = `http://127.0.0.1:${PORT}`;
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => { results.push({ area, name, pass: !!pass, detail }); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-inv-test-blobs'); fs.rmSync(dir, { recursive: true, force: true });
  const blobs = new BlobsServer({ directory: dir, token: 'tok', port: 0 });
  const { port: bport } = await blobs.start();
  const ctxB64 = Buffer.from(JSON.stringify({ siteID: 'mbs', token: 'tok', edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, apiURL: `http://localhost:${bport}` })).toString('base64');
  process.env.NETLIFY_BLOBS_CONTEXT = ctxB64;

  // stand-ins: DeepSeek writes the order email, Resend and Telegram record what was sent
  const ai = [], mails = [], tg = [];
  const mock = http.createServer((req, res) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => {
    const raw = Buffer.concat(c).toString(); let body = {}; try { body = JSON.parse(raw); } catch {}
    if (/chat\/completions/.test(req.url)) {
      ai.push({ raw, body });
      const sys = body.messages?.[0]?.content || ''; let u = {}; try { u = JSON.parse(body.messages?.[1]?.content || '{}'); } catch {}
      let content = '{}';
      if (/purchase order email/.test(sys)) content = JSON.stringify({ subject: `Purchase order: ${u.item}`, body: `Hi ${u.supplier_contact || 'team'},\n\nPlease supply ${u.quantity} ${u.unit} of ${u.item} (code ${u.code}) at your quoted $${u.quoted_price_ex_gst} ex GST (quote ${u.quote_ref}). Account ${u.account_number}.\nPlease confirm price, availability and delivery date.\n\nThanks,\n${u.business}\n${u.phone}` });
      return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }], usage: { total_tokens: 312 } }));
    }
    if (/\/emails$/.test(req.url)) { mails.push(body); return res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"id":"em_1"}'); }
    if (/sendMessage/.test(req.url)) { tg.push(body); return res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true,"result":{"message_id":1}}'); }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true,"result":{}}');
  }); });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const M = `http://127.0.0.1:${mock.address().port}`;
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NETLIFY_BLOBS_CONTEXT: ctxB64, ADMIN_USERNAME: 'sashi73', ADMIN_PASSWORD: 'sashi98',
    LLM_API_KEY: 'test', LLM_BASE_URL: M, RESEND_API_KEY: 're_test', RESEND_API_BASE: M, TELEGRAM_BOT_TOKEN: '123:abc', TELEGRAM_API_BASE: M, TELEGRAM_CHAT_ID: '-1001', TELEGRAM_ALERT_IDS: '222',
    OWNER_EMAIL: 'owner@example.com', FROM_EMAIL: 'MBS <website@example.com>', PUBLIC_WEBSITE: 'mbsplc.com.au', LIMIT_ADMIN: '100000/1' };
  const srv = spawn('node', ['local-server.mjs'], { cwd: SITE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 40 && !/running/.test(log); i++) await sleep(150);
  const cleanup = async () => { try { srv.kill(); } catch {} try { mock.close(); } catch {} try { await blobs.stop(); } catch {} };

  try {
    const J = await import(path.join(SITE, 'netlify/lib/jobs.mjs'));
    const kv = await import(path.join(SITE, 'netlify/lib/kv.mjs'));
    const P = await import(path.join(SITE, 'netlify/lib/plan.mjs'));
    const core = await J.nextCore('W');
    await J.create({ core, name: 'Priya Nair', phone: '0400 000 001', email: 'priya@example.com', suburb: 'Castle Hill', service: 'Bathroom waterproofing', source: 'chat' });
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date());
    await P.save(core, { name: 'Bathroom waterproofing & retiling', start: today, tasks: [
      { id: 't1', name: 'Site inspection', dur: 1, pct: 100, status: 'done' },
      { id: 't2', name: 'Waterproofing membrane', dur: 2, pct: 0, status: 'todo', pred: ['t1'] }], risks: [], issues: [] }, 0, 'test');

    const br = await chromium.launch();
    const ctx = await br.newContext({ viewport: { width: 1440, height: 950 } });
    const p = await ctx.newPage(); p.setDefaultTimeout(15000);
    const errors = []; errorsAll = errors;
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('dialog', (x) => { errors.push('dialog: ' + x.message()); x.dismiss(); });
    const api = (action, data = {}) => p.request.post(`${BASE}/.netlify/functions/admin`, { data: { action, ...data }, headers: { 'X-MBS-Admin': '1' } });
    const item = async () => { const ks = await kv.keys('inv:'); return kv.get(ks[0]); };
    const saved = async () => { await p.waitForTimeout(150); await p.waitForFunction(() => document.querySelector('#planSave') && document.querySelector('#planSave').textContent === 'Saved ✓', null, { timeout: 10000 }); await p.waitForTimeout(400); };

    let r = await api('invList');
    ok('Security', 'inventory needs a login', r.status() === 401, r.status());
    await p.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
    await p.fill('[name=username]', 'sashi73'); await p.fill('[name=password]', 'sashi98'); await p.click('#loginForm button');
    await p.waitForSelector('#app:not([hidden])');
    ok('Menu', 'left menu has a Stock section: Inventory and Suppliers', /Stock[\s\S]*📦[\s\S]*Inventory[\s\S]*🏭[\s\S]*Suppliers/.test(await p.textContent('.side-nav')));

    // ---- suppliers ----
    await p.click('[data-nav=suppliers]'); await p.waitForSelector('#newSup');
    const addSup = async (f) => {
      await p.click('#newSup'); await p.waitForSelector('[data-s=name]');
      for (const [k, v] of Object.entries(f)) await p.fill(`[data-s=${k}]`, v);
      await p.click('#supSave'); await p.waitForSelector('#modal', { state: 'hidden' }); await p.waitForTimeout(300);
    };
    await addSup({ name: 'Beaumont Tiles Castle Hill', contact: 'Dave Smith', phone: '02 9634 1111', email: 'orders@beaumont.example', account: 'MBS-4471', terms: '30 days EOM', categories: 'tiles, membrane' });
    await addSup({ name: 'Bunnings Castle Hill', contact: 'Trade desk', phone: '02 8858 2222', email: 'trade@bunnings.example' });
    ok('Suppliers', 'two suppliers saved and listed with phone and email links', (await p.$$('tr[data-sid]')).length === 2 && !!(await p.$('a[href="tel:0296341111"]')) && !!(await p.$('a[href="mailto:orders@beaumont.example"]')));

    // ---- a stock item with two supplier quotes ----
    await p.click('[data-itab=items]'); await p.click('#newItem'); await p.waitForSelector('[data-i=name]');
    await p.fill('[data-i=name]', 'Ardex WPM 300 membrane 15 L'); await p.fill('[data-i=sku]', 'WPM300-15'); await p.fill('[data-i=category]', 'Waterproofing');
    await p.selectOption('[data-i=unit]', 'tin'); await p.fill('[data-i=location]', 'Van 1'); await p.fill('[data-i=onHand]', '6');
    await p.fill('[data-i=reorderLevel]', '3'); await p.fill('[data-i=reorderQty]', '4'); await p.fill('[data-i=packSize]', '2');
    await p.click('#addQuote'); await p.click('#addQuote');
    const rows = await p.$$('#priceBox tr[data-pi]');
    const fillQuote = async (row, sup, price, ref, valid) => { await (await row.$('[data-p=supplier]')).selectOption({ label: sup }); await (await row.$('[data-p=price]')).fill(price); await (await row.$('[data-p=ref]')).fill(ref); if (valid) await (await row.$('[data-p=validUntil]')).fill(valid); };
    await fillQuote(rows[0], 'Beaumont Tiles Castle Hill', '189', 'Q-7781', '2027-06-30');
    await fillQuote(rows[1], 'Bunnings Castle Hill', '199', 'BN-22', '2027-06-30');
    await (await rows[0].$('[data-pref]')).check();
    await p.click('#itSave'); await p.waitForSelector('#modal', { state: 'hidden' }); await p.waitForSelector('tr[data-iid]');
    let it = await item();
    ok('Items', 'item saved: 6 tin on hand, re-order at 3, usual order 4, packs of 2', it.onHand === 6 && it.reorderLevel === 3 && it.reorderQty === 4 && it.packSize === 2 && it.unit === 'tin');
    ok('Quotes', 'two supplier quotes kept (price, quote ref, valid until); Beaumont preferred', it.prices.length === 2 && it.prices.some((q) => q.price === 189 && q.ref === 'Q-7781' && q.validUntil === '2027-06-30') && it.preferred === it.prices.find((q) => q.price === 189).supplier);
    const rowText = await p.textContent('tr[data-iid]');
    ok('Items', 'list shows on hand, best price with supplier, status OK', /6\s*tin/.test(rowText) && /\$189\.00/.test(rowText) && /Beaumont/.test(rowText) && /OK/.test(rowText), rowText.replace(/\s+/g, ' '));
    await p.screenshot({ path: 'MBS_inventory.jpg', type: 'jpeg', quality: 80 });

    // ---- use stock ----
    await p.click('tr[data-iid] [data-mv=out]'); await p.fill('#mvQty', '2'); await p.fill('#mvReason', 'Small repair'); await p.click('#mvGo');
    await p.waitForSelector('#modal', { state: 'hidden' }); await p.waitForTimeout(400);
    it = await item();
    ok('Stock', '"− Use" 2 → 4 on hand, still above the re-order level (no prompt)', it.onHand === 4 && !it.alerted && (await p.$eval('#modal', (m) => m.hidden)));

    // ---- project plan uses the item ----
    await p.goto(`${BASE}/admin/#plan/${core}/schedule`); await p.waitForSelector('table.gt');
    await p.click('[data-cols=a]');
    await p.click('tr[data-tid="t2"] [data-pick]'); await p.waitForSelector('#pkList [data-pk]');
    ok('Planner', 'the 📦 button on a task lists stock items with what is available and the price', /Ardex WPM 300/.test(await p.textContent('#pkList')) && /4 tin/.test(await p.textContent('#pkList')) && /\$189\.00/.test(await p.textContent('#pkList')));
    await p.click('#pkList [data-pk]'); await saved();
    let pl = await kv.get('plan:' + core);
    let t2 = pl.tasks.find((t) => t.id === 't2');
    ok('Planner', 'picking it links the task and fills unit (tin) and supplier price ($189)', t2.item === it.id && t2.unit === 'tin' && t2.rate === 189 && t2.qty === 1, JSON.stringify(t2));
    await p.waitForSelector('#roSup', { timeout: 15000 });
    ok('Low stock', 'setting 1 tin aside for the job leaves 3 available (re-order at 3): the console asks to contact the supplier', /is low on stock/.test(await p.textContent('#modal')) && /phone or email/.test(await p.textContent('#modal')) && /Available\s*3 tin/.test(await p.textContent('#modal')) && /1 set aside for jobs/.test(await p.textContent('#modal')), (await p.textContent('#modal')).slice(0, 300));
    ok('Low stock', 'the preferred supplier is chosen, with a Call button for its phone', (await p.inputValue('#roSup')) === it.preferred && !!(await p.$('#roCall a[href="tel:0296341111"]')));
    ok('Low stock', 'suggested order: 4 tins (usual quantity, whole packs of 2)', (await p.inputValue('#roQty')) === '4');
    await sleep(300);
    const alert = tg.find((m) => /Low stock/.test(m.text || ''));
    ok('Telegram', 'a low-stock alert goes to Telegram with the supplier, phone and suggested order', alert && /Ardex WPM 300/.test(alert.text) && /Beaumont Tiles/.test(alert.text) && /02 9634 1111/.test(alert.text) && /Suggested order: 4 tin/.test(alert.text) && /mbsplc\.com\.au\/admin\/#inventory\//.test(alert.text), JSON.stringify(tg.slice(-3)).slice(0, 600));

    // ---- AI writes the re-order email ----
    await p.click('#roAI'); await p.waitForSelector('#emBody');
    const aiReq = ai.find((x) => /purchase order email/.test(x.raw));
    ok('AI email', 'the AI writes the order email with the quantity, quote and account number', /4 tin of Ardex WPM 300/.test(await p.inputValue('#emBody')) && /Q-7781/.test(await p.inputValue('#emBody')) && /MBS-4471/.test(await p.inputValue('#emBody')) && (await p.inputValue('#emTo')) === 'orders@beaumont.example');
    ok('AI email', 'AI reply capped at 350 tokens; no customer details sent', aiReq && aiReq.body.max_tokens === 350 && !/Priya|0400 000|priya@/.test(aiReq.raw));
    ok('AI email', 'tokens used are shown', /about 312 tokens/.test(await p.textContent('#roMail')));
    await p.screenshot({ path: 'MBS_inventory_reorder.jpg', type: 'jpeg', quality: 80 });
    await p.click('#emSend'); await p.waitForSelector('#modal', { state: 'hidden' }); await p.waitForTimeout(400);
    const mail = mails[mails.length - 1];
    it = await item();
    ok('Email', '"Send email" sends it to the supplier (copy to the owner) and marks 4 tins on order', mail && mail.to[0] === 'orders@beaumont.example' && (mail.bcc || []).includes('owner@example.com') && /4 tin/.test(mail.text) && it.onOrder && it.onOrder.qty === 4);
    await p.goto(`${BASE}/admin/#inventory`); await p.waitForSelector('tr[data-iid]');
    ok('On order', 'the list shows "+4 on order" and the item is no longer low', /\+4 on order/.test(await p.textContent('tr[data-iid]')) && /On order/.test(await p.textContent('tr[data-iid] .ichip')), await p.textContent('tr[data-iid]'));

    // ---- receive ----
    await p.click('tr[data-iid] [data-recv]'); await p.click('#rcGo'); await p.waitForSelector('#modal', { state: 'hidden' }); await p.waitForTimeout(400);
    it = await item();
    ok('Receive', '"Receive" adds the 4 tins to stock and clears the order', it.onHand === 8 && !it.onOrder, JSON.stringify({ onHand: it.onHand, onOrder: it.onOrder }));

    // ---- plan task Done uses the stock, reopening gives it back ----
    await p.goto(`${BASE}/admin/#plan/${core}/schedule`); await p.waitForSelector('table.gt');
    await p.click('[data-cols=a]');
    await p.fill('tr[data-tid="t2"] [data-k=qty]', '2'); await p.dispatchEvent('tr[data-tid="t2"] [data-k=qty]', 'change'); await saved();
    ok('Planner', 'the task now needs 2 tins: 2 set aside for the job', (await (await api('invGet', { id: it.id })).json()).summary.allocated === 2);
    await p.selectOption('tr[data-tid="t2"] [data-k=status]', 'done'); await saved();
    it = await item();
    ok('Planner', 'when the task is Done, 2 tins are taken out of stock for the job', it.onHand === 6 && it.moves[0].kind === 'plan' && it.moves[0].qty === -2 && it.moves[0].job === core, JSON.stringify(it.moves[0]));
    await p.selectOption('tr[data-tid="t2"] [data-k=status]', 'doing'); await saved();
    it = await item();
    ok('Planner', 'reopening the task gives the 2 tins back (set aside again)', it.onHand === 8 && !it.moves.some((m) => m.kind === 'plan'));
    await p.selectOption('tr[data-tid="t2"] [data-k=status]', 'done'); await saved();
    await p.click('#planTabs >> text=Overview'); await p.waitForSelector('#planBody >> text=Materials from stock');
    ok('Planner', 'Overview has "Materials from stock" with what was used', /Ardex WPM 300/.test(await p.textContent('#planBody')) && /used 2 tin/.test(await p.textContent('#planBody')));

    // ---- expired quote: the other supplier's price is used ----
    r = await api('invGet', { id: it.id }); let g = await r.json();
    const exp = g.item.prices.map((q) => (q.price === 189 ? { ...q, validUntil: '2020-01-01' } : q));
    r = await api('invSave', { item: { ...g.item, prices: exp } });
    g = await (await api('invGet', { id: it.id })).json();
    ok('Quotes', 'when a quote expires, the best valid quote is used instead (Bunnings $199)', g.summary.price === 199 && /Bunnings/.test(g.summary.priceSupplierName), JSON.stringify(g.summary));

    // ---- stock-take + no supplier email typed ----
    r = await api('invMove', { id: it.id, kind: 'count', qty: 5, reason: 'Stock-take' }); g = await r.json();
    ok('Stock', 'a stock-take sets the count (5) and records the difference', g.item.onHand === 5 && g.item.moves[0].kind === 'count' && g.item.moves[0].qty === -1);
    r = await api('invReorderSend', { id: it.id, to: 'not-an-email', qty: 4, subject: 's', body: 'b' });
    ok('Safety', 'an order email to a bad address is refused', r.status() === 400);
    r = await api('invMove', { id: 'I-9999', kind: 'out', qty: 1 });
    ok('Safety', 'unknown items are refused (nothing created)', r.status() === 400 && !(await kv.get('inv:I-9999')));

    // ---- SQL wizard + data explorer ----
    r = await api('sqlData'); const sd = await r.json();
    ok('SQL', 'SQL wizard has inventory, suppliers, supplier_prices and stock_moves tables', sd.data.inventory.length === 1 && sd.data.suppliers.length === 2 && sd.data.supplier_prices.length === 2 && sd.data.stock_moves.length >= 3 && sd.data.inventory[0].unit_price === 199, JSON.stringify(sd.data.inventory[0]));
    await p.goto(`${BASE}/admin/#sql`); await p.waitForSelector('#sqlTabs'); await p.click('[data-tab=templates]');
    await p.click('.tpl >> text=Supplier price comparison'); await p.waitForSelector('#resBody table');
    ok('SQL', '"Supplier price comparison" template runs', (await p.$$('#resBody tbody tr')).length === 2);
    await p.click('[data-tab=templates]'); await p.click('.tpl >> text=Stock used per job'); await p.waitForSelector('#resBody table');
    ok('SQL', '"Stock used per job" shows the 2 tins for the job', (await p.evaluate(() => JSON.stringify(window.MBS.sqlState.rows))).includes('"used_qty":2'), await p.evaluate(() => JSON.stringify(window.MBS.sqlState.rows)));
    r = await api('dataList', { store: 'mbs-jobs' }); const dk = JSON.stringify(await r.json());
    ok('Data explorer', 'stock items and suppliers appear in the data explorer', /stock item/.test(dk) && /supplier/.test(dk));

    // ---- low badge + phone ----
    await api('invMove', { id: it.id, kind: 'count', qty: 1, reason: 'test low' });
    await p.goto(`${BASE}/admin/#inventory`); await p.waitForSelector('.lowbar');
    await p.waitForFunction(() => { const b = document.querySelector('[data-nav=inventory] .nbadge'); return b && !b.hidden && b.textContent === '1'; });
    ok('Badge', 'the menu shows how many items are low, and the page has a low-stock bar', /1 item is low on stock/.test(await p.textContent('.lowbar')));
    await p.click('.lowbar [data-reorder]'); await p.waitForSelector('#roSup');
    await p.click('#roEmail'); await p.waitForSelector('#emBody');
    ok('Email', 'without AI, a standard order email is written with the quantity', /Please supply the following/.test(await p.inputValue('#emBody')) && /: \d+ tin/.test(await p.inputValue('#emBody')));
    await p.click('#roMarked'); await p.waitForSelector('#modal', { state: 'hidden' }); await p.waitForTimeout(300);
    it = await item();
    ok('Phone', '"I ordered by phone" marks it on order', it.onOrder && it.onOrder.via === 'phone');
    const m = await ctx.newPage(); await m.setViewportSize({ width: 390, height: 844 });
    m.on('pageerror', (e) => errors.push('phone: ' + e.message));
    await m.goto(`${BASE}/admin/#inventory`, { waitUntil: 'domcontentloaded' }); await m.waitForSelector('tr[data-iid]');
    ok('Phone', 'inventory works on a phone (no sideways scrolling of the page)', await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await m.close();
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close();
  } catch (e) { ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ')); }
  await cleanup();
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  if (pass !== results.length) console.log('\n--- server log ---\n' + log.slice(-2500));
})();
