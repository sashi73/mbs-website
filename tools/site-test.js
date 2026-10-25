// MBS website v19-v20c: automated end-to-end test pass (Playwright, headless Chromium)
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8888';
const PAGES = ['index', 'services', 'projects', 'about', 'contact'];
const WIDTHS = [360, 390, 768, 1024, 1440, 1920];
const results = [];
const ok = (area, name, pass, detail = '') => results.push({ area, name, pass: !!pass, detail });

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext();
  const errors = [];
  const watch = (p, tag) => {
    p.on('pageerror', e => errors.push(`${tag}: ${e.message}`));
    p.on('console', m => { if (m.type() === 'error' && !(/^(contact|chat)$/.test(tag) && /50[23]/.test(m.text()))) errors.push(`${tag} console: ${m.text()}`); });
  };

  // 1. Smoke + 2. links/images/assets/anchors
  const p = await ctx.newPage(); watch(p, 'main');
  const refs = new Set(); const anchors = [];
  for (const pg of PAGES) {
    const r = await p.goto(`${BASE}/${pg}.html`, { waitUntil: 'networkidle' });
    ok('Smoke', `${pg}.html loads`, r.status() === 200, r.status());
    const title = await p.title();
    ok('Smoke', `${pg}.html has a title`, title.length > 5, title);
    const found = await p.evaluate(() => {
      const out = [];
      document.querySelectorAll('a[href],img[src],link[href],script[src],button[data-src],[data-src]').forEach(e => {
        const v = e.getAttribute('href') || e.getAttribute('src') || e.getAttribute('data-src');
        if (v) out.push(v);
      });
      return out;
    });
    for (const v of found) {
      if (/^(tel:|mailto:|sms:|javascript:|data:)/.test(v) || /^https?:\/\//.test(v) && !v.startsWith('http://127.0.0.1')) continue;
      if (v.startsWith('#')) { if (v.length > 1 && !/^#f=/.test(v)) anchors.push([pg + '.html', v.slice(1)]); continue; }
      const [path, hash] = v.split('#');
      if (path) refs.add(new URL(path, `${BASE}/${pg}.html`).pathname);
      if (hash && !/^f=/.test(hash)) anchors.push([new URL(path, `${BASE}/${pg}.html`).pathname.slice(1), hash]);
    }
  }
  let bad = [];
  for (const u of refs) { const r = await p.request.get(BASE + u); if (r.status() !== 200) bad.push(`${r.status()} ${u}`); }
  ok('Links', `all ${refs.size} internal links, images, styles and scripts return 200`, bad.length === 0, bad.slice(0, 5).join(', '));
  bad = [];
  for (const [file, id] of anchors) {
    await p.goto(`${BASE}/${file}`, { waitUntil: 'domcontentloaded' });
    if (!(await p.evaluate(i => !!document.getElementById(decodeURIComponent(i)), id))) bad.push(`${file}#${id}`);
  }
  ok('Links', `all ${anchors.length} in-page anchors (#...) point to a real section`, bad.length === 0, bad.slice(0, 5).join(', '));

  // KB project photos + every image file referenced in fixit-kb.js
  const kb = await (await p.request.get(`${BASE}/assets/fixit-kb.js`)).text();
  const kbImgs = [...new Set(kb.match(/images\/work\/[a-z0-9\/-]+\.(jpg|webp)/g) || [])];
  bad = [];
  for (const u of kbImgs) { const r = await p.request.get(`${BASE}/${u}`); if (r.status() !== 200) bad.push(u); }
  ok('Links', `all ${kbImgs.length} Mr. Fixit project photos exist`, bad.length === 0, bad.join(', '));

  // 3. Responsive: every page x every width: no sideways scroll, every image decodes
  for (const w of WIDTHS) {
    const q = await ctx.newPage(); watch(q, `w${w}`);
    await q.setViewportSize({ width: w, height: 900 });
    let over = [], broken = [];
    for (const pg of PAGES) {
      await q.goto(`${BASE}/${pg}.html`, { waitUntil: 'networkidle' });
      await q.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 700) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 30)); } });
      await q.waitForTimeout(500);
      const o = await q.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (o > 1) over.push(`${pg} +${o}px`);
      const br = await q.evaluate(() => [...document.images].filter(i => i.complete && i.naturalWidth === 0).map(i => i.getAttribute('src')));
      broken.push(...br.map(s => `${pg}:${s}`));
    }
    ok('Responsive', `${w}px wide: no sideways scrolling on any page`, over.length === 0, over.join(', '));
    ok('Responsive', `${w}px wide: every image displays`, broken.length === 0, broken.slice(0, 4).join(', '));
    await q.close();
  }

  // 4. Features
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.goto(`${BASE}/projects.html`, { waitUntil: 'networkidle' });
  const chips = await p.$$eval('.chip[data-filter]', cs => cs.map(c => c.dataset.filter));
  for (const f of chips) {
    await p.click(`.chip[data-filter="${f}"]`); await p.waitForTimeout(250);
    const n = await p.$$eval('#project-grid .pitem', ps => ps.filter(x => getComputedStyle(x).display !== 'none').length);
    ok('Projects', `filter "${f}" shows projects`, n > 0, `${n} shown`);
  }
  await p.goto(`${BASE}/projects.html#f=Homes`, { waitUntil: 'networkidle' }); await p.waitForTimeout(600);
  await p.waitForTimeout(100);
  const homes = await p.$$eval('#project-grid .pitem', ps => ps.filter(x => getComputedStyle(x).display !== 'none').map(x => x.id));
  ok('Projects', 'link from home page "Homes" sector opens the Homes filter', homes.length === 2, homes.join(', '));
  await p.goto(`${BASE}/projects.html`, { waitUntil: 'networkidle' });
  const galCards = await p.$$('.wcard:has(.gal-t)');
  let galOk = 0;
  for (const c of galCards) {
    const t = await c.$$('.gal-t'); const main = await c.$('.gal-main');
    await t[t.length - 1].evaluate(e => e.click()); await p.waitForTimeout(60);
    const src = await main.getAttribute('src'); const want = await t[t.length - 1].getAttribute('data-src');
    if (src === want) galOk++;
  }
  ok('Projects', `photo galleries: tapping a small photo shows it large (${galOk}/${galCards.length} cards)`, galOk === galCards.length);
  const bas = await p.$$('.ba-frame');
  let baOk = 0;
  for (const f of bas) {
    const r = await f.$('input[type=range]');
    await r.evaluate(e => { e.value = 20; e.dispatchEvent(new Event('input', { bubbles: true })); });
    const pos = await f.evaluate(e => e.style.getPropertyValue('--pos'));
    const imgsOk = await f.$$eval('img', is => is.every(i => i.naturalWidth > 0 || !i.complete));
    if (pos.trim().startsWith('20') && imgsOk) baOk++;
  }
  ok('Projects', `before & after sliders move (${baOk}/${bas.length})`, baOk === bas.length && bas.length === 8);
  const projCount = await p.$$eval('#project-grid .pitem', x => x.length);
  const tradeCount = await p.$$eval('.tradegrid .pitem', x => x.length);
  ok('Projects', `23 projects and 16 "on the tools" cards on the page`, projCount === 23 && tradeCount === 16, `${projCount} / ${tradeCount}`);

  await p.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
  const heroN = await p.$$eval('.hero-slides img', x => x.length);
  ok('Home', 'hero slideshow has 4 photos', heroN === 4, heroN);
  const strip = await p.$$eval('.trustbar img', x => [...new Set(x.map(i => i.getAttribute('alt')).filter(Boolean))]);
  ok('Home', 'accreditation strip shows only the 7 entities', strip.length === 7, strip.join(' | '));
  const plaques = await p.$$eval('#accreditations .plaque', x => x.length);
  ok('Home', 'accreditations section has 7 plaques', plaques === 7, plaques);
  const sectors = await p.$$eval('.sector', x => x.length);
  ok('Home', '6 sector cards (incl. Homes)', sectors === 6, sectors);
  let removed = [];
  for (const pg of PAGES) { const t = await (await p.request.get(`${BASE}/${pg}.html`)).text(); if (/dulux|acratex|local business award/i.test(t)) removed.push(pg); }
  if (/dulux|acratex/i.test(kb)) removed.push('fixit-kb.js');
  ok('Home', 'no Dulux / Acratex / award mentions anywhere', removed.length === 0, removed.join(', '));

  const m = await ctx.newPage(); watch(m, 'mobile');
  await m.setViewportSize({ width: 390, height: 844 });
  await m.goto(`${BASE}/services.html`, { waitUntil: 'networkidle' });
  await m.click('.burger'); await m.waitForTimeout(400);
  ok('Navigation', 'phone menu opens', (await m.getAttribute('.burger', 'aria-expanded')) === 'true');
  await m.close();

  // Mr. Fixit
  await p.goto(`${BASE}/projects.html`, { waitUntil: 'networkidle' });
  await p.$eval('.fx-launch', e => e.click()); await p.waitForTimeout(2500);
  const menu = await p.$$eval('.fx-chip', x => x.map(c => c.textContent.trim()));
  ok('Mr. Fixit', 'opens with a menu', menu.length > 3, menu.slice(0, 6).join(' | '));
  await p.locator('.fx-chip', { hasText: 'Past projects' }).first().click(); await p.waitForTimeout(1500);
  const sect = await p.$$eval('.fx-chip', x => x.map(c => c.textContent.trim()));
  ok('Mr. Fixit', 'Past projects offers all 6 sectors', ['Hotels', 'Strata & apartments', 'Heritage & government', 'Aged care', 'Commercial', 'Homes'].every(s => sect.includes(s)), sect.join(' | '));
  await p.locator('.fx-chip', { hasText: 'All projects' }).last().click(); await p.waitForTimeout(1300);
  const allCards = await p.$$eval('.fx-projs', x => x[x.length - 1].querySelectorAll('.fx-proj').length);
  ok('Mr. Fixit', '"All projects" shows all 23 jobs', allCards === 23, allCards);
  for (const s of ['Hotels', 'Strata & apartments', 'Heritage & government', 'Aged care', 'Commercial', 'Homes']) {
    await p.locator('.fx-chip', { hasText: /^(Other projects|Past projects)$/ }).last().click(); await p.waitForTimeout(1200);
    const before = await p.$$eval('.fx-projs', x => x.length);
    await p.locator('.fx-chip', { hasText: s }).last().click(); await p.waitForTimeout(1300);
    const n = await p.$$eval('.fx-projs', x => x.length ? x[x.length - 1].querySelectorAll('.fx-proj').length : 0);
    const after = await p.$$eval('.fx-projs', x => x.length);
    ok('Mr. Fixit', `sector "${s}" lists its projects`, after > before && n > 0, `${n} cards`);
  }
  const scrolled = await p.evaluate(() => { const l = document.querySelector('.fx-list'); const c = [...document.querySelectorAll('.fx-projs')].pop(); return l && c ? Math.abs(l.scrollTop - (c.offsetTop - 12)) < 40 || l.scrollTop + l.clientHeight >= l.scrollHeight - 4 : false; });
  ok('Mr. Fixit', 'chat scrolls to the newest project cards', scrolled);
  const pics = await p.$$eval('.fx-proj img', x => x.filter(i => i.complete && i.naturalWidth === 0).map(i => i.getAttribute('src')));
  ok('Mr. Fixit', 'every project card photo displays in the chat', pics.length === 0, pics.join(', '));

  // 4b. Contact form
  const c = await ctx.newPage(); watch(c, 'contact');
  await c.goto(`${BASE}/contact.html`, { waitUntil: 'networkidle' });
  ok('Contact', 'hours show "Anytime (24 hours)"', (await c.content()).includes('Anytime (24 hours)'));
  await c.click('form.quote button[type=submit]'); await c.waitForTimeout(300);
  const msg = await c.$eval('form.quote', f => f.textContent);
  ok('Contact', 'empty form is stopped with "Please add your name."', /Please add your name/.test(msg));
  await c.fill('input[name=name]', 'Automated Test'); await c.fill('input[name=phone]', '0400 000 000');
  await c.fill('textarea[name=details]', 'Automated test enquiry, please ignore.');
  await c.click('form.quote button[type=submit]'); await c.waitForTimeout(300);
  ok('Contact', 'form asks for the best time to call', /Please choose the best time for us to call you/.test(await c.$eval('form.quote', f => f.textContent)));
  const firstTime = await c.$eval('select[name=best_time]', s => s.options[1].value);
  await c.selectOption('select[name=best_time]', firstTime);
  await c.click('form.quote button[type=submit]'); await c.waitForTimeout(4000);
  const state = await c.evaluate(() => ({ thanks: getComputedStyle(document.querySelector('.thanks') || document.body).display === 'flex', text: document.body.innerText }));
  ok('Contact', 'a filled form is sent (thank-you + reference) or shows the friendly "call us" message', state.thanks || /didn.t send/.test(state.text),
    state.thanks ? (state.text.match(/reference number is ([A-Z]+-\d+-\d+)/) || ['', 'thank-you shown'])[1] : 'friendly error shown (no email/Telegram keys on the test server)');
  await c.close();

  // 5. Security
  for (const u of ['/.env', '/.env.example', '/data/mbs.db', '/deploy/setup-server.sh', '/netlify/lib/shared.mjs', '/local-server.mjs', '/package.json', '/README.txt', '/tools/jobs.mjs', '/leads/', '/../etc/passwd']) {
    const r = await p.request.get(BASE + u); ok('Security', `${u} is not public`, [403, 404].includes(r.status()), r.status());
  }


  // 6. SEO
  const titles = new Set();
  for (const pg of PAGES) {
    await p.goto(`${BASE}/${pg}.html`, { waitUntil: 'domcontentloaded' });
    const seo = await p.evaluate(() => ({
      title: document.title, desc: (document.querySelector('meta[name=description]') || {}).content || '',
      canon: (document.querySelector('link[rel=canonical]') || {}).href || '', h1: document.querySelectorAll('h1').length,
      lang: document.documentElement.lang, noalt: [...document.images].filter(i => !i.hasAttribute('alt')).length,
      ld: [...document.querySelectorAll('script[type="application/ld+json"]')].map(s => { try { return JSON.parse(s.textContent)['@type']; } catch { return 'BROKEN'; } })
    }));
    titles.add(seo.title);
    ok('SEO', `${pg}: title ${seo.title.length} chars (aim 30-65)`, seo.title.length >= 30 && seo.title.length <= 65, seo.title);
    ok('SEO', `${pg}: description ${seo.desc.length} chars (aim 110-170)`, seo.desc.length >= 110 && seo.desc.length <= 170);
    ok('SEO', `${pg}: canonical link, one main heading, language, all photos described`, /^https:\/\/www\.modernbuildingsolutions\.com\.au\//.test(seo.canon) && seo.h1 === 1 && seo.lang === 'en-AU' && seo.noalt === 0, `${seo.canon} h1=${seo.h1}`);
    if (seo.ld.length) ok('SEO', `${pg}: business details for Google read correctly`, seo.ld.every(t => t === 'GeneralContractor'), seo.ld.join(','));
  }
  ok('SEO', 'every page has a different title', titles.size === PAGES.length);
  const vt = await p.request.get(`${BASE}/version.txt`);
  ok('Smoke', 'version.txt shows the live website version', vt.status() === 200 && /MBS website v\d+/.test(await vt.text()), (await vt.text()).split('\n')[0]);
  const rb = await p.request.get(`${BASE}/robots.txt`); const rbt = await rb.text();
  ok('SEO', 'robots.txt is there and points to the sitemap', rb.status() === 200 && /Sitemap: https:\/\/www\.modernbuildingsolutions\.com\.au\/sitemap\.xml/.test(rbt));
  const sm = await p.request.get(`${BASE}/sitemap.xml`); const smt = await sm.text();
  ok('SEO', 'sitemap.xml lists all 5 pages', sm.status() === 200 && (smt.match(/<loc>/g) || []).length === 5);
  const nf = await p.request.get(`${BASE}/no-such-page.html`);
  ok('SEO', 'unknown address shows the 404 page (status 404)', nf.status() === 404 && /Page not/.test(await nf.text()), nf.status());


  // 7. Mr. Fixit: name + Sydney check before anything goes to the team
  const chatPage = async (fixedTime) => {
    const cx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    if (fixedTime) await cx.clock.setFixedTime(new Date(fixedTime));
    const q = await cx.newPage(); watch(q, 'chat');
    await q.goto(`${BASE}/projects.html`, { waitUntil: 'networkidle' });
    await q.$eval('.fx-launch', e => e.click()); await q.waitForTimeout(2200);
    return { cx, q };
  };
  const chatText = q => q.$eval('.fx-list', e => e.innerText);
  const chipList = q => q.$$eval('.fx-chip', x => x.map(c => c.textContent.trim()));
  // wait until Mr. Fixit has finished typing his reply (its buttons appear at the end)
  const settle = async q => { await q.waitForTimeout(400); await q.waitForFunction(() => document.querySelectorAll('.fx-chip').length > 0, null, { timeout: 15000 }).catch(() => {}); await q.waitForTimeout(300); };
  const type = async (q, t) => { await q.fill('.fx-input', t); await q.press('.fx-input', 'Enter'); await settle(q); };
  const tap = async (q, label) => { await q.locator('.fx-chip', { hasText: new RegExp('^' + label + '$') }).last().click(); await settle(q); };
  {
    const { cx, q } = await chatPage();
    await tap(q, 'Get a free quote');
    ok('Chat area check', 'quote starts by asking the name', /First, what.s your name\?/.test(await chatText(q)));
    await type(q, "I'm Sam Smith");
    const t1 = await chatText(q); const c1 = await chipList(q);
    ok('Chat area check', 'then asks if the property is in Sydney, with Yes / No', /Thanks Sam! Is the property in Sydney or one of the nearby suburbs\?/.test(t1) && c1.includes('Yes') && c1.includes('No'), c1.join(' | '));
    await tap(q, 'No');
    const t2 = await chatText(q); const c2 = await chipList(q);
    ok('Chat area check', '"No" gives a polite apology', /really sorry, Sam\. We currently only work in Sydney and the surrounding suburbs/.test(t2) && /Please accept our apologies/.test(t2));
    ok('Chat area check', '"No" goes back to the main menu', c2.includes('Past projects') && c2.includes('Get a free quote') && !c2.includes('Cancel'), c2.join(' | '));
    await cx.close();
  }
  {
    const { cx, q } = await chatPage();
    await tap(q, 'Get a free quote');
    await type(q, 'Jane');
    await type(q, 'maybe');
    ok('Chat area check', 'an unclear answer asks again', /Just tap Yes or No/.test(await chatText(q)));
    await tap(q, 'Yes');
    const t3 = await chatText(q);
    ok('Chat area check', '"Yes" carries on to the job questions', /Great, Jane, you.re in our area\./.test(t3) && /Tell me a bit about the job/.test(t3));
    await type(q, 'Water stain on the bedroom ceiling after rain');
    for (let i = 0; i < 6 && !/Which suburb/.test(await chatText(q)); i++) {
      const cs = await chipList(q);
      if (cs.includes('Skip questions')) await tap(q, 'Skip questions');
      else if (cs.some(c => /continue|without/i.test(c))) await tap(q, cs.find(c => /continue|without/i.test(c)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      else await q.waitForTimeout(800);
    }
    await type(q, 'Parramatta');
    if ((await chipList(q)).includes('This week')) await tap(q, 'This week');
    const t4 = await chatText(q);
    ok('Chat area check', 'name is not asked twice (goes straight to the phone number)', /best phone number for the team to call, Jane\?/.test(t4) && (t4.match(/what.s your name\?/gi) || []).length === 1);
    await type(q, '0412 345 678');
    const t4b = (await chatText(q)).split('0412 345 678').pop();
    ok('Chat area check', 'quote: best time question right after the phone number (before email)', /When.s the best time for one of our team to call you\?/.test(t4b) && !/email/i.test(t4b) && (await chipList(q)).includes('Anytime'), (await chipList(q)).join(' | '));
    await tap(q, 'Anytime');
    ok('Chat area check', 'quote: then asks for an email copy', /copy by email/i.test((await chatText(q)).split('Anytime').pop()));
    await cx.close();
  }
  {
    const { cx, q } = await chatPage();
    await tap(q, 'Get a free quote'); await type(q, 'Lee'); await type(q, 'no, I live in Melbourne');
    ok('Chat area check', 'typing "no" also works', /really sorry, Lee/.test(await chatText(q)));
    await cx.close();
  }


  // 8. Suburb suggestions (type 3 letters) - chat and contact form
  {
    const { cx, q } = await chatPage();
    await tap(q, 'Get a free quote'); await type(q, 'Kim'); await tap(q, 'Yes');
    await type(q, 'Front fence is leaning and needs replacing');
    for (let i = 0; i < 8 && !/Which suburb/.test(await chatText(q)); i++) {
      const cs = await chipList(q);
      if (cs.includes('Skip questions')) await tap(q, 'Skip questions');
      else { const c = cs.find(x => /continue|without/i.test(x)); if (c) await tap(q, c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')); else await q.waitForTimeout(800); }
    }
    ok('Suburbs', 'chat asks for the suburb with a typing hint', /Type the first 3 letters/.test(await chatText(q)) && /suburb/i.test(await q.$eval('.fx-input', e => e.placeholder)));
    await q.fill('.fx-input', ''); await q.type('.fx-input', 'box', { delay: 50 }); await q.waitForTimeout(800);
    const sug = await chipList(q);
    ok('Suburbs', 'typing "box" suggests "Box Hill 2765"', sug.includes('Box Hill 2765'), sug.join(' | '));
    await q.fill('.fx-input', ''); await q.type('.fx-input', '2150', { delay: 50 }); await q.waitForTimeout(800);
    const sug2 = await chipList(q);
    ok('Suburbs', 'typing the postcode "2150" suggests Parramatta', sug2.some(x => /^Parramatta 2150$/.test(x)), sug2.join(' | '));
    await q.fill('.fx-input', ''); await q.type('.fx-input', 'parr', { delay: 50 }); await q.waitForTimeout(800);
    const sug3 = await chipList(q);
    ok('Suburbs', 'no shopping centres or mail centres in the list', !sug3.some(x => /westfield|parliament|\bdc\b|\bmc\b/i.test(x)), sug3.join(' | '));
    await tap(q, 'Parramatta 2150');
    const nxt = await chipList(q);
    ok('Suburbs', 'tapping a suggestion moves on to the next question', nxt.includes('This week') && /Parramatta 2150/.test(await chatText(q)));
    await cx.close();
  }
  {
    const cx = await b.newContext(); const c2 = await cx.newPage(); watch(c2, 'contact');
    await c2.goto(`${BASE}/contact.html`, { waitUntil: 'networkidle' });
    await c2.focus('input[name=suburb]'); await c2.waitForTimeout(1200);
    const opts = await c2.$$eval('#suburb-list option', o => o.map(x => x.value));
    ok('Suburbs', 'contact form suburb box offers suburbs with postcodes', opts.length > 1000 && opts.includes('Box Hill 2765'), `${opts.length} suburbs`);
    const sj = await (await c2.request.get(`${BASE}/assets/suburbs-sydney.json`)).json();
    ok('Suburbs', 'suburb list is credited (GeoNames, CC BY 4.0)', /GeoNames/.test(sj.source) && /GeoNames/.test(await c2.content()));
    await cx.close();
  }


  // 9. Repair question -> "send it to the team": same steps as a quote (name, Sydney, suburb), no Cancel buttons
  //    (run at 5:02pm Sydney time to check the call-time choices follow the clock)
  {
    const { cx, q } = await chatPage('2026-10-25T17:02:00+11:00');
    const seen = [];
    const note = async () => seen.push(...(await chipList(q)));
    await tap(q, 'Ask a repair question'); await q.waitForTimeout(1200);
    await type(q, 'Why is my paint peeling in the bathroom?'); await q.waitForTimeout(1500); await settle(q);

    ok('Repair question', 'answers never say "nine (times) out of ten"', !/\b(nine|9)\s+(times\s+)?out\s+of\s+(ten|10)/i.test(await chatText(q)));
    await tap(q, 'Yes, send it to the team'); await note();
    ok('Repair question', 'sending a repair question asks the name first', /What.s your name\?/.test(await chatText(q)));
    await type(q, 'Alex Chen'); await note();
    ok('Repair question', 'then asks if the property is in Sydney (Yes / No)', /Thanks Alex! Is the property in Sydney/.test(await chatText(q)) && (await chipList(q)).join() === 'Yes,No', (await chipList(q)).join(' | '));
    await tap(q, 'Yes'); await note();
    ok('Repair question', 'then asks for the suburb', /Which suburb is the property in\?/.test(await chatText(q)));
    await q.fill('.fx-input', ''); await q.type('.fx-input', 'castle h', { delay: 60 });
    await q.waitForTimeout(2600); await settle(q); await note();
    const t5 = await chatText(q);
    ok('Repair question', 'suburb is picked automatically when only one matches ("castle h" -> Castle Hill 2154)', /Castle Hill 2154/.test(t5) && /best phone number to reach you, Alex\?/.test(t5));
    await type(q, '0412 345 678'); await note();
    ok('Repair question', 'best time question right after the phone number', /When.s the best time for one of our team to call you\?/.test((await chatText(q)).split('0412 345 678').pop()) && (await chipList(q)).includes('This evening'), (await chipList(q)).join(' | '));
    ok('Call times', 'chat at 5:02pm offers This evening / Tomorrow morning / Tomorrow afternoon / Tomorrow after 5pm (no "this morning" or "this afternoon")',
      (await chipList(q)).join('|') === 'Right now|This evening|Tomorrow morning|Tomorrow afternoon|Tomorrow after 5pm|Anytime', (await chipList(q)).join(' | '));
    await tap(q, 'This evening'); await note();
    for (let i = 0; i < 4; i++) {
      const cs = await chipList(q);
      const c = cs.find(x => /^(No photo, continue|Skip|No thanks)$/.test(x));
      if (!c) break;
      await tap(q, c); await note();
    }
    await q.waitForTimeout(2500);
    const t6 = await chatText(q);
    ok('Repair question', 'the question is sent to the team (or the friendly "call us" message without keys)', /sent your question to our team/.test(t6) || /couldn.t reach the team/.test(t6));
    ok('Repair question', 'no Cancel button anywhere in the send steps', !seen.includes('Cancel'), [...new Set(seen)].join(' | '));
    await cx.close();
  }
  {
    const { cx, q } = await chatPage();
    await tap(q, 'Get a free quote');
    ok('Chat area check', 'quote steps have no Cancel button', !(await chipList(q)).includes('Cancel'));
    await cx.close();
  }


  // 10. Footer, visitor counter, Mr. Fixit's glowing bubble
  {
    let bad = [];
    for (const pg of PAGES) {
      const t = await (await p.request.get(`${BASE}/${pg}.html`)).text();
      if (!/Builder Licence 267071C · ABN 50 159 309 181/.test(t) || !/Designed by © Sashi Kumar Sivam · GKH AI Powered Business Intelligence © · ABN 38 107 769 345/.test(t) || !/tel:0493431202/.test(t)) bad.push(pg);
    }
    ok('Footer', 'every page: licence + MBS ABN, then the GKH credit with ABN and phone', bad.length === 0, bad.join(', '));
    const visitsOf = async (pg) => { await pg.waitForFunction(() => { const v = document.querySelector('[data-visits]'); return v && !v.hidden; }, null, { timeout: 8000 }).catch(() => {}); return pg.$eval('[data-visits]', v => v.hidden ? null : Number(v.querySelector('b').textContent.replace(/,/g, ''))); };
    const c1 = await b.newContext(); const v1 = await c1.newPage(); await v1.goto(`${BASE}/about.html`, { waitUntil: 'networkidle' });
    const n1 = await visitsOf(v1);
    ok('Visitor counter', 'small visitor count shows at the bottom of the page', typeof n1 === 'number' && n1 > 0, n1);
    await v1.reload({ waitUntil: 'networkidle' }); const n2 = await visitsOf(v1);
    ok('Visitor counter', 'the same visitor reloading is not counted twice', n2 === n1, `${n1} -> ${n2}`);
    const c2 = await b.newContext(); const v2 = await c2.newPage(); await v2.goto(`${BASE}/services.html`, { waitUntil: 'networkidle' });
    const n3 = await visitsOf(v2);
    ok('Visitor counter', 'a new visitor adds one', n3 === n2 + 1, `${n2} -> ${n3}`);
    await c1.close(); await c2.close();
    const c3 = await b.newContext({ viewport: { width: 1280, height: 900 } }); const t1 = await c3.newPage(); watch(t1, 'ring');
    await t1.goto(`${BASE}/projects.html`, { waitUntil: 'networkidle' }); await t1.waitForTimeout(2500);
    const ring = await t1.$eval('.fx-launch .fx-ring', e => { const r = e.getBoundingClientRect(); return { text: e.textContent, glow: getComputedStyle(e).animationName, inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight }; }).catch(() => null);
    ok('Mr. Fixit ring', '"Need an answer? Ask me!" wraps around the button and glows', ring && /NEED AN ANSWER\? · ASK ME!/.test(ring.text) && ring.glow === 'fxRingGlow', ring && ring.glow);
    ok('Mr. Fixit ring', 'the ring is fully on screen (not cut off at the edge)', ring && ring.inside);
    const bubble = await t1.$('.fx-tip'); const shown = bubble ? await bubble.isVisible() : false;
    ok('Mr. Fixit ring', 'no text bubble any more', !shown);
    await t1.$eval('.fx-launch', e => e.click()); await t1.waitForTimeout(800);
    ok('Mr. Fixit ring', 'tapping the button opens the chat', await t1.$eval('.fx-panel', e => e.classList.contains('open')));
    await c3.close();

    // nothing on any page is hidden under the ring (buttons, links, form fields), at the top of each page
    for (const w of [390, 768, 1280, 1920]) {
      const cw = await b.newContext({ viewport: { width: w, height: w < 500 ? 844 : 820 } }); const pw = await cw.newPage();
      const hits = [];
      for (const pg of PAGES) {
        await pw.goto(`${BASE}/${pg}.html`, { waitUntil: 'networkidle' });
        const sk = pw.locator('text=Skip intro'); if (await sk.count()) { try { await sk.first().click({ timeout: 2000 }); } catch (e) {} }
        await pw.waitForTimeout(900);
        const h = await pw.evaluate(() => {
          const r = document.querySelector('.fx-ring').getBoundingClientRect(), out = [];
          if (r.left < 2 || r.right > innerWidth - 2 || r.bottom > innerHeight - 2) out.push('ring off screen');
          document.querySelectorAll('.hero a.btn, .hero button').forEach(e => {
            if (e.closest('.fx-launch,.fx-panel,.trustbar,.ticker') || !e.offsetParent) return;
            const q = e.getBoundingClientRect();
            if (q.width && q.right > r.left + 6 && q.left < r.right - 6 && q.bottom > r.top + 6 && q.top < r.bottom - 6) out.push((e.textContent || e.name || e.tagName).trim().slice(0, 25));
          });
          return out;
        });
        h.forEach(x => hits.push(`${pg}: ${x}`));
      }
      ok('Mr. Fixit ring', `${w}px: the ring is fully on screen and clear of the home page buttons`, hits.length === 0, hits.slice(0, 4).join(' | '));
      await cw.close();
    }
    for (const w of [390, 1440]) {
      const cw = await b.newContext({ viewport: { width: w, height: 900 } }); const pw = await cw.newPage();
      await pw.goto(`${BASE}/about.html`, { waitUntil: 'networkidle' }); await pw.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await pw.waitForTimeout(800);
      const clear = await pw.evaluate(() => { const r = document.querySelector('.fx-ring').getBoundingClientRect(); return [...document.querySelectorAll('.fbar > span')].every(sp => { const q = sp.getBoundingClientRect(); return q.right <= r.left || q.left >= r.right || q.bottom <= r.top || q.top >= r.bottom; }); });
      ok('Mr. Fixit ring', `${w}px: the ring doesn't cover the footer text`, clear);
      await cw.close();
    }
  }


  // 10b. Call-time choices follow the Sydney clock (contact form uses the same rules as the chat)
  {
    const want = {
      '06:15': 'Urgent – call now|This morning|This afternoon|This evening|Anytime',
      '08:30': 'Right now|This morning|This afternoon|This evening|Tomorrow morning|Anytime',
      '10:00': 'Right now|Later this morning|This afternoon|This evening|Tomorrow morning|Anytime',
      '12:30': 'Right now|This afternoon|This evening|Tomorrow morning|Tomorrow afternoon|Anytime',
      '15:00': 'Right now|Later this afternoon|This evening|Tomorrow morning|Tomorrow afternoon|Anytime',
      '17:00': 'Right now|This evening|Tomorrow morning|Tomorrow afternoon|Tomorrow after 5pm|Anytime',
      '21:00': 'Tomorrow morning|Tomorrow afternoon|Tomorrow after 5pm|Urgent – call now'
    };
    for (const [hm, list] of Object.entries(want)) {
      const cx = await b.newContext(); await cx.clock.setFixedTime(new Date(`2026-10-25T${hm}:00+11:00`));
      const pg = await cx.newPage(); watch(pg, 'contact');
      await pg.goto(`${BASE}/contact.html`, { waitUntil: 'networkidle' });
      const got = (await pg.$$eval('select[name=best_time] option', o => o.map(x => x.value).filter(Boolean))).join('|');
      ok('Call times', `contact form at ${hm} Sydney time offers the right choices`, got === list, got);
      await cx.close();
    }
    // a visitor whose device is in another time zone still gets Sydney-time choices
    const cx = await b.newContext({ timezoneId: 'Europe/London' }); await cx.clock.setFixedTime(new Date('2026-10-25T17:00:00+11:00'));
    const pg = await cx.newPage(); watch(pg, 'contact');
    await pg.goto(`${BASE}/contact.html`, { waitUntil: 'networkidle' });
    const got = (await pg.$$eval('select[name=best_time] option', o => o.map(x => x.value).filter(Boolean))).join('|');
    ok('Call times', 'a visitor overseas (London device clock) still gets Sydney-time choices', got === want['17:00'], got);
    await cx.close();
  }

  // 11. Call-back reminder in the alerts (Add to Google Calendar + .ics)
  {
    const r = await p.request.post(`${BASE}/.netlify/functions/lead`, { data: { source: 'chat', channels: ['email', 'telegram'],
      lead: { name: 'Cal Test', phone: '0400 000 111', suburb: 'Castle Hill', postcode: '2154', lat: -33.73, lng: 151.0, service: 'Leak repair', best_time: 'This afternoon', summary: 'Calendar test' } } });
    const j = await r.json().catch(() => ({}));
    ok('Call reminder', 'enquiry with a best time to call goes through', r.status() === 200 || r.status() === 502, r.status());
    if (process.env.MOCK_OUT) {
      const fs = require('fs'), path = require('path');
      await new Promise(res => setTimeout(res, 800));
      const files = fs.readdirSync(process.env.MOCK_OUT).filter(f => f.endsWith('.bin')).map(f => path.join(process.env.MOCK_OUT, f));
      const tg = files.map(f => fs.readFileSync(f, 'utf8')).find(t => t.includes('Cal Test') && t.includes('"chat_id"') && !t.includes('"media"'));
      const em = files.map(f => fs.readFileSync(f, 'utf8')).find(t => t.includes('Cal Test') && t.includes('"subject"'));
      ok('Call reminder', 'Telegram alert has "Add call reminder to Google Calendar" with the time', !!tg && /Add call reminder to Google Calendar<\/a> \([A-Z][a-z]{2} \d+ [A-Za-z]+ \d{1,2}:\d{2}(am|pm)\)/.test(JSON.parse(tg).text) && /calendar\.google\.com\/calendar\/render\?action=TEMPLATE/.test(JSON.parse(tg).text));
      const e = em && JSON.parse(em);
      const ics = e && (e.attachments || []).find(a => /call-reminder\.ics$/.test(a.filename));
      const icsText = ics ? Buffer.from(ics.content, 'base64').toString() : '';
      ok('Call reminder', 'email has the Google Calendar button and a .ics calendar file', !!e && /Add to Google Calendar/.test(e.html) && /BEGIN:VEVENT/.test(icsText) && /DTSTART:\d{8}T\d{6}Z/.test(icsText) && /TRIGGER:-PT10M/.test(icsText), ics ? ics.filename : 'no ics');
    }
  }

  ok('Smoke', 'no JavaScript errors on any page', errors.length === 0, errors.slice(0, 5).join(' || '));
  await b.close();

  const pass = results.filter(r => r.pass).length;
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  [${r.area}] ${r.name}${r.detail !== '' ? '  (' + r.detail + ')' : ''}`);
  console.log(`\n${pass}/${results.length} passed`);
  require('fs').writeFileSync('e2e19.json', JSON.stringify(results, null, 1));
})();
