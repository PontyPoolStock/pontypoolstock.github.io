const CACHE_NAME = 'pontypool-v8';
const urlsToCache = [
  './',
  './index.html',
  './css/style.css',
  './js/main.js',
  './pwa-icon-192.png',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(urlsToCache))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith('pontypool-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  const isAppAsset = ["script", "style", "image", "font"].includes(request.destination);
  const shouldRefresh =
    request.mode === "navigate" ||
    ["script", "style"].includes(request.destination);

  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    (request.mode !== "navigate" && !isAppAsset)
  ) {
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached && !shouldRefresh) return cached;

      const refresh = fetch(request).then((response) => {
        if (!response.ok) return response;
        return cache.put(request, response.clone()).then(
          () => response,
          () => response,
        );
      });

      if (cached) {
        event.waitUntil(refresh.catch((error) => {
          console.warn("App cache refresh failed:", error);
        }));
        return cached;
      }

      return refresh;
    })
  );
});