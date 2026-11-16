// Reads a private iCal feed (URL in the CALENDAR_ICS_URL secret) and writes calendar.json: the
// events from a few weeks back to a few months ahead, recurring events expanded, with only the
// fields the dashboard shows (title, time, location). Descriptions, guests and links are left out
// because calendar.json is served publicly next to the dashboard.
//
//   CALENDAR_ICS_URL=... node sync-calendar.mjs [out.json]
//   node sync-calendar.mjs out.json some-file.ics      (test against a local file)
import { readFile, writeFile } from 'node:fs/promises';
import IcalExpander from 'ical-expander';

const DAYS_BACK = 35, DAYS_AHEAD = 120;
const out = process.argv[2] || 'calendar.json';
const file = process.argv[3];

let ics;
if (file) {
  ics = await readFile(file, 'utf8');
} else {
  const url = process.env.CALENDAR_ICS_URL;
  if (!url) { console.error('CALENDAR_ICS_URL is not set'); process.exit(1); }
  const res = await fetch(url);
  // Never print the URL: it is the secret.
  if (!res.ok) { console.error('Calendar fetch failed: HTTP ' + res.status); process.exit(1); }
  ics = await res.text();
}
if (!/BEGIN:VCALENDAR/.test(ics)) { console.error('Response is not an iCal feed'); process.exit(1); }

const now = Date.now(), DAY = 864e5;
const from = new Date(now - DAYS_BACK * DAY), to = new Date(now + DAYS_AHEAD * DAY);
const found = new IcalExpander({ ics, maxIterations: 5000 }).between(from, to);

const pad = (n) => String(n).padStart(2, '0');
const ymd = (t) => t.year + '-' + pad(t.month) + '-' + pad(t.day);

function row(item, start, end, key) {
  if (String(item.component.getFirstPropertyValue('status') || '').toUpperCase() === 'CANCELLED') return null;
  const e = { id: key, title: (item.summary || '').trim() || '(No title)' };
  if (start.isDate) {
    // All-day: plain dates (end is exclusive), so they never shift with the viewer's timezone.
    e.allDay = true; e.start = ymd(start); e.end = ymd(end);
  } else {
    e.start = start.toJSDate().toISOString(); e.end = end.toJSDate().toISOString();
  }
  const loc = (item.location || '').trim();
  if (loc) e.loc = loc;
  return e;
}

const events = [];
for (const ev of found.events) events.push(row(ev, ev.startDate, ev.endDate, ev.uid));
for (const o of found.occurrences) events.push(row(o.item, o.startDate, o.endDate, o.item.uid + '@' + o.startDate.toString()));

const list = events.filter(Boolean).sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.id < b.id ? -1 : 1));
// No timestamp in the file, so it only changes (and is only committed) when the events change.
await writeFile(out, JSON.stringify({ events: list }, null, 1) + '\n');
console.log('Wrote ' + list.length + ' events to ' + out);
