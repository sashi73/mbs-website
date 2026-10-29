// End-to-end test of Customers (v27): automatic customer database, list, customer page, map, insights + AI analysis,
// Ask AI, SQL wizard customers table. Real Blobs, local site, a stand-in for DeepSeek, headless Chromium.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http'), path = require('path'), fs = require('fs'), os = require('os');
const SITE = path.resolve(process.argv[2]);
const PORT = 8904, BASE = `http://127.0.0.1:${PORT}`;
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => { results.push({ area, name, pass: !!pass, detail }); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 864e5;

(async () => {
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-cust-blobs'); fs.rmSync(dir, { recursive: true, force: true });
  const blobs = new BlobsServer({ directory: dir, token: 'tok', port: 0 });
  const { port: bport } = await blobs.start();
  const ctxB64 = Buffer.from(JSON.stringify({ siteID: 'mbs', token: 'tok', edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, apiURL: `http://localhost:${bport}` })).toString('base64');
  process.env.NETLIFY_BLOBS_CONTEXT = ctxB64;

  // ---- stand-in for DeepSeek ----
  const seen = [];
  const mock = http.createServer((req, res) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => {
    let body = {}; try { body = JSON.parse(Buffer.concat(c).toString()); } catch {}
    const sys = body.messages?.[0]?.content || ''; let u = {}; try { u = JSON.parse(body.messages?.[1]?.content || '{}'); } catch {}
    seen.push({ sys, u, raw: Buffer.concat(c).toString(), max: body.max_tokens });
    let content;
    if (/business analyst/.test(sys)) content = JSON.stringify({ summary: `You have ${u.totals.customers} customers; ${u.totals.conversion}% became jobs.`, insights: ['Box Hill is your strongest suburb', 'One customer in five comes back'], recommendations: ['Follow up the quotes waiting', 'Contact customers who have been quiet for a year'] });
    else if (/Turn the question/.test(sys)) content = JSON.stringify({ sql: 'SELECT name, suburb, confirmed_jobs, total_value FROM customers WHERE confirmed_jobs > 0 ORDER BY confirmed_jobs DESC, total_value DESC LIMIT 10', title: 'Customers with the most orders', note: '', chart: { type: 'bar', x: 'name', y: ['confirmed_jobs'] } });
    else if (/Answer the business owner/.test(sys)) content = JSON.stringify({ answer: `Your top customer has ${u.rows && u.rows[0] ? u.rows[0].confirmed_jobs : 0} confirmed jobs.` });
    else content = JSON.stringify({ ok: true });
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }], usage: { total_tokens: 321 } }));
  }); });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NETLIFY_BLOBS_CONTEXT: ctxB64, ADMIN_USERNAME: 'sashi73', ADMIN_PASSWORD: 'sashi98',
    LLM_API_KEY: 'test', LLM_BASE_URL: `http://127.0.0.1:${mock.address().port}`, AI_TIMEOUT_SECONDS: '3', TELEGRAM_BOT_TOKEN: '', RESEND_API_KEY: '', LIMIT_LEAD: '100/1' };
  const srv = spawn('node', ['local-server.mjs'], { cwd: SITE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 40 && !/running/.test(log); i++) await sleep(150);
  const cleanup = async () => { try { srv.kill(); } catch {} try { mock.close(); } catch {} try { await blobs.stop(); } catch {} };

  let br = null;
  try {
    const J = await import(path.join(SITE, 'netlify/lib/jobs.mjs'));
    const kv = await import(path.join(SITE, 'netlify/lib/kv.mjs'));
    const CU = await import(path.join(SITE, 'netlify/lib/customers.mjs'));
    // an old job saved before the customer database existed (not linked yet)
    const oldCore = await J.nextCore('W');
    const oldJob = { core: oldCore, trade: 'W', stage: 'paid', created: Date.now() - 400 * DAY, updated: Date.now() - 380 * DAY, name: 'Gina Gone', phone: '0433 999 000', email: 'gina@example.com', suburb: 'Rouse Hill NSW 2155', service: 'Waterproofing', summary: 'Waterproof a balcony', source: 'Website chat', quote: { amount: 4300 }, invoice: { amount: 4300 }, paid_at: Date.now() - 380 * DAY, won_at: Date.now() - 395 * DAY, quoted_at: Date.now() - 398 * DAY, history: [], notes: [] };
    oldJob.ref = J.refFor(oldJob); await kv.set('job:' + oldCore, oldJob); await kv.update('index', (idx) => { idx.jobs[oldCore] = J.summary(oldJob); return idx; }, () => ({ jobs: {} }));
    ok('Store', 'no customer record before any new enquiry', !(await kv.get('customers')));

    const mk = async (f, stages = []) => { const core = await J.nextCore('M'); await J.create({ core, source: 'Website chat', service: 'Repair', summary: 'Fix something', ...f }); for (const [s, x] of stages) await J.setStage(core, s, 'test', x || {}); return core; };
    const a1 = await mk({ name: 'Ann Lee', phone: '0412 345 678', email: 'Ann@Example.com', suburb: 'Box Hill NSW 2765', summary: 'Customer Ann Lee has asked about a leaking shower.' }, [['called'], ['quoted', { amount: 5000 }], ['won'], ['completed'], ['invoiced', { amount: 5000 }], ['paid']]);
    const a2 = await mk({ name: 'Ann Lee', phone: '+61 412 345 678', email: '', suburb: 'Box Hill', source: 'phone (added by sashi73)' }, [['called'], ['quoted', { amount: 1200 }], ['won'], ['completed'], ['invoiced', { amount: 1200 }]]);
    const a3 = await mk({ name: 'Ann', phone: '0412345678', email: 'ann@example.com', suburb: 'Box Hill' }, [['called'], ['quoted', { amount: 800 }]]);
    const a4 = await mk({ name: 'Ann Lee (work)', phone: '0412 345 678', email: 'ann.work@company.com', suburb: 'Box Hill' });
    const b1 = await mk({ name: 'Bob Tan', phone: '0400 111 222', email: '', suburb: 'Kellyville NSW 2155' }, [['called'], ['quoted', { amount: 9000 }], ['won']]);
    const b2 = await mk({ name: 'Bob Tan', phone: '0400111222', email: 'bob@z.com', suburb: 'Kellyville' });
    const d1 = await mk({ name: 'Dee Lost', phone: '02 9876 5432', email: '', suburb: 'Castle Hill' }, [['called'], ['lost', { reason: 'price' }]]);
    const e1 = await mk({ name: 'Eve Email', phone: '', email: 'eve@x.com', suburb: 'Nowhere Special' });
    const f1 = await mk({ name: 'No Contact', phone: '', email: '', suburb: 'Box Hill' });
    let d = await kv.get('customers');
    const of = (core) => Object.values(d.list).find((c) => c.jobs.includes(core));
    ok('Store', 'phone numbers are compared in one format (0412 345 678 = +61 412 345 678 = 0412345678)', CU.normPhone('+61 412 345 678') === '0412345678' && CU.normPhone('0412 345 678') === '0412345678' && CU.normPhone('61412345678') === '0412345678' && CU.normPhone('412 345 678') === '0412345678');
    ok('Store', 'new enquiries are added to the customer database automatically', of(a1) && of(b1) && of(d1));
    ok('Key', 'same phone + same email (any capitals) = same customer', of(a1) && of(a1) === of(a3));
    ok('Key', 'same phone with no email = joins that customer', of(a2) && of(a2) === of(a1));
    ok('Key', 'same phone but a DIFFERENT email = a different customer (key is phone + email)', of(a4) && of(a4) !== of(a1));
    ok('Key', 'customer had no email, a later enquiry with the same phone adds the email', of(b2) === of(b1) && of(b1).email === 'bob@z.com');
    ok('Key', 'email only (no phone) still makes a customer; no phone and no email = no customer', of(e1) && !of(f1));
    ok('Store', 'the old job is not linked yet (it was saved before)', !of(oldCore));

    br = await chromium.launch();
    const ctx = await br.newContext({ viewport: { width: 1500, height: 950 } });
    const p = await ctx.newPage(); p.setDefaultTimeout(10000);
    const errors = []; errorsAll = errors;
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/tile\.openstreetmap|ERR_|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
    p.on('dialog', (x) => { errors.push('dialog: ' + x.message()); x.dismiss(); });
    await p.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64') }));
    let r = await p.request.post(`${BASE}/.netlify/functions/admin`, { data: { action: 'custList' }, headers: { 'X-MBS-Admin': '1' } });
    ok('Security', 'customers need a login', r.status() === 401, r.status());
    await p.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
    await p.fill('[name=username]', 'sashi73'); await p.fill('[name=password]', 'sashi98'); await p.click('#loginForm button');
    await p.waitForSelector('#app:not([hidden])');
    const nav = (await p.textContent('.side-nav')).replace(/[^\w &]+/g, ' ').replace(/\s+/g, ' ');
    ok('Menu', 'left menu has "Customers" under CRM, after Jobs', /CRM\s*Dashboard\s*Jobs\s*Customers/.test(nav), nav.slice(0, 80));

    // ---- list ----
    await p.click('a[data-nav=customers]'); await p.waitForSelector('.ctable');
    d = await kv.get('customers');
    ok('Backfill', 'first open links every existing job (the old job now has its customer)', d.built && Object.values(d.list).some((c) => c.jobs.includes(oldCore)));
    const rowsN = await p.$$eval('tr[data-cust]', (r) => r.length);
    ok('List', 'one row per customer (6: Ann, Ann work, Bob, Dee, Eve, Gina)', rowsN === 6, rowsN);
    const ann = await p.evaluate(() => window.MBS.custState.data.customers.find((c) => c.name === 'Ann Lee'));
    ok('Figures', 'Ann: 3 enquiries, 2 confirmed, 1 quote waiting ($800), value $6,200, paid $5,000, owes $1,200', ann.enquiries === 3 && ann.confirmed === 2 && ann.openQuotes === 1 && ann.quotedValue === 800 && ann.value === 6200 && ann.paid === 5000 && ann.owed === 1200, JSON.stringify(ann));
    ok('Figures', 'sources grouped: website chat and phone', ann.sources.chat === 2 && ann.sources.phone === 1, JSON.stringify(ann.sources));
    ok('List', 'KPIs: customers, repeat customers, became jobs, value, quotes waiting, owed', /Customers\s*6/.test(await p.textContent('.ckpis')) && /Repeat customers/.test(await p.textContent('.ckpis')) && /Owed\s*\$1,200/.test(await p.textContent('.ckpis')), await p.textContent('.ckpis'));
    await p.click('[data-f=owing]');
    ok('Filter', '"Owing" shows only Ann', (await p.$$('tr[data-cust]')).length === 1 && /Ann Lee/.test(await p.textContent('.ctable tbody')));
    await p.click('[data-f=repeat]');
    ok('Filter', '"Repeat" shows Ann and Bob', (await p.$$('tr[data-cust]')).length === 2);
    await p.click('[data-f=all]');
    await p.fill('#custQ', '9876');
    ok('Search', 'search by part of a phone number finds Dee', (await p.$$('tr[data-cust]')).length === 1 && /Dee Lost/.test(await p.textContent('.ctable tbody')));
    await p.fill('#custQ', 'kellyville');
    ok('Search', 'search by suburb finds Bob', (await p.$$('tr[data-cust]')).length === 1 && /Bob Tan/.test(await p.textContent('.ctable tbody')));
    await p.fill('#custQ', '');
    await p.click('th[data-sort=value]');
    ok('Sort', 'sort by value puts Bob ($9,000) first', /Bob Tan/.test(await p.textContent('tr[data-cust]:first-child')), await p.textContent('tr[data-cust]:first-child'));
    await p.screenshot({ path: 'MBS_customers.jpg', type: 'jpeg', quality: 80 });

    // ---- customer page ----
    await p.click(`tr[data-cust="${ann.id}"]`); await p.waitForSelector('#custForm');
    ok('Customer', 'customer page lists all 3 of Ann\'s jobs with stages and values', (await p.$$('tr[data-job]')).length === 3 && /\$5,000/.test(await p.textContent('#view')));
    ok('Customer', 'phone and email shown (call / email links)', !!(await p.$('a[href="tel:0412345678"]')) && !!(await p.$('a[href="mailto:ann@example.com"]')));
    await p.fill('#custForm [name=tags]', 'VIP, strata'); await p.fill('#custForm [name=notes]', 'Prefers SMS'); await p.click('#custForm button'); await p.waitForSelector('.toast >> text=Customer saved');
    d = await kv.get('customers');
    ok('Customer', 'tags and notes saved', d.list[ann.id].tags.join(',') === 'VIP,strata' && d.list[ann.id].notes === 'Prefers SMS');
    await p.click('tr[data-job]'); await p.waitForSelector('#jobCust a');
    ok('Job page', 'each job shows its customer (repeat customer, enquiries, jobs, owes)', /Ann Lee/.test(await p.textContent('#jobCust')) && /repeat customer/.test(await p.textContent('#jobCust')) && /3 enquiries/.test(await p.textContent('#jobCust')) && /owes \$1,200/.test(await p.textContent('#jobCust')));

    // a new enquiry from the website is linked straight away
    r = await p.request.post(`${BASE}/.netlify/functions/lead`, { data: { lead: { name: 'Hana New', phone: '0455 666 777', email: 'hana@example.com', suburb: 'Box Hill', service: 'Repair question (Ask Mr. Fixit)', summary: 'Hana asked about a door', details: 'my door sticks' }, channels: ['email'], source: 'chat' } });
    d = await kv.get('customers');
    ok('Website', 'an enquiry from the website creates the customer straight away (even though email/Telegram are not set up in this test)', Object.values(d.list).some((c) => c.name === 'Hana New' && c.phone === '0455666777' && c.email === 'hana@example.com' && c.jobs.length === 1), r.status());

    // ---- map ----
    await p.goto(`${BASE}/admin/#customers/map`); await p.waitForSelector('.leaflet-container'); await p.waitForSelector('#mapTop table');
    const bubbles = await p.$$eval('#cmap path.leaflet-interactive', (x) => x.length);
    ok('Map', 'map of Sydney with a bubble per suburb (Box Hill, Kellyville, Castle Hill, Rouse Hill)', bubbles === 4, bubbles);
    ok('Map', 'customers whose suburb is not recognised are counted, not lost', /1 customer not on the map/.test(await p.textContent('#mapNote')), await p.textContent('#mapNote'));
    ok('Map', 'top suburbs list: Box Hill first (3 customers)', /Box Hill\s*3/.test(await p.textContent('#mapTop tbody tr:first-child')), await p.textContent('#mapTop tbody tr:first-child'));
    await p.click('#mapTop tbody tr:first-child'); await p.waitForSelector('.leaflet-popup');
    ok('Map', 'clicking a suburb opens it: customers there, enquiries, jobs, % that became jobs', /Box Hill/.test(await p.textContent('.leaflet-popup')) && /Ann Lee/.test(await p.textContent('.leaflet-popup')) && /became jobs/.test(await p.textContent('.leaflet-popup')));
    ok('Map', 'OpenStreetMap credit shown', /OpenStreetMap/.test(await p.textContent('.leaflet-control-attribution')));
    await p.selectOption('#mapFilter', 'confirmed'); await sleep(100);
    ok('Map', 'show only customers with confirmed jobs (Box Hill, Kellyville, Rouse Hill)', (await p.$$eval('#cmap path.leaflet-interactive', (x) => x.length)) === 3);
    await p.selectOption('#mapMetric', 'value');
    ok('Map', 'bubble size can be value instead of customers', (await p.inputValue('#mapMetric')) === 'value');
    await p.screenshot({ path: 'MBS_customers_map.jpg', type: 'jpeg', quality: 80 });

    // ---- insights ----
    await p.goto(`${BASE}/admin/#customers/insights`); await p.waitForSelector('.funnel'); await p.waitForFunction(() => window.Chart && document.querySelector('#chMonths'));
    const ins = await p.textContent('#custBody');
    ok('Insights', 'funnel from enquiry to paid', /Enquiries/.test(await p.textContent('.funnel')) && /Paid/.test(await p.textContent('.funnel')));
    ok('Insights', 'charts: new customers per month, top suburbs, where customers come from', !!(await p.$('#chMonths')) && !!(await p.$('#chSubs')) && !!(await p.$('#chSrc')) && (await p.evaluate(() => Chart.instances ? Object.keys(Chart.instances).length : 0)) >= 3);
    ok('Insights', 'most orders, biggest customers, quotes waiting, owing, to win back', /Most orders/.test(ins) && /Biggest customers/.test(ins) && /Quotes waiting: follow up/.test(ins) && /Owing money/.test(ins) && /To win back/.test(ins));
    ok('Insights', '"To win back" lists Gina (paid job over a year ago, nothing since)', /Gina Gone/.test(await p.textContent('.card:has(h2:text("To win back"))')));
    await p.click('#custAi'); await p.waitForSelector('#custAiOut ul');
    const aiReq = seen.find((x) => /business analyst/.test(x.sys));
    ok('AI analysis', 'AI analysis shows a summary, what stands out and what to do', /customers/.test(await p.textContent('#custAiOut')) && /Follow up the quotes/.test(await p.textContent('#custAiOut')));
    ok('Privacy', 'AI analysis sends only figures: no names, phone numbers or emails', aiReq && !/Ann|Lee|Bob|Gina|0412|0400|@example|@z\.com/.test(aiReq.raw) && aiReq.max === 700, aiReq && aiReq.raw.slice(0, 300));
    await sleep(1200); await p.screenshot({ path: 'MBS_customers_insights.jpg', type: 'jpeg', quality: 80, fullPage: true });

    // ---- Ask AI ----
    await p.goto(`${BASE}/admin/#customers/ask`); await p.waitForSelector('[data-q]');
    ok('Ask AI', 'common questions offered (most orders, suburbs, repeat, quotes waiting, owing…)', (await p.$$('[data-q]')).length >= 10);
    await p.click('[data-q="Which customers have the most orders?"]');
    await p.waitForFunction(() => /#sql\/ask/.test(location.hash)); await p.waitForSelector('.ask-ans .ask-a:not(:has(.ask-think))', { timeout: 20000 });
    const q1 = seen.find((x) => /Turn the question/.test(x.sys));
    ok('Ask AI', 'the question runs on the AI query, which is given the customers table', q1 && /customers\(/.test(q1.raw) && /confirmed_jobs/.test(q1.raw));
    ok('Ask AI', 'answer and results come back (Ann / Bob in the table)', /confirmed jobs/.test(await p.textContent('.ask-a')) && (await p.evaluate(() => window.MBS.sqlState.rows.map((r) => r.name).join(','))) === 'Ann Lee,Bob Tan,Gina Gone', await p.evaluate(() => JSON.stringify(window.MBS.sqlState.rows)));
    // SQL wizard: customers table and templates
    const sqlData = await (await p.request.post(`${BASE}/.netlify/functions/admin`, { data: { action: 'sqlData' }, headers: { 'X-MBS-Admin': '1' } })).json();
    const cRows = sqlData.data.customers;
    ok('SQL', 'customers table in the SQL wizard (7 customers, jobs.customer filled)', cRows.length === 7 && sqlData.data.jobs.filter((j) => j.customer).length === sqlData.data.jobs.length - 1, cRows.length);
    await p.goto(`${BASE}/admin/#sql/templates`); await p.waitForSelector('.tpl'); await p.click('.tpl >> text=Customers with the most orders'); await p.waitForSelector('#sqlResults canvas, #sqlResults table');
    ok('SQL', 'Customers templates run (most orders: Ann 2)', await p.evaluate(() => window.MBS.sqlState.rows[0].name === 'Ann Lee' && window.MBS.sqlState.rows[0].confirmed_jobs === 2));
    await p.goto(`${BASE}/admin/#customers/list`); await p.waitForSelector('.ctable');
    await p.goto(`${BASE}/admin/#sql/templates`); await p.waitForSelector('.tpl'); await p.click('.tpl >> text=Customers to win back'); await p.waitForSelector('#sqlResults canvas, #sqlResults table');
    ok('SQL', '"Customers to win back" template finds Gina (and only Gina)', await p.evaluate(() => window.MBS.sqlState.rows.map((r) => r.name).join(',') === 'Gina Gone'), await p.evaluate(() => JSON.stringify(window.MBS.sqlState.rows)));

    // ---- rebuild keeps edits ----
    await p.goto(`${BASE}/admin/#customers/list`); await p.waitForSelector('#custRebuild'); await p.click('#custRebuild'); await p.waitForSelector('.toast >> text=customers from');
    d = await kv.get('customers');
    ok('Rebuild', 'rebuild from jobs keeps tags and notes and the same customer numbers', d.list[ann.id].notes === 'Prefers SMS' && d.list[ann.id].jobs.length === 3 && Object.keys(d.list).length === 7);

    // ---- phone ----
    const ph = await ctx.newPage(); await ph.setViewportSize({ width: 390, height: 844 });
    await ph.route(/tile\.openstreetmap\.org/, (rt) => rt.abort());
    ph.on('pageerror', (e) => errors.push('phone: ' + e.message));
    await ph.goto(`${BASE}/admin/#customers/list`, { waitUntil: 'domcontentloaded' }); await ph.waitForSelector('.ctable');
    ok('Phone', 'customer list fits on a phone (table scrolls inside its box)', await ph.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await ph.goto(`${BASE}/admin/#customers/map`); await ph.waitForSelector('.leaflet-container');
    ok('Phone', 'map fits on a phone', await ph.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await ph.close();
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close();
  } catch (e) { try { if (br) await br.close(); } catch {} ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ')); }
  await cleanup();
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  if (pass !== results.length) console.log('\n--- server log ---\n' + log.slice(-2500));
})();
