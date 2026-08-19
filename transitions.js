/* KRITOR page navigation.
   One mechanism is used on all browsers: preload the destination page
   in a same-origin iframe, wait until it is actually rendered, then slide
   that rendered page across the viewport. This prevents late text appearing. */
(function () {
  const root = document.documentElement;
  const isAbout = /\/about\.html$/.test(location.pathname);

  function internal(link) {
    if (!link || !link.href) return false;
    const url = new URL(link.href, location.href);
    return url.origin === location.origin;
  }

  function waitUntilRendered(frame) {
    return new Promise(function (resolve) {
      function finish() {
        const doc = frame.contentDocument;
        if (!doc) return resolve();
        const fonts = doc.fonts && doc.fonts.ready ? doc.fonts.ready : Promise.resolve();
        fonts.then(function () {
          requestAnimationFrame(function () {
            requestAnimationFrame(resolve);
          });
        }, resolve);
      }
      if (frame.contentDocument && frame.contentDocument.readyState === "complete") {
        finish();
      } else {
        frame.addEventListener("load", finish, { once: true });
      }
    });
  }

  function navigateWithPageSheet(target, direction) {
    if (root.classList.contains("kritor-transitioning")) return;
    root.classList.add("kritor-transitioning");

    const sheet = document.createElement("div");
    sheet.className = "kritor-page-sheet kritor-page-sheet--" + direction;

    const frame = document.createElement("iframe");
    frame.src = target.href;
    frame.title = direction === "about" ? "About KRITOR" : "KRITOR catalogue";
    frame.setAttribute("aria-hidden", "true");
    frame.loading = "eager";
    sheet.appendChild(frame);
    document.body.appendChild(sheet);

    let done = false;
    function start() {
      if (done) return;
      done = true;
      requestAnimationFrame(function () {
        sheet.classList.add("is-visible");
      });
      window.setTimeout(function () {
        location.href = target.href;
      }, 760);
    }

    waitUntilRendered(frame).then(start);
    /* Never leave the user stuck if an embedded resource hangs. */
    window.setTimeout(start, 5000);
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

    if (targetIsAbout) {
      /* Catalogue -> About: About is completely rendered before it moves. */
      navigateWithPageSheet(target, "about");
    } else {
      /* About -> Catalogue: catalogue is completely rendered before it moves. */
      navigateWithPageSheet(target, "catalogue");
    }
  }, true);
})();
