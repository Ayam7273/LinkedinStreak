// GET /api/cron/reminders?secret=...   (or Authorization: Bearer <CRON_SECRET>, which Vercel Cron sends)
// For every active goal with reminders on: ask the pure decideReminders() what's due right now
// in that goal's timezone, claim each slot in notification_log (insert-on-conflict-do-nothing),
// then send only what was claimed. Users are processed in batches of 200.
import { timingSafeEqual } from 'node:crypto';
import { admin, send } from '../_lib/supabase-admin.js';
import { sendToUser } from '../_lib/push.js';
import { decideReminders, sentKey } from '../../js/core/reminders.js';
import { summarise } from '../../js/core/streak.js';

const BATCH = 200;

function authorised(req) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.authorization || '';
  const fromHeader = header.startsWith('Bearer ') ? header.slice(7) : req.headers['x-cron-secret'];
  const given = String(fromHeader || new URL(req.url, 'http://x').searchParams.get('secret') || '');
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const groupBy = (rows, key) => {
  const m = new Map();
  for (const r of rows || []) {
    if (!m.has(r[key])) m.set(r[key], []);
    m.get(r[key]).push(r);
  }
  return m;
};

export default async function handler(req, res) {
  if (!authorised(req)) return send(res, 401, { ok: false, code: 'UNAUTHORISED' });

  const db = admin();
  const now = Date.now();
  const report = { goals: 0, sent: 0, skipped: 0, completed: 0, errors: 0 };

  for (let offset = 0; ; offset += BATCH) {
    // One page of active goals (one active goal per user, so this is also a page of users).
    const { data: goals, error } = await db
      .from('goals')
      .select('*')
      .eq('status', 'active')
      .order('id')
      .range(offset, offset + BATCH - 1);
    if (error) return send(res, 500, { ok: false, message: error.message });
    if (!goals.length) break;

    const goalIds = goals.map((g) => g.id);
    const userIds = goals.map((g) => g.user_id);
    const since = new Date(now - 10 * 86400000).toISOString();
    const [{ data: versions }, { data: pauses }, { data: posts }, { data: profiles }, { data: subs }, { data: logs }] = await Promise.all([
      db.from('goal_versions').select('*').in('goal_id', goalIds),
      db.from('goal_pauses').select('*').in('goal_id', goalIds),
      db.from('posts').select('activity_id, goal_id, published_at, logged_at, unit_key').in('goal_id', goalIds),
      db.from('profiles').select('id, week_start').in('id', userIds),
      db.from('push_subscriptions').select('*').in('user_id', userIds),
      db.from('notification_log').select('goal_id, kind, unit_key, slot').in('goal_id', goalIds).gte('sent_at', since),
    ]);
    const V = groupBy(versions, 'goal_id');
    const P = groupBy(pauses, 'goal_id');
    const Po = groupBy(posts, 'goal_id');
    const S = groupBy(subs, 'user_id');
    const L = groupBy(logs, 'goal_id');
    const weekStartOf = new Map((profiles || []).map((p) => [p.id, p.week_start || 'mon']));

    for (const goal of goals) {
      report.goals += 1;
      try {
        const args = {
          goal,
          versions: V.get(goal.id) || [],
          pauses: P.get(goal.id) || [],
          posts: Po.get(goal.id) || [],
          weekStart: weekStartOf.get(goal.user_id) || 'mon',
          now,
        };
        if (!args.versions.length) continue;

        // End date passed: mark completed, send nothing.
        if (summarise(args).ended) {
          await db.from('goals').update({ status: 'completed' }).eq('id', goal.id);
          report.completed += 1;
          continue;
        }

        const userSubs = S.get(goal.user_id) || [];
        if (!userSubs.length) continue;

        const sent = new Set((L.get(goal.id) || []).map((l) => sentKey(l.kind, l.unit_key, l.slot)));
        for (const n of decideReminders({ ...args, sent })) {
          const { data: claimed, error: cErr } = await db
            .from('notification_log')
            .upsert(
              { user_id: goal.user_id, goal_id: goal.id, kind: n.kind, unit_key: n.unitKey, slot: n.slot },
              { onConflict: 'user_id,goal_id,kind,unit_key,slot', ignoreDuplicates: true },
            )
            .select('id');
          if (cErr || !claimed?.length) {
            report.skipped += 1;
            continue;
          }
          const r = await sendToUser(goal.user_id, { title: n.title, body: n.body, tag: n.tag, url: n.url }, userSubs);
          report.sent += r.sent;
        }
      } catch {
        report.errors += 1;
      }
    }
    if (goals.length < BATCH) break;
  }

  return send(res, 200, { ok: true, at: new Date(now).toISOString(), ...report });
}
