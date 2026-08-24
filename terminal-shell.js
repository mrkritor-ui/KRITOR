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

  const root = document.documentElement;
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
      el.textContent = text.slice(0, i);
      el.appendChild(caret);
      if (i >= text.length) return;
      /* A terminal prints a line and then draws breath before the next one.
         Typing at a flat rate reads as an effect; pausing at the newline reads
         as something actually coming down the wire. */
      const justEndedLine = text[i - 1] === "\n";
      typeTimer = setTimeout(tick, justEndedLine ? TYPE_LINE_MS : TYPE_MS);
    };
    typeTimer = setTimeout(tick, TYPE_MS);
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
    let barShown = false;
    let ended = false;

    const frame = now => {
      const elapsed = now - started;
      /* Quantised so the bar advances in visible increments rather than
         sliding — a terminal fills a bar in characters, not pixels. */
      const scripted = Math.min(1, elapsed / BOOT_MS);
      const shown = Math.round(scripted * 32) / 32;
      loadingFill.style.width = (shown * 100) + "%";

      /* The INFO row appears above the loading row once loading is visibly
         under way: the loading row turns out to have been part of the bar. */
      if (!barShown && scripted > 0.2) {
        barShown = true;
        infoRow.hidden = false;
      }
      if (scripted >= 1 && (loadsDone() || elapsed > 8000)) return end();
      requestAnimationFrame(frame);
    };

    function end() {
      if (ended) return;
      ended = true;
      infoRow.hidden = false;
      loadingFill.style.width = "100%";
      loadingLabel.textContent = "WELCOME";

      setTimeout(() => {
        loadingRow.classList.add("is-gone");
        boot.classList.add("is-done");
        if (options.onParams) options.onParams();
        deal();
      }, reduceMotion ? 0 : WELCOME_MS);
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

    head.addEventListener("click", () => {
      const open = col.classList.toggle("is-open");
      head.setAttribute("aria-expanded", String(open));
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
    if (!frames.length || reduceMotion) return;

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

  window.KritorTerminal = {
    reduceMotion, initTheme, setTheme, typeInto, stopTyping, runBoot,
    filterColumn, startScreensaver,
  };
})();
