// MBS website: automated end-to-end test (90+ checks: SEO, pages, links, images, phone/tablet/desktop layouts,
// project filters, galleries, before & after sliders, Mr. Fixit, contact form, private files blocked).
// How to run (on your PC, in the site folder, with the site running via start-windows.bat):
//   npm install --no-save playwright
//   npx playwright install chromium
//   node tools/site-test.js                      (tests http://127.0.0.1:8888)
//   set SITE_URL=https://your-site & node tools/site-test.js    (tests another address)
// Note: the contact-form test sends one real test enquiry named "Automated Test" when your keys are set.

const { chromium } = require('playwright');
const BASE = (process.env.SITE_URL || 'http://127.0.0.1:8888').replace(/\/$/, '');
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
    p.on('console', m => { if (m.type() === 'error' && !(tag === 'contact' && /502/.test(m.text()))) errors.push(`${tag} console: ${m.text()}`); });
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
  const rb = await p.request.get(`${BASE}/robots.txt`); const rbt = await rb.text();
  ok('SEO', 'robots.txt is there and points to the sitemap', rb.status() === 200 && /Sitemap: https:\/\/www\.modernbuildingsolutions\.com\.au\/sitemap\.xml/.test(rbt));
  const sm = await p.request.get(`${BASE}/sitemap.xml`); const smt = await sm.text();
  ok('SEO', 'sitemap.xml lists all 5 pages', sm.status() === 200 && (smt.match(/<loc>/g) || []).length === 5);
  const nf = await p.request.get(`${BASE}/no-such-page.html`);
  ok('SEO', 'unknown address shows the 404 page (status 404)', nf.status() === 404 && /Page not/.test(await nf.text()), nf.status());

  ok('Smoke', 'no JavaScript errors on any page', errors.length === 0, errors.slice(0, 5).join(' || '));
  await b.close();

  const pass = results.filter(r => r.pass).length;
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  [${r.area}] ${r.name}${r.detail !== '' ? '  (' + r.detail + ')' : ''}`);
  console.log(`\n${pass}/${results.length} passed`);
  require('fs').writeFileSync('site-test-results.json', JSON.stringify(results, null, 1));
})();
