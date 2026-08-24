/* KRITOR — the store, on the same terminal shell as the catalogue.

   The whole shopfront lives on one page: the grid, the work window, the bag.
   Nothing navigates except the checkout, which stays its own page because it
   carries Stripe, a Content-Security-Policy and a live payment path — none of
   which belongs inside a panel on the shopfront.

   Cart state is cart.js, unchanged. It injects its own drawer only when a page
   provides [data-bag-slot]; this page provides none, so it is used purely as
   the state layer and the bag below is the terminal's own. */
(function () {
  "use strict";

  const T = window.KritorTerminal;
  const cart = window.KritorCart;
  const root = document.documentElement;
  const grid = document.getElementById("grid");

  const items = (typeof SHOP_ITEMS !== "undefined" && Array.isArray(SHOP_ITEMS))
    ? SHOP_ITEMS.filter(item => !item.unlisted)
    : [];

  const stockOf = item => (Number.isFinite(item.stock) ? item.stock : 1);
  const soldOut = item => stockOf(item) <= 0;
  const firstImage = item => (item.images || [])[0] || "";
  const nameOf = item => item.title || item.id || "Untitled";
  const money = cents => cart.money(cents, cart.currency());

  const bitsEntry = path =>
    (typeof TERMINAL_MANIFEST !== "undefined" ? TERMINAL_MANIFEST[path] : null) || null;
  const bitsUrl = path => {
    const e = bitsEntry(path);
    if (e) return "/" + e.url;
    return window.KritorTileImage ? window.KritorTileImage.pick(path, 240)
                                  : "/" + String(path).replace(/^\//, "");
  };
  const realFor = (path, width) =>
    window.KritorTileImage ? window.KritorTileImage.pick(path, width || 640)
                           : "/" + String(path).replace(/^\//, "");

  /* ── Tiles ─────────────────────────────────────────────────────────────── */

  function tileFor(item) {
    const path = firstImage(item);
    const a = document.createElement("a");
    a.className = "tile";
    a.href = "/shop/" + encodeURIComponent(item.id) + "/";
    a.dataset.itemId = item.id;
    if (soldOut(item)) a.classList.add("is-sold-out");
    a.setAttribute("aria-label", nameOf(item) + ", " + money(item.price));

    const figure = document.createElement("figure");
    figure.className = "tile-figure";

    const bits = document.createElement("div");
    bits.className = "tile-bits";
    bits.setAttribute("role", "img");
    bits.setAttribute("aria-label", nameOf(item));
    const entry = bitsEntry(path);
    bits.style.setProperty("--bits", 'url("' + bitsUrl(path) + '")');
    bits.style.aspectRatio = entry ? entry.w + " / " + entry.h : "1 / 1";
    figure.appendChild(bits);

    const real = document.createElement("img");
    real.className = "tile-real";
    real.alt = "";
    real.loading = "lazy";
    real.decoding = "async";
    real.src = realFor(path, 480);
    figure.appendChild(real);

    /* Attached to the work, always on screen. Putting it behind a hover would
       hide the only thing this page exists to do. */
    const add = document.createElement("button");
    add.type = "button";
    add.className = "tile-add";
    add.textContent = "+";
    add.disabled = soldOut(item);
    add.setAttribute("aria-label", "Add " + nameOf(item) + " to bag");
    add.addEventListener("click", e => {
      e.preventDefault();
      e.stopPropagation();          // the tile itself opens the window
      cart.add(item.id, 1);
      openBag();
    });
    figure.appendChild(add);

    a.appendChild(figure);

    const caption = document.createElement("span");
    caption.className = "tile-caption";
    const name = document.createElement("span");
    name.className = "tile-name";
    name.textContent = nameOf(item);
    const detail = document.createElement("span");
    detail.className = "tile-detail";
    detail.textContent = [
      item.year, item.size, item.edition,
      soldOut(item) ? "SOLD OUT" : money(item.price),
    ].filter(Boolean).join("  ·  ").toUpperCase();
    caption.append(name, detail);
    a.appendChild(caption);

    return a;
  }

  /* ── The work window ───────────────────────────────────────────────────── */

  const panel = document.getElementById("panel");
  const panelArt = document.getElementById("panel-art");
  const panelTitle = document.getElementById("panel-title");
  const panelMeta = document.getElementById("panel-meta");
  const panelBuy = document.getElementById("panel-buy");
  const panelFoot = document.getElementById("panel-foot");
  let cancelReveal = null;
  let panelItem = null;
  let panelQty = 1;

  /* The store walks in the order the shopfront is laid out — there are no
     series here to hold together, and an order that did not match the grid
     would read as a shuffle. */
  function step(delta) {
    if (!panelItem || !items.length) return;
    const at = items.findIndex(i => i.id === panelItem.id);
    openPanel(items[((at < 0 ? 0 : at) + delta + items.length) % items.length]);
  }

  function openPanel(item) {
    if (cancelReveal) cancelReveal();
    panelItem = item;
    panelQty = 1;

    /* Only the work is replaced. The two halves that walk the sequence are
       mounted once and live in here, and emptying the box took them with it. */
    const previous = panelArt.querySelector("img");
    if (previous) previous.remove();
    const img = document.createElement("img");
    img.src = realFor(firstImage(item), 1440);
    img.alt = nameOf(item);
    panelArt.appendChild(img);

    panelTitle.textContent = nameOf(item);

    const lines = [
      String(item.year || ""),
      "MATERIAL: " + String(item.materials || "—").toUpperCase(),
      "SIZE: " + String(item.size || "—").toUpperCase(),
      "EDITION: " + String(item.edition || "ORIGINAL").toUpperCase(),
      soldOut(item) ? "SOLD OUT" : money(item.price),
    ].filter(Boolean);
    if (item.shipping) lines.push("", String(item.shipping).toUpperCase());

    paintBuy();
    if (panelFoot) {
      panelFoot.textContent = "";
      const index = document.createElement("span");
      index.className = "panel-index";
      index.textContent = T.walkLabel(items.findIndex(i => i.id === item.id), items.length);
      panelFoot.appendChild(index);
    }
    panel.classList.add("is-open");
    document.getElementById("bar").classList.add("is-hidden");
    document.body.style.overflow = "hidden";
    cancelReveal = T.revealWork({
      image: img, title: panelTitle, meta: panelMeta, text: lines.join("\n"),
    });
  }

  /* Quantity and the add button, rebuilt whenever either could have changed —
     the cap is the item's stock less whatever is already in the bag. */
  function paintBuy() {
    if (!panelItem) return;
    panelBuy.textContent = "";
    if (soldOut(panelItem)) {
      const out = document.createElement("span");
      out.className = "panel-add";
      out.textContent = "SOLD OUT";
      panelBuy.appendChild(out);
      return;
    }

    const inBag = (cart.lines().find(l => l.item.id === panelItem.id) || {}).qty || 0;
    const room = Math.max(0, cart.maxFor(panelItem) - inBag);
    panelQty = Math.min(Math.max(1, panelQty), Math.max(1, room));

    const qty = document.createElement("div");
    qty.className = "qty";
    const minus = document.createElement("button");
    minus.type = "button";
    minus.textContent = "-";
    minus.disabled = panelQty <= 1;
    minus.setAttribute("aria-label", "Fewer");
    const out = document.createElement("output");
    out.textContent = String(panelQty).padStart(2, "0");
    const plus = document.createElement("button");
    plus.type = "button";
    plus.textContent = "+";
    plus.disabled = panelQty >= room;
    plus.setAttribute("aria-label", "More");
    minus.addEventListener("click", () => { panelQty -= 1; paintBuy(); });
    plus.addEventListener("click", () => { panelQty += 1; paintBuy(); });
    qty.append(minus, out, plus);

    const add = document.createElement("button");
    add.type = "button";
    add.className = "panel-add";
    add.textContent = room ? "ADD TO BAG" : "IN BAG";
    add.disabled = !room;
    add.addEventListener("click", () => {
      cart.add(panelItem.id, panelQty);
      closePanel();
      openBag();
    });

    panelBuy.append(qty, add);
  }

  function closePanel() {
    if (cancelReveal) { cancelReveal(); cancelReveal = null; }
    panelItem = null;
    panel.classList.remove("is-open");
    document.getElementById("bar").classList.remove("is-hidden");
    barUI.measure();
    document.body.style.overflow = "";
  }

  /* ── Bag ───────────────────────────────────────────────────────────────── */

  const bag = document.getElementById("bag");
  const bagLines = document.getElementById("bag-lines");
  const bagFoot = document.getElementById("bag-foot");
  const bagBtn = document.getElementById("bag-btn");
  const bagCount = document.getElementById("bag-count");

  /* The bag and the bar's drawer both hang from the top right, so opening one
     shuts the other and the bag is parked directly under whatever the bar is
     currently showing. Two panels fighting for the same corner is worse than
     either. */
  function openBag() {
    barUI.rest();
    bag.style.top = Math.round(bar.getBoundingClientRect().bottom + 8) + "px";
    bag.classList.add("is-open");
  }

  const closeBag = () => bag.classList.remove("is-open");

  function paintBag() {
    const all = cart.lines();
    bagCount.textContent = String(cart.count()).padStart(2, "0");

    bagLines.textContent = "";
    if (!all.length) {
      const empty = document.createElement("p");
      empty.className = "bag-empty";
      empty.textContent = "THE BAG IS EMPTY.";
      bagLines.appendChild(empty);
    }

    all.forEach(line => {
      const row = document.createElement("div");
      row.className = "bag-line";

      const thumb = document.createElement("div");
      thumb.className = "bag-thumb";
      thumb.style.setProperty("--bits", 'url("' + bitsUrl(firstImage(line.item)) + '")');
      row.appendChild(thumb);

      const label = document.createElement("div");
      const name = document.createElement("span");
      name.className = "bag-line-name";
      name.textContent = nameOf(line.item);
      const price = document.createElement("span");
      price.className = "bag-line-price";
      price.textContent = money(line.item.price * line.qty);
      label.append(name, price);
      row.appendChild(label);

      const qty = document.createElement("div");
      qty.className = "qty";
      const minus = document.createElement("button");
      minus.type = "button";
      minus.textContent = "-";
      minus.setAttribute("aria-label", "Fewer " + nameOf(line.item));
      const out = document.createElement("output");
      out.textContent = String(line.qty).padStart(2, "0");
      const plus = document.createElement("button");
      plus.type = "button";
      plus.textContent = "+";
      plus.disabled = line.qty >= cart.maxFor(line.item);
      plus.setAttribute("aria-label", "More " + nameOf(line.item));
      /* Down to zero removes the line: a bag with a 00 in it is a bug, not a
         state anyone wants to look at. */
      minus.addEventListener("click", () => cart.setQty(line.item.id, line.qty - 1));
      plus.addEventListener("click", () => cart.setQty(line.item.id, line.qty + 1));
      qty.append(minus, out, plus);
      row.appendChild(qty);

      bagLines.appendChild(row);
    });

    bagFoot.textContent = "";
    const total = document.createElement("div");
    total.className = "bag-total";
    const label = document.createElement("span");
    label.textContent = "SUBTOTAL";
    const value = document.createElement("span");
    value.textContent = money(cart.subtotal());
    total.append(label, value);

    const go = document.createElement("a");
    go.className = "bag-go";
    go.href = "/checkout/";
    go.textContent = "CHECKOUT";
    go.classList.toggle("is-disabled", !all.length);

    bagFoot.append(total, go);
    if (panelItem) paintBuy();
  }

  /* ── Bar ───────────────────────────────────────────────────────────────── */

  const filtersPane = document.getElementById("filters-pane");
  const bar = document.getElementById("bar");
  const scrollFill = document.getElementById("scroll-fill");
  const barUI = T.mountBar();

  function line(list, text, href) {
    const el = document.createElement(href ? "a" : "span");
    el.className = "bar-btn";
    el.textContent = text;
    if (href) el.href = href;
    list.appendChild(el);
  }

  filtersPane.appendChild(T.filterColumn("CATALOGUE", list => line(list, "ENTER CATALOGUE", "/")));
  filtersPane.appendChild(T.filterColumn("AVAILABLE", list => {
    line(list, String(items.filter(i => !soldOut(i)).length).padStart(2, "0") + " FOR SALE");
    line(list, String(items.filter(soldOut).length).padStart(2, "0") + " SOLD OUT");
  }));
  filtersPane.appendChild(T.filterColumn("SHIPPING", list => {
    line(list, "AUSTRALIA");
    line(list, "WORLDWIDE");
  }));

  /* ── Wiring ────────────────────────────────────────────────────────────── */

  root.dataset.reveal = "on";
  grid.classList.add("has-captions");
  T.initTheme();

  T.runBoot({
    page: "store",
    preload: items.map(item => bitsUrl(firstImage(item))),
    items: items,
    onParams: () => { if (!T.isTouch) barUI.set("filters"); },
    onDeal: item => grid.appendChild(tileFor(item)),
  });

  grid.addEventListener("click", e => {
    const tile = e.target.closest("a.tile");
    if (!tile || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const item = items.find(i => i.id === tile.dataset.itemId);
    if (!item) return;
    e.preventDefault();
    openPanel(item);
  });

  document.getElementById("panel-esc").addEventListener("click", closePanel);
  panel.addEventListener("click", e => { if (e.target === panel) closePanel(); });

  T.mountPanelNav({
    art: panelArt,
    surface: panel.querySelector(".panel-inner"),
    step: step,
  });
  bagBtn.addEventListener("click", () =>
    bag.classList.contains("is-open") ? closeBag() : openBag());
  document.getElementById("bag-close").addEventListener("click", closeBag);

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
  });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      if (panel.classList.contains("is-open")) closePanel();
      else if (bag.classList.contains("is-open")) closeBag();
      return;
    }
    /* The same walk the two halves and the swipe make, for a keyboard. */
    if (!panel.classList.contains("is-open")) return;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); step(1); }
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); step(-1); }
  });

  cart.subscribe(paintBag);
  paintBag();

  window.addEventListener("scroll", () => {
    const max = document.body.scrollHeight - window.innerHeight;
    scrollFill.style.width = (max > 0 ? (window.scrollY / max) * 100 : 0) + "%";
  }, { passive: true });

  T.startScreensaver(items.map(item => {
    const e = bitsEntry(firstImage(item));
    return { url: bitsUrl(firstImage(item)), w: e ? e.w : 1, h: e ? e.h : 1 };
  }));
})();
