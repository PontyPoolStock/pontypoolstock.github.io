const CACHE_NAME = 'pontypool-v19';
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
      //* Navigations and code always ask the network first: a deploy must show
      //* up on the next reload instead of one reload later. Offline still falls
      //* back to the cached copy. Images/fonts stay cache-first.
      if (shouldRefresh) {
        try {
          const response = await fetch(request, { cache: "no-cache" });
          if (response.ok) {
            await cache.put(request, response.clone()).catch(() => {});
          }
          return response;
        } catch (error) {
          const cached = await cache.match(request);
          if (cached) return cached;
          throw error;
        }
      }

      const cached = await cache.match(request);
      if (cached) return cached;

      const response = await fetch(request);
      if (response.ok) {
        await cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
  );
});