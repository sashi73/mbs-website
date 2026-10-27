// MBS job tracker bot (Telegram). Runs on Netlify: Telegram sends each message to /.netlify/functions/telegram.
// Everything is stored in Netlify Blobs (see jobs.mjs).
import { env, escapeHtml as E } from './shared.mjs';
import * as J from './jobs.mjs';
import { parseWhen, whenText, parts, sydneyTime } from './calendar.mjs';
import { tradeCode } from './store.mjs';

// ---------- the command list (shown by /help and in Telegram's Menu button) ----------
export const COMMANDS = [
  ['menu', 'Quick buttons'],
  ['jobs', 'Open jobs, grouped by stage'],
  ['new', 'New enquiries not called yet'],
  ['job', 'One job in full: /job 12  or  /job PW-261025-000012'],
  ['find', 'Search name, phone or suburb: /find Parramatta'],
  ['add', 'Add a phone enquiry: /add Name; phone; suburb; the job'],
  ['called', 'Customer called: /called 12'],
  ['quoted', 'Quote sent, inc GST: /quoted 12 4500  (PW → W)'],
  ['won', 'Quote accepted: /won 12  (W → JW)'],
  ['completed', 'Job finished: /completed 12'],
  ['invoiced', 'Invoice sent, inc GST: /invoiced 12 4950'],
  ['paid', 'Invoice paid: /paid 12'],
  ['lost', 'Not going ahead: /lost 12 too expensive'],
  ['note', 'Add a note: /note 12 needs scaffold'],
  ['photos', 'Photos of a job: /photos 12'],
  ['remind', 'Reminder: /remind 12 tomorrow 9am call back'],
  ['reminders', 'Upcoming reminders'],
  ['unremind', 'Delete a reminder: /unremind 3'],
  ['report', 'Report: /report week | month | year | all'],
  ['export', 'All jobs as a spreadsheet (CSV)'],
  ['help', 'All commands']
];
const GROUPS = [
  ['📋 Jobs', ['jobs', 'new', 'job', 'find', 'add']],
  ['🔁 Move a job along', ['called', 'quoted', 'won', 'completed', 'invoiced', 'paid', 'lost']],
  ['📝 Notes, photos and reminders', ['note', 'photos', 'remind', 'reminders', 'unremind']],
  ['📊 Money and reports', ['report', 'export']],
  ['❓ Help', ['menu', 'help']]
];
export function helpText() {
  const d = Object.fromEntries(COMMANDS);
  return '🛠 <b>MBS job tracker: all commands</b>\n' +
    GROUPS.map(([title, cmds]) => `\n<b>${title}</b>\n` + cmds.map((c) => `/${c} – ${E(d[c])}`).join('\n')).join('\n') +
    '\n\n<b>How a job moves</b>\n🆕 New PW-… → 📞 Called → 💬 Quoted W-… → ✅ Won JW-… → 🏁 Completed → 🧾 Invoiced → 💰 Paid' +
    '\n\n<b>Tips</b>\n• Use the short number: /called 12 is the same as /called PW-261025-000012.' +
    '\n• Amounts are inc GST: the GST is worked out for you.' +
    '\n• Reminder times: in 2h · today 3pm · tomorrow 9am · mon 10am · 28/10 9am' +
    '\n• Send a photo with the job number as the caption to save it to that job.' +
    '\n• Tap the ☰ Menu button next to the message box to see all commands any time.' +
    '\n• In the Mr.FixitB channel, post the commands as messages (e.g. /jobs) and tap the buttons under the alerts.';
}

