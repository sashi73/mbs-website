// Reproduces "Failed to decode token: Token expired": Netlify hands every request a new Blobs token.
// A warm function must use the NEW token on the next request, not the one it saw first.
import { createRequire } from 'node:module';
import { rmSync } from 'node:fs';
const SITE = process.argv[2];
const require = createRequire(SITE + '/package.json');
const { BlobsServer } = await import(require.resolve('@netlify/blobs/server'));
const dir = SITE + '/../tokentest-blobs'; rmSync(dir, { recursive: true, force: true });
const ctx = (tok, port) => Buffer.from(JSON.stringify({ siteID: 'mbs', token: tok, edgeURL: `http://localhost:${port}`, uncachedEdgeURL: `http://localhost:${port}`, apiURL: `http://localhost:${port}` })).toString('base64');
let res = [];
const run = async (label, fn) => { try { await fn(); res.push(['PASS', label]); } catch (e) { res.push(['FAIL', label + ' (' + e.message.slice(0, 120) + ')']); } };

let s1 = new BlobsServer({ directory: dir, token: 'request-1-token', port: 0 }); const { port } = await s1.start();
process.env.NETLIFY_BLOBS_CONTEXT = ctx('request-1-token', port);
const kv = await import(SITE + '/netlify/lib/kv.mjs');
const A = await import(SITE + '/netlify/lib/admin-lib.mjs');
await run('request 1: job store works', async () => { await kv.set('t', { a: 1 }); if ((await kv.get('t')).a !== 1) throw new Error('bad read'); });
await run('request 1: console store works', async () => { await (await A.store('mbs-admin')).setJSON('t', { b: 1 }); });
await s1.stop();
// request 2: same warm function, the first token is no longer valid
let s2 = new BlobsServer({ directory: dir, token: 'request-2-token', port }); await s2.start();
process.env.NETLIFY_BLOBS_CONTEXT = ctx('request-2-token', port);
await run('request 2 (new token): job store uses the new token', async () => { if ((await kv.get('t')).a !== 1) throw new Error('bad read'); await kv.update('t', (v) => ({ a: v.a + 1 }), () => ({ a: 0 })); });
await run('request 2 (new token): console store uses the new token', async () => { const v = await (await A.store('mbs-admin')).get('t', { type: 'json' }); if (!v || v.b !== 1) throw new Error('bad read'); });
await s2.stop(); rmSync(dir, { recursive: true, force: true });
for (const [r, l] of res) console.log(`${r}  [Blobs token] ${l}`);
console.log(`\n${res.filter((x) => x[0] === 'PASS').length}/${res.length} passed`);
