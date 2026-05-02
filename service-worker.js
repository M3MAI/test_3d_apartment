// Minimal offline-first service worker (cache-on-install + stale-while-revalidate).
//
// IMPORTANT: We deliberately do NOT call `self.skipWaiting()` from `install`
// anymore. When a new service-worker is installed while the page is open, the
// browser keeps it in "waiting" state until all tabs close. Our index.html
// detects `installed` + existing controller, shows an "update available"
// banner, and the user clicks "تحديث" — which postMessages SKIP_WAITING here
// and the new SW takes over on the next reload (driven by `controllerchange`
// in the page).
const CACHE = "apt-v10";
const ASSETS = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./js/rooms.js",
  "./js/furniture.js",
  "./js/custom-items.js",
  "./js/dxf-import.js",
  "./js/wall-storage.js",
  "./js/wallpaper-presets.js",
  "./js/wall-photo.js",
  "./js/app.js",
  "./js/three-view.js",
  "./manifest.webmanifest",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS).catch(() => {}))
  );
  // No `self.skipWaiting()` here on purpose — the page surfaces an update
  // toast and only invokes `skipWaiting` when the user accepts it.
});

self.addEventListener("message", (e) => {
  if (e && e.data && e.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
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
