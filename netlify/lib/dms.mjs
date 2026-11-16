// GKH Project Champ: 📁 the project's document repository. Every project has its own space: the files in Cloudflare R2
// (projects/<core>/…, private, signed links), the readable text in Blobs (so Ask AI and the search are instant). Documents are
// organised in folders, have a status, an owner, tags and versions, and the AI can analyse any of them against the project
// plan and its environment (scope, schedule, budget, risks, issues), or review the whole repository at once.
import * as kv from './kv.mjs';
import * as J from './jobs.mjs';
import * as P from './plan.mjs';
import { llmJson, usage, checkLimit, llmSetup, sydToday } from './ai.mjs';
import { docList, scrub, crRecords } from './plan-intel.mjs';

const str = (s, n = 300) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, n);
export const FOLDERS = [
  ['governance', '🏛 Charter and governance', 'Project charter, business case, terms of reference, steering committee papers, approvals'],
  ['requirements', '📋 Requirements', 'BRD, FSD, requirements definition, user stories, use cases, specifications, RFP or RFQ'],
  ['plans', '🗓 Plans and schedules', 'Project plan, schedule, management plans (risk, quality, comms, resource), roadmaps'],
  ['design', '📐 Design and architecture', 'Solution design, architecture, technical design, drawings, data models'],
  ['contracts', '📜 Contracts and commercial', 'Contracts, statements of work, purchase orders, quotes, invoices, variations'],
  ['meetings', '🗣 Meeting minutes', 'Minutes, agendas, transcripts, action logs, workshop notes'],
  ['reports', '📊 Reports and status', 'Status reports, dashboards, steering committee reports, audits, reviews, lessons learned'],
  ['changes', '🔁 Change requests', 'Change requests, impact assessments, decisions'],
  ['quality', '✅ Testing and quality', 'Test plans, test cases, UAT, defect logs, quality reports, sign-offs, certificates'],
  ['handover', '📦 Training and handover', 'Training material, user guides, runbooks, handover and closure documents'],
  ['correspondence', '✉ Correspondence', 'Emails, letters, memos'],
  ['other', '🗂 Other', 'Anything else'],
];
const KEYS = new Set(FOLDERS.map((f) => f[0]));
export const STATUS = ['Draft', 'In review', 'Approved', 'Superseded', 'Archived'];
export const folderOk = (f) => (KEYS.has(String(f || '')) ? String(f) : '');
export const statusOk = (s) => (STATUS.includes(String(s || '')) ? String(s) : '');

// where a document belongs, from its name, its first pages and the kind already guessed
export function classify(name, text, kind = '') {
  const n = String(name || '').toLowerCase(), t = String(text || '').slice(0, 5000).toLowerCase(), s = n + ' ' + t;
  const has = (re) => re.test(n) || re.test(t.slice(0, 1500));
  if (/minutes|transcript/.test(kind.toLowerCase()) || has(/\bminutes\b|meeting notes|agenda|transcript|action log|workshop notes/)) return 'meetings';
  if (has(/\bbrd\b|\bfsd\b|\bsrs\b|business requirements?|functional spec|requirements? (definition|specification|document|catalogue)|user stor(y|ies)|use cases?|\brf[pqi]\b|request for (proposal|quotation|tender)|specification/)) return 'requirements';
  if (/contract/i.test(kind) || has(/\bcontract\b|agreement|statement of work|\bsow\b|purchase order|quotation|\bquote\b|invoice|variation|terms and conditions/)) return 'contracts';
  if (/charter/i.test(kind) || has(/project charter|business case|terms of reference|steering committee|feasibility study|project mandate|governance/)) return 'governance';
  if (has(/change request|\bcr-\d+|impact assessment/)) return 'changes';
  if (has(/test plan|test case|\buat\b|defect|quality (plan|report)|inspection|certificate|compliance|sign-off/)) return 'quality';
  if (has(/architecture|solution design|technical design|design document|data model|drawing|elevation|wireframe/)) return 'design';
  if (has(/project plan|schedule|gantt|management plan|roadmap|work breakdown|\bwbs\b|resource plan|communication plan|risk management plan/)) return 'plans';
  if (has(/status report|progress report|dashboard|audit|lessons learned|post.implementation|health check|\breport\b/)) return 'reports';
  if (has(/training|user guide|manual|runbook|handover|closure|cutover/)) return 'handover';
  if (has(/^from:|subject:|dear |regards|memo/) || /correspondence/i.test(kind)) return 'correspondence';
  return 'other';
}

