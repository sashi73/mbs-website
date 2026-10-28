// MBS inventory and suppliers (Netlify Blobs, store "mbs-jobs").
//   sup:<id>   a supplier (contact, phone, email, terms)
//   inv:<id>   a stock item: on hand, reorder level, reorder quantity, supplier quotes (prices), stock movements, on order
//   inv-index  short summaries for fast lists, with what project plans have allocated and whether it is low
// Project plans can use an item on a task: while the task is not done the quantity is "allocated"; when the task is
// marked Done the stock is used (and given back if the task is reopened). When an item drops to its reorder level the
// console asks whether to call or email the supplier, Telegram gets an alert, and the AI can write the re-order email.
import * as kv from './kv.mjs';
import { env, escapeHtml, sendEmail, sendTelegram } from './shared.mjs';
import { llmSetup, llmJson, usage, checkLimit } from './ai.mjs';
import { parts } from './calendar.mjs';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const q3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const str = (s, max = 300) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
const ymd = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : '');
const today = () => { const p = parts(Date.now()); return `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; };
const H = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const out = (status, body) => new Response(JSON.stringify(body), { status, headers: H });
export const UNITS = ['each', 'box', 'bag', 'L', 'kg', 'm', 'm²', 'm³', 'roll', 'sheet', 'tube', 'pack', 'tin', 'pair', 'set'];

async function nextId(kind) {
  const s = await kv.update('inv-seq', (x) => { x[kind] = (x[kind] || 0) + 1; return x; }, () => ({ I: 0, S: 0 }));
  return `${kind}-${String(s[kind]).padStart(4, '0')}`;
}
const exists = async (k) => !!(k && (await kv.get(k)));
const index = async () => (await kv.get('inv-index')) || { items: {}, suppliers: {} };

// ---------- suppliers ----------
function cleanSupplier(f, cur = {}) {
  return { ...cur, name: str(f.name, 120) || cur.name || 'Supplier', contact: str(f.contact, 120), phone: str(f.phone, 40), email: str(f.email, 160).toLowerCase(),
    website: str(f.website, 160), address: str(f.address, 200), abn: str(f.abn, 20), account: str(f.account, 60), terms: str(f.terms, 80),
    categories: str(f.categories, 200), notes: str(f.notes, 1000), archived: !!f.archived };
}
const supSummary = (s) => ({ id: s.id, name: s.name, contact: s.contact, phone: s.phone, email: s.email, categories: s.categories, terms: s.terms, archived: !!s.archived });
export async function saveSupplier(f, by) {
  if (!str(f.name, 120)) return { error: 'Give the supplier a name' };
  if (f.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(str(f.email, 160))) return { error: 'That email address does not look right' };
  const id = str(f.id, 12);
  let s;
  if (id && !(await exists('sup:' + id))) return { error: 'Supplier not found' };
  if (id) { s = await kv.update('sup:' + id, (cur) => ({ ...cleanSupplier(f, cur), id, updated: Date.now(), by }), null); if (!s) return { error: 'Supplier not found' }; }
  else { const nid = await nextId('S'); s = { ...cleanSupplier(f), id: nid, created: Date.now(), updated: Date.now(), by }; await kv.set('sup:' + nid, s); }
  await kv.update('inv-index', (x) => { x.suppliers = x.suppliers || {}; x.suppliers[s.id] = supSummary(s); return x; }, () => ({ items: {}, suppliers: {} }));
  return { supplier: s };
}

// ---------- items ----------
const supName = (idx, id) => (idx.suppliers[id] ? idx.suppliers[id].name : '');
function validPrices(it, day = today()) { return (it.prices || []).filter((p) => p.price > 0 && (!p.validUntil || p.validUntil >= day)); }
export function bestPrice(it) {
  const v = validPrices(it);
  const pref = v.find((p) => p.supplier === it.preferred);
  const best = v.slice().sort((a, b) => a.price - b.price)[0];
  return { price: pref ? pref.price : best ? best.price : 0, supplier: pref ? pref.supplier : best ? best.supplier : (it.preferred || ''), cheapest: best || null, expired: (it.prices || []).length > 0 && !v.length };
}
function onOrderQty(it) { return it.onOrder && it.onOrder.qty > 0 ? it.onOrder.qty : 0; }
export function suggestQty(it, allocated = 0) {
  const avail = q3((it.onHand || 0) - allocated), have = avail + onOrderQty(it);
  let q = Math.max(Number(it.reorderQty) || 0, (Number(it.reorderLevel) || 0) - have + 1, 1);
  const pack = Number(it.packSize) || 0;
  if (pack > 0) q = Math.ceil(q / pack) * pack;
  return q3(q);
}
function status(it, allocated) {
  const available = q3((it.onHand || 0) - allocated), level = Number(it.reorderLevel) || 0;
  const low = level > 0 && available + onOrderQty(it) <= level;
  return { available, low, onOrder: onOrderQty(it), state: it.archived ? 'archived' : low ? 'low' : onOrderQty(it) && available <= level ? 'on order' : 'ok' };
}
function itemSummary(it, allocated, idx) {
  const b = bestPrice(it), st = status(it, allocated);
  return { id: it.id, name: it.name, sku: it.sku, category: it.category, unit: it.unit, location: it.location, onHand: q3(it.onHand), allocated: q3(allocated), available: st.available,
    reorderLevel: it.reorderLevel, reorderQty: it.reorderQty, packSize: it.packSize, onOrder: st.onOrder, low: st.low, state: st.state, price: b.price, priceSupplier: b.supplier,
    priceSupplierName: supName(idx, b.supplier), preferred: it.preferred, preferredName: supName(idx, it.preferred), value: r2((it.onHand || 0) * b.price), archived: !!it.archived, updated: it.updated };
}
function cleanItem(f, cur = {}) {
  const prices = (Array.isArray(f.prices) ? f.prices : cur.prices || []).slice(0, 20).map((p, i) => ({
    id: str(p.id, 12) || 'p' + Date.now().toString(36) + i, supplier: str(p.supplier, 12), price: r2(p.price), packSize: q3(p.packSize), ref: str(p.ref, 60),
    quoted: ymd(p.quoted) || today(), validUntil: ymd(p.validUntil), notes: str(p.notes, 200) })).filter((p) => p.supplier);
  const preferred = str(f.preferred ?? cur.preferred, 12);
  return { ...cur, name: str(f.name, 120) || cur.name || 'Item', sku: str(f.sku, 60), category: str(f.category, 60), unit: UNITS.includes(f.unit) ? f.unit : str(f.unit, 12) || cur.unit || 'each',
    location: str(f.location, 60), reorderLevel: Math.max(0, q3(f.reorderLevel)), reorderQty: Math.max(0, q3(f.reorderQty)), packSize: Math.max(0, q3(f.packSize)),
    notes: str(f.notes, 1000), prices, preferred: prices.some((p) => p.supplier === preferred) ? preferred : prices[0] ? prices[0].supplier : '', archived: !!f.archived };
}

// what project plans have set aside (tasks that use the item and are not done yet), per item
export async function allocations(onlyIds = null) {
  const keys = await kv.keys('plan:');
  const plans = (await kv.getMany(keys)).filter(Boolean);
  const map = {};
  for (const p of plans) for (const t of p.tasks || []) {
    if (!t.item || (onlyIds && !onlyIds.includes(t.item))) continue;
    const m = (map[t.item] = map[t.item] || { qty: 0, uses: [] });
    const done = t.status === 'done' || t.pct >= 100;
    if (!done) m.qty = q3(m.qty + (Number(t.qty) || 0));
    m.uses.push({ job: p.core, plan: p.name, task: t.name, qty: q3(t.qty), done });
  }
  return map;
}

// write an item's summary into the index; send the Telegram alert once when it becomes low
async function reindex(ids, by = '') {
  if (!ids.length) return [];
  const alloc = await allocations(ids), idx = await index(), newlyLow = [];
  for (const id of ids) {
    let it = await kv.get('inv:' + id);
    if (!it) continue;
    const st = status(it, (alloc[id] || {}).qty || 0);
    if (st.low && !it.alerted && !it.archived) newlyLow.push(id);
    if ((st.low && !it.alerted) || (!st.low && it.alerted)) it = await kv.update('inv:' + id, (x) => { x.alerted = st.low; return x; }, null);
    idx.items[id] = itemSummary(it, (alloc[id] || {}).qty || 0, idx);
  }
  await kv.update('inv-index', (x) => { x.items = x.items || {}; x.suppliers = x.suppliers || idx.suppliers || {}; for (const id of ids) if (idx.items[id]) x.items[id] = idx.items[id]; return x; }, () => ({ items: {}, suppliers: {} }));
  const low = newlyLow.map((id) => idx.items[id]);
  for (const s of low) await alertLow(s, idx).catch((e) => console.warn('Low-stock alert not sent:', e.message));
  return low;
}
const site = () => 'https://' + env('PUBLIC_WEBSITE', 'mbsplc.com.au').replace(/^https?:\/\//, '').replace(/\/$/, '');
async function alertLow(s, idx) {
  const sup = idx.suppliers[s.preferred || s.priceSupplier] || null, it = await kv.get('inv:' + s.id);
  const qty = suggestQty(it, s.allocated);
  const text = `⚠️ <b>Low stock: ${escapeHtml(s.name)}</b>\nAvailable ${s.available} ${escapeHtml(s.unit)} (re-order at ${s.reorderLevel}${s.allocated ? `, ${s.allocated} set aside for jobs` : ''})\n` +
    (sup ? `Supplier: ${escapeHtml(sup.name)}${sup.phone ? ' · ' + escapeHtml(sup.phone) : ''}${sup.email ? ' · ' + escapeHtml(sup.email) : ''}\n` : 'No supplier saved yet.\n') +
    `Suggested order: ${qty} ${escapeHtml(s.unit)}\nCall or email from the console: ${site()}/admin/#inventory/${s.id}`;
  return sendTelegram(text);
}

