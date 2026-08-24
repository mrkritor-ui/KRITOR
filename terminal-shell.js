/* KRITOR — the terminal shell.

   Everything both the catalogue and the store need: the theme, the bar, the
   boot sequence, the typing effect and the idle screensaver. The pages
   themselves only decide what a row or a tile is.

   The boot sequence is deliberately time-based rather than load-based. The
   whole catalogue is about 40 KB of 1-bit renditions, so a bar driven purely by
   bytes arriving would jump to 100% before anyone saw it move. It is meant to
   read as a machine coming up, so it takes a couple of seconds, fills in
   discrete steps, flashes WELCOME, brings the bar's parameters up, and only
   then deals the works in one after another like rows off a database. Real
   loading still gates it — the sequence cannot finish while images are
   outstanding — it just never finishes early. */
(function () {
  "use strict";

  const BOOT_MS = 2400;          // how long the bar takes to fill
  const WELCOME_MS = 700;        // how long WELCOME holds before the row goes
  const DEAL_MS = 45;            // gap between works arriving
  const IDLE_MS = 20000;         // idle before the screensaver takes over
  const TYPE_MS = 22;            // ms per character
  const TYPE_LINE_MS = 110;      // extra pause at the end of each line
  const TYPE_MS_REDUCED = 6;     // still types, just briskly
  const WELCOME_HOLD_MS = 1000;  // how long the welcome message stands alone

  const root = document.documentElement;
  const touch = window.matchMedia("(hover: none), (pointer: coarse)").matches;

  /* prefers-reduced-motion is about large, vestibular movement — not about
     text arriving. Gating the typing and the screensaver on it turned them off
     entirely for anyone with the OS setting on, which is most desktops in a
     studio. So it is honoured where it means something (the FLIP that throws
     works across the grid, the boot's staggered deal) and ignored where it
     only removed the thing the page is for. Typing simply runs faster. */
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ── Theme ─────────────────────────────────────────────────────────────── */

  function setTheme(theme) {
    root.dataset.theme = theme;
    document.querySelectorAll("[data-theme-btn]").forEach(b =>
      b.setAttribute("aria-pressed", String(b.dataset.themeBtn === theme)));
    try { localStorage.setItem("kritor-theme", theme); } catch (e) {}
  }

  function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem("kritor-theme"); } catch (e) {}
    setTheme(saved === "dark" ? "dark" : "light");
    document.querySelectorAll("[data-theme-btn]").forEach(b =>
      b.addEventListener("click", () => setTheme(b.dataset.themeBtn)));
  }

  /* ── Typing ────────────────────────────────────────────────────────────── */

  let typeTimer = 0;

  function typeInto(el, text) {
    clearTimeout(typeTimer);
    const caret = document.createElement("span");
    caret.className = "caret";
    const perChar = reduceMotion ? TYPE_MS_REDUCED : TYPE_MS;
    const perLine = reduceMotion ? TYPE_MS_REDUCED : TYPE_LINE_MS;
    el.textContent = "";
    el.appendChild(caret);
    let i = 0;
    const tick = () => {
      i += 1;
      el.textContent = text.slice(0, i);
      el.appendChild(caret);
      if (i >= text.length) return;
      /* A terminal prints a line and then draws breath before the next one.
         Typing at a flat rate reads as an effect; pausing at the newline reads
         as something actually coming down the wire. */
      const justEndedLine = text[i - 1] === "\n";
      typeTimer = setTimeout(tick, justEndedLine ? perLine : perChar);
    };
    typeTimer = setTimeout(tick, perChar);
  }

  function stopTyping() { clearTimeout(typeTimer); }

  /* ── Boot ──────────────────────────────────────────────────────────────── */

  /* preload  urls whose arrival gates the sequence
     onParams called once the bar should show its parameter rows
     onDeal    called per item, in order, as the works arrive */
  function runBoot(options) {
    const boot = document.getElementById("boot");
    const loadingRow = document.getElementById("loading-row");
    const loadingLabel = document.getElementById("loading-label");
    const loadingFill = document.getElementById("loading-fill");
    const infoRow = document.getElementById("info-row");

    const urls = options.preload || [];
    let loaded = 0;
    const loadsDone = () => loaded >= urls.length;

    urls.forEach(url => {
      const img = new Image();
      const done = () => { loaded += 1; };
      img.addEventListener("load", done, { once: true });
      img.addEventListener("error", done, { once: true });
      img.src = url;
      if (img.complete) done();
    });

    const started = performance.now();
    let ended = false;

    const frame = now => {
      const elapsed = now - started;
      /* Quantised so the bar advances in visible increments rather than
         sliding — a terminal fills a bar in characters, not pixels. */
      const scripted = Math.min(1, elapsed / BOOT_MS);
      loadingFill.style.width = (Math.round(scripted * 32) / 32 * 100) + "%";
      if (scripted >= 1 && (loadsDone() || elapsed > 8000)) return end();
      requestAnimationFrame(frame);
    };

    /* Four beats, in order, because a machine coming up does one thing at a
       time: the bar fills, it says WELCOME, the bar assembles itself around
       the loading row, and only then are the works dealt in. Showing the INFO
       row while the bar was still filling gave the sequence away. */
    function end() {
      if (ended) return;
      ended = true;
      loadingFill.style.width = "100%";
      loadingLabel.textContent = "WELCOME";

      const welcome = document.getElementById("boot-welcome");
      if (welcome) welcome.hidden = false;

      setTimeout(() => {
        infoRow.hidden = false;                    // the bar arrives
        setTimeout(() => {
          loadingRow.classList.add("is-gone");     // and the loading row goes
          boot.classList.add("is-done");
          if (options.onParams) options.onParams();
          deal();
        }, WELCOME_MS);
      }, WELCOME_HOLD_MS);
    }

    /* Works arrive one at a time, in order, the way rows come back from a
       query — not all at once, and not on a CSS delay that would fire whether
       or not the row was ever added. */
    function deal() {
      const items = options.items || [];
      if (reduceMotion) { items.forEach((item, i) => options.onDeal(item, i)); return; }
      let i = 0;
      const next = () => {
        if (i >= items.length) return;
        options.onDeal(items[i], i);
        i += 1;
        setTimeout(next, DEAL_MS);
      };
      next();
    }

    requestAnimationFrame(frame);
  }

  /* ── The bar ───────────────────────────────────────────────────────────── */

  /* One state machine for the whole bar, because two pages were each keeping
     their own idea of what was open and neither agreed with the icons. The
     drawer is exactly one of: nothing, the filters, the info pane. Every entry
     point goes through set(), so the classes, the aria and the INFO icon can
     never drift apart from each other.

     It also measures itself. Where the bar spans the page it must not overlay
     the catalogue, so --bar-h is published on every change and the grid's top
     padding follows it — the works get pushed down rather than buried. */
  function mountBar() {
    const bar = document.getElementById("bar");
    const drawer = document.getElementById("drawer");
    const filtersPane = document.getElementById("filters-pane");
    const infoPane = document.getElementById("info-pane");
    const infoBtn = document.getElementById("info-btn");
    const tab = document.getElementById("bar-tab");
    if (!bar || !drawer) return null;

    let state = null;

    function measure() {
      /* Next frame, so the drawer's new height is real before it is read. A
         hidden bar is skipped: its height is zero, and letting that through
         would snap the catalogue up behind an open work panel. */
      requestAnimationFrame(() => {
        if (bar.classList.contains("is-hidden")) return;
        root.style.setProperty("--bar-h",
          Math.ceil(bar.getBoundingClientRect().height) + "px");
      });
    }

    function set(next) {
      state = next;
      const open = next !== null;
      drawer.classList.toggle("is-open", open);
      bar.classList.toggle("is-open", open);
      filtersPane.hidden = next !== "filters";
      infoPane.hidden = next !== "info";

      if (infoBtn) {
        infoBtn.setAttribute("aria-pressed", String(next === "info"));
      /* toggleAttribute, not .hidden: these icons are <svg>, and `hidden` is an
         HTMLElement property. Assigning it to an SVGElement sets a stray JS
         property and never touches the attribute, so the icon never changed. */
        infoBtn.querySelectorAll("[data-info]").forEach(ico => {
          ico.toggleAttribute("hidden", (ico.dataset.info === "on") !== (next === "info"));
        });
      }
      if (tab) tab.setAttribute("aria-expanded", String(open));

      /* Leaving a pane also leaves whichever column was expanded inside it,
         so coming back does not reopen someone's last filter. */
      drawer.querySelectorAll(".filter-col.is-open").forEach(col => {
        col.classList.remove("is-open");
        const head = col.querySelector(".filter-head");
        if (head) head.setAttribute("aria-expanded", "false");
      });
      measure();
    }

    /* The bar's resting state: the parameters on a pointer, folded on touch.
       On a pointer there is no "nothing" for the bar to be, so everything that
       wants to dismiss a pane comes back here rather than to null. */
    const rest = () => set(touch ? null : "filters");
    const toggle = which => (state === which ? rest() : set(which));

    if (tab) tab.addEventListener("click", () => toggle("filters"));
    if (infoBtn) infoBtn.addEventListener("click", () => toggle("info"));

    if (window.ResizeObserver) new ResizeObserver(measure).observe(bar);
    window.addEventListener("resize", measure, { passive: true });

    rest();

    return { set, rest, toggle, measure, isOpen: () => state !== null, state: () => state };
  }

  /* ── Bar columns ───────────────────────────────────────────────────────── */

  /* A column in the bar's drawer: a header that is always visible, and a body
     that drops out of it on hover. Only the three headers show at rest, so the
     bar stays a strip of parameters rather than a wall of values.

     The body is absolutely positioned so opening one does not resize the bar
     or shove the other columns around — it hangs over the catalogue, which is
     what makes it read as a menu rather than a panel. Touch has no hover, so
     the header is also a button that latches the column open. */
  function filterColumn(label, build) {
    const col = document.createElement("div");
    col.className = "filter-col";

    const head = document.createElement("button");
    head.type = "button";
    head.className = "filter-head";
    head.setAttribute("aria-expanded", "false");
    head.innerHTML = "<span>" + label + '</span><span class="hatch"></span>';
    col.appendChild(head);

    const body = document.createElement("div");
    body.className = "filter-list";
    build(body);
    col.appendChild(body);

    /* Hover shows a column's values; clicking the title pins them up so they
       stay when the pointer leaves. Clicking again unpins. Touch has no hover,
       so there a tap is the only thing that opens it — same class, same code
       path, no separate branch to keep in step. */
    head.addEventListener("click", event => {
      const pinned = col.classList.toggle("is-open");
      head.setAttribute("aria-expanded", String(pinned));
      /* The column is also held open by :focus-within, which a mouse click
         leaves behind — so unpinning with the mouse appeared to do nothing.
         detail > 0 means a real pointer click; a keyboard Enter reports 0 and
         keeps its focus, which is the whole point of focus-within. */
      if (!pinned && event.detail > 0) head.blur();
      [...(col.parentNode ? col.parentNode.children : [])].forEach(other => {
        if (other === col) return;
        other.classList.remove("is-open");
        const h = other.querySelector(".filter-head");
        if (h) h.setAttribute("aria-expanded", "false");
      });
    });

    return col;
  }

  /* ── Screensaver ───────────────────────────────────────────────────────── */

  /* The corner-bouncer, with one rule of its own: every time it touches an
     edge it becomes a different work. */
  function startScreensaver(frames) {
    if (!frames.length) return;

    const saver = document.createElement("div");
    saver.className = "screensaver";
    saver.setAttribute("aria-hidden", "true");
    const cell = document.createElement("div");
    cell.className = "screensaver-cell";
    saver.appendChild(cell);
    document.body.appendChild(saver);

    let idleTimer = 0;
    let raf = 0;
    let running = false;
    let x = 0, y = 0, vx = 0, vy = 0, w = 0, h = 0, last = 0;

    function pick() {
      const f = frames[Math.floor(Math.random() * frames.length)];
      cell.style.setProperty("--bits", 'url("' + f.url + '")');
      w = Math.min(window.innerWidth * 0.26, 320);
      h = w * (f.h / f.w);
      cell.style.width = w + "px";
      cell.style.height = h + "px";
    }

    function start() {
      if (running) return;
      running = true;
      pick();
      x = Math.random() * Math.max(1, window.innerWidth - w);
      y = Math.random() * Math.max(1, window.innerHeight - h);
      const speed = 0.11;                       // px per ms
      const angle = (Math.random() * 0.6 + 0.4) * (Math.PI / 2);
      vx = Math.cos(angle) * speed * (Math.random() < 0.5 ? -1 : 1);
      vy = Math.sin(angle) * speed * (Math.random() < 0.5 ? -1 : 1);
      saver.classList.add("is-on");
      last = performance.now();
      raf = requestAnimationFrame(tick);
    }

    function tick(now) {
      const dt = Math.min(48, now - last);
      last = now;
      x += vx * dt;
      y += vy * dt;

      let hit = false;
      if (x <= 0) { x = 0; vx = Math.abs(vx); hit = true; }
      else if (x + w >= window.innerWidth) { x = window.innerWidth - w; vx = -Math.abs(vx); hit = true; }
      if (y <= 0) { y = 0; vy = Math.abs(vy); hit = true; }
      else if (y + h >= window.innerHeight) { y = window.innerHeight - h; vy = -Math.abs(vy); hit = true; }
      /* Changing on the bounce is the whole idea, so it happens after the
         position has been clamped — the new work appears already inside. */
      if (hit) pick();

      cell.style.transform = "translate3d(" + Math.round(x) + "px," + Math.round(y) + "px,0)";
      raf = requestAnimationFrame(tick);
    }

    function stop() {
      if (!running) return;
      running = false;
      cancelAnimationFrame(raf);
      saver.classList.remove("is-on");
    }

    function poke() {
      stop();
      clearTimeout(idleTimer);
      idleTimer = setTimeout(start, IDLE_MS);
    }

    ["pointermove", "pointerdown", "keydown", "wheel", "touchstart", "scroll"]
      .forEach(type => window.addEventListener(type, poke, { passive: true }));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") stop(); else poke();
    });
    poke();
  }

  /* Reveal a panel as a sequence: the work fades up, its name follows, and the
     record types itself in under both. Returns a canceller, because opening
     another work mid-sequence must not leave the previous one's timers running
     into the new panel. */
  function revealWork(parts) {
    const timers = [];
    const at = (ms, fn) => timers.push(setTimeout(fn, reduceMotion ? Math.min(ms, 60) : ms));

    parts.image.classList.remove("is-in");
    parts.title.classList.remove("is-in");
    parts.meta.textContent = "";

    /* Next frame, so the browser has painted opacity:0 and the transition
       actually runs instead of the element simply being there. */
    requestAnimationFrame(() => parts.image.classList.add("is-in"));
    at(reduceMotion ? 0 : 620, () => parts.title.classList.add("is-in"));
    at(reduceMotion ? 0 : 1040, () => typeInto(parts.meta, parts.text));

    return () => { timers.forEach(clearTimeout); stopTyping(); };
  }

  /* Blink a control twice, the way a terminal acknowledges a key. Restarted
     from zero each time, so holding down repeated clicks still reads. */
  function flash(el) {
    el.classList.remove("is-flashing");
    void el.offsetWidth;
    el.classList.add("is-flashing");
    setTimeout(() => el.classList.remove("is-flashing"), 600);
  }

  window.KritorTerminal = {
    reduceMotion, initTheme, setTheme, typeInto, stopTyping, runBoot,
    mountBar, filterColumn, revealWork, startScreensaver, flash,
    /* Touch has no hover and needs the bar left closed until asked for. */
    isTouch: touch,
  };
})();
