/* KRITOR page navigation.
   Native cross-document View Transitions handle supported browsers.
   The fallback preloads a complete About page before moving it. */
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
      /* About -> Catalogue: the already-rendered About page leaves right. */
      root.classList.add("kritor-leaving-about");
      window.setTimeout(function () { location.href = target.href; }, 680);
      return;
    }

    /* Catalogue -> About: preload the actual About document off-screen,
       then slide that complete rendered document across the viewport. */
    const sheet = document.createElement("div");
    sheet.className = "kritor-about-sheet";

    const frame = document.createElement("iframe");
    frame.src = target.href;
    frame.title = "About KRITOR";
    frame.setAttribute("aria-hidden", "true");
    frame.loading = "eager";
    sheet.appendChild(frame);
    document.body.appendChild(sheet);

    let started = false;
    const start = function () {
      if (started) return;
      started = true;
      requestAnimationFrame(function () {
        sheet.classList.add("is-visible");
      });
      window.setTimeout(function () { location.href = target.href; }, 700);
    };

    frame.addEventListener("load", start, { once: true });
    window.setTimeout(start, 2500);
  }, true);
})();
