/* KRITOR — pixel effects.

   Two animations for the two loading screens, both drawn as real pixels onto a
   canvas a few hundred cells wide and then blown up with nearest-neighbour, so
   a "pixel" on the boot screen is a square block of the same family as the
   1-bit renditions the catalogue is built out of. The screen used to be
   characters — a Doom fire and a field of full stops set in a <pre> — and
   characters are a different bitmap from the one the rest of the site speaks
   in: the works are pixels, the icons are pixels, and the door was text
   pretending.

     gate   a storm running across a plain: three ranks of cloud crossing at
            their own speeds, lightning every few seconds, a ruin on the far
            horizon and one figure on the near ridge looking at it. The
            wordmark is cut into the same grid, so the lightning reaches it.
     warp   the flight between the catalogue and the store, forwards on the way
            out and backwards on the way home.

   Nothing in the gate is a fixed-size sprite. The letters, the ruin and the
   figure are shapes — polygons and rectangles in their own coordinates —
   rasterised into whatever grid the screen turns out to give, and the clouds
   are built from unions of circles at the size they are needed. A bitmap
   sprite would have had to be drawn twice, once for a phone and once for a
   desktop, or else scaled by whole numbers and put two-by-two blocks on a
   one-by-one background, which is the one thing that reads as fake on a
   screen made of squares.

   The sky is where the picture lives, so it is kept clean: no tone in it at
   all, and everything you can see up there is a cloud with a hard edge, on the
   move. An ordered-dither gradient held across a whole sky is a screen door —
   it never moves, and at this size it buries anything drawn behind it.

   One bit, not one colour. Everything below produces a buffer of 0 and 1 and
   the driver paints 1 as --ink and 0 as --bg, so both scenes are correct in
   paper mode and in terminal mode without knowing which one is on. What tone
   there is comes from dither — during a strike, and in the far rank of cloud —
   which is what an actual 1-bit machine would have had to do, and what the
   renditions in the catalogue already do.

   Nothing allocates per frame. The scene is built once per size into flat
   typed arrays, a frame is a pass over those arrays into an ImageData, and
   between frames the only things that change are where each cloud is, the
   flash level, and whichever pixels the bolt is on. */
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

  /* A stream, for the things built once at layout time — the shape of each
     cloud, where the towers stand. Seeded, so the same screen rebuilds the
     same weather rather than dealing a new sky every time it is resized. */
  function rng(seed) {
    let s = (seed >>> 0) || 1;
    return function () {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
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
  const TARGET_COLS = 340;
  const MIN_SCALE = 2;
  const MAX_SCALE = 10;

  /* ── Rasterising shapes ──────────────────────────────────────────────────── */

  /* Even-odd scanline fill, sampled at pixel centres so every edge lands
     between two cells and nothing is ever half-covered. Takes a list of
     contours rather than one ring, so a letter can carry its own counter — the
     hole in an O is the second contour of the same shape, not a second shape
     painted back in the paper colour, which would punch through whatever the
     first one was standing on. */
  function fillShape(buf, W, H, contours, value) {
    let minY = Infinity, maxY = -Infinity;
    for (let c = 0; c < contours.length; c++) {
      const pts = contours[c];
      for (let i = 0; i < pts.length; i++) {
        if (pts[i][1] < minY) minY = pts[i][1];
        if (pts[i][1] > maxY) maxY = pts[i][1];
      }
    }
    const y0 = Math.max(0, Math.round(minY));
    const y1 = Math.min(H - 1, Math.round(maxY));
    const xs = [];
    for (let y = y0; y <= y1; y++) {
      const cy = y + 0.5;
      xs.length = 0;
      for (let c = 0; c < contours.length; c++) {
        const pts = contours[c];
        for (let i = 0, n = pts.length; i < n; i++) {
          const a = pts[i], b = pts[(i + 1) % n];
          if ((a[1] <= cy) === (b[1] <= cy)) continue;
          xs.push(a[0] + (cy - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
        }
      }
      if (xs.length < 2) continue;
      xs.sort(function (p, q) { return p - q; });
      const row = y * W;
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const sx = Math.max(0, Math.round(xs[k]));
        const ex = Math.min(W - 1, Math.round(xs[k + 1]) - 1);
        for (let x = sx; x <= ex; x++) buf[row + x] = value;
      }
    }
  }

  /* Contours given in their own units, placed and scaled on the way in. */
  function fillShapeAt(buf, W, H, contours, ox, oy, sx, sy, value) {
    const out = [];
    for (let c = 0; c < contours.length; c++) {
      const pts = contours[c];
      const ring = new Array(pts.length);
      for (let i = 0; i < pts.length; i++) ring[i] = [ox + pts[i][0] * sx, oy + pts[i][1] * sy];
      out.push(ring);
    }
    fillShape(buf, W, H, out, value);
  }

  function rect(buf, W, H, x0, y0, x1, y1, value) {
    const a = Math.max(0, Math.round(x0)), b = Math.min(W - 1, Math.round(x1) - 1);
    const c = Math.max(0, Math.round(y0)), d = Math.min(H - 1, Math.round(y1) - 1);
    for (let y = c; y <= d; y++) {
      const row = y * W;
      for (let x = a; x <= b; x++) buf[row + x] = value;
    }
  }

  /* ── The wordmark ────────────────────────────────────────────────────────── */

  /* KRITOR as it is drawn in the notebook, cut as outlines rather than as a
     bitmap: one weight, everything on the diagonal, a spur where a stem meets
     an arm, and a drip off the foot of each. Units are a hundred tall from cap
     to baseline, drips hanging below that, so the whole word can be rasterised
     to whatever height the screen leaves for it and still land on whole cells.

     The counters are second contours of the same shape, so the sky shows
     through the O rather than a hole being painted in it afterwards. */
  const GLYPHS = {
    K: {
      w: 66,
      shapes: [
        [[[4, 0], [26, 0], [26, 100], [4, 100]]],                       // stem
        [[[26, 58], [40, 58], [66, 0], [52, 0]]],                       // arm
        [[[26, 42], [40, 42], [66, 100], [50, 100]]],                   // leg
        [[[8, 100], [15, 100], [11, 119]]],                             // drips
        [[[53, 100], [60, 100], [57, 113]]],
      ],
    },
    R: {
      w: 58,
      shapes: [
        [[[4, 0], [26, 0], [26, 100], [4, 100]]],
        [
          [[22, 0], [46, 0], [58, 12], [58, 34], [46, 46], [22, 46]],   // bowl
          [[30, 10], [42, 10], [48, 17], [48, 29], [42, 36], [30, 36]], // counter
        ],
        [[[28, 42], [42, 42], [58, 100], [44, 100]]],                   // leg
        [[[8, 100], [15, 100], [11, 116]]],
        [[[46, 100], [53, 100], [50, 111]]],
      ],
    },
    I: {
      w: 34,
      shapes: [
        [[[11, 0], [23, 0], [23, 100], [11, 100]]],
        [[[1, 0], [33, 0], [33, 12], [1, 12]]],
        [[[1, 88], [33, 88], [33, 100], [1, 100]]],
        [[[14, 100], [21, 100], [17, 115]]],
      ],
    },
    T: {
      w: 64,
      shapes: [
        [[[0, 0], [64, 0], [64, 14], [0, 14]]],
        [[[25, 14], [41, 14], [41, 100], [25, 100]]],
        [[[17, 88], [49, 88], [49, 100], [17, 100]]],
        [[[29, 100], [37, 100], [33, 120]]],
      ],
    },
    O: {
      w: 64,
      shapes: [
        [
          [[2, 22], [16, 2], [48, 2], [62, 22], [62, 78], [48, 98], [16, 98], [2, 78]],
          [[18, 28], [26, 16], [38, 16], [46, 28], [46, 72], [38, 84], [26, 84], [18, 72]],
        ],
        [[[24, 94], [31, 94], [27, 117]]],
        [[[48, 90], [54, 90], [51, 105]]],
      ],
    },
  };

  const WORD = "KRITOR";
  const WORD_GAP = 8;                       // in glyph units
  const WORD_UNITS = (function () {
    let w = 0;
    for (let i = 0; i < WORD.length; i++) w += GLYPHS[WORD[i]].w + (i ? WORD_GAP : 0);
    return w;
  })();
  const WORD_DEPTH = 120;                   // baseline is 100; the drips reach here

  function wordWidth(capHeight) { return Math.round(WORD_UNITS * capHeight / 100); }
  function wordDepth(capHeight) { return Math.round(WORD_DEPTH * capHeight / 100); }

  function drawWord(buf, W, H, x, y, capHeight, value) {
    const s = capHeight / 100;
    let cx = x;
    for (let i = 0; i < WORD.length; i++) {
      const g = GLYPHS[WORD[i]];
      for (let k = 0; k < g.shapes.length; k++) {
        fillShapeAt(buf, W, H, g.shapes[k], cx, y, s, s, value);
      }
      cx += (g.w + WORD_GAP) * s;
    }
  }

  /* ── The ruin ────────────────────────────────────────────────────────────── */

  /* Built rather than drawn: towers of their own heights and widths, a wall
     between them with an archway still standing in it, battlements knocked
     about, and windows left open to the sky. Assembled at whatever size the
     horizon gives it, so a wide screen gets a ruin with more in it rather than
     the same forty cells stretched.

     Returned as its own little buffer, 1 for stone and 2 for the holes — the
     windows and the arch — which the caller punches back out of the landscape
     so that whatever is behind the ruin shows through them. */
  function buildRuin(w, h, seed) {
    const rnd = rng(seed);
    const m = new Uint8Array(w * h);
    const unit = Math.max(1, Math.round(h * 0.07));

    /* The curtain wall, and the gate still standing in the middle of it. */
    const wallTop = Math.round(h * 0.56);
    rect(m, w, h, w * 0.08, wallTop, w * 0.92, h, 1);

    /* Battlements: every other block along the top, with gaps where they have
       come down. */
    for (let x = Math.round(w * 0.08); x < w * 0.92 - unit; x += unit * 2) {
      if (rnd() < 0.7) rect(m, w, h, x, wallTop - unit, x + unit, wallTop, 1);
    }
    for (let k = 0; k < 2; k++) {
      const bx = Math.round(w * (0.15 + rnd() * 0.6));
      rect(m, w, h, bx, wallTop, bx + unit * 2, wallTop + unit, 0);
    }

    /* The archway. Square-shouldered and then stepped in at the top, because a
       curve drawn this small is four cells that read as a mistake. */
    const ax = Math.round(w * 0.46), aw = Math.max(2, Math.round(w * 0.10));
    const at = Math.round(h * 0.76);
    rect(m, w, h, ax, at, ax + aw, h, 2);
    rect(m, w, h, ax + 1, at - Math.max(1, unit >> 1), ax + aw - 1, at, 2);

    /* Towers. Each is a block with its crown broken off in two or three clean
       steps rather than eaten away a cell at a time — chewed, they came out as
       staircases, and a staircase reads as scaffolding. The tall one is off to
       one side; the others are stumps, which is what makes the row a ruin
       rather than a skyline. */
    const towers = [
      { x: 0.00, w: 0.19, top: 0.26 },
      { x: 0.26, w: 0.12, top: 0.46 },
      { x: 0.68, w: 0.24, top: 0.04 },
    ];
    for (let i = 0; i < towers.length; i++) {
      const t = towers[i];
      const tx = Math.round(w * t.x), tw = Math.max(3, Math.round(w * t.w));
      const ty = Math.round(h * t.top);
      rect(m, w, h, tx, ty, tx + tw, h, 1);

      /* Two or three vertical slices of the crown, each dropped by its own
         amount. The tallest slice is left alone, so something is still
         standing. */
      const slices = 2 + Math.floor(rnd() * 2);
      const keep = Math.floor(rnd() * slices);
      for (let k = 0; k < slices; k++) {
        if (k === keep) continue;
        const sx = tx + Math.round(tw * k / slices);
        const sw = Math.round(tw / slices);
        rect(m, w, h, sx, ty, sx + sw, ty + Math.round((h - ty) * (0.12 + rnd() * 0.3)), 0);
      }

      /* One slit, high up, where a window was. Two would be a building. */
      if (tw >= unit * 3) {
        const wx = tx + Math.round(tw * 0.38);
        const wy = ty + Math.round((h - ty) * 0.45);
        rect(m, w, h, wx, wy, wx + Math.max(1, Math.round(tw * 0.2)), wy + unit * 2, 2);
      }
    }
    return m;
  }

  /* ── The figure ──────────────────────────────────────────────────────────── */

  /* Hooded, back to us, staff planted, looking at the ruin. Outlines again
     rather than a sprite, for the same reason as the letters — and it buys the
     cloak, which is the one thing on him that moves: the hem is the same shape
     with its corners pushed about, so the wind that is driving the sky is
     visibly getting at him too.

     A hundred tall from crown to heel, staff standing above that. */
  const FIGURE = [
    [[[24, 0], [38, 0], [42, 7], [42, 19], [20, 19], [20, 7]]],           // hood
    [[[16, 19], [46, 19], [53, 54], [55, 84], [7, 84], [9, 54]]],         // shoulders and cloak
    [[[20, 80], [29, 80], [29, 100], [20, 100]]],                         // legs
    [[[33, 80], [42, 80], [42, 100], [33, 100]]],
    [[[60, -12], [66, -12], [66, 100], [60, 100]]],                       // staff
    [[[56, -14], [70, -14], [70, -7], [56, -7]]],                         // and its head
  ];
  const FIGURE_W = 70;

  /* Three hems. Same cloak, blown a little further each time. */
  const CLOAK = [
    [[[9, 60], [20, 60], [16, 88], [3, 82]]],
    [[[9, 60], [20, 60], [12, 90], [-3, 78]]],
    [[[9, 60], [20, 60], [15, 86], [1, 88]]],
  ];

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
      canvas.style.width = (W * scale) + "px";
      canvas.style.height = (H * scale) + "px";
      canvas.style.marginLeft = Math.round((cssW - W * scale) / 2) + "px";
      canvas.style.marginTop = Math.round((cssH - H * scale) / 2) + "px";

      img = ctx.createImageData(W, H);
      px = new Uint32Array(img.data.buffer);
      bits = new Uint8Array(W * H);
      readPalette();
      scene = build(W, H, { scale: scale, offsetTop: (cssH - H * scale) / 2 });
    }

    function present() {
      for (let i = 0, n = bits.length; i < n; i++) px[i] = bits[i] ? ink : paper;
      ctx.putImageData(img, 0, 0);
    }

    const interval = 1000 / fps;
    const frame = now => {
      if (stopped) return;
      raf = requestAnimationFrame(frame);
      if (document.hidden) { last = now; return; }
      const dt = now - last;
      if (dt < interval) return;
      last = now;
      scene.render(Math.min(dt, interval * 3) / 1000, bits);
      present();
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

    return function stop() {
      stopped = true;
      cancelAnimationFrame(raf);
      clearTimeout(resizeTimer);
      window.removeEventListener("resize", onResize);
      themeWatch.disconnect();
      host.textContent = "";
    };
  }

  /* ── The gate: a storm running across a plain ────────────────────────────── */

  /* A cloud is a union of circles on a flat base — which is the shape a cloud
     actually is, and it comes out of one bit with a hard edge and no help.
     Noise thresholded through a dither gave a cloud-coloured smear with no
     silhouette; a dozen overlapping discs gives something you can point at.

     Each carries the first and last set cell of every row, so laying it into
     the frame touches its own pixels and not the empty corners of its box —
     which is most of a box, for a shape made of circles. */
  function makeCloud(w, h, squash, rnd) {
    const mask = new Uint8Array(w * h);
    const base = h - 1;

    /* Lobes standing on one line. Each is round — a cloud is wide because it
       is made of many of them, not because each one has been squashed, and
       squashing them was what flattened the tops into slabs. They are spaced
       closer together than they are wide, so the union is one mass rather than
       a string of beads, and their radii vary as much as their spacing does,
       which is the whole of the silhouette.

       squash only ever goes above 1 for the far rank, where a cloud is far
       enough away to have lost its height. */
    const rMax = h * 0.58 / squash;
    const rMin = h * 0.26 / squash;
    const gap = Math.max(1, (rMin + rMax) * 0.52 * squash);
    const n = Math.max(3, Math.round(w / gap));
    for (let i = 0; i < n; i++) {
      /* Fullest a third of the way along rather than in the middle: a cloud
         with its weight off-centre reads as being blown somewhere. */
      const t = (i + 0.5) / n;
      const swell = 0.42 + 0.58 * Math.sin(Math.PI * Math.pow(t, 1.4));
      const ry = (rMin + (rMax - rMin) * rnd()) * swell + rMin * 0.5;
      const rx = ry * squash;
      const cx = (w / n) * (i + 0.5) + (rnd() - 0.5) * (w / n) * 0.6;
      /* Sitting below the line by a quarter of themselves, so the clip at the
         base is the only straight edge in the shape. */
      const cy = base - ry * (0.62 + rnd() * 0.26);
      const y0 = Math.max(0, Math.floor(cy - ry));
      const y1 = Math.min(base, Math.ceil(cy + ry));
      for (let y = y0; y <= y1; y++) {
        const dy = (y + 0.5 - cy) / ry;
        const span = 1 - dy * dy;
        if (span <= 0) continue;
        const half = rx * Math.sqrt(span);
        const x0 = Math.max(0, Math.round(cx - half));
        const x1 = Math.min(w - 1, Math.round(cx + half));
        const row = y * w;
        for (let x = x0; x <= x1; x++) mask[row + x] = 1;
      }
    }

    /* Row spans, so a frame only ever walks the cloud itself. */
    const from = new Int32Array(h), to = new Int32Array(h);
    for (let y = 0; y < h; y++) {
      let a = -1, b = -1;
      const row = y * w;
      for (let x = 0; x < w; x++) if (mask[row + x]) { if (a < 0) a = x; b = x; }
      from[y] = a; to[y] = b;
    }
    return { mask: mask, w: w, h: h, from: from, to: to };
  }

  function terrain(host) {
    return run(host, reduceMotion ? 12 : 24, function (W, H, info) {
      const N = W * H;
      const rnd = rng(W * 7919 + H);

      /* The scene has an aspect of its own and the viewport does not. Rather
         than stretch the horizon down a phone, the landscape keeps its shape
         and the screen's spare height becomes more sky above it and more
         ground below — which is what a title screen letterboxed onto a tall
         display should look like. */
      const sceneH = Math.min(H, Math.max(Math.round(W * 0.60), Math.round(H * 0.55)));
      const top = Math.round((H - sceneH) * 0.72);
      const hy = top + Math.round(sceneH * 0.66);          // the horizon
      const ridgeY = top + Math.round(sceneH * 0.74);      // crest of the near ridge
      const gy = top + Math.round(sceneH * 0.92);          // where the ridge meets the floor

      /* ── The name ────────────────────────────────────────────────────── */

      /* Sized to the scene and then held back to the screen, so a narrow phone
         gets a smaller name rather than one running off both edges. */
      let capH = Math.max(12, Math.round(sceneH * 0.17));
      if (wordWidth(capH) > W * 0.88) capH = Math.max(10, Math.floor(W * 0.88 * 100 / WORD_UNITS));
      const markW = wordWidth(capH);
      const markX = Math.round((W - markW) / 2);
      const markY = top + Math.round(sceneH * 0.28);
      const markBottom = markY + wordDepth(capH);

      /* Cut once into its own buffer with a cell of paper all round it, so a
         frame is a lookup rather than a re-rasterising of six letters, and so
         the halo can flip with the lightning. */
      const mark = new Uint8Array(N);
      drawWord(mark, W, H, markX, markY, capH, 1);
      const halo = new Uint8Array(N);
      const grow = Math.max(1, Math.round(capH * 0.06));
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (!mark[y * W + x]) continue;
          for (let dy = -grow; dy <= grow; dy++) {
            const ty = y + dy;
            if (ty < 0 || ty >= H) continue;
            for (let dx = -grow; dx <= grow; dx++) {
              const tx = x + dx;
              if (tx >= 0 && tx < W) halo[ty * W + tx] = 1;
            }
          }
        }
      }

      /* ── The land ────────────────────────────────────────────────────── */

      /* land  every cell the landscape occupies
         rim   its outline, which is all that is left of it when the sky goes
               white behind it
         still the plain's own marks, which are not landscape and not sky */
      const land = new Uint8Array(N);
      const rim = new Uint8Array(N);
      const still = new Uint8Array(N);

      /* The far shore, just under the horizon. Two long waves and a short one,
         so it has headlands rather than being a rule drawn across the page —
         at a couple of cells' amplitude that is the whole difference between
         a coast and a border. */
      for (let x = 0; x < W; x++) {
        const u = x / Math.max(1, W);
        const h = Math.max(1, Math.round(sceneH * 0.006 +
          (Math.sin(u * 7.1) * 0.5 + 0.5) * sceneH * 0.016 +
          (Math.sin(u * 19.3 + 2.1) * 0.5 + 0.5) * sceneH * 0.007));
        for (let y = hy - h; y <= hy && y < H; y++) if (y >= 0) land[y * W + x] = 1;
      }

      /* The ruin, across the plain from the figure. Held to a fifth of the
         scene's height so it never stands up into the line KRITOR is
         speaking, and given the width to be a ruin rather than a bump. */
      const ruinH = Math.max(10, Math.min(Math.round(sceneH * 0.20), hy - markBottom - 2));
      const ruinW = Math.round(ruinH * 2.1);
      const ruinX = Math.round(W * 0.20 - ruinW / 2);
      const ruinY = hy - ruinH + 1;
      if (ruinH > 8) {
        const ruin = buildRuin(ruinW, ruinH, 20260906);
        for (let y = 0; y < ruinH; y++) {
          const ty = ruinY + y;
          if (ty < 0 || ty >= H) continue;
          for (let x = 0; x < ruinW; x++) {
            const v = ruin[y * ruinW + x];
            if (!v) continue;
            const tx = ruinX + x;
            if (tx < 0 || tx >= W) continue;
            land[ty * W + tx] = v === 1 ? 1 : 0;
          }
        }
      }

      /* The near ridge: one long mound with the figure on its crest, and a
         smaller one behind it on the other side of the frame so the eye has
         somewhere to go after it has crossed. */
      const peakX = Math.round(W * 0.70);
      const spread = Math.max(6, W * 0.26);
      const backX = Math.round(W * 0.14);
      const backSpread = Math.max(5, W * 0.18);
      const nearTop = new Int32Array(W);
      for (let x = 0; x < W; x++) {
        const a = (x - peakX) / spread;
        const b = (x - backX) / backSpread;
        const rise = (gy - ridgeY) * Math.exp(-a * a) + (gy - ridgeY) * 0.30 * Math.exp(-b * b);
        /* A cell of grain along the crest: a mound drawn from a smooth
           function has a smooth edge, and nothing else here does. */
        nearTop[x] = Math.round(gy - rise) - (hash2(x, 3, 5501) < 0.34 ? 1 : 0);
      }
      for (let x = 0; x < W; x++) {
        for (let y = Math.max(0, nearTop[x]); y < H; y++) land[y * W + x] = 1;
      }

      /* Him. Feet on the crest, and tall enough to break the horizon — the
         whole composition is that he is on this side of it and the ruin is on
         the other. */
      const figH = Math.max(10, Math.round(sceneH * 0.15));
      const figS = figH / 100;
      const figX = peakX - Math.round(FIGURE_W * figS * 0.5);
      const figY = nearTop[Math.min(W - 1, Math.max(0, peakX))] - figH + Math.round(figH * 0.06);
      for (let i = 0; i < FIGURE.length; i++) {
        fillShapeAt(land, W, H, FIGURE[i], figX, figY, figS, figS, 1);
      }

      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          if (!land[i]) continue;
          if ((y === 0 || !land[i - W]) || (y === H - 1 || !land[i + W]) ||
              (x === 0 || !land[i - 1]) || (x === W - 1 || !land[i + 1])) rim[i] = 1;
        }
      }

      /* And a cell of clearance just outside that outline, which a cloud is
         never allowed to fill. Both the landscape and the weather are solid
         ink, so a cloud passing behind the figure simply became part of him —
         he grew a balloon — and a bank crossing the ruin swallowed its towers.
         One cell of paper between them is all it takes, and it is the same cut
         the name is standing in. */
      const landHalo = new Uint8Array(N);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (!rim[y * W + x]) continue;
          for (let dy = -1; dy <= 1; dy++) {
            const ty = y + dy;
            if (ty < 0 || ty >= H) continue;
            for (let dx = -1; dx <= 1; dx++) {
              const tx = x + dx;
              if (tx >= 0 && tx < W && !land[ty * W + tx]) landHalo[ty * W + tx] = 1;
            }
          }
        }
      }

      /* The cloak, rasterised once per hem into its own overlay. */
      const cloaks = [];
      for (let i = 0; i < CLOAK.length; i++) {
        const c = new Uint8Array(N);
        fillShapeAt(c, W, H, CLOAK[i], figX, figY, figS, figS, 1);
        cloaks.push(c);
      }

      /* The plain, running away from us to the ruin. Horizontal strokes, more
         of them and longer as the ground comes forward — the way the ground is
         drawn in the notebook — rather than a field of dither, because the
         plain has to stay quiet enough for something to stand on it. */
      const plainRows = Math.max(1, gy - hy);
      for (let y = hy + 1; y < gy; y++) {
        const t = (y - hy) / plainRows;
        const density = 0.010 + t * t * 0.055;
        let x = 0;
        while (x < W) {
          if (hash2(x, y, 6197) < density) {
            const len = Math.max(2, Math.round((2 + hash2(x, y, 8419) * (3 + t * 13)) * W / 200));
            for (let k = 0; k < len && x + k < W; k++) still[y * W + x + k] = 1;
            x += len + 2;
          } else x += 1;
        }
      }

      /* ── The sky ─────────────────────────────────────────────────────── */

      /* Three ranks, all going the same way, because wind does. The speeds are
         fractions of the width per second rather than cells, so the sky
         crosses the screen in the same time on a phone as on a desktop —
         about eighteen seconds for the near rank, a minute and a half for the
         far one, which is the parallax and is meant to be noticed. */
      /* Three ranks, all going the same way, because wind does. Spread over
         two and a half screens rather than one and a half so that only about a
         third of the sky is under cloud at any moment: packed any tighter they
         join into one black ceiling, and a ceiling cannot be seen to move
         however fast it is going. The gaps are the motion.

         Highest is slowest and smallest, nearest is lowest, biggest and
         fastest — the near rank crosses in about ten seconds and the high one
         takes a minute, which is the parallax and is meant to be noticed. */
      const RANKS = [
        /* Small ones a long way off, sitting behind the ruin and hardly
           moving. They are what stops the band between the name and the
           horizon being a white void, and they are round rather than drawn
           out — a distant cloud squashed into a streak reads as a wire strung
           across the picture, which is what the first attempt at this rank
           looked like. */
        { n: 5, span: 1.6, speed: 0.030, squash: 1.4,  sky: [0.55, 0.60], w: [0.06, 0.11], hw: 0.34 },
        { n: 5, span: 2.6, speed: 0.050, squash: 1.5,  band: [0.26, 0.46], w: [0.10, 0.18], hw: 0.30 },
        { n: 5, span: 2.6, speed: 0.110, squash: 1.25, band: [0.56, 0.74], w: [0.14, 0.24], hw: 0.28 },
        { n: 4, span: 2.6, speed: 0.200, squash: 1.1,  band: [0.82, 0.97], w: [0.20, 0.32], hw: 0.26 },
      ];
      const clouds = [];
      for (let r = 0; r < RANKS.length; r++) {
        const rk = RANKS[r];
        const span = W * rk.span;
        for (let i = 0; i < rk.n; i++) {
          const cw = Math.max(8, Math.round(W * (rk.w[0] + rnd() * (rk.w[1] - rk.w[0]))));
          /* Height off the cloud's own width, not off the scene. Measured
             against the scene, the same rank came out four times as wide as it
             was tall on a desktop and twice on a phone — the second is not a
             cloud, it is a boulder. */
          const ch = Math.max(5, Math.round(cw * rk.hw * (0.85 + rnd() * 0.3)));
          /* Where a rank hangs. The three that carry the weather are placed by
             where their base lands in the run from the top of the frame down
             to the name, rather than at a fraction of the scene — the scene is
             pushed down a tall screen, and measuring from it left the top
             third of a phone as blank paper. The low rank is the exception:
             it belongs to the horizon and is measured from the scene like the
             rest of the landscape. */
          const cy = rk.sky
            ? top + Math.round(sceneH * (rk.sky[0] + rnd() * (rk.sky[1] - rk.sky[0])))
            : Math.round(markY * (rk.band[0] + rnd() * (rk.band[1] - rk.band[0]))) - ch;
          clouds.push({
            shape: makeCloud(cw, ch, rk.squash, rnd),
            x: -cw + (i + rnd() * 0.9) * (span / rk.n),
            y: cy,
            speed: W * rk.speed * (reduceMotion ? 0.25 : 1),
            span: span,
          });
        }
      }
      const sky = new Uint8Array(N);

      /* ── The lightning ───────────────────────────────────────────────── */

      /* Level 0 is a quiet frame. Above it the sky fills toward solid ink, the
         landscape keeps its ink but loses its outline to paper, the clouds go
         to paper from behind and the bolt is the paper it is coming out of —
         so a strike is the picture turning inside out for a fifth of a second
         rather than anything getting brighter, which is all one bit can mean.

         Two flickers and a decay, because a single step reads as a dropped
         frame and real lightning never strikes once. */
      const BEATS = [[0.05, 0.85], [0.05, 0], [0.07, 1], [0.06, 0.25], [0.30, 0.65]];
      const bolt = new Uint8Array(N);
      let boltOn = false;
      let flash = 0, beat = -1, beatT = 0;
      let nextStrike = reduceMotion ? Infinity : 1.6 + Math.random() * 3.5;
      let t = 0, cloakT = 0, cloakFrame = 0;

      function strike() {
        bolt.fill(0);
        boltOn = true;
        const thick = Math.max(1, Math.round(W / 220));
        let x = Math.round(W * (0.12 + Math.random() * 0.72));
        let y = top + Math.round(sceneH * 0.04);
        const endY = hy - Math.round(sceneH * (0.02 + Math.random() * 0.06));
        const forkAt = y + Math.round((endY - y) * (0.35 + Math.random() * 0.3));
        let fork = null;
        const mark2 = (px2, py) => {
          for (let k = 0; k < thick; k++) {
            const tx = px2 + k;
            if (tx >= 0 && tx < W && py >= 0 && py < H) bolt[py * W + tx] = 1;
          }
        };
        const step = Math.max(2, Math.round(sceneH * 0.03));
        while (y < endY) {
          const run2 = step + Math.floor(Math.random() * step);
          const dx = Math.round((Math.random() - 0.5) * W * 0.03);
          for (let k = 0; k < run2 && y < endY; k++, y++) {
            const nx = x + Math.round(dx * k / run2);
            mark2(nx, y);
            /* Thicker at the top, where it is nearest, and down to a hair by
               the time it reaches the plain. */
            if (y < forkAt) mark2(nx + thick, y);
          }
          x += dx;
          if (fork === null && y >= forkAt) fork = { x: x, y: y, dir: Math.random() < 0.5 ? -1 : 1 };
        }
        if (fork) {
          let fx = fork.x, fy = fork.y;
          const len = Math.round((endY - fork.y) * (0.4 + Math.random() * 0.4));
          for (let k = 0; k < len; k++) {
            fx += fork.dir * (Math.random() < 0.55 ? 1 : 0);
            fy += 1;
            mark2(fx, fy);
          }
        }
      }

      /* Published so the line KRITOR speaks can be hung off the bottom of the
         drawn name rather than centred in the screen. Written on the boot
         element rather than on this one: a custom property inherits down, and
         the statement is this host's sibling, not its child. */
      (host.parentElement || host).style.setProperty("--boot-mark-bottom",
        Math.round(info.offsetTop + markBottom * info.scale) + "px");

      return {
        render: function (dt, bits) {
          t += dt;

          /* The sky. Cleared and relaid every frame at whole-cell positions —
             a cloud that moves by a third of a pixel is a cloud that has
             stopped being made of pixels — far rank first so the near one
             crosses in front of it. */
          sky.fill(0);
          for (let c = 0; c < clouds.length; c++) {
            const cl = clouds[c];
            cl.x -= cl.speed * dt;
            if (cl.x + cl.shape.w < 0) cl.x += cl.span;
            const ox = Math.round(cl.x);
            const shape = cl.shape;
            for (let y = 0; y < shape.h; y++) {
              const ty = cl.y + y;
              if (ty < 0 || ty >= H) continue;
              let a = shape.from[y];
              if (a < 0) continue;
              let b = shape.to[y];
              if (ox + a < 0) a = -ox;
              if (ox + b > W - 1) b = W - 1 - ox;
              const src = y * shape.w;
              const dst = ty * W + ox;
              for (let x = a; x <= b; x++) {
                const v = shape.mask[src + x];
                if (v) sky[dst + x] = v;
              }
            }
          }

          /* The strike clock. */
          if (beat >= 0) {
            beatT += dt;
            while (beat >= 0 && beatT >= BEATS[beat][0]) {
              beatT -= BEATS[beat][0];
              beat = beat + 1 < BEATS.length ? beat + 1 : -1;
            }
            if (beat < 0) { flash = 0; boltOn = false; }
            else {
              const span = BEATS[beat][0];
              const level = BEATS[beat][1];
              /* The last beat is the one that decays; the rest are held, which
                 is what makes them read as flicker rather than as a fade. */
              flash = beat === BEATS.length - 1 ? level * (1 - beatT / span) : level;
            }
          } else {
            nextStrike -= dt;
            if (nextStrike <= 0) {
              strike();
              beat = 0; beatT = 0; flash = BEATS[0][1];
              nextStrike = 3.2 + Math.random() * 6;
            }
          }

          cloakT += dt;
          if (cloakT > 0.5) {
            cloakT = 0;
            cloakFrame = (cloakFrame + 1 + (Math.random() < 0.3 ? 1 : 0)) % CLOAK.length;
          }
          const cloak = cloaks[cloakFrame];

          /* One pass. */
          const lit = flash > 0.001;
          for (let y = 0; y < H; y++) {
            const row = y * W;
            for (let x = 0; x < W; x++) {
              const i = row + x;
              let bit;
              if (land[i] || cloak[i]) {
                bit = lit && rim[i] ? 0 : 1;
              } else {
                if (sky[i]) bit = (lit || landHalo[i]) ? 0 : 1;
                else bit = lit ? dither(x, y, flash) : still[i];
              }
              if (boltOn && bolt[i]) bit = lit ? 0 : 1;
              if (halo[i]) bit = mark[i] ? (lit ? 0 : 1) : (lit ? 1 : 0);
              bits[i] = bit;
            }
          }
        },
      };
    });
  }

  /* ── The warp: the distance between the catalogue and the store ──────────── */

  /* Stars in a box in front of the camera, divided by their own depth onto the
     grid. Forward is z falling, which throws them past the edges; back is z
     climbing, which draws them into the middle. That is the only difference
     between leaving for the store and coming home from it.

     Where the character version had one glyph per star and a ramp of twelve
     densities to spend on them, this has a block: near stars are two and three
     cells across and drag a streak behind them, far ones are a single cell
     that the dither may or may not put down at all — which is what gives the
     field its depth now that there is no tone to give it. */
  function starfield(host, options) {
    const opts = options || {};
    const back = opts.direction === "back";

    return run(host, reduceMotion ? 16 : 30, function (W, H) {
      const count = Math.min(1600, Math.round(W * H * (0.045 + Math.random() * 0.025)));
      const NEAR = 0.35, FAR = 14;
      const FOV = W * 0.42;
      const xs = new Float32Array(count);
      const ys = new Float32Array(count);
      const zs = new Float32Array(count);
      /* Not every star streaks, and the ones that do not are what make the ones
         that do read as near. Fixed per star, so a streak never blinks. */
      const trails = new Uint8Array(count);
      const big = Math.max(1, Math.round(W / 200));

      const place = (i, z) => {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * 2.6;
        xs[i] = Math.cos(a) * r;
        ys[i] = Math.sin(a) * r;
        zs[i] = z;
      };
      for (let i = 0; i < count; i++) {
        place(i, NEAR + Math.random() * (FAR - NEAR));
        trails[i] = Math.random() < 0.42 ? 1 : 0;
      }

      let t = 0;

      return {
        render: function (dt, bits) {
          t += dt;
          bits.fill(0);
          /* It builds. A field already at full speed on the first frame has
             nothing to say; one that winds up reads as departure. */
          const ramp = reduceMotion ? 0.45 : Math.min(1, 0.25 + t * 0.85);
          const speed = (back ? 5.5 : 7) * ramp;
          const step = speed * dt;
          const cx = W / 2, cy = H / 2;

          const put = (x, y) => {
            if (x >= 0 && x < W && y >= 0 && y < H) bits[y * W + x] = 1;
          };
          const blob = (x, y, r) => {
            for (let dy = 0; dy < r; dy++) for (let dx = 0; dx < r; dx++) put(x + dx, y + dy);
          };

          for (let i = 0; i < count; i++) {
            let z = back ? zs[i] + step : zs[i] - step;
            if (z < NEAR) { place(i, FAR); z = zs[i]; }
            else if (z > FAR) { place(i, NEAR); z = zs[i]; }
            else zs[i] = z;

            const k = FOV / z;
            const sx = Math.round(cx + xs[i] * k);
            /* No halving here. The character grid had rows twice as tall as
               they were wide and the projection had to answer it; a pixel is
               square, so the field is finally round for free. */
            const sy = Math.round(cy + ys[i] * k);
            if (sx < -6 || sx >= W + 6 || sy < -6 || sy >= H + 6) continue;

            const near = Math.pow(1 - (z - NEAR) / (FAR - NEAR), 1.7);

            if (near > 0.72) blob(sx, sy, big * 2);
            else if (near > 0.34) blob(sx, sy, big);
            else if (dither(sx, sy, 0.22 + near * 1.6)) put(sx, sy);

            /* The streak, drawn back along the line to the vanishing point —
               forwards it trails behind, coming home it points the way in. */
            if (trails[i] && near > 0.42) {
              const kPrev = FOV / (back ? z - step * 3 : z + step * 3);
              const px2 = cx + xs[i] * kPrev, py2 = cy + ys[i] * kPrev;
              const dx = px2 - (cx + xs[i] * k), dy = py2 - (cy + ys[i] * k);
              /* Stepped a cell at a time along the direction, not divided into
                 a fixed number of stops along the distance: divided, a star
                 near the edge — which is where the distance is longest — came
                 out as a row of dots strung across the screen rather than as
                 the streak it is. */
              const reach = Math.hypot(dx, dy);
              const len = Math.min(9 * big, Math.round(reach));
              for (let s = 1; s <= len; s++) {
                put(Math.round(sx + dx / reach * s), Math.round(sy + dy / reach * s));
              }
            }
          }
        },
      };
    });
  }

  window.KritorFX = { terrain: terrain, starfield: starfield, reduceMotion: reduceMotion };
})();
