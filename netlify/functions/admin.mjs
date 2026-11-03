// MBS admin console API.  POST /.netlify/functions/admin  { action, ... }   (JSON in, JSON out)
//                          GET  /.netlify/functions/admin?action=photo|export|backup ...
// Every action except "login" needs a valid session cookie. POSTs must carry the X-MBS-Admin header,
// which other websites cannot send, so nobody can trigger admin actions from another site.
import { env, clean } from '../lib/shared.mjs';
import * as J from '../lib/jobs.mjs';
import * as A from '../lib/admin-lib.mjs';
import { period } from '../lib/bot.mjs';
import { parseWhen, whenText } from '../lib/calendar.mjs';
import { tradeCode } from '../lib/store.mjs';
import { acctGet, acctPost } from '../lib/admin-acct.mjs';
import { sqlPost } from '../lib/admin-sql.mjs';
import { planPost, get as getPlan } from '../lib/plan.mjs';
import { invPost } from '../lib/inventory.mjs';
import { custPost } from '../lib/admin-cust.mjs';
import { planQuotePost } from '../lib/plan-quote.mjs';
import { subPost } from '../lib/subbies.mjs';
import { intelPost } from '../lib/plan-intel.mjs';
import { swmsPost } from '../lib/swms.mjs';
import { commsPost } from '../lib/comms.mjs';
import { reportPost } from '../lib/reports.mjs';
import * as U from '../lib/users.mjs';
import * as PPL from '../lib/people.mjs';
import * as SUB from '../lib/subbies.mjs';
// v91: who may sign in: a person in People, or a sub-contractor in Subbies
const canIn = (pid, u) => (u && u.kind === 'google' ? PPL.isTest() && !!env('GOOGLE_CLIENT_ID').trim() : u && u.kind === 'subbie' ? SUB.canLogin(u.subId) : PPL.canLogin(pid));   // v97: Google sign-ins only while the test site has it on
// v97: "Sign in with Google" on the test site. The Google ID token is checked with Google (tokeninfo): our client ID, a verified
// email, not expired. GOOGLE_ALLOWED (optional) limits it to some emails or @domains.
async function googleVerify(cred) {
  const id = env('GOOGLE_CLIENT_ID').trim(); if (!id || !PPL.isTest()) return { error: 'Sign in with Google is not available here.', code: 403 };
  if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(String(cred || ''))) return { error: 'Google sign-in failed. Try again.' };
  let t;
  try { const r = await fetch((env('GOOGLE_TOKENINFO_URL').trim() || 'https://oauth2.googleapis.com/tokeninfo') + '?id_token=' + encodeURIComponent(cred), { signal: AbortSignal.timeout(8000) }); if (!r.ok) return { error: 'Google did not accept that sign-in. Try again.' }; t = await r.json(); }
  catch { return { error: 'Could not reach Google to check the sign-in. Try again.' }; }
  if (t.aud !== id || !['accounts.google.com', 'https://accounts.google.com'].includes(t.iss) || !(t.email_verified === true || t.email_verified === 'true') || Number(t.exp) * 1000 < Date.now()) return { error: 'Google sign-in failed. Try again.' };
  const email = String(t.email || '').toLowerCase(), allow = env('GOOGLE_ALLOWED').split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (allow.length && !allow.some((a) => (a.startsWith('@') ? email.endsWith(a) : email === a))) return { error: 'This Google account is not allowed on this site. Ask MBS for access.', code: 403 };
  return { email, name: String(t.name || '').slice(0, 100) };
}
const projectOf = async (code) => { const j = await J.find(code); return j && (await getPlan(j.core)) ? { core: j.core, ref: J.refFor(j), name: j.name } : null; };
import { bomPost } from '../lib/bom.mjs';

const H = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };
const out = (status, body, extra = {}) => new Response(JSON.stringify(body), { status, headers: { ...H, ...extra } });
const bad = (msg, status = 400) => out(status, { error: msg });
const num = (x) => { const n = Number(String(x ?? '').replace(/[$,\s]/g, '').replace(/k$/i, '000')); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0; };
const storeOk = (s) => A.BROWSABLE.includes(s);

