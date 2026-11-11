// Pure LinkedIn URL parsing and ID-to-timestamp decoding. No DOM, no network.

export const EPOCH_FLOOR = Date.UTC(2015, 0, 1);
export const CLOCK_SKEW_MS = 5 * 60 * 1000;

const fail = (code, message) => ({ ok: false, code, message });

/** Pull the first http(s) URL out of arbitrary text (share sheets add extra words). */
export function extractUrl(text) {
  if (!text) return '';
  const s = String(text).trim();
  const m = s.match(/https?:\/\/[^\s<>"']+/i);
  if (m) return m[0].replace(/[),.;!?]+$/, '');
  // Bare host without scheme, e.g. "linkedin.com/posts/..."
  const bare = s.match(/(?:^|\s)((?:[a-z0-9-]+\.)*(?:linkedin\.com|lnkd\.in)\/[^\s<>"']*)/i);
  return bare ? 'https://' + bare[1].replace(/[),.;!?]+$/, '') : s;
}

function isLinkedInHost(host) {
  return host === 'linkedin.com' || host.endsWith('.linkedin.com');
}

/**
 * Decode the publish instant from a LinkedIn activity/share/ugcPost ID.
 * The top 41 bits of the 64-bit ID are a Unix timestamp in milliseconds.
 */
export function decodeId(id, now = Date.now()) {
  if (!/^\d{15,20}$/.test(String(id))) {
    return fail('NO_TIMESTAMP', "Couldn't read a publish date from this link.");
  }
  const ms = Number(BigInt(id) >> 22n);
  if (!(ms > EPOCH_FLOOR) || ms > now + CLOCK_SKEW_MS) {
    return fail('NO_TIMESTAMP', "Couldn't read a publish date from this link.");
  }
  return { ok: true, publishedAt: ms };
}

/**
 * Parse and normalise a LinkedIn post URL.
 * Returns { ok:true, kind:'posts'|'urn'|'short', ... } or { ok:false, code, message }.
 */
export function parsePostUrl(input) {
  const raw = extractUrl(input);
  if (!raw) return fail('BAD_URL', 'Paste the link to your post.');

  let u;
  try {
    u = new URL(raw);
  } catch {
    return fail('BAD_URL', "That doesn't look like a link.");
  }
  if (!/^https?:$/.test(u.protocol)) return fail('BAD_URL', "That doesn't look like a link.");

  const host = u.hostname.toLowerCase();

  if (host === 'lnkd.in' || host === 'www.lnkd.in') {
    if (u.pathname.length < 2) return fail('BAD_URL', 'That short link is incomplete.');
    return {
      ok: true,
      kind: 'short',
      needsResolve: true,
      original: raw,
      canonical: `https://lnkd.in${u.pathname.replace(/\/+$/, '')}`,
    };
  }

  if (!isLinkedInHost(host)) return fail('BAD_URL', "That's not a LinkedIn link.");

  let path;
  try {
    path = decodeURIComponent(u.pathname);
  } catch {
    path = u.pathname;
  }
  path = path.replace(/\/+$/, '');

  // /posts/{slug}_{words}-activity-{ID}-{xxxx}
  const posts = /^\/posts\/([^/]+)$/i.exec(path);
  if (posts) {
    const tail = posts[1];
    const idMatch = /-(activity|ugcPost|share)-(\d{15,20})(?:-[^/]*)?$/i.exec(tail);
    if (!idMatch) return fail('BAD_URL', "Couldn't find a post ID in that link.");
    const us = tail.indexOf('_');
    const slug = us > 0 ? tail.slice(0, us).toLowerCase() : null;
    return {
      ok: true,
      kind: 'posts',
      original: raw,
      slug,
      urnType: normaliseType(idMatch[1]),
      activityId: idMatch[2],
      urn: `urn:li:${normaliseType(idMatch[1])}:${idMatch[2]}`,
      canonical: `https://www.linkedin.com${u.pathname.replace(/\/+$/, '')}`,
    };
  }

  // /feed/update/urn:li:{type}:{ID}  (also /embed/feed/update/...)
  const urn = /^(?:\/embed)?\/feed\/update\/urn:li:(activity|share|ugcPost):(\d{15,20})$/i.exec(path);
  if (urn) {
    const type = normaliseType(urn[1]);
    return {
      ok: true,
      kind: 'urn',
      original: raw,
      slug: null,
      urnType: type,
      activityId: urn[2],
      urn: `urn:li:${type}:${urn[2]}`,
      canonical: `https://www.linkedin.com/feed/update/urn:li:${type}:${urn[2]}/`,
    };
  }

  if (/^\/in\/[^/]+/i.test(path)) return fail('BAD_URL', "That's a LinkedIn profile link, not a post.");
  if (/^\/(company|school|showcase)\//i.test(path)) return fail('BAD_URL', "That's a LinkedIn page, not a post.");
  if (/^\/pulse\//i.test(path)) {
    return fail('BAD_URL', "That's an article link. Log the post that shared it instead.");
  }
  if (/^\/feed\/?$/i.test(path) || path === '') return fail('BAD_URL', "That's the LinkedIn feed, not a post.");
  if (/^\/feed\/update\//i.test(path)) return fail('BAD_URL', "Couldn't find a post ID in that link.");
  return fail('BAD_URL', "That LinkedIn link isn't a post.");
}

function normaliseType(t) {
  const l = t.toLowerCase();
  if (l === 'ugcpost') return 'ugcPost';
  return l;
}

/** Parse + decode in one step (for anything except unresolved short links). */
export function readPost(input, now = Date.now()) {
  const p = parsePostUrl(input);
  if (!p.ok || p.kind === 'short') return p;
  const t = decodeId(p.activityId, now);
  if (!t.ok) return t;
  return { ...p, publishedAt: t.publishedAt };
}

/** Extract a vanity slug from a profile URL (or a bare slug). Returns lowercased slug or null. */
export function parseProfileUrl(input) {
  if (!input) return null;
  const s = String(input).trim();
  let slug = null;
  if (/^[\p{L}\p{N}-]{3,100}$/u.test(s)) {
    slug = s;
  } else {
    let u;
    try {
      u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s);
    } catch {
      return null;
    }
    if (!isLinkedInHost(u.hostname.toLowerCase())) return null;
    let path;
    try {
      path = decodeURIComponent(u.pathname);
    } catch {
      path = u.pathname;
    }
    const m = /^\/in\/([^/]+)\/?/i.exec(path);
    if (!m) return null;
    slug = m[1];
  }
  slug = slug.toLowerCase();
  return /^[\p{L}\p{N}-]{3,100}$/u.test(slug) ? slug : null;
}

/** Does the parsed /posts/ URL belong to `ownerSlug`? null when the URL carries no author. */
export function slugMatches(parsed, ownerSlug) {
  if (!parsed || !parsed.slug) return null;
  if (!ownerSlug) return null;
  return parsed.slug.toLowerCase() === String(ownerSlug).toLowerCase();
}

/**
 * Classify the public embed HTML for a /feed/update/ post.
 * 'verified'    — our slug or display name appears
 * 'other'       — the author link clearly points at someone else
 * 'unconfirmed' — inconclusive
 */
export function classifyEmbedHtml(html, { slug, displayName } = {}) {
  if (!html || typeof html !== 'string') return 'unconfirmed';
  const lower = html.toLowerCase();
  if (slug && new RegExp(`/in/${escapeRe(slug.toLowerCase())}(?![\\p{L}\\p{N}-])`, 'u').test(lower)) return 'verified';
  if (displayName && displayName.trim().length >= 3 && lower.includes(displayName.trim().toLowerCase())) {
    return 'verified';
  }
  const first = /linkedin\.com\/in\/([\p{L}\p{N}%-]+)/iu.exec(html);
  if (first && slug) return 'other';
  return 'unconfirmed';
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
