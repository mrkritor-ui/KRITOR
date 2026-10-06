/* KRITOR — the Google tag (GA4).

   Google's install snippet is an async loader plus four lines of inline
   script that every page is meant to carry its own copy of. Seven pages and
   one measurement ID is how an ID ends up changed in six of them, so the
   snippet lives here once and each page loads this file — the same shape as
   theme-boot.js, and for the same reason it is a file rather than inline
   script: the checkout's Content-Security-Policy has no 'unsafe-inline'.

   The checkout deliberately does not load this. That page takes card details
   under a policy whose script-src names Stripe and nothing else, and naming a
   second third party there is a trade to make on purpose, not as a side
   effect of adding analytics.

   Enhanced measurement (on by default for a web stream) already reports a
   page view for every history.pushState, so opening a work in the catalogue,
   which pushes /work-xx/, is counted without anything here knowing about it. */
(function () {
  "use strict";

  var ID = "G-TWSMKP8JZ3";

  /* Nobody's real visit: a local server, or a build being looked at. Counting
     them would put the artist's own testing in the numbers. */
  if (/^(localhost|127\.|\[::1\])/.test(location.hostname)) return;

  window.dataLayer = window.dataLayer || [];
  /* Google's own definition, and it has to push `arguments` — gtag.js tells a
     command from a plain array by what it was pushed as. */
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;

  gtag("js", new Date());
  gtag("config", ID);

  var loader = document.createElement("script");
  loader.async = true;
  loader.src = "https://www.googletagmanager.com/gtag/js?id=" + ID;
  document.head.appendChild(loader);
})();
