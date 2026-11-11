// GET: public, non-secret client config. Never add a secret here.
export default function handler(req, res) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.end(
    JSON.stringify({
      supabaseUrl: process.env.SUPABASE_URL || '',
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
      vapidPublicKey: process.env.VAPID_PUBLIC_KEY || '',
    }),
  );
}
