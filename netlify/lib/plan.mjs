// MBS project planner (PMI style, waterfall): one plan per job, stored in Netlify Blobs as plan:<job core>.
// Scheduling uses working days (Mon-Fri). Tasks: duration, finish-to-start predecessors, "start no earlier than",
// resource, quantity x unit cost, actual cost, % complete. Plus charter (scope), risks, issues and a baseline.
import * as kv from './kv.mjs';
import * as J from './jobs.mjs';
import { parseWhen, whenText, sydneyTime } from './calendar.mjs';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const str = (s, max = 300) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
const ymdOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : '';
const int = (n, lo, hi, d = lo) => { const v = Math.round(Number(n)); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };

// ---------- working days ----------
const toD = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const toS = (d) => d.toISOString().slice(0, 10);
export const isWork = (s) => { const w = toD(s).getUTCDay(); return w !== 0 && w !== 6; };
export function nextWork(s) { let d = toD(s); while ([0, 6].includes(d.getUTCDay())) d = new Date(d.getTime() + 86400000); return toS(d); }
export function prevWork(s) { let d = new Date(toD(s).getTime() - 86400000); while ([0, 6].includes(d.getUTCDay())) d = new Date(d.getTime() - 86400000); return toS(d); }
export function addWork(s, n) {   // n working days after s (s must be a working day)
  let d = toD(s), left = n;
  while (left > 0) { d = new Date(d.getTime() + 86400000); if (![0, 6].includes(d.getUTCDay())) left--; }
  return toS(d);
}
export function workBetween(a, b) {   // working days from a up to and including b (0 if b < a)
  if (!a || !b || b < a) return 0;
  let n = 0, d = toD(a); const e = toD(b);
  while (d <= e) { if (![0, 6].includes(d.getUTCDay())) n++; d = new Date(d.getTime() + 86400000); }
  return n;
}

// ---------- schedule (forward pass) ----------
export function schedule(plan) {
  const start = nextWork(plan.start || new Date().toISOString().slice(0, 10));
  const byId = Object.fromEntries(plan.tasks.map((t) => [t.id, t]));
  for (const t of plan.tasks) { t.es = ''; t.ef = ''; }
  for (let pass = 0; pass < 30; pass++) {
    let changed = false;
    for (const t of plan.tasks) {
      let es = start;
      for (const p of t.pred || []) { const q = byId[p]; if (q && q.ef && q !== t) { const after = q.dur === 0 ? nextWork(q.ef) : addWork(nextWork(q.ef), 1); if (after > es) es = after; } }
      if (t.snet && t.snet > es) es = nextWork(t.snet);
      es = nextWork(es);
      const ef = t.dur === 0 ? es : addWork(es, Math.max(1, t.dur) - 1);
      if (es !== t.es || ef !== t.ef) { t.es = es; t.ef = ef; changed = true; }
    }
    if (!changed) break;
  }
  return plan;
}
export function rollup(plan, today) {
  schedule(plan);
  const tasks = plan.tasks;
  const frac = (t) => (!t.es ? 0 : today < t.es ? 0 : today >= t.ef ? 1 : workBetween(t.es, today) / Math.max(1, workBetween(t.es, t.ef)));
  const cost = (t) => r2((Number(t.qty) || 0) * (Number(t.rate) || 0));
  const BAC = r2(tasks.reduce((a, t) => a + cost(t), 0));
  const PV = r2(tasks.reduce((a, t) => a + cost(t) * frac(t), 0));
  const EV = r2(tasks.reduce((a, t) => a + cost(t) * (t.pct || 0) / 100, 0));
  const AC = r2(tasks.reduce((a, t) => a + (Number(t.actual) || 0), 0));
  const finish = tasks.reduce((m, t) => (t.ef > m ? t.ef : m), '');
  const begin = tasks.reduce((m, t) => (!m || (t.es && t.es < m) ? t.es : m), '');
  const done = tasks.filter((t) => (t.pct || 0) >= 100).length;
  const late = tasks.filter((t) => (t.pct || 0) < 100 && t.ef && t.ef < today).length;
  const durW = tasks.reduce((a, t) => a + Math.max(1, t.dur), 0);
  const pct = tasks.length ? Math.round(tasks.reduce((a, t) => a + Math.max(1, t.dur) * (t.pct || 0), 0) / durW) : 0;
  const CPI = AC > 0 ? r2(EV / AC) : null, SPI = PV > 0 ? r2(EV / PV) : null;
  return { BAC, PV, EV, AC, CPI, SPI, EAC: CPI ? r2(BAC / CPI) : null, VAC: CPI ? r2(BAC - BAC / CPI) : null, start: begin, finish, done, total: tasks.length, late, pct,
    openRisks: (plan.risks || []).filter((r) => r.status !== 'Closed').length, highRisks: (plan.risks || []).filter((r) => r.status !== 'Closed' && r.p * r.i >= 12).length,
    openIssues: (plan.issues || []).filter((x) => x.status !== 'Resolved').length };
}

