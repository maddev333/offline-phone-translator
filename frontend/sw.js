const STATIC_CACHE = "offline-phone-translator-static-v2";

function getBasePath() {
  const url = new URL(self.location.href);
  return url.pathname.replace(/[^/]+$/, "");
}

function toAppUrl(path) {
  return new URL(path, self.location.href).toString();
}

function getAppAssets() {
  const basePath = getBasePath();
  return [
    toAppUrl(basePath),
    toAppUrl(`${basePath}index.html`),
    toAppUrl(`${basePath}app.js`),
    toAppUrl(`${basePath}config.js`),
    toAppUrl(`${basePath}local-translation.js`),
    toAppUrl(`${basePath}manifest.webmanifest`),
  ];
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(getAppAssets()))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== STATIC_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        return cached;
      }

      return fetch(request)
        .then((response) => {
          const responseToCache = response.clone();
          caches.open(STATIC_CACHE).then((cache) => {
            cache.put(request, responseToCache);
          });
          return response;
        })
        .catch(() => caches.match(toAppUrl(`${getBasePath()}index.html`)));
    })
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "REMOVE_MODEL_CACHE") {
    return;
  }

  const { modelName, basePath } = event.data;
  event.waitUntil(
    caches.keys().then(async (keys) => {
      for (const key of keys) {
        const cache = await caches.open(key);
        const requests = await cache.keys();
        await Promise.all(
          requests
            .filter((request) => request.url.includes(modelName) && (!basePath || request.url.includes(basePath)))
            .map((request) => cache.delete(request))
        );
      }
    })
  );
});
