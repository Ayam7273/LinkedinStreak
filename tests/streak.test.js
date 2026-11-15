import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarise, checkNewPost, weekStrip, currentUnit, graceLabel } from '../js/core/streak.js';
import { dateIn, weekStartOf } from '../js/core/time.js';

const utc = (s) => Date.parse(s);
const H = 3600000;
let seq = 1n;
const idFor = (ms) => String((BigInt(ms) << 22n) | seq++);

const V = (o = {}) => ({ effective_from: '2026-11-01', days_of_week: [5, 6, 0], weekly_target: 3, grace_hours: 12, timezone: 'Europe/London', reminders_enabled: true, reminder_times: ['09:00', '18:00', '21:30'], grace_reminder: true, ...o });
const G = (o = {}) => ({ id: 'g1', mode: 'days', status: 'active', start_date: '2026-11-06', end_date: null, ...o });

function post(iso, goal = G(), tz = 'Europe/London', weekStart = 'mon', loggedIso) {
  const ms = utc(iso);
  const d = dateIn(ms, tz);
  return { activity_id: idFor(ms), goal_id: goal.id, published_at: ms, logged_at: loggedIso ? utc(loggedIso) : ms + H, unit_key: goal.mode === 'weekly' ? weekStartOf(d, weekStart) : d };
}

test('days Fri/Sat/Sun: a full weekend gives 3', () => {
  const posts = [post('2026-11-06T09:00:00Z'), post('2026-11-07T09:00:00Z'), post('2026-11-08T09:00:00Z')];
  const s = summarise({ goal: G(), versions: [V()], posts, now: utc('2026-11-09T13:00:00Z') });
  assert.equal(s.current, 3);
  assert.equal(s.unit, 'days');
  assert.equal(s.completionRate, 1);
});

test('days: missing Saturday breaks it; Sunday starts a streak of 1', () => {
  const posts = [post('2026-11-06T09:00:00Z'), post('2026-11-08T09:00:00Z')];
  const s = summarise({ goal: G(), versions: [V()], posts, now: utc('2026-11-09T13:00:00Z') });
  assert.equal(s.units.find((u) => u.key === '2026-11-07').state, 'missed');
  assert.equal(s.current, 1);
  assert.equal(s.best, 1);
});

test('weekly N=3: weeks with 3, 2, 4 posts -> 0 after week 2, then 1 after week 3', () => {
  const goal = G({ mode: 'weekly', start_date: '2026-11-02' });
  const w1 = ['2026-11-02', '2026-11-04', '2026-11-06'].map((d) => post(`${d}T09:00:00Z`, goal));
  const w2 = ['2026-11-10', '2026-11-12'].map((d) => post(`${d}T09:00:00Z`, goal));
  const w3 = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19'].map((d) => post(`${d}T09:00:00Z`, goal));
  const afterW2 = summarise({ goal, versions: [V()], posts: [...w1, ...w2], now: utc('2026-11-16T13:00:00Z') });
  assert.equal(afterW2.unit, 'weeks');
  assert.equal(afterW2.units[1].state, 'missed');
  assert.equal(afterW2.current, 0);
  assert.equal(afterW2.best, 1);
  const afterW3 = summarise({ goal, versions: [V()], posts: [...w1, ...w2, ...w3], now: utc('2026-11-23T13:00:00Z') });
  assert.equal(afterW3.current, 1);
  assert.equal(afterW3.units[2].count, 4);
});

test('weekly: the current week is open and does not break the streak', () => {
  const goal = G({ mode: 'weekly', start_date: '2026-11-02' });
  const w1 = ['2026-11-02', '2026-11-04', '2026-11-06'].map((d) => post(`${d}T09:00:00Z`, goal));
  const s = summarise({ goal, versions: [V()], posts: [...w1, post('2026-11-10T09:00:00Z', goal)], now: utc('2026-11-11T13:00:00Z') });
  const cur = currentUnit(s);
  assert.equal(cur.state, 'open');
  assert.equal(cur.count, 1);
  assert.equal(s.current, 1);
});

test('grace: published 23:50, logged 11h later counts with 12h grace, rejected with none', () => {
  const pub = utc('2026-11-13T23:50:00Z'); // Fri 23:50 GMT
  const at = pub + 11 * H; // Sat 10:50
  const ok = checkNewPost({ goal: G(), versions: [V({ grace_hours: 12 })], activityId: idFor(pub), publishedAt: pub, now: at });
  assert.equal(ok.ok, true);
  assert.equal(ok.unitKey, '2026-11-13');
  const no = checkNewPost({ goal: G(), versions: [V({ grace_hours: 0 })], activityId: idFor(pub), publishedAt: pub, now: at });
  assert.equal(no.code, 'GRACE_EXPIRED');
  // Saved posts are judged the same way: logged after the deadline never counts.
  const late = summarise({ goal: G(), versions: [V({ grace_hours: 0 })], posts: [post('2026-11-13T23:50:00Z', G(), undefined, undefined, '2026-11-14T10:50:00Z')], now: utc('2026-11-14T11:00:00Z') });
  assert.equal(late.units.find((u) => u.key === '2026-11-13').state, 'missed');
});

test('grace state and label', () => {
  const s = summarise({ goal: G(), versions: [V({ grace_hours: 12 })], posts: [], now: utc('2026-11-14T09:00:00Z') });
  const fri = s.units.find((u) => u.key === '2026-11-13');
  assert.equal(fri.state, 'grace');
  assert.equal(graceLabel(fri), 'Log by 12:00');
  assert.equal(s.units.find((u) => u.key === '2026-11-14').state, 'open');
});

