// MBS Console v86: Users & access (a small "Active Directory").
// Only people in the People register (employees and contractors) can be given a login. Each user has a role, and for every
// module of the console an access level: none, view or edit. The server checks it on every request; the menu hides what a
// user can't open. The Netlify login (ADMIN_USERNAME / ADMIN_PASSWORD) is the Owner: it always works and can do everything,
// so nobody can be locked out.
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { store, ADMIN } from './admin-lib.mjs';
// accounts live in the private admin store (not the job store), so the Data explorer can never list them or their password hashes
const kv = {
  async get(k) { const s = await store(ADMIN); return s.get(k, { type: 'json' }); },
  async set(k, v) { const s = await store(ADMIN); await s.setJSON(k, v); },
  async del(k) { const s = await store(ADMIN); await s.delete(k); },
  async update(k, fn, fallback) { const cur = (await this.get(k)) || (fallback ? fallback() : null); const next = fn(cur); await this.set(k, next); return next; } };

const str = (s, max = 300) => String(s ?? '').replace(/[\u0000-\u001F]/g, '').trim().slice(0, max);
const H = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const out = (status, body) => new Response(JSON.stringify(body), { status, headers: H });

// ---------- modules and access levels ----------
export const MODS = [
  ['crm', 'Jobs & customers', 'Dashboard, jobs, customers, new jobs and reminders'],
  ['projects', 'Projects', 'Plans, Gantt chart, Board, scope, stakeholders, risks, comms, reports, SWMS, change control, Project Intelligence'],
  ['accounts', 'Accounts', 'Quotes, invoices, expenses, accounting and BAS'],
  ['subbies', 'Sub-contractors', 'Subbies, their licences and insurance'],
  ['people', 'People', 'Employees and contractors, tickets, rates and workload'],
  ['data', 'Data & AI', 'Ask AI, SQL wizard and reports, data explorer, activity log'],
  ['users', 'Users & access', 'Logins, roles and what each person can use']];
export const MOD_KEYS = MODS.map((m) => m[0]);
export const LEVELS = ['none', 'view', 'edit'];
const LV = { none: 0, view: 1, edit: 2 };
const all = (lv) => Object.fromEntries(MOD_KEYS.map((k) => [k, lv]));
export const ROLES = {
  Administrator: { ...all('edit') },
  'Project manager': { crm: 'edit', projects: 'edit', accounts: 'view', stock: 'edit', subbies: 'edit', people: 'view', data: 'view', users: 'none' },
  'Site supervisor': { crm: 'view', projects: 'edit', accounts: 'none', stock: 'view', subbies: 'view', people: 'view', data: 'none', users: 'none' },
  Accounts: { crm: 'view', projects: 'view', accounts: 'edit', stock: 'view', subbies: 'view', people: 'view', data: 'view', users: 'none' },
  'Read only': { ...all('view'), users: 'none' },
  Guest: { ...all('none'), crm: 'view', projects: 'view' },   // v88: for trying the console out
  'Sub-contractor': { ...all('none'), projects: 'edit' },   // v91: a subbie: only their own project(s), nothing else
  Custom: null };
export const ROLE_KEYS = Object.keys(ROLES);
export const OWNER_MODS = all('edit');

