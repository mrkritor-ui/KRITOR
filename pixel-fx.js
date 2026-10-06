/* KRITOR — pixel effects.

   The four loading screens, each drawn as real pixels onto a canvas a few
   hundred cells wide and then blown up with nearest-neighbour, so a "pixel" on
   a boot screen is a square block of the same family as the 1-bit renditions
   the catalogue is built out of. They used to be characters — a Doom fire and
   a field of full stops set in a <pre> — and characters are a different bitmap
   from the one the rest of the site speaks in: the works are pixels, the icons
   are pixels, and the door was text pretending.

     tigerEyes     the front door: a tiger's eyes opening, and closing again the
                   moment a room is chosen
     blockGlitch   the catalogue's door: a field of paper and ink that will not
                   sit still
     letterGrid    architecture's door: a grid of one letter, smeared by a bad
                   vertical hold and settling
     globe         the flight between the catalogue and the store, forwards on
                   the way out and backwards on the way home

   The first three are footage rather than generators — reference clips
   downsampled frame by frame into a strip of stills (the *-loader-frames.webp
   files) and played back in their own order at their own pace. The globe is
   drawn.

   One bit, not one colour. Everything below produces a buffer of 0 and 1 and
   the driver paints 1 as --ink and 0 as --bg, so every scene is correct in
   paper mode and in terminal mode without knowing which one is on — which is
   what an actual 1-bit machine would have had to do, and what the renditions
   in the catalogue already do. */
