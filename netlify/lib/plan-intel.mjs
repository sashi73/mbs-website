// v52: 🧠 Project Intelligence. Ask anything about one project: the AI (DeepSeek) answers from the whole plan (tasks, dates,
// critical path, costs, risks, issues, stakeholders, meetings) and from documents uploaded to the project (contract,
// specifications, quotes, letters). It can also suggest risks for the register, a stakeholder register, and set up a
// team meeting (the console turns that into a Google Calendar invite with Google Meet, and an .ics file).
//   pdocs:<core>               the project's documents (name, size, pages, characters)
//   pdoctext:<core>:<id>       the text taken out of a document (in the browser, with PDF.js / Mammoth)
//   pdocfile:<core>:<id>       the original file (up to 3.5 MB), for downloading again
//   pchat:<core>               the last 30 questions and answers, so the team sees them
// Privacy: the customer's name, phone numbers and emails are taken out of everything before it goes to the AI.
// Stakeholders go as a reference (S1, S2 ...), name and role only; their phone numbers and emails never leave MBS.
import * as kv from './kv.mjs';
import * as J from './jobs.mjs';
import * as P from './plan.mjs';
import { llmJson, usage, checkLimit, llmSetup, sydToday } from './ai.mjs';
import * as SWMS from './swms.mjs';
import * as PG from './programs.mjs';

const str = (s, max = 300) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
const H = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const out = (status, body) => new Response(JSON.stringify(body), { status, headers: H });
const MAX_TEXT = 400000, MAX_FILE = 3.5 * 1024 * 1024, MAX_DOCS = 30, CONTEXT_CHARS = 36000;

// ---------- change control records (signed decisions, kept for good) ----------
//   champ-cr-records           one row per decision: who approved, when, the effect, the plan's CR number (all projects)
//   crpdf:<core>:<key>         the signed change request PDF, exactly as it was at the decision
const CR_MAX = 5000, CR_PDF_MAX = 4 * 1024 * 1024;
export async function crRecords(core) { const L = ((await kv.get('champ-cr-records')) || { list: [] }).list; return core ? L.filter((r) => r.core === core) : L; }
async function crSave(job, body, who) {
  const c = body.cr || {}, dec = c.decision || {}, num = Math.max(0, Math.round(Number(c.num) || 0));
  if (!num || !dec.outcome) return { error: 'A change request with a decision is needed' };
  const at = Number(dec.at) || Date.now(), key = 'r' + at.toString(36) + num.toString(36);
  let hasPdf = false;
  if (body.file) { const buf = Buffer.from(String(body.file), 'base64'); if (buf.length && buf.length <= CR_PDF_MAX) { await kv.putFile(`crpdf:${job.core}:${key}`, buf, { name: str(body.name, 160) || `CR-${num}.pdf`, type: 'application/pdf' }); hasPdf = true; } }
  const e = c.effect || {}, n = (x) => Math.round((Number(x) || 0) * 100) / 100;
  const rec = { key, core: job.core, project: str(body.project, 160), program: str(job.program || '', 120), cr: 'CR-' + String(num).padStart(3, '0'), crId: str(c.id, 30), num,
    title: str(c.title, 300), desc: str(c.desc, 2000), reason: str(c.reason, 2000), source: str(c.source, 20), raisedBy: str(c.raisedBy, 80), raisedAt: Number(c.raisedAt) || 0,
    outcome: str(dec.outcome, 30), status: str(c.status, 30), by: str(dec.by, 80), role: str(dec.role, 60), sig: str(dec.sig, 80), at, note: str(dec.note, 1000),
    implementedAt: Number(c.implementedAt) || 0, f0: str(e.f0, 10), f1: str(e.f1, 10), b0: n(e.b0), b1: n(e.b1), days: Math.round(Number(e.days) || 0), cost: n(e.cost), est: !!e.est,
    direct: !!c.direct, recordedBy: str(who, 80), recordedAt: Date.now(), hasPdf, text: str(body.text, 6000) };
  await kv.update('champ-cr-records', (x) => { x.list = (x.list || []).filter((r) => !(r.core === rec.core && r.crId === rec.crId && r.at === rec.at)).concat([rec]).slice(-CR_MAX); return x; }, () => ({ list: [] }));
  return { record: rec };
}

