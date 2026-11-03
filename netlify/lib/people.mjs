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
  status: p.status, costRate: p.costRate, chargeRate: p.chargeRate, hours: p.hours, rating: p.rating, archived: !!p.archived, archivedAt: p.archivedAt || 0, start: p.start, updated: p.updated || 0,
  tickets: Object.fromEntries(Object.entries(p.tickets || {}).map(([k, v]) => [k, { expiry: v.expiry, has: !!(v.number || v.has), class: v.class }])),
  insurance: { expiry: (p.insurance || {}).expiry || '' }, workersComp: { expiry: (p.workersComp || {}).expiry || '', soleTrader: !!(p.workersComp || {}).soleTrader } });

async function index() { return (await kv.get('ppl-index')) || { people: {} }; }
export async function get(id) { return /^P-\d{3,5}$/.test(id || '') ? kv.get('ppl:' + id) : null; }
// v90: what changed, in words, for the person's history
const FIELDS = [['name', 'Name'], ['type', 'Type'], ['role', 'Role'], ['trade', 'Trade'], ['employment', 'Employment'], ['business', 'Trading name'], ['abn', 'ABN'], ['phone', 'Mobile'], ['email', 'Email'],
  ['address', 'Address'], ['suburb', 'Suburb'], ['start', 'Started'], ['end', 'Finished'], ['status', 'Status'], ['hours', 'Hours a week'], ['availability', 'Availability'], ['costRate', 'Cost rate'], ['chargeRate', 'Charge-out rate'],
  ['rating', 'Rating'], ['skills', 'Skills'], ['notes', 'Notes']];
