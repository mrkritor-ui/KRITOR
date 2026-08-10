const CACHE_NAME = "works-gallery-v1";

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
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(APP_FILES);
    })
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

self.addEventListener("message", event => {
  if (!event.data) return;

  if (event.data.type === "CACHE_IMAGES") {
    const images = event.data.images || [];

    event.waitUntil(
      caches.open(CACHE_NAME).then(cache => {
        return Promise.all(
          images.map(path => {
            return cache.add(path).catch(error => {
              console.warn(
                "Could not cache image:",
                path,
                error
              );
            });
          })
        );
      })
    );
  }
});

self.addEventListener("fetch", event => {
  const request = event.request;

  if (request.method !== "GET") return;

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) {
        return cached;
      }

      return fetch(request)
        .then(response => {

          if (
            !response ||
            response.status !== 200 ||
            response.type === "opaque"
          ) {
            return response;
          }

          const copy = response.clone();

          caches.open(CACHE_NAME).then(cache => {
            cache.put(request, copy);
          });

          return response;
        })
        .catch(() => {
          return caches.match("./index.html");
        });
    })
  );
});