// ---------- documents ----------
async function docList(core) { return ((await kv.get('pdocs:' + core)) || { docs: [] }).docs; }
export async function upload(core, f, by) {
  const job = await J.find(core); if (!job) return { error: 'Job not found' };
  const name = str(f.name, 160).replace(/[\\/]/g, '-') || 'document.txt', text = String(f.text || '').replace(/\u0000/g, '').slice(0, MAX_TEXT);
  if (!text.trim()) return { error: 'No text could be read from "' + name + '". If it is a scanned PDF (a picture of the pages), save it as a text PDF or Word file first.' };
  const docs = await docList(job.core);
  if (docs.length >= MAX_DOCS) return { error: `A project can hold ${MAX_DOCS} documents. Delete one first.` };
  const id = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  let hasFile = false;
  if (f.file) {
    const buf = Buffer.from(String(f.file), 'base64');
    if (buf.length && buf.length <= MAX_FILE) { await kv.putFile(`pdocfile:${job.core}:${id}`, buf, { name, type: str(f.type, 100) }); hasFile = true; }
  }
  await kv.set(`pdoctext:${job.core}:${id}`, { text });
  const d = { id, name, type: str(f.type, 100), size: Math.max(0, Number(f.size) || 0), pages: Math.max(0, Math.round(Number(f.pages) || 0)), chars: text.length, words: text.split(/\s+/).filter(Boolean).length,
    kind: str(f.kind, 40) || guessKind(name, text), at: Date.now(), by: str(by, 60), hasFile, contractId: str(f.contractId, 30) };
  await kv.update('pdocs:' + job.core, (x) => { x.docs = (x.docs || []).concat([d]); return x; }, () => ({ docs: [] }));
  return { doc: d, truncated: String(f.text || '').length > MAX_TEXT };
}
function guessKind(name, text) {
  const s = (name + ' ' + text.slice(0, 3000)).toLowerCase();
  return /contract|agreement|home building act|hia|master builders|general conditions/.test(s) ? 'Contract' : /specification|spec\b|schedule of finishes/.test(s) ? 'Specification'
    : /quote|quotation|estimate/.test(s) ? 'Quote' : /variation/.test(s) ? 'Variation' : /drawing|plan set|elevation/.test(s) ? 'Drawings' : /invoice/.test(s) ? 'Invoice'
    : /certificate|compliance/.test(s) ? 'Certificate' : /minutes|meeting/.test(s) ? 'Meeting notes' : /email|from:|subject:/.test(s) ? 'Correspondence' : 'Document';
}
export async function remove(core, id) {
  await kv.update('pdocs:' + core, (x) => { x.docs = (x.docs || []).filter((d) => d.id !== id); return x; }, () => ({ docs: [] }));
  await Promise.all([kv.del(`pdoctext:${core}:${id}`), kv.del(`pdocfile:${core}:${id}`)].map((p) => p.catch(() => {})));
  return { ok: true };
}

