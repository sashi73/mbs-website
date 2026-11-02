// v65: the Board as themes (tasks) with user stories (sub-tasks): owner picker, H/M/L, Fibonacci points adding up to the theme, RAG cards, ＋ story, filters, fits a laptop.
// Checks the rows, sub-tasks, links (Predecessors), milestones, dates, and that no costs are exported. Real Blobs, Chromium.
// node gantt-export-test.js <site> [folder with node_modules/exceljs]
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const llmSeen = [];
const mock = http.createServer((req, res) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => { const b = JSON.parse(Buffer.concat(c).toString()); llmSeen.push(b); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ text: 'Walk the whole site with the surveyor and mark the boundaries, levels and services, so design can start. Done when the survey file is received and checked against the title plan. Extra words to go past two hundred characters.' }) }, finish_reason: 'stop' }], usage: { total_tokens: 120 } })); }); });
const path = require('path'), fs = require('fs'), os = require('os');
const SITE = path.resolve(process.argv[2]);
const XL = path.resolve(process.argv[3] || path.join(__dirname, 'xl'));
const PORT = 8964, BASE = `http://127.0.0.1:${PORT}`;
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => results.push({ area, name, pass: !!pass, detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const csvParse = (s) => { const rows = []; let row = [], cur = '', q = false; for (let i = 0; i < s.length; i++) { const c = s[i]; if (q) { if (c === '"' && s[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; } else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; } else cur += c; } if (cur || row.length) { row.push(cur); rows.push(row); } return rows; };

(async () => {
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  let ExcelJS = null; try { ExcelJS = require(require.resolve('exceljs', { paths: [XL, SITE] })); } catch {}
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-kb-blobs'); fs.rmSync(dir, { recursive: true, force: true });
  const blobs = new BlobsServer({ directory: dir, token: 'tok', port: 0 });
  const { port: bport } = await blobs.start();
  const ctxB64 = Buffer.from(JSON.stringify({ siteID: 'mbs', token: 'tok', edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, apiURL: `http://localhost:${bport}` })).toString('base64');
  process.env.NETLIFY_BLOBS_CONTEXT = ctxB64;
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NETLIFY_BLOBS_CONTEXT: ctxB64, ADMIN_USERNAME: 'sashi73', ADMIN_PASSWORD: 'sashi98', LLM_API_KEY: 'test', LLM_BASE_URL: `http://127.0.0.1:${mock.address().port}`, TELEGRAM_BOT_TOKEN: '', RESEND_API_KEY: '' };
  const srv = spawn('node', ['local-server.mjs'], { cwd: SITE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 40 && !/running/.test(log); i++) await sleep(150);
  let br = null;
  const tmp = path.join(os.tmpdir(), 'mbs-kb-files'); fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp);
  try {
    const J = await import(path.join(SITE, 'netlify/lib/jobs.mjs')), kv = await import(path.join(SITE, 'netlify/lib/kv.mjs')), P = await import(path.join(SITE, 'netlify/lib/plan.mjs'));
    const core = await J.nextCore('G');
    await J.create({ core, name: 'Bea Board', phone: '0400 101 202', email: '', suburb: 'Kellyville', service: 'Kitchen renovation', source: 'phone', summary: 'Kitchen renovation.' });
    br = await chromium.launch();
    const ctx = await br.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
    const p = await ctx.newPage(); p.setDefaultTimeout(20000);
    const errors = []; errorsAll = errors; p.on('pageerror', (e) => errors.push(e.message));
    await p.setViewportSize({ width: 1366, height: 768 });
    await p.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
    await p.evaluate(() => { localStorage.removeItem('mbsBoardF'); });
    await p.fill('[name=username]', 'sashi73'); await p.fill('[name=password]', 'sashi98'); await p.click('#loginForm button');
    await p.waitForSelector('#app:not([hidden])');
    await p.goto(`${BASE}/admin/#plan/${core}`); await p.waitForSelector('#tplType'); await p.selectOption('#tplType', 'kitchen-reno'); await p.click('#tplCreate'); await p.waitForSelector('table.gt'); await sleep(1200);
    const pl0 = await P.get(core);
    pl0.stakeholders = [{ id: 's1', name: 'Bea Board', role: 'Customer', raci: 'A' }, { id: 's2', name: 'Sam Sparky', role: 'Electrician', raci: 'R' }, { id: 's3', name: 'Tina Tiler', role: 'Tiler', raci: 'R' }];
    const d = new Date(); d.setDate(d.getDate() - 12); pl0.start = d.toISOString().slice(0, 10); pl0.emergency = true;   // started 12 days ago: some work is late
    await P.save(core, pl0, pl0.rev, 'test');
    await p.goto(`${BASE}/admin/#projects`); await sleep(300);
    await p.goto(`${BASE}/admin/#plan/${core}/board`); await p.waitForSelector('.kcard'); await sleep(900);
    const cols = await p.$$eval('.kcol', (a) => a.map((x) => Math.round(x.getBoundingClientRect().width)));
    const tops = await p.$$eval('.kcol', (a) => a.map((x) => Math.round(x.getBoundingClientRect().top)));
    ok('Fit', 'on a 14" laptop (1366 wide, menu open) the 4 columns sit side by side, no sideways scrolling', cols.length === 4 && new Set(tops).size === 1 && Math.min(...cols) >= 200 && await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), cols.join(',') + ' / ' + tops.join(','));
    const colBottom = await p.$eval('.kcol-todo .kcards', (e) => e.getBoundingClientRect().bottom);
    ok('Fit', 'each column scrolls on its own, so the board fits the screen height', colBottom <= 768 + 2, String(colBottom));
    const bench = (await P.get(core)).tasks.find((t) => /benchtop/i.test(t.name)), B = `.kcard[data-tid="${bench.id}"]`;
    await p.$eval(B, (e) => e.scrollIntoView());
    ok('Theme', 'a task with sub-tasks is a THEME card with its user stories inside, dates and number of days on the right', /THEME/.test(await p.textContent(`${B} .kid`)) && (await p.$$(`${B} .kst`)).length === 3 && /\d+ days/.test(await p.textContent(`${B} .kdays`)) && /\d/.test(await p.textContent(`${B} .kdates`)));
    ok('Story', 'next to each story on the right: its dates and (days left / late / due)', (await p.$$eval(`${B} .kst-d`, (a) => a.map((x) => x.textContent))).every((t) => /\d+.*(Oct|Nov|Dec|Jan).*\((\d+ days? (left|late)|due (today|in \d+ days?)|starts in \d+ days?|done)\)/.test(t)), (await p.$$eval(`${B} .kst-d`, (a) => a.map((x) => x.textContent))).join(' | '));
    ok('Story', 'every story has an owner button, H / M / L and a points button', (await p.$$(`${B} .kst .kown`)).length === 3 && (await p.$$(`${B} .kst .kseg button`)).length === 9 && (await p.$$(`${B} .kst .kptb`)).length === 3);
    const st = (i) => `${B} .kst:nth-child(${i})`;
    await p.click(`${st(1)} .kown`); await p.waitForSelector('#kPop');
    ok('Owner', 'the owner button opens a picker with the Stakeholder register (searchable)', (await p.$$eval('#kPop [data-own]', (a) => a.map((x) => x.getAttribute('data-own')))).join() === 'Bea Board,Sam Sparky,Tina Tiler');
    await p.fill('#kPop .kpop-q', 'sam'); await sleep(100);
    ok('Owner', 'typing filters the list (and offers to use what was typed)', (await p.$$eval('#kPop [data-own]', (a) => a.map((x) => x.getAttribute('data-own')))).join() === 'Sam Sparky,sam');
    await p.click('#kPop [data-own="Sam Sparky"]'); await sleep(250);
    ok('Owner', 'picking sets the story owner (initials and name on the button)', (await p.textContent(`${st(1)} .kown-n`)) === 'Sam Sparky' && (await p.textContent(`${st(1)} .kav`)) === 'SS');
    await p.click(`${st(2)} .kown`); await p.fill('#kPop .kpop-q', 'Oakwood Joinery'); await p.keyboard.press('Enter'); await sleep(250);
    const reg = await p.evaluate(() => window.MBS.planState.plan.stakeholders.find((x) => x.name === 'Oakwood Joinery'));
    ok('Owner', 'a new name typed for a story (Enter) is the owner AND goes into the Stakeholder register (RACI R)', (await p.textContent(`${st(2)} .kown-n`)) === 'Oakwood Joinery' && reg && reg.raci === 'R', JSON.stringify(reg));
    await p.click(`${st(3)} .kown`); await p.waitForSelector('#kPop');
    ok('Owner', 'they are then on the picker list like everyone else', (await p.$$eval('#kPop [data-own]', (a) => a.map((x) => x.getAttribute('data-own')))).includes('Oakwood Joinery'));
    await p.click('#title'); await sleep(150);
    await p.click(`${st(1)} .kseg-H`); await sleep(150);
    ok('Priority', 'H / M / L are colour-coded buttons: H turns red', (await p.getAttribute(`${st(1)} .kseg-H`, 'class')).includes('on'));
    await p.click(`${st(1)} .kseg-H`); await sleep(150);
    ok('Priority', 'clicking it again clears it', !(await p.getAttribute(`${st(1)} .kseg-H`, 'class')).includes('on'));
    await p.click(`${st(1)} .kseg-H`); await p.click(`${st(2)} .kseg-M`); await p.click(`${st(3)} .kseg-L`); await sleep(150);
    await p.click(`${st(1)} .kptb`); await p.waitForSelector('#kPop');
    ok('Points', 'the points button offers the Fibonacci numbers 1, 2, 3, 5, 8, 13', (await p.$$eval('#kPop [data-pt]', (a) => a.map((x) => x.textContent))).join() === '1,2,3,5,8,13');
    await p.click('#kPop [data-pt="5"]'); await sleep(150);
    await p.click(`${st(2)} .kptb`); await p.click('#kPop [data-pt="8"]'); await sleep(150);
    await p.click(`${st(3)} .kptb`); await p.click('#kPop [data-pt="3"]'); await sleep(250);
    ok('Points', 'the theme\'s points are its stories added up (5 + 8 + 3 = 16)', (await p.textContent(`${B} .ktp`)) === '16 pts' && /16 pts/.test(await p.textContent('.kcol-todo h3')) && /0 of 16 points done/.test(await p.textContent('.kpts')));
    const slide = async (sel, v) => { await p.$eval(sel, (r, v) => { r.value = String(v); r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); }, v); await sleep(350); };
    ok('Slider', 'each story has a progress slider instead of a tick box: 0, 25, 50, 75, 100 (done)', (await p.$$(`${B} .kst input[type=range]`)).length === 3 && !(await p.$(`${B} .kst input[type=checkbox]`)) && (await p.$eval(`${st(1)} input[type=range]`, (r) => [r.min, r.max, r.step].join())) === '0,100,25');
    await slide(`${st(1)} input[type=range]`, 50);
    const t50 = await p.evaluate((id) => { const t = window.MBS.planState.plan.tasks.find((x) => x.id === id); return { s: t.subs[0], pct: t.pct }; }, bench.id);
    ok('Slider', 'moving it to 50% marks the story in progress and moves the theme\'s % (weighted by days)', (await p.textContent(`${st(1)} .kslide-v`)) === '50%' && t50.s.pct === 50 && t50.s.status === 'doing' && t50.pct === Math.round(50 * t50.s.dur / 6), JSON.stringify(t50));
    await slide(`${st(1)} input[type=range]`, 0);
    await slide(`${st(2)} input[type=range]`, 100);
    ok('Slider', 'at 100 it reads "Done ✓" and the story is done', (await p.textContent(`${st(2)} .kslide-v`)) === 'Done ✓' && (await p.getAttribute(`${st(2)}`, 'class')).includes('done'));
    ok('Points', 'a story at 100% counts its points as done, and the theme moves on (its % is weighted by the stories\' days: 4 of 6 = 67%, In review)', /8 of 16 points done/.test(await p.textContent('.kpts')) && !!(await p.$(`.kcol-review ${B}`)));
    await sleep(1300);
    const sv = (await P.get(core)).tasks.find((t) => t.id === bench.id);
    ok('Saved', 'owner, priority and points are saved on each story', sv.subs[0].owner === 'Sam Sparky' && sv.subs[0].priority === 'High' && sv.subs[0].points === 5 && sv.subs[1].owner === 'Oakwood Joinery' && sv.subs[1].priority === 'Medium' && sv.subs[1].points === 8 && sv.subs[2].priority === 'Low' && sv.subs[2].points === 3 && sv.subs[1].pct === 100 && sv.subs[1].status === 'done', JSON.stringify(sv.subs.map((x) => [x.owner, x.priority, x.points])));
    // (i) descriptions
    ok('Info', 'a small (i) next to the theme name and every story name', !!(await p.$(`${B} .kth .kinfo`)) && (await p.$$(`${B} .kst .kinfo`)).length === 3);
    await p.click(`${st(1)} .kinfo`); await p.waitForSelector('#kdTxt');
    ok('Info', 'clicking it opens a box for the description, limited to 200 characters', (await p.getAttribute('#kdTxt', 'maxlength')) === '200' && /0 \/ 200/.test(await p.textContent('#kdCnt')));
    await p.click('#kdAi'); await p.waitForFunction(() => document.querySelector('#kdTxt').value.length > 50, null, { timeout: 20000 });
    const aiTxt = await p.inputValue('#kdTxt'), lq = llmSeen[llmSeen.length - 1];
    ok('Info', '✨ the AI writes it (kept to 200 characters), knowing the story and its theme', aiTxt.length <= 200 && /surveyor/.test(aiTxt) && lq && /Template/.test(lq.messages[1].content) && /Benchtop/.test(lq.messages[1].content) && /200 characters/.test(lq.messages[0].content), aiTxt.length + ': ' + aiTxt);
    await p.click('#kdSave'); await sleep(300);
    ok('Info', 'saved: the (i) turns dark and shows the description when you point at it', (await p.getAttribute(`${st(1)} .kinfo`, 'class')).includes('has') && /surveyor/.test(await p.getAttribute(`${st(1)} .kinfo`, 'title')));
    await p.click(`${B} .kth .kinfo`); await p.waitForSelector('#kdTxt'); await p.fill('#kdTxt', 'Make, template and install the stone benchtop. Done when it is level, sealed and signed off.'); await p.click('#kdSave'); await sleep(1300);
    const dsv = (await P.get(core)).tasks.find((t) => t.id === bench.id);
    ok('Info', 'theme and story descriptions are saved with the plan', /stone benchtop/.test(dsv.desc) && /surveyor/.test(dsv.subs[0].desc) && dsv.subs[0].desc.length <= 200);
    // RAG colours
    const cards = await p.$$eval('.kcard', (a) => a.map((c) => ({ cls: c.className, due: (c.querySelector('.kdue') || {}).textContent || '' })));
    const consistent = cards.every((c) => (/kr-r/.test(c.cls) ? /late/.test(c.due) : /kr-a/.test(c.cls) ? /Due (today|in [123] day)/.test(c.due) : /kr-g/.test(c.cls)));
    ok('RAG', 'cards are red when the due date has passed, amber within 3 days, green on track', consistent && cards.some((c) => /kr-r/.test(c.cls)) && cards.some((c) => /kr-g/.test(c.cls)), JSON.stringify(cards.slice(0, 6)));
    ok('RAG', 'the board counts themes on track, close to due and late', /\d+.*\d+.*\d+/.test(await p.textContent('.krag-sum')));
    // a task without stories: its own owner / priority / points, and ＋ story
    const plain = (await P.get(core)).tasks.find((t) => /cabinets/i.test(t.name)), C = `.kcard[data-tid="${plain.id}"]`;
    await p.$eval(C, (e) => e.scrollIntoView());
    ok('Theme', 'a task without stories has its own owner, priority and points', !!(await p.$(`${C} > .kctl .kown`)) && !(await p.$(`${C} .kst`)));
    await p.click(`${C} [data-kadd]`); await p.fill(`${C} .kadd-in`, 'Check the levels'); await p.keyboard.press('Enter'); await sleep(300);
    await sleep(400); ok('Story', '＋ story adds one user story (Enter), and the card becomes a theme', /THEME/.test(await p.textContent(`${C} .kid`)) && (await p.$$(`${C} .kst`)).length === 1 && /Check the levels/.test(await p.textContent(`${C} .kst`)));
    // filters
    await p.selectOption('#kbOwner', 'Sam Sparky'); await sleep(250);
    ok('Filter', 'filter by owner shows the themes with their stories, and only that person\'s stories', (await p.$$('.kcard')).length === 1 && (await p.$$(`${B} .kst`)).length === 1 && /2 more stories hidden/.test(await p.textContent(B)));
    await p.selectOption('#kbOwner', ''); await p.selectOption('#kbPrio', 'Low'); await sleep(250);
    ok('Filter', 'filter by priority', (await p.$$('.kcard')).length === 1 && (await p.$$(`${B} .kst`)).length === 1);
    await p.selectOption('#kbPrio', ''); await p.selectOption('#kbSort', 'points'); await sleep(250);
    ok('Sort', 'sort by points puts the 16-point theme first in its column (it is in In review)', (await p.getAttribute('.kcol-review .kcard', 'data-tid')) === bench.id);
    await p.fill('#kbQ', 'check the levels'); await sleep(200);
    ok('Search', 'search finds stories too', (await p.$$('.kcard')).length === 1 && !!(await p.$(C)));
    await p.fill('#kbQ', 'signed off'); await sleep(200);
    ok('Search', 'and descriptions', (await p.$$('.kcard')).length === 1 && !!(await p.$(B)));
    await p.fill('#kbQ', ''); await sleep(200);
    await p.click(`${B} [data-step="1"]`); await sleep(300);
    ok('Move', '→ moves the theme on to Done with its points (all its stories done)', !!(await p.$(`.kcol-done ${B}`)) && /16 pts/.test(await p.textContent('.kcol-done h3')) && /16 of \d+ points done/.test(await p.textContent('.kpts')));
    await slide(`${C} .kst input[type=range]`, 25);
    ok('Slider', 'moving a story to 25% moves its theme card to In progress', !!(await p.$(`.kcol-doing ${C}`)) && (await p.textContent(`${C} .kslide-v`)) === '25%');
    await slide(`${C} .kst input[type=range]`, 75); await sleep(1300);
    await p.goto(`${BASE}/admin/#plan/${core}/schedule`); await p.waitForSelector('#gRight .gbar'); await sleep(400);
    const gc = await p.evaluate((ids) => ({ task: document.querySelector(`#gRight [data-gtid="${ids[0]}"] .gbar, #gRight tr:has(.gbar) .gbar`) && [...document.querySelectorAll('#gRight .gbar')].map((b) => b.className).join('|'),
      subs: [...document.querySelectorAll('#gRight .gsub')].map((b) => b.className).join('|'), leg: (document.querySelector('.gleg') || {}).textContent || '' }), [plain.id]);
    const colOf = (cls) => getComputedStyle;
    ok('Gantt', 'Gantt bars are coloured by progress (0, 25, 50, 75, 100) with a legend; late stays red', /pb-75/.test(gc.subs) && /pb-100/.test(gc.subs) && /pb-0/.test(gc.task) && /0%.*25%.*50%.*75%.*100% done.*Late/.test(gc.leg), JSON.stringify(gc).slice(0, 300));
    const fills = await p.evaluate(() => ['pb-25', 'pb-50', 'pb-75', 'pb-100'].map((k) => { const s = document.createElement('span'); s.className = 'gsub ' + k; s.innerHTML = '<span class="gfill"></span>'; document.querySelector('#gRight').appendChild(s); const c = getComputedStyle(s.firstChild).backgroundColor; s.remove(); return c; }));
    ok('Gantt', 'each level has its own colour', new Set(fills).size === 4, fills.join(' '));
    await p.goto(`${BASE}/admin/#plan/${core}/board`); await p.waitForSelector('.kcard');
    await p.reload(); await p.waitForSelector('.kcard'); await sleep(900); await p.screenshot({ path: path.join(os.tmpdir(), 'board65.png') });
    ok('Filter', 'the sort choice is remembered', (await p.inputValue('#kbSort')) === 'points');
    await p.setViewportSize({ width: 390, height: 844 }); await sleep(300);
    ok('Phone', 'on a phone the columns stack, no sideways scrolling', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close(); br = null;
  } catch (e) { try { if (br) await br.close(); } catch {} ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ') + ' LOG: ' + log.slice(-400)); }
  try { srv.kill(); } catch {} try { await blobs.stop(); } catch {} mock.close();
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(0);
})();
