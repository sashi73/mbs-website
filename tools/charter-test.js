// v62: 📊 Reports. Customer, team and all-stakeholder reports: RAG from the plan (and changed by hand), a first draft of the
// wording and ✨ the AI's (stand-in), recipients from the Stakeholder register and the job, PDF (at most 4 pages, with the
// Gantt chart) and Word, email with the PDF attached (stand-in Resend), and the report log (download again, delete).
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const SITE = path.resolve(process.argv[2]);
const PORT = 8973, BASE = `http://127.0.0.1:${PORT}`;
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => results.push({ area, name, pass: !!pass, detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const XL = path.resolve(process.argv[3] || path.join(__dirname, 'xl'));
  const mammoth = require(require.resolve('mammoth', { paths: [XL, SITE] }));
  const { PDFDocument, StandardFonts } = require(require.resolve('pdf-lib', { paths: [SITE] }));
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-ch-blobs'); fs.rmSync(dir, { recursive: true, force: true });
  const blobs = new BlobsServer({ directory: dir, token: 'tok', port: 0 }); const { port: bport } = await blobs.start();
  const ctxB64 = Buffer.from(JSON.stringify({ siteID: 'mbs', token: 'tok', edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, apiURL: `http://localhost:${bport}` })).toString('base64');
  process.env.NETLIFY_BLOBS_CONTEXT = ctxB64;
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NETLIFY_BLOBS_CONTEXT: ctxB64, ADMIN_USERNAME: 'sashi73', ADMIN_PASSWORD: 'sashi98', LLM_API_KEY: '', TELEGRAM_BOT_TOKEN: '', RESEND_API_KEY: '' };
  const srv = spawn('node', ['local-server.mjs'], { cwd: SITE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 40 && !/running/.test(log); i++) await sleep(150);
  let br = null;
  const tmp = path.join(os.tmpdir(), 'mbs-ch-files'); fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp);
  try {
    const J = await import(path.join(SITE, 'netlify/lib/jobs.mjs')), P = await import(path.join(SITE, 'netlify/lib/plan.mjs')), kv = await import(path.join(SITE, 'netlify/lib/kv.mjs'));
    const core = await J.nextCore('C');
    await J.create({ core, name: 'Carla Charter', phone: '0400 222 111', email: 'carla@example.com', suburb: 'Kellyville', service: 'Kitchen renovation', source: 'phone', summary: 'Full kitchen renovation with stone benchtops.' });
    br = await chromium.launch();
    const ctx = await br.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const p = await ctx.newPage(); p.setDefaultTimeout(30000);
    const errors = []; errorsAll = errors; p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
    await p.fill('[name=username]', 'sashi73'); await p.fill('[name=password]', 'sashi98'); await p.click('#loginForm button'); await p.waitForSelector('#app:not([hidden])');
    await p.goto(`${BASE}/admin/#plan/${core}`); await p.waitForSelector('#tplType'); await p.selectOption('#tplType', 'kitchen-reno'); await p.click('#tplCreate'); await p.waitForSelector('table.gt'); await sleep(1200);
    const pl = await P.get(core);
    Object.assign(pl.charter, { objective: 'Deliver a modern, functional kitchen on time and within budget.', inScope: '- Strip-out and disposal\n- New cabinets and stone benchtop\n- Splashback tiling', outScope: '- Appliances supplied by the customer\n- Structural changes', deliverables: 'Finished kitchen; electrical compliance certificate; warranty pack.', acceptance: '- All work matches the agreed drawings\n- Defects list closed', assumptions: 'Access weekdays 7am to 5pm.', budget: 30000, customer: 'Carla Charter', manager: 'Priya Shah' });
    pl.stakeholders = [{ id: 's1', name: 'Carla Charter', role: 'Customer', raci: 'A', phone: '0400 222 111', email: 'carla@example.com' }, { id: 's2', name: 'Sam Ortega', role: 'Electrician', raci: 'R', phone: '0400 333 444', email: 'sam@sparky.com.au' }, { id: 's3', name: 'Strata Manager', role: 'Building strata', raci: 'A', email: 'strata@example.com' }];
    pl.issues = [{ title: 'Customer to choose tiles', priority: 'High', owner: 'Carla', status: 'Open' }];
    await P.save(core, pl, pl.rev, 'test');
    await p.goto(`${BASE}/admin/#projects`); await sleep(300);
    await p.goto(`${BASE}/admin/#plan/${core}/scope`); await p.waitForSelector('#chDoc');
    const geo = await p.evaluate(() => ({ main: Math.round(document.querySelector('.ch-main').getBoundingClientRect().width), view: Math.round(document.querySelector('#planBody').getBoundingClientRect().width), side: !!document.querySelector('.ch-side'), secs: document.querySelectorAll('.chs').length }));
    ok('Editor', 'the charter editor uses the full width (sections side by side, a sign-off panel on the right)', geo.main > 800 && geo.main + 300 >= geo.view - 40 && geo.side && geo.secs === 7, JSON.stringify(geo));
    const grows = await p.evaluate(() => [...document.querySelectorAll('.chf textarea')].every((t) => t.scrollHeight <= t.clientHeight + 4));
    ok('Editor', 'text boxes grow with the text (no scrolling inside them)', grows);
    await p.focus('#ch_inScope'); await p.evaluate(() => { const t = document.querySelector('#ch_inScope'); t.selectionStart = t.selectionEnd = t.value.length; }); await p.keyboard.press('Enter'); await p.keyboard.type('Handover pack'); await sleep(200);
    ok('Editor', 'in a list, Enter starts the next "- " line', /\n- Splashback tiling\n- Handover pack$/.test(await p.inputValue('#ch_inScope')), JSON.stringify(await p.inputValue('#ch_inScope')));
    ok('Editor', 'the budget shows as money ($30,000)', (await p.inputValue('#ch_budget')) === '$30,000');
    await p.fill('#ch_budget', '45000'); await p.click('#ch_manager'); await sleep(100);
    ok('Editor', 'type a new amount and it is shown as money when you leave the box', (await p.inputValue('#ch_budget')) === '$45,000');
    await p.fill('#ch_budget', '$30,000'); await p.click('#ch_manager'); await sleep(100);
    const pct0 = await p.textContent('.ch-ready b:last-child');
    await p.fill('#ch_assumptions', ''); await sleep(200);
    const pct1 = await p.textContent('.ch-ready b:last-child');
    ok('Checklist', 'the "Ready to sign off" checklist updates as you type', pct0 !== pct1 && /○ Assumptions and constraints/.test(await p.textContent('.ch-list')), pct0 + ' -> ' + pct1);
    await p.fill('#ch_assumptions', 'Access weekdays 7am to 5pm.'); await sleep(1300);
    ok('Saved', 'what you type is saved with the plan', /Handover pack/.test((await P.get(core)).charter.inScope) && (await P.get(core)).charter.budget === 30000);
    ok('Button', 'the Scope tab has "📄 Charter: PDF / Word" and shows the version and status', /Charter/.test(await p.textContent('#chDoc')) && /v1\.0 · Draft/.test(await p.textContent('.ch-ver')));
    await p.click('#chDoc'); await p.waitForSelector('#chPdf');
    ok('Options', 'options: version, status and which parts to include', (await p.$$('[data-cho]')).length === 12 && (await p.inputValue('#chV')) === '1.0');
    const dl = async (sel) => { const [d] = await Promise.all([p.waitForEvent('download'), p.click(sel)]); const f = path.join(tmp, d.suggestedFilename()); await d.saveAs(f); return { name: d.suggestedFilename(), buf: fs.readFileSync(f) }; };
    let f = await dl('#chPdf'); const pdf = await PDFDocument.load(f.buf);
    fs.copyFileSync(path.join(tmp, f.name), path.join(os.tmpdir(), 'charter-sample.pdf'));
    ok('PDF', 'the PDF: A4, as many pages as it needs, with the Gantt chart picture', /Project-Charter-v1\.0\.pdf$/.test(f.name) && pdf.getPageCount() >= 2 && /\/Subtype\s*\/Image/.test(f.buf.toString('latin1')) && f.buf.length < 2500000, f.name + ' ' + pdf.getPageCount() + ' pages ' + f.buf.length);
    f = await dl('#chDocx'); const w = (await mammoth.extractRawText({ buffer: f.buf })).value;
    fs.copyFileSync(path.join(tmp, f.name), path.join(os.tmpdir(), 'charter-sample.docx'));
    const want = ['PROJECT CHARTER', '1. Project at a glance', 'Purpose and objective', 'Background', 'In scope', 'Out of scope', 'Deliverables', 'Acceptance criteria', 'Assumptions and constraints', 'Key milestones', 'Summary schedule', 'Critical path', 'Stakeholder register', 'Key risks', 'Budget', 'Governance and change control', 'Approval and sign-off'];
    const miss = want.filter((x) => !w.includes(x));
    ok('Word', 'the Word file has every section, numbered, from at-a-glance to sign-off', /\.docx$/.test(f.name) && !miss.length, miss.join(', '));
    ok('Word', 'the content comes from the plan: objective, scope lines, stakeholders with contacts, budget and contingency', /modern, functional kitchen/.test(w) && /New cabinets and stone benchtop/.test(w) && /Appliances supplied by the customer/.test(w) && /sam@sparky\.com\.au/.test(w) && /\$30,000\.00/.test(w) && /Contingency/.test(w));
    ok('Word', 'critical path: the tasks that set the finish date are listed', /set the finish date/.test(w) && /Install cabinets/.test(w.split('Critical path')[1] || ''));
    ok('Sign-off', 'the sign-off block names the customer, the project manager, MBS and accountable stakeholders, with signature and date columns', /By signing/.test(w) && /Customer \(sponsor\)/.test(w) && /Priya Shah/.test(w) && /For Modern Building Solutions/.test(w) && /Strata Manager/.test(w) && /Signature/.test(w) && /Date/.test(w));
    ok('Word', 'the Gantt chart is a picture in the Word file', /word\/media\/[^\s]*\.png/.test(f.buf.toString('latin1')));
    // options: no contacts, no budget; version 1.1 For approval
    await p.uncheck('[data-cho=contacts]'); await p.uncheck('[data-cho=budget]'); await p.fill('#chV', '1.1'); await p.dispatchEvent('#chV', 'change'); await p.selectOption('#chS', 'For approval');
    f = await dl('#chDocx'); const w2 = (await mammoth.extractRawText({ buffer: f.buf })).value;
    ok('Options', 'unticking leaves parts out (no phone or email, no $ budget), and the version and status are on the document', !/sam@sparky/.test(w2) && !/Contingency/.test(w2) && /Version 1\.1/.test(w2) && /For approval/.test(w2) && /Project-Charter-v1\.1\.docx$/.test(f.name));
    await sleep(1200);
    const sv = await P.get(core);
    ok('Saved', 'the version and status are saved with the plan, and the choices are remembered', sv.charter.docVersion === '1.1' && sv.charter.docStatus === 'For approval' && await p.evaluate(() => JSON.parse(localStorage.getItem('mbsCharterOpt')).contacts === false));
    // signed copy
    const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica), pg = doc.addPage([595, 842]); pg.drawText('PROJECT CHARTER signed by Carla Charter and Priya Shah', { x: 50, y: 780, size: 12, font });
    fs.writeFileSync(path.join(tmp, 'Charter signed.pdf'), await doc.save());
    await p.setInputFiles('#chUp', path.join(tmp, 'Charter signed.pdf')); await sleep(2000);
    const docs = ((await kv.get('pdocs:' + core)) || { docs: [] }).docs;
    ok('Signed', 'the signed charter is kept with the project (Project Intelligence can read it) and the status becomes Approved', docs.some((d) => d.kind === 'Project charter (signed)' && d.name === 'Charter signed.pdf') && (await p.inputValue('#chS')) === 'Approved');
    await p.click('.modal [data-close]'); await sleep(300);
    ok('Button', 'the Scope tab shows the new version and status', /v1\.1 · Approved/.test(await p.textContent('.ch-ver')));
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close(); br = null;
  } catch (e) { try { if (br) await br.close(); } catch {} ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ') + ' LOG: ' + log.slice(-600)); }
  try { srv.kill(); } catch {} try { await blobs.stop(); } catch {}
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(0);
})();