// ---------- the context the AI gets ----------
export function scrub(text, job, people) {
  let t = P.privateOut(text, job);
  for (const x of people) { if (x.phone) t = t.split(x.phone).join('[phone]'); if (x.email) t = t.split(x.email).join('[email]'); }
  return t;
}
const WORD = /[a-z0-9]{3,}/g, STOP = new Set('the and for with that this from are was were will have has had not but you your our all any can its their there what when who how which into out per may must shall such than then them they these those been being also each other more most some only over under upon about after before between both does done doing should would could within without project please give tell show work list'.split(' '));
function chunks(doc, text, size = 1400) {
  const out = []; let page = 0;
  const parts = text.split(/(\[page \d+\])/);
  let buf = '';
  const push = () => { if (buf.trim()) out.push({ doc: doc.name, kind: doc.kind, page, text: buf.trim() }); buf = ''; };
  for (const p of parts) {
    const m = p.match(/^\[page (\d+)\]$/); if (m) { push(); page = +m[1]; continue; }
    for (const para of p.split(/\n{2,}/)) { if ((buf + '\n\n' + para).length > size) push(); buf += (buf ? '\n\n' : '') + para; while (buf.length > size * 1.6) { out.push({ doc: doc.name, kind: doc.kind, page, text: buf.slice(0, size) }); buf = buf.slice(size); } }
  }
  push();
  return out;
}
function pickChunks(all, question) {
  const total = all.reduce((a, c) => a + c.text.length, 0);
  if (total <= CONTEXT_CHARS) return { chunks: all, partial: false };
  const words = [...new Set((question.toLowerCase().match(WORD) || []).filter((w) => !STOP.has(w)))];
  // contract words people use loosely
  const syn = { pay: ['payment', 'progress', 'deposit', 'claim'], late: ['delay', 'extension', 'liquidated', 'damages'], defect: ['defects', 'liability', 'warranty', 'rectif'], change: ['variation', 'variations'], end: ['termination', 'terminate'], dispute: ['dispute', 'arbitration', 'mediation'], insurance: ['insurance', 'indemnity', 'liability'], risk: ['risk', 'delay', 'defect', 'insurance', 'variation', 'liquidated', 'site', 'access', 'weather', 'approval'], stakeholder: ['owner', 'builder', 'certifier', 'council', 'architect', 'engineer', 'superintendent', 'contact', 'notice'] };
  for (const [k, v] of Object.entries(syn)) if (words.some((w) => w.startsWith(k))) words.push(...v);
  const score = (c) => { const t = c.text.toLowerCase(); let s = 0; for (const w of words) { const n = t.split(w).length - 1; if (n) s += 1 + Math.log(1 + n); } return s; };
  const firsts = new Set(); const keep = [];
  // the start of each document (parties, dates, contract sum usually sit there), then the best matches
  for (const c of all) if (!firsts.has(c.doc)) { firsts.add(c.doc); keep.push(c); }
  const rest = all.filter((c) => !keep.includes(c)).map((c) => ({ c, s: score(c) })).sort((a, b) => b.s - a.s);
  let used = keep.reduce((a, c) => a + c.text.length, 0);
  for (const { c } of rest) { if (used + c.text.length > CONTEXT_CHARS) continue; keep.push(c); used += c.text.length; }
  keep.sort((a, b) => all.indexOf(a) - all.indexOf(b));
  return { chunks: keep, partial: true };
}
export async function context(job, plan, question) {
  const today = sydToday(), R = P.rollup(JSON.parse(JSON.stringify(plan)), today);
  const crit = R.finish ? P.critTasks(JSON.parse(JSON.stringify(plan)), R) : new Set();
  const people = plan.stakeholders || [];
  const sc = (s) => scrub(P.scrubTask(String(s || ''), job), job, people);
  const num = Object.fromEntries(plan.tasks.map((t, i) => [t.id, i + 1]));
  const C = plan.charter || {};
  const ctx = {
    today, weekday: new Date(today + 'T00:00:00Z').toLocaleDateString('en-AU', { weekday: 'long', timeZone: 'UTC' }), timezone: 'Australia/Sydney',
    project: { name: sc(plan.name), work: sc(job.service || ''), suburb: job.suburb || '', stage: job.stage, emergency: !!plan.emergency, weekends_worked: !!plan.weekends,
      start: R.start, finish: R.finish, finish_by: plan.finishBy || '', work_starts: plan.workStart || '', pct_complete: R.pct, tasks_done: R.done, tasks_total: R.total, tasks_late: R.late,
      budget_BAC: R.BAC, actual_cost: R.AC, earned_value: R.EV, planned_value: R.PV, SPI: R.SPI, CPI: R.CPI, forecast_EAC: R.EAC, baseline_finish: plan.baseline ? plan.baseline.finish : '' },
    scope: { objective: sc(C.objective), in_scope: sc(C.inScope), out_of_scope: sc(C.outScope), deliverables: sc(C.deliverables), acceptance: sc(C.acceptance), assumptions: sc(C.assumptions), budget: C.budget || 0 },
    tasks: plan.tasks.slice(0, 120).map((t, i) => ({ n: i + 1, task: sc(t.name), days: t.dur, start: t.es, finish: t.ef, after: (t.pred || []).map((id) => num[id]).filter(Boolean), critical: crit.has(t.id),
      pct: t.pct || 0, status: t.status || '', who: sc(t.resource || ''), cost: P.taskCost(t), materials: (t.mats || []).length, subtasks: (t.subs || []).map((x) => sc(x.name)).slice(0, 10) })),
    risks: (plan.risks || []).map((r) => ({ risk: sc(r.title), cause: sc(r.cause), probability: r.p, impact: r.i, score: r.p * r.i, response: r.response, action: sc(r.action), owner: sc(r.owner), status: r.status })),
    issues: (plan.issues || []).map((x) => ({ issue: sc(x.title), detail: sc(x.detail), priority: x.priority, owner: sc(x.owner), due: x.due, status: x.status })),
    stakeholders: people.map((x, i) => ({ ref: 'S' + (i + 1), name: sc(x.name), role: sc(x.role), raci: x.raci, has_email: /@/.test(x.email || '') })),
    meetings: (plan.meetings || []).slice(-12).map((m) => ({ title: sc(m.title), date: m.date, start: m.start, minutes: m.minutes, platform: m.platform || 'google', status: m.status || 'Scheduled', transcript: !!m.doc, analysed: !!m.analysed })),
    contracts: (plan.contracts || []).map((c) => ({ type: c.type, with: c.type === 'Customer' ? 'the customer' : sc(c.party), document: c.docs[0] || '' })),
    change_requests: (plan.changes || []).slice().sort((a, b) => a.num - b.num).slice(-60).map((c) => ({ cr: 'CR-' + String(c.num).padStart(3, '0'), title: sc(c.title), status: c.status, raised: c.raisedAt ? new Date(c.raisedAt).toISOString().slice(0, 10) : '',
      raised_by: sc(c.raisedBy), description: sc(c.desc).slice(0, 600), reason: sc(c.reason).slice(0, 400), applied_directly: !!c.direct,
      decision: c.decision ? { outcome: c.decision.outcome, by: c.decision.by, role: c.decision.role, signed: !!c.decision.sig, date: new Date(c.decision.at).toISOString().slice(0, 10), note: sc(c.decision.note).slice(0, 400) } : null,
      effect: c.effect ? { finish_before: c.effect.f0, finish_after: c.effect.f1, budget_before: c.effect.b0, budget_after: c.effect.b1, days: c.effect.days, cost: c.effect.cost } : null,
      added_to_plan: c.implementedAt ? new Date(c.implementedAt).toISOString().slice(0, 10) : '' })),
    change_records: [],
    documents: []
  };
  const docs = await docList(job.core);
  const texts = await kv.getMany(docs.map((d) => `pdoctext:${job.core}:${d.id}`));
  const all = [];
  docs.forEach((d, i) => { const t = texts[i] && texts[i].text; if (t) all.push(...chunks(d, scrub(t, job, people))); });
  const pick = pickChunks(all, question);
  ctx.documents = docs.map((d) => ({ name: d.name, kind: d.kind, pages: d.pages, words: d.words }));
  const sw = await kv.get('swms:' + job.core);   // v57: the SWMS, so questions about it can be answered
  if (sw) ctx.swms = { version: sw.version, status: sw.status, high_risk_work: sw.hrcw.map((k) => (SWMS.HRCW.find((h) => h[0] === k) || [])[1]), steps: sw.steps.map((s) => ({ step: s.step, hazards: s.hazards, risk: s.risk, controls: s.controls, risk_after: s.residual, who: s.who })), ppe: sw.ppe, plant: sw.plant, licences: sw.quals };
  // which uploaded document is which contract
  ctx.contracts = ctx.contracts.map((c) => ({ type: c.type, with: c.with, document: (docs.find((d) => d.id === c.document) || {}).name || '' }));
  ctx.document_extracts = pick.chunks.map((c) => ({ doc: c.doc, page: c.page || undefined, text: c.text }));
  ctx.extracts_are_partial = pick.partial;
  try { ctx.change_records = (await crRecords(job.core)).slice(-60).map((r) => ({ cr: r.cr, title: sc(r.title), decision: r.outcome, by: r.by, role: r.role, signed: !!r.sig, date: new Date(r.at).toISOString().slice(0, 10),
    finish_before: r.f0, finish_after: r.f1, budget_before: r.b0, budget_after: r.b1, applied_directly: r.direct, signed_pdf_kept: r.hasPdf, note: sc(r.note).slice(0, 300) })); } catch { ctx.change_records = []; }
  try { ctx.program = await programContext(job, today, sc); } catch { ctx.program = null; }
  return { ctx, stakeholders: people };
}

