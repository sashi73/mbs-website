// v105: the Wonder Bird voucher as a PDF (A5 landscape, MBS black and gold). Made out to the winner, with the voucher
// number (MBS-000001), the dollar value, the dates, the conditions, and a QR code holding the number, the value and the
// check code: scanning it opens the site's voucher check page, which says whether it is genuine and still good.
import QRCode from 'qrcode';
import LOGO from './logo-png.mjs';
import { pdfLib, business } from './pdf.mjs';
import { verifyLink, VALID_DAYS } from './promo.mjs';

const safe = (s) => String(s ?? '').replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/[–—−]/g, '-').replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
const nice = (ymd) => { const d = new Date(String(ymd).slice(0, 10) + 'T00:00:00Z'); return isNaN(d) ? '' : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); };
const PLACE = { 1: '1st', 2: '2nd', 3: '3rd' };

export const CONDITIONS = (v) => [
  `Worth $${v.amount} off the price of building, repair or maintenance work by Modern Building Solutions (including GST).`,
  'One voucher per job. Vouchers cannot be combined: two vouchers go on two different jobs.',
  `Valid until ${nice(v.expires)} (${VALID_DAYS} days from issue). It can be used once and cannot be exchanged for cash; no change is given.`,
  'Made out to the person named above. Show this voucher (on screen or printed) when you book the job; we scan the QR code to check it.',
  'Lost, altered or copied vouchers are not valid. Modern Building Solutions may check any voucher, and its decision is final.'
];

export async function voucherPdf(player, v, origin) {
  const { PDFDocument, StandardFonts, rgb } = await pdfLib();
  const B = business(), link = verifyLink(origin, v);
  const pdf = await PDFDocument.create();
  pdf.setTitle('MBS voucher ' + v.code); pdf.setAuthor(B.name); pdf.setCreator(B.name); pdf.setProducer(B.name); pdf.setSubject('Wonder Bird voucher');
  const reg = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await pdf.embedPng(Buffer.from(LOGO, 'base64'));
  const qr = await pdf.embedPng(await QRCode.toBuffer(link, { type: 'png', margin: 1, width: 360, errorCorrectionLevel: 'M', color: { dark: '#0A0A0A', light: '#FFFFFF' } }));
  const W = 595.28, H = 419.53, page = pdf.addPage([W, H]);
  const GOLD = rgb(0.83, 0.69, 0.22), GOLD2 = rgb(0.95, 0.85, 0.55), INK = rgb(0.04, 0.04, 0.04), WHITE = rgb(1, 1, 1), MUTED = rgb(0.72, 0.70, 0.65);
  const text = (t, x, y, size, font, color, opts = {}) => page.drawText(safe(t), { x, y, size, font: font || reg, color: color || WHITE, ...opts });
  const right = (t, xr, y, size, font, color) => text(t, xr - (font || reg).widthOfTextAtSize(safe(t), size), y, size, font, color);
  const wrap = (t, x, y, size, maxW, lh, color, font) => {
    const words = safe(t).split(' '); let line = '', yy = y;
    for (const w of words) { const test = line ? line + ' ' + w : w; if ((font || reg).widthOfTextAtSize(test, size) > maxW && line) { text(line, x, yy, size, font, color); yy -= lh; line = w; } else line = test; }
    if (line) { text(line, x, yy, size, font, color); yy -= lh; }
    return yy;
  };

  // the card: black with a gold frame and a soft gold band
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: INK });
  page.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: GOLD });
  page.drawRectangle({ x: 14, y: 14, width: W - 28, height: H - 34, borderColor: GOLD, borderWidth: 1.2 });
  for (let i = 0; i < 40; i++) page.drawRectangle({ x: 14 + i * 5, y: 14, width: 5, height: H - 34, color: GOLD, opacity: 0.06 * (1 - i / 40) });
  // logo on a white tile so it reads on black
  page.drawRectangle({ x: 30, y: H - 84, width: 118, height: 52, color: WHITE });
  page.drawImage(logo, { x: 36, y: H - 80, width: 106, height: 106 * logo.height / logo.width });
  text('GIFT VOUCHER', 166, H - 52, 11, bold, GOLD, { characterSpacing: 2.5 });
  text('Wonder Bird weekly winner', 166, H - 70, 12, reg, MUTED);
  // value
  text('$' + v.amount, 30, H - 178, 84, bold, GOLD2);
  text('off your next MBS job', 32, H - 198, 12, reg, MUTED);
  // made out to
  text('PRESENTED TO', 32, H - 226, 8.5, bold, GOLD, { characterSpacing: 1.6 });
  text(player.first + ' ' + player.last, 32, H - 248, 20, bold, WHITE);
  text(`${PLACE[v.place] || v.place + 'th'} place, week ${v.week} (score ${Number(v.score || 0).toLocaleString('en-AU')})`, 32, H - 264, 10, reg, MUTED);
  // number and dates
  const col = (label, val, x) => { text(label, x, H - 288, 8, bold, GOLD, { characterSpacing: 1.4 }); text(val, x, H - 304, 12, bold, WHITE); };
  col('VOUCHER NO.', v.code, 32); col('ISSUED', nice(new Date(v.issuedAt).toISOString()), 152); col('VALID UNTIL', nice(v.expires), 262);
  // QR code with the check code
  const qx = W - 30 - 150, qy = H - 250;
  page.drawRectangle({ x: qx - 8, y: qy - 8, width: 166, height: 166, color: WHITE });
  page.drawImage(qr, { x: qx, y: qy, width: 150, height: 150 });
  right('Scan to check it is genuine', W - 30, qy - 24, 9, bold, GOLD2);
  right('Check code: ' + (v.check || ''), W - 30, qy - 38, 10, bold, WHITE);
  right(v.code + '  ·  $' + v.amount, W - 30, qy - 52, 9, reg, MUTED);
  // conditions
  page.drawLine({ start: { x: 30, y: 104 }, end: { x: W - 30, y: 104 }, thickness: 0.6, color: GOLD, opacity: 0.6 });
  text('CONDITIONS', 32, 92, 7.5, bold, GOLD, { characterSpacing: 1.4 });
  let y = 81;
  CONDITIONS(v).forEach((c, i) => { y = wrap((i + 1) + '. ' + c, 32, y, 6.8, W - 64, 8.4, MUTED); });
  text(`${B.name} · ABN ${B.abn} · Builder licence ${B.licence} · ${B.phone} · ${B.email} · ${B.web}`, 32, 22, 6.5, reg, rgb(0.55, 0.53, 0.5));
  return Buffer.from(await pdf.save());
}
