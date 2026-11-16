// GKH Project Champ: 📘 lessons learned. Each project keeps a living log of lessons (plan.lessons, captured as the work goes);
// the AI suggests lessons from the project's own history, writes a 4-page illustrated lessons-learned report (up to about
// 80,000 tokens of context: the facts, the log, risks, issues, changes and the project's documents) with the script of a
// 30-second scribe video, and every agreed lesson goes into a library that other projects reuse (Champ suggests the ones
// that fit a new or running project).
import * as kv from './kv.mjs';
import * as J from './jobs.mjs';
import * as P from './plan.mjs';
import { llmJson, usage, checkLimit, llmSetup, sydToday } from './ai.mjs';

const str = (s, n = 300) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, n);
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
export const CATS = ['Schedule', 'Cost', 'Scope', 'Quality', 'Risk', 'Stakeholders', 'People and resources', 'Vendors and procurement', 'Technical', 'Communication', 'Governance', 'Change control'];
export const ICONS = ['calendar', 'money', 'warning', 'people', 'up', 'down', 'check', 'idea', 'puzzle', 'handshake', 'rocket', 'flag', 'gear', 'document', 'clock', 'target'];
const days = (a, b) => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 864e5) : 0);

// the project in numbers: plan vs baseline by phase, cost, earned value, what happened (milestones, risks, issues, changes)
export function facts(job, plan) {
  const today = sydToday(), p = JSON.parse(JSON.stringify(plan)), R = P.rollup(p, today), b = plan.baseline || null, C = plan.charter || {};
  const ph = (p.phases || []).map((f) => {
    const T = p.tasks.filter((t) => t.phase === f.id); if (!T.length) return null;
    const bs = T.map((t) => b && b.tasks && b.tasks[t.id]).filter(Boolean);
    const min = (a) => a.filter(Boolean).sort()[0] || '', max = (a) => a.filter(Boolean).sort().slice(-1)[0] || '';
    return { phase: f.name, planned_start: min(bs.map((x) => x.es)), planned_finish: max(bs.map((x) => x.ef)), start: min(T.map((t) => t.es)), finish: max(T.map((t) => t.ef)),
      planned_cost: r2(bs.reduce((a, x) => a + (Number(x.cost) || 0), 0)), cost: r2(T.reduce((a, t) => a + P.taskCost(t), 0)), actual: r2(T.reduce((a, t) => a + (Number(t.actual) || 0), 0)),
      pct: Math.round(T.reduce((a, t) => a + (t.pct || 0) * Math.max(1, t.dur || 0), 0) / Math.max(1, T.reduce((a, t) => a + Math.max(1, t.dur || 0), 0))) };
  }).filter(Boolean);
  ph.forEach((x) => { x.slip_days = x.planned_finish && x.finish ? days(x.planned_finish, x.finish) : 0; });
  const ms = p.tasks.filter((t) => t.dur === 0).map((t) => ({ name: str(t.name, 120), planned: b && b.tasks && b.tasks[t.id] ? b.tasks[t.id].ef : '', date: t.ef, done: (t.pct || 0) >= 100 }));
  return {
    today, project: str(plan.name, 140), client: str(job.name, 120), program: str(job.program || '', 120), objective: str(C.objective, 600), summary: str(job.summary || C.background, 800),
    start: R.start, finish: R.finish, baseline_finish: b ? b.finish : '', slip_days: b && b.finish && R.finish ? days(b.finish, R.finish) : 0,
    budget: Number(C.budget) || (b && b.BAC) || R.BAC, baseline_cost: (b && b.BAC) || 0, BAC: R.BAC, EAC: R.EAC != null ? R.EAC : R.BAC, AC: R.AC, EV: R.EV, PV: R.PV, SPI: R.SPI, CPI: R.CPI, pct: R.pct,
    tasks_total: R.total, tasks_done: R.done, tasks_late: R.late, phases: ph, milestones: ms.slice(0, 30),
    risks: (plan.risks || []).slice(0, 40).map((r) => ({ title: str(r.title, 160), score: (r.p || 0) * (r.i || 0), response: r.response, status: r.status, action: str(r.action, 200) })),
    issues: (plan.issues || []).slice(0, 40).map((x) => ({ title: str(x.title, 160), priority: x.priority, status: x.status, raised: x.raised || '', resolution: str(x.resolution, 200) })),
    changes: (plan.changes || []).slice(-30).map((c) => ({ cr: 'CR-' + String(c.num).padStart(3, '0'), title: str(c.title, 140), status: c.status, days: c.effect ? c.effect.days : 0, cost: c.effect ? c.effect.cost : 0, reason: str(c.reason, 200) })),
    team: (plan.stakeholders || []).slice(0, 30).map((x) => ({ role: str(x.role, 60), raci: x.raci })),
    meetings: (plan.meetings || []).slice(-10).map((m) => ({ title: str(m.title, 100), date: m.date, status: m.status })),
  };
}
const logOf = (plan) => (plan.lessons || []).filter((l) => l && l.title).map((l) => ({ title: str(l.title, 160), category: l.category, phase: l.phase, impact: l.impact, what: str(l.what, 500), cause: str(l.cause, 400), recommendation: str(l.rec, 400), status: l.status }));

