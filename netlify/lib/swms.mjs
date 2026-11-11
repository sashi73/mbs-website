// v57: 🦺 Safe Work Method Statement (SWMS) for a project. Generated from the project plan by the AI (DeepSeek), then
// edited in its own page in the console and downloaded as Word or PDF.
//   swms:<core>   the SWMS document (details, high-risk construction work, job steps with hazards / controls, PPE,
//                 plant, licences, emergency, consultation and review, sign-on sheet)
// Based on the NSW Work Health and Safety Regulation 2017, Part 6.3 (high-risk construction work, regs 291 and 299-300).
// The customer's name, phone and email are never sent to the AI.
import * as kv from './kv.mjs';
import * as J from './jobs.mjs';
import * as P from './plan.mjs';
import { business } from './pdf.mjs';
import { llmJson, usage, checkLimit, llmSetup, sydToday } from './ai.mjs';
import { env } from './shared.mjs';

const str = (s, max = 300) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
const ymd = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : '');
const H = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const out = (status, body) => new Response(JSON.stringify(body), { status, headers: H });

// high-risk construction work, WHS Regulation 2017 (NSW) reg 291
export const HRCW = [
  ['a', 'Risk of a person falling more than 2 metres'], ['b', 'Work on a telecommunication tower'],
  ['c', 'Demolition of a load-bearing element or one related to the structure\'s physical integrity'], ['d', 'Likely to disturb asbestos'],
  ['e', 'Structural alterations or repairs that need temporary support to prevent collapse'], ['f', 'In or near a confined space'],
  ['g', 'In or near a shaft or trench deeper than 1.5 m, or a tunnel'], ['h', 'Use of explosives'],
  ['i', 'On or near pressurised gas distribution mains or piping'], ['j', 'On or near chemical, fuel or refrigerant lines'],
  ['k', 'On or near energised electrical installations or services'], ['l', 'In an area that may have a contaminated or flammable atmosphere'],
  ['m', 'Tilt-up or precast concrete'], ['n', 'On, in or next to a road, railway, shipping lane or other traffic corridor in use'],
  ['o', 'In an area with movement of powered mobile plant'], ['p', 'In an area with artificial extremes of temperature'],
  ['q', 'In or near water or other liquid with a risk of drowning'], ['r', 'Diving work']];
const RISK = ['Low', 'Medium', 'High', 'Extreme'];
const risk = (v) => (RISK.includes(v) ? v : RISK.find((r) => r.toLowerCase() === String(v || '').toLowerCase()) || 'Medium');
const lines = (v, n, m) => (Array.isArray(v) ? v : String(v || '').split('\n')).map((x) => str(x, m).replace(/^[-•*]\s*/, '')).filter(Boolean).slice(0, n);

export function clean(d = {}, old = {}) {
  const D = d.details || {};
  return {
    version: Math.max(1, Math.round(Number(d.version) || old.version || 1)), status: ['Draft', 'Issued'].includes(d.status) ? d.status : 'Draft',
    created: old.created || Number(d.created) || Date.now(), generated: Number(d.generated) || old.generated || 0, edited: !!d.edited,
    details: { business: str(D.business, 120), abn: str(D.abn, 30), licence: str(D.licence, 40), principal: str(D.principal, 120), site: str(D.site, 200), job: str(D.job, 40),
      project: str(D.project, 160), work: str(D.work, 1500), start: ymd(D.start), finish: ymd(D.finish), preparedBy: str(D.preparedBy, 80), preparedOn: ymd(D.preparedOn),
      supervisor: str(D.supervisor, 80), supervisorPhone: str(D.supervisorPhone, 40), review: ymd(D.review) },
    hrcw: (Array.isArray(d.hrcw) ? d.hrcw : []).filter((k) => HRCW.some((h) => h[0] === k)),
    hrcwNotes: str(d.hrcwNotes, 600),
    steps: (Array.isArray(d.steps) ? d.steps : []).slice(0, 80).map((s) => ({ step: str(s.step, 300), hazards: str(s.hazards, 1200), risk: risk(s.risk), controls: str(s.controls, 2500), residual: risk(s.residual), who: str(s.who, 120) })),
    ppe: lines(d.ppe, 30, 120), plant: lines(d.plant, 30, 200), quals: lines(d.quals, 30, 200),
    emergency: { firstAid: str((d.emergency || {}).firstAid, 300), assembly: str((d.emergency || {}).assembly, 300), hospital: str((d.emergency || {}).hospital, 300), contacts: str((d.emergency || {}).contacts, 500), plan: str((d.emergency || {}).plan, 1500) },
    monitor: str(d.monitor, 2000), consultation: str(d.consultation, 1500),
    signon: (Array.isArray(d.signon) ? d.signon : []).slice(0, 60).map((s) => ({ name: str(s.name, 80), company: str(s.company, 120), date: ymd(s.date) })),
    updated: Date.now()
  };
}

