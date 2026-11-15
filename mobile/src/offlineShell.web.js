// Registers the service worker (public/sw.js) so the web app opens with no
// internet, and tells it which files the app is made of. Service workers only
// run on HTTPS pages and on localhost.
export async function registerOfflineShell() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return 'not available here (needs HTTPS or localhost)';
  }
  try {
    await navigator.serviceWorker.register('/sw.js');
    const registration = await navigator.serviceWorker.ready;

    // Everything this page loaded so far, from this same site.
    const urls = [window.location.href, ...performance.getEntriesByType('resource').map((r) => r.name)]
      .filter((u) => u.startsWith(window.location.origin));

    const worker = registration.active || navigator.serviceWorker.controller;
    if (worker) worker.postMessage({ type: 'CACHE_URLS', urls: Array.from(new Set(urls)) });
    return `ready, ${urls.length} files saved for offline use`;
  } catch (err) {
    return `could not start: ${err.message}`;
  }
}
