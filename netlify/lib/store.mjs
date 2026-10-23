// Reference numbers, photos and the SQLite enquiries database.
//
// Reference (pre-job) number:  <TRADE>-<YYMMDD>-<6-digit running number>
//   e.g. R-261017-000001  = Roofing enquiry on 17 Oct 2026, the 1st ever.
//   The running number never resets. When the enquiry becomes a real job
//   it gets a "J" in front: JR-261017-000001 (same digits, easy to match).
//
// Enquiries are saved to data/mbs.db using Node's built-in SQLite (Node 22.5+).
// Photos are saved to data/photos/<reference>/.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA_DIR = join(ROOT, 'data');
const SEQ_FILE = join(DATA_DIR, 'sequence.json');
const DB_FILE = join(DATA_DIR, 'mbs.db');
const PHOTO_DIR = join(DATA_DIR, 'photos');
const SCHEMA_FILE = join(ROOT, 'database', 'schema.sql');

// ---------- trade codes ----------
export const TRADES = {
  B: 'Building & renovations',
  C: 'Concrete & cracks',
  W: 'Waterproofing & leaks',
  R: 'Roofing & gutters',
  T: 'Tiling',
  D: 'Doors & windows',
  G: 'Gyprock & plaster',
  O: 'Outdoor: decks, pergolas & fencing',
  F: 'Painting & finishes',
  E: 'Electrical',
  P: 'Plumbing',
  S: 'Storm damage',
  Q: 'Repair question',
  M: 'General maintenance'
};

// First match wins, so the order matters (e.g. "roof leak" is Roofing, "downpipe" is not Plumbing)
const RULES = [
  ['S', /storm|hail|wind damage|fallen tree|tree (fell|came down)|blown|blew/],
  ['E', /electric|power ?point|socket|spark|switchboard|safety switch|wiring|tripping|no power|burning smell/],
  ['R', /roof|gutter|downpipe|ridge|flashing/],
  ['P', /plumb|\btap\b|toilet|drain|blocked|\bpipe|hot water|sewer|cistern/],
  ['W', /leak|waterproof|water test|damp|mould|mold|water damage|shower|balcony|wet area/],
  ['T', /\btil(e|es|ing)\b|retil|grout|splashback/],
  ['C', /crack|concrete|spalling|render/],
  ['D', /door|window|glass|sliding|bifold|bi-fold/],
  ['G', /gyprock|plaster|ceiling|hole in|cornice|wall or ceiling/],
  ['O', /deck|pergola|fenc|stair|step|railing|balustrade|gate|patio|carport/],
  ['F', /paint|wallpaper|acoustic|finish/],
  ['B', /construct|renovat|extension|upgrade|wall removal|relocat|build/]
];

export function tradeCode(service = '', details = '') {
  const s = String(service).toLowerCase();
  const d = String(details).toLowerCase();
  for (const [code, re] of RULES) if (re.test(s)) return code;   // the job type first
  for (const [code, re] of RULES) if (re.test(d)) return code;   // then the description
  return /repair question/.test(s) ? 'Q' : 'M';
}

// ---------- numbering ----------
function readSeq() {
  mkdirSync(DATA_DIR, { recursive: true });
  return existsSync(SEQ_FILE) ? JSON.parse(readFileSync(SEQ_FILE, 'utf8') || '{}') : {};
}

export function nextReference(code) {
  const d = new Date();
  const yymmdd = String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  const c = TRADES[code] ? code : 'M';
  try {
    const seq = readSeq();
    seq.run = (seq.run || 0) + 1;                       // running number: never resets
    writeFileSync(SEQ_FILE, JSON.stringify(seq, null, 2));
    return `${c}-${yymmdd}-${String(seq.run).padStart(6, '0')}`;
  } catch {
    // Read-only hosting: fall back to a time-based number
    const t = String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0') + String(d.getSeconds()).padStart(2, '0');
    return `${c}-${yymmdd}-${t}`;
  }
}

