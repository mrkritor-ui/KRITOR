/* Applies the saved theme before first paint.

   An external file rather than an inline <script> because the checkout carries
   a Content-Security-Policy with no 'unsafe-inline' — and a restyle is not a
   reason to weaken the CSP on the page that takes card details. 'self' already
   allows this, so the same file serves every page. */
(function () {
  try {
    if (localStorage.getItem("kritor-theme") === "dark") {
      document.documentElement.dataset.theme = "dark";
    }
  } catch (e) {}
})();
