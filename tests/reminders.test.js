import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideReminders, sentKey } from '../js/core/reminders.js';
import { dateIn, weekStartOf } from '../js/core/time.js';

const utc = (s) => Date.parse(s);
const H = 3600000;
let seq = 1n;
const V = (o = {}) => ({ effective_from: '2026-11-01', days_of_week: [5, 6, 0], weekly_target: 3, grace_hours: 12, timezone: 'Europe/London', reminders_enabled: true, reminder_times: ['09:00', '18:00', '21:30'], grace_reminder: true, ...o });
const G = (o = {}) => ({ id: 'g1', mode: 'days', status: 'active', start_date: '2026-11-06', end_date: null, ...o });
function post(iso, goal = G(), tz = 'Europe/London') {
  const ms = utc(iso);
  const d = dateIn(ms, tz);
  return { activity_id: String((BigInt(ms) << 22n) | seq++), goal_id: goal.id, published_at: ms, logged_at: ms + H, unit_key: goal.mode === 'weekly' ? weekStartOf(d) : d };
}
const lastWeekend = [post('2026-11-06T09:00:00Z'), post('2026-11-07T09:00:00Z'), post('2026-11-08T09:00:00Z')];
const run = (now, o = {}) => decideReminders({ now: utc(now), goal: G(), versions: [V()], posts: lastWeekend, ...o });

test('nothing before the first slot; first slot mentions the streak', () => {
  assert.deepEqual(run('2026-11-13T08:59:00Z'), []);
  const r = run('2026-11-13T09:00:00Z');
  assert.equal(r.length, 1);
  assert.equal(r[0].kind, 'reminder');
  assert.equal(r[0].body, "Friday's post is due — your 3-day streak is waiting.");
  assert.equal(r[0].tag, 'g-g1-2026-11-13');
  assert.equal(r[0].url, '/app.html#/log');
});

test('slots escalate through the day', () => {
  assert.equal(run('2026-11-13T18:05:00Z')[0].body, 'Still time — post today to keep your 3-day streak.');
  const last = run('2026-11-13T21:35:00Z')[0];
  assert.equal(last.kind, 'last_call');
  assert.match(last.body, /Last call/);
});

test('already-sent slots are skipped (cron fires twice)', () => {
  assert.deepEqual(run('2026-11-13T09:15:00Z', { sent: [sentKey('reminder', '2026-11-13', '09:00')] }), []);
});

test('a stale slot (>3h late) is not sent', () => {
  assert.deepEqual(run('2026-11-13T12:30:00Z'), []);
});

test('quiet hours: a late slot that drifts past 22:00 is held; an explicit late slot is sent', () => {
  assert.deepEqual(run('2026-11-13T22:10:00Z'), []); // 21:30 slot, now 22:10
  const late = run('2026-11-13T22:35:00Z', { versions: [V({ reminder_times: ['09:00', '22:30'] })] });
  assert.equal(late.length, 1);
  assert.equal(late[0].slot, '22:30');
});

test('New York user gets reminders at New York times, not London times', () => {
  const ny = { versions: [V({ timezone: 'America/New_York' })], posts: [] };
  assert.deepEqual(run('2026-11-13T09:00:00Z', ny), []); // 04:00 in NY
  assert.deepEqual(run('2026-11-13T13:59:00Z', ny), []); // 08:59 in NY
  const r = run('2026-11-13T14:00:00Z', ny); // 09:00 in NY
  assert.equal(r.length, 1);
  assert.equal(r[0].slot, '09:00');
  assert.equal(r[0].unitKey, '2026-11-13');
});

test('no reminders when today is done, not required, paused, inactive, ended or disabled', () => {
  assert.deepEqual(run('2026-11-13T18:30:00Z', { posts: [...lastWeekend, post('2026-11-13T08:00:00Z')] }), []);
  assert.deepEqual(run('2026-11-12T18:30:00Z'), []);
  assert.deepEqual(run('2026-11-13T18:30:00Z', { pauses: [{ from_date: '2026-11-13', to_date: null }] }), []);
  assert.deepEqual(run('2026-11-13T18:30:00Z', { goal: G({ status: 'paused' }) }), []);
  assert.deepEqual(run('2026-11-13T18:30:00Z', { goal: G({ end_date: '2026-11-08' }) }), []);
  assert.deepEqual(run('2026-11-13T18:30:00Z', { versions: [V({ reminders_enabled: false })] }), []);
});

test('grace reminder the morning after, never before 07:00, not when switched off', () => {
  const posts = [...lastWeekend, post('2026-11-13T09:00:00Z'), post('2026-11-14T09:00:00Z')];
  assert.deepEqual(run('2026-11-16T06:50:00Z', { posts }), []);
  const r = run('2026-11-16T07:05:00Z', { posts });
  assert.equal(r.length, 1);
  assert.equal(r[0].kind, 'grace');
  assert.equal(r[0].unitKey, '2026-11-15');
  assert.equal(r[0].body, "Yesterday's post isn't logged yet — you have until 12:00.");
  assert.deepEqual(run('2026-11-16T07:05:00Z', { posts, versions: [V({ grace_reminder: false })] }), []);
  assert.deepEqual(run('2026-11-16T11:50:00Z', { posts }), []); // under 15 minutes left
});

test('weekly mode: one gentle nudge a day while there is slack', () => {
  const goal = G({ mode: 'weekly', start_date: '2026-11-09' });
  const posts = [post('2026-11-09T09:00:00Z', goal)];
  const o = { goal, posts };
  const r = run('2026-11-11T09:05:00Z', o); // Wed: 1 of 3, 5 days left
  assert.equal(r.length, 1);
  assert.equal(r[0].body, '1 of 3 posts done this week — 5 days left.');
  assert.deepEqual(run('2026-11-11T18:05:00Z', o), []); // only the first slot when not urgent
});

test('weekly mode: escalates when every remaining day is needed', () => {
  const goal = G({ mode: 'weekly', start_date: '2026-11-09' });
  const posts = [post('2026-11-09T09:00:00Z', goal)];
  const r = run('2026-11-14T18:05:00Z', { goal, posts }); // Sat: needs 2, 2 days left
  assert.equal(r.length, 1);
  assert.equal(r[0].title, 'Your week is at risk');
  const sun = run('2026-11-15T21:35:00Z', { goal, posts: [...posts, post('2026-11-14T10:00:00Z', goal)] });
  assert.equal(sun[0].kind, 'last_call');
  assert.match(sun[0].body, /Last day of the week — 1 more post/);
});

test('weekly mode: nothing once the target is met', () => {
  const goal = G({ mode: 'weekly', start_date: '2026-11-09' });
  const posts = ['2026-11-09', '2026-11-10', '2026-11-11'].map((d) => post(`${d}T09:00:00Z`, goal));
  assert.deepEqual(run('2026-11-12T09:05:00Z', { goal, posts }), []);
});