// ---------- Telegram API ----------
const API = () => `${env('TELEGRAM_API_BASE', 'https://api.telegram.org')}/bot${env('TELEGRAM_BOT_TOKEN')}`;
export async function tg(method, payload) {
  try {
    const r = await fetch(`${API()}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    return await r.json().catch(() => ({ ok: r.ok }));
  } catch (e) { return { ok: false, description: e.message }; }
}
async function tgForm(method, fd) {
  try { const r = await fetch(`${API()}/${method}`, { method: 'POST', body: fd }); return await r.json().catch(() => ({ ok: r.ok })); }
  catch (e) { return { ok: false, description: e.message }; }
}
export async function send(chat, text, buttons, extra = {}) {
  const chunks = [];
  let t = String(text);
  while (t.length > 4000) { const cut = t.lastIndexOf('\n', 4000); chunks.push(t.slice(0, cut > 1000 ? cut : 4000)); t = t.slice(cut > 1000 ? cut : 4000); }
  chunks.push(t);
  let last;
  for (let i = 0; i < chunks.length; i++) {
    last = await tg('sendMessage', { chat_id: chat, text: chunks[i], parse_mode: 'HTML', disable_web_page_preview: true,
      ...(i === chunks.length - 1 && buttons ? { reply_markup: Array.isArray(buttons) ? { inline_keyboard: buttons } : buttons } : {}), ...extra });
  }
  return last;
}
async function sendFile(chat, name, buf, type, caption = '') {
  const fd = new FormData();
  fd.append('chat_id', String(chat));
  fd.append('document', new Blob([buf], { type }), name);
  if (caption) { fd.append('caption', caption); fd.append('parse_mode', 'HTML'); }
  return tgForm('sendDocument', fd);
}
async function sendPhotos(chat, files, caption) {
  for (let i = 0; i < files.length; i += 10) {
    const group = files.slice(i, i + 10), fd = new FormData();
    fd.append('chat_id', String(chat));
    if (group.length === 1) {
      fd.append('photo', new Blob([group[0].buf], { type: group[0].type }), 'photo.jpg');
      if (caption && i === 0) { fd.append('caption', caption); fd.append('parse_mode', 'HTML'); }
      await tgForm('sendPhoto', fd);
    } else {
      fd.append('media', JSON.stringify(group.map((f, k) => ({ type: 'photo', media: `attach://p${k}`, ...(k === 0 && i === 0 && caption ? { caption, parse_mode: 'HTML' } : {}) }))));
      group.forEach((f, k) => fd.append(`p${k}`, new Blob([f.buf], { type: f.type }), `p${k}.jpg`));
      await tgForm('sendMediaGroup', fd);
    }
  }
}

// ---------- who may use the bot ----------
export function allowedIds() {
  return new Set([env('TELEGRAM_CHAT_ID'), ...env('TELEGRAM_ALLOWED_IDS').split(','), ...env('TELEGRAM_ALERT_IDS').split(',')].map((s) => String(s).trim()).filter(Boolean));
}

