// Project plan -> quote -> tax invoice, kept in step (the value chain).
// "📄 Quote & PM plan" on a plan makes a quote in Quotes with the customer's details and the plan's tasks as lines,
// plus a frozen copy of the plan (snapshot) so the quote PDF can carry a cover page and a 2-page high-level project plan.
import * as kv from './kv.mjs';
import * as J from './jobs.mjs';
import * as ACC from './accounts.mjs';
import * as CU from './customers.mjs';
import * as PLAN from './plan.mjs';
import { sydToday } from './ai.mjs';
import { parseWhen, whenText } from './calendar.mjs';

const out = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const str = (s, n) => String(s ?? '').trim().slice(0, n);
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// a frozen, high-level copy of the plan for the PDF (no people's names other than the project manager)
export function snapshot(plan, today = sydToday()) {
  const p = JSON.parse(JSON.stringify(plan));
  const R = PLAN.rollup(p, today);
  const c = p.charter || {};
  return {
    name: str(p.name, 120), rev: p.rev || 0, at: Date.now(), today, start: R.start, finish: R.finish, days: R.start ? PLAN.workBetween(R.start, R.finish, PLAN.allDays(p)) : 0,
    BAC: R.BAC, pct: R.pct, done: R.done, total: R.total, late: R.late, emergency: !!p.emergency, coolOff: PLAN.coolOf(p),
    charter: { objective: str(c.objective, 600), inScope: str(c.inScope, 1500), outScope: str(c.outScope, 700), deliverables: str(c.deliverables, 700), acceptance: str(c.acceptance, 600), assumptions: str(c.assumptions, 700), manager: str(c.manager, 80) },
    ...workSpan(p),
    tasks: p.tasks.slice(0, 40).map((t) => ({ n: str(t.name, 90), es: t.es, ef: t.ef, dur: t.dur, mile: t.dur === 0, pct: t.pct || 0, status: t.status || 'todo', subs: (t.subs || []).length })),
    risks: (p.risks || []).filter((r) => r.status !== 'Closed').sort((a, b) => b.p * b.i - a.p * a.i).slice(0, 6).map((r) => ({ t: str(r.title, 120), p: r.p, i: r.i, resp: r.response, act: str(r.action, 160) }))
  };
}
// why the work can't start earlier (for messages)
export function gateWords(plan) {
  const g = plan.gate, c = PLAN.coolOf(plan);
  if (plan.emergency || !g) return '';
  return `Work can only start once the quote is accepted, plus a cooling-off period of ${c} business day${c === 1 ? '' : 's'}: ${g.id} ${g.accepted ? 'was accepted on ' + ACC.prettyDate(g.date) : 'is not accepted yet (the plan assumes acceptance on the quote date, ' + ACC.prettyDate(g.date) + ')'}.`;
}
// when the work itself runs (the tasks that wait for the quote), as opposed to the whole project (site inspection first)
function workSpan(p) {
  const g = [...PLAN.gatedTasks(p)].filter((t) => t.es);
  if (!g.length) return { workStart: '', workFinish: '' };
  return { workStart: g.reduce((m, t) => (!m || t.es < m ? t.es : m), ''), workFinish: g.reduce((m, t) => (t.ef > m ? t.ef : m), '') };
}
const datesLine = (snap) => (snap.workStart || snap.start) ? `Work planned to start ${ACC.prettyDate(snap.workStart || snap.start)} and finish ${ACC.prettyDate(snap.workFinish || snap.finish)} (about ${PLAN.workBetween(snap.workStart || snap.start, snap.workFinish || snap.finish, !!snap.emergency)} ${snap.emergency ? 'days, weekends included' : 'working days'}), subject to acceptance, access and weather.` : '';
// what the price depends on: if this changes after a quote was made, the quote is out of date
export function fingerprint(plan) {
  return JSON.stringify([(plan.tasks || []).map((t) => [t.name, r2(t.qty), t.unit || '', r2(t.rate), t.dur]), str((plan.charter || {}).inScope, 1500)]);
}
// quote lines from the plan: one per task that has a cost (sub-step names listed), or one total line
export function linesFromPlan(plan, { mode = 'tasks', margin = 0 } = {}) {
  const k = 1 + Math.max(0, Math.min(200, Number(margin) || 0)) / 100;
  const costed = plan.tasks.filter((t) => r2(t.qty) * r2(t.rate) > 0);
  if (mode === 'lump') {
    const total = r2(costed.reduce((a, t) => a + r2(t.qty) * r2(t.rate), 0) * k);
    const what = costed.map((t) => t.name).slice(0, 12).join('; ');
    return total > 0 ? [{ desc: `${plan.name}: supply and install as per the project plan (${what})`.slice(0, 400), qty: 1, price: total, gst: true }] : [];
  }
  return costed.map((t) => {
    const subs = (t.subs || []).map((s) => s.name).filter(Boolean);
    const unit = t.unit && !/^lot$/i.test(t.unit) ? ` (${r2(t.qty)} ${t.unit})` : '';
    return { desc: (t.name + unit + (subs.length ? ': ' + subs.join(', ') : '')).slice(0, 400), qty: r2(t.qty), price: r2(r2(t.rate) * k), gst: true };
  });
}
function address(job, cust) { return (cust && cust.address) || job.address || job.suburb || ''; }
async function linked(core) {
  const x = await ACC.index();
  const pick = (o) => Object.values(o).filter((d) => d.core === core).sort((a, b) => (a.id > b.id ? 1 : -1));
  return { quotes: pick(x.quotes), invoices: pick(x.invoices) };
}
// the PDF pack: quotes use their frozen copy; invoices show the plan as it is now (progress), or the copy if the plan is gone
export async function packPlan(doc) {
  if (!doc || !doc.plan) return null;
  if (doc.type === 'invoice' && doc.core) { const p = await PLAN.get(doc.core).catch(() => null); if (p && p.tasks && p.tasks.length) return snapshot(p); }
  return doc.plan.snapshot || null;
}

