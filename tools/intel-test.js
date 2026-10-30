// v52: 🧠 Project Intelligence. Upload a PDF contract and a text spec, ask for critical / non-critical risks (added to the
// register), a stakeholder register (added to Stakeholders), a 45-minute Google Meet with the stakeholders (Google Calendar
// link, .ics, saved to the project), and a question answered from deep inside a long document. A stand-in AI; real Blobs, Chromium.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const SITE = path.resolve(process.argv[2]);
const PORT = 8952, BASE = `http://127.0.0.1:${PORT}`;
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => results.push({ area, name, pass: !!pass, detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const seen = [];
const mock = http.createServer((req, res) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => {
  const body = JSON.parse(Buffer.concat(c).toString() || '{}'), sys = body.messages[0].content, u = JSON.parse(body.messages[1].content);
  seen.push({ sys, u, raw: body.messages[1].content });
  let out = { answer: 'OK' };
  if (/critical and non-critical risks/i.test(u.question)) {
    const crit = u.tasks.filter((t) => t.critical);
    out = { answer: '## Risks\nThe finish depends on **' + crit.length + ' critical tasks**.\n\n| Risk | Path |\n|---|---|\n| Late tiles | Critical |\n| Rain | Non-critical |\n\n- Liquidated damages apply (Contract.pdf, page 2).',
      risks: [{ title: 'Tiles delivered late', cause: 'Supplier lead time', p: 3, i: 4, response: 'Mitigate', action: 'Order now', owner: 'PM', critical: true },
        { title: 'Waterproofing fails flood test', cause: 'Membrane not cured', p: 2, i: 5, response: 'Avoid', action: 'Cure 24h', owner: 'Waterproofer', critical: true },
        { title: 'Rain delays skip pickup', cause: 'Weather', p: 3, i: 2, response: 'Accept', action: 'Cover', owner: 'Site', critical: false }],
      sources: ['Contract.pdf'], follow_ups: ['Who owns each risk?'] };
  } else if (/stakeholder register/i.test(u.question)) {
    out = { answer: 'Here is a stakeholder register for this job.', stakeholders: [{ ref: 'S1', name: u.stakeholders[0].name, role: u.stakeholders[0].role, raci: 'C', interest: 'High', influence: 'High', engagement: 'Weekly update' },
      { ref: '', name: 'Hills Certifiers', role: 'Principal certifier', raci: 'C', interest: 'Medium', influence: 'High', engagement: 'Book inspections early' }] };
  } else if (/Google Meet/i.test(u.question)) {
    const d = new Date(u.today + 'T00:00:00Z'); do { d.setUTCDate(d.getUTCDate() + 1); } while (d.getUTCDay() !== 2);
    out = { answer: 'Meeting set up for next Tuesday.', meeting: { title: 'Progress review', date: d.toISOString().slice(0, 10), start: '10:00', minutes: 45, attendees: u.stakeholders.map((s) => s.ref), agenda: ['Progress', 'Risks', 'Next steps'] } };
  } else if (/termination/i.test(u.question)) {
    const hit = u.document_extracts.find((x) => /NEEDLE-TERMINATION/.test(x.text));
    out = { answer: hit ? 'Either party may end the contract with 14 days written notice (Long spec.txt).' : 'Not found in the documents.', sources: hit ? ['Long spec.txt'] : [] };
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(out) }, finish_reason: 'stop' }], usage: { total_tokens: 1500 } }));
}); });

