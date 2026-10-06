/*
 * Hallery's service worker. It does one thing: when the phone has no connection, a page
 * load shows a Vietnamese "mất kết nối" screen instead of the browser's dinosaur.
 *
 * Nothing else is cached. Every gallery reads live from SQLite and Notion, and a stale
 * copy served as if it were current would be worse than an honest offline screen.
 * Server Actions, RSC payloads, covers and /api are never touched — only full page loads.
 */
const CACHE = "hallery-offline-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" }))));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(async () => (await caches.match(OFFLINE_URL)) ?? Response.error()),
  );
});
