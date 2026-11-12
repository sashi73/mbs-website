// GKH Project Champ: automatic build numbers and the build registry.
// Runs from the git pre-commit hook (.githooks/pre-commit) on every commit:
//  1. adds 1 to "build" in champ-build.json
//  2. completes the previous row of BUILDS.md with that commit's id and title (it is HEAD at this moment)
//  3. adds a row for this build to BUILDS.md
//  4. writes netlify/lib/build-info.mjs (the Netlify build step overwrites it with the deploy details)
// and stages those three files, so they go into the same commit. The commit-msg hook then adds "Build: N" to the message.
// Turn it on in a clone with:  git config core.hooksPath .githooks   (npm install does this for you)
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const F = (p) => path.join(root, p);
const sh = (c) => { try { return execSync(c, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; } };
const sydney = (d = new Date()) => d.toLocaleString('en-AU', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
  .replace(/(\d+)\/(\d+)\/(\d+),?\s*/, '$3-$2-$1 ');

const info = JSON.parse(fs.readFileSync(F('champ-build.json'), 'utf8'));
info.build = (Number(info.build) || 0) + 1;
info.date = sydney();
info.branch = sh('git rev-parse --abbrev-ref HEAD') || '';
fs.writeFileSync(F('champ-build.json'), JSON.stringify(info, null, 2) + '\n');

// BUILDS.md: fill in the commit of the last row (still "this commit"), then add this build
let md = fs.readFileSync(F('BUILDS.md'), 'utf8');
const head = sh('git rev-parse --short HEAD'), subj = sh('git log -1 --format=%s').replace(/\|/g, '/').slice(0, 140);
if (head) md = md.replace(/\| (\d+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| _this commit_ \| _see git log_ \|/, (m, b, v, d, br) => `| ${b} | ${v}| ${d}| ${br}| \`${head}\` | ${subj} |`);
md = md.replace(/\s*$/, '\n') + `| ${info.build} | ${info.version}.${info.build} | ${info.date} | ${info.branch} | _this commit_ | _see git log_ |\n`;
fs.writeFileSync(F('BUILDS.md'), md);

fs.writeFileSync(F('netlify/lib/build-info.mjs'), `// Written by tools/build-bump.mjs (each commit) and tools/site-env.mjs (each Netlify deploy). Do not edit by hand.
export default ${JSON.stringify({ product: info.product, version: info.version, build: info.build, commit: '', branch: info.branch, deployId: '', context: 'local', builtAt: info.date, site: '' }, null, 2)};
`);
sh('git add champ-build.json BUILDS.md netlify/lib/build-info.mjs');
console.log(`Project Champ build ${info.build} (${info.version}.${info.build})`);
