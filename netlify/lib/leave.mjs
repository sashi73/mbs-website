// MBS Console v108: Leave (under People). Staff with a console login ask for leave themselves (My leave); managers approve or
// decline it, see who is away on a calendar (with clash warnings), and see everyone's balances. Approved leave is written into
// the person's timesheet for those days, so the next pay run pays it (and takes it off their balance). Weekends and public
// holidays inside a leave period are not counted (the National Employment Standards: a public holiday is not annual leave).
//   lv:<LV-0001>   one request;  lv-index  summaries
// Family and domestic violence leave is shown to others only as "Away" and on payslips as ordinary hours (Fair Work rules).
import * as kv from './kv.mjs';
import * as PPL from './people.mjs';
import * as PR from './payroll.mjs';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const str = (s, max = 300) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
const ymd = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : '');
const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const dow = (d) => new Date(d + 'T00:00:00Z').getUTCDay();
const today = () => new Date(Date.now() + 11 * 3600e3).toISOString().slice(0, 10);
const H = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const out = (status, body) => new Response(JSON.stringify(body), { status, headers: H });

// [key, name, from which balance, paid by MBS, what the NES gives]
export const TYPES = [
  ['annual', 'Annual leave', 'annual', true, '4 weeks a year (152 hours full-time), with 17.5% loading'],
  ['personal', 'Personal (sick) leave', 'personal', true, '10 days a year, shared with carer\'s leave'],
  ['carers', 'Carer\'s leave', 'personal', true, 'From the personal leave balance; 2 days unpaid each time if it runs out'],
  ['compassionate', 'Compassionate leave', '', true, '2 days each time (paid; unpaid for casuals)'],
  ['fdv', 'Family and domestic violence leave', '', true, '10 days paid each year, casuals included; kept confidential'],
  ['rdo', 'Rostered day off (RDO)', 'rdo', true, 'From the RDO bank (0.4 hours banked for each 8-hour day)'],
  ['lsl', 'Long service leave', '', false, 'NSW building: paid by the portable long service scheme, not by MBS'],
  ['parental', 'Parental leave', '', false, 'Unpaid, up to 12 months (Government Paid Parental Leave is separate)'],
  ['community', 'Community service leave', '', false, 'Unpaid (e.g. volunteer emergency work); jury duty top-up rules apply'],
  ['unpaid', 'Unpaid leave', '', false, 'By agreement']
];
const T = Object.fromEntries(TYPES.map((t) => [t[0], t]));
const payKey = (type) => (type === 'carers' ? 'personal' : type);   // the leave type in the timesheet
const label = (r, viewer) => (r.type === 'fdv' && !viewer ? 'Away' : (T[r.type] || [, r.type])[1]);

async function index() { return (await kv.get('lv-index')) || { reqs: {} }; }
const summary = (r) => ({ id: r.id, pid: r.pid, name: r.name, type: r.type, from: r.from, to: r.to, hours: r.hours, days: r.days, status: r.status, created: r.created, decidedBy: r.decidedBy || '', note: r.note || '', reason: r.reason || '' });
async function put(r) { await kv.set('lv:' + r.id, r); await kv.update('lv-index', (x) => { x.reqs = x.reqs || {}; x.reqs[r.id] = summary(r); return x; }, () => ({ reqs: {} })); return r; }
export async function get(id) { return /^LV-\d{4}$/.test(id || '') ? kv.get('lv:' + id) : null; }

// the working days in a leave period: Monday to Friday, not public holidays (unless the leave is unpaid/parental/long service, which run straight through)
export async function workDays(from, to, type, perDay) {
  const S = await PR.settings(), days = [];
  if (!from || !to || to < from) return days;
  for (let d = from, n = 0; d <= to && n < 400; d = addDays(d, 1), n++) {
    const wd = dow(d);
    if (wd === 0 || wd === 6) continue;
    if (S.holidays.includes(d)) continue;
    days.push({ date: d, hours: r2(perDay) });
  }
  return days;
}
// a person's balances (hours), and what is already asked for but not yet taken
export async function balances(pid) {
  const pr = await PR.profile(pid); if (!pr) return null;
  const all = Object.values((await index()).reqs || {}).filter((r) => r.pid === pid);
  const pending = { annual: 0, personal: 0, rdo: 0 };
  for (const r of all) if (r.status === 'pending' || (r.status === 'approved' && !r.paid)) { const k = (T[r.type] || [])[2]; if (k) pending[k] = r2(pending[k] + r.hours); }
  const yearAgo = addDays(today(), -365);
  const fdvUsed = r2(all.filter((r) => r.type === 'fdv' && ['approved', 'pending'].includes(r.status) && r.to >= yearAgo).reduce((s, r) => s + r.hours, 0));
  const b = pr.balances || {};
  return { pid, name: pr.name, employment: pr.employment, balances: { annual: r2(b.annual), personal: r2(b.personal), rdo: r2(b.rdo) }, booked: pending,
    after: { annual: r2(b.annual - pending.annual), personal: r2(b.personal - pending.personal), rdo: r2(b.rdo - pending.rdo) }, fdvLeft: r2(76 - fdvUsed) };
}
// others away on any of the same days (to spot clashes)
async function clashes(r) {
  const others = Object.values((await index()).reqs || {}).filter((x) => x.id !== r.id && x.pid !== r.pid && ['approved', 'pending'].includes(x.status) && x.from <= r.to && x.to >= r.from);
  return others.map((x) => ({ name: x.name, from: x.from, to: x.to, status: x.status }));
}

