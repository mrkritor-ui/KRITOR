/* KRITOR — the store shopfront, on the same terminal shell as the catalogue.

   Only /store/ is reskinned here. The product pages, the bag and the checkout
   are a working payment path and are deliberately left alone; they are the
   next piece of the redesign, not collateral of this one.

   The store's inventory is independent of the catalogue by design (see
   products.js), so this builds its 1-bit tiles from the shop images rather
   than looking anything up in the archive. */
(function () {
  "use strict";

  const T = window.KritorTerminal;
  const grid = document.getElementById("grid");

  const items = (typeof SHOP_ITEMS !== "undefined" && Array.isArray(SHOP_ITEMS))
    ? SHOP_ITEMS.filter(item => !item.unlisted)
    : [];

  const soldOut = item => !(Number.isFinite(item.stock) ? item.stock : 1);
  const firstImage = item => (item.images || [])[0] || "";
  const titleOf = item => (item.title || item.id || "UNTITLED").toUpperCase();

  const priceOf = item => {
    if (!Number.isFinite(item.price)) return "—";
    const amount = (item.price / 100).toFixed(2).replace(/\.00$/, "");
    return "$" + amount + " " + String(item.currency || "").toUpperCase();
  };

  const bitsEntry = path =>
    (typeof TERMINAL_MANIFEST !== "undefined" ? TERMINAL_MANIFEST[path] : null) || null;
  const bitsUrl = path => {
    const e = bitsEntry(path);
    if (e) return "/" + e.url;
    return window.KritorTileImage ? window.KritorTileImage.pick(path, 240)
                                  : "/" + String(path).replace(/^\//, "");
  };

  function tileFor(item) {
    const a = document.createElement("a");
    a.className = "tile";
    a.href = "/shop/" + encodeURIComponent(item.id) + "/";
    if (soldOut(item)) a.classList.add("is-sold-out");
    a.setAttribute("aria-label", titleOf(item) + ", " + priceOf(item));

    const figure = document.createElement("figure");
    figure.className = "tile-figure";

    const path = firstImage(item);
    const bits = document.createElement("div");
    bits.className = "tile-bits";
    bits.setAttribute("role", "img");
    bits.setAttribute("aria-label", titleOf(item));
    const entry = bitsEntry(path);
    bits.style.setProperty("--bits", 'url("' + bitsUrl(path) + '")');
    bits.style.aspectRatio = entry ? entry.w + " / " + entry.h : "1 / 1";
    figure.appendChild(bits);

    const real = document.createElement("img");
    real.className = "tile-real";
    real.alt = "";
    real.loading = "lazy";
    real.decoding = "async";
    real.src = window.KritorTileImage ? window.KritorTileImage.pick(path, 480) : bitsUrl(path);
    figure.appendChild(real);

    a.appendChild(figure);

    /* The catalogue's tiles carry no caption — a work is looked at. A listing
       has to say what it is and what it costs, so the store's do. */
    const caption = document.createElement("span");
    caption.className = "tile-caption";
    caption.textContent = titleOf(item) + " · " + (soldOut(item) ? "SOLD OUT" : priceOf(item));
    a.appendChild(caption);

    return a;
  }

  document.documentElement.dataset.reveal = "on";
  grid.classList.add("has-captions");
  T.initTheme();

  const filtersPane = document.getElementById("filters-pane");
  const infoPane = document.getElementById("info-pane");
  const infoBtn = document.getElementById("info-btn");
  const drawer = document.getElementById("drawer");
  const scrollFill = document.getElementById("scroll-fill");

  function openDrawer(which) {
    const showingInfo = which === "info";
    if (drawer.classList.contains("is-open") && infoPane.hidden !== showingInfo) {
      drawer.classList.remove("is-open");
      infoBtn.setAttribute("aria-pressed", "false");
      return;
    }
    drawer.classList.add("is-open");
    infoPane.hidden = !showingInfo;
    filtersPane.hidden = showingInfo;
    infoBtn.setAttribute("aria-pressed", String(showingInfo));
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

  function line(list, text, href) {
    const el = document.createElement(href ? "a" : "span");
    el.className = "bar-btn";
    el.textContent = text;
    if (href) el.href = href;
    list.appendChild(el);
  }

  filtersPane.appendChild(column("CATALOGUE", list => line(list, "ENTER CATALOGUE", "/")));
  filtersPane.appendChild(column("AVAILABLE", list => {
    line(list, String(items.filter(i => !soldOut(i)).length).padStart(2, "0") + " FOR SALE");
    line(list, String(items.filter(soldOut).length).padStart(2, "0") + " SOLD OUT");
  }));
  filtersPane.appendChild(column("SHIPPING", list => {
    line(list, "AUSTRALIA");
    line(list, "WORLDWIDE");
  }));

  T.runBoot({
    preload: items.map(item => bitsUrl(firstImage(item))),
    items: items,
    onParams: () => openDrawer("filters"),
    onDeal: item => grid.appendChild(tileFor(item)),
  });

  document.getElementById("bar-tab").addEventListener("click", () => openDrawer("filters"));
  infoBtn.addEventListener("click", () => openDrawer("info"));

  window.addEventListener("scroll", () => {
    const max = document.body.scrollHeight - window.innerHeight;
    scrollFill.style.width = (max > 0 ? (window.scrollY / max) * 100 : 0) + "%";
  }, { passive: true });

  T.startScreensaver(items.map(item => {
    const e = bitsEntry(firstImage(item));
    return { url: bitsUrl(firstImage(item)), w: e ? e.w : 1, h: e ? e.h : 1 };
  }));
})();
