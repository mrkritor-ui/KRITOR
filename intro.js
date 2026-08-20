(function () {
  'use strict';

  const PROJECT = 'images/kritor-project-2026-08-20.text-animator';
  const FONT = 'images/Simpsonfont DEMO.otf';
  const TEXT = 'KRITOR';
  const FONT_SIZE = 73;
  const TRACKING = 0.11;
  const LINE_HEIGHT = 1.1;
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
    const cssSize = Math.min(720, Math.max(280, window.innerWidth * 0.42));
    canvas.style.width = cssSize + 'px';
    canvas.style.height = Math.min(180, cssSize * 0.32) + 'px';
    canvas.width = Math.round(cssSize * dpr);
    canvas.height = Math.round(Math.min(180, cssSize * 0.32) * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function textWidth(ctx, text, size, tracking) {
    let width = ctx.measureText(text).width;
    if (text.length > 1) width += size * tracking * (text.length - 1);
    return width;
  }

  function drawTrackedText(ctx, text, x, y, size, tracking, transform) {
    ctx.save();
    ctx.translate(x, y);
    if (transform) transform(ctx);
    const spacing = size * tracking;
    let cursor = -textWidth(ctx, text, size, tracking) / 2;
    for (const char of text) {
      ctx.fillText(char, cursor, 0);
      cursor += ctx.measureText(char).width + spacing;
    }
    ctx.restore();
  }

  function clipText(ctx, drawTexture, x, y, scale, angle) {
    ctx.save();
    ctx.beginPath();
    const size = FONT_SIZE * scale;
    ctx.font = size + 'px Simpsonfont';
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    let cursor = x - textWidth(ctx, TEXT, size, TRACKING) / 2;
    for (const char of TEXT) {
      ctx.save();
      ctx.translate(cursor, y);
      ctx.rotate(angle);
      ctx.fillText(char, 0, 0);
      ctx.restore();
      cursor += ctx.measureText(char).width + size * TRACKING;
    }
    ctx.clip('nonzero');
    drawTexture();
    ctx.restore();
  }

  function drawFrame(image, progress) {
    if (!ctx || !canvas || !image.complete) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);

    const swing = Math.sin(progress * Math.PI * 2 + OFFSET) * AMPLITUDE;
    const scale = 1 + swing * 0.15;
    const angle = swing * 0.18;
    const size = FONT_SIZE * scale;
    ctx.font = size + 'px Simpsonfont';
    ctx.textBaseline = 'alphabetic';
    const width = textWidth(ctx, TEXT, size, TRACKING);
    const x = w / 2;
    const y = h / 2 + size * 0.34;

    // Extruded depth, using the exact same texture frame.
    for (let d = DEPTH; d >= 1; d--) {
      ctx.save();
      ctx.globalAlpha = 0.62;
      clipText(ctx, () => {
        ctx.globalCompositeOperation = 'source-over';
        const ratio = Math.min(w / image.naturalWidth, h / image.naturalHeight);
        const iw = image.naturalWidth * ratio;
        const ih = image.naturalHeight * ratio;
        ctx.drawImage(image, (w - iw) / 2 + d * 0.9, (h - ih) / 2 + d * 0.9, iw, ih);
      }, x + d * 0.9, y + d * 0.9, scale, angle);
      ctx.restore();
    }

    // Main textured face.
    clipText(ctx, () => {
      const ratio = Math.min(w / image.naturalWidth, h / image.naturalHeight);
      const iw = image.naturalWidth * ratio;
      const ih = image.naturalHeight * ratio;
      ctx.drawImage(image, (w - iw) / 2, (h - ih) / 2, iw, ih);
    }, x, y, scale, angle);
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
