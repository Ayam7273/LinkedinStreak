/* LinkedInStreak service worker (root scope).
   - Precache the page shells, CSS, JS and icons; versioned caches.
   - /api/* and Supabase: network only, never cached.
   - Google Fonts + the pinned jsDelivr module: stale-while-revalidate.
   - Navigations: network first, then the cached page, then offline.html.
   - Push + notificationclick (opens /app.html#/log).
   - Update flow: a new version waits until the page asks for SKIP_WAITING. */

const VERSION = 'v3.0.2';
const SHELL_CACHE = `ls-shell-${VERSION}`;
const RUNTIME_CACHE = `ls-runtime-${VERSION}`;

const PAGES = ['/', '/index.html', '/app.html', '/login.html', '/privacy.html', '/terms.html', '/offline.html'];

const SHELL = [
  ...PAGES,
  '/manifest.webmanifest',
  '/assets/logo.svg',
  '/assets/logo-mark.svg',
  '/css/tokens.css',
  '/css/base.css',
  '/css/layout.css',
  '/css/components.css',
  '/css/landing.css',
  '/js/app.js',
  '/js/login.js',
  '/js/supabase.js',
  '/js/router.js',
  '/js/state.js',
  '/js/push.js',
  '/js/core/time.js',
  '/js/core/linkedin.js',
  '/js/core/schedule.js',
  '/js/core/streak.js',
  '/js/core/reminders.js',
  '/js/views/today.js',
  '/js/views/goals.js',
  '/js/views/goal-editor.js',
  '/js/views/history.js',
  '/js/views/log.js',
  '/js/views/onboarding.js',
  '/js/views/settings.js',
  '/js/ui/toast.js',
  '/js/ui/sheet.js',
  '/js/ui/logo.js',
  '/js/ui/nav.js',
  '/js/ui/icons.js',
  '/js/ui/dom.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
  '/icons/apple-touch-icon-180.png',
  '/icons/badge-72.png',
];

const CROSS_ORIGIN_PRECACHE = [
  'https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;500;600;700&display=swap',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(SHELL);
      const runtime = await caches.open(RUNTIME_CACHE);
      await Promise.all(
        CROSS_ORIGIN_PRECACHE.map((u) =>
          fetch(u, { mode: 'cors' })
            .then((r) => (r.ok ? runtime.put(u, r) : null))
            .catch(() => null),
        ),
      );
      // First install takes over straight away; later versions wait for the page.
      if (!self.registration.active) await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, RUNTIME_CACHE]);
      for (const key of await caches.keys()) if (!keep.has(key)) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);
  return cached || (await network) || new Response('', { status: 504 });
}

function pageKey(url) {
  const p = url.pathname === '/' ? '/index.html' : url.pathname;
  return PAGES.includes(p) ? p : null;
}

async function navigation(request) {
  const url = new URL(request.url);
  const key = pageKey(url);
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(request);
    if (res.ok && key) cache.put(key, res.clone());
    return res;
  } catch {
    return (key && (await cache.match(key))) || (await cache.match('/offline.html'));
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // API: network only.
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) return;
  // Supabase REST/Auth: not ours to cache.
  if (url.hostname.endsWith('.supabase.co')) return;

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com' || url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(navigation(request));
    return;
  }

  // Static files: cache first, then network (keeping a copy).
  event.respondWith(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      const cached = await cache.match(request, { ignoreSearch: true });
      if (cached) return cached;
      try {
        const res = await fetch(request);
        if (res.ok) cache.put(request, res.clone());
        return res;
      } catch {
        return new Response('', { status: 504 });
      }
    })(),
  );
});

// ---- Push --------------------------------------------------------------------
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data?.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'LinkedInStreak', {
      body: data.body || 'Time to post.',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-72.png',
      tag: data.tag || 'LinkedInStreak',
      renotify: true,
      data: { url: data.url || '/app.html#/log' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/app.html#/log', self.location.origin);
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Prefer an open app window: focus it and route there without a reload.
      const appWin = all.find((c) => new URL(c.url).pathname === '/app.html');
      if (appWin) {
        await appWin.focus();
        const route = (target.hash.match(/^#\/([a-z-]+)/) || [])[1];
        if (route && target.pathname === '/app.html') appWin.postMessage({ type: 'NAVIGATE', route });
        else if ('navigate' in appWin) await appWin.navigate(target.href).catch(() => null);
        return;
      }
      await self.clients.openWindow(target.href);
    })(),
  );
});
