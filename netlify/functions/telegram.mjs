// POST /.netlify/functions/telegram  - Telegram sends every message and button tap here (webhook).
// GET  /.netlify/functions/telegram?setup=<TELEGRAM_WEBHOOK_SECRET>
//      one-time setup: connects the bot to this website and fills Telegram's Menu with all the commands.
import { env } from '../lib/shared.mjs';
import { handleUpdate, tg, COMMANDS } from '../lib/bot.mjs';

const page = (title, body) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>` +
  `<body style="font-family:system-ui,Arial,sans-serif;max-width:640px;margin:40px auto;padding:0 16px;line-height:1.5;background:#0A0A0A;color:#EDEAE3">` +
  `<h1 style="color:#F2D98B;font-size:24px">${title}</h1>${body}</body>`, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export default async (req) => {
  const secret = env('TELEGRAM_WEBHOOK_SECRET');
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const given = url.searchParams.get('setup');
    if (!given) return new Response('Not found', { status: 404 });
    if (!secret || !/^[A-Za-z0-9_-]{16,256}$/.test(secret)) return page('Telegram bot setup', '<p>First add <b>TELEGRAM_WEBHOOK_SECRET</b> in Netlify (Site configuration → Environment variables): 16 or more letters, numbers, - or _. Then redeploy and open this page again.</p>');
    if (given !== secret) return new Response('Not found', { status: 404 });
    if (!env('TELEGRAM_BOT_TOKEN') || !env('TELEGRAM_CHAT_ID')) return page('Telegram bot setup', '<p>TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set in Netlify first.</p>');
    const hook = `${url.origin}/.netlify/functions/telegram`;
    const a = await tg('setWebhook', { url: hook, secret_token: secret, allowed_updates: ['message', 'edited_message', 'channel_post', 'edited_channel_post', 'callback_query'], drop_pending_updates: false });
    const b = await tg('setMyCommands', { commands: COMMANDS.map(([command, description]) => ({ command, description: description.slice(0, 256) })) });
    const c = await tg('setChatMenuButton', { menu_button: { type: 'commands' } });
    const info = await tg('getWebhookInfo', {});
    const ok = a.ok && b.ok;
    if (ok) await tg('sendMessage', { chat_id: env('TELEGRAM_CHAT_ID'), parse_mode: 'HTML', text: '✅ <b>MBS job tracker is connected.</b>\nSend /help for all commands, or tap the ☰ Menu button next to the message box.' });
    return page(ok ? '✅ Telegram bot connected' : '⚠️ Telegram bot setup had a problem',
      `<p>Messages to the bot now go to:<br><code>${esc(hook)}</code></p>` +
      `<ul><li>Connect to this website: <b>${a.ok ? 'done' : 'failed: ' + esc(a.description || '')}</b></li>` +
      `<li>Command list in Telegram's Menu: <b>${b.ok ? 'done (' + COMMANDS.length + ' commands)' : 'failed: ' + esc(b.description || '')}</b></li>` +
      `<li>Menu button: <b>${c.ok ? 'done' : 'skipped'}</b></li></ul>` +
      (info.result && info.result.last_error_message ? `<p>Telegram's last error: ${esc(info.result.last_error_message)}</p>` : '') +
      (ok ? '<p>Open Telegram and send <b>/help</b> to your bot.</p>' : ''));
  }

  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  // only Telegram knows the secret (it sends it in this header with every message)
  if (!secret || req.headers.get('x-telegram-bot-api-secret-token') !== secret) return new Response('Forbidden', { status: 403 });
  let update;
  try { update = await req.json(); } catch { return new Response('ok'); }
  try { await handleUpdate(update); }
  catch (e) {
    console.error('Telegram bot error:', e);
    const chat = (update.message && update.message.chat.id) || (update.channel_post && update.channel_post.chat.id) || (update.callback_query && update.callback_query.message && update.callback_query.message.chat.id);
    if (chat) await tg('sendMessage', { chat_id: chat, text: 'Sorry, something went wrong with that. Please try again in a moment. (' + String(e.message || e).slice(0, 120) + ')' });
  }
  return new Response('ok');   // always 200, so Telegram doesn't keep re-sending the same message
};