export async function planQuotePost(action, body, { who, by, audit }) {
  if (action === 'boardMove') return boardMove(body, { who, by, audit });
  if (action === 'quoteStart') return quoteStart(body, { who, by, audit });
  if (action !== 'planQuoteInfo' && action !== 'planQuote') return null;
  const job = await J.find(str(body.core, 40));
  if (!job) return out(404, { error: 'Job not found' });
  const [plan, links, cd] = await Promise.all([PLAN.get(job.core), linked(job.core), CU.get().catch(() => null)]);
  if (!plan) return out(404, { error: 'Make the project plan first' });
  const cust = cd ? CU.forJob(cd, job.core) : null;
  const fp = fingerprint(plan);
  if (action === 'planQuoteInfo') {
    const full = await Promise.all(links.quotes.map((q) => ACC.get(q.id)));
    const quotes = links.quotes.map((q, i) => ({ ...q, fromPlan: !!(full[i] && full[i].plan), changed: !!(full[i] && full[i].plan && full[i].plan.fp !== fp), margin: full[i] && full[i].plan ? full[i].plan.margin : 0, mode: full[i] && full[i].plan ? full[i].plan.mode : '' }));
    const cur = await PLAN.get(job.core);
    return out(200, { quotes, invoices: links.invoices, stage: job.stage, gate: (cur && cur.gate) || null, BAC: PLAN.rollup(JSON.parse(JSON.stringify(plan)), sydToday()).BAC,
      customer: { name: job.name || (cust && cust.name) || '', phone: job.phone || (cust && cust.phone) || '', email: job.email || (cust && cust.email) || '', address: address(job, cust), id: cust ? cust.id : '' } });
  }
  // planQuote: make a new quote, or refresh a draft quote that came from this plan
  const mode = body.mode === 'lump' ? 'lump' : 'tasks', margin = Math.max(0, Math.min(200, Number(body.margin) || 0));
  const items = linesFromPlan(plan, { mode, margin });
  if (!items.length) return out(400, { error: 'No task in the plan has a cost yet. Fill in Qty and Unit $ on the Schedule (or the $ Costs view) first.' });
  const c = body.customer || {};
  const customer = { name: str(c.name, 120) || job.name, phone: str(c.phone, 40) || job.phone, email: str(c.email, 160) || job.email, address: str(c.address, 300) || address(job, cust) };
  if (cust && customer.address && customer.address !== cust.address) await CU.edit(cust.id, { address: customer.address }).catch(() => null);
  const days = Math.max(1, Math.min(120, Number(body.validDays) || ACC.QUOTE_VALID_DAYS)), validUntil = ACC.addDays(ACC.today(), days);
  // the work can only start once this quote is accepted: until then it is scheduled from the date the quote is valid until
  const accepted = ACC.gateFrom((await ACC.index()).quotes, job.core);
  const snap = snapshot({ ...plan, gate: accepted && accepted.accepted ? accepted : { date: ACC.today(), id: body.update || 'new', accepted: false } });
  const notes = [datesLine(snap),
    plan.emergency ? 'Emergency work: we can start straight away, usually the same day as the site inspection, and keep working on Saturday and Sunday where needed.'
      : accepted && accepted.accepted ? '' : `Work starts once this quote is accepted, after a cooling-off period of ${PLAN.coolOf(plan)} business day${PLAN.coolOf(plan) === 1 ? '' : 's'}. The dates assume you accept today; they move by the same number of days if you accept later.`,
    'The attached high-level project management plan sets out the scope, schedule, milestones and key risks. Any change to the scope will be agreed in writing (variation) before the work is done.', str(body.notes, 800)].filter(Boolean).join('\n');
  const fields = { core: job.core, customer, items, pricesInc: false, title: str(body.title, 160) || snap.name, notes, validUntil };
  const planInfo = { core: job.core, rev: plan.rev || 0, fp, mode, margin, at: Date.now(), snapshot: snap, customerId: cust ? cust.id : '' };
  let doc;
  if (body.update) {
    const q = await ACC.get(str(body.update, 20));
    if (!q || q.type !== 'quote' || q.core !== job.core) return out(404, { error: 'Quote not found' });
    if (q.status !== 'draft' || q.invoiceId) return out(400, { error: `${q.id} has already been ${q.invoiceId ? 'invoiced' : q.status}, so it can't be changed. Make a new quote (a revision) instead.` });
    const r = await ACC.updateDoc(q.id, fields, by);
    if (r.error) return out(400, { error: r.error });
    doc = await ACC.setPlan(q.id, planInfo, by, 'Updated from the project plan');
    if (audit) await audit(who, `${q.id} updated from the project plan of ${job.core}`);
  } else {
    const prev = links.quotes.filter((q) => q.status !== 'void' && q.status !== 'declined');
    const d = await ACC.createDoc('quote', fields, by);
    doc = await ACC.setPlan(d.id, { ...planInfo, revises: prev.length ? prev[prev.length - 1].id : '' }, by, `Made from the project plan${prev.length ? ' (revision of ' + prev[prev.length - 1].id + ')' : ''}`);
    if (audit) await audit(who, `${d.id} made from the project plan of ${job.core}`);
  }
  return out(200, { doc: { id: doc.id, status: doc.status, totals: doc.totals, issued: doc.issued, validUntil: doc.validUntil } });
}

