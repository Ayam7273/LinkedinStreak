// PURE streak engine. No DOM, no network. Everything is derived from
// posts + startDate + now. Nothing here is ever stored.
//
// A post: { activity_id, published_at, required_day, logged_at?, ... }

import {
  londonDate,
  addDays,
  isRequiredDay,
  graceDeadline,
  weekendFriday,
  weekdayName,
  formatDay,
  toMs,
} from './time.js';

export const STATES = ['complete', 'missed', 'open', 'grace', 'upcoming', 'before-start'];

const fail = (code, message) => ({ ok: false, code, message });

function postsByDay(posts) {
  const map = new Map();
  for (const p of posts || []) {
    if (p && p.required_day && !map.has(p.required_day)) map.set(p.required_day, p);
  }
  return map;
}

/** State of one required day. */
export function dayState(day, { startDate, now, byDay }) {
  if (startDate && day < startDate) return 'before-start';
  if (byDay.has(day)) return 'complete';
  const today = londonDate(now);
  if (day === today) return 'open';
  if (day > today) return 'upcoming';
  return toMs(now) < graceDeadline(day) ? 'grace' : 'missed';
}

/**
 * The weekend the Today view focuses on: the current weekend on Fri–Sun,
 * otherwise the coming one.
 */
export function focusFriday(now) {
  return weekendFriday(londonDate(now));
}

/**
 * Full derived picture.
 * Returns { days, weekends, current, best, fullWeekends, totalPosts, completed, missed, completionRate, focus }
 */
export function summarise({ startDate, now, posts }) {
  const byDay = postsByDay(posts);
  const focus = focusFriday(now);
  const lastDay = addDays(focus, 2);
  // Always include the previous weekend so 'grace' / 'missed' for it can be read.
  const prevFriday = addDays(focus, -7);
  const firstFriday = startDate ? weekendFriday(startDate) : prevFriday;
  const begin = firstFriday < prevFriday ? firstFriday : prevFriday;

  const days = [];
  for (let d = begin; d <= lastDay; d = addDays(d, 1)) {
    if (!isRequiredDay(d)) continue;
    days.push({ date: d, state: dayState(d, { startDate, now, byDay }), post: byDay.get(d) || null });
  }

  // Streak: walk forward. complete extends, missed resets, everything else is neutral.
  let run = 0;
  let best = 0;
  let completed = 0;
  let missed = 0;
  for (const day of days) {
    if (day.state === 'complete') {
      run += 1;
      completed += 1;
      if (run > best) best = run;
    } else if (day.state === 'missed') {
      run = 0;
      missed += 1;
    }
  }

  // Weekends (Friday-keyed), oldest first.
  const weekends = [];
  for (let i = 0; i < days.length; i += 3) {
    weekends.push({ friday: days[i].date, days: days.slice(i, i + 3) });
  }

  let wkRun = 0;
  for (const w of weekends) {
    const counted = w.days.filter((d) => d.state !== 'before-start');
    if (!counted.length) continue;
    if (counted.some((d) => d.state === 'missed')) wkRun = 0;
    else if (counted.every((d) => d.state === 'complete')) wkRun += 1;
  }

  const totalPosts = [...byDay.keys()].filter((d) => !startDate || d >= startDate).length;

  return {
    days,
    weekends,
    focus,
    current: run,
    best,
    fullWeekends: wkRun,
    totalPosts,
    completed,
    missed,
    completionRate: completed + missed ? completed / (completed + missed) : null,
  };
}

/** Shorthand for the current streak number. */
export function currentStreak(args) {
  return summarise(args).current;
}

/**
 * Check whether a newly published post can be logged right now.
 * { ok:true, day, streakAfter } or { ok:false, code, message }
 */
export function checkNewPost({ activityId, publishedAt, now, startDate, posts }) {
  const published = toMs(publishedAt);
  const day = londonDate(published);
  const label = `${weekdayName(day)} ${formatDay(day, { weekday: false })}`;

  if (!isRequiredDay(day)) {
    return fail(
      'NOT_REQUIRED_DAY',
      `That post was published on ${label}. Only Friday, Saturday and Sunday posts count.`,
    );
  }
  if (startDate && day < startDate) {
    return fail(
      'BEFORE_START',
      `That post was published on ${label}, before your start date (${formatDay(startDate)}).`,
    );
  }
  if ((posts || []).some((p) => String(p.activity_id) === String(activityId))) {
    return fail('DUPLICATE', 'That post is already logged.');
  }
  if ((posts || []).some((p) => p.required_day === day)) {
    return fail('DAY_ALREADY_LOGGED', `${label} is already logged. One post counts per day.`);
  }
  if (toMs(now) >= graceDeadline(day)) {
    return fail(
      'GRACE_EXPIRED',
      `Too late to log ${label}. Logging closed at 12:00 on ${weekdayName(addDays(day, 1))}.`,
    );
  }

  const after = summarise({
    startDate,
    now,
    posts: [...(posts || []), { activity_id: String(activityId), published_at: published, required_day: day }],
  });
  return { ok: true, day, publishedAt: published, streakAfter: after.current };
}
