// v33: loads the 150 made-up enquiries in tools/test-data/enquiries-150.json into the TEST site, through the
// admin console's own API (the same as adding jobs by hand), then moves each one along the pipeline
// (called, quoted, won, completed, invoiced, paid or lost) so the dashboard and reports have something to show.
//
// TEST SITE ONLY. It refuses to run against a site that doesn't show the TEST SITE bar.
// No emails or Telegram alerts are sent: adding jobs in the console never sends any.
//
// Run it with deploy\load-test-data.ps1 (asks for the TEST console login), or:
//   node tools/load-test-data.mjs --site https://fixittest.netlify.app        (MBS_LOAD_USER and MBS_LOAD_PASS set)
//   add --again to load a second copy when test data is already there.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, def = '') => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : def; };
const SITE = opt('--site', 'https://fixittest.netlify.app').replace(/\/+$/, '');
const AGAIN = args.includes('--again');
const USER = process.env.MBS_LOAD_USER || '', PASS = process.env.MBS_LOAD_PASS || '';
const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = JSON.parse(fs.readFileSync(path.join(here, 'test-data', 'enquiries-150.json'), 'utf8')).enquiries;
const say = (m, c = '') => console.log(c + m + (c ? '\x1b[0m' : ''));
const stop = (m) => { say('\n' + m + '\n', '\x1b[31m'); process.exit(1); };

let host = '';
try { host = new URL(SITE).hostname.toLowerCase(); } catch { stop(`"${SITE}" is not a web address.`); }
if (/(^|\.)mbsplc\.com\.au$/.test(host) || /modernbuildingsolutions/.test(host)) stop('That is the LIVE site. Test data only ever goes to the test site.');
if (!USER || !PASS) stop('The TEST console username and password are needed (run deploy\\load-test-data.ps1).');

let cookie = '';
async function api(action, data = {}) {
  const r = await fetch(`${SITE}/.netlify/functions/admin`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-MBS-Admin': '1', Origin: SITE, ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify({ action, ...data }) });
  const set = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [];
  if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
  return j;
}

// 1. it must be the TEST site
let home = '';
try { home = await (await fetch(SITE + '/', { headers: { 'Cache-Control': 'no-cache' } })).text(); } catch (e) { stop(`Can't reach ${SITE}: ${e.message}`); }
if (!home.includes('mbs-test-badge')) stop(`${SITE} does not show the TEST SITE bar, so this is not the test site. Nothing was loaded.`);
say(`Test site confirmed: ${SITE}`, '\x1b[32m');

// 2. log in to the TEST console
try { await api('login', { username: USER, password: PASS }); } catch (e) { stop('Login failed: ' + e.message); }
say('Logged in to the test console.');

// 3. already loaded?
const existing = (await api('jobs', { stage: 'all' })).jobs || [];
const already = existing.filter((j) => /^02 5550 /.test(j.phone || '')).length;
if (already && !AGAIN) stop(`The test data is already there (${already} test enquiries). Nothing was loaded.\nTo add a second copy anyway, run it again with -Again.`);

// 4. add them, then move each along the pipeline
const STEPS = { new: [], called: ['called'], quoted: ['called', 'quoted'], won: ['called', 'quoted', 'won'],
  completed: ['called', 'quoted', 'won', 'completed'], invoiced: ['called', 'quoted', 'won', 'completed', 'invoiced'],
  paid: ['called', 'quoted', 'won', 'completed', 'invoiced', 'paid'], lost: ['called', 'quoted', 'lost'] };
let done = 0, failed = 0;
async function one(e) {
  const r = await api('create', { name: e.name, phone: e.phone, email: e.email, suburb: e.suburb, service: e.service, trade: e.trade,
    best_time: e.best_time, summary: `${e.summary} (Urgency: ${e.urgency})`, source: 'Test data (v33 loader)' });
  for (const st of STEPS[e.stage] || []) {
    if (st === 'quoted' && !e.quote) continue;
    const extra = st === 'quoted' ? { amount: e.quote } : st === 'invoiced' ? { amount: e.invoice } : st === 'lost' ? { reason: e.reason || '' } : {};
    await api('stage', { ref: r.job.core, stage: st, ...extra });
  }
}
const queue = DATA.slice();
async function worker() {
  while (queue.length) {
    const e = queue.shift();
    for (let tries = 1; ; tries++) {
      try { await one(e); done++; break; }
      catch (err) {
        if (/log in/i.test(err.message)) stop('The login ran out part way. Run it again with -Again to add the rest.');
        if (tries >= 3) { failed++; say(`  could not add ${e.name}: ${err.message}`, '\x1b[33m'); break; }
        await new Promise((res) => setTimeout(res, 800 * tries));
      }
    }
    if ((done + failed) % 10 === 0) say(`  ${done + failed} of ${DATA.length}...`);
  }
}
await worker();   // one at a time: each new job takes the next running number and updates the shared index
try { await api('logout'); } catch {}
say(`\nDone: ${done} test enquiries added${failed ? `, ${failed} could not be added` : ''}.`, failed ? '\x1b[33m' : '\x1b[32m');
say(`Open ${SITE}/admin/ and press Ctrl+F5.`);
