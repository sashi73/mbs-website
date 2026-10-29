// Runs on Netlify before every deploy (netlify.toml [build] command).
// Production (SITE_ENV not set): does nothing at all.
// Test site (SITE_ENV = test): marks every page with a TEST badge and keeps search engines out,
// so the test copy can never be mistaken for, or compete with, the live mbsplc.com.au.
import fs from 'node:fs';
import path from 'node:path';

const mode = String(process.env.SITE_ENV || '').trim().toLowerCase();
const root = path.resolve(process.argv[2] || '.');
if (mode !== 'test') {
  console.log('site-env: production build, nothing to change');
  process.exit(0);
}

const MARK = 'mbs-test-badge';

// v33: on the test site the admin console is branded Global Knowledge House: spinning-globe logo,
// GKH navy and blue, "AI-Powered Business Intelligence". The public website keeps the MBS brand.
// Change the words with CONSOLE_BRAND and CONSOLE_TAGLINE in Netlify; CONSOLE_BRAND = off turns it all off.
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const brand = String(process.env.CONSOLE_BRAND || 'Global Knowledge House').trim().slice(0, 60);
const tagline = String(process.env.CONSOLE_TAGLINE || 'AI-Powered Business Intelligence').trim().slice(0, 80);
const BRAND_ON = brand && brand.toLowerCase() !== 'off';
const LOGO = '../assets/gkh-globe.webp';
const SPIN = '.gkh-globe{border-radius:50%;animation:gkh-spin 80s linear infinite,gkh-glow 4s ease-in-out infinite}' +
  '@keyframes gkh-spin{to{transform:rotate(360deg)}}@keyframes gkh-glow{50%{filter:drop-shadow(0 0 7px rgba(255,190,80,.55))}}' +
  '@media (prefers-reduced-motion:reduce){.gkh-globe{animation:none}}';
const BRAND_CSS = '<style id="gkh-brand-css">' + SPIN +
  // GKH console: black and gold, so the globe melts into the background
  '.login-logo{width:112px;height:112px;margin:0 auto 2px;display:block}' +
  '.side-brand{gap:10px}.side-brand img{width:46px;height:46px;flex:none}' +
  '.side-brand span{display:grid;gap:2px;font-stretch:normal;font-size:14px;line-height:1.15;letter-spacing:.01em}' +
  '.side-brand span small{font:700 9.5px/1.2 Manrope,system-ui,Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#E8C04A}' +
  '.gkh-bar{display:flex;align-items:center;flex-wrap:wrap;gap:6px 14px;padding:10px 28px;background:linear-gradient(90deg,#000 0%,#0B0B0B 55%,#1A150A 100%);color:#EDEAE3;border-bottom:2px solid #C9A227}' +
  '.gkh-bar img{width:40px;height:40px;flex:none}' +
  '.gkh-bar b{font:800 19px/1.2 Archivo,system-ui,Arial,sans-serif;letter-spacing:.01em;color:#fff}' +
  '.gkh-bar span{font:700 12.5px/1.3 Manrope,system-ui,Arial,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#E8C04A}' +
  '.gkh-bar small{margin-left:auto;font:500 12px/1.3 Manrope,system-ui,Arial,sans-serif;color:#A39E92}' +
  '.gkh-tag{margin:-6px 0 6px;text-align:center;font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:11.5px;color:#E8C04A}' +
  '.login{background:radial-gradient(1000px 600px at 50% -10%,#2A2210 0%,#000 60%)}.login-card{background:#050505;border-color:#2A2416}' +
  '.login-card h1{text-align:center}' +
  '.gkh-pow{display:flex;align-items:center;justify-content:center;gap:7px;margin:4px 0 0;font-size:11.5px;font-weight:700;color:#CFC2A0}.gkh-pow img{width:24px;height:24px}' +
  '@media (max-width:700px){.gkh-bar{padding:8px 16px}.gkh-bar small{margin-left:0;flex-basis:100%}}' +
  '.login-card .gkh-chip{justify-self:center}' +
  '</style>';
// v33: the TEST marker on public pages is a slim GKH navy bar at the very top, left-aligned: spinning globe,
// "Powered by GKH · AI-Powered Business Intelligence" and a TEST SITE tag. It sits in the page (not floating),
// so it never covers the MBS header, buttons or Mr. Fixit, and scrolls away like the gold MBS bar below it.
const BAR_CSS = '<style id="gkh-testbar-css">' +
  '#mbs-test-badge.gkh-testbar{position:relative;z-index:61;display:flex;align-items:center;gap:10px;min-height:42px;padding:5px 18px;' +
  'background:linear-gradient(90deg,#000 0%,#0B0B0B 55%,#1A150A 100%);border-bottom:1px solid rgba(232,192,74,.35);color:#EDEAE3;' +
  'font-family:Manrope,system-ui,-apple-system,"Segoe UI",Arial,sans-serif;line-height:1.2;pointer-events:none}' +
  '#mbs-test-badge img{width:34px;height:34px;flex:none;display:block}' + SPIN +
  '#mbs-test-badge b{font-size:13.5px;font-weight:800;letter-spacing:.01em;color:#fff;white-space:nowrap}' +
  '#mbs-test-badge .gkh-t{font-size:10.5px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#E8C04A;white-space:nowrap}' +
  '#mbs-test-badge .gkh-dot{width:4px;height:4px;border-radius:50%;background:#6B5A2A;flex:none}' +
  '.gkh-chip{display:inline-flex;align-items:center;gap:6px;font-style:normal;font-size:10.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;' +
  'color:#FFD27A;border:1px solid rgba(255,210,122,.6);background:rgba(255,210,122,.08);border-radius:999px;padding:3px 10px 3px 8px;white-space:nowrap}' +
  '.gkh-chip::before{content:"";width:6px;height:6px;border-radius:50%;background:#FFC24D;box-shadow:0 0 0 3px rgba(255,194,77,.18)}' +
  '#mbs-test-badge .gkh-n{font-size:11.5px;color:#A39E92;white-space:nowrap}' +
  '@media (max-width:900px){#mbs-test-badge .gkh-n,#mbs-test-badge .gkh-n+.gkh-dot{display:none}}' +
  '@media (max-width:640px){#mbs-test-badge .gkh-t,#mbs-test-badge .gkh-t+.gkh-dot{display:none}#mbs-test-badge{padding:5px 12px;gap:8px}#mbs-test-badge img{width:28px;height:28px}}' +
  '@media print{#mbs-test-badge{display:none}}' +
  '</style>';
