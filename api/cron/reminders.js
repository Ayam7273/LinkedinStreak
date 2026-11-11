// GET /api/cron/reminders?secret=...  (or Authorization: Bearer <CRON_SECRET>, which Vercel Cron sends)
// Decides which reminders are due right now (pure function), claims each slot in
// notification_log with insert-on-conflict-do-nothing, then sends only what it claimed.
import { timingSafeEqual } from 'node:crypto';
import { admin, send } from '../_lib/supabase-admin.js';
import { sendToUser } from '../_lib/push.js';
import { decideReminders, sentKey } from '../_lib/reminders.js';
import { londonDate, addDays } from '../_lib/streak.js';

function authorised(req) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.authorization || '';
  const fromHeader = header.startsWith('Bearer ') ? header.slice(7) : req.headers['x-cron-secret'];
  const url = new URL(req.url, 'http://localhost');
  const given = String(fromHeader || url.searchParams.get('secret') || '');
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (!authorised(req)) return send(res, 401, { ok: false, code: 'UNAUTHORISED' });

  const db = admin();
  const now = Date.now();
  const today = londonDate(now);
  const yesterday = addDays(today, -1);

  let q = db.from('settings').select('*');
  if (process.env.OWNER_USER_ID) q = q.eq('user_id', process.env.OWNER_USER_ID);
  const { data: allSettings, error } = await q;
  if (error) return send(res, 500, { ok: false, code: 'SERVER', message: error.message });

  const report = [];
  for (const settings of allSettings) {
    const userId = settings.user_id;
    const [{ data: posts }, { data: logged }] = await Promise.all([
      db.from('posts').select('activity_id, published_at, required_day').eq('user_id', userId),
      db.from('notification_log').select('kind, for_day, slot').eq('user_id', userId).in('for_day', [today, yesterday]),
    ]);
    const sent = new Set((logged || []).map((r) => sentKey(r.kind, r.for_day, r.slot)));
    const due = decideReminders({ now, settings, posts: posts || [], sent });

    for (const n of due) {
      // Claim the slot first. If the row already exists, another run got here first.
      const { data: claimed, error: cErr } = await db
        .from('notification_log')
        .upsert(
          { user_id: userId, kind: n.kind, for_day: n.forDay, slot: n.slot },
          { onConflict: 'user_id,kind,for_day,slot', ignoreDuplicates: true },
        )
        .select('id');
      if (cErr || !claimed?.length) {
        report.push({ kind: n.kind, forDay: n.forDay, slot: n.slot, skipped: 'already-sent' });
        continue;
      }
      const result = await sendToUser(userId, { title: n.title, body: n.body, tag: n.tag, url: n.url });
      report.push({ kind: n.kind, forDay: n.forDay, slot: n.slot, ...result });
    }
  }

  return send(res, 200, { ok: true, at: new Date(now).toISOString(), london: today, sent: report });
}
