// GKH Project Champ: 📘 the Project Management Plan document. The AI writes the narrative (executive summary, approach,
// management plans for schedule, cost, resources, communications, risk, quality, change, procurement, governance, closure)
// from the real plan, in three parts at the same time, within a token budget (AI_PLANDOC_MAX_TOKENS, default 50,000).
// The browser lays it out (admin-studio.js) with the plan's own tables and charts, as PDF and Word.
//   plandoc:<core>   the last narrative written: { at, by, tokens, sections }
import * as kv from './kv.mjs';
import * as J from './jobs.mjs';
import * as P from './plan.mjs';
import { llmJson, usage, checkLimit, llmSetup } from './ai.mjs';
import { context } from './plan-intel.mjs';

const str = (s, max = 4000) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
const arr = (a, n) => (Array.isArray(a) ? a : []).slice(0, n);
const budget = () => Math.max(12000, Math.min(120000, Number(process.env.AI_PLANDOC_MAX_TOKENS || 50000) || 50000));

const BASE = 'You are a senior project manager (PMP, PRINCE2) writing sections of a formal Project Management Plan for GKH Project Champ. ' +
  'Write for the sponsor and the project team: clear, specific to THIS project (use its real tasks, dates, costs, risks, stakeholders and change requests from the data), confident and professional, Australian spelling. ' +
  'Never invent people, amounts or dates that are not in the data; where something is not known write what will be done to settle it. Use **bold** for key points, "- " for bullets. No emoji. Money as $1,234. Dates as D Month YYYY. ' +
  'Reply JSON only, with exactly the keys asked for.';

const LANG = { ms: 'Bahasa Melayu (Malay)', id: 'Bahasa Indonesia', ta: 'Tamil', zh: 'Simplified Chinese', hi: 'Hindi', ar: 'Arabic', fa: 'Persian', vi: 'Vietnamese', th: 'Thai', tl: 'Filipino', ja: 'Japanese', ko: 'Korean', es: 'Spanish', fr: 'French', de: 'German', pt: 'Portuguese', sw: 'Kiswahili', rw: 'Kinyarwanda' };
const PARTS = [
  { keys: 'A', ask: 'Write: "executive_summary" (220-280 words: what, why, when, cost, how it is run, the main risks), "background" (120-180 words), "objectives" (4-6 items {"objective":"SMART objective","measure":"how success is measured"}), ' +
    '"success_criteria" (4-6 short strings), "scope_statement" (130-180 words: what is delivered and the boundaries), "approach" (180-240 words: methodology, phases and how the work flows, with "- " bullets for the phases), ' +
    '"assumptions" (4-8 strings), "constraints" (3-6 strings), "deliverables" (4-10 items {"deliverable":"","description":"","acceptance":"how it is accepted"}).' },
  { keys: 'B', ask: 'Write: "schedule_management" (180-240 words: the baseline, milestones, the critical path and how progress and float are tracked), "cost_management" (160-220 words: the cost baseline, contingency and management reserve, how costs are tracked with earned value, the cash flow), ' +
    '"resource_management" (130-180 words), "roles" (5-9 items {"role":"","responsibilities":"one or two sentences"} from the stakeholders and team), ' +
    '"communication_plan" (6-9 items {"audience":"","information":"","method":"","frequency":"","owner":""}), "stakeholder_engagement" (110-160 words).' },
  { keys: 'C', ask: 'Write: "risk_management" (150-200 words: how risks are identified, scored 1-5 × 1-5, owned, reviewed and escalated, and the top risks for this project), "quality_management" (130-180 words), ' +
    '"quality_checks" (4-8 items {"deliverable":"","standard":"","check":"how and when it is checked"}), "change_control" (110-160 words: how changes are raised, assessed, approved and signed, recorded; mention any change requests in the data), ' +
    '"procurement" (90-140 words), "governance" (110-160 words), "governance_forums" (3-5 items {"forum":"","members":"","frequency":"","purpose":""}), ' +
    '"closure" (110-160 words: acceptance, handover, benefits, lessons learned, closing the project), "next_steps" (4-6 strings for the next 30 days).' }
];

function facts(ctx) {   // the project data the AI writes from (trimmed to keep each call small)
  const t = ctx.tasks || [];
  const miles = t.filter((x) => !x.days).map((x) => ({ n: x.n, milestone: x.task, date: x.start }));
  return { today: ctx.today, project: ctx.project, scope: ctx.scope, program: ctx.program ? { key: ctx.program.key, name: ctx.program.name, projects: (ctx.program.projects || []).length } : null,
    tasks: t.filter((x) => x.days).slice(0, 60).map((x) => ({ n: x.n, task: x.task, days: x.days, start: x.start, finish: x.finish, critical: x.critical, cost: x.cost, who: x.who })), milestones: miles.slice(0, 20),
    risks: (ctx.risks || []).slice(0, 15), issues: (ctx.issues || []).slice(0, 10), stakeholders: (ctx.stakeholders || []).slice(0, 20), change_requests: (ctx.change_requests || []).slice(-12),
    contracts: ctx.contracts, documents: (ctx.documents || []).map((d) => d.name).slice(0, 12) };
}