const SYS = 'You are a NSW construction WHS adviser writing a Safe Work Method Statement (SWMS) under the Work Health and Safety Regulation 2017 (NSW), Part 6.3, for the PCBU and principal contractor named on the project. ' +
  'From the project plan, work out which HIGH-RISK CONSTRUCTION WORK categories apply (codes a-r from the list given; only those that really apply), then write the job steps in order: one step per task or main sub-step of the plan that has a real hazard (skip office tasks like "quote accepted" and "invoice"). ' +
  'For each step: the hazards (short, specific: e.g. fall from ladder, silica dust from cutting tiles, live wires, manual handling of 20 kg bags), the risk before controls (Low|Medium|High|Extreme), the control measures using the hierarchy of controls (eliminate, substitute, isolate, engineering, administrative, PPE; "- " lines, specific to this job, naming the Australian Standard or code of practice where useful), the risk after controls, and who is responsible (a role, e.g. Site supervisor, Tiler, Licensed electrician). ' +
  'Also: PPE needed, plant and equipment with pre-start checks, licences / tickets / training needed (e.g. white card, high-risk work licence, working at heights), emergency arrangements (first aid, assembly point, nearest hospital emergency department: say "check nearest" if unsure), how the SWMS is implemented, monitored and reviewed, and how workers are consulted. ' +
  'Australian spelling. Be practical and specific to this job; do not invent site facts. Reply JSON only: {"work":"short description of the work","hrcw":["a"],"hrcw_notes":"why these apply","steps":[{"step":"","hazards":"","risk":"High","controls":"- ","residual":"Low","who":""}],' +
  '"ppe":[""],"plant":["item: pre-start checks"],"quals":[""],"emergency":{"first_aid":"","assembly":"","hospital":"","plan":"- "},"monitor":"- ","consultation":"- "}';
const cap = () => Math.max(2000, Math.min(16000, Number(env('AI_SWMS_MAX_TOKENS', '7000')) || 7000));

