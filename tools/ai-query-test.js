// End-to-end test of the SQL wizard "AI query" (v24d): real Blobs, local site, a stand-in for DeepSeek, headless Chromium.
// The stand-in answers like DeepSeek would (SQL that follows the rules in the prompt), so the whole path is exercised:
// question -> SQL written by the AI -> runs in the browser -> plain-English answer, plus repair, safety and privacy.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http'), path = require('path'), fs = require('fs'), os = require('os');
const SITE = path.resolve(process.argv[2]);
const PORT = 8898, BASE = `http://127.0.0.1:${PORT}`;
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => { results.push({ area, name, pass: !!pass, detail }); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-ai-test-blobs'); fs.rmSync(dir, { recursive: true, force: true });
  const blobs = new BlobsServer({ directory: dir, token: 'tok', port: 0 });
  const { port: bport } = await blobs.start();
  const ctxB64 = Buffer.from(JSON.stringify({ siteID: 'mbs', token: 'tok', edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, apiURL: `http://localhost:${bport}` })).toString('base64');
  process.env.NETLIFY_BLOBS_CONTEXT = ctxB64;

  // ---- stand-in for DeepSeek ----
  const seen = []; let slowDone = false;
  const sqlFor = (q, u) => {
    const m = u.dates.this_month;
    if (/broken/i.test(q)) return u.fix ? `SELECT SUM(amount) AS paid_total FROM payments` : `SELECT SUM(amount) AS total FROM payments`;
    if (/delete/i.test(q)) return 'DELETE FROM jobs';
    if (/weather/i.test(q)) return '';
    if (/new jobs/i.test(q)) return `SELECT COUNT(*) AS new_jobs FROM jobs WHERE created BETWEEN '${m[0]}' AND '${m[1]}'`;
    if (/completion|project/i.test(q)) return "SELECT p.plan_name, j.ref, j.suburb, ROUND(SUM(CASE WHEN p.days < 1 THEN 1 ELSE p.days END * p.pct_complete) / SUM(CASE WHEN p.days < 1 THEN 1 ELSE p.days END)) AS pct_done, " +
      "COUNT(*) AS tasks_count, SUM(CASE WHEN p.done THEN 1 ELSE 0 END) AS tasks_done, SUM(CASE WHEN p.late THEN 1 ELSE 0 END) AS tasks_late, MAX(p.finish) AS planned_finish " +
      "FROM plan_tasks p JOIN jobs j ON p.job = j.core " + (/bathroom/i.test(q) ? "WHERE LOWER(p.plan_name) LIKE '%bathroom%' " : '') + 'GROUP BY p.plan_name, j.ref, j.suburb ORDER BY pct_done DESC';
    if (/owed/i.test(q)) return "SELECT id, customer, due, inc AS invoice_inc, balance AS owed, days_overdue FROM invoices WHERE status <> 'paid' AND status <> 'void' AND balance > 0 ORDER BY days_overdue DESC LIMIT 200";
    if (/suburb/i.test(q)) return `SELECT suburb, COUNT(*) AS enquiries FROM jobs WHERE created BETWEEN '${u.dates.this_year[0]}' AND '${u.dates.this_year[1]}' GROUP BY suburb ORDER BY enquiries DESC LIMIT 5`;
    if (/last month/i.test(q) && u.earlier) return `SELECT COUNT(*) AS new_jobs FROM jobs WHERE created BETWEEN '${u.dates.last_month[0]}' AND '${u.dates.last_month[1]}'`;
    return 'SELECT ref, suburb FROM jobs LIMIT 5';
  };
  const mock = http.createServer((req, res) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => {
    let body = {}; try { body = JSON.parse(Buffer.concat(c).toString()); } catch {}
    const sys = body.messages?.[0]?.content || ''; let u = {}; try { u = JSON.parse(body.messages?.[1]?.content || '{}'); } catch {}
    seen.push({ sys, u, raw: Buffer.concat(c).toString() });
    let content;
    if (/Turn the question/.test(sys) && /slowpoke/.test(u.q || '') && !slowDone) { slowDone = true; return setTimeout(() => { try { res.writeHead(200).end('{}'); } catch {} }, 4500); }
    if (/"ok": true/.test(sys)) content = JSON.stringify({ ok: true });
    else if (/Turn the question/.test(sys)) {
      const q = u.q || '', sql = sqlFor(q, u);
      content = JSON.stringify({ sql, title: /new jobs/i.test(q) ? 'New jobs this month' : /suburb/i.test(q) ? 'Top suburbs this year' : /completion|project/i.test(q) ? 'Project completion' : 'Answer',
        note: sql ? 'I used ' + u.dates.this_month.join(' to ') + ' for this month.' : 'Weather is not in your data.',
        chart: /suburb/i.test(q) ? { type: 'bar', x: 'suburb', y: ['enquiries'] } : null });
    } else if (/POSSIBLE RESOLUTIONS/.test(sys)) {
      const isRisk = 'risk' in u;
      content = JSON.stringify({ options: [
        { title: isRisk ? 'Moisture-test before strip-out' : 'Stop the leak and dry out', response: isRisk ? 'Mitigate' : 'Fix now', effort: 'Low', steps: ['Book a moisture meter check on day 1', 'Photograph and record readings'] },
        { title: isRisk ? 'Agree a contingency in the quote' : 'Tell the customer and agree a variation', response: isRisk ? 'Transfer' : 'Escalate', effort: 'Medium', steps: ['Add a clear variation clause', 'Get written sign-off'] }],
        watch: isRisk ? 'Soft or stained timber near the shower' : 'New stains on the ceiling below' });
    } else if (/Answer the business owner/.test(sys)) {
      const r = u.rows || [];
      content = JSON.stringify({ answer: r.length === 1 && 'new_jobs' in r[0] ? `You got ${r[0].new_jobs} new jobs this month.` : r.length && 'pct_done' in r[0] ? `The ${r[0].plan_name} project is ${r[0].pct_done}% complete (${r[0].tasks_done} of ${r[0].tasks_count} tasks done).` : `There are ${r.length} results.` });
    } else content = JSON.stringify({ title: 'x', summary: 'x', insights: [], recommendations: [] });
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }], usage: { total_tokens: Math.round(Buffer.concat(c).length / 3.6) + 60 } }));
  }); });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NETLIFY_BLOBS_CONTEXT: ctxB64, ADMIN_USERNAME: 'sashi73', ADMIN_PASSWORD: 'sashi98',
    LLM_API_KEY: 'test', LLM_BASE_URL: `http://127.0.0.1:${mock.address().port}`, AI_QUERY_MAX_TOKENS: '450', AI_QUERY_DAILY_LIMIT: '50', AI_TIMEOUT_SECONDS: '3', TELEGRAM_BOT_TOKEN: '', RESEND_API_KEY: '' };
  const srv = spawn('node', ['local-server.mjs'], { cwd: SITE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 40 && !/running/.test(log); i++) await sleep(150);
  const cleanup = async () => { try { srv.kill(); } catch {} try { mock.close(); } catch {} try { await blobs.stop(); } catch {} };

  try {
    // ---- seed: 3 jobs this month, 1 last month, a plan, an unpaid invoice ----
    const J = await import(path.join(SITE, 'netlify/lib/jobs.mjs'));
    const kv = await import(path.join(SITE, 'netlify/lib/kv.mjs'));
    const ACC = await import(path.join(SITE, 'netlify/lib/accounts.mjs'));
    const P = await import(path.join(SITE, 'netlify/lib/plan.mjs'));
    const mk = async (trade, name, suburb, service, daysAgo) => {
      const core = await J.nextCore(trade);
      await J.create({ core, name, phone: '0400 000 00' + name.length, email: name.split(' ')[0].toLowerCase() + '@example.com', suburb, service, source: 'chat' });
      if (daysAgo) { const j = await kv.get('job:' + core); j.created -= daysAgo * 86400000; await kv.set('job:' + core, j); await J.setStage(core, j.stage, 'test'); }
      return core;
    };
    const today = ACC.today(), dom = Number(today.slice(8));
    const a = await mk('W', 'Priya Nair', 'Castle Hill', 'Bathroom waterproofing', 0);
    await mk('F', 'Tom Lee', 'Castle Hill', 'Repaint lounge', 0);
    await mk('T', 'Ann Wu', 'Kellyville', 'Tiling', 0);
    await mk('R', 'Raj Patel', 'Box Hill', 'Render', dom + 3);   // last month
    const expectedNew = 3;
    await P.save(a, { name: 'Bathroom waterproofing & retiling', start: today,
      risks: [{ id: 'r1', title: 'Hidden water damage found during strip-out', cause: 'Old shower leaking for years', p: 3, i: 4, response: 'Accept', action: '', owner: '', status: 'Open' }],
      issues: [{ id: 'i1', title: 'Water stain on the ceiling below', detail: 'Neighbour reported it', priority: 'High', status: 'Open', raised: today }], tasks: [
      { id: 't1', name: 'Site inspection', dur: 1, pct: 100, status: 'done', res: ['Ali'], lead: 'Ali' },
      { id: 't2', name: 'Buy tiles', dur: 1, pct: 33, status: 'doing', pred: ['t1'] },
      { id: 't3', name: 'Tiling', dur: 2, pct: 0, status: 'todo', pred: ['t2'] }] }, 0, 'test');
    const q = await ACC.createDoc('quote', { core: a, customer: { name: 'Priya Nair' }, items: [{ desc: 'Labour', qty: 1, price: 1000 }] }, 'test');
    await ACC.setStatus(q.id, 'sent', 'test');
    const inv = (await ACC.quoteToInvoice(q.id, 'test')).doc; await ACC.setStatus(inv.id, 'sent', 'test');

    const br = await chromium.launch();
    const ctx = await br.newContext({ viewport: { width: 1400, height: 950 } });
    const p = await ctx.newPage(); p.setDefaultTimeout(15000);
    const errors = []; errorsAll = errors;
    p.on('pageerror', (e) => errors.push(e.message));
    const api = (action, data = {}) => p.request.post(`${BASE}/.netlify/functions/admin`, { data: { action, ...data }, headers: { 'X-MBS-Admin': '1' } });

    let r = await api('sqlAsk', { question: 'x' });
    ok('Security', 'AI query needs a login', r.status() === 401, r.status());
    await p.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
    await p.fill('[name=username]', 'sashi73'); await p.fill('[name=password]', 'sashi98'); await p.click('#loginForm button');
    await p.waitForSelector('#app:not([hidden])');
    ok('Find it', 'the left menu has "✨ Ask AI (plain English)" and the console shows its version', /Ask AI \(plain English\)/.test(await p.textContent('.side-nav')) && /^v2[4-9]/.test(await p.textContent('.side-foot .ver')));
    await p.click('[data-nav=ask]'); await p.waitForSelector('#askQ');
    ok('Find it', '"Ask AI" in the menu opens the AI query straight away (and is highlighted)', /AI query/.test(await p.textContent('#sqlTabs .tab.on')) && (await p.getAttribute('[data-nav=ask]', 'class')) === 'on');
    ok('Open', 'SQL wizard opens on "✨ AI query" with a question box and example questions', /AI query/.test(await p.textContent('#sqlTabs .tab.on')) && (await p.$$('[data-ex]')).length >= 6);

    const askAndWait = async (text) => {
      await p.fill('#askQ', text); await p.click('#askGo');
      await p.waitForFunction(() => { const b = document.querySelector('#askGo'); return b && !b.disabled && document.querySelector('#askOut .ask-a') && !document.querySelector('#askOut .ask-think'); });
      return { ans: await p.textContent('#askOut'), state: await p.evaluate(() => ({ sql: window.MBS.sqlState.sql, rows: window.MBS.sqlState.rows, title: window.MBS.sqlState.title, view: window.MBS.sqlState.view })) };
    };

    // 1. a count with "this month"
    let out = await askAndWait('How many new jobs did I get this month?');
    ok('Answer', `"How many new jobs this month?" → ${expectedNew} (big number + answer line)`, (await p.textContent('.ask-big')) === String(expectedNew) && /New jobs this month: 3\./.test(out.ans), out.ans.slice(0, 200));
    ok('Tokens', 'a single number needs no second AI call (saves tokens)', seen.filter((x) => /Answer the business owner/.test(x.sys)).length === 0);
    const w1 = seen.filter((x) => /Turn the question/.test(x.sys)).pop();
    const m = w1.u.dates.this_month;
    ok('Context', `the AI is given Sydney dates for "this month" (${m[0]} to ${m[1]}), this week, financial year…`, m[0] === today.slice(0, 8) + '01' && m[1] >= today && Array.isArray(w1.u.dates.this_financial_year) && w1.u.dates.today === today);
    ok('Context', 'the AI is given the tables, columns and short code lists (stages, plan names)', /jobs\(ref,core,stage/.test(w1.u.tables) && /new\|called\|quoted/.test(w1.u.notes) && w1.u.values.plans.some((x) => /Bathroom waterproofing/.test(x)));
    const body1 = JSON.parse(w1.raw);
    ok('Tokens', `writing the query: reply capped at AI_QUERY_MAX_TOKENS (450 here, default 500), request about ${Math.round(w1.raw.length / 3.6)} tokens (was about 2,400)`, body1.max_tokens === 450 && w1.raw.length / 3.6 < 1300, w1.raw.length);
    ok('Tokens', 'the screen shows the tokens used and today\'s question count', /used about \d[\d,]* tokens/.test(out.ans) && /Today: 1 of 50 AI questions used/.test(await p.textContent('#askUse')), await p.textContent('#askUse'));
    ok('Privacy', 'writing the query: no phone numbers, emails or customer names are sent to the AI', !/0400 000|@example\.com|Priya|Raj Patel|Ann Wu/.test(w1.raw));
    ok('Show SQL', 'the query the AI wrote can be seen and opened in the SQL editor', /SELECT COUNT\(\*\) AS new_jobs FROM jobs WHERE created BETWEEN/.test(await p.textContent('.ask-sql pre')) && /How I read it/.test(out.ans));

    // 2. project completion (join plan_tasks + jobs)
    out = await askAndWait('What is the completion status of the bathroom project?');
    const row = out.state.rows[0] || {};
    ok('Answer', '"Completion status of the bathroom project" → 33% done, 1 of 3 tasks (weighted by days, like the planner)', row.pct_done === 33 && row.tasks_done === 1 && row.tasks_count === 3 && /33% complete/.test(out.ans), JSON.stringify(row));
    const a2 = seen.filter((x) => /Answer the business owner/.test(x.sys)).pop();
    ok('Privacy', 'wording the answer: names, phones and emails are removed from the rows the AI sees', a2 && !/Priya|0400|@example/.test(a2.raw));
    ok('Tokens', 'wording the answer: reply capped at 200 tokens, at most 20 rows sent', JSON.parse(a2.raw).max_tokens === 200 && a2.u.rows.length <= 20);
    ok('Results', 'the results table is shown under the answer', /pct_done/.test(await p.textContent('#sqlResults')));

    // 3. a chart when there are several rows
    out = await askAndWait('Top 5 suburbs for enquiries this year');
    ok('Chart', 'list questions come back as a chart when the AI suggests one (Castle Hill first)', out.state.view === 'chart' && (await p.$('#chCanvas')) && out.state.rows[0].suburb === 'Castle Hill' && out.state.rows[0].enquiries === 2, JSON.stringify(out.state.rows));

    // 4. follow-up uses the earlier question
    out = await askAndWait('and last month?');
    const w4 = seen.filter((x) => /Turn the question/.test(x.sys)).pop();
    ok('Follow-up', 'follow-up questions ("and last month?") get the earlier question as context', Array.isArray(w4.u.earlier) && w4.u.earlier.length === 1 && out.state.rows[0] && out.state.rows[0].new_jobs === 1, JSON.stringify(out.state.rows));

    // 5. a broken query is repaired automatically
    const before = seen.length;
    out = await askAndWait('broken total of payments');
    const fixes = seen.slice(before).filter((x) => x.u.fix);
    ok('Repair', 'if the AI\'s first query fails, the error goes back and the fixed query runs', fixes.length === 1 && /reserved|mistake|Parse/i.test(fixes[0].u.fix.error) && /paid_total/.test(out.state.sql), out.ans.slice(0, 160));

    // 6. safety: a query that would change data is refused
    out = await askAndWait('delete all my jobs');
    ok('Safety', 'a query that would change data is refused (nothing deleted)', /not allowed/.test(out.ans) && (await J.all()).length === 4);
    r = await api('sqlAsk', { question: 'delete all my jobs' }); const rj = await r.json();
    ok('Safety', 'the server itself refuses it too (no SQL handed back)', rj.sql === '' && /not allowed/.test(rj.note));

    // 7. questions the data can't answer
    out = await askAndWait('What will the weather be tomorrow?');
    ok('Limits', 'questions the data cannot answer get a polite explanation', /Weather is not in your data/.test(out.ans) && (await p.$('#askOut .ask-ans.err')));

    // 8. earlier questions + editor
    await p.click('[data-tab=templates]'); await p.click('[data-tab=ask]'); await p.waitForSelector('.ask-log');
    ok('History', 'earlier questions are listed and can be opened again', (await p.$$('.ask-old')).length >= 4);
    await p.click('.ask-log summary'); await p.click('.ask-old >> text=How many new jobs did I get this month?');
    await p.waitForFunction(() => window.MBS.sqlState.rows.length === 1 && 'new_jobs' in window.MBS.sqlState.rows[0]);
    await p.click('.ask-sql summary'); await p.click('#askEdit'); await p.waitForSelector('.CodeMirror');
    ok('Editor', '"Open in SQL editor" puts the AI\'s query in the editor', /new_jobs/.test(await p.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.getValue())));
    await p.click('[data-tab=ask]'); await p.waitForSelector('#askQ');
    await p.click('[data-ex="How many new jobs did I get this month?"]');
    await p.waitForFunction(() => !document.querySelector('#askGo').disabled && !document.querySelector('#askOut .ask-think'));
    await p.screenshot({ path: 'MBS_ai_query.jpg', type: 'jpeg', quality: 80 });
    ok('Examples', 'tapping an example question asks it', /New jobs this month: 3/.test(await p.textContent('#askOut')));
    // ---- slow AI: Netlify only waits ~10 s, so the server gives up at AI_TIMEOUT_SECONDS and the page retries once ----
    const nSlow = seen.length;
    out = await askAndWait('slowpoke: how many new jobs this month?');
    ok('Slow AI', 'if DeepSeek is too slow the server stops waiting in time and the page retries once by itself', seen.slice(nSlow).filter((x) => /Turn the question/.test(x.sys)).length === 2 && out.state.rows[0] && out.state.rows[0].new_jobs === 3, out.ans.slice(0, 160));
    await p.click('#aiPing'); await p.waitForFunction(() => /DeepSeek answered|❌/.test(document.querySelector('#aiPingOut').textContent));
    ok('Test AI', '"Test AI connection" says whether DeepSeek answers and how fast', /✅ DeepSeek answered in \d+\.\d s/.test(await p.textContent('#aiPingOut')), await p.textContent('#aiPingOut'));

    // ---- planner: ✨ Ask AI on risks and issues ----
    await p.goto(`${BASE}/admin/#plan/${a}/risks`); await p.waitForSelector('[data-rai]');
    await p.click('[data-rai]'); await p.waitForSelector('#aiGo');
    await p.fill('#aiAsk', 'Customer wants it finished before Christmas'); await p.click('#aiGo');
    await p.waitForSelector('#aiOut .ai-opt');
    const adv = seen.filter((x) => /POSSIBLE RESOLUTIONS/.test(x.sys)).pop();
    ok('Ask AI', 'a risk gets "Possible resolutions" (2 options with steps, response and effort)', /Possible resolutions/.test(await p.textContent('#aiOut')) && (await p.$$('#aiOut .ai-opt')).length === 2 && /Moisture-test before strip-out/.test(await p.textContent('#aiOut')) && /Mitigate/.test(await p.textContent('#aiOut')));
    ok('Ask AI', 'the AI gets the risk, its score, the extra question and the kind of work', adv.u.risk === 'Hidden water damage found during strip-out' && adv.u.probability_1to5 === 3 && adv.u.impact_1to5 === 4 && /Christmas/.test(adv.u.extra_question) && /Bathroom/.test(adv.u.job.work + adv.u.job.plan));
    ok('Ask AI', 'reply capped at 400 tokens (AI_ADVISE_MAX_TOKENS), no customer name / phone / email sent', JSON.parse(adv.raw).max_tokens === 400 && !/Priya|0400 000|@example\.com/.test(adv.raw));
    ok('Ask AI', 'shows tokens used and counts towards the daily AI limit', /Used about \d[\d,]* tokens · today \d+ of 50 AI questions/.test(await p.textContent('#aiOut')));
    await p.screenshot({ path: 'MBS_plan_askai.jpg', type: 'jpeg', quality: 80 });
    await p.click('#aiOut [data-use="1"]'); await p.waitForSelector('#modal', { state: 'hidden' });
    await p.waitForFunction(() => document.querySelector('#planSave').textContent === 'Saved ✓', null, { timeout: 8000 }).catch(() => {}); await p.waitForTimeout(1200);
    let pl = await kv.get('plan:' + a);
    ok('Ask AI', '"Use as the action" puts the suggestion into the risk (and sets the response to Transfer)', /Agree a contingency in the quote: Add a clear variation clause; Get written sign-off/.test(pl.risks[0].action) && pl.risks[0].response === 'Transfer', JSON.stringify(pl.risks[0]));
    await p.click('[data-rai]'); await p.waitForSelector('#aiOut .ai-opt');
    ok('Ask AI', 'opening it again shows the last suggestions without asking the AI again', seen.filter((x) => /POSSIBLE RESOLUTIONS/.test(x.sys)).length === 1);
    await p.click('#modal [data-close]');
    await p.click('#planTabs >> text=Issues'); await p.waitForSelector('[data-xai]');
    await p.click('[data-xai]'); await p.waitForSelector('#aiGo'); await p.click('#aiGo'); await p.waitForSelector('#aiOut .ai-opt');
    const adv2 = seen.filter((x) => /POSSIBLE RESOLUTIONS/.test(x.sys)).pop();
    ok('Ask AI', 'an issue gets possible resolutions too (fix now / prevent)', adv2.u.issue === 'Water stain on the ceiling below' && adv2.u.priority === 'High' && /Stop the leak and dry out/.test(await p.textContent('#aiOut')));
    await p.click('#aiOut [data-use="0"]'); await p.waitForSelector('#modal', { state: 'hidden' }); await p.waitForTimeout(1500);
    pl = await kv.get('plan:' + a);
    ok('Ask AI', '"Use as the resolution" fills the issue\'s resolution and moves it to In progress', /Stop the leak and dry out/.test(pl.issues[0].resolution) && pl.issues[0].status === 'In progress', JSON.stringify(pl.issues[0]));
    r = await api('planAdvise', { core: a, kind: 'risk', id: 'nope', item: { title: '' } });
    ok('Ask AI', 'a blank risk is not sent to the AI', r.status() === 400 && /Write the risk first/.test((await r.json()).error));

    await p.goto(`${BASE}/admin/#sql`); await p.waitForSelector('#sqlTabs'); await p.click('[data-tab=ask]'); await p.waitForSelector('#askQ');
    // daily limit
    await kv.update('ai-usage', (x) => { x.days[Object.keys(x.days).sort().pop()].questions = 50; return x; }, () => ({ days: {} }));
    out = await askAndWait('How many new jobs did I get this month?');
    ok('Limit', 'after AI_QUERY_DAILY_LIMIT questions (50) the AI is not called again that day', /Daily limit reached: 50 AI questions today/.test(out.ans));
    r = await api('planAdvise', { core: a, kind: 'risk', id: 'r1' });
    ok('Limit', 'the same daily limit stops "Ask AI" on risks and issues', r.status() === 429 && /Daily limit reached/.test((await r.json()).error));

    // 9. phone
    const ph = await ctx.newPage(); await ph.setViewportSize({ width: 390, height: 844 });
    ph.on('pageerror', (e) => errors.push('phone: ' + e.message));
    await ph.goto(`${BASE}/admin/#sql`, { waitUntil: 'domcontentloaded' }); await ph.waitForSelector('#askQ');
    ok('Phone', 'AI query fits on a phone (no sideways scrolling)', await ph.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await ph.close();
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close();
  } catch (e) { ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ')); }
  await cleanup();
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  if (pass !== results.length) console.log('\n--- server log ---\n' + log.slice(-2000));
})();
