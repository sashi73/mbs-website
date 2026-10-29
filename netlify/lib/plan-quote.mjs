// Project plan -> quote -> tax invoice, kept in step (the value chain).
// "📄 Quote & PM plan" on a plan makes a quote in Quotes with the customer's details and the plan's tasks as lines,
// plus a frozen copy of the plan (snapshot) so the quote PDF can carry a cover page and a 2-page high-level project plan.
import * as kv from './kv.mjs';
import * as J from './jobs.mjs';
import * as ACC from './accounts.mjs';
import * as CU from './customers.mjs';
import * as PLAN from './plan.mjs';
import { sydToday } from './ai.mjs';

const out = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const str = (s, n) => String(s ?? '').trim().slice(0, n);
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// a frozen, high-level copy of the plan for the PDF (no people's names other than the project manager)
export function snapshot(plan, today = sydToday()) {
  const p = JSON.parse(JSON.stringify(plan));
  const R = PLAN.rollup(p, today);
  const c = p.charter || {};
  return {
    name: str(p.name, 120), rev: p.rev || 0, at: Date.now(), today, start: R.start, finish: R.finish, days: R.start ? PLAN.workBetween(R.start, R.finish) : 0,
    BAC: R.BAC, pct: R.pct, done: R.done, total: R.total, late: R.late,
    charter: { objective: str(c.objective, 600), inScope: str(c.inScope, 1500), outScope: str(c.outScope, 700), deliverables: str(c.deliverables, 700), acceptance: str(c.acceptance, 600), assumptions: str(c.assumptions, 700), manager: str(c.manager, 80) },
    tasks: p.tasks.slice(0, 40).map((t) => ({ n: str(t.name, 90), es: t.es, ef: t.ef, dur: t.dur, mile: t.dur === 0, pct: t.pct || 0, status: t.status || 'todo', subs: (t.subs || []).length })),
    risks: (p.risks || []).filter((r) => r.status !== 'Closed').sort((a, b) => b.p * b.i - a.p * a.i).slice(0, 6).map((r) => ({ t: str(r.title, 120), p: r.p, i: r.i, resp: r.response, act: str(r.action, 160) }))
  };
}
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
    return out(200, { quotes, invoices: links.invoices, stage: job.stage, BAC: PLAN.rollup(JSON.parse(JSON.stringify(plan)), sydToday()).BAC,
      customer: { name: job.name || (cust && cust.name) || '', phone: job.phone || (cust && cust.phone) || '', email: job.email || (cust && cust.email) || '', address: address(job, cust), id: cust ? cust.id : '' } });
  }
  // planQuote: make a new quote, or refresh a draft quote that came from this plan
  const mode = body.mode === 'lump' ? 'lump' : 'tasks', margin = Math.max(0, Math.min(200, Number(body.margin) || 0));
  const items = linesFromPlan(plan, { mode, margin });
  if (!items.length) return out(400, { error: 'No task in the plan has a cost yet. Fill in Qty and Unit $ on the Schedule (or the $ Costs view) first.' });
  const c = body.customer || {};
  const customer = { name: str(c.name, 120) || job.name, phone: str(c.phone, 40) || job.phone, email: str(c.email, 160) || job.email, address: str(c.address, 300) || address(job, cust) };
  if (cust && customer.address && customer.address !== cust.address) await CU.edit(cust.id, { address: customer.address }).catch(() => null);
  const snap = snapshot(plan);
  const days = Math.max(1, Math.min(120, Number(body.validDays) || ACC.QUOTE_VALID_DAYS));
  const notes = [snap.start ? `Planned start ${ACC.prettyDate(snap.start)}, finish ${ACC.prettyDate(snap.finish)} (about ${snap.days} working day${snap.days === 1 ? '' : 's'}), subject to acceptance, access and weather.` : '',
    'The attached high-level project management plan sets out the scope, schedule, milestones and key risks. Any change to the scope will be agreed in writing (variation) before the work is done.', str(body.notes, 800)].filter(Boolean).join('\n');
  const fields = { core: job.core, customer, items, pricesInc: false, title: str(body.title, 160) || snap.name, notes, validUntil: ACC.addDays(ACC.today(), days) };
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
