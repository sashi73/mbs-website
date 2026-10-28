// MBS live speed check: a GENTLE timing test of the real website and console (not a stress test).
// It sends about 70 requests over a minute or two, never more than 5 at once: the same as a few people
// using the site. It adds no jobs, sends no enquiries, does not use the AI and does not count visits.
// It logs in once (one "Logged in" line appears in the Activity log).
//
//   node tools\live-check.mjs                    (checks https://mbsplc.com.au)
//   node tools\live-check.mjs https://mbsch.netlify.app
//
// Your password is typed into this window only and is never saved or shown.
import { createInterface } from 'node:readline';
import { writeFileSync } from 'node:fs';

const SITE = (process.argv[2] || 'https://mbsplc.com.au').replace(/\/$/, '');
const API = SITE + '/.netlify/functions/admin';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? Math.round(s[Math.floor(s.length / 2)]) : 0; };
const max = (a) => Math.round(Math.max(0, ...a));
const lines = [];
const say = (s = '') => { console.log(s); lines.push(s); };

let rl = null;
function ask(q, hidden) {
  if (!rl) { rl = createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY }); rl._out = rl._writeToOutput; }
  rl._writeToOutput = hidden ? (s) => { if (s.includes(q)) process.stdout.write(q); } : rl._out;
  return new Promise((resolve) => rl.question(q, (a) => { if (hidden) process.stdout.write('\n'); resolve(a); }));
}

let cookie = '';
async function hit(method, url, body) {
  const t = performance.now();
  const r = await fetch(url, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', 'X-MBS-Admin': '1', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  const ms = performance.now() - t;
  const st = r.headers.get('server-timing') || '', app = Number((st.match(/app;dur=(\d+)/) || [])[1] || NaN);
  const set = r.headers.get('set-cookie'); if (set && /mbs_admin=/.test(set)) cookie = set.split(';')[0];
  return { status: r.status, ms, app, start: r.headers.get('x-mbs-start') || '', cache: r.headers.get('cache-status') || r.headers.get('x-nf-cache') || '', size: text.length, text };
}
const admin = (action, data = {}) => hit('POST', API, { action, ...data });

(async () => {
  say(`MBS live speed check: ${SITE}   (${new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })} Sydney time)`);
  say('');

  // 1. website pages (served from Netlify's CDN)
  const pages = [];
  for (const p of ['/', '/services.html', '/contact.html', '/', '/services.html']) { const r = await hit('GET', SITE + p); pages.push(r.ms); await sleep(300); }
  say(`Website pages (CDN):           typical ${med(pages)} ms, slowest ${max(pages)} ms`);

  // 2. a website function (visitor counter, read only)
  const vis = [];
  for (let i = 0; i < 5; i++) { const r = await hit('GET', SITE + '/.netlify/functions/visits'); vis.push(r.ms); await sleep(400); }
  say(`Website function (counter):    first ${Math.round(vis[0])} ms, then typical ${med(vis.slice(1))} ms`);

  // 3. console
  const user = process.env.MBS_ADMIN_USER || await ask('Console username: ');
  const pass = await ask('Console password (hidden): ', true);
  rl.close();
  const lg = await admin('login', { username: user, password: pass });
  if (lg.status !== 200) { say(`Login failed (${lg.status}): ${lg.text.slice(0, 120)}  (stop here, so the console does not lock you out)`); process.exit(1); }
  say(`Console log in:                ${Math.round(lg.ms)} ms (server ${lg.app || '?'} ms, ${lg.start || 'unknown'} start)`);

  const row = async (label, action, data, n = 5) => {
    const t = [], app = [], starts = [];
    for (let i = 0; i < n; i++) { const r = await admin(action, data); t.push(r.ms); if (!isNaN(r.app)) app.push(r.app); starts.push(r.start); await sleep(350); }
    say(`${label.padEnd(31)}first ${String(Math.round(t[0])).padStart(5)} ms   typical ${String(med(t.slice(1))).padStart(4)} ms   server part ${app.length ? med(app) + ' ms' : 'n/a'}${starts.includes('cold') ? '   (a cold start was seen)' : ''}`);
    return { t, app };
  };
  say('');
  say('One person, one click at a time:');
  const me = await row('  Open the console (me)', 'me', {});
  const dash = await row('  Dashboard', 'dashboard', { period: 'month' });
  await row('  Jobs list', 'jobs', { stage: 'open' });
  await row('  Quotes & invoices', 'acctLists', {});
  await row('  Projects list', 'planList', {});

  // 4. a few people at the same moment (2, then 3, then 5 requests together)
  say('');
  say('Several people clicking at the same moment (dashboard):');
  const together = {};
  for (const n of [2, 3, 5]) {
    const t = [], cold = [];
    for (let round = 0; round < 3; round++) {
      const rs = await Promise.all(Array.from({ length: n }, () => admin('dashboard', { period: 'month' })));
      rs.forEach((r) => { t.push(r.ms); if (r.start === 'cold') cold.push(Math.round(r.ms)); });
      await sleep(1500);
    }
    together[n] = { median: med(t), slowest: max(t), cold };
    say(`  ${n} at once:  typical ${String(med(t)).padStart(4)} ms   slowest ${String(max(t)).padStart(5)} ms${cold.length ? `   ${cold.length} fresh copy(ies) started (cold): ${cold.join(', ')} ms` : ''}`);
  }
  await admin('logout');

  // 5. what it means
  const net = Math.max(0, med(me.t.slice(1)) - (med(me.app) || 0));
  const server = med(dash.app);
  say('');
  say('What the numbers mean:');
  say(`  - Network time to the function and back: about ${net} ms per click.`);
  say(`    Netlify runs the functions in one region (US East by default). From Sydney that is about 200-250 ms`);
  say(`    for every click; with the functions in Sydney it is about 10-30 ms.`);
  say(`  - Server time for the dashboard: about ${server} ms (reading the job list from Netlify Blobs).`);
  const coldSeen = Object.values(together).some((x) => x.cold.length);
  say(`  - "Cold start": when two people click at the same moment, Netlify starts a second copy of the function.`);
  say(`    The first click on a new copy is slower${coldSeen ? ' (seen above)' : ''}. Copies stay warm for a while, then are stopped.`);
  writeFileSync('mbs-live-check.txt', lines.join('\n') + '\n');
  say('');
  say('Saved to mbs-live-check.txt (send it to Claude if you want it explained).');
})().catch((e) => { console.error('Check stopped:', e.message); process.exit(1); });
