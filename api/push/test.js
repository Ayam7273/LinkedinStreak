// POST -> send a test notification to every device I've subscribed.
import { admin, send, methodNotAllowed } from '../_lib/supabase-admin.js';
import { requireUser } from '../_lib/auth.js';
import { rateLimit } from '../_lib/rate-limit.js';
import { sendToUser } from '../_lib/push.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const user = await requireUser(req, res);
  if (!user) return;
  if (!(await rateLimit(res, [{ key: `pushtest:user:${user.id}`, max: 10, windowSeconds: 3600 }]))) return;

  const now = new Date();
  try {
    const result = await sendToUser(user.id, {
      title: 'LinkedInStreak',
      body: 'Test notification. Reminders will arrive like this.',
      tag: 'test',
      url: '/app.html#/settings',
    });
    await admin()
      .from('notification_log')
      .insert({ user_id: user.id, goal_id: null, kind: 'test', unit_key: now.toISOString().slice(0, 10), slot: now.toISOString() });

    if (result.total === 0) {
      return send(res, 409, { ok: false, code: 'NO_DEVICES', message: 'No devices are subscribed. Turn notifications on first.' });
    }
    if (result.sent === 0) {
      return send(res, 502, { ok: false, code: 'PUSH_FAILED', message: 'The push service refused every device.', ...result });
    }
    return send(res, 200, { ok: true, ...result });
  } catch (err) {
    return send(res, 500, { ok: false, code: 'SERVER', message: err?.message?.includes('VAPID') ? 'VAPID keys are not set on the server.' : 'Could not send the test.' });
  }
}
