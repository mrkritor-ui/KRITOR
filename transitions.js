/* KRITOR page navigation.
   Native cross-document View Transitions handle modern browsers.
   The fallback is intentionally separate for older iOS/Safari. */
(function () {
  const root = document.documentElement;
  const supportsNative = !!(window.CSS && CSS.supports && CSS.supports("view-transition-name: root"));
  const isAbout = /\/about\.html$/.test(location.pathname);

  if (isAbout) root.classList.add("about-page-document");

  function internal(link) {
    if (!link || !link.href) return false;
    const url = new URL(link.href, location.href);
    return url.origin === location.origin;
  }

  if (supportsNative) {
    window.addEventListener("pagereveal", function (event) {
      if (!event.viewTransition || !window.navigation || !navigation.activation) return;
      const to = navigation.activation.entry && navigation.activation.entry.url;
      if (!to) return;
      const toUrl = new URL(to);
      if (/\/about\.html$/.test(toUrl.pathname)) {
        event.viewTransition.types.add("about-forward");
      } else if (/\/index\.html$/.test(toUrl.pathname) || /\/$/.test(toUrl.pathname)) {
        event.viewTransition.types.add("catalogue-back");
      }
    });
    return;
  }

  /* Older iOS/Safari fallback. The About page itself never animates on load. */
  document.addEventListener("click", function (event) {
    const link = event.target.closest("a");
    if (!link || !internal(link)) return;

    const target = new URL(link.href, location.href);
    const targetIsAbout = /\/about\.html$/.test(target.pathname);
    const targetIsCatalogue = /\/index\.html$/.test(target.pathname) || /\/$/.test(target.pathname);
    const relevant = (!isAbout && targetIsAbout) || (isAbout && targetIsCatalogue);
    if (!relevant) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    if (root.classList.contains("kritor-transitioning")) return;
    root.classList.add("kritor-transitioning");

    if (targetIsCatalogue) {
      /* About -> Catalogue: About leaves left-to-right. */
      root.classList.add("kritor-leaving-about");
      window.setTimeout(function () { location.href = target.href; }, 520);
    } else {
      /* Catalogue -> About: one white sheet, right-to-left. */
      const overlay = document.createElement("div");
      overlay.className = "kritor-transition-overlay";
      document.body.appendChild(overlay);
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { overlay.classList.add("is-visible"); });
      });
      window.setTimeout(function () { location.href = target.href; }, 620);
    }
  }, true);
})();
