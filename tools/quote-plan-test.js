// End-to-end test of v28: project plan -> "📄 Quote & PM plan" -> quote (customer details, lines, plan copy) -> PDF pack
// (cover + quote + 2 plan pages) -> kept in step with the plan -> tax invoice -> paid. Real Blobs, local site, headless Chromium.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const SITE = path.resolve(process.argv[2]);
const PORT = 8905, BASE = `http://127.0.0.1:${PORT}`;
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => { results.push({ area, name, pass: !!pass, detail }); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const { PDFDocument } = require(require.resolve('pdf-lib', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-quote-blobs'); fs.rmSync(dir, { recursive: true, force: true });
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
    const J = await import(path.join(SITE, 'netlify/lib/jobs.mjs'));
    const kv = await import(path.join(SITE, 'netlify/lib/kv.mjs'));
    const P = await import(path.join(SITE, 'netlify/lib/plan.mjs'));
    const core = await J.nextCore('E');
    await J.create({ core, name: 'Sashi Kumar', phone: '0412 345 678', email: 'sashi@example.com', suburb: 'Cabramatta West NSW 2166', service: 'Repair question (Ask Mr. Fixit)', source: 'Website chat', summary: 'Customer Sashi Kumar has asked about a noisy bathroom exhaust fan.' });
    await J.setStage(core, 'called', 'test');
    const T = (id, name, dur, qty, unit, rate, pred, subs) => ({ id, name, dur, qty, unit, rate, pred, res: [], status: 'todo', pct: 0, subs: (subs || []).map((n, i) => ({ id: id + 's' + i, name: n, off: 0, dur: 1, status: 'todo' })) });
    await P.save(core, { name: 'Bathroom exhaust fan repair', start: '2026-11-02', charter: { objective: 'Replace the noisy fan and vent it outside.', inScope: '- New fan\n- Duct to the eave\n- Patch and paint', outScope: 'Other electrical work', deliverables: 'Compliance certificate', acceptance: 'Clears steam in 10 minutes', assumptions: 'Ceiling space accessible' },
      tasks: [T('t1', 'Site inspection & measure', 1, 2, 'h', 90, []), T('t2', 'Quote accepted', 0, 0, '', 0, ['t1']), T('t3', 'Order fan & ducting', 1, 1, 'lot', 260, ['t2']), T('t4', 'Install new fan and duct outside', 2, 3, 'h', 110, ['t3'], ['Cut opening', 'Duct to eave']), T('t5', 'Patch & paint ceiling', 1, 3, 'h', 70, ['t4']), T('t6', 'Handover', 0, 0, '', 0, ['t5'])],
      risks: [{ id: 'r1', title: 'Asbestos in old ceiling', p: 2, i: 5, response: 'Avoid', action: 'Test before cutting', status: 'Open' }], issues: [] }, 0, 'test');

    br = await chromium.launch();
    const ctx = await br.newContext({ viewport: { width: 1500, height: 950 } });
    const p = await ctx.newPage(); p.setDefaultTimeout(10000);
    const errors = []; errorsAll = errors;
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('dialog', (x) => { errors.push('dialog: ' + x.message()); x.dismiss(); });
    const api = async (action, data = {}) => (await p.request.post(`${BASE}/.netlify/functions/admin`, { data: { action, ...data }, headers: { 'X-MBS-Admin': '1' } })).json();
    const pdfPages = async (id) => { const r = await p.request.get(`${BASE}/.netlify/functions/admin?action=pdf&id=${id}`); const b = await r.body(); return { type: r.headers()['content-type'], pages: (await PDFDocument.load(b)).getPageCount(), bytes: b }; };
    let r = await p.request.post(`${BASE}/.netlify/functions/admin`, { data: { action: 'planQuote', core }, headers: { 'X-MBS-Admin': '1' } });
    ok('Security', 'making a quote from a plan needs a login', r.status() === 401, r.status());
    await p.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
    await p.fill('[name=username]', 'sashi73'); await p.fill('[name=password]', 'sashi98'); await p.click('#loginForm button');
    await p.waitForSelector('#app:not([hidden])');

    // ---- plan page: button + value chain ----
    await p.goto(`${BASE}/admin/#plan/${core}/schedule`); await p.waitForSelector('#planQuote'); await p.waitForSelector('.vchain');
    ok('Plan', '"📄 Quote & PM plan" button on the plan', /Quote & PM plan/.test(await p.textContent('#planQuote')));
    ok('Chain', 'value chain strip: Plan > Quote > Accepted > Invoice > Paid (not quoted yet)', (await p.$$('.vstep')).length === 5 && /not quoted yet/.test(await p.textContent('.vchain')));
    await p.click('#planQuote'); await p.waitForSelector('#qForm');
    ok('Dialog', 'customer name, phone and email filled in from the job', (await p.inputValue('#qForm [name=name]')) === 'Sashi Kumar' && (await p.inputValue('#qForm [name=phone]')) === '0412 345 678' && (await p.inputValue('#qForm [name=email]')) === 'sashi@example.com');
    ok('Dialog', 'address starts as the suburb on file', /Cabramatta West/.test(await p.inputValue('#qForm [name=address]')));
    ok('Dialog', 'preview: 4 lines, total $1,078.00 inc GST at no margin', /4 lines/.test(await p.textContent('#qPrev')) && /total \$1,078\.00/.test(await p.textContent('#qPrev')), await p.textContent('#qPrev'));
    await p.fill('#qForm [name=address]', '12 Smith St, Cabramatta West NSW 2166');
    await p.fill('#qForm [name=margin]', '10');
    ok('Dialog', 'margin 10% shows in the preview ($1,185.80)', /total \$1,185\.80/.test(await p.textContent('#qPrev')), await p.textContent('#qPrev'));
    await p.click('#qGo'); await p.waitForSelector('#qOpen');
    const qid = (await p.textContent('#modalBody h2')).match(/Q-\d+/)[0];
    let q = await kv.get('quote:' + qid);
    ok('Quote', `quote ${qid} made in Quotes as a draft, linked to the job`, q && q.status === 'draft' && q.core === core && q.type === 'quote');
    ok('Quote', 'customer name, address, phone and email transferred', q.customer.name === 'Sashi Kumar' && q.customer.address === '12 Smith St, Cabramatta West NSW 2166' && q.customer.phone === '0412 345 678' && q.customer.email === 'sashi@example.com');
    ok('Quote', 'one line per costed task (milestones left out), sub-steps listed, 10% margin on unit prices', q.items.length === 4 && q.items[0].price === 99 && /Install new fan and duct outside \(3 h\): Cut opening, Duct to eave/.test(q.items[2].desc) && q.totals.inc === 1185.8, JSON.stringify(q.items));
    ok('Quote', 'title, planned dates in the notes, and a frozen copy of the plan', q.title === 'Bathroom exhaust fan repair' && /Work planned to start/.test(q.notes) && q.plan && q.plan.snapshot && q.plan.snapshot.tasks.length === 6 && q.plan.snapshot.risks.length === 1);
    const cd = await kv.get('customers');
    ok('Customer', 'the full address is saved to the customer record too', Object.values(cd.list).some((c) => c.address === '12 Smith St, Cabramatta West NSW 2166'));
    let pdf = await pdfPages(qid);
    ok('PDF', 'quote PDF is a 4-page pack: cover, quote, project plan, schedule + Gantt', pdf.type === 'application/pdf' && pdf.pages === 4, pdf.pages);
    fs.writeFileSync('MBS_quote_pack.pdf', pdf.bytes);
    await p.click('#qOpen'); await p.waitForSelector('#docPlan');
    ok('Quotes', 'the quote in Quotes says it came from the project plan, with a link back', /Made from the project plan/.test(await p.textContent('#docPlan')) && !!(await p.$(`#docPlan a[href="#plan/${core}"]`)));

    // ---- keep in step: the plan changes ----
    await p.goto(`${BASE}/admin/#plan/${core}/schedule`); await p.waitForSelector('.vchain');
    ok('Chain', 'chain shows the draft quote', new RegExp(qid + ' · Draft').test(await p.textContent('.vchain')));
    await p.click('[data-cols=c]');
    const t5 = 'tr[data-tid="t5"] [data-k=rate]';
    await p.fill(t5, '80'); await p.dispatchEvent(t5, 'change');
    await p.waitForSelector('[data-qact=update]', { timeout: 8000 });
    ok('Sync', 'when the plan changes, the chain says so and offers "Update the quote from the plan"', /plan changed/.test(await p.textContent('.vchain')) && /Update/.test(await p.textContent('[data-qact=update]')));
    await p.click('[data-qact=update]'); await p.waitForSelector('#qForm');
    ok('Sync', 'update keeps the margin used before (10%)', (await p.inputValue('#qForm [name=margin]')) === '10');
    await p.click('#qGo'); await p.waitForSelector('#qOpen'); await p.click('[data-close]');
    q = await kv.get('quote:' + qid);
    ok('Sync', 'the same draft quote now has the new price (patch & paint 3 h at $88)', q.items[3].price === 88 && (await api('acctLists')).quotes.length === 1, JSON.stringify(q.items[3]));
    await p.waitForFunction(() => !/plan changed/.test(document.querySelector('.vchain').textContent));
    ok('Sync', 'chain back in step', true);

    // ---- sent -> accepted -> invoice -> paid ----
    await api('docStatus', { id: qid, status: 'sent' });
    ok('Pipeline', 'quote sent: the job moves to Quoted with the amount', (await J.find(core)).stage === 'quoted' && (await J.find(core)).quote.amount === q.totals.inc);
    await p.fill(t5, '85'); await p.dispatchEvent(t5, 'change'); await p.waitForSelector('.vact >> text=Make a revised quote', { timeout: 8000 });
    ok('Sync', 'after the quote is sent, a plan change offers a revised quote (a sent quote is never changed)', true);
    await api('docStatus', { id: qid, status: 'accepted' });
    ok('Pipeline', 'quote accepted: job won', (await J.find(core)).stage === 'won');
    await p.reload(); await p.waitForSelector('[data-qact=invoice]');
    await p.click('[data-qact=invoice]'); await p.click('#okBtn'); await p.waitForFunction(() => /#doc\/INV-/.test(location.hash));
    const iid = (await p.evaluate(() => location.hash)).match(/INV-\d+/)[0];
    const inv = await kv.get('invoice:' + iid);
    ok('Invoice', 'tax invoice made from the quote: same lines, customer and plan link', inv.fromQuote === qid && inv.items.length === 4 && inv.customer.address === '12 Smith St, Cabramatta West NSW 2166' && inv.plan && inv.plan.fromQuote === qid);
    await p.waitForSelector('#docPlan');
    ok('Invoice', 'invoice page shows the plan link (PDF shows today\'s progress)', /progress/.test(await p.textContent('#docPlan')));
    pdf = await pdfPages(iid);
    ok('PDF', 'invoice PDF is a 4-page pack too (cover, tax invoice, project summary, schedule & progress)', pdf.pages === 4, pdf.pages);
    fs.writeFileSync('MBS_invoice_pack.pdf', pdf.bytes);
    await api('docStatus', { id: iid, status: 'sent' });
    await api('payAdd', { id: iid, amount: inv.totals.inc, method: 'Bank transfer' });
    ok('Pipeline', 'invoice paid in full: job paid', (await J.find(core)).stage === 'paid');
    await p.goto(`${BASE}/admin/#plan/${core}/overview`); await p.waitForSelector('.vchain');
    await p.waitForFunction(() => /paid in full/.test(document.querySelector('.vchain').textContent));
    ok('Chain', 'value chain complete on the plan: every step done, invoice paid in full', (await p.$$('.vstep.done')).length === 5);
    await p.screenshot({ path: 'MBS_value_chain.jpg', type: 'jpeg', quality: 80 });

    // ---- one-line (lump sum) revision ----
    r = await api('planQuote', { core, mode: 'lump', margin: 0 });
    const q2 = await kv.get('quote:' + r.doc.id);
    ok('Quote', '"one total line" option makes a single line; a new quote records which one it revises', q2.items.length === 1 && /supply and install as per the project plan/.test(q2.items[0].desc) && q2.plan.revises === qid);
    // a manual quote (not from a plan) keeps the plain PDF
    const mq = await api('docCreate', { type: 'quote', fields: { customer: { name: 'Walk-in' }, items: [{ desc: 'Small repair', qty: 1, price: 100 }] } });
    ok('PDF', 'a quote made by hand (no plan) stays a normal 1-page PDF', (await pdfPages(mq.doc.id)).pages === 1);
    r = await api('planQuote', { core: 'nope' });
    ok('Safety', 'unknown job is refused', r.error === 'Job not found');
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close(); br = null;
  } catch (e) { try { if (br) await br.close(); } catch {} ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ')); }
  await cleanup();
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  if (pass !== results.length) console.log('\n--- server log ---\n' + log.slice(-2500));
})();
