/* KRITOR BAG — cart state + drawer UI.

   State lives in localStorage so the bag survives navigation, refreshes and
   the SPA page swaps. The drawer markup is injected by this script, so any
   page that loads cart.js gets the bag button and drawer for free.

   Public API (window.KritorCart):
     add(id, qty)      addItem, clamped to the item's stock
     setQty(id, qty)   set an exact quantity, 0 removes
     remove(id)        drop a line entirely
     lines()           [{item, qty}] resolved against SHOP_ITEMS
     count()           total units in the bag
     subtotal()        total in cents
     currency()        the bag's currency
     clear()           empty it
     open() / close()  drawer
     subscribe(fn)     called on every change, returns an unsubscribe fn
*/
(function () {
  "use strict";

  const KEY = "kritor-bag";
  const listeners = new Set();

  /* ---------- item lookup ---------- */

  function catalogue() {
    return typeof SHOP_ITEMS !== "undefined" && Array.isArray(SHOP_ITEMS) ? SHOP_ITEMS : [];
  }

  function findItem(id) {
    return catalogue().find(i => i.id === id) || null;
  }

  function stockOf(item) {
    return Number.isFinite(item.stock) ? item.stock : 1;
  }

  function maxFor(item) {
    const cap = Number.isFinite(item.maxPerOrder) ? item.maxPerOrder : stockOf(item);
    return Math.max(0, Math.min(cap, stockOf(item)));
  }

  /* ---------- storage ---------- */

  function read() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
      if (!Array.isArray(raw)) return [];
      return raw
        .filter(l => l && typeof l.id === "string" && Number.isFinite(l.qty) && l.qty > 0)
        .map(l => ({id: l.id, qty: Math.floor(l.qty)}));
    } catch (_) { return []; }
  }

  function write(lines) {
    try { localStorage.setItem(KEY, JSON.stringify(lines)); } catch (_) {}
    listeners.forEach(fn => { try { fn(); } catch (_) {} });
    paint();
  }

  /* Drop lines whose item has been delisted or gone out of stock, and clamp
     quantities that exceed what's left. Runs on every read of the resolved
     bag so a stale localStorage bag can never reach checkout. */
  function lines() {
    const resolved = [];
    let changed = false;
    read().forEach(line => {
      const item = findItem(line.id);
      if (!item || maxFor(item) < 1) { changed = true; return; }
      const qty = Math.min(line.qty, maxFor(item));
      if (qty !== line.qty) changed = true;
      resolved.push({item, qty});
    });
    if (changed) {
      try { localStorage.setItem(KEY, JSON.stringify(resolved.map(l => ({id: l.item.id, qty: l.qty})))); } catch (_) {}
    }
    return resolved;
  }

  /* ---------- mutations ---------- */

  function add(id, qty) {
    const item = findItem(id);
    if (!item) return false;
    const max = maxFor(item);
    if (max < 1) return false;
    const current = read();
    const existing = current.find(l => l.id === id);
    const want = (existing ? existing.qty : 0) + Math.max(1, Math.floor(qty || 1));
    if (existing) existing.qty = Math.min(want, max);
    else current.push({id, qty: Math.min(want, max)});
    write(current);
    return true;
  }

  function setQty(id, qty) {
    const n = Math.floor(qty);
    if (!Number.isFinite(n) || n < 1) return remove(id);
    const item = findItem(id);
    if (!item) return remove(id);
    const current = read();
    const existing = current.find(l => l.id === id);
    if (!existing) return add(id, n);
    existing.qty = Math.min(n, maxFor(item));
    write(current);
  }

  function remove(id) {
    write(read().filter(l => l.id !== id));
  }

  function clear() { write([]); }

  function count() { return lines().reduce((n, l) => n + l.qty, 0); }

  function subtotal() { return lines().reduce((n, l) => n + l.item.price * l.qty, 0); }

  function currency() {
    const first = lines()[0];
    return first ? first.item.currency : "AUD";
  }

  /* ---------- formatting ---------- */

  function money(cents, code) {
    const value = (cents || 0) / 100;
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: code || currency(),
        currencyDisplay: "narrowSymbol"
      }).format(value);
    } catch (_) {
      return `$${value.toFixed(2)}`;
    }
  }

  /* ---------- asset paths ---------- */

  /* Pages live at varying depths (/, /store/, /shop/<id>/) so every asset
     reference is rooted rather than relative. */
  function assetPath(path) {
    if (!path) return "";
    return path.startsWith("/") || /^https?:/.test(path) ? path : "/" + path;
  }

  function thumbFor(item) {
    const first = (item.images && item.images[0]) || "";
    if (!first) return "";
    /* A bag line is ~100px, so ask the build manifest for a small rendition
       rather than guessing at a path that may not exist. */
    return window.KritorTileImage ? window.KritorTileImage.pick(first, 240) : assetPath(first);
  }

  /* ---------- drawer UI ---------- */

  let root = null;
  let button = null;

  function ensureUI() {
    if (root || !document.body) return;
    /* A page opts into the bag by putting [data-bag-slot] where the button
       should sit. Pages without one — the catalogue, About — get no bag, which
       also keeps the SPA from growing one when you navigate back out of the
       store. */
    const slot = document.querySelector("[data-bag-slot]");
    if (!slot) return;
    root = document.createElement("div");
    root.className = "bag-root is-slotted";
    root.innerHTML = `
      <button class="bag-button" type="button" aria-label="Open bag" aria-haspopup="dialog">
        <svg class="bag-icon" viewBox="0 0 20 22" aria-hidden="true" focusable="false">
          <path d="M2.6 6.4h14.8l-1.15 14.1H3.75z"/>
          <path d="M6.9 6.4V4.7a3.1 3.1 0 0 1 6.2 0v1.7"/>
        </svg>
        <span class="bag-count" aria-hidden="true">0</span>
      </button>
      <div class="bag-scrim" hidden></div>
      <aside class="bag-drawer" role="dialog" aria-modal="true" aria-label="Your bag" hidden>
        <header class="bag-head">
          <span>Bag</span>
          <button class="bag-close" type="button" aria-label="Close bag">Close</button>
        </header>
        <div class="bag-lines"></div>
        <footer class="bag-foot">
          <div class="bag-subtotal"><span>Subtotal</span><span class="bag-subtotal-value">—</span></div>
          <p class="bag-note">Shipping and any duties calculated at checkout.</p>
          <a class="bag-checkout" href="/checkout/">Checkout</a>
        </footer>
      </aside>`;
    document.body.appendChild(root);

    /* Move just the button into the header slot; the drawer and scrim stay on
       body so no header stacking context can clip them. */
    button = root.querySelector(".bag-button");
    slot.appendChild(button);

    button.addEventListener("click", open);
    root.querySelector(".bag-close").addEventListener("click", close);
    root.querySelector(".bag-scrim").addEventListener("click", close);

    root.querySelector(".bag-lines").addEventListener("click", event => {
      const button = event.target.closest("button[data-bag-action]");
      if (!button) return;
      const id = button.dataset.bagId;
      const line = lines().find(l => l.item.id === id);
      if (!line) return;
      const action = button.dataset.bagAction;
      if (action === "inc") setQty(id, line.qty + 1);
      else if (action === "dec") setQty(id, line.qty - 1);
      else if (action === "remove") remove(id);
    });

    document.addEventListener("keydown", event => {
      if (event.key === "Escape") close();
    });

    paint();
  }

  function open() {
    if (!root) return;
    root.querySelector(".bag-scrim").hidden = false;
    const drawer = root.querySelector(".bag-drawer");
    drawer.hidden = false;
    requestAnimationFrame(() => root.classList.add("is-open"));
    document.documentElement.classList.add("bag-locked");
  }

  function close() {
    if (!root || !root.classList.contains("is-open")) return;
    root.classList.remove("is-open");
    document.documentElement.classList.remove("bag-locked");
    const drawer = root.querySelector(".bag-drawer");
    const scrim = root.querySelector(".bag-scrim");
    setTimeout(() => {
      if (root.classList.contains("is-open")) return;
      drawer.hidden = true;
      scrim.hidden = true;
    }, 420);
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, c => (
      {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]
    ));
  }

  function paint() {
    if (!root || !button) return;
    const all = lines();
    const units = all.reduce((n, l) => n + l.qty, 0);

    button.querySelector(".bag-count").textContent = String(units);
    button.classList.toggle("has-items", units > 0);

    const body = root.querySelector(".bag-lines");
    if (!all.length) {
      body.innerHTML = `<p class="bag-empty">Your bag is empty.</p>`;
    } else {
      body.innerHTML = all.map(({item, qty}) => {
        const max = maxFor(item);
        return `
          <div class="bag-line">
            <a class="bag-line-image" href="/shop/${encodeURIComponent(item.id)}/">
              <img src="${escapeHtml(thumbFor(item))}" alt="${escapeHtml(item.title)}" loading="lazy"
                   onerror="this.onerror=null;this.src='${escapeHtml(assetPath((item.images || [])[0]))}'">
            </a>
            <div class="bag-line-body">
              <a class="bag-line-title" href="/shop/${encodeURIComponent(item.id)}/">${escapeHtml(item.title)}</a>
              <span class="bag-line-meta">${escapeHtml(item.edition || "")}${item.size ? " · " + escapeHtml(item.size) : ""}</span>
              <div class="bag-qty" role="group" aria-label="Quantity for ${escapeHtml(item.title)}">
                <button type="button" data-bag-action="dec" data-bag-id="${escapeHtml(item.id)}" aria-label="Decrease quantity">−</button>
                <span aria-live="polite">${qty}</span>
                <button type="button" data-bag-action="inc" data-bag-id="${escapeHtml(item.id)}" aria-label="Increase quantity" ${qty >= max ? "disabled" : ""}>+</button>
              </div>
            </div>
            <div class="bag-line-right">
              <span class="bag-line-price">${escapeHtml(money(item.price * qty, item.currency))}</span>
              <button class="bag-line-remove" type="button" data-bag-action="remove" data-bag-id="${escapeHtml(item.id)}">Remove</button>
            </div>
          </div>`;
      }).join("");
    }

    root.querySelector(".bag-subtotal-value").textContent = all.length ? money(subtotal()) : "—";
    root.querySelector(".bag-checkout").classList.toggle("is-disabled", !all.length);
  }

  /* Another tab changed the bag. */
  window.addEventListener("storage", event => {
    if (event.key === KEY) { paint(); listeners.forEach(fn => { try { fn(); } catch (_) {} }); }
  });

  /* The SPA replaces document.body on navigation, which takes the drawer with
     it — rebuild on each swap. */
  /* Rebuild against the current body. Any previous root is discarded first —
     on a fresh page load this is a no-op, and after an SPA swap it stops a
     second drawer being stacked on top of the old one. */
  function attach() {
    document.querySelectorAll(".bag-root").forEach(node => node.remove());
    document.querySelectorAll("[data-bag-slot] .bag-button").forEach(node => node.remove());
    root = null;
    button = null;
    ensureUI();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", attach);
  else attach();
  window.addEventListener("kritor:page-rendered", attach);

  window.KritorCart = {
    add, setQty, remove, clear, lines, count, subtotal, currency,
    money, maxFor, thumbFor, assetPath, open, close,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  };
})();
