// Visitor counter.  GET: the total so far.  POST: add one visit (the browser sends this once per visitor per day).
// Netlify: kept in Netlify Blobs (free, nothing to set up).  Your PC / your own server: data/visits.json.
import { json, cors } from '../lib/shared.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
const FILE = join(DATA, 'visits.json');

function bump(v) {
  const day = new Date().toISOString().slice(0, 10);
  v.total = (v.total || 0) + 1;
  v.days = v.days || {};
  v.days[day] = (v.days[day] || 0) + 1;
  const keep = Object.keys(v.days).sort().slice(-400);          // about a year of daily numbers
  v.days = Object.fromEntries(keep.map((k) => [k, v.days[k]]));
  return v;
}

let queue = Promise.resolve();
function localCount(add) {
  const run = queue.then(() => {
    let v = { total: 0, days: {} };
    try { v = JSON.parse(readFileSync(FILE, 'utf8')); } catch {}
    if (add) { bump(v); mkdirSync(DATA, { recursive: true }); writeFileSync(FILE, JSON.stringify(v)); }
    return v.total || 0;
  });
  queue = run.catch(() => {});
  return run;
}

async function netlifyCount(add) {
  const { getStore } = await import('@netlify/blobs');
  const store = getStore({ name: 'mbs-visits', consistency: 'strong' });
  const v = (await store.get('count', { type: 'json' })) || { total: 0, days: {} };
  if (add) await store.setJSON('count', bump(v));
  return v.total || 0;
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
  if (!['GET', 'POST'].includes(req.method)) return json(405, { error: 'Method not allowed' });
  try {
    const add = req.method === 'POST';
    const total = process.env.MBS_LOCAL === '1' ? await localCount(add) : await netlifyCount(add);
    return json(200, { total });
  } catch (e) {
    return json(503, { error: 'Visitor counter not available', reason: e.message });
  }
};