// Job number from a reference: R-261017-000001 -> JR-261017-000001
export function jobNumberFor(ref) {
  return /^[A-Z]-\d{6}-\d{6}$/.test(ref) ? 'J' + ref : null;
}

// Older style numbers (P-2026-0001) still work for anything created before the change
export function nextNumber(prefix) {
  const year = new Date().getFullYear();
  const seq = readSeq();
  if (seq.year !== year) { seq.year = year; seq.P = 0; seq.J = 0; }
  seq[prefix] = (seq[prefix] || 0) + 1;
  writeFileSync(SEQ_FILE, JSON.stringify(seq, null, 2));
  return `${prefix}-${year}-${String(seq[prefix]).padStart(4, '0')}`;
}

// ---------- photos ----------
const MAGIC = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/webp': (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP'
};
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

// Accepts [{ name, type, data: 'data:image/jpeg;base64,...' }] and returns checked photos.
export function parsePhotos(list, max = 3, maxBytes = 5 * 1024 * 1024) {
  const out = [];
  for (const p of (Array.isArray(list) ? list : []).slice(0, max)) {
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(p && p.data || ''));
    if (!m) continue;
    const buf = Buffer.from(m[2], 'base64');
    if (!buf.length || buf.length > maxBytes || !MAGIC[m[1]](buf)) continue;
    out.push({ type: m[1], buf, base64: m[2], filename: `photo-${out.length + 1}.${EXT[m[1]]}` });
  }
  return out;
}

export function savePhotos(ref, photos) {
  if (!photos.length) return [];
  const dir = join(PHOTO_DIR, ref.replace(/[^A-Za-z0-9-]/g, ''));
  mkdirSync(dir, { recursive: true });
  return photos.map((p) => {
    writeFileSync(join(dir, p.filename), p.buf);
    return `data/photos/${ref}/${p.filename}`;
  });
}

// ---------- SQLite ----------
let dbPromise = null;

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = (async () => {
    const orig = process.emitWarning;                     // hide "SQLite is experimental"
    process.emitWarning = function (w, ...rest) {
      if (String(w && w.message ? w.message : w).includes('SQLite')) return;
      return orig.call(process, w, ...rest);
    };
    try {
      const { DatabaseSync } = await import('node:sqlite');
      mkdirSync(DATA_DIR, { recursive: true });
      const db = new DatabaseSync(DB_FILE);
      db.exec(readFileSync(SCHEMA_FILE, 'utf8'));
      // Upgrade a database created by an earlier version
      const cols = db.prepare('PRAGMA table_info(inquiries)').all().map((c) => c.name);
      if (!cols.includes('trade_code')) db.exec('ALTER TABLE inquiries ADD COLUMN trade_code TEXT');
      if (!cols.includes('photos')) db.exec('ALTER TABLE inquiries ADD COLUMN photos TEXT');
      return db;
    } catch {
      return null;
    } finally {
      process.emitWarning = orig;
    }
  })();
  return dbPromise;
}

export async function saveInquiry({ prejob, tradeCode: code, source, lead, transcript, photos, emailSent, telegramSent }) {
  const db = await openDb();
  if (!db) return false;
  db.prepare(`
    INSERT INTO inquiries (prejob_no, trade_code, source, customer_name, phone, email, suburb, service, details,
                           urgency, best_time, summary, transcript, photos, email_sent, telegram_sent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    prejob, code || null, source, lead.name || null, lead.phone || null, lead.email || null, lead.suburb || null,
    lead.service || null, lead.details || null, lead.urgency || null, lead.best_time || null,
    lead.summary || null, transcript ? JSON.stringify(transcript) : null,
    photos && photos.length ? JSON.stringify(photos) : null,
    emailSent ? 1 : 0, telegramSent ? 1 : 0
  );
  return true;
}

export const paths = { DATA_DIR, DB_FILE, SEQ_FILE, PHOTO_DIR };
