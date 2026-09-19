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
   outstanding — it just never finishes early.

   The gate used to ask something of the bar too — a visitor had already
   chosen ART or ARCHITECTURE once, on the front door, and the gate held
   until a second click answered it, with the bar's own label turning into
   PRESS TO ENTER once it had nothing left to report. That was friction with
   no information in it, so the gate now arrives and leaves on its own clock
   the same way every other screen here does (see DOOR_READY_MS in
   pixel-fx.js) — the bar has nothing left to ask for. */
(function () {
  "use strict";

  const BOOT_MS = 2400;          // fallback bar-fill pace if a scene somehow
                                  // never resolves on its own (see fillMs below)
  const DEAL_MS = 45;            // gap between works arriving
  const IDLE_MS = 20000;         // idle before the screensaver takes over
  const TYPE_MS = 22;            // ms per character
  const TYPE_LINE_MS = 110;      // extra pause at the end of each line
  const TYPE_MS_REDUCED = 6;     // still types, just briskly
  const RUSH_MS = 320;           // what is left of the bar once the scene resolves early
  const SETTLE_MS = 320;         // the bar's one travel from boot height to full

  /* Answering the door, in three beats and about a second and a third. The
     picture dissolves out from under the name, the name stands on white with
     WELCOME TO over it while the bar flashes WELCOME, and then that goes too
     and the catalogue is underneath. Quick: it is a door being opened, not a
     curtain call. */
  const PART_MS = 380;           // the scene dissolving away
  const WHITE_MS = 620;          // the name alone on paper
  const LEAVE_MS = 260;          // and the boot screen itself going

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

  const EMERGE_MS = 620;         // matches the transition in the stylesheet

  /* The colour change, and the arrival on a page, are the same move: the
     background is already whatever it is going to be, the ink is snapped to
     sit exactly on top of it — so for one frame there is nothing on the screen
     but paper — and then let go, and everything comes back up out of it at
     once. Type, rules, the bar, the renditions: all of them are the ink, so
     all of them develop rather than being swapped.

     It has to be done in two steps with a flush between them. Set the ink to
     the background and release it in the same tick and the browser coalesces
     the two into no change at all; forcing a layout read in between is what
     makes the first state real enough to animate away from. */
  function emerge() {
    if (reduceMotion) return;
    const bg = getComputedStyle(root).getPropertyValue("--bg").trim();
    if (!bg) return;
    root.classList.remove("is-emerging");
    root.style.setProperty("--ink", bg);
    root.style.setProperty("--dim", bg);
    void root.offsetWidth;
    root.classList.add("is-emerging");
    root.style.removeProperty("--ink");
    root.style.removeProperty("--dim");
    clearTimeout(emerge.timer);
    emerge.timer = setTimeout(() => root.classList.remove("is-emerging"), EMERGE_MS + 80);
  }

  function setTheme(theme, animate) {
    root.dataset.theme = theme;
    document.querySelectorAll("[data-theme-btn]").forEach(b =>
      b.setAttribute("aria-pressed", String(b.dataset.themeBtn === theme)));
    try { localStorage.setItem("kritor-theme", theme); } catch (e) {}
    /* After the attribute, never before: emerge reads the background it is
       coming out of, and that is the one the new theme has just set. */
    if (animate) emerge();
  }

  function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem("kritor-theme"); } catch (e) {}
    setTheme(saved === "dark" ? "dark" : "light", false);
    document.querySelectorAll("[data-theme-btn]").forEach(b =>
      b.addEventListener("click", () => setTheme(b.dataset.themeBtn, true)));
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
     onDeal    called per item, in order, as the works arrive
     onDealt   called once the last of them has — which is a later moment than
               onParams by the whole length of the deal, and the one where the
               page is finally all there */
  function runBoot(options) {
    const boot = document.getElementById("boot");
    /* The scene is the loading screen's face: the block glitch or the letter
       grid, or the globe between the catalogue and the store. It runs
       alongside the bar filling and resolves on its own clock — see
       notifyReady in pixel-fx.js's run() — so the sequence below only ever
       waits on it, never on an interaction. */
    const scene = window.KritorBoot
      ? window.KritorBoot.mount(options.page || "catalogue")
      : { ready: Promise.resolve(), stop: function () {} };
    /* The drawn cursor stands down for the duration. It was first taken off
       here to pay for the scenes — they were a grid of a thousand elements
       rewritten every frame, and `cursor: none` had to be resolved against
       every one of them as it was created — and a canvas has cost nothing on
       that count since. It stays off because there is nothing to point a
       drawn arrow at yet: every boot screen is a picture playing itself out,
       not a control surface. */
    /* The class, not the call: cursor.js is deferred and has not run yet at
       this point in the page. It reads the class when it does. */
    root.classList.add("kc-off");

    /* The bar keeps its shape for the whole sequence. It used to be shrunk
       while the boot screen was up — narrower, tighter padding, smaller label,
       shorter progress bar — and then let go at the end, and the snap back to
       full size was the ugliest moment on the site. It is a panel that is
       there from the first frame to the last; only what is inside it changes.
       The class stays because other rules hang off it. */
    root.classList.add("is-booting");

    let sceneReady = false;

    /* Paced to WARP_MS — DOOR_READY_MS in pixel-fx.js is matched to it by
       hand, the same way GLOBE_READY_MS already is, so every scene finishes
       its own arrival right around when the bar does regardless of which
       one is actually showing. Only ever a starting assumption: the
       compression below means an early resolve always wins. */
    let fillMs = window.KritorBoot ? window.KritorBoot.WARP_MS : BOOT_MS;
    const loadingRow = document.getElementById("loading-row");
    const loadingLabel = document.getElementById("loading-label");
    const loadingFill = document.getElementById("loading-fill");
    const infoRow = document.getElementById("info-row");
    const gateLikeScene = scene.mode === "gate" || scene.mode === "arch";

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
      /* Resolved before the bar had filled — a fast scene, or a slow one
         still catching up to it — is not worth holding the rest of the fill
         to its original pace for, so what is left runs as one short burst
         instead. */
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
         the scene — on its own clock, and there is deliberately no timeout
         on it beyond the 8s below, which exists only for real loading
         hanging on a dead connection. */
      if (scripted >= 1 && sceneReady && (loadsDone() || elapsed > 8000)) return end();
      requestAnimationFrame(frame);
    };

    /* Three beats, in order, because a machine coming up does one thing at a
       time. Showing the INFO row while the bar was still filling gave the
       sequence away, so it arrives at the end with the rest of the bar. */
    function end() {
      if (ended) return;
      ended = true;
      loadingFill.style.width = "100%";
      loadingLabel.textContent = "WELCOME";
      /* And it flashes — the one thing still moving once the picture has
         gone. */
      loadingRow.classList.add("is-welcome");

      /* Beat one: the picture dissolves out from under the name, the line
         KRITOR was saying goes with it, and WELCOME TO comes up over the top.
         The name itself is drawn into the scene's own grid and the dissolve is
         written not to reach it, so it is left standing on white. */
      const welcome = document.getElementById("boot-welcome");
      if (welcome) {
        welcome.textContent = gateLikeScene ? "WELCOME TO" : "WELCOME.";
        welcome.hidden = false;
      }
      scene.part(PART_MS);
      requestAnimationFrame(() => boot.classList.add("is-parting"));

      /* Beat two: the name alone, and the bar flashing under it. */
      setTimeout(() => {
        /* Beat three: the bar's parameters fade up as the loading row folds
           away — both eased, so the panel settles rather than jumps — and the
           boot screen fades off whatever is already behind it. */
        /* Measured before anything changes, because this is the height the
           panel has to travel from. */
        const bar = infoRow.closest(".bar");
        const from = bar ? bar.getBoundingClientRect().height : 0;

        infoRow.hidden = false;
        infoRow.classList.add("is-in");
        loadingRow.classList.add("is-gone");
        boot.classList.add("is-leaving");
        /* And the page behind it arrives the same way a theme change does:
           everything that is not the paper is put back to the colour of the
           paper and then let go, so it comes up out of it. Started here, under
           the fade, rather than once the door has gone — run afterwards the
           bar was already fully inked when it was revealed, then blinked out
           and came back, which is a flicker rather than an arrival. */
        emerge();
        /* The bar assembles itself while the door is still fading over the top
           of it, so whatever settling it has to do happens behind something —
           by the time there is nothing in front of it, it is already the shape
           it is going to stay. */
        root.classList.remove("is-booting");
        /* Only for as long as the arrival takes: the fade on the rows is meant
           to play once, on the way in, and not every time the drawer is opened
           for the rest of the session. */
        root.classList.add("is-entering");
        setTimeout(() => root.classList.remove("is-entering"), 420);
        if (options.onParams) options.onParams();
        /* Last, once every row that is going to be there is there — the panel
           is now at its final height and has never been drawn at it. */
        settleBar(bar, from);

        setTimeout(() => {
          boot.classList.add("is-done");
          scene.stop();                            // nothing animates underneath
          /* By now cursor.js has run, and resume() puts the cursor back under
             the pointer rather than waiting for it to be moved. */
          if (window.KritorCursor) window.KritorCursor.resume();
          else root.classList.remove("kc-off");

          deal();
        }, LEAVE_MS);
      }, PART_MS + WHITE_MS);
    }

    /* One travel, measured. The panel's height is the sum of whatever rows it
       is currently showing, and on arrival that set changes completely: the
       loading row goes and three others take its place. Animating each of them
       separately meant several curves of different shapes racing, and the
       height is their sum — so it climbed past where it was going and dropped
       back, which is the one thing a panel must not do. Instead the rows are
       swapped in a single frame, both ends are measured, and the bar is told
       to travel between them. Nothing has to be guessed and nothing has to
       agree: a phone, a desktop and the store all get the same one move.

       It runs behind the boot screen's own fade, so what is on screen for its
       duration is a panel already at the size it will keep. */
    function settleBar(bar, from) {
      if (!bar || !from || reduceMotion) return;
      const to = bar.getBoundingClientRect().height;
      if (!to || Math.abs(to - from) < 2) return;
      /* Clipped only while it is short of its content, and released with the
         height — the filter menus hang out below the bar by design. */
      bar.style.overflow = "hidden";
      bar.style.height = from + "px";
      void bar.offsetWidth;                   // or the two collapse into no change
      bar.style.transition = "height " + SETTLE_MS + "ms ease";
      bar.style.height = to + "px";
      setTimeout(() => {
        bar.style.transition = "";
        bar.style.height = "";
        bar.style.overflow = "";
      }, SETTLE_MS + 60);
    }

    /* Works arrive one at a time, in order, the way rows come back from a
       query — not all at once, and not on a CSS delay that would fire whether
       or not the row was ever added. */
    function deal() {
      const items = options.items || [];
      const dealt = () => { if (options.onDealt) options.onDealt(); };
      if (reduceMotion) { items.forEach((item, i) => options.onDeal(item, i)); return dealt(); }
      let i = 0;
      const next = () => {
        if (i >= items.length) return dealt();
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
  /* rest  what the bar falls back to when nothing is open, on a pointer.
           Defaults to the parameters. */
  function mountBar(options) {
    const opts = options || {};
    const restState = opts.rest === undefined ? "filters" : opts.rest;
    const bar = document.getElementById("bar");
    const drawer = document.getElementById("drawer");
    const filtersPane = document.getElementById("filters-pane");
    const infoPane = document.getElementById("info-pane");
    const infoBtn = document.getElementById("info-btn");
    const tab = document.getElementById("bar-tab");
    if (!bar || !drawer) return null;

    /* Where the bar can be fully closed, the tab is the only way back into it,
       so it has to be there on a pointer as well — on the catalogue the
       parameters are always on screen and the handle would have nothing to do,
       which is why it is a touch-only control by default. */
    bar.dataset.rest = restState === null ? "closed" : restState;

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

    /* The bar's resting state: folded on touch, and on a pointer whatever the
       page says it is. On the catalogue that is the parameters — there is
       nothing else for the bar to be there, so everything that dismisses a
       pane comes back to them rather than to null. The shopfront says closed,
       and it has to be said here rather than set once at startup: rest() is
       also where the INFO pane returns to, and a shopfront that opened with
       the filters folded only to spring them open the first time somebody
       looked at INFO has not really defaulted to anything. */
    const rest = () => set(touch ? null : restState);
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
      /* Never over the boot screen. A slow connection can leave real loading
         outstanding well past the idle timer, and the bouncer arriving on
         top of the door is the one place this can never appear. */
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

  /* The two-finger hold every phone gallery already trained a visitor to
     try: pinch to scale the work up, let go and it stays there, one finger
     then pans around it, a double-tap snaps it back. Fingers land on the
     work itself (`art`), not on `surface` — the swipe below still owns that
     box, and simply stops offering swipes once the work is off its 1× rest. */
  const ZOOM_MAX = 4;
  const DOUBLE_TAP_SCALE = 2.5;
  const DOUBLE_TAP_MS = 300;    // gap allowed between the two taps
  const DOUBLE_TAP_PX = 32;     // how close together, and how still, each tap must be

  /* art      the box the two halves are laid over, and the work is zoomed in
     surface  what the swipe is read on
     step     called with -1 or 1 */
  function mountPanelNav(options) {
    const step = options.step;
    const art = options.art;

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
      art.appendChild(zone);
    });

    /* Read on the panel's own box rather than on the backdrop, where the same
       gesture would also land on the click that closes the panel. */
    const surface = options.surface;
    let id = -1;
    let sx = 0;
    let sy = 0;

    surface.addEventListener("pointerdown", e => {
      if (e.pointerType !== "touch") return;
      /* A second finger landing is a pinch starting, not a swipe candidate —
         checked here rather than trusted to the pinch handler below, which
         sees this same touch first (art sits inside surface) but whose own
         cancellation this handler would otherwise overwrite right back. */
      if (touches.size > 1) { id = -1; return; }
      id = e.pointerId;
      sx = e.clientX;
      sy = e.clientY;
    }, { passive: true });

    surface.addEventListener("pointerup", e => {
      if (e.pointerId !== id) return;
      id = -1;
      if (scale > 1) return;   // the work is zoomed — panning owns the drag now
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      /* Horizontal, and decisively so. The panel scrolls under the finger, and
         a gesture that is mostly down the page is a scroll that drifted, not
         somebody asking for the next work. */
      if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) < Math.abs(dy) * SWIPE_BIAS) return;
      step(dx < 0 ? 1 : -1);
    }, { passive: true });

    surface.addEventListener("pointercancel", () => { id = -1; }, { passive: true });

    /* ── Pinch-to-zoom ────────────────────────────────────────────────────── */

    const touches = new Map();   // pointerId -> {sx, sy, x, y}: down point and live point
    let scale = 1, tx = 0, ty = 0;
    let pinch = null;            // anchor + start scale/distance, set while two fingers are down
    let panFrom = null;          // {x, y, tx, ty}, set while one finger drags a zoomed work
    let lastTap = null;          // {time, x, y} of the previous lone tap

    function currentImg() { return art.querySelector("img"); }

    function place(withTransition) {
      const el = currentImg();
      if (!el) return;
      el.style.transition = withTransition ? "transform .25s ease" : "";
      el.style.transform = (scale === 1 && tx === 0 && ty === 0)
        ? "" : "translate(" + tx + "px, " + ty + "px) scale(" + scale + ")";
    }

    /* Keeps the work from drifting past its own edge: past a certain scale
       there is more of it than the box, and the box's centre is where that
       extra should run out either side. */
    function clampPan() {
      const el = currentImg();
      if (!el) return;
      const rect = art.getBoundingClientRect();
      const maxX = Math.max(0, (el.offsetWidth * scale - rect.width) / 2);
      const maxY = Math.max(0, (el.offsetHeight * scale - rect.height) / 2);
      tx = Math.min(maxX, Math.max(-maxX, tx));
      ty = Math.min(maxY, Math.max(-maxY, ty));
    }

    /* Settles scale and pan back inside bounds and hands the drag to whoever
       owns it next: past 1× a single finger pans the work, so the swipe above
       needs to fall silent and the panel needs to stop trying to scroll. */
    function settle() {
      scale = Math.min(ZOOM_MAX, Math.max(1, scale));
      if (scale === 1) { tx = 0; ty = 0; }
      clampPan();
      art.style.touchAction = scale > 1 ? "none" : "";
      place(true);
    }

    /* Where a viewport point (ax, ay) currently sits on the unscaled work —
       the point a pinch or a double-tap has to keep still as scale changes. */
    function anchorAt(ax, ay) {
      const rect = art.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      return { cx: cx, cy: cy, ix: (ax - cx - tx) / scale, iy: (ay - cy - ty) / scale };
    }

    function zoomTo(next, ax, ay) {
      const a = anchorAt(ax, ay);
      scale = next;
      tx = ax - a.cx - a.ix * scale;
      ty = ay - a.cy - a.iy * scale;
      settle();
    }

    function reset() {
      scale = 1; tx = 0; ty = 0;
      pinch = null; panFrom = null; lastTap = null;
      touches.clear();
      art.style.touchAction = "";
      place(false);
    }

    art.addEventListener("pointerdown", e => {
      if (e.pointerType !== "touch" || !currentImg()) return;
      touches.set(e.pointerId, { sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY });
      if (touches.size === 2) {
        panFrom = null;
        const [a, b] = [...touches.values()];
        const mid = anchorAt((a.x + b.x) / 2, (a.y + b.y) / 2);
        pinch = Object.assign({ dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, scale: scale }, mid);
      } else if (touches.size === 1 && scale > 1) {
        panFrom = { x: e.clientX, y: e.clientY, tx: tx, ty: ty };
      }
    }, { passive: true });

    art.addEventListener("pointermove", e => {
      if (!touches.has(e.pointerId)) return;
      const t = touches.get(e.pointerId);
      t.x = e.clientX; t.y = e.clientY;

      if (touches.size === 2 && pinch) {
        const [a, b] = [...touches.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        scale = Math.min(ZOOM_MAX, Math.max(1, pinch.scale * (dist / pinch.dist)));
        tx = mx - pinch.cx - pinch.ix * scale;
        ty = my - pinch.cy - pinch.iy * scale;
        clampPan();
        art.style.touchAction = "none";
        place(false);
      } else if (touches.size === 1 && panFrom) {
        tx = panFrom.tx + (e.clientX - panFrom.x);
        ty = panFrom.ty + (e.clientY - panFrom.y);
        clampPan();
        place(false);
      }
    }, { passive: true });

    function release(e) {
      if (!touches.has(e.pointerId)) return;
      const t = touches.get(e.pointerId);
      touches.delete(e.pointerId);
      if (touches.size < 2) pinch = null;

      if (touches.size === 0) {
        panFrom = null;
        settle();
        /* A tap that barely moved, twice, close together: the double-tap
           that zooms in on where it landed, or all the way back out. */
        const moved = Math.hypot(e.clientX - t.sx, e.clientY - t.sy);
        if (moved < DOUBLE_TAP_PX) {
          const now = Date.now();
          const tap = lastTap;
          lastTap = { time: now, x: e.clientX, y: e.clientY };
          if (tap && now - tap.time <= DOUBLE_TAP_MS &&
              Math.hypot(e.clientX - tap.x, e.clientY - tap.y) <= DOUBLE_TAP_PX) {
            lastTap = null;
            zoomTo(scale > 1 ? 1 : DOUBLE_TAP_SCALE, e.clientX, e.clientY);
          }
        } else {
          lastTap = null;
        }
      } else if (touches.size === 1 && scale > 1) {
        /* One finger lifted out of a pinch — the other keeps panning rather
           than the gesture simply ending. */
        const [p] = [...touches.values()];
        panFrom = { x: p.x, y: p.y, tx: tx, ty: ty };
      }
    }
    art.addEventListener("pointerup", release, { passive: true });
    art.addEventListener("pointercancel", release, { passive: true });

    return { reset: reset };
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
    mountBar, filterColumn, revealWork, startScreensaver, flash, FLASH_MS, emerge,
    mountPanelNav, walkLabel,
    /* Touch has no hover and needs the bar left closed until asked for. */
    isTouch: touch,
  };
})();
