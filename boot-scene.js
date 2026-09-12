/* KRITOR — the boot scene.

   The loading screen is a door, not a progress bar. Arriving at kritor.au you
   are stopped: a field of paper and ink keeps quietly rearranging itself, and
   nothing happens until you answer it — no name in it, no line of type over
   it, nothing to read, just the bar saying LOADING and then, once it has
   nothing left to report, PRESS TO ENTER. Moving between the catalogue and
   the store you are not stopped — a starfield flies you there, forwards on
   the way out and backwards on the way home — because the door is only
   worth closing once.

   Architecture is a third door rather than a third pair of flights — it has
   no far side to fly to yet, so arriving there is answered the same way the
   gate is: a scene, silent, waiting on a click. Its own scene is a single
   letter of KRITOR's own name, huge and not quite settled, standing in for
   a section that has no picture of its own yet either.

   Which screen you get is decided here, from where you were last:

     catalogue, arrived from anywhere but the store  →  the mosaic, and the gate
     catalogue, arrived from the store               →  starfield, flying back
     store                                           →  starfield, flying out
     architecture, arrived from anywhere              →  the signal, and the gate

   The store's two flights still speak — KRITOR in the blackletter, sentence
   case, saying whatever it likes, against the machine's own procedural
   sub-label set in the terminal face and capitals. Both gates are silent on
   purpose — nothing is written over either scene. */
(function () {
  "use strict";

  const LAST_PAGE_KEY = "kritor-last-page";

  /* KRITOR's own lines, for the two flights only — the gate is silent. */
  const VOICE = {
    out: [
      "Kritor counts the coins twice.",
      "Kritor wraps things carefully.",
      "Kritor hopes you brought a bag.",
      "Kritor names its price without blinking.",
      "Kritor sells only what it can bear to lose.",
      "Kritor is not a shop, but it will take your money.",
    ],
    back: [
      "Kritor watched you leave.",
      "Kritor kept your place.",
      "Kritor did not move a thing.",
      "Kritor is still here.",
      "Kritor knew you would come back.",
    ],
  };

  /* Nothing above the name, on any of the three screens. The door used to spell
     out its invitation — "YOU HAVE STUMBLED UPON", and an ENTER button under
     it — and the warps announced their own direction, OUTBOUND and INBOUND.
     Four lines of type over a landscape is a game's title card, not a
     painter's archive, and a flight that has to caption which way it is going
     is not flying convincingly. The name, where you are headed, and what
     KRITOR has to say about it. */
  const SUB = { gate: "", arch: "", out: "STORE", back: "CATALOGUE" };

  /* Long enough that the starfield gets to accelerate and mean something,
     short enough that it never feels like it is in the way. The loading bar is
     paced to this too, so the flight and the fill land together. */
  const WARP_MS = 1400;

  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

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

    /* Both gates are silent — VOICE has no "gate" or "arch" list, and the
       CSS hides the line either way. Only the store's two flights speak. */
    const gateLike = mode === "gate" || mode === "arch";

    boot.dataset.mode = mode;
    setText("boot-sub", SUB[mode]);
    if (!gateLike) setText("boot-voice", pick(VOICE[mode]));

    const stage = document.getElementById("boot-fx");
    let fx = { stop: function () {}, part: function () {} };
    if (stage && window.KritorFX) {
      fx = mode === "gate" ? window.KritorFX.mosaic(stage)
        : mode === "arch" ? window.KritorFX.signal(stage)
        : window.KritorFX.starfield(stage, { direction: mode === "back" ? "back" : "forward" });
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
      ready = new Promise(resolve => setTimeout(resolve, WARP_MS));
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
