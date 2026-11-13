// GKH Project Champ: Programs (the top level) and dependencies between projects.
// Programs: kv 'champ-programs' { list: [{ id, name, manager, sponsor, objective, status, color, start, finish, created, updated }] }.
// A project belongs to exactly one program (the program's name is kept on the project as job.program).
// Dependencies: kv 'champ-deps' { list: [{ id, from, to, type: 'FS'|'SS'|'FF', lag, note, created, by }] } between projects (cores).
import * as kv from './kv.mjs';
import * as J from './jobs.mjs';
import { randomBytes } from 'node:crypto';

export const DEFAULT = 'General program';
export const STATUS = { active: 'Active', hold: 'On hold', closed: 'Closed', proposed: 'Proposed' };
export const TYPES = { FS: 'Finish to start', SS: 'Start to start', FF: 'Finish to finish' };
const COLORS = ['#C9A227', '#3B82F6', '#10B981', '#8B5CF6', '#EF4444', '#F97316', '#14B8A6', '#EC4899', '#64748B', '#84CC16'];
const id = () => 'pg' + randomBytes(5).toString('hex');
const s = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, n);
const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '');

export async function list() { return ((await kv.get('champ-programs').catch(() => null)) || { list: [] }).list; }
export async function deps() { return ((await kv.get('champ-deps').catch(() => null)) || { list: [] }).list; }

// Every project in a program, and every program used by a project on the register (older builds kept programs as a free label).
export async function ensure(cards) {
  const have = await list(), names = new Set(have.map((p) => p.name.toLowerCase()));
  const missing = [...new Set(cards.map((c) => c.program).filter((n) => n && !names.has(n.toLowerCase())))];
  const orphans = cards.filter((c) => !c.program);
  if (orphans.length && !names.has(DEFAULT.toLowerCase()) && !missing.includes(DEFAULT)) missing.push(DEFAULT);
  if (missing.length) {
    await kv.update('champ-programs', (cur) => {
      for (const n of missing) if (!cur.list.some((p) => p.name.toLowerCase() === n.toLowerCase()))
        cur.list.push({ id: id(), name: n, manager: '', sponsor: '', objective: n === DEFAULT ? 'Projects not yet grouped into a program.' : '', status: 'active', color: COLORS[cur.list.length % COLORS.length], start: '', finish: '', created: Date.now(), updated: Date.now() });
      return cur;
    }, { list: [] });
  }
  for (const c of orphans) { await J.setProgram(c.core, DEFAULT); c.program = DEFAULT; }
  return list();
}

