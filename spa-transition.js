(function () {
  "use strict";

  const PAGE_STYLES = { catalogue: "style.css", about: "about.css" };
  let navigating = false;

  function pageFor(url) {
    const path = new URL(url, location.href).pathname.replace(/\/$/, "");
    return path.endsWith("/about.html") ? "about" : "catalogue";
  }

  function isKritorPage(url) {
    const u = new URL(url, location.href);
    if (u.origin !== location.origin) return false;
    return /(?:^|\/)about\.html$/.test(u.pathname) || /(?:^|\/)index\.html$/.test(u.pathname) || /\/$/.test(u.pathname);
  }

  function loadStylesheet(href) {
    return new Promise((resolve, reject) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = `${href}?vt=${Date.now()}`;
      link.dataset.kritorPageStyle = "true";
      link.onload = resolve;
      link.onerror = reject;
      document.head.appendChild(link);
    });
  }

  function removeOldPageStyles(page) {
    const wanted = PAGE_STYLES[page];
    document.querySelectorAll("link[data-kritor-page-style]").forEach(link => {
      if (!new URL(link.href, location.href).pathname.endsWith(`/${wanted}`)) link.remove();
    });
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `${src}?vt=${Date.now()}`;
      script.onload = resolve;
      script.onerror = reject;
      document.body.appendChild(script);
    });
  }

  function placeReturnGifInHeader() {
    const overlay = document.getElementById("kritor-gif-overlay");
    const controls = document.querySelector(".catalog-controls");
    if (!overlay || !controls) return;

    const img = overlay.querySelector("img");
    if (!img) return;

    img.classList.add("kritor-return-gif");
    controls.insertBefore(img, controls.firstChild);
    overlay.remove();
  }

  async function renderDocument(html, page) {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    document.title = parsed.title;

    await loadStylesheet(PAGE_STYLES[page]);

    const newBody = parsed.body.cloneNode(true);
    document.body.replaceWith(newBody);
    removeOldPageStyles(page);

    if (page === "catalogue") {
      if (typeof ARTWORKS === "undefined") await loadScript("artworks.js");
      await loadScript("script.js");

      if (sessionStorage.getItem("kritor-return-from-about") === "1") {
        sessionStorage.removeItem("kritor-return-from-about");
        placeReturnGifInHeader();
      }
    }

    window.scrollTo(0, 0);
  }

  async function navigate(url, replace) {
    if (navigating) return;
    navigating = true;

    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`Navigation failed: ${response.status}`);

      const html = await response.text();
      const targetPage = pageFor(url);

      if (targetPage === "about" && pageFor(location.href) === "catalogue") {
        sessionStorage.setItem("kritor-return-from-about", "1");
      }

      const direction = targetPage === "about" ? "forward" : "backward";

      const update = async () => {
        document.documentElement.dataset.kritorTransition = direction;
        await renderDocument(html, targetPage);
        if (replace) history.replaceState({ page: targetPage }, "", url);
        else history.pushState({ page: targetPage }, "", url);
      };

      if (document.startViewTransition) {
        const transition = document.startViewTransition(update);
        await transition.finished.catch(() => {});
      } else {
        await update();
      }

      document.documentElement.removeAttribute("data-kritor-transition");
    } catch (error) {
      console.error("KRITOR navigation failed:", error);
      window.location.href = url;
    } finally {
      navigating = false;
    }
  }

  document.addEventListener("click", event => {
    const link = event.target.closest("a[href]");
    if (!link || event.defaultPrevented) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (link.target && link.target !== "_self") return;
    if (!isKritorPage(link.href)) return;

    const target = pageFor(link.href);
    const current = pageFor(location.href);
    if (target === current) return;

    event.preventDefault();
    navigate(link.href, false);
  }, true);

  window.addEventListener("popstate", () => navigate(location.href, true));

  history.replaceState({ page: pageFor(location.href) }, "", location.href);
})();