// which module (and level) an action needs. null = any signed-in user (me, logout, own password).
const READ = /^(dashboard|jobs|job|reminders|report|stores|dataList|dataGet|log|pipelineBoard|aiPing|sqlUsage|sqlAsk|sqlAnswer|sqlData|sqlNarrative|sqlPdf|docForJob|docGet)$|(List|Lists|Get|Log|Status|Setup|Analysis|Info|Jobs|Insights|For|Usage|Analyse|Report|Export|Assign)$/;
export function need(action) {
  const a = String(action || '');
  if (['me', 'logout', 'login', 'userPassword'].includes(a)) return null;
  let mod;
  if (a === 'quoteStart' || a === 'planQuote') mod = 'accounts';
  else if (/^(dashboard|jobs|job|stage|note|create|reminders|remind|unremind|report|pipelineBoard)$/.test(a) || /^(cust|promo)[A-Z]/.test(a)) mod = 'crm';
  else if (/^(plan|comms|intel|swms|board)[A-Z]/.test(a) || /^report[A-Z]/.test(a)) mod = 'projects';
  else if (/^(acct|doc|exp|pay)[A-Z]/.test(a)) mod = 'accounts';
  else if (/^(inv|sup)[A-Z]/.test(a)) mod = 'stock';
  else if (/^sub[A-Z]/.test(a)) mod = 'subbies';
  else if (/^ppl[A-Z]/.test(a)) mod = 'people';
  else if (/^prl[A-Z]/.test(a)) return { mod: 'people', level: 'edit' };
  else if (/^lv(Mine|Request|Cancel)$/.test(a)) return null;   // v108: anyone signed in asks for their own leave
  else if (/^lv[A-Z]/.test(a)) return { mod: 'people', level: 'edit' };   // managers approve and see everyone's   // v107: payroll is people's pay: edit access only, even to look
  else if (/^user[A-Z]/.test(a)) mod = 'users';
  else if (/^(sql[A-Z]|data[A-Z]|stores$|rebuildIndex$|log$|aiPing$)/.test(a)) mod = 'data';
  else mod = 'users';   // anything not listed: administrators only
  if (a === 'planQuoteInfo') mod = 'projects';
  return { mod, level: READ.test(a) && !/^(planQuote|quoteStart)$/.test(a) ? 'view' : 'edit' };
}
// reads other modules need to work (the plan page shows subbies, stock, people and the job's quote / invoice)
const SUPPORT = { subList: ['projects', 'people', 'users'], invList: ['projects'], invGet: ['projects'], pplList: ['projects', 'subbies', 'crm'], docForJob: ['projects', 'crm'], job: ['projects'],
  custFor: ['projects', 'accounts'], custGet: ['accounts'], custList: ['accounts'], planList: ['people', 'users'], pplAssign: ['projects'], dashboard: [] };
export function allows(ctx, action) {
  if (!ctx) return { ok: false };
  if (ctx.owner) return { ok: true };
  const n = need(action); if (!n) return { ok: true };
  const have = LV[(ctx.mods || {})[n.mod]] || 0;
  if (have >= LV[n.level]) return { ok: true };
  if (n.level === 'view' && (SUPPORT[action] || []).some((m) => LV[(ctx.mods || {})[m]] >= 1)) return { ok: true };
  const name = (MODS.find((m) => m[0] === n.mod) || [])[1] || n.mod;
  return { ok: false, mod: n.mod, error: have ? `You have view-only access to ${name}. Ask an administrator for edit access.` : `You don't have access to ${name}. Ask an administrator.` };
}
// the AI background jobs: Project Intelligence questions need view, everything else (plans, costs, charter ...) edit
export function allowsBg(ctx, mode) {
  if (!ctx) return false; if (ctx.owner) return true;
  const lv = LV[(ctx.mods || {}).projects] || 0;
  return mode === 'intel' ? lv >= 1 : lv >= 2;
}

