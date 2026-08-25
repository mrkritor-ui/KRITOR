/* KRITOR — the boot scene.

   The loading screen is a door, not a progress bar. Arriving at kritor.au you
   are stopped: a fire burns up from the floor, KRITOR says something, and
   nothing happens until you click ENTER. Moving between the catalogue and the
   store you are not stopped — a starfield flies you there, forwards on the way
   out and backwards on the way home — because the door is only worth closing
   once.

   Which of the two you get is decided here, from where you were last:

     catalogue, arrived from anywhere but the store  →  the fire, and the gate
     catalogue, arrived from the store               →  starfield, flying back
     store                                           →  starfield, flying out

   The text is in two voices and they are set in two faces. The machine speaks
   in the terminal face, in capitals, and says only procedural things: where you
   are, what is being asked. KRITOR speaks in the blackletter, in sentence case,
   and says whatever it likes. Keeping them in one face made the whole screen
   read as system output and the line about running for your life looked like a
   status code. */
(function () {
  "use strict";

  const LAST_PAGE_KEY = "kritor-last-page";

  /* KRITOR's own lines. Sentence case on purpose — they are set in the
     blackletter, and blackletter capitals are ornament, not reading. */
  const VOICE = {
    gate: [
      "Kritor says hello.",
      "Kritor screams beware.",
      "Kritor does not know who you really are.",
      "Kritor tells you to run.",
      "Kritor has been expecting somebody.",
      "Kritor counts the ones who turned back.",
      "Kritor keeps the fire lit for a reason.",
      "Kritor asks what you came here to take.",
      "Kritor remembers every visitor.",
      "Kritor would not come in, if Kritor were you.",
      "Kritor is awake at this hour.",
      "Kritor doubts you will stay long.",
      "Kritor left the door open on purpose.",
      "Kritor swears the floor is solid.",
      "Kritor has seen your kind before.",
      "Kritor is not finished with you.",
    ],
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

  /* Nothing above the name on the door. The invitation used to be written out
     — "YOU HAVE STUMBLED UPON", and an ENTER button under it — and four lines
     of type over a fire is a game's title card, not a painter's archive. What
     is left is the name and the line KRITOR says. The warps keep their labels:
     those are wayfinding rather than theatre. */
  const LEAD = { gate: "", out: "OUTBOUND", back: "INBOUND" };
  const SUB = { gate: "", out: "STORE", back: "CATALOGUE" };

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
    return lastPage() === "store" ? "back" : "gate";
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  /* Returns { mode, ready, stop }. `ready` resolves when the screen is done
     asking: on the click, or when the flight lands. `stop` is called once the
     boot screen is dismissed, so the animation is not left running underneath
     the catalogue. */
  function mount(page) {
    const boot = document.getElementById("boot");
    const mode = modeFor(page);
    rememberPage(page);

    if (!boot) return { mode: mode, ready: Promise.resolve(), stop: function () {} };

    boot.dataset.mode = mode;
    setText("boot-lead", LEAD[mode]);
    setText("boot-sub", SUB[mode]);
    setText("boot-voice", pick(VOICE[mode]));

    const pre = document.getElementById("boot-fx");
    let stopFx = function () {};
    if (pre && window.KritorFX) {
      stopFx = mode === "gate"
        ? window.KritorFX.fire(pre)
        : window.KritorFX.starfield(pre, { direction: mode === "back" ? "back" : "forward" });
    }

    let ready;
    let cleanupGate = function () {};

    if (mode === "gate") {
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
      stop: function () { cleanupGate(); stopFx(); },
    };
  }

  window.KritorBoot = { mount: mount, WARP_MS: WARP_MS };
})();
