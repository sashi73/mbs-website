// MBS accounts: quotes, tax invoices, payments, expenses, GST/BAS and profit. Stored in Netlify Blobs ("mbs-jobs").
//   quote:Q-000001    invoice:INV-000001    expense:EXP-000001    receipt:EXP-000001 (photo/PDF of the receipt)
//   acct-index  (quick lists)     acct-seq  (running numbers, never reused)
// All money is in dollars, rounded to cents. GST is 10% (1/11 of a GST-inclusive amount).
import * as kv from './kv.mjs';
import { parts, sydneyTime } from './calendar.mjs';

export const TERMS_DAYS = 7, QUOTE_VALID_DAYS = 30;
export const EXPENSE_CATEGORIES = ['Materials', 'Subcontractors', 'Equipment hire', 'Tools & equipment', 'Vehicle & fuel', 'Insurance', 'Licences & fees',
  'Advertising & marketing', 'Phone & internet', 'Office & software', 'Wages & super', 'Bank fees', 'Other'];
export const PAY_METHODS = ['Bank transfer', 'Card', 'Cash', 'Cheque', 'Other'];

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
export const money = (n) => '$' + r2(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const clean = (s, max = 500) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);

// ---------- dates (Sydney, as YYYY-MM-DD) ----------
export function today(now = Date.now()) { const p = parts(now); return `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; }
export function addDays(ymd, n) { const [y, m, d] = ymd.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return t.toISOString().slice(0, 10); }
const validDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : null;
export function ymdToMs(ymd, end = false) { const [y, m, d] = ymd.split('-').map(Number); return sydneyTime(y, m, d, end ? 23 : 0, end ? 59 : 0); }
export function prettyDate(ymd) { if (!ymd) return ''; const [y, m, d] = ymd.split('-').map(Number); return `${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${y}`; }

// ---------- GST maths ----------
// items: [{ desc, qty, price, gst }]  price = unit price; pricesInc = the prices already include GST
export function cleanItems(items) {
  return (Array.isArray(items) ? items : []).slice(0, 60).map((i) => ({
    desc: clean(i.desc, 400), qty: r2(i.qty === '' || i.qty == null ? 1 : i.qty) || 0, price: r2(i.price), gst: i.gst !== false
  })).filter((i) => i.desc || i.price);
}
export function calc(items, pricesInc = false) {
  let ex = 0, gst = 0, inc = 0;
  const lines = items.map((i) => {
    const amount = r2(i.qty * i.price);
    let lex, lgst, linc;
    if (pricesInc) { linc = amount; lgst = i.gst ? r2(amount / 11) : 0; lex = r2(linc - lgst); }
    else { lex = amount; lgst = i.gst ? r2(amount * 0.1) : 0; linc = r2(lex + lgst); }
    ex += lex; gst += lgst; inc += linc;
    return { ...i, ex: lex, gstAmt: lgst, inc: linc };
  });
  return { lines, ex: r2(ex), gst: r2(gst), inc: r2(inc) };
}

// ---------- numbering + index ----------
async function nextNo(kind) {   // kind: Q, INV, EXP
  const s = await kv.update('acct-seq', (q) => ({ ...q, [kind]: (q[kind] || 0) + 1 }), () => ({ Q: 0, INV: 0, EXP: 0 }));
  return `${kind}-${String(s[kind]).padStart(6, '0')}`;
}
const KEY = { quote: 'quote:', invoice: 'invoice:', expense: 'expense:' };
const GROUP = { quote: 'quotes', invoice: 'invoices', expense: 'expenses' };
export function kindFromId(id) { return /^Q-/.test(id) ? 'quote' : /^INV-/.test(id) ? 'invoice' : /^EXP-/.test(id) ? 'expense' : null; }
function summaryOf(d) {
  if (d.type === 'expense') return { id: d.id, date: d.date, supplier: d.supplier, desc: d.desc, category: d.category, inc: d.inc, gst: d.gst, core: d.core || '', receipt: !!d.receipt, updated: d.updated };
  return { id: d.id, type: d.type, core: d.core || '', name: d.customer.name, status: d.status, issued: d.issued, due: d.due || '', validUntil: d.validUntil || '',
    inc: d.totals.inc, gst: d.totals.gst, ex: d.totals.ex, paid: d.paid || 0, balance: d.type === 'invoice' ? r2(d.totals.inc - (d.paid || 0)) : 0,
    fromQuote: d.fromQuote || '', invoiceId: d.invoiceId || '', sentAt: d.sentAt || null, acceptedAt: d.acceptedAt || null, plan: d.plan ? 1 : 0, updated: d.updated };
}
async function save(d) {
  d.updated = Date.now();
  await kv.set(KEY[d.type] + d.id, d);
  await kv.update('acct-index', (x) => { x[GROUP[d.type]][d.id] = summaryOf(d); return x; }, () => ({ quotes: {}, invoices: {}, expenses: {} }));
  if (d.type === 'quote' && d.core) await refreshGate(d.core).catch((e) => console.error('Plan quote gate:', e.message));
  return d;
}
// Work on a job can only start once its quote is accepted. The plan keeps a "gate": the accepted date, or (not accepted yet)
// the date the quote is valid until, so a quote dated the 30th and valid until the 5th schedules the work from the 5th.
export function gateFrom(quotes, core) {
  const live = Object.values(quotes || {}).filter((x) => x.core === core && !['void', 'declined'].includes(x.status)).sort((a, b) => (a.id > b.id ? 1 : -1));
  const acc = live.filter((q) => q.status === 'accepted' || q.invoiceId)[0];   // once a quote is accepted the job is on (a later variation doesn't hold it back)
  if (acc) return { date: acc.acceptedAt ? today(acc.acceptedAt) : acc.issued, id: acc.id, accepted: true };
  const q = live.pop();   // not accepted yet: the plan assumes it is accepted on the quote date (the cooling-off period then applies)
  return q ? { date: q.issued, id: q.id, accepted: false, validUntil: q.validUntil || '' } : null;
}
export async function gateFor(core) { return gateFrom((await index()).quotes, core); }
export async function refreshGate(core) {
  if (!(await kv.get('plan:' + core))) return;
  const gate = await gateFor(core);
  await kv.update('plan:' + core, (p) => { if (p) p.gate = gate; return p; }, null);
}
export async function index() { return (await kv.get('acct-index')) || { quotes: {}, invoices: {}, expenses: {} }; }
export async function get(id) { const k = kindFromId(id); return k ? kv.get(KEY[k] + id) : null; }
export async function list(type) { const x = await index(); return Object.values(x[GROUP[type]] || {}).sort((a, b) => (b.id > a.id ? 1 : -1)); }
export async function removeFromIndex(id) {
  const k = kindFromId(id); if (!k) return;
  await kv.update('acct-index', (x) => { delete x[GROUP[k]][id]; return x; }, () => ({ quotes: {}, invoices: {}, expenses: {} }));
}
export async function rebuildIndex() {
  const x = { quotes: {}, invoices: {}, expenses: {} };
  for (const t of ['quote', 'invoice', 'expense']) for (const k of await kv.keys(KEY[t])) { const d = await kv.get(k); if (d && d.id) x[GROUP[t]][d.id] = summaryOf(d); }
  await kv.update('acct-index', () => x, () => x);
  return Object.values(x).reduce((a, g) => a + Object.keys(g).length, 0);
}

// ---------- quotes + invoices ----------
function customerFrom(f) { return { name: clean(f.name, 120), email: clean(f.email, 160), phone: clean(f.phone, 40), address: clean(f.address, 300) }; }
function applyFields(d, f) {
  if (f.customer) d.customer = customerFrom(f.customer);
  if (f.items) d.items = cleanItems(f.items);
  if (f.pricesInc != null) d.pricesInc = !!f.pricesInc;
  if (f.title != null) d.title = clean(f.title, 160);
  if (f.notes != null) d.notes = clean(f.notes, 2000);
  if (f.issued && validDate(f.issued)) d.issued = f.issued;
  if (d.type === 'invoice') d.due = validDate(f.due) || (f.issued ? addDays(d.issued, TERMS_DAYS) : d.due || addDays(d.issued, TERMS_DAYS));
  if (d.type === 'quote') d.validUntil = validDate(f.validUntil) || (f.issued ? addDays(d.issued, QUOTE_VALID_DAYS) : d.validUntil || addDays(d.issued, QUOTE_VALID_DAYS));
  if (f.core != null) d.core = clean(f.core, 40);
  d.totals = calc(d.items, d.pricesInc);
  delete d.totals.lines;
  return d;
}
export async function createDoc(type, f, by) {
  const id = await nextNo(type === 'quote' ? 'Q' : 'INV');
  const now = Date.now();
  const d = { id, type, status: 'draft', created: now, issued: today(now), items: [], pricesInc: false, customer: customerFrom({}), notes: '', title: '',
    payments: [], paid: 0, history: [{ at: now, by, text: `${type === 'quote' ? 'Quote' : 'Invoice'} created` }] };
  applyFields(d, f);
  return save(d);
}
export async function updateDoc(id, f, by) {
  const d = await get(id);
  if (!d || d.type === 'expense') return { error: 'Not found' };
  if (d.type === 'quote' && d.invoiceId) return { error: `This quote has been invoiced as ${d.invoiceId}, so it can't be changed. Edit the invoice instead.` };
  if (['paid', 'void'].includes(d.status) || (d.type === 'invoice' && d.paid > 0)) return { error: `This ${d.type} is ${d.paid > 0 && d.status !== 'paid' ? 'part-paid' : d.status} and can't be changed. Void it and make a new one.` };
  applyFields(d, f);
  d.history.push({ at: Date.now(), by, text: 'Edited' });
  return { doc: await save(d) };
}
export async function setStatus(id, status, by, note = '') {
  const d = await get(id);
  if (!d) return { error: 'Not found' };
  const allowed = d.type === 'quote' ? ['draft', 'sent', 'accepted', 'declined', 'void'] : ['draft', 'sent', 'void'];
  if (!allowed.includes(status)) return { error: 'Not allowed' };
  if (d.type === 'invoice' && status === 'void' && d.paid > 0) return { error: 'This invoice has payments. Remove them first.' };
  d.status = status;
  if (status === 'sent') d.sentAt = Date.now();
  if (status === 'accepted' && !d.acceptedAt) d.acceptedAt = Date.now();
  d.history.push({ at: Date.now(), by, text: ({ sent: 'Sent', accepted: 'Accepted by the customer', declined: 'Declined', void: 'Voided', draft: 'Back to draft' })[status] + (note ? ': ' + note : '') });
  return { doc: await save(d) };
}
// link a quote/invoice to its project plan (a frozen copy for the PDF; see plan-quote.mjs)
export async function setPlan(id, plan, by, note) {
  const d = await get(id);
  if (!d || d.type === 'expense') return null;
  d.plan = plan;
  if (note) d.history.push({ at: Date.now(), by, text: note });
  return save(d);
}
export async function quoteToInvoice(qid, by) {
  const q = await get(qid);
  if (!q || q.type !== 'quote') return { error: 'Quote not found' };
  if (q.invoiceId) return { error: `Already invoiced as ${q.invoiceId}` };
  const inv = await createDoc('invoice', { customer: q.customer, items: q.items, pricesInc: q.pricesInc, title: q.title, notes: '', core: q.core }, by);
  inv.fromQuote = q.id; if (q.plan) inv.plan = { ...q.plan, fromQuote: q.id }; inv.history.push({ at: Date.now(), by, text: `Made from quote ${q.id}` }); await save(inv);
  q.invoiceId = inv.id; if (q.status === 'sent' || q.status === 'draft') q.status = 'accepted'; if (!q.acceptedAt) q.acceptedAt = Date.now();
  q.history.push({ at: Date.now(), by, text: `Invoiced as ${inv.id}` }); await save(q);
  return { doc: inv, quote: q };
}
export async function addPayment(id, p, by) {
  const d = await get(id);
  if (!d || d.type !== 'invoice') return { error: 'Invoice not found' };
  if (d.status === 'void') return { error: 'This invoice is void' };
  const amount = r2(p.amount);
  if (!(amount > 0)) return { error: 'Enter the amount received' };
  const balance = r2(d.totals.inc - (d.paid || 0));
  if (amount > balance + 0.005) return { error: `That's more than the ${money(balance)} still owing` };
  const pay = { id: (d.payments.reduce((a, x) => Math.max(a, x.id || 0), 0) + 1), date: validDate(p.date) || today(), amount, method: PAY_METHODS.includes(p.method) ? p.method : 'Bank transfer', ref: clean(p.ref, 120), by, at: Date.now() };
  d.payments.push(pay);
  d.paid = r2(d.payments.reduce((a, x) => a + x.amount, 0));
  d.status = d.paid >= d.totals.inc - 0.005 ? 'paid' : 'part-paid';
  if (d.status === 'part-paid' && !d.sentAt) d.sentAt = Date.now();
  d.history.push({ at: Date.now(), by, text: `Payment ${money(amount)} received (${pay.method})${d.status === 'paid' ? ': paid in full' : `: ${money(d.totals.inc - d.paid)} still owing`}` });
  return { doc: await save(d), fullyPaid: d.status === 'paid' };
}
export async function removePayment(id, payId, by) {
  const d = await get(id);
  if (!d || d.type !== 'invoice') return { error: 'Invoice not found' };
  const p = d.payments.find((x) => x.id === Number(payId));
  if (!p) return { error: 'Payment not found' };
  d.payments = d.payments.filter((x) => x !== p);
  d.paid = r2(d.payments.reduce((a, x) => a + x.amount, 0));
  d.status = d.paid > 0 ? 'part-paid' : (d.sentAt ? 'sent' : 'draft');
  d.history.push({ at: Date.now(), by, text: `Payment of ${money(p.amount)} removed` });
  return { doc: await save(d) };
}
export function effectiveStatus(d, now = Date.now()) {   // adds "overdue" / "expired" for display
  if (d.type === 'invoice' && ['sent', 'part-paid'].includes(d.status) && d.due && ymdToMs(d.due, true) < now) return 'overdue';
  if (d.type === 'quote' && d.status === 'sent' && d.validUntil && ymdToMs(d.validUntil, true) < now) return 'expired';
  return d.status;
}

// ---------- expenses ----------
export async function saveExpense(f, by, id = null) {
  let d = id ? await get(id) : null;
  if (id && !d) return { error: 'Expense not found' };
  if (!d) { const now = Date.now(); d = { id: await nextNo('EXP'), type: 'expense', created: now, history: [{ at: now, by, text: 'Expense recorded' }] }; }
  else d.history.push({ at: Date.now(), by, text: 'Edited' });
  d.date = validDate(f.date) || d.date || today();
  d.supplier = clean(f.supplier, 120); d.desc = clean(f.desc, 400);
  d.category = EXPENSE_CATEGORIES.includes(f.category) ? f.category : 'Other';
  d.inc = r2(f.inc);
  if (!(d.inc > 0)) return { error: 'Enter the amount paid (inc GST)' };
  d.gstIncluded = f.gstIncluded !== false;
  d.gst = d.gstIncluded ? (f.gst != null && f.gst !== '' ? Math.min(r2(f.gst), r2(d.inc / 11)) : r2(d.inc / 11)) : 0;
  d.ex = r2(d.inc - d.gst);
  d.core = clean(f.core, 40);
  return { doc: await save(d) };
}
export async function attachReceipt(id, buf, type, by) {
  const d = await get(id);
  if (!d || d.type !== 'expense') return { error: 'Expense not found' };
  await kv.putFile('receipt:' + id, buf, { type, by, at: Date.now() });
  d.receipt = { type, at: Date.now() };
  d.history.push({ at: Date.now(), by, text: 'Receipt attached' });
  return { doc: await save(d) };
}

// ---------- reports ----------
// basis "cash": income when payments arrive (GST in the payment) · "accrual": income when invoices are issued
export async function allDocs() {
  const out = { quotes: [], invoices: [], expenses: [] };
  await Promise.all(['quote', 'invoice', 'expense'].map(async (t) => { for (const d of await kv.getMany(await kv.keys(KEY[t]))) if (d) out[GROUP[t]].push(d); }));
  for (const g of Object.keys(out)) out[g].sort((a, b) => (a.id > b.id ? 1 : -1));
  return out;
}
const inRange = (ymd, from, to) => ymd && ymd >= from && ymd <= to;
export function profitAndLoss(data, from, to, basis = 'cash') {
  const income = { inc: 0, gst: 0, ex: 0, count: 0 };
  for (const inv of data.invoices) {
    if (inv.status === 'void' || inv.status === 'draft') continue;
    if (basis === 'accrual') {
      if (inRange(inv.issued, from, to)) { income.inc += inv.totals.inc; income.gst += inv.totals.gst; income.ex += inv.totals.ex; income.count++; }
    } else {
      for (const p of inv.payments || []) if (inRange(p.date, from, to)) {
        const share = inv.totals.inc ? p.amount / inv.totals.inc : 0;   // GST in a payment is in proportion to the invoice
        income.inc += p.amount; income.gst += inv.totals.gst * share; income.ex += inv.totals.ex * share; income.count++;
      }
    }
  }
  const byCat = {};
  const exp = { inc: 0, gst: 0, ex: 0, count: 0 };
  for (const e of data.expenses) if (inRange(e.date, from, to)) {
    exp.inc += e.inc; exp.gst += e.gst; exp.ex += e.ex; exp.count++;
    byCat[e.category] = r2((byCat[e.category] || 0) + e.ex);
  }
  for (const o of [income, exp]) for (const k of ['inc', 'gst', 'ex']) o[k] = r2(o[k]);
  return { from, to, basis, income, expenses: exp, byCategory: byCat, profit: r2(income.ex - exp.ex) };
}
export function quarterOf(ymd) {   // Australian BAS quarters: Jul-Sep, Oct-Dec, Jan-Mar, Apr-Jun
  const [y, m] = ymd.split('-').map(Number), q = Math.floor((m - 1) / 3);
  const start = `${y}-${String(q * 3 + 1).padStart(2, '0')}-01`;
  const endMonth = q * 3 + 3, last = new Date(Date.UTC(y, endMonth, 0)).getUTCDate();
  const fyQ = { 0: 3, 1: 4, 2: 1, 3: 2 }[q], fy = m >= 7 ? y + 1 : y;
  return { from: start, to: `${y}-${String(endMonth).padStart(2, '0')}-${last}`, name: `Q${fyQ} FY${String(fy - 1).slice(2)}/${String(fy).slice(2)} (${['Jan–Mar', 'Apr–Jun', 'Jul–Sep', 'Oct–Dec'][q]} ${y})` };
}
export function bas(data, from, to, basis = 'cash') {
  const pl = profitAndLoss(data, from, to, basis);
  return { from, to, basis, G1: r2(pl.income.inc), '1A': r2(pl.income.gst), G11: r2(pl.expenses.inc), '1B': r2(pl.expenses.gst), net: r2(pl.income.gst - pl.expenses.gst) };
}
export function receivables(data, now = Date.now()) {
  const buckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90: 0 };
  const rows = [];
  for (const inv of data.invoices) {
    if (!['sent', 'part-paid'].includes(inv.status)) continue;
    const bal = r2(inv.totals.inc - (inv.paid || 0)); if (bal <= 0) continue;
    const late = inv.due ? Math.floor((now - ymdToMs(inv.due, true)) / 86400000) : 0;
    const b = late <= 0 ? 'current' : late <= 30 ? 'd1_30' : late <= 60 ? 'd31_60' : late <= 90 ? 'd61_90' : 'd90';
    buckets[b] = r2(buckets[b] + bal);
    rows.push({ id: inv.id, name: inv.customer.name, due: inv.due, balance: bal, daysLate: Math.max(0, late), core: inv.core || '' });
  }
  return { buckets, total: r2(Object.values(buckets).reduce((a, x) => a + x, 0)), rows: rows.sort((a, b) => b.daysLate - a.daysLate) };
}
export function jobProfit(data) {
  const by = {};
  const row = (core) => (by[core] = by[core] || { core, invoiced: 0, received: 0, costs: 0 });
  for (const inv of data.invoices) if (inv.core && !['void', 'draft'].includes(inv.status)) { const r = row(inv.core); r.invoiced = r2(r.invoiced + inv.totals.ex); r.received = r2(r.received + (inv.totals.inc ? inv.paid * inv.totals.ex / inv.totals.inc : 0)); }
  for (const e of data.expenses) if (e.core) { const r = row(e.core); r.costs = r2(r.costs + e.ex); }
  return Object.values(by).map((r) => ({ ...r, profit: r2(r.invoiced - r.costs), margin: r.invoiced ? Math.round((r.invoiced - r.costs) / r.invoiced * 100) : null })).sort((a, b) => b.invoiced - a.invoiced);
}
// CSV for the accountant
export function csv(rows, cols) {
  const cell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return '﻿' + [cols.map((c) => c[0]), ...rows.map((r) => cols.map((c) => (typeof c[1] === 'function' ? c[1](r) : r[c[1]])))].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
