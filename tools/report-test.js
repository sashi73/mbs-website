// v62: 📊 Reports. Customer, team and all-stakeholder reports: RAG from the plan (and changed by hand), a first draft of the
// wording and ✨ the AI's (stand-in), recipients from the Stakeholder register and the job, PDF (at most 3 pages, with the
// Gantt chart) and Word, email with the PDF attached (stand-in Resend), and the report log (download again, delete).
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const SITE = path.resolve(process.argv[2]);
const PORT = 8962, BASE = `http://127.0.0.1:${PORT}`;
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => results.push({ area, name, pass: !!pass, detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const seen = [], mails = [];
const mock = http.createServer((req, res) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => {
  const raw = Buffer.concat(c).toString();
  if (/\/emails/.test(req.url)) { mails.push(JSON.parse(raw)); res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ id: 'em_1' })); }
  const body = JSON.parse(raw || '{}'), sys = body.messages[0].content, u = JSON.parse(body.messages[1].content);
  seen.push({ sys, u, raw: body.messages[1].content });
  const out = { headline: 'AI: your kitchen is moving along nicely and on track.', points: ['AI point one', 'AI point two'], next: ['AI next step'], asks: ['Choose the splashback tiles by Friday'] };
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(out) }, finish_reason: 'stop' }], usage: { total_tokens: 900 } }));
}); });

