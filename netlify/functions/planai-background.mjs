// MBS Console: "✨ Ask AI to build the plan". A Netlify background function (name ends in -background):
// the browser gets an immediate 202, the AI can take up to a couple of minutes, and the result is saved in Blobs
// as aiplan:<id>; the console asks for it with the "planAiStatus" action until it is ready.
import * as A from '../lib/admin-lib.mjs';
import * as kv from '../lib/kv.mjs';
import { buildAiPlan } from '../lib/plan.mjs';

const ok = () => new Response('', { status: 202 });
export default async (req) => {
  let id = '';
  try {
    if (req.method !== 'POST' || req.headers.get('x-mbs-admin') !== '1') return new Response('', { status: 403 });
    const session = A.readSession(req);
    if (!session) return new Response('', { status: 401 });
    let body = {};
    try { body = await req.json(); } catch { return new Response('', { status: 400 }); }
    id = String(body.id || '').replace(/[^a-z0-9]/gi, '').slice(0, 40);
    if (id.length < 12) return new Response('', { status: 400 });
    await kv.set('aiplan:' + id, { status: 'working', at: Date.now() });
    const r = await buildAiPlan({ core: body.core, describe: body.describe, scope: body.scope, type: body.type, start: body.start, finish: body.finish, emergency: !!body.emergency }, `Admin (${session.u})`);
    await kv.set('aiplan:' + id, { ...r, status: r.error ? 'error' : 'done', at: Date.now() });
    if (!r.error) await A.audit(session.u, `AI built a plan draft for ${String(body.core || '').slice(0, 20)} (${r.tokens || 0} tokens)`);
  } catch (e) {
    console.error('AI plan failed:', e);
    if (id) { try { await kv.set('aiplan:' + id, { status: 'error', error: 'The AI plan could not be made: ' + e.message, at: Date.now() }); } catch {} }
  }
  return ok();   // never an error status: Netlify would retry a failed background function
};
