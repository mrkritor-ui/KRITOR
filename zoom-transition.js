/* KRITOR — grid ↔ work transition.

   The artwork itself travels. Click a tile and that image moves and grows into
   its place on the work page; go back and it returns to its square in the grid.
   Everything else — header, titles, the rest of the grid — fades quietly
   underneath.

   This is what makes the movement read as continuous rather than as two pages
   crossfading: there is one object on screen the whole time, and the eye
   follows it. Scaling the whole page instead looks busy, because the text and
   the chrome scale too and nothing holds still.

   How it works: the same `view-transition-name` is put on the tile image on the
   way out and on the hero image on the way in. The browser matches them by name
   across the two documents and animates the geometry between them.

   Needs cross-document view transitions (Chrome 126+, Safari 18.2+). Without
   them the pages simply cross-fade, which is unremarkable but never broken. */
(function () {
  "use strict";

  const NAME = "kritor-work";
  const KEY = "kritor-work-id";

  const NATIVE = typeof document.startViewTransition === "function" && "onpagereveal" in window;

  const reducedMotion = () =>
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- which work is travelling ---------- */

  function remember(id) {
    try { id ? sessionStorage.setItem(KEY, id) : sessionStorage.removeItem(KEY); } catch (_) {}
  }

  function remembered() {
    try { return sessionStorage.getItem(KEY) || ""; } catch (_) { return ""; }
  }

  /* ---------- naming ---------- */

  /* Only one element may carry a given name, so clear before setting. */
  function clearName() {
    document.querySelectorAll("[data-kritor-named]").forEach(el => {
      el.style.viewTransitionName = "";
      delete el.dataset.kritorNamed;
    });
  }

  function name(element) {
    if (!element) return false;
    clearName();
    element.style.viewTransitionName = NAME;
    element.dataset.kritorNamed = "true";
    return true;
  }

  /* The <img> inside a tile, not the tile itself: the tile is a padded square
     and the picture inside it is what the eye is actually following. */
  function tileImage(id) {
    if (!id) return null;
    const tile = document.querySelector(`.tile[data-work-id="${CSS.escape(id)}"]`);
    return tile ? tile.querySelector("img") : null;
  }

  function heroImage() {
    return document.querySelector(".art-wrap img.art");
  }

  /* ---------- leaving ---------- */

  function watchGrid() {
    document.addEventListener("click", event => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const tile = event.target.closest("a.tile");
      if (!tile || (tile.target && tile.target !== "_self")) return;

      remember(tile.dataset.workId || "");
      if (NATIVE && !reducedMotion()) name(tile.querySelector("img"));
    });
  }

  function watchDetail() {
    document.addEventListener("click", event => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target.closest("a");
      if (!link || (link.target && link.target !== "_self")) return;

      /* Going back to the grid: the hero is what shrinks into the tile. */
      if (link.closest(".work-header")) {
        if (NATIVE && !reducedMotion()) name(heroImage());
        return;
      }
      /* Another work in the same series: that thumbnail leads. */
      if (link.closest(".similar")) {
        const match = link.getAttribute("href").match(/(work-[A-Za-z0-9_-]+)/);
        remember(match ? match[1] : "");
        if (NATIVE && !reducedMotion()) name(link.querySelector("img"));
      }
    });
  }

  /* ---------- arriving ---------- */

  /* Runs before the browser captures the incoming snapshot, so the name has to
     be in place by the time this returns. */
  function onReveal(event) {
    if (!event.viewTransition || reducedMotion()) return;
    const target = heroImage() || tileImage(remembered());
    if (!name(target)) return;
    /* Once the transition is done the name must go, or the element stays
       promoted to its own layer for the rest of the page's life. */
    event.viewTransition.finished.finally(clearName);
  }

  if (NATIVE) window.addEventListener("pagereveal", onReveal);

  /* A cancelled navigation would otherwise leave the tile named. */
  window.addEventListener("pageshow", clearName);

  window.KritorZoom = {NATIVE, name, clearName, tileImage, heroImage};

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", attach);
  else attach();

  function attach() {
    if (document.getElementById("grid")) watchGrid();
    if (document.querySelector(".work-header")) watchDetail();
  }
})();
