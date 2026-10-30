// SQL wizard support: read-only tables for the browser (queries run in the browser, nothing can be changed),
// an AI-written narrative (DeepSeek) and a PDF report.
import { env, stripThinking } from './shared.mjs';
import * as kv from './kv.mjs';
import * as J from './jobs.mjs';
import * as ACC from './accounts.mjs';
import { parts } from './calendar.mjs';
import LOGO from './logo-png.mjs';
import { business, pdfLib } from './pdf.mjs';
import * as PLAN from './plan.mjs';
import * as INV from './inventory.mjs';
import * as SUB from './subbies.mjs';
import { regionOf } from './sydney-regions.mjs';
import * as CU from './customers.mjs';
import { statsFor } from './admin-cust.mjs';
import { llmSetup, llmJson, usage, usageToday, tokCap, checkLimit, ping } from './ai.mjs';
export { usageToday };

const H = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const out = (status, body) => new Response(JSON.stringify(body), { status, headers: H });
const bad = (msg, status = 400) => out(status, { error: msg });
const d10 = (ms) => { if (!ms) return ''; const p = parts(ms); return `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; };
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// ---------- v51: keys ----------
// Every table starts with its own key (primary key: one value per row), named after the table: customer_id, job_id,
// quote_id, invoice_id, stock_id, supplier_id, subcontractor_id ... A column pointing at another table (foreign key) has
// that table's key name, so joins and unions line up: inventory.supplier_id = suppliers.supplier_id, stock_moves.stock_id
// = inventory.stock_id, plan_tasks.job_id = jobs.job_id. The older columns (id, core, item_id, job, sub_id) stay for saved reports.
const cnt = () => { const m = {}; return (k) => (m[k] = (m[k] || 0) + 1); };
export const KEYS = {
  customers: { pk: 'customer_id', cols: { customer_id: (r) => r.id } },
  jobs: { pk: 'job_id', cols: { job_id: (r) => r.core, customer_id: (r) => r.customer }, fk: { customer_id: 'customers' } },
  quotes: { pk: 'quote_id', cols: { quote_id: (r) => r.id, job_id: (r) => r.job, customer_id: (r, x) => x.custOfJob[r.job] || '' }, fk: { job_id: 'jobs', customer_id: 'customers', invoice_id: 'invoices' } },
  invoices: { pk: 'invoice_id', cols: { invoice_id: (r) => r.id, job_id: (r) => r.job, customer_id: (r, x) => x.custOfJob[r.job] || '', quote_id: (r) => r.from_quote || '' }, fk: { job_id: 'jobs', customer_id: 'customers', quote_id: 'quotes' } },
  items: { pk: 'line_id', cols: { line_id: (r) => r.doc_id + '/' + r.line, quote_id: (r) => (/^q/i.test(r.doc_type) ? r.doc_id : ''), invoice_id: (r) => (/^i/i.test(r.doc_type) ? r.doc_id : '') }, fk: { quote_id: 'quotes', invoice_id: 'invoices' } },
  payments: { pk: 'payment_id', cols: { payment_id: (r, x) => r.invoice_id + '/' + x.n(r.invoice_id) }, fk: { invoice_id: 'invoices' } },
  expenses: { pk: 'expense_id', cols: { expense_id: (r) => r.id, job_id: (r) => r.job }, fk: { job_id: 'jobs' } },
  reminders: { pk: 'reminder_id', cols: { reminder_id: (r) => r.id, job_id: (r) => r.job }, fk: { job_id: 'jobs' } },
  visits: { pk: 'date', cols: {} },
  plan_tasks: { pk: 'task_id', cols: { task_id: (r) => r._id, job_id: (r) => r.job }, fk: { job_id: 'jobs' } },
  plan_subtasks: { pk: 'subtask_id', cols: { subtask_id: (r) => r._id, task_id: (r) => r._parent, job_id: (r) => r.job }, fk: { task_id: 'plan_tasks', job_id: 'jobs' } },
  plan_risks: { pk: 'risk_id', cols: { risk_id: (r) => r._id, job_id: (r) => r.job }, fk: { job_id: 'jobs' } },
  plan_issues: { pk: 'issue_id', cols: { issue_id: (r) => r._id, job_id: (r) => r.job }, fk: { job_id: 'jobs' } },
  plan_contracts: { pk: 'contract_id', cols: { contract_id: (r) => r._id, job_id: (r) => r.job, subcontractor_id: (r) => r.sub_id, supplier_id: (r) => r.sup_id }, fk: { job_id: 'jobs', subcontractor_id: 'subcontractors', supplier_id: 'suppliers' } },
  plan_stakeholders: { pk: 'stakeholder_id', cols: { stakeholder_id: (r) => r._id, job_id: (r) => r.job, subcontractor_id: (r) => r.sub_id }, fk: { job_id: 'jobs', subcontractor_id: 'subcontractors' } },
  inventory: { pk: 'stock_id', cols: { stock_id: (r) => r.id }, fk: { supplier_id: 'suppliers' } },
  suppliers: { pk: 'supplier_id', cols: { supplier_id: (r) => r.id } },
  supplier_prices: { pk: 'price_id', cols: { price_id: (r, x) => r.item_id + '/' + r.supplier_id + '/' + x.n(r.item_id + '/' + r.supplier_id), stock_id: (r) => r.item_id }, fk: { stock_id: 'inventory', supplier_id: 'suppliers' } },
  stock_moves: { pk: 'move_id', cols: { move_id: (r, x) => r.item_id + '/' + x.n(r.item_id), stock_id: (r) => r.item_id, job_id: (r) => r.job }, fk: { stock_id: 'inventory', job_id: 'jobs' } },
  subcontractors: { pk: 'subcontractor_id', cols: { subcontractor_id: (r) => r.id } },
  sub_trades: { pk: 'trade', cols: {} }
};
function withKeys(all, ctx) {
  for (const [t, K] of Object.entries(KEYS)) {
    const x = { ...ctx, n: cnt() };
    all[t] = (all[t] || []).map((r) => {
      const k = {}; for (const [c, f] of Object.entries(K.cols)) k[c] = f(r, x) ?? '';
      const o = { ...k, ...r }; delete o._id; delete o._parent; return o;
    });
  }
  return all;
}

// ---------- the tables (one row per record, plain columns) ----------
export const SCHEMA = {
  customers: ['id', 'name', 'phone', 'email', 'suburb', 'enquiries', 'confirmed_jobs', 'lost_jobs', 'open_quotes', 'open_jobs', 'quoted_value', 'total_value', 'paid_total', 'owed',
    'first_contact', 'first_month', 'last_contact', 'days_since_contact', 'repeat_customer', 'main_source', 'last_stage', 'tags'],
  jobs: ['ref', 'core', 'customer', 'stage', 'name', 'phone', 'email', 'suburb', 'service', 'trade', 'source', 'best_time', 'created', 'created_month', 'quote_inc', 'invoice_inc',
    'called_date', 'quoted_date', 'won_date', 'completed_date', 'invoiced_date', 'paid_date', 'lost_date', 'lost_reason', 'photos', 'notes'],
  quotes: ['id', 'job', 'customer', 'status', 'issued', 'issued_month', 'valid_until', 'ex', 'gst', 'inc', 'invoice_id'],
  invoices: ['id', 'job', 'customer', 'status', 'issued', 'issued_month', 'due', 'ex', 'gst', 'inc', 'paid', 'balance', 'days_overdue', 'from_quote'],
  items: ['doc_id', 'doc_type', 'line', 'description', 'qty', 'price', 'gst_free', 'ex', 'gst', 'inc'],
  payments: ['invoice_id', 'customer', 'date', 'month', 'amount', 'gst', 'method', 'reference'],
  expenses: ['id', 'date', 'month', 'supplier', 'description', 'category', 'job', 'ex', 'gst', 'inc', 'has_receipt'],
  reminders: ['id', 'due', 'date', 'text', 'job'],
  visits: ['date', 'month', 'visits'],
  plan_tasks: ['job', 'plan_name', 'task', 'resource', 'lead', 'status', 'start', 'finish', 'days', 'qty', 'unit', 'unit_cost', 'planned_cost', 'actual_cost', 'pct_complete', 'done', 'late'],
  plan_subtasks: ['job', 'plan_name', 'task', 'subtask', 'owner', 'start', 'finish', 'days', 'status', 'done', 'late'],
  plan_risks: ['job', 'plan_name', 'risk', 'probability', 'impact', 'score', 'response', 'owner', 'status', 'review'],
  plan_issues: ['job', 'plan_name', 'issue', 'priority', 'owner', 'raised', 'due', 'status'],
  plan_stakeholders: ['job', 'plan_name', 'person', 'role', 'raci', 'raci_meaning', 'sub_id', 'phone', 'email'],
  plan_contracts: ['job', 'plan_name', 'type', 'direction', 'party', 'party_kind', 'title', 'contract_no', 'form', 'status', 'value', 'gst_included', 'approved_variations', 'pending_variations', 'adjusted_value',
    'claimed', 'paid', 'owing', 'left_to_claim', 'overdue_claims', 'retention_pct', 'payment_terms', 'signed', 'start', 'completion', 'defects_months', 'ld_per_day', 'documents'],
  inventory: ['id', 'item', 'sku', 'category', 'unit', 'location', 'on_hand', 'allocated', 'available', 'on_order', 'reorder_level', 'reorder_qty', 'low', 'unit_price', 'price_supplier', 'stock_value',
    'supplier_id', 'supplier_contact', 'supplier_phone', 'supplier_email', 'supplier_terms', 'reorder_needed'],
  suppliers: ['id', 'supplier', 'contact', 'phone', 'email', 'categories', 'terms', 'items_quoted'],
  supplier_prices: ['item_id', 'item', 'supplier_id', 'supplier', 'price_ex', 'pack_size', 'quote_ref', 'quoted', 'valid_until', 'expired', 'preferred'],
  stock_moves: ['item_id', 'item', 'date', 'month', 'kind', 'qty', 'reason', 'job'],
  subcontractors: ['id', 'business', 'contact', 'trade', 'other_trades', 'phone', 'email', 'suburb', 'postcode', 'region', 'western_sydney', 'areas_covered', 'status', 'preference_rank', 'rating',
    'hourly_rate', 'callout_fee', 'after_hours_rate', 'payment_terms', 'availability', 'licence_no', 'licence_class', 'licence_expiry', 'licence_state', 'insurer', 'pl_policy', 'pl_cover', 'pl_expiry', 'pl_state',
    'wc_policy', 'wc_expiry', 'wc_state', 'sole_trader', 'white_card', 'swms', 'compliance', 'problems', 'any_expired', 'last_used', 'days_since_used', 'archived'],
  sub_trades: ['trade', 'licence_needed', 'subbies', 'preferred', 'approved', 'all_papers_ok', 'with_expired', 'avg_rating', 'avg_hourly_rate', 'cheapest_hourly_rate']
};
for (const [tb, K] of Object.entries(KEYS)) {   // key columns first: own key, then keys of other tables
  const ks = [K.pk, ...Object.keys(K.cols).filter((c) => c !== K.pk), ...Object.keys(K.fk || {}).filter((c) => c !== K.pk && !(c in K.cols))];
  SCHEMA[tb] = [...new Set([...ks, ...SCHEMA[tb]])];
}
export const DESCRIBE = {
  customers: 'One row per customer (same phone + email = same customer) with their job counts and values', jobs: 'Every enquiry and job (pipeline stage, customer, suburb, trade, values)', quotes: 'Quotes (status, totals ex/inc GST)', invoices: 'Tax invoices (paid, balance, days overdue)',
  items: 'Line items of quotes and invoices', plan_tasks: 'Project plan tasks (dates, costs, % complete)', plan_risks: 'Risk registers of all plans', plan_issues: 'Issue logs of all plans', plan_subtasks: 'Sub-tasks inside plan tasks (no costs; costs stay on the task)', plan_stakeholders: 'Stakeholders (RACI) on each project plan, including the subbies working on it', plan_contracts: 'Contracts on each project: head contract with the customer, sub-contracts, supply; value, variations, claims, paid, owing', sub_trades: 'Every trade category (also ones with no subbies yet) with how many subbies, preferred, compliant, average rating and rates', subcontractors: 'Sub-contractors (subbies): trade, where they are, status, rating, rates, licence and insurance with expiry and whether expired', inventory: 'Stock items (on hand, set aside for jobs, re-order level)', suppliers: 'Suppliers', supplier_prices: 'Supplier quotes per stock item', stock_moves: 'Stock in and out', payments: 'Payments received', expenses: 'Expenses and receipts', reminders: 'Call-backs and follow-ups', visits: 'Website visitors per day'
};

export async function tables() {
  const now = Date.now();
  const jobs = [];
  const [jobRecs, data, remList, visitRec, planList, stock, alloc] = await Promise.all([
    kv.keys('job:').then((ks) => kv.getMany(ks)), ACC.allDocs(), J.reminders(),
    import('@netlify/blobs').then(({ getStore }) => getStore({ name: 'mbs-visits', consistency: 'strong' }).get('count', { type: 'json' })).catch(() => null),
    PLAN.list(), INV.full().catch(() => ({ items: [], suppliers: [] })), INV.allocations().catch(() => ({}))]);
  const subRecs = await kv.keys('sub:').then((ks) => kv.getMany(ks)).catch(() => []);
  for (const j of jobRecs) {
    if (!j) continue;
    jobs.push({ ref: J.refFor(j), core: j.core, customer: '', stage: j.stage, name: j.name || '', phone: j.phone || '', email: j.email || '', suburb: j.suburb || '', service: j.service || '',
      trade: j.trade || (j.core || '')[0] || '', source: j.source || '', best_time: j.best_time || '', created: d10(j.created), created_month: d10(j.created).slice(0, 7),
      quote_inc: j.quote ? r2(j.quote.amount) : null, invoice_inc: j.invoice ? r2(j.invoice.amount) : null,
      called_date: d10(j.called_at), quoted_date: d10(j.quoted_at), won_date: d10(j.won_at), completed_date: d10(j.completed_at), invoiced_date: d10(j.invoiced_at),
      paid_date: d10(j.paid_at), lost_date: d10(j.lost_at), lost_reason: j.lost_reason || '', photos: (j.photos || []).length, notes: (j.notes || []).length });
  }
  // customers (linked automatically from enquiries)
  let cd = await CU.get().catch(() => null);
  if (cd && !cd.built) cd = await CU.rebuild(jobRecs.filter(Boolean)).catch(() => cd);
  const byCore = Object.fromEntries(jobRecs.filter(Boolean).map((j) => [j.core, j])), custOf = {};
  const customers = Object.values((cd && cd.list) || {}).map((c) => {
    c.jobs.forEach((k) => { custOf[k] = c.id; });
    const st = statsFor(c, byCore), src = Object.entries(st.sources).sort((a, b) => b[1] - a[1])[0];
    return { id: c.id, name: c.name || '', phone: c.phone || '', email: c.email || '', suburb: c.suburb || '', enquiries: st.enquiries, confirmed_jobs: st.confirmed, lost_jobs: st.lost,
      open_quotes: st.openQuotes, open_jobs: st.open, quoted_value: st.quotedValue, total_value: st.value, paid_total: st.paid, owed: st.owed, first_contact: d10(st.first), first_month: d10(st.first).slice(0, 7),
      last_contact: d10(st.last), days_since_contact: st.last ? Math.floor((now - st.last) / 86400000) : null, repeat_customer: st.enquiries > 1, main_source: src ? src[0] : '', last_stage: st.lastStage, tags: (c.tags || []).join(', ') };
  }).filter((c) => c.enquiries > 0);
  for (const r of jobs) r.customer = custOf[r.core] || '';
  const quotes = data.quotes.map((q) => ({ id: q.id, job: q.core || '', customer: q.customer.name, status: ACC.effectiveStatus(q, now), issued: q.issued, issued_month: (q.issued || '').slice(0, 7),
    valid_until: q.validUntil || '', ex: q.totals.ex, gst: q.totals.gst, inc: q.totals.inc, invoice_id: q.invoiceId || '' }));
  const invoices = data.invoices.map((i) => {
    const bal = r2(i.totals.inc - (i.paid || 0)), late = i.due && ['sent', 'part-paid'].includes(i.status) ? Math.max(0, Math.floor((now - ACC.ymdToMs(i.due, true)) / 86400000)) : 0;
    return { id: i.id, job: i.core || '', customer: i.customer.name, status: ACC.effectiveStatus(i, now), issued: i.issued, issued_month: (i.issued || '').slice(0, 7), due: i.due || '',
      ex: i.totals.ex, gst: i.totals.gst, inc: i.totals.inc, paid: r2(i.paid || 0), balance: i.status === 'void' ? 0 : bal, days_overdue: late, from_quote: i.fromQuote || '' };
  });
  const items = [];
  for (const d of [...data.quotes, ...data.invoices]) ACC.calc(d.items || [], d.pricesInc).lines.forEach((l, n) => items.push({ doc_id: d.id, doc_type: d.type, line: n + 1,
    description: l.desc, qty: l.qty, price: l.price, gst_free: !l.gst, ex: l.ex, gst: l.gstAmt, inc: l.inc }));
  const payments = [];
  for (const i of data.invoices) for (const p of i.payments || []) payments.push({ invoice_id: i.id, customer: i.customer.name, date: p.date, month: (p.date || '').slice(0, 7), amount: p.amount,
    gst: i.totals.inc ? r2(p.amount * i.totals.gst / i.totals.inc) : 0, method: p.method, reference: p.ref || '' });
  const expenses = data.expenses.map((e) => ({ id: e.id, date: e.date, month: (e.date || '').slice(0, 7), supplier: e.supplier, description: e.desc, category: e.category, job: e.core || '',
    ex: e.ex, gst: e.gst, inc: e.inc, has_receipt: !!e.receipt }));
  const reminders = remList.map((r) => ({ id: r.id, due: new Date(r.at).toISOString(), date: d10(r.at), text: r.text, job: r.core || '' }));
  let visits = [];
  try {
    const v = visitRec;
    visits = Object.entries((v && v.days) || {}).map(([date, n]) => ({ date, month: date.slice(0, 7), visits: n })).sort((a, b) => (a.date > b.date ? 1 : -1));
  } catch {}
  const plan_tasks = [], plan_risks = [], plan_issues = [], plan_subtasks = [], plan_stakeholders = [], plan_contracts = [];
  const todayS = d10(now);
  for (const p of planList) {
    PLAN.schedule(p);
    const STN = { todo: 'To do', doing: 'In progress', review: 'In review / QA', done: 'Done' };
    for (const t of p.tasks) plan_tasks.push({ _id: p.core + '/' + t.id, job: p.core, plan_name: p.name, task: t.name, resource: t.resource || '', lead: t.lead || '', status: STN[t.status] || (t.pct >= 100 ? 'Done' : t.pct > 0 ? 'In progress' : 'To do'), start: t.es, finish: t.ef, days: t.dur, qty: t.qty, unit: t.unit,
      unit_cost: t.rate, planned_cost: r2(t.qty * t.rate), actual_cost: t.actual, pct_complete: t.pct, done: t.pct >= 100, late: t.pct < 100 && t.ef < todayS });
    for (const t of p.tasks) for (const x of t.subs || []) {
      const A = PLAN.allDays(p), es = t.es ? (x.off ? PLAN.addWork(t.es, x.off, A) : t.es) : '', ef = es ? (x.dur > 1 ? PLAN.addWork(es, x.dur - 1, A) : es) : '';
      plan_subtasks.push({ _id: p.core + '/' + t.id + '/' + (x.id || t.subs.indexOf(x) + 1), _parent: p.core + '/' + t.id, job: p.core, plan_name: p.name, task: t.name, subtask: x.name, owner: x.owner || '', start: es, finish: ef, days: x.dur, status: STN[x.status] || 'To do', done: x.status === 'done', late: x.status !== 'done' && !!ef && ef < todayS });
    }
    for (const r of p.risks || []) plan_risks.push({ _id: p.core + '/' + r.id, job: p.core, plan_name: p.name, risk: r.title, probability: r.p, impact: r.i, score: r.p * r.i, response: r.response, owner: r.owner, status: r.status, review: r.review });
    for (const x of p.stakeholders || []) plan_stakeholders.push({ _id: p.core + '/' + x.id, job: p.core, plan_name: p.name, person: x.name, role: x.role, raci: x.raci, raci_meaning: { R: 'Responsible', A: 'Accountable', C: 'Consulted', I: 'Informed' }[x.raci] || '', sub_id: x.sub || '', phone: x.phone || '', email: x.email || '' });
    for (const c of p.contracts || []) {   // v53
      const ap = (c.variations || []).filter((v) => v.status === 'Approved').reduce((a, v) => a + v.amount, 0), pend = (c.variations || []).filter((v) => v.status === 'Pending').reduce((a, v) => a + v.amount, 0);
      const cl = (c.claims || []).reduce((a, v) => a + v.amount, 0), pd = (c.claims || []).filter((v) => v.paid).reduce((a, v) => a + v.amount, 0);
      plan_contracts.push({ _id: p.core + '/' + c.id, job: p.core, plan_name: p.name, type: c.type, direction: c.type === 'Head contract' ? 'in' : 'out', party: c.party, party_kind: c.partyKind,
        sub_id: c.partyKind === 'subbie' ? c.partyRef : '', sup_id: c.partyKind === 'supplier' ? c.partyRef : '', title: c.title, contract_no: c.ref, form: c.form, status: c.status,
        value: c.value, gst_included: !!c.gstIncl, approved_variations: r2(ap), pending_variations: r2(pend), adjusted_value: r2(c.value + ap), claimed: r2(cl), paid: r2(pd), owing: r2(cl - pd),
        left_to_claim: r2(c.value + ap - cl), overdue_claims: (c.claims || []).filter((v) => !v.paid && v.due && v.due < todayS).length, retention_pct: c.retention, payment_terms: c.terms,
        signed: c.signed, start: c.start, completion: c.end, defects_months: c.dlpMonths, ld_per_day: c.ldPerDay, documents: (c.docs || []).length });
    }
    for (const x of p.issues || []) plan_issues.push({ _id: p.core + '/' + x.id, job: p.core, plan_name: p.name, issue: x.title, priority: x.priority, owner: x.owner, raised: x.raised, due: x.due, status: x.status });
  }
  const supName = Object.fromEntries(stock.suppliers.map((x) => [x.id, x.name])), supRec = Object.fromEntries(stock.suppliers.map((x) => [x.id, x]));
  const inventory = [], supplier_prices = [], stock_moves = [];
  for (const it of stock.items) {
    if (it.archived) continue;
    const b = INV.bestPrice(it), al = (alloc[it.id] || {}).qty || 0, av = Math.round(((it.onHand || 0) - al) * 1000) / 1000, oo = it.onOrder && it.onOrder.qty > 0 ? it.onOrder.qty : 0;
    inventory.push({ id: it.id, item: it.name, sku: it.sku || '', category: it.category || '', unit: it.unit, location: it.location || '', on_hand: it.onHand || 0, allocated: al, available: av, on_order: oo,
      reorder_level: it.reorderLevel || 0, reorder_qty: it.reorderQty || 0, low: (it.reorderLevel || 0) > 0 && av + oo <= it.reorderLevel, unit_price: b.price, price_supplier: supName[b.supplier] || '', stock_value: r2((it.onHand || 0) * b.price),
      // v51: who to order from, right on the item (no join needed): the preferred supplier, or the one with the best current price
      supplier_id: b.supplier || '', supplier_contact: (supRec[b.supplier] || {}).contact || '', supplier_phone: (supRec[b.supplier] || {}).phone || '', supplier_email: (supRec[b.supplier] || {}).email || '',
      supplier_terms: (supRec[b.supplier] || {}).terms || '', reorder_needed: Math.max(0, r2((it.reorderLevel || 0) + (it.reorderQty || 0) - av - oo)) });
    for (const p of it.prices || []) supplier_prices.push({ item_id: it.id, item: it.name, supplier_id: p.supplier, supplier: supName[p.supplier] || '', price_ex: p.price, pack_size: p.packSize || 0, quote_ref: p.ref || '',
      quoted: p.quoted || '', valid_until: p.validUntil || '', expired: !!(p.validUntil && p.validUntil < d10(now)), preferred: p.supplier === it.preferred });
    for (const m of it.moves || []) if (m.qty) stock_moves.push({ item_id: it.id, item: it.name, date: d10(m.at), month: d10(m.at).slice(0, 7), kind: m.kind, qty: m.qty, reason: m.reason || '', job: m.job || '' });
  }
  const suppliers = stock.suppliers.filter((x) => !x.archived).map((x) => ({ id: x.id, supplier: x.name, contact: x.contact || '', phone: x.phone || '', email: x.email || '', categories: x.categories || '', terms: x.terms || '',
    items_quoted: stock.items.filter((i) => (i.prices || []).some((p) => p.supplier === x.id)).length }));
  // v49: sub-contractors, with their region and the state of each licence / insurance (ok, due = within 30 days, expired, missing, n/a)
  const TN = Object.fromEntries(SUB.TRADES.map((t) => [t[0], t[1]])), RANK = { Preferred: 1, Approved: 2, 'On trial': 3, 'On hold': 4, 'Do not use': 5 };
  const subcontractors = subRecs.filter(Boolean).map((s) => {
    const c = SUB.compliance(s, d10(now)), g = regionOf(s.suburb || s.address), L = s.licence || {}, I = s.insurance || {}, W = s.workersComp || {};
    return { id: s.id, business: s.business || '', contact: s.contact || '', trade: TN[s.trade] || s.trade || '', other_trades: (s.trades || []).map((t) => TN[t] || t).join(', '),
      phone: s.phone || '', email: s.email || '', suburb: s.suburb || '', postcode: g.postcode, region: g.region, western_sydney: g.western, areas_covered: s.areas || '',
      status: s.status || '', preference_rank: RANK[s.status] || 3, rating: s.rating || 0, hourly_rate: s.rate || 0, callout_fee: s.callout || 0, after_hours_rate: s.afterHours || 0,
      payment_terms: s.terms || '', availability: s.availability || '', licence_no: L.number || '', licence_class: L.class || '', licence_expiry: L.expiry || '', licence_state: c.lic,
      insurer: I.insurer || '', pl_policy: I.policy || '', pl_cover: I.cover || 0, pl_expiry: I.expiry || '', pl_state: c.pl, wc_policy: W.policy || '', wc_expiry: W.expiry || '', wc_state: c.wc,
      sole_trader: !!W.soleTrader, white_card: !!s.whiteCard, swms: !!s.swms, compliance: c.worst, problems: c.problems.join('; '), any_expired: c.worst === 'expired', last_used: s.lastUsed || '',
      days_since_used: s.lastUsed ? Math.round((Date.parse(d10(now)) - Date.parse(s.lastUsed)) / 864e5) : null, archived: !!s.archived, _keys: [s.trade].concat(s.trades || []) };
  }).sort((a, b) => a.preference_rank - b.preference_rank || b.rating - a.rating || a.business.localeCompare(b.business));
  // every trade, with or without subbies (counts include subbies who list it as another trade)
  const sub_trades = SUB.TRADES.map(([k, nm, lic]) => {
    const L = subcontractors.filter((s) => !s.archived && s.status !== 'Do not use' && s._keys.includes(k)), rated = L.filter((s) => s.rating), rates = L.map((s) => s.hourly_rate).filter((x) => x > 0);
    return { trade: nm, licence_needed: lic, subbies: L.length, preferred: L.filter((s) => s.status === 'Preferred').length, approved: L.filter((s) => s.status === 'Approved').length,
      all_papers_ok: L.filter((s) => s.compliance === 'ok').length, with_expired: L.filter((s) => s.any_expired).length,
      avg_rating: rated.length ? r2(rated.reduce((a, s) => a + s.rating, 0) / rated.length) : null, avg_hourly_rate: rates.length ? r2(rates.reduce((a, x) => a + x, 0) / rates.length) : null, cheapest_hourly_rate: rates.length ? Math.min(...rates) : null };
  });
  subcontractors.forEach((s) => { delete s._keys; });
  const all = { customers, jobs, quotes, invoices, items, payments, expenses, reminders, visits, plan_tasks, plan_subtasks, plan_risks, plan_issues, inventory, suppliers, supplier_prices, stock_moves, subcontractors, sub_trades, plan_stakeholders, plan_contracts };
  return withKeys(all, { custOfJob: custOf });
}

// ---------- AI narrative (DeepSeek) ----------
// Contact details never leave MBS: phone, email, address and personal-name columns are removed before the AI sees anything.
const PRIVATE = /phone|email|address|^name$|^contact$|customer|reference/i;
function sample(columns, rows) {
  const keep = columns.filter((c) => !PRIVATE.test(c));
  return { columns: keep, rows: rows.slice(0, 60).map((r) => Object.fromEntries(keep.map((c) => [c, r[c]]))), removed: columns.filter((c) => PRIVATE.test(c)) };
}
function basicSummary(columns, rows) {
  const nums = columns.filter((c) => rows.some((r) => typeof r[c] === 'number'));
  const lines = nums.slice(0, 4).map((c) => { const t = r2(rows.reduce((a, r) => a + (Number(r[c]) || 0), 0)); return `Total ${c.replace(/_/g, ' ')}: ${t.toLocaleString('en-AU')}`; });
  return { summary: `${rows.length} row${rows.length === 1 ? '' : 's'} returned.`, insights: lines, recommendations: [] };
}
export async function narrative({ title, sql, columns, rows, focus }) {
  const key = env('LLM_API_KEY');
  const s = sample(columns, rows);
  if (!key) return { ...basicSummary(columns, rows), ai: false, note: 'AI is not set up (LLM_API_KEY), so this is a basic summary.' };
  const base = env('LLM_BASE_URL', 'https://api.deepseek.com').replace(/\/+$/, '');
  let model = env('LLM_MODEL', 'deepseek-chat'); if (/reasoner|thinking/i.test(model)) model = 'deepseek-chat';
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 9000);   // Netlify allows about 10 seconds
  try {
    const r = await fetch(`${base}/chat/completions`, { method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, temperature: 0.3, stream: false, max_tokens: 600, response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'You are a business analyst for Modern Building Solutions, a Sydney building company (remedial, waterproofing, painting, construction). ' +
            'Write a short, plain-English report on the data you are given. Australian spelling, dollars in AUD, GST is 10%. Only state what the data shows; do not invent numbers. ' +
            'Reply as JSON: {"title": string (max 70 chars), "summary": string (2-3 sentences), "insights": [3-5 short bullet strings with specific figures], "recommendations": [1-3 short practical actions]}.' },
          { role: 'user', content: JSON.stringify({ report_title: title, question_or_focus: focus || '', sql, row_count: rows.length, columns: s.columns, rows: s.rows }) }
        ] })
    });
    if (!r.ok) throw new Error('DeepSeek error ' + r.status);
    const j = await r.json();
    const txt = stripThinking(j?.choices?.[0]?.message?.content ?? '').replace(/^```(?:json)?\s*|\s*```$/g, '');
    const o = JSON.parse(txt);
    const list = (x, n) => (Array.isArray(x) ? x : []).map((t) => String(t).slice(0, 300)).filter(Boolean).slice(0, n);
    return { title: String(o.title || title).slice(0, 90), summary: String(o.summary || '').slice(0, 900), insights: list(o.insights, 6), recommendations: list(o.recommendations, 4), ai: true, removed: s.removed };
  } catch (e) {
    return { ...basicSummary(columns, rows), ai: false, note: /abort/i.test(e.message) ? 'The AI took too long, so this is a basic summary. Try again.' : 'The AI could not be reached (' + e.message + '), so this is a basic summary.' };
  } finally { clearTimeout(timer); }
}

// ---------- AI query: a plain-English question -> SQL (the AI writes it) -> run in the browser -> a plain-English answer ----------
// The AI never sees the data rows when writing SQL: only table and column names, the dates for "this month" etc.,
// and short lists of codes (stages, statuses, plan names, suburbs). Phone numbers, emails and names are never sent.
// short notes the AI needs (kept brief to save tokens)
// short notes per table (only the tables a question needs are sent, to keep each AI call small)
const NOTE = {
  jobs: 'core = id for joins, ref = job number staff see, stage new|called|quoted|won|completed|invoiced|paid|lost, created = enquiry date, *_date = date it reached that stage, quote_inc/invoice_inc $ inc GST, name = customer',
  customers: 'id = jobs.customer; enquiries = all their jobs; confirmed_jobs = won or later; total_value = $ inc GST of confirmed jobs; owed = invoiced not paid; repeat_customer true when 2+ enquiries; dates YYYY-MM-DD',
  quotes: 'job = jobs.core; ex/gst/inc $', invoices: 'job = jobs.core; balance = $ owed; ex/gst/inc $', items: 'doc_id = quote or invoice id', payments: 'invoice_id = invoices.id',
  expenses: 'job = jobs.core (blank = overhead); ex/gst/inc $', reminders: 'job = jobs.core', visits: 'website visitors per day',
  plan_tasks: 'one plan per job, job = jobs.core, status To do|In progress|In review / QA|Done, days 0 = milestone, pct_complete 0-100, done/late true|false',
  plan_subtasks: 'steps inside a plan task (task = plan_tasks.task, same job), no costs', plan_risks: 'job = jobs.core', plan_issues: 'job = jobs.core',
  inventory: 'one row per stock item; available = on_hand - allocated (set aside by open plan tasks); low = at or below reorder_level; unit_price = preferred or cheapest valid quote ex GST; price_supplier, supplier_contact, supplier_phone, supplier_email = who to order it from (no join needed). "Low", "short supply", "running out", "need to order" = low = true',
  subcontractors: 'one row per subbie (leave out archived = true unless asked). trade is the full name e.g. "Cleaner (builders clean)", "Electrician (sparkie)", "Plumber": match LOWER(trade) LIKE \'%clean%\' OR LOWER(other_trades) LIKE \'%clean%\'. ' +
    'Area: region is one of Hills District|Blacktown|Parramatta & Cumberland|Penrith|Hawkesbury|Fairfield & Liverpool|Campbelltown & Camden|Inner West|North Shore|Northern Beaches|Eastern Suburbs|Sydney CBD|Canterbury-Bankstown|St George & Sutherland|Central Coast|Blue Mountains; ' +
    '"Western Sydney" = (western_sydney = true OR LOWER(areas_covered) LIKE \'%western sydney%\' OR LOWER(areas_covered) LIKE \'%greater sydney%\'). ' +
    'By preference / best first = ORDER BY preference_rank, rating DESC (1 Preferred, 2 Approved, 3 On trial, 4 On hold, 5 Do not use). ' +
    'licence_state, pl_state (public liability insurance), wc_state (workers comp) and compliance are ok|due (expires within 30 days)|expired|missing|n/a; any_expired true when anything has expired. ' +
    'days_since_used = days since last used (null = never). Subbies on a project: JOIN plan_stakeholders ps ON ps.sub_id = subcontractors.id (ps.job = jobs.core). For trades with nobody, counts per trade, average rating or rates use sub_trades. ' +
    'To show licence and insurance and flag expired, list (in this order) business, compliance, problems, trade, suburb, status, rating, licence_no, licence_expiry, licence_state, pl_expiry, pl_state, wc_expiry, wc_state. Dates YYYY-MM-DD',
  sub_trades: 'one row per trade category (33), subbies = active subbies who do it (0 = nobody), licence_needed true when NSW needs a licence for it',
  plan_contracts: 'one row per contract on a project: direction in = head contract with the customer (money in), out = subcontract/supply/consultant (money out); adjusted_value = value + approved_variations; owing = claimed - paid; status Draft|Sent|Signed|Active|Completed|Terminated|Disputed',
  plan_stakeholders: 'one row per stakeholder on a project plan: job = jobs.core, raci R|A|C|I, sub_id = subcontractors.id when the person is a subbie (blank otherwise)',
  suppliers: 'suppliers', supplier_prices: 'one row per supplier quote for a stock item', stock_moves: 'qty + in / - out; kind in|out|count|plan|order; job = jobs.core'
};
const WORDS = {
  customers: /customer|client|repeat|loyal|most (orders|jobs)|biggest|spend|lapsed|win back|regular/i,
  quotes: /quot/i, invoices: /invoic|owe|owing|unpaid|overdue|paid|debt|balance|bill/i, items: /line item|items? on (the|a|my) (quote|invoice)/i, payments: /pay|paid|received|income|revenue|cash/i,
  expenses: /expens|spend|spent|cost|receipt|purchase|bought/i, reminders: /remind|follow/i, visits: /visit|traffic|website/i,
  plan_tasks: /plan|project|task|complet|progress|late|schedule|gantt|milestone|lead|resource|finish|behind/i, plan_subtasks: /sub-?task|step/i, plan_risks: /risk/i, plan_issues: /issue|problem/i,
  subcontractors: /sub-?contract|subb(ie|y|ies)|tradie|sparky|rating|rated|roof|drain|gutter|leak|liability|call-?out|hourly|rates?\b|sole trader|papers?\b|complian|on hold|do not use|(not|haven'?t|didn'?t)( we)? used|last used|who (can|does|do)|someone|anyone|nobody|no one|\bguy\b|person for|trades?(wo)?m[ae]n|licen[cs]|insur|workers'? comp|white card|swms|plumb|electric|sparkie|cleaner|tiler|painter|carpent|roofer|concret|plaster|waterproof|glazier|landscap|fenc|scaffold|demoli|asbestos|skip bin|pest|locksmith|handyman|gas ?fit|air ?con|certifier|engineer|surveyor|bricklay|joiner/i,
  inventory: /stock|inventor|material|re-?order|low on|on hand|short supply|short of|running (low|out)|run(ning)? out|\blow\b|\bitems?\b|\border(ing)?\b|restock|shortage|supplies|parts?\b|products?\b/i, suppliers: /supplier|vendor/i, supplier_prices: /price|cheap|compare|supplier quote/i, stock_moves: /stock (used|in|out)|used|movement|consum|took/i
};
export function pickTables(question, extraSql = '') {
  const q = String(question || ''), chosen = new Set(['jobs']);
  for (const [t, re] of Object.entries(WORDS)) if (re.test(q)) chosen.add(t);
  for (const t of Object.keys(SCHEMA)) if (new RegExp('\\b' + t + '\\b', 'i').test(extraSql)) chosen.add(t);
  if (chosen.has('plan_subtasks')) chosen.add('plan_tasks');
  if (chosen.has('supplier_prices') || chosen.has('stock_moves') || chosen.has('suppliers')) chosen.add('inventory');
  if (chosen.has('inventory') && /supplier|order from|whom|who to|contact|phone|call|email|vendor/i.test(q)) chosen.add('suppliers');
  if (chosen.has('subcontractors')) { chosen.add('sub_trades'); if (/job|project|plan|working on|on site|stakeholder|raci/i.test(q)) chosen.add('plan_stakeholders'); }
  if (/contract|variation|progress claim|retention|liquidated|defects|subcontract|purchase order|margin|committed/i.test(q)) { chosen.add('plan_contracts'); if (/sub|trade/i.test(q)) chosen.add('subcontractors'); }
  if (/stakeholder|raci|accountable|responsible|consulted|informed/i.test(q)) { chosen.add('plan_stakeholders'); chosen.add('plan_tasks'); }
  // nothing specific (and not about jobs): give the AI every table
  if (chosen.size === 1 && !/job|enquir|customer|lead|won|lost|suburb|trade|new|stage|called/i.test(q)) Object.keys(SCHEMA).forEach((t) => chosen.add(t));
  return Object.keys(SCHEMA).filter((t) => chosen.has(t));
}

function sydneyDates(now = Date.now()) {
  const p = parts(now);
  const D = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
  const S = (dt) => dt.toISOString().slice(0, 10);
  const add = (dt, n) => new Date(dt.getTime() + n * 86400000);
  const today = D(p.y, p.mo, p.d), wd = (today.getUTCDay() + 6) % 7, monday = add(today, -wd);
  const monthStart = D(p.y, p.mo, 1), monthEnd = add(D(p.y, p.mo + 1, 1), -1);
  const fyY = p.mo >= 7 ? p.y : p.y - 1;
  return {
    today: S(today), this_week: [S(monday), S(add(monday, 6))], last_week: [S(add(monday, -7)), S(add(monday, -1))],
    this_month: [S(monthStart), S(monthEnd)], last_month: [S(D(p.y, p.mo - 1, 1)), S(add(monthStart, -1))],
    this_year: [`${p.y}-01-01`, `${p.y}-12-31`], this_financial_year: [`${fyY}-07-01`, `${fyY + 1}-06-30`], last_financial_year: [`${fyY - 1}-07-01`, `${fyY}-06-30`],
    last_30_days: [S(add(today, -29)), S(today)]
  };
}
const HINT_KEYS = { quote_status: 8, invoice_status: 8, expense_categories: 12, trades: 10, sources: 8, suburbs: 12, plans: 15, sub_trades: 35 };
const HINT_FOR = { quote_status: 'quotes', invoice_status: 'invoices', expense_categories: 'expenses', plans: 'plan_tasks', sub_trades: 'subcontractors' };
function cleanHints(h, use) {
  const out = {};
  for (const [k, n] of Object.entries(HINT_KEYS)) {
    if (use && HINT_FOR[k] && !use.includes(HINT_FOR[k]) && !(k === 'plans' && use.some((t) => t.startsWith('plan_')))) continue; const v = h && h[k]; if (Array.isArray(v) && v.length) out[k] = v.slice(0, n).map((x) => String(x ?? '').slice(0, 60)).filter(Boolean); }
  return out;
}
export function readOnly(sql) {
  const s = String(sql || '').replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').trim().replace(/;\s*$/, '');
  if (!/^(select|with)\b/i.test(s) || /;/.test(s) || /\b(into|insert|update|delete|drop|create|alter|attach|detach|require|source|declare)\b/i.test(s) || /\b(json|csv|xlsx|xls|txt|tab|tsv|html|ods|file)\s*\(/i.test(s)) return '';
  return s;
}
const SYSTEM = 'Turn the question from the owner of a Sydney building company into ONE read-only AlaSQL query over the tables given. Rules: ' +
  '1) One SELECT (or WITH), no semicolons, only the listed tables/columns. ' +
  '2) Dates are text YYYY-MM-DD: use BETWEEN with the exact dates given for today, this week, this month, financial year (1 Jul-30 Jun) etc. ' +
  '3) Never alias as total, value, count, sum, rows, index, plan, top, group, desc or asc; every alias must differ from column names (e.g. jobs_count, total_inc). Same aliases in every UNION part. ' +
  '4) Match words loosely: LOWER(col) LIKE \'%word%\'. "Project X" = plan_tasks.plan_name or the job (jobs.name, service, suburb, ref) joined on plan_tasks.job = jobs.core. ' +
  '5) Project % complete = ROUND(SUM(CASE WHEN days < 1 THEN 1 ELSE days END * pct_complete) / SUM(CASE WHEN days < 1 THEN 1 ELSE days END)). New jobs = by created. Owed = SUM(balance) of invoices not paid or void. ' +
  '6) Every table starts with its own key (primary key), named after the table: customer_id, job_id, quote_id, invoice_id, stock_id (inventory), supplier_id, subcontractor_id, task_id, line_id, payment_id, expense_id, move_id, price_id, stakeholder_id. ' +
  'A column with another table\'s key name points to that table (foreign key), so JOIN on the SAME name, never on names or text: inventory.supplier_id = suppliers.supplier_id; supplier_prices.stock_id = inventory.stock_id; supplier_prices.supplier_id = suppliers.supplier_id; ' +
  'stock_moves.stock_id = inventory.stock_id; stock_moves.job_id = jobs.job_id; quotes/invoices/expenses/reminders/plan_*.job_id = jobs.job_id; jobs.customer_id = customers.customer_id; invoices.quote_id = quotes.quote_id; ' +
  'items.quote_id / items.invoice_id; payments.invoice_id = invoices.invoice_id; plan_subtasks.task_id = plan_tasks.task_id; plan_stakeholders.subcontractor_id = subcontractors.subcontractor_id; plan_contracts.job_id = jobs.job_id, plan_contracts.subcontractor_id = subcontractors.subcontractor_id, plan_contracts.supplier_id = suppliers.supplier_id. ' +
  'For a UNION, select the same key and columns from each part (e.g. stock_id, supplier_id). Use LEFT JOIN when the other side may be missing. Prefer columns already on the table (e.g. inventory.supplier_phone) over a join. ' +
  '7) Lists: useful columns, newest first, LIMIT 200. Totals/counts: one row. If it cannot be answered from these tables, sql = "" and say why in note. ' +
  'Reply JSON only: {"sql":"","title":"max 60 chars","note":"one short sentence: how you read it","chart":null or {"type":"bar|hbar|line|pie|doughnut","x":"alias","y":["alias"]}}';

export async function askSql({ question, hints, previous, history }) {
  const first = !(previous && previous.sql);
  if (first) await checkLimit();
  const use = pickTables(question, [(history || []).map((h) => h && h.sql).join(' '), previous && previous.sql].join(' '));
  const tables = use.map((t) => `${t}(${SCHEMA[t].join(',')})`).join('\n');
  const notes = use.map((t) => `${t}: ${NOTE[t] || DESCRIBE[t] || ''}`).join('. ');
  const user = { q: String(question).slice(0, 300), dates: sydneyDates(), tables, notes, values: cleanHints(hints, use) };
  if (Array.isArray(history) && history.length) user.earlier = history.slice(-1).map((h) => ({ q: String(h.q || '').slice(0, 200), sql: String(h.sql || '').slice(0, 600) }));
  if (!first) user.fix = { sql: String(previous.sql).slice(0, 1500), error: String(previous.error || '').slice(0, 200) };
  const { data: o, used } = await llmJson([{ role: 'system', content: SYSTEM }, { role: 'user', content: JSON.stringify(user) }], { maxTokens: tokCap() });
  const today = await usage(first, used);
  const sql = String(o.sql || '').trim();
  let chart = null;
  if (o.chart && typeof o.chart === 'object' && o.chart.x && Array.isArray(o.chart.y) && ['bar', 'hbar', 'line', 'pie', 'doughnut'].includes(o.chart.type)) chart = { type: o.chart.type, x: String(o.chart.x), y: o.chart.y.map(String).slice(0, 4) };
  const base = { tokens: used, today };
  if (sql && !readOnly(sql)) return { ...base, sql: '', title: '', note: 'The AI suggested a query that is not allowed here (reports only read data). Try asking in a different way.', chart: null };
  return { ...base, sql: sql ? readOnly(sql) : '', title: String(o.title || 'AI query').slice(0, 80), note: String(o.note || '').slice(0, 300), chart };
}
export async function answerFromRows({ question, title, sql, columns, rows, rowCount }) {
  const s = sample(columns, rows);
  const basic = rows.length === 0 ? 'Nothing matched that question.' : `${rows.length} row${rows.length === 1 ? '' : 's'} found (see the table).`;
  if (!llmSetup() || !rows.length) return { answer: basic, ai: false, tokens: 0 };
  try {
    const { data: o, used } = await llmJson([
      { role: 'system', content: 'Answer the business owner in 1-3 short plain-English sentences using ONLY these query results: direct answer and key figures first, Australian spelling, $1,234.56. Never guess removed private details. JSON: {"answer":""}' },
      { role: 'user', content: JSON.stringify({ q: String(question).slice(0, 300), title, row_count: rowCount || rows.length, columns: s.columns, rows: s.rows.slice(0, 20) }) }
    ], { maxTokens: 200, temperature: 0.2 });
    const today = await usage(false, used);
    return { answer: String(o.answer || basic).slice(0, 700), ai: true, tokens: used, today };
  } catch (e) { return { answer: basic, ai: false, note: e.message, tokens: 0 }; }
}

// ---------- the PDF ----------
const safe = (s) => String(s ?? '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—−]/g, '-').replace(/…/g, '...')
  .replace(/[•·]/g, '-').replace(/ /g, ' ').replace(/[\r\t]/g, ' ').replace(/[^\n\x20-\x7E\xA0-\xFF]/g, '');
export async function reportPdf({ title, summary, insights, recommendations, sql, columns, rows, chart, by, ai }) {
  const { PDFDocument, StandardFonts, rgb } = await pdfLib();
  const B = business();
  const pdf = await PDFDocument.create();
  pdf.setTitle(safe(title)); pdf.setAuthor(B.name); pdf.setCreator(B.name); pdf.setProducer(B.name);
  const reg = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold), mono = await pdf.embedFont(StandardFonts.Courier);
  const logo = await pdf.embedPng(Buffer.from(LOGO, 'base64'));
  const W = 595.28, Hh = 841.89, M = 40, INK = rgb(0.08, 0.08, 0.08), GREY = rgb(0.42, 0.41, 0.38), GOLD = rgb(0.79, 0.64, 0.15);
  const pages = []; let page, y;
  const add = () => { page = pdf.addPage([W, Hh]); pages.push(page); y = Hh - M; };
  const text = (s, x, yy, o = {}) => page.drawText(safe(s), { x, y: yy, size: o.size || 10, font: o.font || reg, color: o.color || INK });
  const wrap = (s, width, size = 10, f = reg) => { const outL = []; for (const para of safe(s).split('\n')) { let line = ''; for (const w of para.split(/\s+/)) { const t = line ? line + ' ' + w : w; if (f.widthOfTextAtSize(t, size) <= width) line = t; else { if (line) outL.push(line); line = w; } } outL.push(line); } return outL; };
  const need = (h) => { if (y - h < 60) add(); };
  add();
  const lw = 120, lh = lw * logo.height / logo.width;
  page.drawImage(logo, { x: M - 3, y: Hh - M - lh + 4, width: lw, height: lh });
  const when = new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  text('REPORT', W - M - bold.widthOfTextAtSize('REPORT', 20), Hh - M - 16, { font: bold, size: 20 });
  page.drawRectangle({ x: W - M - 90, y: Hh - M - 26, width: 90, height: 3, color: GOLD });
  text(safe(when), W - M - reg.widthOfTextAtSize(safe(when), 9), Hh - M - 42, { size: 9, color: GREY });
  if (by) text('Prepared by ' + by, W - M - reg.widthOfTextAtSize(safe('Prepared by ' + by), 9), Hh - M - 55, { size: 9, color: GREY });
  y = Hh - M - Math.max(lh, 70) - 18;
  for (const l of wrap(title, W - 2 * M, 18, bold)) { text(l, M, y, { font: bold, size: 18 }); y -= 22; }
  y -= 6;
  if (summary) { for (const l of wrap(summary, W - 2 * M, 11)) { need(16); text(l, M, y, { size: 11 }); y -= 15; } y -= 8; }
  const bullets = (head, list) => {
    if (!list || !list.length) return;
    need(30); text(head, M, y, { font: bold, size: 12 }); y -= 18;
    for (const it of list) { const ls = wrap(it, W - 2 * M - 16, 10.5); need(ls.length * 14 + 4); page.drawCircle({ x: M + 4, y: y + 3.5, size: 2.2, color: GOLD }); ls.forEach((l, i) => text(l, M + 14, y - i * 14, { size: 10.5 })); y -= ls.length * 14 + 4; }
    y -= 8;
  };
  bullets('Key findings', insights);
  bullets('Suggested actions', recommendations);
  if (chart) {
    try {
      const m = String(chart).match(/^data:image\/(png|jpeg);base64,(.+)$/);
      if (m) {
        const img = m[1] === 'png' ? await pdf.embedPng(Buffer.from(m[2], 'base64')) : await pdf.embedJpg(Buffer.from(m[2], 'base64'));
        const cw = W - 2 * M, ch = Math.min(300, cw * img.height / img.width);
        need(ch + 10); page.drawImage(img, { x: M + (cw - ch * img.width / img.height) / 2, y: y - ch, width: ch * img.width / img.height, height: ch }); y -= ch + 18;
      }
    } catch {}
  }
  // data table (first 40 rows)
  const cols = (columns || []).slice(0, 7);
  if (cols.length && rows && rows.length) {
    need(50); text(`Data (${Math.min(rows.length, 40)} of ${rows.length} rows${columns.length > 7 ? ', first 7 columns' : ''})`, M, y, { font: bold, size: 12 }); y -= 20;
    const cw = (W - 2 * M) / cols.length;
    const fit = (s, w, f, size) => { let t = safe(s); while (t && f.widthOfTextAtSize(t, size) > w - 6) t = t.slice(0, -2) + '…'.replace('…', '.'); return t; };
    const head = () => { page.drawRectangle({ x: M, y: y - 5, width: W - 2 * M, height: 18, color: INK }); cols.forEach((c, i) => text(fit(c.replace(/_/g, ' '), cw, bold, 8.5), M + i * cw + 4, y, { font: bold, size: 8.5, color: rgb(1, 1, 1) })); y -= 18; };
    head();
    rows.slice(0, 40).forEach((r, n) => {
      if (y < 70) { add(); head(); }
      if (n % 2) page.drawRectangle({ x: M, y: y - 4, width: W - 2 * M, height: 15, color: rgb(0.97, 0.965, 0.95) });
      cols.forEach((c, i) => { const v = r[c]; const s = typeof v === 'number' ? v.toLocaleString('en-AU', { maximumFractionDigits: 2 }) : v == null ? '' : String(v); text(fit(s, cw, reg, 8.5), M + i * cw + 4, y, { size: 8.5 }); });
      y -= 15;
    });
    y -= 10;
  }
  if (sql) { need(40); text('Query', M, y, { font: bold, size: 10, color: GREY }); y -= 13; for (const l of wrap(sql.replace(/\s+/g, ' '), W - 2 * M, 8, mono).slice(0, 12)) { need(12); text(l, M, y, { font: mono, size: 8, color: GREY }); y -= 11; } }
  pages.forEach((pg, i) => { page = pg; page.drawLine({ start: { x: M, y: 40 }, end: { x: W - M, y: 40 }, thickness: 0.6, color: rgb(0.88, 0.87, 0.84) });
    text(`${B.name} - ${B.web}${ai ? ' - Written with AI assistance (DeepSeek); check figures before relying on them' : ''}`, M, 28, { size: 7.5, color: GREY });
    const pn = `Page ${i + 1} of ${pages.length}`; text(pn, W - M - reg.widthOfTextAtSize(pn, 8), 28, { size: 8, color: GREY }); });
  return pdf.save();
}

export async function sqlPost(action, body, { who }) {
  if (action === 'sqlData') return out(200, { schema: SCHEMA, describe: DESCRIBE, keys: Object.fromEntries(Object.entries(KEYS).map(([t, K]) => [t, { pk: K.pk, fk: K.fk || {} }])), data: await tables() });
  if (action === 'sqlNarrative') {
    const columns = (Array.isArray(body.columns) ? body.columns : []).map(String).slice(0, 40), rows = Array.isArray(body.rows) ? body.rows.slice(0, 200) : [];
    return out(200, await narrative({ title: String(body.title || 'Report').slice(0, 120), sql: String(body.sql || '').slice(0, 3000), columns, rows, focus: String(body.focus || '').slice(0, 400) }));
  }
  if (action === 'sqlAsk') {
    const question = String(body.question || '').trim();
    if (!question) return bad('Type a question first');
    try { return out(200, await askSql({ question, hints: body.hints || {}, previous: body.previous || null, history: body.history || [] })); }
    catch (e) { const st = Number.isInteger(e.code) && e.code >= 400 && e.code < 600 ? e.code : 502; return out(st, { error: e.message, retry: st === 504 }); }
  }
  if (action === 'aiPing') return out(200, await ping());
  if (action === 'sqlUsage') return out(200, await usageToday());
  if (action === 'sqlAnswer') {
    const columns = (Array.isArray(body.columns) ? body.columns : []).map(String).slice(0, 40), rows = Array.isArray(body.rows) ? body.rows.slice(0, 200) : [];
    return out(200, await answerFromRows({ question: String(body.question || '').slice(0, 500), title: String(body.title || '').slice(0, 120), sql: String(body.sql || '').slice(0, 3000), columns, rows, rowCount: Math.max(rows.length, Number(body.row_count) || 0) }));
  }
  if (action === 'sqlPdf') {
    const columns = (Array.isArray(body.columns) ? body.columns : []).map(String).slice(0, 40), rows = Array.isArray(body.rows) ? body.rows.slice(0, 200) : [];
    if (body.chart && String(body.chart).length > 4_000_000) return bad('The chart image is too big');
    const bytes = await reportPdf({ title: String(body.title || 'Report').slice(0, 120), summary: String(body.summary || '').slice(0, 1500), insights: (body.insights || []).slice(0, 8).map(String),
      recommendations: (body.recommendations || []).slice(0, 5).map(String), sql: String(body.sql || '').slice(0, 3000), columns, rows, chart: body.chart || '', by: who, ai: !!body.ai });
    return new Response(bytes, { status: 200, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="MBS-report-${new Date().toISOString().slice(0, 10)}.pdf"`, 'Cache-Control': 'no-store' } });
  }
  return null;
}