export async function saveItem(f, by) {
  if (!str(f.name, 120)) return { error: 'Give the item a name' };
  const id = str(f.id, 12);
  let it;
  if (id && !(await exists('inv:' + id))) return { error: 'Item not found' };
  if (id) {
    it = await kv.update('inv:' + id, (cur) => ({ ...cleanItem(f, cur), id, updated: Date.now(), by }), null);
    if (!it) return { error: 'Item not found' };
  } else {
    const nid = await nextId('I'), now = Date.now(), start = Math.max(0, q3(f.onHand));
    it = { ...cleanItem(f), id: nid, onHand: start, onOrder: null, alerted: false, created: now, updated: now, by,
      moves: start ? [{ id: 'm' + now.toString(36), at: now, kind: 'count', qty: start, reason: 'Opening stock', job: '', by }] : [] };
    await kv.set('inv:' + nid, it);
  }
  const low = await reindex([it.id], by);
  return { item: it, low };
}

// stock movements: in (received), out (used), count (stock-take sets the number), plan (used by a Done plan task)
export async function move(id, f, by) {
  const kind = ['in', 'out', 'count'].includes(f.kind) ? f.kind : '';
  const qty = q3(f.qty);
  if (!kind) return { error: 'Choose add, use or count' };
  if (qty < 0 || (kind !== 'count' && qty <= 0)) return { error: 'Enter a quantity' };
  if (!(await exists('inv:' + id))) return { error: 'Item not found' };
  const it = await kv.update('inv:' + id, (x) => {
    const before = q3(x.onHand), delta = kind === 'in' ? qty : kind === 'out' ? -qty : q3(qty - before);
    x.onHand = q3(before + delta);
    x.moves = [{ id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), at: Date.now(), kind, qty: delta, reason: str(f.reason, 160) || (kind === 'count' ? 'Stock-take' : ''), job: str(f.job, 40), by }].concat(x.moves || []).slice(0, 300);
    if (kind === 'in' && f.received && x.onOrder) { const left = q3(x.onOrder.qty - qty); x.onOrder = left > 0 ? { ...x.onOrder, qty: left } : null; }
    x.updated = Date.now();
    return x;
  }, null);
  if (!it) return { error: 'Item not found' };
  return { item: it, low: await reindex([id], by) };
}
export async function setOnOrder(id, f, by) {
  const qty = q3(f.qty);
  if (!(await exists('inv:' + id))) return { error: 'Item not found' };
  const it = await kv.update('inv:' + id, (x) => {
    x.onOrder = qty > 0 ? { qty: q3((x.onOrder ? x.onOrder.qty : 0) + qty), supplier: str(f.supplier, 12), at: Date.now(), expected: ymd(f.expected), via: str(f.via, 20), by } : null;
    x.moves = [{ id: 'm' + Date.now().toString(36), at: Date.now(), kind: 'order', qty: 0, reason: qty > 0 ? `Ordered ${qty} ${x.unit} (${str(f.via, 20) || 'manual'})` : 'Order cancelled', job: '', by }].concat(x.moves || []).slice(0, 300);
    x.updated = Date.now();
    return x;
  }, null);
  if (!it) return { error: 'Item not found' };
  await reindex([id], by);
  return { item: it };
}