// GKH Project Champ: the program this project belongs to, with every project in it (dates, progress, earned value, risks)
// and the dependencies between them, so program questions ("compare the end dates of all the projects in this program") can be answered.
// Other projects go by reference, name and figures only: no client names, phone numbers or emails.
async function programContext(job, today, sc) {
  if (!job.program) return null;
  const [cards, programs, deps] = await Promise.all([P.portfolio(today), PG.keyed(), PG.deps()]);
  const pg = programs.find((p) => p.name.toLowerCase() === job.program.toLowerCase());
  const mine = cards.filter((c) => (c.program || '').toLowerCase() === job.program.toLowerCase());
  const PHASE = { init: 'Initiation', plan: 'Planning', exec: 'Execution', monitor: 'Monitoring & Evaluation', close: 'Closing' };
  const cores = new Set(mine.map((c) => c.core)), byCore = Object.fromEntries(cards.map((c) => [c.core, c]));
  const projects = mine.map((c) => ({ ref: c.ref, name: sc(c.name), this_project: c.core === job.core, has_plan: !!c.hasPlan, phase: PHASE[c.phase] || c.phase,
    start: c.start || '', finish: c.finish || '', forecast_finish: PG.forecastFinish(c) || '', pct_complete: c.pct || 0, tasks_done: c.done || 0, tasks_total: c.total || 0, tasks_late: c.late || 0,
    budget_BAC: c.BAC || 0, actual_cost: c.AC || 0, SPI: c.SPI, CPI: c.CPI, open_risks: c.openRisks || 0, high_risks: c.highRisks || 0, open_issues: c.openIssues || 0 }))
    .sort((a, b) => (a.finish || '9999') < (b.finish || '9999') ? -1 : 1);
  const links = deps.filter((d) => cores.has(d.from) || cores.has(d.to)).filter((d) => byCore[d.from] && byCore[d.to]).map((d) => {
    const st = PG.depStatus(d, byCore[d.from], byCore[d.to]);
    return { from: byCore[d.from].ref, to: byCore[d.to].ref, type: PG.TYPES[d.type] || d.type, lag_days: d.lag || 0, status: st.status, why: sc(st.why), outside_program: !(cores.has(d.from) && cores.has(d.to)) };
  });
  const sum = (k) => projects.reduce((a, x) => a + (x[k] || 0), 0);
  const ends = projects.map((x) => x.forecast_finish || x.finish).filter(Boolean).sort();
  return { key: pg ? pg.key : '', name: sc(job.program), manager: pg ? sc(pg.manager) : '', sponsor: pg ? sc(pg.sponsor) : '', objective: pg ? sc(pg.objective) : '', status: pg ? (PG.STATUS[pg.status] || pg.status) : '',
    target_start: pg ? pg.start : '', target_finish: pg ? pg.finish : '', projects_count: projects.length, total_budget_BAC: sum('budget_BAC'), total_actual_cost: sum('actual_cost'),
    latest_finish: ends[ends.length - 1] || '', projects, dependencies: links };
}

