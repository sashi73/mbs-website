// GKH Project Champ: the "Champ skill". Champ (the website chatbot and 🎙 Ask Champ in the dashboard) must always know
// the console as it is NOW: the menu, the project tabs, the People tabs, the step-by-step guides, what was renamed and
// what changed lately. This script reads them from the real code and writes netlify/lib/champ-skill.mjs.
// It runs from the git pre-commit hook on every commit (and stages the file), so a rename in the code ("Schedule &
// Gantt" → "Gantt", "Project Intelligence" → "Ask AI") reaches Champ in the same commit, with no one having to remember.
//   node tools/gen-champ-skill.mjs          (by hand)
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (p) => { try { return fs.readFileSync(path.join(root, p), 'utf8'); } catch { return ''; } };
const plain = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

// 1. the menu (admin/index.html): headings and their items, with the page address
const html = read('admin/index.html'), menu = [];
const navPart = html.slice(html.indexOf('class="side-nav"'), html.indexOf('</nav>', html.indexOf('class="side-nav"')));
for (const m of navPart.matchAll(/<p class="side-h">([^<]+)<\/p>|<a href="(#[^"]+)" data-nav="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
  if (m[1]) menu.push({ h: plain(m[1]), items: [] });
  else if (menu.length) menu[menu.length - 1].items.push(`${plain(m[4])} (${m[2]})`);
}

// 2. the tabs of a project (admin/admin-plan.js: var tabs = [...])
const planJs = read('admin/admin-plan.js');
const tabsLine = (planJs.match(/var tabs = ([^\n]*)/) || [])[1] || '';
const tabs = [...tabsLine.matchAll(/\['(\w+)', '([^']+)'\]/g)].map((m) => `${m[2].replace(/^\W+\s*/, '')} (#plan/<project>/${m[1]})`);

// 3. the People tabs and Users & access roles
const pplJs = read('admin/admin-people.js');
const pplTabs = [...pplJs.matchAll(/data-ptab="(\w+)">([^<']+)/g)].map((m) => plain(m[2]));
const roles = (read('netlify/lib/users.mjs').match(/PICK_ROLES = \[([^\]]+)\]/) || [])[1] || '';

// 4. the step-by-step guides Ask Champ can show (admin/champ-guide.js)
const guideJs = read('admin/champ-guide.js'), guides = [];
for (const m of guideJs.matchAll(/\{ id: '(\w+)', t: '([^']+)', k: '[^']*',(?: owner: 1,)? steps: \[([\s\S]*?)\] \}/g)) {
  const says = [...m[3].matchAll(/say: '((?:[^'\\]|\\.)*)'/g)].map((x) => x[1].replace(/\\'/g, "'"));
  guides.push(`${m[2]}: ${says.join(' Then: ')}`);
}

// 5. renamed or removed (old name → what it is now): Champ must never say "I don't know" about an old name
const RENAMED = [
  ['Schedule & Gantt (project tab)', 'Gantt'],
  ['Project Intelligence (project tab)', 'Ask AI (the 🧠 Ask AI tab inside a project)'],
  ['Budget / Budgeting', 'Costing (💰 Costing tab; approve it with a signed budget)'],
  ['Quote and plan', 'Costing and the project charter / project plan documents'],
  ['Inventory, stock, re-order', 'removed: the BOM shows "🛒 Things to order" with order-by dates instead'],
  ['Sub-contractor logins', 'Contractor logins (Users & access)'],
  ['Owner (login)', 'Project manager (super user), the Netlify login'],
  ['Cooling-off and emergency changes', 'removed from change control'],
  ['Next 14 days (overview card)', 'This week (7 days)'],
  ['Payroll', 'not part of Project Champ (People has a calendar and workload instead)'],
];

// 6. what changed lately (BUILDS.md, newest first)
const recent = read('BUILDS.md').split('\n').filter((l) => /^\| \d+ \|/.test(l)).map((l) => l.split('|').map((x) => x.trim()))
  .filter((c) => c[6] && c[6] !== '_see git log_').slice(-30).reverse().map((c) => `build ${c[1]} (${c[3].slice(0, 10)}): ${c[6]}`);

const text = `CONSOLE MAP (generated from the code on every change; trust it over anything older):
Menu: ${menu.map((g) => `${g.h}: ${g.items.join(', ')}`).join(' | ')}
Inside a project, the tabs are: ${tabs.join(', ')}. Above them: the documents bar (💰 Work out the costing, 📜 Generate the charter, 📘 Generate the project plan) and the project tools (⚙ Modules, Costing, Re-set baseline, Wide view, Excel, Gantt export, Print, Delete project; on a phone under ⋯ More).
People tabs: ${pplTabs.join(', ')}. People: two groups (Technical & general; Construction), credentials, resume (✨ fill a person in from a PDF or Word resume), rate per hour; My profile for everyone; only the project manager (super user) adds people.
Users & access: the project manager (super user) makes logins by email with a password, confirms, then sets permissions; roles ${roles.replace(/'/g, '')}; Google sign-ins are view only.
Ask Champ (🎙 bottom right; the middle of the bottom bar on a phone): tap the mic or type; ☰ menu; it shows where to click with a pointer and reads it aloud, in the console's language.
Step-by-step guides Ask Champ can show:
- ${guides.join('\n- ')}
RENAMED OR REMOVED (when someone uses an old name, tell them the new one and where it is; never say you don't know it):
- ${RENAMED.map((r) => `${r[0]} → ${r[1]}`).join('\n- ')}
WHAT CHANGED LATELY (newest first):
- ${recent.join('\n- ')}`;

// the short version for the website chatbot (its whole answer must stay within about 2000 tokens): tabs and renames only
const short = `Inside a project the tabs are now: ${tabs.map((t) => t.replace(/ \(#[^)]*\)/, '')).join(', ')}. Renamed or removed (give the new name, never say you don't know): ${RENAMED.map((r) => `${r[0]} → ${r[1]}`).join('; ')}.`;
fs.writeFileSync(path.join(root, 'netlify/lib/champ-skill.mjs'), `// The "Champ skill": what Champ knows about the console right now. GENERATED by tools/gen-champ-skill.mjs from the
// real code on every commit (git pre-commit hook). Do not edit by hand: change the code (or RENAMED in the script).
export const SKILL = ${JSON.stringify(text)};
export const SKILL_SHORT = ${JSON.stringify(short)};
export const GUIDES = ${JSON.stringify(guides.length)};
`);
try { execSync('git add netlify/lib/champ-skill.mjs', { cwd: root, stdio: 'ignore' }); } catch {}
console.log(`Champ skill: ${menu.reduce((n, g) => n + g.items.length, 0)} menu items, ${tabs.length} project tabs, ${guides.length} guides, ${recent.length} recent changes`);
