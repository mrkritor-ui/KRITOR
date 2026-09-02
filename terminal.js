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
  const seriesOf = w => (w.collection || "UNCOLLECTED").toUpperCase();
  const materialOf = w => (w.materials || "—").toUpperCase();
  const titleOf = w => (w.title || "UNTITLED").toUpperCase();

  const byYear = (a, b) => (b.year || 0) - (a.year || 0);
  let works = ARTWORKS.slice().sort(byYear);

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
      seriesOf(work),
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

  /* One place where the current view becomes visible: the grid's class, the
     button that inverts, and the attribute on the root that the block on the
     bar's scale reads its position off. Called on the way in as well as on a
     press, so a view restored from the last visit lands the block too.

     Scoped to buttons — the root itself now carries data-view, and a bare
     [data-view] would hand it the class meant for the control. */
  function markView(name) {
    VIEWS.forEach(v => grid.classList.toggle("view-" + v, v === name));
    document.querySelectorAll("button[data-view]").forEach(b =>
      b.classList.toggle("is-active", b.dataset.view === name));
    root.dataset.view = name;
  }

  function setView(name) {
    view = VIEWS.includes(name) ? name : "grid";
    markView(view);
    try { localStorage.setItem("kritor-view", view); } catch (e) {}
    render();
  }

  function render() {
    grid.textContent = "";
    if (view === "list") grid.appendChild(listHead());
    visibleWorks().forEach((w, i) => grid.appendChild(entryFor(w, i)));
  }

  /* Randomise displaces the works within the grid they are already in — it
     does not clear and re-deal them. Nothing is destroyed and nothing is
     re-fetched: the same elements travel to their new cells, so what you see
     is the order changing rather than the page reloading.

     Done as a FLIP: measure where everything is, reorder the DOM, measure
     again, then animate each element from where it was to where it now is.
     Stepped rather than eased, so the works jump between positions the way
     everything else on this surface moves. */
  function randomise() {
    const moved = [...grid.children].filter(el => el.dataset.workId);
    if (moved.length < 2) return;
    const before = new Map(moved.map(el => [el, el.getBoundingClientRect()]));

    for (let i = works.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [works[i], works[j]] = [works[j], works[i]];
    }

    /* Reordering by appendChild moves the existing nodes; the list's header is
       untouched because it carries no work id, so it stays at the top. */
    const byId = new Map(moved.map(el => [el.dataset.workId, el]));
    visibleWorks().forEach(w => {
      const el = byId.get(w.id);
      if (el) grid.appendChild(el);
    });
    if (T.reduceMotion) return;

    moved.forEach(el => {
      const from = before.get(el);
      const to = el.getBoundingClientRect();
      const dx = from.left - to.left;
      const dy = from.top - to.top;
      if (!dx && !dy) return;
      el.style.transition = "none";
      el.style.transform = "translate(" + dx + "px," + dy + "px)";
    });

    requestAnimationFrame(() => {
      moved.forEach(el => {
        el.style.transition = "transform 420ms steps(10, end)";
        el.style.transform = "";
      });
      setTimeout(() => moved.forEach(el => {
        el.style.transition = "";
        el.style.transform = "";
      }), 460);
    });
  }

  const entryFor = (work, index) =>
    view === "list" ? listRowFor(work, index) : tileFor(work);

  /* ── Bar ───────────────────────────────────────────────────────────────── */

  const filtersPane = document.getElementById("filters-pane");
  const scrollFill = document.getElementById("scroll-fill");
  const barUI = T.mountBar();

  function valueColumn(label, key, values, format) {
    let buttons = [];
    const col = T.filterColumn(label, list => {
      values.forEach(value => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "bar-btn";
        btn.textContent = format ? format(value) : value;
        btn.setAttribute("aria-pressed", "false");
        btn.addEventListener("click", event => {
          T.flash(btn);
          /* Pressing the active value clears it: the column doubles as its own
             "all", so no row has to be spent on one. */
          select(filters[key] === value ? null : value);
          /* A mouse click leaves focus on the value, and :focus-within holds
             the whole column open — so a cleared column would not close. A
             keyboard Enter reports detail 0 and keeps its focus. */
          if (event.detail > 0) btn.blur();
        });
        list.appendChild(btn);
      });
      buttons = [...list.children];
    });

    /* One place that knows what "chosen" means for this column: the filter,
       the pressed states and whether the X is there all move together. */
    function select(value, keepClear) {
      filters[key] = value;
      buttons.forEach(b =>
        b.setAttribute("aria-pressed", String(value !== null && b.textContent === (format ? format(value) : value))));
      /* Hiding the X the instant it is pressed is why it never appeared to
         flash: a display:none element runs no animation. The grid updates
         straight away; only the X's disappearance waits for its own flash. */
      if (!keepClear) col.clearButton.hidden = value === null;
      /* Holding a value keeps the column open, so every filter narrowing the
         catalogue stays on screen rather than only the one last pointed at. */
      col.classList.toggle("is-filtered", value !== null);
      if (value === null) col.classList.remove("is-open");
      render();
    }

    col.clearButton.addEventListener("click", event => {
      T.flash(col.clearButton);
      select(null, true);
      setTimeout(() => { col.clearButton.hidden = true; }, T.FLASH_MS);
      if (event.detail > 0) col.clearButton.blur();
    });
    return col;
  }

  function buildFilters() {
    const years = [];
    for (let y = YEAR_RANGE[1]; y >= YEAR_RANGE[0]; y--) years.push(String(y));

    filtersPane.textContent = "";
    /* The store takes the column the reference gives to clients: it is the one
       place on the site that leads anywhere else. */
    filtersPane.appendChild(T.filterColumn("STORE", list => {
      const link = document.createElement("a");
      link.className = "bar-btn";
      link.href = "/store/";
      link.textContent = "ENTER STORE";
      list.appendChild(link);
    }));
    filtersPane.appendChild(valueColumn("FORMAT", "format", [...new Set(works.map(formatOf))].sort()));
    filtersPane.appendChild(valueColumn("YEARS", "year", years, y => "— " + y));
  }

  /* ── List preview ──────────────────────────────────────────────────────── */

  const preview = document.createElement("div");
  preview.className = "row-preview";
  preview.setAttribute("aria-hidden", "true");
  document.body.appendChild(preview);

  function showPreview(work, x, y) {
    const entry = bitsEntry(work.image);
    const ratio = entry ? entry.h / entry.w : 1;
    preview.style.setProperty("--bits", 'url("' + bitsUrl(work.image) + '")');
    const w = 320, h = 320 * ratio, pad = 16;
    preview.style.height = Math.round(h) + "px";
    /* Kept inside the viewport, and flipped to the other side of the cursor
       when there is not room, so it never hangs off an edge. */
    const left = x + pad + w > window.innerWidth ? x - pad - w : x + pad;
    const top = Math.min(Math.max(pad, y - h / 2), window.innerHeight - h - pad);
    preview.style.left = Math.round(left) + "px";
    preview.style.top = Math.round(top) + "px";
    preview.classList.add("is-on");
  }

  const hidePreview = () => preview.classList.remove("is-on");

  grid.addEventListener("pointermove", e => {
    if (view !== "list") return hidePreview();
    const row = e.target.closest("a.row");
    if (!row) return hidePreview();
    const work = works.find(w => w.id === row.dataset.workId);
    if (work) showPreview(work, e.clientX, e.clientY);
  });
  grid.addEventListener("pointerleave", hidePreview);

  /* ── Work panel ────────────────────────────────────────────────────────── */

  const panel = document.getElementById("panel");
  const panelMeta = document.getElementById("panel-meta");
  const panelArt = document.getElementById("panel-art");
  const panelTitle = document.getElementById("panel-title");
  const panelFoot = document.getElementById("panel-foot");
  let current = null;
  let cancelReveal = null;

  /* The order the panel walks, which is not the grid's. Works are grouped by
     series so stepping through takes you along a body of work before moving
     on — the grid is sorted by year, and walking that would scatter a series
     across the whole archive. Within a series it stays newest first. */
  function sequence() {
    const groups = new Map();
    visibleWorks().forEach(w => {
      const key = seriesOf(w);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(w);
    });
    /* Uncollected works have no body to belong to, so they go last rather
       than forming a fake series at the front. */
    const keys = [...groups.keys()].sort((a, b) =>
      (a === "UNCOLLECTED") - (b === "UNCOLLECTED") || a.localeCompare(b));
    return keys.flatMap(k => groups.get(k).sort(byYear));
  }

  function step(delta) {
    const list = sequence();
    if (!list.length || !current) return;
    const at = list.findIndex(w => w.id === current.id);
    openPanel(list[((at < 0 ? 0 : at) + delta + list.length) % list.length], true);
  }

  function openPanel(work, push) {
    if (cancelReveal) cancelReveal();
    /* Only the work is replaced. The two halves that walk the sequence are
       mounted once and live in here, and emptying the box took them with it. */
    const previous = panelArt.querySelector("img");
    if (previous) previous.remove();
    const img = document.createElement("img");
    /* The panel shows the real work. The bitmap is the catalogue's language,
       not a way of hiding the painting from someone who asked to see it. */
    img.src = realFor(work.image, 1440);
    img.alt = titleOf(work);
    panelArt.appendChild(img);

    /* The name is set apart from the record: it goes under the work in the
       title face, and everything measurable about the piece goes below that. */
    panelTitle.textContent = work.title || "Untitled";

    /* Series and format are how the catalogue is *sorted* — they are in the
       bar's parameters and in LIST, where they do work. Beside the painting
       they were two lines of filing between the name and the object itself. */
    const lines = [
      String(work.year || ""),
      "MATERIAL: " + materialOf(work),
      "SIZE: " + (work.size || "—"),
    ];
    if (work.text) lines.push("", work.text.toUpperCase());

    /* Where this work sits in the walk, and the AR model when the work has
       one — artworks.js has carried ar.enabled all along and nothing was
       offering it. */
    current = work;
    const list = sequence();
    const at = list.findIndex(w => w.id === work.id);
    panelFoot.textContent = "";
    if (work.ar && work.ar.enabled && work.ar.file) {
      const ar = document.createElement("a");
      ar.className = "panel-ar";
      ar.href = "/" + String(work.ar.file).replace(/^\//, "");
      ar.rel = "ar";
      ar.textContent = "VIEW IN AR";
      /* Quick Look needs an <img> child to take over the link on iOS. */
      ar.appendChild(document.createElement("img"));
      panelFoot.appendChild(ar);
    }
    const index = document.createElement("span");
    index.className = "panel-index";
    index.textContent = T.walkLabel(at, list.length);
    panelFoot.appendChild(index);

    hidePreview();
    panel.classList.add("is-open");
    bar.classList.add("is-hidden");          // only ever two things to click
    document.body.style.overflow = "hidden";
    cancelReveal = T.revealWork({
      image: img, title: panelTitle, meta: panelMeta, text: lines.join("\n"),
    });

    if (push) history.pushState({ workId: work.id }, "", "/" + encodeURIComponent(work.id) + "/");
  }

  function closePanel(pop) {
    current = null;
    if (cancelReveal) { cancelReveal(); cancelReveal = null; }
    T.stopTyping();
    panel.classList.remove("is-open");
    bar.classList.remove("is-hidden");
    barUI.measure();
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
  markView(view);

  T.mountPanelNav({
    art: panelArt,
    surface: panel.querySelector(".panel-inner"),
    step: step,
  });

  const opening = works.find(w =>
    w.id === location.pathname.replace(/\/+$/, "").split("/").pop());

  T.runBoot({
    page: "catalogue",
    preload: works.map(w => bitsUrl(w.image)),
    items: visibleWorks(),
    /* The bar's parameters are part of the sequence, not chrome that was
       always there: they arrive once the machine says WELCOME. */
    onParams: () => {
      /* Left closed on touch: the bar spans the width there, and opening it
         unasked pushes the works most of the way off the first screen. */
      if (!T.isTouch) barUI.set("filters");
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
    barUI.rest();
    openPanel(work, true);
  });

  document.getElementById("panel-esc").addEventListener("click", () => closePanel(false));
  document.getElementById("shuffle-btn").addEventListener("click", randomise);

  /* The eye drops the bitmap and shows every work in its real colours, and
     clears the filters so "all" means all. */
  const eyeBtn = document.getElementById("eye-btn");
  eyeBtn.addEventListener("click", () => {
    const on = root.dataset.colour !== "on";
    root.dataset.colour = on ? "on" : "off";
    eyeBtn.setAttribute("aria-pressed", String(on));
    /* toggleAttribute, not .hidden — see the note in terminal-shell.js: these
       are <svg>, which has no `hidden` property to assign to. */
    eyeBtn.querySelectorAll("[data-eye]").forEach(ico => {
      ico.toggleAttribute("hidden", (ico.dataset.eye === "open") !== on);
    });
    if (on) {
      filters.format = null;
      filters.year = null;
      filtersPane.querySelectorAll('[aria-pressed="true"]').forEach(b =>
        b.setAttribute("aria-pressed", "false"));
      render();
    }
  });
  /* Clicking the backdrop closes it: the panel is a box on the catalogue, so
     the catalogue around it should still be a way out. */
  panel.addEventListener("click", e => { if (e.target === panel) closePanel(false); });
  /* Buttons only: the root carries data-view now, and binding this to it would
     make every click anywhere on the page a view switch. */
  document.querySelectorAll("button[data-view]").forEach(b =>
    b.addEventListener("click", () => setView(b.dataset.view)));

  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      if (panel.classList.contains("is-open")) closePanel(false);
      else barUI.rest();
      return;
    }
    if (!panel.classList.contains("is-open")) return;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); step(1); }
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); step(-1); }
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