export const refresh = (ids, by) => reindex([...new Set(ids)].filter(Boolean), by);

// ---------- project plans: allocate while not done, use when Done, give back if reopened ----------
export async function syncPlan(core, before, after, by) {
  const sig = (p) => JSON.stringify(((p && p.tasks) || []).filter((t) => t.item).map((t) => [t.id, t.item, q3(t.qty), t.status === 'done' || t.pct >= 100]));
  if (before && after && sig(before) === sig(after)) return [];   // nothing stock-related changed
  const want = {};   // itemId -> { key: qty } that should be "used" now
  const touch = new Set();
  for (const t of (before && before.tasks) || []) if (t.item) touch.add(t.item);
  for (const t of (after && after.tasks) || []) {
    if (!t.item) continue;
    touch.add(t.item);
    if ((t.status === 'done' || t.pct >= 100) && Number(t.qty) > 0) (want[t.item] = want[t.item] || {})[`plan:${core}:${t.id}`] = { qty: q3(t.qty), task: t.name };
  }
  const ids = [...touch];
  for (const id of ids) {
    const it = await kv.get('inv:' + id);
    if (!it) continue;
    const prefix = `plan:${core}:`, have = (it.moves || []).filter((m) => m.key && m.key.startsWith(prefix));
    const w = want[id] || {};
    const same = have.length === Object.keys(w).length && have.every((m) => w[m.key] && -m.qty === w[m.key].qty);
    if (same) continue;
    await kv.update('inv:' + id, (x) => {
      const old = (x.moves || []).filter((m) => m.key && m.key.startsWith(prefix));
      let onHand = q3(x.onHand);
      for (const m of old) onHand = q3(onHand - m.qty);   // give back what this plan had used
      let moves = (x.moves || []).filter((m) => !(m.key && m.key.startsWith(prefix)));
      for (const [key, v] of Object.entries(w)) { onHand = q3(onHand - v.qty); moves = [{ id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), at: Date.now(), kind: 'plan', qty: -v.qty, reason: `Used on job: ${str(v.task, 80)}`, job: core, key, by }].concat(moves); }
      x.onHand = onHand; x.moves = moves.slice(0, 300); x.updated = Date.now();
      return x;
    }, null);
  }
  return reindex(ids.filter(Boolean), by);
}

