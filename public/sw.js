/*
 * Local Diary Core — offline app shell service worker.
 *
 * Bump SHELL_VERSION whenever the shell list or caching strategy changes; old
 * caches are deleted on activation and new workers take over immediately.
 *
 * Privacy rules baked in here:
 *   - only same-origin GET requests are ever cached
 *   - API/websocket traffic (Convex, auth) is never intercepted
 *   - dev-server modules are never cached
 */
const SHELL_VERSION = "ldc-shell-v1";

const SHELL_ASSETS = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/logo.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/apple-touch-icon.png",
];

/** Vite dev-server traffic — never cached (HMR must stay live). */
const DEV_PATH = /^\/(@|src\/|node_modules\/)/;

/**
 * Last-resort document when a navigation happens with nothing cached yet
 * (for example the very first launch happens offline).
 */
const OFFLINE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#09090b" />
    <title>Local Diary Core — offline</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center;
        background: #09090b; color: #e4e4e7; font: 15px/1.6 ui-sans-serif, system-ui, sans-serif; }
      .card { max-width: 22rem; padding: 2rem; text-align: center; }
      h1 { font-size: 1.05rem; margin: 0 0 .5rem; }
      p { margin: 0 0 1.25rem; color: #a1a1aa; }
      button { border: 1px solid #3f3f46; background: #18181b; color: inherit;
        border-radius: .5rem; padding: .5rem 1rem; font: inherit; cursor: pointer; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>You are offline</h1>
      <p>Local Diary Core needs one connection to finish installing. Reconnect and open the app again — after that it works without a network.</p>
      <button onclick="location.reload()">Try again</button>
    </div>
  </body>
</html>`;

function isCacheable(request, url) {
  if (request.method !== "GET") return false;
  if (url.origin !== self.location.origin) return false;
  if (DEV_PATH.test(url.pathname)) return false;
  // ?t= / ?import / ?direct are Vite dev transforms.
  if (url.search && !url.pathname.startsWith("/assets/")) {
    const keys = [...url.searchParams.keys()];
    if (keys.some((k) => ["t", "import", "direct", "raw", "url"].includes(k))) {
      return false;
    }
  }
  return true;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_VERSION);
      await Promise.allSettled(
        SHELL_ASSETS.map(async (asset) => {
          try {
            const response = await fetch(asset, { cache: "reload" });
            if (response && response.ok) await cache.put(asset, response.clone());
          } catch {
            // Keep installing even if one shell asset is unreachable.
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key !== SHELL_VERSION).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (!isCacheable(request, url)) return;

  // App navigations: always try the network first, fall back to the shell so
  // an installed app still opens with no connection.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          if (fresh && fresh.ok && !fresh.redirected) {
            const cache = await caches.open(SHELL_VERSION);
            await cache.put("/index.html", fresh.clone());
          }
          return fresh;
        } catch {
          const cache = await caches.open(SHELL_VERSION);
          const cached =
            (await cache.match("/index.html")) || (await cache.match("/"));
          if (cached) return cached;
          return new Response(OFFLINE_HTML, {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }
      })(),
    );
    return;
  }

  // Static assets: serve the cached copy instantly, refresh it in the
  // background so the next launch gets the newest build.
  event.respondWith(
    (async () => {
      const cache = await caches.open(SHELL_VERSION);
      const cached = await cache.match(request);

      const network = fetch(request)
        .then(async (response) => {
          if (response && response.ok && response.type === "basic") {
            try {
              await cache.put(request, response.clone());
            } catch {
              // Response not storable (range/partial) — skip silently.
            }
          }
          return response;
        })
        .catch(() => undefined);

      if (cached) return cached;
      const fresh = await network;
      return (
        fresh ??
        new Response("", { status: 504, statusText: "Offline and not cached" })
      );
    })(),
  );
});
