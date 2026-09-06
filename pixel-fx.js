/* KRITOR — pixel effects.

   Two animations for the two loading screens, both drawn as real pixels onto a
   canvas that is a couple of hundred cells wide and then blown up with
   nearest-neighbour, so a "pixel" on the boot screen is a square block of the
   same family as the 1-bit renditions the catalogue is built out of. The
   screen used to be characters — a Doom fire and a field of full stops set in
   a <pre> — and characters are a different bitmap from the one the rest of the
   site speaks in: the works are pixels, the icons are pixels, and the door was
   text pretending.

     gate   a storm over a plain: clouds drifting at two speeds, lightning
            every few seconds, a ruin on the far horizon and one figure on the
            near ridge looking at it. The wordmark is drawn into the same grid,
            so it is lit by the same lightning as the landscape.
     warp   the flight between the catalogue and the store, forwards on the way
            out and backwards on the way home.

   One bit, not one colour. Everything below produces a buffer of 0 and 1 and
   the driver paints 1 as --ink and 0 as --bg, so both scenes are correct in
   paper mode and in terminal mode without knowing which one is on, and the
   tone between them is ordered dithering rather than opacity — which is what
   an actual 1-bit machine would have had to do, and what the renditions in the
   catalogue already do.

   Nothing allocates per frame. The scene is built once per size into flat
   typed arrays, a frame is a pass over those arrays into an ImageData, and the
   only things that change between frames are two cloud offsets, a flash level
   and whichever pixels the bolt is currently on. */