async function aiReady() { if (!llmSetup()) return 'AI is not set up yet: add LLM_API_KEY (DeepSeek) in Netlify.'; try { await checkLimit(); } catch (e) { return e.message; } return ''; }

// ✨ lessons from the project's own history (the PM reviews them before they go into the log)
export async function suggest(core) {
  const job = await J.find(core), plan = await P.get(core); if (!job || !plan) return { error: 'Project not found' };
  const no = await aiReady(); if (no) return { error: no };
  const sys = 'You are a PMO lead running a lessons-learned review (PMBOK, PRINCE2 "learn from experience"). From the project\'s facts (plan vs baseline by phase, earned value, milestones, risks, issues, change requests) and the lessons already logged, ' +
    'write the lessons this project teaches: both what went WELL (to repeat) and what went WRONG (to avoid). Each lesson must be specific to the evidence (name the phase, task, risk, issue or change request, and the days or dollars), not generic advice. Do not repeat lessons already logged. Australian English. ' +
    `category: one of ${CATS.join(', ')}. impact: "positive" or "negative". JSON only: {"lessons":[{"title":"under 12 words","category":"","phase":"phase name or empty","impact":"","what":"what happened, with the numbers","cause":"the root cause","rec":"what to do next time (imperative)","evidence":"short"}]} — 5 to 10 lessons.`;
  let o, used;
  try { ({ data: o, used } = await llmJson([{ role: 'system', content: sys }, { role: 'user', content: JSON.stringify({ facts: facts(job, plan), logged: logOf(plan) }) }], { maxTokens: 3500, timeoutMs: 180000, temperature: 0.3 })); }
  catch (e) { return { error: e.message || 'The AI did not answer. Try again.' }; }
  await usage(true, used || 0).catch(() => {});
  const L = (o && Array.isArray(o.lessons) ? o.lessons : []).slice(0, 12).map((l) => ({ title: str(l.title, 160), category: CATS.includes(l.category) ? l.category : 'Governance', phase: str(l.phase, 80), impact: l.impact === 'positive' ? 'positive' : 'negative', what: str(l.what, 600), cause: str(l.cause, 400), rec: str(l.rec, 400), evidence: str(l.evidence, 200) })).filter((l) => l.title);
  if (!L.length) return { error: 'The AI did not suggest any lessons. Try again.' };
  return { lessons: L, tokens: used || 0 };
}

