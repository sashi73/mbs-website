// MBS job tracker: every enquiry becomes a job record that moves through stages.
//   New enquiry  PW-261025-000001   (P = preliminary, W = trade code)
//   Quoted       W-261025-000001
//   Job won      JW-261025-000001   (then completed, invoiced, paid)
// The digits never change, so any of the three numbers (or just the running number, e.g. 1) finds the job.
import * as kv from './kv.mjs';
import { parts } from './calendar.mjs';

export const STAGES = ['new', 'called', 'quoted', 'won', 'completed', 'invoiced', 'paid', 'lost'];
export const OPEN = ['new', 'called', 'quoted', 'won', 'completed', 'invoiced'];
export const LABEL = { new: 'New enquiry', called: 'Called', quoted: 'Quoted', won: 'Job won', completed: 'Completed', invoiced: 'Invoiced', paid: 'Paid', lost: 'Lost' };
export const ICON = { new: '🆕', called: '📞', quoted: '💬', won: '✅', completed: '🏁', invoiced: '🧾', paid: '💰', lost: '❌' };
const TIME_FIELD = { called: 'called_at', quoted: 'quoted_at', won: 'won_at', completed: 'completed_at', invoiced: 'invoiced_at', paid: 'paid_at', lost: 'lost_at' };

export const money = (n) => '$' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const gstOf = (incGst) => Math.round((Number(incGst) || 0) / 11 * 100) / 100;

export function refFor(job) {
  const st = job.stage === 'lost' ? (job.won_at ? 'won' : job.quoted_at ? 'quoted' : 'new') : job.stage;
  if (st === 'new' || st === 'called') return 'P' + job.core;
  if (st === 'quoted') return job.core;
  return 'J' + job.core;
}

