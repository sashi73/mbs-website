// v53: 📜 Contracts tab (contract and vendor management): head contract with the customer, a sub-contract with a subbie
// (whose papers have expired), a supply contract; variations, progress claims, alerts and totals; upload a contract PDF and
// ✨ fill in the terms (stand-in AI); Project Intelligence and Ask AI see the contracts; Excel export. Real Blobs, Chromium.
// node contracts-test.js <site> [folder with node_modules/exceljs]
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const SITE = path.resolve(process.argv[2]);
const XL = path.resolve(process.argv[3] || path.join(__dirname, 'xl'));
const PORT = 8953, BASE = `http://127.0.0.1:${PORT}`;
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => results.push({ area, name, pass: !!pass, detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const seen = [];
const mock = http.createServer((req, res) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => {
  const body = JSON.parse(Buffer.concat(c).toString() || '{}'), sys = body.messages[0].content, user = body.messages[1].content;
  seen.push({ sys, user });
  let out = { answer: 'ok' };
  if (/read construction contracts/.test(sys)) out = { type: 'Subcontract', party: 'Hills Plumbing Services', title: 'Rough-in and fit-off plumbing', ref: 'SC-2026-014', form: 'AS 4903 subcontract', value: 12500, gst_included: false,
    terms: '30 days from claim', retention_pct: 5, start: '2026-11-09', end: '2026-12-04', signed: '2026-11-02', defects_months: 12, ld_per_day: 150, insurance: 'Public liability $20m',
    obligations: '- Give 5 days notice of any delay\n- Variations agreed in writing first', claims: [{ desc: 'Rough-in', amount: 0, pct: 50 }, { desc: 'Fit-off', amount: 0, pct: 50 }], summary: 'A plumbing subcontract for rough-in and fit-off.' };
  else if (/Project Intelligence/.test(sys)) out = { answer: 'You have 3 contracts.' };
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(out) }, finish_reason: 'stop' }], usage: { total_tokens: 900 } }));
}); });

