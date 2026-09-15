/* KRITOR — the boot scene.

   The loading screen used to be a door you had to answer — a field of paper
   and ink rearranging itself, nothing else, until a click or a key told it
   to open. That was one obstacle too many: a visitor had already chosen ART
   or ARCHITECTURE once, on the front door, and a second screen asking for a
   second click, with nothing written on it to click for, was friction with
   no information in it. Every screen on the site now arrives the same way
   the store's two flights always have — watched for a beat, named, and
   gone — rather than waiting on anything. The name was the one thing the
   gate and the letter grid never used to write; both write it now, exactly
   the way the store's flights do (see DOOR_READY_MS in pixel-fx.js for the
   gate and the letter grid's own timing, GLOBE_READY_MS for the globe's).

   Architecture is a third door rather than a third pair of flights — it has
   no far side to fly to yet, so arriving there is answered the same way the
   gate is: a scene that names itself and goes. Its own scene is a grid of
   the same letter settling out of a smear, cell by cell, standing in for a
   section that has no picture of its own yet either.

   Which screen you get is decided here, from where you were last:

     catalogue, arrived from anywhere but the store  →  the block glitch, and the gate
     catalogue, arrived from the store               →  the globe, flying back
     store                                           →  the globe, flying out
     architecture, arrived from anywhere              →  the letter grid, and the gate

   The store's two flights write KRITOR STORE / KRITOR CATALOGUE; the gate
   and the letter grid write KRITOR alone — see SUB below. */
(function () {
  "use strict";

  const LAST_PAGE_KEY = "kritor-last-page";

  /* Nothing above the name, on any of the four screens, and nothing below it
     either on the gate or the letter grid — the door used to spell out its
     invitation ("YOU HAVE STUMBLED UPON", an ENTER button under it), the
     warps once announced their own direction (OUTBOUND, INBOUND), and the
     two flights used to have KRITOR say something under its own name
     (Kritor is not a shop, but it will take your money — that kind of
     line). All of it read as a game's title card once there was a scene
     under it to look at instead of past. Just the name, and — on a flight
     that's actually going somewhere — where you're headed. */
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

  /* Returns { mode, ready, part, stop }. `ready` resolves once the scene has
     played itself out — every mode now runs on its own clock rather than
     waiting on an interaction; see notifyReady in pixel-fx.js's run(),
     called from globe(), blockGlitch() and letterGrid() alike. `part` tells
     the scene to take itself away over the given number of milliseconds —
     the picture dissolves and leaves the name behind. `stop` is called once
     the boot screen is dismissed, so nothing is left animating underneath
     the catalogue. */
  function mount(page) {
    const boot = document.getElementById("boot");
    const mode = modeFor(page);
    rememberPage(page);

    if (!boot) return {
      mode: mode, ready: Promise.resolve(), part: function () {}, stop: function () {},
    };

    boot.dataset.mode = mode;
    setText("boot-sub", SUB[mode]);

    const stage = document.getElementById("boot-fx");
    let fx = { stop: function () {}, part: function () {} };
    if (stage && window.KritorFX) {
      fx = mode === "gate" ? window.KritorFX.blockGlitch(stage)
        : mode === "arch" ? window.KritorFX.letterGrid(stage)
        : window.KritorFX.globe(stage);
    }

    /* The scene's own clock, not a second timer guessing at its duration —
       see notifyReady in pixel-fx.js's run(). WARP_MS still paces the
       loading bar's fill below, which is only ever decorative; the actual
       hand-off waits on the scene itself, so the two can never drift out of
       step under a slow frame or two. Every mode shares this fallback now,
       not just the flights — a scene that somehow never calls notifyReady
       still has to let the visitor in eventually. */
    const ready = fx.ready || new Promise(resolve => setTimeout(resolve, WARP_MS));

    return {
      mode: mode,
      ready: ready,
      part: function (ms) { fx.part(ms); },
      stop: function () { fx.stop(); },
    };
  }

  window.KritorBoot = { mount: mount, WARP_MS: WARP_MS };
})();