// ---------- cleaning what the browser sends ----------
const RESP = ['Avoid', 'Mitigate', 'Transfer', 'Accept', 'Exploit'], PRI = ['Low', 'Medium', 'High', 'Critical'];
function clean(p, core) {
  const ids = new Set();
  const uid = (v, pre) => { let s = str(v, 20).replace(/[^\w-]/g, '') || pre + Math.random().toString(36).slice(2, 8); while (ids.has(s)) s += 'x'; ids.add(s); return s; };
  const phases = (Array.isArray(p.phases) ? p.phases : []).slice(0, 20).map((f) => ({ id: uid(f.id, 'ph'), name: str(f.name, 80) || 'Phase' }));
  if (!phases.length) phases.push({ id: 'ph1', name: 'Work' });
  const phIds = new Set(phases.map((f) => f.id));
  const tasks = (Array.isArray(p.tasks) ? p.tasks : []).slice(0, 300).map((t) => ({
    id: uid(t.id, 't'), name: str(t.name, 160) || 'New task', phase: phIds.has(t.phase) ? t.phase : phases[0].id,
    dur: int(t.dur, 0, 365, 1), snet: ymdOk(t.snet), pred: (Array.isArray(t.pred) ? t.pred : []).map((x) => str(x, 20)).slice(0, 10),
    resource: str(t.resource, 80), qty: r2(t.qty), unit: str(t.unit, 20), rate: r2(t.rate), actual: r2(t.actual), pct: int(t.pct, 0, 100, 0), notes: str(t.notes, 1000)
  }));
  const tIds = new Set(tasks.map((t) => t.id));
  for (const t of tasks) t.pred = t.pred.filter((x) => tIds.has(x) && x !== t.id);
  const c = p.charter || {};
  return {
    core, name: str(p.name, 120) || 'Project plan', start: ymdOk(p.start) || new Date().toISOString().slice(0, 10),
    charter: { objective: str(c.objective, 1500), inScope: str(c.inScope, 3000), outScope: str(c.outScope, 2000), deliverables: str(c.deliverables, 2000),
      acceptance: str(c.acceptance, 2000), assumptions: str(c.assumptions, 2000), budget: r2(c.budget), customer: str(c.customer, 120), manager: str(c.manager, 80) },
    phases, tasks,
    risks: (Array.isArray(p.risks) ? p.risks : []).slice(0, 100).map((r) => ({ id: uid(r.id, 'r'), title: str(r.title, 200), cause: str(r.cause, 800), p: int(r.p, 1, 5, 3), i: int(r.i, 1, 5, 3),
      response: RESP.includes(r.response) ? r.response : 'Mitigate', action: str(r.action, 800), owner: str(r.owner, 80), review: ymdOk(r.review), status: r.status === 'Closed' ? 'Closed' : 'Open', raised: ymdOk(r.raised) })),
    issues: (Array.isArray(p.issues) ? p.issues : []).slice(0, 100).map((x) => ({ id: uid(x.id, 'i'), title: str(x.title, 200), detail: str(x.detail, 800), priority: PRI.includes(x.priority) ? x.priority : 'Medium',
      owner: str(x.owner, 80), raised: ymdOk(x.raised), due: ymdOk(x.due), status: ['Open', 'In progress', 'Resolved'].includes(x.status) ? x.status : 'Open', resolution: str(x.resolution, 800) })),
    baseline: p.baseline && typeof p.baseline === 'object' ? { at: Number(p.baseline.at) || Date.now(), finish: ymdOk(p.baseline.finish), BAC: r2(p.baseline.BAC),
      tasks: Object.fromEntries(Object.entries(p.baseline.tasks || {}).slice(0, 300).map(([k, v]) => [str(k, 20), { es: ymdOk(v.es), ef: ymdOk(v.ef), cost: r2(v.cost) }])) } : null
  };
}