// ---------- passwords ----------
export function hashPw(pw) { const salt = randomBytes(16).toString('hex'); return { salt, hash: scryptSync(String(pw), salt, 32).toString('hex') }; }
function checkPw(u, pw) {
  if (!u || !u.salt || !u.hash) return false;
  const a = scryptSync(String(pw || ''), u.salt, 32), b = Buffer.from(u.hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
export function pwProblem(pw) {
  pw = String(pw || '');
  if (pw.length < 10) return 'Use at least 10 characters';
  if (!/[a-z]/i.test(pw) || !/\d/.test(pw)) return 'Use letters and at least one number';
  return '';
}
export function tempPassword() {   // easy to read out: no 0/O, 1/l
  const A = 'abcdefghjkmnpqrstuvwxyz', D = '23456789', b = randomBytes(12); let s = '';
  for (let i = 0; i < 12; i++) s += i === 4 || i === 9 ? D[b[i] % D.length] : A[b[i] % A.length];
  return s.slice(0, 4) + '-' + s.slice(4, 8) + '-' + s.slice(8);
}

// ---------- users ----------
const cleanMods = (m, role) => { const base = ROLES[role] || null, o = {}; for (const k of MOD_KEYS) { const v = (m || {})[k]; o[k] = LEVELS.includes(v) ? v : base ? base[k] : 'none'; } return o; };
const summary = (u) => ({ id: u.id, personId: u.personId, name: u.name, username: u.username, email: u.email, role: u.role, mods: u.mods, active: u.active, mustChange: !!u.mustChange, lastLogin: u.lastLogin || 0, created: u.created,
  kind: u.kind || 'person', subId: u.subId || '', projects: u.projects || [] });
// v91: a sub-contractor login: Projects only (view or edit), and only the projects it was given
const subMods = (lv) => ({ ...all('none'), projects: lv === 'view' ? 'view' : 'edit' });
// v97: "Sign in with Google" (test site): anyone with a verified Google account gets View on every module, nothing in Users & access
export const GOOGLE_MODS = { ...all('view'), users: 'none' };
export async function googleUser(email, name, by) {
  email = str(email, 160).toLowerCase(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
  const hit = (await list()).find((x) => x.kind === 'google' && x.username === email);
  if (hit) { const u = await get(hit.id); if (!u || !u.active) return u ? { disabled: true } : null; u.lastLogin = Date.now(); if (name) u.name = str(name, 100); await put(u); return u; }
  if ((await list()).some((x) => x.username === email)) return { clash: true };   // a staff login already uses this email: they sign in with their password
  const n = await kv.update('user-seq', (x) => ({ n: ((x && x.n) || 0) + 1 }), () => ({ n: 0 }));
  const u = { id: 'U-' + String(n.n).padStart(3, '0'), kind: 'google', personId: '', name: str(name, 100) || email, email, username: email, role: 'Read only', mods: { ...GOOGLE_MODS }, active: true, mustChange: false,
    ver: 1, created: Date.now(), lastLogin: Date.now(), by: str(by, 60) || 'Google sign-in' };
  await put(u); return u;
}
// what a sub-contractor signed in to one project may do. Every request naming a project must be theirs; other requests only
// from this list (the plan page's own lookups). Money, people and other subbies' details stay out.
const SCOPE_FREE = new Set(['me', 'logout', 'userPassword', 'planList', 'planAiStatus', 'commsSetup', 'planBomTplList', 'planBomTplGet', 'invList', 'invGet']);
const SCOPE_DENY = new Set(['planDelete', 'planJobs', 'planQuote', 'planQuoteInfo', 'quoteStart', 'docToInvoice', 'docForJob', 'pipelineBoard', 'planBomTplSave', 'planBomTplDelete', 'pplList', 'pplAssign', 'subList', 'custFor', 'job']);
export function scopeCheck(ctx, action, body) {
  if (!ctx || !ctx.scope) return { ok: true };
  const a = String(action || ''), no = { ok: false, error: 'Sub-contractor logins can only work on their own project.' };
  if (SCOPE_DENY.has(a)) return no;
  const core = body && (body.core || (body.plan && body.plan.core));
  if (core) return ctx.scope.includes(String(core)) ? { ok: true } : no;
  return SCOPE_FREE.has(a) ? { ok: true } : no;
}
async function index() { return (await kv.get('user-index')) || { users: {} }; }
export async function list() { const i = await index(); return Object.values(i.users || {}).sort((a, b) => (a.name.toLowerCase() > b.name.toLowerCase() ? 1 : -1)); }
export async function get(id) { return /^U-\d{3,5}$/.test(id || '') ? kv.get('user:' + id) : null; }
async function put(u) { await kv.set('user:' + u.id, u); await kv.update('user-index', (x) => { x.users = x.users || {}; x.users[u.id] = summary(u); return x; }, () => ({ users: {} })); return u; }

// the signed-in user's access (or null when the login no longer works: disabled, password reset, removed from People)
export async function context(session, ownerName, personOk) {
  if (!session) return null;
  if (!session.uid) return { owner: true, who: session.u, uid: '', role: 'Owner', mods: OWNER_MODS, name: session.u };
  const u = await get(session.uid);
  if (!u || !u.active || (u.ver || 0) !== (session.v || 0)) return null;
  if (personOk && !(await personOk(u.personId, u))) return null;
  if (u.kind === 'google') return { owner: false, who: u.username, uid: u.id, role: 'Google (view only)', mods: { ...GOOGLE_MODS }, name: u.name, mustChange: false, personId: '', kind: 'google' };   // v97
  if (u.kind === 'subbie') {   // v91: signed in to one of their projects; nothing else
    if (!session.pc || !(u.projects || []).includes(session.pc)) return null;
    return { owner: false, who: u.username, uid: u.id, role: 'Sub-contractor', mods: subMods((u.mods || {}).projects), name: u.name, mustChange: !!u.mustChange, personId: '', subId: u.subId, kind: 'subbie', scope: [session.pc] };
  }
  return { owner: false, who: u.username, uid: u.id, role: u.role, mods: cleanMods(u.mods, u.role), name: u.name, mustChange: !!u.mustChange, personId: u.personId };
}
// v90: a person deleted from People: their login goes too
export async function removeForPerson(personId) {
  const gone = (await list()).filter((u) => u.personId === personId).map((u) => u.id);
  for (const id of gone) await kv.del('user:' + id);
  if (gone.length) await kv.update('user-index', (x) => { gone.forEach((id) => { if (x.users) delete x.users[id]; }); return x; }, () => ({ users: {} }));
  return gone;
}
export async function login(username, password, personOk) {
  const name = str(username, 160).toLowerCase(); if (!name) return null;
  const s = (await list()).find((x) => x.username === name || (x.email && x.email.toLowerCase() === name));
  if (!s || !s.active) return null;
  const u = await get(s.id); if (!u || !checkPw(u, password)) return null;
  if (personOk && !(await personOk(u.personId, u))) return null;
  u.lastLogin = Date.now(); await put(u);
  return u;
}

export async function userPost(action, body, { ctx, audit, person, sub, project }) {
  const log = (t) => (audit ? audit(ctx.who, t) : null);
  switch (action) {
    case 'userList': return out(200, { users: await list(), mods: MODS.map((m) => ({ key: m[0], name: m[1], about: m[2] })), roles: ROLE_KEYS.map((r) => ({ name: r, mods: ROLES[r] })), levels: LEVELS });
    case 'userSave': {
      const f = body.user || {}, id = /^U-\d{3,5}$/.test(f.id || '') ? f.id : '';
      const old = id ? await get(id) : null; if (id && !old) return out(404, { error: 'User not found' });
      if (old && old.kind === 'google') {   // v97: Google sign-ins are always view only: they can only be switched on or off
        const u = { ...old, active: f.active !== false, by: ctx.who, updated: Date.now() };
        if (old.active !== u.active) u.ver = (old.ver || 0) + 1;
        await put(u); await log(`Google sign-in ${u.active ? 'enabled' : 'disabled'}: ${u.username}`);
        return out(200, { user: summary(u), temp: '' });
      }
      if ((old && old.kind === 'subbie') || (!old && f.kind === 'subbie')) {   // v91: a sub-contractor: Projects only, their projects only
        const sc = sub ? await sub(str(f.subId || (old && old.subId), 12)) : null;
        if (!sc) return out(400, { error: 'Pick a sub-contractor from Subbies.' });
        if (sc.archived || sc.status === 'Do not use') return out(400, { error: sc.business + ' is archived or marked "Do not use" in Subbies.' });
        const projects = [];
        for (const c of (Array.isArray(f.projects) ? f.projects : []).slice(0, 30)) { const pj = project ? await project(str(c, 30)) : null; if (pj && !projects.includes(pj.core)) projects.push(pj.core); }
        if (!projects.length) return out(400, { error: 'Give them at least one project.' });
        const username = str(f.username || sc.email || (old && old.username), 160).toLowerCase();
        if (!/^[a-z0-9._@+-]{3,160}$/.test(username)) return out(400, { error: 'The username can use letters, numbers and . _ @ + - (at least 3). Add an email to the subbie, or type a username.' });
        const clash = (await list()).find((x) => x.id !== id && (x.username === username || (x.subId && x.subId === sc.id)));
        if (clash) return out(400, { error: clash.subId === sc.id ? sc.business + ' already has a login (' + clash.username + ').' : 'That username is taken.' });
        const mods = subMods(f.level || (old && old.mods && old.mods.projects));
        const u = { ...(old || {}), kind: 'subbie', subId: sc.id, personId: '', name: sc.contact ? sc.contact + ' (' + sc.business + ')' : sc.business, email: sc.email || '', username, role: 'Sub-contractor', mods, projects, active: f.active !== false, by: ctx.who, updated: Date.now() };
        let temp = '';
        if (!old) {
          const n = await kv.update('user-seq', (x) => ({ n: ((x && x.n) || 0) + 1 }), () => ({ n: 0 }));
          u.id = 'U-' + String(n.n).padStart(3, '0'); u.created = Date.now(); u.ver = 1;
          temp = tempPassword(); Object.assign(u, hashPw(temp)); u.mustChange = true;
        }
        if (old && (old.active !== u.active || JSON.stringify(old.mods) !== JSON.stringify(u.mods) || JSON.stringify(old.projects || []) !== JSON.stringify(projects))) u.ver = (old.ver || 0) + 1;
        await put(u);
        await log(`${old ? 'Sub-contractor login changed' : 'Sub-contractor login added'}: ${u.username} (${sc.business}), Projects ${mods.projects}, ${projects.length} project(s)${u.active ? '' : ', disabled'}`);
        return out(200, { user: summary(u), temp });
      }
      const p = await person(str(f.personId || (old && old.personId), 12));
      if (!p) return out(400, { error: 'Pick someone from People: only people in the register can have a login.' });
      if (p.archived || p.status === 'Inactive') return out(400, { error: p.name + ' is not active in People.' });
      const username = str(f.username || p.email || (old && old.username), 160).toLowerCase();
      if (!/^[a-z0-9._@+-]{3,160}$/.test(username)) return out(400, { error: 'The username can use letters, numbers and . _ @ + - (at least 3)' });
      const clash = (await list()).find((x) => x.id !== id && (x.username === username || x.personId === p.id));
      if (clash) return out(400, { error: clash.personId === p.id ? p.name + ' already has a login (' + clash.username + ').' : 'That username is taken.' });
      const role = ROLE_KEYS.includes(f.role) && f.role !== 'Sub-contractor' ? f.role : 'Read only';
      const mods = cleanMods(role === 'Custom' ? f.mods : ROLES[role], role);
      if (ctx.uid && id === ctx.uid && (mods.users !== 'edit' || f.active === false)) return out(400, { error: 'You can\'t take away your own access to Users & access.' });
      const u = { ...(old || {}), personId: p.id, name: p.name, email: p.email || '', username, role, mods, active: f.active !== false, by: ctx.who, updated: Date.now() };
      let temp = '';
      if (!old) {
        const n = await kv.update('user-seq', (x) => ({ n: ((x && x.n) || 0) + 1 }), () => ({ n: 0 }));
        u.id = 'U-' + String(n.n).padStart(3, '0'); u.created = Date.now(); u.ver = 1;
        temp = tempPassword(); Object.assign(u, hashPw(temp)); u.mustChange = true;
      }
      if (old && (old.active !== u.active || JSON.stringify(old.mods) !== JSON.stringify(u.mods))) u.ver = (old.ver || 0) + 1;   // signs them out, so the change takes effect now
      await put(u);
      await log(`${old ? 'User changed' : 'User added'}: ${u.username} (${u.name}), ${u.role}${u.active ? '' : ', disabled'}`);
      return out(200, { user: summary(u), temp });
    }
    case 'userReset': {
      const u = await get(str(body.id, 10)); if (!u) return out(404, { error: 'User not found' });
      if (u.kind === 'google') return out(400, { error: 'Google sign-ins have no password here: they sign in with their Google account.' });
      const temp = tempPassword(); Object.assign(u, hashPw(temp)); u.mustChange = true; u.ver = (u.ver || 0) + 1; await put(u);
      await log(`Password reset for ${u.username}`);
      return out(200, { user: summary(u), temp });
    }
    case 'userGuestLoad': {   // v88: test site only: a Guest login for each sample person, all with one test password
      if (!body.test) return out(403, { error: 'Guest logins can only be made on the test site.' });
      const pw = 'GuestTest2026', made = [], have = await list();
      for (const pid of (Array.isArray(body.personIds) ? body.personIds : []).slice(0, 20)) {
        const p = await person(str(pid, 12)); if (!p || !p.email || p.archived || have.some((x) => x.personId === p.id)) continue;
        const n = await kv.update('user-seq', (x) => ({ n: ((x && x.n) || 0) + 1 }), () => ({ n: 0 }));
        const u = { id: 'U-' + String(n.n).padStart(3, '0'), personId: p.id, name: p.name, email: p.email, username: p.email.toLowerCase(), role: 'Guest', mods: cleanMods(ROLES.Guest, 'Guest'), active: true,
          mustChange: false, ver: 1, created: Date.now(), by: ctx.who, guest: true, ...hashPw(pw) };
        await put(u); made.push(u.username);
      }
      await log(`Guest logins made for ${made.length} sample people`);
      return out(200, { made, password: made.length ? pw : '' });
    }
    case 'userPassword': {   // your own password
      if (!ctx.uid) return out(400, { error: 'The Owner login is set in Netlify (ADMIN_PASSWORD). Change it there.' });
      const u = await get(ctx.uid); if (!u) return out(404, { error: 'User not found' });
      if (!checkPw(u, body.old)) return out(400, { error: 'Your current password is not right.' });
      const bad = pwProblem(body.password); if (bad) return out(400, { error: bad });
      if (String(body.password) === String(body.old)) return out(400, { error: 'Pick a new password, not the current one.' });
      Object.assign(u, hashPw(body.password)); u.mustChange = false; u.ver = (u.ver || 0) + 1; await put(u);
      await log('Changed their password');
      return out(200, { ok: true, v: u.ver, uid: u.id, name: u.username });
    }
    default: return null;
  }
}