// ---------- pipeline board: drag a job card to another column ----------
// Moving a card changes the job's stage AND the paperwork / plan that go with it, so every page stays in step:
// quoted (amount), site visit (reminder), won (quote accepted), in progress (plan started), completed (plan tasks done),
// invoiced (tax invoice made from the quote), paid (payment recorded) or lost (reason).
const STARTED = (p) => !!(p && p.tasks && p.tasks.some((t) => (t.pct || 0) > 0 || ['doing', 'review', 'done'].includes(t.status)));
const setTask = (t, st) => { const pct = { todo: 0, doing: 33, review: 67, done: 100 }[st]; t.status = st; t.pct = pct; (t.subs || []).forEach((x) => { x.status = st; }); };
async function savePlan(core, fn, by) {
  for (let i = 0; i < 3; i++) {
    const cur = await PLAN.get(core); if (!cur) return null;
    fn(cur);
    const r = await PLAN.save(core, cur, cur.rev, by);
    if (r.plan) return r.plan;
  }
  return null;
}
export async function boardMove(body, { who, by, audit }) {
  const job = await J.find(str(body.core, 40));
  if (!job) return out(404, { error: 'Job not found' });
  const to = str(body.to, 20), o = body.opts || {}, today = sydToday();
  const [plan, links] = await Promise.all([PLAN.get(job.core), linked(job.core)]);
  const live = (l) => l.filter((d) => !['void', 'declined'].includes(d.status));
  const q = live(links.quotes).pop() || null, inv = live(links.invoices).pop() || null;
  const did = [];
  const stage = async (s, extra = {}) => { if (job.stage === s && !extra.amount) return; const r = await J.setStage(job.core, s, by, extra); if (r.error) throw new Error(r.error); job.stage = s; did.push(J.LABEL[s] + (extra.amount ? ' ' + ACC.money(extra.amount) : '')); };
  const accept = async () => { if (q && ['draft', 'sent'].includes(q.status) && o.acceptQuote !== false) { await ACC.setStatus(q.id, 'accepted', by, 'moved to Job won on the pipeline board'); did.push(`quote ${q.id} accepted`); } };
  const noBack = () => out(400, { error: 'This job has a project plan, so it stays in "Site visit, planned & quoted" or a later column. Delete the plan first if the job really is back at the start.' });
  const BAC = plan ? PLAN.rollup(JSON.parse(JSON.stringify(plan)), today).BAC : 0;
  try {
    if (to === 'new') { if (plan) return noBack(); await stage('new'); }
    else if (to === 'called') { if (plan) return noBack(); await stage('called'); }
    else if (to === 'visit') {
      if (o.mode === 'visit') {
        const at = parseWhen(o.when);
        if (!at || at < Date.now() - 60000) return out(400, { error: 'When is the site visit? e.g. "tomorrow 10am" or "mon 9am"' });
        const r = await J.addReminder({ at, text: 'Site visit: ' + (str(o.note, 200) || job.service || job.name || 'measure and quote'), core: job.core, chat: 'alerts', by });
        did.push('site visit booked for ' + whenText(r.at));
        if (job.stage === 'new') await stage('called');
        else if (!['new', 'called'].includes(job.stage)) await stage('called');
      } else {   // quoted
        const amount = r2(o.amount) || (q ? q.inc : 0) || r2(BAC * 1.1);
        if (!(amount > 0)) return out(400, { error: 'Enter the quote amount (inc GST)' });
        await stage('quoted', { amount });
      }
    } else if (to === 'won') {
      if (STARTED(plan)) {
        if (!o.resetPlan) return out(409, { error: 'The project plan has started, so the job shows as "in progress". Moving it back to Job won puts every plan task back to To do.', need: 'resetPlan' });
        await savePlan(job.core, (p) => p.tasks.forEach((t) => setTask(t, 'todo')), by); did.push('plan tasks back to To do');
      }
      await accept(); await stage('won');
    } else if (to === 'progress') {
      if (!plan || !plan.tasks || !plan.tasks.length) return out(409, { error: 'Make a project plan first: the work is tracked in the plan.', need: 'plan' });
      await accept(); if (!['won'].includes(job.stage)) await stage('won');
      await savePlan(job.core, (p) => {
        if (o.startToday && p.start > today) { p.start = today; did.push('plan starts today'); }
        if (!STARTED(p)) {
          PLAN.schedule(p);
          const first = p.tasks.filter((t) => (t.pct || 0) < 100).sort((a, b) => (a.es > b.es ? 1 : a.es < b.es ? -1 : 0))[0];
          if (first) { if (first.dur === 0) { setTask(first, 'done'); const next = p.tasks.filter((t) => t !== first && (t.pct || 0) < 100).sort((a, b) => (a.es > b.es ? 1 : -1))[0]; if (next) setTask(next, 'doing'); did.push(`"${first.name}" done${next ? `, "${next.name}" in progress` : ''}`); } else { setTask(first, 'doing'); did.push(`"${first.name}" in progress`); } }
        }
      }, by);
    } else if (to === 'completed') {
      await accept();
      if (plan && o.finishPlan !== false) { await savePlan(job.core, (p) => p.tasks.forEach((t) => setTask(t, 'done')), by); did.push('all plan tasks Done'); }
      await stage('completed');
    } else if (to === 'invoiced') {
      let amount = inv ? inv.inc : 0, invId = inv ? inv.id : '';
      if (!inv && q && o.makeInvoice !== false) {
        const r = await ACC.quoteToInvoice(q.id, by);
        if (r.error) return out(400, { error: r.error });
        amount = r.doc.totals.inc; invId = r.doc.id; did.push(`tax invoice ${invId} made from ${q.id} (draft: check and send it)`);
      }
      amount = amount || r2(o.amount);
      if (!(amount > 0)) return out(400, { error: 'Enter the invoice amount (inc GST)' });
      if (plan && o.finishPlan !== false && !['completed'].includes(job.stage)) { await savePlan(job.core, (p) => p.tasks.forEach((t) => setTask(t, 'done')), by); did.push('all plan tasks Done'); }
      await stage('invoiced', { amount });
      if (invId) did.invoice = invId;
    } else if (to === 'closed') {
      if (o.outcome === 'lost') {
        await stage('lost', { reason: str(o.reason, 200) });
        if (q && ['draft', 'sent'].includes(q.status)) { await ACC.setStatus(q.id, 'declined', by, 'job lost'); did.push(`quote ${q.id} declined`); }
      } else {
        if (inv && o.recordPayment) {
          const bal = r2(inv.inc - (inv.paid || 0));
          if (bal > 0) { if (inv.status === 'draft') await ACC.setStatus(inv.id, 'sent', by, 'marked sent when paid'); const r = await ACC.addPayment(inv.id, { amount: bal, method: o.method || 'Bank transfer', ref: 'pipeline board' }, by); if (r.error) return out(400, { error: r.error }); did.push(`payment ${ACC.money(bal)} recorded on ${inv.id}`); }
        }
        await stage('paid');
      }
    } else return out(400, { error: 'Unknown column' });
  } catch (e) { return out(400, { error: e.message }); }
  if (audit) await audit(who, `Pipeline board: ${J.refFor(job)} → ${to}${did.length ? ' (' + did.join('; ') + ')' : ''}`);
  return out(200, { ok: true, did: [...did], invoice: did.invoice || '', stage: job.stage });
}

