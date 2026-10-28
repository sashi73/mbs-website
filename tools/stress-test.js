// MBS stress test (local copy of the live code): real Netlify Blobs server behind a latency proxy,
// the site's own functions, stand-ins for DeepSeek / Telegram / Resend. Measures per-request time,
// Blobs round trips, and what happens when 1..N people use the console or the website at once.
//   node stress.js <site folder> [blobsLatencyMs=30] [out.json]
const { spawn } = require('child_process');
const http = require('http'), path = require('path'), fs = require('fs'), os = require('os');
const SITE = path.resolve(process.argv[2]);
const LAT = Number(process.argv[3] || 30);
const OUT = process.argv[4] || 'stress-results.json';
const PORT = 8899, BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]); };

(async () => {
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(os.tmpdir(), 'mbs-stress-blobs'); fs.rmSync(dir, { recursive: true, force: true });
  const blobs = new BlobsServer({ directory: dir, token: 'tok', port: 0 });
  const { port: bport } = await blobs.start();

  // latency proxy: every Blobs call waits LAT ms (a function talking to Blobs over the network), and is counted
  const stat = { calls: 0, inflight: 0, maxInflight: 0, byMethod: {} };
  // The local Blobs server checks "only save if unchanged" (etags) like Netlify, but does not send the etag back
  // when reading. The proxy adds it (remembered from the last save of that key), so conditional saves behave
  // exactly as on Netlify. Reads/saves of one key are kept in order so the etag always matches the data.
  const etags = new Map(), locks = new Map();
  const withLock = (key, fn) => { const prev = locks.get(key) || Promise.resolve(); let rel; const mine = new Promise((r) => (rel = r)); locks.set(key, prev.then(() => mine)); return prev.then(fn).finally(rel); };
  let delay = 0;
  const proxy = http.createServer((req, res) => {
    stat.calls++; stat.inflight++; stat.maxInflight = Math.max(stat.maxInflight, stat.inflight);
    stat.byMethod[req.method] = (stat.byMethod[req.method] || 0) + 1;
    const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => setTimeout(() => {
      const key = req.url.split('?')[0], isKey = !/[?&](prefix|directories|cursor)=/.test(req.url) && req.url.split('?')[0].split('/').length > 3;
      const forward = () => new Promise((done) => {
        const up = http.request({ host: '127.0.0.1', port: bport, path: req.url, method: req.method, headers: req.headers }, (r) => {
          const body = []; r.on('data', (d) => body.push(d)); r.on('end', () => {
            const h = { ...r.headers };
            if (req.method === 'PUT' && r.statusCode < 300 && h.etag) etags.set(key, h.etag);
            if (req.method === 'DELETE') etags.delete(key);
            if ((req.method === 'GET' || req.method === 'HEAD') && r.statusCode === 200 && !h.etag && etags.has(key)) h.etag = etags.get(key);
            res.writeHead(r.statusCode, h); res.end(Buffer.concat(body)); stat.inflight--; done();
          });
        });
        up.on('error', () => { stat.inflight--; res.writeHead(502).end(); done(); });
        up.end(Buffer.concat(chunks));
      });
      if (isKey) withLock(key, forward); else forward();
    }, delay));
  });
  await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
  const ctx = (port) => Buffer.from(JSON.stringify({ siteID: 'mbs', token: 'tok', edgeURL: `http://localhost:${port}`, uncachedEdgeURL: `http://localhost:${port}`, apiURL: `http://localhost:${port}` })).toString('base64');

  // stand-ins for DeepSeek (answers after 1.5 s, like a real AI reply), Telegram and Resend
  const mock = http.createServer((req, res) => { req.resume(); req.on('end', () => {
    if (/chat\/completions/.test(req.url)) return setTimeout(() => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Peeling paint in a bathroom is usually moisture. Want a free quote?' } }] })), 1500);
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, id: 'x', result: { message_id: 1 } }));
  }); });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const M = `http://127.0.0.1:${mock.address().port}`;

  // ---- seed a realistic year of data (straight into Blobs, no delay) ----
  process.env.NETLIFY_BLOBS_CONTEXT = ctx(proxy.address().port);
  const J = await import(path.join(SITE, 'netlify/lib/jobs.mjs'));
  const ACC = await import(path.join(SITE, 'netlify/lib/accounts.mjs'));
  const P = await import(path.join(SITE, 'netlify/lib/plan.mjs'));
  const t0 = Date.now(), cores = [];
  const subs = ['Castle Hill', 'Kellyville', 'Box Hill', 'Rouse Hill', 'Baulkham Hills', 'Parramatta', 'Norwest'];
  for (let i = 0; i < 300; i++) {
    const core = await J.nextCore(['W', 'F', 'T', 'R'][i % 4]);
    await J.create({ core, name: 'Customer ' + i, phone: '0400 000 ' + String(i).padStart(3, '0'), email: `c${i}@example.com`, suburb: subs[i % subs.length], service: 'Job ' + i, source: 'chat', summary: 'Seeded job for the stress test. '.repeat(4) });
    if (i % 3 === 0) await J.setStage(core, 'quoted', 'seed', { amount: 1500 + i * 10 });
    cores.push(core);
  }
  for (let i = 0; i < 60; i++) await ACC.createDoc('quote', { core: cores[i * 3], customer: { name: 'Customer ' + i * 3 }, items: [{ desc: 'Labour', qty: 8, price: 85 }, { desc: 'Materials', qty: 1, price: 640 }] }, 'seed');
  for (let i = 0; i < 40; i++) await ACC.saveExpense({ supplier: 'Bunnings', desc: 'Materials ' + i, category: 'Materials', inc: 100 + i * 7, core: cores[i] }, 'seed');
  const tasks = Array.from({ length: 16 }, (_, k) => ({ id: 't' + k, name: 'Task ' + k, phase: 'ph1', dur: 1 + (k % 3), pred: k ? ['t' + (k - 1)] : [], resource: 'Tiler', qty: 8, unit: 'h', rate: 85, pct: 0 }));
  for (let i = 0; i < 12; i++) await P.save(cores[i], { name: 'Plan ' + i, start: '2026-11-02', phases: [{ id: 'ph1', name: 'Executing' }], tasks, risks: [{ id: 'r1', title: 'Rain', p: 3, i: 3 }], issues: [] }, 0, 'seed');
  const seedSec = ((Date.now() - t0) / 1000).toFixed(1);
  delay = LAT;

  // ---- the site, talking to Blobs through the latency proxy ----
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NETLIFY_BLOBS_CONTEXT: ctx(proxy.address().port), ADMIN_USERNAME: 'sashi73', ADMIN_PASSWORD: 'sashi98',
    LLM_API_KEY: 'test', LLM_BASE_URL: M, TELEGRAM_API_BASE: M, RESEND_API_BASE: M, TELEGRAM_BOT_TOKEN: '123:abc', TELEGRAM_CHAT_ID: '-1001', TELEGRAM_ALERT_IDS: '222',
    RESEND_API_KEY: 're_test', OWNER_EMAIL: 'o@example.com', FROM_EMAIL: 'f@example.com', LIMIT_VISITS: '100000/1', LIMIT_CHAT: '100000/1', LIMIT_LEAD: '100000/1', LIMIT_ADMIN: '100000/1' };
  delete env.MBS_LOCAL;
  const srv = spawn('node', ['local-server.mjs'], { cwd: SITE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 60 && !/running/.test(log); i++) await sleep(150);

  // tiny HTTP client with its own cookie
  const agent = new http.Agent({ keepAlive: true, maxSockets: 512 });
  function req(method, p, body, cookie, ip) {
    return new Promise((resolve) => {
      const data = body ? JSON.stringify(body) : null, t = performance.now();
      const headers = { 'Content-Type': 'application/json', 'X-MBS-Admin': '1', 'X-Forwarded-For': ip || '10.0.0.1' };
      if (cookie) headers.Cookie = cookie;
      const r = http.request(BASE + p, { method, headers, agent }, (res) => {
        const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => resolve({ status: res.statusCode, ms: performance.now() - t, body: Buffer.concat(c).toString(), setCookie: res.headers['set-cookie'] }));
      });
      r.on('error', (e) => resolve({ status: 0, ms: performance.now() - t, body: e.message }));
      if (data) r.write(data); r.end();
    });
  }
  const admin = (a, d, cookie, ip) => req('POST', '/.netlify/functions/admin', { action: a, ...d }, cookie, ip);
  async function login(ip) { const r = await admin('login', { username: 'sashi73', password: 'sashi98' }, null, ip); return r.setCookie ? r.setCookie[0].split(';')[0] : null; }

  const results = { blobsLatencyMs: LAT, seed: { jobs: 300, quotes: 60, expenses: 40, plans: 12, seconds: Number(seedSec) }, profile: [], console: [], website: [], counter: [] };

  // ---- 1. one request at a time: how long, how many Blobs round trips ----
  const cookie = await login('10.9.9.9');
  const one = async (name, fn) => {
    await fn();                                       // warm up
    const c0 = stat.calls, r = await fn(), calls = stat.calls - c0;
    results.profile.push({ name, ms: Math.round(r.ms), blobsCalls: calls, status: r.status });
  };
  await one('Console: log in', () => admin('login', { username: 'sashi73', password: 'sashi98' }, null, '10.9.9.8'));
  await one('Console: who am I (every page load)', () => admin('me', {}, cookie));
  await one('Console: dashboard', () => admin('dashboard', { period: 'month' }, cookie));
  await one('Console: jobs list', () => admin('jobs', { stage: 'open' }, cookie));
  await one('Console: open a job', () => admin('job', { ref: cores[5] }, cookie));
  await one('Console: quotes & invoices list', () => admin('acctLists', {}, cookie));
  await one('Console: job quotes card', () => admin('docForJob', { core: cores[3] }, cookie));
  await one('Console: projects list', () => admin('planList', {}, cookie));
  await one('Console: open a project plan', () => admin('planGet', { core: cores[2] }, cookie));
  await one('Console: SQL wizard data', () => admin('sqlData', {}, cookie));
  await one('Console: activity log', () => admin('log', {}, cookie));
  await one('Console: add a note (write)', () => admin('note', { ref: cores[7], text: 'Stress note' }, cookie));
  await one('Website: home page (static)', () => req('GET', '/'));
  await one('Website: visitor counter (read)', () => req('GET', '/.netlify/functions/visits'));
  await one('Website: visitor counter (+1)', () => req('POST', '/.netlify/functions/visits', {}));
  await one('Website: Mr. Fixit chat reply (AI takes 1.5 s)', () => req('POST', '/.netlify/functions/chat', { messages: [{ role: 'user', content: 'My bathroom paint is peeling' }] }));
  await one('Website: send an enquiry', () => req('POST', '/.netlify/functions/lead', { source: 'form', channels: ['email', 'telegram'], lead: { name: 'Load Test', phone: '0400 111 222', suburb: 'Castle Hill', postcode: '2154', service: 'Leak repair', best_time: 'Anytime', summary: 'Stress test enquiry' } }));

  // ---- 2. N people using the console at the same moment ----
  // each person: log in, open the console (me + dashboard), jobs list, open a job, quotes list, open a plan
  async function consoleUser(i, times) {
    const ip = '10.1.' + Math.floor(i / 250) + '.' + (i % 250);
    const t = []; let err = 0;
    const rec = (r) => { t.push(r.ms); if (r.status !== 200) err++; return r; };
    const ck = await (async () => { const r = rec(await admin('login', { username: 'sashi73', password: 'sashi98' }, null, ip)); return r.setCookie ? r.setCookie[0].split(';')[0] : null; })();
    for (let k = 0; k < times; k++) {
      rec(await admin('me', {}, ck)); rec(await admin('dashboard', { period: 'month' }, ck));
      rec(await admin('jobs', { stage: 'open' }, ck)); rec(await admin('job', { ref: cores[(i * 7 + k) % cores.length] }, ck));
      rec(await admin('acctLists', {}, ck)); rec(await admin('planGet', { core: cores[(i + k) % 12] }, ck));
    }
    return { t, err };
  }
  for (const n of [1, 2, 5, 10, 25, 50]) {
    const c0 = stat.calls; stat.maxInflight = 0; const t = performance.now();
    const all = await Promise.all(Array.from({ length: n }, (_, i) => consoleUser(i, 2)));
    const secs = (performance.now() - t) / 1000, ts = all.flatMap((x) => x.t), err = all.reduce((a, x) => a + x.err, 0);
    results.console.push({ people: n, requests: ts.length, errors: err, p50: pct(ts, 50), p95: pct(ts, 95), max: pct(ts, 100), reqPerSec: Math.round(ts.length / secs), blobsCalls: stat.calls - c0, maxBlobsInFlight: stat.maxInflight });
    console.log('console', JSON.stringify(results.console.at(-1)));
  }

  // ---- 3. N visitors arriving at the website at the same moment ----
  for (const n of [10, 50, 100, 200]) {
    const before = JSON.parse((await req('GET', '/.netlify/functions/visits')).body).total;
    const t = performance.now(), ts = []; let err = 0;
    await Promise.all(Array.from({ length: n }, async (_, i) => {
      for (const r of [await req('GET', '/'), await req('GET', '/services.html'), await req('POST', '/.netlify/functions/visits', {}, null, '10.2.' + (i % 250) + '.1')]) { ts.push(r.ms); if (r.status !== 200) err++; }
    }));
    const secs = (performance.now() - t) / 1000;
    const after = JSON.parse((await req('GET', '/.netlify/functions/visits')).body).total;
    results.website.push({ visitors: n, requests: ts.length, errors: err, p50: pct(ts, 50), p95: pct(ts, 95), max: pct(ts, 100), reqPerSec: Math.round(ts.length / secs), countedVisits: after - before, lostVisits: n - (after - before) });
    console.log('website', JSON.stringify(results.website.at(-1)));
  }

  // ---- 4. people writing to the same records at once (notes on one job, enquiries) ----
  for (const n of [2, 10, 25]) {
    const job = cores[20 + n], before = JSON.parse((await admin('job', { ref: job }, cookie)).body).job.notes?.length || 0;
    const t = performance.now(), rs = await Promise.all(Array.from({ length: n }, (_, i) => admin('note', { ref: job, text: 'Same-time note ' + i }, cookie)));
    const after = JSON.parse((await admin('job', { ref: job }, cookie)).body).job.notes?.length || 0;
    results.counter.push({ test: `${n} notes on one job at once`, ms: Math.round(performance.now() - t), errors: rs.filter((r) => r.status !== 200).length, saved: after - before, lost: n - (after - before), p95: pct(rs.map((r) => r.ms), 95) });
    console.log('write', JSON.stringify(results.counter.at(-1)));
  }
  {
    const n = 20, before = (await J.all()).length, t = performance.now();
    const rs = await Promise.all(Array.from({ length: n }, (_, i) => req('POST', '/.netlify/functions/lead', { source: 'form', channels: ['email', 'telegram'], lead: { name: 'Burst ' + i, phone: '0400 222 ' + String(i).padStart(3, '0'), suburb: 'Kellyville', postcode: '2155', service: 'Leak repair', best_time: 'Anytime', summary: 'Burst enquiry ' + i } }, null, '10.3.0.' + i)));
    const allJobs = await J.all(), refs = new Set(allJobs.map((j) => j.core));
    results.counter.push({ test: `${n} enquiries at the same moment`, ms: Math.round(performance.now() - t), errors: rs.filter((r) => r.status !== 200).length, saved: allJobs.length - before, lost: n - (allJobs.length - before), uniqueNumbers: refs.size === allJobs.length, p95: pct(rs.map((r) => r.ms), 95) });
    console.log('write', JSON.stringify(results.counter.at(-1)));
  }

  // visitor counter exactly as it runs on Netlify (Blobs), many visitors at the same moment
  {
    process.env.NETLIFY_BLOBS_CONTEXT = ctx(proxy.address().port); delete process.env.MBS_LOCAL;
    const V = (await import(path.join(SITE, 'netlify/functions/visits.mjs'))).default;
    const call = (m) => V(new Request('http://x/.netlify/functions/visits', { method: m })).then((r) => r.json());
    for (const n of [5, 20, 50]) {
      const before = (await call('GET')).total, t = performance.now();
      await Promise.all(Array.from({ length: n }, () => call('POST')));
      const after = (await call('GET')).total;
      results.counter.push({ test: `${n} visitors counted at the same moment (Netlify counter)`, ms: Math.round(performance.now() - t), saved: after - before, lost: n - (after - before) });
      console.log('write', JSON.stringify(results.counter.at(-1)));
    }
  }
  results.profile.forEach((p) => console.log('profile', JSON.stringify(p)));
  fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
  srv.kill(); proxy.close(); mock.close(); agent.destroy(); await blobs.stop();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
