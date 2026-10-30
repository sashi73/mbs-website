// MBS project planner (PMI style, waterfall): one plan per job, stored in Netlify Blobs as plan:<job core>.
// Scheduling uses working days (Mon-Fri; emergency jobs, and plans with "Weekends allowed" ticked, also Sat and Sun). Tasks: duration, finish-to-start predecessors, "start no earlier than",
// resource, quantity x unit cost, actual cost, % complete. Plus charter (scope), risks, issues and a baseline.
import * as kv from './kv.mjs';
import * as J from './jobs.mjs';
import { parseWhen, whenText, sydneyTime } from './calendar.mjs';
import { env } from './shared.mjs';
import { llmJson, usage, checkLimit, llmSetup, sydToday } from './ai.mjs';
import * as INV from './inventory.mjs';
import * as ACC from './accounts.mjs';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const str = (s, max = 300) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
const ymdOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : '';
const int = (n, lo, hi, d = lo) => { const v = Math.round(Number(n)); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };

// ---------- working days ----------
// Normal jobs: Monday to Friday. Emergency jobs (v34): every day counts, Saturday and Sunday included.
// Each helper takes "all" = true to count weekends; allDays(plan) says which a plan uses.
const toD = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const toS = (d) => d.toISOString().slice(0, 10);
const off = (d, all) => !all && [0, 6].includes(d.getUTCDay());   // a day off?
export const allDays = (plan) => !!(plan && (plan.emergency || plan.weekends));   // v40: "Weekends (Sat, Sun) allowed"
export const isWork = (s, all = false) => !off(toD(s), all);
export function nextWork(s, all = false) { let d = toD(s); while (off(d, all)) d = new Date(d.getTime() + 86400000); return toS(d); }
export function prevWork(s, all = false) { let d = new Date(toD(s).getTime() - 86400000); while (off(d, all)) d = new Date(d.getTime() - 86400000); return toS(d); }
export function addWork(s, n, all = false) {   // n working days after s (s must be a working day)
  let d = toD(s), left = n;
  while (left > 0) { d = new Date(d.getTime() + 86400000); if (!off(d, all)) left--; }
  return toS(d);
}
export function workBetween(a, b, all = false) {   // working days from a up to and including b (0 if b < a)
  if (!a || !b || b < a) return 0;
  let n = 0, d = toD(a); const e = toD(b);
  while (d <= e) { if (!off(d, all)) n++; d = new Date(d.getTime() + 86400000); }
  return n;
}