async function request(f, by, ctxPid, manager) {
  const pid = manager && f.pid ? str(f.pid, 10) : ctxPid;
  if (!pid) return { error: 'Your login is not linked to a person in People, so leave can’t be asked for here.' };
  const p = await PPL.get(pid); if (!p || p.type !== 'Employee') return { error: 'Leave is for employees in People.' };
  const type = T[f.type] ? f.type : '', from = ymd(f.from), to = ymd(f.to) || from;
  if (!type) return { error: 'Pick the kind of leave' };
  if (!from || to < from) return { error: 'Pick the dates' };
  const pr = await PR.profile(pid);
  if (pr.employment === 'Casual' && ['annual', 'personal', 'rdo'].includes(type)) return { error: 'Casuals don’t get paid annual, personal or RDO leave (they are paid the 25% loading instead). Choose unpaid leave.' };
  const perDay = Math.max(0.5, Math.min(12, Number(f.perDay) || 7.6));
  const days = await workDays(from, to, type, perDay);
  if (!days.length) return { error: 'Those dates are only weekends or public holidays: no leave needed.' };
  const hours = r2(days.reduce((s, d) => s + d.hours, 0));
  const n = (await kv.update('lv-seq', (x) => ({ n: ((x && x.n) || 0) + 1 }), () => ({ n: 0 }))).n;
  const r = { id: 'LV-' + String(n).padStart(4, '0'), pid, name: p.name, type, from, to, perDay, days, hours, reason: str(f.reason, 400), status: 'pending',   // a manager's entry is approved just below, which also fills the timesheet
   
    created: Date.now(), createdBy: str(by, 60), history: [{ at: Date.now(), by: str(by, 60), text: 'Asked for' }] };
  await put(r);
  if (manager && f.approve) return decide({ id: r.id, decision: 'approved', note: 'Entered by a manager' }, by);
  return { request: r, balance: await balances(pid), clashes: await clashes(r) };
}

// approve: write the leave into the timesheets (unless that week is already paid); decline/cancel: take it out again
async function decide(f, by) {
  const r = await get(str(f.id, 10)); if (!r) return { error: 'Request not found', code: 404 };
  const d = ['approved', 'declined', 'cancelled'].includes(f.decision) ? f.decision : null; if (!d) return { error: 'Approve, decline or cancel' };
  if (r.status === d) return { request: r };
  if (r.status === 'declined' || r.status === 'cancelled') return { error: 'That request is already ' + r.status + '.' };
  const skipped = [];
  if (d === 'approved') {
    for (const day of r.days) {
      const ts = await PR.timesheet(r.pid, day.date);
      if (ts.status === 'paid') { skipped.push(day.date); continue; }
      const e = (ts.days || {})[day.date] || { hours: 0, job: '', fares: false };
      ts.days = { ...(ts.days || {}), [day.date]: { ...e, leave: payKey(r.type), leaveHours: day.hours, note: str(((e.note || '') + ' ' + r.id).trim(), 120) } };
      await saveTs(ts);
    }
  }
  if (r.status === 'approved' && d !== 'approved') {   // undo what approval wrote
    for (const day of r.days) {
      const ts = await PR.timesheet(r.pid, day.date); if (ts.status === 'paid') { skipped.push(day.date); continue; }
      const e = (ts.days || {})[day.date]; if (!e || !String(e.note || '').includes(r.id)) continue;
      const left = { ...e, leave: '', leaveHours: 0, note: String(e.note || '').replace(r.id, '').trim() };
      const days = { ...ts.days }; if (left.hours || left.note) days[day.date] = left; else delete days[day.date];
      ts.days = days; await saveTs(ts);
    }
  }
  r.status = d; r.decidedBy = str(by, 60); r.decidedAt = Date.now(); r.note = str(f.note, 300); r.skipped = skipped;
  r.history.push({ at: Date.now(), by: str(by, 60), text: d[0].toUpperCase() + d.slice(1) + (r.note ? ': ' + r.note : '') + (skipped.length ? ` (${skipped.length} day(s) in weeks already paid were left alone)` : '') });
  await put(r);
  return { request: r, balance: await balances(r.pid), skipped };
}
async function saveTs(ts) {
  await kv.set(PR.tsKey(ts.pid, ts.week), { ...ts, updated: Date.now() });
  await kv.update('prl-ts-index', (ix) => { ix[ts.pid + ':' + ts.week] = { pid: ts.pid, week: ts.week, status: ts.status || 'draft', hours: Object.values(ts.days || {}).reduce((s, d) => s + (d.hours || 0), 0) }; return ix; }, () => ({}));
}