(async () => {
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const MOCK = `http://127.0.0.1:${mock.address().port}`;
  const XL = path.resolve(process.argv[3] || path.join(__dirname, 'xl'));
  const mammoth = require(require.resolve('mammoth', { paths: [XL, SITE] }));
  const { PDFDocument } = require(require.resolve('pdf-lib', { paths: [SITE] }));
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-rep-blobs'); fs.rmSync(dir, { recursive: true, force: true });
  const blobs = new BlobsServer({ directory: dir, token: 'tok', port: 0 });
  const { port: bport } = await blobs.start();
  const ctxB64 = Buffer.from(JSON.stringify({ siteID: 'mbs', token: 'tok', edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, apiURL: `http://localhost:${bport}` })).toString('base64');
  process.env.NETLIFY_BLOBS_CONTEXT = ctxB64;
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NETLIFY_BLOBS_CONTEXT: ctxB64, ADMIN_USERNAME: 'sashi73', ADMIN_PASSWORD: 'sashi98',
    LLM_API_KEY: 'test', LLM_BASE_URL: MOCK, TELEGRAM_BOT_TOKEN: '', RESEND_API_KEY: 're_test', RESEND_API_BASE: MOCK, FROM_EMAIL: 'MBS <reports@mbsplc.com.au>', SITE_ENV: '' };
  const srv = spawn('node', ['local-server.mjs'], { cwd: SITE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 40 && !/running/.test(log); i++) await sleep(150);
  let br = null;
  const tmp = path.join(os.tmpdir(), 'mbs-rep-files'); fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp);
  try {
    const J = await import(path.join(SITE, 'netlify/lib/jobs.mjs')), P = await import(path.join(SITE, 'netlify/lib/plan.mjs'));
    const core = await J.nextCore('R');
    await J.create({ core, name: 'Rita Report', phone: '0400 333 444', email: 'rita@example.com', suburb: 'Kellyville', service: 'Kitchen renovation', source: 'phone', summary: 'Kitchen renovation.' });
    br = await chromium.launch();
    const ctx = await br.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
    const p = await ctx.newPage(); p.setDefaultTimeout(30000);
    const errors = []; errorsAll = errors; p.on('pageerror', (e) => errors.push(e.message)); p.on('dialog', (x) => { errors.push('dialog: ' + x.message()); x.dismiss(); });
    await p.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
    await p.fill('[name=username]', 'sashi73'); await p.fill('[name=password]', 'sashi98'); await p.click('#loginForm button');
    await p.waitForSelector('#app:not([hidden])');
    await p.goto(`${BASE}/admin/#plan/${core}`); await p.waitForSelector('#tplType'); await p.selectOption('#tplType', 'kitchen-reno'); await p.click('#tplCreate'); await p.waitForSelector('table.gt'); await sleep(1200);
    // a busier plan: stakeholders, many tasks, risks and issues, the first task done
    const pl0 = await P.get(core);
    pl0.stakeholders = [{ id: 's1', name: 'Rita Report', role: 'Customer', raci: 'A', email: 'rita@example.com' }, { id: 's2', name: 'Sam Sparky', role: 'Electrician', raci: 'R', email: 'sam@sparky.com.au' },
      { id: 's3', name: 'Tina Tiler', role: 'Tiler', raci: 'R', email: 'tina@tiles.com.au' }, { id: 's4', name: 'Carl Certifier', role: 'Certifier', raci: 'C', email: 'carl@cert.com.au' }];
    const last = pl0.tasks[pl0.tasks.length - 1].id;
    for (let i = 0; i < 45; i++) pl0.tasks.push({ id: 'x' + i, name: 'Extra fit-out task ' + (i + 1), dur: 2, pred: [i ? 'x' + (i - 1) : last], qty: 1, rate: 100 });
    pl0.tasks[0].pct = 100; pl0.tasks[0].status = 'done';
    pl0.risks = pl0.risks.concat(Array.from({ length: 22 }, (_, i) => ({ title: 'Risk number ' + (i + 1) + ' about supply and access', cause: 'Cause', p: i < 2 ? 4 : 2, i: i < 2 ? 4 : 3, response: 'Mitigate', action: 'Keep an eye on it', owner: 'PM', status: 'Open' })));
    pl0.issues = Array.from({ length: 20 }, (_, i) => ({ title: (i === 0 ? 'Customer to choose splashback tiles' : 'Issue number ' + (i + 1)), detail: '', priority: i < 1 ? 'High' : 'Medium', owner: i === 0 ? 'Rita (customer)' : 'Site', due: '', status: 'Open' }));
    await P.save(core, pl0, pl0.rev, 'test');
    await p.goto(`${BASE}/admin/#projects`); await sleep(300);
    await p.goto(`${BASE}/admin/#plan/${core}/reports`); await p.waitForSelector('.rp-auds');
    const tabs = await p.$$eval('#planTabs .tab', (a) => a.map((x) => x.textContent.trim()));
    ok('Tab', '"📊 Reports" sits after Comms, before SWMS', tabs.indexOf('📊 Reports') === tabs.indexOf('📞 Comms') + 1 && tabs.indexOf('🦺 SWMS') === tabs.indexOf('📊 Reports') + 1, tabs.join(' | '));
    const ragL = async () => p.$$eval('.rp-r', (a) => a.map((x) => x.querySelector('b').textContent + ':' + x.querySelector('select').value));
    let rg = await ragL();
    ok('Customer', 'three report types; the customer report has RAG for Overall, Programme, Progress, Risks & issues', (await p.$$('.rp-aud')).length === 3 && rg.length === 4 && /^Overall/.test(rg[0]) && /Programme/.test(rg[1]) && /Progress/.test(rg[2]) && /Risks & issues/.test(rg[3]), rg.join(' '));
    ok('Customer', 'risks scored 16 make "Risks & issues" red, and Overall takes the worst colour', /Risks & issues:R/.test(rg[3]) && /Overall:R/.test(rg[0]), rg.join(' '));
    const rcp = async () => p.$$eval('[data-rr]', (a) => a.filter((x) => x.checked).map((x) => x.getAttribute('data-rr')));
    ok('Customer', 'it goes to the customer by default (the job\'s customer and the register\'s Customer)', JSON.stringify(await rcp()) === JSON.stringify(['job']) || (await rcp()).join() === 'job', (await rcp()).join());
    const hl0 = await p.inputValue('[data-rw=headline]');
    ok('Customer', 'a first draft of the headline, highlights, coming up and what we need from the customer', /complete/.test(hl0) && /Completed: /.test(await p.inputValue('[data-rw=points]')) && (await p.inputValue('[data-rw=next]')).length > 10 && /splashback/.test(await p.inputValue('[data-rw=asks]')), hl0);
    await p.selectOption('[data-rg=risk]', 'G'); await sleep(200);
    rg = await ragL();
    ok('RAG', 'the RAG can be changed by hand (risks to green), and Overall follows', /Risks & issues:G/.test(rg[3]) && !/Overall:R/.test(rg[0]), rg.join(' '));
    // ✨ AI
    await p.click('#rpAi'); await p.waitForFunction(() => /AI: your kitchen/.test(document.querySelector('[data-rw=headline]').value), null, { timeout: 30000 });
    const ai = seen[seen.length - 1];
    ok('AI', '✨ the AI writes it for the customer, from the facts (no internal tables, no customer contact details)', ai && ai.u.audience === 'CUSTOMER' && !ai.u.tables && ai.u.rag.length === 4 && !/0400 333 444|rita@example/.test(ai.raw) && /splashback/.test(await p.inputValue('[data-rw=asks]')));
    // PDF
    const dl = async (sel) => { const [d] = await Promise.all([p.waitForEvent('download'), p.click(sel)]); const f = path.join(tmp, d.suggestedFilename()); await d.saveAs(f); return { name: d.suggestedFilename(), buf: fs.readFileSync(f) }; };
    let f = await dl('#rpPdf'); let pdf = await PDFDocument.load(f.buf);
    ok('PDF', 'the customer PDF: at most 3 pages, with the Gantt chart picture, small enough to email', /Customer-update.*\.pdf$/.test(f.name) && pdf.getPageCount() <= 3 && /\/Subtype\s*\/Image/.test(f.buf.toString('latin1')) && f.buf.length < 1500000, f.name + ' ' + pdf.getPageCount() + ' pages, ' + f.buf.length + ' bytes');
    await p.waitForSelector('tr[data-rid]');
    ok('Log', 'the download is kept in the report log (#1, RAG, headline, "PDF downloaded")', (await p.$$('tr[data-rid]')).length === 1 && /Customer update #1/.test(await p.textContent('tr[data-rid]')) && /AI: your kitchen/.test(await p.textContent('tr[data-rid]')) && /PDF downloaded/.test(await p.textContent('tr[data-rid]')));
    f = await dl('#rpDocx');
    const wtxt = (await mammoth.extractRawText({ buffer: f.buf })).value;
    ok('Word', 'the Word file has the title, the RAG, the headline, the milestones and the Gantt chart picture', /\.docx$/.test(f.name) && /Customer update/.test(wtxt) && /GREEN|AMBER|RED/.test(wtxt) && /AI: your kitchen/.test(wtxt) && /Milestones/.test(wtxt) && /What we need from you/.test(wtxt) && /word\/media\/[^\s]*\.png/.test(f.buf.toString('latin1')) && !/Budget|\$\d/.test(wtxt), wtxt.slice(0, 200));
    ok('Log', 'downloading Word for the same report updates the same log line', (await p.$$('tr[data-rid]')).length === 1);
    // email
    await p.click('#rpSend'); await p.waitForSelector('#rsGo'); await p.fill('#rsMsg', 'Hi Rita, here is this week\'s update.'); await p.click('#rsGo');
    await p.waitForFunction(() => /Emailed/.test(document.querySelector('.rp-log') ? document.querySelector('.rp-log').textContent : ''), null, { timeout: 30000 });
    const m = mails[mails.length - 1];
    ok('Email', 'emailed to the customer with the PDF attached, the RAG, headline and key points in the email', m && m.to.join() === 'rita@example.com' && m.attachments.length === 1 && /\.pdf$/.test(m.attachments[0].filename) && Buffer.from(m.attachments[0].content, 'base64').slice(0, 4).toString() === '%PDF' && /Hi Rita/.test(m.html) && /AI: your kitchen/.test(m.html) && /Overall: /.test(m.text), m && JSON.stringify({ to: m.to, s: m.subject }));
    ok('Log', 'the log shows it was emailed (still one line for this report)', (await p.$$('tr[data-rid]')).length === 1 && /Emailed/.test(await p.textContent('tr[data-rid]')));
    // team
    await p.click('[data-aud=team]'); await sleep(400);
    rg = await ragL();
    ok('Team', 'the team look-ahead has RAG for Overall, Programme, Blockers and Safety (no SWMS yet: amber)', rg.length === 4 && /Blockers/.test(rg[2]) && /Safety:A/.test(rg[3]), rg.join(' '));
    ok('Team', 'it goes to the trades (RACI R) by default', (await rcp()).sort().join() === 's2,s3', (await rcp()).join());
    f = await dl('#rpPdf'); pdf = await PDFDocument.load(f.buf);
    ok('Team', 'the team PDF stays within 3 pages', pdf.getPageCount() <= 3, pdf.getPageCount() + ' pages');
    f = await dl('#rpDocx'); const ttxt = (await mammoth.extractRawText({ buffer: f.buf })).value;
    ok('Team', 'it has the 2-week look-ahead (who and when), the 3-week Gantt, blockers and safety', /Look-ahead: the next 2 weeks/.test(ttxt) && /3-week look-ahead/.test(ttxt) && /Blockers and open issues/.test(ttxt) && /Safety/.test(ttxt) && /SWMS/.test(ttxt), ttxt.slice(0, 300));
    // all stakeholders, with lots of rows: still 3 pages
    await p.click('[data-aud=all]'); await sleep(400);
    rg = await ragL();
    ok('All', 'the stakeholder report has RAG for Overall, Scope, Time, Cost, Risks and Issues, and goes to everyone (the customer once, though she is on the job and the register)', rg.length === 6 && /Cost/.test(rg[3]) && (await rcp()).length === 4, rg.join(' ') + ' ' + (await rcp()).join());
    await p.check('#rpCost'); await sleep(300);
    f = await dl('#rpPdf'); pdf = await PDFDocument.load(f.buf);
    ok('All', 'with 60 tasks, 25 risks and 20 issues the PDF is still at most 3 pages', pdf.getPageCount() <= 3, pdf.getPageCount() + ' pages');
    f = await dl('#rpDocx'); const atxt = (await mammoth.extractRawText({ buffer: f.buf })).value;
    ok('All', 'it has the executive summary, programme, milestones, top risks, open issues, decisions and the $ figures when ticked', /Executive summary/.test(atxt) && /Programme/.test(atxt) && /Top risks/.test(atxt) && /Open issues/.test(atxt) && /Decisions needed/.test(atxt) && /BUDGET/.test(atxt) && /more \(see the project plan\)/.test(atxt), atxt.slice(0, 300));
    // a guest
    await p.waitForFunction(() => document.querySelectorAll('tr[data-rid]').length === 3); await sleep(300);
    await p.fill('#rpGuest', 'ann@bank.com.au'); await p.click('#rpGuestAdd');
    ok('Recipients', 'someone not on the register can be added (with the advice to put them on it)', /Not in the Stakeholder register/.test(await p.textContent('.cm-guests')) && /Email it to 5 people/.test(await p.textContent('#rpSend')));
    // weekly / ad hoc
    const to = await p.inputValue('#rpTo'), from = await p.inputValue('#rpFrom');
    ok('Period', 'weekly: the 7 days up to today', (Date.parse(to) - Date.parse(from)) / 864e5 === 6, from + ' ' + to);
    await p.selectOption('#rpType', 'Ad hoc'); await sleep(200);
    ok('Period', 'ad hoc: from the project start (no earlier stakeholder report)', (await p.inputValue('#rpFrom')) !== from);
    // log: download again, delete
    const rows = await p.$$('tr[data-rid]');
    ok('Log', 'three reports in the log (customer emailed, team and stakeholder downloaded)', rows.length === 3, String(rows.length));
    const custRow = await p.$('tr[data-rid]:has-text("Customer update")');
    const [d2] = await Promise.all([p.waitForEvent('download'), custRow.$eval('[data-rdl=pdf]', (b) => b.click())]); const f2 = path.join(tmp, 'again.pdf'); await d2.saveAs(f2);
    ok('Log', '⬇ PDF from the log makes that report again, as it was', (await PDFDocument.load(fs.readFileSync(f2))).getPageCount() <= 3 && /Customer-update/.test(d2.suggestedFilename()));
    await custRow.$eval('[data-rdel]', (b) => b.click()); await p.click('#okBtn'); await sleep(500);
    ok('Log', '✕ deletes a report from the log', (await p.$$('tr[data-rid]')).length === 2);
    await p.setViewportSize({ width: 390, height: 844 }); await sleep(400);
    ok('Phone', 'no sideways scrolling on a phone', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await p.evaluate(() => document.documentElement.scrollWidth));
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close(); br = null;
  } catch (e) { try { if (br) await br.close(); } catch {} ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ') + ' LOG: ' + log.slice(-600)); }
  try { srv.kill(); } catch {} try { await blobs.stop(); } catch {} mock.close();
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(0);
})();
