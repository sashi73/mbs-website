// v60: 📞 Comms. Team meetings for a project (Google Meet, Microsoft Teams or Zoom) and the meeting log.
//  - Without set-up the console opens the platform with everything filled in (Google Calendar + Meet, Teams "new meeting",
//    Zoom's schedule page) and makes an .ics invite and an email. With the platform's API keys in Netlify the meeting is
//    created directly and the join link comes back:
//      Microsoft Teams: MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_ORGANIZER (the mailbox that owns the meetings;
//                       Azure app with the Calendars.ReadWrite application permission). Teams emails the invites.
//      Zoom:            ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET (Server-to-Server OAuth app, meeting:write scope),
//                       ZOOM_USER (optional, default "me").
//  - The meeting transcript (Word, PDF, text, Teams/Zoom .vtt) is kept as a project document ("Meeting transcript"), and
//    the AI works out what it means for the plan: summary, decisions, actions, and the impact on scope, time, cost,
//    quality, risks, issues and stakeholders, with concrete changes (task days, start dates, extra cost, new tasks,
//    scope lines, risks, issues, stakeholders) that can be applied to the plan in one go.
//      pmeet:<core>:<meeting id>   the last analysis of that meeting
import * as kv from './kv.mjs';
import * as J from './jobs.mjs';
import * as P from './plan.mjs';
import { llmJson, usage, checkLimit, llmSetup, sydToday } from './ai.mjs';
import * as INTEL from './plan-intel.mjs';

const str = (s, max = 300) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
const H = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const out = (status, body) => new Response(JSON.stringify(body), { status, headers: H });
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const int = (n, lo, hi, d = lo) => { const v = Math.round(Number(n)); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
const ymd = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : '');
const env = (k) => String(process.env[k] || '').trim();
const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[a-z]{2,}$/i;

