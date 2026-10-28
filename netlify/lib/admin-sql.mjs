// SQL wizard support: read-only tables for the browser (queries run in the browser, nothing can be changed),
// an AI-written narrative (DeepSeek) and a PDF report.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { env, stripThinking } from './shared.mjs';
import * as kv from './kv.mjs';
import * as J from './jobs.mjs';
import * as ACC from './accounts.mjs';
import { parts } from './calendar.mjs';
import LOGO from './logo-png.mjs';
import { business } from './pdf.mjs';
import * as PLAN from './plan.mjs';

const H = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const out = (status, body) => new Response(JSON.stringify(body), { status, headers: H });
const bad = (msg, status = 400) => out(status, { error: msg });
const d10 = (ms) => { if (!ms) return ''; const p = parts(ms); return `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; };
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// ---------- the tables (one row per record, plain columns) ----------
export const SCHEMA = {
  jobs: ['ref', 'core', 'stage', 'name', 'phone', 'email', 'suburb', 'service', 'trade', 'source', 'best_time', 'created', 'created_month', 'quote_inc', 'invoice_inc',
    'called_date', 'quoted_date', 'won_date', 'completed_date', 'invoiced_date', 'paid_date', 'lost_date', 'lost_reason', 'photos', 'notes'],
  quotes: ['id', 'job', 'customer', 'status', 'issued', 'issued_month', 'valid_until', 'ex', 'gst', 'inc', 'invoice_id'],
  invoices: ['id', 'job', 'customer', 'status', 'issued', 'issued_month', 'due', 'ex', 'gst', 'inc', 'paid', 'balance', 'days_overdue', 'from_quote'],
  items: ['doc_id', 'doc_type', 'line', 'description', 'qty', 'price', 'gst_free', 'ex', 'gst', 'inc'],
  payments: ['invoice_id', 'customer', 'date', 'month', 'amount', 'gst', 'method', 'reference'],
  expenses: ['id', 'date', 'month', 'supplier', 'description', 'category', 'job', 'ex', 'gst', 'inc', 'has_receipt'],
  reminders: ['id', 'due', 'date', 'text', 'job'],
  visits: ['date', 'month', 'visits'],
  plan_tasks: ['job', 'plan', 'phase', 'task', 'resource', 'start', 'finish', 'days', 'qty', 'unit', 'unit_cost', 'planned_cost', 'actual_cost', 'pct_complete', 'done', 'late'],
  plan_risks: ['job', 'plan', 'risk', 'probability', 'impact', 'score', 'response', 'owner', 'status', 'review'],
  plan_issues: ['job', 'plan', 'issue', 'priority', 'owner', 'raised', 'due', 'status']
};
export const DESCRIBE = {
  jobs: 'Every enquiry and job (pipeline stage, customer, suburb, trade, values)', quotes: 'Quotes (status, totals ex/inc GST)', invoices: 'Tax invoices (paid, balance, days overdue)',
  items: 'Line items of quotes and invoices', plan_tasks: 'Project plan tasks (dates, costs, % complete)', plan_risks: 'Risk registers of all plans', plan_issues: 'Issue logs of all plans', payments: 'Payments received', expenses: 'Expenses and receipts', reminders: 'Call-backs and follow-ups', visits: 'Website visitors per day'
};

export async function tables() {
  const now = Date.now();
  const jobs = [];
  for (const k of await kv.keys('job:')) {
    const j = await kv.get(k); if (!j) continue;
    jobs.push({ ref: J.refFor(j), core: j.core, stage: j.stage, name: j.name || '', phone: j.phone || '', email: j.email || '', suburb: j.suburb || '', service: j.service || '',
      trade: j.trade || (j.core || '')[0] || '', source: j.source || '', best_time: j.best_time || '', created: d10(j.created), created_month: d10(j.created).slice(0, 7),
      quote_inc: j.quote ? r2(j.quote.amount) : null, invoice_inc: j.invoice ? r2(j.invoice.amount) : null,
      called_date: d10(j.called_at), quoted_date: d10(j.quoted_at), won_date: d10(j.won_at), completed_date: d10(j.completed_at), invoiced_date: d10(j.invoiced_at),
      paid_date: d10(j.paid_at), lost_date: d10(j.lost_at), lost_reason: j.lost_reason || '', photos: (j.photos || []).length, notes: (j.notes || []).length });
  }
  const data = await ACC.allDocs();
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
  const reminders = (await J.reminders()).map((r) => ({ id: r.id, due: new Date(r.at).toISOString(), date: d10(r.at), text: r.text, job: r.core || '' }));
  let visits = [];
  try {
    const { getStore } = await import('@netlify/blobs');
    const v = await getStore({ name: 'mbs-visits', consistency: 'strong' }).get('count', { type: 'json' });
    visits = Object.entries((v && v.days) || {}).map(([date, n]) => ({ date, month: date.slice(0, 7), visits: n })).sort((a, b) => (a.date > b.date ? 1 : -1));
  } catch {}
  const plan_tasks = [], plan_risks = [], plan_issues = [];
  const todayS = d10(now);
  for (const p of await PLAN.list()) {
    PLAN.schedule(p);
    const ph = Object.fromEntries(p.phases.map((f) => [f.id, f.name]));
    for (const t of p.tasks) plan_tasks.push({ job: p.core, plan: p.name, phase: ph[t.phase] || '', task: t.name, resource: t.resource, start: t.es, finish: t.ef, days: t.dur, qty: t.qty, unit: t.unit,
      unit_cost: t.rate, planned_cost: r2(t.qty * t.rate), actual_cost: t.actual, pct_complete: t.pct, done: t.pct >= 100, late: t.pct < 100 && t.ef < todayS });
    for (const r of p.risks || []) plan_risks.push({ job: p.core, plan: p.name, risk: r.title, probability: r.p, impact: r.i, score: r.p * r.i, response: r.response, owner: r.owner, status: r.status, review: r.review });
    for (const x of p.issues || []) plan_issues.push({ job: p.core, plan: p.name, issue: x.title, priority: x.priority, owner: x.owner, raised: x.raised, due: x.due, status: x.status });
  }
  return { jobs, quotes, invoices, items, payments, expenses, reminders, visits, plan_tasks, plan_risks, plan_issues };
}

// ---------- AI narrative (DeepSeek) ----------
// Contact details never leave MBS: phone, email, address and personal-name columns are removed before the AI sees anything.
const PRIVATE = /phone|email|address|^name$|customer|reference/i;
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

// ---------- the PDF ----------
const safe = (s) => String(s ?? '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—−]/g, '-').replace(/…/g, '...')
  .replace(/[•·]/g, '-').replace(/ /g, ' ').replace(/[\r\t]/g, ' ').replace(/[^\n\x20-\x7E\xA0-\xFF]/g, '');
export async function reportPdf({ title, summary, insights, recommendations, sql, columns, rows, chart, by, ai }) {
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
  if (action === 'sqlData') return out(200, { schema: SCHEMA, describe: DESCRIBE, data: await tables() });
  if (action === 'sqlNarrative') {
    const columns = (Array.isArray(body.columns) ? body.columns : []).map(String).slice(0, 40), rows = Array.isArray(body.rows) ? body.rows.slice(0, 200) : [];
    return out(200, await narrative({ title: String(body.title || 'Report').slice(0, 120), sql: String(body.sql || '').slice(0, 3000), columns, rows, focus: String(body.focus || '').slice(0, 400) }));
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
