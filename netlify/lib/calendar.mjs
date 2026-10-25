// Call-back reminder for the team: an "Add to Google Calendar" link and a calendar file (.ics),
// at the time the customer said is best to call. All times are Sydney time.
//
//   Right now       -> in 15 minutes
//   This morning    -> 9:00 am   (if it's already 9-11 am: in 15 min; after 11 am: 9:00 am tomorrow)
//   This afternoon  -> 2:00 pm   (if it's already 2-4 pm: in 15 min; after 4 pm: 2:00 pm tomorrow)
//   After 5pm       -> 5:30 pm   (if it's already 5:30-8 pm: in 15 min; after 8 pm: 5:30 pm tomorrow)
//   Tomorrow        -> 9:00 am tomorrow
//   Anytime / other -> in 30 minutes

const TZ = 'Australia/Sydney';
const pad = (n) => String(n).padStart(2, '0');

// Sydney wall-clock parts for an instant
function parts(ms) {
  const f = new Intl.DateTimeFormat('en-AU', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const o = {}; for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
  return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute };
}
// the instant (UTC ms) for a Sydney wall-clock time (handles daylight saving)
function sydneyTime(y, mo, d, h, mi) {
  let guess = Date.UTC(y, mo - 1, d, h, mi);
  for (let i = 0; i < 2; i++) {
    const p = parts(guess);
    const shown = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
    guess += Date.UTC(y, mo - 1, d, h, mi) - shown;
  }
  return guess;
}
const roundUp5 = (ms) => Math.ceil(ms / 300000) * 300000;

export function callTime(bestTime, nowMs = Date.now()) {
  const t = String(bestTime || '').toLowerCase();
  const p = parts(nowMs), minsNow = p.h * 60 + p.mi;
  const soon = (m) => roundUp5(nowMs + m * 60000);
  const at = (dayOffset, h, mi) => {
    const base = sydneyTime(p.y, p.mo, p.d, 12, 0) + dayOffset * 86400000;   // midday avoids DST edge cases
    const q = parts(base);
    return sydneyTime(q.y, q.mo, q.d, h, mi);
  };
  const slot = (h, mi, latest) => {     // today at h:mi, or soon if we're inside the window, else tomorrow
    const start = h * 60 + mi;
    if (minsNow < start) return at(0, h, mi);
    if (minsNow < latest) return soon(15);
    return at(1, h, mi);
  };
  if (/right now|now|asap|urgent/.test(t)) return soon(15);
  if (/morning/.test(t) && !/tomorrow/.test(t)) return slot(9, 0, 11 * 60);
  if (/afternoon/.test(t) && !/tomorrow/.test(t)) return slot(14, 0, 16 * 60);
  if (/after 5|evening|tonight|after work/.test(t)) return slot(17, 30, 20 * 60);
  if (/tomorrow/.test(t)) return /afternoon/.test(t) ? at(1, 14, 0) : at(1, 9, 0);
  return soon(30);
}

export function whenText(ms) {
  return new Intl.DateTimeFormat('en-AU', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })
    .format(new Date(ms)).replace(/\s?(am|pm)$/i, (m) => m.toLowerCase().trim()).replace(/,/g, '');
}

const gcal = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');   // 20261025T030000Z

export function callReminder({ prejob, name, phone, suburb, service, bestTime, summary, mapsUrl }, nowMs = Date.now()) {
  if (!phone) return null;
  const start = callTime(bestTime, nowMs), end = start + 15 * 60000;
  const title = `Call ${name || 'customer'} · ${phone}${service ? ' · ' + service : ''}${suburb ? ' · ' + suburb : ''}`.slice(0, 200);
  const details = [
    prejob ? `Reference: ${prejob}` : '',
    `Phone: ${phone}`,
    bestTime ? `Best time to call (customer said): ${bestTime}` : '',
    suburb ? `Suburb: ${suburb}` : '',
    summary ? `\n${summary}` : '',
    mapsUrl ? `\nDirections: ${mapsUrl}` : ''
  ].filter(Boolean).join('\n').slice(0, 1500);
  const url = 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
    '&text=' + encodeURIComponent(title) + '&dates=' + gcal(start) + '/' + gcal(end) +
    '&details=' + encodeURIComponent(details) + (suburb ? '&location=' + encodeURIComponent(suburb) : '') + '&ctz=' + encodeURIComponent(TZ);
  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const fold = (line) => line.match(/.{1,73}/g).join('\r\n ');
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Modern Building Solutions//Website//EN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${(prejob || 'call-' + start)}@modernbuildingsolutions.com.au`,
    `DTSTAMP:${gcal(nowMs)}`, `DTSTART:${gcal(start)}`, `DTEND:${gcal(end)}`,
    fold(`SUMMARY:${esc(title)}`), fold(`DESCRIPTION:${esc(details)}`), ...(suburb ? [fold(`LOCATION:${esc(suburb)}`)] : []),
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc('Call ' + (name || 'customer'))}`, 'TRIGGER:-PT10M', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR', ''
  ].join('\r\n');
  return { start, when: whenText(start), url, ics };
}
