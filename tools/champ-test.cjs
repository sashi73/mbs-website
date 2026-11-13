// End-to-end test of GKH Project Champ: the 5-page site, the login page (built-in owner login, no ADMIN_* settings),
// Google sign-in (against a fake Google token checker), and a new project from the form to a plan.
// Run: node tools/champ-test.js .
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http'), path = require('path'), fs = require('fs');
const SITE = path.resolve(process.argv[2] || '.');
const PORT = 8911, BASE = `http://127.0.0.1:${PORT}`;
const results = [];
const ok = (area, name, pass, detail = '') => results.push({ area, name, pass: !!pass, detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CLIENT = 'champ-test.apps.googleusercontent.com';

(async () => {
  const { BlobsServer } = await import(require.resolve('@netlify/blobs/server', { paths: [SITE] }));
  const dir = path.join(require('os').tmpdir(), 'champ-test-blobs'); fs.rmSync(dir, { recursive: true, force: true });
  const blobs = new BlobsServer({ directory: dir, token: 'tok', port: 0 });
  const { port: bport } = await blobs.start();
  const ctxB64 = Buffer.from(JSON.stringify({ siteID: 'champ', token: 'tok', edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, apiURL: `http://localhost:${bport}` })).toString('base64');
  // a fake Google tokeninfo: any token is "Jane Tester", verified, for our client ID
  const g = http.createServer((q, s) => { s.setHeader('Content-Type', 'application/json'); s.end(JSON.stringify({ aud: CLIENT, iss: 'https://accounts.google.com', email_verified: 'true', exp: String(Math.floor(Date.now() / 1000) + 600), email: 'jane.tester@example.com', name: 'Jane Tester' })); }).listen(0);
  // a fake DeepSeek: says back which language and page the assistant was told to use
  const llm = http.createServer((q, s2) => { let b = ''; q.on('data', (d) => (b += d)); q.on('end', () => {
    const j = JSON.parse(b || '{}'), sys = ((j.messages || [])[0] || {}).content || '';
    if (j.response_format && /Project Intelligence/.test(sys)) {
      global.INTEL_Q = JSON.parse(j.messages[1].content).question;
      s2.setHeader('Content-Type', 'application/json');
      return s2.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ answer: '## Re-plan\nStretch the work and add review gates.', replan: null,
        risks: [{ title: 'Client sign-off delays at review gates', cause: 'Slow approvals', p: 4, i: 4, response: 'Mitigate', action: 'Agree sign-off SLAs', owner: '', critical: true },
          { title: 'Team idle during float', cause: 'Gaps', p: 3, i: 3, response: 'Mitigate', action: 'Re-sequence', owner: '', critical: false }], stakeholders: [], meeting: null, sources: [], follow_ups: ['What buffer should be added?'] }) } }], usage: { total_tokens: 900 } })); }
    if (j.response_format && /Translate each value into English/.test(sys)) {
      const f = JSON.parse(j.messages[1].content).fields, EN = { 'சசி': 'Sashi', 'சிவம்': 'Sivam', 'எனக்கு டெமோ வேண்டும்': 'I would like a demo', 'Syarikat Maju': 'Syarikat Maju', 'Saya mahu demo untuk 14 projek pembinaan.': 'I would like a demo for 14 construction projects.', 'Pengurus PMO': 'PMO Manager' };
      const out = {}; for (const k of Object.keys(f)) out[k] = EN[f[k]] || f[k];
      global.EN_CALLS = (global.EN_CALLS || []).concat([f]);
      s2.setHeader('Content-Type', 'application/json'); return s2.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ fields: out, language: /[\u0B80-\u0BFF]/.test(JSON.stringify(f)) ? 'ta' : 'ms' }) } }] })); }
    if (j.response_format && !/strings/.test(j.messages[1].content)) {   // Ask AI: question -> SQL, or rows -> report
      global.ASK_SYS = sys; global.ASK_USER = j.messages[1].content;
      const o = /PMO analyst/.test(sys) ? { title: 'Portfolio by program', summary: 'Two programs.', insights: ['ERP has 1 project'], recommendations: ['Review risks'] }
        : { sql: "SELECT program, COUNT(*) AS projects_count, SUM(budget) AS budget_total FROM projects GROUP BY program", title: 'Projects by program', note: '' };
      s2.setHeader('Content-Type', 'application/json'); return s2.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(o) } }], usage: { prompt_tokens: 10, completion_tokens: 10 } })); }
    if (j.response_format) { const inp = JSON.parse(j.messages[1].content).strings; global.I18N_CALLS = (global.I18N_CALLS || 0) + 1;
      const code = (/into ([^.]+)\./.exec(sys) || [])[1] || '?';
      s2.setHeader('Content-Type', 'application/json'); return s2.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ t: inp.map((x) => '[' + code.slice(0, 5) + '] ' + x) }) } }] })); }
    global.CHAT_SYS = sys; global.CHAT_MSGS = j.messages; global.CHAT_MAX = j.max_tokens;
    const lang = (/Reply in ([^.]+)\./.exec(sys) || [])[1] || '?';
    const CODE = { 'Bahasa Melayu': 'ms', 'Persian (فارسی)': 'fa', 'Tamil (தமிழ்)': 'ta', English: 'en', 'Arabic (العربية)': 'ar' };
    const lastQ = (j.messages || []).slice(-1)[0].content || '';
    const tagLang = /apa khabar|bagaimana/i.test(lastQ) ? 'ms' : (CODE[lang] || 'en');
    const reply = `Echo: lang=${lang}; where=${/signed in to the Project Champ console/.test(sys) ? 'console' : 'site'}; facts=${/Pipeline board/.test(sys) && /PMBOK/.test(sys)}; q=${(j.messages || []).slice(-1)[0].content}\n- **point one**\n- point two\n[[lang:${tagLang}]]`;
    s2.setHeader('Content-Type', 'application/json'); s2.end(JSON.stringify({ choices: [{ message: { content: reply } }] }));
  }); }).listen(0);
  const az = http.createServer((q, s3) => { let b = ''; q.on('data', (d) => (b += d)); q.on('end', () => {
    if (/speechtotext/.test(q.url) && global.STT_422) { const def = (/name="definition"\r?\n\r?\n([^\r\n]+)/.exec(b) || [])[1] || ''; global.STT_DEFS = (global.STT_DEFS || []).concat(def);
      if ((def.match(/-[A-Z]{2}"/g) || []).length > 1) { s3.statusCode = 422; s3.setHeader('Content-Type', 'application/json'); return s3.end(JSON.stringify({ code: 'InvalidAudio', message: 'No language was identified.' })); } }
    if (/speechtotext/.test(q.url) && global.STT_SLOW) return setTimeout(() => { try { s3.end('{}'); } catch (e) {} }, 9500);
    if (/speechtotext/.test(q.url)) { global.STT_DEF = (/name="definition"\r?\n\r?\n([^\r\n]+)/.exec(b) || [])[1] || ''; global.STT_KEY = q.headers['ocp-apim-subscription-key'];
      s3.setHeader('Content-Type', 'application/json'); return s3.end(JSON.stringify({ combinedPhrases: [{ text: 'எனது திட்டங்கள் எப்படி உள்ளன?' }], phrases: [{ locale: 'ta-IN', durationMilliseconds: 1800, text: 'எனது திட்டங்கள் எப்படி உள்ளன?' }] })); }
    global.LAST_SSML = b; global.AZ_KEY = q.headers['ocp-apim-subscription-key']; s3.setHeader('Content-Type', 'audio/mpeg'); s3.end(Buffer.from('ID3fakeaudio')); }); }).listen(0);
  await sleep(100);
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NETLIFY_BLOBS_CONTEXT: ctxB64, ADMIN_USERNAME: '', ADMIN_PASSWORD: '', ADMIN_SESSION_SECRET: '',
    GOOGLE_CLIENT_ID: CLIENT, GOOGLE_TOKENINFO_URL: `http://127.0.0.1:${g.address().port}/tokeninfo`, LLM_API_KEY: 'test-key', CHAMP_I18N_LIMIT: '400', LLM_BASE_URL: `http://127.0.0.1:${llm.address().port}`, LLM_MODEL: 'deepseek-chat', TELEGRAM_BOT_TOKEN: '', AZURE_SPEECH_KEY: 'az-test', AZURE_SPEECH_BASE: `http://127.0.0.1:${az.address().port}`, AZURE_STT_ENDPOINT: `http://127.0.0.1:${az.address().port}`, RESEND_API_KEY: '', SITE_ENV: '' };
  const srv = spawn('node', ['local-server.mjs'], { cwd: SITE, env, stdio: ['ignore', 'pipe', 'pipe'] }); global.SRV = srv;
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 60 && !/running/i.test(log); i++) await sleep(150);

  const b = await chromium.launch({ executablePath: fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined, args: ['--use-fake-device-for-media-stream'] });
  const ctx = await b.newContext({ viewport: { width: 1366, height: 900 } });
  await ctx.route(/images\.unsplash\.com|accounts\.google\.com/, (r) => r.abort());   // no internet in the test
  await ctx.addInitScript(() => { if (!/intro=1/.test(location.search)) try { sessionStorage.setItem('champIntroSeen', '1'); } catch (e) {} });   // the intro has its own checks
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(p.url() + ' :: ' + e.message));
  const api = (action, data = {}, headers = { 'X-MBS-Admin': '1' }) => p.request.post(`${BASE}/.netlify/functions/admin`, { data: { action, ...data }, headers });

  // ---- public site ----
  const pages = [['index.html', 'Every project'], ['features.html', 'Everything a project'], ['agile.html', 'One plan'], ['industries.html', 'Built for teams'], ['contact.html', 'on your project'], ['privacy.html', 'Privacy'], ['login.html', 'Project Champ']];
  for (const [f, text] of pages) {
    const r = await p.goto(`${BASE}/${f}`);
    const body = await p.textContent('body');
    ok('Site', `${f} loads (${r.status()})`, r.status() === 200 && body.includes(text));
  }
  await p.goto(`${BASE}/login.html`);
  ok('Site', 'login page hides the project-code box', !(await p.isVisible('#loginProj')));
  await p.goto(`${BASE}/index.html`);
  const nav = await p.$$eval('header .menu a', (as) => as.map((a) => a.getAttribute('href')));
  ok('Site', 'menu has the 6 pages', JSON.stringify(nav) === JSON.stringify(['index.html', 'about.html', 'features.html', 'agile.html', 'industries.html', 'contact.html']), nav.join(','));
  ok('Site', 'header has a Login link to login.html', (await p.getAttribute('header .nav-login', 'href')) === 'login.html');
  ok('Site', 'no MBS wording on the home page', !/Modern Building|0420 494 990|Mr\.? Fixit|Wonder Bird/i.test(await p.content()));
  await p.waitForSelector('[data-visits]:not([hidden])', { timeout: 5000 }).catch(() => {});
  ok('Site', 'visitor counter in the footer', /👁 \d+ visitors/.test(await p.textContent('footer')), (await p.textContent('footer')).slice(0, 160));
  ok('Site', 'footer credit "Designed by © Sashi Kumar Sivam"', (await p.textContent('footer')).includes('Designed by © Sashi Kumar Sivam'));
  // ---- share preview (WhatsApp, LinkedIn…): GKH globe card, no MBS ----
  const og = await p.$eval('meta[property="og:image"]', (m) => m.content).catch(() => '');
  ok('Share', 'every page has the GKH share image (absolute address)', /^https:\/\/.+\/assets\/gkh-champ-share\.jpg$/.test(og), og);
  r0 = await p.request.get(`${BASE}/assets/gkh-champ-share.jpg`);
  ok('Share', 'share image is served (1200x630 JPEG)', r0.status() === 200 && /image\/jpeg/.test(r0.headers()['content-type'] || ''));
  ok('Share', 'large preview card for WhatsApp/X', (await p.$eval('meta[name="twitter:card"]', (m) => m.content).catch(() => '')) === 'summary_large_image');
  ok('Share', 'phone icon uses a new file name (old MBS copies kept by apps cannot be reused)', (await p.getAttribute('link[rel=apple-touch-icon]', 'href')) === 'assets/gkh-champ-icon-180.png');
  r0 = await p.request.get(`${BASE}/assets/favicon.svg`);
  ok('Share', 'old MBS favicon is gone', r0.status() === 404);
  // ---- the cinematic intro (home page) ----
  await p.goto(`${BASE}/index.html?intro=1`); await sleep(400);
  ok('Intro', 'home page opens with the intro and "Tap to enter"', await p.isVisible('#champIntro [data-ci-start]'));
  ok('Intro', 'Ask Champ is hidden while the intro plays', !(await p.isVisible('#champChatBtn')));
  await p.click('[data-ci-start]'); await sleep(1300);
  ok('Intro', '01 Plan scene', (await p.textContent('.ci-cap')).includes('Plan') && await p.evaluate(() => document.getElementById('champIntro').classList.contains('s1')));
  await sleep(2300);
  ok('Intro', '02 Schedule: the Gantt chart builds', (await p.textContent('.ci-cap')).includes('Schedule') && (await p.$$('.ci-bar')).length === 8);
  await sleep(2400);
  ok('Intro', '03 Critical path lights up', (await p.textContent('.ci-cap')).includes('Critical path') && await p.evaluate(() => document.getElementById('champIntro').classList.contains('cp')));
  await sleep(2300);
  ok('Intro', 'title: Project Champ', await p.evaluate(() => document.getElementById('champIntro').classList.contains('logo')));
  await sleep(3300);
  ok('Intro', 'ends by itself after about 10 seconds and gives the page back', !(await p.$('#champIntro')) && await p.isVisible('#champChatBtn'));
  await p.goto(`${BASE}/index.html?intro=1`); await sleep(300);
  await p.click('[data-ci-skip]'); await sleep(900);
  ok('Intro', 'Skip intro works, and it is not shown again this visit', !(await p.$('#champIntro')) && await p.evaluate(() => sessionStorage.getItem('champIntroSeen') === '1'));
  // ---- start screen: pick a language; the intro, the website and Champ follow ----
  await p.goto(`${BASE}/index.html?intro=1`); await sleep(400);
  ok('Intro', 'start screen has a language picker (English first)', (await p.inputValue('[data-ci-lang]')) === 'en' && (await p.$$('[data-ci-lang] option')).length === 19);
  await p.selectOption('[data-ci-lang]', 'ta'); await sleep(1500);
  ok('Intro', 'the start screen switches to Tamil', /\[Tamil\] Tap to enter/.test(await p.textContent('.ci-start')), (await p.textContent('.ci-start')).slice(0, 120));
  ok('Intro', 'the website switches to Tamil too', (await p.getAttribute('html', 'lang')) === 'ta');
  await p.click('[data-ci-skip]'); await sleep(900);
  await p.click('#champChatBtn'); await sleep(2000);
  const lgi = await p.textContent('.cc-log');
  ok('Intro', 'Champ greets in Tamil and goes straight to the form', /\[Tamil\] Greetings! I\u2019m Champ\. I\u2019ll speak with you in தமிழ்/.test(lgi) && /\[Tamil\] Lovely\. Could you pop your details/.test(lgi) && (await p.$$('.cc-form')).length === 1 && (await p.$$('.cc-ob-langs button')).length === 0, lgi.slice(0, 220));
  await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  // ---- About page ----
  await p.goto(`${BASE}/about.html`); await sleep(400);
  const ab = await p.textContent('main, body');
  ok('About', 'About page: GKH intro, practices, selected work and the team (Sashi)', /Global Knowledge House/.test(ab) && /Since 2010|since 2010/i.test(ab) && /Seven practices/.test(ab) && /National ID rollout/.test(ab) && /Sashi Kumar Sivam/.test(ab) && /CEO and Co-Founder/.test(ab) && await p.isVisible('.c-person-photo span'));
  ok('About', 'links to the GKH website', await p.$$eval('a[data-gkh-link]', (a) => a.length === 1 && a[0].href === 'https://gkhconsultancy.com/' && a[0].target === '_blank').catch(() => false));
  ok('About', 'About is in the main menu on every page', (await p.$$('.menu a[href="about.html"]')).length === 1);
  // ---- home: the "Ask Champ" box ----
  await p.goto(`${BASE}/index.html`); await sleep(400);
  ok('Ask box', 'home page has the Ask Champ section with example questions', await p.isVisible('#askfx-q') && (await p.$$('[data-ask]')).length === 6);
  await p.fill('#askfx-q', 'How do I find the critical path?'); await p.click('.askfx-form button[type=submit]'); await sleep(1800);
  let lab = await p.textContent('.cc-log');
  ok('Ask box', 'the question goes to Champ and is answered first', await p.isVisible('#champChat') && lab.includes('How do I find the critical path?') && /Echo: /.test(lab), lab.slice(0, 240));
  ok('Ask box', 'then Champ greets and asks for the language', /Greetings!.*Which language/.test(lab) && lab.indexOf('Greetings') > lab.indexOf('critical path'));
  await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  // ---- contact: the enquiry form ----
  await p.goto(`${BASE}/contact.html`); await sleep(400);
  ok('Contact', 'contact page has the enquiry form with the PDPA notice', await p.isVisible('#enqForm') && /PDPA/.test(await p.textContent('.c-pdpa')));
  await p.click('#enqForm button[type=submit]'); await sleep(200);
  ok('Contact', 'empty form asks for the name', /first and last name/.test(await p.textContent('.c-enq-err')));
  await p.fill('#enqForm [name=first]', 'Priya'); await p.fill('#enqForm [name=last]', 'Nair'); await p.fill('#enqForm [name=email]', 'priya@example.org'); await p.fill('#enqForm [name=phone]', '0412 345 678');
  await p.click('#enqForm button[type=submit]'); await sleep(200);
  ok('Contact', 'phone without a country code is questioned', /country code/.test(await p.textContent('.c-enq-err')));
  await p.fill('#enqForm [name=phone]', '+60 12 345 6789'); await p.fill('#enqForm [name=org]', 'Syarikat Maju'); await p.fill('#enqForm [name=role]', 'Pengurus PMO'); await p.selectOption('#enqForm [name=country]', 'Malaysia');
  await p.selectOption('#enqForm [name=reason]', 'Book a demo'); await p.fill('#enqForm [name=message]', 'Saya mahu demo untuk 14 projek pembinaan.'); await p.check('#enqForm [name=pref][value=WhatsApp]');
  await p.click('#enqForm button[type=submit]'); await sleep(200);
  ok('Contact', 'cannot send without agreeing to the privacy notice', /privacy notice/.test(await p.textContent('.c-enq-err')));
  await p.check('#enqForm [name=consent]'); await p.click('#enqForm button[type=submit]'); await sleep(1500);
  ok('Contact', 'sent: thank-you with a reference', await p.isVisible('#enqDone') && /Thank you, Priya!/.test(await p.textContent('#enqDone')) && /ENQ-\d{6}-[0-9A-F]{4}/.test(await p.textContent('#enqDone')));
  let rq = await p.request.post(`${BASE}/.netlify/functions/contact`, { data: { first: 'Bot', last: 'Bot', email: 'bot@spam.com', reason: 'x', consent: true, pref: 'Email', website: 'http://spam' } });
  rq = await p.request.post(`${BASE}/.netlify/functions/contact`, { data: { first: 'No', last: 'Consent', email: 'nc@example.com', reason: 'Book a demo', pref: 'Email' } });
  ok('Contact', 'the server refuses an enquiry without consent', rq.status() === 422);
  const r404 = await p.goto(`${BASE}/nope.html`);
  ok('Site', 'unknown page gives the 404 page', r404.status() === 404 && (await p.textContent('body')).includes('critical path'));

  // ---- Champ's welcome: greeting → language (voice or tap) → typed form with the PDPA notice → welcome pack yes/no ----
  await p.goto(`${BASE}/index.html`);
  await p.evaluate(() => { HTMLMediaElement.prototype.play = function () { return Promise.resolve(); }; });
  global.LAST_SSML = '';
  await p.click('#champChatBtn'); await p.waitForSelector('#champChat:not([hidden])'); await sleep(900);
  let lgw = await p.textContent('.cc-log');
  ok('Welcome', 'Champ opens with "Greetings, what language…" and the switch tip', /Greetings!.*Which language are you most comfortable with\?/.test(lgw) && lgw.includes('switch to'), lgw.slice(0, 200));
  ok('Welcome', 'language buttons (19 languages) and the microphone tip', (await p.$$('.cc-ob-langs [data-ob^="L:"]')).length === 19 && /Hey Champ/.test(lgw) && (await p.$$('[data-ob="mic"]')).length === 1);
  ok('Welcome', 'the greeting is spoken, short, and without emoji', /en-AU-NatashaNeural/.test(global.LAST_SSML || '') && /Greetings! I.m Champ\. Which language are you most comfortable with\? Just say it, or tap one below\./.test(global.LAST_SSML || '') && !/Tip:|👋|🎤/.test(global.LAST_SSML || ''), (global.LAST_SSML || '').slice(-200));
  const lo = await p.evaluate(() => ['Malayu', 'Bahasa Malaysia', 'Thamil', 'Tamill.', 'Persian please', 'Germen', 'hello there', 'தமிழ்'].map((t) => window.ChampChat.langOf(t)));
  ok('Voice', 'the language is picked from what was heard, even slightly off ("Malayu", "Thamil", "Germen")', lo.join(',') === 'ms,ms,ta,ta,fa,de,,ta', lo.join(','));
  global.LAST_SSML = ''; await p.request.post(`${BASE}/.netlify/functions/tts`, { data: { text: 'Hello 👋 team 🎤 ready ✅', lang: 'en' } });
  ok('Voice', 'emoji are never read aloud', /Hello team ready/.test(global.LAST_SSML || '') && !/👋|🎤|✅/.test(global.LAST_SSML || ''), (global.LAST_SSML || '').slice(-120));
  ok('Welcome', 'no main menu, no Skip buttons, no Main menu link under the greeting', (await p.$$('.cc-menu-list button')).length === 0 && (await p.$$('[data-ob="skip"]')).length === 0 && (await p.$$('.cc-bot .cc-mlink')).length === 0);
  await p.click('.cc-menubtn'); await sleep(300);
  ok('Welcome', '☰ shows the menu and only pauses the questions', (await p.$$('.cc-menu .cc-menu-list button')).length === 10 && (await p.evaluate(() => window.ChampChat.visitor().step)) === 'lang');
  await p.click('.cc-menu-list button:has-text("Introduce myself")'); await sleep(500);
  ok('Welcome', '"Introduce myself" starts them again', (await p.$$('.cc-ob-langs [data-ob^="L:"]')).length === 19);
  await p.fill('.cc-f textarea', 'Klingon'); await p.keyboard.press('Enter'); await sleep(1200);
  lgw = await p.textContent('.cc-log');
  ok('Welcome', 'unknown language: "Sorry, I don’t speak that language yet. Let’s keep to English."', lgw.includes('don’t speak that one yet') && /Could you pop your details/.test(lgw), lgw.slice(-200));
  await p.fill('.cc-f textarea', 'switch to Tamil'); await p.keyboard.press('Enter'); await sleep(2000);
  lgw = await p.textContent('.cc-log');
  ok('Welcome', '"switch to Tamil": the form and its words switch to Tamil', (await p.inputValue('.cc-lang')) === 'ta' && /\[Tamil\] First name/.test(await p.textContent('.cc-form')) && /\[Tamil\] Lovely\. Could you pop your details/.test(lgw), lgw.slice(-200));
  ok('Welcome', 'the PDPA notice and consent tick are on the form, with a link to the privacy notice', /PDPA/.test(await p.textContent('.cc-pdpa')) && (await p.getAttribute('.cc-pdpa a', 'href')) === 'privacy.html#champ' && (await p.$$('.cc-form input[name=consent]')).length === 1);
  await p.click('.cc-go'); await sleep(300);
  ok('Welcome', 'empty form: asks for the name', /\[Tamil\] Please type your first and last name/.test(await p.textContent('.cc-perr')));
  await p.fill('.cc-form [name=first]', 'சசி'); await p.fill('.cc-form [name=last]', 'சிவம்'); await p.fill('.cc-form [name=phone]', '0412 345 678'); await p.fill('.cc-form [name=email]', 'Sashi@Example.com');
  await p.click('.cc-go'); await sleep(300);
  ok('Welcome', 'a phone number without a country code is questioned', /country code/.test(await p.textContent('.cc-perr')));
  await p.fill('.cc-form [name=phone]', '+61 412 345 678'); await p.selectOption('.cc-form [name=purpose]', 'rDemo'); await p.fill('.cc-form [name=more]', 'எனக்கு டெமோ வேண்டும்');
  await p.click('.cc-go'); await sleep(300);
  ok('Welcome', 'cannot send without agreeing to the privacy notice', /agree to the privacy notice/.test(await p.textContent('.cc-perr')));
  await p.check('.cc-form [name=consent]'); await p.click('.cc-go'); await sleep(1800);
  lgw = await p.textContent('.cc-log');
  ok('Welcome', 'sent: Champ thanks them by first name and asks about the welcome pack (spoken)', /\[Tamil\] Thanks, சசி! Would you like us to email you a welcome pack/.test(lgw) && (await p.$$('.cc-form')).length === 0 && /ta-MY-KaniNeural/.test(global.LAST_SSML || ''), lgw.slice(-220));
  await p.fill('.cc-f textarea', 'ஆம்'); await p.keyboard.press('Enter'); await sleep(1800);
  lgw = await p.textContent('.cc-log');
  ok('Welcome', 'a spoken/typed "yes" (Tamil ஆம்) is taken; noted, then "feel free to ask any question"', /send your welcome pack to sashi@example\.com/.test(lgw) && /That’s everything, சசி\. Thank you! Ask me anything/.test(lgw), lgw.slice(-260));
  ok('Welcome', 'the main menu follows', (await p.$$('.cc-menu .cc-menu-list button')).length === 10);
  const VID = await p.evaluate(() => window.ChampChat.visitor().id);
  await p.fill('.cc-f textarea', 'What is a Gantt chart'); await p.keyboard.press('Enter'); await sleep(1500);
  ok('Welcome', 'Champ is told the visitor’s first name for its answers', /called சசி\./.test(global.CHAT_SYS || ''));
  ok('Welcome', 'phone and email never go to the AI', !/412 345|example\.com/.test(global.CHAT_SYS || '') && !/412 345|sashi@example/i.test(JSON.stringify(global.CHAT_MSGS || '')));
  // hands-free: microphone on → Champ listens after its yes/no question, but not while the form is open
  await p.evaluate(() => { HTMLMediaElement.prototype.play = function () { var a = this; setTimeout(function () { a.dispatchEvent(new Event('ended')); }, 150); return Promise.resolve(); }; });
  await p.click('.cc-menubtn'); await sleep(300); await p.click('.cc-menu-list button:has-text("Introduce myself")'); await sleep(600);
  await ctx.grantPermissions(['microphone'], { origin: BASE });
  await p.click('[data-ob="mic"]'); await sleep(1200);
  ok('Hands-free', 'microphone on: Champ starts listening by itself', await p.evaluate(() => document.querySelector('.cc-mic').classList.contains('on')) && /Your microphone is on/.test(await p.textContent('.cc-log')), (await p.evaluate(() => document.querySelector('.cc-mic').className)) + ' | ' + (await p.textContent('.cc-log')).slice(-160));
  await p.evaluate(() => { const m = document.querySelector('.cc-mic'); if (m.classList.contains('on')) m.click(); }); await sleep(2500);
  ok('Hands-free', 'the spoken language answer (Tamil) opens the form, and Champ does not listen while you type', (await p.$$('.cc-form')).length === 1 && !(await p.evaluate(() => document.querySelector('.cc-mic').classList.contains('on'))));
  await p.goto(`${BASE}/features.html`); await sleep(800);
  ok('Hands-free', '"Hey Champ" is listened for on other pages once the microphone is allowed', await p.evaluate(() => localStorage.getItem('champHandsFree') === '1'));
  await ctx.clearPermissions(); await p.evaluate(() => localStorage.removeItem('champHandsFree'));
  await p.goto(`${BASE}/index.html`); await p.click('#champChatBtn'); await sleep(600);
  await p.fill('.cc-f textarea', 'skip'); await p.keyboard.press('Enter'); await sleep(1200);
  ok('Welcome', 'saying "skip" closes the form; Champ invites any question', /Ask me anything about Project Champ/.test((await p.textContent('.cc-log')).slice(-2500)) && (await p.$$('.cc-form')).length === 0);
  await p.fill('.cc-f textarea', 'switch to Elvish'); await p.keyboard.press('Enter'); await sleep(1500);
  ok('Welcome', '"switch to" an unknown language: sorry, back to English', /don’t speak that one yet/.test(await p.textContent('.cc-log')) && (await p.inputValue('.cc-lang')) === 'en');
  await p.reload(); await p.click('#champChatBtn'); await sleep(500);
  ok('Welcome', 'a reload in the same tab keeps the conversation', /Elvish/.test(await p.textContent('.cc-log')), (await p.textContent('.cc-log')).slice(-200));
  await p.click('.cc-clear'); await sleep(500);
  ok('Not remembering', '"New chat" is the next person: Champ greets and asks again, no name kept', /Greetings!.*Which language/.test(await p.textContent('.cc-log')) && !/Sashi/.test(await p.textContent('.cc-log')) && (await p.evaluate(() => window.ChampChat.visitor().name)) === '');
  const p2 = await ctx.newPage(); await p2.goto(`${BASE}/features.html`); await sleep(400);
  await p2.evaluate(() => { sessionStorage.clear(); }); await p2.reload(); await sleep(400);
  await p2.click('#champChatBtn'); await sleep(900);
  ok('Not remembering', 'a new visit (new tab) forgets the last person: fresh greeting in English', /Greetings!.*Which language/.test(await p2.textContent('.cc-log')) && (await p2.evaluate(() => localStorage.getItem('champLang'))) === null && (await p2.evaluate(() => window.ChampChat.visitor().name)) === '');
  await p2.close();
  r0 = await p.request.post(`${BASE}/.netlify/functions/chat`, { data: { mode: 'visitor', id: 'bad id!', first: 'x' } });
  ok('Welcome', 'a bad visitor id is refused', r0.status() === 400);
  r0 = await p.request.post(`${BASE}/.netlify/functions/chat`, { data: { mode: 'visitor', id: 'vskiptest000000', skip: 'form' } });
  r0 = await p.request.post(`${BASE}/.netlify/functions/chat`, { data: { mode: 'visitor', id: 'vskiptest000000', email: 'not-an-email' } });
  ok('Welcome', 'a bad email is refused by the server', r0.status() === 422);
  r0 = await p.request.post(`${BASE}/.netlify/functions/chat`, { data: { mode: 'visitor', id: 'vbottest0000000', first: 'Spam', last: 'Bot', email: 'bot@spam.com', consent: true, website: 'http://spam' } });
  // fresh visitor for the chat tests below
  await p.evaluate(() => { localStorage.setItem('champVisitor', JSON.stringify({ id: 'vchattests00000', step: 'done' })); sessionStorage.clear(); sessionStorage.setItem('champObAsked', '1'); sessionStorage.setItem('champFresh', '1'); localStorage.setItem('champChatLang', 'auto'); localStorage.removeItem('champLang'); });

  // ---- Champ chat (website) ----
  await p.goto(`${BASE}/index.html`);
  ok('Chat', 'Ask Champ button on the website', await p.isVisible('#champChatBtn'));
  await p.click('#champChatBtn'); await p.waitForSelector('#champChat:not([hidden])');
  ok('Chat', 'opens with a greeting and the main menu', (await p.textContent('.cc-log')).includes('Champ') && (await p.$$('.cc-menu-list button')).length === 10);
  await p.selectOption('.cc-lang', 'ms');
  ok('Chat', 'language switch changes the greeting (Malay)', (await p.textContent('.cc-log')).includes('Tanya saya'));
  await p.waitForFunction(() => /Bahas/.test(document.querySelector('.cc-menu-list').textContent), null, { timeout: 8000 }).catch(() => {});
  ok('Chat', 'main menu and chat labels shown in Malay', /\[Bahas/.test(await p.textContent('.cc-menu-list')) && /\[Bahas/.test(await p.getAttribute('.cc-f textarea', 'placeholder')));
  await p.click('.cc-menu-list button'); await p.waitForSelector('.cc-bot:not(.cc-wait) >> text=Echo', { timeout: 8000 }).catch(() => {});
  const t1 = await p.textContent('.cc-log');
  ok('Chat', 'answer comes back in the chosen language', t1.includes('lang=Bahasa Melayu'), t1.slice(-200));
  ok('Chat', 'assistant gets the product facts and PM scope', t1.includes('facts=true'));
  ok('Chat', 'answer formatting (bold, bullets) rendered', (await p.$$('.cc-bot ul li b')).length > 0);
  // seamless switch while Champ is reading aloud: Malay -> Persian
  await p.evaluate(() => { HTMLMediaElement.prototype.play = function () { return Promise.resolve(); }; });
  await p.click('.cc-bot .cc-say'); await sleep(800);
  ok('Switch', 'Champ is reading the answer aloud', (await p.$$('.cc-say.on')).length === 1);
  await p.selectOption('.cc-lang', 'fa');
  await p.waitForFunction(() => /Persi/.test((document.querySelector('.cc-log') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
  await sleep(1200);
  const lg = await p.textContent('.cc-log');
  ok('Switch', 'the answer on screen is translated to Persian', /\[Persi/.test(lg) && lg.includes('Echo'), lg.slice(-160));
  ok('Switch', 'reading carries on in the Persian voice', /fa-IR-DilaraNeural/.test(global.LAST_SSML || '') && (await p.$$('.cc-say.on')).length === 1);
  ok('Switch', 'main menu appears after switching, in Persian', (await p.$$('.cc-menu .cc-menu-list button')).length === 10 && /\[Persi/.test(await p.textContent('.cc-menu')));
  ok('Switch', 'chat goes right-to-left for Persian', (await p.getAttribute('#champChat', 'dir')) === 'rtl');
  ok('Switch', 'the website follows the chat language', (await p.getAttribute('html', 'lang')) === 'fa');
  await p.click('.cc-menu .cc-menu-list button:nth-child(2)'); await sleep(1500);
  await p.click('.cc-menubtn');
  ok('Menu', '☰ in the header brings back the main menu at any time', (await p.$$('.cc-menu .cc-menu-list button')).length === 10);
  ok('Menu', 'every answer has a Main menu link', (await p.$$('.cc-bot .cc-mlink')).length >= 2);
  await p.selectOption('.cc-lang', 'en'); await sleep(1500);
  ok('Switch', 'back to English translates the answers to English too', /\[Engli/.test(await p.textContent('.cc-log')));
  // ---- speak or type: Champ follows the language either way ----
  await p.selectOption('.cc-lang', 'fa'); await sleep(800);
  await p.fill('.cc-f textarea', 'Apa khabar projek saya?'); await p.keyboard.press('Enter'); await sleep(2500);
  ok('Typing', 'typing in Malay while set to Persian switches the chat to Malay', (await p.inputValue('.cc-lang')) === 'ms', await p.inputValue('.cc-lang'));
  ok('Typing', 'the website follows (html lang ms)', (await p.getAttribute('html', 'lang')) === 'ms');
  ok('Ears', '🎤 button is in the chat', await p.isVisible('.cc-mic'));
  global.LAST_SSML = '';
  await p.evaluate(() => window.ChampEars.send(new Blob([new Uint8Array(6000)], { type: 'audio/webm' }), 'audio/webm')); await sleep(3500);
  ok('Ears', 'speech goes to Azure with the voice languages (en, ta, ms, fa) and the key stays on the server', /"ta-IN"/.test(global.STT_DEF || '') && /"en-AU"/.test(global.STT_DEF || '') && global.STT_KEY === 'az-test', global.STT_DEF);
  ok('Ears', 'Tamil heard: the chat switches to Tamil', (await p.inputValue('.cc-lang')) === 'ta');
  ok('Ears', 'the spoken Tamil question is asked', (await p.textContent('.cc-log')).includes('எனது திட்டங்கள் எப்படி உள்ளன?'));
  ok('Ears', 'a spoken question is answered aloud in the Tamil voice', /ta-MY-KaniNeural/.test(global.LAST_SSML || ''), (global.LAST_SSML || '').slice(0, 120));
  await p.evaluate(() => { localStorage.setItem('champSttMode', 'any'); });
  await p.evaluate(() => window.ChampEars.send(new Blob([new Uint8Array(6000)], { type: 'audio/webm' }), 'audio/webm')); await sleep(2500);
  ok('Ears', '"Any language" mode sends no language list to Azure', global.STT_DEF && !/locales/.test(global.STT_DEF), global.STT_DEF);
  await p.evaluate(() => { localStorage.removeItem('champSttMode'); });
  // each question stays within about 3000 tokens: instructions + recent conversation + answer
  const longHist = []; for (let i = 0; i < 11; i++) longHist.push({ role: i % 2 ? 'assistant' : 'user', content: (i % 2 ? 'Answer ' : 'Question ') + i + ' ' + 'word '.repeat(230) });
  longHist.push({ role: 'user', content: 'What is the critical path?' });
  r0 = await p.request.post(`${BASE}/.netlify/functions/chat`, { data: { messages: longHist, lang: 'en', where: 'site' } });
  const est = (t) => { let a = 0, o = 0; for (const ch of String(t)) { if (ch.charCodeAt(0) < 0x250) a++; else o++; } return Math.ceil(a / 4 + o * 0.9) + 4; };
  const used = est(global.CHAT_SYS) + (global.CHAT_MSGS || []).filter((m) => m.role !== 'system').reduce((n, m) => n + est(m.content), 0) + (global.CHAT_MAX || 0);
  ok('Chat', 'each question stays within 2000 tokens (instructions + recent conversation + answer)', r0.ok() && used <= 2000 && global.CHAT_MAX === 450 && /critical path/.test(JSON.stringify(global.CHAT_MSGS.slice(-1))) && global.CHAT_MSGS.filter((m) => m.role !== 'system').length < longHist.length && global.CHAT_MSGS.filter((m) => m.role !== 'system')[0].role === 'user', 'used ~' + used + ' tokens, ' + (global.CHAT_MSGS || []).length + ' messages');
  global.STT_422 = true; global.STT_DEFS = [];
  r0 = await p.request.post(`${BASE}/.netlify/functions/stt?langs=en,ta,ms,fa&prefer=ta`, { data: Buffer.alloc(6000), headers: { 'Content-Type': 'audio/webm' } });
  const j422 = await r0.json().catch(() => ({}));
  ok('Ears', 'a short answer Azure can\u2019t place ("No language was identified") is heard again in the chat\u2019s language', r0.status() === 200 && j422.text && j422.lang === 'ta' && /"ta-IN"\]/.test(global.STT_DEFS[1] || ''), r0.status() + ' ' + JSON.stringify(j422) + ' ' + global.STT_DEFS.join(' | '));
  global.STT_422 = false;
  global.STT_SLOW = true;
  r0 = await p.request.post(`${BASE}/.netlify/functions/stt?langs=en,ta`, { data: Buffer.alloc(6000), headers: { 'Content-Type': 'audio/webm' } });
  const slowJ = await r0.json().catch(() => ({}));
  ok('Ears', 'a slow speech service gives a clear "too long" answer before Netlify\u2019s 10-second cut-off', r0.status() === 504 && /too long/.test(slowJ.error || ''), r0.status() + ' ' + JSON.stringify(slowJ));
  global.STT_SLOW = false;
  r0 = await p.request.post(`${BASE}/.netlify/functions/stt?langs=en,ta`, { data: Buffer.from('x'), headers: { 'Content-Type': 'text/plain' } });
  ok('Ears', 'non-audio uploads are refused', r0.status() === 415, r0.status());
  await p.selectOption('.cc-lang', 'ar');
  ok('Chat', 'Arabic switches the chat right-to-left', (await p.getAttribute('#champChat', 'dir')) === 'rtl');
  await p.selectOption('.cc-lang', 'auto');
  await p.fill('.cc-f textarea', 'What is a portfolio?'); await p.keyboard.press('Enter'); await sleep(1500);
  ok('Chat', 'typing a question and Enter sends it', (await p.textContent('.cc-log')).includes('q=What is a portfolio?'));
  await p.click('.cc-x');
  r0 = await p.request.post(`${BASE}/.netlify/functions/chat`, { data: { messages: [] } });
  ok('Chat', 'empty question refused (400)', r0.status() === 400);
  // ---- Champ voice, glow, and the answer's language ----
  ok('Chat', 'the reply language tag is removed from the answer', !(await p.textContent('.cc-log')).includes('[[lang'));
  r0 = await p.request.post(`${BASE}/.netlify/functions/tts`, { data: { text: 'Hello **there**\n- one', lang: 'ms' } });
  ok('Voice', 'Champ speaks (Azure returns audio)', r0.status() === 200 && /audio\/mpeg/.test(r0.headers()['content-type'] || ''));
  ok('Voice', 'Malay answer uses the Malaysian voice, markdown removed', /ms-MY-YasminNeural/.test(global.LAST_SSML || '') && !/\*\*/.test(global.LAST_SSML || ''));
  ok('Voice', 'the Azure key is sent from the server only', global.AZ_KEY === 'az-test');
  r0 = await p.request.post(`${BASE}/.netlify/functions/tts`, { data: { text: 'x', lang: 'rw' } });
  ok('Voice', 'no voice for Kinyarwanda gives a clear refusal', r0.status() === 400);
  await p.click('#champChatBtn'); await sleep(300);
  ok('Voice', 'each answer has a 🔊 Listen button and the Voice toggle shows', (await p.$$('.cc-say')).length > 0 && await p.isVisible('.cc-voice'));
  await p.click('.cc-x');
  await p.evaluate(() => { localStorage.removeItem('champChatSeen'); }); await p.reload(); await sleep(500);
  ok('Chat', 'Ask Champ glows until it is opened', await p.$eval('#champChatBtn', (e) => e.classList.contains('cc-glow')));
  await p.click('#champChatBtn'); await p.click('.cc-x');
  ok('Chat', 'glow stops after opening', !(await p.$eval('#champChatBtn', (e) => e.classList.contains('cc-glow'))));
  // ---- layout: logo far left, controls top right ----
  const lb = await p.$eval('header.site .brand', (e) => e.getBoundingClientRect().left);
  ok('Layout', 'Project Champ logo at the far left', lb < 30, lb);
  const ctl = await p.$eval('#champCtl', (e) => ({ x: e.getBoundingClientRect().left, kids: [...e.children].map((c) => c.id || c.className) }));
  ok('Layout', 'language, light/dark and skin sit together at the top right', ctl.x > 700 && JSON.stringify(ctl.kids) === JSON.stringify(['champLangBtn', 'champQuick', 'champThemeBtn']), JSON.stringify(ctl));
  // ---- page language ----
  await p.click('#champLangBtn'); await p.click('.ct-langmenu [data-l=ms]');
  await p.waitForFunction(() => /\[Bahas/.test(document.querySelector('header.site .menu').textContent), null, { timeout: 8000 }).catch(() => {});
  ok('Language', 'website menu translated to Malay on the fly', /\[Bahas/.test(await p.textContent('header.site .menu')), await p.textContent('header.site .menu'));
  ok('Language', 'Project Champ brand line in the chat stays untouched', !(await p.textContent('.cc-h')).includes('[Bahas'));
  ok('Language', 'html lang set to ms and button shows MS', (await p.getAttribute('html', 'lang')) === 'ms' && (await p.textContent('#champLangBtn')).includes('MS'));
  const calls1 = global.I18N_CALLS || 0;
  await p.goto(`${BASE}/features.html`); await sleep(1500);
  ok('Language', 'choice carries to the next page', /\[Bahas/.test(await p.textContent('header.site .menu')));
  const calls2 = global.I18N_CALLS || 0;
  await p.reload(); await sleep(1200);
  ok('Language', 'cached: reloading costs no new AI calls', (global.I18N_CALLS || 0) === calls2, `${calls1} -> ${calls2} -> ${global.I18N_CALLS}`);
  await p.click('#champChatBtn'); await sleep(300);
  ok('Language', 'Champ follows the page language', (await p.inputValue('.cc-lang')) === 'ms');
  await p.click('.cc-x');
  await p.click('#champLangBtn'); await p.click('.ct-langmenu [data-l=en]'); await sleep(400);
  ok('Language', 'back to English restores the original text', (await p.textContent('header.site .menu')).includes('Features') && !/\[Bahas/.test(await p.textContent('header.site .menu')));
  await p.evaluate(() => { localStorage.removeItem('champChatLang'); });

  // ---- quick light/dark slider ----
  ok('Theme', 'light/dark slider in the site header', await p.isVisible('header.site #champQuick'));
  await p.click('#champQuick');
  ok('Theme', 'slider switches to White', (await p.getAttribute('html', 'data-skin')) === 'white');
  await p.click('#champQuick');
  ok('Theme', 'slider switches back to dark', (await p.getAttribute('html', 'data-skin')) === 'black');

  // ---- security ----
  let r = await api('planList');
  ok('Security', 'API refuses without a login (401)', r.status() === 401, r.status());
  r = await p.request.post(`${BASE}/.netlify/functions/admin`, { data: { action: 'planList' }, headers: { 'X-MBS-Admin': '1', Cookie: 'mbs_admin=eyJ1Ijoic2FzaGk3MyJ9.forged' } });
  ok('Security', 'a forged cookie is refused', r.status() === 401, r.status());
  r = await api('login', { username: 'sashi73', password: 'wrong' }, { 'X-MBS-Admin': '1', 'X-Forwarded-For': '203.0.113.7' });
  ok('Security', 'wrong password refused', r.status() === 401, r.status());
  r = await api('loginOptions');
  ok('Google', 'login page is told the Google client ID', (await r.json()).google === CLIENT);

  // ---- login page with the built-in owner login ----
  await p.goto(`${BASE}/login.html`);
  await p.fill('[name=username]', 'sashi73'); await p.fill('[name=password]', 'sashi98');
  await Promise.all([p.waitForURL(/\/admin\/#portfolio/, { timeout: 15000 }).catch(() => {}), p.click('#loginForm button[type=submit]')]);
  ok('Login', 'sashi73 / sashi98 signs in and lands on Programs', /\/admin\/(#programs)?$/.test(p.url()) || /#programs/.test(p.url()), p.url());
  await p.waitForSelector('#app:not([hidden])', { timeout: 10000 }).catch(() => {});
  await sleep(800);
  const menu = await p.$$eval('.side-nav a:not([hidden])', (as) => as.map((a) => a.textContent.trim()));
  ok('Console', 'menu shows only the project element (+ admin)', JSON.stringify(menu) === JSON.stringify(['🗂Programs', '🔗Dependency board', '📊Summary', '▦Pipeline board', '📅All projects', '＋New project', '📨Enquiries', '👋Visitors & leads', '✨Ask AI', '📈Reports & data', '🔐Users & access', '🕘Activity log', '🏷Builds']), menu.join(' | '));
  ok('Console', 'branded GKH Project Champ', (await p.textContent('.gkh-bar')).includes('GKH Project Champ') && (await p.title()).includes('Project Champ'));
  await p.waitForSelector('.pg-grid, .cs-tiles', { timeout: 8000 }).catch(() => {});
  ok('Programs', 'the console opens on Programs', /Programs/.test(await p.textContent('#view')) && (await p.$$('.cs-tabs .btn.on')).length === 1);
  await p.goto(`${BASE}/admin/#portfolio/board`); await p.waitForSelector('.pcol', { timeout: 8000 }).catch(() => {});
  ok('Portfolio', 'pipeline board has the 5 PMBOK phases', JSON.stringify(await p.$$eval('.pcol .pcol-h b', (b) => b.map((x) => x.textContent))) === JSON.stringify(['Initiation', 'Planning', 'Execution', 'Monitoring & Evaluation', 'Closing']));

  // ---- new project → plan ----
  await p.click('.top-new');
  await p.waitForSelector('#champNew');
  ok('Programs', 'New project: the program comes first and is required', (await p.getAttribute('#champNew [name=progPick]', 'required')) !== null);
  await p.click('#champNew button[type=submit]'); await sleep(300);
  ok('Programs', 'a project cannot be created without a program', /#projects\/new/.test(p.url()));
  await p.selectOption('#champNew [name=progPick]', '__new'); await sleep(150); await p.fill('#champNew [name=program]', 'Head office move');
  await p.fill('#champNew [name=name]', 'Head office fit-out');
  await p.fill('#champNew [name=client]', 'Acme Pty Ltd');
  await p.fill('#champNew [name=site]', 'Parramatta NSW');
  await p.fill('#champNew [name=summary]', 'Fit out level 3: 40 desks, two meeting rooms, kitchen, data cabling. Budget $250k, finish by March.');
  await p.click('#champNew button[type=submit]');
  await p.waitForFunction(() => /#plan\//.test(location.hash), null, { timeout: 10000 }).catch(() => {});
  const core = decodeURIComponent(p.url().split('#plan/')[1] || '').split('/')[0];
  ok('Project', 'New project creates a project and opens its plan', /^P-\d{6}-\d{6}$/.test(core), p.url());
  await p.waitForSelector('#tplCreate', { timeout: 10000 }).catch(() => {});
  ok('Project', 'scope is filled from the description', ((await p.inputValue('#tplScope').catch(() => '')) || '').includes('40 desks'));
  await p.click('[data-mode=blank]').catch(() => {});
  await p.click('#tplCreate').catch(() => {});
  await sleep(2500);
  r = await api('planList', { today: new Date().toISOString().slice(0, 10) });
  const pl = r.ok() ? (await r.json()).plans : [];
  ok('Project', 'blank plan saved and listed', pl.some((x) => x.core === core), JSON.stringify(pl.map((x) => x.name)));
  await p.goto(`${BASE}/admin/#projects`); await sleep(1500);
  await p.waitForSelector('[data-plan]', { timeout: 8000 }).catch(() => {}); const vt = await p.textContent('#view'); ok('Project', 'Projects list shows the new project', vt.includes('Head office fit-out'), vt.slice(0, 300));
  await p.goto(`${BASE}/admin/#plan/${core}/gantt`); await sleep(2500);
  ok('Project', 'Gantt tab opens', /gantt/i.test(await p.content()));
  await p.goto(`${BASE}/admin/#plan/${core}/board`); await sleep(2000);
  ok('Project', 'Board tab opens', (await p.$$('.view [class*=board], .view [class*=kan]')).length > 0);

  // ---- portfolio: summary and pipeline board ----
  await p.goto(`${BASE}/admin/#portfolio/board`); await p.reload(); await p.waitForSelector('.pcard', { timeout: 8000 }).catch(() => {});
  const colOf = () => p.evaluate((c) => { const el = document.querySelector('.pcard[data-core="' + c + '"]'); return el ? el.closest('.pcol').getAttribute('data-col') : ''; }, core);
  ok('Portfolio', 'new planned project sits in Planning', (await colOf()) === 'plan', await colOf());
  const r2 = await api('planNewProject', { name: 'ERP rollout', client: 'Finance', program: 'Finance systems' });
  await p.click('#pbRefresh'); await sleep(1200);
  const core2 = (await r2.json()).core;
  ok('Portfolio', 'project without a plan sits in Initiation', (await p.evaluate((c) => { const el = document.querySelector('.pcard[data-core="' + c + '"]'); return el ? el.closest('.pcol').getAttribute('data-col') : ''; }, core2)) === 'init');
  await p.click(`.pcard[data-core="${core}"] [data-move]`); await p.click('.pmenu [data-to=exec]'); await sleep(1500);
  ok('Portfolio', 'moving a card (⇄) puts it in Execution', (await colOf()) === 'exec', await colOf());
  ok('Portfolio', 'a moved card is marked as moved by hand', (await p.textContent(`.pcard[data-core="${core}"]`)).includes('Moved by hand'));
  await p.click(`.pcard[data-core="${core}"] [data-move]`); await p.click('.pmenu [data-to=auto]'); await sleep(1500);
  ok('Portfolio', '"Automatic" puts it back by its plan', (await colOf()) === 'plan', await colOf());
  await p.click('[data-tab=summary]'); await p.waitForSelector('.cs-tiles', { timeout: 8000 }).catch(() => {});
  const st = await p.textContent('#view');
  ok('Portfolio', 'Summary shows tiles, phases and the health table', st.includes('Total budget') && st.includes('Projects by PMBOK phase') && st.includes('ERP rollout') && st.includes('Head office fit-out'));

  // ---- deleting projects ----
  await p.click('[data-tab=board]'); await p.waitForSelector(`.pcard[data-core="${core2}"]`, { timeout: 8000 }).catch(() => {});
  await p.click(`.pcard[data-core="${core2}"] [data-move]`); await p.click('.pmenu [data-del]');
  ok('Delete', 'board ⇄ menu asks before deleting', (await p.textContent('#modal')).includes('ERP rollout') && (await p.textContent('#modal')).includes("can't be undone"));
  await p.click('#okBtn'); await sleep(1800);
  ok('Delete', 'project removed from the board', !(await p.$(`.pcard[data-core="${core2}"]`)));
  r = await api('planGet', { core: core2 });
  ok('Delete', 'project record really gone (planGet 404)', r.status() === 404, r.status());
  const extra = [];
  for (const n of ['Test A', 'Test B']) extra.push((await (await api('planNewProject', { name: n, client: 'Tmp', program: 'Head office move' })).json()).core);
  await p.click('[data-tab=summary]'); await p.click('#pbRefresh'); await sleep(1500);
  for (const c of extra) await p.check(`[data-pick="${c}"]`);
  ok('Delete', 'Summary: tick projects to delete several at once', (await p.textContent('#csDel')).includes('2 selected'));
  await p.click('#csDel'); await p.click('#okBtn'); await sleep(2500);
  const left = await (await api('planPipelineList', { today: new Date().toISOString().slice(0, 10) })).json();
  ok('Delete', 'bulk delete removed both, kept the rest', !left.cards.some((c) => extra.includes(c.core)) && left.cards.some((c) => c.core === core), left.cards.map((c) => c.name).join(', '));

  // ---- ⚙ Modules: BOM and SWMS on/off ----
  const tabNames = () => p.$$eval('a.tab', (as) => as.map((a) => a.textContent));
  await p.goto(`${BASE}/admin/#plan/${core}/overview`); await p.reload(); await p.waitForSelector('#modBtn', { timeout: 8000 }).catch(() => {});
  ok('Modules', 'BOM and SWMS tabs on by default', (await tabNames()).some((t) => /BOM/.test(t)) && (await tabNames()).some((t) => /SWMS/.test(t)));
  await p.click('#modBtn');
  ok('Modules', '⚙ Modules opens sliders for BOM and SWMS', (await p.$$('#modPop [data-mod]')).length === 2);
  await p.click('#modPop .mod-row:has([data-mod=swms]) .bom-slider'); await sleep(1500);
  r = await api('planGet', { core }); let ch = (await r.json()).champ;
  ok('Modules', 'switching SWMS off is saved, BOM untouched', ch.swms === false && ch.bom === true, JSON.stringify(ch));
  ok('Modules', 'SWMS tab hidden when off', !(await tabNames()).some((t) => /SWMS/.test(t)));
  await p.click('#modBtn'); await p.click('#modPop .mod-row:has([data-mod=bom]) .bom-slider'); await sleep(1500);
  r = await api('planGet', { core }); ch = (await r.json()).champ;
  ok('Modules', 'BOM off too, and its tab hidden', ch.bom === false && !(await tabNames()).some((t) => /BOM/.test(t)));
  ok('Modules', 'header shows which modules are on', !/BOM|SWMS/.test(await p.textContent('#modBtn small')));
  await api('planModuleSet', { core, mod: 'bom', on: true }); await api('planModuleSet', { core, mod: 'swms', on: true });
  r = await api('planGet', { core }); ch = (await r.json()).champ;
  ok('Modules', 'switching back on restores both', ch.bom === true && ch.swms === true);
  await p.goto(`${BASE}/admin/#projects/new`); await p.reload(); await p.waitForSelector('#champNew');
  await p.selectOption('#champNew [name=progPick]', 'Finance systems').catch(() => {}); await p.fill('#champNew [name=name]', 'IT rollout'); await p.fill('#champNew [name=client]', 'Finance');
  await p.click('#champNew .mod-row:has([name=bom]) .bom-slider'); await p.click('#champNew .mod-row:has([name=swms]) .bom-slider');
  await p.click('#champNew button[type=submit]'); await p.waitForFunction(() => /#plan\//.test(location.hash), null, { timeout: 8000 }).catch(() => {});
  const itCore = decodeURIComponent(p.url().split('#plan/')[1] || '').split('/')[0];
  r = await api('planGet', { core: itCore }); ch = r.ok() ? (await r.json()).champ : {};
  ok('Modules', 'New project form: BOM and SWMS switched off at creation', ch.bom === false && ch.swms === false, JSON.stringify(ch));
  await api('planProjectDelete', { core: itCore });

  // ---- Programs (top level) and the Dependency board ----
  r = await api('planNewProject', { name: 'Hospital fit-out', client: 'Health NSW' }); ok('Programs', 'the server refuses a project without a program', r.status() === 400);
  const mk = async (n, prog) => (await (await api('planNewProject', { name: n, client: 'Health NSW', program: prog })).json()).core;
  const hBuild = await mk('Hospital build', 'Hospital redevelopment'), hFit = await mk('Hospital fit-out', 'Hospital redevelopment'), hIT = await mk('Hospital IT', 'Digital health');
  let pgl = await (await api('planProgramList', { today: new Date().toISOString().slice(0, 10) })).json();
  const pHosp = pgl.programs.find((x) => x.name === 'Hospital redevelopment'), pDig = pgl.programs.find((x) => x.name === 'Digital health');
  ok('Programs', 'a new program name typed on a project creates the program', !!pHosp && !!pDig && pgl.cards.filter((c) => c.program === 'Hospital redevelopment').length === 2);
  ok('Programs', 'every project belongs to a program', pgl.cards.every((c) => c.program && pgl.programs.some((x) => x.name === c.program)), pgl.cards.filter((c) => !c.program).map((c) => c.name).join(','));
  r = await api('planProgramSave', { id: pHosp.id, name: 'Hospital redevelopment', manager: 'Priya Nair', sponsor: 'Health NSW', objective: 'A new emergency wing open by June', status: 'active' });
  ok('Programs', 'edit a program (manager, sponsor, objective)', r.ok() && (await r.json()).program.manager === 'Priya Nair');
  r = await api('planProgramSave', { name: 'digital HEALTH' }); ok('Programs', 'program names are unique', r.status() === 409);
  await p.goto(`${BASE}/admin/#programs`); await p.reload(); await p.waitForSelector('.pg-card', { timeout: 8000 }).catch(() => {});
  const pgT = await p.textContent('#view');
  ok('Programs', 'Programs page: a card per program with its roll-up', (await p.$$('.pg-card')).length >= 3 && pgT.includes('Hospital redevelopment') && pgT.includes('Priya Nair') && pgT.includes('Hospital build'));
  await p.click(`.pg-card[data-pg="${pHosp.id}"]`); await sleep(1500);
  const pdT = await p.textContent('#view');
  ok('Programs', 'program page: objective, projects and roadmap', /#programs\/pg/.test(p.url()) && pdT.includes('A new emergency wing open by June') && pdT.includes('Hospital fit-out') && (await p.$$('#pgBoard .db-lane')).length >= 1);
  // dependencies
  r = await api('planDepSave', { from: hBuild, to: hFit, type: 'FS', lag: 5, note: 'Fit-out needs the building handed over' }); const dep1 = r.ok() ? (await r.json()).dep : {};
  ok('Dependencies', 'link two projects (finish to start, 5 days lag)', r.ok() && dep1.type === 'FS' && dep1.lag === 5);
  r = await api('planDepSave', { from: hFit, to: hIT, type: 'SS' }); ok('Dependencies', 'link across programs', r.ok());
  r = await api('planDepSave', { from: hIT, to: hBuild, type: 'FS' }); const loopJ = await r.json();
  ok('Dependencies', 'a loop is refused, with the reason', r.status() === 409 && /loop/.test(loopJ.error || ''), loopJ.error);
  r = await api('planDepSave', { from: hBuild, to: hFit }); ok('Dependencies', 'the same link twice is refused', r.status() === 409);
  r = await api('planDepSave', { from: hBuild, to: hBuild }); ok('Dependencies', 'a project cannot depend on itself', r.status() === 400);
  pgl = await (await api('planProgramList', { today: new Date().toISOString().slice(0, 10) })).json();
  const dx = pgl.deps.find((d) => d.from === hFit && d.to === hIT);
  ok('Dependencies', 'each link has a status and a plain-English reason; cross-program flagged', pgl.deps.length === 2 && dx && dx.cross === true && dx.status === 'unknown' && /schedule/.test(dx.why), JSON.stringify(dx));
  await p.goto(`${BASE}/admin/#deps`); await p.reload(); await p.waitForSelector('.db', { timeout: 8000 }).catch(() => {});
  ok('Dependencies', 'Dependency board: program swimlanes, project bars and the arrows', (await p.$$('.db-lane')).length >= 2 && (await p.$$('.db-bar')).length >= 3 && (await p.$$('.db-link')).length === 2);
  ok('Dependencies', 'the list explains every link', (await p.textContent('#dbList')).includes('Hospital build') && (await p.textContent('#dbList')).includes('Fit-out needs the building handed over'));
  await p.click(`.db-bar[data-core="${hIT}"]`); await sleep(300);
  ok('Dependencies', 'click a bar: open its plan or link it', await p.isVisible('.dep-pop [data-lk]'));
  await p.click('.dep-pop [data-lk]'); await sleep(200); await p.click(`.db-bar[data-core="${hFit}"]`); await sleep(500);
  ok('Dependencies', '"Link to…" then click another bar opens the link form, filled in', await p.isVisible('#depForm') && (await p.inputValue('#depForm [name=from]')) === hIT && (await p.inputValue('#depForm [name=to]')) === hFit);
  await p.click('#modal [data-close]').catch(() => {}); await sleep(200);
  // status logic: dates from the plans
  const PGX = await import(require('path').resolve('netlify/lib/programs.mjs'));
  const A0 = { name: 'Build', start: '2026-01-05', finish: '2026-03-20', pct: 40, SPI: 0.8, health: 'red', phase: 'exec' }, B0 = { name: 'Fit-out', start: '2026-03-30', finish: '2026-05-30', pct: 0 };
  const sOk = PGX.depStatus({ type: 'FS', lag: 2 }, { ...A0, SPI: 1, health: 'green' }, B0), sRisk = PGX.depStatus({ type: 'FS', lag: 0 }, A0, B0), sClash = PGX.depStatus({ type: 'FS', lag: 15 }, { ...A0, SPI: 1 }, B0), sDone = PGX.depStatus({ type: 'FS' }, { ...A0, pct: 100 }, B0);
  ok('Dependencies', 'status: OK with buffer, At risk when the predecessor slips, Clash when the plans overlap, Done when finished',
    sOk.status === 'ok' && sOk.slack === 8 && sRisk.status === 'risk' && sRisk.slack < 0 && sClash.status === 'conflict' && sClash.slack === -5 && sDone.status === 'done', [sOk, sRisk, sClash, sDone].map((x) => x.status + ':' + x.slack).join(' '));
  const SQLX = await import(require('path').resolve('netlify/lib/admin-sql.mjs'));
  ok('Ask AI', 'program and dependency questions get the programs and dependencies tables', SQLX.pickTables('Which dependencies are clashing between programs?').join(',').includes('dependencies') && SQLX.pickTables('Status of each program').includes('programs'));
  if (process.env.SHOTS) {   // pictures of the boards with realistic dated plans (not part of the checks)
    const mkPlan = (core, name, start, tasks) => api('planSave', { core, plan: { name, start, phases: [{ id: 'ph1', name: 'Work' }], tasks: tasks.map((t, i) => ({ id: 't' + i, name: t[0], dur: t[1], pred: i ? ['t' + (i - 1)] : [], qty: 1, rate: t[2], pct: t[3], actual: t[4] })) } });
    const d0 = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
    const hDes = await mk('Hospital design', 'Hospital redevelopment'), hEq = await mk('Medical equipment', 'Digital health'), hTr = await mk('Staff training', 'Digital health');
    await mkPlan(hDes, 'Hospital design', d0(-70), [['Concept', 15, 60000, 100, 60000], ['Detailed design', 25, 120000, 100, 125000], ['Approvals', 10, 20000, 100, 20000]]);
    await mkPlan(hBuild, 'Hospital build', d0(-20), [['Site works', 15, 300000, 100, 340000], ['Structure', 30, 900000, 35, 400000], ['Services', 25, 500000, 0, 0], ['Handover', 5, 40000, 0, 0]]);
    await mkPlan(hFit, 'Hospital fit-out', d0(55), [['Partitions', 15, 200000, 0, 0], ['Finishes', 20, 180000, 0, 0]]);
    await mkPlan(hIT, 'Hospital IT', d0(-10), [['Network design', 10, 50000, 100, 48000], ['Cabling', 20, 90000, 40, 30000], ['Systems', 25, 150000, 0, 0]]);
    await mkPlan(hEq, 'Medical equipment', d0(30), [['Procure', 30, 400000, 0, 0], ['Install', 15, 60000, 0, 0]]);
    await mkPlan(hTr, 'Staff training', d0(95), [['Train the trainers', 10, 20000, 0, 0], ['Ward training', 20, 45000, 0, 0]]);
    await api('planDepSave', { from: hDes, to: hBuild, type: 'FS', note: 'Build starts once designs are approved' });
    await api('planDepSave', { from: hBuild, to: hEq, type: 'FS', lag: 0, note: 'Equipment goes in once services are in' });
    await api('planDepSave', { from: hIT, to: hTr, type: 'FS', note: 'Training needs live systems' });
    await api('planDepSave', { from: hEq, to: hTr, type: 'FF' });
    await p.setViewportSize({ width: 1440, height: 1000 });
    await p.goto(`${BASE}/admin/#deps`); await p.reload(); await sleep(2500);
    await p.screenshot({ path: '/tmp/intro/deps.png', fullPage: true });
    await p.goto(`${BASE}/admin/#programs`); await p.reload(); await sleep(2000);
    await p.screenshot({ path: '/tmp/intro/programs.png', fullPage: true });
    await p.goto(`${BASE}/admin/#programs/${pHosp.id}`); await p.reload(); await sleep(2000);
    await p.screenshot({ path: '/tmp/intro/program.png', fullPage: true });
    await p.setViewportSize({ width: 1280, height: 900 });
    for (const c of [hDes, hEq, hTr]) await api('planProjectDelete', { core: c });
    for (const c of [hBuild, hFit, hIT]) await api('planSave', { core: c, plan: { name: 'x', tasks: [] } });
    pgl = await (await api('planProgramList', { today: new Date().toISOString().slice(0, 10) })).json();
    for (const d of pgl.deps.filter((d) => ![dep1.id].includes(d.id) && !(d.from === hFit && d.to === hIT))) await api('planDepDelete', { id: d.id });
  }
  // moving, deleting
  r = await api('planProgramMove', { core: hIT, id: pHosp.id }); ok('Programs', 'move a project to another program', r.ok() && (await r.json()).program === 'Hospital redevelopment');
  r = await api('planProgramSet', { core: hIT, program: '' }); ok('Programs', 'a project cannot be taken out of every program', r.status() === 400);
  r = await api('planProgramDelete', { id: pHosp.id }); const delJ = await r.json();
  ok('Programs', 'deleting a program with projects asks where they go', r.status() === 409 && /Choose the program/.test(delJ.error || ''), delJ.error);
  r = await api('planProgramDelete', { id: pHosp.id, moveTo: pDig.id }); const delJ2 = r.ok() ? await r.json() : {};
  ok('Programs', '…and moves them there', delJ2.moved === 3 && delJ2.to === 'Digital health', JSON.stringify(delJ2));
  await api('planProjectDelete', { core: hBuild });
  pgl = await (await api('planProgramList', { today: new Date().toISOString().slice(0, 10) })).json();
  ok('Dependencies', 'deleting a project removes its links', !pgl.deps.some((d) => d.from === hBuild || d.to === hBuild) && pgl.deps.length === 1);
  for (const c of [hFit, hIT]) await api('planProjectDelete', { core: c });

  // ---- the Project page: Pre-sales → Proposal submitted → Invoiced (milestone 1-12) → Signed off and closed ----
  const prj = (await (await api('planNewProject', { name: 'Airline ESG report', client: 'National Airlines', program: 'Digital health' })).json()).core;
  let pj = (await (await api('job', { ref: prj })).json()).job;
  ok('Project page', 'a new project starts in Pre-sales', pj.stage === 'new');
  await p.goto(`${BASE}/admin/#job/${prj}`); await p.reload(); await p.waitForSelector('.stg-flow', { timeout: 8000 }).catch(() => {});
  let pv = await p.textContent('#view');
  ok('Project page', 'called Project (not Job), with the four stages and no trade or photos', (await p.textContent('#title')) === 'Project' && /← Projects/.test(pv) && /Client & project/.test(pv) &&
    JSON.stringify(await p.$$eval('.stg-flow li span', (x) => x.map((e) => e.firstChild.textContent))) === JSON.stringify(['Pre-sales', 'Proposal submitted', 'Invoiced', 'Signed off and closed']) && !/Trade|Plumbing|Photos/.test(pv), pv.slice(0, 200));
  await p.click('[data-stage="quoted"]'); await p.fill('#stageForm [name=amount]', '380000'); await p.click('#stageForm button'); await sleep(1200);
  pj = (await (await api('job', { ref: prj })).json()).job;
  ok('Project page', 'Proposal submitted, with its value', pj.stage === 'quoted' && pj.quote && pj.quote.amount === 380000);
  r = await api('stage', { ref: prj, stage: 'invoiced' }); ok('Project page', 'an invoice needs its milestone number', r.status() === 400);
  await p.click('[data-stage="invoiced"]'); await sleep(300);
  ok('Project page', 'Invoiced asks which milestone payment, 1 to 12', (await p.$$('#stageForm [name=milestone] option')).length === 12 && (await p.inputValue('#stageForm [name=milestone]')) === '1');
  await p.fill('#stageForm [name=amount]', '95000'); await p.click('#stageForm button'); await sleep(1200);
  await p.click('[data-stage="invoiced"]'); await sleep(300);
  ok('Project page', 'the next milestone is offered next', (await p.inputValue('#stageForm [name=milestone]')) === '2');
  await p.selectOption('#stageForm [name=milestone]', '3'); await p.click('#stageForm button'); await sleep(1200);
  pv = await p.textContent('#view');
  if (process.env.SHOTS) { await p.setViewportSize({ width: 1300, height: 900 }); await p.screenshot({ path: '/tmp/intro/projectpage.png' }); await p.setViewportSize({ width: 1280, height: 900 }); }
  ok('Project page', 'milestone payments are listed, and the chip shows the latest', /Payment 1/.test(pv) && /Payment 3/.test(pv) && /Invoiced: milestone 3/.test(await p.textContent('h2 + .chip')) && /2 of up to 12/.test(pv));
  let bd = (await (await api('planPipelineList', { today: new Date().toISOString().slice(0, 10) })).json()).cards.find((c) => c.core === prj);
  ok('Project page', 'an invoiced milestone does not close the project', bd && bd.phase !== 'close', bd && bd.phase);
  await p.click('[data-stage="paid"]'); await p.click('#stageForm button'); await sleep(1200);
  bd = (await (await api('planPipelineList', { today: new Date().toISOString().slice(0, 10) })).json()).cards.find((c) => c.core === prj);
  ok('Project page', 'Signed off and closed moves it to Closing', (await (await api('job', { ref: prj })).json()).job.stage === 'paid' && bd && bd.phase === 'close');
  await api('planProjectDelete', { core: prj });

  // ---- Project Intelligence: re-plan on the fly → change control → sign → the whole plan follows ----
  const esg = (await (await api('planNewProject', { name: 'ESG baseline study', client: 'National Airlines', program: 'Digital health' })).json()).core;
  const wd = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  // 13 weeks, $125,120: kick-off, review, interviews, report, handover
  await api('planSave', { core: esg, plan: { name: 'ESG baseline study', start: wd(7), finishBy: '', charter: { manager: 'Sashi Kumar Sivam', budget: 125120 }, phases: [{ id: 'ph1', name: 'Work' }], tasks: [
    { id: 'a', name: 'Kick-off and charter', dur: 3, qty: 1, rate: 5120, pct: 0 }, { id: 'b', name: 'Document review', dur: 15, qty: 1, rate: 20000, pred: ['a'], pct: 0 },
    { id: 'c', name: 'Stakeholder interviews', dur: 20, qty: 1, rate: 40000, pred: ['b'], pct: 0 }, { id: 'd', name: 'Sustainability report', dur: 22, qty: 1, rate: 55000, pred: ['c'], pct: 0 },
    { id: 'e', name: 'Handover', dur: 5, qty: 1, rate: 5000, pred: ['d'], pct: 0 }, { id: 'f', name: 'Final acceptance', dur: 0, pred: ['e'], pct: 0 }] } });
  let gp = (await (await api('planGet', { core: esg })).json()).plan;
  await p.goto(`${BASE}/admin/#plan/${esg}/intel`); await p.reload(); await p.waitForSelector('#piQ', { timeout: 10000 }).catch(() => {});
  await p.fill('#piQ', 'Can you regenerate the Gantt chart on the 24-week / $380,000 remodelled plan instead?'); await p.click('#piGo');
  await p.waitForSelector('[data-replan]', { timeout: 30000 }).catch(() => {});
  const rpT = await p.textContent('#piLog').catch(() => '');
  ok('Re-plan', 'a re-plan question becomes a worked-out re-plan (24 weeks, $380,000), not just a table', /Re-plan: to 2[34](\.\d)? weeks/.test(rpT) && /\$380,000/.test(rpT), rpT.slice(0, 300));
  ok('Re-plan', 'the preview shows the new finish and budget before anything changes', /With the ticked changes:.*budget \$125,120\.00 → \$380,000\.00/.test(rpT.replace(/\s+/g, ' ')), (rpT.match(/With the ticked changes:[^·]*·[^)]*\)/) || [''])[0]);
  ok('Re-plan', 'the risk tick boxes can be ticked and unticked', await (async () => { const cb = await p.$('[data-rk="1"]'); if (!cb) return false; await cb.click(); const off = !(await cb.isChecked()); await cb.click(); return off && (await cb.isChecked()); })());
  await p.click('[data-replan] [data-imcr]'); await sleep(1500);
  ok('Re-plan', 'sent to change control as a change request (nothing changed yet)', /\/change$/.test(p.url()) && /CR-\d{3}/.test(await p.textContent('#planBody')));
  gp = (await (await api('planGet', { core: esg })).json()).plan;
  ok('Re-plan', 'the plan is unchanged until it is signed', gp.tasks.find((t) => t.id === 'd').dur === 22 && (gp.changes || []).length === 1 && gp.changes[0].status === 'Proposed');
  await p.click('[data-cra="Approved"]'); await sleep(400);
  await p.fill('#crSignF [name=by]', 'Sashi Kumar Sivam'); await p.fill('#crSignF [name=sig]', 'Sashi Kumar Sivam'); await p.check('#crSignF [name=go]'); await p.click('#crSignF button[type=submit]'); await sleep(2500);
  gp = (await (await api('planGet', { core: esg })).json()).plan;
  const PLX = await import(require('path').resolve('netlify/lib/plan.mjs'));
  const R1x = PLX.rollup(JSON.parse(JSON.stringify(gp)), new Date().toISOString().slice(0, 10)), wks = Math.round(((Date.parse(R1x.finish) - Date.parse(R1x.start)) / 864e5 + 1) / 7 * 10) / 10;
  ok('Re-plan', 'signed: the plan is redrawn to about 24 weeks and $380,000', Math.abs(wks - 24) <= 0.6 && Math.abs(R1x.BAC - 380000) < 1 && gp.changes[0].status === 'Implemented', wks + ' weeks, $' + R1x.BAC);
  ok('Re-plan', 'the approved re-plan becomes the new baseline', gp.baseline && Math.abs(gp.baseline.BAC - 380000) < 1 && gp.baseline.finish === R1x.finish);
  ok('Re-plan', 'the charter budget follows', Math.abs((gp.charter || {}).budget - 380000) < 1, (gp.charter || {}).budget);
  ok('Re-plan', 'milestones stay milestones', gp.tasks.find((t) => t.id === 'f').dur === 0);
  await p.goto(`${BASE}/admin/#plan/${esg}/overview`); await sleep(1500);
  ok('Re-plan', 'the Overview shows the new budget', /380,000/.test(await p.textContent('#planBody')));
  await api('planProjectDelete', { core: esg });

  // ---- builds ----
  r = await api('me'); const meB = r.ok() ? await r.json() : {};
  ok('Build', 'the server reports its build number', meB.build && /^1\.0\.\d+$/.test(meB.build.label), JSON.stringify(meB.build));
  ok('Build', 'sidebar shows the build', (await p.textContent('.ver')).includes(meB.build ? meB.build.label : '??'));
  r = await api('buildList'); const bl = r.ok() ? await r.json() : { list: [] };
  ok('Build', 'this build is in the registry (Admin > Builds)', bl.list.length >= 1 && bl.list[0].build === meB.build.build);
  await p.goto(`${BASE}/admin/#builds`); await sleep(1200);
  ok('Build', 'Builds page shows the registry', (await p.textContent('#view')).includes('Build registry'));
  // ---- Customers > Enquiries ----
  r = await api('enquiryList'); const el1 = r.ok() ? await r.json() : { list: [] };
  const enq = el1.list.find((x) => x.email === 'priya@example.org') || {};
  ok('Enquiries', 'the enquiry is saved for action, with PDPA consent', enq.name === 'Priya Nair' && enq.phone === '+60123456789' && enq.pref === 'WhatsApp' && enq.org === 'Syarikat Maju' && enq.role === 'PMO Manager' && enq.message === 'I would like a demo for 14 construction projects.' && enq.original && enq.original.message === 'Saya mahu demo untuk 14 projek pembinaan.' && enq.origLang === 'ms' && enq.status === 'new' && enq.consentAt && !el1.list.some((x) => x.email === 'bot@spam.com') && !el1.list.some((x) => x.email === 'nc@example.com'), JSON.stringify(enq).slice(0, 200));
  await p.goto(`${BASE}/admin/#enquiries`); await sleep(1200);
  ok('Enquiries', 'Enquiries page lists it under Customers, in English, with the original wording', (await p.textContent('#view')).includes('Priya Nair') && (await p.textContent('#view')).includes('I would like a demo for 14 construction projects.') && /Translated from/.test(await p.textContent('#view')) && (await p.textContent('#view')).includes('Saya mahu demo') && await p.isVisible('a[data-nav="enquiries"]'));
  await p.selectOption('.eq-card [data-eq-st]', 'progress'); await sleep(600);
  await p.fill('.eq-card [data-eq-notes]', 'Demo booked Tuesday 10am'); await p.press('.eq-card [data-eq-notes]', 'Tab'); await sleep(800);
  r = await api('enquiryList'); const el2 = r.ok() ? await r.json() : { list: [] }; const enq2 = el2.list.find((x) => x.ref === enq.ref) || {};
  ok('Enquiries', 'status and notes are saved', enq2.status === 'progress' && enq2.notes === 'Demo booked Tuesday 10am' && enq2.updated, JSON.stringify(enq2).slice(0, 160));
  r = await api('enquiryDelete', { refs: [enq.ref] }); const ed = r.ok() ? await r.json() : {};
  ok('Enquiries', 'delete an enquiry', ed.removed === 1);
  // ---- Customers > Visitors & leads ----
  r = await api('visitorList'); const vl = r.ok() ? await r.json() : { list: [] };
  const vs = vl.list.find((v) => v.id === VID) || {};
  ok('Visitors', 'the visitor is saved: first and last name, phone, email, reason, language, PDPA consent and welcome pack request', vs.first === 'Sashi' && vs.last === 'Sivam' && vs.name === 'Sashi Sivam' && vs.original && vs.original.first === 'சசி' && vs.more === 'I would like a demo' && vs.original.more === 'எனக்கு டெமோ வேண்டும்' && vs.origLang === 'ta' && vs.phone === '+61412345678' && vs.email === 'sashi@example.com' && vs.purpose === 'I\u2019d like a demo' && vs.consentAt && vs.welcome === 'yes' && vs.welcomeStatus === 'requested', JSON.stringify(vs));
  ok('Visitors', 'emails and phone numbers are never sent for translation', (global.EN_CALLS || []).length >= 1 && !/@|\+61|\+60|412 345|12 345/.test(JSON.stringify(global.EN_CALLS || [])), JSON.stringify(global.EN_CALLS || []).slice(0, 200));
  ok('Visitors', 'the hidden anti-spam field keeps bots out', !vl.list.some((v) => v.id === 'vbottest0000000'));
  await p.goto(`${BASE}/admin/#visitors`); await sleep(1200);
  const vtx = await p.textContent('#view');
  ok('Visitors', 'Visitors & leads page lists them', vtx.includes('Visitors & potential customers') && vtx.includes('I’d like a demo') && vtx.includes('Sashi Sivam') && vtx.includes('சசி') && vtx.includes('sashi@example.com') && vtx.includes('+61412345678') && vtx.includes('Wants it'), vtx.slice(0, 200));
  ok('Visitors', 'visitor counter shown in the console', vtx.includes('Website visitor counter') && vl.counter && vl.counter.visitors >= 1, JSON.stringify(vl.counter || {}).slice(0, 160));
  ok('Visitors', 'menu link under Customers', await p.isVisible('a[data-nav="visitors"]'));
  await p.fill('#vsQ', 'nobody-here'); await sleep(200);
  ok('Visitors', 'search filters the list', (await p.textContent('#vsBody')).includes('No visitor matches'));
  r = await api('visitorDelete', { ids: ['vskiptest000000'] }); const vd = r.ok() ? await r.json() : {};
  ok('Visitors', 'delete a visitor', vd.removed === 1);
  r0 = await p.request.post(`${BASE}/.netlify/functions/chat`, { data: { mode: 'visitor', id: VID, forget: true } });
  r = await api('visitorList'); const vl2 = r.ok() ? await r.json() : { list: [] };
  ok('Visitors', '"forget me" removes the visitor', !vl2.list.some((v) => v.id === VID));

  // ---- GKH project types: 7 practices × 4 types; picking one builds phases, milestones, consultant-day costs and risks ----
  const gk = (await (await api('planNewProject', { name: 'Airline ESG strategy', client: 'National Airlines', program: 'Digital health' })).json()).core;
  await p.goto(`${BASE}/admin/#plan/${gk}`); await p.reload(); await p.waitForSelector('[data-mode=type]', { timeout: 10000 }).catch(() => {});
  await p.click('[data-mode=type]').catch(() => {}); await p.waitForSelector('#tplType', { timeout: 5000 }).catch(() => {});
  const groups = await p.$$eval('#tplType optgroup', (g) => g.map((x) => [x.label, x.querySelectorAll('option').length])).catch(() => []);
  const gkh = ['ESG consulting', 'Technology consulting', 'Project and program management', 'Training and capacity building', 'Strategic planning', 'Change management', 'Go-to-market'];
  ok('Project types', 'the chooser lists the 7 GKH practices first, 4 project types each', gkh.every((c, i) => groups[i] && groups[i][0] === c && groups[i][1] === 4), JSON.stringify(groups.slice(0, 8)));
  ok('Project types', 'a General and fun projects category (birthday, wedding and more) for learners', groups[7] && /General and fun/.test(groups[7][0]) && groups[7][1] >= 4, JSON.stringify(groups[7]));
  await p.selectOption('#tplType', 'fun-birthday').catch(() => {}); await sleep(600);
  const fpv = (await p.textContent('#tplPrev').catch(() => '')).replace(/\s+/g, ' ');
  ok('Project types', 'the birthday plan teaches the basics: charter, stakeholders, lessons learned, real costs ($1,730)', /Project charter/.test(fpv) && /Stakeholders/.test(fpv) && /Lessons learned/.test(fpv) && /1,730/.test(fpv), fpv.slice(0, 300));
  await p.selectOption('#tplType', 'esg-strategy').catch(() => {}); await sleep(600);
  const gpv = await p.textContent('#tplPrev').catch(() => '');
  ok('Project types', 'the preview shows the ESG phases (AS-IS, To-Be, gap, roadmap)', /AS-IS/.test(gpv) && /Gap analysis/.test(gpv) && /roadmap/i.test(gpv), gpv.slice(0, 200));
  await p.click('#tplCreate').catch(() => {}); await sleep(2500);
  const gp2 = (await (await api('planGet', { core: gk })).json()).plan || {};
  const tk = gp2.tasks || [];
  ok('Project types', 'the plan has kick-off, a milestone per phase and final acceptance', /Kick-off/.test((tk[0] || {}).name) && tk.filter((x) => /^✓ Phase \d complete/.test(x.name) && x.dur === 0).length === 4 && /Final acceptance/.test((tk[tk.length - 1] || {}).name), tk.map((x) => x.name).join(' | ').slice(0, 300));
  const bac = tk.reduce((a2, x) => a2 + (x.qty || 0) * (x.rate || 0), 0);
  ok('Project types', 'costed in consultant-days ($118,800 for the ESG strategy)', Math.abs(bac - 118800) < 1, bac);
  ok('Project types', 'the charter carries the deliverables and consulting acceptance', /Gap analysis register/.test((gp2.charter || {}).deliverables || '') && /phase gate/.test((gp2.charter || {}).acceptance || ''), JSON.stringify(gp2.charter || {}).slice(0, 200));
  ok('Project types', 'consulting risks are added', (gp2.risks || []).some((x) => /data or documents arrive late/.test(x.title || x.t || JSON.stringify(x))), JSON.stringify(gp2.risks || []).slice(0, 200));
  const pgOf = async (core) => { const d = await (await api('planProgramList', { today: new Date().toISOString().slice(0, 10) })).json(); const ids = Object.fromEntries(d.programs.map((x) => [x.id, x.name])); const c = d.cards.find((x) => x.core === core) || {}; return { prog: ids[c.program] || c.program, deps: d.deps }; };
  ok('Programs', 'picking an ESG type puts the project in the ESG consulting program', (await pgOf(gk)).prog === 'ESG consulting', (await pgOf(gk)).prog);
  const gk2 = (await (await api('planNewProject', { name: 'Airline sustainability report', client: 'National Airlines', program: 'Digital health' })).json()).core;
  await p.goto(`${BASE}/admin/#plan/${gk2}`); await p.reload(); await p.waitForSelector('[data-mode=type]', { timeout: 10000 }).catch(() => {});
  await p.click('[data-mode=type]').catch(() => {}); await p.waitForSelector('#tplType', { timeout: 5000 }).catch(() => {});
  await p.selectOption('#tplType', 'esg-report').catch(() => {}); await p.waitForSelector('#tplAfter option[value="' + gk + '"]', { state: 'attached', timeout: 8000 }).catch(() => {});
  ok('Programs', 'the chooser offers to link it to the other project in ESG consulting', await p.$('#tplAfter option[value="' + gk + '"]').then((x) => !!x).catch(() => false), await p.textContent('#tplLink').catch(() => ''));
  await p.selectOption('#tplAfter', gk).catch(() => {}); await p.click('#tplCreate').catch(() => {}); await sleep(3000);
  const L2 = await pgOf(gk2);
  ok('Programs', 'both projects sit in the same program, linked finish-to-start on the Dependency board', L2.prog === 'ESG consulting' && L2.deps.some((d) => d.from === gk && d.to === gk2 && d.type === 'FS'), JSON.stringify([L2.prog, L2.deps.map((d) => [d.from, d.to, d.type])]));
  await api('planProjectDelete', { core: gk2 });
  await api('planProjectDelete', { core: gk });

  // ---- console: no chat bubble (AI is built in), Ask AI about programs ----
  await p.goto(`${BASE}/admin/#portfolio`); await sleep(800);
  ok('Chat', 'no chat bubble in the dashboard', !(await p.$('#champChatBtn')));
  ok('Theme', 'light/dark slider in the console top bar', await p.isVisible('.top #champQuick'));
  r = await api('planProgramSet', { core, program: 'Head office move' });
  ok('Program', 'a project can be put in a program', r.ok());
  r = await api('planPipelineList', { today: new Date().toISOString().slice(0, 10) }); const pl2 = await r.json();
  ok('Program', 'programs are listed for the portfolio', (pl2.programs || []).includes('Head office move') && pl2.cards.find((c) => c.core === core).program === 'Head office move');
  await p.goto(`${BASE}/admin/#portfolio/summary`); await p.reload(); await p.waitForSelector('.cs-tiles', { timeout: 8000 }).catch(() => {});
  ok('Program', 'Summary has a By program table', (await p.textContent('#view')).includes('By program') && (await p.textContent('#view')).includes('📁 Head office move'));
  await p.selectOption('#pbProg', 'Head office move'); await sleep(300);
  ok('Program', 'filter the portfolio by program', (await p.textContent('#pbSum')).startsWith('1 project'), await p.textContent('#pbSum'));
  await p.selectOption('#pbProg', ''); 
  r = await api('sqlData');
  const sd = r.ok() ? await r.json() : { data: {} };
  const prow = (sd.data.projects || []).find((x) => x.job === core) || {};
  ok('Ask AI', 'Ask AI has a projects table with program, phase, health, SPI/CPI', prow.program === 'Head office move' && !!prow.phase && !!prow.health && 'spi' in prow && prow.project_id === core, JSON.stringify(prow).slice(0, 200));
  r = await api('sqlAsk', { question: 'Status of each program: budget, SPI and CPI', hints: {} });
  const ask = r.ok() ? await r.json() : {};
  ok('Ask AI', 'question becomes a query over the projects table', /FROM projects/i.test(ask.sql || ''), JSON.stringify(ask).slice(0, 200));
  ok('Ask AI', 'AI is told it serves project, program and portfolio managers', /project, program or portfolio manager/.test(global.ASK_SYS || '') && !/building company/.test(global.ASK_SYS || ''));
  await p.goto(`${BASE}/admin/#sql/ask`); await p.reload(); await p.waitForSelector('#askQ', { timeout: 15000 }).catch(() => {});
  ok('Ask AI', 'Ask AI page opens with portfolio examples', (await p.textContent('#view')).includes('How healthy is my portfolio?'));
  ok('Ask AI', 'only project tables offered (no MBS quotes/invoices)', !Object.keys(sd.schema || {}).some((t) => /^(quotes|invoices|customers|payments|expenses)$/.test(t)) && 'projects' in (sd.schema || {}));
  await p.goto(`${BASE}/admin/#sql/templates`); await sleep(1500);
  const tv = await p.textContent('#view');
  ok('Ask AI', 'templates show portfolio reports, not MBS money ones', tv.includes('Portfolio health') && tv.includes('Programs at a glance') && !/Money owed|Quotes waiting/i.test(tv));

  // ---- console language: labels translated, project data untouched ----
  await p.goto(`${BASE}/admin/#portfolio/summary`); await p.reload(); await p.waitForSelector('.cs-tiles', { timeout: 8000 }).catch(() => {});
  await p.click('#champLangBtn'); await p.click('.ct-langmenu [data-l=ms]');
  await p.waitForFunction(() => /\[Bahas/.test(document.querySelector('.side-nav').textContent), null, { timeout: 8000 }).catch(() => {});
  ok('Language', 'console menu translated', /\[Bahas/.test(await p.textContent('.side-nav')), (await p.textContent('.side-nav')).slice(0, 160) + ' / lang=' + (await p.evaluate(() => localStorage.getItem('champLang'))));
  const dataCell = await p.$$eval('#view table', (ts) => { const t = ts[ts.length - 1]; const c = t && t.querySelector('tbody tr td:nth-child(3)'); return c ? c.textContent : ''; }).catch(() => '');
  ok('Language', 'project names (data) are not translated', dataCell.includes('Head office fit-out') && !dataCell.includes('[Bahas'), dataCell);
  await p.click('#champLangBtn'); await p.click('.ct-langmenu [data-l=en]'); await sleep(300);
  await p.evaluate(() => { localStorage.removeItem('champChatLang'); localStorage.removeItem('champLang'); });

  // ---- logout → login page ----
  await p.goto(`${BASE}/admin/#projects`); await sleep(1000);
  await Promise.all([p.waitForURL(/login\.html/, { timeout: 8000 }).catch(() => {}), p.click('#logout')]);
  ok('Login', 'Sign out goes back to the login page', /login\.html/.test(p.url()), p.url());

  // ---- Google sign-in (fake Google) ----
  r = await api('loginGoogle', { credential: 'aaa.bbb.ccc' });
  ok('Google', 'Google sign-in accepted', r.status() === 200, r.status() + ' ' + (await r.text()).slice(0, 120));
  r = await api('me'); const me = r.ok() ? await r.json() : {};
  ok('Google', 'Google user is view-only', me.kind === 'google' && /view only/i.test(me.role || ''), me.role);
  r = await api('planNewProject', { name: 'X', client: 'Y' });
  ok('Google', 'Google view-only user cannot create projects', r.status() === 403, r.status());
  r = await api('planProjectDelete', { core });
  ok('Delete', 'view-only user cannot delete projects', r.status() === 403, r.status());
  r = await api('buildList');
  ok('Build', 'the build registry is owner only', r.status() === 403, r.status());

  // ---- skins and layout ----
  await p.goto(`${BASE}/index.html`);
  await p.click('#champThemeBtn'); await p.click('.ct-skin[data-v=white]');
  ok('Theme', 'website skin changes to White', (await p.getAttribute('html', 'data-skin')) === 'white');
  const bg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok('Theme', 'White skin gives a white page', /255, 255, 255/.test(bg), bg);
  await p.click('.ct-seg [data-v=compact]');
  ok('Theme', 'density switches to compact', (await p.getAttribute('html', 'data-density')) === 'compact');
  await p.goto(`${BASE}/features.html`);
  ok('Theme', 'skin is remembered on the next page', (await p.getAttribute('html', 'data-skin')) === 'white');
  await p.evaluate(() => { localStorage.setItem('champSkin', 'navy'); });
  await p.goto(`${BASE}/admin/`); await sleep(600);
  ok('Theme', 'console uses the chosen skin (Navy)', (await p.getAttribute('html', 'data-skin')) === 'navy' && /rgb\(10, 22, 40\)/.test(await p.evaluate(() => getComputedStyle(document.querySelector('.side') || document.body).backgroundColor)));
  await p.evaluate(() => { localStorage.clear(); });

  ok('Errors', 'no script errors on any page', errors.length === 0, errors.slice(0, 5).join(' || '));
  await b.close(); srv.kill(); g.close(); llm.close(); az.close(); await blobs.stop();
  const bad = results.filter((x) => !x.pass);
  for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.pass ? '' : '  → ' + x.detail}`);
  console.log(`\n${results.length - bad.length}/${results.length} passed`);
  if (bad.length) { console.log('\nserver log tail:\n' + log.slice(-1500)); process.exit(1); }
})().catch((e) => { for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.pass ? '' : '  → ' + x.detail}`); console.error('CRASH: ' + e.message.split('\n')[0]); if (global.SRV) global.SRV.kill(); process.exit(1); });
