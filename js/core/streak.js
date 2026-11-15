// PURE streak engine. Everything is derived from goal + versions + pauses + posts + now.
// Nothing here is ever stored.
//
// post: { activity_id, goal_id, published_at, logged_at, unit_key, ... }

import { addDays, weekStartOf, dateIn, startOfDay, endOfDay, toMs, weekdayName, formatDay, formatTime } from './time.js';
import {
  requiredDays,
  requiredWeeks,
  versionFor,
  isPaused,
  goalToday,
  unitDeadline,
  unitKeyFor,
  currentVersion,
} from './schedule.js';

export const STATES = ['complete', 'missed', 'open', 'grace', 'paused', 'upcoming', 'before-start', 'after-end'];

const fail = (code, message) => ({ ok: false, code, message });

/** Posts that count for a unit: published inside it and logged before its deadline. */
function qualifying(posts, unit, goal) {
  const tz = unit.version.timezone;
  const from = startOfDay(unit.first, tz);
  const to = endOfDay(unit.last, tz);
  const deadline = unitDeadline(unit.last, unit.version);
  return posts.filter((p) => {
    const pub = toMs(p.published_at);
    const logged = p.logged_at ? toMs(p.logged_at) : pub;
    return pub >= from && pub < to && logged < deadline && (p.goal_id == null || p.goal_id === goal.id);
  });
}

function stateOf(unit, count, needed, now) {
  if (unit.paused) return 'paused';
  if (count >= needed) return 'complete';
  const tz = unit.version.timezone;
  if (now < startOfDay(unit.first, tz)) return 'upcoming';
  if (now < endOfDay(unit.last, tz)) return 'open';
  if (now < unitDeadline(unit.last, unit.version)) return 'grace';
  return 'missed';
}

/**
 * Full derived picture for one goal.
 * opts: { goal, versions, pauses, posts, now, weekStart }
 */
export function summarise({ goal, versions, pauses = [], posts = [], now, weekStart = 'mon' }) {
  const nowMs = toMs(now);
  const mode = goal.mode;
  const today = goalToday(versions, nowMs);
  const goalPosts = posts.filter((p) => p.goal_id === goal.id);

  // Generate units up to the end of the current week (or the end date).
  const horizon = addDays(weekStartOf(today, weekStart), 6);
  const units =
    mode === 'weekly'
      ? requiredWeeks(goal, versions, pauses, goal.start_date, horizon, weekStart)
      : requiredDays(goal, versions, pauses, goal.start_date, horizon);

  const used = new Set(); // days mode: one post completes one day only
  const out = units.map((u) => {
    let q = qualifying(goalPosts, u, goal);
    if (mode === 'days') {
      q = q.filter((p) => !used.has(p.activity_id)).slice(0, 1);
      q.forEach((p) => used.add(p.activity_id));
    }
    const needed = mode === 'weekly' ? u.target : 1;
    return { ...u, posts: q, count: q.length, needed, state: stateOf(u, q.length, needed, nowMs) };
  });

  let run = 0;
  let best = 0;
  let completed = 0;
  let missed = 0;
  for (const u of out) {
    if (u.state === 'complete') {
      run += 1;
      completed += 1;
      if (run > best) best = run;
    } else if (u.state === 'missed') {
      run = 0;
      missed += 1;
    }
  }

  const ended = !!goal.end_date && today > goal.end_date;

  return {
    mode,
    unit: mode === 'weekly' ? 'weeks' : 'days',
    today,
    units: out,
    current: run,
    best,
    completed,
    missed,
    totalPosts: goalPosts.length,
    completionRate: completed + missed ? completed / (completed + missed) : null,
    ended,
    status: ended ? 'completed' : goal.status,
  };
}

/**
 * Seven-day strip for the Today view (days mode): every date in the current week,
 * with required ones carrying their state.
 */
