/* Old shares still point at /work.html?id=work-01 and
   /product.html?id=work-01-original. terminal.js and terminal-store.js only
   ever read the path, so that id is folded into the clean /work-01/ or
   /shop/work-01-original/ address here, before either runs, rather than
   teaching the shared files about a query string every other page never has.

   Which template this is comes from the tag that loads it —
   <script src="/legacy-id.js" data-room="work"> or "shop" — so the one file
   serves both pages. */
(function () {
  var script = document.currentScript;
  var room = script && script.getAttribute("data-room");
  var id = new URLSearchParams(location.search).get("id");
  if (!id) return;
  if (room === "work" && /^work-[A-Za-z0-9_-]+$/.test(id)) {
    history.replaceState(history.state, "", "/" + encodeURIComponent(id) + "/");
  } else if (room === "shop" && /^[a-z0-9][a-z0-9-]*$/.test(id)) {
    history.replaceState(history.state, "", "/shop/" + encodeURIComponent(id) + "/");
  }
})();
