// v51: Ask AI with tables linked together, e.g. "List me all the items in short supply, also link the table with
// supplier so that I know whom to order from. I need the supplier name and their contact number".
// The stand-in AI first joins on the wrong key (the supplier columns come back empty, as happened on the test site),
// the page notices and asks it to fix the query; also checks real JOINs (LEFT JOIN, 3 tables) give the right rows.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const SITE = path.resolve(process.argv[2]);
const PORT = 8951, BASE = `http://127.0.0.1:${PORT}`;
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => results.push({ area, name, pass: !!pass, detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BAD = "SELECT i.item, i.sku, i.category, i.available, i.reorder_level, i.on_order, s.supplier, s.contact, s.phone FROM inventory i LEFT JOIN suppliers s ON i.price_supplier = s.id WHERE i.low = true ORDER BY i.available";
const GOOD = 'SELECT item, sku, available, reorder_level, on_order, reorder_needed, price_supplier AS supplier_name, supplier_contact, supplier_phone FROM inventory WHERE low = true ORDER BY available';
const JOIN = 'SELECT i.stock_id, i.item, i.available, s.supplier_id, s.supplier, s.contact, s.phone, s.terms FROM inventory i LEFT JOIN suppliers s ON i.supplier_id = s.supplier_id WHERE i.low = true ORDER BY i.item';
const THREE = "SELECT i.item, sp.supplier, sp.price_ex, s.phone FROM supplier_prices sp JOIN inventory i ON sp.stock_id = i.stock_id JOIN suppliers s ON sp.supplier_id = s.supplier_id WHERE i.low = true AND sp.expired = false ORDER BY i.item, sp.price_ex";
// a UNION on the keys: low stock lines and lines on order, one list with stock_id and supplier_id from both parts
const UNION = "SELECT stock_id, supplier_id, item, 'low' AS why FROM inventory WHERE low = true UNION ALL SELECT stock_id, supplier_id, item, 'on order' AS why FROM inventory WHERE on_order > 0";
const asks = [];
const mock = http.createServer((req, res) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => {
  const body = JSON.parse(Buffer.concat(c).toString() || '{}'), sys = body.messages[0].content, user = body.messages[1].content;
  let out = { answer: 'Done.' };
  if (/Turn the question/.test(sys)) {
    const u = JSON.parse(user); asks.push({ sys, u });
    if (/short supply/.test(u.q)) out = { sql: u.fix ? GOOD : BAD, title: 'Items in short supply and who to order from', note: '', chart: null };
    else if (/join the suppliers/.test(u.q)) out = { sql: JOIN, title: 'Low items with supplier', note: '', chart: null };
    else if (/every quote/.test(u.q)) out = { sql: THREE, title: 'Current quotes for low items', note: '', chart: null };
    else if (/low or on order/.test(u.q)) out = { sql: UNION, title: 'Low or on order', note: '', chart: null };
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(out) }, finish_reason: 'stop' }], usage: { total_tokens: 500 } }));
}); });

