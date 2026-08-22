(function () {
  "use strict";

  const PAGE_STYLES = { catalogue: "style.css", about: "about.css", store: "store.css" };
  /* Horizontal position of each page. Navigating to a higher index slides the
     new page in from the right (About); to a lower index, in from the left (Store). */
  const PAGE_AXIS = { store: -1, catalogue: 0, about: 1 };
  const SCROLL_KEY = "kritorPageScroll";
  let navigating = false;
  /* Tracked separately from location.href: on popstate the URL has already
     changed, and the direction of the swipe depends on where we came from. */
  let currentPage = "catalogue";

  function siteRoot(path) {
    return new URL(path.replace(/^\//, ""), location.origin + "/").href;
  }

  function pageFor(url) {
    const path = new URL(url, location.href).pathname.replace(/\/$/, "");
    if (path.endsWith("/about") || path.endsWith("/about.html")) return "about";
    if (path.endsWith("/store") || path.endsWith("/store.html")) return "store";
    return "catalogue";
  }

  function cleanUrlFor(url) {
    const u = new URL(url, location.href);
    const path = u.pathname;
    if (path.endsWith("/index.html")) u.pathname = path.slice(0, -"index.html".length);
    else if (path.endsWith("/about.html")) u.pathname = path.slice(0, -"about.html".length) + "about/";
    else if (path.endsWith("/store.html")) u.pathname = path.slice(0, -"store.html".length) + "store/";
    return u.href;
  }

  function isKritorPage(url) {
    const u = new URL(url, location.href);
    if (u.origin !== location.origin) return false;
    const path = u.pathname.replace(/\/$/, "");
    return path.endsWith("/about") || path.endsWith("/about.html") ||
      path.endsWith("/store") || path.endsWith("/store.html") ||
      path.endsWith("/index.html") || path === "";
  }

  function loadStylesheet(href) {
    return new Promise((resolve, reject) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = `${siteRoot(href)}?vt=${Date.now()}`;
      link.dataset.kritorPageStyle = "true";
      link.onload = resolve;
      link.onerror = reject;
      document.head.appendChild(link);
    });
  }

  /* A stylesheet that outlives page swaps — deliberately not tagged as a page
     style, so removeOldPageStyles leaves it alone. */
  function loadPersistentStylesheet(href) {
    const wanted = siteRoot(href);
    if (document.querySelector(`link[data-kritor-persistent="${href}"]`)) return Promise.resolve();
    return new Promise(resolve => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = wanted;
      link.dataset.kritorPersistent = href;
      link.onload = resolve;
      link.onerror = resolve;
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
      script.src = `${siteRoot(src)}?vt=${Date.now()}`;
      script.onload = resolve;
      script.onerror = reject;
      document.body.appendChild(script);
    });
  }

  function initGridLogo() {
    const logo = document.getElementById("kritor-top-logo");
    if (!logo || logo.dataset.kritorLogoReady === "true") return;
    logo.dataset.kritorLogoReady = "true";
    let revealed = false;
    const reveal = () => {
      if (revealed) return;
      revealed = true;
      logo.classList.add("is-visible");
      ["scroll", "pointerdown", "pointermove", "keydown", "wheel", "touchstart"].forEach(type => window.removeEventListener(type, reveal));
    };
    ["scroll", "pointerdown", "pointermove", "keydown", "wheel", "touchstart"].forEach(type => window.addEventListener(type, reveal, {passive: true}));
  }

  function readScrollMemory() {
    try { return JSON.parse(sessionStorage.getItem(SCROLL_KEY) || "{}") || {}; } catch (_) { return {}; }
  }

  function savePosition(page) {
    try {
      const memory = readScrollMemory();
      memory[page] = {x: window.scrollX || 0, y: window.scrollY || 0};
      sessionStorage.setItem(SCROLL_KEY, JSON.stringify(memory));
    } catch (_) {}
  }

  function restorePosition(page) {
    const saved = readScrollMemory()[page];
    if (!saved || typeof saved.y !== "number") return;
    requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo({left: saved.x || 0, top: saved.y, behavior: "instant"})));
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
      await loadScript("clean-work-links.js");
      initGridLogo();
    } else if (page === "store") {
      await loadPersistentStylesheet("cart.css");
      if (typeof SHOP_ITEMS === "undefined") await loadScript("products.js");
      /* cart.js defines window.KritorCart once and then rebuilds its UI from
         the page-rendered event, so it must only ever be loaded once. */
      if (!window.KritorCart) await loadScript("cart.js");
      await loadScript("store.js");
      initGridLogo();
    }
    /* The body swap took the bag button and drawer with it — cart.js listens
       for this to rebuild them against the new body. */
    window.dispatchEvent(new Event("kritor:page-rendered"));
  }

  async function navigate(url, replace) {
    if (navigating) return;
    navigating = true;
    try {
      const requestedUrl = new URL(url, location.href);
      const response = await fetch(requestedUrl.href, {cache: "no-store"});
      if (!response.ok) throw new Error(`Navigation failed: ${response.status}`);
      const html = await response.text();
      const targetPage = pageFor(requestedUrl.href);
      const returningToCatalogue = targetPage === "catalogue" && currentPage !== "catalogue";
      const restoreTarget = !requestedUrl.searchParams.has("work");
      const direction = PAGE_AXIS[targetPage] > PAGE_AXIS[currentPage] ? "forward" : "backward";
      const historyUrl = cleanUrlFor(requestedUrl.href);

      savePosition(currentPage);
      if (currentPage === "catalogue") window.dispatchEvent(new Event("kritor:cleanup-static-burst"));

      const update = async () => {
        document.documentElement.dataset.kritorTransition = direction;
        await renderDocument(html, targetPage, returningToCatalogue);
        if (replace) history.replaceState({page: targetPage}, "", historyUrl);
        else history.pushState({page: targetPage}, "", historyUrl);
        currentPage = targetPage;
        if (restoreTarget) restorePosition(targetPage);
      };

      if (document.startViewTransition) {
        const transition = document.startViewTransition(update);
        await transition.finished.catch(() => {});
      } else await update();

      document.documentElement.removeAttribute("data-kritor-transition");
    } catch (error) {
      console.error("KRITOR navigation failed:", error);
      window.location.href = cleanUrlFor(url);
    } finally { navigating = false; }
  }

  document.addEventListener("click", event => {
    const link = event.target.closest("a[href]");
    if (!link || event.defaultPrevented) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (link.target && link.target !== "_self") return;
    if (!isKritorPage(link.href)) return;
    if (pageFor(link.href) === currentPage) return;
    event.preventDefault();
    navigate(link.href, false);
  }, true);

  window.addEventListener("popstate", () => navigate(location.href, true));
  const initialCleanUrl = cleanUrlFor(location.href);
  currentPage = pageFor(initialCleanUrl);
  history.replaceState({page: currentPage}, "", initialCleanUrl);
})();