// ---------- re-order email (template, or written by the AI) ----------
function business() {
  return { name: env('BUSINESS_LEGAL_NAME', 'Modern Building Solutions Pty Ltd'), phone: env('PUBLIC_PHONE', '0420 494 990'), email: env('PUBLIC_CONTACT_EMAIL', 'mbs.pty.ltd@gmail.com'), account: '' };
}
function template(it, sup, qty, note) {
  const B = business(), price = (it.prices || []).find((p) => p.supplier === (sup && sup.id));
  const subject = `Order: ${qty} ${it.unit} ${it.name}${it.sku ? ' (' + it.sku + ')' : ''} - ${B.name}`;
  const body = `Hi ${sup && sup.contact ? sup.contact.split(' ')[0] : 'there'},\n\nPlease supply the following for ${B.name}:\n\n` +
    `- ${it.name}${it.sku ? ' (code ' + it.sku + ')' : ''}: ${qty} ${it.unit}${price ? ` (your quote ${price.ref ? price.ref + ', ' : ''}$${price.price.toFixed(2)} ex GST per ${it.unit})` : ''}\n\n` +
    (sup && sup.account ? `Our account number: ${sup.account}\n` : '') + (note ? note + '\n' : '') +
    `Please confirm price, availability and the delivery or pick-up date.\n\nThank you,\n${B.name}\n${B.phone}\n${B.email}`;
  return { subject, body };
}
export async function draftReorder(id, f) {
  const it = await kv.get('inv:' + id);
  if (!it) return { error: 'Item not found', code: 404 };
  const idx = await index(), alloc = await allocations([id]);
  const supId = str(f.supplier, 12) || it.preferred || bestPrice(it).supplier;
  const sup = supId ? await kv.get('sup:' + supId) : null;
  const allocated = (alloc[id] || {}).qty || 0, st = status(it, allocated);
  const qty = q3(f.qty) || suggestQty(it, allocated);
  const base = { to: sup ? sup.email : '', supplier: supId, supplierName: sup ? sup.name : '', phone: sup ? sup.phone : '', qty, ai: false, tokens: 0 };
  const t = template(it, sup, qty, str(f.note, 300));
  if (!f.ai) return { ...base, ...t };
  if (!llmSetup()) return { ...base, ...t, note: 'AI is not set up (LLM_API_KEY), so this is the standard email.' };
  try { await checkLimit(); } catch (e) { return { ...base, ...t, note: e.message }; }
  const B = business(), price = (it.prices || []).find((p) => p.supplier === supId);
  const cap = Math.max(200, Math.min(700, Number(env('AI_EMAIL_MAX_TOKENS', '350')) || 350));
  try {
    const { data: o, used } = await llmJson([
      { role: 'system', content: 'Write a short, polite purchase order email from an Australian building company to its supplier. Plain text, no markdown, under 140 words. ' +
        'Include the item, code, exact quantity and unit, the quoted price if given, our account number if given, and ask them to confirm price, availability and delivery date. ' +
        'Sign off with the business name, phone and email given. JSON only: {"subject":"","body":""}' },
      { role: 'user', content: JSON.stringify({ business: B.name, phone: B.phone, email: B.email, supplier: sup ? sup.name : '', supplier_contact: sup ? sup.contact : '', account_number: sup ? sup.account : '',
        item: it.name, code: it.sku, quantity: qty, unit: it.unit, quoted_price_ex_gst: price ? price.price : null, quote_ref: price ? price.ref : '', stock_now: st.available, reorder_level: it.reorderLevel, extra_note: str(f.note, 300) }) }
    ], { maxTokens: cap, temperature: 0.4 });
    const today = await usage(true, used);
    const subject = str(o.subject, 160) || t.subject, body = str(o.body, 3000) || t.body;
    // the quantity must be right: if the AI changed it, fall back to the standard email
    if (!new RegExp(`\\b${String(qty).replace('.', '\\.')}\\b`).test(body)) return { ...base, ...t, note: 'The AI email did not show the right quantity, so this is the standard email.', tokens: used, today };
    return { ...base, subject, body, ai: true, tokens: used, today };
  } catch (e) { return { ...base, ...t, note: e.message + ' This is the standard email.' }; }
}
export async function sendReorder(id, f, by) {
  const it = await kv.get('inv:' + id);
  if (!it) return { error: 'Item not found', code: 404 };
  const to = str(f.to, 160);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return { error: 'Enter the supplier\'s email address' };
  const qty = q3(f.qty);
  if (qty <= 0) return { error: 'Enter the quantity to order' };
  const subject = str(f.subject, 160), body = str(f.body, 4000);
  if (!subject || !body) return { error: 'The email needs a subject and a message' };
  const owner = env('OWNER_EMAIL').split(',')[0].trim();
  const html = '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">' + escapeHtml(body).replace(/\n/g, '<br>') + '</div>';
  const r = await sendEmail({ to, subject, html, text: body, replyTo: env('PUBLIC_CONTACT_EMAIL', business().email), bcc: f.copyMe !== false && owner ? owner : '' });
  if (!r.ok) return { error: 'Email not sent: ' + (r.reason || 'unknown error'), code: 502 };
  const o = await setOnOrder(id, { qty, supplier: f.supplier, expected: f.expected, via: 'email' }, by);
  return { ok: true, to, item: o.item };
}

