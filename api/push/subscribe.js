// POST { subscription } -> save (upsert by endpoint)
// DELETE { endpoint }   -> remove
import { admin, send, readJson, requireOwner, methodNotAllowed } from '../_lib/supabase-admin.js';

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'DELETE') return methodNotAllowed(res, ['POST', 'DELETE']);
  const user = await requireOwner(req, res);
  if (!user) return;
  const body = await readJson(req);
  const db = admin();

  if (req.method === 'DELETE') {
    const endpoint = String(body.endpoint || '');
    if (!endpoint) return send(res, 400, { ok: false, code: 'BAD_REQUEST', message: 'Missing endpoint.' });
    const { error } = await db.from('push_subscriptions').delete().eq('user_id', user.id).eq('endpoint', endpoint);
    if (error) return send(res, 500, { ok: false, code: 'SERVER', message: 'Could not remove the subscription.' });
    return send(res, 200, { ok: true });
  }

  const sub = body.subscription || {};
  const endpoint = String(sub.endpoint || '');
  const p256dh = sub.keys?.p256dh;
  const auth = sub.keys?.auth;
  if (!/^https:\/\//.test(endpoint) || !p256dh || !auth) {
    return send(res, 400, { ok: false, code: 'BAD_REQUEST', message: 'That subscription is incomplete.' });
  }

  const { error } = await db.from('push_subscriptions').upsert(
    {
      user_id: user.id,
      endpoint,
      p256dh,
      auth,
      user_agent: String(req.headers['user-agent'] || '').slice(0, 300),
      failure_count: 0,
    },
    { onConflict: 'endpoint' },
  );
  if (error) return send(res, 500, { ok: false, code: 'SERVER', message: 'Could not save the subscription.' });
  return send(res, 200, { ok: true });
}
