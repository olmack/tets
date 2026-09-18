'use strict';
// Génération d'un fichier calendrier .ics (invitation) pour les rendez-vous

function pad(n) { return String(n).padStart(2, '0'); }

function escapeIcs(str) {
  return String(str || '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function foldLine(line) {
  const out = [];
  let s = line;
  while (Buffer.byteLength(s, 'utf8') > 72) {
    let cut = 72;
    while (Buffer.byteLength(s.slice(0, cut), 'utf8') > 72) cut--;
    out.push(s.slice(0, cut));
    s = ' ' + s.slice(cut);
  }
  out.push(s);
  return out.join('\r\n');
}

/**
 * @param {{uid:string, date:'YYYY-MM-DD', time:'HH:MM', durationMinutes:number, summary:string, description:string, location:string, organizerEmail:string, organizerName:string}} ev
 */
function buildIcs(ev) {
  const [y, mo, d] = ev.date.split('-').map(Number);
  const [h, mi] = ev.time.split(':').map(Number);
  const start = `${y}${pad(mo)}${pad(d)}T${pad(h)}${pad(mi)}00`;
  const endDate = new Date(y, mo - 1, d, h, mi + ev.durationMinutes);
  const end = `${endDate.getFullYear()}${pad(endDate.getMonth() + 1)}${pad(endDate.getDate())}T${pad(endDate.getHours())}${pad(endDate.getMinutes())}00`;
  const now = new Date();
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//DYLAN AUTO//Rendez-vous//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VTIMEZONE',
    'TZID:Europe/Paris',
    'BEGIN:STANDARD',
    'DTSTART:19701025T030000',
    'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
    'TZOFFSETFROM:+0200',
    'TZOFFSETTO:+0100',
    'END:STANDARD',
    'BEGIN:DAYLIGHT',
    'DTSTART:19700329T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
    'TZOFFSETFROM:+0100',
    'TZOFFSETTO:+0200',
    'END:DAYLIGHT',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    `UID:${ev.uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;TZID=Europe/Paris:${start}`,
    `DTEND;TZID=Europe/Paris:${end}`,
    `SUMMARY:${escapeIcs(ev.summary)}`,
    `DESCRIPTION:${escapeIcs(ev.description)}`,
    `LOCATION:${escapeIcs(ev.location)}`,
    `ORGANIZER;CN=${escapeIcs(ev.organizerName)}:mailto:${ev.organizerEmail}`,
    'STATUS:CONFIRMED',
    'BEGIN:VALARM',
    'TRIGGER:-PT2H',
    'ACTION:DISPLAY',
    'DESCRIPTION:Rappel rendez-vous garage',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

module.exports = { buildIcs };
