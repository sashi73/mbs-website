// Branded A4 PDF for quotes and tax invoices (pdf-lib, no other software needed on Netlify).
// Meets the ATO tax-invoice rules: "Tax invoice", seller name + ABN, date, items, GST, total, buyer details.
import LOGO from './logo-png.mjs';
import { env } from './shared.mjs';
import { calc, money, prettyDate } from './accounts.mjs';

// pdf-lib is big, so it is only loaded when a PDF is actually made (keeps every other console click fast)
let PDFDocument, StandardFonts, rgb, GOLD, INK, GREY, LINE, PALE;
export async function pdfLib() {
  if (!rgb) {
    ({ PDFDocument, StandardFonts, rgb } = await import('pdf-lib'));
    GOLD = rgb(0.79, 0.64, 0.15); INK = rgb(0.08, 0.08, 0.08); GREY = rgb(0.42, 0.41, 0.38); LINE = rgb(0.88, 0.87, 0.84); PALE = rgb(0.985, 0.97, 0.92);
  }
  return { PDFDocument, StandardFonts, rgb };
}
// Standard PDF fonts only know Western characters: swap the common typographic ones, drop the rest
const safe = (s) => String(s ?? '').replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/[–—−]/g, '-')
  .replace(/…/g, '...').replace(/[•·]/g, '-').replace(/ /g, ' ').replace(/[\r\t]/g, ' ').replace(/[^\n\x20-\x7E\xA0-\xFF]/g, '');

export function business() {
  return {
    name: env('BUSINESS_LEGAL_NAME', 'Modern Building Solutions Pty Ltd'),
    abn: env('BUSINESS_ABN', '50 159 309 181'), licence: env('BUILDER_LICENCE', '267071C'),
    phone: env('PUBLIC_PHONE', '0420 494 990'), email: env('PUBLIC_CONTACT_EMAIL', 'mbs.pty.ltd@gmail.com'),
    web: env('PUBLIC_WEBSITE', 'mbsplc.com.au'), address: env('BUSINESS_ADDRESS', 'Sydney NSW'), slogan: env('BUSINESS_SLOGAN', 'Quality building, repairs and maintenance. Done right, built to last.'),
    bankName: env('BANK_ACCOUNT_NAME'), bsb: env('BANK_BSB'), account: env('BANK_ACCOUNT_NUMBER')
  };
}

