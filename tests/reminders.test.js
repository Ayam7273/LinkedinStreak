import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideReminders, sentKey } from '../js/reminders.js';
import { londonDate } from '../js/time.js';

const utc = (s) => Date.parse(s);
let seq = 1n;
function post(iso) {
  const ms = utc(iso);
  return { activity_id: String((BigInt(ms) << 22n) | seq++), published_at: ms, required_day: londonDate(ms) };
}

const settings = {
  start_date: '2026-11-06',
  reminder_times: ['09:00', '18:00', '21:30'],
  grace_reminder_time: '10:00',
  reminders_enabled: true,
};
const lastWeekend = [post('2026-11-06T09:00:00Z'), post('2026-11-07T09:00:00Z'), post('2026-11-08T09:00:00Z')];

test('nothing before the first slot', () => {
  assert.deepEqual(decideReminders({ now: utc('2026-11-13T08:59:00Z'), settings, posts: lastWeekend }), []);
});

test('first slot on Friday mentions the streak', () => {
  const r = decideReminders({ now: utc('2026-11-13T09:00:00Z'), settings, posts: lastWeekend });
  assert.equal(r.length, 1);
  assert.equal(r[0].kind, 'reminder');
  assert.equal(r[0].slot, '09:00');
  assert.equal(r[0].forDay, '2026-11-13');
  assert.equal(r[0].tag, 'day-2026-11-13');
  assert.equal(r[0].body, "Friday's post is due. Your 3-day streak is waiting.");
});

test('middle and last-call slots escalate', () => {
  const mid = decideReminders({ now: utc('2026-11-13T18:10:00Z'), settings, posts: lastWeekend });
  assert.equal(mid[0].slot, '18:00');
  assert.equal(mid[0].body, 'Still time. Post today to keep 3 days alive.');
  const last = decideReminders({ now: utc('2026-11-13T21:45:00Z'), settings, posts: lastWeekend });
  assert.equal(last[0].kind, 'last_call');
  assert.equal(last[0].body, 'Last call. Post before midnight or the streak ends.');
});

test('a late cron only sends the latest slot, never a backlog', () => {
  const r = decideReminders({ now: utc('2026-11-13T22:00:00Z'), settings, posts: lastWeekend });
  assert.equal(r.length, 1);
  assert.equal(r[0].slot, '21:30');
});

test('already-sent slots are skipped (cron fires twice)', () => {
  const sent = [sentKey('reminder', '2026-11-13', '09:00')];
  assert.deepEqual(decideReminders({ now: utc('2026-11-13T09:15:00Z'), settings, posts: lastWeekend, sent }), []);
});

test('no reminders once today is complete', () => {
  const posts = [...lastWeekend, post('2026-11-13T08:00:00Z')];
  assert.deepEqual(decideReminders({ now: utc('2026-11-13T18:30:00Z'), settings, posts }), []);
});

test('no reminders on weekdays or when disabled or before start', () => {
  assert.deepEqual(decideReminders({ now: utc('2026-11-12T18:30:00Z'), settings, posts: [] }), []);
  assert.deepEqual(decideReminders({ now: utc('2026-11-13T18:30:00Z'), settings: { ...settings, reminders_enabled: false }, posts: [] }), []);
  assert.deepEqual(decideReminders({ now: utc('2026-11-13T18:30:00Z'), settings: { ...settings, start_date: '2026-11-20' }, posts: [] }), []);
});

test('grace reminder on Monday morning for an unlogged Sunday', () => {
  const posts = [...lastWeekend, post('2026-11-13T09:00:00Z'), post('2026-11-14T09:00:00Z')];
  assert.deepEqual(decideReminders({ now: utc('2026-11-16T09:59:00Z'), settings, posts }), []);
  const r = decideReminders({ now: utc('2026-11-16T10:00:00Z'), settings, posts });
  assert.equal(r.length, 1);
  assert.equal(r[0].kind, 'grace');
  assert.equal(r[0].forDay, '2026-11-15');
  assert.equal(r[0].body, "Yesterday's post isn't logged. You have until noon.");
  // After noon: nothing
  assert.deepEqual(decideReminders({ now: utc('2026-11-16T12:00:00Z'), settings, posts }), []);
});

test('Saturday morning can send both a grace (Friday) and a reminder (Saturday)', () => {
  const r = decideReminders({ now: utc('2026-11-14T10:05:00Z'), settings, posts: lastWeekend });
  assert.deepEqual(r.map((x) => x.kind).sort(), ['grace', 'reminder']);
});

test('slot times follow London wall clock in summer', () => {
  const summer = { ...settings, start_date: '2026-07-03' };
  // 08:30 UTC on 3 Jul = 09:30 BST
  const r = decideReminders({ now: utc('2026-07-03T08:30:00Z'), settings: summer, posts: [] });
  assert.equal(r[0].slot, '09:00');
  assert.equal(r[0].body, "Friday's post is due. Post today to start a streak.");
  assert.deepEqual(decideReminders({ now: utc('2026-07-03T07:59:00Z'), settings: summer, posts: [] }), []);
});
