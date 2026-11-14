// v110: page translation for the website and the console (TEST SITE ONLY), ported from GKH Project Champ.
// Body: { mode: 'i18n', lang: 'ms', strings: ['Home', 'Services', …] }  →  { map: { 'Home': 'Utama', … } }
// Each language is translated once by the AI and cached in Netlify Blobs (store "mbs-i18n"), so it is quick after the first visit.
import { createHash } from 'node:crypto';
import { env, stripThinking, json, clean, isTestSite } from './shared.mjs';
import { store } from './admin-lib.mjs';

export const UI_LANGS = {
  ms: 'Malay (Bahasa Melayu, Malaysia)',
  zh: 'Simplified Chinese',
  ta: 'Tamil',
  my: 'Burmese (Myanmar)',
  bn: 'Bengali (Bangladesh)'
};

const calls = new Map();
function limited(ip) {   // model calls for uncached text, per address per 10 minutes
  const now = Date.now(), list = (calls.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  list.push(now); calls.set(ip, list); if (calls.size > 5000) calls.clear();
  return list.length > (Number(env('MBS_I18N_LIMIT')) || 300);
}
const hash = (s) => createHash('sha1').update(s).digest('base64url').slice(0, 16);
const isLocal = (host) => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(String(host || ''));

export async function i18n(body, ip, host, deps = {}) {
  if (!isTestSite() && !isLocal(host)) return json(403, { error: 'Languages are only switched on on the test site.' });
  const code = String(body?.lang || '');
  if (!UI_LANGS[code]) return json(400, { error: 'Unknown language' });
  const strings = [...new Set((Array.isArray(body?.strings) ? body.strings : []).map((x) => clean(String(x || ''), 700)).filter(Boolean))].slice(0, 80);
  if (!strings.length) return json(200, { map: {} });
  let st = null, cache = {};
  try { st = await (deps.store || store)('mbs-i18n'); cache = (await st.get(code, { type: 'json' })) || {}; } catch (e) { console.log('i18n cache unavailable: ' + e.message); }
  const map = {}, need = [];
  for (const t of strings) { const h = hash(t); if (cache[h] != null) map[t] = cache[h]; else need.push(t); }
  if (!need.length) return json(200, { map });
  const apiKey = env('LLM_API_KEY');
  if (!apiKey) return json(503, { error: 'Translation is not switched on yet (no AI key).', map });
  if (limited(ip)) return json(429, { error: 'Too many translations at once. Please try again in a few minutes.', map });
  const base = env('LLM_BASE_URL', 'https://api.deepseek.com').replace(/\/+$/, '');
  let model = env('LLM_MODEL', 'deepseek-chat'); if (/reasoner|thinking/i.test(model)) model = 'deepseek-chat';
  const lang = UI_LANGS[code];
  const sys = `You translate the web pages and staff console of "Modern Building Solutions" (MBS), a Sydney building, remedial, waterproofing and painting company, into ${lang}. The text may be in English or any other language.
Return JSON only: {"t": [ ... ]} with exactly one translation per input string, in the same order.
- Natural, friendly, professional ${lang}, as a local business website or software would say it. Keep short labels short.
- Keep unchanged: brand and product names (Modern Building Solutions, MBS, Mr. Fixit, Wonder Bird, FixIT), emoji, numbers, money, dates, times, email addresses, phone numbers, URLs, ABN and licence numbers.
- Keep Australian terms the reader will meet on paperwork as they are, with no brackets: ABN, GST, BAS, TFN, ATO, PAYG, SWMS, RDO, NES, HELP, STSL.
- Keep placeholders in curly braces, such as {name}, exactly as they are.
- Keep people's names, suburb names, company names, job numbers and document codes (such as MBS-000001, Q-1043, INV-0012) and file names as they are.
- Never add notes, quotes or explanations.`;
  try {
    const r = await (deps.fetch || fetch)(`${base}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, temperature: 0.1, max_tokens: 8000, stream: false, response_format: { type: 'json_object' },
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
  return json(200, { map });
}
