// Sepia service worker. Two jobs: work offline, and catch share-target
// launches. Image data is never cached except the one-shot share hand-off,
// which is deleted on pickup.

const VERSION = "sepia-v1";
const SHARE_CACHE = "sepia-share";

const PRECACHE = [
  "/",
  "/index.html",
  "/css/app.css",
  "/js/main.js",
  "/js/ui.js",
  "/js/canvasview.js",
  "/js/editor.js",
  "/js/render.js",
  "/js/inspect.js",
  "/js/jpegscan.js",
  "/js/tiff.js",
  "/js/pngscan.js",
  "/js/webpscan.js",
  "/js/bytes.js",
  "/js/report.js",
  "/js/verify.js",
  "/js/names.js",
  "/js/barcodes.js",
  "/js/platform.js",
  "/js/i18n.js",
  "/js/strings-es.js",
  "/js/main.js",
  "/icons/sepia.svg",
  "/icons/favicon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/demo/sample.jpg",
  "/manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION);
      await cache.addAll(PRECACHE);
    })()
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n !== VERSION && n !== SHARE_CACHE).map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (event.request.method === "POST" && url.pathname === "/share") {
    event.respondWith(
      (async () => {
        try {
          const form = await event.request.formData();
          const file = form.get("image");
          if (file) {
            const cache = await caches.open(SHARE_CACHE);
            await cache.put(
              "/share-incoming",
              new Response(file, { headers: { "content-type": file.type || "image/*" } })
            );
          }
        } catch {
          // A malformed share still lands on the app, just with nothing open.
        }
        return Response.redirect("/?share-target=1", 303);
      })()
    );
    return;
  }

  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cached = await caches.match("/index.html");
        return cached || fetch(event.request);
      })()
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      const res = await fetch(event.request);
      if (res && res.ok && PRECACHE.includes(url.pathname)) {
        const cache = await caches.open(VERSION);
        cache.put(event.request, res.clone());
      }
      return res;
    })()
  );
});
