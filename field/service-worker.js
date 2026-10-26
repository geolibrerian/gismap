const CACHE = "gismap-field-v7";
const SHELL = ["./", "./index.html", "./field-mode.css", "./field-mode.js", "../js/geopayload.js", "../js/field-site-pack.js", "../js/field-records.js", "../js/field-record-store.js", "../js/field-record-report.js", "../js/field-task-share.js", "../js/turf-offline.js", "../js/pdf-document.js", "../js/qr-import.js", "../js/vendor/qrcode-1.5.4.js", "../js/vendor/jsqr-1.4.0.js", "../js/vendor/turf-7.4.0.min.js"];
self.addEventListener("install", (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", (event) => event.waitUntil(caches.keys()
  .then((names) => Promise.all(names.filter((name) => name.startsWith("gismap-field-") && name !== CACHE).map((name) => caches.delete(name))))
  .then(() => self.clients.claim())));
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => { if (new URL(event.request.url).origin === location.origin) caches.open(CACHE).then((cache) => cache.put(event.request, response.clone())); return response; })));
});
