// POST /.netlify/functions/contact  (GKH Project Champ: the contact page enquiry form)
// Body: { first, last, email, phone?, org?, role?, country?, size?, reason, message?, pref, consent: true, news?, website (hidden: bots fill it), lang? }
// Saves the enquiry for the team (Customers > Enquiries in the console, kv 'champ-enquiries') and emails GKH.
// Returns: { ok, ref }
import { cors, json, clean, env, sendEmail } from '../lib/shared.mjs';
import * as kv from '../lib/kv.mjs';
import { normPhone, normEmail, normName } from '../lib/visitors.mjs';
import { toEnglish } from '../lib/english.mjs';
import { randomBytes } from 'node:crypto';

const KEY = 'champ-enquiries', MAX = 5000;
const hits = new Map();
function limited(ip) {   // 6 enquiries an hour per address is plenty for a person, and stops a script
  const now = Date.now(), list = (hits.get(ip) || []).filter((t) => now - t < 3600e3);
  list.push(now); hits.set(ip, list); if (hits.size > 5000) hits.clear();
  return list.length > 6;
}
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export default async (req, context) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
  const ip = (context && context.ip) || req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for') || 'local';
  let b;
  try { b = await req.json(); } catch { return json(400, { error: 'Invalid request' }); }
  if (b && b.website) return json(200, { ok: true, ref: 'ENQ-' + Date.now().toString(36).toUpperCase() });   // a bot: pretend, keep nothing
  if (limited(ip)) return json(429, { error: 'Thanks, we already have your enquiry. Please email ceo@gkhconsultancy.com if anything else comes up.' });

  const first = normName(b.first || '').slice(0, 40), last = normName(b.last || '').slice(0, 40), email = normEmail(b.email || '');
  const phone = b.phone ? normPhone(b.phone) : '';
  if (!first || !last) return json(422, { error: 'Please type your first and last name.' });
  if (!email) return json(422, { error: 'Please check your email address.' });
  if (b.phone && !phone) return json(422, { error: 'Please include the country code in your phone number, for example +61 412 345 678.' });
  if (b.consent !== true) return json(422, { error: 'Please tick the box to agree to the privacy notice.' });
  const reason = clean(String(b.reason || ''), 80);
  if (!reason) return json(422, { error: 'Please choose how we can help.' });
  const pref = ['Email', 'Phone', 'WhatsApp'].includes(b.pref) ? b.pref : 'Email';
  if (pref !== 'Email' && !phone) return json(422, { error: `Please add your phone number so we can reach you by ${pref}.` });

  const now = new Date(), geo = (context && context.geo) || {};
  const ref = 'ENQ-' + now.toISOString().slice(2, 10).replace(/-/g, '') + '-' + randomBytes(2).toString('hex').toUpperCase();
  const e = {
    ref, created: now.toISOString(), status: 'new', first, last, name: first + ' ' + last, email, phone, pref,
    org: clean(String(b.org || ''), 80), role: clean(String(b.role || ''), 60), country: clean(String(b.country || ''), 40) || (geo.country && geo.country.name) || '',
    size: clean(String(b.size || ''), 20), reason, message: clean(String(b.message || ''), 2000), news: !!b.news,
    consentAt: now.toISOString(), consentVer: 'PDPA/Privacy notice 2026-11', lang: clean(String(b.lang || 'en'), 8), city: geo.city || '', notes: ''
  };
  // written in another language: the team reads it in English (the original is kept too)
  const t = await toEnglish({ first: e.first, last: e.last, org: e.org, role: e.role, message: e.message });
  if (Object.keys(t.original).length) {
    for (const k of Object.keys(t.original)) e[k] = t.fields[k];
    e.name = e.first + ' ' + e.last; e.original = t.original; e.origLang = t.lang;
  }
  try {
    await kv.update(KEY, (cur) => { cur.list.unshift(e); if (cur.list.length > MAX) cur.list.length = MAX; return cur; }, { list: [] });
  } catch (err) {
    console.log('enquiry save failed: ' + err.message);
    return json(500, { error: 'Sorry, that didn’t send. Please try again, or email ceo@gkhconsultancy.com.' });
  }
  // tell the GKH team (needs RESEND_API_KEY; without it the enquiry is still in the console)
  const rows = [['Name', e.name], ['Email', e.email], ['Phone', e.phone || '–'], ['Best way to reach', pref], ['Organisation', e.org || '–'], ['Role', e.role || '–'],
    ['Country', e.country || '–'], ['Team size', e.size || '–'], ['How we can help', reason], ['Project Champ news', e.news ? 'Yes, please' : 'No']];
  const site = env('URL', 'https://gkh-project-champ.netlify.app').replace(/\/+$/, '');
  if (e.original) rows.push(['Written in', (e.origLang || 'another language') + ' (translated to English; original kept in the console)']);
  const text = `New Project Champ enquiry ${ref}\n\n${rows.map((r) => r[0] + ': ' + r[1]).join('\n')}\n\nMessage:\n${e.message || '(none)'}\n\nSee all enquiries: ${site}/admin/#enquiries`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:620px;color:#14213d"><h2 style="margin:0 0 12px">New Project Champ enquiry <span style="color:#a8841c">${esc(ref)}</span></h2>
<table style="border-collapse:collapse;width:100%">${rows.map((r) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;color:#667;width:170px">${esc(r[0])}</td><td style="padding:6px 10px;border-bottom:1px solid #eee"><b>${esc(r[1])}</b></td></tr>`).join('')}</table>
<p style="margin:16px 0 6px;color:#667">Message</p><div style="white-space:pre-wrap;background:#f6f4ee;border-radius:8px;padding:12px">${esc(e.message || '(none)')}</div>
<p style="margin-top:18px"><a href="${site}/admin/#enquiries" style="background:#c9a227;color:#0b1530;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:bold">Open enquiries</a></p></div>`;
  let emailed = false;
  try { const r = await sendEmail({ subject: `Project Champ enquiry ${ref}: ${reason} (${e.name})`, html, text, replyTo: e.email }); emailed = !!(r && r.ok); } catch (err) { console.log('enquiry email failed: ' + err.message); }
  return json(200, { ok: true, ref, emailed });
};
