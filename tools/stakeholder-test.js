// v45: 👥 Stakeholders tab (RACI) on the project plan, right after Issues. Real Blobs, local site, Chromium.
// node stakeholder-test.js <site> [folder with node_modules/exceljs]
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const SITE = path.resolve(process.argv[2]);
const XL = path.resolve(process.argv[3] || path.join(__dirname, 'xl'));
const PORT = 8945, BASE = `http://127.0.0.1:${PORT}`;
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => results.push({ area, name, pass: !!pass, detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let ExcelJS = null; try { ExcelJS = require(require.resolve('exceljs', { paths: [XL, SITE] })); } catch {}
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-stake-blobs'); fs.rmSync(dir, { recursive: true, force: true });
  const blobs = new BlobsServer({ directory: dir, token: 'tok', port: 0 });
  const { port: bport } = await blobs.start();
  const ctxB64 = Buffer.from(JSON.stringify({ siteID: 'mbs', token: 'tok', edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, apiURL: `http://localhost:${bport}` })).toString('base64');
  process.env.NETLIFY_BLOBS_CONTEXT = ctxB64;
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NETLIFY_BLOBS_CONTEXT: ctxB64, ADMIN_USERNAME: 'sashi73', ADMIN_PASSWORD: 'sashi98', LLM_API_KEY: '', TELEGRAM_BOT_TOKEN: '', RESEND_API_KEY: '' };
  const srv = spawn('node', ['local-server.mjs'], { cwd: SITE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 40 && !/running/.test(log); i++) await sleep(150);
  let br = null;
  try {
    const J = await import(path.join(SITE, 'netlify/lib/jobs.mjs'));
    const kv = await import(path.join(SITE, 'netlify/lib/kv.mjs'));
    const core = await J.nextCore('S');
    await J.create({ core, name: 'Sam Stake', phone: '0400 222 333', email: 'sam@example.com', suburb: 'Kellyville', service: 'Bathroom', source: 'phone', summary: 'Full bathroom renovation.' });
    br = await chromium.launch();
    const ctx = await br.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
    const p = await ctx.newPage(); p.setDefaultTimeout(15000);
    const errors = []; errorsAll = errors;
    p.on('pageerror', (e) => errors.push(e.message)); p.on('dialog', (x) => { errors.push('dialog: ' + x.message()); x.dismiss(); });
    await p.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
    await p.fill('[name=username]', 'sashi73'); await p.fill('[name=password]', 'sashi98'); await p.click('#loginForm button');
    await p.waitForSelector('#app:not([hidden])');
    await p.goto(`${BASE}/admin/#plan/${core}`); await p.waitForSelector('#tplType');
    await p.selectOption('#tplType', { index: 1 }); await p.click('#tplCreate'); await p.waitForSelector('table.gt');
    const saved = async () => { await p.waitForFunction(() => /Saved/.test((document.querySelector('#planSave') || {}).textContent || ''), null, { timeout: 15000 }); await sleep(300); };
    const stored = async () => (await kv.get('plan:' + core)).stakeholders || [];

    const tabs = await p.$$eval('#planTabs .tab', (x) => x.map((a) => a.textContent.trim()));
    ok('Tab', '"👥 Stakeholders" comes right after "❗ Issues"', tabs.indexOf('👥 Stakeholders') === tabs.indexOf('❗ Issues') + 1 && tabs.indexOf('👥 Stakeholders') > 0, tabs.join(' | '));
    await p.click('#planTabs >> text=Stakeholders'); await p.waitForSelector('#addStake');
    ok('Tab', 'opens at #plan/<job>/stake with an empty list and a RACI key', /\/stake$/.test(await p.evaluate(() => location.hash)) && /No stakeholders yet/.test(await p.textContent('#planBody')) && /Accountable/.test(await p.textContent('#planBody')));

    await p.click('#skCust'); await saved();
    let L = await stored();
    ok('Customer', '"Add the customer" fills in the name, phone and email from the job', L.length === 1 && L[0].name === 'Sam Stake' && L[0].phone === '0400 222 333' && L[0].email === 'sam@example.com' && L[0].role === 'Customer' && L[0].raci === 'C', JSON.stringify(L));
    ok('Customer', 'the button goes once the customer is listed', !(await p.isVisible('#skCust')));
    ok('Contact', 'call and email buttons for the stakeholder', await p.isVisible('a[href="tel:0400222333"]') && await p.isVisible('a[href="mailto:sam@example.com"]'));
    ok('RACI', 'with nobody Accountable, it warns', /Nobody is Accountable/.test(await p.textContent('#planBody')));

    await p.click('#addStake');
    const row = 'tr[data-sid] >> nth=1';
    await p.fill(`${row} >> [data-s=name]`, 'Pete Plumber'); await p.fill(`${row} >> [data-s=role]`, 'Plumber');
    await p.fill(`${row} >> [data-s=phone]`, '0411 555 666'); await p.fill(`${row} >> [data-s=email]`, 'pete@plumbing.example.com');
    await p.selectOption(`${row} >> [data-s=raci]`, 'A'); await saved();
    L = await stored();
    ok('Add', 'a new stakeholder is saved with name, role, RACI, contact number and email', L.length === 2 && L[1].name === 'Pete Plumber' && L[1].role === 'Plumber' && L[1].raci === 'A' && L[1].phone === '0411 555 666' && L[1].email === 'pete@plumbing.example.com', JSON.stringify(L[1]));
    ok('RACI', 'with one person Accountable, no warning', !/Accountable<\/b>\. |Nobody is Accountable|people are Accountable/.test(await p.textContent('#planBody')));
    ok('RACI', 'the counts show R, A, C and I', /Accountable: 1/.test(await p.textContent('.sk-sum')) && /Consulted: 1/.test(await p.textContent('.sk-sum')));
    await p.click('#addStake'); await p.fill('tr[data-sid] >> nth=2 >> [data-s=name]', 'Second Boss'); await p.selectOption('tr[data-sid] >> nth=2 >> [data-s=raci]', 'A'); await saved();
    ok('RACI', 'two people Accountable gives a warning', /2 people are Accountable/.test(await p.textContent('#planBody')));
    await p.click('tr[data-sid] >> nth=2 >> [data-sup]'); await saved();
    L = await stored();
    ok('Order', '↑ moves a stakeholder up', L[1].name === 'Second Boss' && L[2].name === 'Pete Plumber', L.map((x) => x.name).join(', '));
    await p.click('tr[data-sid] >> nth=1 >> [data-sdel]'); await saved();
    L = await stored();
    ok('Delete', '✕ removes a stakeholder', L.length === 2 && !L.some((x) => x.name === 'Second Boss'));

    // the server keeps the data clean
    await p.reload(); await p.waitForSelector('#addStake');
    ok('Saved', 'after a reload the list is still there', (await p.$$eval('tr[data-sid]', (x) => x.length)) === 2);
    await p.evaluate(() => { const s = document.querySelector('tr[data-sid] [data-s=raci]'); s.insertAdjacentHTML('beforeend', '<option value="Z">Z</option>'); s.value = 'Z'; s.dispatchEvent(new Event('change')); }); await saved();
    ok('Safety', 'a bad RACI value is stored as I (Informed) by the server', (await stored())[0].raci === 'I', JSON.stringify((await stored())[0]));
    await p.reload(); await p.waitForSelector('#addStake'); await p.selectOption('tr[data-sid] >> nth=0 >> [data-s=raci]', 'C'); await saved();

    if (ExcelJS) {
      await p.click('#planTabs >> text=Overview'); await p.waitForSelector('#planXls');
      const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#planXls')]);
      const file = path.join(os.tmpdir(), 'mbs-stake.xlsx'); await dl.saveAs(file);
      const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(file);
      const ws = wb.getWorksheet('Stakeholders'), names = wb.worksheets.map((w) => w.name);
      ok('Excel', 'the Excel export has a Stakeholders sheet after Issues, with the RACI', ws && names.indexOf('Stakeholders') === names.indexOf('Issues') + 1 && ws.getCell('B5').value === 'Sam Stake' && /C – Consulted/.test(ws.getCell('D5').value) && ws.getCell('E6').value === '0411 555 666', names.join(','));
    } else ok('Excel', 'exceljs available for the Excel check', false, XL);

    await p.goto(`${BASE}/admin/#plan/${core}/stake`); await p.waitForSelector('#addStake');
    await p.screenshot({ path: path.join(__dirname, 'shot45-stakeholders.png') });
    await p.setViewportSize({ width: 390, height: 844 }); await sleep(500);
    ok('Phone', 'no sideways scrolling on a phone', (await p.evaluate(() => document.documentElement.scrollWidth)) <= 391, await p.evaluate(() => document.documentElement.scrollWidth));
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close(); br = null;
  } catch (e) { try { if (br) await br.close(); } catch {} ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ')); }
  try { srv.kill(); } catch {} try { await blobs.stop(); } catch {}
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(0);
})();
