// Checks your .env settings one by one and sends a test Telegram message and email.
//
//   node --env-file=.env tools/check-setup.mjs
//
// Nothing here prints your keys.

const env = (k, d = '') => (process.env[k] ?? '').trim() || d;
const ok = (m) => console.log(`  ✔  ${m}`);
const bad = (m) => console.log(`  ✘  ${m}`);
const info = (m) => console.log(`     ${m}`);

async function checkAI() {
  console.log('\n1. DeepSeek AI');
  const key = env('LLM_API_KEY');
  if (!key) return bad('LLM_API_KEY is empty in .env');
  const base = env('LLM_BASE_URL', 'https://api.deepseek.com').replace(/\/+$/, '');
  try {
    const r = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: env('LLM_MODEL', 'deepseek-chat'), max_tokens: 10,
        messages: [{ role: 'user', content: 'Reply with the single word: ready' }] })
    });
    if (r.status === 401) return bad('The key was rejected (401). Check LLM_API_KEY, no spaces or quotes.');
    if (r.status === 402) return bad('DeepSeek says the account has no balance (402). Top up at platform.deepseek.com.');
    if (!r.ok) return bad(`AI call failed with status ${r.status}: ${(await r.text()).slice(0, 160)}`);
    const j = await r.json();
    ok(`AI key works. Model replied: "${String(j?.choices?.[0]?.message?.content ?? '').trim().slice(0, 40)}"`);
  } catch (e) { bad(`Could not reach ${base} (${e.message}). Check your internet connection.`); }
}

