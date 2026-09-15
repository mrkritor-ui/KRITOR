/* KRITOR — service worker registration.
   Pulled out of the page so script-src can be 'self' with no 'unsafe-inline'. */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("/sw.js").catch(function () {});
  });
}
