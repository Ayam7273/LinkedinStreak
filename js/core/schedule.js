// PURE: which dates (or weeks) a goal requires.
//
// goal:     { id, mode: 'days'|'weekly', start_date, end_date|null, status }
// versions: [{ effective_from, days_of_week:number[], weekly_target, grace_hours, timezone,
//              reminders_enabled, reminder_times:string[], grace_reminder }]
// pauses:   [{ from_date, to_date|null }]
//
// Edits never rewrite the past: every date is judged by the version in effect on that date.

import { addDays, weekdayOf, weekStartOf, daysBetween, endOfDay, dateIn, toMs } from './time.js';

export const MODES = ['days', 'weekly'];

export function sortVersions(versions) {
  return [...(versions || [])].sort((a, b) => (a.effective_from < b.effective_from ? -1 : 1));
}

/** The version in effect on `date` (the earliest one for dates before any version). */
export function versionFor(versions, date) {
  const sorted = sortVersions(versions);
  let found = sorted[0] || null;
  for (const v of sorted) {
    if (v.effective_from <= date) found = v;
    else break;
  }
  return found;
}

export const currentVersion = (versions) => {
  const s = sortVersions(versions);
  return s[s.length - 1] || null;
};

export function isPaused(pauses, date) {
  return (pauses || []).some((p) => p.from_date <= date && (p.to_date == null || date <= p.to_date));
}

/** The goal's timezone "now": the current version's. */
export function goalTimeZone(versions) {
  return currentVersion(versions)?.timezone || 'UTC';
}

/** Today's date for the goal. */
export function goalToday(versions, now) {
  return dateIn(toMs(now), goalTimeZone(versions));
}

/** Deadline for logging a post that counts for a unit ending at local midnight `endDate`+1. */
export function unitDeadline(lastDate, version) {
  return endOfDay(lastDate, version.timezone) + (Number(version.grace_hours) || 0) * 3600000;
}

/**
 * Required days for a `days` goal between `from` and `to` (inclusive).
 * Returns [{ key, date, version, paused }]. Non-selected weekdays are not returned.
 */
export function requiredDays(goal, versions, pauses, from, to) {
  const out = [];
  const start = goal.start_date > from ? goal.start_date : from;
  const end = goal.end_date && goal.end_date < to ? goal.end_date : to;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const v = versionFor(versions, d);
    if (!v || !(v.days_of_week || []).includes(weekdayOf(d))) continue;
    out.push({ key: d, date: d, first: d, last: d, version: v, paused: isPaused(pauses, d) });
  }
  return out;
}

/**
 * Required weeks for a `weekly` goal overlapping [from, to].
 * A partial first/last week (clipped by start/end) counts only if daysRemaining >= N.
 * A week whose usable (non-paused) days drop below N is `paused`.
 * Returns [{ key (week-start date), first, last, days, target, version, paused }]
 */
export function requiredWeeks(goal, versions, pauses, from, to, weekStart = 'mon') {
  const out = [];
  const lo = goal.start_date > from ? goal.start_date : from;
  const hi = goal.end_date && goal.end_date < to ? goal.end_date : to;
  if (lo > hi) return out;
  for (let ws = weekStartOf(lo, weekStart); ws <= hi; ws = addDays(ws, 7)) {
    const we = addDays(ws, 6);
    const first = ws < goal.start_date ? goal.start_date : ws;
    const last = goal.end_date && we > goal.end_date ? goal.end_date : we;
    const v = versionFor(versions, first);
    if (!v) continue;
    const target = Math.max(1, Math.min(7, Number(v.weekly_target) || 1));
    const daysRemaining = daysBetween(first, last) + 1;
    if (daysRemaining < target) continue; // partial week too short: skipped
    let usable = 0;
    for (let d = first; d <= last; d = addDays(d, 1)) if (!isPaused(pauses, d)) usable += 1;
    out.push({ key: ws, first, last, days: daysRemaining, target, version: v, paused: usable < target });
  }
  return out;
}

/** Unit key a published instant belongs to (date, or week-start date), using the version in effect then. */
export function unitKeyFor(goal, versions, publishedAt, weekStart = 'mon') {
  // Resolve the date with the current zone, then re-resolve with that date's version zone.
  let tz = goalTimeZone(versions);
  let date = dateIn(toMs(publishedAt), tz);
  const v = versionFor(versions, date);
  if (v && v.timezone !== tz) {
    tz = v.timezone;
    date = dateIn(toMs(publishedAt), tz);
  }
  const version = versionFor(versions, date);
  return {
    date,
    tz,
    version,
    key: goal.mode === 'weekly' ? weekStartOf(date, weekStart) : date,
  };
}

/** Plain-English summary of a goal version, for previews. */
export function describeSchedule({ mode, days_of_week = [], weekly_target = 1, start_date, end_date }, { formatDay, weekdayLabel }) {
  let what;
  if (mode === 'weekly') {
    what = `${weekly_target} ${weekly_target === 1 ? 'post' : 'posts'} a week, any days`;
  } else {
    const order = [1, 2, 3, 4, 5, 6, 0].filter((d) => days_of_week.includes(d));
    const names = order.map((d) => weekdayLabel(d, true));
    const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] || 'no days';
    what = order.length === 7 ? 'every day' : `every ${list}`;
  }
  const span = end_date ? `until ${formatDay(end_date, { weekday: false })}` : 'ongoing';
  return { what, span, from: start_date ? formatDay(start_date, { weekday: false }) : null };
}

/** Count required units in a fixed-length goal (for "That's 36 posts"). */
export function countPlanned({ mode, days_of_week = [], weekly_target = 1, start_date, end_date }, weekStart = 'mon') {
  if (!end_date || !start_date || end_date < start_date) return null;
  const goal = { mode, start_date, end_date };
  const versions = [{ effective_from: start_date, days_of_week, weekly_target, grace_hours: 0, timezone: 'UTC' }];
  if (mode === 'weekly') {
    const weeks = requiredWeeks(goal, versions, [], start_date, end_date, weekStart);
    return { units: weeks.length, posts: weeks.reduce((n, w) => n + w.target, 0) };
  }
  const days = requiredDays(goal, versions, [], start_date, end_date);
  return { units: days.length, posts: days.length };
}
