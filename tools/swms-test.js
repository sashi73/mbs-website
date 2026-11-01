// v57: 🦺 SWMS. Written by the (stand-in) AI from the project plan from the SWMS tab or by asking Project Intelligence;
// opens in its own editor (#swms/<job>), every part can be changed and saves itself; downloads as Word and PDF, prints.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const SITE = path.resolve(process.argv[2]);
const PORT = 8957, BASE = `http://127.0.0.1:${PORT}`;
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => results.push({ area, name, pass: !!pass, detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const seen = [];
const SW = { work: 'Bathroom strip-out, waterproofing and retiling', hrcw: ['a', 'k'], hrcw_notes: 'Ladder work over 2 m in the stairwell; electrical rough-in near live circuits.',
  steps: [{ step: 'Strip out old tiles', hazards: 'Silica dust, flying debris, manual handling', risk: 'High', controls: '- Wet cutting\n- P2 masks\n- Safety glasses', residual: 'Low', who: 'Tiler' },
    { step: 'Electrical rough-in', hazards: 'Electric shock from live circuits', risk: 'Extreme', controls: ['Isolate and tag out at the board', 'Licensed electrician only'], residual: 'Low', who: 'Licensed electrician' },
    { step: 'Apply waterproofing membrane', hazards: 'Chemical fumes, slips', risk: 'Medium', controls: '- Ventilate\n- Gloves and respirator per SDS', residual: 'Low', who: 'Waterproofer' }],
  ppe: ['Safety boots', 'P2 mask', 'Safety glasses'], plant: ['Tile saw: guard and lead check'], quals: ['White card', 'Electrical licence'],
  emergency: { first_aid: 'First aid kit in the van', assembly: 'Front footpath', hospital: 'Check nearest: Westmead Hospital ED', plan: '- Call 000\n- Stop work and make safe' },
  monitor: '- Supervisor checks controls daily\n- Review if the work changes', consultation: '- Toolbox talk before starting' };
const mock = http.createServer((req, res) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => {
  const body = JSON.parse(Buffer.concat(c).toString() || '{}'); seen.push({ sys: body.messages[0].content, user: body.messages[1].content, max: body.max_tokens });
  const out = /Safe Work Method Statement/.test(body.messages[0].content) ? SW : { answer: 'The highest risk step is the electrical rough-in.' };
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(out) }, finish_reason: 'stop' }], usage: { total_tokens: 3100 } }));
}); });

