// Console accounting actions (quotes, invoices, payments, expenses, BAS). Called from functions/admin.mjs after login.
import { env, escapeHtml, sendEmail } from './shared.mjs';
import * as J from './jobs.mjs';
import * as ACC from './accounts.mjs';
import * as kv from './kv.mjs';
import { buildPdf, business } from './pdf.mjs';
import { audit, deleteKeys, LIVE } from './admin-lib.mjs';

const H = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const out = (status, body) => new Response(JSON.stringify(body), { status, headers: H });
const bad = (msg, status = 400) => out(status, { error: msg });
const res = (r) => (r.error ? bad(r.error, /not found/i.test(r.error) ? 404 : 400) : null);
const withStatus = (d) => (d ? { ...d, shown: ACC.effectiveStatus(d), lines: d.type === 'expense' ? undefined : ACC.calc(d.items || [], d.pricesInc).lines } : d);

// keep the job pipeline (dashboard + Telegram) in step with the paperwork
async function syncJob(doc, event, by) {
  if (!doc.core) return;
  const job = await J.find(doc.core);
  if (!job) return;
  const s = job.stage;
  if (event === 'quote-sent' && ['new', 'called'].includes(s)) await J.setStage(job.core, 'quoted', by, { amount: doc.totals.inc });
  if (event === 'quote-accepted' && ['new', 'called', 'quoted'].includes(s)) await J.setStage(job.core, 'won', by);
  if (event === 'invoice-sent' && !['invoiced', 'paid', 'lost'].includes(s)) await J.setStage(job.core, 'invoiced', by, { amount: doc.totals.inc });
  if (event === 'invoice-paid' && ['invoiced', 'completed', 'won'].includes(s)) await J.setStage(job.core, 'paid', by);
}

function emailHtml(doc, message) {
  const B = business(), isInv = doc.type === 'invoice', bal = ACC.money(doc.totals.inc - (doc.paid || 0));
  const p = (s) => `<p style="font-family:Arial,sans-serif;font-size:15px;line-height:1.55;color:#1a1a1a;margin:0 0 14px">${s}</p>`;
  const msg = String(message || '').trim();
  return `<div style="max-width:600px">` +
    p(`Hi ${escapeHtml((doc.customer.name || '').split(' ')[0] || 'there')},`) +
    (msg ? p(escapeHtml(msg).replace(/\n/g, '<br>')) : p(isInv ? `Please find attached tax invoice <b>${doc.id}</b> for ${bal}, due ${ACC.prettyDate(doc.due)}.` : `Thanks for the opportunity. Please find attached our quote <b>${doc.id}</b> for ${ACC.money(doc.totals.inc)} (inc GST), valid until ${ACC.prettyDate(doc.validUntil)}.`)) +
    (isInv && B.bsb && B.account ? p(`<b>Bank transfer:</b> ${escapeHtml(B.bankName || B.name)} · BSB ${escapeHtml(B.bsb)} · Account ${escapeHtml(B.account)} · Reference <b>${doc.id}</b>`) : '') +
    (!isInv ? p(`To go ahead, just reply to this email or call ${escapeHtml(B.phone)}.`) : '') +
    p(`Kind regards,<br><b>${escapeHtml(B.name)}</b><br>${escapeHtml(B.phone)} · <a href="https://${escapeHtml(B.web)}">${escapeHtml(B.web)}</a><br><span style="color:#777;font-size:13px">ABN ${escapeHtml(B.abn)} · Builder licence ${escapeHtml(B.licence)}</span>`) +
    `</div>`;
}

