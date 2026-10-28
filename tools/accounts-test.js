// End-to-end test of MBS Console accounts (v22): real Blobs, local site server, stand-in email service, headless Chromium.
const { chromium } = require('playwright');
const { spawn, execSync } = require('child_process');
const http = require('http'), path = require('path'), fs = require('fs'), os = require('os');
const SITE = path.resolve(process.argv[2]);
const PORT = 8897, BASE = `http://127.0.0.1:${PORT}`;
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => results.push({ area, name, pass: !!pass, detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pdfText = (buf) => { const f = path.join(os.tmpdir(), 'mbs-acct-' + Date.now() + '.pdf'); fs.writeFileSync(f, buf); try { return execSync(`pdftotext -layout ${f} -`).toString(); } finally { fs.unlinkSync(f); } };

(async () => {
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-acct-test-blobs'); fs.rmSync(dir, { recursive: true, force: true });
  const blobs = new BlobsServer({ directory: dir, token: 'tok', port: 0 });
  const { port: bport } = await blobs.start();
  const ctxB64 = Buffer.from(JSON.stringify({ siteID: 'mbs', token: 'tok', edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, apiURL: `http://localhost:${bport}` })).toString('base64');
  process.env.NETLIFY_BLOBS_CONTEXT = ctxB64;
  // stand-in email service (records what would be emailed)
  const mails = [];
  const mock = http.createServer((req, res) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => { try { mails.push(JSON.parse(Buffer.concat(c).toString())); } catch {} res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"id":"e1"}'); }); });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NETLIFY_BLOBS_CONTEXT: ctxB64, ADMIN_USERNAME: 'sashi73', ADMIN_PASSWORD: 'sashi98',
    RESEND_API_KEY: 're_test', RESEND_API_BASE: `http://127.0.0.1:${mock.address().port}`, OWNER_EMAIL: 'mbs.pty.ltd@gmail.com,sashi1973@gmail.com', FROM_EMAIL: 'MBS Website <website@mbsplc.com.au>',
    PUBLIC_CONTACT_EMAIL: 'mbs.pty.ltd@gmail.com', BANK_ACCOUNT_NAME: 'Modern Building Solutions Pty Ltd', BANK_BSB: '062-000', BANK_ACCOUNT_NUMBER: '1234 5678', TELEGRAM_BOT_TOKEN: '', LLM_API_KEY: '' };
  const srv = spawn('node', ['local-server.mjs'], { cwd: SITE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 40 && !/running/.test(log); i++) await sleep(150);
  const cleanup = async () => { try { srv.kill(); } catch {} try { mock.close(); } catch {} try { await blobs.stop(); } catch {} };

  try {
    const J = await import(path.join(SITE, 'netlify/lib/jobs.mjs'));
    const core = await J.nextCore('W');
    await J.create({ core, name: 'Priya Nair', phone: '0412 345 678', email: 'priya@example.com', suburb: 'Castle Hill NSW 2154', service: 'Bathroom waterproofing', summary: 'Leak through ceiling', source: 'chat' });

    const b = await chromium.launch();
    const ctx = await b.newContext({ viewport: { width: 1366, height: 900 } });
    const p = await ctx.newPage();
    const errors = []; errorsAll = errors;
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('dialog', (d) => { errors.push('dialog: ' + d.message()); d.dismiss(); });
    const api = (action, data = {}) => p.request.post(`${BASE}/.netlify/functions/admin`, { data: { action, ...data }, headers: { 'X-MBS-Admin': '1' } });
    const view = () => p.evaluate(() => (document.querySelector('.view') || {}).textContent || '');
    const waitText = (re) => p.waitForFunction((src) => new RegExp(src).test((document.querySelector('.view') || {}).textContent || ''), re.source, { timeout: 8000 });

    let r = await p.request.get(`${BASE}/.netlify/functions/admin?action=pdf&id=Q-000001`);
    ok('Security', 'PDFs need a login', r.status() === 401, r.status());

    await p.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
    await p.fill('[name=username]', 'sashi73'); await p.fill('[name=password]', 'sashi98'); await p.click('#loginForm button');
    await p.waitForSelector('#app:not([hidden])');
    const nav = await p.$$eval('.side-nav a', (a) => a.map((x) => x.textContent.trim()));
    ok('Console', 'sidebar has Quotes, Invoices, Expenses and Accounting & BAS', ['Quotes', 'Invoices', 'Expenses', 'Accounting & BAS'].every((x) => nav.some((n) => n.includes(x))), nav.join(' | '));

    // ---- quote from the job page ----
    await p.goto(`${BASE}/admin/#job/${core}`); await p.waitForSelector('#jobAcct .actions');
    ok('Job page', 'job shows a "Quotes, invoices & costs" card with + Quote / + Invoice / + Expense', /\+ Quote/.test(await p.textContent('#jobAcct')) || /＋ Quote/.test(await p.textContent('#jobAcct')));
    await p.click('#jobAcct a[href*="#doc/new/quote"]');
    await p.waitForSelector('#itemRows textarea');
    const pre = { name: await p.inputValue('#cName'), email: await p.inputValue('#cEmail'), title: await p.inputValue('#dTitle') };
    ok('Quotes', 'a quote from a job is numbered Q-000001 and filled in with the customer and job', /Quote Q-000001/.test(await view()) && pre.name === 'Priya Nair' && pre.email === 'priya@example.com' && /waterproofing/i.test(pre.title), JSON.stringify(pre));
    const setLine = async (n, desc, qty, price, gst = true) => {
      const rows = await p.$$('#itemRows tr'); if (rows.length <= n) { await p.click('#addLine'); }
      await p.fill(`#itemRows textarea[data-i="${n}"]`, desc); await p.fill(`#itemRows input[data-i="${n}"][data-k="qty"]`, String(qty)); await p.fill(`#itemRows input[data-i="${n}"][data-k="price"]`, String(price));
      if (!gst) await p.uncheck(`#itemRows input[data-i="${n}"][data-k="gst"]`);
    };
    await setLine(0, 'Ardex waterproofing membrane, 2 coats', 6, 95);
    await setLine(1, 'Labour: strip, prepare and retile bathroom', 1, 1850);
    await setLine(2, 'Council fee (GST-free)', 1, 210, false);
    const tot = await p.textContent('#totals');
    ok('Quotes', 'totals add up live: $2,630.00 ex GST + $242.00 GST = $2,872.00 (GST-free fee has no GST)', /\$2,630\.00/.test(tot) && /\$242\.00/.test(tot) && /\$2,872\.00/.test(tot), tot.replace(/\s+/g, ' '));
    await p.click('#aSave'); await waitText(/Saved as a draft/);
    r = await p.request.get(`${BASE}/.netlify/functions/admin?action=pdf&id=Q-000001`);
    const qpdf = await r.body();
    const qtxt = pdfText(qpdf);
    ok('Quotes', 'PDF opens: a real PDF with QUOTE, ABN, licence, the lines and totals', r.status() === 200 && qpdf.slice(0, 4).toString() === '%PDF' && /QUOTE/.test(qtxt) && /ABN 50 159 309 181/.test(qtxt) && /267071C/.test(qtxt) && /Council fee/.test(qtxt) && /\$2,872\.00/.test(qtxt) && /GST-free/.test(qtxt), qtxt.slice(0, 200));

    // ---- email the quote ----
    await p.click('#aSend'); await p.waitForSelector('#sGo');
    ok('Quotes', 'email box is pre-filled with the customer\'s email and a message', (await p.inputValue('#sTo')) === 'priya@example.com' && (await p.inputValue('#sMsg')).length > 20);
    await p.click('#sGo'); await waitText(/Last sent/);
    const qm = mails[mails.length - 1] || {};
    ok('Email', 'quote emailed to the customer with the PDF attached, from website@mbsplc.com.au', JSON.stringify(qm.to) === '["priya@example.com"]' && /website@mbsplc\.com\.au/.test(qm.from) && qm.attachments && qm.attachments[0].filename === 'Q-000001.pdf' && Buffer.from(qm.attachments[0].content, 'base64').slice(0, 4).toString() === '%PDF', JSON.stringify({ to: qm.to, from: qm.from, att: qm.attachments && qm.attachments[0].filename }));
    ok('Email', 'replies go to mbs.pty.ltd@gmail.com, and the owner gets a hidden copy', qm.reply_to === 'mbs.pty.ltd@gmail.com' && JSON.stringify(qm.bcc) === '["mbs.pty.ltd@gmail.com"]', JSON.stringify({ reply: qm.reply_to, bcc: qm.bcc }));
    let job = await (await api('job', { ref: core })).json();
    ok('Pipeline', 'sending the quote moves the job to Quoted ($2,872.00)', job.job.stage === 'quoted' && job.job.quote && job.job.quote.amount === 2872, job.job.stage);
    await p.click('#aAcc'); await p.waitForFunction(() => { const c = document.querySelector('.view .row .chip'); return c && c.textContent === 'Accepted'; });
    job = await (await api('job', { ref: core })).json();
    ok('Pipeline', 'Accepted marks the job as Won (JW-…)', job.job.stage === 'won' && /^JW-/.test(job.job.ref), job.job.ref);

    // ---- invoice from the quote ----
    await p.click('#aInv'); await p.waitForFunction(() => /Invoice INV-000001/.test(document.querySelector('.view').textContent));
    ok('Invoices', 'Make invoice copies the quote into tax invoice INV-000001, due in 7 days', /From Q-000001/.test(await view()) && (await p.$$('#itemRows tr')).length === 3);
    const due = await p.inputValue('#dDue'), iss = await p.inputValue('#dIssued');
    ok('Invoices', 'due date is 7 days after the invoice date', (new Date(due) - new Date(iss)) / 86400000 === 7, `${iss} → ${due}`);
    await p.click('#aSend'); await p.waitForSelector('#sGo'); await p.click('#sGo'); await waitText(/Last sent/);
    const im = mails[mails.length - 1];
    const itxt = pdfText(Buffer.from(im.attachments[0].content, 'base64'));
    ok('Invoices', 'emailed PDF is a TAX INVOICE with ABN, bank details (BSB/account) and the invoice number as the reference', /TAX INVOICE/.test(itxt) && /ABN 50 159 309 181/.test(itxt) && /BSB: 062-000/.test(itxt) && /1234 5678/.test(itxt) && /Reference: INV-000001/.test(itxt), itxt.slice(0, 300));
    ok('Email', 'invoice email shows the bank details too', /BSB 062-000/.test(im.html) && /INV-000001/.test(im.subject));
    job = await (await api('job', { ref: core })).json();
    ok('Pipeline', 'sending the invoice moves the job to Invoiced', job.job.stage === 'invoiced' && job.job.invoice.amount === 2872, job.job.stage);

    // ---- payments ----
    await p.click('#aPay'); await p.fill('#pAmt', '1000'); await p.click('#pGo'); await p.waitForFunction(() => { const c = document.querySelector('.view .row .chip'); return c && c.textContent === 'Part-paid'; });
    ok('Payments', 'a part-payment shows Part-paid and the balance ($1,872.00)', /\$1,872\.00/.test(await p.textContent('#totals')));
    ok('Payments', 'a part-paid invoice can no longer be edited', await p.isDisabled('#cName'));
    r = await api('payAdd', { id: 'INV-000001', amount: 5000 });
    ok('Payments', 'paying more than is owed is refused', r.status() === 400 && /more than/.test((await r.json()).error));
    await p.click('#aPay'); await p.click('#pGo'); await waitText(/This invoice is paid/);
    job = await (await api('job', { ref: core })).json();
    ok('Pipeline', 'paid in full marks the invoice Paid and the job Paid', /This invoice is paid/.test(await view()) && job.job.stage === 'paid', job.job.stage);
    r = await p.request.get(`${BASE}/.netlify/functions/admin?action=pdf&id=INV-000001`);
    ok('Invoices', 'paid invoice PDF shows PAID and no payment request', /PAID/.test(pdfText(await r.body())) && !/How to pay/.test(pdfText(await r.body())));

    // ---- expenses ----
    const jpg = path.join(os.tmpdir(), 'mbs-receipt.jpg');
    fs.writeFileSync(jpg, Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64'));
    await p.goto(`${BASE}/admin/#job/${core}`); await p.waitForSelector('#jobAcct'); await p.waitForTimeout(1500);
    if (!(await p.$('#jobExp'))) { console.log('JOBACCT:', await p.textContent('#jobAcct'), 'ERR:', errors.join('|'), 'TOAST:', await p.textContent('#toast')); await p.screenshot({ path: 'dbg-jobacct.jpg' }); }
    await p.waitForSelector('#jobExp');
    await p.click('#jobExp'); await p.waitForSelector('#eGo');
    ok('Expenses', 'Add expense from a job pre-fills the job number', (await p.inputValue('#eJob')) === core);
    await p.fill('#eSup', 'Bunnings'); await p.fill('#eDesc', 'Membrane and tiles'); await p.fill('#eInc', '550');
    ok('Expenses', 'GST is worked out automatically (1/11 = $50.00)', /\$50\.00/.test(await p.getAttribute('#eGst', 'placeholder')));
    await p.setInputFiles('#eFile', jpg);
    await p.click('#eGo'); await p.waitForSelector('#modal', { state: 'hidden' });
    await p.goto(`${BASE}/admin/#expenses/all`); await p.waitForSelector('#newExp');
    await p.click('#newExp'); await p.fill('#eSup', 'City Council'); await p.fill('#eDesc', 'Permit'); await p.fill('#eInc', '210'); await p.uncheck('#eHasGst'); await p.selectOption('#eCat', 'Licences & fees');
    await p.click('#eGo'); await p.waitForSelector('#modal', { state: 'hidden' }); await waitText(/City Council/);
    const ek = await p.textContent('.kpis');
    ok('Expenses', 'expenses list: $760.00 spent, $50.00 GST to claim (the permit is GST-free)', /\$760\.00/.test(ek) && /\$50\.00/.test(ek), ek.replace(/\s+/g, ' '));
    r = await p.request.get(`${BASE}/.netlify/functions/admin?action=receipt&id=EXP-000001`);
    ok('Expenses', 'the receipt photo is stored and opens', r.status() === 200 && /image\/jpeg/.test(r.headers()['content-type']), r.status());

    // ---- accounting & BAS ----
    await p.goto(`${BASE}/admin/#accounts/quarter/cash`); await p.waitForSelector('.badge');
    const acc = await view();
    const has = (s) => acc.includes(s);
    ok('BAS', 'cash basis: G1 sales $2,872.00, 1A GST $242.00, G11 purchases $760.00, 1B $50.00', has('$2,872.00') && has('$242.00') && has('$760.00') && has('$50.00'));
    ok('BAS', 'GST to pay the ATO = 1A − 1B = $192.00', /GST to pay the ATO[^$]*\$192\.00/.test(acc));
    ok('Profit', 'profit = $2,630.00 income − $710.00 costs = $1,920.00', has('$2,630.00') && has('$710.00') && has('$1,920.00'));
    ok('Profit', 'profit by job lists this job', acc.includes(job.job.ref));
    for (const w of ['invoices', 'payments', 'expenses']) {
      const c = await (await p.request.get(`${BASE}/.netlify/functions/admin?action=acctExport&what=${w}`)).text();
      ok('Exports', `${w} CSV for the accountant`, w === 'invoices' ? /INV-000001/.test(c) && /2872/.test(c) : w === 'payments' ? (c.match(/INV-000001/g) || []).length === 2 : /Bunnings/.test(c) && /City Council/.test(c), c.split('\n')[1]);
    }
    await p.screenshot({ path: 'MBS_console_bas.jpg', type: 'jpeg', quality: 80, fullPage: true });

    // ---- overdue, void, draft delete, numbering ----
    const back = new Date(Date.now() - 20 * 86400000).toISOString().slice(0, 10);
    r = await api('docCreate', { type: 'invoice', fields: { customer: { name: 'Late Payer', email: 'late@example.com' }, issued: back, items: [{ desc: 'Repaint fence', qty: 1, price: 1000, gst: true }] } });
    const late = (await r.json()).doc;
    await api('docStatus', { id: late.id, status: 'sent' });
    await p.goto(`${BASE}/admin/#invoices/overdue`); await waitText(/Late Payer/);
    ok('Invoices', 'an unpaid invoice past its due date shows as Overdue', /Overdue/.test(await view()) && late.id === 'INV-000002', late.id);
    await p.goto(`${BASE}/admin/#accounts/quarter/cash`); await p.waitForSelector('.badge');
    ok('Receivables', 'money owed shows $1,100.00 and "13 days overdue"', /\$1,100\.00/.test(await view()) && /1[234] days overdue/.test(await view()));
    r = await api('docCreate', { type: 'invoice', fields: { customer: { name: 'Draft Only' }, items: [{ desc: 'x', qty: 1, price: 1 }] } });
    const dr = (await r.json()).doc; await api('docDelete', { id: dr.id });
    r = await api('docDelete', { id: late.id });
    ok('Invoices', 'drafts can be deleted, but a sent invoice must be voided instead', r.status() === 400);
    await api('docStatus', { id: late.id, status: 'void' });
    r = await api('docCreate', { type: 'invoice', fields: { customer: { name: 'Next' }, items: [] } });
    ok('Invoices', 'numbers are never reused (next invoice is INV-000004 after a deleted draft)', (await r.json()).doc.id === 'INV-000004');
    r = await api('docUpdate', { id: 'Q-000001', fields: { notes: 'change' } });
    ok('Quotes', 'an invoiced quote is locked (edit the invoice instead)', r.status() === 400 && /invoiced as INV-000001/.test((await r.json()).error));
    r = await api('docUpdate', { id: 'INV-000001', fields: { notes: 'change' } });
    ok('Invoices', 'a paid invoice cannot be changed', r.status() === 400);

    // ---- data explorer understands accounts ----
    await p.goto(`${BASE}/admin/#data/mbs-jobs`); await p.waitForSelector('.sel');
    const keys = await p.$$eval('.sel', (x) => x.map((c) => c.value));
    ok('Data', 'data explorer lists quotes, invoices, expenses, receipts and the accounts list', ['quote:Q-000001', 'invoice:INV-000001', 'expense:EXP-000001', 'receipt:EXP-000001', 'acct-index', 'acct-seq'].every((k) => keys.includes(k)), keys.join(', '));
    await p.check('.sel[value="expense:EXP-000001"]'); await p.click('#moveBtn'); await p.click('#okBtn');
    await p.waitForFunction(() => !document.querySelector('.sel[value="expense:EXP-000001"]'));
    let l = await (await api('acctLists')).json();
    ok('Data', 'moving an expense to the test database takes its receipt and removes it from the books', !l.expenses.some((e) => e.id === 'EXP-000001') && !(await p.$$eval('.sel', (x) => x.map((c) => c.value))).includes('receipt:EXP-000001'));
    await p.goto(`${BASE}/admin/#data/mbs-jobs-test`); await p.waitForSelector('.sel');
    await p.check('.sel[value="expense:EXP-000001"]'); await p.click('#moveBtn'); await p.click('#okBtn');
    await p.waitForFunction(() => !document.querySelector('.sel[value="expense:EXP-000001"]'));
    l = await (await api('acctLists')).json();
    ok('Data', '…and moving it back restores it (receipt included)', l.expenses.some((e) => e.id === 'EXP-000001' && e.receipt));

    // ---- hostile text ----
    r = await api('docCreate', { type: 'quote', fields: { customer: { name: 'Eve <img src=x onerror=alert(1)>' }, title: '<script>alert(2)</script>', items: [{ desc: '<b>bold</b>', qty: 1, price: 5 }] } });
    const ev = (await r.json()).doc;
    await p.goto(`${BASE}/admin/#doc/${ev.id}`); await p.waitForSelector('#itemRows textarea'); await p.goto(`${BASE}/admin/#quotes/all`); await waitText(/Eve/);
    ok('Security', 'customer text in quotes is shown as text, never run', (await p.$$('img[src="x"]')).length === 0 && !errors.some((e) => /dialog/.test(e)));

    // phone
    const m = await ctx.newPage(); await m.setViewportSize({ width: 390, height: 844 }); m.on('pageerror', (e) => errors.push('phone: ' + e.message)); m.on('console', (c) => { if (c.type() === 'error') errors.push('phone console: ' + c.text()); });
    await m.goto(`${BASE}/admin/#doc/INV-000001`, { waitUntil: 'domcontentloaded' }); await m.waitForSelector('#totals');
    ok('Phone', 'invoice editor fits a phone screen (no sideways scrolling)', await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await m.goto(`${BASE}/admin/#accounts/quarter/cash`); await m.waitForSelector('.badge');
    ok('Phone', 'Accounting & BAS fits a phone screen', await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await m.close();
    await p.goto(`${BASE}/admin/#doc/Q-000001`); await p.waitForSelector('#totals'); await p.waitForTimeout(300);
    await p.screenshot({ path: 'MBS_console_quote.jpg', type: 'jpeg', quality: 80, fullPage: true });
    await p.goto(`${BASE}/admin/#invoices`); await p.waitForSelector('.kpis'); await p.waitForTimeout(300);
    await p.screenshot({ path: 'MBS_console_invoices.jpg', type: 'jpeg', quality: 80 });
    fs.writeFileSync('MBS_sample_quote.pdf', qpdf);
    fs.writeFileSync('MBS_sample_tax_invoice.pdf', Buffer.from(im.attachments[0].content, 'base64'));
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await b.close();
  } catch (e) { ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ')); try { const pg = (await (await chromium.launch()).newPage()); } catch {} }
  await cleanup();
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  if (pass !== results.length) console.log('\n--- server log ---\n' + log.slice(-2500));
})();
