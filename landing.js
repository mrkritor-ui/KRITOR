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
  });
})();
