(function () {
  const id = new URLSearchParams(location.search).get('id');
  if (id && /^work-[A-Za-z0-9_-]+$/.test(id)) {
    history.replaceState(history.state, '', '/' + encodeURIComponent(id) + '/');
    document.querySelectorAll('a[href*="work.html?id="]').forEach(function (a) {
      const u = new URL(a.href, location.href), rid = u.searchParams.get('id');
      if (rid) a.href = '/' + encodeURIComponent(rid) + '/';
    });
  }
})();
