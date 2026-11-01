// v62: 📊 Reports for a project, for three audiences: the customer, the team (crew, trades) and all stakeholders.
// Weekly or ad hoc; RAG (red, amber, green) status; a Gantt chart; what was done, what is planned, blockers, risks and issues; at most 4 pages; Word or PDF (made in the browser);
// emailed with the PDF attached (Resend), and every report kept in a log so it can be downloaded again later.
//   preports:<core>          the log: [{ id, no, audience, type, from, to, at, by, overall, headline, recipients, action, emailed }]
//   preport:<core>:<id>      the report itself (all its content), so the same Word / PDF can be made again
// Test site (SITE_ENV=test): sendEmail sends every email to the owner only, marked [TEST].
import * as kv from './kv.mjs';
import * as J from './jobs.mjs';
import { sendEmail, isTestSite } from './shared.mjs';
import { llmJson, usage, checkLimit, llmSetup } from './ai.mjs';
import * as P from './plan.mjs';

const str = (s, max = 300) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
const H = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const out = (status, body) => new Response(JSON.stringify(body), { status, headers: H });
const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[a-z]{2,}$/i;
const AUD = { customer: 'Customer update', team: 'Team look-ahead', all: 'Stakeholder status report' };
const RAGN = { G: 'Green', A: 'Amber', R: 'Red' }, RAGC = { G: '#15803D', A: '#B45309', R: '#B91C1C' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function logOf(core) { return ((await kv.get('preports:' + core)) || { list: [] }).list; }
function cleanSnap(s) {   // the report content, kept as JSON (size-capped)
  const j = JSON.stringify(s || {});
  if (j.length > 400000) throw new Error('The report is too big to keep');
  return JSON.parse(j);
}
function entry(s, by, action, emailed, recipients) {
  return { id: s.id, no: s.no || 1, audience: AUD[s.audience] ? s.audience : 'all', type: s.type === 'Weekly' ? 'Weekly' : 'Ad hoc', from: str(s.from, 10), to: str(s.to, 10), at: Date.now(), by: str(by, 60),
    overall: ['G', 'A', 'R'].includes(s.rag && s.rag.overall && s.rag.overall.c) ? s.rag.overall.c : 'G', headline: str(s.headline, 300),
    recipients: (recipients || []).map((r) => ({ name: str(r.name, 120), email: str(r.email, 160) })).slice(0, 60), action, emailed: !!emailed };
}
async function keep(core, s, by, action, emailed, recipients) {
  const snap = cleanSnap(s);
  await kv.set(`preport:${core}:${snap.id}`, snap);
  let e;
  await kv.update('preports:' + core, (x) => {
    const list = x.list || [], old = list.find((y) => y.id === snap.id);
    e = entry(snap, by, action, emailed, recipients);
    if (old) { e.actions = (old.actions || [old.action]).concat(action).slice(-10); e.emailed = old.emailed || e.emailed; e.recipients = e.recipients.length ? e.recipients : old.recipients; Object.assign(old, e); }
    else { e.actions = [action]; list.push(e); }
    x.list = list.slice(-200); return x;
  }, () => ({ list: [] }));
  return e;
}

// the email: a short digest (RAG, headline, key points), with the full report attached
function emailHtml(s, message) {
  const rag = s.rag || {}, keys = Object.keys(rag).filter((k) => rag[k] && rag[k].c);
  const chip = (c, label) => `<span style="display:inline-block;padding:3px 10px;border-radius:99px;background:${RAGC[c]};color:#fff;font:600 12px Arial;margin:0 4px 4px 0">${esc(label)}: ${RAGN[c]}</span>`;
  const pts = (s.points || []).slice(0, 6).map((p) => `<li style="margin:0 0 4px">${esc(p)}</li>`).join('');
  return `<div style="font:14px/1.5 Arial,sans-serif;color:#1F1D18;max-width:620px">` +
    (message ? `<p>${esc(message).replace(/\n/g, '<br>')}</p>` : '') +
    `<div style="border:1px solid #E7E2D4;border-radius:10px;padding:14px 16px;background:#FDFCF8">` +
    `<div style="font:700 16px Arial">${esc(AUD[s.audience] || 'Project report')}: ${esc(s.project && s.project.name)}</div>` +
    `<div style="color:#6B665A;font-size:12.5px;margin:2px 0 10px">${esc(s.type)} report · ${esc(s.periodText || '')}</div>` +
    `<div>${keys.map((k) => chip(rag[k].c, rag[k].label || k)).join('')}</div>` +
    (s.headline ? `<p style="margin:10px 0 6px"><b>${esc(s.headline)}</b></p>` : '') + (pts ? `<ul style="padding-left:18px;margin:6px 0">${pts}</ul>` : '') +
    `<p style="margin:10px 0 0;color:#6B665A;font-size:12.5px">The full report (with the Gantt chart) is attached.</p></div>` +
    `<p style="color:#8A8577;font-size:12px">Modern Building Solutions</p></div>`;
}
function emailText(s, message) {
  const rag = s.rag || {};
  return (message ? message + '\n\n' : '') + `${AUD[s.audience] || 'Project report'}: ${s.project && s.project.name}\n${s.type} report · ${s.periodText || ''}\n` +
    Object.keys(rag).filter((k) => rag[k] && rag[k].c).map((k) => `${rag[k].label || k}: ${RAGN[rag[k].c]}`).join(' · ') + '\n\n' + (s.headline || '') + '\n' + (s.points || []).map((p) => '- ' + p).join('\n') + '\n\nThe full report is attached.\n\nModern Building Solutions';
}

// ✨ the AI writes the headline and key points for the audience, from the facts in the report
const SYS = 'You write short, clear project status messages for Modern Building Solutions, a Sydney (NSW) builder. Australian spelling, plain English, no jargon for customers. ' +
  'You get the audience and the facts of one reporting period (RAG status with reasons, progress, tasks done and coming up, milestones, risks, issues, decisions needed). Write for that audience: ' +
  'CUSTOMER: warm and reassuring but honest; what was done, what is next and what it means for them (access, noise, services off), what we need from them; never mention internal costs, margins or blame. ' +
  'TEAM: direct and practical; this week\'s priorities, who does what, critical tasks, blockers, safety focus, materials; motivate. ' +
  'ALL STAKEHOLDERS: concise executive summary; status against time, cost and scope, top risks and issues, decisions needed and by when. ' +
  'Use only the facts given; if the status is amber or red say why and what is being done. Keep momentum: end with the next steps. ' +
  'JSON only: {"headline":"one or two sentences","points":["4-6 short key points"],"next":["3-5 next steps"],"asks":["0-4 things we need from them, with dates"]}';
export async function write({ core, facts }, by) {
  const job = await J.find(core); if (!job) return { error: 'Job not found' };
  if (!llmSetup()) return { error: 'AI is not set up yet: add LLM_API_KEY (DeepSeek) in Netlify.' };
  try { await checkLimit(); } catch (e) { return { error: e.message }; }
  const f = JSON.parse(P.privateOut(JSON.stringify(facts || {}).slice(0, 30000), job));
  let o, used;
  try { ({ data: o, used } = await llmJson([{ role: 'system', content: SYS }, { role: 'user', content: JSON.stringify(f) }], { maxTokens: 1200, timeoutMs: 120000, temperature: 0.3 })); }
  catch (e) { return { error: e.message }; }
  const today = await usage(true, used);
  const arr = (x, n, m) => (Array.isArray(x) ? x : []).map((s) => str(s, m)).filter(Boolean).slice(0, n);
  return { headline: str(o.headline, 400), points: arr(o.points, 6, 240), next: arr(o.next, 5, 240), asks: arr(o.asks, 4, 240), tokens: used, today };
}

export async function reportPost(action, body, { who, by, audit }) {
  if (!/^report[A-Z]/.test(action)) return null;
  const job = await J.find(str(body.core, 30)); if (!job) return out(404, { error: 'Job not found' });
  const core = job.core;
  switch (action) {
    case 'reportLog': return out(200, { list: await logOf(core), email: !!process.env.RESEND_API_KEY, test: isTestSite() });
    case 'reportGet': { const s = await kv.get(`preport:${core}:${str(body.id, 30)}`); return s ? out(200, { report: s }) : out(404, { error: 'Report not found' }); }
    case 'reportKeep': {   // downloaded as Word / PDF: keep it in the log
      try { const e = await keep(core, body.report, by, str(body.how, 20) || 'Downloaded', false, body.report && body.report.recipients); return out(200, { entry: e }); }
      catch (e) { return out(400, { error: e.message }); }
    }
    case 'reportSend': {
      const s = body.report || {}, to = (Array.isArray(s.recipients) ? s.recipients : []).filter((r) => EMAIL.test(r.email || ''));
      if (!to.length) return out(400, { error: 'Pick who the report goes to (people with an email)' });
      const pdf = String(body.pdf || ''); if (pdf.length > 7_000_000) return out(400, { error: 'The PDF is too big to email' });
      const files = [];
      if (pdf) files.push({ filename: str(body.pdfName, 120) || 'Report.pdf', content: pdf });
      if (body.docx && String(body.docx).length < 5_000_000) files.push({ filename: str(body.docxName, 120) || 'Report.docx', content: String(body.docx) });
      const subject = str(body.subject, 200) || `${AUD[s.audience] || 'Project report'}: ${s.project && s.project.name}`;
      const r = await sendEmail({ to: to.map((x) => x.email).join(','), subject, html: emailHtml(s, str(body.message, 2000)), text: emailText(s, str(body.message, 2000)), attachments: files });
      if (!r.ok) return out(r.skipped ? 400 : 502, { error: r.reason || 'The email could not be sent' });
      let e; try { e = await keep(core, s, by, 'Emailed', true, to); } catch (er) { return out(400, { error: er.message }); }
      if (audit) await audit(who, `Project ${core}: ${AUD[s.audience]} #${s.no} emailed to ${to.length} people`);
      return out(200, { ok: true, entry: e, test: isTestSite() });
    }
    case 'reportDelete': {
      const id = str(body.id, 30);
      await kv.update('preports:' + core, (x) => { x.list = (x.list || []).filter((y) => y.id !== id); return x; }, () => ({ list: [] }));
      await kv.del(`preport:${core}:${id}`).catch(() => {});
      return out(200, { ok: true });
    }
    default: return null;
  }
}