function diff(a, b) {
  const ch = [], v = (x) => (x === '' || x == null || x === 0 ? '–' : String(x));
  for (const [k, n] of FIELDS) if (String(a[k] ?? '') !== String(b[k] ?? '') && !(!a[k] && !b[k])) ch.push(k === 'notes' || k === 'skills' ? n + ' changed' : `${n} ${v(a[k])} → ${v(b[k])}`);
  for (const [k, n] of TICKETS) { const x = (a.tickets || {})[k] || {}, y = (b.tickets || {})[k] || {}; if ((x.expiry || '') !== (y.expiry || '') || (x.number || '') !== (y.number || '')) ch.push(n.replace(/ \(.*\)$/, '') + (y.expiry ? ' expiry ' + (x.expiry || '–') + ' → ' + y.expiry : ' updated')); }
  if (JSON.stringify(a.insurance || {}) !== JSON.stringify(b.insurance || {})) ch.push('Public liability updated');
  if (JSON.stringify(a.workersComp || {}) !== JSON.stringify(b.workersComp || {})) ch.push('Workers comp updated');
  if (JSON.stringify(a.emergency || {}) !== JSON.stringify(b.emergency || {})) ch.push('Emergency contact updated');
  if (!!a.archived !== !!b.archived) ch.push(b.archived ? 'Archived' : 'Restored');
  return ch;
}
export async function save(f, by, o = {}) {
  if (!str(f.name, 100)) return { error: 'Give the person a name' };
  if (f.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(str(f.email, 160))) return { error: 'That email address does not look right' };
  let id = /^P-\d{3,5}$/.test(f.id || '') ? f.id : '';
  const old = id ? (await kv.get('ppl:' + id)) || {} : {};
  if (id && !old.id) return { error: 'Person not found' };
  const em = str(f.email, 160).toLowerCase();   // v90: one person per email (the email is also their login)
  if (em && !f.archived) { const dup = Object.values((await index()).people || {}).find((x) => x.id !== id && !x.archived && (x.email || '').toLowerCase() === em); if (dup) return { error: `${dup.name} (${dup.id}) already has the email ${em}. Open that person instead, or use another email.`, dup: dup.id }; }
  if (!id) { const n = await kv.update('ppl-seq', (x) => ({ n: ((x && x.n) || 0) + 1 }), () => ({ n: 0 })); id = 'P-' + String(n.n).padStart(3, '0'); }
  const p = { ...clean(f, old), id, created: old.created || Date.now(), updated: Date.now(), by: str(by, 60) };
  if (p.archived && !old.archived) { p.archivedAt = Date.now(); p.archivedWhy = str(o.reason, 200); } else if (!p.archived) { delete p.archivedAt; delete p.archivedWhy; }
  const ch = old.id ? diff(old, p) : ['Added' + (o.via ? ' (' + o.via + ')' : '')];
  if (old.id && !ch.length) return { person: old, same: true };
  p.history = (Array.isArray(old.history) ? old.history : []).concat([{ at: Date.now(), by: str(by, 60), what: (o.via && old.id ? o.via + ': ' : '') + ch.join('; ').slice(0, 600) + (o.reason ? ' (' + str(o.reason, 200) + ')' : '') }]).slice(-100);
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

// ---------- v90: looking after the register: bulk changes, renaming on the plans, delete, import, export ----------
// a new name on the project plans too (the plans name people as text: project manager, stakeholders, resources, leads, owners)
export async function renameOnPlans(from, to, by) {
  const a = norm(from), keys = await kv.keys('plan:'); let n = 0;
  if (!a || !str(to, 100) || a === norm(to)) return 0;
  const fix = (x) => (norm(x) === a ? to : x);
  for (const plan of await kv.getMany(keys)) {
    if (!plan || !Array.isArray(plan.tasks)) continue;
    const before = JSON.stringify(plan);
    if (plan.charter && plan.charter.manager) plan.charter.manager = fix(plan.charter.manager);
    (plan.stakeholders || []).forEach((x) => { x.name = fix(x.name); });
    plan.tasks.forEach((t) => { t.res = (t.res || []).map(fix); if (t.lead) t.lead = fix(t.lead); if (t.owner) t.owner = fix(t.owner); (t.subs || []).forEach((sb) => { if (sb.owner) sb.owner = fix(sb.owner); }); });
    if (JSON.stringify(plan) === before) continue;
    const r = await P.save(plan.core, plan, plan.rev, by); if (r.plan) n++;
  }
  return n;
}
async function bulk(body, by) {
  const ids = (Array.isArray(body.ids) ? body.ids : []).map((x) => str(x, 10)).filter((x) => /^P-\d{3,5}$/.test(x)).slice(0, 300), op = str(body.op, 20), val = body.value;
  if (!ids.length) return { error: 'Pick at least one person' };
  if (!['archive', 'restore', 'status', 'role', 'rate'].includes(op)) return { error: 'Unknown change' };
  if (op === 'status' && !STATUS.includes(val)) return { error: 'Pick a status' };
  if (op === 'role' && !str(val, 60)) return { error: 'Give the role' };
  const rk = op === 'rate' ? (val && val.kind === 'charge' ? 'chargeRate' : 'costRate') : '', mode = op === 'rate' ? (val && val.mode === 'pct' ? 'pct' : 'set') : '', num = op === 'rate' ? Number(val && val.n) : 0;
  if (op === 'rate' && (!Number.isFinite(num) || (mode === 'set' && num < 0) || (mode === 'pct' && (num < -90 || num > 500)))) return { error: 'That rate change does not look right' };
  const done = [], skipped = [];
  for (const id of ids) {
    const p = await get(id); if (!p) { skipped.push(id); continue; }
    const f = { ...p };
    if (op === 'archive') { if (p.archived) { skipped.push(id); continue; } f.archived = true; }
    if (op === 'restore') { if (!p.archived) { skipped.push(id); continue; } f.archived = false; }
    if (op === 'status') f.status = val;
    if (op === 'role') f.role = str(val, 60);
    if (op === 'rate') { if (mode === 'pct' && !p[rk]) { skipped.push(id); continue; } f[rk] = mode === 'set' ? r2(num) : r2(p[rk] * (1 + num / 100)); }
    const r = await save(f, by, { via: 'Bulk change', reason: str(body.reason, 200) });
    if (r.error) skipped.push(id); else if (!r.same) done.push(id); else skipped.push(id);
  }
  return { done, skipped };
}
// import: rows from a spreadsheet (one person per row). Matched by ID, then email, then exact name: those are updated
// (only the columns given), the rest are added. dry = just say what would happen.
const COLS = { id: 'id', 'person id': 'id', name: 'name', 'full name': 'name', type: 'type', role: 'role', trade: 'trade', employment: 'employment', 'trading name': 'business', business: 'business', abn: 'abn', gst: 'gst',
  phone: 'phone', mobile: 'phone', email: 'email', address: 'address', suburb: 'suburb', started: 'start', start: 'start', status: 'status', 'hours a week': 'hours', hours: 'hours', availability: 'availability',
  'cost rate': 'costRate', 'cost rate ($/hr)': 'costRate', 'charge-out rate': 'chargeRate', 'charge rate': 'chargeRate', 'charge-out rate ($/hr)': 'chargeRate', rating: 'rating', skills: 'skills', notes: 'notes',
  'white card': 'tk.whiteCard.number', 'trade licence': 'tk.licence.number', 'trade licence expiry': 'tk.licence.expiry', 'driver licence': 'tk.driver.number', "driver's licence": 'tk.driver.number', 'driver licence expiry': 'tk.driver.expiry', "driver's licence expiry": 'tk.driver.expiry',
  'first aid expiry': 'tk.firstAid.expiry', 'working at heights expiry': 'tk.heights.expiry', 'public liability expiry': 'ins.expiry', 'workers comp expiry': 'wc.expiry', 'emergency contact': 'em.name', 'emergency phone': 'em.phone' };
const dateIn = (v) => { const x = String(v ?? '').trim(); if (/^\d{4}-\d{2}-\d{2}/.test(x)) return x.slice(0, 10); const m = x.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/); if (m) return (m[3].length === 2 ? '20' + m[3] : m[3]) + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0'); return ''; };
async function importRows(body, by) {
  const rows = (Array.isArray(body.rows) ? body.rows : []).slice(0, 500), idx = Object.values((await index()).people || {});
  const res = { added: [], updated: [], same: 0, errors: [] };
  const typeOf = (v) => (/contract/i.test(String(v || '')) ? 'Contractor' : /employ|staff/i.test(String(v || '')) ? 'Employee' : '');
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i] || {}, g = {};
    for (const [k, v] of Object.entries(raw)) { const c = COLS[String(k).trim().toLowerCase()]; if (c && v !== null && v !== undefined && String(v).trim() !== '') g[c] = String(v).trim(); }
    if (!g.name && !g.id && !g.email) continue;
    const hit = (g.id && idx.find((x) => x.id === g.id)) || (g.email && idx.find((x) => (x.email || '').toLowerCase() === g.email.toLowerCase())) || (g.name && idx.find((x) => x.name.toLowerCase() === g.name.toLowerCase()));
    const base = hit ? await get(hit.id) : { type: 'Employee', status: 'Active', tickets: {} };
    const f = JSON.parse(JSON.stringify(base)); f.tickets = f.tickets || {}; f.insurance = f.insurance || {}; f.workersComp = f.workersComp || {}; f.emergency = f.emergency || {};
    for (const [c, v] of Object.entries(g)) {
      if (c === 'id') continue;
      const q = c.split('.');
      if (q[0] === 'tk') { (f.tickets[q[1]] = f.tickets[q[1]] || {})[q[2]] = q[2] === 'expiry' ? dateIn(v) : v; continue; }
      if (q.length === 2) { f[{ ins: 'insurance', wc: 'workersComp', em: 'emergency' }[q[0]]][q[1]] = q[1] === 'expiry' ? dateIn(v) : v; continue; }
      if (c === 'type') { const t = typeOf(v); if (t) f.type = t; continue; }
      if (c === 'trade') { const t = TRADES.find((x) => x[0] === v.toLowerCase() || x[1].toLowerCase() === v.toLowerCase()); f.trade = t ? t[0] : ''; continue; }
      if (c === 'status') { const st = STATUS.find((x) => x.toLowerCase() === v.toLowerCase()); if (st) f.status = st; continue; }
      if (c === 'employment') { const e = EMPLOYMENT.find((x) => x.toLowerCase() === v.toLowerCase()); if (e) f.employment = e; continue; }
      if (c === 'gst') { f.gst = /^(y|yes|true|1|registered)$/i.test(v); continue; }
      if (c === 'costRate' || c === 'chargeRate' || c === 'hours' || c === 'rating') { f[c] = Number(String(v).replace(/[$,\s]/g, '')) || 0; continue; }
      if (c === 'start') { f.start = dateIn(v); continue; }
      f[c] = v;
    }
    if (!f.name) { res.errors.push({ row: i + 2, error: 'No name' }); continue; }
    if (body.dry) {
      const em = String(f.email || '').toLowerCase(), dup = em && idx.find((x) => x.id !== (hit && hit.id) && !x.archived && (x.email || '').toLowerCase() === em);
      if (em && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { res.errors.push({ row: i + 2, name: f.name, error: 'That email address does not look right' }); continue; }
      if (dup) { res.errors.push({ row: i + 2, name: f.name, error: `${dup.name} (${dup.id}) already has the email ${em}` }); continue; }
      if (!hit) res.added.push(f.name);
      else { const cl = clean(f, base); const ch = diff(base, { ...cl, archived: base.archived }); if (ch.length) res.updated.push(f.name + ': ' + ch.join('; ')); else res.same++; }
      continue;
    }
    const r = await save(f, by, { via: 'Import' });
    if (r.error) res.errors.push({ row: i + 2, name: f.name, error: r.error });
    else if (r.same) res.same++;
    else { (hit ? res.updated : res.added).push(r.person.id + ' ' + r.person.name); if (!hit) idx.push(summary(r.person)); }
  }
  return res;
}
async function remove(body) {
  const p = await get(str(body.id, 10)); if (!p) return { error: 'Person not found', code: 404 };
  if (!p.archived) return { error: 'Archive the person first. Only archived people can be deleted.' };
  if (str(body.confirm, 100).toLowerCase() !== p.name.toLowerCase()) return { error: 'Type their full name to confirm' };
  await kv.del('ppl:' + p.id);
  await kv.update('ppl-index', (x) => { if (x.people) delete x.people[p.id]; return x; }, () => ({ people: {} }));
  return { id: p.id, name: p.name };
}

