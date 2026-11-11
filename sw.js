/* LinkedStreak service worker (root scope).
   - Precache the app shell; versioned caches.
   - /api/*: network only, never cached.
   - Google Fonts + jsDelivr: stale-while-revalidate.
   - Navigations: network first, then cached shell, then offline.html.
   - /share (Android share target) is served the app shell; the router fills the Log sheet.
   - Push + notificationclick.
   - Update flow: waits until the page asks for SKIP_WAITING. */

const VERSION = 'v2.0.1';
const SHELL_CACHE = `ls-shell-${VERSION}`;
const RUNTIME_CACHE = `ls-runtime-${VERSION}`;

const SHELL = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.webmanifest',
  '/css/tokens.css',
  '/css/base.css',
  '/css/layout.css',
  '/css/components.css',
  '/js/app.js',
  '/js/supabase.js',
  '/js/state.js',
  '/js/streak.js',
  '/js/linkedin.js',
  '/js/time.js',
  '/js/reminders.js',
  '/js/push.js',
  '/js/theme.js',
  '/js/views/today.js',
  '/js/views/ledger.js',
  '/js/views/log.js',
  '/js/views/settings.js',
  '/js/views/signin.js',
  '/js/ui/toast.js',
  '/js/ui/sheet.js',
  '/js/ui/icons.js',
  '/js/ui/dom.js',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
  '/icons/apple-touch-icon-180.png',
  '/icons/badge-72.png',
];

const CROSS_ORIGIN_PRECACHE = [
  'https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&display=swap',
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
      for (const key of await caches.keys()) {
        if (!keep.has(key)) await caches.delete(key); // includes the old 'linkedstreak-v1'
      }
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

async function navigation(request) {
  try {
    const res = await fetch(request);
    if (res.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put('/index.html', res.clone());
    }
    return res;
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    return (await cache.match('/index.html')) || (await cache.match('/offline.html'));
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // API: always network, never cached.
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) return;

  // Supabase REST/Auth: not ours to cache.
  if (url.hostname.endsWith('.supabase.co')) return;

  // Fonts and the pinned CDN module.
  if (
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com' ||
    url.hostname === 'cdn.jsdelivr.net'
  ) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Navigations, including the /share target.
  if (request.mode === 'navigate') {
    event.respondWith(navigation(request));
    return;
  }

  // App shell: cache first, then network (and keep the copy fresh).
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
  const title = data.title || 'LinkedStreak';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || 'Time to post.',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-72.png',
      tag: data.tag || 'linkedstreak',
      renotify: true,
      data: { url: data.url || '/#/log' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/#/log', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of all) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.focus();
          if ('navigate' in client) {
            try {
              await client.navigate(target);
            } catch {
              /* some browsers refuse navigate() on uncontrolled clients */
            }
          }
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