(async () => {
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-intel-blobs'); fs.rmSync(dir, { recursive: true, force: true });
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
  const tmp = path.join(os.tmpdir(), 'mbs-intel-files'); fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp);
  try {
    // a 2-page contract PDF that names the customer (must not reach the AI)
    const { PDFDocument, StandardFonts } = require(require.resolve('pdf-lib', { paths: [SITE] }));
    const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = (lines) => { const pg = pdf.addPage([595, 842]); lines.forEach((l, i) => pg.drawText(l, { x: 50, y: 790 - i * 18, size: 11, font })); };
    page(['HOME BUILDING CONTRACT', 'Owner: Penny Pearce, phone 0400 777 888, email penny@example.com', 'Builder: Modern Building Solutions', 'Contract price: $48,500 including GST']);
    page(['Clause 12: Liquidated damages of $250 per day apply if the works finish late.', 'Clause 15: Defects liability period of 12 months after completion.', 'Clause 9: Deposit 10%, then progress payments at each stage.']);
    fs.writeFileSync(path.join(tmp, 'Contract.pdf'), await pdf.save());
    fs.writeFileSync(path.join(tmp, 'Bathroom spec.txt'), 'SPECIFICATION\n\nWall tiles: 300x600 gloss white. Floor tiles: 600x600 matt grey. Waterproofing to AS 3740.');
    let long = 'LONG SPECIFICATION\n\n'; for (let i = 0; i < 700; i++) long += `Section ${i}: general requirement about materials, workmanship, cleaning, protection of finishes and site safety for item ${i}.\n\n`;
    long += 'Clause 88 NEEDLE-TERMINATION: either party may end the contract by giving 14 days written notice.\n\n'; for (let i = 0; i < 200; i++) long += `Appendix ${i}: more standard wording about paint colours and fixtures.\n\n`;
    fs.writeFileSync(path.join(tmp, 'Long spec.txt'), long);

    const J = await import(path.join(SITE, 'netlify/lib/jobs.mjs'));
    const kv = await import(path.join(SITE, 'netlify/lib/kv.mjs'));
    const core = await J.nextCore('P');
    await J.create({ core, name: 'Penny Pearce', phone: '0400 777 888', email: 'penny@example.com', suburb: 'Kellyville', service: 'Bathroom', source: 'phone', summary: 'Full bathroom renovation.' });
    br = await chromium.launch();
    const ctx = await br.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
    const p = await ctx.newPage(); p.setDefaultTimeout(30000);
    const errors = []; errorsAll = errors;
    p.on('pageerror', (e) => errors.push(e.message)); p.on('dialog', (x) => { errors.push('dialog: ' + x.message()); x.dismiss(); });
    await p.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
    await p.fill('[name=username]', 'sashi73'); await p.fill('[name=password]', 'sashi98'); await p.click('#loginForm button');
    await p.waitForSelector('#app:not([hidden])');
    await p.goto(`${BASE}/admin/#plan/${core}`); await p.waitForSelector('#tplType');
    await p.selectOption('#tplType', { index: 1 }); await p.click('#tplCreate'); await p.waitForSelector('table.gt');
    const saved = async () => { await p.waitForFunction(() => /Saved/.test((document.querySelector('#planSave') || {}).textContent || ''), null, { timeout: 15000 }); await sleep(300); };
    // two stakeholders with emails: the customer and a plumber
    await p.click('#planTabs >> text=Stakeholders'); await p.waitForSelector('#skCust'); await p.click('#skCust'); await saved();
    await p.click('#addStake'); const r2 = 'tr[data-sid] >> nth=1';
    await p.fill(`${r2} >> [data-s=name]`, 'Pete Plumber'); await p.fill(`${r2} >> [data-s=role]`, 'Plumber'); await p.fill(`${r2} >> [data-s=phone]`, '0411 555 666'); await p.fill(`${r2} >> [data-s=email]`, 'pete@plumbing.example.com'); await saved();

    const tabs = await p.$$eval('#planTabs .tab', (x) => x.map((a) => a.textContent.trim()));
    ok('Tab', '"🧠 Project Intelligence" comes after Stakeholders', tabs.indexOf('🧠 Project Intelligence') === tabs.indexOf('👥 Stakeholders') + 1, tabs.join(' | '));
    await p.click('#planTabs >> text=Project Intelligence'); await p.waitForSelector('#piQ');
    ok('Tab', 'opens at #plan/<job>/intel with example questions and an upload button', /\/intel$/.test(await p.evaluate(() => location.hash)) && (await p.$$eval('[data-piex]', (x) => x.length)) === 5 && await p.isVisible('label[for=piFile]'));

    // upload
    await p.setInputFiles('#piFile', [path.join(tmp, 'Contract.pdf'), path.join(tmp, 'Bathroom spec.txt')]);
    await p.waitForFunction(() => document.querySelectorAll('.pi-docs li').length === 2, null, { timeout: 30000 });
    const docs = (await kv.get('pdocs:' + core)).docs;
    const cText = (await kv.get(`pdoctext:${core}:${docs[0].id}`) || {}).text || '';
    ok('Upload', 'a PDF contract is read in the browser (2 pages) and recognised as a Contract', docs[0].name === 'Contract.pdf' && docs[0].pages === 2 && docs[0].kind === 'Contract' && /Liquidated damages of \$250 per day/.test(cText) && /\[page 2\]/.test(cText), JSON.stringify(docs[0]) + ' ' + cText.slice(0, 200));
    ok('Upload', 'a text spec is added too, and the original file is kept for download', docs[1].name === 'Bathroom spec.txt' && docs[0].hasFile && docs[1].hasFile);
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('.pi-docs li >> nth=0 >> [data-ddl]')]);
    const dlf = path.join(tmp, 'dl.pdf'); await dl.saveAs(dlf);
    ok('Upload', '⬇ downloads the original PDF', dl.suggestedFilename() === 'Contract.pdf' && fs.readFileSync(dlf).slice(0, 4).toString() === '%PDF');
    await p.screenshot({ path: path.join(__dirname, 'shot52-docs.png') });

    const ask = async (q) => {
      const n0 = seen.length, before = await p.$$eval('#piLog .pi-a', (x) => x.length);
      await p.fill('#piQ', q); await p.click('#piGo');
      await p.waitForFunction((n) => !document.querySelector('#piLog .ask-think') && document.querySelectorAll('#piLog .pi-a').length >= n, before + 1, { timeout: 60000 });
      return seen[n0];
    };
    // risks
    let s = await ask('Work out the critical and non-critical risks for this project');
    ok('AI', 'the AI gets the plan with the critical tasks marked, the stakeholders and the contract text', s && s.u.tasks.length > 3 && s.u.tasks.some((t) => t.critical) && s.u.tasks.some((t) => !t.critical) && s.u.stakeholders.length === 2 && s.u.document_extracts.some((x) => /Liquidated damages/.test(x.text) && x.page === 2) && /Project Intelligence/.test(s.sys));
    ok('Privacy', 'the customer\'s name, phone and email and the stakeholders\' phones and emails are taken out before the AI sees anything', s && !/Penny|Pearce|0400 777 888|penny@example\.com|0411 555 666|pete@plumbing/.test(s.raw) && /\[phone\]|\[email\]/.test(s.raw), (s.raw.match(/.{30}(Penny|Pearce|0400 777|penny@|0411|pete@).{20}/) || [''])[0]);
    const first = '.pi-a >> nth=0';
    ok('Answer', 'the answer shows with headings, a table and bullets, and the source document', await p.isVisible(`${first} >> .pi-md h4`) && await p.isVisible(`${first} >> .pi-md table`) && /Contract\.pdf/.test(await p.textContent(`${first} >> .pi-src`)));
    ok('Risks', 'suggested risks are split into critical and non-critical', /2 critical, 1 non-critical/.test(await p.textContent(`${first} >> .pi-act`)) && (await p.$$eval(`.pi-a:first-child .pi-crit`, (x) => x.length)) === 2);
    const before = ((await kv.get('plan:' + core)).risks || []).length;
    await p.click(`${first} >> [data-addrisks]`); await saved();
    const rk = (await kv.get('plan:' + core)).risks;
    ok('Risks', '"Add ticked risks" puts them in the Risk register, critical ones marked', rk.length === before + 3 && rk.some((r) => r.title === 'Tiles delivered late' && /critical path/.test(r.cause) && r.p === 3 && r.i === 4), rk.length + ' vs ' + before);
    ok('Risks', 'risks already in the register can\'t be added twice', (await p.$$eval(`.pi-a:first-child [data-rk]:disabled`, (x) => x.length)) === 3);
    await p.screenshot({ path: path.join(__dirname, 'shot52-risks.png'), fullPage: true });

    // stakeholder register
    s = await ask('What would a stakeholder register look like for this project?');
    await p.click('.pi-a >> nth=0 >> [data-addsk]'); await saved();
    const sk = (await kv.get('plan:' + core)).stakeholders;
    ok('Stakeholders', 'the register is shown, existing people marked "listed", new ones added to Stakeholders', sk.length === 3 && sk[2].name === 'Hills Certifiers' && sk[2].raci === 'C' && /listed/.test(await p.textContent('.pi-a >> nth=0 >> .pi-act')), JSON.stringify(sk.map((x) => x.name)));

    // meeting
    s = await ask('Set up a 45-minute Google Meet with the stakeholders next Tuesday at 10am to review progress');
    const href = await p.getAttribute('.pi-a >> nth=0 >> [data-mgo]', 'href');
    const u = new URL(href), dates = u.searchParams.get('dates'), add = u.searchParams.get('add') || '';
    const tue = s.u.today && (() => { const d = new Date(s.u.today + 'T00:00:00Z'); do { d.setUTCDate(d.getUTCDate() + 1); } while (d.getUTCDay() !== 2); return d.toISOString().slice(0, 10).replace(/-/g, ''); })();
    ok('Meeting', 'Google Calendar opens with next Tuesday 10:00 to 10:45 Sydney time', u.host === 'calendar.google.com' && dates === `${tue}T100000/${tue}T104500` && u.searchParams.get('ctz') === 'Australia/Sydney', href.slice(0, 200));
    ok('Meeting', 'the stakeholders with an email are invited as guests and the agenda is in the details', /penny@example\.com/.test(add) && /pete@plumbing\.example\.com/.test(add) && /Progress/.test(u.searchParams.get('details')) && /Google Meet/.test(u.searchParams.get('location')), add);
    ok('Meeting', 'stakeholders without an email are named so they can be added', /No email for Hills Certifiers/.test(await p.textContent('.pi-a >> nth=0 >> .pi-meet')));
    await p.fill('.pi-a >> nth=0 >> [data-mf=start]', '14:30');
    ok('Meeting', 'changing the start time updates the invite', new URL(await p.getAttribute('.pi-a >> nth=0 >> [data-mgo]', 'href')).searchParams.get('dates') === `${tue}T143000/${tue}T151500`);
    const [ics] = await Promise.all([p.waitForEvent('download'), p.click('.pi-a >> nth=0 >> [data-mdl]')]);
    const icsF = path.join(tmp, 'm.ics'); await ics.saveAs(icsF); const icsT = fs.readFileSync(icsF, 'utf8');
    // 14:30 Sydney -> UTC (AEDT +11 or AEST +10)
    const tz = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', timeZoneName: 'short' }).format(new Date(tue.slice(0, 4) + '-' + tue.slice(4, 6) + '-' + tue.slice(6) + 'T04:00:00Z'));
    const utcH = /AEDT|GMT\+11/.test(tz) ? '033000' : '043000';
    ok('Meeting', 'the .ics invite has the right time in UTC, 45 minutes, and both guests', /DTSTART:\d{8}T\d{6}Z/.test(icsT) && new RegExp('DTSTART:' + tue + 'T' + utcH + 'Z').test(icsT) && /mailto:penny@example\.com/.test(icsT) && /mailto:pete@plumbing\.example\.com/.test(icsT), (icsT.match(/DTSTART:\S+/) || [''])[0] + ' ' + tz);
    ok('Meeting', 'the "Email the invite" link goes to the guests', /^mailto:penny@example\.com,pete@plumbing\.example\.com\?subject=/.test(await p.getAttribute('.pi-a >> nth=0 >> [data-mmail]', 'href')));
    await p.locator('.pi-a >> nth=0').screenshot({ path: path.join(__dirname, 'shot52-meeting.png') });
    await p.click('.pi-a >> nth=0 >> [data-msave]'); await saved();
    const mt = (await kv.get('plan:' + core)).meetings || [];
    ok('Meeting', '"Save to this project" keeps the meeting (Meetings list on the right)', mt.length === 1 && mt[0].start === '14:30' && mt[0].minutes === 45 && mt[0].attendees.length === 3 && (await p.$$eval('.pi-meets li', (x) => x.length)) === 1, JSON.stringify(mt));

    // a long document: the right part is found
    await p.setInputFiles('#piFile', [path.join(tmp, 'Long spec.txt')]);
    await p.waitForFunction(() => document.querySelectorAll('.pi-docs li').length === 3, null, { timeout: 30000 });
    s = await ask('What does the contract say about termination?');
    ok('Long docs', 'from a long document only the relevant parts are sent, and the clause deep inside is among them', s.u.extracts_are_partial === true && s.u.document_extracts.some((x) => /NEEDLE-TERMINATION/.test(x.text)) && JSON.stringify(s.u.document_extracts).length < 60000, JSON.stringify(s.u.document_extracts).length);
    ok('Long docs', 'the answer quotes it', /14 days written notice/.test(await p.textContent('.pi-a >> nth=0')));

    // the questions stay with the project
    await p.reload(); await p.waitForSelector('#piQ'); await p.waitForSelector('.pi-a');
    ok('History', 'after a reload the questions and answers are still there for the team', (await p.$$eval('.pi-a', (x) => x.length)) === 4);
    await p.click('.pi-docs li >> nth=1 >> [data-ddel]'); await p.click('#okBtn'); await p.waitForFunction(() => document.querySelectorAll('.pi-docs li').length === 2);
    ok('Upload', '✕ deletes a document', (await kv.get('pdocs:' + core)).docs.length === 2);
    await p.setViewportSize({ width: 390, height: 844 }); await sleep(500);
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
