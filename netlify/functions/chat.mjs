// POST /.netlify/functions/chat  (GKH Project Champ assistant "Champ")
// Body: { messages: [{ role: 'user'|'assistant', content }], lang: 'auto'|'en'|'ms'|…, where: 'site'|'console' }
// Returns: { reply }
// Answers questions on the product, project, program and portfolio management, in many languages.
// The LLM key lives only in Netlify (LLM_API_KEY; LLM_BASE_URL and LLM_MODEL optional, DeepSeek by default).

import { env, stripThinking, cors, json, clean } from '../lib/shared.mjs';
import { SYSTEM, LANGS } from '../lib/champ-kb.mjs';
import { store } from '../lib/admin-lib.mjs';
import { createHash } from 'node:crypto';
import * as V from '../lib/visitors.mjs';
import { toEnglish } from '../lib/english.mjs';

const MAX_TURNS = 12, MAX_CHARS = 1200;
// Each chat question stays within about 2000 tokens in all: Champ's instructions + the recent conversation + the answer.
const BUDGET = 2000, ANSWER = 450;   // short, conversational answers; 450 still fits a full answer in Tamil or Chinese
// a rough token count: about 4 characters a token in Latin script, about 1 a character in Chinese, Tamil, Arabic and the like
const tokensOf = (t) => { let a = 0, o = 0; for (const ch of String(t)) { if (ch.charCodeAt(0) < 0x250) a++; else o++; } return Math.ceil(a / 4 + o * 0.9) + 4; };
const CONTACT = 'ceo@gkhconsultancy.com';
// a light per-address limit for this function instance (stops a runaway script, not a determined attacker)
const hits = new Map();
function limited(ip) {
  const now = Date.now(), list = (hits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  list.push(now); hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return list.length > 40;
}

export default async (req, context) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
  const ip = (context && context.ip) || req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for') || 'local';
  let body;
  try { body = await req.json(); } catch { return json(400, { error: 'Invalid JSON' }); }
  // these have their own limits: page-by-page browsing must not use up the questions allowance
  if (body?.mode === 'count') return count(body, ip);
  if (body?.mode === 'visitor') return visitor(body, ip, context);
  if (body?.mode === 'i18n') return i18n(body, ip);   // its own limit (pages are cached once translated)
  if (limited(ip)) return json(429, { error: 'Lots of questions in a short time. Please wait a few minutes and try again.' });
  const lang = LANGS[body?.lang] ? LANGS[body.lang] : LANGS.auto;
  const where = body?.where === 'console' ? 'console' : 'site';
  const messages = (Array.isArray(body?.messages) ? body.messages : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_TURNS)
    .map((m) => ({ role: m.role, content: clean(m.content, MAX_CHARS) }))
    .filter((m) => m.content);
  if (!messages.length || messages[messages.length - 1].role !== 'user') return json(400, { error: 'Send a question.' });
  // keep the newest turns that fit the budget (the question itself always goes, shortened if it must)
  const sys = SYSTEM(lang, where) + who(body?.name);
  let room = BUDGET - ANSWER - tokensOf(sys);
  const keep = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i], n = tokensOf(m.content);
    if (n <= room) { keep.unshift(m); room -= n; continue; }
    if (!keep.length) keep.unshift({ role: m.role, content: m.content.slice(0, Math.max(200, room * 3)) });
    break;
  }
  while (keep.length && keep[0].role !== 'user') keep.shift();   // start on a question
  messages.splice(0, messages.length, ...keep);

  const apiKey = env('LLM_API_KEY');
  if (!apiKey) {
    console.log('Champ assistant: LLM_API_KEY is not set in Netlify');
    return json(503, { error: `The assistant isn't switched on yet. Please email ${CONTACT} and we'll answer.`, reason: 'LLM_API_KEY is empty' });
  }
  const base = env('LLM_BASE_URL', 'https://api.deepseek.com').replace(/\/+$/, '');
  let model = env('LLM_MODEL', 'deepseek-chat');
  if (/reasoner|thinking/i.test(model)) model = 'deepseek-chat';   // quick answers: thinking mode off

  let data;
  try {
    const r = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, temperature: 0.4, max_tokens: ANSWER, stream: false, messages: [{ role: 'system', content: sys }, ...messages] })
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      console.log(`Champ assistant: model error ${r.status} ${text.slice(0, 160)}`);
      return json(502, { error: `The assistant is busy right now. Please try again, or email ${CONTACT}.`, reason: `model error ${r.status}` });
    }
    data = await r.json();
  } catch (e) {
    console.log(`Champ assistant: could not reach the model (${e.message})`);
    return json(502, { error: `The assistant is unavailable right now. Please try again, or email ${CONTACT}.` });
  }
  let reply = stripThinking(data?.choices?.[0]?.message?.content ?? '').trim();
  // the model ends with [[lang:xx]] (the language it answered in) so the voice can match it
  let said = LANGS[body?.lang] && body.lang !== 'auto' ? body.lang : 'en';
  const tag = /\[\[\s*lang\s*[:=]\s*([a-z]{2,3})\s*\]\]\s*$/i.exec(reply);
  if (tag) { reply = reply.slice(0, tag.index).trim(); if (LANGS[tag[1].toLowerCase()]) said = tag[1].toLowerCase(); }
  return json(200, { reply: reply || `Sorry, I didn't get that. Could you ask again? You can also email ${CONTACT}.`, lang: said });
};

