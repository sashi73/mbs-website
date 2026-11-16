// GKH Project Champ: 🩺 Champ's project watch. Every project gets a Red / Amber / Green health check from fixed rules
// (earned value, the baseline, late work, risks, issues and the budget), so the colour is the same every time and can be
// explained to a client. Then Champ, as an agent, writes a short brief: what is wrong, why, and what it would do next.
// The rules cost nothing; the brief is one AI call, kept (watch:<core>) until the project's numbers change, at most once a day.
import * as kv from './kv.mjs';
import { rollup, taskCost } from './plan.mjs';
import { llmJson, usage, checkLimit, llmSetup, sydToday } from './ai.mjs';
import * as KB from './kb.mjs';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const days = (a, b) => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 864e5) : 0);
const money = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-AU');
export const RAG_WORD = { red: 'Act now', amber: 'Watch closely', green: 'On track', grey: 'Not enough data yet' };

// the rules: the colour and every reason for it, worst first
export function check(plan, today = sydToday()) {
  if (!plan || !Array.isArray(plan.tasks) || !plan.tasks.length) return { rag: 'grey', word: RAG_WORD.grey, reasons: [{ lvl: 'grey', k: 'plan', text: 'No plan yet: add tasks with dates and costs so Champ can watch it.' }], n: {} };
  const R = rollup(plan, today), c = plan.charter || {}, b = plan.baseline || null;
  const budget = Number(c.budget) || 0, EAC = R.EAC != null ? R.EAC : R.BAC;
  const slip = b && b.finish && R.finish ? days(b.finish, R.finish) : 0;
  const late = plan.tasks.filter((t) => (t.pct || 0) < 100 && t.ef && t.ef < today && t.dur > 0).sort((x, y) => (x.ef < y.ef ? -1 : 1));
  const lateMs = plan.tasks.filter((t) => (t.pct || 0) < 100 && t.ef && t.ef < today && t.dur === 0);
  const risks = (plan.risks || []).filter((x) => x.status !== 'Closed' && x.title).map((x) => ({ ...x, score: (x.p || 0) * (x.i || 0) })).sort((x, y) => y.score - x.score);
  const high = risks.filter((x) => x.score >= 12), issues = (plan.issues || []).filter((x) => x.status !== 'Resolved' && x.title);
  const crit = issues.filter((x) => x.priority === 'Critical'), hi = issues.filter((x) => x.priority === 'High');
  const over = budget ? r2((EAC - budget) / budget * 100) : null;
  const reasons = [], add = (lvl, k, text) => reasons.push({ lvl, k, text });
  if (R.SPI != null && R.SPI < 0.9) add('red', 'spi', `Behind schedule: SPI ${R.SPI.toFixed(2)} (only ${Math.round(R.SPI * 100)}% of the work planned by today is done).`);
  else if (R.SPI != null && R.SPI < 1) add('amber', 'spi', `Slightly behind schedule: SPI ${R.SPI.toFixed(2)}.`);
  if (R.CPI != null && R.CPI < 0.9) add('red', 'cpi', `Over budget: CPI ${R.CPI.toFixed(2)} (every $1 spent delivers ${Math.round(R.CPI * 100)}c of work).`);
  else if (R.CPI != null && R.CPI < 1) add('amber', 'cpi', `Slightly over budget: CPI ${R.CPI.toFixed(2)}.`);
  if (slip > 21) add('red', 'slip', `Finish has moved ${slip} days past the baseline (${b.finish} → ${R.finish}).`);
  else if (slip > 0) add('amber', 'slip', `Finish is ${slip} days past the baseline (${b.finish} → ${R.finish}).`);
  if (over != null && over > 10) add('red', 'eac', `Forecast cost ${money(EAC)} is ${Math.round(over)}% over the approved budget of ${money(budget)}.`);
  else if (over != null && over > 0) add('amber', 'eac', `Forecast cost ${money(EAC)} is ${over.toFixed(1)}% over the approved budget of ${money(budget)}.`);
  if (late.length >= 3) add('red', 'late', `${late.length} tasks are past their finish date and not done.`);
  else if (late.length) add('amber', 'late', `${late.length} task${late.length > 1 ? 's are' : ' is'} past its finish date and not done.`);
  if (lateMs.length) add(lateMs.length >= 2 ? 'red' : 'amber', 'ms', `${lateMs.length} milestone${lateMs.length > 1 ? 's' : ''} missed: ${lateMs.map((t) => t.name).slice(0, 2).join('; ')}.`);
  if (crit.length) add('red', 'issue', `${crit.length} critical issue${crit.length > 1 ? 's' : ''} open: ${crit.map((x) => x.title).slice(0, 2).join('; ')}.`);
  else if (hi.length) add('amber', 'issue', `${hi.length} high-priority issue${hi.length > 1 ? 's' : ''} open.`);
  if (high.length >= 3) add('red', 'risk', `${high.length} high risks (score 12 or more) are open.`);
  else if (high.length) add('amber', 'risk', `${high.length} high risk${high.length > 1 ? 's' : ''} open: ${high[0].title}.`);
  const rag = reasons.some((x) => x.lvl === 'red') ? 'red' : reasons.some((x) => x.lvl === 'amber') ? 'amber' : 'green';
  if (rag === 'green') add('green', 'ok', R.SPI == null && R.CPI == null ? 'No work due yet and nothing spent: on plan so far.' : 'On schedule and within budget.');
  reasons.sort((x, y) => ({ red: 0, amber: 1, green: 2, grey: 3 }[x.lvl] - { red: 0, amber: 1, green: 2, grey: 3 }[y.lvl]));
  const n = { today, pct: R.pct, SPI: R.SPI, CPI: R.CPI, BAC: R.BAC, AC: R.AC, EV: R.EV, PV: R.PV, EAC: r2(EAC), budget, over_pct: over, finish: R.finish, baseline_finish: (b && b.finish) || '', slip_days: slip,
    late_tasks: late.slice(0, 8).map((t) => ({ name: t.name, due: t.ef, pct: t.pct || 0, cost: taskCost(t) })), missed_milestones: lateMs.map((t) => t.name).slice(0, 4),
    top_risks: risks.slice(0, 5).map((x) => ({ title: x.title, score: x.score, response: x.response, action: x.action, owner: x.owner })),
    open_issues: issues.slice(0, 6).map((x) => ({ title: x.title, priority: x.priority, owner: x.owner, due: x.due })) };
  return { rag, word: RAG_WORD[rag], reasons, n };
}
// the numbers that matter: the brief is written again only when one of them changes (or on a new day)
const sigOf = (h) => JSON.stringify([h.rag, h.n.today, h.n.pct, h.n.SPI, h.n.CPI, h.n.EAC, h.n.finish, h.n.budget, h.n.late_tasks.length, h.n.top_risks.map((x) => x.score), h.n.open_issues.length]);

