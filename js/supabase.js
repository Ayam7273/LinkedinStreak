// Supabase client (pinned ESM build from jsDelivr) and auth helpers.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

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
    throw new Error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in Vercel.');
  }
  client = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'implicit',
      storageKey: 'ls2-auth',
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
  const { data } = sb.auth.onAuthStateChange((_event, session) => cb(session));
  return () => data.subscription.unsubscribe();
}

/** Send a magic link (which also carries a 6-digit code). Sign-ups stay disabled. */
export async function sendMagicLink(email) {
  const sb = await supabase();
  const { error } = await sb.auth.signInWithOtp({
    email,
    // No hash here: Supabase appends #access_token=… and a second '#' breaks parsing.
    // app.js moves to #/today once the session is picked up.
    options: { shouldCreateUser: false, emailRedirectTo: `${location.origin}/` },
  });
  if (error) throw error;
}

/** Sign in with the 6-digit code from the email (works inside an installed iOS app). */
export async function verifyCode(email, token) {
  const sb = await supabase();
  const { data, error } = await sb.auth.verifyOtp({ email, token, type: 'email' });
  if (error) throw error;
  return data.session;
}

export async function signOut() {
  const sb = await supabase();
  await sb.auth.signOut();
}

/** fetch() to our own API with the user's access token. */
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
  return data;
}
