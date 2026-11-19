// MDE service worker: offline start and installability for the browser build.
// Registered by src/pwa.ts in production browser builds only. The build plugin in
// vite.config.ts rewrites the next two lines; keep their exact text.
const BUILD_ID = "dev";
const PRECACHE = [];

// Everything is resolved against this file's folder, so the app works under any sub-path.
const ROOT = new URL("./", self.location.href).href;
const ASSETS = new URL("assets/", ROOT).href;
// Cache names are per origin; the scope in the prefix keeps other apps' caches out of cleanup.
const CACHE_PREFIX = `mde:${self.registration.scope}:`;
const CACHE = CACHE_PREFIX + BUILD_ID;

// No skipWaiting(): an open page keeps the worker (and cache) whose lazy chunks match it.
// Navigations are network-first, so a deploy still shows up on the next load.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(new URL(url, ROOT), { cache: "reload" })))),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith(CACHE_PREFIX) && key !== CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

/** The app's HTML, under any query string; it is cached once, under ROOT. */
function isAppShell(url) {
  const bare = new URL(url);
  bare.search = "";
  bare.hash = "";
  return bare.href === ROOT || bare.href === `${ROOT}index.html`;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  // Only same-origin GETs inside the scope; everything else (e.g. the site's /ins/ analytics) passes through.
  if (request.method !== "GET") return;
  if (new URL(request.url).origin !== self.location.origin || !request.url.startsWith(self.registration.scope)) return;

  if (isAppShell(request.url)) {
    event.respondWith(networkFirst(event, ROOT));
  } else if (request.url.startsWith(ASSETS)) {
    event.respondWith(cacheFirst(event));
  } else {
    event.respondWith(networkFirst(event, request.url));
  }
});

function store(event, key, response) {
  if (!response.ok || response.type !== "basic") return;
  const copy = response.clone();
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.put(key, copy))
      .catch((err) => console.warn("MDE service worker: cache write failed", err)),
  );
}

async function fromCache(key) {
  const cache = await caches.open(CACHE);
  // This build's cache first; then any cache, e.g. a waiting newer worker's precache of a just-deployed chunk.
  return (await cache.match(key, { ignoreVary: true })) ?? (await caches.match(key, { ignoreVary: true }));
}

async function networkFirst(event, key) {
  try {
    const response = await fetch(event.request);
    store(event, key, response);
    return response;
  } catch (err) {
    const cached = await fromCache(key);
    if (!cached) throw err;
    // A redirected response cannot answer a navigation; re-wrap the body.
    return cached.redirected
      ? new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers: cached.headers })
      : cached;
  }
}

async function cacheFirst(event) {
  const cached = await fromCache(event.request);
  if (cached) return cached;
  const response = await fetch(event.request);
  store(event, event.request, response);
  return response;
}
