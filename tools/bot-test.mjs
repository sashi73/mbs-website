// Telegram job tracker test (42 checks), run in the site folder:  npm install  then  node tools/bot-test.mjs
// Tests the Telegram job tracker exactly as Netlify runs it: the real function files, Netlify Blobs (official
// local Blobs server), and a stand-in Telegram + email server that records every message the bot sends.
import http from 'node:http';
import { rmSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const SITE = process.argv[2] || process.cwd();
const require = createRequire(SITE + '/package.json');
const { BlobsServer } = await import(require.resolve('@netlify/blobs/server'));

const results = [];
const ok = (area, name, pass, detail = '') => { results.push({ area, name, pass: !!pass, detail }); };

// ---- Netlify Blobs (official local server) ----
const dir = (await import('node:path')).join((await import('node:os')).tmpdir(), 'mbs-bot-test-blobs');
rmSync(dir, { recursive: true, force: true });
const blobs = new BlobsServer({ directory: dir, token: 'tok', port: 0 });
const { port: bport } = await blobs.start();
process.env.NETLIFY_BLOBS_CONTEXT = Buffer.from(JSON.stringify({ siteID: 'mbs', token: 'tok', edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, apiURL: `http://localhost:${bport}` })).toString('base64');

// ---- stand-in Telegram + Resend ----
const calls = [];
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
const mock = http.createServer((req, res) => {
  const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => {
    const raw = Buffer.concat(chunks), method = req.url.split('/').pop();
    let body = null; try { body = JSON.parse(raw.toString()); } catch { body = raw.toString('latin1'); }
    calls.push({ url: req.url, method, body });
    if (req.url.startsWith('/file/')) return res.writeHead(200, { 'Content-Type': 'image/jpeg' }).end(JPEG);
    const result = method === 'getFile' ? { file_path: 'photos/file_1.jpg' } : method === 'getWebhookInfo' ? { url: 'x' } : { message_id: calls.length };
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, id: 'e1', result }));
  });
});
await new Promise((r) => mock.listen(0, '127.0.0.1', r));
const MP = mock.address().port;
Object.assign(process.env, {
  TELEGRAM_BOT_TOKEN: 'test', TELEGRAM_CHAT_ID: '111', TELEGRAM_API_BASE: `http://127.0.0.1:${MP}`, TELEGRAM_WEBHOOK_SECRET: 'mbs-test-secret-123456',
  RESEND_API_KEY: 'test', RESEND_API_BASE: `http://127.0.0.1:${MP}`, OWNER_EMAIL: 'owner@example.com', LLM_API_KEY: ''
});
delete process.env.MBS_LOCAL;

const lead = (await import(SITE + '/netlify/functions/lead.mjs')).default;
const telegram = (await import(SITE + '/netlify/functions/telegram.mjs')).default;
const remMod = await import(SITE + '/netlify/functions/reminders.mjs');
const J = await import(SITE + '/netlify/lib/jobs.mjs');

const msgs = () => calls.filter((c) => c.method === 'sendMessage').map((c) => c.body);
const lastMsg = () => msgs().slice(-1)[0] || {};
const since = (n) => calls.slice(n);
let uid = 1;
const hook = (update, secret = process.env.TELEGRAM_WEBHOOK_SECRET) => telegram(new Request('https://mbs.example/.netlify/functions/telegram', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(secret ? { 'x-telegram-bot-api-secret-token': secret } : {}) }, body: JSON.stringify({ update_id: uid++, ...update }) }));
const say = (text, from = 111, extra = {}) => hook({ message: { message_id: uid, from: { id: from, first_name: from === 111 ? 'Sashi' : 'Stranger' }, chat: { id: from, type: 'private' }, date: 1, text, ...extra } });
const tap = (data, from = 111) => hook({ callback_query: { id: 'cb' + uid, from: { id: from, first_name: 'Sashi' }, message: { message_id: 1, chat: { id: from } }, data } });

