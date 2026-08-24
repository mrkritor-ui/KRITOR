/* KRITOR — the catalogue.

   The chrome lives in terminal-shell.js. This file decides only what a work
   looks like in each of the three views, what the bar filters on, and what
   opening a work does. */
(function () {
  "use strict";

  const T = window.KritorTerminal;

  /* Hovering a tile swaps the 1-bit rendition for the real photograph. Left as
     a single switch because it is the one interaction still undecided: set to
     "off" and the catalogue stays monochrome until a work is opened. */
  const REVEAL_ON_HOVER = "on";

  /* The archive does not yet fill every year, but the filter is a range the
     work sits inside rather than a list of years that happen to have one. */
  const YEAR_RANGE = [2020, 2026];

  const VIEWS = ["zoom", "grid", "list"];

  const root = document.documentElement;
  const grid = document.getElementById("grid");
  const bar = document.getElementById("bar");

  /* Format and materials are not in artworks.js yet. Defaulting in one place
     each means filling them in later is a data change and nothing more. */
  const formatOf = w => (w.format || "PAINTING").toUpperCase();
  const materialOf = w => (w.materials || "—").toUpperCase();
  const titleOf = w => (w.title || "UNTITLED").toUpperCase();

  const works = ARTWORKS.slice().sort((a, b) => (b.year || 0) - (a.year || 0));

  const bitsEntry = path =>
    (typeof TERMINAL_MANIFEST !== "undefined" ? TERMINAL_MANIFEST[path] : null) || null;
  const bitsUrl = path => {
    const e = bitsEntry(path);
    return e ? "/" + e.url : realFor(path, 240);
  };
  const realFor = (path, width) =>
    window.KritorTileImage ? window.KritorTileImage.pick(path, width || 480)
                           : "/" + String(path).replace(/^\//, "");

  const filters = { format: null, year: null };
  let view = "grid";

  /* ── Views ─────────────────────────────────────────────────────────────── */

  function visibleWorks() {
    return works.filter(w =>
      (!filters.format || formatOf(w) === filters.format) &&
      (!filters.year || String(w.year) === filters.year));
  }

  function bitsBlock(work) {
    /* A painted div rather than an <img>: the 1-bit PNG is used as a mask so
       the work takes the theme's ink colour exactly. That costs the intrinsic
       aspect ratio an <img> would carry, so it is restored from the manifest. */
    const bits = document.createElement("div");
    bits.className = "tile-bits";
    bits.setAttribute("role", "img");
    bits.setAttribute("aria-label", titleOf(work));
    const entry = bitsEntry(work.image);
    bits.style.setProperty("--bits", 'url("' + bitsUrl(work.image) + '")');
    bits.style.aspectRatio = entry ? entry.w + " / " + entry.h : "1 / 1";
    return bits;
  }

  function tileFor(work) {
    const a = document.createElement("a");
    a.className = "tile";
    a.href = "/" + encodeURIComponent(work.id) + "/";
    a.dataset.workId = work.id;
    a.setAttribute("aria-label", titleOf(work) + ", " + (work.year || ""));

    const figure = document.createElement("figure");
    figure.className = "tile-figure";
    figure.appendChild(bitsBlock(work));

    const real = document.createElement("img");
    real.className = "tile-real";
    real.alt = "";
    real.loading = "lazy";
    real.decoding = "async";
    real.src = realFor(work.image, 480);
    figure.appendChild(real);

    a.appendChild(figure);
    return a;
  }

  const LIST_COLUMNS = ["IDX", "TITLE", "YEAR", "SERIES", "FORMAT", "MATERIAL", "SIZE"];

  /* LIST is the whole archive as a table — the same records the grid shows,
     read as data rather than as pictures. */
  function listRowFor(work, index) {
    const a = document.createElement("a");
    a.className = "row";
    a.href = "/" + encodeURIComponent(work.id) + "/";
    a.dataset.workId = work.id;
    [
      String(index + 1).padStart(3, "0"),
      titleOf(work),
      String(work.year || "—"),
      (work.collection || "UNCOLLECTED").toUpperCase(),
      formatOf(work),
      materialOf(work),
      (work.size || "—").toUpperCase(),
    ].forEach(value => {
      const cell = document.createElement("span");
      cell.className = "cell";
      cell.textContent = value;
      a.appendChild(cell);
    });
    return a;
  }

  function listHead() {
    const head = document.createElement("div");
    head.className = "row row-head";
    LIST_COLUMNS.forEach(label => {
      const cell = document.createElement("span");
      cell.className = "cell";
      cell.textContent = label;
      head.appendChild(cell);
    });
    return head;
  }

  function setView(name) {
    view = VIEWS.includes(name) ? name : "grid";
    VIEWS.forEach(v => grid.classList.toggle("view-" + v, v === view));
    document.querySelectorAll("[data-view]").forEach(b =>
      b.classList.toggle("is-active", b.dataset.view === view));
    try { localStorage.setItem("kritor-view", view); } catch (e) {}
    render();
  }

  function render() {
    grid.textContent = "";
    if (view === "list") grid.appendChild(listHead());
    visibleWorks().forEach((w, i) => grid.appendChild(entryFor(w, i)));
  }

  const entryFor = (work, index) =>
    view === "list" ? listRowFor(work, index) : tileFor(work);

  /* ── Bar ───────────────────────────────────────────────────────────────── */

  const drawer = document.getElementById("drawer");
  const filtersPane = document.getElementById("filters-pane");
  const infoPane = document.getElementById("info-pane");
  const infoBtn = document.getElementById("info-btn");
  const scrollFill = document.getElementById("scroll-fill");

  function openDrawer(which) {
    const showingInfo = which === "info";
    if (drawer.classList.contains("is-open") && infoPane.hidden !== showingInfo) return closeDrawer();
    drawer.classList.add("is-open");
    infoPane.hidden = !showingInfo;
    filtersPane.hidden = showingInfo;
    infoBtn.setAttribute("aria-pressed", String(showingInfo));
  }

  function closeDrawer() {
    drawer.classList.remove("is-open");
    infoBtn.setAttribute("aria-pressed", "false");
  }

  function column(label, build) {
    const col = document.createElement("div");
    const head = document.createElement("div");
    head.className = "filter-head";
    head.innerHTML = "<span>" + label + '</span><span class="hatch"></span>';
    col.appendChild(head);
    const body = document.createElement("div");
    body.className = "filter-list";
    build(body);
    col.appendChild(body);
    return col;
  }

  function valueColumn(label, key, values, format) {
    return column(label, list => {
      values.forEach(value => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "bar-btn";
        btn.textContent = format ? format(value) : value;
        btn.setAttribute("aria-pressed", "false");
        btn.addEventListener("click", () => {
          /* Pressing the active value clears it: the column doubles as its own
             "all", so no row has to be spent on one. */
          filters[key] = filters[key] === value ? null : value;
          [...list.children].forEach(b =>
            b.setAttribute("aria-pressed", String(b === btn && filters[key] === value)));
          render();
        });
        list.appendChild(btn);
      });
    });
  }

  function buildFilters() {
    const years = [];
    for (let y = YEAR_RANGE[1]; y >= YEAR_RANGE[0]; y--) years.push(String(y));

    filtersPane.textContent = "";
    /* The store takes the column the reference gives to clients: it is the one
       place on the site that leads anywhere else. */
    filtersPane.appendChild(column("STORE", list => {
      const link = document.createElement("a");
      link.className = "bar-btn";
      link.href = "/store/";
      link.textContent = "ENTER STORE";
      list.appendChild(link);
    }));
    filtersPane.appendChild(valueColumn("FORMAT", "format", [...new Set(works.map(formatOf))].sort()));
    filtersPane.appendChild(valueColumn("YEARS", "year", years, y => "— " + y));
  }

  /* ── Work panel ────────────────────────────────────────────────────────── */

  const panel = document.getElementById("panel");
  const panelMeta = document.getElementById("panel-meta");
  const panelArt = document.getElementById("panel-art");

  function openPanel(work, push) {
    panelArt.textContent = "";
    const img = document.createElement("img");
    /* The panel shows the real work. The bitmap is the catalogue's language,
       not a way of hiding the painting from someone who asked to see it. */
    img.src = realFor(work.image, 1440);
    img.alt = titleOf(work);
    panelArt.appendChild(img);

    const lines = [
      titleOf(work),
      String(work.year || ""),
      "SERIES: " + (work.collection || "UNCOLLECTED").toUpperCase(),
      "FORMAT: " + formatOf(work),
      "MATERIAL: " + materialOf(work),
      "SIZE: " + (work.size || "—"),
    ];
    if (work.text) lines.push("", work.text.toUpperCase());

    panel.classList.add("is-open");
    bar.classList.add("is-hidden");          // only ever two things to click
    document.body.style.overflow = "hidden";
    T.typeInto(panelMeta, lines.join("\n"));

    if (push) history.pushState({ workId: work.id }, "", "/" + encodeURIComponent(work.id) + "/");
  }

  function closePanel(pop) {
    T.stopTyping();
    panel.classList.remove("is-open");
    bar.classList.remove("is-hidden");
    document.body.style.overflow = "";
    if (!pop) history.pushState({}, "", "/");
  }

  /* ── Wiring ────────────────────────────────────────────────────────────── */

  root.dataset.reveal = REVEAL_ON_HOVER;
  T.initTheme();
  buildFilters();

  let savedView = null;
  try { savedView = localStorage.getItem("kritor-view"); } catch (e) {}
  view = VIEWS.includes(savedView) ? savedView : "grid";
  VIEWS.forEach(v => grid.classList.toggle("view-" + v, v === view));
  document.querySelectorAll("[data-view]").forEach(b =>
    b.classList.toggle("is-active", b.dataset.view === view));

  const opening = works.find(w =>
    w.id === location.pathname.replace(/\/+$/, "").split("/").pop());

  T.runBoot({
    preload: works.map(w => bitsUrl(w.image)),
    items: visibleWorks(),
    /* The bar's parameters are part of the sequence, not chrome that was
       always there: they arrive once the machine says WELCOME. */
    onParams: () => {
      openDrawer("filters");
      if (opening) openPanel(opening, false);
    },
    onDeal: (work, i) => {
      if (i === 0 && view === "list") grid.appendChild(listHead());
      grid.appendChild(entryFor(work, i));
    },
  });

  grid.addEventListener("click", e => {
    const hit = e.target.closest("a.tile, a.row");
    if (!hit || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const work = works.find(w => w.id === hit.dataset.workId);
    if (!work) return;
    e.preventDefault();
    closeDrawer();
    openPanel(work, true);
  });

  document.getElementById("panel-esc").addEventListener("click", () => closePanel(false));
  document.getElementById("bar-tab").addEventListener("click", () => openDrawer("filters"));
  infoBtn.addEventListener("click", () => openDrawer("info"));
  document.querySelectorAll("[data-view]").forEach(b =>
    b.addEventListener("click", () => setView(b.dataset.view)));

  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    if (panel.classList.contains("is-open")) closePanel(false);
    else closeDrawer();
  });

  /* Deep links still work: /work-01/ opens with the panel already up, so the
     built routes and shareable URLs survive the move to a single page. */
  window.addEventListener("popstate", () => {
    const id = location.pathname.replace(/\/+$/, "").split("/").pop();
    const work = works.find(w => w.id === id);
    if (work) openPanel(work, false);
    else if (panel.classList.contains("is-open")) closePanel(true);
  });

  window.addEventListener("scroll", () => {
    const max = document.body.scrollHeight - window.innerHeight;
    scrollFill.style.width = (max > 0 ? (window.scrollY / max) * 100 : 0) + "%";
  }, { passive: true });

  T.startScreensaver(works.map(w => {
    const e = bitsEntry(w.image);
    return { url: bitsUrl(w.image), w: e ? e.w : 1, h: e ? e.h : 1 };
  }));
})();