// ---------- v88: 10 sample people for trying things out (test site only). Made-up names, @example.com emails. ----------
export const SAMPLE = [
  { type: 'Employee', name: 'Olivia Bennett', role: 'Project director', employment: 'Full-time', phone: '0400 100 101', email: 'olivia.bennett@example.com', suburb: 'Bella Vista', costRate: 120, chargeRate: 190, hours: 38, rating: 5, startDays: -900, tickets: { whiteCard: { number: 'WC10101' }, driver: { class: 'C', expiryDays: 700 }, firstAid: { number: 'FA1', expiryDays: 200 } } },
  { type: 'Employee', name: 'Jack Morrison', role: 'Project manager', employment: 'Full-time', phone: '0400 100 102', email: 'jack.morrison@example.com', suburb: 'Castle Hill', costRate: 95, chargeRate: 160, hours: 38, rating: 4, startDays: -600, tickets: { whiteCard: { number: 'WC10102' }, firstAid: { number: 'FA2', expiryDays: 20 } } },
  { type: 'Employee', name: 'Mei Chen', role: 'Site supervisor', employment: 'Full-time', phone: '0400 100 103', email: 'mei.chen@example.com', suburb: 'Kellyville', costRate: 78, chargeRate: 130, hours: 40, rating: 5, startDays: -400, tickets: { whiteCard: { number: 'WC10103' }, heights: { number: 'WAH3', expiryDays: 400 }, firstAid: { number: 'FA3', expiryDays: 300 } } },
  { type: 'Employee', name: 'Tom Walsh', role: 'Leading hand', trade: 'carpenter', employment: 'Full-time', phone: '0400 100 104', email: 'tom.walsh@example.com', suburb: 'Rouse Hill', costRate: 65, chargeRate: 110, hours: 40, rating: 4, startDays: -800, tickets: { whiteCard: { number: 'WC10104' }, licence: { number: 'CAR104', class: 'Carpentry', expiryDays: 300 }, ewp: { number: 'EWP4', expiryDays: 150 } } },
  { type: 'Employee', name: 'Aisha Rahman', role: 'Estimator', employment: 'Part-time', phone: '0400 100 105', email: 'aisha.rahman@example.com', suburb: 'Parramatta', costRate: 70, chargeRate: 0, hours: 24, rating: 4, startDays: -200, tickets: { whiteCard: { number: 'WC10105' } } },
  { type: 'Employee', name: 'Liam O\'Connor', role: 'Tradesperson', trade: 'electrician', employment: 'Full-time', phone: '0400 100 106', email: 'liam.oconnor@example.com', suburb: 'Blacktown', costRate: 62, chargeRate: 105, hours: 38, rating: 3, startDays: -300, tickets: { whiteCard: { number: 'WC10106' }, licence: { number: 'EC106', class: 'Electrician', expiryDays: -10 } } },
  { type: 'Employee', name: 'Sofia Rossi', role: 'Apprentice', trade: 'carpenter', employment: 'Apprentice', phone: '0400 100 107', email: 'sofia.rossi@example.com', suburb: 'Box Hill', costRate: 32, chargeRate: 60, hours: 38, rating: 4, startDays: -120, tickets: { whiteCard: { number: 'WC10107' } } },
  { type: 'Contractor', name: 'Ben Nguyen', role: 'Tradesperson', trade: 'plumber', business: 'Nguyen Plumbing', abn: '51 824 753 556', gst: true, phone: '0400 100 108', email: 'ben.nguyen@example.com', suburb: 'Baulkham Hills', costRate: 90, chargeRate: 0, rating: 4, startDays: -500, tickets: { whiteCard: { number: 'WC10108' }, licence: { number: 'PL108', class: 'Plumber, drainer', expiryDays: 260 } }, insurance: { insurer: 'QBE', policy: 'PL-108', expiryDays: 250 }, workersComp: { soleTrader: true } },
  { type: 'Employee', name: 'Grace Taylor', role: 'Accounts', employment: 'Part-time', phone: '0400 100 109', email: 'grace.taylor@example.com', suburb: 'Norwest', costRate: 55, chargeRate: 0, hours: 20, rating: 5, startDays: -700, tickets: {} },
  { type: 'Contractor', name: 'Daniel Park', role: 'Engineer', business: 'Park Engineering', abn: '33 615 948 270', gst: true, phone: '0400 100 110', email: 'daniel.park@example.com', suburb: 'Epping', costRate: 140, chargeRate: 0, rating: 4, startDays: -150, tickets: { whiteCard: { number: 'WC10110' } }, insurance: { insurer: 'Allianz', policy: 'PI-110', expiryDays: 15 }, workersComp: { policy: 'WC-110', expiryDays: 180 } }];
