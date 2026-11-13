/* GKH Project Champ: 🎨 Document studio. Designed documents (project charter, project management plan) as PDF (jsPDF)
   and Word (docx), made in the browser from one document model, in the Project Champ theme (black, gold, cream).
   Pages: cover, contents, part dividers, chapters with title bands, stat tiles, cards, call-outs, tables and charts.
   window.MBS.studio.pdf(doc) / .docx(doc) / .art() ; the content is built in admin-plan.js. */
(function () {
  'use strict';
  var M = window.MBS; if (!M) return;
  function load(src, test) { return test() ? Promise.resolve() : new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = function () { rej(new Error('Could not load ' + src.split('?')[0] + '. Check the connection and try again.')); }; document.head.appendChild(s); }); }
  var libsPdf = function () { return load('vendor/jspdf.umd.min.js?v=252', function () { return !!window.jspdf; }).then(function () { return load('vendor/jspdf.plugin.autotable.min.js?v=384', function () { return !!(window.jspdf && window.jspdf.jsPDF.API.autoTable); }); }).then(function () { return load('vendor/poppins.js?v=1', function () { return !!window.CHAMP_FONTS; }); }); };
  var libsDocx = function () { return load('vendor/docx.iife.js?v=951', function () { return !!window.docx; }); };

  // the theme (Project Champ): ink, gold, cream, with emerald and slate for charts
  var C = { ink: [12, 11, 8], ink2: [26, 23, 15], gold: [201, 162, 39], gold2: [232, 192, 74], goldD: [138, 106, 0], cream: [251, 248, 236], cream2: [241, 238, 230], line: [227, 221, 208],
    text: [31, 29, 24], muted: [107, 102, 90], white: [255, 255, 255], em: [5, 150, 105], slate: [71, 85, 105], red: [185, 28, 28], amber: [217, 119, 6], green: [21, 128, 61], tint: [255, 248, 225] };
  var HEX = function (c) { return c.map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join('').toUpperCase(); };
  var CSS = function (c, a) { return 'rgba(' + c.join(',') + ',' + (a == null ? 1 : a) + ')'; };
  var RAG = { G: C.green, A: C.amber, R: C.red };
  var PAL = [C.gold, C.em, C.slate, C.goldD, [14, 116, 144], [124, 58, 237], [190, 18, 60], C.gold2];
  // text the fonts can draw (Poppins Latin): arrows, ticks and emoji replaced
  var clean = function (s) { return String(s == null ? '' : s).replace(/→/g, 'to').replace(/[✓✔]/g, '').replace(/☐/g, '[ ]').replace(/[←↑↓]/g, '').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '').replace(/[ \t]{2,}/g, ' ').replace(/^\s+|\s+$/g, ''); };
  var b64 = function (blob) { return new Promise(function (res) { var r = new FileReader(); r.onload = function () { res(String(r.result).replace(/^data:[^,]*,/, '')); }; r.readAsDataURL(blob); }); };
  var u8 = function (dataUrl) { var bin = atob(dataUrl.split(',')[1]), a = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; };

  /* ---------- artwork (canvas): cover, part dividers, bands ---------- */
  function rnd(seed) { var s = seed || 7; return function () { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }
  function art(kind, w, h, seed) {
    var c = document.createElement('canvas'); c.width = w; c.height = h; var x = c.getContext('2d'), R = rnd(seed || 11);
    var g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#0C0B08'); g.addColorStop(0.55, '#17140C'); g.addColorStop(1, '#2A2310'); x.fillStyle = g; x.fillRect(0, 0, w, h);
    var glow = function (cx, cy, r, col, a) { var q = x.createRadialGradient(cx, cy, 0, cx, cy, r); q.addColorStop(0, CSS(col, a)); q.addColorStop(1, CSS(col, 0)); x.fillStyle = q; x.fillRect(0, 0, w, h); };
    glow(w * 0.85, h * 0.12, w * 0.75, C.gold, 0.30); glow(w * 0.05, h * 0.95, w * 0.7, C.em, 0.16); glow(w * 0.5, h * 0.55, w * 0.5, C.gold2, 0.06);
    // a faint planning grid
    x.strokeStyle = CSS(C.gold, 0.07); x.lineWidth = Math.max(1, w / 900);
    var step = w / 18; for (var gx = 0; gx < w; gx += step) { x.beginPath(); x.moveTo(gx, 0); x.lineTo(gx, h); x.stroke(); }
    // abstract Gantt bars drifting across
    var rows = kind === 'band' ? 4 : kind === 'divider' ? 16 : 22, rh = h / (rows + 2);
    for (var i = 0; i < rows; i++) {
      var y = rh * (i + 1), x0 = w * (0.1 + R() * 0.55), bw = w * (0.12 + R() * 0.38), col = R() < 0.7 ? C.gold : R() < 0.5 ? C.em : C.gold2, a = 0.08 + R() * (kind === 'band' ? 0.25 : 0.22);
      x.fillStyle = CSS(col, a); var r = rh * 0.28; x.beginPath(); x.moveTo(x0 + r, y); x.arcTo(x0 + bw, y, x0 + bw, y + rh * 0.56, r); x.arcTo(x0 + bw, y + rh * 0.56, x0, y + rh * 0.56, r); x.arcTo(x0, y + rh * 0.56, x0, y, r); x.arcTo(x0, y, x0 + bw, y, r); x.fill();
      if (R() < 0.35) { x.fillStyle = CSS(C.gold2, 0.5); var mx = x0 + bw + rh * 0.6, my = y + rh * 0.28, d = rh * 0.26; x.beginPath(); x.moveTo(mx, my - d); x.lineTo(mx + d, my); x.lineTo(mx, my + d); x.lineTo(mx - d, my); x.fill(); }
    }
    // a sweeping critical-path curve
    x.strokeStyle = CSS(C.gold2, kind === 'band' ? 0.35 : 0.55); x.lineWidth = Math.max(2, w / 360); x.beginPath(); x.moveTo(-w * 0.05, h * 0.82); x.bezierCurveTo(w * 0.3, h * 0.55, w * 0.55, h * 0.95, w * 1.05, h * 0.35); x.stroke();
    x.strokeStyle = CSS(C.gold, 0.18); x.lineWidth = Math.max(1, w / 900); x.beginPath(); x.moveTo(-w * 0.05, h * 0.9); x.bezierCurveTo(w * 0.35, h * 0.62, w * 0.6, h * 1.02, w * 1.05, h * 0.45); x.stroke();
    // rings
    x.strokeStyle = CSS(C.gold, 0.22); x.lineWidth = Math.max(1, w / 700); [0.18, 0.26, 0.34].forEach(function (k) { x.beginPath(); x.arc(w * 0.86, h * 0.18, w * k, 0, Math.PI * 2); x.stroke(); });
    return { url: c.toDataURL('image/jpeg', 0.86), png: c.toDataURL('image/png'), w: w, h: h };
  }

  /* ---------- charts (canvas, shared by PDF and Word) ---------- */
  function chart(b) {
    var W = 1600, H = b.kind === 'gantt' ? 0 : b.kind === 'heat' ? 900 : 760, c, x;
    var mk = function (h) { c = document.createElement('canvas'); c.width = W; c.height = h; x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, W, h); x.textBaseline = 'middle'; };
    var font = function (s, wgt) { x.font = (wgt || 400) + ' ' + s + 'px Poppins, Arial, sans-serif'; };
    var money = function (v) { return '$' + (Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + 'm' : Math.abs(v) >= 1e3 ? Math.round(v / 1e3) + 'k' : Math.round(v)); };
    var d = b.data || {};
    if (b.kind === 'bar') {   // horizontal bars: label, value
      var L = (d.items || []).slice(0, 12); H = Math.max(260, 70 + L.length * 64); mk(H);
      var max = Math.max.apply(null, L.map(function (i) { return i.v; }).concat([1])), lx = 520, bw = W - lx - 220;
      L.forEach(function (it, k) { var y = 40 + k * 64; font(26, 500); x.fillStyle = '#1F1D18'; var lab = clean(it.l); while (x.measureText(lab).width > lx - 40 && lab.length > 4) lab = lab.slice(0, -2); x.fillText(lab === clean(it.l) ? lab : lab + '…', 20, y + 22);
        x.fillStyle = '#F1EEE6'; x.fillRect(lx, y + 4, bw, 36); var col = it.c || PAL[k % PAL.length]; var gr = x.createLinearGradient(lx, 0, lx + bw, 0); gr.addColorStop(0, CSS(col)); gr.addColorStop(1, CSS(col, 0.75)); x.fillStyle = gr; x.fillRect(lx, y + 4, Math.max(4, bw * it.v / max), 36);
        font(26, 600); x.fillStyle = '#1F1D18'; x.fillText(it.t || money(it.v), lx + Math.max(4, bw * it.v / max) + 14, y + 22); });
    } else if (b.kind === 'donut') {
      var I = (d.items || []).filter(function (i) { return i.v > 0; }), tot = I.reduce(function (a, i) { return a + i.v; }, 0) || 1; mk(H);
      var cx = 380, cy = H / 2, r = 300, a0 = -Math.PI / 2;
      I.forEach(function (it, k) { var a1 = a0 + Math.PI * 2 * it.v / tot; x.beginPath(); x.moveTo(cx, cy); x.arc(cx, cy, r, a0, a1); x.closePath(); x.fillStyle = CSS(it.c || PAL[k % PAL.length]); x.fill(); a0 = a1; });
      x.beginPath(); x.arc(cx, cy, r * 0.58, 0, Math.PI * 2); x.fillStyle = '#fff'; x.fill();
      font(30, 400); x.fillStyle = '#6B665A'; x.textAlign = 'center'; x.fillText(d.centerLabel || 'Total', cx, cy - 34); font(56, 800); x.fillStyle = '#0C0B08'; x.fillText(d.center || money(tot), cx, cy + 26); x.textAlign = 'left';
      I.forEach(function (it, k) { var y = cy - (I.length * 76) / 2 + k * 76 + 30; x.fillStyle = CSS(it.c || PAL[k % PAL.length]); x.beginPath(); x.arc(840, y, 18, 0, Math.PI * 2); x.fill();
        font(30, 600); x.fillStyle = '#1F1D18'; x.fillText(clean(it.l), 880, y - 12); font(26, 400); x.fillStyle = '#6B665A'; x.fillText((it.t || money(it.v)) + '  ·  ' + Math.round(it.v / tot * 100) + '%', 880, y + 22); });
    } else if (b.kind === 'scurve') {   // monthly bars + cumulative line
      var P = d.points || []; mk(H); var l = 150, r2 = W - 60, t = 60, bt = H - 110, n = Math.max(1, P.length), cum = 0, cm = [];
      P.forEach(function (p) { cum += p.v; cm.push(cum); }); var top = Math.max(cum, 1), topM = Math.max.apply(null, P.map(function (p) { return p.v; }).concat([1]));
      font(22, 400); x.fillStyle = '#6B665A'; for (var g = 0; g <= 4; g++) { var gy = bt - (bt - t) * g / 4; x.strokeStyle = '#EEE9DC'; x.beginPath(); x.moveTo(l, gy); x.lineTo(r2, gy); x.stroke(); x.textAlign = 'right'; x.fillText(money(top * g / 4), l - 14, gy); x.textAlign = 'left'; }
      var bwid = (r2 - l) / n;
      P.forEach(function (p, k) { var bh = (bt - t) * 0.45 * p.v / topM; x.fillStyle = CSS(C.gold, 0.35); x.fillRect(l + k * bwid + bwid * 0.18, bt - bh, bwid * 0.64, bh);
        if (n <= 18 || k % Math.ceil(n / 18) === 0) { font(20, 500); x.fillStyle = '#4B4739'; x.textAlign = 'center'; x.fillText(p.l, l + k * bwid + bwid / 2, bt + 30); x.textAlign = 'left'; } });
      x.strokeStyle = CSS(C.ink); x.lineWidth = 6; x.beginPath(); cm.forEach(function (v, k) { var px = l + k * bwid + bwid / 2, py = bt - (bt - t) * v / top; if (k) x.lineTo(px, py); else x.moveTo(px, py); }); x.stroke();
      cm.forEach(function (v, k) { var px = l + k * bwid + bwid / 2, py = bt - (bt - t) * v / top; x.fillStyle = CSS(C.gold); x.beginPath(); x.arc(px, py, 9, 0, Math.PI * 2); x.fill(); });
      font(22, 500); x.fillStyle = CSS(C.goldD); x.fillRect(l, H - 46, 26, 18); x.fillStyle = '#4B4739'; x.fillText('Spend in the month', l + 36, H - 37); x.fillStyle = CSS(C.ink); x.fillRect(l + 330, H - 40, 40, 6); x.fillStyle = '#4B4739'; x.fillText('Cumulative (S-curve)', l + 380, H - 37);
    } else if (b.kind === 'heat') {   // risk heat map 5×5 with counts
      mk(H); var cell = 140, ox = 260, oy = 60, cnt = d.cells || {};
      for (var pr = 5; pr >= 1; pr--) for (var im = 1; im <= 5; im++) { var sc = pr * im, cx2 = ox + (im - 1) * cell, cy2 = oy + (5 - pr) * cell;
        x.fillStyle = sc >= 15 ? '#FCA5A5' : sc >= 8 ? '#FCD34D' : '#86EFAC'; x.fillRect(cx2 + 4, cy2 + 4, cell - 8, cell - 8);
        var k2 = pr + 'x' + im; if (cnt[k2]) { x.fillStyle = '#0C0B08'; x.beginPath(); x.arc(cx2 + cell / 2, cy2 + cell / 2, 38, 0, Math.PI * 2); x.fill(); font(36, 800); x.fillStyle = CSS(C.gold2); x.textAlign = 'center'; x.fillText(String(cnt[k2]), cx2 + cell / 2, cy2 + cell / 2 + 2); x.textAlign = 'left'; } }
      font(26, 600); x.fillStyle = '#1F1D18'; x.save(); x.translate(150, oy + cell * 2.5); x.rotate(-Math.PI / 2); x.textAlign = 'center'; x.fillText('Probability', 0, 0); x.restore();
      x.textAlign = 'center'; x.fillText('Impact', ox + cell * 2.5, oy + cell * 5 + 50); font(22, 400); for (var q = 1; q <= 5; q++) { x.fillText(String(q), ox + (q - 1) * cell + cell / 2, oy + cell * 5 + 16); x.fillText(String(6 - q), ox - 26, oy + (q - 1) * cell + cell / 2); } x.textAlign = 'left';
      var lx2 = ox + cell * 5 + 80; [['#FCA5A5', 'High (15 to 25)'], ['#FCD34D', 'Medium (8 to 14)'], ['#86EFAC', 'Low (1 to 7)']].forEach(function (z, k) { x.fillStyle = z[0]; x.fillRect(lx2, oy + 40 + k * 70, 44, 44); font(26, 500); x.fillStyle = '#1F1D18'; x.fillText(z[1], lx2 + 64, oy + 62 + k * 70); });
      font(24, 400); x.fillStyle = '#6B665A'; x.fillText('Number in a circle = open risks', lx2, oy + 300);
    } else if (b.kind === 'gantt' && M.report && M.report.gantt) { var g2 = M.report.gantt({ gantt: d }, b.max || 40); return g2 ? { url: g2.jpg, png: g2.url, w: g2.w, h: g2.h } : null; }
    else { mk(200); }
    return { url: c.toDataURL('image/jpeg', 0.9), png: c.toDataURL('image/png'), w: W, h: c.height };
  }

  function cellOf(c) { return c && typeof c === 'object' ? c : { t: c }; }
  /* ---------- inline **bold** text ---------- */
  function runs(s) { var out = [], parts = String(clean(s)).split(/(\*\*[^*]+\*\*)/); parts.forEach(function (p) { if (!p) return; var b = /^\*\*[^*]+\*\*$/.test(p); out.push({ t: b ? p.slice(2, -2) : p, b: b }); }); return out; }
  function paras(text) {   // markdown-lite: "## " headings, "- " bullets, "1. " numbers, blank lines
    var L = []; String(text || '').split(/\n/).forEach(function (raw) { var ln = raw.replace(/\s+$/, ''); if (!ln.trim()) return;
      if (/^#{1,4}\s+/.test(ln)) L.push({ k: 'h', t: ln.replace(/^#+\s+/, '') });
      else if (/^\s*[-•*]\s+/.test(ln)) L.push({ k: 'li', t: ln.replace(/^\s*[-•*]\s+/, '') });
      else if (/^\s*\d+[.)]\s+/.test(ln)) L.push({ k: 'ol', n: ln.match(/^\s*(\d+)/)[1], t: ln.replace(/^\s*\d+[.)]\s+/, '') });
      else L.push({ k: 'p', t: ln.trim() }); }); return L;
  }

  /* ---------- PDF ---------- */
  var PW = 210, PH = 297, ML = 17, MR = 17, CW = PW - ML - MR, TOP = 22, BOT = 278;
  function pdfDoc(D, tocPages) {
    var J = window.jspdf.jsPDF, doc = new J({ unit: 'mm', format: 'a4', compress: true }), F = window.CHAMP_FONTS;
    [['Poppins-Regular', 'Poppins', 'normal'], ['Poppins-SemiBold', 'Poppins', 'bold'], ['Poppins-ExtraBold', 'PoppinsX', 'normal'], ['Poppins-Light', 'PoppinsL', 'normal']].forEach(function (f) { doc.addFileToVFS(f[0] + '.ttf', F[f[0]]); doc.addFont(f[0] + '.ttf', f[1], f[2]); });
    var fnt = function (w, size) { if (w === 'x') doc.setFont('PoppinsX', 'normal'); else if (w === 'l') doc.setFont('PoppinsL', 'normal'); else doc.setFont('Poppins', w === 'b' ? 'bold' : 'normal'); doc.setFontSize(size); };
    var col = function (c) { doc.setTextColor(c[0], c[1], c[2]); }, fill = function (c) { doc.setFillColor(c[0], c[1], c[2]); }, stroke = function (c) { doc.setDrawColor(c[0], c[1], c[2]); };
    var y = TOP, chap = null, toc = [], kinds = {}, chapAt = {}, pageNo = function () { return doc.getNumberOfPages(); };
    var ART = D._art;
    function footer(n) {
      stroke(C.line); doc.setLineWidth(0.25); doc.line(ML, 286, PW - MR, 286);
      fnt('r', 7); col(C.muted); doc.text(clean(D.footer || D.title), ML, 291);
      fill(C.ink); doc.circle(PW - MR - 3.2, 290.2, 3.4, 'F'); fnt('b', 7); col(C.gold2); doc.text(String(n), PW - MR - 3.2, 291.3, { align: 'center' });
    }
    function contHead(chap) {   // continuation pages: a slim band
      fill(C.ink); doc.rect(0, 0, PW, 11, 'F'); fill(C.gold); doc.rect(0, 11, PW, 0.6, 'F');
      fnt('b', 7); col(C.gold2); doc.text(clean((chap && chap.no ? chap.no + '  ' : '') + (chap ? chap.title : D.title)).toUpperCase(), ML, 7);
      fnt('r', 7); col([200, 194, 178]); doc.text(clean(D.short || D.title), PW - MR, 7, { align: 'right' });
    }
    function newPage(cont) { doc.addPage(); y = TOP; chapAt[pageNo()] = chap; if (cont) { kinds[pageNo()] = 'cont'; contHead(chap); } }
    var need = function (h) { if (y + h > BOT) { newPage(true); y = 20; } };

    // ----- cover -----
    function cover() {
      kinds[1] = D.cover === 'band' ? 'hero' : 'cover';
      if (D.cover === 'band') {   // compact: a hero band on page 1 (for the 4-page charter)
        doc.addImage(ART.band.url, 'JPEG', 0, 0, PW, 64); fill(C.gold); doc.rect(0, 64, PW, 0.8, 'F');
        fnt('b', 7.5); col(C.gold2); doc.text(clean(D.brand || 'GKH PROJECT CHAMP').toUpperCase(), ML, 12);
        pill(clean(D.kicker || ''), ML, 18, C.gold, C.ink);
        fnt('x', 22); col(C.white); var tl = doc.splitTextToSize(clean(D.title), CW - 40); doc.text(tl.slice(0, 2), ML, 36);
        fnt('r', 9); col([230, 224, 205]); doc.text(doc.splitTextToSize(clean(D.subtitle || ''), CW)[0] || '', ML, 36 + tl.slice(0, 2).length * 8 + 1);
        fnt('r', 7.5); col([215, 208, 190]); (D.headRight || []).forEach(function (t, i) { doc.text(clean(t), PW - MR, 12 + i * 4.2, { align: 'right' }); });
        y = 72; if (D.stats && D.stats.length) { stats(D.stats); y += 2; }
        return;
      }
      doc.addImage(ART.cover.url, 'JPEG', 0, 0, PW, PH);
      fnt('b', 8); col(C.gold2); doc.text(clean(D.brand || 'GKH PROJECT CHAMP').toUpperCase(), ML, 18, { charSpace: 1.2 });
      fnt('r', 7.5); col([215, 208, 190]); (D.headRight || []).forEach(function (t, i) { doc.text(clean(t), PW - MR, 18 + i * 4.2, { align: 'right' }); });
      pill(clean(D.kicker || 'PROJECT DOCUMENT'), ML, 92, C.gold, C.ink);
      fnt('x', 34); col(C.white); var tl = doc.splitTextToSize(clean(D.title), CW); doc.text(tl.slice(0, 3), ML, 112, { lineHeightFactor: 1.08 });
      var ty = 112 + tl.slice(0, 3).length * 13; fill(C.gold); doc.rect(ML, ty - 4, 26, 1.4, 'F');
      fnt('l', 12); col([236, 230, 212]); doc.text(doc.splitTextToSize(clean(D.subtitle || ''), CW - 20).slice(0, 3), ML, ty + 6);
      // meta grid
      var my = 200, cw = CW / 3; (D.meta || []).slice(0, 6).forEach(function (m, i) { var mx = ML + (i % 3) * cw, yy = my + Math.floor(i / 3) * 15;
        fnt('b', 6.5); col(C.gold2); doc.text(clean(m[0]).toUpperCase(), mx, yy, { charSpace: 0.6 }); fnt('r', 9.5); col(C.white); doc.text(doc.splitTextToSize(clean(m[1]), cw - 6)[0] || '', mx, yy + 5); });
      // stat tiles
      var st = (D.stats || []).slice(0, 4), sw = (CW - (st.length - 1) * 4) / Math.max(1, st.length);
      st.forEach(function (s, i) { var sx = ML + i * (sw + 4), sy = 238; doc.setGState(new doc.GState({ opacity: 0.88 })); fill([20, 18, 12]); doc.roundedRect(sx, sy, sw, 26, 2.5, 2.5, 'F'); doc.setGState(new doc.GState({ opacity: 1 }));
        stroke(C.gold); doc.setLineWidth(0.35); doc.roundedRect(sx, sy, sw, 26, 2.5, 2.5, 'S');
        fnt('x', 15); col(C.gold2); doc.text(clean(s.v), sx + 5, sy + 12); fnt('b', 6.5); col([215, 208, 190]); doc.text(doc.splitTextToSize(clean(s.l).toUpperCase(), sw - 8).slice(0, 2), sx + 5, sy + 18.5); });
      fnt('r', 7); col([180, 172, 152]); doc.text(clean(D.coverNote || ''), ML, 284);
    }
    function pill(t, x, yy, bg, fg) { if (!t) return; fnt('b', 7); var w = doc.getTextWidth(t.toUpperCase()) + 8 + t.length * 0.25; fill(bg); doc.roundedRect(x, yy - 4.2, w, 6.4, 3.2, 3.2, 'F'); col(fg); doc.text(t.toUpperCase(), x + 4, yy, { charSpace: 0.25 }); return w; }

    // ----- contents -----
    function contents() {
      newPage(false); kinds[pageNo()] = 'toc'; fill(C.ink); doc.rect(0, 0, PW, 46, 'F'); doc.addImage(ART.band.url, 'JPEG', 0, 0, PW, 46); fill(C.gold); doc.rect(0, 46, PW, 0.8, 'F');
      pill('Inside this plan', ML, 18, C.gold, C.ink); fnt('x', 24); col(C.white); doc.text('Contents', ML, 34);
      var yy = 62, items = tocPages || [];
      (D.chapters || []).forEach(function (ch, i) {
        if (ch.part) { yy += 1.5; fnt('b', 7.5); col(C.goldD); doc.text(clean(ch.part).toUpperCase(), ML, yy, { charSpace: 0.8 }); yy += 6; }
        if (ch.divider) return;
        var pg = (items.filter(function (t) { return t.id === i; })[0] || {}).page;
        fill(C.ink); doc.circle(ML + 3.6, yy - 1.4, 3.6, 'F'); fnt('b', 7.5); col(C.gold2); doc.text(String(ch.no || ''), ML + 3.6, yy - 0.2, { align: 'center' });
        fnt('b', 10.5); col(C.text); var t = clean(ch.title); doc.text(t, ML + 11, yy); var tw = doc.getTextWidth(t);
        stroke(C.line); doc.setLineDash([0.5, 1.2], 0); doc.setLineWidth(0.3); doc.line(ML + 13 + tw, yy - 0.6, PW - MR - 9, yy - 0.6); doc.setLineDash([], 0);
        fnt('b', 10.5); col(C.goldD); doc.text(pg ? String(pg) : '', PW - MR, yy, { align: 'right' });
        if (ch.blurb) { fnt('r', 7.5); col(C.muted); doc.text(doc.splitTextToSize(clean(ch.blurb), CW - 20)[0], ML + 11, yy + 4.2); yy += 4.2; }
        yy += 8.2; if (yy > 270) { newPage(false); kinds[pageNo()] = 'toc'; yy = 24; }
      });
    }

    // ----- part divider (full page) -----
    function divider(ch) {
      newPage(false); kinds[pageNo()] = 'divider'; doc.addImage(ART.divider.url, 'JPEG', 0, 0, PW, PH);
      fnt('x', 80); col([60, 50, 20]); doc.text(String(ch.partNo || ''), PW - MR, 110, { align: 'right' });
      pill(clean(ch.part || 'Part'), ML, 120, C.gold, C.ink); fnt('x', 32); col(C.white); var tl = doc.splitTextToSize(clean(ch.title), CW - 10); doc.text(tl, ML, 138, { lineHeightFactor: 1.08 });
      var yy = 140 + tl.length * 12; fill(C.gold); doc.rect(ML, yy - 4, 26, 1.4, 'F');
      if (ch.blurb) { fnt('l', 11); col([236, 230, 212]); var bl = doc.splitTextToSize(clean(ch.blurb), CW - 30); doc.text(bl, ML, yy + 6); yy += 8 + bl.length * 5.5; }
      (ch.list || []).forEach(function (t, i) { fnt('b', 9.5); col(C.gold2); doc.text(String(t[0]), ML, yy + 10 + i * 8); fnt('r', 9.5); col(C.white); doc.text(clean(t[1]), ML + 9, yy + 10 + i * 8); });
      fnt('r', 7); col([180, 172, 152]); doc.text(clean(D.footer || D.title), ML, 290); fnt('b', 7); col(C.gold2); doc.text(String(pageNo()), PW - MR, 290, { align: 'right' });
    }

    // ----- chapter header band -----
    function chapterHead(ch) {
      if (D.flow) {   // compact documents (the charter): sections run on, each with a slim black title bar
        need(34); if (y > 30) y += 2; chap = ch; if (!chapAt[pageNo()]) chapAt[pageNo()] = ch; toc.push({ id: ch._i, page: pageNo() });
        fill(C.ink); doc.roundedRect(ML, y, CW, 9.5, 2.2, 2.2, 'F'); fill(C.gold); doc.roundedRect(ML, y, 13, 9.5, 2.2, 2.2, 'F'); doc.rect(ML + 9, y, 4, 9.5, 'F');
        fnt('x', 10); col(C.ink); doc.text(String(ch.no || '').padStart(2, '0'), ML + 6.5, y + 6.6, { align: 'center' });
        fnt('b', 10.5); col(C.white); doc.text(clean(ch.title), ML + 17, y + 6.5);
        if (ch.kicker) { fnt('b', 6.5); col(C.gold2); doc.text(clean(ch.kicker).toUpperCase(), PW - MR - 4, y + 6.2, { align: 'right', charSpace: 0.4 }); }
        y += 15; if (ch.lead) { fnt('l', 9.5); col(C.text); var l2 = doc.splitTextToSize(clean(ch.lead), CW); need(l2.length * 4.4); doc.text(l2, ML, y); y += l2.length * 4.4 + 2; }
        return;
      }
      need(70);
      if (y > TOP + 2 || pageNo() === 1) { newPage(false); }
      chap = ch; chapAt[pageNo()] = ch; kinds[pageNo()] = 'chapter'; toc.push({ id: ch._i, page: pageNo() });
      doc.addImage(ART.band.url, 'JPEG', 0, 0, PW, 40); fill(C.gold); doc.rect(0, 40, PW, 0.8, 'F');
      fnt('x', 46); col([70, 58, 22]); doc.text(String(ch.no || '').padStart(2, '0'), PW - MR, 33, { align: 'right' });
      pill(clean(ch.kicker || D.short || ''), ML, 15, C.gold, C.ink);
      fnt('x', 20); col(C.white); var tl = doc.splitTextToSize(clean(ch.title), CW - 34); doc.text(tl.slice(0, 2), ML, tl.length > 1 ? 26 : 30, { lineHeightFactor: 1.05 });
      y = 50;
      if (ch.lead) { fnt('l', 10.5); col(C.text); var ll = doc.splitTextToSize(clean(ch.lead), CW); doc.text(ll, ML, y); y += ll.length * 4.9 + 3; }
    }

    // ----- blocks -----
    function rich(text, x0, width, size, color, lineH) {   // wraps runs with bold, returns height
      var words = []; runs(text).forEach(function (r) { r.t.split(/(\s+)/).forEach(function (w) { if (w) words.push({ t: w, b: r.b }); }); });
      var lines = [[]], lw = 0, sp;
      words.forEach(function (w) { fnt(w.b ? 'b' : 'r', size); var ww = doc.getTextWidth(w.t); if (/^\s+$/.test(w.t)) { if (lw) { lines[lines.length - 1].push(w); lw += ww; } return; }
        if (lw + ww > width && lw > 0) { var last = lines[lines.length - 1]; while (last.length && /^\s+$/.test(last[last.length - 1].t)) last.pop(); lines.push([]); lw = 0; } lines[lines.length - 1].push(w); lw += ww; });
      var lh = lineH || size * 0.43; lines.forEach(function (ln) { need(lh + 0.5); var xx = x0; ln.forEach(function (w) { fnt(w.b ? 'b' : 'r', size); col(w.b ? C.ink : color || C.text); doc.text(w.t, xx, y); xx += doc.getTextWidth(w.t); }); y += lh; });
      return lines.length * lh;
    }
    function text(b) {
      paras(b.text).forEach(function (p) {
        if (p.k === 'h') { need(12); y += 2; fnt('b', 11); col(C.ink); doc.text(clean(p.t), ML, y); y += 1.6; fill(C.gold); doc.rect(ML, y, 10, 0.7, 'F'); y += 4.6; return; }
        if (p.k === 'li' || p.k === 'ol') { need(6); if (p.k === 'li') { fill(C.gold); doc.circle(ML + 1.6, y - 1.2, 0.95, 'F'); } else { fnt('b', 8.6); col(C.goldD); doc.text(p.n + '.', ML, y); }
          rich(p.t, ML + 5.5, CW - 5.5, b.size || 9, C.text); y += 1.2; return; }
        need(8); rich(p.t, ML, CW, b.size || 9, C.text); y += 2.4;
      });
      y += 1;
    }
    function h3(t) { need(16); y += 2.5; fnt('b', 12); col(C.ink); doc.text(clean(t), ML, y); y += 2; fill(C.gold); doc.rect(ML, y, 12, 0.8, 'F'); y += 5.5; }
    function stats(items) {
      var n = items.length, gap = 4, w = (CW - gap * (n - 1)) / n, h = 24; need(h + 4);
      items.forEach(function (s, i) { var x0 = ML + i * (w + gap); fill(i === 0 ? C.ink : C.cream); doc.roundedRect(x0, y, w, h, 2.5, 2.5, 'F'); if (i) { stroke(C.line); doc.setLineWidth(0.3); doc.roundedRect(x0, y, w, h, 2.5, 2.5, 'S'); }
        fill(C.gold); doc.rect(x0 + 4, y + 4, 8, 0.9, 'F');
        fnt('x', clean(s.v).length > 13 ? 10.5 : clean(s.v).length > 9 ? 12.5 : 15); col(i === 0 ? C.gold2 : C.ink); doc.text(clean(s.v), x0 + 4, y + 12.5);
        fnt('b', 6.3); col(i === 0 ? [215, 208, 190] : C.muted); doc.text(doc.splitTextToSize(clean(s.l).toUpperCase(), w - 7).slice(0, 2), x0 + 4, y + 17.5, { charSpace: 0.3 }); });
      y += h + 5;
    }
    function cards(b) {
      var colsN = b.cols || 2, gap = 4, w = (CW - gap * (colsN - 1)) / colsN, items = b.items || [];
      for (var i = 0; i < items.length; i += colsN) {
        var row = items.slice(i, i + colsN), hs = row.map(function (c) { fnt('r', 8.2); var tl = doc.splitTextToSize(clean(c.text || '').replace(/\*\*/g, ''), w - 10); fnt('b', 9.5); var hl = doc.splitTextToSize(clean(c.title || ''), w - 10 - (c.tag ? 22 : 0)); return { tl: tl, hl: hl, h: 7 + hl.length * 4.4 + tl.length * 3.7 + 4 }; }), h = Math.max.apply(null, hs.map(function (x) { return x.h; }));
        need(h + gap);
        row.forEach(function (c, k) { var x0 = ML + k * (w + gap), q = hs[k]; fill(c.dark ? C.ink : C.cream); doc.roundedRect(x0, y, w, h, 2.5, 2.5, 'F'); fill(c.color || C.gold); doc.roundedRect(x0, y, 1.6, h, 0.8, 0.8, 'F');
          if (c.tag) { fnt('b', 6); var tw = doc.getTextWidth(c.tag.toUpperCase()) + 5; fill(c.tagColor || C.gold); doc.roundedRect(x0 + w - tw - 3, y + 3, tw, 4.6, 2.3, 2.3, 'F'); col(C.ink); doc.text(clean(c.tag).toUpperCase(), x0 + w - tw - 0.5, y + 6.2); }
          fnt('b', 9.5); col(c.dark ? C.gold2 : C.ink); doc.text(q.hl, x0 + 5.5, y + 6.8); fnt('r', 8.2); col(c.dark ? [230, 224, 205] : C.text); doc.text(q.tl, x0 + 5.5, y + 7 + q.hl.length * 4.4 + 0.6, { lineHeightFactor: 1.3 }); });
        y += h + gap;
      }
      y += 1;
    }
    function callout(b) {
      fnt('r', 8.8); var tl = doc.splitTextToSize(clean(b.text || '').replace(/\*\*/g, ''), CW - 14), h = 9 + (b.title ? 5 : 0) + tl.length * 4.1; need(h + 3);
      fill(b.dark ? C.ink : C.tint); doc.roundedRect(ML, y, CW, h, 2.5, 2.5, 'F'); fill(C.gold); doc.rect(ML, y, 1.6, h, 'F');
      var yy = y + 6.5; if (b.title) { fnt('b', 9.5); col(b.dark ? C.gold2 : C.goldD); doc.text(clean(b.title), ML + 7, yy); yy += 5; }
      fnt('r', 8.8); col(b.dark ? [236, 230, 212] : C.text); doc.text(tl, ML + 7, yy, { lineHeightFactor: 1.32 }); y += h + 4;
    }
    function table(b) {
      if (!b.rows || !b.rows.length) { if (b.empty) callout({ text: b.empty }); return; }
      var ws = b.widths || b.head.map(function () { return 1; }), sum = ws.reduce(function (a, v) { return a + v; }, 0), cs = {};
      ws.forEach(function (v, i) { cs[i] = { cellWidth: CW * v / sum }; });
      var body = b.rows.map(function (r) { return r.map(function (c0) { var c = cellOf(c0); return clean(c.t == null ? '' : c.t); }); });
      need(18);
      doc.autoTable({ startY: y, margin: { left: ML, right: MR, top: 20, bottom: PH - BOT + 2 }, head: [b.head.map(clean)], body: body, theme: 'plain', columnStyles: cs, tableWidth: CW,
        styles: { font: 'Poppins', fontSize: b.size || 7.8, cellPadding: { top: 1.9, bottom: 1.9, left: 2.2, right: 2.2 }, textColor: C.text, lineColor: C.line, lineWidth: { bottom: 0.2 }, overflow: 'linebreak', valign: 'middle' },
        headStyles: { fillColor: C.ink, textColor: C.gold2, fontStyle: 'bold', fontSize: (b.size || 7.8) - 0.4, lineWidth: 0 },
        alternateRowStyles: { fillColor: C.cream },
        didParseCell: function (h) { if (h.section !== 'body') return; var c = cellOf(b.rows[h.row.index][h.column.index]);
          if (c.b) h.cell.styles.fontStyle = 'bold'; if (c.center) h.cell.styles.halign = 'center'; if (c.right) h.cell.styles.halign = 'right';
          if (c.rag) { h.cell.styles.fillColor = RAG[c.rag]; h.cell.styles.textColor = C.white; h.cell.styles.fontStyle = 'bold'; h.cell.styles.halign = 'center'; }
          if (c.fill) { h.cell.styles.fillColor = c.fill; } if (c.total) { h.cell.styles.fillColor = C.tint; h.cell.styles.fontStyle = 'bold'; } },
        didDrawPage: function (h) { if (h.pageNumber > 1 || doc.getNumberOfPages() > 1) { /* header on continuation pages */ } }
      });
      // autoTable may have added pages: give them the continuation band + footer
      y = doc.lastAutoTable.finalY + 5;
      if (b.note) { fnt('r', 7); col(C.muted); var nl = doc.splitTextToSize(clean(b.note), CW); need(nl.length * 3.4); doc.text(nl, ML, y); y += nl.length * 3.4 + 2; }
    }
    function kv(b) { table({ head: b.head || ['Item', 'Detail'], rows: b.rows.map(function (r) { return [{ t: r[0], b: true }, r[1]]; }), widths: b.widths || [1, 2.4], size: 8 }); }
    function image(b) {
      var im = b._img; if (!im) return; var w = b.w || CW, h = w * im.h / im.w, maxH = b.maxH || 150; if (h > maxH) { w = w * maxH / h; h = maxH; }
      need(h + (b.title ? 9 : 4)); if (b.title) { fnt('b', 8.5); col(C.muted); doc.text(clean(b.title).toUpperCase(), ML, y, { charSpace: 0.4 }); y += 3; }
      stroke(C.line); doc.setLineWidth(0.25); doc.roundedRect(ML, y, CW, h + 4, 2, 2, 'S');
      doc.addImage(im.url, 'JPEG', ML + (CW - w) / 2, y + 2, w, h); y += h + 8;
    }
    function sign(b) {
      if (b.intro) { need(10); fnt('r', 8.5); col(C.muted); var il = doc.splitTextToSize(clean(b.intro), CW); doc.text(il, ML, y); y += il.length * 3.9 + 3; }
      var w = (CW - 4) / 2, h = 30; (b.rows || []).forEach(function (r, i) { if (i % 2 === 0) need(h + 4); var x0 = ML + (i % 2) * (w + 4);
        fill(C.cream); doc.roundedRect(x0, y, w, h, 2.5, 2.5, 'F'); fill(C.gold); doc.rect(x0, y, 1.6, h, 'F');
        fnt('b', 6.6); col(C.goldD); doc.text(clean(r.role).toUpperCase(), x0 + 5.5, y + 6, { charSpace: 0.4 }); fnt('b', 9.5); col(C.ink); doc.text(clean(r.name || ' '), x0 + 5.5, y + 11.5);
        stroke(C.muted); doc.setLineWidth(0.25); doc.line(x0 + 5.5, y + 22, x0 + w * 0.62, y + 22); doc.line(x0 + w * 0.68, y + 22, x0 + w - 5, y + 22);
        fnt('r', 6.5); col(C.muted); doc.text('Signature', x0 + 5.5, y + 25.5); doc.text('Date', x0 + w * 0.68, y + 25.5);
        if (i % 2 === 1 || i === b.rows.length - 1) y += h + 4; });
    }
    function block(b) {
      if (b.t === 'p') return text(b); if (b.t === 'h') return h3(b.text); if (b.t === 'stats') return stats(b.items); if (b.t === 'cards') return cards(b); if (b.t === 'callout') return callout(b);
      if (b.t === 'table') { if (b.title) h3(b.title); return table(b); } if (b.t === 'kv') { if (b.title) h3(b.title); return kv(b); } if (b.t === 'chart' || b.t === 'image') return image(b); if (b.t === 'sign') { if (b.title) h3(b.title); return sign(b); }
      if (b.t === 'break') { newPage(true); y = 20; } if (b.t === 'space') y += b.h || 4;
    }

    cover();
    if (D.toc) contents();
    (D.chapters || []).forEach(function (ch, i) { ch._i = i; if (ch.divider) { divider(ch); y = BOT + 1; return; } chapterHead(ch); (ch.blocks || []).forEach(block); });
    // last pass: pages a long table added get the slim band; every page but the cover and dividers gets the footer
    var total = doc.getNumberOfPages(), cur = null;
    for (var pgi = 1; pgi <= total; pgi++) { if (chapAt[pgi]) cur = chapAt[pgi]; var k = kinds[pgi]; doc.setPage(pgi);
      if (!k) contHead(cur); if (k !== 'cover' && k !== 'divider') footer(pgi); }
    doc.setPage(total);
    return { doc: doc, toc: toc };
  }
  function pdf(D) {
    return libsPdf().then(function () { return prep(D); }).then(function () {
      var r1 = pdfDoc(D, []), r2 = D.toc ? pdfDoc(D, r1.toc) : r1, doc = r2.doc;
      var blob = doc.output('blob'); return { blob: blob, pages: doc.getNumberOfPages(), name: (D.fileBase || 'Document') + '.pdf' };
    });
  }
  // load the artwork and turn chart blocks into pictures
  function prep(D) {
    D._art = D._art || { cover: art('cover', 1240, 1754, 7), divider: art('divider', 1240, 1754, 23), band: art('band', 1600, 300, 41) };
    var fonts = document.fonts && document.fonts.load ? Promise.all(['400 20px Poppins', '600 20px Poppins', '800 20px Poppins'].map(function (f) { return document.fonts.load(f).catch(function () {}); })) : Promise.resolve();
    return fonts.then(function () { (D.chapters || []).forEach(function (ch) { (ch.blocks || []).forEach(function (b) { if (b.t === 'chart' && !b._img) b._img = chart(b); if (b.t === 'image' && !b._img && b.url) b._img = { url: b.url, w: b.iw, h: b.ih }; }); }); });
  }

  /* ---------- Word ---------- */
  function docx(D) {
    return libsDocx().then(function () { return prep(D); }).then(function () {
      var X = window.docx, FN = 'Poppins', TW = 9638;   // A4 with 2 cm margins, in twips
      var T = function (t, o) { return new X.TextRun(Object.assign({ text: clean(t), font: FN, size: 18, color: HEX(C.text) }, o || {})); };
      var P = function (r, o) { return new X.Paragraph(Object.assign({ spacing: { after: 80, line: 290 }, children: Array.isArray(r) ? r : [r] }, o || {})); };
      var NB = { style: X.BorderStyle.NONE, size: 0, color: 'FFFFFF' }, NOB = { top: NB, bottom: NB, left: NB, right: NB, insideHorizontal: NB, insideVertical: NB };
      var LB = { style: X.BorderStyle.SINGLE, size: 4, color: HEX(C.line) };
      var shade = function (c) { return { type: X.ShadingType.CLEAR, color: 'auto', fill: HEX(c) }; };
      var img = function (im, wpx, type) { var h = Math.round(wpx * im.h / im.w); return new X.ImageRun({ type: type || 'jpg', data: u8(type === 'png' ? im.png : im.url), transformation: { width: wpx, height: h } }); };
      var rich = function (t, o) { return runs(t).map(function (r) { return T(r.t, Object.assign({}, o || {}, r.b ? { bold: true, color: HEX(C.ink) } : {})); }); };
      var box = function (children, fillC, o) { o = o || {}; return new X.Table({ width: { size: TW, type: X.WidthType.DXA }, columnWidths: [TW], borders: NOB, rows: [new X.TableRow({ children: [new X.TableCell({ width: { size: TW, type: X.WidthType.DXA }, shading: shade(fillC),
        borders: { top: NB, bottom: NB, right: NB, left: o.bar ? { style: X.BorderStyle.SINGLE, size: 24, color: HEX(C.gold) } : NB }, margins: { top: o.pad || 160, bottom: o.pad || 160, left: 240, right: 240 }, children: children })] })] }); };
      var kids = [];
      var gap = function (n) { kids.push(P(T(''), { spacing: { after: n || 60 } })); };
      // cover
      if (D.cover === 'band') {
        kids.push(box([P(T(D.brand || 'GKH PROJECT CHAMP', { bold: true, color: HEX(C.gold2), size: 15 })), P(T((D.kicker || '').toUpperCase(), { bold: true, color: HEX(C.gold), size: 16 })), P(T(D.title, { bold: true, color: 'FFFFFF', size: 40 })), P(T(D.subtitle || '', { color: 'E6E0CD', size: 18 }))].concat((D.headRight || []).map(function (t) { return P(T(t, { color: 'D7D0BE', size: 15 }), { spacing: { after: 0 } }); })), C.ink, { pad: 240 }));
        gap(120); if (D.stats) kids.push(statTable(D.stats)); gap(120);
      } else {
        kids.push(P(img(D._art.band, 640), { spacing: { after: 0 } }));
        kids.push(box([P(T(D.brand || 'GKH PROJECT CHAMP', { bold: true, color: HEX(C.gold2), size: 16 })), P(T((D.kicker || '').toUpperCase(), { bold: true, color: HEX(C.gold), size: 18 }), { spacing: { before: 400, after: 120 } }),
          P(T(D.title, { bold: true, color: 'FFFFFF', size: 60 }), { spacing: { after: 160, line: 260 } }), P(T(D.subtitle || '', { color: 'E6E0CD', size: 22 }), { spacing: { after: 400 } })]
          .concat((D.meta || []).map(function (m) { return P([T(m[0].toUpperCase() + '   ', { bold: true, color: HEX(C.gold2), size: 15 }), T(m[1], { color: 'FFFFFF', size: 19 })], { spacing: { after: 60 } }); })), C.ink, { pad: 400 }));
        gap(160); if (D.stats) kids.push(statTable(D.stats));
        kids.push(new X.Paragraph({ children: [new X.PageBreak()] }));
      }
      function statTable(items) { var n = items.length, w = Math.floor(TW / n), ws = items.map(function (s, i) { return i === n - 1 ? TW - w * (n - 1) : w; });
        return new X.Table({ width: { size: TW, type: X.WidthType.DXA }, columnWidths: ws, borders: NOB, rows: [new X.TableRow({ children: items.map(function (s, i) { return new X.TableCell({ width: { size: ws[i], type: X.WidthType.DXA }, shading: shade(i === 0 ? C.ink : C.cream), borders: { top: NB, bottom: NB, left: { style: X.BorderStyle.SINGLE, size: 12, color: 'FFFFFF' }, right: { style: X.BorderStyle.SINGLE, size: 12, color: 'FFFFFF' } }, margins: { top: 140, bottom: 140, left: 160, right: 120 },
          children: [P(T(s.v, { bold: true, size: 30, color: HEX(i === 0 ? C.gold2 : C.ink) }), { spacing: { after: 20 } }), P(T(String(s.l).toUpperCase(), { bold: true, size: 13, color: i === 0 ? 'D7D0BE' : HEX(C.muted) }), { spacing: { after: 0 } })] }); }) })] }); }
      // contents (no page numbers in Word: Word numbers pages itself)
      if (D.toc) {
        kids.push(box([P(T('INSIDE THIS PLAN', { bold: true, color: HEX(C.gold), size: 15 })), P(T('Contents', { bold: true, color: 'FFFFFF', size: 44 }))], C.ink, { pad: 260 })); gap(160);
        (D.chapters || []).forEach(function (ch) { if (ch.part) kids.push(P(T(ch.part.toUpperCase(), { bold: true, color: HEX(C.goldD), size: 15 }), { spacing: { before: 160, after: 60 } })); if (ch.divider) return;
          kids.push(P([T(String(ch.no || '') + '   ', { bold: true, color: HEX(C.gold), size: 21 }), T(ch.title, { bold: true, size: 21, color: HEX(C.ink) })].concat(ch.blurb ? [new X.TextRun({ break: 1 }), T('      ' + ch.blurb, { size: 15, color: HEX(C.muted) })] : []), { spacing: { after: 110 } })); });
        kids.push(new X.Paragraph({ children: [new X.PageBreak()] }));
      }
      var first = true;
      (D.chapters || []).forEach(function (ch) {
        if (ch.divider) {
          if (!first) kids.push(new X.Paragraph({ children: [new X.PageBreak()] }));
          kids.push(box([P(T((ch.part || '').toUpperCase(), { bold: true, color: HEX(C.gold), size: 18 }), { spacing: { before: 1400 } }), P(T(ch.title, { bold: true, color: 'FFFFFF', size: 64 }), { spacing: { after: 200 } }), P(T(ch.blurb || '', { color: 'E6E0CD', size: 22 }), { spacing: { after: 300 } })]
            .concat((ch.list || []).map(function (t) { return P([T(t[0] + '   ', { bold: true, color: HEX(C.gold2), size: 20 }), T(t[1], { color: 'FFFFFF', size: 20 })]); })).concat([P(T(''), { spacing: { after: 1600 } })]), C.ink, { pad: 400 }));
          kids.push(new X.Paragraph({ children: [new X.PageBreak()] })); first = true; return;
        }
        if (!first && !ch.sameP && !D.flow) kids.push(new X.Paragraph({ children: [new X.PageBreak()] })); first = false;
        kids.push(box([P(T(((ch.kicker || D.short || '') + '').toUpperCase(), { bold: true, color: HEX(C.gold), size: 15 })), P([T((ch.no ? ch.no + '   ' : ''), { bold: true, color: HEX(C.gold2), size: 40 }), T(ch.title, { bold: true, color: 'FFFFFF', size: 40 })], { spacing: { after: 0 } })], C.ink, { pad: 220 }));
        gap(140);
        if (ch.lead) kids.push(P(T(ch.lead, { size: 21, color: HEX(C.text) }), { spacing: { after: 160, line: 300 } }));
        (ch.blocks || []).forEach(function (b) { wblock(b); });
      });
      function H3(t) { kids.push(new X.Paragraph({ spacing: { before: 220, after: 100 }, border: { bottom: { style: X.BorderStyle.SINGLE, size: 10, color: HEX(C.gold), space: 3 } }, children: [T(t, { bold: true, size: 24, color: HEX(C.ink) })] })); }
      function wtable(b) {
        if (!b.rows || !b.rows.length) { if (b.empty) kids.push(box([P(T(b.empty, { italics: true, color: HEX(C.muted) }))], C.tint, { bar: 1, pad: 100 })); return; }
        var ws = b.widths || b.head.map(function () { return 1; }), sum = ws.reduce(function (a, v) { return a + v; }, 0); ws = ws.map(function (v) { return Math.floor(v * TW / sum); }); ws[ws.length - 1] += TW - ws.reduce(function (a, v) { return a + v; }, 0);
        var cell = function (c0, w, o) { var c = cellOf(c0); o = o || {}; var f = c.rag ? RAG[c.rag] : c.fill || (c.total ? C.tint : o.fill); return new X.TableCell({ width: { size: w, type: X.WidthType.DXA }, shading: f ? shade(f) : undefined, borders: { top: NB, left: NB, right: NB, bottom: LB }, margins: { top: 70, bottom: 70, left: 100, right: 100 }, verticalAlign: X.VerticalAlign.CENTER,
          children: [P(T(c.t == null ? '' : c.t, { bold: !!(c.b || c.rag || c.total || o.head), color: o.head ? HEX(C.gold2) : c.rag ? 'FFFFFF' : HEX(C.text), size: o.head ? 15 : 16 }), { spacing: { after: 0, line: 250 }, alignment: c.rag || c.center ? X.AlignmentType.CENTER : c.right ? X.AlignmentType.RIGHT : X.AlignmentType.LEFT })] }); };
        kids.push(new X.Table({ width: { size: TW, type: X.WidthType.DXA }, columnWidths: ws, borders: NOB, rows: [new X.TableRow({ tableHeader: true, children: b.head.map(function (h, i) { return cell(h, ws[i], { head: 1, fill: C.ink }); }) })]
          .concat(b.rows.map(function (r, ri) { return new X.TableRow({ cantSplit: true, children: r.map(function (c, i) { return cell(c, ws[i], { fill: ri % 2 ? C.cream : null }); }) }); })) }));
        if (b.note) kids.push(P(T(b.note, { size: 14, color: HEX(C.muted), italics: true }), { spacing: { before: 60 } })); gap(80);
      }
      function wblock(b) {
        if (b.t === 'p') { paras(b.text).forEach(function (p) { if (p.k === 'h') { kids.push(P(T(p.t, { bold: true, size: 22, color: HEX(C.ink) }), { spacing: { before: 160, after: 80 } })); return; }
            if (p.k === 'li') { kids.push(new X.Paragraph({ numbering: { reference: 'champdots', level: 0 }, spacing: { after: 50, line: 280 }, children: rich(p.t) })); return; }
            if (p.k === 'ol') { kids.push(P([T(p.n + '.  ', { bold: true, color: HEX(C.goldD) })].concat(rich(p.t)), { indent: { left: 300, hanging: 300 } })); return; }
            kids.push(P(rich(p.t), { spacing: { after: 110, line: 290 } })); }); return; }
        if (b.t === 'h') return H3(b.text);
        if (b.t === 'stats') { kids.push(statTable(b.items)); gap(140); return; }
        if (b.t === 'cards') { var n = b.cols || 2, w = Math.floor(TW / n), ws = []; for (var q = 0; q < n; q++) ws.push(q === n - 1 ? TW - w * (n - 1) : w); var rows = [];
          for (var i = 0; i < b.items.length; i += n) rows.push(new X.TableRow({ cantSplit: true, children: ws.map(function (wd, k) { var c = b.items[i + k]; return new X.TableCell({ width: { size: wd, type: X.WidthType.DXA }, shading: c ? shade(c.dark ? C.ink : C.cream) : undefined,
            borders: { top: { style: X.BorderStyle.SINGLE, size: 24, color: 'FFFFFF' }, bottom: { style: X.BorderStyle.SINGLE, size: 24, color: 'FFFFFF' }, right: { style: X.BorderStyle.SINGLE, size: 24, color: 'FFFFFF' }, left: c ? { style: X.BorderStyle.SINGLE, size: 24, color: HEX(C.gold) } : NB }, margins: { top: 120, bottom: 120, left: 180, right: 140 },
            children: c ? [P([T(c.title, { bold: true, size: 20, color: HEX(c.dark ? C.gold2 : C.ink) })].concat(c.tag ? [T('   ' + c.tag.toUpperCase(), { bold: true, size: 13, color: HEX(C.goldD) })] : []), { spacing: { after: 60 } }), P(rich(c.text || '', { size: 17, color: c.dark ? 'E6E0CD' : HEX(C.text) }), { spacing: { after: 0, line: 270 } })] : [P(T(''))] }); }) }));
          kids.push(new X.Table({ width: { size: TW, type: X.WidthType.DXA }, columnWidths: ws, borders: NOB, rows: rows })); gap(120); return; }
        if (b.t === 'callout') { kids.push(box([].concat(b.title ? [P(T(b.title, { bold: true, size: 20, color: HEX(b.dark ? C.gold2 : C.goldD) }))] : []).concat([P(rich(b.text || '', { size: 18, color: b.dark ? 'E6E0CD' : HEX(C.text) }), { spacing: { after: 0, line: 280 } })]), b.dark ? C.ink : C.tint, { bar: 1, pad: 140 })); gap(140); return; }
        if (b.t === 'table') { if (b.title) H3(b.title); return wtable(b); }
        if (b.t === 'kv') { if (b.title) H3(b.title); return wtable({ head: b.head || ['Item', 'Detail'], rows: b.rows.map(function (r) { return [{ t: r[0], b: true }, r[1]]; }), widths: b.widths || [1, 2.4] }); }
        if (b.t === 'chart' || b.t === 'image') { if (!b._img) return; if (b.title) kids.push(P(T(b.title.toUpperCase(), { bold: true, size: 15, color: HEX(C.muted) }), { spacing: { before: 120 } })); kids.push(P(img(b._img, Math.min(640, b.wpx || 640), 'jpg'), { alignment: X.AlignmentType.CENTER })); gap(80); return; }
        if (b.t === 'sign') { if (b.title) H3(b.title); if (b.intro) kids.push(P(T(b.intro, { color: HEX(C.muted), size: 17 })));
          var sw = [2800, 2800, 2600, 1438]; kids.push(new X.Table({ width: { size: TW, type: X.WidthType.DXA }, columnWidths: sw, borders: NOB, rows: [new X.TableRow({ tableHeader: true, children: ['Role', 'Name', 'Signature', 'Date'].map(function (h, i) { return new X.TableCell({ width: { size: sw[i], type: X.WidthType.DXA }, shading: shade(C.ink), borders: NOB, margins: { top: 80, bottom: 80, left: 100, right: 100 }, children: [P(T(h, { bold: true, color: HEX(C.gold2), size: 15 }), { spacing: { after: 0 } })] }); }) })]
            .concat((b.rows || []).map(function (r) { return new X.TableRow({ height: { value: 760, rule: X.HeightRule.ATLEAST }, cantSplit: true, children: [r.role, r.name || '', '', ''].map(function (t, i) { return new X.TableCell({ width: { size: sw[i], type: X.WidthType.DXA }, borders: { top: NB, left: NB, right: NB, bottom: LB }, shading: i === 0 ? shade(C.cream) : undefined, margins: { top: 80, bottom: 80, left: 100, right: 100 }, verticalAlign: X.VerticalAlign.CENTER, children: [P(T(t, { bold: i === 0, size: 17 }), { spacing: { after: 0 } })] }); }) }); })) })); gap(); return; }
        if (b.t === 'break') kids.push(new X.Paragraph({ children: [new X.PageBreak()] }));
      }
      var doc = new X.Document({ creator: 'GKH Project Champ', title: D.title, description: D.subtitle || '',
        styles: { default: { document: { run: { font: FN, size: 18 } } } },
        numbering: { config: [{ reference: 'champdots', levels: [{ level: 0, format: X.LevelFormat.BULLET, text: '•', alignment: X.AlignmentType.LEFT, style: { run: { color: HEX(C.gold) }, paragraph: { indent: { left: 360, hanging: 240 } } } }] }] },
        sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134, header: 500, footer: 500 } } },
          headers: { default: new X.Header({ children: [new X.Paragraph({ alignment: X.AlignmentType.RIGHT, children: [T((D.short || D.title).toUpperCase(), { bold: true, size: 13, color: HEX(C.goldD) })] })] }) },
          footers: { default: new X.Footer({ children: [new X.Paragraph({ border: { top: { style: X.BorderStyle.SINGLE, size: 4, color: HEX(C.line), space: 4 } }, tabStops: [{ type: X.TabStopType.RIGHT, position: TW }], children: [T(D.footer || D.title, { size: 14, color: HEX(C.muted) }), T('\t'), new X.TextRun({ children: [X.PageNumber.CURRENT], font: FN, bold: true, size: 15, color: HEX(C.goldD) })] })] }) },
          children: kids }] });
      return X.Packer.toBlob(doc).then(function (blob) { return { blob: blob, name: (D.fileBase || 'Document') + '.docx' }; });
    });
  }

  /* ---------- language: the whole document in the chosen language ---------- */
  // Latin-script languages are drawn by the PDF fonts; others (Tamil, Chinese, Hindi, Arabic, Thai, Vietnamese ...) are printed from the browser, which shapes them properly
  var LATIN = { en: 1, ms: 1, id: 1, tl: 1, es: 1, fr: 1, de: 1, pt: 1, sw: 1, rw: 1 };
  function visit(D, fn) {   // fn(get, set) for every piece of text in the document
    var f = function (o, k) { if (o && typeof o[k] === 'string' && o[k]) fn(o[k], function (v) { o[k] = v; }); };
    ['title', 'subtitle', 'kicker', 'short', 'footer', 'coverNote'].forEach(function (k) { f(D, k); });
    (D.headRight || []).forEach(function (t, i) { f(D.headRight, i); }); (D.meta || []).forEach(function (m) { f(m, 0); }); (D.stats || []).forEach(function (x) { f(x, 'l'); f(x, 'v'); });
    (D.chapters || []).forEach(function (ch) {
      ['title', 'kicker', 'lead', 'blurb', 'part'].forEach(function (k) { f(ch, k); }); (ch.list || []).forEach(function (x) { f(x, 1); });
      (ch.blocks || []).forEach(function (b) {
        if (b.noTr) { f(b, 'title'); return; }
        ['text', 'title', 'intro', 'empty', 'note'].forEach(function (k) { if (k === 'text' && b.t === 'p') return; f(b, k); });
        if (b.t === 'p' && b.text) { var L = String(b.text).split('\n'); L.forEach(function (ln, i) { var m = ln.match(/^(\s*(?:#{1,4}|[-•*]|\d+[.)])\s+)?(.*)$/); if (m[2] && m[2].length < 700) fn(m[2], function (v) { L[i] = (m[1] || '') + v; }); }); b._join = function () { b.text = L.join('\n'); }; }
        (b.items || []).forEach(function (x) { ['title', 'text', 'tag', 'l'].forEach(function (k) { f(x, k); }); });
        if (b.head) b.head.forEach(function (h, i) { f(b.head, i); });
        (b.rows || []).forEach(function (r) { if (Array.isArray(r)) r.forEach(function (c, i) { if (typeof c === 'string') f(r, i); else if (c && typeof c.t === 'string') f(c, 't'); }); else { f(r, 'role'); } });
        if (b.data && b.data.items) b.data.items.forEach(function (x) { f(x, 'l'); }); if (b.data) f(b.data, 'centerLabel');
      });
    });
  }
  function translate(D) {
    if (!D.lang || D.lang === 'en' || D._tr === D.lang || !window.ChampI18n || !window.ChampI18n.strings) return Promise.resolve();
    var list = []; visit(D, function (t) { if (t && /\p{L}/u.test(t) && t.length < 700) list.push(t); });
    return window.ChampI18n.strings(list, D.lang).then(function (map) {
      visit(D, function (t, set) { if (map[t]) set(map[t]); });
      (D.chapters || []).forEach(function (ch) { (ch.blocks || []).forEach(function (b) { if (b._join) { b._join(); delete b._join; } }); });
      D._tr = D.lang;
    });
  }
  function needsPrint(D) { return D.lang && !LATIN[D.lang]; }

  /* ---------- print view (HTML): the same design, printed to PDF by the browser ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function md(t) { return paras(t).map(function (p) { var r = esc(p.t).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>'); return p.k === 'h' ? '<h4>' + r + '</h4>' : p.k === 'li' ? '<li>' + r + '</li>' : p.k === 'ol' ? '<p class="ol"><b>' + p.n + '.</b> ' + r + '</p>' : '<p>' + r + '</p>'; }).join('').replace(/(<li>.*?<\/li>)+/g, function (m) { return '<ul>' + m + '</ul>'; }); }
  function html(D) {
    var F = window.CHAMP_FONTS || {}, css = '@page{size:A4;margin:0}*{box-sizing:border-box}body{margin:0;font-family:Poppins,"Noto Sans","Nirmala UI","Latha","Tamil MN","Microsoft YaHei","PingFang SC","Noto Sans SC",sans-serif;color:#1F1D18;font-size:9.4pt;line-height:1.55;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
      ['Regular:400', 'SemiBold:600', 'ExtraBold:800', 'Light:300'].map(function (x) { var k = x.split(':'); return F['Poppins-' + k[0]] ? '@font-face{font-family:Poppins;font-weight:' + k[1] + ';src:url(data:font/ttf;base64,' + F['Poppins-' + k[0]] + ') format("truetype")}' : ''; }).join('') +
      '.pg{width:210mm;min-height:297mm;position:relative;page-break-after:always;overflow:hidden}.pg:last-child{page-break-after:auto}.full{background-size:cover;color:#fff;padding:20mm 17mm}' +
      '.pill{display:inline-block;background:#C9A227;color:#0C0B08;font-weight:600;font-size:7pt;letter-spacing:.06em;text-transform:uppercase;border-radius:99px;padding:1.2mm 3.5mm}' +
      '.ct{font-weight:800;font-size:34pt;line-height:1.05;margin:6mm 0 4mm}.rule{width:26mm;height:1.4mm;background:#C9A227;margin:4mm 0}.sub{font-weight:300;font-size:12pt;color:#ECE6D4}' +
      '.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:4mm;margin-top:24mm}.meta b{display:block;color:#E8C04A;font-size:6.5pt;letter-spacing:.06em;text-transform:uppercase}.stats{display:grid;gap:3.5mm;margin:4mm 0}' +
      '.st{border-radius:2.5mm;padding:4mm;background:#FBF8EC;border:.3mm solid #E3DDD0}.st:first-child{background:#0C0B08;color:#fff}.st i{display:block;width:8mm;height:.9mm;background:#C9A227;margin-bottom:2mm}.st b{display:block;font-weight:800;font-size:15pt;color:#0C0B08}.st:first-child b{color:#E8C04A}.st small{font-weight:600;font-size:6.3pt;text-transform:uppercase;letter-spacing:.04em;color:#6B665A}.st:first-child small{color:#D7D0BE}' +
      '.band{height:40mm;background-size:cover;border-bottom:.8mm solid #C9A227;padding:9mm 17mm;color:#fff;position:relative}.band h2{font-weight:800;font-size:20pt;margin:3mm 0 0;line-height:1.1}.band .no{position:absolute;right:17mm;top:12mm;font-weight:800;font-size:44pt;color:#463A16}' +
      '.body{padding:7mm 17mm 14mm}.lead{font-weight:300;font-size:10.5pt}h3{font-size:12pt;margin:5mm 0 2mm;padding-bottom:1.5mm;border-bottom:.8mm solid #C9A227;display:inline-block}h4{margin:3mm 0 1mm}ul{padding-left:5mm}li::marker{color:#C9A227}' +
      '.cards{display:grid;gap:4mm;margin:3mm 0}.card{background:#FBF8EC;border-left:1.6mm solid #C9A227;border-radius:2.5mm;padding:3.5mm 4mm;break-inside:avoid}.card.dark{background:#0C0B08;color:#E6E0CD}.card b{display:block;margin-bottom:1mm}.card.dark b{color:#E8C04A}.tag{float:right;background:#C9A227;border-radius:99px;font-size:6pt;padding:.4mm 2mm;font-weight:600;text-transform:uppercase}' +
      '.call{background:#FFF8E1;border-left:1.6mm solid #C9A227;border-radius:2.5mm;padding:4mm 5mm;margin:3mm 0;break-inside:avoid}.call.dark{background:#0C0B08;color:#ECE6D4}.call b.t{display:block;color:#8A6A00}' +
      'table{width:100%;border-collapse:collapse;margin:2mm 0 4mm;font-size:7.8pt}th{background:#0C0B08;color:#E8C04A;text-align:left;padding:1.8mm 2.2mm;font-weight:600}td{padding:1.8mm 2.2mm;border-bottom:.2mm solid #E3DDD0;vertical-align:middle}tr:nth-child(even) td{background:#FBF8EC}tr{break-inside:avoid}' +
      'td.G{background:#15803D!important;color:#fff;font-weight:600;text-align:center}td.A{background:#D97706!important;color:#fff;font-weight:600;text-align:center}td.R{background:#B91C1C!important;color:#fff;font-weight:600;text-align:center}td.tot{background:#FFF8E1!important;font-weight:600}' +
      '.fig{border:.25mm solid #E3DDD0;border-radius:2mm;padding:2mm;margin:2mm 0 4mm;text-align:center;break-inside:avoid}.fig img{max-width:100%;max-height:150mm}.cap{font-size:7.5pt;color:#6B665A;text-transform:uppercase;letter-spacing:.04em;font-weight:600}' +
      '.sign{display:grid;grid-template-columns:1fr 1fr;gap:4mm}.sg{background:#FBF8EC;border-left:1.6mm solid #C9A227;border-radius:2.5mm;padding:4mm 5mm 3mm;break-inside:avoid}.sg small{color:#8A6A00;font-weight:600;font-size:6.5pt;text-transform:uppercase}.sg .ln{display:flex;gap:6mm;margin-top:9mm;font-size:6.5pt;color:#6B665A}.sg .ln span{flex:1;border-top:.25mm solid #6B665A;padding-top:1mm}' +
      '.toc p{display:flex;gap:3mm;align-items:baseline;margin:0 0 3mm;font-weight:600;font-size:10.5pt}.toc p i{font-style:normal;background:#0C0B08;color:#E8C04A;border-radius:50%;width:7mm;height:7mm;display:inline-flex;align-items:center;justify-content:center;font-size:7.5pt}.toc .pt{color:#8A6A00;font-size:7.5pt;letter-spacing:.08em;text-transform:uppercase;margin:4mm 0 2mm}' +
      '.flow h2.sec{display:flex;gap:3mm;align-items:center;background:#0C0B08;color:#fff;border-radius:2.2mm;font-size:10.5pt;padding:2mm 3mm;margin:4mm 0 3mm}.flow h2.sec i{font-style:normal;background:#C9A227;color:#0C0B08;border-radius:1.5mm;padding:0 2mm;font-weight:800}' +
      '@media screen{body{background:#555}.pg{background:#fff;margin:6mm auto;box-shadow:0 2mm 8mm rgba(0,0,0,.4)}}';
    var A = D._art, o = [];
    var stats = function (items) { return '<div class="stats" style="grid-template-columns:repeat(' + items.length + ',1fr)">' + items.map(function (x) { return '<div class="st"><i></i><b>' + esc(x.v) + '</b><small>' + esc(x.l) + '</small></div>'; }).join('') + '</div>'; };
    var cell = function (c0) { var c = c0 && typeof c0 === 'object' ? c0 : { t: c0 }; return '<td class="' + (c.rag || '') + (c.total ? ' tot' : '') + '"' + (c.fill ? ' style="background:rgb(' + c.fill.join(',') + ')"' : '') + (c.right ? ' align="right"' : c.center ? ' align="center"' : '') + '>' + (c.b ? '<b>' + esc(c.t) + '</b>' : esc(c.t)) + '</td>'; };
    var tbl = function (b) { if (!b.rows || !b.rows.length) return b.empty ? '<div class="call">' + esc(b.empty) + '</div>' : ''; return '<table><thead><tr>' + b.head.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' + b.rows.map(function (r) { return '<tr>' + r.map(cell).join('') + '</tr>'; }).join('') + '</tbody></table>' + (b.note ? '<p class="cap" style="text-transform:none">' + esc(b.note) + '</p>' : ''); };
    var blk = function (b) {
      if (b.t === 'p') return md(b.text); if (b.t === 'h') return '<h3>' + esc(b.text) + '</h3>'; if (b.t === 'stats') return stats(b.items);
      if (b.t === 'cards') return '<div class="cards" style="grid-template-columns:repeat(' + (b.cols || 2) + ',1fr)">' + b.items.map(function (c) { return '<div class="card' + (c.dark ? ' dark' : '') + '">' + (c.tag ? '<span class="tag">' + esc(c.tag) + '</span>' : '') + '<b>' + esc(c.title) + '</b>' + md(c.text || '') + '</div>'; }).join('') + '</div>';
      if (b.t === 'callout') return '<div class="call' + (b.dark ? ' dark' : '') + '">' + (b.title ? '<b class="t">' + esc(b.title) + '</b>' : '') + md(b.text) + '</div>';
      if (b.t === 'table') return (b.title ? '<h3>' + esc(b.title) + '</h3>' : '') + tbl(b);
      if (b.t === 'kv') return (b.title ? '<h3>' + esc(b.title) + '</h3>' : '') + tbl({ head: b.head || ['', ''], rows: b.rows.map(function (r) { return [{ t: r[0], b: true }, r[1]]; }) });
      if ((b.t === 'chart' || b.t === 'image') && b._img) return '<div class="fig">' + (b.title ? '<div class="cap">' + esc(b.title) + '</div>' : '') + '<img src="' + b._img.url + '"></div>';
      if (b.t === 'sign') return (b.title ? '<h3>' + esc(b.title) + '</h3>' : '') + (b.intro ? '<p>' + esc(b.intro) + '</p>' : '') + '<div class="sign">' + (b.rows || []).map(function (r) { return '<div class="sg"><small>' + esc(r.role) + '</small><br><b>' + esc(r.name || ' ') + '</b><div class="ln"><span>' + esc(D.signWord || 'Signature') + '</span><span style="flex:.6">' + esc(D.dateWord || 'Date') + '</span></div></div>'; }).join('') + '</div>';
      return '';
    };
    if (D.cover === 'band') {
      o.push('<div class="pg flow"><div class="band" style="height:auto;background-image:url(' + A.band.url + ')"><small style="color:#E8C04A;font-weight:600">' + esc(D.brand || 'GKH PROJECT CHAMP') + '</small><br><span class="pill">' + esc(D.kicker || '') + '</span><h2>' + esc(D.title) + '</h2><div class="sub">' + esc(D.subtitle || '') + '</div></div><div class="body">' + (D.stats ? stats(D.stats) : ''));
      (D.chapters || []).forEach(function (ch) { o.push('<h2 class="sec"><i>' + esc(String(ch.no || '').padStart(2, '0')) + '</i>' + esc(ch.title) + '</h2>' + (ch.lead ? '<p class="lead">' + esc(ch.lead) + '</p>' : '') + (ch.blocks || []).map(blk).join('')); });
      o.push('</div></div>');
    } else {
      o.push('<div class="pg full" style="background-image:url(' + A.cover.url + ')"><div style="display:flex;justify-content:space-between;font-size:7.5pt"><b style="color:#E8C04A">' + esc(D.brand || 'GKH PROJECT CHAMP') + '</b><span>' + (D.headRight || []).map(esc).join('<br>') + '</span></div><div style="margin-top:62mm"><span class="pill">' + esc(D.kicker || '') + '</span><div class="ct">' + esc(D.title) + '</div><div class="rule"></div><div class="sub">' + esc(D.subtitle || '') + '</div></div>' +
        '<div class="meta">' + (D.meta || []).map(function (m) { return '<div><b>' + esc(m[0]) + '</b>' + esc(m[1]) + '</div>'; }).join('') + '</div>' + (D.stats ? '<div style="margin-top:8mm">' + stats(D.stats).replace(/class="st"/g, 'class="st" style="background:rgba(20,18,12,.88);border-color:#C9A227;color:#fff"') + '</div>' : '') + '</div>');
      if (D.toc) o.push('<div class="pg"><div class="band" style="background-image:url(' + A.band.url + ')"><span class="pill">' + esc(D.tocKicker || 'Inside this plan') + '</span><h2>' + esc(D.tocWord || 'Contents') + '</h2></div><div class="body toc">' + (D.chapters || []).map(function (ch) { return (ch.part ? '<div class="pt">' + esc(ch.part) + '</div>' : '') + (ch.divider ? '' : '<p><i>' + esc(ch.no) + '</i>' + esc(ch.title) + '</p>'); }).join('') + '</div></div>');
      (D.chapters || []).forEach(function (ch) {
        if (ch.divider) { o.push('<div class="pg full" style="background-image:url(' + A.divider.url + ');padding-top:110mm"><span class="pill">' + esc(ch.part || '') + '</span><div class="ct">' + esc(ch.title) + '</div><div class="rule"></div><div class="sub">' + esc(ch.blurb || '') + '</div>' + (ch.list || []).map(function (t) { return '<p style="margin:2mm 0"><b style="color:#E8C04A">' + esc(t[0]) + '</b> &nbsp;' + esc(t[1]) + '</p>'; }).join('') + '</div>'); return; }
        o.push('<div class="pg"><div class="band" style="background-image:url(' + A.band.url + ')"><span class="pill">' + esc(ch.kicker || D.short || '') + '</span><h2>' + esc(ch.title) + '</h2><span class="no">' + esc(String(ch.no || '').padStart(2, '0')) + '</span></div><div class="body">' + (ch.lead ? '<p class="lead">' + esc(ch.lead) + '</p>' : '') + (ch.blocks || []).map(blk).join('') + '</div></div>');
      });
    }
    return '<!DOCTYPE html><html lang="' + esc(D.lang || 'en') + '"><head><meta charset="utf-8"><title>' + esc(D.title) + '</title><style>' + css + '</style></head><body>' + o.join('') + '</body></html>';
  }
  function printView(D, win) {
    return Promise.resolve(window.CHAMP_FONTS ? null : load('vendor/poppins.js?v=1', function () { return !!window.CHAMP_FONTS; })).then(function () { return translate(D); }).then(function () { return prep(D); }).then(function () {
      var h = html(D); if (!win) { var b = new Blob([h], { type: 'text/html' }); return { blob: b, name: (D.fileBase || 'Document') + '.html', html: true }; }
      win.document.open(); win.document.write(h); win.document.close();
      setTimeout(function () { try { win.focus(); win.print(); } catch (e) {} }, 900);
      return { printed: true, name: (D.fileBase || 'Document') + '.pdf' };
    });
  }

  M.studio = { pdf: function (D) { return translate(D).then(function () { return pdf(D); }); }, docx: function (D) { return translate(D).then(function () { return docx(D); }); }, print: printView, html: html, needsPrint: needsPrint, translate: translate, art: art, chart: chart, clean: clean };
})();
