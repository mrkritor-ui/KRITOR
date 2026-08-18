(function () {
  const grid = document.getElementById("grid");
  const glassIntro = document.getElementById("glass-intro");
  const glassLogo = document.querySelector(".glass-logo");

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

    tile.appendChild(img);
    return tile;
  }

  function render() {
    grid.innerHTML = "";
    if (!Array.isArray(ARTWORKS) || !ARTWORKS.length) return;
    ARTWORKS.forEach(function (work) {
      grid.appendChild(makeTile(work));
    });
  }

  // The glass stays active while the catalogue is scrolled.
  // Only the KRITOR mark dismisses it, avoiding accidental dismissal from touch scrolling.
  function dismissGlass(event) {
    if (!glassIntro || !glassLogo) return;
    if (event) event.stopPropagation();
    glassIntro.classList.add("clear");
    glassIntro.setAttribute("aria-hidden", "true");
  }

  render();

  if (glassLogo) {
    glassLogo.addEventListener("click", dismissGlass);
    glassLogo.addEventListener("touchend", dismissGlass, { passive: true });
  }
})();
