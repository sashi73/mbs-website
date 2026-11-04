// v109: test payroll data (test site only). 20 test employees with pay profiles, opening leave balances for the full-timers,
// two weeks of approved timesheets against jobs, one finished pay run and one draft, and annual leave requests (approved,
// waiting, and a Christmas clash). Everything is marked as test data (emails @example.com, names end in "(test)").
import * as kv from './kv.mjs';
import * as PPL from './people.mjs';
import * as PR from './payroll.mjs';

const today = () => new Date(Date.now() + 11 * 3600e3).toISOString().slice(0, 10);
const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

// [name, role, trade, employment, classification, tool, hourly (above award), tax: tft/stsl/noTft, annual h, personal h, rdo h]
const TEAM = [
  ['Jack Morrison', 'Leading hand', 'carpenter', 'Full-time', 'CW5', 'carpenter', 0, 'tft', 164.2, 61.4, 7.6],
  ['Sophie Nguyen', 'Tradesperson', 'carpenter', 'Full-time', 'CW3', 'carpenter', 0, 'tft-help', 98.8, 45.6, 3.2],
  ['Liam O\'Brien', 'Tradesperson', 'plasterer', 'Full-time', 'CW3', 'plasterer', 0, 'tft', 121.6, 52.0, 0],
  ['Aisha Rahman', 'Tradesperson', 'tiler', 'Full-time', 'CW3', 'carpenter', 0, 'tft', 45.6, 38.0, 4.8],
  ['Marco Rossi', 'Tradesperson', 'bricklayer', 'Full-time', 'CW3', 'bricklayer', 0, 'tft', 182.4, 76.0, 7.6],
  ['Hannah Lee', 'Site supervisor', 'builder', 'Full-time', 'CW7', '', 42.5, 'tft', 140.0, 70.0, 0],
  ['Tom Walsh', 'Tradesperson', 'roofer', 'Full-time', 'CW3', 'roofer', 0, 'tft-help', 30.4, 22.8, 1.6],
  ['Priya Patel', 'Tradesperson', 'painter', 'Full-time', 'CW3', 'painter', 0, 'tft', 76.0, 40.0, 6.4],
  ['Daniel Kim', 'Labourer', '', 'Full-time', 'CW1d', '', 0, 'tft', 12.2, 15.2, 0.8],
  ['Ella Thompson', 'Labourer', '', 'Full-time', 'CW2', '', 0, 'tft', 60.8, 30.4, 2.4],
  ['Josh Williams', 'Tradesperson', 'carpenter', 'Full-time', 'CW4', 'carpenter', 0, 'tft', 111.0, 50.2, 5.6],
  ['Mei Chen', 'Estimator', '', 'Full-time', 'CW6', '', 0, 'tft', 88.4, 60.8, 0],
  ['Ryan Fraser', 'Tradesperson', 'waterproofer', 'Full-time', 'CW3', '', 0, 'tft', 150.0, 70.5, 4.0],
  ['Grace Kelly', 'Office / admin', '', 'Part-time', 'CW2', '', 0, 'tft', 40.0, 20.0, 0],
  ['Sam Taylor', 'Tradesperson', 'painter', 'Part-time', 'CW3', 'painter', 0, 'notft', 24.0, 12.0, 0],
  ['Olivia Brown', 'Labourer', '', 'Part-time', 'CW1b', '', 0, 'tft', 16.0, 8.0, 0],
  ['Noah Martin', 'Labourer', '', 'Casual', 'CW1a', '', 0, 'tft', 0, 0, 0],
  ['Chloe Davis', 'Labourer', '', 'Casual', 'CW1b', '', 0, 'notft', 0, 0, 0],
  ['Ben Harris', 'Tradesperson', 'carpenter', 'Casual', 'CW3', 'carpenter', 0, 'tft', 0, 0, 0],
  ['Zara Ahmed', 'Labourer', '', 'Casual', 'CW1c', '', 0, 'tft-help', 0, 0, 0]
];

