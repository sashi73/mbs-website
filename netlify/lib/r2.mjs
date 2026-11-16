// GKH Project Champ: ☁️ Cloudflare R2 object storage for the original files (Knowledge base, project documents for Ask AI,
// "start from a document", signed charters, contracts, meeting transcripts). The searchable text stays in Netlify Blobs,
// so Ask AI never waits on R2; R2 only keeps the files.
// The browser sends a file straight to R2 with a short-lived signed link (Netlify functions only take about 6 MB), and
// downloads come the same way. The keys never leave the server. S3 API, AWS Signature Version 4, no SDK.
// Netlify environment: R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY (R2_ENDPOINT only for tests).
import { createHash, createHmac } from 'node:crypto';

const env = (k) => String(process.env[k] || '').trim();
export function cfg() {
  const acct = env('R2_ACCOUNT_ID'), bucket = env('R2_BUCKET'), id = env('R2_ACCESS_KEY_ID'), secret = env('R2_SECRET_ACCESS_KEY');
  if (!acct || !bucket || !id || !secret) return null;
  const ep = env('R2_ENDPOINT') || `https://${acct}.r2.cloudflarestorage.com`, u = new URL(ep);
  return { acct, bucket, id, secret, proto: u.protocol, host: u.host, region: 'auto' };
}
export const ready = () => !!cfg();

const sha = (s) => createHash('sha256').update(s).digest('hex');
const hmac = (k, s) => createHmac('sha256', k).update(s).digest();
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const encPath = (p) => p.split('/').map(enc).join('/');
const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');   // 20261116T035800Z
function signingKey(secret, date, region, service) { return hmac(hmac(hmac(hmac('AWS4' + secret, date), region), service), 'aws4_request'); }
// a pre-signed URL (query-string authentication); exported with its inputs so it can be checked against AWS's own example
export function presignRaw({ method, proto = 'https:', host, path, id, secret, region, service = 's3', expires = 900, query = {}, now = new Date() }) {
  const amz = stamp(now), date = amz.slice(0, 8), scope = `${date}/${region}/${service}/aws4_request`;
  const q = { ...query, 'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Credential': `${id}/${scope}`, 'X-Amz-Date': amz, 'X-Amz-Expires': String(expires), 'X-Amz-SignedHeaders': 'host' };
  const cq = Object.keys(q).sort().map((k) => enc(k) + '=' + enc(q[k])).join('&');
  const creq = [method, encPath(path), cq, 'host:' + host, '', 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const sts = ['AWS4-HMAC-SHA256', amz, scope, sha(creq)].join('\n');
  const sig = createHmac('sha256', signingKey(secret, date, region, service)).update(sts).digest('hex');
  return `${proto}//${host}${encPath(path)}?${cq}&X-Amz-Signature=${sig}`;
}
function keyPath(c, key) { return `/${c.bucket}/${String(key).replace(/^\/+/, '')}`; }
// a link the browser can PUT the file to (or GET it from) for a few minutes
export function presign(method, key, { expires = 900, download = '' } = {}) {
  const c = cfg(); if (!c) return null;
  const query = download ? { 'response-content-disposition': `attachment; filename*=UTF-8''${enc(download)}` } : {};
  return presignRaw({ method, proto: c.proto, host: c.host, path: keyPath(c, key), id: c.id, secret: c.secret, region: c.region, expires, query });
}
// a server-side request (Authorization header)
async function call(method, key, { query = {}, body = null, type = '' } = {}) {
  const c = cfg(); if (!c) throw new Error('R2 is not set up');
  const now = new Date(), amz = stamp(now), date = amz.slice(0, 8), scope = `${date}/${c.region}/s3/aws4_request`;
  const path = key == null ? `/${c.bucket}` : keyPath(c, key), hash = sha(body || '');
  const cq = Object.keys(query).sort().map((k) => enc(k) + '=' + enc(query[k])).join('&');
  const hdr = { host: c.host, 'x-amz-content-sha256': hash, 'x-amz-date': amz }, names = Object.keys(hdr).sort();
  const creq = [method, encPath(path), cq, names.map((n) => n + ':' + hdr[n]).join('\n'), '', names.join(';'), hash].join('\n');
  const sts = ['AWS4-HMAC-SHA256', amz, scope, sha(creq)].join('\n');
  const sig = createHmac('sha256', signingKey(c.secret, date, c.region, 's3')).update(sts).digest('hex');
  const h = { 'x-amz-content-sha256': hash, 'x-amz-date': amz, Authorization: `AWS4-HMAC-SHA256 Credential=${c.id}/${scope}, SignedHeaders=${names.join(';')}, Signature=${sig}` };
  if (type) h['Content-Type'] = type;
  const r = await fetch(`${c.proto}//${c.host}${encPath(path)}${cq ? '?' + cq : ''}`, { method, headers: h, body: body || undefined, signal: AbortSignal.timeout(20000) });
  return r;
}
export async function put(key, buf, type) { const r = await call('PUT', key, { body: buf, type: type || 'application/octet-stream' }); if (!r.ok) throw new Error('R2 upload failed (' + r.status + ')'); return true; }
export async function del(key) { if (!key || !ready()) return false; const r = await call('DELETE', key).catch(() => null); return !!(r && (r.ok || r.status === 404)); }
export async function head(key) { const r = await call('HEAD', key).catch(() => null); return r && r.ok ? { size: Number(r.headers.get('content-length')) || 0, type: r.headers.get('content-type') || '' } : null; }
// how much is stored (all objects, or one area such as "kb/")
export async function usage(prefix = '') {
  let token = '', objects = 0, bytes = 0, pages = 0;
  do {
    const q = { 'list-type': '2', 'max-keys': '1000' }; if (prefix) q.prefix = prefix; if (token) q['continuation-token'] = token;
    const r = await call('GET', null, { query: q }); if (!r.ok) throw new Error('R2 answered ' + r.status + (r.status === 403 ? ': check the API token (Object Read & Write on this bucket)' : ''));
    const x = await r.text();
    for (const m of x.matchAll(/<Contents>[\s\S]*?<Size>(\d+)<\/Size>[\s\S]*?<\/Contents>/g)) { objects++; bytes += Number(m[1]) || 0; }
    token = /<IsTruncated>true<\/IsTruncated>/.test(x) ? ((x.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/) || [])[1] || '') : '';
  } while (token && ++pages < 50);
  return { objects, bytes };
}
// where a file goes: kb/2026/11/<random>-<name>, projects/<core>/2026/11/<random>-<name>
export function newKey(area, core, name) {
  const d = new Date(), safe = String(name || 'file').normalize('NFKD').replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '-').slice(-120) || 'file';
  const rnd = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const base = area === 'kb' ? 'kb' : 'projects/' + String(core || '').replace(/[^\w-]/g, '').slice(0, 40);
  return `${base}/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${rnd}-${safe}`;
}
export const keyOk = (key, prefix) => typeof key === 'string' && key.length < 400 && key.startsWith(prefix) && !key.includes('..') && /^[\w./ -]+$/.test(key);
export const MAX_UPLOAD = 300 * 1024 * 1024;   // R2's own limit for a single upload from the browser
