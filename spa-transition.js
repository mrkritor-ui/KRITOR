(function () {
  "use strict";

  const PAGE_STYLES = {
    catalogue: "style.css",
    about: "about.css"
  };

  const PAGE_SCRIPTS = ["artworks.js", "script.js"];
  let navigating = false;

  function pageFor(url) {
    const path = new URL(url, location.href).pathname.replace(/\/$/, "");
    return path.endsWith("/about.html") ? "about" : "catalogue";
  }

  function sameOrigin(url) {
    return new URL(url, location.href).origin === location.origin;
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

  function setPageStyle(page) {
    const wanted = PAGE_STYLES[page];
    document.querySelectorAll("link[data-kritor-page-style]").forEach(link => {
      if (link.getAttribute("href") !== wanted) link.remove();
    });

    if (!document.querySelector(`link[data-kritor-page-style][href="${wanted}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = `${wanted}?vt=${Date.now()}`;
      link.dataset.kritorPageStyle = "";
      document.head.appendChild(link);
    }
  }

  async function renderDocument(html, page) {
    const parsed = new DOMParser().parseFromString(html, "text/html");

    document.title = parsed.title;
    setPageStyle(page);

    const newBody = parsed.body.cloneNode(true);
    document.body.replaceWith(newBody);

    if (page === "catalogue") {
      await loadScript("artworks.js");
      await loadScript("script.js");
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
      const currentPage = pageFor(location.href);
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
    if (!sameOrigin(link.href)) return;

    const target = pageFor(link.href);
    const current = pageFor(location.href);
    if (target === current) return;
    if (!/about\.html$|index\.html$|\/$/.test(new URL(link.href).pathname)) return;

    event.preventDefault();
    navigate(link.href, false);
  }, true);

  window.addEventListener("popstate", () => {
    navigate(location.href, true);
  });

  const initialPage = pageFor(location.href);
  history.replaceState({ page: initialPage }, "", location.href);
})();