// who is away in a month (calendar), with public holidays
async function calendar(month) {
  const m = /^\d{4}-\d{2}$/.test(month || '') ? month : today().slice(0, 7), from = m + '-01', to = addDays(addDays(from, 32).slice(0, 8) + '01', -1);
  const reqs = Object.values((await index()).reqs || {}).filter((r) => ['approved', 'pending'].includes(r.status) && r.from <= to && r.to >= from);
  const S = await PR.settings();
  return { month: m, from, to, holidays: S.holidays.filter((d) => d >= from && d <= to), away: reqs.map((r) => ({ id: r.id, name: r.name, type: r.type === 'fdv' ? 'away' : r.type, label: label(r, false), from: r.from, to: r.to, status: r.status })) };
}

export async function lvPost(action, body, { by, audit, who, ctx }) {
  const log = (t) => (audit ? audit(who, t) : null), mine = (ctx && ctx.personId) || '';
  switch (action) {
    // ---- anyone signed in, for themselves ----
    case 'lvMine': {
      if (!mine) return out(200, { linked: false, types: TYPES });
      const list = Object.values((await index()).reqs || {}).filter((r) => r.pid === mine).sort((a, b) => (a.from < b.from ? 1 : -1));
      return out(200, { linked: true, balance: await balances(mine), requests: list, types: TYPES });
    }
    case 'lvRequest': { const r = await request(body, by, mine, false); if (r.error) return out(400, r); await log(`Leave asked for: ${r.request.id} ${r.request.name} ${label(r.request)} ${r.request.from} to ${r.request.to}`); return out(200, r); }
    case 'lvCancel': {
      const r = await get(str(body.id, 10)); if (!r || r.pid !== mine) return out(404, { error: 'Request not found' });
      if (r.status !== 'pending') return out(400, { error: 'Only a request that is still waiting can be cancelled here. Ask your manager to cancel approved leave.' });
      const x = await decide({ id: r.id, decision: 'cancelled', note: 'Cancelled by ' + r.name }, by); await log(`Leave cancelled: ${r.id}`); return out(200, x);
    }
    // ---- managers (People: edit) ----
    case 'lvList': {
      const all = Object.values((await index()).reqs || {}).sort((a, b) => (a.status === 'pending') - (b.status === 'pending') || (a.from < b.from ? 1 : -1)).reverse();
      const list = []; for (const r of all.slice(0, 300)) list.push({ ...r, label: label(r, true), clashes: r.status === 'pending' ? await clashes(r) : [] });
      const pend = {}; for (const r of list.filter((x) => x.status === 'pending')) pend[r.pid] = pend[r.pid] || await balances(r.pid);
      return out(200, { requests: list, balances: pend, types: TYPES, pending: list.filter((x) => x.status === 'pending').length });
    }
    case 'lvGet': { const r = await get(str(body.id, 10)); return r ? out(200, { request: r, balance: await balances(r.pid), clashes: await clashes(r) }) : out(404, { error: 'Request not found' }); }
    case 'lvSave': { const r = await request({ ...body, approve: body.approve !== false }, by, '', true); if (r.error) return out(400, r); await log(`Leave entered for ${r.request.name}: ${r.request.id}`); return out(200, r); }
    case 'lvDecide': { const r = await decide(body, by); if (r.error) return out(r.code || 400, r); await log(`Leave ${r.request.status}: ${r.request.id} ${r.request.name}`); return out(200, r); }
    case 'lvCalendar': return out(200, await calendar(body.month));
    case 'lvBalances': {
      const people = (await PPL.list()).people.filter((p) => p.type === 'Employee' && !p.archived && p.status !== 'Inactive');
      const rows = []; for (const p of people) rows.push(await balances(p.id));
      return out(200, { rows: rows.filter(Boolean) });
    }
    case 'lvCount': return out(200, { pending: Object.values((await index()).reqs || {}).filter((r) => r.status === 'pending').length });
    default: return null;
  }
}
