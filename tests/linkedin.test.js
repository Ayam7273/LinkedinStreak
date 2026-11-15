import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePostUrl,
  decodeId,
  readPost,
  extractUrl,
  parseProfileUrl,
  slugMatches,
  classifyEmbedHtml,
  isAllowedRedirect,
} from '../js/core/linkedin.js';

const idFor = (ms) => String((BigInt(ms) << 22n) | 123456n);
const T = Date.parse('2026-11-13T08:42:00Z');
const ID = idFor(T);
const NOW = Date.parse('2026-11-14T09:00:00Z');

test('decodeId: top 41 bits are epoch ms', () => {
  assert.deepEqual(decodeId(ID, NOW), { ok: true, publishedAt: T });
  assert.equal(new Date(decodeId('7000000000000000000', NOW).publishedAt).getUTCFullYear(), 2022);
});

test('decodeId: pre-2015, future (beyond 5 min skew) and junk -> NO_TIMESTAMP', () => {
  assert.equal(decodeId(idFor(Date.parse('2014-06-01T00:00:00Z')), NOW).code, 'NO_TIMESTAMP');
  assert.equal(decodeId(idFor(NOW + 6 * 60000), NOW).code, 'NO_TIMESTAMP');
  assert.equal(decodeId(idFor(NOW + 4 * 60000), NOW).ok, true);
  assert.equal(decodeId('abc', NOW).code, 'NO_TIMESTAMP');
});

test('/posts/ links: tracking stripped, slug + id extracted', () => {
  const p = parsePostUrl(`https://www.linkedin.com/posts/jane-doe-123_some-words-activity-${ID}-AbCd?utm_source=share`);
  assert.equal(p.ok, true);
  assert.equal(p.kind, 'posts');
  assert.equal(p.slug, 'jane-doe-123');
  assert.equal(p.activityId, ID);
  assert.equal(p.urnType, 'activity');
  assert.equal(p.canonical, `https://www.linkedin.com/posts/jane-doe-123_some-words-activity-${ID}-AbCd`);
});

test('/posts/ variants: no www, m., trailing slash, ugcPost', () => {
  for (const u of [
    `linkedin.com/posts/Jane-Doe_x-activity-${ID}-zz/`,
    `https://m.linkedin.com/posts/jane-doe_x-activity-${ID}-zz`,
    `https://www.linkedin.com/posts/jane-doe_x-ugcPost-${ID}-zz/`,
  ]) {
    const p = parsePostUrl(u);
    assert.equal(p.ok, true, u);
    assert.equal(p.slug, 'jane-doe');
    assert.equal(p.activityId, ID);
  }
});

test('/feed/update/ URNs: activity, share, ugcPost, URL-encoded', () => {
  for (const t of ['activity', 'share', 'ugcPost']) {
    const p = parsePostUrl(`https://www.linkedin.com/feed/update/urn:li:${t}:${ID}/?x=1`);
    assert.equal(p.ok, true);
    assert.equal(p.urnType, t);
    assert.equal(p.slug, null);
    assert.equal(p.canonical, `https://www.linkedin.com/feed/update/urn:li:${t}:${ID}/`);
  }
  assert.equal(parsePostUrl(`https://www.linkedin.com/feed/update/urn%3Ali%3Aactivity%3A${ID}`).activityId, ID);
});

test('lnkd.in short links need server resolution', () => {
  const p = parsePostUrl('https://lnkd.in/eAbC123?x=1');
  assert.equal(p.kind, 'short');
  assert.equal(p.canonical, 'https://lnkd.in/eAbC123');
});

test('redirect guard only allows https LinkedIn hosts (SSRF)', () => {
  assert.ok(isAllowedRedirect('https://www.linkedin.com/posts/x'));
  assert.ok(isAllowedRedirect('https://lnkd.in/abc'));
  assert.ok(!isAllowedRedirect('http://www.linkedin.com/posts/x'));
  assert.ok(!isAllowedRedirect('https://evil.com/?linkedin.com'));
  assert.ok(!isAllowedRedirect('https://linkedin.com.evil.com/'));
  assert.ok(!isAllowedRedirect('https://169.254.169.254/latest/meta-data'));
  assert.ok(!isAllowedRedirect('not a url'));
});

test('specific rejection messages', () => {
  assert.match(parsePostUrl('https://www.linkedin.com/in/jane-doe/').message, /profile link/);
  assert.match(parsePostUrl('https://www.linkedin.com/company/acme').message, /page, not a post/);
  assert.match(parsePostUrl('https://www.linkedin.com/article/edit/123/').message, /editor/);
  assert.match(parsePostUrl('https://www.linkedin.com/pulse/foo').message, /article/);
  assert.match(parsePostUrl('https://example.com/posts/x').message, /not a LinkedIn link/);
  assert.equal(parsePostUrl('https://evil-linkedin.com/posts/x').code, 'BAD_URL');
  assert.equal(parsePostUrl('').code, 'BAD_URL');
});

test('extractUrl pulls a link out of shared text', () => {
  assert.equal(extractUrl(`See https://www.linkedin.com/posts/jane_x-activity-${ID}-zz. Thanks`), `https://www.linkedin.com/posts/jane_x-activity-${ID}-zz`);
});

test('readPost = parse + decode', () => {
  assert.equal(readPost(`https://www.linkedin.com/feed/update/urn:li:activity:${ID}`, NOW).publishedAt, T);
});

test('profile slugs', () => {
  assert.equal(parseProfileUrl('https://www.linkedin.com/in/Jane-Doe-123/'), 'jane-doe-123');
  assert.equal(parseProfileUrl('linkedin.com/in/jane-doe?trk=x'), 'jane-doe');
  assert.equal(parseProfileUrl('https://www.linkedin.com/company/acme'), null);
  assert.equal(parseProfileUrl('https://example.com/in/jane'), null);
});

test('slug matching and embed classification', () => {
  const p = parsePostUrl(`https://www.linkedin.com/posts/Jane-Doe_x-activity-${ID}-zz`);
  assert.equal(slugMatches(p, 'jane-doe'), true);
  assert.equal(slugMatches(p, 'john-smith'), false);
  const o = { slug: 'jane-doe', displayName: 'Jane Doe' };
  assert.equal(classifyEmbedHtml('<a href="https://www.linkedin.com/in/jane-doe">', o), 'verified');
  assert.equal(classifyEmbedHtml('<a href="https://www.linkedin.com/in/john-smith">', o), 'other');
  assert.equal(classifyEmbedHtml('<html>sign in</html>', o), 'unconfirmed');
});
