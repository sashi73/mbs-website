// v58: ⬇ Gantt export: only the schedule, as CSV (3 date formats), Microsoft Project XML (MSPDI), Excel and calendar (.ics).
// Checks the rows, sub-tasks, links (Predecessors), milestones, dates, and that no costs are exported. Real Blobs, Chromium.
// node gantt-export-test.js <site> [folder with node_modules/exceljs]
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const SITE = path.resolve(process.argv[2]);
const XL = path.resolve(process.argv[3] || path.join(__dirname, 'xl'));
const PORT = 8958, BASE = `http://127.0.0.1:${PORT}`;
const results = []; let errorsAll = [];
const ok = (area, name, pass, detail = '') => results.push({ area, name, pass: !!pass, detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const csvParse = (s) => { const rows = []; let row = [], cur = '', q = false; for (let i = 0; i < s.length; i++) { const c = s[i]; if (q) { if (c === '"' && s[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; } else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; } else cur += c; } if (cur || row.length) { row.push(cur); rows.push(row); } return rows; };

(async () => {
  let ExcelJS = null; try { ExcelJS = require(require.resolve('exceljs', { paths: [XL, SITE] })); } catch {}
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-gx-blobs'); fs.rmSync(dir, { recursive: true, force: true });
  const blobs = new BlobsServer({ directory: dir, token: 'tok', port: 0 });
  const { port: bport } = await blobs.start();
  const ctxB64 = Buffer.from(JSON.stringify({ siteID: 'mbs', token: 'tok', edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, apiURL: `http://localhost:${bport}` })).toString('base64');
  process.env.NETLIFY_BLOBS_CONTEXT = ctxB64;
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NETLIFY_BLOBS_CONTEXT: ctxB64, ADMIN_USERNAME: 'sashi73', ADMIN_PASSWORD: 'sashi98', LLM_API_KEY: '', TELEGRAM_BOT_TOKEN: '', RESEND_API_KEY: '' };
  const srv = spawn('node', ['local-server.mjs'], { cwd: SITE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 40 && !/running/.test(log); i++) await sleep(150);
  let br = null;
  const tmp = path.join(os.tmpdir(), 'mbs-gx-files'); fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp);
  try {
    const J = await import(path.join(SITE, 'netlify/lib/jobs.mjs')), kv = await import(path.join(SITE, 'netlify/lib/kv.mjs'));
    const core = await J.nextCore('G');
    await J.create({ core, name: 'Gina Gantt', phone: '0400 101 202', email: '', suburb: 'Kellyville', service: 'Kitchen renovation', source: 'phone', summary: 'Kitchen renovation.' });
    br = await chromium.launch();
    const ctx = await br.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
    const p = await ctx.newPage(); p.setDefaultTimeout(20000);
    const errors = []; errorsAll = errors; p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
    await p.fill('[name=username]', 'sashi73'); await p.fill('[name=password]', 'sashi98'); await p.click('#loginForm button');
    await p.waitForSelector('#app:not([hidden])');
    await p.goto(`${BASE}/admin/#plan/${core}`); await p.waitForSelector('#tplType'); await p.selectOption('#tplType', 'kitchen-reno'); await p.click('#tplCreate'); await p.waitForSelector('table.gt'); await sleep(600);
    const plan = await p.evaluate(() => JSON.parse(JSON.stringify(window.MBS.planState.plan)));
    const nSubs = plan.tasks.reduce((a, t) => a + (t.subs || []).length, 0), nTasks = plan.tasks.length;
    const get = async (fmt, opts = {}) => {
      await p.click('#planCsv'); await p.waitForSelector('input[name=gxf]');
      await p.check(`input[name=gxf][value=${fmt}]`); if (opts.dates) await p.selectOption('#csvDates', opts.dates); if (opts.noSubs) await p.uncheck('#csvSubs');
      const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#csvGo')]);
      const f = path.join(tmp, dl.suggestedFilename()); await dl.saveAs(f); return { name: dl.suggestedFilename(), buf: fs.readFileSync(f), file: f };
    };
    ok('Button', 'the plan has a "⬇ Gantt export" button with 4 formats', /Gantt export/.test(await p.textContent('#planCsv')));
    // CSV
    let r = await get('csv', { dates: 'dmy' }); const txt = r.buf.toString('utf8'), rows = csvParse(txt.replace(/^﻿/, '')).filter((x) => x.length > 1);
    const H = rows[0], body = rows.slice(1), col = (n) => H.indexOf(n);
    ok('CSV', 'Gantt-<job>-<date>.csv, UTF-8 with BOM, the import column names', /^Gantt-.+-\d{4}-\d{2}-\d{2}\.csv$/.test(r.name) && txt.charCodeAt(0) === 0xFEFF && ['ID', 'Task Name', 'Start Date', 'Finish Date', 'Duration', 'Predecessors', 'Outline Level', 'Milestone', '% Complete', 'Resource Names'].every((h) => H.includes(h)), H.join('|'));
    ok('CSV', 'one row per task and sub-task, sub-tasks at Outline Level 2 under their task', body.length === nTasks + nSubs && nSubs > 0 && body.filter((x) => x[col('Outline Level')] === '2').length === nSubs, body.length + ' vs ' + (nTasks + nSubs));
    const sched = await p.evaluate(() => { const P = window.MBS.planState.plan; return P.tasks.map((t) => ({ name: t.name, es: t.es, ef: t.ef, dur: t.dur, pred: t.pred })); });
    const byName = (n) => body.find((x) => x[col('Task Name')] === n), t4 = sched[3], row4 = byName(t4.name), dmy = (s) => s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4);
    ok('CSV', 'dates match the Gantt (DD/MM/YYYY) and links point at the right row IDs', row4[col('Start Date')] === dmy(t4.es) && row4[col('Finish Date')] === dmy(t4.ef) && row4[col('Predecessors')] === t4.pred.map((id) => body.find((x) => x[col('Task Name')] === sched.find((s) => plan.tasks.find((pt) => pt.id === id && pt.name === s.name)).name)[col('ID')]).join(','), JSON.stringify(row4));
    ok('CSV', 'milestones are marked (Quote accepted)', byName('Quote accepted')[col('Milestone')] === 'Yes' && byName('Quote accepted')[col('Duration (days)')] === '0');
    ok('CSV', 'no costs in the export (no Qty, Unit $, Cost columns, no $ amounts)', !H.some((h) => /cost|\$|qty|unit|budget/i.test(h)) && !/\$\d/.test(txt));
    r = await get('csv', { dates: 'ymd' }); const rows2 = csvParse(r.buf.toString('utf8').replace(/^﻿/, ''));
    ok('CSV', 'YYYY-MM-DD dates for web tools', /^\d{4}-\d{2}-\d{2}$/.test(rows2[1][rows2[0].indexOf('Start Date')]));
    r = await get('csv', { dates: 'dmy', noSubs: true }); const rows3 = csvParse(r.buf.toString('utf8').replace(/^﻿/, '')).filter((x) => x.length > 1);
    ok('CSV', 'sub-tasks can be left out', rows3.length - 1 === nTasks);
    // Microsoft Project XML
    r = await get('mspdi'); const xml = r.buf.toString('utf8');
    const X = await p.evaluate((s) => { const d = new DOMParser().parseFromString(s, 'application/xml'); if (d.querySelector('parsererror')) return { err: d.querySelector('parsererror').textContent.slice(0, 200) };
      const T = [...d.getElementsByTagName('Task')]; return { ns: d.documentElement.namespaceURI, tasks: T.length, links: d.getElementsByTagName('PredecessorLink').length, summaries: T.filter((t) => t.getElementsByTagName('Summary')[0].textContent === '1').length,
        miles: T.filter((t) => (t.getElementsByTagName('Milestone')[0] || {}).textContent === '1').length, lvl2: T.filter((t) => t.getElementsByTagName('OutlineLevel')[0].textContent === '2').length, cal: d.getElementsByTagName('WeekDay').length,
        dur4: (T[4].getElementsByTagName('Duration')[0] || {}).textContent, start4: (T[4].getElementsByTagName('Start')[0] || {}).textContent }; }, xml);
    const links = sched.reduce((a, t) => a + t.pred.length, 0);
    ok('MS Project', 'a valid Microsoft Project XML file (.xml) in the Project namespace', !X.err && /\.xml$/.test(r.name) && X.ns === 'http://schemas.microsoft.com/project', X.err || r.name);
    ok('MS Project', 'every task and sub-task, the links, summary tasks, milestones and a Mon–Fri calendar', X.tasks === nTasks + nSubs + 1 && X.links === links && X.summaries >= 2 && X.miles >= 2 && X.lvl2 === nSubs && X.cal === 7, JSON.stringify(X));
    ok('MS Project', 'durations in hours of 8-hour days, starting 08:00', /^PT\d+H0M0S$/.test(X.dur4) && /T08:00:00$/.test(X.start4), X.dur4 + ' ' + X.start4);
    // Excel
    if (ExcelJS) {
      r = await get('xlsx'); const wb = new ExcelJS.Workbook(); await wb.xlsx.load(r.buf); const ws = wb.getWorksheet('Gantt');
      const hdr = ws.getRow(1).values.slice(1), r5 = ws.getRow(5);
      ok('Excel', 'an Excel file with a Gantt sheet: same columns, real dates, sub-tasks grouped', /\.xlsx$/.test(r.name) && hdr[3] === 'Task Name' && r5.getCell(5).value instanceof Date && ws.rowCount === nTasks + nSubs + 1 && ws.getRows(2, ws.rowCount - 1).some((x) => x.outlineLevel === 1), hdr.join('|'));
    }
    // calendar
    r = await get('ics'); const ics = r.buf.toString('utf8');
    const evs = (ics.match(/BEGIN:VEVENT/g) || []).length, withSubsSummaries = plan.tasks.filter((t) => (t.subs || []).length).length;
    ok('Calendar', 'a calendar file with an all-day event per task and sub-task (the parent of sub-tasks is left out)', /\.ics$/.test(r.name) && /^BEGIN:VCALENDAR/.test(ics) && evs === nTasks + nSubs - withSubsSummaries && /DTSTART;VALUE=DATE:\d{8}/.test(ics), evs + ' vs ' + (nTasks + nSubs - withSubsSummaries));
    ok('Console', 'no JavaScript errors', errors.length === 0, errors.join(' | '));
    await br.close(); br = null;
  } catch (e) { try { if (br) await br.close(); } catch {} ok('Run', 'test run completed', false, e.stack.split('\n').slice(0, 4).join(' / ') + ' ERRORS: ' + errorsAll.join(' | ') + ' LOG: ' + log.slice(-400)); }
  try { srv.kill(); } catch {} try { await blobs.stop(); } catch {}
  let pass = 0;
  for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(0);
})();
