/* KRITOR — the drawn cursor, painted by the page.

   The CSS `cursor` property was the wrong instrument for this. It is a request,
   not an instruction: the browser decides whether to honour the image at all,
   and when it declines — the wrong format, a size it will not carry, a platform
   that never supported it — it falls back to the system arrow without saying
   so. That is why the drawn cursor kept vanishing over everything that was not
   a link: the fallback is silent, and the computed style still reads back as
   the image, so nothing about the page looks wrong from the inside.

   So the page draws it instead. This is an element that follows the pointer,
   above everything, in the site's own ink — nothing here is a request. It
   cannot fall back, cannot be overridden by a `cursor: pointer` in some other
   stylesheet, and cannot be the system arrow, because while it is live the
   system cursor is switched off (`html.kc-on`, in cursor.css).

   The PNG cursors in cursor.css stay, and are still the cursor until the first
   pointer movement, plus anywhere this cannot reach — inside a cross-origin
   frame, mainly, where the pointer stops reporting to us. They are the same
   drawing, so the handover is invisible.

   Coarse pointers get none of this: there is no cursor on a touchscreen to
   replace, and drawing one would be a lie about where the finger is. */
(function () {
  "use strict";

  var HTML = document.documentElement;

  /* The two sprites are the drawn cursors, traced pixel for pixel off the PNGs
     in cursor.css, so this changes how the cursor is delivered and not what it
     looks like. `h` is the halo, `b` the body: the halo is the page background
     and the body the ink, which is what keeps it legible over a painting —
     whatever the artwork is doing, one of the two contrasts with it.

     The I-beam is new. The fields had no drawn cursor at all before, because
     `cursor: text` is a keyword and there was no image to give it. */
  var SPRITES = {
    arrow: {
      w: 12, h: 16,
      svg: '<g class="h"><rect x="0" y="0" width="1" height="1"/><rect x="0" y="1" width="2" height="1"/><rect x="0" y="2" width="1" height="1"/><rect x="2" y="2" width="1" height="1"/><rect x="0" y="3" width="1" height="1"/><rect x="3" y="3" width="1" height="1"/><rect x="0" y="4" width="1" height="1"/><rect x="4" y="4" width="1" height="1"/><rect x="0" y="5" width="1" height="1"/><rect x="5" y="5" width="1" height="1"/><rect x="0" y="6" width="1" height="1"/><rect x="6" y="6" width="1" height="1"/><rect x="0" y="7" width="1" height="1"/><rect x="7" y="7" width="1" height="1"/><rect x="0" y="8" width="1" height="1"/><rect x="8" y="8" width="1" height="1"/><rect x="0" y="9" width="1" height="1"/><rect x="9" y="9" width="1" height="1"/><rect x="0" y="10" width="1" height="1"/><rect x="5" y="10" width="5" height="1"/><rect x="0" y="11" width="1" height="1"/><rect x="3" y="11" width="1" height="1"/><rect x="6" y="11" width="1" height="1"/><rect x="0" y="12" width="1" height="1"/><rect x="2" y="12" width="1" height="1"/><rect x="4" y="12" width="1" height="1"/><rect x="7" y="12" width="1" height="1"/><rect x="0" y="13" width="2" height="1"/><rect x="4" y="13" width="1" height="1"/><rect x="7" y="13" width="1" height="1"/><rect x="0" y="14" width="1" height="1"/><rect x="5" y="14" width="1" height="1"/><rect x="8" y="14" width="1" height="1"/><rect x="6" y="15" width="3" height="1"/></g><g class="b"><rect x="1" y="2" width="1" height="1"/><rect x="1" y="3" width="2" height="1"/><rect x="1" y="4" width="3" height="1"/><rect x="1" y="5" width="4" height="1"/><rect x="1" y="6" width="5" height="1"/><rect x="1" y="7" width="6" height="1"/><rect x="1" y="8" width="7" height="1"/><rect x="1" y="9" width="8" height="1"/><rect x="1" y="10" width="4" height="1"/><rect x="1" y="11" width="2" height="1"/><rect x="4" y="11" width="2" height="1"/><rect x="1" y="12" width="1" height="1"/><rect x="5" y="12" width="2" height="1"/><rect x="5" y="13" width="2" height="1"/><rect x="6" y="14" width="2" height="1"/></g>'
    },
    next: {
      w: 12, h: 11,
      svg: '<g class="h"><rect x="5" y="0" width="1" height="1"/><rect x="5" y="1" width="2" height="1"/><rect x="5" y="2" width="1" height="1"/><rect x="7" y="2" width="1" height="1"/><rect x="0" y="3" width="6" height="1"/><rect x="8" y="3" width="1" height="1"/><rect x="0" y="4" width="1" height="1"/><rect x="9" y="4" width="1" height="1"/><rect x="0" y="5" width="1" height="1"/><rect x="10" y="5" width="1" height="1"/><rect x="0" y="6" width="1" height="1"/><rect x="9" y="6" width="1" height="1"/><rect x="0" y="7" width="6" height="1"/><rect x="8" y="7" width="1" height="1"/><rect x="5" y="8" width="1" height="1"/><rect x="7" y="8" width="1" height="1"/><rect x="5" y="9" width="2" height="1"/><rect x="5" y="10" width="1" height="1"/></g><g class="b"><rect x="6" y="2" width="1" height="1"/><rect x="6" y="3" width="2" height="1"/><rect x="1" y="4" width="8" height="1"/><rect x="1" y="5" width="9" height="1"/><rect x="1" y="6" width="8" height="1"/><rect x="6" y="7" width="2" height="1"/><rect x="6" y="8" width="1" height="1"/></g>'
    },
    text: {
      w: 12, h: 16,
      svg: '<g class="h"><rect x="2" y="0" width="7" height="1"/><rect x="2" y="1" width="1" height="1"/><rect x="5" y="1" width="1" height="1"/><rect x="8" y="1" width="1" height="1"/><rect x="2" y="2" width="3" height="1"/><rect x="6" y="2" width="3" height="1"/><rect x="4" y="3" width="1" height="1"/><rect x="6" y="3" width="1" height="1"/><rect x="4" y="4" width="1" height="1"/><rect x="6" y="4" width="1" height="1"/><rect x="4" y="5" width="1" height="1"/><rect x="6" y="5" width="1" height="1"/><rect x="4" y="6" width="1" height="1"/><rect x="6" y="6" width="1" height="1"/><rect x="4" y="7" width="1" height="1"/><rect x="6" y="7" width="1" height="1"/><rect x="4" y="8" width="1" height="1"/><rect x="6" y="8" width="1" height="1"/><rect x="4" y="9" width="1" height="1"/><rect x="6" y="9" width="1" height="1"/><rect x="4" y="10" width="1" height="1"/><rect x="6" y="10" width="1" height="1"/><rect x="4" y="11" width="1" height="1"/><rect x="6" y="11" width="1" height="1"/><rect x="4" y="12" width="1" height="1"/><rect x="6" y="12" width="1" height="1"/><rect x="2" y="13" width="3" height="1"/><rect x="6" y="13" width="3" height="1"/><rect x="2" y="14" width="1" height="1"/><rect x="5" y="14" width="1" height="1"/><rect x="8" y="14" width="1" height="1"/><rect x="2" y="15" width="7" height="1"/></g><g class="b"><rect x="3" y="1" width="2" height="1"/><rect x="6" y="1" width="2" height="1"/><rect x="5" y="2" width="1" height="1"/><rect x="5" y="3" width="1" height="1"/><rect x="5" y="4" width="1" height="1"/><rect x="5" y="5" width="1" height="1"/><rect x="5" y="6" width="1" height="1"/><rect x="5" y="7" width="1" height="1"/><rect x="5" y="8" width="1" height="1"/><rect x="5" y="9" width="1" height="1"/><rect x="5" y="10" width="1" height="1"/><rect x="5" y="11" width="1" height="1"/><rect x="5" y="12" width="1" height="1"/><rect x="5" y="13" width="1" height="1"/><rect x="3" y="14" width="2" height="1"/><rect x="6" y="14" width="2" height="1"/></g>'
    }
  };

  /* One click advances to the next work, so the cursor says so — the same rule
     cursor.css had, kept here now that the cursor is drawn rather than named. */
  var NEXT_SEL = '[data-cursor="next"], .panel-art img';

  /* Where a caret goes, not a click. Buttons wearing <input> clothes are not
     fields, so they are excluded rather than matched. */
  var TEXT_SEL = 'textarea, [contenteditable=""], [contenteditable="true"], ' +
    'input:not([type="button"]):not([type="submit"]):not([type="reset"])' +
    ':not([type="checkbox"]):not([type="radio"]):not([type="range"])' +
    ':not([type="color"]):not([type="file"]):not([type="image"])';

  var fine = window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)");
  if (!fine) return;

  var root = null;          /* the element that follows the pointer */
  var shown = {};           /* sprite name -> its <svg>, once built */
  var state = "arrow";
  var x = 0, y = 0;
  var queued = false;
  var live = false;         /* true once the drawn cursor has taken over */

  /* The about page swaps the whole <body> out on navigation, which takes the
     cursor with it. Anything that lost its element rebuilds here rather than
     leaving the page with the system cursor switched off and nothing drawn in
     its place — that failure is the one this file exists to make impossible. */
  function ensure() {
    if (root && !(root.isConnected !== undefined ? root.isConnected : document.contains(root))) {
      root = null;
      shown = {};
    }
    build();
  }

  function build() {
    if (root || !document.body) return;

    root = document.createElement("div");
    root.className = "kritor-cursor";
    root.setAttribute("aria-hidden", "true");

    var markup = "";
    for (var name in SPRITES) {
      if (!Object.prototype.hasOwnProperty.call(SPRITES, name)) continue;
      var s = SPRITES[name];
      markup += '<svg class="kc-s" data-kc="' + name + '" viewBox="0 0 ' + s.w + " " + s.h +
        '" shape-rendering="crispEdges" focusable="false" aria-hidden="true">' + s.svg + "</svg>";
    }
    root.innerHTML = markup;

    for (var i = 0; i < root.children.length; i++) {
      shown[root.children[i].getAttribute("data-kc")] = root.children[i];
    }
    document.body.appendChild(root);
    paint();
  }

  /* Each sprite is sized and pulled back onto its own hotspot by cursor.css, in
     em against the sprite grid — so the scale is one number in one file, and no
     inline style is needed on a page whose CSP would rather not have one. The
     grids there and the viewBoxes here have to agree. */
  function paint() {
    var name;
    for (name in shown) {
      if (!Object.prototype.hasOwnProperty.call(shown, name)) continue;
      shown[name].style.display = name === state ? "block" : "none";
    }
  }

  function render() {
    queued = false;
    if (root) root.style.transform = "translate3d(" + x + "px," + y + "px,0)";
  }

  function frame() {
    if (queued) return;
    queued = true;
    if (window.requestAnimationFrame) window.requestAnimationFrame(render);
    else window.setTimeout(render, 16);
  }

  function stateFor(el) {
    if (!el || !el.closest) return "arrow";
    if (el.closest(NEXT_SEL)) return "next";
    if (el.closest(TEXT_SEL)) return "text";
    return "arrow";
  }

  function look(el) {
    var next = stateFor(el);
    if (next === state) return;
    state = next;
    if (root) paint();
  }

  /* The pointer has not moved but what is under it has — a panel opened, the
     grid re-laid itself, the page scrolled. Ask the document directly.

     Throttled to a frame, because elementFromPoint measures the layout and the
     scroll it hangs off can fire faster than the page is drawn. */
  var looking = false;

  function relook() {
    if (!live || looking) return;
    looking = true;
    frame();
    if (window.requestAnimationFrame) window.requestAnimationFrame(reallyLook);
    else window.setTimeout(reallyLook, 16);
  }

  function reallyLook() {
    looking = false;
    if (live) look(document.elementFromPoint(x, y));
  }

  function show() {
    if (!fine.matches) return;
    ensure();
    if (live) return;
    /* No element, no handover. Switching the system cursor off first would
       leave the page with nothing at all, which is the failure this is here to
       end — so the PNG keeps the job until there is something to replace it. */
    if (!root) return;
    live = true;
    /* Only now is the system cursor switched off. Before the first movement the
       PNG in cursor.css is still doing the job, and turning it off any earlier
       would leave the page bare while the pointer simply sits still. */
    HTML.classList.add("kc-on");
  }

  /* Handing back to the system cursor, not going bare: the PNG takes over
     wherever the pointer stops reporting to us — inside a cross-origin frame,
     or outside the window entirely. */
  function hide() {
    if (!live) return;
    live = false;
    HTML.classList.remove("kc-on");
  }

  function onMove(e) {
    /* A finger is not a pointer to draw. On a laptop that also has a screen you
       can touch, both kinds arrive here — the drawn cursor belongs to the mouse
       only, and a touch hands the page back until the mouse moves again. */
    if (e.pointerType === "touch") { hide(); return; }
    x = e.clientX;
    y = e.clientY;
    show();
    look(e.target);
    frame();
  }

  /* A null relatedTarget is the pointer leaving this document: off the window,
     or down into a frame. Both are cases the drawn cursor cannot follow, and a
     cursor frozen at the edge of a Stripe field reads as a broken page. */
  function onOut(e) {
    if (!e.relatedTarget) hide();
  }

  /* A click is the one thing that reliably changes what is under a pointer that
     is not moving: the work panel opens over it. Looked at again once it has,
     rather than waiting for the next twitch of the mouse. */
  function onDown(e) {
    onMove(e);
    window.setTimeout(relook, 0);
    window.setTimeout(relook, 280);
  }

  document.addEventListener("pointermove", onMove, true);
  document.addEventListener("pointerdown", onDown, true);
  document.addEventListener("pointerover", onMove, true);
  document.addEventListener("pointerout", onOut, true);
  window.addEventListener("blur", hide);
  window.addEventListener("scroll", relook, true);
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) hide();
  });

  /* A laptop that is also a tablet can change its mind about this. */
  if (fine.addEventListener) {
    fine.addEventListener("change", function () {
      if (!fine.matches) hide();
    });
  }

  /* The pointer can move before there is a body to hang the cursor off — this
     file runs from the head. build() declines quietly in that case; this is
     what picks it back up. */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build);
  } else {
    build();
  }
})();
