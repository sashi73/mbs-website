// v47: Sub-contractors ("subbies"): plumbers, sparkies, cleaners and the other trades MBS hires in.
//   sub:<id>     one sub-contractor: business, contact, trade(s), licence, insurance, rates, areas, rating, status
//   sub-index    short summaries for fast lists, with each one's compliance (licence and insurance dates)
// Compliance: a NSW contractor licence, public liability and workers comp (or a sole trader's personal cover),
// a white card and SWMS. Anything expired, expiring within 30 days or missing is flagged so nobody goes on site uncovered.
import * as kv from './kv.mjs';
import { env } from './shared.mjs';
import { parts } from './calendar.mjs';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const str = (s, max = 300) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
const ymd = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : '');
const today = () => { const p = parts(Date.now()); return `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; };
const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const H = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const out = (status, body) => new Response(JSON.stringify(body), { status, headers: H });

// trade categories. lic: a NSW licence is needed for this work (Fair Trading, or SafeWork for asbestos and demolition).
export const TRADES = [
  ['plumber', 'Plumber', true], ['electrician', 'Electrician (sparkie)', true], ['gasfitter', 'Gas fitter', true], ['aircon', 'Air conditioning & refrigeration', true],
  ['carpenter', 'Carpenter', true], ['builder', 'Builder', true], ['tiler', 'Tiler', true], ['waterproofer', 'Waterproofer', true], ['plasterer', 'Plasterer & gyprocker', true],
  ['painter', 'Painter', true], ['roofer', 'Roofer & guttering', true], ['concreter', 'Concreter', true], ['bricklayer', 'Bricklayer & blocklayer', true], ['renderer', 'Renderer', true],
  ['glazier', 'Glazier (glass & windows)', true], ['joiner', 'Cabinet maker & joiner', true], ['flooring', 'Flooring (timber, vinyl, carpet)', true], ['fencer', 'Fencer', true],
  ['landscaper', 'Landscaper', true], ['steel', 'Steel fixer & welder', false], ['scaffolder', 'Scaffolder', true], ['excavation', 'Excavation & earthmoving', false],
  ['demolition', 'Demolition', true], ['asbestos', 'Asbestos removal', true], ['waste', 'Rubbish removal & skip bins', false], ['cleaner', 'Cleaner (builders clean)', false],
  ['pest', 'Pest control', true], ['locksmith', 'Locksmith', false], ['handyman', 'Handyman', false], ['surveyor', 'Surveyor', false], ['certifier', 'Certifier & inspector', true],
  ['engineer', 'Engineer', false], ['other', 'Other', false]];
const TR = Object.fromEntries(TRADES.map((t) => [t[0], t]));
export const STATUS = ['Preferred', 'Approved', 'On trial', 'On hold', 'Do not use'];

// one document's state: ok, due (within 30 days), expired, missing, or n/a
function doc(expiry, needed, now) {
  if (!expiry) return needed ? 'missing' : 'n/a';
  if (expiry < now) return 'expired';
  if (expiry <= addDays(now, 30)) return 'due';
  return 'ok';
}
export function compliance(s, now = today()) {
  const lic = doc(s.licence && s.licence.expiry, !!(TR[s.trade] || [])[2], now);
  const pl = doc(s.insurance && s.insurance.expiry, true, now);
  const wc = s.workersComp && s.workersComp.soleTrader ? 'n/a' : doc(s.workersComp && s.workersComp.expiry, true, now);
  const list = [['Licence', lic], ['Public liability', pl], ['Workers comp', wc]];
  if (!s.whiteCard) list.push(['White card', 'missing']);
  if (!s.swms) list.push(['SWMS', 'missing']);
  const worst = list.some((x) => x[1] === 'expired') ? 'expired' : list.some((x) => x[1] === 'missing') ? 'missing' : list.some((x) => x[1] === 'due') ? 'due' : 'ok';
  return { lic, pl, wc, worst, problems: list.filter((x) => x[1] !== 'ok' && x[1] !== 'n/a').map((x) => x[0] + ': ' + x[1]) };
}
const summary = (s) => ({ id: s.id, business: s.business, contact: s.contact, trade: s.trade, trades: s.trades, phone: s.phone, email: s.email, suburb: s.suburb, areas: s.areas,
  status: s.status, rating: s.rating, rate: s.rate, callout: s.callout, licenceNo: (s.licence || {}).number || '', licenceExpiry: (s.licence || {}).expiry || '',
  plExpiry: (s.insurance || {}).expiry || '', wcExpiry: (s.workersComp || {}).expiry || '', soleTrader: !!(s.workersComp || {}).soleTrader, whiteCard: !!s.whiteCard, swms: !!s.swms,
  lastUsed: s.lastUsed || '', archived: !!s.archived });

function cleanSub(f, old = {}) {
  const t = TR[f.trade] ? f.trade : 'other';
  return { ...old,
    business: str(f.business, 120), contact: str(f.contact, 80), trade: t,
    trades: (Array.isArray(f.trades) ? f.trades : String(f.trades || '').split(/\s*,\s*/)).filter((x) => TR[x] && x !== t).slice(0, 8),
    phone: str(f.phone, 40), phone2: str(f.phone2, 40), email: str(f.email, 160), address: str(f.address, 200), suburb: str(f.suburb, 60),
    abn: str(f.abn, 20).replace(/[^\d ]/g, ''), gst: !!f.gst,
    licence: { number: str((f.licence || {}).number, 40), class: str((f.licence || {}).class, 120), expiry: ymd((f.licence || {}).expiry) },
    insurance: { insurer: str((f.insurance || {}).insurer, 80), policy: str((f.insurance || {}).policy, 40), cover: r2((f.insurance || {}).cover), expiry: ymd((f.insurance || {}).expiry) },
    workersComp: { policy: str((f.workersComp || {}).policy, 40), expiry: ymd((f.workersComp || {}).expiry), soleTrader: !!(f.workersComp || {}).soleTrader },
    whiteCard: str(f.whiteCard, 40), swms: !!f.swms,
    rate: r2(f.rate), callout: r2(f.callout), afterHours: r2(f.afterHours), rateNote: str(f.rateNote, 200), terms: str(f.terms, 80),
    areas: str(f.areas, 300), availability: str(f.availability, 120),
    status: STATUS.includes(f.status) ? f.status : 'Approved', rating: Math.max(0, Math.min(5, Math.round(Number(f.rating) || 0))),
    lastUsed: ymd(f.lastUsed), notes: str(f.notes, 2000), archived: !!f.archived };
}

async function index() { return (await kv.get('sub-index')) || { subs: {} }; }
export async function saveSub(f, by) {
  if (!str(f.business, 120)) return { error: 'Give the business a name' };
  if (f.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(str(f.email, 160))) return { error: 'That email address does not look right' };
  let id = /^SC-\d{3,5}$/.test(f.id || '') ? f.id : '';
  const old = id ? (await kv.get('sub:' + id)) || {} : {};
  if (!id) { const n = await kv.update('sub-seq', (x) => ({ n: ((x && x.n) || 0) + 1 }), () => ({ n: 0 })); id = 'SC-' + String(n.n).padStart(3, '0'); }
  const s = { ...cleanSub(f, old), id, created: old.created || Date.now(), updated: Date.now(), by: str(by, 60) };
  await kv.set('sub:' + id, s);
  await kv.update('sub-index', (x) => { x.subs = x.subs || {}; x.subs[id] = summary(s); return x; }, () => ({ subs: {} }));
  return { sub: s };
}
export async function list() {
  const idx = await index(), now = today();
  const subs = Object.values(idx.subs || {}).map((s) => ({ ...s, comp: compliance({ trade: s.trade, licence: { expiry: s.licenceExpiry }, insurance: { expiry: s.plExpiry },
    workersComp: { expiry: s.wcExpiry, soleTrader: s.soleTrader }, whiteCard: s.whiteCard, swms: s.swms }, now) })).sort((a, b) => (a.business.toLowerCase() > b.business.toLowerCase() ? 1 : -1));
  return { subs, trades: TRADES.map((t) => ({ key: t[0], name: t[1], licence: t[2] })), statuses: STATUS, today: now };
}

// test data (test site only), like the stock and supplier test data
async function testLoad(body, by) {
  if (String(env('SITE_ENV', '')).trim().toLowerCase() !== 'test') return { error: 'Test data can only be loaded on the test site.', code: 403 };
  const list = (Array.isArray(body.subs) ? body.subs : []).slice(0, 30), now = today(), ids = [];
  for (const f of list) {
    const d = (n) => (n == null || n === '' ? '' : addDays(now, Number(n)));
    const r = await saveSub({ ...f, licence: { ...(f.licence || {}), expiry: d((f.licence || {}).expiryDays) }, insurance: { ...(f.insurance || {}), expiry: d((f.insurance || {}).expiryDays) },
      workersComp: { ...(f.workersComp || {}), expiry: d((f.workersComp || {}).expiryDays) }, lastUsed: d(f.lastUsedDays) }, by);
    if (r.sub) ids.push(r.sub.id);
  }
  return { ids };
}

export async function subPost(action, body, { who, by, audit }) {
  const log = (t) => (audit ? audit(who, t) : null);
  switch (action) {
    case 'subList': return out(200, await list());
    case 'subGet': {
      const s = await kv.get('sub:' + str(body.id, 10));
      return s ? out(200, { sub: s, comp: compliance(s), trades: TRADES.map((t) => ({ key: t[0], name: t[1], licence: t[2] })), statuses: STATUS }) : out(404, { error: 'Sub-contractor not found' });
    }
    case 'subSave': {
      const r = await saveSub(body.sub || {}, by);
      if (r.error) return out(400, r);
      await log(`Sub-contractor saved: ${r.sub.id} ${r.sub.business}`);
      return out(200, { sub: r.sub, comp: compliance(r.sub) });
    }
    case 'subTestLoad': { const r = await testLoad(body, by); if (r.error) return out(r.code || 400, r); await log(`Test data loaded: ${r.ids.length} sub-contractors`); return out(200, r); }
    default: return null;
  }
}
