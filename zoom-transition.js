/* KRITOR — grid ↔ work zoom.

   Clicking a tile pushes into the work; going back pulls out of it. The zoom
   grows from the tile you actually clicked rather than the middle of the
   screen, so a work in the bottom-right corner comes towards you from the
   bottom-right instead of sliding across the page first.

   Two paths, same motion:

     * Where the browser supports cross-document view transitions (Chrome 126+,
       Safari 18.2+) the browser animates snapshots of the two pages and this
       file only supplies the direction and the origin, via CSS custom
       properties read by zoom.css.

     * Everywhere else — Firefox, older Safari — the same movement is played
       with the Web Animations API: the outgoing page scales away, navigation
       happens, and the arriving page scales in. Slightly less smooth than the
       native path, but identical in shape and available everywhere.

   The direction is written on the way out and read once on the way in, so a
   reload or a hand-typed URL animates nothing. */
(function () {
  "use strict";

  const KEY = "kritor-zoom";
  const ORIGIN_KEY = "kritor-zoom-origin";

  /* pagereveal ships alongside cross-document view transitions, so it is a
     reliable stand-in for "the browser will animate this navigation for us". */
  const NATIVE = typeof document.startViewTransition === "function" && "onpagereveal" in window;

  const OUT_MS = 340;
  const IN_MS = 460;
  const OUT_EASE = "cubic-bezier(.4, 0, .2, 1)";
  const IN_EASE = "cubic-bezier(.16, 1, .3, 1)";

  const reducedMotion = () =>
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- direction + origin ---------- */

  /* Where on screen the zoom should grow from, as viewport percentages. */
  function originOf(element) {
    if (!element) return null;
    const box = element.getBoundingClientRect();
    if (!box.width || !box.height) return null;
    return {
      x: +(((box.left + box.width / 2) / window.innerWidth) * 100).toFixed(2),
      y: +(((box.top + box.height / 2) / window.innerHeight) * 100).toFixed(2)
    };
  }

  function store(direction, origin) {
    try {
      sessionStorage.setItem(KEY, direction);
      /* Kept separately so the return trip can pull back towards the same tile
         the work grew out of. */
      if (origin) sessionStorage.setItem(ORIGIN_KEY, JSON.stringify(origin));
    } catch (_) {}
  }

  function savedOrigin() {
    try {
      const raw = JSON.parse(sessionStorage.getItem(ORIGIN_KEY) || "null");
      if (raw && Number.isFinite(raw.x) && Number.isFinite(raw.y)) return raw;
    } catch (_) {}
    return null;
  }

  function applyOrigin(origin) {
    const root = document.documentElement;
    const x = `${origin ? origin.x : 50}%`;
    const y = `${origin ? origin.y : 45}%`;
    root.style.setProperty("--kritor-zoom-x", x);
    root.style.setProperty("--kritor-zoom-y", y);
    /* The native path reads the custom properties from the view-transition
       pseudo-elements; the fallback animates this element itself, so it needs
       a real transform-origin as well. */
    root.style.transformOrigin = `${x} ${y}`;
  }

  /* Reads the direction and clears it. Runs from the head, before first paint. */
  function consume() {
    let direction = null;
    try {
      direction = sessionStorage.getItem(KEY);
      sessionStorage.removeItem(KEY);
    } catch (_) {}
    if (direction !== "in" && direction !== "out") return;

    const root = document.documentElement;
    applyOrigin(savedOrigin());
    root.dataset.kritorZoom = direction;

    if (!NATIVE && !reducedMotion()) playArrival(direction);

    /* Drop it once played. Left in place it would also colour the SPA's slide
       between catalogue, store and about. */
    const clear = () => {
      delete root.dataset.kritorZoom;
      root.style.removeProperty("--kritor-zoom-x");
      root.style.removeProperty("--kritor-zoom-y");
      root.style.removeProperty("transform-origin");
    };
    if (NATIVE) {
      window.addEventListener("pagereveal", event => {
        if (event.viewTransition) event.viewTransition.finished.finally(clear);
        else clear();
      }, {once: true});
    }
    setTimeout(clear, Math.max(IN_MS, 1200) + 400);
  }

  /* ---------- the non-native path ---------- */

  function playArrival(direction) {
    const from = direction === "in" ? "scale(.92)" : "scale(1.12)";
    const run = () => {
      document.documentElement.animate(
        [{transform: from, opacity: 0}, {transform: "scale(1)", opacity: 1}],
        {duration: IN_MS, easing: IN_EASE}
      );
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run, {once: true});
    else run();
  }

  /* Plays the outgoing half, then follows the link. Returns true when it has
     taken responsibility for the navigation. */
  function playDeparture(url, direction) {
    if (NATIVE || reducedMotion()) return false;
    const root = document.documentElement;
    const to = direction === "in" ? "scale(1.18)" : "scale(.86)";
    let navigated = false;
    const go = () => { if (!navigated) { navigated = true; window.location.href = url; } };

    const animation = root.animate(
      [{transform: "scale(1)", opacity: 1}, {transform: to, opacity: 0}],
      {duration: OUT_MS, easing: OUT_EASE, fill: "forwards"}
    );
    animation.finished.then(go).catch(go);
    /* Never let a dropped animation frame strand the visitor on a faded page. */
    setTimeout(go, OUT_MS + 250);
    return true;
  }

  /* ---------- link handling ---------- */

  function handle(link, direction, origin) {
    applyOrigin(origin);
    store(direction, origin);
    return playDeparture(link.href, direction);
  }

  function plainClick(event) {
    return !event.defaultPrevented && event.button === 0 &&
      !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
  }

  /* A grid tile going to a work or product page: push in, from that tile. */
  function watchGrid() {
    document.addEventListener("click", event => {
      if (!plainClick(event)) return;
      const link = event.target.closest("a.tile");
      if (!link || (link.target && link.target !== "_self")) return;
      if (handle(link, "in", originOf(link))) event.preventDefault();
    });
  }

  /* The back control on a work or product page: pull out, towards the tile it
     came from. Anything else leaving the page is left alone. */
  function watchDetail() {
    document.addEventListener("click", event => {
      if (!plainClick(event)) return;
      const link = event.target.closest("a");
      if (!link || (link.target && link.target !== "_self")) return;

      if (link.closest(".work-header")) {
        if (handle(link, "out", savedOrigin())) event.preventDefault();
      } else if (link.closest(".similar")) {
        if (handle(link, "in", originOf(link))) event.preventDefault();
      }
    });
  }

  window.addEventListener("popstate", () => store("out", savedOrigin()));

  window.KritorZoom = {consume, originOf, NATIVE};

  consume();

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", attach);
  else attach();

  function attach() {
    if (document.getElementById("grid")) watchGrid();
    if (document.querySelector(".work-header")) watchDetail();
  }
})();
