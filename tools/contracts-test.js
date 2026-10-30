// v53: 📜 Contracts, a plain uploader: one line per contract (customer, sub-contractor from the Stakeholders list, supply,
// consultant) with the signed contract as Word or PDF only. Project Intelligence reads the documents and knows which
// contract is which. Real Blobs, Chromium, stand-in AI.
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
  const body = JSON.parse(Buffer.concat(c).toString() || '{}');
  seen.push({ sys: body.messages[0].content, user: body.messages[1].content });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ answer: 'The plumbing sub-contract is $12,500 ex GST with 5% retention.', sources: ['Plumbing subcontract.pdf'] }) }, finish_reason: 'stop' }], usage: { total_tokens: 900 } }));
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
    const SB = await import(path.join(SITE, 'netlify/lib/subbies.mjs'));
    const day = (n) => new Date(Date.now() + 11 * 3600e3 + n * 864e5).toISOString().slice(0, 10);
    const hp = (await SB.saveSub({ business: 'Hills Plumbing Services', trade: 'plumber', phone: '02 5550 3101', email: 'jobs@hp.example.com', status: 'Preferred', licence: { number: 'L1', expiry: day(300) }, insurance: { expiry: day(300) }, workersComp: { soleTrader: true }, whiteCard: 'W1', swms: true }, 't')).sub;
    await SB.saveSub({ business: 'Bright Spark Electrical', trade: 'electrician', phone: '02 5550 3104', status: 'Approved' }, 't');
    const { PDFDocument, StandardFonts } = require(require.resolve('pdf-lib', { paths: [SITE] }));
    const mk = async (file, lines) => { const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica), pg = pdf.addPage([595, 842]); lines.forEach((l, i) => pg.drawText(l, { x: 50, y: 790 - i * 18, size: 11, font })); fs.writeFileSync(path.join(tmp, file), await pdf.save()); };
    await mk('Customer contract.pdf', ['HOME BUILDING CONTRACT', 'Owner: Carla Contract, phone 0400 123 999', 'Contract price $48,500 including GST.']);
    await mk('Plumbing subcontract.pdf', ['SUBCONTRACT AGREEMENT', 'Hills Plumbing Services', 'Subcontract sum $12,500 excluding GST. Retention 5%.']);
    fs.writeFileSync(path.join(tmp, 'notes.txt'), 'not a contract file type');

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
    await p.click('#planTabs >> text=Contracts'); await p.waitForSelector('#ctType');
    const types = await p.$$eval('#ctType option', (x) => x.map((o) => o.textContent));
    ok('Form', 'one line: type (customer, sub-contractor, supply, consultant), who with, upload Word or PDF', types.length === 4 && /Customer contract/.test(types[0]) && /Sub-contractor/.test(types[1]) && /Supply/.test(types[2]) && /Consultant/.test(types[3]) &&
      /\.pdf/.test(await p.getAttribute('#ctFile', 'accept')) && /\.docx/.test(await p.getAttribute('#ctFile', 'accept')) && /Word or PDF/.test(await p.textContent('#ctUpBtn')));
    ok('Form', 'no contract builder: no sums, variations or claims to fill in', !(await p.$('[data-cf], [data-ctaddv], [data-ctaddc], .ct-kpis')));

    // customer
    ok('Customer', 'the customer contract is with the job\'s customer (filled in)', await p.inputValue('.ct-add input[disabled]') === 'Carla Contract');
    await p.setInputFiles('#ctFile', path.join(tmp, 'notes.txt')); await sleep(300);
    ok('Files', 'only Word or PDF is accepted', !(await plan()).contracts || (await plan()).contracts.length === 0);
    await p.setInputFiles('#ctFile', path.join(tmp, 'Customer contract.pdf')); await p.waitForSelector('tr[data-ctid]'); await saved();
    let C = (await plan()).contracts;
    ok('Customer', 'uploading adds one line: Customer contract, Carla Contract, the PDF', C.length === 1 && C[0].type === 'Customer' && C[0].party === 'Carla Contract' && C[0].docs.length === 1 && /Customer contract\.pdf/.test(await p.textContent('tr[data-ctid]')));

    // sub-contractor: only those on the Stakeholders list
    await p.selectOption('#ctType', 'Sub-contractor'); await sleep(200);
    ok('Sub', 'with no subbies on the Stakeholders list it says to add them there first', /add them on the Stakeholders tab/.test(await p.inputValue('.ct-add input[disabled]')));
    await p.click('#planTabs >> text=Stakeholders'); await p.waitForSelector('#skSub'); await p.waitForFunction(() => document.querySelectorAll('#skSub option').length > 2);
    await p.selectOption('#skSub', hp.id); await saved();
    await p.click('#planTabs >> text=Contracts'); await p.waitForSelector('#ctType'); await p.selectOption('#ctType', 'Sub-contractor'); await p.waitForSelector('#ctWho');
    const opts = await p.$$eval('#ctWho option', (x) => x.map((o) => o.textContent));
    ok('Sub', 'the sub-contractor list only has subbies on this job\'s Stakeholders list', opts.length === 2 && /Hills Plumbing Services/.test(opts[1]) && !opts.some((o) => /Bright Spark/.test(o)), opts.join(' | '));
    await p.setInputFiles('#ctFile', path.join(tmp, 'Plumbing subcontract.pdf')); await sleep(400);
    ok('Sub', 'it asks to choose the sub-contractor first', (await plan()).contracts.length === 1);
    await p.selectOption('#ctWho', { index: 1 }); await p.setInputFiles('#ctFile', path.join(tmp, 'Plumbing subcontract.pdf'));
    await p.waitForFunction(() => document.querySelectorAll('tr[data-ctid]').length === 2); await saved();
    C = (await plan()).contracts;
    ok('Sub', 'the sub-contract is linked to the subbie', C[1].type === 'Sub-contractor' && /Hills Plumbing Services/.test(C[1].party) && C[1].partyRef === hp.id);

    // supply (typed name)
    await p.selectOption('#ctType', 'Supply'); await p.fill('#ctWho', 'Western Tiles Direct');
    await p.setInputFiles('#ctFile', path.join(tmp, 'Customer contract.pdf')); await p.waitForFunction(() => document.querySelectorAll('tr[data-ctid]').length === 3); await saved();
    C = (await plan()).contracts;
    ok('Supply', 'a supply contract takes a typed name', C[2].type === 'Supply' && C[2].party === 'Western Tiles Direct');
    await p.screenshot({ path: path.join(__dirname, 'shot53-contracts.png') });

    // download, delete
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('tr[data-ctid] >> nth=1 >> [data-ctdl]')]);
    const f = path.join(tmp, 'd.pdf'); await dl.saveAs(f);
    ok('Files', '⬇ downloads the contract', dl.suggestedFilename() === 'Plumbing subcontract.pdf' && fs.readFileSync(f).slice(0, 4).toString() === '%PDF');
    await p.click('tr[data-ctid] >> nth=2 >> [data-ctdel]'); await p.click('#okBtn'); await p.waitForFunction(() => document.querySelectorAll('tr[data-ctid]').length === 2); await saved();
    ok('Files', '✕ deletes the contract and its document', (await plan()).contracts.length === 2 && (await kv.get('pdocs:' + core)).docs.length === 2);

    // Project Intelligence reads them and knows which is which
    await p.click('tr[data-ctid] >> nth=1 >> [data-ctask]'); await p.waitForSelector('#piQ');
    ok('Intelligence', '🧠 Ask opens Project Intelligence with a question about that contract', /#plan\/.+\/intel$/.test(await p.evaluate(() => location.hash)) && /sub-contractor contract with Hills Plumbing Services/.test(await p.inputValue('#piQ')));
    await p.click('#piGo'); await p.waitForFunction(() => !document.querySelector('#piLog .ask-think') && document.querySelectorAll('#piLog .pi-a').length >= 1, null, { timeout: 60000 });
    const u = JSON.parse(seen[seen.length - 1].user);
    ok('Intelligence', 'the AI gets the contract text and which document is which contract', u.contracts.length === 2 && u.contracts[0].with === 'the customer' && u.contracts[1].document === 'Plumbing subcontract.pdf' && u.document_extracts.some((x) => /Subcontract sum \$12,500/.test(x.text)), JSON.stringify(u.contracts));
    ok('Privacy', 'the customer\'s name and phone are taken out of the contract text', !/Carla|0400 123 999/.test(seen[seen.length - 1].user));

    // Ask AI and Excel
    const SQ = await import(path.join(SITE, 'netlify/lib/admin-sql.mjs')), T = await SQ.tables();
    ok('Ask AI', 'Ask AI lists the contracts per job (plan_contracts) with the document name and the subbie link', T.plan_contracts.length === 2 && T.plan_contracts[1].subcontractor_id === hp.id && T.plan_contracts[1].document === 'Plumbing subcontract.pdf' && T.plan_contracts[0].job_id === core);
    if (ExcelJS) {
      await p.click('#planTabs >> text=Overview'); await p.waitForSelector('#planXls');
      const [x] = await Promise.all([p.waitForEvent('download'), p.click('#planXls')]);
      const xf = path.join(tmp, 'x.xlsx'); await x.saveAs(xf); const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(xf);
      const ws = wb.getWorksheet('Contracts');
      ok('Excel', 'the Excel export lists the contracts', ws && ws.getCell('C5').value === 'Carla Contract' && ws.getCell('D6').value === 'Plumbing subcontract.pdf');
    }
    await p.click('#planTabs >> text=Contracts'); await p.waitForSelector('#ctType');
    await p.setViewportSize({ width: 390, height: 844 }); await sleep(400);
    ok('Phone', 'no sideways scrolling on a phone', (await p.evaluate(() => document.documentElement.scrollWidth)) <= 391, await p.evaluate(() => document.documentElement.scrollWidth));
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close(); br = null;
  } catch (e) { try { if (br) await br.close(); } catch {} ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ') + ' LOG: ' + log.slice(-500)); }
  try { srv.kill(); } catch {} try { mock.close(); } catch {} try { await blobs.stop(); } catch {}
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(0);
})();
