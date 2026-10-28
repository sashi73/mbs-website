// End-to-end test of the SQL wizard & AI reports (v23): real Blobs, local site server, stand-in DeepSeek, headless Chromium.
const { chromium } = require('playwright');
const { spawn, execSync } = require('child_process');
const http = require('http'), path = require('path'), fs = require('fs'), os = require('os');
const SITE = path.resolve(process.argv[2]);
const PORT = 8896, BASE = `http://127.0.0.1:${PORT}`;
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => results.push({ area, name, pass: !!pass, detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-sql-test-blobs'); fs.rmSync(dir, { recursive: true, force: true });
  const blobs = new BlobsServer({ directory: dir, token: 'tok', port: 0 });
  const { port: bport } = await blobs.start();
  const ctxB64 = Buffer.from(JSON.stringify({ siteID: 'mbs', token: 'tok', edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, apiURL: `http://localhost:${bport}` })).toString('base64');
  process.env.NETLIFY_BLOBS_CONTEXT = ctxB64;
  // stand-in DeepSeek: records what it was sent, answers with a JSON report
  const ai = [];
  const mock = http.createServer((req, res) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => {
    let body = {}; try { body = JSON.parse(Buffer.concat(c).toString()); } catch {}
    ai.push(body);
    if (JSON.stringify(body).includes('FAILTEST')) return res.writeHead(500).end('{}');
    const content = JSON.stringify({ title: 'Pipeline snapshot', summary: 'Most jobs are still new or quoted. One job was won this month.', insights: ['2 new enquiries today', 'Quoted value $2,872.00', 'Castle Hill is the busiest suburb'], recommendations: ['Call the 2 new enquiries today'] });
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }));
  }); });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NETLIFY_BLOBS_CONTEXT: ctxB64, ADMIN_USERNAME: 'sashi73', ADMIN_PASSWORD: 'sashi98',
    LLM_API_KEY: 'test', LLM_BASE_URL: `http://127.0.0.1:${mock.address().port}`, TELEGRAM_BOT_TOKEN: '', RESEND_API_KEY: '' };
  const srv = spawn('node', ['local-server.mjs'], { cwd: SITE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 40 && !/running/.test(log); i++) await sleep(150);
  const cleanup = async () => { try { srv.kill(); } catch {} try { mock.close(); } catch {} try { await blobs.stop(); } catch {} };

  try {
    // ---- seed data ----
    const J = await import(path.join(SITE, 'netlify/lib/jobs.mjs'));
    const kv = await import(path.join(SITE, 'netlify/lib/kv.mjs'));
    const ACC = await import(path.join(SITE, 'netlify/lib/accounts.mjs'));
    const mk = async (trade, name, suburb, service, daysAgo) => {
      const core = await J.nextCore(trade);
      await J.create({ core, name, phone: '0400 000 00' + name.length, email: name.split(' ')[0].toLowerCase() + '@example.com', suburb, service, source: 'chat' });
      if (daysAgo) { const j = await kv.get('job:' + core); j.created -= daysAgo * 86400000; await kv.set('job:' + core, j); }
      return core;
    };
    const a = await mk('W', 'Priya Nair', 'Castle Hill', 'Leak repair', 0);
    const b = await mk('F', 'Tom Lee', 'Castle Hill', 'Repaint lounge', 0);
    const c = await mk('W', 'Ann Wu', 'Kellyville', 'Balcony waterproofing', 10);
    const d = await mk('T', 'Raj Patel', 'Box Hill', 'Bathroom tiles', 45);
    await J.setStage(a, 'quoted', 'test', { amount: 2872 });
    await J.setStage(c, 'quoted', 'test', { amount: 5500 }); await J.setStage(c, 'won', 'test');
    await J.setStage(d, 'lost', 'test', { reason: 'too expensive' });
    const q = await ACC.createDoc('quote', { core: a, customer: { name: 'Priya Nair' }, items: [{ desc: 'Membrane', qty: 6, price: 95 }, { desc: 'Labour', qty: 1, price: 1850 }, { desc: 'Council fee', qty: 1, price: 210, gst: false }] }, 'test');
    await ACC.setStatus(q.id, 'sent', 'test');
    const inv = (await ACC.quoteToInvoice(q.id, 'test')).doc;
    await ACC.setStatus(inv.id, 'sent', 'test'); await ACC.addPayment(inv.id, { amount: 1000, method: 'Card' }, 'test');
    await ACC.saveExpense({ supplier: 'Bunnings', desc: 'Membrane', category: 'Materials', inc: 550, core: a }, 'test');
    const { getStore } = await import(require.resolve('@netlify/blobs', { paths: [SITE] }));
    const today = ACC.today();
    await getStore({ name: 'mbs-visits', consistency: 'strong' }).setJSON('count', { total: 12, days: { [today]: 5, [ACC.addDays(today, -1)]: 7 } });

    const br = await chromium.launch();
    const ctx = await br.newContext({ viewport: { width: 1400, height: 950 }, acceptDownloads: true });
    const p = await ctx.newPage();
    const errors = []; errorsAll = errors;
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('dialog', (x) => { errors.push('dialog: ' + x.message()); x.dismiss(); });
    const api = (action, data = {}) => p.request.post(`${BASE}/.netlify/functions/admin`, { data: { action, ...data }, headers: { 'X-MBS-Admin': '1' } });
    const resText = () => p.evaluate(() => (document.querySelector('#sqlResults') || {}).textContent || '');
    const cell = (r, c) => p.evaluate(([r, c]) => { const t = document.querySelector('#resBody table'); return t ? t.rows[r].cells[c].textContent : ''; }, [r, c]);

    let r = await api('sqlData');
    ok('Security', 'the data for SQL needs a login', r.status() === 401, r.status());

    await p.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
    await p.fill('[name=username]', 'sashi73'); await p.fill('[name=password]', 'sashi98'); await p.click('#loginForm button');
    await p.waitForSelector('#app:not([hidden])');
    ok('Menu', 'left column has "SQL wizard & reports"', /SQL wizard/.test(await p.textContent('.side-nav')));
    await p.click('[data-nav=sql]');
    await p.waitForSelector('.sql-side .tbl', { timeout: 15000 });
    ok('AI query', 'the SQL wizard opens on "✨ AI query"', /AI query/.test(await p.textContent('#sqlTabs .tab.on')));
    await p.click('[data-tab=templates]');
    const side = await p.textContent('.sql-side');
    ok('Tables', 'tables listed with row counts (jobs 4 rows, quotes 1 row, payments 1 row, visits 2 rows)', /jobs\s*4 rows/.test(side) && /quotes\s*1 row(?!s)/.test(side) && /payments\s*1 row(?!s)/.test(side) && /visits\s*2 rows/.test(side), side.replace(/\s+/g, ' ').slice(0, 200));

    // ---- quick numbers with periods ----
    await p.click('[data-per=today]'); await p.waitForTimeout(200);
    await p.screenshot({ path: 'MBS_sql_templates.jpg', type: 'jpeg', quality: 80 });
    await p.click('.tpl >> text=Scorecard: all the key numbers'); await p.waitForSelector('#resBody table');
    await p.waitForTimeout(200); await p.screenshot({ path: 'MBS_sql_scorecard.jpg', type: 'jpeg', quality: 80 });
    const score = await p.$$eval('#resBody table tbody tr', (rs) => Object.fromEntries(rs.map((x) => [x.cells[0].textContent, x.cells[1].textContent])));
    ok('Quick numbers', 'Scorecard for today: 2 new enquiries, 2 customers quoted ($8,372), 1 job won, 1 lost, $1,000 received, $550 expenses', score['New enquiries'] === '2' && score['Customers quoted'] === '2' && score['Quoted ($ inc GST)'] === '8,372' && score['Jobs won'] === '1' && score['Jobs lost'] === '1' && score['Money received ($)'] === '1,000' && score['Expenses ($ inc GST)'] === '550', JSON.stringify(score));
    ok('Quick numbers', 'report title says the period', /Scorecard: all the key numbers \(today\)/.test(await p.evaluate(() => window.MBS.sqlState.title)));
    await p.click('[data-tab=templates]'); await p.click('[data-per=month]');
    await p.click('.tpl >> text=New enquiries per day'); await p.waitForSelector('#chCanvas');
    ok('Quick numbers', 'New enquiries per day (this month) opens as a line chart', (await p.evaluate(() => window.MBS.sqlState.chart.type)) === 'line');
    await p.click('[data-tab=templates]'); await p.click('[data-per=custom]');
    await p.fill('#perFrom', ACC.addDays(today, -60)); await p.dispatchEvent('#perFrom', 'change'); await p.fill('#perTo', today); await p.dispatchEvent('#perTo', 'change');
    await p.click('.tpl >> text=New enquiries'); await p.waitForSelector('#resBody table');
    ok('Quick numbers', 'date range (last 60 days): 4 new enquiries', (await cell(1, 0)) === '4', await cell(1, 0));
    await p.click('[data-tab=templates]'); await p.click('[data-per=week]');
    await p.click('.tpl >> text=New customers quoted'); await p.waitForSelector('#resBody table');
    ok('Quick numbers', 'New customers quoted (this week): 2 customers, $8,372', (await cell(1, 0)) === '2' && (await cell(1, 1)) === '8,372', (await cell(1, 0)) + ' / ' + (await cell(1, 1)));
    await p.click('[data-tab=templates]'); await p.click('.tpl >> text=Not called yet'); await p.waitForSelector('#resBody table');
    ok('Follow-ups', '"Not called yet" lists the new enquiry waiting for a call', /Tom Lee/.test(await resText()) && !/Priya/.test(await resText()));

    // ---- templates + charts ----
    await p.click('[data-tab=templates]'); await p.click('.tpl >> text=Jobs by stage'); await p.waitForSelector('#chCanvas');
    const types = ['bar', 'hbar', 'stacked', 'line', 'area', 'pie', 'doughnut', 'polarArea', 'radar'];
    let drawn = 0;
    for (const t of types) { await p.selectOption('#chType', t); await p.waitForTimeout(150); if (await p.evaluate(() => { const c = document.querySelector('#chCanvas'); return c && c.width > 0 && window.Chart.getChart(c); })) drawn++; }
    ok('Charts', 'switches between bar, horizontal bar, stacked, line, area, pie, doughnut, polar area and radar', drawn === types.length, drawn + '/' + types.length);
    await p.selectOption('#chType', 'pie'); await p.waitForTimeout(900);
    await p.screenshot({ path: 'MBS_sql_chart.jpg', type: 'jpeg', quality: 80 });
    await p.click('[data-view=records]');
    ok('Views', 'Records view shows each row as a card', (await p.$$('.rec')).length >= 3);
    await p.click('[data-view=table]');
    ok('Views', 'Table view shows rows', (await p.$$('#resBody tbody tr')).length >= 3);
    const dl = p.waitForEvent('download'); await p.click('#csvBtn'); const csvF = await dl;
    ok('Views', 'CSV download', /\.csv$/.test(csvF.suggestedFilename()) && /stage/.test(fs.readFileSync(await csvF.path(), 'utf8')));

    // ---- wizard: drag and drop ----
    await p.click('[data-tab=wizard]');
    await p.dragAndDrop('.chipd[data-table=jobs]', '[data-drop=table]');
    await p.waitForSelector('[data-drop=cols]');
    await p.dragAndDrop('.chipd[data-col=suburb][data-of=jobs]', '[data-drop=cols]');
    await p.check('#wzCount');
    await p.selectOption('#wzOrder', 'rows_count');
    const wsql = await p.textContent('#wzSql');
    ok('Wizard', 'drag a table and a column, tick "count": builds SELECT suburb, COUNT(*) … GROUP BY suburb ORDER BY rows_count', /SELECT suburb, COUNT\(\*\) AS rows_count\s+FROM jobs\s+GROUP BY suburb\s+ORDER BY rows_count DESC/.test(wsql), wsql);
    await p.dragAndDrop('.chipd[data-col=service][data-of=jobs]', '[data-drop=filter]');
    await p.selectOption('[data-fo="0"]', 'contains'); await p.fill('[data-fv="0"]', 'leak');
    ok('Wizard', 'drop a column on Filters, choose "contains": adds WHERE service LIKE \'%leak%\'', /WHERE service LIKE '%leak%'/.test(await p.textContent('#wzSql')));
    await p.click('#wzRun'); await p.waitForSelector('#resBody table');
    ok('Wizard', 'Run gives 1 row: Castle Hill', (await cell(1, 0)) === 'Castle Hill' && (await p.$$('#resBody tbody tr')).length === 1, await cell(1, 0));
    // aggregate via the column's menu
    await p.click('#wzReset'); await p.click('.chipd[data-table=invoices]'); await p.click('.chipd[data-col=inc][data-of=invoices]');
    await p.selectOption('[data-agg="0"]', 'SUM');
    ok('Wizard', 'tap-to-add works and SUM gives SUM(inc) AS sum_inc', /SELECT SUM\(inc\) AS sum_inc\s+FROM invoices/.test(await p.textContent('#wzSql')));
    await p.screenshot({ path: 'MBS_sql_wizard.jpg', type: 'jpeg', quality: 80 });

    // ---- editor: autocomplete, run, safety ----
    await p.click('[data-tab=editor]'); await p.waitForSelector('.CodeMirror');
    await p.evaluate(() => { const ed = document.querySelector('.CodeMirror').CodeMirror; ed.setValue(''); ed.focus(); });
    await p.keyboard.type('SELECT * FROM jo', { delay: 40 });
    await p.waitForSelector('.CodeMirror-hints', { timeout: 4000 }).catch(() => {});
    const hints = await p.$$eval('.CodeMirror-hint', (x) => x.map((h) => h.textContent));
    ok('Editor', 'auto-complete suggests table names while typing (jo → jobs)', hints.includes('jobs'), hints.join(','));
    await p.keyboard.press('Enter');
    await p.keyboard.type(' WHERE sub', { delay: 40 }); await p.waitForTimeout(400);
    const hints2 = await p.$$eval('.CodeMirror-hint', (x) => x.map((h) => h.textContent)).catch(() => []);
    ok('Editor', '…and column names (sub → suburb)', hints2.some((h) => /suburb/.test(h)), hints2.join(','));
    await p.keyboard.press('Escape');
    await p.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.setValue("SELECT name, suburb FROM jobs WHERE suburb = 'Castle Hill'"));
    await p.keyboard.press('Control+Enter'); await p.waitForTimeout(400);
    ok('Editor', 'Ctrl+Enter runs the query', (await p.$$('#resBody tbody tr')).length === 2);
    const tryBad = async (sql) => { await p.evaluate((s) => document.querySelector('.CodeMirror').CodeMirror.setValue(s), sql); await p.click('#sqlRun'); await p.waitForTimeout(250); return p.textContent('#toast'); };
    ok('Safety', 'DELETE is refused (reports can only read)', /Only SELECT/.test(await tryBad('DELETE FROM jobs')));
    ok('Safety', 'SELECT … INTO is refused', /not allowed/.test(await tryBad('SELECT * INTO backup FROM jobs')));
    ok('Safety', 'reading files is refused', /not allowed/.test(await tryBad("SELECT * FROM JSON('http://x/y.json')")));
    ok('Safety', 'two statements at once are refused', /one query at a time/.test(await tryBad('SELECT 1; SELECT 2')));
    ok('Safety', 'a reserved word gives a helpful tip', /reserved words/.test(await tryBad('SELECT COUNT(*) AS total FROM jobs')));
    r = await api('jobs', { stage: 'all' });
    ok('Safety', 'the real database is untouched (still 4 jobs)', (await r.json()).jobs.length === 4);
    // saved queries
    await p.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.setValue('SELECT suburb, COUNT(*) AS jobs FROM jobs GROUP BY suburb'));
    await p.click('#sqlSave'); await p.fill('#svName', 'Suburb count'); await p.click('#svGo');
    await p.click('[data-tab=saved]');
    ok('Editor', 'queries can be saved and listed', /Suburb count/.test(await p.textContent('#sqlPanel')));
    await p.click('[data-load="0"]'); await p.click('#sqlRun'); await p.waitForTimeout(300);
    await p.screenshot({ path: 'MBS_sql_editor.jpg', type: 'jpeg', quality: 80 });

    // ---- publish as report ----
    await p.click('[data-tab=templates]'); await p.click('.tpl >> text=Top suburbs'); await p.waitForSelector('#chCanvas');
    await p.click('#pubBtn'); await p.waitForSelector('#rpGo');
    await p.fill('#rpFocus', 'busiest suburbs');
    const before = ai.length;
    await p.click('#rpGo'); await p.waitForSelector('#rpSum', { timeout: 15000 });
    const sent = JSON.stringify(ai.slice(before));
    ok('AI report', 'DeepSeek writes the title, summary and findings (editable before download)', (await p.inputValue('#rpT2')) === 'Pipeline snapshot' && /Most jobs/.test(await p.inputValue('#rpSum')) && /Castle Hill/.test(await p.inputValue('#rpIns')));
    ok('AI report', 'the AI request uses the query results and the focus you typed', /busiest suburbs/.test(sent) && /Castle Hill/.test(sent));
    let chartData = '';
    p.on('request', (rq) => { try { const b = JSON.parse(rq.postData() || '{}'); if (b.action === 'sqlPdf') chartData = b.chart || ''; } catch {} });
    const dlp = p.waitForEvent('download'); await p.click('#rpGo'); const pdfF = await dlp;
    const pdfPath = await pdfF.path(); const pdfBuf = fs.readFileSync(pdfPath);
    fs.copyFileSync(pdfPath, 'MBS_sample_ai_report.pdf');
    const txt = execSync(`pdftotext -layout ${pdfPath} -`).toString();
    let imgs = ''; try { imgs = execSync(`pdfimages -list ${pdfPath}`).toString(); } catch {}
    ok('AI report', 'Download PDF gives a real PDF report with title, summary, findings, actions and the data', pdfBuf.slice(0, 4).toString() === '%PDF' && /Pipeline snapshot/.test(txt) && /Key findings/.test(txt) && /Suggested actions/.test(txt) && /Castle Hill/.test(txt), txt.slice(0, 200));
    ok('AI report', 'the chart is in the PDF (logo + chart images)', (imgs.match(/\n\s*\d+\s+\d+\s+image/g) || []).length >= 2, imgs.split('\n').length);
    const pngF = path.join(os.tmpdir(), 'mbs-chart.png'); fs.writeFileSync(pngF, Buffer.from(String(chartData).split(',')[1] || '', 'base64'));
    let gold = 0; try { gold = Number(execSync(`python3 -c "from PIL import Image; im=Image.open('${pngF}').convert('RGB'); print(sum(1 for p in im.get_flattened_data() if abs(p[0]-201)<25 and abs(p[1]-162)<25 and abs(p[2]-39)<40))"`).toString()); } catch {}
    ok('AI report', 'the chart in the report is fully drawn (bars are there, not an empty frame)', gold > 2000, gold + ' gold pixels');
    await p.click('#modal [data-close]');
    // a query with contact details: they must not go to the AI, and no empty chart is offered
    await p.click('[data-tab=editor]'); await p.waitForSelector('.CodeMirror');
    await p.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.setValue('SELECT name, phone, email, suburb, stage FROM jobs'));
    await p.click('#sqlRun'); await p.waitForTimeout(300);
    ok('Views', 'a new query from the editor gets a fresh title (not the last template\'s)', (await p.evaluate(() => window.MBS.sqlState.title)) === 'Query results');
    await p.click('#pubBtn'); await p.waitForSelector('#rpGo');
    ok('AI report', 'no chart is offered when the results have no numbers', /no number columns/.test(await p.textContent('#modal')));
    const b2 = ai.length; await p.click('#rpGo'); await p.waitForSelector('#rpSum', { timeout: 15000 });
    const sent2 = JSON.stringify(ai.slice(b2));
    ok('Privacy', 'names, phone numbers and emails are removed before anything goes to DeepSeek', !/0400 000/.test(sent2) && !/example\.com/.test(sent2) && !/Priya/.test(sent2) && /Castle Hill/.test(sent2));
    await p.click('#modal [data-close]');
    await p.click('[data-tab=templates]'); await p.click('.tpl >> text=Top suburbs'); await p.waitForSelector('#chCanvas');
    // AI down: still get a basic report
    await p.click('#pubBtn'); await p.waitForSelector('#rpGo'); await p.fill('#rpFocus', 'FAILTEST');
    await p.click('#rpGo'); await p.waitForSelector('#rpSum', { timeout: 15000 });
    ok('AI report', 'if DeepSeek fails, you still get a basic summary to download', /basic summary/.test(await p.textContent('#rpOut')) && /rows? returned/.test(await p.inputValue('#rpSum')));
    await p.click('#modal [data-close]');

    // ---- phone ----
    const m = await ctx.newPage(); await m.setViewportSize({ width: 390, height: 844 });
    m.on('pageerror', (e) => errors.push('phone: ' + e.message));
    await m.goto(`${BASE}/admin/#sql`, { waitUntil: 'domcontentloaded' }); await m.waitForSelector('#sqlTabs', { timeout: 15000 }); await m.click('[data-tab=templates]'); await m.waitForSelector('.tpl');
    await m.click('.tpl >> text=Jobs by stage'); await m.waitForSelector('#chCanvas');
    ok('Phone', 'SQL wizard works on a phone (no sideways scrolling)', await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await m.close();
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close();
  } catch (e) { ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ')); }
  await cleanup();
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  if (pass !== results.length) console.log('\n--- server log ---\n' + log.slice(-2000));
})();
