// GKH Project Champ: details people type in any language are kept in English for the GKH team.
// toEnglish({ first, last, message, … }) → { fields: { …in English }, original: { …only the ones that changed }, lang }
// Names and organisations are written in English letters (transliterated, not translated). Emails and phone numbers never go to the model.
import { env, clean, stripThinking } from './shared.mjs';

const SKIP = new Set(['email', 'phone']);

export async function toEnglish(input) {
  const fields = {};
  for (const [k, v] of Object.entries(input || {})) if (!SKIP.has(k) && typeof v === 'string' && v.trim()) fields[k] = v.trim();
  const out = { fields: { ...input }, original: {}, lang: '' };
  if (!Object.keys(fields).length) return out;
  // plain English already? (only ASCII letters and no common Malay/Indonesian/European words) → nothing to do
  const all = Object.values(fields).join(' ');
  if (!/[^\x00-\x7F]/.test(all) && !/\b(saya|kami|dan|untuk|ingin|mahu|yang|dengan|projek|bagaimana|je|nous|pour|avec|und|ich|wir|para|quiero|nuestro|eu|nós|tolong|terima)\b/i.test(all)) return out;
  const apiKey = env('LLM_API_KEY'); if (!apiKey) return out;
  try {
    const base = env('LLM_BASE_URL', 'https://api.deepseek.com').replace(/\/+$/, '');
    let model = env('LLM_MODEL', 'deepseek-chat'); if (/reasoner|thinking/i.test(model)) model = 'deepseek-chat';
    const r = await fetch(`${base}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ model, temperature: 0, max_tokens: 1200, stream: false, response_format: { type: 'json_object' }, messages: [
        { role: 'system', content: 'Translate each value into English for a business team that only reads English. Rules: person names (first, last) and organisation names (org): write them in English letters (transliterate; do not translate their meaning). Everything else: translate faithfully and naturally, keep numbers, dates and product names. If a value is already English, return it unchanged. Return JSON only: {"fields": {same keys: English values}, "language": "<ISO 639-1 code of the original language, or en>"}' },
        { role: 'user', content: JSON.stringify({ fields }) }] })
    });
    if (!r.ok) throw new Error('model ' + r.status);
    const d = await r.json();
    const j = JSON.parse(stripThinking(d?.choices?.[0]?.message?.content || '{}').replace(/^```(json)?|```$/g, '').trim());
    const en = (j && j.fields) || {};
    for (const k of Object.keys(fields)) {
      const v = clean(String(en[k] == null ? '' : en[k]), 2000).trim();
      if (v && v !== fields[k]) { out.original[k] = fields[k]; out.fields[k] = v; }
    }
    out.lang = Object.keys(out.original).length ? String(j.language || '').slice(0, 8) : '';
  } catch (e) { console.log('English translation skipped: ' + e.message); }
  return out;
}
