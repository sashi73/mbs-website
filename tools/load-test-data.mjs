// v33/v44: loads the made-up test data into the TEST site: 150 enquiries (tools/test-data/enquiries-150.json),
// 50 suppliers and 150 stock items with six months of stock movements (suppliers-50.json, inventory-150.json),
// and 50 sub-contractors (subcontractors-50.json, v48).
// Enquiries go in through the
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
const WHAT = ['enquiries', 'inventory', 'subbies'].includes(opt('--what')) ? opt('--what') : 'all';   // v44/v47: enquiries, inventory (suppliers + stock), subbies, or all
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

// 3. enquiries (skipped if they are already there, unless --again)
const existing = (await api('jobs', { stage: 'all' })).jobs || [];
const already = existing.filter((j) => /^02 5550 /.test(j.phone || '')).length;
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
if (WHAT === 'all' || WHAT === 'enquiries') {
  if (already && !AGAIN) say(`Enquiries: already there (${already} test enquiries), skipped.`);
  else {
    say('Enquiries: adding 150...');
    for (const e of DATA) {
      for (let tries = 1; ; tries++) {
        try { await one(e); done++; break; }   // one at a time: each new job takes the next running number and updates the shared index
        catch (err) {
          if (/log in/i.test(err.message)) stop('The login ran out part way. Run it again to add the rest.');
          if (tries >= 3) { failed++; say(`  could not add ${e.name}: ${err.message}`, '\x1b[33m'); break; }
          await new Promise((res) => setTimeout(res, 800 * tries));
        }
      }
      if ((done + failed) % 10 === 0) say(`  ${done + failed} of ${DATA.length}...`);
    }
    say(`Enquiries: ${done} added${failed ? `, ${failed} could not be added` : ''}.`, failed ? '\x1b[33m' : '\x1b[32m');
  }
}

// 4. v44: suppliers and stock items (skipped if the test suppliers are already there)
if (WHAT === 'all' || WHAT === 'inventory') {
  const inv = await api('invList');
  const haveSup = (inv.suppliers || []).filter((s) => /\.example\.com$/.test(s.email || '') || /^02 5550 3/.test(s.phone || '')).length;
  if (haveSup && !AGAIN) say(`Suppliers and stock: already there (${haveSup} test suppliers), skipped.`);
  else {
    const SUP = JSON.parse(fs.readFileSync(path.join(here, 'test-data', 'suppliers-50.json'), 'utf8')).suppliers;
    const INV = JSON.parse(fs.readFileSync(path.join(here, 'test-data', 'inventory-150.json'), 'utf8')).items;
    const ids = {};
    for (let i = 0; i < SUP.length; i += 10) { const r = await api('invTestLoad', { kind: 'suppliers', suppliers: SUP.slice(i, i + 10) }); Object.assign(ids, r.ids); }
    say(`Suppliers: ${Object.keys(ids).length} added.`, '\x1b[32m');
    // stock used on jobs: link it to confirmed test jobs, so the map shows where stock goes
    const jobsNow = ((await api('jobs', { stage: 'all' })).jobs || []).filter((j) => ['won', 'completed', 'invoiced', 'paid'].includes(j.stage));
    const pool = jobsNow.length ? jobsNow : ((await api('jobs', { stage: 'all' })).jobs || []);
    let k = 0; const pickJob = () => (pool.length ? pool[(k++ * 7) % pool.length].core : '');
    const now = Date.now(), DAY = 864e5, ymdOf = (d) => new Date(now + d * DAY + 10 * 3600e3).toISOString().slice(0, 10);
    const items = INV.map((it) => ({
      name: it.name, sku: it.sku, category: it.category, unit: it.unit, location: it.location, reorderLevel: it.reorderLevel, reorderQty: it.reorderQty, packSize: it.packSize, notes: it.notes,
      onHand: it.onHand, preferred: ids[it.preferred] || '',
      prices: it.prices.map((p) => ({ supplier: ids[p.supplier] || '', price: p.price, ref: p.ref, quoted: ymdOf(p.quotedDays), validUntil: p.validDays == null ? '' : ymdOf(p.validDays) })).filter((p) => p.supplier),
      onOrder: it.onOrder ? { qty: it.onOrder.qty, supplier: ids[it.onOrder.supplier] || '', at: now - it.onOrder.daysAgo * DAY, expected: ymdOf(it.onOrder.expectedDays), via: it.onOrder.via } : null,
      moves: it.moves.map((m) => ({ at: now - m.daysAgo * DAY - Math.round(Math.random() * 8) * 3600e3, kind: m.kind, qty: m.kind === 'out' ? -Math.abs(m.qty) : m.qty, reason: m.reason, job: m.job === 'JOB' ? pickJob() : '' })) }));
    let n = 0;
    for (let i = 0; i < items.length; i += 10) { const r = await api('invTestLoad', { kind: 'items', items: items.slice(i, i + 10) }); n += r.ids.length; say(`  ${n} of ${items.length} stock items...`); }
    say(`Stock items: ${n} added, with six months of stock movements.`, '\x1b[32m');
  }
}
// 5. v47/v48: 50 sub-contractors. Only the ones not there yet are added (matched on their test phone number),
// so running it again, or after the first 30 (v47), just tops up to 50.
if (WHAT === 'all' || WHAT === 'subbies') {
  const SUBS = JSON.parse(fs.readFileSync(path.join(here, 'test-data', 'subcontractors-50.json'), 'utf8')).subs;
  const have = new Set(((await api('subList')).subs || []).map((s) => s.phone || '').filter((p) => /^02 5550 31/.test(p)));
  const todo = AGAIN ? SUBS : SUBS.filter((s) => !have.has(s.phone));
  if (!todo.length) say(`Sub-contractors: all ${SUBS.length} test subbies already there, skipped.`);
  else {
    let n = 0; for (let i = 0; i < todo.length; i += 10) n += (await api('subTestLoad', { subs: todo.slice(i, i + 10) })).ids.length;
    say(`Sub-contractors: ${n} added${have.size && !AGAIN ? ` (${have.size} were already there)` : ''}.`, '\x1b[32m');
  }
}
try { await api('logout'); } catch {}
say(`\nDone. Open ${SITE}/admin/ and press Ctrl+F5.`, '\x1b[32m');
