// Shared DeepSeek helpers for the console: one JSON call with a token cap, and a daily count of AI questions + tokens
// (shared by the SQL wizard "AI query" and the planner "Ask AI" on risks and issues).
import { env, stripThinking } from './shared.mjs';
import * as kv from './kv.mjs';
import { parts } from './calendar.mjs';

export function sydToday(now = Date.now()) { const p = parts(now); return `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; }
export async function checkLimit() {
  const t = await usageToday();
  if (t.questions >= t.limit) { const e = new Error(`Daily limit reached: ${t.limit} AI questions today. It resets at midnight (or raise AI_QUERY_DAILY_LIMIT in Netlify).`); e.code = 429; e.mbs = true; throw e; }
  return t;
}
export function llmSetup() {
  const key = env('LLM_API_KEY');
  if (!key) return null;
  const base = env('LLM_BASE_URL', 'https://api.deepseek.com').replace(/\/+$/, '');
  let model = env('LLM_MODEL', 'deepseek-chat'); if (/reasoner|thinking/i.test(model)) model = 'deepseek-chat';
  return { key, base, model };
}
// Token limits (DeepSeek bills per token): the reply is capped (AI_QUERY_MAX_TOKENS, 200-1000, default 500 for writing
// the query; the answer gets 200), the instructions are kept short, and AI_QUERY_DAILY_LIMIT questions a day (default 50).
export const tokCap = () => Math.max(200, Math.min(1000, Number(env('AI_QUERY_MAX_TOKENS', '500')) || 500));
export const dayLimit = () => Math.max(1, Number(env('AI_QUERY_DAILY_LIMIT', '50')) || 50);
// Netlify stops a normal function after about 10 seconds (26 s on Pro if Netlify raises it), so the AI gets 8.5 s by default
// and the console retries once. Raise AI_TIMEOUT_SECONDS only if your Netlify functions are allowed to run longer.
export const aiTimeout = () => Math.max(3000, Math.min(55000, (Number(env('AI_TIMEOUT_SECONDS', '8.5')) || 8.5) * 1000));
// v56: DeepSeek retired the "deepseek-chat" name in 2026 (now "deepseek-flash" and "deepseek-v4-pro"). If the model name or the
// requested length is refused, try once more with deepseek-flash / the largest length the model allows, and remember it.
let modelOverride = '';
export function llmModel() { return modelOverride || (llmSetup() || {}).model || ''; }
// a JSON answer cut off by the token limit: keep everything up to the last complete value and close the brackets
export function repairJson(txt) {
  const s = String(txt || '');
  for (let end = s.length, tries = 0; end > 1 && tries < 400; tries++) {
    const cut = Math.max(s.lastIndexOf('}', end - 1), s.lastIndexOf(']', end - 1));
    if (cut < 1) break;
    const part = s.slice(0, cut + 1).replace(/,\s*$/, '');
    const stack = []; let inStr = false, esc = false;
    for (const ch of part) {
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true; else if (ch === '{' || ch === '[') stack.push(ch); else if (ch === '}' || ch === ']') stack.pop();
    }
    if (!inStr) { try { return JSON.parse(part + stack.reverse().map((c) => (c === '{' ? '}' : ']')).join('')); } catch {} }
    end = cut;
  }
  return null;
}
export async function llmJson(messages, { maxTokens = 500, timeoutMs = aiTimeout(), temperature = 0.1 } = {}) {
  const L = llmSetup();
  if (!L) { const e = new Error('AI is not set up yet: add LLM_API_KEY (DeepSeek) in Netlify.'); e.code = 503; e.mbs = true; throw e; }
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const call = (model, max) => fetch(`${L.base}/chat/completions`, { method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${L.key}` },
    body: JSON.stringify({ model, temperature, stream: false, max_tokens: max, response_format: { type: 'json_object' }, messages }) });
  try {
    let model = modelOverride || L.model, max = maxTokens, r = await call(model, max);
    for (let retry = 0; !r.ok && r.status === 400 && retry < 2; retry++) {
      let why = ''; try { why = ((await r.clone().json()).error || {}).message || ''; } catch {}
      const range = String(why).match(/max_tokens[^\d]*\[?\s*\d+\s*,\s*(\d+)\s*\]?/i);
      if (/max_tokens/i.test(why) && max > 8192) { max = range ? Math.max(1000, Number(range[1])) : 8192; r = await call(model, max); continue; }
      if (/model/i.test(why) && model !== 'deepseek-flash' && /^deepseek/i.test(model)) { model = 'deepseek-flash'; modelOverride = model; r = await call(model, max); continue; }
      break;
    }
    if (!r.ok) { let why = ''; try { why = ((await r.json()).error || {}).message || ''; } catch {} throw new Error('DeepSeek error ' + r.status + (r.status === 401 ? ' (the LLM_API_KEY is not accepted)' : r.status === 402 ? ' (the DeepSeek account is out of credit)' : r.status === 429 ? ' (too many requests, wait a moment)' : why ? ' (' + String(why).slice(0, 120) + ')' : '')); }
    const j = await r.json();
    const txt = stripThinking(j?.choices?.[0]?.message?.content ?? '').replace(/^```(?:json)?\s*|\s*```$/g, '');
    const used = Number(j?.usage?.total_tokens) || Math.round(JSON.stringify(messages).length / 3.6 + txt.length / 3.6);
    const cut = j?.choices?.[0]?.finish_reason === 'length';
    let data; try { data = JSON.parse(txt); } catch {
      data = cut ? repairJson(txt) : null;
      if (!data || typeof data !== 'object') throw new Error(cut ? 'The AI answer was cut off by the token limit. Ask a simpler question.' : 'The AI gave an answer that could not be read.');
    }
    if (cut && data && typeof data === 'object') Object.defineProperty(data, '_cutOff', { value: true, enumerable: false });
    return { data, used, cutOff: cut, maxTokens: max, model };
  } catch (e) {
    if (e.mbs) throw e;   // our own message (note: a timeout's AbortError also has a numeric .code, so don't test .code)
    const err = new Error(/abort/i.test(e.message) || e.name === 'AbortError' ? 'The AI is slow right now and took too long to answer.' : /cut off|could not be read|DeepSeek error/.test(e.message) ? e.message : 'The AI could not be reached (' + e.message + ').');
    err.code = /abort/i.test(e.message) || e.name === 'AbortError' ? 504 : 502; err.mbs = true;
    throw err;
  } finally { clearTimeout(timer); }
}
// questions and tokens used per day (kept 60 days), stored with the jobs
export async function usage(addQuestion, addTokens) {
  const day = sydToday();
  let u = null;
  try {
    u = await kv.update('ai-usage', (x) => {
      x.days = x.days || {};
      const d = x.days[day] || { questions: 0, tokens: 0 };
      d.questions += addQuestion ? 1 : 0; d.tokens += addTokens || 0; x.days[day] = d;
      x.days = Object.fromEntries(Object.keys(x.days).sort().slice(-60).map((k) => [k, x.days[k]]));
      return x;
    }, () => ({ days: {} }));
  } catch { return { questions: 0, tokens: 0, limit: dayLimit() }; }
  return { ...(u.days[day] || { questions: 0, tokens: 0 }), limit: dayLimit() };
}
export async function usageToday() { const u = await kv.get('ai-usage'); const d = (u && u.days && u.days[sydToday()]) || { questions: 0, tokens: 0 }; return { ...d, limit: dayLimit() }; }


// quick check from the console: is the key set, does DeepSeek answer, how fast
export async function ping() {
  const L = llmSetup();
  if (!L) return { ok: false, reason: 'LLM_API_KEY is not set in Netlify, so the AI is switched off.' };
  const t0 = Date.now();
  try {
    const { data, used } = await llmJson([{ role: 'system', content: 'Reply with JSON only: {"ok": true}' }, { role: 'user', content: 'ping' }], { maxTokens: 10 });
    await usage(false, used);
    return { ok: !!data.ok, ms: Date.now() - t0, model: L.model, host: L.base.replace(/^https?:\/\//, ''), timeoutSec: aiTimeout() / 1000 };
  } catch (e) { return { ok: false, ms: Date.now() - t0, model: L.model, host: L.base.replace(/^https?:\/\//, ''), timeoutSec: aiTimeout() / 1000, reason: e.message }; }
}
