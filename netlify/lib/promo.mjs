// MBS v101: 🎁 Wonder Bird weekly voucher draw.
// Website visitors (not necessarily customers) enter with their first and last name, mobile and email, then play the
// Wonder Bird game. The top 3 scores each week (Monday to Sunday, Sydney time) win MBS discount vouchers: $50, $30 and $20.
//   promo:<id>      one player (WB-000001): details, consent, a play token, every score, every voucher issued to them
//   promo-index     short summaries of every player, for fast lists and the weekly leaderboard
//   promo-seq       the running number
// The game sends scores with the player's token. Staff issue the week's vouchers in the console (Wonder Bird page).
import { randomBytes } from 'node:crypto';
import * as kv from './kv.mjs';

const str = (s, max = 300) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
const H = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const out = (status, body) => new Response(JSON.stringify(body), { status, headers: H });

export const PRIZES = [50, 30, 20];   // 1st, 2nd, 3rd of the week
export const VALID_DAYS = 90;          // a voucher can be used for 3 months

// the week a moment falls in, Sydney time: "2026-W45" (ISO week, Monday to Sunday)
export function weekOf(t = Date.now()) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
  const d = new Date(p + 'T00:00:00Z'), day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);   // the Thursday of this week decides the year
  const y = d.getUTCFullYear(), jan4 = new Date(Date.UTC(y, 0, 4));
  const wk = 1 + Math.round(((d - jan4) / 864e5 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${y}-W${String(wk).padStart(2, '0')}`;
}
export function weekRange(w) {   // Monday and Sunday of an ISO week, YYYY-MM-DD
  const m = String(w || '').match(/^(\d{4})-W(\d{2})$/); if (!m) return null;
  const jan4 = new Date(Date.UTC(+m[1], 0, 4)), mon = new Date(jan4); mon.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + (+m[2] - 1) * 7);
  const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6);
  return { from: mon.toISOString().slice(0, 10), to: sun.toISOString().slice(0, 10) };
}
const phoneOk = (p) => { const d = String(p || '').replace(/[^\d+]/g, ''); return /^(\+?61|0)4\d{8}$/.test(d) || /^(\+?61|0)[2378]\d{8}$/.test(d) || /^\+\d{8,15}$/.test(d); };
const emailOk = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(String(e || ''));

const summary = (p) => {
  const best = {}; for (const s of p.scores || []) if (!best[s.week] || s.score > best[s.week]) best[s.week] = s.score;
  return { id: p.id, first: p.first, last: p.last, phone: p.phone, email: p.email, created: p.created, lastPlayed: p.lastPlayed || 0, plays: (p.scores || []).length,
    best, top: Math.max(0, ...Object.values(best)), vouchers: (p.vouchers || []).map((v) => ({ code: v.code, week: v.week, place: v.place, amount: v.amount, status: v.status, expires: v.expires })) };
};
export async function put(p) {
  await kv.set('promo:' + p.id, p);
  await kv.update('promo-index', (x) => { x.players = x.players || {}; x.players[p.id] = summary(p); return x; }, () => ({ players: {} }));
  return p;
}
export async function index() { return (await kv.get('promo-index')) || { players: {} }; }
export async function get(id) { return /^WB-\d{6}$/.test(id || '') ? kv.get('promo:' + id) : null; }

// a visitor enters the draw (the same email again gets their own entry back, details updated)
export async function register(f) {
  const first = str(f.first, 60), last = str(f.last, 60), phone = str(f.phone, 30), email = str(f.email, 160).toLowerCase();
  if (!first || !last) return { error: 'Please give your first and last name.' };
  if (!phoneOk(phone)) return { error: 'Please check your contact number (e.g. 04xx xxx xxx).' };
  if (!emailOk(email)) return { error: 'Please check your email address.' };
  if (!f.consent) return { error: 'Please tick the box to agree to the voucher draw terms.' };
  const hit = Object.values((await index()).players || {}).find((x) => x.email === email);
  let p;
  if (hit) {
    p = await get(hit.id);
    Object.assign(p, { first, last, phone, consentAt: Date.now(), visits: (p.visits || 1) + 1, updated: Date.now() });
  } else {
    const n = await kv.update('promo-seq', (x) => ({ n: ((x && x.n) || 0) + 1 }), () => ({ n: 0 }));
    p = { id: 'WB-' + String(n.n).padStart(6, '0'), first, last, phone, email, consent: true, consentAt: Date.now(), source: str(f.source, 40) || 'website',
      token: randomBytes(16).toString('hex'), created: Date.now(), updated: Date.now(), visits: 1, scores: [], vouchers: [] };
  }
  await put(p);
  return { player: p, again: !!hit };
}
// the game sends a score with the player's token
export async function score(f) {
  const tok = str(f.token, 64);
  if (!/^[a-f0-9]{32}$/.test(tok)) return { error: 'Unknown player', code: 401 };
  const p = await get(str(f.id, 12));
  if (!p || p.token !== tok) return { error: 'Unknown player', code: 401 };
  const sc = Math.round(Number(f.score));
  if (!Number.isFinite(sc) || sc < 0 || sc > 10000000) return { error: 'That score does not look right' };
  const now = Date.now(), wk = weekOf(now);
  const recent = (p.scores || []).filter((s) => now - s.at < 60000).length;
  if (recent >= 6) return { error: 'Too many scores at once. Try again in a minute.', code: 429 };
  p.scores = (p.scores || []).concat([{ at: now, week: wk, score: sc, level: Math.max(0, Math.min(999, Math.round(Number(f.level) || 0))) }]).slice(-500);
  p.lastPlayed = now; await put(p);
  const best = Math.max(...p.scores.filter((s) => s.week === wk).map((s) => s.score));
  return { ok: true, week: wk, best, rank: await rankOf(p.id, wk) };
}
export async function leaderboard(week, n = 10) {
  const P = Object.values((await index()).players || {});
  return P.filter((p) => (p.best || {})[week] != null).map((p) => ({ id: p.id, name: p.first + ' ' + String(p.last || '').slice(0, 1) + '.', first: p.first, last: p.last, phone: p.phone, email: p.email, score: p.best[week], voucher: (p.vouchers || []).find((v) => v.week === week) || null }))
    .sort((a, b) => b.score - a.score).slice(0, n);
}
async function rankOf(id, week) { const L = await leaderboard(week, 1000); const i = L.findIndex((x) => x.id === id); return i < 0 ? 0 : i + 1; }

// staff issue the week's vouchers: the top 3 (with a score above 0) get $50, $30, $20
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function code(amount) { const b = randomBytes(6); let s = ''; for (let i = 0; i < 6; i++) s += CODE_CHARS[b[i] % CODE_CHARS.length]; return `MBS${amount}-${s}`; }
export async function issue(week, by) {
  if (!/^\d{4}-W\d{2}$/.test(week || '')) return { error: 'Pick a week' };
  if (week >= weekOf()) return { error: 'This week is not over yet. Vouchers are issued once the week has finished (after Sunday, Sydney time).' };
  const top = (await leaderboard(week, 3)).filter((x) => x.score > 0);
  if (!top.length) return { error: 'Nobody scored in that week.' };
  const done = [];
  for (let i = 0; i < top.length; i++) {
    const p = await get(top[i].id); if (!p) continue;
    if ((p.vouchers || []).some((v) => v.week === week)) { done.push({ id: p.id, skipped: true }); continue; }
    const amount = PRIZES[i], now = Date.now();
    const v = { code: code(amount), week, place: i + 1, amount, score: top[i].score, issuedAt: now, issuedBy: str(by, 60), expires: new Date(now + VALID_DAYS * 864e5).toISOString().slice(0, 10), status: 'issued', redeemedAt: 0, note: '' };
    p.vouchers = (p.vouchers || []).concat([v]); await put(p);
    done.push({ id: p.id, name: p.first + ' ' + p.last, email: p.email, phone: p.phone, ...v });
  }
  return { week, issued: done.filter((x) => !x.skipped), skipped: done.filter((x) => x.skipped).length };
}
export async function setVoucher(f, by) {
  const p = await get(str(f.id, 12)); if (!p) return { error: 'Player not found', code: 404 };
  const v = (p.vouchers || []).find((x) => x.code === str(f.code, 30)); if (!v) return { error: 'Voucher not found', code: 404 };
  const st = ['issued', 'redeemed', 'void'].includes(f.status) ? f.status : null; if (!st) return { error: 'Unknown status' };
  v.status = st; v.redeemedAt = st === 'redeemed' ? Date.now() : 0; v.note = str(f.note, 200); v.changedBy = str(by, 60);
  await put(p); return { voucher: v };
}

// console actions (Jobs & customers module)
export async function promoPost(action, body, { who, by, audit }) {
  const log = (t) => (audit ? audit(who, t) : null);
  switch (action) {
    case 'promoList': {
      const wk = /^\d{4}-W\d{2}$/.test(body.week || '') ? body.week : weekOf();
      return out(200, { players: Object.values((await index()).players || {}).sort((a, b) => b.created - a.created), week: wk, thisWeek: weekOf(), range: weekRange(wk), prizes: PRIZES, top: await leaderboard(wk, 10) });
    }
    case 'promoGet': { const p = await get(str(body.id, 12)); if (!p) return out(404, { error: 'Player not found' }); const { token, ...x } = p; return out(200, { player: x }); }
    case 'promoIssue': { const r = await issue(str(body.week, 10), by); if (r.error) return out(400, r); if (r.issued.length) await log(`Wonder Bird vouchers issued for ${r.week}: ${r.issued.map((v) => v.code + ' ' + v.name).join(', ')}`); return out(200, r); }
    case 'promoVoucher': { const r = await setVoucher(body, by); if (r.error) return out(r.code || 400, r); await log(`Wonder Bird voucher ${r.voucher.code} ${r.voucher.status}`); return out(200, r); }
    default: return null;
  }
}
