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
  plan_tasks: ['job', 'plan_name', 'task', 'resource', 'lead', 'status', 'start', 'finish', 'days', 'qty', 'unit', 'unit_cost', 'planned_cost', 'actual_cost', 'pct_complete', 'done', 'late'],
  plan_risks: ['job', 'plan_name', 'risk', 'probability', 'impact', 'score', 'response', 'owner', 'status', 'review'],
  plan_issues: ['job', 'plan_name', 'issue', 'priority', 'owner', 'raised', 'due', 'status']
};
export const DESCRIBE = {
  jobs: 'Every enquiry and job (pipeline stage, customer, suburb, trade, values)', quotes: 'Quotes (status, totals ex/inc GST)', invoices: 'Tax invoices (paid, balance, days overdue)',
  items: 'Line items of quotes and invoices', plan_tasks: 'Project plan tasks (dates, costs, % complete)', plan_risks: 'Risk registers of all plans', plan_issues: 'Issue logs of all plans', payments: 'Payments received', expenses: 'Expenses and receipts', reminders: 'Call-backs and follow-ups', visits: 'Website visitors per day'
};

export async function tables() {
  const now = Date.now();
  const jobs = [];
  const [jobRecs, data, remList, visitRec, planList] = await Promise.all([
    kv.keys('job:').then((ks) => kv.getMany(ks)), ACC.allDocs(), J.reminders(),
    import('@netlify/blobs').then(({ getStore }) => getStore({ name: 'mbs-visits', consistency: 'strong' }).get('count', { type: 'json' })).catch(() => null),
    PLAN.list()]);
  for (const j of jobRecs) {
    if (!j) continue;
    jobs.push({ ref: J.refFor(j), core: j.core, stage: j.stage, name: j.name || '', phone: j.phone || '', email: j.email || '', suburb: j.suburb || '', service: j.service || '',
      trade: j.trade || (j.core || '')[0] || '', source: j.source || '', best_time: j.best_time || '', created: d10(j.created), created_month: d10(j.created).slice(0, 7),
      quote_inc: j.quote ? r2(j.quote.amount) : null, invoice_inc: j.invoice ? r2(j.invoice.amount) : null,
      called_date: d10(j.called_at), quoted_date: d10(j.quoted_at), won_date: d10(j.won_at), completed_date: d10(j.completed_at), invoiced_date: d10(j.invoiced_at),
      paid_date: d10(j.paid_at), lost_date: d10(j.lost_at), lost_reason: j.lost_reason || '', photos: (j.photos || []).length, notes: (j.notes || []).length });
  }
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
  const plan_tasks = [], plan_risks = [], plan_issues = [];
  const todayS = d10(now);
  for (const p of planList) {
    PLAN.schedule(p);
    const STN = { todo: 'To do', doing: 'In progress', review: 'In review / QA', done: 'Done' };
    for (const t of p.tasks) plan_tasks.push({ job: p.core, plan_name: p.name, task: t.name, resource: t.resource || '', lead: t.lead || '', status: STN[t.status] || (t.pct >= 100 ? 'Done' : t.pct > 0 ? 'In progress' : 'To do'), start: t.es, finish: t.ef, days: t.dur, qty: t.qty, unit: t.unit,
      unit_cost: t.rate, planned_cost: r2(t.qty * t.rate), actual_cost: t.actual, pct_complete: t.pct, done: t.pct >= 100, late: t.pct < 100 && t.ef < todayS });
    for (const r of p.risks || []) plan_risks.push({ job: p.core, plan_name: p.name, risk: r.title, probability: r.p, impact: r.i, score: r.p * r.i, response: r.response, owner: r.owner, status: r.status, review: r.review });
    for (const x of p.issues || []) plan_issues.push({ job: p.core, plan_name: p.name, issue: x.title, priority: x.priority, owner: x.owner, raised: x.raised, due: x.due, status: x.status });
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

// ---------- AI query: a plain-English question -> SQL (the AI writes it) -> run in the browser -> a plain-English answer ----------
// The AI never sees the data rows when writing SQL: only table and column names, the dates for "this month" etc.,
// and short lists of codes (stages, statuses, plan names, suburbs). Phone numbers, emails and names are never sent.
function llmSetup() {
  const key = env('LLM_API_KEY');
  if (!key) return null;
  const base = env('LLM_BASE_URL', 'https://api.deepseek.com').replace(/\/+$/, '');
  let model = env('LLM_MODEL', 'deepseek-chat'); if (/reasoner|thinking/i.test(model)) model = 'deepseek-chat';
  return { key, base, model };
}
async function llmJson(messages, { maxTokens = 700, timeoutMs = 25000, temperature = 0.1 } = {}) {
  const L = llmSetup();
  if (!L) { const e = new Error('AI is not set up yet: add LLM_API_KEY (DeepSeek) in Netlify.'); e.code = 503; throw e; }
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(`${L.base}/chat/completions`, { method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${L.key}` },
      body: JSON.stringify({ model: L.model, temperature, stream: false, max_tokens: maxTokens, response_format: { type: 'json_object' }, messages }) });
    if (!r.ok) throw new Error('DeepSeek error ' + r.status);
    const j = await r.json();
    const txt = stripThinking(j?.choices?.[0]?.message?.content ?? '').replace(/^```(?:json)?\s*|\s*```$/g, '');
    return JSON.parse(txt);
  } catch (e) {
    if (e.code) throw e;
    throw new Error(/abort/i.test(e.message) ? 'The AI took too long to answer. Try again, or ask a shorter question.' : 'The AI could not be reached (' + e.message + ').');
  } finally { clearTimeout(timer); }
}

const NOTES = {
  jobs: 'one row per enquiry/job. ref = job number staff see (P... = enquiry, no letter = quoted, J... = job won or later); core = stable job id used to join other tables; stage = pipeline stage; name = customer; suburb; service = the work asked for; trade = trade letter; source = how it came in; created = date the enquiry arrived; created_month = YYYY-MM; quote_inc / invoice_inc = $ inc GST; called_date, quoted_date, won_date, completed_date, invoiced_date, paid_date, lost_date = date it reached that stage (blank if not); lost_reason; photos and notes = how many',
  quotes: 'one row per quote. id (Q-...); job = jobs.core; customer; status; issued = date; issued_month; valid_until; ex / gst / inc = dollars ex GST, GST, inc GST; invoice_id if invoiced',
  invoices: 'one row per tax invoice. id (INV-...); job = jobs.core; customer; status; issued; issued_month; due; ex / gst / inc dollars; paid = $ received; balance = $ still owed; days_overdue',
  items: 'line items: doc_id = quotes.id or invoices.id; doc_type quote|invoice; description; qty; price; gst_free; ex / gst / inc',
  payments: 'payments received: invoice_id = invoices.id; customer; date; month; amount; gst; method',
  expenses: 'money spent: id; date; month; supplier; description; category; job = jobs.core (blank if overhead); ex / gst / inc; has_receipt',
  reminders: 'follow-ups: due (ISO time); date; text; job = jobs.core',
  visits: 'website visitors: date; month; visits (number that day)',
  plan_tasks: 'project plan tasks (one row per task, one plan per job): job = jobs.core; plan_name; task; resource = everyone on it (lead first); lead; status To do|In progress|In review / QA|Done; start / finish dates; days (0 = milestone); qty, unit, unit_cost, planned_cost, actual_cost; pct_complete 0-100; done true/false; late true/false (past finish and not done)',
  plan_risks: 'project risks: job; plan_name; risk; probability 1-5; impact 1-5; score = probability x impact; response; owner; status Open|Closed; review date',
  plan_issues: 'project issues: job; plan_name; issue; priority; owner; raised; due; status Open|In progress|Resolved'
};

function sydneyDates(now = Date.now()) {
  const p = parts(now);
  const D = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
  const S = (dt) => dt.toISOString().slice(0, 10);
  const add = (dt, n) => new Date(dt.getTime() + n * 86400000);
  const today = D(p.y, p.mo, p.d), wd = (today.getUTCDay() + 6) % 7, monday = add(today, -wd);
  const monthStart = D(p.y, p.mo, 1), monthEnd = add(D(p.y, p.mo + 1, 1), -1);
  const lmStart = D(p.y, p.mo - 1, 1), lmEnd = add(monthStart, -1);
  const fyY = p.mo >= 7 ? p.y : p.y - 1, q0 = Math.floor((p.mo - 1) / 3) * 3 + 1;
  return {
    today: S(today), yesterday: S(add(today, -1)), this_week: [S(monday), S(add(monday, 6))], last_week: [S(add(monday, -7)), S(add(monday, -1))],
    this_month: [S(monthStart), S(monthEnd)], last_month: [S(lmStart), S(lmEnd)], this_quarter: [S(D(p.y, q0, 1)), S(add(D(p.y, q0 + 3, 1), -1))],
    this_year: [`${p.y}-01-01`, `${p.y}-12-31`], last_year: [`${p.y - 1}-01-01`, `${p.y - 1}-12-31`],
    this_financial_year: [`${fyY}-07-01`, `${fyY + 1}-06-30`], last_financial_year: [`${fyY - 1}-07-01`, `${fyY}-06-30`],
    last_7_days: [S(add(today, -6)), S(today)], last_30_days: [S(add(today, -29)), S(today)], weekday: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][wd]
  };
}
const HINT_KEYS = ['row_counts', 'stages', 'quote_status', 'invoice_status', 'expense_categories', 'trades', 'sources', 'suburbs', 'services', 'plans', 'plan_status', 'risk_status', 'issue_status'];
function cleanHints(h) {
  const out = {};
  for (const k of HINT_KEYS) {
    const v = h && h[k];
    if (Array.isArray(v)) out[k] = v.slice(0, 40).map((x) => String(x ?? '').slice(0, 90)).filter(Boolean);
    else if (v && typeof v === 'object') out[k] = Object.fromEntries(Object.entries(v).slice(0, 20).map(([a, b]) => [String(a).slice(0, 30), Number(b) || 0]));
  }
  return out;
}
export function readOnly(sql) {
  const s = String(sql || '').replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').trim().replace(/;\s*$/, '');
  if (!/^(select|with)\b/i.test(s) || /;/.test(s) || /\b(into|insert|update|delete|drop|create|alter|attach|detach|require|source|declare)\b/i.test(s) || /\b(json|csv|xlsx|xls|txt|tab|tsv|html|ods|file)\s*\(/i.test(s)) return '';
  return s;
}
export async function askSql({ question, hints, previous, history }) {
  const dates = sydneyDates();
  const schema = Object.fromEntries(Object.entries(SCHEMA).map(([t, cols]) => [t, { columns: cols, about: NOTES[t] || DESCRIBE[t] || '' }]));
  const system = 'You turn questions from the owner of Modern Building Solutions (a Sydney building company: remedial, waterproofing, painting, construction) into ONE read-only SQL query over the tables below. ' +
    'The query runs in AlaSQL (in the browser), so follow these rules exactly:\n' +
    '- One SELECT (or WITH ... SELECT). No semicolons, no INSERT/UPDATE/DELETE, no functions that read files.\n' +
    '- Use only the tables and columns listed. Join with the id columns described (jobs.core = quotes.job = invoices.job = expenses.job = plan_tasks.job).\n' +
    '- Dates are text YYYY-MM-DD (months YYYY-MM). Compare with BETWEEN \'from\' AND \'to\' using the exact dates given in "dates" for words like today, this week, this month, last month, this financial year (Australian FY 1 Jul - 30 Jun).\n' +
    '- Never use these words as aliases (they break this database): total, value, count, sum, rows, index, plan, top, group, desc, asc. Every alias must also be different from every column name (e.g. jobs_count, total_inc, planned_finish).\n' +
    '- Give every column in the result a clear snake_case alias. In UNION queries give every part the same aliases.\n' +
    '- For names or words the user types (a customer, a project, a suburb, a supplier), match loosely: LOWER(column) LIKE \'%word%\'. "Project X" usually means a plan: match plan_tasks.plan_name, or the job (jobs.name customer, jobs.service, jobs.suburb, jobs.ref) joined on plan_tasks.job = jobs.core.\n' +
    '- Project completion % = ROUND(SUM(CASE WHEN days < 1 THEN 1 ELSE days END * pct_complete) / SUM(CASE WHEN days < 1 THEN 1 ELSE days END)). Also useful: tasks done = SUM(CASE WHEN done THEN 1 ELSE 0 END), late tasks, MAX(finish) AS planned_finish.\n' +
    '- "New jobs" or "new enquiries" means jobs by created date. "Won" uses won_date. Money owed = SUM(balance) of invoices whose status is not paid or void. Amounts are AUD; say inc GST unless asked ex GST.\n' +
    '- Lists: return the useful columns (ref, customer name, suburb, amounts, dates), newest first, LIMIT 200. Counts and totals: return one row.\n' +
    '- If the question cannot be answered from these tables, return an empty sql and explain in "note".\n' +
    'Reply as JSON only: {"sql": string, "title": string (a short report title, max 60 chars), "note": string (one short sentence saying how you read the question, e.g. which dates you used), ' +
    '"chart": null or {"type": "bar"|"hbar"|"line"|"pie"|"doughnut", "x": label column alias, "y": [number column aliases]} (a chart only when there are several rows to compare)}.';
  const user = { question: String(question).slice(0, 500), dates, tables: schema, known_values: cleanHints(hints) };
  if (Array.isArray(history) && history.length) user.earlier_questions = history.slice(-2).map((h) => ({ question: String(h.q || '').slice(0, 300), sql: String(h.sql || '').slice(0, 1500) }));
  if (previous && previous.sql) user.your_previous_attempt = { sql: String(previous.sql).slice(0, 3000), error: String(previous.error || '').slice(0, 400), instruction: 'That query failed. Fix it and follow every rule.' };
  const o = await llmJson([{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(user) }], { maxTokens: 900 });
  const sql = String(o.sql || '').trim();
  let chart = null;
  if (o.chart && typeof o.chart === 'object' && o.chart.x && Array.isArray(o.chart.y) && ['bar', 'hbar', 'line', 'pie', 'doughnut'].includes(o.chart.type)) chart = { type: o.chart.type, x: String(o.chart.x), y: o.chart.y.map(String).slice(0, 4) };
  if (sql && !readOnly(sql)) return { sql: '', title: '', note: 'The AI suggested a query that is not allowed here (reports only read data). Try asking in a different way.', chart: null };
  return { sql: sql ? readOnly(sql) : '', title: String(o.title || 'AI query').slice(0, 80), note: String(o.note || '').slice(0, 300), chart };
}
export async function answerFromRows({ question, title, sql, columns, rows }) {
  const s = sample(columns, rows);
  const one = rows.length === 1 && columns.length === 1 ? rows[0][columns[0]] : undefined;
  const basic = rows.length === 0 ? 'Nothing matched that question.' : one !== undefined ? `${columns[0].replace(/_/g, ' ')}: ${typeof one === 'number' ? one.toLocaleString('en-AU') : one}.` : `${rows.length} row${rows.length === 1 ? '' : 's'} found (see the table).`;
  if (!llmSetup()) return { answer: basic, ai: false };
  try {
    const o = await llmJson([
      { role: 'system', content: 'You answer the owner of a Sydney building company in plain English, using ONLY the query results given. 1 to 3 short sentences. Lead with the direct answer and the key figure(s). ' +
        'Australian spelling, dollars as $1,234.56. If there are no rows, say nothing matched and suggest one reason. Do not mention SQL or tables. Some private columns were removed before you saw the data; never guess names, phones or emails. ' +
        'Reply as JSON: {"answer": string}.' },
      { role: 'user', content: JSON.stringify({ question: String(question).slice(0, 500), report_title: title, row_count: rows.length, columns: s.columns, rows: s.rows, removed_private_columns: s.removed }) }
    ], { maxTokens: 300, timeoutMs: 20000, temperature: 0.2 });
    return { answer: String(o.answer || basic).slice(0, 700), ai: true };
  } catch (e) { return { answer: basic, ai: false, note: e.message }; }
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
  if (action === 'sqlData') return out(200, { schema: SCHEMA, describe: DESCRIBE, data: await tables() });
  if (action === 'sqlNarrative') {
    const columns = (Array.isArray(body.columns) ? body.columns : []).map(String).slice(0, 40), rows = Array.isArray(body.rows) ? body.rows.slice(0, 200) : [];
    return out(200, await narrative({ title: String(body.title || 'Report').slice(0, 120), sql: String(body.sql || '').slice(0, 3000), columns, rows, focus: String(body.focus || '').slice(0, 400) }));
  }
  if (action === 'sqlAsk') {
    const question = String(body.question || '').trim();
    if (!question) return bad('Type a question first');
    try { return out(200, await askSql({ question, hints: body.hints || {}, previous: body.previous || null, history: body.history || [] })); }
    catch (e) { return bad(e.message, e.code || 502); }
  }
  if (action === 'sqlAnswer') {
    const columns = (Array.isArray(body.columns) ? body.columns : []).map(String).slice(0, 40), rows = Array.isArray(body.rows) ? body.rows.slice(0, 200) : [];
    return out(200, await answerFromRows({ question: String(body.question || '').slice(0, 500), title: String(body.title || '').slice(0, 120), sql: String(body.sql || '').slice(0, 3000), columns, rows }));
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