// the repository: the documents (current versions first), the change-request records (signed PDFs), and storage used
export async function list(core) {
  const [docs, crs] = await Promise.all([docList(core), crRecords(core).catch(() => [])]);
  const ai = await kv.getMany(docs.map((d) => `pdocai:${core}:${d.id}`)).catch(() => []);
  const out = docs.map((d, i) => ({ ...d, folder: d.folder || classify(d.name, '', d.kind), status: d.status || 'Draft', version: d.version || 1, group: d.group || d.id, analysed: ai[i] ? ai[i].at : 0, verdict: ai[i] && ai[i].data ? ai[i].data.alignment || '' : '' }));
  const recs = crs.map((r) => ({ key: r.key, cr: r.cr, title: r.title, outcome: r.outcome, by: r.by, at: r.at, hasPdf: !!r.hasPdf }));
  const bytes = out.filter((d) => d.r2).reduce((a, d) => a + (d.size || 0), 0);
  const review = await kv.get('pdocreview:' + core).catch(() => null);
  return { folders: FOLDERS.map((f) => ({ key: f[0], name: f[1], hint: f[2] })), status: STATUS, docs: out, records: recs, r2bytes: bytes, review: review ? { at: review.at, by: review.by } : null };
}
export async function update(core, id, f) {
  let hit = null;
  await kv.update('pdocs:' + core, (x) => {
    (x.docs || []).forEach((d) => {
      if (d.id !== id) return; hit = d;
      if (f.folder !== undefined && folderOk(f.folder)) d.folder = f.folder;
      if (f.status !== undefined && statusOk(f.status) && !d.superseded) d.status = f.status;
      if (f.owner !== undefined) d.owner = str(f.owner, 80);
      if (f.title !== undefined) d.title = str(f.title, 160);
      if (f.note !== undefined) d.note = str(f.note, 600);
      if (f.tags !== undefined) d.tags = (Array.isArray(f.tags) ? f.tags : String(f.tags || '').split(',')).map((t) => str(t, 30)).filter(Boolean).slice(0, 8);
      if (f.status === 'Approved') { d.approvedAt = Date.now(); d.approvedBy = str(f.by, 60); }
    });
    return x;
  }, () => ({ docs: [] }));
  return hit ? { ok: true } : { error: 'Document not found' };
}

// 🔎 search the text of every current document (no AI): the best passages, with the page
export async function search(core, q) {
  const words = [...new Set(String(q || '').toLowerCase().match(/[a-z0-9]{3,}/g) || [])].slice(0, 12); if (!words.length) return { hits: [] };
  const docs = (await docList(core)).filter((d) => !d.superseded), texts = await kv.getMany(docs.map((d) => `pdoctext:${core}:${d.id}`));
  const hits = [];
  docs.forEach((d, i) => {
    const t = (texts[i] && texts[i].text) || ''; let page = 0;
    t.split(/(\[page \d+\])/).forEach((part) => { const m = part.match(/^\[page (\d+)\]$/); if (m) { page = +m[1]; return; }
      part.split(/\n{2,}/).forEach((para) => { const low = para.toLowerCase(); let sc = 0; words.forEach((w) => { const k = low.split(w).length - 1; if (k) sc += 1 + Math.log(1 + k); });
        if (sc > 0) { const at = Math.max(0, low.indexOf(words.find((w) => low.includes(w))) - 80); hits.push({ id: d.id, name: d.title || d.name, folder: d.folder || '', page, score: sc, text: para.slice(at, at + 320).replace(/\s+/g, ' ').trim() }); } }); });
    if (words.every((w) => (d.name + ' ' + (d.title || '') + ' ' + (d.tags || []).join(' ')).toLowerCase().includes(w))) hits.push({ id: d.id, name: d.title || d.name, folder: d.folder || '', page: 0, score: 9, text: '(name or tags match)' });
  });
  hits.sort((a, b) => b.score - a.score);
  return { hits: hits.slice(0, 25) };
}

