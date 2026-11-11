// POST { url, note? } -> verify a LinkedIn post and save it.
// The server is the source of truth: only this route inserts into `posts`.
import { admin, send, readJson, requireOwner, methodNotAllowed } from './_lib/supabase-admin.js';
import { parsePostUrl, decodeId, slugMatches, classifyEmbedHtml } from './_lib/linkedin.js';
import { checkNewPost, summarise } from './_lib/streak.js';

const UA = 'Mozilla/5.0 (compatible; LinkedStreak/2.0)';
const fail = (res, status, code, message) => send(res, status, { ok: false, code, message });

/** Follow lnkd.in redirects (max 5 hops, 4s total) and return the final LinkedIn URL. */
async function resolveShortLink(url) {
  const signal = AbortSignal.timeout(4000);
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    const r = await fetch(current, { redirect: 'manual', signal, headers: { 'User-Agent': UA } });
    const loc = r.headers.get('location');
    if (r.status >= 300 && r.status < 400 && loc) {
      current = new URL(loc, current).toString();
      if (!/^https?:\/\/(?:[a-z0-9-]+\.)?lnkd\.in\//i.test(current)) return current;
      continue;
    }
    // lnkd.in sometimes answers 200 with an interstitial page that carries the target.
    if (r.ok) {
      const html = await r.text();
      const m = html.match(/https?:\/\/(?:[a-z0-9-]+\.)?linkedin\.com\/(?:posts|feed\/update)\/[^"'<>\s]+/i);
      if (m) return m[0].replace(/&amp;/g, '&');
    }
    return null;
  }
  return null;
}

/** One best-effort public embed fetch. Returns 'verified' | 'other' | 'unconfirmed'. */
async function checkEmbedAuthor(urn, settings) {
  try {
    const r = await fetch(`https://www.linkedin.com/embed/feed/update/${urn}`, {
      signal: AbortSignal.timeout(4000),
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-GB,en;q=0.8' },
    });
    if (!r.ok) return 'unconfirmed';
    const html = await r.text();
    return classifyEmbedHtml(html, { slug: settings.profile_slug, displayName: settings.display_name });
  } catch {
    return 'unconfirmed';
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const user = await requireOwner(req, res);
  if (!user) return;

  const body = await readJson(req);
  const original = String(body.url || '').trim().slice(0, 2000);
  const note = body.note ? String(body.note).trim().slice(0, 280) : null;
  const now = Date.now();

  // 1. Parse (and resolve short links)
  let parsed = parsePostUrl(original);
  if (!parsed.ok) return fail(res, 422, parsed.code, parsed.message);
  if (parsed.kind === 'short') {
    let resolved = null;
    try {
      resolved = await resolveShortLink(parsed.canonical);
    } catch {
      resolved = null;
    }
    if (!resolved) return fail(res, 422, 'BAD_URL', "Couldn't open that short link. Use \"Copy link to post\" instead.");
    parsed = parsePostUrl(resolved);
    if (!parsed.ok) return fail(res, 422, parsed.code, parsed.message);
    if (parsed.kind === 'short') return fail(res, 422, 'BAD_URL', "That short link doesn't lead to a post.");
  }

  // 2. Decode publish time
  const decoded = decodeId(parsed.activityId, now);
  if (!decoded.ok) return fail(res, 422, decoded.code, decoded.message);

  // 3. Load settings + posts
  const db = admin();
  const [{ data: settings, error: sErr }, { data: posts, error: pErr }] = await Promise.all([
    db.from('settings').select('*').eq('user_id', user.id).maybeSingle(),
    db.from('posts').select('activity_id, published_at, required_day').eq('user_id', user.id),
  ]);
  if (sErr || pErr) return fail(res, 500, 'SERVER', 'Could not load your data. Try again.');
  if (!settings?.profile_slug) {
    return fail(res, 422, 'NO_PROFILE', 'Add your LinkedIn profile link in Settings first.');
  }

  // 4. Day rules (cheap, so before any network)
  const check = checkNewPost({
    activityId: parsed.activityId,
    publishedAt: decoded.publishedAt,
    now,
    startDate: settings.start_date,
    posts,
  });
  if (!check.ok) return fail(res, 409, check.code, check.message);

  // 5. Author
  let author;
  if (parsed.kind === 'posts') {
    if (!slugMatches(parsed, settings.profile_slug)) {
      return fail(res, 403, 'WRONG_AUTHOR', 'This post belongs to someone else.');
    }
    author = 'verified';
  } else {
    const verdict = await checkEmbedAuthor(parsed.urn, settings);
    if (verdict === 'other') return fail(res, 403, 'WRONG_AUTHOR', 'This post belongs to someone else.');
    author = verdict;
  }

  // 6. Save
  const row = {
    user_id: user.id,
    activity_id: parsed.activityId,
    url_original: original,
    url_canonical: parsed.canonical,
    published_at: new Date(decoded.publishedAt).toISOString(),
    required_day: check.day,
    author_status: author,
    note,
  };
  const { data: saved, error: iErr } = await db.from('posts').insert(row).select().single();
  if (iErr) {
    if (iErr.code === '23505') {
      const dup = /activity_id/.test(iErr.message || '') || /posts_activity_id_key/.test(iErr.details || '');
      return dup
        ? fail(res, 409, 'DUPLICATE', 'That post is already logged.')
        : fail(res, 409, 'DAY_ALREADY_LOGGED', 'That day is already logged. One post counts per day.');
    }
    return fail(res, 500, 'SERVER', 'Could not save the post. Try again.');
  }

  const after = summarise({ startDate: settings.start_date, now, posts: [...posts, saved] });
  return send(res, 200, {
    ok: true,
    day: check.day,
    publishedAt: row.published_at,
    author,
    streakAfter: after.current,
    post: saved,
  });
}
