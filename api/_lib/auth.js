// Verify the Supabase JWT on every API call. SERVER ONLY.
import { admin, fail } from './supabase-admin.js';

/** Returns the signed-in user, or sends 401 and returns null. */
export async function requireUser(req, res) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) {
    fail(res, 401, 'AUTH', 'Please sign in.');
    return null;
  }
  const { data, error } = await admin().auth.getUser(token);
  if (error || !data?.user) {
    fail(res, 401, 'AUTH', 'Your session has expired. Please sign in again.');
    return null;
  }
  return data.user;
}
