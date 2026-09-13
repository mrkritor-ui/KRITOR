/* KRITOR — the boot scene.

   The loading screen is a door, not a progress bar. Arriving at kritor.au you
   are stopped: a field of paper and ink keeps quietly rearranging itself, and
   nothing happens until you answer it — no name in it, no line of type over
   it, nothing to read, just the bar saying LOADING and then, once it has
   nothing left to report, PRESS TO ENTER. Moving between the catalogue and
   the store you are not stopped — a globe forms and turns while you watch,
   forwards on the way out and backwards on the way home — because the door
   is only worth closing once.

   Architecture is a third door rather than a third pair of flights — it has
   no far side to fly to yet, so arriving there is answered the same way the
   gate is: a scene, silent, waiting on a click. Its own scene is a grid of
   the same letter settling out of a smear, cell by cell, standing in for a
   section that has no picture of its own yet either.

   Which screen you get is decided here, from where you were last:

     catalogue, arrived from anywhere but the store  →  the block glitch, and the gate
     catalogue, arrived from the store               →  the globe, flying back
     store                                           →  the globe, flying out
     architecture, arrived from anywhere              →  the letter grid, and the gate

   The store's two flights still write a name — KRITOR STORE in the
   blackletter, fading in once the globe has actually formed — and nothing
   else. Both gates are silent throughout — nothing is ever written over
   either of them. */
(function () {
  "use strict";

  const LAST_PAGE_KEY = "kritor-last-page";

  /* Nothing above the name, on any of the three screens, and nothing below it
     either. The door used to spell out its invitation — "YOU HAVE STUMBLED
     UPON", and an ENTER button under it — the warps once announced their own
     direction, OUTBOUND and INBOUND, and the two flights used to have KRITOR
     say something under its own name (Kritor is not a shop, but it will take
     your money — that kind of line). All of it read as a game's title card
     once there was a globe under it to look at instead of past. Just the
     name, and where you are headed. */
  const SUB = { gate: "", arch: "", out: "STORE", back: "CATALOGUE" };

  /* The globe's own choreography, end to end: bloom, a beat to look at it,
     the wordmark's fade-in, a beat with it up, and this is where the loading
     bar's own fill ends too — matched by hand to GLOBE_READY_MS in
     pixel-fx.js, since the two live in different files and neither reads
     the other's constant. */
  const WARP_MS = 4200;

  function lastPage() {
    try { return sessionStorage.getItem(LAST_PAGE_KEY) || ""; } catch (e) { return ""; }
  }

  function rememberPage(page) {
    try { sessionStorage.setItem(LAST_PAGE_KEY, page); } catch (e) {}
  }

  function modeFor(page) {
    if (page === "store") return "out";
    if (page === "architecture") return "arch";
    return lastPage() === "store" ? "back" : "gate";
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  /* Returns { mode, ready, part, stop }. `ready` resolves when the screen is
     done asking: on the click, or when the flight lands. `part` tells the
     scene to take itself away over the given number of milliseconds — the
     gate dissolves and leaves the name behind. `stop` is called once the boot
     screen is dismissed, so nothing is left animating underneath the
     catalogue. */
  function mount(page) {
    const boot = document.getElementById("boot");
    const mode = modeFor(page);
    rememberPage(page);

    if (!boot) return {
      mode: mode, ready: Promise.resolve(), part: function () {}, stop: function () {},
    };

    const gateLike = mode === "gate" || mode === "arch";

    boot.dataset.mode = mode;
    setText("boot-sub", SUB[mode]);

    const stage = document.getElementById("boot-fx");
    let fx = { stop: function () {}, part: function () {} };
    if (stage && window.KritorFX) {
      fx = mode === "gate" ? window.KritorFX.blockGlitch(stage)
        : mode === "arch" ? window.KritorFX.letterGrid(stage)
        : window.KritorFX.globe(stage);
    }

    let ready;
    let cleanupGate = function () {};

    if (gateLike) {
      /* With no ENTER button left to press, the screen itself has to be the
         button in name as well as in behaviour, or the one interaction the
         site insists on is invisible to a keyboard and unannounced to a
         screen reader. */
      boot.setAttribute("role", "button");
      boot.setAttribute("tabindex", "0");
      boot.setAttribute("aria-label", "Enter KRITOR");

      /* Anything counts as entering — the whole screen is the button, and the
         keyboard has to work too, or the one interaction the site insists on
         is the one a keyboard cannot perform. */
      ready = new Promise(resolve => {
        let entered = false;
        const enter = e => {
          if (entered) return;
          if (e.type === "keydown" && e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
          if (e.type === "keydown") e.preventDefault();
          entered = true;
          boot.dataset.entered = "true";
          boot.removeAttribute("role");
          boot.removeAttribute("tabindex");
          boot.removeAttribute("aria-label");
          cleanupGate();
          resolve();
        };
        cleanupGate = () => {
          boot.removeEventListener("click", enter);
          document.removeEventListener("keydown", enter);
        };
        boot.addEventListener("click", enter);
        document.addEventListener("keydown", enter);
      });
    } else {
      /* The globe's own clock, not a second timer guessing at its duration —
         see notifyReady in pixel-fx.js's run(). WARP_MS still paces the
         loading bar's fill below, which is only ever decorative; the actual
         hand-off waits on the scene itself, so the two can never drift out
         of step under a slow frame or two. */
      ready = fx.ready || new Promise(resolve => setTimeout(resolve, WARP_MS));
    }

    return {
      mode: mode,
      ready: ready,
      part: function (ms) { fx.part(ms); },
      stop: function () { cleanupGate(); fx.stop(); },
    };
  }

  window.KritorBoot = { mount: mount, WARP_MS: WARP_MS };
})();
