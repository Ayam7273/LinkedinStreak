// PURE: which notifications should go out right now for one goal?
// The caller dedupes for real via notification_log (insert-on-conflict-do-nothing);
// `sent` lets this function skip what's already logged.

import { dateIn, minutesIn, hmToMinutes, addDays, weekdayName, toMs, daysBetween, formatTime } from './time.js';
import { summarise, currentUnit } from './streak.js';
import { currentVersion, unitDeadline } from './schedule.js';

export const DEFAULT_REMINDER_TIMES = ['09:00', '18:00', '21:30'];
export const QUIET_FROM = 22 * 60; // 22:00
export const QUIET_TO = 7 * 60; // 07:00
export const STALE_AFTER_MIN = 180; // never send a slot more than 3h late
export const GRACE_REMINDER_AT = 7 * 60; // earliest local time for a grace reminder

export const sentKey = (kind, unitKey, slot) => `${kind}|${unitKey}|${slot}`;

const inQuiet = (m) => m >= QUIET_FROM || m < QUIET_TO;
const unitWord = (mode, n) => (mode === 'weekly' ? (n === 1 ? 'week' : 'weeks') : n === 1 ? 'day' : 'days');

/** The most recent slot that has passed, if it isn't stale and quiet hours allow it. */
function dueSlot(slots, minutes) {
  let idx = -1;
  slots.forEach((s, i) => {
    if (minutes >= hmToMinutes(s)) idx = i;
  });
  if (idx < 0) return null;
  const slotMin = hmToMinutes(slots[idx]);
  if (minutes - slotMin > STALE_AFTER_MIN) return null;
  // Quiet hours: only a slot the user explicitly set inside them, sent close to on time.
  if (inQuiet(minutes) && !(inQuiet(slotMin) && minutes - slotMin <= 30)) return null;
  return { idx, slot: slots[idx] };
}

export function daysCopy({ idx, total, weekday, streak }) {
  const last = total > 1 && idx === total - 1;
  if (last) return 'Last call — post before midnight or your streak resets.';
  if (idx === 0) {
    return streak > 0
      ? `${weekday}'s post is due, your ${streak}-day streak is waiting.`
      : `${weekday}'s post is due, post today to start a streak.`;
  }
  return streak > 0 ? `Still time, post today to keep your ${streak}-day streak.` : 'Still time, post today.';
}

export function weeklyCopy({ count, target, daysLeft, urgentLast }) {
  if (urgentLast) return `Last day of the week — ${target - count} more ${target - count === 1 ? 'post' : 'posts'} to keep your streak.`;
  return `${count} of ${target} posts done this week — ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left.`;
}

/**
 * @param {object} a
 * @param {number|string|Date} a.now
 * @param {object} a.goal       { id, mode, status, start_date, end_date }
 * @param {Array}  a.versions
 * @param {Array}  [a.pauses]
 * @param {Array}  [a.posts]
 * @param {string} [a.weekStart]
 * @param {Iterable<string>} [a.sent]  keys from sentKey()
 * @returns {Array<{kind, unitKey, slot, title, body, tag, url}>}
 */
export function decideReminders({ now, goal, versions, pauses = [], posts = [], weekStart = 'mon', sent = [] }) {
  const out = [];
  if (!goal || goal.status !== 'active') return out;
  const v = currentVersion(versions);
  if (!v || v.reminders_enabled === false) return out;

  const nowMs = toMs(now);
  const tz = v.timezone;
  const today = dateIn(nowMs, tz);
  const minutes = minutesIn(nowMs, tz);
  const sentSet = sent instanceof Set ? sent : new Set(sent);
  const sum = summarise({ goal, versions, pauses, posts, now: nowMs, weekStart });
  if (sum.ended) return out;

  const slots = [...(v.reminder_times?.length ? v.reminder_times : DEFAULT_REMINDER_TIMES)]
    .filter((s) => !Number.isNaN(hmToMinutes(s)))
    .sort((a, b) => hmToMinutes(a) - hmToMinutes(b))
    .slice(0, 4);
  const url = '/app.html#/log';

  // ---- Due now --------------------------------------------------------------
  const unit = currentUnit(sum, weekStart);
  if (unit && unit.state === 'open') {
    if (goal.mode === 'days') {
      const due = dueSlot(slots, minutes);
      if (due) {
        const kind = slots.length > 1 && due.idx === slots.length - 1 ? 'last_call' : 'reminder';
        if (!sentSet.has(sentKey(kind, unit.key, due.slot))) {
          out.push({
            kind,
            unitKey: unit.key,
            slot: due.slot,
            title: kind === 'last_call' ? 'Last call' : `${weekdayName(today)}'s post`,
            body: daysCopy({ idx: due.idx, total: slots.length, weekday: weekdayName(today), streak: sum.current }),
            tag: `g-${goal.id}-${unit.key}`,
            url,
          });
        }
      }
    } else {
      // weekly: nudge once a day; escalate through the day when every remaining day is needed.
      const needed = unit.needed - unit.count;
      const daysLeft = daysBetween(today, unit.last) + 1;
      const postedToday = unit.posts.some((p) => dateIn(toMs(p.published_at), tz) === today);
      const urgent = needed >= daysLeft;
      if (needed > 0 && !(postedToday && !urgent)) {
        const pool = urgent ? slots : slots.slice(0, 1);
        const due = dueSlot(pool, minutes);
        if (due) {
          const lastOfDay = urgent && pool.length > 1 && due.idx === pool.length - 1;
          const kind = lastOfDay ? 'last_call' : 'reminder';
          const slotKey = `${today}@${due.slot}`;
          if (!sentSet.has(sentKey(kind, unit.key, slotKey))) {
            out.push({
              kind,
              unitKey: unit.key,
              slot: slotKey,
              title: urgent ? 'Your week is at risk' : 'This week',
              body: weeklyCopy({ count: unit.count, target: unit.needed, daysLeft, urgentLast: urgent && daysLeft === 1 }),
              tag: `g-${goal.id}-${unit.key}`,
              url,
            });
          }
        }
      }
    }
  }

  // ---- Grace reminder for the unit that just ended ---------------------------
  if (v.grace_reminder) {
    const graceUnit = sum.units.find((u) => u.state === 'grace');
    if (graceUnit && minutes >= GRACE_REMINDER_AT && !inQuiet(minutes)) {
      const deadline = unitDeadline(graceUnit.last, graceUnit.version);
      const slot = 'grace';
      if (deadline - nowMs > 15 * 60000 && !sentSet.has(sentKey('grace', graceUnit.key, slot))) {
        const when = formatTime(deadline, tz);
        const wasYesterday = graceUnit.last === addDays(today, -1);
        out.push({
          kind: 'grace',
          unitKey: graceUnit.key,
          slot,
          title: goal.mode === 'weekly' ? "Last week isn't finished" : `${weekdayName(graceUnit.last)} isn't logged`,
          body:
            goal.mode === 'weekly'
              ? `Last week needs ${graceUnit.needed - graceUnit.count} more — you can still log posts from it until ${when}.`
              : `${wasYesterday ? "Yesterday's" : `${weekdayName(graceUnit.last)}'s`} post isn't logged yet — you have until ${when}.`,
          tag: `g-${goal.id}-${graceUnit.key}`,
          url,
        });
      }
    }
  }

  return out;
}

export { unitWord };