export const isTest = () => String(env('SITE_ENV', '')).trim().toLowerCase() === 'test';
async function sampleLoad(by) {
  if (!isTest()) return { error: 'Sample people can only be loaded on the test site.', code: 403 };
  const have = new Set(Object.values((await index()).people || {}).map((p) => p.name.toLowerCase()));
  const r = await testLoad({ people: SAMPLE.filter((p) => !have.has(p.name.toLowerCase())) }, by);
  return { ...r, skipped: SAMPLE.length - r.ids.length };
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

export async function pplPost(action, body, { who, by, audit, unlogin }) {
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
      const prev = /^P-\d{3,5}$/.test((body.person || {}).id || '') ? await get(body.person.id) : null;
      const r = await save(body.person || {}, by, { reason: body.reason }); if (r.error) return out(400, r);
      let plans = 0;   // v90: a new name on the project plans too
      if (body.renamePlans && prev && prev.name !== r.person.name) plans = await renameOnPlans(prev.name, r.person.name, by);
      await log(`Person saved: ${r.person.id} ${r.person.name} (${r.person.type})${r.same ? ' (no changes)' : ''}${plans ? `, renamed on ${plans} plan(s)` : ''}`);
      return out(200, { person: r.person, comp: compliance(r.person), same: !!r.same, plans });
    }
    case 'pplBulk': { const r = await bulk(body, by); if (r.error) return out(400, r); if (r.done.length) await log(`People bulk change (${str(body.op, 20)}): ${r.done.join(', ')}`); return out(200, r); }
    case 'pplImport': { const r = await importRows(body, by); if (!body.dry) await log(`People imported: ${r.added.length} added, ${r.updated.length} updated, ${r.errors.length} errors`); return out(200, r); }
    case 'pplExport': return out(200, { people: (await kv.getMany(Object.keys((await index()).people || {}).map((id) => 'ppl:' + id))).filter(Boolean).filter((p) => body.archived || !p.archived).map((p) => { const { history, ...x } = p; return x; }) });
    case 'pplDelete': { const r = await remove(body); if (r.error) return out(r.code || 400, r); r.logins = unlogin ? (await unlogin(r.id)).length : 0; await log(`Person deleted permanently: ${r.id} ${r.name}${r.logins ? ' (and their login)' : ''}`); return out(200, r); }
    case 'pplSampleLoad': { const r = await sampleLoad(by); if (r.error) return out(r.code || 400, r); await log(`Sample people loaded: ${r.ids.length}`); return out(200, r); }
    case 'pplTestLoad': { const r = await testLoad(body, by); if (r.error) return out(r.code || 400, r); await log(`Test data loaded: ${r.ids.length} people`); return out(200, r); }
    default: return null;
  }
}
