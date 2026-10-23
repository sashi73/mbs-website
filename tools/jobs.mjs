// MBS enquiries: list them, and turn a pre-job number into a real job number.
//
//   node tools/jobs.mjs list                       recent enquiries
//   node tools/jobs.mjs show R-261017-000001       full details of one enquiry
//   node tools/jobs.mjs convert R-261017-000001    make it a job: JR-261017-000001
//   node tools/jobs.mjs status R-261017-000001 contacted
//   node tools/jobs.mjs codes                      what the trade letters mean
//        (status: new, contacted, quoted, converted, lost)
//
// Run from the website folder. Reads and writes data/mbs.db.

import { openDb, nextNumber, jobNumberFor, TRADES, paths } from '../netlify/lib/store.mjs';

const [cmd = 'list', ref, extra] = process.argv.slice(2);
const db = await openDb();
if (!db) {
  console.log('\nSQLite is not available in this version of Node.js. Install Node 22.5 or newer (LTS) from nodejs.org.\n');
  process.exit(1);
}

const find = (r) => db.prepare('SELECT * FROM inquiries WHERE prejob_no = ? OR job_no = ?').get(String(r || '').toUpperCase(), String(r || '').toUpperCase());
const cut = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n); };

switch (cmd) {
  case 'list': {
    const rows = db.prepare('SELECT * FROM inquiries ORDER BY id DESC LIMIT 30').all();
    if (!rows.length) { console.log('\nNo enquiries yet. They appear here as soon as one arrives from the website.\n'); break; }
    console.log('\n  ' + cut('Reference', 17) + cut('Job', 18) + cut('Status', 11) + cut('Received', 21) + cut('Name', 18) + cut('Phone', 14) + 'Job / question');
    console.log('  ' + '-'.repeat(120));
    for (const r of rows) {
      console.log('  ' + cut(r.prejob_no, 17) + cut(r.job_no || '-', 18) + cut(r.status, 11) + cut(r.created_at, 21) +
        cut(r.customer_name, 18) + cut(r.phone, 14) + cut(r.service + (r.suburb ? ' · ' + r.suburb : ''), 34));
    }
    console.log(`\n  ${rows.length} shown. Database: ${paths.DB_FILE}\n`);
    break;
  }
  case 'show': {
    const r = find(ref);
    if (!r) { console.log(`\nNo enquiry found for "${ref}".\n`); process.exit(1); }
    console.log('');
    if (r.trade_code) console.log('  ' + 'trade'.padEnd(14) + ' ' + r.trade_code + ' = ' + (TRADES[r.trade_code] || ''));
    for (const k of ['prejob_no', 'job_no', 'status', 'source', 'created_at', 'converted_at', 'customer_name', 'phone', 'email', 'suburb',
      'service', 'urgency', 'best_time', 'details', 'summary', 'email_sent', 'telegram_sent', 'notes']) {
      if (r[k] !== null && r[k] !== '') console.log('  ' + k.padEnd(14) + ' ' + r[k]);
    }
    if (r.photos) {
      console.log('\n  Photos:');
      try { JSON.parse(r.photos).forEach((f) => console.log('    ' + f)); } catch {}
    }
    if (r.transcript) {
      console.log('\n  Conversation:');
      try { JSON.parse(r.transcript).forEach((m) => console.log(`    ${m.role === 'user' ? 'Customer ' : 'Mr. Fixit'}: ${String(m.content).replace(/\n/g, ' ')}`)); } catch {}
    }
    console.log('');
    break;
  }
  case 'convert': {
    const r = find(ref);
    if (!r) { console.log(`\nNo enquiry found for "${ref}".\n`); process.exit(1); }
    if (r.job_no) { console.log(`\n${r.prejob_no} is already job ${r.job_no}.\n`); break; }
    const job = jobNumberFor(r.prejob_no) || nextNumber('J');   // older P-2026-0001 style gets J-2026-0001
    db.prepare("UPDATE inquiries SET job_no = ?, status = 'converted', converted_at = datetime('now','localtime') WHERE id = ?").run(job, r.id);
    console.log(`\n  ✔  ${r.prejob_no} is now job ${job}  (${r.customer_name || 'customer'}, ${r.service || 'job'})\n`);
    break;
  }
  case 'status': {
    const allowed = ['new', 'contacted', 'quoted', 'converted', 'lost'];
    const r = find(ref);
    if (!r) { console.log(`\nNo enquiry found for "${ref}".\n`); process.exit(1); }
    if (!allowed.includes(extra)) { console.log(`\nStatus must be one of: ${allowed.join(', ')}\n`); process.exit(1); }
    db.prepare('UPDATE inquiries SET status = ? WHERE id = ?').run(extra, r.id);
    console.log(`\n  ✔  ${r.prejob_no} status is now "${extra}"\n`);
    break;
  }
  case 'codes': {
    console.log('\n  Reference format: TRADE-YYMMDD-running no.  (job = J + reference)\n');
    for (const [k, v] of Object.entries(TRADES)) console.log(`    ${k}  ${v}`);
    console.log('');
    break;
  }
  default:
    console.log('\nUse: list | show <ref> | convert <ref> | codes | status <ref> <new|contacted|quoted|converted|lost>\n');
}
