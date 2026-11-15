// Supabase client (pinned ESM build from jsDelivr), session, auth guards and our API helper.
// Only public values reach the browser: the URL, the anon key and the VAPID public key.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

const SHARE_KEY = 'ls:shared-link';
let client = null;
let config = null;

export async function loadConfig() {
  if (config) return config;
  const r = await fetch('/api/config', { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error('Could not load config');
  config = await r.json();
  return config;
}

export async function supabase() {
  if (client) return client;
  const cfg = await loadConfig();
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    throw new Error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.');
  }
  client = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'implicit',
      storageKey: 'ls3-auth',
    },
  });
  return client;
}

export async function getSession() {
  const sb = await supabase();
  const { data } = await sb.auth.getSession();
  return data.session || null;
}

export async function onAuthChange(cb) {
  const sb = await supabase();
  const { data } = sb.auth.onAuthStateChange((event, session) => cb(event, session));
  return () => data.subscription.unsubscribe();
}

/** Where auth emails and OAuth send people back to. No hash: Supabase appends #access_token=… */
export const appUrl = () => `${location.origin}/app.html`;

/** Magic link (the email also carries a 6-digit code). New addresses get an account. */
export async function sendMagicLink(email) {
  const sb = await supabase();
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true, emailRedirectTo: appUrl() },
  });
  if (error) throw error;
}

export async function verifyCode(email, token) {
  const sb = await supabase();
  const { data, error } = await sb.auth.verifyOtp({ email, token, type: 'email' });
  if (error) throw error;
  return data.session;
}

export async function signInWithGoogle() {
  const sb = await supabase();
  const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: appUrl() } });
  if (error) throw error;
}

export async function signOut() {
  const sb = await supabase();
  await sb.auth.signOut();
}

/** Auth tokens or errors left in the URL hash after a redirect. */
export function authHashInfo() {
  const h = location.hash.replace(/^#/, '');
  if (!/(access_token|error_description|error)=/.test(h)) return null;
  const p = new URLSearchParams(h);
  return { error: p.get('error_description') || p.get('error'), hasToken: p.has('access_token') };
}

// ---- Shared link kept through sign-in -----------------------------------
export function stashSharedLink(url) {
  try {
    if (url) sessionStorage.setItem(SHARE_KEY, url);
  } catch {
    /* private mode: the link is simply lost */
  }
}

export function takeSharedLink() {
  try {
    const v = sessionStorage.getItem(SHARE_KEY);
    sessionStorage.removeItem(SHARE_KEY);
    return v;
  } catch {
    return null;
  }
}

/** Guard for the app shell: returns the session or sends the visitor to sign in. */
export async function requireSession() {
  const session = await getSession();
  if (session) return session;
  location.replace('/login.html');
  return null;
}

/** fetch() to our own API with the user's access token. Always resolves to { ok, ... }. */
export async function api(path, { method = 'GET', body } = {}) {
  const session = await getSession();
  const headers = { Accept: 'application/json' };
  if (session) headers.Authorization = `Bearer ${session.access_token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    return { ok: false, code: 'OFFLINE', message: "You're offline. Try again when you have a connection." };
  }
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok && data.ok === undefined) {
    return { ok: false, code: 'SERVER', message: 'Something went wrong on the server. Try again.' };
  }
  if (res.status === 429 && !data.message) data.message = 'Too many requests. Try again in a little while.';
  return data;
}

/** Authenticated GET that returns a Blob (for the data export). */
export async function apiBlob(path) {
  const session = await getSession();
  const res = await fetch(path, { headers: session ? { Authorization: `Bearer ${session.access_token}` } : {} });
  if (!res.ok) throw new Error('Export failed');
  return res.blob();
}
