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
async function reindex(ids, by = '', opts = {}) {
  if (!ids.length) return [];
  const alloc = await allocations(ids), idx = await index(), newlyLow = [];
  for (const id of ids) {
    let it = await kv.get('inv:' + id);
    if (!it) continue;
    const st = status(it, (alloc[id] || {}).qty || 0);
    if (st.low && !it.alerted && !it.archived && !opts.quiet) newlyLow.push(id);
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

// ---------- v44: 📊 insights for stock and suppliers (figures worked out here; ✨ AI analysis on top) ----------
const DAY = 864e5;
export async function insights(now = Date.now()) {
  const { items, suppliers } = await full();
  const alloc = await allocations(), idx = await index(), day0 = today();
  const supById = Object.fromEntries(suppliers.map((s) => [s.id, s]));
  let jobs = {};
  try { const J = await import('./jobs.mjs'); jobs = Object.fromEntries((await J.all()).map((j) => [j.core, j])); } catch {}
  const live = items.filter((i) => !i.archived);
  const usedIn = (it, days) => r2((it.moves || []).filter((m) => (m.kind === 'out' || m.kind === 'plan') && m.qty < 0 && m.at >= now - days * DAY).reduce((a, m) => a - m.qty, 0));
  const rows = live.map((it) => {
    const a = (alloc[it.id] || {}).qty || 0, st = status(it, a), b = bestPrice(it), price = b.price || 0;
    const u90 = usedIn(it, 90), u180 = usedIn(it, 180), lastOut = Math.max(0, ...(it.moves || []).filter((m) => (m.kind === 'out' || m.kind === 'plan') && m.qty < 0).map((m) => m.at));
    const v = validPrices(it, day0), pref = v.find((p) => p.supplier === it.preferred), cheap = v.slice().sort((x, y) => x.price - y.price)[0];
    const yearly = u180 * 2 || Number(it.reorderQty) || 0;
    const saving = pref && cheap && cheap.price < pref.price ? { per: r2(pref.price - cheap.price), year: r2((pref.price - cheap.price) * yearly), from: it.preferred, to: cheap.supplier } : null;
    return { id: it.id, name: it.name, category: it.category || 'Other', unit: it.unit, location: it.location || '', onHand: q3(it.onHand), available: st.available, low: st.low, state: st.state,
      reorderLevel: it.reorderLevel, price, value: r2((it.onHand || 0) * price), supplier: b.supplier, used90: u90, used180: u180, usedValue90: r2(u90 * price), usedValue180: r2(u180 * price),
      cover: u90 > 0 ? Math.round(st.available / (u90 / 90)) : null, lastOut, onOrder: it.onOrder || null, saving,
      expired: (it.prices || []).filter((p) => p.validUntil && p.validUntil < day0).length, expiring: (it.prices || []).filter((p) => p.validUntil && p.validUntil >= day0 && p.validUntil <= new Date(now + 30 * DAY).toISOString().slice(0, 10)).map((p) => ({ supplier: p.supplier, until: p.validUntil, price: p.price })) };
  });
  const sum = (l, f) => r2(l.reduce((a, x) => a + f(x), 0));
  const byCat = {};
  for (const r of rows) { const c = byCat[r.category] = byCat[r.category] || { category: r.category, items: 0, value: 0, used90: 0, low: 0 }; c.items++; c.value = r2(c.value + r.value); c.used90 = r2(c.used90 + r.usedValue90); if (r.low) c.low++; }
  // usage per month (last 6) and where the stock went (job suburbs)
  const months = {}, bySub = {};
  for (const it of live) {
    const price = bestPrice(it).price || 0;
    for (const m of it.moves || []) {
      if (!((m.kind === 'out' || m.kind === 'plan') && m.qty < 0) || m.at < now - 183 * DAY) continue;
      const mk = new Date(m.at + 10 * 3600e3).toISOString().slice(0, 7); months[mk] = r2((months[mk] || 0) - m.qty * price);
      const j = m.job && (jobs[m.job] || Object.values(jobs).find((x) => x.ref === m.job));
      if (j && j.suburb) { const s = bySub[j.suburb] = bySub[j.suburb] || { suburb: j.suburb, value: 0, moves: 0, jobs: new Set(), items: {} }; s.value = r2(s.value - m.qty * price); s.moves++; s.jobs.add(j.core); s.items[it.name] = r2((s.items[it.name] || 0) - m.qty * price); }
    }
  }
  const supRows = suppliers.filter((s) => !s.archived).map((s) => {
    const pref = rows.filter((r) => r.supplier === s.id), quoted = live.filter((i) => (i.prices || []).some((p) => p.supplier === s.id));
    return { id: s.id, name: s.name, address: s.address || '', categories: s.categories || '', terms: s.terms || '', phone: !!s.phone, email: !!s.email,
      items: pref.length, quoted: quoted.length, stockValue: sum(pref, (r) => r.value), spend180: sum(pref, (r) => r.usedValue180), low: pref.filter((r) => r.low).length,
      onOrder: live.filter((i) => i.onOrder && i.onOrder.supplier === s.id).length };
  });
  const spendAll = sum(supRows, (s) => s.spend180), topSup = supRows.slice().sort((a, b) => b.spend180 - a.spend180);
  const orders = rows.filter((r) => r.onOrder && r.onOrder.qty > 0).map((r) => ({ id: r.id, name: r.name, qty: r.onOrder.qty, unit: r.unit, supplier: (supById[r.onOrder.supplier] || {}).name || '', expected: r.onOrder.expected || '', overdue: !!(r.onOrder.expected && r.onOrder.expected < day0) }));
  const dead = rows.filter((r) => r.onHand > 0 && (!r.lastOut || r.lastOut < now - 120 * DAY)).sort((a, b) => b.value - a.value);
  return {
    today: day0,
    totals: { items: rows.length, suppliers: supRows.length, value: sum(rows, (r) => r.value), low: rows.filter((r) => r.low).length, onOrder: orders.length, overdue: orders.filter((o) => o.overdue).length,
      used90: sum(rows, (r) => r.usedValue90), dead: dead.length, deadValue: sum(dead, (r) => r.value), savingYear: sum(rows.filter((r) => r.saving), (r) => r.saving.year),
      expired: rows.filter((r) => r.expired).length, expiring: rows.filter((r) => r.expiring.length).length, topShare: spendAll ? Math.round((topSup[0] ? topSup[0].spend180 : 0) / spendAll * 100) : 0, noEmail: supRows.filter((s) => !s.email).length },
    categories: Object.values(byCat).sort((a, b) => b.value - a.value),
    months: Object.fromEntries(Object.entries(months).sort().slice(-6)),
    fast: rows.filter((r) => r.usedValue90 > 0).sort((a, b) => b.usedValue90 - a.usedValue90).slice(0, 10),
    atRisk: rows.filter((r) => r.low || (r.cover != null && r.cover < 21)).sort((a, b) => (a.cover ?? -1) - (b.cover ?? -1)).slice(0, 15),
    dead: dead.slice(0, 12), over: rows.filter((r) => r.cover != null && r.cover > 365 && r.value > 150).sort((a, b) => b.value - a.value).slice(0, 10),
    savings: rows.filter((r) => r.saving && r.saving.year > 0).sort((a, b) => b.saving.year - a.saving.year).slice(0, 10).map((r) => ({ ...r, fromName: (supById[r.saving.from] || {}).name || '', toName: (supById[r.saving.to] || {}).name || '' })),
    expiring: rows.filter((r) => r.expiring.length).slice(0, 12).map((r) => ({ id: r.id, name: r.name, quotes: r.expiring.map((e) => ({ ...e, name: (supById[e.supplier] || {}).name || '' })) })),
    orders: orders.sort((a, b) => (a.expected > b.expected ? 1 : -1)),
    suppliers: topSup,
    suburbs: Object.values(bySub).map((s) => ({ suburb: s.suburb, value: s.value, moves: s.moves, jobs: s.jobs.size, top: Object.entries(s.items).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n, v]) => ({ name: n, value: v })) })).sort((a, b) => b.value - a.value)
  };
}
async function analyse(I) {   // ✨ the AI reads the figures (supplier business names, no personal details)
  if (!llmSetup()) return { error: 'AI is not set up yet: add LLM_API_KEY (DeepSeek) in Netlify.' };
  try { await checkLimit(); } catch (e) { return { error: e.message, code: 429 }; }
  const pick = (l, n, f) => l.slice(0, n).map(f);
  const agg = { today: I.today, totals: I.totals, categories: I.categories, usage_by_month: I.months,
    fast_movers: pick(I.fast, 8, (r) => ({ item: r.name, used_90_days: r.used90, unit: r.unit, value: r.usedValue90, days_of_cover: r.cover })),
    running_low: pick(I.atRisk, 10, (r) => ({ item: r.name, available: r.available, reorder_at: r.reorderLevel, days_of_cover: r.cover })),
    dead_stock: pick(I.dead, 8, (r) => ({ item: r.name, value: r.value })), overstocked: pick(I.over, 6, (r) => ({ item: r.name, value: r.value, days_of_cover: r.cover })),
    cheaper_elsewhere: pick(I.savings, 8, (r) => ({ item: r.name, from: r.fromName, to: r.toName, saving_per_year: r.saving.year })),
    suppliers: pick(I.suppliers, 12, (s) => ({ supplier: s.name, items: s.items, spend_6_months: s.spend180, stock_value: s.stockValue, terms: s.terms, low_items: s.low, has_email: s.email })),
    orders: pick(I.orders, 10, (o) => ({ item: o.name, expected: o.expected, overdue: o.overdue })), top_suburbs_using_stock: pick(I.suburbs, 8, (s) => ({ suburb: s.suburb, value: s.value, jobs: s.jobs })) };
  try {
    const { data: o, used } = await llmJson([
      { role: 'system', content: 'You are an operations and purchasing analyst for a small Sydney building, repair and maintenance company. Using ONLY these stock and supplier figures, write in plain Australian English: a 2-3 sentence summary, 4-6 insights with the key figures (stock value, running low, dead or over stock, fast movers, cheaper suppliers, supplier concentration, overdue orders, where stock is used), and 3-5 practical recommendations (what to re-order, what to stop buying, which supplier to switch or negotiate with, how much cash to free up). JSON only: {"summary":"","insights":[""],"recommendations":[""]}' },
      { role: 'user', content: JSON.stringify(agg) }], { maxTokens: Math.max(300, Math.min(1500, Number(env('AI_INVENTORY_MAX_TOKENS', '800')) || 800)), temperature: 0.3 });
    const today2 = await usage(true, used);
    const list2 = (x, n) => (Array.isArray(x) ? x : []).slice(0, n).map((v) => str(v, 400)).filter(Boolean);
    return { summary: str(o.summary, 800), insights: list2(o.insights, 6), recommendations: list2(o.recommendations, 5), tokens: used, today: today2 };
  } catch (e) { return { error: e.message, code: e.mbs && e.code ? e.code : 502 }; }
}
// test site only: load sample suppliers / items in one go (no Telegram alerts; stock movements can be back-dated)
export async function testLoad(body, by) {
  if (String(env('SITE_ENV', '')).trim().toLowerCase() !== 'test') return { error: 'Test data can only be loaded on the test site.', code: 403 };
  if (body.kind === 'suppliers') {
    const ids = {};
    for (const s of (Array.isArray(body.suppliers) ? body.suppliers : []).slice(0, 30)) { const r = await saveSupplier(s, by); if (r.supplier) ids[str(s.code, 20)] = r.supplier.id; }
    return { ids };
  }
  if (body.kind === 'items') {
    const made = [], now = Date.now();
    for (const f of (Array.isArray(body.items) ? body.items : []).slice(0, 30)) {
      const nid = await nextId('I'), c = cleanItem(f);
      const moves = (Array.isArray(f.moves) ? f.moves : []).slice(0, 120).map((m, i) => ({ id: 'm' + nid + i, at: Math.min(now, Math.max(now - 400 * DAY, Number(m.at) || now)), kind: ['in', 'out', 'count', 'order'].includes(m.kind) ? m.kind : 'count',
        qty: q3(m.qty), reason: str(m.reason, 160), job: str(m.job, 40), by })).sort((a, b) => b.at - a.at);
      const it = { ...c, id: nid, onHand: Math.max(0, q3(f.onHand)), onOrder: f.onOrder && f.onOrder.qty > 0 ? { qty: q3(f.onOrder.qty), supplier: str(f.onOrder.supplier, 12), at: Number(f.onOrder.at) || now, expected: ymd(f.onOrder.expected), via: str(f.onOrder.via, 20) || 'phone', by } : null,
        alerted: false, created: moves.length ? moves[moves.length - 1].at : now, updated: now, by, moves };
      await kv.set('inv:' + nid, it); made.push(nid);
    }
    await reindex(made, by, { quiet: true });
    return { ids: made };
  }
  return { error: 'Unknown test data' };
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
    case 'invInsights': return out(200, await insights());
    case 'invAnalyse': { const r = await analyse(await insights()); if (r.error) return out(r.code || 400, r); await log(`AI inventory and supplier analysis (${r.tokens} tokens)`); return out(200, r); }
    case 'invTestLoad': { const r = await testLoad(body, by); if (r.error) return out(r.code || 400, r); await log(`Test data loaded: ${body.kind} (${Object.keys(r.ids).length || r.ids.length})`); return out(200, r); }
    case 'invRebuild': { const n = await rebuild(by); await log(`Inventory list rebuilt (${n} records)`); return out(200, { ok: true, n }); }
    default: return null;
  }
}
