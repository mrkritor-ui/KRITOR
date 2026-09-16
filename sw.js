/* KRITOR — the service worker.

   This used to be network-first for everything, which meant the cache was only
   ever an offline fallback: every repeat visit re-downloaded the whole site,
   and the worker itself added a hop to each request for the privilege. The
   cache now answers what it can, and the strategy is chosen per request rather
   than once for all of them.

   The deploy stamps one version string into both this file and every asset URL
   in the HTML (see .github/workflows/pages.yml). That single fact decides
   everything below: an asset carrying ?v= is immutable, because a change to it
   ships under a different URL, so it can be served from the cache without
   asking the network whether it is still current. The previous precache list
   missed this — it stored "/terminal.css" while every page asked for
   "/terminal.css?v=<version>", so not one precached file was ever served. */

const VERSION = "__BUILD_VERSION__";

/* Three buckets, because they have three different lifetimes.

   Shell and runtime are per-deploy: their contents are versioned URLs, and
   once a new version ships the old ones are unreachable, so the whole bucket
   goes. Renditions are not — derived/ filenames carry a hash of their source
   image, so a deploy that did not touch a painting leaves that painting's
   renditions at exactly the same URL. Keeping them in a bucket of their own is
   what stops every deploy from re-downloading the entire catalogue. */
const SHELL = `kritor-shell-${VERSION}`;
const RUNTIME = `kritor-runtime-${VERSION}`;
const RENDITIONS = "kritor-renditions-v1";

const KEEP = [SHELL, RUNTIME, RENDITIONS];

/* Renditions accumulate across deploys by design, so this is the one bucket
   that needs a ceiling. Roughly a full catalogue at every width and format. */
const RENDITION_LIMIT = 400;

/* What a cold start of the front door and the catalogue actually needs, at the
   URLs the pages actually ask for. Everything here is same-origin and small;
   the paintings are not in this list, because they arrive through the grid's
   own lazy loading and belong in the renditions bucket. */
const SHELL_FILES = [
  "/",
  "/art/",
  "/type.css",
  "/terminal.css",
  "/landing.css",
  "/cursor.css",
  "/cursor.js",
  "/theme-boot.js",
  "/landing.js",
  "/pixel-fx.js",
  "/boot-scene.js",
  "/terminal-shell.js",
  "/terminal.js",
  "/tile-image.js",
  "/artworks.js",
].map(path => (path.endsWith("/") ? path : `${path}?v=${VERSION}`));

/* Not versioned, and not wanted in a versioned bucket either: the face and the
   boot footage are byte-identical from one deploy to the next, so they are
   fetched under their own plain URLs and kept in the renditions bucket where a
   deploy cannot evict them.

   font-display is block, so a page served from the cache without the face
   waits with nothing drawn at all — which is why it is precached rather than
   left to be discovered. */
const STABLE_FILES = [
  "/fonts/pix-chicago.woff2",
  "/tiger-loader-frames.webp",
  /* The mark, in the three forms the pages ask for it. Here rather than in the
     shell list above because every page references these unstamped — a
     precache of "/icon.png?v=…" would store a URL nothing ever requests, which
     is the exact failure the old worker had for its whole list. */
  "/favicon.ico",
  "/icon.svg",
  "/icon.png",
];

const IMMUTABLE_PREFIXES = ["/derived/", "/derived-1bit/"];

/* The catalogue database and the price list. Everything else on the site is
   immutable at its URL; these two are the only files where being a deploy
   behind means showing a work that is gone or a price that is wrong. */
const LIVE_DATA = /\/(artworks|products)\.js$|\/products\.json$/;

const STATIC_TYPES = /\.(css|js|png|jpe?g|gif|svg|webp|avif|woff2?|json|usdz)$/i;

const FONT_HOSTS = /^fonts\.(googleapis|gstatic)\.com$/;

/* ── Install / activate ─────────────────────────────────────────────────── */

/* One at a time rather than addAll, which rejects the whole batch if a single
   file 404s — one stale path in the list above should cost that one file, not
   the entire worker. */
function addAllSettled(cache, urls) {
  return Promise.all(urls.map(url => cache.add(url).catch(() => {})));
}

