/* KRITOR — terminal catalogue.

   Three things happen here: the boot sequence, the bar, and the work panel.

   The boot sequence is the one worth explaining, because the obvious reading
   of it is wrong. The loading bar does not travel across the screen and turn
   into the bar. It is already in the bar's slot — a row inside it — and the
   INFO row simply appears above it once loading is under way. When the works
   have loaded the row says WELCOME and retracts, leaving the bar behind. No
   element flies anywhere, and there is nothing to keep in sync. */
(function () {
  "use strict";

  /* Hovering a tile swaps the 1-bit rendition for the real photograph. Left as
     a single switch because it is the one interaction still undecided: set to
     "off" and the catalogue stays monochrome until a work is opened. */
  const REVEAL_ON_HOVER = "on";

  const TYPE_SPEED = 18;          // ms per character in the panel

  /* The catalogue is 40 KB of 1-bit renditions, so on any real connection it
     loads faster than the statement can be read. Holding the boot screen for a
     beat is what makes it a boot screen rather than a flash of white. */
  const MIN_BOOT_MS = 1400;
  const VIEWS = ["zoom", "grid", "list"];

  const root = document.documentElement;
  const grid = document.getElementById("grid");
  const boot = document.getElementById("boot");
  const bar = document.getElementById("bar");

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ── Data ──────────────────────────────────────────────────────────────── */

  /* Format is not in artworks.js yet. Defaulting here rather than inventing a
     value per work means tagging them later is a data change and nothing more. */
  const formatOf = w => (w.format || "PAINTING").toUpperCase();
  const seriesOf = w => (w.collection || "UNCOLLECTED").toUpperCase();

  const works = ARTWORKS.slice().sort((a, b) => (b.year || 0) - (a.year || 0));

  const bitsEntry = path =>
    (typeof TERMINAL_MANIFEST !== "undefined" ? TERMINAL_MANIFEST[path] : null) || null;
  const realFor = (path, width) =>
    window.KritorTileImage ? window.KritorTileImage.pick(path, width || 480)
                           : "/" + String(path).replace(/^\//, "");

  const filters = { series: null, format: null, year: null };

  /* ── Catalogue ─────────────────────────────────────────────────────────── */

  function tileFor(work) {
    const a = document.createElement("a");
    a.className = "tile";
    a.href = "/" + encodeURIComponent(work.id) + "/";
    a.dataset.workId = work.id;
    a.setAttribute("aria-label", (work.title || "Untitled") + ", " + (work.year || ""));

    const figure = document.createElement("figure");
    figure.className = "tile-figure";

    /* A painted div rather than an <img>: the 1-bit PNG is used as a mask so
       the work takes the theme's ink colour exactly. That costs the intrinsic
       aspect ratio an <img> would carry, so it is restored from the manifest —
       without it every tile would collapse to nothing. */
    const bits = document.createElement("div");
    bits.className = "tile-bits";
    bits.setAttribute("role", "img");
    bits.setAttribute("aria-label", work.title || "Untitled");
    const entry = bitsEntry(work.image);
    /* 1-5 KB each, so the whole catalogue is cheaper than one original. */
    bits.style.setProperty("--bits", 'url("' + (entry ? "/" + entry.url : realFor(work.image, 240)) + '")');
    bits.style.aspectRatio = entry ? entry.w + " / " + entry.h : "1 / 1";
    figure.appendChild(bits);

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

  function visibleWorks() {
    return works.filter(w =>
      (!filters.series || seriesOf(w) === filters.series) &&
      (!filters.format || formatOf(w) === filters.format) &&
      (!filters.year || String(w.year) === filters.year));
  }

  function renderGrid() {
    grid.textContent = "";
    visibleWorks().forEach(w => grid.appendChild(tileFor(w)));
  }

  /* ── Boot ──────────────────────────────────────────────────────────────── */

  const loadingRow = document.getElementById("loading-row");
  const loadingLabel = document.getElementById("loading-label");
  const loadingFill = document.getElementById("loading-fill");
  const infoRow = document.getElementById("info-row");

  function runBoot() {
    /* A masked div fires no load event, so the bar is driven by preloading the
       same URLs the masks use. Same bytes, same cache entry — the mask paints
       from cache the moment its Image resolves. */
    const images = visibleWorks().map(w => {
      const entry = bitsEntry(w.image);
      const img = new Image();
      img.src = entry ? "/" + entry.url : realFor(w.image, 240);
      return img;
    });
    const total = images.length || 1;
    let done = 0;
    let revealedBar = false;

    const step = () => {
      done += 1;
      const ratio = Math.min(1, done / total);
      loadingFill.style.width = (ratio * 100) + "%";

      /* The bar's INFO row appears once loading is visibly under way, not at
         the start — it is what the loading row turns out to be attached to. */
      if (!revealedBar && ratio > 0.25) {
        revealedBar = true;
        infoRow.hidden = false;
      }
      if (done >= total) finish();
    };

    images.forEach(img => {
      if (img.complete) step();
      else {
        img.addEventListener("load", step, { once: true });
        img.addEventListener("error", step, { once: true });
      }
    });
    if (!images.length) finish();

    /* A blocked or slow image must never strand the site on the boot screen. */
    setTimeout(finish, 8000);
  }

  const bootStarted = Date.now();
  let finished = false;
  function finish() {
    if (finished) return;
    const remaining = MIN_BOOT_MS - (Date.now() - bootStarted);
    if (remaining > 0 && !reduceMotion) { setTimeout(finish, remaining); return; }
    finished = true;
    infoRow.hidden = false;
    loadingFill.style.width = "100%";
    loadingLabel.textContent = "WELCOME";
    setTimeout(() => {
      boot.classList.add("is-done");
      loadingRow.classList.add("is-gone");
    }, reduceMotion ? 0 : 750);
  }

  /* ── Bar ───────────────────────────────────────────────────────────────── */

  const drawer = document.getElementById("drawer");
  const filtersPane = document.getElementById("filters-pane");
  const infoPane = document.getElementById("info-pane");
  const infoBtn = document.getElementById("info-btn");
  const scrollFill = document.getElementById("scroll-fill");

  function openDrawer(which) {
    const showingInfo = which === "info";
    const alreadyOpen = drawer.classList.contains("is-open") &&
                        (infoPane.hidden !== showingInfo);
    if (alreadyOpen) return closeDrawer();
    drawer.classList.add("is-open");
    infoPane.hidden = !showingInfo;
    filtersPane.hidden = showingInfo;
    infoBtn.setAttribute("aria-pressed", String(showingInfo));
  }

  function closeDrawer() {
    drawer.classList.remove("is-open");
    infoBtn.setAttribute("aria-pressed", "false");
  }

  function setView(name) {
    VIEWS.forEach(v => grid.classList.toggle("view-" + v, v === name));
    document.querySelectorAll("[data-view]").forEach(b =>
      b.classList.toggle("is-active", b.dataset.view === name));
    try { localStorage.setItem("kritor-view", name); } catch (e) {}
  }

  function setTheme(theme) {
    root.dataset.theme = theme;
    document.querySelectorAll("[data-theme-btn]").forEach(b =>
      b.setAttribute("aria-pressed", String(b.dataset.themeBtn === theme)));
    try { localStorage.setItem("kritor-theme", theme); } catch (e) {}
  }

  /* Each filter column is a list of the values actually present, so a series
     or a year cannot appear with nothing behind it. */
  function buildFilters() {
    const columns = [
      ["SERIES", "series", [...new Set(works.map(seriesOf))].sort()],
      ["FORMAT", "format", [...new Set(works.map(formatOf))].sort()],
      ["YEARS", "year", [...new Set(works.map(w => String(w.year)))].sort().reverse()],
    ];

    filtersPane.textContent = "";
    columns.forEach(([label, key, values]) => {
      const column = document.createElement("div");

      const head = document.createElement("div");
      head.className = "filter-head";
      head.innerHTML = '<span>' + label + '</span><span class="hatch"></span>';
      column.appendChild(head);

      const list = document.createElement("div");
      list.className = "filter-list";
      values.forEach(value => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "bar-btn";
        btn.textContent = key === "year" ? "— " + value : value;
        btn.setAttribute("aria-pressed", "false");
        btn.addEventListener("click", () => {
          /* Pressing the active value clears it: the column doubles as its own
             "all", so no row has to be spent on one. */
          filters[key] = filters[key] === value ? null : value;
          [...list.children].forEach(b =>
            b.setAttribute("aria-pressed", String(b === btn && filters[key] === value)));
          renderGrid();
        });
        list.appendChild(btn);
      });
      column.appendChild(list);

      if (key === "series") {
        const foot = document.createElement("div");
        foot.className = "filter-foot";
        foot.innerHTML = '<a href="/store/">STORE</a>';
        column.appendChild(foot);
      }
      filtersPane.appendChild(column);
    });
  }

  /* ── Work panel ────────────────────────────────────────────────────────── */

  const panel = document.getElementById("panel");
  const panelMeta = document.getElementById("panel-meta");
  const panelArt = document.getElementById("panel-art");
  let typeTimer = 0;

  function typeInto(el, text) {
    clearTimeout(typeTimer);
    const caret = document.createElement("span");
    caret.className = "caret";

    if (reduceMotion) {
      el.textContent = text;
      el.appendChild(caret);
      return;
    }
    el.textContent = "";
    el.appendChild(caret);
    let i = 0;
    const tick = () => {
      i += 1;
      caret.remove();
      el.textContent = text.slice(0, i);
      el.appendChild(caret);
      if (i < text.length) typeTimer = setTimeout(tick, TYPE_SPEED);
    };
    typeTimer = setTimeout(tick, TYPE_SPEED);
  }

  function openPanel(work, push) {
    panelArt.textContent = "";
    const img = document.createElement("img");
    /* The panel shows the real work. The bitmap is the catalogue's language,
       not a way of hiding the painting from someone who asked to see it. */
    img.src = realFor(work.image, 1440);
    img.alt = work.title || "Untitled";
    panelArt.appendChild(img);

    const lines = [
      (work.title || "UNTITLED").toUpperCase(),
      String(work.year || ""),
      "SERIES: " + seriesOf(work),
      "FORMAT: " + formatOf(work),
      "SIZE: " + (work.size || "—"),
    ];
    if (work.text) lines.push("", work.text.toUpperCase());

    panel.classList.add("is-open");
    bar.classList.add("is-hidden");          // only ever two things to click
    document.body.style.overflow = "hidden";
    typeInto(panelMeta, lines.join("\n"));

    if (push) history.pushState({ workId: work.id }, "", "/" + encodeURIComponent(work.id) + "/");
  }

  function closePanel(pop) {
    clearTimeout(typeTimer);
    panel.classList.remove("is-open");
    bar.classList.remove("is-hidden");
    document.body.style.overflow = "";
    if (!pop) history.pushState({}, "", "/");
  }

  /* ── Wiring ────────────────────────────────────────────────────────────── */

  root.dataset.reveal = REVEAL_ON_HOVER;

  let savedTheme = null, savedView = null;
  try {
    savedTheme = localStorage.getItem("kritor-theme");
    savedView = localStorage.getItem("kritor-view");
  } catch (e) {}
  setTheme(savedTheme === "dark" ? "dark" : "light");

  renderGrid();
  buildFilters();
  setView(VIEWS.includes(savedView) ? savedView : "grid");
  runBoot();

  grid.addEventListener("click", e => {
    const tile = e.target.closest("a.tile");
    if (!tile || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const work = works.find(w => w.id === tile.dataset.workId);
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
  document.querySelectorAll("[data-theme-btn]").forEach(b =>
    b.addEventListener("click", () => setTheme(b.dataset.themeBtn)));

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

  const openingId = location.pathname.replace(/\/+$/, "").split("/").pop();
  const opening = works.find(w => w.id === openingId);
  if (opening) openPanel(opening, false);

  window.addEventListener("scroll", () => {
    const max = document.body.scrollHeight - window.innerHeight;
    scrollFill.style.width = (max > 0 ? (window.scrollY / max) * 100 : 0) + "%";
  }, { passive: true });
})();
