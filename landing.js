/* KRITOR — the landing door.

   ART and STORE are real <a> links, so a click still goes exactly where its
   href says if this never runs. Where it does run: the row that asked slides
   off, the bar's loading row takes its place and fills — and the tiger
   behind both of them, held open since the page arrived, closes its eyes.
   The browser is only ever sent on once that close is actually done, the
   same real-footage-backwards close tigerEyes() plays for anything that
   asks it to leave, so the cut to whatever comes next always lands on a
   blink rather than mid-motion. A page where pixel-fx.js never loaded — a
   slow connection, a blocked script — has no tiger to wait on and falls
   back to the bar's own fill alone, same as before this existed. */
(function () {
  "use strict";

  const FILL_MS = 1400;
  const OUT_MS = 220;

  /* ── Warming the room you are about to walk into ───────────────────────── */

  /* Everything below this comment is about a second and a half of nothing.
     A click here does not navigate: the option row slides off, the bar fills,
     the tiger closes its eyes, and only once all of that is done is the
     browser finally told where to go — at which point it starts, from cold,
     on a page that needs a stylesheet, five scripts, two manifests and a
     sheet of footage before it can show anything. The animation and the
     loading used to happen one after the other. They happen at the same time
     now, and the animation is the only part anybody waits for.

     Nothing here changes what is on screen or when. It is only ever fetching,
     at prefetch priority, things this page already knows will be asked for. */

  /* Asset URLs carry the deploy's version stamp, and the destination will ask
     for them at exactly those URLs — a prefetch of the unstamped path would
     warm a file nobody then requests. landing.js is static and cannot know the
     stamp, so it reads it off one of this page's own tags. */
  const VERSION = (function () {
    const tag = document.querySelector('script[src*="?v="], link[href*="?v="]');
    const match = tag && String(tag.src || tag.href).match(/[?&]v=([^&]*)/);
    return match ? match[1] : "";
  })();

  const stamp = path => (VERSION ? path + "?v=" + VERSION : path);

  /* Already in this page's own <head>, so already in the cache: terminal.css,
     pixel-fx.js, cursor.*, theme-boot.js, type.css. What is listed here is
     only what all three rooms need and this page does not have. */
  const SHARED = ["/boot-scene.js", "/terminal-shell.js", "/tile-image.js",
                  "/image-manifest.js", "/terminal-manifest.js"];

  const PER_ROOM = {
    "/art/": ["/terminal.js", "/artworks.js"],
    "/architecture/": ["/terminal.js"],
    /* The store flies in on the globe, which pixel-fx.js draws rather than
       plays from a sheet, so there is no footage to fetch for it. */
    "/store/": ["/terminal-store.js", "/products.js", "/cart.js"],
  };

  /* The boot footage, which is the largest single thing either door loads.
     Deliberately not stamped: pixel-fx.js and the destination's own preload
     both ask for it under its plain name, and a prefetch of a different URL
     is bytes spent warming a cache entry nobody then reads. */
  const ROOM_FOOTAGE = {
    "/art/": "/art-loader-frames.webp",
    "/architecture/": "/architecture-loader-frames.webp",
  };

  const warmed = new Set();

  function warm(href) {
    if (!href || warmed.has(href)) return;
    warmed.add(href);
    const link = document.createElement("link");
    link.rel = "prefetch";
    link.href = href;
    document.head.appendChild(link);
  }

  function warmRoom(path) {
    warm(path);
    warm(ROOM_FOOTAGE[path]);
    (PER_ROOM[path] || []).forEach(asset => warm(stamp(asset)));
  }

  /* A visitor who is only reading the door still pays for this, so it waits
     for the browser to have nothing better to do and asks for the shared half
     only — the part that is the same whichever of the three is chosen. */
  const warmShared = () => SHARED.forEach(asset => warm(stamp(asset)));
  if (window.requestIdleCallback) window.requestIdleCallback(warmShared, {timeout: 3000});
  else window.addEventListener("load", () => setTimeout(warmShared, 1200));

  const menuOptions = document.getElementById("menu-options");
  const loadingRow = document.getElementById("loading-row");
  const loadingFill = document.getElementById("loading-fill");
  const bootStage = document.getElementById("boot-fx");

  if (!menuOptions || !loadingRow || !loadingFill) return;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let leaving = false;

  /* Mounted immediately — the eyes start opening the moment the page does,
     not once something is clicked. Guarded the way every other scene on
     this site guards window.KritorFX: nothing here breaks if pixel-fx.js
     hasn't run yet, it just leaves the door blank. */
  const tiger = bootStage && window.KritorFX ? window.KritorFX.tigerEyes(bootStage) : null;

  function go(url) {
    if (leaving) return;
    leaving = true;

    /* The one moment this is certain rather than a guess, and there is a
       second and a half of animation left to do it in. A pointer that hovered
       first has already started; a keyboard or a finger starts here. */
    warmRoom(url);

    menuOptions.querySelectorAll("a, button").forEach(el => {
      el.setAttribute("tabindex", "-1");
      if ("disabled" in el) el.disabled = true;
    });
    menuOptions.classList.add("is-leaving");

    const arrive = () => { window.location.href = url; };

    /* The eyes start closing the instant the click registers, in parallel
       with the bar's own leaving row rather than after it — waiting for
       both is what a "hard cut" means here: neither one alone decides when
       the browser moves, the slower of the two does. */
    const closed = tiger ? tiger.close() : Promise.resolve();

    setTimeout(() => {
      menuOptions.hidden = true;
      loadingRow.hidden = false;

      if (reduceMotion) { closed.then(arrive); return; }

      void loadingRow.offsetWidth;
      loadingRow.classList.add("is-in");

      const started = performance.now();
      const frame = now => {
        const scripted = Math.min(1, (now - started) / FILL_MS);
        /* Quantised the same way the rest of the bar's loading fills are —
           a terminal fills a bar in characters, not pixels. */
        loadingFill.style.width = (Math.round(scripted * 32) / 32 * 100) + "%";
        if (scripted >= 1) { closed.then(arrive); return; }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    }, reduceMotion ? 0 : OUT_MS);
  }

  menuOptions.querySelectorAll("a[data-nav]").forEach(link => {
    link.addEventListener("click", event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      go(link.dataset.nav);
    });

    /* Reaching for one of three doors is a good enough answer about which one
       is wanted, and it buys the room the whole time the hand is moving.
       Passive: this only ever starts a fetch. */
    const intent = () => warmRoom(link.dataset.nav);
    link.addEventListener("pointerenter", intent, {passive: true});
    link.addEventListener("focus", intent);
    link.addEventListener("touchstart", intent, {passive: true});
  });
})();
