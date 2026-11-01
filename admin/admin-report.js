/* MBS Console v62: 📊 project reports (customer, team, all stakeholders): the Gantt chart as a picture, and the report
   as PDF (jsPDF) or Word (docx), at most 4 pages. Everything is made here in the browser from the report's content
   (window.MBS.report.pdf / .docx / .gantt), so a report in the log can be made again exactly as it was sent. */
(function () {
  'use strict';
  var M = window.MBS; if (!M) return;
  function load(src, test) { return test() ? Promise.resolve() : new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = function () { rej(new Error('Could not load ' + src)); }; document.head.appendChild(s); }); }
  var libsPdf = function () { return load('vendor/jspdf.umd.min.js?v=252', function () { return !!window.jspdf; }).then(function () { return load('vendor/jspdf.plugin.autotable.min.js?v=384', function () { return !!(window.jspdf && window.jspdf.jsPDF.API.autoTable); }); }); };
  var libsDocx = function () { return load('vendor/docx.iife.js?v=951', function () { return !!window.docx; }); };
  var RAGF = { G: [21, 128, 61], A: [217, 119, 6], R: [185, 28, 28] }, RAGN = { G: 'GREEN', A: 'AMBER', R: 'RED' }, RAGH = { G: '15803D', A: 'D97706', R: 'B91C1C' };
  var dmy = function (s) { return s ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : ''; };
  var toD = function (s) { return new Date(s + 'T00:00:00Z'); }, DAY = 864e5;
  var fname = function (s, ext) { return (s.fileBase || 'Report') + '.' + ext; };
  function b64(blob) { return new Promise(function (res) { var r = new FileReader(); r.onload = function () { res(String(r.result).replace(/^data:[^,]*,/, '')); }; r.readAsDataURL(blob); }); }

  /* ---------- the Gantt chart as a picture ---------- */
  function gantt(s, maxRows) {
    var g = s.gantt; if (!g || !g.rows || !g.rows.length) return null;
    var rows = g.rows.slice(0, maxRows || 40), more = g.rows.length - rows.length;
    var W = 1800, LW = 560, top = 58, rh = 30, foot = 46, H = top + rows.length * rh + (more ? 26 : 0) + foot;
    var c = document.createElement('canvas'); c.width = W; c.height = H;
    var x = c.getContext('2d'), f0 = toD(g.from).getTime(), f1 = toD(g.to).getTime(), days = Math.max(1, Math.round((f1 - f0) / DAY) + 1), dw = (W - LW - 16) / days;
    var X = function (d) { return LW + Math.round((toD(d).getTime() - f0) / DAY) * dw; };
    x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
    x.font = '600 18px Arial'; x.fillStyle = '#1F1D18'; x.textBaseline = 'middle';
    // months and weeks across the top, weekends shaded on short charts
    x.fillStyle = '#F6F3EA'; x.fillRect(0, 0, W, top); x.fillStyle = '#1F1D18';
    var lastM = '';
    for (var i = 0; i < days; i++) {
      var d = new Date(f0 + i * DAY), dx = LW + i * dw, wd = d.getUTCDay(), m = d.toLocaleDateString('en-AU', { month: 'short', year: '2-digit', timeZone: 'UTC' });
      if (days <= 70 && (wd === 0 || wd === 6)) { x.fillStyle = '#F4F4F2'; x.fillRect(dx, top, dw, rows.length * rh); }
      if (m !== lastM) { lastM = m; x.fillStyle = '#1F1D18'; x.font = '700 17px Arial'; x.fillText(m, dx + 3, 17); x.strokeStyle = '#D6D0C1'; x.beginPath(); x.moveTo(dx, 0); x.lineTo(dx, top + rows.length * rh); x.stroke(); }
      if (wd === 1 && (days <= 200 || d.getUTCDate() <= 7)) { x.fillStyle = '#6B665A'; x.font = '15px Arial'; x.fillText(days <= 200 ? String(d.getUTCDate()) : '', dx + 2, 42); x.strokeStyle = '#EEE9DC'; x.beginPath(); x.moveTo(dx, 30); x.lineTo(dx, top + rows.length * rh); x.stroke(); }
    }
    x.fillStyle = '#6B665A'; x.font = '700 15px Arial'; x.fillText((g.title || 'TASK').toUpperCase(), 10, 42);
    rows.forEach(function (r, k) {
      var y = top + k * rh;
      if (k % 2) { x.fillStyle = 'rgba(246,243,234,.45)'; x.fillRect(0, y, W, rh); }
      x.fillStyle = r.level > 1 ? '#6B665A' : '#1F1D18'; x.font = (r.level > 1 ? '' : r.mile ? 'italic ' : '600 ') + (r.level > 1 ? '15px' : '16px') + ' Arial';
      var lab = r.label; while (x.measureText(lab).width > LW - 20 - (r.level > 1 ? 24 : 0) && lab.length > 4) lab = lab.slice(0, -2);
      if (lab !== r.label) lab = lab.slice(0, -1) + '…';
      x.fillText(lab, 10 + (r.level > 1 ? 24 : 0), y + rh / 2);
      if (!r.es) return;
      var a = Math.max(LW, X(r.es)), b = Math.min(W - 16, X(r.ef) + dw);
      if (r.ef < g.from || r.es > g.to) return;
      var col = r.late ? '#DC2626' : r.status === 'done' ? '#16A34A' : r.status === 'doing' || r.status === 'review' ? '#2563EB' : '#94A3B8';
      if (r.mile) { var mx = X(r.es) + dw / 2, my = y + rh / 2; x.fillStyle = r.status === 'done' ? '#16A34A' : '#1F1D18'; x.beginPath(); x.moveTo(mx, my - 9); x.lineTo(mx + 9, my); x.lineTo(mx, my + 9); x.lineTo(mx - 9, my); x.closePath(); x.fill(); return; }
      var bh = r.level > 1 ? 10 : 15, by = y + (rh - bh) / 2;
      x.fillStyle = col; x.globalAlpha = 0.28; x.fillRect(a, by, Math.max(3, b - a), bh); x.globalAlpha = 1;
      x.fillRect(a, by, Math.max(0, (b - a) * (r.pct || 0) / 100), bh);
      if (r.crit) { x.strokeStyle = '#EA580C'; x.lineWidth = 2.5; x.strokeRect(a, by, Math.max(3, b - a), bh); x.lineWidth = 1; }
      if (r.level === 1 && b - a > 0) { x.fillStyle = '#4B4739'; x.font = '13px Arial'; x.fillText((r.pct || 0) + '%', Math.min(b + 5, W - 60), y + rh / 2); }
    });
    if (more) { x.fillStyle = '#6B665A'; x.font = 'italic 15px Arial'; x.fillText('… and ' + more + ' more rows (see the plan)', 10, top + rows.length * rh + 13); }
    if (g.today && g.today >= g.from && g.today <= g.to) { var tx = X(g.today) + dw / 2; x.strokeStyle = '#DC2626'; x.lineWidth = 2; x.setLineDash([6, 4]); x.beginPath(); x.moveTo(tx, 26); x.lineTo(tx, top + rows.length * rh); x.stroke(); x.setLineDash([]); x.lineWidth = 1; x.fillStyle = '#DC2626'; x.font = '700 13px Arial'; x.fillText('Today', tx + 4, 30); }
    // legend
    var ly = H - foot / 2, lx = 10, item = function (col, t, kind) {
      if (kind === 'm') { x.fillStyle = col; x.beginPath(); x.moveTo(lx + 8, ly - 8); x.lineTo(lx + 16, ly); x.lineTo(lx + 8, ly + 8); x.lineTo(lx, ly); x.closePath(); x.fill(); }
      else if (kind === 'c') { x.strokeStyle = col; x.lineWidth = 2.5; x.strokeRect(lx, ly - 7, 22, 14); x.lineWidth = 1; }
      else if (kind === 't') { x.strokeStyle = col; x.lineWidth = 2; x.setLineDash([5, 3]); x.beginPath(); x.moveTo(lx + 10, ly - 10); x.lineTo(lx + 10, ly + 10); x.stroke(); x.setLineDash([]); x.lineWidth = 1; }
      else { x.fillStyle = col; x.fillRect(lx, ly - 7, 22, 14); }
      x.fillStyle = '#4B4739'; x.font = '15px Arial'; x.fillText(t, lx + 28, ly); lx += 40 + x.measureText(t).width;
    };
    item('#16A34A', 'Done'); item('#2563EB', 'In progress'); item('#94A3B8', 'To do'); item('#DC2626', 'Late'); item('#EA580C', 'Critical path', 'c'); item('#1F1D18', 'Milestone', 'm'); item('#DC2626', 'Today', 't');
    return { url: c.toDataURL('image/png'), jpg: c.toDataURL('image/jpeg', 0.88), w: W, h: H };
  }

  /* ---------- PDF (A4 portrait), kept to 4 pages ---------- */
  function pdfOnce(s, lim) {
    var J = window.jspdf.jsPDF, doc = new J({ unit: 'mm', format: 'a4', compress: true }), W = 210, L = 14, R = W - 14, y = 0, dark = [31, 29, 24], gold = [201, 162, 39], muted = [107, 102, 90];
    var need = function (h) { if (y + h > 282) { doc.addPage(); y = 16; } };
    // header band
    doc.setFillColor.apply(doc, dark); doc.rect(0, 0, W, 30, 'F'); doc.setFillColor.apply(doc, gold); doc.rect(0, 30, W, 1.2, 'F');
    doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text('MODERN BUILDING SOLUTIONS', L, 9);
    doc.setFontSize(16); doc.text(s.title, L, 18);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(225, 220, 205); doc.text(doc.splitTextToSize(s.project.name, 120)[0], L, 25);
    doc.setTextColor(255); doc.setFontSize(9); doc.text([s.type + ' report  #' + s.no, s.periodText, 'Issued ' + dmy(s.date) + (s.project.ref ? '  ·  ' + s.project.ref : '')], R, 10, { align: 'right' });
    y = 37;
    // RAG
    var rk = Object.keys(s.rag);
    doc.autoTable({ startY: y, margin: { left: L, right: L }, theme: 'grid', styles: { fontSize: 8.5, cellPadding: 1.8, halign: 'center', valign: 'middle', lineColor: [230, 226, 214] },
      body: [rk.map(function (k) { return s.rag[k].label; }), rk.map(function (k) { return RAGN[s.rag[k].c]; }), rk.map(function (k) { return s.rag[k].note || ''; })],
      didParseCell: function (d) { var c = s.rag[rk[d.column.index]].c; if (d.row.index === 0) { d.cell.styles.fontStyle = 'bold'; d.cell.styles.fillColor = [246, 243, 234]; d.cell.styles.textColor = dark; } if (d.row.index === 1) { d.cell.styles.fillColor = RAGF[c]; d.cell.styles.textColor = 255; d.cell.styles.fontStyle = 'bold'; d.cell.styles.fontSize = 10; } if (d.row.index === 2) { d.cell.styles.fontSize = 7.5; d.cell.styles.textColor = muted; } } });
    y = doc.lastAutoTable.finalY + 5;
    if (s.headline) { doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor.apply(doc, dark); var hl = doc.splitTextToSize(s.headline, R - L - 6); doc.setFillColor(253, 251, 243); doc.setDrawColor.apply(doc, gold); doc.rect(L, y - 1, R - L, hl.length * 4.8 + 5, 'FD'); doc.text(hl, L + 3, y + 4); y += hl.length * 4.8 + 9; }
    if (s.kpis && s.kpis.length) {
      doc.autoTable({ startY: y, margin: { left: L, right: L }, theme: 'plain', styles: { fontSize: 8, cellPadding: 1.4, halign: 'center' }, body: [s.kpis.map(function (k) { return k.label.toUpperCase(); }), s.kpis.map(function (k) { return k.value; })],
        didParseCell: function (d) { if (d.row.index === 0) { d.cell.styles.textColor = muted; d.cell.styles.fontSize = 6.8; } else { d.cell.styles.fontStyle = 'bold'; d.cell.styles.fontSize = 11; d.cell.styles.textColor = dark; } } });
      y = doc.lastAutoTable.finalY + 4;
    }
    var H2 = function (t) { need(14); doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5); doc.setTextColor.apply(doc, dark); doc.text(t, L, y); doc.setDrawColor.apply(doc, gold); doc.setLineWidth(0.5); doc.line(L, y + 1.5, R, y + 1.5); doc.setLineWidth(0.2); y += 6.5; };
    var bullets = function (list, box) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.3); doc.setTextColor.apply(doc, dark);
      var lines = []; list.slice(0, lim.pts).forEach(function (t) { doc.splitTextToSize(String(t), R - L - 8).forEach(function (ln, i) { lines.push([i ? '' : '•', ln]); }); });
      if (box) { need(lines.length * 4.4 + 5); doc.setFillColor(255, 247, 237); doc.setDrawColor(254, 215, 170); doc.rect(L, y - 3.5, R - L, lines.length * 4.4 + 4, 'FD'); }
      lines.forEach(function (ln) { need(5); doc.text(ln[0], L + 2, y); doc.text(ln[1], L + 6, y); y += 4.4; }); y += 2.5;
    };
    var table = function (t) {
      if (!t.rows.length) { doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.setTextColor.apply(doc, muted); doc.text(t.empty || 'Nothing to show.', L, y); y += 6; return; }
      var rows = t.rows.slice(0, lim.rows), more = t.rows.length - rows.length;
      doc.autoTable({ startY: y, margin: { left: L, right: L, top: 16 }, head: [t.head], body: rows.map(function (r) { return r.map(function (c) { return c && c.t != null ? c.t : c; }); }), theme: 'striped',
        styles: { fontSize: 8.2, cellPadding: 1.5, overflow: 'linebreak', valign: 'top' }, headStyles: { fillColor: dark, textColor: 255, fontSize: 8 }, alternateRowStyles: { fillColor: [250, 248, 242] }, columnStyles: t.cols || {},
        didParseCell: function (d) { if (d.section !== 'body') return; var c = rows[d.row.index][d.column.index]; if (c && c.rag) { d.cell.styles.fillColor = RAGF[c.rag]; d.cell.styles.textColor = 255; d.cell.styles.fontStyle = 'bold'; } if (c && c.b) d.cell.styles.fontStyle = 'bold'; } });
      y = doc.lastAutoTable.finalY + (more ? 1 : 5);
      if (more) { doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor.apply(doc, muted); doc.text('... and ' + more + ' more (see the project plan)', L, y + 3); y += 10; }
    };
    s.sections.forEach(function (sec) {
      if (sec.kind === 'gantt') {
        var g = gantt(s, lim.gantt); if (!g) return;
        var w = R - L, h = w * g.h / g.w, maxH = lim.ganttH; if (h > maxH) { w = w * maxH / h; h = maxH; }
        need(h + 12); H2(sec.title); doc.addImage(g.jpg, 'JPEG', L, y, w, h); y += h + 5; return;
      }
      if (sec.kind === 'bullets') { if (!sec.items.length && !sec.always) return; H2(sec.title); if (!sec.items.length) { doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.setTextColor.apply(doc, muted); doc.text(sec.empty || 'None.', L, y); y += 6; return; } bullets(sec.items, sec.box); return; }
      if (sec.kind === 'table') { if (!sec.rows.length && !sec.always) return; H2(sec.title); table(sec); }
    });
    var n = doc.getNumberOfPages();
    for (var i = 1; i <= n; i++) { doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor.apply(doc, muted); doc.text(s.title + ' #' + s.no + '  ·  ' + s.project.name.slice(0, 70), L, 291); doc.text('Page ' + i + ' of ' + n, R, 291, { align: 'right' }); }
    return doc;
  }
  var LIMITS = [{ rows: 14, pts: 7, gantt: 34, ganttH: 120 }, { rows: 10, pts: 6, gantt: 28, ganttH: 100 }, { rows: 7, pts: 5, gantt: 22, ganttH: 85 }, { rows: 5, pts: 4, gantt: 16, ganttH: 70 }, { rows: 3, pts: 3, gantt: 12, ganttH: 60 }];
  function pdf(s) {
    return libsPdf().then(function () {
      var doc, k = 0;
      for (; k < LIMITS.length; k++) { doc = pdfOnce(s, LIMITS[k]); if (doc.getNumberOfPages() <= 4) break; }
      s.lim = Math.min(k, LIMITS.length - 1);
      var blob = doc.output('blob'); return b64(blob).then(function (x) { return { blob: blob, base64: x, pages: doc.getNumberOfPages(), name: fname(s, 'pdf') }; });
    });
  }

  /* ---------- Word ---------- */
  function docx(s) {
    return libsDocx().then(function () {
      var D = window.docx, lim = LIMITS[s.lim || 0], F = 'Arial', dark = '1F1D18', muted = '6B665A';
      var T = function (t, o) { return new D.TextRun(Object.assign({ text: String(t == null ? '' : t), font: F, size: 19, color: dark }, o || {})); };
      var P = function (runs, o) { return new D.Paragraph(Object.assign({ spacing: { after: 60 }, children: Array.isArray(runs) ? runs : [runs] }, o || {})); };
      var B = { style: D.BorderStyle.SINGLE, size: 2, color: 'DDD8C8' }, BB = { top: B, bottom: B, left: B, right: B };
      var TW = 10466;
      var cell = function (t, w, o) { o = o || {}; return new D.TableCell({ width: { size: w, type: D.WidthType.DXA }, borders: BB, shading: o.fill ? { type: D.ShadingType.CLEAR, color: 'auto', fill: o.fill } : undefined, margins: { top: 50, bottom: 50, left: 80, right: 80 }, verticalAlign: D.VerticalAlign.CENTER,
        children: [P(T(t, { bold: !!o.bold, color: o.color || dark, size: o.size || 17 }), { spacing: { after: 0 }, alignment: o.center ? D.AlignmentType.CENTER : D.AlignmentType.LEFT })] }); };
      var H2 = function (t) { return new D.Paragraph({ spacing: { before: 200, after: 80 }, border: { bottom: { style: D.BorderStyle.SINGLE, size: 8, color: 'C9A227', space: 2 } }, children: [T(t, { bold: true, size: 23 })] }); };
      var kids = [];
      kids.push(new D.Table({ width: { size: TW, type: D.WidthType.DXA }, columnWidths: [6466, 4000], rows: [new D.TableRow({ children: [
        new D.TableCell({ width: { size: 6466, type: D.WidthType.DXA }, shading: { type: D.ShadingType.CLEAR, color: 'auto', fill: dark }, borders: BB, margins: { top: 120, bottom: 120, left: 160, right: 80 }, children: [P(T('MODERN BUILDING SOLUTIONS', { bold: true, color: 'C9A227', size: 16 })), P(T(s.title, { bold: true, color: 'FFFFFF', size: 32 })), P(T(s.project.name, { color: 'E1DCCD', size: 18 }), { spacing: { after: 0 } })] }),
        new D.TableCell({ width: { size: 4000, type: D.WidthType.DXA }, shading: { type: D.ShadingType.CLEAR, color: 'auto', fill: dark }, borders: BB, margins: { top: 120, bottom: 120, left: 80, right: 160 }, children: [s.type + ' report  #' + s.no, s.periodText, 'Issued ' + dmy(s.date) + (s.project.ref ? '  ·  ' + s.project.ref : '')].map(function (t) { return P(T(t, { color: 'FFFFFF', size: 17 }), { alignment: D.AlignmentType.RIGHT, spacing: { after: 20 } }); }) })] })] }));
      var rk = Object.keys(s.rag), cw = Math.floor(TW / rk.length), cws = rk.map(function (k, i) { return i === rk.length - 1 ? TW - cw * (rk.length - 1) : cw; });
      kids.push(P(T(''), { spacing: { after: 80 } }));
      kids.push(new D.Table({ width: { size: TW, type: D.WidthType.DXA }, columnWidths: cws, rows: [
        new D.TableRow({ children: rk.map(function (k, i) { return cell(s.rag[k].label, cws[i], { bold: true, fill: 'F6F3EA', center: true }); }) }),
        new D.TableRow({ children: rk.map(function (k, i) { return cell(RAGN[s.rag[k].c], cws[i], { bold: true, fill: RAGH[s.rag[k].c], color: 'FFFFFF', center: true, size: 19 }); }) }),
        new D.TableRow({ children: rk.map(function (k, i) { return cell(s.rag[k].note || '', cws[i], { color: muted, center: true, size: 15 }); }) })] }));
      if (s.headline) kids.push(new D.Paragraph({ spacing: { before: 160, after: 100 }, shading: { type: D.ShadingType.CLEAR, color: 'auto', fill: 'FDFBF3' }, border: { left: { style: D.BorderStyle.SINGLE, size: 18, color: 'C9A227', space: 6 } }, children: [T(s.headline, { bold: true, size: 21 })] }));
      if (s.kpis && s.kpis.length) { var kw = Math.floor(TW / s.kpis.length), kws = s.kpis.map(function (k, i) { return i === s.kpis.length - 1 ? TW - kw * (s.kpis.length - 1) : kw; });
        kids.push(new D.Table({ width: { size: TW, type: D.WidthType.DXA }, columnWidths: kws, rows: [new D.TableRow({ children: s.kpis.map(function (k, i) { return new D.TableCell({ width: { size: kws[i], type: D.WidthType.DXA }, borders: BB, margins: { top: 60, bottom: 60, left: 60, right: 60 }, children: [P(T(k.label.toUpperCase(), { size: 13, color: muted }), { alignment: D.AlignmentType.CENTER, spacing: { after: 20 } }), P(T(k.value, { bold: true, size: 22 }), { alignment: D.AlignmentType.CENTER, spacing: { after: 0 } })] }); }) })] })); }
      s.sections.forEach(function (sec) {
        if (sec.kind === 'gantt') { var g = gantt(s, lim.gantt); if (!g) return; var bin = atob(g.url.split(',')[1]), u8 = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
          var w = 680, h = Math.round(w * g.h / g.w), maxH = Math.round(lim.ganttH * 3.78); if (h > maxH) { w = Math.round(w * maxH / h); h = maxH; }
          kids.push(H2(sec.title)); kids.push(P(new D.ImageRun({ type: 'png', data: u8, transformation: { width: w, height: h } }))); return; }
        if (sec.kind === 'bullets') { if (!sec.items.length && !sec.always) return; kids.push(H2(sec.title)); if (!sec.items.length) { kids.push(P(T(sec.empty || 'None.', { italics: true, color: muted }))); return; }
          sec.items.slice(0, lim.pts).forEach(function (t) { kids.push(new D.Paragraph({ numbering: { reference: 'dots', level: 0 }, spacing: { after: 40 }, shading: sec.box ? { type: D.ShadingType.CLEAR, color: 'auto', fill: 'FFF7ED' } : undefined, children: [T(t)] })); }); return; }
        if (sec.kind === 'table') { if (!sec.rows.length && !sec.always) return; kids.push(H2(sec.title)); if (!sec.rows.length) { kids.push(P(T(sec.empty || 'Nothing to show.', { italics: true, color: muted }))); return; }
          var rows = sec.rows.slice(0, lim.rows), more = sec.rows.length - rows.length, ws = sec.wordCols || sec.head.map(function () { return Math.floor(TW / sec.head.length); }), sum = ws.reduce(function (a, b) { return a + b; }, 0);
          ws = ws.map(function (x) { return Math.floor(x * TW / sum); }); ws[ws.length - 1] += TW - ws.reduce(function (a, b) { return a + b; }, 0);
          kids.push(new D.Table({ width: { size: TW, type: D.WidthType.DXA }, columnWidths: ws, rows: [new D.TableRow({ tableHeader: true, children: sec.head.map(function (h, i) { return cell(h, ws[i], { bold: true, fill: dark, color: 'FFFFFF', size: 16 }); }) })].concat(rows.map(function (r, ri) {
            return new D.TableRow({ children: r.map(function (c, i) { var o = c && c.rag ? { fill: RAGH[c.rag], color: 'FFFFFF', bold: true } : { fill: ri % 2 ? 'FAF8F2' : undefined, bold: !!(c && c.b) }; return cell(c && c.t != null ? c.t : c, ws[i], o); }) }); })) }));
          if (more) kids.push(P(T('... and ' + more + ' more (see the project plan)', { italics: true, color: muted, size: 16 }))); }
      });
      var doc = new D.Document({ creator: 'Modern Building Solutions', title: s.title, numbering: { config: [{ reference: 'dots', levels: [{ level: 0, format: D.LevelFormat.BULLET, text: '•', alignment: D.AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 260 } } } }] }] },
        sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 720, bottom: 720, left: 720, right: 720 } } },
          footers: { default: new D.Footer({ children: [new D.Paragraph({ alignment: D.AlignmentType.RIGHT, children: [T(s.title + ' #' + s.no + '  ·  page ', { size: 14, color: muted }), new D.TextRun({ children: [D.PageNumber.CURRENT], font: F, size: 14, color: muted }), T(' of ', { size: 14, color: muted }), new D.TextRun({ children: [D.PageNumber.TOTAL_PAGES], font: F, size: 14, color: muted })] })] }) },
          children: kids }] });
      return D.Packer.toBlob(doc).then(function (blob) { return b64(blob).then(function (x) { return { blob: blob, base64: x, name: fname(s, 'docx') }; }); });
    });
  }
  function save(blob, name) { var url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 5000); }
  function reportPdf(s) { return pdf(s); }
  M.report = { pdf: reportPdf, docx: function (s) { return (s.lim == null ? pdf(s) : Promise.resolve()).then(function () { return docx(s); }); }, gantt: gantt, save: save };
})();
