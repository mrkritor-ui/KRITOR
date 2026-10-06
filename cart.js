/* KRITOR BAG — cart state.

   State lives in localStorage so the bag survives navigation and refreshes,
   and a change in one tab reaches the others (and see load/save below for
   what happens where localStorage is refused). There is no UI here: the store's
   own bag (terminal-store.js) and the checkout's summary (checkout.js) both
   paint from this and subscribe to it. A drawer used to be injected here for
   any page that provided [data-bag-slot]; none ever did once the store moved
   onto the terminal shell, so it was deleted rather than kept reachable only
   in theory.

   Public API (window.KritorCart):
     add(id, qty)      addItem, clamped to the item's stock
     setQty(id, qty)   set an exact quantity, 0 removes
     remove(id)        drop a line entirely
     lines()           [{item, qty}] resolved against SHOP_ITEMS
     count()           total units in the bag
     subtotal()        total in cents
     currency()        the bag's currency
     clear()           empty it
     maxFor(item)      the most of an item that can be bagged
     money(cents, code)   formatted for display
     thumbFor(item)    a small rendition URL for a bag line
     assetPath(path)   a site-rooted asset URL
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

  function notify() {
    listeners.forEach(fn => { try { fn(); } catch (_) {} });
  }

  /* localStorage can throw on every touch — Safari with all cookies blocked,
     some embedded browsers — and an ADD TO BAG that quietly does nothing is a
     lost sale. When it does, the bag is kept in memory for the page and rides
     window.name to the next one: a tab keeps that across same-site hops with
     no storage permission at all, and the bag only ever has to get from the
     store to the checkout. Prices are never taken from here — the worker
     re-prices every order from its own catalogue. */
  const CARRY = "kritor-bag=";
  let memory = null;

  function load() {
    if (memory !== null) return memory;
    try {
      const stored = localStorage.getItem(KEY);
      if (stored !== null) return stored;
    } catch (_) {}
    try {
      if (window.name.indexOf(CARRY) === 0) return window.name.slice(CARRY.length);
    } catch (_) {}
    return null;
  }

  function save(json) {
    try { localStorage.setItem(KEY, json); memory = null; return; } catch (_) {}
    memory = json;
    try { if (!window.name || window.name.indexOf(CARRY) === 0) window.name = CARRY + json; } catch (_) {}
  }

  function read() {
    try {
      const raw = JSON.parse(load() || "[]");
      if (!Array.isArray(raw)) return [];
      return raw
        .filter(l => l && typeof l.id === "string" && Number.isFinite(l.qty) && l.qty > 0)
        .map(l => ({id: l.id, qty: Math.floor(l.qty)}));
    } catch (_) { return []; }
  }

  function write(lines) {
    save(JSON.stringify(lines));
    notify();
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
      save(JSON.stringify(resolved.map(l => ({id: l.item.id, qty: l.qty}))));
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

  /* Another tab changed the bag. */
  window.addEventListener("storage", event => {
    if (event.key === KEY) notify();
  });

  window.KritorCart = {
    add, setQty, remove, clear, lines, count, subtotal, currency,
    money, maxFor, thumbFor, assetPath,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  };
})();
