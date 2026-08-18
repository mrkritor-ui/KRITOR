(function () {
  const grid = document.getElementById("grid");
  const glassIntro = document.getElementById("glass-intro");

  function makeTile(work) {
    const tile = document.createElement("a");
    tile.className = "tile";
    tile.href = `work.html?id=${encodeURIComponent(work.id)}`;
    tile.setAttribute("aria-label", work.title ? `${work.title}, ${work.year}` : `Artwork ${work.id}`);

    const img = document.createElement("img");
    img.src = work.image;
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

  function dismissGlass() {
    if (!glassIntro) return;
    glassIntro.classList.add("clear");
    glassIntro.setAttribute("aria-hidden", "true");
  }

  render();

  if (glassIntro) {
    glassIntro.addEventListener("click", dismissGlass);
    glassIntro.addEventListener("touchend", dismissGlass, { passive: true });
  }
})();