(async () => {
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  let ExcelJS = null; try { ExcelJS = require(require.resolve('exceljs', { paths: [XL, SITE] })); } catch {}
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-contracts-blobs'); fs.rmSync(dir, { recursive: true, force: true });
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
  const tmp = path.join(os.tmpdir(), 'mbs-ct-files'); fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp);
  try {
    const SB = await import(path.join(SITE, 'netlify/lib/subbies.mjs')), INV = await import(path.join(SITE, 'netlify/lib/inventory.mjs'));
    const day = (n) => new Date(Date.now() + 11 * 3600e3 + n * 864e5).toISOString().slice(0, 10);
    const ok1 = (await SB.saveSub({ business: 'Hills Plumbing Services', trade: 'plumber', phone: '02 5550 3101', email: 'jobs@hp.example.com', status: 'Preferred', licence: { number: 'L1', expiry: day(300) }, insurance: { expiry: day(-3) }, workersComp: { soleTrader: true }, whiteCard: 'W1', swms: true }, 't')).sub;
    await SB.saveSub({ business: 'Bright Spark Electrical', trade: 'electrician', phone: '02 5550 3104', status: 'Approved', licence: { number: 'E1', expiry: day(300) }, insurance: { expiry: day(300) }, workersComp: { soleTrader: true }, whiteCard: 'W2', swms: true }, 't');
    const sup = (await INV.saveSupplier({ name: 'Western Tiles Direct', phone: '02 5550 3201', terms: '30 days EOM', categories: 'Tiles' }, 't')).supplier;
    const { PDFDocument, StandardFonts } = require(require.resolve('pdf-lib', { paths: [SITE] }));
    const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica), pg = pdf.addPage([595, 842]);
    ['SUBCONTRACT AGREEMENT SC-2026-014', 'Between Modern Building Solutions and Hills Plumbing Services', 'Subcontract sum $12,500 excluding GST. Retention 5%.', 'Liquidated damages $150 per day.'].forEach((l, i) => pg.drawText(l, { x: 50, y: 790 - i * 18, size: 11, font }));
    fs.writeFileSync(path.join(tmp, 'Plumbing subcontract.pdf'), await pdf.save());

    const J = await import(path.join(SITE, 'netlify/lib/jobs.mjs')), kv = await import(path.join(SITE, 'netlify/lib/kv.mjs'));
    const core = await J.nextCore('C');
    await J.create({ core, name: 'Carla Contract', phone: '0400 123 999', email: 'carla@example.com', suburb: 'Castle Hill', service: 'Bathroom', source: 'phone', summary: 'Bathroom renovation.' });
    br = await chromium.launch();
    const ctx = await br.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
    const p = await ctx.newPage(); p.setDefaultTimeout(20000);
    const errors = []; errorsAll = errors;
    p.on('pageerror', (e) => errors.push(e.message)); p.on('dialog', (x) => { errors.push('dialog: ' + x.message()); x.dismiss(); });
    await p.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
    await p.fill('[name=username]', 'sashi73'); await p.fill('[name=password]', 'sashi98'); await p.click('#loginForm button');
    await p.waitForSelector('#app:not([hidden])');
    await p.goto(`${BASE}/admin/#plan/${core}`); await p.waitForSelector('#tplType');
    await p.selectOption('#tplType', { index: 1 }); await p.click('#tplCreate'); await p.waitForSelector('table.gt');
    const saved = async () => { await p.waitForFunction(() => /Saved/.test((document.querySelector('#planSave') || {}).textContent || ''), null, { timeout: 15000 }); await sleep(350); };
    const plan = async () => kv.get('plan:' + core);

    const tabs = await p.$$eval('#planTabs .tab', (x) => x.map((a) => a.textContent.trim()));
    ok('Tab', '"📜 Contracts" sits between Stakeholders and Project Intelligence', tabs.indexOf('📜 Contracts') === tabs.indexOf('👥 Stakeholders') + 1 && tabs.indexOf('🧠 Project Intelligence') === tabs.indexOf('📜 Contracts') + 1, tabs.join(' | '));
    await p.click('#planTabs >> text=Contracts'); await p.waitForSelector('[data-ctnew]');
    ok('Tab', 'opens at #plan/<job>/contracts with buttons for customer, sub-contract, supply and consultant contracts', /\/contracts$/.test(await p.evaluate(() => location.hash)) && (await p.$$eval('[data-ctnew]', (x) => x.length)) === 4);

    // head contract
    await p.click('[data-ctnew="Head contract"]'); await p.waitForSelector('.ct-card.open'); await saved();
    let c = (await plan()).contracts[0];
    ok('Head', 'the customer contract starts with the customer, the project name, GST included and a 12-month defects period', c.type === 'Head contract' && c.party === 'Carla Contract' && c.partyKind === 'customer' && c.gstIncl && c.dlpMonths === 12 && c.status === 'Draft');
    const H = '[data-ctcard="' + c.id + '"]';
    await p.fill(`${H} [data-cf=value]`, '48500'); await p.keyboard.press('Tab'); await sleep(150);
    ok('Editing', 'typing a value and pressing Tab keeps the cursor moving to the next box', await p.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-cf') === 'gstIncl'), await p.evaluate(() => document.activeElement && document.activeElement.outerHTML.slice(0, 80)));
    await p.selectOption(`${H} [data-cf=status]`, 'Signed'); await saved();
    await p.click(`${H} [data-ctaddv]`); await p.fill(`${H} tr[data-vi="0"] [data-cv=desc]`, 'Extra shower niche'); await p.fill(`${H} tr[data-vi="0"] [data-cv=amount]`, '1200'); await p.selectOption(`${H} tr[data-vi="0"] [data-cv=status]`, 'Approved');
    await p.click(`${H} [data-ctaddv]`); await p.fill(`${H} tr[data-vi="1"] [data-cv=desc]`, 'Heated towel rail'); await p.fill(`${H} tr[data-vi="1"] [data-cv=amount]`, '500'); await p.keyboard.press('Tab');
    await p.click(`${H} [data-ctaddc]`); await p.fill(`${H} tr[data-ci="0"] [data-cc=desc]`, 'Deposit 10%'); await p.fill(`${H} tr[data-ci="0"] [data-cc=amount]`, '4850'); await p.keyboard.press('Tab'); await p.click(`${H} tr[data-ci="0"] [data-cpaid]`);
    await p.click(`${H} [data-ctaddc]`); await p.fill(`${H} tr[data-ci="1"] [data-cc=desc]`, 'Waterproofing stage'); await p.fill(`${H} tr[data-ci="1"] [data-cc=amount]`, '14550'); await p.fill(`${H} tr[data-ci="1"] [data-cc=due]`, day(-2)); await p.keyboard.press('Tab'); await saved();
    c = (await plan()).contracts[0];
    ok('Head', 'variations and claims are saved (approved, pending; paid and overdue)', c.variations.length === 2 && c.variations[0].status === 'Approved' && c.variations[1].status === 'Pending' && c.claims.length === 2 && c.claims[0].paid && !c.claims[1].paid, JSON.stringify([c.variations, c.claims]));
    const head = await p.textContent(`${H} .ct-head`), al = await p.textContent(`${H} .ct-alerts`);
    ok('Head', 'the card shows the adjusted sum ($49,700 incl. $1,200 variations)', /\$49,700\.00/.test(head) && /incl\. \$1,200\.00 variations/.test(head), head);
    ok('Alerts', 'an overdue claim and a pending variation are flagged', /1 claim overdue \(\$14,550\.00\)/.test(al) && /1 variation waiting for approval \(\$500\.00\)/.test(al), al);
    ok('Claims', 'claim totals: claimed, paid, owing and left to claim', /Claimed \$19,400\.00 · paid \$4,850\.00 · owing \$14,550\.00/.test(await p.textContent(`${H} tfoot`)) && /Left to claim: \$30,300\.00/.test(await p.textContent(`${H} tfoot`)));

    // sub-contract with a subbie whose insurance expired
    await p.click('[data-ctnew="Subcontract"]'); await p.waitForSelector('#ctPick');
    ok('Sub', 'the subbie list warns about expired papers', /Hills Plumbing Services ⚠ papers expired/.test(await p.textContent('#ctPick')));
    await p.selectOption('#ctPick', ok1.id); await p.click('#ctOk'); await saved();
    const cs = (await plan()).contracts; c = cs[1];
    ok('Sub', 'the sub-contract is linked to the subbie, with 5% retention and the insurance asked for', c.type === 'Subcontract' && c.partyKind === 'subbie' && c.partyRef === ok1.id && c.party === 'Hills Plumbing Services' && c.retention === 5 && /Public liability/.test(c.insurance) && c.title === 'Plumber works');
    const S2 = '[data-ctcard="' + c.id + '"]';
    ok('Sub', 'the card shows the subbie\'s expired insurance', /⚠ Papers expired/.test(await p.textContent(`${S2} .ct-head`)) && /Subbie papers expired: Public liability: expired/.test(await p.textContent(`${S2} .ct-alerts`)));
    // upload and ✨ fill in
    await p.setInputFiles(`${S2} [data-ctfile]`, path.join(tmp, 'Plumbing subcontract.pdf'));
    await p.waitForSelector(`${S2} [data-ctread]`, { timeout: 30000 }); await saved();
    const docs = (await kv.get('pdocs:' + core)).docs;
    ok('Docs', 'the contract PDF is uploaded to this contract (and Project Intelligence sees it)', docs.length === 1 && docs[0].contractId === c.id && docs[0].kind === 'Contract' && (await plan()).contracts[1].docs[0] === docs[0].id);
    await p.click(`${S2} [data-ctread]`); await p.waitForSelector('#ctApply', { timeout: 60000 });
    const rv = await p.textContent('#modalBody');
    ok('Fill in', '✨ shows what the contract says next to what is there now, to check before using', /What the contract says/.test(rv) && /\$12,500\.00/.test(rv) && /AS 4903/.test(rv) && /Add the 2 payment stages/.test(rv), rv.slice(0, 300));
    ok('Fill in', 'only the contract text goes to the AI, without the customer\'s details', /Liquidated damages \$150/.test(seen[seen.length - 1].user) && !/Carla|0400 123 999|carla@/.test(seen[seen.length - 1].user));
    await p.locator('.modal-card').screenshot({ path: path.join(__dirname, 'shot53-fillin.png') });
    await p.click('#ctApply'); await saved();
    c = (await plan()).contracts[1];
    ok('Fill in', 'the ticked terms are used: sum, dates, LDs, defects period, obligations, and the 2 stages as claims of 50%', c.value === 12500 && !c.gstIncl && c.end === '2026-12-04' && c.ldPerDay === 150 && c.ref === 'SC-2026-014' && /notice/.test(c.obligations) && c.claims.length === 2 && c.claims[0].amount === 6250, JSON.stringify(c).slice(0, 400));

    // supply contract
    await p.click('[data-ctnew="Supply"]'); await p.waitForSelector('#ctPick'); await p.selectOption('#ctPick', sup.id); await p.click('#ctOk'); await saved();
    c = (await plan()).contracts[2];
    ok('Supply', 'a supply contract is linked to the supplier with their terms', c.type === 'Supply' && c.partyKind === 'supplier' && c.partyRef === sup.id && c.terms === '30 days EOM');
    const S3 = '[data-ctcard="' + c.id + '"]';
    await p.fill(`${S3} [data-cf=value]`, '3300'); await p.keyboard.press('Tab'); await saved();

    // totals
    const k = await p.$$eval('.ct-kpis .kpi', (x) => x.map((e) => e.textContent));
    ok('Totals', 'contract sum ex GST with approved variations ($45,181.82), committed ($15,800.00), margin ($29,381.82, 65%)', /\$45,181\.82/.test(k[0]) && /\$15,800\.00/.test(k[1]) && /\$29,381\.82/.test(k[2]) && /65%/.test(k[2]), k.slice(0, 3).join(' | '));
    ok('Totals', 'money in (paid of claimed) and things needing attention', /\$4,850\.00 of \$19,400\.00/.test(k[3]) && /attention\s*[3-9]/.test(k[5]), k[3] + ' | ' + k[5]);
    await p.screenshot({ path: path.join(__dirname, 'shot53-contracts.png'), fullPage: true });

    // persisted, collapses
    await p.reload(); await p.waitForSelector('.ct-card');
    ok('Saved', 'after a reload the 3 contracts are there', (await p.$$eval('.ct-card', (x) => x.length)) === 3);
    await p.click('.ct-card >> nth=0 >> .ct-head'); await sleep(200);
    ok('Cards', 'clicking a contract opens and closes it', (await p.$$eval('.ct-card.open', (x) => x.length)) >= 1);

    // Ask AI table and Project Intelligence
    const SQ = await import(path.join(SITE, 'netlify/lib/admin-sql.mjs')), T = await SQ.tables();
    const pc = T.plan_contracts;
    ok('Ask AI', 'Ask AI has a plan_contracts table keyed contract_id, linked to the job, the subbie and the supplier', pc.length === 3 && pc.every((r) => r.contract_id && r.job_id === core) && pc[1].subcontractor_id === ok1.id && pc[2].supplier_id === sup.id && pc[0].adjusted_value === 49700 && pc[0].owing === 14550 && pc[0].overdue_claims === 1, JSON.stringify(pc[0]).slice(0, 300));
    ok('Ask AI', 'contract questions reach the contracts table', SQ.pickTables('Which contracts have overdue progress claims?').includes('plan_contracts') && SQ.pickTables('Total committed to subcontracts per job').includes('plan_contracts'));
    await p.click('#planTabs >> text=Project Intelligence'); await p.waitForSelector('#piQ');
    await p.fill('#piQ', 'What is our position on the contracts?'); await p.click('#piGo');
    await p.waitForFunction(() => !document.querySelector('#piLog .ask-think') && document.querySelectorAll('#piLog .pi-a').length >= 1, null, { timeout: 60000 });
    const u = JSON.parse(seen[seen.length - 1].user);
    ok('Intelligence', 'Project Intelligence gets the contracts (with the customer named only as "the customer") and the contract document', u.contracts.length === 3 && u.contracts[0].with === 'the customer' && u.contracts[0].variations.length === 2 && u.contracts[1].with === 'Hills Plumbing Services' && u.document_extracts.some((x) => /SUBCONTRACT AGREEMENT/.test(x.text)) && !/Carla/.test(seen[seen.length - 1].user));

    if (ExcelJS) {
      await p.click('#planTabs >> text=Overview'); await p.waitForSelector('#planXls');
      const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#planXls')]);
      const f = path.join(tmp, 'x.xlsx'); await dl.saveAs(f); const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(f);
      const ws = wb.getWorksheet('Contracts');
      ok('Excel', 'the Excel export has a Contracts sheet with the sums', ws && ws.getCell('B5').value === 'Carla Contract' && ws.getCell('G5').value === 49700 && ws.getCell('B6').value === 'Hills Plumbing Services');
    }
    await p.click('#planTabs >> text=Contracts'); await p.waitForSelector('.ct-card');
    await p.setViewportSize({ width: 390, height: 844 }); await p.click('.ct-card >> nth=1 >> .ct-head'); await sleep(500);
    ok('Phone', 'no sideways scrolling on a phone', (await p.evaluate(() => document.documentElement.scrollWidth)) <= 391, await p.evaluate(() => [document.documentElement.scrollWidth].concat([...document.querySelectorAll('#planBody *')].filter((e) => e.getBoundingClientRect().right > 395 && !e.closest('.table-wrap')).slice(0, 6).map((e) => e.tagName + '.' + e.className + ' ' + Math.round(e.getBoundingClientRect().right))).join(' ; ')));
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close(); br = null;
  } catch (e) { try { if (br) await br.close(); } catch {} ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ') + ' LOG: ' + log.slice(-500)); }
  try { srv.kill(); } catch {} try { mock.close(); } catch {} try { await blobs.stop(); } catch {}
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(0);
})();
