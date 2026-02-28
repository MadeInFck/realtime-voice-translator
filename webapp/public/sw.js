// Service Worker — runtime cache strategy for PWA
// PicoVoice model files are large and cached separately in IndexedDB by the SDKs.
// This SW caches the app shell on first visit for offline resilience.
const CACHE = 'translator-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Skip: WebSocket, cross-origin, .pllm model files (too large)
  if (e.request.url.startsWith('ws') || url.pathname.endsWith('.pllm')) return;

  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      try {
        const response = await fetch(e.request);
        // Cache successful GET responses for app shell
        if (e.request.method === 'GET' && response.ok) {
          cache.put(e.request, response.clone());
        }
        return response;
      } catch {
        return cache.match(e.request);
      }
    })
  );
});
