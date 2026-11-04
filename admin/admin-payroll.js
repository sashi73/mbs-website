/* MBS Console v107: People > Payroll. Timesheets (hours per day and job), pay worked out under the Building and Construction
   General On-site Award 2020, pay runs with payslips (PDF), leave balances, labour cost per job, the contractors' TPAR, and the
   rates and rules. Lodging Single Touch Payroll and paying super stay with the payroll service: each pay run exports a CSV for it. */
(function () {
  'use strict';
  var M = window.MBS; if (!M) return;
  var api = M.api, esc = M.esc, money = M.money, toast = M.toast, fail = M.fail, $ = M.$;
  var V = function () { return M.view(); };
  var P = { tab: 'ts', week: '', S: null, jobs: null, run: null };
  var TABS = [['ts', '⏱ Timesheets'], ['runs', '💵 Pay runs'], ['people', '👤 Pay profiles'], ['jobs', '🏗 Labour cost by job'], ['tpar', '🧾 Contractors (TPAR)'], ['rates', '⚙ Rates & rules']];
  var DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var addDays = function (d, n) { var t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  var mondayOf = function (d) { var w = new Date(d + 'T00:00:00Z').getUTCDay(); return addDays(d, -((w + 6) % 7)); };
  var todayS = function () { return new Date(Date.now() + 11 * 3600e3).toISOString().slice(0, 10); };
  var nice = function (d) { return d ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) : ''; };
  var fmtH = function (n) { return (Math.round((Number(n) || 0) * 100) / 100).toString(); };
  var saveFile = function (text, name, type) { var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: type || 'text/csv;charset=utf-8' })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500); };
  var pdfUrl = function (run, pid) { return M.API + '?action=payslipPdf&run=' + encodeURIComponent(run) + '&pid=' + encodeURIComponent(pid) + '&view=1'; };

  function page(args) {
    if (args && args[0] && TABS.some(function (t) { return t[0] === args[0]; })) P.tab = args[0];
    if (args && args[1]) P.runId = args[1];
    $('#title').textContent = 'Payroll';
    if (!M.allowed('people', 'edit')) { V().innerHTML = '<div class="card noaccess"><h2>🔒 No access</h2><p class="muted">Payroll needs edit access to People.</p></div>'; return; }
    return api('prlSettings').then(function (s) {
      P.S = s.settings; P.LEAVE = s.leave; P.EMPLOY = s.employ;
      V().innerHTML = '<div class="row" style="margin-bottom:12px"><div class="tabs" style="margin:0">' + TABS.map(function (t) { return '<a class="tab' + (P.tab === t[0] ? ' on' : '') + '" href="#payroll/' + t[0] + '">' + t[1] + '</a>'; }).join('') + '</div><span class="sp"></span>' + ((M.me || {}).test ? '<button class="btn btn-sm" id="prlSample" title="Test site only: 20 test employees, leave balances, timesheets, pay runs and leave requests">🧪 Load test payroll data</button>' : '') + '</div>' +
        (P.S.checked ? '' : '<div class="card prl-warn"><b>⚠ Check the rates before the first pay run.</b> They are pre-filled for ' + esc(P.S.year) + ': the award\'s 2025 rates plus the 4.75% Annual Wage Review 2026 increase, the ATO 2026-27 tax formulas and 12% super. Compare them with the Fair Work pay guide for the Building and Construction General On-site Award, then tick "Checked" in <a href="#payroll/rates">Rates &amp; rules</a>.</div>') +
        '<div id="prlBody"><div class="empty">Loading…</div></div>';
      if ($('#prlSample')) $('#prlSample').onclick = function () {
        var b = this;
        M.confirmBox('Load test payroll data?', '20 test employees (names end in “(test)”) with pay profiles and leave balances, two weeks of approved timesheets, a finished pay run and a draft one, and annual leave requests. Test site only.', 'Load it').then(function (ok) {
          if (!ok) return; b.disabled = true;
          api('prlSampleLoad').then(function (r) { toast(r.people + ' test employees, ' + r.timesheets + ' timesheets, pay runs ' + r.runs.join(' and ') + ', ' + r.leave + ' leave requests loaded'); page([P.tab]); }).catch(function (e) { b.disabled = false; fail(e); });
        });
      };
      return draw();
    }).catch(fail);
  }
  function draw() {
    var B = $('#prlBody'); if (!B) return;
    return ({ ts: tsTab, runs: runsTab, people: peopleTab, jobs: jobsTab, tpar: tparTab, rates: ratesTab })[P.tab](B);
  }
  function jobsList() {
    if (P.jobs) return Promise.resolve(P.jobs);
    return api('planList', { today: todayS() }).then(function (d) { P.jobs = d.plans.map(function (p) { return { core: p.core, name: (p.ref || p.core) + ' · ' + (p.name || p.customer || '') }; }); return P.jobs; }).catch(function () { P.jobs = []; return P.jobs; });
  }

  /* ---------- timesheets ---------- */
  function tsTab(B) {
    P.week = P.week || mondayOf(todayS());
    return api('prlWeek', { week: P.week }).then(function (d) {
      var ST = { none: '<span class="muted">No hours yet</span>', draft: '<span class="chip">Draft</span>', approved: '<span class="chip prl-ok">Approved</span>', paid: '<span class="chip prl-paid">Paid</span>' };
      B.innerHTML = '<div class="card"><div class="row" style="gap:8px;margin-bottom:10px"><button class="btn btn-sm" id="tsPrev">‹</button><b>Week of ' + esc(nice(d.week)) + '</b><span class="muted">to ' + esc(nice(addDays(d.week, 6))) + '</span><button class="btn btn-sm" id="tsNext">›</button><button class="btn btn-sm" id="tsNow">This week</button></div>' +
        (d.people.length ? '<div class="table-wrap"><table class="prl-tbl"><thead><tr><th>Employee</th><th class="num">Hours worked</th><th>Status</th><th></th></tr></thead><tbody>' +
          d.people.map(function (p) { return '<tr><td><b>' + esc(p.name) + '</b> <span class="muted">' + esc(p.pid) + '</span></td><td class="num">' + fmtH(p.hours) + '</td><td>' + (ST[p.status] || esc(p.status)) + '</td><td><button class="btn btn-sm" data-ts="' + esc(p.pid) + '">' + (p.status === 'paid' ? 'View' : 'Enter hours') + '</button></td></tr>'; }).join('') + '</tbody></table></div>'
          : '<div class="empty">No active employees. Add them in People (type: Employee).</div>') + '</div><div id="tsEdit"></div>';
      $('#tsPrev').onclick = function () { P.week = addDays(P.week, -7); draw(); };
      $('#tsNext').onclick = function () { P.week = addDays(P.week, 7); draw(); };
      $('#tsNow').onclick = function () { P.week = mondayOf(todayS()); draw(); };
      B.querySelectorAll('[data-ts]').forEach(function (b) { b.onclick = function () { tsEdit(b.getAttribute('data-ts')); }; });
    });
  }
  function tsEdit(pid) {
    return Promise.all([api('prlTimesheet', { pid: pid, week: P.week }), jobsList()]).then(function (r) {
      var d = r[0], jobs = r[1], ts = d.timesheet, pr = d.profile, ro = ts.status === 'paid', H = P.S.holidays || [];
      var E = $('#tsEdit');
      E.innerHTML = '<div class="card"><div class="card-h"><h2>' + esc(pr.name) + ' · week of ' + esc(nice(ts.week)) + '</h2><span class="muted">' + esc(pr.employment) + ' · ' + esc(pr.classification) + ' · ' + money(d.preview.rate) + '/h</span></div>' +
        (ro ? '<p class="muted">Paid in ' + esc(ts.payrun) + '. Paid weeks can\'t be changed.</p>' : '') +
        '<datalist id="prlJobs">' + jobs.map(function (j) { return '<option value="' + esc(j.core) + '">' + esc(j.name) + '</option>'; }).join('') + '</datalist>' +
        '<div class="table-wrap"><table class="prl-tbl prl-grid"><thead><tr><th>Day</th><th>Hours worked</th><th>Job</th><th>Fares</th><th>Leave</th><th>Leave hours</th><th>Note</th></tr></thead><tbody>' +
        DAYS.map(function (dn, i) {
          var date = addDays(ts.week, i), e = (ts.days || {})[date] || {}, ph = H.indexOf(date) >= 0;
          return '<tr data-d="' + date + '" class="' + (i >= 5 ? 'prl-wkend' : '') + '"><td><b>' + dn + '</b> ' + esc(nice(date).replace(/^\w+,? /, '')) + (ph ? ' <span class="chip prl-ph">Public holiday</span>' : '') + '</td>' +
            '<td><input type="number" step="0.25" min="0" max="16" name="hours" value="' + (e.hours || '') + '" ' + (ro ? 'disabled' : '') + ' style="width:80px"></td>' +
            '<td><input name="job" list="prlJobs" value="' + esc(e.job || '') + '" placeholder="Job code" ' + (ro ? 'disabled' : '') + ' style="width:140px"></td>' +
            '<td><input type="checkbox" name="fares" ' + (e.fares === false ? '' : 'checked') + ' ' + (ro ? 'disabled' : '') + ' title="Fares and travel allowance (worked on site)"></td>' +
            '<td><select name="leave" ' + (ro ? 'disabled' : '') + '>' + P.LEAVE.map(function (l) { return '<option value="' + l[0] + '"' + (e.leave === l[0] ? ' selected' : '') + '>' + esc(l[1]) + '</option>'; }).join('') + '</select></td>' +
            '<td><input type="number" step="0.1" min="0" max="16" name="leaveHours" value="' + (e.leaveHours || '') + '" ' + (ro ? 'disabled' : '') + ' style="width:70px"></td>' +
            '<td><input name="note" value="' + esc(e.note || '') + '" ' + (ro ? 'disabled' : '') + ' style="width:160px"></td></tr>';
        }).join('') + '</tbody></table></div>' +
        (ro ? '' : '<div class="actions" style="margin-top:12px"><button class="btn" id="tsSave">Save draft</button><button class="btn btn-gold" id="tsApprove">✓ Approve for pay</button></div>') +
        '<div id="tsPrev2" style="margin-top:14px"></div></div>';
      preview(d.preview);
      var collect = function (status) {
        var days = {};
        E.querySelectorAll('tr[data-d]').forEach(function (tr) { var g = function (n) { return tr.querySelector('[name=' + n + ']'); }; days[tr.getAttribute('data-d')] = { hours: Number(g('hours').value) || 0, job: g('job').value.trim(), fares: g('fares').checked, leave: g('leave').value, leaveHours: Number(g('leaveHours').value) || 0, note: g('note').value }; });
        return { pid: pid, week: ts.week, days: days, status: status };
      };
      var save = function (status) {
        return api('prlTimesheetSave', { timesheet: collect(status) }).then(function () { toast(status === 'approved' ? 'Timesheet approved' : 'Timesheet saved'); return api('prlTimesheet', { pid: pid, week: ts.week }); }).then(function (x) { preview(x.preview); tsTab($('#prlBody')).then(function () { tsEdit(pid); }); }).catch(fail);
      };
      if (!ro) { $('#tsSave').onclick = function () { save('draft'); }; $('#tsApprove').onclick = function () { save('approved'); }; }
      E.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }).catch(fail);
  }
  function preview(c) {
    var el = $('#tsPrev2'); if (!el) return;
    el.innerHTML = '<h3 class="prl-h3">This week\'s pay (preview)</h3>' + payTable(c) + (c.warnings && c.warnings.length ? '<p class="prl-bad">⚠ ' + c.warnings.map(esc).join(' · ') + '</p>' : '');
  }
  function payTable(c) {
    return '<div class="table-wrap"><table class="prl-tbl"><thead><tr><th>Pay item</th><th class="num">Hours</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead><tbody>' +
      c.lines.map(function (l) { return '<tr><td>' + esc(l.label) + (l.ote ? '' : ' <span class="muted" title="Not ordinary time earnings: no super on it">·</span>') + '</td><td class="num">' + (l.hours ? fmtH(l.hours) : '') + '</td><td class="num">' + (l.rate ? money(l.rate) : '') + '</td><td class="num">' + money(l.amount) + '</td></tr>'; }).join('') +
      '</tbody><tfoot><tr><td><b>Gross</b></td><td></td><td></td><td class="num"><b>' + money(c.gross) + '</b></td></tr><tr><td>PAYG withheld (scale ' + c.scale + ')</td><td></td><td></td><td class="num">-' + money(c.tax) + '</td></tr>' +
      (c.stsl ? '<tr><td>HELP / STSL</td><td></td><td></td><td class="num">-' + money(c.stsl) + '</td></tr>' : '') +
      '<tr><td><b>Net pay</b></td><td></td><td></td><td class="num"><b>' + money(c.net) + '</b></td></tr><tr><td class="muted">Super (' + P.S.superRate + '% of ' + money(c.ote) + ' ordinary time earnings)</td><td></td><td></td><td class="num muted">' + money(c.super) + '</td></tr>' +
      '<tr><td class="muted">Leave after this pay (hours): annual ' + fmtH(c.balances.annual) + ' · personal ' + fmtH(c.balances.personal) + ' · RDO ' + fmtH(c.balances.rdo) + '</td><td></td><td></td><td></td></tr></tfoot></table></div>';
  }

  /* ---------- pay runs ---------- */
  function runsTab(B) {
    if (P.runId) { var id = P.runId; P.runId = null; return runView(B, id); }
    return api('prlRuns').then(function (d) {
      var nextMon = mondayOf(addDays(todayS(), -7));
      B.innerHTML = '<div class="card"><div class="card-h"><h2>Pay runs</h2><span class="muted">' + esc(d.settings.frequency === 'fortnightly' ? 'Fortnightly' : 'Weekly') + ' pay</span></div>' +
        '<div class="row prl-new"><label>Period starting (Monday)<input type="date" id="runFrom" value="' + nextMon + '"></label><label>Pay date<input type="date" id="runPay" value="' + addDays(nextMon, d.settings.frequency === 'fortnightly' ? 17 : 10) + '"></label><button class="btn btn-gold" id="runNew">＋ Draft a pay run</button></div>' +
        '<p class="muted" style="font-size:12.5px">The pay run takes every employee\'s <b>approved</b> timesheets for the period. Check it, open the payslips, then <b>Finalise</b> (leave balances update and the weeks lock) and <b>Export</b> the CSV for the payroll service, which lodges Single Touch Payroll and pays the super.</p>' +
        (d.runs.length ? '<div class="table-wrap"><table class="prl-tbl"><thead><tr><th>Pay run</th><th>Period</th><th>Pay date</th><th class="num">People</th><th class="num">Gross</th><th class="num">Tax</th><th class="num">Net</th><th class="num">Super</th><th>Status</th><th></th></tr></thead><tbody>' +
          d.runs.map(function (r) { return '<tr><td><b>' + esc(r.id) + '</b></td><td>' + esc(nice(r.from)) + ' – ' + esc(nice(r.to)) + '</td><td>' + esc(nice(r.payDate)) + '</td><td class="num">' + r.people + '</td><td class="num">' + money(r.gross) + '</td><td class="num">' + money(r.tax) + '</td><td class="num">' + money(r.net) + '</td><td class="num">' + money(r.super) + '</td><td>' + (r.status === 'final' ? '<span class="chip prl-paid">Final</span>' : '<span class="chip">Draft</span>') + '</td><td><a class="btn btn-sm" href="#payroll/runs/' + esc(r.id) + '">Open</a></td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="empty">No pay runs yet.</div>') + '</div>';
      $('#runNew').onclick = function () {
        var b = this; b.disabled = true;
        api('prlRunCreate', { from: $('#runFrom').value, payDate: $('#runPay').value }).then(function (r) { toast(r.run.id + ' drafted'); location.hash = '#payroll/runs/' + r.run.id; }).catch(function (e) { b.disabled = false; fail(e); });
      };
    });
  }
  function runView(B, id) {
    return api('prlRunGet', { id: id }).then(function (d) {
      var r = d.run, draft = r.status === 'draft';
      B.innerHTML = '<div class="card"><div class="card-h"><h2>' + esc(r.id) + ' · ' + esc(nice(r.from)) + ' – ' + esc(nice(r.to)) + '</h2><span>' + (draft ? '<span class="chip">Draft</span>' : '<span class="chip prl-paid">Final</span>') + '</span></div>' +
        '<div class="grid kpis prl-kpis">' + [['Gross', r.totals.gross], ['Tax withheld', r.totals.tax], ['Net pay', r.totals.net], ['Super', r.totals.super]].map(function (k) { return '<div class="card kpi"><div class="k">' + k[0] + '</div><div class="v">' + money(k[1]) + '</div></div>'; }).join('') + '</div>' +
        (r.skipped && r.skipped.length ? '<p class="prl-bad">Not included: ' + r.skipped.map(esc).join(', ') + '</p>' : '') +
        (r.lines.length ? r.lines.map(function (l, i) {
          return '<details class="prl-person"' + (i === 0 ? ' open' : '') + '><summary><b>' + esc(l.name) + '</b> <span class="muted">' + esc(l.employment) + ' · ' + esc(l.classification) + '</span><span class="sp"></span>Gross ' + money(l.gross) + ' · Net <b>' + money(l.net) + '</b> <a class="btn btn-sm" href="' + pdfUrl(r.id, l.pid) + '" target="_blank" rel="noopener">📄 Payslip</a></summary>' + payTable(l) +
            (l.warnings && l.warnings.length ? '<p class="prl-bad">⚠ ' + l.warnings.map(esc).join(' · ') + '</p>' : '') + '</details>';
        }).join('') : '<div class="empty">Nobody to pay: no approved timesheets in this period.</div>') +
        '<div class="actions" style="margin-top:14px"><a class="btn" href="#payroll/runs">‹ All pay runs</a><button class="btn" id="runCsv">⬇ Export for the payroll service (CSV)</button>' +
        (draft ? '<button class="btn btn-danger" id="runDel">Delete draft</button><button class="btn btn-gold" id="runFin">✓ Finalise pay run</button>' : '') + '</div></div>';
      $('#runCsv').onclick = function () { api('prlRunCsv', { id: r.id }).then(function (x) { saveFile(x.csv, x.name); toast('CSV saved: import it into the payroll service'); }).catch(fail); };
      if (draft) {
        $('#runFin').onclick = function () { M.confirmBox('Finalise ' + r.id + '?', 'Leave balances update and these weeks\' timesheets lock. Then pay the net amounts, and lodge STP and pay super through the payroll service (export the CSV).', 'Finalise').then(function (ok) { if (ok) api('prlRunFinalise', { id: r.id }).then(function () { toast(r.id + ' finalised'); runView(B, r.id); }).catch(fail); }); };
        $('#runDel').onclick = function () { M.confirmBox('Delete draft ' + r.id + '?', 'Timesheets are kept; you can draft it again.', 'Delete', true).then(function (ok) { if (ok) api('prlRunDelete', { id: r.id }).then(function () { toast('Draft deleted'); location.hash = '#payroll/runs'; }).catch(fail); }); };
      }
    });
  }

  /* ---------- pay profiles ---------- */
  function peopleTab(B) {
    return api('prlPeople').then(function (d) {
      var S = d.settings;
      B.innerHTML = '<div class="card"><div class="card-h"><h2>Pay profiles</h2><span class="muted">Employees in People. Tax file numbers and bank details stay in the payroll service.</span></div>' +
        (d.people.length ? '<div class="table-wrap"><table class="prl-tbl"><thead><tr><th>Employee</th><th>Employment</th><th>Classification</th><th>Tool allowance</th><th class="num">Hourly rate</th><th>Tax</th><th class="num">Annual</th><th class="num">Personal</th><th class="num">RDO</th><th></th></tr></thead><tbody>' +
          d.people.map(function (p) {
            var tool = (S.tools.filter(function (t) { return t.key === p.tool; })[0] || { name: '' }).name;
            return '<tr><td><b>' + esc(p.name) + '</b> <span class="muted">' + esc(p.pid) + '</span></td><td>' + esc(p.employment) + '</td><td>' + esc(p.classification) + '</td><td class="muted">' + esc(p.tool ? tool.split(',')[0] : '–') + '</td><td class="num">' + money(p.rate) + (p.above ? ' <span class="chip">above award</span>' : '') + '</td>' +
              '<td>' + (p.noTfn ? 'No TFN' : (p.residency === 'foreign' ? 'Foreign resident' : p.tft ? 'Tax-free threshold' : 'No tax-free threshold')) + (p.stsl ? ' · HELP' : '') + '</td><td class="num">' + fmtH(p.balances.annual) + '</td><td class="num">' + fmtH(p.balances.personal) + '</td><td class="num">' + fmtH(p.balances.rdo) + '</td><td><button class="btn btn-sm" data-pp="' + esc(p.pid) + '">Edit</button></td></tr>';
          }).join('') + '</tbody></table></div>' : '<div class="empty">No active employees.</div>') + '</div>';
      B.querySelectorAll('[data-pp]').forEach(function (b) { b.onclick = function () { profileDialog(d.people.filter(function (x) { return x.pid === b.getAttribute('data-pp'); })[0], S); }; });
    });
  }
  function profileDialog(p, S) {
    var opt = function (list, val) { return list.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === val ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join(''); };
    M.modal('<h2>Pay profile: ' + esc(p.name) + '</h2><div class="prl-form">' +
      '<label>Employment<select id="ppEmp">' + opt(P.EMPLOY.map(function (e) { return [e, e]; }), p.employment) + '</select></label>' +
      '<label>Award classification<select id="ppCls">' + opt(S.classes.map(function (c) { return [c.key, c.name + ' · ' + money(c.weekly) + '/wk']; }), p.classification) + '</select></label>' +
      '<label>Tool allowance<select id="ppTool">' + opt(S.tools.map(function (t) { return [t.key, t.name + (t.weekly ? ' · ' + money(t.weekly) + '/wk' : '')]; }), p.tool) + '</select></label>' +
      '<label>Agreed hourly rate (if above the award)<input id="ppRate" type="number" step="0.01" min="0" value="' + (p.hourly || '') + '" placeholder="Award: ' + money(p.award) + '"></label>' +
      '<label>Residency for tax<select id="ppRes">' + opt([['resident', 'Australian resident'], ['foreign', 'Foreign resident']], p.residency) + '</select></label>' +
      '<label class="prl-chk"><input type="checkbox" id="ppTft"' + (p.tft ? ' checked' : '') + '> Claims the tax-free threshold</label>' +
      '<label class="prl-chk"><input type="checkbox" id="ppStsl"' + (p.stsl ? ' checked' : '') + '> Has a HELP / study loan</label>' +
      '<label class="prl-chk"><input type="checkbox" id="ppNoTfn"' + (p.noTfn ? ' checked' : '') + '> No TFN given (withhold 47%)</label>' +
      '<label>Medicare levy exemption<select id="ppMed">' + opt([['none', 'None'], ['half', 'Half'], ['full', 'Full']], p.medicare) + '</select></label>' +
      '<fieldset><legend>Leave balances (hours)</legend><label>Annual<input id="ppA" type="number" step="0.01" value="' + p.balances.annual + '"></label><label>Personal<input id="ppP" type="number" step="0.01" value="' + p.balances.personal + '"></label><label>RDO<input id="ppR" type="number" step="0.01" value="' + p.balances.rdo + '"></label></fieldset>' +
      '<label class="prl-chk"><input type="checkbox" id="ppAct"' + (p.active ? ' checked' : '') + '> Include in pay runs</label></div>' +
      '<div class="actions" style="justify-content:flex-end"><button class="btn" data-close type="button">Cancel</button><button class="btn btn-gold" id="ppSave" type="button">Save</button></div>');
    $('#ppSave').onclick = function () {
      api('prlProfileSave', { profile: { pid: p.pid, employment: $('#ppEmp').value, classification: $('#ppCls').value, tool: $('#ppTool').value, hourly: Number($('#ppRate').value) || 0, residency: $('#ppRes').value, tft: $('#ppTft').checked, stsl: $('#ppStsl').checked, noTfn: $('#ppNoTfn').checked, medicare: $('#ppMed').value,
        balances: { annual: $('#ppA').value, personal: $('#ppP').value, rdo: $('#ppR').value }, active: $('#ppAct').checked } }).then(function () { M.closeModal(); toast('Pay profile saved'); draw(); }).catch(fail);
    };
  }

  /* ---------- labour cost by job ---------- */
  function jobsTab(B) {
    var t = todayS(), from = P.jcFrom || t.slice(0, 8) + '01', to = P.jcTo || t;
    B.innerHTML = '<div class="card"><div class="card-h"><h2>Labour cost by job</h2><span class="muted">From approved and paid timesheets: wages (with penalty rates and allowances) + super + on-costs (' + P.S.onCost + '%)</span></div>' +
      '<div class="row prl-new"><label>From<input type="date" id="jcFrom" value="' + from + '"></label><label>To<input type="date" id="jcTo" value="' + to + '"></label><button class="btn" id="jcGo">Show</button></div><div id="jcOut"><div class="empty">Loading…</div></div></div>';
    var go = function () {
      P.jcFrom = $('#jcFrom').value; P.jcTo = $('#jcTo').value;
      api('prlJobCosts', { from: P.jcFrom, to: P.jcTo }).then(function (d) {
        var T = d.jobs.reduce(function (s, j) { s.h += j.hours; s.t += j.total; return s; }, { h: 0, t: 0 });
        $('#jcOut').innerHTML = d.jobs.length ? '<div class="table-wrap"><table class="prl-tbl"><thead><tr><th>Job</th><th class="num">Hours</th><th class="num">Wages</th><th class="num">Super</th><th class="num">On-costs</th><th class="num">Labour cost</th><th>People</th></tr></thead><tbody>' +
          d.jobs.map(function (j) { return '<tr><td><b>' + esc(j.job) + '</b></td><td class="num">' + fmtH(j.hours) + '</td><td class="num">' + money(j.wages) + '</td><td class="num">' + money(j.super) + '</td><td class="num">' + money(j.oncost) + '</td><td class="num"><b>' + money(j.total) + '</b></td><td class="muted">' + esc(j.people.join(', ')) + '</td></tr>'; }).join('') +
          '</tbody><tfoot><tr><td><b>Total</b></td><td class="num"><b>' + fmtH(T.h) + '</b></td><td></td><td></td><td></td><td class="num"><b>' + money(T.t) + '</b></td><td></td></tr></tfoot></table></div>' : '<div class="empty">No approved hours in these dates.</div>';
      }).catch(fail);
    };
    $('#jcGo').onclick = go; go();
  }

  /* ---------- contractors: TPAR ---------- */
  function tparTab(B) {
    var t = todayS(), y = Number(t.slice(0, 4)) - (Number(t.slice(5, 7)) >= 7 ? 0 : 1);
    var fy = P.fy || (y - 1);
    B.innerHTML = '<div class="card"><div class="card-h"><h2>Contractors: Taxable Payments Annual Report</h2><span class="muted">Building and construction businesses report payments to contractors each financial year</span></div>' +
      '<div class="row prl-new"><label>Financial year<select id="fySel">' + [y, y - 1, y - 2].map(function (v) { return '<option value="' + v + '"' + (v === fy ? ' selected' : '') + '>' + v + '-' + String(v + 1).slice(2) + '</option>'; }).join('') + '</select></label></div><div id="tpOut"><div class="empty">Loading…</div></div></div>';
    var go = function () {
      P.fy = Number($('#fySel').value);
      api('prlTpar', { fy: P.fy }).then(function (d) {
        $('#tpOut').innerHTML = '<p class="muted" style="font-size:12.5px">From expenses (Accounts) between ' + esc(d.from) + ' and ' + esc(d.to) + ' paid to your Subbies and People contractors, or filed under Subcontractors. Due to the ATO by <b>' + esc(nice(d.due)) + '</b>. Lodge it through ATO online services or your BAS agent.</p>' +
          (d.missingAbn ? '<p class="prl-bad">⚠ ' + d.missingAbn + ' payee' + (d.missingAbn === 1 ? ' has' : 's have') + ' no ABN on file: add it in Subbies or People before lodging.</p>' : '') +
          (d.rows.length ? '<div class="table-wrap"><table class="prl-tbl"><thead><tr><th>Payee</th><th>ABN</th><th>Type</th><th class="num">Payments</th><th class="num">Gross paid (incl. GST)</th><th class="num">GST</th></tr></thead><tbody>' +
            d.rows.map(function (r) { return '<tr><td><b>' + esc(r.name) + '</b></td><td>' + (r.abn ? esc(r.abn) : '<span class="prl-bad">missing</span>') + '</td><td class="muted">' + esc(r.kind) + '</td><td class="num">' + r.payments + '</td><td class="num">' + money(r.gross) + '</td><td class="num">' + money(r.gst) + '</td></tr>'; }).join('') +
            '</tbody><tfoot><tr><td><b>Total</b></td><td></td><td></td><td></td><td class="num"><b>' + money(d.total) + '</b></td><td></td></tr></tfoot></table></div><div class="actions" style="margin-top:10px"><button class="btn" id="tpCsv">⬇ Export CSV</button></div>' : '<div class="empty">No contractor payments in this year.</div>');
        if ($('#tpCsv')) $('#tpCsv').onclick = function () {
          var cell = function (x) { x = String(x == null ? '' : x); return /[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; };
          saveFile('﻿' + [['Payee', 'ABN', 'Type', 'Payments', 'Gross paid (incl. GST)', 'GST']].concat(d.rows.map(function (r) { return [r.name, r.abn, r.kind, r.payments, r.gross.toFixed(2), r.gst.toFixed(2)]; })).map(function (r) { return r.map(cell).join(','); }).join('\r\n') + '\r\n', 'MBS-TPAR-' + d.fy + '.csv');
        };
      }).catch(fail);
    };
    $('#fySel').onchange = go; go();
  }

  /* ---------- rates & rules ---------- */
  function ratesTab(B) {
    var S = P.S, num = function (id, v, step) { return '<input type="number" step="' + (step || '0.01') + '" id="' + id + '" value="' + v + '" style="width:110px">'; };
    B.innerHTML = '<div class="card"><div class="card-h"><h2>Rates &amp; rules (' + esc(S.year) + ')</h2></div>' +
      '<p class="muted" style="font-size:12.5px">Building and Construction General On-site Award 2020 (MA000020). The hourly rate is (weekly rate + industry allowance + tool allowance) ÷ 38. Overtime Monday to Friday after 8 hours (RDO system) or 7.6 hours: 150% for 2 hours then 200%. Saturday 150% for 2 hours then 200%; Sunday 200%; public holidays 250%. Casuals: 25% loading; 175% / 225% / 275%. Annual leave 4 weeks with 17.5% loading; personal leave 10 days. PAYG and HELP from the ATO 2026-27 formulas (Schedules 1 and 8).</p>' +
      '<div class="prl-rates"><div><h3 class="prl-h3">Minimum weekly rates</h3><table class="prl-tbl">' + S.classes.map(function (c) { return '<tr><td>' + esc(c.name) + '</td><td>' + num('cl_' + c.key, c.weekly) + '</td><td class="muted">' + money((c.weekly + S.industry) / 38) + '/h</td></tr>'; }).join('') + '</table></div>' +
      '<div><h3 class="prl-h3">Allowances</h3><table class="prl-tbl"><tr><td>Industry allowance (weekly, all-purpose)</td><td>' + num('s_industry', S.industry) + '</td></tr>' +
      S.tools.filter(function (t) { return t.key; }).map(function (t) { return '<tr><td>Tool: ' + esc(t.name) + '</td><td>' + num('tl_' + t.key, t.weekly) + '</td></tr>'; }).join('') +
      '<tr><td>Fares and travel (per day on site)</td><td>' + num('s_fares', S.fares) + '</td></tr><tr><td>Meal allowance (overtime 1.5 h or more)</td><td>' + num('s_meal', S.meal) + '</td></tr></table>' +
      '<h3 class="prl-h3">Rules</h3><table class="prl-tbl"><tr><td>Super guarantee (%)</td><td>' + num('s_super', S.superRate) + '</td></tr><tr><td>Annual leave loading (%)</td><td>' + num('s_loading', S.loading) + '</td></tr><tr><td>On-costs for job costing (%: workers comp, payroll tax…)</td><td>' + num('s_oncost', S.onCost) + '</td></tr>' +
      '<tr><td>Pay frequency</td><td><select id="s_freq"><option value="weekly"' + (S.frequency === 'weekly' ? ' selected' : '') + '>Weekly</option><option value="fortnightly"' + (S.frequency === 'fortnightly' ? ' selected' : '') + '>Fortnightly</option></select></td></tr>' +
      '<tr><td>RDO system (8-hour days: 7.6 paid + 0.4 banked)</td><td><input type="checkbox" id="s_rdo"' + (S.rdo ? ' checked' : '') + '></td></tr></table></div></div>' +
      '<h3 class="prl-h3">Public holidays (NSW)</h3><textarea id="s_hol" rows="3" style="width:100%">' + esc(S.holidays.join(', ')) + '</textarea>' +
      '<label class="prl-chk prl-check"><input type="checkbox" id="s_checked"' + (S.checked ? ' checked' : '') + '> <b>Checked</b> against the Fair Work pay guide and the ATO tax tables' + (S.checkedBy ? ' <span class="muted">(by ' + esc(S.checkedBy) + ')</span>' : '') + '</label>' +
      '<div class="actions"><button class="btn btn-gold" id="s_save">Save rates &amp; rules</button></div></div>';
    $('#s_save').onclick = function () {
      var v = function (id) { return Number($('#' + id).value); };
      api('prlSettingsSave', { settings: { year: S.year, checked: $('#s_checked').checked, frequency: $('#s_freq').value, rdo: $('#s_rdo').checked,
        classes: S.classes.map(function (c) { return { key: c.key, weekly: v('cl_' + c.key) }; }), industry: v('s_industry'),
        tools: S.tools.map(function (t) { return { key: t.key, weekly: t.key ? v('tl_' + t.key) : 0 }; }), fares: v('s_fares'), meal: v('s_meal'), superRate: v('s_super'), loading: v('s_loading'), onCost: v('s_oncost'), holidays: $('#s_hol').value } })
        .then(function () { toast('Rates & rules saved'); page(['rates']); }).catch(fail);
    };
  }

  M.addView('payroll', 'Payroll', page, 'payroll');
})();
