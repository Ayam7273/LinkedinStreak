// Fixed-window rate limiting backed by Postgres (serverless functions share no memory). SERVER ONLY.
import { admin, fail, clientIp } from './supabase-admin.js';

async function hit(bucket, max, windowSeconds) {
  const { data, error } = await admin().rpc('hit_rate_limit', { p_bucket: bucket, p_max: max, p_window_seconds: windowSeconds });
  if (error) return true; // fail open: never lock people out because the limiter broke
  return data === true;
}

/**
 * limits: [{ key: 'verify:user:<id>', max: 20, windowSeconds: 3600 }, ...]
 * Returns true if allowed; otherwise sends 429 and returns false.
 */
export async function rateLimit(res, limits, message = "You're doing that a lot. Please wait a while and try again.") {
  for (const l of limits) {
    if (!(await hit(l.key, l.max, l.windowSeconds))) {
      res.setHeader('Retry-After', String(l.windowSeconds));
      fail(res, 429, 'RATE_LIMITED', message);
      return false;
    }
  }
  return true;
}

export const ipKey = (prefix, req) => `${prefix}:ip:${clientIp(req)}`;
