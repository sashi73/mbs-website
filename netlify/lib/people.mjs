// MBS Console v86: People: employees and contractors (MBS's own team, not sub-contractor businesses).
// Like Subbies: details, role and trade, rates (what an hour costs MBS, and what it is charged out at), tickets and licences
// with expiry checks (white card, trade licence, driver's licence, first aid, working at heights ...), insurance for contractors,
// status and rating. Linked to the project plans: the people a plan names as resources, story owners, stakeholders or the
// project manager show up as that person's assignments and workload. Users & access: only people in this register can log in.
// Payroll details (tax file number, bank, super, date of birth) are NOT kept here: they stay in the payroll system.
import * as kv from './kv.mjs';
import * as P from './plan.mjs';
import { env } from './shared.mjs';
import { TRADES } from './subbies.mjs';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const str = (s, max = 300) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
const ymd = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : '');
const sydToday = () => new Date(Date.now() + 11 * 3600000).toISOString().slice(0, 10);
const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const H = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const out = (status, body) => new Response(JSON.stringify(body), { status, headers: H });

export const TYPES = ['Employee', 'Contractor'];
export const EMPLOYMENT = ['Full-time', 'Part-time', 'Casual', 'Apprentice', 'Trainee'];
export const STATUS = ['Active', 'On leave', 'Inactive'];
export const ROLES = ['Project director', 'Project manager', 'Site supervisor', 'Leading hand', 'Estimator', 'Tradesperson', 'Labourer', 'Apprentice', 'Designer', 'Engineer', 'Safety officer', 'Office / admin', 'Accounts', 'Sales', 'Other'];
// tickets with an expiry (and whether the site needs it)
export const TICKETS = [['whiteCard', 'White card (general construction induction)', true, false], ['licence', 'Trade licence', false, true], ['driver', 'Driver\'s licence', false, true], ['firstAid', 'First aid', false, true],
  ['heights', 'Working at heights', false, true], ['confined', 'Confined spaces', false, true], ['ewp', 'EWP (elevated work platform)', false, true], ['forklift', 'Forklift (LF)', false, true], ['asbestos', 'Asbestos awareness', false, true]];
const TR = Object.fromEntries(TRADES.map((t) => [t[0], t]));

function doc(expiry, needed, now) {
  if (!expiry) return needed ? 'missing' : 'n/a';
  if (expiry < now) return 'expired';
  if (expiry <= addDays(now, 30)) return 'due';
  return 'ok';
}
// what needs attention: white card (everyone on site), a trade licence where the trade needs one, any ticket that has an expiry,
// and for contractors public liability and workers comp (unless a sole trader)
export function compliance(p, now = sydToday()) {
  const t = p.tickets || {}, list = [];
  const site = p.status !== 'Inactive' && !['Office / admin', 'Accounts', 'Sales'].includes(p.role);
  if (site) list.push(['White card', t.whiteCard && (t.whiteCard.number || t.whiteCard.has) ? 'ok' : 'missing']);
  const licNeeded = !!(TR[p.trade] || [])[2];
  list.push(['Trade licence', doc((t.licence || {}).expiry, licNeeded && !!p.trade, now)]);
  for (const [k, name] of TICKETS) if (!['whiteCard', 'licence'].includes(k) && t[k] && t[k].expiry) list.push([name.replace(/ \(.*\)$/, ''), doc(t[k].expiry, false, now)]);
  if (p.type === 'Contractor') {
    list.push(['Public liability', doc((p.insurance || {}).expiry, true, now)]);
    list.push(['Workers comp', (p.workersComp || {}).soleTrader ? 'n/a' : doc((p.workersComp || {}).expiry, true, now)]);
  }
  const worst = list.some((x) => x[1] === 'expired') ? 'expired' : list.some((x) => x[1] === 'missing') ? 'missing' : list.some((x) => x[1] === 'due') ? 'due' : 'ok';
  return { worst, items: list.filter((x) => x[1] !== 'n/a'), problems: list.filter((x) => x[1] !== 'ok' && x[1] !== 'n/a').map((x) => x[0] + ': ' + x[1]) };
}

