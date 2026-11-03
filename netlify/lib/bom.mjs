// MBS Console v89: 🧱 Bill of Materials (BOM) for a project, before the work starts.
// The BOM lives in the plan (plan.bom) and is the source of truth for materials: each line is linked to a task and, where it
// can be, to an Inventory item. The console writes the lines onto the tasks as stock materials, so the stock is set aside,
// task costs and quotes include them, and Inventory shows the shortfall to order. ✨ The AI drafts a BOM from the plan, the
// scope and the stock catalogue (lines marked "≈ est" until someone checks them); staff tick each line as checked and sign the
// BOM off. Reusable BOM templates (e.g. a standard bathroom) can be saved from a job and applied to another.
import * as kv from './kv.mjs';
import * as J from './jobs.mjs';
import * as P from './plan.mjs';
import { llmJson, usage, checkLimit, llmSetup } from './ai.mjs';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const q3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const int = (n, lo, hi, d = lo) => { const v = Math.round(Number(n)); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
const str = (s, max = 300) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
const H = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const out = (status, body) => new Response(JSON.stringify(body), { status, headers: H });

// ---------- one BOM line, and the BOM as saved in the plan ----------
export function cleanLine(x, taskIds) {
  if (!x || typeof x !== 'object') return null;
  const name = str(x.name, 160); if (!name) return null;
  return { id: str(x.id, 20).replace(/[^\w-]/g, '') || 'b' + Math.random().toString(36).slice(2, 9), task: taskIds && taskIds.has(x.task) ? x.task : '', name,
    item: /^I-\d{3,6}$/.test(x.item || '') ? x.item : '', qty: Math.max(0, Math.min(1e7, q3(x.qty))), unit: str(x.unit, 12) || 'each', price: Math.max(0, Math.min(1e9, r2(x.price))),
    lead: int(x.lead, 0, 365, 0), note: str(x.note, 240), source: ['ai', 'manual', 'template', 'plan'].includes(x.source) ? x.source : 'manual',
    est: !!x.est, checked: !!x.checked, checkedBy: str(x.checkedBy, 80) };
}
// v92: re-orders made from the BOM: per stock item, how it was ordered (phone, email, online, other), how many, from whom, when due
const VIA = ['phone', 'email', 'online', 'in person', 'other'];
function cleanOrders(o) {
  const res = {};
  for (const [k, v] of Object.entries(o && typeof o === 'object' ? o : {}).slice(0, 400)) {
    if (!/^(I-\d{3,6}|[\w-]{1,20})$/.test(k) || !v || typeof v !== 'object') continue;   // v96: a stock item, or a BOM line not in Inventory
    res[k] = { qty: Math.max(0, Math.min(1e7, q3(v.qty))), via: VIA.includes(v.via) ? v.via : 'other', supplier: str(v.supplier, 120), ref: str(v.ref, 60), expected: /^\d{4}-\d{2}-\d{2}$/.test(v.expected || '') ? v.expected : '', at: Number(v.at) || Date.now(), by: str(v.by, 80) };
  }
  return res;
}
export function cleanBom(b, taskIds) {
  if (!b || typeof b !== 'object') return null;
  const ms = taskIds && taskIds.has(b.milestone) ? b.milestone : '';   // v99: the "🧱 Bill of Materials" milestone holds every line
  const lines = (Array.isArray(b.lines) ? b.lines : []).slice(0, 400).map((x) => cleanLine(ms ? { ...x, task: ms } : x, taskIds)).filter(Boolean);
  const signed = b.status === 'Signed off' && lines.length && lines.every((x) => x.checked);
  return { status: signed ? 'Signed off' : 'Draft', lines, signedBy: signed ? str(b.signedBy, 80) : '', signedRole: signed ? str(b.signedRole, 60) : '', signedAt: signed ? Number(b.signedAt) || Date.now() : 0,
    sig: signed ? str(b.sig, 80) : '', template: str(b.template, 20), orders: cleanOrders(b.orders), milestone: ms, buildStart: taskIds && taskIds.has(b.buildStart) ? b.buildStart : '', log: (Array.isArray(b.log) ? b.log : []).slice(-60).map((x) => ({ at: Number(x && x.at) || Date.now(), what: str(x && x.what, 300) })).filter((x) => x.what) };
}

// ---------- ✨ the AI drafts the BOM ----------
export async function draft({ core, note, only }, by) {
  const job = await J.find(core); if (!job) return { error: 'Job not found' };
  const plan = await P.get(job.core); if (!plan) return { error: 'This job has no plan yet' };
  if (!llmSetup()) return { error: 'AI is not set up yet: add LLM_API_KEY (DeepSeek) in Netlify.' };
  try { await checkLimit(); } catch (e) { return { error: e.message }; }
  const ix = (await kv.get('inv-index')) || { items: {} };
  const cat = Object.values(ix.items || {}).filter((i) => !i.archived).slice(0, 200).map((i) => ({ id: i.id, name: i.name, unit: i.unit, price: i.price || 0, in_stock: i.available }));
  const work = plan.tasks.filter((t) => t.dur > 0), want = new Set((Array.isArray(only) ? only : []).map(String));
  const tasks = plan.tasks.filter((t) => !/^🧱 Bill of Materials/.test(t.name)).map((t) => ({ n: plan.tasks.indexOf(t) + 1, task: P.scrubTask(t.name, job), days: t.dur, steps: (t.subs || []).slice(0, 8).map((s) => P.scrubTask(s.name, job)) })).filter((t) => !want.size || want.has(String(t.n)));
  const system = 'You are an experienced estimator for a building and maintenance company in Sydney, NSW. Write ONE Bill of Materials (BOM) for the whole job: only the PHYSICAL materials, fixings and consumables that must be bought to build it ' +
    '(timber, concrete, fixings, sealants, paint, tiles, membranes, hardware and so on), with realistic quantities for the size of the job (from the description and scope), units and a typical Sydney trade price per unit in AUD ex GST. ' +
    'Do NOT list services, fees, approvals, permits, reports, inspections, surveys, design, labour, plant or equipment hire, subcontract work, or anything for planning, quoting or admin tasks: those are not materials. ' +
    'Add a sensible waste allowance where it applies (e.g. 10% tiles, 5% timber) and say so in the note. Use an item from the stock catalogue (its id) whenever it is the same thing, so existing stock is used first; otherwise leave item empty. ' +
    'For items that usually take time to arrive (hardwood, stone benchtops, custom joinery, windows, switchboards, special orders), give lead_days (working days). ' +
    'Also say where the build (the physical work on site) starts: build_starts is the number n of the first task where work on site begins, e.g. site set-out and excavation, demolition or strip-out (not quoting, design, approvals or ordering). ' +
    'Plain words, no em dashes. ' + (note ? 'The estimator also says: ' + str(note, 300) + '. ' : '') +
    'JSON only: {"build_starts":1,"lines":[{"name":"","qty":0,"unit":"each","item":"","price":0,"lead_days":0,"note":""}],"caveat":"one sentence: what to double-check"}';
  const user = { project: P.privateOut(str(plan.name, 120), job), work: P.privateOut(str(job.service, 120), job), description: P.privateOut(P.jobScope(job), 1500),
    in_scope: P.privateOut(str((plan.charter || {}).inScope, 2000), job), tasks, stock_catalogue: cat };
  let o, used;
  try { ({ data: o, used } = await llmJson([{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(user) }], { maxTokens: 6000, timeoutMs: 300000, temperature: 0.2 })); }
  catch (e) { return { error: e.message }; }
  const today = await usage(true, used), catIds = new Set(cat.map((c) => c.id)), byN = (n) => plan.tasks[int(n, 1, plan.tasks.length, 0) - 1];
  const NOT_MAT = /\b(report|approval|enquiry|permit|certificat|inspection|survey|consult|design|drawing|fee|labour|labor|hire|subcontract|engineer'?s|council|insurance|levy)\b/i;   // v99: services are not materials
  const lines = (Array.isArray(o.lines) ? o.lines : []).slice(0, 150).filter((x) => x && !NOT_MAT.test(String(x.name || ''))).map((x) => {
    const t = null, item = catIds.has(x && x.item) ? x.item : '', c = item ? cat.find((y) => y.id === item) : null;
    return cleanLine({ task: t ? t.id : '', name: c ? c.name : x && x.name, qty: x && x.qty, unit: c ? c.unit : x && x.unit, item, price: c && c.price ? c.price : x && x.price,
      lead: x && x.lead_days, note: String((x && x.note) || '').replace(/\s*[—–]\s*/g, ', '), source: 'ai', est: true }, new Set(plan.tasks.map((y) => y.id)));
  }).filter((x) => x && x.qty > 0);
  if (!lines.length) return { error: 'The AI did not return any materials. Add a bit more to the scope and try again.' };
  const bs = byN(o.build_starts);
  return { lines, buildStart: bs ? bs.id : '', caveat: str(o.caveat, 300), tokens: used, today };
}

// ---------- reusable BOM templates ----------
async function tplIndex() { return (await kv.get('bomtpl-index')) || { list: {} }; }
const tplSum = (t) => ({ id: t.id, name: t.name, kind: t.kind, lines: t.lines.length, value: r2(t.lines.reduce((a, x) => a + x.qty * x.price, 0)), updated: t.updated, by: t.by });
export async function bomPost(action, body, { who, by, audit }) {
  const log = (t) => (audit ? audit(who, t) : null);
  switch (action) {
    case 'planBomTplList': return out(200, { templates: Object.values((await tplIndex()).list || {}).sort((a, b) => (a.name > b.name ? 1 : -1)) });
    case 'planBomTplGet': { const t = await kv.get('bomtpl:' + str(body.id, 12)); return t ? out(200, { template: t }) : out(404, { error: 'Template not found' }); }
    case 'planBomTplSave': {
      const name = str(body.name, 100); if (!name) return out(400, { error: 'Give the template a name' });
      const lines = (Array.isArray(body.lines) ? body.lines : []).slice(0, 400).map((x) => { const l = cleanLine({ ...x, source: 'template' }, null); return l && { name: l.name, item: l.item, qty: l.qty, unit: l.unit, price: l.price, lead: l.lead, note: l.note, taskHint: str(x.taskHint, 160) }; }).filter(Boolean);
      if (!lines.length) return out(400, { error: 'The BOM has no lines to save' });
      let id = /^BT-\d{3,5}$/.test(body.id || '') ? body.id : '';
      if (!id) { const n = await kv.update('bomtpl-seq', (x) => ({ n: ((x && x.n) || 0) + 1 }), () => ({ n: 0 })); id = 'BT-' + String(n.n).padStart(3, '0'); }
      const old = (await kv.get('bomtpl:' + id)) || {};
      const t = { ...old, id, name, kind: str(body.kind, 80), lines, created: old.created || Date.now(), updated: Date.now(), by: str(by, 60) };
      await kv.set('bomtpl:' + id, t); await kv.update('bomtpl-index', (x) => { x.list = x.list || {}; x.list[id] = tplSum(t); return x; }, () => ({ list: {} }));
      await log(`BOM template saved: ${id} ${name} (${lines.length} lines)`);
      return out(200, { template: tplSum(t) });
    }
    case 'planBomTplDelete': {
      const id = str(body.id, 12); await kv.del('bomtpl:' + id); await kv.update('bomtpl-index', (x) => { if (x.list) delete x.list[id]; return x; }, () => ({ list: {} }));
      await log(`BOM template deleted: ${id}`); return out(200, { ok: true });
    }
    default: return null;
  }
}
