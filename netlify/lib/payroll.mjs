// MBS Console v107: Payroll (under People). Everything up to the pay run happens here: timesheets (hours per day and job),
// pay worked out under the Building and Construction General On-site Award 2020 (MA000020), PAYG withholding and HELP/STSL
// from the ATO formulas, super, leave, payslips (PDF), the pay run, labour cost per job, and the Taxable Payments Annual
// Report (TPAR) for contractors. Lodging Single Touch Payroll and paying super stay with an STP-enabled payroll service:
// each finished pay run exports a CSV for it.
// Payroll details like tax file numbers and bank accounts are NOT kept here; only what the calculation needs
// (classification, tax-free threshold yes/no, resident, HELP debt yes/no, leave balances).
//   prl-settings          rates and rules (pre-filled for 2026-27; editable; must be checked against the Fair Work pay guide)
//   prl:prof:<P-001>      a person's pay profile
//   prl:ts:<P-001>:<Mon>  a person's timesheet for the week starting that Monday
//   prl:run:<PR-0001>     a pay run; prl-runs = the list
import * as kv from './kv.mjs';
import * as PPL from './people.mjs';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const str = (s, max = 300) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
const ymd = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : '');
const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const dow = (d) => new Date(d + 'T00:00:00Z').getUTCDay();   // 0 Sunday … 6 Saturday
export const mondayOf = (d) => addDays(d, -((dow(d) + 6) % 7));
const H = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const out = (status, body) => new Response(JSON.stringify(body), { status, headers: H });

/* ---------------- rates and rules ---------------- */
// Award minimum weekly rates from 1 July 2025 (MA000020 cl. 19.1), lifted 4.75% by the Annual Wage Review 2026 from the first
// full pay period on or after 1 July 2026, rounded to 10 cents. Check against the Fair Work pay guide before the first pay run.
const AWR = 1.0475, r10 = (n) => Math.round(n * 10) / 10;
const CLASSES_2025 = [['CW1a', 'CW/ECW 1 (level a): new entrant', 967.50], ['CW1b', 'CW/ECW 1 (level b)', 986.60], ['CW1c', 'CW/ECW 1 (level c)', 999.80], ['CW1d', 'CW/ECW 1 (level d)', 1017.70],
  ['CW2', 'CW/ECW 2', 1038.20], ['CW3', 'CW/ECW 3: tradesperson', 1068.40], ['CW4', 'CW/ECW 4', 1102.10], ['CW5', 'CW/ECW 5', 1135.70], ['CW6', 'CW/ECW 6', 1165.90], ['CW7', 'CW/ECW 7', 1199.30], ['CW8', 'CW/ECW 8', 1228.40]];
// tool allowances per week (cl. 21.1(a), 1 July 2025 amounts: expense-related, check the 2026-27 figures)
export const TOOLS = [['', 'No tool allowance', 0], ['carpenter', 'Carpenter, joiner, stonemason, tilelayer (stone & carpentry group)', 39.60], ['plasterer', 'Caster, fixer, floorlayer specialist, plasterer', 32.76],
  ['bricklayer', 'Bricklayer, refractory bricklayer', 28.11], ['roofer', 'Roof tiler, slate-ridger, roof fixer, metal & engineering trades', 20.74], ['painter', 'Signwriter, painter, glazier', 9.50]];