// ---------- formatting ----------
const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };
export function jobButtons(job, withDetails = false) {
  const c = job.core, row = [];
  const b = (text, data) => ({ text, callback_data: data });
  const s = job.stage;
  if (s === 'new') row.push([b('📞 Called', `st:called:${c}`), b('💬 Quoted…', `ask:quote:${c}`)], [b('⏰ Remind 1 hr', `rem:60:${c}`), b('❌ Lost', `st:lost:${c}`)]);
  if (s === 'called') row.push([b('💬 Quoted…', `ask:quote:${c}`), b('⏰ Remind 1 hr', `rem:60:${c}`)], [b('❌ Lost', `st:lost:${c}`)]);
  if (s === 'quoted') row.push([b('✅ Job won', `st:won:${c}`), b('⏰ Tomorrow 9am', `rem:tmrw:${c}`)], [b('❌ Lost', `st:lost:${c}`)]);
  if (s === 'won') row.push([b('🏁 Completed', `st:completed:${c}`)]);
  if (s === 'completed') row.push([b('🧾 Invoiced…', `ask:invoice:${c}`)]);
  if (s === 'invoiced') row.push([b('💰 Paid', `st:paid:${c}`), b('⏰ Chase in 7 days', `rem:7d:${c}`)]);
  const last = [];
  if (job.photos && job.photos.length) last.push(b(`📷 Photos (${job.photos.length})`, `ph:${c}`));
  if (withDetails) last.push(b('📋 Details', `job:${c}`));
  if (last.length) row.push(last);
  return row;
}
export function jobCard(job, full = true) {
  const L = [`${J.ICON[job.stage]} <b>${E(J.refFor(job))}</b> · ${E(J.LABEL[job.stage])}`];
  L.push(`<b>${E(job.name || 'Customer')}</b>${job.phone ? ' · ' + E(job.phone) : ''}`);
  if (job.suburb || job.service) L.push('📍 ' + [job.suburb, job.service].filter(Boolean).map(E).join(' · '));
  if (job.best_time) L.push('🕑 Best time to call: ' + E(job.best_time));
  if (job.quote) L.push(`💬 Quote ${J.money(job.quote.amount)} inc GST (GST ${J.money(job.quote.gst)})`);
  if (job.invoice) L.push(`🧾 Invoice ${J.money(job.invoice.amount)} inc GST (GST ${J.money(job.invoice.gst)}, ex GST ${J.money(job.invoice.amount - job.invoice.gst)})`);
  if (job.lost_reason) L.push('❌ ' + E(job.lost_reason));
  if (full) {
    if (job.summary) L.push('\n' + E(job.summary.slice(0, 600)));
    if (job.notes && job.notes.length) L.push('\n<b>Notes</b>\n' + job.notes.slice(-5).map((n) => `• ${E(n.text)} <i>(${E(n.by)}, ${whenText(n.at)})</i>`).join('\n'));
    L.push('\n<b>History</b>\n' + job.history.slice(-8).map((h) => `• ${whenText(h.at)} – ${E(h.text)}${h.by && h.by !== 'website' ? ` <i>(${E(h.by)})</i>` : ''}`).join('\n'));
    if (job.mapsUrl) L.push(`\n📍 <a href="${E(job.mapsUrl)}">Directions in Google Maps</a>`);
  }
  return L.join('\n');
}
const line = (j) => `${J.ICON[j.stage]} <b>${E(j.ref)}</b> · ${E(j.name || '?')}${j.suburb ? ' · ' + E(j.suburb.replace(/ NSW( \d{4})?$/, '')) : ''} · ${ago(j.created)}`;
export const MENU = [
  [{ text: '📋 Open jobs', callback_data: 'm:jobs' }, { text: '🆕 New', callback_data: 'm:new' }],
  [{ text: '⏰ Reminders', callback_data: 'm:reminders' }, { text: '📊 This week', callback_data: 'm:week' }],
  [{ text: '📈 This month', callback_data: 'm:month' }, { text: '❓ All commands', callback_data: 'm:help' }]
];
export function amount(text) {
  const m = String(text || '').replace(/[$,\s]/g, '').match(/^(\d+(?:\.\d{1,2})?)(k)?$/i);
  if (!m) return null;
  const n = Number(m[1]) * (m[2] ? 1000 : 1);
  return n > 0 && n < 100000000 ? Math.round(n * 100) / 100 : null;
}

