// Run the whole site on your computer, with the chat bot working.
//
//   1. Copy .env.example to .env and add your keys
//   2. node --env-file=.env local-server.mjs
//   3. Open http://localhost:8888
//
// Node reads .env for you (the same idea as python-dotenv). Needs Node 20.6 or newer.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [maj, min] = process.versions.node.split('.').map(Number);
if (maj < 20 || (maj === 20 && min < 6)) {
  console.error(`\nNode.js ${process.versions.node} is too old. Please install Node 20.6 or newer from https://nodejs.org\n`);
  process.exit(1);
}

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const PORT = Number(process.env.PORT || 8888);
const HOST = process.env.HOST || '127.0.0.1';
process.env.MBS_LOCAL = '1';   // lets the lead function keep a backup copy in leads/
process.chdir(ROOT);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.ico': 'image/x-icon'
};
// Site version. If any file below is from an older download, the window says so.
const VERSION = '2026-10-29 v32d (plan Time card: start, finish, duration)';
const NEEDS = [
  ['netlify/lib/shared.mjs', 'isTestSite'],
  ['netlify/lib/plan.mjs', 'gateOf'],
  ['admin/admin-plan.js', 'tplEmerg'],
  ['netlify/functions/planai-background.mjs', 'emergency'],
  ['admin/admin-plan.js', 'dateBoxes'],
  ['netlify/lib/plan.mjs', 't.fixed && t.snet'],
  ['netlify/lib/plan-quote.mjs', 'boardMove'],
  ['admin/admin-board.js', 'moveTo'],
  ['netlify/functions/admin.mjs', 'planQuotePost'],
  ['netlify/lib/pdf.mjs', 'coverPage'],
  ['netlify/lib/accounts.mjs', 'setPlan'],
  ['admin/admin-plan.js', 'quoteDialog'],
  ['netlify/functions/admin.mjs', 'custPost'],
  ['netlify/lib/customers.mjs', 'applyJob'],
  ['netlify/lib/jobs.mjs', 'CU.attach'],
  ['admin/admin-cust.js', 'custList'],
  ['admin/vendor/leaflet.js', 'Leaflet 1.9.4'],
  ['netlify/lib/plan.mjs', 'pipelineBoard'],
  ['admin/admin-board.js', 'pipelineBoard'],
  ['admin/admin.js', 'dashMode'],
  ['netlify/lib/plan.mjs', 'privateOut'],
  ['netlify/functions/lead.mjs', 'details: clean(lead.details'],
  ['admin/admin-plan.js', 'jobPeek'],
  ['netlify/functions/planai-background.mjs', 'buildAiPlan'],
  ['admin/admin-plan.js', 'dragRows'],
  ['netlify/lib/plan.mjs', 'planAiStatus'],
  ['netlify/lib/inventory.mjs', 'invPost'],
  ['admin/admin-inv.js', 'reorder'],
  ['netlify/lib/ai.mjs', 'checkLimit'],
  ['admin/admin-plan.js', 'askAI'],
  ['admin/admin-sql.js', 'askPanel'],
  ['netlify/lib/admin-sql.mjs', 'askSql'],
  ['admin/admin-plan.js', 'planState'],
  ['netlify/lib/plan.mjs', 'planPost'],
  ['admin/admin-sql.js', 'useTemplate'],
  ['netlify/lib/admin-sql.mjs', 'sqlPost'],
  ['netlify/lib/accounts.mjs', 'profitAndLoss'],
  ['admin/admin-acct.js', 'expenseForm'],
  ['netlify/functions/admin.mjs', 'readSession'],
  ['admin/admin.js', 'dataExplorer'],
  ['netlify/lib/store.mjs', 'nextReference'],
  ['netlify/lib/shared.mjs', 'sendTelegramPhotos'],
  ['netlify/lib/shared.mjs', 'SCOPE_PROMPT'],
  ['netlify/lib/shared.mjs', 'writeBrief'],
  ['netlify/lib/shared.mjs', 'synthesize'],
  ['netlify/functions/tts.mjs', 'synthesize'],
  ['assets/fixit.js', 'playServer'],
  ['assets/fixit.js', 'ms-MY'],
  ['netlify/functions/lead.mjs', 'writeBrief'],
  ['netlify/functions/lead.mjs', 'nextReference'],
  ['netlify/functions/chat.mjs', "mode === 'scope'"],
  ['assets/fixit.js', 'scope_skip'],
  ['assets/fixit.js', 'photo_add'],
  ['assets/fixit.js', 'fx-sound'],
  ['assets/fixit.js', 'fx-langbtn'],
  ['netlify/functions/chat.mjs', "mode === 'translate'"],
  ['assets/site.js', 'data-photo-input'],
  ['contact.html', 'data-photo-input'],
  ['database/schema.sql', 'trade_code'],
  ['index.html', 'mbs-logo.svg'],
  ['about.html', 'mbs-logo.svg'],
  ['assets/style.css', 'img.ilogo'],
  ['assets/mbs-logo.svg', '<svg'],
  ['index.html', 'creds-grid'],
  ['index.html', 'trustbar'],
  ['assets/style.css', '.trustbar'],
  ['projects.html', 'ba-frame'],
  ['local-server.mjs', 'overLimit'],
  ['deploy/setup-server.sh', 'Caddy'],
  ['assets/site.js', 'ba-frame'],
  ['assets/style.css', '.ba-frame'],
  ['index.html', 'hero-slides'],
  ['index.html', 'GeneralContractor'],
  ['sitemap.xml', 'projects.html'],
  ['assets/fixit.js', 'function callTimeChoices'],
  ['assets/fixit.js', 'function outOfArea'],
  ['assets/fixit.js', 'suburb_pick'],
  ['assets/fixit.js', 'function afterSuburb'],
  ['assets/fixit.js', 'function callLine'],
  ['netlify/lib/shared.mjs', 'export function humanise'],
  ['index.html', 'fixit.js?v=24'],
  ['assets/fixit.js', 'fx-ring'],
  ['netlify/lib/calendar.mjs', 'callReminder'],
  ['netlify/lib/bot.mjs', 'handleUpdate'],
  ['contact.html', 'name="best_time"'],
  ['index.html', 'data-visits'],
  ['netlify/functions/visits.mjs', 'getStore'],
  ['netlify/lib/shared.mjs', 'Sound like a person, not a template'],
  ['assets/suburbs-sydney.json', 'Box Hill'],
  ['netlify/lib/geo.mjs', 'qrPng'],
  ['netlify.toml', '/deploy/*'],
  ['netlify/lib/shared.mjs', 'since 2012'],
  ['images/work/park-royal-1.webp', ''],
  ['images/work/m/poolside-1.webp', ''],
  ['assets/style.css', '.creds-grid'],
  ['assets/badges/iso-9001.png', '']
];
async function notFound(res) {
  try { res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }).end(await readFile(join(ROOT, '404.html'))); }
  catch { res.writeHead(404).end('Not found'); }
}
async function oldFiles() {
  const out = new Set();
  for (const [f, mark] of NEEDS) {
    try { if (!(await readFile(join(ROOT, f), 'utf8')).includes(mark)) out.add(f); } catch { out.add(f + ' (missing)'); }
  }
  return [...out];
}

