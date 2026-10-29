// MBS Console: Customers (list, customer page, map data, insights, ✨ AI analysis).
// Customers come from customers.mjs (linked automatically when an enquiry arrives); the figures come from their jobs.
import * as kv from './kv.mjs';
import * as J from './jobs.mjs';
import * as CU from './customers.mjs';
import { env } from './shared.mjs';
import { llmSetup, llmJson, usage, checkLimit, sydToday } from './ai.mjs';
import { jobTitle, jobKind } from './plan.mjs';

const out = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const str = (s, n) => String(s ?? '').trim().slice(0, n);
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const CONFIRMED = ['won', 'completed', 'invoiced', 'paid'];
const val = (j) => (j.invoice ? Number(j.invoice.amount) || 0 : j.quote ? Number(j.quote.amount) || 0 : 0);
const month = (ms) => (ms ? new Date(ms + 10 * 3600e3).toISOString().slice(0, 7) : '');

async function data() {
  let d = await CU.get();
  if (!d.built) {   // first time: link every job there is
    const jobs = (await kv.getMany(await kv.keys('job:'))).filter(Boolean);
    d = await CU.rebuild(jobs);
  }
  const idx = await J.all();
  return { d, byCore: Object.fromEntries(idx.map((j) => [j.core, j])) };
}
export function statsFor(c, byCore) {
  const js = c.jobs.map((k) => byCore[k]).filter(Boolean).sort((a, b) => a.created - b.created);
  const conf = js.filter((j) => CONFIRMED.includes(j.stage)), last = js[js.length - 1];
  const sum = (list, f) => r2(list.reduce((a, j) => a + f(j), 0));
  return { id: c.id, name: c.name || 'Customer', phone: c.phone, email: c.email, suburb: c.suburb || '', tags: c.tags || [], notes: !!c.notes,
    enquiries: js.length, confirmed: conf.length, lost: js.filter((j) => j.stage === 'lost').length, openQuotes: js.filter((j) => j.stage === 'quoted').length,
    open: js.filter((j) => J.OPEN.includes(j.stage)).length, quotedValue: sum(js.filter((j) => j.stage === 'quoted'), val), value: sum(conf, val),
    paid: sum(js.filter((j) => j.stage === 'paid'), val), owed: sum(js.filter((j) => j.stage === 'invoiced'), val),
    first: c.first || (js[0] && js[0].created) || 0, last: c.last || (last && last.created) || 0, sources: c.sources || {}, lastStage: last ? last.stage : '', lastJob: last ? last.core : '' };
}
export function totalsOf(list, byCore, now = Date.now()) {
  const n = list.length, conf = list.filter((c) => c.confirmed > 0), jobs = Object.values(byCore);
  const thisMonth = month(now);
  return { customers: n, repeat: list.filter((c) => c.enquiries > 1).length, repeatConfirmed: list.filter((c) => c.confirmed > 1).length, withConfirmed: conf.length,
    conversion: n ? Math.round((conf.length / n) * 100) : 0, value: r2(list.reduce((a, c) => a + c.value, 0)), avgValue: conf.length ? r2(conf.reduce((a, c) => a + c.value, 0) / conf.length) : 0,
    owed: r2(list.reduce((a, c) => a + c.owed, 0)), openQuotes: list.reduce((a, c) => a + c.openQuotes, 0), quotedValue: r2(list.reduce((a, c) => a + c.quotedValue, 0)),
    newThisMonth: list.filter((c) => month(c.first) === thisMonth).length, lapsed: list.filter((c) => c.confirmed > 0 && c.open === 0 && c.last < now - 365 * 864e5).length,
    funnel: { enquiries: jobs.length, quoted: jobs.filter((j) => j.quoted_at || ['quoted', ...CONFIRMED].includes(j.stage)).length,
      won: jobs.filter((j) => j.won_at || CONFIRMED.includes(j.stage)).length, paid: jobs.filter((j) => j.stage === 'paid').length, lost: jobs.filter((j) => j.stage === 'lost').length } };
}
// figures only (no names, phones or emails) for the AI analysis
export function aggregates(list, T, now = Date.now()) {
  const bySub = {};
  for (const c of list) { const s = (c.suburb || 'Unknown').replace(/\s+NSW.*$/i, ''); const b = bySub[s] = bySub[s] || { suburb: s, customers: 0, confirmed: 0, value: 0 }; b.customers++; if (c.confirmed) b.confirmed++; b.value = r2(b.value + c.value); }
  const src = {}; for (const c of list) for (const [k, v] of Object.entries(c.sources)) src[k] = (src[k] || 0) + v;
  const months = {}; for (const c of list) { const m = month(c.first); if (m) months[m] = (months[m] || 0) + 1; }
  const top = [...list].sort((a, b) => b.value - a.value).slice(0, 10).map((c, i) => ({ customer: 'Customer ' + String.fromCharCode(65 + i), jobs: c.confirmed, enquiries: c.enquiries, value: c.value }));
  return { today: sydToday(now), totals: { ...T }, top_suburbs: Object.values(bySub).sort((a, b) => b.customers - a.customers).slice(0, 12), sources: src,
    new_customers_by_month: Object.fromEntries(Object.entries(months).sort().slice(-12)), top_customers_anonymised: top,
    jobs_per_customer: Object.entries(list.reduce((a, c) => { const k = c.enquiries >= 5 ? '5+' : String(c.enquiries); a[k] = (a[k] || 0) + 1; return a; }, {})) };
}
const capAnalyse = () => Math.max(300, Math.min(1500, Number(env('AI_CUSTOMER_MAX_TOKENS', '700')) || 700));

