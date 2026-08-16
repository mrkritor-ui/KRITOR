const CACHE_NAME = "works-gallery-__BUILD_VERSION__";

const APP_FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./script.js",
  "./artworks.js",
  "./icon.png"
];


/* =========================================================
   INSTALL
========================================================= */

self.addEventListener("install", event => {

  event.waitUntil(

    caches.open(CACHE_NAME)
      .then(cache =>
        cache.addAll(APP_FILES)
      )

  );

  self.skipWaiting();

});


/* =========================================================
   ACTIVATE
========================================================= */

self.addEventListener("activate", event => {

  event.waitUntil(

    caches.keys()
      .then(keys =>

        Promise.all(

          keys
            .filter(
              key =>
                key !== CACHE_NAME
            )
            .map(
              key =>
                caches.delete(key)
            )

        )

      )

  );

  self.clients.claim();

});


/* =========================================================
   FETCH
========================================================= */

self.addEventListener(
  "fetch",
  event => {

    const request =
      event.request;

    const url =
      new URL(
        request.url
      );


    /* -----------------------------------------------------
       Ignore non-GET requests
    ----------------------------------------------------- */

    if (
      request.method !== "GET"
    ) {

      return;

    }


    /* -----------------------------------------------------
       Never intercept GitHub API
    ----------------------------------------------------- */

    if (
      url.hostname ===
      "api.github.com"
    ) {

      return;

    }


    /* -----------------------------------------------------
       ARTWORKS.JS
       
       ALWAYS try the network first.
       This is the catalogue database and must stay current.
    ----------------------------------------------------- */

    if (
      url.pathname.endsWith(
        "/artworks.js"
      )
    ) {

      event.respondWith(

        fetch(
          request,
          {
            cache: "no-store"
          }
        )

          .then(
            response => {

              if (
                response &&
                response.ok
              ) {

                return response;

              }

              throw new Error(
                "Could not fetch artworks.js"
              );

            }
          )

          .catch(
            () => {

              return caches.match(
                request
              );

            }
          )

      );

      return;

    }


    /* -----------------------------------------------------
       EVERYTHING ELSE
       
       Network first, cache as fallback.
    ----------------------------------------------------- */

    event.respondWith(

      fetch(request)

        .then(
          response => {

            if (
              response &&
              response.status === 200 &&
              response.type !== "opaque"
            ) {

              const copy =
                response.clone();


              caches.open(
                CACHE_NAME
              )
                .then(
                  cache => {

                    cache.put(
                      request,
                      copy
                    );

                  }
                );

            }


            return response;

          }
        )

        .catch(
          () => {

            return caches.match(
              request
            )
              .then(
                cached => {

                  return (
                    cached ||
                    caches.match(
                      "./index.html"
                    )
                  );

                }
              );

          }
        )

    );

  }
);
