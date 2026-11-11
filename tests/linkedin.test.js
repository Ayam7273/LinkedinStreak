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
} from '../js/linkedin.js';

const idFor = (ms) => String((BigInt(ms) << 22n) | 123456n);
const T = Date.parse('2026-11-13T08:42:00Z');
const ID = idFor(T);
const NOW = Date.parse('2026-11-14T09:00:00Z');

test('decodeId reads the top 41 bits as ms', () => {
  const r = decodeId(ID, NOW);
  assert.equal(r.ok, true);
  assert.equal(r.publishedAt, T);
});

test('decodeId: a known real-world ID decodes to a sane date', () => {
  // 7000000000000000000 >> 22 = 1668954... ms (Nov 2022)
  const r = decodeId('7000000000000000000', NOW);
  assert.equal(r.ok, true);
  assert.equal(new Date(r.publishedAt).getUTCFullYear(), 2022);
});

test('decodeId rejects pre-2015, future and junk', () => {
  assert.equal(decodeId(idFor(Date.parse('2014-06-01T00:00:00Z')), NOW).code, 'NO_TIMESTAMP');
  assert.equal(decodeId(idFor(NOW + 10 * 60000), NOW).code, 'NO_TIMESTAMP');
  assert.equal(decodeId(idFor(NOW + 4 * 60000), NOW).ok, true); // within skew
  assert.equal(decodeId('abc', NOW).code, 'NO_TIMESTAMP');
});

test('/posts/ URL with tracking params', () => {
  const url = `https://www.linkedin.com/posts/jane-doe-123_some-words-here-activity-${ID}-AbCd?utm_source=share&utm_medium=member_desktop`;
  const p = parsePostUrl(url);
  assert.equal(p.ok, true);
  assert.equal(p.kind, 'posts');
  assert.equal(p.slug, 'jane-doe-123');
  assert.equal(p.activityId, ID);
  assert.equal(p.urnType, 'activity');
  assert.equal(p.canonical, `https://www.linkedin.com/posts/jane-doe-123_some-words-here-activity-${ID}-AbCd`);
});

test('/posts/ variants: no www, m., trailing slash, ugcPost, mixed case slug', () => {
  for (const u of [
    `linkedin.com/posts/Jane-Doe_x-activity-${ID}-zz/`,
    `https://m.linkedin.com/posts/jane-doe_x-activity-${ID}-zz`,
    `https://uk.linkedin.com/posts/jane-doe_x-ugcPost-${ID}-zz/`,
  ]) {
    const p = parsePostUrl(u);
    assert.equal(p.ok, true, u);
    assert.equal(p.slug, 'jane-doe');
    assert.equal(p.activityId, ID);
  }
});

test('/feed/update/ URNs', () => {
  for (const [type, want] of [
    ['activity', 'activity'],
    ['share', 'share'],
    ['ugcPost', 'ugcPost'],
  ]) {
    const p = parsePostUrl(`https://www.linkedin.com/feed/update/urn:li:${type}:${ID}/?utm=x`);
    assert.equal(p.ok, true);
    assert.equal(p.kind, 'urn');
    assert.equal(p.slug, null);
    assert.equal(p.urnType, want);
    assert.equal(p.canonical, `https://www.linkedin.com/feed/update/urn:li:${want}:${ID}/`);
  }
  const enc = parsePostUrl(`https://www.linkedin.com/feed/update/urn%3Ali%3Aactivity%3A${ID}`);
  assert.equal(enc.ok, true);
  assert.equal(enc.activityId, ID);
});

test('lnkd.in short links need server resolution', () => {
  const p = parsePostUrl('https://lnkd.in/eAbC123?x=1');
  assert.equal(p.ok, true);
  assert.equal(p.kind, 'short');
  assert.equal(p.needsResolve, true);
  assert.equal(p.canonical, 'https://lnkd.in/eAbC123');
});

test('specific rejections', () => {
  assert.match(parsePostUrl('https://www.linkedin.com/in/jane-doe/').message, /profile link, not a post/);
  assert.match(parsePostUrl('https://example.com/posts/x').message, /not a LinkedIn link/);
  assert.match(parsePostUrl('https://www.linkedin.com/company/acme').message, /page, not a post/);
  assert.match(parsePostUrl('https://www.linkedin.com/pulse/foo-bar').message, /article/);
  assert.match(parsePostUrl('https://www.linkedin.com/feed/').message, /feed/);
  assert.match(parsePostUrl('not a url at all').message, /doesn't look like a link/);
  assert.equal(parsePostUrl('').code, 'BAD_URL');
  assert.equal(parsePostUrl('https://www.linkedin.com/posts/jane_no-id-here').code, 'BAD_URL');
  assert.equal(parsePostUrl('https://evil-linkedin.com/posts/x').code, 'BAD_URL');
});

test('extractUrl pulls a link out of share text', () => {
  const text = `Check out my post https://www.linkedin.com/posts/jane_x-activity-${ID}-zz. Thanks`;
  assert.equal(extractUrl(text), `https://www.linkedin.com/posts/jane_x-activity-${ID}-zz`);
});

test('readPost combines parse and decode', () => {
  const r = readPost(`https://www.linkedin.com/feed/update/urn:li:activity:${ID}`, NOW);
  assert.equal(r.ok, true);
  assert.equal(r.publishedAt, T);
});

test('parseProfileUrl', () => {
  assert.equal(parseProfileUrl('https://www.linkedin.com/in/Jane-Doe-123/'), 'jane-doe-123');
  assert.equal(parseProfileUrl('linkedin.com/in/jane-doe?trk=x'), 'jane-doe');
  assert.equal(parseProfileUrl('jane-doe'), 'jane-doe');
  assert.equal(parseProfileUrl('https://www.linkedin.com/company/acme'), null);
  assert.equal(parseProfileUrl('https://example.com/in/jane'), null);
});

test('slugMatches is case-insensitive and null for URN links', () => {
  const p = parsePostUrl(`https://www.linkedin.com/posts/Jane-Doe_x-activity-${ID}-zz`);
  assert.equal(slugMatches(p, 'jane-doe'), true);
  assert.equal(slugMatches(p, 'john-smith'), false);
  assert.equal(slugMatches(parsePostUrl(`https://www.linkedin.com/feed/update/urn:li:activity:${ID}`), 'jane-doe'), null);
});

test('classifyEmbedHtml', () => {
  const opts = { slug: 'jane-doe', displayName: 'Jane Doe' };
  assert.equal(classifyEmbedHtml('<a href="https://www.linkedin.com/in/jane-doe?trk=x">', opts), 'verified');
  assert.equal(classifyEmbedHtml('<span>Jane Doe</span>', opts), 'verified');
  assert.equal(classifyEmbedHtml('<a href="https://www.linkedin.com/in/john-smith">John</a>', opts), 'other');
  assert.equal(classifyEmbedHtml('<a href="https://www.linkedin.com/in/jane-doe-other">', { slug: 'jane-doe' }), 'other');
  assert.equal(classifyEmbedHtml('<html>sign in</html>', opts), 'unconfirmed');
  assert.equal(classifyEmbedHtml('', opts), 'unconfirmed');
});
