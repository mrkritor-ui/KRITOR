(function () {
  const grid = document.getElementById("grid");
  const collectionsBar = document.getElementById("collections");
  const sortSelect = document.getElementById("sort");
  const viewer = document.getElementById("viewer");
  const viewerStage = document.getElementById("viewer-stage");
  const viewerImg = document.getElementById("viewer-img");
  const viewerCaption = document.getElementById("viewer-caption");
  const viewerClose = document.getElementById("viewer-close");

  const STATUS_LABEL = { available: "Available", sold: "Sold", na: "Not for sale" };

  let state = {
    collection: "all",
    sort: "year-desc",
  };

  let flatList = []; // current filtered+sorted list, used for viewer navigation

  function formatPrice(work) {
    if (work.status === "sold") return "";
    if (work.status === "na" || !work.price) return "";
    return "$" + Number(work.price).toLocaleString("en-AU");
  }

  function captionHTML(work) {
    const price = formatPrice(work);
    return `
      <span class="title">${work.title}</span>
      <span class="meta">${[work.year, work.size].filter(Boolean).join(" \u00b7 ")}</span>
      <span class="price-row">
        ${price ? `<span class="price">${price}</span> \u00b7 ` : ""}
        <span class="status-label ${work.status}">${STATUS_LABEL[work.status] || ""}</span>
      </span>
    `;
  }

  function sortWorks(list) {
    const [key, dir] = state.sort.split("-");
    const sorted = [...list].sort((a, b) => {
      const av = key === "year" ? a.year : a.price;
      const bv = key === "year" ? b.year : b.price;
      return dir === "asc" ? av - bv : bv - av;
    });
    return sorted;
  }

  function buildCollectionsBar() {
    const names = [];
    ARTWORKS.forEach((w) => {
      const name = w.collection && w.collection.trim() ? w.collection.trim() : "Standalone";
      if (!names.includes(name)) names.push(name);
    });

    const chips = [{ id: "all", label: "All" }, ...names.map((n) => ({ id: n, label: n }))];

    collectionsBar.innerHTML = "";
    chips.forEach((c) => {
      const btn = document.createElement("button");
      btn.className = "chip";
      btn.type = "button";
      btn.textContent = c.label;
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", String(state.collection === c.id));
      btn.addEventListener("click", () => {
        state.collection = c.id;
        render();
      });
      collectionsBar.appendChild(btn);
    });
  }

  function makeTile(work, index) {
    const tile = document.createElement("button");
    tile.className = "tile";
    tile.type = "button";
    tile.setAttribute("aria-label", `${work.title}, ${work.year}`);

    const thumb = document.createElement("div");
    thumb.className = "thumb";

    const img = document.createElement("img");
    img.src = work.image;
    img.alt = work.title || "";
    img.loading = "lazy";
    img.decoding = "async";

    const dot = document.createElement("span");
    dot.className = `status-dot ${work.status}`;

    thumb.appendChild(img);
    thumb.appendChild(dot);

    const caption = document.createElement("figcaption");
    caption.innerHTML = captionHTML(work);

    tile.appendChild(thumb);
    tile.appendChild(caption);
    tile.addEventListener("click", () => openViewer(index));

    return tile;
  }

  function render() {
    buildCollectionsBar();
    grid.innerHTML = "";

    if (!ARTWORKS.length) {
      grid.innerHTML = '<p class="empty">Add artworks in artworks.js</p>';
      flatList = [];
      return;
    }

    if (state.collection !== "all") {
      // flat, single collection
      const items = ARTWORKS.filter(
        (w) => (w.collection && w.collection.trim() ? w.collection.trim() : "Standalone") === state.collection
      );
      flatList = sortWorks(items);
      flatList.forEach((w, i) => grid.appendChild(makeTile(w, i)));
      return;
    }

    // "All" — grouped by collection, each group sorted internally
    const groups = new Map();
    ARTWORKS.forEach((w) => {
      const name = w.collection && w.collection.trim() ? w.collection.trim() : "Standalone";
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(w);
    });

    flatList = [];
    // Standalone group last, named collections first in order of first appearance
    const orderedNames = [...groups.keys()].filter((n) => n !== "Standalone");
    if (groups.has("Standalone")) orderedNames.push("Standalone");

    orderedNames.forEach((name) => {
      const items = sortWorks(groups.get(name));

      const heading = document.createElement("div");
      heading.className = "group-heading";
      heading.innerHTML = `<span class="name">${name}</span><span class="count">${items.length} work${items.length === 1 ? "" : "s"}</span>`;
      grid.appendChild(heading);

      items.forEach((w) => {
        const idx = flatList.length;
        flatList.push(w);
        grid.appendChild(makeTile(w, idx));
      });
    });
  }

  sortSelect.addEventListener("change", () => {
    state.sort = sortSelect.value;
    render();
  });

  /* ---------------- Fullscreen viewer + pinch zoom ---------------- */

  let scale = 1, panX = 0, panY = 0;
  let lastTouchDist = null, lastMid = null;
  let dragStart = null, dragged = false;

  function applyTransform() {
    viewerImg.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
  }

  function resetZoom() {
    scale = 1; panX = 0; panY = 0;
    applyTransform();
  }

  function distance(t1, t2) {
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.hypot(dx, dy);
  }

  function midpoint(t1, t2) {
    return { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
  }

  viewerStage.addEventListener("touchstart", (e) => {
    if (e.touches.length === 2) {
      lastTouchDist = distance(e.touches[0], e.touches[1]);
      lastMid = midpoint(e.touches[0], e.touches[1]);
      dragged = false;
    } else if (e.touches.length === 1) {
      dragStart = { x: e.touches[0].clientX - panX, y: e.touches[0].clientY - panY };
      dragged = false;
    }
  }, { passive: true });

  viewerStage.addEventListener("touchmove", (e) => {
    if (e.touches.length === 2 && lastTouchDist) {
      e.preventDefault();
      const dist = distance(e.touches[0], e.touches[1]);
      const delta = dist / lastTouchDist;
      scale = Math.min(4, Math.max(1, scale * delta));
      lastTouchDist = dist;
      applyTransform();
      dragged = true;
    } else if (e.touches.length === 1 && scale > 1 && dragStart) {
      e.preventDefault();
      panX = e.touches[0].clientX - dragStart.x;
      panY = e.touches[0].clientY - dragStart.y;
      applyTransform();
      dragged = true;
    }
  }, { passive: false });

  viewerStage.addEventListener("touchend", (e) => {
    if (e.touches.length === 0) {
      lastTouchDist = null;
      dragStart = null;
      if (scale <= 1) resetZoom();
    }
  });

  // Double-tap to toggle zoom, as a shortcut alongside pinch
  let lastTap = 0;
  viewerStage.addEventListener("touchend", (e) => {
    const now = Date.now();
    if (now - lastTap < 280 && !dragged) {
      if (scale > 1) {
        resetZoom();
      } else {
        scale = 2.2;
        applyTransform();
      }
    }
    lastTap = now;
  });

  function openViewer(i) {
    const work = flatList[i];
    if (!work) return;
    resetZoom();
    viewerImg.src = work.image;
    viewerImg.alt = work.title || "";
    viewerCaption.innerHTML = captionHTML(work);
    viewer.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeViewer() {
    viewer.hidden = true;
    viewerImg.src = "";
    resetZoom();
    document.body.style.overflow = "";
  }

  viewer.addEventListener("click", (e) => {
    if (e.target === viewerClose) return;
    if (scale > 1) return; // while zoomed, only the close button closes
    if (dragged) { dragged = false; return; } // ignore the click that follows a drag
    closeViewer();
  });
  viewerClose.addEventListener("click", closeViewer);

  render();
})();
