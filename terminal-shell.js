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

  const BOOT_MS = 2400;          // how long the bar takes to fill on the gate
  const WELCOME_MS = 450;        // how long WELCOME holds before the row goes
  const DEAL_MS = 45;            // gap between works arriving
  const IDLE_MS = 20000;         // idle before the screensaver takes over
  const TYPE_MS = 22;            // ms per character
  const TYPE_LINE_MS = 110;      // extra pause at the end of each line
  const TYPE_MS_REDUCED = 6;     // still types, just briskly
  const WELCOME_HOLD_MS = 650;   // how long the welcome message stands alone
  const RUSH_MS = 320;           // what is left of the bar once the gate opens

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

  /* page     which screen this is, so the boot scene knows whether to burn or fly
     preload  urls whose arrival gates the sequence
     onParams called once the bar should show its parameter rows
     onDeal    called per item, in order, as the works arrive */
  function runBoot(options) {
    const boot = document.getElementById("boot");
    /* The scene is the loading screen's face: the fire and its ENTER gate, or
       the starfield between the catalogue and the store. It runs alongside the
       bar filling, and on the gate it is also what the sequence waits for —
       the machine will not finish coming up until somebody has answered the
       door. */
    const scene = window.KritorBoot
      ? window.KritorBoot.mount(options.page || "catalogue")
      : { ready: Promise.resolve(), stop: function () {} };
    /* The drawn cursor stands down for the duration. Both scenes rewrite a grid
       of a thousand elements every frame, and the cursor's own `cursor: none`
       has to be resolved against every one of them as it is created — the PNG
       does the same job here for nothing. */
    /* The class, not the call: cursor.js is deferred and has not run yet at
       this point in the page. It reads the class when it does. */
    root.classList.add("kc-off");

    /* While the boot screen is up the bar is only a loading row, and it does
       not need the width it holds a whole catalogue's parameters in. */
    root.classList.add("is-booting");

    let sceneReady = false;

    /* The bar is paced to the scene in front of it. On the gate it fills while
       you read, so by the time the door is answered it is already done and the
       click costs nothing. On a warp there is nothing to read, so the bar
       finishes exactly as the flight lands and the two are one beat rather
       than one after the other. */
    let fillMs = scene.mode && scene.mode !== "gate"
      ? (window.KritorBoot ? window.KritorBoot.WARP_MS : BOOT_MS)
      : BOOT_MS;
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

    scene.ready.then(() => {
      sceneReady = true;
      /* Answered before the bar had filled. Somebody who knocks early is not
         asking to watch out the rest of a schedule they have already opted
         out of, so the remaining fill is compressed into one short run rather
         than held to its original pace. */
      const elapsed = performance.now() - started;
      if (elapsed < fillMs) fillMs = elapsed + RUSH_MS;
    });

    const frame = now => {
      const elapsed = now - started;
      /* Quantised so the bar advances in visible increments rather than
         sliding — a terminal fills a bar in characters, not pixels. */
      const scripted = Math.min(1, elapsed / fillMs);
      loadingFill.style.width = (Math.round(scripted * 32) / 32 * 100) + "%";
      /* Real loading and the scripted fill both have to be done, and so does
         the scene — on the fire that is a click, and there is deliberately no
         timeout on it. */
      if (scripted >= 1 && sceneReady && (loadsDone() || elapsed > 8000)) return end();
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
          scene.stop();                            // nothing animates underneath
          /* By now cursor.js has run, and resume() puts the cursor back under
             the pointer rather than waiting for it to be moved. */
          root.classList.remove("is-booting");
          if (window.KritorCursor) window.KritorCursor.resume();
          else root.classList.remove("kc-off");

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

      /* Leaving a pane closes whichever column was merely expanded, but not
         one that is holding a filter — that is state, not a disclosure. */
      drawer.querySelectorAll(".filter-col.is-open:not(.is-filtered)").forEach(col => {
        col.classList.remove("is-open");
        const title = col.querySelector(".filter-title");
        if (title) title.setAttribute("aria-expanded", "false");
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

    const head = document.createElement("div");
    head.className = "filter-head";

    const title = document.createElement("button");
    title.type = "button";
    title.className = "filter-title";
    title.setAttribute("aria-expanded", "false");
    title.innerHTML = "<span>" + label + '</span><span class="hatch"></span>';
    head.appendChild(title);

    /* The clear control only exists while the column has something to clear —
       it is the column's own state made visible, not a permanent button that
       does nothing most of the time. */
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "filter-clear";
    clear.hidden = true;
    clear.setAttribute("aria-label", "Clear " + label);
    clear.textContent = "X";
    head.appendChild(clear);

    col.appendChild(head);

    const body = document.createElement("div");
    body.className = "filter-list";
    build(body);
    col.appendChild(body);

    /* Hover shows a column's values; clicking the title pins them up so they
       stay when the pointer leaves. Clicking again unpins. Touch has no hover,
       so there a tap is the only thing that opens it — same class, same code
       path, no separate branch to keep in step. */
    title.addEventListener("click", event => {
      const pinned = col.classList.toggle("is-open");
      title.setAttribute("aria-expanded", String(pinned));
      /* The column is also held open by :focus-within, which a mouse click
         leaves behind — so unpinning with the mouse appeared to do nothing.
         detail > 0 means a real pointer click; a keyboard Enter reports 0 and
         keeps its focus, which is the whole point of focus-within. */
      if (!pinned && event.detail > 0) title.blur();
      [...(col.parentNode ? col.parentNode.children : [])].forEach(other => {
        /* A column holding a value is not closed by opening another one:
           several filters can be narrowing the catalogue at once, and all of
           them should stay visible until they are cleared. */
        if (other === col || other.classList.contains("is-filtered")) return;
        other.classList.remove("is-open");
        const h = other.querySelector(".filter-title");
        if (h) h.setAttribute("aria-expanded", "false");
      });
    });

    /* Handed back so the page can wire what clearing means and show the X
       only when there is a value behind it. */
    col.clearButton = clear;
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
      /* Never over the boot screen. The gate waits for a click and will happily
         wait longer than the idle timer, and the bouncer arriving on top of the
         door is the one place this can never appear. */
      const boot = document.getElementById("boot");
      if (boot && !boot.classList.contains("is-done")) {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(start, IDLE_MS);
        return;
      }
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

  /* ── Panel navigation ──────────────────────────────────────────────────── */

  /* One work at a time, and two ways through it. On a pointer the art is
     divided in half — the left side goes back, the right side goes on, and the
     drawn cursor turns to face whichever way the click would take you. On a
     touch screen those halves would answer every attempt to simply look at the
     work, so there the gesture is a swipe and the halves are switched off in
     the stylesheet.

     Clicking the work used to always advance, with no way back short of the
     arrow keys, which is most of a catalogue you could only walk in one
     direction. */

  const SWIPE_MIN = 55;        // px of travel before a drag is a swipe
  const SWIPE_BIAS = 1.4;      // how much more horizontal than vertical

  /* art      the box the two halves are laid over
     surface  what the swipe is read on
     step     called with -1 or 1 */
  function mountPanelNav(options) {
    const step = options.step;

    ["prev", "next"].forEach(dir => {
      const zone = document.createElement("button");
      zone.type = "button";
      zone.className = "panel-zone";
      zone.dataset.zone = dir;
      /* Which is also what the drawn cursor reads to decide which way to
         point, so the direction is known before the click is made. */
      zone.dataset.cursor = dir;
      zone.setAttribute("aria-label", dir === "prev" ? "Previous work" : "Next work");
      zone.addEventListener("click", e => {
        e.stopPropagation();
        step(dir === "prev" ? -1 : 1);
      });
      options.art.appendChild(zone);
    });

    /* Read on the panel's own box rather than on the backdrop, where the same
       gesture would also land on the click that closes the panel. */
    const surface = options.surface;
    let id = -1;
    let sx = 0;
    let sy = 0;

    surface.addEventListener("pointerdown", e => {
      if (e.pointerType !== "touch") return;
      id = e.pointerId;
      sx = e.clientX;
      sy = e.clientY;
    }, { passive: true });

    surface.addEventListener("pointerup", e => {
      if (e.pointerId !== id) return;
      id = -1;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      /* Horizontal, and decisively so. The panel scrolls under the finger, and
         a gesture that is mostly down the page is a scroll that drifted, not
         somebody asking for the next work. */
      if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) < Math.abs(dy) * SWIPE_BIAS) return;
      step(dx < 0 ? 1 : -1);
    }, { passive: true });

    surface.addEventListener("pointercancel", () => { id = -1; }, { passive: true });
  }

  /* Where you are in the walk, and how to move through it — which is not the
     same sentence on a phone as it is on a desktop. */
  function walkLabel(at, total) {
    const pos = String(at + 1).padStart(3, "0") + " / " + String(total).padStart(3, "0");
    return touch ? pos + "   SWIPE" : "< BACK   " + pos + "   NEXT >";
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

  /* Strike a control twice and let it decay, the way a terminal acknowledges a
     key. Restarted from zero each time — without the reflow a second click
     during the first flash does nothing, because the class is already on. The
     clear-up must outlast the animation or it cuts the second strike short. */
  const FLASH_MS = 460 * 2;   // one strike is 460ms and it runs twice

  function flash(el) {
    el.classList.remove("is-flashing");
    void el.offsetWidth;
    el.classList.add("is-flashing");
    clearTimeout(el._flashTimer);
    el._flashTimer = setTimeout(() => el.classList.remove("is-flashing"), FLASH_MS + 40);
  }

  window.KritorTerminal = {
    reduceMotion, initTheme, setTheme, typeInto, stopTyping, runBoot,
    mountBar, filterColumn, revealWork, startScreensaver, flash, FLASH_MS,
    mountPanelNav, walkLabel,
    /* Touch has no hover and needs the bar left closed until asked for. */
    isTouch: touch,
  };
})();
