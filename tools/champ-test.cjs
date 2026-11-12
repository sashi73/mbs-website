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
    if (j.response_format && !/strings/.test(j.messages[1].content)) {   // Ask AI: question -> SQL, or rows -> report
      global.ASK_SYS = sys; global.ASK_USER = j.messages[1].content;
      const o = /PMO analyst/.test(sys) ? { title: 'Portfolio by program', summary: 'Two programs.', insights: ['ERP has 1 project'], recommendations: ['Review risks'] }
        : { sql: "SELECT program, COUNT(*) AS projects_count, SUM(budget) AS budget_total FROM projects GROUP BY program", title: 'Projects by program', note: '' };
      s2.setHeader('Content-Type', 'application/json'); return s2.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(o) } }], usage: { prompt_tokens: 10, completion_tokens: 10 } })); }
    if (j.response_format) { const inp = JSON.parse(j.messages[1].content).strings; global.I18N_CALLS = (global.I18N_CALLS || 0) + 1;
      const code = (/into ([^.]+)\./.exec(sys) || [])[1] || '?';
      s2.setHeader('Content-Type', 'application/json'); return s2.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ t: inp.map((x) => '[' + code.slice(0, 5) + '] ' + x) }) } }] })); }
    const lang = (/Reply in ([^.]+)\./.exec(sys) || [])[1] || '?';
    const CODE = { 'Bahasa Melayu': 'ms', 'Persian (فارسی)': 'fa', 'Tamil (தமிழ்)': 'ta', English: 'en', 'Arabic (العربية)': 'ar' };
    const lastQ = (j.messages || []).slice(-1)[0].content || '';
    const tagLang = /apa khabar|bagaimana/i.test(lastQ) ? 'ms' : (CODE[lang] || 'en');
    const reply = `Echo: lang=${lang}; where=${/signed in to the Project Champ console/.test(sys) ? 'console' : 'site'}; facts=${/Pipeline board/.test(sys) && /PMBOK/.test(sys)}; q=${(j.messages || []).slice(-1)[0].content}\n- **point one**\n- point two\n[[lang:${tagLang}]]`;
    s2.setHeader('Content-Type', 'application/json'); s2.end(JSON.stringify({ choices: [{ message: { content: reply } }] }));
  }); }).listen(0);
  const az = http.createServer((q, s3) => { let b = ''; q.on('data', (d) => (b += d)); q.on('end', () => {
    if (/speechtotext/.test(q.url)) { global.STT_DEF = (/name="definition"\r?\n\r?\n([^\r\n]+)/.exec(b) || [])[1] || ''; global.STT_KEY = q.headers['ocp-apim-subscription-key'];
      s3.setHeader('Content-Type', 'application/json'); return s3.end(JSON.stringify({ combinedPhrases: [{ text: 'எனது திட்டங்கள் எப்படி உள்ளன?' }], phrases: [{ locale: 'ta-IN', durationMilliseconds: 1800, text: 'எனது திட்டங்கள் எப்படி உள்ளன?' }] })); }
    global.LAST_SSML = b; global.AZ_KEY = q.headers['ocp-apim-subscription-key']; s3.setHeader('Content-Type', 'audio/mpeg'); s3.end(Buffer.from('ID3fakeaudio')); }); }).listen(0);
  await sleep(100);
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NETLIFY_BLOBS_CONTEXT: ctxB64, ADMIN_USERNAME: '', ADMIN_PASSWORD: '', ADMIN_SESSION_SECRET: '',
    GOOGLE_CLIENT_ID: CLIENT, GOOGLE_TOKENINFO_URL: `http://127.0.0.1:${g.address().port}/tokeninfo`, LLM_API_KEY: 'test-key', LLM_BASE_URL: `http://127.0.0.1:${llm.address().port}`, LLM_MODEL: 'deepseek-chat', TELEGRAM_BOT_TOKEN: '', AZURE_SPEECH_KEY: 'az-test', AZURE_SPEECH_BASE: `http://127.0.0.1:${az.address().port}`, AZURE_STT_ENDPOINT: `http://127.0.0.1:${az.address().port}`, RESEND_API_KEY: '', SITE_ENV: '' };
  const srv = spawn('node', ['local-server.mjs'], { cwd: SITE, env, stdio: ['ignore', 'pipe', 'pipe'] }); global.SRV = srv;
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 60 && !/running/i.test(log); i++) await sleep(150);

  const b = await chromium.launch({ executablePath: fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined });
  const ctx = await b.newContext({ viewport: { width: 1366, height: 900 } });
  await ctx.route(/images\.unsplash\.com|accounts\.google\.com/, (r) => r.abort());   // no internet in the test
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
  ok('Site', 'menu has the 5 pages', JSON.stringify(nav) === JSON.stringify(['index.html', 'features.html', 'agile.html', 'industries.html', 'contact.html']), nav.join(','));
  ok('Site', 'header has a Login link to login.html', (await p.getAttribute('header .nav-login', 'href')) === 'login.html');
  ok('Site', 'no MBS wording on the home page', !/Modern Building|0420 494 990|Mr\.? Fixit|Wonder Bird/i.test(await p.content()));
  ok('Site', 'footer credit "Designed by © Sashi Kumar Sivam"', (await p.textContent('footer')).includes('Designed by © Sashi Kumar Sivam'));
  const r404 = await p.goto(`${BASE}/nope.html`);
  ok('Site', 'unknown page gives the 404 page', r404.status() === 404 && (await p.textContent('body')).includes('critical path'));

  // ---- Champ chat (website) ----
  await p.goto(`${BASE}/index.html`);
  ok('Chat', 'Ask Champ button on the website', await p.isVisible('#champChatBtn'));
  await p.click('#champChatBtn'); await p.waitForSelector('#champChat:not([hidden])');
  ok('Chat', 'opens with a greeting and the main menu', (await p.textContent('.cc-log')).includes('Champ') && (await p.$$('.cc-menu-list button')).length === 9);
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
  ok('Switch', 'main menu appears after switching, in Persian', (await p.$$('.cc-menu .cc-menu-list button')).length === 9 && /\[Persi/.test(await p.textContent('.cc-menu')));
  ok('Switch', 'chat goes right-to-left for Persian', (await p.getAttribute('#champChat', 'dir')) === 'rtl');
  ok('Switch', 'the website follows the chat language', (await p.getAttribute('html', 'lang')) === 'fa');
  await p.click('.cc-menu .cc-menu-list button:nth-child(2)'); await sleep(1500);
  await p.click('.cc-menubtn');
  ok('Menu', '☰ in the header brings back the main menu at any time', (await p.$$('.cc-menu .cc-menu-list button')).length === 9);
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
  await p.reload(); await sleep(1200);
  ok('Language', 'cached: reloading costs no new AI calls', (global.I18N_CALLS || 0) === calls1 + 1 || (global.I18N_CALLS || 0) <= calls1 + 1, `${calls1} -> ${global.I18N_CALLS}`);
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
  ok('Login', 'sashi73 / sashi98 signs in and lands on the Portfolio', /\/admin\/#portfolio/.test(p.url()), p.url());
  await p.waitForSelector('#app:not([hidden])', { timeout: 10000 }).catch(() => {});
  await sleep(800);
  const menu = await p.$$eval('.side-nav a:not([hidden])', (as) => as.map((a) => a.textContent.trim()));
  ok('Console', 'menu shows only the project element (+ admin)', JSON.stringify(menu) === JSON.stringify(['📊Summary', '▦Pipeline board', '📅All projects', '＋New project', '✨Ask AI', '📈Reports & data', '🔐Users & access', '🕘Activity log', '🏷Builds']), menu.join(' | '));
  ok('Console', 'branded GKH Project Champ', (await p.textContent('.gkh-bar')).includes('GKH Project Champ') && (await p.title()).includes('Project Champ'));
  await p.waitForSelector('.pcol', { timeout: 8000 }).catch(() => {});
  ok('Portfolio', 'pipeline board has the 5 PMBOK phases', JSON.stringify(await p.$$eval('.pcol .pcol-h b', (b) => b.map((x) => x.textContent))) === JSON.stringify(['Initiation', 'Planning', 'Execution', 'Monitoring & Evaluation', 'Closing']));

  // ---- new project → plan ----
  await p.click('.top-new');
  await p.waitForSelector('#champNew');
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
  const r2 = await api('planNewProject', { name: 'ERP rollout', client: 'Finance' });
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
  for (const n of ['Test A', 'Test B']) extra.push((await (await api('planNewProject', { name: n, client: 'Tmp' })).json()).core);
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
  await p.fill('#champNew [name=name]', 'IT rollout'); await p.fill('#champNew [name=client]', 'Finance');
  await p.click('#champNew .mod-row:has([name=bom]) .bom-slider'); await p.click('#champNew .mod-row:has([name=swms]) .bom-slider');
  await p.click('#champNew button[type=submit]'); await p.waitForFunction(() => /#plan\//.test(location.hash), null, { timeout: 8000 }).catch(() => {});
  const itCore = decodeURIComponent(p.url().split('#plan/')[1] || '').split('/')[0];
  r = await api('planGet', { core: itCore }); ch = r.ok() ? (await r.json()).champ : {};
  ok('Modules', 'New project form: BOM and SWMS switched off at creation', ch.bom === false && ch.swms === false, JSON.stringify(ch));
  await api('planProjectDelete', { core: itCore });

  // ---- builds ----
  r = await api('me'); const meB = r.ok() ? await r.json() : {};
  ok('Build', 'the server reports its build number', meB.build && /^1\.0\.\d+$/.test(meB.build.label), JSON.stringify(meB.build));
  ok('Build', 'sidebar shows the build', (await p.textContent('.ver')).includes(meB.build ? meB.build.label : '??'));
  r = await api('buildList'); const bl = r.ok() ? await r.json() : { list: [] };
  ok('Build', 'this build is in the registry (Admin > Builds)', bl.list.length >= 1 && bl.list[0].build === meB.build.build);
  await p.goto(`${BASE}/admin/#builds`); await sleep(1200);
  ok('Build', 'Builds page shows the registry', (await p.textContent('#view')).includes('Build registry'));

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
  ok('Language', 'console menu translated', /\[Bahas/.test(await p.textContent('.side-nav')));
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
