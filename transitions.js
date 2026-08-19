/* KRITOR page navigation — single transition controller. */
(function () {
  const root = document.documentElement;
  const isAbout = /\/about\.html$/.test(location.pathname);

  function internal(link) {
    if (!link || !link.href) return false;
    const url = new URL(link.href, location.href);
    return url.origin === location.origin;
  }

  function navigate(link, direction) {
    if (root.classList.contains("kritor-transitioning")) return;
    root.classList.add("kritor-transitioning");

    const sheet = document.createElement("div");
    sheet.className = "kritor-page-sheet kritor-page-sheet--" + direction;
    document.body.appendChild(sheet);

    // Force the initial off-screen position to be committed before starting.
    void sheet.offsetWidth;

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        sheet.classList.add("is-visible");
      });
    });

    // Let the white sheet completely cover the current page before changing documents.
    window.setTimeout(function () {
      window.location.assign(link.href);
    }, 760);
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
    navigate(link, targetIsAbout ? "about" : "catalogue");
  }, true);
})();
