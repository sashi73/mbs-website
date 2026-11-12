// POST /.netlify/functions/stt?langs=en,ta,ms,fa   body: the recorded audio (audio/webm, audio/ogg, audio/mp4, audio/mpeg or audio/wav)
// → { text, lang }   Champ's ears: Azure Speech fast transcription with language identification over the candidate languages.
// Keys: AZURE_SPEECH_KEY and AZURE_SPEECH_REGION (australiaeast by default), the same as Champ's voice.
// AZURE_STT_ENDPOINT can point at another regional endpoint if fast transcription moves.
import { env, cors, json } from '../lib/shared.mjs';

// our language codes → the locale Azure listens for (pt-BR is refused by fast transcription in australiaeast; pt-PT works)
export const LOCALES = {
  en: 'en-AU', ta: 'ta-IN', ms: 'ms-MY', id: 'id-ID', fa: 'fa-IR', zh: 'zh-CN', hi: 'hi-IN', ar: 'ar-AE', vi: 'vi-VN', th: 'th-TH',
  tl: 'fil-PH', ja: 'ja-JP', ko: 'ko-KR', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', pt: 'pt-PT', sw: 'sw-KE'
};
const BACK = Object.fromEntries(Object.entries(LOCALES).map(([k, v]) => [v.split('-')[0], k]));
const MAX_BYTES = 4 * 1024 * 1024;   // about 2 minutes of speech; a question is a few seconds

const hits = new Map();
function limited(ip) {
  const now = Date.now(), list = (hits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  list.push(now); hits.set(ip, list); if (hits.size > 5000) hits.clear();
  return list.length > 30;
}

export default async (req, context) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
  const key = env('AZURE_SPEECH_KEY');
  if (!key) return json(503, { error: 'Voice input is not switched on yet.', reason: 'AZURE_SPEECH_KEY is empty' });
  const ip = (context && context.ip) || req.headers.get('x-nf-client-connection-ip') || 'local';
  if (limited(ip)) return json(429, { error: 'Lots of voice questions at once. Please wait a few minutes.' });

  const url = new URL(req.url);
  const langs = [...new Set(String(url.searchParams.get('langs') || env('STT_LANGS', 'en,ta,ms,fa')).split(',').map((s) => s.trim()).filter((s) => LOCALES[s]))].slice(0, 10);
  if (!langs.length) return json(400, { error: 'Pick at least one language to listen for.' });
  const type = (req.headers.get('content-type') || 'audio/webm').split(';')[0].trim().toLowerCase();
  if (!/^audio\/(webm|ogg|mp4|mpeg|mp3|wav|x-wav|aac)$/.test(type)) return json(415, { error: 'Unsupported audio format' });
  const audio = Buffer.from(await req.arrayBuffer());
  if (!audio.length) return json(400, { error: 'No audio received' });
  if (audio.length > MAX_BYTES) return json(413, { error: 'That recording is too long. Keep a question under a minute.' });

  const region = env('AZURE_SPEECH_REGION', 'australiaeast');
  const endpoint = env('AZURE_STT_ENDPOINT', `https://${region}.api.cognitive.microsoft.com`).replace(/\/+$/, '');
  const ext = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav' }[type] || 'webm';
  const form = new FormData();
  form.append('audio', new Blob([audio], { type }), 'question.' + ext);
  form.append('definition', JSON.stringify({ locales: langs.map((l) => LOCALES[l]), profanityFilterMode: 'Masked' }));
  let r, data;
  const call = () => fetch(`${endpoint}/speechtotext/transcriptions:transcribe?api-version=2024-11-15`, { method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': key }, body: form });
  try {
    r = await call(); data = await r.json().catch(() => ({}));
    if (r.status === 429) { await new Promise((ok) => setTimeout(ok, 1200)); r = await call(); data = await r.json().catch(() => ({})); }   // busy for a moment: one retry
  } catch (e) {
    console.log(`Champ ears: could not reach Azure (${e.message})`);
    return json(502, { error: 'Voice input is unavailable right now.' });
  }
  if (!r.ok) {
    const why = (data && (data.message || (data.error && data.error.message))) || '';
    console.log(`Champ ears: Azure ${r.status} (region ${region}) ${String(why).slice(0, 200)}`);
    return json(r.status === 429 ? 429 : 502, { error: r.status === 429 ? 'The voice service is busy. Please try again shortly.' : 'Voice input is unavailable right now.', reason: `Azure ${r.status}: ${String(why).slice(0, 160)}` });
  }
  const text = String((data.combinedPhrases && data.combinedPhrases[0] && data.combinedPhrases[0].text) || '').trim();
  // the language heard: the one covering most of the speech
  const dur = {};
  for (const p of data.phrases || []) { const b = String(p.locale || '').split('-')[0]; if (b) dur[b] = (dur[b] || 0) + (p.durationMilliseconds || 1); }
  const top = Object.entries(dur).sort((a, b) => b[1] - a[1])[0];
  const lang = (top && BACK[top[0]]) || (langs.length === 1 ? langs[0] : '');
  if (!text) return json(200, { text: '', lang, empty: true });
  return json(200, { text: text.slice(0, 1200), lang });
};