const tick = (x) => ({ number: str((x || {}).number, 40), class: str((x || {}).class, 60), expiry: ymd((x || {}).expiry), has: !!(x || {}).has });
function clean(f, old = {}) {
  const type = TYPES.includes(f.type) ? f.type : 'Employee';
  const tickets = {}; for (const [k] of TICKETS) { const v = tick((f.tickets || {})[k]); if (v.number || v.class || v.expiry || v.has) tickets[k] = v; }
  return { ...old, type, name: str(f.name, 100), role: str(f.role, 60), trade: TR[f.trade] ? f.trade : '', skills: str(f.skills, 300),
    employment: type === 'Employee' ? (EMPLOYMENT.includes(f.employment) ? f.employment : 'Full-time') : '',
    business: type === 'Contractor' ? str(f.business, 120) : '', abn: type === 'Contractor' ? str(f.abn, 20).replace(/[^\d ]/g, '') : '', gst: type === 'Contractor' && !!f.gst,
    phone: str(f.phone, 40), email: str(f.email, 160).toLowerCase(), address: str(f.address, 200), suburb: str(f.suburb, 60),
    start: ymd(f.start), end: ymd(f.end), status: STATUS.includes(f.status) ? f.status : 'Active', hours: Math.max(0, Math.min(80, Math.round(Number(f.hours) || 0))), availability: str(f.availability, 160),
    costRate: r2(f.costRate), chargeRate: r2(f.chargeRate), emergency: { name: str((f.emergency || {}).name, 80), phone: str((f.emergency || {}).phone, 40) },
    tickets, insurance: type === 'Contractor' ? { insurer: str((f.insurance || {}).insurer, 80), policy: str((f.insurance || {}).policy, 40), cover: r2((f.insurance || {}).cover), expiry: ymd((f.insurance || {}).expiry) } : {},
    workersComp: type === 'Contractor' ? { policy: str((f.workersComp || {}).policy, 40), expiry: ymd((f.workersComp || {}).expiry), soleTrader: !!(f.workersComp || {}).soleTrader } : {},
    rating: Math.max(0, Math.min(5, Math.round(Number(f.rating) || 0))), notes: str(f.notes, 2000), archived: !!f.archived };
}
const summary = (p) => ({ id: p.id, type: p.type, name: p.name, role: p.role, trade: p.trade, employment: p.employment, business: p.business, phone: p.phone, email: p.email, suburb: p.suburb,
  status: p.status, costRate: p.costRate, chargeRate: p.chargeRate, hours: p.hours, rating: p.rating, archived: !!p.archived, start: p.start,
  tickets: Object.fromEntries(Object.entries(p.tickets || {}).map(([k, v]) => [k, { expiry: v.expiry, has: !!(v.number || v.has), class: v.class }])),
  insurance: { expiry: (p.insurance || {}).expiry || '' }, workersComp: { expiry: (p.workersComp || {}).expiry || '', soleTrader: !!(p.workersComp || {}).soleTrader } });

async function index() { return (await kv.get('ppl-index')) || { people: {} }; }
export async function get(id) { return /^P-\d{3,5}$/.test(id || '') ? kv.get('ppl:' + id) : null; }
export async function save(f, by) {
  if (!str(f.name, 100)) return { error: 'Give the person a name' };
  if (f.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(str(f.email, 160))) return { error: 'That email address does not look right' };
  let id = /^P-\d{3,5}$/.test(f.id || '') ? f.id : '';
  const old = id ? (await kv.get('ppl:' + id)) || {} : {};
  if (!id) { const n = await kv.update('ppl-seq', (x) => ({ n: ((x && x.n) || 0) + 1 }), () => ({ n: 0 })); id = 'P-' + String(n.n).padStart(3, '0'); }
  const p = { ...clean(f, old), id, created: old.created || Date.now(), updated: Date.now(), by: str(by, 60) };
  await kv.set('ppl:' + id, p);
  await kv.update('ppl-index', (x) => { x.people = x.people || {}; x.people[id] = summary(p); return x; }, () => ({ people: {} }));
  return { person: p };
}
export async function list() {
  const idx = await index(), now = sydToday();
  const people = Object.values(idx.people || {}).map((p) => ({ ...p, comp: compliance(p, now) })).sort((a, b) => (a.name.toLowerCase() > b.name.toLowerCase() ? 1 : -1));
  return { people, types: TYPES, employment: EMPLOYMENT, statuses: STATUS, roles: ROLES, tickets: TICKETS.map((t) => ({ key: t[0], name: t[1] })), trades: TRADES.map((t) => ({ key: t[0], name: t[1], licence: t[2] })), today: now };
}
// is this person allowed to log in? (in the register, not archived, not inactive)
export async function canLogin(id) { const p = await get(id); return !!(p && !p.archived && p.status !== 'Inactive'); }

