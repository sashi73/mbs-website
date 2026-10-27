// Runs on Netlify every 5 minutes (scheduled function): sends reminders that are due,
// and the weekly report on Monday at 7am Sydney time (turn off with WEEKLY_REPORT=off).
import { env, escapeHtml, alertChats } from '../lib/shared.mjs';
import * as J from '../lib/jobs.mjs';
import * as kv from '../lib/kv.mjs';
import { send, jobCard, jobButtons, reportText } from '../lib/bot.mjs';
import { parts, whenText } from '../lib/calendar.mjs';

export async function runReminders(now = Date.now()) {
  const sent = [];
  const owner = env('TELEGRAM_CHAT_ID');
  if (!env('TELEGRAM_BOT_TOKEN') || !owner) return sent;
  for (const r of await J.takeDue(now)) {
    const job = r.core ? await J.find(r.core) : null;
    const to = !r.chat || r.chat === 'alerts' ? alertChats() : [r.chat];
    for (const chat of to) {
      try { await send(chat, `⏰ <b>Reminder</b> (${whenText(r.at)}): ${escapeHtml(r.text)}` + (job ? '\n\n' + jobCard(job, false) : ''), job ? jobButtons(job, true) : null); }
      catch (e) { console.warn('Reminder not delivered to', chat, e.message); }
    }
    sent.push(r.id);
  }
  // weekly report: Monday 7:00-7:59am Sydney, once
  const p = parts(now), monday = new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay() === 1;
  if (env('WEEKLY_REPORT', 'on') !== 'off' && monday && p.h === 7) {
    const tag = `${p.y}-${p.mo}-${p.d}`;
    let first = false;
    await kv.update('weekly', (w) => { first = w.last !== tag; return { last: tag }; }, () => ({ last: '' }));
    if (first) {
      const text = '☀️ <b>Good morning! Here’s last week.</b>\n\n' + await reportText('lastweek', now);
      for (const chat of alertChats()) { try { await send(chat, text); } catch (e) { console.warn('Weekly report not delivered to', chat, e.message); } }
      sent.push('weekly');
    }
  }
  return sent;
}

export default async () => {
  try { const sent = await runReminders(); return new Response(JSON.stringify({ ok: true, sent })); }
  catch (e) { console.error('Reminders error:', e); return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500 }); }
};

export const config = { schedule: '*/5 * * * *' };