// ---------- storage ----------
export async function get(core) { return kv.get('plan:' + core); }
export async function save(core, plan, rev, by) {
  const c = clean(plan, core);
  let conflict = null, saved = null;
  await kv.update('plan:' + core, (cur) => {
    if (cur && cur.rev && Number(rev) !== cur.rev) { conflict = cur; return cur; }
    saved = { ...c, rev: ((cur && cur.rev) || 0) + 1, created: (cur && cur.created) || Date.now(), updated: Date.now(), by };
    return saved;
  }, null);
  return conflict ? { conflict } : { plan: saved };
}
export async function list() {
  const out = [];
  for (const k of await kv.keys('plan:')) { const p = await kv.get(k); if (p) out.push(p); }
  return out;
}
export async function remind(core, taskId, when, by) {
  const p = await get(core);
  if (!p) return { error: 'Plan not found' };
  const t = p.tasks.find((x) => x.id === taskId);
  if (!t) return { error: 'Task not found' };
  schedule(p);
  let at = null;
  const day = (s, h) => { const [y, m, d] = s.split('-').map(Number); return sydneyTime(y, m, d, h, 0); };
  if (when === 'daybefore') at = day(prevWork(t.es), 7);
  else if (when === 'start') at = day(t.es, 7);
  else if (when === 'due') at = day(t.ef, 7);
  else at = parseWhen(when);
  if (!at || at < Date.now() - 60000) return { error: 'That time has already passed. Try e.g. "tomorrow 8am" or "fri 2pm".' };
  const job = await J.find(core);
  const r = await J.addReminder({ at, text: `${t.name}${job ? ' · ' + J.refFor(job) + ' ' + (job.name || '') : ''} (project plan)`, core, chat: 'alerts', by });
  return { reminder: { ...r, when: whenText(at) } };
}

// ---------- console actions ----------
const H = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const out = (status, body) => new Response(JSON.stringify(body), { status, headers: H });
export async function planPost(action, body, { who, by, audit }) {
  const core = str(body.core, 40);
  if (action === 'planList') {
    const today = new Date().toISOString().slice(0, 10);
    const jobs = Object.fromEntries((await J.all()).map((j) => [j.core, j]));
    const plans = (await list()).map((p) => ({ core: p.core, name: p.name, ref: jobs[p.core] ? jobs[p.core].ref : p.core, customer: jobs[p.core] ? jobs[p.core].name : '', updated: p.updated, ...rollup(p, body.today || today) }));
    return out(200, { plans: plans.sort((a, b) => (b.updated || 0) - (a.updated || 0)) });
  }
  if (action === 'planGet') {
    const job = await J.find(core);
    if (!job) return out(404, { error: 'Job not found' });
    const rems = (await J.reminders()).filter((r) => r.core === job.core).map((r) => ({ ...r, when: whenText(r.at) }));
    let costs = 0;
    try { const idx = (await kv.get('acct-index')) || { expenses: {} }; costs = r2(Object.values(idx.expenses || {}).filter((e) => e.core === job.core).reduce((a, e) => a + (e.inc - e.gst), 0)); } catch {}
    return out(200, { plan: await get(job.core), job: { core: job.core, ref: J.refFor(job), name: job.name, suburb: job.suburb, service: job.service, stage: job.stage }, reminders: rems, expensesEx: costs });
  }
  if (action === 'planSave') {
    if (!core || !(await J.find(core))) return out(404, { error: 'Job not found' });
    const r = await save(core, body.plan || {}, body.rev, by);
    if (r.conflict) return out(409, { error: 'Someone else changed this plan. Your view has been refreshed with their version.', plan: r.conflict });
    if (body.note && audit) await audit(who, `Plan ${core}: ${str(body.note, 120)}`);
    return out(200, { plan: r.plan });
  }
  if (action === 'planRemind') {
    const r = await remind(core, str(body.taskId, 20), str(body.when, 60), by);
    if (r.error) return out(400, { error: r.error });
    if (audit) await audit(who, `Plan ${core}: reminder ${r.reminder.when}`);
    return out(200, r);
  }
  return null;
}