// ---------- "Work starts" changed on a quote (or on its plan): the plan's schedule, Gantt chart and the quote's plan pages follow ----------
export async function quoteStart(body, { who, by, audit }) {
  const d = await ACC.get(str(body.id, 20));
  if (!d || d.type !== 'quote' || !d.plan || !d.core) return out(404, { error: 'This quote was not made from a project plan' });
  if (d.invoiceId || d.status === 'void') return out(400, { error: `${d.id} is ${d.invoiceId ? 'invoiced' : 'void'}, so its dates can't change. Change the dates on the project plan instead.` });
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date || '')) ? String(body.date) : '';
  const plan = await PLAN.get(d.core);
  if (!plan) return out(404, { error: 'The project plan for this job has been deleted' });
  if (date) {
    if (PLAN.nextWork(date, PLAN.allDays(plan)) < PLAN.nextWork(plan.start, PLAN.allDays(plan))) return out(400, { error: `The work can't start before the project start (${ACC.prettyDate(PLAN.nextWork(plan.start, PLAN.allDays(plan)))})` });
    const g = PLAN.gateOf({ ...plan, workStart: '' }).date;   // the quote and cooling-off (not the old "Work starts")
    if (g && PLAN.nextWork(date, PLAN.allDays(plan)) < g) return out(400, { error: `${gateWords(plan)} Pick ${ACC.prettyDate(g)} or later${plan.gate && !plan.gate.accepted ? ', or tick Emergency on the project plan' : ''}.` });
  }
  const saved = await savePlan(d.core, (p) => { p.workStart = date; }, by);
  if (!saved) return out(409, { error: 'The plan is being changed by someone else. Try again.' });
  const snap = snapshot(saved);
  const lines = String(d.notes || '').split('\n'), i = lines.findIndex((l) => /^(Work planned to start|Planned start)/.test(l));
  if (i >= 0) lines[i] = datesLine(snap); else lines.unshift(datesLine(snap));
  if (!['paid'].includes(d.status)) { const r = await ACC.updateDoc(d.id, { notes: lines.filter((l) => l !== '').join('\n') }, by); if (r.error) return out(400, { error: r.error }); }
  await ACC.setPlan(d.id, { ...d.plan, snapshot: snap, at: Date.now() }, by, date ? `Work start changed to ${ACC.prettyDate(snap.workStart)} (finish ${ACC.prettyDate(snap.workFinish)})` : 'Work start date cleared');
  if (audit) await audit(who, `${d.id}: work starts ${date || '(cleared)'}`);
  return out(200, { workStart: snap.workStart, finish: snap.workFinish || snap.finish, start: snap.start, days: snap.days });
}
