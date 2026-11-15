// Service worker: lets the web app open with no internet.
// The page tells it which files the app is made of (see offlineShell.web.js)
// and it keeps a copy. After that:
//   - the app's own files come from the saved copy (fast, works offline)
//   - the page itself (index.html) is fetched fresh when online, and the
//     saved copy is used when offline
//   - calls to the API are never touched: the app handles those itself
const CACHE = 'accessed-shell-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CACHE_URLS') {
    event.waitUntil(cacheUrls(event.data.urls || []));
  }
});

async function cacheUrls(urls) {
  const cache = await caches.open(CACHE);
  await Promise.all(urls.map(async (url) => {
    try {
      const response = await fetch(url, { cache: 'reload' });
      if (response.ok) await cache.put(url, response);
    } catch (err) {
      // not reachable now; it will be saved the next time it is used online
    }
  }));
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // the API lives elsewhere
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(request.mode === 'navigate' ? pageFirst(request) : fileFirst(request));
});

async function pageFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const fresh = await fetch(request);
    if (fresh.ok) await cache.put(request, fresh.clone());
    return fresh;
  } catch (err) {
    return (await cache.match(request)) || (await cache.match('/')) || Response.error();
  }
}

async function fileFirst(request) {
  const cache = await caches.open(CACHE);
  const saved = await cache.match(request);
  if (saved) return saved;
  const fresh = await fetch(request);
  if (fresh.ok) await cache.put(request, fresh.clone());
  return fresh;
}
