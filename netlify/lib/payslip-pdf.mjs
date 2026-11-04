// v107: payslip PDF (A4). Shows what Fair Work says a payslip must: employer name and ABN, employee, pay period and date,
// gross and net pay, every pay line with its hours and rate (ordinary, overtime, penalty rates, loadings, allowances),
// tax withheld, and the super paid; plus the leave balances.
import LOGO from './logo-png.mjs';
import { pdfLib, business } from './pdf.mjs';

const safe = (s) => String(s ?? '').replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/[–—−]/g, '-').replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
const money = (n) => '$' + (Number(n) || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nice = (ymd) => { const d = new Date(String(ymd) + 'T00:00:00Z'); return isNaN(d) ? '' : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); };

export async function payslipPdf(run, l) {
  const { PDFDocument, StandardFonts, rgb } = await pdfLib();
  const B = business(), pdf = await PDFDocument.create();
  pdf.setTitle(`Payslip ${run.id} ${l.name}`); pdf.setAuthor(B.name); pdf.setCreator(B.name); pdf.setProducer(B.name);
  const reg = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await pdf.embedPng(Buffer.from(LOGO, 'base64'));
  const W = 595.28, H = 841.89, M = 44, page = pdf.addPage([W, H]);
  const INK = rgb(0.08, 0.08, 0.08), GREY = rgb(0.42, 0.41, 0.38), GOLD = rgb(0.79, 0.64, 0.15), LINE = rgb(0.86, 0.85, 0.82), PALE = rgb(0.985, 0.97, 0.92);
  const T = (t, x, y, size = 10, font = reg, color = INK) => page.drawText(safe(t), { x, y, size, font, color });
  const R = (t, xr, y, size = 10, font = reg, color = INK) => T(t, xr - font.widthOfTextAtSize(safe(t), size), y, size, font, color);
  let y = H - M;
  page.drawImage(logo, { x: M, y: y - 52, width: 110, height: 110 * logo.height / logo.width });
  R('PAYSLIP', W - M, y - 14, 20, bold, INK);
  R(B.name, W - M, y - 32, 10, bold); R('ABN ' + B.abn, W - M, y - 45, 9, reg, GREY); R(B.phone + '  ·  ' + B.email, W - M, y - 57, 9, reg, GREY);
  y -= 84; page.drawRectangle({ x: M, y: y - 64, width: W - 2 * M, height: 64, color: PALE });
  const kv2 = (label, val, x, yy) => { T(label, x, yy, 8, bold, GREY); T(val, x, yy - 13, 11, bold); };
  kv2('EMPLOYEE', l.name, M + 12, y - 16); kv2('EMPLOYMENT', l.employment + ' · ' + l.classification, M + 200, y - 16); kv2('PAY RUN', run.id, M + 390, y - 16);
  kv2('PAY PERIOD', nice(run.from) + ' to ' + nice(run.to), M + 12, y - 44); kv2('PAYMENT DATE', nice(run.payDate), M + 200, y - 44); kv2('ORDINARY HOURLY RATE', money(l.rate), M + 390, y - 44);
  y -= 92;
  // pay lines
  const cols = [M, M + 290, M + 360, W - M];
  T('PAY ITEM', cols[0], y, 8, bold, GREY); R('HOURS', cols[1] + 40, y, 8, bold, GREY); R('RATE', cols[2] + 60, y, 8, bold, GREY); R('AMOUNT', cols[3], y, 8, bold, GREY);
  y -= 6; page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.8, color: LINE }); y -= 16;
  for (const x of l.lines) {
    T(x.label, cols[0], y, 10); if (x.hours) R(x.hours.toFixed(2), cols[1] + 40, y, 10); if (x.rate) R(money(x.rate), cols[2] + 60, y, 10); R(money(x.amount), cols[3], y, 10);
    y -= 17;
  }
  page.drawLine({ start: { x: M, y: y + 8 }, end: { x: W - M, y: y + 8 }, thickness: 0.8, color: LINE });
  const sum = (label, val, b, col) => { T(label, cols[2] - 60, y, 10.5, b ? bold : reg, col || INK); R(val, cols[3], y, 10.5, b ? bold : reg, col || INK); y -= 18; };
  y -= 8;
  sum('Gross pay', money(l.gross), true);
  sum('PAYG tax withheld', '-' + money(l.tax));
  if (l.stsl) sum('HELP / study loan (STSL)', '-' + money(l.stsl));
  y -= 10;
  page.drawRectangle({ x: cols[2] - 70, y: y - 6, width: W - M - cols[2] + 70, height: 24, color: rgb(0.08, 0.08, 0.08) });
  T('NET PAY', cols[2] - 60, y + 2, 11, bold, rgb(1, 1, 1)); R(money(l.net), cols[3] - 6, y + 2, 12, bold, GOLD);
  y -= 40;
  // super and leave
  T('SUPERANNUATION', M, y, 8, bold, GREY); y -= 15;
  T(`${money(l.super)} paid to your nominated super fund (${(l.ote ? (l.super / l.ote * 100) : 0).toFixed(1)}% of ordinary time earnings of ${money(l.ote)}).`, M, y, 9.5); y -= 13;
  T('Under Payday Super, super is paid with each pay.', M, y, 9, reg, GREY); y -= 26;
  T('LEAVE (HOURS)', M, y, 8, bold, GREY); y -= 15;
  const lv = [['Annual leave', 'annual'], ['Personal / carer\'s leave', 'personal'], ['RDO bank', 'rdo']];
  T('', M, y); R('Accrued', M + 260, y, 8, bold, GREY); R('Taken', M + 330, y, 8, bold, GREY); R('Balance', M + 410, y, 8, bold, GREY); y -= 14;
  for (const [name, k] of lv) { T(name, M, y, 9.5); R((l.accrued[k] || 0).toFixed(2), M + 260, y, 9.5); R((l.taken[k] || 0).toFixed(2), M + 330, y, 9.5); R((l.balances[k] || 0).toFixed(2), M + 410, y, 9.5, bold); y -= 14; }
  y -= 16;
  T('Pay worked out under the Building and Construction General On-site Award 2020. Questions about your pay? Contact ' + B.phone + '.', M, y, 8.5, reg, GREY);
  page.drawLine({ start: { x: M, y: 40 }, end: { x: W - M, y: 40 }, thickness: 0.5, color: LINE });
  T(`${B.name} · ABN ${B.abn} · ${B.web}`, M, 28, 8, reg, GREY);
  return Buffer.from(await pdf.save());
}
