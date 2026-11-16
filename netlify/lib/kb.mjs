// GKH Project Champ: 📚 the knowledge base: Sashi Sivam's project management class material (slide decks, notes, guides),
// used by Ask AI (in a project) and Ask Champ to answer project management questions, with the credit to Sashi.
// Retrieval (RAG): each document is cut into chunks (a slide or a few small slides), every chunk becomes a TF-IDF vector
// (the same vectors as "start a project from a document"), and a question gets the chunks closest to it (Maximal Marginal
// Relevance, so they do not repeat each other), with the deck name and slide numbers.
//   kb:index      { docs: [{ id, name, title, credit, pages, chunks, chars, on, at, by }] }
//   kb:doc:<id>   { chunks: [{ page, text }] }
import * as kv from './kv.mjs';
import { chunks as cut, vectors, cos } from './docingest.mjs';

const str = (s, max = 300) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
export const DEFAULT_CREDIT = 'taught by Sashi Sivam (PMP, PMI-ACP, CSM, CSPO) in his project management classes';
const MAX = 3000000;   // characters in one document
let cache = null;   // { v, list, vec } for this function instance (rebuilt when the index changes)

// one chunk per slide (or page), so a question lands on the slide that answers it; long ones are split, tiny ones join the next
export function kbChunks(t, size = 1400) {
  const out = [], parts = String(t).split(/(\[(?:page|slide) \d+\])/);
  let page = 0, carry = '', carryPage = 0;
  const push = (pg, text) => { text = text.trim(); if (!text) return; if (text.length <= size) { out.push({ page: pg, text }); return; } cut(text, size).forEach((c) => out.push({ page: pg, text: c.text })); };
  for (const part of parts) {
    const m = part.match(/^\[(?:page|slide) (\d+)\]$/); if (m) { page = +m[1]; continue; }
    const txt = part.trim(); if (!txt) continue;
    if (carry) { push(page, carry + '\n\n' + txt); carry = ''; continue; }
    if (txt.length < 120) { carry = txt; carryPage = page; continue; }
    push(page, txt);
  }
  if (carry) push(carryPage, carry);
  return out;
}
export async function list() { return ((await kv.get('kb:index').catch(() => null)) || { docs: [] }).docs || []; }
export async function add({ name, title, credit, pages, text }, by) {
  const t = String(text || '').replace(/\u0000/g, '').slice(0, MAX);
  if (t.replace(/\[(page|slide) \d+\]/g, '').trim().length < 200) return { error: 'There is too little text in this document. A scanned PDF or a deck of pictures has no text to read.' };
  const ch = kbChunks(t);
  const id = 'kb' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  await kv.set('kb:doc:' + id, { chunks: ch });
  const doc = { id, name: str(name, 160) || 'document', title: str(title, 160) || str(name, 160).replace(/\.(pptx|pdf|docx|txt|md)$/i, ''), credit: str(credit, 200) || DEFAULT_CREDIT,
    pages: Math.max(0, Math.round(Number(pages) || 0)), chunks: ch.length, chars: t.length, on: true, at: Date.now(), by: str(by, 80) };
  await kv.update('kb:index', (x) => { x.docs = (x.docs || []).concat([doc]); x.v = Date.now(); return x; }, () => ({ docs: [] }));
  cache = null;
  return { doc };
}
export async function change(id, f) {
  let found = null;
  await kv.update('kb:index', (x) => { (x.docs || []).forEach((d) => { if (d.id === id) { if (f.on != null) d.on = !!f.on; if (f.title != null) d.title = str(f.title, 160) || d.title; if (f.credit != null) d.credit = str(f.credit, 200) || DEFAULT_CREDIT; found = d; } }); x.v = Date.now(); return x; }, () => ({ docs: [] }));
  cache = null; return found ? { doc: found } : { error: 'Not found' };
}
export async function remove(id) {
  let n = 0;
  await kv.update('kb:index', (x) => { const b = (x.docs || []).length; x.docs = (x.docs || []).filter((d) => d.id !== id); n = b - x.docs.length; x.v = Date.now(); return x; }, () => ({ docs: [] }));
  if (n) await kv.del('kb:doc:' + id).catch(() => {});
  cache = null; return { removed: n };
}
async function load() {
  const idx = (await kv.get('kb:index').catch(() => null)) || { docs: [] }, v = idx.v || 0;
  if (cache && cache.v === v) return cache;
  const docs = (idx.docs || []).filter((d) => d.on);
  const list = [];
  for (const d of docs) { const x = await kv.get('kb:doc:' + d.id).catch(() => null); ((x && x.chunks) || []).forEach((c) => list.push({ doc: d, page: c.page, text: c.text })); }
  cache = { v, list, vec: list.length ? vectors(list) : null };
  return cache;
}
// the class material closest to a question: [{ title, credit, slides: [n], text }], at most maxChars of text
export async function search(q, maxChars = 6000, { min = 0.06, k = 8 } = {}) {
  const C = await load(); if (!C.vec || !String(q || '').trim()) return [];
  const qv = C.vec.embed(String(q)), sc = C.vec.vecs.map((v, i) => [i, cos(v, qv)]).filter((x) => x[1] >= min).sort((a, b) => b[1] - a[1]).slice(0, 40);
  const pick = [], used = new Set(); let chars = 0;
  while (pick.length < k && sc.length) {
    let bi = -1, bs = -1e9;
    sc.forEach(([i, s], j) => { if (used.has(i)) return; let red = 0; pick.forEach((p) => { const r = cos(C.vec.vecs[i], C.vec.vecs[p]); if (r > red) red = r; }); const m = 0.75 * s - 0.25 * red; if (m > bs) { bs = m; bi = j; } });
    if (bi < 0) break;
    const [i] = sc[bi]; used.add(i); sc.splice(bi, 1);
    if (chars + C.list[i].text.length > maxChars) { if (pick.length) break; }
    pick.push(i); chars += C.list[i].text.length;
  }
  return pick.sort((a, b) => a - b).map((i) => { const c = C.list[i]; return { title: c.doc.title, credit: c.doc.credit, page: c.page, kind: /\.pptx$/i.test(c.doc.name) ? 'slide' : 'page', text: c.text }; });
}
// for a prompt: the notes, and how to credit them
export function forPrompt(hits) {
  return hits.map((h) => ({ from: `${h.title}${h.page ? ', ' + h.kind + ' ' + h.page : ''}`, text: h.text }));
}
export const RULE = ' COURSE NOTES: "course_notes" are extracts from the project management classes taught by Sashi Sivam (PMP, PMI-ACP, CSM, CSPO, LSSGB; 20+ years leading programmes internationally). ' +
  'When they bear on the question, treat them as the authority on method and good practice: build the answer on them, keep their terms, frameworks and steps, and credit them naturally in the answer, ' +
  'e.g. "As Sashi teaches in his project management classes, ..." or "Sashi\'s class notes (<deck>, slide 42) put it this way: ...", once or twice, not on every line. ' +
  'Do not invent what the notes do not say; the project\'s own data still decides the facts about this project. List the notes you used in "sources" as "Sashi Sivam\'s class notes: <deck>, slide <n>".';
export function sourcesOf(hits) {
  const by = {}; hits.forEach((h) => { const k = h.title; (by[k] = by[k] || { kind: h.kind, p: [] }).p.push(h.page); });
  return Object.entries(by).map(([t, x]) => `Sashi Sivam's class notes: ${t}${x.p.filter(Boolean).length ? ', ' + x.kind + (x.p.length > 1 ? 's ' : ' ') + [...new Set(x.p.filter(Boolean))].join(', ') : ''}`);
}
