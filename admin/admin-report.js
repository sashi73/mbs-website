/* GKH Project Champ: 📊 project reports (status reports, change requests, BOM, decisions) as designed documents.
   The Gantt chart as a picture, and the report as PDF (jsPDF) or Word (docx), at most 4 pages (or in full).
   🎨 Every report takes the project's colour scheme (the same themes as the charter and the plan) and a skin:
     modern   Canva style: a dark hero cover with shapes, RAG cards, stat tiles with progress bars, numbered headings
     bold     a full-colour header with a diagonal, filled headings, big numbers
     minimal  white and airy: light type, thin accent rules, quiet tables
     classic  the original look (a dark band, plain tables), in the theme's colours
   Everything is made here in the browser from the report's content (window.MBS.report.pdf / .docx / .gantt), so a report
   in the log can be made again exactly as it was sent (its theme and skin are kept with it). */
(function () {
  'use strict';
  var M = window.MBS; if (!M) return;
  function load(src, test) { return test() ? Promise.resolve() : new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = function () { rej(new Error('Could not load ' + src)); }; document.head.appendChild(s); }); }
  var libsPdf = function () { return load('vendor/jspdf.umd.min.js?v=252', function () { return !!window.jspdf; }).then(function () { return load('vendor/jspdf.plugin.autotable.min.js?v=384', function () { return !!(window.jspdf && window.jspdf.jsPDF.API.autoTable); }); }); };
  var libsFont = function () { return load('vendor/poppins.js?v=1', function () { return !!window.CHAMP_FONTS; }); };
  var libsDocx = function () { return load('vendor/docx.iife.js?v=951', function () { return !!window.docx; }); };
  var RAGF = { G: [21, 128, 61], A: [217, 119, 6], R: [185, 28, 28] }, RAGN = { G: 'GREEN', A: 'AMBER', R: 'RED' }, RAGH = { G: '15803D', A: 'D97706', R: 'B91C1C' };
  var dmy = function (s) { return s ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : ''; };
  var toD = function (s) { return new Date(s + 'T00:00:00Z'); }, DAY = 864e5;
  var fname = function (s, ext) { return (s.fileBase || 'Report') + '.' + ext; };
  function b64(blob) { return new Promise(function (res) { var r = new FileReader(); r.onload = function () { res(String(r.result).replace(/^data:[^,]*,/, '')); }; r.readAsDataURL(blob); }); }

  /* ---------- 🎨 the look: colour scheme + skin ---------- */
  var SKINS = [
    { id: 'modern', name: 'Modern', blurb: 'Canva style: hero cover, cards and tiles' },
    { id: 'bold', name: 'Bold', blurb: 'Full-colour header, filled headings, big numbers' },
    { id: 'minimal', name: 'Minimal', blurb: 'White and airy, light type, thin rules' },
    { id: 'classic', name: 'Classic', blurb: 'The original plain report' }];
  var mix = function (a, b, t) { return a.map(function (v, i) { return Math.round(v + (b[i] - v) * t); }); };
  var lum = function (c) { return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255; };
  var rgb = function (h) { h = String(h || '').replace('#', ''); if (h.length === 3) h = h.replace(/./g, '$&$&'); if (!/^[0-9a-f]{6}$/i.test(h)) return null; var n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  var HX = function (c) { return c.map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join('').toUpperCase(); };
  var WH = [255, 255, 255];
  function lookOf(s) {
    var hook = typeof M.reportLook === 'function' ? (M.reportLook() || {}) : {};
    var th = s && s.theme != null ? s.theme : hook.theme, skin = (s && s.skin) || hook.skin || 'modern';
    if (!SKINS.some(function (k) { return k.id === skin; })) skin = 'modern';
    var T = (M.studio && M.studio.themes && M.studio.themes()) || [], t, ink, acc, light, sec, paper;
    if (th && typeof th === 'object' && rgb(th.ink) && rgb(th.accent)) {
      ink = rgb(th.ink); if (lum(ink) > 0.35) ink = mix(ink, [0, 0, 0], 0.65); acc = rgb(th.accent); light = mix(acc, WH, 0.45); sec = rgb(th.second) || [5, 150, 105]; paper = mix(acc, WH, 0.95);
    } else {
      t = T.filter(function (x) { return x.id === th; })[0] || T.filter(function (x) { return x.id === 'champ'; })[0] || T[0];
      if (t) { ink = rgb(t.ink); acc = rgb(t.accent); light = rgb(t.light); sec = rgb(t.second); paper = rgb(t.paper); }
      else { ink = [12, 11, 8]; acc = [201, 162, 39]; light = [232, 192, 74]; sec = [5, 150, 105]; paper = [251, 248, 236]; }
    }
    var P = { skin: skin, ink: ink, acc: acc, light: light, sec: sec, paper: paper,
      ink2: mix(ink, WH, 0.13), text: mix(ink, [40, 40, 40], 0.6), muted: mix(ink, [140, 140, 140], 0.7), line: mix(paper, ink, 0.13), soft: mix(paper, ink, 0.035), soft2: mix(paper, WH, 0.5),
      tint: mix(acc, WH, 0.88), onDark: mix(ink, WH, 0.86), onDark2: mix(ink, WH, 0.62), onAcc: lum(acc) > 0.55 ? ink : WH, accD: lum(acc) > 0.5 ? mix(acc, ink, 0.45) : acc };
    P.hex = {}; Object.keys(P).forEach(function (k) { if (Array.isArray(P[k])) P.hex[k] = HX(P[k]); });
    return P;
  }
  // text Poppins can draw (Latin): arrows, ticks and emoji replaced
  var clean = function (x) { return String(x == null ? '' : x).replace(/→/g, 'to').replace(/[✓✔]/g, '').replace(/☐/g, '[ ]').replace(/[←↑↓◆]/g, '').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '').replace(/[ \t]{2,}/g, ' ').trim(); };
  function cleanDeep(v) { if (typeof v === 'string') return clean(v); if (Array.isArray(v)) return v.map(cleanDeep); if (v && typeof v === 'object') { var o = {}; Object.keys(v).forEach(function (k) { o[k] = k === 'gantt' || k === 'fill' ? v[k] : cleanDeep(v[k]); }); return o; } return v; }

  /* ---------- the Gantt chart as a picture (in the theme's colours) ---------- */
  function gantt(s, maxRows) { var gg = (s && s.gantt) || {}, GW = gg.words || {}, P = lookOf(s), h = function (c) { return '#' + HX(c); };
    var g = s.gantt; if (!g || !g.rows || !g.rows.length) return null;
    var rows = g.rows.slice(0, maxRows || 40), more = g.rows.length - rows.length, fontF = P.skin === 'classic' ? 'Arial' : 'Poppins, Arial';
    var W = 1800, LW = 560, top = 58, rh = 30, foot = 46, H = top + rows.length * rh + (more ? 26 : 0) + foot;
    var c = document.createElement('canvas'); c.width = W; c.height = H;
    var x = c.getContext('2d'), f0 = toD(g.from).getTime(), f1 = toD(g.to).getTime(), days = Math.max(1, Math.round((f1 - f0) / DAY) + 1), dw = (W - LW - 16) / days;
    var X = function (d) { return LW + Math.round((toD(d).getTime() - f0) / DAY) * dw; }, F = function (w, px) { x.font = w + ' ' + px + 'px ' + fontF; };
    var INK = h(P.ink), MUT = h(P.muted), HEAD = P.skin === 'bold' ? h(P.ink) : h(P.soft), HEADT = P.skin === 'bold' ? h(P.onDark) : INK;
    x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.textBaseline = 'middle';
    x.fillStyle = HEAD; x.fillRect(0, 0, W, top); if (P.skin !== 'classic') { x.fillStyle = h(P.acc); x.fillRect(0, top - 3, W, 3); }
    var lastM = '';
    for (var i = 0; i < days; i++) {
      var d = new Date(f0 + i * DAY), dx = LW + i * dw, wd = d.getUTCDay(), m = d.toLocaleDateString(gg.locale || 'en-AU', { month: 'short', year: '2-digit', timeZone: 'UTC' });
      if (days <= 70 && (wd === 0 || wd === 6)) { x.fillStyle = h(mix(P.soft, WH, 0.3)); x.fillRect(dx, top, dw, rows.length * rh); }
      if (m !== lastM) { lastM = m; x.fillStyle = HEADT; F(700, 17); x.fillText(m, dx + 3, 17); x.strokeStyle = h(P.line); x.beginPath(); x.moveTo(dx, 0); x.lineTo(dx, top + rows.length * rh); x.stroke(); }
      if (wd === 1 && (days <= 200 || d.getUTCDate() <= 7)) { x.fillStyle = P.skin === 'bold' ? h(P.onDark2) : MUT; F(400, 15); x.fillText(days <= 200 ? String(d.getUTCDate()) : '', dx + 2, 42); x.strokeStyle = h(mix(P.line, WH, 0.4)); x.beginPath(); x.moveTo(dx, 30); x.lineTo(dx, top + rows.length * rh); x.stroke(); }
    }
    x.fillStyle = P.skin === 'bold' ? h(P.onDark2) : MUT; F(700, 15); x.fillText((g.title || 'TASK').toUpperCase(), 10, 42);
    rows.forEach(function (r, k) {
      var y = top + k * rh;
      if (k % 2) { x.fillStyle = h(mix(P.soft, WH, 0.45)); x.fillRect(0, y, W, rh); }
      x.fillStyle = r.level > 1 ? MUT : INK; F(r.level > 1 ? 400 : r.mile ? 'italic 600' : 600, r.level > 2 ? 13 : r.level > 1 ? 15 : 16);
      var ind = r.level > 2 ? 44 : r.level > 1 ? 24 : 0, lab = r.label; while (x.measureText(lab).width > LW - 20 - ind && lab.length > 4) lab = lab.slice(0, -2);
      if (lab !== r.label) lab = lab.slice(0, -1) + '…';
      x.fillText(lab, 10 + ind, y + rh / 2);
      if (!r.es) return;
      var a = Math.max(LW, X(r.es)), b = Math.min(W - 16, X(r.ef) + dw);
      if (r.ef < g.from || r.es > g.to) return;
      var pp = +r.pct || 0, col = r.late ? '#DC2626' : pp >= 100 ? '#16A34A' : pp >= 63 ? '#7C3AED' : pp >= 38 ? '#2563EB' : pp > 0 ? '#F59E0B' : '#94A3B8';
      if (r.mile) { var mx = X(r.es) + dw / 2, my = y + rh / 2; x.fillStyle = r.status === 'done' ? '#16A34A' : INK; x.beginPath(); x.moveTo(mx, my - 9); x.lineTo(mx + 9, my); x.lineTo(mx, my + 9); x.lineTo(mx - 9, my); x.closePath(); x.fill(); return; }
      var bh = r.level > 2 ? 6 : r.level > 1 ? 10 : 15, by = y + (rh - bh) / 2, bw = Math.max(3, b - a), rad = P.skin === 'classic' ? 0 : Math.min(bh / 2, 7);
      var bar = function (w) { x.beginPath(); if (rad && x.roundRect) x.roundRect(a, by, w, bh, rad); else x.rect(a, by, w, bh); x.fill(); };
      x.fillStyle = col; x.globalAlpha = 0.28; bar(bw); x.globalAlpha = 1;
      if (pp > 0) bar(Math.max(rad * 2, (b - a) * pp / 100));
      if (r.crit) { x.strokeStyle = '#EA580C'; x.lineWidth = 2.5; x.beginPath(); if (rad && x.roundRect) x.roundRect(a, by, bw, bh, rad); else x.rect(a, by, bw, bh); x.stroke(); x.lineWidth = 1; }
      if (r.level === 1 && b - a > 0) { x.fillStyle = MUT; F(600, 13); x.fillText((r.pct || 0) + '%', Math.min(b + 5, W - 60), y + rh / 2); }
    });
    if (more) { x.fillStyle = MUT; F('italic 400', 15); x.fillText((GW.more ? GW.more.replace('{n}', more) : '… and ' + more + ' more rows (see the plan)'), 10, top + rows.length * rh + 13); }
    if (g.today && g.today >= g.from && g.today <= g.to) { var tx = X(g.today) + dw / 2; x.strokeStyle = '#DC2626'; x.lineWidth = 2; x.setLineDash([6, 4]); x.beginPath(); x.moveTo(tx, 26); x.lineTo(tx, top + rows.length * rh); x.stroke(); x.setLineDash([]); x.lineWidth = 1; x.fillStyle = '#DC2626'; F(700, 13); x.fillText(GW.today || 'Today', tx + 4, 30); }
    var ly = H - foot / 2, lx = 10, item = function (col, t, kind) {
      if (kind === 'm') { x.fillStyle = col; x.beginPath(); x.moveTo(lx + 8, ly - 8); x.lineTo(lx + 16, ly); x.lineTo(lx + 8, ly + 8); x.lineTo(lx, ly); x.closePath(); x.fill(); }
      else if (kind === 'c') { x.strokeStyle = col; x.lineWidth = 2.5; x.strokeRect(lx, ly - 7, 22, 14); x.lineWidth = 1; }
      else if (kind === 't') { x.strokeStyle = col; x.lineWidth = 2; x.setLineDash([5, 3]); x.beginPath(); x.moveTo(lx + 10, ly - 10); x.lineTo(lx + 10, ly + 10); x.stroke(); x.setLineDash([]); x.lineWidth = 1; }
      else { x.fillStyle = col; x.beginPath(); if (P.skin !== 'classic' && x.roundRect) x.roundRect(lx, ly - 7, 22, 14, 7); else x.rect(lx, ly - 7, 22, 14); x.fill(); }
      x.fillStyle = MUT; F(400, 15); x.fillText(t, lx + 28, ly); lx += 40 + x.measureText(t).width;
    };
    item('#94A3B8', '0%'); item('#F59E0B', '25%'); item('#2563EB', '50%'); item('#7C3AED', '75%'); item('#16A34A', GW.done || '100% done'); item('#DC2626', GW.late || 'Late'); item('#EA580C', GW.critical || 'Critical path', 'c'); item(INK, GW.milestone || 'Milestone', 'm'); item('#DC2626', GW.today || 'Today', 't');
    return { url: c.toDataURL('image/png'), jpg: c.toDataURL('image/jpeg', 0.9), w: W, h: H };
  }

  /* ---------- PDF (A4 portrait), kept to 4 pages ---------- */
  function pdfOnce(s0, lim) {
    var P = lookOf(s0), K = P.skin, CL = K === 'classic', s = CL ? s0 : cleanDeep(s0);
    var J = window.jspdf.jsPDF, doc = new J({ unit: 'mm', format: 'a4', compress: true }), W = 210, L = 14, R = W - 14, y = 0, secN = 0;
    if (!CL && window.CHAMP_FONTS) [['Poppins-Regular', 'Poppins', 'normal'], ['Poppins-SemiBold', 'Poppins', 'bold'], ['Poppins-ExtraBold', 'PoppinsX', 'normal'], ['Poppins-Light', 'PoppinsL', 'normal']].forEach(function (f) { doc.addFileToVFS(f[0] + '.ttf', window.CHAMP_FONTS[f[0]]); doc.addFont(f[0] + '.ttf', f[1], f[2]); });
    var PO = !CL && !!window.CHAMP_FONTS, FAM = PO ? 'Poppins' : 'helvetica';
    var fnt = function (w, size) { if (PO && w === 'x') doc.setFont('PoppinsX', 'normal'); else if (PO && (w === 'l' || w === 'i')) doc.setFont('PoppinsL', 'normal'); else doc.setFont(FAM, w === 'b' || w === 'x' ? 'bold' : w === 'i' ? 'italic' : 'normal'); doc.setFontSize(size); };
    var tc = function (c) { doc.setTextColor(c[0], c[1], c[2]); }, fill = function (c) { doc.setFillColor(c[0], c[1], c[2]); }, draw = function (c) { doc.setDrawColor(c[0], c[1], c[2]); };
    var sp = function (n) { if (doc.setCharSpace) doc.setCharSpace(n); };
    var rr = function (x, y0, w, h, r, st) { if (CL || !doc.roundedRect) doc.rect(x, y0, w, h, st); else doc.roundedRect(x, y0, w, h, Math.min(r, h / 2, w / 2), Math.min(r, h / 2, w / 2), st); };
    var need = function (h) { if (y + h > 280) { doc.addPage(); y = K === 'minimal' ? 18 : 19; } };
    var meta = s.headRight || [s.type + ' report  #' + s.no, s.periodText, 'Issued ' + dmy(s.date) + (s.project.ref ? '  ·  ' + s.project.ref : '')];
    meta = meta.filter(function (t) { return t && String(t).trim(); });
    var brand = s.brand || 'GKH PROJECT CHAMP', ov = s.rag && s.rag.overall && s.rag.overall.c;
    var fitSize = function (t, w, size, min) { while (size > (min || 7) && doc.getTextWidth(t) > w) { size -= 0.5; doc.setFontSize(size); } return size; };

    /* --- the header --- */
    if (K === 'modern') {
      var hh = 54; fill(P.ink); doc.rect(0, 0, W, hh, 'F');
      fill(mix(P.acc, P.ink, 0.1)); doc.circle(W - 6, 4, 34, 'F');
      fill(mix(P.light, P.ink, 0.5)); doc.circle(W - 50, hh - 13, 11, 'F');
      fill(mix(P.sec, P.ink, 0.3)); doc.circle(W - 22, hh - 9, 6, 'F');
      fill(mix(P.ink, WH, 0.2)); for (var di = 0; di < 6; di++) for (var dj = 0; dj < 3; dj++) doc.circle(118 + di * 4, 8 + dj * 4, 0.5, 'F');
      fill(P.acc); doc.rect(0, hh, W, 1.6, 'F');
      fnt('b', 7.5); sp(0.8); tc(P.light); doc.text(brand.toUpperCase(), L, 12); sp(0);
      fnt('x', 23); tc(WH); var tl = doc.splitTextToSize(s.title, 118).slice(0, 2); doc.text(tl, L, 23); var yy = 23 + (tl.length - 1) * 9;
      fnt('n', 10.5); tc(P.onDark); doc.text(doc.splitTextToSize(s.project.name, 120)[0], L, yy + 7.5);
      var px = L; fnt('n', 7.2); meta.slice(0, 3).forEach(function (t) { var w = doc.getTextWidth(t) + 6; if (px + w > 150) return; fill(P.ink2); rr(px, hh - 12, w, 6, 3, 'F'); tc(P.onDark); doc.text(t, px + 3, hh - 7.9); px += w + 2.5; });
      if (ov) { fnt('b', 6.5); sp(0.6); tc(P.onAcc); doc.text('OVERALL', R - 19, 11.5, { align: 'center' }); sp(0); fill(RAGF[ov]); rr(R - 38, 14, 38, 11, 5.5, 'F'); fill(WH); doc.circle(R - 32, 19.5, 1.6, 'F'); fnt('b', 10.5); tc(WH); doc.text(RAGN[ov], R - 17, 21.2, { align: 'center' }); }
      y = hh + 10;
    } else if (K === 'bold') {
      var hb = 46; fill(P.acc); doc.rect(0, 0, W, hb, 'F'); fill(P.ink); doc.triangle(118, hb, W, 0, W, hb, 'F'); doc.rect(0, hb, W, 2.5, 'F');
      fill(mix(P.acc, WH, 0.25)); doc.circle(104, 8, 3, 'F'); fill(mix(P.acc, P.ink, 0.2)); doc.circle(96, 15, 1.6, 'F');
      fnt('b', 8); sp(1); tc(P.onAcc); doc.text(brand.toUpperCase(), L, 11); sp(0);
      fnt('x', 24); var tb = doc.splitTextToSize(s.title.toUpperCase(), 105).slice(0, 2); doc.text(tb, L, 23); var yb = 23 + (tb.length - 1) * 9.5;
      fnt('b', 10.5); tc(P.onAcc === WH ? mix(WH, P.acc, 0.12) : P.ink2); doc.text(doc.splitTextToSize(s.project.name, 105)[0], L, yb + 7.5);
      fnt('n', 8); tc(WH); meta.slice(0, 3).forEach(function (t, i) { doc.text(String(t), R, 30 + i * 4.8, { align: 'right' }); });
      if (ov) { fill(RAGF[ov]); rr(R - 32, 10, 32, 9, 4.5, 'F'); fnt('b', 9); tc(WH); doc.text(RAGN[ov], R - 16, 15.8, { align: 'center' }); }
      y = hb + 11;
    } else if (K === 'minimal') {
      fnt('b', 7.5); sp(1.2); tc(P.accD); doc.text(brand.toUpperCase(), L, 15); sp(0);
      fnt('l', 24); tc(P.ink); var tm = doc.splitTextToSize(s.title, 120).slice(0, 2); doc.text(tm, L, 27); var ym = 27 + (tm.length - 1) * 9.5;
      fnt('n', 10); tc(P.muted); doc.text(doc.splitTextToSize(s.project.name, 120)[0], L, ym + 7);
      fill(P.acc); doc.rect(L, ym + 11, 22, 1.1, 'F');
      fnt('n', 8); tc(P.muted); meta.slice(0, 3).forEach(function (t, i) { doc.text(String(t), R, 15 + i * 4.6, { align: 'right' }); });
      if (ov) { fill(RAGF[ov]); doc.circle(R - 26, 32.2, 1.5, 'F'); fnt('b', 8); tc(P.ink); doc.text('Overall ' + RAGN[ov].toLowerCase(), R, 33.2, { align: 'right' }); }
      draw(P.line); doc.setLineWidth(0.25); doc.line(L, ym + 17, R, ym + 17);
      y = ym + 25;
    } else {
      fill(P.ink); doc.rect(0, 0, W, 30, 'F'); fill(P.acc); doc.rect(0, 30, W, 1.2, 'F');
      tc(WH); fnt('b', 9); doc.text(brand, L, 9);
      fnt('b', 16); doc.text(s.title, L, 18);
      fnt('n', 9.5); tc(P.onDark); doc.text(doc.splitTextToSize(s.project.name, 120)[0], L, 25);
      tc(WH); fnt('n', 9); doc.text(meta, R, 10, { align: 'right' });
      y = 37;
    }

    /* --- RAG status --- */
    var rk = Object.keys(s.rag || {});
    if (rk.length && CL) {
      doc.autoTable({ startY: y, margin: { left: L, right: L }, theme: 'grid', styles: { fontSize: 8.5, cellPadding: 1.8, halign: 'center', valign: 'middle', lineColor: P.line },
        body: [rk.map(function (k) { return s.rag[k].label; }), rk.map(function (k) { return RAGN[s.rag[k].c]; }), rk.map(function (k) { return s.rag[k].note || ''; })],
        didParseCell: function (d) { var c = s.rag[rk[d.column.index]].c; if (d.row.index === 0) { d.cell.styles.fontStyle = 'bold'; d.cell.styles.fillColor = P.soft; d.cell.styles.textColor = P.ink; } if (d.row.index === 1) { d.cell.styles.fillColor = RAGF[c]; d.cell.styles.textColor = 255; d.cell.styles.fontStyle = 'bold'; d.cell.styles.fontSize = 10; } if (d.row.index === 2) { d.cell.styles.fontSize = 7.5; d.cell.styles.textColor = P.muted; } } });
      y = doc.lastAutoTable.finalY + 5;
    } else if (rk.length) {
      var gap = 3, n = rk.length, cw = (R - L - gap * (n - 1)) / n; fnt('n', 6.8);
      var notes = rk.map(function (k) { return doc.splitTextToSize(String(s.rag[k].note || ''), cw - 7).slice(0, 3); }), nl = Math.max.apply(null, notes.map(function (x) { return x.length; }).concat([0]));
      var ch = (K === 'minimal' ? 13 : 16) + nl * 3.1;
      rk.forEach(function (k, i) {
        var x0 = L + i * (cw + gap), c = s.rag[k].c, RC = RAGF[c] || P.muted, lab = String(s.rag[k].label || k).toUpperCase();
        if (K === 'bold') { fill(RC); rr(x0, y, cw, ch, 2.5, 'F'); fnt('b', 6.6); sp(0.4); tc(mix(RC, WH, 0.8)); doc.text(lab, x0 + 4, y + 5.5); sp(0); fnt('x', 12); tc(WH); doc.text(RAGN[c] || '', x0 + 4, y + 12.3); fnt('n', 6.8); tc(mix(RC, WH, 0.85)); doc.text(notes[i], x0 + 4, y + 16.8); return; }
        if (K === 'minimal') { draw(P.line); doc.setLineWidth(0.25); rr(x0, y, cw, ch, 1.5, 'S'); fill(RC); doc.circle(x0 + 5, y + 5.2, 1.4, 'F'); fnt('b', 6.6); sp(0.4); tc(P.muted); doc.text(lab, x0 + 8, y + 6); sp(0); fnt('b', 9); tc(P.ink); doc.text((RAGN[c] || '').charAt(0) + (RAGN[c] || '').slice(1).toLowerCase(), x0 + 4, y + 11); fnt('n', 6.8); tc(P.muted); doc.text(notes[i], x0 + 4, y + 15); return; }
        fill(P.soft); draw(P.line); doc.setLineWidth(0.2); rr(x0, y, cw, ch, 2.5, 'FD'); fill(RC); rr(x0, y + 3, 1.6, ch - 6, 0.8, 'F');
        fnt('b', 6.4); sp(0.4); tc(P.muted); doc.text(lab, x0 + 5, y + 5.6); sp(0);
        fill(RC); rr(x0 + 5, y + 7.4, 19, 5.6, 2.8, 'F'); fnt('b', 7.2); tc(WH); doc.text(RAGN[c] || '', x0 + 14.5, y + 11.2, { align: 'center' });
        fnt('n', 6.8); tc(P.muted); doc.text(notes[i], x0 + 5, y + 16.6);
      });
      y += ch + 6;
    }

    /* --- the headline --- */
    if (s.headline) {
      if (CL) { fnt('b', 10.5); tc(P.ink); var hl = doc.splitTextToSize(s.headline, R - L - 6); fill(P.tint); draw(P.acc); doc.rect(L, y - 1, R - L, hl.length * 4.8 + 5, 'FD'); doc.text(hl, L + 3, y + 4); y += hl.length * 4.8 + 9; }
      else if (K === 'modern') { fnt('b', 10.5); var hm = doc.splitTextToSize(s.headline, R - L - 18), hH = hm.length * 4.9 + 8; fill(P.tint); rr(L, y, R - L, hH, 3, 'F'); fill(P.acc); rr(L, y, 2.2, hH, 1.1, 'F'); fnt('x', 26); tc(P.acc); doc.text('“', L + 5, y + 11.5); fnt('b', 10.5); tc(P.ink); doc.text(hm, L + 14, y + 6.6); y += hH + 6; }
      else if (K === 'bold') { fnt('b', 11); var hb2 = doc.splitTextToSize(s.headline, R - L - 16), hH2 = hb2.length * 5.1 + 8; fill(P.ink); rr(L, y, R - L, hH2, 3, 'F'); fill(P.acc); rr(L + 4, y + 4, 3, hH2 - 8, 1.5, 'F'); tc(WH); doc.text(hb2, L + 11, y + 6.8); y += hH2 + 6; }
      else { fnt('l', 12.5); var hn = doc.splitTextToSize(s.headline, R - L - 8); fill(P.acc); doc.rect(L, y - 1, 0.9, hn.length * 5.6 + 1.5, 'F'); tc(P.ink); doc.text(hn, L + 5, y + 3.6); y += hn.length * 5.6 + 7; }
    }

    /* --- stat tiles (KPIs) --- */
    if (s.kpis && s.kpis.length) {
      if (CL) {
        doc.autoTable({ startY: y, margin: { left: L, right: L }, theme: 'plain', styles: { fontSize: 8, cellPadding: 1.4, halign: 'center' }, body: [s.kpis.map(function (k) { return k.label.toUpperCase(); }), s.kpis.map(function (k) { return k.value; })],
          didParseCell: function (d) { if (d.row.index === 0) { d.cell.styles.textColor = P.muted; d.cell.styles.fontSize = 6.8; } else { d.cell.styles.fontStyle = 'bold'; d.cell.styles.fontSize = 11; d.cell.styles.textColor = P.ink; } } });
        y = doc.lastAutoTable.finalY + 4;
      } else {
        var kg = 3, kn = s.kpis.length, kw = (R - L - kg * (kn - 1)) / kn, kh = K === 'minimal' ? 20 : 21;
        need(kh + 4);
        s.kpis.forEach(function (k, i) {
          var x0 = L + i * (kw + kg), val = String(k.value == null ? '' : k.value), pct = /^\s*\d+(\.\d+)?%\s*$/.test(val) ? Math.max(0, Math.min(100, parseFloat(val))) : null, hero = K === 'bold' && i === 0;
          if (K === 'modern') { fill(WH); draw(P.line); doc.setLineWidth(0.25); rr(x0, y, kw, kh, 2.5, 'FD'); fill(P.acc); rr(x0 + 4, y - 0.01, kw - 8, 1.3, 0.6, 'F'); }
          else if (K === 'bold') { fill(hero ? P.acc : P.tint); rr(x0, y, kw, kh, 3, 'F'); }
          else if (i) { draw(P.line); doc.setLineWidth(0.25); doc.line(x0 - kg / 2, y + 1, x0 - kg / 2, y + kh - 1); }
          var tx = K === 'minimal' ? x0 + (i ? 2 : 0) : x0 + 4;
          fnt('b', 6); sp(0.4); tc(hero ? P.onAcc : P.muted); doc.text(doc.splitTextToSize(String(k.label).toUpperCase(), kw - 6)[0], tx, y + 6.2); sp(0);
          fnt(K === 'minimal' ? 'l' : 'x', K === 'minimal' ? 15 : 15.5); fitSize(val, kw - 7, K === 'minimal' ? 15 : 15.5, 8); tc(hero ? P.onAcc : K === 'bold' ? P.accD : P.ink); doc.text(val, tx, y + 13.8);
          if (pct != null) { var bw = kw - (K === 'minimal' ? 6 : 8); fill(hero ? mix(P.acc, WH, 0.45) : K === 'bold' ? WH : P.tint); rr(tx, y + kh - 4.6, bw, 1.7, 0.85, 'F'); fill(hero ? P.onAcc : P.acc); if (pct > 0) rr(tx, y + kh - 4.6, Math.max(1.7, bw * pct / 100), 1.7, 0.85, 'F'); }
        });
        y += kh + 7;
      }
    }

    /* --- the building blocks --- */
    var H2 = function (t) {
      need(15);
      if (CL) { fnt('b', 11.5); tc(P.ink); doc.text(t, L, y); draw(P.acc); doc.setLineWidth(0.5); doc.line(L, y + 1.5, R, y + 1.5); doc.setLineWidth(0.2); y += 6.5; return; }
      secN++; if (y > 30) { y += K === 'minimal' ? 2.5 : 3.5; need(12); }
      if (K === 'modern') { fill(P.acc); rr(L, y - 4.7, 7, 6.4, 1.8, 'F'); fnt('b', 8); tc(P.onAcc); doc.text(String(secN).length < 2 ? '0' + secN : String(secN), L + 3.5, y - 0.4, { align: 'center' }); fnt('b', 12); tc(P.ink); var tt = doc.splitTextToSize(t, R - L - 14)[0]; doc.text(tt, L + 10, y); var tw = doc.getTextWidth(tt); if (L + 14 + tw < R) { draw(P.line); doc.setLineWidth(0.3); doc.line(L + 13 + tw, y - 1.6, R, y - 1.6); } y += 7; return; }
      if (K === 'bold') { fill(P.ink); rr(L, y - 5.2, R - L, 7.8, 2, 'F'); fill(P.acc); rr(L, y - 5.2, 7.8, 7.8, 2, 'F'); doc.rect(L + 4, y - 5.2, 3.8, 7.8, 'F'); fnt('x', 9); tc(P.onAcc); doc.text(String(secN), L + 3.9, y - 0.1, { align: 'center' }); fnt('b', 10); tc(WH); sp(0.3); doc.text(doc.splitTextToSize(t.toUpperCase(), R - L - 16)[0], L + 11, y - 0.1); sp(0); y += 8; return; }
      fnt('b', 8.4); sp(1); tc(P.accD); doc.text(doc.splitTextToSize(t.toUpperCase(), R - L)[0], L, y); sp(0); draw(P.line); doc.setLineWidth(0.25); doc.line(L, y + 2.2, R, y + 2.2); y += 7.5;
    };
    var empty = function (t) { fnt('i', 9); tc(P.muted); doc.text(t, L, y); y += 6; };
    var dot = function (x0, y0) { if (CL) { doc.text('•', x0, y0); return; } fill(K === 'minimal' ? P.muted : P.acc); if (K === 'minimal') doc.rect(x0 + 0.2, y0 - 1.7, 1.1, 1.1, 'F'); else doc.circle(x0 + 0.8, y0 - 1.15, 0.85, 'F'); };
    var bullets = function (list, box) {
      fnt('n', 9.1); tc(P.text);
      var lines = []; list.slice(0, lim.pts).forEach(function (t) { doc.splitTextToSize(String(t), R - L - 10).forEach(function (ln, i) { lines.push([!i, ln]); }); });
      var lh = PO ? 4.6 : 4.4;
      if (box) { need(lines.length * lh + 7); fill(P.tint); draw(CL ? [254, 215, 170] : P.acc); doc.setLineWidth(CL ? 0.2 : 0.35); rr(L, y - 4, R - L, lines.length * lh + 5, 2.5, 'FD'); doc.setLineWidth(0.2); y += 0.5; }
      fnt('n', 9.1); tc(P.text);
      lines.forEach(function (ln) { need(5); if (ln[0]) dot(L + 2.5, y); tc(P.text); doc.text(ln[1], L + 6.5, y); y += lh; }); y += box ? 4 : 2.5;
    };
    var headFill = K === 'bold' ? P.acc : K === 'minimal' ? WH : P.ink, headText = K === 'bold' ? P.onAcc : K === 'minimal' ? P.accD : WH;
    var tblStyle = function (extra) { return Object.assign({ font: FAM, fontSize: PO ? 7.8 : 8.2, cellPadding: CL ? 1.5 : { top: 1.9, bottom: 1.9, left: 2, right: 2 }, overflow: 'linebreak', valign: 'top', textColor: P.text, lineColor: P.line, lineWidth: K === 'minimal' ? { bottom: 0.2 } : CL ? 0.1 : 0 }, extra || {}); };
    var table = function (t) {
      if (!t.rows.length) { empty(t.empty || 'Nothing to show.'); return; }
      var rows = t.rows.slice(0, lim.rows), more = t.rows.length - rows.length;
      doc.autoTable({ startY: y, margin: { left: L, right: L, top: 19 }, head: [t.head], body: rows.map(function (r) { return r.map(function (c) { return c && c.t != null ? c.t : c; }); }), theme: K === 'minimal' ? 'plain' : 'striped',
        styles: tblStyle(), headStyles: { fillColor: headFill, textColor: headText, fontSize: PO ? 7.4 : 8, fontStyle: 'bold', lineWidth: K === 'minimal' ? { bottom: 0.5 } : 0, lineColor: P.acc }, alternateRowStyles: { fillColor: K === 'minimal' ? WH : P.soft }, bodyStyles: { fillColor: WH }, columnStyles: t.cols || {},
        didParseCell: function (d) { if (d.section !== 'body') return; var c = rows[d.row.index][d.column.index]; if (c && c.rag) { d.cell.styles.fillColor = RAGF[c.rag]; d.cell.styles.textColor = 255; d.cell.styles.fontStyle = 'bold'; } if (c && c.fill) { d.cell.styles.fillColor = c.fill; d.cell.styles.textColor = P.ink; } if (c && c.center) d.cell.styles.halign = 'center'; if (c && c.b) d.cell.styles.fontStyle = 'bold'; } });
      y = doc.lastAutoTable.finalY + (more ? 1 : 6);
      if (more) { fnt('i', 8); tc(P.muted); doc.text('... and ' + more + ' more (see the project plan)', L, y + 3); y += 10; }
    };
    var para = function (txt) {   // text with line breaks; lines starting - or • become bullets
      fnt('n', 9.3); tc(P.text);
      String(txt || '').split(/\n/).forEach(function (raw) {
        var ln = raw.trim(); if (!ln) { y += 1.8; return; }
        var bl = /^[-•*]\s+/.test(ln), body = ln.replace(/^[-•*]\s+/, ''), parts = doc.splitTextToSize(body, R - L - (bl ? 8 : 0));
        parts.forEach(function (pt, i) { need(5); if (bl && !i) dot(L + 2, y); fnt('n', 9.3); tc(P.text); doc.text(pt, L + (bl ? 6 : 0), y); y += 4.6; });
      }); y += 2.5;
    };
    var kv = function (rows) {
      doc.autoTable({ startY: y, margin: { left: L, right: L, top: 19 }, body: rows, theme: K === 'minimal' ? 'plain' : 'grid', styles: tblStyle({ fontSize: PO ? 8.4 : 8.8, lineWidth: K === 'minimal' ? { bottom: 0.2 } : 0.15 }),
        columnStyles: { 0: { cellWidth: 46, fontStyle: 'bold', fillColor: K === 'minimal' ? WH : P.soft, textColor: K === 'minimal' ? P.accD : P.ink } } });
      y = doc.lastAutoTable.finalY + 6;
    };
    var sign = function (sec) {
      fnt('n', 9); tc(P.muted);
      if (sec.intro) { var it = doc.splitTextToSize(sec.intro, R - L); need(it.length * 4.3 + 3); doc.text(it, L, y); y += it.length * 4.3 + 2; }
      doc.autoTable({ startY: y, margin: { left: L, right: L, top: 19 }, head: [['Role', 'Name', 'Signature', 'Date']], body: sec.rows.map(function (r) { return [r.role, r.name || '', '', '']; }), theme: 'grid',
        styles: tblStyle({ fontSize: 9, cellPadding: 2.2, minCellHeight: 15, valign: 'middle', lineWidth: 0.2, lineColor: P.line }), headStyles: { fillColor: headFill, textColor: headText, fontSize: 8.5, minCellHeight: 7, fontStyle: 'bold' },
        columnStyles: { 0: { cellWidth: 46, fontStyle: 'bold' }, 1: { cellWidth: 48 }, 3: { cellWidth: 28 } }, rowPageBreak: 'avoid' });
      y = doc.lastAutoTable.finalY + 5;
    };
    s.sections.forEach(function (sec) {
      if (sec.kind === 'text') { if (!String(sec.text || '').trim() && !sec.always) return; if (sec.title) H2(sec.title); if (!String(sec.text || '').trim()) { empty(sec.empty || 'Not stated.'); return; } para(sec.text); return; }
      if (sec.kind === 'kv') { if (!sec.rows.length) return; if (sec.title) H2(sec.title); kv(sec.rows); return; }
      if (sec.kind === 'sign') { need(30); H2(sec.title); sign(sec); return; }
      if (sec.kind === 'gantt') {
        var g = gantt(s0, lim.gantt); if (!g) return;
        var pad = K === 'modern' || K === 'bold' ? 2.5 : 0, w = R - L - pad * 2, h = w * g.h / g.w, maxH = lim.ganttH; if (h > maxH) { w = w * maxH / h; h = maxH; }
        need(h + 16); H2(sec.title);
        if (pad) { fill(WH); draw(P.line); doc.setLineWidth(0.25); rr(L, y - 1, w + pad * 2, h + pad * 2, 3, 'FD'); }
        doc.addImage(g.jpg, 'JPEG', L + pad, y - 1 + pad, w, h); y += h + pad * 2 + 5; return;
      }
      if (sec.kind === 'bullets') { if (!sec.items.length && !sec.always) return; H2(sec.title); if (!sec.items.length) { empty(sec.empty || 'None.'); return; } bullets(sec.items, sec.box); return; }
      if (sec.kind === 'table') { if (!sec.rows.length && !sec.always) return; if (sec.title) H2(sec.title); table(sec); }
    });

    /* --- running header (pages 2+) and footer --- */
    var n = doc.getNumberOfPages(), foot = s.footer || (s.title + ' #' + s.no + '  ·  ' + s.project.name.slice(0, 70));
    for (var i = 1; i <= n; i++) {
      doc.setPage(i);
      if (i > 1 && K === 'modern') { fill(P.ink); doc.rect(0, 0, W, 9, 'F'); fill(P.acc); doc.rect(0, 9, W, 0.8, 'F'); fill(mix(P.acc, P.ink, 0.1)); doc.circle(W - 4, 1, 10, 'F'); fnt('b', 7); tc(P.onDark); doc.text(doc.splitTextToSize(s.title + '  ·  ' + s.project.name, 150)[0], L, 5.8); }
      if (i > 1 && K === 'bold') { fill(P.acc); doc.rect(0, 0, W, 8, 'F'); fill(P.ink); doc.triangle(150, 8, W, 0, W, 8, 'F'); fnt('b', 7); tc(P.onAcc); doc.text(doc.splitTextToSize(s.title.toUpperCase() + '  ·  ' + s.project.name, 125)[0], L, 5.3); }
      if (i > 1 && K === 'minimal') { fnt('b', 6.8); sp(0.8); tc(P.accD); doc.text(doc.splitTextToSize(s.title.toUpperCase(), 150)[0], L, 10); sp(0); draw(P.line); doc.setLineWidth(0.2); doc.line(L, 12.5, R, 12.5); }
      if (K === 'modern') { fill(P.acc); doc.rect(0, 294.6, W, 2.4, 'F'); fnt('n', 7); tc(P.muted); doc.text(foot, L, 290.6); fill(P.ink); rr(R - 16, 287.4, 16, 4.8, 2.4, 'F'); fnt('b', 6.8); tc(WH); doc.text(i + ' / ' + n, R - 8, 290.7, { align: 'center' }); }
      else if (K === 'bold') { fill(P.ink); doc.rect(0, 287, W, 10, 'F'); fill(P.acc); doc.rect(0, 287, 6, 10, 'F'); fnt('n', 7); tc(P.onDark); doc.text(foot, L, 293); fnt('b', 7.5); tc(WH); doc.text('PAGE ' + i + ' OF ' + n, R, 293, { align: 'right' }); }
      else if (K === 'minimal') { draw(P.line); doc.setLineWidth(0.2); doc.line(L, 286.5, R, 286.5); fnt('n', 7); tc(P.muted); doc.text(foot, L, 291); doc.text(i + ' / ' + n, R, 291, { align: 'right' }); }
      else { fnt('n', 7.5); tc(P.muted); doc.text(foot, L, 291); doc.text('Page ' + i + ' of ' + n, R, 291, { align: 'right' }); }
    }
    return doc;
  }
  var FULL = { rows: 999, pts: 99, gantt: 60, ganttH: 175 };
  var LIMITS = [{ rows: 14, pts: 7, gantt: 34, ganttH: 120 }, { rows: 10, pts: 6, gantt: 28, ganttH: 100 }, { rows: 7, pts: 5, gantt: 22, ganttH: 85 }, { rows: 5, pts: 4, gantt: 16, ganttH: 70 }, { rows: 3, pts: 3, gantt: 12, ganttH: 60 }];
  function stamp(s) { var P = lookOf(s); s.lookHex = { ink: '#' + P.hex.ink, accent: '#' + P.hex.acc, skin: P.skin }; return P; }   // the email takes the same colours
  function pdf(s) {
    var P = stamp(s);
    return libsPdf().then(function () { return P.skin === 'classic' ? null : libsFont().catch(function () { return null; }); }).then(function () {
      var doc, k = 0;
      if (s.full) { doc = pdfOnce(s, FULL); s.lim = -1; }   // the charter: everything, as many pages as it takes
      else { for (; k < LIMITS.length; k++) { doc = pdfOnce(s, LIMITS[k]); if (doc.getNumberOfPages() <= 4) break; } s.lim = Math.min(k, LIMITS.length - 1); }
      var blob = doc.output('blob'); return b64(blob).then(function (x) { return { blob: blob, base64: x, pages: doc.getNumberOfPages(), name: fname(s, 'pdf') }; });
    });
  }

  /* ---------- Word (the same look: colours, header, headings and tables per skin) ---------- */
  function docx(s) {
    var P = stamp(s), K = P.skin, X = P.hex;
    return libsDocx().then(function () {
      var D = window.docx, lim = s.lim === -1 || s.full ? FULL : LIMITS[s.lim || 0], F = K === 'classic' ? 'Arial' : K === 'minimal' ? 'Calibri Light' : 'Calibri', FH = K === 'classic' ? 'Arial' : 'Calibri', dark = X.ink, text = X.text, muted = X.muted;
      var T = function (t, o) { return new D.TextRun(Object.assign({ text: String(t == null ? '' : t), font: F, size: 19, color: text }, o || {})); };
      var P_ = function (runs, o) { return new D.Paragraph(Object.assign({ spacing: { after: 60 }, children: Array.isArray(runs) ? runs : [runs] }, o || {})); };
      var NB = { style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF' }, B = { style: D.BorderStyle.SINGLE, size: 2, color: X.line }, BB = { top: B, bottom: B, left: B, right: B }, NBB = { top: NB, bottom: NB, left: NB, right: NB };
      var LB = K === 'minimal' ? { top: NB, left: NB, right: NB, bottom: B } : K === 'classic' ? BB : { top: B, bottom: B, left: NB, right: NB };
      var TW = 10466;
      var cell = function (t, w, o) { o = o || {}; return new D.TableCell({ width: { size: w, type: D.WidthType.DXA }, borders: o.borders || LB, shading: o.fill ? { type: D.ShadingType.CLEAR, color: 'auto', fill: o.fill } : undefined, margins: { top: 60, bottom: 60, left: 90, right: 90 }, verticalAlign: D.VerticalAlign.CENTER,
        children: [P_(T(t, { bold: !!o.bold, color: o.color || text, size: o.size || 17, font: o.font || F }), { spacing: { after: 0 }, alignment: o.center ? D.AlignmentType.CENTER : D.AlignmentType.LEFT })] }); };
      var secN = 0;
      var H2 = function (t) {
        if (K === 'classic') return new D.Paragraph({ spacing: { before: 200, after: 80 }, border: { bottom: { style: D.BorderStyle.SINGLE, size: 8, color: X.acc, space: 2 } }, children: [T(t, { bold: true, size: 23, color: dark })] });
        secN++;
        if (K === 'bold') return new D.Paragraph({ spacing: { before: 240, after: 100 }, shading: { type: D.ShadingType.CLEAR, color: 'auto', fill: dark }, border: { left: { style: D.BorderStyle.SINGLE, size: 36, color: X.acc, space: 6 } }, children: [T(' ' + secN + '   ' + t.toUpperCase(), { bold: true, size: 20, color: 'FFFFFF', font: FH, characterSpacing: 10 })] });
        if (K === 'minimal') return new D.Paragraph({ spacing: { before: 260, after: 100 }, border: { bottom: { style: D.BorderStyle.SINGLE, size: 2, color: X.line, space: 3 } }, children: [T(t.toUpperCase(), { bold: true, size: 17, color: X.accD, font: FH, characterSpacing: 30 })] });
        return new D.Paragraph({ spacing: { before: 240, after: 100 }, children: [T((secN < 10 ? '0' : '') + secN + '  ', { bold: true, size: 24, color: X.acc, font: FH }), T(t, { bold: true, size: 25, color: dark, font: FH })] });
      };
      var kids = [], meta = s.headRight || [s.type + ' report  #' + s.no, s.periodText, 'Issued ' + dmy(s.date) + (s.project.ref ? '  ·  ' + s.project.ref : '')];
      var brand = s.brand || 'GKH PROJECT CHAMP', ov = s.rag && s.rag.overall && s.rag.overall.c;
      // the header block
      var hFill = K === 'bold' ? X.acc : K === 'minimal' ? undefined : dark, hTitle = K === 'bold' ? X.onAcc : K === 'minimal' ? dark : 'FFFFFF', hSub = K === 'minimal' ? muted : K === 'bold' ? X.onAcc : X.onDark, hBrand = K === 'minimal' ? X.accD : K === 'bold' ? X.onAcc : X.light;
      var hcell = function (w, kids2, fillC, align) { return new D.TableCell({ width: { size: w, type: D.WidthType.DXA }, shading: fillC ? { type: D.ShadingType.CLEAR, color: 'auto', fill: fillC } : undefined, borders: K === 'minimal' ? { top: NB, left: NB, right: NB, bottom: { style: D.BorderStyle.SINGLE, size: 12, color: X.acc } } : NBB, margins: { top: K === 'classic' ? 120 : 260, bottom: K === 'classic' ? 120 : 240, left: 200, right: 160 }, verticalAlign: D.VerticalAlign.CENTER, children: kids2 }); };
      kids.push(new D.Table({ width: { size: TW, type: D.WidthType.DXA }, columnWidths: [6766, 3700], rows: [new D.TableRow({ children: [
        hcell(6766, [P_(T(brand.toUpperCase(), { bold: true, color: hBrand, size: 15, characterSpacing: 30, font: FH })), P_(T(K === 'bold' ? s.title.toUpperCase() : s.title, { bold: K !== 'minimal', color: hTitle, size: K === 'classic' ? 32 : 40, font: K === 'minimal' ? 'Calibri Light' : FH })), P_(T(s.project.name, { color: hSub, size: 19 }), { spacing: { after: 0 } })], hFill),
        hcell(3700, meta.map(function (t) { return P_(T(t, { color: K === 'minimal' ? muted : K === 'bold' ? X.onAcc : 'FFFFFF', size: 16 }), { alignment: D.AlignmentType.RIGHT, spacing: { after: 20 } }); })
          .concat(ov && K !== 'classic' ? [P_(T('  ' + RAGN[ov] + '  ', { bold: true, color: 'FFFFFF', size: 18, shading: { type: D.ShadingType.CLEAR, color: 'auto', fill: RAGH[ov] } }), { alignment: D.AlignmentType.RIGHT, spacing: { before: 80, after: 0 } })] : []), K === 'bold' ? dark : hFill)] })] }));
      if (K === 'modern') kids.push(new D.Paragraph({ spacing: { after: 0 }, shading: { type: D.ShadingType.CLEAR, color: 'auto', fill: X.acc }, children: [T(' ', { size: 6 })] }));
      var rk = Object.keys(s.rag || {}), cw = Math.floor(TW / Math.max(1, rk.length)), cws = rk.map(function (k, i) { return i === rk.length - 1 ? TW - cw * (rk.length - 1) : cw; });
      kids.push(P_(T(''), { spacing: { after: 100 } }));
      var gridB = K === 'minimal' ? BB : { top: { style: D.BorderStyle.SINGLE, size: 12, color: 'FFFFFF' }, bottom: { style: D.BorderStyle.SINGLE, size: 12, color: 'FFFFFF' }, left: { style: D.BorderStyle.SINGLE, size: 12, color: 'FFFFFF' }, right: { style: D.BorderStyle.SINGLE, size: 12, color: 'FFFFFF' } };
      if (rk.length) kids.push(new D.Table({ width: { size: TW, type: D.WidthType.DXA }, columnWidths: cws, rows: [
        new D.TableRow({ children: rk.map(function (k, i) { return cell(String(s.rag[k].label).toUpperCase(), cws[i], { bold: true, fill: K === 'bold' ? RAGH[s.rag[k].c] : X.soft, color: K === 'bold' ? 'FFFFFF' : muted, center: true, size: 14, borders: K === 'classic' ? BB : gridB }); }) }),
        new D.TableRow({ children: rk.map(function (k, i) { return cell(RAGN[s.rag[k].c], cws[i], { bold: true, fill: RAGH[s.rag[k].c], color: 'FFFFFF', center: true, size: 19, borders: K === 'classic' ? BB : gridB }); }) }),
        new D.TableRow({ children: rk.map(function (k, i) { return cell(s.rag[k].note || '', cws[i], { color: K === 'bold' ? 'FFFFFF' : muted, fill: K === 'bold' ? RAGH[s.rag[k].c] : X.soft, center: true, size: 14, borders: K === 'classic' ? BB : gridB }); }) })] }));
      if (s.headline) kids.push(new D.Paragraph({ spacing: { before: 180, after: 120 }, indent: { left: 120, right: 120 }, shading: K === 'minimal' ? undefined : { type: D.ShadingType.CLEAR, color: 'auto', fill: K === 'bold' ? dark : X.tint }, border: { left: { style: D.BorderStyle.SINGLE, size: K === 'minimal' ? 12 : 30, color: X.acc, space: 8 } }, children: [T(s.headline, { bold: K !== 'minimal', size: K === 'minimal' ? 24 : 21, color: K === 'bold' ? 'FFFFFF' : dark })] }));
      if (s.kpis && s.kpis.length) { var kw = Math.floor(TW / s.kpis.length), kws = s.kpis.map(function (k, i) { return i === s.kpis.length - 1 ? TW - kw * (s.kpis.length - 1) : kw; });
        var kB = K === 'modern' ? { top: { style: D.BorderStyle.SINGLE, size: 18, color: X.acc }, bottom: B, left: { style: D.BorderStyle.SINGLE, size: 12, color: 'FFFFFF' }, right: { style: D.BorderStyle.SINGLE, size: 12, color: 'FFFFFF' } } : K === 'bold' ? gridB : K === 'minimal' ? NBB : BB;
        kids.push(new D.Table({ width: { size: TW, type: D.WidthType.DXA }, columnWidths: kws, rows: [new D.TableRow({ children: s.kpis.map(function (k, i) { var hero = K === 'bold' && i === 0; return new D.TableCell({ width: { size: kws[i], type: D.WidthType.DXA }, borders: kB, shading: K === 'bold' ? { type: D.ShadingType.CLEAR, color: 'auto', fill: hero ? X.acc : X.tint } : K === 'modern' ? { type: D.ShadingType.CLEAR, color: 'auto', fill: X.soft } : undefined, margins: { top: 90, bottom: 90, left: 100, right: 60 },
          children: [P_(T(String(k.label).toUpperCase(), { size: 13, color: hero ? X.onAcc : muted, bold: true }), { alignment: K === 'classic' ? D.AlignmentType.CENTER : D.AlignmentType.LEFT, spacing: { after: 20 } }), P_(T(k.value, { bold: K !== 'minimal', size: K === 'classic' ? 22 : 28, color: hero ? X.onAcc : K === 'bold' ? X.accD : dark, font: FH }), { alignment: K === 'classic' ? D.AlignmentType.CENTER : D.AlignmentType.LEFT, spacing: { after: 0 } })] }); }) })] })); }
      var wtext = function (txt) { String(txt || '').split(/\n/).forEach(function (raw) { var ln = raw.trim(); if (!ln) return; if (/^[-•*]\s+/.test(ln)) kids.push(new D.Paragraph({ numbering: { reference: 'dots', level: 0 }, spacing: { after: 40 }, children: [T(ln.replace(/^[-•*]\s+/, ''))] })); else kids.push(P_(T(ln), { spacing: { after: 80 } })); }); };
      var headFill = K === 'bold' ? X.acc : K === 'minimal' ? undefined : dark, headCol = K === 'bold' ? X.onAcc : K === 'minimal' ? X.accD : 'FFFFFF';
      s.sections.forEach(function (sec) {
        if (sec.kind === 'text') { if (!String(sec.text || '').trim() && !sec.always) return; if (sec.title) kids.push(H2(sec.title)); if (!String(sec.text || '').trim()) kids.push(P_(T(sec.empty || 'Not stated.', { italics: true, color: muted }))); else wtext(sec.text); return; }
        if (sec.kind === 'kv') { if (!sec.rows.length) return; if (sec.title) kids.push(H2(sec.title)); var c1 = 2900, c2 = TW - c1;
          kids.push(new D.Table({ width: { size: TW, type: D.WidthType.DXA }, columnWidths: [c1, c2], rows: sec.rows.map(function (r) { return new D.TableRow({ children: [cell(r[0], c1, { bold: true, fill: K === 'minimal' ? undefined : X.soft, color: K === 'minimal' ? X.accD : dark }), cell(r[1], c2)] }); }) })); return; }
        if (sec.kind === 'sign') { kids.push(H2(sec.title)); if (sec.intro) kids.push(P_(T(sec.intro, { color: muted, size: 17 }), { spacing: { after: 100 } }));
          var sw = [2900, 2900, 3000, 1666];
          kids.push(new D.Table({ width: { size: TW, type: D.WidthType.DXA }, columnWidths: sw, rows: [new D.TableRow({ tableHeader: true, children: ['Role', 'Name', 'Signature', 'Date'].map(function (h, i) { return cell(h, sw[i], { bold: true, fill: headFill || X.soft, color: headCol, borders: BB }); }) })]
            .concat(sec.rows.map(function (r) { return new D.TableRow({ height: { value: 820, rule: D.HeightRule.ATLEAST }, cantSplit: true, children: [cell(r.role, sw[0], { bold: true, borders: BB }), cell(r.name || '', sw[1], { borders: BB }), cell('', sw[2], { borders: BB }), cell('', sw[3], { borders: BB })] }); })) })); return; }
        if (sec.kind === 'gantt') { var g = gantt(s, lim.gantt); if (!g) return; var bin = atob(g.url.split(',')[1]), u8 = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
          var w = 680, h = Math.round(w * g.h / g.w), maxH = Math.round(lim.ganttH * 3.78); if (h > maxH) { w = Math.round(w * maxH / h); h = maxH; }
          kids.push(H2(sec.title)); kids.push(P_(new D.ImageRun({ type: 'png', data: u8, transformation: { width: w, height: h } }))); return; }
        if (sec.kind === 'bullets') { if (!sec.items.length && !sec.always) return; kids.push(H2(sec.title)); if (!sec.items.length) { kids.push(P_(T(sec.empty || 'None.', { italics: true, color: muted }))); return; }
          sec.items.slice(0, lim.pts).forEach(function (t) { kids.push(new D.Paragraph({ numbering: { reference: 'dots', level: 0 }, spacing: { after: 50 }, shading: sec.box ? { type: D.ShadingType.CLEAR, color: 'auto', fill: X.tint } : undefined, children: [T(t)] })); }); return; }
        if (sec.kind === 'table') { if (!sec.rows.length && !sec.always) return; if (sec.title) kids.push(H2(sec.title)); if (!sec.rows.length) { kids.push(P_(T(sec.empty || 'Nothing to show.', { italics: true, color: muted }))); return; }
          var rows = sec.rows.slice(0, lim.rows), more = sec.rows.length - rows.length, ws = sec.wordCols || sec.head.map(function () { return Math.floor(TW / sec.head.length); }), sum = ws.reduce(function (a, b) { return a + b; }, 0);
          ws = ws.map(function (x) { return Math.floor(x * TW / sum); }); ws[ws.length - 1] += TW - ws.reduce(function (a, b) { return a + b; }, 0);
          var hb = K === 'minimal' ? { top: NB, left: NB, right: NB, bottom: { style: D.BorderStyle.SINGLE, size: 10, color: X.acc } } : LB;
          kids.push(new D.Table({ width: { size: TW, type: D.WidthType.DXA }, columnWidths: ws, rows: [new D.TableRow({ tableHeader: true, children: sec.head.map(function (h, i) { return cell(h, ws[i], { bold: true, fill: headFill, color: headCol, size: 16, borders: hb }); }) })].concat(rows.map(function (r, ri) {
            return new D.TableRow({ children: r.map(function (c, i) { var o = c && c.rag ? { fill: RAGH[c.rag], color: 'FFFFFF', bold: true } : c && c.hex ? { fill: c.hex, bold: true, center: !!c.center } : { fill: ri % 2 && K !== 'minimal' ? X.soft : undefined, bold: !!(c && c.b) }; return cell(c && c.t != null ? c.t : c, ws[i], o); }) }); })) }));
          if (more) kids.push(P_(T('... and ' + more + ' more (see the project plan)', { italics: true, color: muted, size: 16 }))); }
      });
      var footRuns = [T((s.footer || (s.title + ' #' + s.no)) + '  ·  page ', { size: 14, color: muted }), new D.TextRun({ children: [D.PageNumber.CURRENT], font: F, size: 14, color: muted }), T(' of ', { size: 14, color: muted }), new D.TextRun({ children: [D.PageNumber.TOTAL_PAGES], font: F, size: 14, color: muted })];
      var doc = new D.Document({ creator: s.brand ? s.brand.replace(/\b(\w)(\w*)/g, function (m, a, b) { return a + b.toLowerCase(); }) : 'GKH Project Champ', title: s.title, numbering: { config: [{ reference: 'dots', levels: [{ level: 0, format: D.LevelFormat.BULLET, text: K === 'classic' ? '•' : K === 'minimal' ? '–' : '●', alignment: D.AlignmentType.LEFT, style: { run: { color: K === 'minimal' ? muted : X.acc }, paragraph: { indent: { left: 360, hanging: 260 } } } }] }] },
        sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 720, bottom: 720, left: 720, right: 720 } } },
          footers: { default: new D.Footer({ children: [new D.Paragraph({ alignment: D.AlignmentType.RIGHT, border: K === 'classic' ? undefined : { top: { style: D.BorderStyle.SINGLE, size: K === 'modern' ? 12 : 2, color: K === 'modern' ? X.acc : X.line, space: 4 } }, children: footRuns })] }) },
          children: kids }] });
      return D.Packer.toBlob(doc).then(function (blob) { return b64(blob).then(function (x) { return { blob: blob, base64: x, name: fname(s, 'docx') }; }); });
    });
  }
  function save(blob, name) { var url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 5000); }
  M.report = { pdf: pdf, docx: function (s) { return (s.lim == null ? pdf(s) : Promise.resolve()).then(function () { return docx(s); }); }, gantt: gantt, save: save, skins: function () { return SKINS.slice(); }, lookOf: lookOf };
})();