self.addEventListener("install", event => {
  event.waitUntil(
    Promise.all([
      caches.open(SHELL).then(cache => addAllSettled(cache, SHELL_FILES)),
      caches.open(RENDITIONS).then(cache => addAllSettled(cache, STABLE_FILES)),
    ]).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key.startsWith("kritor-") || key.startsWith("works-gallery-"))
          .filter(key => !KEEP.includes(key))
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

/* ── Cache helpers ──────────────────────────────────────────────────────── */

/* Oldest first: Cache.keys() returns insertion order, so dropping from the
   front evicts the renditions least recently written. */
function trim(cacheName, limit) {
  return caches.open(cacheName).then(cache =>
    cache.keys().then(keys => {
      if (keys.length <= limit) return;
      return Promise.all(keys.slice(0, keys.length - limit).map(key => cache.delete(key)));
    })
  );
}

/* An opaque response (status 0) is a cross-origin fetch made without CORS —
   the Google font files. It is storable and replayable even though its body
   cannot be read here, so it is worth keeping; a failed one is not, and there
   is no way to tell the two apart, which is why only the font hosts get this
   benefit of the doubt. */
function storable(response, url) {
  if (!response) return false;
  if (response.status === 200) return true;
  return response.type === "opaque" && FONT_HOSTS.test(url.hostname);
}

function put(cacheName, request, response, limit) {
  return caches.open(cacheName)
    .then(cache => cache.put(request, response))
    .then(() => (limit ? trim(cacheName, limit) : undefined))
    .catch(() => {});
}

/* Served from the cache the moment there is a copy, and the network is not
   consulted at all. Only ever given a URL that cannot change under its own
   name — a versioned asset, a hashed rendition, the face. */
function cacheFirst(event, cacheName, limit) {
  const request = event.request;
  const url = new URL(request.url);
  return caches.match(request).then(cached => {
    if (cached) return cached;
    return fetch(request).then(response => {
      if (storable(response, url)) put(cacheName, request, response.clone(), limit);
      return response;
    });
  });
}

/* The cached copy now, the network's copy for next time. The right trade for
   anything static that is not versioned: nobody waits on the network, and the
   page is at most one visit behind. */
function staleWhileRevalidate(event, cacheName, limit) {
  const request = event.request;
  const url = new URL(request.url);
  return caches.match(request).then(cached => {
    const fresh = fetch(request).then(response => {
      if (storable(response, url)) put(cacheName, request, response.clone(), limit);
      return response;
    }).catch(() => cached);

    if (cached) {
      /* The page is already being answered, so the revalidation has to be
         kept alive past the response or the worker can be killed mid-fetch
         and the cache never updates. The event is still active here — this
         runs before the promise given to respondWith settles — but a browser
         that disagrees should cost the revalidation, not the response. */
      try { event.waitUntil(fresh.catch(() => {})); } catch (e) {}
      return cached;
    }
    return fresh;
  });
}

/* Fresh or nothing, with the cache as the safety net. For the documents and
   the two data files, where being a deploy behind is the failure. */
function networkFirst(event, cacheName, fallback) {
  const request = event.request;
  const url = new URL(request.url);
  return fetch(request).then(response => {
    if (storable(response, url)) put(cacheName, request, response.clone());
    return response;
  }).catch(() =>
    caches.match(request).then(cached =>
      cached || (fallback ? caches.match(fallback) : undefined) || Response.error()
    )
  );
}

/* ── Routing ────────────────────────────────────────────────────────────── */

function bypassed(request, url) {
  if (request.method !== "GET") return true;
  if (url.protocol !== "http:" && url.protocol !== "https:") return true;
  if (url.hostname === "api.github.com") return true;

  /* Checkout runs on js.stripe.com scripts, api.stripe.com calls and
     cross-origin payment iframes. Serving any of those from a cache breaks the
     payment session, and a stale one can fail a real charge. */
  if (url.hostname === "js.stripe.com" || url.hostname === "api.stripe.com") return true;
  if (url.hostname.endsWith(".stripe.com") || url.hostname.endsWith(".stripe.network")) return true;

  /* The checkout page and the payment worker must reflect live prices and live
     stock, every time. */
  if (url.pathname.startsWith("/checkout")) return true;
  if (url.pathname.endsWith("/create-payment-intent")) return true;
  if (url.pathname.endsWith("/update-payment-intent")) return true;

  return false;
}

function immutable(url) {
  if (url.searchParams.has("v")) return true;
  if (IMMUTABLE_PREFIXES.some(prefix => url.pathname.startsWith(prefix))) return true;
  if (url.pathname.startsWith("/fonts/")) return true;
  if (url.pathname.endsWith("-loader-frames.webp")) return true;
  return false;
}

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);

  if (bypassed(request, url)) return;

  const sameOrigin = url.origin === self.location.origin;

  /* The Google-hosted heading faces. Cached so the second visit does not wait
     on a third party, and revalidated in the background so a change to the
     served face still arrives. */
  if (!sameOrigin) {
    if (FONT_HOSTS.test(url.hostname)) {
      event.respondWith(staleWhileRevalidate(event, RENDITIONS, RENDITION_LIMIT));
    }
    return;
  }

  /* A page. Always tried on the network first, so a deploy is live the moment
     it lands, with the cached copy behind it for a dead connection. */
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(event, SHELL, "/"));
    return;
  }

  if (LIVE_DATA.test(url.pathname)) {
    event.respondWith(networkFirst(event, RUNTIME));
    return;
  }

  /* A hashed rendition of a painting. Immutable, and kept out of the
     per-deploy buckets so a deploy does not cost the catalogue again. */
  if (IMMUTABLE_PREFIXES.some(prefix => url.pathname.startsWith(prefix))) {
    event.respondWith(cacheFirst(event, RENDITIONS, RENDITION_LIMIT));
    return;
  }

  if (immutable(url)) {
    event.respondWith(cacheFirst(event, RUNTIME));
    return;
  }

  if (STATIC_TYPES.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(event, RUNTIME));
    return;
  }
});