export const DEFAULTS = {
  year: '2026-27', checked: false, frequency: 'weekly',
  classes: CLASSES_2025.map(([key, name, w]) => ({ key, name, weekly: r10(w * AWR) })),
  industry: 67.15,                          // industry allowance, all-purpose (cl. 22.1): $64.10 in 2025, +4.75%
  tools: TOOLS.map(([key, name, weekly]) => ({ key, name, weekly })),
  fares: 22.41, meal: 19.74,                // fares and travel per day worked on site; meal allowance (overtime of 1.5 h or more)
  superRate: 12, loading: 17.5, onCost: 10, // super guarantee %, annual leave loading %, on-costs for job costing (workers comp, payroll tax…)
  rdo: true,                                // 8-hour days: 7.6 h paid, 0.4 h banked towards a rostered day off
  holidays: ['2026-12-25', '2026-12-26', '2026-12-28', '2027-01-01', '2027-01-26', '2027-03-26', '2027-03-27', '2027-03-28', '2027-03-29', '2027-04-25', '2027-06-14', '2027-10-04', '2027-12-25', '2027-12-26', '2027-12-27', '2027-12-28']
};
export async function settings() { const s = await kv.get('prl-settings'); return { ...DEFAULTS, ...(s || {}) }; }
function cleanSettings(f, by) {
  const n = (v, lo, hi, d) => { const x = Number(v); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, r2(x))) : d; };
  return {
    year: str(f.year, 10) || DEFAULTS.year, checked: !!f.checked, checkedBy: f.checked ? str(by, 60) : '', checkedAt: f.checked ? Date.now() : 0,
    frequency: f.frequency === 'fortnightly' ? 'fortnightly' : 'weekly',
    classes: DEFAULTS.classes.map((c) => { const g = (f.classes || []).find((x) => x && x.key === c.key) || c; return { key: c.key, name: c.name, weekly: n(g.weekly, 0, 5000, c.weekly) }; }),
    industry: n(f.industry, 0, 500, DEFAULTS.industry),
    tools: DEFAULTS.tools.map((t) => { const g = (f.tools || []).find((x) => x && x.key === t.key) || t; return { key: t.key, name: t.name, weekly: n(g.weekly, 0, 500, t.weekly) }; }),
    fares: n(f.fares, 0, 200, DEFAULTS.fares), meal: n(f.meal, 0, 200, DEFAULTS.meal),
    superRate: n(f.superRate, 0, 30, DEFAULTS.superRate), loading: n(f.loading, 0, 50, DEFAULTS.loading), onCost: n(f.onCost, 0, 100, DEFAULTS.onCost),
    rdo: f.rdo !== false, holidays: [...new Set((Array.isArray(f.holidays) ? f.holidays : String(f.holidays || '').split(/[\s,]+/)).map(ymd).filter(Boolean))].sort()
  };
}

/* ---------------- tax: ATO Schedule 1 and Schedule 8 (payments from 1 July 2026) ---------------- */
// [weekly earnings less than, a, b]
const SCALES = {
  1: [[188, 0.15, 0.15], [371, 0.2084, 11.0185], [515, 0.179, 0.1066], [932, 0.3227, 74.1674], [2246, 0.32, 71.6508], [3303, 0.39, 228.8816], [Infinity, 0.47, 493.1893]],
  2: [[362, 0, 0], [538, 0.15, 54.3462], [673, 0.25, 108.2135], [721, 0.17, 54.3473], [865, 0.179, 60.8377], [1282, 0.3227, 185.1935], [2596, 0.32, 181.7319], [3653, 0.39, 363.4627], [Infinity, 0.47, 655.7704]],
  3: [[2596, 0.30, 0.30], [3653, 0.37, 181.7308], [Infinity, 0.45, 474.0385]],
  5: [[362, 0, 0], [721, 0.15, 54.3462], [865, 0.159, 60.8365], [1282, 0.3027, 185.1923], [2596, 0.30, 181.7308], [3653, 0.37, 363.4615], [Infinity, 0.45, 655.7692]],
  6: [[362, 0, 0], [721, 0.15, 54.3462], [865, 0.159, 60.8365], [908, 0.3027, 185.1923], [1135, 0.3527, 230.6135], [1282, 0.3127, 185.1923], [2596, 0.31, 181.7308], [3653, 0.38, 363.4615], [Infinity, 0.46, 655.7692]]
};
const STSL = { tft: [[1337, 0, 0], [2494, 0.15, 200.5615], [3577, 0.17, 250.4527], [Infinity, 0.10, 0]], notft: [[987, 0, 0], [2144, 0.15, 148.0615], [2727, 0.17, 190.9527], [Infinity, 0.10, 0]] };
const coef = (tab, x) => tab.find((r) => x < r[0]);
const roundDollar = (y) => Math.max(0, Math.floor(y + 0.5));
export function scaleOf(pr) {
  if (pr.noTfn) return 4;
  if (pr.residency === 'foreign') return 3;
  if (!pr.tft) return 1;
  return pr.medicare === 'full' ? 5 : pr.medicare === 'half' ? 6 : 2;
}
// the weekly withholding for weekly earnings (whole dollars plus 99 cents, as the ATO formulas say)
function weeklyTax(earn, pr) {
  const sc = scaleOf(pr);
  if (sc === 4) return Math.floor(Math.floor(earn) * (pr.residency === 'foreign' ? 0.45 : 0.47));
  const x = Math.floor(earn) + 0.99, [, a, b] = coef(SCALES[sc], x);
  return roundDollar(a * x - b);
}
function weeklyStsl(earn, pr) {
  if (!pr.stsl || pr.noTfn) return 0;
  const x = Math.floor(earn) + 0.99, [, a, b] = coef(STSL[pr.tft || pr.residency === 'foreign' ? 'tft' : 'notft'], x);
  return roundDollar(a * x - b);
}
// for a pay period of `weeks` weeks (1 or 2): fortnightly works on half the pay, rounded, then doubled
export function withholding(gross, pr, weeks = 1) {
  const per = gross / weeks;
  return { tax: weeklyTax(per, pr) * weeks, stsl: weeklyStsl(per, pr) * weeks, scale: scaleOf(pr) };
}

