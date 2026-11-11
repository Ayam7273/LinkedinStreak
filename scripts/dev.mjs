// Local dev server: static files + /api/* functions, like Vercel.
// Usage: npm run dev   (reads .env.local / .env if present)  ->  http://localhost:3000
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 3000);

// ---- env files (no dependency) -------------------------------------------
for (const name of ['.env.local', '.env']) {
  const file = join(root, name);
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  console.log(`Loaded ${name}`);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

async function runApi(req, res, pathname) {
  const rel = pathname.replace(/^\/api\//, '').replace(/\/$/, '');
  if (rel.split('/').some((p) => p.startsWith('_') || p === '..')) return notFound(res);
  const file = join(root, 'api', `${rel}.js`);
  if (!existsSync(file)) return notFound(res);

  // Parse a JSON body like Vercel does.
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    req.body = raw ? JSON.parse(raw) : {};
  } catch {
    req.body = raw;
  }

  try {
    const mod = await import(pathToFileURL(file).href + `?t=${Date.now()}`);
    await mod.default(req, res);
  } catch (err) {
    console.error(`[api] ${pathname}:`, err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
    }
    res.end(JSON.stringify({ ok: false, code: 'SERVER', message: err.message }));
  }
}

function notFound(res) {
  res.statusCode = 404;
  res.setHeader('Content-Type', 'text/plain');
  res.end('Not found');
}

async function serveStatic(res, pathname) {
  let p = pathname === '/' || pathname === '/share' ? '/index.html' : pathname;
  const file = normalize(join(root, decodeURIComponent(p)));
  if (!file.startsWith(root) || /[\\/](node_modules|\.git|\.env)/.test(file.slice(root.length))) return notFound(res);
  try {
    const s = await stat(file);
    if (!s.isFile()) return notFound(res);
    res.setHeader('Content-Type', TYPES[extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache');
    if (p === '/sw.js') res.setHeader('Service-Worker-Allowed', '/');
    res.end(await readFile(file));
  } catch {
    notFound(res);
  }
}

const server = http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url, `http://${req.headers.host}`);
    const started = Date.now();
    res.on('finish', () => {
      if (pathname.startsWith('/api/')) console.log(`${req.method} ${pathname} ${res.statusCode} ${Date.now() - started}ms`);
    });
    if (pathname.startsWith('/api/')) return runApi(req, res, pathname);
    return serveStatic(res, pathname);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use (another dev server is probably running).`);
    console.error(`Stop it, or use another port:  $env:PORT=${PORT + 1}; npm run dev`);
    console.error(`Find what holds it:  Get-NetTCPConnection -LocalPort ${PORT} | Select OwningProcess`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
    console.log(`LinkedStreak dev server: http://localhost:${PORT}`);
    if (!process.env.SUPABASE_URL) console.log('No SUPABASE_URL yet: the app will show "Not set up yet". Copy .env.example to .env.local and fill it in.');
  });