export async function save(body, who) {
  const name = s(body.name, 80);
  if (!name) throw Object.assign(new Error('Give the program a name.'), { code: 400 });
  const pid = s(body.id, 20);
  let res = null, renamed = null;
  await kv.update('champ-programs', (cur) => {
    const clash = cur.list.find((p) => p.name.toLowerCase() === name.toLowerCase() && p.id !== pid);
    if (clash) throw Object.assign(new Error(`There is already a program called “${clash.name}”.`), { code: 409 });
    let p = pid ? cur.list.find((x) => x.id === pid) : null;
    if (pid && !p) throw Object.assign(new Error('That program is no longer there.'), { code: 404 });
    if (!p) { p = { id: id(), created: Date.now(), color: COLORS[cur.list.length % COLORS.length] }; cur.list.push(p); }
    if (p.name && p.name !== name) renamed = { from: p.name, to: name };
    Object.assign(p, { name, manager: s(body.manager, 80), sponsor: s(body.sponsor, 80), objective: s(body.objective, 600), status: STATUS[body.status] ? body.status : (p.status || 'active'),
      color: /^#[0-9a-f]{6}$/i.test(body.color || '') ? body.color : p.color, start: day(body.start), finish: day(body.finish), updated: Date.now(), updatedBy: who || '' });
    res = { ...p }; return cur;
  }, { list: [] });
  if (renamed) for (const j of await J.all()) if (j.program === renamed.from) await J.setProgram(j.core, renamed.to);   // the projects follow the new name
  return { program: res, renamed };
}

// Delete a program: its projects move to another program first (a project must always belong to one).
export async function remove(pid, moveTo) {
  const all = await list(), p = all.find((x) => x.id === pid);
  if (!p) throw Object.assign(new Error('That program is no longer there.'), { code: 404 });
  const jobs = (await J.all()).filter((j) => j.program === p.name && j.stage !== 'lost');
  let target = null;
  if (jobs.length) {
    target = all.find((x) => x.id === moveTo && x.id !== pid);
    if (!target) throw Object.assign(new Error(`“${p.name}” still has ${jobs.length} project${jobs.length === 1 ? '' : 's'}. Choose the program they should move to.`), { code: 409 });
    for (const j of jobs) await J.setProgram(j.core, target.name);
  }
  await kv.update('champ-programs', (cur) => { cur.list = cur.list.filter((x) => x.id !== pid); return cur; }, { list: [] });
  return { moved: jobs.length, to: target && target.name };
}

export async function move(core, pid) {
  const p = (await list()).find((x) => x.id === pid || x.name === pid);
  if (!p) throw Object.assign(new Error('Choose a program: every project belongs to one.'), { code: 400 });
  if (!(await J.find(core))) throw Object.assign(new Error('Project not found'), { code: 404 });
  await J.setProgram(core, p.name);
  return p;
}

// ---------- dependencies ----------
export async function depSave(body, cardsByCore, who) {
  const from = s(body.from, 40), to = s(body.to, 40), type = TYPES[body.type] ? body.type : 'FS';
  const lag = Math.max(-365, Math.min(365, Math.round(Number(body.lag) || 0)));
  if (!from || !to || from === to) throw Object.assign(new Error('Choose two different projects.'), { code: 400 });
  if (!cardsByCore[from] || !cardsByCore[to]) throw Object.assign(new Error('One of those projects is no longer there.'), { code: 404 });
  let res = null;
  await kv.update('champ-deps', (cur) => {
    const did = s(body.id, 20);
    if (cur.list.some((d) => d.from === from && d.to === to && d.id !== did)) throw Object.assign(new Error('Those two projects are already linked.'), { code: 409 });
    // no circles: "to" must not already lead back to "from"
    const next = {}; for (const d of cur.list) if (d.id !== did) (next[d.from] = next[d.from] || []).push(d.to);
    const seen = new Set(), stack = [to];
    while (stack.length) { const c = stack.pop(); if (c === from) throw Object.assign(new Error(`That would make a loop: ${cardsByCore[to].name} already leads back to ${cardsByCore[from].name}.`), { code: 409 }); if (seen.has(c)) continue; seen.add(c); (next[c] || []).forEach((x) => stack.push(x)); }
    let d = did ? cur.list.find((x) => x.id === did) : null;
    if (!d) { d = { id: 'dp' + randomBytes(5).toString('hex'), created: Date.now(), by: who || '' }; cur.list.push(d); }
    Object.assign(d, { from, to, type, lag, note: s(body.note, 300), updated: Date.now() });
    res = { ...d }; return cur;
  }, { list: [] });
  return res;
}
export async function depRemove(ids) {
  const set = new Set([].concat(ids || []).map(String)); let n = 0;
  await kv.update('champ-deps', (cur) => { const b = cur.list.length; cur.list = cur.list.filter((d) => !set.has(d.id)); n = b - cur.list.length; return cur; }, { list: [] });
  return n;
}
export async function forgetProject(core) {   // a project was deleted: its links go too
  await kv.update('champ-deps', (cur) => { cur.list = cur.list.filter((d) => d.from !== core && d.to !== core); return cur; }, { list: [] });
}

// Dates: plans give start/finish; a project running behind (SPI under 1) is forecast to finish later in proportion.
const toD = (x) => (x ? Date.parse(x + 'T00:00:00Z') : NaN), toS = (t) => new Date(t).toISOString().slice(0, 10), DAY = 864e5;
export function forecastFinish(c) {
  if (!c || !c.finish) return '';
  if (c.pct >= 100 || c.phase === 'close') return c.finish;
  if (c.SPI && c.SPI > 0 && c.SPI < 1 && c.start) {
    const a = toD(c.start), b = toD(c.finish), len = Math.max(1, b - a);
    return toS(a + Math.min(len * 3, len / c.SPI));
  }
  return c.finish;
}
// Status of one link: ok · risk (forecast or a slipping predecessor threatens it) · conflict (the plans already clash) · done · unknown (no dates yet)
export function depStatus(d, A, B) {
  if (!A || !B) return { status: 'unknown', why: 'One of the projects is no longer there.' };
  if (A.pct >= 100 || A.phase === 'close') return { status: 'done', why: `${A.name} is finished, so ${B.name} is free to go.`, slack: null };
  const lag = d.lag || 0, L = (t) => t + lag * DAY;
  const pick = { FS: [A.finish, B.start, forecastFinish(A)], SS: [A.start, B.start, A.start], FF: [A.finish, B.finish, forecastFinish(A)] }[d.type || 'FS'];
  const [aPlan, bNeed, aFore] = pick;
  if (!aPlan || !bNeed) return { status: 'unknown', why: `Needs dates in both plans (${!aPlan ? A.name : B.name} has no schedule yet).`, slack: null };
  const slackPlan = Math.round((toD(bNeed) - L(toD(aPlan))) / DAY), slackFore = Math.round((toD(bNeed) - L(toD(aFore))) / DAY);
  const what = { FS: ['finishes', 'starts'], SS: ['starts', 'starts'], FF: ['finishes', 'finishes'] }[d.type || 'FS'];
  const lagTxt = lag ? ` (+${lag} day${Math.abs(lag) === 1 ? '' : 's'} lag)` : '';
  if (slackPlan < 0) return { status: 'conflict', slack: slackPlan, why: `The plans clash: ${A.name} ${what[0]} ${aPlan}${lagTxt}, ${-slackPlan} day${slackPlan === -1 ? '' : 's'} after ${B.name} ${what[1]} (${bNeed}).` };
  if (slackFore < 0) return { status: 'risk', slack: slackFore, why: `${A.name} is running behind (SPI ${A.SPI.toFixed(2)}): forecast to ${what[0].replace(/s$/, '')} ${aFore}, ${-slackFore} day${slackFore === -1 ? '' : 's'} after ${B.name} ${what[1]} (${bNeed}).` };
  if (slackPlan <= 5 && (A.health === 'red' || A.health === 'amber')) return { status: 'risk', slack: slackPlan, why: `Only ${slackPlan} day${slackPlan === 1 ? '' : 's'} of buffer, and ${A.name} needs watching.` };
  return { status: 'ok', slack: slackPlan, why: `${slackPlan} day${slackPlan === 1 ? '' : 's'} of buffer between ${A.name} and ${B.name}.` };
}
