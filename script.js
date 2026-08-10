(function () {
  const grid = document.getElementById("grid");
  const viewer = document.getElementById("viewer");
  const viewerImg = document.getElementById("viewer-img");
  const viewerCaption = document.getElementById("viewer-caption");
  const viewerClose = document.getElementById("viewer-close");

  function render() {
    if (!ARTWORKS.length) {
      grid.innerHTML = '<p class="empty">Add artworks in artworks.js</p>';
      return;
    }

    ARTWORKS.forEach((work, i) => {
      const tile = document.createElement("button");
      tile.className = "tile";
      tile.type = "button";
      tile.setAttribute("aria-label", `${work.title}, ${work.year}`);

      const img = document.createElement("img");
      img.src = work.image;
      img.alt = work.title || "";
      img.loading = "lazy";
      img.decoding = "async";

      const caption = document.createElement("figcaption");
      caption.innerHTML = `
        <span class="title">${work.title}</span>
        <span class="meta">${[work.year, work.size].filter(Boolean).join(" \u00b7 ")}</span>
      `;

      tile.appendChild(img);
      tile.appendChild(caption);
      tile.addEventListener("click", () => openViewer(i));

      grid.appendChild(tile);
    });
  }

  function openViewer(i) {
    const work = ARTWORKS[i];
    viewerImg.src = work.image;
    viewerImg.alt = work.title || "";
    viewerCaption.innerHTML = `
      <span class="title">${work.title}</span>
      <span class="meta">${[work.year, work.size].filter(Boolean).join(" \u00b7 ")}</span>
    `;
    viewer.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeViewer() {
    viewer.hidden = true;
    viewerImg.src = "";
    document.body.style.overflow = "";
  }

  viewer.addEventListener("click", (e) => {
    // tap anywhere except the close button closes it
    if (e.target !== viewerClose) closeViewer();
  });
  viewerClose.addEventListener("click", closeViewer);

  render();
})();
