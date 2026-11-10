// Keeps the app shell available offline. Network first so updates show up while developing.
const CACHE = 'accessed-shell-v9';
const SHELL = ['./', './index.html', './css/styles.css', './js/app.js', './js/api.js', './js/store.js',
  './js/config.js', './js/strings.js', './js/db.js', './js/packs.js', './js/sync.js', './js/markdown.js', './js/learn.js', './js/theme.js', './js/avatar.js',
  './vendor/jszip.min.js', './vendor/sha256.min.js', './manifest.webmanifest', './icon.svg',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api')) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html')))
  );
});
