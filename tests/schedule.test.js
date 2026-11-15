import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  requiredDays,
  requiredWeeks,
  versionFor,
  isPaused,
  unitKeyFor,
  countPlanned,
  describeSchedule,
} from '../js/core/schedule.js';
import { formatDay, weekdayLabel } from '../js/core/time.js';

const V = (o) => ({ effective_from: '2026-01-01', days_of_week: [5, 6, 0], weekly_target: 3, grace_hours: 12, timezone: 'Europe/London', reminders_enabled: true, reminder_times: ['09:00'], grace_reminder: true, ...o });

test('days mode: selected weekdays only, within start/end', () => {
  const goal = { mode: 'days', start_date: '2026-11-13', end_date: '2026-11-22' };
  const days = requiredDays(goal, [V()], [], '2026-11-01', '2026-11-30').map((d) => d.key);
  assert.deepEqual(days, ['2026-11-13', '2026-11-14', '2026-11-15', '2026-11-20', '2026-11-21', '2026-11-22']);
});

test('versions: each date uses the version in effect on it', () => {
  const versions = [V({ effective_from: '2026-11-09', days_of_week: [1, 3, 5] }), V({ effective_from: '2026-11-11', days_of_week: [5, 6, 0] })];
  assert.deepEqual(versionFor(versions, '2026-11-09').days_of_week, [1, 3, 5]);
  assert.deepEqual(versionFor(versions, '2026-11-11').days_of_week, [5, 6, 0]);
  assert.deepEqual(versionFor(versions, '2026-10-01').days_of_week, [1, 3, 5]); // before any: earliest
  const goal = { mode: 'days', start_date: '2026-11-09', end_date: null };
  const keys = requiredDays(goal, versions, [], '2026-11-09', '2026-11-15').map((d) => d.key);
  // Mon (old schedule), then Fri/Sat/Sun (new). Wed is under the new version, so not required.
  assert.deepEqual(keys, ['2026-11-09', '2026-11-13', '2026-11-14', '2026-11-15']);
});

test('pauses mark dates paused (open-ended pause too)', () => {
  const pauses = [{ from_date: '2026-11-14', to_date: '2026-11-14' }, { from_date: '2026-12-01', to_date: null }];
  assert.equal(isPaused(pauses, '2026-11-14'), true);
  assert.equal(isPaused(pauses, '2026-11-15'), false);
  assert.equal(isPaused(pauses, '2027-05-01'), true);
  const goal = { mode: 'days', start_date: '2026-11-13', end_date: null };
  const sat = requiredDays(goal, [V()], pauses, '2026-11-13', '2026-11-15')[1];
  assert.equal(sat.paused, true);
});

test('weekly mode: partial first/last weeks count only if daysRemaining >= N', () => {
  const versions = [V({ weekly_target: 3 })];
  // Start Thu 12 Nov: Thu–Sun = 4 days >= 3 -> required
  let weeks = requiredWeeks({ mode: 'weekly', start_date: '2026-11-12', end_date: null }, versions, [], '2026-11-12', '2026-11-22');
  assert.deepEqual(weeks.map((w) => [w.key, w.first, w.days]), [['2026-11-09', '2026-11-12', 4], ['2026-11-16', '2026-11-16', 7]]);
  // Start Sat 14 Nov: Sat–Sun = 2 days < 3 -> skipped
  weeks = requiredWeeks({ mode: 'weekly', start_date: '2026-11-14', end_date: null }, versions, [], '2026-11-14', '2026-11-22');
  assert.deepEqual(weeks.map((w) => w.key), ['2026-11-16']);
  // End Tue 24 Nov: Mon–Tue = 2 days < 3 -> skipped
  weeks = requiredWeeks({ mode: 'weekly', start_date: '2026-11-16', end_date: '2026-11-24' }, versions, [], '2026-11-16', '2026-11-30');
  assert.deepEqual(weeks.map((w) => w.key), ['2026-11-16']);
  // End Wed 25 Nov: 3 days -> required
  weeks = requiredWeeks({ mode: 'weekly', start_date: '2026-11-16', end_date: '2026-11-25' }, versions, [], '2026-11-16', '2026-11-30');
  assert.deepEqual(weeks.map((w) => [w.key, w.last]), [['2026-11-16', '2026-11-22'], ['2026-11-23', '2026-11-25']]);
});

test('weekly mode: Sunday week start', () => {
  const weeks = requiredWeeks({ mode: 'weekly', start_date: '2026-11-08', end_date: null }, [V({ weekly_target: 1 })], [], '2026-11-08', '2026-11-14', 'sun');
  assert.deepEqual(weeks.map((w) => [w.key, w.last]), [['2026-11-08', '2026-11-14']]);
});

test('weekly mode: a week paused below N usable days is paused', () => {
  const pauses = [{ from_date: '2026-11-16', to_date: '2026-11-20' }];
  const w = requiredWeeks({ mode: 'weekly', start_date: '2026-11-16', end_date: null }, [V({ weekly_target: 3 })], pauses, '2026-11-16', '2026-11-22');
  assert.equal(w[0].paused, true); // only Sat+Sun usable
});

test('unitKeyFor uses the goal timezone', () => {
  const goal = { mode: 'days' };
  const t = Date.parse('2026-11-14T03:30:00Z');
  assert.equal(unitKeyFor(goal, [V({ timezone: 'America/New_York' })], t).key, '2026-11-13');
  assert.equal(unitKeyFor(goal, [V({ timezone: 'Europe/London' })], t).key, '2026-11-14');
  assert.equal(unitKeyFor({ mode: 'weekly' }, [V()], t).key, '2026-11-09');
});

test('countPlanned: 12 weeks of Fri/Sat/Sun from 13 Nov is 36 posts', () => {
  assert.deepEqual(countPlanned({ mode: 'days', days_of_week: [5, 6, 0], start_date: '2026-11-13', end_date: '2027-02-04' }), { units: 36, posts: 36 });
  assert.deepEqual(countPlanned({ mode: 'weekly', weekly_target: 3, start_date: '2026-11-16', end_date: '2026-12-13' }), { units: 4, posts: 12 });
  assert.equal(countPlanned({ mode: 'days', days_of_week: [1], start_date: '2026-11-13', end_date: null }), null);
});

test('describeSchedule reads naturally', () => {
  const h = { formatDay, weekdayLabel };
  assert.equal(describeSchedule({ mode: 'days', days_of_week: [0, 5, 6] }, h).what, 'every Fri, Sat and Sun');
  assert.equal(describeSchedule({ mode: 'days', days_of_week: [0, 1, 2, 3, 4, 5, 6] }, h).what, 'every day');
  assert.equal(describeSchedule({ mode: 'weekly', weekly_target: 3 }, h).what, '3 posts a week, any days');
  assert.equal(describeSchedule({ mode: 'weekly', weekly_target: 3, end_date: null }, h).span, 'ongoing');
});
