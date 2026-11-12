// GKH Project Champ: visitors (potential customers) who introduce themselves to Champ.
// Kept in Netlify Blobs under 'champ-visitors' as { list: [visitor, …] }, newest first, at most 3000.
// Champ asks for language → name → phone (with country code) → email → "send a welcome package?"; every step can be skipped.
import * as kv from './kv.mjs';
import { clean, env, sendEmail, stripThinking } from './shared.mjs';

const KEY = 'champ-visitors', MAX = 3000;
const ID = /^[A-Za-z0-9_-]{12,48}$/;
const EMAIL = /^[^\s@<>()",;:]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

export const validId = (id) => ID.test(String(id || ''));

// "+61 412 345 678", "0061412345678", "61412345678"  →  "+61412345678"; a local number (leading 0) has no country code: ''
export function normPhone(s) {
  let t = String(s || '').replace(/[^\d+]/g, '');
  if (t.startsWith('00')) t = '+' + t.slice(2);
  if (!t.startsWith('+')) { if (/^0/.test(t)) return ''; t = '+' + t; }
  t = '+' + t.slice(1).replace(/\+/g, '');
  const n = t.length - 1;
  return n >= 8 && n <= 15 && !/^\+0/.test(t) ? t : '';
}
// "sashi at gmail dot com" (spoken) → "sashi@gmail.com"
export function normEmail(s) {
  let t = String(s || '').trim().toLowerCase()
    .replace(/\s+(at|@)\s+/g, '@').replace(/\s+(dot|point)\s+/g, '.').replace(/\s+/g, '').replace(/[.。]+$/, '');
  return EMAIL.test(t) && t.length <= 120 ? t : '';
}
// "my name is Sashi Kumar." → "Sashi Kumar"
export function normName(s) {
  let t = clean(String(s || ''), 120).replace(/[\r\n\t]+/g, ' ').trim()
    .replace(/^(hi|hello|hey)[,!.\s]+/i, '')
    .replace(/^(my name is|my name's|i am|i'm|im|it's|it is|this is|call me|name:|name is|nama saya|saya)\s+/i, '')
    .replace(/[.!?。,;:]+$/, '').replace(/[<>{}[\]"`\\]/g, '').trim();
  if (t && t === t.toLowerCase() && /^[a-z' -]+$/.test(t)) t = t.replace(/(^|[\s'-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
  return t.slice(0, 60);
}

// A long answer ("என் பெயர் சசி குமார்", "bonjour, je m'appelle Marie Dupont") → ask the model for just the name
export async function extractName(text) {
  const quick = normName(text);
  if (quick.split(/\s+/).length <= 3) return quick;
  const apiKey = env('LLM_API_KEY'); if (!apiKey) return quick.split(/\s+/).slice(0, 3).join(' ');
  try {
    const base = env('LLM_BASE_URL', 'https://api.deepseek.com').replace(/\/+$/, '');
    let model = env('LLM_MODEL', 'deepseek-chat'); if (/reasoner|thinking/i.test(model)) model = 'deepseek-chat';
    const r = await fetch(`${base}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, temperature: 0, max_tokens: 60, stream: false, response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: 'The user was asked for their name and answered in any language. Return JSON only: {"name": "<just the person\'s name as they wrote it, in its own script>"} or {"name": ""} if there is no name.' }, { role: 'user', content: clean(text, 200) }] }) });
    if (!r.ok) throw new Error('model ' + r.status);
    const d = await r.json();
    const j = JSON.parse(stripThinking(d?.choices?.[0]?.message?.content || '{}').replace(/^```(json)?|```$/g, '').trim());
    return normName(j.name || '');
  } catch { return quick.split(/\s+/).slice(0, 3).join(' '); }
}

export async function list() { return ((await kv.get(KEY).catch(() => null)) || { list: [] }).list; }

export async function remove(ids) {
  const set = new Set((Array.isArray(ids) ? ids : [ids]).map(String));
  let n = 0;
  await kv.update(KEY, (cur) => { const before = cur.list.length; cur.list = cur.list.filter((v) => !set.has(v.id)); n = before - cur.list.length; return cur; }, { list: [] });
  return n;
}

// Save one step. fields: { lang, name, phone, email, welcome: 'yes'|'no', skip: 'name'|'phone'|'email'|'welcome', page }
export async function save(id, fields, meta = {}) {
  const now = new Date().toISOString();
  let rec = null;
  await kv.update(KEY, (cur) => {
    let i = cur.list.findIndex((v) => v.id === id);
    const v = i >= 0 ? cur.list[i] : { id, created: now, visits: 0, skipped: [] };
    for (const k of ['lang', 'name', 'phone', 'email', 'welcome', 'page']) if (fields[k] != null && fields[k] !== '') v[k] = fields[k];
    if (fields.skip && !v.skipped.includes(fields.skip)) v.skipped.push(fields.skip);
    if (fields.visit) { v.visits = (v.visits || 0) + 1; v.lastSeen = now; }
    if (!v.country && meta.country) v.country = meta.country;
    if (!v.city && meta.city) v.city = meta.city;
    v.updated = now; v.lastSeen = v.lastSeen || now;
    if (i >= 0) cur.list.splice(i, 1);
    cur.list.unshift(v); if (cur.list.length > MAX) cur.list.length = MAX;
    rec = { ...v }; return cur;
  }, { list: [] });
  // the welcome package: once, when they said yes and gave an email
  if (fields.welcome === 'yes' && rec.email && !rec.welcomeAt) {
    const r = await welcome(rec).catch((e) => ({ ok: false, reason: e.message }));
    const status = r.ok ? 'sent' : r.skipped ? 'requested' : 'failed';
    await kv.update(KEY, (cur) => { const v = cur.list.find((x) => x.id === id); if (v) { v.welcomeStatus = status; if (r.ok) v.welcomeAt = now; else v.welcomeNote = String(r.reason || '').slice(0, 200); } return cur; }, { list: [] });
    rec.welcomeStatus = status;
  }
  return rec;
}

const SITE = () => env('URL', 'https://gkh-project-champ.netlify.app').replace(/\/+$/, '');
function welcome(v) {
  const name = v.name || 'there', site = SITE();
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const text = `Hi ${name},

Welcome to GKH Project Champ, the AI-powered project management product from Global Knowledge House.

What's inside:
- Portfolio Summary and Pipeline board across the PMBOK life cycle (Initiation, Planning, Execution, Monitoring & Evaluation, Closing)
- AI-built project plans: scope, schedule (Gantt), budget, risks, stakeholders and communications
- Programs and portfolios with health, SPI and CPI at a glance
- Ask AI: ask any question about your projects, programs or portfolio in plain words
- Optional Bill of Materials and SWMS modules, and Champ, your multilingual assistant

Take a look: ${site}/features.html
Book a demo or ask us anything: ${site}/contact.html, or reply to this email.

Warm regards,
Sashi Kumar Sivam
Global Knowledge House · ceo@gkhconsultancy.com · 0493 431 202`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:auto;color:#14213d">
<div style="background:#0b1530;color:#fff;padding:22px 26px;border-radius:12px 12px 0 0"><img src="${site}/assets/gkh-champ-icon-192.png" width="54" height="54" alt="" style="vertical-align:middle;border-radius:50%"> <b style="font-size:20px;vertical-align:middle;margin-left:8px">GKH Project Champ</b></div>
<div style="border:1px solid #dde3ee;border-top:0;padding:24px 26px;border-radius:0 0 12px 12px">
<p style="font-size:17px">Hi ${esc(name)},</p>
<p>Welcome to <b>GKH Project Champ</b>, the AI-powered project management product from Global Knowledge House.</p>
<ul style="line-height:1.6">
<li>Portfolio <b>Summary</b> and <b>Pipeline board</b> across the PMBOK life cycle</li>
<li>AI-built project plans: scope, schedule (Gantt), budget, risks, stakeholders and communications</li>
<li>Programs and portfolios with health, SPI and CPI at a glance</li>
<li><b>Ask AI</b>: ask anything about your projects, programs or portfolio in plain words</li>
<li>Optional Bill of Materials and SWMS modules, and Champ, your multilingual assistant</li>
</ul>
<p style="margin:26px 0"><a href="${site}/features.html" style="background:#c9a227;color:#0b1530;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">See the features</a>
&nbsp; <a href="${site}/contact.html" style="color:#0b1530">Book a demo</a></p>
<p>Questions? Just reply to this email.</p>
<p>Warm regards,<br><b>Sashi Kumar Sivam</b><br>Global Knowledge House<br>ceo@gkhconsultancy.com · 0493 431 202</p>
</div><p style="font-size:12px;color:#7a8499;text-align:center">You asked Champ for this welcome package on ${esc(site.replace(/^https?:\/\//, ''))}. GKH AI Powered Business Intelligence · ABN 38 107 769 345</p></div>`;
  return sendEmail({ to: v.email, subject: `Welcome to GKH Project Champ, ${name}`, html, text, replyTo: env('OWNER_EMAIL', 'ceo@gkhconsultancy.com') });
}

// ---------- visitor counter: { visitors, visits, days: { 'YYYY-MM-DD': { u, v } } (last 400 days), pages: { '/x': visits } } ----------
const CKEY = 'champ-counter';
const sydDay = (t = Date.now()) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });
export async function counter() { return kv.get(CKEY).catch(() => null); }
export async function bump({ unique, visit, page }) {
  return kv.update(CKEY, (c) => {
    c.days = c.days || {}; c.pages = c.pages || {};
    const d = sydDay(), day = c.days[d] || (c.days[d] = { u: 0, v: 0 });
    if (unique) { c.visitors = (c.visitors || 0) + 1; day.u++; }
    if (visit) { c.visits = (c.visits || 0) + 1; day.v++; if (Object.keys(c.pages).length < 200 || c.pages[page]) c.pages[page] = (c.pages[page] || 0) + 1; }
    const keys = Object.keys(c.days).sort(); while (keys.length > 400) delete c.days[keys.shift()];
    return c;
  }, { visitors: 0, visits: 0, days: {}, pages: {}, since: new Date().toISOString() });
}
export function counterSummary(c) {
  c = c || {}; const days = c.days || {}, today = sydDay(), sum = (n, f) => { let t = 0; for (let i = 0; i < n; i++) { const x = days[sydDay(Date.now() - i * 864e5)]; if (x) t += x[f]; } return t; };
  return { visitors: c.visitors || 0, visits: c.visits || 0, since: c.since || '', today: (days[today] || {}).u || 0, todayVisits: (days[today] || {}).v || 0,
    week: sum(7, 'u'), weekVisits: sum(7, 'v'), month: sum(30, 'u'), pages: Object.entries(c.pages || {}).sort((a, b) => b[1] - a[1]).slice(0, 8),
    last14: Array.from({ length: 14 }, (_, i) => { const d = sydDay(Date.now() - (13 - i) * 864e5); return [d, (days[d] || {}).u || 0, (days[d] || {}).v || 0]; }) };
}