test('edit on Wednesday from Mon/Wed/Fri to Fri/Sat/Sun: Monday still judged by the old schedule', () => {
  const goal = G({ start_date: '2026-11-09' });
  const versions = [V({ effective_from: '2026-11-09', days_of_week: [1, 3, 5] }), V({ effective_from: '2026-11-11', days_of_week: [5, 6, 0] })];
  const s = summarise({ goal, versions, posts: [post('2026-11-09T09:00:00Z', goal)], now: utc('2026-11-12T12:00:00Z') });
  assert.equal(s.units.find((u) => u.key === '2026-11-09').state, 'complete');
  assert.equal(s.units.find((u) => u.key === '2026-11-11'), undefined); // Wed: new schedule, not required
  assert.equal(s.current, 1);
  // A Monday post *after* the edit week is no longer required
  const r = checkNewPost({ goal, versions, activityId: '9', publishedAt: utc('2026-11-16T09:00:00Z'), now: utc('2026-11-16T10:00:00Z') });
  assert.equal(r.code, 'NOT_REQUIRED_DAY');
});

test('pausing over a missed day does not break the streak', () => {
  const posts = [post('2026-11-06T09:00:00Z'), post('2026-11-08T09:00:00Z')];
  const pauses = [{ from_date: '2026-11-07', to_date: '2026-11-07' }];
  const s = summarise({ goal: G(), versions: [V()], pauses, posts, now: utc('2026-11-09T13:00:00Z') });
  assert.equal(s.units.find((u) => u.key === '2026-11-07').state, 'paused');
  assert.equal(s.current, 2);
  assert.equal(s.missed, 0);
});

test("the same activity ID logged by a second user is rejected", () => {
  const pub = utc('2026-11-13T09:00:00Z');
  const id = idFor(pub);
  const r = checkNewPost({ goal: G(), versions: [V()], posts: [], takenActivityIds: new Set([id]), activityId: id, publishedAt: pub, now: pub + H });
  assert.equal(r.code, 'DUPLICATE');
  const own = checkNewPost({ goal: G(), versions: [V()], posts: [{ activity_id: id, goal_id: 'g1', unit_key: '2026-11-13' }], activityId: id, publishedAt: pub, now: pub + H });
  assert.equal(own.code, 'DUPLICATE');
});

test('days mode: a post on a non-required day is NOT_REQUIRED_DAY', () => {
  const pub = utc('2026-11-12T10:00:00Z'); // Thursday
  const r = checkNewPost({ goal: G(), versions: [V()], activityId: '1', publishedAt: pub, now: pub + H });
  assert.equal(r.code, 'NOT_REQUIRED_DAY');
  assert.match(r.message, /Thursday 12 Nov/);
});

test('days mode: second post on the same day is DAY_ALREADY_LOGGED (not moved)', () => {
  const first = post('2026-11-14T08:00:00Z');
  const pub = utc('2026-11-14T18:00:00Z');
  const r = checkNewPost({ goal: G(), versions: [V()], posts: [first], activityId: idFor(pub), publishedAt: pub, now: pub + H });
  assert.equal(r.code, 'DAY_ALREADY_LOGGED');
});

test('weekly mode allows several posts in one week', () => {
  const goal = G({ mode: 'weekly', start_date: '2026-11-02' });
  const first = post('2026-11-10T08:00:00Z', goal);
  const pub = utc('2026-11-10T18:00:00Z');
  const r = checkNewPost({ goal, versions: [V()], posts: [first], activityId: idFor(pub), publishedAt: pub, now: pub + H });
  assert.equal(r.ok, true);
  assert.equal(r.unitKey, '2026-11-09');
});

test('end date reached: goal is completed and no further units exist', () => {
  const goal = G({ start_date: '2026-11-06', end_date: '2026-11-15' });
  const s = summarise({ goal, versions: [V()], posts: [], now: utc('2026-11-25T12:00:00Z') });
  assert.equal(s.ended, true);
  assert.equal(s.status, 'completed');
  assert.ok(s.units.every((u) => u.key <= '2026-11-15'));
  assert.equal(s.units.length, 6);
  const r = checkNewPost({ goal, versions: [V()], activityId: '1', publishedAt: utc('2026-11-20T09:00:00Z'), now: utc('2026-11-20T10:00:00Z') });
  assert.equal(r.code, 'NOT_REQUIRED_DAY');
});

test('no active goal -> NO_ACTIVE_GOAL', () => {
  assert.equal(checkNewPost({ goal: null, versions: [], activityId: '1', publishedAt: Date.now(), now: Date.now() }).code, 'NO_ACTIVE_GOAL');
});

test('New York user: day boundaries follow the goal timezone', () => {
  const tz = 'America/New_York';
  // Fri 23:30 EST = Sat 04:30Z -> counts for Friday in NY
  const pub = utc('2026-11-14T04:30:00Z');
  const r = checkNewPost({ goal: G(), versions: [V({ timezone: tz })], activityId: '1', publishedAt: pub, now: pub + H });
  assert.equal(r.unitKey, '2026-11-13');
});

test('week strip shows all seven days with required ones flagged', () => {
  const s = summarise({ goal: G(), versions: [V()], posts: [post('2026-11-13T09:00:00Z')], now: utc('2026-11-14T09:00:00Z') });
  const strip = weekStrip(s, G(), [V()], []);
  assert.equal(strip.length, 7);
  assert.deepEqual(strip.filter((d) => d.required).map((d) => [d.date, d.state]), [['2026-11-13', 'complete'], ['2026-11-14', 'open'], ['2026-11-15', 'upcoming']]);
  assert.equal(strip.find((d) => d.isToday).date, '2026-11-14');
});
