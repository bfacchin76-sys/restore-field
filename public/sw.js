/**
 * FieldRestore service worker — PRD §9.
 *
 * Strategy:
 *   • App shell (HTML / JS / CSS / fonts):  stale-while-revalidate, 7 d
 *   • Static photo derivatives (signed URLs from /api/storage/download
 *     and from MinIO/R2):                    cache-first, 30 d
 *   • API GETs (excluding /api/auth):        network-first w/ 5 s timeout
 *   • Mutations (POST/PUT/DELETE):           network-only (the queue layer
 *                                            handles offline writes itself)
 *   • Offline fallback:                       /offline (precached HTML)
 *
 * Versioned caches let us drop stale entries when we ship a new SW.
 * Bump SW_VERSION to invalidate caches.
 */

const SW_VERSION = "fr-sw-1";
const APP_CACHE = `${SW_VERSION}-app`;
const PHOTO_CACHE = `${SW_VERSION}-photos`;
const API_CACHE = `${SW_VERSION}-api`;

const PRECACHE_URLS = ["/offline", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(APP_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([APP_CACHE, PHOTO_CACHE, API_CACHE]);
      const names = await caches.keys();
      await Promise.all(names.filter((n) => !keep.has(n)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

const PHOTO_HOSTS = new Set(["localhost:9000"]); // MinIO dev
const PHOTO_PATHS = [/^\/api\/storage\/download/];

function isPhotoRequest(url) {
  if (PHOTO_HOSTS.has(url.host)) return true;
  if (url.pathname.match(/\.(png|jpg|jpeg|webp|gif|heic)(\?|$)/i)) return true;
  return PHOTO_PATHS.some((re) => re.test(url.pathname));
}

function isApiRequest(url) {
  return url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/auth/");
}

function isAppShell(url, request) {
  if (request.method !== "GET") return false;
  if (request.destination === "document") return true;
  if (
    request.destination === "script" ||
    request.destination === "style" ||
    request.destination === "font"
  )
    return true;
  if (url.pathname.startsWith("/_next/")) return true;
  return false;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone()).catch(() => {});
      return response;
    })
    .catch(() => null);
  return cached || (await networkPromise) || (await cache.match("/offline"));
}

async function cacheFirst(request, cacheName, maxAgeMs) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) {
    // Lazy revalidate if the entry is older than maxAgeMs.
    const date = cached.headers.get("sw-cached-at");
    if (date && Date.now() - Number(date) < maxAgeMs) return cached;
  }
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const headers = new Headers(response.headers);
      headers.set("sw-cached-at", String(Date.now()));
      const body = await response.clone().arrayBuffer();
      const stamped = new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
      cache.put(request, stamped.clone()).catch(() => {});
      return response;
    }
    return cached || response;
  } catch {
    return cached || new Response("offline", { status: 503 });
  }
}

async function networkFirst(request, cacheName, timeoutMs) {
  const cache = await caches.open(cacheName);
  try {
    const networkResponse = await Promise.race([
      fetch(request),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), timeoutMs),
      ),
    ]);
    if (networkResponse && networkResponse.ok) {
      cache.put(request, networkResponse.clone()).catch(() => {});
    }
    return networkResponse;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ offline: true }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Don't touch cross-origin requests we don't recognise.
  if (url.origin !== self.location.origin && !PHOTO_HOSTS.has(url.host)) return;

  // Mutations: pass through; the queue layer handles offline persistence.
  if (request.method !== "GET") return;

  if (isPhotoRequest(url)) {
    event.respondWith(cacheFirst(request, PHOTO_CACHE, 30 * 24 * 60 * 60 * 1000));
    return;
  }

  if (isApiRequest(url)) {
    event.respondWith(networkFirst(request, API_CACHE, 5000));
    return;
  }

  if (isAppShell(url, request)) {
    event.respondWith(
      (async () => {
        try {
          return await staleWhileRevalidate(request, APP_CACHE);
        } catch {
          return (await caches.match("/offline")) || Response.error();
        }
      })(),
    );
    return;
  }
});

// Allow the page to ask us to drain caches (e.g. on logout / version bump).
self.addEventListener("message", (event) => {
  if (event.data?.type === "purge-cache") {
    event.waitUntil(
      caches.keys().then((names) => Promise.all(names.map((n) => caches.delete(n)))),
    );
  }
  if (event.data?.type === "skip-waiting") {
    self.skipWaiting();
  }
});