// the documents, cut to what is left of the budget (the start of each, then the passages about problems, delays, cost, decisions)
async function docsDigest(core, chars) {
  if (chars < 2000) return [];
  const { docList } = await import('./plan-intel.mjs');
  const docs = (await docList(core)).filter((d) => !d.superseded && d.words), texts = await kv.getMany(docs.map((d) => `pdoctext:${core}:${d.id}`));
  const ans = await kv.getMany(docs.map((d) => `pdocai:${core}:${d.id}`)).catch(() => []);
  const per = Math.max(1500, Math.floor(chars / Math.max(1, docs.length)));
  const key = /(delay|late|slip|overrun|over budget|issue|problem|risk|lesson|decision|agreed|approved|change|defect|escalat|blocked|root cause|went well|success|improv)/i;
  return docs.slice(0, 40).map((d, i) => {
    const t = String((texts[i] && texts[i].text) || ''); let out = t;
    if (t.length > per) { const paras = t.split(/\n{2,}/), head = t.slice(0, Math.floor(per * 0.3)); const rest = paras.filter((x) => key.test(x)).join('\n\n'); out = (head + '\n[…]\n' + rest).slice(0, per); }
    return { name: d.title || d.name, folder: d.folder || '', analysis: ans[i] && ans[i].data ? { summary: ans[i].data.summary, alignment: ans[i].data.alignment, gaps: ans[i].data.gaps } : undefined, text: out };
  });
}
// 📄 the 4-page report and the 30-second scribe video script
export async function report(core, by) {
  const job = await J.find(core), plan = await P.get(core); if (!job || !plan) return { error: 'Project not found' };
  const no = await aiReady(); if (no) return { error: no };
  const F = facts(job, plan), log = logOf(plan);
  const budget = Math.max(20000, Math.min(120000, Number(process.env.LESSONS_TOKENS || 80000) || 80000));   // the whole context, in tokens
  const base = JSON.stringify({ F, log }).length / 3.6, room = Math.max(0, (budget - 9000 - base) * 3.6);
  const documents = await docsDigest(core, room);
  const sys = 'You are a senior PMO consultant writing a lessons-learned report for executives in GKH Project Champ: a crisp 4-page illustrated document, written like a top consultancy (clear, evidence-based, no fluff). Australian English, no markdown. ' +
    'Use the facts (numbers, dates, phases), the lessons log and the documents. Every claim must come from the evidence. The graphics are drawn from the facts by the app; you write the words. ' +
    'Return JSON: {"title":"short report title","subtitle":"one line","headline":"one sentence verdict on the project",' +
    '"story":["3 short paragraphs: what the project set out to do, what happened, where it stands"],' +
    '"went_well":[{"title":"under 10 words","detail":"2 sentences with the evidence","icon":"' + ICONS.join('|') + '"}] (3 to 5),' +
    '"went_wrong":[{"title":"under 10 words","detail":"2 sentences with the evidence","cause":"root cause in one line","cause_category":"People|Process|Technology|Vendors|Governance|Environment","icon":"..."}] (3 to 5),' +
    '"recommendations":[{"title":"imperative, under 10 words","detail":"1-2 sentences","owner":"role, e.g. PMO, Sponsor, PM","when":"e.g. At initiation, During planning, Every sprint","applies_to":"what kind of future projects"}] (4 to 6),' +
    '"reuse":["4-6 one-line checks a future project manager should apply (a reusable checklist)"],' +
    '"quote":"one memorable sentence that sums up the lesson",' +
    '"video":{"title":"under 7 words","scenes":[{"icon":"' + ICONS.join('|') + '","caption":"under 7 words","say":"narration under 16 words"}]}} — the video has 4 or 5 scenes and lasts at most 30 seconds read aloud: the problem, what happened, the turning point or root cause, the lesson, the call to action.';
  let o, used;
  try { ({ data: o, used } = await llmJson([{ role: 'system', content: sys }, { role: 'user', content: JSON.stringify({ facts: F, lessons_log: log, documents }) }], { maxTokens: 6000, timeoutMs: 300000, temperature: 0.35 })); }
  catch (e) { return { error: e.message || 'The AI did not answer. Try again.' }; }
  await usage(true, used || 0).catch(() => {});
  if (!o || !o.headline) return { error: 'The AI did not return a report. Try again.' };
  const arr = (a, n) => (Array.isArray(a) ? a.slice(0, n) : []), icon = (x) => (ICONS.includes(x) ? x : 'idea');
  const data = { title: str(o.title, 120) || 'Lessons learned', subtitle: str(o.subtitle, 200), headline: str(o.headline, 300), story: arr(o.story, 4).map((x) => str(x, 900)).filter(Boolean),
    went_well: arr(o.went_well, 5).map((x) => ({ title: str(x && x.title, 120), detail: str(x && x.detail, 500), icon: icon(x && x.icon) })).filter((x) => x.title),
    went_wrong: arr(o.went_wrong, 5).map((x) => ({ title: str(x && x.title, 120), detail: str(x && x.detail, 500), cause: str(x && x.cause, 240), cause_category: str(x && x.cause_category, 30) || 'Process', icon: icon(x && x.icon) })).filter((x) => x.title),
    recommendations: arr(o.recommendations, 6).map((x) => ({ title: str(x && x.title, 120), detail: str(x && x.detail, 400), owner: str(x && x.owner, 60), when: str(x && x.when, 60), applies_to: str(x && x.applies_to, 120) })).filter((x) => x.title),
    reuse: arr(o.reuse, 6).map((x) => str(x, 200)).filter(Boolean), quote: str(o.quote, 240),
    video: { title: str(o.video && o.video.title, 80) || str(o.title, 60), scenes: arr(o.video && o.video.scenes, 5).map((s) => ({ icon: icon(s && s.icon), caption: str(s && s.caption, 60), say: str(s && s.say, 140) })).filter((s) => s.caption) } };
  const rec = { at: Date.now(), by: str(by, 60), tokens: used || 0, context: Math.round(base + JSON.stringify(documents).length / 3.6), docs: documents.length, facts: F, data };
  await kv.set('lessons-report:' + core, rec);
  return { report: rec, tokens: used || 0 };
}
export async function reportGet(core) { return (await kv.get('lessons-report:' + core).catch(() => null)) || null; }