// ---------- which platforms can create meetings directly ----------
export function setup() {
  return { google: false, teams: !!(env('MS_TENANT_ID') && env('MS_CLIENT_ID') && env('MS_CLIENT_SECRET') && env('MS_ORGANIZER')),
    zoom: !!(env('ZOOM_ACCOUNT_ID') && env('ZOOM_CLIENT_ID') && env('ZOOM_CLIENT_SECRET')) };
}
async function http(url, opts, what) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal });
    const txt = await r.text(); let j = {}; try { j = JSON.parse(txt || '{}'); } catch {}
    if (!r.ok) throw new Error(`${what} said no (${r.status}): ${str((j.error && (j.error.message || j.error)) || j.message || j.error_description || txt, 200)}`);
    return j;
  } catch (e) { if (e.name === 'AbortError') throw new Error(what + ' did not answer in time'); throw e; } finally { clearTimeout(t); }
}
const endOf = (date, start, minutes) => { const [h, m] = start.split(':').map(Number), x = h * 60 + m + minutes; return `${date}T${String(Math.floor(x / 60) % 24).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}:00`; };
export async function create(body) {
  const S = setup(), platform = body.platform === 'teams' ? 'teams' : body.platform === 'zoom' ? 'zoom' : 'google';
  if (!S[platform]) return { error: (platform === 'teams' ? 'Microsoft Teams' : platform === 'zoom' ? 'Zoom' : 'Google') + ' is not connected: the meeting opens in the app instead.' };
  const title = str(body.title, 160) || 'Project meeting', date = ymd(body.date), start = /^\d{2}:\d{2}$/.test(body.start || '') ? body.start : '10:00', minutes = int(body.minutes, 15, 240, 45);
  if (!date) return { error: 'Pick a date' };
  const agenda = str(body.agenda, 2000), emails = (Array.isArray(body.emails) ? body.emails : []).map((e) => str(e, 160)).filter((e) => EMAIL.test(e)).slice(0, 50);
  if (platform === 'zoom') {
    const base = env('ZOOM_OAUTH_URL') || 'https://zoom.us', api = env('ZOOM_API_BASE') || 'https://api.zoom.us/v2';
    const tok = await http(`${base}/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(env('ZOOM_ACCOUNT_ID'))}`,
      { method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(env('ZOOM_CLIENT_ID') + ':' + env('ZOOM_CLIENT_SECRET')).toString('base64') } }, 'Zoom');
    const m = await http(`${api}/users/${encodeURIComponent(env('ZOOM_USER') || 'me')}/meetings`, { method: 'POST', headers: { Authorization: 'Bearer ' + tok.access_token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: title, type: 2, start_time: `${date}T${start}:00`, timezone: 'Australia/Sydney', duration: minutes, agenda: agenda.slice(0, 1900),
        settings: { join_before_host: true, waiting_room: false, meeting_invitees: emails.map((email) => ({ email })) } }) }, 'Zoom');
    return { link: str(m.join_url, 400), extId: str(m.id, 40), passcode: str(m.password, 20), invited: false };
  }
  // Microsoft Teams: a calendar event in the organiser's mailbox with a Teams link; Outlook sends the invites
  const login = env('MS_LOGIN_BASE') || 'https://login.microsoftonline.com', graph = env('MS_GRAPH_BASE') || 'https://graph.microsoft.com/v1.0';
  const tok = await http(`${login}/${encodeURIComponent(env('MS_TENANT_ID'))}/oauth2/v2.0/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env('MS_CLIENT_ID'), client_secret: env('MS_CLIENT_SECRET'), scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }).toString() }, 'Microsoft');
  const ev = await http(`${graph}/users/${encodeURIComponent(env('MS_ORGANIZER'))}/events`, { method: 'POST', headers: { Authorization: 'Bearer ' + tok.access_token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ subject: title, body: { contentType: 'text', content: agenda ? 'Agenda:\n' + agenda : title },
      start: { dateTime: `${date}T${start}:00`, timeZone: 'AUS Eastern Standard Time' }, end: { dateTime: endOf(date, start, minutes), timeZone: 'AUS Eastern Standard Time' },
      attendees: emails.map((address) => ({ emailAddress: { address }, type: 'required' })), isOnlineMeeting: true, onlineMeetingProvider: 'teamsForBusiness' }) }, 'Microsoft Teams');
  return { link: str((ev.onlineMeeting && ev.onlineMeeting.joinUrl) || ev.webLink, 600), extId: str(ev.id, 200), invited: emails.length > 0 };
}

// ---------- AI: what the meeting means for the plan ----------
const AREAS = ['scope', 'time', 'cost', 'quality', 'risk', 'issues', 'stakeholders'];
const LEVELS = ['None', 'Low', 'Medium', 'High'];
const SYSTEM = 'You are an experienced construction project manager (PMBOK, PRINCE2) for teams using GKH Project Champ (construction, facilities, IT and business projects). ' +
  'You get the project plan (tasks numbered n, days, start/finish, links "after", the critical path, costs), the scope, risks, issues and stakeholders, and the TRANSCRIPT of one project meeting. ' +
  'Work out what the meeting means for the project, thoroughly and practically. Rules: ' +
  '1) Only use what was actually said in the meeting; do not invent. If something is unclear, say so in the summary. ' +
  '2) Impact on each area (scope, time, cost, quality, risk, issues, stakeholders): level None|Low|Medium|High and one or two sentences that name the tasks (#n) and dates. ' +
  'For time, explain whether the change is on the critical path (critical=true tasks move the finish date) and roughly how many working days the finish moves. ' +
  '3) Concrete changes to the plan: task_changes for existing tasks (n, days = the new number of working days when a duration or lead time changed, e.g. a supply lead time now 3 weeks = 15 working days on the ordering/delivery task; ' +
  'not_before = YYYY-MM-DD if a task cannot start before a date; extra_cost = extra $ ex tax if the meeting means extra cost for that task; why). ' +
  'new_tasks only when new work was agreed (name, days, after = task numbers it follows, cost $ ex tax, why). scope_changes when scope was added, removed or changed. ' +
  '4) risks (new or heightened risks, critical=true if they can delay a critical task), issues (problems that are happening now and need action: priority Low|Medium|High|Critical, owner, due YYYY-MM-DD), ' +
  'stakeholders (people or organisations in the meeting who are NOT in the stakeholder list: name, role, raci R|A|C|I), quality (concerns, inspections or tests to add). ' +
  '5) decisions and actions (action, owner, due YYYY-MM-DD or ""). 6) Australian spelling, dates as D Month YYYY, $1,234. ' +
  'Reply JSON only: {"outcome":"one sentence","summary":["3-8 short bullets"],"decisions":[""],"actions":[{"action":"","owner":"","due":""}],' +
  '"impact":{"scope":{"level":"None","text":""},"time":{},"cost":{},"quality":{},"risk":{},"issues":{},"stakeholders":{}},' +
  '"task_changes":[{"n":1,"days":0,"not_before":"","extra_cost":0,"why":""}],"new_tasks":[{"name":"","days":1,"after":[1],"cost":0,"why":""}],' +
  '"scope_changes":[{"type":"Add|Remove|Change","text":"","why":""}],"risks":[{"title":"","cause":"","p":3,"i":3,"response":"Mitigate","action":"","owner":"","critical":false}],' +
  '"issues":[{"title":"","detail":"","priority":"High","owner":"","due":""}],"stakeholders":[{"name":"","role":"","raci":"I"}],"quality":[""],"follow_ups":["2-3 short next questions"]}';
const cap = () => Math.max(1500, Math.min(8000, Number(process.env.AI_MEET_MAX_TOKENS || 4000) || 4000));
const MAX_TRANSCRIPT = 60000;

function tidyTranscript(t) {   // Teams/Zoom .vtt/.srt: drop the cue numbers and times, keep "Speaker: words"
  return String(t || '').replace(/^WEBVTT.*$/m, '').replace(/^\d+\s*$/gm, '').replace(/^\d{1,2}:\d{2}(:\d{2})?[.,]\d{3}\s*-->.*$/gm, '').replace(/<v ([^>]+)>/g, '$1: ').replace(/<\/?v[^>]*>/g, '')
    .replace(/\n{3,}/g, '\n\n').trim();
}
export async function analyse({ core, id, question }, by) {
  const job = await J.find(core); if (!job) return { error: 'Job not found' };
  const plan = await P.get(job.core); if (!plan) return { error: 'This job has no plan yet.' };
  const m = (plan.meetings || []).find((x) => x.id === id); if (!m) return { error: 'That meeting is not in the log (save the plan first).' };
  if (!m.doc) return { error: 'Upload the meeting transcript first.' };
  const doc = await kv.get(`pdoctext:${job.core}:${m.doc}`); if (!doc || !doc.text) return { error: 'The transcript could not be found. Upload it again.' };
  if (!llmSetup()) return { error: 'AI is not set up yet: add LLM_API_KEY (DeepSeek) in Netlify.' };
  try { await checkLimit(); } catch (e) { return { error: e.message }; }
  const { ctx, stakeholders } = await INTEL.context(job, plan, question || m.title || 'meeting');
  delete ctx.document_extracts; delete ctx.extracts_are_partial; delete ctx.swms;   // the transcript is what matters here
  let tx = INTEL.scrub(tidyTranscript(doc.text), job, stakeholders).replace(/[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/gi, '[email]').replace(/(\+?61|0)[\d ]{8,12}\d/g, '[phone]');
  const long = tx.length > MAX_TRANSCRIPT; if (long) tx = tx.slice(0, MAX_TRANSCRIPT * 0.7) + '\n[… middle of the transcript left out …]\n' + tx.slice(-MAX_TRANSCRIPT * 0.3);
  const user = { question: question ? INTEL.scrub(str(question, 800), job, stakeholders) : '', meeting: { title: INTEL.scrub(m.title, job, stakeholders), date: m.date, start: m.start, platform: m.platform || 'google', status: m.status || '' }, transcript: tx, ...ctx };
  let o, used, cutOff;
  try { ({ data: o, used, cutOff } = await llmJson([{ role: 'system', content: SYSTEM }, { role: 'user', content: JSON.stringify(user) }], { maxTokens: cap(), timeoutMs: 240000, temperature: 0.2 })); }
  catch (e) { return { error: e.message }; }
  const todayUse = await usage(true, used);
  const a = shape(o, plan, { meeting: { id: m.id, title: m.title, date: m.date, start: m.start }, by, used, todayUse, cutOff, long });
  a.report = report(a);
  await kv.set(`pmeet:${job.core}:${m.id}`, a);
  return a;
}
function shape(o, plan, { meeting, by, used, todayUse, cutOff, long }) {
  const tasks = plan.tasks, byN = (n) => tasks[int(n, 1, tasks.length, 0) - 1];
  const arr = (x, n) => (Array.isArray(x) ? x : []).slice(0, n);
  const lvl = (v) => (LEVELS.includes(v) ? v : 'Low');
  const impact = {}; for (const k of AREAS) { const v = (o.impact || {})[k] || {}; impact[k] = { level: str(v.text) ? lvl(v.level) : 'None', text: str(v.text, 600) }; }
  const seen = new Set();
  const a = {
    meeting, at: Date.now(), by: str(by, 60),
    outcome: str(o.outcome, 400), summary: arr(o.summary, 10).map((s) => str(s, 400)).filter(Boolean), decisions: arr(o.decisions, 12).map((s) => str(s, 300)).filter(Boolean),
    actions: arr(o.actions, 15).map((x) => ({ action: str(x && x.action, 300), owner: str(x && x.owner, 80), due: ymd(x && x.due) })).filter((x) => x.action),
    impact,
    task_changes: arr(o.task_changes, 30).map((c) => { const t = c && byN(c.n); if (!t || seen.has(t.id)) return null; seen.add(t.id);
      const days = c.days == null || c.days === '' ? t.dur : int(c.days, 0, 365, t.dur), nb = ymd(c.not_before), extra = Math.max(0, Math.min(1e6, r2(c.extra_cost)));
      if (days === t.dur && !nb && !extra) return null;
      return { id: t.id, n: tasks.indexOf(t) + 1, name: t.name, durFrom: t.dur, durTo: days, notBefore: nb, extra, why: str(c.why, 300) }; }).filter(Boolean),
    new_tasks: arr(o.new_tasks, 10).map((x) => ({ name: str(x && x.name, 160), days: int(x && x.days, 0, 365, 1), after: arr(x && x.after, 5).map((n) => (byN(n) || {}).id).filter(Boolean), cost: Math.max(0, r2(x && x.cost)), why: str(x && x.why, 300) })).filter((x) => x.name),
    scope_changes: arr(o.scope_changes, 10).map((x) => ({ type: ['Add', 'Remove', 'Change'].includes(x && x.type) ? x.type : 'Change', text: str(x && x.text, 400), why: str(x && x.why, 300) })).filter((x) => x.text),
    risks: arr(o.risks, 10).map((x) => ({ title: str(x.title, 200), cause: str(x.cause, 600), p: int(x.p, 1, 5, 3), i: int(x.i, 1, 5, 3), response: ['Avoid', 'Mitigate', 'Transfer', 'Accept'].includes(x.response) ? x.response : 'Mitigate',
      action: str(x.action, 600), owner: str(x.owner, 80), critical: !!x.critical })).filter((x) => x.title),
    issues: arr(o.issues, 10).map((x) => ({ title: str(x.title, 200), detail: str(x.detail, 800), priority: ['Low', 'Medium', 'High', 'Critical'].includes(x.priority) ? x.priority : 'Medium', owner: str(x.owner, 80), due: ymd(x.due) })).filter((x) => x.title),
    stakeholders: arr(o.stakeholders, 10).map((x) => ({ name: str(x.name, 120), role: str(x.role, 120), raci: ['R', 'A', 'C', 'I'].includes(x.raci) ? x.raci : 'I' }))
      .filter((x) => x.name && !(plan.stakeholders || []).some((y) => y.name && y.name.toLowerCase() === x.name.toLowerCase())),
    quality: arr(o.quality, 8).map((s) => str(s, 300)).filter(Boolean),
    follow_ups: arr(o.follow_ups, 3).map((s) => str(s, 160)).filter(Boolean),
    tokens: used, today: todayUse, cutOff: !!cutOff, longTranscript: !!long, rev: plan.rev || 0
  };
  return a;
}

// v82: 🔁 change control: the impact of a proposed change (a change request), in the same shape as a meeting's impact
const CR_SYSTEM = SYSTEM.replace('the TRANSCRIPT of one project meeting', 'a proposed CHANGE REQUEST (what someone wants changed, and why)')
  .replace('Work out what the meeting means for the project, thoroughly and practically.', 'Work out what this change would mean for the project if it is approved, thoroughly and practically.')
  .replace('Only use what was actually said in the meeting; do not invent.', 'Only use what the change request says and the plan; do not invent.')
  .replace('stakeholders (people or organisations in the meeting who are NOT in the stakeholder list', 'stakeholders (people or organisations named in the request who are NOT in the stakeholder list')
  .replace('5) decisions and actions (action, owner, due YYYY-MM-DD or "").', '5) decisions: the decisions the change control board must make; actions: what has to happen if it is approved (action, owner, due YYYY-MM-DD or "").');
export async function assessChange({ core, title, text }, by) {
  const job = await J.find(core); if (!job) return { error: 'Job not found' };
  const plan = await P.get(job.core); if (!plan) return { error: 'This job has no plan yet.' };
  const desc = str(text, 4000); if (desc.length < 8) return { error: 'Describe the change first.' };
  if (!llmSetup()) return { error: 'AI is not set up yet: add LLM_API_KEY (DeepSeek) in Netlify.' };
  try { await checkLimit(); } catch (e) { return { error: e.message }; }
  const { ctx, stakeholders } = await INTEL.context(job, plan, desc);
  delete ctx.document_extracts; delete ctx.extracts_are_partial; delete ctx.swms;
  const user = { change_request: { title: INTEL.scrub(str(title, 200), job, stakeholders), description: INTEL.scrub(desc, job, stakeholders) }, ...ctx };
  let o, used, cutOff;
  try { ({ data: o, used, cutOff } = await llmJson([{ role: 'system', content: CR_SYSTEM }, { role: 'user', content: JSON.stringify(user) }], { maxTokens: cap(), timeoutMs: 240000, temperature: 0.2 })); }
  catch (e) { return { error: e.message }; }
  const todayUse = await usage(true, used);
  return shape(o, plan, { meeting: null, by, used, todayUse, cutOff, long: false });
}
const dLong = (s) => (s ? new Date(s + 'T00:00:00Z').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '');
function report(a) {
  const L = ['## 🗒 ' + a.meeting.title + ' (' + dLong(a.meeting.date) + ')'];
  if (a.outcome) L.push('**Outcome:** ' + a.outcome);
  if (a.summary.length) L.push('', '### Summary', ...a.summary.map((s) => '- ' + s));
  if (a.decisions.length) L.push('', '### Decisions', ...a.decisions.map((s) => '- ' + s));
  if (a.actions.length) L.push('', '### Actions', '| Action | Owner | Due |', '|---|---|---|', ...a.actions.map((x) => `| ${x.action.replace(/\|/g, '/')} | ${x.owner || '–'} | ${x.due ? dLong(x.due) : '–'} |`));
  if (a.cutOff) L.push('', '_The AI reply was cut off: the analysis may be incomplete._');
  if (a.longTranscript) L.push('', '_The transcript is very long: the start and the end were read._');
  return L.join('\n');
}

// "analyse my meeting on 3 Nov": which meeting does the question mean?
const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
export function dateIn(q, today) {
  const s = String(q || '').toLowerCase(); let m;
  if ((m = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/))) return `${m[1]}-${m[2]}-${m[3]}`;
  const y0 = +today.slice(0, 4), t0 = Date.parse(today), md = (yy, mo, d) => `${yy}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  // no year given: the nearest such date to today (a meeting last month, or next week across New Year)
  const fix = (y, mo, d) => (y ? md(y < 100 ? 2000 + y : y, mo, d) : [y0 - 1, y0, y0 + 1].map((yy) => md(yy, mo, d)).sort((a, b) => Math.abs(Date.parse(a) - t0) - Math.abs(Date.parse(b) - t0))[0]);
  if ((m = s.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))) return fix(m[3] ? +m[3] : 0, +m[2], +m[1]);
  if ((m = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:,?\s+(\d{4}))?/))) return fix(m[3] ? +m[3] : 0, MON.indexOf(m[2]) + 1, +m[1]);
  if ((m = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/))) return fix(m[3] ? +m[3] : 0, MON.indexOf(m[1]) + 1, +m[2]);
  if (/\btoday\b/.test(s)) return today;
  if (/\byesterday\b/.test(s)) { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); }
  return '';
}
export const MEET_Q = (q) => /\b(meeting|meetings|transcript|minutes)\b/i.test(q) && /analy|summar|impact|outcome|chang|affect|mean|consequen|learn|what (came|happened)/i.test(q)
  && !(/\b(set up|setup|book|schedule|organi[sz]e|arrange|invite)\b/i.test(q) && !/analy|transcript|minutes|outcome/i.test(q));