(async () => {
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-swms-blobs'); fs.rmSync(dir, { recursive: true, force: true });
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
  const tmp = path.join(os.tmpdir(), 'mbs-swms-files'); fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp);
  try {
    const J = await import(path.join(SITE, 'netlify/lib/jobs.mjs')), kv = await import(path.join(SITE, 'netlify/lib/kv.mjs'));
    const core = await J.nextCore('W');
    await J.create({ core, name: 'Wendy Wet', phone: '0400 321 654', email: 'wendy@example.com', suburb: 'Castle Hill', service: 'Bathroom', source: 'phone', summary: 'Bathroom renovation.' });
    br = await chromium.launch();
    const ctx = await br.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
    const p = await ctx.newPage(); p.setDefaultTimeout(30000);
    const errors = []; errorsAll = errors;
    p.on('pageerror', (e) => errors.push(e.message)); p.on('dialog', (x) => { errors.push('dialog: ' + x.message()); x.dismiss(); });
    await p.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
    await p.fill('[name=username]', 'sashi73'); await p.fill('[name=password]', 'sashi98'); await p.click('#loginForm button');
    await p.waitForSelector('#app:not([hidden])');
    await p.goto(`${BASE}/admin/#plan/${core}`); await p.waitForSelector('#tplType'); await p.selectOption('#tplType', { index: 1 }); await p.click('#tplCreate'); await p.waitForSelector('table.gt');

    const tabs = await p.$$eval('#planTabs .tab', (x) => x.map((a) => a.textContent.trim()));
    ok('Tab', '"🦺 SWMS" sits just before Project Intelligence', tabs.indexOf('🦺 SWMS') === tabs.indexOf('🧠 Project Intelligence') - 1 && tabs.indexOf('🦺 SWMS') === tabs.indexOf('📞 Comms') + 1, tabs.join(' | '));
    await p.click('#planTabs >> text=SWMS'); await p.waitForSelector('#swGo');
    await p.click('#swGo');
    await p.waitForFunction(() => /^#swms\//.test(location.hash) && document.querySelector('table.sw-steps'), null, { timeout: 60000 });
    const g = seen.find((s) => /Safe Work Method Statement/.test(s.sys)), u = JSON.parse(g.user);
    ok('Write', 'the AI gets the plan\'s tasks and the 18 high-risk work categories, not the customer\'s details', u.tasks.length > 5 && u.hrcw_list.length === 18 && !/Wendy|0400 321 654|wendy@/.test(g.user) && g.max >= 7000, g.max);
    let doc = await kv.get('swms:' + core);
    ok('Write', 'it opens in its own SWMS editor with the details filled in from the business and the job', /#swms\//.test(await p.evaluate(() => location.hash)) && doc.details.business && doc.details.job && doc.details.site === 'Castle Hill' && doc.version === 1 && doc.status === 'Draft');
    ok('Write', 'high-risk work ticked (falls over 2 m, live electrical), 3 job steps, controls as lines, sign-on rows', doc.hrcw.join() === 'a,k' && doc.steps.length === 3 && /- Isolate and tag out/.test(doc.steps[1].controls) && doc.signon.length === 8 &&
      await p.isChecked('[data-h="a"]') && await p.isChecked('[data-h="k"]') && !(await p.isChecked('[data-h="d"]')));
    await p.screenshot({ path: path.join(__dirname, 'shot57-editor.png'), fullPage: true });

    // edit everything, it saves itself
    await p.fill('tr[data-i="0"] [data-s=step]', 'Strip out old wall and floor tiles'); await p.selectOption('tr[data-i="2"] [data-s=risk]', 'High');
    await p.check('[data-h="d"]'); await p.click('#swAddStep'); await p.fill('tr[data-i="3"] [data-s=step]', 'Clean up and remove waste'); await p.fill('tr[data-i="3"] [data-s=hazards]', 'Manual handling');
    await p.fill('tr[data-g="0"] [data-g=name]', 'Tom Tiler'); await p.fill('[data-d=supervisor]', 'Sashi'); await p.fill('textarea[data-p=ppe]', 'Safety boots\nP2 mask\nHearing protection');
    await sleep(1500);
    doc = await kv.get('swms:' + core);
    ok('Edit', 'changes save as you type: step, risk, high-risk work, new step, sign-on, supervisor, PPE', doc.steps[0].step === 'Strip out old wall and floor tiles' && doc.steps[2].risk === 'High' && doc.hrcw.includes('d') && doc.steps.length === 4 && doc.signon[0].name === 'Tom Tiler' && doc.details.supervisor === 'Sashi' && doc.ppe.length === 3 && doc.edited, JSON.stringify(doc.steps.map((s) => s.step)));
    await p.click('tr[data-i="3"] [data-mv="-1"]'); await sleep(1200);
    ok('Edit', 'steps can be moved', (await kv.get('swms:' + core)).steps[2].step === 'Clean up and remove waste');
    await p.selectOption('#swStatus', 'Issued'); await sleep(800);
    ok('Edit', 'it can be marked Issued', (await kv.get('swms:' + core)).status === 'Issued');

    // downloads
    const [dw] = await Promise.all([p.waitForEvent('download'), p.click('[data-swdl=docx]')]);
    const wf = path.join(tmp, 'w.docx'); await dw.saveAs(wf);
    const mammoth = require(require.resolve('mammoth', { paths: [path.resolve(process.argv[3] || path.join(__dirname, 'xl')), SITE, __dirname] }));
    const wtxt = (await mammoth.extractRawText({ path: wf })).value;
    ok('Word', 'Word download: SWMS-<job>-v1.docx with the edited steps, ☒ ticked high-risk work and the sign-on', /^SWMS-.+-v1\.docx$/.test(dw.suggestedFilename()) && /SAFE WORK METHOD STATEMENT/.test(wtxt) && /Strip out old wall and floor tiles/.test(wtxt) && /☒ Likely to disturb asbestos/.test(wtxt) && /Tom Tiler/.test(wtxt) && /Issued/.test(wtxt), dw.suggestedFilename() + ' ' + wtxt.slice(0, 120));
    const [dp] = await Promise.all([p.waitForEvent('download'), p.click('[data-swdl=pdf]')]);
    const pf = path.join(tmp, 'w.pdf'); await dp.saveAs(pf);
    const pb = fs.readFileSync(pf);
    ok('PDF', 'PDF download: a real landscape PDF', /^SWMS-.+-v1\.pdf$/.test(dp.suggestedFilename()) && pb.slice(0, 4).toString() === '%PDF' && pb.length > 8000 && /\[X\] Likely to disturb asbestos/.test(require('child_process').execSync('pdftotext "' + pf + '" -').toString()) && /MediaBox \[0 0 841\.8\d* 595\.2\d*\]/.test(pb.toString("latin1")), dp.suggestedFilename() + ' ' + pb.length);
    const [pop] = await Promise.all([p.waitForEvent('popup'), p.click('#swPrint')]);
    await pop.waitForLoadState(); const ptxt = await pop.textContent('body');
    ok('Print', '🖨 Print opens a print layout of the SWMS', /SAFE WORK METHOD STATEMENT/.test(ptxt) && /Tom Tiler/.test(ptxt)); await pop.close();

    // the tab now shows the summary
    await p.click('text=← Project plan'); await p.waitForSelector('.sw-sum');
    ok('Tab', 'the SWMS tab shows the summary: steps, high risks, categories, signed on, Issued', /4\s*job steps/.test(await p.textContent('.sw-sum')) && /Issued · version 1/.test(await p.textContent('.sw-card')) && /1\s*workers signed on/.test(await p.textContent('.sw-sum')));

    // Project Intelligence: "generate a SWMS" writes version 2
    await p.click('#planTabs >> text=Project Intelligence'); await p.waitForSelector('#piQ');
    ok('Intelligence', 'Project Intelligence has the example "Generate a SWMS for this project"', await p.isVisible('[data-piex="Generate a SWMS for this project"]'));
    await p.click('[data-piex="Generate a SWMS for this project"]');
    await p.waitForFunction(() => !document.querySelector('#piLog .ask-think') && document.querySelectorAll('#piLog .pi-a').length >= 1, null, { timeout: 60000 });
    doc = await kv.get('swms:' + core);
    ok('Intelligence', 'asking it writes a new SWMS version from the plan and says what is in it', doc.version === 2 && doc.status === 'Draft' && /SWMS written \(version 2\)/.test(await p.textContent('.pi-a')) && /3 job steps/.test(await p.textContent('.pi-a')));
    ok('Intelligence', 'with buttons to open it and download Word or PDF', await p.isVisible('.pi-a a[href^="#swms/"]') && await p.isVisible('.pi-a [data-swdl=docx]') && await p.isVisible('.pi-a [data-swdl=pdf]'));
    await p.fill('#piQ', 'Which steps have the highest risk?'); await p.click('#piGo');
    await p.waitForFunction(() => !document.querySelector('#piLog .ask-think') && document.querySelectorAll('#piLog .pi-a').length >= 2, null, { timeout: 60000 });
    const last = JSON.parse(seen[seen.length - 1].user);
    ok('Intelligence', 'questions about the SWMS are answered from it', last.swms && last.swms.steps.length === 3 && last.swms.high_risk_work.length === 2);
    await p.click('.pi-a >> nth=1 >> a[href^="#swms/"]'); await p.waitForSelector('table.sw-steps');
    await p.setViewportSize({ width: 390, height: 844 }); await sleep(400);
    ok('Phone', 'no sideways scrolling on a phone (the steps table scrolls inside)', (await p.evaluate(() => document.documentElement.scrollWidth)) <= 391, await p.evaluate(() => document.documentElement.scrollWidth));
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close(); br = null;
  } catch (e) { try { if (br) await br.close(); } catch {} ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ') + ' LOG: ' + log.slice(-600)); }
  try { srv.kill(); } catch {} try { mock.close(); } catch {} try { await blobs.stop(); } catch {}
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(0);
})();
