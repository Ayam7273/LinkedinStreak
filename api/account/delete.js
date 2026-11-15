// POST { confirm: 'delete my account' } -> delete every row and the auth user.
import { admin, send, fail, readJson, methodNotAllowed } from '../_lib/supabase-admin.js';
import { requireUser } from '../_lib/auth.js';
import { rateLimit } from '../_lib/rate-limit.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const user = await requireUser(req, res);
  if (!user) return;
  if (!(await rateLimit(res, [{ key: `delete:user:${user.id}`, max: 5, windowSeconds: 3600 }]))) return;

  const body = await readJson(req);
  if (String(body.confirm || '').trim().toLowerCase() !== 'delete my account') {
    return fail(res, 422, 'CONFIRM', 'Type "delete my account" to confirm.');
  }

  const db = admin();
  try {
    // Explicit deletes first (push endpoints go with them), then the auth user.
    // Everything also cascades from auth.users, so a partial failure can't leave orphans.
    await db.from('push_subscriptions').delete().eq('user_id', user.id);
    await db.from('notification_log').delete().eq('user_id', user.id);
    await db.from('posts').delete().eq('user_id', user.id);
    await db.from('goals').delete().eq('user_id', user.id); // versions + pauses cascade
    await db.from('profiles').delete().eq('id', user.id);
    const { error } = await db.auth.admin.deleteUser(user.id);
    if (error) throw error;
    return send(res, 200, { ok: true });
  } catch {
    return fail(res, 500, 'SERVER', 'Could not delete your account. Please try again or contact us.');
  }
}
