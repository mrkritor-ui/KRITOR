/* KRITOR navigation transitions.
   Modern browsers: native cross-document View Transition API.
   Older browsers: intercept only the two KRITOR page links and run a
   simple white wipe before normal navigation. */
(function () {
  "use strict";

  function isKritorPage(url) {
    const u = new URL(url, location.href);
    if (u.origin !== location.origin) return false;
    return /(?:^|\/)about\.html$/.test(u.pathname) || /(?:^|\/)index\.html$/.test(u.pathname) || /\/$/.test(u.pathname);
  }

  /* Modern MPA View Transitions: choose direction from the navigation URLs. */
  function setType(event, fromUrl, toUrl) {
    if (!event.viewTransition || !fromUrl || !toUrl) return;
    const fromAbout = /(?:^|\/)about\.html$/.test(new URL(fromUrl).pathname);
    const toAbout = /(?:^|\/)about\.html$/.test(new URL(toUrl).pathname);
    event.viewTransition.types.add(toAbout && !fromAbout ? "forwards" : "backwards");
  }

  window.addEventListener("pageswap", function (event) {
    if (!event.activation) return;
    setType(event, event.activation.from && event.activation.from.url, event.activation.entry && event.activation.entry.url);
  });

  window.addEventListener("pagereveal", function (event) {
    if (!window.navigation || !navigation.activation) return;
    setType(event, navigation.activation.from && navigation.activation.from.url, navigation.activation.entry && navigation.activation.entry.url);
  });

  /* Legacy fallback: native navigation remains untouched on modern browsers. */
  const nativeViewTransitions = "CSSViewTransitionRule" in window;
  if (nativeViewTransitions) return;

  document.addEventListener("click", function (event) {
    const link = event.target.closest("a[href]");
    if (!link || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!isKritorPage(link.href)) return;

    const current = new URL(location.href);
    const target = new URL(link.href, location.href);
    const currentIsAbout = /(?:^|\/)about\.html$/.test(current.pathname);
    const targetIsAbout = /(?:^|\/)about\.html$/.test(target.pathname);
    if (currentIsAbout === targetIsAbout) return;

    event.preventDefault();
    if (document.documentElement.classList.contains("kritor-fallback-transition")) return;

    document.documentElement.classList.add("kritor-fallback-transition");
    window.setTimeout(function () {
      window.location.href = target.href;
    }, 520);
  }, true);
})();
