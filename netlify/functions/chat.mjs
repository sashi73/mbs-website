// POST /.netlify/functions/chat
// Body: { messages: [{ role: 'user'|'assistant', content: '...' }, ...] }
// Returns: { reply: '...', lead: {...} | null }
//
// The LLM key lives in the LLM_API_KEY environment variable, never in the website.

import { env, SYSTEM_PROMPT, EXPERT_PROMPT, SCOPE_PROMPT, SCOPE_MAX, stripThinking, cors, json, clean, translateText } from '../lib/shared.mjs';

const MAX_TURNS = 16;      // only the most recent messages are sent to the model
const MAX_CHARS = 1000;    // per message

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const apiKey = env('LLM_API_KEY');
  if (!apiKey) {
    console.log(`\n[${new Date().toLocaleTimeString()}] AI question NOT answered - LLM_API_KEY is empty in .env`);
    return json(503, { error: 'Chat is not configured yet.', reason: 'LLM_API_KEY is empty in .env (add your DeepSeek key, then restart the site).' });
  }

  let body;
  try { body = await req.json(); } catch { return json(400, { error: 'Invalid JSON' }); }

  if (body?.mode === 'scope') return scope(body, apiKey);
  if (body?.mode === 'translate') return translate(body);

  const history = Array.isArray(body?.messages) ? body.messages : [];
  const messages = history
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_TURNS)
    .map((m) => ({ role: m.role, content: clean(m.content, MAX_CHARS) }))
    .filter((m) => m.content);

  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return json(400, { error: 'Send at least one user message.' });
  }

  const base = env('LLM_BASE_URL', 'https://api.deepseek.com').replace(/\/+$/, '');
  // Thinking OFF: "deepseek-chat" is DeepSeek's non-thinking mode. A reasoning model is swapped for it.
  let model = env('LLM_MODEL', 'deepseek-chat');
  if (/reasoner|thinking/i.test(model)) model = 'deepseek-chat';
  const expert = body?.mode === 'expert';
  // (expert answers are one natural paragraph, about 110 words, so 500 tokens is plenty)
  const maxTokens = Math.min(Number(env('LLM_MAX_TOKENS', '500')) || 500, 500);

  let data;
  try {
    const r = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: expert ? 0.3 : 0.4,
        max_tokens: maxTokens,
        stream: false,
        messages: [{ role: 'system', content: expert ? EXPERT_PROMPT : SYSTEM_PROMPT }, ...(expert ? messages.slice(-6) : messages)]
      })
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      const reason =
        r.status === 401 ? 'DeepSeek rejected the API key (401). Check LLM_API_KEY in .env: no quotes or spaces.' :
        r.status === 402 ? 'DeepSeek says the account has no balance (402). Top up at platform.deepseek.com.' :
        r.status === 429 ? 'Too many requests to DeepSeek (429). Wait a moment and try again.' :
        r.status === 400 ? `DeepSeek did not accept the request (400): ${text.slice(0, 160)}` :
        `DeepSeek error ${r.status}: ${text.slice(0, 160)}`;
      console.log(`\n[${new Date().toLocaleTimeString()}] AI question NOT answered - ${reason}`);
      return json(502, { error: 'The assistant is busy. Please call 0420 494 990.', reason });
    }
    data = await r.json();
  } catch (e) {
    const reason = `Could not reach DeepSeek at ${base} (${e.message}). Check your internet connection and LLM_BASE_URL.`;
    console.log(`\n[${new Date().toLocaleTimeString()}] AI question NOT answered - ${reason}`);
    return json(502, { error: 'The assistant is unavailable. Please call 0420 494 990.', reason });
  }
  console.log(`[${new Date().toLocaleTimeString()}] AI answered a ${expert ? 'repair' : 'general'} question (${model})`);

  // Only the final answer is used; any reasoning_content field is ignored.
  let reply = stripThinking(data?.choices?.[0]?.message?.content ?? '');

  // Pull out the structured lead the model adds once it has enough details.
  let lead = null;
  const m = reply.match(/<<LEAD>>([\s\S]*?)<<END>>/);
  if (m) {
    try { lead = JSON.parse(m[1]); } catch { lead = null; }
    reply = reply.replace(m[0], '').trim();
  }
  if (lead && !(clean(lead.phone) || clean(lead.email))) lead = null; // need a way to contact them

  if (!reply) reply = 'Thanks! The quickest way to get help is to call 0420 494 990.';
  return json(200, { reply, lead });
};