// ---------- periods for reports (Sydney time) ----------
export function period(word, now = Date.now()) {
  const p = parts(now), day = (o) => { const q = parts(sydneyTime(p.y, p.mo, p.d, 12, 0) + o * 86400000); return sydneyTime(q.y, q.mo, q.d, 0, 0); };
  const dow = (new Date(sydneyTime(p.y, p.mo, p.d, 12, 0)).getUTCDay() + 6) % 7;   // Monday = 0
  const w = String(word || 'week').toLowerCase();
  if (w === 'today') return { from: day(0), to: now + 1, name: 'today' };
  if (w === 'lastweek' || w === 'last week') return { from: day(-dow - 7), to: day(-dow), name: 'last week' };
  if (w === 'month') return { from: sydneyTime(p.y, p.mo, 1, 0, 0), to: now + 1, name: 'this month' };
  if (w === 'lastmonth' || w === 'last month') { const y = p.mo === 1 ? p.y - 1 : p.y, mo = p.mo === 1 ? 12 : p.mo - 1; return { from: sydneyTime(y, mo, 1, 0, 0), to: sydneyTime(p.y, p.mo, 1, 0, 0), name: 'last month' }; }
  if (w === 'year') return { from: sydneyTime(p.y, 1, 1, 0, 0), to: now + 1, name: 'this year' };
  if (w === 'fy') { const y = p.mo >= 7 ? p.y : p.y - 1; return { from: sydneyTime(y, 7, 1, 0, 0), to: now + 1, name: `financial year ${y}–${String(y + 1).slice(2)}` }; }
  if (w === 'all') return { from: 0, to: now + 1, name: 'all time' };
  return { from: day(-dow), to: now + 1, name: 'this week' };
}
export async function reportText(word, now = Date.now()) {
  const per = period(word, now), r = J.report(await J.all(), per.from, per.to);
  const L = [`📊 <b>Report: ${E(per.name)}</b>${per.from ? ` (from ${whenText(per.from).replace(/ 12:00am$/, '')})` : ''}`, ''];
  L.push(`🆕 Enquiries: <b>${r.enquiries}</b> · 📞 Called: <b>${r.called}</b>`);
  L.push(`💬 Quotes sent: <b>${r.quotes}</b> · ${J.money(r.quoteValue)}`);
  L.push(`✅ Jobs won: <b>${r.won}</b> · ${J.money(r.wonValue)}${r.winRate !== null ? ` · win rate ${r.winRate}%` : ''}${r.lost ? ` · ❌ lost ${r.lost}` : ''}`);
  L.push(`🏁 Completed: <b>${r.completed}</b>`);
  L.push(`🧾 Invoiced: <b>${r.invoiced}</b> · ${J.money(r.invTotal)} inc GST`);
  L.push(`      GST ${J.money(r.invGst)} · ex GST ${J.money(r.invEx)}`);
  L.push(`💰 Paid: <b>${r.paid}</b> · ${J.money(r.paidTotal)} (GST ${J.money(r.paidGst)})`);
  L.push(`⏳ Owed now: <b>${r.owed}</b> invoice${r.owed === 1 ? '' : 's'} · ${J.money(r.owedTotal)} (GST ${J.money(r.owedGst)})`);
  L.push('', '<b>Open jobs now</b>: ' + J.OPEN.map((s) => `${J.ICON[s]} ${r.pipeline[s]}`).join(' · '));
  return L.join('\n');
}

// ---------- handling messages and button taps ----------
async function needJob(chat, arg, usage) {
  if (!arg) { await send(chat, `Which job? ${usage}`); return null; }
  const job = await J.find(arg);
  if (!job) await send(chat, `I can't find job <b>${E(arg)}</b>. Try /jobs or /find.`);
  return job;
}
async function moveStage(chat, arg, stage, by, extra = {}) {
  const r = await J.setStage(arg, stage, by, extra);
  if (r.error) return send(chat, `I can't find job <b>${E(arg)}</b>. Try /jobs or /find.`);
  const renamed = r.after !== r.before ? `\nNumber changed: ${E(r.before)} → <b>${E(r.after)}</b>` : '';
  return send(chat, `${J.ICON[stage]} <b>${E(r.after)}</b> marked <b>${E(J.LABEL[stage])}</b>${extra.amount ? ` · ${J.money(extra.amount)} inc GST (GST ${J.money(J.gstOf(extra.amount))})` : ''}${renamed}`, jobButtons(r.job, true));
}
// Telegram channels (like Mr.FixitB) can't use "reply to this" prompts, so there we show the command to type
const channels = new Set();
async function askAmount(chat, kind, job) {
  const ref = J.refFor(job);
  if (channels.has(String(chat))) {
    const cmd = kind === 'quote' ? 'quoted' : 'invoiced';
    return send(chat, `${kind === 'quote' ? '💬 Quote' : '🧾 Invoice'} amount for <b>${E(ref)}</b>? Post it like this (inc GST):\n<code>/${cmd} ${E(ref)} 4500</code>`);
  }
  return send(chat, `${kind === 'quote' ? '💬 Quote' : '🧾 Invoice'} amount for ${ref}? Reply with the amount inc GST, e.g. 4500`, null,
    { reply_markup: { force_reply: true, input_field_placeholder: 'Amount inc GST, e.g. 4500' } });
}