const testBar = () => `<div id="${MARK}" class="gkh-testbar" role="note" aria-label="Test site${BRAND_ON ? ', powered by GKH' : ''}">` +
  (BRAND_ON ? `<img src="/assets/gkh-globe.webp" class="gkh-globe" alt="" width="34" height="34"><b>Powered by GKH</b><span class="gkh-dot"></span><span class="gkh-t">${esc(tagline)}</span><span class="gkh-dot"></span>` : '') +
  `<em class="gkh-chip">Test site</em><span class="gkh-n">not the live website</span></div>`;
// console without the GKH branding (CONSOLE_BRAND = off): a small TEST SITE tag, top left
const ADMIN_PLAIN = `<div id="${MARK}" role="note" aria-label="Test site" style="position:fixed;top:8px;left:8px;z-index:2147483647;pointer-events:none"><em class="gkh-chip" style="background:#000">Test site</em></div>`;

function brandConsole(h) {
  const B = esc(brand), T = esc(tagline);
  h = h.replace(/<title>[^<]*<\/title>/i, `<title>${B} · ${T}</title>`);
  h = h.replace(/<link rel="icon"[^>]*>/i, `<link rel="icon" href="${LOGO}" type="image/svg+xml">`);
  h = h.replace(/<img src="\.\.\/assets\/mbs-logo\.svg"[^>]*class="login-logo"[^>]*>/i, `<img src="${LOGO}" alt="${B}" class="login-logo gkh-globe" width="112" height="112">`);
  h = h.replace(/<h1>MBS Console<\/h1>/i, `<em id="${MARK}" class="gkh-chip">Test site</em>\n    <h1>${B}</h1>\n    <p class="gkh-tag">${T}</p>`);
  h = h.replace(/(<a class="side-brand"[^>]*>)<img src="\.\.\/assets\/mbs-logo\.svg"[^>]*><span>Console<\/span>/i,
    `$1<img src="${LOGO}" alt="" class="gkh-globe" width="46" height="46"><span>${B}<small>${T}</small></span>`);
  h = h.replace(/(<div class="main">)/i, `$1\n    <div class="gkh-bar" role="banner"><img src="${LOGO}" alt="" class="gkh-globe" width="40" height="40"><b>${B}</b><span>${T}</span><em class="gkh-chip">Test site</em><small>Powered by GKH · Console for Modern Building Solutions</small></div>`);
  h = h.replace(/(<a class="back"[^>]*>[^<]*<\/a>)/i, `$1\n    <p class="gkh-pow"><img src="${LOGO}" alt="" class="gkh-globe" width="24" height="24">Powered by GKH · ${T}</p>`);
  return h.replace(/<\/head>/i, BRAND_CSS + '\n</head>');
}

let pages = 0;
try {
  const files = [];
  for (const f of fs.readdirSync(root)) if (f.endsWith('.html')) files.push(path.join(root, f));
  const admin = path.join(root, 'admin');
  if (fs.existsSync(admin)) for (const f of fs.readdirSync(admin)) if (f.endsWith('.html')) files.push(path.join(admin, f));
  for (const f of files) {
    let h = fs.readFileSync(f, 'utf8');
    if (h.includes(MARK)) continue;
    if (BRAND_ON && path.basename(f) === 'index.html' && path.basename(path.dirname(f)) === 'admin') h = brandConsole(h);
    h = h.replace(/<title>/i, '<title>TEST · ');
    h = h.replace(/<head>/i, '<head>\n<meta name="robots" content="noindex, nofollow">');
    const isAdmin = path.basename(path.dirname(f)) === 'admin';
    h = h.replace(/<\/head>/i, BAR_CSS + '\n</head>');
    if (isAdmin) { if (!h.includes(`id="${MARK}"`)) h = h.replace(/<body([^>]*)>/i, (m) => m + '\n' + ADMIN_PLAIN); }
    else if (/<div class="topbar"/i.test(h)) h = h.replace(/<div class="topbar"/i, (m) => testBar() + '\n' + m);
    else h = h.replace(/<body([^>]*)>/i, (m) => m + '\n' + testBar());
    fs.writeFileSync(f, h);
    pages++;
  }
  // Keep every search engine out of the whole test site
  fs.writeFileSync(path.join(root, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
  fs.writeFileSync(path.join(root, '_headers'), '/*\n  X-Robots-Tag: noindex, nofollow\n');
  console.log(`site-env: TEST site, ${pages} pages marked, search engines blocked${BRAND_ON ? `, console branded "${brand}"` : ""}`);
} catch (e) {
  // Never block a deploy because of the badge
  console.warn('site-env: could not mark the test site:', e.message);
}