export async function write({ core, budgetFacts, lang }, by) {
  const job = await J.find(core); if (!job) return { error: 'Project not found' };
  const plan = await P.get(job.core); if (!plan) return { error: 'This project has no plan yet. Make the plan first.' };
  if (!llmSetup()) return { error: 'AI is not set up yet: add LLM_API_KEY (DeepSeek) in Netlify.' };
  try { await checkLimit(); } catch (e) { return { error: e.message }; }
  const { ctx } = await context(job, plan, 'project management plan: scope schedule cost risk quality communication');
  const F = facts(ctx); if (budgetFacts && typeof budgetFacts === 'object') F.budget = JSON.parse(JSON.stringify(budgetFacts).slice(0, 4000) || '{}');
  const cap = budget(), perOut = Math.min(8000, Math.floor((cap - 3 * 4500) / 3));
  const L = LANG[lang] ? lang : 'en', sys = BASE + (L !== 'en' ? ` Write every value in ${LANG[L]} (natural, professional ${LANG[L]}; the JSON keys stay in English; keep PMBOK, PRINCE2, RACI, SPI, CPI, Gantt and product names as they are).` : '');
  const results = await Promise.all(PARTS.map((part) => llmJson([{ role: 'system', content: sys }, { role: 'user', content: JSON.stringify({ task: part.ask, project_data: F }) }], { maxTokens: Math.max(2500, perOut), timeoutMs: 240000, temperature: 0.3 })
    .then((r) => ({ data: r.data || {}, used: r.used || 0 })).catch((e) => ({ data: {}, used: 0, error: e.message }))));
  const failed = results.filter((r) => r.error);
  if (failed.length === results.length) return { error: 'The AI could not write the plan: ' + failed[0].error };
  const d = Object.assign({}, ...results.map((r) => r.data)), tokens = results.reduce((a, r) => a + (r.used || 0), 0);
  const S = {
    executive_summary: str(d.executive_summary), background: str(d.background), scope_statement: str(d.scope_statement), approach: str(d.approach),
    objectives: arr(d.objectives, 8).map((o) => ({ objective: str(o && o.objective, 300), measure: str(o && o.measure, 300) })).filter((o) => o.objective),
    success_criteria: arr(d.success_criteria, 8).map((x) => str(x, 300)).filter(Boolean), assumptions: arr(d.assumptions, 10).map((x) => str(x, 300)).filter(Boolean), constraints: arr(d.constraints, 8).map((x) => str(x, 300)).filter(Boolean),
    deliverables: arr(d.deliverables, 12).map((o) => ({ deliverable: str(o && o.deliverable, 200), description: str(o && o.description, 400), acceptance: str(o && o.acceptance, 300) })).filter((o) => o.deliverable),
    schedule_management: str(d.schedule_management), cost_management: str(d.cost_management), resource_management: str(d.resource_management),
    roles: arr(d.roles, 10).map((o) => ({ role: str(o && o.role, 120), responsibilities: str(o && o.responsibilities, 400) })).filter((o) => o.role),
    communication_plan: arr(d.communication_plan, 10).map((o) => ({ audience: str(o && o.audience, 120), information: str(o && o.information, 300), method: str(o && o.method, 120), frequency: str(o && o.frequency, 80), owner: str(o && o.owner, 100) })).filter((o) => o.audience),
    stakeholder_engagement: str(d.stakeholder_engagement), risk_management: str(d.risk_management), quality_management: str(d.quality_management),
    quality_checks: arr(d.quality_checks, 10).map((o) => ({ deliverable: str(o && o.deliverable, 160), standard: str(o && o.standard, 300), check: str(o && o.check, 300) })).filter((o) => o.deliverable),
    change_control: str(d.change_control), procurement: str(d.procurement), governance: str(d.governance),
    governance_forums: arr(d.governance_forums, 6).map((o) => ({ forum: str(o && o.forum, 120), members: str(o && o.members, 300), frequency: str(o && o.frequency, 80), purpose: str(o && o.purpose, 300) })).filter((o) => o.forum),
    closure: str(d.closure), next_steps: arr(d.next_steps, 8).map((x) => str(x, 300)).filter(Boolean)
  };
  const rec = { at: Date.now(), by: str(by, 60), lang: L, tokens, cap, partial: failed.length ? failed.length + ' of 3 parts could not be written' : '', sections: S };
  await kv.set('plandoc:' + job.core, rec);
  await usage(1, tokens);
  return rec;
}
export async function last(core) { return kv.get('plandoc:' + core); }
