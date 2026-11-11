// Service-role Supabase client and request helpers. SERVER ONLY.
import { createClient } from '@supabase/supabase-js';

let client;

export function admin() {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return client;
}

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export function methodNotAllowed(res, allowed) {
  res.setHeader('Allow', allowed.join(', '));
  return send(res, 405, { ok: false, code: 'METHOD', message: 'Method not allowed.' });
}

export async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    return {};
  }
}

/**
 * Resolve the signed-in user from the Bearer token and make sure it's the owner.
 * Returns the user, or sends a 401/403 and returns null.
 */
export async function requireOwner(req, res) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    send(res, 401, { ok: false, code: 'AUTH', message: 'Sign in again.' });
    return null;
  }
  const { data, error } = await admin().auth.getUser(token);
  if (error || !data?.user) {
    send(res, 401, { ok: false, code: 'AUTH', message: 'Your session has expired. Sign in again.' });
    return null;
  }
  const owner = process.env.OWNER_USER_ID;
  if (owner && data.user.id !== owner) {
    send(res, 403, { ok: false, code: 'FORBIDDEN', message: 'This account is not allowed here.' });
    return null;
  }
  return data.user;
}
