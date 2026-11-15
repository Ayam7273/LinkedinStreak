import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dateIn,
  minutesIn,
  zonedToInstant,
  startOfDay,
  endOfDay,
  weekStartOf,
  weekdayOf,
  addDays,
  daysBetween,
  isValidTimeZone,
  isDate,
  isHm,
  formatInstant,
  formatRange,
} from '../js/core/time.js';

const utc = (s) => Date.parse(s);
const H = 3600000;
const LON = 'Europe/London';
const NY = 'America/New_York';
const LAG = 'Africa/Lagos';
const SYD = 'Australia/Sydney';

test('calendar helpers', () => {
  assert.equal(weekdayOf('2026-11-13'), 5);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(daysBetween('2026-11-09', '2026-11-15'), 6);
  assert.equal(weekStartOf('2026-11-12', 'mon'), '2026-11-09');
  assert.equal(weekStartOf('2026-11-12', 'sun'), '2026-11-08');
  assert.equal(weekStartOf('2026-11-08', 'mon'), '2026-11-02');
  assert.equal(weekStartOf('2026-11-08', 'sun'), '2026-11-08');
  assert.ok(isDate('2026-02-28'));
  assert.ok(!isDate('2026-02-30'));
  assert.ok(isHm('09:00') && isHm('23:59') && !isHm('24:00') && !isHm('9:00'));
});

test('timezone validation', () => {
  assert.ok(isValidTimeZone(LON) && isValidTimeZone(NY) && isValidTimeZone('UTC'));
  assert.ok(!isValidTimeZone('Mars/Olympus') && !isValidTimeZone('') && !isValidTimeZone(null));
});

test('same instant, different calendar days per zone', () => {
  const t = utc('2026-11-14T03:30:00Z');
  assert.equal(dateIn(t, LON), '2026-11-14');
  assert.equal(dateIn(t, NY), '2026-11-13'); // 22:30 EST Friday
  assert.equal(dateIn(t, SYD), '2026-11-14'); // 14:30 AEDT
  assert.equal(dateIn(t, LAG), '2026-11-14'); // 04:30 WAT
});

test('Europe/London: spring forward (29 Mar 2026) and fall back (25 Oct 2026)', () => {
  assert.equal(endOfDay('2026-03-29', LON) - startOfDay('2026-03-29', LON), 23 * H);
  assert.equal(dateIn(utc('2026-03-29T01:30:00Z'), LON), '2026-03-29'); // 02:30 BST
  assert.equal(zonedToInstant('2026-03-29', '01:30', LON), utc('2026-03-29T01:30:00Z')); // skipped -> 02:30 BST
  assert.equal(endOfDay('2026-10-25', LON) - startOfDay('2026-10-25', LON), 25 * H);
  // 01:30 happens twice
  assert.equal(minutesIn(utc('2026-10-25T00:30:00Z'), LON), 90);
  assert.equal(minutesIn(utc('2026-10-25T01:30:00Z'), LON), 90);
  assert.equal(dateIn(utc('2026-10-25T01:30:00Z'), LON), '2026-10-25');
  assert.equal(zonedToInstant('2026-10-25', '01:30', LON), utc('2026-10-25T00:30:00Z')); // first occurrence
});

test('America/New_York: spring forward (8 Mar 2026) and fall back (1 Nov 2026)', () => {
  assert.equal(endOfDay('2026-03-08', NY) - startOfDay('2026-03-08', NY), 23 * H);
  assert.equal(dateIn(utc('2026-03-08T06:59:00Z'), NY), '2026-03-08'); // 01:59 EST
  assert.equal(zonedToInstant('2026-03-08', '02:30', NY), utc('2026-03-08T07:30:00Z')); // skipped -> 03:30 EDT
  assert.equal(endOfDay('2026-11-01', NY) - startOfDay('2026-11-01', NY), 25 * H);
  assert.equal(dateIn(utc('2026-11-01T03:59:00Z'), NY), '2026-10-31'); // 23:59 EDT Sat
  assert.equal(dateIn(utc('2026-11-01T04:30:00Z'), NY), '2026-11-01'); // 00:30 EDT Sun
  // 01:30 twice: EDT then EST
  assert.equal(minutesIn(utc('2026-11-01T05:30:00Z'), NY), 90);
  assert.equal(minutesIn(utc('2026-11-01T06:30:00Z'), NY), 90);
  assert.equal(zonedToInstant('2026-11-01', '01:30', NY), utc('2026-11-01T05:30:00Z'));
});

test('Africa/Lagos: no DST, always 24 hours', () => {
  for (const d of ['2026-03-29', '2026-10-25', '2026-03-08', '2026-11-01']) {
    assert.equal(endOfDay(d, LAG) - startOfDay(d, LAG), 24 * H);
  }
  assert.equal(dateIn(utc('2026-01-01T23:30:00Z'), LAG), '2026-01-02');
  assert.equal(zonedToInstant('2026-06-01', '09:00', LAG), utc('2026-06-01T08:00:00Z'));
});

test('Australia/Sydney: fall back (5 Apr 2026) and spring forward (4 Oct 2026)', () => {
  assert.equal(startOfDay('2026-04-05', SYD), utc('2026-04-04T13:00:00Z')); // 00:00 AEDT
  assert.equal(endOfDay('2026-04-05', SYD) - startOfDay('2026-04-05', SYD), 25 * H);
  // 02:30 twice: AEDT (+11) then AEST (+10)
  assert.equal(dateIn(utc('2026-04-04T15:30:00Z'), SYD), '2026-04-05');
  assert.equal(minutesIn(utc('2026-04-04T15:30:00Z'), SYD), 150);
  assert.equal(minutesIn(utc('2026-04-04T16:30:00Z'), SYD), 150);
  assert.equal(endOfDay('2026-10-04', SYD) - startOfDay('2026-10-04', SYD), 23 * H);
  assert.equal(zonedToInstant('2026-10-04', '02:30', SYD), utc('2026-10-03T16:30:00Z')); // skipped -> 03:30 AEDT
});

test('formatting', () => {
  assert.equal(formatInstant(utc('2026-11-13T08:42:00Z'), LON), 'Fri 13 Nov, 08:42');
  assert.equal(formatInstant(utc('2026-11-13T08:42:00Z'), NY), 'Fri 13 Nov, 03:42');
  assert.equal(formatRange('2026-11-09', '2026-11-15'), '9–15 Nov');
  assert.equal(formatRange('2026-10-26', '2026-11-01'), '26 Oct – 1 Nov');
});