// the project, short, for the AI: scope, schedule, budget, people, risks, issues, open changes
function projectView(job, plan) {
  const today = sydToday(), R = P.rollup(JSON.parse(JSON.stringify(plan)), today), C = plan.charter || {}, people = plan.stakeholders || [];
  const sc = (s, n = 400) => scrub(String(s || ''), job, people).slice(0, n);
  const ph = Object.fromEntries((plan.phases || []).map((f) => [f.id, f.name]));
  return { today, name: sc(plan.name, 120), client: job.name || '', start: R.start, finish: R.finish, baseline_finish: plan.baseline ? plan.baseline.finish : '', pct_complete: R.pct, SPI: R.SPI, CPI: R.CPI, budget: C.budget || R.BAC, forecast: R.EAC,
    scope: { objective: sc(C.objective), in_scope: sc(C.inScope, 800), out_of_scope: sc(C.outScope), deliverables: sc(C.deliverables, 800), acceptance: sc(C.acceptance), assumptions: sc(C.assumptions) },
    phases: (plan.phases || []).map((f) => f.name),
    tasks: plan.tasks.slice(0, 120).map((t, i) => ({ n: i + 1, task: sc(t.name, 100), phase: ph[t.phase] || '', start: t.es, finish: t.ef, days: t.dur, pct: t.pct || 0 })),
    risks: (plan.risks || []).slice(0, 30).map((r) => ({ risk: sc(r.title, 140), score: (r.p || 0) * (r.i || 0), status: r.status })),
    issues: (plan.issues || []).slice(0, 30).map((x) => ({ issue: sc(x.title, 140), priority: x.priority, status: x.status })),
    roles: people.slice(0, 30).map((x) => sc(x.role, 60)).filter(Boolean),
    changes: (plan.changes || []).slice(-20).map((c) => ({ cr: 'CR-' + String(c.num).padStart(3, '0'), title: sc(c.title, 120), status: c.status })) };
}
// a long document: the start, then the passages most about requirements, dates, money, scope and risk, up to ~40,000 characters
function digest(text, max = 40000) {
  if (text.length <= max) return text;
  const paras = text.split(/\n{2,}/), head = []; let used = 0;
  for (const p of paras) { if (used > max * 0.25) break; head.push(p); used += p.length; }
  const key = /\b(shall|must|should|requirement|deliver|deadline|due|date|milestone|budget|cost|price|\$|scope|out of scope|assum|risk|constraint|accept|sign.?off|phase|go.?live|integrat|interface|report|security|perform)/i;
  const rest = paras.slice(head.length).map((p, i) => ({ p, i, s: (p.match(new RegExp(key.source, 'gi')) || []).length / Math.sqrt(1 + p.length / 400) })).sort((a, b) => b.s - a.s);
  const pick = []; for (const x of rest) { if (used + x.p.length > max) continue; pick.push(x); used += x.p.length; }
  return head.join('\n\n') + '\n\n[…]\n\n' + pick.sort((a, b) => a.i - b.i).map((x) => x.p).join('\n\n');
}

