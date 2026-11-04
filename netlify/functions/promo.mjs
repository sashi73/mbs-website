// POST /.netlify/functions/promo   (v101: 🎁 Wonder Bird weekly voucher draw)
//   { action: 'enter', first, last, phone, email, consent: true, website: '' }   a visitor enters: returns their player number and
//                                                                              the link to play
//   { action: 'score', id, token, score, level }                                 the game sends a score
// Called from the MBS website and (for scores) from the Wonder Bird game's own site (PROMO_GAME_URL).
import { env, clean } from '../lib/shared.mjs';
import * as PR from '../lib/promo.mjs';

const GAME = () => env('PROMO_GAME_URL', 'https://wonderbird-game.netlify.app').trim().replace(/\/+$/, '');
function headers(req) {
  const o = req.headers.get('origin') || '', site = env('ALLOWED_ORIGIN', '*');
  let game = ''; try { game = new URL(GAME()).origin; } catch {}
  const allow = o && (o === game || site === '*' || site.split(',').map((s) => s.trim()).includes(o)) ? o : (site === '*' ? '*' : site.split(',')[0]);
  return { 'Access-Control-Allow-Origin': allow, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin' };
}

export default async (req) => {
  const H = headers(req), reply = (status, body) => new Response(JSON.stringify(body), { status, headers: H });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: H });
  if (req.method !== 'POST') return reply(405, { error: 'Method not allowed' });
  let body; try { body = await req.json(); } catch { return reply(400, { error: 'Invalid JSON' }); }
  if (clean(body?.website)) return reply(200, { ok: true });   // honeypot
  try {
    if (body.action === 'enter') {
      const r = await PR.register({ ...body, source: 'website' });
      if (r.error) return reply(400, r);
      const p = r.player, play = `${GAME()}/?wb=${encodeURIComponent(p.id)}.${p.token}&name=${encodeURIComponent(p.first)}`;
      return reply(200, { ok: true, id: p.id, first: p.first, again: r.again, play, week: PR.weekOf(), prizes: PR.PRIZES });
    }
    if (body.action === 'score') {
      const r = await PR.score(body);
      if (r.error) return reply(r.code || 400, r);
      return reply(200, r);
    }
    return reply(400, { error: 'Unknown action' });
  } catch (e) {
    console.error('Promo error:', e);
    return reply(500, { error: 'Something went wrong. Please try again.' });
  }
};