/* ---------------- pay profiles ---------------- */
export const EMPLOY = ['Full-time', 'Part-time', 'Casual'];
export const LEAVE = [['', 'None'], ['annual', 'Annual leave'], ['personal', 'Personal / carer\'s leave'], ['rdo', 'RDO taken'], ['unpaid', 'Unpaid leave']];
const defProfile = (p) => ({ pid: p.id, classification: p.trade ? 'CW3' : 'CW1a', tool: '', hourly: 0, employment: EMPLOY.includes(p.employment) ? p.employment : 'Full-time', residency: 'resident', tft: true, noTfn: false, stsl: false, medicare: 'none',
  balances: { annual: 0, personal: 0, rdo: 0 }, active: true, updated: 0 });
export async function profile(pid) { const p = await PPL.get(pid); if (!p) return null; const x = await kv.get('prl:prof:' + pid); return { ...defProfile(p), ...(x || {}), name: p.name, role: p.role, trade: p.trade }; }
async function saveProfile(f, by) {
  const p = await PPL.get(str(f.pid, 10)); if (!p) return { error: 'Person not found', code: 404 };
  if (p.type !== 'Employee') return { error: 'Payroll is for employees. Contractors invoice you and show in the TPAR report.' };
  const old = (await kv.get('prl:prof:' + p.id)) || defProfile(p), S = await settings();
  const b = f.balances || {}, n = (v, d) => (Number.isFinite(Number(v)) ? r2(Number(v)) : d);
  const x = { ...old, pid: p.id, classification: S.classes.some((c) => c.key === f.classification) ? f.classification : old.classification, tool: S.tools.some((t) => t.key === f.tool) ? f.tool : '',
    hourly: Math.max(0, Math.min(500, n(f.hourly, 0))), employment: EMPLOY.includes(f.employment) ? f.employment : old.employment, residency: f.residency === 'foreign' ? 'foreign' : 'resident',
    tft: f.tft !== false, noTfn: !!f.noTfn, stsl: !!f.stsl, medicare: ['full', 'half'].includes(f.medicare) ? f.medicare : 'none', active: f.active !== false,
    balances: { annual: n(b.annual, old.balances.annual), personal: n(b.personal, old.balances.personal), rdo: n(b.rdo, old.balances.rdo) }, updated: Date.now(), updatedBy: str(by, 60) };
  await kv.set('prl:prof:' + p.id, x);
  return { profile: { ...x, name: p.name } };
}
// the ordinary hourly rate: (weekly award rate + industry allowance + tool allowance) / 38, or the agreed above-award rate
export function baseRate(pr, S) {
  const c = S.classes.find((x) => x.key === pr.classification) || S.classes[0], t = S.tools.find((x) => x.key === pr.tool) || { weekly: 0 };
  const award = r2((c.weekly + S.industry + t.weekly) / 38);
  return { award, rate: pr.hourly > award ? r2(pr.hourly) : award, above: pr.hourly > award };
}

