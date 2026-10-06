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

   Consent. The shop sends to twelve countries, five of them in the EU, and
   Google asks for Consent Mode wherever visitors from the EEA, the UK or
   Switzerland can arrive. There is no banner on a pixel-terminal and nothing
   here would use one: for those regions analytics_storage starts, and stays,
   denied — GA4 then sets no cookies and sends only anonymous pings with no
   identifier. Everywhere else analytics runs normally. Advertising storage and
   the two ad signals are denied for everyone, and Google signals are switched
   off, because the site runs no advertising and has no use for them. If a
   consent control is ever added, a grant is one gtag("consent", "update", …)
   call away. /privacy/ says all of this in words; keep the two in step.

   Enhanced measurement (on by default for a web stream) already reports a
   page view for every history.pushState, so opening a work in the catalogue,
   which pushes /work-xx/, is counted without anything here knowing about it. */
(function () {
  "use strict";

  var ID = "G-TWSMKP8JZ3";

  /* Nobody's real visit: a local server, or a build being looked at. Counting
     them would put the artist's own testing in the numbers. */
  if (/^(localhost|127\.|\[::1\])/.test(location.hostname)) return;

  /* The European Economic Area, the United Kingdom and Switzerland. */
  var CONSENT_REGIONS = [
    "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IS", "IE", "IT",
    "LV", "LI", "LT", "LU", "MT", "NL", "NO", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "GB", "CH"
  ];

  window.dataLayer = window.dataLayer || [];
  /* Google's own definition, and it has to push `arguments` — gtag.js tells a
     command from a plain array by what it was pushed as. */
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;

  /* Order matters: the regional default first, then the one for everywhere
     else, both before anything is configured or measured. */
  gtag("consent", "default", {
    ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied",
    analytics_storage: "denied",
    region: CONSENT_REGIONS
  });
  gtag("consent", "default", {
    ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied"
  });

  gtag("js", new Date());
  gtag("config", ID, { allow_google_signals: false, allow_ad_personalization_signals: false });

  var loader = document.createElement("script");
  loader.async = true;
  loader.src = "https://www.googletagmanager.com/gtag/js?id=" + ID;
  document.head.appendChild(loader);
})();
