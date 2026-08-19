/* KRITOR page navigation.
   Native cross-document View Transitions are the primary path.
   The CSS fallback is deliberately simple and reliable for older Safari/iOS. */
(function () {
  const supportsNative = !!(document.startViewTransition ||
    (CSS && CSS.supports && CSS.supports("view-transition-name: root")));

  const aboutPage = !!document.querySelector(".about-page");
  if (aboutPage) document.documentElement.classList.add("about-page-document");

  function internal(link) {
    if (!link || !link.href) return false;
    const url = new URL(link.href, location.href);
    return url.origin === location.origin;
  }

  document.addEventListener("click", function (event) {
    const link = event.target.closest("a");
    if (!link || !internal(link)) return;

    const target = new URL(link.href, location.href);
    const targetIsAbout = target.pathname.endsWith("/about.html");
    const targetIsCatalogue = target.pathname.endsWith("/index.html") || target.pathname.endsWith("/");
    const relevant = (!aboutPage && targetIsAbout) || (aboutPage && targetIsCatalogue);
    if (!relevant) return;

    /* Native MPA View Transitions: leave navigation completely alone. */
    if (supportsNative) return;

    /* Old browsers: animate a real overlay, then navigate. */
    event.preventDefault();
    event.stopImmediatePropagation();
    if (document.documentElement.classList.contains("kritor-transitioning")) return;
    document.documentElement.classList.add("kritor-transitioning");

    if (aboutPage) {
      document.documentElement.classList.add("kritor-leaving-about");
      setTimeout(function () { location.href = target.href; }, 520);
    } else {
      const overlay = document.createElement("div");
      overlay.className = "kritor-transition-overlay";
      document.body.appendChild(overlay);
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { overlay.classList.add("is-visible"); });
      });
      setTimeout(function () { location.href = target.href; }, 620);
    }
  }, true);
})();
