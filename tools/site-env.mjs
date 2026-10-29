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
const BADGE = `<div id="${MARK}" role="note" aria-label="Test site" style="position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:2147483647;pointer-events:none;background:#ea580c;color:#fff;font:700 12px/1.2 system-ui,-apple-system,Segoe UI,Arial,sans-serif;letter-spacing:.06em;white-space:nowrap;padding:4px 14px 5px;border-radius:0 0 8px 8px;box-shadow:0 2px 6px rgba(0,0,0,.25)">🧪 TEST SITE · not the live website</div>` +
  `<style>html{box-shadow:inset 0 0 0 3px #ea580c}</style>`;

let pages = 0;
try {
  const files = [];
  for (const f of fs.readdirSync(root)) if (f.endsWith('.html')) files.push(path.join(root, f));
  const admin = path.join(root, 'admin');
  if (fs.existsSync(admin)) for (const f of fs.readdirSync(admin)) if (f.endsWith('.html')) files.push(path.join(admin, f));
  for (const f of files) {
    let h = fs.readFileSync(f, 'utf8');
    if (h.includes(MARK)) continue;
    h = h.replace(/<title>/i, '<title>TEST · ');
    h = h.replace(/<head>/i, '<head>\n<meta name="robots" content="noindex, nofollow">');
    h = h.replace(/<body([^>]*)>/i, (m) => m + '\n' + BADGE);
    fs.writeFileSync(f, h);
    pages++;
  }
  // Keep every search engine out of the whole test site
  fs.writeFileSync(path.join(root, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
  fs.writeFileSync(path.join(root, '_headers'), '/*\n  X-Robots-Tag: noindex, nofollow\n');
  console.log(`site-env: TEST site, ${pages} pages marked, search engines blocked`);
} catch (e) {
  // Never block a deploy because of the badge
  console.warn('site-env: could not mark the test site:', e.message);
}
