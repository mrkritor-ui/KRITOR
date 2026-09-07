/* KRITOR — pixel effects.

   Two animations for the two loading screens, both drawn as real pixels onto a
   canvas a few hundred cells wide and then blown up with nearest-neighbour, so
   a "pixel" on the boot screen is a square block of the same family as the
   1-bit renditions the catalogue is built out of. The screen used to be
   characters — a Doom fire and a field of full stops set in a <pre> — and
   characters are a different bitmap from the one the rest of the site speaks
   in: the works are pixels, the icons are pixels, and the door was text
   pretending.

     gate   a low sun over water, four ranks of cloud crossing at their own
            speeds, a range with ruins on two of its tops, an aqueduct and a
            keep and a fallen colonnade along the far shore, one figure on the
            near ridge with a fire beside him, a tree over the right of the
            frame with a bird sitting in it, and the ground cut open under all
            of it. Lightning every few seconds. The wordmark is cut into the
            same grid as the rest, so the lightning reaches it.
     warp   the flight between the catalogue and the store, forwards on the way
            out and backwards on the way home.

   On the gate nothing holds still. The clouds cross, the water runs — two
   stroke layers pulled past each other, each row at its own rate — the mist
   drifts along the shore, the grass and the branches lean into the same gusts,
   leaves come off the tree and cross the whole screen, the bird looks around,
   the fire never repeats, its smoke climbs and thins out of the dither, and
   there is something still alive in the soil. Getting on for half the canvas
   changes every three seconds; the version of this screen with a fixed dither
   gradient for a sky changed about a fortieth, and looked it.

   Nothing in the gate is a fixed-size sprite. The letters, the ruins, the
   figure and the bird are shapes — polygons and rectangles in their own
   coordinates — rasterised into whatever grid the screen turns out to give;
   the clouds are unions of circles built at the size they are needed; the
   range, the aqueduct, the colonnade and everything under the ground are
   generated. A bitmap sprite would have had to be drawn twice, once for a
   phone and once for a desktop, or else scaled by whole numbers and put
   two-by-two blocks on a one-by-one background, which is the one thing that
   reads as fake on a screen made of squares. It is also why the grid could go
   from two hundred cells across to nearly five hundred without any of this
   being redrawn.

   The sky is where the picture lives, so it is kept clean: no tone in it at
   all, and everything you can see up there is a cloud with a hard edge, on the
   move. An ordered-dither gradient held across a whole sky is a screen door —
   it never moves, and at this size it buries anything drawn behind it.

   Everywhere else, tone is the point. Solid ink against paper and nothing in
   between is a cut-out: the far shore had the same weight as the ridge six
   feet away, and the whole picture read as two flat plates. So distance is
   dithered — the range is emptied out with only its skyline left solid and is
   shaded on the flanks the sun is not on, mist eats into the far shore and the
   feet of the ruins, a stipple eats into the near ridge under its crest, smoke
   thins as it climbs, and the name itself opens from solid at the caps into a
   stipple at the drips. The foreground was a quarter of the picture spent on
   solid black, so the ground is cut open: below the turf it is a section, and
   ink in there is what you draw with rather than what the ground is made of.
   Between the white of the water and the black of what is left there is a
   middle now, and things can stand in it.

   One bit, not one colour. Everything below produces a buffer of 0 and 1 and
   the driver paints 1 as --ink and 0 as --bg, so both scenes are correct in
   paper mode and in terminal mode without knowing which one is on — which is
   what an actual 1-bit machine would have had to do, and what the renditions
   in the catalogue already do.

   Nothing allocates per frame. The scene is built once per size into flat
   typed arrays — the water and the mist as textures twice the screen wide, so
   they can be pulled past forever and meet themselves — and a frame is a pass
   over those arrays into an ImageData. The tree is the exception and is laid
   out and drawn every frame, several hundred quads of it, which is why there
   is a filler here that cannot allocate. Under six milliseconds at the largest
   grid this hands out, against a frame budget of forty at the rate it runs. */
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
  const TARGET_COLS = 460;
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

  /* The same scanline for a quad, with nowhere for it to allocate. The tree
     lays down several hundred of these a frame — every limb and every leaf —
     and going through fillShape meant a fresh array for the ring and one per
     corner each time, which cost more than the filling did. */
  const QX = new Float64Array(4);
  const QY = new Float64Array(4);
  const QC = new Float64Array(4);

  function fillQuad(buf, W, H, value) {
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < 4; i++) {
      if (QY[i] < minY) minY = QY[i];
      if (QY[i] > maxY) maxY = QY[i];
    }
    const y0 = Math.max(0, Math.round(minY));
    const y1 = Math.min(H - 1, Math.round(maxY));
    for (let y = y0; y <= y1; y++) {
      const cy = y + 0.5;
      let n = 0;
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) & 3;
        const ay = QY[i], by = QY[j];
        if ((ay <= cy) === (by <= cy)) continue;
        QC[n++] = QX[i] + (cy - ay) / (by - ay) * (QX[j] - QX[i]);
      }
      if (n < 2) continue;
      for (let a = 1; a < n; a++) {           // insertion sort, four at most
        const v = QC[a];
        let b = a - 1;
        while (b >= 0 && QC[b] > v) { QC[b + 1] = QC[b]; b--; }
        QC[b + 1] = v;
      }
      const row = y * W;
      for (let k = 0; k + 1 < n; k += 2) {
        const sx = Math.max(0, Math.round(QC[k]));
        const ex = Math.min(W - 1, Math.round(QC[k + 1]) - 1);
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

  /* An aqueduct, which is the one Roman thing that still reads at forty cells
     across: a row of arches on piers, stepped down as it goes so it looks like
     it is carrying water somewhere, and broken off at one end. */
  function buildAqueduct(w, h, seed) {
    const rnd = rng(seed);
    const m = new Uint8Array(w * h);
    const bays = 5 + Math.floor(rnd() * 3);
    const bay = w / bays;
    const pier = Math.max(1, Math.round(bay * 0.24));
    const deck = Math.max(2, Math.round(h * 0.14));
    const standing = Math.max(2, bays - 1 - Math.floor(rnd() * 2));
    for (let i = 0; i < bays; i++) {
      const x = i * bay;
      /* The run falls away as it goes, and the last bay or two are gone. */
      const dropTop = Math.round(h * (0.10 + i * 0.05));
      if (i >= standing) {
        /* A broken pier, standing on its own with nothing on top. */
        if (rnd() < 0.75) {
          rect(m, w, h, x, dropTop + deck + Math.round(h * (0.1 + rnd() * 0.3)), x + pier, h, 1);
        }
        continue;
      }
      rect(m, w, h, x, dropTop, x + bay + pier, dropTop + deck, 1);   // the channel
      rect(m, w, h, x, dropTop, x + pier, h, 1);                      // the pier
      /* The arch: square shoulders stepped in twice, because a curve four
         cells across is a mistake, not a curve. */
      const step = Math.max(1, Math.round(h * 0.04));
      const aTop = dropTop + deck + step * 2;
      rect(m, w, h, x + pier, aTop, x + bay, h - Math.max(1, Math.round(h * 0.05)), 2);
      rect(m, w, h, x + pier + step, aTop - step, x + bay - step, aTop, 2);
      rect(m, w, h, x + pier + step * 2, aTop - step * 2, x + bay - step * 2, aTop - step, 2);
    }
    rect(m, w, h, 0, h - Math.max(1, Math.round(h * 0.05)), w, h, 1);  // the footing
    return m;
  }

  /* And what is left of a colonnade: a few drums still stacked, one column
     standing, and the rest of it lying where it fell. */
  function buildColumns(w, h, seed) {
    const rnd = rng(seed);
    const m = new Uint8Array(w * h);
    const drum = Math.max(1, Math.round(h * 0.09));
    const wide = Math.max(2, Math.round(h * 0.15));
    let x = Math.round(w * 0.04);
    while (x < w - wide) {
      const tall = Math.round(h * (0.18 + rnd() * 0.72));
      const topY = h - tall;
      /* Stacked drums with a gap between them, so the shaft reads as
         something assembled rather than as a post. */
      for (let y = h - drum; y > topY; y -= drum + 1) {
        rect(m, w, h, x, Math.max(topY, y - drum), x + wide, y, 1);
      }
      /* A capital on the ones still tall enough to have kept it. */
      if (tall > h * 0.6 && rnd() < 0.7) {
        rect(m, w, h, x - 1, topY - Math.max(1, Math.round(h * 0.05)), x + wide + 1, topY, 1);
      }
      x += wide + Math.max(2, Math.round(h * (0.10 + rnd() * 0.25)));
    }
    /* And the fallen ones, lying in a line of drums along the ground. */
    const lying = 1 + Math.floor(rnd() * 3);
    for (let k = 0; k < lying; k++) {
      const lx = Math.round(w * rnd() * 0.8);
      const ly = h - Math.max(1, Math.round(h * (0.04 + rnd() * 0.10)));
      const run = Math.round(w * (0.14 + rnd() * 0.22));
      for (let d = 0; d < run; d += drum + 1) {
        rect(m, w, h, lx + d, ly - wide * 0.8, lx + d + drum, ly, 1);
      }
    }
    return m;
  }

  /* ── Under the ground ────────────────────────────────────────────────────── */

  /* The near ridge was the largest solid thing on the screen and it was solid
     all the way down, which is a quarter of the picture spent on nothing. So
     it is cut open: below a wavy line the soil becomes a section — grain, the
     roots hanging out of the turf above, stones, and what is left of whatever
     used to walk about up there.

     Everything in here is drawn into the same knockout the mist uses. Inside
     the cut the ground has been knocked to paper, so ink is what you draw WITH
     and paper is what you draw ON — which is why a bone is a hollow outline
     and a stone is a ring rather than a dot. */

  function segDist(px, py, x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0;
    const L2 = dx * dx + dy * dy || 1;
    let u = ((px - x0) * dx + (py - y0) * dy) / L2;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const cx = x0 + dx * u, cy = y0 + dy * u;
    return Math.hypot(px - cx, py - cy);
  }

  /* A bone: a shaft with a knuckle at each end, hollow, so it reads as
     something with an edge rather than as a smear. */
  function bone(hz, land, W, H, x0, y0, x1, y1, rEnd, rMid, th) {
    const lo = Math.max(0, Math.floor(Math.min(y0, y1) - rEnd - 1));
    const hi = Math.min(H - 1, Math.ceil(Math.max(y0, y1) + rEnd + 1));
    const le = Math.max(0, Math.floor(Math.min(x0, x1) - rEnd - 1));
    const ri = Math.min(W - 1, Math.ceil(Math.max(x0, x1) + rEnd + 1));
    for (let y = lo; y <= hi; y++) {
      const row = y * W;
      for (let x = le; x <= ri; x++) {
        if (!land[row + x]) continue;
        const dA = Math.hypot(x - x0, y - y0), dB = Math.hypot(x - x1, y - y1);
        const dS = segDist(x, y, x0, y0, x1, y1);
        if (!(dA <= rEnd || dB <= rEnd || dS <= rMid)) continue;
        const inner = dA <= rEnd - th || dB <= rEnd - th || dS <= rMid - th;
        hz[row + x] = inner ? 1 : 0;
      }
    }
  }

  function ring(hz, land, W, H, cx, cy, rx, ry, th, hollow) {
    const lo = Math.max(0, Math.floor(cy - ry)), hi = Math.min(H - 1, Math.ceil(cy + ry));
    const le = Math.max(0, Math.floor(cx - rx)), ri = Math.min(W - 1, Math.ceil(cx + rx));
    for (let y = lo; y <= hi; y++) {
      const row = y * W;
      const dy = (y - cy) / ry;
      for (let x = le; x <= ri; x++) {
        if (!land[row + x]) continue;
        const dx = (x - cx) / rx;
        const d = dx * dx + dy * dy;
        if (d > 1) continue;
        const inner = (dx * rx / (rx - th)) * (dx * rx / (rx - th))
          + (dy * ry / (ry - th)) * (dy * ry / (ry - th));
        hz[row + x] = (hollow && inner <= 1) ? 1 : 0;
      }
    }
  }

  function carveUnder(hz, land, W, H, cutTop, sceneH, seed) {
    const rnd = rng(seed);
    const unit = Math.max(1, Math.round(sceneH * 0.012));

    /* Open the section, and grain it. The grain thickens downward, so the
       floor of the cut is darker than the turf line and the thing does not
       read as a hole with nothing in it. */
    for (let x = 0; x < W; x++) {
      const c = cutTop[x];
      for (let y = c; y < H; y++) {
        const i = y * W + x;
        if (!land[i]) continue;
        const depth = (y - c) / Math.max(1, H - c);
        hz[i] = dither(x, y, 0.10 + depth * 0.16) ? 0 : 1;
      }
    }

    /* Roots out of the turf. They fork once or twice and taper away, and they
       are what ties the section to the grass growing on top of it. */
    for (let k = 0; k < Math.round(W / 26); k++) {
      let rx = Math.round(rnd() * W);
      if (rx < 1 || rx >= W - 1) continue;
      let ry = cutTop[rx];
      const runs = [{ x: rx, y: ry, dx: (rnd() - 0.5) * 0.7, len: unit * (5 + rnd() * 9), w: 1 }];
      while (runs.length) {
        const r = runs.pop();
        let px = r.x, py = r.y, drift = r.dx;
        for (let n = 0; n < r.len; n++) {
          drift += (rnd() - 0.5) * 0.22;
          drift = Math.max(-0.9, Math.min(0.9, drift));
          px += drift; py += 1;
          const ix = Math.round(px), iy = Math.round(py);
          if (ix < 0 || ix >= W || iy < 0 || iy >= H) break;
          for (let w = 0; w < r.w; w++) {
            const jx = ix + w;
            if (jx < W && land[iy * W + jx]) hz[iy * W + jx] = 0;
          }
          if (r.w > 0 && n > r.len * 0.35 && runs.length < 4 && rnd() < 0.045) {
            runs.push({ x: px, y: py, dx: -drift * 1.6, len: r.len * 0.5, w: r.w });
          }
        }
      }
    }

    /* Stones, and the odd pocket of air. */
    for (let k = 0; k < Math.round(W / 20); k++) {
      const x = rnd() * W;
      const c = cutTop[Math.max(0, Math.min(W - 1, Math.round(x)))];
      const y = c + unit * 2 + rnd() * Math.max(1, H - c - unit * 2);
      const r = unit * (0.7 + rnd() * 1.1);
      ring(hz, land, W, H, x, y, r * (0.9 + rnd() * 0.5), r, Math.max(1, r * 0.42), rnd() < 0.65);
    }

    /* And the bones. One skull with a socket in it, a scatter of long bones,
       and a short run of ribs — enough to be read as an animal without being
       laid out like a museum case. */
    const sx = W * (0.30 + rnd() * 0.34);
    const sc = cutTop[Math.max(0, Math.min(W - 1, Math.round(sx)))];
    const sy = sc + (H - sc) * (0.42 + rnd() * 0.3);
    const sr = unit * 2.4;
    ring(hz, land, W, H, sx, sy, sr * 1.25, sr, Math.max(1, sr * 0.34), true);
    ring(hz, land, W, H, sx - sr * 1.35, sy + sr * 0.25, sr * 0.7, sr * 0.45,
      Math.max(1, sr * 0.3), true);                                   // the snout
    ring(hz, land, W, H, sx - sr * 0.25, sy - sr * 0.2,
      Math.max(1, sr * 0.30), Math.max(1, sr * 0.30), 99, false);     // the socket

    for (let k = 0; k < 4; k++) {
      const bx = W * (0.14 + rnd() * 0.72);
      const bc = cutTop[Math.max(0, Math.min(W - 1, Math.round(bx)))];
      const by = bc + (H - bc) * (0.35 + rnd() * 0.55);
      const a = rnd() * Math.PI;
      const L = unit * (3.5 + rnd() * 4);
      bone(hz, land, W, H, bx - Math.cos(a) * L, by - Math.sin(a) * L * 0.5,
        bx + Math.cos(a) * L, by + Math.sin(a) * L * 0.5,
        Math.max(1.4, unit * 0.95), Math.max(1, unit * 0.55), Math.max(1, unit * 0.42));
    }

    const rbx = sx + sr * 3.2, rby = sy + sr * 0.8;
    for (let k = 0; k < 5; k++) {
      const off = k * unit * 1.5;
      bone(hz, land, W, H, rbx + off, rby - sr * 1.1, rbx + off + unit * 0.8, rby + sr * 1.2,
        Math.max(1, unit * 0.5), Math.max(0.8, unit * 0.4), Math.max(1, unit * 0.34));
    }
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

  /* ── The sun ─────────────────────────────────────────────────────────────── */

  /* Low in the top left, and drawn as a ring with a stipple inside it rather
     than as a disc: a solid circle in this system is a hole punched in the
     sky, and the one thing the sun must not look like is an absence. The
     stipple thickens toward the lower right, away from itself, so it has a
     side — which is also the side every mountain below it is shaded on.

     Its rays breathe. Nothing else up there is on a count that slow. */
  function drawSun(buf, W, H, cx, cy, r, t) {
    const inner = r - Math.max(1, Math.round(r * 0.13));
    const y0 = Math.max(0, cy - r), y1 = Math.min(H - 1, cy + r);
    const x0 = Math.max(0, cx - r), x1 = Math.min(W - 1, cx + r);
    for (let y = y0; y <= y1; y++) {
      const dy = y - cy;
      const row = y * W;
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > r) continue;
        if (d >= inner) { buf[row + x] = 1; continue; }
        const lean = 0.5 + (dx + dy) / (2.6 * r);
        if (dither(x, y, 0.06 + 0.26 * lean)) buf[row + x] = 1;
      }
    }
    const spokes = 12;
    const gap = Math.max(2, Math.round(r * 0.22));
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const len = r * (0.20 + 0.20 * (0.5 + 0.5 * Math.sin(t * 0.85 + i * 1.9)));
      for (let k = 0; k <= len; k++) {
        const x = Math.round(cx + ca * (r + gap + k));
        const y = Math.round(cy + sa * (r + gap + k));
        if (x >= 0 && x < W && y >= 0 && y < H) buf[y * W + x] = 1;
      }
    }
  }

  /* ── The tree ────────────────────────────────────────────────────────────── */

  /* Grown rather than drawn, and grown once: a skeleton of segments, each
     hanging off its parent by an angle, which the frame then lays out with the
     wind added in. Everything downstream of a segment inherits its bend, so a
     gust travels out along a limb the way it does in a tree rather than every
     twig wagging on its own.

     Lengths are in trunk-lengths and angles are from straight up, so the whole
     thing scales to whatever the screen gave us. */
  function buildTree(seed) {
    const rnd = rng(seed);
    const segs = [];
    /* Angles are carried absolutely and clamped off vertical, then stored
       relative to the parent. Left to accumulate, one branch in three ended up
       pointing sideways and downhill and ran clear across the picture. */
    /* How far off vertical a branch may end up, and it is not one number: the
       trunk and the first forks have to stay upright or the tree ends up
       reaching across the whole picture, while the tips are allowed to splay,
       which is where the crown's shape comes from. */
    const lean = d => 0.34 + d * 0.24;
    function grow(parent, abs, len, girth, depth) {
      const i = segs.length;
      const angle = abs - (parent < 0 ? 0 : segs[parent].abs);
      segs.push({
        parent: parent, angle: angle, abs: abs, len: len, girth: girth, depth: depth,
        phase: rnd() * Math.PI * 2,
        rate: 0.7 + rnd() * 0.9,
        frond: false,
      });
      if (depth >= 2) segs[i].frond = true;
      if (depth >= 4 || len < 0.05) return;
      /* Three ways at the first fork and mostly two after it, so the crown
         opens out instead of doubling into a bush. */
      const n = depth === 0 ? 3 : (rnd() < 0.3 ? 3 : 2);
      for (let k = 0; k < n; k++) {
        const spread = 0.42 + rnd() * 0.45;
        const off = (k - (n - 1) / 2) * spread + (rnd() - 0.5) * 0.28;
        const cap = lean(depth);
        const childAbs = Math.max(-cap, Math.min(cap, abs + off));
        /* Halving at each fork, near enough. At two thirds the first branches
           were as long as the trunk and the crown crossed the whole sky like
           cabling. */
        grow(i, childAbs, len * (0.47 + rnd() * 0.16), girth * 0.56, depth + 1);
      }
    }
    grow(-1, -0.22, 1, 1, 0);
    return segs;
  }

  /* A tapered limb: the quad between two widths, so a branch narrows as it
     goes and the fork does not step. */
  function limb(buf, W, H, x0, y0, x1, y1, w0, w1, value) {
    const dx = x1 - x0, dy = y1 - y0;
    const L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L, ny = dx / L;
    QX[0] = x0 + nx * w0; QY[0] = y0 + ny * w0;
    QX[1] = x1 + nx * w1; QY[1] = y1 + ny * w1;
    QX[2] = x1 - nx * w1; QY[2] = y1 - ny * w1;
    QX[3] = x0 - nx * w0; QY[3] = y0 - ny * w0;
    fillQuad(buf, W, H, value);
  }

  /* One leaf: a lens on the angle it grew at. Long and thin, because the
     canopy in the notebook is fronds rather than a cloud of blobs, and a fan
     of thin leaves lets the sky through where a blob would not. */
  function leaf(buf, W, H, x, y, ang, len, wid, value) {
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const mid = len * 0.38;
    QX[0] = x;                       QY[0] = y;
    QX[1] = x + ca * mid + sa * wid; QY[1] = y + sa * mid - ca * wid;
    QX[2] = x + ca * len;            QY[2] = y + sa * len;
    QX[3] = x + ca * mid - sa * wid; QY[3] = y + sa * mid + ca * wid;
    fillQuad(buf, W, H, value);
  }

  /* ── The bird ────────────────────────────────────────────────────────────── */

  /* Perched, and doing what a perched bird does, which is almost nothing and
     then a very fast small thing. The head is held apart from the body so it
     can turn without the rest of it moving — that is the whole animation, and
     it is more alive than making the body sway would be.

     Feet at 100, crown at 0, looking left out over the water. */
  const BIRD_BODY = [
    [[[12, 42], [40, 34], [58, 48], [56, 68], [40, 80], [20, 78], [8, 60]]],  // body
    [[[52, 50], [86, 60], [82, 74], [50, 68]]],                               // tail
    [[[24, 76], [29, 76], [29, 100], [24, 100]]],                             // legs
    [[[38, 76], [43, 76], [43, 100], [38, 100]]],
  ];
  const BIRD_HEAD = [
    [[[22, 16], [38, 12], [44, 32], [36, 48], [22, 46], [18, 28]]],           // neck
    [[[14, 0], [34, -2], [42, 10], [36, 24], [18, 24], [10, 12]]],            // head
    [[[-16, 8], [12, 4], [12, 16]]],                                          // beak
  ];
  const BIRD_EYE = [[[19, 5], [26, 5], [26, 12], [19, 12]]];
  const BIRD_W = 94;

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

  /* ── Water ───────────────────────────────────────────────────────────────── */

  /* The plain is water, and water is the only thing in the picture that is
     drawn the way the notebook draws it: horizontal strokes, longer and more
     of them as the ground comes forward. Two of these are laid over each other
     and pulled past at slightly different rates, which is what makes it flow
     rather than shimmer in place — one layer alone reads as a texture being
     dragged, and two crossing read as a surface.

     Twice the screen wide, so it can be scrolled forever and meet itself. */
  function buildWater(WT, rows, seed) {
    const tex = new Uint8Array(WT * rows);
    const rnd = rng(seed);
    for (let y = 0; y < rows; y++) {
      const t = rows > 1 ? y / (rows - 1) : 0;
      const density = 0.010 + t * t * 0.055;
      const reach = 2 + t * 18;
      let x = 0;
      while (x < WT) {
        if (rnd() < density) {
          const len = Math.max(2, Math.round(2 + rnd() * reach));
          for (let k = 0; k < len && x + k < WT; k++) tex[y * WT + x + k] = 1;
          x += len + 2;
        } else x += 1;
      }
    }
    return tex;
  }

  /* ── Fire ────────────────────────────────────────────────────────────────── */

  /* A campfire on the ridge, drawn as a silhouette like everything else in the
     foreground — a flame in one bit cannot be bright, it can only be a shape
     that never holds still, and the flicker is what says fire. What it does
     get is a hole burnt in the middle of it, which is the one place on this
     screen where paper means heat.

     The column heights come off two sines beating against each other at
     unrelated rates, so the flame never repeats on any count you could
     watch. */
  function drawFlame(over, W, H, cx, baseY, w, h, t) {
    const half = Math.max(1, w / 2);
    const from = -Math.ceil(half), to = Math.ceil(half);
    for (let dx = from; dx <= to; dx++) {
      const u = dx / half;
      if (u < -1 || u > 1) continue;
      const x = cx + dx;
      if (x < 0 || x >= W) continue;
      const taper = Math.pow(Math.max(0, 1 - u * u), 0.55);
      /* The flicker runs on the flame's own width, not on the cell index —
         driven per column it changed by a lot between neighbours and the fire
         came out as a comb of spikes rather than as two or three tongues. */
      const lick = 0.58
        + 0.24 * Math.sin(t * 7.3 + u * 2.1)
        + 0.16 * Math.sin(t * 12.1 - u * 3.4)
        + 0.10 * Math.sin(t * 3.1 + u * 5.0);
      const tall = h * taper * (0.5 + lick);
      for (let k = 0; k < tall; k++) {
        const y = baseY - k;
        if (y >= 0 && y < H) over[y * W + x] = 1;
      }
    }
    /* The heart of it, and the one place on this screen where paper means
       heat rather than sky. */
    const coreW = Math.max(1, Math.round(half * 0.62));
    const coreH = Math.max(2, Math.round(h * (0.36 + 0.10 * Math.sin(t * 9.4))));
    for (let dx = -coreW; dx <= coreW; dx++) {
      const x = cx + dx;
      if (x < 0 || x >= W) continue;
      const u = dx / (coreW + 0.5);
      const tall = coreH * Math.pow(Math.max(0, 1 - u * u), 0.5)
        * (0.78 + 0.22 * Math.sin(t * 13.7 + u * 2.6));
      for (let k = 1; k <= tall; k++) {
        const y = baseY - k;
        if (y >= 0 && y < H) over[y * W + x] = 2;
      }
    }
  }

  function terrain(host) {
    return run(host, reduceMotion ? 12 : 24, function (W, H, info) {
      const N = W * H;
      const rnd = rng(W * 7919 + H);
      /* Twice the screen wide, and shared: everything that scrolls — the
         water, the mist — is built at this width so it can be pulled past
         forever and meet itself. */
      const WT = W * 2;

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
      /* Cut at full weight first: the halo has to follow the whole silhouette,
         not the shaded version of it, or the letters lose their cut where the
         stipple has opened them up. */
      const solid = new Uint8Array(N);
      drawWord(solid, W, H, markX, markY, capH, 1);

      /* Then shaded. Solid across the caps and opening into a stipple as it
         comes down, so the name has weight at the top and lifts off the sky at
         the foot — the drips end up as the lightest thing in it, which is
         where a drip should be going. */
      const mark = new Uint8Array(N);
      const shadeTop = markY + Math.round(capH * 0.30);
      const shadeRun = Math.max(1, markY + wordDepth(capH) - shadeTop);
      for (let y = 0; y < H; y++) {
        const t = Math.min(1, Math.max(0, (y - shadeTop) / shadeRun));
        const weight = 1 - Math.pow(t, 1.25) * 0.42;
        const row = y * W;
        for (let x = 0; x < W; x++) {
          if (solid[row + x] && dither(x, y, weight)) mark[row + x] = 1;
        }
      }
      const halo = new Uint8Array(N);
      const grow = Math.max(1, Math.round(capH * 0.06));
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (!solid[y * W + x]) continue;
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

      /* Mountains, a long way behind everything. They carry the depth: without
         a rank between the sky and the shore the picture had one distance in
         it, and a horizon with nothing standing behind it is an edge rather
         than a view. Peaks are the highest of a handful of ridges laid over
         each other, so the range has shoulders and saddles instead of a row of
         identical triangles.

         Kept light on purpose — the stipple that empties them out is laid in
         with the mist further down, and only their skyline stays solid. */
      const mtnH = Math.round(sceneH * 0.20);
      const mtnTop = new Int32Array(W);
      const mtnLit = new Float32Array(W);
      /* Which cells are actually rock. Everything standing on the shore is
         landscape too, and stippling by row rather than by what is there
         emptied out the aqueduct and the keep along with the range — the whole
         middle distance came back as one grey smear with no objects in it. */
      const mtnMask = new Uint8Array(N);
      (function () {
        const peaks = [];
        const n = 5 + Math.floor(rnd() * 3);
        for (let i = 0; i < n; i++) {
          peaks.push({
            x: W * ((i + 0.5) / n + (rnd() - 0.5) * 0.5),
            h: mtnH * (0.42 + rnd() * 0.58),
            w: W * (0.12 + rnd() * 0.22),
          });
        }
        for (let x = 0; x < W; x++) {
          let rise = 0;
          for (let i = 0; i < peaks.length; i++) {
            const p = peaks[i];
            const d = Math.abs(x - p.x) / p.w;
            if (d >= 1) continue;
            /* Straight flanks with a rounded shoulder, which is a mountain;
               a gaussian gives a hill and a triangle gives a tent. */
            const v = p.h * Math.pow(1 - d, 1.35);
            if (v > rise) rise = v;
          }
          /* A cell or two of broken rock on the skyline. */
          rise += (hash2(x, 5, 7717) - 0.4) * sceneH * 0.012;
          mtnTop[x] = hy - Math.max(0, Math.round(rise));
        }
        /* Which side of each slope the sun is on. The light is in the top
           left, so a flank that climbs to the right is lit and one that falls
           away to the right is in shadow, and the range gets a form instead of
           being a flat cut-out. */
        for (let x = 0; x < W; x++) {
          const a = mtnTop[Math.max(0, x - 2)], b = mtnTop[Math.min(W - 1, x + 2)];
          mtnLit[x] = Math.max(0, Math.min(1, 0.5 + (b - a) * 0.09));
        }
      })();
      for (let x = 0; x < W; x++) {
        for (let y = Math.max(0, mtnTop[x]); y <= hy && y < H; y++) {
          land[y * W + x] = 1;
          mtnMask[y * W + x] = 1;
        }
      }

      /* And a ruin on two of the tops, because a skyline with a broken
         silhouette on it is read as somewhere people have been. */
      for (let k = 0; k < 2; k++) {
        const px = Math.round(W * (0.16 + k * 0.46 + rnd() * 0.12));
        if (px < 0 || px >= W) continue;
        const ph = Math.max(5, Math.round(sceneH * 0.045));
        const pw = Math.round(ph * 2.0);
        const peak = buildRuin(pw, ph, 771 + k * 97);
        const py = mtnTop[Math.min(W - 1, Math.max(0, px))] - ph + 2;
        for (let y = 0; y < ph; y++) {
          const ty = py + y;
          if (ty < 0 || ty >= H) continue;
          for (let x = 0; x < pw; x++) {
            const v = peak[y * pw + x];
            if (!v) continue;
            const tx = px - (pw >> 1) + x;
            if (tx < 0 || tx >= W) continue;
            land[ty * W + tx] = v === 1 ? 1 : 0;
            mtnMask[ty * W + tx] = 0;              // stone, not rock: keep it solid
          }
        }
      }

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
      const ruinH = Math.max(10, Math.min(Math.round(sceneH * 0.165), hy - markBottom - 2));

      /* Everything standing on the far shore, laid out left to right so the
         eye is walked across it: the aqueduct running off the edge of the
         frame, the keep, and then a colonnade that has mostly come down.
         Three broken things at three scales say a place was lived in far
         better than one big one does. */
      function stand(mask, sw, sh, sx) {
        const sy = hy - sh + 1;
        for (let y = 0; y < sh; y++) {
          const ty = sy + y;
          if (ty < 0 || ty >= H) continue;
          for (let x = 0; x < sw; x++) {
            const v = mask[y * sw + x];
            if (!v) continue;
            const tx = sx + x;
            if (tx < 0 || tx >= W) continue;
            land[ty * W + tx] = v === 1 ? 1 : 0;
            mtnMask[ty * W + tx] = 0;
          }
        }
      }

      /* Sized off the width and set well apart. Sized off each other and
         packed against the left they ran together into one long wall, and
         three ruins that touch are one ruin. */
      const aqW = Math.round(W * 0.27);
      const aqH = Math.max(8, Math.min(Math.round(aqW / 3.5), ruinH));
      stand(buildAqueduct(aqW, aqH, 5501), aqW, aqH, Math.round(W * -0.03));

      const ruinW = Math.round(ruinH * 2.1);
      if (ruinH > 8) stand(buildRuin(ruinW, ruinH, 20260906),
        ruinW, ruinH, Math.round(W * 0.37 - ruinW / 2));

      const colW = Math.round(W * 0.11);
      const colH = Math.max(6, Math.round(colW * 0.62));
      stand(buildColumns(colW, colH, 8123), colW, colH, Math.round(W * 0.55));

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

      /* Distance, in the only currency one bit has. The far shore and the foot
         of the ruin are eaten into by an ordered dither that thickens as it
         comes down to the horizon, so the far side of the plain is grey where
         the near ridge is solid — without it the picture was two flat plates,
         one black and one white, and everything in the middle distance had the
         same weight as the thing standing six feet away.

         The horizon's own line is left alone, or the plain and the sky run
         into each other. */
      const haze = new Uint8Array(N);
      const hazeTop = Math.max(0, hy - Math.round(sceneH * 0.11));
      /* The horizon's own line is left out of it, or the plain and the sky run
         into each other and the picture loses the edge it is built on. */
      const hazeFoot = Math.max(hazeTop + 1, hy - Math.max(1, Math.round(sceneH * 0.015)));
      const mistRows = hazeFoot - hazeTop;
      const mistTex = new Uint8Array(WT * mistRows);
      for (let r = 0; r < mistRows; r++) {
        const t = r / mistRows;
        const depth = Math.pow(t, 1.5) * 0.44;
        for (let x = 0; x < WT; x++) {
          /* Patchy along its length, on two long waves that do not divide into
             each other. Held even, mist knocked a ruled band of hatching
             through the far shore that read as a mistake rather than as
             weather. */
          const patch = 0.35 + 0.9 * (Math.sin(x * 0.0175) * 0.5 + 0.5)
            * (0.55 + 0.45 * (Math.sin(x * 0.0061 + 2.2) * 0.5 + 0.5));
          mistTex[r * WT + x] = dither(x, r, depth * patch);
        }
      }
      const mistSpeed = W * 0.014;
      let mistOff = 0;

      /* The sun, low in the top left. It goes into the layer the water uses —
         the one consulted only where there is no cloud and no landscape — so
         the ranks pass in front of it, which is the whole reason it is worth
         having up there. Its box is cleared and redrawn each frame because the
         rays breathe. */
      const sunR = Math.max(4, Math.round(sceneH * 0.055));
      const sunX = Math.round(W * 0.115);
      const sunY = Math.max(sunR + 2, Math.round(markY * 0.34));
      const sunBox = Math.round(sunR * 1.85);

      /* And the same trick on the near ridge, the other way round. It is the
         largest single shape on the screen and it was a flat black plate:
         a stipple eaten out of the first few rows under its crest gives the
         ground a surface to be, and the eye something to read the edge
         against. It is baked in here rather than laid down each frame — the
         mist pass only ever writes its own band, so the two share the buffer
         without meeting. */
      /* The range, emptied out. Only the skyline stays solid; below it the
         stipple opens up, lighter on the flanks the sun is on and heavier on
         the ones it is not, and lighter again the further the range is from
         the water. Left solid, the mountains were a black wall across the
         whole picture and everything in front of them stopped reading. */
      const crust = Math.max(1, Math.round(sceneH * 0.006));
      const mtnHaze = new Uint8Array(N);
      for (let x = 0; x < W; x++) {
        const mt = mtnTop[x];
        for (let y = Math.max(0, mt + crust); y < hy && y < H; y++) {
          const i = y * W + x;
          if (!mtnMask[i]) continue;
          const depth = (y - mt) / Math.max(1, hy - mt);
          const keep = 0.06 + 0.20 * mtnLit[x] + 0.15 * depth;
          if (!dither(x, y, keep)) { haze[i] = 1; mtnHaze[i] = 1; }
        }
      }

      const grit = Math.max(2, Math.round(sceneH * 0.07));
      for (let x = 0; x < W; x++) {
        for (let k = 0; k < grit; k++) {
          const y = nearTop[x] + k;
          if (y < 0 || y >= H) continue;
          const d = 0.22 * Math.pow(1 - k / grit, 1.6);
          if (dither(x, y, d)) haze[y * W + x] = 1;
        }
      }

      /* Where the ground is cut open. The line wanders, and it is always held
         a good depth below the turf so there is soil between the grass and the
         section — the cut is deepest under the crown of the mound, which is
         where there is most ground to be inside of. */
      const cutTop = new Int32Array(W);
      const cutBase = H - Math.round(H * 0.16);
      const soil = Math.max(3, Math.round(sceneH * 0.055));
      for (let x = 0; x < W; x++) {
        const wob = Math.sin(x * 0.021) * 0.5 + Math.sin(x * 0.0073 + 1.3) * 0.5;
        cutTop[x] = Math.max(nearTop[x] + soil, Math.round(cutBase + wob * H * 0.028));
      }
      carveUnder(haze, land, W, H, cutTop, sceneH, 33107);

      /* Two things still alive down there. Everything else in the section is
         bones and stone, and a section with nothing moving in it is a diagram. */
      const worms = [];
      for (let k = 0; k < 2; k++) {
        const wx = W * (0.30 + k * 0.34);
        const wc = cutTop[Math.max(0, Math.min(W - 1, Math.round(wx)))];
        worms.push({
          x: wx, y: wc + (H - wc) * (0.5 + k * 0.22),
          len: Math.max(4, Math.round(sceneH * 0.045)),
          rate: 1.3 + k * 0.6, phase: k * 2.1, crawl: (k ? -1 : 1) * W * 0.006,
        });
      }

      /* ── The foreground ──────────────────────────────────────────────── */

      /* Grass along the whole crest, and a flower on some of it. It is the one
         thing between us and the plain, so it is what the near ridge stops
         being a cut-out silhouette and starts being ground. Each blade leans
         on its own count and they all take the same gusts, which are the same
         gusts pushing the sky. */
      /* The fire, downhill of him. Far enough off that the smoke clears the
         ridge before it is worth looking at, close enough to be his. */
      const fireX = Math.max(4, peakX - Math.round(W * 0.17));
      const fireBase = nearTop[Math.min(W - 1, fireX)];
      const fireW = Math.max(4, Math.round(sceneH * 0.060));
      const fireH = Math.max(5, Math.round(sceneH * 0.080));

      const blades = [];
      const bladeGap = Math.max(3, Math.round(W / 74));
      for (let x = 1; x < W - 1; x += bladeGap) {
        /* Clumps and bare stretches rather than an even fringe: grass sown at
           one blade per cell all the way along is a hedge, and a hedge hides
           the ridge it is supposed to be growing out of. */
        if (Math.sin(x * 0.037) + Math.sin(x * 0.011 + 1.7) < -0.55) continue;
        const n = 1 + Math.floor(hash2(x, 1, 3313) * 2);
        for (let k = 0; k < n; k++) {
          const bx = x + Math.round(hash2(x, k + 2, 3313) * bladeGap);
          if (bx < 1 || bx >= W - 1) continue;
          /* And nothing growing in the fire. */
          if (Math.abs(bx - fireX) < fireW * 1.6) continue;
          blades.push({
            x: bx,
            h: Math.max(2, Math.round(sceneH * (0.020 + hash2(bx, k, 617) * 0.045))),
            phase: hash2(bx, k, 881) * Math.PI * 2,
            rate: 1.1 + hash2(bx, k, 977) * 1.5,
            lean: (hash2(bx, k, 1213) - 0.5) * 0.5,
            flower: hash2(bx, k, 1499) < 0.14,
          });
        }
      }

      /* And its smoke: puffs let go from the top of the flame, climbing,
         spreading, taking the same wind as the clouds and thinning out of the
         dither as they go, so they are gone by the time they reach the name. */
      const SMOKE = 16;
      const smokeLife = 3.4;
      const puffs = [];
      for (let i = 0; i < SMOKE; i++) {
        puffs.push({ x: fireX, y: fireBase, r: 1, age: (i / SMOKE) * smokeLife });
      }
      /* The tree. Rooted off the bottom right corner so the trunk runs out of
         frame and the crown leans back over the water — it is the only thing
         on this screen nearer to us than the ridge, and it is what gives the
         rest of it somewhere to be seen from. */
      const tree = buildTree(60607);
      const treeX = W * 0.905;
      const treeY = H + sceneH * 0.01;
      /* Held against the width as well as the scene. Sized off the scene
         alone it stayed the same height on a phone, where the scene is tall
         and the frame is narrow, and the crown then reached more than halfway
         across the screen and sat on the name. */
      const treeLen = Math.min(sceneH * 0.42, W * 0.36);
      const treeGirth = Math.max(1.8, treeLen * 0.081);
      const tx0 = new Float32Array(tree.length), ty0 = new Float32Array(tree.length);
      const tx1 = new Float32Array(tree.length), ty1 = new Float32Array(tree.length);
      const twa = new Float32Array(tree.length);

      function layoutTree(now, wind) {
        for (let i = 0; i < tree.length; i++) {
          const sg = tree[i];
          const give = (sg.depth + 1) / 5;
          const bend = (wind * 0.16 + Math.sin(now * sg.rate + sg.phase) * 0.09) * give;
          const wa = (sg.parent < 0 ? 0 : twa[sg.parent]) + sg.angle + bend;
          twa[i] = wa;
          const bx = sg.parent < 0 ? treeX : tx1[sg.parent];
          const by = sg.parent < 0 ? treeY : ty1[sg.parent];
          const L = sg.len * treeLen;
          tx0[i] = bx; ty0[i] = by;
          tx1[i] = bx + Math.sin(wa) * L;
          ty1[i] = by - Math.cos(wa) * L;
        }
      }

      /* A branch to sit on, chosen off a still layout: the most level one high
         in the crown and well inside the tree, so he is standing on something
         rather than clinging to the last twig out over the water — which is
         where picking purely by angle put him. */
      layoutTree(0, 0);
      let perch = -1, perchScore = Infinity;
      for (let i = 1; i < tree.length; i++) {
        /* A first fork, not a twig. The crown is dense the whole way across —
           there is no branch end up there with sky behind it — but the limbs
           below it are bare, because the fronds all hang off their children
           further out. So he sits under the canopy, which is where you
           actually see a bird in a tree. */
        if (tree[i].depth !== 1) continue;
        if (tx1[i] < perchScore) { perchScore = tx1[i]; perch = i; }
      }
      if (perch < 0) perch = Math.min(1, tree.length - 1);
      /* And nothing grows on the branch he is standing on. */
      tree[perch].frond = false;
      const birdH = Math.max(9, Math.round(treeLen * 0.27));
      const birdS = birdH / 100;
      let birdLook = 0, birdNext = 1.4, birdDip = 0;

      /* Leaves off it, crossing the whole screen on the same wind as the
         clouds. Each keeps a flutter of its own so they do not fall in
         formation. */
      const LEAVES = 18;
      const leaves = [];
      for (let i = 0; i < LEAVES; i++) {
        leaves.push({
          x: treeX - Math.random() * W * 0.3,
          y: treeY - treeLen * (0.4 + Math.random() * 0.9),
          fall: sceneH * (0.045 + Math.random() * 0.05),
          drift: W * (0.055 + Math.random() * 0.075),
          spin: 0.6 + Math.random() * 1.6,
          phase: Math.random() * Math.PI * 2,
          len: Math.max(2, treeLen * (0.035 + Math.random() * 0.030)),
        });
      }

      const smokeRise = sceneH * 0.085;
      const smokeDrift = W * 0.020;
      const smokeGrow = sceneH * 0.020;
      const over = new Uint8Array(N);

      /* The cloak, rasterised once per hem into its own overlay. */
      const cloaks = [];
      for (let i = 0; i < CLOAK.length; i++) {
        const c = new Uint8Array(N);
        fillShapeAt(c, W, H, CLOAK[i], figX, figY, figS, figS, 1);
        cloaks.push(c);
      }

      /* The water, running away from us to the ruin. Two layers pulled past at
         their own rates and at their own rate again per row — the near rows
         travel several times faster than the far ones, which is the same
         parallax the sky is using and is what stops the whole surface sliding
         as one sheet. */
      const waterRows = Math.max(1, gy - hy - 1);
      const waterA = buildWater(WT, waterRows, 41231);
      const waterB = buildWater(WT, waterRows, 90127);
      const offA = new Float32Array(waterRows);
      const offB = new Float32Array(waterRows);
      const rowRate = new Float32Array(waterRows);
      for (let r = 0; r < waterRows; r++) {
        const t = r / waterRows;
        rowRate[r] = 0.16 + t * t * 1.5;
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

          /* The water. Both layers pulled left, each row at its own rate, and
             a slow swell laid over the top so the strokes are not marching in
             step. Wrapped per row rather than per cell: the offsets are kept
             inside the texture so the lookup is an add and a compare. */
          for (let r = 0; r < waterRows; r++) {
            offA[r] += rowRate[r] * dt * W * 0.07;
            offB[r] += rowRate[r] * dt * W * 0.041;
            if (offA[r] >= WT) offA[r] -= WT;
            if (offB[r] >= WT) offB[r] -= WT;
            const y = hy + 1 + r;
            if (y < 0 || y >= H) continue;
            const swell = Math.sin(t * 1.15 + r * 0.28) * (2 + r * 0.03);
            let a = Math.round(offA[r] + swell);
            let b = Math.round(offB[r] - swell * 0.6);
            a = ((a % WT) + WT) % WT;
            b = ((b % WT) + WT) % WT;
            const src = r * WT, dst = y * W;
            for (let x = 0; x < W; x++) {
              let ia = x + a; if (ia >= WT) ia -= WT;
              let ib = x + b; if (ib >= WT) ib -= WT;
              still[dst + x] = (waterA[src + ia] || waterB[src + ib]) ? 1 : 0;
            }
          }

          for (let y = Math.max(0, sunY - sunBox); y <= Math.min(H - 1, sunY + sunBox); y++) {
            const row = y * W;
            for (let x = Math.max(0, sunX - sunBox); x <= Math.min(W - 1, sunX + sunBox); x++) {
              still[row + x] = 0;
            }
          }
          drawSun(still, W, H, sunX, sunY, sunR, t);

          /* The mist over the far shore, drifting the same way as everything
             else and slower than any of it. */
          mistOff += mistSpeed * dt;
          if (mistOff >= WT) mistOff -= WT;
          for (let r = 0; r < mistRows; r++) {
            const y = hazeTop + r;
            if (y < 0 || y >= H) continue;
            let off = Math.round(mistOff + Math.sin(t * 0.37 + r * 0.21) * 2);
            off = ((off % WT) + WT) % WT;
            const src = r * WT, dst = y * W;
            for (let x = 0; x < W; x++) {
              let ix = x + off; if (ix >= WT) ix -= WT;
              haze[dst + x] = (mistTex[src + ix] || mtnHaze[dst + x]) ? 1 : 0;
            }
          }

          /* Everything in front of the landscape, laid down together: 1 is ink
             and 2 is paper, which is the only way the fire gets a heart. */
          over.fill(0);

          /* The wind, as one number, so the grass and the fire lean the same
             way at the same moment and it reads as weather rather than as two
             animations running next to each other. */
          const gust = Math.sin(t * 0.63) * 0.6 + Math.sin(t * 1.71 + 1.2) * 0.4;

          for (let g = 0; g < blades.length; g++) {
            const bl = blades[g];
            const baseY = nearTop[bl.x];
            const sway = (Math.sin(t * bl.rate + bl.phase) * 0.5 + gust) + bl.lean;
            for (let k = 0; k <= bl.h; k++) {
              const f = k / bl.h;
              /* Rooted, so the bend is all at the top — a blade that pivots
                 from the ground is a windscreen wiper. */
              const bx = Math.round(bl.x + sway * bl.h * 0.34 * f * f);
              const by = baseY - k;
              if (by < 0 || by >= H) continue;
              const rowb = by * W;
              if (bx >= 0 && bx < W) over[rowb + bx] = 1;
              /* Two cells at the root and one at the tip: a blade drawn a cell
                 wide the whole way up is a wire. */
              if (f < 0.4 && bx + 1 < W) over[rowb + bx + 1] = 1;
            }
            if (bl.flower) {
              const bx = Math.round(bl.x + sway * bl.h * 0.34);
              const by = baseY - bl.h - 1;
              for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                  if (dx && dy) continue;                 // a cross, not a block
                  const tx = bx + dx, ty = by + dy;
                  if (tx >= 0 && tx < W && ty >= 0 && ty < H) over[ty * W + tx] = 1;
                }
              }
            }
          }

          /* The tree, laid out from the root outward. A segment takes its
             parent's world angle and adds its own bend, so the gust that
             moves a limb moves everything growing off it — the whole point of
             keeping the skeleton rather than a picture of it. */
          layoutTree(t, gust);

          /* Every leaf is cut out of the paper before any of it is inked, so
             each frond keeps a cell of daylight round it. Without that the
             crown is one black mass — and worse, it joins whatever cloud
             happens to be behind it, since both are the same ink. Outlines
             first, then the limbs over them so the fronds stay attached, then
             the leaves themselves. */
          const frondAng = (i, k, n, sg) => twa[i] + (k - (n - 1) / 2) * (1.55 / n)
            + Math.sin(t * (0.8 + (k % 3) * 0.3) + sg.phase + k) * 0.10 - Math.PI / 2;
          const frondLen = i => treeLen * 0.17 * (0.7 + (i % 5) * 0.10);
          const FRONDS = 7;
          for (let i = 0; i < tree.length; i++) {
            const sg = tree[i];
            if (!sg.frond) continue;
            const lf = frondLen(i);
            for (let k = 0; k < FRONDS; k++) {
              leaf(over, W, H, tx1[i], ty1[i], frondAng(i, k, FRONDS, sg),
                lf + 2, lf * 0.21 + 1, 2);
            }
          }

          for (let i = 0; i < tree.length; i++) {
            const sg = tree[i];
            const g0 = sg.girth * treeGirth;
            limb(over, W, H, tx0[i], ty0[i], tx1[i], ty1[i], g0, g0 * 0.62, 1);
          }
          /* The lit side of the trunk. The sun is in the top left and the tree
             is the largest solid thing on the screen; without a side taken off
             it, it is a hole in the picture. */
          for (let i = 0; i < tree.length; i++) {
            if (tree[i].depth > 1) continue;
            const g = tree[i].girth * treeGirth;
            const steps = Math.max(2, Math.round(Math.hypot(tx1[i] - tx0[i], ty1[i] - ty0[i])));
            for (let k = 0; k <= steps; k++) {
              const f = k / steps;
              const x = Math.round(tx0[i] + (tx1[i] - tx0[i]) * f - g * (0.62 - f * 0.2));
              const y = Math.round(ty0[i] + (ty1[i] - ty0[i]) * f);
              for (let d = 0; d < Math.max(1, g * 0.5); d++) {
                const px2 = x + d;
                if (px2 >= 0 && px2 < W && y >= 0 && y < H &&
                    dither(px2, y, 0.5 - d * 0.16)) over[y * W + px2] = 2;
              }
            }
          }
          for (let i = 0; i < tree.length; i++) {
            const sg = tree[i];
            if (!sg.frond) continue;
            const lf = frondLen(i);
            for (let k = 0; k < FRONDS; k++) {
              leaf(over, W, H, tx1[i], ty1[i], frondAng(i, k, FRONDS, sg), lf, lf * 0.21, 1);
            }
          }

          /* Him, on the branch. The perch moves with the wind and he moves with
             it, which is most of what sells it; the rest is that every second
             or two he looks somewhere else. */
          birdNext -= dt;
          if (birdNext <= 0) {
            birdNext = 1.1 + Math.random() * 2.6;
            birdLook = Math.round((Math.random() - 0.5) * 5);
            birdDip = Math.random() < 0.3 ? 2 : 0;
          }
          {
            /* Out at the end of the branch, where the sky is. */
            const px2 = tx0[perch] + (tx1[perch] - tx0[perch]) * 0.86;
            const py2 = ty0[perch] + (ty1[perch] - ty0[perch]) * 0.86;
            const bx = px2 - BIRD_W * birdS * 0.42;
            const by = py2 - birdH + 1;
            const hx = bx + birdLook * birdS, hy2 = by + birdDip * birdS;
            /* Cut out of the paper first, on the same principle as the leaves:
               he is standing in a tree, and ink on ink is not a bird. */
            const halo = birdS * 1.30;
            const ox = bx - BIRD_W * (halo - birdS) * 0.5;
            const oy = by - 100 * (halo - birdS) * 0.92;
            for (let k = 0; k < BIRD_BODY.length; k++) {
              fillShapeAt(over, W, H, BIRD_BODY[k], ox, oy, halo, halo, 2);
            }
            for (let k = 0; k < BIRD_HEAD.length; k++) {
              fillShapeAt(over, W, H, BIRD_HEAD[k],
                ox + birdLook * birdS, oy + birdDip * birdS, halo, halo, 2);
            }
            for (let k = 0; k < BIRD_BODY.length; k++) {
              fillShapeAt(over, W, H, BIRD_BODY[k], bx, by, birdS, birdS, 1);
            }
            for (let k = 0; k < BIRD_HEAD.length; k++) {
              fillShapeAt(over, W, H, BIRD_HEAD[k], hx, hy2, birdS, birdS, 1);
            }
            fillShapeAt(over, W, H, BIRD_EYE[0], hx, hy2, birdS, birdS, 2);
          }

          /* And what comes off it. They cross the frame on the same wind as the
             sky, spinning as they go — the flutter is a leaf turning edge-on,
             so it is drawn narrow at the turn rather than simply moving. */
          for (let i = 0; i < leaves.length; i++) {
            const lv = leaves[i];
            lv.y += lv.fall * dt;
            lv.x -= (lv.drift + gust * lv.drift * 0.5) * dt;
            lv.phase += lv.spin * dt;
            if (lv.y > H + 4 || lv.x < -6) {
              lv.x = treeX - Math.random() * W * 0.28;
              lv.y = treeY - treeLen * (0.45 + Math.random() * 0.85);
            }
            const turn = Math.sin(lv.phase);
            const wid = Math.max(0.5, lv.len * 0.28 * Math.abs(turn));
            leaf(over, W, H, lv.x, lv.y, lv.phase * 0.5, lv.len + 2, wid + 1, 2);
            leaf(over, W, H, lv.x, lv.y, lv.phase * 0.5, lv.len, wid, 1);
          }

          for (let k = 0; k < worms.length; k++) {
            const wm = worms[k];
            wm.x += wm.crawl * dt;
            if (wm.x < W * 0.12) wm.crawl = Math.abs(wm.crawl);
            if (wm.x > W * 0.88) wm.crawl = -Math.abs(wm.crawl);
            for (let n = 0; n <= wm.len; n++) {
              const f = n / wm.len;
              const x = Math.round(wm.x + n - wm.len * 0.5);
              const y = Math.round(wm.y + Math.sin(t * wm.rate + wm.phase + f * 5.2) * wm.len * 0.16);
              if (x < 0 || x >= W || y < 0 || y >= H) continue;
              if (y < cutTop[x] || !land[y * W + x]) continue;
              over[y * W + x] = 1;
              if (y + 1 < H && land[(y + 1) * W + x]) over[(y + 1) * W + x] = 1;
            }
          }

          drawFlame(over, W, H, fireX, fireBase, fireW, fireH, t);

          for (let p = 0; p < puffs.length; p++) {
            const pf = puffs[p];
            pf.age += dt;
            if (pf.age >= smokeLife) {
              pf.age = 0;
              pf.x = fireX + (Math.random() - 0.5) * fireW;
              pf.y = fireBase - fireH * 0.8;
              pf.r = Math.max(1, fireW * 0.32);
            } else {
              pf.y -= smokeRise * dt;
              pf.x -= (smokeDrift + gust * smokeDrift * 0.5) * dt;
              pf.r += smokeGrow * dt;
            }
            /* Thinning as it climbs. The dither is what carries that: a puff
               is solid where it leaves the fire and half gone by the time it
               is over the water. */
            const fade = 1 - pf.age / smokeLife;
            const density = Math.pow(fade, 1.5) * 0.62;
            if (density <= 0.02) continue;
            const r = pf.r, cxp = pf.x, cyp = pf.y;
            const y0 = Math.max(0, Math.floor(cyp - r)), y1 = Math.min(H - 1, Math.ceil(cyp + r));
            for (let y = y0; y <= y1; y++) {
              const dy = (y - cyp) / r;
              const span = 1 - dy * dy;
              if (span <= 0) continue;
              const half = r * Math.sqrt(span);
              const x0 = Math.max(0, Math.round(cxp - half)), x1 = Math.min(W - 1, Math.round(cxp + half));
              const rowp = y * W;
              for (let x = x0; x <= x1; x++) {
                const d = Math.sqrt((x - cxp) * (x - cxp) + (y - cyp) * (y - cyp)) / r;
                if (dither(x, y, density * (1 - d * d))) over[rowp + x] = 1;
              }
            }
          }

          /* One pass. */
          const lit = flash > 0.001;
          for (let y = 0; y < H; y++) {
            const row = y * W;
            for (let x = 0; x < W; x++) {
              const i = row + x;
              let bit;
              if (land[i] || cloak[i]) {
                bit = lit ? (rim[i] ? 0 : 1) : (haze[i] ? 0 : 1);
              } else {
                if (sky[i]) bit = (lit || landHalo[i]) ? 0 : 1;
                else bit = lit ? dither(x, y, flash) : still[i];
              }
              const o = over[i];
              if (o === 1) bit = lit ? 0 : 1;
              else if (o === 2) bit = 0;
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
