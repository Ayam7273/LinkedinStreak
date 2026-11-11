// Data fetching, caching and a tiny pub/sub store.
import { supabase } from './supabase.js';
import { summarise } from './streak.js';
import { nextFriday, londonDate } from './time.js';
import { DEFAULT_REMINDER_TIMES, DEFAULT_GRACE_TIME } from './reminders.js';

const CACHE_KEY = 'ls2:cache';
const LEGACY_KEYS = ['linkedstreak_v1'];

const store = {
  status: 'idle', // idle | loading | ready | error
  error: null,
  user: null,
  settings: null,
  posts: [],
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  lastStamped: null, // { day, from, to } for the stamp + numeral animation
};

const listeners = new Set();

export function getState() {
  return store;
}

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

/** Derived numbers. Never stored. */
export function derived(now = Date.now()) {
  return summarise({ startDate: store.settings?.start_date || null, now, posts: store.posts });
}

// ---- local cache (per-device convenience only) -----------------------------
function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCache() {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ userId: store.user?.id, settings: store.settings, posts: store.posts }),
    );
  } catch {
    /* storage unavailable */
  }
}

export function clearLegacy() {
  try {
    for (const k of LEGACY_KEYS) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

export function clearCache() {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
}

// ---- loading ---------------------------------------------------------------
function defaultSettings(userId) {
  return {
    user_id: userId,
    display_name: '',
    profile_url: '',
    profile_slug: '',
    start_date: nextFriday(londonDate(Date.now())),
    reminder_times: DEFAULT_REMINDER_TIMES,
    grace_reminder_time: DEFAULT_GRACE_TIME,
    reminders_enabled: true,
  };
}

export async function load(user) {
  const cached = readCache();
  if (cached && cached.userId === user.id) {
    set({ user, settings: cached.settings, posts: cached.posts || [], status: 'ready' });
  } else {
    set({ user, status: 'loading' });
  }

  try {
    const sb = await supabase();
    const [{ data: settings, error: sErr }, { data: posts, error: pErr }] = await Promise.all([
      sb.from('settings').select('*').eq('user_id', user.id).maybeSingle(),
      sb.from('posts').select('*').eq('user_id', user.id).order('published_at', { ascending: false }),
    ]);
    if (sErr) throw sErr;
    if (pErr) throw pErr;

    let s = settings;
    if (!s) {
      const fresh = defaultSettings(user.id);
      const { data, error } = await sb.from('settings').insert(fresh).select().single();
      if (error) throw error;
      s = data;
    }
    set({ settings: s, posts: posts || [], status: 'ready', error: null });
    writeCache();
  } catch (err) {
    if (store.status === 'ready') {
      set({ error: err });
    } else {
      set({ status: 'error', error: err });
    }
  }
}

// ---- mutations -------------------------------------------------------------
export async function saveSettings(patch) {
  const sb = await supabase();
  const next = { ...store.settings, ...patch };
  const { data, error } = await sb
    .from('settings')
    .update(patch)
    .eq('user_id', store.user.id)
    .select()
    .single();
  if (error) throw error;
  set({ settings: data || next });
  writeCache();
  return data;
}

export function addPost(post, { from, to }) {
  const posts = [post, ...store.posts.filter((p) => p.id !== post.id)].sort((a, b) =>
    a.published_at < b.published_at ? 1 : -1,
  );
  set({ posts, lastStamped: { day: post.required_day, from, to } });
  writeCache();
}

export function consumeStamp() {
  const s = store.lastStamped;
  store.lastStamped = null;
  return s;
}

export async function deletePost(id) {
  const sb = await supabase();
  const { error } = await sb.from('posts').delete().eq('id', id).eq('user_id', store.user.id);
  if (error) throw error;
  set({ posts: store.posts.filter((p) => p.id !== id) });
  writeCache();
}

export async function eraseAllPosts() {
  const sb = await supabase();
  const { error } = await sb.from('posts').delete().eq('user_id', store.user.id);
  if (error) throw error;
  set({ posts: [] });
  writeCache();
}
