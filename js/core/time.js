// PURE timezone-aware date helpers. No DOM, no network, no date library.
// Calendar dates are 'YYYY-MM-DD' strings. Instants are epoch milliseconds.
// Every function that turns an instant into a calendar date takes an explicit IANA timezone.

const pad = (n) => String(n).padStart(2, '0');
const fmtCache = new Map();

function fmt(tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export function toMs(value) {
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  return Date.parse(value);
}

export function isValidTimeZone(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock parts of an instant in `tz`. */
export function partsIn(instant, tz) {
  const out = {};
  for (const p of fmt(tz).formatToParts(new Date(toMs(instant)))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  if (out.hour === 24) out.hour = 0;
  return out;
}

/** Calendar date of an instant in `tz`. */
export function dateIn(instant, tz) {
  const p = partsIn(instant, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Minutes since local midnight (wall clock) in `tz`. */
export function minutesIn(instant, tz) {
  const p = partsIn(instant, tz);
  return p.hour * 60 + p.minute;
}

export function hmToMinutes(hm) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hm ?? '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}

export const isHm = (hm) => !Number.isNaN(hmToMinutes(hm));

function split(date) {
  const [y, m, d] = date.split('-').map(Number);
  return { y, m, d };
}

export function isDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false;
  const { y, m, d } = split(s);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** 0 = Sunday … 6 = Saturday. Timezone-free. */
export function weekdayOf(date) {
  const { y, m, d } = split(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(date, n) {
  const { y, m, d } = split(date);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function daysBetween(a, b) {
  const A = split(a);
  const B = split(b);
  return Math.round((Date.UTC(B.y, B.m - 1, B.d) - Date.UTC(A.y, A.m - 1, A.d)) / 86400000);
}

/** UTC offset (ms) of `tz` at an instant. */
function offsetAt(ms, tz) {
  const p = partsIn(ms, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

/**
 * The instant at which the wall clock in `tz` reads `hm` on `date`.
 * Repeated (autumn) times resolve to the first occurrence.
 * Skipped (spring) times shift forward by the size of the gap.
 */
export function zonedToInstant(date, hm, tz) {
  const { y, m, d } = split(date);
  const mins = hmToMinutes(hm);
  const naive = Date.UTC(y, m - 1, d, Math.floor(mins / 60), mins % 60);
  // Sample every offset in force within ±27h: covers all zones (UTC-12 … UTC+14).
  const offsets = new Set();
  for (let h = -27; h <= 27; h += 3) offsets.add(offsetAt(naive + h * 3600000, tz));
  const candidates = [...offsets].map((o) => naive - o).filter((c) => dateIn(c, tz) === date);
  const exact = candidates.filter((c) => minutesIn(c, tz) === mins).sort((a, b) => a - b);
  if (exact.length) return exact[0];
  // Gap: the candidate that lands past the skipped hour (shifted forward by the gap).
  const after = candidates.filter((c) => minutesIn(c, tz) > mins).sort((a, b) => a - b);
  return after.length ? after[0] : naive;
}

export const startOfDay = (date, tz) => zonedToInstant(date, '00:00', tz);
export const endOfDay = (date, tz) => zonedToInstant(addDays(date, 1), '00:00', tz);

/** First day of the week containing `date`. weekStart: 'mon' | 'sun'. */
export function weekStartOf(date, weekStart = 'mon') {
  const first = weekStart === 'sun' ? 0 : 1;
  return addDays(date, -((weekdayOf(date) - first + 7) % 7));
}

/** The browser's timezone, or 'UTC'. */
export function detectTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

// ---- Formatting (English, sentence case) -----------------------------------
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const weekdayName = (date, short = false) => {
  const n = WEEKDAYS[weekdayOf(date)];
  return short ? n.slice(0, 3) : n;
};
export const weekdayLabel = (i, short = false) => (short ? WEEKDAYS[i].slice(0, 3) : WEEKDAYS[i]);
export const monthName = (m) => MONTHS[m - 1];

/** 'Fri 13 Nov' (+ year optionally) */
export function formatDay(date, { weekday = true, year = false } = {}) {
  const { y, m, d } = split(date);
  const core = `${d} ${MONTHS[m - 1]}${year ? ' ' + y : ''}`;
  return weekday ? `${weekdayName(date, true)} ${core}` : core;
}

export function formatTime(instant, tz) {
  const p = partsIn(instant, tz);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** 'Fri 13 Nov, 08:42' in `tz` */
export function formatInstant(instant, tz) {
  return `${formatDay(dateIn(instant, tz))}, ${formatTime(instant, tz)}`;
}

/** '13–19 Nov' or '30 Oct – 5 Nov' */
export function formatRange(a, b) {
  const A = split(a);
  const B = split(b);
  if (A.y === B.y && A.m === B.m) return `${A.d}–${B.d} ${MONTHS[B.m - 1]}`;
  return `${A.d} ${MONTHS[A.m - 1]} – ${B.d} ${MONTHS[B.m - 1]}`;
}