(function () {
  "use strict";

  /* ── 1-bit plumbing ──────────────────────────────────────────────────────── */

  /* Ordered dither. A value between 0 and 1 becomes ink or paper depending on
     where the pixel sits in a 4×4 grid. Error diffusion would look better on a
     still frame and crawl horribly on a moving one. */
  const BAYER = new Float32Array(16);
  (function () {
    const M = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
    for (let i = 0; i < 16; i++) BAYER[i] = (M[i] + 0.5) / 16;
  })();

  function dither(x, y, v) {
    return v > BAYER[((y & 3) << 2) | (x & 3)] ? 1 : 0;
  }

  /* Integer hash → the same value for the same cell every time, so a scene
     rebuilt at the same size comes back identical. Math.imul because the
     products overflow 32 bits and plain * would quietly go through doubles. */
  function hash2(x, y, seed) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function parseColour(str) {
    const m = /rgba?\(([^)]+)\)/.exec(str || "");
    if (m) {
      const p = m[1].split(/[,\s/]+/).filter(Boolean).map(parseFloat);
      return [p[0] | 0, p[1] | 0, p[2] | 0];
    }
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((str || "").trim());
    if (hex) {
      const h = hex[1].length === 3 ? hex[1].replace(/./g, c => c + c) : hex[1];
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    return [0, 0, 0];
  }

  /* Little-endian ABGR, which is what a Uint32 view of an ImageData wants. */
  function packed(c) { return (255 << 24 | c[2] << 16 | c[1] << 8 | c[0]) >>> 0; }

  const reduceMotion =
    !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  /* How big one pixel is. The grid is not fixed — the block is — so a phone and
     a 4K display get roughly the same apparent chunk, and the scene lays itself
     out against whatever grid that leaves. */
  const TARGET_COLS = 460;
  const MIN_SCALE = 2;
  const MAX_SCALE = 10;

  /* ── The driver ──────────────────────────────────────────────────────────── */

  /* build(W, H, info) returns { render(dt, bits) }, which fills `bits` with one
     0 or 1 per cell. Everything else — sizing, the palette, the frame budget,
     pausing in a background tab, rebuilding on resize — happens here. */
  function run(host, fps, build) {
    const canvas = document.createElement("canvas");
    canvas.className = "boot-fx-canvas";
    host.textContent = "";
    host.appendChild(canvas);
    const ctx = canvas.getContext("2d", { alpha: false });

    let stopped = false, raf = 0, last = 0;
    let scene = null, img = null, px = null, bits = null;
    let W = 0, H = 0, ink = 0, paper = 0;

    /* A scene that has its own idea of "done" (the globe, whose text and
       fade are choreographed on its own render-driven clock) reports it
       here instead of a caller guessing a wall-clock duration to match —
       two clocks that fall out of step under any frame hitch is exactly
       how a fade-away could start before its own text has appeared. A
       scene with no such idea of done simply never calls it. */
    let readyResolve;
    const readyPromise = new Promise(function (res) { readyResolve = res; });

    function readPalette() {
      const cs = getComputedStyle(document.documentElement);
      ink = packed(parseColour(cs.getPropertyValue("--ink") || "#000"));
      paper = packed(parseColour(cs.getPropertyValue("--bg") || "#fff"));
    }

    function rebuild() {
      const box = host.getBoundingClientRect();
      const cssW = Math.max(1, box.width);
      const cssH = Math.max(1, box.height);
      const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.round(cssW / TARGET_COLS) || MIN_SCALE));

      W = Math.max(24, Math.ceil(cssW / scale));
      H = Math.max(24, Math.ceil(cssH / scale));
      canvas.width = W;
      canvas.height = H;
      /* Sized in whole blocks and allowed to overhang. Letting the browser
         stretch a W-wide canvas onto a width that is not a multiple of W is
         what gives nearest-neighbour its uneven columns — some blocks a pixel
         wider than their neighbours — and on a screen made entirely of squares
         that is the one thing you can see from across the room. */
      /* The CSS box stays at the canvas's own native size — W by H, not
         W*scale by H*scale — and a transform does the stretching instead of
         width/height. A filter (any filter anyone puts on .boot-fx-canvas,
         gate's CRT skin included) costs what the element's own box costs to
         rasterise, before a transform is applied to composite it; sized up
         through width/height, that box IS the full on-screen size and every
         filter pays for every one of those pixels every repaint. Sized up
         through transform, the box stays a few hundred cells and the GPU
         does the stretch for free on the way to the screen — the same
         nearest-neighbour result, at a small fraction of the cost. */
      canvas.style.width = W + "px";
      canvas.style.height = H + "px";
      canvas.style.transformOrigin = "0 0";
      canvas.style.transform =
        `translate(${Math.round((cssW - W * scale) / 2)}px, ${Math.round((cssH - H * scale) / 2)}px) scale(${scale})`;

      img = ctx.createImageData(W, H);
      px = new Uint32Array(img.data.buffer);
      bits = new Uint8Array(W * H);
      readPalette();
      scene = build(W, H, { scale: scale, offsetTop: (cssH - H * scale) / 2, notifyReady: readyResolve });
    }

    function present() {
      for (let i = 0, n = bits.length; i < n; i++) px[i] = bits[i] ? ink : paper;
      ctx.putImageData(img, 0, 0);
    }

    /* A scene passes Infinity for fps to mean genuinely uncapped — every
       rAF renders, at whatever cadence the display actually delivers, no
       skip-check and no interval-scaled clamp. That second part matters on
       its own: the clamp below exists to protect a scene's own clock from
       one huge dt after a real stall (a backgrounded tab, a GC pause), not
       to throttle ordinary frame delivery — but sized off interval*3 the
       way the capped scenes use it, a high fps meant to uncap the frame
       rate instead shrinks that guard band far below a single ordinary
       frame gap, clamping every frame and quietly running the scene's own
       clock in slow motion on perfectly ordinary hardware. Uncapped scenes
       get a fixed, generous ceiling instead, sized against a real stall
       rather than against their own (nonexistent) interval. */
    const uncapped = !isFinite(fps) || fps <= 0;
    const interval = uncapped ? 0 : 1000 / fps;
    const dtClampMs = uncapped ? 250 : interval * 3;
    const frame = now => {
      if (stopped) return;
      raf = requestAnimationFrame(frame);
      if (document.hidden) { last = now; return; }
      const dt = now - last;
      if (!uncapped && dt < interval) return;
      last = now;
      /* A scene's render() may return false to say bits didn't change and
         there is nothing worth re-blitting — see tigerEyes(), the one scene
         on the site that sits still for any real length of time. Every
         other scene never returns anything, which is truthy by omission, so
         present() still runs on every frame for them exactly as before. */
      if (scene.render(Math.min(dt, dtClampMs) / 1000, bits) !== false) present();
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

    /* The theme buttons are behind the boot screen while it is up, but the OS
       can still flip underneath it and the scene is two colours read once. */
    const themeWatch = new MutationObserver(readPalette);
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    return {
      /* Resolves when the scene itself says it has finished its sequence —
         see notifyReady above. A scene that never calls it leaves this
         forever pending, which is correct: nothing waits on it. */
      ready: readyPromise,
      /* Asked to leave. A scene may answer it — the gate dissolves — and one
         that does not simply carries on until it is stopped. */
      part: function (ms) { if (scene && scene.part) scene.part(ms); },
      /* The same idea as part(), for a scene with its own idea of "leaving"
         that isn't a dissolve — the tiger closes its eyes instead. Returns
         whatever the scene's own close() returns (a promise settling once
         it's actually done), or an already-resolved one for every scene
         that doesn't define this. */
      close: function () { return scene && scene.close ? scene.close() : Promise.resolve(); },
      stop: function () {
        stopped = true;
        cancelAnimationFrame(raf);
        clearTimeout(resizeTimer);
        window.removeEventListener("resize", onResize);
        themeWatch.disconnect();
        host.textContent = "";
      },
    };
  }

  /* ── Frame sheets: scenes that are footage, not generators ───────────────── */

  /* Three of the four scenes are not procedural at all: they are reference
     clips, downsampled frame by frame into one tall strip of stills and played
     back in their own real order at their own real pace. The first two
     started as generators guessing at the same look — an irregular partition
     re-thrown every quarter-second for the catalogue, a bold "A" blurring and
     settling cell by cell for architecture — and both read as choppy for the
     same reason: a freshly-rolled guess has no memory of the guess before it,
     where real footage never loses that thread. Copying the actual frames
     sidesteps the problem outright, because the coherence was always in the
     footage rather than in an algorithm waiting to be found. This is the
     machinery they share. */

  /* One flat luminance array per frame (0-255), decoded once into `state`
     and shared by every instance of the scene rather than reloaded per
     boot — the sheet never changes size or content, so there is nothing to
     redo on a resize the way the rest of a scene's own build() is redone.
     Loaded lazily, from the scene's own constructor rather than at module
     scope: this file is shared by every boot screen on the site, and
     fetching an asset only one of them uses would otherwise cost the other
     two a request neither ever needed. */
  function loadFrameSheet(state, url, tileW, tileH, frameCount) {
    if (state.requested) return;
    state.requested = true;
    const img = new Image();
    img.onload = function () {
      const cnv = document.createElement("canvas");
      cnv.width = tileW;
      cnv.height = tileH * frameCount;
      const cx = cnv.getContext("2d", { willReadFrequently: true });
      cx.drawImage(img, 0, 0);
      const data = cx.getImageData(0, 0, tileW, tileH * frameCount).data;
      const frames = new Array(frameCount);
      const area = tileW * tileH;
      for (let f = 0; f < frameCount; f++) {
        const arr = new Uint8Array(area);
        const base = f * area * 4;
        for (let i = 0; i < area; i++) arr[i] = data[base + i * 4];
        frames[f] = arr;
      }
      state.frames = frames;
    };
    img.src = url;
  }

  /* Cover, not contain: footage of one fixed shape filling a canvas of any
     proportions has to lose some of itself off two edges rather than
     letterbox, or a full-bleed boot screen stops being full-bleed the
     moment its own aspect ratio doesn't match the clip's. Centred, so
     whatever is cropped is cropped evenly off both sides. Returns the
     scale from stored-frame pixels to canvas pixels and the on-canvas
     origin of the frame's own (0, 0) corner. */
  function frameSheetCover(W, H, tileW, tileH) {
    const scale = Math.max(W / tileW, H / tileH);
    return { scale: scale, originX: (W - tileW * scale) / 2, originY: (H - tileH * scale) / 2 };
  }

  /* Bilinear rather than nearest — a stored frame is a fraction of the
     canvas's own native resolution, and sampling it with hard texel jumps
     would draw a second, coarser grid on top of whatever the footage
     itself already has. Interpolated, a low-resolution source reads as the
     same picture slightly softened at the edges — which the dither pass
     every caller runs it through immediately re-hardens into clean cells
     anyway. */
  function frameSheetSample(frame, tileW, tileH, fu, fv) {
    /* Clamped rather than trusted: the cover crop keeps both in range by
       construction, but the very last pixel on a covered edge can round to
       exactly tileW/tileH, and indexing a frame array one past its own end
       reads back undefined instead of a pixel — which then poisons the
       lerp into NaN and the dither after it into a false paper pixel right
       on the seam. */
    if (fu < 0) fu = 0; else if (fu > tileW - 1) fu = tileW - 1;
    if (fv < 0) fv = 0; else if (fv > tileH - 1) fv = tileH - 1;
    const x0 = fu | 0, y0 = fv | 0;
    const x1 = x0 + 1 < tileW ? x0 + 1 : x0;
    const y1 = y0 + 1 < tileH ? y0 + 1 : y0;
    const tx = fu - x0, ty = fv - y0;
    const row0 = y0 * tileW, row1 = y1 * tileW;
    const a = frame[row0 + x0] + (frame[row0 + x1] - frame[row0 + x0]) * tx;
    const b = frame[row1 + x0] + (frame[row1 + x1] - frame[row1 + x0]) * tx;
    /* Inverted on the way out: the sheet stores luminance (0 black, 255
       white), straight off the source frame, but every caller feeds this
       into dither() where 1 means "ink" — so a dark letterform on a light
       ground has to come back as HIGH coverage, not low, or the whole
       scene prints as its own negative. */
    return 1 - (a + (b - a) * ty) / 255;
  }

  /* ── Both doors' own arrival ──────────────────────────────────────────────── */

  /* The gate and the letter grid used to be the one thing on this site that
     never wrote its own name and never left on its own — a locked door,
     answered only by a click, however long that took. That read as a second
     obstacle rather than a threshold: a visitor already had to choose ART
     or ARCHITECTURE once, on the front door, and asking them to click a
     second time, on a screen with nothing written on it to click for, was
     friction with no information in it. Both now arrive the same way the
     store's two flights always have — watched for a beat, named, and gone —
     so the whole site tells time the same way. Shared, since the two scenes
     only ever differed in what they draw, never in when they say their own
     name: HOLD_BEFORE_TEXT is long enough to watch the loop go around at
     least once before KRITOR arrives, TEXT_FADE matches the transition on
     .boot-core in terminal.css, and the three sum to READY_MS — matched by
     hand to WARP_MS in boot-scene.js, the same way GLOBE_READY_MS already
     is, so the bar's own fill finishes in step with it. */
  /* The holds are the part of a boot screen that is purely ceremony — time
     spent watching something that has already finished arriving. Every scene
     already stills its own motion for a visitor who asked for less of it, but
     the waiting went on for its full length regardless, which left exactly
     that visitor looking at a near-static title card for four seconds. The
     clocks still run — freezing them is what would strand the ready signal at
     "never" — there is simply less to wait through. Fades are left alone:
     they are matched to transitions in the stylesheet, and shortening one side
     of that pair only desynchronises it. */
  const HOLD = reduceMotion ? 0.25 : 1;

  const DOOR_HOLD_BEFORE_TEXT_MS = 2800 * HOLD;
  const DOOR_TEXT_FADE_MS = 700;
  const DOOR_HOLD_AFTER_TEXT_MS = 700 * HOLD;
  const DOOR_READY_MS = DOOR_HOLD_BEFORE_TEXT_MS + DOOR_TEXT_FADE_MS + DOOR_HOLD_AFTER_TEXT_MS;

  /* ── The block glitch: the catalogue's door, now ─────────────────────────── */

  /* Nothing written into the picture itself, nothing that ever changes what
     it's made of — the door is a field of paper and ink that
     will not sit still, the way a signal with nothing on it does not sit
     still. Forty-three real frames of a datamoshed block field, ambient and
     looping: watched frame by frame its blocks rise and drift right in a
     single continuous wave, which is exactly the motion a fresh random
     partition every quarter-second could never reproduce. KRITOR arrives
     over it and leaves again — see DOOR_READY_MS above — but the field
     itself never resolves into anything; it is still going, underneath,
     the moment the page goes with it. */
  const ART_TILE_W = 100, ART_TILE_H = 100;    // stored per frame, before the
                                                // cover crop above fits it to
                                                // whatever shape the canvas is
  const ART_FRAME_COUNT = 43;
  const ART_FRAME_MS = 40;             // native pace of the reference clip —
                                        // 43 frames loop in 1.72s
  const ART_SHEET_URL = "/art-loader-frames.webp";
  const artSheet = { frames: null, requested: false };

  function blockGlitch(host) {
    loadFrameSheet(artSheet, ART_SHEET_URL, ART_TILE_W, ART_TILE_H, ART_FRAME_COUNT);
    return run(host, reduceMotion ? 12 : Infinity, function (W, H, info) {
      const cover = frameSheetCover(W, H, ART_TILE_W, ART_TILE_H);
      let t = 0;
      let partMs = 0, partT = 0, dissolve = 0;

      /* The arrival's own clock — always advances, reduced motion included,
         the same as globe()'s t: it is the sequence's own timekeeping, not
         a visual knob, and gating it on reduceMotion would freeze the
         announce and the ready signal at "never" for exactly the visitor
         who asked this screen to get out of the way fastest. Kept apart
         from the field's own t above, which does gate on reduceMotion,
         because that one really is a visual knob — how fast the blocks
         drift — with no business changing when the name arrives. */
      let seqT = 0;
      let announced = false, notifiedReady = false;
      const boot = host.parentElement || host;

      return {
        part: function (ms) { partMs = Math.max(1, ms); partT = 0; },
        render: function (dt, bits) {
          seqT += dt * 1000;
          if (!announced && seqT >= DOOR_HOLD_BEFORE_TEXT_MS) {
            announced = true;
            boot.classList.add("is-announcing");
          }
          if (!notifiedReady && seqT >= DOOR_READY_MS) {
            notifiedReady = true;
            if (info.notifyReady) info.notifyReady();
          }

          const frames = artSheet.frames;
          if (!frames) {
            /* The sheet hasn't decoded yet — paper, and nothing drawn on
               it, rather than holding a previous build's last frame or
               reaching for a placeholder generator. On any real connection
               this is a handful of frames at most; the loading bar is
               already telling the truth about there being something to
               wait for. */
            bits.fill(0);
          } else {
            if (!reduceMotion) t += dt * 1000;
            /* Cross-faded rather than cut from one stored frame straight to
               the next: the reference plays at 25fps, and this scene's own
               loop can run many times faster than that on an uncapped rAF,
               so without it every stored frame would simply hold, unchanged,
               across several rendered frames and then jump — the exact
               choppiness a from-scratch generator produced, just with a
               memory this time. Blending the two nearest stored frames by
               how far between them the clock actually is turns that jump
               into the same continuous drift the footage itself has. Loops,
               since this scene is ambient rather than a one-way resolve —
               there is no frame here that reads as more "finished" than
               any other. */
            const pos = (t / ART_FRAME_MS) % ART_FRAME_COUNT;
            const i0 = pos | 0;
            const i1 = (i0 + 1) % ART_FRAME_COUNT;
            const mix = reduceMotion ? 0 : pos - i0;
            const frame0 = frames[i0], frame1 = frames[i1];

            for (let y = 0; y < H; y++) {
              const row = y * W;
              const fv = (y - cover.originY) / cover.scale;
              for (let x = 0; x < W; x++) {
                const fu = (x - cover.originX) / cover.scale;
                const c0 = frameSheetSample(frame0, ART_TILE_W, ART_TILE_H, fu, fv);
                const coverage = mix > 0 ? c0 + (frameSheetSample(frame1, ART_TILE_W, ART_TILE_H, fu, fv) - c0) * mix : c0;
                bits[row + x] = dither(x, y, coverage);
              }
            }
          }

          if (partMs) {
            partT += dt * 1000;
            dissolve = Math.min(1, partT / partMs);
            if (dissolve > 0) {
              for (let y = 0; y < H; y++) {
                const row = y * W;
                for (let x = 0; x < W; x++) {
                  const i = row + x;
                  if (bits[i] && dither(x, y, dissolve)) bits[i] = 0;
                }
              }
            }
          }
        },
      };
    });
  }

  /* ── The letter grid: architecture's own field ───────────────────────────── */

  /* Thirty-six real frames of a grid of the same bold "A", each cell
     independently streaked by a bad vertical hold and settling out of step
     with its neighbours into a flat letterform — a few of them dropping to
     a flat halftone square partway through, the signal losing the shape
     entirely for a beat before it catches hold again. Looped exactly the
     way the catalogue's own clip is: straight back to the first frame the
     instant the last one plays, cross-faded through the seam the same as
     every other frame-to-frame step, no hold and no stop-start between
     passes — a continuous replay, still going underneath when KRITOR
     arrives over it and still going underneath when the page goes with
     it, never a resolve that plays once and sits still. */
  const ARCH_TILE_W = 130, ARCH_TILE_H = 85;   // stored per frame, at the
                                                // reference's own 724:474
  const ARCH_FRAME_COUNT = 36;
  const ARCH_FRAME_MS = 50;            // native pace of the reference clip —
                                        // 36 frames loop in 1.8s
  const ARCH_SHEET_URL = "/architecture-loader-frames.webp";
  const archSheet = { frames: null, requested: false };

  function letterGrid(host) {
    loadFrameSheet(archSheet, ARCH_SHEET_URL, ARCH_TILE_W, ARCH_TILE_H, ARCH_FRAME_COUNT);
    return run(host, reduceMotion ? 12 : Infinity, function (W, H, info) {
      const cover = frameSheetCover(W, H, ARCH_TILE_W, ARCH_TILE_H);
      let t = 0;
      let partMs = 0, partT = 0, dissolve = 0;

      /* See blockGlitch()'s own seqT for why this is a second clock rather
         than reusing t: the arrival has to keep time under reduced motion
         even though the field itself goes still. */
      let seqT = 0;
      let announced = false, notifiedReady = false;
      const boot = host.parentElement || host;

      return {
        part: function (ms) { partMs = Math.max(1, ms); partT = 0; },
        render: function (dt, bits) {
          seqT += dt * 1000;
          if (!announced && seqT >= DOOR_HOLD_BEFORE_TEXT_MS) {
            announced = true;
            boot.classList.add("is-announcing");
          }
          if (!notifiedReady && seqT >= DOOR_READY_MS) {
            notifiedReady = true;
            if (info.notifyReady) info.notifyReady();
          }

          const frames = archSheet.frames;
          if (!frames) {
            bits.fill(0);
          } else {
            /* Reduced motion holds the reference's own last frame outright
               — the closest thing the real clip has to "resolved" —
               rather than starting the clock at 0 and freezing there, which
               would hold the FIRST frame instead: the most heavily
               smeared one there is, the opposite of what reduced motion is
               asking for. */
            let i0, i1, mix;
            if (reduceMotion) {
              i0 = i1 = ARCH_FRAME_COUNT - 1;
              mix = 0;
            } else {
              t += dt * 1000;
              const pos = (t / ARCH_FRAME_MS) % ARCH_FRAME_COUNT;
              i0 = pos | 0;
              i1 = (i0 + 1) % ARCH_FRAME_COUNT;
              mix = pos - i0;
            }
            const frame0 = frames[i0], frame1 = frames[i1];

            for (let y = 0; y < H; y++) {
              const row = y * W;
              const fv = (y - cover.originY) / cover.scale;
              for (let x = 0; x < W; x++) {
                const fu = (x - cover.originX) / cover.scale;
                const c0 = frameSheetSample(frame0, ARCH_TILE_W, ARCH_TILE_H, fu, fv);
                const coverage = mix > 0 ? c0 + (frameSheetSample(frame1, ARCH_TILE_W, ARCH_TILE_H, fu, fv) - c0) * mix : c0;
                bits[row + x] = dither(x, y, coverage);
              }
            }
          }

          if (partMs) {
            partT += dt * 1000;
            dissolve = Math.min(1, partT / partMs);
            if (dissolve > 0) {
              for (let y = 0; y < H; y++) {
                const row = y * W;
                for (let x = 0; x < W; x++) {
                  const i = row + x;
                  if (bits[i] && dither(x, y, dissolve)) bits[i] = 0;
                }
              }
            }
          }
        },
      };
    });
  }

  /* ── The tiger: the front door's own arrival ─────────────────────────────── */

  /* The front door used to have no scene at all — a blank sheet of paper and
     the bar, nothing else, answered the moment the bar itself was hit rather
     than by anything on screen. This is its scene now: a tiger's eyes,
     opening.

     The reference clip is one continuous blink loop — eyes open, closing,
     held shut for a beat, opening again, back to open — so open and closed
     both already exist in the same footage, at opposite ends of the same
     arc. Fourteen real frames of that arc are kept here (the source clip's
     own frames 7 through 20 — the shut hold through to fully open again;
     the other half of the loop, open easing down into shut, is the same
     motion this scene already has a use for, just run backwards). Frame 0
     is the shut hold, frame 13 is fully open, and this scene only ever
     plays that one arc, forwards to arrive and backwards to leave — never
     the loop itself, which is why it does not use ART_FRAME_MS/loop's
     modulo-wrap the way the block glitch and the letter grid do.

     Sequence: the shut frame fades up from blank paper — the door isn't
     merely present, it's a photograph resolving — then the eyes open in
     one pass and hold there, open, for as long as the visitor stays on
     this page. Answered not by a click on the scene itself (there is
     nothing here to click; the bar's own links are the door) but by
     leaving — landing.js calls close() the moment ART, ARCHITECTURE or
     STORE is clicked, plays the same arc backwards, and only sends the
     browser on once the eyes are actually shut, so the cut to whatever
     comes next lands on a blink rather than mid-motion. */
  const TIGER_TILE_W = 200, TIGER_TILE_H = 108;
  const TIGER_FRAME_COUNT = 14;
  const TIGER_FRAME_MS = 75;           // native pace of the reference clip —
                                        // the 13-frame arc runs in ~975ms
  const TIGER_FADE_MS = 1000;          // the shut frame's own fade up from
                                        // blank paper, before it starts to open
  const TIGER_SHEET_URL = "/tiger-loader-frames.webp";
  const tigerSheet = { frames: null, requested: false };

  function tigerEyes(host) {
    loadFrameSheet(tigerSheet, TIGER_SHEET_URL, TIGER_TILE_W, TIGER_TILE_H, TIGER_FRAME_COUNT);
    return run(host, reduceMotion ? 12 : Infinity, function (W, H, info) {
      const cover = frameSheetCover(W, H, TIGER_TILE_W, TIGER_TILE_H);
      const lastFrame = TIGER_FRAME_COUNT - 1;

      /* fade-in  the shut frame rising out of blank paper
         opening   playing forward, shut toward open
         held      sitting on the open frame, waiting to be left
         closing   playing backward, from wherever it was, toward shut
         closed    sitting on the shut frame — close()'s promise has
                   resolved and landing.js is free to cut away */
      let phase = "fade-in";
      let t = 0;
      let pos = 0;
      let closeFromPos = 0;
      let notifiedOpen = false;
      let closeResolve = null;
      const closedPromise = new Promise(function (res) { closeResolve = res; });

      /* Unlike every other scene in this file, this one sits still for as
         long as a visitor lingers on the front door — held open is the
         ordinary resting state of this whole page, not a brief beat between
         two motions. Run uncapped the way the block glitch and the letter
         grid do, that meant real work happening forever for a picture that
         never changed: the per-pixel sampling pass below (two bilinear
         reads and a dither compare, times a few hundred cells), then
         present()'s own pass over the same cells, then the browser
         re-running the CRT filter's blur-and-channel-shift chain against
         the canvas because putImageData had touched it again — all of it,
         every single rAF, and that chain was the actual cost behind the
         drawn cursor lagging on this page. render() returns false instead
         of drawing whenever the last frame drawn is bit-for-bit what this
         one would draw again, which tells the driver in run() to skip
         present() too — nothing downstream of an unchanged picture runs. */
      let drawnPos = -1, drawnAppear = -1;

      return {
        part: function () {},
        close: function () {
          if (phase !== "closing" && phase !== "closed") {
            closeFromPos = pos;
            t = 0;
            phase = "closing";
          }
          return closedPromise;
        },
        render: function (dt, bits) {
          const frames = tigerSheet.frames;
          if (!frames) { bits.fill(0); return; }

          let appear = 1;

          if (reduceMotion) {
            /* No motion, but the sequence still has to run to completion —
               close() is still a real promise landing.js awaits before it
               navigates, just settled on the next frame instead of after
               a played-out reverse. */
            if (phase === "fade-in" || phase === "opening") {
              phase = "held";
              if (!notifiedOpen && info.notifyReady) { notifiedOpen = true; info.notifyReady(); }
            } else if (phase === "closing") {
              phase = "closed";
              closeResolve();
            }
            pos = phase === "closed" ? 0 : lastFrame;
          } else {
            t += dt * 1000;
            if (phase === "fade-in") {
              appear = Math.min(1, t / TIGER_FADE_MS);
              pos = 0;
              if (appear >= 1) { phase = "opening"; t = 0; }
            } else if (phase === "opening") {
              pos = t / TIGER_FRAME_MS;
              if (pos >= lastFrame) {
                pos = lastFrame;
                phase = "held";
                if (!notifiedOpen && info.notifyReady) { notifiedOpen = true; info.notifyReady(); }
              }
            } else if (phase === "held") {
              pos = lastFrame;
            } else if (phase === "closing") {
              pos = closeFromPos - t / TIGER_FRAME_MS;
              if (pos <= 0) { pos = 0; phase = "closed"; closeResolve(); }
            } else {
              pos = 0;
            }
          }

          if (pos === drawnPos && appear === drawnAppear) return false;
          drawnPos = pos; drawnAppear = appear;

          const i0 = pos | 0;
          const i1 = i0 + 1 <= lastFrame ? i0 + 1 : i0;
          const mix = pos - i0;
          const frame0 = frames[i0], frame1 = frames[i1];

          for (let y = 0; y < H; y++) {
            const row = y * W;
            const fv = (y - cover.originY) / cover.scale;
            for (let x = 0; x < W; x++) {
              const fu = (x - cover.originX) / cover.scale;
              const c0 = frameSheetSample(frame0, TIGER_TILE_W, TIGER_TILE_H, fu, fv);
              let coverage = mix > 0 ? c0 + (frameSheetSample(frame1, TIGER_TILE_W, TIGER_TILE_H, fu, fv) - c0) * mix : c0;
              if (appear < 1) coverage *= appear;
              bits[row + x] = dither(x, y, coverage);
            }
          }
        },
      };
    });
  }

  /* ── The globe: the store's own arrival ──────────────────────────────────── */

  /* Australia and Tasmania, simplified to the capes and gulfs a low-resolution
     dithered sphere actually needs — Cape York's point, the Gulf of
     Carpentaria's notch, the Great Australian Bight's long bite out of the
     south, Tasmania sitting apart below — not a survey-grade trace. Degrees
     of longitude and latitude, wound clockwise from Cape York. */
  const GLOBE_AU_POLY = [
    [142.5, -10.7], [143.5, -13.0], [145.5, -16.5], [146.5, -19.0], [148.5, -20.5],
    [150.5, -22.5], [152.5, -25.0], [153.3, -27.5], [153.5, -30.0], [151.5, -33.0],
    [150.0, -36.0], [148.5, -37.7], [146.5, -38.8], [144.7, -38.2], [142.0, -38.3],
    [140.0, -38.0], [137.8, -35.6], [137.0, -34.8], [135.5, -34.4], [133.0, -32.5],
    [129.0, -31.5], [124.0, -33.5], [118.0, -34.0], [115.1, -34.4], [115.7, -32.0],
    [114.0, -28.5], [113.4, -24.0], [116.0, -20.5], [122.0, -18.0], [123.5, -17.0],
    [126.5, -14.5], [129.0, -14.9], [130.8, -12.4], [132.0, -11.5], [135.0, -11.8],
    [136.5, -12.2], [137.0, -16.5], [138.5, -17.0], [140.5, -17.3], [141.5, -14.8],
    [141.9, -12.0],
  ];
  const GLOBE_TAS_POLY = [
    [144.7, -41.0], [146.3, -41.2], [148.3, -40.8], [148.3, -42.9],
    [147.5, -43.6], [146.0, -43.5], [144.7, -42.5],
  ];

  function globePointInPoly(poly, x, y) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1];
      const xj = poly[j][0], yj = poly[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  /* One degree of longitude by one of latitude — plenty for a coastline that
     is at most a few dozen native pixels across on screen. Built once, ever:
     it depends only on the two polygons above, never on a canvas size. */
  const GLOBE_LAND_W = 360, GLOBE_LAND_H = 181;
  const GLOBE_LAND = new Uint8Array(GLOBE_LAND_W * GLOBE_LAND_H);
  (function buildGlobeLandMask() {
    for (let latI = 0; latI < GLOBE_LAND_H; latI++) {
      const lat = latI - 90;
      for (let lonI = 0; lonI < GLOBE_LAND_W; lonI++) {
        const isLand = globePointInPoly(GLOBE_AU_POLY, lonI, lat) || globePointInPoly(GLOBE_TAS_POLY, lonI, lat);
        GLOBE_LAND[latI * GLOBE_LAND_W + lonI] = isLand ? 1 : 0;
      }
    }
  })();

  function globeLandAt(lonRad, latRad) {
    let lonDeg = (lonRad * 180 / Math.PI) % 360;
    if (lonDeg < 0) lonDeg += 360;
    let latDeg = latRad * 180 / Math.PI;
    if (latDeg < -90) latDeg = -90; else if (latDeg > 90) latDeg = 90;
    return GLOBE_LAND[((latDeg + 90) | 0) * GLOBE_LAND_W + (lonDeg | 0)];
  }

  function globeSmoothstep(v) { return v * v * (3 - 2 * v); }

  /* Two octaves of value noise — hashed lattice points, bilinearly blended,
     eased at the edges — rather than the single-cell hash2() the rest of
     this file uses for grain. The bloom-in wants a coherent field with
     blobby, merging clusters, not hash2's salt-and-pepper. */
  function globeNoise2(x, y, seed) {
    let total = 0, amp = 0.62, freq = 1, sum = 0;
    for (let o = 0; o < 2; o++) {
      const sx = x * freq, sy = y * freq;
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const fx = globeSmoothstep(sx - x0), fy = globeSmoothstep(sy - y0);
      const s = seed + o * 101;
      const h00 = hash2(x0, y0, s), h10 = hash2(x0 + 1, y0, s);
      const h01 = hash2(x0, y0 + 1, s), h11 = hash2(x0 + 1, y0 + 1, s);
      const a = h00 + (h10 - h00) * fx;
      const b = h01 + (h11 - h01) * fx;
      total += (a + (b - a) * fy) * amp;
      sum += amp;
      amp *= 0.55;
      freq *= 2.3;
    }
    return total / sum;
  }

  /* Every constant that shapes the globe and its timing, named here rather
     than buried below. */
  const GLOBE_DIAMETER_FRAC = 0.66;      // sphere diameter, as a fraction of
                                          // the frame's shorter side
  const GLOBE_LON_CENTER = 133;          // degrees — brings Australia to the
  const GLOBE_LAT_CENTER = -25;          // centre of the disc at rest
  const GLOBE_OCEAN_BANDS = 4;           // quantised shading steps
  const GLOBE_ROTATE_RAD_PER_S = (Math.PI * 2) / 90;  // one full turn a minute
                                                        // and a half
  const GLOBE_NOISE_SCALE = 0.11;        // coarseness of the bloom-in field —
                                          // smaller reads as bigger clusters
  /* The bloom is already resolved to its finished state under reduced motion
     (see bloomEase below), so at full length it is 1.6 seconds of waiting for
     something that is not going to happen — it is scaled here with the holds
     rather than left out of them. */
  const GLOBE_BLOOM_MS = 1600 * HOLD;
  const GLOBE_HOLD_BEFORE_TEXT_MS = 800 * HOLD;
  const GLOBE_TEXT_FADE_MS = 700;        // matched by the CSS transition on
                                          // .boot-mark/.boot-sub
  const GLOBE_HOLD_AFTER_TEXT_MS = 1100 * HOLD;
  const GLOBE_READY_MS = GLOBE_BLOOM_MS + GLOBE_HOLD_BEFORE_TEXT_MS
    + GLOBE_TEXT_FADE_MS + GLOBE_HOLD_AFTER_TEXT_MS;
  const GLOBE_SHIMMER_MS = 90;           // how long the ocean's dither phase
                                          // holds before it shifts to the next
  const GLOBE_LAND_STEP = 2;             // the coastline lookup (the one part
                                          // of this that needs a trig call) is
                                          // sampled on a grid this many native
                                          // pixels wide rather than every
                                          // pixel; the shading and dither
                                          // underneath stay full resolution,
                                          // so only the coastline itself gets
                                          // very slightly coarser — a quarter
                                          // the atan2/asin calls for a
                                          // difference nobody sees through a
                                          // CRT filter and a nearest-neighbour
                                          // upscale.

  function globe(host) {
    return run(host, reduceMotion ? 12 : 30, function (W, H, info) {
      const cx = W / 2, cy = H / 2;
      const radius = Math.max(1, Math.min(W, H) * GLOBE_DIAMETER_FRAC / 2);
      const N = W * H;

      /* Everything that doesn't depend on the spin — whether a pixel is on
         the sphere at all, its view-space direction with the latitude
         centring already undone, its fixed (view-space, non-rotating) light
         intensity, and its static bloom-in noise value — computed once here
         rather than every frame. Only the spin itself, one shared angle, is
         a per-frame quantity; turning it into a per-pixel longitude is the
         one thing below that still needs doing every frame. */
      const inGlobe = new Uint8Array(N);
      const baseX = new Float32Array(N), baseY = new Float32Array(N), baseZ = new Float32Array(N);
      const shade = new Float32Array(N);
      const bloom = new Float32Array(N);

      const latC = GLOBE_LAT_CENTER * Math.PI / 180;
      const cosLatC = Math.cos(-latC), sinLatC = Math.sin(-latC);

      /* The light, fixed in view space — the sphere turns under it, the
         terminator never turns with it. */
      const llen = Math.hypot(-0.5, 0.55, 0.66);
      const Lx = -0.5 / llen, Ly = 0.55 / llen, Lz = 0.66 / llen;

      let idx = 0;
      for (let y = 0; y < H; y++) {
        const ny = (y - cy) / radius;
        for (let x = 0; x < W; x++, idx++) {
          const nx = (x - cx) / radius;
          const r2 = nx * nx + ny * ny;
          if (r2 > 1) { inGlobe[idx] = 0; continue; }
          inGlobe[idx] = 1;
          const nz = Math.sqrt(1 - r2);
          /* Screen-down is south: negated here so the sphere reads north-up,
             the way every map on this site already does. */
          const Vx = nx, Vy = -ny, Vz = nz;
          baseX[idx] = Vx;
          baseY[idx] = Vy * cosLatC - Vz * sinLatC;
          baseZ[idx] = Vy * sinLatC + Vz * cosLatC;
          shade[idx] = Math.max(0, Vx * Lx + Vy * Ly + Vz * Lz);
          bloom[idx] = globeNoise2(x * GLOBE_NOISE_SCALE, y * GLOBE_NOISE_SCALE, 4242);
        }
      }

      const lonC = GLOBE_LON_CENTER * Math.PI / 180;
      let t = 0;
      let announced = false;
      let notifiedReady = false;
      const boot = host.parentElement || host;
      let partMs = 0, partT = 0, dissolve = 0;

      return {
        part: function (ms) { partMs = Math.max(1, ms); partT = 0; },
        render: function (dt, bits) {
          /* Always advances, reduced motion included — it is the sequence's
             own clock, not a visual knob. Every place below that turns it
             into motion (bloomEase, spin, shimmerPhase) already has its own
             reduceMotion ternary holding that one static frame; gating the
             clock itself instead would freeze the sequence at "blank"
             forever, since neither the text nor the ready signal below would
             ever fire. */
          t += dt * 1000;

          /* Poked once, at the one moment it matters — the fade-in itself is
             CSS, keyed off this class, not driven frame by frame from here. */
          if (!announced && t >= GLOBE_BLOOM_MS + GLOBE_HOLD_BEFORE_TEXT_MS) {
            announced = true;
            boot.classList.add("is-announcing");
          }

          /* The one moment the caller is allowed to start fading this scene
             away — on this same clock, always strictly after "announced"
             above, so a slow frame or two can never let the flight home
             start before the wordmark it is supposed to be flying in on has
             actually shown up. */
          if (!notifiedReady && t >= GLOBE_READY_MS) {
            notifiedReady = true;
            if (info.notifyReady) info.notifyReady();
          }

          const bloomEase = reduceMotion ? 1 : globeSmoothstep(Math.min(1, t / GLOBE_BLOOM_MS));
          const spin = lonC + (reduceMotion ? 0 : (t / 1000) * GLOBE_ROTATE_RAD_PER_S);
          const cosA = Math.cos(spin), sinA = Math.sin(spin);
          const shimmerPhase = reduceMotion ? 0 : Math.floor(t / GLOBE_SHIMMER_MS);
          const shimmerDX = (shimmerPhase * 3) | 0, shimmerDY = (shimmerPhase * 5) | 0;

          for (let by = 0; by < H; by += GLOBE_LAND_STEP) {
            const yEnd = Math.min(H, by + GLOBE_LAND_STEP);
            for (let bx = 0; bx < W; bx += GLOBE_LAND_STEP) {
              const xEnd = Math.min(W, bx + GLOBE_LAND_STEP);
              const si = by * W + bx;
              let land = 0;
              if (inGlobe[si]) {
                const Wx = baseX[si] * cosA + baseZ[si] * sinA;
                const Wz = -baseX[si] * sinA + baseZ[si] * cosA;
                const lon = Math.atan2(Wx, Wz);
                const lat = Math.asin(Math.max(-1, Math.min(1, baseY[si])));
                land = globeLandAt(lon, lat);
              }
              for (let y = by; y < yEnd; y++) {
                const row = y * W;
                for (let x = bx; x < xEnd; x++) {
                  const i = row + x;
                  if (!inGlobe[i]) { bits[i] = 0; continue; }
                  if (bloomEase < 1 && bloom[i] > bloomEase) { bits[i] = 0; continue; }
                  if (land) { bits[i] = 0; continue; }
                  const band = Math.min(GLOBE_OCEAN_BANDS - 1, (shade[i] * GLOBE_OCEAN_BANDS) | 0);
                  const coverage = (band + 0.5) / GLOBE_OCEAN_BANDS;
                  bits[i] = dither(x + shimmerDX, y + shimmerDY, coverage);
                }
              }
            }
          }

          if (partMs) {
            partT += dt * 1000;
            dissolve = Math.min(1, partT / partMs);
            if (dissolve > 0) {
              for (let y = 0; y < H; y++) {
                const row = y * W;
                for (let x = 0; x < W; x++) {
                  const i = row + x;
                  if (bits[i] && dither(x, y, dissolve)) bits[i] = 0;
                }
              }
            }
          }
        },
      };
    });
  }

  window.KritorFX = {
    blockGlitch: blockGlitch, letterGrid: letterGrid, globe: globe, tigerEyes: tigerEyes,
    reduceMotion: reduceMotion,
  };
})();
