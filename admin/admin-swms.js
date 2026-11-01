/* MBS Console v57: 🦺 Safe Work Method Statement (SWMS) editor. Opens at #swms/<job>, like a quote: every part can be
   changed, it saves as you type, and downloads as Word (.docx) or PDF, or prints. The SWMS is written by the AI from the
   project plan (Project plan > SWMS tab, or ask Project Intelligence "generate a SWMS for this project"). */
(function () {
  'use strict';
  var M = window.MBS; if (!M) return;
  var api = M.api, esc = M.esc, toast = M.toast, fail = M.fail, $ = M.$;
  var V = function () { return M.view(); };
  var S = { core: '', doc: null, hrcw: [], job: null, plan: null, timer: null, saving: false };
  var RISK = ['Low', 'Medium', 'High', 'Extreme'], RC = { Low: '#DCFCE7', Medium: '#FEF3C7', High: '#FED7AA', Extreme: '#FECACA' };
  var dmy = function (s) { return s ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : ''; };
  function load(src, test) { return test() ? Promise.resolve() : new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = function () { rej(new Error('Could not load ' + src)); }; document.head.appendChild(s); }); }
  function rid() { return Array.from(crypto.getRandomValues(new Uint8Array(10))).map(function (b) { return b.toString(16).padStart(2, '0'); }).join(''); }

  /* ---------- write the SWMS with the AI (background function, the page asks until it is ready) ---------- */
  function generate(core, onMsg) {
    var id = rid(), t0 = Date.now();
    var poll = function () {
      if (Date.now() - t0 > 540000) throw new Error('The AI is taking too long. Try again.');
      return new Promise(function (r) { setTimeout(r, 2500); }).then(function () { return api('planAiStatus', { id: id }); }).then(function (d) {
        if (d.status === 'done') return d; if (d.status === 'error') throw new Error(d.error || 'The SWMS could not be written'); return poll(); });
    };
    if (onMsg) onMsg('The AI is writing the SWMS from the project plan… usually 1 to 3 minutes.');
    return fetch('/.netlify/functions/planai-background', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-MBS-Admin': '1' }, body: JSON.stringify({ mode: 'swms', id: id, core: core }) })
      .then(function (r) { if (r.status >= 400) throw new Error('Could not start the AI (' + r.status + ')'); return poll(); });
  }

  /* ---------- the editor page ---------- */
  function swmsPage(args) {
    S.core = args[0] || '';
    return api('swmsGet', { core: S.core }).then(function (d) {
      S.doc = d.swms; S.hrcw = d.hrcw; S.job = d.job; S.plan = d.plan; S.core = d.job.core;
      document.querySelectorAll('[data-nav]').forEach(function (n) { n.classList.toggle('on', n.getAttribute('data-nav') === 'projects'); });
      draw();
    });
  }
  function head() {
    var d = S.doc;
    return '<div class="row sw-top"><a class="btn btn-sm" href="#plan/' + esc(S.core) + '/swms">← Project plan</a><h2>🦺 SWMS: ' + esc(S.plan ? S.plan.name : S.job.ref) + '</h2>' +
      (d ? '<span class="sw-ver">Version ' + d.version + '</span><select id="swStatus" class="sw-status sw-' + d.status.toLowerCase() + '"><option' + (d.status === 'Draft' ? ' selected' : '') + '>Draft</option><option' + (d.status === 'Issued' ? ' selected' : '') + '>Issued</option></select><span class="muted" id="swSaved">Saved ✓</span>' : '') +
      '<span class="sp"></span>' + (d ? '<button class="btn btn-sm" id="swRegen">✨ Write again from the plan</button><button class="btn btn-sm btn-gold" data-swdl="docx">⬇ Word</button><button class="btn btn-sm btn-gold" data-swdl="pdf">⬇ PDF</button><button class="btn btn-sm" id="swPrint">🖨 Print</button>' : '') + '</div>';
  }
  function draw() {
    var d = S.doc;
    $('#title').textContent = 'SWMS';
    if (!d) {
      V().innerHTML = head() + '<div class="card sw-empty"><h2>No SWMS for this job yet</h2><p class="muted">The AI writes it from the project plan: the high-risk construction work involved, every job step with its hazards, risk and control measures, PPE, plant, licences, emergency arrangements and a sign-on sheet. You can then change anything before you download it.</p>' +
        (S.plan ? '<button class="btn btn-gold" id="swGen">✨ Write the SWMS from the project plan</button><p class="muted" id="swMsg" style="margin-top:10px"></p>' : '<p class="bad">This job has no project plan yet. <a href="#plan/' + esc(S.core) + '">Make the plan first</a>.</p>') + '</div>';
      var g = $('#swGen'); if (g) g.onclick = function () { g.disabled = true; generate(S.core, function (m) { $('#swMsg').innerHTML = '<span class="ask-think">' + esc(m) + '</span>'; }).then(function (r) { toast('SWMS written (' + (r.tokens || 0) + ' tokens)'); return swmsPage([S.core]); }).catch(function (e) { g.disabled = false; $('#swMsg').innerHTML = '<span class="bad">' + esc(e.message) + '</span>'; }); };
      return;
    }
    var D = d.details, f = function (k, label, type, cls) { return '<label' + (cls ? ' class="' + cls + '"' : '') + '>' + label + '<input data-d="' + k + '"' + (type ? ' type="' + type + '"' : '') + ' value="' + esc(D[k] || '') + '"></label>'; };
    var ta = function (path, label, rows, ph) { var v = path.split('.').reduce(function (o, k) { return o ? o[k] : ''; }, d); return '<label class="full">' + label + '<textarea data-p="' + path + '" rows="' + (rows || 3) + '" placeholder="' + esc(ph || '') + '">' + esc(Array.isArray(v) ? v.join('\n') : v || '') + '</textarea></label>'; };
    var rsel = function (k, v) { return '<select data-s="' + k + '" class="sw-risk" style="background:' + RC[v] + '">' + RISK.map(function (r) { return '<option' + (r === v ? ' selected' : '') + '>' + r + '</option>'; }).join('') + '</select>'; };
    V().innerHTML = head() + '<div class="sw-paper">' +
      '<div class="sw-title"><b>SAFE WORK METHOD STATEMENT</b><span>High-risk construction work · Work Health and Safety Regulation 2017 (NSW), Part 6.3</span></div>' +
      (d.edited ? '' : '<p class="sw-note">✨ Written by the AI from the project plan on ' + new Date(d.generated).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Sydney' }) + '. Check every part against the site and the work before using it: change anything below.</p>') +
      '<h3>1. Business and project</h3><div class="form sw-grid">' + f('business', 'Business (PCBU)') + f('abn', 'ABN') + f('licence', 'Contractor licence') + f('principal', 'Principal contractor') +
        f('site', 'Site address', '', 'sw-w2') + f('job', 'Job number') + f('project', 'Project') + '<label class="full">Work activity<textarea data-d="work" rows="2">' + esc(D.work) + '</textarea></label>' +
        f('start', 'Start', 'date') + f('finish', 'Finish', 'date') + f('supervisor', 'Site supervisor') + f('supervisorPhone', 'Supervisor phone', 'tel') + f('preparedBy', 'Prepared by') + f('preparedOn', 'Prepared on', 'date') + f('review', 'Review by', 'date') + '</div>' +
      '<h3>2. High-risk construction work in this job</h3><div class="sw-hrcw">' + S.hrcw.map(function (h) { return '<label class="sc-cb"><input type="checkbox" data-h="' + h[0] + '"' + (d.hrcw.indexOf(h[0]) >= 0 ? ' checked' : '') + '> ' + esc(h[1]) + '</label>'; }).join('') + '</div>' +
        '<label class="full sw-lab">Why these apply<textarea data-p="hrcwNotes" rows="2">' + esc(d.hrcwNotes) + '</textarea></label>' +
      '<h3>3. Job steps, hazards and controls</h3><p class="muted sw-help">Risk: <span class="sw-chip" style="background:' + RC.Low + '">Low</span> <span class="sw-chip" style="background:' + RC.Medium + '">Medium</span> <span class="sw-chip" style="background:' + RC.High + '">High</span> <span class="sw-chip" style="background:' + RC.Extreme + '">Extreme</span> · controls follow the hierarchy: eliminate, substitute, isolate, engineering, administrative, PPE.</p>' +
        '<div class="table-wrap"><table class="sw-steps"><thead><tr><th>#</th><th>Job step</th><th>Hazards</th><th>Risk</th><th>Control measures</th><th>Risk after</th><th>Who</th><th></th></tr></thead><tbody>' +
        d.steps.map(function (s, i) { return '<tr data-i="' + i + '"><td class="muted">' + (i + 1) + '</td><td><textarea data-s="step" rows="3">' + esc(s.step) + '</textarea></td><td><textarea data-s="hazards" rows="3">' + esc(s.hazards) + '</textarea></td><td>' + rsel('risk', s.risk) + '</td>' +
          '<td><textarea data-s="controls" rows="4" class="sw-ctl">' + esc(s.controls) + '</textarea></td><td>' + rsel('residual', s.residual) + '</td><td><textarea data-s="who" rows="2">' + esc(s.who) + '</textarea></td>' +
          '<td class="sw-acts"><button class="btn btn-sm" data-mv="-1" title="Move up"' + (i ? '' : ' disabled') + '>↑</button><button class="btn btn-sm" data-mv="1" title="Move down"' + (i < d.steps.length - 1 ? '' : ' disabled') + '>↓</button><button class="btn btn-sm" data-del title="Delete">✕</button></td></tr>'; }).join('') +
        '</tbody></table></div><button class="btn btn-sm" id="swAddStep">＋ Add a step</button>' +
      '<h3>4. PPE, plant and equipment, licences and training</h3><div class="form sw-grid3">' + ta('ppe', 'Personal protective equipment (one per line)', 6) + ta('plant', 'Plant and equipment, with pre-start checks', 6) + ta('quals', 'Licences, tickets and training', 6) + '</div>' +
      '<h3>5. Emergency arrangements</h3><div class="form">' + ta('emergency.firstAid', 'First aid', 2) + ta('emergency.assembly', 'Assembly point', 2) + ta('emergency.hospital', 'Nearest hospital emergency department', 2) + ta('emergency.contacts', 'Emergency contacts', 3) + ta('emergency.plan', 'Emergency procedure', 4) + '</div>' +
      '<h3>6. Putting it in place, monitoring and review</h3><div class="form">' + ta('monitor', 'How the controls are put in place, checked and reviewed (and when the SWMS is reviewed)', 4) + ta('consultation', 'Consultation with workers', 3) + '</div>' +
      '<h3>7. Sign-on: workers who have read and understood this SWMS</h3><div class="table-wrap"><table class="sw-sign"><thead><tr><th>#</th><th>Name</th><th>Company</th><th>Date</th><th>Signature</th><th></th></tr></thead><tbody>' +
        d.signon.map(function (s, i) { return '<tr data-g="' + i + '"><td class="muted">' + (i + 1) + '</td><td><input data-g="name" value="' + esc(s.name) + '"></td><td><input data-g="company" value="' + esc(s.company) + '"></td><td><input type="date" data-g="date" value="' + esc(s.date) + '"></td><td class="sw-sigcell"></td><td><button class="btn btn-sm" data-gdel>✕</button></td></tr>'; }).join('') +
        '</tbody></table></div><button class="btn btn-sm" id="swAddSign">＋ Add a row</button>' +
      '<p class="muted sw-foot">Keep this SWMS on site and make it available to workers. Stop work and review it if the work, the site or the risks change, or after an incident. General guidance only: check it against the WHS Regulation, SafeWork NSW codes of practice and the actual site.</p></div>';
    wire();
  }
  function save(now) {
    clearTimeout(S.timer); var el = $('#swSaved'); if (el) el.textContent = 'Saving…';
    var go = function () { S.saving = true; return api('swmsSave', { core: S.core, swms: S.doc, status: S.doc.status }).then(function (r) { S.doc.updated = r.swms.updated; S.doc.edited = true; var e = $('#swSaved'); if (e) e.textContent = 'Saved ✓'; }).catch(fail).then(function () { S.saving = false; }); };
    if (now) return go(); S.timer = setTimeout(go, 700); return Promise.resolve();
  }
  function wire() {
    var d = S.doc, B = V();
    B.querySelectorAll('[data-d]').forEach(function (el) { el.addEventListener('input', function () { d.details[el.getAttribute('data-d')] = el.value; save(); }); });
    B.querySelectorAll('[data-p]').forEach(function (el) { el.addEventListener('input', function () {
      var path = el.getAttribute('data-p').split('.'), o = d; for (var i = 0; i < path.length - 1; i++) o = o[path[i]];
      o[path[path.length - 1]] = /^(ppe|plant|quals)$/.test(path[0]) ? el.value.split('\n') : el.value; save(); }); });
    B.querySelectorAll('[data-h]').forEach(function (el) { el.onchange = function () { var k = el.getAttribute('data-h'); d.hrcw = d.hrcw.filter(function (x) { return x !== k; }); if (el.checked) d.hrcw.push(k); save(); }; });
    B.querySelectorAll('tr[data-i]').forEach(function (tr) {
      var i = +tr.getAttribute('data-i'), s = d.steps[i];
      tr.querySelectorAll('[data-s]').forEach(function (el) { el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', function () { s[el.getAttribute('data-s')] = el.value; if (el.tagName === 'SELECT') el.style.background = RC[el.value]; save(); }); });
      tr.querySelectorAll('[data-mv]').forEach(function (b) { b.onclick = function () { var j = i + Number(b.getAttribute('data-mv')); d.steps.splice(j, 0, d.steps.splice(i, 1)[0]); save(); draw(); }; });
      tr.querySelector('[data-del]').onclick = function () { d.steps.splice(i, 1); save(); draw(); };
    });
    B.querySelectorAll('tr[data-g]').forEach(function (tr) {
      var i = +tr.getAttribute('data-g');
      tr.querySelectorAll('input[data-g]').forEach(function (el) { el.addEventListener('input', function () { d.signon[i][el.getAttribute('data-g')] = el.value; save(); }); });
      tr.querySelector('[data-gdel]').onclick = function () { d.signon.splice(i, 1); save(); draw(); };
    });
    var q = function (s) { return B.querySelector(s); };
    if (q('#swAddStep')) q('#swAddStep').onclick = function () { d.steps.push({ step: '', hazards: '', risk: 'Medium', controls: '- ', residual: 'Low', who: '' }); save(); draw(); var t = B.querySelectorAll('textarea[data-s=step]'); if (t.length) t[t.length - 1].focus(); };
    if (q('#swAddSign')) q('#swAddSign').onclick = function () { d.signon.push({ name: '', company: '', date: '' }); save(); draw(); };
    if (q('#swStatus')) q('#swStatus').onchange = function () { d.status = this.value; save(true).then(draw); toast(d.status === 'Issued' ? 'SWMS marked Issued' : 'SWMS back to Draft'); };
    if (q('#swRegen')) q('#swRegen').onclick = function () {
      M.confirmBox('Write the SWMS again?', 'The AI writes a new version from the project plan as it is now. Your changes to this version are replaced.', 'Write again').then(function (y) {
        if (!y) return; var b = $('#swRegen'); b.disabled = true; b.textContent = 'Writing…';
        generate(S.core, function (m) { toast(m); }).then(function () { toast('New version written'); return swmsPage([S.core]); }).catch(function (e) { toast(e.message, true); b.disabled = false; b.textContent = '✨ Write again from the plan'; });
      });
    };
    B.querySelectorAll('[data-swdl]').forEach(function (b) { b.onclick = function () { (S.timer ? save(true) : Promise.resolve()).then(function () { return download(S.doc, S.hrcw, b.getAttribute('data-swdl')); }).catch(fail); }; });
    if (q('#swPrint')) q('#swPrint').onclick = function () { printDoc(S.doc, S.hrcw); };
  }

  /* ---------- downloads ---------- */
  var fname = function (d, ext) { return 'SWMS-' + (d.details.job || 'job') + '-v' + d.version + '.' + ext; };
  var hrcwRows = function (d, H, ascii) { return H.map(function (h) { var on = d.hrcw.indexOf(h[0]) >= 0; return [(ascii ? (on ? '[X] ' : '[  ] ') : (on ? '☒ ' : '☐ ')) + h[1]]; }); };
  var detailRows = function (D) { return [['Business (PCBU)', D.business, 'ABN', D.abn], ['Contractor licence', D.licence, 'Principal contractor', D.principal], ['Site address', D.site, 'Job number', D.job], ['Project', D.project, 'Dates', dmy(D.start) + ' to ' + dmy(D.finish)],
    ['Site supervisor', D.supervisor + (D.supervisorPhone ? ' · ' + D.supervisorPhone : ''), 'Prepared by', D.preparedBy + (D.preparedOn ? ' on ' + dmy(D.preparedOn) : '')], ['Work activity', D.work, 'Review by', dmy(D.review)]]; };
  function save2(blob, name) { var url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 5000); }
  function download(d, H, fmt) {
    if (fmt === 'pdf') return load('vendor/jspdf.umd.min.js?v=252', function () { return !!window.jspdf; }).then(function () { return load('vendor/jspdf.plugin.autotable.min.js?v=384', function () { return !!(window.jspdf && window.jspdf.jsPDF.API.autoTable); }); }).then(function () { pdf(d, H); });
    return load('vendor/docx.iife.js?v=951', function () { return !!window.docx; }).then(function () { return word(d, H); });
  }
  function pdf(d, H) {
    var doc = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' }), W = 297, y = 14, D = d.details;
    var gold = [201, 162, 39], dark = [31, 41, 55];
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor.apply(doc, dark); doc.text('SAFE WORK METHOD STATEMENT', 12, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(110); doc.text('High-risk construction work · Work Health and Safety Regulation 2017 (NSW), Part 6.3 · Version ' + d.version + ' · ' + d.status, 12, y + 5);
    doc.text(D.business || '', W - 12, y, { align: 'right' });
    var T = function (head, body, opt) { doc.autoTable(Object.assign({ startY: y, head: head ? [head] : undefined, body: body, theme: 'grid', margin: { left: 12, right: 12 }, styles: { fontSize: 8, cellPadding: 1.6, overflow: 'linebreak', valign: 'top' }, headStyles: { fillColor: dark, textColor: 255 } }, opt || {})); y = doc.lastAutoTable.finalY + 6; };
    var H2 = function (t) { if (y > 185) { doc.addPage(); y = 14; } doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor.apply(doc, dark); doc.text(t, 12, y); doc.setDrawColor.apply(doc, gold); doc.line(12, y + 1.2, W - 12, y + 1.2); y += 4; };
    y += 11; H2('1. Business and project');
    T(null, detailRows(D), { columnStyles: { 0: { fontStyle: 'bold', fillColor: [246, 243, 234], cellWidth: 38 }, 2: { fontStyle: 'bold', fillColor: [246, 243, 234], cellWidth: 34 } } });
    H2('2. High-risk construction work in this job');
    var hr = hrcwRows(d, H, true), half = Math.ceil(hr.length / 2);   // the PDF's built-in font has no box symbols
    T(null, hr.slice(0, half).map(function (r, i) { return [r[0], (hr[half + i] || [''])[0]]; }), { theme: 'plain', styles: { fontSize: 8, cellPadding: 0.8 } });
    if (d.hrcwNotes) { doc.setFontSize(8); doc.setTextColor(60); doc.text(doc.splitTextToSize(d.hrcwNotes, W - 24), 12, y - 3); y += 6; }
    H2('3. Job steps, hazards and controls');
    var rf = { Low: [220, 252, 231], Medium: [254, 243, 199], High: [254, 215, 170], Extreme: [254, 202, 202] };
    T(['#', 'Job step', 'Hazards', 'Risk', 'Control measures', 'Risk after', 'Who'], d.steps.map(function (s, i) { return [i + 1, s.step, s.hazards, s.risk, s.controls, s.residual, s.who]; }),
      { columnStyles: { 0: { cellWidth: 7 }, 1: { cellWidth: 38 }, 2: { cellWidth: 52 }, 3: { cellWidth: 16 }, 4: { cellWidth: 100 }, 5: { cellWidth: 16 }, 6: { cellWidth: 44 } },
        didParseCell: function (c) { if (c.section === 'body' && (c.column.index === 3 || c.column.index === 5) && rf[c.cell.raw]) { c.cell.styles.fillColor = rf[c.cell.raw]; c.cell.styles.fontStyle = 'bold'; } } });
    H2('4. PPE, plant and equipment, licences and training');
    var mx = Math.max(d.ppe.length, d.plant.length, d.quals.length);
    T(['PPE', 'Plant and equipment (pre-start checks)', 'Licences, tickets and training'], Array.from({ length: mx }, function (_, i) { return [d.ppe[i] || '', d.plant[i] || '', d.quals[i] || '']; }));
    H2('5. Emergency arrangements'); var E = d.emergency;
    T(null, [['First aid', E.firstAid], ['Assembly point', E.assembly], ['Nearest hospital', E.hospital], ['Emergency contacts', E.contacts], ['Emergency procedure', E.plan]], { columnStyles: { 0: { fontStyle: 'bold', fillColor: [246, 243, 234], cellWidth: 45 } } });
    H2('6. Putting it in place, monitoring and review');
    T(null, [['Implement, monitor, review', d.monitor], ['Consultation with workers', d.consultation]], { columnStyles: { 0: { fontStyle: 'bold', fillColor: [246, 243, 234], cellWidth: 45 } } });
    H2('7. Sign-on: workers who have read and understood this SWMS');
    T(['#', 'Name', 'Company', 'Date', 'Signature'], d.signon.map(function (s, i) { return [i + 1, s.name, s.company, dmy(s.date), '']; }), { columnStyles: { 0: { cellWidth: 8 }, 4: { cellWidth: 70 } }, bodyStyles: { minCellHeight: 9 } });
    var n = doc.getNumberOfPages();
    for (var i = 1; i <= n; i++) { doc.setPage(i); doc.setFontSize(7.5); doc.setTextColor(120); doc.text('SWMS · ' + (D.project || '') + ' · ' + (D.job || '') + ' · v' + d.version + ' ' + d.status, 12, 205); doc.text('Page ' + i + ' of ' + n, W - 12, 205, { align: 'right' }); }
    doc.save(fname(d, 'pdf'));
  }
  function word(d, H) {
    var X = window.docx, D = d.details, F = 'Arial';
    var R = function (t, o) { o = o || {}; return new X.TextRun({ text: String(t == null ? '' : t), font: F, size: o.size || 18, bold: o.bold, color: o.color }); };
    var P = function (t, o) { o = o || {}; return new X.Paragraph({ children: String(t == null ? '' : t).split('\n').map(function (ln, i) { return i ? [new X.TextRun({ break: 1, text: '', font: F }), R(ln, o)] : [R(ln, o)]; }).reduce(function (a, b) { return a.concat(b); }, []), spacing: { after: o.after == null ? 40 : o.after } }); };
    var H2 = function (t) { return new X.Paragraph({ children: [R(t, { bold: true, size: 22, color: '1F2937' })], spacing: { before: 200, after: 80 }, keepNext: true, border: { bottom: { style: X.BorderStyle.SINGLE, size: 6, color: 'C9A227', space: 2 } } }); };
    var bd = { style: X.BorderStyle.SINGLE, size: 4, color: 'BFB9A8' }, Wd = 15398;
    var C = function (t, w, o) { o = o || {}; return new X.TableCell({ width: { size: w, type: X.WidthType.DXA }, shading: o.fill ? { type: X.ShadingType.CLEAR, color: 'auto', fill: o.fill } : undefined, borders: { top: bd, bottom: bd, left: bd, right: bd }, margins: { top: 40, bottom: 40, left: 70, right: 70 }, children: [P(t, { bold: o.bold, color: o.color, after: 0, size: o.size || 17 })] }); };
    var TB = function (widths, rows, head) { return new X.Table({ width: { size: Wd, type: X.WidthType.DXA }, columnWidths: widths, rows: rows.map(function (r, i) { return new X.TableRow({ tableHeader: !!head && i === 0, children: r.map(function (c, j) { var o = typeof c === 'object' && c !== null && !Array.isArray(c) ? c : { t: c }; return C(o.t, widths[j], { bold: (head && i === 0) || o.bold, fill: head && i === 0 ? '1F2937' : o.fill, color: head && i === 0 ? 'FFFFFF' : undefined }); }) }); }) }); };
    var lab = function (t) { return { t: t, bold: true, fill: 'F6F3EA' }; };
    var RF = { Low: 'DCFCE7', Medium: 'FEF3C7', High: 'FED7AA', Extreme: 'FECACA' };
    var hr = hrcwRows(d, H), half = Math.ceil(hr.length / 2), E = d.emergency, mx = Math.max(d.ppe.length, d.plant.length, d.quals.length, 1);
    var body = [
      new X.Paragraph({ children: [R('SAFE WORK METHOD STATEMENT', { bold: true, size: 32, color: '1F2937' })], spacing: { after: 40 } }),
      P('High-risk construction work · Work Health and Safety Regulation 2017 (NSW), Part 6.3 · Version ' + d.version + ' · ' + d.status, { color: '6B675E', after: 120 }),
      H2('1. Business and project'),
      TB([2600, 5099, 2600, 5099], detailRows(D).map(function (r) { return [lab(r[0]), r[1], lab(r[2]), r[3]]; })),
      H2('2. High-risk construction work in this job'),
      TB([7699, 7699], hr.slice(0, half).map(function (r, i) { return [r[0], (hr[half + i] || [''])[0]]; })),
      P(d.hrcwNotes || '', { color: '444444' }),
      H2('3. Job steps, hazards and controls'),
      TB([500, 2400, 3000, 1000, 5498, 1000, 2000], [['#', 'Job step', 'Hazards', 'Risk', 'Control measures', 'Risk after', 'Who']].concat(d.steps.map(function (s, i) { return [String(i + 1), s.step, s.hazards, { t: s.risk, bold: true, fill: RF[s.risk] }, s.controls, { t: s.residual, bold: true, fill: RF[s.residual] }, s.who]; })), true),
      H2('4. PPE, plant and equipment, licences and training'),
      TB([5132, 5133, 5133], [['PPE', 'Plant and equipment (pre-start checks)', 'Licences, tickets and training']].concat(Array.from({ length: mx }, function (_, i) { return [d.ppe[i] || '', d.plant[i] || '', d.quals[i] || '']; })), true),
      H2('5. Emergency arrangements'),
      TB([3000, 12398], [[lab('First aid'), E.firstAid], [lab('Assembly point'), E.assembly], [lab('Nearest hospital'), E.hospital], [lab('Emergency contacts'), E.contacts], [lab('Emergency procedure'), E.plan]]),
      H2('6. Putting it in place, monitoring and review'),
      TB([3000, 12398], [[lab('Implement, monitor, review'), d.monitor], [lab('Consultation with workers'), d.consultation]]),
      H2('7. Sign-on: workers who have read and understood this SWMS'),
      TB([600, 4200, 4200, 2000, 4398], [['#', 'Name', 'Company', 'Date', 'Signature']].concat(d.signon.map(function (s, i) { return [String(i + 1), s.name, s.company, dmy(s.date), ' ']; })), true),
      P('Keep this SWMS on site and available to workers. Stop work and review it if the work, the site or the risks change, or after an incident.', { color: '6B675E', size: 15 })
    ];
    var docx = new X.Document({ creator: D.business || 'MBS', title: 'SWMS ' + (D.project || ''), styles: { default: { document: { run: { font: F, size: 18 } } } },
      sections: [{ properties: { page: { size: { width: 11906, height: 16838, orientation: X.PageOrientation.LANDSCAPE }, margin: { top: 720, bottom: 720, left: 720, right: 720 } } },
        footers: { default: new X.Footer({ children: [new X.Paragraph({ children: [R('SWMS · ' + (D.project || '') + ' · ' + (D.job || '') + ' · v' + d.version + ' ' + d.status + '    Page ', { size: 14, color: '6B675E' }), new X.TextRun({ children: [X.PageNumber.CURRENT, ' of ', X.PageNumber.TOTAL_PAGES], font: F, size: 14, color: '6B675E' })] })] }) },
        children: body }] });
    return X.Packer.toBlob(docx).then(function (b) { save2(b, fname(d, 'docx')); });
  }
  function printDoc(d, H) {
    var D = d.details, e = function (s) { return esc(s || '').replace(/\n/g, '<br>'); }, RF = { Low: '#DCFCE7', Medium: '#FEF3C7', High: '#FED7AA', Extreme: '#FECACA' };
    var w = window.open('', '_blank'); if (!w) return toast('Allow pop-ups to print', true);
    var tr = function (r) { return '<tr>' + r.map(function (c, i) { return i % 2 === 0 ? '<th>' + e(c) + '</th>' : '<td>' + e(c) + '</td>'; }).join('') + '</tr>'; };
    w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>' + esc(fname(d, 'pdf')) + '</title><style>@page{size:A4 landscape;margin:12mm}body{font:10px Arial,sans-serif;color:#111}h1{font-size:18px;margin:0}h2{font-size:12px;border-bottom:1.5px solid #C9A227;margin:14px 0 6px;padding-bottom:2px;break-after:avoid}table{width:100%;border-collapse:collapse;margin-bottom:6px}td,th{border:1px solid #bbb;padding:3px 5px;vertical-align:top;text-align:left}thead th{background:#1F2937;color:#fff}tbody th{background:#F6F3EA;width:16%}.sub{color:#666;margin:2px 0 8px}.sig td{height:22px}</style></head><body>' +
      '<h1>SAFE WORK METHOD STATEMENT</h1><p class="sub">High-risk construction work · WHS Regulation 2017 (NSW), Part 6.3 · Version ' + d.version + ' · ' + d.status + ' · ' + esc(D.business) + '</p>' +
      '<h2>1. Business and project</h2><table>' + detailRows(D).map(tr).join('') + '</table>' +
      '<h2>2. High-risk construction work in this job</h2><table>' + hrcwRows(d, H).map(function (r) { return '<tr><td>' + e(r[0]) + '</td></tr>'; }).join('') + '</table><p>' + e(d.hrcwNotes) + '</p>' +
      '<h2>3. Job steps, hazards and controls</h2><table><thead><tr><th>#</th><th>Job step</th><th>Hazards</th><th>Risk</th><th>Control measures</th><th>Risk after</th><th>Who</th></tr></thead><tbody>' +
        d.steps.map(function (s, i) { return '<tr><td>' + (i + 1) + '</td><td>' + e(s.step) + '</td><td>' + e(s.hazards) + '</td><td style="background:' + RF[s.risk] + '"><b>' + s.risk + '</b></td><td>' + e(s.controls) + '</td><td style="background:' + RF[s.residual] + '"><b>' + s.residual + '</b></td><td>' + e(s.who) + '</td></tr>'; }).join('') + '</tbody></table>' +
      '<h2>4. PPE, plant and equipment, licences and training</h2><table><thead><tr><th>PPE</th><th>Plant and equipment</th><th>Licences and training</th></tr></thead><tbody><tr><td>' + e(d.ppe.join('\n')) + '</td><td>' + e(d.plant.join('\n')) + '</td><td>' + e(d.quals.join('\n')) + '</td></tr></tbody></table>' +
      '<h2>5. Emergency arrangements</h2><table>' + [['First aid', d.emergency.firstAid], ['Assembly point', d.emergency.assembly], ['Nearest hospital', d.emergency.hospital], ['Emergency contacts', d.emergency.contacts], ['Emergency procedure', d.emergency.plan]].map(tr).join('') + '</table>' +
      '<h2>6. Putting it in place, monitoring and review</h2><table>' + [['Implement, monitor, review', d.monitor], ['Consultation', d.consultation]].map(tr).join('') + '</table>' +
      '<h2>7. Sign-on</h2><table class="sig"><thead><tr><th>#</th><th>Name</th><th>Company</th><th>Date</th><th>Signature</th></tr></thead><tbody>' + d.signon.map(function (s, i) { return '<tr><td>' + (i + 1) + '</td><td>' + e(s.name) + '</td><td>' + e(s.company) + '</td><td>' + dmy(s.date) + '</td><td></td></tr>'; }).join('') + '</tbody></table>' +
      '<script>window.onload=function(){window.print()}<\/script></body></html>');
    w.document.close();
  }

  M.swms = { generate: generate, download: function (core, fmt) { return api('swmsGet', { core: core }).then(function (r) { if (!r.swms) throw new Error('No SWMS yet'); return download(r.swms, r.hrcw, fmt); }); } };
  M.addView('swms', 'SWMS', swmsPage, 'projects');
})();
