// v76: ✨ AI for the project charter (Scope tab, sections 2 to 6): improve / expand / correct each section, or the whole charter;
// a stand-in AI checks what it is sent; the result fills the boxes, is saved, and can be undone. The background goes into the charter.
// node charter-ai-test.js <site> [folder with node_modules/mammoth]
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const SITE = path.resolve(process.argv[2]);
const XL = path.resolve(process.argv[3] || path.join(__dirname, 'xl'));
const PORT = 8976, BASE = `http://127.0.0.1:${PORT}`;
const http = require('http');
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => results.push({ area, name, pass: !!pass, detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const csvParse = (s) => { const rows = []; let row = [], cur = '', q = false; for (let i = 0; i < s.length; i++) { const c = s[i]; if (q) { if (c === '"' && s[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; } else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; } else cur += c; } if (cur || row.length) { row.push(cur); rows.push(row); } return rows; };

(async () => {
  let ExcelJS = null; try { ExcelJS = require(require.resolve('exceljs', { paths: [XL, SITE] })); } catch {}
  const seen = [];
  const mock = http.createServer((req, res) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => {
    const b = JSON.parse(Buffer.concat(c).toString() || '{}'), sys = b.messages[0].content, user = JSON.parse(b.messages[1].content); seen.push({ sys, user, max: b.max_tokens });
    const keys = Object.keys(user.fields_to_write || {}), F = {};
    const W = { objective: 'Deliver a complete kitchen renovation in Kellyville to a high standard, on time and on budget.', background: 'The customer asked for a full kitchen renovation with stone benchtops and a tiled splashback.',
      inScope: '- Strip-out and rubbish removal\n- Plumbing and electrical rough-in\n- Cabinets, benchtops and splashback', outScope: '- Structural changes\n- Appliances supplied by the customer',
      deliverables: '- Finished kitchen\n- Electrical and plumbing compliance certificates', acceptance: '- All trades signed off\n- Defects list closed', assumptions: '- Assumption: site access weekdays 7am to 5pm', notes: '- Order the stone early' };
    keys.forEach((k) => { F[k] = /Correct ONLY/.test(sys) ? String(user.fields_to_write[k]).replace(/teh/g, 'the') : W[k] + (/Expand it/.test(sys) ? '\n- Extra detail — added' : ''); });
    setTimeout(() => { res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ fields: F, changes: 'Tidied the structure and added missing items.' }) }, finish_reason: 'stop' }], usage: { total_tokens: 900 } })); }, 600);
  }); });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-ca-blobs'); fs.rmSync(dir, { recursive: true, force: true });
  const blobs = new BlobsServer({ directory: dir, token: 'tok', port: 0 });
  const { port: bport } = await blobs.start();
  const ctxB64 = Buffer.from(JSON.stringify({ siteID: 'mbs', token: 'tok', edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, apiURL: `http://localhost:${bport}` })).toString('base64');
  process.env.NETLIFY_BLOBS_CONTEXT = ctxB64;
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NETLIFY_BLOBS_CONTEXT: ctxB64, ADMIN_USERNAME: 'sashi73', ADMIN_PASSWORD: 'sashi98', LLM_API_KEY: 'test', LLM_BASE_URL: `http://127.0.0.1:${mock.address().port}`, TELEGRAM_BOT_TOKEN: '', RESEND_API_KEY: '' };
  const srv = spawn('node', ['local-server.mjs'], { cwd: SITE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 40 && !/running/.test(log); i++) await sleep(150);
  let br = null;
  const tmp = path.join(os.tmpdir(), 'mbs-ca-files'); fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp);
  try {
    const J = await import(path.join(SITE, 'netlify/lib/jobs.mjs')), kv = await import(path.join(SITE, 'netlify/lib/kv.mjs')), P = await import(path.join(SITE, 'netlify/lib/plan.mjs'));
    const XL = path.resolve(process.argv[3] || path.join(__dirname, 'xl')); const mammoth = require(require.resolve('mammoth', { paths: [XL, SITE] }));
    const core = await J.nextCore('G');
    await J.create({ core, name: 'Carla Charter', phone: '0400 101 202', email: 'carla@example.com', suburb: 'Kellyville', service: 'Kitchen renovation', source: 'phone', summary: 'Full kitchen renovation with stone benchtops and a tiled splashback. Call Carla Charter on 0400 101 202.' });
    br = await chromium.launch();
    const ctx = await br.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const p = await ctx.newPage(); p.setDefaultTimeout(20000);
    const errors = []; errorsAll = errors; p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
    await p.fill('[name=username]', 'sashi73'); await p.fill('[name=password]', 'sashi98'); await p.click('#loginForm button'); await p.waitForSelector('#app:not([hidden])');
    await p.goto(`${BASE}/admin/#plan/${core}`); await p.waitForSelector('#tplType'); await p.selectOption('#tplType', 'kitchen-reno'); await p.click('#tplCreate'); await p.waitForSelector('table.gt'); await sleep(1200);
    await p.goto(`${BASE}/admin/#plan/${core}/scope`); await p.waitForSelector('#chDoc');
    const btns = await p.$$eval('.chs-h .ch-ai', (b) => b.map((x) => x.getAttribute('data-ai')));
    ok('Buttons', 'sections 2 to 6 each have a ✨ AI button (2 objective, 3 background, 4 scope, 5 deliverables, 6 assumptions)', JSON.stringify(btns) === JSON.stringify(['objective', 'background', 'inScope,outScope', 'deliverables,acceptance', 'assumptions,notes']), JSON.stringify(btns));
    ok('Buttons', 'and the side panel has "✨ Improve the whole charter with AI"', !!(await p.$('.ch-aiall')));
    // section 4: the request pasted into In scope, then ✨ AI → Improve
    await p.click('#chUseReq'); await sleep(300);
    const before = await p.inputValue('#ch_inScope');
    await p.click('[data-ai="inScope,outScope"]'); await p.waitForSelector('#chPop');
    ok('Popover', 'the popover offers Improve, Expand and Correct only, and a note for the AI', (await p.$$('#chPop input[name=chm]')).length === 3 && !!(await p.$('#chNote')));
    await p.screenshot({ path: path.join(os.tmpdir(), 'charter-ai-pop.png') });
    await p.fill('#chNote', 'mention the splashback'); await p.click('#chGo');
    await sleep(300);
    ok('Busy', 'while it works the section shimmers, its boxes are read-only and the button says Writing…', !!(await p.$('.chs.ch-busy')) && (await p.$eval('#ch_inScope', (t) => t.readOnly)) && /Writing/.test(await p.textContent('[data-ai="inScope,outScope"]')));
    await p.waitForSelector('.ch-ainote.on', { timeout: 30000 });
    const sent = seen[seen.length - 1];
    ok('Context', 'the AI gets the plan (tasks, milestones), the request with the name, phone and email hidden, and the note', sent.user.tasks.length > 5 && /the customer/.test(sent.user.customer_request) && !/Carla|0400|example\.com/.test(JSON.stringify(sent.user)) && /mention the splashback/.test(sent.sys), JSON.stringify(sent.user).slice(0, 200));
    ok('Context', 'it is asked for just this section: In scope and Out of scope', JSON.stringify(Object.keys(sent.user.fields_to_write)) === '["inScope","outScope"]' && /kitchen/i.test(sent.user.fields_to_write.inScope));
    const after = await p.inputValue('#ch_inScope');
    ok('Applied', 'the boxes are filled with the AI\'s version, and a note says what changed with ↶ Undo', /^- Strip-out/.test(after) && /Structural changes/.test(await p.inputValue('#ch_outScope')) && /Improved by AI: Tidied/.test(await p.textContent('.ch-ainote.on')) && !(await p.$('.chs.ch-busy')));
    await sleep(1500);
    ok('Saved', 'and it is saved with the plan', /^- Strip-out/.test((await P.get(core)).charter.inScope));
    await p.click('.ch-undo'); await sleep(1500);
    ok('Undo', '↶ Undo puts back what was there, and saves', (await p.inputValue('#ch_inScope')) === before && (await P.get(core)).charter.inScope === before && !(await p.$('.ch-ainote.on')));
    // section 2: correct only (with a typo)
    await p.fill('#ch_objective', 'Renovate teh kitchen'); await sleep(200);
    await p.click('[data-ai="objective"]'); await p.check('#chPop input[value=grammar]'); await p.click('#chGo'); await p.waitForSelector('.ch-ainote.on', { timeout: 30000 });
    ok('Correct only', '"Correct only" fixes the spelling and keeps the words', (await p.inputValue('#ch_objective')) === 'Renovate the kitchen' && /Correct ONLY/.test(seen[seen.length - 1].sys) && /Corrected by AI/.test(await p.textContent('.ch-ainote.on')));
    await p.click('.ch-keep'); await sleep(200);
    ok('Keep', '✓ Keep hides the note', !(await p.$('.ch-ainote.on')));
    // Esc closes the popover
    await p.click('[data-ai="objective"]'); await p.waitForSelector('#chPop'); await p.keyboard.press('Escape'); await sleep(200);
    ok('Popover', 'Esc closes the popover without asking the AI', !(await p.$('#chPop')), await p.evaluate(() => document.querySelectorAll('#chPop').length + ' ' + (document.activeElement && document.activeElement.outerHTML.slice(0, 80))));
    // the whole charter, expand
    const n0 = seen.length;
    await p.click('.ch-aiall'); await p.check('#chPop input[value=expand]'); await p.click('#chGo');
    await sleep(300); ok('Whole', 'the whole charter: every section works at once', (await p.$$('.chs.ch-busy')).length === 5);
    await p.waitForSelector('.ch-ainote.on', { timeout: 30000 }); await sleep(1500);
    const all = seen[n0], pc = (await P.get(core)).charter;
    ok('Whole', 'one AI call for all 8 fields, with room for the answer', seen.length === n0 + 1 && Object.keys(all.user.fields_to_write).length === 8 && all.max >= 4000 && /Expand it/.test(all.sys));
    ok('Whole', 'every field is written and saved, with no em dashes', ['objective', 'background', 'inScope', 'outScope', 'deliverables', 'acceptance', 'assumptions', 'notes'].every((k) => /Extra detail, added/.test(pc[k])) && !/—/.test(JSON.stringify(pc)), JSON.stringify(pc).slice(0, 300));
    ok('Whole', 'each section shows its own Undo note', (await p.$$('.ch-ainote.on')).length === 5);
    ok('Background', 'the background box now holds the AI version; the request is folded away above it', /full kitchen renovation/.test(await p.inputValue('#ch_background')) && !(await p.$eval('details.ch-req', (d) => d.open)));
    // the charter uses the background
    await p.click('#chDoc'); await p.waitForSelector('#chDocx');
    const [d] = await Promise.all([p.waitForEvent('download'), p.click('#chDocx')]); const f = path.join(tmp, d.suggestedFilename()); await d.saveAs(f);
    const w = (await mammoth.extractRawText({ path: f })).value;
    ok('Charter', 'the charter\'s Background is the AI version, and In scope / Objective are the new text', /Background\s+The customer asked for a full kitchen renovation/.test(w) && /Deliver a complete kitchen renovation in Kellyville/.test(w) && /Extra detail, added/.test(w), w.slice(0, 600));
    await p.keyboard.press('Escape'); await sleep(200);
    await p.screenshot({ path: path.join(os.tmpdir(), 'charter-ai.png') });
    // no AI set up: a clear message
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close(); br = null;
  } catch (e) { try { if (br) await br.close(); } catch {} ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ') + ' LOG: ' + log.slice(-400)); }
  try { srv.kill(); } catch {} try { await blobs.stop(); } catch {}
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  mock.close(); process.exit(0);
})();
