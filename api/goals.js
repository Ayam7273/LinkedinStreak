// Goal writes with server-side validation.
// POST   { action: 'create', goal: {...}, version: {...}, makeActive? }
// POST   { action: 'edit', id, goal: { name?, end_date?, start_date? }, version: {...} }
// POST   { action: 'pause' | 'resume' | 'activate', id }
// POST   { action: 'delete', id, confirmName }
// Edits never rewrite the past: a version change is stored with effective_from = today (user's zone).
import { admin, send, fail, readJson, methodNotAllowed } from './_lib/supabase-admin.js';
import { requireUser } from './_lib/auth.js';
import { rateLimit } from './_lib/rate-limit.js';
import { isValidTimeZone, isDate, isHm, dateIn, addDays } from '../js/core/time.js';

const GRACE = [0, 6, 12, 24];

function cleanGoal(input, { partial = false } = {}) {
  const g = {};
  if (!partial || input.name !== undefined) {
    const name = String(input.name ?? '').trim();
    if (!name || name.length > 60) throw new Error('Give the goal a name (up to 60 characters).');
    g.name = name;
  }
  if (!partial) {
    if (!['days', 'weekly'].includes(input.mode)) throw new Error('Choose specific days or a weekly target.');
    g.mode = input.mode;
  }
  if (!partial || input.start_date !== undefined) {
    if (!isDate(input.start_date)) throw new Error('Choose a valid start date.');
    g.start_date = input.start_date;
  }
  if (input.end_date !== undefined) {
    if (input.end_date !== null && !isDate(input.end_date)) throw new Error('Choose a valid end date.');
    g.end_date = input.end_date;
  }
  return g;
}

