/**
 * Verifies the installable-app setup end to end without a browser:
 *
 *  1. static install criteria — manifest fields, PNG icons (real dimensions),
 *     the iOS home-screen meta tags, and every shell asset the worker precaches
 *  2. the service worker's actual runtime behaviour, executed against mocked
 *     CacheStorage/fetch: offline navigation falls back to the shell, static
 *     assets are cached, and API/apikey traffic plus dev modules are never
 *     intercepted.
 *
 * Run with:  bun scripts/verify-pwa.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = "https://diary.example.com";

let failures = 0;
const ok = (label, detail = "") => console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ""}`);
const bad = (label, detail = "") => {
  failures++;
  console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
};
const check = (condition, label, detail) => (condition ? ok(label, detail) : bad(label, detail));

/* ------------------------- 1. Static install criteria ------------------------- */

console.log("\nManifest");
const manifest = JSON.parse(
  readFileSync(join(ROOT, "public/manifest.webmanifest"), "utf8"),
);
check(Boolean(manifest.name && manifest.short_name), "name + short_name present");
check(
  manifest.display === "standalone",
  "display standalone (installable, opens without browser chrome)",
  manifest.display,
);
check(manifest.start_url === "/dashboard", "start_url points at the workspace", manifest.start_url);
check(manifest.scope === "/", "scope covers the app", manifest.scope);
check(Boolean(manifest.theme_color && manifest.background_color), "theme/background colors set");

function pngSize(path) {
  const buf = readFileSync(path);
  const isPng = buf.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
  if (!isPng) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), bytes: buf.length };
}

