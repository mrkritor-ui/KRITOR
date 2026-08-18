(function () {
  const grid = document.getElementById("grid");
  const glassIntro = document.getElementById("glass-intro");
  const glassLogo = document.querySelector(".glass-logo");
  const zoomControl = document.getElementById("zoom-control");
  const levels = ["normal", "zoom", "overview"];
  let level = 0;
  let pinchStart = null;

  function applyLevel(next) {
    level = (next + levels.length) % levels.length;
    grid.classList.remove("view-normal", "view-zoom", "view-overview");
    grid.classList.add(`view-${levels[level]}`);
    if (zoomControl) zoomControl.setAttribute("aria-label", `Catalogue view: ${levels[level]}. Tap to change view`);
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
    ARTWORKS.forEach(function (work) { grid.appendChild(makeTile(work)); });
    applyLevel(level);
  }

  function dismissGlass(event) {
    if (!glassIntro || !glassLogo) return;
    if (event) event.stopPropagation();
    glassIntro.classList.add("clear");
    glassIntro.setAttribute("aria-hidden", "true");
  }

  function pinchDistance(touches) {
    const a = touches[0], b = touches[1];
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  }

  render();

  if (zoomControl) zoomControl.addEventListener("click", function () { applyLevel(level + 1); });

  grid.addEventListener("touchstart", function (event) {
    if (event.touches.length === 2) pinchStart = pinchDistance(event.touches);
  }, { passive: true });

  grid.addEventListener("touchmove", function (event) {
    if (event.touches.length !== 2 || pinchStart === null) return;
    const delta = pinchDistance(event.touches) - pinchStart;
    if (Math.abs(delta) > 80) {
      applyLevel(level + (delta > 0 ? 1 : -1));
      pinchStart = pinchDistance(event.touches);
    }
  }, { passive: true });

  grid.addEventListener("touchend", function () { pinchStart = null; }, { passive: true });

  if (glassLogo) {
    glassLogo.addEventListener("click", dismissGlass);
    glassLogo.addEventListener("touchend", dismissGlass, { passive: true });
  }
})();