// "PW-261025-000001", "W-261025-000001", "JW-261025-000001", "pw261025000001" -> core "W-261025-000001"
export function parseRef(input) {
  const s = String(input || '').trim().toUpperCase().replace(/\s+/g, '');
  const m = s.match(/^([PJ]?)([A-Z])-?(\d{6})-?(\d{6})$/);
  if (m) return { core: `${m[2]}-${m[3]}-${m[4]}` };
  const n = s.match(/^#?(\d{1,6})$/);
  if (n) return { run: Number(n[1]) };
  return null;
}

async function index() { return (await kv.get('index')) || { jobs: {} }; }
export const summary = (j) => ({ core: j.core, ref: refFor(j), stage: j.stage, name: j.name, phone: j.phone, suburb: j.suburb, service: j.service,
  created: j.created, updated: j.updated, quote: j.quote || null, invoice: j.invoice || null,
  called_at: j.called_at || null, quoted_at: j.quoted_at || null, won_at: j.won_at || null, completed_at: j.completed_at || null,
  invoiced_at: j.invoiced_at || null, paid_at: j.paid_at || null, lost_at: j.lost_at || null });

export async function find(input) {
  const p = parseRef(input);
  if (!p) return null;
  if (p.core) return kv.get('job:' + p.core);
  const idx = await index();
  const hit = Object.values(idx.jobs).filter((j) => Number(j.core.slice(-6)) === p.run).sort((a, b) => b.created - a.created)[0];
  return hit ? kv.get('job:' + hit.core) : null;
}

export async function search(text) {
  const q = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const digits = q.replace(/\D/g, '');
  const idx = await index();
  return Object.values(idx.jobs).filter((j) =>
    (j.name || '').toLowerCase().includes(q) || (j.suburb || '').toLowerCase().includes(q) || (j.service || '').toLowerCase().includes(q) ||
    (digits.length >= 4 && (j.phone || '').replace(/\D/g, '').includes(digits))
  ).sort((a, b) => b.created - a.created).slice(0, 15);
}

export async function list(stages = OPEN) {
  const idx = await index();
  return Object.values(idx.jobs).filter((j) => stages.includes(j.stage)).sort((a, b) => a.created - b.created);
}
export async function all() { return Object.values((await index()).jobs).sort((a, b) => a.created - b.created); }

// put a job's summary in the index (the list the console and bot read). If many changes arrive at once
// and it still can't be saved, leave a "pending" note; the 5-minute scheduled job adds it later (healIndex).
async function indexJob(job) {
  try { await kv.update('index', (idx) => { idx.jobs[job.core] = summary(job); return idx; }, () => ({ jobs: {} })); }
  catch (e) { console.error('Index busy, queued', job.core, e.message); await kv.set('pending:' + job.core, { at: Date.now() }); }
}
async function save(job) {
  job.updated = Date.now();
  job.ref = refFor(job);
  await kv.set('job:' + job.core, job);
  await indexJob(job);
  return job;
}
// change a job safely: if two people change the same job at the same moment, both changes are kept
async function change(input, fn) {
  const found = await find(input);
  if (!found) return null;
  let result;
  const job = await kv.update('job:' + found.core, (j) => { result = fn(j); j.updated = Date.now(); j.ref = refFor(j); return j; }, null);
  await indexJob(job);
  return { job, result };
}
export async function healIndex() {
  const pending = await kv.keys('pending:');
  for (const k of pending) {
    const job = await kv.get('job:' + k.slice(8));
    if (job) await kv.update('index', (idx) => { idx.jobs[job.core] = summary(job); return idx; }, () => ({ jobs: {} }));
    await kv.del(k);
  }
  return pending.length;
}

// new running number (never resets), dated in Sydney time
export async function nextCore(trade, now = Date.now()) {
  const seq = await kv.update('seq', (s) => ({ run: (s.run || 0) + 1 }), () => ({ run: 0 }));
  const p = parts(now);
  const yymmdd = String(p.y).slice(2) + String(p.mo).padStart(2, '0') + String(p.d).padStart(2, '0');
  return `${/^[A-Z]$/.test(trade) ? trade : 'M'}-${yymmdd}-${String(seq.run).padStart(6, '0')}`;
}

export async function create(fields, by = 'website') {
  const now = Date.now();
  const job = { core: fields.core, trade: fields.core[0], stage: 'new', created: now, updated: now,
    name: fields.name || '', phone: fields.phone || '', email: fields.email || '', suburb: fields.suburb || '', service: fields.service || '',
    best_time: fields.best_time || '', summary: fields.summary || '', details: fields.details || '', mapsUrl: fields.mapsUrl || '', source: fields.source || '',
    history: [{ at: now, by, text: `Enquiry received (${fields.source || 'website'})` }], notes: [] };
  return save(job);
}

// move a job to a stage. extra: { amount } for quoted / invoiced, { reason } for lost
export async function setStage(input, stage, by, extra = {}) {
  if (!STAGES.includes(stage)) return { error: 'bad stage' };
  const r = await change(input, (job) => {
    const before = refFor(job), now = Date.now();
    job.stage = stage;
    if (TIME_FIELD[stage]) job[TIME_FIELD[stage]] = now;
    let text = LABEL[stage];
    if (stage === 'quoted' && extra.amount) { job.quote = { amount: extra.amount, gst: gstOf(extra.amount), at: now }; text += ` ${money(extra.amount)} inc GST`; }
    if (stage === 'invoiced' && extra.amount) { job.invoice = { amount: extra.amount, gst: gstOf(extra.amount), at: now }; text += ` ${money(extra.amount)} inc GST`; }
    if (stage === 'lost' && extra.reason) { job.lost_reason = extra.reason; text += `: ${extra.reason}`; }
    const after = refFor(job);
    if (after !== before) text += ` (${before} → ${after})`;
    job.history.push({ at: now, by, text });
    return { before, after };
  });
  if (!r) return { error: 'not found' };
  return { job: r.job, before: r.result.before, after: r.result.after };
}

export async function addNote(input, text, by) {
  const r = await change(input, (job) => {
    job.notes = job.notes || []; job.history = job.history || [];
    job.notes.push({ at: Date.now(), by, text });
    job.history.push({ at: Date.now(), by, text: 'Note: ' + text });
  });
  return r ? r.job : null;
}

// ---------- photos (kept privately in Blobs, sent back by the bot with /photos) ----------
export async function savePhotos(core, photos, by = 'customer') {
  const existing = await kv.get('job:' + core);
  if (!existing || !photos.length) return existing;
  const stamp = Date.now().toString(36), saved = [];
  for (const [i, p] of photos.slice(0, 20).entries()) {
    const key = `photo:${core}:${stamp}${i + 1}`;
    await kv.putFile(key, p.buf, { type: p.type || 'image/jpeg', by, at: Date.now() });
    saved.push({ key, type: p.type || 'image/jpeg', by, at: Date.now() });
  }
  const r = await change(core, (job) => {
    job.photos = (job.photos || []).concat(saved);
    job.history.push({ at: Date.now(), by, text: `${saved.length} photo${saved.length > 1 ? 's' : ''} saved` });
  });
  return r ? r.job : existing;
}
export async function photo(key) { return kv.getFile(key); }

// ---------- reminders ----------
export async function addReminder({ at, text, core = '', chat = '', by = '' }) {
  let made;
  await kv.update('reminders', (r) => {
    made = { id: r.next, at, text, core, chat: String(chat || ''), by, created: Date.now() };
    r.list.push(made); r.next += 1; r.list.sort((a, b) => a.at - b.at);
    return r;
  }, () => ({ list: [], next: 1 }));
  return made;
}
export async function reminders() { return ((await kv.get('reminders')) || { list: [] }).list; }
export async function removeReminder(id) {
  let gone = null;
  await kv.update('reminders', (r) => { gone = r.list.find((x) => x.id === id) || null; r.list = r.list.filter((x) => x.id !== id); return r; }, () => ({ list: [], next: 1 }));
  return gone;
}
// take the reminders that are due (they are removed, so each is sent once)
export async function takeDue(now = Date.now()) {
  let due = [];
  await kv.update('reminders', (r) => { due = r.list.filter((x) => x.at <= now); r.list = r.list.filter((x) => x.at > now); return r; }, () => ({ list: [], next: 1 }));
  return due;
}

// ---------- reports ----------
export function report(jobs, from, to) {
  const inP = (t) => t && t >= from && t < to;
  const sum = (arr, f) => Math.round(arr.reduce((a, j) => a + (Number(f(j)) || 0), 0) * 100) / 100;
  const q = jobs.filter((j) => inP(j.quoted_at)), w = jobs.filter((j) => inP(j.won_at)), l = jobs.filter((j) => inP(j.lost_at));
  const inv = jobs.filter((j) => inP(j.invoiced_at) && j.invoice), paid = jobs.filter((j) => inP(j.paid_at) && j.invoice);
  const owed = jobs.filter((j) => j.stage === 'invoiced' && j.invoice);
  const invTotal = sum(inv, (j) => j.invoice.amount), paidTotal = sum(paid, (j) => j.invoice.amount), owedTotal = sum(owed, (j) => j.invoice.amount);
  const pipeline = {};
  for (const s of OPEN) pipeline[s] = jobs.filter((j) => j.stage === s).length;
  return {
    enquiries: jobs.filter((j) => inP(j.created)).length,
    called: jobs.filter((j) => inP(j.called_at)).length,
    quotes: q.length, quoteValue: sum(q, (j) => j.quote && j.quote.amount),
    won: w.length, wonValue: sum(w, (j) => j.quote && j.quote.amount),
    lost: l.length, winRate: w.length + l.length ? Math.round(w.length / (w.length + l.length) * 100) : null,
    completed: jobs.filter((j) => inP(j.completed_at)).length,
    invoiced: inv.length, invTotal, invGst: gstOf(invTotal), invEx: Math.round((invTotal - gstOf(invTotal)) * 100) / 100,
    paid: paid.length, paidTotal, paidGst: gstOf(paidTotal),
    owed: owed.length, owedTotal, owedGst: gstOf(owedTotal),
    pipeline
  };
}

export function csv(jobs) {
  const cols = ['ref', 'stage', 'name', 'phone', 'suburb', 'service', 'created', 'called_at', 'quoted_at', 'quote_inc_gst', 'quote_gst',
    'won_at', 'completed_at', 'invoiced_at', 'invoice_inc_gst', 'invoice_gst', 'invoice_ex_gst', 'paid_at', 'lost_at'];
  const d = (t) => (t ? new Date(t).toLocaleString('en-AU', { timeZone: 'Australia/Sydney' }) : '');
  const cell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const rows = jobs.map((j) => [j.ref, LABEL[j.stage], j.name, j.phone, j.suburb, j.service, d(j.created), d(j.called_at), d(j.quoted_at),
    j.quote ? j.quote.amount : '', j.quote ? gstOf(j.quote.amount) : '', d(j.won_at), d(j.completed_at), d(j.invoiced_at),
    j.invoice ? j.invoice.amount : '', j.invoice ? gstOf(j.invoice.amount) : '', j.invoice ? Math.round((j.invoice.amount - gstOf(j.invoice.amount)) * 100) / 100 : '',
    d(j.paid_at), d(j.lost_at)]);
  return '﻿' + [cols, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
