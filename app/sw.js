// Sepia service worker. Two jobs: work offline, and catch share-target
// launches. Image data is never cached except the one-shot share hand-off,
// which is deleted on pickup, purged on every boot, and never served to a
// GET.

const VERSION = "sepia-v0.3.0";
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
  "/icons/sepia.svg",
  "/icons/favicon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/demo/sample.jpg",
  "/privacy.html",
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
        // Only the OS share sheet ("none") or the app itself may plant a
        // file; a cross-site form post must not steer this tab into Sepia.
        const site = event.request.headers.get("Sec-Fetch-Site");
        if (site !== null && site !== "none" && site !== "same-origin") {
          return new Response("no", { status: 403 });
        }
        try {
          const form = await event.request.formData();
          const files = form.getAll("image").filter((f) => f && f.size && f.size <= 100 * 1024 * 1024);
          const cache = await caches.open(SHARE_CACHE);
          // A crashed earlier pickup must not leak stale images into this
          // batch: the parking lot is emptied before every new share.
          for (const req of await cache.keys()) await cache.delete(req);
          let n = 0;
          for (const file of files.slice(0, 50)) {
            await cache.put(
              `/share-incoming-${n++}`,
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

  // The parked share file is for the app's one pickup, never a response.
  if (url.pathname === "/share-incoming") {
    event.respondWith(new Response("gone", { status: 404 }));
    return;
  }

  if (event.request.mode === "navigate") {
    // Only the app shell and the privacy page are served from cache; any
    // other navigation (the APK download, future pages) goes to network.
    const shell =
      url.pathname === "/" || url.pathname === "/index.html"
        ? "/index.html"
        : url.pathname === "/privacy.html" || url.pathname === "/privacy"
          ? "/privacy.html"
          : null;
    if (shell) {
      event.respondWith(
        (async () => {
          const cached = await caches.match(shell, { cacheName: VERSION });
          return cached || fetch(event.request);
        })()
      );
    }
    return;
  }

  event.respondWith(
    (async () => {
      // Scoped to the app cache: the share cache must never answer a GET.
      const cached = await caches.match(event.request, { cacheName: VERSION });
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