export async function acctGet(action, url) {
  if (action === 'pdf') {
    const d = await ACC.get(url.searchParams.get('id') || '');
    if (!d || d.type === 'expense') return bad('Not found', 404);
    const bytes = await buildPdf(d);
    return new Response(bytes, { status: 200, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `${url.searchParams.get('download') ? 'attachment' : 'inline'}; filename="${d.id}.pdf"`, 'Cache-Control': 'no-store' } });
  }
  if (action === 'receipt') {
    const f = await kv.getFile('receipt:' + (url.searchParams.get('id') || ''));
    return f ? new Response(f.buf, { status: 200, headers: { 'Content-Type': f.metadata.type || 'application/octet-stream', 'Cache-Control': 'private, max-age=600' } }) : bad('Not found', 404);
  }
  if (action === 'acctExport') {
    const what = url.searchParams.get('what'), from = url.searchParams.get('from') || '2000-01-01', to = url.searchParams.get('to') || '2999-12-31';
    const data = await ACC.allDocs();
    const inR = (d) => d && d >= from && d <= to;
    let body = '', name = what;
    if (what === 'invoices') body = ACC.csv(data.invoices.filter((i) => inR(i.issued)).sort((a, b) => (a.id > b.id ? 1 : -1)), [['Invoice', 'id'], ['Date', 'issued'], ['Due', 'due'], ['Customer', (r) => r.customer.name], ['Job', 'core'], ['Status', (r) => ACC.effectiveStatus(r)],
      ['Ex GST', (r) => r.totals.ex], ['GST', (r) => r.totals.gst], ['Inc GST', (r) => r.totals.inc], ['Paid', (r) => r.paid || 0], ['Balance', (r) => Math.round((r.totals.inc - (r.paid || 0)) * 100) / 100]]);
    else if (what === 'payments') {
      const rows = []; for (const i of data.invoices) for (const p of i.payments || []) if (inR(p.date)) rows.push({ ...p, invoice: i.id, customer: i.customer.name, gst: i.totals.inc ? Math.round(p.amount * i.totals.gst / i.totals.inc * 100) / 100 : 0 });
      body = ACC.csv(rows.sort((a, b) => (a.date > b.date ? 1 : -1)), [['Date', 'date'], ['Invoice', 'invoice'], ['Customer', 'customer'], ['Amount', 'amount'], ['GST in payment', 'gst'], ['Method', 'method'], ['Reference', 'ref']]);
    } else if (what === 'expenses') body = ACC.csv(data.expenses.filter((e) => inR(e.date)).sort((a, b) => (a.date > b.date ? 1 : -1)), [['Expense', 'id'], ['Date', 'date'], ['Supplier', 'supplier'], ['Description', 'desc'], ['Category', 'category'], ['Job', 'core'],
      ['Ex GST', 'ex'], ['GST', 'gst'], ['Inc GST', 'inc'], ['Receipt', (r) => (r.receipt ? 'yes' : '')]]);
    else return bad('Unknown export', 404);
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="mbs-${name}-${from}-to-${to}.csv"`.replace('2000-01-01-to-2999-12-31', 'all'), 'Cache-Control': 'no-store' } });
  }
  return null;
}

export async function acctPost(action, body, { who, by }) {
  switch (action) {
    case 'acctLists': {
      const x = await ACC.index(), now = Date.now();
      const show = (s) => ({ ...s, shown: s.type === 'invoice' && ['sent', 'part-paid'].includes(s.status) && s.due && ACC.ymdToMs(s.due, true) < now ? 'overdue'
        : s.type === 'quote' && s.status === 'sent' && s.validUntil && ACC.ymdToMs(s.validUntil, true) < now ? 'expired' : s.status });
      const sort = (o) => Object.values(o).sort((a, b) => (b.id > a.id ? 1 : -1)).map(show);
      return out(200, { quotes: sort(x.quotes), invoices: sort(x.invoices), expenses: Object.values(x.expenses).sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : b.id > a.id ? 1 : -1)),
        categories: ACC.EXPENSE_CATEGORIES, methods: ACC.PAY_METHODS, bank: !!(env('BANK_BSB') && env('BANK_ACCOUNT_NUMBER')) });
    }
    case 'docGet': {
      const d = await ACC.get(String(body.id || ''));
      if (!d) return bad('Not found', 404);
      return out(200, { doc: withStatus(d), categories: ACC.EXPENSE_CATEGORIES, methods: ACC.PAY_METHODS, bank: !!(env('BANK_BSB') && env('BANK_ACCOUNT_NUMBER')) });
    }
    case 'docForJob': {   // everything linked to one job
      const x = await ACC.index(), core = String(body.core || '');
      const pick = (o) => Object.values(o).filter((d) => d.core === core);
      return out(200, { quotes: pick(x.quotes), invoices: pick(x.invoices), expenses: pick(x.expenses) });
    }
    case 'docCreate': {
      const type = body.type === 'invoice' ? 'invoice' : 'quote';
      const f = { ...body.fields };
      if (body.core && !f.customer) {
        const job = await J.find(body.core);
        if (job) { f.core = job.core; f.customer = { name: job.name, email: job.email, phone: job.phone, address: job.suburb }; f.title = f.title || job.service; }
      }
      const d = await ACC.createDoc(type, f, by);
      await audit(who, `${d.id} created${d.core ? ' for ' + d.core : ''}`);
      return out(200, { doc: withStatus(d) });
    }
    case 'docUpdate': {
      const r = await ACC.updateDoc(String(body.id || ''), body.fields || {}, by);
      return res(r) || out(200, { doc: withStatus(r.doc) });
    }
    case 'docStatus': {
      const r = await ACC.setStatus(String(body.id || ''), String(body.status || ''), by, String(body.note || '').slice(0, 200));
      if (r.error) return res(r);
      const d = r.doc;
      if (body.status === 'sent') await syncJob(d, d.type + '-sent', by);
      if (body.status === 'accepted') await syncJob(d, 'quote-accepted', by);
      await audit(who, `${d.id}: ${body.status}`);
      return out(200, { doc: withStatus(d) });
    }
    case 'docToInvoice': {
      const r = await ACC.quoteToInvoice(String(body.id || ''), by);
      if (r.error) return res(r);
      await syncJob(r.quote, 'quote-accepted', by);
      await audit(who, `${r.quote.id} → invoice ${r.doc.id}`);
      return out(200, { doc: withStatus(r.doc) });
    }
    case 'docSend': {
      const d = await ACC.get(String(body.id || ''));
      if (!d || d.type === 'expense') return bad('Not found', 404);
      if (d.status === 'void') return bad('This document is void');
      if (!d.items.length) return bad('Add at least one line first');
      const to = String(body.to || d.customer.email || '').trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return bad('Enter the customer\'s email address');
      const pdf = Buffer.from(await buildPdf(d));
      const B = business();
      const subject = `${d.type === 'invoice' ? 'Tax invoice' : 'Quote'} ${d.id} from ${B.name}`;
      const owner = env('OWNER_EMAIL').split(',')[0].trim();
      const r = await sendEmail({ to, subject, html: emailHtml(d, body.message), replyTo: env('PUBLIC_CONTACT_EMAIL', B.email), bcc: body.copyMe !== false && owner ? owner : '',
        attachments: [{ filename: `${d.id}.pdf`, content: pdf.toString('base64') }] });
      if (!r.ok) return bad('Email not sent: ' + (r.reason || 'unknown error'), 502);
      if (d.customer.email !== to) { d.customer.email = to; }
      const s = await ACC.setStatus(d.id, d.type === 'invoice' && ['part-paid', 'paid'].includes(d.status) ? d.status : (d.type === 'quote' && ['accepted', 'declined'].includes(d.status) ? d.status : 'sent'), by, `emailed to ${to}`);
      const doc = s.doc || d;
      await syncJob(doc, doc.type + '-sent', by);
      await audit(who, `${d.id} emailed to ${to}`);
      return out(200, { doc: withStatus(doc), to });
    }
    case 'docDelete': {   // drafts only; anything already sent is voided instead (keeps the numbering honest)
      const d = await ACC.get(String(body.id || ''));
      if (!d) return bad('Not found', 404);
      if (d.type !== 'expense' && d.status !== 'draft') return bad('Only drafts can be deleted. Void it instead.');
      await deleteKeys(LIVE, [({ quote: 'quote:', invoice: 'invoice:', expense: 'expense:' })[d.type] + d.id]);
      await audit(who, `${d.id} deleted`);
      return out(200, { ok: true });
    }
    case 'payAdd': {
      const r = await ACC.addPayment(String(body.id || ''), body, by);
      if (r.error) return res(r);
      if (r.fullyPaid) await syncJob(r.doc, 'invoice-paid', by);
      await audit(who, `${r.doc.id}: payment ${ACC.money(body.amount)}`);
      return out(200, { doc: withStatus(r.doc) });
    }
    case 'payRemove': {
      const r = await ACC.removePayment(String(body.id || ''), body.payId, by);
      if (r.error) return res(r);
      await audit(who, `${r.doc.id}: payment removed`);
      return out(200, { doc: withStatus(r.doc) });
    }
    case 'expSave': {
      const r = await ACC.saveExpense(body.fields || {}, by, body.id || null);
      if (r.error) return res(r);
      let d = r.doc;
      if (body.receipt && typeof body.receipt === 'string') {
        const m = body.receipt.match(/^data:(image\/(?:jpeg|png|webp)|application\/pdf);base64,(.+)$/);
        if (!m) return bad('The receipt must be a photo or a PDF');
        const buf = Buffer.from(m[2], 'base64');
        if (buf.length > 5 * 1024 * 1024) return bad('The receipt file is too big (max 5 MB)');
        d = (await ACC.attachReceipt(d.id, buf, m[1], by)).doc;
      }
      await audit(who, `${d.id} ${body.id ? 'updated' : 'recorded'}: ${ACC.money(d.inc)} ${d.supplier}`);
      return out(200, { doc: d });
    }
    case 'acctReport': {
      const valid = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
      if (!valid(body.from) || !valid(body.to)) return bad('Pick a date range');
      const basis = body.basis === 'accrual' ? 'accrual' : 'cash';
      const data = await ACC.allDocs();
      const jobs = Object.fromEntries((await J.all()).map((j) => [j.core, j]));
      return out(200, { pnl: ACC.profitAndLoss(data, body.from, body.to, basis), bas: ACC.bas(data, body.from, body.to, basis), receivables: ACC.receivables(data),
        jobs: ACC.jobProfit(data).map((r) => ({ ...r, ref: jobs[r.core] ? jobs[r.core].ref : r.core, name: jobs[r.core] ? jobs[r.core].name : '' })), today: ACC.today() });
    }
    case 'acctRebuild': {
      const n = await ACC.rebuildIndex();
      await audit(who, `Rebuilt the accounts list (${n} records)`);
      return out(200, { records: n });
    }
    default: return null;
  }
}
