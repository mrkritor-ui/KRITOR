/* KRITOR — pixel effects.

   Two animations for the two loading screens, both drawn as real pixels onto a
   canvas a few hundred cells wide and then blown up with nearest-neighbour, so
   a "pixel" on the boot screen is a square block of the same family as the
   1-bit renditions the catalogue is built out of. The screen used to be
   characters — a Doom fire and a field of full stops set in a <pre> — and
   characters are a different bitmap from the one the rest of the site speaks
   in: the works are pixels, the icons are pixels, and the door was text
   pretending.

     gate   a man on a ridge, which is what the screen is about and what
            everything else is arranged around: behind him an aqueduct, a keep
            and a fallen colonnade massed to the left of the frame, two ranges
            behind those with a ruin on each summit, a sun, three ranks of
            cloud crossing at their own speeds, and a tree over the right.
            A fire beside him. Lightning every few seconds. The wordmark is
            cut into the same grid as the rest, so the lightning reaches it.
     warp   the flight between the catalogue and the store, forwards on the way
            out and backwards on the way home.

   The composition is three planes and they are kept apart by tone, not by
   drawing: everything on the near ridge is solid ink, the cut stone across the
   water is solid too but small, and the ranges behind are emptied out with a
   stipple until they are barely there. The water to the right of the shore is
   left empty on purpose — it is what he is standing against, and a colonnade
   behind him sent his silhouette straight back into the middle distance.

   On the gate nothing holds still. The clouds cross, the water runs — two
   stroke layers pulled past each other, each row at its own rate — the mist
   drifts along the shore, the grass and the branches lean into the same gusts,
   leaves come off the tree and cross the whole screen, the fire never repeats
   and its smoke climbs and thins out of the dither.

   Nothing in the gate is a fixed-size sprite. The letters, the ruins and the
   figure are shapes — polygons and rectangles in their own coordinates — rasterised into whatever grid the screen turns out to give;
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
   between is a cut-out. So distance is dithered — the ranges are emptied out
   with only their skylines left solid and are shaded on the flanks the sun is
   not on, mist drifts along the shore, a stipple eats into the near ridge
   under its crest, smoke thins as it climbs, and the name itself opens from
   solid at the caps into a light stipple at the drips. The mist is an
   atmosphere and knows what it belongs on: not the cut stone, which has to
   stay solid or it takes the same grey as the mountain behind it, and not the
   near ridge, which is six feet away.

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
   is a filler here that cannot allocate. About five milliseconds at the
   largest grid this hands out, against a frame budget of forty at the rate it
   runs. */
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
      w: 70,
      shapes: [
        [[[3, -2], [31, 1], [30, 99], [4, 101]]],                       // stem
        [[[28, 60], [46, 61], [70, -2], [54, -2]]],                     // arm
        [[[28, 40], [46, 39], [70, 101], [51, 101]]],                   // leg
        [[[7, 100], [16, 100], [12, 123]]],                             // drips
        [[[55, 100], [63, 100], [59, 112]]],
      ],
    },
    R: {
      w: 62,
      shapes: [
        [[[3, -1], [31, 1], [30, 100], [4, 99]]],
        [
          [[24, -2], [48, 0], [62, 13], [61, 35], [47, 48], [24, 47]],  // bowl
          [[34, 12], [43, 12], [50, 19], [49, 29], [42, 35], [34, 34]], // counter
        ],
        [[[30, 40], [47, 41], [62, 101], [45, 100]]],                   // leg
        [[[7, 99], [16, 100], [11, 118]]],
        [[[47, 100], [55, 100], [51, 109]]],
      ],
    },
    I: {
      w: 38,
      shapes: [
        [[[10, 0], [27, 1], [26, 100], [11, 99]]],
        [[[0, -2], [38, 0], [37, 14], [1, 13]]],
        [[[1, 87], [37, 86], [38, 100], [0, 101]]],
        [[[14, 100], [23, 100], [18, 116]]],
      ],
    },
    T: {
      w: 68,
      shapes: [
        [[[-1, -2], [68, 0], [67, 17], [0, 15]]],
        [[[24, 15], [45, 16], [44, 100], [25, 99]]],
        [[[15, 86], [53, 87], [52, 101], [14, 100]]],
        [[[28, 100], [38, 100], [33, 124]]],
      ],
    },
    O: {
      w: 68,
      shapes: [
        [
          [[1, 22], [17, 0], [51, 1], [67, 23], [66, 78], [50, 99], [17, 98], [2, 77]],
          [[20, 30], [29, 18], [40, 18], [48, 30], [47, 70], [39, 82], [28, 81], [20, 69]],
        ],
        [[[23, 94], [32, 95], [27, 120]]],
        [[[49, 88], [57, 89], [53, 106]]],
      ],
    },
  };

  const WORD = "KRITOR";
  const WORD_GAP = 6;                       // in glyph units
  const WORD_UNITS = (function () {
    let w = 0;
    for (let i = 0; i < WORD.length; i++) w += GLYPHS[WORD[i]].w + (i ? WORD_GAP : 0);
    return w;
  })();
  const WORD_DEPTH = 126;                   // baseline is 100; the drips reach here

  function wordWidth(capHeight) { return Math.round(WORD_UNITS * capHeight / 100); }
  function wordDepth(capHeight) { return Math.round(WORD_DEPTH * capHeight / 100); }

  /* Rough it up. The outlines are geometry and geometry is not what is in the
     notebook — that is a marker, held at an angle, going too fast. So every
     edge is walked in short steps and each step is pushed off the line by a
     hair, which gives the stroke a wobble that reads as a hand rather than as
     a font. Small steps and a small push: any more and the counters close up
     and the letters turn to mud. */
  function roughen(pts, amp, seed) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const n = Math.max(1, Math.round(Math.hypot(dx, dy) / 9));
      for (let k = 0; k < n; k++) {
        const u = k / n;
        out.push([
          a[0] + dx * u + (hash2(i * 37 + k, seed, 9001) - 0.5) * amp,
          a[1] + dy * u + (hash2(i * 37 + k, seed, 4409) - 0.5) * amp,
        ]);
      }
    }
    return out;
  }

  function drawWord(buf, W, H, x, y, capHeight, value) {
    const s = capHeight / 100;
    let pen = x;
    for (let i = 0; i < WORD.length; i++) {
      const g = GLYPHS[WORD[i]];
      /* And set by hand. Six letters at one size on one baseline is type; a
         little tilt, a little rise and fall, a little bigger and smaller is
         somebody writing it. */
      const tilt = (hash2(i, 1, 313) - 0.5) * 0.15;
      const lift = (hash2(i, 2, 313) - 0.5) * 9;
      const size = 0.95 + hash2(i, 3, 313) * 0.11;
      const ct = Math.cos(tilt), st = Math.sin(tilt);
      const gx = g.w * 0.5, gy = 52;
      for (let k = 0; k < g.shapes.length; k++) {
        const shape = g.shapes[k];
        const rings = [];
        for (let r = 0; r < shape.length; r++) {
          /* Counters get half the wobble. At full amplitude the inside of an O
             wanders into its own wall and the letter fills in. */
          const rough = roughen(shape[r], r ? 1.7 : 3.0, i * 977 + k * 61 + r);
          const ring = new Array(rough.length);
          for (let p = 0; p < rough.length; p++) {
            const ux = (rough[p][0] - gx) * size, uy = (rough[p][1] - gy) * size;
            ring[p] = [
              pen + (gx + ux * ct - uy * st) * s,
              y + (gy + ux * st + uy * ct + lift) * s,
            ];
          }
          rings.push(ring);
        }
        fillShape(buf, W, H, rings, value);
      }
      pen += (g.w + WORD_GAP) * s;
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

  /* An aqueduct, and the arches are the whole of it. The first attempt stepped
     the tops of its openings in twice and called it an arch, which at this size
     is a doorway with the corners knocked off — you have to actually carve the
     half-circle, springing from the top of the pier, or the eye reads a wall
     with holes in it.

     Two tiers, because that is the silhouette everybody knows: a few tall
     arches carrying a long row of short ones, and the channel along the top.
     Built solid and then cut, which is also how it was built. */
  function archway(m, w, h, x0, x1, top, bottom) {
    const r = (x1 - x0) / 2;
    const cx = (x0 + x1) / 2;
    const spring = top + r;
    const a = Math.max(0, Math.round(x0)), b = Math.min(w - 1, Math.round(x1) - 1);
    for (let y = Math.max(0, Math.round(top)); y < Math.min(h, bottom); y++) {
      const row = y * w;
      for (let x = a; x <= b; x++) {
        if (y >= spring) { m[row + x] = 2; continue; }
        const dx = x + 0.5 - cx, dy = y + 0.5 - spring;
        if (dx * dx + dy * dy <= r * r) m[row + x] = 2;
      }
    }
  }

  function buildAqueduct(w, h, seed) {
    const rnd = rng(seed);
    const m = new Uint8Array(w * h);
    rect(m, w, h, 0, 0, w, h, 1);

    const deck = Math.max(1, Math.round(h * 0.055));      // the channel and the cornices
    const tier = Math.round(h * 0.40);                    // where the upper tier ends
    const foot = Math.max(1, Math.round(h * 0.03));

    /* Lower tier: a few tall arches on heavy piers. */
    const lowN = Math.max(2, Math.round(w / (h * 0.62)));
    const lowBay = w / lowN;
    const lowPier = Math.max(2, lowBay * 0.26);
    for (let i = 0; i < lowN; i++) {
      const x0 = i * lowBay + lowPier * 0.5;
      const x1 = (i + 1) * lowBay - lowPier * 0.5;
      if (x1 - x0 < 3) continue;
      archway(m, w, h, x0, x1, tier + deck, h - foot);
    }

    /* Upper tier: twice as many, half as tall, and the channel over them. */
    const upN = lowN * 2;
    const upBay = w / upN;
    const upPier = Math.max(1, upBay * 0.30);
    for (let i = 0; i < upN; i++) {
      const x0 = i * upBay + upPier * 0.5;
      const x1 = (i + 1) * upBay - upPier * 0.5;
      if (x1 - x0 < 3) continue;
      archway(m, w, h, x0, x1, deck * 2, tier - deck);
    }

    /* And it stops. The last bay or two have come down to the piers, which is
       what makes it a ruin rather than a viaduct. */
    const gone = Math.round(w * (0.14 + rnd() * 0.12));
    for (let x = w - gone; x < w; x++) {
      const fall = (x - (w - gone)) / gone;
      const eat = Math.round(h * (0.30 + fall * 0.75));
      for (let y = 0; y < Math.min(h, eat); y++) m[y * w + x] = 0;
    }
    for (let k = 0; k < 3; k++) {
      const bx = Math.round(w * rnd() * 0.85);
      const bw = Math.max(1, Math.round(w * 0.02));
      for (let x = bx; x < bx + bw && x < w; x++) {
        for (let y = 0; y < Math.round(deck * (1 + rnd() * 2)); y++) m[y * w + x] = 0;
      }
    }
    return m;
  }

  /* And what is left of a colonnade: a few drums still stacked, one column
     standing, and the rest of it lying where it fell. */
  function buildColumns(w, h, seed) {
    const rnd = rng(seed);
    const m = new Uint8Array(w * h);
    const drum = Math.max(2, Math.round(h * 0.13));
    const gap = Math.max(1, Math.round(h * 0.022));
    const wide = Math.max(2, Math.round(h * 0.11));
    let x = Math.round(w * 0.04);
    while (x < w - wide) {
      const tall = Math.round(h * (0.22 + rnd() * 0.76));
      const topY = h - tall;
      /* Stacked drums with a course of air between them, so a shaft reads as
         something assembled out of pieces rather than as a fence post. */
      for (let y = h - drum; y > topY; y -= drum + gap) {
        rect(m, w, h, x, Math.max(topY, y - drum), x + wide, y, 1);
      }
      /* A capital on the ones still standing high enough to have kept one. */
      if (tall > h * 0.55 && rnd() < 0.8) {
        const cap = Math.max(1, Math.round(h * 0.05));
        rect(m, w, h, x - cap, topY - cap * 2, x + wide + cap, topY - cap, 1);
      }
      x += wide + Math.max(2, Math.round(h * (0.09 + rnd() * 0.22)));
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

  /* A circle. It had a stippled middle and a ring of rays that breathed, and it
     was the busiest thing in an otherwise empty sky — one clean outline says
     sun and then stops asking to be looked at. */
  function drawSun(buf, W, H, cx, cy, r) {
    const inner = r - Math.max(1, Math.round(r * 0.16));
    for (let y = Math.max(0, cy - r); y <= Math.min(H - 1, cy + r); y++) {
      const dy = y - cy;
      const row = y * W;
      for (let x = Math.max(0, cx - r); x <= Math.min(W - 1, cx + r); x++) {
        const dx = x - cx;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d <= r && d >= inner) buf[row + x] = 1;
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
      scene.render(Math.min(dt, dtClampMs) / 1000, bits);
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

    return {
      /* Resolves when the scene itself says it has finished its sequence —
         see notifyReady above. A scene that never calls it leaves this
         forever pending, which is correct: nothing waits on it. */
      ready: readyPromise,
      /* Asked to leave. A scene may answer it — the gate dissolves — and one
         that does not simply carries on until it is stopped. */
      part: function (ms) { if (scene && scene.part) scene.part(ms); },
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
      /* On a tall frame the landscape keeps its own shape and the spare height
         becomes sky above and ground below. Two thirds rather than a little
         over half: at the smaller figure the scene was squeezed into the
         bottom of a phone, which made everything in it — him most of all —
         too small to read, and left a third of the screen as blank paper. */
      const sceneH = Math.min(H, Math.max(Math.round(W * 0.60), Math.round(H * 0.66)));
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
      const shadeTop = markY + Math.round(capH * 0.42);
      const shadeRun = Math.max(1, markY + wordDepth(capH) - shadeTop);
      for (let y = 0; y < H; y++) {
        const t = Math.min(1, Math.max(0, (y - shadeTop) / shadeRun));
        /* Slight. Taken down to a bit over half, the feet of the letters broke
           into a checkerboard and read as damage rather than as weight coming
           off them; three quarters is a shade, and the drips survive it. */
        const weight = 1 - Math.pow(t, 1.2) * 0.26;
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
      /* Two ridges, not one. A single profile at one tone is a cut-out however
         pale you make it; a far range with a lower one lapped in front of it, a
         shade heavier, is a distance. Both are emptied out with a stipple
         further down — only their skylines stay solid — and both stop before
         they reach the man, because a grey mountain directly behind him is
         exactly where his silhouette needed sky. */
      const mtnTop = new Int32Array(W);
      const mtnMask = new Uint8Array(N);
      const mtnKeep = new Float32Array(N);
      const mtnCrust = new Uint8Array(N);
      /* Cut stone, as opposed to rock and ground. The mist is an atmosphere and
         it belongs on the range and the shore; laid over the buildings too it
         ate the piers of the aqueduct into lace and left the keep looking shot
         at, and — worse — gave the stonework the same grey as the mountain
         behind it, so the two read as one plane. */
      const stone = new Uint8Array(N);
      const crust = Math.max(1, Math.round(sceneH * 0.008));

      function range(seed, hMax, count, tone, endAt) {
        const rr = rng(seed);
        const peaks = [];
        for (let i = 0; i < count; i++) {
          peaks.push({
            x: W * endAt * 1.3 * ((i + 0.5) / count + (rr() - 0.5) * 0.4),
            h: hMax * (0.62 + rr() * 0.38),
            w: W * (0.09 + rr() * 0.15),
          });
        }
        const prof = new Int32Array(W);
        for (let x = 0; x < W; x++) {
          let rise = 0;
          for (let i = 0; i < peaks.length; i++) {
            const p = peaks[i];
            const d = Math.abs(x - p.x) / p.w;
            if (d >= 1) continue;
            /* Nearly straight flanks with a rounded shoulder — a gaussian
               gives a hill and a triangle gives a tent. */
            const v = p.h * Math.pow(1 - d, 1.12);
            if (v > rise) rise = v;
          }
          rise += (hash2(x, seed & 255, 7717) - 0.4) * sceneH * 0.014;
          const fade = 1 - Math.max(0, Math.min(1, (x / W - endAt) / 0.14));
          prof[x] = hy - Math.max(0, Math.round(rise * fade));
        }
        for (let x = 0; x < W; x++) {
          /* No ceiling on them. Held below the name they came back as a mesa
             with a flat top, which is the one thing a mountain is not; the
             name is cut out of whatever is behind it anyway, so the range is
             free to stand up through it. */
          /* Which way the slope runs, so the flanks the sun is not on carry a
             little more of the stipple and the range has a form. */
          const a = prof[Math.max(0, x - 2)], b = prof[Math.min(W - 1, x + 2)];
          const lit = Math.max(0, Math.min(1, 0.5 + (b - a) * 0.09));
          const span = Math.max(1, hy - prof[x]);
          for (let y = Math.max(0, prof[x]); y <= hy && y < H; y++) {
            const i = y * W + x;
            land[i] = 1;
            mtnMask[i] = 1;
            mtnCrust[i] = y < prof[x] + crust ? 1 : 0;
            mtnKeep[i] = tone * (0.3 + 0.9 * lit + 0.5 * ((y - prof[x]) / span));
          }
          if (prof[x] < mtnTop[x]) mtnTop[x] = prof[x];
        }
        return prof;
      }

      for (let x = 0; x < W; x++) mtnTop[x] = hy;
      const farProf = range(9137, sceneH * 0.46, 4, 0.16, 0.44);
      const nearProf = range(4421, sceneH * 0.24, 5, 0.30, 0.52);

      /* And a ruin on the top of each range. Solid, against rock that is not:
         a broken silhouette on a skyline is what says somebody was up there,
         and it is also the cheapest possible read on how far away the skyline
         is. Placed on the summits themselves rather than at a guessed x, or
         they end up standing in mid-air on the flat. */
      [farProf, nearProf].forEach(function (prof, k) {
        let px = 0;
        for (let x = 4; x < W - 4; x++) if (prof[x] < prof[px]) px = x;
        if (prof[px] >= hy - 2) return;
        const ph = Math.max(5, Math.round(sceneH * (k ? 0.055 : 0.045)));
        const pw = Math.round(ph * 2.2);
        const peak = buildRuin(pw, ph, 771 + k * 97);
        const py = prof[px] - ph + 2;
        for (let y = 0; y < ph; y++) {
          const ty = py + y;
          if (ty < 0 || ty >= H) continue;
          for (let x = 0; x < pw; x++) {
            const v = peak[y * pw + x];
            if (!v) continue;
            const tx = px - (pw >> 1) + x;
            if (tx < 0 || tx >= W) continue;
            land[ty * W + tx] = v === 1 ? 1 : 0;
            mtnMask[ty * W + tx] = 0;
            stone[ty * W + tx] = v === 1 ? 1 : 0;
          }
        }
      });

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
      const ruinH = Math.max(10, Math.min(Math.round(sceneH * 0.145), hy - markBottom - 2));

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
            stone[ty * W + tx] = v === 1 ? 1 : 0;
          }
        }
      }

      /* Sized off the width and set well apart. Sized off each other and
         packed against the left they ran together into one long wall, and
         three ruins that touch are one ruin. */
      /* The tallest thing on the shore, because it is the one with the arches
         in it and the arches are what the shore is for. */
      /* All of it kept to the left of the frame. The right of the shore is the
         water he is standing against, and it has to stay empty — with a
         colonnade behind him his silhouette went straight back into the
         middle distance and he stopped being the thing you look at. */
      const aqW = Math.round(W * 0.28);
      const aqH = Math.max(14, Math.round(sceneH * 0.22));
      stand(buildAqueduct(aqW, aqH, 5501), aqW, aqH, Math.round(W * -0.05));

      const ruinW = Math.round(ruinH * 2.1);
      if (ruinH > 8) stand(buildRuin(ruinW, ruinH, 20260906),
        ruinW, ruinH, Math.round(W * 0.30 - ruinW / 2));

      const colW = Math.round(W * 0.11);
      const colH = Math.max(8, Math.round(colW * 0.85));
      stand(buildColumns(colW, colH, 8123), colW, colH, Math.round(W * 0.42));

      /* The near ridge: one long mound with the figure on its crest, and a
         smaller one behind it on the other side of the frame so the eye has
         somewhere to go after it has crossed. */
      /* He stands clear of the tree, not at a fixed fraction of the width. The
         crown's reach is set by the trunk length and the frame's width, so on
         a phone — narrow frame, tall scene — a peak at seven tenths put him
         directly under the canopy and he vanished into it. */
      const crownReach = Math.min(sceneH * 0.42, W * 0.32);
      const peakX = Math.round(Math.min(W * 0.70, W * 0.905 - crownReach));
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
      /* The near ridge, and everything standing on it, is the one plane the
         mist must not touch: it is six feet away. Left in the band, the haze
         stippled his cloak like a mountainside and he stopped reading as the
         nearest thing in the picture. */
      const fore = new Uint8Array(N);
      for (let x = 0; x < W; x++) {
        for (let y = Math.max(0, nearTop[x]); y < H; y++) { land[y * W + x] = 1; fore[y * W + x] = 1; }
      }

      /* Him. Feet on the crest, and tall enough to break the horizon — the
         whole composition is that he is on this side of it and the ruin is on
         the other. */
      const figH = Math.max(12, Math.round(sceneH * 0.20));
      const figS = figH / 100;
      const figX = peakX - Math.round(FIGURE_W * figS * 0.5);
      const figY = nearTop[Math.min(W - 1, Math.max(0, peakX))] - figH + Math.round(figH * 0.06);
      for (let i = 0; i < FIGURE.length; i++) {
        fillShapeAt(land, W, H, FIGURE[i], figX, figY, figS, figS, 1);
        fillShapeAt(fore, W, H, FIGURE[i], figX, figY, figS, figS, 1);
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
      const sunBox = sunR + 2;

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
      const mtnHaze = new Uint8Array(N);
      for (let y = 0; y < hy && y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          if (!mtnMask[i] || mtnCrust[i]) continue;
          if (!dither(x, y, mtnKeep[i])) { haze[i] = 1; mtnHaze[i] = 1; }
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

      /* ── The foreground ──────────────────────────────────────────────── */

      /* Grass along the whole crest, and a flower on some of it. It is the one
         thing between us and the plain, so it is what the near ridge stops
         being a cut-out silhouette and starts being ground. Each blade leans
         on its own count and they all take the same gusts, which are the same
         gusts pushing the sky. */
      /* The fire, downhill of him. Far enough off that the smoke clears the
         ridge before it is worth looking at, close enough to be his. */
      const fireX = Math.max(4, peakX - Math.round(W * 0.12));
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
          /* And nothing growing in the fire, or around him — he is what the
             screen is about and he had got lost in his own grass. */
          if (Math.abs(bx - fireX) < fireW * 1.6) continue;
          if (Math.abs(bx - peakX) < W * 0.045) continue;
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
      const treeLen = Math.min(sceneH * 0.42, W * 0.32);
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
        /* There used to be a rank of small ones down by the horizon, to fill the
           band between the name and the shore. The range fills it now, and they
           were sitting behind the aqueduct and coming through its arches as
           black lumps — an arch has to have sky in it. */
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
      /* Leaving. The picture is taken away with the same ordered dither that
         builds every tone in it — ink drops out cell by cell until only the
         name is left standing on paper — rather than by fading the canvas,
         which would take the name with it and would be a dissolve in the wrong
         medium besides. */
      let partMs = 0, partT = 0, dissolve = 0;

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
      const owner = host.parentElement || host;
      owner.style.setProperty("--boot-mark-top",
        Math.round(info.offsetTop + markY * info.scale) + "px");
      owner.style.setProperty("--boot-mark-bottom",
        Math.round(info.offsetTop + markBottom * info.scale) + "px");

      return {
        part: function (ms) { partMs = Math.max(1, ms); partT = 0; nextStrike = Infinity; },
        render: function (dt, bits) {
          t += dt;
          if (partMs) {
            partT += dt * 1000;
            dissolve = Math.min(1, partT / partMs);
          }

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
          drawSun(still, W, H, sunX, sunY, sunR);

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
              const at = dst + x;
              haze[at] = (!stone[at] && !fore[at] && (mistTex[src + ix] || mtnHaze[at])) ? 1 : 0;
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
              /* Taken away before the name is stamped back over it, so the
                 name is the one thing the dissolve cannot reach. */
              if (dissolve > 0 && bit && dither(x, y, dissolve)) bit = 0;
              if (halo[i]) bit = mark[i] ? (lit ? 0 : 1) : (lit ? 1 : 0);
              bits[i] = bit;
            }
          }
        },
      };
    });
  }

  /* ── Frame sheets: scenes that are footage, not generators ───────────────── */

  /* Two of the three boot scenes are not procedural at all any more: they
     are reference clips, downsampled frame by frame into one tall strip of
     stills and played back in their own real order at their own real pace.
     Both started as generators guessing at the same look — an irregular
     partition re-thrown every quarter-second for the catalogue, a bold "A"
     blurring and settling cell by cell for architecture — and both read as
     choppy for the same reason: a freshly-rolled guess has no memory of the
     guess before it, where real footage never loses that thread. Copying
     the actual frames sidesteps the problem outright, because the
     coherence was always in the footage rather than in an algorithm
     waiting to be found. This is the machinery both of them share. */

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

  /* ── The block glitch: the catalogue's door, now ─────────────────────────── */

  /* No storm, no name cut into it, nothing written over it at all — the door
     is a field of paper and ink that will not sit still, the way a signal
     with nothing on it does not sit still. Forty-three real frames of a
     datamoshed block field, ambient and looping: watched frame by frame its
     blocks rise and drift right in a single continuous wave, which is
     exactly the motion a fresh random partition every quarter-second could
     never reproduce. */
  const ART_TILE_W = 100, ART_TILE_H = 100;    // stored per frame, before the
                                                // cover crop above fits it to
                                                // whatever shape the canvas is
  const ART_FRAME_COUNT = 43;
  const ART_FRAME_MS = 40;             // native pace of the reference clip —
                                        // 43 frames loop in 1.72s
  const ART_SHEET_URL = "/art-loader-frames.png";
  const artSheet = { frames: null, requested: false };

  function blockGlitch(host) {
    loadFrameSheet(artSheet, ART_SHEET_URL, ART_TILE_W, ART_TILE_H, ART_FRAME_COUNT);
    return run(host, reduceMotion ? 12 : Infinity, function (W, H) {
      const cover = frameSheetCover(W, H, ART_TILE_W, ART_TILE_H);
      let t = 0;
      let partMs = 0, partT = 0, dissolve = 0;

      return {
        part: function (ms) { partMs = Math.max(1, ms); partT = 0; },
        render: function (dt, bits) {
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
     entirely for a beat before it catches hold again. One direction only:
     unlike the catalogue's clip this doesn't loop, because a resolve run
     backwards over and over stops reading as a resolve at all. Playback
     simply stops advancing once it reaches the reference's own last frame
     and holds there — not because every cell in it is perfectly settled
     (a couple aren't, in the footage itself) but because that is where the
     real clip actually ends, and this scene's whole premise is to show
     that clip rather than a tidier invention standing in for it. */
  const ARCH_TILE_W = 130, ARCH_TILE_H = 85;   // stored per frame, at the
                                                // reference's own 724:474
  const ARCH_FRAME_COUNT = 36;
  const ARCH_FRAME_MS = 50;            // native pace of the reference clip —
                                        // 36 frames run once in 1.8s
  const ARCH_SHEET_URL = "/architecture-loader-frames.png";
  const archSheet = { frames: null, requested: false };

  function letterGrid(host) {
    loadFrameSheet(archSheet, ARCH_SHEET_URL, ARCH_TILE_W, ARCH_TILE_H, ARCH_FRAME_COUNT);
    return run(host, reduceMotion ? 12 : Infinity, function (W, H) {
      const cover = frameSheetCover(W, H, ARCH_TILE_W, ARCH_TILE_H);
      let t = 0;
      let partMs = 0, partT = 0, dissolve = 0;

      return {
        part: function (ms) { partMs = Math.max(1, ms); partT = 0; },
        render: function (dt, bits) {
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
              const pos = t / ARCH_FRAME_MS;
              if (pos >= ARCH_FRAME_COUNT - 1) {
                i0 = i1 = ARCH_FRAME_COUNT - 1;
                mix = 0;
              } else {
                i0 = pos | 0;
                i1 = i0 + 1;
                mix = pos - i0;
              }
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
  const GLOBE_BLOOM_MS = 1600;
  const GLOBE_HOLD_BEFORE_TEXT_MS = 800;
  const GLOBE_TEXT_FADE_MS = 700;        // matched by the CSS transition on
                                          // .boot-mark/.boot-sub
  const GLOBE_HOLD_AFTER_TEXT_MS = 1100;
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
    terrain: terrain, blockGlitch: blockGlitch, letterGrid: letterGrid, globe: globe, reduceMotion: reduceMotion,
  };
})();
