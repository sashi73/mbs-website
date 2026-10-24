// Customer location for the team: distance from the MBS base, a Google Maps directions link,
// and a QR code of that link (scan it from the email with a phone to open the route in Google Maps).
//
// Base (where the team starts from) - change in .env:
//   BASE_LOCATION=Box Hill NSW 2765   BASE_LAT=-33.6503   BASE_LNG=150.8647
import { deflateSync } from 'node:zlib';
import qrcode from './vendor/qrcode-generator.cjs';
import { env, clean } from './shared.mjs';

export function base() {
  const lat = Number(env('BASE_LAT', '-33.6503'));
  const lng = Number(env('BASE_LNG', '150.8647'));
  return { name: env('BASE_LOCATION', 'Box Hill NSW 2765'), lat: Number.isFinite(lat) ? lat : -33.6503, lng: Number.isFinite(lng) ? lng : 150.8647 };
}

// Straight-line distance in km (Google Maps shows the real driving distance and time)
export function distanceKm(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// From the lead: suburb, postcode and (when picked from the suggestion list) lat/lng.
export function customerLocation(lead) {
  const suburb = clean(lead && lead.suburb, 80);
  if (!suburb) return null;
  const postcode = /^\d{4}$/.test(String(lead.postcode || '')) ? String(lead.postcode) : '';
  const lat = Number(lead.lat), lng = Number(lead.lng);
  // only trust coordinates that are actually in the Sydney region of NSW
  const hasPoint = Number.isFinite(lat) && Number.isFinite(lng) && lat < -32.5 && lat > -35.5 && lng > 149.5 && lng < 152.5;
  const label = /\bNSW\b/i.test(suburb) ? suburb : `${suburb} NSW${postcode && !suburb.includes(postcode) ? ' ' + postcode : ''}`;
  const b = base();
  const km = hasPoint ? distanceKm(b, { lat, lng }) : null;
  const mapsUrl = 'https://www.google.com/maps/dir/?api=1&travelmode=driving' +
    '&origin=' + encodeURIComponent(b.name) + '&destination=' + encodeURIComponent(label + ', Australia');
  return { label, km: km === null ? null : Math.round(km), base: b.name, mapsUrl };
}

export function distanceText(loc) {
  if (!loc) return '';
  return loc.km === null ? `Directions from ${loc.base}` : `about ${loc.km} km from ${loc.base} (straight line)`;
}

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