export async function handleUpdate(u) {
  const ids = allowedIds();
  // ----- button taps -----
  if (u.callback_query) {
    const q = u.callback_query, chat = q.message && q.message.chat.id, who = q.from.first_name || 'Owner';
    if (q.message && q.message.chat.type === 'channel') channels.add(String(chat));
    if (!ids.has(String(q.from.id)) && !ids.has(String(chat))) { await tg('answerCallbackQuery', { callback_query_id: q.id, text: 'This bot is private.' }); return; }
    await tg('answerCallbackQuery', { callback_query_id: q.id });
    const [kind, a = '', b = ''] = String(q.data || '').split(':');   // e.g. st:called:W-261025-000012
    if (kind === 'm') return command(chat, '/' + (a === 'week' ? 'report week' : a === 'month' ? 'report month' : a), who);
    if (kind === 'st') return moveStage(chat, b, a, who);
    if (kind === 'ask') { const job = await J.find(b); return job ? askAmount(chat, a, job) : null; }
    if (kind === 'rem') {
      const job = await J.find(b); if (!job) return;
      const at = a === '60' ? parseWhen('in 1h') : a === '7d' ? parseWhen('in 7 days') : parseWhen('tomorrow 9am');
      const r = await J.addReminder({ at, text: a === '7d' ? `Chase payment: ${J.refFor(job)} ${job.name}` : `Follow up ${J.refFor(job)} ${job.name}${job.phone ? ' on ' + job.phone : ''}`, core: job.core, chat, by: who });
      return send(chat, `⏰ Reminder #${r.id} set for <b>${whenText(r.at)}</b>: ${E(r.text)}`);
    }
    if (kind === 'job') { const job = await J.find(a); return job ? send(chat, jobCard(job), jobButtons(job)) : null; }
    if (kind === 'ph') return command(chat, '/photos ' + a, who);
    return;
  }
  // private chat, group, or a channel such as Mr.FixitB (channel posts come "from the channel", not a person)
  const m = u.message || u.edited_message || u.channel_post || u.edited_channel_post;
  if (!m) return;
  const chat = m.chat.id, isChannel = m.chat.type === 'channel';
  const who = (m.from && m.from.first_name) || m.author_signature || (isChannel ? m.chat.title || 'Channel' : 'Owner');
  if (isChannel) {
    if (!ids.has(String(chat))) return;       // some other channel: stay quiet
    channels.add(String(chat));
  }
  if (!ids.has(String(m.from && m.from.id)) && !ids.has(String(chat))) {
    if (m.chat.type !== 'private') return;   // only answer strangers in a private chat
    return send(chat, `This bot is private to Modern Building Solutions.\nYour Telegram ID is <code>${E(String(m.from ? m.from.id : chat))}</code> – send it to the owner if you should have access.`);
  }
  // reply to "Quote amount for …?" / "Invoice amount for …?"
  const asked = m.reply_to_message && String(m.reply_to_message.text || '').match(/^(?:💬 )?(Quote|🧾 Invoice|Invoice) amount for (\S+)\?/);
  if (asked && m.text) {
    const amt = amount(m.text);
    if (!amt) return send(chat, `That doesn't look like an amount. Reply again with just the number, e.g. 4500`);
    return moveStage(chat, asked[2], /quote/i.test(asked[1]) ? 'quoted' : 'invoiced', who, { amount: amt });
  }
  // a photo with a job number in the caption: save it to that job
  if (m.photo && m.photo.length) {
    const ref = String(m.caption || '').trim().split(/\s+/)[0];
    const job = ref && await J.find(ref);
    if (!job) return send(chat, 'To save a photo to a job, put the job number in the caption, e.g. <b>12</b> or <b>JW-261025-000012</b>.');
    const big = m.photo[m.photo.length - 1];
    const f = await tg('getFile', { file_id: big.file_id });
    if (!f.ok) return send(chat, 'Sorry, I couldn\'t download that photo from Telegram.');
    const r = await fetch(`${env('TELEGRAM_API_BASE', 'https://api.telegram.org')}/file/bot${env('TELEGRAM_BOT_TOKEN')}/${f.result.file_path}`);
    const buf = Buffer.from(await r.arrayBuffer());
    const saved = await J.savePhotos(job.core, [{ buf, type: 'image/jpeg' }], who);
    const note = String(m.caption || '').trim().split(/\s+/).slice(1).join(' ');
    if (note) await J.addNote(job.core, note, who);
    return send(chat, `📷 Saved to <b>${E(J.refFor(saved))}</b> (${saved.photos.length} photo${saved.photos.length > 1 ? 's' : ''}).`);
  }
  if (!m.text) return;
  return command(chat, m.text, who);
}

