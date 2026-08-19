/* KRITOR shared navigation transitions.
   Modern browsers use native cross-document View Transitions.
   Older browsers get a lightweight CSS fallback. */
(function () {
  const supportsCrossDocumentTransitions =
    !!window.CSS && CSS.supports && CSS.supports("view-transition-name: root");

  const isAboutPage = !!document.querySelector(".about-page");
  if (isAboutPage) document.documentElement.classList.add("about-page-document");

  function isInternalNavigation(link) {
    if (!link || !link.href) return false;
    const url = new URL(link.href, location.href);
    return url.origin === location.origin;
  }

  function fallbackNavigate(link, direction) {
    if (!isInternalNavigation(link)) return;

    const target = link.href;
    if (direction === "back") {
      document.documentElement.classList.add("kritor-fallback-leaving");
      window.setTimeout(function () {
        window.location.href = target;
      }, 520);
      return;
    }

    const overlay = document.createElement("div");
    overlay.className = "kritor-fallback-transition";
    document.body.appendChild(overlay);

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        overlay.classList.add("is-active");
      });
    });

    window.setTimeout(function () {
      window.location.href = target;
    }, 620);
  }

  /* Capture before the legacy navigation handlers in script.js/about.html.
     We let the browser perform the normal navigation when native transitions exist. */
  document.addEventListener("click", function (event) {
    const link = event.target.closest("a");
    if (!link || !isInternalNavigation(link)) return;

    const href = new URL(link.href, location.href);
    const currentPath = location.pathname.replace(/\/$/, "");
    const targetPath = href.pathname.replace(/\/$/, "");

    const goingToAbout = targetPath.endsWith("/about.html");
    const goingToCatalogue = targetPath.endsWith("/index.html") || targetPath === "";

    if (!((!isAboutPage && goingToAbout) || (isAboutPage && goingToCatalogue))) return;

    /* Stop the old custom handlers from creating their own transition. */
    event.stopImmediatePropagation();

    if (supportsCrossDocumentTransitions) {
      /* Do not preventDefault: native MPA View Transition handles the navigation. */
      return;
    }

    event.preventDefault();
    fallbackNavigate(link, isAboutPage ? "back" : "forward");
  }, true);
})();
