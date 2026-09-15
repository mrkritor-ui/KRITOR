/* /shop/<id>/ redirects here to resolve on a static host; put the clean URL
   back so the address bar and any share match the route the customer clicked. */
(function () {
  var id = new URLSearchParams(location.search).get('id');
  if (id && /^[a-z0-9][a-z0-9-]*$/.test(id)) {
    history.replaceState(history.state, '', '/shop/' + encodeURIComponent(id) + '/');
  }
})();
