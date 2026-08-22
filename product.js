/* KRITOR STORE — product page.

   Same field layout as a catalogue work page, plus price, a quantity stepper
   and add-to-bag. Resolves its item from /shop/<id>/ or ?id=<id>. */
(function () {
  "use strict";

  const page = document.getElementById("product-page");
  if (!page) return;

  function idFromLocation() {
    const query = new URLSearchParams(location.search).get("id");
    if (query) return query;
    const parts = location.pathname.replace(/\/+$/, "").split("/");
    const last = parts[parts.length - 1];
    return last && last !== "shop" ? decodeURIComponent(last) : "";
  }

  const id = idFromLocation();
  const item = (typeof SHOP_ITEMS !== "undefined" ? SHOP_ITEMS : []).find(i => i.id === id);

  if (!item) {
    page.innerHTML = `<div class="work"><p class="product-missing">Item not found. <a href="/store/">Return to store</a></p></div>`;
    return;
  }

  document.title = `${item.title || "KRITOR"} — KRITOR`;

  const cart = window.KritorCart;
  const assetPath = cart ? cart.assetPath : p => (p && !p.startsWith("/") ? "/" + p : p || "");
  const money = cart ? cart.money : c => `$${((c || 0) / 100).toFixed(2)}`;
  const max = cart ? cart.maxFor(item) : (item.stock || 0);
  const soldOut = max < 1;

  /* Renditions from the build manifest; the inspect view keeps the original so
     pinch-zoom still reaches full detail. */
  const rendition = (path, width) =>
    window.KritorTileImage ? window.KritorTileImage.pick(path, width) : assetPath(path);
  const sources = item.images || [];
  const images = sources.map(assetPath);
  const hero = sources.length ? rendition(sources[0], 1440) : "";

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, c => (
      {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]
    ));
  }

  function row(label, value) {
    return value ? `<span class="label">${esc(label)}</span><span>${esc(value)}</span>` : "";
  }

  const details = [
    row("Edition", item.edition),
    row("Materials", item.materials),
    row("Size", item.size),
    row("Shipping", item.shipping)
  ].join("");

  page.innerHTML = `
    <div class="work">
      <div class="art-wrap" id="art-wrap">
        <img class="art" id="hero-image" src="${esc(hero)}" alt="${esc(item.title || "Product")}">
      </div>
      ${sources.length > 1 ? `<div class="product-gallery">${sources.map((path, index) =>
        `<button type="button" class="product-thumb${index === 0 ? " is-active" : ""}" data-src="${esc(rendition(path, 1440))}" aria-label="View image ${index + 1}">
           <img src="${esc(rendition(path, 240))}" alt="" loading="lazy" decoding="async">
         </button>`).join("")}</div>` : ""}
      <section class="meta">
        <div class="title">${esc(item.title || "Untitled")}</div>
        <div class="year">${esc(item.year || "")}</div>
        <div class="product-price">${esc(money(item.price, item.currency))}</div>
        <div class="details">${details}</div>
        ${item.description ? `<button class="text-toggle" id="text-toggle">Text — click to reveal</button><div class="text" id="text">${esc(item.description)}</div>` : ""}
        ${soldOut ? `<p class="product-soldout">Sold out</p>` : `
        <div class="product-buy">
          <div class="product-qty" role="group" aria-label="Quantity">
            <button type="button" id="qty-dec" aria-label="Decrease quantity">−</button>
            <span id="qty-value" aria-live="polite">1</span>
            <button type="button" id="qty-inc" aria-label="Increase quantity">+</button>
          </div>
          <button type="button" class="product-add" id="add-to-bag">Add to bag</button>
        </div>
        ${max <= 3 ? `<p class="product-stock">${max === 1 ? "One available" : `Only ${max} available`}</p>` : ""}`}
      </section>
    </div>
    <div class="inspect" id="inspect"><img id="inspect-img" src="${esc(hero)}" alt=""></div>`;

  /* ---------- gallery ---------- */

  const heroImage = document.getElementById("hero-image");
  const inspectImage = document.getElementById("inspect-img");

  page.querySelectorAll(".product-thumb").forEach(button => {
    button.addEventListener("click", () => {
      const src = button.dataset.src;
      heroImage.src = src;
      inspectImage.src = src;
      page.querySelectorAll(".product-thumb").forEach(b => b.classList.toggle("is-active", b === button));
    });
  });

  const toggle = document.getElementById("text-toggle");
  if (toggle) toggle.onclick = () => document.getElementById("text").classList.toggle("open");

  /* ---------- quantity + add to bag ---------- */

  if (!soldOut) {
    const value = document.getElementById("qty-value");
    const dec = document.getElementById("qty-dec");
    const inc = document.getElementById("qty-inc");
    const add = document.getElementById("add-to-bag");
    let qty = 1;

    function paintQty() {
      value.textContent = String(qty);
      dec.disabled = qty <= 1;
      inc.disabled = qty >= max;
    }

    dec.addEventListener("click", () => { if (qty > 1) { qty--; paintQty(); } });
    inc.addEventListener("click", () => { if (qty < max) { qty++; paintQty(); } });

    add.addEventListener("click", () => {
      if (!cart) return;
      cart.add(item.id, qty);
      add.textContent = "Added";
      add.classList.add("is-added");
      setTimeout(() => {
        add.textContent = "Add to bag";
        add.classList.remove("is-added");
      }, 1400);
      cart.open();
    });

    paintQty();
  }

  /* ---------- pinch to inspect (matches the catalogue work page) ---------- */

  const wrap = document.getElementById("art-wrap");
  const inspect = document.getElementById("inspect");
  let scale = 1, tx = 0, ty = 0, startScale = 1, startTx = 0, startTy = 0;
  let startMid = null, gestureDistance = 0, lastX = 0, lastY = 0, pinching = false, resetTimer = null;

  const render = () => { inspectImage.style.transform = `translate3d(${tx}px,${ty}px,0) scale(${scale})`; };
  const midpoint = (a, b) => ({x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2});
  const distance = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

  function clampPan() {
    const r = inspectImage.getBoundingClientRect();
    const maxX = Math.max(0, (r.width - innerWidth) / 2);
    const maxY = Math.max(0, (r.height - innerHeight) / 2);
    tx = Math.max(-maxX, Math.min(maxX, tx));
    ty = Math.max(-maxY, Math.min(maxY, ty));
  }

  function open() {
    clearTimeout(resetTimer);
    inspect.classList.add("active");
    inspect.classList.remove("resetting");
    document.body.style.overflow = "hidden";
    scale = 1; tx = 0; ty = 0;
    render();
  }

  function resetAndClose() {
    if (!inspect.classList.contains("active")) return;
    inspect.classList.add("resetting");
    scale = 1; tx = 0; ty = 0;
    render();
    resetTimer = setTimeout(() => {
      inspect.classList.remove("active", "resetting");
      document.body.style.overflow = "";
    }, 650);
  }

  function beginPinch(a, b) {
    pinching = true;
    open();
    gestureDistance = Math.max(1, distance(a, b));
    startScale = 1; startTx = 0; startTy = 0;
    startMid = midpoint(a, b);
  }

  function movePinch(a, b) {
    const d = Math.max(1, distance(a, b));
    const m = midpoint(a, b);
    const ratio = d / gestureDistance;
    const next = Math.max(1, Math.min(5, startScale * ratio));
    const cx = innerWidth / 2, cy = innerHeight / 2;
    tx = startTx + (startMid.x - cx) * (1 - next / startScale) + (m.x - startMid.x);
    ty = startTy + (startMid.y - cy) * (1 - next / startScale) + (m.y - startMid.y);
    scale = next;
    clampPan();
    render();
  }

  wrap.addEventListener("touchstart", e => {
    if (e.touches.length === 2) { e.preventDefault(); beginPinch(e.touches[0], e.touches[1]); }
  }, {passive: false});

  wrap.addEventListener("touchmove", e => {
    if (e.touches.length === 2) { e.preventDefault(); movePinch(e.touches[0], e.touches[1]); }
  }, {passive: false});

  wrap.addEventListener("touchend", e => {
    if (pinching && e.touches.length === 0) { pinching = false; setTimeout(resetAndClose, 120); }
  }, {passive: true});

  inspect.addEventListener("touchstart", e => {
    e.preventDefault();
    if (e.touches.length === 2) {
      clearTimeout(resetTimer);
      pinching = true;
      gestureDistance = Math.max(1, distance(e.touches[0], e.touches[1]));
      startScale = scale; startTx = tx; startTy = ty;
      startMid = midpoint(e.touches[0], e.touches[1]);
    } else if (e.touches.length === 1 && scale > 1) {
      lastX = e.touches[0].clientX; lastY = e.touches[0].clientY;
    }
  }, {passive: false});

  inspect.addEventListener("touchmove", e => {
    e.preventDefault();
    if (e.touches.length === 2) movePinch(e.touches[0], e.touches[1]);
    else if (e.touches.length === 1 && scale > 1 && !pinching) {
      tx += e.touches[0].clientX - lastX;
      ty += e.touches[0].clientY - lastY;
      lastX = e.touches[0].clientX; lastY = e.touches[0].clientY;
      clampPan();
      render();
    }
  }, {passive: false});

  inspect.addEventListener("touchend", e => {
    if (e.touches.length === 0) { pinching = false; setTimeout(resetAndClose, 120); }
    else if (e.touches.length === 1) { pinching = false; lastX = e.touches[0].clientX; lastY = e.touches[0].clientY; }
  }, {passive: true});

  document.addEventListener("keydown", e => { if (e.key === "Escape") resetAndClose(); });
})();
