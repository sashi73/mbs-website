// POST /.netlify/functions/lead
// Body: { lead: { name, phone, email, suburb, service, urgency, best_time, summary, details },
//         photos?: [{ name, data: 'data:image/jpeg;base64,...' }]   (up to 3)
//         channels: ['email','telegram'], source: 'chat'|'contact_form', transcript?: [...], website?: '' }
// Sends the enquiry to the owner by email and/or Telegram.
// Tokens live in environment variables: RESEND_API_KEY, TELEGRAM_BOT_TOKEN, etc.

import { env, cors, json, clean, formatLead, sendEmail, sendTelegram, sendTelegramPhotos, escapeHtml, writeBrief } from '../lib/shared.mjs';
import { nextReference, tradeCode, parsePhotos, savePhotos, saveInquiry } from '../lib/store.mjs';
import { customerLocation, distanceText, qrPng } from '../lib/geo.mjs';

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: 'Invalid JSON' }); }

  // Honeypot: real people never fill the hidden "website" field.
  if (clean(body?.website)) return json(200, { ok: true });

  const lead = body?.lead || {};
  // Where the job is: distance from the base, Google Maps directions and a QR code (never blocks the enquiry)
  let loc = null, qr = null;
  try {
    loc = customerLocation(lead);
    if (loc) { loc.distance = distanceText(loc); qr = qrPng(loc.mapsUrl); }
  } catch (e) { console.error('Location/QR skipped:', e.message); }
  if (!clean(lead.phone) && !clean(lead.email)) {
    return json(400, { error: 'Please include a phone number or email.' });
  }

  const source = clean(body?.source, 40) === 'contact_form' ? 'Website contact form' : 'Website chat';
  const wanted = Array.isArray(body?.channels) && body.channels.length ? body.channels : ['email', 'telegram'];
  // Reference (pre-job) number: TRADE-YYMMDD-running no., e.g. R-261017-000001.
  // Becomes a job number later with a J in front (JR-261017-000001).
  const trade = tradeCode(lead.service, `${clean(lead.details, 1500)} ${clean(lead.summary, 1500)}`);
  const prejob = nextReference(trade);
  const photos = parsePhotos(body?.photos);
  // A professional job brief for the team, written by DeepSeek from the customer's answers.
  // If the AI is unavailable, the plain summary from the website is used instead.
  const brief = await writeBrief(lead, { photos: photos.length, source });
  const leadForTeam = { ...lead, ...(brief ? { summary: brief } : {}), ...(loc ? { suburb: loc.label } : {}) };
  const { L, tg, html, text, legendHtml } = formatLead(leadForTeam, source, prejob, trade, photos.length, loc);

  // Optional: attach the chat transcript to the email so the owner sees the whole conversation.
  let transcriptHtml = '';
  if (Array.isArray(body?.transcript)) {
    const lines = body.transcript.slice(-20).map((m) => {
      const who = m.role === 'user' ? 'Customer' : 'Assistant';
      return `<p style="margin:4px 0"><b>${who}:</b> ${clean(m.content, 800).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</p>`;
    });
    transcriptHtml = `<hr><p style="font-family:Arial,sans-serif;color:#666;font-size:12px">Chat transcript</p><div style="font-family:Arial,sans-serif;font-size:13px">${lines.join('')}</div>`;
  }

  // Email AND Telegram are both mandatory for every enquiry.
  // (Change with REQUIRED_CHANNELS in .env, e.g. REQUIRED_CHANNELS=email)
  const required = env('REQUIRED_CHANNELS', 'email,telegram').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const channels = Array.from(new Set([...required, ...wanted]));

  const results = {};
  const jobs = [];
  if (channels.includes('telegram')) jobs.push(
    sendTelegram(tg)
      .then(async (r) => {
        results.telegram = r;
        // Photos follow the message, so the team sees the problem before they go out
        // QR code of the route: show it to anyone on the team to scan, or tap the link
        if (r.ok && qr) {
          results.telegram_map = await sendTelegramPhotos([{ type: 'image/png', buf: qr, filename: `${prejob}-directions.png` }],
            `🗺 <b>${escapeHtml(prejob)}</b> · Directions to ${escapeHtml(loc.label)}${loc.km !== null ? ' (about ' + loc.km + ' km)' : ''}\n<a href="${escapeHtml(loc.mapsUrl)}">Open in Google Maps</a> · or scan with another phone`);
        }
        if (photos.length) {
          results.telegram_photos = await sendTelegramPhotos(photos, `📷 <b>${escapeHtml(prejob)}</b> · ${photos.length} photo${photos.length > 1 ? 's' : ''} from ${escapeHtml(L.name || 'customer')}${L.phone ? ' · ' + escapeHtml(L.phone) : ''}`);
        }
      })
      .catch(() => (results.telegram = { ok: false }))
  );
  if (channels.includes('email')) jobs.push(
    sendEmail({
      subject: `[${prejob}] New enquiry: ${L.service || 'website'}${L.suburb ? ' in ' + L.suburb : ''} (${L.name || 'customer'})`,
      html: html +
        (photos.length ? `<p style="font-family:Arial,sans-serif;font-size:14px"><b>${photos.length} photo${photos.length > 1 ? 's' : ''} attached</b> (sent by the customer).</p>` : '') +
        transcriptHtml + legendHtml,
      text,
      replyTo: L.email || undefined,
      attachments: photos.map((p) => ({ filename: `${prejob}-${p.filename}`, content: p.base64 }))
        .concat(qr ? [{ filename: `${prejob}-directions-qr.png`, content: qr.toString('base64'), content_id: 'mapqr', content_type: 'image/png' }] : [])
    }).then((r) => (results.email = r)).catch(() => (results.email = { ok: false }))
  );
  await Promise.all(jobs);

  // Optional: email the customer a copy of their conversation (does not affect the team alerts).
  const custEmail = clean(lead.email, 160);
  if (body?.send_copy && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(custEmail)) {
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const convo = (Array.isArray(body.transcript) ? body.transcript : []).slice(-30).map((m) => {
      const who = m.role === 'user' ? 'You' : 'Mr. Fixit';
      return `<p style="margin:0 0 10px"><b style="color:${m.role === 'user' ? '#8A6A1F' : '#111'}">${who}:</b><br>${esc(clean(m.content, 2000)).replace(/\n/g, '<br>')}</p>`;
    }).join('');
    const first = esc((L.name || '').split(' ')[0] || 'there');
    const html =
      `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.55;color:#222;max-width:600px">` +
      `<h2 style="margin:0 0 6px">Your conversation with Mr. Fixit</h2>` +
      `<p style="margin:0 0 16px;color:#666">Modern Building Solutions · Licensed builder 267071C</p>` +
      `<p>Hi ${first},</p><p>Thanks for getting in touch. Here's a copy of our conversation. Our team has your question and will be in touch soon.</p>` +
      `<p>Your reference number is <b>${prejob}</b>.</p>` +
      `<div style="border-left:3px solid #D4AF37;padding:12px 16px;background:#faf8f2;margin:16px 0">${convo}</div>` +
      `<p>If it's urgent, call us on <b>0420 494 990</b>.</p>` +
      `<p style="color:#888;font-size:12px">General advice only. For anything electrical, gas, structural or at height, always use a licensed professional.</p></div>`;
    results.customer_copy = await sendEmail({
      to: custEmail,
      subject: `Your conversation with Mr. Fixit (ref ${prejob}) - Modern Building Solutions`,
      html,
      text: 'Thanks for getting in touch with Modern Building Solutions. Our team has your question and will be in touch soon. Call 0420 494 990 if urgent.',
      replyTo: env('PUBLIC_CONTACT_EMAIL', 'mbs.pty.ltd@gmail.com')
    }).catch((e) => ({ ok: false, reason: e.message }));
  }

  // Backup copy on your computer (local server only), so no enquiry is ever lost.
  let saved = false;
  if (process.env.MBS_LOCAL === '1') {
    try {
      const { mkdir, appendFile } = await import('node:fs/promises');
      await mkdir('leads', { recursive: true });
      await appendFile('leads/leads.jsonl', JSON.stringify({ at: new Date().toISOString(), prejob, trade, source, lead: L, photos: photos.length, results }) + '\n');
      saved = true;
    } catch (e) { console.error('Could not save backup copy:', e.message); }
  }

  // Keep the photos on this computer too (data/photos/<reference>/)
  let photoFiles = [];
  if (process.env.MBS_LOCAL === '1' && photos.length) {
    try { photoFiles = savePhotos(prejob, photos); } catch (e) { console.error('Could not save photos:', e.message); }
  }

  // Clear report in the server window
  const line = (name, r) => !r ? `  ${name}: not requested`
    : r.ok ? `  ${name}: sent`
    : `  ${name}: NOT sent - ${r.reason || 'error ' + (r.status || '')}`;
  // Save to the SQLite enquiries database (data/mbs.db), local server only
  let inDb = false;
  if (process.env.MBS_LOCAL === '1') {
    try {
      inDb = await saveInquiry({ prejob, tradeCode: trade, photos: photoFiles, source, lead: { ...L, details: [clean(lead.details, 1500)].concat((Array.isArray(lead.scope) ? lead.scope : []).slice(0, 5).map((x) => `${clean(x && x.q, 200)} ${clean(x && x.a, 300)}`)).filter((x) => x.trim()).join('\n') }, transcript: body?.transcript,
        emailSent: !!(results.email && results.email.ok), telegramSent: !!(results.telegram && results.telegram.ok) });
    } catch (e) { console.error('Could not save to database:', e.message); }
  }

  console.log(`\n[${new Date().toLocaleTimeString()}] ${prejob}  New enquiry from ${L.name || 'customer'} (${source})`);
  console.log(line('Email   ', results.email));
  console.log(line('Telegram', results.telegram));
  if (loc) console.log(`  Location: ${loc.label}${loc.km !== null ? ' (about ' + loc.km + ' km from ' + loc.base + ')' : ''}${qr ? ', map link + QR sent' : ''}`);
  if (photos.length) console.log(line('Photos  ', results.telegram_photos ? { ok: results.telegram_photos.ok, reason: results.telegram_photos.reason } : { ok: true }) + ` (${photos.length}, also attached to the email)`);
  if (results.customer_copy) console.log(line('Copy to customer', results.customer_copy));
  if (inDb) console.log('  Database: saved to data/mbs.db');
  if (saved) console.log('  Backup  : saved to leads/leads.jsonl');

  const reasons = Object.fromEntries(Object.entries(results).map(([k, r]) => [k, r.ok ? 'sent' : (r.reason || 'failed')]));
  const delivered = required.every((k) => results[k] && results[k].ok);
  if (!delivered) {
    console.log(`  RESULT  : FAILED - ${required.join(' and ')} must all be sent`);
    return json(502, { ok: false, prejob_no: prejob, reasons, saved, error: 'We could not send that just now. Please call 0420 494 990.' });
  }
  return json(200, { ok: true, prejob_no: prejob, reasons, saved });
};
