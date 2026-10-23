// POST /.netlify/functions/tts
// Body: { text: 'English reply', lang: 'ar' }
// Translates the reply with DeepSeek (unless English), then reads it out with Azure Speech.
// Returns MP3 audio. Keys stay in .env: LLM_API_KEY, AZURE_SPEECH_KEY, AZURE_SPEECH_REGION.

import { cors, json, clean, translateText, synthesize, SPEECH_LANGS, env } from '../lib/shared.mjs';

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
  if (!env('AZURE_SPEECH_KEY')) return json(503, { error: 'Voice service not set up', reason: 'AZURE_SPEECH_KEY is empty in .env' });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: 'Invalid JSON' }); }
  const lang = String(body?.lang || '');
  const text = clean(body?.text, 1500);
  if (!SPEECH_LANGS[lang] || !text) return json(400, { error: 'Unsupported language or empty text' });

  const t = await translateText(text, lang);
  if (!t.ok) {
    console.log(`[${new Date().toLocaleTimeString()}] Voice (${SPEECH_LANGS[lang].name}) not read: translation failed - ${t.reason}`);
    return json(502, { error: 'Translation failed', reason: t.reason });
  }
  const a = await synthesize(t.text, lang);
  if (!a.ok) {
    console.log(`[${new Date().toLocaleTimeString()}] Voice (${SPEECH_LANGS[lang].name}) not read: ${a.reason}`);
    return json(a.status === 503 ? 503 : 502, { error: 'Voice failed', reason: a.reason });
  }
  return new Response(a.audio, { status: 200, headers: cors({ 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' }) });
};
