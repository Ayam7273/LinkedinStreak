import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  londonDate,
  londonMinutes,
  londonToInstant,
  graceDeadline,
  weekdayOf,
  isRequiredDay,
  addDays,
  nextFriday,
  weekendFriday,
  formatWeekendRange,
  formatInstant,
} from '../js/time.js';

const utc = (s) => Date.parse(s);

test('weekdays and required days', () => {
  assert.equal(weekdayOf('2026-11-13'), 5);
  assert.equal(isRequiredDay('2026-11-13'), true); // Fri
  assert.equal(isRequiredDay('2026-11-14'), true); // Sat
  assert.equal(isRequiredDay('2026-11-15'), true); // Sun
  assert.equal(isRequiredDay('2026-11-12'), false); // Thu
  assert.equal(isRequiredDay('2026-11-16'), false); // Mon
});

test('addDays crosses months and years', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('summer time: 23:30 UTC is already the next London day', () => {
  // 14 Aug 2026 23:30 UTC = 15 Aug 00:30 BST
  assert.equal(londonDate(utc('2026-08-14T23:30:00Z')), '2026-08-15');
  assert.equal(londonDate(utc('2026-01-14T23:30:00Z')), '2026-01-14');
});

test('spring-forward Sunday (29 Mar 2026) is a 23-hour day', () => {
  // 00:30 GMT on the Sunday
  assert.equal(londonDate(utc('2026-03-29T00:30:00Z')), '2026-03-29');
  // 01:30 UTC = 02:30 BST, still Sunday
  assert.equal(londonDate(utc('2026-03-29T01:30:00Z')), '2026-03-29');
  // 23:30 UTC Sunday = 00:30 BST Monday
  assert.equal(londonDate(utc('2026-03-29T23:30:00Z')), '2026-03-30');
  // 23:30 UTC Saturday = 23:30 GMT Saturday
  assert.equal(londonDate(utc('2026-03-28T23:30:00Z')), '2026-03-28');
  const len = londonToInstant('2026-03-30') - londonToInstant('2026-03-29');
  assert.equal(len, 23 * 3600000);
});

test('fall-back Sunday (25 Oct 2026) is a 25-hour day', () => {
  // 00:30 BST Sunday = 23:30 UTC Saturday
  assert.equal(londonDate(utc('2026-10-24T23:30:00Z')), '2026-10-25');
  // 01:30 happens twice: 00:30 UTC (BST) and 01:30 UTC (GMT)
  assert.equal(londonDate(utc('2026-10-25T00:30:00Z')), '2026-10-25');
  assert.equal(londonMinutes(utc('2026-10-25T00:30:00Z')), 90);
  assert.equal(londonDate(utc('2026-10-25T01:30:00Z')), '2026-10-25');
  assert.equal(londonMinutes(utc('2026-10-25T01:30:00Z')), 90);
  // 23:30 UTC Sunday = 23:30 GMT Sunday
  assert.equal(londonDate(utc('2026-10-25T23:30:00Z')), '2026-10-25');
  const len = londonToInstant('2026-10-26') - londonToInstant('2026-10-25');
  assert.equal(len, 25 * 3600000);
});

test('londonToInstant across offsets', () => {
  assert.equal(londonToInstant('2026-11-14', '12:00'), utc('2026-11-14T12:00:00Z'));
  assert.equal(londonToInstant('2026-07-04', '12:00'), utc('2026-07-04T11:00:00Z'));
  // Repeated 01:30 on fall-back day -> first occurrence (BST)
  assert.equal(londonToInstant('2026-10-25', '01:30'), utc('2026-10-25T00:30:00Z'));
  // Skipped 01:30 on spring-forward day -> shifted forward an hour (02:30 BST)
  assert.equal(londonToInstant('2026-03-29', '01:30'), utc('2026-03-29T01:30:00Z'));
});

test('grace deadline is noon London the next day', () => {
  assert.equal(graceDeadline('2026-11-13'), utc('2026-11-14T12:00:00Z'));
  assert.equal(graceDeadline('2026-11-15'), utc('2026-11-16T12:00:00Z'));
  // Sunday before fall-back: Monday is GMT
  assert.equal(graceDeadline('2026-10-25'), utc('2026-10-26T12:00:00Z'));
  // Spring-forward Sunday: Monday noon is BST
  assert.equal(graceDeadline('2026-03-29'), utc('2026-03-30T11:00:00Z'));
});

test('nextFriday and weekendFriday', () => {
  assert.equal(nextFriday('2026-11-11'), '2026-11-13');
  assert.equal(nextFriday('2026-11-13'), '2026-11-13');
  assert.equal(nextFriday('2026-11-14'), '2026-11-20');
  assert.equal(weekendFriday('2026-11-15'), '2026-11-13');
  assert.equal(weekendFriday('2026-11-16'), '2026-11-20');
});

test('formatting', () => {
  assert.equal(formatWeekendRange('2026-11-13'), '13–15 Nov');
  assert.equal(formatWeekendRange('2026-10-30'), '30 Oct – 1 Nov');
  assert.equal(formatInstant(utc('2026-11-13T08:42:00Z')), 'Fri 13 Nov, 08:42');
});