const SYSTEM = 'You are "Project Intelligence" for GKH Project Champ, a project management platform used by project teams in construction, facilities, IT, ESG and business change. ' +
  'You are an experienced construction project manager (PMBOK, PRINCE2) and you know NSW building contracts (Home Building Act 1989, HIA and Master Builders contracts, AS 4000/AS 4902), WHS and the NCC. ' +
  'Answer the question about THIS project using the project data and the document extracts given. Rules: ' +
  '0) The project belongs to a program (field "program": its key such as PG-002, name, and every project in it with dates, progress, SPI/CPI, budget, risks, and the dependencies between them). For questions about the program, the other projects, comparing projects or cross-project dependencies, answer from "program" and name projects by name and ref; never say the other projects are not provided when "program" lists them. ' +
  '0b) Change control: "change_requests" is the project change register (every CR with status, who raised it, the decision: outcome, by whom, role, signed, date, and its effect on finish and budget); "change_records" are the signed decision records kept in the database (with the signed PDF). For questions about changes, approvals or who approved what, answer from these (CR numbers, approver name and role, date, effect). A change "applied_directly" was applied with Fit to finish-by by that person without a change control board review: say so. ' +
  '1) Use the real tasks, dates, costs, critical path (critical=true tasks drive the finish date), risks, issues and stakeholders. Quote task numbers (#3) and dates as D Month YYYY. Australian spelling, $1,234.56. ' +
  '2) Documents: when you use a document, name it (and the page when given). If the answer is not in the documents or the data, say so plainly instead of guessing. When extracts_are_partial is true you only see the most relevant parts. ' +
  'For contract questions add one short line: this is general information, not legal advice. ' +
  '3) Be practical and specific to this job, short paragraphs and "- " bullets, "## " headings when useful, **bold** for key points, and markdown tables (| a | b |) for registers and comparisons. ' +
  '4) Only when the question asks to work out, assess, list or add risks, also fill "risks" (max 12) and mark critical=true for risks that could delay a critical task or the finish date, false otherwise. ' +
  '5) Only when the question asks for a stakeholder register or who should be involved, also fill "stakeholders" (max 15): name (a person or organisation, or a role if unknown), role, raci R|A|C|I, interest High|Medium|Low, influence High|Medium|Low, engagement (how to keep them engaged). Include existing stakeholders by their ref. ' +
  '6) Only when the question asks to set up, book or organise a meeting/call, also fill "meeting": title, date (YYYY-MM-DD: the date asked for, else the next working day; never a weekend unless asked), start (HH:MM 24h, default 10:00), minutes (default 45), attendees (stakeholder refs like "S1"; all stakeholders if they say "the stakeholders" or "the team"), agenda (4-7 short items for this project now). The console makes the Google Meet invite; do not invent links or email addresses. ' +
  '7) Only when the question asks to re-plan, re-baseline, stretch, compress or regenerate the schedule or Gantt chart to a new length or finish date, or to change the total budget, also fill "replan": ' +
  'weeks (the new total length in weeks, or 0), finish (the new finish date YYYY-MM-DD, or ""), budget (the new total budget in dollars, or 0), gates (review, approval or buffer tasks to add: [{"after": task number, "name": "", "days": 1-30}], max 8, only when asked or clearly needed), why (one sentence). ' +
  'The console then works out the exact new durations and costs from the plan and shows them for change control, so do NOT write out a full task table: in "answer" explain the approach briefly (how the extra time and money should be used, what to watch) in under 150 words. ' +
  'Reply JSON only: {"answer":"markdown","risks":[{"title":"","cause":"","p":1-5,"i":1-5,"response":"Avoid|Mitigate|Transfer|Accept","action":"","owner":"","critical":true}],' +
  '"stakeholders":[{"ref":"S1 or empty","name":"","role":"","raci":"R","interest":"High","influence":"High","engagement":""}],"meeting":null or {"title":"","date":"","start":"","minutes":45,"attendees":["S1"],"agenda":[""]},' +
  '"replan":null or {"weeks":0,"finish":"","budget":0,"gates":[{"after":3,"name":"","days":2}],"why":""},"sources":["document names used"],"follow_ups":["2-3 short next questions"]}';

