// Pure Europe/London date helpers. No DOM, no network, no date library.
// Calendar dates are plain 'YYYY-MM-DD' strings. Instants are epoch milliseconds.

export const TZ = 'Europe/London';

// Required posting days, as JS weekday numbers (0 = Sunday).
export const REQUIRED_WEEKDAYS = [5, 6, 0];

const partsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

const pad = (n) => String(n).padStart(2, '0');

export function toMs(value) {
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  return Date.parse(value);
}

/** Wall-clock parts of an instant in London. */
export function londonParts(instant) {
  const out = {};
  for (const p of partsFmt.formatToParts(new Date(toMs(instant)))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  if (out.hour === 24) out.hour = 0;
  return out; // { year, month, day, hour, minute, second }
}

/** London calendar date of an instant, as 'YYYY-MM-DD'. */
export function londonDate(instant) {
  const p = londonParts(instant);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Minutes since London midnight for an instant (wall clock). */
export function londonMinutes(instant) {
  const p = londonParts(instant);
  return p.hour * 60 + p.minute;
}

/** 'HH:MM' -> minutes. */
export function hmToMinutes(hm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm).trim());
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

function splitDate(date) {
  const [y, m, d] = date.split('-').map(Number);
  return { y, m, d };
}

/** Day of week for a calendar date (0 = Sunday). Timezone-free. */
export function weekdayOf(date) {
  const { y, m, d } = splitDate(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(date, n) {
  const { y, m, d } = splitDate(date);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Whole days from a to b (b - a). */
export function daysBetween(a, b) {
  const A = splitDate(a);
  const B = splitDate(b);
  return Math.round((Date.UTC(B.y, B.m - 1, B.d) - Date.UTC(A.y, A.m - 1, A.d)) / 86400000);
}

export function isRequiredDay(date) {
  return REQUIRED_WEEKDAYS.includes(weekdayOf(date));
}

/** London UTC offset (ms) in force at an instant. */
function offsetAt(ms) {
  const p = londonParts(ms);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/**
 * The instant at which London wall-clock reads `hm` on `date`.
 * For a time skipped by the spring change, returns the instant just after the gap.
 * For a repeated autumn time, returns the first occurrence.
 */
export function londonToInstant(date, hm = '00:00') {
  const { y, m, d } = splitDate(date);
  const mins = hmToMinutes(hm);
  const naive = Date.UTC(y, m - 1, d, Math.floor(mins / 60), mins % 60);
  // Try both candidate offsets (GMT and BST) and keep the earliest that matches.
  const candidates = [naive - offsetAt(naive - 3600000), naive - offsetAt(naive), naive - offsetAt(naive + 3600000)];
  const exact = candidates
    .filter((c) => londonDate(c) === date && londonMinutes(c) === mins)
    .sort((a, b) => a - b);
  if (exact.length) return exact[0];
  // Non-existent time (spring gap): shift forward by the gap (01:30 -> 02:30 BST).
  return Math.min(...candidates.filter((c) => londonDate(c) === date && londonMinutes(c) > mins));
}

/** Logging for day D closes at 12:00 London on D + 1. */
export function graceDeadline(date) {
  return londonToInstant(addDays(date, 1), '12:00');
}

/** Friday of the weekend that `date` belongs to (Fri/Sat/Sun), or the next Friday otherwise. */
export function weekendFriday(date) {
  const wd = weekdayOf(date);
  if (wd === 5) return date;
  if (wd === 6) return addDays(date, -1);
  if (wd === 0) return addDays(date, -2);
  return addDays(date, 5 - wd);
}

/** Next Friday on or after `date`. */
export function nextFriday(date) {
  const wd = weekdayOf(date);
  return addDays(date, (5 - wd + 7) % 7);
}

/** Next required day strictly after `date`. */
export function nextRequiredDay(date) {
  let d = addDays(date, 1);
  while (!isRequiredDay(d)) d = addDays(d, 1);
  return d;
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function weekdayName(date, short = false) {
  const n = WEEKDAY_NAMES[weekdayOf(date)];
  return short ? n.slice(0, 3) : n;
}

/** 'Fri 13 Nov' */
export function formatDay(date, { weekday = true, year = false } = {}) {
  const { y, m, d } = splitDate(date);
  const core = `${d} ${MONTHS[m - 1]}${year ? ' ' + y : ''}`;
  return weekday ? `${weekdayName(date, true)} ${core}` : core;
}

/** 'HH:MM' London time of an instant. */
export function formatTime(instant) {
  const p = londonParts(instant);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** 'Fri 13 Nov, 08:42' */
export function formatInstant(instant) {
  return `${formatDay(londonDate(instant))}, ${formatTime(instant)}`;
}

/** '13–15 Nov' or '30 Oct – 1 Nov' for a weekend starting on `friday`. */
export function formatWeekendRange(friday) {
  const sun = addDays(friday, 2);
  const a = splitDate(friday);
  const b = splitDate(sun);
  if (a.m === b.m) return `${a.d}–${b.d} ${MONTHS[b.m - 1]}`;
  return `${a.d} ${MONTHS[a.m - 1]} – ${b.d} ${MONTHS[b.m - 1]}`;
}

export function monthName(m) {
  return MONTHS[m - 1];
}
