const CACHE_NAME = "works-gallery-v4";

const APP_FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./script.js",
  "./artworks.js",
  "./icon.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll(APP_FILES)
    )
  );

  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );

  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);

  if (url.hostname === "api.github.com") {
    return;
  }

  if (event.request.method !== "GET") {
    return;
  }

  /*
   * ALWAYS check the network first for:
   * - catalogue data
   * - HTML
   * - JavaScript
   * - CSS
   * - USDZ AR files
   */

  const isDynamic =
    url.pathname.endsWith(".html") ||
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".usdz");

  if (isDynamic) {
    event.respondWith(
      fetch(event.request)
        .then(response => {

          if (
            response &&
            response.status === 200 &&
            response.type !== "opaque"
          ) {
            const copy = response.clone();

            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, copy);
            });
          }

          return response;
        })
        .catch(() => {
          return caches.match(event.request);
        })
    );

    return;
  }

  /*
   * Images and other static assets:
   * cache first for speed.
   */

  event.respondWith(
    caches.match(event.request).then(cached => {

      if (cached) {
        return cached;
      }

      return fetch(event.request)
        .then(response => {

          if (
            response &&
            response.status === 200 &&
            response.type !== "opaque"
          ) {
            const copy = response.clone();

            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, copy);
            });
          }

          return response;
        })
        .catch(() => {
          return caches.match("./index.html");
        });

    })
  );
});
