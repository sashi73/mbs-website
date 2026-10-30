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

const str = (s, max = 300) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
const H = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const out = (status, body) => new Response(JSON.stringify(body), { status, headers: H });
const MAX_TEXT = 400000, MAX_FILE = 3.5 * 1024 * 1024, MAX_DOCS = 30, CONTEXT_CHARS = 36000;

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
function scrub(text, job, people) {
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
async function context(job, plan, question) {
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
      pct: t.pct || 0, status: t.status || '', who: sc(t.resource || ''), cost: Math.round((t.qty || 0) * (t.rate || 0) * 100) / 100, subtasks: (t.subs || []).map((x) => sc(x.name)).slice(0, 10) })),
    risks: (plan.risks || []).map((r) => ({ risk: sc(r.title), cause: sc(r.cause), probability: r.p, impact: r.i, score: r.p * r.i, response: r.response, action: sc(r.action), owner: sc(r.owner), status: r.status })),
    issues: (plan.issues || []).map((x) => ({ issue: sc(x.title), detail: sc(x.detail), priority: x.priority, owner: sc(x.owner), due: x.due, status: x.status })),
    stakeholders: people.map((x, i) => ({ ref: 'S' + (i + 1), name: sc(x.name), role: sc(x.role), raci: x.raci, has_email: /@/.test(x.email || '') })),
    meetings: (plan.meetings || []).slice(-5).map((m) => ({ title: sc(m.title), date: m.date, start: m.start, minutes: m.minutes })),
    contracts: (plan.contracts || []).map((c) => ({ type: c.type, with: c.partyKind === 'customer' ? 'the customer' : sc(c.party), title: sc(c.title), ref: c.ref, form: c.form, value: c.value, gst_included: c.gstIncl, status: c.status,
      start: c.start, end: c.end, signed: c.signed, payment_terms: sc(c.terms), retention_pct: c.retention, defects_months: c.dlpMonths, liquidated_damages_per_day: c.ldPerDay, insurance: sc(c.insurance), obligations: sc(c.obligations),
      variations: c.variations.map((v) => ({ no: v.no, desc: sc(v.desc), amount: v.amount, days: v.days, status: v.status })), claims: c.claims.map((v) => ({ no: v.no, amount: v.amount, date: v.date, due: v.due, paid: v.paid || false })),
      documents: c.docs.length })),
    documents: []
  };
  const docs = await docList(job.core);
  const texts = await kv.getMany(docs.map((d) => `pdoctext:${job.core}:${d.id}`));
  const all = [];
  docs.forEach((d, i) => { const t = texts[i] && texts[i].text; if (t) all.push(...chunks(d, scrub(t, job, people))); });
  const pick = pickChunks(all, question);
  ctx.documents = docs.map((d) => ({ name: d.name, kind: d.kind, pages: d.pages, words: d.words }));
  ctx.document_extracts = pick.chunks.map((c) => ({ doc: c.doc, page: c.page || undefined, text: c.text }));
  ctx.extracts_are_partial = pick.partial;
  return { ctx, stakeholders: people };
}

const SYSTEM = 'You are "Project Intelligence" for Modern Building Solutions, a Sydney (NSW) building, renovation, waterproofing and maintenance company. ' +
  'You are an experienced construction project manager (PMBOK, PRINCE2) and you know NSW building contracts (Home Building Act 1989, HIA and Master Builders contracts, AS 4000/AS 4902), WHS and the NCC. ' +
  'Answer the question about THIS project using the project data and the document extracts given. Rules: ' +
  '1) Use the real tasks, dates, costs, critical path (critical=true tasks drive the finish date), risks, issues and stakeholders. Quote task numbers (#3) and dates as D Month YYYY. Australian spelling, $1,234.56. ' +
  '2) Documents: when you use a document, name it (and the page when given). If the answer is not in the documents or the data, say so plainly instead of guessing. When extracts_are_partial is true you only see the most relevant parts. ' +
  'For contract questions add one short line: this is general information, not legal advice. ' +
  '3) Be practical and specific to this job, short paragraphs and "- " bullets, "## " headings when useful, **bold** for key points, and markdown tables (| a | b |) for registers and comparisons. ' +
  '4) Only when the question asks to work out, assess, list or add risks, also fill "risks" (max 12) and mark critical=true for risks that could delay a critical task or the finish date, false otherwise. ' +
  '5) Only when the question asks for a stakeholder register or who should be involved, also fill "stakeholders" (max 15): name (a person or organisation, or a role if unknown), role, raci R|A|C|I, interest High|Medium|Low, influence High|Medium|Low, engagement (how to keep them engaged). Include existing stakeholders by their ref. ' +
  '6) Only when the question asks to set up, book or organise a meeting/call, also fill "meeting": title, date (YYYY-MM-DD: the date asked for, else the next working day; never a weekend unless asked), start (HH:MM 24h, default 10:00), minutes (default 45), attendees (stakeholder refs like "S1"; all stakeholders if they say "the stakeholders" or "the team"), agenda (4-7 short items for this project now). The console makes the Google Meet invite; do not invent links or email addresses. ' +
  'Reply JSON only: {"answer":"markdown","risks":[{"title":"","cause":"","p":1-5,"i":1-5,"response":"Avoid|Mitigate|Transfer|Accept","action":"","owner":"","critical":true}],' +
  '"stakeholders":[{"ref":"S1 or empty","name":"","role":"","raci":"R","interest":"High","influence":"High","engagement":""}],"meeting":null or {"title":"","date":"","start":"","minutes":45,"attendees":["S1"],"agenda":[""]},' +
  '"sources":["document names used"],"follow_ups":["2-3 short next questions"]}';