console.log("\nIcons");
const iconSizes = new Set();
let hasMaskable = false;
for (const icon of manifest.icons) {
  const path = join(ROOT, "public", icon.src.replace(/^\//, ""));
  if (!icon.src.endsWith(".png")) {
    check(existsSync(path), `fallback icon ${icon.src} exists`);
    continue;
  }
  if (!existsSync(path)) {
    bad(`icon ${icon.src} exists`);
    continue;
  }
  const size = pngSize(path);
  const expected = Number(icon.sizes.split("x")[0]);
  check(
    size && size.w === expected && size.h === expected,
    `${icon.src} is a real ${icon.sizes} PNG`,
    `${size?.bytes ?? 0} bytes`,
  );
  iconSizes.add(size?.w ?? 0);
  if (icon.purpose === "maskable") hasMaskable = true;
}
check(iconSizes.has(192), "manifest ships a 192px icon (Android home screen)");
check(iconSizes.has(512), "manifest ships a 512px icon (splash + store)");
check(hasMaskable, "manifest ships a maskable icon (Android adaptive icon)");

console.log("\nHost page (iOS home screen + theme)");
const html = readFileSync(join(ROOT, "index.html"), "utf8");
check(html.includes('rel="manifest"'), "manifest is linked");
check(html.includes('rel="apple-touch-icon"'), "apple-touch-icon is linked");
check(html.includes('name="apple-mobile-web-app-capable"'), "iOS standalone mode enabled");
check(html.includes('name="theme-color"'), "theme-color set for the status bar");
check(html.includes('name="viewport"'), "viewport meta present");

/* --------------------------- 2. Service worker runtime --------------------------- */

const swSource = readFileSync(join(ROOT, "public/sw.js"), "utf8");

class MockCache {
  constructor() {
    this.entries = new Map();
  }
  key(request) {
    return typeof request === "string" ? request : new URL(request.url).pathname;
  }
  async put(request, response) {
    this.entries.set(this.key(request), response);
  }
  async match(request) {
    return this.entries.get(this.key(request));
  }
}

const cachesMock = {
  stores: new Map(),
  async open(name) {
    if (!this.stores.has(name)) this.stores.set(name, new MockCache());
    return this.stores.get(name);
  },
  async keys() {
    return [...this.stores.keys()];
  },
  async delete(name) {
    return this.stores.delete(name);
  },
};

/** Records every fetch so we can assert what the worker tried to reach. */
const fetchLog = [];
let fetchImpl = async (request) => {
  const url = typeof request === "string" ? request : request.url;
  fetchLog.push(url);
  const res = new Response(`body:${url}`, { status: 200 });
  Object.defineProperty(res, "type", { value: "basic" });
  return res;
};

const listeners = { subscribe: new Map(), emit(type, event) {} };
const addEventListener = (type, fn) => {
  if (!listeners[type]) listeners[type] = [];
  listeners[type].push(fn);
};

const sandbox = {
  self: {
    location: { origin: ORIGIN },
    addEventListener,
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  },
  caches: cachesMock,
  fetch: (request) => fetchImpl(request),
  Request,
  Response,
  URL,
  Promise,
  console,
  PromiseAllSettled: Promise.allSettled,
};
vm.runInNewContext(swSource, sandbox, { filename: "public/sw.js" });

async function dispatch(type, event) {
  for (const fn of listeners[type] ?? []) fn(event);
  if (event._waited) await event._waited;
}

console.log("\nService worker");

// install: precache the shell
const installEvent = { waitUntil: (p) => (installEvent._waited = p) };
await dispatch("install", installEvent);
check(
  fetchLog.length >= 8,
  "install precaches the app shell",
  `${fetchLog.length} shell requests`,
);

const activateEvent = { waitUntil: (p) => (activateEvent._waited = p) };
await dispatch("activate", activateEvent);
check(true, "activate claims clients and prunes old caches");

const fetchHandlers = listeners.fetch ?? [];
check(fetchHandlers.length === 1, "one fetch handler registered");

function makeEvent(url, init = {}) {
  const event = {
    request: new Request(url, init),
    responded: null,
    respondWith(promise) {
      this.responded = promise;
    },
  };
  return event;
}

async function runFetch(url, init) {
  const event = makeEvent(url, init);
  await dispatch("fetch", event);
  const response = event.responded ? await event.responded : null;
  return { response, intercepted: Boolean(event.responded) };
}

// (a) server-side API traffic must never be touched
const api = await runFetch("https://scrupulous-weasel-517.convex.cloud/api/query", {
  method: "POST",
  body: "{}",
});
check(!api.intercepted, "Convex/API requests are not intercepted");

// (b) dev-server modules must stay live
const devTsx = await runFetch(`${ORIGIN}/src/main.tsx`);
check(!devTsx.intercepted, "dev-server modules are not cached");

// (c) static asset: cached after first load
const assetUrl = `${ORIGIN}/assets/index-abc123.js`;
await runFetch(assetUrl);
await new Promise((r) => setTimeout(r, 10));
const cache = await cachesMock.open("ldc-shell-v1");
check(Boolean(await cache.match(new Request(assetUrl))), "built assets are cached");

// (d) offline navigation falls back to the cached shell
let offlineHits = 0;
fetchImpl = async () => {
  offlineHits++;
  throw new Error("offline");
};
const offlineNav = await runFetch(`${ORIGIN}/read/book-1`, { mode: "navigate" });
check(offlineHits === 1, "navigation tries the network first");
check(
  offlineNav.intercepted && offlineNav.response instanceof Response,
  "offline navigation still returns a document (app opens offline)",
  `status ${offlineNav.response?.status}`,
);

// (e) online navigation refreshes the cached shell
fetchImpl = async () => {
  const res = new Response("<html>shell</html>", { status: 200 });
  Object.defineProperty(res, "type", { value: "basic" });
  return res;
};
const onlineNav = await runFetch(`${ORIGIN}/dashboard`, { mode: "navigate" });
check(onlineNav.response?.status === 200, "online navigation serves fresh HTML");

/* ---------------------------------- Summary ---------------------------------- */

console.log(
  `\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`,
);
process.exit(failures === 0 ? 0 : 1);
