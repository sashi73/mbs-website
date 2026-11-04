// POST /.netlify/functions/promo   (v101: 🎁 Wonder Bird weekly voucher draw)
//   { action: 'enter', first, last, phone, email, consent: true, website: '' }   a visitor enters: returns their player number and
//                                                                              the link to play
//   { action: 'start', id, token }                       the game starts a run: returns the run and its seed
//   { action: 'run', id, token, run, attempts }          the run so far: the server replays it and keeps the score
//   { action: 'board', id?, token? }                     this week's top 10 and where the player stands
// The game is a page of the site (wonderbird.html, or PROMO_GAME_URL).
import { env, clean } from '../lib/shared.mjs';
import * as PR from '../lib/promo.mjs';

const GAME = () => env('PROMO_GAME_URL', '/wonderbird.html').trim().replace(/\/+$/, '');
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
      const p = r.player, play = `${GAME()}?wb=${encodeURIComponent(p.id)}.${p.token}&name=${encodeURIComponent(p.first)}`;
      return reply(200, { ok: true, id: p.id, first: p.first, again: r.again, play, week: PR.weekOf(), prizes: PR.PRIZES });
    }
    if (body.action === 'start' || body.action === 'run') {
      const r = await (body.action === 'start' ? PR.startRun(body) : PR.submitRun(body));
      if (r.error) return reply(r.code || 400, r);
      return reply(200, r);
    }
    if (body.action === 'board') return reply(200, await PR.publicBoard(body));
    if (body.action === 'verify') return reply(200, await PR.verifyVoucher(body));   // v105: is this voucher genuine?
    return reply(400, { error: 'Unknown action' });
  } catch (e) {
    console.error('Promo error:', e);
    return reply(500, { error: 'Something went wrong. Please try again.' });
  }
};