// 1. a website enquiry becomes a job
const photo = 'data:image/jpeg;base64,' + JPEG.toString('base64');
let n0 = calls.length;
let r = await lead(new Request('https://mbs.example/.netlify/functions/lead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
  source: 'chat', channels: ['email', 'telegram'], photos: [{ name: 'a.jpg', data: photo }],
  lead: { name: 'Priya Nair', phone: '0412 345 678', suburb: 'Castle Hill', postcode: '2154', lat: -33.73, lng: 151.0, service: 'Leak repair', best_time: 'This afternoon', summary: 'Water through the bathroom ceiling', details: 'leak after rain' } }) }));
let j = await r.json();
ok('Enquiry', 'website enquiry gets a preliminary number PW-YYMMDD-000001', r.status === 200 && /^PW-\d{6}-000001$/.test(j.prejob_no), j.prejob_no);
const ref1 = j.prejob_no, core1 = ref1.slice(1);
const alert = since(n0).find((c) => c.method === 'sendMessage');
ok('Enquiry', 'Telegram alert has job buttons (Called / Quoted / Remind / Lost / Photos)', alert && JSON.stringify(alert.body.reply_markup || {}).includes(`st:called:${core1}`) && JSON.stringify(alert.body.reply_markup).includes('ph:'), JSON.stringify(alert && alert.body.reply_markup || {}).slice(0, 120));
const saved = await J.find(core1);
ok('Enquiry', 'job saved in Netlify Blobs with its photo', saved && saved.stage === 'new' && saved.photos && saved.photos.length === 1);
ok('Enquiry', 'call-back reminder created automatically at the best time', (await J.reminders()).some((x) => x.core === core1 && /Call Priya Nair on 0412 345 678/.test(x.text)));

// 2. security and setup
r = await hook({ message: { chat: { id: 111 }, from: { id: 111 }, text: '/jobs' } }, 'wrong'); ok('Security', 'webhook rejects calls without the secret', r.status === 403, r.status);
n0 = calls.length; await say('/jobs', 999);
ok('Security', 'a stranger is refused (and told their Telegram ID)', /private to Modern Building Solutions/.test(lastMsg().text) && /999/.test(lastMsg().text) && !/Priya/.test(lastMsg().text));
r = await telegram(new Request('https://mbs.example/.netlify/functions/telegram?setup=nope')); ok('Security', 'setup page needs the secret', r.status === 404, r.status);
n0 = calls.length;
r = await telegram(new Request('https://mbs.example/.netlify/functions/telegram?setup=' + process.env.TELEGRAM_WEBHOOK_SECRET));
const setCmds = since(n0).find((c) => c.method === 'setMyCommands'), setHook = since(n0).find((c) => c.method === 'setWebhook');
ok('Setup', 'one visit connects the webhook (with the secret) to this site', r.status === 200 && setHook && setHook.body.url === 'https://mbs.example/.netlify/functions/telegram' && setHook.body.secret_token === process.env.TELEGRAM_WEBHOOK_SECRET);
ok('Setup', "all 21 commands are put in Telegram's ☰ Menu", setCmds && setCmds.body.commands.length === 21, setCmds && setCmds.body.commands.map((c) => c.command).join(' '));

// 3. command list
await say('/help');
const help = lastMsg().text || '';
const names = ['jobs', 'new', 'job', 'find', 'add', 'called', 'quoted', 'won', 'completed', 'invoiced', 'paid', 'lost', 'note', 'photos', 'remind', 'reminders', 'unremind', 'report', 'export', 'menu', 'help'];
ok('Commands', '/help shows every command, grouped, with examples', names.every((c) => help.includes('/' + c + ' ')) && /How a job moves/.test(help), names.filter((c) => !help.includes('/' + c + ' ')).join(','));
await say('/menu'); ok('Commands', '/menu shows quick buttons', JSON.stringify(lastMsg().reply_markup || {}).includes('m:jobs'));
await say('/start'); ok('Commands', '/start shows the commands and the menu', /m:help/.test(JSON.stringify(lastMsg().reply_markup || {})));
await say('/blah'); ok('Commands', 'an unknown command shows the full list', /all commands/i.test(lastMsg().text || ''));

