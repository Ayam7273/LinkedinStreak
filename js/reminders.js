// PURE reminder decision: which notifications should go out right now?
// No DOM, no network. The caller dedupes for real with notification_log;
// `sent` here lets the function skip anything already logged.

import { londonDate, londonMinutes, addDays, isRequiredDay, graceDeadline, hmToMinutes, weekdayName, toMs } from './time.js';
import { summarise } from './streak.js';

export const DEFAULT_REMINDER_TIMES = ['09:00', '18:00', '21:30'];
export const DEFAULT_GRACE_TIME = '10:00';

export const sentKey = (kind, forDay, slot) => `${kind}|${forDay}|${slot}`;

const days = (n) => `${n} ${n === 1 ? 'day' : 'days'}`;

export function reminderCopy({ index, total, weekday, streak }) {
  const last = index === total - 1 && total > 1;
  if (index === 0 && !last) {
    return streak > 0
      ? `${weekday}'s post is due. Your ${streak}-day streak is waiting.`
      : `${weekday}'s post is due. Post today to start a streak.`;
  }
  if (last) return 'Last call. Post before midnight or the streak ends.';
  return streak > 0 ? `Still time. Post today to keep ${days(streak)} alive.` : 'Still time. Post today.';
}

/**
 * @param {object} a
 * @param {number|string|Date} a.now
 * @param {object} a.settings  { start_date, reminder_times, grace_reminder_time, reminders_enabled }
 * @param {Array}  a.posts
 * @param {Set<string>|string[]} [a.sent]  keys from sentKey()
 * @returns {Array<{kind, forDay, slot, title, body, tag, url}>}
 */
export function decideReminders({ now, settings, posts, sent = [] }) {
  const out = [];
  if (!settings || settings.reminders_enabled === false) return out;

  const sentSet = sent instanceof Set ? sent : new Set(sent);
  const startDate = settings.start_date || null;
  const nowMs = toMs(now);
  const today = londonDate(nowMs);
  const minutes = londonMinutes(nowMs);
  const summary = summarise({ startDate, now: nowMs, posts });
  const stateOf = (d) => summary.days.find((x) => x.date === d)?.state;
  const inRange = (d) => !startDate || d >= startDate;

  // Today's reminders: only the most recent slot that has passed.
  if (isRequiredDay(today) && inRange(today) && stateOf(today) === 'open') {
    const slots = [...(settings.reminder_times || DEFAULT_REMINDER_TIMES)]
      .filter((s) => !Number.isNaN(hmToMinutes(s)))
      .sort((a, b) => hmToMinutes(a) - hmToMinutes(b));
    let idx = -1;
    slots.forEach((s, i) => {
      if (minutes >= hmToMinutes(s)) idx = i;
    });
    if (idx >= 0) {
      const slot = slots[idx];
      const kind = idx === slots.length - 1 && slots.length > 1 ? 'last_call' : 'reminder';
      if (!sentSet.has(sentKey(kind, today, slot))) {
        out.push({
          kind,
          forDay: today,
          slot,
          title: kind === 'last_call' ? 'Last call' : `${weekdayName(today)}'s post`,
          body: reminderCopy({ index: idx, total: slots.length, weekday: weekdayName(today), streak: summary.current }),
          tag: `day-${today}`,
          url: '/#/log',
        });
      }
    }
  }

  // Grace reminder for yesterday.
  const yesterday = addDays(today, -1);
  const graceTime = settings.grace_reminder_time || DEFAULT_GRACE_TIME;
  if (
    isRequiredDay(yesterday) &&
    inRange(yesterday) &&
    stateOf(yesterday) === 'grace' &&
    nowMs < graceDeadline(yesterday) &&
    minutes >= hmToMinutes(graceTime) &&
    !sentSet.has(sentKey('grace', yesterday, graceTime))
  ) {
    out.push({
      kind: 'grace',
      forDay: yesterday,
      slot: graceTime,
      title: `${weekdayName(yesterday)} isn't logged`,
      body: "Yesterday's post isn't logged. You have until noon.",
      tag: `day-${yesterday}`,
      url: '/#/log',
    });
  }

  return out;
}