export async function samplePayroll(by) {
  if (!PPL.isTest()) return { error: 'Test payroll data can only be loaded on the test site.', code: 403 };
  if (await kv.get('prl-sample')) return { error: 'The test payroll data is already loaded.', code: 409 };
  const LV = await import('./leave.mjs');
  // jobs to book hours to: the project plans if there are any, otherwise test job codes
  const plans = (await kv.keys('plan:')).map((k) => k.slice(5)).filter(Boolean).slice(0, 5);
  const jobs = plans.length ? plans : ['MBS-101', 'MBS-102', 'MBS-103', 'MBS-104', 'MBS-105'];
  const ids = [];
  for (let i = 0; i < TEAM.length; i++) {
    const [name, role, trade, employment, cls, tool, hourly, tax, annual, personal, rdo] = TEAM[i];
    const email = name.toLowerCase().replace(/[^a-z]+/g, '.') + '@example.com';
    const r = await PPL.save({ type: 'Employee', name: name + ' (test)', role, trade, employment, email, phone: '0400 000 ' + String(100 + i), status: 'Active', start: addDays(today(), -400 - i * 37),
      tickets: { whiteCard: { number: 'WC' + (10000 + i) } } }, by);
    if (!r.person) continue;
    ids.push(r.person.id);
    await PR.saveProfile({ pid: r.person.id, employment, classification: cls, tool, hourly, residency: 'resident', tft: tax !== 'notft', stsl: tax === 'tft-help', medicare: 'none', active: true,
      balances: { annual, personal, rdo } }, by);
  }
  // two complete weeks of approved timesheets
  const thisMon = PR.mondayOf(today()), weeks = [addDays(thisMon, -14), addDays(thisMon, -7)];
  let tsCount = 0;
  for (let k = 0; k < ids.length; k++) {
    const emp = TEAM[k][3], casual = emp === 'Casual', part = emp === 'Part-time';
    for (let w = 0; w < weeks.length; w++) {
      const days = {};
      for (let d = 0; d < 6; d++) {
        const date = addDays(weeks[w], d), job = jobs[(k + d + w) % jobs.length];
        if (d === 5) { if ((k + w) % 4 === 0) days[date] = { hours: 5, job, fares: true }; continue; }   // some Saturday work
        if (part && d >= 3) continue;                                                                    // part-timers: Mon–Wed
        if (casual && (k + d + w) % 3 === 0) continue;                                                    // casuals: some days off
        if (!casual && !part && d === 4 && (k + w) % 5 === 1) { days[date] = { hours: 0, leave: 'personal', leaveHours: 7.6, note: 'Sick' }; continue; }
        if (!casual && !part && d === 0 && (k + w) % 7 === 2) { days[date] = { hours: 0, leave: 'rdo', leaveHours: 7.6, note: 'RDO' }; continue; }
        const long = (k + d) % 6 === 0;                                                                   // some long days: overtime and a meal allowance
        days[date] = { hours: long ? 10 : casual ? 7.6 : 8, job, fares: TEAM[k][1] !== 'Office / admin' && TEAM[k][1] !== 'Estimator' };
      }
      await PR.saveTimesheet({ pid: ids[k], week: weeks[w], days, status: 'approved' }, by); tsCount++;
    }
  }
  // a finished pay run (two weeks ago) and a draft one (last week)
  const s = await PR.settings(); if (s.frequency !== 'weekly') await kv.set('prl-settings', { ...s, frequency: 'weekly' });
  const r1 = await PR.createRun({ from: weeks[0], payDate: addDays(weeks[0], 10) }, by); if (r1.run) await PR.finaliseRun(r1.run.id, by);
  const r2 = await PR.createRun({ from: weeks[1], payDate: addDays(weeks[1], 10) }, by);
  // annual leave for the full-timers: approved, waiting, and a Christmas clash
  const L = async (k, from, to, approve, reason) => {
    const body = { pid: ids[k], type: 'annual', from, to, perDay: 7.6, reason, approve };
    const res = await LV.lvPost('lvSave', body, { by, ctx: { owner: true } });
    return res.status === 200;
  };
  const y = Number(today().slice(0, 4)), xmas = (d) => y + '-12-' + d, jan = (d) => (y + 1) + '-01-' + d;
  const leave = [
    [0, addDays(thisMon, 14), addDays(thisMon, 18), true, 'Family trip to the Gold Coast'],
    [2, addDays(thisMon, 21), addDays(thisMon, 22), true, 'Wedding'],
    [4, xmas('21'), jan('08'), true, 'Christmas in Italy'],
    [1, xmas('21'), xmas('24'), false, 'Christmas with family'],
    [10, xmas('22'), xmas('31'), false, 'Summer holidays'],
    [12, xmas('29'), jan('02'), false, 'New Year'],
    [7, addDays(thisMon, 28), addDays(thisMon, 28), false, 'Moving house'],
    [5, jan('11'), jan('22'), true, 'School holidays'],
    [3, addDays(thisMon, 9), addDays(thisMon, 9), true, 'Appointment'],
    [11, jan('27'), jan('29'), false, 'Long weekend away']
  ];
  let lvCount = 0; for (const [k, f, t, ap, why] of leave) if (await L(k, f, t, ap, why)) lvCount++;
  await kv.set('prl-sample', { at: Date.now(), by, ids });
  return { people: ids.length, timesheets: tsCount, runs: [r1.run && r1.run.id, r2.run && r2.run.id].filter(Boolean), leave: lvCount, jobs };
}
