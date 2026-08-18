(function () {
  const grid = document.getElementById("grid");
  const glassIntro = document.getElementById("glass-intro");
  const glassLogo = document.querySelector(".glass-logo");
  const zoomControl = document.getElementById("zoom-control");

  const levels = ["zoom", "normal", "overview"];
  const isTouchDevice = window.matchMedia("(hover: none) and (pointer: coarse)").matches;
  let level = isTouchDevice ? 0 : 2;
  let pinchStart = null;
  let gestureStartScale = null;
  let gestureHandled = false;

  function applyLevel(next) {
    level = (next + levels.length) % levels.length;
    const current = levels[level];
    grid.classList.remove("view-normal", "view-zoom", "view-overview");
    grid.classList.add(`view-${current}`);
    if (zoomControl) {
      const isLast = level === levels.length - 1;
      zoomControl.textContent = isLast ? "−" : "+";
      zoomControl.setAttribute("aria-label", isLast ? "Return to larger catalogue view" : "Reduce artwork size");
    }
  }

  function workNumber(work) {
    const match = String(work.id || "").match(/work-(\d+)/i);
    return match ? Number(match[1]) : -1;
  }

  function makeTile(work) {
    const tile = document.createElement("a");
    tile.className = "tile";
    tile.href = `work.html?id=${encodeURIComponent(work.id)}`;
    tile.setAttribute("aria-label", work.title ? `${work.title}, ${work.year}` : `Artwork ${work.id}`);
    const img = document.createElement("img");
    img.src = work.thumbnail || work.image;
    img.alt = work.title || "";
    img.loading = "lazy";
    img.decoding = "async";
    img.onerror = function () {
      if (work.thumbnail && img.src.indexOf(work.thumbnail) !== -1) img.src = work.image;
    };
    tile.appendChild(img);
    return tile;
  }

  function render() {
    grid.innerHTML = "";
    if (!Array.isArray(ARTWORKS) || !ARTWORKS.length) return;
    ARTWORKS.slice().sort((a, b) => workNumber(b) - workNumber(a)).forEach(work => grid.appendChild(makeTile(work)));
    applyLevel(level);
  }

  function dismissGlass(event) {
    if (!glassIntro || !glassLogo) return;
    // The opening layer owns this interaction. Never allow the same touch/click
    // to fall through to an artwork underneath it.
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    glassIntro.classList.add("clear");
    glassIntro.setAttribute("aria-hidden", "true");
  }

  function pinchDistance(touches) {
    const a = touches[0], b = touches[1];
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  }

  render();

  if (zoomControl) zoomControl.addEventListener("click", () => applyLevel(level + 1));

  grid.addEventListener("gesturestart", e => {
    gestureStartScale = e.scale || 1;
    gestureHandled = false;
    e.preventDefault();
  }, { passive: false });
  grid.addEventListener("gesturechange", e => {
    e.preventDefault();
    if (gestureHandled || gestureStartScale === null) return;
    const s = e.scale || 1;
    if (Math.abs(s - gestureStartScale) > .12) {
      applyLevel(level + (s > gestureStartScale ? -1 : 1));
      gestureHandled = true;
    }
  }, { passive: false });
  grid.addEventListener("gestureend", e => {
    e.preventDefault();
    gestureStartScale = null;
    gestureHandled = false;
  }, { passive: false });
  grid.addEventListener("touchstart", e => {
    if (e.touches.length === 2) pinchStart = pinchDistance(e.touches);
  }, { passive: true });
  grid.addEventListener("touchmove", e => {
    if (e.touches.length !== 2 || pinchStart === null) return;
    const d = pinchDistance(e.touches) - pinchStart;
    if (Math.abs(d) > 80) {
      applyLevel(level + (d > 0 ? -1 : 1));
      pinchStart = pinchDistance(e.touches);
    }
  }, { passive: true });
  grid.addEventListener("touchend", () => pinchStart = null, { passive: true });

  // Returning from an artwork page must bypass the opening glass entirely.
  if (new URLSearchParams(location.search).get("from") === "work" && glassIntro) {
    glassIntro.classList.add("clear");
    glassIntro.setAttribute("aria-hidden", "true");
  }

  // Attach the dismissal to the glass itself as well as the logo. This guarantees
  // the first tap belongs to the glass and the artwork cannot receive it.
  if (glassIntro) {
    glassIntro.addEventListener("click", dismissGlass, { capture: true });
    glassIntro.addEventListener("touchend", dismissGlass, { capture: true, passive: false });
  }
})();
