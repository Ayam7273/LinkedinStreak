import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarise, checkNewPost, dayState } from '../js/streak.js';
import { londonDate } from '../js/time.js';

const utc = (s) => Date.parse(s);
let seq = 1n;
const idFor = (ms) => String((BigInt(ms) << 22n) | seq++);

/** A saved post published at a UTC ISO time. */
function post(iso) {
  const ms = utc(iso);
  return { activity_id: idFor(ms), published_at: ms, required_day: londonDate(ms) };
}

const START = '2026-11-06'; // Friday
const wk1 = [post('2026-11-06T09:00:00Z'), post('2026-11-07T09:00:00Z'), post('2026-11-08T09:00:00Z')];
const wk2 = [post('2026-11-13T09:00:00Z'), post('2026-11-14T09:00:00Z'), post('2026-11-15T09:00:00Z')];

test('a full weekend gives 3, the next gives 6', () => {
  const a = summarise({ startDate: START, now: utc('2026-11-09T13:00:00Z'), posts: wk1 });
  assert.equal(a.current, 3);
  assert.equal(a.fullWeekends, 1);
  const b = summarise({ startDate: START, now: utc('2026-11-16T13:00:00Z'), posts: [...wk1, ...wk2] });
  assert.equal(b.current, 6);
  assert.equal(b.best, 6);
  assert.equal(b.fullWeekends, 2);
  assert.equal(b.totalPosts, 6);
  assert.equal(b.completionRate, 1);
});

test('a missed Saturday resets; Sunday starts a new streak of 1', () => {
  const posts = [...wk1, post('2026-11-13T09:00:00Z'), post('2026-11-15T09:00:00Z')];
  const s = summarise({ startDate: START, now: utc('2026-11-16T13:00:00Z'), posts });
  const sat = s.days.find((d) => d.date === '2026-11-14');
  assert.equal(sat.state, 'missed');
  assert.equal(s.current, 1);
  assert.equal(s.best, 4);
  assert.equal(s.fullWeekends, 0);
});

test('grace: Friday 23:50 post logged Saturday 11:59 counts, 12:01 is rejected', () => {
  const pub = utc('2026-11-13T23:50:00Z'); // GMT, so 23:50 London Friday
  const ok = checkNewPost({ activityId: idFor(pub), publishedAt: pub, now: utc('2026-11-14T11:59:00Z'), startDate: START, posts: wk1 });
  assert.equal(ok.ok, true);
  assert.equal(ok.day, '2026-11-13');
  assert.equal(ok.streakAfter, 4);

  const late = checkNewPost({ activityId: idFor(pub), publishedAt: pub, now: utc('2026-11-14T12:01:00Z'), startDate: START, posts: wk1 });
  assert.equal(late.ok, false);
  assert.equal(late.code, 'GRACE_EXPIRED');
});

test('grace and missed states around Saturday noon', () => {
  const byDay = new Map();
  assert.equal(dayState('2026-11-13', { startDate: START, now: utc('2026-11-14T11:59:00Z'), byDay }), 'grace');
  assert.equal(dayState('2026-11-13', { startDate: START, now: utc('2026-11-14T12:00:00Z'), byDay }), 'missed');
});

test('a Thursday post is rejected with a clear reason', () => {
  const pub = utc('2026-11-12T10:00:00Z');
  const r = checkNewPost({ activityId: idFor(pub), publishedAt: pub, now: utc('2026-11-12T10:05:00Z'), startDate: START, posts: [] });
  assert.equal(r.code, 'NOT_REQUIRED_DAY');
  assert.match(r.message, /Thursday 12 Nov/);
  assert.match(r.message, /Friday, Saturday and Sunday/);
});

test('second Saturday post is DAY_ALREADY_LOGGED, not moved to Sunday', () => {
  const first = post('2026-11-14T08:00:00Z');
  const pub = utc('2026-11-14T18:00:00Z');
  const r = checkNewPost({ activityId: idFor(pub), publishedAt: pub, now: utc('2026-11-14T18:05:00Z'), startDate: START, posts: [first] });
  assert.equal(r.code, 'DAY_ALREADY_LOGGED');
});

test('duplicate activity ID is rejected', () => {
  const p = post('2026-11-14T08:00:00Z');
  const r = checkNewPost({ activityId: p.activity_id, publishedAt: p.published_at, now: utc('2026-11-14T09:00:00Z'), startDate: START, posts: [p] });
  assert.equal(r.code, 'DUPLICATE');
});

test('posts before the start date are rejected', () => {
  const pub = utc('2026-10-31T10:00:00Z');
  const r = checkNewPost({ activityId: idFor(pub), publishedAt: pub, now: utc('2026-10-31T11:00:00Z'), startDate: START, posts: [] });
  assert.equal(r.code, 'BEFORE_START');
});

