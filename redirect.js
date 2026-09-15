/* KRITOR — static-host redirect stub.
   about.html and store.html are thin files GitHub Pages resolves at the
   extensionless URL; each sends the browser on to its real directory.
   data-to on the script tag names the target so one file serves both. */
(function () {
  var to = document.currentScript.getAttribute("data-to");
  if (!to) return;
  location.replace(new URL(to, location.href).href + location.search + location.hash);
})();