// ---------- assignments: where each person appears in the project plans ----------
const norm = (s) => String(s || '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
export async function assignments(onlyId) {
  const idx = await index(), people = Object.values(idx.people || {}).filter((p) => !onlyId || p.id === onlyId);
  const by = {}; people.forEach((p) => { by[p.id] = []; });
  const keyOf = people.map((p) => [p.id, norm(p.name)]).filter((x) => x[1]);
  const match = (name) => { const n = norm(name); if (!n) return []; return keyOf.filter((k) => k[1] === n || n.startsWith(k[1] + ' ')).map((k) => k[0]); };
  const keys = (await kv.keys('plan:')).slice(0, 300), today = sydToday(), soon = addDays(today, 14);
  const plans = await kv.getMany(keys);
  for (const plan of plans) {
    if (!plan || !Array.isArray(plan.tasks)) continue;
    try { P.schedule(plan); } catch { continue; }
    const core = plan.core || '', base = { core, plan: plan.name || 'Project plan' };
    const push = (ids, row) => ids.forEach((id) => by[id] && by[id].push({ ...base, ...row }));
    if (plan.charter && plan.charter.manager) push(match(plan.charter.manager), { kind: 'Project manager', what: 'Runs the project', es: '', ef: '' });
    (plan.stakeholders || []).forEach((s) => push(match(s.name), { kind: 'Stakeholder (' + s.raci + ')', what: s.role || '', es: '', ef: '' }));
    plan.tasks.forEach((t) => {
      if (!t.dur) return;
      const lead = norm(t.lead), done = (t.pct || 0) >= 100;
      (t.res || []).forEach((r) => push(match(r), { kind: norm(r) === lead ? 'Lead on a task' : 'On a task', what: t.name, es: t.es, ef: t.ef, pct: t.pct || 0, done }));
      (t.subs || []).forEach((sb) => { if (!sb.owner) return; const es = sb.off ? P.addWork(t.es, sb.off, !!(plan.emergency || plan.weekends)) : t.es, ef = sb.dur > 1 ? P.addWork(es, sb.dur - 1, !!(plan.emergency || plan.weekends)) : es;
        push(match(sb.owner), { kind: 'Story owner', what: sb.name + ' (' + t.name + ')', es, ef, pct: sb.pct || 0, done: sb.status === 'done' }); });
    });
  }
  const res = {};
  for (const p of people) {
    const L = by[p.id] || [], work = L.filter((x) => x.es && !x.done);
    const now = work.filter((x) => x.es <= today && x.ef >= today), next = work.filter((x) => x.es > today && x.es <= soon), late = work.filter((x) => x.ef < today);
    res[p.id] = { list: L.sort((a, b) => (a.es || '9') < (b.es || '9') ? -1 : 1).slice(0, 200), projects: [...new Set(L.map((x) => x.core))].length, now: now.length, next: next.length, late: late.length };
  }
  return res;
}

// ---------- test data (test site only) ----------
async function testLoad(body, by) {
  if (String(env('SITE_ENV', '')).trim().toLowerCase() !== 'test') return { error: 'Test data can only be loaded on the test site.', code: 403 };
  const now = sydToday(), d = (n) => (n == null || n === '' ? '' : addDays(now, Number(n))), ids = [];
  for (const f of (Array.isArray(body.people) ? body.people : []).slice(0, 40)) {
    const tickets = {}; for (const [k, v] of Object.entries(f.tickets || {})) tickets[k] = { ...v, expiry: d(v.expiryDays) };
    const r = await save({ ...f, tickets, start: d(f.startDays), insurance: { ...(f.insurance || {}), expiry: d((f.insurance || {}).expiryDays) }, workersComp: { ...(f.workersComp || {}), expiry: d((f.workersComp || {}).expiryDays) } }, by);
    if (r.person) ids.push(r.person.id);
  }
  return { ids };
}

export async function pplPost(action, body, { who, by, audit }) {
  const log = (t) => (audit ? audit(who, t) : null);
  switch (action) {
    case 'pplList': return out(200, await list());
    case 'pplGet': {
      const p = await get(str(body.id, 10)); if (!p) return out(404, { error: 'Person not found' });
      const a = (await assignments(p.id))[p.id];
      return out(200, { person: p, comp: compliance(p), assign: a });
    }
    case 'pplAssign': return out(200, { assign: await assignments() });
    case 'pplSave': {
      const r = await save(body.person || {}, by); if (r.error) return out(400, r);
      await log(`Person saved: ${r.person.id} ${r.person.name} (${r.person.type})`);
      return out(200, { person: r.person, comp: compliance(r.person) });
    }
    case 'pplTestLoad': { const r = await testLoad(body, by); if (r.error) return out(r.code || 400, r); await log(`Test data loaded: ${r.ids.length} people`); return out(200, r); }
    default: return null;
  }
}