export async function custPost(action, body, { who, by, audit }) {
  if (!/^cust/.test(action)) return null;
  if (action === 'custList') {
    const { d, byCore } = await data();
    const list = Object.values(d.list).map((c) => statsFor(c, byCore)).filter((c) => c.enquiries > 0 || c.notes);
    return out(200, { customers: list, totals: totalsOf(list, byCore), builtAt: d.builtAt || 0 });
  }
  if (action === 'custGet') {
    const { d, byCore } = await data();
    const c = d.list[str(body.id, 12)];
    if (!c) return out(404, { error: 'Customer not found' });
    const [full, planKeys] = await Promise.all([kv.getMany(c.jobs.map((k) => 'job:' + k)), kv.keys('plan:')]);
    const planned = new Set(planKeys.map((k) => k.slice(5)));
    const jobs = full.filter(Boolean).sort((a, b) => b.created - a.created).map((j) => ({ core: j.core, ref: J.refFor(j), stage: j.stage, title: jobTitle(j), kind: jobKind(j), suburb: j.suburb || '',
      value: val(j), valueKind: j.invoice ? 'invoice' : j.quote ? 'quote' : '', created: j.created, source: j.source || '', plan: planned.has(j.core) }));
    return out(200, { customer: { ...c, notes: c.notes || '', tags: c.tags || [] }, stats: statsFor(c, byCore), jobs });
  }
  if (action === 'custFor') {   // the customer of a job (shown on the job page)
    const { d, byCore } = await data();
    const c = CU.forJob(d, str(body.core, 40));
    return out(200, { customer: c ? statsFor(c, byCore) : null });
  }
  if (action === 'custSave') {
    const c = await CU.edit(str(body.id, 12), { name: body.name, suburb: body.suburb, notes: body.notes, tags: body.tags });
    if (!c) return out(404, { error: 'Customer not found' });
    if (audit) await audit(who, `Customer ${c.id} updated`);
    return out(200, { customer: c });
  }
  if (action === 'custRebuild') {
    const jobs = (await kv.getMany(await kv.keys('job:'))).filter(Boolean);
    const d = await CU.rebuild(jobs);
    if (audit) await audit(who, `Customer list rebuilt from ${jobs.length} jobs`);
    return out(200, { customers: Object.keys(d.list).length, jobs: jobs.length });
  }
  if (action === 'custAnalyse') {   // ✨ AI analysis of the customer base: only figures are sent, never names or contact details
    const { d, byCore } = await data();
    const list = Object.values(d.list).map((c) => statsFor(c, byCore)).filter((c) => c.enquiries > 0);
    if (!list.length) return out(400, { error: 'No customers yet.' });
    if (!llmSetup()) return out(400, { error: 'AI is not set up yet: add LLM_API_KEY (DeepSeek) in Netlify.' });
    try { await checkLimit(); } catch (e) { return out(429, { error: e.message }); }
    const agg = aggregates(list, totalsOf(list, byCore));
    try {
      const { data: o, used } = await llmJson([
        { role: 'system', content: 'You are a business analyst for a small Sydney building, repair and maintenance company. Using ONLY these customer figures (no personal details), write in plain Australian English: a 2-3 sentence summary, 4-6 insights with the key figures (conversion, repeat customers, best suburbs, where customers come from, quotes waiting, money owed, trends), and 3-5 practical, specific recommendations (e.g. follow up quotes, win back lapsed customers, focus marketing on strong suburbs or channels). $1,234 format. JSON only: {"summary":"","insights":[""],"recommendations":[""]}' },
        { role: 'user', content: JSON.stringify(agg) }], { maxTokens: capAnalyse(), temperature: 0.3 });
      const today = await usage(true, used);
      const list2 = (x, n) => (Array.isArray(x) ? x : []).slice(0, n).map((v) => str(v, 400)).filter(Boolean);
      if (audit) await audit(who, `AI customer analysis (${used} tokens)`);
      return out(200, { summary: str(o.summary, 800), insights: list2(o.insights, 6), recommendations: list2(o.recommendations, 5), tokens: used, today });
    } catch (e) { return out(e.mbs && e.code ? e.code : 502, { error: e.message }); }
  }
  return null;
}