const capOut = () => Math.max(800, Math.min(4000, Number(process.env.AI_INTEL_MAX_TOKENS || 2500) || 2500));
export async function ask({ core, question, history }, by) {
  const job = await J.find(core); if (!job) return { error: 'Job not found' };
  const plan = await P.get(job.core); if (!plan) return { error: 'This job has no plan yet. Make the plan first.' };
  const q = str(question, 800); if (!q) return { error: 'Type a question first' };
  if (!llmSetup()) return { error: 'AI is not set up yet: add LLM_API_KEY (DeepSeek) in Netlify.' };
  // v57: "generate a SWMS for this project" writes the Safe Work Method Statement from the plan
  if (/\bswms\b|safe work method/i.test(q) && /generat|creat|make|prepar|writ|draft|build|produce|do (a|me|us)|give me|need (a|one)|set up|update|redo|new/i.test(q)) {
    const g = await SWMS.generate({ core: job.core }, by);
    if (g.error) return { error: g.error };
    const H = Object.fromEntries(SWMS.HRCW), s = g.swms, high = s.steps.filter((x) => /High|Extreme/.test(x.risk)).length;
    const r = { answer: '## 🦺 SWMS written (version ' + s.version + ')\nI wrote the Safe Work Method Statement from the project plan: **' + s.steps.length + ' job steps** (' + high + ' with a high or extreme risk before controls), with hazards, control measures, PPE, plant, licences, emergency arrangements and a sign-on sheet.\n\n' +
        (s.hrcw.length ? '**High-risk construction work in this job:**\n' + s.hrcw.map((k) => '- ' + H[k]).join('\n') : 'No high-risk construction work category was found: check this against the work.') +
        '\n\nOpen the SWMS to check and change anything, then download it as Word or PDF. It is general guidance: check it against the site and the work before use.',
      risks: [], stakeholders: [], meeting: null, sources: [], follow_ups: ['What PPE is needed for this job?', 'Which steps have the highest risk?'], tokens: g.tokens, today: g.today, swms: { version: s.version, steps: s.steps.length, hrcw: s.hrcw.length } };
    await kv.update('pchat:' + job.core, (x) => { x.log = (x.log || []).concat([{ at: Date.now(), by: str(by, 60), q, r }]).slice(-30); return x; }, () => ({ log: [] }));
    return r;
  }
  // v60: "analyse my meeting on 3 Nov: what does it change?" reads that meeting's transcript and works out the impact
  const COMMS = await import('./comms.mjs');
  if (COMMS.MEET_Q(q)) {
    const today = sydToday(), pick = COMMS.pickMeeting(plan, q, today), m = pick.meeting;
    const save = async (r) => { await kv.update('pchat:' + job.core, (x) => { x.log = (x.log || []).concat([{ at: Date.now(), by: str(by, 60), q, r }]).slice(-30); return x; }, () => ({ log: [] })); return r; };
    const none = (msg) => save({ answer: msg, risks: [], stakeholders: [], meeting: null, sources: [], follow_ups: ['Set up a meeting with the stakeholders next week'], tokens: 0 });
    if (!m) return none(pick.date ? '## No meeting on ' + pick.date.split('-').reverse().join('/') + '\nThere is no meeting on that date in the 📞 Comms meeting log. Check the date, or add the meeting there.' : '## No meetings yet\nThe 📞 Comms meeting log is empty. Set up a meeting there, then upload its transcript.');
    if (!m.doc) return none('## “' + m.title + '” has no transcript yet\nUpload the meeting transcript (Word, PDF, text or the Teams/Zoom .vtt file) on that meeting in the 📞 Comms meeting log, then ask again.');
    const a = await COMMS.analyse({ core: job.core, id: m.id, question: q }, by);
    if (a.error) return { error: a.error };
    return save({ answer: a.report, risks: [], stakeholders: [], meeting: null, sources: [(await docList(job.core)).find((d) => d.id === m.doc)?.name || 'Meeting transcript'], follow_ups: a.follow_ups, tokens: a.tokens, today: a.today, impact: a });
  }
  try { await checkLimit(); } catch (e) { return { error: e.message }; }
  const { ctx, stakeholders } = await context(job, plan, q);
  const earlier = (Array.isArray(history) ? history : []).slice(-3).map((h) => ({ q: str(h.q, 300), a: str(h.a, 600) }));
  const user = { question: scrub(q, job, stakeholders), earlier, ...ctx };
  let o, used;
  try { ({ data: o, used } = await llmJson([{ role: 'system', content: SYSTEM }, { role: 'user', content: JSON.stringify(user) }], { maxTokens: capOut(), timeoutMs: 120000, temperature: 0.2 })); }
  catch (e) { return { error: e.message }; }
  const todayUse = await usage(true, used);
  const refs = Object.fromEntries(stakeholders.map((x, i) => ['S' + (i + 1), x.id]));
  const lvl = (v) => (['High', 'Medium', 'Low'].includes(v) ? v : 'Medium');
  const r = {
    answer: str(o.answer, 12000) || 'No answer.',
    risks: (Array.isArray(o.risks) ? o.risks : []).slice(0, 12).map((x) => ({ title: str(x.title, 200), cause: str(x.cause, 600), p: Math.max(1, Math.min(5, Math.round(+x.p || 3))), i: Math.max(1, Math.min(5, Math.round(+x.i || 3))),
      response: ['Avoid', 'Mitigate', 'Transfer', 'Accept'].includes(x.response) ? x.response : 'Mitigate', action: str(x.action, 600), owner: str(x.owner, 80), critical: !!x.critical })).filter((x) => x.title),
    stakeholders: (Array.isArray(o.stakeholders) ? o.stakeholders : []).slice(0, 15).map((x) => ({ id: refs[str(x.ref, 6).toUpperCase()] || '', name: str(x.name, 120), role: str(x.role, 120), raci: ['R', 'A', 'C', 'I'].includes(x.raci) ? x.raci : 'I',
      interest: lvl(x.interest), influence: lvl(x.influence), engagement: str(x.engagement, 300) })).filter((x) => x.name || x.role),
    meeting: null,
    sources: (Array.isArray(o.sources) ? o.sources : []).map((s) => str(s, 160)).slice(0, 10),
    follow_ups: (Array.isArray(o.follow_ups) ? o.follow_ups : []).map((s) => str(s, 160)).filter(Boolean).slice(0, 3),
    tokens: used, today: todayUse, partial: ctx.extracts_are_partial, docs: ctx.documents.length
  };
  // a re-plan: the targets only; the console works out the task-by-task change from the plan
  const rp = o.replan;
  if (rp && typeof rp === 'object') {
    const ids = plan.tasks.map((t) => t.id);
    const weeks = Math.max(0, Math.min(520, Math.round(+rp.weeks || 0))), finish = /^\d{4}-\d{2}-\d{2}$/.test(rp.finish || '') ? rp.finish : '';
    const budget = Math.max(0, Math.min(1e10, Math.round((+String(rp.budget || 0).replace(/[$,\s]/g, '') || 0) * 100) / 100));
    const gates = (Array.isArray(rp.gates) ? rp.gates : []).slice(0, 8).map((g) => ({ after: ids[Math.round(+g.after || 0) - 1] || '', name: str(g.name, 120) || 'Review gate', days: Math.max(1, Math.min(30, Math.round(+g.days || 2))) })).filter((g) => g.after);
    if (weeks || finish || budget || gates.length) r.replan = { weeks, finish, budget, gates, why: str(rp.why, 300) };
  }
  // the question itself names a new length or budget ("24-week / $380,000 plan"): set the re-plan up even if the model left it out
  if (!r.replan && /re-?plan|re-?generat|re-?baseline|re-?schedul|re-?model|stretch|extend|compress|shorten|lengthen|gantt|schedule|budget|redraw/i.test(q)) {
    const wk = /(\d{1,3})\s*-?\s*(?:weeks?|wks?)\b/i.exec(q), mo = /(\d{1,2})\s*-?\s*months?\b/i.exec(q);
    const bm = /\$\s*([\d,]+(?:\.\d+)?)\s*(k|m|million|thousand)?/i.exec(q) || /\b([\d,]+(?:\.\d+)?)\s*(k|m|million|thousand)\b(?:\s*(?:dollars|budget))?/i.exec(q);
    let budget = 0;
    if (bm) { budget = parseFloat(bm[1].replace(/,/g, '')) || 0; const u = (bm[2] || '').toLowerCase(); if (u === 'k' || u === 'thousand') budget *= 1e3; if (u === 'm' || u === 'million') budget *= 1e6; }
    const weeks = wk ? +wk[1] : mo ? Math.round(+mo[1] * 52 / 12) : 0;
    // "from 13 weeks to 24 weeks" / "from 125,000 to 380,000": the last number is the new one
    const allW = [...q.matchAll(/(\d{1,3})\s*-?\s*(?:weeks?|wks?)\b/gi)].map((m) => +m[1]), allB = [...q.matchAll(/\$\s*([\d,]+(?:\.\d+)?)\s*(k|m)?/gi)].map((m) => (parseFloat(m[1].replace(/,/g, '')) || 0) * ((m[2] || '').toLowerCase() === 'k' ? 1e3 : (m[2] || '').toLowerCase() === 'm' ? 1e6 : 1));
    const W = allW.length > 1 ? allW[allW.length - 1] : weeks, B = allB.length > 1 ? allB[allB.length - 1] : budget;
    if ((W && W <= 520) || (B && B < 1e10)) r.replan = { weeks: W && W <= 520 ? W : 0, finish: '', budget: B && B < 1e10 ? Math.round(B * 100) / 100 : 0, gates: [], why: 'Taken from the question.' };
  }
  const m = o.meeting;
  if (m && typeof m === 'object') {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(m.date || '') && m.date >= ctx.today ? m.date : P.addWork(P.nextWork(ctx.today), 1);
    r.meeting = { title: str(m.title, 160) || 'Project meeting: ' + plan.name, date, start: /^\d{2}:\d{2}$/.test(m.start || '') ? m.start : '10:00', minutes: Math.max(15, Math.min(240, Math.round(+m.minutes || 45))),
      attendees: (Array.isArray(m.attendees) ? m.attendees : []).map((a) => refs[str(a, 6).toUpperCase()]).filter(Boolean),
      agenda: (Array.isArray(m.agenda) ? m.agenda : String(m.agenda || '').split('\n')).map((s) => str(s, 200).replace(/^[-*\d.\s]+/, '')).filter(Boolean).slice(0, 10).join('\n') };
  }
  await kv.update('pchat:' + job.core, (x) => { x.log = (x.log || []).concat([{ at: Date.now(), by: str(by, 60), q, r }]).slice(-30); return x; }, () => ({ log: [] }));
  return r;
}