export async function generate({ core }, by) {
  const job = await J.find(core); if (!job) return { error: 'Job not found' };
  const plan = await P.get(job.core); if (!plan) return { error: 'This job has no plan yet. Make the plan first.' };
  if (!llmSetup()) return { error: 'AI is not set up yet: add LLM_API_KEY (DeepSeek) in Netlify.' };
  try { await checkLimit(); } catch (e) { return { error: e.message }; }
  const R = P.rollup(JSON.parse(JSON.stringify(plan)), sydToday());
  const sc = (s) => P.privateOut(P.scrubTask(String(s || ''), job), job);
  let names = {}; try { const ix = await kv.get('inv-index'); names = Object.fromEntries(Object.values((ix && ix.items) || {}).map((i) => [i.id, i.name])); } catch {}
  const user = {
    hrcw_list: HRCW.map((h) => h[0] + ': ' + h[1]), work: sc(job.service || ''), suburb: job.suburb || '', project: sc(plan.name), start: R.start, finish: R.finish, emergency: !!plan.emergency,
    scope: sc((plan.charter || {}).inScope || '').slice(0, 2500), out_of_scope: sc((plan.charter || {}).outScope || '').slice(0, 800),
    trades: (plan.stakeholders || []).map((s) => sc(s.role)).filter(Boolean).slice(0, 20),
    tasks: plan.tasks.slice(0, 120).map((t) => ({ task: sc(t.name), days: t.dur, who: sc(t.resource || (t.res || []).join(', ')), steps: (t.subs || []).map((x) => sc(x.name)).slice(0, 10),
      materials: (t.mats || []).map((m) => names[m.item] || '').filter(Boolean).slice(0, 10), notes: sc(t.notes || '').slice(0, 200) })),
    risks: (plan.risks || []).map((r) => sc(r.title)).slice(0, 20)
  };
  let o, used, cutOff = false;
  try { ({ data: o, used, cutOff } = await llmJson([{ role: 'system', content: SYS }, { role: 'user', content: JSON.stringify(user) }], { maxTokens: cap(), timeoutMs: 480000, temperature: 0.2 })); }
  catch (e) { return { error: e.message }; }
  const today = await usage(true, used);
  const B = business(), old = (await kv.get('swms:' + job.core)) || {};
  const E = o.emergency || {};
  const doc = clean({
    version: old.version ? old.version + 1 : 1, status: 'Draft', generated: Date.now(), edited: false,
    details: { business: B.name, abn: B.abn, licence: B.licence, principal: B.name, site: [job.address, job.suburb].filter(Boolean).join(', '), job: J.refFor(job), project: plan.name,
      work: str(o.work, 1500) || plan.name, start: R.start, finish: R.finish, preparedBy: String(by || '').replace(/^Admin \((.*)\)$/, '$1'), preparedOn: sydToday(),
      supervisor: (plan.charter || {}).manager || '', supervisorPhone: B.phone, review: '' },
    hrcw: (Array.isArray(o.hrcw) ? o.hrcw : []).map((k) => String(k).trim().toLowerCase().slice(0, 1)), hrcwNotes: o.hrcw_notes,
    steps: (Array.isArray(o.steps) ? o.steps : []).map((s) => ({ ...s, controls: Array.isArray(s.controls) ? s.controls.map((x) => '- ' + String(x).replace(/^[-•]\s*/, '')).join('\n') : s.controls })),
    ppe: o.ppe, plant: o.plant, quals: o.quals,
    emergency: { firstAid: E.first_aid, assembly: E.assembly, hospital: E.hospital, contacts: '000 (Police, Fire, Ambulance)\nSite supervisor: ' + B.phone + '\nSafeWork NSW: 13 10 50', plan: Array.isArray(E.plan) ? E.plan.join('\n') : E.plan },
    monitor: Array.isArray(o.monitor) ? o.monitor.join('\n') : o.monitor, consultation: Array.isArray(o.consultation) ? o.consultation.join('\n') : o.consultation,
    signon: Array.from({ length: 8 }, () => ({ name: '', company: '', date: '' }))
  }, old);
  if (!doc.steps.length) return { error: 'The AI did not return any job steps. Try again.', tokens: used, today };
  await kv.set('swms:' + job.core, doc);
  return { swms: doc, tokens: used, today, cutOff };
}

export async function swmsPost(action, body, { who, by, audit }) {
  if (!/^swms/.test(action)) return null;
  const job = await J.find(str(body.core, 30)); if (!job) return out(404, { error: 'Job not found' });
  const core = job.core;
  switch (action) {
    case 'swmsGet': {
      const [doc, plan] = await Promise.all([kv.get('swms:' + core), P.get(core)]);
      return out(200, { swms: doc || null, hrcw: HRCW, job: { core, ref: J.refFor(job), name: job.name, suburb: job.suburb, service: job.service }, plan: plan ? { name: plan.name, tasks: plan.tasks.length, rev: plan.rev || 0 } : null });
    }
    case 'swmsSave': {
      const old = (await kv.get('swms:' + core)) || {};
      const doc = clean({ ...(body.swms || {}), edited: true }, old);
      await kv.set('swms:' + core, doc);
      if (audit && body.status && body.status !== old.status) await audit(who, `SWMS for ${core} marked ${doc.status}`);
      return out(200, { swms: doc });
    }
    case 'swmsDelete': { await kv.del('swms:' + core); if (audit) await audit(who, `SWMS for ${core} deleted`); return out(200, { ok: true }); }
    default: return null;
  }
}