test('spring-forward Sunday: 00:30 and 01:30 London land on Sunday', () => {
  const start = '2026-03-27';
  // 00:30 GMT Sunday 29 Mar
  const a = checkNewPost({ activityId: '1', publishedAt: utc('2026-03-29T00:30:00Z'), now: utc('2026-03-29T09:00:00Z'), startDate: start, posts: [] });
  assert.equal(a.day, '2026-03-29');
  // 01:30 London does not exist; 01:30 UTC is 02:30 BST, still Sunday
  const b = checkNewPost({ activityId: '2', publishedAt: utc('2026-03-29T01:30:00Z'), now: utc('2026-03-29T09:00:00Z'), startDate: start, posts: [] });
  assert.equal(b.day, '2026-03-29');
  // Saturday 23:30 GMT stays Saturday
  const c = checkNewPost({ activityId: '3', publishedAt: utc('2026-03-28T23:30:00Z'), now: utc('2026-03-29T09:00:00Z'), startDate: start, posts: [] });
  assert.equal(c.day, '2026-03-28');
  // Sunday 23:30 UTC is Monday 00:30 BST: not a required day
  const d = checkNewPost({ activityId: '4', publishedAt: utc('2026-03-29T23:30:00Z'), now: utc('2026-03-30T09:00:00Z'), startDate: start, posts: [] });
  assert.equal(d.code, 'NOT_REQUIRED_DAY');
  // Grace for that Sunday closes Monday 12:00 BST = 11:00 UTC
  const e = checkNewPost({ activityId: '5', publishedAt: utc('2026-03-29T20:00:00Z'), now: utc('2026-03-30T11:00:00Z'), startDate: start, posts: [] });
  assert.equal(e.code, 'GRACE_EXPIRED');
  const f = checkNewPost({ activityId: '6', publishedAt: utc('2026-03-29T20:00:00Z'), now: utc('2026-03-30T10:59:00Z'), startDate: start, posts: [] });
  assert.equal(f.ok, true);
});

test('fall-back Sunday: 00:30 and both 01:30s London land on Sunday', () => {
  const start = '2026-10-23';
  const now = utc('2026-10-25T11:00:00Z'); // before Saturday's grace closes (12:00 GMT)
  // 00:30 BST Sunday = 23:30 UTC Saturday
  assert.equal(checkNewPost({ activityId: '1', publishedAt: utc('2026-10-24T23:30:00Z'), now, startDate: start, posts: [] }).day, '2026-10-25');
  // First 01:30 (BST)
  assert.equal(checkNewPost({ activityId: '2', publishedAt: utc('2026-10-25T00:30:00Z'), now, startDate: start, posts: [] }).day, '2026-10-25');
  // Second 01:30 (GMT)
  assert.equal(checkNewPost({ activityId: '3', publishedAt: utc('2026-10-25T01:30:00Z'), now, startDate: start, posts: [] }).day, '2026-10-25');
  // Saturday 22:30 UTC = 23:30 BST Saturday
  assert.equal(checkNewPost({ activityId: '4', publishedAt: utc('2026-10-24T22:30:00Z'), now, startDate: start, posts: [] }).day, '2026-10-24');
  // A full 25-hour Sunday counts once in the streak
  const posts = [post('2026-10-23T09:00:00Z'), post('2026-10-24T09:00:00Z'), post('2026-10-25T23:30:00Z')];
  assert.equal(posts[2].required_day, '2026-10-25');
  assert.equal(summarise({ startDate: start, now: utc('2026-10-26T13:00:00Z'), posts }).current, 3);
});

test('Friday 08:00 with nothing logged: Friday is open and last streak stands', () => {
  const s = summarise({ startDate: START, now: utc('2026-11-13T08:00:00Z'), posts: wk1 });
  assert.equal(s.focus, '2026-11-13');
  const fri = s.days.find((d) => d.date === '2026-11-13');
  assert.equal(fri.state, 'open');
  assert.equal(s.days.find((d) => d.date === '2026-11-14').state, 'upcoming');
  assert.equal(s.current, 3);
});

test('Saturday morning in grace: Friday neither breaks nor extends', () => {
  const s = summarise({ startDate: START, now: utc('2026-11-14T09:00:00Z'), posts: wk1 });
  assert.equal(s.days.find((d) => d.date === '2026-11-13').state, 'grace');
  assert.equal(s.days.find((d) => d.date === '2026-11-14').state, 'open');
  assert.equal(s.current, 3);
});

test('days before start are before-start and never count', () => {
  const s = summarise({ startDate: '2026-11-14', now: utc('2026-11-16T13:00:00Z'), posts: [] });
  assert.equal(s.days.find((d) => d.date === '2026-11-13').state, 'before-start');
  assert.equal(s.days.find((d) => d.date === '2026-11-14').state, 'missed');
  assert.equal(s.current, 0);
  assert.equal(s.missed, 2);
});

test('start date in the future: everything is before-start or upcoming', () => {
  const s = summarise({ startDate: '2026-11-20', now: utc('2026-11-11T12:00:00Z'), posts: [] });
  assert.equal(s.focus, '2026-11-13');
  assert.ok(s.days.every((d) => d.state === 'before-start'));
  assert.equal(s.current, 0);
  assert.equal(s.completionRate, null);
});
