/* KRITOR — swaps the print-media font stylesheet to "all" once it has
   actually loaded, so a slow or blocked font host never blocks rendering.
   Used to be an inline onload="this.media='all'" attribute; CSP's script-src
   with no 'unsafe-inline' refuses to run those, so this listener does the
   same job from an external file instead. Must sit right after the <link
   id="font-css"> it targets, so the listener is attached before the
   stylesheet's own load event can fire. */
(function () {
  var link = document.getElementById("font-css");
  if (link) link.addEventListener("load", function () { link.media = "all"; }, {once: true});
})();