// ---------- lists for the console and the SQL wizard ----------
export async function list() {
  const idx = await index();
  return { items: Object.values(idx.items || {}).sort((a, b) => (a.name > b.name ? 1 : -1)), suppliers: Object.values(idx.suppliers || {}).sort((a, b) => (a.name > b.name ? 1 : -1)), units: UNITS };
}
export async function full() {
  const ik = await kv.keys('inv:'), sk = await kv.keys('sup:');
  const [items, sups] = await Promise.all([kv.getMany(ik), kv.getMany(sk)]);
  return { items: items.filter(Boolean), suppliers: sups.filter(Boolean) };
}
export async function rebuild(by) {
  const { items, suppliers } = await full();
  await kv.update('inv-index', (x) => { x.suppliers = Object.fromEntries(suppliers.map((s) => [s.id, supSummary(s)])); x.items = {}; return x; }, () => ({ items: {}, suppliers: {} }));
  await reindex(items.map((i) => i.id), by);
  return items.length + suppliers.length;
}

export async function invPost(action, body, { who, by, audit }) {
  const id = str(body.id, 12);
  const log = (t) => (audit ? audit(who, t) : null);
  switch (action) {
    case 'invList': return out(200, await list());
    case 'invGet': {
      const it = await kv.get('inv:' + id);
      if (!it) return out(404, { error: 'Item not found' });
      const alloc = await allocations([id]), idx = await index();
      return out(200, { item: it, summary: itemSummary(it, (alloc[id] || {}).qty || 0, idx), uses: (alloc[id] || {}).uses || [], suggested: suggestQty(it, (alloc[id] || {}).qty || 0), suppliers: Object.values(idx.suppliers || {}) });
    }
    case 'invSave': { const r = await saveItem(body.item || {}, by); if (r.error) return out(400, r); await log(`Inventory: ${r.item.id} ${r.item.name} saved`); return out(200, r); }
    case 'invMove': { const r = await move(id, body, by); if (r.error) return out(400, r); await log(`Inventory: ${r.item.id} ${body.kind} ${body.qty} ${r.item.unit}${body.reason ? ' (' + str(body.reason, 60) + ')' : ''}`); return out(200, r); }
    case 'invOrdered': { const r = await setOnOrder(id, { ...body, via: str(body.via, 20) || 'phone' }, by); if (r.error) return out(400, r); await log(`Inventory: ${id} marked on order (${body.qty})`); return out(200, r); }
    case 'invReorderDraft': { const r = await draftReorder(id, body); if (r.error) return out(r.code || 400, r); return out(200, r); }
    case 'invReorderSend': { const r = await sendReorder(id, body, by); if (r.error) return out(r.code || 400, r); await log(`Inventory: re-order emailed to ${r.to} (${id}, ${body.qty})`); return out(200, r); }
    case 'invArchive': {
      if (!(await exists('inv:' + id))) return out(404, { error: 'Item not found' });
      const it = await kv.update('inv:' + id, (x) => { x.archived = !!body.archived; x.updated = Date.now(); return x; }, null);
      if (!it) return out(404, { error: 'Item not found' });
      await reindex([id], by); await log(`Inventory: ${id} ${it.archived ? 'archived' : 'restored'}`); return out(200, { item: it });
    }
    case 'supSave': { const r = await saveSupplier(body.supplier || {}, by); if (r.error) return out(400, r); await log(`Supplier ${r.supplier.id} ${r.supplier.name} saved`); return out(200, r); }
    case 'supGet': { const s = await kv.get('sup:' + id); return s ? out(200, { supplier: s }) : out(404, { error: 'Supplier not found' }); }
    case 'invRebuild': { const n = await rebuild(by); await log(`Inventory list rebuilt (${n} records)`); return out(200, { ok: true, n }); }
    default: return null;
  }
}
