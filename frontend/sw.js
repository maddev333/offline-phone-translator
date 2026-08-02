const CACHE_PREFIX = "offline-phone-translator-static-";
const STATIC_CACHE = `${CACHE_PREFIX}v11`;
// Kept outside CACHE_PREFIX so bumping the shell version does not re-download it.
const CDN_CACHE = "cdn-runtime-v1";
// Transformers.js still resolves the ONNX Runtime loader module from this host. The
// matching .wasm is excluded: transformers.js caches that one itself, and mirroring it
// here would store the same ~24 MB binary twice.
const CDN_ORIGIN = "https://cdn.jsdelivr.net";

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
    toAppUrl(`${basePath}ocr.html`),
    toAppUrl(`${basePath}styles.css`),
    toAppUrl(`${basePath}app.js`),
    toAppUrl(`${basePath}config.js`),
    toAppUrl(`${basePath}languages.js`),
    toAppUrl(`${basePath}local-translation.js`),
    toAppUrl(`${basePath}local-ocr.js`),
    toAppUrl(`${basePath}ocr.js`),
    toAppUrl(`${basePath}model-cache.js`),
    toAppUrl(`${basePath}asr-live.js`),
    toAppUrl(`${basePath}asr/worker.js`),
    toAppUrl(`${basePath}asr/shared.js`),
    toAppUrl(`${basePath}asr/mic-processor.js`),
    toAppUrl(`${basePath}manifest.webmanifest`),
    // Runtime libraries are served from this origin (scripts/vendor-libs.mjs) so a
    // cold start with no network still finds them.
    toAppUrl(`${basePath}vendor/transformers.min.js`),
    toAppUrl(`${basePath}vendor/ort.webgpu.min.mjs`),
    toAppUrl(`${basePath}vendor/ort-wasm-simd-threaded.asyncify.mjs`),
  ];
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(getAppAssets()))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Only prune this app's own shell caches. Deleting every cache in the origin
  // would wipe the multi-hundred-megabyte ASR and Transformers.js model caches.
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== STATIC_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// jsdelivr serves CORS headers, so the cached response is a real one rather than an
// opaque placeholder and can be replayed with no network.
async function cacheFirstCdn(request) {
  const cache = await caches.open(CDN_CACHE);
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    // Model weights (huggingface.co) and the ONNX Runtime .wasm are cached by the code
    // that downloads them, with progress reporting; mirroring them here would double
    // the storage. Only the small CDN modules still need a cache entry.
    if (url.origin === CDN_ORIGIN && !url.pathname.endsWith(".wasm")) {
      event.respondWith(cacheFirstCdn(request));
    }
    return;
  }

  event.respondWith(
    caches
      .open(STATIC_CACHE)
      .then((cache) =>
        cache.match(request).then((cached) => {
          if (cached) {
            return cached;
          }

          return fetch(request)
            .then((response) => {
              if (response.ok && response.type === "basic") {
                cache.put(request, response.clone());
              }
              return response;
            })
            .catch(() => {
              if (request.mode === "navigate") {
                return cache.match(toAppUrl(`${getBasePath()}index.html`));
              }
              return Response.error();
            });
        })
      )
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "REMOVE_MODEL_CACHE") {
    return;
  }

  const { modelName, basePath } = event.data;
  event.waitUntil(
    caches.keys().then(async (keys) => {
      for (const key of keys.filter((name) => name.startsWith(CACHE_PREFIX))) {
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