// 4. the job's life: PW -> W -> JW
await say('/jobs'); ok('Life cycle', '/jobs lists the new job', (lastMsg().text || '').includes(ref1));
await say('/new'); ok('Life cycle', '/new shows jobs not called yet', msgs().slice(-2).some((m) => (m.text || '').includes('Priya Nair')));
await tap(`st:called:${core1}`); ok('Life cycle', 'tapping "Called" marks it called', /marked <b>Called<\/b>/.test(lastMsg().text || ''));
await say('/quoted 1 $4,500'); const q = lastMsg().text || '';
ok('Life cycle', '/quoted 1 4500: number changes PW → W, GST shown', q.includes(`${ref1} → <b>${core1}</b>`) && q.includes('$4,500.00') && q.includes('$409.09'), q.slice(0, 160));
await tap(`st:won:${core1}`); const w = lastMsg().text || '';
ok('Life cycle', 'tapping "Job won": number changes W → JW', w.includes(`${core1} → <b>J${core1}</b>`), w.slice(0, 120));
await say('/completed J' + core1); ok('Life cycle', '/completed with the full JW number works', /Completed/.test(lastMsg().text || ''));
await tap(`ask:invoice:${core1}`); const askMsg = lastMsg();
ok('Life cycle', 'tapping "Invoiced…" asks for the amount', askMsg.reply_markup && askMsg.reply_markup.force_reply && /Invoice amount for J/.test(askMsg.text));
await say('4,950', 111, { reply_to_message: { message_id: 5, text: askMsg.text } });
const inv = lastMsg().text || '';
ok('Life cycle', 'replying with the amount records the invoice, GST $450', inv.includes('Invoiced') && inv.includes('$4,950.00') && inv.includes('$450.00'), inv.slice(0, 160));
await say('/paid 1'); ok('Life cycle', '/paid 1 marks it paid', /Paid/.test(lastMsg().text || ''));
await say('/job 1'); const card = lastMsg().text || '';
ok('Life cycle', '/job 1 shows the full card with history of all 3 numbers', card.includes('J' + core1) && card.includes('Paid') && card.includes(`(${ref1} → ${core1})`) && card.includes(`(${core1} → J${core1})`));

// 5. phone enquiries, search, notes, lost
await say('/add Tom Lee; 0400 111 222; Parramatta; cracked render on front wall');
const added = lastMsg().text || '';
ok('Jobs', '/add creates a phone enquiry with its own PC/PW number', /Added <b>P[A-Z]-\d{6}-000002<\/b>/.test(added), added.slice(0, 80));
await say('/find parramatta'); ok('Jobs', '/find searches by suburb', (lastMsg().text || '').includes('Tom Lee'));
await say('/find 0400 111'); ok('Jobs', '/find searches by phone', (lastMsg().text || '').includes('Tom Lee'));
await say('/note 2 needs scaffold'); ok('Jobs', '/note adds a note', /Note added/.test(lastMsg().text || ''));
await say('/lost 2 went with another builder'); ok('Jobs', '/lost records the reason', /Lost/.test(lastMsg().text || ''));

