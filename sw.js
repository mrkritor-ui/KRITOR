const CACHE_NAME = "works-gallery-__BUILD_VERSION__";

const APP_FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./script.js",
  "./artworks.js",
  "./store/",
  "./store.css",
  "./store.js",
  "./products.js",
  "./type.css",
  "./tile-image.js",
  "./zoom.css",
  "./zoom-transition.js",
  "./work.css",
  "./cart.css",
  "./cart.js",
  "./product.html",
  "./product.css",
  "./product.js",
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
       Only http(s) can go in the cache.

       Browser extensions issue chrome-extension:// requests
       through the pages they run on, and those arrive here
       like any other fetch. Cache.put rejects every scheme
       the Cache API does not support, so each one became an
       unhandled rejection in the console — noise that buries
       real errors on a page where the real errors matter.
    ----------------------------------------------------- */

    if (
      url.protocol !== "http:" &&
      url.protocol !== "https:"
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
       Never intercept Stripe.

       Checkout runs on js.stripe.com scripts, api.stripe.com
       calls and cross-origin payment iframes. Serving any of
       those from cache breaks the payment session, and a
       stale one can fail a real charge — always go to the
       network, every time.
    ----------------------------------------------------- */

    if (
      url.hostname === "js.stripe.com" ||
      url.hostname === "api.stripe.com" ||
      url.hostname.endsWith(".stripe.com") ||
      url.hostname.endsWith(".stripe.network")
    ) {

      return;

    }


    /* -----------------------------------------------------
       Never cache the checkout page or the payment worker.
       Both must reflect live prices and live stock.
    ----------------------------------------------------- */

    if (
      url.pathname.startsWith("/checkout") ||
      url.pathname.endsWith("/create-payment-intent") ||
      url.pathname.endsWith("/update-payment-intent")
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
      ) ||
      url.pathname.endsWith(
        "/products.js"
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

                    return cache.put(
                      request,
                      copy
                    );

                  }
                )
                .catch(
                  () => {}
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