const FUNCTIONS = { chat: './netlify/functions/chat.mjs', lead: './netlify/functions/lead.mjs', tts: './netlify/functions/tts.mjs', visits: './netlify/functions/visits.mjs', admin: './netlify/functions/admin.mjs', 'planai-background': './netlify/functions/planai-background.mjs' };

// Per-visitor limits, so nobody can run up AI costs or flood staff with fake enquiries once the site is public.
// [requests allowed, per this many minutes]. Change in .env, e.g. LIMIT_CHAT=60/10
function limitOf(name, def) {
  const m = String(process.env['LIMIT_' + name.toUpperCase()] || def).match(/^(\d+)\/(\d+)$/);
  return m ? [Number(m[1]), Number(m[2]) * 60000] : [Infinity, 60000];
}
const LIMITS = { chat: limitOf('chat', '40/10'), tts: limitOf('tts', '80/10'), lead: limitOf('lead', '8/60'), visits: limitOf('visits', '20/10'), admin: limitOf('admin', '600/10') };
const hits = new Map();
function clientIp(req) {
  const peer = req.socket.remoteAddress || '';
  const local = peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1';
  // Behind Caddy (same machine) the visitor's address arrives in X-Forwarded-For
  const fwd = local && req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : '';
  return fwd || peer;
}
function overLimit(name, ip) {
  const [max, win] = LIMITS[name] || [Infinity, 60000];
  if (!Number.isFinite(max)) return false;
  const key = name + '|' + ip, now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < win);
  if (list.length >= max) { hits.set(key, list); return true; }
  list.push(now); hits.set(key, list);
  return false;
}
setInterval(() => {                                  // forget old visitors
  const now = Date.now();
  for (const [k, list] of hits) if (!list.some((t) => now - t < 3600000)) hits.delete(k);
}, 600000).unref();

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // Server functions
    const fn = url.pathname.match(/^\/\.netlify\/functions\/([a-z-]+)$/);
    if (fn && FUNCTIONS[fn[1]]) {
      if (req.method === 'POST' && overLimit(fn[1], clientIp(req))) {
        console.log(`[${new Date().toLocaleTimeString()}] Limit reached: ${fn[1]} from ${clientIp(req)}`);
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '600' });
        res.end(JSON.stringify({ error: 'Too many requests. Please call 0420 494 990.', reason: 'Too many requests from this device, please wait a few minutes' }));
        return;
      }
      const chunks = [];
      let size = 0;
      for await (const c of req) {
        size += c.length;
        if (size > 25 * 1024 * 1024) { res.writeHead(413).end('Too large'); return; }   // photos are compressed in the browser, so this is plenty
        chunks.push(c);
      }
      const request = new Request(url, {
        method: req.method,
        headers: req.headers,
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks)
      });
      const mod = await import(pathToFileURL(join(ROOT, FUNCTIONS[fn[1]])).href);
      if (fn[1].endsWith('-background')) {   // like Netlify: answer 202 at once, keep working afterwards
        Promise.resolve().then(() => mod.default(request, { waitUntil: (p) => { Promise.resolve(p).catch(() => {}); } })).catch((e) => console.error('Background function failed:', e));
        res.writeHead(202).end();
        return;
      }
      const response = await mod.default(request, { waitUntil: (p) => { Promise.resolve(p).catch(() => {}); } });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }

    // Never serve secrets or server code
    if (/^\/(\.env|\.git|netlify\/|tools\/|leads\/|data\/|database\/|deploy\/|local-server|package\.json|start-|check-setup|netlify\.toml|README|TELEGRAM-BOT-SETUP)/i.test(url.pathname)) { return notFound(res); }

    // Static files
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT + sep)) { res.writeHead(403).end('Forbidden'); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch (e) {
    if (e.code === 'ENOENT') { return notFound(res); }
    console.error(e);
    res.writeHead(500).end('Server error');
  }
}).on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`\nPort ${PORT} is already in use, probably by another MBS website window (maybe an older copy).\nClose the other black MBS window and start again, or change PORT in .env (for example PORT=8890) and ALLOWED_ORIGIN to match.\n`);
  else console.error(e);
  process.exit(1);
}).listen(PORT, HOST, () => {
  const on = (...keys) => keys.every((k) => process.env[k]);
  const tick = (ok) => (ok ? 'ready  ' : 'not set');
  console.log(`\n  MBS website is running:  http://localhost:${PORT}`);
  console.log(`  Version ${VERSION}`);
  console.log(`  Files from: ${ROOT}\n`);
  oldFiles().then((old) => {
    if (!old.length) return;
    console.log('\n  !! WARNING: these files are from an OLDER version, so reference numbers,');
    console.log('  !! photos or quote questions will not work properly:');
    old.forEach((f) => console.log('  !!    ' + f));
    console.log('  !! Unzip MBS_Website.zip over this folder, choose "Replace all", then restart.');
    console.log('  !! (Your .env and data folder are not in the zip, so they are kept.)\n');
  });
  const emailOk = on('RESEND_API_KEY');
  const tgOk = on('TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID');
  console.log(`  [${tick(on('LLM_API_KEY'))}]  Mr. Fixit AI answers      (LLM_API_KEY)`);
  console.log(`  [${tick(emailOk)}]  Email alerts to ${process.env.OWNER_EMAIL || 'sashi1973@gmail.com'}   (required)`);
  console.log(`  [${tick(tgOk)}]  Telegram alerts           (required)`);
  console.log(`  [${tick(on('AZURE_SPEECH_KEY'))}]  Voice in other languages  (AZURE_SPEECH_KEY, optional)`);
  import('./netlify/lib/store.mjs').then((m) => m.openDb()).then((db) => {
    if (db) {
      const n = db.prepare('SELECT COUNT(*) AS n FROM inquiries').get().n;
      console.log(`  [ready  ]  Enquiry database          data/mbs.db (${n} enquiries, references like R-YYMMDD-000001)`);
    } else {
      console.log(`  [off    ]  Enquiry database          needs Node 22.5 or newer (enquiries still saved to leads/leads.jsonl)`);
    }
  }).catch(() => {});
  if (!emailOk || !tgOk) {
    console.log(`\n  WARNING: enquiries will NOT send until both email and Telegram are set up.`);
    console.log(`  Fill in .env, then run the setup check.`);
  }
  console.log(`\n  Keys are read from .env and never sent to the browser.`);
  console.log(`  Press Ctrl+C to stop.\n`);
});
