/* KRITOR — the landing door.

   ART and STORE are real <a> links, so a click still goes exactly where its
   href says if this never runs. Where it does run: the row that asked slides
   off, the bar's loading row takes its place and fills, and then the browser
   is sent on — the same fill-then-arrive pacing the store's own warp uses
   (see WARP_MS in boot-scene.js), just without a scene in front of it. */
(function () {
  "use strict";

  const FILL_MS = 1400;
  const OUT_MS = 220;

  const menuOptions = document.getElementById("menu-options");
  const loadingRow = document.getElementById("loading-row");
  const loadingFill = document.getElementById("loading-fill");

  if (!menuOptions || !loadingRow || !loadingFill) return;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let leaving = false;

  function go(url) {
    if (leaving) return;
    leaving = true;

    menuOptions.querySelectorAll("a, button").forEach(el => {
      el.setAttribute("tabindex", "-1");
      if ("disabled" in el) el.disabled = true;
    });
    menuOptions.classList.add("is-leaving");

    const arrive = () => { window.location.href = url; };

    setTimeout(() => {
      menuOptions.hidden = true;
      loadingRow.hidden = false;

      if (reduceMotion) { arrive(); return; }

      void loadingRow.offsetWidth;
      loadingRow.classList.add("is-in");

      const started = performance.now();
      const frame = now => {
        const scripted = Math.min(1, (now - started) / FILL_MS);
        /* Quantised the same way the rest of the bar's loading fills are —
           a terminal fills a bar in characters, not pixels. */
        loadingFill.style.width = (Math.round(scripted * 32) / 32 * 100) + "%";
        if (scripted >= 1) { arrive(); return; }
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