// what Champ would do, from the rules alone (when the AI is not set up or the daily limit is reached)
function fallback(h) {
  const k = new Set(h.reasons.map((x) => x.k)), a = [];
  if (k.has('spi') || k.has('slip') || k.has('late') || k.has('ms')) a.push({ title: 'Recover the schedule on the critical path', detail: 'Look at the critical path first: crash the late tasks (more people or overtime), fast-track tasks that can overlap, and move non-critical work out of the way.' });
  if (k.has('cpi') || k.has('eac')) a.push({ title: 'Get the cost back under control', detail: 'Find what is driving the overspend (rates, extra hours, rework), stop work that is not in the charter, and agree any extra scope through a change request.' });
  if (k.has('issue')) a.push({ title: 'Escalate the critical issues this week', detail: 'Give each critical issue one owner and a date, and take the blockers to the sponsor.' });
  if (k.has('risk')) a.push({ title: 'Act on the top risks', detail: 'Make sure each high risk has a real mitigation action, an owner and a date, and check them weekly.' });
  if (h.rag === 'red') a.push({ title: 'Reset with the sponsor', detail: 'Present the honest forecast (finish and cost), the options to recover and what each costs, then re-baseline through change control once agreed.' });
  if (h.rag === 'green') a.push({ title: 'Keep the rhythm', detail: 'Keep progress and actual costs up to date weekly, so Champ can spot a slip early.' });
  const headline = h.rag === 'red' ? 'This project needs corrective action now.' : h.rag === 'amber' ? 'Things are moving, but watch these closely.' : h.rag === 'green' ? 'On track. Keep an eye on it.' : 'Not enough data yet.';
  return { headline, summary: h.reasons.map((x) => x.text).slice(0, 3).join(' '), actions: a.slice(0, 5), watch: [], ai: false };
}

