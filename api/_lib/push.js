// Web Push sending. SERVER ONLY.
import webpush from 'web-push';
import { admin } from './supabase-admin.js';

let configured = false;

function configure() {
  if (configured) return;
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
    throw new Error('VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT must be set');
  }
  webpush.setVapidDetails(vapidSubject(VAPID_SUBJECT), VAPID_PUBLIC_KEY.trim(), VAPID_PRIVATE_KEY.trim());
  configured = true;
}

/** web-push needs "mailto:you@example.com" or an https URL. Accept a bare email too. */
export function vapidSubject(raw) {
  const s = String(raw).trim();
  if (/^(mailto:|https:\/\/)/i.test(s)) return s;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return `mailto:${s}`;
  return s; // let web-push report anything else
}

/**
 * Send one payload to every subscription the user has.
 * 404/410 -> subscription deleted. Other errors -> failure_count + 1; deleted after 10.
 */
export async function sendToUser(userId, payload, preloaded = null) {
  configure();
  const db = admin();
  let subs = preloaded;
  if (!subs) {
    const { data, error } = await db.from('push_subscriptions').select('*').eq('user_id', userId);
    if (error) throw error;
    subs = data;
  }

  const result = { sent: 0, removed: 0, failed: 0, total: subs.length };
  const body = JSON.stringify(payload);

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
          { TTL: 60 * 60 * 6, urgency: 'high', topic: (payload.tag || 'streak').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) },
        );
        result.sent += 1;
        await db
          .from('push_subscriptions')
          .update({ last_success_at: new Date().toISOString(), failure_count: 0 })
          .eq('id', s.id);
      } catch (err) {
        const code = err?.statusCode;
        if (code === 404 || code === 410) {
          result.removed += 1;
          await db.from('push_subscriptions').delete().eq('id', s.id);
        } else {
          result.failed += 1;
          const failures = (s.failure_count || 0) + 1;
          if (failures >= 10) {
            result.removed += 1;
            await db.from('push_subscriptions').delete().eq('id', s.id);
          } else {
            await db.from('push_subscriptions').update({ failure_count: failures }).eq('id', s.id);
          }
        }
      }
    }),
  );
  return result;
}
