// GET -> a JSON download of everything we hold about the signed-in user.
import { admin, fail, methodNotAllowed } from '../_lib/supabase-admin.js';
import { requireUser } from '../_lib/auth.js';
import { rateLimit } from '../_lib/rate-limit.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  const user = await requireUser(req, res);
  if (!user) return;
  if (!(await rateLimit(res, [{ key: `export:user:${user.id}`, max: 10, windowSeconds: 3600 }]))) return;

  const db = admin();
  const { data: goals, error } = await db.from('goals').select('*').eq('user_id', user.id);
  if (error) return fail(res, 500, 'SERVER', 'Could not export your data.');
  const ids = goals.map((g) => g.id);
  const none = ['00000000-0000-0000-0000-000000000000'];
  const [profile, versions, pauses, posts, subs, notifications] = await Promise.all([
    db.from('profiles').select('*').eq('id', user.id).maybeSingle(),
    db.from('goal_versions').select('*').in('goal_id', ids.length ? ids : none),
    db.from('goal_pauses').select('*').in('goal_id', ids.length ? ids : none),
    db.from('posts').select('*').eq('user_id', user.id).order('published_at'),
    db.from('push_subscriptions').select('id, user_agent, created_at, last_success_at, failure_count').eq('user_id', user.id),
    db.from('notification_log').select('*').eq('user_id', user.id).order('sent_at'),
  ]);

  const body = {
    exported_at: new Date().toISOString(),
    account: { id: user.id, email: user.email, created_at: user.created_at, providers: user.app_metadata?.providers || [] },
    profile: profile.data,
    goals,
    goal_versions: versions.data,
    goal_pauses: pauses.data,
    posts: posts.data,
    push_subscriptions: subs.data,
    notification_log: notifications.data,
  };
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Disposition', `attachment; filename="LinkedInStreak-export-${new Date().toISOString().slice(0, 10)}.json"`);
  res.end(JSON.stringify(body, null, 2));
}
