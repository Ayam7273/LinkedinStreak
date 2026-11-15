// Store + data fetching. Reads go straight to Supabase (RLS keeps every user to their own rows);
// goal writes and post logging go through /api so the server validates them.
// Streaks are never stored: they are derived from the rows on every render.
import { supabase, api } from './supabase.js';
import { summarise, currentUnit } from './core/streak.js';
import { currentVersion } from './core/schedule.js';
import { detectTimeZone, isValidTimeZone, dateIn } from './core/time.js';

const store = {
  status: 'idle', // idle | loading | ready | error
  error: null,
  user: null,
  profile: null,
  goals: [],
  versions: {}, // goal_id -> versions[]
  pauses: {}, // goal_id -> pauses[]
  posts: [],
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  bump: null, // { from, to } after a log, for the count-up
};

const listeners = new Set();

export const getState = () => store;

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) fn(store);
}

export function set(patch) {
  Object.assign(store, patch);
  emit();
}

// ---- Derived ---------------------------------------------------------------
export const weekStart = () => store.profile?.week_start || 'mon';
export const profileTz = () => (isValidTimeZone(store.profile?.timezone) ? store.profile.timezone : detectTimeZone());
export const profileToday = (now = Date.now()) => dateIn(now, profileTz());
export const activeGoal = () => store.goals.find((g) => g.status === 'active') || null;
export const goalById = (id) => store.goals.find((g) => g.id === id) || null;
export const versionsOf = (id) => store.versions[id] || [];
export const pausesOf = (id) => store.pauses[id] || [];
export const versionNow = (id) => currentVersion(versionsOf(id));

export function summaryFor(goal, now = Date.now()) {
  if (!goal || !versionsOf(goal.id).length) return null;
  return summarise({
    goal,
    versions: versionsOf(goal.id),
    pauses: pausesOf(goal.id),
    posts: store.posts,
    now,
    weekStart: weekStart(),
  });
}

export function currentUnitFor(goal, now = Date.now()) {
  const s = summaryFor(goal, now);
  return s ? currentUnit(s, weekStart()) : null;
}

/** 'scheduled' when the start date is still ahead, otherwise the stored status (or completed). */
export function goalStatus(goal, now = Date.now()) {
  if (goal.status === 'active' || goal.status === 'paused') {
    const tz = versionNow(goal.id)?.timezone || profileTz();
    const today = dateIn(now, tz);
    if (goal.end_date && today > goal.end_date) return 'completed';
    if (goal.status === 'active' && today < goal.start_date) return 'scheduled';
  }
  return goal.status;
}

// ---- Loading -----------------------------------------------------------------
function group(rows, key) {
  const out = {};
  for (const r of rows || []) (out[r[key]] ||= []).push(r);
  return out;
}

export async function load({ quiet = false } = {}) {
  if (!quiet) set({ status: store.status === 'ready' ? 'ready' : 'loading', error: null });
  try {
    const sb = await supabase();
    const { data: auth } = await sb.auth.getUser();
    const user = auth?.user;
    if (!user) throw new Error('Signed out');

    const [profile, goals, posts] = await Promise.all([
      sb.from('profiles').select('*').eq('id', user.id).maybeSingle(),
      sb.from('goals').select('*').order('created_at', { ascending: true }),
      sb.from('posts').select('*').order('published_at', { ascending: false }),
    ]);
    for (const r of [profile, goals, posts]) if (r.error) throw r.error;

    const ids = (goals.data || []).map((g) => g.id);
    let versions = { data: [] };
    let pauses = { data: [] };
    if (ids.length) {
      [versions, pauses] = await Promise.all([
        sb.from('goal_versions').select('*').in('goal_id', ids).order('effective_from'),
        sb.from('goal_pauses').select('*').in('goal_id', ids).order('from_date'),
      ]);
      for (const r of [versions, pauses]) if (r.error) throw r.error;
    }

    set({
      status: 'ready',
      error: null,
      user,
      profile: profile.data || { id: user.id, timezone: detectTimeZone(), week_start: 'mon' },
      goals: goals.data || [],
      versions: group(versions.data, 'goal_id'),
      pauses: group(pauses.data, 'goal_id'),
      posts: posts.data || [],
    });
  } catch (err) {
    set({ status: 'error', error: err?.message || 'Could not load your data.' });
  }
  return store;
}

export const refresh = () => load({ quiet: true });

// ---- Writes ----------------------------------------------------------------
export async function saveProfile(patch) {
  const sb = await supabase();
  const { data, error } = await sb.from('profiles').update(patch).eq('id', store.user.id).select().single();
  if (error) {
    const msg = /timezone/i.test(error.message)
      ? "That timezone isn't recognised."
      : /linkedin_slug/.test(error.message)
        ? "That LinkedIn profile link doesn't look right."
        : 'Could not save your profile. Try again.';
    return { ok: false, message: msg };
  }
  set({ profile: data });
  return { ok: true, profile: data };
}

export async function goalAction(body) {
  const r = await api('/api/goals', { method: 'POST', body });
  if (r.ok) await refresh();
  return r;
}

export async function logPost({ url, note }) {
  const before = summaryFor(activeGoal())?.current ?? 0;
  const r = await api('/api/verify-post', { method: 'POST', body: { url, note } });
  if (r.ok) {
    await refresh();
    const after = summaryFor(activeGoal())?.current ?? before;
    set({ bump: after !== before ? { from: before, to: after } : null });
  }
  return r;
}

export async function removePost(id) {
  const sb = await supabase();
  const { error } = await sb.from('posts').delete().eq('id', id);
  if (error) return { ok: false, message: 'Could not remove that entry. Try again.' };
  set({ posts: store.posts.filter((p) => p.id !== id) });
  return { ok: true };
}