export function weekStrip(summary, goal, versions, pauses, weekStart = 'mon') {
  const ws = weekStartOf(summary.today, weekStart);
  const byKey = new Map(summary.units.map((u) => [u.key, u]));
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(ws, i);
    const unit = byKey.get(date);
    let state = unit ? unit.state : null;
    if (!unit) {
      if (date < goal.start_date) state = 'before-start';
      else if (goal.end_date && date > goal.end_date) state = 'after-end';
      else if (isPaused(pauses, date)) state = 'paused';
    }
    return { date, required: !!unit, state, unit: unit || null, isToday: date === summary.today };
  });
}

/** The unit (day or week) that contains `today`, if required. */
export function currentUnit(summary, weekStart = 'mon') {
  const key = summary.mode === 'weekly' ? weekStartOf(summary.today, weekStart) : summary.today;
  return summary.units.find((u) => u.key === key) || null;
}

/**
 * Can this post be logged right now?
 * opts: { goal, versions, pauses, posts (this user's), takenActivityIds (all users), activityId, publishedAt, now, weekStart }
 * -> { ok:true, unitKey, date, tz, deadline, streakAfter } | { ok:false, code, message }
 */
export function checkNewPost({ goal, versions, pauses = [], posts = [], takenActivityIds = [], activityId, publishedAt, now, weekStart = 'mon' }) {
  if (!goal) return fail('NO_ACTIVE_GOAL', 'Create or resume a goal before logging posts.');
  const pub = toMs(publishedAt);
  const nowMs = toMs(now);
  const { date, key, version, tz } = unitKeyFor(goal, versions, pub, weekStart);
  const label = `${weekdayName(date)} ${formatDay(date, { weekday: false })}`;

  const taken = takenActivityIds instanceof Set ? takenActivityIds : new Set(takenActivityIds);
  if (posts.some((p) => String(p.activity_id) === String(activityId))) {
    return fail('DUPLICATE', "You've already logged that post.");
  }
  if (taken.has(String(activityId))) {
    return fail('DUPLICATE', 'That post has already been logged by another account.');
  }
  if (date < goal.start_date) {
    return fail('NOT_REQUIRED_DAY', `That post was published on ${label}, before this goal started.`);
  }
  if (goal.end_date && date > goal.end_date) {
    return fail('NOT_REQUIRED_DAY', `That post was published on ${label}, after this goal ended.`);
  }
  if (isPaused(pauses, date)) {
    return fail('NOT_REQUIRED_DAY', `That post was published on ${label}, while this goal was paused.`);
  }

  let unit;
  if (goal.mode === 'weekly') {
    unit = requiredWeeks(goal, versions, pauses, date, date, weekStart)[0];
    if (!unit) return fail('NOT_REQUIRED_DAY', `The week of ${label} isn't part of this goal.`);
  } else {
    unit = requiredDays(goal, versions, pauses, date, date)[0];
    if (!unit) {
      return fail('NOT_REQUIRED_DAY', `That post was published on ${label}, which isn't one of your posting days.`);
    }
    if (posts.some((p) => p.goal_id === goal.id && p.unit_key === key)) {
      return fail('DAY_ALREADY_LOGGED', `${label} is already logged. One post counts per day.`);
    }
  }

  const deadline = unitDeadline(unit.last, version);
  if (nowMs >= deadline) {
    return fail(
      'GRACE_EXPIRED',
      Number(version.grace_hours)
        ? `Too late to log ${label}. Logging closed ${formatDay(dateIn(deadline, tz))} at ${formatTime(deadline, tz)}.`
        : `Too late to log ${label}. This goal has no grace period, so posts must be logged the same ${goal.mode === 'weekly' ? 'week' : 'day'}.`,
    );
  }

  const after = summarise({
    goal,
    versions,
    pauses,
    now: nowMs,
    weekStart,
    posts: [...posts, { activity_id: String(activityId), goal_id: goal.id, published_at: pub, logged_at: nowMs, unit_key: key }],
  });
  return { ok: true, unitKey: key, date, tz, deadline, streakAfter: after.current, unit: after.unit };
}

/** 'Log by 12:00' text for a unit in grace, in its zone. */
export function graceLabel(unit) {
  const tz = unit.version.timezone;
  const dl = unitDeadline(unit.last, unit.version);
  return `Log by ${formatTime(dl, tz)}`;
}

export { currentVersion, versionFor };
