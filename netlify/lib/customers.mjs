// Customer database. Every enquiry (website, Mr. Fixit, Telegram bot, console) is linked to a customer automatically.
// Unique key: phone number + email. When an enquiry has no email, the phone number alone is used, so it joins the
// customer with that phone. Kept in one Blobs record ("customers"), changed safely with compare-and-swap.
import * as kv from './kv.mjs';

export function normPhone(p) {
  let d = String(p || '').replace(/[^\d+]/g, '');
  if (d.startsWith('+61')) d = '0' + d.slice(3);
  else if (d.startsWith('61') && d.length === 11) d = '0' + d.slice(2);
  d = d.replace(/\D/g, '');
  if (d.length === 9 && /^[2-478]/.test(d)) d = '0' + d;   // 412 345 678 -> 0412 345 678
  return d.length >= 8 ? d : '';
}
export function normEmail(e) { const s = String(e || '').trim().toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : ''; }
export function keyOf({ phone, email }) { const p = normPhone(phone), e = normEmail(email); return p && e ? p + '|' + e : p || (e ? '|' + e : ''); }
// where the enquiry came from, in a few groups: chat (website chat / Mr. Fixit), web (contact form), phone, telegram, console, other
export function sourceKind(src) {
  const t = String(src || '').toLowerCase();
  return /chat|fix-?it/.test(t) ? 'chat' : /form|web/.test(t) ? 'web' : /phone|call/.test(t) ? 'phone' : /telegram/.test(t) ? 'telegram' : /added by|console|admin/.test(t) ? 'console' : 'other';
}
export const empty = () => ({ next: 1, list: {}, built: false });

// find the customer for a job: same phone (and the same email, unless one of them has no email); no phone: same email
export function match(d, phone, email) {
  const all = Object.values(d.list);
  if (phone) {
    const same = all.filter((c) => c.phone === phone);
    return same.find((c) => email && c.email === email) || same.find((c) => !email || !c.email) || null;
  }
  return email ? all.find((c) => c.email === email && !c.phone) || all.find((c) => c.email === email) || null : null;
}
const tidy = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
// add one job to the customer data (in memory). Returns the customer id, or '' when the job has no phone or email.
export function applyJob(d, job) {
  const phone = normPhone(job.phone), email = normEmail(job.email);
  if (!phone && !email) return '';
  let c = match(d, phone, email);
  if (!c) {
    const id = 'C' + String(d.next++).padStart(5, '0');
    c = d.list[id] = { id, name: tidy(job.name, 120), phone, email, suburb: tidy(job.suburb, 80), jobs: [], sources: {}, first: job.created || Date.now(), last: job.created || Date.now(), notes: '', created: Date.now() };
  }
  if (!c.email && email) c.email = email;
  if (!c.phone && phone) c.phone = phone;
  if (!c.name && job.name) c.name = tidy(job.name, 120);
  if (job.suburb && (job.created || 0) >= (c.last || 0)) c.suburb = tidy(job.suburb, 80);
  if (!c.jobs.includes(job.core)) {
    c.jobs.push(job.core);
    const s = sourceKind(job.source); c.sources[s] = (c.sources[s] || 0) + 1;
  }
  if (job.created) { c.first = Math.min(c.first || job.created, job.created); c.last = Math.max(c.last || 0, job.created); }
  c.updated = Date.now();
  return c.id;
}
export async function get() { return (await kv.get('customers')) || empty(); }
// called when a job is created: link it to its customer (never stops the enquiry from being saved)
export async function attach(job) {
  if (!job || !job.core) return '';
  let id = '';
  try { await kv.update('customers', (d) => { d.list = d.list || {}; d.next = d.next || 1; id = applyJob(d, job); return d; }, empty); }
  catch (e) { console.error('Customer link failed:', e.message); }
  return id;
}
// rebuild the links from all jobs (keeps names, notes and tags you edited); used the first time and from "Rebuild"
export async function rebuild(jobs) {
  let d;
  await kv.update('customers', (cur) => {
    d = cur && cur.list ? cur : empty();
    for (const c of Object.values(d.list)) { c.jobs = []; c.sources = {}; c.first = 0; c.last = 0; }
    for (const j of [...jobs].sort((a, b) => (a.created || 0) - (b.created || 0))) applyJob(d, j);
    for (const c of Object.values(d.list)) { if (!c.first) c.first = c.created || Date.now(); if (!c.last) c.last = c.first; }
    d.built = true; d.builtAt = Date.now();
    return d;
  }, empty);
  return d;
}
export async function edit(id, fields) {
  let out = null;
  await kv.update('customers', (d) => {
    const c = d.list && d.list[id]; if (!c) return d;
    if (fields.name !== undefined) c.name = tidy(fields.name, 120) || c.name;
    if (fields.suburb !== undefined) c.suburb = tidy(fields.suburb, 80);
    if (fields.address !== undefined) c.address = tidy(fields.address, 300);
    if (fields.notes !== undefined) c.notes = String(fields.notes || '').slice(0, 3000);
    if (fields.tags !== undefined) c.tags = (Array.isArray(fields.tags) ? fields.tags : String(fields.tags || '').split(',')).map((t) => tidy(t, 30)).filter(Boolean).slice(0, 10);
    c.updated = Date.now(); out = c; return d;
  }, empty);
  return out;
}
export function forJob(d, core) { return Object.values(d.list || {}).find((c) => c.jobs.includes(core)) || null; }