async function command(chat, text, who) {
  const [head, ...rest] = String(text).trim().split(/\s+/);
  const cmd = head.toLowerCase().replace(/^\//, '').replace(/@.*$/, '');
  const arg = rest[0] || '', tail = rest.slice(1).join(' '), all = rest.join(' ');
  switch (cmd) {
    case 'start': await send(chat, helpText()); return send(chat, 'What would you like to see?', MENU);
    case 'help': return send(chat, helpText());
    case 'menu': return send(chat, 'What would you like to see?', MENU);
    case 'jobs': {
      const list = await J.list();
      if (!list.length) return send(chat, 'No open jobs. New enquiries from the website appear here automatically, or add one with /add.');
      const out = ['📋 <b>Open jobs</b> (' + list.length + ')'];
      for (const s of J.OPEN) { const g = list.filter((j) => j.stage === s); if (g.length) out.push(`\n<b>${J.ICON[s]} ${J.LABEL[s]}</b> (${g.length})`, ...g.slice(-25).map(line)); }
      out.push('\nDetails: /job 12 (use the last digits)');
      return send(chat, out.join('\n'));
    }
    case 'new': {
      const list = await J.list(['new']);
      if (!list.length) return send(chat, '🆕 Nothing waiting: every enquiry has been called. 👍');
      await send(chat, `🆕 <b>Not called yet</b> (${list.length})`);
      for (const j of list.slice(-10)) { const job = await J.find(j.core); await send(chat, jobCard(job, false), jobButtons(job, true)); }
      return;
    }
    case 'job': { const job = await needJob(chat, arg, 'e.g. /job 12'); return job ? send(chat, jobCard(job), jobButtons(job)) : null; }
    case 'find': {
      if (!all) return send(chat, 'Search for what? e.g. /find Parramatta or /find 0412');
      const hits = await J.search(all);
      return send(chat, hits.length ? `🔎 <b>${hits.length} found</b>\n` + hits.map(line).join('\n') + '\n\nDetails: /job 12' : `Nothing found for “${E(all)}”.`);
    }
    case 'add': {
      const f = (all.includes(';') ? all.split(';') : all.split(',')).map((s) => s.trim());
      if (f.length < 2 || !f[0] || !f[1]) return send(chat, 'Add a phone enquiry like this:\n<code>/add Priya Nair; 0412 345 678; Castle Hill; leaking shower</code>');
      const core = await J.nextCore(tradeCode(f[3] || '', f[3] || ''));
      const job = await J.create({ core, name: f[0], phone: f[1], suburb: f[2] || '', service: f[3] || '', summary: f.slice(3).join('; '), source: 'phone (added by ' + who + ')' }, who);
      return send(chat, `🆕 Added <b>${E(J.refFor(job))}</b>\n\n` + jobCard(job, false), jobButtons(job));
    }
    case 'called': case 'won': case 'completed': case 'paid':
      return arg ? moveStage(chat, arg, cmd, who) : send(chat, `Which job? e.g. /${cmd} 12`);
    case 'quoted': case 'invoiced': {
      if (!arg) return send(chat, `Which job and how much (inc GST)? e.g. /${cmd} 12 4500`);
      const amt = amount(tail);
      if (!amt) { const job = await needJob(chat, arg, ''); return job ? askAmount(chat, cmd === 'quoted' ? 'quote' : 'invoice', job) : null; }
      return moveStage(chat, arg, cmd, who, { amount: amt });
    }
    case 'lost': return arg ? moveStage(chat, arg, 'lost', who, { reason: tail }) : send(chat, 'Which job? e.g. /lost 12 too expensive');
    case 'note': {
      if (!arg || !tail) return send(chat, 'e.g. /note 12 needs scaffold on the north side');
      const job = await J.addNote(arg, tail, who);
      return send(chat, job ? `📝 Note added to <b>${E(J.refFor(job))}</b>.` : `I can't find job <b>${E(arg)}</b>.`);
    }
    case 'photos': {
      const job = await needJob(chat, arg, 'e.g. /photos 12');
      if (!job) return;
      if (!job.photos || !job.photos.length) return send(chat, `No photos saved for <b>${E(J.refFor(job))}</b> yet. Send a photo with <b>${E(J.refFor(job))}</b> as the caption to add one.`);
      const files = [];
      for (const p of job.photos) { const f = await J.photo(p.key); if (f) files.push({ buf: f.buf, type: p.type }); }
      return sendPhotos(chat, files, `📷 <b>${E(J.refFor(job))}</b> · ${E(job.name)} · ${files.length} photo${files.length > 1 ? 's' : ''}`);
    }
    case 'remind': {
      if (!rest.length) return send(chat, 'e.g. /remind 12 tomorrow 9am call back\nor /remind fri 10am order tiles');
      let job = null, words = rest;
      if (J.parseRef(rest[0]) && (job = await J.find(rest[0]))) words = rest.slice(1);
      let at = null, used = 0;
      for (let n = Math.min(4, words.length); n >= 1 && !at; n--) { const t = parseWhen(words.slice(0, n).join(' ')); if (t) { at = t; used = n; } }
      if (!at) return send(chat, 'When? e.g. in 2h · today 3pm · tomorrow 9am · mon 10am · 28/10 9am');
      const note = words.slice(used).join(' ') || (job ? `Follow up ${J.refFor(job)} ${job.name}${job.phone ? ' on ' + job.phone : ''}` : 'Reminder');
      const r = await J.addReminder({ at, text: note, core: job ? job.core : '', chat, by: who });
      return send(chat, `⏰ Reminder #${r.id} set for <b>${whenText(r.at)}</b>${job ? ` (${E(J.refFor(job))})` : ''}: ${E(note)}`);
    }
    case 'reminders': {
      const list = await J.reminders();
      if (!list.length) return send(chat, 'No reminders set. Add one with /remind.');
      return send(chat, '⏰ <b>Upcoming reminders</b>\n' + list.slice(0, 40).map((r) => `#${r.id} · ${whenText(r.at)} · ${E(r.text)}`).join('\n') + '\n\nDelete one: /unremind 3');
    }
    case 'unremind': {
      const gone = await J.removeReminder(Number(String(arg).replace('#', '')));
      return send(chat, gone ? `🗑 Reminder #${gone.id} deleted.` : 'No reminder with that number. See /reminders.');
    }
    case 'report': {
      await send(chat, await reportText(all.replace(/\s*csv$/i, '') || 'week'));
      if (/csv$/i.test(all)) { const per = period(all.replace(/\s*csv$/i, '')); const js = (await J.all()).filter((j) => j.created >= per.from || (j.updated >= per.from)); return sendFile(chat, `mbs-jobs-${per.name.replace(/\s+/g, '-')}.csv`, Buffer.from(J.csv(js)), 'text/csv'); }
      return;
    }
    case 'export': {
      const js = await J.all();
      const p = parts(Date.now());
      return sendFile(chat, `mbs-jobs-${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')}.csv`, Buffer.from(J.csv(js)), 'text/csv', `📄 All ${js.length} jobs (opens in Excel or Google Sheets). Amounts inc GST, with GST shown separately.`);
    }
    default:
      return send(chat, `I don't know “${E(head)}”. Here's everything I can do:`).then(() => send(chat, helpText()));
  }
}
