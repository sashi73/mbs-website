// MBS admin console (CRM): login, sessions and data tools. Runs on Netlify, data in Netlify Blobs.
// The username and password live ONLY in Netlify environment variables (ADMIN_USERNAME, ADMIN_PASSWORD),
// never in the code or in GitHub.
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { env } from './shared.mjs';
import * as J from './jobs.mjs';
import * as kv from './kv.mjs';
import * as ACC from './accounts.mjs';

// ---------- stores ----------
export const LIVE = 'mbs-jobs', TEST = 'mbs-jobs-test', VISITS = 'mbs-visits', ADMIN = 'mbs-admin';
export const BROWSABLE = [LIVE, TEST, VISITS];
// A fresh store handle for every call (each Netlify request has its own short-lived Blobs token;
// reusing an old handle gives "Failed to decode token: Token expired").
let lib = null;
export async function store(name) {
  if (!lib) lib = import('@netlify/blobs').catch((e) => { lib = null; throw e; });
  const { getStore } = await lib;
  return getStore({ name, consistency: 'strong' });
}

// ---------- sessions ----------
const COOKIE = 'mbs_admin';
const HOURS = 12;
const b64 = (s) => Buffer.from(s).toString('base64url');
export function adminReady() { return !!(env('ADMIN_USERNAME') && env('ADMIN_PASSWORD')); }
function key() {   // changing the username or password signs everyone out
  return createHash('sha256').update(`mbs-admin|${env('ADMIN_USERNAME')}|${env('ADMIN_PASSWORD')}|${env('ADMIN_SESSION_SECRET')}`).digest();
}
const sign = (body) => createHmac('sha256', key()).update(body).digest('base64url');
function same(a, b) {
  const x = createHash('sha256').update(String(a)).digest(), y = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(x, y);
}
export function checkPassword(user, pass) {
  if (!adminReady()) return false;
  const u = same(String(user || '').trim().toLowerCase(), env('ADMIN_USERNAME').trim().toLowerCase());
  const p = same(String(pass || ''), env('ADMIN_PASSWORD'));
  return u && p;
}
export function makeSession(user, now = Date.now()) {
  const body = b64(JSON.stringify({ u: user, iat: now, exp: now + HOURS * 3600000 }));
  return body + '.' + sign(body);
}
export function readSession(req, now = Date.now()) {
  if (!adminReady()) return null;
  const m = String(req.headers.get('cookie') || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return null;
  const [body, sig] = m[1].split('.');
  if (!body || !sig || !same(sig, sign(body))) return null;
  try {
    const s = JSON.parse(Buffer.from(body, 'base64url').toString());
    return s.exp > now ? s : null;
  } catch { return null; }
}
export function cookie(req, value, maxAge) {
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}
export const sessionCookie = (req, token) => cookie(req, token, HOURS * 3600);
export const clearCookie = (req) => cookie(req, '', 0);

// ---------- login lockout: 5 wrong tries = 15 minutes locked (per device) ----------
export function clientIp(req) {
  return (req.headers.get('x-nf-client-connection-ip') || String(req.headers.get('x-forwarded-for') || '').split(',')[0] || 'local').trim();
}
const MAX_TRIES = 5, LOCK_MIN = 15;
export async function lockedFor(ip, now = Date.now()) {
  const s = await store(ADMIN);
  const r = await s.get('fail:' + ip, { type: 'json' });
  return r && r.until > now ? Math.ceil((r.until - now) / 60000) : 0;
}
export async function noteFailure(ip, now = Date.now()) {
  const s = await store(ADMIN);
  const r = (await s.get('fail:' + ip, { type: 'json' })) || { n: 0, first: now };
  if (now - r.first > LOCK_MIN * 60000) { r.n = 0; r.first = now; }
  r.n += 1;
  if (r.n >= MAX_TRIES) r.until = now + LOCK_MIN * 60000;
  await s.setJSON('fail:' + ip, r);
  return Math.max(0, MAX_TRIES - r.n);
}
export async function clearFailures(ip) { const s = await store(ADMIN); await s.delete('fail:' + ip); }

// activity log (last 300 admin actions)
export async function audit(user, text) {
  const s = await store(ADMIN);
  for (let i = 0; i < 5; i++) {
    const cur = await s.getWithMetadata('log', { type: 'json' });
    const list = (cur && cur.data) || [];
    list.unshift({ at: Date.now(), user, text });
    const r = await s.setJSON('log', list.slice(0, 300), cur ? (cur.etag ? { onlyIfMatch: cur.etag } : {}) : { onlyIfNew: true });
    if (!r || r.modified !== false) return;
  }
}
export async function auditLog() { const s = await store(ADMIN); return (await s.get('log', { type: 'json' })) || []; }

// ---------- data explorer ----------
export function kindOf(k) {
  if (k.startsWith('job:')) return 'job';
  if (k.startsWith('photo:')) return 'photo';
  if (k === 'index') return 'index';
  if (k === 'seq') return 'counter';
  if (k === 'reminders') return 'reminders';
  if (k === 'weekly') return 'weekly report marker';
  if (k.startsWith('quote:')) return 'quote';
  if (k.startsWith('invoice:')) return 'invoice';
  if (k.startsWith('expense:')) return 'expense';
  if (k.startsWith('receipt:')) return 'receipt';
  if (k === 'acct-index') return 'accounts list';
  if (k === 'acct-seq') return 'accounts counter';
  return 'other';
}
export async function listKeys(name) {
  const s = await store(name);
  const { blobs } = await s.list();
  const keys = blobs.map((b) => b.key).sort();
  let idx = {};
  let acct = null;
  if (name === LIVE || name === TEST) { idx = ((await s.get('index', { type: 'json' })) || { jobs: {} }).jobs; acct = await s.get('acct-index', { type: 'json' }); }
  return keys.map((k) => {
    const row = { key: k, kind: name === VISITS ? 'visitor counter' : kindOf(k) };
    if (row.kind === 'job') { const j = idx[k.slice(4)]; if (j) Object.assign(row, { ref: j.ref, name: j.name, stage: j.stage, created: j.created, suburb: j.suburb, service: j.service }); }
    if (row.kind === 'photo') row.job = k.split(':')[1];
    if (['quote', 'invoice', 'expense'].includes(row.kind) && acct) {
      const g = acct[{ quote: 'quotes', invoice: 'invoices', expense: 'expenses' }[row.kind]][k.split(':')[1]];
      if (g) Object.assign(row, { name: g.name || g.supplier, status: g.status, amount: g.inc, date: g.issued || g.date, core: g.core });
    }
    if (row.kind === 'receipt') row.expense = k.slice(8);
    return row;
  });
}
export async function getValue(name, k) {
  const s = await store(name);
  if (['photo', 'receipt'].includes(kindOf(k))) {
    const r = await s.getWithMetadata(k, { type: 'arrayBuffer' });
    return r ? { photo: true, bytes: r.data.byteLength, metadata: r.metadata || {} } : null;
  }
  return s.get(k, { type: 'json' });
}
export async function getPhoto(name, k) {
  const s = await store(name);
  const r = await s.getWithMetadata(k, { type: 'arrayBuffer' });
  return r ? { buf: Buffer.from(r.data), type: (r.metadata && r.metadata.type) || 'image/jpeg' } : null;
}

async function updateIndex(name, fn) {
  if (name === LIVE) return kv.update('index', (idx) => { fn(idx); return idx; }, () => ({ jobs: {} }));
  const s = await store(name);
  for (let i = 0; i < 8; i++) {
    const cur = await s.getWithMetadata('index', { type: 'json' });
    const idx = (cur && cur.data) || { jobs: {} };
    fn(idx);
    const r = await s.setJSON('index', idx, cur ? (cur.etag ? { onlyIfMatch: cur.etag } : {}) : { onlyIfNew: true });
    if (!r || r.modified !== false) return idx;
  }
  throw new Error('Could not update the index, please try again');
}

// delete keys; a job takes its photos, index entry and reminders with it
export async function deleteKeys(name, keys) {
  const s = await store(name);
  const done = new Set();
  for (const k of keys) {
    if (kindOf(k) === 'job') {
      const core = k.slice(4);
      const { blobs } = await s.list({ prefix: `photo:${core}:` });
      for (const b of blobs) { await s.delete(b.key); done.add(b.key); }
      await s.delete(k); done.add(k);
      await updateIndex(name, (idx) => { delete idx.jobs[core]; });
      if (name === LIVE) await kv.update('reminders', (r) => { r.list = r.list.filter((x) => x.core !== core); return r; }, () => ({ list: [], next: 1 }));
    } else if (kindOf(k) === 'photo') {
      await s.delete(k); done.add(k);
      const core = k.split(':')[1];
      const job = await s.get('job:' + core, { type: 'json' });
      if (job && job.photos) { job.photos = job.photos.filter((p) => p.key !== k); await s.setJSON('job:' + core, job); }
    } else if (['quote', 'invoice', 'expense'].includes(kindOf(k))) {
      await s.delete(k); done.add(k);
      const id = k.split(':')[1];
      if (kindOf(k) === 'expense') { await s.delete('receipt:' + id); done.add('receipt:' + id); }
      if (name === LIVE) await ACC.removeFromIndex(id);
    } else {
      await s.delete(k); done.add(k);
    }
  }
  return [...done];
}

// copy keys to another store (a job takes its photos with it), then delete them from the first store
export async function moveKeys(from, to, keys) {
  const a = await store(from), b = await store(to);
  const moved = [];
  const copy = async (k) => {
    if (['photo', 'receipt'].includes(kindOf(k))) {
      const r = await a.getWithMetadata(k, { type: 'arrayBuffer' });
      if (r) await b.set(k, r.data, { metadata: r.metadata || {} });
    } else {
      const v = await a.get(k, { type: 'json' });
      if (v != null) await b.setJSON(k, v);
    }
  };
  for (const k of keys) {
    if (!['job', 'photo', 'quote', 'invoice', 'expense'].includes(kindOf(k))) continue;   // records move; counters and lists stay put
    if (kindOf(k) === 'job') {
      const core = k.slice(4);
      const job = await a.get(k, { type: 'json' });
      if (!job) continue;
      const { blobs } = await a.list({ prefix: `photo:${core}:` });
      for (const p of blobs) await copy(p.key);
      await copy(k);
      await updateIndex(to, (idx) => { idx.jobs[core] = J.summary(job); });
    } else {
      if (kindOf(k) === 'expense') { const id = k.split(':')[1]; if ((await a.list({ prefix: 'receipt:' + id })).blobs.length) await copy('receipt:' + id); }
      await copy(k);
    }
    moved.push(...await deleteKeys(from, [k]));
  }
  if (to === LIVE && keys.some((k) => ['quote', 'invoice', 'expense'].includes(kindOf(k)))) await ACC.rebuildIndex();
  return moved;
}

export async function rebuildIndex(name) {
  const s = await store(name);
  const { blobs } = await s.list({ prefix: 'job:' });
  const jobs = {};
  for (const b of blobs) { const j = await s.get(b.key, { type: 'json' }); if (j && j.core) jobs[j.core] = J.summary(j); }
  if (name === LIVE) await kv.update('index', () => ({ jobs }), () => ({ jobs: {} }));
  else await s.setJSON('index', { jobs });
  return Object.keys(jobs).length;
}
