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
    if (/PMO lead running a lessons-learned review/.test(sys)) {   // 📘 lessons from the project's history
      const u = JSON.parse(j.messages[1].content); global.LL_FACTS = u.facts;
      const o = { lessons: [{ title: 'Lock the vendor adapter date before the build', category: 'Vendors and procurement', phase: 'Build', impact: 'negative', what: 'The build finished 12 days late.', cause: 'No penalty clause', rec: 'Agree delivery dates with penalties', evidence: 'Build phase' }, { title: 'Daily stand-ups kept design on time', category: 'Communication', phase: 'Design', impact: 'positive', what: 'Design finished on the baseline.', cause: 'Short feedback loops', rec: 'Keep daily stand-ups', evidence: 'Design phase' }] };
      s2.setHeader('Content-Type', 'application/json'); return s2.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(o) } }], usage: { total_tokens: 1200 } }));
    }
    if (/senior PMO consultant writing a lessons-learned report/.test(sys)) {
      const u = JSON.parse(j.messages[1].content); global.LL_REP = u;
      const o = { title: 'Payments portal: lessons learned', subtitle: 'What the portal taught us', headline: 'Delivered late because the vendor adapter slipped.', story: ['We set out to build a portal.', 'The build slipped.', 'It is now in testing.'],
        went_well: [{ title: 'Design on time', detail: 'Daily stand-ups.', icon: 'check' }], went_wrong: [{ title: 'Vendor adapter late', detail: '12 days late.', cause: 'No penalty clause', cause_category: 'Vendors', icon: 'warning' }],
        recommendations: [{ title: 'Put penalties in vendor contracts', detail: 'Tie payments to dates.', owner: 'PMO', when: 'At procurement', applies_to: 'Integration projects' }], reuse: ['Check vendor delivery dates'], quote: 'Dates without consequences are wishes.',
        video: { title: 'The late adapter', scenes: [{ icon: 'calendar', caption: 'The plan', say: 'We planned twelve weeks.' }, { icon: 'warning', caption: 'The adapter slipped', say: 'The vendor was late.' }, { icon: 'idea', caption: 'The lesson', say: 'Agree dates with penalties.' }] } };
      s2.setHeader('Content-Type', 'application/json'); return s2.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(o) } }], usage: { total_tokens: 5000 } }));
    }
    if (/senior project manager and business analyst \(PMP, BABOK\)/.test(sys)) {   // 📁 one document against the plan
      const u = JSON.parse(j.messages[1].content); global.DMS_DOC = u.document; global.DMS_PROJECT = u.project;
      const o = { type: 'BRD', summary: 'The BRD asks for card payments and a reporting dashboard by 30 June.', key_points: ['Go-live 30 June'], requirements: [{ item: 'Card payments through a payment gateway', in_plan: 'no', task: '', note: 'not planned' }, { item: 'Design of the screens', in_plan: 'yes', task: '1', note: '' }],
        conflicts: [{ what: 'Go-live date', document: '30 June', plan: 'later', impact: 'High' }], gaps: ['No payment gateway integration task'], risks: [{ title: 'Payment gateway certification takes 8 weeks', cause: 'PCI DSS', p: 4, i: 4, action: 'Start certification early' }],
        tasks: [{ name: 'Integrate the payment gateway', phase: 'Work', days: 10, why: 'BRD 4.2' }], actions: ['Agree the go-live date with the sponsor'], alignment: 'partly aligned', alignment_why: 'Payments are missing from the plan.' };
      s2.setHeader('Content-Type', 'application/json'); return s2.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(o) } }], usage: { total_tokens: 1500 } }));
    }
    if (/PMO lead auditing a project's document repository/.test(sys)) {
      const u = JSON.parse(j.messages[1].content); global.DMS_SET = u.documents;
      const o = { summary: 'Requirements are covered; there is no test strategy.', coverage: [{ area: 'Requirements', status: 'good', note: 'BRD v2' }, { area: 'Testing', status: 'missing', note: 'none' }], missing: ['A test strategy'], conflicts: [{ between: 'BRD vs the plan', what: 'Go-live date differs', impact: 'High' }], stale: [], actions: ['Write a test strategy'] };
      s2.setHeader('Content-Type', 'application/json'); return s2.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(o) } }], usage: { total_tokens: 900 } }));
    }
    if (/senior project scheduler \(PMBOK precedence/.test(sys)) {   // 🔗 the dependencies: 2 and 3 can run side by side, 4 needs both
      const u = JSON.parse(j.messages[1].content); global.DEPS_USER = u;
      const o = { links: [{ n: 1, after: [], why: 'Starts the project' }, { n: 2, after: [1], why: 'Needs the design' }, { n: 3, after: [1], why: 'Needs the design, not the build' }, { n: 4, after: [2, 3], why: 'Needs the build and the content' }, { n: 4, after: [4], why: 'loop' }], summary: 'Build and content can run in parallel after the design.' };
      s2.setHeader('Content-Type', 'application/json'); return s2.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(o) } }], usage: { total_tokens: 700 } }));
    }
    if (/project-monitoring agent/.test(sys)) {   // 🩺 Champ's brief on a project
      const u = JSON.parse(j.messages[1].content); global.WATCH_CALLS = (global.WATCH_CALLS || 0) + 1; global.WATCH_USER = u; global.WATCH_SYS = sys;
      const lt = (u.numbers.late_tasks[0] || {}).name || 'the late work';
      const o = u.health === 'green' ? { headline: 'On track. Keep an eye on it.', summary: 'Schedule and cost are on plan.', actions: [{ title: 'Keep progress up to date weekly', detail: 'Update % complete and actual costs every Friday.' }], watch: ['Supplier lead times'], class_note: '' }
        : { headline: `Heads up: ${u.project} is ${u.numbers.slip_days} days late and running at CPI ${u.numbers.CPI}.`, summary: 'Work is behind and costing more than planned.', actions: [{ title: 'Crash the critical path', detail: `Add a second team to ${lt}.` }, { title: 'Raise a change request and re-baseline', detail: 'Agree the new finish with the sponsor.' }, { title: 'Escalate the critical issue', detail: 'Take it to the steering committee this week.' }], watch: ['Contractor rates'], class_note: '' };
      s2.setHeader('Content-Type', 'application/json'); return s2.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(o) } }], usage: { total_tokens: 900 } }));
    }
    if (/project document analyst/.test(sys)) {   // 📄 a project from a document: answers only from what the retrieval gave it
      const u = JSON.parse(j.messages[1].content), x = u.extracts || '', m = (re) => ((x.match(re) || [])[1] || '').trim();
      global.INGEST = (global.INGEST || []).concat([{ len: x.length, whole: u.given_whole, given: u.chunks_given, total: u.chunks_total, p87: /\[p\. 87\]/.test(x), p64: /\[p\. 64\]/.test(x), p1: /\[p\. 1\]/.test(x), doc: u.document }]);
      const name = m(/(Northside Health ERP Modernisation|Library Digitisation Project|Fleet EV Transition)/);
      const o = { name, client: m(/Prepared for ([^\n]+)/) || m(/Client: ([^\n.]+)/), sponsor: m(/(?:Project s|S)ponsor: ([^\n.]+)/), site: m(/head office in ([A-Za-z]+, NSW)/) || m(/Location: ([^\n.]+)/), start_date: /Jan to Mar 2027/.test(x) ? '2027-01-11' : '', finish_date: /30 June 2027/.test(x) ? '2027-06-30' : '',
        budget: m(/budget is (AUD [\d.]+ million)/), project_type: 'ERP implementation', summary: name + ' replaces 18-year-old finance, HR, payroll and supply systems across 14 sites with one cloud ERP, to cut month-end close from 12 to 5 days and go live by 30 June 2027.',
        brief: { objectives: ['One cloud ERP for finance, HR, payroll and supply', 'Month-end close in 5 days'], in_scope: ['Finance', 'HR and payroll', 'Supply chain'], out_of_scope: ['Clinical systems'], deliverables: ['Configured ERP', 'Trained staff'],
          phases: [{ name: 'Discovery and design', when: 'Jan to Mar 2027', what: 'Requirements and design' }, { name: 'Build and configure', when: 'Apr to May 2027' }, { name: 'Test and train', when: 'May to Jun 2027' }, { name: 'Go-live and hypercare', when: 'Jul 2027' }],
          milestones: [{ name: 'Go-live', date: '30 June 2027' }], stakeholders: [{ who: 'Steering committee', role: 'Meets monthly' }], requirements: [], constraints: ['Go live by 30 June 2027'], assumptions: [], risks: ['Data migration quality'], success_criteria: ['Close in 5 days'], budget_notes: 'Includes 10% contingency' },
        doc_kind: /Library/.test(name) ? 'requirements' : 'other', pages: { sponsor: [87], budget: [64], client: [1] }, confidence: 'high', gaps: ['Who is the project manager?'] };
      s2.setHeader('Content-Type', 'application/json'); return s2.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(o) } }], usage: { total_tokens: Math.round(x.length / 3.6) + 900 } }));
    }
    if (/Build a practical WATERFALL project plan/.test(sys)) {   // ✨ the AI plan
      global.PLAN_USER = j.messages[1].content; global.PLAN_SYS = sys;
      const o = { name: 'ERP Modernisation', objective: 'One cloud ERP', in_scope: ['Finance'], out_of_scope: ['Clinical'], deliverables: ['ERP'], acceptance: 'Signed off', assumptions: [], tips: ['Book testers early'],
        tasks: [{ ph: 'Discovery and design', n: 'Requirements workshops', d: 10, after: [], q: 80, u: 'h', r: 150, b: 'p. 95' }, { ph: 'Build and configure', n: 'Configure finance', d: 20, after: [1], q: 160, u: 'h', r: 150 }, { ph: 'Go-live and hypercare', n: 'Go-live', d: 0, after: [2] }],
        risks: [['Data migration quality', 'Old data', 3, 4, 'Mitigate', 'Cleanse early']] };
      s2.setHeader('Content-Type', 'application/json'); return s2.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(o) } }], usage: { total_tokens: 3000 } }));
    }
    if (/Scrum Master and Agile coach/.test(sys)) { s2.setHeader('Content-Type', 'application/json'); return s2.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ sprints: [{ id: 'S1', items: ['m0', 'm1', 'm2', 'zz'], goal: 'People can sign in and manage their profile', objective: 'Login and profile pass UAT', verdict: 'achievable', assessment: '10 of ~10 pts, all ready' }, { id: 'S2', items: ['m3', 'm0'], goal: 'People can pay in the app', objective: 'A test payment clears', verdict: 'risky', assessment: 'Payments is 8 pts' }], refine: [{ id: 'm3', why: 'Split it' }], advice: 'Split Payments' }) } }], usage: { total_tokens: 90 } })); }
    if (/Definition of Ready/.test(sys)) { s2.setHeader('Content-Type', 'application/json'); return s2.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ desc: 'Book the venue for the offsite and confirm the date. Done when: deposit paid; booking confirmed in writing.', points: 6, priority: 'high', days: 4, story_points: [3, 4], new_stories: [{ name: 'Shortlist three venues', points: 2 }, { name: 'Pay the deposit', points: 1 }] }) } }], usage: { total_tokens: 90 } })); }
    if (j.response_format && /Project Management Plan/.test(sys)) {   // the project plan narrative: three parts
      const task = JSON.parse(j.messages[1].content).task; global.PLANDOC_SYS = sys; global.PLANDOC_CALLS = (global.PLANDOC_CALLS || 0) + 1; global.PLANDOC_MAX = Math.max(global.PLANDOC_MAX || 0, j.max_tokens || 0);
      const ms = /Bahasa Melayu/.test(sys), w = (en, m) => (ms ? m : en), lorem = (n) => Array.from({ length: n }, (_, i) => w('The project team will deliver this work on time and on budget, with **clear governance** and weekly reporting to the sponsor.', 'Pasukan projek akan menyiapkan kerja ini tepat pada masanya dan dalam bajet, dengan **tadbir urus yang jelas** dan laporan mingguan kepada penaja.')).join(' ');
      let o = {};
      if (/executive_summary/.test(task)) o = { executive_summary: lorem(6), background: lorem(3), scope_statement: lorem(3), approach: lorem(2) + '\n- ' + w('Discovery', 'Penemuan') + '\n- ' + w('Delivery', 'Penyampaian'), objectives: [{ objective: w('Deliver the ESG strategy by the finish date', 'Siapkan strategi ESG'), measure: w('Signed off by the board', 'Diluluskan oleh lembaga') }, { objective: 'Stay within budget', measure: 'CPI at or above 0.95' }],
        success_criteria: ['Board sign-off', 'Within budget', 'Staff trained'], assumptions: ['Client data arrives on time'], constraints: ['Fixed finish date'], deliverables: [{ deliverable: 'ESG roadmap', description: 'Costed roadmap', acceptance: 'Signed off' }] };
      else if (/schedule_management/.test(task)) o = { schedule_management: lorem(5), cost_management: lorem(5), resource_management: lorem(3), roles: [{ role: 'Project sponsor', responsibilities: 'Owns the business case' }, { role: 'Project manager', responsibilities: 'Runs the project' }],
        communication_plan: [{ audience: 'Sponsor', information: 'Status report', method: 'Email', frequency: 'Weekly', owner: 'PM' }, { audience: 'Team', information: 'Stand-up', method: 'Teams', frequency: 'Daily', owner: 'PM' }], stakeholder_engagement: lorem(3) };
      else o = { risk_management: lorem(4), quality_management: lorem(3), quality_checks: [{ deliverable: 'Roadmap', standard: 'GRI', check: 'Peer review' }], change_control: lorem(3), procurement: lorem(2), governance: lorem(3), governance_forums: [{ forum: 'Steering committee', members: 'Sponsor, PM', frequency: 'Monthly', purpose: 'Decisions' }], closure: lorem(3), next_steps: ['Kick-off meeting', 'Data request'] };
      s2.setHeader('Content-Type', 'application/json');
      return s2.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(o) } }], usage: { total_tokens: 4200 } }));
    }
    if (j.response_format && /You read a resume/.test(sys)) {   // ✨ People: fill in from a resume
      let u = {}; try { u = JSON.parse((j.messages.filter((m) => m.role === 'user').pop() || {}).content || '{}'); } catch (e) {} global.CV_TEXT = u.resume || '';
      const seen = /Aisha Rahman/.test(u.resume || '') && /PMP/.test(u.resume || '');
      const o = { name: seen ? 'Aisha Rahman' : 'NOT READ', email: 'aisha.rahman@example.com', phone: '0412 345 678', suburb: 'Parramatta', linkedin: 'linkedin.com/in/aisharahman', group: 'Technical & general', role: 'Project manager', rate: 120,
        education: [{ qual: 'MBA', inst: 'Monash University', year: '2015' }], quals: [{ name: 'PRINCE2 Practitioner', year: '2018' }], certs: [{ name: 'PMP', issuer: 'PMI', number: '1234567', expiry: '2027-06-30' }], summary: 'Twelve years running IT projects.' };
      s2.setHeader('Content-Type', 'application/json'); return s2.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(o) } }] }));
    }
    if (j.response_format && /You are Champ, the guide/.test(sys)) {   // 🎙 Ask Champ in the dashboard
      let u = {}; try { u = JSON.parse((j.messages.filter((m) => m.role === 'user').pop() || {}).content || '{}'); } catch (e) {} global.GUIDE_CTX = u;
      if (u.course_notes && /scope creep/i.test(u.question || '')) { const o5 = { tour: '', how: false, answer: 'As Sashi teaches in his classes: ' + (u.course_notes.map((x) => x.text).join('\n').split('\n').find((l) => /change control/.test(l)) || '') };
        s2.setHeader('Content-Type', 'application/json'); return s2.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(o5) } }] })); }
      if (/dependenc/i.test(u.question || '')) { const D = ((u.portfolio || {}).dependencies || []).filter((x) => !u.open_project_core || x.from_core === u.open_project_core || x.to_core === u.open_project_core);
        const o3 = { tour: 'deps', how: false, answer: D.length ? D.map((x) => x.from + ' → ' + x.to + ' (' + x.type + ', ' + x.status + ')').join('; ') : 'No dependencies recorded.' };
        s2.setHeader('Content-Type', 'application/json'); return s2.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(o3) } }] })); }
      if (/Project Intelligence|Schedule & Gantt/i.test(u.question || '')) { const m = /Project Intelligence \(project tab\) → ([^\n]+)/.exec(sys), g = /Schedule & Gantt \(project tab\) → ([^\n]+)/.exec(sys);
        const o2 = { tour: '', how: false, answer: m && g ? 'Project Intelligence is now ' + m[1] + ', and Schedule & Gantt is now ' + g[1] + '.' : 'I do not know.' };
        s2.setHeader('Content-Type', 'application/json'); return s2.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(o2) } }] })); }
      const o = /late/i.test(u.question) ? { tour: 'critical', how: false, answer: 'To recover: crash the critical tasks (more crew or overtime, at extra cost) or fast-track them in parallel (more risk).' + (u.project ? ' Your plan finishes ' + u.project.finish + '.' : '') } : { tour: '', how: false, answer: 'A charter authorises the project.' };
      s2.setHeader('Content-Type', 'application/json'); return s2.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(o) } }] }));
    }
    if (j.response_format && /project intelligence assistant/i.test(sys)) {
      global.INTEL_Q = JSON.parse(j.messages[1].content).question; global.INTEL_CTX = JSON.parse(j.messages[1].content);
      if (global.INTEL_CTX.course_notes && /scope creep/i.test(global.INTEL_Q)) { global.INTEL_SYS = sys; s2.setHeader('Content-Type', 'application/json'); return s2.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ answer: 'As Sashi teaches in his project management classes, every change goes through the change control board.', risks: [], stakeholders: [], meeting: null, sources: [], follow_ups: [] }) } }], usage: { total_tokens: 500 } })); }
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
    if (global.AZ_FAIL) { s3.statusCode = global.AZ_FAIL; return s3.end(''); }   // 🔇 Azure turning the key down
    global.LAST_SSML = b; global.ALL_SSML = (global.ALL_SSML || []).concat(b).slice(-40); global.AZ_KEY = q.headers['ocp-apim-subscription-key']; s3.setHeader('Content-Type', 'audio/mpeg'); s3.end(Buffer.from('ID3fakeaudio')); }); }).listen(0);
  // ☁️ a stand-in for Cloudflare R2 (S3 API): signed PUT/GET/HEAD/DELETE and list-type=2, with CORS for the browser
  global.R2S = new Map(); global.R2_UNSIGNED = 0;
  const r2srv = http.createServer((q, s4) => { const ch = []; q.on('data', (d) => ch.push(d)); q.on('end', () => {
    s4.setHeader('Access-Control-Allow-Origin', '*'); s4.setHeader('Access-Control-Allow-Methods', 'GET,PUT,HEAD'); s4.setHeader('Access-Control-Allow-Headers', '*'); s4.setHeader('Access-Control-Expose-Headers', 'ETag');
    if (q.method === 'OPTIONS') { s4.statusCode = 204; return s4.end(); }
    const u = new URL(q.url, 'http://x'), signed = u.searchParams.has('X-Amz-Signature') || /^AWS4-HMAC-SHA256 Credential=r2-test-id\//.test(q.headers.authorization || '');
    if (!signed) { global.R2_UNSIGNED++; s4.statusCode = 403; return s4.end('<Error><Code>AccessDenied</Code></Error>'); }
    const parts = decodeURIComponent(u.pathname).replace(/^\//, '').split('/'), bucket = parts.shift(), key = parts.join('/');
    if (bucket !== 'gkh-test') { s4.statusCode = 404; return s4.end(); }
    if (!key && q.method === 'GET') { const pre = u.searchParams.get('prefix') || ''; const xs = [...global.R2S].filter(([k]) => k.startsWith(pre));
      s4.setHeader('Content-Type', 'application/xml'); return s4.end('<ListBucketResult>' + xs.map(([k, v]) => `<Contents><Key>${k}</Key><Size>${v.body.length}</Size></Contents>`).join('') + '<IsTruncated>false</IsTruncated></ListBucketResult>'); }
    if (q.method === 'PUT') { global.R2S.set(key, { body: Buffer.concat(ch), type: q.headers['content-type'] || '' }); s4.setHeader('ETag', '"x"'); return s4.end(); }
    if (q.method === 'DELETE') { global.R2S.delete(key); s4.statusCode = 204; return s4.end(); }
    const o = global.R2S.get(key); if (!o) { s4.statusCode = 404; return s4.end(); }
    s4.setHeader('Content-Type', o.type || 'application/octet-stream'); s4.setHeader('Content-Length', o.body.length);
    const cd = u.searchParams.get('response-content-disposition'); if (cd) s4.setHeader('Content-Disposition', cd);
    s4.end(q.method === 'HEAD' ? undefined : o.body); }); }).listen(0);
  await sleep(100);
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NETLIFY_BLOBS_CONTEXT: ctxB64, ADMIN_USERNAME: '', ADMIN_PASSWORD: '', ADMIN_SESSION_SECRET: '',
    GOOGLE_CLIENT_ID: CLIENT, GOOGLE_TOKENINFO_URL: `http://127.0.0.1:${g.address().port}/tokeninfo`, LLM_API_KEY: 'test-key', CHAMP_I18N_LIMIT: '400', LIMIT_ADMIN: '5000/10', LLM_BASE_URL: `http://127.0.0.1:${llm.address().port}`, LLM_MODEL: 'deepseek-chat', TELEGRAM_BOT_TOKEN: '', AZURE_SPEECH_KEY: 'az-test', AZURE_SPEECH_BASE: `http://127.0.0.1:${az.address().port}`, AZURE_STT_ENDPOINT: `http://127.0.0.1:${az.address().port}`, RESEND_API_KEY: '', SITE_ENV: '', R2_ACCOUNT_ID: 'acct-test', R2_BUCKET: 'gkh-test', R2_ACCESS_KEY_ID: 'r2-test-id', R2_SECRET_ACCESS_KEY: 'r2-test-secret', R2_ENDPOINT: `http://127.0.0.1:${r2srv.address().port}` };
  const srv = spawn('node', ['local-server.mjs'], { cwd: SITE, env, stdio: ['ignore', 'pipe', 'pipe'] }); global.SRV = srv;
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 60 && !/running/i.test(log); i++) await sleep(150);

  const b = await chromium.launch({ executablePath: fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined, args: ['--use-fake-device-for-media-stream'] });
  const ctx = await b.newContext({ viewport: { width: 1366, height: 900 } });
  await ctx.route(/images\.unsplash\.com|accounts\.google\.com/, (r) => r.abort());   // no internet in the test
  await ctx.addInitScript(() => { if (!/intro=1/.test(location.search)) try { sessionStorage.setItem('champIntroSeen', '1'); } catch (e) {} });   // the intro has its own checks
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(p.url() + ' :: ' + e.message + ' @ ' + String(e.stack || '').split('\n').slice(1, 3).join(' | ')));
  const api = (action, data = {}, headers = { 'X-MBS-Admin': '1' }) => p.request.post(`${BASE}/.netlify/functions/admin`, { data: { action, ...data }, headers });
  // a project run as Kanban with every task on the board (for the tests of the board itself)
  const toKanban = async (core) => { const pl = (await (await api('planGet', { core })).json()).plan; if (!pl) return; pl.agile = { method: 'kanban', wip: { todo: 90, doing: 90, review: 90 }, cycle: 14, sprints: [] }; pl.tasks.forEach((t) => { if (t.dur > 0) t.ag = 'board'; }); const sr = await api('planSave', { core, plan: pl, rev: pl.rev }); if (!sr.ok) console.log('toKanban save', sr.status, (await sr.text()).slice(0, 200)); };

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
  ok('Intro', 'start screen has a language picker (English first)', (await p.inputValue('[data-ci-lang]')) === 'en' && (await p.$$('[data-ci-lang] option')).length === 20);
  await p.selectOption('[data-ci-lang]', 'ta'); await sleep(1500);
  ok('Intro', 'the start screen switches to Tamil', /\[Tamil\] Tap to enter/.test(await p.textContent('.ci-start')), (await p.textContent('.ci-start')).slice(0, 120));
  ok('Intro', 'the website switches to Tamil too', (await p.getAttribute('html', 'lang')) === 'ta');
  await p.click('[data-ci-skip]'); await sleep(900);
  await p.click('#champChatBtn'); await sleep(2000);
  const lgi = await p.textContent('.cc-log');
  ok('Intro', 'Champ greets in Tamil and asks (yes or no) whether they would like to share their details', /\[Tamil\] Greetings! I\u2019m Champ\. I\u2019ll speak with you in தமிழ்/.test(lgi) && /\[Tamil\] We\u2019d love to keep in touch/.test(lgi) && (await p.$$('[data-ob=cy]')).length === 1 && (await p.$$('[data-ob=cn]')).length === 1 && (await p.$$('.cc-form')).length === 0 && (await p.$$('.cc-ob-langs button')).length === 0, lgi.slice(0, 220));
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
  ok('Ask box', 'no questions first (no language, no details): then "Do you have any other questions?" yes / main menu', !/Which language|keep in touch/.test(lab) && /Do you have any other questions\?/.test(lab) && (await p.$$('.cc-fu [data-fu]')).length === 2, lab.slice(-200));
  await p.click('.cc-fu [data-fu=y]'); await sleep(300);
  ok('Ask box', '"Yes, another question" invites the next question', /Go ahead: type or say your question/.test(await p.textContent('.cc-log')) && (await p.$$('.cc-fu')).length === 0);
  await p.fill('.cc-f textarea', 'What is a RAID log?'); await p.keyboard.press('Enter'); await sleep(1500);
  await p.click('.cc-fu [data-fu=n]'); await sleep(400);
  ok('Ask box', '"No, show me the main menu" brings up the main menu', (await p.$$('.cc-menu .cc-menu-list button')).length === 10);
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

  // ---- Champ's welcome: "would you like to share your details?" yes → the form (PDPA, welcome pack tick) → thanks + main menu; no → the main menu ----
  await p.goto(`${BASE}/index.html`);
  await p.evaluate(() => { HTMLMediaElement.prototype.play = function () { return Promise.resolve(); }; });
  global.LAST_SSML = '';
  await p.click('#champChatBtn'); await p.waitForSelector('#champChat:not([hidden])'); await sleep(900);
  let lgw = await p.textContent('.cc-log');
  ok('Welcome', 'Champ opens with "We’d love to keep in touch. Would you be comfortable sharing your details?" and Yes / No, no language question', /Hi, I’m Champ/.test(lgw) && /We’d love to keep in touch\. Would you be comfortable sharing your details with us\?/.test(lgw) && (await p.$$('[data-ob=cy]')).length === 1 && (await p.$$('[data-ob=cn]')).length === 1 && (await p.$$('.cc-ob-langs button')).length === 0 && !/Which language/.test(lgw), lgw.slice(0, 200));
  ok('Welcome', 'the greeting is spoken, without emoji', /en-AU-NatashaNeural/.test(global.LAST_SSML || '') && /keep in touch/.test(global.LAST_SSML || '') && !/👋|🎤/.test(global.LAST_SSML || ''), (global.LAST_SSML || '').slice(-200));
  const lo = await p.evaluate(() => ['Malayu', 'Bahasa Malaysia', 'Thamil', 'Tamill.', 'Persian please', 'Germen', 'hello there', 'தமிழ்'].map((t) => window.ChampChat.langOf(t)));
  ok('Voice', 'the language is picked from what was heard, even slightly off ("Malayu", "Thamil", "Germen")', lo.join(',') === 'ms,ms,ta,ta,fa,de,,ta', lo.join(','));
  global.LAST_SSML = ''; await p.request.post(`${BASE}/.netlify/functions/tts`, { data: { text: 'Hello 👋 team 🎤 ready ✅', lang: 'en' } });
  ok('Voice', 'emoji are never read aloud', /Hello team ready/.test(global.LAST_SSML || '') && !/👋|🎤|✅/.test(global.LAST_SSML || ''), (global.LAST_SSML || '').slice(-120));
  ok('Welcome', 'no main menu yet, just the yes / no', (await p.$$('.cc-menu-list button')).length === 0 && (await p.$$('.cc-bot .cc-mlink')).length === 0);
  await p.click('[data-ob=cn]'); await sleep(600);
  lgw = await p.textContent('.cc-log');
  ok('Welcome', '"No, thanks": straight to the main menu, nothing asked', /No problem at all/.test(lgw) && (await p.$$('.cc-menu .cc-menu-list button')).length === 10 && (await p.$$('.cc-form')).length === 0 && (await p.evaluate(() => window.ChampChat.visitor().step)) === 'done');
  await p.click('.cc-menu-list button:has-text("Introduce myself")'); await sleep(500);
  ok('Welcome', '"Introduce myself" opens the form', (await p.$$('.cc-form')).length === 1);
  await p.fill('.cc-f textarea', 'switch to Tamil'); await p.keyboard.press('Enter'); await sleep(2000);
  lgw = await p.textContent('.cc-log');
  ok('Welcome', '"switch to Tamil": the form and its words switch to Tamil', (await p.inputValue('.cc-lang')) === 'ta' && /\[Tamil\] First name/.test(await p.textContent('.cc-form')) && /\[Tamil\] Lovely\. Could you pop your details/.test(lgw), lgw.slice(-200));
  ok('Welcome', 'the PDPA notice and consent tick are on the form, with a link to the privacy notice; the welcome pack is a tick (ticked)', /PDPA/.test(await p.textContent('.cc-pdpa')) && (await p.getAttribute('.cc-pdpa a', 'href')) === 'privacy.html#champ' && (await p.$$('.cc-form input[name=consent]')).length === 1 && await p.isChecked('.cc-form input[name=pack]'));
  await p.click('.cc-go'); await sleep(300);
  ok('Welcome', 'empty form: asks for the name', /\[Tamil\] Please type your first and last name/.test(await p.textContent('.cc-perr')));
  await p.fill('.cc-form [name=first]', 'சசி'); await p.fill('.cc-form [name=last]', 'சிவம்'); await p.fill('.cc-form [name=phone]', '0412 345 678'); await p.fill('.cc-form [name=email]', 'Sashi@Example.com');
  await p.click('.cc-go'); await sleep(300);
  ok('Welcome', 'a phone number without a country code is questioned', /country code/.test(await p.textContent('.cc-perr')));
  await p.fill('.cc-form [name=phone]', '+61 412 345 678'); await p.selectOption('.cc-form [name=purpose]', 'rDemo'); await p.fill('.cc-form [name=more]', 'எனக்கு டெமோ வேண்டும்');
  await p.click('.cc-go'); await sleep(300);
  ok('Welcome', 'cannot send without agreeing to the privacy notice', /agree to the privacy notice/.test(await p.textContent('.cc-perr')));
  global.LAST_SSML = '';
  await p.check('.cc-form [name=consent]'); await p.click('.cc-go'); await sleep(2200);
  lgw = await p.textContent('.cc-log');
  ok('Welcome', 'sent: thanks by first name, the welcome pack is on its way, and the main menu (spoken in Tamil)', /\[Tamil\] Thanks, சசி! Here’s what I can help you with\./.test(lgw) && /welcome pack to sashi@example\.com/.test(lgw) && (await p.$$('.cc-form')).length === 0 && (await p.$$('.cc-menu .cc-menu-list button')).length === 10 && /ta-MY-SuryaNeural/.test(global.LAST_SSML || ''), lgw.slice(-260));
  const VID = await p.evaluate(() => window.ChampChat.visitor().id);
  await p.fill('.cc-f textarea', 'What is a Gantt chart'); await p.keyboard.press('Enter'); await sleep(1500);
  ok('Welcome', 'Champ is told the visitor’s first name for its answers', /called சசி\./.test(global.CHAT_SYS || ''));
  ok('Welcome', 'phone and email never go to the AI', !/412 345|example\.com/.test(global.CHAT_SYS || '') && !/412 345|sashi@example/i.test(JSON.stringify(global.CHAT_MSGS || '')));
  // hands-free: microphone on at the yes / no → Champ listens; a spoken question is answered and the yes / no stays
  await p.evaluate(() => { HTMLMediaElement.prototype.play = function () { var a = this; setTimeout(function () { a.dispatchEvent(new Event('ended')); }, 150); return Promise.resolve(); }; });
  await p.click('.cc-clear'); await sleep(800);
  await ctx.grantPermissions(['microphone'], { origin: BASE });
  await p.click('[data-ob="mic"]'); await sleep(1200);
  ok('Hands-free', 'microphone on: Champ starts listening by itself', await p.evaluate(() => document.querySelector('.cc-mic').classList.contains('on')) && /Your microphone is on/.test(await p.textContent('.cc-log')), (await p.evaluate(() => document.querySelector('.cc-mic').className)) + ' | ' + (await p.textContent('.cc-log')).slice(-200));
  await p.evaluate(() => { const m = document.querySelector('.cc-mic'); if (m.classList.contains('on')) m.click(); }); await sleep(2500);
  ok('Hands-free', 'a spoken question at the yes / no is answered, and the yes / no stays', /எனது திட்டங்கள்/.test(await p.textContent('.cc-log')) && (await p.$$('[data-ob=cy]')).length === 1);
  await p.goto(`${BASE}/features.html`); await sleep(800);
  ok('Hands-free', '"Hey Champ" is listened for on other pages once the microphone is allowed', await p.evaluate(() => localStorage.getItem('champHandsFree') === '1'));
  await ctx.clearPermissions(); await p.evaluate(() => localStorage.removeItem('champHandsFree'));
  await p.goto(`${BASE}/index.html`); await p.click('#champChatBtn'); await sleep(600);
  await p.fill('.cc-f textarea', 'no'); await p.keyboard.press('Enter'); await sleep(1200);
  ok('Welcome', 'a typed "no" to sharing details goes to the main menu', /No problem at all/.test((await p.textContent('.cc-log')).slice(-2500)) && (await p.$$('.cc-menu .cc-menu-list button')).length === 10);
  await p.fill('.cc-f textarea', 'switch to Elvish'); await p.keyboard.press('Enter'); await sleep(1500);
  ok('Welcome', '"switch to" an unknown language: sorry, back to English', /don’t speak that one yet/.test(await p.textContent('.cc-log')) && (await p.inputValue('.cc-lang')) === 'en');
  await p.reload(); await p.click('#champChatBtn'); await sleep(500);
  ok('Welcome', 'a reload in the same tab keeps the conversation', /Elvish/.test(await p.textContent('.cc-log')), (await p.textContent('.cc-log')).slice(-200));
  await p.click('.cc-clear'); await sleep(500);
  ok('Not remembering', '"New chat" is the next person: Champ asks again, no name kept', /keep in touch/.test(await p.textContent('.cc-log')) && !/Sashi/.test(await p.textContent('.cc-log')) && (await p.evaluate(() => window.ChampChat.visitor().name)) === '');
  const p2 = await ctx.newPage(); await p2.goto(`${BASE}/features.html`); await sleep(400);
  await p2.evaluate(() => { sessionStorage.clear(); }); await p2.reload(); await sleep(400);
  await p2.click('#champChatBtn'); await sleep(900);
  ok('Not remembering', 'a new visit (new tab) forgets the last person: fresh greeting in English', /keep in touch/.test(await p2.textContent('.cc-log')) && (await p2.evaluate(() => localStorage.getItem('champLang'))) === null && (await p2.evaluate(() => window.ChampChat.visitor().name)) === '');
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
  ok('Ears', 'a spoken question is answered aloud in the Tamil voice', /ta-MY-SuryaNeural/.test(global.LAST_SSML || ''), (global.LAST_SSML || '').slice(0, 120));
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
  ok('Chat', 'each question stays within 2000 tokens (instructions + recent conversation + answer)', r0.ok() && used <= 2000 && global.CHAT_MAX >= 300 && global.CHAT_MAX <= 450 && /critical path/.test(JSON.stringify(global.CHAT_MSGS.slice(-1))) && global.CHAT_MSGS.filter((m) => m.role !== 'system').length < longHist.length && global.CHAT_MSGS.filter((m) => m.role !== 'system')[0].role === 'user', 'used ~' + used + ' tokens, ' + (global.CHAT_MSGS || []).length + ' messages');
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
  ok('Voice', 'Malay answer uses the Malaysian voice, markdown removed', /ms-MY-OsmanNeural/.test(global.LAST_SSML || '') && !/\*\*/.test(global.LAST_SSML || ''));
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
  // ---- 📊 the look of the reports: 4 skins, the colour schemes, a live preview; PDF and Word in every skin ----
  {
    const rc = (await (await api('planNewProject', { name: 'Hospital ERP rollout', client: 'Northside Health', program: 'Digital health' })).json()).core;
    const d0 = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
    const T0 = [['Kick-off and charter', 2, 100], ['Requirements workshops', 5, 100], ['Solution design', 6, 60], ['Configuration and build', 15, 10], ['Data migration', 10, 0], ['User acceptance testing', 8, 0], ['Training', 5, 0], ['Go-live', 0, 0]];
    await api('planSave', { core: rc, plan: { name: 'Hospital ERP rollout', start: d0(-16), phases: [{ id: 'ph1', name: 'Work' }], tasks: T0.map((t, i) => ({ id: 't' + i, phase: 'ph1', name: t[0], dur: t[1], pred: i ? ['t' + (i - 1)] : [], qty: Math.max(1, t[1]) * 8, unit: 'h', rate: 150, pct: t[2], status: t[2] >= 100 ? 'done' : t[2] ? 'doing' : 'todo', res: i % 2 ? ['Priya Shah'] : ['Tom Walsh'] })),
      risks: [{ id: 'r1', title: 'Key users not available for testing', p: 3, i: 4, response: 'Mitigate', action: 'Book testers four weeks ahead', owner: 'Priya Shah', status: 'Open' }, { id: 'r2', title: 'Legacy data quality is poor', p: 4, i: 4, response: 'Mitigate', action: 'Data cleansing sprint before migration', owner: 'Tom Walsh', status: 'Open' }],
      issues: [{ id: 'i1', title: 'Test environment not ready', priority: 'High', owner: 'Tom Walsh', due: d0(3), status: 'Open' }] } });
    await p.goto(`${BASE}/admin/#plan/${rc}/reports`); await p.reload(); await p.waitForSelector('.sk-b', { timeout: 12000 }).catch(() => {});
    ok('Reports', 'the look: 4 skins (Modern, Bold, Minimal, Classic) with pictures, and the colour schemes', (await p.$$eval('.sk-b', (b) => b.map((x) => x.getAttribute('data-skin')).join(','))) === 'modern,bold,minimal,classic' && (await p.$$('#rpLook button[data-thm]')).length >= 8 && (await p.$$('.sk-b .sk-t span')).length >= 4);
    await p.waitForFunction(() => { const c = document.querySelector('#rpLive'); return c && c.width > 300; }, null, { timeout: 20000 }).catch(() => {});
    ok('Reports', 'the live preview draws page 1 of the report', await p.$eval('#rpLive', (c) => c.width > 300).catch(() => false));
    await p.click('[data-skin=bold]'); await p.click('#rpLook button[data-thm=ocean]'); await sleep(2500);
    const lp = (await (await api('planGet', { core: rc })).json()).plan;
    ok('Reports', 'the skin and colours are kept with the project (Bold, Ocean)', lp.repSkin === 'bold' && lp.docTheme === 'ocean', JSON.stringify([lp.repSkin, lp.docTheme]));
    fs.mkdirSync('/tmp/rpt', { recursive: true });
    const sizes = [];
    for (const [sk, th] of [['modern', 'champ'], ['bold', 'ocean'], ['minimal', 'forest'], ['classic', 'royal']]) {
      await p.click(`[data-skin=${sk}]`); await p.click(`#rpLook button[data-thm=${th}]`); await sleep(1500); await p.waitForSelector('#rpLiveBox:not(.busy)', { timeout: 30000 }).catch(() => {});
      const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 60000 }), p.click('#rpPdf')]); const f = `/tmp/rpt/${sk}-${th}.pdf`; await dl.saveAs(f);
      const buf = fs.readFileSync(f), pages = (buf.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
      const [dw] = await Promise.all([p.waitForEvent('download', { timeout: 60000 }), p.click('#rpDocx')]); const fw = `/tmp/rpt/${sk}-${th}.docx`; await dw.saveAs(fw);
      sizes.push([sk, buf.slice(0, 4).toString() === '%PDF' && pages >= 1 && pages <= 4, pages, fs.readFileSync(fw).slice(0, 2).toString() === 'PK']);
      await sleep(400);
    }
    ok('Reports', 'every skin makes a PDF (at most 4 pages) and a Word file', sizes.every((x) => x[1] && x[3]), JSON.stringify(sizes));
    const lg = (await (await api('reportLog', { core: rc })).json()).list || [], last = lg.slice(-1)[0];
    const snap = last ? (await (await api('reportGet', { core: rc, id: last.id })).json()).report : null;
    ok('Reports', 'the report log keeps the look it was made with, so it comes out the same again', snap && snap.skin === 'classic' && snap.theme === 'royal' && snap.lookHex && /^#[0-9A-F]{6}$/.test(snap.lookHex.accent), JSON.stringify(snap && [snap.skin, snap.theme, snap.lookHex]));
    if (process.env.RPT_ONLY && !process.env.DOC_ONLY) { for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.pass ? '' : '  → ' + x.detail}`); console.log(errors.join('\n')); try { srv.kill(); } catch (e) {} process.exit(0); }
    await api('planProjectDelete', { core: rc });
  }
  // ---- 🔐 the sign-in log: who signed in, by password or Google, from which IP and place, on what device ----
  {
    const geo = Buffer.from(JSON.stringify({ city: 'Sydney', country: { code: 'AU', name: 'Australia' }, subdivision: { code: 'NSW', name: 'New South Wales' } })).toString('base64');
    const lr = await p.request.post(`${BASE}/.netlify/functions/admin`, { data: { action: 'login', username: 'sashi73', password: 'sashi98' }, headers: { 'X-MBS-Admin': '1', 'x-nf-geo': geo, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36' } });
    await p.request.post(`${BASE}/.netlify/functions/admin`, { data: { action: 'login', username: 'mallory@example.com', password: 'guess' }, headers: { 'X-MBS-Admin': '1', 'x-nf-geo': geo, 'X-Forwarded-For': '198.51.100.9' } });
    await sleep(800); if (!lr.ok()) console.log('SIGNDBG', lr.status(), (await lr.text()).slice(0, 200));
    let sl = []; for (let i = 0; i < 12; i++) { sl = (await (await api('visitorList')).json()).signins || []; if (sl.some((x) => x.ok && x.city === 'Sydney') && sl.some((x) => !x.ok && x.email === 'mallory@example.com')) break; await sleep(500); }
    const sl0 = sl, good = sl.find((x) => x.ok && x.city === 'Sydney'), badS = sl.find((x) => !x.ok && x.email === 'mallory@example.com');
    ok('Sign-ins', 'every sign-in is logged with name, email, IP, place and device; failed tries too', good && good.email && good.name && good.ip && good.country === 'Australia' && /Chrome on Windows/.test(good.device) && badS && /Wrong/.test(badS.note), JSON.stringify(sl.slice(0, 4).map((x) => [x.ok, x.user, x.city, x.at])));
    await p.goto(`${BASE}/admin/#visitors`); await p.reload(); await p.waitForSelector('#siCard', { timeout: 10000 }).catch(() => {});
    const st = await p.textContent('#siCard').catch(() => '');
    ok('Sign-ins', 'Visitors shows the sign-in log to the super user (who, email, how, IP, location)', /Sydney, New South Wales, Australia/.test(st) && /mallory@example\.com/.test(st) && /Password/.test(st), st.slice(0, 200));
  }
  // ---- 📄 start a project from a document (PDF, Word, PowerPoint): the AI reads it with retrieval, fills the form, attaches it to Ask AI and plans from it ----
  {
    await p.goto(`${BASE}/admin/#projects/new`); await p.reload(); await p.waitForSelector('#cnFile', { state: 'attached', timeout: 10000 }).catch(() => {});
    await p.setInputFiles('#cnFile', path.join(SITE, 'tools/test-data/northside-erp-brief.pdf')); await p.waitForSelector('.cn-res', { timeout: 90000 }).catch(() => {});
    const fv = await p.evaluate(() => { const F = document.querySelector('#champNew'); return { name: F.name.value, client: F.client.value, sponsor: F.sponsor.value, site: F.site.value, summary: F.summary.value.length, res: (document.querySelector('.cn-res') || {}).textContent || (document.querySelector('#cnDocOut') || {}).textContent }; });
    if (process.env.DOC_ONLY) await p.screenshot({ path: '/tmp/cn.png', fullPage: true });
    const g0 = (global.INGEST || [])[0] || {};
    ok('New project', '📄 a 120-page PDF: the AI reads it with retrieval (the opening pages and the pages that answer each field, within 80,000 tokens) and fills in name, client, sponsor, location and a long description', fv.name === 'Northside Health ERP Modernisation' && /Northside Local Health District/.test(fv.client) && /Amelia Hart/.test(fv.sponsor) && fv.site === 'Parramatta, NSW' && fv.summary > 150 && g0.whole === false && g0.given < g0.total && g0.p1 && g0.p87 && g0.p64 && g0.len <= 80000 * 3.6 && /120 pages/.test(fv.res) && /p\. 87/.test(fv.res), JSON.stringify([fv, g0]));
    await p.waitForFunction(() => document.querySelectorAll('#champNew [name=progPick] option').length > 1, null, { timeout: 8000 }).catch(() => {});
    await p.selectOption('#champNew [name=progPick]', { index: 1 }).catch(() => {}); await sleep(600);
    if (await p.isVisible('#champNew [name=program]')) await p.fill('#champNew [name=program]', 'Digital health');
    global.PLAN_USER = '';
    await Promise.all([p.waitForURL(/#plan\//, { timeout: 20000 }).catch(() => {}), p.click('#champNew button[type=submit]')]);
    const ncore = (p.url().match(/#plan\/([^/]+)/) || [])[1] || '';
    if (!ncore) console.log('DOCDBG', JSON.stringify(await p.evaluate(() => [location.hash, document.querySelector('#champNew') && document.querySelector('#champNew').checkValidity(), [...document.querySelectorAll('#champNew :invalid')].map((e) => e.name), (document.querySelector('.toast,#toast') || {}).textContent, document.querySelector('#champNew [name=progPick]') && document.querySelector('#champNew [name=progPick]').value])));
    for (let i = 0; i < 40 && !global.PLAN_USER; i++) await sleep(500);
    await p.waitForSelector('#aiOut .aifit', { timeout: 20000 }).catch(() => {});
    const scopeV = await p.inputValue('#tplScope').catch(() => ''), fromBox = await p.textContent('.cn-from').catch(() => '');
    const idocs = ncore ? (await (await api('intelGet', { core: ncore })).json()).docs || [] : [];
    ok('New project', 'on Create, the document goes to the project\'s Ask AI (with the file), and the AI builds the plan from the brief and the parts of the document about phases and dates', idocs.length === 1 && /northside-erp-brief\.pdf/.test(idocs[0].name) && idocs[0].hasFile && idocs[0].pages === 120 && /From the project document/.test(scopeV) && /northside-erp-brief/.test(fromBox) && /document_extracts/.test(global.PLAN_USER) && /Phase 1 Discovery/.test(global.PLAN_USER) && /COMES FROM A PROJECT DOCUMENT/.test(global.PLAN_SYS || ''), JSON.stringify([ncore, idocs.map((d) => [d.name, d.hasFile, d.pages]), scopeV.slice(0, 60), fromBox.slice(0, 60), String(global.PLAN_USER).length]));
    await p.goto(`${BASE}/admin/#projects/new`); await p.reload(); await p.waitForSelector('#cnFile', { state: 'attached', timeout: 10000 }).catch(() => {});
    await p.setInputFiles('#cnFile', path.join(SITE, 'tools/test-data/library-brief.docx')); await p.waitForSelector('.cn-res', { timeout: 60000 }).catch(() => {});
    const wv = await p.evaluate(() => { const F = document.querySelector('#champNew'); return [F.name.value, F.sponsor.value, F.site.value, (document.querySelector('.cn-res') || {}).textContent || '']; });
    await p.goto(`${BASE}/admin/#projects/new`); await p.reload(); await p.waitForSelector('#cnFile', { state: 'attached', timeout: 10000 }).catch(() => {});
    await p.setInputFiles('#cnFile', path.join(SITE, 'tools/test-data/fleet-ev.pptx')); await p.waitForSelector('.cn-res', { timeout: 60000 }).catch(() => {});
    const pv = await p.evaluate(() => { const F = document.querySelector('#champNew'); return [F.name.value, F.client.value, (document.querySelector('.cn-res') || {}).textContent || (document.querySelector('#cnDocOut') || {}).textContent]; });
    const last = (global.INGEST || []).slice(-1)[0] || {};
    ok('New project', 'Word (.docx) and PowerPoint (.pptx, slides and speaker notes) are read too; a short document goes in whole; the kind of document (requirements, feasibility study, RFP) is recognised', wv[0] === 'Library Digitisation Project' && /Grace Liu/.test(wv[1]) && /Parramatta/.test(wv[2]) && /Read as Requirements document/.test(wv[3]) && pv[0] === 'Fleet EV Transition' && pv[1] === 'Acme Logistics' && /2 slides/.test(pv[2]) && last.whole === true, JSON.stringify([wv, pv, last]));
    // 👥 Gantt resources: the list has People and the Stakeholder register's names; a new person's name typed there joins the register (trades do not)
    {
      const rc2 = (await (await api('planNewProject', { name: 'Resource list check', client: 'Northside Health', program: 'Digital health' })).json()).core;
      await api('planSave', { core: rc2, plan: { name: 'Resource list check', start: new Date().toISOString().slice(0, 10), phases: [{ id: 'ph1', name: 'Work' }], tasks: [{ id: 't1', phase: 'ph1', name: 'Kick-off', dur: 2, pred: [], res: [], qty: 16, unit: 'h', rate: 500, pct: 0, status: 'todo', subs: [{ id: 'k1', name: 'Agenda', owner: '', off: 0, dur: 1, status: 'todo' }] }], stakeholders: [{ id: 'sA', name: 'Dr Amelia Hart', role: 'Sponsor', raci: 'A' }, { id: 'sB', name: '', role: 'Steering committee', raci: 'I' }] } });
      await p.goto(`${BASE}/admin/#plan/${rc2}/schedule`); await p.reload(); await p.waitForSelector('#planBody', { timeout: 10000 }).catch(() => {});
      await p.click('[data-cols="c"]').catch(() => {}); await sleep(500);
      const opts = await p.$$eval('#resList option', (o) => o.map((x) => x.value));
      const ri = '#planBody tr[data-tid="t1"] [data-radd]';
      await p.fill(ri, 'Nadia Karim'); await p.press(ri, 'Enter'); await sleep(300); await p.fill(ri, 'Plumber'); await p.press(ri, 'Enter'); await sleep(300);
      await p.fill('#planBody [data-sk="owner"]', 'Tom Walsh').catch(() => {}); await p.press('#planBody [data-sk="owner"]', 'Tab').catch(() => {}); await sleep(2500);
      const pg = (await (await api('planGet', { core: rc2 })).json()).plan, nm = (pg.stakeholders || []).map((x) => x.name + ':' + x.raci);
      ok('Gantt', 'resources: the list has the Stakeholder register\'s names; a new person typed there (or as a sub-task owner) joins the register as R, a trade does not', opts.includes('Dr Amelia Hart') && !opts.includes('Steering committee') && nm.includes('Nadia Karim:R') && nm.includes('Tom Walsh:R') && !nm.some((x) => /Plumber/.test(x)) && (pg.tasks[0].res || []).join() === 'Nadia Karim,Plumber', JSON.stringify([opts.slice(0, 6), nm, pg.tasks[0].res]));
      const c2 = await p.textContent('#planBody tr[data-tid="t1"] .crewx').catch(() => ''), crew2 = await p.inputValue('#planBody tr[data-tid="t1"] [data-k=crew]').catch(() => '');
      await p.fill('#planBody tr[data-tid="t1"] [data-k=crew]', '4'); await p.press('#planBody tr[data-tid="t1"] [data-k=crew]', 'Tab'); await sleep(2500);
      const c4 = await p.textContent('#planBody tr[data-tid="t1"] .crewx').catch(() => ''), pg4 = (await (await api('planGet', { core: rc2 })).json()).plan, t4 = pg4.tasks[0], bac = (await (await api('planGet', { core: rc2 })).json()).plan;
      ok('Gantt', 'labour costs people × hours each × rate: the people come from the Resources column (2 here), or are typed (4 × 16 h × $500 = $32,000)', crew2 === '2' && /2 × 16 h × \$500/.test(c2) && /4 × 16 h × \$500/.test(c4) && t4.crew === 4 && t4.crewSet === true, JSON.stringify([crew2, c2, c4, t4.crew, t4.crewSet]));
      // 💰 Costing: 4 people is labour only (no phantom "Bill of Materials" line), people editable, ✕ clears a cost (the task stays), ↶ Undo
      await p.goto(`${BASE}/admin/#plan/${rc2}/budget`); await p.reload(); await p.waitForSelector('.bd-tbl', { timeout: 10000 }).catch(() => {});
      const boms = (await p.$$('.bd-tbl tr.bd-bom')).length, c1 = await p.$$eval('.bd-tbl tbody tr', (r) => r.map((x) => x.textContent).join('|'));
      await p.fill('.bd-tbl [data-bp="t1"]', '3'); await p.press('.bd-tbl [data-bp="t1"]', 'Tab'); await sleep(800);
      const c3 = await p.$$eval('.bd-tbl tbody tr', (r) => r.map((x) => x.textContent).join('|'));
      await p.click('.bd-tbl [data-bz="t1"]'); await sleep(800);
      const gone = !(await p.$('.bd-tbl [data-bz="t1"]')), undoLbl = await p.textContent('#bdUndo').catch(() => '');
      await p.click('#bdUndo'); await sleep(800); const back3 = await p.$$eval('.bd-tbl tbody tr', (r) => r.map((x) => x.textContent).join('|'));
      await p.click('#bdUndo'); await sleep(800); const back4 = await p.$$eval('.bd-tbl tbody tr', (r) => r.map((x) => x.textContent).join('|'));
      await sleep(2500); const pz = (await (await api('planGet', { core: rc2 })).json()).plan;
      ok('Costing', 'labour with 4 people is one line ($32,000), with no doubled "Bill of Materials" line; the people can be changed here (3 → $24,000); ✕ clears a cost but keeps the task; ↶ Undo steps back', boms === 0 && /\$32,000/.test(c1) && /\$24,000/.test(c3) && gone && /Undo \(2\)/.test(undoLbl) && /\$24,000/.test(back3) && /\$32,000/.test(back4) && pz.tasks.some((t) => t.id === 't1' && t.qty === 16 && t.crew === 4), JSON.stringify([boms, c1.slice(0, 200), c3.slice(0, 120), gone, undoLbl, back4.slice(0, 120)]));
      await api('planProjectDelete', { core: rc2 });
    }
    // 📚 the knowledge base: Sashi's class deck, read slide by slide, used by Ask Champ and Ask AI with the credit
    {
      await p.goto(`${BASE}/admin/#knowledge`); await p.reload(); await p.waitForSelector('#kbFile', { state: 'attached', timeout: 10000 }).catch(() => {});
      await p.setInputFiles('#kbFile', path.join(SITE, 'tools/test-data/pm-masterclass.pptx')); await p.waitForSelector('#kbGo:not([disabled])', { timeout: 20000 }).catch(() => {});
      await p.fill('#kbF [name=title]', 'PM Masterclass'); await p.click('#kbGo'); await p.waitForSelector('.kb-doc', { timeout: 15000 }).catch(() => {});
      const kd = await p.textContent('#kbList').catch(() => '');
      await p.fill('#kbQ', 'How do I control scope creep?'); await p.click('#kbAsk'); await p.waitForSelector('.kb-hit', { timeout: 10000 }).catch(() => {});
      const kh = await p.$$eval('.kb-hit b', (b) => b.map((x) => x.textContent));
      ok('Knowledge base', 'the super user adds a slide deck (6 slides, with speaker notes); a question finds the right slide', /PM Masterclass/.test(kd) && /6 slides/.test(kd) && /Sashi Sivam/.test(kd) && kh[0] === 'PM Masterclass, slide 2', JSON.stringify([kd.slice(0, 160), kh]));
      const ga = await (await api('guideAsk', { q: 'How should I deal with scope creep on my project?', tours: [] })).json();
      ok('Knowledge base', 'Ask Champ answers project management questions from the class notes, credited to Sashi with the slide', /As Sashi teaches/.test(ga.answer) && /change control board/.test(ga.answer) && (ga.notes || []).some((n) => /Sashi Sivam's class notes: PM Masterclass, slide 2/.test(n)) && ((global.GUIDE_CTX || {}).course_notes || []).length > 0, JSON.stringify([ga, (global.GUIDE_CTX || {}).course_notes]));
      const kc = (await (await api('planNewProject', { name: 'KB check', client: 'Internal', program: 'Digital health' })).json()).core;
      await api('planSave', { core: kc, plan: { name: 'KB check', start: new Date().toISOString().slice(0, 10), phases: [{ id: 'ph1', name: 'Work' }], tasks: [{ id: 't1', phase: 'ph1', name: 'Design', dur: 3, pred: [], res: [], pct: 0, status: 'todo' }] } });
      const iid = 'kbtest' + Date.now().toString(36) + 'x1';
      const fr = await p.evaluate(([core, id]) => fetch('/.netlify/functions/planai-background', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-MBS-Admin': '1' }, body: JSON.stringify({ mode: 'intel', id, core, question: 'The client keeps adding features: how do we stop scope creep?' }) }).then((r) => r.status), [kc, iid]);
      let ir = null; for (let i = 0; i < 120; i++) { await sleep(500); const st = await (await api('planAiStatus', { id: iid })).json(); if (st.status === 'done') { ir = st.result || st.intel || st; break; } if (st.status === 'error') { ir = { err: st.error }; break; } if (i === 119) ir = { last: st }; }
      const irs = JSON.stringify(ir || {});
      ok('Knowledge base', 'Ask AI in a project gets the class notes too, and lists them as a source', /Sashi Sivam's class notes: PM Masterclass, slide 2/.test(irs) && /COURSE NOTES/.test(global.INTEL_SYS || '') && (global.INTEL_CTX.course_notes || []).length > 0, fr + ' ' + irs.slice(0, 300));
      await api('planProjectDelete', { core: kc });
    }
    // ☁️ R2: original files go straight from the browser to the bucket with a signed link; Blobs keeps only the text
    {
      const kbKeys = [...global.R2S.keys()].filter((k) => /^kb\/\d{4}\/\d{2}\/[^/]+-pm-masterclass\.pptx$/i.test(k));
      const deck = fs.readFileSync(path.join(SITE, 'tools/test-data/pm-masterclass.pptx'));
      const kbObj = kbKeys.length ? global.R2S.get(kbKeys[0]) : null;
      await p.goto(`${BASE}/admin/#knowledge`); await p.reload(); await p.waitForSelector('[data-kbdl]', { timeout: 10000 }).catch(() => {});
      await sleep(1200); const r2line = await p.textContent('#kbR2').catch(() => '');
      const [kdl] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }).catch(() => null), p.click('[data-kbdl]').catch(() => {})]);
      let same = false; if (kdl) { await kdl.saveAs('/tmp/kb-orig.pptx'); same = fs.readFileSync('/tmp/kb-orig.pptx').equals(deck); }
      ok('R2 storage', 'the knowledge-base deck is kept in R2 (kb/…), byte for byte, sent straight from the browser; "⬇ Original" downloads it; the page shows the bucket and its size', kbKeys.length === 1 && kbObj && kbObj.body.equals(deck) && same && /gkh-test/.test(r2line) && /\d+ files?/.test(r2line) && global.R2_UNSIGNED === 0, JSON.stringify([kbKeys, !!kbObj, same, r2line, global.R2_UNSIGNED]));
      const rc = (await (await api('planNewProject', { name: 'R2 check', client: 'Internal', program: 'Digital health' })).json()).core;
      await api('planSave', { core: rc, plan: { name: 'R2 check', start: new Date().toISOString().slice(0, 10), phases: [{ id: 'ph1', name: 'Work' }], tasks: [{ id: 't1', phase: 'ph1', name: 'Design', dur: 3, pred: [], res: [], pct: 0, status: 'todo' }] } });
      await p.goto(`${BASE}/admin/#plan/${rc}/intel`); await p.reload(); await p.waitForSelector('#piFile', { state: 'attached', timeout: 10000 }).catch(() => {});
      await p.setInputFiles('#piFile', path.join(SITE, 'tools/test-data/depot-requirements.xlsx'));
      let pk = []; for (let i = 0; i < 40 && !pk.length; i++) { await sleep(500); pk = [...global.R2S.keys()].filter((k) => k.startsWith('projects/' + rc + '/')); }
      await sleep(1500);
      const ig = await (await api('intelGet', { core: rc })).json(), doc = (ig.docs || [])[0] || {};
      const df = await (await api('intelDocFile', { core: rc, id: doc.id })).json();
      const xl = fs.readFileSync(path.join(SITE, 'tools/test-data/depot-requirements.xlsx'));
      const got = df.url ? Buffer.from(await (await fetch(df.url)).arrayBuffer()) : Buffer.alloc(0);
      const txt = JSON.stringify(doc);
      ok('R2 storage', 'an Excel file in Ask AI: its sheets are read as text (requirements and budget), the file goes to R2 under the project, and downloads through a signed link', pk.length === 1 && global.R2S.get(pk[0]).body.equals(xl) && got.equals(xl) && /^http:\/\/127\.0\.0\.1:\d+\/gkh-test\/projects\//.test(df.url || '') && /X-Amz-Signature=/.test(df.url || '') && doc.hasFile && (doc.pages === 2 || /2 (sheets|pages)/.test(txt)), JSON.stringify([pk, (df.url || '').slice(0, 90), got.length, xl.length, doc.pages, doc.hasFile]));
      await api('intelDocDelete', { core: rc, id: doc.id }).catch(() => {});
      await sleep(500); const gone = ![...global.R2S.keys()].some((k) => k.startsWith('projects/' + rc + '/'));
      const bad = await (await api('intelUpload', { core: rc, name: 'x.txt', type: 'text/plain', size: 3, text: 'hello world, a small file', r2Key: 'kb/2026/01/zzz-steal.pptx' })).json();
      const ig2 = await (await api('intelGet', { core: rc })).json(), d2 = (ig2.docs || []).find((x) => x.name === 'x.txt') || {};
      ok('R2 storage', 'removing a document removes its file from R2; a key outside the project is refused (no file attached)', gone && !d2.hasFile, JSON.stringify([gone, d2, bad && bad.error]));
      const st = await (await api('r2Status')).json();
      ok('R2 storage', 'storage status for the super user: bucket, file count and size', st.ready && st.bucket === 'gkh-test' && st.objects >= 1 && st.bytes >= deck.length && st.kb && st.kb.objects === 1, JSON.stringify(st));
      await api('planProjectDelete', { core: rc });
    }
    // 🩺 Champ's project watch: red / amber / green from fixed rules; Champ's button takes the colour; opening Champ in a project gives the brief first
    {
      const d0 = (n) => new Date(Date.now() + 11 * 3600000 + n * 864e5).toISOString().slice(0, 10);
      const mk = async (name, red) => { const c = (await (await api('planNewProject', { name, client: 'Watch Co', program: 'Watch program' })).json()).core;
        const tasks = red ? [{ id: 't1', phase: 'ph1', name: 'Design workshops', dur: 20, pred: [], res: [], pct: 50, status: 'doing', qty: 150, unit: 'h', rate: 200, actual: 25000 },
          { id: 't2', phase: 'ph1', name: 'Build', dur: 30, pred: ['t1'], res: [], pct: 0, status: 'todo', qty: 240, unit: 'h', rate: 200 }]
          : [{ id: 't1', phase: 'ph1', name: 'Design workshops', dur: 20, pred: [], res: [], pct: 0, status: 'todo', qty: 150, unit: 'h', rate: 200 }];
        await api('planSave', { core: c, plan: { name, start: red ? d0(-40) : d0(10), phases: [{ id: 'ph1', name: 'Work' }], tasks, charter: { budget: red ? 60000 : 40000 },
          baseline: red ? { at: Date.now() - 50 * 864e5, finish: d0(-20), BAC: 78000, tasks: {} } : null,
          issues: red ? [{ id: 'i1', title: 'Vendor adapter late', priority: 'Critical', status: 'Open', owner: 'Raj' }] : [] } });
        return c; };
      const rc = await mk('Watch red', true), gc = await mk('Watch green', false);
      const q1 = await (await api('planWatchGet', { core: rc, quick: true })).json(), q2 = await (await api('planWatchGet', { core: gc, quick: true })).json();
      ok('Champ watch', 'the health rules: a late, over-budget project with a critical issue is red (with the reasons); a project not started yet is green', q1.rag === 'red' && q1.reasons.some((x) => /Behind schedule/.test(x.text)) && q1.reasons.some((x) => /Over budget: CPI/.test(x.text)) && q1.reasons.some((x) => /past the baseline/.test(x.text)) && q1.reasons.some((x) => /critical issue/.test(x.text)) && q2.rag === 'green', JSON.stringify([q1.rag, q1.reasons.map((x) => x.text), q2.rag]));
      await p.goto(`${BASE}/admin/#plan/${rc}/overview`); await p.reload(); await p.evaluate(() => { try { sessionStorage.clear(); } catch (e) {} });
      await p.waitForSelector('#cgBtn.cg-red', { timeout: 10000 }).catch(() => {});
      const bt = await p.textContent('#cgBtn').catch(() => '');
      global.ALL_SSML = []; global.WATCH_CALLS = 0; await p.click('#cgBtn'); await p.waitForSelector('.cgp-brief', { timeout: 15000 }).catch(() => {});
      const quickCard = await p.textContent('.cgp-brief').catch(() => ''); await p.waitForSelector('.cgp-brief.cgb-ai', { timeout: 30000 }).catch(() => {});
      const br = await p.textContent('.cgp-brief').catch(() => ''), first = await p.$eval('#cgLog', (l) => l.firstElementChild && l.firstElementChild.className).catch(() => '');
      const pc = await p.$eval('#cgPanel', (x) => x.className).catch(() => '');
      ok('Champ watch', 'Champ shows the rules\' view at once (with the reasons) while it works out its own view in the background', /Behind schedule/.test(quickCard) && /working out what it would do/.test(quickCard), quickCard.slice(0, 200));
      ok('Champ watch', 'in a red project the Ask Champ button turns red ("Champ: act now"); opening Champ, the first thing it says is the brief: what is wrong, why, and what it would do', /act now/i.test(bt) && /cgp-brief cg-red/.test(first) && /cg-red/.test(pc) && /Act now/.test(br) && /Heads up: Watch red is \d+ days late/.test(br) && /Crash the critical path/.test(br) && /Design workshops/.test(br) && /Vendor adapter late/.test(br) && global.WATCH_CALLS === 1 && /RED/.test(global.WATCH_SYS || ''), JSON.stringify([bt, first, pc, br.slice(0, 300), global.WATCH_CALLS]));
      const c2 = await (await api('planWatchGet', { core: rc })).json();
      await p.click('[data-cgbr]'); await sleep(800); await p.waitForSelector('.cgp-brief.cgb-ai', { timeout: 30000 }).catch(() => {}); await sleep(500);
      ok('Champ watch', 'the brief is kept until the numbers change (no second AI call); ↻ Look again asks Champ afresh', c2.cached === true && global.WATCH_CALLS === 2, JSON.stringify([c2.cached, global.WATCH_CALLS]));
      const ssml = (global.ALL_SSML || []).filter((x) => /volume="loud"/.test(x)).join(' '); await p.click('.cgp-x').catch(() => {}); const cleared = await p.$eval('#cgLog', (l) => l.children.length).catch(() => -1);
      let ttsN2 = 0; const onT = (rq) => { if (/functions\/tts/.test(rq.url())) ttsN2++; }; p.on('request', onT);
      await p.click('#cgBtn'); await p.waitForSelector('.cgp-brief.cgb-ai', { timeout: 15000 }).catch(() => {}); await sleep(1500); p.off('request', onT);
      const again = await p.$$eval('#cgLog .cgp-brief', (x) => x.length).catch(() => 0);
      ok('Champ watch', '🔊 Champ reads a short brief out, loud and clear (headline, the summary in a line, "If this were my project, I would:" 1, 2, 3 by title, Keep an eye on, an offer to help) once; closing Champ clears it; opening again shows the brief quietly', /Heads up: Watch red/.test(ssml) && /Work is behind and costing more than planned\./.test(ssml) && /If this were my project, I would:/.test(ssml) && /1, Crash the critical path\. 2, Raise a change request and re-baseline\. 3, Escalate the critical issue\./.test(ssml) && !/Add a second team/.test(ssml) && /Keep an eye on: Contractor rates\./.test(ssml) && /(just ask|Just ask|happy to help|work through it together)/.test(ssml) && ssml.replace(/<[^>]+>/g, '').length < 700 && /volume="loud"/.test(ssml) && cleared === 0 && again === 1 && ttsN2 === 0, JSON.stringify([ssml.slice(0, 260), cleared, again, ttsN2]));
      await p.click('.cgp-x').catch(() => {});
      await p.goto(`${BASE}/admin/#plan/${gc}/overview`); await p.waitForSelector('#cgBtn.cg-green', { timeout: 10000 }).catch(() => {});
      const gb = await p.$eval('#cgBtn', (x) => x.className + '|' + x.textContent).catch(() => '');
      await p.goto(`${BASE}/admin/#programs`); await sleep(1200); const nb = await p.$eval('#cgBtn', (x) => x.className + '|' + x.textContent).catch(() => '');
      ok('Champ watch', 'a green project turns the button green; outside a project it is the usual Ask Champ', /cg-green/.test(gb) && /on track/i.test(gb) && !/cg-(red|amber|green)/.test(nb) && /Ask Champ/.test(nb), JSON.stringify([gb, nb]));
      const pgw = (await (await api('planGet', { core: rc })).json()).plan; await api('planSave', { core: rc, rev: pgw.rev, plan: Object.assign(pgw, { charter: { budget: 60000, manager: 'Priya Raman' }, stakeholders: [{ id: 's1', name: 'Priya Raman', role: 'Project manager', raci: 'R' }, { id: 's2', name: 'Helen Carter', role: 'Project sponsor', raci: 'A' }] }) });
      await api('guideAsk', { q: 'Who is the project manager and who are the stakeholders?', core: rc, tours: [] }); const gx = (global.GUIDE_CTX || {}).project || {};
      ok('Champ watch', 'Ask Champ in a project gets the whole project: manager, sponsor, stakeholders, tasks, risks, issues and its health (so it answers instead of pointing at a tab)', gx.project_manager === 'Priya Raman' && (gx.stakeholders || []).some((x) => x.name === 'Helen Carter' && x.role === 'Project sponsor') && (gx.tasks || []).some((t) => t.n === 'Design workshops' && t.pct === 50) && (gx.issues || []).some((x) => /Vendor adapter/.test(x.title)) && gx.health === 'red' , JSON.stringify([gx.project_manager, gx.stakeholders, (gx.tasks || []).slice(0, 2), gx.issues, gx.health]).slice(0, 700));
      // Build 2: the watch across every project (Programs and Summary), what got worse, Champ's review, the morning run is signed
      const wb1 = await (await api('watchBoard', { refresh: true })).json();
      const it = (b, c) => (b.items || []).find((x) => x.core === c) || {};
      const pg2 = (await (await api('planGet', { core: gc })).json()).plan;
      await api('planSave', { core: gc, rev: pg2.rev, plan: Object.assign(pg2, { issues: [{ id: 'i9', title: 'Key supplier went into administration', priority: 'Critical', status: 'Open', owner: 'Sam' }] }) });
      const wb2 = await (await api('watchBoard', { refresh: true })).json();
      ok('Champ watch', 'the watch checks every project (red first); when a project gets worse it raises an alert (green → red), once', it(wb1, rc).rag === 'red' && it(wb1, gc).rag === 'green' && wb1.items.findIndex((x) => x.core === rc) < wb1.items.findIndex((x) => x.core === gc) && it(wb2, gc).rag === 'red' && (wb2.alerts || []).some((a) => a.core === gc && a.from === 'green' && a.to === 'red' && /Key supplier/.test(a.why)) && (wb2.alerts || []).filter((a) => a.core === gc).length === 1, JSON.stringify([it(wb1, rc).rag, it(wb1, gc).rag, it(wb2, gc).rag, (wb2.alerts || []).slice(0, 2)]));
      await p.goto(`${BASE}/admin/#programs`); await p.reload(); await p.waitForSelector('#pgWatch .wt-r', { timeout: 15000 }).catch(() => {});
      const pw = await p.textContent('#pgWatch').catch(() => ''), redRow = await p.$('#pgWatch .wt-r.wt-red[data-wtc="' + rc + '"]');
      ok('Champ watch', 'Programs shows Champ\'s watch: counts, the red and amber projects with why, and what got worse', /Champ's watch/.test(pw) && /act now/.test(pw) && !!redRow && /Got worse/.test(pw) && /Watch green 🟢→🔴/.test(pw) && /Heads up: Watch red/.test(pw), pw.slice(0, 400));
      global.WATCH_CALLS = 0; await p.click('#wtAi'); await p.waitForSelector('#pgWatch .wt-msg', { timeout: 60000 }).catch(() => {});
      const pw2 = await p.textContent('#pgWatch').catch(() => '');
      ok('Champ watch', '✨ Champ\'s review: Champ writes its view of every red and amber project that needs one (not the ones already done)', /Champ reviewed [1-9]/.test(pw2) && global.WATCH_CALLS >= 1 && /Heads up: Watch green/.test(pw2), JSON.stringify([global.WATCH_CALLS, pw2.slice(0, 300)]));
      await p.goto(`${BASE}/admin/#portfolio/summary`); await p.waitForSelector('#csWatch .wt-r', { timeout: 15000 }).catch(() => {});
      const sw = await p.textContent('#csWatch').catch(() => '');
      process.env.ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || 'unit-test-secret';
      const AL = await import(path.join(SITE, 'netlify/lib/admin-lib.mjs')); await AL.ensureSecret();
      const rq = (t) => ({ headers: { get: (k) => (k === 'x-champ-cron' ? t : '') } }), good = AL.cronToken('2026-11-16');
      const cron = AL.cronOk(rq('not-the-key'), ['2026-11-16']) === false && AL.cronOk(rq(''), ['2026-11-16']) === false && AL.cronOk(rq(good), ['2026-11-16']) === true && AL.cronOk(rq(good), ['2026-11-17']) === false ? 403 : 0;
      ok('Champ watch', 'the Summary has the watch too; the morning run only works with the site\'s own signature', /Champ's watch/.test(sw) && /Watch red/.test(sw) && cron === 403, JSON.stringify([sw.slice(0, 120), cron]));
      await api('planProjectDelete', { core: rc }); await api('planProjectDelete', { core: gc });
    }
    // 📘 Lessons learned: the log, AI-suggested lessons, the library from past projects, the 4-page report with graphics, Word, Documents, the 30-second video
    {
      const today = new Date().toISOString().slice(0, 10), back = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
      const oc = (await (await api('planNewProject', { name: 'Old payments project', client: 'Internal', program: 'Digital health' })).json()).core;
      await api('planSave', { core: oc, plan: { name: 'Old payments project', start: back(200), phases: [{ id: 'ph1', name: 'Work' }], tasks: [{ id: 'a', phase: 'ph1', name: 'Payments integration', dur: 5, pred: [], res: [], pct: 100, status: 'done' }],
        lessons: [{ id: 'l1', title: 'Vendor payments adapter arrived late', category: 'Vendors and procurement', impact: 'negative', what: 'The payments adapter from the vendor came six weeks late.', cause: 'No dates in the vendor contract', rec: 'Put delivery dates and penalties in the vendor contract', status: 'Agreed', reuse: true }] } });
      const lc = (await (await api('planNewProject', { name: 'Payments portal', client: 'Internal', program: 'Digital health' })).json()).core;
      await api('planSave', { core: lc, plan: { name: 'Payments portal', start: back(60), phases: [{ id: 'p1', name: 'Design' }, { id: 'p2', name: 'Build' }], tasks: [
        { id: 'a', phase: 'p1', name: 'Design the payments screens', dur: 10, pred: [], res: [], pct: 100, status: 'done', qty: 80, unit: 'h', rate: 100 }, { id: 'b', phase: 'p2', name: 'Integrate the vendor payments adapter', dur: 30, pred: ['a'], res: [], pct: 40, status: 'doing', qty: 240, unit: 'h', rate: 100, actual: 15000 },
        { id: 'm', phase: 'p2', name: 'Go-live', dur: 0, pred: ['b'], res: [], pct: 0, status: 'todo' }],
        baseline: { at: Date.now() - 60 * 864e5, finish: back(5), BAC: 32000, tasks: { a: { es: back(60), ef: back(47), cost: 8000 }, b: { es: back(46), ef: back(6), cost: 24000 }, m: { es: back(5), ef: back(5), cost: 0 } } },
        issues: [{ id: 'i1', title: 'Vendor adapter late', priority: 'Critical', status: 'Open' }], charter: { budget: 35000, objective: 'Card payments online' } } });
      await api('intelUpload', { core: lc, name: 'Steering minutes.txt', type: 'text/plain', size: 100, pages: 1, text: 'Minutes. The vendor adapter is late and the build is blocked. Decision: escalate to the vendor.' });
      await p.goto(`${BASE}/admin/#plan/${lc}/lessons`); await p.reload(); await p.waitForSelector('#llAdd', { timeout: 10000 }).catch(() => {});
      await p.waitForSelector('[data-llrisk]', { timeout: 10000 }).catch(() => {});
      const past = await p.textContent('.ll-past').catch(() => '');
      await p.click('[data-llrisk]').catch(() => {}); await sleep(300);
      await p.click('#llAdd'); await p.fill('.ll-form [data-llf="title"]', 'Book the test environment early'); await p.press('.ll-form [data-llf="title"]', 'Tab'); await sleep(300);
      await p.selectOption('.ll-form [data-llf="status"]', 'Agreed'); await sleep(200);
      await p.click('#llAi'); await p.waitForSelector('#llSGo', { timeout: 30000 }).catch(() => {}); await p.click('#llSGo').catch(() => {}); await sleep(2500);
      let pl = (await (await api('planGet', { core: lc })).json()).plan;
      ok('Lessons', 'the Lessons learned tab: a past project\'s lesson that fits is offered (and reused as a risk), lessons are added by hand and suggested by the AI from the project\'s history (plan vs baseline by phase)', /Vendor payments adapter arrived late/.test(past) && /Old payments project/.test(past) && (pl.risks || []).some((r) => /Vendor payments adapter/.test(r.title) && /Old payments project/.test(r.cause)) && pl.lessonsUsed.includes(oc + ':l1') && pl.lessons.some((l) => l.title === 'Book the test environment early' && l.status === 'Agreed' && l.source === 'manual') && pl.lessons.filter((l) => l.source === 'ai').length === 2 && global.LL_FACTS.phases.length === 2 && global.LL_FACTS.phases[1].slip_days > 0, JSON.stringify([past.slice(0, 80), pl.lessons.map((l) => [l.title, l.source, l.status]), (global.LL_FACTS || {}).phases]));
      const charts1 = await p.$$eval('.ll-charts canvas', (c) => c.length).catch(() => 0);
      await p.click('#llRep'); await p.waitForSelector('#llDoc .ll-pg', { timeout: 60000 }).catch(() => {}); await sleep(2500);
      if (process.env.DOC_ONLY) { await p.setViewportSize({ width: 1400, height: 1000 }); await sleep(800); for (let i = 0; i < 4; i++) { const el = (await p.$$('#llDoc .ll-pg'))[i]; if (el) await el.screenshot({ path: `/tmp/llpg${i + 1}.png` }); } }
      const pages = await p.$$eval('#llDoc .ll-pg', (x) => x.length).catch(() => 0), docT = await p.textContent('#llDoc').catch(() => '');
      const gfx = await p.evaluate(() => ({ ph: !!document.querySelector('#rgPh') && document.querySelector('#rgPh').width > 0, cost: !!document.querySelector('#rgCost'), tl: !!document.querySelector('#rgTl svg'), fish: !!document.querySelector('#rgFish svg'), kpis: document.querySelectorAll('.ll-k').length }));
      ok('Lessons', '📄 the AI writes a 4-page illustrated report from the whole project (facts, lessons log, documents; up to ~80,000 tokens): KPIs, planned vs actual by phase, the milestone timeline, root causes (fishbone), cost by phase, recommendations, the reuse checklist and the video storyboard', pages === 4 && /Delivered late because the vendor adapter slipped/.test(docT) && /Put penalties in vendor contracts/.test(docT) && /Check vendor delivery dates/.test(docT) && gfx.ph && gfx.cost && gfx.tl && gfx.fish && gfx.kpis === 4 && charts1 === 2 && (global.LL_REP.documents || []).some((d) => /escalate to the vendor/.test(d.text)) && global.LL_REP.lessons_log.length >= 3, JSON.stringify([pages, gfx, charts1, (global.LL_REP.documents || []).length]));
      const [wd] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }).catch(() => null), p.click('#llWord')]);
      let wsize = 0; if (wd) { await wd.saveAs('/tmp/ll.docx'); wsize = fs.statSync('/tmp/ll.docx').size; }
      await p.click('#llVid'); if (process.env.DOC_ONLY) { for (const [k, ms] of [[1, 2000], [2, 6500], [3, 6000], [4, 6000], [5, 6000], [6, 6000]]) { await sleep(ms); const cvs = await p.$('#llCv'); if (cvs) await cvs.screenshot({ path: `/tmp/llvid${k}.png` }).catch(() => {}); } }
      await p.waitForFunction(() => /seconds\)/.test((document.querySelector('#llVs') || {}).textContent || ''), null, { timeout: 60000 }).catch(() => {}); const vlen = await p.textContent('#llVs').catch(() => ''); await p.waitForSelector('#llVo video', { timeout: 80000 }).catch(() => {});
      const vs = await p.textContent('#llVs').catch(() => '');
      await p.click('#llVKeep').catch((e) => console.log('llVKeep: ' + e.message.slice(0, 120))); await sleep(5000); console.log('LLTOAST ' + (await p.evaluate(() => [...document.querySelectorAll('.toast, #toast, [class*=toast]')].map((x) => x.textContent).join(' | '))));
      const L2 = await (await api('intelDmsList', { core: lc })).json(), reps = L2.docs.filter((d) => d.folder === 'reports');
      ok('Lessons', '⬇ Word, 🎬 the 45-second scribe video in five parts (about, went well, what did not, recommendations, lessons; drawn and recorded in the browser), and 💾 both saved to the project\'s Documents (Reports, in R2)', wsize > 5000 && /video is ready/.test(vs) && (+((vlen.match(/\((\d+) seconds\)/) || [])[1] || 99)) <= 45 && reps.some((d) => /\.docx$/.test(d.name) && d.r2) && reps.some((d) => /video\.webm$/.test(d.name) && d.r2 && d.size > 1000), JSON.stringify([wsize, vs, vlen, reps.map((d) => [d.name, d.size])]));
      await p.click('#llVStop').catch(() => {}); await p.click('#llClose').catch(() => {});
      await api('guideAsk', { q: 'What lessons apply here?', core: lc, tours: [] }); const gx = (global.GUIDE_CTX || {}).project || {};
      ok('Lessons', 'Champ knows the project\'s lessons and the ones from past projects that fit', (gx.lessons_logged || []).length >= 3 && (gx.lessons_from_past_projects || []).some((l) => /adapter/.test(l.lesson) && l.from === 'Old payments project'), JSON.stringify([gx.lessons_logged, gx.lessons_from_past_projects]).slice(0, 300));
      await api('planProjectDelete', { core: lc }); await api('planProjectDelete', { core: oc });
    }
    // 📁 Documents: the project's repository in R2: filed by folder, versions, status, search, AI analysis against the plan, review of all
    {
      const mc = (await (await api('planNewProject', { name: 'Docs check', client: 'Internal', program: 'Digital health' })).json()).core;
      await api('planSave', { core: mc, plan: { name: 'Payments portal', start: new Date().toISOString().slice(0, 10), phases: [{ id: 'ph1', name: 'Work' }], tasks: [{ id: 'a', phase: 'ph1', name: 'Design the screens', dur: 5, pred: [], res: [], pct: 0, status: 'todo' }] } });
      fs.writeFileSync('/tmp/BRD Payments.txt', 'Business Requirements Document\n\n1. The portal shall take card payments through a payment gateway.\n\n2. Go-live is 30 June.\n\n' + 'The payment gateway must be PCI DSS compliant. '.repeat(5));
      fs.writeFileSync('/tmp/Minutes 12 Oct.txt', 'Minutes of the steering committee meeting\n\nAttendees: the sponsor, the PM.\n\nDecisions: approve the BRD.');
      fs.copyFileSync(path.join(SITE, 'tools/test-data/depot-requirements.xlsx'), '/tmp/Budget.xlsx');
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'); fs.writeFileSync('/tmp/Site photo.png', png);
      const before = global.R2S.size;
      await p.goto(`${BASE}/admin/#plan/${mc}/docs`); await p.reload(); await p.waitForSelector('#dmFile', { state: 'attached', timeout: 10000 }).catch(() => {});
      await p.setInputFiles('#dmFile', ['/tmp/BRD Payments.txt', '/tmp/Minutes 12 Oct.txt', '/tmp/Site photo.png', '/tmp/Budget.xlsx']);
      await p.waitForFunction(() => document.querySelectorAll('.dm-tbl tbody tr').length >= 4, null, { timeout: 30000 }).catch(() => {});
      let L = await (await api('intelDmsList', { core: mc })).json(); const by = (n) => L.docs.find((d) => d.name === n) || {};
      ok('Documents', 'upload several files at once: each is stored in R2 under the project and filed in the right folder (BRD → Requirements, minutes → Meeting minutes); a picture with no text is kept too', L.docs.length === 4 && by('BRD Payments.txt').folder === 'requirements' && by('Minutes 12 Oct.txt').folder === 'meetings' && by('Site photo.png').hasFile && !by('Site photo.png').words && L.docs.every((d) => d.r2 && d.r2.startsWith('projects/' + mc + '/')) && global.R2S.size - before === 4 && by('BRD Payments.txt').status === 'Draft' && by('BRD Payments.txt').version === 1, JSON.stringify(L.docs.map((d) => [d.name, d.folder, d.status, d.version, !!d.r2, d.words])));
      const brd = by('BRD Payments.txt').id;
      await p.selectOption(`[data-dms="${brd}"]`, 'Approved'); await sleep(1200);
      await p.click('[data-dmfo="requirements"]'); await sleep(400); const reqRows = await p.$$eval('.dm-tbl tbody tr', (r) => r.length);
      fs.writeFileSync('/tmp/BRD Payments v2.txt', 'Business Requirements Document version 2\n\n1. The portal shall take card payments through a payment gateway.\n\n2. Go-live is 30 June.\n\n3. A reporting dashboard is needed.');
      const [fc] = await Promise.all([p.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null), p.click(`[data-dmnv="${brd}"]`)]);
      if (fc) await fc.setFiles('/tmp/BRD Payments v2.txt'); else console.log('no file chooser');
      for (let i = 0; i < 40; i++) { await sleep(500); const l2 = await (await api('intelDmsList', { core: mc })).json(); if (l2.docs.some((d) => d.name === 'BRD Payments v2.txt')) break; } await sleep(1500);
      L = await (await api('intelDmsList', { core: mc })).json(); const v1 = L.docs.find((d) => d.id === brd), v2 = L.docs.find((d) => d.name === 'BRD Payments v2.txt') || {};
      ok('Documents', 'status (Approved), folders as filters, and a new version: v2 is current (Draft), v1 is kept as Superseded (only the current version goes to Ask AI)', reqRows === 1 && v1.status === 'Superseded' && v1.superseded === v2.id && v2.version === 2 && v2.group === brd && v2.folder === 'requirements' && v2.status === 'Draft', JSON.stringify([reqRows, v1 && [v1.status, v1.superseded], [v2.version, v2.group, v2.folder, v2.status]]));
      await p.fill('#dmQ', 'reporting dashboard'); await p.waitForSelector('.dm-hit', { timeout: 8000 }).catch(() => {}); const hit = await p.textContent('#dmHits').catch(() => '');
      await p.fill('#dmQ', ''); await sleep(500);
      await p.click(`[data-dmai="${v2.id}"]`); await p.waitForSelector('#dmApply', { timeout: 40000 }).catch(() => {});
      const an = await p.textContent('#dmA').catch(() => '');
      await p.click('#dmApply').catch(() => {}); await sleep(2500);
      const pl = (await (await api('planGet', { core: mc })).json()).plan;
      ok('Documents', 'search finds words inside the documents; 🧠 analyses a document against the plan (requirements in or not in the plan, conflicts, gaps) and adds the ticked task and risk to the project', /BRD Payments v2/.test(hit) && /Partly aligned/.test(an) && /Card payments through a payment gateway/.test(an) && /Go-live date/.test(an) && pl.tasks.some((t) => t.name === 'Integrate the payment gateway' && t.pred.join() === 'a') && (pl.risks || []).some((r) => /certification takes 8 weeks/.test(r.title) && /BRD Payments/.test(r.cause)) && /reporting dashboard/.test(global.DMS_DOC.text) && global.DMS_PROJECT.tasks.length === 1, JSON.stringify([hit.slice(0, 80), an.slice(0, 120), pl.tasks.map((t) => t.name)]));
      await p.click('#dmRev').catch(() => {}); await p.waitForSelector('.dm-cov', { timeout: 40000 }).catch(() => {});
      const rv = await p.textContent('#dmR').catch(() => '');
      ok('Documents', '🧠 Review all against the plan: coverage, missing documents, conflicts and next steps (current versions only; analysed ones by their analysis)', /no test strategy/.test(rv) && /Testing/.test(rv) && /A test strategy/.test(rv) && global.DMS_SET.length === 4 && global.DMS_SET.some((d) => d.analysis && d.analysis.alignment === 'partly aligned') && !global.DMS_SET.some((d) => d.name === 'BRD Payments.txt'), JSON.stringify([rv.slice(0, 120), (global.DMS_SET || []).map((d) => d.name)]));
      await p.click('[data-close]').catch(() => {});
      p.once('dialog', (dg) => dg.accept()); await p.click(`[data-dmx="${v2.id}"]`).catch(() => {}); await sleep(2500);
      L = await (await api('intelDmsList', { core: mc })).json(); const back = L.docs.find((d) => d.id === brd) || {};
      const gone = ![...global.R2S.keys()].some((k) => k === v2.r2);
      ok('Documents', 'deleting the current version removes its file from R2 and brings the version before back (Approved again)', !L.docs.some((d) => d.id === v2.id) && !back.superseded && back.status === 'Approved' && gone, JSON.stringify([back.status, back.superseded, gone]));
      await api('planProjectDelete', { core: mc });
    }
    // 🔇 when Azure turns the key down, Champ speaks with the browser's own voice, and the watch says why (once checked)
    {
      global.AZ_FAIL = 401;
      const vc = (await (await api('planNewProject', { name: 'Voice check', client: 'Internal', program: 'Digital health' })).json()).core;
      await api('planSave', { core: vc, plan: { name: 'Voice', start: '2026-01-05', phases: [{ id: 'ph1', name: 'Work' }], tasks: [{ id: 'a', phase: 'ph1', name: 'Late work', dur: 20, pred: [], res: [], pct: 10, status: 'doing' }], issues: [{ id: 'i1', title: 'Blocked', priority: 'Critical', status: 'Open' }] } });
      await p.goto(`${BASE}/admin/#plan/${vc}/overview`); await p.reload(); await p.waitForSelector('#cgBtn', { timeout: 10000 }).catch(() => {});
      await p.evaluate(() => { window.__said = []; try { sessionStorage.removeItem('cgSaid'); } catch (e) {} if (window.speechSynthesis) { const o = window.speechSynthesis.speak.bind(window.speechSynthesis); window.speechSynthesis.speak = (u) => { window.__said.push(u.text); setTimeout(() => u.onend && u.onend(), 30); }; } });
      await p.click('#cgBtn'); await p.waitForSelector('.cgp-brief.cgb-ai', { timeout: 30000 }).catch(() => {}); await sleep(3000);
      const said = await p.evaluate(() => (window.__said || []).join(' '));
      await p.click('.cgp-x').catch(() => {});
      const wb = await (await api('watchBoard', { refresh: true, voice: true })).json();
      global.AZ_FAIL = 0; const wb2 = await (await api('watchBoard', { refresh: true, voice: true })).json();
      ok('Champ watch', '🔇 if Azure turns the voice key down, Champ still speaks (the browser\'s own voice) and Champ\'s watch says why and how to fix it; it clears once the voice works again', /Heads up/.test(said) && /If this were my project/.test(said) && wb.voice && /AZURE_SPEECH_KEY/.test(wb.voice.why) && !wb2.voice, JSON.stringify([said.slice(0, 120), wb.voice, wb2.voice]));
      await api('planProjectDelete', { core: vc });
    }
    // 🔗 the AI works out the dependencies; the PM reviews them (and the new finish), applies them, sees the arrows, can undo
    {
      const dc = (await (await api('planNewProject', { name: 'Deps check', client: 'Internal', program: 'Digital health' })).json()).core;
      await api('planSave', { core: dc, plan: { name: 'Website', start: new Date().toISOString().slice(0, 10), phases: [{ id: 'ph1', name: 'Work' }], tasks: [
        { id: 'a', phase: 'ph1', name: 'Design', dur: 5, pred: [], res: [], pct: 0, status: 'todo' }, { id: 'b', phase: 'ph1', name: 'Build', dur: 10, pred: ['a'], res: [], pct: 0, status: 'todo' },
        { id: 'c', phase: 'ph1', name: 'Write content', dur: 8, pred: ['b'], res: [], pct: 0, status: 'todo' }, { id: 'd', phase: 'ph1', name: 'Launch', dur: 2, pred: ['c'], res: [], pct: 0, status: 'todo' }] } });
      await p.goto(`${BASE}/admin/#plan/${dc}/schedule`); await p.reload(); await p.waitForSelector('#depAi', { timeout: 10000 }).catch(() => {});
      await p.click('#depAi', { timeout: 8000 }).catch(async (e) => { await p.screenshot({ path: '/tmp/deps-fail.png' }); console.log('depAi: ' + e.message.split('\n').slice(0, 6).join(' | ')); }); await p.waitForSelector('#dpGo', { timeout: 30000 }).catch(() => {});
      const fin = await p.textContent('#dpFin').catch(() => ''), rowsT = await p.$$eval('.dp-tbl tbody tr', (r) => r.map((x) => x.textContent));
      await p.click('#dpGo').catch(() => {}); await sleep(2500);
      const pl = (await (await api('planGet', { core: dc })).json()).plan, by = Object.fromEntries(pl.tasks.map((t) => [t.id, t.pred.join(',')]));
      const und = !!(await p.$('#depUndo'));
      if (!(await p.$('[data-links].on'))) await p.click('[data-links]', { timeout: 8000 }).catch((e) => console.log('links: ' + e.message.split('\n').slice(0, 6).join(' | '))); await sleep(800);
      const arrows = await p.$$eval('#gRight svg.glinks path[d]', (x) => x.length).catch(() => 0);
      ok('Gantt', '🔗 Work out dependencies: the AI\'s links are shown with the reasons and the new finish (sooner, work in parallel), applied only when the PM says so; no loops; arrows on the Gantt', /days sooner/.test(fin) && rowsT.length === 2 && rowsT.some((x) => /Write content/.test(x) && /Needs the design, not the build/.test(x)) && by.c === 'a' && by.d.split(',').sort().join() === 'b,c' && und && arrows >= 4 && (global.DEPS_USER.tasks || []).length === 4, JSON.stringify([fin, rowsT, by, und, arrows]));
      await p.click('#depUndo').catch(() => {}); await sleep(2500);
      const pl2 = (await (await api('planGet', { core: dc })).json()).plan;
      ok('Gantt', '↶ Undo links puts the dependencies back as they were', pl2.tasks.find((t) => t.id === 'c').pred.join() === 'b' && pl2.tasks.find((t) => t.id === 'd').pred.join() === 'c', JSON.stringify(pl2.tasks.map((t) => t.pred)));
      await p.click('[data-links]').catch(() => {});
      await api('planProjectDelete', { core: dc });
    }
    // 🌳 WBS: the Gantt's rightmost button turns the plan into a Work Breakdown Structure (read only), saved as PNG or JPEG
    {
      const wc = (await (await api('planNewProject', { name: 'WBS check', client: 'Internal', program: 'Digital health' })).json()).core;
      await api('planSave', { core: wc, plan: { name: 'Office fit-out', start: new Date().toISOString().slice(0, 10), phases: [{ id: 'ph1', name: 'Work' }], tasks: [
        { id: 'a', phase: 'ph1', name: 'Project initiation and team onboarding', dur: 3, pred: [], res: [], pct: 100, status: 'done', subs: [{ id: 's1', name: 'Kickoff meeting', owner: '', off: 0, dur: 1, status: 'done' }, { id: 's2', name: 'Team onboarding', owner: '', off: 1, dur: 2, status: 'todo' }] },
        { id: 'b', phase: 'ph1', name: 'Design', dur: 5, pred: ['a'], res: [], pct: 40, status: 'doing' }, { id: 'c', phase: 'ph1', name: 'Handover', dur: 0, pred: ['b'], res: [], pct: 0, status: 'todo' }] } });
      await p.goto(`${BASE}/admin/#plan/${wc}/schedule`); await p.reload(); await p.waitForSelector('[data-wbs]', { timeout: 10000 }).catch(() => {});
      const last = await p.$$eval('.pviews > *', (x) => x.length ? x[x.length - 1].textContent : '');
      await p.click('[data-wbs]'); await p.waitForSelector('#wbsWrap svg', { timeout: 8000 }).catch(() => {});
      const st = await p.$$eval('#wbsWrap svg text', (t) => t.map((x) => x.textContent).join('|')).catch(() => '');
      const editable = await p.$$('#wbsWrap input, #wbsWrap textarea, #wbsWrap [contenteditable]');
      const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }).catch(() => null), p.click('#wbsPng')]);
      const fn = dl ? dl.suggestedFilename() : ''; let png = false; if (dl) { await dl.saveAs('/tmp/wbs.png'); png = fs.readFileSync('/tmp/wbs.png').slice(1, 4).toString() === 'PNG'; }
      const [dj] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }).catch(() => null), p.click('#wbsJpg')]);
      const jpg = dj ? /\.jpg$/.test(dj.suggestedFilename()) : false;
      await p.click('#planBody [data-wbs]'); await sleep(500);
      const back = (await p.$$('#planBody .gt')).length > 0;
      ok('Gantt', '🌳 WBS (rightmost view button): the plan as a Work Breakdown Structure (project, work packages, sub-tasks), read only; saved as PNG or JPEG; back to the Gantt', /WBS/.test(last) && /Office fit-out/.test(st) && /Project initiation and/.test(st) && /1\.1/.test(st) && /Kickoff meeting/.test(st) && /milestone/.test(st) && editable.length === 0 && png && fn === 'WBS - Office fit-out.png' && jpg && back, JSON.stringify([last, st.slice(0, 200), editable.length, fn, png, jpg, back]));
      if (process.env.DOC_ONLY) await p.screenshot({ path: '/tmp/wbsview.png', fullPage: false });
      await api('planProjectDelete', { core: wc });
    }
    if (process.env.DOC_ONLY) { for (const x of results.filter((r) => /New project|Sign-ins|Gantt|Knowledge|R2|Costing|Champ watch|Documents|Lessons/.test(r.area) || !r.pass)) console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.pass ? '' : '  → ' + x.detail}`); console.log(errors.join('\n')); try { srv.kill(); } catch (e) {} process.exit(0); }
  }
  // ---- 🌐 language audit: with the console in Malay, every page and every project tab must show no English ----
  {
    const ap = (await (await api('planNewProject', { name: 'Audit web app', client: 'Acme', program: 'Digital health' })).json()).core;
    await p.goto(`${BASE}/admin/#plan/${ap}`); await p.waitForSelector('[data-mode=type]', { timeout: 10000 }).catch(() => {});
    await p.fill('#tplScope', 'A three-tier web application for online orders.').catch(() => {}); await p.click('[data-mode=type]').catch(() => {}); await p.waitForSelector('#tplType', { timeout: 5000 }).catch(() => {});
    await p.selectOption('#tplType', 'cl-3tier').catch(() => {}); await sleep(500); await p.click('#tplCreate').catch(() => {}); await sleep(2500);
    await p.evaluate(() => { localStorage.setItem('champLang', 'ms'); localStorage.setItem('champChatLang', 'ms'); });
    const ALLOW = /^(GKH|Project Champ|Champ|GKH Project Champ|PC \d[\d.]*|sashi73|Owner|AI|BOM|SWMS|RACI|Gantt|Kanban|PMBOK|SPI|CPI|EAC|BAC|SQL|CSV|PDF|Word|MS|EN|Acme)$/;
    const audit = async (where) => {
      await sleep(400); for (let i = 0; i < 40; i++) { if (!(await p.evaluate(() => document.documentElement.classList.contains('i18n-busy')).catch(() => false))) break; await sleep(250); } await sleep(1600);
      const left = await p.evaluate((allow) => {
        const A = new RegExp(allow), out = [], vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity !== 0; };
        const skip = 'script,style,noscript,code,pre,svg,textarea,input,[contenteditable],[data-noi18n],.cc-box,.ct-langmenu,.ref,#stkPop';
        const bad = (t) => { t = t.trim(); return t && /\p{L}/u.test(t) && !/\[Bahas/i.test(t) && !A.test(t) && !/^[\w.+-]+@[\w.-]+$/.test(t) && !/^[A-Z]{1,3}-[\d-]+$/.test(t) && !/^https?:/.test(t) && !/^[\d\s.,:%$/()+\-–·×]+[a-z]{0,2}$/i.test(t); };
        const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
        for (let n = w.nextNode(); n; n = w.nextNode()) { const el = n.parentElement; if (!el || el.closest(skip)) continue; if (el.tagName === 'OPTION') { const sel = el.closest('select'); if (!sel || !vis(sel) || sel.closest(skip)) continue; } else if (!vis(el)) continue; if (bad(n.nodeValue)) out.push(n.nodeValue.trim().slice(0, 60)); }
        document.querySelectorAll('[placeholder]').forEach((el) => { if (vis(el) && !el.closest('[data-noi18n],.cc-box') && bad(el.getAttribute('placeholder'))) out.push('placeholder: ' + el.getAttribute('placeholder').slice(0, 50)); });
        return [...new Set(out)];
      }, ALLOW.source).catch((e) => ['(audit failed: ' + e.message + ')']);
      if (left.length) console.log('AUDITDBG', where, global.I18N_CALLS, JSON.stringify(await p.evaluate(async (t) => { let c = {}; try { c = JSON.parse(localStorage.getItem('champI18n:ms') || '{}'); } catch (e) {} const r = await fetch('/.netlify/functions/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'i18n', lang: 'ms', strings: [t] }) }).then((x) => x.status + ' ' + x.statusText).catch((e) => e.message); return [Object.keys(c).length, c[t] || null, document.documentElement.lang, r]; }, left[0]).catch((e) => e.message)));
      ok('Language audit', where + ' has no English left (Malay)', left.length === 0, left.length + ': ' + left.slice(0, 25).join(' | '));
    };
    await p.goto(`${BASE}/admin/#programs`); await p.reload(); await p.waitForSelector('#app:not([hidden])', { timeout: 10000 }).catch(() => {});
    const navs = await p.$$eval('.side-nav a[href^="#"]:not([hidden])', (as) => as.map((a) => a.getAttribute('href')));
    for (const h of navs) { await p.goto(`${BASE}/admin/${h}`); await audit('Page ' + h); }
    const tabsA = ['overview', 'schedule', 'budget', 'critical', 'board', 'bom', 'stakeholders', 'scope', 'risks', 'issues', 'contracts', 'comms', 'reports', 'change', 'intel'];
    for (const t of tabsA) { await p.goto(`${BASE}/admin/#plan/${ap}/${t}`); await p.waitForSelector('#planBody', { timeout: 8000 }).catch(() => {}); await audit('Project tab ' + t); }
    await p.goto(`${BASE}/admin/#plan/${ap}/schedule`); await sleep(800); await p.click('[data-dact=plan]').catch(() => {}); await audit('Project plan window');
    await p.goto(`${BASE}/admin/#plan/${ap}/schedule`); await sleep(800); await p.click('[data-dact=charter]').catch(() => {}); await audit('Charter window');
    await p.evaluate(() => { localStorage.removeItem('champLang'); localStorage.removeItem('champChatLang'); });
    await api('planProjectDelete', { core: ap });
    if (process.env.SHOTS) {   // 📱 screenshots of the console on a phone (390 × 844) and a tablet, for design work
      fs.mkdirSync('/tmp/shots', { recursive: true });
      const sc = (await (await api('planNewProject', { name: 'Hospital ERP rollout', client: 'Northside Health', program: 'Digital health' })).json()).core;
      const T0 = [['Kick-off and charter', 2, 100], ['Requirements workshops', 5, 60], ['Solution design', 6, 20], ['Configuration and build', 15, 0], ['Data migration', 10, 0], ['User acceptance testing', 8, 0], ['Go-live', 1, 0]];
      await api('planSave', { core: sc, plan: { name: 'Hospital ERP rollout', start: '2026-11-02', phases: [{ id: 'ph1', name: 'Work' }], tasks: T0.map((t, i) => ({ id: 't' + i, phase: 'ph1', name: t[0], dur: t[1], pred: i ? ['t' + (i - 1)] : [], qty: t[1] * 8, unit: 'h', rate: 150, pct: t[2], status: t[2] >= 100 ? 'done' : t[2] ? 'doing' : 'todo', res: i % 2 ? ['Priya Shah'] : ['Tom Walsh'] })),
        risks: [{ id: 'r1', title: 'Key users not available for testing', p: 3, i: 4, response: 'Mitigate', status: 'Open' }] } });
      for (const [w, h, tag] of [[390, 844, 'phone'], [820, 1180, 'tablet']]) {
        const mp = await ctx.newPage(); await mp.setViewportSize({ width: w, height: h });
        const shot = async (name, url, act) => { await mp.goto(`${BASE}${url}`); await sleep(1800); if (act) { await act(mp).catch(() => {}); await sleep(1200); } await mp.screenshot({ path: `/tmp/shots/${tag}-${name}.png`, fullPage: false }); };
        await shot('home', '/index.html'); await shot('login', '/login.html');
        await shot('programs', '/admin/#programs'); await shot('summary', '/admin/#portfolio/summary'); await shot('pipeline', '/admin/#portfolio/board'); await shot('projects', '/admin/#projects');
        await shot('overview', `/admin/#plan/${sc}/overview`); await shot('schedule', `/admin/#plan/${sc}/schedule`); await toKanban(sc); await shot('board', `/admin/#plan/${sc}/board`); await shot('budget', `/admin/#plan/${sc}/budget`);
        await shot('risks', `/admin/#plan/${sc}/risks`); await shot('people', '/admin/#people'); await shot('users', '/admin/#users');
        await shot('menu', '/admin/#programs', async (q) => { const b = await q.$('#menuBtn, .menu-btn, #sideToggle, .burger, [aria-label*="menu" i]'); if (b) await b.click(); });
        await shot('askchamp', '/admin/#programs', async (q) => { await q.click('#cgBtn'); });
        await mp.close();
      }
      console.log('SHOTS done'); try { srv.kill(); } catch (e) {} process.exit(0);
    }
    if (process.env.AUDIT_ONLY) { try { srv.kill(); } catch (e) {} const bad = results.filter((x) => !x.pass); for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'}  [${x.area}] ${x.name}${x.pass ? '' : '  → ' + x.detail}`); console.log(`\n${results.length - bad.length}/${results.length} passed`); process.exit(0); }
    await p.goto(`${BASE}/admin/#programs`); await p.reload(); await p.waitForSelector('#app:not([hidden])', { timeout: 10000 }).catch(() => {}); await sleep(800);
  }
  const menu = await p.$$eval('.side-nav a:not([hidden])', (as) => as.map((a) => a.textContent.trim()));
  ok('Console', 'menu shows only the project element (+ admin)', JSON.stringify(menu) === JSON.stringify(['🗂Programs', '🔗Dependency board', '📊Summary', '▦Pipeline board', '📅All projects', '＋New project', '👥People', '📅Team calendar', '📊Workload', '🙋My profile', '📨Enquiries', '👋Visitors & leads', '✨Ask AI', '📈Reports & data', '🔐Users & access', '📚Knowledge base', '🕘Activity log', '🏷Builds']), menu.join(' | '));
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
  await toKanban(core); await p.goto(`${BASE}/admin/#plan/${core}/board`); await p.reload(); await sleep(2000);
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
  ok('Modules', '⚙ Modules opens sliders for change control, BOM and SWMS', (await p.$$('#modPop [data-mod]')).length === 3 && !!(await p.$('#modPop [data-mod=change]')));
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
  // the decision is kept for good: database record + signed PDF, readable by the team, SQL and Project Intelligence
  await sleep(2500);
  const recs = (await (await api('intelCrList', { core: esg })).json()).records || [];
  ok('Change records', 'the approval is kept in the database: CR-001, approved by Sashi Kumar Sivam, signed, with its effect', recs.length === 1 && recs[0].cr === 'CR-001' && recs[0].outcome === 'Approved' && recs[0].by === 'Sashi Kumar Sivam' && !!recs[0].sig && Math.abs(recs[0].b1 - 380000) < 1, JSON.stringify(recs).slice(0, 300));
  const rpdf = recs[0] ? await (await api('intelCrGet', { core: esg, key: recs[0].key })).json() : {};
  ok('Change records', 'the signed change request PDF is stored and can be downloaded', /^JVBERi/.test(rpdf.file || '') && /\.pdf$/.test(rpdf.name || ''), (rpdf.name || '') + ' ' + String(rpdf.file || rpdf.error || '').slice(0, 20));
  await p.goto(`${BASE}/admin/#plan/${esg}/change`); await p.waitForSelector('[data-crpdf]', { timeout: 10000 }).catch(() => {}); await sleep(2000);
  gp = (await (await api('planGet', { core: esg })).json()).plan;
  ok('Change records', 'the plan marks the change request as recorded (no duplicate record)', gp.changes[0].recorded === recs[0].at && ((await (await api('intelCrList', { core: esg })).json()).records || []).length === 1, JSON.stringify([gp.changes.map((c) => [c.id, c.recorded, c.decision && c.decision.at]), recs.map((r) => [r.crId, r.at])]));
  ok('Change records', 'Change control lists the decision records with a PDF download', /Decision records \(1\)/.test(await p.textContent('#planBody').catch(() => '')) && !!(await p.$('[data-crpdf]')));
  await p.goto(`${BASE}/admin/#plan/${esg}/intel`); await p.reload(); await p.waitForSelector('#piQ', { timeout: 10000 }).catch(() => {});
  global.INTEL_CTX = null; await p.fill('#piQ', 'List all the approved changes in this project'); await p.click('#piGo'); for (let i = 0; i < 60 && !global.INTEL_CTX; i++) await sleep(500);
  const IC = global.INTEL_CTX || {};
  ok('Change records', 'Project Intelligence sees the change register and the signed records (who approved)', (IC.change_requests || []).some((c) => c.cr === 'CR-001' && c.decision && c.decision.by === 'Sashi Kumar Sivam' && c.decision.signed) && (IC.change_records || []).some((c) => c.cr === 'CR-001' && c.by === 'Sashi Kumar Sivam' && c.signed_pdf_kept), JSON.stringify([IC.change_requests, IC.change_records]).slice(0, 300));
  const sq = await (await api('sqlData')).json();
  ok('Change records', 'the change_records table can be queried (who approved what)', ((sq.data || {}).change_records || []).some((r) => r.cr === 'CR-001' && r.approved_by === 'Sashi Kumar Sivam' && r.decision === 'Approved' && r.signed), JSON.stringify((sq.data || {}).change_records || sq.error).slice(0, 200));
  // ---- 💰 Budget, 📜 designed charter (max 4 pages), 📘 designed project plan (~20 pages), PDF and Word, in English and Malay ----
  const fsx = require('fs'), { execSync } = require('child_process'), pagesOf = (f) => { try { return Number((execSync('pdfinfo ' + f).toString().match(/Pages:\s+(\d+)/) || [])[1] || 0); } catch (e) { return -1; } };
  await p.goto(`${BASE}/admin/#plan/${esg}/budget`); await p.reload(); await p.waitForSelector('.bd-tiles', { timeout: 10000 }).catch(() => {});
  const bt = await p.textContent('#planBody').catch(() => '');
  ok('Budget', 'the Budget tab works out base cost, contingency, reserve and total', /Base cost \(BAC\)/.test(bt) && /Contingency 10%/.test(bt) && /Total budget/.test(bt) && (await p.$$('.bd-ch')).length >= 2, bt.slice(0, 200));
  ok('Budget', 'the documents bar replaces Quote and invoice: Budget, Project charter, Project plan', (await p.$$('.docs3 .vstep')).length === 3 && !/Make the quote/.test(await p.textContent('#planChain').catch(() => '')));
  await p.fill('[data-bcfg=cont]', '20'); await p.dispatchEvent('[data-bcfg=cont]', 'change'); await sleep(400);
  ok('Budget', 'changing the contingency updates the totals', /Contingency 20%/.test(await p.textContent('.bd-tiles').catch(() => '')));
  await p.click('#bdSet'); await p.waitForSelector('#bdF', { timeout: 5000 }).catch(() => {}); await p.fill('#bdF [name=sig]', 'Sashi Kumar Sivam').catch(() => {}); await p.click('#bdF [type=submit]').catch(() => {}); await sleep(2000);
  gp = (await (await api('planGet', { core: esg })).json()).plan;
  ok('Budget', 'the budget is approved with a sign-off: the charter budget follows (base + 20% + 5%), with who signed', gp.budgetCfg && gp.budgetCfg.setSig === 'Sashi Kumar Sivam' && !!gp.budgetCfg.setRole && gp.budgetCfg.cont === 20 && Math.abs(gp.charter.budget - Math.round(R1x.BAC * 1.25 * 100) / 100) < 2, JSON.stringify([gp.charter.budget, R1x.BAC]));
  const dl = async (sel, file) => { const [d] = await Promise.all([p.waitForEvent('download', { timeout: process.env.CI ? 180000 : 60000 }), p.click(sel)]); await d.saveAs(file); return file; };
  await p.click('[data-dact=charter]'); await p.waitForSelector('#chPdf', { timeout: 5000 }).catch(() => {});
  const chf = await dl('#chPdf', '/tmp/champ-charter.pdf').catch((e) => (console.log('charter dl: ' + e.message), ''));
  ok('Documents', 'the designed project charter downloads as a PDF of at most 4 pages', chf && pagesOf(chf) >= 1 && pagesOf(chf) <= 4, pagesOf(chf) + ' pages');
  const chw = await dl('#chDocx', '/tmp/champ-charter.docx').catch(() => '');
  ok('Documents', 'the charter downloads as Word', chw && fsx.statSync(chw).size > 8000, chw && fsx.statSync(chw).size);
  await p.click('#modal [data-close]').catch(() => {}); await sleep(300);
  await p.click('[data-dact=plan]'); await p.waitForSelector('#pdAi', { timeout: 5000 }).catch(() => {});
  global.PLANDOC_CALLS = 0; await p.click('#pdAi'); await p.waitForFunction(() => /Narrative written/.test((document.querySelector('#pdState') || {}).textContent || ''), null, { timeout: 60000 }).catch(() => {});
  ok('Documents', 'the AI writes the plan narrative in three parts, within the 50,000-token budget', global.PLANDOC_CALLS === 3 && global.PLANDOC_MAX <= 12000 && /Narrative written/.test(await p.textContent('#pdState').catch(() => '')), global.PLANDOC_CALLS + ' calls, max ' + global.PLANDOC_MAX);
  const plf = await dl('#pdPdf', '/tmp/champ-plan.pdf').catch((e) => (console.log('plan dl: ' + e.message), ''));
  ok('Documents', 'the designed project plan downloads as a PDF of about 20 pages', plf && pagesOf(plf) >= 16 && pagesOf(plf) <= 32, pagesOf(plf) + ' pages');
  const plw = await dl('#pdDocx', '/tmp/champ-plan.docx').catch(() => '');
  ok('Documents', 'the project plan downloads as Word', plw && fsx.statSync(plw).size > 30000, plw && fsx.statSync(plw).size);
  await p.selectOption('#pdLang', 'ms'); await p.click('#pdAi'); await sleep(500); await p.waitForFunction(() => /Bahasa Melayu/.test((document.querySelector('#pdState') || {}).textContent || ''), null, { timeout: 60000 }).catch(() => {});
  ok('Documents', 'in Bahasa Melayu the AI writes the narrative in Malay', /Bahasa Melayu/.test(global.PLANDOC_SYS || ''));
  const plm = await dl('#pdPdf', '/tmp/champ-plan-ms.pdf').catch((e) => (console.log('plan ms dl: ' + e.message), ''));
  let msTxt = ''; try { msTxt = execSync('pdftotext -l 6 /tmp/champ-plan-ms.pdf -').toString(); } catch (e) {}
  ok('Documents', 'the Malay plan has the Malay narrative and translated headings', /Pasukan projek/.test(msTxt) && /\[Bahas/.test(msTxt), msTxt.slice(0, 200).replace(/\s+/g, ' '));
  ok('Documents', 'no English left: "Contents", "Inside this plan" and the dates are in Malay too', /\[Bahas\] Contents/.test(msTxt) && /\[BAHAS\] INSIDE THIS PLAN/i.test(msTxt) && !/(^|[^\]] )Contents/m.test(msTxt.replace(/\[Bahas\] Contents/g, '')), (msTxt.match(/.{0,30}Contents.{0,10}/g) || []).join(' | '));
  // 🎨 colour schemes: pick Ocean, the plan comes out in navy and sky blue (no AI used)
  await p.selectOption('#pdLang', 'en'); await p.click('[data-thm=ocean]'); await sleep(1500);
  const plo = await dl('#pdPdf', '/tmp/champ-plan-ocean.pdf').catch(() => '');
  let cov = ''; try { execSync('pdftoppm -r 20 -png -f 1 -l 1 /tmp/champ-plan-ocean.pdf /tmp/ocean'); cov = execSync("python3 -c \"from PIL import Image;import glob;im=Image.open(sorted(glob.glob('/tmp/ocean*.png'))[0]).convert('RGB');print(im.getpixel((5,5)))\"").toString().trim(); } catch (e) { cov = e.message; }
  gp = (await (await api('planGet', { core: esg })).json()).plan;
  ok('Documents', 'a colour scheme (Ocean) is kept with the project and the plan comes out in it', gp.docTheme === 'ocean' && /\((\d+), (\d+), (\d+)\)/.test(cov) && (() => { const m = cov.match(/(\d+), (\d+), (\d+)/); return +m[3] > +m[1] + 15; })(), gp.docTheme + ' ' + cov);
  await p.click('[data-thm=champ]'); await sleep(800);
  await p.selectOption('#pdLang', 'ta');
  const [pop] = await Promise.all([p.waitForEvent('popup', { timeout: 30000 }).catch(() => null), p.click('#pdPdf')]);
  if (pop) await pop.waitForFunction(() => document.documentElement.lang === 'ta', null, { timeout: 30000 }).catch(() => {});
  ok('Documents', 'in Tamil the PDF opens as a print view (the browser draws Tamil properly)', !!pop && (await pop.evaluate(() => document.documentElement.lang).catch(() => '')) === 'ta', pop ? await pop.evaluate(() => document.documentElement.lang).catch((e) => e.message) : 'no popup');
  if (pop) await pop.close().catch(() => {});
  await p.click('#modal [data-close]').catch(() => {});
  // ---- 🔁 change control as a module: off = committed straight away; 🧱 BOM signed off = in the costing; 🗒 notes move ----
  {
    const cc = (await (await api('planNewProject', { name: 'Small refresh', client: 'Acme', program: 'Digital health' })).json()).core;
    await p.goto(`${BASE}/admin/#plan/${cc}`); await p.reload(); await p.waitForSelector('[data-mode=type]', { timeout: 10000 }).catch(() => {});
    await p.fill('#tplScope', 'Refresh the office website.').catch(() => {}); await p.click('[data-mode=type]').catch(() => {}); await p.waitForSelector('#tplType', { timeout: 5000 }).catch(() => {});
    await p.selectOption('#tplType', 'cl-static').catch(() => {}); await sleep(500); await p.click('#tplCreate').catch(() => {}); await sleep(2500);
    await p.click('#modBtn').catch(() => {}); await p.waitForSelector('#modPop [data-mod=change]', { timeout: 5000 }).catch(() => {});
    await p.click('#modPop .mod-row:has([data-mod=change]) .bom-slider').catch(() => {}); await sleep(1500);
    ok('Change control', 'switched off for a small project: the Change control tab is hidden', !(await p.$$eval('a.tab', (as) => as.some((a) => /Change control/.test(a.textContent))).catch(() => true)));
    await p.goto(`${BASE}/admin/#plan/${cc}/intel`); await p.waitForSelector('#piQ', { timeout: 10000 }).catch(() => {});
    await p.fill('#piQ', 'Can you regenerate the Gantt chart on the 24-week / $380,000 remodelled plan instead?'); await p.click('#piGo');
    await p.waitForSelector('[data-replan] [data-imcr]', { timeout: 30000 }).catch(() => {});
    const commitTxt = await p.textContent('[data-replan] [data-imcr]').catch(() => '');
    await p.click('[data-replan] [data-imcr]').catch(() => {}); await sleep(2500);
    const ccp = (await (await api('planGet', { core: cc })).json()).plan || {};
    const cr0 = (ccp.changes || [])[0] || {};
    ok('Change control', 'off: a re-plan is committed straight away (no review), and still kept on record', /Commit/.test(commitTxt) && cr0.status === 'Implemented' && cr0.direct === true && /switched off/.test((cr0.decision || {}).note || ''), commitTxt + ' | ' + JSON.stringify([cr0.status, cr0.direct, (cr0.decision || {}).note]));
    // BOM: draft lines stay out of the costing; signed off, they are in it as Materials
    await p.goto(`${BASE}/admin/#plan/${cc}/bom`); await p.waitForSelector('#bomGo, #bomAdd', { timeout: 8000 }).catch(() => {});
    await p.click('#bomGo').catch(() => {}); await sleep(1200);
    ok('BOM', 'no Inventory in the BOM (no stock column, no stock filters, no "Add to Inventory")', !/Not in Inventory|Add to Inventory|From stock|Not in stock/.test(await p.textContent('#planBody').catch(() => '')) && !(await p.$('th:text("Stock")')));
    await p.evaluate(() => { const S = window.MBS && window.MBS._planState; return !!S; }).catch(() => false);
    await p.click('#bomAdd').catch(() => {}); await sleep(600);
    await p.fill('.bom-tbl tr[data-bk="0"] [data-bf=name]', 'Domain and SSL certificate').catch(() => {}); await p.dispatchEvent('.bom-tbl tr[data-bk="0"] [data-bf=name]', 'change').catch(() => {}); await sleep(400);
    await p.fill('.bom-tbl tr[data-bk="0"] [data-bf=qty]', '1').catch(() => {}); await p.dispatchEvent('.bom-tbl tr[data-bk="0"] [data-bf=qty]', 'change').catch(() => {}); await sleep(400);
    await p.fill('.bom-tbl tr[data-bk="0"] [data-bf=price]', '450').catch(() => {}); await p.dispatchEvent('.bom-tbl tr[data-bk="0"] [data-bf=price]', 'change').catch(() => {}); await sleep(600);
    await p.goto(`${BASE}/admin/#plan/${cc}/budget`); await p.waitForSelector('.bd-tiles', { timeout: 8000 }).catch(() => {});
    const cst = [await p.textContent('#planTabs').catch((e) => 'ERR ' + e.message), await p.textContent('.bd-bomst').catch(() => 'no bomst'), (await p.textContent('#planBody').catch(() => '')).slice(0, 160), JSON.stringify(((await (await api('planGet', { core: cc })).json()).plan.bom || {}).lines)];
    ok('Costing', 'the tab is called Costing; a draft BOM ($450) waits for sign-off and is not in the costing yet', /Costing/.test(cst[0]) && /waiting for sign-off/.test(cst[1]) && !/from the signed-off BOM/.test(cst[2]), cst.join(' || ').slice(0, 600));
    await p.goto(`${BASE}/admin/#plan/${cc}/bom`); await p.waitForSelector('.bom-tbl', { timeout: 8000 }).catch(() => {});
    await p.check('.bom-tbl tr[data-bk="0"] .bom-ck input').catch(() => {}); await sleep(800);
    const signOn = await p.isEnabled('#bomSign').catch(() => false);
    await p.click('#bomSign').catch(() => {}); await p.waitForSelector('#bsF', { timeout: 5000 }).catch(() => {});
    await p.fill('#bsF [name=by]', 'Sashi Kumar Sivam').catch(() => {}); await p.fill('#bsF [name=sig]', 'Sashi Kumar Sivam').catch(() => {}); await p.click('#bsF [type=submit]').catch(() => {}); await sleep(2500);
    const bt2 = await p.textContent('#planBody').catch(() => '');
    ok('Costing', 'the preparer signs off the BOM: it goes into the costing as Materials ($450), no change control', /#plan\/[^/]+\/budget/.test(p.url()) && /signed off/i.test(bt2) && /from the signed-off BOM/.test(bt2) && /450/.test(bt2), 'sign enabled=' + signOn + ' ' + p.url() + ' ' + bt2.slice(0, 200));
    // 🛒 things to order on the overview: order-by date, tick when ordered, a note saved with Enter
    await p.goto(`${BASE}/admin/#plan/${cc}/overview`); await p.waitForSelector('.ord-row', { timeout: 8000 }).catch(() => {});
    const ordT = await p.textContent('.ord').catch(() => '');
    ok('Overview', 'Things to order (no Inventory): each BOM line with an order-by date, no re-order buttons', /Things to order/.test(ordT) && /order by|order now/.test(ordT) && !/Re-order|short /.test(ordT), ordT.slice(0, 200));
    await p.check('.ord-row [data-ord]').catch(() => {}); await sleep(1200);
    await p.fill('.ord-row [data-onote]', 'Quote from the supplier, delivery Tuesday').catch(() => {}); await p.press('.ord-row [data-onote]', 'Enter').catch(() => {}); await sleep(2000);
    const ol = (((await (await api('planGet', { core: cc })).json()).plan.bom || {}).lines || [])[0] || {};
    ok('Overview', 'ticking marks it ordered (who and when); the note saves with Enter', ol.ordered && !!ol.orderedBy && ol.orderNote === 'Quote from the supplier, delivery Tuesday' && !!ol.orderNoteBy, JSON.stringify(ol).slice(0, 300));
    ok('Overview', 'the upcoming card is this week (7 days), not 14 days', /This week/.test(await p.textContent('#planBody').catch(() => '')) && !/Next 14 days/.test(await p.textContent('#planBody').catch(() => '')));
    // cost moves with progress when no actual cost is entered
    const cp = (await (await api('planGet', { core: cc })).json()).plan; const tk1 = cp.tasks.find((t) => t.dur > 0 && t.qty * t.rate > 0);
    tk1.pct = 50; await api('planSave', { core: cc, plan: cp, rev: cp.rev, note: 'progress' }).catch(() => {});
    await p.goto(`${BASE}/admin/#plan/${cc}/overview`); await p.reload(); await p.waitForSelector('#planBody', { timeout: 8000 }).catch(() => {}); await sleep(800);
    const costTxt = await p.evaluate(() => [...document.querySelectorAll('.rag-card')].map((e) => e.textContent).join(' | ')).catch(() => '');
    ok('Cost', 'spent so far moves with progress (cost × % complete) when no actual is entered', /estimated from progress/.test(costTxt) && !/\$0\.00 of/.test(costTxt), costTxt.slice(0, 300));
    { const bt = await (async () => { await p.goto(`${BASE}/admin/#plan/${cc}/bom`); await p.waitForSelector('.bom-tbl', { timeout: 8000 }).catch(() => {}); return p.textContent('#planBody').catch(() => ''); })();
      await p.goto(`${BASE}/admin/#inventory`); await sleep(1200); const u = p.url();
      const side = await p.textContent('.side-nav').catch(() => '');
      ok('Inventory', 'no Inventory anywhere: not in the menu, #inventory goes to the portfolio, no stock buttons in the BOM', !/Inventory|Stock\b|Suppliers/.test(side) && !/#inventory/.test(u) && !/Inventory|from stock/i.test(bt), u + ' ' + side.slice(0, 120)); }
    // level-1 tasks: ＋ under the schedule, ＋ below a task, ＋ Task in a Kanban column (with its costing)
    { const nT = async () => ((await (await api('planGet', { core: cc })).json()).plan.tasks || []);
      const n0 = (await nT()).length;
      await p.goto(`${BASE}/admin/#plan/${cc}/schedule`); await p.waitForSelector('[data-addend]', { timeout: 8000 }).catch(() => {});
      const vis = await p.isVisible('[data-addend]').catch(() => false);
      await p.click('[data-addend]').catch(() => {}); await sleep(2500);
      const t1 = await nT();
      const firstId = t1[0] && t1[0].id; await p.hover(`tr[data-tid="${firstId}"]`).catch(() => {}); await p.click(`tr[data-tid="${firstId}"] [data-ins]`).catch(() => {}); await sleep(2500);
      const t2 = await nT();
      ok('Level 1', '＋ Task under the schedule adds a level-1 task at the end; ＋ on a task adds one straight below it', vis && t1.length === n0 + 1 && t2.length === n0 + 2 && t2[1].name === 'New task' && (t2[1].pred || [])[0] === firstId, `vis=${vis} ${n0}->${t1.length}->${t2.length} ${t2[1] && t2[1].name}`);
      // 📋 Product Backlog → Kanban: everything starts in the backlog; DOR; WIP limits; back to the backlog; Done is locked
      await p.goto(`${BASE}/admin/#plan/${cc}/board`); await p.waitForSelector('.ag-choose', { timeout: 8000 }).catch(() => {});
      const chooser = !!(await p.$('.ag-choose [data-agm=kanban]')); await p.click('[data-agm=kanban]').catch(() => {}); await p.waitForSelector('.ag-bl', { timeout: 8000 }).catch(() => {});
      const blN = (await p.$$('.ag-row')).length, nWork = (await nT()).filter((t) => t.dur > 0 && !(t.pct >= 100)).length;
      ok('Backlog', 'the Board asks Kanban or Scrum; then every Gantt task is in the Product Backlog (a tidy list)', chooser && blN === nWork && blN > 0, `${blN} of ${nWork}`);
      await p.click('#agNew').catch(() => {}); await p.waitForSelector('#agF', { timeout: 5000 }).catch(() => {});
      const chips = await p.$$eval('#agF [data-pt]', (b) => b.map((x) => x.textContent).join(','));
      await p.fill('#agF [name=name]', 'Offsite venue'); await p.click('#agAi'); await p.waitForFunction(() => /Done when/.test((document.querySelector('#agF [name=desc]') || {}).value || ''), null, { timeout: 10000 }).catch(() => {});
      const af = await p.evaluate(() => { const F = document.querySelector('#agF'); return [F.desc.value.slice(0, 20), document.querySelector('#agPtsNote').textContent, F.prio.value, F.dur.value, F.owner.value]; });
      ok('Backlog', 'story points are picked from 1, 2, 3, 5, 8, 13; ✨ Fill it in with AI writes the description, stories with points (snapped to the scale, adding up to the item), urgency and days, and leaves the owner to you', chips === '1,2,3,5,8,13,?' && /Book the venue/.test(af[0]) && /3 pts/.test(af[1]) && af[2] === 'High' && af[3] === '4' && af[4] === '', JSON.stringify([chips, af]));
      const sts = await p.$$eval('#agSt [data-stn]', (i) => i.map((x) => x.value).join('|'));
      ok('Backlog', 'the AI also suggests stories with points (an item with none gets them)', sts === 'Shortlist three venues|Pay the deposit', sts);
      await p.click('#agF [data-close]').catch(() => {}); await p.waitForSelector('#agF', { state: 'detached', timeout: 5000 }).catch(() => {}); await sleep(500);
      for (let k = 0; k < 4 && !(await p.$('#agF')); k++) { await p.click('#agNew').catch(() => {}); await p.waitForSelector('#agF', { timeout: 3000 }).catch(() => {}); }
      await p.fill('#agF [name=name]', 'Venue booking'); await p.fill('#agF [name=desc]', 'Book the hall for 120 guests; done when the deposit is paid'); await p.click('#agF [data-pt="5"]'); await p.selectOption('#agF [name=prio]', 'High'); await p.fill('#agF [name=owner]', 'Priya Shah'); await p.fill('#agF [name=dur]', '3');
      await p.click('#agF [type=submit]').catch(() => {}); await sleep(2000);
      const vb = (await nT()).find((t) => t.name === 'Venue booking') || {};
      if (!vb.id) { console.log('VBDBG', JSON.stringify(await p.evaluate(() => [document.querySelectorAll('#agF').length, (document.querySelector('#modal') || {}).textContent && document.querySelector('#modal').textContent.slice(0, 300), [...document.querySelectorAll('.toast,[class*=toast]')].map((x) => x.textContent).join('|'), location.hash]))); await p.screenshot({ path: '/tmp/vb.png' }); } const vRow = await p.textContent(`.ag-row[data-tid="${vb.id}"]`).catch(() => '');
      const partial = await p.textContent('.ag-row:not(.ok) .dor').catch(() => '');
      ok('Backlog', '＋ Item adds a Gantt task; description + points + urgency + owner = ✅ DOR ready (others show DOR partial or %)', vb.points === 5 && vb.priority === 'High' && vb.dur === 3 && /Venue booking/.test(vb.name) && /DOR ready/.test(vRow) && /DOR/.test(partial), JSON.stringify({ vb: [vb.points, vb.priority, vb.owner, vb.dur], vRow: vRow.slice(0, 80), partial }));
      const snet0 = vb.snet || '';
      await p.click(`.ag-row[data-tid="${vb.id}"] [data-agto=board]`).catch(() => {}); await sleep(1500);
      const ids = (await nT()).filter((t) => t.dur > 0 && !t.ag && !(t.pct >= 100)).slice(0, 2).map((t) => t.id);
      for (const id of ids) { await p.click(`.ag-row[data-tid="${id}"] [data-agto=board]`).catch(() => {}); await sleep(900); }
      const T1 = await nT(); ok('Backlog', 'pulled items go onto the Kanban board (To do); the Gantt dates stay as they are', (T1.find((t) => t.id === vb.id) || {}).ag === 'board' && ids.every((id) => (T1.find((t) => t.id === id) || {}).ag === 'board') && ((T1.find((t) => t.id === vb.id) || {}).snet || '') === snet0);
      await p.click('[data-agv=board]').catch(() => {}); await p.waitForSelector('.kanban.agile', { timeout: 8000 }).catch(() => {});
      await p.fill('[data-wip=doing]', '1'); await p.press('[data-wip=doing]', 'Enter'); await p.click('body').catch(() => {}); await sleep(1500);
      await p.click(`.kcard[data-tid="${vb.id}"] [data-step="1"]`).catch(() => {}); await sleep(1200);
      await p.click(`.kcard[data-tid="${ids[0]}"] [data-step="1"]`).catch(() => {}); await sleep(1200);
      const T2 = await nT(), wipTxt = await p.textContent('.kcol-doing .kwip').catch(() => '');
      ok('Kanban', 'WIP limits: In progress set to 1, so a second card cannot go in (it stays in To do)', (T2.find((t) => t.id === vb.id) || {}).status === 'doing' && (T2.find((t) => t.id === ids[0]) || {}).status === 'todo' && /WIP 1/.test(wipTxt), wipTxt + ' ' + JSON.stringify(T2.filter((t) => t.ag).map((t) => [t.name, t.status])));
      await p.click(`.kcard[data-tid="${ids[1]}"] [data-kback]`).catch(() => {}); await sleep(1200);
      await p.click(`.kcard[data-tid="${vb.id}"] [data-tick]`).catch(() => {}); await sleep(1500);
      const T3 = await nT(), vd = T3.find((t) => t.id === vb.id) || {};
      ok('Kanban', '↩ Backlog sends a card back; a Done card is locked for good (no way back, done date kept)', !(T3.find((t) => t.id === ids[1]) || {}).ag && vd.status === 'done' && !!vd.doneAt && !(await p.$(`.kcard[data-tid="${vb.id}"] [data-kback]`)) && !!(await p.$(`.kcard[data-tid="${vb.id}"].klocked`)), JSON.stringify(vd).slice(0, 160));
      await p.click('#agCharts').catch(() => {}); await sleep(2500);
      ok('Kanban', '📈 Charts & retro: work per column, burn-up, throughput, team contribution and the most valuable member', (await p.$$('#modal canvas')).length === 4 && /Most valuable team member: Priya Shah/.test(await p.textContent('#modal').catch(() => '')), (await p.textContent('#modal').catch(() => '')).slice(0, 200));
      await p.evaluate(() => { const x = document.querySelector('#modal [data-close]'); if (x) x.click(); });
      // 🏃 Scrum: two sprint buckets, a goal, start, the board, complete (done locked, in-progress carried over, to do back to the backlog)
      const sc2 = (await (await api('planNewProject', { name: 'Mobile app MVP', client: 'Acme', program: 'Digital health' })).json()).core;
      await api('planSave', { core: sc2, plan: { name: 'Mobile app MVP', start: '2026-12-01', phases: [{ id: 'ph1', name: 'Build' }], tasks: [['Login screen', 3, 3], ['Profile page', 2, 2], ['Push notifications', 4, 5], ['Payments', 5, 8]].map((t, i) => ({ id: 'm' + i, phase: 'ph1', name: t[0], dur: t[1], points: t[2], priority: 'High', owner: i % 2 ? 'Sam Lee' : 'Aisha Rahman', desc: 'As a user I can ' + t[0].toLowerCase(), pred: [], qty: 0, rate: 0, pct: 0 })) } });
      const mT = async () => ((await (await api('planGet', { core: sc2 })).json()).plan || {});
      await p.goto(`${BASE}/admin/#plan/${sc2}/board`); await p.waitForSelector('.ag-choose', { timeout: 8000 }).catch(() => {}); await p.click('[data-agm=scrum][data-cyc="14"]').catch(() => {}); await sleep(1200);
      await p.click('[data-agv=plan]').catch(() => {}); await p.waitForSelector('.ag-plan', { timeout: 8000 }).catch(() => {});
      const buckets = await p.$$eval('.ag-sp .ag-sph b', (L) => L.map((x) => x.textContent));
      for (const id of ['m0', 'm1', 'm2']) { await p.click(`.ag-pb [data-tid="${id}"] [data-agto="S1"]`).catch(() => {}); await sleep(900); }
      await p.click(`.ag-pb [data-tid="m3"] [data-agto="S2"]`).catch(() => {}); await sleep(900);
      await p.click('[data-sp="S2"] [data-tid="m3"] .ag-ed').catch(() => {}); await p.waitForSelector('#agF', { timeout: 5000 }).catch(() => {});
      await p.fill('#agF [name=desc]', 'Card and wallet payments; done when a test payment clears');
      await p.click('#agStAdd'); await p.fill('#agSt [data-stn="0"]', 'Pay by card'); await p.selectOption('#agSt [data-stp="0"]', '5');
      await p.click('#agStAdd'); await p.fill('#agSt [data-stn="1"]', 'Pay by wallet'); await p.selectOption('#agSt [data-stp="1"]', '3');
      const note = await p.textContent('#agPtsNote').catch(() => '');
      await p.click('#agF [type=submit]').catch(() => {}); await sleep(1500);
      const m3 = ((await mT()).tasks || []).find((t) => t.id === 'm3') || {}, m3row = await p.textContent('[data-sp="S2"] [data-tid="m3"]').catch(() => '');
      ok('Scrum', 'Sprint planning: ✏ opens the item; its description and stories (with points) can be changed there, and the stories set its points', /test payment/.test(m3.desc) && (m3.subs || []).map((x) => x.name + ':' + x.points).join() === 'Pay by card:5,Pay by wallet:3' && /8 pts/.test(note) && /📖 2/.test(m3row) && m3.ag === 'S2', JSON.stringify([m3.desc, m3.subs, note, m3row]));
      const chk = await p.textContent('[data-sp="S1"] .ag-chk').catch(() => '');
      await p.click('#agAiPlan').catch(() => {}); await p.waitForSelector('#agAiGo', { timeout: 10000 }).catch(() => {});
      const aiTxt = await p.textContent('#agAiOut').catch(() => '');
      await p.click('#agAiGo').catch(() => {}); await sleep(1500);
      const PA = await mT(), sA = (PA.agile.sprints || []).find((x) => x.id === 'S2') || {};
      ok('Scrum', 'each sprint says if it is achievable (points vs capacity, readiness, dependencies); ✨ Plan the sprints with AI proposes items and goals, and applies them', /Achievable|At risk|Over-committed/.test(chk) && /pts/.test(chk) && /Achievable/.test(aiTxt) && /Refine first/.test(aiTxt) && sA.goal === 'People can pay in the app' && PA.tasks.find((t) => t.id === 'm3').ag === 'S2' && PA.tasks.find((t) => t.id === 'm0').ag === 'S1', JSON.stringify([chk, aiTxt.slice(0, 120), sA.goal]));
      await p.fill('[data-sp="S1"] [data-spf=goal]', 'Users can sign in and see their profile'); await p.press('[data-sp="S1"] [data-spf=goal]', 'Tab'); await sleep(800);
      await p.click('[data-agstart="S1"]').catch(() => {}); await p.waitForSelector('#okBtn', { timeout: 5000 }).catch(() => {}); await p.click('#okBtn').catch(() => {}); await sleep(2000);
      const P1 = await mT(), s1 = (P1.agile.sprints || []).find((s) => s.id === 'S1') || {};
      ok('Scrum', 'Sprint planning: two buckets (Sprint 1, Sprint 2); ▶ Start sprint with a goal locks in 10 points; the Gantt dates stay as planned', buckets.join() === 'Sprint 1,Sprint 2' && s1.status === 'active' && s1.committed === 10 && P1.tasks.find((t) => t.id === 'm3').ag === 'S2' && P1.tasks.every((t) => !t.snet), JSON.stringify({ buckets, s1 }));
      const band = await p.textContent('.ag-band').catch(() => ''); const noBack = !(await p.$('[data-kback]'));
      ok('Scrum', 'the sprint board shows the sprint, its days left and goal; once started nothing goes back to the backlog', /Sprint 1/.test(band) && /left/.test(band) && /sign in/.test(band) && noBack, band.slice(0, 120));
      await p.click('.kcard[data-tid="m0"] [data-tick]').catch(() => {}); await sleep(1200); await p.click('.kcard[data-tid="m1"] [data-step="1"]').catch(() => {}); await sleep(1200);
      await p.click('.ag-band [data-agclose]').catch(() => {}); await p.waitForSelector('#agCF', { timeout: 5000 }).catch(() => {});
      await p.check('#agCF [name=met][value=partly]').catch(() => {}); await p.click('#agCF [type=submit]').catch(() => {}); await sleep(2000);
      const P2 = await mT(), A2 = P2.agile, c1 = A2.sprints.find((s) => s.id === 'S1'), tk = (id) => P2.tasks.find((t) => t.id === id) || {};
      ok('Scrum', 'Complete sprint: goal met? recorded; Done stays (locked), In progress carries to Sprint 2 in its column, To do goes back to the backlog', c1.status === 'closed' && c1.done === 3 && c1.goalMet === 'partly' && tk('m0').ag === 'S1' && tk('m0').status === 'done' && tk('m1').ag === 'S2' && tk('m1').status === 'doing' && !tk('m2').ag, JSON.stringify({ c1, t: P2.tasks.map((t) => [t.id, t.ag, t.status]) }));
      await p.click('#agCharts').catch(() => {}); await sleep(2500);
      ok('Scrum', '📈 Charts & retro: burn-down, burn-up, velocity (committed vs done) and team contribution', (await p.$$('#modal canvas')).length === 4 && /velocity/.test(await p.textContent('#modal').catch(() => '')) && /3 pts/.test(await p.textContent('#modal .ag-sum').catch(() => '')), (await p.textContent('#modal .ag-sum').catch(() => '')));
      await p.evaluate(() => { const x = document.querySelector('#modal [data-close]'); if (x) x.click(); });
      await api('planProjectDelete', { core: sc2 }); }
    // 🔐 Users & access: the super user makes a login (email + password), confirms, then sets permissions
    { await p.goto(`${BASE}/admin/#users`); await p.waitForSelector('#usNew', { timeout: 8000 }).catch(() => {});
      const head = await p.textContent('#view, main').catch(() => '');
      ok('Users', 'Users & access: super user, project managers, contractors, project personnel, Google; no sub-contractor logins', /super user/i.test(head) && /Project manager/.test(head) && /Contractor/.test(head) && /Project personnel/.test(head) && /Google/.test(head) && !/Sub-contractor login/.test(head), head.slice(0, 200));
      await p.waitForLoadState('networkidle').catch(() => {}); await sleep(800);
      await p.click('#usNew').catch(() => {}); await p.waitForSelector('#nuF', { timeout: 5000 }).catch(() => {}); await sleep(500);
      await p.fill('#nuF [name=email]', 'aisha.contractor@example.com'); await p.fill('#nuF [name=name]', 'Aisha Rahman');
      await p.check('#nuF [name=role][value="Contractor"]').catch(() => {});
      await p.fill('#nuF [name=pw]', 'Welcome2026x'); await p.fill('#nuF [name=pw2]', 'Welcome2026x');
      await p.click('#nuF [type=submit]').catch(() => {}); await p.waitForSelector('#cnGo', { timeout: 5000 }).catch(() => {});
      const conf = await p.textContent('#modal').catch(() => ''); if (!/Confirm and create/.test(conf)) console.log('USRDBG', JSON.stringify(await p.evaluate(() => [[...document.querySelectorAll('.toast,#toast,[class*=toast]')].map((x) => x.textContent).join('|'), document.querySelector('#nuF [name=email]') && document.querySelector('#nuF [name=email]').value, (document.querySelector('#nuF [name=role]:checked') || {}).value, document.querySelector('#nuF [name=pw]') && document.querySelector('#nuF [name=pw]').value.length]))); const before = ((await (await api('userList')).json()).users || []).filter((u) => u.username === 'aisha.contractor@example.com').length;
      ok('Users', 'step 2 asks to confirm (email, role, password hidden) before anything is made', /Confirm and create/.test(conf) && /aisha.contractor@example.com/.test(conf) && !/Welcome2026x/.test(conf) && before === 0, conf.slice(0, 200) + ' before=' + before);
      await p.click('#cnGo').catch(() => {}); await p.waitForSelector('#pmSave', { timeout: 8000 }).catch(() => {});
      await p.check(`#pmProjs input[value="${cc}"]`).catch(() => {});
      await p.click('#pmSave').catch(() => {}); await sleep(1500);
      const us = ((await (await api('userList')).json()).users || []).find((u) => u.username === 'aisha.contractor@example.com') || {};
      ok('Users', 'step 3 sets the permissions: Contractor, Projects edit, only the ticked project', us.role === 'Contractor' && us.mods.projects === 'edit' && us.mods.data === 'none' && !us.projAll && (us.projects || []).join() === cc, JSON.stringify(us).slice(0, 300));
      const c2 = await b.newContext(); const rq = c2.request, post = (action, data = {}) => rq.post(`${BASE}/.netlify/functions/admin`, { data: { action, ...data }, headers: { 'X-MBS-Admin': '1', 'X-Forwarded-For': '203.0.113.50' } });
      const li = await post('login', { username: 'aisha.contractor@example.com', password: 'Welcome2026x' });
      const pl = await (await post('planList')).json(); const other = await post('planGet', { core: (pl.plans || [])[0] ? 'nope' : 'nope' });
      const mk = await post('userCreate', { user: { email: 'x@example.com', password: 'Welcome2026x', role: 'Project manager' } });
      ok('Users', 'the contractor signs in with that password, sees only their project, and cannot make logins', li.status() === 200 && (pl.plans || []).length === 1 && pl.plans[0].core === cc && mk.status() === 403, `login=${li.status()} plans=${(pl.plans || []).length} make=${mk.status()}`);
      await c2.close();
      // ⭐ the super user's row, and a project manager: Projects, People, Ask AI & reports, Users & access (adds contractors and personnel only); no customers, activity log or builds
      const uh = await p.textContent('.us-owner').catch(() => '');
      ok('Users', 'the super user is named (Sashi Sivam, ⭐ Super user)', /Sashi Sivam/.test(uh) && /Super user/.test(uh), uh.slice(0, 120));
      await api('userCreate', { user: { email: 'nina.pm@example.com', name: 'Nina PM', password: 'Welcome2026x', role: 'Project manager' } });
      await api('userCreate', { user: { email: 'omar.pd@example.com', name: 'Omar PD', password: 'Welcome2026x', role: 'Project director' } });
      const omar = ((await (await api('userList')).json()).users || []).find((u) => u.username === 'omar.pd@example.com') || {}, aisha = ((await (await api('userList')).json()).users || []).find((u) => u.username === 'aisha.contractor@example.com') || {};
      const c5 = await b.newContext({ viewport: { width: 1366, height: 900 } }); const p5 = await c5.newPage(), post5 = (action, data = {}) => c5.request.post(`${BASE}/.netlify/functions/admin`, { data: { action, ...data }, headers: { 'X-MBS-Admin': '1', 'X-Forwarded-For': '203.0.113.61' } });
      const l5 = await post5('login', { username: 'nina.pm@example.com', password: 'Welcome2026x' }), me5 = await (await post5('me')).json();
      const mkC = await post5('userCreate', { user: { email: 'kim.crew@example.com', name: 'Kim Crew', password: 'Welcome2026x', role: 'Contractor' } }), mkD = await post5('userCreate', { user: { email: 'zed@example.com', password: 'Welcome2026x', role: 'Project director' } });
      const edA = await post5('userSetPw', { id: aisha.id, password: 'Another2026x' }), edO = await post5('userSetPw', { id: omar.id, password: 'Another2026x' }), upA = await post5('userSave', { user: { id: aisha.id, role: 'Project director' } });
      const deny = await Promise.all(['visitorList', 'enquiryList', 'log', 'kbList', 'buildList'].map(async (a) => a + ':' + (await post5(a)).status()));
      await p5.goto(`${BASE}/admin/`); await p5.waitForSelector('.side-nav', { timeout: 10000 }).catch(() => {}); await sleep(1500);
      const menu5 = await p5.$$eval('.side-nav a[data-nav]:not([hidden])', (a) => a.map((x) => x.textContent.trim()));
      ok('Users', 'a project manager: Projects, People, Ask AI & reports, Users & access; adds contractors and personnel only; no customers, activity log, builds or knowledge base', l5.status() === 200 && me5.role === 'Project manager' && me5.mods.crm === 'none' && me5.mods.users === 'edit' && me5.mods.people === 'edit' && me5.mods.data === 'edit' &&
        mkC.status() === 200 && mkD.status() === 403 && edA.status() === 200 && edO.status() === 403 && upA.status() === 403 && deny.every((x) => /:403$/.test(x)) &&
        menu5.some((x) => /Users & access/.test(x)) && menu5.some((x) => /People/.test(x)) && !menu5.some((x) => /Enquiries|Visitors|Activity log|Builds|Knowledge/.test(x)), JSON.stringify([l5.status(), me5.role, me5.mods, mkC.status(), mkD.status(), edA.status(), edO.status(), upA.status(), deny, menu5]));
      await c5.close(); }
    // 👥 People: two groups, credentials, rate, resume; only the PM adds people; everyone keeps My profile; calendar and workload
    { await p.goto(`${BASE}/admin/#people`); await p.waitForSelector('#ppNew', { timeout: 8000 }).catch(() => {});
      const nav = await p.textContent('.side-nav').catch(() => '');
      await p.click('#ppNew').catch(() => {}); await p.waitForSelector('#pfF', { timeout: 5000 }).catch(() => {});
      await p.fill('#pfF [data-k=name]', 'Priya Shah'); await p.selectOption('#pfF [data-k=roleT]', 'Project director').catch(() => {});
      await p.fill('#pfF [data-k=email]', 'priya.shah@example.com'); await p.fill('#pfF [data-k=costRate]', '150');
      await p.click('#pfF [data-radd=education]'); await p.fill('#pfF [data-rep=education] .pp-rep-r:last-of-type [data-rf=qual]', 'MBA'); await p.fill('#pfF [data-rep=education] .pp-rep-r:last-of-type [data-rf=inst]', 'AGSM');
      await p.click('#pfF [data-radd=certs]'); await p.fill('#pfF [data-rep=certs] .pp-rep-r:last-of-type [data-rf=name]', 'PMP'); await p.fill('#pfF [data-rep=certs] .pp-rep-r:last-of-type [data-rf=expiry]', '2027-03-01');
      const conHidden = await p.isHidden('#pfF [data-rep=permits]').catch(() => false);
      await p.click('#ppSave').catch(() => {}); await sleep(2000);
      const pl = (await (await api('pplList')).json()).people || [], pr = pl.find((x) => x.name === 'Priya Shah') || {};
      const pg = pr.id ? (await (await api('pplGet', { id: pr.id })).json()).person : {};
      ok('People', 'menu has People, Team calendar, Workload and My profile; no payroll', /People/.test(nav) && /Team calendar/.test(nav) && /Workload/.test(nav) && /My profile/.test(nav) && !/Payroll/.test(nav), nav.slice(0, 200));
      ok('People', 'the PM adds a technical person: group, role, rate per hour, education and certifications (no construction fields)', pg.group === 'Technical & general' && pg.role === 'Project director' && pg.costRate === 150 && (pg.education || [])[0].qual === 'MBA' && (pg.certs || [])[0].name === 'PMP' && conHidden, JSON.stringify(pg).slice(0, 300));
      const cr = await (await api('pplSave', { person: { group: 'Construction', name: 'Tom Walsh', type: 'Contractor', role: 'Site supervisor', costRate: 85, permits: [{ name: 'Builder licence', number: 'BL-77', expiry: '2026-11-20' }], insurance: { insurer: 'QBE', expiry: '2027-01-01' } } })).json();
      ok('People', 'a construction person keeps permits and insurance; a permit expiring soon shows in compliance', cr.person && cr.person.permits[0].number === 'BL-77' && cr.person.insurance.insurer === 'QBE' && /Permit: Builder licence: due/.test((cr.comp || {}).problems.join(' ')), JSON.stringify(cr.comp));
      await api('userCreate', { user: { email: 'sam.personnel@example.com', name: 'Sam Lee', role: 'Project personnel', password: 'Welcome2026x' } });
      const sam = ((await (await api('pplList')).json()).people || []).find((x) => x.email === 'sam.personnel@example.com') || {};
      ok('People', 'making a login also makes their People record, ready for them to fill in', sam.role === 'Project personnel' && sam.group === 'Technical & general', JSON.stringify(sam).slice(0, 200));
      const c3 = await b.newContext(); const post = (action, data = {}) => c3.request.post(`${BASE}/.netlify/functions/admin`, { data: { action, ...data }, headers: { 'X-MBS-Admin': '1', 'X-Forwarded-For': '203.0.113.61' } });
      await post('login', { username: 'sam.personnel@example.com', password: 'Welcome2026x' });
      const me1 = await (await post('pplMe')).json();
      const sv = await (await post('pplMeSave', { person: { ...me1.person, costRate: 72, role: 'Project director', quals: [{ name: 'PRINCE2 Practitioner', year: '2021' }] } })).json();
      const cv = await post('pplMeCv', { name: 'Sam Lee CV.pdf', type: 'application/pdf', data: Buffer.from('%PDF-1.4 test').toString('base64') });
      const cvg = await (await post('pplMeCvGet')).json();
      const other = await post('pplSave', { person: { name: 'Someone else' } });
      ok('People', 'My profile: they save their own rate and qualifications and upload a resume, but cannot change their role or add others', sv.person && sv.person.costRate === 72 && sv.person.role === 'Project personnel' && sv.person.quals[0].name === 'PRINCE2 Practitioner' && cv.status() === 200 && Buffer.from(cvg.data || '', 'base64').toString() === '%PDF-1.4 test' && other.status() === 403, `rate=${sv.person && sv.person.costRate} role=${sv.person && sv.person.role} cv=${cv.status()} other=${other.status()}`);
      await c3.close();
      await p.goto(`${BASE}/admin/#people/calendar`); await p.waitForSelector('.pc-t', { timeout: 10000 }).catch(() => {});
      const calTxt = await p.textContent('#ppBody').catch(() => '');
      ok('People', 'the team calendar shows everyone day by day for 4 weeks', /Team calendar/.test(calTxt) && (await p.$$('.pc-t thead .pc-d')).length === 28 && /Priya Shah/.test(calTxt), calTxt.slice(0, 120));
      await p.goto(`${BASE}/admin/#me`); await sleep(1200); const meT = await p.textContent('#view, main').catch(() => '');
      ok('People', 'My profile opens for the super user too (with a pointer to People)', /My profile/.test(meT), meT.slice(0, 120)); }
    // ✨ People: upload a resume (PDF) and the form fills itself in; Save keeps the resume on file
    { const { PDFDocument, StandardFonts } = require('pdf-lib'); const doc = await PDFDocument.create(), pg = doc.addPage([595, 842]), font = await doc.embedFont(StandardFonts.Helvetica);
      ['Aisha Rahman', 'Senior IT Project Manager', 'aisha.rahman@example.com  0412 345 678  Parramatta NSW', 'Education: MBA, Monash University, 2015', 'Certifications: PMP (PMI) 1234567, expires 30 June 2027; PRINCE2 Practitioner 2018',
        'Experience: 12 years delivering ERP and cloud projects for hospitals and banks.', 'Rate: $120 per hour'].forEach((t, i) => pg.drawText(t, { x: 40, y: 790 - i * 22, size: 12, font }));
      const pdf = Buffer.from(await doc.save());
      await p.goto(`${BASE}/admin/#people`); await p.waitForSelector('#ppFromCv', { timeout: 8000 }).catch(() => {});
      await p.click('#ppFromCv').catch(() => {}); await p.waitForSelector('#pfFill', { state: 'attached', timeout: 5000 }).catch(() => {});
      await p.setInputFiles('#pfFill', { name: 'Aisha Rahman CV.pdf', mimeType: 'application/pdf', buffer: pdf }).catch(() => {});
      await p.waitForSelector('.pp-cvmsg.ok, .pp-cvmsg.bad', { timeout: 20000 }).catch(() => {});
      const f = await p.evaluate(() => { const v = (k) => (document.querySelector('#pfF [data-k="' + k + '"]') || {}).value; return { msg: (document.querySelector('.pp-cvmsg') || {}).textContent, name: v('name'), email: v('email'), rate: v('costRate'), role: v('roleT'), edu: document.querySelectorAll('#pfF [data-rep=education] .pp-rep-r').length, cert: (document.querySelector('#pfF [data-rep=certs] [data-rf=name]') || {}).value }; });
      ok('People', '✨ upload a PDF resume: its text is read and the form fills in (name, email, role, rate, education, certifications)', f.name === 'Aisha Rahman' && f.email === 'aisha.rahman@example.com' && f.rate === '120' && f.role === 'Project manager' && f.edu >= 1 && f.cert === 'PMP' && /Senior IT Project Manager/.test(global.CV_TEXT || ''), JSON.stringify(f));
      await p.click('#ppSave').catch(() => {}); await sleep(3000);
      const ar = ((await (await api('pplList')).json()).people || []).find((x) => x.name === 'Aisha Rahman') || {}; const ag = ar.id ? (await (await api('pplGet', { id: ar.id })).json()).person : {};
      ok('People', 'Save keeps the person and the resume on file', ag.cv && ag.cv.name === 'Aisha Rahman CV.pdf' && ag.certs[0].expiry === '2027-06-30' && ag.costRate === 120, JSON.stringify({ cv: ag.cv, certs: ag.certs }).slice(0, 200)); }
    // 🗂 picking a program on New project fills in what the program already knows
    { await api('planProgramSave', { name: 'ESG programme', manager: 'Sashi Kumar Sivam', sponsor: 'Board of Directors', client: 'National Airlines', email: 'esg@example.com', phone: '0400 555 111', site: 'Kuala Lumpur' });
      await p.goto(`${BASE}/admin/#projects/new`); await p.waitForSelector('#champNew [name=progPick] option[value="__new"]', { timeout: 8000 }).catch(() => {});
      await p.fill('#champNew [name=phone]', '0499 000 000');   // typed by hand: must stay
      await p.selectOption('#champNew [name=progPick]', 'ESG programme').catch(() => {}); await sleep(1500);
      const v = await p.evaluate(() => { const f = document.getElementById('champNew'); return { client: f.client.value, sponsor: f.sponsor.value, manager: f.manager.value, email: f.email.value, phone: f.phone.value, site: f.site.value, note: document.getElementById('cnFill').textContent }; });
      ok('Programs', 'choosing a program fills in client, sponsor, manager, email and location (what you typed stays)', v.client === 'National Airlines' && v.sponsor === 'Board of Directors' && v.manager === 'Sashi Kumar Sivam' && v.email === 'esg@example.com' && v.site === 'Kuala Lumpur' && v.phone === '0499 000 000' && /ESG programme/.test(v.note), JSON.stringify(v));
      await p.fill('#champNew [name=name]', 'Scope 3 baseline'); await p.click('#champNew [type=submit]'); await p.waitForURL(/#plan\//, { timeout: 10000 }).catch(() => {});
      const core = (p.url().match(/#plan\/([^/]+)/) || [])[1]; const job = core ? ((await (await api('planGet', { core })).json()).job || {}) : {};
      ok('Programs', 'the new project keeps the sponsor and project manager from the program', job.sponsor === 'Board of Directors' && job.manager === 'Sashi Kumar Sivam' && job.name === 'National Airlines', JSON.stringify(job).slice(0, 200)); }
    // English console, a project written in Malay: its name shows in English on the lists, and one click puts its data in English
    { const mc = (await (await api('planNewProject', { name: 'Majlis perkahwinan di Bali', client: 'Family', program: 'Digital health' })).json()).core;
      await api('planSave', { core: mc, plan: { name: 'Majlis perkahwinan di Bali', start: '2026-12-01', phases: [{ id: 'ph1', name: 'Kerja' }], tasks: [['Tempah dewan untuk majlis', 2], ['Pilih katering dan menu', 3], ['Hantar kad jemputan', 1]].map((t, i) => ({ id: 't' + i, phase: 'ph1', name: t[0], dur: t[1], pred: i ? ['t' + (i - 1)] : [], qty: 0, rate: 0, pct: 0 })) } });
      await p.goto(`${BASE}/admin/#projects`); await sleep(2500);
      const lst = await p.textContent('#view').catch(() => '');
      await p.goto(`${BASE}/admin/#plan/${mc}/schedule`); await p.waitForSelector('#trBan', { timeout: 10000 }).catch(() => {});
      const bn = await p.textContent('#trBan').catch(() => ''); await p.click('#trGo').catch(() => {}); await p.waitForSelector('#okBtn', { timeout: 5000 }).catch(() => {}); await p.click('#okBtn').catch(() => {}); await sleep(3500);
      const mp2 = (await (await api('planGet', { core: mc })).json()).plan || { tasks: [] };
      ok('Language', 'English console: a Malay project\'s name shows in English on the list, and the banner puts its tasks into English (stored names change only when you say so)', /\[Engli\] Majlis perkahwinan di Bali/.test(lst) && /English/.test(bn) && mp2.tasks.every((t) => /^\[Engli\] /.test(t.name)), JSON.stringify({ l: /\[Engli\] Majlis/.test(lst), bn: bn.slice(0, 60), t: mp2.tasks.map((t) => t.name).slice(0, 2) }));
      await api('planProjectDelete', { core: mc }); }
    // 📱 on a phone: bottom bar, no brand bar, the project's tools under ⋯ More, the schedule as cards, the Board swipes
    { const mp = await ctx.newPage(); await mp.setViewportSize({ width: 390, height: 844 }); const plc = (await (await api('planList')).json()).plans.find((x) => x.name !== 'x') || {};
      await mp.goto(`${BASE}/admin/#plan/${plc.core}/schedule`); await mp.waitForSelector('#mNav', { timeout: 10000 }).catch(() => {}); await sleep(1500);
      const m1 = await mp.evaluate(() => ({ nav: !!document.querySelector('#mNav') && getComputedStyle(document.querySelector('#mNav')).display !== 'none', brand: getComputedStyle(document.querySelector('.gkh-bar')).display, cards: document.querySelectorAll('.mps-c').length, del: (() => { const d = document.getElementById('planDel'); return d ? getComputedStyle(d).display : 'x'; })(), fab: (() => { const b = document.getElementById('cgBtn'); return b ? getComputedStyle(b).display : 'none'; })() }));
      const pmErr = await mp.click('.ph-more', { timeout: 5000 }).then(() => '').catch((e) => e.message.slice(0, 120)); await sleep(300);
      const delShown = await mp.evaluate(() => getComputedStyle(document.getElementById('planDel')).display !== 'none');
      const dbg = await mp.evaluate(() => { const d = document.getElementById('planDel'); return d.parentNode.className + ' | ' + d.getAttribute('style') + ' | ' + document.querySelectorAll('.plan-head').length; });
      const tid = await mp.getAttribute('.mps-c', 'data-tid').catch(() => ''); await mp.click('.mps-c [data-pv="50"]').catch(() => {}); await sleep(2500);
      const tk = (((await (await api('planGet', { core: plc.core })).json()).plan || {}).tasks || []).find((t) => t.id === tid) || {};
      ok('Phone', 'a phone gets a bottom bar (no brand bar, no floating button), the schedule as cards, and the project tools behind ⋯ More', m1.nav && m1.brand === 'none' && m1.cards > 0 && m1.del === 'none' && delShown && m1.fab === 'none', JSON.stringify(m1) + ' more:' + pmErr + ' dbg:' + dbg);
      ok('Phone', 'one tap sets a task\'s progress on the phone (saved)', tk.pct === 50, JSON.stringify(tk).slice(0, 120));
      await mp.click('#mpsGantt').catch(() => {}); await sleep(800); const gantt = !!(await mp.$('table.gt')); await mp.click('#mpsList').catch(() => {}); await sleep(500);
      ok('Phone', 'the Gantt chart is one tap away, and back to the list', gantt && !!(await mp.$('.mps-c')));
      await toKanban(plc.core); await mp.goto(`${BASE}/admin/#plan/${plc.core}/board`); await mp.reload(); await sleep(1500);
      const kb = await mp.evaluate(() => { const k = document.querySelector('.kanban'); return k ? { flex: getComputedStyle(k).display, over: k.scrollWidth > k.clientWidth } : null; });
      ok('Phone', 'the Board swipes column by column', kb && kb.flex === 'flex' && kb.over, JSON.stringify(kb));
      await mp.click('#mNav [data-m=champ]').catch(() => {}); await sleep(1200);
      ok('Phone', 'the 🎙 Champ button in the bottom bar opens Ask Champ', await mp.evaluate(() => { const pn = document.getElementById('cgPanel'); return !!pn && !pn.hidden; }));
      await mp.click('#mNav [data-m=proj]').catch(() => {}); await sleep(800);
      ok('Phone', 'Projects in the bottom bar opens the project list', /#projects$/.test(mp.url()), mp.url());
      await mp.close();
      ok('Phone', 'a computer keeps the full console (no bottom bar)', await p.evaluate(() => { const n = document.getElementById('mNav'); return !n || getComputedStyle(n).display === 'none'; })); }
    // 🎙 Ask Champ in the dashboard: ask how, and Champ points at each place to click
    { await p.goto(`${BASE}/admin/#projects`); await p.waitForSelector('#cgBtn', { timeout: 8000 }).catch(() => {});
      await p.click('#cgBtn').catch(() => {}); await p.waitForSelector('#cgMic', { timeout: 5000 }).catch(() => {});
      let ttsN = 0; const onReq = (rq) => { if (/functions\/tts/.test(rq.url())) ttsN++; }; p.on('request', onReq); await sleep(1500);
      const panel = await p.evaluate(() => ({ mic: !!document.querySelector('#cgMic'), lang: !!document.querySelector('#cgLang'), voice: !!document.querySelector('#cgVoice'), hello: (document.querySelector('#cgLog') || {}).textContent || '' }));
      await p.fill('#cgQ', 'show me how to generate the project charter'); await p.press('#cgQ', 'Enter'); await sleep(1500);
      const s1 = await p.evaluate(() => ({ tip: (document.querySelector('.cg-tip') || {}).textContent || '', spot: !!document.querySelector('.cg-spot:not([hidden])'), on: !!document.querySelector('#cgLayer.on') }));
      await p.click('tr[data-plan]').catch(() => {}); await p.waitForURL(/#plan\//, { timeout: 8000 }).catch(() => {}); await sleep(2500);
      const s2 = await p.evaluate(() => { const sp = document.querySelector('.cg-spot'), b = document.querySelector('[data-dact=charter]'); if (!sp || !b) return null; const a = sp.getBoundingClientRect(), c = b.getBoundingClientRect(); return { tip: document.querySelector('.cg-tip').textContent, over: a.left <= c.left && a.right >= c.right && a.top <= c.top && a.bottom >= c.bottom }; });
      await p.click('[data-dact=charter]').catch(() => {}); await sleep(2500);
      const s3 = await p.evaluate(() => ({ tip: (document.querySelector('.cg-tip') || {}).textContent || '', dlg: !!document.querySelector('#chPdf') }));
      ok('Guide', 'Ask Champ: says hello (“I’m Champ … guide you … project questions”) out loud, a big microphone, a language picker and a voice switch', panel.mic && panel.lang && panel.voice && /I’m Champ/.test(panel.hello) && /project management questions/.test(panel.hello) && ttsN >= 1, JSON.stringify(panel).slice(0, 200) + ' tts=' + ttsN);
      ok('Guide', 'Champ reads each step aloud as it shows it', ttsN >= 3, 'tts calls ' + ttsN); p.off('request', onReq);
      ok('Guide', '“show me how to generate the project charter”: Champ asks you to open a project and lights up the list', s1.on && s1.spot && /open a project/i.test(s1.tip), JSON.stringify(s1).slice(0, 200));
      ok('Guide', 'then it points at “Generate the charter” (spotlight on the button), and after the click walks through the charter dialog', s2 && s2.over && /Generate the charter/.test(s2.tip) && s3.dlg && /theme|Preview|PDF/i.test(s3.tip), JSON.stringify([s2, s3]).slice(0, 300));
      await p.click('#cgEnd').catch(() => {}); await p.keyboard.press('Escape'); await sleep(300);
      await p.evaluate(() => window.MBS.guide.ask('how do I create a new user')); await sleep(2500);
      const s4 = await p.evaluate(() => ({ hash: location.hash, tip: (document.querySelector('.cg-tip') || {}).textContent || '', lit: (() => { const sp = document.querySelector('.cg-spot'), b = document.querySelector('#usNew'); if (!sp || !b) return false; const a = sp.getBoundingClientRect(), c = b.getBoundingClientRect(); return a.left <= c.left && a.right >= c.right; })() }));
      ok('Guide', '“how do I create a new user”: Champ opens Users & access and points at ＋ New user', s4.hash === '#users' && s4.lit && /New user/.test(s4.tip), JSON.stringify(s4).slice(0, 200));
      await p.click('#cgShow').catch(() => {}); await p.waitForSelector('#nuF', { timeout: 20000 }).catch(() => {});
      ok('Guide', '“Show me” clicks the safe steps for you (opens the New user form)', !!(await p.$('#nuF')));
      await p.click('#cgEnd').catch(() => {}); await p.keyboard.press('Escape'); await sleep(300); await p.evaluate(() => { const m = document.getElementById('modal'); if (m && !m.hidden) { const x = m.querySelector('[data-close]'); if (x) x.click(); } }); }
    // ☰ the menu (tap it, or say/type "menu"); a project question gets a PM answer about this project, with a Show me button
    { await p.goto(`${BASE}/admin/#projects`); await sleep(800); await p.evaluate(() => { const pn = document.getElementById('cgPanel'); if (!pn || pn.hidden) document.getElementById('cgBtn').click(); }); await sleep(800);
      const small = await p.evaluate(() => { const m = document.getElementById('cgMic').getBoundingClientRect(); return m.width <= 44 && !!document.querySelector('#cgF #cgMic'); });
      await p.click('#cgMenuBtn').catch(() => {}); await sleep(1200);
      const mt = await p.evaluate(() => { const m = document.getElementById('cgMenu'); return m && !m.hidden ? m.textContent : ''; });
      await p.click('#cgMenuX').catch(() => {}); await p.fill('#cgQ', 'menu'); await p.press('#cgQ', 'Enter'); await sleep(1500);
      const said = await p.evaluate(() => !document.getElementById('cgMenu').hidden);
      ok('Guide', 'a small microphone next to the box, and a ☰ menu (tap it or say “menu”) with everything Champ can show', small && /In a project/.test(mt) && /Generate the project charter/.test(mt) && /Create a new user/.test(mt) && said, mt.slice(0, 160));
      await p.click('#cgMenuX').catch(() => {}); const core = (await (await api('planList')).json()).plans[0].core;
      await p.goto(`${BASE}/admin/#plan/${core}/overview`); await sleep(1500); await p.evaluate(() => { const pn = document.getElementById('cgPanel'); if (!pn || pn.hidden) document.getElementById('cgBtn').click(); }); await sleep(600);
      await p.fill('#cgQ', 'My project is running late, what can I do about it?'); await p.press('#cgQ', 'Enter'); await sleep(2500);
      const an = await p.evaluate(() => (document.getElementById('cgLog') || {}).textContent || ''), tourOn = await p.evaluate(() => !!document.querySelector('#cgLayer.on'));
      ok('Guide', '“my project is running late”: a PM answer (crashing, fast-tracking) using this project\'s facts, with a Show me button (no tour forced)', /crash/i.test(an) && /fast-track/i.test(an) && global.GUIDE_CTX && global.GUIDE_CTX.project && global.GUIDE_CTX.project.finish && /Show me/.test(an) && !tourOn, an.slice(-260)); await p.evaluate(() => { const pn = document.getElementById('cgPanel'); if (pn) pn.hidden = true; }); }
    { await p.evaluate(() => { const pn = document.getElementById('cgPanel'); if (pn) pn.hidden = false; });
      await p.fill('#cgQ', 'Where did Project Intelligence and Schedule & Gantt go?'); await p.press('#cgQ', 'Enter'); await sleep(2500);
      const an2 = await p.evaluate(() => (document.getElementById('cgLog') || {}).textContent || '');
      const kb = await import(require('path').join(process.cwd(), 'netlify/lib/champ-kb.mjs')); const sysW = kb.SYSTEM('English', 'console');
      ok('Champ skill', 'Champ knows the console as it is now: asked about old names it answers “now Ask AI … now Gantt” (the skill is built from the code)', /now Ask AI/.test(an2) && /now Gantt/.test(an2) && /Project Intelligence \(project tab\) → Ask AI/.test(sysW) && /tabs are now: Overview, Gantt,/.test(sysW) && !/Planned, not yet available/.test(sysW), an2.slice(-200));
    { const A = (await (await api('planNewProject', { name: 'Data centre fit-out', client: 'Acme', program: 'Digital health' })).json()).core, Bc = (await (await api('planNewProject', { name: 'Cloud cut-over', client: 'Acme', program: 'Cloud projects' })).json()).core;
      await api('planDepSave', { from: A, to: Bc, type: 'FS', lag: 2, note: 'racks first' });
      await p.goto(`${BASE}/admin/#plan/${Bc}/overview`); await sleep(1500); await p.evaluate(() => { const pn = document.getElementById('cgPanel'); if (!pn || pn.hidden) document.getElementById('cgBtn').click(); }); await sleep(600);
      await p.fill('#cgQ', 'What are the dependencies for this project?'); await p.press('#cgQ', 'Enter'); await sleep(3000);
      const an3 = await p.evaluate(() => (document.getElementById('cgLog') || {}).textContent || '');
      ok('Champ skill', 'Champ answers from the left menu\'s data: “what are the dependencies for this project?” names the linked projects', /Data centre fit-out → Cloud cut-over \(FS/.test(an3) && /Show me/.test(an3), an3.slice(-200));
      await p.evaluate(() => { const pn = document.getElementById('cgPanel'); if (pn) pn.hidden = true; });
      await api('planProjectDelete', { core: A }); await api('planProjectDelete', { core: Bc }); }
      await p.evaluate(() => { const pn = document.getElementById('cgPanel'); if (pn) pn.hidden = true; }); }
    ok('BOM', 'one BOM per project: Draft with AI and Templates are off until the BOM is deleted (no appending)', await p.goto(`${BASE}/admin/#plan/${cc}/bom`).then(() => p.waitForSelector('#bomOpen, #bomAi', { timeout: 8000 })).then(async () => { await p.click('#bomOpen').catch(() => {}); await p.fill('#boF [name=why]', 'Add a line').catch(() => {}); await p.click('#boF [type=submit]').catch(() => {}); await sleep(1200); return (await p.isDisabled('#bomAi').catch(() => false)) && (await p.isDisabled('#bomTpl').catch(() => false)); }).catch(() => false));
    await p.goto(`${BASE}/admin/#plan/${cc}/budget`); await p.waitForSelector('.bd-tiles', { timeout: 8000 }).catch(() => {});
    ok('Costing', 'reopened, the BOM is out of the costing until it is signed off again', /waiting for sign-off/.test(await p.textContent('.bd-bomst').catch(() => '')) && !(await p.$('[data-gobom]')));
    await p.goto(`${BASE}/admin/#plan/${cc}/bom`); await p.waitForSelector('.bom-tbl', { timeout: 8000 }).catch(() => {});
    await p.click('#bomSign').catch(() => {}); await p.waitForSelector('#bsF', { timeout: 5000 }).catch(() => {}); await p.fill('#bsF [name=sig]', 'Sashi Kumar Sivam').catch(() => {}); await p.click('#bsF [type=submit]').catch(() => {}); await sleep(2500);
    await p.click('[data-gobom]').catch(() => {}); await sleep(800);
    ok('Costing', 'a BOM row in the costing opens the BOM to edit', /\/bom$/.test(p.url()), p.url());
    // 🗑 delete the BOM: it leaves the costing, and its milestone leaves the plan
    await p.goto(`${BASE}/admin/#plan/${cc}/bom`); await p.waitForSelector('#bomDel', { timeout: 8000 }).catch(() => {});
    await p.click('#bomDel').catch(() => {}); await p.click('#okBtn').catch(() => {}); await sleep(2500);
    const dp = (await (await api('planGet', { core: cc })).json()).plan || {};
    await p.goto(`${BASE}/admin/#plan/${cc}/budget`); await p.waitForSelector('.bd-tiles', { timeout: 8000 }).catch(() => {});
    const dbt = await p.textContent('#planBody').catch(() => '');
    ok('Costing', 'deleting the BOM takes it out of the costing and removes its milestone', !dp.bom && !(dp.tasks || []).some((t) => /Bill of Materials/.test(t.name) || t.bomx) && !/from the signed-off BOM/.test(dbt) && !(await p.$('.bd-bom, .bd-bomst')), JSON.stringify([!!dp.bom, (dp.tasks || []).filter((t) => /Bill/.test(t.name)).length, (dp.tasks || []).filter((t) => t.bomx).length, /from the signed-off BOM/.test(dbt), await p.$$eval('.bd-bom, .bd-bomst', (x) => x.map((e) => e.className + ':' + e.textContent.slice(0, 80))).catch(() => [])]));
    // a sticky note moves where it is dragged
    await toKanban(cc); await p.goto(`${BASE}/admin/#plan/${cc}/board`); await p.reload(); await sleep(1500); await p.hover('.kcard').catch(() => {}); await p.click('.kstk-add', { timeout: 5000 }).catch(() => {}); await p.waitForSelector('#stkPop .stk-h', { timeout: 5000 }).catch(() => {});
    const bx = await p.$eval('#stkPop .stk-h', (e) => { const r = e.getBoundingClientRect(); return [r.left + 60, r.top + 10]; }).catch(() => [0, 0]);
    await p.mouse.move(bx[0], bx[1]); await p.mouse.down(); await p.mouse.move(bx[0] + 220, bx[1] + 140, { steps: 8 }); await p.mouse.up(); await sleep(300);
    const moved = await p.$eval('#stkPop', (e) => [parseInt(e.style.left, 10), parseInt(e.style.top, 10)]).catch(() => [0, 0]);
    ok('Sticky notes', 'the note panel can be dragged across the screen', Math.abs(moved[0] - (bx[0] - 60 + 220)) < 30 && Math.abs(moved[1] - (bx[1] - 10 + 140)) < 30, JSON.stringify([bx, moved]));
    await p.keyboard.press('Escape');
    await api('planProjectDelete', { core: cc });
  }
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
  ok('Project types', 'the chooser lists the 7 GKH practices first, 4 project types each', gkh.every((c, i) => groups[i] && groups[i][0] === c && groups[i][1] === (c === 'Technology consulting' ? 7 : 4)), JSON.stringify(groups.slice(0, 8)));
  ok('Project types', 'a Cloud projects category: hosting, three-tier, DR, CI/CD, IaC, Kubernetes, migration, event-driven, hybrid networking, CSPM, Zero Trust and more', groups[7] && groups[7][0] === 'Cloud projects' && groups[7][1] === 16, JSON.stringify(groups[7]));
  ok('Project types', 'a General and fun projects category (birthday, wedding and more) for learners', groups[8] && /General and fun/.test(groups[8][0]) && groups[8][1] >= 4, JSON.stringify(groups[8]));
  await p.selectOption('#tplType', 'tech-k8s-docker').catch(() => {}); await sleep(600);
  const kpv = (await p.textContent('#tplPrev').catch(() => '')).replace(/\s+/g, ' '); const tnames = await p.$$eval('#tplType optgroup[label="Technology consulting"] option', (o) => o.map((x) => x.textContent)).catch(() => []);
  ok('Project types', 'Technology consulting has Kubernetes, Docker, and Docker + Kubernetes templates', tnames.some((n) => /^Kubernetes platform/.test(n)) && tnames.some((n) => /^Docker deployment/.test(n)) && tnames.some((n) => /^Docker and Kubernetes/.test(n)) && /Docker and Kubernetes: containerise/.test(kpv) && /\d+ tasks/.test(kpv), JSON.stringify(tnames) + ' ' + kpv.slice(0, 160));
  await p.selectOption('#tplType', 'cl-migrate').catch(() => {}); await sleep(600);
  const cpv = (await p.textContent('#tplPrev').catch(() => '')).replace(/\s+/g, ' ');
  ok('Project types', 'the cloud migration plan has discovery, a pilot and migration waves, with cloud risks', /Discovery and dependency mapping/.test(cpv) && /Wave 1 migration/.test(cpv) && /Downtime or data loss during cutover/.test(cpv), cpv.slice(0, 300));
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
  // a wedding with a 2-week Finish by: phases run side by side and the durations are squeezed to fit; no cooling-off, no emergency
  const wd2 = (await (await api('planNewProject', { name: 'Our wedding', client: 'Family', program: 'Digital health' })).json()).core;
  const d0 = new Date(); d0.setUTCDate(d0.getUTCDate() + 7); const st0 = d0.toISOString().slice(0, 10); d0.setUTCDate(d0.getUTCDate() + 13); const fb0 = d0.toISOString().slice(0, 10);
  await p.goto(`${BASE}/admin/#plan/${wd2}`); await p.reload(); await p.waitForSelector('[data-mode=type]', { timeout: 10000 }).catch(() => {});
  ok('Schedule', 'no Emergency tick when creating a plan', !(await p.isVisible('#tplEmerg').catch(() => false)) && !/Emergency/.test(await p.textContent('#view').catch(() => '')));
  await p.fill('#tplStart', st0); await p.fill('#aiFinish', fb0); await p.check('#tplWeek').catch(() => {});
  await p.click('[data-mode=type]').catch(() => {}); await p.waitForSelector('#tplType', { timeout: 5000 }).catch(() => {});
  await p.selectOption('#tplType', 'fun-wedding').catch(() => {}); await sleep(600); await p.click('#tplCreate').catch(() => {}); await sleep(2500);
  const wp = (await (await api('planGet', { core: wd2 })).json()).plan || { tasks: [] };
  const WR = PLX.rollup(JSON.parse(JSON.stringify(wp)), new Date().toISOString().slice(0, 10));
  ok('Schedule', 'a wedding with a 2-week Finish by now fits it (was 119 days)', WR.finish && WR.finish <= fb0 && /squeezed/.test((wp.charter || {}).assumptions || ''), WR.start + ' → ' + WR.finish + ' (finish by ' + fb0 + ')');
  ok('Schedule', 'the costs stay the same ($44,700)', Math.abs(WR.BAC - 44700) < 1, WR.BAC);
  await p.goto(`${BASE}/admin/#plan/${wd2}/schedule`); await sleep(2000);
  const sv = await p.textContent('#planBody').catch(() => '');
  ok('Schedule', 'no Cooling-off or Emergency on the schedule', !/Cooling-off|cooling-off|Emergency/.test(sv) && !(await p.isVisible('#pEmerg').catch(() => false)), (sv.match(/.{40}(Cooling|Emergency).{40}/) || [''])[0]);
  await api('planProjectDelete', { core: wd2 });
  ok('Language', 'Khmer (Cambodian) is in the language list', await p.evaluate(() => !!(window.ChampI18n && window.ChampI18n.langs.some((l) => l[0] === 'km'))));
  // ---- 🗒 sticky notes on tasks: Gantt (schedule) and Kanban (board), red / amber / green, kept for the team ----
  const sn = (await (await api('planNewProject', { name: 'Team offsite', client: 'GKH', program: 'Digital health' })).json()).core;
  await p.goto(`${BASE}/admin/#plan/${sn}`); await p.reload(); await p.waitForSelector('[data-mode=type]', { timeout: 10000 }).catch(() => {});
  await p.fill('#tplScope', 'A two-day team offsite with workshops and a dinner.').catch(() => {});
  await p.click('[data-mode=type]').catch(() => {}); await p.waitForSelector('#tplType', { timeout: 5000 }).catch(() => {}); await p.selectOption('#tplType', 'fun-birthday').catch(() => {}); await sleep(500);
  await p.click('#tplCreate').catch(() => {}); await p.waitForSelector('tr[data-tid] [data-stk]', { timeout: 10000 }).catch(() => {});
  await p.click('tr[data-tid] [data-stk]', { timeout: 8000 }).catch(() => {}); await p.waitForSelector('#stkPop #stkTx', { timeout: 5000 }).catch(() => {});
  await p.fill('#stkTx', 'Venue has not confirmed the booking yet: chase today', { timeout: 5000 }).catch(() => {}); await p.click('#stkPop [data-scol=R]', { timeout: 5000 }).catch(() => {}); await p.click('#stkPop [data-sadd]', { timeout: 5000 }).catch(() => {}); await sleep(2000);
  let snp = (await (await api('planGet', { core: sn })).json()).plan || { tasks: [] }, sk = (snp.tasks.find((t) => (t.stickies || []).length) || {}).stickies || [];
  ok('Sticky notes', 'a note added on the Gantt (schedule) is saved with its colour and author', sk.length === 1 && sk[0].c === 'R' && /chase today/.test(sk[0].text) && !!sk[0].by, JSON.stringify(sk));
  ok('Sticky notes', 'the Gantt bar shows a red note pin', !!(await p.$('.gstk.stk-R')) && !!(await p.$('.stkb.stk-R')));
  await p.keyboard.press('Escape'); await toKanban(sn); await p.goto(`${BASE}/admin/#plan/${sn}/board`); await p.reload(); await sleep(1500); await p.waitForSelector('.kstk', { timeout: 8000 }).catch(() => {});
  ok('Sticky notes', 'the Kanban card shows the note as a red sticky (Urgent)', /Urgent/.test(await p.textContent('.kstk.stk-R').catch(() => '')) && /chase today/.test(await p.textContent('.kstk.stk-R').catch(() => '')));
  { await p.click('#kbFull').catch(() => {}); await p.waitForSelector('.kfull-svg', { timeout: 5000 }).catch(() => {});
    const kf = await p.evaluate(() => { const s = document.querySelector('.kfull-svg'); const r = s && s.getBoundingClientRect(); return s ? { cards: s.querySelectorAll('.kf-card').length, cols: (s.textContent.match(/To do|In progress|In review|Done/g) || []).length, fits: r.bottom <= window.innerHeight + 2, top: Math.round(r.top), bottom: Math.round(r.bottom), h: window.innerHeight, mh: s.style.maxHeight, sy: window.scrollY, board: !!document.querySelector('.kanban:not([hidden])') } : null; });
    ok('Kanban', 'Full view: the whole board as one picture on one screen (4 columns, every card)', kf && kf.cards > 0 && kf.cols >= 4 && kf.fits && !kf.board, JSON.stringify(kf));
    await p.click('.kf-card').catch(() => {}); await sleep(600);
    ok('Kanban', 'clicking a card in the picture goes back to the board at that card', !!(await p.$('.kanban:not([hidden]) .kcard')) && !(await p.$('.kfull-svg'))); }
  await p.click('.kstk.stk-R', { timeout: 5000 }).catch(() => {}); await p.waitForSelector('#stkPop [data-sdone]', { timeout: 5000 }).catch(() => {});
  await p.click('#stkPop [data-sbig]').catch(() => {}); const bigNote = await p.evaluate(() => document.getElementById('stkPop').classList.contains('big')).catch(() => false);
  await p.fill('#stkTx', 'Caterer confirmed', { timeout: 5000 }).catch(() => {}); await p.click('#stkPop [data-scol=G]', { timeout: 5000 }).catch(() => {}); await p.click('#stkPop [data-sadd]', { timeout: 5000 }).catch(() => {}); await sleep(800);
  await p.click('#stkPop .stk-R [data-sdone]').catch(() => {}); await sleep(2000);
  snp = (await (await api('planGet', { core: sn })).json()).plan || { tasks: [] }; sk = (snp.tasks.find((t) => (t.stickies || []).length) || {}).stickies || [];
  ok('Sticky notes', 'the note expands; others can add a green note and resolve the red one', bigNote && sk.length === 2 && sk.find((x) => x.c === 'R').done === true && sk.find((x) => x.c === 'G').text === 'Caterer confirmed', JSON.stringify(sk.map((x) => [x.c, x.done])) + ' big=' + bigNote);
  // edit a note in place; a checklist note: tick items one by one, the note is done when all are ticked
  await p.click('#stkPop .stk-G [data-sed]', { timeout: 5000 }).catch(() => {}); await p.fill('#stkPop [data-setx]', 'Caterer confirmed for 30 guests', { timeout: 5000 }).catch(() => {});
  await p.click('#stkPop [data-secol=A]').catch(() => {}); await p.click('#stkPop [data-sesave]').catch(() => {}); await sleep(800);
  await p.fill('#stkTx', '- Book the venue\n- Order the cake', { timeout: 5000 }).catch(() => {}); await p.click('#stkPop [data-scol=G]').catch(() => {}); await p.click('#stkPop [data-sadd]').catch(() => {}); await sleep(800);
  await p.click('#stkPop .stk-cl [data-sitem]', { timeout: 5000 }).catch(() => {}); await sleep(1500);
  snp = (await (await api('planGet', { core: sn })).json()).plan || { tasks: [] }; sk = (snp.tasks.find((t) => (t.stickies || []).length) || {}).stickies || [];
  const edn = sk.find((x) => /Caterer/.test(x.text)), cl = sk.find((x) => /Book the venue/.test(x.text));
  ok('Sticky notes', 'a note can be edited in place (text and colour), marked edited', edn && edn.text === 'Caterer confirmed for 30 guests' && edn.c === 'A' && !!edn.editedBy, JSON.stringify(edn));
  ok('Sticky notes', 'a checklist note: ticking one item keeps the note open (1/2)', cl && /- \[x\] Book the venue/.test(cl.text) && /- \[ \] Order the cake/.test(cl.text) && !cl.done && /1\/2/.test(await p.textContent('#stkPop').catch(() => '')), JSON.stringify(cl));
  await p.click('#stkPop .stk-cl [data-sitem="1"]', { timeout: 5000 }).catch(() => {}); await sleep(1500);
  snp = (await (await api('planGet', { core: sn })).json()).plan || { tasks: [] }; sk = (snp.tasks.find((t) => (t.stickies || []).length) || {}).stickies || [];
  const cl2 = sk.find((x) => /Book the venue/.test(x.text));
  ok('Sticky notes', 'ticking the last item ticks the note as done (tick box)', cl2 && cl2.done && !!cl2.doneBy && await p.isChecked('#stkPop [data-nid="' + cl2.id + '"] [data-sdone]').catch(() => false), JSON.stringify(cl2));
  { const bg = await p.evaluate((id) => { const e = document.querySelector('#stkPop [data-nid="' + id + '"]'); return e ? getComputedStyle(e).backgroundColor + '|' + e.textContent : ''; }, cl2 && cl2.id).catch(() => '');
    ok('Sticky notes', 'a note with every item done turns blue with a ✓ All done', /rgb\(234, 242, 255\)/.test(bg) && /✓ All done/.test(bg), bg.slice(0, 120));
    await p.fill('#stkTx', 'Tables set').catch(() => {}); await p.press('#stkTx', 'Enter').catch(() => {}); await sleep(1500);
    let pl2 = (await (await api('planGet', { core: sn })).json()).plan || { tasks: [] }, sk2 = (pl2.tasks.find((t) => (t.stickies || []).length) || {}).stickies || [];
    ok('Sticky notes', 'pressing Enter saves a new note (no button needed)', sk2.some((x) => x.text === 'Tables set'), JSON.stringify(sk2.map((x) => x.text)));
    for (const x of sk2.filter((y) => !y.done)) { await p.click('#stkPop [data-nid="' + x.id + '"] [data-sdone]').catch(() => {}); await sleep(1200); }
    await p.keyboard.press('Escape'); await sleep(500);
    const pin = await p.textContent('.stkb.stk-B, .kstk.stk-B').catch(() => '');
    ok('Sticky notes', 'when every note on a task is done its note button turns blue with a ✓', /✓/.test(pin), pin); }
  await p.keyboard.press('Escape');
  await api('planProjectDelete', { core: sn });

  // the console in another language: a project type's tasks, sub-tasks and risks are written in that language
  const lp = (await (await api('planNewProject', { name: 'Hari jadi', client: 'Family', program: 'Digital health' })).json()).core;
  await p.evaluate(() => localStorage.setItem('champLang', 'ms'));
  await p.goto(`${BASE}/admin/#plan/${lp}`); await p.reload(); await p.waitForSelector('[data-mode=type]', { timeout: 10000 }).catch(() => {});
  await p.click('[data-mode=type]').catch(() => {}); await p.waitForSelector('#tplType', { timeout: 5000 }).catch(() => {});
  await p.selectOption('#tplType', 'fun-birthday').catch(() => {}); await p.waitForFunction(() => /\[Bahas/.test((document.querySelector('#tplPrev') || {}).textContent || ''), null, { timeout: 30000 }).catch(() => {});
  ok('Language', 'the project type preview is in the chosen language (Malay)', /\[Bahas/.test(await p.textContent('#tplPrev').catch(() => '')), (await p.textContent('#tplPrev').catch(() => '')).slice(0, 160));
  await p.fill('#tplScope', 'A birthday party for 30 guests at a local hall.').catch(() => {});
  const lpBtn = await p.evaluate(() => { const b = document.querySelector('#tplCreate'); return b ? b.disabled + ' ' + b.textContent : 'none'; }).catch((e) => e.message);
  await p.click('#tplCreate').catch(() => {}); await sleep(2500);
  const lpToast = await p.evaluate(() => [...document.querySelectorAll('.toast,#toast')].map((x) => x.textContent).join(' | ')).catch(() => '');
  const lpp = (await (await api('planGet', { core: lp })).json()).plan || { tasks: [] };
  ok('Language', 'the plan is created with Malay task names and risks (the Gantt chart shows them)', lpp.tasks.length > 5 && lpp.tasks.every((t) => /^\[Bahas/.test(t.name)) && (lpp.risks || []).every((r) => /^\[Bahas/.test(r.title)), JSON.stringify(lpp.tasks.slice(0, 2).map((t) => t.name)) + ' btn=' + lpBtn + ' toast=' + lpToast + ' url=' + p.url());
  await p.evaluate(() => { localStorage.removeItem('champLang'); localStorage.removeItem('champChatLang'); });
  await api('planProjectDelete', { core: lp });

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
  ok('Language', 'project names are shown in the chosen language too (no half-English screens), codes kept', /^\[Bahas\] \S/.test(dataCell) && /PP-\d/.test(dataCell), dataCell);
  { const pls = []; const tc = (await (await api('planNewProject', { name: 'Office move', client: 'Acme', program: 'Digital health' })).json()).core;
    await api('planSave', { core: tc, plan: { name: 'Office move', start: '2026-12-01', phases: [{ id: 'ph1', name: 'Work' }], tasks: [['Pack the boxes', 2], ['Book the truck', 1], ['Move the desks', 2], ['Set up the network', 3]].map((t, i) => ({ id: 't' + i, phase: 'ph1', name: t[0], dur: t[1], pred: i ? ['t' + (i - 1)] : [], qty: 0, rate: 0, pct: 0 })) } });
    await p.goto(`${BASE}/admin/#plan/${tc}/schedule`); await p.waitForSelector('#trBan', { timeout: 10000 }).catch(() => {});
    const ban = await p.textContent('#trBan').catch(() => '');
    await p.click('#trGo').catch(() => {}); await p.waitForSelector('#okBtn', { timeout: 5000 }).catch(() => {}); await p.click('#okBtn').catch(() => {}); await sleep(4000);
    const tp = (await (await api('planGet', { core: tc })).json()).plan || { tasks: [] };
    const gName = await p.$$eval('table.gt [data-k=name]', (L) => L.slice(0, 3).map((x) => x.value)).catch(() => []);
    ok('Language', 'the console in another language offers to translate the whole project; one click and the Gantt task names are in that language (saved, banner gone)', !!ban && tp.dataLang === 'ms' && tp.tasks.every((t) => /^\[Bahas\]/.test(t.name) || !/\p{L}/u.test(t.name)) && gName.length && gName.every((n) => /^\[Bahas\]/.test(n)) && !(await p.$('#trBan')), JSON.stringify({ tc, n: pls.length, url: p.url(), ban: ban.slice(0, 60), lang: tp.dataLang, g: gName }));
    // on to Tamil: translated from the original English (not from the Malay), then back to English: the original words exactly
    await p.click('#champLangBtn'); await p.click('.ct-langmenu [data-l=ta]'); await p.waitForSelector('#trBan', { timeout: 10000 }).catch(() => {});
    await p.click('#trGo').catch(() => {}); await p.waitForSelector('#okBtn', { timeout: 5000 }).catch(() => {}); await p.click('#okBtn').catch(() => {}); await sleep(4000);
    const tt = (await (await api('planGet', { core: tc })).json()).plan || { tasks: [] };
    await p.click('#champLangBtn'); await p.click('.ct-langmenu [data-l=en]'); await p.waitForSelector('#trBan', { timeout: 10000 }).catch(() => {});
    const back = await p.textContent('#trBan').catch(() => '');
    await p.click('#trGo').catch(() => {}); await sleep(3500);
    const te = (await (await api('planGet', { core: tc })).json()).plan || { tasks: [] };
    const ui = await p.evaluate(() => /\[Bahas\]/.test(document.querySelector('.side-nav').textContent + document.querySelector('#planTabs').textContent));
    ok('Language', 'Malay → Tamil → English: each language comes from the original words, and back in English the Gantt task names are exactly as written (screens fully English too)', tt.dataLang === 'ta' && tt.tasks.every((t) => /^\[[A-Za-z]+\] [^\[]/.test(t.name)) && /again/.test(back) && !te.dataLang && te.tasks.map((t) => t.name).join('|') === 'Pack the boxes|Book the truck|Move the desks|Set up the network' && !ui, JSON.stringify({ ta: tt.tasks.map((t) => t.name).slice(0, 2), back: back.slice(0, 50), en: te.tasks.map((t) => t.name), ui }));
    await p.click('#champLangBtn'); await p.click('.ct-langmenu [data-l=ms]'); await sleep(800); }
  { await p.evaluate(() => { try { sessionStorage.removeItem('cgHello'); } catch (e) {} const pn = document.getElementById('cgPanel'); if (pn) pn.remove(); }); await p.goto(`${BASE}/admin/#projects`); await sleep(800);
    await p.click('#cgBtn').catch(() => {}); await sleep(2500); await p.click('#cgMenuBtn').catch(() => {}); await sleep(800);
    const g = await p.evaluate(() => ({ hello: (document.getElementById('cgLog') || {}).textContent || '', menu: Array.from(document.querySelectorAll('#cgMenu [data-cgt]')).map((b) => b.textContent), hint: (document.getElementById('cgHint') || {}).textContent || '' }));
    await p.click('#cgMenu [data-cgt="calendar"]').catch(() => {}); await sleep(2500);
    const tip = await p.textContent('.cg-tip').catch(() => '');
    ok('Guide', 'Ask Champ in another language: the hello, the menu, the hints and every guide step are in that language (nothing blank)', /\[Bahas\]/.test(g.hello) && g.menu.length >= 15 && g.menu.every((t) => /\[Bahas\] \S/.test(t)) && /\[Bahas\]/.test(g.hint) && /\[Bahas\] \S/.test(tip), JSON.stringify({ h: g.hello.slice(0, 60), m: g.menu.slice(0, 3), tip: tip.slice(0, 80) }));
    await p.click('#cgEnd').catch(() => {}); await p.evaluate(() => { const pn = document.getElementById('cgPanel'); if (pn) pn.hidden = true; }); }
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
  { // ⬆ the super user upgrades the Google sign-in to project manager: it keeps signing in with Google and gets the role
    const c6 = await b.newContext(); const post6 = (action, data = {}) => c6.request.post(`${BASE}/.netlify/functions/admin`, { data: { action, ...data }, headers: { 'X-MBS-Admin': '1', 'X-Forwarded-For': '203.0.113.62' } });
    await post6('login', { username: 'sashi73', password: 'sashi98' });
    const gu = ((await (await post6('userList')).json()).users || []).find((u) => u.kind === 'google') || {};
    const upg = await post6('userUpgrade', { id: gu.id, role: 'Project manager' }), ul = ((await (await post6('userList')).json()).users || []).find((u) => u.id === gu.id) || {};
    const stale = await api('me');
    await api('loginGoogle', { credential: 'aaa.bbb.ccc' }); const meG = await (await api('me')).json(), np = await api('planNewProject', { name: 'Upgraded check', client: 'Y', program: 'Digital health' });
    const deny = await post6('userUpgrade', { id: gu.id, role: 'view' }).then(() => 0);
    ok('Users', '⬆ the super user upgrades a Google sign-in to project manager: they keep Google sign-in and can now edit (only the super user can upgrade)', upg.status() === 200 && ul.upgraded && ul.role === 'Project manager' && stale.status() === 401 && meG.kind === 'google' && meG.role === 'Project manager' && np.status() === 200, JSON.stringify([upg.status(), ul.role, stale.status(), meG.role, np.status()]));
    const npj = np.status() === 200 ? (await np.json()).core : ''; if (npj) await post6('planProjectDelete', { core: npj });
    await c6.close();
  }

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
