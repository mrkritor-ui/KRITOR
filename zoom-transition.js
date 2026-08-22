/* KRITOR — grid ↔ work zoom.

   Clicking a tile zooms the grid in and dissolves to the work; going back
   reverses it, the work shrinking away as the grid settles into place.

   This rides the browser's cross-document View Transition API, so the two
   documents are real pages and the browser animates between their snapshots.
   All this file does is tell the arriving page which direction it was entered
   from, because a transition looks wrong played backwards.

   The flag is written on the way out and read — once — on the way in, so a
   plain reload or a link typed by hand animates nothing.

   Browsers without cross-document view transitions simply navigate, which is
   what they do today. Nothing here is required for the page to work. */
(function () {
  "use strict";

  const KEY = "kritor-zoom";

  /* Marks the direction for the page about to load. */
  function signal(direction) {
    try { sessionStorage.setItem(KEY, direction); } catch (_) {}
  }

  /* Reads and clears it. Runs before first paint, from the document head. */
  function consume() {
    let direction = null;
    try {
      direction = sessionStorage.getItem(KEY);
      sessionStorage.removeItem(KEY);
    } catch (_) {}
    if (direction !== "in" && direction !== "out") return;
    const root = document.documentElement;
    root.dataset.kritorZoom = direction;

    /* Drop it once the transition has played. Left in place it would also
       apply to the SPA's own slide between catalogue, store and about. */
    const clear = () => delete root.dataset.kritorZoom;
    if (document.startViewTransition && "onpagereveal" in window) {
      window.addEventListener("pagereveal", event => {
        if (event.viewTransition) event.viewTransition.finished.finally(clear);
        else clear();
      }, {once: true});
    }
    setTimeout(clear, 1500);
  }

  /* A grid tile going to a work or product page: zoom in. */
  function watchGrid() {
    document.addEventListener("click", event => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target.closest("a.tile");
      if (!link || (link.target && link.target !== "_self")) return;
      signal("in");
    }, true);
  }

  /* The back control on a work or product page: zoom out. Anything else
     leaving the page — the bag, a series work — is left alone. */
  function watchDetail() {
    document.addEventListener("click", event => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target.closest("a");
      if (!link || (link.target && link.target !== "_self")) return;
      if (link.closest(".work-header")) signal("out");
      else if (link.closest(".similar")) signal("in");
    }, true);
  }

  /* Back/forward should feel like going back, not like a fresh click. */
  window.addEventListener("popstate", () => signal("out"));

  window.KritorZoom = {signal, consume, watchGrid, watchDetail};

  consume();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attach);
  } else {
    attach();
  }

  function attach() {
    if (document.getElementById("grid")) watchGrid();
    if (document.querySelector(".work-header")) watchDetail();
  }
})();
