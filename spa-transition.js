(function () {
  "use strict";

  const PAGE_STYLES = { catalogue: "style.css", about: "about.css" };
  const CATALOG_SCROLL_KEY = "kritorCatalogScroll";
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

  function saveCataloguePosition() {
    try {
      sessionStorage.setItem(CATALOG_SCROLL_KEY, JSON.stringify({
        x: window.scrollX || 0,
        y: window.scrollY || 0
      }));
    } catch (_) {}
  }

  function restoreCataloguePosition() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(CATALOG_SCROLL_KEY) || "null");
      if (!saved || typeof saved.y !== "number") return;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          window.scrollTo({ left: saved.x || 0, top: saved.y, behavior: "instant" });
        });
      });
    } catch (_) {}
  }

  async function renderDocument(html, page, suppressOverlay) {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    document.title = parsed.title;
    await loadStylesheet(PAGE_STYLES[page]);
    const newBody = parsed.body.cloneNode(true);
    if (page === "catalogue" && suppressOverlay) {
      const overlay = newBody.querySelector("#kritor-gif-overlay");
      if (overlay) overlay.remove();
    }
    document.body.replaceWith(newBody);
    removeOldPageStyles(page);
    if (page === "catalogue") {
      if (typeof ARTWORKS === "undefined") await loadScript("artworks.js");
      await loadScript("script.js");
    }
  }

  async function navigate(url, replace) {
    if (navigating) return;
    navigating = true;
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`Navigation failed: ${response.status}`);
      const html = await response.text();
      const targetPage = pageFor(url);
      const currentPage = pageFor(location.href);
      const returningToCatalogue = targetPage === "catalogue" && currentPage !== "catalogue";
      const returningFromAbout = returningToCatalogue && currentPage === "about" && !new URL(url, location.href).searchParams.has("work");
      const direction = targetPage === "about" ? "forward" : "backward";

      if (currentPage === "catalogue" && targetPage !== "catalogue") {
        saveCataloguePosition();
        window.dispatchEvent(new Event("kritor:cleanup-static-burst"));
      }

      const update = async () => {
        document.documentElement.dataset.kritorTransition = direction;
        await renderDocument(html, targetPage, returningToCatalogue);
        if (replace) history.replaceState({ page: targetPage }, "", url);
        else history.pushState({ page: targetPage }, "", url);

        // About -> catalogue returns to exactly the catalogue position the user left.
        // Artwork -> catalogue keeps using its existing work-specific return behaviour.
        if (returningFromAbout) restoreCataloguePosition();
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