// ---------- schedule (forward pass) ----------
// which tasks wait for the quote: the "Quote accepted" milestone and everything not leading up to it (site inspection,
// measure and quoting can happen before). With no such milestone: every task except inspection / measure / quote / site visit.
export function gatedTasks(plan) {
  const tasks = plan.tasks || [], byId = Object.fromEntries(tasks.map((t) => [t.id, t]));
  const m = tasks.find((t) => t.dur === 0 && /quote/i.test(t.name));
  const out = new Set();
  if (m) {
    const before = new Set(), walk = (t) => { for (const id of t.pred || []) { const q = byId[id]; if (q && !before.has(q)) { before.add(q); walk(q); } } };
    walk(m);
    for (const t of tasks) if (!before.has(t) && !((t.pct || 0) > 0)) out.add(t);
  } else for (const t of tasks) if (!/inspect|measure|quot|site visit/i.test(t.name) && !((t.pct || 0) > 0)) out.add(t);
  return out;
}
// When can the work (everything after the quote) start?
//   Emergency ticked: straight away (the same day as the site inspection).
//   Otherwise: once the quote is accepted plus a cooling-off period (default 3 business days; the full period is 5).
//   Until the quote is accepted the plan assumes acceptance on the quote date. A "Work starts" date can only make it later.
export const coolOf = (plan) => (plan.coolOff == null || plan.coolOff === '' ? 3 : Math.max(0, Math.min(10, Math.round(Number(plan.coolOff)) || 0)));
export function gateOf(plan) {
  const A = allDays(plan), ymd = /^\d{4}-\d{2}-\d{2}$/, ws = ymd.test(plan.workStart || '') ? nextWork(plan.workStart, A) : '';
  if (plan.emergency) return { date: ws, why: ws ? 'work' : 'emergency' };
  const g = plan.gate, q = g && ymd.test(g.date || '') ? addWork(nextWork(g.date), coolOf(plan)) : '';
  if (ws && ws > q) return { date: ws, why: 'work' };
  return { date: q, why: q ? (g.accepted ? 'accepted' : 'quoted') : '' };
}
export function schedule(plan) {
  const A = allDays(plan);   // emergency: weekends are work days
  const start = nextWork(plan.start || new Date().toISOString().slice(0, 10), A);
  const byId = Object.fromEntries(plan.tasks.map((t) => [t.id, t]));
  const gate = gateOf(plan).date;
  const gated = gate ? gatedTasks(plan) : new Set();
  const quoteMs = plan.emergency ? plan.tasks.find((t) => t.dur === 0 && /quote/i.test(t.name)) : null;   // emergency: work starts the same day as the inspection
  for (const t of plan.tasks) { t.es = ''; t.ef = ''; }
  for (let pass = 0; pass < 30; pass++) {
    let changed = false;
    for (const t of plan.tasks) {
      let es = start;
      if (gated.has(t) && gate > es) es = gate;   // no work before the quote is accepted (or, until then, before it expires)
      if (t.fixed && t.snet) { if (t.snet > es) es = nextWork(t.snet, A); }   // start set by hand: runs in parallel, the "After #" link is not used
      else {
        for (const p of t.pred || []) { const q = byId[p]; if (q && q.ef && q !== t) { const after = t === quoteMs ? q.es : q.dur === 0 ? nextWork(q.ef, A) : addWork(nextWork(q.ef, A), 1, A); if (after > es) es = after; } }
        if (t.snet && t.snet > es) es = nextWork(t.snet, A);
      }
      es = nextWork(es, A);
      const ef = t.dur === 0 ? es : addWork(es, Math.max(1, t.dur) - 1, A);
      if (es !== t.es || ef !== t.ef) { t.es = es; t.ef = ef; changed = true; }
    }
    if (!changed) break;
  }
  return plan;
}
export function rollup(plan, today) {
  schedule(plan);
  const tasks = plan.tasks;
  const A = allDays(plan), frac = (t) => (!t.es ? 0 : today < t.es ? 0 : today >= t.ef ? 1 : workBetween(t.es, today, A) / Math.max(1, workBetween(t.es, t.ef, A)));
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
// people on a task: several names, one of them the lead. "resource" keeps a plain text copy (lead first) for reports.
const STAT = ['todo', 'doing', 'review', 'done'];
const statusOf = (pct) => (pct >= 100 ? 'done' : pct <= 0 ? 'todo' : pct >= 67 ? 'review' : 'doing');
function people(t) {
  let res = Array.isArray(t.res) ? t.res : String(t.resource || '').split(',');
  res = [...new Set(res.map((x) => str(x, 60)).filter(Boolean))].slice(0, 12);
  const lead = res.includes(str(t.lead, 60)) ? str(t.lead, 60) : res[0] || '';
  return { res, lead, resource: [lead, ...res.filter((x) => x !== lead)].filter(Boolean).join(', ').slice(0, 300) };
}
// sub-tasks: always inside their task's dates (off = working days after the task starts, dur = working days),
// no costs of their own; the task's % complete comes from its sub-tasks (weighted by days).
const SPCT = { todo: 0, doing: 33, review: 67, done: 100 };
function cleanSubs(list, t, uid) {
  if (!Array.isArray(list) || t.dur === 0) return [];
  const D = Math.max(1, t.dur);
  return list.slice(0, 40).map((x) => {
    const off = int(x.off, 0, D - 1, 0);
    return { id: uid(x.id, 's'), name: str(x.name, 160) || 'Sub-task', owner: str(x.owner, 80), off, dur: int(x.dur, 1, D - off, 1), status: STAT.includes(x.status) ? x.status : 'todo' };
  });
}
function clean(p, core) {
  const ids = new Set();
  const uid = (v, pre) => { let s = str(v, 20).replace(/[^\w-]/g, '') || pre + Math.random().toString(36).slice(2, 8); while (ids.has(s)) s += 'x'; ids.add(s); return s; };
  const phases = (Array.isArray(p.phases) ? p.phases : []).slice(0, 20).map((f) => ({ id: uid(f.id, 'ph'), name: str(f.name, 80) || 'Phase' }));
  if (!phases.length) phases.push({ id: 'ph1', name: 'Work' });
  const phIds = new Set(phases.map((f) => f.id));
  const tasks = (Array.isArray(p.tasks) ? p.tasks : []).slice(0, 300).map((t) => {
    const o = {
    id: uid(t.id, 't'), name: str(t.name, 160) || 'New task', phase: phIds.has(t.phase) ? t.phase : phases[0].id,
    dur: int(t.dur, 0, 365, 1), snet: ymdOk(t.snet), fixed: !!(t.fixed && ymdOk(t.snet)), pred: (Array.isArray(t.pred) ? t.pred : []).map((x) => str(x, 20)).slice(0, 10),
    item: str(t.item, 12), ...people(t), status: STAT.includes(t.status) ? t.status : statusOf(int(t.pct, 0, 100, 0)), qty: r2(t.qty), unit: str(t.unit, 20), rate: r2(t.rate), actual: r2(t.actual), pct: int(t.pct, 0, 100, 0), notes: str(t.notes, 1000)
    };
    o.subs = cleanSubs(t.subs, o, uid);
    if (o.subs.length) { const w = o.subs.reduce((a, x) => a + x.dur, 0); o.pct = Math.round(o.subs.reduce((a, x) => a + x.dur * SPCT[x.status], 0) / w); o.status = statusOf(o.pct); }
    return o;
  });
  const tIds = new Set(tasks.map((t) => t.id));
  for (const t of tasks) t.pred = t.pred.filter((x) => tIds.has(x) && x !== t.id);
  const c = p.charter || {};
  return {
    core, name: str(p.name, 120) || 'Project plan', start: ymdOk(p.start) || new Date().toISOString().slice(0, 10), workStart: ymdOk(p.workStart), finishBy: ymdOk(p.finishBy), emergency: !!p.emergency, weekends: !!p.weekends, coolOff: int(p.coolOff, 0, 10, 3),
    charter: { objective: str(c.objective, 1500), inScope: str(c.inScope, 3000), outScope: str(c.outScope, 2000), deliverables: str(c.deliverables, 2000),
      acceptance: str(c.acceptance, 2000), assumptions: str(c.assumptions, 2000), notes: str(c.notes, 3000), budget: r2(c.budget), customer: str(c.customer, 120), manager: str(c.manager, 80) },
    phases, tasks,
    risks: (Array.isArray(p.risks) ? p.risks : []).slice(0, 100).map((r) => ({ id: uid(r.id, 'r'), title: str(r.title, 200), cause: str(r.cause, 800), p: int(r.p, 1, 5, 3), i: int(r.i, 1, 5, 3),
      response: RESP.includes(r.response) ? r.response : 'Mitigate', action: str(r.action, 800), owner: str(r.owner, 80), review: ymdOk(r.review), status: r.status === 'Closed' ? 'Closed' : 'Open', raised: ymdOk(r.raised) })),
    issues: (Array.isArray(p.issues) ? p.issues : []).slice(0, 100).map((x) => ({ id: uid(x.id, 'i'), title: str(x.title, 200), detail: str(x.detail, 800), priority: PRI.includes(x.priority) ? x.priority : 'Medium',
      owner: str(x.owner, 80), raised: ymdOk(x.raised), due: ymdOk(x.due), status: ['Open', 'In progress', 'Resolved'].includes(x.status) ? x.status : 'Open', resolution: str(x.resolution, 800) })),
    // v45: stakeholder list (RACI). Contact details stay in the plan and are never sent to the AI.
    stakeholders: (Array.isArray(p.stakeholders) ? p.stakeholders : []).slice(0, 100).map((x) => ({ id: uid(x.id, 's'), name: str(x.name, 120), role: str(x.role, 120),
      raci: ['R', 'A', 'C', 'I'].includes(x.raci) ? x.raci : 'I', phone: str(x.phone, 40), email: str(x.email, 160), sub: /^SC-\d{3,5}$/.test(x.sub || '') ? x.sub : '' })),
    baseline: p.baseline && typeof p.baseline === 'object' ? { at: Number(p.baseline.at) || Date.now(), finish: ymdOk(p.baseline.finish), BAC: r2(p.baseline.BAC),
      tasks: Object.fromEntries(Object.entries(p.baseline.tasks || {}).slice(0, 300).map(([k, v]) => [str(k, 20), { es: ymdOk(v.es), ef: ymdOk(v.ef), cost: r2(v.cost) }])) } : null
  };
}

// ---------- storage ----------
export async function get(core) { return kv.get('plan:' + core); }
export async function save(core, plan, rev, by) {
  const c = clean(plan, core);
  let conflict = null, saved = null;
  const first = await ACC.gateFor(core).catch(() => null);   // the quote (if any) decides the earliest start of the work
  await kv.update('plan:' + core, (cur) => {
    if (cur && cur.rev && Number(rev) !== cur.rev) { conflict = cur; return cur; }
    saved = { ...c, gate: cur ? (cur.gate === undefined ? first : cur.gate) : first, rev: ((cur && cur.rev) || 0) + 1, created: (cur && cur.created) || Date.now(), updated: Date.now(), by };
    return saved;
  }, null);
  return conflict ? { conflict } : { plan: saved };
}
export async function list() {
  const out = [];
  for (const p of await kv.getMany(await kv.keys('plan:'))) if (p) out.push(p);
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
  if (when === 'daybefore') at = day(prevWork(t.es, allDays(p)), 7);
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
// ---------- AI support for risks and issues: "possible resolutions" (DeepSeek, token-capped) ----------
// Sent to the AI: the plan name, the kind of work and suburb, the risk/issue text and a few task names.
// Never sent: the customer's name, phone number or email.
const adviseCap = () => Math.max(150, Math.min(800, Number(env('AI_ADVISE_MAX_TOKENS', '400')) || 400));
export async function advise(core, kind, id, ask, draft) {
  const job = await J.find(core);
  if (!job) return { error: 'Job not found', code: 404 };
  const plan = await get(job.core);
  if (!plan) return { error: 'This job has no plan', code: 404 };
  let item = (kind === 'risk' ? plan.risks : plan.issues || []).find((x) => x.id === id);
  if (draft && typeof draft === 'object') item = { ...(item || {}), ...draft };   // what is on screen (may not be saved yet)
  if (!item || !str(item.title, 200)) return { error: `Write the ${kind} first, then ask the AI.` };
  if (!llmSetup()) return { error: 'AI is not set up yet: add LLM_API_KEY (DeepSeek) in Netlify.', code: 503 };
  try { await checkLimit(); } catch (e) { return { error: e.message, code: 429 }; }
  schedule(plan);
  const ctx = { work: str(job.service, 120), suburb: str(job.suburb, 60), plan: str(plan.name, 100), stage: job.stage,
    tasks: plan.tasks.slice(0, 20).map((t) => `${str(t.name, 50)} (${t.pct}%${t.ef ? ', finish ' + t.ef : ''})`) };
  const it = kind === 'risk'
    ? { risk: str(item.title, 200), cause: str(item.cause, 300), probability_1to5: int(item.p, 1, 5, 3), impact_1to5: int(item.i, 1, 5, 3), current_response: str(item.response, 20), current_action: str(item.action, 300) }
    : { issue: str(item.title, 200), detail: str(item.detail, 300), priority: str(item.priority, 20), due: ymdOk(item.due), status: str(item.status, 20), notes_so_far: str(item.resolution, 300) };
  const system = 'You are an experienced NSW residential building and remedial project manager (waterproofing, painting, tiling, construction). ' +
    `Give POSSIBLE RESOLUTIONS for the ${kind} described, practical for a small builder: safe, compliant, customer-friendly. ` +
    (kind === 'risk' ? 'Cover how to reduce the chance and the impact (PMI responses: avoid, mitigate, transfer, accept). ' : 'Cover the immediate fix and how to stop it happening again. ') +
    'Be brief. Do not invent prices or regulations; say "check with" a licensed trade, engineer, insurer or council where that applies. ' +
    'JSON only: {"options":[{"title":"max 60 chars","response":"' + (kind === 'risk' ? 'Avoid|Mitigate|Transfer|Accept' : 'Fix now|Workaround|Escalate|Prevent') + '","steps":["max 90 chars", "2-3 steps"],"effort":"Low|Medium|High"}] (2-3 options), "watch":"one short thing to keep an eye on"}';
  let o, used;
  try { ({ data: o, used } = await llmJson([{ role: 'system', content: system }, { role: 'user', content: JSON.stringify({ ...it, extra_question: ask || '', job: ctx }) }], { maxTokens: adviseCap(), temperature: 0.3 })); }
  catch (e) { return { error: e.message, code: Number.isInteger(e.code) && e.code >= 400 && e.code < 600 ? e.code : 502 }; }
  const today = await usage(true, used);
  const options = (Array.isArray(o.options) ? o.options : []).slice(0, 4).map((x) => ({ title: str(x.title, 80), response: str(x.response, 20), effort: ['Low', 'Medium', 'High'].includes(x.effort) ? x.effort : '',
    steps: (Array.isArray(x.steps) ? x.steps : []).slice(0, 4).map((t) => str(t, 140)).filter(Boolean) })).filter((x) => x.title);
  if (!options.length) return { error: 'The AI did not suggest anything useful. Add more detail and try again.' };
  return { kind, title: str(item.title, 200), options, watch: str(o.watch, 200), tokens: used, today };
}

// ---------- emergency? (the customer picked "Emergency" in the chat, or the enquiry says so) ----------
export const EMERGENCY_RE = /\bemergenc|\burgent|\basap\b|straight away|right away|immediately|burst (pipe|water)|flood(ing|ed)?\b|storm damage|water (is )?(pouring|coming in|everywhere)/i;
export function isEmergency(job) { return /emergenc/i.test(job.urgency || '') || EMERGENCY_RE.test(`${job.service || ''} ${job.summary || ''} ${job.details || ''}`); }

// ---------- what the job is: a short title and the scope, from the enquiry ----------
const GENERIC = /^((general|website|web|online|new|phone|chat|customer)\s*)?(general|question|enquiry|inquiry|other|ask(ed)?( a)? question|chat|website|quote( request)?|request|contact( us)?|call ?back|message|n\/a|-)?s?$/i;
function tidy(t) { return String(t || '').replace(/\s+/g, ' ').trim(); }
export function jobKind(j) {
  const t = tidy((j.service || '') + ' ' + (j.summary || '')).toLowerCase();
  if (/leak|repair|fix|broken|crack|replace|not working|damaged|rot|peel|mould|mold/.test(t)) return 'Repair';
  if (/question|advice|ask|wonder|how (do|much)/.test(t) && !/quote|install|build|renovat/.test(t)) return 'Question';
  if (/install|new|build|renovat|extension|deck|pergola|fence|paint|tile|retil/.test(t)) return 'New work';
  return 'Job';
}
// a service like "Repair question (Ask Mr. Fixit)" or "General enquiry" says nothing about the work, so the enquiry text is used
const vague = (s) => !s || GENERIC.test(s) || /\bquestions?\b|mr\.? ?fix-?it|\benquir|\binquir/i.test(s);
const ASKED = /\b(?:has |have |had )?(?:asked|asks|is asking|was asking|enquired|enquires|wants|would like|needs|requested|requests|is looking for)\b(?: (?:Mr\.? ?Fix-?it|us|the team|MBS))?(?: (?:a |some )?(?:question|questions|quote|advice|help))?(?: (?:about|for|regarding|whether|if|on|with|to have|to get|to))?\s+/i;
export function workFrom(text) {   // "Customer Sashi from Box Hill has asked about a noisy bathroom exhaust fan…" -> "Noisy bathroom exhaust fan…"
  let t = tidy(text).replace(/^(summary|brief|enquiry)\s*[:\-]\s*/i, '');
  if (!t) return '';
  const q = t.match(/[“"]([^”"]{8,400})[”"]/);
  if (q) t = q[1];
  else { const m = t.slice(0, 240).match(ASKED); if (m) t = t.slice(m.index + m[0].length); }
  t = t.replace(/^(hi|hello|hey|g'?day)[,!.\s]+/i, '')
    .replace(/^(please\s+)?(can|could|would) (you|someone|u|your team) (please )?(help( me| us)?( to| with)? |come and |have a look at )?/i, '')
    .replace(/^how (do|can|should|would|much) (i|we|you|it cost to) (go about )?/i, '')
    .replace(/^(i|we) (need|want|would like|'d like|am looking for|are looking for|have)( (to have|to get|someone to|to))? /i, '')
    .replace(/^(a |an )?(free )?(quote|price|estimate|advice) (to|for|on|about) /i, '')
    .replace(/^(my|our|their|his|her|the|a|an) /i, '');
  const parts = t.split(/(?<=[.!?])\s+|\n|\s(?=(?:Best time|The best time|Photos? (?:were|was|are)|No photos|The customer would like|They would like|Customer would like))/i).map((x) => x.replace(/[.!?,;:\s]+$/, '')).filter(Boolean);
  let out = parts[0] || '';
  out = out.replace(/[,;]?\s+(what|how|can|could|should|would|any|is it|do you|does anyone)\b[^.]*$/i, (m) => out.length - m.length >= 15 ? '' : m);
  if (out.length < 50 && parts[1] && out.length + parts[1].length < 95 && !/^(best time|photos?|no photos|please|thanks|thank you|the customer would|can|could|would|what|how|is it|do you|any)\b/i.test(parts[1])) out += '; ' + parts[1].replace(/^(it|this|that) /i, (w) => w.toLowerCase());
  if (out.length > 95) out = out.slice(0, 92).replace(/[\s,;]+\S*$/, '') + '…';
  return out;
}
export function jobTitle(j) {   // the work itself, from the customer's words or the enquiry brief; the service name if there's nothing better
  let s = tidy(j.service);
  const w = workFrom(j.details) || workFrom(j.summary);
  if (w && (vague(s) || s.length > 60 || w.length > s.length + 8)) s = w;
  else if (vague(s)) s = '';
  s = s || 'Job';
  return s.charAt(0).toUpperCase() + s.slice(1);
}
export function jobScope(j) {
  const parts = [];
  if (tidy(j.service) && !vague(tidy(j.service))) parts.push(tidy(j.service));
  if (tidy(j.details) && !tidy(j.summary).includes(tidy(j.details).slice(0, 60))) parts.push('Customer\'s words: ' + String(j.details).trim());
  if (tidy(j.summary)) parts.push(String(j.summary).trim());
  const notes = (j.notes || []).map((n) => tidy(n.text)).filter(Boolean).slice(-5);
  if (notes.length) parts.push('Notes: ' + notes.join(' | '));
  return parts.join('\n\n').slice(0, 3000);
}

// the enquiry text often starts "Customer Sashi Kumar from …": take names, phone numbers and emails out before it goes to the AI
export function privateOut(text, job = {}) {
  let t = String(text || '').replace(/[^\s@]+@[^\s@]+\.[A-Za-z]{2,}(\.[A-Za-z]{2,})*/g, '[email]').replace(/\+?\d[\d\s()-]{6,}\d/g, '[phone]');
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const name = tidy(job.name);
  if (name) t = t.replace(new RegExp(esc(name), 'gi'), 'the customer');
  for (const part of name.split(/\s+/).filter((x) => x.length >= 3)) t = t.replace(new RegExp('\\b' + esc(part) + '\\b', 'gi'), 'the customer');
  return t.replace(/\b(customer )?the customer( the customer)+/gi, 'the customer').replace(/\bcustomer the customer\b/gi, 'the customer');
}

// ---------- ✨ AI builds a plan (runs in a background function, so it can take longer than a normal request) ----------
const planCap = () => Math.max(800, Math.min(4000, Number(env('AI_PLAN_MAX_TOKENS', '3000')) || 3000));   // AI plan reply cap: default 3000, AI_PLAN_MAX_TOKENS 800-4000
export async function buildAiPlan({ core, describe, scope, type, start, finish, emergency, weekends }, by) {
  const job = core ? await J.find(core) : null;
  if (!job) return { error: 'Job not found' };
  const text = privateOut(str(describe, 1500) || str(scope, 1500), job);   // never send the customer's name, phone or email
  if (text.length < 10) return { error: 'Describe the job first (what the customer wants done).' };
  if (!llmSetup()) return { error: 'AI is not set up yet: add LLM_API_KEY (DeepSeek) in Netlify.' };
  try { await checkLimit(); } catch (e) { return { error: e.message }; }
  const system = 'You are an experienced NSW residential building and remedial project manager. Build a practical WATERFALL project plan for a small builder from the job description. ' +
    'Include: site inspection, quote accepted (milestone, 0 days), any approvals needed (council, strata, engineer), ordering materials with realistic lead times, the trade work in the right order (with sub-steps where useful), inspections/tests (e.g. flood test), clean-up, handover and invoice (milestone). ' +
    'Days are working days (Monday to Friday; if emergency or weekends_allowed is true, every day counts, Saturday and Sunday included). "after" lists the task numbers (1-based) that must finish first. Sub-tasks must fit inside their task: [name, start offset in days from the task start, days]. ' +
    'Costs: qty, unit (h, m², L, lot, each) and a typical Sydney rate ex GST for labour or materials; use 0 if unsure. Do not invent council rules; say "check with council" where relevant. ' +
    'Also work out the SCOPE for this job: in_scope (the work included, as short "- " lines), out_of_scope (what is NOT included, to avoid arguments later), deliverables (e.g. certificates, photos, finished work), acceptance (how the customer knows it is done) and assumptions/constraints. ' +
    'And the RISKS specific to this job (4-6): [title, cause, probability 1-5, impact 1-5, response Avoid|Mitigate|Transfer|Accept, action]. Plus 3-6 short planning tips (lead times, permits, weather, inspections, access, safety). Keep every text short. ' +
    'Dates: start_date is when the plan starts (site inspection). Unless emergency is true, the work after "quote accepted" waits cooling_off_days business days; if emergency is true, the work starts the same day as the site inspection. ' +
    'If finish_by is given, the whole plan must finish by then: everything has to fit in working_days_available (order long-lead items first, run tasks in parallel only where it is safe and give those tasks the same "after"). If it truly cannot fit, say so in the FIRST tip with the realistic number of working days. ' +
    'Set "emergency": true only if the description says it is an emergency or urgent (e.g. burst pipe, active leak doing damage, storm damage, "ASAP"). ' +
    'JSON only: {"emergency":false,"name":"short plan name","objective":"one sentence","in_scope":"","out_of_scope":"","deliverables":"","acceptance":"","assumptions":"","tips":[""],"tasks":[{"n":"","d":1,"after":[],"q":0,"u":"h","r":0,"s":[["",0,1]]}],"risks":[["","",3,3,"Mitigate",""]]}';
  const st = ymdOk(start) || new Date().toISOString().slice(0, 10), fin = ymdOk(finish);
  const user = { job_type: str(type, 120), work: str(job.service, 120), suburb: str(job.suburb, 60), start_date: st, emergency: !!emergency, weekends_allowed: !!weekends, cooling_off_days: emergency ? 0 : 3, description: text };
  if (fin && fin >= st) { user.finish_by = fin; user.working_days_available = workBetween(nextWork(st, !!(emergency || weekends)), fin, !!(emergency || weekends)); }
  let o, used;
  try { ({ data: o, used } = await llmJson([{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(user) }], { maxTokens: planCap(), timeoutMs: 150000, temperature: 0.3 })); }
  catch (e) { return { error: e.message }; }
  const today = await usage(true, used);
  const tasks = (Array.isArray(o.tasks) ? o.tasks : []).slice(0, 40).map((t) => ({
    n: str(t.n || t.name, 160), d: int(t.d ?? t.days, 0, 120, 1), after: (Array.isArray(t.after) ? t.after : []).map((x) => int(x, 1, 40, 0)).filter(Boolean),
    q: Math.max(0, r2(t.q)), u: str(t.u, 12), r: Math.max(0, r2(t.r)), s: (Array.isArray(t.s) ? t.s : []).slice(0, 12).map((x) => Array.isArray(x) ? [str(x[0], 120), int(x[1], 0, 120, 0), int(x[2], 1, 120, 1)] : null).filter((x) => x && x[0])
  })).filter((t) => t.n);
  if (tasks.length < 2) return { error: 'The AI did not return a usable plan. Add a bit more detail and try again.', tokens: used, today };
  tasks.forEach((t, i) => { t.after = t.after.filter((a) => a <= tasks.length && a !== i + 1); });
  const list = (x, n, m) => (Array.isArray(x) ? x : []).slice(0, n).map((v) => str(v, m)).filter(Boolean);
  const txt = (x, m) => Array.isArray(x) ? x.map((v) => str(v, 300)).filter(Boolean).map((v) => /^[-•]/.test(v) ? v : '- ' + v).join('\n').slice(0, m) : str(x, m);
  // risks: [title, cause, p, i, response, action]; older shape [title, p, i, response, action] also accepted. Sent on as [title, p, i, response, action, cause]
  const risks = (Array.isArray(o.risks) ? o.risks : []).slice(0, 8).map((r) => {
    if (r && !Array.isArray(r) && typeof r === 'object') r = [r.title, r.cause, r.p ?? r.probability, r.i ?? r.impact, r.response, r.action];
    if (!Array.isArray(r)) return null;
    const old = typeof r[1] === 'number' || /^\d$/.test(String(r[1]));
    const [t, c, p, i, resp, act] = old ? [r[0], '', r[1], r[2], r[3], r[4]] : r;
    return [str(t, 160), int(p, 1, 5, 3), int(i, 1, 5, 3), RESP.includes(resp) ? resp : 'Mitigate', str(act, 300), str(c, 300)];
  }).filter((r) => r && r[0]);
  return { plan: { emergency: o.emergency === true, name: str(o.name, 100), objective: str(o.objective, 400), inScope: txt(o.in_scope, 1500), outScope: txt(o.out_of_scope, 800), deliverables: txt(o.deliverables, 800), acceptance: txt(o.acceptance, 600),
    assumptions: txt(o.assumptions, 800), tips: list(o.tips, 8, 240), tasks, risks }, tokens: used, today };
}

// ---------- dashboard pipeline board: New enquiry > Called > Site visit, planned & quoted > Job won > In progress > Completed > Invoiced > Closed ----------
export const BOARD_COLS = ['new', 'called', 'visit', 'won', 'progress', 'completed', 'invoiced', 'closed'];
const VISIT_RE = /site visit|inspect|measure|look at|on site|quote visit|visit/i;
export async function pipelineBoard(body = {}) {
  const now = Date.now(), today = /^\d{4}-\d{2}-\d{2}$/.test(String(body.today || '')) ? body.today : sydToday(now);
  const days = int(body.closedDays, 0, 3650, 30);
  const [list, planKeys, rems, acc] = await Promise.all([J.all(), kv.keys('plan:'), J.reminders(), ACC.index().catch(() => ({ quotes: {}, invoices: {} }))]);
  const docOf = {};   // latest quote / invoice (not void) per job, for the drag-and-drop choices
  for (const g of ['quotes', 'invoices']) for (const d of Object.values(acc[g] || {}).sort((a, b) => (a.id > b.id ? 1 : -1))) if (d.core && d.status !== 'void') { docOf[d.core] = docOf[d.core] || {}; docOf[d.core][g === 'quotes' ? 'q' : 'i'] = { id: d.id, status: d.status, inc: d.inc, balance: d.balance || 0 }; }
  const planned = new Set(planKeys.map((k) => k.slice(5)));
  const closedAt = (j) => j.paid_at || j.lost_at || j.updated || j.created || 0;
  const keep = list.filter((j) => J.OPEN.includes(j.stage) || (['paid', 'lost'].includes(j.stage) && (!days || closedAt(j) >= now - days * 864e5)));
  const [full, plans] = await Promise.all([kv.getMany(keep.map((j) => 'job:' + j.core)), kv.getMany(keep.filter((j) => planned.has(j.core)).map((j) => 'plan:' + j.core))]);
  const planOf = Object.fromEntries(plans.filter(Boolean).map((p) => [p.core, p]));
  const remOf = {};
  for (const r of rems) if (r.core && r.at >= now - 864e5 && (!remOf[r.core] || r.at < remOf[r.core].at)) remOf[r.core] = r;
  const cards = keep.map((ix, i) => {
    const j = full[i] || ix, p = planOf[j.core] || null, rem = remOf[j.core] || null;
    const visit = rem && VISIT_RE.test(rem.text || '') ? rem : null;
    let R = null;
    if (p && p.tasks && p.tasks.length) { try { R = rollup(JSON.parse(JSON.stringify(p)), today); } catch { R = null; } }
    const started = !!(p && p.tasks && p.tasks.some((t) => (t.pct || 0) > 0 || ['doing', 'review', 'done'].includes(t.status)));
    // a site visit booked, a project plan made or a quote sent all put the job in "Site visit, planned & quoted"
    const col = j.stage === 'new' ? (p ? 'visit' : 'new') : j.stage === 'called' ? (visit || p ? 'visit' : 'called') : j.stage === 'quoted' ? 'visit'
      : j.stage === 'won' ? (p && started ? 'progress' : 'won') : j.stage === 'completed' ? 'completed' : j.stage === 'invoiced' ? 'invoiced' : 'closed';
    const since = { new: j.created, called: j.called_at, quoted: j.quoted_at, won: j.won_at, completed: j.completed_at, invoiced: j.invoiced_at, paid: j.paid_at, lost: j.lost_at }[j.stage] || j.updated || j.created;
    return { core: j.core, ref: J.refFor(j), name: j.name || 'Customer', suburb: j.suburb || '', title: jobTitle(j), kind: jobKind(j), stage: j.stage, col, since: since || 0,
      value: j.invoice ? j.invoice.amount : j.quote ? j.quote.amount : 0, valueKind: j.invoice ? 'invoice' : j.quote ? 'quote' : '', source: j.source || '', photos: (j.photos || []).length,
      quote: (docOf[j.core] || {}).q || null, invoice: (docOf[j.core] || {}).i || null, emergency: !!(p && p.emergency) || isEmergency(j),
      next: rem ? { at: rem.at, text: String(rem.text || '').slice(0, 120), when: whenText(rem.at) } : null, visit: !!visit,
      plan: p ? { name: p.name, pct: R ? R.pct : 0, SPI: R ? R.SPI : null, CPI: R ? R.CPI : null, start: R ? R.start : '', finish: R ? R.finish : '', late: R ? R.late : 0, done: R ? R.done : 0, total: R ? R.total : 0, highRisks: R ? R.highRisks : 0, openIssues: R ? R.openIssues : 0 } : null };
  });
  return { cards, cols: BOARD_COLS, closedDays: days, at: now, today };
}

// ---------- v38: ✨ fit the plan to a "Finish by" date (runs in the background function) ----------
// The AI suggests fast-tracking (tasks alongside each other) and crashing (more crew / longer hours) on the critical path.
// The code then checks every suggestion: nothing protected is shortened, no task below half its days or made longer,
// no circular "after" links, and it reschedules to prove the new finish. Nothing is saved here: the console shows a preview.
const PROTECTED = /(council|approv|permit|certif|engineer|strata|lead.?time|order|deliver|supply|cur(e|ing)|dry|drying|set(ting)? time|flood test|water test|inspect|test|quote|handover|invoice|payment)/i;
function wouldLoop(byId, startId) {   // does following "after" links from startId come back to it?
  const seen = new Set(), stack = [...(byId[startId].pred || [])];
  while (stack.length) { const id = stack.pop(); if (id === startId) return true; if (seen.has(id) || !byId[id]) continue; seen.add(id); stack.push(...(byId[id].pred || [])); }
  return false;
}
function clampSubs(t) {
  const D = Math.max(1, t.dur);
  for (const x of t.subs || []) { x.dur = Math.max(1, Math.min(D, Math.round(+x.dur || 1))); x.off = Math.max(0, Math.min(D - x.dur, Math.round(+x.off || 0))); }
}
// task names to the AI: take out the customer's full name, phone and email only (not every word of the name:
// a customer called "Tina Tiles" must not turn "Lay tiles" into "Lay the customer")
function scrubTask(s, job) {
  let x = String(s || '');
  const rx = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (job.name && job.name.trim().length >= 3) x = x.replace(new RegExp(rx(job.name.trim()), 'gi'), 'the customer');
  if (job.email) x = x.replace(new RegExp(rx(job.email), 'gi'), '');
  const ph = String(job.phone || '').replace(/\D/g, '');
  if (ph.length >= 6) x = x.replace(/[\d][\d\s()+-]{5,}[\d]/g, (m) => (m.replace(/\D/g, '').includes(ph.slice(-6)) ? '' : m));
  return x.trim();
}
export async function fitPlanAi({ core, finishBy }, by) {
  const job = core ? await J.find(core) : null;
  if (!job) return { error: 'Job not found' };
  const p0 = await get(job.core);
  if (!p0) return { error: 'This job has no plan' };
  const fb = ymdOk(finishBy);
  if (!fb) return { error: 'Set the "Finish by" date first.' };
  const plan = JSON.parse(JSON.stringify(p0)), A = allDays(plan), today = sydToday();
  const R = rollup(plan, today);
  if (!R.finish) return { error: 'The plan has no dates yet.' };
  if (R.finish <= fb) return { fits: true, already: true, before: R.finish, after: R.finish, finishBy: fb, changes: [], rev: p0.rev || 0 };
  if (fb < (R.start || fb)) return { error: 'The "Finish by" date is before the project starts.' };
  if (!llmSetup()) return { error: 'AI is not set up yet: add LLM_API_KEY (DeepSeek) in Netlify.' };
  try { await checkLimit(); } catch (e) { return { error: e.message }; }
  const late = workBetween(fb, R.finish, A) - 1;
  // which tasks drive the finish date (one more day on them moves the finish)
  const crit = new Set();
  for (const t of plan.tasks) {
    if (!(t.dur > 0) || (t.pct || 0) >= 100) continue;
    const q = JSON.parse(JSON.stringify(plan)); const qt = q.tasks.find((x) => x.id === t.id); qt.dur += 1; schedule(q);
    if (q.tasks.reduce((m, x) => (x.ef > m ? x.ef : m), '') > R.finish) crit.add(t.id);
  }
  const locked = (t) => t.dur === 0 || (t.pct || 0) > 0 || PROTECTED.test(t.name || '');
  const tasks = plan.tasks.slice(0, 60).map((t) => ({ id: t.id, n: scrubTask(str(t.name, 120), job), d: t.dur, after: t.pred || [], start: t.es, finish: t.ef, crit: crit.has(t.id),
    locked: locked(t), started: (t.pct || 0) > 0, start_set_by_hand: !!t.fixed, qty: t.qty || 0, unit: t.unit || '', rate: t.rate || 0, people: (t.res || []).length }));
  const system = 'You are an experienced NSW residential building project scheduler. The plan below must finish by finish_by but currently finishes on current_finish, days_late working days late. ' +
    'Compress the schedule with the least risk and cost, using two techniques: (1) FAST-TRACK: let a task start alongside its predecessor instead of after it, by changing its "after" list, only where the trades can safely work at the same time or on different areas; ' +
    '(2) CRASH: shorten a task\'s days by adding crew or longer hours, and give extra_cost (ex GST, AUD) for the extra labour or overtime, 0 if none. ' +
    'Work on critical tasks (crit=true) first: changing tasks that are not critical does not move the finish. NEVER change tasks with locked=true (milestones, approvals and council/certifier/engineer/strata, ordering, lead times and deliveries, curing/drying/setting times, inspections and tests, work already started). ' +
    'Never make a task longer, never shorten a task below half its days, and keep the work order safe and sensible (for example waterproofing must cure and pass its flood test before tiling). ' +
    'Days are ' + (A ? 'calendar days, Saturday and Sunday included (' + (plan.emergency ? 'emergency job' : 'weekend work allowed') + ')' : 'working days, Monday to Friday') + '. If it truly cannot fit, do the best you can and set can_fit false with realistic_extra_days (days still late). ' +
    'JSON only: {"changes":[{"id":"","d":0,"after":[""],"why":"short reason","extra_cost":0}],"can_fit":true,"realistic_extra_days":0,"summary":"two short sentences","risks":[["title","cause",3,3,"Mitigate","action"]],"tips":[""]}. ' +
    'List only the tasks you change; leave out "d" if the days stay the same and "after" if the links stay the same.';
  const user = { plan: scrubTask(str(plan.name, 120), job), emergency: !!plan.emergency, weekends_allowed: !!plan.weekends, start: R.start, current_finish: R.finish, finish_by: fb, days_late: late,
    working_days_available: workBetween(R.start, fb, A), tasks };
  let o, used;
  try { ({ data: o, used } = await llmJson([{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(user) }], { maxTokens: 1800, timeoutMs: 150000, temperature: 0.2 })); }
  catch (e) { return { error: e.message }; }
  const todayUse = await usage(true, used);
  // check and apply every suggestion on a copy
  const q = JSON.parse(JSON.stringify(p0)), byId = Object.fromEntries(q.tasks.map((t) => [t.id, t])), orig = Object.fromEntries(p0.tasks.map((t) => [t.id, t]));
  const changes = [], refused = [];
  const seenIds = new Set();
  for (const c of (Array.isArray(o.changes) ? o.changes : []).slice(0, 60)) {
    const t = c && byId[c.id]; if (!t || seenIds.has(t.id)) continue;   // one change per task
    seenIds.add(t.id);
    const name = t.name, o0 = orig[t.id];
    if (locked(o0)) { refused.push(`${name}: kept as it is (it can't be rushed)`); continue; }
    const ch = { id: t.id, name, durFrom: o0.dur, durTo: o0.dur, afterFrom: [...(o0.pred || [])], afterTo: [...(o0.pred || [])], why: str(c.why, 200), extra: Math.max(0, Math.min(100000, r2(c.extra_cost))) };
    if (c.d != null) {
      const d = int(c.d, 0, 365, o0.dur);
      if (d < o0.dur && d >= Math.ceil(o0.dur / 2)) { t.dur = d; clampSubs(t); ch.durTo = d; }
      else if (d < o0.dur) refused.push(`${name}: not shortened below half its days`);
    }
    if (Array.isArray(c.after) && !t.fixed) {
      const was = t.pred; t.pred = [...new Set(c.after.map(String).filter((x) => byId[x] && x !== t.id))];
      if (wouldLoop(byId, t.id)) { t.pred = was; refused.push(`${name}: that order would go in a circle, so it was kept`); }
      else ch.afterTo = [...t.pred];
    }
    const sameAfter = ch.afterTo.length === ch.afterFrom.length && ch.afterTo.every((x) => ch.afterFrom.includes(x));
    if (ch.durTo !== ch.durFrom || !sameAfter) changes.push(ch);
  }
  const R2 = rollup(q, today);
  // weekdays only and still late: what would allowing weekends (Sat, Sun) on top of these changes give?
  let weekend = null;
  if (R2.finish > fb && !A) { const w = JSON.parse(JSON.stringify(q)); w.weekends = true; const Rw = rollup(w, today); weekend = { finish: Rw.finish, fits: Rw.finish <= fb, stillLate: Rw.finish > fb ? workBetween(fb, Rw.finish, true) - 1 : 0 }; }
  const num = Object.fromEntries(q.tasks.map((t, i) => [t.id, i + 1]));
  for (const c of changes) { c.num = num[c.id]; c.afterFromN = c.afterFrom.map((x) => num[x]).filter(Boolean); c.afterToN = c.afterTo.map((x) => num[x]).filter(Boolean); }
  const risks = (Array.isArray(o.risks) ? o.risks : []).slice(0, 5).map((r) => Array.isArray(r) ? { title: str(r[0], 160), cause: str(r[1], 300), p: int(r[2], 1, 5, 3), i: int(r[3], 1, 5, 3), response: RESP.includes(r[4]) ? r[4] : 'Mitigate', action: str(r[5], 300) } : null).filter((r) => r && r.title);
  return { fits: R2.finish <= fb, before: R.finish, after: R2.finish, finishBy: fb, late, stillLate: R2.finish > fb ? workBetween(fb, R2.finish, A) - 1 : 0, changes, refused,
    extraTotal: r2(changes.reduce((a, c) => a + c.extra, 0)), summary: str(o.summary, 500), tips: (Array.isArray(o.tips) ? o.tips : []).slice(0, 5).map((x) => str(x, 200)).filter(Boolean),
    risks, critical: [...crit].map((id) => num[id]).filter(Boolean), weekend, rev: p0.rev || 0, tokens: used, today: todayUse };
}

export async function planPost(action, body, { who, by, audit }) {
  const core = str(body.core, 40);
  if (action === 'planList') {
    const today = new Date().toISOString().slice(0, 10);
    const [jobList, planList] = await Promise.all([J.all(), list()]);
    const jobs = Object.fromEntries(jobList.map((j) => [j.core, j]));
    const plans = planList.map((p) => ({ core: p.core, name: p.name, ref: jobs[p.core] ? jobs[p.core].ref : p.core, customer: jobs[p.core] ? jobs[p.core].name : '', updated: p.updated, ...rollup(p, body.today || today) }));
    return out(200, { plans: plans.sort((a, b) => (b.updated || 0) - (a.updated || 0)) });
  }
  if (action === 'planGet') {
    const job = await J.find(core);
    if (!job) return out(404, { error: 'Job not found' });
    const [remsAll, idx, plan] = await Promise.all([J.reminders(), kv.get('acct-index').catch(() => null), get(job.core)]);
    const rems = remsAll.filter((r) => r.core === job.core).map((r) => ({ ...r, when: whenText(r.at) }));
    let costs = 0;
    try { costs = r2(Object.values((idx && idx.expenses) || {}).filter((e) => e.core === job.core).reduce((a, e) => a + (e.inc - e.gst), 0)); } catch {}
    return out(200, { plan, job: { core: job.core, ref: J.refFor(job), name: job.name, suburb: job.suburb, service: job.service, stage: job.stage, source: job.source || '', title: jobTitle(job), phone: job.phone || '', email: job.email || '', scope: jobScope(job), urgency: job.urgency || '', emergency: isEmergency(job) }, reminders: rems, expensesEx: costs });
  }
  if (action === 'planSave') {
    if (!core || !(await J.find(core))) return out(404, { error: 'Job not found' });
    const before = await get(core);
    const r = await save(core, body.plan || {}, body.rev, by);
    if (r.conflict) return out(409, { error: 'Someone else changed this plan. Your view has been refreshed with their version.', plan: r.conflict });
    if (body.note && audit) await audit(who, `Plan ${core}: ${str(body.note, 120)}`);
    let low = [];
    try { low = await INV.syncPlan(core, before, r.plan, by); } catch (e) { console.error('Stock update from plan failed:', e.message); }
    return out(200, { plan: r.plan, low });
  }
  if (action === 'pipelineBoard') {   // the dashboard's big Kanban: every open job (and recently closed ones) in its pipeline column
    const out2 = await pipelineBoard(body); return out(200, out2);
  }
  if (action === 'planJobs') {   // open jobs without a plan, labelled "Customer: what the job is"
    const [list, keys] = await Promise.all([J.all(), kv.keys('plan:')]);
    const planned = new Set(keys.map((k) => k.slice(5)));
    const open = list.filter((j) => J.OPEN.includes(j.stage) && !planned.has(j.core)).sort((a, b) => b.created - a.created).slice(0, 150);
    const full = await kv.getMany(open.map((j) => 'job:' + j.core));
    return out(200, { jobs: full.filter(Boolean).map((j) => ({ core: j.core, ref: J.refFor(j), name: j.name || 'Customer', suburb: j.suburb || '', title: jobTitle(j), kind: jobKind(j),
      service: j.service || '', stage: j.stage || '', created: j.created || 0, bestTime: j.best_time || '', source: j.source || '', photos: (j.photos || []).length, scope: jobScope(j).slice(0, 1500) })) });
  }
  if (action === 'planAiStatus') {
    const id = str(body.id, 40).replace(/[^a-z0-9]/gi, '');
    const r = id ? await kv.get('aiplan:' + id) : null;
    return out(200, r || { status: 'waiting' });
  }
  if (action === 'planAdvise') {
    const r = await advise(core, body.kind === 'issue' ? 'issue' : 'risk', str(body.id, 20), str(body.ask, 300), body.item);
    if (r.error) return out(r.code || 400, { error: r.error });
    if (audit) await audit(who, `Plan ${core}: asked AI about ${body.kind === 'issue' ? 'issue' : 'risk'} "${str(r.title, 60)}"`);
    return out(200, r);
  }
  if (action === 'planDelete') {
    const job = await J.find(core);
    if (!job) return out(404, { error: 'Job not found' });
    const had = await get(job.core);
    if (!had) return out(404, { error: 'This job has no plan' });
    await kv.del('plan:' + job.core);
    try { await INV.refresh((had.tasks || []).map((t) => t.item), by); } catch (e) { console.error('Stock refresh failed:', e.message); }
    if (audit) await audit(who, `Plan ${job.core}: deleted ("${had.name}")`);
    return out(200, { ok: true });
  }
  if (action === 'planRemind') {
    const r = await remind(core, str(body.taskId, 20), str(body.when, 60), by);
    if (r.error) return out(400, { error: r.error });
    if (audit) await audit(who, `Plan ${core}: reminder ${r.reminder.when}`);
    return out(200, r);
  }
  return null;
}