/* ---------------- timesheets ---------------- */
// days: { 'YYYY-MM-DD': { hours, job, fares, leave, leaveHours, note } }
const tsKey = (pid, week) => 'prl:ts:' + pid + ':' + week;
export async function timesheet(pid, week) { week = mondayOf(ymd(week) || new Date().toISOString().slice(0, 10)); return (await kv.get(tsKey(pid, week))) || { pid, week, days: {}, status: 'draft' }; }
async function saveTimesheet(f, by) {
  const pid = str(f.pid, 10), week = mondayOf(ymd(f.week) || ''); if (!week) return { error: 'Pick a week' };
  const p = await PPL.get(pid); if (!p) return { error: 'Person not found', code: 404 };
  const old = await timesheet(pid, week);
  if (old.status === 'paid') return { error: 'This week is already paid in ' + old.payrun + ' and can’t be changed.' };
  const days = {};
  for (let i = 0; i < 7; i++) {
    const d = addDays(week, i), g = (f.days || {})[d] || {};
    const hours = Math.max(0, Math.min(16, r2(g.hours))), leaveHours = Math.max(0, Math.min(16, r2(g.leaveHours)));
    const leave = LEAVE.some((l) => l[0] === g.leave) ? g.leave : '';
    if (hours || (leave && leaveHours) || g.note) days[d] = { hours, job: str(g.job, 20), fares: hours > 0 && g.fares !== false, leave, leaveHours: leave ? leaveHours : 0, note: str(g.note, 120) };
  }
  const status = f.status === 'approved' ? 'approved' : 'draft';
  const x = { pid, week, days, status, updated: Date.now(), updatedBy: str(by, 60), approvedBy: status === 'approved' ? str(by, 60) : '', approvedAt: status === 'approved' ? Date.now() : 0 };
  await kv.set(tsKey(pid, week), x);
  await kv.update('prl-ts-index', (ix) => { ix[pid + ':' + week] = { pid, week, status, hours: Object.values(days).reduce((s, d) => s + d.hours, 0) }; return ix; }, () => ({}));
  return { timesheet: x };
}