// 6. reminders
await say('/remind 1 tomorrow 9am check the paint has cured'); ok('Reminders', '/remind with a job and a time', /Reminder #\d+ set for <b>\w{3} \d+ \w+ 9:00am<\/b>/.test(lastMsg().text || ''), lastMsg().text);
await say('/remind in 2h order tiles'); ok('Reminders', '/remind without a job', /order tiles/.test(lastMsg().text || ''));
await say('/reminders'); const rl = lastMsg().text || ''; ok('Reminders', '/reminders lists them', /order tiles/.test(rl) && /check the paint/.test(rl));
const id = Number((rl.match(/#(\d+) · [^\n]*order tiles/) || [])[1]);
await say('/unremind ' + id); ok('Reminders', '/unremind deletes one', /deleted/.test(lastMsg().text || ''));
n0 = calls.length;
const sent = await remMod.runReminders(Date.now() + 2 * 86400000);
const remMsgs = since(n0).filter((c) => c.method === 'sendMessage').map((c) => c.body.text);
ok('Reminders', 'due reminders are sent (call-back + follow-up), once each', remMsgs.some((t) => /Call Priya Nair/.test(t)) && remMsgs.some((t) => /check the paint/.test(t)) && !remMsgs.some((t) => /order tiles/.test(t)), sent.join(','));
n0 = calls.length; await remMod.runReminders(Date.now() + 2 * 86400000);
ok('Reminders', 'nothing is sent twice', !since(n0).some((c) => c.method === 'sendMessage' && /Reminder/.test(c.body.text)));
// weekly report: next Monday 7:10am Sydney
const mon = (() => { let t = Date.now(); for (let i = 0; i < 8; i++) { const d = new Date(t + i * 86400000); const s = d.toLocaleString('en-AU', { timeZone: 'Australia/Sydney', weekday: 'short' }); if (/Mon/.test(s)) { const ymd = d.toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' }); return Date.parse(ymd + 'T07:10:00+11:00'); } } })();
n0 = calls.length; await remMod.runReminders(mon); const wk = since(n0).find((c) => c.method === 'sendMessage' && /Good morning/.test(c.body.text));
n0 = calls.length; await remMod.runReminders(mon + 600000); const wk2 = since(n0).find((c) => c.method === 'sendMessage' && /Good morning/.test(c.body.text));
ok('Reminders', 'weekly report arrives Monday 7am, once', !!wk && !wk2);

// 7. reports and export
await say('/report month'); const rep = lastMsg().text || '';
ok('Report', '/report month: invoiced inc GST, GST and ex GST shown separately', rep.includes('$4,950.00 inc GST') && rep.includes('GST $450.00') && rep.includes('ex GST $4,500.00') && /Jobs won: <b>1<\/b>/.test(rep) && /win rate 50%/.test(rep), rep.replace(/\n/g, ' | ').slice(0, 400));
n0 = calls.length; await say('/export');
const doc = since(n0).find((c) => c.method === 'sendDocument');
ok('Report', '/export sends a spreadsheet (CSV) of all jobs', doc && /filename="mbs-jobs-\d{4}-\d{2}-\d{2}\.csv"/.test(doc.body) && doc.body.includes('J' + core1) && doc.body.includes('invoice_gst'));

// 8. photos
n0 = calls.length; await say('/photos 1');
ok('Photos', '/photos sends the customer photo back', since(n0).some((c) => c.method === 'sendPhoto' && c.body.includes('image/jpeg')));
n0 = calls.length;
await hook({ message: { message_id: 77, from: { id: 111, first_name: 'Sashi' }, chat: { id: 111 }, caption: '1 after photo', photo: [{ file_id: 'small' }, { file_id: 'big' }] } });
const p2 = await J.find(core1);
ok('Photos', 'a photo sent with the job number as caption is saved to the job', p2.photos.length === 2 && since(n0).some((c) => c.method === 'getFile' && c.body.file_id === 'big') && /Saved to/.test(lastMsg().text || ''));
n0 = calls.length; await tap(`ph:${core1}`);
ok('Photos', 'the Photos button sends them as an album', since(n0).some((c) => c.method === 'sendMediaGroup'));

// 9. numbers are never repeated: if another change lands between reading and saving, the save retries
const kv = await import(SITE + '/netlify/lib/kv.mjs');
const fs = await import('node:fs');
const findFile = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = d + '/' + e.name; if (e.isDirectory()) { const r = findFile(p); if (r) return r; } else if (e.name === 'seq' && !p.includes('metadata')) return p; } return null; };
const seqFile = findFile(dir);
const before = (await kv.get('seq')).run;
let calls1 = 0;
const res = await kv.update('seq', (s) => {
  calls1++;
  if (calls1 === 1) {   // someone else takes the next 5 numbers right now
    fs.writeFileSync(seqFile, JSON.stringify({ run: before + 5 }));
    const t = new Date(Date.now() + 5000); fs.utimesSync(seqFile, t, t);
  }
  return { run: (s.run || 0) + 1 };
}, () => ({ run: 0 }));
ok('Numbers', 'a clash between two enquiries is detected and retried (no number used twice)', res.run === before + 6 && calls1 === 2, `before ${before}, got ${res.run}, tries ${calls1}`);
ok('Numbers', 'any form of the number finds the job (PW, W, JW, or just 1)', (await J.find('p' + core1.toLowerCase())).core === core1 && (await J.find('1')).core === core1 && (await J.find('J' + core1)).core === core1);

await blobs.stop(); mock.close();
let pass = 0;
for (const x of results) { if (x.pass) pass++; console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.detail !== '' && !x.pass ? '  (' + x.detail + ')' : ''}`); }
console.log(`\n${pass}/${results.length} passed`);
process.exit(0);