(async () => {
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-join-blobs'); fs.rmSync(dir, { recursive: true, force: true });
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
    // the stock and supplier test data, loaded the same way as the loader does
    const I = await import(path.join(SITE, 'netlify/lib/inventory.mjs'));
    process.env.SITE_ENV = 'test';
    const SUP = JSON.parse(fs.readFileSync(path.join(SITE, 'tools/test-data/suppliers-50.json'))).suppliers, INV = JSON.parse(fs.readFileSync(path.join(SITE, 'tools/test-data/inventory-150.json'))).items;
    const ids = {}; for (let i = 0; i < SUP.length; i += 10) Object.assign(ids, (await I.testLoad({ kind: 'suppliers', suppliers: SUP.slice(i, i + 10) }, 'test')).ids);
    const now = Date.now(), DAY = 864e5, ymdOf = (d) => new Date(now + d * DAY + 10 * 3600e3).toISOString().slice(0, 10);
    const items = INV.map((it) => ({ name: it.name, sku: it.sku, category: it.category, unit: it.unit, location: it.location, reorderLevel: it.reorderLevel, reorderQty: it.reorderQty, packSize: it.packSize, notes: it.notes, onHand: it.onHand, preferred: ids[it.preferred] || '',
      prices: it.prices.map((p) => ({ supplier: ids[p.supplier] || '', price: p.price, ref: p.ref, quoted: ymdOf(p.quotedDays), validUntil: p.validDays == null ? '' : ymdOf(p.validDays) })).filter((p) => p.supplier),
      onOrder: it.onOrder ? { qty: it.onOrder.qty, supplier: ids[it.onOrder.supplier] || '', at: now - it.onOrder.daysAgo * DAY, expected: ymdOf(it.onOrder.expectedDays), via: it.onOrder.via } : null,
      moves: it.moves.slice(0, 5).map((m) => ({ at: now - m.daysAgo * DAY, kind: m.kind, qty: m.kind === 'out' ? -Math.abs(m.qty) : m.qty, reason: m.reason, job: '' })) }));
    for (let i = 0; i < items.length; i += 10) await I.testLoad({ kind: 'items', items: items.slice(i, i + 10) }, 'test');
    delete process.env.SITE_ENV;
    const SQ = await import(path.join(SITE, 'netlify/lib/admin-sql.mjs'));
    const T = await SQ.tables(), low = T.inventory.filter((x) => x.low);
    // keys: every table has its own key first, one per row, and every link points at a row that exists
    const bad = [];
    for (const [tb, K] of Object.entries(SQ.KEYS)) {
      const rows = T[tb] || [], seen = new Set();
      if (SQ.SCHEMA[tb][0] !== K.pk) bad.push(tb + ': key not first');
      for (const r of rows) { const v = r[K.pk]; if (v === '' || v == null) bad.push(tb + ': empty key'); else if (seen.has(v)) bad.push(tb + ': duplicate ' + v); seen.add(v); }
      for (const [c, to] of Object.entries(K.fk || {})) {
        const have = new Set((T[to] || []).map((x) => x[SQ.KEYS[to].pk]));
        rows.forEach((r) => { if (r[c] && !have.has(r[c])) bad.push(`${tb}.${c} = ${r[c]} not in ${to}`); });
      }
    }
    ok('Keys', 'every table starts with its own key (stock_id, supplier_id, job_id ...), one per row, and every link points at a real row', bad.length === 0, bad.slice(0, 6).join('; '));
    ok('Keys', 'stock and suppliers are keyed stock_id and supplier_id, and the links use the same names', SQ.SCHEMA.inventory[0] === 'stock_id' && SQ.SCHEMA.suppliers[0] === 'supplier_id' && SQ.SCHEMA.inventory.includes('supplier_id') &&
      ['stock_id', 'supplier_id'].every((c) => SQ.SCHEMA.supplier_prices.includes(c)) && SQ.SCHEMA.stock_moves.includes('stock_id'));
    ok('Data', 'stock items carry who to order from: supplier name, contact and phone (no join needed)', low.length > 5 && low.every((x) => x.price_supplier && x.supplier_phone && x.supplier_id) && SQ.SCHEMA.inventory.includes('supplier_phone'), low.length);

    br = await chromium.launch();
    const p = await (await br.newContext({ viewport: { width: 1500, height: 950 } })).newPage(); p.setDefaultTimeout(20000);
    const errors = []; errorsAll = errors;
    p.on('pageerror', (e) => errors.push(e.message)); p.on('dialog', (x) => { errors.push('dialog: ' + x.message()); x.dismiss(); });
    await p.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
    await p.fill('[name=username]', 'sashi73'); await p.fill('[name=password]', 'sashi98'); await p.click('#loginForm button');
    await p.waitForSelector('#app:not([hidden])');
    await p.click('[data-nav=ask]'); await p.waitForSelector('#askQ');
    const ask = async (q) => {
      const n0 = asks.length;
      await p.fill('#askQ', q); await p.click('#askGo');
      await p.waitForFunction(() => { const b = document.querySelector('#askGo'); return b && !b.disabled && document.querySelector('#askOut .ask-a') && !document.querySelector('#askOut .ask-think'); });
      return { rows: await p.evaluate(() => window.MBS.sqlState.rows), sql: await p.evaluate(() => window.MBS.sqlState.sql), err: await p.$('#askOut .ask-ans.err'), sent: asks.slice(n0) };
    };
    let a = await ask('List me all the items in short supply, also link the table with supplier so that I know whom to order from. I need the supplier name and their contact number?');
    ok('AI', 'the AI is told the keys (inventory.supplier_id = suppliers.supplier_id ...) and that items already carry the supplier phone', /inventory\.supplier_id = suppliers\.supplier_id/.test(a.sent[0].sys) && /UNION/.test(a.sent[0].sys) && /supplier_phone/.test(a.sent[0].u.tables) && /short supply/.test(a.sent[0].u.notes));
    ok('Fix', 'a query whose supplier columns come back empty is sent back to the AI to fix', a.sent.length === 2 && a.sent[1].u.fix && /empty in every row: supplier, contact, phone/.test(a.sent[1].u.fix.error), JSON.stringify(a.sent.map((x) => x.u.fix && x.u.fix.error)));
    ok('Result', 'the answer lists every item in short supply with the supplier name, contact and phone filled in', !a.err && a.rows.length === low.length && a.rows.every((r) => r.supplier_name && r.supplier_phone && r.supplier_contact !== undefined), a.rows.length + ' vs ' + low.length + ' ' + JSON.stringify(a.rows[0]));
    await p.waitForSelector('#resBody table');
    ok('Result', 'the supplier name and phone show in the table', /SUPPLIER_PHONE/i.test(await p.textContent('#resBody thead')) && /02 /.test(await p.textContent('#resBody tbody')));
    await p.screenshot({ path: path.join(__dirname, 'shot51-short-supply.png'), fullPage: true });

    a = await ask('Low items: join the suppliers table to show their phone and terms');
    const exp = low.map((x) => x.item).sort((x, y) => (x > y ? 1 : -1));
    ok('Joins', 'a LEFT JOIN on the keys works (inventory.supplier_id = suppliers.supplier_id)', !a.err && a.sent.length === 1 && a.rows.length === exp.length && a.rows.every((r) => r.supplier && r.phone), a.rows.length + ' ' + JSON.stringify(a.rows[0]));
    a = await ask('For low items show every quote with the supplier phone');
    const three = T.supplier_prices.filter((sp) => !sp.expired && low.some((x) => x.id === sp.item_id)).length;
    ok('Joins', 'a three-table JOIN (quotes, stock, suppliers) gives the right rows', !a.err && a.rows.length === three && three > 0 && a.rows.every((r) => r.supplier && r.phone && r.price_ex > 0), a.rows.length + ' vs ' + three);
    a = await ask('Items that are low or on order');
    const un = T.inventory.filter((x) => x.low).length + T.inventory.filter((x) => x.on_order > 0).length;
    ok('Union', 'a UNION of two lists on the same keys (stock_id, supplier_id) works', !a.err && a.rows.length === un && a.rows.every((r) => r.stock_id && r.supplier_id), a.rows.length + ' vs ' + un);
    const keyChips = await p.$$eval('.chipd.kpk', (x) => x.map((c) => c.textContent));
    ok('Explorer', 'the table list marks each key with 🔑 and each link with 🔗', keyChips.some((c) => /stock_id/.test(c)) && keyChips.some((c) => /supplier_id/.test(c)) && (await p.$$eval('.chipd.kfk', (x) => x.length)) > 5, keyChips.join(','));
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close(); br = null;
  } catch (e) { try { if (br) await br.close(); } catch {} ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ') + ' LOG: ' + log.slice(-500)); }
  try { srv.kill(); } catch {} try { mock.close(); } catch {} try { await blobs.stop(); } catch {}
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(0);
})();