// ---- Quote scoping: the next smart question for this job, or done ----
// Body: { mode: 'scope', job: 'Painting: whole house inside', qa: [{ q, a }, ...] }
// Returns: { question, options } or { done: true }
async function scope(body, apiKey) {
  const job = clean(body?.job, 600);
  const qa = (Array.isArray(body?.qa) ? body.qa : []).slice(0, SCOPE_MAX)
    .map((x) => ({ q: clean(x && x.q, 200), a: clean(x && x.a, 300) })).filter((x) => x.q);
  if (!job || qa.length >= SCOPE_MAX) return json(200, { done: true });

  const base = env('LLM_BASE_URL', 'https://api.deepseek.com').replace(/\/+$/, '');
  let model = env('LLM_MODEL', 'deepseek-chat');
  if (/reasoner|thinking/i.test(model)) model = 'deepseek-chat';
  const user =
    `The customer's job: ${job}\n\n` +
    (qa.length ? 'Questions already asked and answered:\n' + qa.map((x, i) => `${i + 1}. ${x.q}\n   Answer: ${x.a}`).join('\n') + '\n\n' : 'No questions asked yet.\n\n') +
    `Questions asked so far: ${qa.length} of ${SCOPE_MAX}. Reply in json with the next question, or {"done": true} if you have enough.`;
  try {
    const r = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model, temperature: 0.2, stream: false,
        max_tokens: Math.min(Number(env('LLM_MAX_TOKENS', '500')) || 500, 200),
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: SCOPE_PROMPT }, { role: 'user', content: user }]
      })
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      const reason = r.status === 401 ? 'DeepSeek rejected the API key (401). Check LLM_API_KEY in .env.'
        : r.status === 402 ? 'DeepSeek account has no balance (402).'
        : `DeepSeek error ${r.status} while preparing quote questions: ${text.slice(0, 160)}`;
      console.log(`\n[${new Date().toLocaleTimeString()}] ${reason}`);
      return json(502, { done: true, reason });
    }
    const data = await r.json();
    const raw = stripThinking(data?.choices?.[0]?.message?.content ?? '');
    let out = {};
    try { out = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)); } catch { out = {}; }
    const question = clean(out.question, 200);
    if (out.done || !question) {
      console.log(`[${new Date().toLocaleTimeString()}] AI quote questions finished (${qa.length} asked)`);
      return json(200, { done: true });
    }
    // Never ask the same thing twice
    const seen = (t) => t.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
    if (qa.some((x) => seen(x.q) === seen(question))) return json(200, { done: true });
    const options = (Array.isArray(out.options) ? out.options : []).map((o) => clean(o, 30)).filter(Boolean).slice(0, 5);
    console.log(`[${new Date().toLocaleTimeString()}] AI quote question ${qa.length + 1}: ${question}`);
    return json(200, { question, options });
  } catch (e) {
    console.log(`\n[${new Date().toLocaleTimeString()}] Quote questions skipped - could not reach DeepSeek (${e.message})`);
    return json(502, { done: true, reason: `Could not reach DeepSeek (${e.message})` });
  }
}

// ---- Read-aloud translation (text only, used when the device has its own voice) ----
// Body: { mode: 'translate', lang: 'pl', text: '...' }   Returns: { text }
async function translate(body) {
  const r = await translateText(body?.text, String(body?.lang || ''));
  if (!r.ok) {
    console.log(`[${new Date().toLocaleTimeString()}] Read-aloud translation failed: ${r.reason}`);
    return json(502, { error: 'Translation failed', reason: r.reason });
  }
  return json(200, { text: r.text });
}