export async function intelPost(action, body, { who, by, audit }) {
  if (!/^intel/.test(action)) return null;
  const job = await J.find(str(body.core, 30)); if (!job) return out(404, { error: 'Job not found' });
  const core = job.core;
  switch (action) {
    case 'intelGet': {
      const [docs, chat] = await Promise.all([docList(core), kv.get('pchat:' + core)]);
      return out(200, { docs, log: (chat && chat.log) || [] });
    }
    case 'intelUpload': {
      const r = await upload(core, body, by); if (r.error) return out(400, r);
      if (audit) await audit(who, `Project ${core}: document uploaded for Project Intelligence: ${r.doc.name}`);
      return out(200, r);
    }
    case 'intelCrRecord': {
      const r = await crSave(job, body, by || who); if (r.error) return out(400, r);
      if (audit) await audit(who, `Project ${core}: ${r.record.cr} ${r.record.outcome.toLowerCase()} by ${r.record.by} (${r.record.role}): record and signed PDF kept`);
      return out(200, { ok: true, record: Object.assign({}, r.record, { text: undefined }) });
    }
    case 'intelCrList': return out(200, { records: (await crRecords(core)).map((r) => Object.assign({}, r, { text: undefined })) });
    case 'intelCrGet': {
      const key = str(body.key, 30), f = await kv.getFile(`crpdf:${core}:${key}`);
      if (!f) return out(404, { error: 'The PDF for that record was not found' });
      return out(200, { name: f.metadata.name || key + '.pdf', type: 'application/pdf', file: f.buf.toString('base64') });
    }
    case 'intelDocDelete': { await remove(core, str(body.id, 20)); if (audit) await audit(who, `Project ${core}: document deleted from Project Intelligence`); return out(200, { ok: true }); }
    case 'intelDocFile': {
      const id = str(body.id, 20), f = await kv.getFile(`pdocfile:${core}:${id}`);
      if (f) return out(200, { name: f.metadata.name || 'document', type: f.metadata.type || 'application/octet-stream', file: f.buf.toString('base64') });
      const t = await kv.get(`pdoctext:${core}:${id}`); if (!t) return out(404, { error: 'Document not found' });
      return out(200, { name: ((await docList(core)).find((d) => d.id === id) || {}).name + '.txt', type: 'text/plain', file: Buffer.from(t.text).toString('base64') });
    }
    case 'intelClear': {
      // one answer (at), everything older than the newest `keep`, or all of it
      const at = Number(body.at) || 0, keep = Math.max(0, Math.min(30, Number(body.keep) || 0));
      let left = [];
      if (at || keep) await kv.update('pchat:' + core, (x) => { const L = x.log || []; x.log = at ? L.filter((e) => e.at !== at) : L.slice(-keep); left = x.log; return x; }, () => ({ log: [] }));
      else await kv.set('pchat:' + core, { log: [] });
      return out(200, { ok: true, log: left });
    }
    default: return null;
  }
}