// ai false (the console, straight away): the brief kept from before if the numbers have not changed, otherwise the rules' brief
// marked stale, and the console asks for a fresh one in the background (ai true: one AI call, kept).
export async function brief(core, plan, { refresh = false, name = '', ai = false, lang = 'en' } = {}) {
  const h = check(plan), sig = sigOf(h) + '|' + lang, key = 'watch:' + core;
  const old = await kv.get(key).catch(() => null);
  if (!refresh && old && old.sig === sig && old.brief) return { ...h, brief: old.brief, at: old.at, cached: true };
  if (h.rag === 'grey') return { ...h, brief: fallback(h), at: Date.now() };
  if (!ai) return { ...h, brief: fallback(h), at: Date.now(), stale: !!llmSetup() };
  let out = null;
  if (llmSetup()) {
    try {
      await checkLimit();
      const q = h.reasons.map((x) => x.text).join(' ') + ' ' + (h.rag === 'red' ? 'project recovery corrective action' : 'monitoring and control');
      const hits = await KB.search(q, 2000).catch(() => []), notes = hits.length ? KB.forPrompt(hits) : undefined;
      const sys = 'You are Champ, the project-monitoring agent inside GKH Project Champ. You watch every project like a seasoned PMP project director and brief the project manager the moment they open it. ' +
        `The health check (fixed rules) says ${h.rag.toUpperCase()}. Red = corrective action needed now; amber = things are moving but watch these closely; green = fine, stay mindful. Do not change the colour. ` +
        'Write the brief from the numbers, the late tasks, risks and issues given (name them; use the real figures, dates and owners). ' +
        'headline: one short sentence that leads with the colour in plain words (e.g. "Heads up: this project is 55 days late and 23% over budget."). summary: 2-3 sentences on what is going wrong and why. ' +
        'actions: 3 to 5 things you would do if you were the project manager, most important first, each {title (imperative, under 9 words), detail (1-2 sentences, specific to this project: which tasks, which risk, who)}. Use real PM techniques where they fit (crashing, fast-tracking, re-sequencing the critical path, de-scoping with the sponsor, a change request and re-baseline, EVM and EAC, value engineering, escalation, risk response). ' +
        'For green keep it to 1-2 light actions. watch: 1-3 short things to keep an eye on next. No markdown. ' +
        (notes ? KB.RULE + ' Here add at most one short line in "class_note", e.g. "Sashi also covers project recovery in his training class: ...", only if a note is clearly about this situation; otherwise empty. ' : '') +
        'JSON only: {"headline":"","summary":"","actions":[{"title":"","detail":""}],"watch":[""],"class_note":""}';
      const r = await llmJson([{ role: 'system', content: sys }, { role: 'user', content: JSON.stringify({ project: name || plan.name, health: h.rag, reasons: h.reasons.map((x) => x.text), numbers: h.n, course_notes: notes }) }], { maxTokens: 1400, temperature: 0.3, timeoutMs: 90000 });
      const d = r && r.data;
      if (d && d.headline) {
        out = { headline: String(d.headline).slice(0, 300), summary: String(d.summary || '').slice(0, 900),
          actions: (Array.isArray(d.actions) ? d.actions : []).slice(0, 5).map((x) => ({ title: String((x && x.title) || '').slice(0, 120), detail: String((x && x.detail) || '').slice(0, 400) })).filter((x) => x.title),
          watch: (Array.isArray(d.watch) ? d.watch : []).slice(0, 3).map((x) => String(x).slice(0, 200)).filter(Boolean),
          note: notes && d.class_note && /Sashi/i.test(d.class_note) ? String(d.class_note).slice(0, 300) : '', sources: notes && d.class_note && /Sashi/i.test(d.class_note) ? KB.sourcesOf(hits) : [], ai: true };
        await usage(true, r.used || 0).catch(() => {});
      }
    } catch (e) { console.error('Champ watch: ' + e.message); }
  }
  if (!out) out = fallback(h);
  const at = Date.now();
  if (out.ai) await kv.set(key, { sig, brief: out, at, rag: h.rag }).catch(() => {});
  return { ...h, brief: out, at };
}