async function checkTelegram() {
  console.log('\n3. Telegram (required)');
  const token = env('TELEGRAM_BOT_TOKEN');
  if (!token) return bad('TELEGRAM_BOT_TOKEN is empty. Create a bot with @BotFather in Telegram and paste the token into .env.');
  const base = env('TELEGRAM_API_BASE', 'https://api.telegram.org');
  try {
    const me = await (await fetch(`${base}/bot${token}/getMe`)).json();
    if (!me.ok) return bad('Telegram rejected the bot token. Copy it again from @BotFather.');
    ok(`Bot found: @${me.result.username}`);

    const chatId = env('TELEGRAM_CHAT_ID');
    if (!chatId) {
      const up = await (await fetch(`${base}/bot${token}/getUpdates`)).json();
      const chats = new Map();
      (up.result || []).forEach((u) => {
        const c = (u.message || u.channel_post || u.my_chat_member || {}).chat;
        if (c) chats.set(c.id, c.title || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username || c.type);
      });
      if (!chats.size) {
        bad('TELEGRAM_CHAT_ID is empty, and the bot has no messages yet.');
        info(`Open Telegram, search @${me.result.username}, press Start and send "hi". Then run this check again.`);
        return;
      }
      bad('TELEGRAM_CHAT_ID is empty. Copy one of these into .env:');
      chats.forEach((name, id) => info(`TELEGRAM_CHAT_ID=${id}     (${name})`));
      return;
    }

    const r = await (await fetch(`${base}/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: '✅ Mr. Fixit test: Telegram alerts are working.' })
    })).json();
    if (r.ok) ok('Test message sent. Check Telegram.');
    else bad(`Telegram could not send to chat ${chatId}: ${r.description || 'unknown error'}. Did you press Start on the bot?`);
  } catch (e) { bad(`Could not reach Telegram (${e.message}).`); }
}

async function checkEmail() {
  console.log('\n2. Email (Resend)');
  const key = env('RESEND_API_KEY');
  const to = env('OWNER_EMAIL', 'sashi1973@gmail.com');
  if (!key) return bad('RESEND_API_KEY is empty. Create one at resend.com > API Keys.');
  const base = env('RESEND_API_BASE', 'https://api.resend.com');
  try {
    const r = await fetch(`${base}/emails`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        from: env('FROM_EMAIL', 'MBS Website <onboarding@resend.dev>'),
        to: to.split(',').map((s) => s.trim()),
        subject: 'Mr. Fixit test: email alerts are working',
        text: 'If you can read this, website enquiries will reach this inbox.'
      })
    });
    if (r.ok) return ok(`Test email sent to ${to}. Check the inbox (and spam folder).`);
    const t = await r.text();
    bad(`Resend refused the email (status ${r.status}).`);
    if (r.status === 403 || /verify|testing emails|own email/i.test(t)) {
      info('With onboarding@resend.dev you can only send to the email you signed up with.');
      info('Either set OWNER_EMAIL to that address, or verify your domain in Resend and set FROM_EMAIL to it.');
    } else info(t.slice(0, 200));
  } catch (e) { bad(`Could not reach Resend (${e.message}).`); }
}

// ------------------------------------------------------------------
// Ask Mr. Fixit a question directly (same settings as the website):
//   node --env-file=.env tools/check-setup.mjs "Why is my paint peeling?"
// ------------------------------------------------------------------
async function askQuestion(question) {
  const { EXPERT_PROMPT, stripThinking } = await import('../netlify/lib/shared.mjs');
  console.log('\nAsk Mr. Fixit');
  console.log('-------------');
  const key = env('LLM_API_KEY');
  if (!key) return bad('LLM_API_KEY is empty in .env');
  const base = env('LLM_BASE_URL', 'https://api.deepseek.com').replace(/\/+$/, '');
  let model = env('LLM_MODEL', 'deepseek-chat');
  if (/reasoner|thinking/i.test(model)) model = 'deepseek-chat';
  const maxTokens = Math.min(Number(env('LLM_MAX_TOKENS', '500')) || 500, 500);
  console.log(`  Question : ${question}`);
  console.log(`  Settings : model ${model} (thinking off), max ${maxTokens} tokens\n`);
  const t0 = Date.now();
  try {
    const r = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, temperature: 0.3, max_tokens: maxTokens, stream: false,
        messages: [{ role: 'system', content: EXPERT_PROMPT }, { role: 'user', content: question }] })
    });
    if (!r.ok) return bad(`DeepSeek error ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    const answer = stripThinking(j?.choices?.[0]?.message?.content ?? '');
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(answer.split('\n').map((l) => '  ' + l).join('\n'));
    const u = j.usage || {};
    console.log(`\n  ---\n  Answered in ${secs}s` + (u.total_tokens ? `, ${u.completion_tokens} answer tokens (${u.total_tokens} total)` : ''));
    ok('The website will give answers like this one.');
  } catch (e) { bad(`Could not reach DeepSeek (${e.message}).`); }
}

// ------------------------------------------------------------------
// Try the "Get a free quote" questions (same as the website):
//   node --env-file=.env tools/check-setup.mjs --quote "I want to paint my entire house"
// Type your answers; press Enter on an empty line to stop.
// ------------------------------------------------------------------
async function tryQuote(job) {
  const { default: chat } = await import('../netlify/functions/chat.mjs');
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log('\nGet a free quote: Mr. Fixit\'s questions');
  console.log('---------------------------------------');
  console.log(`  Job: ${job}\n`);
  const qa = [];
  for (let i = 0; i < 5; i++) {
    const res = await chat(new Request('http://local/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'scope', job, qa }) }));
    const j = await res.json();
    if (j.reason) { bad(j.reason); break; }
    if (j.done || !j.question) break;
    console.log(`  Q${i + 1}. ${j.question}` + (j.options && j.options.length ? `   [${j.options.join(' / ')}]` : ''));
    const a = (await rl.question('      Your answer: ')).trim();
    if (!a) break;
    qa.push({ q: j.question, a });
  }
  rl.close();
  console.log(qa.length ? `\n  ${qa.length} question(s) asked. This is the "Job scope" your team will see.` : '');
  if (qa.length) ok('Quote questions are working.');
}

if (process.argv[2] === '--quote') {
  await tryQuote(process.argv.slice(3).join(' ').trim() || 'I want to paint my entire house');
  console.log('');
  process.exit(0);
}

// Optional: Mr. Fixit's voice in other languages (DeepSeek translation + Azure Speech)
async function checkVoice() {
  console.log('\n4. Voice in other languages (optional)');
  if (!env('AZURE_SPEECH_KEY')) { console.log('  -  Not set up: add AZURE_SPEECH_KEY and AZURE_SPEECH_REGION to .env to hear Polish, Tamil, Hindi, Chinese, Arabic, Vietnamese, Greek and Persian on any device.'); return; }
  const { translateText, synthesize } = await import('../netlify/lib/shared.mjs');
  const t = await translateText('Hello, I am Mr. Fixit. How can I help you today?', 'ar');
  if (!t.ok) return bad('Translation failed: ' + t.reason);
  console.log('  Arabic: ' + t.text);
  const a = await synthesize(t.text, 'ar');
  if (!a.ok) return bad(a.reason);
  ok(`Azure Speech works (${Math.round(a.audio.length / 1024)} KB of Arabic audio). Voices in all languages are ready.`);
}

const question = process.argv.slice(2).join(' ').trim();
if (question) {
  await askQuestion(question);
  console.log('');
  process.exit(0);
}

console.log('\nMBS setup check');
console.log('---------------');
await checkAI();
await checkEmail();
await checkTelegram();
await checkVoice();
console.log(`\nWhen all three show ✔, start the site and open http://localhost:${env('PORT', '8888')}`);
console.log('Every enquiry is sent by BOTH email and Telegram, so both must work.\n');
