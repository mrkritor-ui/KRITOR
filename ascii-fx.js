/* KRITOR — ASCII effects.

   Two animations, both drawn as real characters into a <pre> rather than onto
   a canvas: a fire that burns up from the bottom of the screen, and a starfield
   that can be flown forwards or backwards. They are the only moving things on
   the site, and they exist for one screen each — the fire is the door at
   kritor.au, the starfield is the distance between the catalogue and the store.

   Characters, not pixels, because the whole site is a bitmap system: the fire
   is a density ramp (" . : - = + * % # @") and the depth of a star is which
   glyph it is. Colour is never used — every level is the page's own ink at a
   different opacity, so both animations are correct in paper mode and in
   terminal mode without knowing which one is on.

   Frames are written as one innerHTML string per tick, run-length encoded so a
   row of forty identical characters is one element rather than forty. That is
   what makes a 100x40 grid at 24fps cheap enough to run on a phone while the
   catalogue is still loading behind it. */
(function () {
  "use strict";

  /* Index is the level; 0 is empty. Both ramps are the same length so they can
     share one set of opacity classes in the stylesheet. */
  const FIRE_CHARS = [" ", ".", ".", ":", ":", "-", "=", "+", "*", "%", "#", "@", "@"];
  const STAR_CHARS = [" ", ".", ".", ":", ":", "+", "+", "*", "*", "#", "#", "@", "@"];
  const LEVELS = 12;

  /* A ceiling on work per frame, not on how wide the art is: past this many
     columns the type is scaled up instead, so the grid always fills its box
     and a 4K screen gets chunkier characters rather than a panel of fire
     floating in the middle of the page. */
  const MAX_COLS = 150;
  const MAX_ROWS = 60;

  const reduceMotion =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ── Shared plumbing ─────────────────────────────────────────────────────── */

  /* The grid is measured from the type, not assumed: the <pre> sets its own
     font-size in the stylesheet and this reads back what one character
     actually occupies, so the art fills the box at any size. */
  function measure(pre) {
    const probe = document.createElement("span");
    probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre;";
    probe.textContent = "0".repeat(40);
    pre.appendChild(probe);
    const cw = probe.getBoundingClientRect().width / 40;
    probe.textContent = "0";
    const ch = probe.getBoundingClientRect().height;
    probe.remove();
    return { cw: cw || 8, ch: ch || 12 };
  }

  function sizeOf(pre) {
    pre.style.fontSize = "";                    // back to the stylesheet's size
    const box = pre.getBoundingClientRect();
    let m = measure(pre);
    let cols = Math.floor(box.width / m.cw);

    /* Wider than the budget: grow the type until the column count lands on the
       ceiling. Clamping the columns instead left the art ending in mid-air
       partway across the screen. */
    if (cols > MAX_COLS) {
      const base = parseFloat(getComputedStyle(pre).fontSize) || 12;
      pre.style.fontSize = (base * cols / MAX_COLS) + "px";
      m = measure(pre);
      cols = Math.floor(box.width / m.cw);
    }

    return {
      W: Math.max(8, Math.min(MAX_COLS, cols)),
      H: Math.max(6, Math.min(MAX_ROWS, Math.floor(box.height / m.ch))),
    };
  }

  /* One string per frame. Runs of the same level collapse into a single
     element, and level 0 is written as bare spaces so empty sky costs nothing
     — which is most of a starfield. */
  function paint(pre, cells, W, H, chars) {
    let out = "";
    for (let y = 0; y < H; y++) {
      const row = y * W;
      let x = 0;
      while (x < W) {
        const lv = cells[row + x];
        let n = 1;
        while (x + n < W && cells[row + x + n] === lv) n += 1;
        out += lv === 0
          ? " ".repeat(n)
          : '<b class="fx' + lv + '">' + chars[lv].repeat(n) + "</b>";
        x += n;
      }
      out += "\n";
    }
    pre.innerHTML = out;
  }

  /* Every effect is driven the same way: a fixed frame budget, paused whenever
     the tab is hidden (nobody is watching, and a boot screen left in a
     background tab should not burn a core), and rebuilt on resize. */
  function drive(pre, fps, build) {
    let stopped = false;
    let raf = 0;
    let last = 0;
    let state = null;
    const interval = 1000 / fps;

    /* A resize starts the effect over rather than resampling it. The grid is a
       different shape, and a fire or a field carried across is worth less than
       one that is simply correct. */
    const rebuild = () => {
      const s = sizeOf(pre);
      state = build(s.W, s.H);
    };

    const frame = now => {
      if (stopped) return;
      raf = requestAnimationFrame(frame);
      if (document.hidden) { last = now; return; }
      const dt = now - last;
      if (dt < interval) return;
      last = now;
      state.tick(Math.min(dt, interval * 3) / 1000);
      paint(pre, state.cells, state.W, state.H, state.chars);
    };

    rebuild();
    last = performance.now();
    raf = requestAnimationFrame(frame);

    let resizeTimer = 0;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { if (!stopped) rebuild(); }, 120);
    };
    window.addEventListener("resize", onResize);

    return function stop() {
      stopped = true;
      cancelAnimationFrame(raf);
      clearTimeout(resizeTimer);
      window.removeEventListener("resize", onResize);
      pre.textContent = "";
    };
  }

  /* ── Fire ────────────────────────────────────────────────────────────────── */

  /* The propagation trick from the original Doom fire: the bottom row is held
     at full heat and every row above takes its value from the row below it,
     minus a random amount, offset by a random column. The randomness is the
     whole effect — the decay makes the flame die out at a different height
     every frame, and the offset is what makes it lick sideways. A slow sine
     wind biases the offset so the fire leans and recovers instead of
     shimmering symmetrically forever. */
  function fire(pre) {
    return drive(pre, reduceMotion ? 12 : 24, (W, H) => {
      /* Heat is carried at finer resolution than the ramp so the decay is
         gradual, and it is set from the height of the box rather than fixed:
         a cell loses about one unit per row, so this is what decides how far
         up the tallest tongues reach. Fixed, the fire climbed into the type on
         a short screen and stopped halfway up a tall one. */
      const HEAT = Math.max(14, Math.round(H * 0.78));

      const heat = new Uint8Array(W * H);
      const cells = new Uint8Array(W * H);
      let t = 0;

      return {
        W, H, cells, chars: FIRE_CHARS,
        tick(dt) {
          t += dt;

          /* Held at full heat, flickering, and falling away at the very edges
             so the fire reads as a fire on the ground rather than as a bar
             ruled across the bottom of the screen. */
          const base = (H - 1) * W;
          for (let x = 0; x < W; x++) {
            const p = W > 1 ? x / (W - 1) : 0.5;
            let edge = 1;
            if (p < 0.14) edge = p / 0.14;
            else if (p > 0.86) edge = (1 - p) / 0.14;
            heat[base + x] = Math.max(0, Math.round(HEAT * edge * (0.76 + Math.random() * 0.24)));
          }

          const wind = Math.sin(t * 0.7) * 0.9 + Math.sin(t * 0.23) * 0.5;

          for (let y = H - 1; y > 0; y--) {
            const src = y * W;
            const dst = src - W;
            for (let x = 0; x < W; x++) {
              const v = heat[src + x];
              if (v === 0) { heat[dst + x] = 0; continue; }
              const decay = Math.random() < 0.62 ? 1 : Math.random() < 0.6 ? 2 : 0;
              let nx = x + Math.round(Math.random() * 2 - 1 + wind * Math.random());
              if (nx < 0) nx = 0;
              else if (nx >= W) nx = W - 1;
              heat[dst + nx] = v > decay ? v - decay : 0;
            }
          }

          for (let i = 0; i < cells.length; i++) {
            const v = heat[i];
            cells[i] = v === 0 ? 0 : Math.max(1, Math.min(LEVELS, Math.ceil(v / HEAT * LEVELS)));
          }
        },
      };
    });
  }

  /* ── Starfield ───────────────────────────────────────────────────────────── */

  /* Stars live in a box in front of the camera and are divided by their own
     depth to land on the grid. Flying forward means z falling, which throws
     them outward past the edges; flying back means z climbing, which draws
     them into the centre. That is the only difference between leaving for the
     store and coming home from it.

     Rows are half as tall as they are wide in a monospace face, so the
     vertical projection is halved — without that the field is an ellipse
     stretched down the screen instead of a sphere. */
  function starfield(pre, options) {
    const opts = options || {};
    const back = opts.direction === "back";
    const density = opts.density || 0.5;

    return drive(pre, reduceMotion ? 20 : 30, (W, H) => {
      const cells = new Uint8Array(W * H);
      const count = Math.min(1400, Math.round(W * H * density));
      const NEAR = 0.35;
      const FAR = 14;
      const FOV = W * 0.42;
      const xs = new Float32Array(count);
      const ys = new Float32Array(count);
      const zs = new Float32Array(count);

      const place = (i, z) => {
        /* Spread over a disc rather than a square, so the field has no corners
           to give away that it is flat. */
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * 2.6;
        xs[i] = Math.cos(a) * r;
        ys[i] = Math.sin(a) * r;
        zs[i] = z;
      };
      for (let i = 0; i < count; i++) place(i, NEAR + Math.random() * (FAR - NEAR));

      let t = 0;

      return {
        W, H, cells, chars: STAR_CHARS,
        tick(dt) {
          t += dt;
          /* It builds. A field already at full speed on the first frame has
             nothing to say; one that winds up reads as departure. */
          const ramp = reduceMotion ? 0.45 : Math.min(1, 0.25 + t * 0.85);
          const speed = (back ? 5.5 : 7) * ramp * dt;

          cells.fill(0);
          const cx = W / 2;
          const cy = H / 2;

          for (let i = 0; i < count; i++) {
            let z = back ? zs[i] + speed : zs[i] - speed;
            if (z < NEAR) { place(i, FAR); z = zs[i]; }
            else if (z > FAR) { place(i, NEAR); z = zs[i]; }
            else zs[i] = z;

            const k = FOV / z;
            const sx = Math.round(cx + xs[i] * k);
            const sy = Math.round(cy + ys[i] * k * 0.5);
            if (sx < 0 || sx >= W || sy < 0 || sy >= H) continue;

            /* Nearness on a curve: without it almost every star sits in the
               faintest level and the field never appears to arrive. */
            const near = Math.pow(1 - (z - NEAR) / (FAR - NEAR), 1.7);
            const lv = Math.max(1, Math.min(LEVELS, Math.round(near * LEVELS) || 1));
            const at = sy * W + sx;
            if (lv > cells[at]) cells[at] = lv;
          }
        },
      };
    });
  }

  window.KritorFX = { fire, starfield, reduceMotion };
})();
