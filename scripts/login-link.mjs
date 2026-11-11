// Dev helper: print a one-time sign-in link and code WITHOUT sending an email
// (so Supabase's email rate limit doesn't apply). Uses the service-role key
// from .env.local, so it only runs on your machine.
//
// Usage:  npm run login -- you@example.com            (link for http://localhost:3000)
//         npm run login -- you@example.com https://linkedin-streak.vercel.app
import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const name of ['.env.local', '.env']) {
  const file = join(root, name);
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const [email, site = 'http://localhost:3000'] = process.argv.slice(2);
if (!email) {
  console.error('Usage: npm run login -- you@example.com [site-url]');
  process.exit(1);
}
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data, error } = await admin.auth.admin.generateLink({
  type: 'magiclink',
  email,
  options: { redirectTo: `${site.replace(/\/+$/, '')}/` },
});
if (error) {
  console.error('Could not create a link:', error.message);
  if (/not found|User/i.test(error.message)) console.error('Add this email under Supabase → Authentication → Users first.');
  process.exit(1);
}

console.log('\nSign-in link (one use, expires in about an hour). Open it in the browser running the app:\n');
console.log(data.properties.action_link);
if (data.properties.email_otp) console.log(`\nOr enter this code on the sign-in screen: ${data.properties.email_otp}`);
console.log('\nNo email was sent.\n');
