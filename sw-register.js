/* Registers the service worker.

   An external file rather than the inline <script> every page used to carry:
   the Content-Security-Policy on the public pages allows scripts from this
   origin and from the Google tag, and nothing written into the HTML itself. */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("/sw.js").catch(function () {});
  });
}
