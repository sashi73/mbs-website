// MBS Console: "✨ Ask AI to build the plan", and (v38) "✨ Fit to finish-by". A Netlify background function (name ends in -background):
// the browser gets an immediate 202, the AI can take up to a couple of minutes, and the result is saved in Blobs
// as aiplan:<id>; the console asks for it with the "planAiStatus" action until it is ready.
import * as A from '../lib/admin-lib.mjs';
import * as kv from '../lib/kv.mjs';
import { buildAiPlan, fitPlanAi, charterEnhance, costEstimate } from '../lib/plan.mjs';
import * as INTEL from '../lib/plan-intel.mjs';
import * as SWMS from '../lib/swms.mjs';
import * as COMMS from '../lib/comms.mjs';
import * as REPORTS from '../lib/reports.mjs';
import * as U from '../lib/users.mjs';
import * as SUB from '../lib/subbies.mjs';
import * as PPL from '../lib/people.mjs';
import * as BOM from '../lib/bom.mjs';

const ok = () => new Response('', { status: 202 });
export default async (req) => {
  let id = '';
  try {
    if (req.method !== 'POST' || req.headers.get('x-mbs-admin') !== '1') return new Response('', { status: 403 });
    await A.ensureSecret();
    const session = A.readSession(req);
    if (!session) return new Response('', { status: 401 });
    const ctx = await U.context(session, '', (pid, u) => (u && u.kind === 'google' ? !!String(process.env.GOOGLE_CLIENT_ID || '').trim() : u && u.kind === 'subbie' ? SUB.canLogin(u.subId) : PPL.canLogin(pid)));   // v86: Users & access
    if (!ctx) return new Response('', { status: 401 });
    let body = {};
    try { body = await req.json(); } catch { return new Response('', { status: 400 }); }
    id = String(body.id || '').replace(/[^a-z0-9]/gi, '').slice(0, 40);
    if (id.length < 12) return new Response('', { status: 400 });
    if (!U.allowsBg(ctx, body.mode)) return new Response('', { status: 403 });
    if (ctx.scope && !ctx.scope.includes(String(body.core || ''))) return new Response('', { status: 403 });   // v91: a sub-contractor: their own project only
    await kv.set('aiplan:' + id, { status: 'working', at: Date.now() });
    if (body.mode === 'swms') {   // v57: 🦺 write the SWMS from the project plan
      const r = await SWMS.generate({ core: body.core }, `Admin (${session.u})`);
      await kv.set('aiplan:' + id, { swms: r.swms ? true : false, error: r.error, tokens: r.tokens, cutOff: r.cutOff, status: r.error ? 'error' : 'done', at: Date.now() });
      if (!r.error) await A.audit(session.u, `AI wrote the SWMS for ${String(body.core || '').slice(0, 20)} (${r.tokens || 0} tokens)`);
      return ok();
    }
    if (body.mode === 'report') {   // v62: ✨ the wording of a report, for its audience
      const r = await REPORTS.write({ core: body.core, facts: body.facts }, `Admin (${session.u})`);
      await kv.set('aiplan:' + id, { words: r.error ? null : r, error: r.error, status: r.error ? 'error' : 'done', at: Date.now() });
      return ok();
    }
    if (body.mode === 'meet') {   // v60: 📞 what a meeting transcript means for the plan
      const r = await COMMS.analyse({ core: body.core, id: body.meeting }, `Admin (${session.u})`);
      await kv.set('aiplan:' + id, { analysis: r.error ? null : r, error: r.error, status: r.error ? 'error' : 'done', at: Date.now() });
      if (!r.error) await A.audit(session.u, `AI analysed meeting "${String(r.meeting.title).slice(0, 60)}" on ${String(body.core || '').slice(0, 20)} (${r.tokens || 0} tokens)`);
      return ok();
    }
    if (body.mode === 'intel') {   // v52: 🧠 Project Intelligence question
      const r = await INTEL.ask({ core: body.core, question: body.question, history: body.history }, `Admin (${session.u})`);
      await kv.set('aiplan:' + id, { intel: r, error: r.error, status: r.error ? 'error' : 'done', at: Date.now() });
      if (!r.error) await A.audit(session.u, `Project Intelligence question on ${String(body.core || '').slice(0, 20)} (${r.tokens || 0} tokens)`);
      return ok();
    }
    if (body.mode === 'cr') {   // v82: 🔁 the impact of a change request
      const r = await COMMS.assessChange({ core: body.core, title: body.title, text: body.text }, `Admin (${session.u})`);
      await kv.set('aiplan:' + id, { cr: r.error ? null : r, error: r.error, status: r.error ? 'error' : 'done', at: Date.now() });
      if (!r.error) await A.audit(session.u, `AI assessed a change request on ${String(body.core || '').slice(0, 20)} (${r.tokens || 0} tokens)`);
      return ok();
    }
    if (body.mode === 'bom') {   // v89: ✨ the AI drafts the Bill of Materials
      const r = await BOM.draft({ core: body.core, note: body.note, only: body.only }, `Admin (${session.u})`);
      await kv.set('aiplan:' + id, { bom: r.error ? null : r, error: r.error, status: r.error ? 'error' : 'done', at: Date.now() });
      if (!r.error) await A.audit(session.u, `AI drafted a BOM for ${String(body.core || '').slice(0, 20)}: ${r.lines.length} lines (${r.tokens || 0} tokens)`);
      return ok();
    }
    if (body.mode === 'cost') {   // v78: ✨ indicative costs (benchmarks) for tasks
      const r = await costEstimate({ core: body.core, ids: body.ids, note: body.note, target: body.target }, `Admin (${session.u})`);
      await kv.set('aiplan:' + id, { cost: r.error ? null : r, error: r.error, status: r.error ? 'error' : 'done', at: Date.now() });
      if (!r.error) await A.audit(session.u, `AI indicative costs for ${r.costs.length} tasks on ${String(body.core || '').slice(0, 20)} (${r.tokens || 0} tokens)`);
      return ok();
    }
    if (body.mode === 'charter') {   // v76: ✨ the charter's words (sections 2 to 6)
      const r = await charterEnhance({ core: body.core, fields: body.fields, mode: body.how, note: body.note, texts: body.texts }, `Admin (${session.u})`);
      await kv.set('aiplan:' + id, { charter: r.error ? null : r, error: r.error, status: r.error ? 'error' : 'done', at: Date.now() });
      if (!r.error) await A.audit(session.u, `AI ${r.mode === 'grammar' ? 'corrected' : r.mode === 'expand' ? 'expanded' : 'improved'} the charter (${Object.keys(r.fields).join(', ')}) on ${String(body.core || '').slice(0, 20)} (${r.tokens || 0} tokens)`);
      return ok();
    }
    if (body.mode === 'fit') {   // v38: fit an existing plan to its "Finish by" date
      const r = await fitPlanAi({ core: body.core, finishBy: body.finishBy }, `Admin (${session.u})`);
      await kv.set('aiplan:' + id, { fit: r, error: r.error, status: r.error ? 'error' : 'done', at: Date.now() });
      if (!r.error && !r.already) await A.audit(session.u, `AI suggested how to fit plan ${String(body.core || '').slice(0, 20)} to finish by ${r.finishBy} (${r.tokens || 0} tokens)`);
      return ok();
    }
    const r = await buildAiPlan({ core: body.core, describe: body.describe, scope: body.scope, type: body.type, start: body.start, finish: body.finish, emergency: !!body.emergency, weekends: !!body.weekends }, `Admin (${session.u})`);
    await kv.set('aiplan:' + id, { ...r, status: r.error ? 'error' : 'done', at: Date.now() });
    if (!r.error) await A.audit(session.u, `AI built a plan draft for ${String(body.core || '').slice(0, 20)} (${r.tokens || 0} tokens)`);
  } catch (e) {
    console.error('AI plan failed:', e);
    if (id) { try { await kv.set('aiplan:' + id, { status: 'error', error: 'The AI plan could not be made: ' + e.message, at: Date.now() }); } catch {} }
  }
  return ok();   // never an error status: Netlify would retry a failed background function
};
