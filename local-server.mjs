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
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2', '.txt': 'text/plain', '.ico': 'image/x-icon'
};
// Site version. If any file below is from an older download, the window says so.
const VERSION = '2026-10-24 v19b (web-optimised WebP photos; owner photos in high resolution, recent jobs, 8 before & after, 59 owner photos, hero slideshow; accreditations: Ardex, Fatra, NSW Government Education, NSW Government, AIB, ISO 9001, Cm3)';
const NEEDS = [
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
  ['assets/fixit.js', 'proj_sector'],
  ['local-server.mjs', 'overLimit'],
  ['deploy/setup-server.sh', 'Caddy'],
  ['assets/fixit-kb.js', 'projectSectors'],
  ['assets/site.js', 'ba-frame'],
  ['assets/style.css', '.ba-frame'],
  ['index.html', 'hero-slides'],
  ['assets/fixit.js', 'var items = projectsFor'],
  ['netlify.toml', '/deploy/*'],
  ['netlify/lib/shared.mjs', 'since 2012'],
  ['images/work/park-royal-1.webp', ''],
  ['images/work/m/poolside-1.webp', ''],
  ['assets/style.css', '.creds-grid'],
  ['assets/badges/iso-9001.png', '']
];
async function oldFiles() {
  const out = new Set();
  for (const [f, mark] of NEEDS) {
    try { if (!(await readFile(join(ROOT, f), 'utf8')).includes(mark)) out.add(f); } catch { out.add(f + ' (missing)'); }
  }
  return [...out];
}

const FUNCTIONS = { chat: './netlify/functions/chat.mjs', lead: './netlify/functions/lead.mjs', tts: './netlify/functions/tts.mjs' };

// Per-visitor limits, so nobody can run up AI costs or flood staff with fake enquiries once the site is public.
// [requests allowed, per this many minutes]. Change in .env, e.g. LIMIT_CHAT=60/10
function limitOf(name, def) {
  const m = String(process.env['LIMIT_' + name.toUpperCase()] || def).match(/^(\d+)\/(\d+)$/);
  return m ? [Number(m[1]), Number(m[2]) * 60000] : [Infinity, 60000];
}
const LIMITS = { chat: limitOf('chat', '40/10'), tts: limitOf('tts', '80/10'), lead: limitOf('lead', '8/60') };
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
    const fn = url.pathname.match(/^\/\.netlify\/functions\/([a-z]+)$/);
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
      const response = await mod.default(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }

    // Never serve secrets or server code
    if (/^\/(\.env|\.git|netlify\/|tools\/|leads\/|data\/|database\/|deploy\/|local-server|package\.json|start-|check-setup|netlify\.toml|README)/i.test(url.pathname)) { res.writeHead(404).end('Not found'); return; }

    // Static files
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT + sep)) { res.writeHead(403).end('Forbidden'); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch (e) {
    if (e.code === 'ENOENT') { res.writeHead(404).end('Not found'); return; }
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