// ---------------- Build 2: the watch across every project ----------------
// sweep(): the health rules on every open project (cheap, any time), what changed since yesterday, alerts when one gets
// worse (in the console, and on Telegram when it is set up); with ai, Champ also refreshes the brief of red and amber
// projects whose numbers changed (at most AI_WATCH_MAX a run, 12 by default).
const ORDER = { red: 0, amber: 1, green: 2, grey: 3 };
const worse = (from, to) => from && to && ORDER[to] < ORDER[from] && to !== 'grey';
export async function sweep({ ai = false, lang = 'en', maxAi = Math.max(0, Number(process.env.AI_WATCH_MAX || 12) || 12) } = {}) {
  const { list, portfolio } = await import('./plan.mjs');
  const today = sydToday(), [plans, cards, old, prevKv] = await Promise.all([list(), portfolio(today).catch(() => []), kv.get('watch:board').catch(() => null), kv.get('watch:prev').catch(() => null)]);
  // yesterday's colours: when the day turns over, the last board of the old day becomes "yesterday"
  let prev = prevKv && prevKv.map ? prevKv : { day: '', map: {} };
  if (old && old.day && old.day !== today) { prev = { day: old.day, map: Object.fromEntries((old.items || []).map((x) => [x.core, x.rag])) }; await kv.set('watch:prev', prev).catch(() => {}); }
  const byCore = Object.fromEntries(cards.map((c) => [c.core, c])), oldBy = Object.fromEntries(((old && old.items) || []).map((x) => [x.core, x]));
  const items = [];
  for (const p of plans) {
    const c = byCore[p.core]; if (!c || c.phase === 'close') continue;   // closed or lost projects are not watched
    const h = check(p, today), kept = await kv.get('watch:' + p.core).catch(() => null);
    const fresh = kept && kept.sig === sigOf(h) + '|' + lang && kept.brief;
    const was = prev.map[p.core] || '', o = oldBy[p.core];
    items.push({ core: p.core, ref: c.ref, name: c.name || p.name, program: c.program || '', client: c.client || '', rag: h.rag, word: h.word,
      reasons: h.reasons.filter((x) => x.lvl !== 'green').slice(0, 3).map((x) => x.text), headline: fresh ? kept.brief.headline : '', ai: !!fresh,
      SPI: h.n.SPI, CPI: h.n.CPI, slip: h.n.slip_days, over: h.n.over_pct, pct: h.n.pct, was, since: o && o.rag === h.rag ? o.since || today : today, _h: h, _p: p, _fresh: !!fresh });
  }
  items.sort((a, b) => ORDER[a.rag] - ORDER[b.rag] || (a.SPI ?? 9) - (b.SPI ?? 9));
  // Champ's view of the projects that need it (red first), in this run's budget
  let briefs = 0;
  if (ai && llmSetup()) for (const x of items) {
    if (briefs >= maxAi) break; if (x._fresh || x.rag === 'green' || x.rag === 'grey') continue;
    const r = await brief(x.core, x._p, { refresh: true, ai: true, name: x.name, lang }).catch(() => null);
    if (r && r.brief && r.brief.ai) { x.headline = r.brief.headline; x.ai = true; briefs++; }
  }
  // alerts: a project that got worse since yesterday (or since the last look today), once per project, colour and day
  const sent = (await kv.get('watch:alerted').catch(() => null)) || {}, alerts = [];
  for (const x of items) {
    const from = x.was || (o2(oldBy[x.core]) || '');
    if (!worse(from, x.rag)) continue;
    const k = `${today}|${x.core}|${x.rag}`; if (sent[k]) continue; sent[k] = Date.now();
    alerts.push({ core: x.core, name: x.name, program: x.program, from, to: x.rag, at: Date.now(), why: x.reasons[0] || '' });
  }
  for (const k of Object.keys(sent)) if (!k.startsWith(today) && Date.now() - sent[k] > 7 * 864e5) delete sent[k];
  if (alerts.length) {
    await kv.set('watch:alerted', sent).catch(() => {});
    const log = ((await kv.get('watch:alerts').catch(() => null)) || { list: [] }).list || [];
    await kv.set('watch:alerts', { list: alerts.concat(log).slice(0, 60) }).catch(() => {});
    await telegram(alerts).catch(() => {});
  }
  const counts = { red: 0, amber: 0, green: 0, grey: 0 }; items.forEach((x) => counts[x.rag]++);
  const board = { day: today, at: Date.now(), counts, items: items.map(({ _h, _p, _fresh, ...x }) => x), briefs, prevDay: prev.day };
  await kv.set('watch:board', board).catch(() => {});
  return { ...board, alerts };
}
const o2 = (o) => (o ? o.rag : '');
async function telegram(alerts) {
  const chat = String(process.env.TELEGRAM_CHAT_ID || '').trim(); if (!chat || !String(process.env.TELEGRAM_BOT_TOKEN || '').trim()) return;
  const B = await import('./bot.mjs'), dot = { red: '🔴', amber: '🟠', green: '🟢' }, site = String(process.env.URL || '').replace(/\/+$/, '');
  const esc = (s) => String(s || '').replace(/[<&>]/g, (c) => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;' }[c]));
  const text = '🩺 <b>Champ\'s watch</b>\n' + alerts.slice(0, 10).map((a) => `${dot[a.from] || '⚪'} → ${dot[a.to]} <b>${esc(a.name)}</b>${a.program ? ' (' + esc(a.program) + ')' : ''}\n${esc(a.why)}${site ? `\n${site}/admin/#plan/${a.core}/overview` : ''}`).join('\n\n');
  await B.send(chat, text);
}
// the board for the console: the last sweep if it is recent, otherwise a fresh one (rules only: quick)
export async function board({ refresh = false, maxAgeMs = 10 * 60000, lang = 'en' } = {}) {
  const b = await kv.get('watch:board').catch(() => null);
  if (!refresh && b && b.day === sydToday() && Date.now() - b.at < maxAgeMs) return b;
  return sweep({ ai: false, lang });
}
export async function alertsList() { return ((await kv.get('watch:alerts').catch(() => null)) || { list: [] }).list || []; }
