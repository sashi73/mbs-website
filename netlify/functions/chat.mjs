// POST /.netlify/functions/chat  (GKH Project Champ assistant "Champ")
// Body: { messages: [{ role: 'user'|'assistant', content }], lang: 'auto'|'en'|'ms'|…, where: 'site'|'console' }
// Returns: { reply }
// Answers questions on the product, project, program and portfolio management, in many languages.
// The LLM key lives only in Netlify (LLM_API_KEY; LLM_BASE_URL and LLM_MODEL optional, DeepSeek by default).

import { env, stripThinking, cors, json, clean } from '../lib/shared.mjs';
import { SYSTEM, LANGS } from '../lib/champ-kb.mjs';

const MAX_TURNS = 12, MAX_CHARS = 1200;
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
  if (limited(ip)) return json(429, { error: 'Lots of questions in a short time. Please wait a few minutes and try again.' });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: 'Invalid JSON' }); }
  const lang = LANGS[body?.lang] ? LANGS[body.lang] : LANGS.auto;
  const where = body?.where === 'console' ? 'console' : 'site';
  const messages = (Array.isArray(body?.messages) ? body.messages : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_TURNS)
    .map((m) => ({ role: m.role, content: clean(m.content, MAX_CHARS) }))
    .filter((m) => m.content);
  if (!messages.length || messages[messages.length - 1].role !== 'user') return json(400, { error: 'Send a question.' });

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
      body: JSON.stringify({ model, temperature: 0.4, max_tokens: 700, stream: false, messages: [{ role: 'system', content: SYSTEM(lang, where) }, ...messages] })
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
  const reply = stripThinking(data?.choices?.[0]?.message?.content ?? '').trim();
  return json(200, { reply: reply || `Sorry, I didn't get that. Could you ask again? You can also email ${CONTACT}.` });
};
