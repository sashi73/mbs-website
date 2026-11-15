// GKH Project Champ: 📄 start a project from a document (Word, PowerPoint or PDF, 100+ pages).
// The browser takes the text out of the file (page by page) and stages it here; a background job then reads it
// with retrieval (RAG): the text is cut into chunks, every chunk becomes a TF-IDF vector (words and word pairs,
// weighted by how rare they are in this document), and the chunks that best answer each question a project needs
// (name, client, sponsor, location, objectives, scope, deliverables, phases, dates, budget, stakeholders, risks ...)
// are picked with Maximal Marginal Relevance (relevant, and not repeating each other), plus the opening pages.
// A short document goes in whole. Everything stays within DOC_INGEST_TOKENS (80,000 by default) for one AI call.
//   docstage:<sid>    { name, pages, text, by, at }   the staged text (kept 2 days)
//   the AI's reading comes back as aiplan:<id> { ingest }, like the other background jobs.
// The same vectors serve the plan builder later: extracts(text, queries, chars) picks the parts the plan needs.
import * as kv from './kv.mjs';
import { llmJson, usage, checkLimit, llmSetup } from './ai.mjs';

const str = (s, max = 300) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
export const MAX_STAGE = 1500000;   // characters kept from one document (about 400,000 words)
const CPT = 3.6;   // characters per token (English prose, DeepSeek's tokenizer, roughly)
export const budget = () => Math.max(20000, Math.min(120000, Number(process.env.DOC_INGEST_TOKENS) || 80000));
export const estTokens = (s) => Math.ceil(String(s || '').length / CPT);

