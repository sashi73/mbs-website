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
import { planPost } from '../lib/plan.mjs';

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

export default async (req) => {
  try {
    const url = new URL(req.url);

    // ---------- downloads (GET, cookie only) ----------
    if (req.method === 'GET') {
      const who = A.readSession(req);
      if (!who) return bad('Please log in', 401);
      const action = url.searchParams.get('action');
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
      const wait = await A.lockedFor(ip);
      if (wait) return bad(`Too many wrong attempts. Try again in ${wait} minute${wait > 1 ? 's' : ''}.`, 429);
      if (!A.checkPassword(body.username, body.password)) {
        const left = await A.noteFailure(ip);
        return bad(left ? `Wrong username or password (${left} tr${left > 1 ? 'ies' : 'y'} left).` : 'Too many wrong attempts. Locked for 15 minutes.', 401);
      }
      await A.clearFailures(ip);
      const user = env('ADMIN_USERNAME').trim();
      await A.audit(user, 'Logged in');
      return out(200, { ok: true, user }, { 'Set-Cookie': A.sessionCookie(req, A.makeSession(user)) });
    }
    if (action === 'logout') return out(200, { ok: true }, { 'Set-Cookie': A.clearCookie(req) });

    const session = A.readSession(req);
    if (!session) return bad('Please log in', 401);
    const who = session.u, by = `Admin (${who})`;

    switch (action) {
      case 'me': return out(200, { user: who, expires: session.exp });

      // ---------- CRM ----------
      case 'dashboard': {
        const all = await J.all(), now = Date.now();
        const per = period(body.period || 'month', now);
        const rems = (await J.reminders()).filter((r) => r.at >= now - 86400000).slice(0, 8);
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
        const job = await jobFull(body.ref);
        if (!job) return bad('Job not found', 404);
        const rems = (await J.reminders()).filter((r) => r.core === job.core).map((r) => ({ ...r, when: whenText(r.at) }));
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
        return out(200, { key: body.key, value: await A.getValue(body.store, String(body.key || '')) });
      }
      case 'dataDelete': {
        if (!storeOk(body.store)) return bad('Unknown store');
        const keys = (Array.isArray(body.keys) ? body.keys : []).map(String).slice(0, 500);
        if (!keys.length) return bad('Nothing selected');
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
        const a = (await acctPost(action, body, { who, by })) || (await sqlPost(action, body, { who, by })) || (await planPost(action, body, { who, by, audit: A.audit }));
        return a || bad('Unknown action');
      }
    }
  } catch (e) {
    console.error('Admin error:', e);
    return bad('Something went wrong: ' + e.message, 500);
  }
};
