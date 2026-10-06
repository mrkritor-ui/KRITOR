/* Applies the saved theme before first paint.

   An external file rather than an inline <script> because the checkout carries
   a Content-Security-Policy with no 'unsafe-inline' — and a restyle is not a
   reason to weaken the CSP on the page that takes card details. 'self' already
   allows this, so the same file serves every page. */
(function () {
  /* The browser's own chrome — the address bar on a phone, the title bar of an
     installed app — takes its colour from <meta name="theme-color">, which is
     paper in the markup. On a dark-theme visit that was a pale bar over a
     near-black page. A page opts in by giving the tag a data-dark colour; the
     shopfront and the checkout, which keep their own, do not. */
  function paintChrome(theme) {
    var meta = document.querySelector('meta[name="theme-color"][data-dark]');
    if (!meta) return;
    if (!meta.hasAttribute("data-paper")) meta.setAttribute("data-paper", meta.getAttribute("content"));
    meta.setAttribute("content", meta.getAttribute(theme === "dark" ? "data-dark" : "data-paper"));
  }
  window.KritorTheme = { paintChrome: paintChrome };

  try {
    if (localStorage.getItem("kritor-theme") === "dark") {
      document.documentElement.dataset.theme = "dark";
      paintChrome("dark");
    }
  } catch (e) {}
})();