// the visitor told Champ their name: use it now and then
function who(n) {
  const name = clean(String(n || ''), 60).replace(/[\r\n<>{}[\]"`\\]/g, ' ').trim();
  return name ? `\n\nThe person you are talking to is called ${name}. Address them by name naturally now and then (for example in a greeting or when wrapping up), not in every reply.` : '';
}

// ---------- visitors: Champ's welcome questions (language, name, phone, email, welcome package) ----------
// Body: { mode: 'visitor', id, lang?, name?, phone?, email?, welcome?: 'yes'|'no', skip?: step, visit?: true, forget?: true }
const vHits = new Map();
function vLimited(ip) {
  const now = Date.now(), list = (vHits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  list.push(now); vHits.set(ip, list); if (vHits.size > 5000) vHits.clear();
  return list.length > 30;
}
async function visitor(body, ip, context) {
  if (vLimited(ip)) return json(429, { error: 'Too many changes at once. Please try again in a few minutes.' });
  const id = String(body?.id || '');
  if (!V.validId(id)) return json(400, { error: 'Unknown visitor' });
  try {
    if (body.forget) return json(200, { ok: true, removed: await V.remove(id) });
    const f = {}, bad = [];
    if (body.lang != null && LANGS[body.lang] && body.lang !== 'auto') f.lang = body.lang;
    if (body.website) return json(200, { ok: true, visitor: {} });   // the hidden field only a bot fills in
    if (body.name != null) { f.name = await V.extractName(body.name); if (!f.name) bad.push('name'); }
    if (body.first != null || body.last != null) {
      f.first = V.normName(body.first || '').slice(0, 40); f.last = V.normName(body.last || '').slice(0, 40);
      if (!f.first || !f.last) bad.push('name'); else f.name = f.first + ' ' + f.last;
    }
    if (body.purpose != null) f.purpose = clean(String(body.purpose), 80);
    if (body.more != null) f.more = clean(String(body.more), 400);
    if (body.consent === true) { f.consentAt = new Date().toISOString(); f.consentVer = 'PDPA/Privacy notice 2026-11'; }
    if (body.phone != null) { f.phone = V.normPhone(body.phone); if (!f.phone) bad.push('phone'); }
    if (body.email != null) { f.email = V.normEmail(body.email); if (!f.email) bad.push('email'); }
    if (body.welcome === 'yes' || body.welcome === 'no') f.welcome = body.welcome;
    if (['lang', 'name', 'phone', 'email', 'welcome'].includes(body.skip)) f.skip = body.skip;
    if (body.visit) f.visit = true;
    if (body.page) f.page = clean(String(body.page), 120);
    if (bad.length) return json(422, { error: 'invalid', bad });
    // typed in another language: keep it in English for the GKH team (and the original alongside)
    if (f.first || f.more) {
      const t = await toEnglish({ first: f.first || '', last: f.last || '', more: f.more || '' });
      if (Object.keys(t.original).length) {
        for (const k of ['first', 'last', 'more']) if (t.original[k]) f[k] = t.fields[k];
        if (f.first) f.name = f.first + ' ' + f.last;
        f.original = t.original; f.origLang = t.lang;
      }
    }
    const geo = (context && context.geo) || {};
    const v = await V.save(id, f, { country: geo.country && geo.country.name, city: geo.city });
    return json(200, { ok: true, visitor: { first: v.first || '', name: v.name || '', phone: v.phone || '', email: v.email || '', lang: v.lang || '', welcome: v.welcome || '', welcomeStatus: v.welcomeStatus || '' } });
  } catch (e) {
    console.log('visitor save failed: ' + e.message);
    return json(500, { error: 'Could not save right now.' });
  }
}

// ---------- the visitor counter (website footer; Customers > Visitors in the console) ----------
// Body: { mode: 'count', unique: bool (first time in this browser), visit: bool (new browser session), page }
const cSeen = new Map();
async function count(body, ip) {
  const now = Date.now(), last = cSeen.get(ip) || {};
  // one new visitor per address per 6 hours and one visit per address per 10 minutes, so a reload loop can't run the numbers up
  const unique = !!body.unique && !(last.u && now - last.u < 6 * 3600e3);
  const visit = !!body.visit && !(last.v && now - last.v < 10 * 60e3);
  if (cSeen.size > 20000) cSeen.clear();
  try {
    if (!unique && !visit) { const c = (await V.counter()) || {}; return json(200, { visitors: c.visitors || 0, visits: c.visits || 0 }); }
    cSeen.set(ip, { u: unique ? now : last.u, v: visit ? now : last.v });
    const c = await V.bump({ unique, visit, page: clean(String(body.page || '/'), 80) });
    return json(200, { visitors: c.visitors, visits: c.visits });
  } catch (e) { console.log('counter failed: ' + e.message); return json(200, { visitors: 0, visits: 0 }); }
}

// ---------- page translation (website and console labels), cached per language in Netlify Blobs ----------
// Body: { mode: 'i18n', lang: 'ms', strings: ['Home', 'Features', …] }  →  { map: { 'Home': 'Utama', … } }
const tCalls = new Map();
function tLimited(ip) {   // at most 60 model calls per address per 10 minutes for uncached text
  const now = Date.now(), list = (tCalls.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  list.push(now); tCalls.set(ip, list); if (tCalls.size > 5000) tCalls.clear();
  return list.length > (Number(env('CHAMP_I18N_LIMIT')) || 60);
}
const hash = (s) => createHash('sha1').update(s).digest('base64url').slice(0, 16);
async function i18n(body, ip) {
  const code = String(body?.lang || '');
  if (!LANGS[code] || code === 'auto') return json(400, { error: 'Unknown language' });
  const strings = [...new Set((Array.isArray(body?.strings) ? body.strings : []).map((x) => clean(String(x || ''), 700)).filter(Boolean))].slice(0, 80);
  if (!strings.length) return json(200, { map: {} });
  let st = null, cache = {};
  try { st = await store('champ-i18n'); cache = (await st.get(code, { type: 'json' })) || {}; } catch (e) { console.log('i18n cache unavailable: ' + e.message); }
  const map = {}, need = [];
  for (const t of strings) { const h = hash(t); if (cache[h] != null) map[t] = cache[h]; else need.push(t); }
  if (need.length) {
    const apiKey = env('LLM_API_KEY');
    if (!apiKey) return json(503, { error: 'Translation is not switched on yet (no AI key).', map });
    if (tLimited(ip)) return json(429, { error: 'Too many translations at once. Please try again in a few minutes.', map });
    const base = env('LLM_BASE_URL', 'https://api.deepseek.com').replace(/\/+$/, '');
    let model = env('LLM_MODEL', 'deepseek-chat'); if (/reasoner|thinking/i.test(model)) model = 'deepseek-chat';
    const sys = `You translate the user interface, web pages and assistant answers of "GKH Project Champ", a project management product, into ${LANGS[code]}. The text may be in English or any other language.
Return JSON only: {"t": [ ... ]} with exactly one translation per input string, in the same order.
- Natural, professional ${LANGS[code]}, as a local software product would say it. Keep short UI labels short.
- Keep unchanged: product and brand names (GKH, Global Knowledge House, Project Champ, Champ), PMBOK, PRINCE2, Scrum, Kanban, Gantt, RACI, RAID, BOM, SWMS, SPI, CPI, EAC, BAC, emoji, numbers, money, dates, email addresses, phone numbers and URLs.
- Keep placeholders in curly braces, such as {name} and {email}, exactly as they are.
- Never add notes, quotes or explanations.`;
    try {
      const r = await fetch(`${base}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, temperature: 0.1, max_tokens: 6000, stream: false, response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: sys }, { role: 'user', content: JSON.stringify({ strings: need }) }] }) });
      if (!r.ok) return json(502, { error: 'Translation is busy right now. Please try again.', map });
      const data = await r.json();
      const out = JSON.parse(stripThinking(data?.choices?.[0]?.message?.content || '{}').replace(/^```(json)?|```$/g, '').trim());
      const arr = Array.isArray(out.t) ? out.t : [];
      if (arr.length === need.length) need.forEach((t, i) => { const v = clean(String(arr[i] ?? ''), 900); if (v) { map[t] = v; cache[hash(t)] = v; } });
      if (st) { const now = (await st.get(code, { type: 'json' }).catch(() => null)) || {}; await st.setJSON(code, { ...now, ...cache }); }
    } catch (e) {
      console.log('i18n failed: ' + e.message);
      return json(502, { error: 'Translation is unavailable right now. Please try again.', map });
    }
  }
  return json(200, { map });
}
