/* ============================================================================
   METRO-CORE TRANSIT OPS - SERVICE WORKER
   100% Offline-First Caching Strategy
   ============================================================================ */

const CACHE_NAME = "metro-ops-v1";

// Core static assets required for the app shell to function offline
const PRECACHE_ASSETS = [
  "/",
  "/sw.js",
  "/static/index.html",
  "/static/css/app.css",
  "/static/js/chart.min.js",
  "/static/js/app.js"
];

// Install Event: pre-cache application shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("[ServiceWorker] Pre-caching offline app shell");
      return cache.addAll(PRECACHE_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activate Event: remove obsolete caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            console.log("[ServiceWorker] Purging legacy cache:", name);
            return caches.delete(name);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event: handle requests with offline fallbacks
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // 1. API Requests: Network-First with Cache Fallback
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          // If valid response, clone and cache for offline reading
          if (networkResponse && networkResponse.status === 200 && event.request.method === "GET") {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(async () => {
          // Network failed: attempt to serve cached API response
          console.log("[ServiceWorker] Offline fallback for API:", url.pathname);
          const cachedResponse = await caches.match(event.request);
          if (cachedResponse) {
            return cachedResponse;
          }
          // If nothing in cache, return an offline JSON fallback
          return new Response(
            JSON.stringify({
              error: "offline",
              offline: true,
              message: "Device is currently offline and data was not previously cached."
            }),
            {
              headers: { "Content-Type": "application/json" },
              status: 503
            }
          );
        })
    );
    return;
  }

  // 2. Static Assets: Cache-First strategy
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Return cached version immediately, fetch update in background (stale-while-revalidate)
        fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, networkResponse);
              });
            }
          })
          .catch(() => {});
        return cachedResponse;
      }

      // Not in cache, fetch over network
      return fetch(event.request)
        .then((networkResponse) => {
          if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== "basic") {
            return networkResponse;
          }
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
          return networkResponse;
        })
        .catch(() => {
          // If HTML navigation fails, return cached index.html
          if (event.request.mode === "navigate") {
            return caches.match("/");
          }
        });
    })
  );
});