// ---------- staging ----------
export async function stage({ name, pages, text, kind }, by) {
  const t = String(text || '').replace(/\u0000/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').slice(0, MAX_STAGE);
  if (t.replace(/\[(page|slide) \d+\]/g, '').trim().length < 200) return { error: 'There is too little text in this document to read. If it is a scanned PDF (pictures of pages), save it as a text PDF or Word file first.' };
  const sid = 'ds' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const doc = { sid, name: str(name, 160).replace(/[\\/]/g, '-') || 'document', kind: str(kind, 20), pages: Math.max(0, Math.round(Number(pages) || 0)), text: t, by: str(by, 80), at: Date.now() };
  await kv.set('docstage:' + sid, doc);
  const ch = chunks(t);
  return { sid, name: doc.name, pages: doc.pages, chars: t.length, words: t.split(/\s+/).filter(Boolean).length, tokens: estTokens(t), chunks: ch.length, whole: estTokens(t) <= inputBudget(), truncated: String(text || '').length > MAX_STAGE };
}
export async function staged(sid) {
  if (!/^ds[a-z0-9]{8,30}$/.test(String(sid || ''))) return null;
  const d = await kv.get('docstage:' + sid); if (!d || Date.now() - d.at > 2 * 864e5) return null; return d;
}

// ---------- chunks and vectors ----------
export function chunks(text, size = 1800) {
  const out = []; let page = 0, buf = '', bufPage = 0;
  const push = () => { if (buf.trim()) out.push({ i: out.length, page: bufPage, text: buf.trim() }); buf = ''; };
  for (const part of String(text || '').split(/(\[(?:page|slide) \d+\])/)) {
    const m = part.match(/^\[(?:page|slide) (\d+)\]$/); if (m) { if (buf.length > size * 0.6) push(); page = +m[1]; if (!buf) bufPage = page; continue; }
    for (const para of part.split(/\n{2,}/)) {
      if (!para.trim()) continue;
      if (buf && (buf + '\n\n' + para).length > size) push();
      if (!buf) bufPage = page;
      buf += (buf ? '\n\n' : '') + para.trim();
      while (buf.length > size * 1.5) { out.push({ i: out.length, page: bufPage, text: buf.slice(0, size) }); buf = buf.slice(size - 150); bufPage = page; }   // a little overlap
    }
  }
  push();
  return out;
}
const STOP = new Set(('the and for with that this from are was were will have has had not but you your our all any can its their there what when who how which into out per may must shall such than then them they these those been being also only more most other some each both very over under about above after before again further once here why where off own same too just should would could does did doing during until while between through against because nor of to in on at by an or as is it be if no so up do we he she his her him us me my i a').split(' '));
function terms(s) {
  const w = (String(s).toLowerCase().normalize('NFKD').match(/\p{L}[\p{L}\p{N}'-]{1,}|\p{N}{2,}/gu) || []).map((x) => x.replace(/'s$/, '')).filter((x) => x.length > 2 && !STOP.has(x));
  const out = w.map((x) => (x.length > 5 ? x.replace(/(ings?|ions?|ments?|ed|es|s)$/, '') : x));
  for (let i = 0; i + 1 < w.length; i++) out.push(out[i] + '_' + out[i + 1]);   // word pairs ("project_sponsor", "go_live")
  return out;
}
export function vectors(list) {   // TF-IDF (sublinear tf, smooth idf), L2-normalised sparse vectors
  const tf = list.map((c) => { const m = new Map(); for (const t of terms(c.text)) m.set(t, (m.get(t) || 0) + 1); return m; });
  const df = new Map(); tf.forEach((m) => m.forEach((v, t) => df.set(t, (df.get(t) || 0) + 1)));
  const N = list.length, idf = (t) => Math.log((N + 1) / ((df.get(t) || 0) + 1)) + 1;
  const vecs = tf.map((m) => { const v = new Map(); let n = 0; m.forEach((c, t) => { const x = (1 + Math.log(c)) * idf(t); v.set(t, x); n += x * x; }); n = Math.sqrt(n) || 1; v.forEach((x, t) => v.set(t, x / n)); return v; });
  const embed = (q) => { const m = new Map(); for (const t of terms(q)) m.set(t, (m.get(t) || 0) + 1); const v = new Map(); let n = 0; m.forEach((c, t) => { if (!df.has(t)) return; const x = (1 + Math.log(c)) * idf(t); v.set(t, x); n += x * x; }); n = Math.sqrt(n) || 1; v.forEach((x, t) => v.set(t, x / n)); return v; };
  return { vecs, embed };
}
export const cos = (a, b) => { let s = 0; const [x, y] = a.size < b.size ? [a, b] : [b, a]; x.forEach((v, t) => { const w = y.get(t); if (w) s += v * w; }); return s; };

// pick chunks: the opening pages, then Maximal Marginal Relevance over the questions, until the character budget is used
export function select(list, queries, maxChars, { lead = 3, lambda = 0.72 } = {}) {
  const total = list.reduce((a, c) => a + c.text.length, 0);
  if (total <= maxChars) return { picked: list.slice(), whole: true, coverage: 1 };
  const { vecs, embed } = vectors(list), Q = queries.map(embed);
  const rel = vecs.map((v, i) => { let best = 0, sum = 0; for (const q of Q) { const s = cos(v, q); sum += s; if (s > best) best = s; } return best * 0.8 + (sum / Q.length) * 0.2 + (i < lead ? 1 : 0); });
  // every question gets its best chunks first (so no field goes unanswered), then MMR fills the rest
  const chosen = new Set(), order = [];
  let used = 0;
  const take = (i) => { if (chosen.has(i) || used + list[i].text.length > maxChars) return false; chosen.add(i); order.push(i); used += list[i].text.length; return true; };
  for (let i = 0; i < Math.min(lead, list.length); i++) take(i);
  Q.forEach((q) => { vecs.map((v, i) => [i, cos(v, q)]).sort((a, b) => b[1] - a[1]).slice(0, 2).forEach(([i, s]) => { if (s > 0.04) take(i); }); });
  const maxSim = vecs.map((v) => { let m = 0; for (const j of order) { const s = cos(v, vecs[j]); if (s > m) m = s; } return m; });
  for (;;) {
    let bi = -1, bs = -1e9;
    for (let i = 0; i < list.length; i++) { if (chosen.has(i) || used + list[i].text.length > maxChars) continue; const s = lambda * rel[i] - (1 - lambda) * maxSim[i]; if (s > bs) { bs = s; bi = i; } }
    if (bi < 0) break;
    take(bi); for (let i = 0; i < list.length; i++) if (!chosen.has(i)) { const s = cos(vecs[i], vecs[bi]); if (s > maxSim[i]) maxSim[i] = s; }
  }
  const picked = order.slice().sort((a, b) => a - b).map((i) => list[i]);
  return { picked, whole: false, coverage: used / total };
}
// the parts of a document a question needs (the plan builder uses this with the project's own document)
export function extracts(text, queries, maxChars) {
  const L = chunks(text), s = select(L, queries, maxChars, { lead: 2 });
  return s.picked.map((c) => (c.page ? `[p. ${c.page}] ` : '') + c.text).join('\n\n---\n\n');
}

// ---------- what a project needs to know, as questions for the retrieval ----------
const FIELDS = [
  'project name title programme initiative', 'requirements functional non-functional must have shall should priority MoSCoW', 'recommended option preferred solution feasibility options analysis cost benefit NPV payback', 'request for proposal RFP tender statement of requirements service levels contract term evaluation criteria submission', 'client customer owner organisation company department agency', 'project sponsor executive sponsor steering committee board approver',
  'project manager project director lead delivery manager', 'site location address city region country premises facility', 'background context problem opportunity business case why',
  'objectives goals aims outcomes benefits success criteria KPIs', 'scope in scope work packages requirements included', 'out of scope exclusions not included',
  'deliverables outputs products documents reports', 'phases stages approach methodology work breakdown structure activities', 'timeline schedule milestones start date end date completion deadline go-live weeks months',
  'budget cost estimate funding price contract value fees', 'stakeholders users teams governance roles responsibilities RACI', 'risks issues constraints assumptions dependencies',
  'resources team staffing skills equipment materials vendors suppliers', 'quality acceptance criteria testing standards compliance regulations', 'communication reporting meetings status updates'];

const SYS = 'You are a senior project document analyst (PMP, PRINCE2, business analysis). You get extracts from ONE document that gives the context for a project, with page numbers. ' +
  'It is usually a REQUIREMENTS document (business, functional or technical requirements, BRD, SRS), a FEASIBILITY STUDY, or PART OF AN RFP / tender; it can also be a brief, proposal, business case, statement of work or slide deck. First decide which ("doc_kind"), then read it that way: ' +
  'REQUIREMENTS: the requirements ARE the scope: group them into work packages and deliverables, keep the must-haves (MoSCoW, priorities, IDs such as FR-12 where given) and the non-functional ones (security, performance, availability, compliance, integration); the client is the business that owns the requirements. ' +
  'FEASIBILITY STUDY: the project is the RECOMMENDED option (say which one, and why); take its scope, cost estimate, benefits, timeline, implementation approach and the risks the study found; options that were rejected go to out_of_scope. ' +
  'RFP / TENDER (or part of one): the client is the organisation that issued it; the project is the work the supplier would deliver; take the statement of requirements, deliverables, service levels, contract term, milestones and evaluation criteria; the bid submission deadline and question dates are NOT project dates (put them in "gaps" or constraints), and say in "gaps" which RFP parts seem missing if it is only part of one. ' +
  'Read ALL of it carefully and set up the project in a project management tool. Use only what the document says; never invent names, dates or figures (leave a field empty if it is not there). ' +
  'Return JSON only, with: "name" (a short project name, at most 80 characters), "client" (the organisation the work is for), "sponsor" (the person or role who backs it), "manager" (the project manager, if named), ' +
  '"site" (the location: city, region or address), "start_date" and "finish_date" (YYYY-MM-DD, only if stated or clearly implied), "budget" (the figure with its currency, as written), "project_type" (e.g. ERP implementation, building fit-out, ESG strategy), ' +
  '"summary": what the project is about, AS DESCRIPTIVE AS THE DOCUMENT ALLOWS, in plain prose (background, the problem or opportunity, objectives, what will be delivered, approach, key dates, budget, main stakeholders, constraints): 900 to 3,000 characters; ' +
  '"brief": an object for the planner with arrays of short, specific lines: "objectives", "in_scope", "out_of_scope", "deliverables", "phases" ([{"name","what","when"}] in order), "milestones" ([{"name","date"}]), ' +
  '"stakeholders" ([{"who","role"}], roles or organisations; names only if given), "requirements", "constraints", "assumptions", "risks", "success_criteria", and "budget_notes" (one line). ' +
  'Also return "doc_kind": "requirements" | "feasibility" | "rfp" | "brief" | "business_case" | "proposal" | "other". ' +
  'Add "pages": {"field": [page numbers]} for where you found the name, client, sponsor, site, dates and budget, and "confidence": "high" | "medium" | "low" for the whole reading, and "gaps": things a project manager should still find out (at most 6). ' +
  'Write in the document\'s language unless asked otherwise. Keep every list item under 200 characters.';

export async function ingest({ sid, lang }, by) {
  const d = await staged(sid); if (!d) return { error: 'The document has expired or was not found. Upload it again.' };
  if (!llmSetup()) return { error: 'AI is not set up yet: add LLM_API_KEY (DeepSeek) in Netlify.' };
  try { await checkLimit(); } catch (e) { return { error: e.message }; }
  const all = chunks(d.text), maxChars = Math.floor(inputBudget() * CPT);
  const sel = select(all, FIELDS, maxChars);
  const body = sel.picked.map((c) => `[p. ${c.page || '?'}]\n${c.text}`).join('\n\n---\n\n');
  const user = { document: d.name, pages: d.pages, chunks_total: all.length, chunks_given: sel.picked.length, given_whole: sel.whole, write_in: lang && lang !== 'en' ? lang : undefined, extracts: body };
  let o, used, cutOff;
  try { ({ data: o, used, cutOff } = await llmJson([{ role: 'system', content: SYS }, { role: 'user', content: JSON.stringify(user) }], { maxTokens: 6000, timeoutMs: 600000, temperature: 0.2 })); }
  catch (e) { return { error: e.message }; }
  const today = await usage(true, used);
  const L = (x, n = 30, m = 220) => (Array.isArray(x) ? x : []).map((v) => (v && typeof v === 'object' ? Object.values(v).filter(Boolean).join(': ') : v)).map((v) => str(v, m)).filter(Boolean).slice(0, n);
  const b = o.brief && typeof o.brief === 'object' ? o.brief : {};
  const ymd = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : '');
  const brief = { objectives: L(b.objectives), in_scope: L(b.in_scope, 40), out_of_scope: L(b.out_of_scope), deliverables: L(b.deliverables, 40),
    phases: (Array.isArray(b.phases) ? b.phases : []).slice(0, 25).map((p) => (p && typeof p === 'object' ? { name: str(p.name, 120), what: str(p.what, 300), when: str(p.when, 80) } : { name: str(p, 120), what: '', when: '' })).filter((p) => p.name),
    milestones: (Array.isArray(b.milestones) ? b.milestones : []).slice(0, 30).map((m) => (m && typeof m === 'object' ? { name: str(m.name, 160), date: str(m.date, 40) } : { name: str(m, 160), date: '' })).filter((m) => m.name),
    stakeholders: (Array.isArray(b.stakeholders) ? b.stakeholders : []).slice(0, 30).map((s) => (s && typeof s === 'object' ? { who: str(s.who || s.name, 120), role: str(s.role, 160) } : { who: str(s, 120), role: '' })).filter((s) => s.who),
    requirements: L(b.requirements, 40), constraints: L(b.constraints), assumptions: L(b.assumptions), risks: L(b.risks), success_criteria: L(b.success_criteria), budget_notes: str(b.budget_notes, 300) };
  const KIND = { requirements: 'Requirements document', feasibility: 'Feasibility study', rfp: 'RFP / tender', brief: 'Project brief', business_case: 'Business case', proposal: 'Proposal', other: 'Project document' };
  const kind = KIND[String(o.doc_kind || '').toLowerCase()] || 'Project document';
  const fields = { name: str(o.name, 120), client: str(o.client, 120), sponsor: str(o.sponsor, 80), manager: str(o.manager, 80), site: str(o.site, 80), start: ymd(o.start_date), finish: ymd(o.finish_date),
    budget: str(o.budget, 80), type: str(o.project_type, 120), summary: str(o.summary, 4000), kind };
  if (!fields.name && !fields.summary) return { error: 'The AI could not read a project out of this document. Check it is the right file.', tokens: used, today };
  const pages = {}; if (o.pages && typeof o.pages === 'object') for (const [k, v] of Object.entries(o.pages)) pages[str(k, 20)] = (Array.isArray(v) ? v : [v]).map(Number).filter((n) => n > 0).slice(0, 6);
  return { fields, brief, briefText: briefText(fields, brief, d.name), pages, gaps: L(o.gaps, 6), confidence: ['high', 'medium', 'low'].includes(o.confidence) ? o.confidence : 'medium',
    doc: { sid: d.sid, name: d.name, pages: d.pages, chars: d.text.length, chunks: all.length, used: sel.picked.length, whole: sel.whole, coverage: Math.round(sel.coverage * 100) }, tokens: used, cutOff: !!cutOff, today };
}
function inputBudget() { return budget() - 6000 - 1500; }   // room for the answer and the instructions
// the brief the plan builder gets (and the scope box shows): everything the document says, in order
export function briefText(f, b, docName) {
  const sec = (t, L) => (L && L.length ? `${t}:\n` + L.map((x) => '- ' + x).join('\n') : '');
  return [
    `From the ${(f.kind || 'project document').toLowerCase()} "${docName}".`, f.type ? `Project type: ${f.type}` : '', f.site ? `Location: ${f.site}` : '', f.start || f.finish ? `Dates: ${f.start || '?'} to ${f.finish || '?'}` : '', f.budget ? `Budget: ${f.budget}` : '',
    f.summary ? `About the project:\n${f.summary}` : '',
    sec('Objectives', b.objectives), sec('In scope', b.in_scope), sec('Out of scope', b.out_of_scope), sec('Deliverables', b.deliverables),
    b.phases.length ? 'Phases (in order):\n' + b.phases.map((p, i) => `${i + 1}. ${p.name}${p.when ? ' (' + p.when + ')' : ''}${p.what ? ': ' + p.what : ''}`).join('\n') : '',
    b.milestones.length ? 'Milestones:\n' + b.milestones.map((m) => `- ${m.name}${m.date ? ' (' + m.date + ')' : ''}`).join('\n') : '',
    sec('Requirements', b.requirements), b.stakeholders.length ? 'Stakeholders:\n' + b.stakeholders.map((s) => `- ${s.who}${s.role ? ': ' + s.role : ''}`).join('\n') : '',
    sec('Constraints', b.constraints), sec('Assumptions', b.assumptions), sec('Risks named in the document', b.risks), sec('Success criteria', b.success_criteria), b.budget_notes ? `Budget notes: ${b.budget_notes}` : ''
  ].filter(Boolean).join('\n\n').slice(0, 16000);
}
// the questions the plan builder asks of the document
export const PLAN_QUERIES = ['phases stages approach methodology work breakdown activities tasks', 'timeline schedule milestones dates deadline go-live duration weeks', 'deliverables outputs acceptance',
  'requirements specifications functional technical', 'dependencies sequence prerequisites approvals', 'resources team roles vendors procurement', 'risks constraints assumptions', 'testing training handover transition support'];
