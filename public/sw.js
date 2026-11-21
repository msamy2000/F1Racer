const CACHE_NAME = 'f1-2026-world-tour-v1';

const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
];

const IMMUTABLE_ASSET_RE =
  /\/assets\/.*\.(glb|hdr|png|jpe?g|webp|wav|mp3|ogg|woff2)$/i;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.all(
        SHELL_ASSETS.map(async (url) => {
          try {
            await cache.add(url);
          } catch {
            // Skip any optional shell asset unavailable during install
          }
        }),
      );
    }),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache HTTP byte-range responses (e.g., streaming audio 206 Partial Content)
  if (request.headers.has('range')) return;

  if (IMMUTABLE_ASSET_RE.test(url.pathname)) {
    // Cache-first for large immutable binary assets (models, HDRIs, textures, audio, portraits)
    event.respondWith(
      caches.match(request).then(async (cached) => {
        if (cached) return cached;
        const response = await fetch(request);
        if (response && response.ok && response.status === 200) {
          const copy = response.clone();
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, copy);
        }
        return response;
      }),
    );
    return;
  }

  // Network-first for HTML navigations, JS bundles, CSS, and manifest so updates roll out cleanly
  event.respondWith(
    fetch(request)
      .then(async (response) => {
        if (response && response.ok && response.status === 200) {
          const copy = response.clone();
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, copy);
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === 'navigate') {
          const fallback = await caches.match('./index.html');
          if (fallback) return fallback;
        }
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      }),
  );
});