/* ---------------- the award calculation ---------------- */
// one week of one person: every pay line, plus what goes to each job, the ordinary-time earnings (for super) and leave
export function calcWeek(ts, pr, S) {
  const { rate } = baseRate(pr, S), casual = pr.employment === 'Casual', rdo = S.rdo && !casual;
  const lines = {}, perJob = {}, acc = { annual: 0, personal: 0, rdo: 0 }, taken = { annual: 0, personal: 0, rdo: 0 };
  let ote = 0;
  const add = (key, label, hours, mult, job, isOte, flat) => {
    if (!hours && !flat) return;
    const amt = flat ? r2(flat) : r2(hours * rate * mult);
    const L = lines[key] || (lines[key] = { label, hours: 0, rate: flat ? 0 : r2(rate * mult), amount: 0, ote: isOte });
    L.hours = r2(L.hours + (flat ? 0 : hours)); L.amount = r2(L.amount + amt);
    if (job !== undefined) perJob[job || '(no job)'] = r2((perJob[job || '(no job)'] || 0) + amt);
    if (isOte) ote = r2(ote + amt);
  };
  const H = S.holidays || [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(ts.week, i), e = (ts.days || {})[d] || {}, wd = dow(d), ph = H.includes(d), h = e.hours || 0, job = e.job || '';
    if (h > 0) {
      if (ph) add('ph', 'Public holiday worked', h, casual ? 2.75 : 2.5, job, false);
      else if (wd === 0) add('sun', 'Sunday', h, casual ? 2.25 : 2, job, false);
      else if (wd === 6) { const a = Math.min(2, h); add('sat1', 'Saturday (first 2 hours)', a, casual ? 1.75 : 1.5, job, false); add('sat2', 'Saturday (after 2 hours)', h - a, casual ? 2.25 : 2, job, false); }
      else {
        // RDO system: an 8-hour day is 7.6 hours paid plus 0.4 hours banked towards a rostered day off; overtime after 8 hours
        const limit = rdo ? 8 : 7.6, ord = Math.min(h, limit), ot = Math.max(0, r2(h - limit)), paidOrd = Math.min(ord, 7.6);
        add('ord', casual ? 'Ordinary hours (incl. 25% casual loading)' : 'Ordinary hours', paidOrd, casual ? 1.25 : 1, job, true);
        if (rdo) acc.rdo += Math.max(0, ord - 7.6);
        const o1 = Math.min(2, ot); add('ot1', 'Overtime (first 2 hours)', o1, casual ? 1.75 : 1.5, job, false); add('ot2', 'Overtime (after 2 hours)', r2(ot - o1), casual ? 2.25 : 2, job, false);
        if (ot >= 1.5 && S.meal) add('meal', 'Meal allowance', 0, 1, job, false, S.meal);
        if (!casual) { acc.annual += paidOrd * 152 / 1976; acc.personal += paidOrd * 76 / 1976; }
      }
      if (e.fares !== false && S.fares) add('fares', 'Fares and travel allowance', 0, 1, job, false, S.fares);
    } else if (ph && wd >= 1 && wd <= 5 && !casual) add('phoff', 'Public holiday (not worked)', 7.6, 1, undefined, true);
    if (e.leave && e.leaveHours && !casual) {
      const lh = e.leaveHours;
      if (e.leave === 'annual') { add('al', 'Annual leave', lh, 1, undefined, true); add('all', 'Annual leave loading (' + S.loading + '%)', lh, S.loading / 100, undefined, true); taken.annual = r2(taken.annual + lh); }
      if (e.leave === 'personal') { add('pl', 'Personal / carer’s leave', lh, 1, undefined, true); taken.personal = r2(taken.personal + lh); }
      if (e.leave === 'rdo') { add('rdo', 'RDO taken', lh, 1, undefined, true); taken.rdo = r2(taken.rdo + lh); }
      if (e.leave !== 'unpaid' && e.leave !== 'rdo') { acc.annual += lh * 152 / 1976; acc.personal += lh * 76 / 1976; }
    }
  }
  const gross = r2(Object.values(lines).reduce((s, l) => s + l.amount, 0));
  for (const k of Object.keys(acc)) acc[k] = r2(acc[k]);
  return { rate, lines: Object.values(lines), gross, ote, perJob, accrued: acc, taken };
}
// a person for a whole pay period (1 or 2 weeks): pay lines, tax, super, net, leave
export function calcPerson(weeks, pr, S) {
  const all = weeks.map((ts) => calcWeek(ts, pr, S));
  const merge = {}, perJob = {}, acc = { annual: 0, personal: 0, rdo: 0 }, taken = { annual: 0, personal: 0, rdo: 0 };
  let ote = 0;
  for (const w of all) {
    for (const l of w.lines) { const m = merge[l.label] || (merge[l.label] = { ...l, hours: 0, amount: 0 }); m.hours = r2(m.hours + l.hours); m.amount = r2(m.amount + l.amount); }
    for (const [j, v] of Object.entries(w.perJob)) perJob[j] = r2((perJob[j] || 0) + v);
    for (const k of Object.keys(acc)) { acc[k] = r2(acc[k] + w.accrued[k]); taken[k] = r2(taken[k] + w.taken[k]); }
    ote = r2(ote + w.ote);
  }
  const lines = Object.values(merge), gross = r2(lines.reduce((s, l) => s + l.amount, 0));
  const wh = withholding(gross, pr, weeks.length || 1), sup = r2(ote * S.superRate / 100);
  const bal = { annual: r2((pr.balances.annual || 0) + acc.annual - taken.annual), personal: r2((pr.balances.personal || 0) + acc.personal - taken.personal), rdo: r2((pr.balances.rdo || 0) + acc.rdo - taken.rdo) };
  return { rate: all[0] ? all[0].rate : baseRate(pr, S).rate, lines, gross, tax: wh.tax, stsl: wh.stsl, scale: wh.scale, net: r2(gross - wh.tax - wh.stsl), ote, super: sup, perJob, accrued: acc, taken, balances: bal,
    warnings: Object.entries(bal).filter(([k, v]) => v < 0).map(([k]) => (k === 'rdo' ? 'RDO' : k[0].toUpperCase() + k.slice(1) + ' leave') + ' balance would go below zero') };
}

