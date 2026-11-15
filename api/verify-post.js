// POST { url, note? } -> verify a LinkedIn post against the user's active goal and save it.
// The server is the source of truth: only this route inserts into `posts`.
import { admin, send, fail, readJson, methodNotAllowed } from './_lib/supabase-admin.js';
import { requireUser } from './_lib/auth.js';
import { rateLimit, ipKey } from './_lib/rate-limit.js';
import { parsePostUrl, decodeId, slugMatches, classifyEmbedHtml, isAllowedRedirect } from '../js/core/linkedin.js';
import { checkNewPost } from '../js/core/streak.js';

const UA = 'Mozilla/5.0 (compatible; LinkedInStreak/3.0; +https://linkedin-streak.vercel.app)';
const EMBED_TTL_MS = 24 * 3600 * 1000;

/** Follow lnkd.in redirects: max 5 hops, 4s total, and ONLY to https *.linkedin.com / lnkd.in (no SSRF). */
async function resolveShortLink(url) {
  const signal = AbortSignal.timeout(4000);
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    if (!isAllowedRedirect(current)) return null;
    const r = await fetch(current, { redirect: 'manual', signal, headers: { 'User-Agent': UA } });
    const loc = r.headers.get('location');
    if (r.status >= 300 && r.status < 400 && loc) {
      current = new URL(loc, current).toString();
      if (!isAllowedRedirect(current)) return null;
      if (!/^https:\/\/(www\.)?lnkd\.in\//i.test(current)) return current;
      continue;
    }
    if (r.ok) {
      // lnkd.in sometimes answers 200 with an interstitial that carries the target.
      const html = (await r.text()).slice(0, 200000);
      const m = html.match(/https:\/\/(?:[a-z0-9-]+\.)?linkedin\.com\/(?:posts|feed\/update)\/[^"'<>\s]+/i);
      return m ? m[0].replace(/&amp;/g, '&') : null;
    }
    return null;
  }
  return null;
}

/** One best-effort public embed fetch, cached per URN for 24h. */
async function embedVerdict(urn, profile) {
  const db = admin();
  const { data: cached } = await db.from('embed_cache').select('*').eq('urn', urn).maybeSingle();
  let ok = false;
  let body = null;
  if (cached && Date.now() - Date.parse(cached.fetched_at) < EMBED_TTL_MS) {
    ok = cached.ok;
    body = cached.body;
  } else {
    try {
      const r = await fetch(`https://www.linkedin.com/embed/feed/update/${encodeURIComponent(urn).replace(/%3A/gi, ':')}`, {
        signal: AbortSignal.timeout(4000),
        headers: { 'User-Agent': UA, 'Accept-Language': 'en-GB,en;q=0.8' },
        redirect: 'manual',
      });
      ok = r.ok;
      body = r.ok ? (await r.text()).slice(0, 100000) : null;
    } catch {
      ok = false;
    }
    await db.from('embed_cache').upsert({ urn, ok, body, fetched_at: new Date().toISOString() });
  }
  if (!ok || !body) return 'unconfirmed';
  return classifyEmbedHtml(body, { slug: profile.linkedin_slug, displayName: profile.display_name });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const user = await requireUser(req, res);
  if (!user) return;

  const allowed = await rateLimit(
    res,
    [
      { key: `verify:user:${user.id}`, max: 20, windowSeconds: 3600 },
      { key: ipKey('verify', req), max: 60, windowSeconds: 3600 },
    ],
    "That's a lot of checks in a short time. Please wait up to an hour and try again.",
  );
  if (!allowed) return;

  const body = await readJson(req);
  const original = String(body.url || '').trim().slice(0, 2000);
  const note = body.note ? String(body.note).trim().slice(0, 280) || null : null;
  const now = Date.now();
  const db = admin();

  // 0. Profile must have a LinkedIn URL.
  const { data: profile } = await db.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (!profile?.linkedin_slug) {
    return fail(res, 422, 'NO_PROFILE', 'Add your LinkedIn profile link in Settings before logging posts.');
  }

  // 1. Parse (and safely resolve short links).
  let parsed = parsePostUrl(original);
  if (!parsed.ok) return fail(res, 422, parsed.code, parsed.message);
  if (parsed.kind === 'short') {
    let resolved = null;
    try {
      resolved = await resolveShortLink(parsed.canonical);
    } catch {
      resolved = null;
    }
    if (!resolved) return fail(res, 422, 'BAD_URL', "Couldn't open that short link. In LinkedIn, use \"Copy link to post\" instead.");
    parsed = parsePostUrl(resolved);
    if (!parsed.ok) return fail(res, 422, parsed.code, parsed.message);
    if (parsed.kind === 'short') return fail(res, 422, 'BAD_URL', "That short link doesn't lead to a post.");
  }

  // 2. Decode publish time.
  const decoded = decodeId(parsed.activityId, now);
  if (!decoded.ok) return fail(res, 422, decoded.code, decoded.message);

  // 3. Author (slug check is free; embed fetch happens after the cheap rules).
  if (parsed.kind === 'posts' && !slugMatches(parsed, profile.linkedin_slug)) {
    return fail(res, 403, 'WRONG_AUTHOR', 'This post belongs to someone else.');
  }

  // 4. Goal rules.
  const { data: goal } = await db.from('goals').select('*').eq('user_id', user.id).eq('status', 'active').maybeSingle();
  if (!goal) return fail(res, 409, 'NO_ACTIVE_GOAL', 'You have no active goal. Create or resume one first.');
  const [{ data: versions }, { data: pauses }, { data: posts }, { data: taken }] = await Promise.all([
    db.from('goal_versions').select('*').eq('goal_id', goal.id),
    db.from('goal_pauses').select('*').eq('goal_id', goal.id),
    db.from('posts').select('activity_id, goal_id, published_at, logged_at, unit_key').eq('user_id', user.id),
    db.from('posts').select('activity_id').eq('activity_id', parsed.activityId).neq('user_id', user.id),
  ]);
  const weekStart = profile.week_start || 'mon';
  const check = checkNewPost({
    goal,
    versions: versions || [],
    pauses: pauses || [],
    posts: posts || [],
    takenActivityIds: (taken || []).map((t) => t.activity_id),
    activityId: parsed.activityId,
    publishedAt: decoded.publishedAt,
    now,
    weekStart,
  });
  if (!check.ok) return fail(res, 409, check.code, check.message);

  let author = 'verified';
  if (parsed.kind === 'urn') {
    const verdict = await embedVerdict(parsed.urn, profile);
    if (verdict === 'other') return fail(res, 403, 'WRONG_AUTHOR', 'This post belongs to someone else.');
    author = verdict;
  }

  // 5. Save.
  const row = {
    user_id: user.id,
    goal_id: goal.id,
    activity_id: parsed.activityId,
    urn_type: parsed.urnType,
    url_original: original,
    url_canonical: parsed.canonical,
    published_at: new Date(decoded.publishedAt).toISOString(),
    unit_key: check.unitKey,
    unit_kind: goal.mode === 'weekly' ? 'week' : 'day',
    author_status: author,
    note,
  };
  const { data: saved, error } = await db.from('posts').insert(row).select().single();
  if (error) {
    if (error.code === '23505') {
      return /activity_id/.test(`${error.message} ${error.details}`)
        ? fail(res, 409, 'DUPLICATE', 'That post has already been logged.')
        : fail(res, 409, 'DAY_ALREADY_LOGGED', 'That day is already logged. One post counts per day.');
    }
    return fail(res, 500, 'SERVER', 'Could not save the post. Please try again.');
  }

  return send(res, 200, {
    ok: true,
    unit: check.unitKey,
    publishedAt: row.published_at,
    author,
    streak: { current: check.streakAfter, unit: check.unit },
    post: saved,
  });
}