async function jobFull(input) {
  const job = await J.find(input);
  if (!job) return null;
  job.ref = J.refFor(job);
  return job;
}

// timing headers: how long the server itself took, and whether this was a fresh ("cold") copy of the function
let served = 0;
export default async (req, context) => {
  const t0 = Date.now(), first = served++ === 0;
  const res = await handle(req, context);
  try { res.headers.set('Server-Timing', `app;dur=${Date.now() - t0}`); res.headers.set('X-MBS-Start', first ? 'cold' : 'warm'); } catch {}
  return res;
};

async function handle(req, context) {
  A.setDefer(context && typeof context.waitUntil === 'function' ? (p) => context.waitUntil(p) : null);
  try {
    const url = new URL(req.url);

    // ---------- downloads (GET, cookie only) ----------
    if (req.method === 'GET') {
      const who = A.readSession(req);
      if (!who) return bad('Please log in', 401);
      const action = url.searchParams.get('action');
      const gctx = await U.context(who, '', canIn);   // v86: Users & access
      if (!gctx) return bad('Please log in', 401);
      if (gctx.scope) return bad('Not available to sub-contractor logins.', 403);   // v91
      const gmod = action === 'photo' || action === 'export' ? 'job' : action === 'backup' ? 'dataDelete' : 'acctReport';
      const gok = U.allows(gctx, gmod); if (!gok.ok) return bad(gok.error, 403);
      if (action === 'photo') {
        const st = url.searchParams.get('store') || A.LIVE, k = url.searchParams.get('key') || '';
        if (!storeOk(st) || !/^(photo|receipt):/.test(k)) return bad('Not found', 404);
        const p = await A.getPhoto(st, k);
        return p ? new Response(p.buf, { status: 200, headers: { 'Content-Type': p.type, 'Cache-Control': 'private, max-age=3600' } }) : bad('Not found', 404);
      }
      if (action === 'export') {
        const jobs = await J.all();
        const full = await Promise.all(jobs.map((j) => J.find(j.core)));
        return new Response(J.csv(full.filter(Boolean).map((j) => ({ ...j, ref: J.refFor(j) }))), { status: 200, headers: {
          'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="mbs-jobs-${new Date().toISOString().slice(0, 10)}.csv"`, 'Cache-Control': 'no-store' } });
      }
      if (action === 'backup') {
        const st = url.searchParams.get('store') || A.LIVE;
        if (!storeOk(st)) return bad('Not found', 404);
        const rows = await A.listKeys(st), data = {};
        for (const r of rows) data[r.key] = await A.getValue(st, r.key);
        return new Response(JSON.stringify({ store: st, at: new Date().toISOString(), data }, null, 1), { status: 200, headers: {
          'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${st}-backup-${new Date().toISOString().slice(0, 10)}.json"`, 'Cache-Control': 'no-store' } });
      }
      const g = await acctGet(action, url);
      return g || bad('Unknown request', 404);
    }

    if (req.method !== 'POST') return bad('Method not allowed', 405);
    if (req.headers.get('x-mbs-admin') !== '1') return bad('Forbidden', 403);
    let body = {};
    try { body = await req.json(); } catch { return bad('Bad request'); }
    const action = String(body.action || '');

    // ---------- login / logout ----------
    if (action === 'login') {
      if (!A.adminReady()) return bad('The admin console is not set up yet: add ADMIN_USERNAME and ADMIN_PASSWORD in Netlify.', 503);
      const ip = A.clientIp(req);
      const { wait, had } = await A.loginCheck(ip);
      if (wait) return bad(`Too many wrong attempts. Try again in ${wait} minute${wait > 1 ? 's' : ''}.`, 429);
      const owner = A.checkPassword(body.username, body.password);
      const usr = owner ? null : await U.login(body.username, body.password, canIn);   // v86: a user from Users & access
      if (!owner && !usr) {
        const left = await A.noteFailure(ip);
        return bad(left ? `Wrong username or password (${left} tr${left > 1 ? 'ies' : 'y'} left).` : 'Too many wrong attempts. Locked for 15 minutes.', 401);
      }
      if (had) await A.later(A.clearFailures(ip));
      let pc = '';
      if (usr && usr.kind === 'subbie') {   // v91: a sub-contractor signs in to one of their projects, by its project code
        const code = String(body.project || '').trim();
        if (!code) return out(200, { needProject: true });
        const j = await J.find(code);
        if (!j || !(usr.projects || []).includes(j.core)) {
          const left = await A.noteFailure(ip);
          return bad(left ? 'That project code is not one of your projects. Check it with MBS.' : 'Too many wrong attempts. Locked for 15 minutes.', 401);
        }
        pc = j.core;
      }
      if (usr) {
        await A.audit(usr.username, 'Logged in (' + usr.role + (pc ? ', project ' + pc : '') + ')');
        return out(200, { ok: true, user: usr.username, name: usr.name, mustChange: !!usr.mustChange, project: pc }, { 'Set-Cookie': A.sessionCookie(req, A.makeSession(usr.username, Date.now(), { uid: usr.id, v: usr.ver || 0, pc })) });
      }
      const user = env('ADMIN_USERNAME').trim();
      await A.audit(user, 'Logged in');
      return out(200, { ok: true, user }, { 'Set-Cookie': A.sessionCookie(req, A.makeSession(user)) });
    }
    if (action === 'logout') return out(200, { ok: true }, { 'Set-Cookie': A.clearCookie(req) });
    if (action === 'loginOptions') return out(200, { google: PPL.isTest() && env('GOOGLE_CLIENT_ID').trim() ? env('GOOGLE_CLIENT_ID').trim() : '' });   // v97: the sign-in page asks
    if (action === 'loginGoogle') {   // v97
      if (!A.adminReady()) return bad('The admin console is not set up yet.', 503);
      const ip = A.clientIp(req), { wait } = await A.loginCheck(ip);
      if (wait) return bad(`Too many attempts. Try again in ${wait} minute${wait > 1 ? 's' : ''}.`, 429);
      const g = await googleVerify(body.credential);
      if (g.error) { await A.noteFailure(ip); return bad(g.error, g.code || 401); }
      const u = await U.googleUser(g.email, g.name, 'Google sign-in');
      if (!u) return bad('Google sign-in failed. Try again.', 401);
      if (u.clash) return bad('This email already has a staff login: sign in with your username and password.', 409);
      if (u.disabled) return bad('Your Google sign-in has been switched off. Ask MBS.', 403);
      await A.audit(u.username, 'Signed in with Google (view only)');
      return out(200, { ok: true, user: u.username, name: u.name }, { 'Set-Cookie': A.sessionCookie(req, A.makeSession(u.username, Date.now(), { uid: u.id, v: u.ver || 0 })) });
    }

    const session = A.readSession(req);
    if (!session) return bad('Please log in', 401);
    const ctx = await U.context(session, '', canIn);   // v86: Users & access: who this is and what they can use
    if (!ctx) return out(401, { error: 'Your access has changed or ended. Please sign in again.' }, { 'Set-Cookie': A.clearCookie(req) });
    const who = session.u, by = `Admin (${who})`;
    if (ctx.mustChange && !['me', 'userPassword'].includes(action)) return bad('Set your own password first.', 403);
    const ok = U.allows(ctx, action);
    if (!ok.ok) return bad(ok.error, 403);
    const sc = U.scopeCheck(ctx, action, body);   // v91: a sub-contractor: their own project only
    if (!sc.ok) return bad(sc.error, 403);
    if (ctx.scope) body.onlyCores = ctx.scope; else delete body.onlyCores;
    if (action === 'userPassword') {
      const r = await U.userPost(action, body, { ctx, audit: A.audit, person: PPL.get });
      if (r.status !== 200) return r;
      const j = await r.json();
      return out(200, { ok: true }, { 'Set-Cookie': A.sessionCookie(req, A.makeSession(j.name, Date.now(), { uid: j.uid, v: j.v, pc: session.pc })) });
    }

    switch (action) {
      case 'me': return out(200, { test: PPL.isTest(), user: who, name: ctx.name, expires: session.exp, owner: ctx.owner, role: ctx.role, mods: ctx.mods, mustChange: !!ctx.mustChange, personId: ctx.personId || '', kind: ctx.kind || '', scope: ctx.scope || null, subId: ctx.subId || '', modules: U.MODS.map((m) => ({ key: m[0], name: m[1] })) });

      // ---------- CRM ----------
      case 'dashboard': {
        const now = Date.now();
        const [all, remsAll] = await Promise.all([J.all(), J.reminders()]);
        const per = period(body.period || 'month', now);
        const rems = remsAll.filter((r) => r.at >= now - 86400000).slice(0, 8);
        return out(200, {
          period: per.name, report: J.report(all, per.from, per.to),
          total: all.length, open: all.filter((j) => J.OPEN.includes(j.stage)).length,
          recent: all.slice(-8).reverse(),
          reminders: rems.map((r) => ({ ...r, when: whenText(r.at) }))
        });
      }
      case 'jobs': {
        let list = body.q ? await J.search(body.q) : await J.all();
        const st = String(body.stage || 'open');
        if (st === 'open') list = list.filter((j) => J.OPEN.includes(j.stage));
        else if (st !== 'all') list = list.filter((j) => j.stage === st);
        return out(200, { jobs: list.sort((a, b) => b.created - a.created) });
      }
      case 'job': {
        const [job, remsAll] = await Promise.all([jobFull(body.ref), J.reminders()]);
        if (!job) return bad('Job not found', 404);
        const rems = remsAll.filter((r) => r.core === job.core).map((r) => ({ ...r, when: whenText(r.at) }));
        return out(200, { job, reminders: rems });
      }
      case 'stage': {
        const stage = String(body.stage || '');
        if (!J.STAGES.includes(stage)) return bad('Unknown stage');
        const extra = {};
        if (stage === 'quoted' || stage === 'invoiced') { extra.amount = num(body.amount); if (!extra.amount) return bad('Please enter the amount (inc GST)'); }
        if (stage === 'lost') extra.reason = clean(body.reason, 200);
        const r = await J.setStage(body.ref, stage, by, extra);
        if (r.error) return bad(r.error === 'not found' ? 'Job not found' : r.error, 404);
        await A.audit(who, `${r.after}: ${J.LABEL[stage]}${extra.amount ? ' ' + J.money(extra.amount) : ''}`);
        return out(200, { job: { ...r.job, ref: J.refFor(r.job) }, before: r.before, after: r.after });
      }
      case 'note': {
        const text = clean(body.text, 1000);
        if (!text) return bad('Write a note first');
        const job = await J.addNote(body.ref, text, by);
        if (!job) return bad('Job not found', 404);
        await A.audit(who, `${J.refFor(job)}: note added`);
        return out(200, { job: { ...job, ref: J.refFor(job) } });
      }
      case 'create': {
        const name = clean(body.name, 120), phone = clean(body.phone, 40);
        if (!name || !phone) return bad('Name and phone are needed');
        const service = clean(body.service, 120), summary = clean(body.summary, 1500);
        const core = await J.nextCore(/^[A-Z]$/.test(body.trade || '') ? body.trade : tradeCode(service, summary));
        const job = await J.create({ core, name, phone, email: clean(body.email, 160), suburb: clean(body.suburb, 80), service,
          best_time: clean(body.best_time, 80), summary, source: clean(body.source, 60) || `added by ${by}` }, by);
        await A.audit(who, `${J.refFor(job)}: job added (${name})`);
        return out(200, { job: { ...job, ref: J.refFor(job) } });
      }
      case 'reminders': {
        const list = await J.reminders();
        return out(200, { reminders: list.map((r) => ({ ...r, when: whenText(r.at) })) });
      }
      case 'remind': {
        const at = Number(body.at) || parseWhen(body.when);
        if (!at || at < Date.now() - 60000) return bad('Pick a time in the future, e.g. "tomorrow 9am" or "in 2h"');
        let core = '';
        if (body.ref) { const job = await J.find(body.ref); if (!job) return bad('Job not found', 404); core = job.core; }
        const text = clean(body.text, 300) || 'Follow up';
        const r = await J.addReminder({ at, text, core, chat: 'alerts', by });
        await A.audit(who, `Reminder #${r.id} set for ${whenText(at)}`);
        return out(200, { reminder: { ...r, when: whenText(at) } });
      }
      case 'unremind': {
        const gone = await J.removeReminder(Number(body.id));
        if (!gone) return bad('Reminder not found', 404);
        await A.audit(who, `Reminder #${gone.id} deleted`);
        return out(200, { ok: true });
      }
      case 'report': {
        const per = period(body.period || 'month');
        return out(200, { period: per.name, from: per.from, report: J.report(await J.all(), per.from, per.to) });
      }

      // ---------- data explorer ----------
      case 'stores': {
        const res = [];
        for (const s of A.BROWSABLE) { try { res.push({ store: s, count: (await A.listKeys(s)).length }); } catch (e) { res.push({ store: s, count: 0, error: e.message }); } }
        return out(200, { stores: res });
      }
      case 'dataList': {
        if (!storeOk(body.store)) return bad('Unknown store');
        return out(200, { store: body.store, rows: await A.listKeys(body.store) });
      }
      case 'dataGet': {
        if (!storeOk(body.store)) return bad('Unknown store');
        if (/^ppl/.test(String(body.key || '')) && !U.allows(ctx, 'pplGet').ok) return bad('People records need access to People.', 403);   // v86
        return out(200, { key: body.key, value: await A.getValue(body.store, String(body.key || '')) });
      }
      case 'dataDelete': {
        if (!storeOk(body.store)) return bad('Unknown store');
        const keys = (Array.isArray(body.keys) ? body.keys : []).map(String).slice(0, 500);
        if (!keys.length) return bad('Nothing selected');
        if (keys.some((k) => /^ppl/.test(k)) && !U.allows(ctx, 'pplSave').ok) return bad('People records need edit access to People.', 403);   // v86
        const done = await A.deleteKeys(body.store, keys);
        await A.audit(who, `Deleted ${done.length} item(s) from ${body.store}: ${keys.slice(0, 5).join(', ')}${keys.length > 5 ? '…' : ''}`);
        return out(200, { deleted: done });
      }
      case 'dataMove': {
        const from = body.from, to = body.to;
        if (!([A.LIVE, A.TEST].includes(from) && [A.LIVE, A.TEST].includes(to)) || from === to) return bad('Jobs can only move between the live and test databases');
        const keys = (Array.isArray(body.keys) ? body.keys : []).map(String).slice(0, 500);
        if (!keys.length) return bad('Nothing selected');
        const moved = await A.moveKeys(from, to, keys);
        await A.audit(who, `Moved ${moved.length} item(s) ${from} → ${to}`);
        return out(200, { moved });
      }
      case 'rebuildIndex': {
        if (![A.LIVE, A.TEST].includes(body.store)) return bad('Unknown store');
        const n = await A.rebuildIndex(body.store);
        await A.audit(who, `Rebuilt the job list of ${body.store} (${n} jobs)`);
        return out(200, { jobs: n });
      }
      case 'log': return out(200, { log: await A.auditLog() });
      default: {
        const a = (await acctPost(action, body, { who, by })) || (await sqlPost(action, body, { who, by })) || (await planPost(action, body, { who, by, audit: A.audit })) || (await invPost(action, body, { who, by, audit: A.audit })) || (await custPost(action, body, { who, by, audit: A.audit })) || (await planQuotePost(action, body, { who, by, audit: A.audit })) || (await subPost(action, body, { who, by, audit: A.audit })) || (await intelPost(action, body, { who, by, audit: A.audit })) || (await swmsPost(action, body, { who, by, audit: A.audit })) || (await commsPost(action, body, { who, by, audit: A.audit })) || (await reportPost(action, body, { who, by, audit: A.audit })) || (await PPL.pplPost(action, body, { who, by, audit: A.audit, unlogin: U.removeForPerson })) || (await bomPost(action, body, { who, by, audit: A.audit })) || (await U.userPost(action, action === 'userGuestLoad' ? { ...body, test: PPL.isTest() } : body, { ctx, audit: A.audit, person: PPL.get, sub: SUB.getSub, project: projectOf }));
        return a || bad('Unknown action');
      }
    }
  } catch (e) {
    console.error('Admin error:', e);
    return bad('Something went wrong: ' + e.message, 500);
  }
}