// 📚 the library: every lesson marked reusable on every project, ranked for a project by how much it has in common with it
const WORD = /[a-z0-9]{3,}/g, STOP = new Set('the and for with that this from are was were will have has had not but you your our all any can its their there what when who how which into out per may must shall such than then them they these those been being also more most other some only over very project projects team work next time'.split(' '));
const toks = (s) => (String(s || '').toLowerCase().match(WORD) || []).filter((w) => !STOP.has(w));
export async function library({ q = '', forCore = '', limit = 60 } = {}) {
  const [plans, jobs] = await Promise.all([P.list(), J.all().catch(() => [])]);
  const jb = Object.fromEntries((jobs || []).map((j) => [j.core, j]));
  const all = [];
  for (const p of plans) for (const l of p.lessons || []) {
    if (!l || !l.title || l.reuse === false || l.status === 'Draft' && !l.reuse) continue;
    const j = jb[p.core] || {};
    all.push({ id: l.id, core: p.core, project: p.name || '', client: j.name || '', program: j.program || '', title: l.title, category: l.category, impact: l.impact, what: l.what || '', cause: l.cause || '', rec: l.rec || '', phase: l.phase || '', at: l.at || 0 });
  }
  let cand = all.filter((x) => x.core !== forCore);
  // what to match: the search words, or the project itself (name, client, program, summary, phases, task names, risks)
  let want = toks(q);
  if (!want.length && forCore) {
    const p = plans.find((x) => x.core === forCore), j = jb[forCore] || {};
    if (p) want = toks([p.name, j.name, j.program, j.summary, (p.charter || {}).objective, (p.phases || []).map((f) => f.name).join(' '), (p.tasks || []).slice(0, 80).map((t) => t.name).join(' '), (p.risks || []).map((r) => r.title).join(' ')].join(' '));
  }
  if (want.length) {
    const df = {}; cand.forEach((x) => new Set(toks(x.title + ' ' + x.what + ' ' + x.rec + ' ' + x.category)).forEach((w) => { df[w] = (df[w] || 0) + 1; }));
    const W = {}; want.forEach((w) => { W[w] = (W[w] || 0) + 1; });
    cand = cand.map((x) => { const t = toks(x.title + ' ' + x.what + ' ' + x.cause + ' ' + x.rec + ' ' + x.category + ' ' + x.program); let s = 0; new Set(t).forEach((w) => { if (W[w]) s += Math.log(1 + cand.length / (1 + (df[w] || 0))) * Math.min(3, W[w]); }); return { ...x, score: r2(s) }; })
      .filter((x) => x.score > (q ? 0 : 1.5)).sort((a, b) => b.score - a.score);
  } else cand.sort((a, b) => b.at - a.at);
  return { lessons: cand.slice(0, limit), total: all.length };
}