/* ---------------- pay runs ---------------- */
async function runs() { return (await kv.get('prl-runs')) || []; }
async function employees() { return (await PPL.list()).people.filter((p) => p.type === 'Employee' && !p.archived && p.status !== 'Inactive'); }
async function createRun(f, by) {
  const S = await settings(), weeksN = S.frequency === 'fortnightly' ? 2 : 1, from = mondayOf(ymd(f.from) || '');
  if (!from) return { error: 'Pick the first Monday of the pay period' };
  const to = addDays(from, weeksN * 7 - 1), list = await runs();
  if (list.some((r) => r.from === from && r.status !== 'deleted')) return { error: 'There is already a pay run for the period starting ' + from + '.' };
  const lines = [], skipped = [];
  for (const p of await employees()) {
    const pr = await profile(p.id); if (!pr.active) continue;
    const weeks = []; for (let k = 0; k < weeksN; k++) weeks.push(await timesheet(p.id, addDays(from, k * 7)));
    const has = weeks.some((w) => Object.keys(w.days || {}).length), ok = weeks.every((w) => !Object.keys(w.days || {}).length || w.status === 'approved');
    const phPaid = !has && S.holidays.some((d) => d >= from && d <= to) && pr.employment !== 'Casual';
    if (!has && !phPaid) continue;
    if (!ok) { skipped.push(p.name + ' (timesheet not approved)'); continue; }
    if (weeks.some((w) => w.status === 'paid')) { skipped.push(p.name + ' (already paid)'); continue; }
    const c = calcPerson(weeks, pr, S);
    lines.push({ pid: p.id, name: p.name, employment: pr.employment, classification: pr.classification, ...c });
  }
  const n = (await kv.update('prl-seq', (x) => ({ n: ((x && x.n) || 0) + 1 }), () => ({ n: 0 }))).n;
  const run = { id: 'PR-' + String(n).padStart(4, '0'), from, to, frequency: S.frequency, payDate: ymd(f.payDate) || addDays(to, 4), status: 'draft', created: Date.now(), createdBy: str(by, 60), lines, skipped,
    totals: tot(lines), settingsChecked: !!S.checked };
  await kv.set('prl:run:' + run.id, run);
  await kv.set('prl-runs', list.concat([{ id: run.id, from, to, payDate: run.payDate, status: 'draft', people: lines.length, gross: run.totals.gross, net: run.totals.net, super: run.totals.super, tax: run.totals.tax }]));
  return { run };
}
const tot = (lines) => ({ gross: r2(lines.reduce((s, l) => s + l.gross, 0)), tax: r2(lines.reduce((s, l) => s + l.tax + l.stsl, 0)), net: r2(lines.reduce((s, l) => s + l.net, 0)), super: r2(lines.reduce((s, l) => s + l.super, 0)) });
export async function getRun(id) { return /^PR-\d{4}$/.test(id || '') ? kv.get('prl:run:' + id) : null; }
async function finaliseRun(id, by) {
  const run = await getRun(id); if (!run) return { error: 'Pay run not found', code: 404 };
  if (run.status !== 'draft') return { error: 'This pay run is already final.' };
  const weeksN = run.frequency === 'fortnightly' ? 2 : 1;
  for (const l of run.lines) {
    for (let k = 0; k < weeksN; k++) { const w = addDays(run.from, k * 7), ts = await kv.get(tsKey(l.pid, w)); if (ts) { ts.status = 'paid'; ts.payrun = run.id; await kv.set(tsKey(l.pid, w), ts); await kv.update('prl-ts-index', (ix) => { if (ix[l.pid + ':' + w]) ix[l.pid + ':' + w].status = 'paid'; return ix; }, () => ({})); } }
    const pr = await kv.get('prl:prof:' + l.pid) || defProfile(await PPL.get(l.pid)); pr.balances = l.balances; pr.updated = Date.now(); await kv.set('prl:prof:' + l.pid, pr);
  }
  run.status = 'final'; run.finalisedAt = Date.now(); run.finalisedBy = str(by, 60);
  await kv.set('prl:run:' + run.id, run);
  await kv.update('prl-runs', (L) => L.map((r) => (r.id === run.id ? { ...r, status: 'final' } : r)), () => []);
  return { run };
}
async function deleteRun(id) {
  const run = await getRun(id); if (!run) return { error: 'Pay run not found', code: 404 };
  if (run.status !== 'draft') return { error: 'A final pay run can’t be deleted (it has been paid). Fix it in the next pay run.' };
  await kv.del('prl:run:' + id); await kv.update('prl-runs', (L) => L.filter((r) => r.id !== id), () => []);
  return { ok: true };
}
// CSV for the payroll service (one row per pay line; tax, HELP, super and net on each person's total row)
export function runCsv(run) {
  const cell = (x) => { x = String(x == null ? '' : x); return /[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; };
  const rows = [['Pay run', 'Period start', 'Period end', 'Pay date', 'Employee ID', 'Employee', 'Employment', 'Classification', 'Pay item', 'Hours', 'Rate', 'Amount', 'Ordinary time earnings', 'PAYG withheld', 'HELP / STSL', 'Super', 'Net pay']];
  for (const l of run.lines) {
    for (const x of l.lines) rows.push([run.id, run.from, run.to, run.payDate, l.pid, l.name, l.employment, l.classification, x.label, x.hours || '', x.rate || '', x.amount.toFixed(2), x.ote ? 'yes' : 'no', '', '', '', '']);
    rows.push([run.id, run.from, run.to, run.payDate, l.pid, l.name, l.employment, l.classification, 'TOTAL', '', '', l.gross.toFixed(2), l.ote.toFixed(2), l.tax.toFixed(2), l.stsl.toFixed(2), l.super.toFixed(2), l.net.toFixed(2)]);
  }
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/* ---------------- labour cost per job ---------------- */
async function jobCosts(from, to) {
  const S = await settings(), ix = (await kv.get('prl-ts-index')) || {}, jobs = {};
  for (const k of Object.keys(ix)) {
    const { pid, week, status } = ix[k]; if (week > to || addDays(week, 6) < from || status === 'draft') continue;
    const ts = await kv.get(tsKey(pid, week)), pr = await profile(pid); if (!ts || !pr) continue;
    const days = Object.fromEntries(Object.entries(ts.days || {}).filter(([d]) => d >= from && d <= to));
    const w = calcWeek({ ...ts, days }, pr, S);
    for (const [job, amt] of Object.entries(w.perJob)) {
      const J = jobs[job] || (jobs[job] = { job, hours: 0, wages: 0, super: 0, oncost: 0, total: 0, people: {} });
      const hrs = Object.values(days).filter((d) => (d.job || '(no job)') === job).reduce((s, d) => s + d.hours, 0);
      const sup = r2(amt * (w.gross ? w.ote / w.gross : 0) * S.superRate / 100), on = r2(amt * S.onCost / 100);
      J.hours = r2(J.hours + hrs); J.wages = r2(J.wages + amt); J.super = r2(J.super + sup); J.oncost = r2(J.oncost + on); J.total = r2(J.wages + J.super + J.oncost); J.people[pr.name] = true;
    }
  }
  return Object.values(jobs).map((j) => ({ ...j, people: Object.keys(j.people) })).sort((a, b) => b.total - a.total);
}

/* ---------------- TPAR: payments to contractors ---------------- */
// building and construction businesses report payments to contractors each financial year (due 28 August)
async function tpar(fy, A, SUB) {
  const y = Number(String(fy).slice(0, 4)) || (new Date().getMonth() >= 6 ? new Date().getFullYear() : new Date().getFullYear() - 1);
  const from = y + '-07-01', to = (y + 1) + '-06-30';
  const payees = [];
  for (const s of (await SUB.list()).subs) { const full = s.abn ? s : ((await SUB.getSub(s.id)) || s); payees.push({ name: s.business || '', abn: full.abn || '', kind: 'Sub-contractor', key: (s.business || '').toLowerCase() }); }
  for (const p0 of (await PPL.list()).people.filter((x) => x.type === 'Contractor')) { const p = (await PPL.get(p0.id)) || p0; payees.push({ name: p.business || p.name, abn: p.abn || '', kind: 'Contractor', key: (p.business || p.name || '').toLowerCase(), alt: (p.name || '').toLowerCase() }); }
  const rows = {}, other = {};
  for (const e of await A.list('expense')) {
    if (!e.date || e.date < from || e.date > to) continue;
    const sup = String(e.supplier || '').toLowerCase().trim(); if (!sup) continue;
    const pe = payees.find((p) => p.key && (sup === p.key || sup.includes(p.key) || (p.alt && sup.includes(p.alt))));
    if (!pe && e.category !== 'Subcontractors') continue;
    const k = pe ? pe.name : e.supplier, R = (pe ? rows : other)[k] || ((pe ? rows : other)[k] = { name: k, abn: pe ? pe.abn : '', kind: pe ? pe.kind : 'Not in Subbies or People', payments: 0, gross: 0, gst: 0 });
    R.payments++; R.gross = r2(R.gross + (Number(e.inc) || 0)); R.gst = r2(R.gst + (Number(e.gst) || 0));
  }
  const list = Object.values(rows).concat(Object.values(other)).sort((a, b) => b.gross - a.gross);
  return { fy: y + '-' + String(y + 1).slice(2), from, to, due: (y + 1) + '-08-28', rows: list, missingAbn: list.filter((r) => !r.abn).length, total: r2(list.reduce((s, r) => s + r.gross, 0)) };
}

/* ---------------- console actions (People: edit) ---------------- */
export async function prlPost(action, body, { by, audit, who, A, SUB }) {
  const log = (t) => (audit ? audit(who, t) : null);
  switch (action) {
    case 'prlSettings': return out(200, { settings: await settings(), defaults: DEFAULTS, leave: LEAVE, employ: EMPLOY });
    case 'prlSettingsSave': { const s = cleanSettings(body.settings || {}, by); await kv.set('prl-settings', s); await log('Payroll settings saved' + (s.checked ? ' (checked against the pay guide)' : '')); return out(200, { settings: s }); }
    case 'prlPeople': {
      const S = await settings(), list = [];
      for (const p of await employees()) { const pr = await profile(p.id); list.push({ ...pr, ...baseRate(pr, S) }); }
      return out(200, { people: list, settings: S });
    }
    case 'prlProfileSave': { const r = await saveProfile(body.profile || {}, by); if (r.error) return out(r.code || 400, r); await log('Pay profile saved: ' + r.profile.name); return out(200, r); }
    case 'prlTimesheet': { const pr = await profile(str(body.pid, 10)); if (!pr) return out(404, { error: 'Person not found' }); const ts = await timesheet(pr.pid, body.week); const S = await settings(); return out(200, { timesheet: ts, preview: calcPerson([ts], pr, S), profile: pr }); }
    case 'prlTimesheetSave': { const r = await saveTimesheet(body.timesheet || {}, by); if (r.error) return out(r.code || 400, r); if (r.timesheet.status === 'approved') await log(`Timesheet approved: ${r.timesheet.pid} week ${r.timesheet.week}`); return out(200, r); }
    case 'prlWeek': {   // everyone's timesheet status for a week
      const week = mondayOf(ymd(body.week) || new Date().toISOString().slice(0, 10)), ix = (await kv.get('prl-ts-index')) || {};
      return out(200, { week, people: (await employees()).map((p) => ({ pid: p.id, name: p.name, ...(ix[p.id + ':' + week] || { status: 'none', hours: 0 }) })) });
    }
    case 'prlRuns': return out(200, { runs: (await runs()).slice().reverse(), settings: await settings() });
    case 'prlRunGet': { const r = await getRun(str(body.id, 10)); return r ? out(200, { run: r }) : out(404, { error: 'Pay run not found' }); }
    case 'prlRunCreate': { const r = await createRun(body, by); if (r.error) return out(400, r); await log(`Pay run ${r.run.id} drafted (${r.run.from} to ${r.run.to}, ${r.run.lines.length} people)`); return out(200, r); }
    case 'prlRunFinalise': { const r = await finaliseRun(str(body.id, 10), by); if (r.error) return out(r.code || 400, r); await log(`Pay run ${r.run.id} finalised`); return out(200, r); }
    case 'prlRunDelete': { const r = await deleteRun(str(body.id, 10)); if (r.error) return out(r.code || 400, r); await log(`Draft pay run ${body.id} deleted`); return out(200, r); }
    case 'prlRunCsv': { const r = await getRun(str(body.id, 10)); if (!r) return out(404, { error: 'Pay run not found' }); return out(200, { csv: runCsv(r), name: `MBS-${r.id}-${r.from}.csv` }); }
    case 'prlJobCosts': { const from = ymd(body.from), to = ymd(body.to); if (!from || !to) return out(400, { error: 'Pick dates' }); return out(200, { from, to, jobs: await jobCosts(from, to), settings: await settings() }); }
    case 'prlTpar': return out(200, await tpar(body.fy, A, SUB));
    default: return null;
  }
}
