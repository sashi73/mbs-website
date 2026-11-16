// GKH Project Champ: 🔗 work out the dependencies of a plan. The AI reads the tasks (phases, names, days, people) and says
// which tasks must finish before each one starts (finish-to-start, the "After #" column), letting independent work run
// in parallel. Nothing changes until the project manager reviews the links and applies them in the console.
import { get, rollup } from './plan.mjs';
import { llmJson, usage, checkLimit, llmSetup, sydToday } from './ai.mjs';

const str = (s, n = 200) => String(s ?? '').trim().slice(0, n);
// no task may end up waiting for itself, directly or through others: a link that would close a loop is dropped
function noCycles(order, links) {
  const pre = Object.fromEntries(order.map((id) => [id, []]));
  const isAncestor = (x, target, seen = new Set()) => (pre[x] || []).some((q) => q === target || (!seen.has(q) && (seen.add(q), isAncestor(q, target, seen))));
  for (const id of order) for (const p of links[id] || []) if (p !== id && pre[p] && !isAncestor(p, id)) pre[id].push(p);
  return pre;
}
export async function work({ core }, by) {
  const p0 = core ? await get(core) : null;
  if (!p0 || !Array.isArray(p0.tasks) || p0.tasks.length < 2) return { error: 'The plan needs at least two tasks.' };
  if (!llmSetup()) return { error: 'AI is not set up yet: add LLM_API_KEY (DeepSeek) in Netlify.' };
  try { await checkLimit(); } catch (e) { return { error: e.message }; }
  const plan = JSON.parse(JSON.stringify(p0)); rollup(plan, sydToday());
  const ph = Object.fromEntries((plan.phases || []).map((f) => [f.id, f.name]));
  const T = plan.tasks.slice(0, 120), n = {}, idOf = {}; T.forEach((t, i) => { n[t.id] = i + 1; idOf[i + 1] = t.id; });
  const tasks = T.map((t) => ({ n: n[t.id], name: str(t.name, 120), phase: ph[t.phase] || '', days: t.dur, milestone: t.dur === 0 || undefined, after_now: (t.pred || []).map((x) => n[x]).filter(Boolean), people: (t.res || []).slice(0, 4).join(', ') || undefined, started: (t.pct || 0) > 0 || undefined, start_set_by_hand: !!t.fixed || undefined }));
  const sys = 'You are a senior project scheduler (PMBOK precedence diagramming). Work out the dependencies of this project plan: for every task, the numbers of the tasks that must FINISH before it can START (finish-to-start). ' +
    'Think about what really needs what: deliverables feed the next step, approvals and sign-offs (milestones) come after the work they approve and gate the next phase, testing follows building, go-live follows testing and training. ' +
    'Let work that does not depend on each other run IN PARALLEL (several tasks after the same predecessor, a task waiting for two), instead of one long chain, but never make a task wait for nothing it needs. ' +
    'Use only the direct predecessors (if C needs B and B needs A, C is after B only). The first task(s) have no predecessor. No loops. Keep tasks already started (started=true) and tasks whose start date is set by hand as they are unless clearly wrong. ' +
    'For each task give "after" (task numbers) and "why" (one short reason, under 14 words). Then "summary": two sentences on the logic and what can run in parallel. ' +
    'JSON only: {"links":[{"n":1,"after":[],"why":""}],"summary":""}';
  let o, used;
  try { ({ data: o, used } = await llmJson([{ role: 'system', content: sys }, { role: 'user', content: JSON.stringify({ project: str(plan.name, 120), tasks }) }], { maxTokens: Math.min(6000, 600 + T.length * 60), timeoutMs: 150000, temperature: 0.1 })); }
  catch (e) { return { error: e.message || 'The AI did not answer. Try again.' }; }
  await usage(true, used || 0).catch(() => {});
  const want = {}, why = {};
  for (const l of (o && Array.isArray(o.links) ? o.links : [])) {
    const id = idOf[Math.round(Number(l && l.n))]; if (!id) continue;
    const got = (Array.isArray(l.after) ? l.after : []).map((x) => idOf[Math.round(Number(x))]).filter((x) => x && x !== id);
    want[id] = [...new Set((want[id] || []).concat(got))].slice(0, 8);   // a task listed twice: both lists count
    if (!why[id]) why[id] = str(l.why, 160);
  }
  const order = T.map((t) => t.id), safe = noCycles(order, Object.fromEntries(order.map((id) => [id, want[id] !== undefined ? want[id] : (T.find((t) => t.id === id).pred || [])])));
  const links = T.map((t) => ({ id: t.id, n: n[t.id], name: t.name, now: (t.pred || []).slice(), after: want[t.id] !== undefined ? safe[t.id] : (t.pred || []).slice(), why: why[t.id] || '', fixed: !!t.fixed, started: (t.pct || 0) > 0 }));
  return { links, summary: str(o && o.summary, 600), tokens: used || 0, rev: p0.rev || 0 };
}