export async function buildPdf(doc, opts = {}) {
  await pdfLib();
  const B = business();
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${doc.type === 'quote' ? 'Quote' : 'Tax invoice'} ${doc.id}`); pdf.setAuthor(B.name); pdf.setCreator(B.name); pdf.setProducer(B.name);
  const reg = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold), ital = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const logo = await pdf.embedPng(Buffer.from(LOGO, 'base64'));
  const W = 595.28, H = 841.89, M = 40;
  const t = calc(doc.items || [], doc.pricesInc);
  const isInv = doc.type === 'invoice';
  let page, y;
  const pages = [];

  const text = (s, x, yy, o = {}) => {
    const f = o.bold ? bold : o.italic ? ital : reg, size = o.size || 9.5, str = safe(s);
    const w = f.widthOfTextAtSize(str, size);
    const xx = o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x;
    page.drawText(str, { x: xx, y: yy, size, font: f, color: o.color || INK });
    return w;
  };
  const wrap = (s, width, size = 9.5, f = reg) => {
    const out = [];
    for (const para of safe(s).split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/)) {
        const tryL = line ? line + ' ' + word : word;
        if (f.widthOfTextAtSize(tryL, size) <= width) { line = tryL; continue; }
        if (line) out.push(line);
        let w = word;
        while (f.widthOfTextAtSize(w, size) > width) { let i = w.length; while (i > 1 && f.widthOfTextAtSize(w.slice(0, i), size) > width) i--; out.push(w.slice(0, i)); w = w.slice(i); }
        line = w;
      }
      out.push(line);
    }
    return out;
  };
  const COLS = { desc: M + 8, qty: 352, unit: 422, gst: 478, amt: W - M - 8 };
  const tableHead = () => {
    page.drawRectangle({ x: M, y: y - 6, width: W - 2 * M, height: 22, color: INK });
    text('Description', COLS.desc, y + 1, { bold: true, color: rgb(1, 1, 1), size: 9 });
    text('Qty', COLS.qty, y + 1, { bold: true, color: rgb(1, 1, 1), size: 9, align: 'right' });
    text(doc.pricesInc ? 'Unit (inc GST)' : 'Unit (ex GST)', COLS.unit, y + 1, { bold: true, color: rgb(1, 1, 1), size: 9, align: 'right' });
    text('GST', COLS.gst, y + 1, { bold: true, color: rgb(1, 1, 1), size: 9, align: 'right' });
    text('Amount', COLS.amt, y + 1, { bold: true, color: rgb(1, 1, 1), size: 9, align: 'right' });
    y -= 26;
  };
  const newPage = (first) => {
    page = pdf.addPage([W, H]); pages.push(page);
    y = H - M;
    if (!first) { text(`${isInv ? 'Tax invoice' : 'Quote'} ${doc.id} (continued)`, M, y - 10, { bold: true, size: 11 }); y -= 34; tableHead(); }
  };

  // ---------- quote / invoice pack: cover page + the document + 2 pages of high-level project management plan ----------
  const plan = opts.plan || null;
  const docTitle = isInv ? 'Tax invoice' : 'Quote';
  const fit = (s, width, size, f = reg) => { let x = safe(s); if (f.widthOfTextAtSize(x, size) <= width) return x; while (x.length > 1 && f.widthOfTextAtSize(x + '...', size) > width) x = x.slice(0, -1); return x.trimEnd() + '...'; };
  const pd = (s) => (s ? prettyDate(s) : '-');
  const coverPage = () => {
    page = pdf.addPage([W, H]); pages.push(page);
    const lw = 250, lh = lw * logo.height / logo.width;
    page.drawImage(logo, { x: (W - lw) / 2, y: H - 110 - lh, width: lw, height: lh });
    let cy = H - 110 - lh - 30;
    text(B.slogan, W / 2, cy, { size: 14, align: 'center', color: GREY, italic: true }); cy -= 26;
    page.drawRectangle({ x: W / 2 - 60, y: cy, width: 120, height: 3, color: GOLD }); cy -= 46;
    text(isInv ? 'TAX INVOICE & PROJECT SUMMARY' : 'QUOTE & PROJECT MANAGEMENT PLAN', W / 2, cy, { bold: true, size: 20, align: 'center' }); cy -= 30;
    for (const l of wrap(plan.name || doc.title || '', W - 2 * M - 60, 15, bold).slice(0, 2)) { text(l, W / 2, cy, { bold: true, size: 15, align: 'center', color: GREY }); cy -= 20; }
    cy -= 22;
    // two boxes: prepared for / details
    const bw = (W - 2 * M - 16) / 2, bh = 128, by0 = cy - bh;
    const c = doc.customer || {};
    const boxIn = (x, title, rows) => {
      page.drawRectangle({ x, y: by0, width: bw, height: bh, color: PALE, borderColor: rgb(0.93, 0.87, 0.66), borderWidth: 1 });
      text(title, x + 14, by0 + bh - 20, { bold: true, size: 8.5, color: GOLD });
      let ry = by0 + bh - 38;
      for (const [k, v, strong] of rows) { if (!v) continue; if (k) { text(k, x + 14, ry, { size: 8.5, color: GREY }); text(fit(v, bw - 110, 9.5, strong ? bold : reg), x + 96, ry, { size: 9.5, bold: !!strong }); } else text(fit(v, bw - 28, strong ? 11 : 9.5, strong ? bold : reg), x + 14, ry, { size: strong ? 11 : 9.5, bold: !!strong, color: strong ? INK : GREY }); ry -= 15; }
    };
    boxIn(M, isInv ? 'BILL TO' : 'PREPARED FOR', [['', c.name || 'Customer', true], ...wrap(c.address || '', bw - 28).slice(0, 2).map((l) => ['', l]), ['', c.phone], ['', c.email]]);
    boxIn(M + bw + 16, 'DETAILS', [[isInv ? 'Invoice no.' : 'Quote no.', doc.id, true], ['Date', pd(doc.issued)], isInv ? ['Due date', pd(doc.due)] : ['Valid until', pd(doc.validUntil)], ['Job', doc.core],
      ['Start', pd(plan.start)], ['Finish', pd(plan.finish) + (plan.days ? ` (${plan.days} working days)` : '')]]);
    cy = by0 - 26;
    page.drawRectangle({ x: M, y: cy - 34, width: W - 2 * M, height: 48, color: INK });
    text(isInv ? (doc.paid > 0 ? 'Balance due (inc GST)' : 'Total (inc GST)') : 'Total quote (inc GST)', M + 18, cy - 15, { bold: true, size: 12, color: rgb(1, 1, 1) });
    text(money(isInv ? t.inc - (doc.paid || 0) : t.inc), W - M - 18, cy - 17, { bold: true, size: 20, color: GOLD, align: 'right' });
    cy -= 62;
    const what = isInv ? [`Page 2: Tax invoice ${doc.id}`, 'Pages 3-4: Project summary: scope, progress, milestones and Gantt chart']
      : [`Page 2: Quote ${doc.id} (prices, GST and how to accept)`, 'Page 3: Project management plan: objective, scope, deliverables, risks', 'Page 4: Schedule: milestones and Gantt chart'];
    text('INSIDE', M, cy, { bold: true, size: 8.5, color: GOLD }); cy -= 15;
    for (const l of what) { text('- ' + l, M, cy, { size: 9.5, color: GREY }); cy -= 13.5; }
    // bottom band
    page.drawRectangle({ x: 0, y: 0, width: W, height: 96, color: INK });
    page.drawRectangle({ x: 0, y: 96, width: W, height: 4, color: GOLD });
    text(B.name, W / 2, 64, { bold: true, size: 12, align: 'center', color: rgb(1, 1, 1) });
    text(`ABN ${B.abn}   -   Builder licence ${B.licence}`, W / 2, 46, { size: 9.5, align: 'center', color: rgb(0.85, 0.84, 0.8) });
    text(`${B.phone}   -   ${B.email}   -   ${B.web}`, W / 2, 30, { size: 9.5, align: 'center', color: rgb(0.85, 0.84, 0.8) });
  };
  const planPages = () => {
    const ch = plan.charter || {};
    const head = (title, sub) => {
      page = pdf.addPage([W, H]); pages.push(page);
      const lw2 = 90, lh2 = lw2 * logo.height / logo.width;
      page.drawImage(logo, { x: W - M - lw2, y: H - M - lh2 + 8, width: lw2, height: lh2 });
      text(title, M, H - M - 8, { bold: true, size: 17 });
      text(fit(sub, W - 2 * M - lw2 - 20, 10), M, H - M - 25, { size: 10, color: GREY });
      page.drawRectangle({ x: M, y: H - M - 36, width: 90, height: 3, color: GOLD });
      y = H - M - 58;
    };
    const label = (s, x = M) => text(s.toUpperCase(), x, y, { bold: true, size: 8.5, color: GOLD });
    const para = (s, x, width, maxLines, size = 9.5) => {   // text with "- " lines as bullets
      let lines = [];
      for (const raw of String(s || '').replace(/:\s+-\s+/g, ':\n- ').split('\n').map((l) => l.trim()).filter(Boolean)) {
        const b = /^[-*•]\s*/.test(raw), body = raw.replace(/^[-*•]\s*/, '');
        wrap(body, width - (b ? 10 : 0), size).forEach((l, i) => lines.push([l, b && i === 0, b]));
      }
      if (!lines.length) lines = [['-', false, false]];
      if (lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1][0] = fit(lines[maxLines - 1][0] + ' ...', width - 10, size); }
      let yy = y;
      for (const [l, dot, ind] of lines) { if (dot) page.drawCircle({ x: x + 2.5, y: yy + 3, size: 1.6, color: GOLD }); text(l, x + (ind ? 10 : 0), yy, { size }); yy -= size + 3.2; }
      return y - yy;
    };
    const block = (title, s, maxLines) => { label(title); y -= 14; y -= para(s, M, W - 2 * M, maxLines) + 8; };
    const two = (t1, s1, t2, s2, maxLines) => {
      const cw = (W - 2 * M - 20) / 2; label(t1, M); label(t2, M + cw + 20); y -= 14;
      const h = Math.max(para(s1, M, cw, maxLines), para(s2, M + cw + 20, cw, maxLines)); y -= h + 8;
    };
    // ---- page: the plan ----
    head(isInv ? 'Project summary' : 'Project management plan', `${plan.name}  -  ${doc.customer.name || ''}  -  ${doc.id}`);
    const ov = [['Project', plan.name], ['Customer', doc.customer.name], ['Site', doc.customer.address], ['Job', doc.core], ['Project manager', ch.manager || B.name],
      ['Planned start', pd(plan.start)], ['Planned finish', pd(plan.finish)], ['Duration', plan.days ? `${plan.days} working days` : '-'], [isInv ? 'Invoice value' : 'Quote value', money(t.inc) + ' inc GST'],
      isInv ? ['Progress', `${plan.pct}% complete (${plan.done} of ${plan.total} tasks done)`] : ['Tasks', `${plan.total} tasks, ${plan.tasks.filter((x) => x.mile).length} milestones`]];
    const cw = (W - 2 * M - 20) / 2, rowsN = Math.ceil(ov.length / 2);
    page.drawRectangle({ x: M, y: y - rowsN * 15 - 6, width: W - 2 * M, height: rowsN * 15 + 18, color: PALE });
    ov.forEach(([k, v], i) => { const x = i < rowsN ? M + 10 : M + cw + 30, yy = y - (i % rowsN) * 15; text(k, x, yy, { size: 8.5, color: GREY }); text(fit(v || '-', cw - 100, 9.5), x + 88, yy, { size: 9.5, bold: k === 'Project' }); });
    y -= rowsN * 15 + 22;
    block('Objective', ch.objective, 3);
    two('In scope', ch.inScope, 'Out of scope', ch.outScope, 11);
    two('Deliverables', ch.deliverables, 'Acceptance (how we know it is done)', ch.acceptance, 5);
    block('Assumptions & constraints', ch.assumptions, 4);
    // key risks
    if (plan.risks && plan.risks.length && y > 230) {
      label('Key risks and how we will handle them'); y -= 8;
      const cx = [M + 6, M + 230, M + 262, M + 322];
      page.drawRectangle({ x: M, y: y - 14, width: W - 2 * M, height: 16, color: INK });
      [['Risk', 0], ['P x I', 1], ['Response', 2], ['Action', 3]].forEach(([h, i]) => text(h, cx[i], y - 10, { bold: true, size: 8.5, color: rgb(1, 1, 1) }));
      y -= 28;
      for (const r of plan.risks.slice(0, 5)) {
        if (y < 175) break;
        const al = wrap(r.act || '-', W - M - cx[3] - 6, 8.5).slice(0, 2), tl = wrap(r.t, cx[1] - cx[0] - 8, 8.5).slice(0, 2), h = Math.max(al.length, tl.length) * 11 + 4;
        tl.forEach((l, i) => text(l, cx[0], y - i * 11, { size: 8.5 }));
        const sc = r.p * r.i; text(String(sc), cx[1] + 8, y, { size: 8.5, bold: true, color: sc >= 15 ? rgb(0.71, 0.14, 0.09) : sc >= 8 ? rgb(0.57, 0.25, 0.05) : rgb(0.09, 0.4, 0.2) });
        text(r.resp || '', cx[2], y, { size: 8.5 }); al.forEach((l, i) => text(l, cx[3], y - i * 11, { size: 8.5, color: GREY }));
        page.drawLine({ start: { x: M, y: y - h + 7 }, end: { x: W - M, y: y - h + 7 }, thickness: 0.5, color: LINE });
        y -= h + 2;
      }
      y -= 6;
    }
    // how the job is run
    if (y > 120) {
      const how = ['Communication: you will have one point of contact and frequent progress updates (phone, SMS or email).',
        'Safety: safe work method statements, site protection and tidy work areas every day.',
        'Quality: work checked against the acceptance criteria and Australian Standards; photos kept of key stages (e.g. waterproofing).',
        'Changes: any change to scope, price or dates is agreed in writing (a variation) before the work is done.'];
      label('How we run the job'); y -= 14;
      for (const l of how) { if (y < 70) break; const ws = wrap(l, W - 2 * M - 10, 8.8); page.drawCircle({ x: M + 2.5, y: y + 3, size: 1.6, color: GOLD }); ws.forEach((w, i) => text(w, M + 10, y - i * 11.5, { size: 8.8, color: GREY })); y -= ws.length * 11.5 + 2; }
    }
    // ---- page: schedule + Gantt ----
    head(isInv ? 'Schedule and progress' : 'Schedule and milestones', `${plan.name}  -  planned ${pd(plan.start)} to ${pd(plan.finish)}`);
    const miles = plan.tasks.filter((x) => x.mile);
    if (miles.length) {
      label('Milestones'); y -= 14;
      const mcw = (W - 2 * M) / 2;
      miles.slice(0, 10).forEach((m, i) => { const x = i % 2 ? M + mcw : M, yy = y - Math.floor(i / 2) * 14; page.drawRectangle({ x: x + 1, y: yy, width: 6, height: 6, color: GOLD, rotate: { type: 'degrees', angle: 45 } }); text(fit(m.n, mcw - 90, 9.5), x + 14, yy, { size: 9.5 }); text(pd(m.es), x + mcw - 14, yy, { size: 9.5, bold: true, align: 'right' }); });
      y -= Math.ceil(Math.min(10, miles.length) / 2) * 14 + 10;
    }
    label(isInv ? 'Gantt chart (bars filled to show progress)' : 'Gantt chart'); y -= 10;
    const tasks = plan.tasks.filter((x) => x.es);
    if (tasks.length && plan.start && plan.finish) {
      const toD = (s) => { const a = s.split('-').map(Number); return Date.UTC(a[0], a[1] - 1, a[2]); };
      const day0 = toD(plan.start) - 864e5, dayN = toD(plan.finish) + 864e5, span = Math.max(1, Math.round((dayN - day0) / 864e5) + 1);
      const nameW = 170, x0 = M + nameW + 64, gw = W - M - x0, dw = gw / span;
      const avail = y - 250 > 20 * (tasks.length + 2) ? y - 250 : y - 70, rh = Math.max(9, Math.min(20, avail / (tasks.length + 2)));
      const show = tasks.slice(0, Math.floor(avail / rh) - 1);
      // scale: weekly ticks
      const top = y, bottom = y - rh * (show.length + 1) - 4;
      for (let d = 0; d < span; d++) {
        const ms = day0 + d * 864e5, dt = new Date(ms), wd = dt.getUTCDay();
        if (wd === 0 || wd === 6) page.drawRectangle({ x: x0 + d * dw, y: bottom, width: dw, height: top - bottom - rh, color: rgb(0.965, 0.96, 0.95) });
        if (wd === 1 || d === 0) { page.drawLine({ start: { x: x0 + d * dw, y: bottom }, end: { x: x0 + d * dw, y: top - rh + 4 }, thickness: 0.4, color: LINE }); if (dw * 7 > 28 || d === 0) text(`${dt.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][dt.getUTCMonth()]}`, x0 + d * dw + 2, top - rh + 6, { size: 7, color: GREY }); }
      }
      text('Task', M, top - rh + 6, { bold: true, size: 7.5, color: GREY }); text('Dates', M + nameW + 2, top - rh + 6, { bold: true, size: 7.5, color: GREY });
      let ry = top - rh * 2 + 4;
      const fs = Math.min(8.5, rh - 2.5);
      for (const tk of show) {
        text(fit(tk.n, nameW - 6, fs, tk.mile ? bold : reg), M, ry + 1, { size: fs, bold: tk.mile });
        text(tk.mile ? pd(tk.es).replace(/ \d{4}$/, '') : `${pd(tk.es).replace(/ \d{4}$/, '')} - ${pd(tk.ef).replace(/ \d{4}$/, '')}`, M + nameW + 2, ry + 1, { size: Math.min(7.5, fs), color: GREY });
        const bx = x0 + Math.round((toD(tk.es) - day0) / 864e5) * dw, bw2 = (Math.round((toD(tk.ef) - toD(tk.es)) / 864e5) + 1) * dw, bh2 = Math.max(5, rh - 6);
        if (tk.mile) page.drawRectangle({ x: bx + dw / 2, y: ry - 1, width: bh2 * 0.75, height: bh2 * 0.75, color: INK, rotate: { type: 'degrees', angle: 45 } });
        else {
          page.drawRectangle({ x: bx, y: ry - 2, width: Math.max(2, bw2), height: bh2, color: isInv ? rgb(0.93, 0.89, 0.75) : GOLD });
          if (isInv && tk.pct > 0) page.drawRectangle({ x: bx, y: ry - 2, width: Math.max(2, bw2) * tk.pct / 100, height: bh2, color: tk.pct >= 100 ? rgb(0.09, 0.5, 0.24) : GOLD });
        }
        page.drawLine({ start: { x: M, y: ry - 4 }, end: { x: W - M, y: ry - 4 }, thickness: 0.3, color: LINE });
        ry -= rh;
      }
      if (tasks.length > show.length) text(`... and ${tasks.length - show.length} more tasks (full schedule available on request)`, M, ry, { size: 8, color: GREY });
      y = ry - 16;
    }
    if (y > 60) {
      for (const l of wrap('Dates are working days (Monday to Friday) and may move with weather, access, approvals and material supply. We will keep you updated if anything changes.', W - 2 * M, 8.5)) { text(l, M, y, { size: 8.5, color: GREY }); y -= 11; }
    }
    // what happens next (quote) / where the job is at (invoice)
    const steps = isInv
      ? [`Progress: ${plan.pct}% complete, ${plan.done} of ${plan.total} tasks done${plan.late ? `, ${plan.late} running late` : ''} (as at ${pd(plan.today)}).`,
        `Amount due: ${money(t.inc - (doc.paid || 0))} by ${pd(doc.due)}. Please use ${doc.id} as the payment reference.`,
        'Warranty and any certificates (e.g. waterproofing, electrical compliance) are handed over with the final payment.',
        `Questions about this invoice or the work: call ${B.phone} or email ${B.email}.`]
      : [`Accept the quote: reply to the email or call ${B.phone} before ${pd(doc.validUntil)}.`,
        'We confirm the start date with you and order the materials.',
        'The work follows this schedule. You get an update frequently, and any change is agreed in writing first.',
        'Final check with you against the acceptance criteria, then clean-up and handover.',
        `Tax invoice at completion, payable within 7 days.`];
    if (y > 150) {
      y -= 12; label(isInv ? 'Where the job is at' : 'What happens next'); y -= 16;
      steps.forEach((l, i) => {
        if (y < 60) return;
        page.drawCircle({ x: M + 8, y: y + 3, size: 8, color: isInv ? GOLD : INK });
        text(String(i + 1), M + 8, y, { size: 8.5, bold: true, align: 'center', color: rgb(1, 1, 1) });
        const ws = wrap(l, W - 2 * M - 26, 9.5); ws.forEach((w, j) => text(w, M + 24, y - j * 12, { size: 9.5 })); y -= ws.length * 12 + 9;
      });
    }
  };

  if (plan) coverPage();
  // ---------- header ----------
  newPage(true);
  const lw = 150, lh = lw * logo.height / logo.width;
  page.drawImage(logo, { x: M - 4, y: H - M - lh + 6, width: lw, height: lh });
  text(isInv ? 'TAX INVOICE' : 'QUOTE', W - M, H - M - 18, { bold: true, size: 24, align: 'right' });
  page.drawRectangle({ x: W - M - 120, y: H - M - 28, width: 120, height: 3, color: GOLD });
  const meta = [[isInv ? 'Invoice no.' : 'Quote no.', doc.id], ['Date', prettyDate(doc.issued)],
    isInv ? ['Due date', prettyDate(doc.due)] : ['Valid until', prettyDate(doc.validUntil)], doc.core ? ['Job', doc.core] : null].filter(Boolean);
  let my = H - M - 48;
  for (const [k, v] of meta) { text(k, W - M - 110, my, { color: GREY, size: 9, align: 'right' }); text(v, W - M, my, { bold: true, size: 9.5, align: 'right' }); my -= 14; }

  y = H - M - Math.max(lh, 100) - 14;
  // from / to
  const colW = (W - 2 * M - 20) / 2;
  text('FROM', M, y, { bold: true, size: 8, color: GOLD }); text(isInv ? 'BILL TO' : 'PREPARED FOR', M + colW + 20, y, { bold: true, size: 8, color: GOLD });
  y -= 14;
  const from = [[B.name, true], [`ABN ${B.abn}`], [`Builder licence ${B.licence}`], [B.address], [`${B.phone} - ${B.email}`], [B.web]];
  const c = doc.customer || {};
  const to = [[c.name || 'Customer', true], ...wrap(c.address || '', colW).filter(Boolean).map((l) => [l]), [c.phone], [c.email]].filter((x) => x[0]);
  const rows = Math.max(from.length, to.length);
  for (let i = 0; i < rows; i++) {
    if (from[i]) text(from[i][0], M, y, { bold: !!from[i][1], size: from[i][1] ? 10.5 : 9.5, color: from[i][1] ? INK : GREY });
    if (to[i]) text(to[i][0], M + colW + 20, y, { bold: !!to[i][1], size: to[i][1] ? 10.5 : 9.5, color: to[i][1] ? INK : GREY });
    y -= 13.5;
  }
  y -= 10;
  if (doc.title) { for (const l of wrap(doc.title, W - 2 * M, 12, bold)) { text(l, M, y, { bold: true, size: 12 }); y -= 16; } y -= 4; }

  // ---------- items ----------
  tableHead();
  t.lines.forEach((l, i) => {
    const lines = wrap(l.desc || '-', COLS.qty - COLS.desc - 40);
    const h = lines.length * 12 + 8;
    if (y - h < 150) newPage(false);
    if (i % 2 === 1) page.drawRectangle({ x: M, y: y - h + 10, width: W - 2 * M, height: h, color: rgb(0.975, 0.972, 0.962) });
    lines.forEach((ln, j) => text(ln, COLS.desc, y - j * 12));
    text(String(l.qty), COLS.qty, y, { align: 'right' });
    text(money(l.price), COLS.unit, y, { align: 'right' });
    text(l.gst ? money(l.gstAmt) : 'GST-free', COLS.gst, y, { align: 'right', color: l.gst ? INK : GREY });
    text(money(doc.pricesInc ? l.inc : l.ex), COLS.amt, y, { align: 'right', bold: true });
    y -= h;
  });
  page.drawLine({ start: { x: M, y: y + 6 }, end: { x: W - M, y: y + 6 }, thickness: 1, color: LINE });

  // ---------- totals ----------
  const tot = [['Subtotal (ex GST)', money(t.ex)], ['GST (10%)', money(t.gst)], [isInv ? 'Total (inc GST)' : 'Total quote (inc GST)', money(t.inc), true]];
  if (isInv && doc.paid > 0) { tot.push(['Paid', '-' + money(doc.paid)]); tot.push(['Balance due', money(t.inc - doc.paid), true]); }
  if (y - tot.length * 18 - 150 < 60) newPage(false);
  y -= 8;
  const tx = W - M - 210;
  for (const [k, v, strong] of tot) {
    if (strong) page.drawRectangle({ x: tx - 8, y: y - 6, width: 218, height: 20, color: PALE });
    text(k, tx, y, { bold: !!strong, size: strong ? 10.5 : 9.5, color: strong ? INK : GREY });
    text(v, W - M - 8, y, { bold: !!strong, size: strong ? 11 : 9.5, align: 'right' });
    y -= strong ? 22 : 16;
  }
  if (isInv && doc.status === 'paid') {
    page.drawRectangle({ x: M, y: y + 30, width: 120, height: 34, borderColor: rgb(0.08, 0.5, 0.24), borderWidth: 2.5, rotate: { type: 'degrees', angle: 0 } });
    text('PAID', M + 60, y + 41, { bold: true, size: 20, align: 'center', color: rgb(0.08, 0.5, 0.24) });
  }

  // ---------- how to pay / accept ----------
  y -= 14;
  const box = (title, lines) => {
    const h = 24 + lines.length * 13;
    if (y - h < 60) newPage(false);
    page.drawRectangle({ x: M, y: y - h + 12, width: W - 2 * M, height: h, color: PALE, borderColor: rgb(0.93, 0.87, 0.66), borderWidth: 1 });
    text(title, M + 12, y - 2, { bold: true, size: 10 });
    lines.forEach((l, i) => text(l[0], M + 12, y - 18 - i * 13, { size: 9.5, bold: !!l[1], color: l[1] ? INK : GREY }));
    y -= h + 10;
  };
  if (isInv && doc.status !== 'paid') {
    const pay = B.bsb && B.account
      ? [[`Please pay ${money(t.inc - (doc.paid || 0))} by ${prettyDate(doc.due)} (${7} days) by bank transfer:`], [`Account name: ${B.bankName || B.name}    BSB: ${B.bsb}    Account: ${B.account}`, true], [`Reference: ${doc.id}`, true]]
      : [[`Please pay ${money(t.inc - (doc.paid || 0))} by ${prettyDate(doc.due)}.`], [`For payment details call ${B.phone} or email ${B.email}. Reference: ${doc.id}`, true]];
    box('How to pay', pay);
  }
  if (!isInv) box('To accept this quote', [[`Reply to the email with this quote, or call ${B.phone}. Prices are valid until ${prettyDate(doc.validUntil)}.`], ['We will confirm a start date and send a tax invoice when the work is done.']]);
  if (doc.notes) box('Notes', wrap(doc.notes, W - 2 * M - 24).slice(0, 18).map((l) => [l]));

  if (plan) planPages();

  // ---------- footer on every page (not the cover) ----------
  pages.forEach((pg, i) => {
    page = pg;
    if (plan && i === 0) return;
    page.drawLine({ start: { x: M, y: 40 }, end: { x: W - M, y: 40 }, thickness: 0.6, color: LINE });
    text(`${B.name} - ABN ${B.abn} - Builder licence ${B.licence} - ${B.web}`, M, 28, { size: 8, color: GREY });
    text(`Page ${i + 1} of ${pages.length}`, W - M, 28, { size: 8, color: GREY, align: 'right' });
  });
  return pdf.save();
}
