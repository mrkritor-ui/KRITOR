(function () {
  'use strict';

  const PROJECT = 'images/kritor-project-2026-08-20.text-animator';
  const FONT = 'images/Simpsonfont DEMO.otf';
  const TEXT = 'KRITOR';
  const FONT_SIZE = 73;
  const TRACKING = 0.11;
  const LOOP_MS = 2200;
  const AMPLITUDE = 0.05;
  const OFFSET = 2;
  const FADE_MS = 1400;
  const DEPTH = 5;

  let canvas, ctx, frames = [], images = [], start = performance.now();
  let dismissed = false;

  function setup() {
    canvas = document.createElement('canvas');
    canvas.id = 'kritor-intro';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize, { passive: true });
  }

  function resize() {
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = Math.min(720, Math.max(280, window.innerWidth * 0.42));
    const cssH = Math.min(180, cssW * 0.32);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function measureText(text, size) {
    ctx.font = size + 'px Simpsonfont';
    let width = 0;
    for (const char of text) width += ctx.measureText(char).width;
    return width + size * TRACKING * Math.max(0, text.length - 1);
  }

  function paintTextured(image, x, y, size, angle, opacity, offsetX, offsetY) {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const layer = document.createElement('canvas');
    layer.width = canvas.width;
    layer.height = canvas.height;
    const lctx = layer.getContext('2d');
    const dpr = canvas.width / w;
    lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    lctx.globalAlpha = opacity;

    const ratio = Math.max(w / image.naturalWidth, h / image.naturalHeight);
    const iw = image.naturalWidth * ratio;
    const ih = image.naturalHeight * ratio;
    lctx.drawImage(image, (w - iw) / 2, (h - ih) / 2, iw, ih);

    // Use the font as an alpha mask. This is the critical part that prevents
    // the source texture from appearing as a square.
    lctx.globalCompositeOperation = 'destination-in';
    lctx.fillStyle = '#000';
    lctx.font = size + 'px Simpsonfont';
    lctx.textBaseline = 'alphabetic';
    lctx.textAlign = 'left';

    const total = measureText(TEXT, size);
    let cursor = (w - total) / 2 + offsetX;
    for (let i = 0; i < TEXT.length; i++) {
      const char = TEXT[i];
      const charWidth = lctx.measureText(char).width;
      const phase = i * 0.42 + OFFSET;
      const vertical = Math.sin(phase) * size * AMPLITUDE;
      lctx.save();
      lctx.translate(cursor + charWidth / 2, y + offsetY + vertical);
      lctx.rotate(angle * (i % 2 ? -1 : 1));
      lctx.fillText(char, -charWidth / 2, 0);
      lctx.restore();
      cursor += charWidth + size * TRACKING;
    }

    ctx.drawImage(layer, 0, 0, w, h);
  }

  function drawFrame(image, progress) {
    if (!ctx || !canvas || !image.complete) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);

    const size = FONT_SIZE;
    const swing = Math.sin(progress * Math.PI * 2) * AMPLITUDE;
    const angle = swing * 0.35;
    const y = h / 2 + size * 0.34;

    // Same texture frame is reused for every extrusion slice.
    for (let d = DEPTH; d >= 1; d--) {
      paintTextured(image, w / 2, y, size, angle, 0.58, d * 0.9, d * 0.9);
    }
    paintTextured(image, w / 2, y, size, angle, 1, 0, 0);
  }

  function animate(now) {
    if (dismissed) return;
    if (images.length) {
      const progress = ((now - start) % LOOP_MS) / LOOP_MS;
      const index = Math.floor(progress * images.length) % images.length;
      drawFrame(images[index], progress);
    }
    requestAnimationFrame(animate);
  }

  async function load() {
    const font = new FontFace('Simpsonfont', `url('${FONT}')`);
    await font.load();
    document.fonts.add(font);

    const response = await fetch(PROJECT, { cache: 'force-cache' });
    const data = await response.json();
    frames = data?.layers?.[0]?.face?.texture?.file?.frames || [];
    if (!frames.length) throw new Error('No texture frames found');

    images = await Promise.all(frames.map(frame => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = frame.content;
    })));

    start = performance.now();
    requestAnimationFrame(animate);
  }

  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    canvas.classList.add('is-fading');
    window.setTimeout(() => canvas.remove(), FADE_MS + 50);
  }

  setup();
  document.addEventListener('pointerdown', dismiss, { once: true, passive: true });
  load().catch(error => {
    console.error('KRITOR intro animation failed:', error);
    canvas.remove();
  });
})();