(function () {
  "use strict";

  /* ── 1-bit plumbing ──────────────────────────────────────────────────────── */

  /* Ordered dither. A value between 0 and 1 becomes ink or paper depending on
     where the pixel sits in a 4×4 grid, which is what turns a smooth sky into
     a stipple that holds its shape when it moves. Error diffusion would look
     better on a still frame and crawl horribly on a moving one. */
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

  function wrap(i, n) { return ((i % n) + n) % n; }

  /* Value noise on a grid that repeats every `gx` cells across the width, so a
     cloud band can be scrolled forever without a seam. */
  function noise(x, y, gx, gy, seed, CW, CH) {
    const fx = x / CW * gx;
    const fy = y / CH * gy;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = fx - ix, ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const x0 = wrap(ix, gx), x1 = wrap(ix + 1, gx);
    const a = hash2(x0, iy, seed), b = hash2(x1, iy, seed);
    const c = hash2(x0, iy + 1, seed), d = hash2(x1, iy + 1, seed);
    const top = a + (b - a) * sx;
    return top + (c + (d - c) * sx - top) * sy;
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
  const TARGET_COLS = 200;
  const MIN_SCALE = 3;
  const MAX_SCALE = 12;

  /* ── The driver ──────────────────────────────────────────────────────────── */

  /* build(W, H) returns { render(dt, bits) }, which fills `bits` with one 0 or
     1 per cell. Everything else — sizing, the palette, the frame budget,
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

  /* ── Sprites ─────────────────────────────────────────────────────────────── */

  /* '#' is ink, 'o' is a hole punched back to paper — a window in the ruin —
     and '.' is nothing at all, which is how the sky gets through the ruined
     archway. */
  function blit(bits, W, H, sprite, ox, oy) {
    for (let y = 0; y < sprite.length; y++) {
      const row = sprite[y];
      const ty = oy + y;
      if (ty < 0 || ty >= H) continue;
      for (let x = 0; x < row.length; x++) {
        const c = row.charCodeAt(x);
        if (c === 46) continue;                       // '.'
        const tx = ox + x;
        if (tx < 0 || tx >= W) continue;
        bits[ty * W + tx] = c === 35 ? 1 : 0;         // '#' : 'o'
      }
    }
  }

  function spriteWidth(sprite) {
    let w = 0;
    for (let i = 0; i < sprite.length; i++) w = Math.max(w, sprite[i].length);
    return w;
  }

  /* The wordmark. A pixel cut of the letters as they are drawn in the
     notebook — one weight, cut on the diagonal, spurs at the corners and a
     drip off the foot of every stem. It is drawn into the scene rather than
     set as type over it, so the lightning reaches it: for two frames the sky
     goes to ink and the name comes back out of it in paper. */
  const MARK = {
    K: [
      "###.......###",
      "###......###.",
      "###.....###..",
      "###....###...",
      "###...###....",
      "###..###.....",
      "###.###......",
      "#######......",
      "######.......",
      "#######......",
      "###.###......",
      "###..###.....",
      "###...###....",
      "###....###...",
      "###.....###..",
      "###......###.",
      "###.......###",
      ".#.........#.",
      ".#...........",
    ],
    R: [
      "#########...",
      "###...####..",
      "###....###..",
      "###....###..",
      "###...####..",
      "#########...",
      "########....",
      "###.####....",
      "###..####...",
      "###...####..",
      "###....####.",
      "###.....####",
      "###......###",
      "###.......##",
      "###.......##",
      "###........#",
      "###........#",
      ".#.........#",
      ".#..........",
    ],
    I: [
      "#######",
      "#######",
      "..###..",
      "..###..",
      "..###..",
      "..###..",
      "..###..",
      "..###..",
      "..###..",
      "..###..",
      "..###..",
      "..###..",
      "..###..",
      "..###..",
      "..###..",
      "#######",
      "#######",
      "..#....",
      "..#....",
    ],
    T: [
      "#############",
      "#############",
      ".....###.....",
      ".....###.....",
      ".....###.....",
      ".....###.....",
      ".....###.....",
      ".....###.....",
      ".....###.....",
      ".....###.....",
      ".....###.....",
      ".....###.....",
      ".....###.....",
      ".....###.....",
      ".....###.....",
      "....#####....",
      "....#####....",
      "......#......",
      "......#......",
    ],
    O: [
      "...#######...",
      ".##########..",
      "###.....####.",
      "###......####",
      "###.......###",
      "###.......###",
      "###.......###",
      "###.......###",
      "###.......###",
      "###.......###",
      "###.......###",
      "###.......###",
      "###......####",
      "###.....####.",
      ".##########..",
      "..########...",
      "...######....",
      ".....#..#....",
      ".....#.......",
    ],
  };

  const MARK_WORD = "KRITOR";
  const MARK_GAP = 2;
  const MARK_H = MARK.K.length;
  const MARK_W = (function () {
    let w = 0;
    for (let i = 0; i < MARK_WORD.length; i++) w += spriteWidth(MARK[MARK_WORD[i]]) + (i ? MARK_GAP : 0);
    return w;
  })();

  /* The ruin. Two towers and what is left of the wall between them, with the
     archway open to the sky — it reads at forty cells across because it is a
     silhouette with three or four wrong edges in it, not because any of the
     detail survives. */
  const RUIN = [
    "................................#####...",
    "................................#.###...",
    "..........................##.#####.###..",
    "..........................############..",
    "..........................############..",
    "..........................###.####.###..",
    "...###.######.............############..",
    "...##########.............############..",
    "...###o######.............###o####o###..",
    "...###o######.............###o####o###..",
    "...##########.............############..",
    "...#######.##.............#####.######..",
    "...##########.............############..",
    "...##########.............####o##o####..",
    "...##########.............####o##o####..",
    "...##########..##.####.###############..",
    "...###o##o###..############.##########..",
    "...###o##o###..############.##########..",
    "...##########..############.###o####o###",
    "...##########..############.###o####o###",
    "...##########..####..#####.############.",
    "...##########..###....####.############.",
    "...##########..###....####.############.",
    "...##########..###....####.############.",
    "...##########..###....####.############.",
    "...##########..############.############",
  ];

  /* One figure on the near ridge, back to us, staff planted, looking at the
     ruin. Everything else on the screen moves; he does not, which is the whole
     composition — the distance between him and the thing on the horizon is
     what the screen is about. */
  const FIGURE = [
    "...###.....",
    "..#####...#",
    "..#####...#",
    "...###....#",
    "..#####...#",
    ".#######..#",
    "#########.#",
    "#########.#",
    "#########.#",
    ".########.#",
    ".#######..#",
    ".##.####..#",
    ".##.###...#",
    ".##.###...#",
    ".##..##...#",
    ".##..##...#",
    "###..###..#",
  ];

  /* The one thing about him that moves, and only by a pixel or two: the cloak
     taking the same wind that is pushing the clouds. Offsets from the sprite's
     own origin, so they can sit outside it. */
  const CLOAK = [
    [[-1, 7], [-1, 8], [-1, 9], [-1, 10], [-2, 9]],
    [[-1, 7], [-1, 8], [-2, 8], [-2, 9], [-3, 9], [-2, 10]],
    [[-1, 7], [-2, 7], [-2, 8], [-3, 8], [-3, 9], [-2, 10], [-1, 11]],
    [[-1, 7], [-1, 8], [-2, 8], [-2, 9], [-1, 10], [-1, 11]],
  ];

  /* ── The gate: a storm over a plain ──────────────────────────────────────── */

  function terrain(host) {
    return run(host, reduceMotion ? 10 : 20, function (W, H, info) {
      const N = W * H;

      /* The scene has an aspect of its own and the viewport does not. Rather
         than stretch the horizon down a phone, the landscape keeps its shape
         and the screen's spare height becomes more sky above it and more
         ground below — which is what a title screen letterboxed onto a tall
         display should look like. */
      const sceneH = Math.min(H, Math.max(Math.round(W * 0.66), Math.round(H * 0.55)));
      const top = Math.round((H - sceneH) * 0.72);
      const hy = top + Math.round(sceneH * 0.66);          // the horizon
      const ridgeY = top + Math.round(sceneH * 0.74);      // crest of the near ridge
      const gy = top + Math.round(sceneH * 0.92);          // where the ridge meets the floor

      /* ── The static half of the picture ──────────────────────────────── */

      /* sky   the dithered gradient, as bits, so a quiet frame is a copy
         val   the same gradient as values, so lightning can be mixed into it
         land  every cell the landscape occupies
         rim   the landscape's outline, which is all that is left of it when
               the sky goes white behind it */
      const sky = new Uint8Array(N);
      const val = new Float32Array(N);
      const land = new Uint8Array(N);
      const rim = new Uint8Array(N);

      /* Weather, not grey. An ordered dither held at a third of a screen reads
         as noise at this size and buries everything drawn into it, so the sky
         is paper almost all the way and only takes on grain in the last part
         of the climb — which is also where the clouds are, so the two read as
         one thing rather than as a texture and a shape. */
      const SKY_TOP = 0.19;
      for (let y = 0; y < hy; y++) {
        const t = 1 - y / hy;
        const base = SKY_TOP * Math.pow(t, 3);
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          val[i] = base;
          sky[i] = dither(x, y, base);
        }
      }

      /* The plain, running away from us to the ruin. Drawn the way it is drawn
         in the notebook — horizontal strokes, longer and more of them as the
         ground comes forward — rather than as a field of dither, because the
         plain is the one part of the picture that has to stay quiet enough for
         something to stand on it. */
      const plainRows = Math.max(1, gy - hy);
      for (let y = hy + 1; y < gy; y++) {
        const t = (y - hy) / plainRows;
        const density = 0.015 + t * t * 0.075;
        let x = 0;
        while (x < W) {
          if (hash2(x, y, 6197) < density) {
            const len = 2 + Math.floor(hash2(x, y, 8419) * (3 + t * 13));
            for (let k = 0; k < len && x + k < W; k++) sky[y * W + x + k] = 1;
            x += len + 2;
          } else x += 1;
        }
      }

      /* The far land: a low ridge just under the horizon, and the ruin
         standing on it. Solid, because distance in one bit is size and edge
         count, never tone. */
      const farTop = new Int32Array(W);
      for (let x = 0; x < W; x++) {
        const h = 2 + Math.round(1.6 + Math.sin(x * 0.045) * 1.6 + Math.sin(x * 0.017 + 2.1) * 1.4);
        farTop[x] = hy - Math.max(0, h);
      }
      for (let x = 0; x < W; x++) {
        for (let y = farTop[x]; y < hy + 1 && y < H; y++) if (y >= 0) land[y * W + x] = 1;
      }

      /* The near ridge. One long mound with the figure on its crest and a
         smaller one behind it on the other side of the frame, so the eye has
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
        /* A pixel of grain along the crest: a mound drawn from a smooth
           function has a smooth edge, and nothing else on this screen does. */
        const grain = hash2(x, 3, 5501) < 0.34 ? 1 : 0;
        nearTop[x] = Math.round(gy - rise) - grain;
      }
      for (let x = 0; x < W; x++) {
        for (let y = Math.max(0, nearTop[x]); y < H; y++) land[y * W + x] = 1;
      }

      /* The ruin sits on the far ridge, left of centre, so it is across the
         plain from the figure rather than behind him. Held to a fifth of the
         scene's height, taken off the top when it has to be: on a squeezed
         screen the full sprite stands up into the line KRITOR is speaking, and
         a ruin that has lost its last turret is still a ruin. */
      const ruin = RUIN.slice(RUIN.length -
        Math.max(14, Math.min(RUIN.length, Math.round(sceneH * 0.20))));
      const ruinW = spriteWidth(ruin);
      const ruinX = Math.round(W * 0.20) - Math.round(ruinW / 2);
      const ruinY = hy - ruin.length + 1;
      blit(land, W, H, ruin, ruinX, ruinY);
      /* The ruin's windows and its open arch are holes in the silhouette, and a
         hole has to be a hole in the sky too or the stipple behind it never
         shows through. */
      for (let y = 0; y < ruin.length; y++) {
        for (let x = 0; x < ruin[y].length; x++) {
          if (ruin[y].charCodeAt(x) !== 111) continue;      // 'o'
          const tx = ruinX + x, ty = ruinY + y;
          if (tx >= 0 && tx < W && ty >= 0 && ty < H) land[ty * W + tx] = 0;
        }
      }

      const figX = peakX - Math.round(spriteWidth(FIGURE) / 2);
      const figY = Math.max(0, nearTop[Math.min(W - 1, Math.max(0, peakX))] - FIGURE.length + 2);
      blit(land, W, H, FIGURE, figX, figY);

      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          if (!land[i]) continue;
          if ((y === 0 || !land[i - W]) || (y === H - 1 || !land[i + W]) ||
              (x === 0 || !land[i - 1]) || (x === W - 1 || !land[i + 1])) rim[i] = 1;
        }
      }

      /* ── The clouds ──────────────────────────────────────────────────── */

      /* Where the name lands, decided here rather than per frame: the storm is
         placed against it and so is the type underneath it. */
      const markX = Math.round((W - MARK_W) / 2);
      const markY = top + Math.round(sceneH * 0.24);

      /* Where the name ends, in real screen pixels, published once per layout
         so the line KRITOR speaks can be hung off the bottom of it rather than
         centred in the screen. Written on the boot element rather than on this
         one: a custom property inherits down, and the statement is this host's
         sibling, not its child. */
      (host.parentElement || host).style.setProperty("--boot-mark-bottom",
        Math.round(info.offsetTop + (markY + MARK_H) * info.scale) + "px");
      const highH = Math.max(10, Math.min(markY - 3 + Math.max(3, Math.round(hy * 0.05)),
        Math.round(hy * 0.42)));

      /* Two banks at two speeds. Each is generated at twice the width of the
         screen so it can be scrolled forever and meet itself, and each is
         already dithered — the stipple belongs to the cloud and travels with
         it, rather than the cloud sliding underneath a fixed screen door. */
      function bank(y0, h, gx, gy2, seed, cover, gain) {
        const CW = W * 2;
        const mask = new Uint8Array(CW * h);
        for (let y = 0; y < h; y++) {
          const vy = h > 1 ? y / (h - 1) : 0.5;
          const fall = Math.min(1, Math.sin(Math.PI * Math.pow(vy, 0.72)) * 1.2);
          for (let x = 0; x < CW; x++) {
            const n =
              0.56 * noise(x, y, gx, gy2, seed, CW, h) +
              0.30 * noise(x, y, gx * 2, gy2 * 2, seed + 17, CW, h) +
              0.14 * noise(x, y, gx * 4, gy2 * 4, seed + 91, CW, h);
            /* Gain decides whether the bank is weather or a wall: high gain and
               a negative cover leaves only the top of the noise standing, which
               is a wisp; low gain and a positive one fills the band. */
            const v = ((n - 0.5) * gain + cover) * fall;
            mask[y * CW + x] = v > 0 ? dither(x, y, v) : 0;
          }
        }
        return { mask: mask, CW: CW, h: h, y0: y0, off: 0 };
      }

      const banks = [
        /* The high bank: heavy, close, the one the lightning is inside. It is
           hung off the bottom of the name rather than off the top of the
           screen, and always runs off the top edge — clouds that stop short of
           the frame are a shape floating in a sky, not weather — with a
           ceiling on how deep it can get so a tall screen ends up with more
           open sky above the storm rather than one enormous soft cloud. */
        Object.assign(bank(markY - 3 - highH, highH, 5, 3, 1301, 0.26, 2.2),
          { speed: reduceMotion ? 1.2 : 4.6 }),
        /* And a thin one drawn across the ruin, drifting the other way and
           slower, which is the whole of the depth in this sky. Above the far
           ridge rather than on it: a bank lying exactly on the horizon reads
           as a hedge, not as weather. */
        Object.assign(bank(hy - Math.round(sceneH * 0.15), Math.max(4, Math.round(sceneH * 0.09)), 3, 1, 4703, -0.30, 3.4),
          { speed: reduceMotion ? -0.5 : -1.7 }),
      ];
      const cloud = new Uint8Array(N);

      /* ── The lightning ───────────────────────────────────────────────── */

      /* Level 0 is a quiet frame. Above it the sky fills toward solid ink, the
         landscape keeps its ink but loses its top edge to paper, the clouds go
         to paper from behind and the bolt is the paper it is coming from — so
         a strike is the picture turning inside out for a fifth of a second
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
        let x = Math.round(W * (0.12 + Math.random() * 0.72));
        let y = top + Math.round(sceneH * 0.06);
        const endY = hy - Math.round(2 + Math.random() * 6);
        const forkAt = y + Math.round((endY - y) * (0.35 + Math.random() * 0.3));
        let fork = null;
        const mark = (px2, py) => {
          if (px2 >= 0 && px2 < W && py >= 0 && py < H) bolt[py * W + px2] = 1;
        };
        while (y < endY) {
          const step = 2 + Math.floor(Math.random() * 4);
          const dx = Math.round((Math.random() - 0.5) * 5);
          for (let k = 0; k < step && y < endY; k++, y++) {
            const nx = x + Math.round(dx * k / step);
            mark(nx, y);
            /* Thicker at the top, where it is nearest, and down to a hair by
               the time it reaches the plain. */
            if (y < forkAt) mark(nx + 1, y);
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
            mark(fx, fy);
          }
        }
      }

      return {
        render: function (dt, bits) {
          t += dt;

          /* Clouds first: clear the composite, then lay each bank into it at
             its own offset. Two array walks, no allocation, and the offsets
             land on whole cells — a cloud that moves by a third of a pixel is
             a cloud that has stopped being made of pixels. */
          cloud.fill(0);
          for (let b = 0; b < banks.length; b++) {
            const bank2 = banks[b];
            bank2.off += bank2.speed * dt;
            const shift = wrap(Math.round(bank2.off), bank2.CW);
            for (let y = 0; y < bank2.h; y++) {
              const ty = bank2.y0 + y;
              if (ty < 0 || ty >= H) continue;
              const src = y * bank2.CW;
              const dst = ty * W;
              for (let x = 0; x < W; x++) {
                if (bank2.mask[src + wrap(x + shift, bank2.CW)]) cloud[dst + x] = 1;
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
          if (cloakT > 0.42) {
            cloakT = 0;
            cloakFrame = (cloakFrame + 1 + (Math.random() < 0.3 ? 1 : 0)) % CLOAK.length;
          }

          /* One pass. Quiet frames are sky-or-cloud-or-land and nothing else;
             lit frames mix the flash level into the sky's own value so the
             stipple fills rather than switches, and take the rim and the bolt
             back out of it. */
          const lit = flash > 0.001;
          for (let y = 0; y < H; y++) {
            const row = y * W;
            for (let x = 0; x < W; x++) {
              const i = row + x;
              let bit;
              if (land[i]) {
                bit = lit && rim[i] ? 0 : 1;
              } else if (cloud[i]) {
                bit = flash > 0.45 ? 0 : 1;
              } else if (lit) {
                const v = val[i] + (1 - val[i]) * flash;
                bit = dither(x, y, v);
              } else {
                bit = sky[i];
              }
              if (boltOn && bolt[i]) bit = lit ? 0 : 1;
              bits[i] = bit;
            }
          }

          /* The cloak, over the ridge it is standing on. */
          const cf = CLOAK[cloakFrame];
          for (let k = 0; k < cf.length; k++) {
            const cx = figX + cf[k][0], cy = figY + cf[k][1];
            if (cx >= 0 && cx < W && cy >= 0 && cy < H) bits[cy * W + cx] = lit && cf[k][1] < 9 ? 0 : 1;
          }

          /* The wordmark last, with a cell of paper knocked out all round it,
             so it is legible through whatever the sky is doing behind it. */
          let mx = markX;
          const my = markY;
          /* The halo takes whichever tone the letters are not, so the name is
             cut out of the sky in a quiet frame and cut back into it in a lit
             one — either way the drips keep their edges. */
          const halo = lit ? 1 : 0;
          const face = lit ? 0 : 1;
          for (let g = 0; g < MARK_WORD.length; g++) {
            const glyph = MARK[MARK_WORD[g]];
            for (let y = 0; y < glyph.length; y++) {
              const row2 = glyph[y];
              for (let x = 0; x < row2.length; x++) {
                if (row2.charCodeAt(x) !== 35) continue;
                for (let dy = -1; dy <= 1; dy++) {
                  for (let dx = -1; dx <= 1; dx++) {
                    const tx = mx + x + dx, ty = my + y + dy;
                    if (tx < 0 || tx >= W || ty < 0 || ty >= H) continue;
                    bits[ty * W + tx] = halo;
                  }
                }
              }
            }
            for (let y = 0; y < glyph.length; y++) {
              const row2 = glyph[y];
              for (let x = 0; x < row2.length; x++) {
                if (row2.charCodeAt(x) !== 35) continue;
                const tx = mx + x, ty = my + y;
                if (tx < 0 || tx >= W || ty < 0 || ty >= H) continue;
                bits[ty * W + tx] = face;
              }
            }
            mx += spriteWidth(glyph) + MARK_GAP;
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
      const N = W * H;
      const count = Math.min(900, Math.round(W * H * (0.09 + Math.random() * 0.05)));
      const NEAR = 0.35, FAR = 14;
      const FOV = W * 0.42;
      const xs = new Float32Array(count);
      const ys = new Float32Array(count);
      const zs = new Float32Array(count);
      /* Not every star streaks, and the ones that do not are what make the ones
         that do read as near. Fixed per star, so a streak never blinks. */
      const trails = new Uint8Array(count);

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
            if (sx < -3 || sx >= W + 3 || sy < -3 || sy >= H + 3) continue;

            const near = Math.pow(1 - (z - NEAR) / (FAR - NEAR), 1.7);

            if (near > 0.72) {
              put(sx, sy); put(sx + 1, sy); put(sx, sy + 1); put(sx + 1, sy + 1);
              if (near > 0.9) { put(sx - 1, sy); put(sx + 2, sy); put(sx, sy - 1); put(sx, sy + 2); }
            } else if (near > 0.34) {
              put(sx, sy);
              if (near > 0.5) put(sx + 1, sy);
            } else {
              /* Faint, and made faint the only way one bit allows: it is on the
                 screen only where the dither says a cell of that value is. */
              if (dither(sx, sy, 0.22 + near * 1.6)) put(sx, sy);
            }

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
              const len = Math.min(9, Math.round(reach));
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
