// Minimal offline-first service worker (cache-on-install + stale-while-revalidate).
const CACHE = "apt-v2";
const ASSETS = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./js/rooms.js",
  "./js/furniture.js",
  "./js/custom-items.js",
  "./js/app.js",
  "./js/three-view.js",
  "./manifest.webmanifest",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  // Network-first for navigation, cache-first for static assets.
  e.respondWith(
    (async () => {
      try {
        const fresh = await fetch(req);
        // Only cache same-origin 200 responses
        if (fresh && fresh.status === 200 && new URL(req.url).origin === location.origin) {
          const copy = fresh.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return fresh;
      } catch (err) {
        const cached = await caches.match(req);
        if (cached) return cached;
        // Offline fallback for navigation
        if (req.mode === "navigate") return caches.match("./index.html");
        throw err;
      }
    })()
  );
});