const capOut = () => Math.max(800, Math.min(4000, Number(process.env.AI_INTEL_MAX_TOKENS || 2500) || 2500));
export async function ask({ core, question, history }, by) {
  const job = await J.find(core); if (!job) return { error: 'Job not found' };
  const plan = await P.get(job.core); if (!plan) return { error: 'This job has no plan yet. Make the plan first.' };
  const q = str(question, 800); if (!q) return { error: 'Type a question first' };
  if (!llmSetup()) return { error: 'AI is not set up yet: add LLM_API_KEY (DeepSeek) in Netlify.' };
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

// v53: ✨ read the key terms out of a contract document, for the Contracts tab to fill in (the user checks them first)
const CSYS = 'You read construction contracts for Modern Building Solutions (MBS), a Sydney builder. From the contract text, take out the key terms. MBS is the builder or head contractor. ' +
  'Use only what the text says; leave a field empty ("" or 0) when it is not there. Dates YYYY-MM-DD. Money in AUD as a number. Reply JSON only: ' +
  '{"type":"Head contract|Subcontract|Supply|Consultant|Other","party":"the other party (business or person; \'the customer\' if it is the owner)","title":"scope of work, short","ref":"contract number","form":"e.g. HIA Lump Sum, MBA, AS 4000, AS 4903, purchase order",' +
  '"value":0,"gst_included":true,"terms":"payment terms, short","retention_pct":0,"start":"","end":"","signed":"","defects_months":0,"ld_per_day":0,"insurance":"insurance required, short",' +
  '"obligations":"- 4 to 8 short lines: the key obligations, notice periods, approval steps and deadlines","claims":[{"desc":"stage or milestone","amount":0,"pct":0}],"summary":"2 sentences"}';
export async function extractContract({ core, docId }, by) {
  const job = await J.find(core); if (!job) return { error: 'Job not found' };
  const plan = await P.get(job.core); if (!plan) return { error: 'This job has no plan' };
  const t = await kv.get(`pdoctext:${job.core}:${str(docId, 30)}`); if (!t) return { error: 'Document not found' };
  if (!llmSetup()) return { error: 'AI is not set up yet: add LLM_API_KEY (DeepSeek) in Netlify.' };
  try { await checkLimit(); } catch (e) { return { error: e.message }; }
  let text = scrub(t.text, job, plan.stakeholders || []);
  if (text.length > 60000) {   // long contracts: the start (parties, price) plus the parts about money, dates and obligations
    const all = chunks({ name: 'contract', kind: 'Contract' }, text);
    text = pickChunks(all, 'contract price sum value payment progress claim deposit retention date commencement completion practical defects liability liquidated damages insurance variation notice termination parties').chunks.map((c) => c.text).join('\n\n');
  }
  let o, used;
  try { ({ data: o, used } = await llmJson([{ role: 'system', content: CSYS }, { role: 'user', content: text }], { maxTokens: 1500, timeoutMs: 120000, temperature: 0 })); }
  catch (e) { return { error: e.message }; }
  const today = await usage(true, used);
  const d = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s : ''), n = (x) => Math.max(0, Math.round((Number(x) || 0) * 100) / 100);
  return { fields: { type: ['Head contract', 'Subcontract', 'Supply', 'Consultant', 'Other'].includes(o.type) ? o.type : '', party: str(o.party, 120), title: str(o.title, 200), ref: str(o.ref, 60), form: str(o.form, 80),
    value: n(o.value), gstIncl: o.gst_included !== false, terms: str(o.terms, 200), retention: Math.min(20, n(o.retention_pct)), start: d(o.start), end: d(o.end), signed: d(o.signed),
    dlpMonths: Math.min(120, Math.round(n(o.defects_months))), ldPerDay: n(o.ld_per_day), insurance: str(o.insurance, 600), obligations: str(o.obligations, 3000),
    claims: (Array.isArray(o.claims) ? o.claims : []).slice(0, 20).map((c) => ({ desc: str(c.desc, 200), amount: n(c.amount), pct: n(c.pct) })).filter((c) => c.desc) },
    summary: str(o.summary, 600), tokens: used, today };
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
    case 'intelDocDelete': { await remove(core, str(body.id, 20)); if (audit) await audit(who, `Project ${core}: document deleted from Project Intelligence`); return out(200, { ok: true }); }
    case 'intelDocFile': {
      const id = str(body.id, 20), f = await kv.getFile(`pdocfile:${core}:${id}`);
      if (f) return out(200, { name: f.metadata.name || 'document', type: f.metadata.type || 'application/octet-stream', file: f.buf.toString('base64') });
      const t = await kv.get(`pdoctext:${core}:${id}`); if (!t) return out(404, { error: 'Document not found' });
      return out(200, { name: ((await docList(core)).find((d) => d.id === id) || {}).name + '.txt', type: 'text/plain', file: Buffer.from(t.text).toString('base64') });
    }
    case 'intelClear': { await kv.set('pchat:' + core, { log: [] }); return out(200, { ok: true }); }
    default: return null;
  }
}
