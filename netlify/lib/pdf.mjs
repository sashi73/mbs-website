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
    web: env('PUBLIC_WEBSITE', 'mbsplc.com.au'), address: env('BUSINESS_ADDRESS', 'Sydney NSW'),
    bankName: env('BANK_ACCOUNT_NAME'), bsb: env('BANK_BSB'), account: env('BANK_ACCOUNT_NUMBER')
  };
}

export async function buildPdf(doc) {
  await pdfLib();
  const B = business();
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${doc.type === 'quote' ? 'Quote' : 'Tax invoice'} ${doc.id}`); pdf.setAuthor(B.name); pdf.setCreator(B.name); pdf.setProducer(B.name);
  const reg = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await pdf.embedPng(Buffer.from(LOGO, 'base64'));
  const W = 595.28, H = 841.89, M = 40;
  const t = calc(doc.items || [], doc.pricesInc);
  const isInv = doc.type === 'invoice';
  let page, y;
  const pages = [];

  const text = (s, x, yy, o = {}) => {
    const f = o.bold ? bold : reg, size = o.size || 9.5, str = safe(s);
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

  // ---------- footer on every page ----------
  pages.forEach((pg, i) => {
    page = pg;
    page.drawLine({ start: { x: M, y: 40 }, end: { x: W - M, y: 40 }, thickness: 0.6, color: LINE });
    text(`${B.name} - ABN ${B.abn} - Builder licence ${B.licence} - ${B.web}`, M, 28, { size: 8, color: GREY });
    text(`Page ${i + 1} of ${pages.length}`, W - M, 28, { size: 8, color: GREY, align: 'right' });
  });
  return pdf.save();
}
