/* KRITOR — responsive image lookup.

   Resolves a work's or a shop item's image to one of the renditions
   tools/build-images.py wrote at deploy time (IMAGE_MANIFEST), so a phone
   fetches a rendition sized for what it is showing rather than the
   multi-megabyte original: the tiles' colour layer, the bag lines, the work
   panel's main image.

   This file used to build a whole <picture> too — AVIF and WebP srcsets and an
   inline blur placeholder — for the grid, back when the grid showed real
   photographs. It shows 1-bit renditions now (terminal-manifest.js) and the
   photograph arrives only underneath them, one URL at a time, which is all
   pick() is for.

   If the manifest is missing — someone opened the repo without running the
   build — pick() falls back to the original, so a page is never broken by a
   missing build step. */
(function () {
  "use strict";

  function manifest() {
    return typeof IMAGE_MANIFEST !== "undefined" ? IMAGE_MANIFEST : null;
  }

  function lookup(path) {
    const all = manifest();
    if (!all || !path) return null;
    return all[path] || all[path.replace(/^\//, "")] || null;
  }

  function rooted(url) {
    return url.startsWith("/") || /^https?:/.test(url) ? url : "/" + url;
  }

  /* The smallest rendition at least `targetWidth` wide. Falls back to the
     original. */
  function pick(path, targetWidth) {
    const entry = lookup(path);
    if (!entry || !entry.webp || !entry.webp.length) return encodeURI(rooted(path || ""));
    const wanted = targetWidth || 480;
    const match = entry.webp.find(v => v.w >= wanted) || entry.webp[entry.webp.length - 1];
    return encodeURI(rooted(match.url));
  }

  window.KritorTileImage = {pick};
})();