function cleanVersion(input, mode) {
  const v = {};
  const days = [...new Set((input.days_of_week || []).map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort();
  if (mode === 'days' && days.length === 0) throw new Error('Pick at least one day.');
  v.days_of_week = mode === 'days' ? days : [];
  const n = Number(input.weekly_target ?? 1);
  if (mode === 'weekly' && !(Number.isInteger(n) && n >= 1 && n <= 7)) throw new Error('Weekly target must be between 1 and 7.');
  v.weekly_target = mode === 'weekly' ? n : 1;
  const grace = Number(input.grace_hours ?? 12);
  if (!GRACE.includes(grace)) throw new Error('Grace period must be none, 6, 12 or 24 hours.');
  v.grace_hours = grace;
  if (!isValidTimeZone(input.timezone)) throw new Error("That timezone isn't recognised.");
  v.timezone = input.timezone;
  v.reminders_enabled = input.reminders_enabled !== false;
  const times = [...new Set((input.reminder_times || []).map(String))].sort();
  if (times.length > 4 || !times.every(isHm)) throw new Error('Use up to 4 reminder times in HH:MM.');
  if (v.reminders_enabled && times.length === 0) throw new Error('Add at least one reminder time, or turn reminders off.');
  v.reminder_times = times;
  v.grace_reminder = input.grace_reminder !== false;
  return v;
}

async function ownGoal(db, userId, id) {
  const { data } = await db.from('goals').select('*').eq('id', id).eq('user_id', userId).maybeSingle();
  return data;
}

async function profileToday(db, userId) {
  const { data } = await db.from('profiles').select('timezone').eq('id', userId).maybeSingle();
  const tz = isValidTimeZone(data?.timezone) ? data.timezone : 'UTC';
  return dateIn(Date.now(), tz);
}

/** Pause the user's current active goal (if any, and not `exceptId`). */
async function pauseActive(db, userId, today, exceptId = null) {
  const { data: active } = await db.from('goals').select('id').eq('user_id', userId).eq('status', 'active');
  for (const g of active || []) {
    if (g.id === exceptId) continue;
    await db.from('goals').update({ status: 'paused' }).eq('id', g.id);
    await db.from('goal_pauses').insert({ goal_id: g.id, from_date: today, to_date: null });
  }
}

/** Close an open pause. If it started today or later, remove it altogether. */
async function closePause(db, goalId, today) {
  const { data: open } = await db.from('goal_pauses').select('*').eq('goal_id', goalId).is('to_date', null);
  for (const p of open || []) {
    const to = addDays(today, -1);
    if (to < p.from_date) await db.from('goal_pauses').delete().eq('id', p.id);
    else await db.from('goal_pauses').update({ to_date: to }).eq('id', p.id);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const user = await requireUser(req, res);
  if (!user) return;
  if (!(await rateLimit(res, [{ key: `goals:user:${user.id}`, max: 120, windowSeconds: 3600 }]))) return;

  const body = await readJson(req);
  const db = admin();
  const today = await profileToday(db, user.id);

  try {
    switch (body.action) {
      case 'create': {
        const g = cleanGoal(body.goal || {});
        const v = cleanVersion(body.version || {}, g.mode);
        if (g.end_date && g.end_date < g.start_date) throw new Error('The end date must be after the start date.');
        const makeActive = body.makeActive !== false;
        if (makeActive) await pauseActive(db, user.id, today);
        const { data: goal, error } = await db
          .from('goals')
          .insert({ ...g, user_id: user.id, status: makeActive ? 'active' : 'paused' })
          .select()
          .single();
        if (error) throw error;
        const { error: vErr } = await db.from('goal_versions').insert({ ...v, goal_id: goal.id, effective_from: g.start_date < today ? g.start_date : today });
        if (vErr) {
          await db.from('goals').delete().eq('id', goal.id);
          throw vErr;
        }
        if (!makeActive) await db.from('goal_pauses').insert({ goal_id: goal.id, from_date: today, to_date: null });
        return send(res, 200, { ok: true, goal });
      }

      case 'edit': {
        const goal = await ownGoal(db, user.id, body.id);
        if (!goal) return fail(res, 404, 'NOT_FOUND', 'Goal not found.');
        const patch = cleanGoal(body.goal || {}, { partial: true });
        if (patch.start_date && goal.start_date <= today && patch.start_date !== goal.start_date) {
          throw new Error("A goal's start date can't change once it has started.");
        }
        const start = patch.start_date || goal.start_date;
        const end = patch.end_date !== undefined ? patch.end_date : goal.end_date;
        if (end && end < start) throw new Error('The end date must be after the start date.');
        if (end && end < today && goal.end_date !== end) throw new Error("The end date can't be in the past.");
        if (Object.keys(patch).length) {
          const { error } = await db.from('goals').update(patch).eq('id', goal.id);
          if (error) throw error;
        }
        if (body.version) {
          const v = cleanVersion(body.version, goal.mode);
          // Same-day edits update today's row; earlier days keep their versions.
          const effective = start > today ? start : today;
          const { error } = await db.from('goal_versions').upsert({ ...v, goal_id: goal.id, effective_from: effective }, { onConflict: 'goal_id,effective_from' });
          if (error) throw error;
          if (start > today) await db.from('goal_versions').delete().eq('goal_id', goal.id).lt('effective_from', start);
        }
        return send(res, 200, { ok: true });
      }

      case 'pause': {
        const goal = await ownGoal(db, user.id, body.id);
        if (!goal) return fail(res, 404, 'NOT_FOUND', 'Goal not found.');
        if (goal.status !== 'active') return fail(res, 409, 'STATE', 'Only an active goal can be paused.');
        await db.from('goals').update({ status: 'paused' }).eq('id', goal.id);
        await db.from('goal_pauses').insert({ goal_id: goal.id, from_date: today, to_date: null });
        return send(res, 200, { ok: true });
      }

      case 'resume':
      case 'activate': {
        const goal = await ownGoal(db, user.id, body.id);
        if (!goal) return fail(res, 404, 'NOT_FOUND', 'Goal not found.');
        if (goal.status === 'completed' || (goal.end_date && goal.end_date < today)) {
          return fail(res, 409, 'STATE', 'This goal has ended. Create a new one to keep going.');
        }
        if (goal.status === 'active') return send(res, 200, { ok: true });
        await pauseActive(db, user.id, today, goal.id);
        await closePause(db, goal.id, today);
        const { error } = await db.from('goals').update({ status: 'active' }).eq('id', goal.id);
        if (error) throw error;
        return send(res, 200, { ok: true });
      }

      case 'delete': {
        const goal = await ownGoal(db, user.id, body.id);
        if (!goal) return fail(res, 404, 'NOT_FOUND', 'Goal not found.');
        if (String(body.confirmName || '').trim() !== goal.name) {
          return fail(res, 422, 'CONFIRM', 'Type the goal name exactly to confirm.');
        }
        // Versions, pauses and notification logs cascade. Posts keep living with goal_id = null.
        const { error } = await db.from('goals').delete().eq('id', goal.id);
        if (error) throw error;
        return send(res, 200, { ok: true });
      }

      default:
        return fail(res, 400, 'BAD_REQUEST', 'Unknown action.');
    }
  } catch (err) {
    const msg = err?.message || 'Could not save the goal.';
    const friendly = /goals_one_active/.test(msg) ? 'Only one goal can be active at a time.' : msg;
    return fail(res, 422, 'INVALID', friendly);
  }
}