export function pickMeeting(plan, q, today) {
  const all = (plan.meetings || []).slice().sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start));
  const d = dateIn(q, today), withT = all.filter((m) => m.doc);
  if (d) { const on = all.filter((m) => m.date === d); return { date: d, meeting: on.find((m) => m.doc) || on[0] || null }; }
  return { date: '', meeting: withT.find((m) => m.date <= today) || withT[0] || all.find((m) => m.date <= today) || null };
}

export async function commsPost(action, body, { who, by, audit }) {
  if (!/^comms/.test(action)) return null;
  if (action === 'commsSetup') return out(200, setup());
  const job = await J.find(str(body.core, 30)); if (!job) return out(404, { error: 'Job not found' });
  switch (action) {
    case 'commsCreate': {
      try { const r = await create(body); if (r.error) return out(400, r); if (audit) await audit(who, `Project ${job.core}: ${body.platform} meeting created: ${str(body.title, 80)}`); return out(200, r); }
      catch (e) { return out(502, { error: e.message }); }
    }
    case 'commsAnalysis': return out(200, { analysis: (await kv.get(`pmeet:${job.core}:${str(body.id, 20)}`)) || null });
    case 'commsForget': { await kv.del(`pmeet:${job.core}:${str(body.id, 20)}`).catch(() => {}); return out(200, { ok: true }); }
    default: return null;
  }
}
