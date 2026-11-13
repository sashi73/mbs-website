// POST /.netlify/functions/stt?langs=en,ta,ms,fa   body: the recorded audio (audio/webm, audio/ogg, audio/mp4, audio/mpeg or audio/wav)
// → { text, lang }   Champ's ears: Azure Speech fast transcription with language identification over the candidate languages.
// Keys: AZURE_SPEECH_KEY and AZURE_SPEECH_REGION (australiaeast by default), the same as Champ's voice.
// AZURE_STT_ENDPOINT can point at another regional endpoint if fast transcription moves.
import { env, cors, json } from '../lib/shared.mjs';

// our language codes → the locale Azure listens for (pt-BR is refused by fast transcription in australiaeast; pt-PT works)
export const LOCALES = {
  en: 'en-AU', ta: 'ta-IN', ms: 'ms-MY', id: 'id-ID', fa: 'fa-IR', zh: 'zh-CN', hi: 'hi-IN', ar: 'ar-AE', vi: 'vi-VN', th: 'th-TH',
  tl: 'fil-PH', ja: 'ja-JP', ko: 'ko-KR', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', pt: 'pt-PT', sw: 'sw-KE', km: 'km-KH'   // pt: only heard in 'any' mode (Azure refuses it in a list here)
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
  const raw = String(url.searchParams.get('langs') || env('STT_LANGS', 'en,ta,ms,fa'));
  const any = raw.trim() === 'any';   // "any language": no list, Azure's multilingual model works the language out
  const langs = any ? [] : [...new Set(raw.split(',').map((s) => s.trim()).filter((s) => LOCALES[s] && s !== 'pt'))].slice(0, 10);
  if (!any && !langs.length) return json(400, { error: 'Pick at least one language to listen for.' });
  const type = (req.headers.get('content-type') || 'audio/webm').split(';')[0].trim().toLowerCase();
  if (!/^audio\/(webm|ogg|mp4|mpeg|mp3|wav|x-wav|aac)$/.test(type)) return json(415, { error: 'Unsupported audio format' });
  const audio = Buffer.from(await req.arrayBuffer());
  if (!audio.length) return json(400, { error: 'No audio received' });
  if (audio.length > MAX_BYTES) return json(413, { error: 'That recording is too long. Keep a question under a minute.' });

  const region = env('AZURE_SPEECH_REGION', 'australiaeast');
  const endpoint = env('AZURE_STT_ENDPOINT', `https://${region}.api.cognitive.microsoft.com`).replace(/\/+$/, '');
  const ext = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav' }[type] || 'webm';
  // prefer: the language the chat is in; used on its own when Azure can't tell which language a short answer (a name) was in
  const prefer = LOCALES[url.searchParams.get('prefer')] && url.searchParams.get('prefer') !== 'pt' ? url.searchParams.get('prefer') : (langs[0] || 'en');
  const formFor = (list) => {
    const f = new FormData();
    f.append('audio', new Blob([audio], { type }), 'question.' + ext);
    f.append('definition', JSON.stringify(list ? { locales: list.map((l) => LOCALES[l]), profanityFilterMode: 'Masked' } : { profanityFilterMode: 'Masked' }));
    return f;
  };
  let form = formFor(any ? null : langs);
  // Netlify stops a function after about 10 seconds, so Azure gets 8.5 s in all (one retry only if there is time)
  let r, data;
  const t0 = Date.now(), left = () => 8500 - (Date.now() - t0);
  const call = () => fetch(`${endpoint}/speechtotext/transcriptions:transcribe?api-version=2024-11-15`, { method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': key }, body: form, signal: AbortSignal.timeout(Math.max(1000, left())) });
  try {
    r = await call(); data = await r.json().catch(() => ({}));
    if ((r.status === 429 || r.status >= 500) && left() > 4000) { await new Promise((ok) => setTimeout(ok, 800)); r = await call(); data = await r.json().catch(() => ({})); }   // busy for a moment: one retry
    // "No language was identified": too short to tell the language apart (a name, a yes): hear it in the chat's language
    const noLang = () => r.status === 422 || /no language was identified/i.test(JSON.stringify(data || {}));
    if (!r.ok && noLang() && left() > 2500 && !(langs.length === 1 && langs[0] === prefer)) { form = formFor([prefer]); r = await call(); data = await r.json().catch(() => ({})); if (r.ok) langs.splice(0, langs.length, prefer); }
    if (!r.ok && noLang()) return json(200, { text: '', lang: '', empty: true, reason: 'no language identified' });
  } catch (e) {
    const slow = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    console.log(`Champ ears: ${slow ? 'Azure too slow' : 'could not reach Azure'} after ${Date.now() - t0} ms, ${audio.length} bytes, ${any ? 'any' : langs.join(',')} (${e.message})`);
    return json(slow ? 504 : 502, slow ? { error: 'That took too long to hear. Please try a shorter question, or type it.', reason: 'Azure timeout' }
      : { error: 'Voice input could not reach the speech service. Please try again.', reason: 'network: ' + String(e.message).slice(0, 100) });
  }
  if (!r.ok) {
    const why = (data && (data.message || (data.error && data.error.message))) || '';
    console.log(`Champ ears: Azure ${r.status} (region ${region}) ${audio.length} bytes ${type} ${String(why).slice(0, 200)}`);
    return json(r.status === 429 ? 429 : 502, { error: r.status === 429 ? 'The voice service is busy. Please try again shortly.' : r.status === 400 || r.status === 422 ? 'Champ could not read that recording. Please try again, a little closer to the microphone.' : 'Voice input is unavailable right now.', reason: `Azure ${r.status}: ${String(why).slice(0, 160)}` });
  }
  const text = String((data.combinedPhrases && data.combinedPhrases[0] && data.combinedPhrases[0].text) || '').trim();
  // the language heard: the one covering most of the speech
  const dur = {};
  for (const p of data.phrases || []) { const b = String(p.locale || '').split('-')[0]; if (b) dur[b] = (dur[b] || 0) + (p.durationMilliseconds || 1); }
  const top = Object.entries(dur).sort((a, b) => b[1] - a[1])[0];
  const lang = (top && (BACK[top[0]] || (top[0] === 'pt' ? 'pt' : ''))) || (langs.length === 1 ? langs[0] : '');
  if (!text) return json(200, { text: '', lang, empty: true });
  return json(200, { text: text.slice(0, 1200), lang });
};
