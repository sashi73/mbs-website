// Customer location for the team: a Google Maps directions link to the job and a QR code of that link
// (scan it from the email with a phone). The route always starts from YOUR CURRENT LOCATION:
// the link has no starting point, so Google Maps uses wherever the phone is when it's opened.
import { deflateSync } from 'node:zlib';
import qrcode from './vendor/qrcode-generator.cjs';
import { clean } from './shared.mjs';

// From the lead: suburb, postcode and (when picked from the suggestion list) lat/lng.
export function customerLocation(lead) {
  const suburb = clean(lead && lead.suburb, 80);
  if (!suburb) return null;
  const postcode = /^\d{4}$/.test(String(lead.postcode || '')) ? String(lead.postcode) : '';
  const lat = Number(lead.lat), lng = Number(lead.lng);
  // only trust coordinates that are actually in the Sydney region of NSW
  const hasPoint = Number.isFinite(lat) && Number.isFinite(lng) && lat < -32.5 && lat > -35.5 && lng > 149.5 && lng < 152.5;
  const label = /\bNSW\b/i.test(suburb) ? suburb : `${suburb} NSW${postcode && !suburb.includes(postcode) ? ' ' + postcode : ''}`;
  // no origin = Google Maps starts from the phone's current location
  const mapsUrl = 'https://www.google.com/maps/dir/?api=1&travelmode=driving' +
    '&destination=' + encodeURIComponent(label + ', Australia');
  return { label, km: null, base: 'your current location', hasPoint, mapsUrl };
}

// (Distance isn't shown: Google Maps gives the real distance and drive time from where you are.)
export function distanceText() { return ''; }

// ---------- QR code as a PNG (no extra packages: qrcode-generator + Node's zlib) ----------
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export function qrPng(text, scale = 8, margin = 4) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const size = (n + margin * 2) * scale;
  const raw = Buffer.alloc((size + 1) * size, 255);         // greyscale, white background
  for (let y = 0; y < size; y++) {
    raw[y * (size + 1)] = 0;                                  // PNG filter: none
    const r = Math.floor(y / scale) - margin;
    for (let x = 0; x < size; x++) {
      const c = Math.floor(x / scale) - margin;
      if (r >= 0 && c >= 0 && r < n && c < n && qr.isDark(r, c)) raw[y * (size + 1) + 1 + x] = 0;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // 8-bit greyscale
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