// 🧠 one document against the plan
export async function analyse(core, id, by) {
  const job = await J.find(core); if (!job) return { error: 'Project not found' };
  const plan = await P.get(core); if (!plan) return { error: 'This project has no plan yet: build the plan first, then the AI can check documents against it.' };
  const d = (await docList(core)).find((x) => x.id === id); if (!d) return { error: 'Document not found' };
  const t = await kv.get(`pdoctext:${core}:${id}`); if (!t || !t.text) return { error: 'No text for that document' };
  if (!llmSetup()) return { error: 'AI is not set up yet: add LLM_API_KEY (DeepSeek) in Netlify.' };
  try { await checkLimit(); } catch (e) { return { error: e.message }; }
  const text = digest(scrub(t.text, job, plan.stakeholders || []));
  const sys = 'You are a senior project manager and business analyst (PMP, BABOK) reviewing one project document against the live project plan in GKH Project Champ. ' +
    'Read the document and compare it with the project (scope, deliverables, tasks and dates, budget, risks, issues, change requests). Be specific: quote section or page numbers when you can, name tasks by number, give real dates and amounts. Australian English, no markdown. ' +
    'Return JSON: {"type":"what kind of document this is (e.g. BRD, FSD, contract, minutes, charter)","summary":"3-5 sentences: what the document says and why it matters to this project",' +
    '"key_points":["up to 8 short points: decisions, obligations, figures, dates"],' +
    '"requirements":[{"item":"a requirement, deliverable or obligation in the document","in_plan":"yes|partly|no","task":"the matching task number(s) or empty","note":"short"}],' +
    '"conflicts":[{"what":"where the document and the plan disagree (dates, money, scope, roles)","document":"what the document says","plan":"what the plan says","impact":"High|Medium|Low"}],' +
    '"gaps":["things the document needs that the plan does not have (work, approvals, roles, environments)"],' +
    '"risks":[{"title":"a risk the document raises","cause":"short","p":1-5,"i":1-5,"action":"mitigation"}],' +
    '"tasks":[{"name":"a task the plan should add","phase":"best phase name from the plan or a new one","days":1-60,"why":"short"}],' +
    '"actions":["up to 5 recommended next steps for the project manager"],' +
    '"alignment":"aligned|partly aligned|not aligned","alignment_why":"one sentence"}. Keep lists to what the document really supports (requirements up to 25, conflicts up to 8, risks up to 6, tasks up to 8).';
  let o, used;
  try { ({ data: o, used } = await llmJson([{ role: 'system', content: sys }, { role: 'user', content: JSON.stringify({ project: projectView(job, plan), document: { name: d.title || d.name, folder: d.folder, status: d.status, version: d.version || 1, pages: d.pages, text } }) }], { maxTokens: 5000, timeoutMs: 240000, temperature: 0.2 })); }
  catch (e) { return { error: e.message || 'The AI did not answer. Try again.' }; }
  await usage(true, used || 0).catch(() => {});
  if (!o || !o.summary) return { error: 'The AI did not return an analysis. Try again.' };
  const arr = (a, n) => (Array.isArray(a) ? a.slice(0, n) : []);
  const data = { type: str(o.type, 80), summary: str(o.summary, 1500), key_points: arr(o.key_points, 8).map((x) => str(x, 300)),
    requirements: arr(o.requirements, 25).map((r) => ({ item: str(r && r.item, 300), in_plan: ['yes', 'partly', 'no'].includes(r && r.in_plan) ? r.in_plan : 'no', task: str(r && r.task, 40), note: str(r && r.note, 200) })).filter((r) => r.item),
    conflicts: arr(o.conflicts, 8).map((c) => ({ what: str(c && c.what, 240), document: str(c && c.document, 240), plan: str(c && c.plan, 240), impact: ['High', 'Medium', 'Low'].includes(c && c.impact) ? c.impact : 'Medium' })).filter((c) => c.what),
    gaps: arr(o.gaps, 10).map((x) => str(x, 240)).filter(Boolean),
    risks: arr(o.risks, 6).map((r) => ({ title: str(r && r.title, 160), cause: str(r && r.cause, 200), p: Math.min(5, Math.max(1, Math.round(Number(r && r.p) || 3))), i: Math.min(5, Math.max(1, Math.round(Number(r && r.i) || 3))), action: str(r && r.action, 240) })).filter((r) => r.title),
    tasks: arr(o.tasks, 8).map((t) => ({ name: str(t && t.name, 120), phase: str(t && t.phase, 80), days: Math.min(120, Math.max(1, Math.round(Number(t && t.days) || 5))), why: str(t && t.why, 200) })).filter((t) => t.name),
    actions: arr(o.actions, 5).map((x) => str(x, 240)).filter(Boolean), alignment: ['aligned', 'partly aligned', 'not aligned'].includes(o.alignment) ? o.alignment : 'partly aligned', alignment_why: str(o.alignment_why, 300) };
  const rec = { at: Date.now(), by: str(by, 60), doc: d.name, version: d.version || 1, data };
  await kv.set(`pdocai:${core}:${id}`, rec);
  return { analysis: rec, tokens: used || 0 };
}
export async function analysis(core, id) { return (await kv.get(`pdocai:${core}:${id}`).catch(() => null)) || null; }

