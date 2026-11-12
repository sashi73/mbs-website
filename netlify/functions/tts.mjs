// POST /.netlify/functions/tts   Body: { text, lang }   →   MP3 audio of Champ reading the text aloud.
// Azure Speech: AZURE_SPEECH_KEY in Netlify; AZURE_SPEECH_REGION defaults to australiaeast (Australia East).
// The text is already in the right language (Champ answers in it), so there is no translation step here.
import { env, cors, json, clean } from '../lib/shared.mjs';

// Champ's voice in each language (Azure neural voices). Kinyarwanda has no Azure voice yet.
export const VOICES = {
  en: ['en-AU', 'en-AU-NatashaNeural'], ms: ['ms-MY', 'ms-MY-YasminNeural'], id: ['id-ID', 'id-ID-GadisNeural'], ta: ['ta-MY', 'ta-MY-KaniNeural'],
  zh: ['zh-CN', 'zh-CN-XiaoxiaoNeural'], hi: ['hi-IN', 'hi-IN-SwaraNeural'], ar: ['ar-AE', 'ar-AE-FatimaNeural'], fa: ['fa-IR', 'fa-IR-DilaraNeural'],
  vi: ['vi-VN', 'vi-VN-HoaiMyNeural'], th: ['th-TH', 'th-TH-PremwadeeNeural'], tl: ['fil-PH', 'fil-PH-BlessicaNeural'], ja: ['ja-JP', 'ja-JP-NanamiNeural'],
  ko: ['ko-KR', 'ko-KR-SunHiNeural'], es: ['es-ES', 'es-ES-ElviraNeural'], fr: ['fr-FR', 'fr-FR-DeniseNeural'], de: ['de-DE', 'de-DE-KatjaNeural'],
  pt: ['pt-BR', 'pt-BR-FranciscaNeural'], sw: ['sw-KE', 'sw-KE-ZuriNeural']
};
const xml = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
// what to say: no markdown symbols, links read as their name
const speakable = (t) => String(t).replace(/\*\*?|__|`/g, '').replace(/^\s*[-•]\s+/gm, '').replace(/https?:\/\/\S+/g, 'the link').replace(/\[\[lang:[a-z]+\]\]/gi, '').trim();

const hits = new Map();
function limited(ip) {
  const now = Date.now(), list = (hits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  list.push(now); hits.set(ip, list); if (hits.size > 5000) hits.clear();
  return list.length > 40;
}

export default async (req, context) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
  const key = env('AZURE_SPEECH_KEY');
  if (!key) return json(503, { error: 'Champ’s voice is not switched on yet.', reason: 'AZURE_SPEECH_KEY is empty' });
  const ip = (context && context.ip) || req.headers.get('x-nf-client-connection-ip') || 'local';
  if (limited(ip)) return json(429, { error: 'Lots of voice requests. Please wait a few minutes.' });
  let body; try { body = await req.json(); } catch { return json(400, { error: 'Invalid JSON' }); }
  const lang = String(body?.lang || 'en'), v = VOICES[lang];
  const text = speakable(clean(body?.text, 1600));
  if (!v) return json(400, { error: 'No voice for this language yet.' });
  if (!text) return json(400, { error: 'Nothing to read.' });
  const region = env('AZURE_SPEECH_REGION', 'australiaeast');
  const base = env('AZURE_SPEECH_BASE', `https://${region}.tts.speech.microsoft.com`);
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${v[0]}"><voice name="${v[1]}"><prosody rate="${xml(env('VOICE_RATE', '+5%'))}">${xml(text)}</prosody></voice></speak>`;
  try {
    const r = await fetch(`${base}/cognitiveservices/v1`, { method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3', 'User-Agent': 'GKH-Project-Champ' }, body: ssml });
    if (!r.ok) {
      console.log(`Champ voice: Azure error ${r.status} (region ${region})`);
      return json(r.status === 429 ? 429 : 502, { error: r.status === 429 ? 'The voice service is busy. Please try again shortly.' : 'The voice service is unavailable right now.', reason: `Azure ${r.status}` });
    }
    return new Response(Buffer.from(await r.arrayBuffer()), { status: 200, headers: cors({ 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' }) });
  } catch (e) {
    console.log(`Champ voice: could not reach Azure (${e.message})`);
    return json(502, { error: 'The voice service is unavailable right now.' });
  }
};