// 🧠 the whole repository against the plan: what is covered, what is missing, conflicts between documents, what to do
export async function review(core, by) {
  const job = await J.find(core); if (!job) return { error: 'Project not found' };
  const plan = await P.get(core); if (!plan) return { error: 'This project has no plan yet.' };
  const docs = (await docList(core)).filter((d) => !d.superseded); if (!docs.length) return { error: 'Add some documents first.' };
  if (!llmSetup()) return { error: 'AI is not set up yet: add LLM_API_KEY (DeepSeek) in Netlify.' };
  try { await checkLimit(); } catch (e) { return { error: e.message }; }
  const texts = await kv.getMany(docs.map((d) => `pdoctext:${core}:${d.id}`)), ans = await kv.getMany(docs.map((d) => `pdocai:${core}:${d.id}`));
  const per = Math.max(2500, Math.floor(60000 / docs.length));
  const set = docs.slice(0, 40).map((d, i) => ({ name: d.title || d.name, folder: d.folder || classify(d.name, '', d.kind), status: d.status || 'Draft', version: d.version || 1, uploaded: new Date(d.at).toISOString().slice(0, 10),
    analysis: ans[i] && ans[i].data ? { summary: ans[i].data.summary, alignment: ans[i].data.alignment, gaps: ans[i].data.gaps } : undefined,
    text: ans[i] ? undefined : digest(scrub((texts[i] && texts[i].text) || '', job, plan.stakeholders || []), per) }));
  const sys = 'You are a PMO lead auditing a project\'s document repository in GKH Project Champ against its live plan. Australian English, no markdown, be specific (document names, task numbers, dates, amounts). ' +
    'Return JSON: {"summary":"4-6 sentences: the state of the documentation and how well it supports the plan",' +
    '"coverage":[{"area":"e.g. Requirements, Design, Testing, Contracts, Governance, Change control, Handover","status":"good|thin|missing","note":"short"}],' +
    '"missing":["documents a project like this should have but does not (e.g. an approved BRD, a test strategy, signed minutes of the last steering committee)"],' +
    '"conflicts":[{"between":"document A vs document B, or a document vs the plan","what":"short","impact":"High|Medium|Low"}],' +
    '"stale":["documents still in Draft or In review that the plan already relies on, or out of date"],' +
    '"actions":["up to 6 next steps for the project manager, most important first"]}';
  let o, used;
  try { ({ data: o, used } = await llmJson([{ role: 'system', content: sys }, { role: 'user', content: JSON.stringify({ project: projectView(job, plan), documents: set }) }], { maxTokens: 4000, timeoutMs: 240000, temperature: 0.2 })); }
  catch (e) { return { error: e.message || 'The AI did not answer. Try again.' }; }
  await usage(true, used || 0).catch(() => {});
  if (!o || !o.summary) return { error: 'The AI did not return a review. Try again.' };
  const arr = (a, n) => (Array.isArray(a) ? a.slice(0, n) : []);
  const data = { summary: str(o.summary, 1500), coverage: arr(o.coverage, 12).map((c) => ({ area: str(c && c.area, 60), status: ['good', 'thin', 'missing'].includes(c && c.status) ? c.status : 'thin', note: str(c && c.note, 200) })).filter((c) => c.area),
    missing: arr(o.missing, 10).map((x) => str(x, 200)).filter(Boolean), conflicts: arr(o.conflicts, 8).map((c) => ({ between: str(c && c.between, 200), what: str(c && c.what, 240), impact: ['High', 'Medium', 'Low'].includes(c && c.impact) ? c.impact : 'Medium' })).filter((c) => c.what),
    stale: arr(o.stale, 8).map((x) => str(x, 200)).filter(Boolean), actions: arr(o.actions, 6).map((x) => str(x, 240)).filter(Boolean) };
  const rec = { at: Date.now(), by: str(by, 60), docs: docs.length, data };
  await kv.set('pdocreview:' + core, rec);
  return { review: rec, tokens: used || 0 };
}
export async function reviewGet(core) { return (await kv.get('pdocreview:' + core).catch(() => null)) || null; }
